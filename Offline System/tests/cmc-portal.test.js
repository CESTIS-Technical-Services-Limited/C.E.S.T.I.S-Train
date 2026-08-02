/* Unit tests for cmc-portal.js (pure summary / access-control layer).
   Run: node tests/cmc-portal.test.js */
'use strict';

const cmc = require('../cmc-portal.js');
const {
  CMC_ALLOWED_PANELS, CMC_ALLOWED_CASHBOOK_PAGES,
  cmcPanelAllowed, cmcCashbookPageAllowed, cmcStudentSummary, cmcAverages
} = cmc;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- 1. Access control ---------- */
console.log('CMC access control');
['dashboard', 'students', 'announcements', 'calendar', 'chat', 'video', 'cashbook'].forEach(p =>
  assert(cmcPanelAllowed(p), 'panel "' + p + '" is allowed for the CMC'));
['settings', 'staff-appraisals', 'exams', 'fee-management', 'attendance', ''].forEach(p =>
  assert(!cmcPanelAllowed(p), 'panel "' + p + '" is NOT allowed for the CMC'));
assertEq(CMC_ALLOWED_PANELS.length, 7, 'exactly seven CMC panels');

console.log('Cashbook page restriction');
assert(cmcCashbookPageAllowed('dashboard'), 'Cashbook Main Dashboard allowed');
assert(cmcCashbookPageAllowed('transactions'), 'Cashbook Transactions allowed');
['addbudgetlines', 'budgetlines', 'budget', 'categories', 'monthly', 'financial',
 'reconciliation', 'monthly-recon', 'reports', 'staff-payslip', 'virement-request'].forEach(p =>
  assert(!cmcCashbookPageAllowed(p), 'Cashbook page "' + p + '" is blocked for the CMC'));
assertEq(CMC_ALLOWED_CASHBOOK_PAGES.length, 2, 'only two Cashbook pages exposed');

/* ---------- 2. Student summary (total students on the platform) ---------- */
console.log('Student summary');
const roster = [
  { name: 'A', stage: 'training', course: 'Welding', attendance: 90, gpa: '3.0' },
  { name: 'B', stage: 'training', course: 'Welding', attendance: 80, gpa: '3.5' },
  { name: 'C', stage: 'certified', course: 'Beauty Therapy', attendance: 100, gpa: '4.0' },
  { name: 'D', stage: 'collected', course: 'Beauty Therapy', attendance: 70, gpa: '2.5' },
  { name: 'E', stage: 'incomplete', course: 'Electrical', attendance: 40, gpa: '1.0' },
  { name: 'F', stage: 'testing', course: 'Welding' }
];
const sum = cmcStudentSummary(roster);
assertEq(sum.total, 6, 'total students on the platform counts every record');
assertEq(sum.certified, 2, 'certified counts certified + collected');
assertEq(sum.inTraining, 2, 'in-training count');
assertEq(sum.incomplete, 1, 'incomplete count');
assertEq(sum.certificationRate, 33, 'certification rate 2/6 → 33%');
assertEq(sum.byCourse['Welding'], 3, 'Welding cohort size');
assertEq(sum.byCourse['Beauty Therapy'], 2, 'Beauty Therapy cohort size');
assertEq(sum.byStage['testing'], 1, 'stage breakdown includes testing');

const empty = cmcStudentSummary([]);
assertEq(empty.total, 0, 'empty roster total');
assertEq(empty.certificationRate, 0, 'empty roster rate is 0, not NaN');
assertEq(cmcStudentSummary(null).total, 0, 'null roster treated as empty');
assertEq(cmcStudentSummary(undefined).total, 0, 'undefined roster treated as empty');

const noCourse = cmcStudentSummary([{ name: 'X', stage: 'training' }]);
assertEq(noCourse.byCourse['Unassigned'], 1, 'students without a programme group as Unassigned');

/* ---------- 3. Averages ---------- */
console.log('Averages');
const avg = cmcAverages(roster);
assertEq(avg.attendance, 76, 'average attendance ignores blanks ((90+80+100+70+40)/5 = 76)');
assertEq(avg.gpa, 2.8, 'average GPA ignores blanks ((3+3.5+4+2.5+1)/5 = 2.8)');
assertEq(cmcAverages([]).attendance, 0, 'empty roster attendance is 0');
assertEq(cmcAverages([]).gpa, 0, 'empty roster GPA is 0');
assertEq(cmcAverages([{ name: 'Y' }]).attendance, 0, 'all-blank attendance is 0, not NaN');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
