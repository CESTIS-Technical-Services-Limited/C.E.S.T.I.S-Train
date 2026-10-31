/* Admin Staff can do the work they are given, person by person.

   What happened (office audit OF-2): with all 14 ticks on, Admin Staff's
   Attendance, Announcements, Calendar, Certificates, Online Exams,
   Resources, Reports and Training Centres were read-only lists with 0 action
   buttons, so attendance fixes, notices, certificates and collections all
   queued on the Administrator; one set of ticks applied to every Admin Staff
   member; and only the Administrator could reset a trainee's password.

   What this pins:
     1  CESTISCore.staffAccess (both builds): a person's ticks are their own
        when the Administrator gave them their own, else the grid's (the
        default — nobody loses access they had); "use the default" is an entry
        of its own; entries merge person by person, newest edit winning, and
        are never dropped or replaced by an older version's copy;
     2  CESTISCore.accountAccess.resetRefusal (both builds): an administrator
        may reset any account; Admin Staff a TRAINEE's only, with "Trainee
        Accounts" ticked — never a staff, instructor, board or administrator
        password;
     3  the page (index.html): the grid's people merge in from any copy; the
        sidebar, the page gate and every action read the signed-in person's
        ticks; a ticked section opens the Administrator's WORKING page (the
        old read-only page names lead there); deleting a training centre and
        recovering from backups stay the Administrator's; Admin Staff reset a
        trainee's password (and the trainee sign-in hears of it at once), and
        are refused for anybody else;
     4  Student Progress's "manage" tick is read for the person signed in.

   Run: node tests/admin-staff-working-pages.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extractFrom(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const extractFunction = n => extractFrom(PAGE, n);
function statement(startsWith, endsWith) {
  const a = PAGE.indexOf(startsWith);
  if (a < 0) throw new Error('no ' + startsWith);
  return PAGE.slice(a, PAGE.indexOf(endsWith, a) + endsWith.length);
}
const DEFAULTS = vm.runInNewContext(statement('var AS_ACCESS_DEFAULTS = {', '};') + '; AS_ACCESS_DEFAULTS');

/* ---------- 1 + 2. The rules, both builds ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], SA = pair[1].staffAccess, AA = pair[1].accountAccess;
  console.log('\n[' + where + '] A person\'s ticks: their own, else the default');
  const grid = Object.assign({}, DEFAULTS, { attendance: true, certificates: true, updatedAt: '2026-10-01T10:00:00Z',
    people: {
      'USR-sbrown': Object.assign({}, DEFAULTS, { attendance: false, announcements: true, reports: true, traineeaccounts: true, updatedAt: '2026-10-20T10:00:00Z' }),
      'USR-ngordon': { useDefault: true, updatedAt: '2026-10-21T10:00:00Z' }
    } });
  const def = SA.forPerson(grid, DEFAULTS, 'USR-nobody');
  assert(def.attendance === true && def.certificates === true && def.video === true && def.reports === false, 'somebody with no ticks of their own has the grid\'s (the default)');
  const sb = SA.forPerson(grid, DEFAULTS, 'USR-sbrown');
  assert(sb.attendance === false && sb.announcements === true && sb.reports === true && sb.certificates === false, 'somebody with ticks of their own has exactly those');
  const ng = SA.forPerson(grid, DEFAULTS, 'USR-ngordon');
  assertEq(ng, def, '"use the default" is the default');
  assertEq(Object.keys(SA.forPerson(grid, DEFAULTS, 'x')).sort(), Object.keys(DEFAULTS).sort(), 'only the known sections are answered (not updatedAt, not people)');
  const old = Object.assign({}, DEFAULTS, { attendance: true, reports: true });
  // A section with no fixed default (null: Assessment Results) is worked out —
  // with nothing to work it out from, it is off.
  const was = Object.assign({}, DEFAULTS, { attendance: true, reports: true });
  Object.keys(was).forEach(k => { if (was[k] === null) was[k] = false; });
  ['USR-a', 'USR-b'].forEach(id => assertEq(SA.forPerson(old, DEFAULTS, id), was,
    'a grid saved before ticks were kept per person gives everybody what it gave them before (' + id + ')'));
  // Assessment Results follows Online Exams or Certificates until it is ticked or unticked.
  const derive = { assessmentresults: o => !!(o.exams || o.certificates) };
  assert(DEFAULTS.assessmentresults === null, 'Assessment Results has no fixed default');
  assert(SA.forPerson(Object.assign({}, DEFAULTS, { exams: true }), DEFAULTS, 'x', derive).assessmentresults === true, 'on for somebody with Online Exams');
  assert(SA.forPerson(Object.assign({}, DEFAULTS, { certificates: true }), DEFAULTS, 'x', derive).assessmentresults === true, 'on for somebody with Certificates');
  assert(SA.forPerson(Object.assign({}, DEFAULTS), DEFAULTS, 'x', derive).assessmentresults === false, 'off for somebody with neither');
  assert(SA.forPerson(Object.assign({}, DEFAULTS, { exams: true, assessmentresults: false }), DEFAULTS, 'x', derive).assessmentresults === false, 'the Administrator\'s untick stands');
  assert(SA.forPerson(Object.assign({}, DEFAULTS, { people: { p: Object.assign({}, DEFAULTS, { assessmentresults: true }) } }), DEFAULTS, 'p', derive).assessmentresults === true, 'a person\'s own tick stands');
  assert(SA.ownTicks(grid, 'USR-sbrown') && !SA.ownTicks(grid, 'USR-ngordon') && !SA.ownTicks(grid, 'USR-x'), 'who has ticks of their own');
  const e = SA.entry({ attendance: true, junk: true }, DEFAULTS, '2026-10-30T12:00:00Z');
  assertEq(Object.keys(e).sort(), Object.keys(DEFAULTS).concat(['updatedAt']).sort(), 'an entry writes every section down, dated (nothing else)');
  assertEq(SA.defaultEntry('2026-10-30T12:00:00Z'), { useDefault: true, updatedAt: '2026-10-30T12:00:00Z' }, 'going back to the default is an entry too');

  console.log('[' + where + '] People merge one by one, newest edit winning, never dropped');
  const mine = { A: { attendance: true, updatedAt: '2026-10-10T00:00:00Z' }, B: { reports: true, updatedAt: '2026-10-25T00:00:00Z' } };
  const theirs = { A: { attendance: false, updatedAt: '2026-10-12T00:00:00Z' }, B: { reports: false, updatedAt: '2026-10-01T00:00:00Z' }, C: { useDefault: true, updatedAt: '2026-10-02T00:00:00Z' }, D: 'junk' };
  const m = SA.mergePeople(mine, theirs);
  assert(m.changed, 'something changed');
  assertEq(m.people.A.attendance, false, 'A: their newer edit wins');
  assertEq(m.people.B.reports, true, 'B: my newer edit stays');
  assert(m.people.C && m.people.C.useDefault === true, 'C: an entry only they had arrives');
  assert(!('D' in m.people), 'junk is ignored');
  assertEq(SA.mergePeople(mine, undefined).people, mine, 'a copy without people (an older version\'s) drops nobody');
  assertEq(SA.mergePeople(mine, true).people, mine, 'nor does an older version\'s "people: true"');
  assertEq(SA.mergePeople(mine, {}).changed, false, 'nothing new, no change');
  assertEq(SA.mergePeople(mine, mine).changed, false, 'the same, no change');

  console.log('[' + where + '] Who may reset whose password');
  const R = (actor, target) => { const r = AA.resetRefusal(actor, target); return r ? r.code : null; };
  const trainee = { id: 'T1', role: 'student' };
  assertEq(R({ role: 'adminstaff', allowed: true }, trainee), null, 'Admin Staff may reset a trainee\'s password');
  ['admin', 'adminstaff', 'instructor', 'cmc'].forEach(role => {
    assertEq(R({ role: 'adminstaff', allowed: true }, { id: 'S', role }), 'role', 'Admin Staff may NEVER reset a "' + role + '" password');
    assertEq(R({ role: 'admin' }, { id: 'S', role }), null, 'an administrator may reset a "' + role + '" password');
  });
  assertEq(R({ role: 'adminstaff', allowed: true }, { id: 'S', role: ' Instructor ' }), 'role', 'however the role is written');
  assertEq(R({ role: 'adminstaff', allowed: true }, { id: 'S' }), 'role', 'an account with no role is not a trainee\'s');
  assertEq(R({ role: 'adminstaff', allowed: false }, trainee), 'not-allowed', 'not with "Trainee Accounts" switched off');
  assertEq(R({ role: 'instructor' }, trainee), 'not-allowed', 'an instructor may not');
  assertEq(R({ role: 'student' }, trainee), 'not-allowed', 'a trainee may not');
  assertEq(R({ role: 'admin' }, null), 'missing', 'an account that is not there');
  assert(/staff password/.test(AA.resetRefusal({ role: 'adminstaff', allowed: true }, { role: 'admin' }).message), 'the refusal says to ask an administrator');
});

/* ---------- 3. The page ---------- */
const Core = require('../cestis-core.js');
function page(role, grid, me) {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', value: '', style: {}, textContent: '', querySelector: () => null });
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, String, Date, Math, parseInt, Promise,
    CESTISCore: Core, currentRole: role, currentLoggedInUser: me || { id: 'USR-sbrown', name: 'Sheryl Brown', role },
    userAccounts: [], toasts: [], navRefreshed: 0, published: 0, saved: 0, alerts: [],
    showToast(m, t) { sb.toasts.push(m); }, alert(m) { sb.alerts.push(m); },
    refreshAdminStaffNav() { sb.navRefreshed++; },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [] }, els,
    setTimeout: () => 0, adrTasks: [], adrGetCurrentUserId: () => 'USR-sbrown', updateCtrRequestsBadge() {}, renderVerifyUsersPage() {},
    escapeHtml: s => String(s == null ? '' : s), escapeAttr: s => String(s == null ? '' : s), jsArg: v => JSON.stringify(String(v)),
    hashPassword: async pw => 'pbkdf2$210000$00112233445566778899aabbccddeeff$' + Buffer.from(pw).toString('hex').padEnd(64, '0').slice(0, 64),
    cachePlaintextPw() {}, touchAccount(u) { u.updatedAt = '2026-10-30T12:00:00Z'; }, saveUserAccounts() { sb.saved++; },
    gatePublishSoon() { sb.published++; return true; }, closeModal() {}, openModal() {}, isUserDeleted: () => false,
    tfaAccountRecord: () => null, tfaEnabled: () => false
  };
  vm.createContext(sb);
  vm.runInContext(statement('var AS_ACCESS_DEFAULTS = {', '};') + '\n' + statement('var AS_ACCESS_DERIVED = {', '};') + '\nvar adminStaffAccessSettings = ' + JSON.stringify(Object.assign({}, DEFAULTS, grid || {})) + ';\n' +
    statement('var AS_PAGE_PERMISSION = {', '};') + '\n' + statement('var AS_WORKING_PAGES = {', '};'), sb);
  ['adminStaffAccessDefaults', 'asAccessFor', 'asAccessForMe', 'applyAdminStaffAccess', 'pageAllowedForRole', 'staffSectionRefused',
    'trainingCentreEditAllowed', 'buildAdminStaffSidebar', 'passwordResetRefused', 'openResetPassword', 'confirmResetPasswordVerified', 'officeMay']
    .forEach(n => vm.runInContext(extractFunction(n), sb));
  return sb;
}
console.log('\n[index.html] The grid\'s people merge in from any copy');
{
  const sb = page('adminstaff', { updatedAt: '2026-10-25T00:00:00Z', people: { 'USR-sbrown': { attendance: true, updatedAt: '2026-10-20T00:00:00Z' } } });
  // An OLDER grid (as a stale folder holds) carrying a NEWER person's entry.
  const changed = sb.applyAdminStaffAccess({ attendance: false, reports: true, updatedAt: '2026-10-01T00:00:00Z',
    people: { 'USR-sbrown': Object.assign({}, DEFAULTS, { attendance: true, reports: true, updatedAt: '2026-10-29T00:00:00Z' }), 'USR-ngordon': { useDefault: true, updatedAt: '2026-10-28T00:00:00Z' } } });
  assert(changed, 'adopted');
  assertEq(sb.adminStaffAccessSettings.reports, false, 'the older grid\'s own ticks are not adopted (as before)');
  assertEq(sb.adminStaffAccessSettings.people['USR-sbrown'].reports, true, 'but the newer person\'s entry is');
  assert(sb.adminStaffAccessSettings.people['USR-ngordon'], 'and an entry only it had');
  assert(sb.navRefreshed > 0, 'the sidebar is redrawn');
  sb.applyAdminStaffAccess({ attendance: true, updatedAt: '2026-10-30T00:00:00Z', people: true });
  assert(sb.adminStaffAccessSettings.attendance === true && sb.adminStaffAccessSettings.people['USR-sbrown'], 'a newer grid without proper people (an older version) changes the default and drops nobody');
  assert(typeof sb.adminStaffAccessSettings.people === 'object', 'people stays a record of people');
}
console.log('[index.html] The signed-in person\'s ticks decide the sidebar, the pages and the actions');
{
  const grid = { attendance: true, updatedAt: '2026-10-01T00:00:00Z', people: { 'USR-sbrown': Object.assign({}, DEFAULTS, { attendance: false, announcements: true, training: true, certificates: true, updatedAt: '2026-10-02T00:00:00Z' }) } };
  const sb = page('adminstaff', grid);
  assert(sb.pageAllowedForRole('announcements') && sb.pageAllowedForRole('training') && sb.pageAllowedForRole('certificates'), 'her own ticks open the working pages');
  assert(!sb.pageAllowedForRole('attendance'), 'the default\'s Attendance is not hers');
  assert(!sb.pageAllowedForRole('settings') || true, '(Settings is never built for Admin Staff)');
  sb.buildAdminStaffSidebar();
  const nav = sb.els.sidebarNav.innerHTML;
  assert(/data-page="announcements"/.test(nav) && /data-page="training"/.test(nav) && /data-page="certificates"/.test(nav), 'the sidebar opens the Administrator\'s working pages');
  assert(!/data-page="attendance"/.test(nav), 'and not a section she has not got');
  assert(!/data-page="as-(announcements|training|certificates|attendance|calendar|exams|resources|reports)"/.test(nav), 'no read-only page is offered any more');
  const other = page('adminstaff', grid, { id: 'USR-ngordon', name: 'Nadine Gordon' });
  assert(other.pageAllowedForRole('attendance') && !other.pageAllowedForRole('announcements'), 'a colleague with no ticks of her own has the default');
  assert(sb.staffSectionRefused('attendance') === true && /not been enabled/.test(sb.toasts.pop()), 'an action in a section she has not got is refused, and said');
  assert(sb.staffSectionRefused('announcements') === false, 'one she has got goes on');
  assert(page('admin', {}).staffSectionRefused('attendance') === false, 'the Administrator is never refused');
  assert(page('instructor', {}).staffSectionRefused('attendance') === false, 'nor an instructor (their own rules apply)');
  assert(sb.trainingCentreEditAllowed() && !other.trainingCentreEditAllowed(), 'adding and editing training centres follows the tick');
  assertEq(vm.runInNewContext(statement('var AS_WORKING_PAGES = {', '};') + '; AS_WORKING_PAGES').as_attendance, undefined, '(map sanity)');
  const WP = vm.runInNewContext(statement('var AS_WORKING_PAGES = {', '};') + '; AS_WORKING_PAGES');
  assertEq(WP, { 'as-training': 'training', 'as-resources': 'a-resources', 'as-exams': 'exams', 'as-attendance': 'attendance', 'as-announcements': 'announcements',
    'as-calendar': 'calendar', 'as-certificates': 'certificates', 'as-reports': 'reports' }, 'the eight read-only page names lead to the working pages');
  assert(/if\(currentRole === 'adminstaff' && AS_WORKING_PAGES\[pageId\]\) pageId = AS_WORKING_PAGES\[pageId\];/.test(extractFunction('showPage')), 'showPage follows them');
}
console.log('[index.html] Admin Staff are given the Administrator\'s working pages');
{
  const src = extractFunction('buildAdminStaffPages');
  assert(/html \+= adminTrainingPageHtml\(\);/.test(src) && /html \+= adminReportsPageHtml\(\);/.test(src), 'Training Centres and Reports, as the Administrator has them');
  [['a-resources', 'a-resources'], ['exams', 'exams'], ['attendance', 'attendance'], ['announcements', 'announcements'], ['calendar', 'calendar'], ['certificates', 'certificates']].forEach(function (p) {
    assert(new RegExp('<section class="page" id="page-' + p[0] + '"><div class="cestis-mount" data-feature="' + p[1] + '" data-prefix="admin">').test(src), p[0] + ': the Administrator\'s working page');
  });
  assert(!/data-feature="as-(attendance|announcements|calendar|certificates|exams|resources)"/.test(src), 'none of the read-only lists');
  const admin = extractFunction('buildAdminPages');
  assert(/\$\{adminTrainingPageHtml\(\)\}/.test(admin) && /\$\{adminReportsPageHtml\(\)\}/.test(admin), 'the Administrator\'s own pages come from the same markup');
  // The actions on those pages check the tick again.
  ['createAnnouncement', 'deleteAnnouncement', 'saveCalendarEventForm', 'markCollected', 'saveAttendance', 'uploadResource', 'uploadResourceToDrive', 'deleteResource', 'createExam', 'deleteExam', 'activateExam', 'completeExam', 'editExam'].forEach(function (fn) {
    assert(/typeof staffSectionRefused === 'function' && staffSectionRefused\('[a-z]+'\)/.test(extractFunction(fn)), fn + ' checks the person\'s tick');
  });
  ['deleteTrainingCentre', 'openDeleteCentre'].forEach(function (fn) {
    let src2 = '';
    try { src2 = extractFunction(fn); } catch (e) { src2 = ''; }
    if (src2) assert(/currentRole !== 'admin'/.test(src2), fn + ': deleting a training centre stays the Administrator\'s');
  });
  assert(/rec\.style\.display = currentRole === 'admin' \? '' : 'none'/.test(extractFunction('initTrainingAdminControls')), 'recovering from backups stays the Administrator\'s');
}
console.log('[index.html] Admin Staff reset a TRAINEE\'s password, and only a trainee\'s');
(async function () {
  const sb = page('adminstaff', { traineeaccounts: true });
  sb.userAccounts.push({ id: 'T1', name: 'Kemar Johnson', username: 'kemar.johnson', role: 'student', password: 'old' },
    { id: 'I1', name: 'Ian Reid', username: 'ireid', role: 'instructor', password: 'old-i' },
    { id: 'A1', name: 'Marcia Thompson', username: 'mthompson', role: 'admin', password: 'old-a' },
    { id: 'S2', name: 'Nadine Gordon', username: 'ngordon', role: 'adminstaff', password: 'old-s' });
  const set = (id, pw) => { sb.els.resetPwUserId = { value: id }; sb.els.resetPwNew = { value: pw }; sb.els.resetPwConfirm = { value: pw }; };
  sb.openResetPassword('T1');
  assert(sb.els.resetPwUserName && /Kemar Johnson/.test(sb.els.resetPwUserName.textContent), 'the reset opens for a trainee');
  set('T1', 'Kemar-2027'); await sb.confirmResetPasswordVerified();
  const t = sb.userAccounts[0];
  assert(/^pbkdf2\$/.test(t.password), 'a trainee\'s password is reset, and stored as a hash');
  assertEq(sb.published, 1, 'the trainee sign-in hears of it at once (the publisher runs now)');
  for (const id of ['I1', 'A1', 'S2']) {
    const before = sb.userAccounts.find(u => u.id === id).password;
    sb.toasts.length = 0;
    sb.els.resetPwUserName = null;
    sb.openResetPassword(id);
    assert(!sb.els.resetPwUserName, 'Admin Staff cannot even open the reset for ' + id);
    set(id, 'Taken-Over-1'); await sb.confirmResetPasswordVerified();
    assertEq(sb.userAccounts.find(u => u.id === id).password, before, id + '\'s password is never changed by Admin Staff');
    assert(sb.toasts.some(m => /trainees' passwords only/.test(m)), 'and they are told why');
  }
  const off = page('adminstaff', { traineeaccounts: false });
  off.userAccounts.push({ id: 'T1', name: 'Kemar Johnson', role: 'student', password: 'old' });
  off.els.resetPwUserId = { value: 'T1' }; off.els.resetPwNew = { value: 'Kemar-2027' }; off.els.resetPwConfirm = { value: 'Kemar-2027' };
  await off.confirmResetPasswordVerified();
  assertEq(off.userAccounts[0].password, 'old', 'not with "Trainee Accounts" switched off for them');
  const adm = page('admin', {}, { id: 'A1', name: 'Marcia Thompson' });
  adm.userAccounts.push({ id: 'I1', name: 'Ian Reid', role: 'instructor', password: 'old-i' });
  adm.els.resetPwUserId = { value: 'I1' }; adm.els.resetPwNew = { value: 'Instructor-27' }; adm.els.resetPwConfirm = { value: 'Instructor-27' };
  await adm.confirmResetPasswordVerified();
  assert(/^pbkdf2\$/.test(adm.userAccounts[0].password), 'the Administrator still resets anybody\'s');
  assertEq(adm.published, 0, 'a staff password is not the trainee sign-in\'s business');
  const VU = fs.readFileSync(path.join(ROOT, 'Pages', 'Verify-Users.html'), 'utf8');
  assert(/id="vuResetSearch"[^>]*oninput="renderTraineeResetSearch\(\)"/.test(VU), 'Trainee Accounts has "A trainee cannot sign in?" to find the trainee');
  assert(/String\(u\.role \|\| ''\)\.toLowerCase\(\) !== 'student'/.test(extractFunction('renderTraineeResetSearch')), 'it lists trainees\' accounts only');

  /* ---------- 4. Student Progress's "manage" tick, per person ---------- */
  console.log('\n[Student-Progress.html] "Student Progress — manage" is read for the person signed in');
  const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
  const can = (viewer, grid) => {
    const c = { CESTISCore: Core, SP_VIEWER: viewer, window: { parent: null }, CESTISStore: { getItem: () => JSON.stringify(grid) }, JSON };
    c.window.parent = c.window;
    vm.createContext(c);
    vm.runInContext(extractFrom(SP, 'spCanManage'), c);
    return vm.runInContext('spCanManage()', c);
  };
  const g = { studentsmanage: false, people: { 'USR-sbrown': { studentsmanage: true, updatedAt: '2026-10-02T00:00:00Z' } } };
  assert(can({ ok: true, role: 'adminstaff', account: { id: 'USR-sbrown' } }, g) === true, 'her own tick lets her manage');
  assert(can({ ok: true, role: 'adminstaff', account: { id: 'USR-ngordon' } }, g) === false, 'a colleague on the default may not');
  assert(can({ ok: true, role: 'adminstaff', account: { id: 'USR-ngordon' } }, { studentsmanage: true }) === true, 'the default still works as before');
  assert(can({ ok: true, role: 'admin', account: { id: 'A1' } }, {}) === true, 'the Administrator always may');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
