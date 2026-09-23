/* The School Fee records are one financial year at a time, like the Fixed
   Asset register.

   Reported: "every record mixes although there is a current filter". The
   dashboard had a year filter and its cards counted the present group — 240
   trainees on the Centre's roll — but the Students list underneath ignored it
   and listed all 368, from six financial years, in one table. The Reports tab
   did the same: a report titled for one month listed every trainee from every
   year. And the year the page opened on was whatever year somebody had last
   stepped to, remembered in the shared quarter key, so after entering last
   year's arrears the page came back up on last year.

   The Fixed Asset register gets this right, and this is the same system:

     1. the page opens on the fiscal year today falls in, every time, without
        writing to the shared key (so opening it moves no other page);
     2. the record lists show that year's group only, under a banner that says
        which year it is and how many of the roll that is, with the way to
        every year;
     3. a search that matches somebody the year is hiding says where they are;
     4. a record saved with a date in another year moves the page to that year
        and says so, instead of vanishing as if it had not saved.

   Run: node tests/school-fee-year-records.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const PAGES = process.argv[2]
  ? [process.argv[2]]
  : [path.join(ROOT, 'School.Fee.html'), path.join(ROOT, 'Offline System', 'School.Fee.html')];

let SRC = '', PAGE = '';

// Lift a named function out of the page so these are the page's own answers.
function extractFunction(name) {
  const at = SRC.indexOf('\n        function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

// The expression the page initialises its own year with.
function extractViewYearInit() {
  const at = SRC.indexOf('let _feeViewFY = (function () {');
  if (at < 0) throw new Error(PAGE + ' no longer initialises _feeViewFY');
  const end = SRC.indexOf('})();', at);
  return SRC.slice(at + 'let _feeViewFY = '.length, end + '})()'.length);
}

// Years relative to today, so the suite means the same thing whenever it runs.
const PRESENT = Core.currentQuarter().fy;
const startOf = fy => parseInt(fy, 10);
const fyOf = start => start + '/' + (start + 1);
const LAST = fyOf(startOf(PRESENT) - 1);
const EARLIER = fyOf(startOf(PRESENT) - 3);
const NEXT = fyOf(startOf(PRESENT) + 1);
const dayIn = (fy, mmdd) => startOf(fy) + '-' + mmdd;   // Apr–Dec of the FY's first year

const ROLL = [
  { id: 'P1', name: 'Present One', skillArea: 'WELDING L2', tuitionFee: 28000, totalPaid: 0, balance: 28000, status: 'Outstanding', enrollmentDate: dayIn(PRESENT, '05-02') },
  { id: 'P2', name: 'Present Two', skillArea: 'WELDING L2', tuitionFee: 28000, totalPaid: 28000, balance: 0, status: 'Fully Paid', enrollmentDate: dayIn(PRESENT, '06-10') },
  { id: 'L1', name: 'Last Smith', skillArea: 'WELDING L2', tuitionFee: 28000, totalPaid: 5000, balance: 23000, status: 'Partial Payment', enrollmentDate: dayIn(LAST, '09-15') },
  { id: 'L2', name: 'Last Jones', skillArea: 'COSMETOLOGY L2', tuitionFee: 38000, totalPaid: 0, balance: 38000, status: 'Outstanding', enrollmentDate: dayIn(LAST, '10-01') },
  { id: 'E1', name: 'Early Smith', skillArea: 'WELDING L2', tuitionFee: 28000, totalPaid: 0, balance: 28000, status: 'Outstanding', enrollmentDate: dayIn(EARLIER, '07-07') }
];
const clone = a => a.map(x => Object.assign({}, x));

function fakeElement() {
  return { innerHTML: '', textContent: '', className: '', value: '', style: {}, dataset: {},
           classList: { contains: () => false } };
}

function makePage(opts) {
  opts = opts || {};
  const backing = { cestis_active_quarter: JSON.stringify(opts.shared || { fy: LAST, q: 2 }) };
  const writes = [];
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { writes.push(k); backing[k] = String(v); }
  };
  global.CESTISStore = store; // cestis-core.js reads the store from Node's global
  const els = {};
  const sandbox = {
    students: opts.students || clone(ROLL),
    payments: [],
    feeScopeMode: opts.mode || 'year',
    _feeSuppressQuarterSub: false,
    selectedForMerge: [],
    FEE_CACHE_TTL_MS: 750, _feeCacheStamp: 0, _feeQuarterCache: null,
    CESTISCore: Core, CESTISStore: store,
    document: { getElementById: id => (els[id] = els[id] || fakeElement()) },
    // Stand-ins for the parts of the page these rules do not depend on.
    _ensureFeeQFilterStyles() {}, updateMergeControls() {}, refreshLmsStudentCache() {},
    _feeDeferRender() { return false; }, renderStageBadge() { return ''; }, feeEndedBadge() { return ''; },
    _feeFilterSet() { return false; }, filterStudents() {}, _feeModuleActive() { return false; },
    feeIsSettled: s => (parseFloat(s.balance) || 0) <= 0 && (parseFloat(s.tuitionFee) || 0) > 0,
    feeAttr: v => String(v == null ? '' : v).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c])),
    feeStripTags: h => String(h == null ? '' : h).replace(/<[^>]*>/g, ' '),
    getStatusClass: () => 'x',
    applied: 0,
    console: { log() {}, warn() {}, error() {} },
    Date, Object, Array, String, Map, JSON, Math, parseFloat, parseInt, isNaN
  };
  sandbox.window = sandbox;
  sandbox.feeApplyQuarterChange = function () { sandbox.applied++; sandbox.feeInvalidateCaches(); };
  vm.createContext(sandbox);
  vm.runInContext([
    'feeInvalidateCaches', '_feeCacheTick', 'feeActiveQuarter', '_feeSetView', 'feeCurrentFY',
    'feeYearTense', 'studentInActiveFY', 'studentsInScope', 'feeFYLabel', 'feeScopeLabel',
    'renderFeeYearBar', 'renderStudentsTable', 'feeHiddenMatchHint', 'feeReportStudents',
    'feeRevealRecordYear', 'feeReturnToPresent', 'feeShiftFY'
  ].map(extractFunction).join('\n\n'), sandbox);
  sandbox._feeViewFY = vm.runInContext(extractViewYearInit(), sandbox);
  sandbox._els = els;
  sandbox._backing = backing;
  sandbox._writes = writes;
  return sandbox;
}

function listedIds(page) {
  page.renderStudentsTable();
  const html = page._els.studentsTableBody.innerHTML;
  return (html.match(/<td>([A-Z]\d)<\/td>/g) || []).map(m => m.slice(4, 6));
}

function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');

  /* ---------- 1. Opens on the present year ---------- */
  console.log('The page opens on the year today falls in, whatever year was last remembered');
  let page = makePage({ shared: { fy: EARLIER, q: 3 } });
  assertEq(page._feeViewFY, PRESENT, 'its own year starts as the present one');
  assertEq(page.feeActiveQuarter().fy, PRESENT, 'so the remembered FY ' + EARLIER + ' is not what it shows');
  assertEq(page.feeActiveQuarter().q, Core.currentQuarter().q, 'and it sits in today\'s quarter');
  assertEq(page._writes.length, 0, 'opening it writes nothing to the shared key, so no other page is moved');
  assertEq(JSON.parse(page._backing.cestis_active_quarter).fy, EARLIER, 'the Cashbook\'s remembered year is left as it was');

  /* ---------- 2. The Students list is one year's group ---------- */
  console.log('\nThe Students list shows the present group only');
  page = makePage();
  let ids = listedIds(page);
  assertEq(ids.join(','), 'P1,P2', 'only this year\'s trainees are listed — not last year\'s, not earlier');
  const bar = page._els.studentsYearBar.innerHTML;
  assert(bar.indexOf('FY ' + PRESENT) >= 0, 'the banner names the year: FY ' + PRESENT);
  assert(/fee-yb-tag present/.test(bar), 'and flags it as the present year');
  assert(/showing <strong>2<\/strong> of 5 trainees on the roll/.test(bar), 'it says how much of the roll that is');
  assert(/3 from other years not listed/.test(bar), 'and how many are in other years');
  assert(/Show all years/.test(bar), 'with the way to every year');

  console.log('Rows keep their place in the roll, which View/Edit/Delete address them by');
  const html = page._els.studentsTableBody.innerHTML;
  assert(/viewStudent\(0\)/.test(html) && /viewStudent\(1\)/.test(html), 'the present trainees keep indexes 0 and 1');
  assert(!/viewStudent\(2\)/.test(html), 'and a hidden trainee is not reachable from the list');

  console.log('Stepping back a year shows last year\'s group, flagged as past');
  page.feeShiftFY(-1);
  ids = listedIds(page);
  assertEq(ids.join(','), 'L1,L2', 'last year\'s trainees, and only them');
  assert(/fee-yb-tag past/.test(page._els.studentsYearBar.innerHTML), 'the banner says it is a past year');
  assert(/Back to FY /.test(page._els.studentsYearBar.innerHTML), 'and offers the way back');
  assertEq(JSON.parse(page._backing.cestis_active_quarter).fy, LAST, 'a deliberate step is shared, so the Cashbook follows');

  console.log('"Back to" the present returns to it in one step');
  page.feeReturnToPresent();
  assertEq(listedIds(page).join(','), 'P1,P2', 'the present group again');
  assertEq(page.feeScopeMode, 'year', 'on the whole year');

  console.log('"Show all years" lists everybody, and says past groups are mixed in');
  page.feeScopeMode = 'all'; page.feeInvalidateCaches();
  assertEq(listedIds(page).length, 5, 'the whole roll');
  assert(/All years/.test(page._els.studentsYearBar.innerHTML) && /past groups are mixed in/.test(page._els.studentsYearBar.innerHTML),
    'and the banner says so');

  console.log('A year with nobody in it says where everyone is');
  page = makePage();
  page.feeShiftFY(1);
  assertEq(page.feeActiveQuarter().fy, NEXT, 'stepped ahead to FY ' + NEXT);
  listedIds(page);
  assert(/No trainees enrolled in FY /.test(page._els.studentsTableBody.innerHTML), 'the table says nobody is enrolled that year');
  assert(/5 trainees are on the roll in other years/.test(page._els.studentsTableBody.innerHTML), 'and that the roll is elsewhere');
  assert(/fee-yb-tag future/.test(page._els.studentsYearBar.innerHTML), 'a year ahead is not called "past"');

  /* ---------- 3. A search finds people the year is hiding ---------- */
  console.log('\nA search that matches trainees in other years says where they are');
  page = makePage();
  listedIds(page);
  page.feeHiddenMatchHint('smith', '', '');
  const hint = page._els.studentsYearBarHint.innerHTML;
  assert(/2 more trainees matching/.test(hint), 'both Smiths are found, though neither is this year\'s');
  assert(hint.indexOf('FY ' + LAST) >= 0 && hint.indexOf('FY ' + EARLIER) >= 0, 'with the years they are in');
  page.feeHiddenMatchHint('present', '', '');
  assertEq(page._els.studentsYearBarHint.innerHTML, '', 'nothing is said when every match is already listed');
  page.feeScopeMode = 'all';
  page.feeHiddenMatchHint('smith', '', '');
  assertEq(page._els.studentsYearBarHint.innerHTML, '', 'or when every year is already shown');

  /* ---------- 4. Reports count the same group ---------- */
  console.log('\nThe Reports tab counts the same group as the list');
  page = makePage();
  assertEq(page.feeReportStudents().map(s => s.id).join(','), 'P1,P2', 'the present group, not the roll');
  ['generateReport', 'exportReportToPDF', 'printProfessionalReport'].forEach(fn => {
    const body = extractFunction(fn);
    assert(body.indexOf('[...students]') < 0 && !/(^|[^\w.])students\.filter\(/.test(body),
      fn + '() no longer lists the whole roll');
    assert(/feeReportStudents\(\)/.test(body), fn + '() reads the year\'s group');
  });
  const stats = extractFunction('updateReportsStats');
  assert(/const group = feeReportStudents\(\);/.test(stats) && !/students\.length/.test(stats),
    'the Reports cards count the year\'s group');
  assert(/feeReportStudents\(\)/.test(extractFunction('exportToExcel')), 'and the Reports export is that group too');
  assert(/isTraineeReport[\s\S]*feeFYLabel\(\)/.test(extractFunction('getReportFilterPeriod')),
    'a trainee report is labelled with its group, not a month it was never filtered by');

  /* ---------- 5. A saved record follows its own year ---------- */
  console.log('\nA trainee saved into another year moves the page there, and says so');
  page = makePage();
  let note = page.feeRevealRecordYear(dayIn(LAST, '11-20'), 'trainee’s enrolment');
  assertEq(page.feeActiveQuarter().fy, LAST, 'the page is now on FY ' + LAST);
  assert(page.applied === 1, 'and everything was redrawn for it');
  assert(note.indexOf('falls in FY ' + LAST) >= 0 && note.indexOf('was showing FY ' + PRESENT) >= 0,
    'the message says which year it went to and which it came from');
  assert(/Back to FY /.test(note), 'and how to get back to the present group');

  console.log('A record already in view changes nothing');
  page = makePage();
  assertEq(page.feeRevealRecordYear(dayIn(PRESENT, '08-01'), 'payment', true), '', 'a present-year record: no move');
  assertEq(page.feeRevealRecordYear('', 'trainee’s enrolment'), '', 'an undated one: no move');
  assertEq(page.applied, 0, 'and nothing is redrawn');
  page.feeScopeMode = 'all';
  assertEq(page.feeRevealRecordYear(dayIn(LAST, '08-01'), 'payment', true), '', 'every year on screen: no move');

  console.log('A payment outside the selected quarter moves to its quarter');
  page = makePage();
  page.feeScopeMode = 'quarter';
  page._feeSetView(PRESENT, 1);
  note = page.feeRevealRecordYear(dayIn(PRESENT, '11-03'), 'payment', true);
  assertEq(page.feeActiveQuarter().q, 3, 'a November payment lands the view on Q3');
  assert(note.length > 0, 'and says so');
  // A trainee is a whole-year group, so another quarter of the same year is in view.
  page._feeSetView(PRESENT, 1);
  assertEq(page.feeRevealRecordYear(dayIn(PRESENT, '11-03'), 'trainee’s enrolment'), '',
    'a trainee enrolled in another quarter of the same year is already listed');
}

PAGES.forEach(runFor);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
