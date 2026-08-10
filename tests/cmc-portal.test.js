/* Unit tests for cmc-portal.js (pure summary / access-control layer).
   Run: node tests/cmc-portal.test.js */
'use strict';

const cmc = require('../cmc-portal.js');
const {
  CMC_ALLOWED_PANELS, CMC_ALLOWED_CASHBOOK_PAGES, CMC_SHARED_FILES,
  cmcPanelAllowed, cmcCashbookPageAllowed, cmcStudentSummary, cmcAverages,
  cmcCashbookRows, cmcCashSummary, cmcPayrollRows, cmcClockRows, cmcVirementRows,
  cmcVirementStage, cmcRulingFor, cmcRuleVirement, cmcCountersignVirement,
  cmcWithdrawRuling, cmcApplyRuling, cmcSigner, cmcChairOf,
  cmcApplyVirementDecision, cmcPendingVirements,
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


/* ---------- 7. The one decision the Board makes, and it takes two ----------
   Oversight is read-only everywhere except here. A virement moves money
   between budget lines, so it takes TWO signatures: the Chairperson rules, a
   second board member countersigns. Only then does anything reach the register
   Virement.Request.html reads — a half-signed ruling that leaked into it would
   have the Centre acting on an approval nobody had seconded. */
console.log('Virement rulings: who may rule');
const REGISTER = [
  { id: 11, date: '2025-07-15', project: 'Lunch top-up', requestedBy: 'S. Barrett', total: 100000, status: 'Pending', lines: [{ fromName: 'Remedial English', toName: 'Lunch', amount: 100000 }] },
  { id: 12, date: '2025-06-02', project: 'Electrical', requestedBy: 'S. Barrett', total: 79996.27, status: 'Approved', approvedBy: 'Admin', approvalDate: '2025-06-03', approvalComment: 'agreed', lines: [] }
];
const vrows = cmcVirementRows(JSON.stringify(REGISTER));
const pendingRow = vrows.find(r => r.status === 'Pending');
const decidedRow = vrows.find(r => r.status === 'Approved');
const CHAIR = { name: 'Marcia Reid', username: 'm.reid', isChair: true };
const MEMBER = { name: 'Delroy Green', username: 'd.green', isChair: false };
const NOW = '2026-08-10T14:00:00.000Z';

assertEq(cmcPendingVirements(vrows).length, 1, 'one request is awaiting the Board');
assertEq(decidedRow.approvedBy, 'Admin', 'a decided request says who ruled');
assert(!cmcRuleVirement(pendingRow, null, 'Approved', MEMBER, NOW, '').ok,
  'an ordinary board member cannot rule — that is the Chairperson\'s alone');
assert(cmcRuleVirement(pendingRow, null, 'Approved', MEMBER, NOW, '').reason.indexOf('Chairperson') !== -1,
  'and the refusal says whose job it is');
assert(!cmcRuleVirement(pendingRow, null, 'Approved', { name: 'X', username: '', isChair: true }, NOW, '').ok,
  'a ruling has to come from a named account');
assert(!cmcRuleVirement(pendingRow, null, 'Maybe', CHAIR, NOW, '').ok, 'there is no third verdict');
assert(!cmcRuleVirement(null, null, 'Approved', CHAIR, NOW, '').ok, 'a request that is not there cannot be ruled on');
assert(!cmcRuleVirement(pendingRow, null, 'Rejected', CHAIR, NOW, '  ').ok, 'a rejection still needs a reason');
assert(cmcRuleVirement(pendingRow, null, 'Approved', CHAIR, NOW, '').ok, 'an approval needs no minute');

console.log('Stage one: the Chair rules, and the register does not move');
const ruled = cmcRuleVirement(pendingRow, null, 'Approved', CHAIR, NOW, ' agreed at the July meeting ');
assert(ruled.ok, 'the Chairperson may rule');
assertEq(ruled.ruling.decision, 'Approved', 'the ruling carries the verdict');
assertEq(ruled.ruling.by, 'Marcia Reid', 'and who made it');
assertEq(ruled.ruling.byUsername, 'm.reid', 'by account, so a second signature can be checked against it');
assertEq(ruled.ruling.comment, 'agreed at the July meeting', 'the minute is trimmed');
assertEq(cmcVirementStage(pendingRow, ruled.ruling), 'awaiting-countersign', 'the request now awaits a countersignature');
assertEq(cmcVirementStage(pendingRow, null), 'pending', 'with no ruling it is simply pending');
assertEq(cmcVirementStage(decidedRow, null), 'settled', 'a request the register already decided is settled');
assert(!cmcRuleVirement(pendingRow, ruled.ruling, 'Rejected', CHAIR, NOW, 'changed my mind').ok,
  'the Chair cannot rule twice on the same request');
assert(!cmcRuleVirement(decidedRow, null, 'Approved', CHAIR, NOW, '').ok, 'nor re-decide a settled one');
assert(cmcRuleVirement(decidedRow, null, 'Approved', CHAIR, NOW, '').reason.indexOf('Admin') !== -1,
  'and that refusal names who ruled first');

console.log('Stage two: a SECOND board member countersigns');
assert(!cmcCountersignVirement(pendingRow, ruled.ruling, CHAIR, NOW).ok,
  'the Chair cannot countersign their own ruling — that is one signature wearing two hats');
assert(cmcCountersignVirement(pendingRow, ruled.ruling, CHAIR, NOW).reason.indexOf('second board member') !== -1,
  'and says so plainly');
assert(!cmcCountersignVirement(pendingRow, null, MEMBER, NOW).ok, 'there is nothing to countersign before the Chair rules');
assert(!cmcCountersignVirement(pendingRow, ruled.ruling, { name: 'X', username: '' }, NOW).ok,
  'a countersignature has to come from a named account');

const signed = cmcCountersignVirement(pendingRow, ruled.ruling, MEMBER, NOW);
assert(signed.ok, 'a different board member may countersign');
assertEq(cmcVirementStage(pendingRow, signed.ruling), 'settled', 'and that settles it');
assertEq(signed.patch.status, 'Approved', 'the register gets the word Virement.Request.html matches on');
assertEq(signed.patch.approvedBy, 'Marcia Reid (CMC Chair), countersigned by Delroy Green (CMC Board)',
  'and BOTH signatures, so the decision can be traced to two people');
assertEq(signed.patch.approvalDate, '2026-08-10', 'dated the day it was settled, no time component');
assertEq(signed.patch.approvalComment, 'agreed at the July meeting', 'the Chair\'s minute travels with it');
assertEq(Object.keys(signed.patch).sort().join(','), 'approvalComment,approvalDate,approvedBy,status',
  'and NOTHING else about the request is touched');
assert(!cmcCountersignVirement(pendingRow, signed.ruling, MEMBER, NOW).ok, 'a settled request cannot be countersigned again');

console.log('A ruling nobody seconds can be withdrawn, so nothing gets stuck');
assert(cmcWithdrawRuling(pendingRow, ruled.ruling, CHAIR).ok, 'the Chair may take back an uncountersigned ruling');
assert(!cmcWithdrawRuling(pendingRow, ruled.ruling, MEMBER).ok, 'another member may not withdraw it for them');
assert(!cmcWithdrawRuling(pendingRow, signed.ruling, CHAIR).ok, 'and a countersigned decision cannot be withdrawn');
assert(!cmcWithdrawRuling(pendingRow, null, CHAIR).ok, 'there has to be a ruling to withdraw');

console.log('The minute book is written without being mutated');
const book0 = {};
const book1 = cmcApplyRuling(book0, 11, ruled.ruling);
assertEq(Object.keys(book0).length, 0, 'the book handed in is left alone');
assertEq(cmcRulingFor(book1, 11).decision, 'Approved', 'the ruling is filed under the request id');
assertEq(cmcRulingFor(book1, '11').decision, 'Approved', 'found whether the id is a number or a string');
assertEq(cmcRulingFor(book1, 12), null, 'and nothing is invented for a request nobody ruled on');
assertEq(Object.keys(cmcApplyRuling(book1, 11, null)).length, 0, 'withdrawing removes the entry');
assertEq(cmcRulingFor(null, 11), null, 'no book at all is not a crash');

console.log('Who is signing');
assertEq(cmcSigner({ name: 'Marcia Reid', username: 'm.reid', cmcChair: true }).isChair, true, 'the chair flag is read off the account');
assertEq(cmcSigner({ name: 'D', username: 'd' }).isChair, false, 'an ordinary board account is not the Chair');
assertEq(cmcSigner(null).isChair, false, 'and no account at all is certainly not');
const ACCOUNTS = [
  { name: 'Admin', role: 'admin', cmcChair: true },              // not a board member
  { name: 'Delroy Green', role: 'cmc' },
  { name: 'Marcia Reid', role: 'cmc', cmcChair: true },
  { name: 'Old Chair', role: 'cmc', cmcChair: true, status: 'inactive' }
];
assertEq(cmcChairOf(ACCOUNTS).name, 'Marcia Reid', 'the Chair is the ACTIVE board account carrying the office');
assertEq(cmcChairOf([{ name: 'D', role: 'cmc' }]), null, 'a board with no Chair appointed says so');
assertEq(cmcChairOf(null), null, 'and no accounts at all is not a crash');

console.log('Applying a settled decision touches one request and nothing else');
const raw = JSON.stringify(REGISTER);
const next = cmcApplyVirementDecision(raw, 11, signed.patch);
const after = JSON.parse(next);
assertEq(after.length, 2, 'the register keeps every request');
assertEq(after[0].status, 'Approved', 'the ruled request carries the decision');
assertEq(after[0].total, 100000, 'and everything else about it is untouched');
assertEq(after[0].lines[0].toName, 'Lunch', 'including its budget lines');
assertEq(JSON.stringify(after[1]), JSON.stringify(REGISTER[1]), 'the OTHER request is byte-identical — a ruling is not a rewrite');
assertEq(JSON.parse(raw)[0].status, 'Pending', 'and the register handed in was not mutated');
assertEq(cmcApplyVirementDecision(raw, 999, signed.patch), null, 'an id that is not in the register writes nothing back');
assertEq(cmcApplyVirementDecision('not json', 11, signed.patch), null, 'an unreadable register writes nothing back');
assertEq(cmcApplyVirementDecision(null, 11, signed.patch), null, 'and neither does an absent one');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
