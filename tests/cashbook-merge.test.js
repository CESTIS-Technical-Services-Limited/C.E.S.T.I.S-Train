/* Cashbook: every sync path merges by uid; nothing entered here is erased,
   nothing deleted comes back, and no cheque is counted twice.

   Pinned, each through the real code (CESTISCore.cashbook and the page's own
   functions extracted from CESTIS.Cashbook.html):

   1. THE SIGN-IN "CLOUD SYNC REQUIRED" STEP REPLACED EVERY QUARTER (finance-01).
      restoreBackupData wrote the cloud copy over each quarter, so a cheque
      entered while uploads were stopped vanished at the next sign-in.
   2. A ROW WITHOUT A UID WAS DOUBLED (finance-07): each device invented a
      random uid for it, so the subvention came back as a second deposit.
   3. OTHER QUARTERS MERGED BY ID (finance-08) and DELETIONS WERE BY ID
      (finance-09): with ids that differ per device, one device's cheque was
      dropped, another's duplicated, and a deletion removed a different cheque.
   4. EDITS AND VOIDS NEVER LEFT THE DEVICE (finance-12): rows carried no date,
      so a void or amount correction was never taken by a merge.
   5. THE CASHBOOK REWROTE THE TIME CLOCK'S KEYS from a page-load snapshot
      (finance-13); ANOTHER QUARTER'S BUDGET was merged into the active one
      (finance-20); CLEARING THE SUBVENTION was not written down (finance-21);
      a backup holding only the top-level quarter threw (finance-29).
   6. THE PAYROLL LINK WAS KEYED BY THE BARE ID (finance-10/11): deleting any
      transaction zeroed another month's salary that shared its number, and a
      cheque created a second run for the month and an employee from its text.
   7. A NEW DEVICE OPENED FY 2025/2026 Q3 and seeded constants (finance-25).
   8. SIGN-IN WAS A PASSWORD WRITTEN IN THIS PUBLIC PAGE, and ?view=cmc skipped
      sign-in for anyone who knew the URL.

   Run: node tests/cashbook-merge.test.js [page] */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const Core = require('../cestis-core.js');
const CB = Core.cashbook;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
const ROOT = path.join(__dirname, '..');
// The Offline System copy is regenerated from this page by the offline build.
const PAGES = process.argv[2] ? [process.argv[2]] : [path.join(ROOT, 'CESTIS.Cashbook.html')];
let SRC = '', PAGE = '';

