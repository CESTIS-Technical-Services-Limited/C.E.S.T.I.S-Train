/* MegaData steps 3–4 — DAL + projections: end-to-end command flow, folds,
   convergence across devices, crash/resume, stale-basis, adjudication.
   Run: node tests/megadata-dal.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }

(async function main() {
  const broker = createBroker();
  const A = await createDAL({ adapter: MemoryAdapter(), broker, source: 'test-A', actor: { name: 'Clerk A', role: 'admin', device: 'dev_A' } });

  section('End-to-end: programme → intake → person → enrol → schedule → charge → pay');
  const { programmeId } = await A.defineProgramme({ name: 'WELDING L2', level: 'L2' });
  const { intakeId } = await A.openIntake(programmeId, { label: 'Welding L2 2026/27', start: '2026-09-01', fiscalYear: '2026/2027' });
  const rp = await A.registerPerson({ names: { full: 'Casey Example' }, dob: '2001-05-14' });
  const { enrolmentId } = await A.enrol(rp.personId, intakeId, { enrolledAt: '2026-09-01' });
  await A.setFeeSchedule(intakeId, { totalMinor: 2800000, terms: [{ no: 1, amountMinor: 1400000 }, { no: 2, amountMinor: 1400000 }] });
  await A.assessCharge(enrolmentId, { termNo: 1, amountMinor: 1400000 });
  await A.assessCharge(enrolmentId, { termNo: 2, amountMinor: 1400000 });
  const p1 = await A.recordPayment(enrolmentId, { amountMinor: 500000, method: 'cash', date: '2026-09-02' });
  eq(A.getBalance(enrolmentId), 2300000, 'balance is a fold: 2,800,000 charged − 500,000 paid');
  eq(A.getLedger(enrolmentId).status, 'partial', 'status derives from the fold');
  eq(p1.receiptNo, null, 'offline payment has no receipt number yet (broker assigns)');
  ok(A.head().unsynced > 0, 'unsynced counter visible before sync');

  section('Sync assigns numbers and advances head; replays cannot double-book');
  await A.sync.now();
  eq(A.getLedger(enrolmentId).entries.filter(e => e.kind === 'payment')[0].receiptNo, 'R-000001', 'receipt number arrives at ack');
  eq(A.head().unsynced, 0, 'outbox drained');
  const logLen = broker._state.events.length;
  await A.sync.now();
  eq(broker._state.events.length, logLen, 'a second sync appends nothing (idempotent)');

  section('Reversal and adjustment supersede; nothing is edited in place');
  await A.reversePayment(enrolmentId, p1.eventId, 'keyed against the wrong trainee');
  eq(A.getBalance(enrolmentId), 2800000, 'reversal restores the balance');
  await A.applyAdjustment(enrolmentId, { amountMinor: -800000, kind: 'discount', reason: 'scholarship' });
  eq(A.getBalance(enrolmentId), 2000000, 'negative adjustment reduces what is owed');
  const led = A.getLedger(enrolmentId);
  eq(led.entries.length, 5, 'every action is its own immutable entry (2 charges + payment + reversal + adjustment)');
  ok(led.entries.filter(e => e.kind === 'payment')[0].reversedBy, 'the payment row carries its reversal, not an edit');

  section('Stale basis is refused (no blind writes over unseen changes)');
  const basisThen = A.head().seq;
  await A.correctPerson(rp.personId, { dob: ['2001-05-14', '2001-05-15'] }, 'typo fix');
  await A.sync.now();
  let staleErr = null;
  try { await A.correctPerson(rp.personId, { dob: ['2001-05-15', '2001-05-16'] }, 'second fix', { basis: basisThen }); }
  catch (e) { staleErr = e.code; }
  eq(staleErr, 'STALE_BASIS', 'a command carrying an old basis is refused');

  section('Duplicate people are suggested, never merged (P6)');
  const dup = await A.registerPerson({ names: { full: 'casey  EXAMPLE' } });
  eq(dup.duplicates, [rp.personId], 'same normalised name is suggested as a duplicate');
  ok(A.get('person', dup.personId).alive, 'and the new record is still created (false split beats false merge)');
  await A.mergePeople(rp.personId, dup.personId, { decided: 'same person, typo registration' }, 'human');
  await A.sync.now();
  eq(A.get('person', dup.personId).mergedInto, rp.personId, 'merge is an audited event, loser points at winner');

  section('Two devices converge to identical state regardless of sync order (P10)');
  const B = await createDAL({ adapter: MemoryAdapter(), broker, source: 'test-B', actor: { name: 'Clerk B', role: 'admin', device: 'dev_B' } });
  await B.sync.now();
  eq(B.getBalance(enrolmentId), 2000000, 'device B folds the same balance from the pulled log');
  const payA = await A.recordPayment(enrolmentId, { amountMinor: 700000, method: 'cash', date: '2026-09-10' });
  const payB = await B.recordPayment(enrolmentId, { amountMinor: 300000, method: 'transfer', date: '2026-09-11' });
  await B.sync.now();       // B lands first
  await A.sync.now();       // then A drains and pulls B's
  await B.sync.now();       // B pulls A's
  eq(A.getBalance(enrolmentId), 1000000, 'A: 2,000,000 − 700,000 − 300,000');
  eq(MD.canon(A.project('balances')), MD.canon(B.project('balances')), 'balances projection is byte-identical on both devices');
  eq(MD.canon(A.getLedger(enrolmentId).entries), MD.canon(B.getLedger(enrolmentId).entries), 'ledger entries are byte-identical');

  section('Same-amount same-date payments from different devices become an adjudication, never auto-resolved');
  await A.recordPayment(enrolmentId, { amountMinor: 100000, method: 'cash', date: '2026-09-15' });
  await B.recordPayment(enrolmentId, { amountMinor: 100000, method: 'cash', date: '2026-09-15' });
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const queue = A.project('adjudications');
  eq(queue.length, 1, 'exactly one duplicate-suspect item');
  eq(queue[0].kind, 'duplicate-payment', 'flagged, for a HUMAN to decide');
  eq(A.getBalance(enrolmentId), 800000, 'both facts stand in the ledger until a human reverses one');

  section('Crash and resume: accepted writes survive and never double-append');
  const crashStore = MemoryAdapter();
  const C1 = await createDAL({ adapter: crashStore, broker, source: 'test-C', actor: { name: 'Clerk C', role: 'admin', device: 'dev_C' } });
  await C1.sync.now();
  await C1.recordPayment(enrolmentId, { amountMinor: 50000, method: 'cash', date: '2026-09-20' });
  // tab dies before sync — same adapter, new DAL (reload):
  const C2 = await createDAL({ adapter: crashStore, broker, source: 'test-C', actor: { name: 'Clerk C', role: 'admin', device: 'dev_C' } });
  eq(C2.head().unsynced, 1, 'the accepted write survived the crash in the outbox');
  const lenBefore = broker._state.events.length;
  await C2.sync.now(); await C2.sync.now();
  eq(broker._state.events.length, lenBefore + 1, 'drained exactly once across resume + retry');

  section('Local rejection: commands against entities that do not exist fail fast');
  let ghost = null;
  try { await A.recordPayment('enr_ghost', { amountMinor: 1, method: 'cash', date: '2026-09-21' }); }
  catch (e) { ghost = e.message; }
  ok(/does not exist locally/.test(ghost), 'payment against a ghost enrolment is refused before it ever reaches the outbox');

  section('Attendance totals fold with corrections applied');
  const mk = await A.markAttendance(enrolmentId, '2026-09-22', 'absent');
  await A.correctAttendance(enrolmentId, mk.eventId, 'late', 'arrived 9:40');
  const att = A.project('attendanceTotals', { enrolmentId });
  eq([att.present, att.absent, att.late], [0, 0, 1], 'the correction supersedes the mark; both events remain in the log');

  section('Cashbook is its own book (D11): quarter folds, voids supersede');
  await A.openQuarter('2026/2027', 1, 23794869);
  const sub = await A.recordCashbookEntry({ fy: '2026/2027', q: 1, date: '2026-05-02', kind: 'income', categoryId: 'Subvention', amountMinor: 450946725 });
  const chq = await A.recordCashbookEntry({ fy: '2026/2027', q: 1, date: '2026-05-10', kind: 'expense', categoryId: 'Admin Expenses', amountMinor: 12000000, chequeNo: '1000148', payee: 'Vendor Ltd' });
  let qv = A.project('quarter', { fy: '2026/2027', q: 1 });
  eq(qv.closingMinor, 23794869 + 450946725 - 12000000, 'closing = opening + income − expense, all folds');
  await A.voidCheque(chq.entryId, 'printed in error');
  qv = A.project('quarter', { fy: '2026/2027', q: 1 });
  eq(qv.closingMinor, 23794869 + 450946725, 'a voided cheque leaves the fold but stays in the record');
  eq(qv.entries.length, 2, 'both entries remain visible, one marked voided');
  ok(!('feePaymentEventId' in qv.entries[0]), 'no fee linkage anywhere in the cashbook rows (D11)');
  await A.sync.now();
  ok(await broker.verifyChain(), 'the full log chain still verifies after everything above');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
