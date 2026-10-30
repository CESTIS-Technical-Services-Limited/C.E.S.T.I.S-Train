/* A receipt number already given is asked about before it is used again.
   Run: node tests/fee-receipt-duplicate.test.js

   What used to go wrong (office audit OF-5): receipt numbers are typed by
   hand on School Fee, and "R-0412" was accepted for two different trainees
   without a word — two receipt PDFs with the same number.

   Pinned here: CESTISCore.receiptNumbers.usedBy (trimmed, any capitals; the
   payment being edited does not clash with itself; a blank number is never
   compared) and the page's own recordPayment / savePaymentEdit read from
   School.Fee.html: a number another payment carries brings up "Receipt R-0412
   is already used for <name> on <date>. Use it again?"; Cancel records
   nothing and keeps the form as typed; OK records it (one receipt may cover
   two trainees). How blank receipt numbers are generated is unchanged. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const RN = Core.receiptNumbers;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const PAID = [
  { id: 'PAY1', studentId: 'S1', studentName: 'Ann Brown', date: '2026-10-12', amount: 5000, receiptNumber: 'R-0412' },
  { id: 'PAY2', studentId: 'S2', studentName: 'Bo Clarke', date: '2026-10-13', amount: 5000, receiptNumber: '' }
];

console.log('The rule');
{
  assert(RN.usedBy(PAID, ' r-0412 ', null) === PAID[0], 'the same number, whatever the spaces and capitals, is found');
  assert(RN.usedBy(PAID, 'R-0412', 'PAY1') === null, 'a payment being edited does not clash with itself');
  assert(RN.usedBy(PAID, '', null) === null && RN.usedBy(PAID, '   ', null) === null, 'a blank number is never compared');
  assert(RN.usedBy(PAID, 'R-0413', null) === null, 'a new number is fine');
  assert(RN.question('R-0412', PAID[0]) === 'Receipt R-0412 is already used for Ann Brown on 2026-10-12. Use it again?', 'the question names who and when');
}

const src = fs.readFileSync(path.join(__dirname, '..', 'School.Fee.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('School.Fee.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
function feePage(answer, form) {
  const el = {};
  const set = (id, v) => { el[id] = { value: v, style: {} }; };
  set('paymentStudentId', 'S3'); set('paymentAmount', '3000'); set('paymentDate', '2026-10-20'); set('paymentMethod', 'Cash');
  set('paymentTerm', 'Term 1'); set('receiptNumber', form.receipt); set('paymentNotes', 'paid by parent'); set('studentPaymentInfo', '');
  set('editPaymentAmount', '5000'); set('editPaymentDate', '2026-10-13'); set('editPaymentMethod', 'Cash'); set('editPaymentTerm', 'Term 1');
  set('editReceiptNumber', form.editReceipt || ''); set('editPaymentNotes', '');
  const sb = {
    console, Date, Math, JSON, String, parseFloat, CESTISCore: Core,
    document: { getElementById: id => el[id] || null },
    students: [{ id: 'S3', name: 'Cara Dunn', skillArea: 'Welding', tuitionFee: 30000, totalPaid: 0, balance: 30000 },
      { id: 'S2', name: 'Bo Clarke', skillArea: 'Welding', tuitionFee: 30000, totalPaid: 5000, balance: 25000 }],
    payments: JSON.parse(JSON.stringify(PAID)), editingPaymentId: 'PAY2',
    asked: [], saves: 0, receipts: 0,
    alert() {}, feeCourseDurationInfo: () => null, feePaymentStatus: () => 'Partial Payment',
    generateReceipt() { sb.receipts++; }, clearTraineeSearch() {}, renderChosenTrainee() {}, feeRecordYearNote: () => '',
    renderPaymentsTable() {}, renderStudentsTable() {}, updateDashboard() {}, feeToastWithYearNote() {}, closeModal() {}, showToast() {},
    // Automatic receipt numbers (OF-5): nothing checked with the other computers here.
    feeSuggestReceipt() {}, feeNextReceiptNumber: date => Core.receiptNumbers.nextNumber(sb.payments, date, { suffix: 'K7' })
  };
  sb.saveData = () => { sb.saves++; };
  sb.confirm = m => { sb.asked.push(m); return answer; };
  sb.el = el;
  vm.createContext(sb);
  vm.runInContext(fn('feeReceiptNumberConfirmed') + fn('recordPayment') + fn('savePaymentEdit'), sb);
  return sb;
}

console.log('Recording a payment with a number already used');
{
  const sb = feePage(false, { receipt: 'r-0412' });
  sb.recordPayment();
  assert(sb.asked.length === 1 && sb.asked[0] === 'Receipt r-0412 is already used for Ann Brown on 2026-10-12. Use it again?', 'it asks: ' + sb.asked[0]);
  assert(sb.payments.length === 2 && sb.saves === 0 && sb.receipts === 0, 'Cancel: nothing is recorded, no receipt is made');
  assert(sb.el.receiptNumber.value === 'r-0412' && sb.el.paymentAmount.value === '3000' && sb.el.paymentNotes.value === 'paid by parent', 'and the form keeps everything typed');
}
{
  const sb = feePage(true, { receipt: 'R-0412' });
  sb.recordPayment();
  assert(sb.payments.length === 3 && sb.payments[2].receiptNumber === 'R-0412' && sb.saves === 1, 'OK: recorded with that number (one receipt may cover two trainees)');
}
{
  const sb = feePage(false, { receipt: 'R-0413' });
  sb.recordPayment();
  assert(sb.asked.length === 0 && sb.payments.length === 3, 'a new number: no question, recorded');
  const sb2 = feePage(false, { receipt: '' });
  sb2.recordPayment();
  // (Since OF-5's automatic numbers: a blank number gets the next one, never "".)
  assert(sb2.asked.length === 0 && sb2.payments.length === 3 && sb2.payments[2].receiptNumber === 'R-2026/27-0001-K7', 'a blank number: no question, and the next automatic number: ' + sb2.payments[2].receiptNumber);
}

console.log('Editing a payment to a number another one carries');
{
  const sb = feePage(false, { receipt: '', editReceipt: 'R-0412' });
  sb.savePaymentEdit();
  assert(sb.asked.length === 1 && sb.payments[1].receiptNumber === '' && sb.saves === 0, 'it asks; Cancel leaves the payment as it was');
  const sb2 = feePage(false, { receipt: '', editReceipt: '' });
  sb2.payments[1].receiptNumber = 'R-0500';
  sb2.el.editReceiptNumber.value = 'R-0500';
  sb2.savePaymentEdit();
  assert(sb2.asked.length === 0 && sb2.saves === 1, 'keeping its own number is not a clash');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
