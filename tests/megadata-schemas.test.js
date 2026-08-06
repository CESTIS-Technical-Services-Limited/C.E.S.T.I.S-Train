/* MegaData step 1 — canonical serialization, envelope, schema validation.
   Run: node tests/megadata-schemas.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');

let passed = 0, failed = 0;
function ok(cond, msg) {
  try { assert(cond, msg); passed++; }
  catch (e) { failed++; console.log('  ✗ FAIL: ' + msg + (e && e.message && e.message !== msg ? ' — ' + e.message : '')); }
}
function eq(a, b, msg) { ok(require('util').isDeepStrictEqual ? require('util').isDeepStrictEqual(a, b) : a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const ACTOR = { name: 'Test Admin', role: 'admin', device: 'dev_test' };

(async function main() {

  section('Canonical serialization is deterministic and strict');
  eq(MD.canon({ b: 1, a: 2 }), MD.canon({ a: 2, b: 1 }), 'key order never matters');
  eq(MD.canon({ a: 1, gone: undefined }), MD.canon({ a: 1 }), 'undefined fields are dropped');
  eq(MD.canon({ z: -0 }), MD.canon({ z: 0 }), 'negative zero normalises to zero');
  eq(MD.canon([1, 'x', null, { k: true }]), '[1,"x",null,{"k":true}]', 'arrays keep order, objects sort');
  ok((() => { try { MD.canon({ n: NaN }); return false; } catch (e) { return true; } })(), 'NaN is refused');
  ok((() => { try { MD.canon({ n: Infinity }); return false; } catch (e) { return true; } })(), 'Infinity is refused');

  section('Ids are minted, unique, and migration ids are deterministic');
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(MD.mintId('evt'));
  eq(seen.size, 2000, '2000 mints, 2000 distinct ids');
  ok(MD.mintId('per').startsWith('per_'), 'prefix is applied');
  const m1 = await MD.migrationEventId('file123', 'students[4]', 1);
  const m2 = await MD.migrationEventId('file123', 'students[4]', 1);
  const m3 = await MD.migrationEventId('file123', 'students[4]', 2);
  eq(m1, m2, 'same source + transform → same id (re-runs converge)');
  ok(m1 !== m3, 'bumping the transform version changes the id');
  ok(m1.startsWith('evt_m'), 'migration ids are marked evt_m');

  section('buildEvent produces a hashed, verifiable envelope');
  const per = MD.mintId('per');
  const reg = await MD.buildEvent('person.registered', per,
    { names: { full: 'Casey Example' }, dob: '2001-05-14' }, ACTOR, 'test');
  ok(reg.hash && reg.hash.startsWith('sha256:'), 'hash stamped');
  ok(await MD.verifyEventHash(reg), 'hash verifies');
  const tampered = Object.assign({}, reg, { payload: { names: { full: 'Casey Exampl3' } } });
  ok(!(await MD.verifyEventHash(tampered)), 'tampered payload fails verification');
  const withSeq = Object.assign({}, reg, { seq: 42, brokerAt: '2026-08-05T00:00:00Z' });
  ok(await MD.verifyEventHash(withSeq), 'broker-assigned seq/brokerAt do not disturb the hash');

  section('Schema validation accepts the valid and names the invalid');
  const enr = MD.mintId('enr');
  const pay = await MD.buildEvent('fees.payment.recorded', enr,
    { amountMinor: 500000, method: 'cash', date: '2026-08-05' }, ACTOR, 'School.Fee');
  eq(MD.validateEvent(pay).ok, true, 'a valid payment validates');
  async function rejects(type, entityId, payload, why, opts) {
    let msg = '';
    try { await MD.buildEvent(type, entityId, payload, ACTOR, 'test', opts); }
    catch (e) { msg = String(e.message); }
    ok(msg !== '', why + ' (rejected)');
    return msg;
  }
  await rejects('fees.payment.recorded', enr, { amountMinor: 5000.5, method: 'cash', date: '2026-08-05' }, 'float money is refused (P4)');
  await rejects('fees.payment.recorded', enr, { amountMinor: -100, method: 'cash', date: '2026-08-05' }, 'non-positive payment is refused');
  await rejects('fees.payment.recorded', enr, { amountMinor: 100, method: 'iou', date: '2026-08-05' }, 'unknown method enum is refused');
  await rejects('fees.payment.recorded', enr, { amountMinor: 100, method: 'cash', date: '05/08/2026' }, 'non-ISO date is refused');
  await rejects('person.corrected', per, { diff: { dob: ['2001-05-14', '2001-05-15'] } }, 'a correction without a reason is refused');
  await rejects('intake.opened', MD.mintId('int'), { label: 'Welding L2 2026', start: '2026-09-01', fiscalYear: '2026/2027' }, 'intake without programme ref is refused');
  const okIntake = await MD.buildEvent('intake.opened', MD.mintId('int'),
    { label: 'Welding L2 2026', start: '2026-09-01', fiscalYear: '2026/2027' }, ACTOR, 'test',
    { refs: { programme: MD.mintId('prg') } });
  eq(MD.validateEvent(okIntake).ok, true, 'intake with programme ref validates');
  let unknown = '';
  try { await MD.buildEvent('fees.balance.set', enr, { balanceMinor: 1 }, ACTOR, 'test'); } catch (e) { unknown = e.message; }
  ok(/unknown event type/.test(unknown), 'there is no event that stores a balance — by construction');

  section('Adjustments may be negative; virement lines are structural');
  const adj = await MD.buildEvent('fees.adjustment.applied', enr,
    { amountMinor: -250000, kind: 'discount', reason: 'scholarship' }, ACTOR, 'test');
  eq(MD.validateEvent(adj).ok, true, 'negative adjustment validates');
  await rejects('virement.requested', MD.mintId('vir'),
    { fy: '2026/2027', q: 2, lines: [], requestedBy: 'Coordinator' }, 'virement with no lines is refused');

  section('Cashbook is a separate book (client decision D11)');
  const cb = await MD.buildEvent('cashbook.entry.recorded', MD.mintId('cbe'),
    { fy: '2026/2027', q: 1, date: '2026-05-02', kind: 'income', categoryId: 'Subvention', amountMinor: 450946725 }, ACTOR, 'Cashbook');
  eq(MD.validateEvent(cb).ok, true, 'cashbook entry validates with no fee linkage');
  ok(!('feePaymentEventId' in (MD.REGISTRY['cashbook.entry.recorded'].payload)), 'no fee-payment link field exists in the schema');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
