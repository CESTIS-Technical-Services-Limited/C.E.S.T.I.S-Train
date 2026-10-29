/* Verify Users approves registrations — nothing else, and never a staff role.

   What happened (accounts-04, accounts-10, accounts-11 in the audit):
     - the registration form carried the role in a hidden field and stored it
       as typed: editing it in the browser's inspector filed a registration as
       'admin', and one click on Approve All made the registrant an
       Administrator on every device (reproduced in headless Chromium);
     - Verify Users listed, and Approve All re-activated, EVERY disabled
       account except administrators — the departed member of Admin Staff and
       the expelled trainee an administrator had switched off on purpose;
     - Reject All wrote no edit stamp, so another device's older 'pending' copy
       brought the rejected registrations straight back on the next sync.

   Pinned here (root index.html; the Offline page follows via the generator):
     - CESTISCore.accountAccess.registrationRole only ever yields 'student' or
       'instructor', and submitRegistration uses it;
     - reviewQueue holds pending accounts plus never-reviewed trainee
       placeholders — not an account a person switched off;
     - Approve All skips a self-registration asking for a staff role, and a
       single Approve refuses it;
     - Reject All stamps, so the rejection survives a merge with a stale copy;
     - switching an account off in Settings → Users marks it, and the mark
       travels with the merge.

   Run: node tests/registration-review-queue.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Core = require('../cestis-core.js');
const AA = Core.accountAccess;

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. The role a registration may ask for ---------- */
console.log('A registration is a trainee or an instructor, whatever the form says');
['admin', 'Admin ', 'adminstaff', 'cmc', '<img src=x>', '', null].forEach(function (r) {
  assertEq(AA.registrationRole(r), 'student', JSON.stringify(r) + ' becomes a trainee registration');
});
assertEq(AA.registrationRole('instructor'), 'instructor', 'an instructor registration stays one');
assertEq(AA.registrationRole(' INSTRUCTOR '), 'instructor', 'whatever its case');

