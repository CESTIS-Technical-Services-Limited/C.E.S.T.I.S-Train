/* One intake, one priced programme — School.Fee.html.

   The Centre reported seeing the same 2026/2027 programme twice on the fee
   dashboard while only ONE training centre existed in that fiscal year. Both
   copies were real fee-structure entries: the intake priced under the training
   centre's own label ("22. Welding and Fabrication Level 2") and the same
   intake priced under the Centre's older shorthand for it ("WELDING L2").
   Nothing compared those two spellings and found them equal, so the one intake
   stood twice in the Fee Structure table and twice in every dropdown, each copy
   carrying the same fiscal year.

   collapseFeeIntakes() folds them into one. What these tests pin is that it
   folds ONLY what is genuinely one programme, and that no trainee changes
   intake or loses the fee they answer to when it does.

   The functions are read straight out of School.Fee.html — the page keeps its
   logic inline — and run against a stubbed browser environment.

   Run: node tests/fee-intake-collapse.test.js */
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
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const NAMES = ['feeNameKey', 'feeKeyFor', 'feeProgrammeNames', 'feeProgrammeExists',
               'feeCentreLabel', 'feeTrainingCentres', 'feeBindTraineesToIntake',
               'dedupeFeeStructure', 'collapseFeeIntakes'];

/* The Centre's real shape, anonymised: last year's intakes, which have ended,
   and this year's, which are running. Keys are stamped the way the app stamps
   them on load, so a centre's key is its id. */
function centres() {
  const list = [
    { id: 1,  name: 'Welding & Fabrication',   startDate: '2025-08-04', endDate: '2026-07-31' },
    { id: 3,  name: 'Cosmetology',             startDate: '2025-08-04', endDate: '2026-07-31' },
    { id: 22, name: 'Welding and Fabrication Level 2',   startDate: '2026-08-02', endDate: '2027-07-30' },
    { id: 23, name: 'Electrical Installation Level 2',   startDate: '2026-08-03', endDate: '2027-07-30' },
    { id: 24, name: 'General Cosmetology Level 2',       startDate: '2026-08-02', endDate: '2027-07-30' }
  ];
  Core.enrolment.assignCentreKeys(list);
  return list;
}

function makePage(opts) {
  opts = opts || {};
  const store = {
    voctrain_skillAreas: JSON.stringify(opts.centres || centres()),
    voctrain_deletedCentreIds: JSON.stringify(opts.deletedCentreIds || [])
  };
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
    Date: Date, Object: Object, Array: Array, String: String,
    parseFloat: parseFloat, JSON: JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(extractFunction).join('\n\n'), sandbox);
  return sandbox;
}

const FEE = function (total) { return { total: total, terms: [total, 0, 0, 0, 0, 0, 0, 0, 0] }; };

/* ---------- 1. The duplicate the Centre reported ---------- */
console.log('One intake priced twice becomes one programme');
let page = makePage({
  feeStructure: {
    '22. Welding and Fabrication Level 2': FEE(45000),
    'WELDING L2': FEE(45000),
    '23. Electrical Installation Level 2': FEE(38000),
    'ELECTRICAL L2': FEE(38000)
  }
});

assertEq(page.feeProgrammeNames().length, 4, 'before: the two intakes stand as four programmes');
assertEq(page.collapseFeeIntakes(), true, 'the duplicates are reported as folded');

let names = page.feeProgrammeNames();
assertEq(names.length, 2, 'after: one programme per intake');
assertEq(names.indexOf('22. Welding and Fabrication Level 2') !== -1, true,
  'the intake keeps the training centre\'s own label');
assertEq(names.indexOf('WELDING L2'), -1, 'the shorthand copy is gone');
assertEq(names.indexOf('23. Electrical Installation Level 2') !== -1, true,
  'and the same for the electrical intake');
assertEq(names.indexOf('ELECTRICAL L2'), -1, 'its shorthand copy is gone too');

/* Every remaining programme names a different intake — which is the whole
   claim: one centre in the fiscal year, one programme on the dashboard. */
const seen = {};
names.forEach(function (n) {
  const c = Core.enrolment.findCentre(centres(), n);
  const k = c ? Core.enrolment.centreKeyOf(c) : n;
  assertEq(!!seen[k], false, 'no intake is listed twice: ' + n);
  seen[k] = true;
});

