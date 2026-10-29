/* An untouched dashboard goes quiet, and no edit is ever swallowed.

   What went wrong (EF-1 in the efficiency audit, OF-6 in the office audit):
   the 5-second save asks "was anything written since my last save?" with the
   store's write counter. It took that mark, and then its own bookkeeping —
   cestisMarkUploaded() removing the "pending upload" note that saveState()
   had just set, the time of the last sync — moved the counter again. Every
   tick found a "change": saveState() 27 times a minute, every collection
   rewritten, the chat file uploaded every 2.6 s, ~2.9 GB a day per idle PC.
   And the chat push uploaded the whole file with no check at all.

   Pinned here, by running the page's own functions (extracted from
   index.html and the Offline System's copy) against stand-ins:
     - after the first upload, ten idle ticks make no upload and no full save;
     - an edit made while an upload is in flight goes up on the next tick
       (absorbing the count at the END of the upload swallowed it once);
     - an edit made while the version check is in flight is counted too;
     - a failed upload is retried;
     - the chat push sends nothing when the file already holds this chat, and
       one push at a time: a message sent during an upload goes up after it,
       never overtaken by the older upload landing last;
     - the store's opt-in "uncounted" keys (the session's once-a-minute stamp).

   The real-browser version is tests/browser/sync-quiet.js.

   Run: node tests/sync-idle-quiet.test.js */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A store that counts its writes, as CESTISStore does. */
function fakeStore() {
  const data = {};
  const S = {
    writes: 0, uncounted: {}, _cache: data,
    getItem: k => (k in data ? data[k] : null),
    setItem(k, v) { if (S.uncounted[k] !== 1) S.writes++; data[k] = String(v); },
    removeItem(k) { if (S.uncounted[k] !== 1) S.writes++; delete data[k]; },
    isReady: () => true
  };
  return S;
}

