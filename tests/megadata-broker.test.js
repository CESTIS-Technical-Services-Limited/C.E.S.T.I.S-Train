/* MegaData step 2 — broker core: sequencing, validation gates, idempotent
   replay, number series, hash chain. Run: node tests/megadata-broker.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const BR = require('../megadata/broker-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) {
  try { assert(cond, msg); passed++; }
  catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const ACTOR = { name: 'Test Admin', role: 'admin', device: 'dev_A' };
function ev(type, entityId, payload, opts) { return MD.buildEvent(type, entityId, payload, ACTOR, 'test', opts); }

(async function main() {
  const broker = BR.createBroker();

  section('A valid chain of creates is sequenced gaplessly');
  const prg = MD.mintId('prg'), int_ = MD.mintId('int'), per = MD.mintId('per'), enr = MD.mintId('enr');
  const e1 = await ev('programme.defined', prg, { name: 'WELDING L2' });
  const e2 = await ev('intake.opened', int_, { label: 'Welding L2 2026/27', start: '2026-09-01', fiscalYear: '2026/2027' }, { refs: { programme: prg } });
  const e3 = await ev('person.registered', per, { names: { full: 'Casey Example' } });
  const e4 = await ev('enrolment.created', enr, { enrolledAt: '2026-09-01' }, { refs: { person: per, intake: int_ } });
  let r = await broker.append({ events: [e1, e2, e3, e4] });
  ok(r.ok, 'batch accepted');
  eq([r.acks[e1.id].seq, r.acks[e2.id].seq, r.acks[e3.id].seq, r.acks[e4.id].seq], [1, 2, 3, 4], 'seqs are 1..4, gapless');
  eq(r.head.seq, 4, 'head advanced to 4');

  section('Replays are idempotent: same acks, no growth (P10)');
  const before = broker._state.events.length;
  const r2 = await broker.append({ events: [e3, e4] });
  ok(r2.ok, 'replay batch accepted');
  eq(r2.acks[e3.id].seq, 3, 'replayed event returns its ORIGINAL seq');
  eq(broker._state.events.length, before, 'log did not grow');

  section('Batches are all-or-nothing with named errors');
  const ghostPay = await ev('fees.payment.recorded', MD.mintId('enr'), { amountMinor: 1000, method: 'cash', date: '2026-09-02' });
  const goodPay = await ev('fees.payment.recorded', enr, { amountMinor: 500000, method: 'cash', date: '2026-09-02' });
  r = await broker.append({ events: [goodPay, ghostPay] });
  ok(!r.ok, 'batch with an invalid event is refused');
  ok(/does not exist/.test(r.errors[ghostPay.id][0]), 'the error names the missing enrolment');
  ok(!broker._state.ackById[goodPay.id], 'the good event was NOT appended (all-or-nothing)');

  section('Number series are broker-assigned, monotonic, replay-stable');
  r = await broker.append({ events: [goodPay] });
  eq(r.acks[goodPay.id].assigned, { receiptNo: 'R-000001' }, 'first receipt number');
  const pay2 = await ev('fees.payment.recorded', enr, { amountMinor: 250000, method: 'transfer', date: '2026-09-03' });
  r = await broker.append({ events: [pay2] });
  eq(r.acks[pay2.id].assigned, { receiptNo: 'R-000002' }, 'second receipt number');
  const rr = await broker.append({ events: [goodPay] });
  eq(rr.acks[goodPay.id].assigned, { receiptNo: 'R-000001' }, 'replay returns the SAME receipt number');
  const cert = await ev('cert.issued', enr, {});
  r = await broker.append({ events: [cert] });
  eq(r.acks[cert.id].assigned, { certNo: 'CT-000001' }, 'certificate series is independent');
  const inv = await ev('findoc.issued', MD.mintId('fdc'), { kind: 'invoice', doc: { billedTo: 'HEART Trust', linesMinor: [1200000] } });
  r = await broker.append({ events: [inv] });
  eq(r.acks[inv.id].assigned, { number: 'INV-000001' }, 'invoice series is independent');

  section('Reversal gates (P8): wrong enrolment, double reversal, non-payment');
  const rev = await ev('fees.payment.reversed', enr, { paymentEventId: goodPay.id, reason: 'keyed twice' });
  r = await broker.append({ events: [rev] });
  ok(r.ok, 'legitimate reversal accepted');
  const rev2 = await ev('fees.payment.reversed', enr, { paymentEventId: goodPay.id, reason: 'again' });
  r = await broker.append({ events: [rev2] });
  ok(!r.ok && /already reversed/.test(r.errors[rev2.id][0]), 'double reversal refused');
  const otherEnr = MD.mintId('enr');
  const e5 = await ev('enrolment.created', otherEnr, { enrolledAt: '2026-09-01' }, { refs: { person: per, intake: int_ } });
  await broker.append({ events: [e5] });
  const revWrong = await ev('fees.payment.reversed', otherEnr, { paymentEventId: pay2.id, reason: 'wrong book' });
  r = await broker.append({ events: [revWrong] });
  ok(!r.ok && /different enrolment/.test(r.errors[revWrong.id][0]), 'cross-enrolment reversal refused');
  const revOfCert = await ev('fees.payment.reversed', enr, { paymentEventId: cert.id, reason: 'nonsense' });
  r = await broker.append({ events: [revOfCert] });
  ok(!r.ok && /not a recorded payment/.test(r.errors[revOfCert.id][0]), 'reversing a non-payment refused');

  section('Tombstone and merge gates');
  const ts = await ev('person.tombstoned', per, { reason: 'left the island' });
  r = await broker.append({ events: [ts] });
  ok(!r.ok && /active enrolment/.test(r.errors[ts.id][0]), 'tombstoning a person with active enrolments refused');
  const wd1 = await ev('enrolment.statusChanged', enr, { to: 'withdrawn', reason: 'test' });
  const wd2 = await ev('enrolment.statusChanged', otherEnr, { to: 'withdrawn', reason: 'test' });
  await broker.append({ events: [wd1, wd2] });
  r = await broker.append({ events: [ts] });
  ok(r.ok, 'after withdrawal the tombstone is accepted');
  const dupCreate = await ev('person.registered', per, { names: { full: 'Casey Example' } });
  r = await broker.append({ events: [dupCreate] });
  ok(!r.ok && /already exists/.test(r.errors[dupCreate.id][0]), 'creating an existing entity refused');
  const perB = MD.mintId('per'), perC = MD.mintId('per');
  await broker.append({ events: [await ev('person.registered', perB, { names: { full: 'Devon Sample' } }), await ev('person.registered', perC, { names: { full: 'Devon Sample' } })] });
  const merge = await ev('person.merged', perB, { loserId: perC, evidence: { nationalId: 'match' }, tier: 'human' });
  r = await broker.append({ events: [merge] });
  ok(r.ok, 'human-tier merge accepted');
  const onLoser = await ev('person.corrected', perC, { diff: { dob: [null, '2000-01-01'] }, reason: 'x' });
  r = await broker.append({ events: [onLoser] });
  ok(!r.ok && /tombstoned\/merged/.test(r.errors[onLoser.id][0]), 'events on a merged-away person refused');

  section('Attendance correction must reference a real mark on the same enrolment');
  const enr2live = MD.mintId('enr');
  await broker.append({ events: [await ev('person.registered', MD.mintId('per'), { names: { full: 'A B' } })] });
  const mk = await ev('attendance.marked', otherEnr, { date: '2026-09-10', status: 'present' });
  await broker.append({ events: [mk] });
  const fix = await ev('attendance.corrected', otherEnr, { markEventId: mk.id, newStatus: 'late', reason: 'arrived 9:40' });
  r = await broker.append({ events: [fix] });
  ok(r.ok, 'correction referencing the real mark accepted');
  const fakeFix = await ev('attendance.corrected', otherEnr, { markEventId: goodPay.id, newStatus: 'late', reason: 'x' });
  r = await broker.append({ events: [fakeFix] });
  ok(!r.ok, 'correction referencing a non-mark refused');

  section('Hash tampering is refused; the chain verifies end-to-end (P11)');
  const bad = await ev('attendance.marked', otherEnr, { date: '2026-09-11', status: 'present' });
  bad.payload.status = 'absent'; // mutate after hashing
  r = await broker.append({ events: [bad] });
  ok(!r.ok && /hash/.test(r.errors[bad.id][0]), 'tampered event refused at the gate');
  ok(await broker.verifyChain(), 'full chain verifies');
  const savedHash = broker._state.events[2].hash;
  broker._state.events[2].hash = 'sha256:0000';
  ok(!(await broker.verifyChain()), 'a tampered stored event breaks chain verification');
  broker._state.events[2].hash = savedHash;
  ok(await broker.verifyChain(), 'restored log verifies again');

  section('Pull serves the tail; gates round-trip');
  const tail = await broker.pull({ sinceSeq: 4 });
  ok(tail.events.length > 0 && tail.events[0].seq === 5, 'pull starts after sinceSeq');
  const g = await broker.gate({ op: 'setBootstrap', value: 'sealed' });
  eq(g.gates.bootstrap, 'sealed', 'bootstrap gate set');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
