/* A teacher whose laptop slept can start their class again.

   The video signalling server kept every connected peer until a write to its
   socket failed. A laptop whose lid closed, or that dropped off the wifi, sends
   no goodbye, so its id stayed registered for ever — and when the teacher
   reloaded and pressed "Rejoin as Host" (a new connection, so a new PeerJS
   token) they were told "Room host ID is still active", again and again, and
   the class could not start. PeerJS sends a HEARTBEAT every few seconds; the
   server ignored them.

   What this pins, against the real cestis-offline-signalling.js over a real
   WebSocket handshake:
     - a peer that is still talking keeps its id (a genuine clash is refused);
     - a peer that has gone silent can be taken over by a reconnect;
     - a peer silent past the alive timeout is dropped altogether;
     - heartbeats count as being alive.
   (The limits are shortened here; the real ones are 60 s and 15 s.)

   And who may take a room's HOST place (review M3). The host is the peer
   cestis-<ROOMCODE>-host and the server gave it to whoever asked first: a
   trainee who knew the room code registered it before the instructor, who was
   then told the room was in use while the trainee held the class. With the
   Centre's server's hostCheck, a -host id needs a host ticket — made by the
   server for signed-in staff, signed with its own secret, short-lived — and
   anything else is refused with an ERROR the page explains.

   Run: node tests/offline-signalling.test.js */
'use strict';

const http = require('http');
const crypto = require('crypto');
const signalling = require('../cestis-offline-signalling.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

/* A minimal WebSocket client: handshake, read the first message, send masked
   text frames. */
function connect(port, id, token, apiKey) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: '127.0.0.1', port, path: '/peerjs/peerjs?key=' + (apiKey || 'peerjs') + '&id=' + id + '&token=' + token,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' } });
    req.on('upgrade', (res, socket, head) => {
      const client = { socket, messages: [], closed: false };
      let buf = Buffer.alloc(0);
      const take = d => {
        buf = Buffer.concat([buf, d]);
        const out = signalling.decodeFrames(buf);
        buf = out.rest;
        out.frames.forEach(f => { if (f.opcode === 1) client.messages.push(JSON.parse(f.payload.toString('utf8'))); });
      };
      if (head && head.length) take(head);            // the first message can arrive with the handshake
      socket.on('data', take);
      socket.on('close', () => { client.closed = true; });
      socket.on('error', () => { client.closed = true; });
      client.send = obj => {
        const data = Buffer.from(JSON.stringify(obj));
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | data.length]), mask, masked]));
      };
      setTimeout(() => resolve(client), 60);
    });
    req.on('error', reject);
    req.end();
  });
}
const first = c => (c.messages[0] || {}).type;

