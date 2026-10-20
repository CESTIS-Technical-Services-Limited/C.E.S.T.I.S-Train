/* The record pages answer to the signed-in session, not to their address bar.

   What happened (transcripts-01, ui-14, accounts-06, admin-12, admin-02,
   admin-20 / accounts-19, and the verifiers' admin#1, admin#2 and sync#3):
     - Transcript-Grades.html read `?role=` and defaulted to 'admin': opened
       by its bare address on a synced lab PC it gave a trainee the grade
       editor and every trainee's date of birth, address and ID number, and
       `?studentId=` chose whose grades a trainee saw. The request queue and
       Student Progress checked nothing at all; Student Progress certified,
       deleted and re-id'd trainees for whoever opened it — including Admin
       Staff granted only "View student data". Staff.Clock.in.html signed the
       visitor in as the first Admin on the staff list.
     - Student Progress kept accounts under a key the sign-in never reads, so a
       trainee deleted there kept a working login.
     - the dashboard acted on 'students-updated' from ANY window: a forged
       {deleted:{…}} removed a trainee's School Fee record and payments.
     - a trainee's top search box listed every trainee on the roll.
     - a trainee's device kept every trainee's transcript profile after logout.

   Pinned here:
     - CESTISCore.sessionAccess.resolve: no live session → nothing; the URL
       may only narrow a role, never widen it, and never picks a trainee's id;
       a hand-edited role key needs the stored account to back it up;
     - each record page resolves its viewer through sessionAccess and has no
       "default to admin" left; Student Progress no longer touches the
       phantom account key or creates logins; Admin Staff need the separate
       'studentsmanage' grant to change anything;
     - the dashboard's message handler only listens to its own frames, only
       applies a deletion for a session allowed to make it, and removes (and
       tombstones) the deleted trainee's login;
     - the top search box searches only what the role may see;
     - a trainee's logout keeps only their own transcript data.

   Run: node tests/record-page-session-gate.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
const SRC = read('index.html');
const Core = require('../cestis-core.js');
const SA = Core.sessionAccess;

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. The rule ---------- */
console.log('Who is looking comes from the live session, never from the address');
const NOW = Date.parse('2026-10-20T10:00:00Z');
const USERS = [
  { id: 'USR-A', role: 'admin', name: 'Ada Admin', status: 'active' },
  { id: 'USR-S', role: 'student', name: 'Sue Trainee', status: 'active', studentDataId: 'STU-sue' },
  { id: 'USR-X', role: 'student', name: 'Ex Trainee', status: 'disabled', studentDataId: 'STU-ex' }
];
function store(over) {
  const d = Object.assign({ voctrain_users: JSON.stringify(USERS), voctrain_sessionExpiry: String(NOW + 3600e3),
    voctrain_sessionSeenAt: String(NOW - 30e3) }, over || {});
  return function (k) { return d[k] == null ? null : d[k]; };
}
const ALL = ['admin', 'adminstaff', 'instructor', 'student'];
let v = SA.resolve({ get: store({}), now: NOW, allowed: ALL, urlRole: 'admin' });
assertEq(v.ok, false, 'no session at all: the bare address (or ?role=admin) opens nothing');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'admin', voctrain_sessionUserId: 'USR-A', voctrain_sessionExpiry: String(NOW - 1) }), now: NOW, allowed: ALL });
assertEq(v.ok, false, 'an expired session opens nothing');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'admin', voctrain_sessionUserId: 'USR-A', voctrain_sessionSeenAt: String(NOW - 3600e3) }), now: NOW, allowed: ALL });
assertEq(v.ok, false, 'nor does one whose dashboard was closed (no heartbeat for an hour)');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'student', voctrain_sessionUserId: 'USR-S', voctrain_sessionStudentId: 'STU-sue' }), now: NOW, allowed: ALL, urlRole: 'admin', urlStudentId: 'STU-classmate' });
assertEq(v.ok && v.role, 'student', 'a trainee asking for ?role=admin still gets the trainee view');
assertEq(v.studentId, 'STU-sue', 'and their OWN record, whatever ?studentId= says');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'admin', voctrain_sessionUserId: 'USR-S' }), now: NOW, allowed: ALL });
assertEq(v.ok, false, 'a role key edited by hand, not backed by the stored account, opens nothing');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'student', voctrain_sessionUserId: 'USR-X' }), now: NOW, allowed: ALL });
assertEq(v.ok, false, 'an account switched off since sign-in opens nothing');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'student', voctrain_sessionUserId: 'USR-S' }), now: NOW, allowed: ['admin', 'adminstaff'] });
assertEq(v.ok + '/' + v.reason, 'false/not-allowed', 'a trainee is not let into a staff-only page');
v = SA.resolve({ get: store({ voctrain_sessionRole: 'admin', voctrain_sessionUserId: 'USR-A' }), now: NOW, allowed: ALL, urlRole: 'student', urlStudentId: 'STU-sue' });
assertEq(v.ok && v.role + '/' + v.studentId, 'student/STU-sue', 'an administrator may NARROW to preview a trainee\'s page');
v = SA.resolve({ get: store({}), now: NOW, allowed: ALL, parent: { role: 'instructor', userId: 'USR-I' } });
assertEq(v.ok && v.role, 'instructor', 'embedded in the signed-in dashboard, the dashboard\'s session is the viewer');
assertEq(SA.resolve({ get: store({}), now: NOW, allowed: ALL, parent: { role: 'student', userId: 'USR-S', studentId: 'STU-sue' }, urlStudentId: 'STU-other' }).studentId,
  'STU-sue', 'and the embedding trainee is still only ever shown their own record');