(async function () {
  const pushed = [];
  const fields = { regName: 'Kevin Brown', regEmail: 'kevin.brown@example.com', regProgramme: 'Plumbing L2',
    regPassword: 'Password1', regPasswordConfirm: 'Password1', regRole: 'admin' };
  const sb = {
    CESTISCore: Core, console: console, userAccounts: [{ id: 'USR-k', username: 'kevin.brown', email: 'kb@other.org', role: 'student', status: 'active' }],
    document: { getElementById: function (id) { return { value: fields[id] }; } },
    alert: function (m) { throw new Error('unexpected alert: ' + m); },
    courseEnrolmentBlockReason: function () { return ''; },
    hashPassword: async function (p) { return 'pbkdf2$1$aa$' + p.length; },
    cestisGenId: function (p) { return p + 'NEW'; }, localDateStr: function () { return '2026-10-20'; },
    cachePlaintextPw: function () {}, saveState: function () {},
    studentPushRegistration: function (u) { pushed.push(u); return Promise.resolve(true); },
    closeRegistrationModal: function () {}, showPendingApprovalScreen: function () {}, setPendingApprovalState: function () {},
    window: {}
  };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'submitRegistration'), sb);
  // The registration is sent by the real sendRegistration (off the Centre's
  // network it goes through studentPushRegistration, stubbed above).
  vm.runInContext(extractFunction(SRC, 'sendRegistration'), sb);
  await vm.runInContext('submitRegistration()', sb);
  const reg = sb.userAccounts.find(function (u) { return u.id === 'USR-NEW'; });
  assert(!!reg, 'the registration is stored');
  assertEq(reg && reg.role, 'student', 'a hidden field edited to "admin" files a TRAINEE registration');
  assertEq(reg && reg.status, 'pending', 'awaiting approval as before');
  assertEq(reg && reg.username, 'kevin.brown2', 'and it gets a username nobody else on the device holds (accounts-20)');

  /* ---------- 2. What Verify Users lists ---------- */
  console.log('Verify Users lists registrations and never-reviewed placeholders only');
  const accts = [
    { id: 'P1', role: 'student', status: 'pending', registeredVia: 'registration' },
    { id: 'P2', role: 'admin', status: 'pending', registeredVia: 'registration' },
    { id: 'F1', role: 'student', status: 'disabled', registeredVia: 'fee-system' },
    { id: 'F2', role: 'student', status: 'disabled', registeredVia: 'student-sync', approvedAt: '2026-01-01', approvedBy: 'system' },
    { id: 'D1', role: 'adminstaff', status: 'disabled', approvedAt: '2026-01-01', approvedBy: 'admin' },
    { id: 'D2', role: 'instructor', status: 'disabled', registeredVia: 'registration', approvedAt: '2026-01-01', approvedBy: 'admin' },
    { id: 'D3', role: 'student', status: 'disabled', registeredVia: 'fee-system', disabledAt: '2026-09-01T00:00:00Z', disabledBy: 'realadmin' },
    { id: 'D4', role: 'student', status: 'disabled', registeredVia: 'registration', approvedAt: '2026-01-01', approvedBy: 'admin' },
    { id: 'A1', role: 'student', status: 'active' }
  ];
  const q = AA.reviewQueue(accts).map(function (u) { return u.id; }).join(',');
  assertEq(q, 'P1,P2,F1,F2', 'pending accounts and untouched trainee placeholders — not the people switched off on purpose');
  assert(AA.isPrivilegedSelfRegistration(accts[1]), 'a self-registration asking for admin is flagged');
  assert(!AA.isPrivilegedSelfRegistration(accts[0]) && !AA.isPrivilegedSelfRegistration(accts[4]), 'a trainee registration or an admin-made account is not');

  /* ---------- 3. Approve All / Approve / Reject All ---------- */
  console.log('Approve All, Approve and Reject All act on that queue only');
  function bulk(fn, list, role, access) {
    const notes = [];
    // (Admin Staff may now decide on trainees' accounts — accountReviewAllowed;
    // a decision also asks the publisher to run: gatePublishSoon.)
    const sb2 = { CESTISCore: Core, console: console, userAccounts: list, currentRole: role || 'admin',
      adminStaffAccessSettings: Object.assign({ traineeaccounts: true }, access || {}), currentLoggedInUser: { name: 'Marcia Thompson', username: 'mthompson' },
      gatePublishSoon: function () {}, saveUserAccounts: function () {},
      confirm: function () { return true; }, alert: function (m) { notes.push(m); },
      localDateStr: function () { return '2026-10-20'; },
      touchAccount: function (a) { a.updatedAt = '2026-10-20T10:00:00.000Z'; },
      findStudentRecordForAccount: function () { return { id: 'STU-1' }; }, createStudentDataForAccount: function () {}, fillTraineeContactFromAccount: function () {},
      findInstructorRecordForAccount: function () { return {}; }, createInstructorDataForAccount: function () {},
      saveState: function () {}, renderVerifyUsersPage: function () {}, refreshStudentDependentViews: function () {},
      showToast: function () {}, addNotification: function () {}, openResetPassword: function () {} };
    vm.createContext(sb2);
    vm.runInContext(['approveAllPending', 'rejectAllPending', 'approveUser', 'accountReviewAllowed', 'stampReviewer'].map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb2);
    vm.runInContext(fn, sb2);
    return { list: sb2.userAccounts, notes: notes };
  }
  const clone = function () { return JSON.parse(JSON.stringify(accts)); };
  let r = bulk('approveAllPending()', clone());
  const st = {}; r.list.forEach(function (u) { st[u.id] = u.status; });
  assertEq(st.P1, 'active', 'a pending trainee registration is approved');
  assertEq(st.F1, 'active', 'and a never-reviewed fee-roll placeholder');
  assertEq(st.P2, 'pending', 'a registration asking for Administrator is LEFT for one-by-one review');
  assertEq(st.D1 + '/' + st.D2 + '/' + st.D3 + '/' + st.D4, 'disabled/disabled/disabled/disabled',
    'nobody an administrator switched off is switched back on');
  r = bulk("approveUser('P2')", clone());
  assertEq(r.list.find(function (u) { return u.id === 'P2'; }).status, 'pending', 'a single Approve refuses a staff-role self-registration too');
  assert(r.notes.length === 1, 'and says why');
  r = bulk('approveAllPending()', clone(), 'student');
  assertEq(r.list.find(function (u) { return u.id === 'P1'; }).status, 'pending', 'nobody but the office can approve');
  r = bulk('approveAllPending()', clone(), 'instructor');
  assertEq(r.list.find(function (u) { return u.id === 'P1'; }).status, 'pending', 'not an instructor either');
  // The owner: the office approves what trainees register — Admin Staff are the office too.
  r = bulk('approveAllPending()', clone().concat([{ id: 'I1', role: 'instructor', status: 'pending', registeredVia: 'registration' }]), 'adminstaff');
  const st2 = {}; r.list.forEach(function (u) { st2[u.id] = u.status + '/' + (u.approvedBy || ''); });
  assertEq([st2.P1, st2.F1, st2.P2, st2.I1].join(' '), ['active/adminstaff', 'active/adminstaff', 'pending/', 'pending/'].join(' '),
    'Admin Staff approve the trainees\' accounts in the queue — never a staff role, never an instructor\'s');
  r = bulk('approveAllPending()', clone(), 'adminstaff', { traineeaccounts: false });
  assertEq(r.list.find(function (u) { return u.id === 'P1'; }).status, 'pending', 'and nothing when the Administrator switched it off');
  r = bulk("approveUser('P1')", clone(), 'adminstaff');
  const p1a = r.list.find(function (u) { return u.id === 'P1'; });
  assertEq([p1a.status, p1a.approvedBy, p1a.approvedByName].join('|'), 'active|adminstaff|Marcia Thompson', 'one approval says who made it');

  r = bulk('rejectAllPending()', clone());
  const p1 = r.list.find(function (u) { return u.id === 'P1'; });
  assertEq(p1.status, 'rejected', 'Reject All rejects the queue');
  assert(!!p1.updatedAt, 'and stamps each rejection');
  assertEq(r.list.find(function (u) { return u.id === 'D1'; }).status, 'disabled', 'but leaves a switched-off member of staff alone');
  // …so a stale 'pending' copy cannot bring it back.
  const sb3 = { userAccounts: [p1], CESTISCore: Core, console: console, isUserDeleted: function () { return false; },
    mergeTwoFactorState: function () { return false; } };
  vm.createContext(sb3);
  vm.runInContext(extractFunction(SRC, 'mergeCloudAccounts'), sb3);
  sb3.cloud = [{ id: 'P1', role: 'student', status: 'pending', registeredVia: 'registration' }];
  vm.runInContext('mergeCloudAccounts(cloud)', sb3);
  assertEq(sb3.userAccounts[0].status, 'rejected', 'the rejection survives a merge with an older pending copy');

  /* ---------- 4. Switching off is written down, and travels ---------- */
  console.log('An account switched off by a person says so, on every device');
  const sb4 = { userAccounts: [{ id: 'S1', name: 'Sam', role: 'adminstaff', status: 'active' }, { id: 'A', role: 'admin', status: 'active', password: 'x' }],
    CESTISCore: Core, currentLoggedInUser: { username: 'realadmin' }, console: console,
    alert: function () {}, confirm: function () { return false; }, touchAccount: function (a) { a.updatedAt = '2026-10-20T10:00:00.000Z'; },
    saveUserAccounts: function () {}, renderUserAccountsTable: function () {}, showToast: function () {}, openResetPassword: function () {} };
  vm.createContext(sb4);
  vm.runInContext(extractFunction(SRC, 'markDisabledByPerson') + '\n' + extractFunction(SRC, 'toggleUserStatus'), sb4);
  vm.runInContext("toggleUserStatus('S1')", sb4);
  const s1 = sb4.userAccounts[0];
  assert(s1.status === 'disabled' && !!s1.disabledAt && s1.disabledBy === 'realadmin', 'switching off records when and by whom');
  vm.runInContext("toggleUserStatus('S1')", sb4);
  assert(s1.status === 'active' && s1.disabledAt === undefined, 'switching back on clears it');
  const sb5 = { userAccounts: [{ id: 'F9', role: 'student', status: 'disabled', registeredVia: 'fee-system', updatedAt: '2026-09-01T00:00:00Z' }],
    CESTISCore: Core, console: console, isUserDeleted: function () { return false; }, mergeTwoFactorState: function () { return false; } };
  vm.createContext(sb5);
  vm.runInContext(extractFunction(SRC, 'mergeCloudAccounts'), sb5);
  sb5.cloud = [{ id: 'F9', role: 'student', status: 'disabled', registeredVia: 'fee-system', disabledAt: '2026-10-01T00:00:00Z', disabledBy: 'realadmin', updatedAt: '2026-10-01T00:00:00Z' }];
  vm.runInContext('mergeCloudAccounts(cloud)', sb5);
  assertEq(sb5.userAccounts[0].disabledBy, 'realadmin', 'the mark reaches the other devices with the newer copy');
  assertEq(AA.reviewQueue(sb5.userAccounts).length, 0, 'so Verify Users there no longer offers to approve it');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
