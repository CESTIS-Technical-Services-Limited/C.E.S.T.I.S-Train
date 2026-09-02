/* Data has to be the SAME on every device — and a sync must never make it
   worse than it was.

   What the Centre saw: people told their password was wrong on accounts
   nobody had touched; maintenance mode switching itself back on long after
   an administrator had turned it off; data present on one machine and
   missing on another. Behind them, a family of defects in the Google Drive
   sync, each pinned here:

     - logout fired the final cloud save and wiped the store in the same
       breath; the save built its payload after an await, so every logout
       uploaded an EMPTY backup to every folder;
     - a device could upload before it had ever pulled (a token restored
       from storage, a pre-login save), overwriting everybody else's work;
     - "Sync from Cloud" replaced every account with one file's copy, and
       three other paths pushed cloud accounts verbatim, so five paths had
       five different ideas of whose password survives;
     - a save from a trainee's device omitted what only an administrator
       publishes, and omitting a key from the uploaded file DELETES it;
     - the Main backup's age was unknown at load, so it was merged first and
       every stale folder copy after it won the ties;
     - an administrator's logout deleted the Centre's settings, so the next
       load had no opinion and adopted whatever stale "maintenance on" a
       cloud copy still held.

   Run: node tests/sync-integrity.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
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
function fnBody(src, name, where) { return extractFunction(src, name, where); }
function count(src, needle) { return src.split(needle).length - 1; }

const REAL = 'pbkdf2$210000$0011$2233', OTHER = 'pbkdf2$210000$4455$6677';
const T1 = '2026-08-01T09:00:00.000Z', T2 = '2026-08-20T09:00:00.000Z';

/* ---------- 1. One account rule, on every path ---------- */
console.log('Every path that brings accounts in goes through the one rule');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  assert(count(src, 'function mergeCloudAccounts(') === 1, w + ' defines mergeCloudAccounts once');
  const uses = count(src, 'mergeCloudAccounts(') - 1;
  assert(uses >= 5, w + ' uses it on the folder merge, the pre-login fetch, both course recoveries and the manual Merge from Cloud (found ' + uses + ' uses)');
  const sync = fnBody(src, 'syncFromCloud', w);
  assert(sync.indexOf('userAccounts = backupData.data.userAccounts') === -1, w + ': Sync from Cloud no longer replaces every account with one file\'s copy');
  assert(sync.indexOf('await mergeBackupData(backupData)') !== -1, w + ': Sync from Cloud is the same merge every automatic pull runs');
  assert(sync.indexOf('students = backupData.data.students') === -1, w + ': and no longer replaces the trainee roll either');
  assert(src.indexOf('userAccounts.push(cloudUser);') === -1 && src.indexOf('userAccounts.push(cu);') === -1,
    w + ': no recovery pushes a cloud account verbatim any more');
});

function runMerge(page, local, cloud, tombs) {
  const sandbox = { userAccounts: local, CESTISCore: page.core, console: console,
    isUserDeleted: function (id) { return !!(tombs && tombs[id]); }, mergeTwoFactorState: function () { return false; } };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(page.src, 'mergeCloudAccounts', page.where), sandbox);
  sandbox.cloud = cloud;
  const changed = vm.runInContext('mergeCloudAccounts(cloud)', sandbox);
  return { changed: changed, accounts: sandbox.userAccounts };
}
PAGES.forEach(function (page) {
  const w = page.where;
  // A fresh device's seed yields to the real account.
  let r = runMerge(page, [{ id: 'USR-001', username: 'cestisadmin', role: 'admin', password: 'pbkdf2$210000$aa$bb', defaultPassword: true }],
    [{ id: 'USR-001', username: 'cestisadmin', role: 'admin', password: REAL }]);
  assertEq(r.accounts[0].password, REAL, w + ': the real password replaces the seed');
  assertEq(r.accounts[0].defaultPassword, undefined, w + ': and the seed marker goes with it');
  // A seed arriving from the cloud never replaces a real password.
  r = runMerge(page, [{ id: 'USR-001', username: 'cestisadmin', role: 'admin', password: REAL }],
    [{ id: 'USR-001', username: 'cestisadmin', role: 'admin', password: 'pbkdf2$210000$aa$bb', defaultPassword: true }]);
  assertEq(r.accounts[0].password, REAL, w + ': a seed in the cloud never replaces a real password');
  assertEq(r.changed, 0, w + ': and nothing is reported changed');
  // A fresher local edit survives; a fresher cloud edit arrives.
  r = runMerge(page, [{ id: 'USR-7', username: 'john.smith', role: 'student', password: REAL, updatedAt: T2 }],
    [{ id: 'USR-7', username: 'john.smith', role: 'student', password: OTHER, updatedAt: T1 }]);
  assertEq(r.accounts[0].password, REAL, w + ': a fresher local edit is never overwritten');
  r = runMerge(page, [{ id: 'USR-7', username: 'john.smith', role: 'student', password: REAL, updatedAt: T1 }],
    [{ id: 'USR-7', username: 'john.smith', role: 'student', password: OTHER, updatedAt: T2, status: 'disabled' }]);
  assertEq(r.accounts[0].password, OTHER, w + ': a fresher cloud edit reaches this device');
  assertEq(r.accounts[0].status, 'disabled', w + ': with its status');
  assertEq(r.accounts[0].updatedAt, T2, w + ': and its stamp');
  // Matching is by id, username or email, case-insensitively; never a duplicate.
  r = runMerge(page, [{ id: 'USR-7', username: 'John.Smith', email: 'JS@Mail.com', role: 'student', password: REAL, updatedAt: T2 }],
    [{ id: 'USR-99', username: 'other', email: 'js@mail.com', role: 'student', password: OTHER }]);
  assertEq(r.accounts.length, 1, w + ': the same person under another id and username is matched by email, not duplicated');
  assertEq(r.accounts[0].password, REAL, w + ': and the older copy does not overwrite them');
  // New accounts are added, deleted ones stay deleted, the plaintext cache never travels.
  r = runMerge(page, [], [{ id: 'USR-8', username: 'new.person', role: 'student', password: REAL, _plaintextPw: 'secret' },
    { id: 'USR-9', username: 'gone', role: 'student', password: REAL }], { 'USR-9': true });
  assertEq(r.accounts.length, 1, w + ': a new account is added and a revoked one is not');
  assertEq(r.accounts[0]._plaintextPw, undefined, w + ': a plaintext cache an old backup leaked is dropped');
  assertEq(r.changed, 1, w + ': the addition is counted');
  // The Chair's office and the trainee link travel.
  r = runMerge(page, [{ id: 'USR-5', username: 'chair', role: 'cmc', password: REAL }],
    [{ id: 'USR-5', username: 'chair', role: 'cmc', password: REAL, cmcChair: true, updatedAt: T1 }]);
  assertEq(r.accounts[0].cmcChair, true, w + ': the Chairperson office reaches every device');
});

