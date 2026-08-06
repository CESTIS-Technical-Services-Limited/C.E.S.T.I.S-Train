/* MegaData — Transcript-Grades docsync: bootstrap↔bridge doc-id agreement
   for all four collections (the drift guard), local-edit push, remote-edit
   apply without ping-pong, both-changed last-writer, soft removal + revive
   under the SAME deterministic id, canonical-only mirror-in, the profiles
   object-map boundary, and the same-edit two-device race.
   Run: node tests/megadata-tg.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const DS = require('../megadata/pages/docsync-model.js');
const TG = require('../megadata/pages/tg-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const GRADE = { id: 'MG::S1::Q1::U101', studentId: 'S1', qualId: 'Q1', unitCode: 'U101', grade: 88, date: '01/07/2026', source: 'manual', examResultId: null, updatedBy: 'Admin', updatedAt: '2026-07-01T00:00:00.000Z' };
const CATALOG = { id: 'Q1', name: 'Welding Level 2', units: [{ code: 'U101', title: 'Safety' }] };
const PROFILE = { studentId: 'S1', profile: { dob: '01/01/2002', address: '12 Main St', idNo: 'ID-9' } };
const EXAMRES = { id: 'ER1', examId: 'EX1', studentId: 'S1', score: 88, passed: true };

const specOf = kind => TG.TG_SPECS.find(s => s.kind === kind);
async function tick(dal, spec, local, baseline) {
  const plan = await DS.docSyncPlan(dal, spec, local, baseline || {});
  await DS.docSyncPush(dal, plan, 'TG');
  await dal.sync.now();
  return plan;
}
async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'tg-' + dev, actor: { name: 'TG ' + dev, role: 'admin', device: 'dev_' + dev } });
}

(async function main() {

  section('Drift guard: bootstrap and docsync derive IDENTICAL doc ids for all four collections');
  const payload = { id: 'test:tg', kind: 'transcript-grades-pagecloud', name: 'tg', json: { data: {
    voctrain_transcriptGrades: JSON.stringify([GRADE]),
    voctrain_unitCatalogs: JSON.stringify([CATALOG]),
    voctrain_transcriptProfiles: JSON.stringify({ S1: PROFILE.profile })
  } } };
  const spPayload = { id: 'test:tg-sp', kind: 'student-progress-pagecloud', name: 'sp', json: { data: {
    voctrain_students: '[]', voctrain_deletedStudentIds: '[]', voctrain_examResults: JSON.stringify([EXAMRES])
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload, spPayload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_tg-1' });
  const bootEvents = await st.get('staging', 'events');
  for (const [kind, raw] of [['transcriptGrade', GRADE], ['unitCatalog', CATALOG], ['transcriptProfile', PROFILE], ['legacyExamResult', EXAMRES]]) {
    const spec = specOf(kind);
    const wantId = await RM.bootstrapId('doc', spec.bootKey(raw));
    const evt = bootEvents.find(e => e.type === 'doc.upserted' && e.payload.kind === kind);
    eq(evt && evt.entity.id, wantId, kind + ' doc id agrees between bootstrap and the bridge spec');
  }

  section('Local edit pushes; a re-run goes quiet; the fold carries the value');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const gSpec = specOf('transcriptGrade');
  const p1 = await tick(A, gSpec, [GRADE], {});
  eq(p1.pushes.length, 1, 'first contact: the whole record pushes');
  const gDocId = await RM.bootstrapId('doc', gSpec.bootKey(GRADE));
  eq(A.get('doc', gDocId).fields.grade, 88, 'the canonical doc folds the grade');
  const p2 = await tick(A, gSpec, [GRADE], p1.newBaseline);
  eq(p2.pushes.length + p2.applies.length, 0, 'unchanged: the sync goes quiet');
  const editedGrade = Object.assign({}, GRADE, { grade: 92, updatedAt: '2026-07-02T00:00:00.000Z' });
  const p3 = await tick(A, gSpec, [editedGrade], p2.newBaseline);
  eq(p3.pushes.length, 1, 'the edit pushes');
  eq(A.get('doc', gDocId).fields.grade, 92, 'and folds');

  section('Remote edit APPLIES on the other device — no ping-pong');
  const B = await freshDal(broker, 'B');
  await B.sync.now();
  const pB1 = await tick(B, gSpec, [GRADE], { [gDocId]: Object.assign({}, GRADE) });   // B's baseline knows the OLD state
  eq(pB1.pushes.length, 0, "B's stale copy is NOT treated as an edit");
  eq(pB1.applies.length, 1, "A's edit lands in B's apply list");
  const applied = DS.docSyncApply(gSpec, [GRADE], pB1);
  eq(applied.records[0].grade, 92, 'the grade applies into the legacy record');
  const pB2 = await tick(B, gSpec, applied.records, pB1.newBaseline);
  eq(pB2.pushes.length + pB2.applies.length, 0, 'after applying, B goes quiet');

  section('Both-changed: local pushes as LAST WRITER, conflict reported, both audited');
  const localEdit = Object.assign({}, editedGrade, { grade: 95 });
  await tick(B, gSpec, [Object.assign({}, editedGrade, { grade: 90 })], pB2.newBaseline);
  await A.sync.now();
  const pC = await tick(A, gSpec, [localEdit], p3.newBaseline);
  eq(pC.conflicts.length, 1, 'the both-changed field is reported');
  eq(pC.conflicts[0].field, 'grade', 'naming the field');
  eq(A.get('doc', gDocId).fields.grade, 95, "A's push is the last writer");
  const gradeEvents = broker._state.events.filter(e => e.entity.id === gDocId && e.type === 'doc.upserted');
  ok(gradeEvents.length >= 3, 'every version is in the audit trail (' + gradeEvents.length + ' upserts)');

  section('Removal is a SOFT flag; re-adding the same id REVIVES — the page really does this');
  const pD = await tick(A, gSpec, [], pC.newBaseline);                  // grade cleared locally
  eq(pD.pushes.length, 1, 'the removal pushes');
  eq(pD.pushes[0].diff, { _removed: true }, 'as the _removed flag, not a tombstone');
  ok(A.get('doc', gDocId).alive, 'the doc entity stays ALIVE (revivable)');
  await B.sync.now();
  const pE = await DS.docSyncPlan(B, gSpec, applied.records.map(r => Object.assign({}, r, { grade: 92 })), pB2.newBaseline);
  eq(pE.removals.length, 1, "the removal mirrors OUT to B");
  const bAfterRemove = DS.docSyncApply(gSpec, applied.records, pE);
  eq(bAfterRemove.records.length, 0, "the grade leaves B's list");
  const reAdd = Object.assign({}, GRADE, { grade: 70, date: '05/07/2026' });
  const pF = await tick(A, gSpec, [reAdd], pD.newBaseline);
  eq(pF.pushes.length, 1, 're-adding under the SAME deterministic id pushes a revival');
  eq(pF.pushes[0].diff._removed, false, 'clearing the flag');
  eq(A.get('doc', gDocId).fields.grade, 70, 'with the new grade folded');
  await B.sync.now();
  const pG = await DS.docSyncPlan(B, gSpec, [], pE.newBaseline);
  eq(pG.newLocal.length, 1, 'the revived grade mirrors back IN on B');
  eq(pG.newLocal[0].grade, 70, 'with its new value');
  ok(!('_removed' in pG.newLocal[0]), 'and the flag never leaks into a legacy record');

  section('Canonical-only records mirror in; the profiles object-map converts at the boundary');
  const profSpec = specOf('transcriptProfile');
  const pH = await tick(A, profSpec, TG.profilesToList({ S1: PROFILE.profile }), {});
  eq(pH.pushes.length, 1, "A pushes S1's profile");
  await B.sync.now();
  const pI = await DS.docSyncPlan(B, profSpec, TG.profilesToList({}), {});
  eq(pI.newLocal.length, 1, "the profile B has never seen mirrors in");
  const bProfiles = TG.listToProfiles(DS.docSyncApply(profSpec, [], pI).records);
  eq(bProfiles.S1.address, '12 Main St', 'and converts back into the {studentId → profile} map the page stores');

  section('Nested-object edits diff correctly (canonical comparison, not string coercion)');
  const editedProfile = { studentId: 'S1', profile: { dob: '01/01/2002', address: '14 New Rd', idNo: 'ID-9' } };
  const pJ = await tick(A, profSpec, [editedProfile], pH.newBaseline);
  eq(pJ.pushes.length, 1, 'the address change inside the nested profile object is detected');
  const profDocId = await RM.bootstrapId('doc', profSpec.bootKey(PROFILE));
  eq(A.get('doc', profDocId).fields.profile.address, '14 New Rd', 'and folds');

  section('Two devices race the SAME edit — one event (P10)');
  const raceSpec = specOf('unitCatalog');
  const pK1 = await tick(A, raceSpec, [CATALOG], {});
  await B.sync.now();
  const catDocId = await RM.bootstrapId('doc', raceSpec.bootKey(CATALOG));
  const catEdit = Object.assign({}, CATALOG, { name: 'Welding Level 2 (2026)' });
  const planX = await DS.docSyncPlan(A, raceSpec, [catEdit], pK1.newBaseline);
  const planY = await DS.docSyncPlan(B, raceSpec, [JSON.parse(JSON.stringify(catEdit))], pK1.newBaseline);
  await DS.docSyncPush(A, planX, 'TG'); await DS.docSyncPush(B, planY, 'TG');
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const catEvents = broker._state.events.filter(e => e.entity.id === catDocId && e.type === 'doc.upserted' && e.payload.diff.name === 'Welding Level 2 (2026)');
  eq(catEvents.length, 1, 'same state + same diff → same event id → ONE event in the log');
  eq(B.head().unsynced, 0, "the loser's replay was answered with the original ack");
  eq(MD.canon(A.get('doc', catDocId).fields), MD.canon(B.get('doc', catDocId).fields), 'both devices fold identical catalogues');
  eq(A.get('doc', catDocId).fields.units, CATALOG.units,
    'ARRAY fields fold as data — the [old,new] pair convention that silently truncated them is gone');
  ok(await broker.verifyChain(), 'the log chain verifies after the whole exercise');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