assertEq(page.collapseFeeIntakes(), false, 'running it again changes nothing');

/* ---------- 2. A stated level the centre does not state is another programme ---------- */
console.log('A different NVQ level is never folded into an unlevelled intake');
page = makePage({
  feeStructure: {
    '01. Welding & Fabrication': FEE(30000),   // no level stated; ended 2025/2026
    'WELDING L3': FEE(52000),                  // Level 3 — resolves here only for want of better
    '03. Cosmetology': FEE(28000),
    'COSMETOLOGY L2': FEE(31000)
  }
});
assertEq(page.collapseFeeIntakes(), false, 'nothing is folded');
assertEq(page.feeProgrammeNames().length, 4, 'all four programmes stand');
assertEq(page.feeStructure['WELDING L3'].total, 52000, 'the Level 3 fee is untouched');
assertEq(page.feeStructure['COSMETOLOGY L2'].total, 31000, 'and so is the Level 2 fee');

/* ---------- 3. Nobody changes intake ---------- */
console.log('A trainee of last year\'s intake stays in it, priced by its own label');
page = makePage({
  feeStructure: {
    '01. Welding & Fabrication': FEE(30000),
    '22. Welding and Fabrication Level 2': FEE(45000),
    'WELDING L2': FEE(45000)
  },
  students: [
    // Enrolled in last year's intake, but recorded under the shorthand.
    { id: 'S1', name: 'A', skillArea: 'WELDING L2', centreKey: '01', tuitionFee: 30000,
      enrollmentDate: '2025-09-01', totalPaid: 0 },
    // This year's intake, also under the shorthand.
    { id: 'S2', name: 'B', skillArea: 'WELDING L2', centreKey: '22', tuitionFee: 45000,
      enrollmentDate: '2026-09-01', totalPaid: 0 },
    // Already recorded under the label that is kept.
    { id: 'S3', name: 'C', skillArea: '22. Welding and Fabrication Level 2', centreKey: '22',
      tuitionFee: 45000, enrollmentDate: '2026-09-02', totalPaid: 0 }
  ],
  payments: [
    { id: 'P1', studentId: 'S1', skillArea: 'WELDING L2', amount: 5000 },
    { id: 'P2', studentId: 'S2', skillArea: 'WELDING L2', amount: 7000 },
    { id: 'P3', studentId: 'GONE', skillArea: 'WELDING L2', amount: 900 }
  ]
});
assertEq(page.collapseFeeIntakes(), true, 'the shorthand is folded away');

assertEq(page.students[0].skillArea, '01. Welding & Fabrication',
  'last year\'s trainee is renamed to HER OWN intake, not this year\'s');
assertEq(page.students[0].centreKey, '01', 'and her intake stamp is untouched');
assertEq(page.students[1].skillArea, '22. Welding and Fabrication Level 2',
  'this year\'s trainee takes the kept label');
assertEq(page.students[1].centreKey, '22', 'his intake stamp is untouched too');
assertEq(page.students[2].skillArea, '22. Welding and Fabrication Level 2',
  'a record already on the kept label is left alone');

assertEq(page.payments[0].skillArea, '01. Welding & Fabrication', 'a payment follows its trainee');
assertEq(page.payments[1].skillArea, '22. Welding and Fabrication Level 2', 'and so does the other');
assertEq(page.payments[2].skillArea, '22. Welding and Fabrication Level 2',
  'a payment whose trainee is gone follows the kept spelling');

// Every record still names a programme the Fee Structure prices.
page.students.forEach(function (s) {
  assertEq(page.feeProgrammeExists(s.skillArea), true, s.name + ' is still priced');
});

/* ---------- 4. A fold that would strand a trainee is abandoned ---------- */
console.log('An entry that is the only fee some trainee can reach is kept');
page = makePage({
  feeStructure: {
    // Last year's intake is NOT priced under its own label…
    '22. Welding and Fabrication Level 2': FEE(45000),
    'WELDING L2': FEE(40000)
  },
  students: [
    { id: 'S1', name: 'A', skillArea: 'WELDING L2', centreKey: '01', tuitionFee: 40000,
      enrollmentDate: '2025-09-01', totalPaid: 0 }
  ]
});
assertEq(page.collapseFeeIntakes(), false, 'the fold is abandoned rather than stranding her');
assertEq(page.feeStructure['WELDING L2'].total, 40000, 'her programme keeps its fee');
assertEq(page.students[0].skillArea, 'WELDING L2', 'and her record is untouched');
assertEq(page.students[0].centreKey, '01', 'still in the intake she enrolled in');

