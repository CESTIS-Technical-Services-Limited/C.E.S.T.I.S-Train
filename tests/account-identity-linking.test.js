/* Two people who share a name are two people.

   What happened (admin-09, accounts-07, accounts-08, accounts-20 in the audit):
     - accounts were linked to trainee records by NAME ALONE: an approved
       Plumbing "John Brown" was handed the Welding John Brown's record — his
       91 %, his certificate WE-2026-0007 — at sign-in, by the roster
       reconcile, by Create User and by approval (proven on the extracted
       functions by the audit's name-link scripts);
     - a trainee renaming herself to a classmate's name in My Profile merged
       the two of them on the next load: one certificate, pooled results and
       attendance, and one of the two logins silently deleted;
     - the account merge took "same username" as "same person": a second
       'kbrown' registering never reached Verify Users, or took over the first
       one's e-mail, password and status.

   Pinned here (root index.html and cestis-core.js):
     - CESTISCore.accountAccess.studentLinkFor links by name only to a
       namesake whose programme AGREES (spelling variants still agree) and only
       when that namesake is unique; findStudentRecordForAccount and
       reconcileStudentsFromAccounts use it;
     - a trainee's own rename becomes a request for the office; the name, the
       account and the record are unchanged;
     - relinkDependentData never deletes a second login that has a password of
       its own;
     - the account merge never joins two real accounts on a username alone.

   Run: node tests/account-identity-linking.test.js */
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

const WELDER = { id: 'STU-welder', name: 'John Brown', course: 'Welding & Fabrication', certNo: 'WE-2026-0007', score: '91%' };

/* ---------- 1. The rule ---------- */
console.log('A name links only to a namesake on an agreeing programme');
assertEq(AA.studentLinkFor({ name: 'John Brown', programme: 'Plumbing L2' }, [WELDER]).match, undefined,
  'a Plumbing John Brown is NOT the Welding John Brown');
assertEq(AA.studentLinkFor({ name: 'John  Brown', programme: 'WELDING L2' }, [WELDER]).match, WELDER,
  'the same person written "WELDING L2" on the account still finds his record');
assertEq(AA.studentLinkFor({ name: 'John Brown', programme: '' }, [WELDER]).match, WELDER, 'an account naming no programme links to the one namesake');
const twin = { id: 'STU-welder2', name: 'John Brown', course: 'Welding & Fabrication' };
assertEq(AA.studentLinkFor({ name: 'John Brown', programme: '' }, [WELDER, twin]).ambiguous, true, 'two agreeing namesakes are for an administrator to settle');
assertEq(AA.studentLinkFor({ name: 'John Brown', programme: 'Welding & Fabrication' }, [WELDER, { id: 'S9', name: 'John Brown', course: 'WELDING L2' }]).match, WELDER,
  'exactly one with the very same programme wins');

/* ---------- 2. Sign-in and the roster reconcile ---------- */
console.log('Sign-in and the roster reconcile never hand one man the other\'s record');
{
  const sb = { CESTISCore: Core, students: [WELDER], saveState: function () {} };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'findStudentRecordForAccount'), sb);
  sb.acct = { id: 'USR-pl', name: 'John Brown', programme: 'Plumbing L2', role: 'student' };
  assertEq(vm.runInContext('findStudentRecordForAccount(acct)', sb), null, 'the Plumbing account resolves to no record (his own is then made)');
  sb.acct = { id: 'USR-el', name: 'john  brown', programme: 'Electrical Installation', role: 'student' };
  assertEq(vm.runInContext('findStudentRecordForAccount(acct)', sb), null, 'nor does an Electrical "john  brown"');
  sb.acct = { id: 'USR-we', name: 'John Brown', programme: 'WELDING L2', role: 'student' };
  assertEq(vm.runInContext('findStudentRecordForAccount(acct)', sb), WELDER, 'the welder himself still does');

  const sb2 = { CESTISCore: Core, students: [Object.assign({}, WELDER)], instructorData: [], attendanceRecords: [],
    userAccounts: [{ id: 'USR-pl', name: 'John Brown', programme: 'Plumbing L2', role: 'student', status: 'active' }],
    isStudentDeleted: function () { return false; }, findSkillAreaForCourse: function () { return null; },
    console: console, localDateStr: function () { return '2026-10-20'; }, cestisGenId: function (p) { return p + 'gen'; },
    updateSkillAreaCounts: function () {}, saveState: function () {} };
  sb2.window = sb2;
  vm.createContext(sb2);
  vm.runInContext(extractFunction(SRC, 'reconcileStudentsFromAccounts'), sb2);
  vm.runInContext('reconcileStudentsFromAccounts()', sb2);
  assert(sb2.userAccounts[0].studentDataId !== 'STU-welder', 'the reconcile does not link the Plumbing account to the welder');
  const own = sb2.students.find(function (s) { return s.id === sb2.userAccounts[0].studentDataId; });
  assert(!!own && /Plumbing/.test(own.course), 'he gets a Plumbing record of his own');
  assertEq(sb2.students.find(function (s) { return s.id === 'STU-welder'; }).certNo, 'WE-2026-0007', 'the welder\'s record is untouched');

  const cu = SRC.slice(SRC.indexOf("  if (role === 'student') {\n    // The trainee of that name ON THE CHOSEN PROGRAMME"), SRC.indexOf("  if (role === 'student') {\n    // The trainee of that name ON THE CHOSEN PROGRAMME") + 200);
  assert(/findStudentRecordForAccount\(newAccount\)/.test(cu), 'Create User links through the same rule, with the chosen programme');
}