function extractFunction(name) {
  let at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) at = SRC.indexOf('\nasync function ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}
function extractStatement(startsWith) {
  const at = SRC.indexOf('\n' + startsWith);
  if (at < 0) throw new Error(PAGE + ' no longer has ' + startsWith);
  let depth = 0, i = at + 1;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return SRC.slice(at, i + 1);
}
const clone = o => JSON.parse(JSON.stringify(o));
const uids = list => list.map(t => t.uid).sort().join(',');

/* ================= The shared rule ================= */
console.log('CESTISCore.cashbook: legacy rows get the SAME uid on every device');
{
  const row = { id: 100, date: '2026-10-05', cheque: '', details: 'SUBVENTION', deposit: 900000, payment: 0, category: 'Subvention' };
  const a = { transactions: [clone(row)] }, b = { transactions: [Object.assign(clone(row), { id: 107 })] };
  CB.ensureUids(a, '2026/2027', 3); CB.ensureUids(b, '2026/2027', 3);
  assert(a.transactions[0].uid && a.transactions[0].uid === b.transactions[0].uid, 'same row, same derived uid, whatever its id');
  const dup = { transactions: [clone(row), clone(row)] };
  CB.ensureUids(dup, '2026/2027', 3);
  assert(dup.transactions[0].uid !== dup.transactions[1].uid, 'two identical rows stay two rows');
  const voided = Object.assign(clone(row), { details: 'Cancelled Cheque', deposit: 0, category: 'Cancelled', _origDetails: 'SUBVENTION', _origDeposit: 900000 });
  assert(CB.legacyUid('2026/2027', 3, voided) === a.transactions[0].uid, 'a voided legacy cheque keeps its uid');
}

console.log('A uid-less subvention is not doubled when it travels between devices (finance-07)');
{
  const sub = { id: 100, date: '2026-10-05', cheque: '', details: 'SUBVENTION', deposit: 900000, payment: 0, category: 'Subvention' };
  const A = { openingBalance: 0, transactions: [clone(sub)], deletedTxnIds: [] };
  const C = { openingBalance: 0, transactions: [{ id: 100, uid: 'T-c-1', date: '2026-10-07', details: 'Fuel', deposit: 0, payment: 5000 }], deletedTxnIds: [] };
  CB.mergeQuarter(C, clone(A), '2026/2027', 3);
  CB.mergeQuarter(A, clone(C), '2026/2027', 3);
  const subs = A.transactions.filter(t => t.category === 'Subvention');
  assert(subs.length === 1, 'A holds the subvention once (got ' + subs.length + ')');
  assert(A.transactions.reduce((s, t) => s + (t.deposit || 0), 0) === 900000, 'deposits total 900,000, not 1,800,000');
  // A device that once adopted it under a RANDOM uid converges instead of doubling.
  const old = { transactions: [Object.assign(clone(sub), { uid: 'T-random-9' })], deletedTxnIds: [] };
  const fresh = { transactions: [clone(sub)], deletedTxnIds: [] };
  CB.mergeQuarter(fresh, clone(old), '2026/2027', 3);
  assert(fresh.transactions.length === 1, 'a randomly-named copy is recognised as the same legacy row');
  CB.mergeQuarter(old, clone(fresh), '2026/2027', 3);
  assert(old.transactions.length === 1 && old.transactions[0].uid === fresh.transactions[0].uid,
    'and the device holding it renames it to the derived uid, so both converge');
}

console.log('Swapped ids: nothing dropped, nothing doubled, a deletion hits the right cheque (finance-08/09)');
{
  const X = { uid: 'T-x', date: '2026-07-10', details: 'Electrodes', payment: 30000, deposit: 0 };
  const Y = { uid: 'T-y', date: '2026-07-11', details: 'Lumber', payment: 40000, deposit: 0 };
  const A = { transactions: [Object.assign({ id: 100 }, X), Object.assign({ id: 101 }, Y)], deletedTxnIds: [] };
  const B = { transactions: [Object.assign({ id: 100 }, Y), Object.assign({ id: 101 }, X)], deletedTxnIds: [] };
  const r = CB.mergeQuarter(clone(B), clone(A), '2026/2027', 2);
  const B2 = clone(B); CB.mergeQuarter(B2, clone(A), '2026/2027', 2);
  assert(B2.transactions.length === 2 && uids(B2.transactions) === 'T-x,T-y' && !r.added, 'B keeps exactly X and Y');
  // A deletes X: written down by uid, with an old-style id list that would hit Y on B.
  A.transactions = A.transactions.filter(t => t.uid !== 'T-x');
  A.deletedTxnUids = ['T-x']; A.deletedTxnIds = [100];
  CB.mergeQuarter(B2, clone(A), '2026/2027', 2);
  assert(uids(B2.transactions) === 'T-y', 'B drops X and keeps Y (got ' + uids(B2.transactions) + ')');
  const A2 = clone(A); CB.mergeQuarter(A2, clone(B2), '2026/2027', 2);
  assert(uids(A2.transactions) === 'T-y', 'and X does not come back to A');
  // An adopted row whose id is taken here gets the next free id.
  const C = { transactions: [{ id: 100, uid: 'T-c', date: '2026-07-01', details: 'Mine', payment: 1 }], deletedTxnIds: [] };
  CB.mergeQuarter(C, { transactions: [{ id: 100, uid: 'T-d', date: '2026-07-02', details: 'Theirs', payment: 2 }] }, '2026/2027', 2);
  assert(C.transactions.length === 2 && new Set(C.transactions.map(t => t.id)).size === 2, 'an id clash re-ids the adopted row, never drops it');
}

console.log('A void, an amount correction and a Balance B/F change reach the other device (finance-12)');
{
  const row = { id: 700, uid: 'T-700', date: '2026-10-03', cheque: '700', details: 'Contractor', payment: 80000, deposit: 0, category: 'Maintenance' };
  const A = { openingBalance: 250000, openingBalanceAt: '2026-10-20T09:00:00.000Z',
    transactions: [Object.assign(clone(row), { details: 'Cancelled Cheque', payment: 0, category: 'Cancelled', updatedAt: '2026-10-20T09:00:00.000Z' })] };
  const B = { openingBalance: 0, transactions: [clone(row)], deletedTxnIds: [] };
  CB.mergeQuarter(B, clone(A), '2026/2027', 3);
  assert(B.transactions[0].category === 'Cancelled' && B.transactions[0].payment === 0, 'B shows the void');
  assert(B.openingBalance === 250000, 'B takes the newer Balance B/F');
  const A2 = clone(A); CB.mergeQuarter(A2, { openingBalance: 0, transactions: [clone(row)] }, '2026/2027', 3);
  assert(A2.transactions[0].category === 'Cancelled' && A2.openingBalance === 250000, 'a stale device\'s copy does not revert A');
}

console.log('Budget lines: the later-dated amount wins; a missing line is added');
{
  const local = { budget: { Utilities: 1000 }, sections: {}, budgetAt: { Utilities: '2026-10-01T00:00:00.000Z' } };
  CB.mergeBudget(local, { budget: { Utilities: 1500, Rent: 900 }, sections: { Rent: 'Admin & Operations' }, budgetAt: { Utilities: '2026-10-05T00:00:00.000Z' } });
  assert(local.budget.Utilities === 1500 && local.budget.Rent === 900, 'newer amount and missing line taken');
  CB.mergeBudget(local, { budget: { Utilities: 1200 } });
  assert(local.budget.Utilities === 1500, 'an undated amount never replaces');
}

/* ================= The page ================= */
const PAGE_FNS = ['getQuarterMeta', 'getQuarterKey', 'getCurrentQuarterKey', 'getMonth', 'getBudgetQuarterKey',
  'getCurrentBudgetQuarterKey', 'getQuarterForDate', 'getQuarterCalendarYear', 'sanitizeTransactionsForQuarter',
  'cbRebaselineActive', 'cbStampActive', 'cbActiveBlob', 'cbRecordDeletion', 'saveToStorage', 'cbRebaselineBudget',
  'cbStampBudget', 'saveQuarterBudget', 'cbMergeQuarterKey', 'cbMergeBudgetKey', 'cbReadStore', 'cbMergeHrIntoStore',
  'silentMerge', 'restoreBackupData', 'loadQuarterData', 'cbNewUid', 'cbPayrollKey', 'cbMonthOf',
  'syncSalaryToPayslip', 'unsyncSalaryFromPayslip', 'deleteTxn', 'updateSubvention', 'cbHex', 'cbVerifyPassword',
  'cbFindLoginAccount', 'cbCmcSessionValid', 'getSubventionTransaction'];

function makePage(store0, fy, q) {
  const backing = Object.assign({}, store0 || {});
  const store = {
    getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; }
  };
  const fields = {};
  const sb = {
    CESTISCore: Core, CESTISStore: store, console: { log() {}, warn() {}, error() {} },
    MONTH_KEYS: { 1: 'jan', 2: 'feb', 3: 'mar', 4: 'apr', 5: 'may', 6: 'jun', 7: 'jul', 8: 'aug', 9: 'sep', 10: 'oct', 11: 'nov', 12: 'dec' },
    transactions: [], deletedTxnIds: [], deletedTxnUids: [], OPENING_BALANCE: 0, OPENING_BALANCE_AT: '', nextId: 100,
    BUDGET: {}, BUDGET_LINE_SECTIONS: {}, BUDGET_AT: {}, staffMembers: [], timeRecords: [],
    _cbStampIndex: null, _cbStampKey: null, _cbObBase: null, _cbBudgetBase: null, _cbBudgetBaseKey: null,
    _cbUidSalt: 'test', _cbUidSeq: 0, activeFY: fy || '2026/2027', activeQ: q || 3,
    cbBooksLoaded: true,   // the page as it is once signed in (its books read from storage)
    confirm: () => true, refreshAll() {}, updateQuarterUI() {}, updateBLQuarterUI() {}, updateSubventionStatus() {},
    getBudgetLineSection: c => (/salary/i.test(c) ? 'Salaries' : 'Other'),
    document: { getElementById: id => fields[id] || (fields[id] = { value: '' }) },
    TextEncoder, crypto: nodeCrypto.webcrypto, Date, Object, Array, String, JSON, Math, Number, Promise, Uint8Array, isNaN, parseInt, parseFloat, Set
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext([extractStatement('const QUARTER_META = '), extractStatement('const CB_LOGIN_ROLES = ')].concat(PAGE_FNS.map(extractFunction)).join('\n\n'), sb);
  sb._backing = backing; sb._fields = fields;
  return sb;
}

async function runFor(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');
  const KEY = 'cestis_quarter_2026/2027_Q3';

  console.log('The sign-in sync keeps a cheque entered while uploads were stopped (finance-01)');
  {
    const local = { openingBalance: 0, transactions: [
      { id: 100, uid: 'T-a', date: '2026-10-02', details: 'Electricity', payment: 12000, deposit: 0, category: 'Utilities' },
      { id: 101, uid: 'T-b', date: '2026-10-03', details: 'Water (entered offline)', payment: 3500, deposit: 0, category: 'Utilities' }], deletedTxnIds: [] };
    const pg = makePage({ [KEY]: JSON.stringify(local) });
    pg.loadQuarterData();
    const cloud = { version: '2.0', data: { activeFY: '2025/2026', activeQ: 3, quarterlyTransactions: { [KEY]: { openingBalance: 0, transactions: [clone(local.transactions[0])], deletedTxnIds: [] } } } };
    pg.restoreBackupData(cloud);
    const stored = JSON.parse(pg._backing[KEY]);
    assert(uids(pg.transactions) === 'T-a,T-b' && uids(stored.transactions) === 'T-a,T-b', PAGE + ': the offline cheque survives, in memory and storage');
    assert(pg.activeFY === '2026/2027', PAGE + ': and this device stays on its own quarter');
  }

  console.log('A backup with only the top-level quarter merges without throwing (finance-29)');
  {
    const pg = makePage({ [KEY]: JSON.stringify({ openingBalance: 0, transactions: [], deletedTxnIds: [] }) });
    pg.loadQuarterData();
    let threw = false;
    try { pg.silentMerge({ data: { activeFY: '2026/2027', activeQ: 3, transactions: [{ id: 100, uid: 'T-z', date: '2026-10-09', details: 'Bridge', payment: 10, deposit: 0 }] } }); }
    catch (e) { threw = true; }
    assert(!threw && pg.transactions.length === 1 && JSON.parse(pg._backing[KEY]).transactions.length === 1, PAGE + ': adopted and saved');
  }

  console.log('Another quarter\'s budget is not merged into the active one (finance-20)');
  {
    const pg = makePage({});
    pg.loadQuarterData();
    pg.silentMerge({ data: { activeFY: '2025/2026', activeQ: 3, budget: { 'Coordinator Salary': 300000 } } });
    assert(Object.keys(pg.BUDGET).length === 0, PAGE + ': this year\'s budget stays empty');
    assert(JSON.parse(pg._backing['cestis_budget_2025/2026_Q3']).budget['Coordinator Salary'] === 300000, PAGE + ': last year\'s line lands in last year\'s quarter');
  }

  console.log('The sync never rewrites the time clock\'s keys from a stale snapshot (finance-13)');
  {
    const pg = makePage({ cestisTimeRecords: JSON.stringify([{ id: 'S1', lastModified: '2026-10-01T00:00:00Z' }]) });
    pg.timeRecords = [];   // the page's load-time snapshot, before S_NEW was clocked
    pg._backing.cestisTimeRecords = JSON.stringify([{ id: 'S1', lastModified: '2026-10-01T00:00:00Z' }, { id: 'S_NEW', lastModified: '2026-10-20T13:00:00Z' }]);
    pg.loadQuarterData();
    pg.silentMerge({ data: { activeFY: '2026/2027', activeQ: 3, timeRecords: [{ id: 'S1', lastModified: '2026-10-01T00:00:00Z' }], staffMembers: [] } });
    const recs = JSON.parse(pg._backing.cestisTimeRecords).map(r => r.id).sort().join();
    assert(recs === 'S1,S_NEW', PAGE + ': the session clocked after load is still stored (got ' + recs + ')');
  }

  console.log('Edits are dated on save; a deletion and a cleared subvention are written down by uid');
  {
    const pg = makePage({ [KEY]: JSON.stringify({ openingBalance: 0, transactions: [
      { id: 100, uid: 'T-a', date: '2026-10-02', details: 'Electricity', payment: 12000, deposit: 0, category: 'Utilities' },
      { id: 101, date: '2026-10-05', details: 'SUBVENTION', payment: 0, deposit: 900000, category: 'Subvention' }] }) });
    pg.loadQuarterData();
    assert(pg.transactions.every(t => t.uid), PAGE + ': every row has a uid after load');
    pg.transactions[0].payment = 0; pg.transactions[0].category = 'Cancelled';
    pg.saveToStorage();
    assert(!!pg.transactions[0].updatedAt, PAGE + ': a void is dated when saved');
    pg.OPENING_BALANCE = 1000; pg.saveToStorage();
    assert(!!pg.OPENING_BALANCE_AT && JSON.parse(pg._backing[KEY]).openingBalanceAt, PAGE + ': so is a Balance B/F change');
    const subUid = pg.transactions[1].uid;
    pg._fields.subventionDate = { value: '' }; pg._fields.subventionAmount = { value: '' };
    pg.updateSubvention();
    assert(pg.deletedTxnUids.indexOf(subUid) !== -1, PAGE + ': clearing the subvention writes its deletion down (finance-21)');
    pg.silentMerge({ data: { quarterlyTransactions: { [KEY]: { openingBalance: 0, transactions: [{ id: 101, date: '2026-10-05', details: 'SUBVENTION', payment: 0, deposit: 900000, category: 'Subvention' }] } } } });
    assert(!pg.transactions.some(t => t.category === 'Subvention'), PAGE + ': and the next sync does not bring it back');
    pg.deleteTxn(100);
    assert(pg.deletedTxnUids.indexOf('T-a') !== -1 && pg.deletedTxnIds.indexOf(100) === -1, PAGE + ': deleteTxn tombstones the uid, not the id');
  }

  console.log('The payroll link: only the transaction\'s own entry moves (finance-10/11)');
  {
    const payroll = { settings: {}, employees: [{ name: 'J. Brown', type: 'FT' }], payrollRuns: [
      { date: '2026-08-31', results: [{ empName: 'J. Brown', gross: 95000, netPay: 80000, nisEmp: 2850 },
        { empName: 'A. Tutor', gross: 60000, netPay: 60000, cashbookSynced: true, cashbookTxns: { 105: 60000 } }] }] };
    const pg = makePage({ cestisPayroll: JSON.stringify(payroll) });
    // A different cheque that happens to be id 105 in Q3 is deleted.
    pg.unsyncSalaryFromPayslip({ id: 105, uid: 'T-stationery', date: '2026-10-14', details: 'Stationery', payment: 2000, category: 'Admin Expenses' });
    const after = JSON.parse(pg._backing.cestisPayroll);
    assert(after.payrollRuns[0].results[1].gross === 60000, PAGE + ': August\'s salary linked to its own id 105 is untouched (got ' + after.payrollRuns[0].results[1].gross + ')');
    // ...while the transaction that IS id 105 in August still unwinds its own link.
    pg.unsyncSalaryFromPayslip({ id: 105, uid: 'L-tutor', date: '2026-08-20', details: 'A. Tutor', payment: 60000, category: 'Coordinator Salary' });
    assert(JSON.parse(pg._backing.cestisPayroll).payrollRuns[0].results[1].gross === 0, PAGE + ': a link written before uids still unwinds in its own month');
    // A salary cheque files into the month's computed run, keeps its gross, and creates no employee.
    pg.syncSalaryToPayslip({ id: 110, uid: 'T-sal', date: '2026-08-28', details: 'J. Brown', payment: 80000, category: 'Coordinator Salary' });
    pg.syncSalaryToPayslip({ id: 111, uid: 'T-adv', date: '2026-08-28', details: 'Mary Grant - Aug salary (Advance Taken)', payment: 85000, category: 'Coordinator Salary' });
    const pd = JSON.parse(pg._backing.cestisPayroll);
    assert(pd.payrollRuns.length === 1, PAGE + ': no second run for August (runs: ' + pd.payrollRuns.map(r => r.date).join() + ')');
    assert(pd.employees.length === 1 && pd.payrollRuns[0].results.find(r => /Mary Grant/.test(r.empName)).cashbookSynced, PAGE + ': no employee created from cheque text');
    const jb = pd.payrollRuns[0].results.find(r => r.empName === 'J. Brown');
    assert(jb.gross === 95000 && jb.cbPaid === 80000 && jb.nisEmp === 2850, PAGE + ': the computed entry keeps its gross; the cheque sits beside it');
    pg.unsyncSalaryFromPayslip({ id: 110, uid: 'T-sal', date: '2026-08-28', details: 'J. Brown', payment: 80000, category: 'Coordinator Salary' });
    const jb2 = JSON.parse(pg._backing.cestisPayroll).payrollRuns[0].results.find(r => r.empName === 'J. Brown');
    assert(jb2.cbPaid === 0 && jb2.gross === 95000, PAGE + ': deleting the cheque unwinds only its own link');
  }

  console.log('A new device opens today\'s quarter with nothing seeded (finance-25)');
  {
    const decl = extractStatement('let activeFY = ') + extractStatement('let activeQ = ');
    const ctx = { CESTISCore: Core };
    vm.createContext(ctx);
    vm.runInContext(decl.replace(/\blet /g, 'var '), ctx);
    const today = Core.currentQuarter();
    assert(ctx.activeFY === today.fy && ctx.activeQ === today.q, PAGE + ': opens on ' + today.fy + ' Q' + today.q + ' (got ' + ctx.activeFY + ' Q' + ctx.activeQ + ')');
    const pg = makePage({}, '2025/2026', 3);
    pg.loadQuarterData();
    assert(pg.OPENING_BALANCE === 0 && pg.transactions.length === 0, PAGE + ': FY 2025/2026 Q3 is not seeded from constants on a fresh device');
    assert(/let reconFY = activeFY;/.test(SRC), PAGE + ': the reconciliation follows the active year');
  }

  console.log('Sign-in uses the Centre\'s LMS accounts; ?view=cmc needs a CMC session');
  {
    assert(SRC.indexOf('AUTH_CREDENTIALS') === -1 && SRC.indexOf("'cestisadmin123$'") === -1, PAGE + ': no password is written in the page');
    const salt = nodeCrypto.randomBytes(16);
    const hash = 'pbkdf2$1000$' + salt.toString('hex') + '$' + nodeCrypto.pbkdf2Sync('S3cret!pw', salt, 1000, 32, 'sha256').toString('hex');
    const pg = makePage({ voctrain_users: JSON.stringify([{ username: 'bursar', role: 'admin', password: hash }, { username: 'kid', role: 'student', password: 'x' }]) });
    assert(!!(await pg.cbFindLoginAccount('bursar', 'S3cret!pw')), PAGE + ': the LMS administrator signs in with their own password');
    assert(!(await pg.cbFindLoginAccount('bursar', 'wrong')), PAGE + ': a wrong password does not');
    assert(!(await pg.cbFindLoginAccount('cestisadmin', 'cestisadmin123$')), PAGE + ': nor does the old published default');
    assert(!(await pg.cbFindLoginAccount('kid', 'x')), PAGE + ': nor a non-administrator account');
    const empty = makePage({});
    assert((await empty.cbFindLoginAccount('a', 'b')).none === true, PAGE + ': a device with no accounts says how to get them');
    assert(pg.cbCmcSessionValid() === false, PAGE + ': opened on its own (not inside the LMS), ?view=cmc is refused');
    pg.window.parent = { currentRole: 'cmc' };
    assert(pg.cbCmcSessionValid() === true, PAGE + ': inside the LMS with a CMC session it opens');
    pg.window.parent = { currentRole: 'student' };
    assert(pg.cbCmcSessionValid() === false, PAGE + ': but not for another role');
  }
}

/* ================= The Payment Voucher page ================= */
async function runVoucher(file) {
  SRC = fs.readFileSync(file, 'utf8');
  PAGE = path.relative(ROOT, file);
  console.log('\n=== ' + PAGE + ' ===');
  console.log('"Sync from Cashbook" merges a quarter this device holds (finance-18)');
  const KEY = 'cestis_quarter_2026/2027_Q3';
  const local = { openingBalance: 0, transactions: [
    { id: 100, uid: 'T-512', date: '2026-10-02', cheque: '512', details: 'Cancelled Cheque', payment: 0, deposit: 0, category: 'Cancelled', updatedAt: '2026-10-20T08:00:00.000Z' },
    { id: 101, uid: 'T-513', date: '2026-10-03', cheque: '513', details: 'Hardware', payment: 18000, deposit: 0, category: 'Maintenance' }] };
  const cloudQ = { openingBalance: 0, transactions: [
    { id: 100, uid: 'T-512', date: '2026-10-02', cheque: '512', details: 'ABC Supplies', payment: 45000, deposit: 0, category: 'Maintenance' },
    { id: 101, uid: 'T-bank', date: '2026-10-04', details: 'Other PC: bank charge', payment: 350, deposit: 0, category: 'Bank Charges' }] };
  const backing = { [KEY]: JSON.stringify(local), cestis_active_quarter: JSON.stringify({ fy: '2026/2027', q: 3 }) };
  const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); } };
  const sb = { CESTISCore: Core, store, DRIVE: { CASHBOOK_FILE: 'c', CASHBOOK_FOLDER_ID: 'f' }, Promise, JSON, Object,
    driveToken: () => 'tok', driveFind: () => Promise.resolve('FILE'),
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { activeFY: '2025/2026', activeQ: 3, quarterlyTransactions: { [KEY]: cloudQ } } }) }) };
  vm.createContext(sb);
  vm.runInContext(extractFunction('pullCashbookQuarters'), sb);
  await sb.pullCashbookQuarters();
  const after = JSON.parse(backing[KEY]).transactions;
  assert(after.find(t => t.uid === 'T-512').category === 'Cancelled', PAGE + ': cheque 512 stays voided');
  assert(after.some(t => t.uid === 'T-513') && after.some(t => t.uid === 'T-bank'), PAGE + ': cheque 513 is kept and the other PC\'s charge arrives');
  assert(JSON.parse(backing.cestis_active_quarter).fy === '2026/2027', PAGE + ': and the Cashbook\'s active quarter is not moved');
  assert(/function ovKey\(v\) \{[^}]*txnUid/.test(SRC), PAGE + ': voucher edits are keyed by the transaction\'s uid (finance-09)');
  assert(SRC.indexOf("quarters.push({ fy: '2025/2026', q: 3 })") === -1, PAGE + ': no hardcoded starting year (finance-25)');
}

(async () => {
  for (const f of PAGES) await runFor(f);
  if (!process.argv[2]) await runVoucher(path.join(ROOT, 'Finance.Payment.Voucher.html'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
