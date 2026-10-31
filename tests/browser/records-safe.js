/* Keeping the records safe for years — in a real browser (owner approved,
   group F; the operations audit's OPS-1, OPS-2, OPS-10):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/records-safe.js

   With the Centre's shared files an in-memory stand-in
   (tests/browser/fake-drive.js, with files.copy, the storage figure and a
   "storage full" mode):
     1. the week's backup is a COPY of the whole-Centre backup, made where it
        is kept (no upload), in a "Backups" folder beside the backup
        folders, with this system's mark; its folder is remembered in the
        Centre's settings;
     2. a second office PC the same week makes none;
     3. two copies made at the same moment: the newer goes to the trash;
     4. the newest 12 weeks are kept: older ones go to the trash — never
        deleted — and only this system's own files (a file without the mark,
        or of another name, is never touched);
     5. a copy that cannot be made: the PC uploads the whole-Centre backup it
        builds instead (checksum and counts);
     6. "Last backup: <date> (N days ago)" in the Administrator's sync panel,
        and the prompt from 7 days;
     7. "Restore from a weekly backup": a preview first, then add-only — a
        lost trainee comes back, a newer edit here stays, a trainee deleted
        on purpose stays deleted;
     8. the last manual Export is recorded;
     9. storage used and free; the warning from 80%;
    10. STORAGE FULL: an office PC's save is refused — it says "Storage is
        full — tell the administrator", keeps the work (through a reload and
        a sign-out), stops resending every 5 seconds, and sends it once there
        is room; the Administrator is told what to do;
    11. each staff computer's last save, carried with the backup; a computer
        silent for more than 7 days is flagged;
    12. the System health card: one line per concern, green/amber/red, each
        with what to do; the trainee sign-in bell at most once a day.
   The outside world is cut off. No page errors. No screen names where
   anything is kept. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { try { if (await fn()) return true; } catch (e) {} await wait(every || 400); } return false; }
const FORBIDDEN = /\b(google|drive|cloud|server|gmail|internet)\b/i;
const MASTER = 'cestis-master-snapshot.json', MASTER_FOLDER = '1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec';
const STAFF = { id: 'USR-dbrown', name: 'Donovan Brown', user: 'dbrown', pass: 'Office-Staff-2026!' };

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  // The Centre's folders, as they sit in its account: the backup folders share one parent.
  drive.files[MASTER_FOLDER] = { id: MASTER_FOLDER, name: 'Master Snapshot', mimeType: 'application/vnd.google-apps.folder', parents: ['CENTRE-ROOT'], createdTime: '2025-01-01T00:00:00.000Z', modifiedTime: '2025-01-01T00:00:00.000Z', version: 1, content: '' };
  const K = kit.make({ browser, base: srv.base, errors });
  const weekly = () => Object.values(drive.files).filter(f => /^CESTIS-backup-\d{4}-W\d{2}\.json$/.test(f.name));
  const live = list => list.filter(f => !f.trashed);
  const label = page => page.evaluate(n => CESTISCore.backups.isoWeek(CESTISCore.sync.now() - (n || 0) * 7 * 86400000).label, 0);
  const weekAgo = (page, n) => page.evaluate(n => CESTISCore.backups.isoWeek(CESTISCore.sync.now() - n * 7 * 86400000).label, n);
  const skipWeekly = () => { try { localStorage.setItem('cestisThisPc_weeklyBackups', JSON.stringify({ doneWeek: CESTISCore.backups.isoWeek(Date.now()).label })); } catch (e) {} };
  const runWeekly = page => page.evaluate(() => { localStorage.removeItem('cestisThisPc_weeklyBackups'); _weeklyRun.triedAt = 0; _weeklyRun.last = null; });
  const weeklyDone = page => until(() => page.evaluate(() => !!_weeklyRun.last && !_weeklyRun.busy), 60000, 300).then(async r => { await wait(200); return r; });
  const addStaff = async ({ STAFF }) => {
    const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
    users.push({ id: STAFF.id, name: STAFF.name, role: 'adminstaff', username: STAFF.user, email: 'dbrown@example.com', password: await hashPassword(STAFF.pass), status: 'active', updatedAt: new Date().toISOString() });
    CESTISStore.setItem('voctrain_users', JSON.stringify(users));
  };
  try {
    console.log('1. The week\'s backup: a copy of the whole-Centre backup, no upload');
    const ctxA = await K.computer({ drive });
    const A = await K.adminSignedIn(ctxA, { label: 'A', beforeSignIn: skipWeekly, mutate: addStaff, mutateArg: { STAFF } });
    await A.evaluate(() => saveMasterSnapshot('test', true));
    ok(Object.values(drive.files).some(f => f.name === MASTER), 'the whole-Centre backup exists');
    const wk = await label(A);
    const uploadsBefore = drive.calls;
    await runWeekly(A);
    ok(await weeklyDone(A), 'the week\'s run finished (' + JSON.stringify(await A.evaluate(() => _weeklyRun.last)) + ')');
    let w = live(weekly());
    const master = Object.values(drive.files).find(f => f.name === MASTER);
    const folder = Object.values(drive.files).find(f => f.name === 'Backups' && f.mimeType === 'application/vnd.google-apps.folder');
    ok(w.length === 1 && w[0].name === 'CESTIS-backup-' + wk + '.json', 'one file, named by its week: ' + (w[0] && w[0].name));
    ok(drive.copies === 1 && w[0].content === master.content, 'made by a copy where it is kept (no upload): the very bytes of the whole-Centre backup');
    ok(w[0].appProperties.cestisBackup === 'weekly' && w[0].appProperties.cestisWeek === wk, 'with this system\'s mark');
    ok(folder && folder.parents[0] === 'CENTRE-ROOT' && w[0].parents[0] === folder.id && folder.appProperties.cestisBackupsFolder === '1', 'in a "Backups" folder beside the backup folders');
    ok(await A.evaluate(id => systemSettings.backupsFolderId === id, folder && folder.id), 'its folder is remembered in the Centre\'s settings');
    const snap = JSON.parse(w[0].content);
    ok(snap.checksum && snap.counts && snap.store && snap.counts.voctrain_students === 6, 'the copy is the whole store, with its checksum and counts');

    console.log('2. A second office PC the same week makes none');
    const ctxB = await K.computer({ drive });
    const B = await K.adminSignedIn(ctxB, { label: 'B' });
    ok(await until(() => B.evaluate(wk => (JSON.parse(localStorage.getItem('cestisThisPc_weeklyBackups') || '{}').doneWeek === wk) && !_weeklyRun.busy, wk), 60000), 'PC B looks once, finds this week\'s, and notes it');
    ok(live(weekly()).length === 1 && drive.copies === 1, 'still one file this week; no second copy');

    console.log('3. Two copies made at the same moment');
    const dupId = 'dup-' + Date.now();
    drive.files[dupId] = Object.assign({}, w[0], { id: dupId, createdTime: new Date(Date.now() + 1000).toISOString(), appProperties: Object.assign({}, w[0].appProperties) });
    const countBefore = Object.keys(drive.files).length;
    await runWeekly(A); await weeklyDone(A);
    ok(drive.files[dupId] && drive.files[dupId].trashed === true && !drive.files[w[0].id].trashed, 'the newer goes to the trash; the first stays');
    ok(Object.keys(drive.files).length === countBefore, 'nothing deleted');

    console.log('4. The newest 12 weeks are kept; older ones go to the trash');
    for (let i = 1; i <= 14; i++) {
      const l = await weekAgo(A, i), id = 'old-' + i;
      drive.files[id] = { id, name: 'CESTIS-backup-' + l + '.json', mimeType: 'application/json', parents: [folder.id], createdTime: new Date(Date.now() - i * 7 * 86400000).toISOString(),
        modifiedTime: new Date(Date.now() - i * 7 * 86400000).toISOString(), version: 1, content: w[0].content, appProperties: { cestisBackup: 'weekly', cestisWeek: l } };
    }
    drive.files['hand-copy'] = { id: 'hand-copy', name: 'CESTIS-backup-2024-W01.json', mimeType: 'application/json', parents: [folder.id], createdTime: '2024-01-03T00:00:00.000Z', modifiedTime: '2024-01-03T00:00:00.000Z', version: 1, content: '{}' };
    drive.files['notes'] = { id: 'notes', name: 'Owner notes.json', mimeType: 'application/json', parents: [folder.id], createdTime: '2023-01-03T00:00:00.000Z', modifiedTime: '2023-01-03T00:00:00.000Z', version: 1, content: '{}', appProperties: { cestisBackup: 'weekly' } };
    const n0 = Object.keys(drive.files).length;
    await runWeekly(A); await weeklyDone(A);
    const binned = ['old-12', 'old-13', 'old-14'].every(id => drive.files[id].trashed === true);
    const kept = Array.from({ length: 11 }, (_, i) => 'old-' + (i + 1)).every(id => !drive.files[id].trashed);
    ok(binned && kept, 'this week and the 11 before it are kept; the three oldest go to the trash');
    ok(!drive.files['hand-copy'].trashed && !drive.files['notes'].trashed, 'a file without the mark, or of another name, is never touched');
    ok(Object.keys(drive.files).length === n0, 'nothing is deleted for good (' + n0 + ' files before and after)');
    ok(await A.evaluate(() => JSON.parse(localStorage.getItem('cestisThisPc_weeklyBackups')).count) === 12, 'this PC notes 12 weekly backups');

    console.log('5. A copy that cannot be made: the PC uploads its own whole-Centre backup');
    drive.copyBroken = true;
    live(weekly()).filter(f => f.name === 'CESTIS-backup-' + wk + '.json').forEach(f => { f.trashed = true; });
    await runWeekly(A); await weeklyDone(A);
    w = live(weekly()).filter(f => f.name === 'CESTIS-backup-' + wk + '.json');
    let up = null; try { up = JSON.parse(w[0].content); } catch (e) {}
    ok(w.length === 1 && up && up.event === 'weekly-backup' && up.checksum && up.counts && up.store, 'uploaded instead: the whole store, its checksum and counts (' + (up && up.event) + ')');
    ok(await A.evaluate(s => CESTISCore.verifySnapshot(s).ok, up), 'and its checksum checks');
    drive.copyBroken = false;

    console.log('6. "Last backup" in the Administrator\'s sync panel');
    await A.evaluate(() => { refreshSyncChip(); toggleSyncChipPanel(); });
    let line = await A.evaluate(() => ({ t: document.getElementById('syncChipBackupLine').textContent, box: !document.getElementById('syncChipBackup').hidden, p: document.getElementById('syncChipBackupPrompt').hidden, item: !document.getElementById('weeklyRestoreItem').hidden }));
    ok(line.box && /^Last backup: \w{3} \d{1,2} \w{3} \d{4} \(today\)$/.test(line.t) && line.p, 'shows "' + line.t + '", no prompt');
    ok(line.item, 'and "Restore from a Weekly Backup" in its menu');
    await A.evaluate(() => { const n = JSON.parse(localStorage.getItem('cestisThisPc_weeklyBackups')); n.last.at = Date.now() - 8 * 86400000; localStorage.setItem('cestisThisPc_weeklyBackups', JSON.stringify(n)); refreshSyncChip(); });
    line = await A.evaluate(() => ({ t: document.getElementById('syncChipBackupLine').textContent, p: document.getElementById('syncChipBackupPrompt').textContent, hid: document.getElementById('syncChipBackupPrompt').hidden }));
    ok(/\(8 days ago\)$/.test(line.t) && !line.hid && /^No backup for 8 days\. Sign in on an office computer and let it save/.test(line.p), 'at 8 days: "' + line.p + '"');
    ok(!FORBIDDEN.test(line.t + line.p), 'it names no place');
    await A.evaluate(() => closeSyncChipPanel());

    console.log('7. Restore from a weekly backup: a preview, then add-only');
    await A.evaluate(() => {
      // Lost: no deletion recorded (a damaged store).
      students = students.filter(s => s.name !== 'Kemar Johnson');
      // A newer edit here.
      const t = students.find(s => s.name === 'Tameka Richards'); t.phone = '876-555-0199'; t.lastModified = new Date().toISOString();
      // Deleted on purpose.
      const r = students.find(s => s.name === 'Rushane Grant');
      const ids = JSON.parse(CESTISStore.getItem('voctrain_deletedStudentIds') || '[]'); ids.push(r.id);
      const at = JSON.parse(CESTISStore.getItem('voctrain_deletedStudentAt') || '{}'); at[r.id] = new Date().toISOString();
      CESTISStore.setItem('voctrain_deletedStudentIds', JSON.stringify(ids)); CESTISStore.setItem('voctrain_deletedStudentAt', JSON.stringify(at));
      students = students.filter(s => s.id !== r.id);
      saveState();
    });
    const before = await A.evaluate(() => students.length);
    await A.evaluate(() => { window.__restoreRun = restoreFromWeeklyBackup(); });
    ok(await until(() => A.evaluate(() => !!document.querySelector('.cestis-form-overlay select')), 20000), 'pick a week');
    const opts = await A.evaluate(() => Array.from(document.querySelectorAll('.cestis-form-overlay select option')).map(o => o.textContent));
    ok(opts.length === 12 && /^Week \d+, \d{4} — made \w{3} \d+ \w{3} \d{4}$/.test(opts[0]), 'twelve weeks offered, newest first: "' + opts[0] + '"');
    await A.click('.cestis-form-overlay .cf-submit');
    ok(await until(() => A.evaluate(() => /Restore from week/.test((document.querySelector('.cestis-form-overlay h3') || {}).textContent || '')), 20000), 'the preview');
    const pv = await A.evaluate(() => ({ intro: document.querySelector('.cestis-form-overlay .cestis-form-intro').textContent, btn: document.querySelector('.cestis-form-overlay .cf-submit').textContent, n: students.length }));
    ok(/adds back \d+ records? this computer no longer has/.test(pv.intro) && /• 1 trainee\b/.test(pv.intro), 'counts first: "' + pv.intro.split('\n').filter(Boolean).slice(1, 3).join(' / ') + '"');
    ok(/Nothing here is changed or removed/.test(pv.intro) && /^Add \d+ records?$/.test(pv.btn), 'says nothing here is changed; "' + pv.btn + '"');
    ok(pv.n === before, 'nothing written yet');
    ok(!FORBIDDEN.test(pv.intro + opts.join(' ')), 'it names no place');
    await A.click('.cestis-form-overlay .cf-submit');
    await A.evaluate(() => window.__restoreRun);
    const after = await A.evaluate(() => ({ kemar: students.some(s => s.name === 'Kemar Johnson'), phone: (students.find(s => s.name === 'Tameka Richards') || {}).phone, rushane: students.some(s => s.name === 'Rushane Grant') }));
    ok(after.kemar, 'the lost trainee is back');
    ok(after.phone === '876-555-0199', 'the newer edit here is kept (' + after.phone + ')');
    ok(!after.rushane, 'the trainee deleted on purpose stays deleted');

    console.log('8. The last manual Export is recorded');
    const dl = A.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await A.evaluate(() => exportDataBackup());
    ok(!!(await dl), 'the file is downloaded');
    ok(await A.evaluate(() => !!(systemSettings.lastExport && Date.now() - Date.parse(systemSettings.lastExport.at) < 60000)), 'its date is kept in the Centre\'s settings');

    console.log('9. Storage used and free; the warning from 80%');
    drive.quota = { limit: 15 * 1073741824, usage: 12.5 * 1073741824, usageInDriveTrash: 1.2 * 1073741824 };
    await A.evaluate(() => cestisStorageRefresh(true));
    await A.evaluate(() => { showPage('dashboard'); renderSystemHealthCard(); });
    let card = await A.evaluate(() => { const l = document.querySelector('#systemHealthCard [data-key="storage"]'); return l && { cls: l.className, t: l.textContent }; });
    ok(card && /tone-warn/.test(card.cls) && /12\.5 GB used of 15\.0 GB \(2\.50 GB free, 83% full\)/.test(card.t), 'the System health card: "' + (card && card.t.slice(0, 90)) + '"');
    ok(card && /Clear out old class recordings, or empty the trash\./.test(card.t), 'with the suggestion');
    await A.evaluate(() => { refreshSyncChip(); });
    const sl = await A.evaluate(() => { const e = document.getElementById('syncChipStorageLine'); return { hid: e.hidden, t: e.textContent }; });
    ok(!sl.hid && /83% full/.test(sl.t) && /Clear out old class recordings/.test(sl.t), 'and in the sync panel');
    drive.quota = { limit: 15 * 1073741824, usage: 4 * 1073741824 };
    await A.evaluate(() => cestisStorageRefresh(true));

    console.log('10. Storage full: an office PC keeps its work');
    // Donovan, admin staff, on his own PC.
    const ctxS = await K.computer({ drive });
    const S = K.watch(await ctxS.newPage(), 'S');
    await S.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await S.evaluate(seed => { Object.keys(seed).forEach(k => CESTISStore.setItem(k, seed[k])); }, require('./fake-drive').driveTokenSeed());
    await S.reload({ waitUntil: 'load' });
    await wait(1500);
    const staffSignIn = async () => {
      await S.evaluate(() => { const l = document.getElementById('adminStaffLogin'); if (!l.classList.contains('active')) document.querySelector('#adminStaffCard .role-enter-btn').click(); });
      await S.evaluate(() => loginPageSync()).catch(() => {});
      await S.waitForFunction(() => /complete/i.test((document.getElementById('loginSyncStatus') || {}).textContent || '') || typeof loginSyncCompleted !== 'undefined' && loginSyncCompleted, null, { timeout: 120000, polling: 250 });
      await S.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById('adminStaffLogin'); if (!l.classList.contains('active')) document.querySelector('#adminStaffCard .role-enter-btn').click(); });
      await S.fill('#adminStaffUser', STAFF.user); await S.fill('#adminStaffPass', STAFF.pass); await S.press('#adminStaffPass', 'Enter');
      await S.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'adminstaff', null, { timeout: 60000 });
      await S.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); if (!isCloudConnected || !googleAccessToken) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); } if (!_autoSaveIntervalId) startAutoSave(); });
      await until(() => S.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.uploaded), 90000);
    };
    await staffSignIn();
    ok(await S.evaluate(() => currentRole === 'adminstaff'), 'Donovan is signed in on his PC');
    drive.full = true;
    const refused0 = drive.refused;
    await S.evaluate(() => { const t = students.find(s => s.name === 'Shanique Campbell'); t.phone = '876-555-0777'; t.lastModified = new Date().toISOString(); saveState(); });
    ok(await until(() => S.evaluate(() => cestisStorageIsFull()), 30000), 'his save is refused: the account is full');
    await S.evaluate(() => refreshSyncChip());
    const chip = await S.evaluate(() => ({ label: document.getElementById('syncChipLabel').textContent, state: document.getElementById('syncChip').dataset.state, title: document.getElementById('syncChipPanelTitle').textContent,
      advice: document.getElementById('syncChipPanelAdvice').textContent }));
    ok(chip.state === 'storage-full' && chip.label === 'Storage is full' && chip.title === 'Storage is full — tell the administrator', 'the chip says "' + chip.title + '" (not "Sync needs attention")');
    ok(/Tell the administrator that storage is full/.test(chip.advice) && !FORBIDDEN.test(chip.title + chip.advice), 'what to do, naming no place');
    const keptHere = () => S.evaluate(() => ({ inStore: (JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').find(s => s.name === 'Shanique Campbell') || {}).phone, marker: !!CESTISStore.getItem('cestisPendingUpload') }));
    let k1 = await keptHere();
    ok(k1.inStore === '876-555-0777' && k1.marker, 'the change is kept on his PC, marked "not yet sent"');
    const mainPhone = () => { const f = Object.values(drive.files).find(f => f.name === 'CESTIS_LMS_BACKUP.json' && f.parents[0] === kit.MAIN_FOLDER); try { return JSON.parse(f.content).data.students.find(s => s.name === 'Shanique Campbell').phone; } catch (e) { return null; } };
    ok(mainPhone() !== '876-555-0777', 'and not in the shared copy');
    await wait(3000);
    const r1 = drive.refused, t1 = Date.now(); await wait(20000);
    const late = (drive.refusedLog || []).filter(e => e.at >= t1).map(e => e.what);
    ok(late.filter(x => /CESTIS_LMS_BACKUP/.test(x)).length === 0 && drive.refused - r1 <= 1, 'it does not resend the backup every 5 seconds (' + (drive.refused - r1) + ' refused in 20 s' + (late.length ? ': ' + late.join(', ') : '') + '; ' + (r1 - refused0) + ' at first)');
    await S.reload({ waitUntil: 'load' }); await wait(2500);
    k1 = await keptHere();
    ok(k1.inStore === '876-555-0777' && k1.marker, 'a reload: still kept, still marked');
    // The Administrator, on hers.
    await A.evaluate(() => { const t = students.find(s => s.name === 'Odalys Facey'); t.phone = '876-555-0888'; t.lastModified = new Date().toISOString(); saveState(); });
    ok(await until(() => A.evaluate(() => cestisStorageIsFull()), 30000), 'the Administrator\'s save is refused too');
    await A.evaluate(() => { refreshSyncChip(); renderSystemHealthCard(); });
    const ac = await A.evaluate(() => ({ title: document.getElementById('syncChipPanelTitle').textContent, advice: document.getElementById('syncChipPanelAdvice').textContent,
      card: (document.querySelector('#systemHealthCard [data-key="storage"]') || {}).className }));
    ok(ac.title === 'Storage is full — make room to keep saving' && /Clear out old class recordings, or empty the trash/.test(ac.advice), 'she is told what to do: "' + ac.title + '"');
    ok(/tone-bad/.test(ac.card || ''), 'and the health card\'s storage line is red');
    // Room again.
    drive.full = false;
    drive.quota = { limit: 15 * 1073741824, usage: 9 * 1073741824 };
    await A.evaluate(() => cestisStorageRefresh(true));
    const roomA = await until(() => A.evaluate(() => !cestisStorageIsFull()), 60000);
    ok(roomA, 'room again (the storage figure shows it): the Administrator\'s PC sends at once' +
      (roomA ? '' : ' — ' + JSON.stringify(await A.evaluate(() => ({ r: _lastAutoSaveResult, f: _storageFull, busy: _isAutoSaving, tick: !!_autoSaveIntervalId, conn: isCloudConnected, pull: _lastPull })))));
    // Donovan was signed out by the reload's session check, or is still in; either way his work goes up.
    const sIn = await S.evaluate(() => currentRole === 'adminstaff');
    if (!sIn) await staffSignIn();
    else await S.evaluate(() => { if (_storageFull) _storageFull.at = 0; });
    ok(await until(() => mainPhone() === '876-555-0777', 180000, 1000), 'and Donovan\'s change reaches the shared copy');
    ok(await until(() => S.evaluate(() => !CESTISStore.getItem('cestisPendingUpload') && !cestisStorageIsFull()), 60000), 'his PC: nothing waiting; the chip clears');

    console.log('11. Each staff computer\'s last save');
    await A.evaluate(() => { const t = students.find(s => s.name === 'Tameka Richards'); t.notes = 'checked'; t.lastModified = new Date().toISOString(); saveState(); });
    ok(await until(() => A.evaluate(() => Object.keys(JSON.parse(CESTISStore.getItem('voctrain_deviceSaves') || '{}')).length >= 2), 90000), 'the Administrator\'s PC knows two staff computers\' last saves');
    const ds = await A.evaluate(() => CESTISCore.backups.devices(JSON.parse(CESTISStore.getItem('voctrain_deviceSaves')), Date.now()));
    ok(ds.some(d => d.name === 'Donovan Brown' && d.role === 'adminstaff') && ds.some(d => d.name === 'Marcia Thompson'), 'by name: ' + ds.map(d => d.name + ' (' + d.ago + ')').join(', '));
    const mainSaves = (() => { try { return JSON.parse(Object.values(drive.files).find(f => f.name === 'CESTIS_LMS_BACKUP.json' && f.parents[0] === kit.MAIN_FOLDER).content).data.deviceSaves || {}; } catch (e) { return {}; } })();
    ok(JSON.stringify(mainSaves).indexOf('Donovan Brown') !== -1, 'carried with the backup');
    await A.evaluate(() => { const m = JSON.parse(CESTISStore.getItem('voctrain_deviceSaves')); Object.keys(m).forEach(k => { if (m[k].name === 'Donovan Brown') m[k].at = new Date(Date.now() - 9 * 86400000).toISOString(); }); CESTISStore.setItem('voctrain_deviceSaves', JSON.stringify(m)); renderSystemHealthCard(); });
    const dl2 = await A.evaluate(() => { const l = document.querySelector('#systemHealthCard [data-key="devices"]'); return { cls: l.className, t: l.textContent }; });
    ok(/tone-warn/.test(dl2.cls) && /1 silent for more than 7 days/.test(dl2.t) && /Donovan Brown · [^—]+ — last save 9 days ago \(silent for more than 7 days\)/.test(dl2.t), 'a computer silent for 9 days is flagged, by name');

    console.log('12. The System health card and the trainee sign-in bell');
    const lines = await A.evaluate(() => Array.from(document.querySelectorAll('#systemHealthCard .sys-health-line')).map(l => ({ key: l.dataset.key, tone: (l.className.match(/tone-(\w+)/) || [])[1], todo: (l.querySelector('.sys-health-todo') || {}).textContent || '' })));
    ok(lines.map(l => l.key).join(',') === 'weekly,master,gate,storage,devices,export', 'six lines: ' + lines.map(l => l.key + ':' + l.tone).join(' '));
    ok(lines.every(l => /^What to do: \S/.test(l.todo)), 'each with what to do');
    const cardText = await A.evaluate(() => document.getElementById('systemHealthCard').textContent);
    ok(!FORBIDDEN.test(cardText), 'the card names no place');
    await A.evaluate(GATE => {
      systemSettings.traineeGate = { url: GATE, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' };
      const st = gatePublishedState(gateDevRead('cestisGatePublished', null));
      st.health = { ok: false, reason: 'no-answer', url: GATE, at: new Date().toISOString() };
      gateDevWrite('cestisGatePublished', st);
      renderSystemHealthCard(); renderSystemHealthCard(); renderSystemHealthCard();
    }, 'https://script.google.com/macros/s/FAKE/exec');
    const bell = await A.evaluate(() => notifications.filter(n => /^NOTIF-syshealth-gate-/.test(n.id)).map(n => ({ text: n.text, roles: n.forRoles })));
    ok(bell.length === 1 && bell[0].roles.join() === 'admin' && /^Trainee sign-in: Needs attention: the address did not answer/.test(bell[0].text), 'the bell, once (three renders): "' + (bell[0] && bell[0].text.slice(0, 70)) + '…"');
    const gl = await A.evaluate(() => { const l = document.querySelector('#systemHealthCard [data-key="gate"]'); return { cls: l.className, t: l.textContent }; });
    ok(/tone-bad/.test(gl.cls) && /press Check/.test(gl.t), 'the trainee sign-in line: red, "press Check"');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
