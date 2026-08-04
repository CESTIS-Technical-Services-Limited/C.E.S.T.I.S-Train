/* What the School Fee dashboard's four cards count.

   Reported: "School Fee is showing one record and the VocTrain dashboard showing
   something else — there is more data missing and not loading." The fee page read
   116 students where the LMS dashboard read 220, and stepping the financial-year
   arrows back showed 7, then 39, then 32. Never the 220 actually enrolled.

   Two faults, in the same four cards:

     1. "All Quarters" meant the four quarters of ONE financial year. The
        Centre's roll spans five, so no selection could ever show it whole.
     2. The cards were scoped two different ways at once — Students, Expected and
        Outstanding by the trainee's ENROLMENT year, Collected by the PAYMENT
        date. So Collected included receipts from trainees Expected had left out,
        and on the Centre's own data Expected − Outstanding came out $29,000
        short of Collected. Three headline figures that could not be reconciled.

   Now: "All Quarters" is the whole roll, every year — the view that matches the
   LMS dashboard, where Expected − Outstanding is exactly Collected. Toggling it
   off drills into the financial year the arrows select. Every card says which.

   Run: node tests/school-fee-dashboard-scope.test.js */
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

/* Both builds are checked. The online page and the offline bundle's copy of it
   are separate files that drift, and the offline build is what the Centre runs
   on site — a fix that reached only one of them would leave the Centre looking
   at the wrong headcount on the very build it uses when the internet is down.
   Pass a path to check just one. */
let PAGE = '';
const PAGES = process.argv[2]
  ? [process.argv[2]]
  : [path.join(__dirname, '..', 'School.Fee.html'),
     path.join(__dirname, '..', 'Offline System', 'School.Fee.html')];
let SRC = '';

/* Lift a named function out of the page and run it for real, so these are the
   page's own answers and not a paraphrase that can drift away from it. */
function extractFunction(name, optional) {
  const at = SRC.indexOf('\n        function ' + name + '(');
  if (at < 0) {
    if (optional) return '';
    throw new Error(PAGE + ' no longer defines ' + name);
  }
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

// What every build must define — the rules these tests are about.
const NAMES = ['feeNameKey', 'feeKeyFor', 'feePaymentStatus', 'feeIsUnpriced', 'feeIsSettled',
  'recalculateStudentTotals', 'paymentInActiveQuarter', 'studentInActiveFY',
  'paymentsInScope', 'studentsInScope', 'feeFYLabel', 'feeScopeLabel'];

// The render-performance layer, which the offline bundle is older than. Its
// absence changes no answer — those functions only cache what CESTISCore would
// be asked for anyway — so it is taken when present and stubbed when not.
const OPTIONAL = ['feeInvalidateCaches', '_feeCacheTick', 'feeActiveQuarter'];

function makePage(opts) {
  opts = opts || {};
  const backing = { cestis_active_quarter: JSON.stringify(opts.quarter || { fy: '2025/2026', q: 4 }) };
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); }
  };
  const sandbox = {
    students: opts.students || [],
    payments: opts.payments || [],
    feeShowAllPayments: opts.showAll !== false,
    feeStructure: opts.feeStructure || { 'WELDING L2': { total: 28000 } },
    FEE_CACHE_TTL_MS: 750, _feeCacheStamp: 0, _feeQuarterCache: null,
    CESTISCore: Core, CESTISStore: store,
    console: { log() {}, warn() {} },
    Date, Object, Array, String, Map, JSON, parseFloat, isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(n => extractFunction(n))
    .concat(OPTIONAL.map(n => extractFunction(n, true)))
    .filter(Boolean).join('\n\n'), sandbox);
  // Stand in for whatever the page does not carry, so both builds are asked the
  // same questions.
  if (typeof sandbox.feeInvalidateCaches !== 'function') sandbox.feeInvalidateCaches = function () {};
  // cestis-core.js captured the global object when it was required, so its
  // getActiveQuarter() looks for the store THERE, not in this sandbox.
  global.CESTISStore = store;
  sandbox._setQuarter = q => { backing.cestis_active_quarter = JSON.stringify(q); sandbox.feeInvalidateCaches(); };
  return sandbox;
}

/* The Centre's roll in miniature: trainees enrolled across four financial years,
   plus the undated records the real data carries 36 of. */
