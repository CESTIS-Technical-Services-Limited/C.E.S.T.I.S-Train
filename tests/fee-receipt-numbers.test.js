/* Automatic receipt numbers on School Fee: R-2026/27-0001.

   What happened (office audit OF-5): receipt numbers were typed by hand and
   never checked — "R-0412" was accepted for two trainees, and a blank number
   became "PAY1793221585525", the payment's internal id.

   The owner's decision (30 October 2026): "R-", the financial year as the
   School Fee page defines it (April to March), then a 4-digit sequence per
   financial year. What this pins:
     1  CESTISCore.receiptNumbers (both builds): the year tag, the next number
        (one past the highest of that year, whatever its letters; a number
        typed from a paper book in the same form counts; never one already
        used), when this computer's letters are added (nothing checked with
        the other office computers in the last two minutes, or a payment of
        its own not yet sent), and the letters themselves;
     2  the page's own code (School.Fee.html): the next number is filled in;
        a number the clerk typed is kept; a blank one gets the next automatic
        number; earlier receipts are never renumbered; the number carries the
        letters exactly when the rule says so;
     3  the letters are this computer's alone: never in a backup or another
        device's copy.

   Run: node tests/fee-receipt-numbers.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');

[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], C = pair[1], R = C.receiptNumbers;
  console.log('\n[' + where + '] The financial year, as School Fee defines it');
  assertEq(R.fyTag('2026/2027'), '2026/27', '"2026/2027" is written 2026/27');
  assertEq(R.fyTag('nonsense'), '', 'anything else is no year');
  assertEq(R.fyOfDate('2026-10-30'), '2026/2027', 'October 2026 is in 2026/27');
  assertEq(R.fyOfDate('2026-04-01'), '2026/2027', '1 April starts the year');
  assertEq(R.fyOfDate('2027-03-31'), '2026/2027', '31 March ends it');
  assertEq(R.fyOfDate('2026-03-31'), '2025/2026', 'the day before 1 April is last year');
  assertEq(R.fyOfDate('2026-10-30'), C.deriveQuarter('2026-10-30').fy, 'the same rule the page\'s present year uses (CESTISCore.deriveQuarter)');

  console.log('[' + where + '] The next number');
  assertEq(R.nextNumber([], '2026-10-30'), 'R-2026/27-0001', 'the first of the year');
  const paid = [{ receiptNumber: 'R-2026/27-0041' }, { receiptNumber: 'r-2026/27-0042-k7' }, { receiptNumber: 'R-2025/26-0300' }, { receiptNumber: 'R-0412' }, { receiptNumber: '' }, { id: 'PAY1793221585525' }];
  assertEq(R.nextNumber(paid, '2026-10-30'), 'R-2026/27-0043', 'one past the highest of the year, whatever its letters or capitals');
  assertEq(R.nextNumber(paid, '2027-04-02'), 'R-2027/28-0001', 'a new financial year starts again at 0001');
  assertEq(R.nextNumber(paid, '2026-01-15'), 'R-2025/26-0301', 'a payment dated in last year continues last year\'s');
  assertEq(R.nextNumber(paid, '2026-10-30', { suffix: 'k7' }), 'R-2026/27-0043-K7', 'with this computer\'s letters');
  assertEq(R.nextNumber([{ receiptNumber: 'R-2026/27-0009' }], '2026-10-30'), 'R-2026/27-0010', 'a number typed from a paper book in the same form counts');
  assertEq(R.nextNumber([{ receiptNumber: 'R-2026/27-9999' }], '2026-10-30'), 'R-2026/27-10000', 'past 9999 it goes on');
  assertEq(R.parse('R-2026/27-0042-B'), { fy: '2026/27', seq: 42, suffix: 'B' }, 'read back');
  assertEq(R.parse('PAY1793221585525'), null, 'an internal id is not a receipt number');
  assertEq(R.format('2026/27', 7, ''), 'R-2026/27-0007', 'four digits');

  console.log('[' + where + '] When this computer\'s letters are added');
  const now = Date.parse('2026-10-30T15:00:00Z');
  assert(R.needsSuffix({ checkedAt: 0, nowMs: now }) === true, 'never checked with the other computers: letters');
  assert(R.needsSuffix({ checkedAt: now - 30e3, nowMs: now }) === false, 'checked 30 seconds ago, nothing unsent: no letters');
  assert(R.needsSuffix({ checkedAt: now - 3 * 60e3, nowMs: now }) === true, 'checked 3 minutes ago: letters');
  assert(R.needsSuffix({ checkedAt: now - 30e3, nowMs: now, unsent: true }) === true, 'a payment of its own not yet sent: letters');
  assert(R.needsSuffix(null) === true, 'nothing known: letters');
  assert(R.needsSuffix({ checkedAt: now + 3600e3, nowMs: now }) === true, 'a check dated in the future (a wrong clock): letters');
  assertEq(R.deviceSuffix('K7'), 'K7', 'this computer keeps its letters');
  assertEq(R.deviceSuffix('k7'), 'K7', 'in capitals');
  const made = R.deviceSuffix('', () => 0.999);
  assert(/^[A-HJ-NP-Z2-9]{2}$/.test(made), 'new letters are two of A–Z and 2–9 without I, O, 0 or 1: ' + made);
  assert(/^[A-HJ-NP-Z2-9]{2}$/.test(R.deviceSuffix('I0')), 'letters that could be misread are replaced');
});

/* ---------- 2. The page ---------- */
const Core = require('../cestis-core.js');
const SRC = fs.readFileSync(path.join(ROOT, 'School.Fee.html'), 'utf8');
function fn(name) {
  const s = SRC.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('School.Fee.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = SRC.indexOf('{', s); i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (!d) return SRC.slice(s, i + 1); } }
  throw new Error(name);
}
function page(opts) {
  opts = opts || {};
  const el = {};
  const set = (id, v) => { el[id] = { value: v, style: {}, dataset: {}, textContent: '' }; };
  set('paymentStudentId', 'S3'); set('paymentAmount', '3000'); set('paymentDate', opts.date || '2026-10-20'); set('paymentMethod', 'Cash');
  set('paymentTerm', 'Term 1'); set('receiptNumber', opts.receipt || ''); set('paymentNotes', ''); set('studentPaymentInfo', ''); set('receiptNumberHint', '');
  const ls = { cestisReceiptDevice: opts.letters || 'K7' };
  const status = [{ file: 'CESTIS_School_Fees.json', connected: true, lastPush: opts.lastPush || '', lastPull: '' }];
  const sb = {
    console, Date, Math, JSON, String, parseFloat, Promise, setTimeout, CESTISCore: Core,
    document: { getElementById: id => el[id] || null },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } },
    CESTISStore: { getItem: () => null },
    window: { CESTISPageCloud: { status: () => status, saveNow() { sb.sentNow++; } } },
    students: [{ id: 'S3', name: 'Cara Dunn', skillArea: 'Welding', tuitionFee: 30000, totalPaid: 0, balance: 30000 }],
    payments: (opts.paid || []).slice(), receipts: [], saves: 0, sentNow: 0, asked: [],
    alert() {}, confirm(m) { sb.asked.push(m); return true; }, feeCourseDurationInfo: () => null, feePaymentStatus: () => 'Partial Payment',
    generateReceipt(p) { sb.receipts.push(p.receiptNumber); }, clearTraineeSearch() {}, renderChosenTrainee() {}, feeRecordYearNote: () => '',
    renderPaymentsTable() {}, renderStudentsTable() {}, updateDashboard() {}, feeToastWithYearNote(m) { sb.toast = m; }
  };
  sb.window.localStorage = sb.localStorage;
  sb.CESTISPageCloud = sb.window.CESTISPageCloud;
  sb.saveData = () => { sb.saves++; };
  sb.el = el; sb.ls = ls; sb.status = status;
  vm.createContext(sb);
  vm.runInContext('var _feeReceiptCheckedAt = ' + (opts.checkedAt || 0) + ', _feeLastOwnPaymentAt = 0;\n' +
    ['feeReceiptDeviceLetters', 'feeReceiptSyncState', 'feeNextReceiptNumber', 'feeSuggestReceipt', 'feeReceiptTyped', 'feeReceiptNumberConfirmed', 'recordPayment'].map(fn).join('\n'), sb);
  return sb;
}
console.log('\n[School.Fee.html] The next number is filled in');
{
  const paid = [{ id: 'P1', receiptNumber: 'R-2026/27-0041', studentName: 'Akeem Williams', date: '2026-10-01' }, { id: 'P2', receiptNumber: '', studentName: 'Old Payment' }];
  const sb = page({ paid, checkedAt: Date.now() - 10e3 });
  sb.feeSuggestReceipt();
  assertEq(sb.el.receiptNumber.value, 'R-2026/27-0042', 'checked with the other computers a moment ago: the next number, no letters');
  assert(/filled in for you/.test(sb.el.receiptNumberHint.textContent) && /paper receipt book/.test(sb.el.receiptNumberHint.textContent), 'and the clerk is told they may type a paper book\'s number instead');
  sb.recordPayment();
  assertEq(sb.payments[2].receiptNumber, 'R-2026/27-0042', 'the payment carries it');
  assertEq(sb.receipts, ['R-2026/27-0042'], 'and so does the receipt PDF');
  assertEq(sb.asked.length, 0, 'no question for an automatic number');
  assertEq(sb.payments[1].receiptNumber, '', 'an earlier receipt without a number is never renumbered');
  assertEq(sb.payments[0].receiptNumber, 'R-2026/27-0041', 'nor one with a number');
  assert(sb.sentNow === 1, 'the new payment is sent to the other office computers at once');
  assertEq(sb.el.receiptNumber.value, 'R-2026/27-0043-K7', 'the next suggestion carries this computer\'s letters: its payment is not sent yet');
  assert(/-K7, this computer's letters/.test(sb.el.receiptNumberHint.textContent), 'and says why, in plain words');
  sb.status[0].lastPush = new Date(Date.now() + 1000).toISOString();
  sb.el.receiptNumber.value = sb.el.receiptNumber.dataset.auto;
  sb.feeSuggestReceipt();
  assertEq(sb.el.receiptNumber.value, 'R-2026/27-0043', 'once it has been sent (and the check is fresh), no letters');
}
console.log('[School.Fee.html] Without a recent check, this computer\'s letters');
{
  const sb = page({ paid: [{ id: 'P1', receiptNumber: 'R-2026/27-0041' }], checkedAt: 0, letters: 'B3' });
  sb.el.receiptNumber.value = '';
  sb.recordPayment();
  assertEq(sb.payments[1].receiptNumber, 'R-2026/27-0042-B3', 'a blank number gets the next automatic one, with the letters (never "PAY…")');
  assert(sb.payments[1].receiptNumber.indexOf('PAY') === -1, 'no internal id as a receipt number');
  const sb2 = page({ checkedAt: Date.now() - 5 * 60e3, letters: '' });
  sb2.feeSuggestReceipt();
  assert(/^R-2026\/27-0001-[A-HJ-NP-Z2-9]{2}$/.test(sb2.el.receiptNumber.value), 'checked five minutes ago: letters, made for this computer the first time: ' + sb2.el.receiptNumber.value);
  assert(/^[A-HJ-NP-Z2-9]{2}$/.test(sb2.ls.cestisReceiptDevice), 'and kept on this computer for next time');
}
console.log('[School.Fee.html] A number typed from a paper receipt book is kept');
{
  const sb = page({ paid: [{ id: 'P1', receiptNumber: '004512', studentName: 'Brianna Grant', date: '2026-10-02' }], checkedAt: Date.now() });
  sb.feeSuggestReceipt();
  sb.el.receiptNumber.value = '004513';
  sb.feeReceiptTyped();
  assert(/used as typed/.test(sb.el.receiptNumberHint.textContent), 'the clerk is told their number is used as typed');
  sb.feeSuggestReceipt();
  assertEq(sb.el.receiptNumber.value, '004513', 'a later suggestion never overwrites it');
  sb.recordPayment();
  assertEq(sb.payments[1].receiptNumber, '004513', 'recorded as typed');
  const sb2 = page({ paid: [{ id: 'P1', receiptNumber: '004512', studentName: 'Brianna Grant', date: '2026-10-02' }], checkedAt: Date.now(), receipt: '004512' });
  sb2.recordPayment();
  assertEq(sb2.asked.length, 1, 'a typed number another payment carries is still asked about (the warning stays)');
}
console.log('[School.Fee.html] The page is wired');
assert(/<input type="text" id="receiptNumber" oninput="feeReceiptTyped\(\)"/.test(SRC), 'typing a number is noticed');
assert(/id="paymentDate" required onchange="feeSuggestReceipt\(\)"/.test(SRC), 'a changed payment date gives that year\'s number');
assert(/id="recordPaymentBtn" onclick="recordPaymentClicked\(\)"/.test(SRC), 'Record Payment checks the other computers first');
assert(/moduleId === 'payments'\) \{[\s\S]{0,120}feeReceiptCheckNow\(\)/.test(SRC), 'opening Payments checks and suggests');
assert(/if \(studentId\) feeReceiptCheckNow\(\);/.test(fn('loadStudentPaymentInfo')), 'so does choosing the trainee');
const rc = fn('recordPaymentClicked');
assert(/if \(!auto\) \{ recordPayment\(\); return; \}/.test(rc) && /feeReceiptCheckNow\(\)\.then/.test(rc), 'a typed number is recorded at once; an automatic one after the check');

/* ---------- 3. This computer's letters stay on this computer ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  assert(pair[1].isSnapshotableKey('cestisReceiptDevice') === false, pair[0] + ': never in a backup');
});
['cestis-page-cloud.js', 'Offline System/cestis-page-cloud.js'].forEach(function (f) {
  assert(/DEVICE_KEYS = \[[^\]]*'cestisReceiptDevice'/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ': never in another computer\'s copy');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
