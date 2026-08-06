/* MegaData — Cashbook bridge (D11: its own book): bootstrap↔bridge id
   agreement, edit → void+replacement chains, void/unvoid, deletion, the
   per-device integer-id TRAP (same id, different txns, two devices), the
   canonical→legacy mirror with id remapping and megaId stamps, and the
   to-the-cent quarter comparator. Run: node tests/megadata-cb.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const CB = require('../megadata/pages/cashbook-model.js');
const CBS = require('../megadata/cashbook-shared.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';
const FY = '2025/2026', Q = 3;

function blobOf(txns, opening, deleted) { return { openingBalance: opening == null ? 0 : opening, transactions: txns, deletedTxnIds: deleted || [] }; }
async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'cb-' + dev, actor: { name: 'Clerk ' + dev, role: 'admin', device: 'dev_' + dev } });
}
async function tickQuarter(dal, blob) {
  const plan = await CB.cbPlanQuarter(dal, FY, Q, blob);
  await CB.cbPushPlan(dal, plan, 'CB');
  await dal.sync.now();
  return plan;
}
function applyStamps(blob, plan) {
  const byId = {};
  blob.transactions.forEach(t => { byId[String(t.id)] = t; });
  plan.stamps.forEach(s => { if (byId[String(s.txnId)]) byId[String(s.txnId)].megaId = s.megaId; });
}
function foldQ(dal) { return dal.project('quarter', { fy: FY, q: Q }); }

(async function main() {

  section('Drift guard: bootstrap and the bridge derive IDENTICAL quarter/entry ids');
  const T1 = { id: 101, date: '2026-02-03', cheque: '1001', details: 'Stationery Ltd', deposit: 0, payment: 125.5, category: 'Office' };
  const T2 = { id: 102, date: '2026-02-04', cheque: '', details: 'Course fees received', deposit: 900, payment: 0, category: 'Income' };
  const payload = { id: 'test:cb', kind: 'finance-staff-pagecloud', name: 'cb', json: { data: (() => {
    const d = {}; d['cestis_quarter_' + FY + '_Q' + Q] = JSON.stringify(blobOf([T1, T2], 500)); return d;
  })() } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_cb-1' });
  const bootEvents = await st.get('staging', 'events');
  const qid = await RM.bootstrapId('cbq', 'cbq|' + FY + '|Q' + Q);
  const e101 = await RM.bootstrapId('cbe', 'cbe|' + FY + '|Q' + Q + '|101');
  eq(bootEvents.find(e => e.type === 'cashbook.quarter.opened').entity.id, qid, 'quarter entity id agrees');
  eq(bootEvents.find(e => e.type === 'cashbook.entry.recorded' && e.payload.amountMinor === 12550).entity.id, e101, 'entry entity id agrees (bootstrap key)');

  section('The bridge reproduces bootstrap history on an empty store; re-runs are quiet');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const blobA = blobOf([Object.assign({}, T1), Object.assign({}, T2)], 500);
  const p1 = await tickQuarter(A, blobA);
  applyStamps(blobA, p1);
  eq(p1.records.length, 2, 'both txns recorded');
  ok(p1.openQuarter, 'quarter opened');
  let f = foldQ(A);
  eq([f.incomeMinor, f.expenseMinor, f.openingBalanceMinor], [90000, 12550, 50000], 'fold: income 900.00, expense 125.50, opening 500.00');
  const p2 = await tickQuarter(A, blobA);
  eq(p2.records.length + p2.voids.length, 0, 'a re-run adds nothing (idempotent)');
  ok(CB.cbReconcile(A, [{ fy: FY, q: Q, blob: blobA }]).ok, 'comparator: ZERO DRIFT to the cent');

  section('An in-place legacy edit becomes VOID + chained replacement — both stay in the book');
  blobA.transactions[0].payment = 150;                                   // the page edits the row in place
  const p3 = await tickQuarter(A, blobA);
  applyStamps(blobA, p3);
  eq(p3.voids.length, 1, 'the old entry is voided');
  eq(p3.voids[0].reason, 'superseded by legacy edit', 'with the audit reason');
  eq(p3.records.length, 1, 'and the replacement recorded');
  ok(p3.records[0].payload.supersedes, 'the replacement names what it supersedes');
  f = foldQ(A);
  eq(f.expenseMinor, 15000, 'expense now 150.00 — the void zeroed the old amount');
  eq(f.entries.length, 3, 'ALL THREE lines remain in the permanent book (original, void is a flag on it, replacement)');
  ok(CB.cbReconcile(A, [{ fy: FY, q: Q, blob: blobA }]).ok, 'comparator still ZERO DRIFT');

  section('A legacy cheque VOID becomes cashbook.cheque.voided; UNVOID becomes a replacement');
  const t1 = blobA.transactions[0];
  t1._origDetails = t1.details; t1._origCategory = t1.category; t1._origPayment = t1.payment; t1._origDeposit = t1.deposit;
  t1.details = 'Cancelled Cheque'; t1.category = 'Cancelled'; t1.payment = 0; t1.deposit = 0;
  const p4 = await tickQuarter(A, blobA);
  eq(p4.voids.length, 1, 'the void bridges');
  eq(p4.voids[0].reason, 'legacy voided cheque', 'with the cheque-void reason');
  f = foldQ(A);
  eq(f.expenseMinor, 0, 'voided counts ZERO, exactly like legacy calcTotals');
  ok(CB.cbReconcile(A, [{ fy: FY, q: Q, blob: blobA }]).ok, 'comparator agrees while voided');
  // UNVOID: the page restores _orig* and deletes them.
  t1.details = t1._origDetails; t1.category = t1._origCategory; t1.payment = t1._origPayment; t1.deposit = t1._origDeposit;
  delete t1._origDetails; delete t1._origCategory; delete t1._origPayment; delete t1._origDeposit;
  const p5 = await tickQuarter(A, blobA);
  applyStamps(blobA, p5);
  eq(p5.records.length, 1, 'the unvoid is a REPLACEMENT — the void event is permanent history');
  f = foldQ(A);
  eq(f.expenseMinor, 15000, 'the money is back');
  ok(CB.cbReconcile(A, [{ fy: FY, q: Q, blob: blobA }]).ok, 'comparator: zero drift after the unvoid round-trip');

  section('A legacy deletion becomes a void with its reason');
  blobA.deletedTxnIds.push(102);
  blobA.transactions = blobA.transactions.filter(t => t.id !== 102);
  const p6 = await tickQuarter(A, blobA);
  eq(p6.voids.length, 1, 'the deletion voids the entity');
  eq(p6.voids[0].reason, 'legacy deletion', 'with the reason');
  f = foldQ(A);
  eq(f.incomeMinor, 0, 'the deleted income no longer counts');
  ok(CB.cbReconcile(A, [{ fy: FY, q: Q, blob: blobA }]).ok, 'comparator: zero drift after the deletion');
  eq((await tickQuarter(A, blobA)).voids.length, 0, 'a re-run adds nothing');

  section('THE ID TRAP: two devices mint the SAME txn id for DIFFERENT money — both survive');
  const broker2 = createBroker();
  const D1 = await freshDal(broker2, 'X');
  const D2 = await freshDal(broker2, 'Y');
  const x = { id: 200, date: '2026-02-10', cheque: '', details: 'Donation received', deposit: 300, payment: 0, category: 'Income' };
  const y = { id: 200, date: '2026-02-11', cheque: '2002', details: 'Gas bill', deposit: 0, payment: 80, category: 'Utilities' };
  const blobX = blobOf([x], 0), blobY = blobOf([y], 0);
  const px = await tickQuarter(D1, blobX); applyStamps(blobX, px);
  const py = await tickQuarter(D2, blobY); applyStamps(blobY, py);
  await D1.sync.now(); await D2.sync.now();
  ok(blobX.transactions[0].megaId !== blobY.transactions[0].megaId, 'same legacy id, DIFFERENT entities — nobody voided anybody');
  let fx = foldQ(D1);
  eq([fx.incomeMinor, fx.expenseMinor], [30000, 8000], 'BOTH sums count after sync (300.00 in, 80.00 out)');
  // Mirror Y's txn into X's blob: id 200 is taken → remapped, megaId carried.
  const mx = await CB.cbMirrorQuarter(D1, FY, Q, blobX);
  eq(mx.newTxns.length, 1, "the other device's txn mirrors in");
  ok(String(mx.newTxns[0].id) !== '200', 'under a REMAPPED local id (200 was taken)');
  eq(mx.newTxns[0].payment, 80, 'with the right amount');
  ok(mx.newTxns[0].megaId, 'carrying its megaId join');
  const ax = CB.cbApplyMirror(blobX, mx);
  ok(ax.changed, 'the blob changes');
  ok(CB.cbReconcile(D1, [{ fy: FY, q: Q, blob: ax.blob }]).ok, "after the mirror, X's legacy book agrees with the fold TO THE CENT");
  const pAfter = await tickQuarter(D1, ax.blob);
  eq(pAfter.records.length + pAfter.voids.length, 0, 'and the next bridge tick is QUIET — the mirror cannot echo');

  section('Mirror applies remote edits in place via the supersedes chain');
  // Y edits its txn; X should see the edit land on its REMAPPED copy.
  blobY.transactions[0].payment = 95;
  const py2 = await tickQuarter(D2, blobY); applyStamps(blobY, py2);
  await D1.sync.now();
  const mx2 = await CB.cbMirrorQuarter(D1, FY, Q, ax.blob);
  eq(mx2.edits.length, 1, "the remote edit appears in X's mirror");
  const ax2 = CB.cbApplyMirror(ax.blob, mx2);
  const mirrored = ax2.blob.transactions.filter(t => t.details === 'Gas bill')[0];
  eq(mirrored.payment, 95, 'the edited amount lands on the mirrored copy');
  ok(CB.cbReconcile(D1, [{ fy: FY, q: Q, blob: ax2.blob }]).ok, 'and the book still balances to the cent');

  section('Mirror applies remote voids and deletions with legacy semantics');
  // Y voids its cheque.
  const ty = blobY.transactions[0];
  ty._origDetails = ty.details; ty._origCategory = ty.category; ty._origPayment = ty.payment; ty._origDeposit = ty.deposit;
  ty.details = 'Cancelled Cheque'; ty.category = 'Cancelled'; ty.payment = 0; ty.deposit = 0;
  await tickQuarter(D2, blobY);
  await D1.sync.now();
  const mx3 = await CB.cbMirrorQuarter(D1, FY, Q, ax2.blob);
  eq(mx3.voids.length, 1, 'the remote void mirrors');
  const ax3 = CB.cbApplyMirror(ax2.blob, mx3);
  const voided = ax3.blob.transactions.filter(t => t._origDetails === 'Gas bill')[0];
  ok(voided && voided.category === 'Cancelled' && voided.payment === 0 && voided._origPayment === 95,
    'applied EXACTLY like the legacy void button: Cancelled + _orig* kept for unvoid');
  ok(CB.cbReconcile(D1, [{ fy: FY, q: Q, blob: ax3.blob }]).ok, 'books agree with the void applied');

  section('cancelled-zero txns become documents, never ledger entries');
  const cz = { id: 300, date: '2026-02-12', cheque: '3003', details: 'Cancelled Cheque', deposit: 0, payment: 0, category: 'Cancelled' };
  const blobZ = blobOf([cz], 0);
  const Z = await freshDal(createBroker(), 'Z');
  const pz = await tickQuarter(Z, blobZ);
  eq(pz.records.length, 0, 'no ledger entry (no amount was ever known)');
  eq(pz.cancelledDocs.length, 1, 'a cashbookCancelled document instead');
  eq(foldQ(Z).entries.length, 0, 'the money book is untouched');

  section('Comparator catches a lying opening balance');
  const W = await freshDal(createBroker(), 'W');
  const blobW = blobOf([Object.assign({}, T2)], 500);
  const pw = await tickQuarter(W, blobW); applyStamps(blobW, pw);
  blobW.openingBalance = 999;                                            // drifted after the quarter opened
  const rep = CB.cbReconcile(W, [{ fy: FY, q: Q, blob: blobW }]);
  ok(!rep.ok, 'the drifted opening balance is CAUGHT, not absorbed');
  eq(rep.quarters[0].legacyOpeningMinor, 99900, 'legacy side reported');
  eq(rep.quarters[0].megaOpeningMinor, 50000, 'canonical side reported');

  ok(await broker.verifyChain(), 'broker A chain verifies');
  ok(await broker2.verifyChain(), 'broker X/Y chain verifies');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