/* ---------- 2. Logout saves first, wipes after; no upload from a wiped or signed-out session ---------- */
console.log('A logout can never upload an emptied store');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const lo = fnBody(src, 'logout', w);
  assert(lo.indexOf('finalCloudSaveBeforeLogout()') !== -1 && lo.indexOf('finalSave.then(') !== -1,
    w + ': logout waits for the final save before it wipes anything');
  const wipeAt = lo.indexOf('clearSensitiveStudentData()'), thenAt = lo.indexOf('finalSave.then(');
  assert(wipeAt > thenAt, w + ': the wipe is inside the "after the save" step');
  assert(lo.indexOf('seq !== _sessionSeq') !== -1, w + ': and is skipped if somebody signed in again meanwhile');
  const auto = fnBody(src, 'autoSaveToAllFolders', w);
  assert(count(auto, '_sessionWiped || !currentRole') === 2, w + ': the autosave refuses a wiped or signed-out session, before and after its pull');
  assert(fnBody(src, 'clearAllSessionData', w).indexOf('_sessionWiped = true') !== -1
    && fnBody(src, 'clearSensitiveStudentData', w).indexOf('_sessionWiped = true') !== -1, w + ': every wipe raises the flag');
  assert(fnBody(src, 'enterApp', w).indexOf('_sessionWiped = false') !== -1, w + ': and a sign-in lowers it');
});

