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

   Run: node tests/offline-server-hardening.test.js */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const PORT = 8000 + Math.floor(Math.random() * 1500);

function req(pathname, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: pathname,
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
    cwd: ROOT, env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT) }),
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
  assert((await req('/index.html')).status === 200, 'while the pages themselves are still served');
  assert((await req('/cestis-core.js')).status === 200, 'and so are the scripts they need');

  console.log('The store asks who is calling');
  const noTok = await req('/_cestis/data');
  assert(noTok.status === 401, 'listing the records without the token is refused');
  const putNoTok = await req('/_cestis/data/HARDENING_TEST.json', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"stolen":1}'
  });
  assert(putNoTok.status === 401, 'writing to the records without the token is refused');
  assert(!fs.existsSync(path.join(ROOT, 'data', 'HARDENING_TEST.json')),
    'and the refused write left nothing behind');

  const script = await req('/cestis-page-cloud.js');
  assert(script.status === 200, 'the page-cloud script is served');
  const m = script.body.match(/var LAN_TOKEN = '([a-f0-9]{32,})'/);
  assert(!!m, 'the server stamps a real token into it, so our own pages authenticate by themselves');
  assert(script.body.indexOf('__CESTIS_LAN_TOKEN__') === -1,
    'and the placeholder does not survive into what the browser receives');
  const TOKEN = m ? m[1] : '';
  const hdr = { 'X-CESTIS-Token': TOKEN };

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
  try { fs.unlinkSync(path.join(ROOT, 'data', 'HARDENING_TEST.json')); } catch (e) {}

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

  server.kill();
  await wait(200);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
