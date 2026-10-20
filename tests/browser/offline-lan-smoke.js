/* The Offline System in a real browser, on its real server — and the online
   build beside it, to prove the LAN code is inert there.
     node tests/browser/offline-lan-smoke.js        (npm run test:browser:offline)

   What Node cannot show: the generated "Offline System/" pages boot on
   cestis-offline-server.js; the dashboard's saveState() really persists (its
   old copy called an undefined saveCollection and kept nothing); another
   device sees the save and adopts it into memory; a trainee's sign-out on one
   device leaves the Centre's records on the server; the Cashbook's
   "Cloud Sync Required" gate and the certificate download gate accept the
   Centre's server instead of waiting for Google for ever; video is pointed at
   the Centre's server. And on the online build: none of it switches on.

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
      '"Cloud Sync Required" clears after a sync with the Centre\'s server (it used to wait for Google for ever)');
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