/* ---------- 5. A cost is kept rather than lost ---------- */
console.log('The kept entry takes the fee when it has none of its own');
page = makePage({
  feeStructure: {
    '24. General Cosmetology Level 2': { total: 0, terms: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
    'GENERAL COSMETOLOGY L2': FEE(33000)
  }
});
assertEq(page.collapseFeeIntakes(), true, 'the pair is folded');
assertEq(page.feeStructure['24. General Cosmetology Level 2'].total, 33000,
  'the priced copy\'s fee moves onto the kept label');
assertEq(page.feeStructure['GENERAL COSMETOLOGY L2'], undefined, 'the folded copy is gone');

/* ---------- 6. Programmes with no training centre are left alone ---------- */
console.log('A programme this page prices on its own account is never folded');
page = makePage({
  feeStructure: {
    'BUSINESS ADMIN L2': FEE(21000),
    'COMMI CHEF L2': FEE(24000),
    'HOSPITALITY SERVICES L2': FEE(19000)
  }
});
assertEq(page.collapseFeeIntakes(), false, 'nothing to fold');
assertEq(page.feeProgrammeNames().length, 3, 'all three stand');

/* ---------- 7. A deleted centre cannot pull a programme onto its name ---------- */
console.log('A deleted training centre takes part in nothing');
page = makePage({
  deletedCentreIds: ['22'],
  feeStructure: {
    '22. Welding and Fabrication Level 2': FEE(45000),
    'WELDING L2': FEE(45000)
  }
});
assertEq(page.collapseFeeIntakes(), false, 'the deleted intake folds nothing together');
assertEq(page.feeProgrammeNames().length, 2, 'both entries stand, and stay reachable');

/* ---------- 8. A repeated programme: the fold cannot move last year's roll ----
   The Centre runs the same programme again, so two training centres share a
   name and a level, and only their dates tell them apart. A trainee recorded
   under the shorthand and never stamped is bound to the intake that was
   RUNNING when she enrolled, and the fold has to follow that — the new intake
   is where the shorthand points NOW, and sweeping her into it is exactly the
   drift the intake keys exist to prevent. */
console.log('A repeated programme: last year\'s roll stays in last year\'s intake');
const repeated = [
  { id: 22, name: 'Welding and Fabrication Level 2', startDate: '2025-08-04', endDate: '2026-07-31' },
  { id: 30, name: 'Welding and Fabrication Level 2', startDate: '2026-08-02', endDate: '2027-07-30' }
];
Core.enrolment.assignCentreKeys(repeated);
page = makePage({
  centres: repeated,
  feeStructure: {
    '22. Welding and Fabrication Level 2': FEE(40000),
    '30. Welding and Fabrication Level 2': FEE(45000),
    'WELDING L2': FEE(45000)
  },
  students: [
    // No centreKey at all — enrolled long before intakes carried keys.
    { id: 'S1', name: 'A', skillArea: 'WELDING L2', tuitionFee: 40000,
      enrollmentDate: '2025-09-01', totalPaid: 0 },
    { id: 'S2', name: 'B', skillArea: 'WELDING L2', tuitionFee: 45000,
      enrollmentDate: '2026-09-01', totalPaid: 0 }
  ]
});
assertEq(page.collapseFeeIntakes(), true, 'the shorthand is folded into the intake it names now');
assertEq(page.students[0].centreKey, '22', 'she is stamped with the intake running when she enrolled');
assertEq(page.students[0].skillArea, '22. Welding and Fabrication Level 2',
  'and named by it — the fold cannot sweep her into this year\'s intake');
assertEq(page.students[1].centreKey, '30', 'this year\'s trainee is stamped with this year\'s intake');
assertEq(page.students[1].skillArea, '30. Welding and Fabrication Level 2', 'and named by it');
assertEq(page.feeStructure['WELDING L2'], undefined, 'the shorthand is gone');
assertEq(page.feeStructure['22. Welding and Fabrication Level 2'].total, 40000,
  'last year\'s intake keeps its own fee');
assertEq(page.feeProgrammeNames().length, 2, 'two intakes, two programmes');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
