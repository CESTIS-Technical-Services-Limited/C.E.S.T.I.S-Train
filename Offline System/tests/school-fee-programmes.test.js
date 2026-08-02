/* Unit tests for the School Fee dashboard's programme list.

   Programmes are set up on the School Fee page itself, under Fee Structure →
   Set Programme Cost: the Centre chooses the programme there (a VocTrain
   training centre, or a name of its own) and prices it, and that list is what
   the Add Student form offers. These tests pin the three things that were
   going wrong:

     - the same programme written two ways ("WELDING L2" / "Welding l2") became
       two entries, so the user saw it twice in the table and twice in every
       dropdown;
     - a programme chosen here could not be enrolled into unless a training
       centre of that name existed in VocTrain first;
     - a course whose duration has finished must still refuse new trainees.

   The functions are read straight out of School.Fee.html — the page keeps its
   logic inline — and run against a stubbed browser environment.

   Run: node tests/school-fee-programmes.test.js */
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

/* ---------- Pull the functions under test out of the page ---------- */

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'School.Fee.html'), 'utf8');

function extractFunction(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('School.Fee.html no longer defines ' + name + '()');
  let depth = 0, i = PAGE.indexOf('{', start);
  const open = i;
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '() from ' + open);
}

const NAMES = ['feeNameKey', 'feeKeyFor', 'feeProgrammeNames', 'dedupeFeeStructure',
               'feeProgrammeExists', 'feeTrainingCentres', 'feeEnrolmentDecision'];

/* A fresh page-like world for each scenario. */
function makePage(opts) {
  opts = opts || {};
  const store = { voctrain_skillAreas: JSON.stringify(opts.centres || []) };
  const sandbox = {
    feeStructure: opts.feeStructure || {},
    students: opts.students || [],
    payments: opts.payments || [],
    CESTISCore: Core,
    CESTISStore: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = v; }
    },
    saveFeeStructure: function () { sandbox.saved++; },
    saveData: function () { sandbox.saved++; },
    saved: 0,
    console: { log: function () {}, warn: function () {} },
    Date: Date,
    Object: Object,
    Array: Array,
    String: String,
    parseFloat: parseFloat,
    JSON: JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(extractFunction).join('\n\n'), sandbox);
  return sandbox;
}

/* A training centre the enrolment rules can read. */
function centre(name, startDate, endDate) {
  return { id: name, name: name, startDate: startDate, endDate: endDate };
}

const PRICE = { total: 28000, terms: [28000, 0, 0, 0, 0, 0, 0, 0, 0] };

/* ---------- 1. One programme, one entry ---------- */
console.log('The same programme written two ways is listed once');

let page = makePage({
  feeStructure: {
    'WELDING L2': PRICE,
    'Welding l2': { total: 30000, terms: [30000, 0, 0, 0, 0, 0, 0, 0, 0] },
    'ELECTRICAL L2': PRICE
  }
});

assertEq(page.feeProgrammeNames().length, 2, 'two programmes, not three');
assertEq(page.feeProgrammeNames().join('|'), 'ELECTRICAL L2|WELDING L2', 'listed once, alphabetically');
assertEq(page.feeNameKey('  WELDING   L2 '), page.feeNameKey('welding-l2'), 'case, spacing and punctuation are set aside');
assert(page.feeNameKey('WELDING L2') !== page.feeNameKey('WELDING L3'), 'a different level is a different programme');
assert(page.feeNameKey('WELDING L2') !== page.feeNameKey('Welding and Fabrication Level 2'),
  'two genuinely different names are never folded together');

console.log('A duplicate is merged, and its students and payments follow');

page = makePage({
  feeStructure: { 'WELDING L2': PRICE, 'welding l2': PRICE },
  students: [{ id: 'S1', skillArea: 'welding l2' }, { id: 'S2', skillArea: 'WELDING L2' }],
  payments: [{ id: 'P1', skillArea: 'welding l2' }]
});

assertEq(page.dedupeFeeStructure(), true, 'the duplicate is reported as merged');
assertEq(Object.keys(page.feeStructure).length, 1, 'one entry survives');
assertEq(Object.keys(page.feeStructure)[0], 'WELDING L2', 'the first spelling stored is the one kept');
assertEq(page.students[0].skillArea, 'WELDING L2', 'the student on the discarded spelling is moved over');
assertEq(page.students[1].skillArea, 'WELDING L2', 'the student already on the kept spelling is untouched');
assertEq(page.payments[0].skillArea, 'WELDING L2', 'the payment follows too');
assertEq(page.dedupeFeeStructure(), false, 'running it again changes nothing');

console.log('A merge never throws away a cost that was set');

