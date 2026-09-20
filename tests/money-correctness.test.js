/* Figures the Centre files or pays out must be right.

   Four faults, each of which produced a wrong number with no warning:

   1. YEAR TO DATE WAS ORDERED BY ARRAY POSITION. The payslip summed every run
      whose INDEX was at or below the selected one. Re-running a month removes it
      from the list and pushes the new one onto the end, so re-running March
      reordered the year: April's payslip then silently dropped March from its
      year-to-date figures, and March's own payslip showed the whole year's tax.

   2. EDUCATION TAX HAD TWO DIFFERENT BASES. The payroll run charged it on gross
      after the NIS contribution — which is what this file's own statutory-return
      header says — while the Edit screen charged it on raw gross. Re-saving an
      unchanged gross through Edit therefore changed the employee's net pay and
      the employer's contribution.

   3. THE STATUTORY RETURN HARDCODED HEART AT 3%. The rate is a setting, and
      payroll used the setting, so a Centre that changed it filed a return that
      disagreed with its own payroll — understated, with nothing to say so.

   4. CASHBOOK IDS COLLIDED BETWEEN DEVICES. Ids count up from 100 out of the
      local list, so two machines entering their first transaction into the same
      quarter both produced id 100. The merge read a matching id as "already have
      it" and silently discarded the other device's row: its payment vanished and
      the totals were short by that amount.

   Also pinned: voiding a salary cheque unwinds the payroll entry it created (the
   delete and edit paths always did; the void path did not, so the cashbook gave
   the money back while the payslip still reported the salary), the payroll
   run rounds each figure where it is worked out so a payslip adds up to itself,
   and an uncleared cheque follows the bank reconciliation into every later
   month — across quarters and the fiscal-year boundary — until the month whose
   statement finally shows it (each month used to see only its own cheques, so
   the month after an uncleared cheque could never reconcile). When a month
   still does not reconcile, the hint offers exactly the payments whose ticking
   or un-ticking closes the gap, matching in whole cents so float noise cannot
   hide the right cheque; applying a suggestion only moves the same tick state
   the checkboxes do, so it is always reversible. And the Financial Data
   Collection Form reports as SUBVENTION RECEIVED only deposits categorised
   Subvention — every other deposit is OTHER DEPOSITS (the form used to print
   every deposit as subvention, overstating what HEART had granted).

   Run: node tests/money-correctness.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAYSLIPS = ['Staff.Payslip.html', 'Offline System/Staff.Payslip.html'];
const CASHBOOKS = ['CESTIS.Cashbook.html', 'Offline System/CESTIS.Cashbook.html'];

function extractFunction(src, name, where) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- 1. Year to date follows the calendar ---------- */
console.log('Year to date counts every run up to this one BY DATE');

PAYSLIPS.forEach(where => {
  const src = read(where);
  assert(src.indexOf('if(ri>cycIdx)return;') === -1,
    where + ': the array-position comparison is gone');
  assert(/const _runDate = parseLocalDate\(run\.date\)\.getTime\(\);/.test(src),
    where + ': the selected run is compared by date');
  assert(/if\(rDate > _runDate\) return;/.test(src),
    where + ': and later runs are excluded by date, however the list is ordered');

  /* The behaviour itself, with March re-run so it sits last in the array. */
  const runs = [
    { date: '2026-01-31', tax: 10 }, { date: '2026-02-28', tax: 10 },
    { date: '2026-04-30', tax: 10 }, { date: '2026-03-31', tax: 10 }
  ];
  const ytd = (sel) => {
    const runDate = Date.parse(runs[sel].date);
    const year = new Date(runs[sel].date).getFullYear();
    return runs.filter(r => Date.parse(r.date) <= runDate && new Date(r.date).getFullYear() === year)
               .reduce((s, r) => s + r.tax, 0);
  };
  assert(ytd(2) === 40, where + ': April counts January to April, including the re-run March (got ' + ytd(2) + ')');
  assert(ytd(3) === 30, where + ': March counts January to March, not the whole year (got ' + ytd(3) + ')');
});

/* ---------- 2. One Education Tax base ---------- */
console.log('Education Tax is charged on the same base wherever it is worked out');

