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
function connect(port, id, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: '127.0.0.1', port, path: '/peerjs/peerjs?key=peerjs&id=' + id + '&token=' + token,
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
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
