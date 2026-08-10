/* Unit tests for cmc-portal.js (pure summary / access-control layer).
   Run: node tests/cmc-portal.test.js */
'use strict';

const cmc = require('../cmc-portal.js');
const {
  CMC_ALLOWED_PANELS, CMC_ALLOWED_CASHBOOK_PAGES, CMC_SHARED_FILES,
  cmcPanelAllowed, cmcCashbookPageAllowed, cmcStudentSummary, cmcAverages,
  cmcCashbookRows, cmcCashSummary, cmcPayrollRows, cmcClockRows, cmcVirementRows,
  cmcFilterRows, cmcFilterOptions
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


/* ---------- 4. Oversight data: the books the board reads ----------
   These dashboards used to sit empty behind a "Sync Drive Data" button. They
   now read the collections the operating pages own, so what matters is that
   the parsers survive four apps' worth of field-name variation and that the
   money agrees with the Cashbook's own rules. */
console.log('Cashbook rows');
const QUARTERS = {
  'cestis_quarter_2025/2026_Q1': JSON.stringify({
    openingBalance: 433419.51,
    transactions: [
      { id: 1, date: '2025-07-07', cheque: '', details: 'Cheque from C. Palmer', deposit: 88800, payment: 0, category: 'Training Material' },
      { id: 2, date: '2025-07-23', cheque: '', details: 'Crystal-Lee Gordon', deposit: 0, payment: 83535.75, category: 'Administrative Assistant' },
      { id: 3, date: '2025-07-24', cheque: '9001', details: 'Cancelled Cheque', deposit: 0, payment: 0, category: 'Cancelled' },
      { id: 4, date: '2025-07-25', cheque: '', details: 'Deleted row', deposit: 0, payment: 999, category: 'Lunch' }
    ],
    deletedTxnIds: [4]
  }),
  'cestis_quarter_2025/2026_Q2': JSON.stringify({
    openingBalance: 0,
    transactions: [{ id: 1, date: '2025-11-02', cheque: '', details: 'Grant', deposit: 5000, payment: 0, category: 'Income' }],
    deletedTxnIds: []
  }),
  voctrain_students: '[]'                                   // not a quarter: ignored
};
const cash = cmcCashbookRows(QUARTERS);
assertEq(cash.length, 4, 'every quarter contributes; the deleted row does not');
assertEq(cash.filter(r => r.id === '4').length, 0, 'a legacy-deleted transaction is not shown to the board');
assertEq(cash[0].date, '2025-07-07', 'rows come back in date order');
assertEq(cash[0].period, '2025/2026 Q1', 'each row knows which quarter it came from');
assert(cash.some(r => r.period === '2025/2026 Q2'), 'and a second quarter is included, not overwritten');
assertEq(cash.find(r => r.id === '3').voided, true, 'a cancelled cheque is marked voided, not dropped');

console.log('Cashbook summary follows the Cashbook’s own rules');
const cashSum = cmcCashSummary(cash);
assertEq(cashSum.income, 93800, 'income = 88,800 + 5,000');
assertEq(cashSum.expense, 83535.75, 'expenditure excludes the deleted row');
assertEq(cashSum.balance, 10264.25, 'balance is income − expenditure');
assertEq(cashSum.cancelled, 1, 'the cancelled cheque is counted as cancelled…');
assert(cashSum.income + cashSum.expense === 177335.75, '…and contributes nothing to either total');
assertEq(cmcCashbookRows(null).length, 0, 'no storage at all is empty, not a crash');
assertEq(cmcCashbookRows({ 'cestis_quarter_2025/2026_Q1': 'not json' }).length, 0, 'an unreadable quarter is skipped, not fatal');

console.log('Payroll, clock-in and virement rows');
const pay = cmcPayrollRows(JSON.stringify({
  payrollRuns: [
    { date: '2025-07-25', results: [{ empName: 'Crystal-Lee Gordon', position: 'Admin Assistant', gross: 90000, net: 83535.75 }] },
    { date: '2025-08-25', results: [{ name: 'Rashaun Barrett', grossPay: 130000, netPay: 125303.63 }] }
  ]
}));
assertEq(pay.length, 2, 'every run and every person in it becomes a row');
assertEq(pay[0].date, '2025-08-25', 'most recent pay cycle first');
assertEq(pay[1].name, 'Crystal-Lee Gordon', 'empName is read');
assertEq(pay[0].name, 'Rashaun Barrett', 'and so is the other app’s spelling of it');
assertEq(pay[1].deductions, 6464.25, 'deductions derived when only gross and net were stored');
assertEq(cmcPayrollRows(null).length, 0, 'no payroll blob is empty, not a crash');

const clock = cmcClockRows(
  JSON.stringify([
    { id: 'S1', staffId: '7', date: '2025-07-23', clockIn: '2025-07-23T08:00:00Z', clockOut: '2025-07-23T16:30:00Z', status: 'completed' },
    { id: 'S2', staffId: '7', date: '2025-07-24', clockIn: '2025-07-24T08:00:00Z', clockOut: null, status: 'working' }
  ]),
  JSON.stringify([{ id: '7', fullName: 'Jodene Williams-Barrett' }]));
assertEq(clock.length, 2, 'both sessions come through');
assertEq(clock[1].name, 'Jodene Williams-Barrett', 'a session names its staff member from the staff list');
assertEq(clock[1].hours, 8.5, 'hours are worked out from clock-in to clock-out');
assertEq(clock[0].hours, 0, 'an open session claims no hours yet');

const vir = cmcVirementRows(JSON.stringify([
  { id: 11, date: '2025-07-15', project: 'Lunch top-up', requestedBy: 'S. Barrett', total: 100000, status: 'Pending',
    lines: [{ fromName: 'Remedial English', toName: 'Lunch', amount: 100000 }] }
]));
assertEq(vir.length, 1, 'the virement register is read');
assertEq(vir[0].from, 'Remedial English', 'with what the money moved from');
assertEq(vir[0].to, 'Lunch', 'and what it moved to');
assertEq(vir[0].amount, 100000, 'and how much');

/* ---------- 5. Filtering: the board decides what it looks at ---------- */
console.log('Filtering');
assertEq(cmcFilterRows(cash, {}).length, 4, 'no filter shows everything');
assertEq(cmcFilterRows(cash, { type: 'income' }).length, 2, 'filter by type');
assertEq(cmcFilterRows(cash, { period: '2025/2026 Q2' }).length, 1, 'filter by quarter');
assertEq(cmcFilterRows(cash, { search: 'crystal' }).length, 1, 'search is case-insensitive and spans every column');
assertEq(cmcFilterRows(cash, { search: 'CRYSTAL-LEE' }).length, 1, 'including when the board types it in capitals');
assertEq(cmcFilterRows(cash, { from: '2025-11-01' }).length, 1, 'a from-date drops earlier rows');
assertEq(cmcFilterRows(cash, { to: '2025-07-23' }).length, 2, 'a to-date drops later ones');
assertEq(cmcFilterRows(cash, { from: '2025-07-01', to: '2025-07-31' }).length, 3, 'and the two together bound a period');
assertEq(cmcFilterRows(cash, { type: 'income', period: '2025/2026 Q1' }).length, 1, 'filters combine');
assertEq(cmcFilterRows(cash, { type: 'all', period: '' }).length, 4, '"all" and blank mean no restriction');
assertEq(cmcFilterRows(null, { type: 'income' }).length, 0, 'filtering nothing yields nothing, not a crash');

console.log('Filter options');
assertEq(JSON.stringify(cmcFilterOptions(cash, 'period')), JSON.stringify(['2025/2026 Q1', '2025/2026 Q2']),
  'dropdown values are the distinct ones actually present, sorted');
assert(cmcFilterOptions(cash, 'cheque').indexOf('') === -1, 'blanks never become a dropdown choice');
assertEq(cmcFilterOptions([], 'period').length, 0, 'no rows, no choices');

/* ---------- 6. Where the board reads from ---------- */
console.log('Shared files the board reads');
assertEq(CMC_SHARED_FILES.length, 4, 'four operating books');
['CESTIS_Cashbook.json', 'CESTIS_Staff_Payslips.json', 'CESTIS_Staff_TimeClock.json', 'CESTIS_Virement_Requests.json']
  .forEach(f => assert(CMC_SHARED_FILES.some(s => s.file === f), 'reads ' + f));
assert(CMC_SHARED_FILES.find(s => s.key === 'cashbook').prefixes.indexOf('cestis_quarter_') !== -1,
  'the Cashbook is read by prefix — its quarter keys are generated names');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
