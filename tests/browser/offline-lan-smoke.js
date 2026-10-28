/* The Offline System in a real browser, on its real server — and the online
   build beside it, to prove the LAN code is inert there.
     node tests/browser/offline-lan-smoke.js        (npm run test:browser:offline)

   What Node cannot show: the generated "Offline System/" pages boot on
   cestis-offline-server.js; the dashboard's saveState() really persists (its
   old copy called an undefined saveCollection and kept nothing); another
   device sees the save and adopts it into memory; a trainee's sign-out on one
   device leaves the Centre's records on the server; the Cashbook's
   "Sync Required" gate (once "Cloud Sync Required") and the certificate download gate accept the
   Centre's server instead of waiting for Google for ever; video is pointed at
   the Centre's server. And on the online build: none of it switches on.

   Then the staff-only switch (the trainee gate, Stage 6a). Off, every device
   is given the token as before. On, a trainee's device can get neither the
   token nor any /_cestis/data/* file, and a device that first opens the
   system then receives none of the Centre's records; the trainee signs in
   through /_cestis/gate with a PBKDF2 proof the browser works out itself and
   sends an item sealed in the browser; an administrator's sign-in, checked
   by the server, still gets the token (and a host ticket). Off again, the
   office PC fetches the new token by itself and its saves land.

   Every non-local request is aborted, as on a Centre network with no
   internet. Uses the environment's Chromium via playwright-core; kept out of
   the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const OFF = path.join(ROOT, 'Offline System');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-lan-browser-'));
const DATA = path.join(tmp, 'data');
const PORT = 9100 + Math.floor(Math.random() * 800);
const dash = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8')); } catch (e) { return null; } };
const dashList = k => { const d = dash(); return d && d.data[k] ? JSON.parse(d.data[k]) : []; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serveRoot() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async function main() {
  const server = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: OFF, stdio: 'ignore',
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA,
      CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
  for (let i = 0; i < 50; i++) { await wait(100); try { if ((await fetch('http://127.0.0.1:' + PORT + '/_cestis/health')).ok) break; } catch (e) {} }
  const base = 'http://127.0.0.1:' + PORT;
  const rootSrv = await serveRoot();
  const rootBase = 'http://127.0.0.1:' + rootSrv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  async function device(origin) {
    const ctx = await browser.newContext();          // its own storage: a separate device
    return {
      ctx,
      open: async rel => {
        const page = await ctx.newPage();
        await page.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(String(e.message)));
        page.on('request', r => requests.push(r.url()));
        await page.goto(origin + '/' + rel, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        return { page, errors, requests };
      }
    };
  }

  try {
    console.log('The offline dashboard boots on the Centre\'s server and finds it');
    const office = await device(base);
    const A = await office.open('index.html');
    ok(A.errors.length === 0, 'zero uncaught page errors — got: ' + A.errors.join(' | '));
    ok(await A.page.evaluate(() => typeof saveCollection === 'function' && typeof centreRollTally === 'function'),
      'saveCollection() and centreRollTally() exist (the old offline copy called both and defined neither)');
    ok(await A.page.evaluate(() => CESTISPageCloud.lan()), 'the page knows it is on the Centre\'s server');
    ok(await A.page.evaluate(() => CESTISPageCloud.status().some(s => s.file === 'CESTIS_LMS_Dashboard.json' && s.backend === 'offline-server')),
      'the dashboard registered its shared store there');
    ok(await A.page.evaluate(() => window.__cestisRtcIsOffline() && window.Peer !== window.__cestisPeerOriginal),
      'video calls are introduced by the Centre\'s server');
    ok(await A.page.evaluate(() => { try { reportProgrammeRolls(); return true; } catch (e) { return String(e); } }) === true,
      'the Reports roll no longer throws');

    console.log('A save on the office PC reaches the server and survives a reload');
    await A.page.evaluate(() => {
      announcements.push({ id: 'ANN-LAN-1', title: 'Saved on the LAN', body: 'x', date: '2026-10-20', author: 'Admin' });
      students.push({ id: 'STU-LAN-1', name: 'Lan Trainee One', course: 'Welding', stage: 'Training' },
                    { id: 'STU-LAN-2', name: 'Lan Trainee Two', course: 'Welding', stage: 'Training' });
      examResults.push({ id: 'RES-LAN-1', examId: 'EX-LAN', studentId: 'STU-LAN-1', studentName: 'Lan Trainee One', score: 80, submittedAt: new Date().toISOString() },
                       { id: 'RES-LAN-2', examId: 'EX-LAN', studentId: 'STU-LAN-2', studentName: 'Lan Trainee Two', score: 60, submittedAt: new Date().toISOString() });
      saveState();
    });
    await A.page.waitForTimeout(2500);
    ok(dashList('voctrain_announcements').some(a => a.id === 'ANN-LAN-1'), 'the announcement is in the Centre\'s data folder');
    ok(dashList('voctrain_examResults').filter(r => r.examId === 'EX-LAN').length === 2, 'and both exam results');
    const lanTrainees = () => dashList('voctrain_students').filter(s => /^Lan Trainee/.test(s.name)).length;
    ok(lanTrainees() === 2, 'and both trainees');
    await A.page.reload({ waitUntil: 'load' });
    await A.page.waitForTimeout(1500);
    ok(await A.page.evaluate(() => announcements.some(a => a.id === 'ANN-LAN-1')), 'after a reload the announcement is still there');

    console.log('Another device sees it, and adopts later saves without a reload');
    const lab = await device(base);
    const B = await lab.open('index.html');
    ok(await B.page.evaluate(() => announcements.some(a => a.id === 'ANN-LAN-1')), 'a second device has the announcement on opening');
    await A.page.evaluate(() => { announcements.push({ id: 'ANN-LAN-2', title: 'Second', body: 'y', date: '2026-10-20', author: 'Admin' }); saveState(); });
    await A.page.waitForTimeout(2200);
    await B.page.evaluate(() => CESTISPageCloud.loadNow());
    ok(await B.page.evaluate(() => announcements.some(a => a.id === 'ANN-LAN-2')),
      'its next refresh brings the new one into the page itself, not just storage');

    console.log('A trainee signs out on the second device');
    await B.page.evaluate(() => {
      var me = students.find(s => s.name === 'Lan Trainee One');
      currentRole = 'student'; currentStudent = me; currentLoggedInUser = { id: 'USR-LAN-1', username: 'lan1' };
      clearSensitiveStudentData();
    });
    ok(await B.page.evaluate(() => students.length) <= 1, 'the device keeps only that trainee (the sign-out\'s purpose)');
    await B.page.waitForTimeout(2500);
    ok(lanTrainees() === 2, 'the server still holds both trainees');
    ok(dashList('voctrain_examResults').filter(r => r.examId === 'EX-LAN').length === 2, 'and both results');

    console.log('The Cashbook and certificate gates accept the Centre\'s server');
    const C = await office.open('CESTIS.Cashbook.html');
    ok(C.errors.length === 0, 'the Cashbook loads clean — got: ' + C.errors.join(' | '));
    await C.page.evaluate(() => showMandatorySyncOverlay());
    await C.page.waitForTimeout(1500);
    ok(await C.page.evaluate(() => document.getElementById('mandatorySyncOverlay').classList.contains('hidden')),
      '"Sync Required" clears after a sync with the Centre\'s server (it used to wait for Google for ever)');
    ok(await A.page.evaluate(() => certSyncDone()), 'a certificate download counts as synced on the Centre\'s server');

    console.log('Online, none of it switches on');
    const online = await device(rootBase);
    const R = await online.open('index.html');
    ok(!(await R.page.evaluate(() => CESTISPageCloud.lan())), 'the online build is not on a Centre server');
    ok(await R.page.evaluate(() => typeof window.__cestisPeerOriginal === 'undefined'), 'PeerJS is left exactly as the library made it');
    ok(await R.page.evaluate(() => !CESTISPageCloud.status().some(s => s.file === 'CESTIS_LMS_Dashboard.json')),
      'the dashboard registers no shared store');
    ok(!(await R.page.evaluate(() => certSyncDone())), 'and the certificate gate still needs a cloud sync');
    ok(R.requests.filter(u => /\/_cestis\//.test(u)).every(u => /\/_cestis\/health$/.test(u)),
      'the only LAN request it made was the one health probe');
    const RC = await online.open('CESTIS.Cashbook.html');
    await RC.page.evaluate(() => showMandatorySyncOverlay());
    await RC.page.waitForTimeout(800);
    ok(!(await RC.page.evaluate(() => document.getElementById('mandatorySyncOverlay').classList.contains('hidden'))),
      'and the online Cashbook still insists on its Google sync');

    /* ---- The staff-only switch (trainee gate, Stage 6a) ---- */
    console.log('The staff-only switch, off: a trainee\'s device gets the token as it always has');
    const traineePc = await device(base);
    const TD = await traineePc.open('index.html');
    const TOKEN1 = (await (await fetch(base + '/_cestis/token')).json()).token;
    ok(await TD.page.evaluate(() => fetch('/_cestis/token').then(r => r.json()).then(d => d.token)) === TOKEN1,
      'with the switch off, any device on the network is given the token');
    // The Centre's records gain a staff login with a password of its own, and
    // a sign-in for the first LAN trainee — as the office's save would bring them.
    const nodeCrypto = require('crypto');
    const hashPw = (pw, salt) => 'pbkdf2$1000$' + salt + '$' + nodeCrypto.pbkdf2Sync(pw, Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex');
    const nowIso = new Date().toISOString();
    // (The dashboard has moved the LAN trainees onto their stable ids by now.)
    const ONE = require(path.join(ROOT, 'cestis-core.js')).stableStudentId({ name: 'Lan Trainee One', course: 'Welding' });
    const put = await fetch(base + '/_cestis/data/CESTIS_LMS_Dashboard.json', { method: 'PUT',
      headers: { 'X-CESTIS-Token': TOKEN1, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json',
        stamps: { voctrain_users: nowIso, voctrain_examResults: nowIso },
        data: { voctrain_examResults: JSON.stringify([{ id: 'RES-LAN-GATE', examId: 'EX-LAN', studentId: ONE, studentName: 'Lan Trainee One',
          score: 75, submittedAt: nowIso }]),
        voctrain_users: JSON.stringify([
          { id: 'USR-LAN-ADMIN', name: 'Lan Administrator', role: 'admin', username: 'lanadmin', email: 'lanadmin@centre.test', status: 'active',
            password: hashPw('Lan-Admin-Pass-1', '00112233445566778899aabbccddeeff'), updatedAt: nowIso },
          { id: 'USR-LAN-T1', name: 'Lan Trainee One', role: 'student', username: 'lan1', email: 'lan1@mail.test', status: 'active',
            programme: 'Welding', studentDataId: 'STU-LAN-1', password: hashPw('Lan-Trainee-Pass', 'a1b2c3d4e5f60718'), updatedAt: nowIso }]) } }) });
    ok(put.ok, 'the accounts reach the Centre\'s records');

    console.log('An administrator turns it on, with a password the server checks');
    const flip = (on, tok) => A.page.evaluate(([on, tok]) => fetch('/_cestis/staff-only', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CESTIS-Token': tok },
      body: JSON.stringify({ username: 'lanadmin', password: 'Lan-Admin-Pass-1', on }) }).then(r => r.json().then(j => ({ status: r.status, j }))), [on, tok]);
    const onR = await flip(true, TOKEN1);
    ok(onR.status === 200 && onR.j.on === true && onR.j.token && onR.j.token !== TOKEN1, 'switched on, and the token replaced');
    const TOKEN2 = onR.j.token;

    console.log('On: a trainee\'s device can get neither the token nor the records');
    const refused = await TD.page.evaluate(old => Promise.all([
      fetch('/_cestis/token').then(r => r.status),
      fetch('/_cestis/token', { method: 'POST', body: JSON.stringify({ username: 'lan1', password: 'Lan-Trainee-Pass' }) }).then(r => r.status),
      fetch('/_cestis/data', { headers: { 'X-CESTIS-Token': old } }).then(r => r.status),
      fetch('/_cestis/data/CESTIS_LMS_Dashboard.json', { headers: { 'X-CESTIS-Token': old } }).then(r => r.status),
      fetch('/_cestis/data/CESTIS_ALL_DATA.json').then(r => r.status)
    ]), TOKEN1);
    ok(JSON.stringify(refused) === '[403,403,401,401,401]',
      'GET /_cestis/token, a trainee\'s own password, and /_cestis/data/* with the old token or none are all refused — got ' + refused);
    // A device that first opens the system now (the one above already took a
    // copy while the switch was off — READ ME FIRST: kept until cleared).
    const freshPc = await device(base);
    const TD2 = await freshPc.open('index.html');
    ok(TD2.errors.length === 0, 'the dashboard still opens on a new device, with no page errors — got: ' + TD2.errors.join(' | '));
    await TD2.page.waitForTimeout(1500);
    const leaked = await TD2.page.evaluate(() => ['voctrain_users', 'voctrain_students', 'voctrain_examResults', 'voctrain_announcements']
      .filter(k => /lanadmin|Lan Trainee|ANN-LAN|RES-LAN/.test(String(CESTISStore.getItem(k) || ''))));
    ok(leaked.length === 0, 'and none of the Centre\'s records reach its storage — found in: ' + leaked.join(', '));

    console.log('On: the trainee signs in through the gate, in the browser, and gets only their own records');
    const viaGate = await TD2.page.evaluate(async () => {
      const enc = new TextEncoder();
      const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const hmac = async (keyText, msg) => hex(await crypto.subtle.sign('HMAC',
        await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(msg)));
      const post = b => fetch('/_cestis/gate', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(b) }).then(r => r.json());
      const login = 'lan1';
      const ch = await post({ op: 'auth.start', login });
      const base = await crypto.subtle.importKey('raw', enc.encode('Lan-Trainee-Pass'), 'PBKDF2', false, ['deriveBits']);
      const salt = new Uint8Array(ch.salt.match(/../g).map(h => parseInt(h, 16)));
      const V = hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ch.iter }, base, 256));
      const s = await post({ op: 'auth.password', login, nonce: ch.nonce, proof: await hmac(V, 'cestis-gate-v1|' + ch.nonce + '|' + login) });
      if (!s.ok) return { error: s.error };
      const p = await post({ op: 'pull', token: s.token });
      // A support message, sealed here as any trainee's device seals it.
      const item = { id: 'IT-BROWSER-1', a: s.accountId, sid: s.sid, kind: 'rec', key: 'voctrain_support_messages',
        rec: { id: 'SUP-BROWSER-1', subject: 'Hello', message: 'Sent through the gate', timestamp: Date.now() }, createdAt: new Date().toISOString() };
      item.mac = await hmac(s.sessionKey, CESTISCore.gate.canon(item));
      const d = await post({ op: 'deliver', items: [item] });
      return { stu: s.studentId, slice: JSON.stringify(p.slice || null), receipt: d.results && d.results[0] };
    });
    // The dashboard has moved both trainees onto their stable ids since they were added.
    const ME = dashList('voctrain_students').find(s => s.name === 'Lan Trainee One') || {};
    const OTHER = dashList('voctrain_students').find(s => s.name === 'Lan Trainee Two') || {};
    ok(!!ME.id && viaGate.stu === ME.id, 'signed in by a PBKDF2 proof the browser worked out itself, as the trainee record the Centre holds — ' +
      JSON.stringify(viaGate.error || [viaGate.stu, ME.id]));
    const mineRes = dashList('voctrain_examResults').filter(r => r.studentId === ME.id).map(r => r.id);
    // (Their first result still names the id they were added under; it is theirs either way.)
    const theirs = dashList('voctrain_examResults').filter(r => r.studentId !== ME.id && r.studentId !== 'STU-LAN-1').map(r => r.id);
    const notMine = [OTHER.id, 'STU-LAN-2', 'Lan Trainee Two', 'lanadmin', 'pbkdf2$'].concat(theirs).filter(x => x && viaGate.slice.indexOf(x) !== -1);
    ok(/Lan Trainee One/.test(viaGate.slice) && mineRes.length > 0 && mineRes.every(id => viaGate.slice.indexOf(id) !== -1) && notMine.length === 0,
      'the slice holds their own record and results (' + mineRes.join(', ') + ') and nothing of the other trainee\'s or the accounts\' — found: ' + notMine.join(', '));
    ok(viaGate.receipt && viaGate.receipt.ok === true, 'a support message sealed in the browser is accepted — ' + JSON.stringify(viaGate.receipt));
    ok(dashList('voctrain_support_messages').some(m => m.id === 'SUP-BROWSER-1' && m.studentId === ME.id && m.accountId === 'USR-LAN-T1'),
      'and is in the Centre\'s records, as theirs');

    console.log('On: staff sign-in is checked by the server, and gets the token');
    const staff = await A.page.evaluate(async () => {
      const r = await fetch('/_cestis/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'lanadmin', password: 'Lan-Admin-Pass-1' }) });
      const j = await r.json();
      const data = await fetch('/_cestis/data/CESTIS_LMS_Dashboard.json', { headers: { 'X-CESTIS-Token': j.token || '' } });
      const ticket = await fetch('/_cestis/host-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CESTIS-Token': j.token || '' },
        body: JSON.stringify({ username: 'lanadmin', password: 'Lan-Admin-Pass-1' }) });
      return { status: r.status, token: j.token, data: data.status, ticket: ticket.status };
    });
    ok(staff.status === 200 && staff.token === TOKEN2 && staff.data === 200, 'the administrator\'s sign-in gets the new token, which reads the records');
    ok(staff.ticket === 200, 'and can still be given a class host ticket');
    ok(await A.page.evaluate(() => fetch('/_cestis/health').then(r => r.json()).then(h => h.staffOnly === true)), 'the health answer says the records are for staff');

    console.log('Off again: as before, for every device');
    const offR = await flip(false, TOKEN2);
    ok(offR.status === 200 && offR.j.on === false && offR.j.token !== TOKEN2, 'switched off, the token replaced once more');
    ok(await TD2.page.evaluate(() => fetch('/_cestis/token').then(r => r.status)) === 200, 'the trainee\'s device is given the token again');
    ok(await A.page.evaluate(() => fetch('/_cestis/health').then(r => r.json()).then(h => !('staffOnly' in h))), 'the health answer is as before');
    await A.page.evaluate(() => { announcements.push({ id: 'ANN-LAN-3', title: 'After the switch', body: 'z', date: '2026-10-21', author: 'Admin' }); saveState(); });
    await A.page.waitForTimeout(3000);
    ok(dashList('voctrain_announcements').some(a => a.id === 'ANN-LAN-3'),
      'and the office PC, holding a token from before, fetches the new one by itself and its saves land again');
  } catch (e) {
    failed++;
    console.log(e && e.stack || e);
  } finally {
    await browser.close();
    rootSrv.close();
    server.kill();
    await wait(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
