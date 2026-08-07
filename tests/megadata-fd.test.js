/* MegaData — finance documents (invoice/quote/po) + voucher overrides:
   bootstrap↔bridge id agreement with number preservation, issue/supersede/
   void flows, the line-items ARRAY surviving supersession (fold regression),
   presence three-way (delete → void, canonical void → local removal),
   mirror-in of full documents, duplicate-number reporting, and the voucher
   objmap boundary. Run: node tests/megadata-fd.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const FD = require('../megadata/pages/findoc-model.js');
const DS = require('../megadata/pages/docsync-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const INV = { id: 'FD1700000000001', number: 'INV-0007', date: '2026-07-10', billedTo: 'May Pen Hospital - SRHA',
  items: [{ desc: 'Welding training - cohort 4', qty: 1, unit: 250000 }, { desc: 'Materials', qty: 1, unit: 30000 }],
  discount: 0, taxRate: 0, notes: '' };

async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'fd-' + dev, actor: { name: 'Fin ' + dev, role: 'admin', device: 'dev_' + dev } });
}
async function tick(dal, kind, local, baseline) {
  const plan = await FD.fdPlan(dal, kind, local, baseline || {});
  await FD.fdPush(dal, plan, 'FD');
  await dal.sync.now();
  return plan;
}

(async function main() {

  section('Drift guard: bootstrap and the bridge derive IDENTICAL findoc ids; legacy numbers preserved');
  const payload = { id: 'test:fd', kind: 'finance-staff-pagecloud', name: 'fd', json: { data: {
    cestis_finance_invoices: JSON.stringify([INV]),
    cestis_finance_quotes: JSON.stringify([{ id: 'Q1', number: 'QUO-0002', date: '2026-07-01', items: [] }]),
    cestis_finance_pos: JSON.stringify([{ id: 'P1', number: 'PO-0001', date: '2026-07-02', items: [] }]),
    cestis_finance_voucher_overrides: JSON.stringify({ 'pay:2026-07-15:44': { payee: 'Corrected Payee Ltd' } })
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_fd-1' });
  const bootEvents = await st.get('staging', 'events');
  for (const [kind, recId] of [['invoice', 'FD1700000000001'], ['quote', 'Q1'], ['po', 'P1']]) {
    const wantId = await FD.fdEntityId(kind, recId);
    const evt = bootEvents.find(e => e.type === 'findoc.issued' && e.payload.kind === kind);
    eq(evt && evt.entity.id, wantId, kind + ' findoc id agrees between bootstrap and the bridge');
    ok(evt && evt.payload.number, kind + ' carries its preserved legacy number');
  }
  {
    const voDoc = bootEvents.find(e => e.type === 'doc.upserted' && e.payload.kind === 'voucherOverride');
    const wantVo = await RM.bootstrapId('doc', 'voucherOverride|pay:2026-07-15:44');
    eq(voDoc && voDoc.entity.id, wantVo, 'voucher override doc id agrees');
  }

  section('Issue: a new local document becomes findoc.issued, number preserved, broker does NOT renumber');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const p1 = await tick(A, 'invoice', [INV], {});
  eq(p1.issues.length, 1, 'the invoice issues');
  const fid = await FD.fdEntityId('invoice', INV.id);
  const ent = A.get('findoc', fid);
  eq(ent.fields.number, 'INV-0007', 'the legacy number IS the number — never renumbered');
  eq(ent.fields.doc.items.length, 2, 'line items intact');
  eq((await tick(A, 'invoice', [INV], p1.newBaseline)).issues.length, 0, 'a re-run is quiet');

  section('Supersession: an edit diffs; the line-items ARRAY survives (fold regression)');
  const edited = JSON.parse(JSON.stringify(INV));
  edited.items.push({ desc: 'Certification fees', qty: 4, unit: 5000 });
  edited.notes = 'Revised per client call';
  const p2 = await tick(A, 'invoice', [edited], p1.newBaseline);
  eq(p2.supersedes.length, 1, 'the edit supersedes');
  const after = A.get('findoc', fid);
  eq(after.fields.doc.items.length, 3, 'the ARRAY folded as data — three line items');
  eq(after.fields.doc.items[2].desc, 'Certification fees', 'including the new line');
  eq(after.fields.doc.notes, 'Revised per client call', 'and the note');
  ok(after.fields.revisions && after.fields.revisions.length === 1, 'the revision is audited on the entity');

  section('Remote edit applies; both-changed pushes local as last writer');
  const B = await freshDal(broker, 'B');
  await B.sync.now();
  const pB1 = await FD.fdPlan(B, 'invoice', [JSON.parse(JSON.stringify(INV))], { [fid]: Object.assign({}, INV) });
  eq(pB1.supersedes.length, 0, "B's stale copy is not an edit");
  eq(pB1.applies.length, 1, "A's edit lands in B's apply list");
  const applied = FD.fdApply([JSON.parse(JSON.stringify(INV))], pB1);
  eq(applied.records[0].items.length, 3, 'the items array applies to the legacy record');
  const conflictLocal = Object.assign(JSON.parse(JSON.stringify(edited)), { notes: 'B note' });
  await tick(B, 'invoice', [Object.assign(JSON.parse(JSON.stringify(edited)), { notes: 'A note' })], pB1.newBaseline);
  await A.sync.now();
  const p3 = await tick(A, 'invoice', [conflictLocal], p2.newBaseline);
  eq(p3.conflicts.length, 1, 'the both-changed note is reported');
  eq(A.get('findoc', fid).fields.doc.notes, 'B note', "A's push is the last writer");

  section('Deletion: gone-since-baseline voids; a canonical void removes the stale local copy');
  const p4 = await tick(A, 'invoice', [], p3.newBaseline);
  eq(p4.voids.length, 1, 'the local deletion voids the document');
  eq(p4.voids[0].reason, 'legacy deletion', 'with its reason');
  eq(A.get('findoc', fid).fields.status, 'voided', 'canonical status: voided');
  await B.sync.now();
  const pB2 = await FD.fdPlan(B, 'invoice', [JSON.parse(JSON.stringify(edited))], pB1.newBaseline);
  eq(pB2.removals, [edited.id], "B's stale copy is removed, not resurrected");
  eq(FD.fdApply([edited], pB2).records.length, 0, 'applied: gone');
  eq((await FD.fdPlan(B, 'invoice', [], pB2.newBaseline)).voids.length, 0, 'and B pushes no duplicate void');

  section('Mirror-in: a document born on another device lands whole');
  const QUO = { id: 'FDQ9', number: 'QUO-0011', date: '2026-07-20', billedTo: 'HEART NSTA Trust', items: [{ desc: 'RBF', qty: 1, unit: 100000 }] };
  await tick(A, 'quote', [QUO], {});
  await B.sync.now();
  const pB3 = await FD.fdPlan(B, 'quote', [], {});
  eq(pB3.newLocal.length, 1, 'the quote mirrors in');
  eq(pB3.newLocal[0].number, 'QUO-0011', 'with its number');
  eq(pB3.newLocal[0].items[0].unit, 100000, 'and its line items');

  section('Duplicate numbers are REPORTED for humans, never auto-renumbered');
  const CLASH = { id: 'FDQ-other', number: 'QUO-0011', date: '2026-07-21', items: [] };
  await tick(B, 'quote', [pB3.newLocal[0], CLASH], pB3.newBaseline);
  await A.sync.now();
  const rep = FD.findocReconcile(A, ['quote']);
  ok(!rep.ok, 'the clash is caught');
  eq(rep.duplicates.length, 1, 'exactly one duplicate number');
  eq(rep.duplicates[0].number, 'QUO-0011', 'named');
  eq(rep.duplicates[0].entityIds.length, 2, 'with both documents listed');

  section('Voucher overrides: objmap records join by __k; race dedupes');
  const vSpec = {
    kind: 'voucherOverride',
    bootKey: r => 'voucherOverride|' + r.__k,
    localId: f => (f.__k == null ? '' : String(f.__k)),
    fromDoc: f => { const o = {}; Object.keys(f).forEach(k => { if (k !== '_removed' && k !== 'docKind') o[k] = f[k]; }); return o; }
  };
  const OV = { __k: 'pay:2026-07-15:44', payee: 'Corrected Payee Ltd' };
  const pv1 = await DS.docSyncPlan(A, vSpec, [OV], {});
  await DS.docSyncPush(A, pv1, 'FD'); await A.sync.now(); await B.sync.now();
  const pv2 = await DS.docSyncPlan(B, vSpec, [], {});
  eq(pv2.newLocal.length, 1, 'the override mirrors in');
  eq(pv2.newLocal[0].__k, 'pay:2026-07-15:44', 'carrying its map key');
  const voId = await RM.bootstrapId('doc', vSpec.bootKey(OV));
  ok(B.get('doc', voId), 'under the bootstrap-pinned doc id');
  ok(await broker.verifyChain(), 'the log chain verifies after the whole exercise');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
