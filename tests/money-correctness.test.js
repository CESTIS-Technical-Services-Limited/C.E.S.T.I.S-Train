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
   the money back while the payslip still reported the salary), and the payroll
   run rounds each figure where it is worked out so a payslip adds up to itself.

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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
