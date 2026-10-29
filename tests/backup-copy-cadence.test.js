/* The backup's extra copies: the Main copy with every change, the others at
   most every 30 minutes, at sign-out, and at once while the Main copy cannot
   be written.

   What went wrong (EF-2 in the efficiency audit): every change uploaded the
   whole backup seven times — the Main copy, the same bytes into four more
   folders (Online Exams, LMS Chat, Class Recording, Assignments), a
   per-person near-copy and the master snapshot: 37 MB per change in the
   first month, 309 MB at a school year's size. Only the Main copy is read
   after every change; the others are read at Sync Now and sign-in (merged
   oldest first, so the Main copy wins), and by the recovery and restore paths.

   Pinned here (CESTISCore.copyCadence, and the page's own autosave run
   against stand-ins, both builds):
     - a change: the Main copy only;
     - 30 minutes on, with the Main copy ahead: the extra copies, the same
       payload as the Main copy, the per-person copy and the master;
     - 30 minutes on with nothing new since: they still go up once if behind;
     - an edit made just before sign-out reaches the extra copies;
     - the Main copy failing: the extra copies in the same tick, then at most
       every 5 minutes while it keeps failing; a write lost to another device
       that could not be recovered: the same;
     - the side files: the assignments file and the signed-in person's
       account record only when they changed.
   In a real browser: tests/browser/backup-copies.js.

   Run: node tests/backup-copy-cadence.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'), core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const MIN = 60000;

(async () => {
for (const page of PAGES) {
  const w = page.where, C = page.core, CC = C.copyCadence;

  console.log('The rule (' + w + ')');
  {
    const t0 = 1e12;
    let s = { writtenAt: t0, behind: false, mainFailAt: 0 };
    assertEq(CC.due(s, { now: t0 + MIN, mainOk: true }), { write: false, why: 'not-yet' }, w + ': a change a minute in: the Main copy only');
    s = CC.after(s, { now: t0 + MIN, mainOk: true, wrote: false });
    assert(s.behind === true, w + ': and the extra copies are now behind');
    assertEq(CC.due(s, { now: t0 + 29 * MIN, mainOk: true }).write, false, w + ': still not at 29 minutes');
    assertEq(CC.due(s, { now: t0 + 30 * MIN, mainOk: true }), { write: true, why: 'periodic' }, w + ': at 30 minutes, with a change');
    assertEq(CC.due(s, { now: t0 + 31 * MIN, mainOk: null }), { write: true, why: 'periodic' }, w + ': or with nothing new, as long as they are behind');
    s = CC.after(s, { now: t0 + 31 * MIN, mainOk: null, wrote: true, why: 'periodic' });
    assertEq([s.behind, s.writtenAt], [false, t0 + 31 * MIN], w + ': written: up to date, the clock restarts');
    assertEq(CC.due(s, { now: t0 + 90 * MIN, mainOk: null }), { write: false, why: 'up-to-date' }, w + ': nothing to write while nothing changed');
    assertEq(CC.due(s, { now: t0 + 32 * MIN, mainOk: null, flush: true }), { write: false, why: 'up-to-date' }, w + ': a sign-out with them up to date writes nothing');
    s = CC.after(s, { now: t0 + 33 * MIN, mainOk: true, wrote: false });
    assertEq(CC.due(s, { now: t0 + 34 * MIN, mainOk: null, flush: true }), { write: true, why: 'sign-out' }, w + ': a sign-out with them behind writes them');
    // The Main copy failing.
    let f = { writtenAt: t0, behind: false, mainFailAt: 0 };
    assertEq(CC.due(f, { now: t0 + MIN, mainOk: false }), { write: true, why: 'main-failed' }, w + ': the Main copy failing: the extra copies at once');
    f = CC.after(f, { now: t0 + MIN, mainOk: false, wrote: true, why: 'main-failed' });
    assertEq(CC.due(f, { now: t0 + 3 * MIN, mainOk: false }).write, false, w + ': then not again within 5 minutes');
    assertEq(CC.due(f, { now: t0 + 6 * MIN, mainOk: false }), { write: true, why: 'main-failed' }, w + ': and again after 5');
    const g = CC.after({ writtenAt: t0, behind: false, mainFailAt: 0 }, { now: t0 + MIN, mainOk: false, wrote: false, why: 'main-failed' });
    assertEq(CC.due(g, { now: t0 + 2 * MIN, mainOk: false }).write, false, w + ': a failed attempt counts too (no hammering)');
    assertEq(CC.due({ writtenAt: t0, behind: false, mainFailAt: 0 }, { now: t0 + MIN, mainOk: true, urgent: true }), { write: true, why: 'urgent' }, w + ': a lost write that could not be recovered: at once');
    assertEq([CC.EVERY_MS, CC.MAIN_DOWN_EVERY_MS], [30 * MIN, 5 * MIN], w + ': 30 minutes; 5 while the Main copy fails');
  }

  console.log('The page\'s 5-second save (' + w + ')');
  const names = ['autoSaveToAllFolders', 'cestisBookkeeping', 'cestisMarkUploaded', 'cestisMarkPendingUpload', 'cestisHashString', 'cestisMaybeWriteExtraCopies'];
  const src = names.map(n => extractFunction(page.src, n, w)).join('\n') +
    '\nvar _copyState = { writtenAt: Date.now(), behind: false, mainFailAt: 0 }, _copiesFlushRequested = false, _copiesUrgent = false;';
  const FOLDERS = [{ id: 'MAIN', label: 'Main Backup' }, { id: 'EXAMS', label: 'Online Exams' }, { id: 'CHAT', label: 'LMS Chat' }, { id: 'REC', label: 'Class Recording' }, { id: 'ASG', label: 'Assignments' }];
  function world() {
    const data = {};
    const store = { writes: 0, uncounted: {}, getItem: k => (k in data ? data[k] : null), setItem(k, v) { store.writes++; data[k] = String(v); }, removeItem(k) { store.writes++; delete data[k]; }, isReady: () => true };
    const ups = []; const other = { perUser: 0, master: 0 };
    const ctx = {
      console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, Date, Math, Promise, Blob, Error,
      CESTISCore: C, CESTISStore: store, window: { CESTISStore: store },
      isCloudConnected: true, googleAccessToken: 'tok', _isAutoSaving: false, _sessionWiped: false, currentRole: 'admin', currentLoggedInUser: null,
      _lastPull: { ok: true }, _lastAutoSaveHash: null, _lastAutoSaveWriteMark: -1, _lastAutoSaveResult: {}, _consecutiveCloudSaveFailures: 0,
      GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'MAIN' }, ALL_DRIVE_FOLDERS: FOLDERS,
      userAccounts: [], students: [{ id: 'S1', name: 'Tameka', phone: 'v0' }], exams: [], announcements: [], attendanceRecords: [], attnLoadedQuarter: null, attendanceRegister: [],
      vcSessions: [], calendarEvents: [], examResults: [], examAttempts: [], examRegisters: [], lmsChatRooms: [], lmsChatMessages: {}, lmsChatProfiles: {},
      lmsChatFollows: {}, lmsChatFollowLog: {}, classSessions: [], adminMeetings: [], instructorAssignments: [], assignmentSubmissions: [], instructorResources: [],
      studentProfiles: {}, instructorProfiles: {}, instructorData: [], systemSettings: {}, supportMessages: [], notifications: [], certDownloadApprovals: [],
      certTemplateCourseMap: {}, syncTombstones: {}, driveResources: [], skillAreas: [], adminStaffAccessSettings: {}, adrTasks: [], adrStaffMeta: {},
      documentHubFiles: [], certTemplates: {},
      safeJsonParse: (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
      stripSecretFields: (k, v) => v, carryForwardCloudAdminSlices() {}, getCurrentCloudUser: () => ({ username: 'admin' }),
      updateLastSyncDisplay() {}, updateLastSavedByDisplay() {}, showToast() {}, examOutboxRead: () => [], examOutboxConfirm() {},
      pullMainIfRemoteNewer: async () => false, pullAllowsUpload: () => true, mainMovedSincePull: async () => false,
      lmsChatSyncToDrive: async () => true, syncUserLoginFolderToDrive: async () => true, saveAssignmentsToDrive: async () => true,
      savePerUserBackup: async () => { other.perUser++; }, saveMasterSnapshot: async () => { other.master++; return { ok: true }; },
      failMain: false,
      silentSaveToFolder: async (folderId, label, blob) => {
        if (folderId === 'MAIN' && ctx.failMain) return false;
        ups.push({ folderId, text: await blob.text() });
        return true;
      },
      saveState() { store.setItem('voctrain_students', JSON.stringify(ctx.students)); ctx.cestisMarkPendingUpload(); }
    };
    vm.createContext(ctx); vm.runInContext(src, ctx);
    const edit = v => { ctx.students[0].phone = v; ctx.saveState(); };
    const phoneIn = u => JSON.parse(u.text).data.students[0].phone;
    const at = id => ups.filter(u => u.folderId === id);
    const backdate = ms => vm.runInContext('_copyState.writtenAt -= ' + ms + '; _copyState.mainFailAt -= ' + ms + ';', ctx);
    return { ctx, ups, other, edit, phoneIn, at, backdate, state: () => vm.runInContext('JSON.stringify(_copyState)', ctx) };
  }

  // A change: the Main copy only. 30 minutes on: the rest, the same payload.
  {
    const t = world();
    t.edit('v1'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.map(u => u.folderId), ['MAIN'], w + ': a change goes to the Main copy only');
    assertEq([t.other.perUser, t.other.master], [0, 0], w + ': not to the per-person copy or the master');
    t.edit('v2'); await t.ctx.autoSaveToAllFolders();
    t.edit('v3'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.map(u => u.folderId), ['MAIN', 'MAIN', 'MAIN'], w + ': nor do the next ones');
    t.backdate(30 * MIN);
    t.edit('v4'); await t.ctx.autoSaveToAllFolders();
    const last = t.ups.slice(-5);
    assertEq(last.map(u => u.folderId).sort(), ['ASG', 'CHAT', 'EXAMS', 'MAIN', 'REC'], w + ': 30 minutes on, a change goes to all five folders');
    assert(last.every(u => u.text === last[0].text) && t.phoneIn(last[0]) === 'v4', w + ': with the same payload as the Main copy, and the change in it');
    assertEq([t.other.perUser, t.other.master], [1, 1], w + ': and the per-person copy and the master are written');
    const n = t.ups.length;
    for (let i = 0; i < 4; i++) await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.length - n, 0, w + ': then quiet again');
    // Behind, and 30 minutes up, with nothing new: they go up once.
    t.edit('v5'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.slice(n).map(u => u.folderId), ['MAIN'], w + ': (a change: the Main copy)');
    t.backdate(31 * MIN);
    await t.ctx.autoSaveToAllFolders();
    const extra = t.ups.slice(n + 1);
    assertEq(extra.map(u => u.folderId).sort(), ['ASG', 'CHAT', 'EXAMS', 'REC'], w + ': 30 minutes on with nothing new, the four folders get what the Main copy holds');
    assert(extra.every(u => t.phoneIn(u) === 'v5'), w + ': (the latest)');
    const m = t.ups.length;
    for (let i = 0; i < 4; i++) await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.length - m, 0, w + ': once');
  }

  // An edit made just before sign-out reaches the extra copies.
  {
    const t = world();
    t.edit('v1'); await t.ctx.autoSaveToAllFolders();
    t.edit('signing-out');
    vm.runInContext('_copiesFlushRequested = true', t.ctx);
    await t.ctx.autoSaveToAllFolders();
    vm.runInContext('_copiesFlushRequested = false', t.ctx);
    const got = {};
    t.ups.forEach(u => { got[u.folderId] = t.phoneIn(u); });
    assertEq(got, { MAIN: 'signing-out', EXAMS: 'signing-out', CHAT: 'signing-out', REC: 'signing-out', ASG: 'signing-out' }, w + ': an edit just before sign-out is in every copy');
    // Signing out with nothing new, but the copies behind: written too.
    const t2 = world();
    t2.edit('v1'); await t2.ctx.autoSaveToAllFolders();
    for (let i = 0; i < 2; i++) await t2.ctx.autoSaveToAllFolders();
    vm.runInContext('_copiesFlushRequested = true', t2.ctx);
    await t2.ctx.autoSaveToAllFolders();
    assertEq(t2.at('EXAMS').map(t2.phoneIn), ['v1'], w + ': nothing new at sign-out, but the copies behind: written');
    // Up to date at sign-out: nothing.
    const n2 = t2.ups.length;
    await t2.ctx.autoSaveToAllFolders();
    assertEq(t2.ups.length - n2, 0, w + ': and a second sign-out save writes nothing more');
  }

  // The Main copy failing.
  {
    const t = world();
    t.edit('v1'); await t.ctx.autoSaveToAllFolders();
    t.ctx.failMain = true;
    t.edit('v2'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.slice(1).map(u => u.folderId).sort(), ['ASG', 'CHAT', 'EXAMS', 'REC'], w + ': the Main copy failing: the change goes to the other folders in the same tick');
    assert(t.ups.slice(1).every(u => t.phoneIn(u) === 'v2'), w + ': with the change');
    assertEq(t.ctx._lastAutoSaveResult.uploaded, true, w + ': and counts as having reached the shared copies');
    const n = t.ups.length;
    t.edit('v3'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.length - n, 0, w + ': a change a moment later: not again within 5 minutes');
    assertEq(t.ctx._lastAutoSaveResult.uploaded, false, w + ': (so it is tried again every tick)');
    t.backdate(5 * MIN);
    await t.ctx.autoSaveToAllFolders();
    assert(t.ups.slice(n).length === 4 && t.ups.slice(n).every(u => t.phoneIn(u) === 'v3'), w + ': after 5 minutes the change reaches them');
    t.ctx.failMain = false;
    t.edit('v4'); await t.ctx.autoSaveToAllFolders();
    assertEq(t.ups.slice(-1).map(u => [u.folderId, t.phoneIn(u)]), [['MAIN', 'v4']], w + ': the Main copy back: changes go to it alone again');
    // A write lost to another device's that could not be recovered.
    const t3 = world();
    t3.edit('v1'); await t3.ctx.autoSaveToAllFolders();
    vm.runInContext('_copiesUrgent = true', t3.ctx);
    t3.edit('v2'); await t3.ctx.autoSaveToAllFolders();
    assertEq(t3.ups.slice(1).map(u => u.folderId).sort(), ['ASG', 'CHAT', 'EXAMS', 'MAIN', 'REC'], w + ': a lost write that could not be recovered: the extra copies at once');
    assertEq(vm.runInContext('_copiesUrgent', t3.ctx), false, w + ': (once)');
  }

  console.log('The side files only when they changed (' + w + ')');
  {
    const asg = extractFunction(page.src, 'saveAssignmentsToDrive', w);
    assert(/if \(_sentKey === _assignmentsLastSent\) return;/.test(asg) && /_assignmentsLastSent = _sentKey;/.test(asg), w + ': the assignments file is sent only when its content changed');
    const ul = extractFunction(page.src, 'syncUserLoginFolderToDrive', w);
    assert(/opts\.ifChanged && _userLoginLastSent\[account\.id\] === _recKey/.test(ul), w + ': the person\'s account record only when it changed');
    assert(/syncUserLoginFolderToDrive\(currentLoggedInUser, \{ ifChanged: true \}\)/.test(extractFunction(page.src, 'autoSaveToAllFolders', w)), w + ': (the 5-second save asks for that)');
    assert(/_copiesFlushRequested = true;[\s\S]{0,200}autoSaveToAllFolders\(\)/.test(extractFunction(page.src, 'finalCloudSaveBeforeLogout', w)), w + ': the sign-out\'s final save writes the copies that are behind');
    assert(/_copiesUrgent = true/.test(extractFunction(page.src, 'recoverOvertakenWrite', w)), w + ': an overtaken write that cannot be recovered sends the copies at once');
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