(async () => {
  const server = http.createServer((q, r) => r.end());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const sig = signalling.attach(server, null, { aliveTimeoutMs: 600, takeoverAfterMs: 250, sweepMs: 50 });

  console.log('A peer that is still talking keeps its id');
  const host = await connect(port, 'cestis-ABC234-host', 'tokA');
  assert(first(host) === 'OPEN', 'the teacher hosts the room');
  const clash = await connect(port, 'cestis-ABC234-host', 'tokB');
  assert(first(clash) === 'ID-TAKEN', 'a second device claiming the same id at once is refused (a genuine clash)');
  // Heartbeats keep it alive well past the alive timeout.
  for (let i = 0; i < 8; i++) { host.send({ type: 'HEARTBEAT' }); await wait(100); }
  assert(sig.count() === 1 && !host.closed, 'a host sending heartbeats is never dropped');
  const clash2 = await connect(port, 'cestis-ABC234-host', 'tokB');
  assert(first(clash2) === 'ID-TAKEN', 'and still cannot be taken over while it is alive');

  console.log('A peer that went silent (laptop lid closed) can be taken over');
  await wait(350);                                      // silent past the takeover limit
  const back = await connect(port, 'cestis-ABC234-host', 'tokC');
  assert(first(back) === 'OPEN', 'the teacher\'s reload gets the room back (it used to get "ID is taken" for ever)');
  await wait(100);
  assert(host.closed, 'and the dead connection is closed');

  console.log('A peer silent past the alive timeout is dropped');
  const student = await connect(port, 'cestis-ABC234-x1', 'tokS');
  assert(first(student) === 'OPEN', 'a trainee joins');
  for (let i = 0; i < 10; i++) { back.send({ type: 'HEARTBEAT' }); await wait(100); }
  assert(student.closed, 'a trainee who has said nothing for longer than the timeout is dropped');
  assert(sig.ids().indexOf('cestis-ABC234-x1') === -1, 'and no longer registered');
  assert(sig.ids().indexOf('cestis-ABC234-host') !== -1, 'while the host, still talking, is kept');
  assert(back.messages.some(m => m.type === 'LEAVE' && m.src === 'cestis-ABC234-x1'),
    'and the room is told the trainee left, so their tile does not hang frozen');

  sig.stop();
  [back, clash, clash2].forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  server.close();

  console.log('A host ticket: made by the server, checked, and short-lived');
  {
    const T = signalling;
    const t = T.makeTicket('secret-1', { u: 'USR-ins', r: 'instructor' }, 1000);
    const c = T.verifyTicket('secret-1', t, 2000);
    assert(c && c.u === 'USR-ins' && c.r === 'instructor', 'a ticket the server made reads back who it was for');
    assert(T.verifyTicket('secret-2', t, 2000) === null, 'a ticket signed with another secret is refused');
    assert(T.verifyTicket('secret-1', t, 1000 + T.TICKET_TTL_MS + 1) === null, 'an expired ticket is refused');
    const parts = t.split('.');
    const forged = 'v1.' + Buffer.from(JSON.stringify({ u: 'USR-ins', r: 'admin', exp: 9e15 })).toString('base64').replace(/=+$/, '') + '.' + parts[2];
    assert(T.verifyTicket('secret-1', forged, 2000) === null, 'changing what a ticket says breaks it');
    assert(T.verifyTicket('secret-1', 'peerjs', 2000) === null && T.verifyTicket('secret-1', '', 2000) === null,
      'the library\'s ordinary key is not a ticket');
    assert(T.isHostId('cestis-ABCDEFGHJK-host') && !T.isHostId('cestis-ABCDEFGHJK-x1') && !T.isHostId('lmsrt-USR-1'),
      'only a room\'s host id needs one');
  }

  console.log('Only a host ticket takes a room\'s host place');
  {
    const SECRET = 'test-secret';
    const srv2 = http.createServer((q, r) => r.end());
    await new Promise(r => srv2.listen(0, '127.0.0.1', r));
    const port2 = srv2.address().port;
    const sig2 = signalling.attach(srv2, null, { hostCheck: (id, key) =>
      signalling.verifyTicket(SECRET, key) ? { ok: true } : { ok: false, msg: 'Only signed-in staff can host a class here.' } });
    const squatter = await connect(port2, 'cestis-ROOMCODE22-host', 'tokT');
    assert(first(squatter) === 'ERROR', 'a trainee who knows the room code cannot take its host place (got ' + first(squatter) + ')');
    assert(/host/i.test(((squatter.messages[0] || {}).payload || {}).msg || ''), 'and is told why, in words the page shows');
    await wait(50);
    assert(sig2.ids().indexOf('cestis-ROOMCODE22-host') === -1, 'the host id was never registered');
    const ticket = signalling.makeTicket(SECRET, { u: 'USR-ins', r: 'instructor' });
    const teacher = await connect(port2, 'cestis-ROOMCODE22-host', 'tokI', ticket);
    assert(first(teacher) === 'OPEN', 'the instructor, with the ticket the server gave them at sign-in, hosts the room');
    const stranger = await connect(port2, 'cestis-ROOMCODE22-host', 'tokX', signalling.makeTicket('not-the-secret', { u: 'x', r: 'admin' }));
    assert(first(stranger) === 'ERROR', 'a ticket made with any other secret is refused');
    const pupil = await connect(port2, 'cestis-ROOMCODE22-ab12', 'tokP');
    assert(first(pupil) === 'OPEN', 'trainees still join the room as participants, with no ticket');
    sig2.stop();
    [squatter, teacher, stranger, pupil].forEach(c => { try { c.socket.destroy(); } catch (e) {} });
    srv2.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