page = makePage({
  feeStructure: {
    'WELDING L2': { total: 0, terms: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    'Welding L2': PRICE
  }
});
page.dedupeFeeStructure();
assertEq(Object.keys(page.feeStructure).length, 1, 'still one entry');
assertEq(page.feeStructure[Object.keys(page.feeStructure)[0]].total, 28000, 'the priced one wins over the blank one');

console.log('The training centre\'s own spelling is preferred');

page = makePage({
  centres: [centre('Welding L2', '2026-01-01', '2027-01-01')],
  feeStructure: { 'WELDING L2': PRICE, 'Welding L2': PRICE },
  students: [{ id: 'S1', skillArea: 'WELDING L2' }]
});
page.dedupeFeeStructure();
assertEq(Object.keys(page.feeStructure)[0], 'Welding L2', 'the exact VocTrain name is the one kept');
assertEq(page.students[0].skillArea, 'Welding L2', 'the student is moved onto it');

console.log('Nothing is merged when there is nothing to merge');

page = makePage({ feeStructure: { 'WELDING L2': PRICE, 'WELDING L3': PRICE } });
assertEq(page.dedupeFeeStructure(), false, 'two real programmes stay two');
assertEq(Object.keys(page.feeStructure).length, 2, 'both survive');

/* ---------- 2. Finding the cost, however the name is written ---------- */
console.log('A programme\'s cost is found however the name is written');

page = makePage({ feeStructure: { 'WELDING L2': PRICE } });
assertEq(page.feeKeyFor('WELDING L2'), 'WELDING L2', 'the exact name');
assertEq(page.feeKeyFor('welding l2'), 'WELDING L2', 'another casing');
assertEq(page.feeKeyFor(' WELDING  L2 '), 'WELDING L2', 'stray spacing');
assertEq(page.feeKeyFor('WELDING L3'), null, 'a programme with no cost set');
assertEq(page.feeKeyFor(''), null, 'blank');
assertEq(page.feeKeyFor(null), null, 'null-safe');
assertEq(page.feeProgrammeExists('welding l2'), true, 'the programme is one the Centre set up');
assertEq(page.feeProgrammeExists('PLUMBING L2'), false, 'a programme nobody set up');

/* ---------- 3. Enrolling into a programme chosen here ---------- */
console.log('A programme set up here can be enrolled into without a VocTrain centre');

page = makePage({ feeStructure: { 'WELDING L2': PRICE } });   // no centres at all
let dec = page.feeEnrolmentDecision('WELDING L2', '2026-08-02');
assertEq(dec.allowed, true, 'allowed on the strength of the cost set here');
assertEq(dec.code, 'fee-only', 'and marked as having no training centre behind it');
assertEq(dec.centre, null, 'there is no centre to stamp');

console.log('A programme nobody set up is still refused');

dec = page.feeEnrolmentDecision('PLUMBING L2', '2026-08-02');
assertEq(dec.allowed, false, 'refused');
assertEq(page.feeEnrolmentDecision('', '2026-08-02').allowed, false, 'so is no programme at all');
assertEq(page.feeEnrolmentDecision('', '2026-08-02').code, 'no-course', 'with the reason to pick one');

console.log('A course whose duration has finished still refuses new trainees');

page = makePage({
  centres: [centre('WELDING L2', '2020-01-01', '2021-01-01')],
  feeStructure: { 'WELDING L2': PRICE }
});
dec = page.feeEnrolmentDecision('WELDING L2', '2026-08-02');
assertEq(dec.allowed, false, 'the ended course is refused');
assertEq(dec.code, 'ended', 'and says so, so a new centre gets created');

console.log('An open course is allowed, and grounds the trainee in its centre');

page = makePage({
  centres: [centre('WELDING L2', '2026-01-01', '2027-06-30')],
  feeStructure: { 'WELDING L2': PRICE }
});
dec = page.feeEnrolmentDecision('WELDING L2', '2026-08-02');
assertEq(dec.allowed, true, 'allowed');
assertEq(dec.code, 'ok', 'through the training-centre rule');
assert(dec.centre && dec.centre.name === 'WELDING L2', 'the centre comes back for stamping');

console.log('An enrolment cannot be dated after the course ends');

dec = page.feeEnrolmentDecision('WELDING L2', '2027-12-01');
assertEq(dec.allowed, false, 'refused');
assertEq(dec.code, 'enrol-after-end', 'for the stated reason');

/* ---------- 4. The empty case the popup is for ---------- */
console.log('With no programmes set up there is nothing to offer');

page = makePage({ feeStructure: {} });
assertEq(page.feeProgrammeNames().length, 0, 'the roster is empty');
assertEq(page.feeEnrolmentDecision('WELDING L2', '2026-08-02').allowed, false,
  'and nothing can be enrolled into until a programme is chosen under Fee Structure');

/* ---------- Result ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
