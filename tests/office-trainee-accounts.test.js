/* The office creates trainee accounts: administrators AND Admin Staff.

   The owner decided: "Both the office admin staff and administrators can
   create account for students, while trainees register the account at
   home, for office approval." Until now only an administrator could make an
   account (Settings → Users), Admin Staff could neither make one nor look at
   a registration, and the account form checked less than the public
   registration form did (a second trainee account on an address one
   already had went through, and email sign-in then named two people).

   What this pins:
     1  one rule for a new account, in cestis-core.js (both builds):
        CESTISCore.accountAccess.officeCreateRefusal — an administrator may
        create any role; Admin Staff TRAINEE accounts only (never an
        administrator, admin staff, instructor or board login), and not when
        the Administrator has switched "Trainee Accounts" off; the full-name
        rule (equal to Staff Appraisals' sappIsFullName, which every form
        used), a username nobody holds in any case, a trainee's email nobody
        holds in any case (blank allowed), a programme, a programme taking
        trainees now (the page's courseEnrolmentBlockReason), the phone;
     2  the real page code (index.html): "Add Trainee Account" makes an
        ACTIVE trainee account, says who made and approved it, links or
        makes the trainee record, writes the accounts list at once, and asks
        the publisher to run now (the trainee's own folder in the same
        moment); Admin Staff with the tick off make nothing; Settings →
        Users' Create User answers to the same rule (Admin Staff calling it
        for a staff role is refused);
     3  Verify Users / Trainee Accounts: an administrator may decide on any
        account, Admin Staff on trainees' only (and only with the tick on);
        an approval or rejection says who made it; "Trainee Accounts" is
        allowed by default and is a page of its own in the Admin Staff grid.

   Run: node tests/office-trainee-accounts.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const VERIFY = fs.readFileSync(path.join(ROOT, 'Pages', 'Verify-Users.html'), 'utf8');
const sapp = require('../staff-appraisals.js');

function extractFunction(name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(PAGE);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = PAGE.indexOf('{', m.index); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function extractStatement(startsWith, endsWith) {
  const start = PAGE.indexOf(startsWith);
  if (start < 0) throw new Error('index.html no longer declares ' + startsWith);
  return PAGE.slice(start, PAGE.indexOf(endsWith, start) + endsWith.length);
}

/* ---------- 1. The rule, in both builds ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], AA = pair[1].accountAccess;
  console.log('\n[' + where + '] A full name is a first name and a last name — the same rule as every account form');
  ['Tameka Richards', 'tameka richards', 'Mr. Kemar Johnson', 'Dr Ann', 'Ann', ' Ann  Lee ', "O'Neil Brown", 'Kerry-Ann', 'Kerry-Ann Facey', 'A B', 'Al Bo', 'Mrs Ms', '', null,
    'Jean-Paul', 'Shanique  Campbell-Brown', 'J. Smith', 'Rev. Dr. Hon', 'Ño Ñu'].forEach(function (n) {
    assertEq(AA.isFullName(n), sapp.sappIsFullName(n), JSON.stringify(n) + ' is judged as Staff Appraisals judges it');
  });

  console.log('[' + where + '] Who may create which account');
  const accounts = [
    { id: 'U1', role: 'admin', username: 'mthompson', email: 'mthompson@example.com' },
    { id: 'U2', role: 'student', username: 'tameka.richards', email: 'Tameka.Richards@Example.com' },
    { id: 'U3', role: 'instructor', username: 'dclarke', email: '' }
  ];
  const trainee = { role: 'student', name: 'Kemar Johnson', username: 'kemar.johnson', email: 'kemar@example.com', programme: 'Welding & Fabrication', password: 'Kemar-2026' };
  const R = function (actor, draft, opts) { const r = AA.officeCreateRefusal(actor, draft, accounts, opts); return r ? r.code : null; };
  assertEq(R({ role: 'adminstaff' }, trainee), null, 'Admin Staff may create a trainee account');
  assertEq(R({ role: 'adminstaff', allowed: true }, trainee), null, 'with the tick on, too');
  assertEq(R({ role: 'admin' }, trainee), null, 'an administrator may create a trainee account');
  ['admin', 'adminstaff', 'instructor', 'cmc'].forEach(function (role) {
    const d = Object.assign({}, trainee, { role: role, username: 'staff.' + role, programme: role === 'instructor' ? 'Welding & Fabrication' : '' });
    assertEq(R({ role: 'adminstaff' }, d), 'role', 'Admin Staff may NOT create a "' + role + '" account');
    assertEq(R({ role: 'admin' }, d), null, 'an administrator may create a "' + role + '" account');
  });
  assertEq(R({ role: 'adminstaff', allowed: false }, trainee), 'not-allowed', 'Admin Staff with "Trainee Accounts" switched off may create nothing');
  assertEq(R({ role: 'instructor' }, trainee), 'not-allowed', 'an instructor may create nothing');
  assertEq(R({ role: 'student' }, trainee), 'not-allowed', 'a trainee may create nothing');
  assertEq(R(null, trainee), 'not-allowed', 'nobody signed in may create nothing');

  console.log('[' + where + '] The rules every sign-up form already follows');
  const d = over => Object.assign({}, trainee, over);
  assertEq(R({ role: 'adminstaff' }, d({ name: 'Kemar' })), 'full-name', 'a first name alone is refused');
  assertEq(R({ role: 'adminstaff' }, d({ name: 'Mr Kemar' })), 'full-name', 'a title does not count as a name');
  assertEq(R({ role: 'adminstaff' }, d({ name: 'Kemar <b>Johnson</b>' })), 'markup', 'no markup in a name');
  assertEq(R({ role: 'adminstaff' }, d({ username: 'TAMEKA.Richards' })), 'username-taken', 'a username somebody holds, in another case, is refused');
  assertEq(R({ role: 'adminstaff' }, d({ email: ' tameka.richards@example.COM ' })), 'email-taken', 'a trainee email somebody holds, in another case, is refused');
  assertEq(R({ role: 'adminstaff' }, d({ email: 'mthompson@example.com' })), 'email-taken', 'whatever role holds it (email sign-in must never name two people)');
  assertEq(R({ role: 'adminstaff' }, d({ email: '' })), null, 'a blank email is allowed (the office may not have one)');
  assertEq(R({ role: 'adminstaff' }, d({ email: 'not-an-address' })), 'email', 'an email that is not one is refused');
  assertEq(R({ role: 'admin' }, Object.assign({}, trainee, { role: 'instructor', username: 'new.instructor', email: 'mthompson@example.com' })), null,
    'a staff account keeps today\'s rule (only a trainee\'s email is checked)');
  assertEq(R({ role: 'adminstaff' }, d({ programme: '' })), 'programme', 'a trainee needs a programme');
  assertEq(R({ role: 'adminstaff' }, d(), { enrolBlock: 'The course "Welding & Fabrication" ENDED on 2026-06-30.' }), 'enrol', 'a programme that is not taking trainees is refused');
  assertEq(AA.officeCreateRefusal({ role: 'adminstaff' }, d(), accounts, { enrolBlock: 'ENDED' }).message, 'ENDED', 'with the enrolment rule\'s own words');
  assertEq(R({ role: 'adminstaff' }, d({ password: '12345' })), 'password', 'a password under six characters is refused');
  assertEq(R({ role: 'adminstaff' }, d({ phone: '876-555-0123' })), null, 'a phone number as people write one');
  assertEq(R({ role: 'adminstaff' }, d({ phone: '+1 (876) 555 0123' })), null, 'with a country code');
  assertEq(R({ role: 'adminstaff' }, d({ phone: 'call me' })), 'phone', 'not a phone number');
  assertEq(R({ role: 'adminstaff' }, d({ phone: '12' })), 'phone', 'too short to be one');
  assertEq(R({ role: 'adminstaff' }, d({ name: '', username: '' })), 'missing', 'name and username are required');
  assert(/FULL name/.test(AA.officeCreateRefusal({ role: 'adminstaff' }, d({ name: 'Kemar' }), accounts).message), 'the refusal says what to do');
});

/* ---------- 2. The page code ---------- */
const Core = require('../cestis-core.js');
const FUNCS = ['accountReviewAllowed', 'stampReviewer', 'officeStampCreator', 'officeMayAddTrainee', 'officeEnrollingProgrammes', 'officeSuggestUsername',
  'openAddTraineeAccount', 'createTraineeAccount', 'createUserAccount'];
