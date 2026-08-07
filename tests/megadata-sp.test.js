/* MegaData — Student-Progress bridge: bootstrap↔bridge id agreement (the
   drift guard), full-chain creation, two-device race convergence via
   deterministic event ids, and roster drift updates.
   Run: node tests/megadata-sp.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';
const REC = { id: 'L1', name: 'Bridge Person', course: 'Welding L2', stage: 'training', progress: 40, gpa: '3.2', dob: '2002-03-04', phone: '876-555-0100', enrolmentDate: '2026-01-10' };

// The page's per-record creation path is now the MODEL's spBridgeRecord —
// tested directly, no duplicated sequence to drift. Stage-2 merge helpers:
async function mergeTick(dal, students, deletedIds, baseline) {
  const plan = await RM.spMergePlan(dal, { students, deletedIds: deletedIds || [] }, baseline || {});
  await RM.spPushPlan(dal, plan, 'SP');
  await dal.sync.now();
  return plan;
}

(async function main() {

  section('Drift guard: bootstrap and the live bridge derive IDENTICAL entity ids');
  const spPayload = { id: 'test:sp', kind: 'student-progress-pagecloud', name: 'sp', json: { data: { voctrain_students: JSON.stringify([REC]), voctrain_deletedStudentIds: '[]' } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [spPayload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_sp-1' });
  const bootEvents = await st.get('staging', 'events');
  const ids = await RM.identityIds('id:' + REC.id, REC.course);
  eq(bootEvents.find(e => e.type === 'person.registered').entity.id, ids.personId, 'person id agrees');
  eq(bootEvents.find(e => e.type === 'enrolment.created').entity.id, ids.enrolmentId, 'enrolment id agrees');
  eq(bootEvents.find(e => e.type === 'doc.upserted').entity.id, ids.rosterDocId, 'roster document id agrees');
  eq(bootEvents.find(e => e.type === 'programme.defined').entity.id, ids.programmeId, 'programme id agrees');

  section('The bridge creates the full chain on an empty store');
  const broker = createBroker();
  const A = await createDAL({ adapter: MemoryAdapter(), broker, source: 'sp-A', actor: { name: 'A', role: 'admin', device: 'dev_A' } });
  await RM.spBridgeRecord(A, REC, 'SP');
  ok(A.get('person', ids.personId), 'person exists');
  ok(A.get('enrolment', ids.enrolmentId), 'enrolment exists');
  eq(A.get('doc', ids.rosterDocId).fields.stage, 'training', 'roster document carries the presentation scalars');
  eq(A.get('person', ids.personId).fields.names.full, 'Bridge Person', 'bio mapped');
  await A.sync.now();

  section('Two devices bridging the same trainee converge with no duplicates (P10)');
  const B = await createDAL({ adapter: MemoryAdapter(), broker, source: 'sp-B', actor: { name: 'B', role: 'admin', device: 'dev_B' } });
  // B has NOT pulled yet — it sees an empty store and bridges the same record.
  await RM.spBridgeRecord(B, REC, 'SP');
  await B.sync.now(); await A.sync.now(); await B.sync.now();
  const persons = broker._state.events.filter(e => e.type === 'person.registered' && e.entity.id === ids.personId);
  eq(persons.length, 1, 'exactly ONE person.registered in the log — the race deduped by event id');
  eq(B.head().unsynced, 0, "B's duplicate creations were answered with the original acks, not quarantined");
  eq(MD.canon(A.project('entities', { kind: 'person' })), MD.canon(B.project('entities', { kind: 'person' })), 'both devices fold identical people');

  section('Roster drift: a legacy edit becomes an audited document update (merge tick)');
  const edited = Object.assign({}, REC, { stage: 'certified', progress: 90, certNo: 'WE-2026-1234' });
  ok(RM.rosterDrifted(edited, A.get('doc', ids.rosterDocId)), 'the edit is detected as drift');
  const planA = await mergeTick(A, [edited], [], {});
  eq(A.get('doc', ids.rosterDocId).fields.stage, 'certified', 'stage updated');
  eq(A.get('doc', ids.rosterDocId).fields.certNo, 'WE-2026-1234', 'certNo captured');
  ok(!RM.rosterDrifted(edited, A.get('doc', ids.rosterDocId)), 'and the record is now in sync — the bridge goes quiet');
  await B.sync.now();
  eq(B.get('doc', ids.rosterDocId).fields.stage, 'certified', 'the drift update reached device B');
  ok(await broker.verifyChain(), 'the log chain verifies after everything');
  const baselineA = planA.newBaseline;

  section('Stage 2: a remote edit APPLIES to the local legacy record instead of ping-ponging');
  // Device B (with a fresh baseline from a clean tick) sees A's next edit.
  const planB0 = await mergeTick(B, [JSON.parse(JSON.stringify(edited))], [], {});
  const baselineB = planB0.newBaseline;
  const edited2 = Object.assign({}, edited, { progress: 95, notes: 'ready for cert pickup' });
  await mergeTick(A, [edited2], [], baselineA);
  await B.sync.now();
  const staleB = JSON.parse(JSON.stringify(edited));                     // B's legacy copy has NOT seen the change
  const planB1 = await mergeTick(B, [staleB], [], baselineB);
  eq(planB1.pushRoster.length, 0, "B pushes NOTHING — its stale copy is not treated as an edit");
  eq(planB1.applies.length, 1, "the remote change lands in B's apply list");
  const applied = RM.spApplyPlanToLegacy([staleB], [], planB1);
  eq(applied.students[0].progress, 95, 'progress applied to the legacy record');
  eq(applied.students[0].notes, 'ready for cert pickup', 'notes applied');
  ok(applied.changed, 'and the page is told to persist + re-render');
  eq((await mergeTick(B, applied.students, [], planB1.newBaseline)).applies.length, 0, 'after applying, B goes quiet (no ping-pong)');

  section('Stage 2: both-changed conflict pushes local as LAST WRITER, both versions audited');
  const planC0 = await mergeTick(A, [edited2], [], baselineA);          // refresh A's baseline
  const localEdit = Object.assign({}, edited2, { notes: 'local wins note' });
  await mergeTick(B, [Object.assign({}, edited2, { notes: 'remote note' })], [], planB1.newBaseline);
  await A.sync.now();                                                    // A pulls B's edit BEFORE its own tick
  const planC1 = await mergeTick(A, [localEdit], [], planC0.newBaseline);
  eq(planC1.conflicts.length, 1, 'the both-changed field is reported as a conflict');
  eq(planC1.conflicts[0].field, 'notes', 'naming the field');
  eq(A.get('doc', ids.rosterDocId).fields.notes, 'local wins note', "A's push is the last writer");
  const noteEvents = broker._state.events.filter(e => e.entity.id === ids.rosterDocId && e.type === 'doc.upserted' && e.payload.diff.notes);
  ok(noteEvents.length >= 2, 'BOTH versions are in the audit trail (' + noteEvents.length + ' note edits)');

  section('Stage 2: a bio edit becomes person.corrected, and applies remotely');
  const bioEdit = Object.assign({}, localEdit, { contact: '876-555-0199', email: 'bridge@cestis.example' });
  const planD = await mergeTick(A, [bioEdit], [], planC1.newBaseline);
  eq(planD.pushBio.length, 1, 'the contact change pushes as a bio correction');
  eq(A.get('person', ids.personId).fields.contacts.phone, '876-555-0199', 'the person entity folds the new phone');
  await B.sync.now();
  const planE = await mergeTick(B, [JSON.parse(JSON.stringify(localEdit))], [], planC1.newBaseline);
  const bioApplied = RM.spApplyPlanToLegacy([JSON.parse(JSON.stringify(localEdit))], [], planE);
  eq(bioApplied.students[0].contact, '876-555-0199', "the phone lands in B's legacy record field 'contact'");
  eq(bioApplied.students[0].email, 'bridge@cestis.example', 'and the email');

  section('Stage 2: a canonical-only trainee mirrors IN as a legacy record');
  const REC2 = { id: 'L2', name: 'Mirror Trainee', course: 'Welding L2', stage: 'training', progress: 10, enrolmentDate: '2026-02-01', contact: '876-555-0142' };
  await RM.spBridgeRecord(A, REC2, 'SP');
  await A.sync.now(); await B.sync.now();
  const planF = await RM.spMergePlan(B, { students: [JSON.parse(JSON.stringify(localEdit))], deletedIds: [] }, planE.newBaseline);
  eq(planF.newRecords.length, 1, "the trainee B has never seen appears in B's mirror-in list");
  eq(planF.newRecords[0].id, 'L2', 'under the original legacy id');
  eq(planF.newRecords[0].name, 'Mirror Trainee', 'with the bio');
  eq(planF.newRecords[0].course, 'Welding L2', 'the course reconstructed from programme');
  eq(planF.newRecords[0].stage, 'training', 'and the roster scalars');
  const withNew = RM.spApplyPlanToLegacy([JSON.parse(JSON.stringify(localEdit))], [], planF);
  eq(withNew.students.length, 2, 'applied: the record joins the legacy roster');

  section('Stage 2: a local deletion tombstones the DOC and withdraws the enrolment — never the person (D11)');
  const ids2 = await RM.identityIds('id:L2', 'Welding L2');
  const planG = await mergeTick(A, [bioEdit], ['L2'], planD.newBaseline);
  eq(planG.tombstones.length, 1, 'the deletion is planned as a doc tombstone');
  ok(!A.get('doc', ids2.rosterDocId).alive, 'the roster doc is tombstoned');
  eq(A.get('enrolment', ids2.enrolmentId).fields.status, 'withdrawn', 'the enrolment is withdrawn');
  ok(A.get('person', ids2.personId).alive, 'the PERSON stays alive — the fee book may still need them');
  await B.sync.now();
  const planH = await RM.spMergePlan(B, { students: withNew.students, deletedIds: [] }, planF.newBaseline);
  eq(planH.removals, ['L2'], "the deletion mirrors OUT to B as a removal");
  const afterRemoval = RM.spApplyPlanToLegacy(withNew.students, [], planH);
  eq(afterRemoval.students.length, 1, "the record leaves B's roster");
  eq(afterRemoval.deletedIds, ['L2'], "and B's tombstone list records it — page-cloud will not resurrect it");
  eq((await RM.spMergePlan(B, { students: afterRemoval.students, deletedIds: afterRemoval.deletedIds }, planH.newBaseline)).newRecords.length, 0,
    'a tombstoned trainee is never mirrored back in');

  section('Stage 2: two devices race the SAME edit — one event, no duplicates (P10)');
  const raceEdit = Object.assign({}, bioEdit, { progress: 99 });
  const planR1 = await RM.spMergePlan(A, { students: [raceEdit], deletedIds: ['L2'] }, planG.newBaseline);
  const planR2 = await RM.spMergePlan(B, { students: [JSON.parse(JSON.stringify(raceEdit))], deletedIds: ['L2'] }, planG.newBaseline);
  await RM.spPushPlan(A, planR1, 'SP'); await RM.spPushPlan(B, planR2, 'SP');
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const progressEvents = broker._state.events.filter(e => e.entity.id === ids.rosterDocId && e.type === 'doc.upserted' && e.payload.diff.progress === 99);
  eq(progressEvents.length, 1, 'same state + same diff → same event id → broker deduped the race to ONE event');
  eq(B.head().unsynced, 0, "the loser's replay was answered with the original ack");
  eq(MD.canon(A.get('doc', ids.rosterDocId).fields), MD.canon(B.get('doc', ids.rosterDocId).fields), 'both devices fold identical roster fields');
  ok(await broker.verifyChain(), 'the log chain verifies after the whole stage-2 exercise');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
