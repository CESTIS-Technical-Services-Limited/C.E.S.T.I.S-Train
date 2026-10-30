/* The Centre's own server must not fall over, and must not hand out the
   Centre's records to anyone who asks.

   What was wrong, and what each of these pins:

   1. ONE MISTYPED ADDRESS STOPPED THE WHOLE CENTRE. serveStatic() called
      decodeURIComponent() on the address with nothing to catch a failure, so a
      single request carrying a stray percent sign threw URIError out of the
      request handler and Node ended the process. A stale bookmark, a copied
      link, a network scanner — and every device lost trainees, fees, attendance
      and video at once, until somebody walked to the server machine and started
      it again by hand.

   2. THE RECORDS WERE PUBLIC. /_cestis/data/* took GET and PUT from anybody,
      and the static handler served the data/ and cert/ folders as ordinary
      files because nothing excluded them. A phone on the Centre wifi could
      download every account (password hashes and two-step secrets included),
      every trainee's details, the payslips and the cashbook — or replace them.
      The replies also carried Access-Control-Allow-Origin: *, which invited any
      website open in any browser on the network to do the same.

   3. ACCENTED NAMES WERE CORRUPTED ON SAVE. The upload handler built the body
      by concatenating each network chunk as a string, so a multi-byte character
      landing across a chunk boundary was torn in half. The JSON still parsed,
      so the damage was saved and synced everywhere with no error at all.

   4. RANGES WERE WRONG. An open-ended request promised more bytes than the file
      held, so a video or PDF hung until the connection timed out; and a
      "last N bytes" request was served the FIRST N instead.

   5. SAVES AT THE SAME MOMENT TORE THE FILE. Every save wrote to one shared
      "<file>.tmp": overlapping saves mostly failed with 500, and the file left
      on disk was often not even valid JSON. A save also REPLACED the file with
      whatever one device sent, so a device with a smaller copy took records
      away, and there was no history to recover from. Saves now merge into
      what is stored, one at a time, through a temporary file of their own,
      keeping the previous version in data/.history.

   6. MORE THAN THE STORE WAS PUBLIC. "User Login/" exports (hashes, two-step
      secrets), dot-files and key files were served as ordinary files; the
      health check told anyone the data folder's path; and /_cestis/rooms
      listed every live class's room code — all it takes to join — to anyone
      on the network. The token used to be stamped into a public script and
      changed on every restart, breaking every open page; it is now fetched
      from /_cestis/token and kept across restarts. (What the token does and
      does not protect is spelt out in READ ME FIRST.)

   7. A WEBSITE COULD STILL REACH THE STORE (review M2). The token went to any
      page that asked, under any name: a website that pointed its own name at
      this computer (DNS rebinding) was "same-origin" with the server in the
      browser's eyes, and could fetch the token and the records. The store now
      answers only to the server's own names. The token also opened the room
      list for every device (all can fetch it), and the records listing told
      anyone the data folder's path.

   8. A TRAINEE COULD TAKE A CLASS'S HOST PLACE (review M3): the signalling
      server gave cestis-<code>-host to whoever asked first. A -host id now
      needs a ticket the server gives only to staff whose password it has
      checked against the Centre's accounts — except on a brand-new Centre with
      no staff login yet, so a first class can always start.

   The server runs on a scratch data folder (CESTIS_DATA_DIR / CESTIS_CERT_DIR),
   so this test never touches the Centre's real records.

   Run: node tests/offline-server-hardening.test.js */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const PORT = 8000 + Math.floor(Math.random() * 1500);
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-hardening-'));
const DATA = path.join(SCRATCH, 'data'), CERT = path.join(SCRATCH, 'cert');

