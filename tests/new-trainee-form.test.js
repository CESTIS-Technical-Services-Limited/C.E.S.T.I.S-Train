/* One "New trainee" form behind every add-trainee button; a trainee's
   details typed once.

   What happened (office audit OF-3, OF-7): four buttons made four
   incomplete trainees — the dashboard's Add Student (no sign-in), Add
   Trainee Account (no gender, no details), Settings → Create User, the fee
   page's import — and the home registration form asked only for a name, a
   programme and a phone, so completing each trainee on the fee page took
   ≈74 s (≈31 min an intake of 25).

   What this pins:
     1  CESTISCore.accountAccess.traineeDetails (both builds — the trainee
        sign-in runs the same rules) and CESTISCore.traineeContact
        .fillDetails: what is asked, what is accepted, and that a detail only
        ever fills a BLANK (a value somebody typed is never replaced);
     2  the page (index.html): the New trainee form asks gender and the
        optional details and puts them on the trainee record AND the fee
        record (made at once if it is not there yet); the dashboard's Add
        Student, Settings → Create User for a trainee, and Student Progress's
        + Add Student open that same form; approving a home registration puts
        what she gave on her records; Verify Users shows it for checking;
     3  the home registration form asks for them and sends them.

   Run: node tests/new-trainee-form.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-30T15:00:00Z');

/* ---------- 1. The rules ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], C = pair[1], TD = C.accountAccess.traineeDetails, TC = C.traineeContact;
  console.log('\n[' + where + '] What is asked, and what is accepted');
  assertEq(TD.FIELDS, ['gender', 'dob', 'trn', 'address', 'parentName', 'parentPhone', 'emergencyName', 'emergencyPhone'], 'the details');
  assertEq(TD.HOME_REQUIRED, ['gender', 'dob', 'address', 'emergencyName', 'emergencyPhone'], 'required from home');
  assertEq(TD.check({}, { nowMs: NOW }), { ok: true, value: {} }, 'in the office all are optional (the form requires gender itself)');
  assertEq(TD.check({ gender: 'female', dob: '2004-03-11', trn: '127009850', address: ' 12  Hope Road ' }, { nowMs: NOW }).value,
    { gender: 'Female', dob: '2004-03-11', trn: '127-009-850', address: '12 Hope Road' }, 'tidied: Female, the TRN written 127-009-850, spaces');
  assertEq(TD.check({ dob: '2016-01-01' }, { nowMs: NOW }).field, 'dob', 'under 12: a mistyped year');
  assertEq(TD.check({ dob: '1900-01-01' }, { nowMs: NOW }).field, 'dob', 'over 100');
  assertEq(TD.check({ parentName: 'Paulette Williams' }, { nowMs: NOW }).field, 'parentPhone', 'a name with no number is half a contact');
  assertEq(TD.check({ emergencyPhone: '876-555-1618' }, { nowMs: NOW }).field, 'emergencyName', 'and a number with no name');
  assertEq(TD.check({ gender: 'Other' }).field, 'gender', 'Female or Male, as every form on the platform');
  assertEq(TD.clean({ gender: 'Male', dob: 'yesterday', trn: '1', address: '<x>', emergencyName: 'Ann Lee', junk: 1 }), { gender: 'Male', emergencyName: 'Ann Lee' },
    'a stored copy keeps what is valid, nothing else');
  console.log('[' + where + '] A detail only fills a blank');
  const d = { gender: 'Male', dob: '2004-03-11', trn: '127-009-850', address: '12 Hope Road, Kingston', parentName: 'Paulette Williams', parentPhone: '876-555-2718',
    emergencyName: 'Paulette Williams', emergencyPhone: '876-555-1618' };
  const t = { name: 'Akeem Williams', gender: '', dob: '', address: '9 Typed Street' };
  assertEq(TC.fillDetails(t, d, 'trainee'), ['gender', 'dob', 'trn'], 'the trainee record: gender, date of birth, TRN');
  assertEq([t.gender, t.dob, t.trn, t.address], ['Male', '2004-03-11', '127-009-850', '9 Typed Street'], 'the address somebody typed is kept');
  const f = { name: 'Akeem Williams', contact: '876-555-3141', parentName: '', emergencyContact: '' };
  assertEq(TC.fillDetails(f, d, 'fee'), ['gender', 'dateOfBirth', 'nationalId', 'address', 'parentName', 'parentContact', 'emergencyContactName', 'emergencyContact'],
    'the fee record: every detail, under its own names');
  assertEq([f.nationalId, f.parentContact, f.emergencyContactName, f.emergencyContact], ['127-009-850', '876-555-2718', 'Paulette Williams', '876-555-1618'], 'as the fee page reads them');
  assertEq(TC.fillDetails(f, Object.assign({}, d, { address: 'Somewhere Else' }), 'fee'), [], 'a second time changes nothing');
});

/* ---------- 2. The page ---------- */
const Core = require('../cestis-core.js');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function fn(name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(PAGE);
  if (!m) throw new Error('no ' + name);
  let dd = 0;
  for (let i = PAGE.indexOf('{', m.index); i < PAGE.length; i++) { if (PAGE[i] === '{') dd++; else if (PAGE[i] === '}') { dd--; if (!dd) return PAGE.slice(m.index, i + 1); } }
  throw new Error(name);
}
const stmt = (a, b) => { const i = PAGE.indexOf(a); return PAGE.slice(i, PAGE.indexOf(b, i) + b.length); };
function page(fields, opts) {
  opts = opts || {};
  const store = { cestiSchoolFeeStudents: JSON.stringify(opts.fee || []) };
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: fields && fields[id] != null ? fields[id] : '', hidden: true, textContent: '', innerHTML: '', disabled: false, open: false, style: {} });
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, String, Object, Array, CESTISCore: Core, window: {},
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    currentRole: 'adminstaff', currentLoggedInUser: { id: 'USR-sbrown', name: 'Sheryl Brown', username: 'sbrown' },
    adminStaffAccessSettings: { traineeaccounts: true }, userAccounts: opts.accounts || [], students: [], toasts: [], opened: [], closed: [], published: 0,
    document: { getElementById: el }, els, store,
    hashPassword: async pw => 'pbkdf2$210000$00112233445566778899aabbccddeeff$' + Buffer.from(pw).toString('hex').padEnd(64, '0').slice(0, 64),
    cachePlaintextPw() {}, clearDeletedUser() {}, getNextUserId: () => 'USR-new1', localDateStr: () => '2026-10-30',
    findStudentRecordForAccount: () => null, fillTraineeContactFromAccount() {},
    createStudentDataForAccount: a => { const s = { id: Core.stableStudentId({ name: a.name, course: a.programme }), name: a.name, course: a.programme, gender: '' }; sb.students.push(s); a.studentDataId = s.id; return s; },
    saveUserAccounts() {}, saveState() {}, closeModal: id => sb.closed.push(id), openModal: id => sb.opened.push(id), renderVerifyUsersPage() {}, refreshStudentDependentViews() {},
    showToast: t => sb.toasts.push(t), addNotification() {}, alert() {}, gatePublishSoon() { sb.published++; }, officeStampCreator() {},
    courseEnrolmentBlockReason: () => '', getCourseList: () => ['Welding & Fabrication', 'Cosmetology'], escapeAttr: s => String(s), escapeHtml: s => String(s).replace(/</g, '&lt;')
  };
  // The fee mirror: a placeholder fee record for every trainee record without one.
  sb.window.syncStudentsToSchoolFee = function () {
    const fee = JSON.parse(store.cestiSchoolFeeStudents);
    sb.students.forEach(s => { if (!fee.some(f => f.lmsId === s.id)) fee.push({ id: s.id, lmsId: s.id, name: s.name, skillArea: s.course, gender: s.gender || '', dateOfBirth: '', nationalId: '', address: '', parentName: '', parentContact: '', emergencyContact: '', needsFeeDetails: true }); });
    store.cestiSchoolFeeStudents = JSON.stringify(fee);
  };
  vm.createContext(sb);
  vm.runInContext(stmt('var AS_ACCESS_DEFAULTS = {', '};') + '\n' + stmt('var AT_DETAIL_IDS = {', '};') + '\n' +
    ['adminStaffAccessDefaults', 'asAccessFor', 'asAccessForMe', 'officeMayAddTrainee', 'officeEnrollingProgrammes', 'officeSuggestUsername', 'openAddTraineeAccount', 'openNewTrainee',
      'applyTraineeDetails', 'createTraineeAccount', 'accountReviewAllowed', 'stampReviewer', 'approveUser', 'vuDetailsHtml'].map(fn).join('\n'), sb);
  return sb;
}
const fee = sb => JSON.parse(sb.store.cestiSchoolFeeStudents);
(async function () {
  console.log('\n[index.html] The New trainee form makes the sign-in, the trainee record and the fee record, with her details');
  {
    const sb = page({ atName: 'Jhenelle Morgan', atGender: 'Female', atEmail: 'jhenelle.morgan@gmail.com', atPhone: '876-555-0188', atProgramme: 'Cosmetology', atPassword: 'Jhenelle-2026',
      atDob: '2006-07-21', atTrn: '134 567 890', atAddress: '22 Molynes Road, Kingston 10', atParentName: 'Marcia Morgan', atParentPhone: '876-555-0190', atEmergencyName: 'Marcia Morgan', atEmergencyPhone: '876-555-0190' });
    await sb.createTraineeAccount();
    const a = sb.userAccounts[0], s = sb.students[0], f = fee(sb)[0];
    assert(a && a.status === 'active' && /^pbkdf2\$/.test(a.password), 'an active sign-in');
    assert(!('details' in a), 'her details are not kept on the sign-in itself');
    assertEq([s.gender, s.dob, s.trn, s.address], ['Female', '2006-07-21', '134-567-890', '22 Molynes Road, Kingston 10'], 'her trainee record has gender, date of birth, TRN and address');
    assert(f && f.lmsId === s.id, 'her fee record is made at once');
    assertEq([f.gender, f.dateOfBirth, f.nationalId, f.address, f.parentName, f.parentContact, f.emergencyContactName, f.emergencyContact],
      ['Female', '2006-07-21', '134-567-890', '22 Molynes Road, Kingston 10', 'Marcia Morgan', '876-555-0190', 'Marcia Morgan', '876-555-0190'], 'with everything the fee page asks for');
    assert(f.needsFeeDetails === true, 'still waiting for her tuition to be priced (as every new fee record)');
    const sb2 = page({ atName: 'Kadeem Ellis', atGender: '', atProgramme: 'Cosmetology', atPassword: 'Kadeem-2026' });
    await sb2.createTraineeAccount();
    assert(sb2.userAccounts.length === 0 && /gender/.test(sb2.els.atSaid.textContent), 'gender is asked');
    const sb3 = page({ atName: 'Kadeem Ellis', atGender: 'Male', atProgramme: 'Cosmetology', atPassword: 'Kadeem-2026', atParentName: 'Ann Ellis' });
    await sb3.createTraineeAccount();
    assert(sb3.userAccounts.length === 0 && /parent or guardian/.test(sb3.els.atSaid.textContent) && sb3.els.atMore.open === true, 'a half contact is said, with the details opened');
    const sb4 = page({ atName: 'Kadeem Ellis', atGender: 'Male', atProgramme: 'Cosmetology', atPassword: 'Kadeem-2026' });
    await sb4.createTraineeAccount();
    assert(sb4.userAccounts.length === 1 && sb4.students[0].gender === 'Male', 'the details are optional in the office');
  }
  console.log('[index.html] Every add-trainee button opens it');
  {
    assert(/<div class="quick-action-btn" onclick="openNewTrainee\(\)"><div class="qa-icon">&#128100;<\/div><div class="qa-label">Add Student<\/div><\/div>/.test(fn('buildAdminPages')), 'the dashboard\'s Add Student');
    assert(/onclick="openAddTraineeAccount\(\)">\+ Add Trainee Account/.test(fs.readFileSync(path.join(ROOT, 'Pages', 'Verify-Users.html'), 'utf8')), 'Verify Users / Trainee Accounts');
    assert(/if\(role === 'student'\) \{ createUserAsTrainee\(\); return; \}/.test(fn('toggleUserFormFields')), 'Settings → Create User, the moment Student is chosen');
    const sb = page({ newUserName: 'Odalys Facey', newUserEmail: 'odalys@example.com', newUserUsername: 'odalys.facey' });
    vm.runInContext(fn('createUserAsTrainee'), sb);
    sb.els.newUserRole = { value: 'student' };
    sb.createUserAsTrainee();
    assert(sb.closed.indexOf('createUserModal') !== -1 && sb.opened.indexOf('addTraineeModal') !== -1, 'Create User closes; the New trainee form opens');
    assertEq([sb.els.atName.value, sb.els.atEmail.value, sb.els.atUsername.value], ['Odalys Facey', 'odalys@example.com', 'odalys.facey'], 'with what was typed');
    const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
    assert(/id="spAddStudentBtn" onclick="spAddStudentClicked\(\)"/.test(SP) && /window\.parent\.postMessage\(\{ type: 'cestis-new-trainee' \}, '\*'\)/.test(SP), 'Student Progress\'s + Add Student asks the dashboard');
    assert(/e\.data\.type === 'cestis-new-trainee'[\s\S]{0,200}if \(officeMayAddTrainee\(\)\) openNewTrainee\(\);/.test(PAGE), 'which opens the New trainee form');
  }
  console.log('[index.html] Approving a home registration puts what she gave on her records');
  {
    const det = { gender: 'Female', dob: '2005-02-14', trn: '123-456-789', address: '4 Hope Road, Kingston 6', parentName: 'Paulette Barrett', parentPhone: '876-555-0145',
      emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' };
    const sb = page({}, { accounts: [{ id: 'USR-home-1', name: 'Shantelle Barrett', role: 'student', status: 'pending', registeredVia: 'home-registration', programme: 'Cosmetology',
      email: 'shantelle@mail.test', password: 'pbkdf2$x', details: det }] });
    Object.assign(sb, { touchAccount() {}, findInstructorRecordForAccount() { return null; }, createInstructorDataForAccount() {}, openResetPassword() {}, confirm: () => false });
    sb.approveUser('USR-home-1');
    const s = sb.students[0], f = fee(sb)[0];
    assertEq([s.gender, s.dob, s.trn, s.address], ['Female', '2005-02-14', '123-456-789', '4 Hope Road, Kingston 6'], 'her trainee record');
    assertEq([f.dateOfBirth, f.parentName, f.emergencyContact], ['2005-02-14', 'Paulette Barrett', '876-555-0145'], 'her fee record');
    assert(/Born 2005-02-14/.test(sb.vuDetailsHtml(det)) && /Emergency: Paulette Barrett 876-555-0145/.test(sb.vuDetailsHtml(det)), 'Verify Users shows them for the office to check');
    assert(sb.vuDetailsHtml({ address: '<img src=x>' }).indexOf('<img') === -1, 'safely');
    assert(/if \(u\.details && typeof u\.details === 'object'\) sourceLabel \+= vuDetailsHtml\(u\.details\);/.test(fn('renderVerifyUsersPage')), 'on the registration\'s row');
    assert(/applyTraineeDetails\(students\.find\(function\(s\) \{ return s && s\.id === u\.studentDataId; \}\), u\.details\)/.test(fn('approveAllPending')), 'Approve All does the same');
  }

  /* ---------- 3. The home registration form ---------- */
  console.log('\n[index.html] The home registration form asks for them and sends them');
  {
    const form = fn('gateRegisterForm');
    ['grGender', 'grDob', 'grTrn', 'grAddress', 'grParentName', 'grParentPhone', 'grEmergencyName', 'grEmergencyPhone'].forEach(id => assert(form.indexOf('id="' + id + '"') !== -1 && form.indexOf('for="' + id + '"') !== -1, id + ', labelled'));
    assert(/<legend>Emergency contact<\/legend>/.test(form) && /<legend>Parent or guardian \(optional\)<\/legend>/.test(form), 'in plain groups');
    const sent = [];
    const vals = { grName: 'Shantelle Barrett', grProgramme: 'Cosmetology', grPhone: '', grPassword: 'Shantelle-2026', grPassword2: 'Shantelle-2026',
      grGender: 'Female', grDob: '2005-02-14', grTrn: '', grAddress: '4 Hope Road, Kingston 6', grParentName: '', grParentPhone: '', grEmergencyName: 'Paulette Barrett', grEmergencyPhone: '876-555-0145' };
    const said = [];
    const sb = { CESTISCore: Core, Object, String, JSON, document: { getElementById: id => (id in vals ? { value: vals[id], focus() {} } : null) },
      _gateReg: { token: 'tok', email: 'shantelle@mail.test', busy: false }, gateRegFormSay: t => said.push(t),
      CESTISGate: { registerSubmit: async o => { sent.push(o); return { ok: true, state: 'submitted' }; } }, gateRegisterReached() {}, gateRegisterClose() {}, showPendingApprovalScreen() {}, gateRegSay: c => c };
    vm.createContext(sb);
    vm.runInContext(stmt('var GATE_REG_FIELD = {', '};') + '\n' + stmt('var GATE_REG_DETAIL_IDS = {', '};') + '\n' + fn('gateRegisterSubmit'), sb);
    await sb.gateRegisterSubmit();
    assertEq([sent.length, sent[0] && sent[0].gender, sent[0] && sent[0].dob, sent[0] && sent[0].emergencyPhone], [1, 'Female', '2005-02-14', '876-555-0145'], 'sent with her details');
    vals.grDob = ''; sent.length = 0;
    await sb.gateRegisterSubmit();
    assert(sent.length === 0 && /date of birth/.test(said[said.length - 1]), 'a missing date of birth is said before anything is sent');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
