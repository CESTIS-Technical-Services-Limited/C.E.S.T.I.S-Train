/* ============================================================================
   income-expenditure-core.js — pure logic for the Income and Expenditure
   Account page (Income.Expenditure.html).

   Builds the two views of the old Excel workbooks straight from the
   Cashbook's own storage:

     · the CALCULATION view — one financial year (Apr–Mar) as a grid of
       expenditure categories × quarters, with the subventions received per
       quarter beside it, exactly like a sheet of
       "Income_and_Expenditure_Calculation.xlsx";

     · the ACCOUNT view — the certified one-page statement (Income Amount /
       Other Income / Salary / Other Expenses / Surplus or Deficit), exactly
       like a sheet of "Income_and_Expenditure_Account.xlsx".

   The numbers come from the same per-quarter blobs the Cashbook writes
   (cestis_quarter_<FY>_Q<n>), honouring deleted rows and voided cheques the
   way the Cashbook's own calcTotals does: a voided cheque counts ZERO, a
   deleted row does not exist. The Salary / Other Expenses split reuses the
   Cashbook's budget sections (cestis_budget_<FY>_Q<n> stored mappings, with
   the same defaults): Salaries + Instructors are salary, all else is other.

   Everything here is a pure function over a plain { key: value } map of the
   store, so it is unit-testable in Node (tests/income-expenditure.test.js)
   with no browser.
   ============================================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.IECore = Object.assign(root.IECore || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* The account starts with the financial year the user asked for: Apr 2024
     to Mar 2025, and every year after it. Earlier quarters may exist in the
     store; they are not this page's business. */
  var START_FY_YEAR = 2024;

  var QUARTERS = [
    { q: 1, label: 'Q1 · Apr–Jun', longLabel: 'April – June' },
    { q: 2, label: 'Q2 · Jul–Sep', longLabel: 'July – September' },
    { q: 3, label: 'Q3 · Oct–Dec', longLabel: 'October – December' },
    { q: 4, label: 'Q4 · Jan–Mar', longLabel: 'January – March' }
  ];

  /* Mirror of the Cashbook's BUDGET_SECTIONS defaults. A category resolving to
     Salaries or Instructors is salary; everything else is an other expense. */
  var DEFAULT_SECTIONS = {
    'Salaries': ['Coordinator Salary', 'Asst. Coordinator'],
    'Statutory': ['Statutory Deductions'],
    'Admin & Operations': ['Admin Expenses', 'Training Material', 'Assessor Fees',
                           'Utilities', 'Maintenance', 'Bank Charges', 'Travelling', 'Lunch'],
    'Instructors': ['Welding L3 Instructor', 'Electrical L3 Instructor', 'Welding Instructor',
                    'BT Instructor', 'Electrical Instructor', 'BNV Welding Instructor',
                    'BNV Electrical Instructor', 'Data Instructor', 'Remedial English',
                    'Personal Dev', 'Entrep Instructor', 'Math Instructor']
  };
  var SALARY_SECTIONS = { 'Salaries': 1, 'Instructors': 1 };

  /* The deposit category that is the Centre's grant. Deposits under it are the
     statement's "Income Amount"; any other deposit is "Other Income". */
  var SUBVENTION_CATEGORY = 'Subvention';

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function round2(x) { return Math.round((num(x) + Number.EPSILON) * 100) / 100; }
  function parseJson(raw, dflt) {
    if (raw == null) return dflt;
    if (typeof raw !== 'string') return raw;
    try { var v = JSON.parse(raw); return v == null ? dflt : v; } catch (e) { return dflt; }
  }

  function fyLabel(startYear) { return startYear + '/' + (startYear + 1); }
  function fyStartYear(fy) {
    var m = /^(\d{4})\s*\/\s*\d{4}$/.exec(String(fy || '').trim());
    return m ? parseInt(m[1], 10) : null;
  }

  /* Every quarter blob the Cashbook has stored, as { fy, q, blob }. */
  function quarterBlobs(storeMap) {
    var map = storeMap || {}, out = [];
    Object.keys(map).forEach(function (k) {
      var m = /^cestis_quarter_(\d{4}\/\d{4})_Q([1-4])$/.exec(k);
      if (!m) return;
      var blob = parseJson(map[k], null);
      if (!blob || typeof blob !== 'object') return;
      out.push({ fy: m[1], q: parseInt(m[2], 10), blob: blob });
    });
    return out;
  }

  /* The financial years this page shows: every stored year from Apr 2024 on,
     plus (optionally) the year `alwaysInclude` even when it has no data yet,
     so the current year is on screen from its first day. Newest first. */
  function listYears(storeMap, alwaysInclude) {
    var seen = {};
    quarterBlobs(storeMap).forEach(function (e) {
      var y = fyStartYear(e.fy);
      if (y != null && y >= START_FY_YEAR) seen[fyLabel(y)] = 1;
    });
    if (alwaysInclude) {
      var ay = fyStartYear(alwaysInclude);
      if (ay != null && ay >= START_FY_YEAR) seen[fyLabel(ay)] = 1;
    }
    return Object.keys(seen).sort(function (a, b) { return fyStartYear(b) - fyStartYear(a); });
  }

  /* Which financial year (Apr–Mar) a date belongs to — used only to suggest
     the year the page opens on, never to re-file a transaction: a transaction
     belongs to the quarter whose blob it is stored in, exactly as in the
     Cashbook. */
  function fyForDate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return null;
    var y = dt.getFullYear();
    return fyLabel(dt.getMonth() + 1 >= 4 ? y : y - 1);
  }

  /* One transaction, resolved the way the Cashbook's own totals resolve it:
     a deleted row is gone, a voided ('Cancelled') cheque counts zero. */
  function classify(txn, droppedIds) {
    if (!txn || txn.id == null) return { klass: 'skip' };
    if (droppedIds && droppedIds[String(txn.id)]) return { klass: 'skip' };
    if (String(txn.category || '') === 'Cancelled') return { klass: 'voided' };
    var dep = num(txn.deposit), pay = num(txn.payment);
    if (dep > 0) return { klass: 'income', amount: dep, category: String(txn.category || 'Uncategorised') };
    if (pay > 0) return { klass: 'expense', amount: pay, category: String(txn.category || 'Uncategorised') };
    return { klass: 'zero' };
  }

  /* category -> 'Salaries' | 'Instructors' | ... for one quarter, honouring
     the mapping stored with that quarter's budget and falling back to the
     defaults — the Cashbook's getBudgetLineSection, made pure. */
  function sectionResolver(storeMap, fy, q) {
    var blob = parseJson((storeMap || {})['cestis_budget_' + fy + '_Q' + q], null);
    var stored = (blob && typeof blob === 'object' && blob.sections && typeof blob.sections === 'object') ? blob.sections : {};
    return function (category) {
      if (stored[category]) return String(stored[category]);
      var names = Object.keys(DEFAULT_SECTIONS);
      for (var i = 0; i < names.length; i++) {
        if (DEFAULT_SECTIONS[names[i]].indexOf(category) !== -1) return names[i];
      }
      return 'Other';
    };
  }
  function isSalarySection(section) { return !!SALARY_SECTIONS[section]; }

  /* ------------------------------------------------------------------------
     The CALCULATION view of one financial year — the live twin of one sheet
     of Income_and_Expenditure_Calculation.xlsx.
     ------------------------------------------------------------------------ */
  function buildYear(storeMap, fy) {
    var startYear = fyStartYear(fy);
    var year = {
      fy: fy,
      periodStart: startYear != null ? startYear + '-04-01' : '',
      periodEnd: startYear != null ? (startYear + 1) + '-03-31' : '',
      quarters: [],
      salaryCategories: [],
      otherCategories: [],
      totals: { subvention: 0, otherIncome: 0, income: 0, salary: 0, other: 0, expenditure: 0, result: 0 },
      txnCount: 0, voidedCount: 0, hasData: false
    };
    if (startYear == null) return year;

    var blobsByQ = {};
    quarterBlobs(storeMap).forEach(function (e) { if (e.fy === fy) blobsByQ[e.q] = e.blob; });

    var salarySeen = {}, otherSeen = {};
    var salaryOrder = [], otherOrder = [];

    QUARTERS.forEach(function (meta) {
      var col = {
        q: meta.q, label: meta.label, longLabel: meta.longLabel,
        subvention: 0, otherIncome: 0, income: 0,
        byCategory: {}, salary: 0, other: 0, expenditure: 0, hasData: false
      };
      var blob = blobsByQ[meta.q];
      if (blob) {
        col.hasData = true;
        year.hasData = true;
        var dropped = {};
        (Array.isArray(blob.deletedTxnIds) ? blob.deletedTxnIds : []).forEach(function (id) { dropped[String(id)] = 1; });
        var section = sectionResolver(storeMap, fy, meta.q);
        (Array.isArray(blob.transactions) ? blob.transactions : []).forEach(function (t) {
          var r = classify(t, dropped);
          if (r.klass === 'skip') return;
          year.txnCount++;
          if (r.klass === 'voided') { year.voidedCount++; return; }
          if (r.klass === 'zero') return;
          if (r.klass === 'income') {
            if (r.category === SUBVENTION_CATEGORY) col.subvention += r.amount;
            else col.otherIncome += r.amount;
            return;
          }
          // expense
          col.byCategory[r.category] = (col.byCategory[r.category] || 0) + r.amount;
          if (isSalarySection(section(r.category))) {
            col.salary += r.amount;
            if (!salarySeen[r.category]) { salarySeen[r.category] = 1; salaryOrder.push(r.category); }
          } else {
            col.other += r.amount;
            if (!otherSeen[r.category]) { otherSeen[r.category] = 1; otherOrder.push(r.category); }
          }
        });
      }
      col.subvention = round2(col.subvention);
      col.otherIncome = round2(col.otherIncome);
      col.income = round2(col.subvention + col.otherIncome);
      col.salary = round2(col.salary);
      col.other = round2(col.other);
      col.expenditure = round2(col.salary + col.other);
      Object.keys(col.byCategory).forEach(function (c) { col.byCategory[c] = round2(col.byCategory[c]); });
      year.quarters.push(col);

      year.totals.subvention += col.subvention;
      year.totals.otherIncome += col.otherIncome;
      year.totals.salary += col.salary;
      year.totals.other += col.other;
    });

    /* A category that moved between the salary and other side across quarters
       (a re-mapped section) must not be ROWED twice: it lists under salary,
       while each quarter's subtotals keep honouring that quarter's own
       mapping — the same books the Cashbook shows for that quarter. */
    otherOrder = otherOrder.filter(function (c) { return !salarySeen[c]; });

    year.salaryCategories = salaryOrder;
    year.otherCategories = otherOrder;
    var t = year.totals;
    t.subvention = round2(t.subvention);
    t.otherIncome = round2(t.otherIncome);
    t.income = round2(t.subvention + t.otherIncome);
    t.salary = round2(t.salary);
    t.other = round2(t.other);
    t.expenditure = round2(t.salary + t.other);
    t.result = round2(t.income - t.expenditure);   // > 0 surplus, < 0 deficit
    return year;
  }

  /* ------------------------------------------------------------------------
     The ACCOUNT view — the certified statement, the live twin of one sheet
     of Income_and_Expenditure_Account.xlsx. The old workbook computed
     DEFICIT = expenditure − income; here the sign is made explicit instead
     of a label that lies in a surplus year.
     ------------------------------------------------------------------------ */
  function buildStatement(year) {
    var t = (year && year.totals) || {};
    var income = round2(num(t.income));
    var expenditure = round2(num(t.expenditure));
    var result = round2(income - expenditure);
    return {
      fy: year ? year.fy : '',
      periodStart: year ? year.periodStart : '',
      periodEnd: year ? year.periodEnd : '',
      incomeAmount: round2(num(t.subvention)),
      otherIncome: round2(num(t.otherIncome)),
      totalIncome: income,
      salary: round2(num(t.salary)),
      otherExpenses: round2(num(t.other)),
      totalExpenditure: expenditure,
      result: result,
      resultLabel: result < 0 ? 'DEFICIT' : 'SURPLUS',
      resultAmount: round2(Math.abs(result)),
      hasData: !!(year && year.hasData)
    };
  }

  /* ------------------------------------------------------------------------
     The page's own cloud capture: the computed statements, one blob per
     financial year, written under the page's own key so its Drive file
     carries what this page showed — not merely pointers into the Cashbook.
     Deterministic (no timestamps inside) so unchanged books produce an
     identical string and nothing is re-uploaded for nothing.
     ------------------------------------------------------------------------ */
  function snapshotValue(year) {
    var statement = buildStatement(year);
    return JSON.stringify({
      schema: 1,
      fy: year.fy,
      statement: statement,
      quarters: year.quarters.map(function (c) {
        return { q: c.q, label: c.label, subvention: c.subvention, otherIncome: c.otherIncome,
                 income: c.income, salary: c.salary, other: c.other, expenditure: c.expenditure,
                 byCategory: c.byCategory };
      }),
      txnCount: year.txnCount,
      voidedCount: year.voidedCount
    });
  }

  return {
    START_FY_YEAR: START_FY_YEAR,
    QUARTERS: QUARTERS,
    DEFAULT_SECTIONS: DEFAULT_SECTIONS,
    SUBVENTION_CATEGORY: SUBVENTION_CATEGORY,
    fyLabel: fyLabel,
    fyStartYear: fyStartYear,
    fyForDate: fyForDate,
    quarterBlobs: quarterBlobs,
    listYears: listYears,
    classify: classify,
    sectionResolver: sectionResolver,
    isSalarySection: isSalarySection,
    buildYear: buildYear,
    buildStatement: buildStatement,
    snapshotValue: snapshotValue,
    round2: round2
  };
});