const ROLL = [
  { id: 'A', name: 'A One', skillArea: 'WELDING L2', tuitionFee: 28000, enrollmentDate: '2023-05-02' },
  { id: 'B', name: 'B Two', skillArea: 'WELDING L2', tuitionFee: 28000, enrollmentDate: '2024-09-15' },
  { id: 'C', name: 'C Three', skillArea: 'WELDING L2', tuitionFee: 28000, enrollmentDate: '2025-06-01' },
  { id: 'D', name: 'D Four', skillArea: 'WELDING L2', tuitionFee: 28000, enrollmentDate: '2026-01-20' },
  { id: 'E', name: 'E Five', skillArea: 'WELDING L2', tuitionFee: 28000, enrollmentDate: '' }
];
// One payment per trainee, dated in its own financial year.
const PAID = [
  { id: 'P1', studentId: 'A', amount: 5000, skillArea: 'WELDING L2', date: '2023-05-10' },
  { id: 'P2', studentId: 'B', amount: 6000, skillArea: 'WELDING L2', date: '2024-10-01' },
  { id: 'P3', studentId: 'C', amount: 7000, skillArea: 'WELDING L2', date: '2025-07-04' },
  { id: 'P4', studentId: 'D', amount: 8000, skillArea: 'WELDING L2', date: '2026-02-11' },
  { id: 'P5', studentId: 'E', amount: 9000, skillArea: 'WELDING L2', date: '2025-12-12' }
];
const clone = a => a.map(x => Object.assign({}, x));

function cards(page) {
  page.feeInvalidateCaches();
  const st = page.studentsInScope(), pay = page.paymentsInScope();
  return {
    students: st.length,
    expected: st.reduce((t, s) => t + (parseFloat(s.tuitionFee) || 0), 0),
    collected: pay.reduce((t, p) => t + (parseFloat(p.amount) || 0), 0),
    outstanding: st.reduce((t, s) => t + (parseFloat(s.balance) || 0), 0)
  };
}

