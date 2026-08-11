/* MegaData — adjudication queue: bootstrap items become canonical docs,
   pending/decided folding, money-at-stake ordering, keep-separate / merge /
   defer dispositions (merge folds person.merged: loser dead, winner
   resolved), same-decision race convergence, and the every-item-disposed
   cutover gate. Run: node tests/megadata-adjq.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const AQ = require('../megadata/pages/adjq-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

// Two fee records sharing an id-link but with DIFFERENT names (the classic
// conflicting-link case) + a same-name+dob pair (merge candidates).
const payload = { id: 'test:adjq', kind: 'schoolfee-pagecloud', name: 'adjq', json: { data: {
  cestiSchoolFeeStudents: JSON.stringify([
    { id: 'SF-A1', lmsId: 'LINK9', name: 'Person One', skillArea: 'WELDING L2', tuitionFee: 400, updatedAt: '2026-01-02' },
    { id: 'SF-A2', lmsId: 'LINK9', name: 'Person Two', skillArea: 'WELDING L2', tuitionFee: 150 },
    { id: 'SF-B1', name: 'Twin Case', dateOfBirth: '2001-05-05', skillArea: 'COSMETOLOGY L2', tuitionFee: 90 },
    { id: 'SF-B2', name: 'Twin Case', dateOfBirth: '2001-05-05', skillArea: 'COSMETOLOGY L2', tuitionFee: 60 }
  ]),
  cestiSchoolFeePayments: JSON.stringify([{ id: 'PQ1', studentId: 'SF-A1', amount: 100, date: '2026-02-01', method: 'cash' }]),
  cestiFeeStructure: '{}', cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]'
} } };

async function dalFromBootstrap(broker) {
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_adjq-1' });
  const events = await st.get('staging', 'events');
  await broker.append({ events }, { nowIso: STAMP });
  const dal = await createDAL({ adapter: MemoryAdapter(), broker, source: 'adjq', actor: { name: 'Adjudicator', role: 'admin', device: 'dev_Q' } });
  await dal.sync.now();
  return dal;
}

(async function main() {

  section('Bootstrap queue items are canonical docs every device folds');
  const broker = createBroker();
  const A = await dalFromBootstrap(broker);
  const docs = A.find('doc', d => d.alive && d.fields.docKind === 'identityQueueItem');
  eq(docs.length, 2, 'both human-queue cases became canonical queue docs');
  ok(docs.every(d => d.fields.itemId && d.fields.records.length === 2), 'each carries its stable itemId and its records');

  section('Pending queue: people resolved through split keys, ordered by money at stake');
  const q1 = await AQ.adjqPending(A);
  eq(q1.pending.length, 2, 'both items pending');
  eq(q1.decided.length, 0, 'none decided yet');
  const linkItem = q1.pending.find(i => /conflicting names/.test(i.suggestion));
  const twinItem = q1.pending.find(i => /name \+ dob/.test(i.suggestion));
  ok(linkItem && twinItem, 'both case kinds present');
  ok(linkItem.records.every(r => r.hit), 'the conflicting-link people are found under their bootstrap SPLIT keys');
  eq(linkItem.stakeMinor, 45000, 'stake = |400−100| + |150| = 450.00 from the fold');
  eq(q1.pending[0].itemId, linkItem.itemId, 'the bigger-money item comes FIRST');

  section('Keep separate: one keystroke, recorded forever, queue shrinks');
  await AQ.adjqDecide(A, linkItem, 'kept-separate', { note: 'anonymiser artifact' });
  await A.sync.now();
  const q2 = await AQ.adjqPending(A);
  eq(q2.pending.length, 1, 'the item leaves the queue');
  eq(q2.decided, [{ itemId: linkItem.itemId, decision: 'kept-separate' }], 'and its disposition is recorded');

  section('Merge: person.merged folds — loser dead, winner absorbs, roster follows');
  const winner = twinItem.records[0].hit.personId, loser = twinItem.records[1].hit.personId;
  await AQ.adjqDecide(A, twinItem, 'merged', { winnerPersonId: winner, loserPersonIds: [loser], note: 'same person, twin rows' });
  await A.sync.now();
  ok(!A.get('person', loser).alive, 'the losing record is dead');
  eq(A.get('person', loser).mergedInto, winner, 'and points at the winner');
  ok(A.get('person', winner).alive, 'the winner lives');
  const roster = A.project('roster', {});
  ok(roster.filter(r => r.personId === winner).length >= 2, "the loser's enrolment now RESOLVES to the winner in the roster fold");
  eq((await AQ.adjqPending(A)).pending.length, 0, 'queue is empty');

  section('Two clerks race the SAME decision — one event through broker replay (P10)');
  const B = await createDAL({ adapter: MemoryAdapter(), broker, source: 'adjq-b', actor: { name: 'Clerk B', role: 'admin', device: 'dev_B' } });
  await B.sync.now();
  // B never saw A's decision applied? It pulled everything — so replay the
  // SAME decision as if raced: deterministic ids answer with original acks.
  await AQ.adjqDecide(B, linkItem, 'kept-separate', { note: 'anonymiser artifact' });
  await B.sync.now();
  const decideEvents = broker._state.events.filter(e => e.type === 'identity.adjudicated' && e.payload.itemId === linkItem.itemId);
  eq(decideEvents.length, 1, 'the duplicate decision deduped to ONE event');
  eq(B.head().unsynced, 0, "the second clerk's replay was answered with the original ack");

  section('The cutover gate: every item has a recorded disposition');
  const q3 = await AQ.adjqPending(A);
  eq(q3.pending.length, 0, 'pending: zero');
  eq(q3.decided.length, 2, 'every queue item carries a disposition — the docs/04 identity gate is checkable by machine');
  ok(await broker.verifyChain(), 'the log chain verifies');

  console.log('');
  section('Overlapping backups: one column per DISTINCT record, copy count carried (the live 14-column item)');
  const broker2 = createBroker();
  const st2 = MemoryAdapter();
  const copyPayload = JSON.parse(JSON.stringify(payload)); copyPayload.id = 'test:adjq-copy'; copyPayload.name = 'adjq copy';
  await BOOT.runBootstrap({ sources: [payload, copyPayload], adapter: st2, dryRun: true, runStamp: STAMP, runId: 'imp_adjq-2' });
  const ev2 = await st2.get('staging', 'events');
  await broker2.append({ events: ev2 }, { nowIso: STAMP });
  const D2 = await createDAL({ adapter: MemoryAdapter(), broker: broker2, source: 'adjq', actor: { name: 'Adjudicator', role: 'admin', device: 'dev_Q2' } });
  await D2.sync.now();
  const twinDoc = D2.find('doc', d => d.alive && d.fields.docKind === 'identityQueueItem').find(d => /name \+ dob/.test(d.fields.suggestion));
  ok(twinDoc && twinDoc.fields.records.length > 2, 'the queue DOC carries one records entry per source copy (' + (twinDoc && twinDoc.fields.records.length) + ')');
  const q9 = await AQ.adjqPending(D2);
  const twin9 = q9.pending.find(i => /name \+ dob/.test(i.suggestion));
  eq(twin9.records.length, 2, 'the QUEUE shows one column per DISTINCT record');
  ok(twin9.records.every(r => r.copies === 2), 'and each column knows how many backups carried it');

  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