(async () => {
for (const page of PAGES) {
  const w = page.where, C = page.core;
  console.log('The 5-second save goes quiet, and swallows no edit (' + w + ')');
  const names = ['autoSaveToAllFolders', 'cestisBookkeeping', 'cestisMarkUploaded', 'cestisMarkPendingUpload', 'cestisHashString', 'cestisMaybeWriteExtraCopies'];
  const src = names.map(n => extractFunction(page.src, n, w)).join('\n') +
    '\nvar _copyState = { writtenAt: Date.now(), behind: false, mainFailAt: 0 }, _copiesFlushRequested = false, _copiesUrgent = false;';
  function world() {
    const store = fakeStore();
    const uploads = []; let hold = null;
    const ctx = {
      console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, Date, Math, Promise, Blob, Error,
      CESTISCore: C, CESTISStore: store, window: {},
      isCloudConnected: true, googleAccessToken: 'tok', _isAutoSaving: false, _sessionWiped: false, currentRole: 'admin', currentLoggedInUser: null,
      _lastPull: { ok: true, changed: false, kind: '' }, _lastAutoSaveHash: null, _lastAutoSaveWriteMark: -1,
      _lastAutoSaveResult: { uploaded: false, reason: 'not-run' }, _consecutiveCloudSaveFailures: 0, lastSyncTime: null, lastSavedBy: '', cloudFileTimestamp: '',
      GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'MAIN' }, ALL_DRIVE_FOLDERS: [{ id: 'MAIN', label: 'Main Backup' }, { id: 'F2', label: 'Online Exams' }],
      userAccounts: [], students: [{ id: 'S1', name: 'Tameka' }], exams: [], announcements: [], attendanceRecords: [], attnLoadedQuarter: null, attendanceRegister: [],
      vcSessions: [], calendarEvents: [], examResults: [], examAttempts: [], examRegisters: [], lmsChatRooms: [], lmsChatMessages: {}, lmsChatProfiles: {},
      lmsChatFollows: {}, lmsChatFollowLog: {}, classSessions: [], adminMeetings: [], instructorAssignments: [], assignmentSubmissions: [], instructorResources: [],
      studentProfiles: {}, instructorProfiles: {}, instructorData: [], systemSettings: {}, supportMessages: [], notifications: [], certDownloadApprovals: [],
      certTemplateCourseMap: {}, syncTombstones: {}, driveResources: [], skillAreas: [], adminStaffAccessSettings: {}, adrTasks: [], adrStaffMeta: {},
      documentHubFiles: [], certTemplates: {},
      safeJsonParse: (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
      stripSecretFields: (k, v) => v, carryForwardCloudAdminSlices() {}, getCurrentCloudUser: () => ({ username: 'admin' }),
      updateLastSyncDisplay() {}, updateLastSavedByDisplay() {}, showToast() {}, examOutboxRead: () => [], examOutboxConfirm() {},
      pullMainIfRemoteNewer: async () => false, pullAllowsUpload: () => true, mainMovedSincePull: async () => { if (ctx.__duringCheck) ctx.__duringCheck(); return false; },
      lmsChatSyncToDrive: async () => true, savePerUserBackup: async () => true, syncUserLoginFolderToDrive: async () => true,
      saveAssignmentsToDrive: async () => true, saveMasterSnapshot: async () => ({ ok: true, skipped: true }),
      silentSaveToFolder: async (folderId, label, blob) => {
        const text = await blob.text();
        if (hold && folderId === 'MAIN') await hold();
        if (ctx.__failNext) { ctx.__failNext = false; return false; }
        uploads.push({ folderId, data: JSON.parse(text).data });
        return true;
      },
      // saveState as the page has it: every collection rewritten as it is,
      // and the "pending upload" note set.
      saveState() {
        ctx.__saves++;
        store.setItem('voctrain_students', JSON.stringify(ctx.students));
        store.setItem('voctrain_calendarEvents', JSON.stringify(ctx.calendarEvents));
        ctx.cestisMarkPendingUpload();
      },
      __saves: 0
    };
    ctx.window.CESTISStore = store;
    vm.createContext(ctx); vm.runInContext(src, ctx);
    return { ctx, store, uploads, setHold: h => { hold = h; } };
  }

  // 1. Idle: after the first upload, nothing.
  {
    const t = world();
    t.ctx.saveState();                                          // the page's first save
    await t.ctx.autoSaveToAllFolders();
    assertEq(t.uploads.filter(u => u.folderId === 'MAIN').length, 1, w + ': the first tick uploads');
    const saves0 = t.ctx.__saves, up0 = t.uploads.length;
    for (let i = 0; i < 10; i++) await t.ctx.autoSaveToAllFolders();
    assertEq(t.uploads.length - up0, 0, w + ': ten idle ticks after it upload nothing');
    assertEq(t.ctx.__saves - saves0, 0, w + ': and rewrite nothing (no full save)');
    assertEq(t.ctx._lastAutoSaveResult.reason, 'nothing-new', w + ': each idle tick finds nothing new');
    assert(t.store.getItem('cestisPendingUpload') === null, w + ': the "pending upload" note is cleared');
    // The session's once-a-minute stamp, named uncounted, does not wake it.
    t.store.uncounted.voctrain_sessionSeenAt = 1;
    t.store.setItem('voctrain_sessionSeenAt', String(Date.now()));
    await t.ctx.autoSaveToAllFolders();
    assertEq(t.ctx.__saves - saves0, 0, w + ': the session\'s "still here" stamp is not a change');
    // A real edit after all that is uploaded.
    t.ctx.calendarEvents.push({ id: 'EV-1' }); t.ctx.saveState();
    await t.ctx.autoSaveToAllFolders();
    const last = t.uploads.filter(u => u.folderId === 'MAIN').pop();
    assert(last && last.data.calendarEvents.some(e => e.id === 'EV-1'), w + ': an edit after a quiet spell goes up on the next tick');
    const up1 = t.uploads.length, s1 = t.ctx.__saves;
    for (let i = 0; i < 5; i++) await t.ctx.autoSaveToAllFolders();
    assertEq([t.uploads.length - up1, t.ctx.__saves - s1], [0, 0], w + ': and then it is quiet again');
  }

  // 2. An edit while the upload is in flight goes up on the next tick.
  {
    const t = world();
    t.ctx.saveState();
    await t.ctx.autoSaveToAllFolders();
    t.ctx.calendarEvents.push({ id: 'EV-A' }); t.ctx.saveState();
    let release; const held = new Promise(r => { release = r; });
    let started; const inFlight = new Promise(r => { started = r; });
    t.setHold(() => { started(); return held; });
    const tick = t.ctx.autoSaveToAllFolders();
    await inFlight;
    t.ctx.calendarEvents.push({ id: 'EV-B' }); t.ctx.saveState();     // during the upload
    t.setHold(null); release(); await tick;
    let main = t.uploads.filter(u => u.folderId === 'MAIN').pop();
    assert(main.data.calendarEvents.some(e => e.id === 'EV-A') && !main.data.calendarEvents.some(e => e.id === 'EV-B'), w + ': the upload in flight carried edit A only');
    await t.ctx.autoSaveToAllFolders();
    main = t.uploads.filter(u => u.folderId === 'MAIN').pop();
    assert(main.data.calendarEvents.some(e => e.id === 'EV-B'), w + ': edit B, made during the upload, goes up on the next tick');
    const n = t.uploads.length;
    for (let i = 0; i < 5; i++) await t.ctx.autoSaveToAllFolders();
    assertEq(t.uploads.length - n, 0, w + ': then quiet');
  }

  // 3. An edit while the version check is in flight is counted too.
  {
    const t = world();
    t.ctx.saveState();
    await t.ctx.autoSaveToAllFolders();
    for (let i = 0; i < 2; i++) await t.ctx.autoSaveToAllFolders();
    t.ctx.calendarEvents.push({ id: 'EV-C' }); t.ctx.saveState();
    t.ctx.__duringCheck = () => { t.ctx.__duringCheck = null; t.ctx.calendarEvents.push({ id: 'EV-D' }); t.ctx.saveState(); };
    await t.ctx.autoSaveToAllFolders();
    await t.ctx.autoSaveToAllFolders();
    const main = t.uploads.filter(u => u.folderId === 'MAIN').pop();
    assert(main.data.calendarEvents.some(e => e.id === 'EV-D'), w + ': an edit made during the pre-upload check goes up');
  }

  // 4. A failed upload is tried again.
  {
    const t = world();
    t.ctx.saveState();
    t.ctx.__failNext = true;
    await t.ctx.autoSaveToAllFolders();
    assertEq(t.ctx._lastAutoSaveResult.reason, 'saved', w + ': (one of two folders failed, Main counted)');
    const t2 = world();
    t2.ctx.ALL_DRIVE_FOLDERS = [{ id: 'MAIN', label: 'Main Backup' }];
    t2.ctx.saveState(); t2.ctx.__failNext = true;
    await t2.ctx.autoSaveToAllFolders();
    assertEq(t2.uploads.length, 0, w + ': the only upload failed');
    await t2.ctx.autoSaveToAllFolders();
    assertEq(t2.uploads.length, 1, w + ': and the next tick tries again');
    assert(t2.store.getItem('cestisPendingUpload') === null, w + ': cleared only once it went up');
  }

  console.log('The chat push: nothing when unchanged, one at a time (' + w + ')');
  {
    const names2 = ['lmsChatSyncToDrive'];
    const src2 = names2.map(n => extractFunction(page.src, n, w)).join('\n') +
      '\nvar _lmsChatDriveSig = null, _lmsChatPushSeq = 0, _lmsChatPushing = null, _lmsChatPushAgain = false, _lmsChatLastModified = null;';
    const file = { content: null, mt: 0 };
    const patches = []; let holdNext = null;
    const ctx = {
      console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, Date, Promise, Blob, Error,
      CESTISCore: C, isCloudConnected: true, googleAccessToken: 'tok', _sessionWiped: false, currentRole: 'admin',
      LMS_CHAT_DRIVE_FOLDER: 'CHAT', lmsChatRooms: [{ id: 'r1' }], lmsChatMessages: { r1: [{ id: 'm1', text: 'hi', timestamp: '2026-10-01T10:00:00Z' }] },
      lmsChatProfiles: {}, lmsChatFollows: {}, lmsChatFollowLog: {}, syncTombsFor: () => ({}), lmsChatGetCurrentUser: () => ({ name: 'Admin' }),
      lmsChatFindDriveFile: async () => 'FILE',
      // The pull: the file's time is checked; this device's own writes are known.
      lmsChatSyncFromDrive: async () => ({ ok: true, changed: false }),
      FormData: function () { this.append = () => {}; },
      fetch: async (url, opts) => {
        const body = await opts.body.text();
        const h = holdNext; holdNext = null;
        if (h) await h;
        file.content = body; file.mt++;
        patches.push(JSON.parse(body));
        return { ok: true, clone() { return { json: async () => ({ modifiedTime: String(file.mt) }) }; }, json: async () => ({ modifiedTime: String(file.mt) }) };
      }
    };
    vm.createContext(ctx); vm.runInContext(src2, ctx);
    await ctx.lmsChatSyncToDrive();
    assertEq(patches.length, 1, w + ': the first push uploads');
    for (let i = 0; i < 5; i++) await ctx.lmsChatSyncToDrive();
    assertEq(patches.length, 1, w + ': five more pushes with nothing new upload nothing');
    ctx.lmsChatProfiles.U1 = { status: 'online', lastSeen: '2026-10-01T10:05:00Z' };
    await ctx.lmsChatSyncToDrive();
    assertEq(patches.length, 2, w + ': someone seen online is a change, and goes up');
    // One at a time: a message during an upload goes up after it.
    let release; holdNext = new Promise(r => { release = r; });
    ctx.lmsChatMessages.r1.push({ id: 'm2', text: 'two', timestamp: '2026-10-01T10:06:00Z' });
    const p1 = ctx.lmsChatSyncToDrive();
    await sleep(5);
    ctx.lmsChatMessages.r1.push({ id: 'm3', text: 'three', timestamp: '2026-10-01T10:07:00Z' });
    const p2 = ctx.lmsChatSyncToDrive();
    await sleep(5);
    assertEq(patches.length, 2, w + ': the second push waits for the upload in flight');
    release(); await p1; await p2;
    const held = JSON.parse(file.content).chatMessages.r1.map(m => m.id);
    assertEq(held, ['m1', 'm2', 'm3'], w + ': the file ends holding the newest chat (never the older upload landing last)');
    const n = patches.length;
    await ctx.lmsChatSyncToDrive();
    assertEq(patches.length, n, w + ': and nothing more goes up after that');
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
