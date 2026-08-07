/* MegaData — LMS dashboard bridge: the shared LMS_COLLECTIONS table drives
   BOTH the bootstrap extractor and the live specs (drift-guarded per mode),
   every collection has a spec, and each storage shape (array / objmap /
   msgmap / single) round-trips: push → mirror-in on a second device →
   byte-faithful storage reconstruction. Run: node tests/megadata-lms.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const DS = require('../megadata/pages/docsync-model.js');
const LM = require('../megadata/pages/lms-model.js');
const LC = require('../megadata/lms-collections.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const EXAM = { id: 'EX1', title: 'Welding Theory 1', passMark: 60 };
const TEMPLATE_KEY = 'classic-blue';
const TEMPLATE = { name: 'Classic Blue', accent: '#1a5fb4' };
const MSG = { id: 'M1', from: 'admin', text: 'Term starts Monday', at: '2026-07-01T09:00:00.000Z' };
const SETTINGS = { schoolName: 'CESTIS', locale: 'en-JM' };

const specs = LM.lmsSpecs();
const specOf = kind => specs.find(s => s.kind === kind);
async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'lms-' + dev, actor: { name: 'LMS ' + dev, role: 'admin', device: 'dev_' + dev } });
}
async function push(dal, spec, storageValue, baseline) {
  const parts = LM.lmsDecompose(spec, storageValue);
  const local = spec.mode === 'objmap' ? parts.records.filter(r => r.__k) : parts.records;
  const plan = await DS.docSyncPlan(dal, spec, local, baseline || {});
  await DS.docSyncPush(dal, plan, 'LMS');
  await dal.sync.now();
  return { plan, parts };
}

(async function main() {

  section('Coverage: every collection in the shared table has a live spec');
  eq(specs.length, LC.LMS_COLLECTIONS.length, 'spec count equals table count (' + LC.LMS_COLLECTIONS.length + ')');
  ok(specs.every(s => s.storageKey && s.kind && s.bootKey), 'each spec carries storage key, kind and boot key');

  section('Drift guard: bootstrap and the live specs derive IDENTICAL doc ids — one per mode');
  const payload = { id: 'test:lms2', kind: 'lms-backup', name: 'lms', json: { data: {
    voctrain_exams: JSON.stringify([EXAM]),
    voctrain_certTemplates: JSON.stringify({ [TEMPLATE_KEY]: TEMPLATE }),
    voctrain_chatMessages: JSON.stringify({ ROOM1: [MSG] }),
    voctrain_systemSettings: JSON.stringify(SETTINGS)
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_lms2-1' });
  const bootEvents = await st.get('staging', 'events');
  const cases = [
    ['exam', LM.lmsDecompose(specOf('exam'), [EXAM]).records[0]],
    ['certTemplate', LM.lmsDecompose(specOf('certTemplate'), { [TEMPLATE_KEY]: TEMPLATE }).records[0]],
    ['chatMessage', LM.lmsDecompose(specOf('chatMessage'), { ROOM1: [MSG] }).records[0]],
    ['systemSettings', LM.lmsDecompose(specOf('systemSettings'), SETTINGS).records[0]]
  ];
  for (const [kind, rec] of cases) {
    const wantId = await RM.bootstrapId('doc', specOf(kind).bootKey(rec));
    const evt = bootEvents.find(e => e.type === 'doc.upserted' && e.payload.kind === kind);
    eq(evt && evt.entity.id, wantId, kind + ' (' + specOf(kind).mode + ' mode) doc id agrees');
  }

  section('Array mode: push, edit, mirror-in on a fresh device');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const B = await freshDal(broker, 'B');
  const eSpec = specOf('exam');
  const p1 = await push(A, eSpec, [EXAM], {});
  eq(p1.plan.pushes.length, 1, 'the exam pushes');
  await B.sync.now();
  const pB = await DS.docSyncPlan(B, eSpec, [], {});
  eq(pB.newLocal.length, 1, 'it mirrors in on B');
  eq(LM.lmsRecompose(eSpec, DS.docSyncApply(eSpec, [], pB).records, []), [{ id: 'EX1', title: 'Welding Theory 1', passMark: 60 }], 'and reconstructs the storage array byte-faithfully');

  section('Objmap mode: the map key rides as __k and converts back');
  const tSpec = specOf('certTemplate');
  const pT = await push(A, tSpec, { [TEMPLATE_KEY]: TEMPLATE }, {});
  eq(pT.plan.pushes.length, 1, 'the template pushes');
  await B.sync.now();
  const pTB = await DS.docSyncPlan(B, tSpec, [], {});
  eq(pTB.newLocal.length, 1, 'mirrors in');
  eq(LM.lmsRecompose(tSpec, DS.docSyncApply(tSpec, [], pTB).records, []), { [TEMPLATE_KEY]: TEMPLATE }, 'and regains the { key → value } map shape');

  section('Msgmap mode: chat messages carry their room and regroup on the way back');
  const mSpec = specOf('chatMessage');
  const MSG2 = { id: 'M2', from: 'staff', text: 'Room list posted', at: '2026-07-01T10:00:00.000Z' };
  const pM = await push(A, mSpec, { ROOM1: [MSG], ROOM2: [MSG2] }, {});
  eq(pM.plan.pushes.length, 2, 'both messages push');
  await B.sync.now();
  const pMB = await DS.docSyncPlan(B, mSpec, [], {});
  eq(pMB.newLocal.length, 2, 'both mirror in');
  const rebuilt = LM.lmsRecompose(mSpec, DS.docSyncApply(mSpec, [], pMB).records, []);
  eq(Object.keys(rebuilt).sort(), ['ROOM1', 'ROOM2'], 'rooms regrouped');
  eq(rebuilt.ROOM1[0].text, 'Term starts Monday', 'message intact, roomId not leaked into the message');
  ok(!('roomId' in rebuilt.ROOM1[0]), 'the rider field is stripped on recompose');

  section('Single mode: settings replace as one doc, edits flow both ways');
  const sSpec = specOf('systemSettings');
  const pS = await push(A, sSpec, SETTINGS, {});
  eq(pS.plan.pushes.length, 1, 'settings push as ONE doc');
  const edited = Object.assign({}, SETTINGS, { locale: 'en-GB' });
  const pS2 = await push(A, sSpec, edited, pS.plan.newBaseline);
  eq(pS2.plan.pushes.length, 1, 'the locale change pushes');
  await B.sync.now();
  const pSB = await DS.docSyncPlan(B, sSpec, [SETTINGS], { [(await RM.bootstrapId('doc', 'systemSettings|singleton'))]: Object.assign({}, SETTINGS) });
  eq(pSB.applies.length, 1, "and applies onto B's stale copy");
  eq(LM.lmsRecompose(sSpec, DS.docSyncApply(sSpec, LM.lmsDecompose(sSpec, SETTINGS).records, pSB).records, []).locale, 'en-GB', 'B reads the new locale');

  section('Unkeyed records are reported and preserved, never synced, never dropped');
  const parts = LM.lmsDecompose(eSpec, [EXAM, { title: 'no id row' }]);
  eq(parts.records.length, 1, 'only the keyed exam enters the sync');
  eq(parts.unkeyed.length, 1, 'the id-less row is reported');
  eq(LM.lmsRecompose(eSpec, parts.records, parts.unkeyed).length, 2, 'and stays in storage on recompose');

  ok(await broker.verifyChain(), 'the log chain verifies after the whole exercise');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
