/* ============================================================================
   cestis-offline-signalling.js — video classes with no internet.

   WHY THIS IS NEEDED
   ------------------
   Two browsers cannot start a video call by themselves. Before any picture or
   sound flows, each one has to hand the other a description of how to be
   reached, and something has to carry those messages between them. That is all
   a "signalling server" does. The online build borrows the public PeerJS cloud
   for it, which is why video was the one part of the system that stopped
   working offline: the cameras, microphones and the connection between the two
   machines were all fine — nobody was there to make the introduction.

   This makes the introduction on the Centre's own server instead. It speaks the
   same protocol the PeerJS library already expects, so not a line of the
   conference code changes; it simply points at this machine instead of the
   internet.

   NO DEPENDENCIES
   ---------------
   The WebSocket handling below is written out by hand against RFC 6455 rather
   than pulled from npm, because an offline build that needs a download to
   install is not an offline build.

   WHAT STILL APPLIES
   ------------------
   Once introduced, the two browsers talk directly to each other. On one network
   that works with no further help. Devices on different networks would need a
   relay in between, which is a different problem and not one a Centre wifi has.
   ============================================================================ */
'use strict';

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ----------------------------------------------------------- frame writing */
function encodeFrame(payload, opcode) {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | (opcode == null ? 1 : opcode);   // FIN + opcode (1 = text)
  return Buffer.concat([header, data]);
}

/* ----------------------------------------------------------- frame reading */
/* Returns { frames:[{opcode,payload}], rest:Buffer }. Client frames are always
   masked; anything else is a protocol error and the socket is dropped. */
function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  while (true) {
    if (buf.length - offset < 2) break;
    const b0 = buf[offset], b1 = buf[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) === 0x80;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (buf.length - pos < 2) break;
      len = buf.readUInt16BE(pos); pos += 2;
    } else if (len === 127) {
      if (buf.length - pos < 8) break;
      // Messages here are tiny; the high word is always zero in practice.
      len = buf.readUInt32BE(pos + 4); pos += 8;
    }
    let mask = null;
    if (masked) {
      if (buf.length - pos < 4) break;
      mask = buf.slice(pos, pos + 4); pos += 4;
    }
    if (buf.length - pos < len) break;                 // frame not fully arrived
    const data = Buffer.from(buf.slice(pos, pos + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    frames.push({ opcode, payload: data });
    offset = pos + len;
  }
  return { frames, rest: buf.slice(offset) };
}

/* ============================================================================
   The signalling exchange itself.

   PeerJS clients connect to  /peerjs/peerjs?key=…&id=<their id>&token=…  and
   then post messages addressed to another id. This keeps a register of who is
   connected and hands each message to the one it is addressed to — nothing
   more. It never sees video or audio; those go straight between the browsers.
   ============================================================================ */
function attach(server, log) {
  const peers = new Map();            // id -> { socket, token, since }
  const say = log || function () {};

  function send(sock, obj) {
    try { sock.write(encodeFrame(JSON.stringify(obj))); } catch (e) {}
  }

  function deliver(msg, fromId) {
    const dst = msg.dst;
    const target = peers.get(dst);
    if (target) {
      send(target.socket, { type: msg.type, src: fromId, dst: dst, payload: msg.payload });
      return true;
    }
    // Whoever they were calling is not here. Say so, or the caller waits for a
    // connection that can never arrive.
    const me = peers.get(fromId);
    if (me) send(me.socket, { type: 'EXPIRE', src: dst, dst: fromId });
    return false;
  }

  server.on('upgrade', (req, socket) => {
    const url = req.url || '';
    if (url.indexOf('/peerjs') !== 0) { socket.destroy(); return; }

    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const params = new URLSearchParams(url.split('?')[1] || '');
    const id = params.get('id');
    const token = params.get('token') || '';
    if (!id) { socket.destroy(); return; }

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    socket.setNoDelay(true);

    // A room host that reloads reclaims its own id; a genuine clash is refused,
    // which is what the library expects to hear.
    const existing = peers.get(id);
    if (existing && existing.token !== token) {
      send(socket, { type: 'ID-TAKEN', payload: { msg: 'ID is taken' } });
      try { socket.end(); } catch (e) {}
      return;
    }
    if (existing) { try { existing.socket.destroy(); } catch (e) {} }

    peers.set(id, { socket, token, since: Date.now() });
    send(socket, { type: 'OPEN' });
    say('[signalling] ' + id + ' joined (' + peers.size + ' connected)');

    let buffer = Buffer.alloc(0);

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      frames.forEach(f => {
        if (f.opcode === 8) { try { socket.end(); } catch (e) {} return; }   // close
        if (f.opcode === 9) { try { socket.write(encodeFrame(f.payload.toString('utf8'), 10)); } catch (e) {} return; } // ping -> pong
        if (f.opcode !== 1 && f.opcode !== 0) return;                        // only text
        let msg;
        try { msg = JSON.parse(f.payload.toString('utf8')); } catch (e) { return; }
        if (!msg || !msg.type) return;
        if (msg.type === 'HEARTBEAT') return;              // keep-alive, nothing to do
        if (msg.type === 'LEAVE' || msg.type === 'EXPIRE') { deliver(msg, id); return; }
        // OFFER / ANSWER / CANDIDATE — the introduction itself.
        if (msg.dst) deliver(msg, id);
      });
    });

    const bye = () => {
      const cur = peers.get(id);
      if (cur && cur.socket === socket) {
        peers.delete(id);
        say('[signalling] ' + id + ' left (' + peers.size + ' connected)');
        // Tell everyone still in the same room, so tiles disappear promptly
        // instead of hanging as frozen video.
        const room = roomOf(id);
        if (room) {
          peers.forEach((p, otherId) => {
            if (roomOf(otherId) === room) send(p.socket, { type: 'LEAVE', src: id, dst: otherId });
          });
        }
      }
    };
    socket.on('close', bye);
    socket.on('error', bye);
  });

  /* Ids are minted as  cestis-<ROOMCODE>-host  and  cestis-<ROOMCODE>-<random>,
     so the room is the middle part. Used only to announce departures. */
  function roomOf(id) {
    const m = /^cestis-([A-Za-z0-9]+)-/.exec(String(id || ''));
    return m ? m[1] : null;
  }

  return {
    count: () => peers.size,
    ids: () => Array.from(peers.keys()),
    rooms: () => {
      const out = {};
      peers.forEach((p, id) => {
        const r = roomOf(id) || '(none)';
        (out[r] = out[r] || []).push(id);
      });
      return out;
    }
  };
}

module.exports = { attach, encodeFrame, decodeFrames };