/* ---------- 3. Pull before the first push; honest folder ages; carry the Centre's data forward ---------- */
console.log('A device pulls before its first push, and never strips the Centre\'s data');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const pull = fnBody(src, 'pullMainIfRemoteNewer', w);
  assert(pull.indexOf('if (_mainMergedThisSession) return false;') !== -1 && pull.indexOf('await silentMergeFromBackup(fileId)') !== -1,
    w + ': first sight of the Main backup merges it unless a login sync already did');
  assert(fnBody(src, 'silentMergeFromBackup', w).indexOf('_mainMergedThisSession = true') !== -1, w + ': and the login merge records that it did');
  assert(fnBody(src, 'silentMergeFromBackup', w).indexOf('handleCloudAuthExpired()') !== -1, w + ': a rejected download is no longer silent');
  assert(count(src, 'await locateBackupCopy(folder.id)') === 2, w + ': both login syncs ask Drive for each copy\'s real age');
  assert(fnBody(src, 'autoSaveToAllFolders', w).indexOf('carryForwardCloudAdminSlices(backupData.data)') !== -1,
    w + ': a non-administrator save carries the administrator-only data forward');
  assert(fnBody(src, 'mergeBackupData', w).indexOf('rememberCloudAdminSlices(backupData.data)') !== -1, w + ': as it was last seen in the cloud');
  assert(src.indexOf("if(Array.isArray(parsed) ? !parsed.length : (typeof parsed === 'object' && !Object.keys(parsed).length)) return;") !== -1,
    w + ': another tab\'s empty list is never adopted');
  assert(fnBody(src, 'confirmDeleteStudent', w).indexOf('recordDeletedUser(u.id)') !== -1, w + ': deleting a trainee tombstones their login');
  assert(fnBody(src, 'addStudent', w).indexOf('defaultPassword: true') !== -1, w + ': the initial password handed to a new trainee is marked as a seed');
  assert(src.indexOf('resumeCloudSyncIfLoggedIn();') !== -1 && count(src, 'resumeCloudSyncIfLoggedIn();') >= 2,
    w + ': a refreshed token restarts the pull as well as the push');

  // The carry-forward itself, run for real.
  const sandbox = { console: console };
  vm.createContext(sandbox);
  vm.runInContext("var _cloudAdminSlices = {};\nvar CLOUD_ADMIN_SLICE_KEYS = ['systemSettings', 'adminStaffAccessSettings', 'driveResources', 'skillAreas', 'adrTasks', 'adrStaffMeta', 'documentHubFiles', 'certTemplates'];\n"
    + extractFunction(src, 'rememberCloudAdminSlices', w) + '\n' + extractFunction(src, 'carryForwardCloudAdminSlices', w), sandbox);
  sandbox.seen = { systemSettings: { maintenanceMode: false, maintenanceUpdatedAt: T2 }, adminStaffAccessSettings: { pages: ['students'] }, skillAreas: [], driveResources: [{ id: 'R1' }] };
  vm.runInContext('rememberCloudAdminSlices(seen)', sandbox);
  sandbox.payload = { students: [{ id: 'S1' }], skillAreas: [], driveResources: [{ id: 'R2' }] };
  vm.runInContext('carryForwardCloudAdminSlices(payload)', sandbox);
  assertEq(JSON.stringify(sandbox.payload.systemSettings), JSON.stringify(sandbox.seen.systemSettings), w + ': the settings the cloud held are carried forward');
  assertEq(JSON.stringify(sandbox.payload.adminStaffAccessSettings), JSON.stringify({ pages: ['students'] }), w + ': so is the Admin Staff access grid');
  assertEq(sandbox.payload.driveResources[0].id, 'R2', w + ': a copy this device holds is not overridden');
  assertEq(sandbox.payload.skillAreas.length, 0, w + ': an empty list the cloud also had stays empty');
});

/* ---------- 4. Maintenance mode: the settings survive a logout ---------- */
console.log('The Centre\'s settings survive an administrator\'s logout');
PAGES.forEach(function (page) {
  const w = page.where;
  const data = { voctrain_users: '[...]', voctrain_systemSettings: '{"maintenanceMode":false,"maintenanceUpdatedAt":"' + T2 + '"}',
    voctrain_maintenanceMode: '{"active":false,"updatedAt":"' + T2 + '"}', voctrain_students: '[...]', schoolDashboardLastSyncTime: 'x',
    schoolDashboardGoogleAccessToken: 'tok', voctrain_user_chat: '{}' };
  const store = { get length() { return Object.keys(data).length; }, key: function (i) { return Object.keys(data)[i]; },
    removeItem: function (k) { delete data[k]; }, getItem: function (k) { return data[k] == null ? null : data[k]; } };
  const sandbox = { CESTISStore: store, console: console, adminStaffAccessDefaults: function () { return {}; },
    indexedDB: { deleteDatabase: function () {} }, _sessionWiped: false };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(page.src, 'clearAllSessionData', w) + '\nclearAllSessionData();', sandbox);
  assert('voctrain_systemSettings' in data && 'voctrain_maintenanceMode' in data, w + ': the settings and the maintenance decision stay');
  assert(!('voctrain_students' in data) && !('schoolDashboardLastSyncTime' in data), w + ': the session\'s data is still wiped');
  assert('voctrain_users' in data && 'schoolDashboardGoogleAccessToken' in data && 'voctrain_user_chat' in data, w + ': what was preserved before still is');
  assertEq(sandbox._sessionWiped, true, w + ': and the wipe is flagged for any save still in flight');
  // Cross-tab: an older decision never undoes a newer one.
  const listener = page.src.slice(page.src.indexOf("if(e.key === 'voctrain_maintenanceMode')"), page.src.indexOf("if(e.key === 'voctrain_maintenanceMode')") + 900);
  assert(listener.indexOf('if(valAt < haveAt) return;') !== -1, w + ': a cross-tab maintenance update is adopted only when newer');
  const ss = page.core.mergeSystemSettings({ maintenanceMode: false, maintenanceUpdatedAt: T2 }, { maintenanceMode: true, maintenanceUpdatedAt: T1 });
  assertEq(ss.maintenanceMode, false, w + ': the core keeps the newer "off" over an older "on"');
  const auto = fnBody(page.src, 'autoSaveToAllFolders', w);
  assert(auto.indexOf('systemSettings: _isAdminSave ? systemSettings : undefined') !== -1, w + ': only an administrator publishes the settings');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
