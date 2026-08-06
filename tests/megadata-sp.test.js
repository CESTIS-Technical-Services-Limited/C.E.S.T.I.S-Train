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

// The exact sequence sp-page.js performs for one legacy record.
async function bridgeRecord(dal, rec) {
  const ids = await RM.identityIds('id:' + rec.id, rec.course);
  const steps = [];
  if (!dal.get('programme', ids.programmeId)) steps.push(['programme.defined', ids.programmeId, { name: rec.course || 'Unassigned' }, null, 'programme|' + ids.progNorm]);
  if (!dal.get('intake', ids.intakeId)) steps.push(['intake.opened', ids.intakeId, { label: (rec.course || 'Unassigned') + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids.programmeId }, 'intake|' + ids.progNorm]);
  if (!dal.get('person', ids.personId)) steps.push(['person.registered', ids.personId, RM.lmsBio(rec), null, 'person|id:' + rec.id]);
  if (!dal.get('enrolment', ids.enrolmentId)) {
    const enrolledAt = /^\d{4}-\d{2}-\d{2}/.test(String(rec.enrolmentDate || '')) ? String(rec.enrolmentDate).slice(0, 10) : '2024-04-01';
    steps.push(['enrolment.created', ids.enrolmentId, { enrolledAt }, { person: ids.personId, intake: ids.intakeId }, 'enrolment|id:' + rec.id + '|' + ids.progNorm]);
  }
  for (const st of steps) {
    const evtId = await RM.bridgeEventId(st[4]);
    await dal._accept(st[0], st[1], st[2], { id: evtId, refs: st[3] || undefined, prov: { importRun: 'bridge', srcFile: 'SP', srcPath: rec.id } })
      .catch(e => { if (!/exists/.test(e.message)) throw e; });
  }
  const doc = dal.get('doc', ids.rosterDocId);
  if (RM.rosterDrifted(rec, doc)) {
    const evtId = doc ? undefined : await RM.bridgeEventId('roster-init|id:' + rec.id + '|' + ids.progNorm);
    await dal._accept('doc.upserted', ids.rosterDocId, { kind: 'legacyRoster', diff: RM.lmsRosterDiff(rec), reason: doc ? 'legacy drift' : 'legacy bridge' }, { id: evtId, prov: { importRun: 'bridge', srcFile: 'SP', srcPath: rec.id } });
  }
  return ids;
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
  await bridgeRecord(A, REC);
  ok(A.get('person', ids.personId), 'person exists');
  ok(A.get('enrolment', ids.enrolmentId), 'enrolment exists');
  eq(A.get('doc', ids.rosterDocId).fields.stage, 'training', 'roster document carries the presentation scalars');
  eq(A.get('person', ids.personId).fields.names.full, 'Bridge Person', 'bio mapped');
  await A.sync.now();

  section('Two devices bridging the same trainee converge with no duplicates (P10)');
  const B = await createDAL({ adapter: MemoryAdapter(), broker, source: 'sp-B', actor: { name: 'B', role: 'admin', device: 'dev_B' } });
  // B has NOT pulled yet — it sees an empty store and bridges the same record.
  await bridgeRecord(B, REC);
  await B.sync.now(); await A.sync.now(); await B.sync.now();
  const persons = broker._state.events.filter(e => e.type === 'person.registered' && e.entity.id === ids.personId);
  eq(persons.length, 1, 'exactly ONE person.registered in the log — the race deduped by event id');
  eq(B.head().unsynced, 0, "B's duplicate creations were answered with the original acks, not quarantined");
  eq(MD.canon(A.project('entities', { kind: 'person' })), MD.canon(B.project('entities', { kind: 'person' })), 'both devices fold identical people');

  section('Roster drift: a legacy edit becomes an audited document update');
  const edited = Object.assign({}, REC, { stage: 'certified', progress: 90, certNo: 'WE-2026-1234' });
  ok(RM.rosterDrifted(edited, A.get('doc', ids.rosterDocId)), 'the edit is detected as drift');
  await bridgeRecord(A, edited);
  eq(A.get('doc', ids.rosterDocId).fields.stage, 'certified', 'stage updated');
  eq(A.get('doc', ids.rosterDocId).fields.certNo, 'WE-2026-1234', 'certNo captured');
  ok(!RM.rosterDrifted(edited, A.get('doc', ids.rosterDocId)), 'and the record is now in sync — the bridge goes quiet');
  await A.sync.now(); await B.sync.now();
  eq(B.get('doc', ids.rosterDocId).fields.stage, 'certified', 'the drift update reached device B');
  ok(await broker.verifyChain(), 'the log chain verifies after everything');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
