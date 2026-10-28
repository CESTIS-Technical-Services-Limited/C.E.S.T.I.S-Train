/* Six ways the integrated overhaul could still lose the Centre's data, found
   by an adversarial review and each pinned here by the real code.

   1. AN INSTRUCTOR'S UNSENT ATTENDANCE MARKS WERE DELETED AFTER A TRAINEE
      USED THE SAME PC. The instructor marked the class offline and signed
      out; the final save failed, so the device kept the data ("the next
      sign-in uploads it"). A trainee signed in next. A trainee's backup
      leaves the dated register out, yet its first successful upload deleted
      the "pending upload" note — so the trainee's sign-out trimmed the
      register to that trainee's own marks. The other trainees' marks had
      never left the PC.
   2. EDITING AN APPROVED VIREMENT WAS UNDONE on Google Drive and on the
      Centre's network: the page-cloud merge let "a decision beats Pending"
      win over the Virement page's own rule (a different version edited later
      wins whole), so the old Approved figures and both signatures came back
      over the correction — on the PC that made it too.
   3. COURSEWORK GRADES ERASED EACH OTHER ON THE CENTRE'S NETWORK. Grades
      live inside the assignment. The Drive merge settles them trainee by
      trainee, but each LAN device and the Centre's server still let the
      newer WHOLE assignment win: two instructors marking different trainees
      within one half-minute refresh lost one mark; a trainee's resubmission
      (which writes into the assignment) erased a mark given meanwhile.
   4. AN EXAM RENAMED ON A DEVICE STILL RUNNING THE OLD CODE WAS DELETED
      EVERYWHERE ELSE: the old code's title|programme tombstone was carried
      onto the exam's id, the renamed copy counted as "deleted after", and an
      id tombstone then went to every device.
   5. IMPORT BACKUP DID NOT RESTORE RECORDS INSIDE ONE STORED VALUE: a
      Cashbook quarter kept 1 of the backup's 40 cheques (and opening balance
      0), the payroll restored nothing even over the page's empty skeleton,
      and records without an id were skipped — while the toast said
      "Backup merged".
   6. EDITS MADE ON A CLOCK MORE THAN A DAY FAST WERE THROWN AWAY: other
      devices merged them as undated, and once that clock was put right its
      own copy lost to their older one too.

   Run: node tests/review-data-loss.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');
const OFF = path.join(ROOT, 'Offline System');
const BUILDS = [
  { where: 'main build', dir: ROOT, core: require('../cestis-core.js') },
  { where: 'Offline System', dir: OFF, core: require('../Offline System/cestis-core.js') }
];
// The Centre's server always runs the Offline System's own copy of the core.
const ServerCore = require('../Offline System/cestis-core.js');
const Store = require('../Offline System/cestis-offline-store.js');
const DAY = 86400000;

function extractFunction(src, name) {
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------------------------------------------------------------- harness */
// A device's backing store shared by every page load on it.
function storeOn(map) {
  const s = {
    getItem: k => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); s.writes++; },
    removeItem: k => { map.delete(String(k)); s.writes++; },
    keys: () => Array.from(map.keys()), key: i => Array.from(map.keys())[i],
    get length() { return map.size; }, whenReady: cb => cb(), isReady: () => true, writes: 0
  };
  return s;
}
// A mocked Google Drive (files by name; media download, PATCH and POST uploads).
function makeDrive() {
  const files = {}; let n = 0;
  const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body), headers: { get: () => null } });
  function fetch(url, opts) {
    opts = opts || {};
    const u = new URL(url);
    if (u.pathname === '/drive/v3/files' && (!opts.method || opts.method === 'GET')) {
      const m = /name='([^']+)'/.exec(u.searchParams.get('q') || '');
      const id = m && Object.keys(files).find(k => files[k].name === m[1]);
      return ok({ files: id ? [{ id, modifiedTime: files[id].mt }] : [] });
    }
    let m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && u.searchParams.get('alt') === 'media') return ok(files[m[1]].body);
    m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && opts.method === 'PATCH') {
      return opts.body.text().then(t => { files[m[1]].body = t; files[m[1]].mt = new Date(Date.now() + (++n)).toISOString(); return { ok: true, status: 200, json: () => Promise.resolve({}) }; });
    }
    if (u.pathname === '/upload/drive/v3/files' && opts.method === 'POST') {
      return Promise.all([opts.body.get('metadata').text(), opts.body.get('file').text()]).then(([mt, body]) => {
        const id = 'F' + (++n); files[id] = { name: JSON.parse(mt).name, body, mt: new Date().toISOString() };
        return { ok: true, status: 200, json: () => Promise.resolve({ id }) };
      });
    }
    return Promise.reject(new Error('unmocked ' + (opts.method || 'GET') + ' ' + url));
  }
  return { fetch,
    put(name, payload) { const id = 'F' + (++n); files[id] = { name, body: JSON.stringify(payload), mt: new Date().toISOString() }; return id; },
    get(name) { const id = Object.keys(files).find(k => files[k].name === name); return id ? JSON.parse(files[id].body) : null; } };
}
// The Centre's server: its PUT runs the REAL store merge (cestis-offline-store.js).
function makeLanServer(opts) {
  opts = opts || {};
  const files = {};
  const res = (status, body, etag) => ({ ok: status >= 200 && status < 300, status,
    headers: { get: h => (/etag/i.test(h) ? etag : null) }, json: () => Promise.resolve(body) });
  function fetch(url, o) {
    o = o || {};
    if (url === '/_cestis/health') return Promise.resolve(res(200, { ok: true, mode: 'offline-lan', time: new Date(Date.now() + (opts.serverAheadMs || 0)).toISOString() }));
    if (url === '/_cestis/token') return Promise.resolve(res(200, { token: 't'.repeat(48) }));
    const m = /^\/_cestis\/data\/(.+)$/.exec(url);
    if (!m) return Promise.reject(new Error('unmocked ' + url));
    const name = decodeURIComponent(m[1]);
    if ((o.method || 'GET') === 'GET') {
      if (!(name in files)) return Promise.resolve(res(404, null));
      const etag = '"' + crypto.createHash('sha1').update(files[name]).digest('hex') + '"';
      if (o.headers && o.headers['If-None-Match'] === etag) return Promise.resolve(res(304, null, etag));
      return Promise.resolve(res(200, JSON.parse(files[name]), etag));
    }
    if (o.method === 'PUT') {
      const incoming = JSON.parse(o.body);
      const merged = Store.mergeIncoming(ServerCore, name in files ? files[name] : null, incoming);
      files[name] = JSON.stringify(merged);
      const etag = '"' + crypto.createHash('sha1').update(files[name]).digest('hex') + '"';
      return Promise.resolve(res(200, { ok: true, etag, changedByServer: files[name] !== JSON.stringify(incoming) }));
    }
    return Promise.reject(new Error('unmocked method'));
  }
  return { fetch, read: (name, key) => JSON.parse(JSON.parse(files[name]).data[key]) };
}
// One page load of the REAL cestis-core.js + cestis-page-cloud.js of a build.
function loadPage(B, map, net, location) {
  const ctx = {
    console, Date, JSON, Math, Promise, URL, Blob, FormData, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {}, fetch: net ? net.fetch : undefined,
    addEventListener: () => {}, dispatchEvent: () => true, CESTISStore: storeOn(map), document: { hidden: false }
  };
  if (location) ctx.location = location;
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(B.dir, 'cestis-core.js'), 'utf8'), ctx, { filename: 'cestis-core.js' });
  vm.runInContext(fs.readFileSync(path.join(B.dir, 'cestis-page-cloud.js'), 'utf8'), ctx, { filename: 'cestis-page-cloud.js' });
  return ctx;
}
const LAN_AT = { protocol: 'http:', hostname: '192.168.1.10' };
const LMS = { page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json', prefixes: ['voctrain_'], keys: [] };

(async function main() {
  for (const B of BUILDS) {
    const C = B.core, S = C.sync, tag = ' (' + B.where + ')';
    const IDX = fs.readFileSync(path.join(B.dir, 'index.html'), 'utf8');

    /* ======================================================= 1. sign-out */
    console.log('1. An instructor\'s unsent marks survive a trainee using the same PC' + tag);
    try {
      const fns = ['logout', 'finalCloudSaveBeforeLogout', 'finalLanSaveBeforeLogout', 'autoSaveToAllFolders', 'clearSensitiveStudentData',
        'keepUnsyncedDataOnSignOut', 'cestisMarkPendingUpload', 'cestisMarkUploaded', 'carryForwardCloudAdminSlices',
        'clearAllSessionData', 'clearSensitiveDataOnExpiry'];
      const SRC = fns.map(n => extractFunction(IDX, n)).join('\n\n');
      const dashboard = function (map) {
        const Store = storeOn(map);
        const box = { driveUp: false, uploads: [], toasts: [] };
        const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, innerHTML: '', value: '' });
        const ctx = {
          console: { log() {}, warn() {}, error() {} }, Date, JSON, Math, Object, Array, String, Promise, Blob, setTimeout, clearTimeout,
          document: { getElementById: el, hidden: false }, indexedDB: { deleteDatabase() {} },
          CESTISStore: Store, CESTISCore: C, CESTISPageCloud: undefined,
          isCloudConnected: true, googleAccessToken: 'tok', _isAutoSaving: false, _sessionWiped: false, _sessionLocked: false, _sessionSeq: 0,
          _lastAutoSaveWriteMark: -1, _lastAutoSaveHash: null, _lastAutoSaveResult: { uploaded: false }, _lastPull: { ok: true }, _consecutiveCloudSaveFailures: 0,
          _debouncedCloudSaveTimer: null, CLOUD_ADMIN_SLICE_KEYS: [], _cloudAdminSlices: {}, ALL_DRIVE_FOLDERS: [{ id: 'F1', label: 'main' }],
          pullMainIfRemoteNewer: async () => false, pullAllowsUpload: () => true, mainMovedSincePull: async () => false,
          silentSaveToFolder: async (id, label, blob) => { if (!box.driveUp) return false; box.uploads.push(JSON.parse(await blob.text())); return true; },
          lmsChatSyncToDrive: async () => {}, savePerUserBackup: async () => {}, syncUserLoginFolderToDrive: async () => {}, saveAssignmentsToDrive: async () => {},
          saveMasterSnapshot: async () => ({ ok: false }), sappCloudExport: () => null, getCurrentCloudUser: () => ({ username: 'u' }),
          stripSecretFields: (k, v) => v, cestisHashString: s => C.hashString(s), saveState: () => {}, updateLastSyncDisplay() {}, updateLastSavedByDisplay() {},
          showToast: m => box.toasts.push(m),
          examEndSessionForSignOut: () => true, closeMobileSidebar() {}, vcCleanupMediaIfNeeded() {}, lmsChatSignOff: () => Promise.resolve(false),
          stopAutoSave() {}, stopSessionExpiryCheck() {}, closeModal() {}, lmsChatRTStop() {}, enableLoginButtons() {}, examOutboxRead: () => [],
          safeJsonParse: (v, f) => { try { return v ? JSON.parse(v) : f; } catch (e) { return f; } }, adminStaffAccessDefaults: () => ({}),
          userAccounts: [], students: [], exams: [], announcements: [], attendanceRecords: [], attendanceRegister: [], vcSessions: [], calendarEvents: [],
          examResults: [], lmsChatRooms: [], lmsChatMessages: {}, lmsChatProfiles: {}, lmsChatFollows: {}, lmsChatFollowLog: [], classSessions: [], adminMeetings: [],
          instructorAssignments: [], assignmentSubmissions: [], instructorResources: [], studentProfiles: {}, instructorProfiles: {}, instructorData: [],
          systemSettings: {}, supportMessages: [], notifications: [], certDownloadApprovals: [], certTemplateCourseMap: {}, syncTombstones: {},
          driveResources: [], skillAreas: [], adminStaffAccessSettings: {}, adrTasks: [], adrStaffMeta: {}, documentHubFiles: [], certTemplates: {},
          currentRole: null, currentLoggedInUser: null, currentStudent: null, currentInstructor: null, attnLoadedQuarter: null,
          cloudFileId: null, lastSyncTime: null, lastSavedBy: '', cloudFileTimestamp: '', loginSyncCompleted: false,
          adminLoginShown: false, studentLoginShown: false, instructorLoginShown: false, adminStaffLoginShown: false, cmcLoginShown: false
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(SRC, ctx);
        box.run = js => vm.runInContext(js, ctx);
        box.ctx = ctx;
        return box;
      };
      const roll = ['S1', 'S2', 'S3', 'S4'].map(id => ({ id, name: 'Trainee ' + id, course: 'Welding' }));
      const map = new Map([['voctrain_students', JSON.stringify(roll)]]);
      const d = dashboard(map);
      const regIds = () => JSON.parse(map.get('voctrain_attendanceRegister') || '[]').map(r => r.studentId).join(',');
      const signIn = (role, user, student) => d.run("_sessionWiped=false; _sessionSeq++; currentRole=" + JSON.stringify(role) +
        "; currentLoggedInUser=" + JSON.stringify(user) + "; currentStudent=" + JSON.stringify(student || null) +
        "; students=JSON.parse(CESTISStore.getItem('voctrain_students')); attendanceRegister=JSON.parse(CESTISStore.getItem('voctrain_attendanceRegister')||'[]');");
      // The instructor marks the whole class with no internet (saveState -> cestisMarkPendingUpload).
      signIn('instructor', { id: 'U-I', name: 'Instructor' });
      const reg = [];
      roll.forEach(s => C.attendance.mark(reg, { studentId: s.id, date: '2026-10-21', status: 'present', by: 'U-I', studentName: s.name, course: s.course }));
      d.run('attendanceRegister=' + JSON.stringify(reg)); map.set('voctrain_attendanceRegister', JSON.stringify(reg));
      d.run('cestisMarkPendingUpload()');
      d.run('logout()'); await sleep(40);
      assertEq(regIds(), 'S1,S2,S3,S4', 'the instructor\'s sign-out with no internet keeps the register');
      // Internet back; a trainee signs in on this PC and their session uploads.
      d.driveUp = true;
      signIn('student', { id: 'U-S2' }, { id: 'S2', name: 'Trainee S2' });
      d.run('cestisMarkPendingUpload()');
      await d.run('autoSaveToAllFolders()');
      const up = d.uploads[d.uploads.length - 1];
      assert(!!up && up.data.attendanceRegister === undefined, 'the trainee\'s upload leaves the register out (as designed)');
      assert(String(map.get('cestisPendingUpload') || '').indexOf('instructor|') === 0, 'so it does not clear the instructor\'s "pending upload" note');
      d.run('logout()'); await sleep(40);
      assertEq(regIds(), 'S1,S2,S3,S4', 'the trainee\'s sign-out no longer trims away the other trainees\' marks');
      assert(d.toasts.some(t => /until a staff member signs in/.test(t)), 'and the trainee is told why the records stay');
      // The session expiring on a trainee does not trim either.
      signIn('student', { id: 'U-S3' }, { id: 'S3', name: 'Trainee S3' });
      map.set('voctrain_sessionRole', 'student');
      d.run('clearSensitiveDataOnExpiry()');
      assertEq(regIds(), 'S1,S2,S3,S4', 'nor does a trainee session that expires');
      // A staff sign-in uploads it (the register is in that backup) and clears the note; its sign-out then clears the PC as before.
      signIn('instructor', { id: 'U-I2', name: 'Another instructor' });
      d.run('cestisMarkPendingUpload()');
      d.run('_lastAutoSaveHash = null; _lastAutoSaveWriteMark = -1;');
      await d.run('autoSaveToAllFolders()');
      const staffUp = d.uploads[d.uploads.length - 1];
      assertEq((staffUp.data.attendanceRegister || []).map(r => r.studentId).join(','), 'S1,S2,S3,S4', 'a staff session\'s upload carries every mark');
      assert(!map.has('cestisPendingUpload') && !map.has('cestisUnsyncedOnSignOut'), 'and only that upload clears the note');
      d.run('logout()'); await sleep(40);
      assert(!map.has('voctrain_attendanceRegister'), 'with everything uploaded, the staff sign-out clears the device as before');
      assert(!map.has('cestisPendingUpload'), 'and no stale note is left to hold back later trainee sign-outs');
      // With nothing pending, a trainee's sign-out keeps only their own records, as before.
      map.set('voctrain_attendanceRegister', JSON.stringify(reg)); map.set('voctrain_students', JSON.stringify(roll));
      signIn('student', { id: 'U-S2' }, { id: 'S2', name: 'Trainee S2' });
      d.run('cestisMarkPendingUpload()');
      d.run('logout()'); await sleep(40);
      assertEq(regIds(), 'S2', 'with no staff work pending, a trainee\'s sign-out trims to their own marks as before');
      // A full wipe runs only once nothing is pending; a note left behind (a
      // write landing after the final upload) would hold every later trainee
      // sign-out back for good.
      map.set('cestisPendingUpload', 'instructor|late-write');
      d.run('clearAllSessionData()');
      assert(!map.has('cestisPendingUpload'), 'a full wipe takes the "pending upload" note with it');

      // The rule itself: who may clear whose note.
      const P = C.pendingUpload;
      assert(!P.covers('student', 'instructor|t') && P.covers('instructor', 'instructor|t') && P.covers('admin', 'instructor|t'), 'a trainee never clears staff work; staff do');
      assert(!P.covers('instructor', 'admin|t') && !P.covers('adminstaff', 'admin|t') && P.covers('admin', 'adminstaff|t'),
        'an instructor\'s backup does not carry an administrator\'s settings, so it does not clear an administrator\'s note');
      assertEq(P.mark('student|t', 'instructor', 'n'), 'instructor|n', 'staff work raises a trainee\'s note');
      assertEq(P.mark('instructor|t', 'admin', 'n'), 'admin|n', 'an administrator\'s raises an instructor\'s');
      assertEq(P.mark('admin|t', 'instructor', 'n'), 'admin|t', 'and an instructor\'s never lowers an administrator\'s');
      assert(P.keepOnSignOut('admin|t', 'instructor', true), 'an instructor\'s successful sign-out does not wipe an administrator\'s unsent work');
      assert(!P.keepOnSignOut('instructor|t', 'instructor', true) && P.keepOnSignOut('instructor|t', 'instructor', false), 'staff: kept until uploaded, as before');
      assert(P.keepOnSignOut('instructor|t', 'student', true) && !P.keepOnSignOut('student|t', 'student', false), 'trainee: only staff work holds the trim back');
      // The Centre's network: a successful save to its server clears what the session covers.
      const lanSrc = extractFunction(IDX, 'finalLanSaveBeforeLogout');
      assert(/if \(ok\) cestisMarkUploaded\(\);/.test(lanSrc), 'on the Centre\'s network a successful final save clears the note it covers');
      assert(/CESTISCore\.pendingUpload\.keepOnSignOut\(_pending, _leavingRole, safe\)/.test(extractFunction(IDX, 'logout')), 'sign-out decides by the shared rule');
    } catch (e) { assert(false, 'section 1 stopped: ' + (e && e.message)); }

    /* ===================================================== 2. virements */
    console.log('2. A correction to an approved virement is not undone' + tag);
    try {
      const T1 = '2026-10-01T10:00:00.000Z', T2 = '2026-10-21T10:00:00.000Z';
      const approved = { id: 'VR-1', date: '2026-10-01', project: 'Welding lab', total: 44288.25, lines: [{ fromId: 'A', toId: 'B', amount: 44288.25 }],
        status: 'Approved', approvedBy: 'Chair and Treasurer', approvalAt: T1, approvalDate: '2026-10-01', editedAt: T1,
        signatures: [{ id: 'c', name: 'Chair', at: T1 }, { id: 't', name: 'Treasurer', at: T1 }] };
      // The Virement page's edit path (Virement.Request.html): new figures, editedAt now, back to Pending.
      const VR = fs.readFileSync(path.join(B.dir, 'Virement.Request.html'), 'utf8');
      assert(VR.indexOf("existing.status = 'Pending';") !== -1 && VR.indexOf('existing.editedAt = new Date().toISOString();') !== -1, 'the page still resets an edited request to Pending');
      const edit = r => Object.assign(clone(r), { total: 39000, lines: [{ fromId: 'A', toId: 'C', amount: 39000 }], project: 'Welding lab (revised)', editedAt: T2,
        status: 'Pending', signatures: [], approvedBy: '', approvalDate: '', approvalAt: '', approvalComment: '' });

      // Google Drive, through the real page-cloud push.
      const drive = makeDrive();
      drive.put('CESTIS_Virement_Requests.json', { version: '1.0', stamps: { cesti_virements: T1 }, data: { cesti_virements: JSON.stringify([approved]) } });
      const pcMap = new Map([['schoolDashboardGoogleAccessToken', 'tok']]);
      const w = loadPage(B, pcMap, drive);
      w.CESTISPageCloud.init({ page: 'Virement Requests', file: 'CESTIS_Virement_Requests.json', keys: ['cesti_virements', 'cesti_virement_logo', 'cesti_virement_deleted_ids'] });
      await sleep(40);
      w.CESTISStore.setItem('cesti_virements', JSON.stringify([edit(JSON.parse(pcMap.get('cesti_virements'))[0])]));
      await w.CESTISPageCloud.saveNow();
      const onDrive = JSON.parse(drive.get('CESTIS_Virement_Requests.json').data.cesti_virements)[0];
      const onPc = JSON.parse(pcMap.get('cesti_virements'))[0];
      assertEq(onDrive.total + '/' + onDrive.status + '/' + onDrive.signatures.length, '39000/Pending/0', 'Drive keeps the correction, Pending, with no signatures carried over');
      assertEq(onPc.total + '/' + onPc.status + '/' + onPc.approvedBy, '39000/Pending/', 'and so does the PC that made it (no approval filled back in)');

      // The Centre's server, both ways round.
      const mergeOnServer = (stored, incoming) => JSON.parse(Store.mergeIncoming(ServerCore,
        JSON.stringify({ data: { cesti_virements: JSON.stringify([stored.r]) }, stamps: { cesti_virements: stored.at } }),
        { data: { cesti_virements: JSON.stringify([incoming.r]) }, stamps: { cesti_virements: incoming.at } }).data.cesti_virements)[0];
      let r = mergeOnServer({ r: approved, at: T1 }, { r: edit(approved), at: T2 });
      assertEq(r.total + '/' + r.status, '39000/Pending', 'the server keeps an edit pushed over the approved copy');
      r = mergeOnServer({ r: edit(approved), at: T2 }, { r: approved, at: '2026-10-21T11:00:00.000Z' });
      assertEq(r.total + '/' + r.status, '39000/Pending', 'and a stale Approved copy pushed later does not undo it');
      // Same content: a decision still beats Pending, whichever was saved later (3a99c42's rule, kept).
      const pending = Object.assign(clone(approved), { status: 'Pending', signatures: [], approvedBy: '', approvalAt: '', approvalDate: '' });
      r = mergeOnServer({ r: approved, at: T1 }, { r: pending, at: T2 });
      assertEq(r.status + '/' + r.signatures.length, 'Approved/2', 'for the same figures, the decision beats a later "Pending" copy');
      r = mergeOnServer({ r: pending, at: T2 }, { r: approved, at: T1 });
      assertEq(r.status + '/' + r.signatures.length, 'Approved/2', 'whichever side holds it');

      // One rule: the core's copy decides exactly as the page's vrMergeRequest.
      const sb = { JSON, Date, Math, Object, Array, String, Number };
      vm.createContext(sb);
      vm.runInContext(['vrContentRev', 'vrSignatures', 'vrValidSignatures', 'vrMergeRequest'].map(n => extractFunction(VR, n)).join('\n'), sb);
      const half = Object.assign(clone(pending), { status: 'Awaiting Second Signature', signatures: [{ id: 'c', name: 'Chair', at: T1, rev: C.virements.contentRev(pending) }], approvalAt: T1 });
      const other = Object.assign(clone(pending), { status: 'Awaiting Second Signature', signatures: [{ id: 't', name: 'Treasurer', at: T2 }], approvalAt: T2 });
      const rejected = Object.assign(clone(pending), { status: 'Rejected', approvalAt: T2, approvedBy: 'Chair' });
      const cases = [[approved, edit(approved)], [edit(approved), approved], [approved, pending], [pending, approved], [half, other], [other, half],
        [approved, rejected], [Object.assign(clone(rejected), { approvalAt: T1 }), approved], [pending, pending], [{ id: 'VR-9' }, approved]];
      cases.forEach(([a, b], i) => {
        assertEq(sb.vrContentRev(a), C.virements.contentRev(a), 'case ' + i + ': the same content revision');
        const x = clone(a), y = clone(a);
        const cx = sb.vrMergeRequest(x, clone(b)), cy = C.virements.mergeRequest(y, clone(b));
        assert(cx === cy && JSON.stringify(x) === JSON.stringify(y), 'case ' + i + ': the core folds two copies exactly as the Virement page does');
      });
    } catch (e) { assert(false, 'section 2 stopped: ' + (e && e.message)); }

    /* =========================================== 3. grades on the network */
    console.log('3. Coursework grades merge trainee by trainee on every path' + tag);
    try {
      const T0 = '2026-10-21T09:00:00.000Z';
      const A = { id: 'ASG-1', title: 'Weld report', maxPoints: 100, grades: {}, updatedAt: T0 };
      const server = makeLanServer();
      const d1 = new Map([['voctrain_assignments', JSON.stringify([A])]]), d2 = new Map([['voctrain_assignments', JSON.stringify([A])]]);
      const p1 = loadPage(B, d1, server, LAN_AT); await p1.CESTISPageCloud.initLan(clone(LMS)); await sleep(20);
      const p2 = loadPage(B, d2, server, LAN_AT); await p2.CESTISPageCloud.initLan(clone(LMS)); await sleep(20);
      await p1.CESTISPageCloud.saveNow(); await p2.CESTISPageCloud.saveNow();
      // Ms Green on PC 1 marks S1; Mr Brown on PC 2 marks S2 seconds later, before its refresh.
      const l1 = JSON.parse(d1.get('voctrain_assignments'));
      C.coursework.recordGrade(l1[0], 'S1', 77, 'Ms Green', '2026-10-21T09:05:00.000Z'); l1[0].updatedAt = '2026-10-21T09:05:00.000Z';
      p1.CESTISStore.setItem('voctrain_assignments', JSON.stringify(l1));
      const l2 = JSON.parse(d2.get('voctrain_assignments'));
      C.coursework.recordGrade(l2[0], 'S2', 64, 'Mr Brown', '2026-10-21T09:05:03.000Z'); l2[0].updatedAt = '2026-10-21T09:05:03.000Z';
      p2.CESTISStore.setItem('voctrain_assignments', JSON.stringify(l2));
      await p1.CESTISPageCloud.saveNow(); await p2.CESTISPageCloud.saveNow();
      await p1.CESTISPageCloud.loadNow();
      const srv = server.read('CESTIS_LMS_Dashboard.json', 'voctrain_assignments')[0];
      assertEq(Object.keys(srv.grades).sort().map(k => k + ':' + srv.grades[k]).join(','), 'S1:77,S2:64', 'the Centre\'s server keeps both instructors\' marks');
      assertEq((srv.gradeLog || []).map(g => g.studentId).sort().join(','), 'S1,S2', 'and both grade-history entries');
      const g1 = JSON.parse(d1.get('voctrain_assignments'))[0];
      assert(g1.grades.S1 === 77 && g1.grades.S2 === 64 && g1.gradeMeta.S1.gradedBy === 'Ms Green' && g1.gradeMeta.S2.gradedBy === 'Mr Brown',
        'and so does PC 1 after its refresh, each mark with who gave it');

      // A trainee resubmits from a copy pulled before Mr Brown marked S2.
      const G = '2026-10-21T09:10:00.000Z', R = '2026-10-21T09:10:04.000Z';
      const base = clone(A); C.coursework.recordGrade(base, 'S3', 55, 'Mr Brown', T0); base.updatedAt = T0;
      const instr = clone(base); C.coursework.recordGrade(instr, 'S2', 91, 'Mr Brown', G); instr.updatedAt = G;
      const trainee = clone(base); trainee.gradeMeta.S3.resubmittedAt = R; trainee.updatedAt = R;
      const pay = (rec, at) => ({ data: { voctrain_assignments: JSON.stringify([rec]) }, stamps: { voctrain_assignments: at } });
      const onServer = JSON.parse(Store.mergeIncoming(ServerCore, JSON.stringify(pay(instr, G)), pay(trainee, R)).data.voctrain_assignments)[0];
      assertEq(JSON.stringify(onServer.grades), JSON.stringify({ S3: 55, S2: 91 }), 'a resubmission from a stale copy does not erase the mark given meanwhile (server)');
      assertEq(onServer.gradeMeta.S3.resubmittedAt, R, 'and the "resubmitted" flag still reaches the instructor');

      // ONE rule on all three paths: the Drive backup (mergeList as index.html calls it), a LAN device, the server.
      const viaDrive = [clone(instr)];
      S.mergeList(viaDrive, [clone(trainee)], r => String(r.id), S.mapRules('assignments', {}));
      const viaDevice = JSON.parse(C.pageCloud.mergeKeys(pay(instr, G).data, pay(instr, G).stamps, pay(trainee, R).data, pay(trainee, R).stamps,
        { records: true }).data.voctrain_assignments)[0];
      const pick = r => JSON.stringify({ g: r.grades, m: r.gradeMeta, log: (r.gradeLog || []).map(x => x.studentId + x.points).sort() });
      assertEq(pick(viaDevice), pick(viaDrive[0]), 'a LAN device settles the grades exactly as the Drive backup does');
      assertEq(pick(onServer), pick(viaDrive[0]), 'and so does the Centre\'s server');

      // Notices: who has read / cleared one, person by person, on the network too.
      const n0 = { id: 'N-1', message: 'Exam moved', readBy: {}, clearedBy: {}, updatedAt: T0 };
      const nA = Object.assign(clone(n0), { readBy: { 'U-A': '2026-10-21T09:01:00.000Z' }, updatedAt: '2026-10-21T09:01:00.000Z' });
      const nB = Object.assign(clone(n0), { readBy: { 'U-B': '2026-10-21T09:02:00.000Z' }, clearedBy: { 'U-B': '2026-10-21T09:02:00.000Z' }, updatedAt: '2026-10-21T09:02:00.000Z' });
      const npay = (rec, at) => ({ data: { voctrain_notifications: JSON.stringify([rec]) }, stamps: { voctrain_notifications: at } });
      const nSrv = JSON.parse(Store.mergeIncoming(ServerCore, JSON.stringify(npay(nA, nA.updatedAt)), npay(nB, nB.updatedAt)).data.voctrain_notifications)[0];
      assertEq(Object.keys(nSrv.readBy).sort().join(','), 'U-A,U-B', 'two people reading a notice on two PCs both stay "read"');
      assertEq(Object.keys(nSrv.clearedBy).join(','), 'U-B', 'and one person clearing it clears it for that person only');

      // The dashboard asks the core for these rules on every Drive path.
      const merge = extractFunction(IDX, 'mergeBackupData');
      assert(merge.indexOf("CESTISCore.sync.mapRules('assignments', { tombs: syncTombsFor('instructorAssignments') })") !== -1, 'the Drive backup merges assignments by the core\'s rule');
      assert(merge.indexOf("CESTISCore.sync.mapRules('notifications', { tombs: syncTombsFor('notifications') })") !== -1, 'and notifications');
      assert(extractFunction(IDX, 'syncAssignmentsFromDrive').indexOf("CESTISCore.sync.mapRules('assignments'") !== -1, 'and the assignments side file');
      assertEq(C.pageCloud.recordSpec('voctrain_assignments').maps + '/' + C.pageCloud.recordSpec('voctrain_notifications').maps, 'assignments/notifications',
        'the network\'s record merge names the same rules');
    } catch (e) { assert(false, 'section 3 stopped: ' + (e && e.message)); }

    /* ==================================================== 4. exam rename */
    console.log('4. An exam renamed on an old-code device is not deleted' + tag);
    try {
      const E = C.exams;
      const U0 = '2026-09-01T10:00:00.000Z', nowOld = '2026-10-20T09:00:00.000Z';
      const exam = { id: 'EXAM-1700000000', title: 'Unit 4 Test', course: 'Welding', questionData: [{ id: 'q1', text: 'TIG?' }], updatedAt: U0 };
      const quiz = { id: 'EXAM-2', title: 'Safety Quiz', course: 'Welding', updatedAt: U0 };
      // The old code keyed exams by title|programme: a rename is a removal of the old key, written down as a tombstone.
      const oldDevice = [clone(exam)];
      const idx = S.stampChanges(oldDevice, E.legacyKey, null, '');
      oldDevice[0].title = 'Unit 4 Practical Test';
      const legacyTombs = {};
      S.detectRemovals(oldDevice, E.legacyKey, idx).forEach(k => { legacyTombs[k] = nowOld; });
      assertEq(Object.keys(legacyTombs).join(), 'unit 4 test|welding', 'the old device writes a legacy tombstone for the old title');
      // A new device merges its upload (mergeBackupData's exam branch).
      const local = [clone(exam), clone(quiz)];
      const out = S.mergeList(local, clone(oldDevice), E.syncKey, { tombs: E.translateLegacyTombs(legacyTombs, local, clone(oldDevice)) });
      assertEq(out.removed, 0, 'the renamed exam is not taken for a deleted one');
      assert(local.some(e => e.id === exam.id && e.questionData.length === 1), 'it stays, with its question bank');
      const idIdx = S.stampChanges([exam, quiz], E.syncKey, null, '');
      assertEq(S.detectRemovals(local, E.syncKey, idIdx).length, 0, 'so no id tombstone goes out to the other devices');
      // A real deletion on the old device still travels: the exam is absent from what it sent.
      const del = [clone(quiz)];
      const delTombs = { 'unit 4 test|welding': nowOld };
      const local2 = [clone(exam), clone(quiz)];
      S.mergeList(local2, del, E.syncKey, { tombs: E.translateLegacyTombs(delTombs, local2, del) });
      assert(!local2.some(e => e.id === exam.id), 'an exam the old device really deleted is still deleted here');
      // A legacy deletion this device already holds is not turned on an exam another device still sends.
      const tr = E.translateLegacyTombs({ 'unit 4 test|welding': nowOld }, [clone(exam)], [clone(exam)]);
      assert(!tr[exam.id], 'a legacy tombstone is not carried onto an exam that arrived alive');
      assert(/CESTISCore\.exams\.translateLegacyTombs\(syncTombsFor\('exams'\), exams, backupData\.data\.exams\)/.test(extractFunction(IDX, 'mergeBackupData')),
        'the dashboard passes this device\'s exams first, then what arrived');
    } catch (e) { assert(false, 'section 4 stopped: ' + (e && e.message)); }

    /* ================================================= 5. Import Backup */
    console.log('5. Import Backup restores records inside one stored value, and says what it could not' + tag);
    try {
      const R = C.backupRestore;
      // A Cashbook quarter on a device that has re-entered one cheque since the loss.
      const localQ = JSON.stringify({ openingBalance: 0, transactions: [{ id: 100, uid: 'u-new', date: '2026-10-02', details: 'Re-entered', deposit: 50 }], deletedTxnIds: [] });
      const backupQ = { openingBalance: 1200, openingBalanceAt: '2026-07-01T00:00:00Z', deletedTxnIds: [],
        transactions: Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, uid: 'u' + i, date: '2026-07-' + String(1 + (i % 28)).padStart(2, '0'), details: 'Cheque ' + i, payment: 10 * i })) };
      const q = JSON.parse(R.mergeValue('cestis_quarter_2026/2027_Q2', localQ, backupQ));
      assertEq(q.transactions.length, 41, 'all 40 cheques come back beside the one re-entered here');
      assertEq(q.openingBalance, 1200, 'with the backup\'s dated opening balance');
      assertEq(new Set(q.transactions.map(t => t.id)).size, 41, 'each with its own number in this quarter');
      // Payroll: employees by name, runs by date, each run's results by employee (the Payslip page's rule).
      const backupPay = { settings: { incomeTax: 25, nisEmp: 3 }, deleted: {},
        employees: [{ name: 'Ann Lee', salary: 120000 }, { name: 'Bob Ray', salary: 90000 }],
        payrollRuns: [{ date: '2026-09-30', results: [{ empName: 'Ann Lee', net: 100 }, { empName: 'Bob Ray', net: 80 }] }] };
      const skeleton = JSON.stringify({ settings: { incomeTax: 30, nisEmp: 3 }, employees: [], payrollRuns: [] });
      const onSkel = JSON.parse(R.mergeValue('cestisPayroll', skeleton, backupPay));
      assert(onSkel.employees.length === 2 && onSkel.payrollRuns.length === 1 && onSkel.settings.incomeTax === 25,
        'onto the page\'s empty start-up payroll the backup comes back whole, the Centre\'s own rates included');
      const here = JSON.stringify({ settings: { incomeTax: 25 }, employees: [{ name: 'New Hire', salary: 50000 }],
        payrollRuns: [{ date: '2026-10-31', results: [{ empName: 'New Hire', net: 40 }] }] });
      const merged = JSON.parse(R.mergeValue('cestisPayroll', here, backupPay));
      assertEq(merged.employees.map(e => e.name).join(','), 'New Hire,Ann Lee,Bob Ray', 'every employee comes back beside the one added here');
      assertEq(merged.payrollRuns.map(r => r.date + ':' + r.results.length).join(','), '2026-10-31:1,2026-09-30:2', 'and every payroll run with its results');
      const withDel = JSON.stringify(Object.assign(JSON.parse(here), { deleted: { 'emp:bob ray': '2026-10-15T00:00:00Z' } }));
      assert(!JSON.parse(R.mergeValue('cestisPayroll', withDel, backupPay)).employees.some(e => e.name === 'Bob Ray'), 'an employee deleted here since stays deleted');
      // ...exactly as the Payslip page merges.
      const PS = fs.readFileSync(path.join(B.dir, 'Staff.Payslip.html'), 'utf8');
      const psb = { JSON, Date, Math, Object, Array, String, Number, window: {} };
      vm.createContext(psb);
      vm.runInContext('var DATA = null; var _psSyncIndex = null;\n' + ['_psKeyEmp', '_psKeyRun', '_psKeyRes', '_psStamp', '_psStampOf', '_psBlank', '_psFold', '_mergeDataIntoLocal']
        .map(n => extractFunction(PS, n)).join('\n'), psb);
      const pairs = [[JSON.parse(here), backupPay], [JSON.parse(withDel), backupPay],
        [{ employees: [{ name: 'Ann Lee', salary: 1, updatedAt: '2026-10-01T00:00:00Z' }], payrollRuns: [{ date: '2026-09-30', note: 'x', results: [{ empName: 'Ann Lee', net: 5 }] }], settings: { incomeTax: 20 } },
         { employees: [{ name: 'ann lee', salary: 2, updatedAt: '2026-09-01T00:00:00Z' }], payrollRuns: [{ date: '2026-09-30', note: '', extra: 'y', results: [{ empName: 'Ann Lee', net: 9, updatedAt: '2026-10-05T00:00:00Z' }] }],
           settings: { incomeTax: 25, updatedAt: '2026-10-02T00:00:00Z' }, deleted: { 'run:2026-08-31': '2026-10-01T00:00:00Z' } }]];
      pairs.forEach(([a, b], i) => {
        psb.DATA = clone(a); vm.runInContext('DATA = this.DATA; var __s = _mergeDataIntoLocal(' + JSON.stringify(b) + ');', psb);
        const mine = clone(a); const sum = C.payroll.mergeData(mine, clone(b));
        assert(JSON.stringify(vm.runInContext('DATA', psb)) === JSON.stringify(mine) && JSON.stringify(vm.runInContext('__s', psb)) === JSON.stringify(sum),
          'payroll case ' + i + ': the core merges exactly as the Payslip page does');
      });
      // Records with no id (old weekly attendance rows) and the dated register.
      const wk = JSON.parse(R.mergeValue('voctrain_attendance', JSON.stringify([{ studentId: 'S1', days: { Mon: 'present' } }]),
        [{ studentId: 'S2', days: { Mon: 'present' } }, { studentId: 'S3', days: { Tue: 'late' } }]));
      assertEq(wk.map(r => r.studentId).join(','), 'S1,S2,S3', 'old weekly rows with no id are restored');
      const regHere = []; C.attendance.mark(regHere, { studentId: 'S1', date: '2026-10-20', status: 'present', by: 'U' });
      const regBak = []; C.attendance.mark(regBak, { studentId: 'S2', date: '2026-10-19', status: 'absent', by: 'U' });
      assertEq(JSON.parse(R.mergeValue('voctrain_attendanceRegister', JSON.stringify(regHere), regBak)).length, 2, 'the dated register is merged mark by mark');
      const odd = JSON.parse(R.mergeValue('cestis_finance_misc', JSON.stringify([{ a: 1 }]), [{ a: 1 }, { b: 2 }]));
      assertEq(JSON.stringify(odd), '[{"a":1},{"b":2}]', 'any list: a record with no id is added unless this device holds exactly it');
      // What cannot be merged is reported, not passed off as restored.
      assert(R.mergeKey('voctrain_systemSettings', '{"x":1}', { x: 2 }).kept, 'a setting held here with another value is reported as kept');
      assert(R.mergeKey('voctrain_students', '{not json', [{ id: 'S1' }]).kept, 'so is a stored value that cannot be read');
      assert(!R.mergeKey('voctrain_studentProfiles', '{"S1":{"a":1}}', { S2: { b: 2 } }).kept, 'a merge that took everything in reports nothing');
      // Deletions this device holds are honoured by the record merges.
      const delCtx = { read: k => (k === 'voctrain_deletedStudentIds' ? '["S9"]' : null) };
      assert(!JSON.parse(R.mergeKey('voctrain_students', '[{"id":"S1","name":"A","course":"W"}]', [{ id: 'S9', name: 'Gone', course: 'W' }], delCtx).value || '[]').some(s => s.id === 'S9'),
        'a trainee deleted here is not brought back by the backup');
      assertEq(R.restoreOrder(['voctrain_students', 'voctrain_syncTombstones', 'voctrain_deletedUserIds']).slice(0, 2).sort().join(),
        'voctrain_deletedUserIds,voctrain_syncTombstones', 'every deletion list is restored before the records');

      // The real Import Backup, end to end.
      const IMP = extractFunction(IDX, 'importDataBackup');
      const map = new Map([['cestis_quarter_2026/2027_Q2', localQ], ['cestisPayroll', skeleton], ['voctrain_systemSettings', '{"x":1}']]);
      const toasts = [];
      let input = null;
      const sb = {
        JSON, Object, Array, String, Date, Math, console: { log() {}, warn() {}, error() {} }, CESTISCore: C, CESTISStore: storeOn(map),
        currentRole: 'admin', currentLoggedInUser: { id: 'A' }, showToast: (m, t) => toasts.push({ m, t }), stopAutoSave() {}, _debouncedCloudSaveTimer: null,
        _sessionWiped: false, _originalConfirm: { call: () => true }, setTimeout: () => 0, clearTimeout() {}, location: { reload() {} },
        document: { createElement: () => (input = { click() {} }) },
        FileReader: function () { this.readAsText = f => this.onload({ target: { result: f.text } }); }
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(IMP, sb);
      vm.runInContext('importDataBackup()', sb);
      const file = { version: '1.0', exportedAt: '2026-10-01', data: { 'cestis_quarter_2026/2027_Q2': backupQ, cestisPayroll: backupPay, voctrain_systemSettings: { x: 2 } } };
      input.onchange({ target: { files: [{ text: JSON.stringify(file) }] } });
      assertEq(JSON.parse(map.get('cestis_quarter_2026/2027_Q2')).transactions.length, 41, 'Import Backup restores the quarter\'s cheques');
      assertEq(JSON.parse(map.get('cestisPayroll')).employees.length, 2, 'and the payroll');
      assertEq(map.get('voctrain_systemSettings'), '{"x":1}', 'and leaves a setting held here as it is');
      const t = toasts[toasts.length - 1];
      assert(t && /2 collection\(s\) updated; 1 kept as they are on this device: voctrain_systemSettings/.test(t.m) && t.t === 'warning',
        'and says which key it kept instead of a blanket "merged"');
    } catch (e) { assert(false, 'section 5 stopped: ' + (e && e.message)); }

    /* ==================================================== 6. a fast clock */
    console.log('6. An edit made on a clock days fast is not thrown away' + tag);
    try {
      const key = r => String(r.id);
      const realNow = Date.parse('2026-10-21T12:00:00.000Z'), fastNow = realNow + 3 * DAY;
      const T0 = '2026-10-01T09:00:00.000Z';
      const base = { id: 'EXAM-1', title: 'Unit 4', instructions: 'Old text', passMark: 60, updatedAt: T0 };
      // Device F (clock 3 days fast) edits; device C (right clock) merges F's upload.
      const F = [clone(base)];
      const idx = S.stampChanges(F, key, null, '');
      F[0].instructions = 'Corrected text'; F[0].passMark = 50;
      S.stampChanges(F, key, idx, new Date(fastNow).toISOString());
      const Cd = [clone(base)];
      S.mergeList(Cd, clone(F), key, { nowMs: realNow });
      assertEq(Cd[0].instructions, 'Old text', 'a copy dated days ahead still cannot overwrite a dated edit elsewhere');
      // F's clock is put right; F merges C's copy: its own edit is re-dated, not lost.
      S.mergeList(F, clone(Cd), key, { nowMs: realNow + 3600000 });
      assertEq(F[0].instructions + ' ' + F[0].passMark, 'Corrected text 50', 'once its clock is right, F keeps its own edit');
      assertEq(F[0].updatedAt, new Date(realNow + 3600000).toISOString(), 're-dated to the correct time');
      S.mergeList(Cd, clone(F), key, { nowMs: realNow + 2 * 3600000 });
      assertEq(Cd[0].instructions + ' ' + Cd[0].passMark, 'Corrected text 50', 'and the edit then reaches the other device');

      // While the clock is still wrong, the offset measured against a server dates edits correctly.
      S.setClockOffset(-3 * DAY);
      try {
        const now = S.nowIso();
        assert(Math.abs(Date.parse(now) - (Date.now() - 3 * DAY)) < 2000, 'the corrected clock reads the server\'s time');
        const F2 = [Object.assign(clone(base), { updatedAt: new Date(Date.now() + 2 * DAY).toISOString() })];  // dated before the offset was known
        const i2 = S.stampChanges(F2, key, null, '');
        S.stampChanges(F2, key, i2, S.nowIso());
        assert(Date.parse(F2[0].updatedAt) <= S.now(), 'a save re-dates a copy dated days ahead to the correct time');
        assertEq(S.trusted(Date.now()), 0, 'and merges judge "the future" by the corrected clock (this device\'s raw time is days ahead of it)');
        // A grade given on the fast clock: the grader's own entry stands and is re-dated.
        const a = { id: 'ASG-1', grades: { S1: 70 }, gradeMeta: { S1: { gradedBy: 'F', gradedAt: new Date(Date.now() + 2 * DAY).toISOString() } }, updatedAt: T0 };
        const older = { id: 'ASG-1', grades: { S1: 40 }, gradeMeta: { S1: { gradedBy: 'X', gradedAt: '2026-10-01T00:00:00.000Z' } }, updatedAt: T0 };
        const mine = [clone(a)];
        S.mergeList(mine, [clone(older)], key, S.mapRules('assignments', {}));
        assertEq(mine[0].grades.S1, 70, 'a mark given on a fast clock is not outvoted by an older one on its own device');
        assert(Date.parse(mine[0].gradeMeta.S1.gradedAt) <= S.now() + 1000, 'and it is re-dated so other devices believe it');
        const theirs = [clone(older)];
        S.mergeList(theirs, clone(mine), key, S.mapRules('assignments', {}));
        assertEq(theirs[0].grades.S1, 70, 'so it reaches them');
        // An exam result reviewed on the fast clock.
        const res = [{ id: 'R1', examId: 'E', studentId: 'S1', score: 90, reviewComplete: true, reviewedAt: new Date(Date.now() + 2 * DAY).toISOString(), updatedAt: T0 }];
        S.mergeExamResults(res, [{ id: 'R1', examId: 'E', studentId: 'S1', score: 50, reviewComplete: true, reviewedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }], {});
        assertEq(res[0].score, 90, 'a review made on the fast clock stands on its own device');
        assert(Date.parse(res[0].reviewedAt) <= S.now() + 1000, 'and is re-dated');

        // The page-cloud dates its writes by the same corrected clock off the Centre's network.
        const pg = loadPage(B, new Map(), null);
        pg.CESTISCore.sync.setClockOffset(-3 * DAY);
        assert(Math.abs(Date.parse(pg.CESTISPageCloud.now()) - (Date.now() - 3 * DAY)) < 2000, 'page-cloud "now" uses the corrected clock');
      } finally { S.setClockOffset(0); }
      // On the Centre's network the server's clock becomes the merge clock too.
      const ahead = 2 * DAY;
      const lanPage = loadPage(B, new Map(), makeLanServer({ serverAheadMs: ahead }), LAN_AT);
      await lanPage.CESTISPageCloud.lan();
      assert(Math.abs(lanPage.CESTISCore.sync.clockOffset() - ahead) < 2000, 'the Centre server\'s time sets the merge clock on its network');
      // The dashboard records Google's time when this clock is wrong.
      const sb = { console: { log() {}, warn() {} }, Date, Math, CESTISCore: C, showToast() {} };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext('var _clockWarned = false;\n' + extractFunction(IDX, 'cestisNoteServerClock'), sb);
      const sent = Date.now();
      try {
        sb.cestisNoteServerClock({ headers: { get: h => (h === 'Date' ? new Date(sent - 3 * DAY).toUTCString() : null) } }, sent);
        assert(Math.abs(S.clockOffset() + 3 * DAY) < 3000, 'a Drive response from a device 3 days fast sets the correction');
        sb.cestisNoteServerClock({ headers: { get: h => (h === 'Date' ? new Date(Date.now()).toUTCString() : null) } }, Date.now());
        assertEq(S.clockOffset(), 0, 'and a clock that is right again clears it');
      } finally { S.setClockOffset(0); }
      assert(/CESTISPageCloud\.now\(\) : CESTISCore\.sync\.nowIso\(\)/.test(extractFunction(IDX, 'syncStampAll')), 'the dashboard stamps edits by the corrected clock');
    } catch (e) { assert(false, 'section 6 stopped: ' + (e && e.message)); }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
