/* Unit tests for income-expenditure-core.js (the pure layer behind
   Income.Expenditure.html — the live Income and Expenditure Account).
   Run: node tests/income-expenditure.test.js */
'use strict';

const IE = require('../income-expenditure-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function qkey(fy, q) { return 'cestis_quarter_' + fy + '_Q' + q; }
function bkey(fy, q) { return 'cestis_budget_' + fy + '_Q' + q; }

/* ---------- 1. Financial-year identity ---------- */
console.log('Financial-year identity (Apr–Mar)');
assertEq(IE.fyForDate('2024-04-01'), '2024/2025', 'April 1st 2024 opens FY 2024/2025');
assertEq(IE.fyForDate('2025-03-31'), '2024/2025', 'March 31st 2025 closes FY 2024/2025');
assertEq(IE.fyForDate('2025-04-01'), '2025/2026', 'April 1st 2025 opens FY 2025/2026');
assertEq(IE.fyStartYear('2024/2025'), 2024, 'fyStartYear parses the label');
assertEq(IE.fyStartYear('garbage'), null, 'fyStartYear rejects a non-label');

console.log('Year listing starts at FY 2024/2025');
const mapYears = {};
mapYears[qkey('2023/2024', 4)] = JSON.stringify({ transactions: [] });   // before the account starts
mapYears[qkey('2024/2025', 1)] = JSON.stringify({ transactions: [] });
mapYears[qkey('2025/2026', 3)] = JSON.stringify({ transactions: [] });
const years = IE.listYears(mapYears, '2026/2027');
assertEq(years.join(','), '2026/2027,2025/2026,2024/2025', 'stored years from 2024/2025 plus the always-included current year, newest first');
assertEq(IE.listYears({}, null).length, 0, 'no data, no forced year → empty');

/* ---------- 2. Transaction classification ---------- */
console.log('Transaction classification (Cashbook rules)');
assertEq(IE.classify({ id: 1, deposit: 100, payment: 0, category: 'Subvention' }).klass, 'income', 'deposit → income');
assertEq(IE.classify({ id: 2, deposit: 0, payment: 50, category: 'Utilities' }).klass, 'expense', 'payment → expense');
assertEq(IE.classify({ id: 3, deposit: 0, payment: 500, category: 'Cancelled' }).klass, 'voided', 'voided cheque counts zero');
assertEq(IE.classify({ id: 4, deposit: 0, payment: 500 }, { '4': 1 }).klass, 'skip', 'deleted row does not exist');
assertEq(IE.classify({ id: 5, deposit: 0, payment: 0, category: 'Utilities' }).klass, 'zero', 'no money moved');
assertEq(IE.classify(null).klass, 'skip', 'null row skipped');

/* ---------- 3. Salary vs Other split ---------- */
console.log('Salary vs Other Expenses split');
const noBudget = IE.sectionResolver({}, '2024/2025', 1);
assertEq(noBudget('Coordinator Salary'), 'Salaries', 'defaults: Coordinator Salary → Salaries');
assertEq(noBudget('Welding Instructor'), 'Instructors', 'defaults: Welding Instructor → Instructors');
assertEq(noBudget('Statutory Deductions'), 'Statutory', 'defaults: Statutory Deductions → Statutory (other side)');
assertEq(noBudget('Never Heard Of It'), 'Other', 'unknown category → Other');
assert(IE.isSalarySection('Salaries') && IE.isSalarySection('Instructors'), 'Salaries + Instructors are the salary side');
assert(!IE.isSalarySection('Statutory') && !IE.isSalarySection('Admin & Operations') && !IE.isSalarySection('Other'),
  'everything else is the other side');

const mapped = {};
mapped[bkey('2024/2025', 1)] = JSON.stringify({ budget: {}, sections: { 'Generator Tech': 'Instructors', 'Coordinator Salary': 'Admin & Operations' } });
const withBudget = IE.sectionResolver(mapped, '2024/2025', 1);
assertEq(withBudget('Generator Tech'), 'Instructors', 'stored quarter mapping wins over the default');
assertEq(withBudget('Coordinator Salary'), 'Admin & Operations', 'stored mapping can re-file a default category');

/* ---------- 4. Building a year (the calculation view) ---------- */
console.log('Building FY 2024/2025 from quarter blobs');
const map = {};
map[qkey('2024/2025', 1)] = JSON.stringify({
  openingBalance: 0,
  transactions: [
    { id: 1, date: '2024-04-10', details: 'HEART subvention', category: 'Subvention', deposit: 1000000, payment: 0 },
    { id: 2, date: '2024-05-02', details: 'Coordinator April', category: 'Coordinator Salary', deposit: 0, payment: 120000 },
    { id: 3, date: '2024-05-02', details: 'Welding April', category: 'Welding Instructor', deposit: 0, payment: 90000 },
    { id: 4, date: '2024-05-09', details: 'JPS', category: 'Utilities', deposit: 0, payment: 30000 },
    { id: 5, date: '2024-05-12', details: 'Voided cheque', category: 'Cancelled', deposit: 0, payment: 999999, _origPayment: 999999, _origCategory: 'Utilities' },
    { id: 6, date: '2024-05-20', details: 'Deleted by user', category: 'Utilities', deposit: 0, payment: 555 }
  ],
  deletedTxnIds: [6]
});
map[qkey('2024/2025', 3)] = JSON.stringify({
  transactions: [
    { id: 10, date: '2024-10-05', details: 'Second tranche', category: 'Subvention', deposit: 500000, payment: 0 },
    { id: 11, date: '2024-11-01', details: 'Workshop rental income', category: 'Other', deposit: 25000, payment: 0 },
    { id: 12, date: '2024-11-15', details: 'Coordinator Oct', category: 'Coordinator Salary', deposit: 0, payment: 120000 },
    { id: 13, date: '2024-12-01', details: 'Training material', category: 'Training Material', deposit: 0, payment: 60000 }
  ]
});
// A quarter from ANOTHER year must not leak in.
map[qkey('2025/2026', 1)] = JSON.stringify({
  transactions: [{ id: 20, date: '2025-04-10', category: 'Subvention', deposit: 7777777, payment: 0 }]
});

const year = IE.buildYear(map, '2024/2025');
assert(year.hasData, 'year sees its quarters');
assertEq(year.periodStart, '2024-04-01', 'period opens April 1st');
assertEq(year.periodEnd, '2025-03-31', 'period closes March 31st');

const q1 = year.quarters[0], q2 = year.quarters[1], q3 = year.quarters[2], q4 = year.quarters[3];
assertEq(q1.subvention, 1000000, 'Q1 subvention');
assertEq(q1.otherIncome, 0, 'Q1 other income');
assertEq(q1.salary, 210000, 'Q1 salary = coordinator + instructor');
assertEq(q1.other, 30000, 'Q1 other expenses = utilities only (voided + deleted count zero)');
assertEq(q1.expenditure, 240000, 'Q1 total expenditure');
assert(!q2.hasData && q2.expenditure === 0, 'Q2 has no blob → zeros');
assertEq(q3.subvention, 500000, 'Q3 subvention');
assertEq(q3.otherIncome, 25000, 'non-Subvention deposit lands in Other Income');
assertEq(q3.salary, 120000, 'Q3 salary');
assertEq(q3.other, 60000, 'Q3 other expenses');
assert(!q4.hasData, 'Q4 has no blob');

assertEq(year.totals.subvention, 1500000, 'year subvention total');
assertEq(year.totals.otherIncome, 25000, 'year other income total');
assertEq(year.totals.income, 1525000, 'year total income');
assertEq(year.totals.salary, 330000, 'year salary total');
assertEq(year.totals.other, 90000, 'year other expenses total');
assertEq(year.totals.expenditure, 420000, 'year total expenditure');
assertEq(year.totals.result, 1105000, 'result = income − expenditure');
assertEq(year.txnCount, 9, 'live rows counted (deleted row gone, voided still listed)');
assertEq(year.voidedCount, 1, 'one voided cheque');
assert(year.salaryCategories.indexOf('Coordinator Salary') !== -1 && year.salaryCategories.indexOf('Welding Instructor') !== -1,
  'salary categories collected');
assert(year.otherCategories.indexOf('Utilities') !== -1 && year.otherCategories.indexOf('Training Material') !== -1,
  'other categories collected');
assert(year.otherCategories.indexOf('Coordinator Salary') === -1, 'no category rows on both sides');

const empty = IE.buildYear(map, '2030/2031');
assert(!empty.hasData && empty.totals.income === 0 && empty.totals.expenditure === 0, 'a year with no blobs is all zeros');

/* ---------- 5. The statement (the account view) ---------- */
console.log('The certified statement');
const stmt = IE.buildStatement(year);
assertEq(stmt.incomeAmount, 1500000, 'Income Amount = subventions');
assertEq(stmt.otherIncome, 25000, 'Other Income line');
assertEq(stmt.totalIncome, 1525000, 'Total Income = E9 + E11');
assertEq(stmt.salary, 330000, 'Salary line');
assertEq(stmt.otherExpenses, 90000, 'Other Expenses line');
assertEq(stmt.totalExpenditure, 420000, 'Total Expenditure = E17 + E18');
assertEq(stmt.resultLabel, 'SURPLUS', 'income above expenditure reads SURPLUS');
assertEq(stmt.resultAmount, 1105000, 'surplus amount');

const deficitYear = IE.buildYear({
  [qkey('2024/2025', 1)]: JSON.stringify({
    transactions: [
      { id: 1, category: 'Subvention', deposit: 100, payment: 0 },
      { id: 2, category: 'Utilities', deposit: 0, payment: 150.555 }
    ]
  })
}, '2024/2025');
const deficitStmt = IE.buildStatement(deficitYear);
assertEq(deficitStmt.resultLabel, 'DEFICIT', 'expenditure above income reads DEFICIT');
assertEq(deficitStmt.resultAmount, 50.56, 'deficit rounded to cents');

/* ---------- 6. Cloud snapshot ---------- */
console.log('Cloud snapshot capture');
const snap1 = IE.snapshotValue(year);
const snap2 = IE.snapshotValue(IE.buildYear(map, '2024/2025'));
assertEq(snap1, snap2, 'unchanged books → identical snapshot string (no needless upload)');
const parsed = JSON.parse(snap1);
assertEq(parsed.fy, '2024/2025', 'snapshot names its year');
assertEq(parsed.statement.totalIncome, 1525000, 'snapshot carries the statement');
assertEq(parsed.quarters.length, 4, 'snapshot carries all four quarters');
map[qkey('2024/2025', 4)] = JSON.stringify({ transactions: [{ id: 30, category: 'Lunch', deposit: 0, payment: 5000 }] });
assert(IE.snapshotValue(IE.buildYear(map, '2024/2025')) !== snap1, 'changed books → changed snapshot');

/* ---------- 7. Malformed storage never throws ---------- */
console.log('Resilience to malformed storage');
const dirty = {};
dirty[qkey('2024/2025', 1)] = 'not json at all';
dirty[qkey('2024/2025', 2)] = JSON.stringify({ transactions: 'nope' });
dirty[qkey('2024/2025', 3)] = JSON.stringify(null);
dirty['cestis_quarter_garbagekey'] = JSON.stringify({ transactions: [] });
const dirtyYear = IE.buildYear(dirty, '2024/2025');
assert(dirtyYear.totals.income === 0 && dirtyYear.totals.expenditure === 0, 'malformed blobs contribute nothing');
assertEq(IE.listYears(dirty, null).join(','), '2024/2025', 'a malformed blob still names its year; a malformed key does not');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
