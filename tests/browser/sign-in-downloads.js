/* A staff sign-in downloads each distinct copy of the Centre's records once —
   in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/sign-in-downloads.js

   What went wrong (EF-3 in the efficiency audit): Sync Now on the sign-in
   screen read the five folder copies of the backup (byte for byte the same
   file) and the master, and the sign-in that followed read them all again,
   plus the Main copy a third time for the course recovery — 771 MB at a
   school year's size, 101 MB in the first month. Every copy is still looked
   at and merged record by record, newest winning; what changed is that a copy
   whose bytes (Drive's MD5 checksum) this device has already merged is not
   downloaded again.

   PC A (the office, gate-kit) fills the Centre's shared files (an in-memory
   stand-in, tests/browser/fake-drive.js); then on PC B, which holds nothing:
     1. Sync Now: the backup is downloaded once (the five copies are the same
        bytes), the master once; Sync Now again downloads neither;
     2. the sign-in that follows downloads no backup copy and no master again,
        and every trainee and account is on B;
     3. a copy that differs is still downloaded and merged: PC A changes a
        record and its Main copy moves; B's next Sync Now downloads that copy
        (and only that one) and has the change;
     4. a Drive that gives no checksum: every copy is downloaded, as before;
     5. the sign-in's sync run again on B with nothing changed anywhere and
        nothing unsent (as when the dashboard is opened afresh): its first save
        does not send the whole backup again.
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  let noMd5 = false;
  const log = [];
  const handle = drive.handle.bind(drive);
  drive.handle = async route => {
    const req = route.request(), url = new URL(req.url());
    const m = /\/files\/([^/?]+)/.exec(url.pathname), f = m && drive.files[m[1]];
    log.push({ t: Date.now(), method: req.method(), upload: /\/upload\//.test(url.pathname), media: url.searchParams.get('alt') === 'media', name: f ? f.name : '', id: f ? f.id : '' });
    if (!noMd5) return handle(route);
    // A Drive that describes files without a checksum.
    return handle({ request: () => req, fulfill: o => {
      if (o.body && /md5Checksum/.test(o.body)) { try { const j = JSON.parse(o.body); const strip = x => { if (x && typeof x === 'object') { delete x.md5Checksum; Object.values(x).forEach(strip); } }; strip(j); o = Object.assign({}, o, { body: JSON.stringify(j) }); } catch (e) {} }
      return route.fulfill(o);
    } });
  };
  const K = kit.make({ browser, base: srv.base, errors });
  const downloads = (since, name) => log.filter(e => e.t >= since && e.media && (!name || e.name === name));
  const BACKUP = 'CESTIS_LMS_BACKUP.json', MASTER = 'cestis-master-snapshot.json';
  async function syncNow(p) {
    await p.evaluate(() => { const l = document.getElementById('adminLogin'); if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    await p.evaluate(() => { const s = document.getElementById('loginSyncStatus'); if (s) s.textContent = ''; });
    await p.evaluate(() => loginPageSync());
    return p.waitForFunction(() => /complete/i.test((document.getElementById('loginSyncStatus') || {}).textContent || ''), null, { timeout: 120000, polling: 250 }).then(() => true, () => false);
  }
  async function signIn(p) {
    await p.evaluate(() => { const l = document.getElementById('adminLogin'); if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    await p.fill('#adminUser', kit.ADMIN.user); await p.fill('#adminPass', kit.ADMIN.pass); await p.press('#adminPass', 'Enter');
    await p.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'admin', null, { timeout: 60000 });
    // The sign-in's own sync has finished when the 5-second save starts.
    await p.waitForFunction(() => !!_autoSaveIntervalId, null, { timeout: 120000, polling: 250 });
  }
  try {
    // PC A: the office, with 40 extra trainees, uploads everything.
    const ctxA = await K.computer({ drive });
    const pageA = await K.adminSignedIn(ctxA, { label: 'A', extra: 40 });
    const tA = Date.now();
    while (Date.now() - tA < 60000) {
      await wait(2000);
      const r = await pageA.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.reason);
      const copies = Object.values(drive.files).filter(f => f.name === BACKUP).length;
      if (copies >= 5 && Object.values(drive.files).some(f => f.name === MASTER) && (r === 'nothing-new' || r === 'unchanged')) break;
    }
    const nCopies = Object.values(drive.files).filter(f => f.name === BACKUP).length;
    ok(nCopies === 5 && Object.values(drive.files).some(f => f.name === MASTER), 'PC A has written the five copies and the master');
    await ctxA.close();   // PC A is switched off: nothing else writes until step 3
    await wait(3000);     // (its last writes as the tab closes land first)

    // PC B: has signed in before (its token is kept) but holds nothing.
    const ctxB = await K.computer({ drive });
    const p = K.watch(await ctxB.newPage(), 'B');
    await p.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await p.evaluate(seed => { Object.keys(seed).forEach(k => CESTISStore.setItem(k, seed[k])); }, driveTokenSeed());
    // (With its token kept, the page starts a sync by itself as it loads;
    // Sync Now pressed meanwhile joins that run.)
    let t = Date.now();
    await p.reload({ waitUntil: 'load' });
    await wait(1500);

    const tSync0 = Date.now();
    console.log('1. Sync Now on PC B');
    ok(await syncNow(p), 'Sync Now completes');
    const d1 = downloads(t, BACKUP).length, m1 = downloads(t, MASTER).length;
    ok(d1 === 1, 'the backup is downloaded once, not five times (' + d1 + ')');
    ok(m1 === 1, 'the master once (' + m1 + ')');
    const people = await p.evaluate(() => ({ users: userAccounts.length, students: students.length }));
    ok(people.students >= 46, 'and PC B has the Centre\'s trainees (' + people.students + ')');
    t = Date.now();
    ok(await syncNow(p), 'Sync Now again');
    ok(downloads(t, BACKUP).length === 0 && downloads(t, MASTER).length === 0, 'downloads neither again (' + downloads(t, BACKUP).length + ', ' + downloads(t, MASTER).length + ')');

    console.log('2. The sign-in that follows');
    const dbg = async label => { if (!process.env.SIGNIN_DEBUG) return; const st = await p.evaluate(() => ({ merged: _mergedCopies, seq: _sessionSeq, wiped: _sessionWiped })); const ms = Object.values(drive.files).filter(f => f.name === MASTER).map(f => drive.meta(f).md5Checksum + ' v' + f.version); console.log('     [' + label + '] ' + JSON.stringify(st) + ' master ' + ms.join(',')); };
    await dbg('before sign-in');
    t = Date.now();
    await signIn(p);
    await dbg('after sign-in');
    const d2 = downloads(t, BACKUP).length, m2 = downloads(t, MASTER).length;
    // (PC B's own first save after the sign-in goes up once: the union of
    // what it pulled. Its own copies are not downloaded back.)
    const upB = log.filter(e => e.upload && e.t >= tSync0).map(e => e.id);
    ok(upB.length === new Set(upB).size, 'PC B\'s first save uploads each file at most once (' + upB.length + ' uploads)');
    ok(d2 === 0, 'no backup copy is downloaded again (' + d2 + ')');
    ok(m2 === 0, 'nor the master (' + m2 + ')');
    const after = await p.evaluate(() => ({ users: userAccounts.length, students: students.length }));
    ok(after.students === people.students && after.users >= people.users, 'every trainee and account is still on PC B (' + after.students + ', ' + after.users + ')');

    console.log('3. A copy that differs is still downloaded and merged');
    // Another device writes the Main copy: one trainee's phone number changed.
    t = Date.now();
    const mainFile = Object.values(drive.files).find(f => f.name === BACKUP && f.parents[0] === kit.MAIN_FOLDER);
    const body = JSON.parse(mainFile.content);
    const tr = body.data.students.find(x => x && x.name === 'Tameka Richards');
    tr.phone = '876-555-0199'; tr.lastModified = new Date(Date.now() + 1000).toISOString();
    drive.put(mainFile.id, null, JSON.stringify(body));
    let tM;
    await wait(8000);   // B's own 5-second save pulls the moved Main copy
    const tLoop = Date.now();
    const got = await p.evaluate(async () => {
      const ids = ALL_DRIVE_FOLDERS.map(f => f.id);
      for (const id of ids) await locateBackupCopy(id);
      const copies = ALL_DRIVE_FOLDERS.map(f => ({ folder: f, fileId: _autoSaveFileIds[f.id], modifiedTime: _backupFileModified[f.id] }));
      for (const c of CESTISCore.cloudMerge.oldestFirst(copies)) await silentMergeFromBackup(c.fileId, _backupFileMeta[c.folder.id]);
      const s = students.find(x => x && x.name === 'Tameka Richards');
      return s && s.phone;
    });
    const d3 = downloads(t, BACKUP), d3loop = downloads(tLoop, BACKUP);
    ok(got === '876-555-0199', 'PC B has PC A\'s change');
    ok(d3.length >= 1, 'the changed copy was downloaded (' + d3.length + ' download(s) while the two PCs exchanged it)');
    ok(d3loop.length <= 1, 'merging all five copies again then downloads at most the one that changed since (' + d3loop.length + ')');

    console.log('4. A Drive that gives no checksum');
    noMd5 = true;
    t = Date.now();
    const ok4 = await p.evaluate(async () => {
      for (const f of ALL_DRIVE_FOLDERS) await locateBackupCopy(f.id);
      let n = 0;
      for (const f of ALL_DRIVE_FOLDERS) { await silentMergeFromBackup(_autoSaveFileIds[f.id], _backupFileMeta[f.id]); if (_lastPull.ok) n++; }
      return n;
    });
    noMd5 = false;
    ok(ok4 === 5 && downloads(t, BACKUP).length === 5, 'every copy is downloaded and merged, as before (' + downloads(t, BACKUP).length + ')');

    console.log('5. The sign-in sync again, nothing changed anywhere and nothing unsent');
    // Let B's own saves settle first.
    tM = Date.now();
    while (Date.now() - tM < 60000) { await wait(2000); const r = await p.evaluate(() => _lastAutoSaveResult.reason); if (r === 'nothing-new' || r === 'unchanged') break; }
    // As a page opened afresh on this PC: nothing sent yet this session, and
    // the sign-in's sync runs again.
    t = Date.now();
    await p.evaluate(async () => { stopAutoSave(); _lastAutoSaveHash = null; _lastAutoSaveWriteMark = -1; await autoSyncOnLogin(); startAutoSave(); });
    await wait(12000);
    const ups = log.filter(e => e.t >= t && e.upload && e.name === BACKUP).length;
    const reason = await p.evaluate(() => _lastAutoSaveResult.reason);
    ok(ups === 0, 'its first save does not send the backup again (' + ups + ' uploads; ' + reason + ')');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