/* ---------- 3. A trainee's own rename is a request ---------- */
console.log('A trainee cannot rename herself into somebody else');
{
  const fields = { editProfileName: 'Brianna Clarke', editProfileEmail: 'a@x.org', editProfilePhone: '', editProfileEmergencyName: '', editProfileEmergencyPhone: '', editProfileGender: 'Female' };
  const notes = [];
  const alicia = { id: 'STU-ali', name: 'Alicia Grant', course: 'Cosmetology' };
  const sb = { CESTISCore: Core, currentRole: 'student', currentStudent: alicia, currentLoggedInUser: { id: 'USR-ali', name: 'Alicia Grant' },
    students: [alicia], userAccounts: [{ id: 'USR-ali', name: 'Alicia Grant' }], studentProfiles: {},
    document: { getElementById: function (id) { return { value: fields[id] }; } },
    showToast: function (m) { notes.push(m); }, addNotification: function (m) { notes.push('ADMIN: ' + m); },
    enrolPropagateToFee: function () { throw new Error('a request must not touch the fee record'); },
    syncProfileToLmsChat: function () {}, saveState: function () {}, closeModal: function () {}, updateSidebarAvatar: function () {},
    buildStudentPages: function () {}, showPage: function () {} };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'saveStudentProfile') + '\nsaveStudentProfile();', sb);
  assertEq(alicia.name, 'Alicia Grant', 'the trainee record keeps her name');
  assertEq(sb.userAccounts[0].name, 'Alicia Grant', 'and so does her login');
  assertEq(sb.studentProfiles['STU-ali'].name, 'Alicia Grant', 'the profile (applied at every sign-in) keeps it too');
  assertEq(sb.studentProfiles['STU-ali'].requestedName, 'Brianna Clarke', 'the new name waits as a request');
  assert(notes.some(function (n) { return /^ADMIN: Name change requested/.test(n); }), 'and the office is told');
}

/* ---------- 4. Two real logins on one record both survive ---------- */
console.log('Collapsing two records never deletes a login that has a password of its own');
{
  const data = { userAccounts: [
    { id: 'USR-A', role: 'student', studentDataId: 'STU-a', password: 'pbkdf2$1$aa$bb', status: 'active' },
    { id: 'USR-B', role: 'student', studentDataId: 'STU-b', password: 'pbkdf2$1$cc$dd', status: 'active' },
    { id: 'USR-P', role: 'student', studentDataId: 'STU-b', status: 'disabled' }] };
  Core.relinkDependentData({ 'STU-a': 'STU-b' }, data);
  const ids = data.userAccounts.map(function (u) { return u.id; }).sort().join(',');
  assertEq(ids, 'USR-A,USR-B', 'both real logins stay; only the password-less placeholder is folded away');
}

/* ---------- 5. The account merge and usernames ---------- */
console.log('The account merge never joins two real people on a username alone');
function merge(local, cloud) {
  const sb = { userAccounts: local, CESTISCore: Core, console: console, isUserDeleted: function () { return false; }, mergeTwoFactorState: function () { return false; } };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'mergeCloudAccounts'), sb);
  sb.cloud = cloud;
  vm.runInContext('mergeCloudAccounts(cloud)', sb);
  return sb.userAccounts;
}
{
  const P1 = 'pbkdf2$1$11$11', P2 = 'pbkdf2$1$22$22';
  let r = merge([{ id: 'USR-k1', username: 'kbrown', email: 'kbrown@gmail.com', role: 'student', password: P1, status: 'active', updatedAt: '2026-09-01T00:00:00Z' }],
    [{ id: 'USR-k2', username: 'kbrown', email: 'kbrown@yahoo.com', role: 'student', password: P2, status: 'pending' }]);
  assertEq(r.length, 2, 'a second kbrown (another address) reaches this device as a second account');
  r = merge([{ id: 'USR-k1', username: 'kbrown', email: 'kbrown@gmail.com', role: 'student', password: P1, status: 'active' }],
    [{ id: 'USR-k2', username: 'kbrown', email: 'kbrown@yahoo.com', role: 'student', password: P2, status: 'pending' }]);
  const k1 = r.find(function (u) { return u.id === 'USR-k1'; });
  assert(k1.password === P1 && k1.email === 'kbrown@gmail.com' && k1.status === 'active', 'and the first kbrown keeps his own password, e-mail and status (unstamped case)');
  r = merge([{ id: 'USR-FEE-1', username: 'john.smith', role: 'student', status: 'disabled', registeredVia: 'fee-system' }],
    [{ id: 'USR-FEE-2', username: 'john.smith', role: 'student', status: 'disabled', registeredVia: 'fee-system' }]);
  assertEq(r.length, 1, 'two password-less placeholders with one username are still one record');
  r = merge([{ id: 'USR-S1', username: 'john.smith', role: 'student', status: 'disabled', studentDataId: 'STU-1' }],
    [{ id: 'USR-S2', username: 'john.smith', role: 'student', status: 'disabled', studentDataId: 'STU-2' }]);
  assertEq(r.length, 2, 'but not when they point at two different trainees');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
