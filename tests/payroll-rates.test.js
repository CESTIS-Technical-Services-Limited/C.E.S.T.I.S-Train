/* Payroll's statutory rates come from the Centre's own repository.

   "Fetch Current Rates" on the Payroll page used to read rates.json from a
   personal GitHub repository's main branch, or a public Drive file (audit
   OPS-12). payroll-rates.json now lives in this repository (today's values,
   copied from that rates.json on 30 October 2026) and is read first; the two
   old places stay as fallbacks.

   The owner updates the file on GitHub (docs/UPGRADE-2026-10.md, "Updating the
   payroll rates"), and the GitHub checks run this test on that change: it
   fails if the file no longer parses, a rate is missing or not a number, or a
   percentage is outside 0–100 — before anyone fetches a broken rate.

   Run: node tests/payroll-rates.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ---------- 1. The file ---------- */
console.log('payroll-rates.json is a complete, sensible rates list');
let data = null;
try { data = JSON.parse(read('payroll-rates.json')); } catch (e) { assert(false, 'payroll-rates.json parses as JSON: ' + e.message); }
const R = (data && data.rates) || {};
const PERCENT = ['nisEmp', 'nisEr', 'edTaxEmp', 'edTaxEr', 'nhtEmp', 'nhtEr', 'heartEr', 'incomeTax', 'incomeTaxHigher'];
const AMOUNTS = ['nisCeilingMonthly', 'higherBracketAnnual', 'annualThreshold'];
PERCENT.forEach(k => assert(typeof R[k] === 'number' && isFinite(R[k]) && R[k] >= 0 && R[k] <= 100, 'rates.' + k + ' is a percentage from 0 to 100 (got ' + JSON.stringify(R[k]) + ')'));
AMOUNTS.forEach(k => assert(typeof R[k] === 'number' && isFinite(R[k]) && R[k] > 0, 'rates.' + k + ' is an amount above 0 (got ' + JSON.stringify(R[k]) + ')'));
assert(Object.keys(R).every(k => PERCENT.indexOf(k) !== -1 || AMOUNTS.indexOf(k) !== -1), 'no rate the page does not know (' + Object.keys(R).filter(k => PERCENT.indexOf(k) === -1 && AMOUNTS.indexOf(k) === -1).join(', ') + ')');
assert(data && /^\d{4}\/\d{4}$/.test(String(data.fiscalYear)), 'it names its fiscal year, like 2025/2026');
assert(data && /^\d{4}-\d{2}-\d{2}$/.test(String(data.effectiveDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(data.lastUpdated)), 'and its effective and last-updated dates (YYYY-MM-DD)');
assert(R.incomeTaxHigher >= R.incomeTax && R.higherBracketAnnual > R.annualThreshold, 'the higher income-tax band is above the standard one');

/* ---------- 2. The page reads it first ---------- */
console.log('The Payroll page reads it first, the old places after');
const P = read('Staff.Payslip.html');
const fieldMap = /const fieldMap = \{([\s\S]*?)\};/.exec(P);
PERCENT.concat(AMOUNTS).forEach(k => assert(fieldMap && new RegExp(':\\s*r\\.' + k + '\\b').test(fieldMap[1]), 'the page fills a field from rates.' + k));
assert(/const SITE_RATES_URL = 'payroll-rates\.json';/.test(P), 'the page knows the site\'s own rates file');
const order = /const sources = \[\{ name: '[^']+', url: SITE_RATES_URL \}\];[\s\S]*?GDRIVE_RATES_FILE_ID[\s\S]*?sources\.push\(\{ name: '[^']+', url: GITHUB_RATES_URL \}\);/.test(P);
assert(order, 'it tries the site\'s own file first, then the Drive copy, then the first published list');
assert(/const GDRIVE_RATES_FILE_ID = CESTIS_CONFIG\.files\.payrollRates;/.test(P), 'the Drive copy\'s id comes from cestis-config.js');
// Today's values are the page's own defaults too (nothing changed by the move).
const dflt = /settings:\{([\s\S]*?)\}/.exec(P.slice(P.indexOf('function defaultData(){')));
PERCENT.concat(AMOUNTS).forEach(k => {
  const m = dflt && new RegExp('\\b' + k + ':([0-9.]+)').exec(dflt[1]);
  assert(m && Number(m[1]) === R[k], 'today\'s ' + k + ' (' + R[k] + ') is the page\'s built-in default too');
});

/* ---------- 3. Edits on GitHub never fail the Offline System check ---------- */
const build = require('../tools/build-offline.js');
assert(build.EXCLUDE.some(rx => rx.test('payroll-rates.json')) && !build.plan().has('payroll-rates.json'),
  'the Offline System does not copy it, so an edit on GitHub never makes it "out of date"');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
