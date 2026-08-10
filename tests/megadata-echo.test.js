/* MegaData — THE ECHO GUARD, every bridge, in each PAGE's own tick order.

   The cashbook once mirrored each row the clerk typed back in as a second
   row: the page planned and pushed from a blob, then mirrored canonical →
   legacy from that SAME blob, and the join it needed (the megaId stamp) was
   only written by the half it had skipped. The model's own tests hand-applied
   that stamp, so they passed while the page double-counted real money.

   The lesson generalises past the cashbook: a bridge is only honest if a
   record BORN LOCALLY is still recognised as itself on the way back. So this
   suite drives every bridge the way its page drives it — three ticks, no
   hand-holding between them — and asserts the collection never grows. Each
   one is run a second time with its persisted join wiped (baseline meta lost,
   megaId stamps stripped by a legacy save), because a join that only works
   while its cache survives is not a join.

   Run: node tests/megadata-echo.test.js */
'use strict';
const assert = require('assert');
const RM = require('../megadata/pages/roster-model.js');
const DS = require('../megadata/pages/docsync-model.js');
const TG = require('../megadata/pages/tg-model.js');
const FD = require('../megadata/pages/findoc-model.js');
const FM = require('../megadata/pages/fee-model.js');
const CT = require('../megadata/pages/ctr-model.js');
const CB = require('../megadata/pages/cashbook-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const FY = '2025/2026', Q = 3;
function dalOf(dev) {
  return createDAL({ adapter: MemoryAdapter(), broker: createBroker(), source: 'echo-' + dev, actor: { name: 'Echo', role: 'admin', device: 'dev_' + dev } });
}

(async function main() {

  section('docsync (Transcript-Grades, Payslip, Clock-in, LMS dashboard, Voucher): one grade in, one grade out');
  {
    const dal = await dalOf('ds');
    const spec = TG.TG_SPECS.find(s => s.kind === 'transcriptGrade');
    let local = [{ id: 'MG::S9::Q1::U101', studentId: 'S9', qualId: 'Q1', unitCode: 'U101', grade: 88, date: '01/07/2026', source: 'manual' }];
    let base = {};
    for (let i = 0; i < 3; i++) {                                          // tg-page.js runTick
      const plan = await DS.docSyncPlan(dal, spec, local, base);
      await DS.docSyncPush(dal, plan, 'TG');
      local = DS.docSyncApply(spec, local, plan).records;
      base = plan.newBaseline;
      await dal.sync.now();
    }
    eq(local.length, 1, 'three ticks cannot grow the collection');
    const plan = await DS.docSyncPlan(dal, spec, local, {});
    eq(plan.newLocal.length, 0, 'BASELINE WIPED: the canonical doc is not read as a stranger');
    eq(DS.docSyncApply(spec, local, plan).records.length, 1, 'so the record is still recognised as its own');
  }

  section('findoc (Invoice, Quote, Purchase Order): a document is not re-issued as a copy of itself');
  {
    const dal = await dalOf('fd');
    let local = [{ id: 'FD1700000000009', number: 'INV-0009', date: '2026-07-10', billedTo: 'May Pen Hospital - SRHA', items: [{ desc: 'Welding training', qty: 1, unit: 250000 }], discount: 0, taxRate: 0, notes: '' }];
    let base = {};
    for (let i = 0; i < 3; i++) {                                          // findoc-page.js runTick
      const plan = await FD.fdPlan(dal, 'invoice', local, base);
      await FD.fdPush(dal, plan, 'FD');
      await dal.sync.now();
      local = FD.fdApply(local, plan).records;
      base = plan.newBaseline;
    }
    eq(local.length, 1, 'three ticks cannot grow the collection');
    eq(local[0].number, 'INV-0009', 'and the legacy document number is untouched');
    const plan = await FD.fdPlan(dal, 'invoice', local, {});
    eq(FD.fdApply(local, plan).records.length, 1, 'BASELINE WIPED: still one document');
  }

  section('roster (Student-Progress, LMS dashboard): a trainee is not enrolled twice');
  {
    const dal = await dalOf('sp');
    let students = [{ id: 'L9', name: 'Echo Person', course: 'Welding L2', stage: 'training', progress: 40, enrolmentDate: '2026-01-10' }];
    let base = {};
    for (let i = 0; i < 3; i++) {                                          // sp-page.js runTick
      const plan = await RM.spMergePlan(dal, { students, deletedIds: [] }, base);
      await RM.spPushPlan(dal, plan, 'SP');
      await dal.sync.now();
      students = RM.spApplyPlanToLegacy(students, [], plan).students;
      base = plan.newBaseline;
    }
    eq(students.length, 1, 'three ticks cannot grow the roster');
    const plan = await RM.spMergePlan(dal, { students, deletedIds: [] }, {});
    eq(RM.spApplyPlanToLegacy(students, [], plan).students.length, 1, 'BASELINE WIPED: still one trainee');
  }

  section('fee (School.Fee): the other money book does not double a payment');
  {
    const dal = await dalOf('fee');
    const students = [{ id: 'SF-P1', lmsId: 'P1', name: 'Echo Payer', skillArea: 'WELDING L2', tuitionFee: 200 }];
    let payments = [{ id: 'PP1', studentId: 'SF-P1', amount: 60, date: '2026-02-01', method: 'cash' }];
    for (let i = 0; i < 3; i++) {                                          // fee-page.js shadowTick
      await FM.feeBridgeAll(dal, { students, payments, deletedPaymentIds: [] });
      await dal.sync.now();
      const mir = await FM.feeLegacyMirror(dal, { students, payments, deletedPaymentIds: [] });
      const byId = {}; payments.forEach(p => { byId[p.id] = p; });
      mir.payments.forEach(p => { if (!byId[p.id]) { payments.push(p); byId[p.id] = p; } });
    }
    eq(payments.length, 1, 'three ticks cannot grow the payment list');
    const ids = await RM.identityIds(FM.feeIdentityKey(students[0]), 'WELDING L2');
    eq(dal.getLedger(ids.enrolmentId).paidMinor, 6000, 'and the ledger counts 60.00 ONCE');
  }

  section('ctr (Cert-Transcript-Requests): the legacy array is a projection, not an accumulator');
  {
    const dal = await dalOf('ctr');
    let legacy = [{ id: 'REQ-9', studentName: 'Echo', type: 'transcript', status: 'pending', requestedAt: '2026-07-01T00:00:00.000Z' }];
    for (let i = 0; i < 3; i++) {                                          // ctr-page.js refresh
      const delta = CT.ctrLegacyDelta(legacy, dal.project('entities', { kind: 'doc' }));
      for (const r of delta.missing.concat(delta.changed)) {
        await dal.upsertDoc(CT.CTR_KIND, await CT.ctrEntityId(r.id), CT.ctrToDocDiff(r), 'legacy bridge');
      }
      await dal.sync.now();
      legacy = CT.ctrFromDocs(dal.project('entities', { kind: 'doc' }));
    }
    eq(legacy.length, 1, 'three ticks cannot grow the request list');
  }

  section('cashbook (the one this guard was written for): one payment, one row');
  {
    const dal = await dalOf('cb');
    let blob = { openingBalance: 0, transactions: [{ id: 100, date: '2026-02-20', cheque: '', details: 'Echo Payee', deposit: 0, payment: 83535.75, category: 'Administrative Assistant' }], deletedTxnIds: [] };
    for (let i = 0; i < 3; i++) {                                          // cb-page.js runTick
      const plan = await CB.cbPlanQuarter(dal, FY, Q, blob);
      await CB.cbPushPlan(dal, plan, 'CB');
      blob = CB.cbApplyMirror(blob, { stamps: plan.stamps }).blob;
      await dal.sync.now();
      blob = CB.cbApplyMirror(blob, await CB.cbMirrorQuarter(dal, FY, Q, blob)).blob;
    }
    eq(blob.transactions.length, 1, 'three ticks cannot grow the quarter');
    blob.transactions.forEach(t => { delete t.megaId; });                  // a legacy save drops the stamps
    const mirror = await CB.cbMirrorQuarter(dal, FY, Q, blob);
    eq(CB.cbApplyMirror(blob, mirror).blob.transactions.length, 1, 'STAMPS WIPED: still one row');
    ok(CB.cbReconcile(dal, [{ fy: FY, q: Q, blob }]).ok, 'and the legacy book agrees with the fold to the cent');
  }

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
