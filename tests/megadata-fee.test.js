/* MegaData — School-Fee bridge + shadow comparator: bootstrap↔bridge id
   agreement, full-chain bridging of the REAL fixture with zero drift,
   legacy edit → supersession, legacy deletion → reversal, two-device
   convergence, induced-drift detection, conflicting-link safety.
   Run: node tests/megadata-fee.test.js */
'use strict';
const fs = require('fs');
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const FM = require('../megadata/pages/fee-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

function legacyOf(students, payments, deleted) { return { students, payments, deletedPaymentIds: deleted || [] }; }
async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'fee-' + dev, actor: { name: 'Clerk ' + dev, role: 'admin', device: 'dev_' + dev } });
}

(async function main() {

  section('Drift guard: bootstrap and the fee bridge derive IDENTICAL entity ids');
  const REC = { id: 'SF-LX', lmsId: 'LX', name: 'Fee Person', skillArea: 'WELDING L2', tuitionFee: 280, enrollmentDate: '2026-01-05' };
  const payload = { id: 'test:feeX', kind: 'schoolfee-pagecloud', name: 'feeX', json: { data: {
    cestiSchoolFeeStudents: JSON.stringify([REC]),
    cestiSchoolFeePayments: JSON.stringify([{ id: 'PX1', studentId: 'SF-LX', amount: 100, date: '2026-01-10', method: 'cash', receiptNumber: 'R-77' }]),
    cestiFeeStructure: JSON.stringify({ 'WELDING L2': { total: 280, terms: [280] } }),
    cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]'
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_fee-1' });
  const bootEvents = await st.get('staging', 'events');
  const ids = await RM.identityIds(FM.feeIdentityKey(REC), REC.skillArea);
  eq(bootEvents.find(e => e.type === 'person.registered').entity.id, ids.personId, 'person id agrees');
  eq(bootEvents.find(e => e.type === 'enrolment.created').entity.id, ids.enrolmentId, 'enrolment id agrees');
  ok(bootEvents.find(e => e.type === 'fees.payment.recorded').payload.reference === 'legacy:PX1', 'bootstrap payments carry the legacy join key');

  section('The REAL fixture bridges live with ZERO drift (the shadow comparator, green)');
  const fixture = JSON.parse(fs.readFileSync(__dirname + '/fixtures/school-fees-backup.json', 'utf8'));
  const d = fixture.data;
  const P = k => (typeof d[k] === 'string' ? JSON.parse(d[k]) : d[k]) || [];
  const realLegacy = legacyOf(P('cestiSchoolFeeStudents'), P('cestiSchoolFeePayments'), P('cestiSchoolFeeDeletedPaymentIds'));
  const brokerR = createBroker();
  const R = await freshDal(brokerR, 'R');
  const bres = await FM.feeBridgeAll(R, realLegacy);
  eq(bres.bridged, realLegacy.students.length, 'EVERY trainee record bridged (' + bres.bridged + '), conflicted links split like the bootstrap');
  ok(bres.skipped.length > 0, bres.skipped.length + ' conflicting-link groups reported for adjudication (the anonymiser artifacts)');
  const rep = await FM.reconcileFees(R, realLegacy);
  eq(rep.mismatches.length, 0, 'per-trainee balances agree, both sides from atoms, to the cent');
  ok(rep.ok, 'comparator verdict: ZERO DRIFT (' + (rep.totalMegaPaidMinor / 100).toFixed(2) + ' paid on both sides)');
  await R.sync.now();
  ok(await brokerR.verifyChain(), 'the bridged log chain verifies');

  section('A legacy in-place payment edit becomes reversal + re-record');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const stu = [{ id: 'SF-E1', lmsId: 'E1', name: 'Edit Case', skillArea: 'WELDING L2', tuitionFee: 200 }];
  const pays = [{ id: 'PE1', studentId: 'SF-E1', amount: 60, date: '2026-02-01', method: 'cash' }];
  await FM.feeBridgeAll(A, legacyOf(stu, pays));
  const eIds = await RM.identityIds(FM.feeIdentityKey(stu[0]), 'WELDING L2');
  eq(A.getBalance(eIds.enrolmentId), 14000, 'initial fold: 200.00 − 60.00');
  pays[0].amount = 85; // the legacy page edits the row in place
  await FM.feeBridgeAll(A, legacyOf(stu, pays));
  eq(A.getBalance(eIds.enrolmentId), 11500, 'after the edit: 200.00 − 85.00');
  const led = A.getLedger(eIds.enrolmentId);
  eq(led.entries.filter(e => e.kind === 'payment').length, 2, 'both payment versions remain in the record');
  eq(led.entries.filter(e => e.kind === 'reversal').length, 1, 'with the old one reversed, not erased');
  ok((await FM.reconcileFees(A, legacyOf(stu, pays))).ok, 'comparator: zero drift after the edit');

  section('A legacy deletion becomes a reversal');
  await FM.feeBridgeAll(A, legacyOf(stu, pays, ['PE1']));
  eq(A.getBalance(eIds.enrolmentId), 20000, 'the deleted payment no longer counts');
  ok((await FM.reconcileFees(A, legacyOf(stu, pays, ['PE1']))).ok, 'comparator: zero drift after the deletion');
  await FM.feeBridgeAll(A, legacyOf(stu, pays, ['PE1']));
  eq(A.getLedger(eIds.enrolmentId).entries.filter(e => e.kind === 'reversal').length, 2, 'a re-run adds nothing new (idempotent)');

  section('Two devices bridging the same legacy data converge (P10)');
  const B = await freshDal(broker, 'B');
  await FM.feeBridgeAll(B, legacyOf(stu, pays, ['PE1'])); // B never pulled; bridges blind
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const payEvents = broker._state.events.filter(e => e.type === 'fees.payment.recorded' && e.payload.reference === 'legacy:PE1');
  eq(payEvents.length, 2, 'exactly the two payment VERSIONS in the log — no duplicates from the race');
  eq(B.head().unsynced, 0, "B's identical events deduped to the original acks");
  eq(MD.canon(A.getLedger(eIds.enrolmentId)), MD.canon(B.getLedger(eIds.enrolmentId)), 'both devices fold the identical ledger');

  section('Mega-side drift is detected, not absorbed');
  await A.recordPayment(eIds.enrolmentId, { amountMinor: 5000, method: 'cash', date: '2026-02-20' });
  const drift = await FM.reconcileFees(A, legacyOf(stu, pays, ['PE1']));
  eq(drift.mismatches.length, 1, 'the extra mega-side payment shows as exactly one mismatch');
  eq(drift.mismatches[0].megaPaidMinor - drift.mismatches[0].legacyPaidMinor, 5000, 'with the exact delta');

  section('Conflicting id-links are skipped, never merged (P6)');
  const clash = [{ id: 'SF-C1', lmsId: 'C9', name: 'Person One', skillArea: 'WELDING L2', tuitionFee: 10 },
                 { id: 'SF-C2', lmsId: 'C9', name: 'Person Two', skillArea: 'WELDING L2', tuitionFee: 10 }];
  const C = await freshDal(createBroker(), 'C');
  const cres = await FM.feeBridgeAll(C, legacyOf(clash, []));
  eq(cres.bridged, 2, 'both colliding records bridged — SEPARATELY, under split identities');
  eq(cres.skipped.length, 1, 'and the collision is reported for adjudication');
  const cid1 = await RM.identityIds('id:SF-C1#student', 'WELDING L2');
  const cid2 = await RM.identityIds('id:SF-C2#student', 'WELDING L2');
  ok(C.get('person', cid1.personId) && C.get('person', cid2.personId) && cid1.personId !== cid2.personId,
    'two DISTINCT people exist — never merged, matching the bootstrap split keys');

  section('Stage 2: the broker issues the receipt number; it lands back on the legacy record');
  {
    const bk = createBroker();
    const D1 = await freshDal(bk, 'S2a');
    const stu2 = [{ id: 'SF-N1', lmsId: 'N1', name: 'Number Case', skillArea: 'WELDING L2', tuitionFee: 300, totalPaid: 0, balance: 300 }];
    const pays2 = [
      { id: 'PN1', studentId: 'SF-N1', amount: 100, date: '2026-03-01', method: 'cash', receiptNumber: '' },
      { id: 'PN2', studentId: 'SF-N1', amount: 50, date: '2026-03-02', method: 'cash', receiptNumber: 'BOOK-0042' }
    ];
    await FM.feeBridgeAll(D1, legacyOf(stu2, pays2));
    const nIds = await RM.identityIds(FM.feeIdentityKey(stu2[0]), 'WELDING L2');
    let ledger = D1.getLedger(nIds.enrolmentId);
    ok(ledger.entries.filter(e => e.kind === 'payment' && e.pendingNumber).length === 1,
      'before sync: only the number-less payment is pending a number');
    eq(await FM.feeReceiptBackfill(D1, legacyOf(stu2, pays2)), [], 'nothing to backfill before the broker has spoken');
    await D1.sync.now();
    ledger = D1.getLedger(nIds.enrolmentId);
    const pn1 = ledger.entries.find(e => e.reference === 'legacy:PN1');
    const pn2 = ledger.entries.find(e => e.reference === 'legacy:PN2');
    ok(/^R-\d{6}$/.test(pn1.receiptNo), 'the blank one got a broker receipt number (' + pn1.receiptNo + ')');
    ok(pn2.receiptNo === null && pn2.legacyReceiptNo === 'BOOK-0042' && !pn2.pendingNumber,
      'the clerk-numbered one is NOT renumbered — history keeps the number on the paper receipt');
    const fills = await FM.feeReceiptBackfill(D1, legacyOf(stu2, pays2));
    eq(fills.length, 1, 'backfill returns exactly the blank record');
    eq(fills[0].payId, 'PN1', 'targeting the right payment');
    eq(fills[0].receiptNo, pn1.receiptNo, 'with the broker number');
    pays2[0].receiptNumber = fills[0].receiptNo;                      // the page applies it
    eq(await FM.feeReceiptBackfill(D1, legacyOf(stu2, pays2)), [], 'applied once, backfill goes quiet');
    await FM.feeBridgeAll(D1, legacyOf(stu2, pays2));
    eq(D1.getLedger(nIds.enrolmentId).entries.filter(e => e.kind === 'payment').length, 2,
      'the backfilled number does NOT read as a legacy edit — no new events');
    ok((await FM.reconcileFees(D1, legacyOf(stu2, pays2))).ok, 'comparator: zero drift with numbers flowing');
  }

  section('Stage 2: a payment recorded on one device is MIRRORED into the other device\'s legacy store');
  {
    const bk = createBroker();
    const DA = await freshDal(bk, 'S2b');
    const DB = await freshDal(bk, 'S2c');
    const stuA = [{ id: 'SF-M1', lmsId: 'M1', name: 'Mirror Case', skillArea: 'COSMETOLOGY L2', tuitionFee: 400, totalPaid: 0, balance: 400 }];
    const paysA = [{ id: 'PM1', studentId: 'SF-M1', amount: 150, date: '2026-03-05', method: 'transfer', receiptNumber: '' }];
    await FM.feeBridgeAll(DA, legacyOf(stuA, paysA));
    await DA.sync.now();
    // Device B has the trainee roll (page-cloud synced students) but the
    // payment never reached its legacy store.
    const stuB = JSON.parse(JSON.stringify(stuA));
    const paysB = [];
    await FM.feeBridgeAll(DB, legacyOf(stuB, paysB));
    await DB.sync.now();
    const mir = await FM.feeLegacyMirror(DB, legacyOf(stuB, paysB));
    eq(mir.payments.length, 1, "the pulled payment appears in B's mirror list");
    eq(mir.payments[0].id, 'PM1', 'under its ORIGINAL legacy id (page-cloud will dedupe, not duplicate)');
    eq(mir.payments[0].amount, 150, 'with the right amount');
    ok(/^R-\d{6}$/.test(mir.payments[0].receiptNumber), 'carrying the broker receipt number');
    eq(mir.totals, [{ studentId: 'SF-M1', totalPaid: 150, balance: 250 }], 'and the stored totals refresh FROM THE FOLD');
    paysB.push(mir.payments[0]);
    stuB[0].totalPaid = 150; stuB[0].balance = 250;
    ok((await FM.reconcileFees(DB, legacyOf(stuB, paysB))).ok, 'after applying the mirror, B reconciles to zero drift');
    const mir2 = await FM.feeLegacyMirror(DB, legacyOf(stuB, paysB));
    eq(mir2.payments.length + mir2.totals.length, 0, 'the mirror is idempotent — a second pass changes nothing');
  }

  section('Stage 2: a mega-native payment mirrors deterministically and is never re-imported');
  {
    const bk = createBroker();
    const DM = await freshDal(bk, 'S2d');
    const stuM = [{ id: 'SF-G1', lmsId: 'G1', name: 'Native Case', skillArea: 'WELDING L2', tuitionFee: 500, totalPaid: 0, balance: 500 }];
    await FM.feeBridgeAll(DM, legacyOf(stuM, []));
    const gIds = await RM.identityIds(FM.feeIdentityKey(stuM[0]), 'WELDING L2');
    await DM.recordPayment(gIds.enrolmentId, { amountMinor: 12000, method: 'card', date: '2026-03-10' });
    await DM.sync.now();
    const mir = await FM.feeLegacyMirror(DM, legacyOf(stuM, []));
    eq(mir.payments.length, 1, 'the DAL-native payment appears in the mirror');
    ok(/^MG-/.test(mir.payments[0].id), 'under a deterministic MG- record id (every device derives the same one)');
    ok(/^R-\d{6}$/.test(mir.payments[0].receiptNumber), 'with its broker receipt number');
    const paysM = [mir.payments[0]];
    stuM[0].totalPaid = 120; stuM[0].balance = 380;
    const before = DM.getLedger(gIds.enrolmentId).entries.filter(e => e.kind === 'payment').length;
    await FM.feeBridgeAll(DM, legacyOf(stuM, paysM));
    eq(DM.getLedger(gIds.enrolmentId).entries.filter(e => e.kind === 'payment').length, before,
      'the bridge SKIPS MG- mirrors — a mirror can never become a duplicate event');
    ok((await FM.reconcileFees(DM, legacyOf(stuM, paysM))).ok, 'and the comparator holds at zero drift');
  }

  section('Stage 2: balances answered from the fold, never a stored number');
  {
    const bk = createBroker();
    const DF = await freshDal(bk, 'S2e');
    // The stored balance LIES (the original disease) — the fold does not.
    const stuF = [{ id: 'SF-F1', lmsId: 'F1', name: 'Fold Case', skillArea: 'WELDING L2', tuitionFee: 250, totalPaid: 0, balance: 999 }];
    const paysF = [{ id: 'PF1', studentId: 'SF-F1', amount: 75, date: '2026-03-08', method: 'cash', receiptNumber: '' }];
    await FM.feeBridgeAll(DF, legacyOf(stuF, paysF));
    const map = await FM.feeBalancesFromFold(DF, legacyOf(stuF, paysF));
    eq(map['SF-F1'].balanceMinor, 17500, 'fold balance: 250.00 − 75.00, ignoring the lying stored 999');
    eq(map['SF-F1'].paidMinor, 7500, 'fold paid matches the atomic record');
    eq(map['SF-F1'].status, 'partial', 'status derived from the fold');
  }

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
