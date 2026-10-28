/* Invoices, quotes and purchase orders: a save never throws away a document
   another device saved, a deleted one stays deleted, and two new documents
   never share a number.

   The page read its list once, when it opened, and wrote it back whole on
   every save. A cloud pull that landed after that (the first one, at page
   open, included) was overwritten by the next save — and that save, stamped
   as the newer edit, pushed the loss to Drive. PC B's invoice #12551 for SRHA
   vanished from both machines, and PC A's new invoice took the same number.
   (finance-14)

   Driven through the real finance-docs.js (shared by both builds) with a
   permissive DOM stub.

   Run: node tests/finance-docs-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
const ROOT = path.join(__dirname, '..');
const LIBS = ['finance-docs.js', 'Offline System/finance-docs.js'];

function fakeEl() {
  const el = { innerHTML: '', value: '', textContent: '', style: {}, checked: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {}, remove() {} };
  el.querySelector = () => fakeEl();
  el.querySelectorAll = () => [];
  return el;
}

function load(file, store0) {
  const backing = Object.assign({}, store0 || {});
  const store = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = String(v); }, removeItem: k => { delete backing[k]; } };
  const toasts = [];
  const sb = {
    CESTISCore: Core, CESTISStore: store, console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [], createElement: () => fakeEl(), body: fakeEl() },
    confirm: () => true, alert() {}, setTimeout: () => 0, clearTimeout() {}, scrollTo() {}, location: { href: '' },
    Date, Object, Array, String, JSON, Math, Number, Promise, isNaN, parseFloat, parseInt
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sb);
  sb.FinanceDoc.init({ storageKey: 'cestis_finance_invoices', numberSeed: 12551, dueDays: 15, hasTemplates: true, hasStatus: false,
    canConvert: false, labels: { title: 'INVOICE', docWord: 'invoice', noLabel: 'INVOICE NO', dateLabel: 'D', dueLabel: 'DD' } });
  sb._backing = backing;
  return sb;
}
const numbers = b => JSON.parse(b.cestis_finance_invoices || '[]').map(d => d.number).sort().join(',');

LIBS.forEach(file => {
  console.log('\n=== ' + file + ' ===');
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert(/function mergeStored\(\)/.test(src), file + ': the stored list is folded in before every write');

  console.log('A document pulled after the page opened survives the next save, and numbers do not collide');
  const pg = load(file, {});
  // PC B's invoice arrives in storage AFTER this page loaded its list.
  pg._backing.cestis_finance_invoices = JSON.stringify([{ id: 'FD-B', number: '12551', updatedAt: '2026-10-20T09:00:00.000Z', items: [] }]);
  pg.FinanceDoc.saveDoc();
  const stored = JSON.parse(pg._backing.cestis_finance_invoices);
  assert(stored.some(d => d.id === 'FD-B'), file + ': PC B\'s invoice is still stored');
  assert(stored.length === 2 && numbers(pg._backing) === '12551,12552', file + ': and the new one took the next number (got ' + numbers(pg._backing) + ')');

  console.log('A deleted document stays deleted when a stale copy is folded in');
  pg.FinanceDoc.deleteDoc('FD-B');
  assert(JSON.parse(pg._backing.cestis_finance_invoices_deleted || '[]').indexOf('FD-B') !== -1, file + ': the deletion is written down');
  pg._backing.cestis_finance_invoices = JSON.stringify(stored);   // a stale pull still holding FD-B
  pg.FinanceDoc.reload();
  assert(!JSON.parse(pg._backing.cestis_finance_invoices).some(d => d.id === 'FD-B'), file + ': FD-B does not come back');

  console.log('A newer copy saved elsewhere replaces the older one here');
  const mine = JSON.parse(pg._backing.cestis_finance_invoices)[0];
  pg._backing.cestis_finance_invoices = JSON.stringify([Object.assign({}, mine, { billedTo: 'Changed elsewhere', updatedAt: '2099-01-01T00:00:00.000Z' })]);
  pg.FinanceDoc.reload();
  assert(JSON.parse(pg._backing.cestis_finance_invoices)[0].billedTo === 'Changed elsewhere', file + ': the later edit wins');
});

['Finance.Invoice.html', 'Finance.Quote.html', 'Finance.Purchase.Order.html'].forEach(page => {
  const t = fs.readFileSync(path.join(ROOT, page), 'utf8');
  assert(/onRestore: function \(\) \{ try \{ if \(window\.FinanceDoc && FinanceDoc\.reload\) FinanceDoc\.reload\(\);/.test(t),
    page + ': a page-cloud pull is folded into the list on screen');
  assert(/_deleted'\]/.test(t), page + ': and its deletions travel with the page\'s Drive file');
});
['cestis_finance_invoices_deleted', 'cestis_finance_quotes_deleted', 'cestis_finance_pos_deleted'].forEach(k => {
  assert(Core.isTombstoneKey(k), k + ' unions like every other deletion list');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