function page(opts) {
  opts = opts || {};
  const fields = Object.assign({}, opts.fields || {});
  const el = id => ({ id, get value() { return fields[id] == null ? '' : fields[id]; }, set value(v) { fields[id] = v; }, hidden: true, textContent: '', innerHTML: '', disabled: false, checked: false, style: {} });
  const els = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    CESTISCore: Core,
    currentRole: opts.role || 'adminstaff',
    currentLoggedInUser: opts.me || { id: 'USR-sbrown', name: 'Sheryl Brown', username: 'sbrown', role: opts.role || 'adminstaff' },
    adminStaffAccessSettings: Object.assign({ traineeaccounts: true }, opts.access || {}),
    userAccounts: (opts.accounts || []).slice(),
    students: [],
    published: 0, toasts: [], alerts: [], notes: [], saved: { users: 0, state: 0 }, closed: [], opened: [],
    document: { getElementById: id => (els[id] = els[id] || el(id)) },
    fields, els,
    hashPassword: async pw => 'pbkdf2$210000$00112233445566778899aabbccddeeff$' + Buffer.from(pw).toString('hex').padEnd(64, '0').slice(0, 64),
    cachePlaintextPw() {}, clearDeletedUser() {},
    findStudentRecordForAccount: a => sb.students.find(s => s.id === Core.stableStudentId({ name: a.name, course: a.programme })) || null,
    createStudentDataForAccount: a => { const s = { id: Core.stableStudentId({ name: a.name, course: a.programme }), name: a.name, course: a.programme }; sb.students.push(s); a.studentDataId = s.id; return s; },
    findInstructorRecordForAccount: () => null, createInstructorDataForAccount() {}, instructorData: [],
    saveUserAccounts() { sb.saved.users++; }, saveState() { sb.saved.state++; },
    closeModal: id => sb.closed.push(id), openModal: id => sb.opened.push(id),
    renderVerifyUsersPage() {}, refreshStudentDependentViews() {}, renderUserAccountsTable() {},
    showToast: (t, k) => sb.toasts.push(t), addNotification: t => sb.notes.push(t), alert: t => sb.alerts.push(t),
    gatePublishSoon() { sb.published++; return true; },
    localDateStr: () => '2026-10-28', getNextUserId: () => 'USR-new' + (++sb.n), n: 0,
    courseEnrolmentBlockReason: p => (opts.blocked && opts.blocked[p]) || '',
    getCourseList: () => ['Cosmetology', 'Electrical Installation', 'Welding & Fabrication'],
    escapeAttr: s => String(s).replace(/"/g, '&quot;'), escapeHtml: s => String(s).replace(/</g, '&lt;'),
    setCmcChair() { return ''; }
  };
  vm.createContext(sb);
  // Admin Staff's ticks are read person by person (asAccessForMe, OF-2).
  vm.runInContext(extractStatement('var AS_ACCESS_DEFAULTS = {', '};') + ';\n' + ['adminStaffAccessDefaults', 'asAccessFor', 'asAccessForMe'].map(extractFunction).join('\n'), sb);
  vm.runInContext(FUNCS.map(extractFunction).join('\n\n'), sb);
  return sb;
}
(async function () {
  console.log('\nAdmin Staff add a trainee\'s account in the office: active at once, and who made and approved it is written down');
  let P = page({ fields: { atName: 'Tameka  Richards', atEmail: 'tameka.r@example.com', atPhone: '876-555-0101', atProgramme: 'Welding & Fabrication', atPassword: 'Tameka-2026', atUsername: '' } });
  P.openAddTraineeAccount();
  assertEq(P.opened, ['addTraineeModal'], 'the form opens');
  assert(/Welding &amp; Fabrication|Welding & Fabrication/.test(P.els.atProgramme.innerHTML) && /Cosmetology/.test(P.els.atProgramme.innerHTML), 'offering the programmes taking trainees');
  P.fields.atName = 'Tameka  Richards'; P.fields.atEmail = 'tameka.r@example.com'; P.fields.atPhone = '876-555-0101'; P.fields.atProgramme = 'Welding & Fabrication'; P.fields.atPassword = 'Tameka-2026';
  await P.createTraineeAccount();
  const a = P.userAccounts[0];
  assertEq([a.role, a.status, a.name, a.username, a.email, a.phone, a.programme, a.registeredVia], ['student', 'active', 'Tameka Richards', 'tameka.r', 'tameka.r@example.com', '876-555-0101', 'Welding & Fabrication', 'admin-created'],
    'one ACTIVE trainee account, the username made from the email');
  assertEq([a.createdBy, a.createdByRole, a.approvedBy, a.approvedByName, a.approvedAt], ['sbrown', 'adminstaff', 'adminstaff', 'Sheryl Brown', '2026-10-28'], 'made and approved by the office, and by whom');
  assert(/^pbkdf2\$/.test(a.password), 'the password is kept only as its check');
  assertEq([a.studentDataId, P.students.length], [Core.stableStudentId({ name: 'Tameka Richards', course: 'Welding & Fabrication' }), 1], 'their trainee record is made, under the dashboard\'s own student ID');
  assertEq([P.saved.users, P.published], [1, 1], 'the accounts list is written at once, and the publisher asked to run now (the trainee\'s folder in the same moment)');
  assertEq(P.closed, ['addTraineeModal'], 'and the form closes');

  console.log('A second account for the same address, or a staff role, is refused — with the words of the rule');
  P.fields.atName = 'Tameka Richards'; P.fields.atEmail = 'TAMEKA.R@example.com'; P.fields.atUsername = 'tameka2'; P.fields.atPassword = 'Tameka-2026';
  await P.createTraineeAccount();
  assertEq([P.userAccounts.length, P.els.atSaid.hidden, /email already exists/.test(P.els.atSaid.textContent)], [1, false, true], 'the same email in another case: refused, said in the form');
  P.fields.atEmail = 'other@example.com'; P.fields.atProgramme = 'Cosmetology';
  P = page({ blocked: { Cosmetology: 'The course "Cosmetology" ENDED on 2026-06-30.' }, fields: { atName: 'Kemar Johnson', atEmail: '', atPassword: 'Kemar-2026', atProgramme: 'Cosmetology' } });
  P.openAddTraineeAccount();
  assert(!/Cosmetology/.test(P.els.atProgramme.innerHTML), 'a programme that has ended is not offered');
  P.fields.atName = 'Kemar Johnson'; P.fields.atPassword = 'Kemar-2026'; P.fields.atProgramme = 'Cosmetology';
  await P.createTraineeAccount();
  assertEq([P.userAccounts.length, /ENDED/.test(P.els.atSaid.textContent)], [0, true], 'and if picked anyway, refused');

  console.log('Admin Staff with "Trainee Accounts" switched off make nothing');
  P = page({ access: { traineeaccounts: false }, fields: { atName: 'Kemar Johnson', atPassword: 'Kemar-2026', atProgramme: 'Welding & Fabrication' } });
  P.openAddTraineeAccount();
  assertEq([P.opened.length, P.toasts.length], [0, 1], 'the form does not open; they are told why');
  await P.createTraineeAccount();
  assertEq([P.userAccounts.length, P.published], [0, 0], 'and nothing is created');

  console.log('Settings → Users answers to the same rule');
  P = page({ role: 'adminstaff', fields: { newUserName: 'Neville Shaw', newUserRole: 'admin', newUserUsername: 'nshaw', newUserPassword: 'Admin-2026!', newUserEmail: '', newUserProgramme: '' } });
  await P.createUserAccount();
  assertEq([P.userAccounts.length, /trainee accounts only/.test(P.alerts[0] || '')], [0, true], 'Admin Staff cannot create an administrator, whatever page calls it');
  P = page({ role: 'admin', me: { name: 'Marcia Thompson', username: 'mthompson' }, fields: { newUserName: 'Neville Shaw', newUserRole: 'admin', newUserUsername: 'nshaw', newUserPassword: 'Admin-2026!', newUserEmail: '', newUserProgramme: '' } });
  await P.createUserAccount();
  assertEq([P.userAccounts.length, P.userAccounts[0].role, P.userAccounts[0].createdBy, P.userAccounts[0].approvedBy, P.published], [1, 'admin', 'mthompson', undefined, 0],
    'an administrator can; a staff account is not "approved", and publishes nothing');
  P.fields.newUserName = 'Odalys Facey'; P.fields.newUserRole = 'student'; P.fields.newUserUsername = 'odalys.facey'; P.fields.newUserEmail = 'odalys@example.com'; P.fields.newUserProgramme = 'Cosmetology'; P.fields.newUserPassword = 'Odalys-2026';
  await P.createUserAccount();
  const o = P.userAccounts[1];
  assertEq([o.role, o.status, o.createdByRole, o.approvedBy, o.approvedByName, P.published], ['student', 'active', 'admin', 'admin', 'Marcia Thompson', 1], 'a trainee made there is active, approved by the administrator, and published at once');
  P.fields.newUserUsername = 'odalys2'; P.fields.newUserName = 'Odalys Facey'; P.fields.newUserEmail = 'Odalys@example.com'; P.fields.newUserProgramme = 'Cosmetology'; P.fields.newUserPassword = 'Odalys-2026'; P.fields.newUserRole = 'student';
  await P.createUserAccount();
  assertEq([P.userAccounts.length, /email already exists/.test(P.alerts[P.alerts.length - 1])], [2, true], 'and a second trainee account on that address is refused there too');

  /* ---------- 3. Verify Users / Trainee Accounts ---------- */
  console.log('\nWho may decide on an account: an administrator any; Admin Staff a trainee\'s only');
  const stu = { id: 'S', role: 'student', status: 'pending', registeredVia: 'home-registration' };
  const ins = { id: 'I', role: 'instructor', status: 'pending', registeredVia: 'registration' };
  const odd = { id: 'X', role: 'admin', status: 'pending', registeredVia: 'home-registration' };
  P = page({ role: 'admin' });
  assertEq([P.accountReviewAllowed(stu), P.accountReviewAllowed(ins)], [true, true], 'an administrator: both');
  P = page({ role: 'adminstaff' });
  assertEq([P.accountReviewAllowed(stu), P.accountReviewAllowed(ins), P.accountReviewAllowed(odd)], [true, false, false], 'Admin Staff: the trainee\'s only — never an instructor, never a registration asking for a staff role');
  P = page({ role: 'adminstaff', access: { traineeaccounts: false } });
  assertEq(P.accountReviewAllowed(stu), false, 'and nothing with the tick off');
  P = page({ role: 'instructor' });
  assertEq(P.accountReviewAllowed(stu), false, 'an instructor: nothing');
  P = page({ role: 'adminstaff' });
  const u = {};
  P.stampReviewer(u);
  assertEq([u.approvedBy, u.approvedByName], ['adminstaff', 'Sheryl Brown'], 'a decision says who made it');
  assertEq(Core.accountAccess.isPrivilegedSelfRegistration(odd), true, 'a registration from home is a trainee\'s or a staff role it may not have');

  console.log('"Trainee Accounts" is allowed by default and governs its own Admin Staff page');
  const defaults = vm.runInNewContext(extractStatement('var AS_ACCESS_DEFAULTS = {', '};') + '; AS_ACCESS_DEFAULTS');
  assertEq(defaults.traineeaccounts, true, 'on unless an Administrator turns it off (the owner: they can)');
  const perms = vm.runInNewContext(extractStatement('var AS_PAGE_PERMISSION = {', '};') + '; AS_PAGE_PERMISSION');
  assertEq(perms['as-trainee-accounts'], 'traineeaccounts', 'the Trainee Accounts page needs it');
  const grid = vm.runInNewContext(extractStatement('var asAccessPages = [', '];') + '; asAccessPages');
  assert(grid.some(p => p.key === 'traineeaccounts' && /trainees only/.test(p.desc)), 'and the Administrator\'s grid offers it, saying "trainees only"');
  assert(/data-page="as-trainee-accounts"/.test(PAGE) && /id="page-as-trainee-accounts"/.test(PAGE), 'Admin Staff have the page and its sidebar entry');
  assert(/onclick="openAddTraineeAccount\(\)"/.test(VERIFY), 'Verify Users (and Trainee Accounts) offer "+ Add Trainee Account"');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
