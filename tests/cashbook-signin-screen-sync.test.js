/* A sync that lands while the Cashbook sits at its sign-in screen leaves the
   Centre's books exactly as they are.

   What happened (found by tests/browser/upgrade-no-data-loss.js, Offline
   System scenario): the Cashbook reads the books from storage only at
   sign-in (loadFromStorage). Until then memory holds the page's start-up
   values — an opening balance of 237948.69, no transactions. A page-cloud
   sync that arrived while the page was open at its sign-in screen called
   cbOnPageCloudRestore(), which folded the stored quarter into those
   start-up values and saved them: the active quarter's opening balance
   (793,501.40 at the test Centre) was replaced by 237,948.69, a default
   budget line was written into its budget, and the Centre's server and every
   device took the changed books. Since the page-cloud push now tells the
   page about what it merged (onRestore), any save on the Centre's network
   with the Cashbook open at sign-in did it.

   Pinned here, with the real functions from CESTIS.Cashbook.html and the
   real CESTISCore.cashbook:
     - at the sign-in screen, a page-cloud restore changes nothing stored;
     - a cloud merge of the active quarter goes into storage, never into the
       start-up values in memory;
     - no save writes the start-up values;
     - after sign-in the page reads the books and saves as before.

   Run: node tests/cashbook-signin-screen-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'CESTIS.Cashbook.html'), 'utf8');
function extractFunction(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('CESTIS.Cashbook.html no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}
function extractStatement(startsWith) {
  const at = SRC.indexOf('\n' + startsWith);
  if (at < 0) throw new Error('CESTIS.Cashbook.html no longer has ' + startsWith);
  let depth = 0, i = at + 1;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) break;
  }
  return SRC.slice(at, i + 1);
}
// The page's start-up opening balance, exactly as it declares it.
const STARTUP_OB = Number((/\nlet OPENING_BALANCE = ([\d.]+);/.exec(SRC) || [])[1]);
// The page's "books loaded" flag, if it has one (a page without it fails below).
const FLAG = (/\nvar cbBooksLoaded = false;/.exec(SRC) || [''])[0];

const FNS = ['getQuarterMeta', 'getQuarterKey', 'getCurrentQuarterKey', 'getMonth', 'getBudgetQuarterKey',
  'getCurrentBudgetQuarterKey', 'sanitizeTransactionsForQuarter', 'sanitizeAllQuarterlyStorage', 'cbRebaselineActive',
  'cbStampActive', 'cbActiveBlob', 'saveToStorage', 'cbRebaselineBudget', 'cbStampBudget', 'saveQuarterBudget',
  'loadFromStorage', 'loadQuarterData', 'loadQuarterBudget', 'cbMergeQuarterKey', 'cbMergeBudgetKey', 'cbOnPageCloudRestore'];

const KEY = 'cestis_quarter_2026/2027_Q3', BKEY = 'cestis_budget_2026/2027_Q3';
const BOOKS = { openingBalance: 793501.4, transactions: [
  { id: 100, uid: 'T-sub', date: '2026-10-03', details: 'HEART/NSTA subvention', deposit: 425000, payment: 0, category: 'Subvention' },
  { id: 101, uid: 'T-chq', date: '2026-10-09', cheque: '9301', details: 'Industrial Gases', deposit: 0, payment: 62000, category: 'Training Material' }],
  deletedTxnIds: [] };
const BUDGET = { budget: { 'Training Material': 150000 }, sections: {} };

function makePage() {
  const backing = { [KEY]: JSON.stringify(BOOKS), [BKEY]: JSON.stringify(BUDGET),
    cestis_active_quarter: JSON.stringify({ fy: '2026/2027', q: 3 }) };
  const store = { getItem: k => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } };
  const sb = {
    CESTISCore: Core, CESTISStore: store, console: { log() {}, warn() {}, error() {} },
    // The page's start-up values (memory before sign-in reads the books).
    transactions: [], deletedTxnIds: [], deletedTxnUids: [], OPENING_BALANCE: STARTUP_OB, OPENING_BALANCE_AT: '', nextId: 100,
    BUDGET: {}, BUDGET_LINE_SECTIONS: {}, BUDGET_AT: {}, DEFAULT_BUDGET: {},
    _cbStampIndex: null, _cbStampKey: null, _cbObBase: null, _cbBudgetBase: null, _cbBudgetBaseKey: null,
    activeFY: '2026/2027', activeQ: 3, refreshAll() {}, updateQuarterUI() {},
    Date, Object, Array, String, JSON, Math, Number, Set, isNaN, parseInt, parseFloat
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext([FLAG, extractStatement('const QUARTER_META = '), extractStatement('const MONTH_KEYS = ')].concat(FNS.map(extractFunction)).join('\n\n'), sb);
  return { sb, backing };
}

assert(STARTUP_OB > 0, 'the page still declares its start-up opening balance (' + STARTUP_OB + ')');

console.log('At the sign-in screen, a sync\'s restore changes nothing stored');
let p = makePage();
vm.runInContext('cbOnPageCloudRestore();', p.sb);
assertEq(JSON.parse(p.backing[KEY]).openingBalance, 793501.4, 'the quarter\'s opening balance is the Centre\'s, not the start-up value');
assertEq(p.backing[KEY], JSON.stringify(BOOKS), 'the quarter is exactly as stored');
assertEq(p.backing[BKEY], JSON.stringify(BUDGET), 'and so is its budget');

console.log('A cloud merge of the active quarter goes into storage, not into the start-up values');
p = makePage();
const cloud = JSON.parse(JSON.stringify(BOOKS));
cloud.transactions.push({ id: 102, uid: 'T-new', date: '2026-10-15', details: 'Lunch', deposit: 0, payment: 8000, category: 'Lunch',
  updatedAt: '2026-10-15T10:00:00.000Z' });
vm.runInContext('cbMergeQuarterKey(' + JSON.stringify(KEY) + ', ' + JSON.stringify(cloud) + ', null);', p.sb);
const merged = JSON.parse(p.backing[KEY]);
assertEq(merged.openingBalance, 793501.4, 'the opening balance stays the Centre\'s');
assertEq(merged.transactions.map(t => t.uid).sort().join(','), 'T-chq,T-new,T-sub', 'the cheque that arrived is added to the stored quarter');
assertEq(p.sb.transactions.length, 0, 'memory is left for sign-in to read');

console.log('No save writes the start-up values');
p = makePage();
vm.runInContext('saveToStorage(); saveQuarterBudget();', p.sb);
assertEq(p.backing[KEY], JSON.stringify(BOOKS), 'saveToStorage at the sign-in screen writes nothing');
assertEq(p.backing[BKEY], JSON.stringify(BUDGET), 'nor does saveQuarterBudget');

console.log('After sign-in the page reads the books and saves as before');
p = makePage();
vm.runInContext('loadFromStorage(); loadQuarterBudget();', p.sb);
assertEq(p.sb.OPENING_BALANCE, 793501.4, 'sign-in reads the Centre\'s opening balance');
assertEq(p.sb.transactions.length, 2, 'and its transactions');
vm.runInContext('OPENING_BALANCE = 800000; saveToStorage();', p.sb);
assertEq(JSON.parse(p.backing[KEY]).openingBalance, 800000, 'a Balance B/F changed after sign-in is saved');
vm.runInContext('cbOnPageCloudRestore();', p.sb);
assertEq(JSON.parse(p.backing[KEY]).openingBalance, 800000, 'and a later restore keeps it');

console.log('Summary: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
