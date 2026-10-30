/* "Office today": what is waiting for the office, on both office dashboards.

   What happened (office audit OF-1, management M10): neither the
   Administrator's nor the Admin Staff's dashboard showed what was waiting.
   With 12 home registrations and 6 certificate/transcript requests waiting
   there were 0 signs on the first screen; the Administrator's counts sat in
   menu groups that started collapsed at every sign-in, and a new Admin Staff
   member was greeted with "0% Performance — Needs Improvement" before
   anybody had given them anything to do.

   What this pins:
     1  CESTISCore.officeToday (both builds): days waiting, the four details a
        record may lack (telephone, email, date of birth, gender — a detail
        typed on the fee record counts), the requests waiting oldest first,
        certificates to hand out, programmes taking trainees with no fee set;
     2  the page code (index.html, officeTodayLines / renderOfficeToday): the
        Administrator sees five lines; Admin Staff only the lines they may act
        on (registrations with "Trainee Accounts", certificates with
        "Certificates"); each line opens its page in one click;
     3  the menu groups the Administrator opened are remembered on THIS device
        only ('cestisNavOpen': never in a backup or the shared files);
     4  a new Admin Staff member with no duties sees no 0% and no "Needs
        Improvement".

   Run: node tests/office-today.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const DAY = 86400000;
const NOW = Date.parse('2026-10-30T15:00:00Z');

/* ---------- 1. The counting rules, both builds ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], OT = pair[1].officeToday;
  console.log('\n[' + where + '] Days waiting');
  assertEq(OT.daysWaiting(new Date(NOW - 3 * DAY - 1000).toISOString(), NOW), 3, 'three days and a second is 3 days');
  assertEq(OT.daysWaiting(new Date(NOW - 3600e3).toISOString(), NOW), 0, 'an hour ago is today');
  assertEq(OT.daysWaiting('', NOW), 0, 'no date is not a wait');
  assertEq(OT.waitingText(0), 'since today', 'today');
  assertEq(OT.waitingText(1), '1 day waiting', 'one day');
  assertEq(OT.waitingText(12), '12 days waiting', 'twelve days');

  console.log('[' + where + '] The four details a record may lack');
  assertEq(OT.missingDetails({ phone: '876-555-0101', email: 'a@b.jm', dob: '2005-01-02', gender: 'Female' }, null, null), [], 'a complete record lacks nothing');
  assertEq(OT.missingDetails({}, null, null), ['telephone', 'email', 'date of birth', 'gender'], 'an empty record lacks all four');
  assertEq(OT.missingDetails({ name: 'Akeem Williams' }, { contact: '876-555-0102', email: 'akeem@x.jm', dateOfBirth: '2004-03-11', gender: 'Male' }, null), [],
    'what the office typed on the fee record counts');
  assertEq(OT.missingDetails({ gender: 'Male' }, null, { phone: '876-555-0103', email: 'p@x.jm' }), ['date of birth'], 'the profile\'s telephone and email count');
  assertEq(OT.missingDetails({ phone: '  ', email: 'x@y.jm', dob: '2004-01-01', gender: 'Female' }, null, null), ['telephone'], 'spaces are blank');

  console.log('[' + where + '] Only trainees still with the Centre');
  const studs = [
    { id: 'S1', name: 'Akeem Williams', stage: 'training' },
    { id: 'S2', name: 'Brianna Grant', stage: 'testing', phone: '1', email: 'e', dob: 'd', gender: 'Female' },
    { id: 'S3', name: 'Chevaughn Morgan', stage: 'collected' },
    { id: 'S4', name: 'Dalvia Richards', stage: 'interview', gender: 'Female' },
    { id: 'S5', name: 'Everton Campbell' }
  ];
  const miss = OT.recordsMissingDetails(studs, s => (s.id === 'S4' ? { contact: '876', email: 'd@x.jm', dateOfBirth: '2006-01-01' } : null), null);
  assertEq(miss.map(m => m.student.id), ['S1', 'S5'], 'a collected certificate is no longer counted; a record with no stage is in training; S4 is complete with her fee record');

  console.log('[' + where + '] Requests waiting, oldest first');
  const reqs = [
    { id: 'R1', studentName: 'Kadeem Ellis', status: 'pending', requestedAt: new Date(NOW - 2 * DAY).toISOString() },
    { id: 'R2', studentName: 'Tashoya Francis', status: 'processing', requestedAt: new Date(NOW - 9 * DAY).toISOString() },
    { id: 'R3', studentName: 'Romaine Hylton', status: 'ready', requestedAt: new Date(NOW - 20 * DAY).toISOString() },
    { id: 'R4', studentName: 'Annakay McKenzie', status: 'collected', requestedAt: new Date(NOW - 30 * DAY).toISOString() },
    null
  ];
  const rq = OT.openRequests(reqs, NOW);
  assertEq(rq.count, 2, 'pending and processing are waiting for the office (the menu count\'s rule)');
  assertEq(rq.oldest && rq.oldest.id, 'R2', 'the oldest waiting one');
  assertEq(rq.oldestDays, 9, 'waiting 9 days');
  assertEq(OT.openRequests([], NOW), { count: 0, oldest: null, oldestDays: 0, list: [] }, 'nothing waiting');

  console.log('[' + where + '] Certificates to hand out');
  assertEq(OT.certificatesToHandOut([{ id: 'A', stage: 'certified' }, { id: 'B', stage: 'certified', certCollected: true }, { id: 'C', stage: 'collected' }, { id: 'D', stage: 'training' }]).map(s => s.id),
    ['A'], 'certified and not yet collected');

  console.log('[' + where + '] Programmes with no fee set');
  const fs1 = { 'Welding & Fabrication': { total: 85000 }, 'cosmetology': { total: 90000 }, '03. Plumbing': { total: 70000 }, 'Commercial Cooking': { total: 0 } };
  assertEq(OT.programmesWithoutFee(['Welding & Fabrication', 'Cosmetology', 'Plumbing', 'Commercial Cooking', 'Electrical Installation', 'Electrical Installation'], fs1),
    ['Commercial Cooking', 'Electrical Installation'], 'any spelling counts, an intake\'s label counts, a fee of 0 is no fee, each programme once');
  assertEq(OT.programmesWithoutFee(['05. Welding & Fabrication'], fs1), [], 'an intake of a priced programme is priced');
  assertEq(OT.someNames(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more', 'a few names');
  assertEq(OT.someNames(['A', 'B']), 'A and B', 'two names');
  assertEq(OT.someNames(['A']), 'A', 'one name');
});

/* ---------- 2. The page code ---------- */
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
const Core = require('../cestis-core.js');
function sandbox(role, access) {
  const store = {
    voctrain_certTranscriptRequests: JSON.stringify([
      { id: 'R1', studentName: 'Kadeem Ellis', status: 'pending', requestedAt: new Date(Date.now() - 2 * DAY).toISOString() },
      { id: 'R2', studentName: 'Tashoya Francis', status: 'processing', requestedAt: new Date(Date.now() - 9 * DAY).toISOString() }]),
    cestiSchoolFeeStudents: JSON.stringify([{ id: 'F1', lmsId: 'S1', name: 'Akeem Williams', skillArea: 'Welding & Fabrication', contact: '876-555-0101', email: 'akeem@x.jm', dateOfBirth: '2004-03-11', gender: 'Male' }]),
    cestiFeeStructure: JSON.stringify({ 'Welding & Fabrication': { total: 85000 } })
  };
  const box = { innerHTML: '', closest: () => ({ classList: { contains: () => true } }) };
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Object, Array, String, Math, parseFloat,
    CESTISCore: Core,
    CESTISStore: { getItem: k => (k in store ? store[k] : null) },
    currentRole: role,
    currentLoggedInUser: { id: role === 'admin' ? 'USR-mthompson' : 'USR-sbrown', role },
    adminStaffAccessSettings: Object.assign({ traineeaccounts: true, certificates: false }, access || {}),
    userAccounts: [
      { id: 'USR-h1', name: 'Shantelle Barrett', role: 'student', status: 'pending', registeredVia: 'home-registration', programme: 'Cosmetology' },
      { id: 'USR-h2', name: 'Kadeem Ellis', role: 'student', status: 'pending', registeredVia: 'home-registration', programme: 'Plumbing' },
      { id: 'USR-i1', name: 'Ian Reid', role: 'instructor', status: 'pending', registeredVia: 'registration' }],
    students: [
      { id: 'S1', name: 'Akeem Williams', course: 'Welding & Fabrication', stage: 'training' },
      { id: 'S2', name: 'Brianna Grant', course: 'Cosmetology', stage: 'training' },
      { id: 'S3', name: 'Chevaughn Morgan', course: 'Plumbing', stage: 'certified' }],
    studentProfiles: {},
    officeEnrollingProgrammes: () => ['Welding & Fabrication', 'Cosmetology', 'Plumbing'],
    escapeHtml: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    escapeAttr: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    jsArg: v => JSON.stringify(String(v)).replace(/"/g, '&quot;'),
    document: { getElementById: id => (id === 'officeTodayCard' ? box : null) },
    box
  };
  vm.createContext(sb);
  vm.runInContext(PAGE.slice(PAGE.indexOf('var AS_ACCESS_DEFAULTS = {'), PAGE.indexOf('};', PAGE.indexOf('var AS_ACCESS_DEFAULTS = {')) + 2), sb);
  ['adminStaffAccessDefaults', 'asAccessFor', 'asAccessForMe', 'accountReviewAllowed', 'officeMay', 'officeTodayLines', 'renderOfficeToday'].forEach(n => vm.runInContext(extractFunction(n), sb));
  return sb;
}
console.log('\n[index.html] The Administrator sees every line, each opening its page');
{
  const sb = sandbox('admin');
  const lines = sb.officeTodayLines();
  assertEq(lines.map(l => l.key), ['registrations', 'requests', 'details', 'certificates', 'fees'], 'five lines');
  const by = k => lines.find(l => l.key === k);
  assertEq(by('registrations').count, 3, 'every registration waiting (an administrator decides on any account)');
  assertEq(by('registrations').page, 'verify-users', 'opens Verify Users');
  assertEq(by('requests').count, 2, 'two requests waiting');
  assert(/Tashoya Francis, 9 days waiting/.test(by('requests').detail), 'the oldest one and how long it has waited: ' + by('requests').detail);
  assertEq(by('requests').page, 'cert-transcript-requests', 'opens the requests');
  assert(by('requests').urgent === true, 'a week or more is shown as urgent');
  assertEq(by('details').count, 1, 'one current trainee lacks details (Akeem\'s are on his fee record; a certified trainee is no longer counted)');
  assertEq(by('details').page, 'fee-management', 'opens School Fee, where they are typed');
  assertEq(by('certificates').count, 1, 'one certificate to hand out');
  assertEq(by('certificates').page, 'certificates', 'opens Certificates');
  assertEq(by('fees').count, 2, 'Cosmetology and Plumbing have no fee set');
  assertEq(by('fees').detail, 'Cosmetology and Plumbing', 'named');
  sb.renderOfficeToday();
  assert(/Office today/.test(sb.box.innerHTML), 'the box is drawn');
  assertEq((sb.box.innerHTML.match(/<button /g) || []).length, 5, 'five one-click lines');
  assert(/onclick="showPage\(&quot;verify-users&quot;\)"/.test(sb.box.innerHTML), 'the registrations line opens Verify Users in one click');
  assert(/<span class="ot-count">3<\/span><span class="ot-text"><span class="ot-msg">registrations waiting for approval/.test(sb.box.innerHTML), 'in plain words, the number once');
}
console.log('[index.html] Admin Staff see only the lines they may act on');
{
  const sb = sandbox('adminstaff');
  const lines = sb.officeTodayLines();
  assertEq(lines.map(l => l.key), ['registrations', 'requests', 'details', 'fees'], 'no certificates line without the Certificates tick');
  assertEq(lines[0].count, 2, 'trainees\' registrations only (never an instructor\'s)');
  assertEq(lines[0].page, 'as-trainee-accounts', 'opens Trainee Accounts');
  assertEq(lines[1].page, 'as-cert-transcript-requests', 'their requests page');
  assertEq(lines[2].page, 'as-fee-management', 'their School Fee page');
  const sb2 = sandbox('adminstaff', { traineeaccounts: false, certificates: true });
  assertEq(sb2.officeTodayLines().map(l => l.key), ['requests', 'details', 'certificates', 'fees'], 'Trainee Accounts off: no registrations line; Certificates on: its line');
  assertEq(sandbox('instructor').officeTodayLines(), [], 'an instructor has no Office today');
}
console.log('[index.html] Both dashboards carry the box and draw it');
assert(/<section class="page active" id="page-dashboard">\s*<div id="sappAdminDueCard"><\/div>\s*<div id="officeTodayCard"><\/div>/.test(PAGE), 'the Administrator\'s dashboard');
assert(/html \+= '<div id="officeTodayCard"><\/div>';/.test(extractFunction('buildAdminStaffPages')), 'the Admin Staff dashboard');
assert(/renderOfficeToday\(\)/.test(extractFunction('buildAdminPages')) && /renderOfficeToday\(\)/.test(extractFunction('buildAdminStaffPages')), 'drawn when each is built');
assert(/pageId === 'dashboard' \|\| pageId === 'as-dashboard'\) \{ try \{ renderOfficeToday\(\)/.test(extractFunction('showPage')), 'and again each time it is shown');

/* ---------- 3. The menu groups, remembered on this device only ---------- */
console.log('\n[index.html] The menu groups the Administrator opened stay open next time, on this device');
{
  const ls = {};
  const mk = (label, collapsed) => {
    const group = { classList: new Set(collapsed ? ['nav-section-group', 'collapsed'] : ['nav-section-group']) };
    const l = { textContent: label, attrs: {}, classList: new Set(collapsed ? ['nav-section-toggle', 'collapsed'] : ['nav-section-toggle']), nextElementSibling: group,
      setAttribute(k, v) { this.attrs[k] = v; } };
    [l.classList, group.classList].forEach(cl => { cl.contains = cl.has; cl.toggle = function (c, on) { if (on === undefined) on = !this.has(c); if (on) this.add(c); else this.delete(c); return on; }; });
    return l;
  };
  let labels = [mk('Learning', true), mk('Management', true), mk('Administration', true)];
  const sb = { JSON, Array, String, localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } }, currentRole: 'admin',
    document: { querySelectorAll: () => labels } };
  vm.createContext(sb);
  vm.runInContext("var NAV_OPEN_KEY = 'cestisNavOpen';", sb);
  ['toggleNavSection', 'navGroupsRead', 'navGroupLabel', 'navGroupsRemember', 'navGroupsRestore'].forEach(n => vm.runInContext(extractFunction(n), sb));
  sb.toggleNavSection(labels[1]);
  sb.toggleNavSection(labels[2]);
  assertEq(JSON.parse(ls.cestisNavOpen), { admin: ['Management', 'Administration'] }, 'opening two groups is remembered');
  // Signing in again: the sidebar is drawn afresh, every group collapsed.
  labels = [mk('Learning', true), mk('Management', true), mk('Administration', true)];
  sb.navGroupsRestore('admin');
  assertEq(labels.map(l => !l.classList.has('collapsed')), [false, true, true], 'the same groups are open again');
  assert(!labels[1].nextElementSibling.classList.has('collapsed') && labels[1].attrs['aria-expanded'] === 'true', 'their items shown, and said to be open');
  sb.toggleNavSection(labels[1]);
  assertEq(JSON.parse(ls.cestisNavOpen).admin, ['Administration'], 'closing one is remembered too');
  ls.cestisNavOpen = 'not json';
  labels = [mk('Learning', true)];
  sb.navGroupsRestore('admin');
  assert(labels[0].classList.has('collapsed'), 'an unreadable preference leaves the menu as built');
  assert(/navGroupsRestore\('admin'\)/.test(extractFunction('buildAdminSidebar')), 'the Administrator\'s sidebar restores them when it is drawn');
}
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  assert(pair[1].isSnapshotableKey('cestisNavOpen') === false, pair[0] + ': never in a backup snapshot');
});
['cestis-page-cloud.js', 'Offline System/cestis-page-cloud.js'].forEach(function (f) {
  const PC = fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert(/DEVICE_KEYS = \[[^\]]*'cestisNavOpen'/.test(PC), f + ': never in the Centre network\'s copy of this device\'s store');
});

/* ---------- 4. A new Admin Staff member ---------- */
console.log('\n[index.html] A new Admin Staff member with no duties is not told "Needs Improvement"');
{
  const src = extractFunction('buildAdminStaffPages');
  const at = src.indexOf('if(perf.total === 0)');
  assert(at !== -1, 'the dashboard asks whether there is anything to judge yet');
  const noData = src.slice(at, src.indexOf('} else {', at));
  assert(/No duties have been given to you yet/.test(noData), 'it says so in plain words');
  assert(!/perf\.score|badge\.label|Needs Improvement/.test(noData), 'with no score and no badge');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