function req(pathname, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const r = http.request({
      host: opts.host || '127.0.0.1', port: PORT, path: pathname,
      method: opts.method || 'GET', headers: opts.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    r.on('error', e => resolve({ status: 0, headers: {}, body: '', error: e.message }));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, ['cestis-offline-server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT),
      CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: CERT }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverExited = false;
  server.on('exit', () => { serverExited = true; });

  // Give it a moment to bind.
  for (let i = 0; i < 40; i++) {
    await wait(150);
    const h = await req('/_cestis/health');
    if (h.status === 200) break;
  }

  const health = await req('/_cestis/health');
  assert(health.status === 200, 'the server starts and answers /_cestis/health');

  /* ---------- 1. A bad address must not end the day ---------- */
  console.log('One malformed address does not stop the Centre');
  for (const bad of ['/%', '/%zz', '/a%', '/%E0%A4%A', '/x%GG']) {
    const r = await req(bad);
    assert(r.status === 400, 'a request for ' + bad + ' is answered with 400, not a crash');
  }
  await wait(300);
  assert(!serverExited, 'the server process is still running after malformed addresses');
  const after = await req('/_cestis/health');
  assert(after.status === 200, 'and it still serves every other device');

  /* ---------- 2. The records are not public ---------- */
  console.log('The records folder and the private key are not web pages');
  const dataFile = await req('/data/' + encodeURIComponent("READ ME - THIS IS THE CENTRE'S DATA.txt"));
  assert(dataFile.status === 403, 'the data folder is not served as ordinary files');
  assert((await req('/data/')).status === 403, 'nor is the folder itself');
  assert((await req('/cert/cestis-lan-key.pem')).status === 403, 'nor is the TLS private key');
  assert((await req('/User%20Login/somebody/account.json')).status === 403,
    'nor a real per-user export in "User Login" (password hashes, two-step secrets)');
  assert((await req('/User%20Login/README.md')).status === 403, 'nor anything else in that folder');
  assert((await req('/.gitignore')).status === 403, 'nor dot-files');
  assert((await req('/vendor/x.pem')).status === 403, 'nor a key file anywhere');
  const healthBody = JSON.parse(health.body || '{}');
  assert(healthBody.mode === 'offline-lan' && !!healthBody.time, 'the health check still says what it is, and the time');
  assert(!('dataFolder' in healthBody) && !('host' in healthBody),
    'but no longer tells anyone where the records are kept or what the machine is called');
  assert((await req('/index.html')).status === 200, 'while the pages themselves are still served');
  assert((await req('/cestis-core.js')).status === 200, 'and so are the scripts they need');

  console.log('The store asks who is calling');
  const noTok = await req('/_cestis/data');
  assert(noTok.status === 401, 'listing the records without the token is refused');
  const putNoTok = await req('/_cestis/data/HARDENING_TEST.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"stolen":1}'
  });
  assert(putNoTok.status === 401, 'writing to the records without the token is refused');
  assert(!fs.existsSync(path.join(DATA, 'HARDENING_TEST.json')),
    'and the refused write left nothing behind');

  const script = await req('/cestis-page-cloud.js');
  assert(script.status === 200, 'the page-cloud script is served');
  assert(script.body === fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8'),
    'exactly as it is on disk — the same file both builds run, with no secret stamped into it');
  const tok = await req('/_cestis/token');
  const TOKEN = (JSON.parse(tok.body || '{}').token) || '';
  assert(/^[a-f0-9]{48}$/.test(TOKEN), 'our pages fetch the token once they have found the server');
  assert(fs.readFileSync(path.join(CERT, 'lan-token'), 'utf8').trim() === TOKEN,
    'and it is kept with the certificate, so a restart no longer breaks every open page');
  const hdr = { 'X-CESTIS-Token': TOKEN };

  console.log('The room list is for the server computer');
  assert((await req('/_cestis/rooms')).status === 200, 'it opens on the server computer itself (README section 5)');
  const lanIp = Object.values(os.networkInterfaces()).reduce((a, l) => a.concat(l || []), [])
    .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address)[0];
  if (lanIp) {
    assert((await req('/_cestis/rooms', { host: lanIp })).status === 403,
      'but another device on the network is not shown every class\'s room code');
    // It used to open for any request carrying the token — but every device on
    // the network can fetch the token, and no page of ours asks for this list.
    assert((await req('/_cestis/rooms', { host: lanIp, headers: hdr })).status === 403,
      'and carrying the token (which every device can fetch) no longer opens it');
  } else {
    console.log('  (no network address on this machine — skipping the from-another-device check)');
  }

  assert((await req('/_cestis/data', { headers: hdr })).status === 200,
    'a page carrying the token can read the records');
  assert((await req('/_cestis/data', { headers: { 'X-CESTIS-Token': 'x'.repeat(TOKEN.length) } })).status === 401,
    'a wrong token of the right length is still refused');

  assert(!('access-control-allow-origin' in health.headers),
    'replies no longer invite every page on the network to read the store');

  /* ---------- 3. A name with accents survives the round trip ---------- */
  console.log('An accented name is stored exactly as it was typed');
  const NAME = { name: 'André Ñuñez — Côte d’Ivoire', note: 'ü'.repeat(500) };
  const put = await req('/_cestis/data/HARDENING_TEST.json', {
    method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr),
    body: JSON.stringify(NAME)
  });
  assert(put.status === 200, 'the save succeeds');
  const back = await req('/_cestis/data/HARDENING_TEST.json', { headers: hdr });
  assert(back.status === 200, 'and reads back');
  let parsed = null;
  try { parsed = JSON.parse(back.body); } catch (e) {}
  assert(parsed && parsed.name === NAME.name,
    'the accented name comes back character for character — a chunk boundary no longer tears it in half');
  assert(parsed && parsed.note === NAME.note, 'and so does a long run of multi-byte characters');

  /* ---------- 5. Saves at the same moment ---------- */
  console.log('Saves arriving at the same moment');
  const big = 'x'.repeat(2 * 1024 * 1024);
  const many = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => req('/_cestis/data/CONCURRENT.json', {
    method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr),
    body: JSON.stringify({ n: i, pad: i % 2 ? big : 'small' })
  })));
  assert(many.every(r => r.status === 200), 'eight overlapping saves all succeed (they used to fail with 500): ' +
    many.map(r => r.status).join(','));
  let whole = null;
  try { whole = JSON.parse(fs.readFileSync(path.join(DATA, 'CONCURRENT.json'), 'utf8')); } catch (e) {}
  assert(!!whole && typeof whole.n === 'number', 'and the file left on disk is whole, valid JSON');
  assert(!fs.readdirSync(DATA).some(f => /\.tmp$/.test(f)), 'with no temporary file left behind');
  const histDir = path.join(DATA, '.history', 'CONCURRENT.json');
  // Older versions are compressed in the background, after the save has
  // answered: for a moment one version can be on disk both ways (plain and
  // .gz). Count each version once, and give the compression time to settle.
  const versionsKept = () => {
    let names = [];
    try { names = fs.readdirSync(histDir).filter(f => /\.json(\.gz)?$/.test(f)); } catch (e) { return { count: 0, settled: false }; }
    const bases = new Set(names.map(f => f.replace(/\.gz$/, '')));
    return { count: bases.size, settled: bases.size === names.length };
  };
  let kept = versionsKept();
  for (let i = 0; i < 50 && !kept.settled; i++) { await new Promise(r => setTimeout(r, 100)); kept = versionsKept(); }
  assert(kept.count === 7,
    'every replaced version is kept in data/.history (7 of 8 saves replaced one; found ' + kept.count + ')');
  assert(!JSON.parse((await req('/_cestis/data', { headers: hdr })).body).files.some(f => f.file === '.history'),
    'and the history is not listed as a page file');

  console.log('A save is merged into what the server holds, never a replacement');
  const T1 = '2026-10-01T09:00:00.000Z', T2 = '2026-10-01T10:00:00.000Z';
  const page = (students, stamp) => JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'MERGE.json',
    stamps: { voctrain_students: stamp }, data: { voctrain_students: JSON.stringify(students) } });
  await req('/_cestis/data/MERGE.json', { method: 'PUT', headers: hdr,
    body: page([{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }], T1) });
  const shrink = await req('/_cestis/data/MERGE.json', { method: 'PUT', headers: hdr, body: page([{ id: 'S1' }], T2) });
  assert(shrink.status === 200 && JSON.parse(shrink.body).changedByServer === true,
    'a newer save holding one trainee is accepted, and the reply says the server merged it');
  const roll = JSON.parse(JSON.parse(fs.readFileSync(path.join(DATA, 'MERGE.json'), 'utf8')).data.voctrain_students);
  assert(roll.map(s => s.id).join(',') === 'S1,S2,S3', 'and the server still holds all three trainees');

  console.log('An unchanged file is not sent again');
  const first = await req('/_cestis/data/MERGE.json', { headers: hdr });
  const etag = first.headers.etag;
  assert(!!etag, 'a read carries an ETag');
  const again = await req('/_cestis/data/MERGE.json', { headers: Object.assign({ 'If-None-Match': etag }, hdr) });
  assert(again.status === 304 && again.body === '', 'and asking again with it is a 304 with no body');

  /* ---------- 4. Ranges tell the truth ---------- */
  console.log('A part-file request is answered with the part that was asked for');
  const size = fs.statSync(path.join(ROOT, 'package.json')).size;
  const over = await req('/package.json', { headers: { Range: 'bytes=0-99999' } });
  assert(over.status === 206, 'an over-long range is still a partial answer');
  assert(Number(over.headers['content-length']) === Buffer.byteLength(over.body),
    'and promises exactly as many bytes as it sends — it used to promise bytes that never came, so players hung');
  assert(Number(over.headers['content-length']) === size, 'which is the rest of the file');

  const tail = await req('/package.json', { headers: { Range: 'bytes=-20' } });
  assert(tail.status === 206, 'a "last N bytes" request is a partial answer');
  assert(tail.body === fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').slice(-20),
    'and returns the LAST 20 bytes, not the first 20');

  /* ---------- 7. Review M2: the names it answers to, and what it tells ---------- */
  console.log('The records answer only to this server\'s own names (DNS rebinding)');
  const rebound = { Host: 'evil.example:' + PORT };
  assert((await req('/_cestis/token', { headers: rebound })).status === 421,
    'a page that reached the server under a website\'s name is not handed the token');
  assert((await req('/_cestis/data', { headers: Object.assign({}, hdr, rebound) })).status === 421,
    'nor the records, even carrying the token');
  assert((await req('/_cestis/rooms', { headers: rebound })).status === 421, 'nor the room list');
  assert((await req('/_cestis/token', { headers: { Host: 'localhost:' + PORT } })).status === 200,
    'while localhost still gets the token');
  assert((await req('/_cestis/token')).status === 200, 'and so does this computer\'s address');
  assert((await req('/_cestis/health', { headers: rebound })).status === 200,
    'the health check (no secrets in it) still answers, so a page can tell it found a Centre server');
  if (lanIp) assert((await req('/_cestis/token', { host: lanIp })).status === 200, 'another device using this computer\'s network address gets it');

  console.log('The records listing does not say where the folder is');
  const listing = await req('/_cestis/data', { headers: hdr });
  assert(listing.status === 200 && !('folder' in JSON.parse(listing.body || '{}')), 'no "folder" in the listing');
  assert(listing.body.indexOf(DATA) === -1 && listing.body.indexOf(SCRATCH) === -1, 'and the folder\'s path appears nowhere in it');

  /* ---------- 8. Review M3: a room's host place is for signed-in staff ---------- */
  console.log('A class room\'s host place: for staff, with a ticket the server checks');
  const sigMod = require('../cestis-offline-signalling.js');
  const nodeCrypto = require('crypto');
  function wsConnect(id, apiKey) {
    return new Promise(resolve => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/peerjs/peerjs?key=' + encodeURIComponent(apiKey || 'peerjs') + '&id=' + id + '&token=t' + Math.random().toString(36).slice(2),
        headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': nodeCrypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' } });
      r.on('upgrade', (res, socket, head) => {
        const c = { socket, messages: [] };
        let buf = Buffer.alloc(0);
        const take = d => { buf = Buffer.concat([buf, d]); const o = sigMod.decodeFrames(buf); buf = o.rest; o.frames.forEach(f => { if (f.opcode === 1) c.messages.push(JSON.parse(f.payload.toString('utf8'))); }); };
        if (head && head.length) take(head);
        socket.on('data', take); socket.on('error', () => {});
        setTimeout(() => resolve(c), 150);
      });
      r.on('error', () => resolve({ socket: { destroy() {} }, messages: [{ type: 'connect-error' }] }));
      r.end();
    });
  }
  const firstType = c => (c.messages[0] || {}).type;
  let ws = await wsConnect('cestis-FIRSTRUN22-host');
  assert(firstType(ws) === 'OPEN', 'a brand-new Centre (no staff login in its data yet) can still start a class');
  ws.socket.destroy();

  // The Centre's accounts arrive in the data folder, as the dashboard saves them.
  const salt = nodeCrypto.randomBytes(16);
  const insHash = 'pbkdf2$1000$' + salt.toString('hex') + '$' + nodeCrypto.pbkdf2Sync('Teach-Pass-12', salt, 1000, 32, 'sha256').toString('hex');
  fs.writeFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), JSON.stringify({ data: { voctrain_users: JSON.stringify([
    { id: 'USR-ins', role: 'instructor', username: 'teacher', email: 'teacher@example.org', password: insHash, status: 'active' },
    { id: 'USR-001', role: 'admin', username: 'cestisadmin', password: 'cestisadmin123$', defaultPassword: true, status: 'active' },
    { id: 'USR-stu', role: 'student', username: 'pupil', password: insHash, status: 'active' },
    { id: 'USR-off', role: 'instructor', username: 'gone', password: insHash, status: 'disabled' }
  ]) }, stamps: {} }));
  const ticketReq = (body, headers) => req('/_cestis/host-ticket', { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers === undefined ? hdr : headers), body: JSON.stringify(body) });
  assert((await ticketReq({ username: 'teacher', password: 'Teach-Pass-12' }, {})).status === 401, 'asking without the token is refused');
  assert((await ticketReq({ username: 'teacher', password: 'Teach-Pass-12' }, Object.assign({}, hdr, rebound))).status === 421,
    'and under a rebound name too');
  assert((await ticketReq({ username: 'teacher', password: 'wrong' })).status === 403, 'a wrong password gets no ticket');
  assert((await ticketReq({ username: 'cestisadmin', password: 'cestisadmin123$' })).status === 403, 'the published default gets none');
  assert((await ticketReq({ username: 'pupil', password: 'Teach-Pass-12' })).status === 403, 'a trainee gets none, even with the right password');
  assert((await ticketReq({ username: 'gone', password: 'Teach-Pass-12' })).status === 403, 'nor a switched-off member of staff');
  const okTicket = await ticketReq({ username: 'Teacher@Example.org', password: 'Teach-Pass-12' });
  const ticket = (JSON.parse(okTicket.body || '{}').ticket) || '';
  assert(okTicket.status === 200 && !!ticket, 'a member of staff, by username or e-mail, gets a ticket');
  const secret = fs.readFileSync(path.join(CERT, 'host-secret'), 'utf8').trim();
  const claims = sigMod.verifyTicket(secret, ticket);
  assert(claims && claims.u === 'USR-ins' && claims.r === 'instructor', 'signed with the server\'s own secret, for that person');
  assert(/^[a-f0-9]{64}$/.test(secret), 'the secret is kept with the certificate (cert/host-secret), not in any page');

  ws = await wsConnect('cestis-ROOMCODE33-host');
  assert(firstType(ws) === 'ERROR', 'now a device with no ticket cannot take a room\'s host place (got ' + firstType(ws) + ')');
  ws.socket.destroy();
  ws = await wsConnect('cestis-ROOMCODE33-host', ticket);
  assert(firstType(ws) === 'OPEN', 'the instructor with the ticket hosts the room');
  const joiner = await wsConnect('cestis-ROOMCODE33-zz99');
  assert(firstType(joiner) === 'OPEN', 'and trainees still join as participants');
  ws.socket.destroy(); joiner.socket.destroy();

  console.log('Guessing passwords for a ticket is slowed down');
  let last = null;
  for (let i = 0; i < 11; i++) last = await ticketReq({ username: 'teacher', password: 'guess-' + i });
  assert(last.status === 429, 'after ten wrong passwords from one device it must wait (got ' + last.status + ')');

  server.kill();
  await wait(200);
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