/* ---------- 2. Every record page uses it ---------- */
console.log('Each record page resolves its viewer from the session');
const TG = read('Transcript-Grades.html'), CTR = read('Cert-Transcript-Requests.html'),
      SP = read('Student-Progress.html'), CLK = read('Staff.Clock.in.html');
assert(TG.indexOf("param('role') || 'admin'") === -1, 'Transcript-Grades no longer defaults to the admin editor');
assert(/CESTISCore\.sessionAccess\.forPage\(\{ allowed: \['admin', 'adminstaff', 'instructor', 'student'\] \}\)/.test(TG), 'Transcript-Grades asks the session who is looking');
assert(/if \(!VIEWER\.ok\) \{ renderForRole\(\); return; \}/.test(TG), 'and with no session reads, renders and writes nothing');
assert(/function myStudentRecord\(\) \{[\s\S]*?MY_STUDENT_ID \? studentById\(MY_STUDENT_ID\)/.test(TG) && TG.indexOf("var MY_STUDENT_ID = VIEWER.ok ? (VIEWER.studentId || '') : ''") !== -1,
  'a trainee\'s record comes from the session, not ?studentId=');
assert(/readOnly: true,\s*\n\s*reads: _tgSignedIn \?/.test(TG), 'only staff push the grade file; anyone else only reads it');
assert(/forPage\(\{ allowed: \['admin', 'adminstaff'\] \}\)/.test(CTR) && /function setStatus\(idx, status\) \{\s*if \(!VIEWER\.ok\) return;/.test(CTR),
  'the request queue is staff-only and changes nothing without a session');
assert(/forPage\(\{ allowed: \['admin', 'adminstaff'\] \}\)/.test(SP), 'Student Progress is staff-only');
// (There is no regenerateStudentId any more: a hand-made id orphaned every record
// that follows a trainee — transcripts-22.)
assert(SP.indexOf('function regenerateStudentId(') === -1 && SP.indexOf('regenerateIdBtn') === -1, 'Student Progress offers no Regenerate ID');
['openUpdateStage', 'updateStudentStage', 'openEditStudent', 'saveEditStudent', 'openDeleteStudent', 'confirmDeleteStudent', 'addStudent']
  .forEach(function (fn) { assert(new RegExp('function ' + fn + '\\([^)]*\\) \\{\\s*if\\(spRefuseEdit\\(\\)\\) return;').test(SP), 'Student Progress ' + fn + '() refuses a view-only session'); });
assert(SP.indexOf("getItem('voctrain_userAccounts')") === -1 && SP.indexOf("spSaveCollection('voctrain_userAccounts'") === -1 &&
  !/SP_SHARED_KEYS = [^;]*'voctrain_userAccounts'/.test(SP), 'Student Progress no longer reads or writes the phantom account key');
assert(!/userAccounts\.push\(/.test(extractFunction(SP, 'addStudent')) && SP.indexOf('__CESTIS_SALT_2026__') === -1,
  'and no longer makes a login with a first-name password');
assert(!/spSaveCollection\('voctrain_users'/.test(SP), 'and never writes the real accounts either');
assert(CLK.indexOf("staffMembers.find(s => s.role === 'Admin') || staffMembers[0]") === -1 && SRC.indexOf("staffMembers.find(s => s.role === 'Admin') || staffMembers[0]") === -1,
  'the time clock never signs a visitor in as the first Admin');
assert(/sessionAccess\.forPage\(\{ allowed: \['admin', 'adminstaff', 'instructor'\] \}\)/.test(CLK), 'the stand-alone time clock takes its user from the session');
assert(/role: \(window\.VIEWER && window\.VIEWER\.ok && window\.VIEWER\.role\) \|\| 'none'/.test(read('megadata/pages/tg-page.js')),
  'the MegaData actor carries the real viewer role, not a hard-coded admin');

// Student Progress: view vs manage.
function spManage(viewer, grid) {
  const sb = { SP_VIEWER: viewer, window: {}, CESTISStore: { getItem: function () { return grid ? JSON.stringify(grid) : null; } } };
  sb.window.parent = sb.window;
  vm.createContext(sb);
  vm.runInContext(extractFunction(SP, 'spCanManage'), sb);
  return vm.runInContext('spCanManage()', sb);
}
assertEq(spManage({ ok: true, role: 'admin' }), true, 'an Administrator manages the roll');
assertEq(spManage({ ok: true, role: 'adminstaff' }, { students: true }), false, 'Admin Staff with "view student data" only VIEW it');
assertEq(spManage({ ok: true, role: 'adminstaff' }, { students: true, studentsmanage: true }), true, 'the separate manage grant lets them change it');
assertEq(spManage({ ok: false }), false, 'nobody manages without a session');
assert(/studentsmanage:false/.test(SRC) && /key:'studentsmanage'/.test(SRC), 'the grant exists in the access grid and defaults to off');

/* ---------- 3. The dashboard listens only to its own frames ---------- */
console.log('The dashboard acts only on messages from its own frames, for a session allowed to');
{
  const frames = { studentProgressFrame: { contentWindow: { tag: 'sp' } }, asStudentProgressFrame: { contentWindow: { tag: 'asp' } } };
  const sb = { document: { getElementById: function (id) { return frames[id] || null; } }, location: { origin: 'https://cestis.example' } };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'cestisMessageFromFrames'), sb);
  sb.ids = ['studentProgressFrame', 'asStudentProgressFrame'];
  sb.ev = { source: frames.studentProgressFrame.contentWindow, origin: 'https://cestis.example' };
  assertEq(vm.runInContext('cestisMessageFromFrames(ev, ids)', sb), true, 'the Student Progress frame is heard');
  sb.ev = { source: { tag: 'some other window' }, origin: 'https://cestis.example' };
  assertEq(vm.runInContext('cestisMessageFromFrames(ev, ids)', sb), false, 'any other window is not');
  sb.ev = { source: frames.studentProgressFrame.contentWindow, origin: 'https://evil.example' };
  assertEq(vm.runInContext('cestisMessageFromFrames(ev, ids)', sb), false, 'nor another site, even via a known frame');
  const h = SRC.slice(SRC.indexOf("if(e.data && e.data.type === 'students-updated') {"), SRC.indexOf("if(e.data && e.data.type === 'students-updated') {") + 400);
  assert(/if \(!cestisMessageFromFrames\(e, STUDENT_PROGRESS_FRAMES\)\) return;/.test(h), 'students-updated checks its sender first');
  assert(/if \(e\.data\.deleted && studentProgressManageAllowed\(\)\)/.test(SRC) && /if \(e\.data\.renamed && studentProgressManageAllowed\(\)\)/.test(SRC),
    'a deletion or rename is applied only for a session allowed to make it');
  assert(/type === 'transcript-data-updated'\) \{\s*if \(!cestisMessageFromFrames\(e, TRANSCRIPT_FRAMES\)\) return;/.test(SRC), 'the transcript frames\' notices are checked too');
  assert(/cestisMessageFromFrames\(ev, \['feeManagementFrame', 'asFeeManagementFrame'\]\)/.test(SRC), 'and the fee roll only comes from the School Fee frame');

  const deleted = [];
  const sb2 = { userAccounts: [
      { id: 'U1', role: 'student', studentDataId: 'STU-gone' },
      { id: 'U2', role: 'student', studentDataId: Core.stableStudentId({ name: 'Gone Person', course: 'Plumbing' }) },
      { id: 'U3', role: 'student', studentDataId: 'STU-kept' }, { id: 'U4', role: 'admin' }],
    CESTISCore: Core, recordDeletedUser: function (id) { deleted.push(id); }, saveUserAccounts: function () {} };
  vm.createContext(sb2);
  vm.runInContext(extractFunction(SRC, 'removeAccountsForDeletedStudent'), sb2);
  const n = vm.runInContext("removeAccountsForDeletedStudent({ id: 'STU-gone', name: 'Gone Person', course: 'Plumbing' })", sb2);
  assertEq(n, 2, 'the deleted trainee\'s login(s) go, by record id and by stable id');
  assertEq(deleted.sort().join(','), 'U1,U2', 'each written down as deleted so no sync hands it back');
  assertEq(sb2.userAccounts.map(function (u) { return u.id; }).join(','), 'U3,U4', 'nobody else\'s login is touched');
  assert(/if\(studentAccountTombstoned\(userAccount\)\)/.test(SRC), 'and a deleted trainee signing in is not given a fresh record');
}

/* ---------- 4. The search box ---------- */
console.log('The top search box searches only what the role may see');
{
  const roll = [{ id: 'S1', name: 'Alpine Other', course: 'Cosmetology' }, { id: 'S2', name: 'Sue Trainee', course: 'Plumbing' }];
  const exams = [{ title: 'Plumbing Final', course: 'Plumbing' }, { title: 'Cosmo Final', course: 'Cosmetology' }];
  let p = SA.searchPool('student', { students: roll, exams: exams, me: roll[1] });
  assertEq(p.students.map(function (s) { return s.id; }).join(','), 'S2', 'a trainee finds only themselves');
  assertEq(p.exams.map(function (e) { return e.title; }).join(','), 'Plumbing Final', 'and their own programme\'s exams');
  p = SA.searchPool('instructor', { students: roll, exams: exams, myCourse: 'Cosmetology' });
  assertEq(p.students.map(function (s) { return s.id; }).join(','), 'S1', 'an instructor searches their own programme');
  assertEq(SA.searchPool('cmc', { students: roll, exams: exams }).students.length, 0, 'the Board searches no trainees');
  assertEq(SA.searchPool('admin', { students: roll, exams: exams }).students.length, 2, 'staff search the roll');
  const gs = extractFunction(SRC, 'initGlobalSearch');
  assert(gs.indexOf('CESTISCore.sessionAccess.searchPool(currentRole') !== -1 && !/[^.]students\.forEach\(/.test(gs), 'initGlobalSearch uses the pool, not the whole roll');
  assert(/if\(input\._cestisSearchBound\) return;/.test(gs), 'and wires its listeners once, however often people sign in');
}

/* ---------- 5. A trainee's logout keeps only their own transcript data ---------- */
console.log('A trainee\'s logout leaves only their own transcript data on the device');
{
  const data = {
    voctrain_transcriptGrades: JSON.stringify([{ id: 'g1', studentId: 'STU-me' }, { id: 'g2', studentId: 'STU-other' }]),
    voctrain_certTranscriptRequests: JSON.stringify([{ id: 'r1', studentId: 'STU-other' }, { id: 'r2', studentId: 'STU-me' }]),
    voctrain_transcriptProfiles: JSON.stringify({ 'STU-me': { dob: '2000' }, 'STU-other': { dob: '1999', idNo: 'X' } })
  };
  const st = { getItem: function (k) { return data[k] == null ? null : data[k]; }, setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; } };
  const sb = { CESTISStore: st, currentRole: 'student', currentStudent: { id: 'STU-me', name: 'Me' }, currentLoggedInUser: { id: 'USR-me' },
    students: [], examResults: [], studentProfiles: {}, attendanceRecords: [], console: console, indexedDB: { deleteDatabase: function () {} },
    adminStaffAccessDefaults: function () { return {}; }, _sessionWiped: false };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'clearSensitiveStudentData') + '\nclearSensitiveStudentData();', sb);
  assertEq(JSON.parse(data.voctrain_transcriptGrades).map(function (g) { return g.id; }).join(','), 'g1', 'only their own grades stay');
  assertEq(JSON.parse(data.voctrain_certTranscriptRequests).map(function (g) { return g.id; }).join(','), 'r2', 'only their own requests');
  assertEq(Object.keys(JSON.parse(data.voctrain_transcriptProfiles)).join(','), 'STU-me', 'and nobody else\'s date of birth, address or ID number');
}

/* ---------- 6. The portal opened is the account's own ---------- */
console.log('enterApp opens only the portal the signed-in account holds');
assert(/if\(!currentLoggedInUser \|\| String\(currentLoggedInUser\.role \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== role\)/.test(extractFunction(SRC, 'enterApp')),
  'enterApp refuses a role the signed-in account does not hold');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
