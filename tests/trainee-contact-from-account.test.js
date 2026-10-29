/* The email and telephone typed when a trainee account is made reach the
   trainee record and the fee record.
   Run: node tests/trainee-contact-from-account.test.js

   What used to go wrong (office audit OF-3): Add Trainee Account takes an
   email and a telephone, and a trainee registering from home gives both —
   but createStudentDataForAccount copied only the name and programme. The
   trainee record had no email or phone, the fee record was created with
   contact "" and email "", and the enrolment register read "Jhenelle Morgan
   — — —" (0 of 12 approved home registrations had either).

   Pinned here: CESTISCore.traineeContact.fillFromAccount fills ONLY blank
   fields; the dashboard's own createStudentDataForAccount,
   fillTraineeContactFromAccount, approveUser, approveAllPending and the fee
   mirror (syncStudentsToSchoolFee) read from index.html: the office's new
   trainee and an approved home registration both carry their email and phone
   onto the trainee record and the fee record, and a value somebody already
   typed — on the trainee record or the fee record — is never replaced. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(src, name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
const clone = v => JSON.parse(JSON.stringify(v));

console.log('The rule: fill what is blank, never replace');
{
  const TC = Core.traineeContact;
  const s = { email: '', phone: '876-555-0101' };
  const got = TC.fillFromAccount(s, { email: 'jhenelle@example.com', phone: '876-555-9999' });
  assert(got.join() === 'email' && s.email === 'jhenelle@example.com' && s.phone === '876-555-0101', 'the blank email is filled; the typed phone is kept');
  const f = { contact: '', email: 'typed@example.com' };
  TC.fillFromAccount(f, { email: 'other@example.com', phone: '876-555-9999' }, TC.FEE_FIELDS);
  assert(f.contact === '876-555-9999' && f.email === 'typed@example.com', 'a fee record: contact filled, typed email kept');
  assert(TC.fillFromAccount({}, { email: '  ' }).length === 0, 'a blank on the account fills nothing');
}

function store(init) {
  const map = Object.assign({}, init || {});
  return { getItem: k => (k in map ? map[k] : null), setItem: (k, v) => { map[k] = String(v); }, removeItem: k => { delete map[k]; }, _map: map };
}
const CENTRES = [{ id: 30, name: 'Cosmetology', startDate: '2026-09-01', endDate: '2027-06-30' }];
try { Core.enrolment.assignCentreKeys(CENTRES); } catch (e) {}
function dashboard(opts) {
  opts = opts || {};
  const st = store(opts.store);
  const sb = {
    CESTISCore: Core, CESTISStore: st, console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Object, Array, String, Number, RegExp, Set, Map, window: null,
    skillAreas: clone(CENTRES), students: clone(opts.students || []), userAccounts: clone(opts.accounts || []),
    instructorData: [], attendanceRecords: [], studentProfiles: {}, _delStudentAtMemo: null,
    saveState() {}, updateSkillAreaCounts() {}, broadcastStudentsToFeeFrames() {},
    localDateStr: () => '2026-10-28', alert() {}, touchAccount(a) { a.updatedAt = '2026-10-28T10:00:00.000Z'; },
    accountReviewAllowed: () => true, stampReviewer() {}, saveUserAccounts() {}, renderVerifyUsersPage() {}, refreshStudentDependentViews() {},
    showToast() {}, addNotification() {}, gatePublishSoon() {}, confirm: () => true, openResetPassword() {},
    findInstructorRecordForAccount: () => ({}), createInstructorDataForAccount() {}, currentRole: 'admin', adminStaffAccessSettings: {}
  };
  sb.window = sb;
  sb.findStudentRecordForAccount = a => sb.students.find(s => Core.normName(s.name) === Core.normName(a.name)) || null;
  vm.createContext(sb);
  vm.runInContext(['cestisGenId', 'findSkillAreaForCourse', 'instructorCourseMatch', 'fillTraineeContactFromAccount', 'createStudentDataForAccount',
    'readArr', 'syncStudentsToSchoolFee', 'approveUser', 'approveAllPending'].map(n => extractFunction(INDEX, n)).join('\n\n'), sb);
  return sb;
}
const fees = sb => JSON.parse(sb.CESTISStore.getItem('cestiSchoolFeeStudents') || '[]');

console.log('The office adds a trainee account (Add Trainee Account)');
{
  const sb = dashboard();
  const acct = { id: 'USR-JM', name: 'Jhenelle Morgan', role: 'student', programme: 'Cosmetology', status: 'active', email: 'jhenelle.morgan@example.com', phone: '876-555-0142' };
  sb.userAccounts.push(acct);
  vm.runInContext('createStudentDataForAccount(userAccounts[0]); syncStudentsToSchoolFee();', sb);
  const s = sb.students[0];
  assert(s.email === 'jhenelle.morgan@example.com' && s.phone === '876-555-0142', 'the trainee record holds her email and phone (' + JSON.stringify({ email: s.email, phone: s.phone }) + ')');
  const f = fees(sb).find(x => x.lmsId === s.id);
  assert(f && f.email === 'jhenelle.morgan@example.com' && f.contact === '876-555-0142', 'and the fee record made from it (' + JSON.stringify(f && { email: f.email, contact: f.contact }) + ')');
}

console.log('A home registration is approved (Activate / Approve All)');
for (const how of ['approveUser("USR-REG")', 'approveAllPending()']) {
  // The trainee record already there (made earlier, say by the fee page) holds
  // a phone somebody typed; the fee record has no contact yet.
  const existing = { id: 'STU-AB', name: 'Andre Brown', course: 'Cosmetology', stage: 'training', phone: '876-555-1111' };
  const fee = [{ id: 'SF-AB', lmsId: 'STU-AB', name: 'Andre Brown', skillArea: 'Cosmetology', contact: '', email: '', updatedAt: '2026-10-01T00:00:00.000Z' }];
  const sb = dashboard({ students: [existing], store: { cestiSchoolFeeStudents: JSON.stringify(fee) },
    accounts: [{ id: 'USR-REG', name: 'Andre Brown', role: 'student', programme: 'Cosmetology', status: 'pending', registeredVia: 'home', email: 'andre.brown@example.com', phone: '876-555-2222' }] });
  vm.runInContext(how, sb);
  const s = sb.students[0], f = fees(sb)[0];
  assertEq(sb.userAccounts[0].status, 'active', how + ': approved');
  assert(s.email === 'andre.brown@example.com', how + ': the trainee record gains the email it lacked');
  assert(s.phone === '876-555-1111', how + ': the phone somebody typed on the trainee record is kept');
  assert(f.email === 'andre.brown@example.com' && f.contact === '876-555-2222', how + ': the fee record\'s blank email and contact are filled (' + JSON.stringify({ email: f.email, contact: f.contact }) + ')');
}

console.log('A value typed on the fee record is never replaced');
{
  const existing = { id: 'STU-KS', name: 'Kayla Simms', course: 'Cosmetology', stage: 'training' };
  const fee = [{ id: 'SF-KS', lmsId: 'STU-KS', name: 'Kayla Simms', skillArea: 'Cosmetology', contact: '876-555-3333', email: '', updatedAt: '2026-10-01T00:00:00.000Z' }];
  const sb = dashboard({ students: [existing], store: { cestiSchoolFeeStudents: JSON.stringify(fee) },
    accounts: [{ id: 'USR-KS', name: 'Kayla Simms', role: 'student', programme: 'Cosmetology', status: 'pending', email: 'kayla@example.com', phone: '876-555-4444' }] });
  vm.runInContext('approveUser("USR-KS"); syncStudentsToSchoolFee();', sb);
  const s = sb.students[0], f = fees(sb)[0];
  assertEq(f.contact, '876-555-3333', 'the fee record keeps the telephone typed there');
  assert(!s.phone, 'and the account\'s other number is not put on the trainee record beside it (the fee page\'s own route brings the typed one)');
  assert(s.email === 'kayla@example.com' && f.email === 'kayla@example.com', 'the email, blank on both, is filled on both');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