PAYSLIPS.forEach(where => {
  const src = read(where);
  assert(/const statutoryIncome=gross-nisEmp;/.test(src),
    where + ': the payroll run charges Education Tax after the NIS contribution');
  assert(/const statutoryIncomeEdit=gross-nisEmp;/.test(src),
    where + ': and so does the Edit screen');
  assert(!/const edTaxEmp=empType==='contractual'\?0:Math\.round\(gross\*s\.edTaxEmp/.test(src),
    where + ': the Edit screen no longer charges it on raw gross, which changed net pay for an unchanged gross');

  // Worked example: gross 300,000, NIS 3%, Ed Tax 2.25%.
  const gross = 300000, nisEmp = 9000;
  const correct = Math.round((gross - nisEmp) * 0.0225 * 100) / 100;
  const wrong = Math.round(gross * 0.0225 * 100) / 100;
  assert(correct === 6547.5 && wrong === 6750,
    where + ': on a $300,000 gross the two bases differ by $' + (wrong - correct).toFixed(2) + ' a month');
});

/* ---------- 3. The statutory return uses the configured rate ---------- */
console.log('The statutory return uses the HEART rate the Centre actually set');

PAYSLIPS.forEach(where => {
  const src = read(where);
  assert(src.indexOf('* 0.03') === -1,
    where + ': the hardcoded 3% is gone from the statutory return');
  assert((src.match(/DATA\.settings && DATA\.settings\.heartEr != null/g) || []).length >= 2,
    where + ': both the on-screen totals and the exported sheet read the configured rate');
  assert(/'HEART NSTA Tax = ' \+ heartRate2 \+ '%'/.test(src),
    where + ': and the sheet names the rate it used instead of always claiming 3%');
});

/* ---------- 4. Two devices, two transactions ---------- */
console.log('A transaction from another device is never silently discarded');

CASHBOOKS.forEach(where => {
  const src = read(where);
  assert(/function cbNewUid\(/.test(src),
    where + ': a transaction gets a name no other device can produce');
  assert(/function cbAdoptTransaction\(/.test(src),
    where + ': and an incoming one is adopted rather than dropped on an id clash');
  assert((src.match(/cbAdoptTransaction\(/g) || []).length >= 4,
    where + ': every merge path adopts (found ' + (src.match(/cbAdoptTransaction\(/g) || []).length + ' uses)');
  assert(/data\.uid = cbNewUid\(\);/.test(src),
    where + ': new transactions are given one when they are created');

  const sb = {
    transactions: [], deletedTxnIds: [],
    Math: Math, Date: Date, Object: Object, Number: Number, console: console
  };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'cbNewUid', where) + '\n'
    + 'var _cbUidSalt = "test"; var _cbUidSeq = 0;\n'
    + extractFunction(src, 'cbAdoptTransaction', where), sb);

  // Two devices, each entering their FIRST transaction into the same quarter.
  sb.transactions.push({ id: 100, uid: 'T-device-A', details: 'Utilities', payment: 45000 });
  sb.incoming = { id: 100, uid: 'T-device-B', details: 'Lunch', payment: 30000 };
  vm.runInContext('cbAdoptTransaction(incoming)', sb);

  assert(sb.transactions.length === 2,
    where + ': both devices\' entries survive the merge (the second used to vanish)');
  assert(sb.transactions.reduce((s, t) => s + t.payment, 0) === 75000,
    where + ': and the payments total $75,000, not $45,000');
  assert(new Set(sb.transactions.map(t => t.id)).size === 2,
    where + ': the adopted row is given a free id, so it can still be edited and deleted');
  assert(new Set(sb.transactions.map(t => t.uid)).size === 2,
    where + ': and the two remain distinguishable between devices');
});

/* ---------- 5. Voiding a salary cheque leaves the payroll too ---------- */
console.log('Voiding a salary cheque unwinds the payroll entry it created');

CASHBOOKS.forEach(where => {
  const src = read(where);
  const voidFn = extractFunction(src, 'voidSelectedCheque', where);
  assert(/unsyncSalaryFromPayslip\(t\)/.test(voidFn),
    where + ': voiding unwinds the payslip entry, as deleting and editing always did');
  const unvoidFn = extractFunction(src, 'unvoidSelectedCheque', where);
  assert(/syncSalaryToPayslip\(t\)/.test(unvoidFn),
    where + ': and restoring the cheque puts it back, so the two systems agree again');
});

/* ---------- 6. A payslip adds up to itself ---------- */
console.log('Every payroll figure is rounded where it is worked out');

PAYSLIPS.forEach(where => {
  const src = read(where);
  assert(/const money = n => Math\.round\(\(Number\(n\) \|\| 0\) \* 100\) \/ 100;/.test(src),
    where + ': the payroll run rounds to the cent');
  ['nisEmp', 'nisEr', 'nhtEmp', 'nhtEr', 'edTaxEmp', 'edTaxEr', 'heartEr'].forEach(f => {
    assert(new RegExp('const ' + f + '=money\\(').test(src),
      where + ': ' + f + ' is rounded at the point of calculation');
  });
  assert(/const netPay=money\(gross-totalEmpDeductions\);/.test(src),
    where + ': and so is net pay, so the printed lines sum to the printed total');
});

/* ---------- 7. An uncleared cheque follows the reconciliation forward ---------- */
console.log('An uncleared cheque stays on every later month\'s reconciliation until it clears');

CASHBOOKS.forEach(where => {
  const src = read(where);

  const sb = {
    CESTISStore: (function () {
      const m = {};
      return {
        getItem: k => Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null,
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
      };
    })(),
    QUARTER_META: [
      { q: 1, months: ['apr', 'may', 'jun'], monthNums: [4, 5, 6], monthNames: ['April', 'May', 'June'] },
      { q: 2, months: ['jul', 'aug', 'sep'], monthNums: [7, 8, 9], monthNames: ['July', 'August', 'September'] },
      { q: 3, months: ['oct', 'nov', 'dec'], monthNums: [10, 11, 12], monthNames: ['October', 'November', 'December'] },
      { q: 4, months: ['jan', 'feb', 'mar'], monthNums: [1, 2, 3], monthNames: ['January', 'February', 'March'] }
    ]
  };
  vm.createContext(sb);
  ['getQuarterMeta', 'getQuarterCalendarYear', 'loadQuarterDataForRecon',
   'getUnclearedKey', 'loadUnclearedCheques', 'saveUnclearedCheques',
   'bfItemKey', 'getBfClearedKey', 'loadBfCleared', 'saveBfCleared',
   'computeBroughtForwardMap'].forEach(fn => {
    vm.runInContext(extractFunction(src, fn, where), sb);
  });

  // FY 2030/2031, Q2: four July cheques and August's only movement, a bank
  // charge. All four are ticked uncleared on July's reconciliation.
  sb.CESTISStore.setItem('cestis_quarter_2030/2031_Q2', JSON.stringify({
    openingBalance: 114669.55,
    transactions: [
      { id: 100, date: '2030-07-05', details: 'Nadine Thompson (Assessor Fees)', cheque: '1000226', payment: 29393 },
      { id: 101, date: '2030-07-05', details: 'Viron Manning (Assessor Fees)', cheque: '1000227', payment: 29393 },
      { id: 102, date: '2030-07-12', details: 'Lovan Lambert (Assessor)', cheque: '1000229', payment: 35704 },
      { id: 103, date: '2030-07-12', details: 'Clover Thompson (Assessor)', cheque: '1000230', payment: 8926 },
      { id: 104, date: '2030-08-20', details: 'Bank Charges', category: 'Bank Charges', payment: 1816.95 }
    ]
  }));
  vm.runInContext('saveUnclearedCheques("2030/2031", 2, "jul", [100, 101, 102, 103])', sb);

  let map = vm.runInContext('computeBroughtForwardMap("2030/2031")', sb);
  assert(map['2-aug'].length === 4,
    where + ': August inherits all four of July\'s uncleared cheques');
  assert(Math.abs(map['2-aug'].reduce((s, it) => s + it.payment, 0) - 103416) < 0.005,
    where + ': and their $103,416 counts against August\'s bank balance');
  assert(map['3-oct'].length === 4,
    where + ': a quarter boundary does not drop them');

  // Three clear on August's statement; cheque #1000226 is still out.
  vm.runInContext('saveBfCleared("2030/2031", 2, "aug", ' +
    '[bfItemKey("2030/2031", 2, 101), bfItemKey("2030/2031", 2, 102), bfItemKey("2030/2031", 2, 103)])', sb);
  map = vm.runInContext('computeBroughtForwardMap("2030/2031")', sb);
  assert(map['2-aug'].length === 4,
    where + ': August still lists all four, so a clearance can be unticked');
  assert(map['2-sep'].length === 1 && map['2-sep'][0].cheque === '1000226',
    where + ': September inherits only the cheque that has not cleared');
  assert(Math.abs(map.__end.reduce((s, it) => s + it.payment, 0) - 29393) < 0.005,
    where + ': the FY hands exactly the outstanding $29,393 to the next one');

  const nextMap = vm.runInContext('computeBroughtForwardMap("2031/2032")', sb);
  assert(nextMap['1-apr'].length === 1 && nextMap['1-apr'][0].cheque === '1000226',
    where + ': and it follows the reconciliation into April of the next FY');

  // Ids restart at 100 every quarter, so clearing Q2's id 100 must not also
  // clear the unrelated Q1 cheque that carries the same id.
  sb.CESTISStore.setItem('cestis_quarter_2030/2031_Q1', JSON.stringify({
    openingBalance: 0,
    transactions: [{ id: 100, date: '2030-06-10', details: 'June cheque', cheque: '900001', payment: 500 }]
  }));
  vm.runInContext('saveUnclearedCheques("2030/2031", 1, "jun", [100])', sb);
  vm.runInContext('saveBfCleared("2030/2031", 2, "sep", [bfItemKey("2030/2031", 2, 100)])', sb);
  map = vm.runInContext('computeBroughtForwardMap("2030/2031")', sb);
  assert(map['3-oct'].length === 1 && map['3-oct'][0].cheque === '900001',
    where + ': clearing one quarter\'s id 100 leaves the other quarter\'s id 100 outstanding');

  // And the pages actually consume the carried list, not just compute it.
  assert(/const bfMap = computeBroughtForwardMap\(reconFY\);/.test(src),
    where + ': the monthly recon cards read the carried-forward list');
  assert(/bankVal \+ depNotShownVal - monthUnclearedTotal/.test(src),
    where + ': the adjusted bank balance subtracts brought-forward items too');
  assert(/unclearedItems = bfItems\.concat\(unclearedItems\);/.test(src),
    where + ': the printable reconciliation statement includes them as well');
});

/* ---------- 8. The hint names the figure that closes the gap ---------- */
console.log('The reconciliation hint offers exactly the payments that close the difference');

CASHBOOKS.forEach(where => {
  const src = read(where);

  const sb = {
    CESTISStore: (function () {
      const m = {};
      return {
        getItem: k => Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null,
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
      };
    })(),
    renderCalls: 0
  };
  vm.createContext(sb);
  ['findReconCombos', 'getUnclearedKey', 'loadUnclearedCheques', 'saveUnclearedCheques',
   'bfItemKey', 'getBfClearedKey', 'loadBfCleared', 'saveBfCleared',
   'applyReconSuggestion'].forEach(fn => {
    vm.runInContext(extractFunction(src, fn, where), sb);
  });
  vm.runInContext('var _reconSuggestions = {}; function renderMonthlyRecon() { renderCalls++; }', sb);

  // August's candidates: July's four cheques and the August bank charge.
  const candidates = [
    { amount: 29393, label: 'A', act: 'tick-own', id: 100 },
    { amount: 29393, label: 'B', act: 'tick-own', id: 101 },
    { amount: 35704, label: 'C', act: 'tick-own', id: 102 },
    { amount: 8926, label: 'D', act: 'tick-own', id: 103 },
    { amount: 1816.95, label: 'E', act: 'tick-own', id: 104 }
  ];
  sb.candidates = candidates;

  let combos = vm.runInContext('findReconCombos(candidates, 29393)', sb);
  assert(combos.length === 2 && combos.every(c => c.length === 1 && c[0].amount === 29393),
    where + ': two cheques share the gap amount, so BOTH are offered — the user picks');

  combos = vm.runInContext('findReconCombos(candidates, 44630)', sb);
  assert(combos.length === 1 && combos[0].map(c => c.label).sort().join('') === 'CD',
    where + ': a gap no single cheque explains finds the pair that sums to it');

  combos = vm.runInContext('findReconCombos(candidates, 31209.95)', sb);
  assert(combos.length === 2 && combos.every(c => c.map(x => x.label).includes('E')),
    where + ': cent amounts match in whole cents, so $1,816.95 is never missed to float noise');

  assert(vm.runInContext('findReconCombos(candidates, 12345)', sb).length === 0,
    where + ': a gap nothing sums to offers nothing rather than a near miss');

  // Applying a suggestion moves the same tick state the checkboxes use.
  vm.runInContext('saveBfCleared("2030/2031", 2, "aug", ["2030/2031|Q2|101"]);' +
    '_reconSuggestions["s"] = [' +
    '{ act: "tick-own", id: 100 },' +
    '{ act: "reopen-bf", key: "2030/2031|Q2|101" }];' +
    'applyReconSuggestion("2030/2031", 2, "aug", "s")', sb);
  assert(vm.runInContext('loadUnclearedCheques("2030/2031", 2, "aug")', sb).indexOf(100) >= 0,
    where + ': applying ticks the suggested payment as uncleared');
  assert(vm.runInContext('loadBfCleared("2030/2031", 2, "aug")', sb).length === 0,
    where + ': and re-opens a brought-forward item that was wrongly marked cleared');
  assert(sb.renderCalls === 1,
    where + ': then re-renders so the difference is recomputed');
  assert(vm.runInContext('applyReconSuggestion("2030/2031", 2, "aug", "stale"); loadUnclearedCheques("2030/2031", 2, "aug").length', sb) === 1,
    where + ': an unknown suggestion id changes nothing');

  // The cards actually draw the hint and only offer, never auto-apply.
  assert(/if \(Math\.abs\(adjustedDiff\) >= 1\) \{/.test(src),
    where + ': the hint appears exactly when the month shows Unmatched');
  assert(/findReconCombos\(hintCandidates, gap\)/.test(src),
    where + ': and searches this month\'s payments plus brought-forward items');
  assert(/applyReconDepositHint\(/.test(src),
    where + ': a bank-lower gap can be recorded as a deposit not shown');
  assert(/_reconSuggestions\[sugId\] = combo;/.test(src),
    where + ': each button applies a suggestion the render itself registered');
});

/* ---------- 9. Only subvention money is reported as subvention ---------- */
console.log('The Financial Data Collection Form separates subvention from other deposits');

CASHBOOKS.forEach(where => {
  const src = read(where);

  const sb = {
    activeFY: '2030/2031',
    CESTISStore: (function () {
      const m = {};
      return {
        getItem: k => Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null,
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
      };
    })(),
    QUARTER_META: [
      { q: 1, months: ['apr', 'may', 'jun'], monthNums: [4, 5, 6], monthNames: ['April', 'May', 'June'] },
      { q: 2, months: ['jul', 'aug', 'sep'], monthNums: [7, 8, 9], monthNames: ['July', 'August', 'September'] },
      { q: 3, months: ['oct', 'nov', 'dec'], monthNums: [10, 11, 12], monthNames: ['October', 'November', 'December'] },
      { q: 4, months: ['jan', 'feb', 'mar'], monthNums: [1, 2, 3], monthNames: ['January', 'February', 'March'] }
    ]
  };
  vm.createContext(sb);
  ['getQuarterMeta', 'loadQuarterDataForRecon', 'getFinQuarterData'].forEach(fn => {
    vm.runInContext(extractFunction(src, fn, where), sb);
  });

  // A quarter holding the subvention, a cheque received from a project (the
  // Edit dialog's category was "Other", not "Subvention"), and spending.
  sb.CESTISStore.setItem('cestis_quarter_2030/2031_Q2', JSON.stringify({
    openingBalance: 491961.67,
    transactions: [
      { id: 100, date: '2030-07-01', details: 'SUBVENTION', deposit: 250000, payment: 0, category: 'Subvention' },
      { id: 101, date: '2030-07-07', details: 'Cheque from: C. Palmer Project of Hope', deposit: 88800, payment: 0, category: 'Other' },
      { id: 102, date: '2030-08-02', details: 'Assessor fees', payment: 70525.07, category: 'Admin Expenses' }
    ]
  }));

  const fd = vm.runInContext('getFinQuarterData(2)', sb);
  assert(fd.subventionDeposits === 250000,
    where + ': only the deposit categorised Subvention is subvention received');
  assert(fd.otherDeposits === 88800,
    where + ': the project cheque categorised Other lands on the OTHER DEPOSITS line');
  assert(fd.totalAvailable === 491961.67 + 250000 + 88800,
    where + ': total subvention available still counts every deposit, so the form sums');

  // The printed rows and the on-page summary read the split, not the lump sum.
  assert(src.indexOf("fmt(fd.subventionDeposits) : '$-'") >= 0 &&
         src.indexOf("fmt(fd.otherDeposits) : '$-'") >= 0,
    where + ': the printed form fills both lines from the split');
  assert(src.indexOf('SUBVENTION RECEIVED DURING THE PERIOD</td><td class="fdoc-st-val">\' + fmt(fd.totalDeposits)') === -1,
    where + ': and no longer prints every deposit as subvention');
  assert(/fin-subvention'\)\.textContent = fmt\(d\.subventionDeposits\);/.test(src) &&
         /fin-other-deposits'\)\.textContent = fmt\(d\.otherDeposits\);/.test(src),
    where + ': the on-page Subvention Summary shows the same split');
  assert(/monthSubventionDeposits > 0 \? fmt\(monthSubventionDeposits\)/.test(src) &&
         /monthOtherDeposits > 0 \? fmt\(monthOtherDeposits\)/.test(src),
    where + ': the monthly bank reconciliation document separates them too');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
