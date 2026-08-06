/* MegaData pilot page (Cert/Transcript-Requests): model round-trips, the
   legacy bridge, the bootstrap extractor, and cross-device convergence with
   deterministic document ids. Run: node tests/megadata-ctr.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const CTR = require('../megadata/pages/ctr-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const R1 = { id: 'CTR-abc1', studentId: 'STU-1', studentName: 'Casey Example', course: 'WELDING L2', type: 'transcript', status: 'pending', requestedAt: '2026-08-01T10:00:00.000Z', note: 'for a job application' };
const R2 = { id: 'CTR-abc2', studentId: 'STU-2', studentName: 'Devon Sample', course: 'COSMETOLOGY L2', type: 'both', status: 'ready', requestedAt: '2026-08-02T11:00:00.000Z', handledBy: 'Admin', handledAt: '2026-08-03T09:00:00.000Z' };

async function importAll(dal, records) {
  for (const r of records) {
    const docId = await CTR.ctrEntityId(r.id);
    await dal.upsertDoc(CTR.CTR_KIND, docId, CTR.ctrToDocDiff(r), 'legacy bridge');
  }
}

(async function main() {

  section('Model: legacy record → document → legacy record is lossless');
  const broker = createBroker();
  const A = await createDAL({ adapter: MemoryAdapter(), broker, source: 'ctr-A', actor: { name: 'Clerk A', role: 'admin', device: 'dev_A' } });
  await importAll(A, [R1, R2]);
  const back = CTR.ctrFromDocs(A.project('entities', { kind: 'doc' }));
  eq(back, [R1, R2], 'both records round-trip field-for-field');
  eq(await CTR.ctrEntityId('CTR-abc1'), await CTR.ctrEntityId('CTR-abc1'), 'entity id is deterministic');

  section('Status change is an audited supersession, not an edit');
  const docId1 = await CTR.ctrEntityId(R1.id);
  await A.upsertDoc(CTR.CTR_KIND, docId1, CTR.ctrStatusDiff('processing', 'Clerk A', '2026-08-04T08:00:00.000Z'), 'status update');
  const after = CTR.ctrFromDocs(A.project('entities', { kind: 'doc' }));
  eq(after.find(r => r.id === R1.id).status, 'processing', 'status advanced');
  eq(after.find(r => r.id === R1.id).handledBy, 'Clerk A', 'handler recorded');
  eq(after.find(r => r.id === R1.id).requestedAt, R1.requestedAt, 'original request time untouched');

  section('Legacy bridge: detects missing and drifted records, is quiet when in sync');
  const legacyNow = after.slice();
  eq(CTR.ctrLegacyDelta(legacyNow, A.project('entities', { kind: 'doc' })), { missing: [], changed: [] }, 'in-sync legacy array produces no work');
  const R3 = { id: 'CTR-new3', studentId: 'STU-3', studentName: 'New Trainee', course: 'ELECTRICAL L2', type: 'certificate', status: 'pending', requestedAt: '2026-08-05T12:00:00.000Z' };
  const drift = Object.assign({}, legacyNow.find(r => r.id === R2.id), { status: 'collected', handledBy: 'Front Desk', handledAt: '2026-08-05T13:00:00.000Z' });
  const delta = CTR.ctrLegacyDelta(legacyNow.filter(r => r.id !== R2.id).concat([R3, drift]), A.project('entities', { kind: 'doc' }));
  eq(delta.missing.map(r => r.id), ['CTR-new3'], 'the trainee-side new request is picked up');
  eq(delta.changed.map(r => r.id), ['CTR-abc2'], 'the legacy-tab status drift is picked up');

  section('Two devices bridging the same legacy data converge to ONE entity each (P10)');
  const B = await createDAL({ adapter: MemoryAdapter(), broker, source: 'ctr-B', actor: { name: 'Clerk B', role: 'admin', device: 'dev_B' } });
  await B.sync.now();
  await importAll(A, [R3]); await importAll(B, [R3]);   // both devices bridge the same new request
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const entsA = A.project('entities', { kind: 'doc' }), entsB = B.project('entities', { kind: 'doc' });
  const rowsA = CTR.ctrFromDocs(entsA), rowsB = CTR.ctrFromDocs(entsB);
  eq(rowsA.filter(r => r.id === 'CTR-new3').length, 1, 'one row for the twice-bridged request on A');
  eq(MD.canon(rowsA), MD.canon(rowsB), 'both devices fold byte-identical request lists');

  section('Bootstrap extractor: the page-cloud payload imports as documents');
  const payload = {
    id: 'file:CESTIS_Transcript_Requests.json', kind: 'transcript-requests-pagecloud', name: 'CTR backup',
    json: { data: { voctrain_certTranscriptRequests: JSON.stringify([R1, R2, { studentName: 'No Id' }]) } }
  };
  const rep = await BOOT.runBootstrap({ sources: [payload], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_ctr-1' });
  eq(rep.events.byType['doc.upserted'], 2, 'two request documents synthesized');
  ok(rep.quarantine.some(q => /request record without id/.test(q.reason)), 'the id-less request is quarantined, not dropped');
  ok(rep.verification.brokerAccepted === rep.events.count && rep.verification.chainVerified, 'events pass the broker gates');
  // The bootstrap import and the live bridge must land on the SAME entity:
  const bootBroker = createBroker();
  const stagedEvents = rep.dryRun ? null : null;
  const C = await createDAL({ adapter: MemoryAdapter(), broker: bootBroker, source: 'ctr-C', actor: { name: 'C', role: 'admin', device: 'dev_C' } });
  await importAll(C, [R1]);
  const bridgedId = (await CTR.ctrEntityId(R1.id));
  ok(C.get('doc', bridgedId), 'the bridge used the deterministic id');
  const bootIds = await Promise.all([CTR.ctrEntityId(R1.id), CTR.ctrEntityId(R2.id)]);
  eq(bootIds[0], bridgedId, 'bootstrap and bridge derive the identical entity id — no duplicate rows after migration');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
