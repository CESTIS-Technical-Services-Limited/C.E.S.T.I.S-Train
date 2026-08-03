/* The School Fee dashboard was slow because of three things it did over and
   over on every refresh — and a refresh happens after almost every action:

     1. paymentInActiveQuarter() asked the STORE for the active financial
        quarter once per payment. CESTISStore.getItem() reads through to
        localStorage every time (it has to: another tab or an embedded page may
        have written since), so scoping 3,000 payments meant 3,000 storage reads
        and 3,000 JSON.parses — and the dashboard scoped the list four times.

     2. recalculateStudentTotals() re-scanned the WHOLE payment list once for
        every trainee on the roll: students × payments.

     3. getStudentStage() scanned the whole LMS student list once per row to
        fill the stage column, lower-casing and re-spacing both names each time:
        students × LMS records.

   These tests pin the fix twice over: the rewritten functions must give exactly
   the same answers as the versions they replaced, and they must stop going back
   to the store for an answer they already have. The second half is the point —
   without it the first half is just as slow as before.

   Run: node tests/school-fee-perf.test.js */
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

/* ---------- Pull the rewritten functions out of the page ---------- */

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'School.Fee.html'), 'utf8');

function extractFunction(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('School.Fee.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const NAMES = ['feeInvalidateCaches', '_feeCacheTick', 'feeActiveQuarter', 'refreshLmsStudentCache',
               'feeLmsIndex', 'getStudentStage', 'paymentInActiveQuarter', 'recalculateStudentTotals'];

/* A page-like world. The store counts its reads, which is the whole point. */
function makePage(opts) {
  opts = opts || {};
  const backing = Object.assign({
    cestis_active_quarter: JSON.stringify({ fy: '2026/2027', q: 2 }),
    voctrain_students: JSON.stringify(opts.lmsStudents || [])
  }, opts.store || {});

  const store = {
    reads: 0,
    getItem: function (k) {
      store.reads++;
      return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null;
    },
    setItem: function (k, v) { backing[k] = String(v); }
  };

  const sandbox = {
    students: opts.students || [],
    payments: opts.payments || [],
    documents: [],
    feeShowAllPayments: opts.showAll !== false,
    lmsStudentCache: [],
    FEE_CACHE_TTL_MS: 750,
    _feeCacheStamp: 0,
    _feeQuarterCache: null,
    _feeCentresCache: null,
    _feeDurationCache: null,
    _feeLmsIndex: null,
    CESTISCore: Core,
    CESTISStore: store,
    console: { log: function () {}, warn: function () {} },
    Date: Date, Object: Object, Array: Array, String: String, Map: Map,
    JSON: JSON, parseFloat: parseFloat, isNaN: isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(extractFunction).join('\n\n'), sandbox);
  sandbox._store = store;
  // cestis-core.js captured the global object when it was required, so
  // CESTISCore.getActiveQuarter() looks for the store THERE, not in the vm
  // sandbox. Without this the reads below are never counted and every
  // measurement in this file is vacuous — and the active quarter silently
  // falls back to whatever quarter today happens to be in.
  global.CESTISStore = store;
  return sandbox;
}

/* ---------- The implementations these replaced, kept verbatim ---------- */

function oldRecalculateStudentTotals(students, payments) {
  students.forEach(student => {
    const studentPayments = payments.filter(p => p.studentId === student.id);
    const totalPaid = studentPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    student.tuitionFee = parseFloat(student.tuitionFee) || 0;
    student.totalPaid = totalPaid;
    student.balance = student.tuitionFee - student.totalPaid;
    if (student.balance <= 0) student.status = 'Fully Paid';
    else if (student.totalPaid > 0) student.status = 'Partial Payment';
    else student.status = 'Outstanding';
  });
}

function oldGetStudentStage(student, lmsStudentCache) {
  if (!student) return null;
  const norm = v => (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');
  const linkId = 'SF-' + student.id;
  const m = lmsStudentCache.find(ls => ls && (
    (student.lmsId && ls.id === student.lmsId) ||
    ls.id === student.id ||
    ls.id === linkId ||
    ls.schoolFeeId === student.id ||
    (norm(ls.name) === norm(student.name) &&
      (!ls.course || !student.skillArea || norm(ls.course) === norm(student.skillArea)))
  ));
  return m ? { stage: m.stage || 'testing', progress: (m.progress != null ? m.progress : '') } : null;
}

/* ---------- A roll big enough for the difference to be the point ---------- */

const COURSES = ['Welding & Fabrication', 'Electrical Installation', 'Cosmetology',
                 'Plumbing', 'Welding and Fabrication Level 2'];
const N_STUDENTS = 300;
const N_PAYMENTS = 3000;

function buildStudents() {
  const out = [];
  for (let i = 0; i < N_STUDENTS; i++) {
    out.push({
      id: 'STU' + i,
      name: 'Trainee ' + i,
      skillArea: COURSES[i % COURSES.length],
      tuitionFee: 28000,
      totalPaid: 0,
      balance: 0,
      status: 'Outstanding',
      enrollmentDate: '2026-05-0' + ((i % 9) + 1)
    });
  }
  return out;
}

function buildPayments() {
  const out = [];
  // Spread across two financial years so the quarter scope actually excludes some.
  const dates = ['2026-05-12', '2026-08-20', '2026-11-03', '2027-02-14', '2025-06-01'];
  for (let i = 0; i < N_PAYMENTS; i++) {
    out.push({
      id: 'PAY' + i,
      studentId: 'STU' + (i % N_STUDENTS),
      studentName: 'Trainee ' + (i % N_STUDENTS),
      skillArea: COURSES[i % COURSES.length],
      amount: 500 + (i % 7) * 100,
      date: dates[i % dates.length],
      method: 'Cash',
      term: 'Term 1'
    });
  }
  return out;
}

function buildLmsStudents() {
  const out = [];
  for (let i = 0; i < N_STUDENTS; i++) {
    // A mix of every link the lookup has to honour: the explicit back-reference,
    // the 'SF-' form of the fee id, and plain name+programme agreement.
    if (i % 3 === 0)      out.push({ id: 'LMS' + i, name: 'Trainee ' + i, course: COURSES[i % COURSES.length], schoolFeeId: 'STU' + i, stage: 'training', progress: 40 });
    else if (i % 3 === 1) out.push({ id: 'SF-STU' + i, name: 'Trainee ' + i, course: COURSES[i % COURSES.length], stage: 'certified', progress: 100 });
    else                  out.push({ id: 'LMSX' + i, name: 'Trainee ' + i, course: COURSES[i % COURSES.length], stage: 'testing', progress: 5 });
  }
  return out;
}

const LMS = buildLmsStudents();

/* ---------- 1. Totals: same answers, without the nested scan ---------- */
console.log('Totalling what each trainee has paid gives the same answer as before');

let page = makePage({ students: buildStudents(), payments: buildPayments() });
page.recalculateStudentTotals();

const expectedStudents = buildStudents();
oldRecalculateStudentTotals(expectedStudents, buildPayments());

let sameTotals = true, sameStatus = true, sameBalance = true;
for (let i = 0; i < N_STUDENTS; i++) {
  if (page.students[i].totalPaid !== expectedStudents[i].totalPaid) sameTotals = false;
  if (page.students[i].balance !== expectedStudents[i].balance) sameBalance = false;
  if (page.students[i].status !== expectedStudents[i].status) sameStatus = false;
}
assert(sameTotals, 'every trainee is credited with exactly what they paid');
assert(sameBalance, 'and left with the same balance');
assert(sameStatus, 'and the same payment status');
assert(page.students[0].totalPaid > 0, 'the fixture actually records payments (the test is not vacuous)');

console.log('A trainee with no payments is still zeroed, not skipped');
page = makePage({
  students: [{ id: 'A', name: 'A', skillArea: 'Plumbing', tuitionFee: 1000, totalPaid: 999, balance: 1, status: 'Partial Payment' }],
  payments: []
});
page.recalculateStudentTotals();
assertEq(page.students[0].totalPaid, 0, 'the stale total is cleared');
assertEq(page.students[0].balance, 1000, 'the balance is the full fee again');
assertEq(page.students[0].status, 'Outstanding', 'and the status follows');

console.log('A payment against a trainee who is gone does not upset the others');
page = makePage({
  students: [{ id: 'A', name: 'A', skillArea: 'Plumbing', tuitionFee: 1000 }],
  payments: [{ id: 'p1', studentId: 'A', amount: 400 }, { id: 'p2', studentId: 'GONE', amount: 999 }]
});
page.recalculateStudentTotals();
assertEq(page.students[0].totalPaid, 400, 'only their own payments are counted');

console.log('Amounts stored as text still add up');
page = makePage({
  students: [{ id: 'A', name: 'A', skillArea: 'Plumbing', tuitionFee: 1000 }],
  payments: [{ id: 'p1', studentId: 'A', amount: '250.50' }, { id: 'p2', studentId: 'A', amount: null }]
});
page.recalculateStudentTotals();
assertEq(page.students[0].totalPaid, 250.5, 'a numeric string counts, an empty amount counts as nothing');

/* ---------- 2. The stage column: same answers, from an index ---------- */
console.log('The academic stage column resolves to the same LMS record as before');

page = makePage({ students: buildStudents(), lmsStudents: LMS });
page.refreshLmsStudentCache();

let sameStage = true, resolved = 0;
for (let i = 0; i < N_STUDENTS; i++) {
  const got = page.getStudentStage(page.students[i]);
  const want = oldGetStudentStage(page.students[i], LMS);
  if (JSON.stringify(got) !== JSON.stringify(want)) sameStage = false;
  if (got) resolved++;
}
assert(sameStage, 'every trainee resolves to the same stage and progress');
assertEq(resolved, N_STUDENTS, 'and all of them resolve (the fixture exercises every link)');

console.log('A trainee with no LMS record still reads as no stage');
assertEq(page.getStudentStage({ id: 'NOBODY', name: 'Nobody At All', skillArea: 'Plumbing' }), null,
  'no match means no badge, not a wrong one');
assertEq(page.getStudentStage(null), null, 'and no trainee at all is not a crash');

console.log('A name shared by two trainees picks the one on the same programme');
page = makePage({
  students: [{ id: 'S1', name: 'Ann Brown', skillArea: 'Plumbing' }],
  lmsStudents: [
    { id: 'L1', name: 'Ann Brown', course: 'Cosmetology', stage: 'certified' },
    { id: 'L2', name: 'Ann Brown', course: 'Plumbing', stage: 'training' }
  ]
});
page.refreshLmsStudentCache();
assertEq(page.getStudentStage(page.students[0]).stage, 'training',
  'the programme decides between two people of the same name');

console.log('An explicit link beats a name match');
page = makePage({
  students: [{ id: 'S1', name: 'Ann Brown', skillArea: 'Plumbing', lmsId: 'L9' }],
  lmsStudents: [
    { id: 'L1', name: 'Ann Brown', course: 'Plumbing', stage: 'testing' },
    { id: 'L9', name: 'Someone Else', course: 'Plumbing', stage: 'collected' }
  ]
});
page.refreshLmsStudentCache();
assertEq(page.getStudentStage(page.students[0]).stage, 'collected',
  'the recorded lmsId is followed even when another record shares the name');

/* ---------- 3. Quarter scoping: same answers, without the storage storm ---------- */
console.log('Scoping payments to the active quarter selects exactly the same payments');

const ALL_PAYMENTS = buildPayments();
page = makePage({ payments: ALL_PAYMENTS, showAll: true });
const scopedAll = ALL_PAYMENTS.filter(p => page.paymentInActiveQuarter(p));

// What the rule says, worked out independently of the page.
const wantAll = ALL_PAYMENTS.filter(p => {
  const dq = Core.deriveQuarter(p.date);
  return !dq || dq.fy === '2026/2027';
});
assertEq(scopedAll.length, wantAll.length, '"All quarters" is the whole active financial year');
assert(scopedAll.length > 0 && scopedAll.length < ALL_PAYMENTS.length,
  'and it genuinely excludes the other year (the test is not vacuous)');

page = makePage({ payments: ALL_PAYMENTS, showAll: false });
const scopedQ = ALL_PAYMENTS.filter(p => page.paymentInActiveQuarter(p));
const wantQ = ALL_PAYMENTS.filter(p => {
  const dq = Core.deriveQuarter(p.date);
  return !dq || (dq.fy === '2026/2027' && dq.q === 2);
});
assertEq(scopedQ.length, wantQ.length, 'a selected quarter narrows to that quarter of the year');
assert(scopedQ.length < scopedAll.length, 'which is fewer payments than the whole year');

console.log('An undated payment is never silently hidden');
page = makePage({ payments: [], showAll: false });
assertEq(page.paymentInActiveQuarter({ id: 'x', date: '' }), true, 'no date means it stays visible');
assertEq(page.paymentInActiveQuarter({ id: 'x', date: 'not a date' }), true, 'and so does an unreadable one');

/* ---------- 4. The point: it stops going back to the store ---------- */
console.log('Scoping the whole payment list reads the active quarter once, not once per payment');

page = makePage({ payments: ALL_PAYMENTS, showAll: true });

// What the old form cost, measured the same way: it asked CESTISCore for the
// active quarter on every single call, and CESTISCore reads through to storage.
page._store.reads = 0;
ALL_PAYMENTS.forEach(p => {
  const dq = Core.deriveQuarter(p.date);
  if (!dq) return;
  const cur = Core.getActiveQuarter();          // <- once per payment, as before
  return dq.fy === cur.fy;
});
const readsBefore = page._store.reads;

page._store.reads = 0;
ALL_PAYMENTS.forEach(p => page.paymentInActiveQuarter(p));
const readsAfter = page._store.reads;

assert(readsBefore > N_PAYMENTS / 2,
  'the old form really did read the store per payment (' + readsBefore + ' reads) — ' +
  'otherwise this comparison proves nothing');
assert(readsAfter <= 2, 'at most a couple of storage reads for ' + N_PAYMENTS +
  ' payments, not one each — got ' + readsAfter);
assert(readsAfter * 100 < readsBefore,
  'at least a hundredfold fewer storage reads (' + readsAfter + ' vs ' + readsBefore + ')');
console.log('  · scoping ' + N_PAYMENTS + ' payments: ' + readsBefore + ' storage reads before, ' +
  readsAfter + ' after — and the dashboard does this four times per refresh');

console.log('The cached quarter is dropped as soon as the quarter changes');
page.feeInvalidateCaches();
page._store.reads = 0;
page.paymentInActiveQuarter(ALL_PAYMENTS[0]);
assert(page._store.reads >= 1, 'the next question after an invalidation goes back to the store');

console.log('Filling the stage column reads the LMS list once, not once per row');
page = makePage({ students: buildStudents(), lmsStudents: LMS });
page.refreshLmsStudentCache();
page._store.reads = 0;
page.students.forEach(s => page.getStudentStage(s));
assertEq(page._store.reads, 0, 'every row is answered from the index already built');

// And the work itself, counted: the scan compared each trainee against the LMS
// list until it found a match; the index answers each one in constant time.
let comparisons = 0;
page.students.forEach(s => { LMS.some(ls => { comparisons++; return ls.schoolFeeId === s.id || ls.id === 'SF-' + s.id; }); });
assert(comparisons > N_STUDENTS * 10,
  'the old scan really was students × LMS records (' + comparisons + ' comparisons for ' +
  N_STUDENTS + ' rows) — otherwise this comparison proves nothing');
console.log('  · filling the stage column for ' + N_STUDENTS + ' rows against ' + LMS.length +
  ' LMS records: ~' + comparisons + ' comparisons before, ' + N_STUDENTS + ' index lookups after');

console.log('A change to the LMS list is picked up on the next refresh');
page.refreshLmsStudentCache();
assertEq(page._feeLmsIndex, null, 're-reading the list drops the index built from it');
assert(page.getStudentStage(page.students[0]) !== null, 'and the next lookup rebuilds it');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
