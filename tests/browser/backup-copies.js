/* The backup's extra copies on their new schedule — in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/backup-copies.js

   EF-2: the Main copy goes up with every change; the four other folder
   copies, the per-person copy and the master go up together at most every
   30 minutes while the Main copy is ahead of them, and at sign-out
   (tests/backup-copy-cadence.test.js pins the rule). Here, with the Centre's
   shared files an in-memory stand-in (tests/browser/fake-drive.js):
     1. PC A (the office): a change uploads the Main copy alone — not the
        other folders, not the master, not the per-person copy;
     2. the extra copies 30 minutes stale (they hold an older phone number,
        the Main copy the newest): PC C, a new device, gets the newest at
        Sync Now and keeps it after the sign-in — the Main copy wins;
     3. an edit made just before sign-out on PC A reaches every copy;
     4. "Restore from master backup" on PC C brings back a trainee this
        device lost, from the master written on the new schedule.
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const BACKUP = 'CESTIS_LMS_BACKUP.json', MASTER = 'cestis-master-snapshot.json';

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const log = [];
  const handle = drive.handle.bind(drive);
  drive.handle = async route => {
    const req = route.request(), url = new URL(req.url());
    const m = /\/files\/([^/?]+)/.exec(url.pathname), f = m && drive.files[m[1]];
    log.push({ t: Date.now(), upload: /\/upload\//.test(url.pathname), name: f ? f.name : '', parent: f ? f.parents[0] : '' });
    return handle(route);
  };
  const K = kit.make({ browser, base: srv.base, errors });
  // The phone number each backup copy holds for Tameka, by folder.
  const phones = () => {
    const out = {};
    Object.values(drive.files).filter(f => f.name === BACKUP).forEach(f => {
      try { const s = JSON.parse(f.content).data.students.find(x => x && x.name === 'Tameka Richards'); out[f.parents[0]] = s && s.phone; } catch (e) {}
    });
    return out;
  };
  const mainPhone = () => phones()[kit.MAIN_FOLDER];
  const extraPhones = () => { const p = phones(); delete p[kit.MAIN_FOLDER]; return Object.values(p); };
  async function settle(page) {
    const t0 = Date.now(); let quiet = 0;
    while (Date.now() - t0 < 90000) {
      await wait(2600);
      const r = await page.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.reason);
      quiet = (r === 'nothing-new' || r === 'unchanged') ? quiet + 1 : 0;
      if (quiet >= 2) return true;
    }
    return false;
  }
  const setPhone = (page, v) => page.evaluate(v => { const s = students.find(x => x && x.name === 'Tameka Richards'); s.phone = v; s.lastModified = new Date().toISOString(); saveState(); }, v);
  try {
    const ctxA = await K.computer({ drive });
    const A = await K.adminSignedIn(ctxA, { label: 'A' });
    ok(await settle(A), 'PC A settles after its first saves');
    // Make the extra copies due now (as 30 minutes on), so they exist.
    await A.evaluate(() => { _copyState.writtenAt = 0; });
    await setPhone(A, '876-555-0001');
    await settle(A);
    ok(extraPhones().length === 4 && extraPhones().every(p => p === '876-555-0001') && mainPhone() === '876-555-0001', 'all five copies hold the first number (written together, 30 minutes on)');
    ok(Object.values(drive.files).some(f => f.name === MASTER), 'and the master');

    console.log('1. A change uploads the Main copy alone');
    let t = Date.now();
    await setPhone(A, '876-555-0002');
    await settle(A);
    const ups = log.filter(e => e.t >= t && e.upload);
    const backups = ups.filter(e => e.name === BACKUP);
    ok(backups.length === 1 && backups[0].parent === kit.MAIN_FOLDER, 'one backup upload, to the Main folder (' + backups.map(b => b.parent.slice(0, 6)).join(',') + ')');
    ok(!ups.some(e => e.name === MASTER || /^CESTIS_USER_/.test(e.name)), 'no master, no per-person copy (' + ups.map(e => e.name).join(', ') + ')');
    ok(mainPhone() === '876-555-0002' && extraPhones().every(p => p === '876-555-0001'), 'the Main copy has the new number; the other four the old one');

    console.log('2. A new device, with the extra copies stale');
    const ctxC = await K.computer({ drive });
    const C = K.watch(await ctxC.newPage(), 'C');
    await C.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await C.evaluate(seed => { Object.keys(seed).forEach(k => CESTISStore.setItem(k, seed[k])); }, driveTokenSeed());
    await C.reload({ waitUntil: 'load' });
    await wait(1500);
    await C.evaluate(() => { const l = document.getElementById('adminLogin'); if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    await C.evaluate(() => loginPageSync());
    await C.waitForFunction(() => /complete/i.test((document.getElementById('loginSyncStatus') || {}).textContent || ''), null, { timeout: 120000, polling: 250 });
    const cPhone = () => C.evaluate(() => { const s = students.find(x => x && x.name === 'Tameka Richards'); return s && s.phone; });
    ok(await cPhone() === '876-555-0002', 'Sync Now gives PC C the newest number (the Main copy wins over the stale copies)');
    await C.fill('#adminUser', kit.ADMIN.user); await C.fill('#adminPass', kit.ADMIN.pass); await C.press('#adminPass', 'Enter');
    await C.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'admin', null, { timeout: 60000 });
    await C.waitForFunction(() => !!_autoSaveIntervalId, null, { timeout: 120000, polling: 250 });
    ok(await cPhone() === '876-555-0002', 'and still has it after the sign-in\'s own sync');

    console.log('3. An edit just before sign-out');
    await setPhone(A, '876-555-0003');
    await A.evaluate(() => logout());
    t = Date.now();
    while (Date.now() - t < 60000 && !(mainPhone() === '876-555-0003' && extraPhones().every(p => p === '876-555-0003'))) await wait(500);
    ok(mainPhone() === '876-555-0003', 'the Main copy has it');
    ok(extraPhones().length === 4 && extraPhones().every(p => p === '876-555-0003'), 'and so do the four other folder copies (' + extraPhones().join(', ') + ')');

    console.log('4. Restore from master backup');
    await settle(C);
    const lost = await C.evaluate(() => {
      const before = students.length;
      // This device loses a trainee (no deletion recorded: a damaged store).
      students = students.filter(s => s.name !== 'Kemar Johnson');
      CESTISStore.setItem('voctrain_students', JSON.stringify(students));
      return { before, after: students.length };
    });
    ok(lost.after === lost.before - 1, 'PC C has lost a trainee');
    await C.evaluate(() => restoreFromMasterBackup());
    t = Date.now();
    let back = false;
    while (Date.now() - t < 30000 && !back) { await wait(500); back = await C.evaluate(() => students.some(s => s && s.name === 'Kemar Johnson')); }
    ok(back, 'restoring from the master backup brings the trainee back');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
