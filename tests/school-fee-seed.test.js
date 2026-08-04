/* Seeding the School Fee information.

   Trainees mirrored from the LMS arrive on the fee page with tuitionFee 0 and
   needsFeeDetails, and nothing ever priced them. In the Centre's own backup
   249 of 368 trainees stood at $0 tuition — 193 of them on programmes the Fee
   Structure prices — and with a fee of 0 their balance is 0, so they all read
   "Fully Paid" while owing their whole tuition.

   feeBackfillTuition() prices exactly those: still flagged needsFeeDetails,
   fee still 0, programme priced in the Fee Structure. A trainee an admin has
   deliberately priced (or priced at 0 by editing, which clears the flag) is
   never touched.

   The functions are read straight out of School.Fee.html and run against the
   anonymised copy of the Centre's real backup, so the numbers below are the
   real numbers.

   Run: node tests/school-fee-seed.test.js */
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

const NAMES = ['feeNameKey', 'feeKeyFor', 'feeBackfillTuition', 'feePaymentStatus',
               'feeIsUnpriced', 'recalculateStudentTotals'];

function makePage(students, payments, feeStructure) {
  const sandbox = {
    students: students, payments: payments, feeStructure: feeStructure,
    CESTISCore: Core, console: { log: () => {}, warn: () => {} },
    Date: Date, Object: Object, Array: Array, String: String,
    parseFloat: parseFloat, JSON: JSON, Map: Map
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(extractFunction).join('\n\n'), sandbox);
  return sandbox;
}

/* ---------- Against the Centre's own data ---------- */
const BACKUP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'school-fees-backup.json'), 'utf8'));
const students = JSON.parse(BACKUP.data.cestiSchoolFeeStudents);
const payments = JSON.parse(BACKUP.data.cestiSchoolFeePayments);
const feeStructure = JSON.parse(BACKUP.data.cestiFeeStructure);

console.log('The backup really does hold the problem this fixes');
const zeroBefore = students.filter(s => !(parseFloat(s.tuitionFee) > 0)).length;
assert(zeroBefore >= 240, zeroBefore + ' trainees stand at $0 tuition before seeding');
const fullyPaidBefore = students.filter(s => s.status === 'Fully Paid').length;
assert(fullyPaidBefore >= 240, fullyPaidBefore + ' of them read "Fully Paid" while owing everything');

console.log('Seeding prices every unpriced trainee whose programme has a price');
let page = makePage(JSON.parse(JSON.stringify(students)), JSON.parse(JSON.stringify(payments)), feeStructure);
const priced = page.feeBackfillTuition();
assertEq(priced, 193, 'exactly the 193 pricable trainees are priced — no more, no fewer');

page.recalculateStudentTotals();

const zeroAfter = page.students.filter(s => !(parseFloat(s.tuitionFee) > 0)).length;
assertEq(zeroAfter, zeroBefore - priced, 'only unpricable programmes remain at $0');

console.log('Their balances and statuses now tell the truth');
const owing = page.students.filter(s => s.status === 'Outstanding' || s.status === 'Partial Payment').length;
assert(owing >= 190, owing + ' trainees now show what they actually owe');
const misreported = page.students.filter(s =>
  s.status === 'Fully Paid' && (parseFloat(s.tuitionFee) || 0) > 0 && (parseFloat(s.totalPaid) || 0) === 0).length;
assertEq(misreported, 0, 'nobody priced reads "Fully Paid" without having paid');

console.log('The pricing is stamped, so a merge cannot revert it to $0');
assert(page.students.filter(s => s.updatedAt && (parseFloat(s.tuitionFee) || 0) > 0).length >= priced,
  'every priced record carries a fresh updatedAt');

console.log('Money already recorded is untouched');
const collectedBefore = payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
const collectedAfter = page.payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
assertEq(collectedAfter, collectedBefore, 'every dollar of the $' + collectedBefore.toLocaleString() + ' stands');

console.log('Seeding twice is the same as seeding once');
assertEq(page.feeBackfillTuition(), 0, 'a second pass finds nothing to price');

/* ---------- The guardrails ---------- */
console.log('A trainee an admin priced deliberately is never touched');
page = makePage([
  // Priced by hand at 0 — the flag was cleared when the admin edited them.
  { id: 'A', name: 'Scholarship Case', skillArea: 'WELDING L2', tuitionFee: 0, needsFeeDetails: false },
  // Priced by hand at a discount.
  { id: 'B', name: 'Discount Case', skillArea: 'WELDING L2', tuitionFee: 10000, needsFeeDetails: true },
  // Mirrored, unpriced, programme priced → the one that seeds.
  { id: 'C', name: 'Ordinary Case', skillArea: 'WELDING L2', tuitionFee: 0, needsFeeDetails: true },
  // Mirrored, unpriced, programme NOT in the Fee Structure → left for the admin.
  { id: 'D', name: 'Unpriced Programme', skillArea: 'Photovoltaic Installer', tuitionFee: 0, needsFeeDetails: true }
], [], { 'WELDING L2': { total: 28000, terms: [28000, 0, 0, 0, 0, 0, 0, 0, 0] } });

assertEq(page.feeBackfillTuition(), 1, 'only the ordinary case is priced');
assertEq(page.students[0].tuitionFee, 0, 'the deliberate $0 stands');
assertEq(page.students[1].tuitionFee, 10000, 'the deliberate discount stands');
assertEq(page.students[2].tuitionFee, 28000, 'the mirrored trainee gets the Fee Structure price');
assertEq(page.students[3].tuitionFee, 0, 'an unpriced programme stays unpriced rather than guessing');

console.log('Spelling differences do not stop the pricing');
page = makePage([
  { id: 'E', name: 'Spelling Case', skillArea: 'Welding l2', tuitionFee: 0, needsFeeDetails: true }
], [], { 'WELDING L2': { total: 28000 } });
assertEq(page.feeBackfillTuition(), 1, 'the Fee Structure key is found across case and spacing');
assertEq(page.students[0].tuitionFee, 28000, 'and the right price lands');

console.log('Nothing to seed is answered, not thrown at');
page = makePage([], [], {});
assertEq(page.feeBackfillTuition(), 0, 'an empty roll');
page = makePage([null, {}], [], null);
assertEq(page.feeBackfillTuition(), 0, 'rubbish and a missing Fee Structure');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