function runFor(pageFile) {
  SRC = fs.readFileSync(pageFile, 'utf8');
  PAGE = path.relative(path.join(__dirname, '..'), pageFile);
  console.log('\n=== ' + PAGE + ' ===');
  /* ---------- 1. All Quarters is everybody ---------- */
  console.log('With "All Quarters" on, the cards count the whole roll');

  let page = makePage({ students: clone(ROLL), payments: clone(PAID), showAll: true });
  page.recalculateStudentTotals();
  let c = cards(page);
  assertEq(c.students, 5, 'every trainee on the roll, whatever year they enrolled');
  assertEq(c.expected, 140000, 'and every tuition');
  assertEq(c.collected, 35000, 'and every payment, of every year');

  console.log('And the three money figures reconcile, which they could not before');
  assertEq(c.expected - c.outstanding, c.collected,
    'expected minus outstanding IS what has been collected');

  console.log('The label says so, rather than naming a year it is not scoped to');
  assertEq(page.feeFYLabel(), 'All trainees on the roll', 'the student cards');
  assertEq(page.feeScopeLabel(), 'All quarters · every year', 'and the collected card');

  console.log('Stepping the financial year does not change a whole-roll figure');
  page._setQuarter({ fy: '2023/2024', q: 1 });
  assertEq(cards(page).students, 5, 'the arrows have nothing to narrow while it is on');

  /* ---------- 2. Toggled off, it drills into one year ---------- */
  console.log('\nWith "All Quarters" off, the cards follow the selected FY and quarter');

  page = makePage({ students: clone(ROLL), payments: clone(PAID), showAll: false,
    quarter: { fy: '2025/2026', q: 2 } });
  page.recalculateStudentTotals();
  c = cards(page);
  // C enrolled Jun 2025 and D Jan 2026, both in FY 2025/2026; the undated E stays
  // visible in every year so nobody is silently hidden. The cohort follows the
  // YEAR, so picking a quarter within it does not drop either of them.
  assertEq(c.students, 3, 'that year\'s cohort, plus the undated record');
  // Of that year's receipts only P3 (Jul 2025) falls in Q2 — P4 is Feb 2026 (Q4)
  // and P5 Dec 2025 (Q3).
  assertEq(c.collected, 7000, 'and only the payments in the selected quarter');
  assertEq(page.feeFYLabel(), 'FY 2025/2026 cohort', 'and the label names the cohort');

  console.log('A different year is a different cohort');
  page._setQuarter({ fy: '2023/2024', q: 1 });
  c = cards(page);
  assertEq(c.students, 2, 'the 2023/2024 trainee, plus the undated one');
  assertEq(c.collected, 5000, 'and that quarter\'s receipts');

  console.log('An undated trainee is never hidden from any year');
  [['2023/2024', 1], ['2024/2025', 2], ['2025/2026', 1], ['2026/2027', 1]].forEach(function (p) {
    page._setQuarter({ fy: p[0], q: p[1] });
    assert(page.studentsInScope().some(s => s.id === 'E'),
      'the undated record is counted in FY ' + p[0] + ' too');
  });

  console.log('Every year\'s cohort added up is at least the whole roll — nobody vanishes');
  const seen = new Set();
  ['2023/2024', '2024/2025', '2025/2026', '2026/2027'].forEach(function (fy) {
    page._setQuarter({ fy: fy, q: 1 });
    page.studentsInScope().forEach(s => seen.add(s.id));
  });
  assertEq(seen.size, ROLL.length, 'every trainee is reachable through some year');

  /* ---------- 3. The toggle itself ---------- */
  console.log('\nThe toggle is a real toggle, both ways');

  page = makePage({ students: clone(ROLL), payments: clone(PAID), showAll: true });
  page.recalculateStudentTotals();
  assertEq(cards(page).students, 5, 'on: the whole roll');
  page.feeShowAllPayments = false;                       // what feeSelectAll() flips
  assertEq(cards(page).students, 3, 'off: back to the selected year');
  page.feeShowAllPayments = true;
  assertEq(cards(page).students, 5, 'and on again');

  // The page's own handler must be the flip, not a one-way set — before this the
  // only way off "All Quarters" was to pick a quarter.
  assert(/function feeSelectAll\(\)\s*\{\s*[\s\S]{0,200}feeShowAllPayments\s*=\s*!feeShowAllPayments/.test(SRC),
    'feeSelectAll() flips the setting rather than forcing it on');

  /* ---------- 4. A trainee with no fee is not "Fully Paid" ---------- */
  console.log('\nA trainee nobody has priced is not counted as settled');

  // 27 of the Centre's records stood exactly like this: on a programme the Fee
  // Structure does not price, so tuition 0, balance 0, and therefore "Fully Paid"
  // while owing their whole tuition — invisible in every collection figure.
  page = makePage({
    students: [
      { id: 'U', name: 'Unpriced One', skillArea: 'Photovoltaic Installer', tuitionFee: 0 },
      { id: 'S', name: 'Settled One', skillArea: 'WELDING L2', tuitionFee: 28000 },
      { id: 'O', name: 'Owing One', skillArea: 'WELDING L2', tuitionFee: 28000 }
    ],
    payments: [{ id: 'P', studentId: 'S', amount: 28000, skillArea: 'WELDING L2', date: '2025-06-01' }]
  });
  page.recalculateStudentTotals();
  const byId = {};
  page.students.forEach(s => { byId[s.id] = s; });
  assertEq(byId.U.status, 'Not Priced', 'no fee set, nothing paid — say that');
  assertEq(byId.S.status, 'Fully Paid', 'priced and paid off is settled');
  assertEq(byId.O.status, 'Outstanding', 'priced and unpaid still owes');
  assertEq(page.feeIsSettled(byId.U), false, 'so the unpriced record is not swept into "Fully Paid"');
  assertEq(page.feeIsSettled(byId.S), true, 'while a genuinely settled one is');
  assertEq(page.feeIsUnpriced(byId.U), true, 'and it can be counted and reported');

  console.log('Money already recorded is never disowned as "unpriced"');
  page = makePage({
    students: [{ id: 'X', name: 'Paid Something', skillArea: 'Photovoltaic Installer', tuitionFee: 0 }],
    payments: [{ id: 'P', studentId: 'X', amount: 5000, skillArea: 'Photovoltaic Installer', date: '2025-06-01' }]
  });
  page.recalculateStudentTotals();
  assertEq(page.students[0].status, 'Fully Paid',
    'a record carrying payments is judged on its money, whatever its tuition reads');

  console.log('The unpriced programmes are the ones the Fee Structure cannot price');
  page = makePage({ feeStructure: { 'WELDING L2': { total: 28000 }, 'COSMETOLOGY L2': { total: 38000 } } });
  assertEq(page.feeKeyFor('Photovoltaic Installer'), null, 'a programme with no price');
  assertEq(page.feeKeyFor('WELDING L2'), 'WELDING L2', 'one with a price');
  assert(page.feeKeyFor('welding  l2') === 'WELDING L2', 'found however it is spelled');

}

PAGES.forEach(runFor);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
