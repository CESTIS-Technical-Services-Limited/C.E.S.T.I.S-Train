/* MegaData — operator upload: a committed run reaches a live-dialect broker
   through the REAL signed HTTP client (auth verified exactly like Code.gs),
   verification pulls everything back (id set + recomputed hash chain),
   re-runs and crash-resumes never double-import, refusals keep the gate
   open, and --seal flips the gate. Run: node tests/megadata-upload.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createBrokerClient } = require('../megadata/broker-client.js');
const { uploadRun, sealGate } = require('../megadata/bootstrap-upload.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';
const SECRET = 'test-secret-value-1234567890abcdef';

/* An HTTP stand-in that speaks Code.gs's exact dialect: text/plain body
   {op, auth, payload}, HMAC verified server-side, broker ops routed. */
function liveDialect(broker, hooks) {
  hooks = hooks || {};
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    if (hooks.failOn && hooks.failOn(calls)) { const e = new Error('network reset'); throw e; }
    const req = JSON.parse(init.body);
    const auth = await MD.sha256Hex(SECRET + '|' + MD.canon(req.payload || {}));
    let out;
    if (req.auth !== auth) out = { error: 'auth failed' };
    else if (req.op === 'append') out = await broker.append(req.payload, { nowIso: STAMP });
    else if (req.op === 'pull') out = await broker.pull(req.payload);
    else if (req.op === 'headq') out = await broker.headq();
    else if (req.op === 'gate') out = await broker.gate(req.payload);
    else out = { error: 'unknown op ' + req.op };
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  return { fetchImpl, callCount: () => calls };
}

async function committedEvents() {
  const payload = { id: 'test:up', kind: 'schoolfee-pagecloud', name: 'up', json: { data: {
    cestiSchoolFeeStudents: JSON.stringify([
      { id: 'SF-U1', name: 'Upload One', skillArea: 'WELDING L2', tuitionFee: 200 },
      { id: 'SF-U2', name: 'Upload Two', skillArea: 'COSMETOLOGY L2', tuitionFee: 150 }
    ]),
    cestiSchoolFeePayments: JSON.stringify([{ id: 'PU1', studentId: 'SF-U1', amount: 80, date: '2026-02-02', method: 'cash' }]),
    cestiFeeStructure: '{}', cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]'
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_up-1' });
  return st.get('staging', 'events');
}

(async function main() {

  section('A committed run uploads through the signed client, verifies, and seals');
  const events = await committedEvents();
  ok(events.length >= 8, 'the run produced a realistic event set (' + events.length + ')');
  const broker = createBroker();
  const { fetchImpl } = liveDialect(broker);
  const client = createBrokerClient({ url: 'https://x/exec', secret: SECRET, fetchImpl, sleep: () => Promise.resolve() });
  const logLines = [];
  const rep = await uploadRun({ client, events, batchSize: 3, log: l => logLines.push(l) });
  eq(rep.newOnBroker, events.length, 'every event landed');
  eq([rep.idsOk, rep.chainOk], [true, true], 'id set matches AND the recomputed hash chain equals the broker head');
  eq(broker._state.gates.bootstrap, 'running', 'the gate went to running during upload — pages still refuse');
  ok(logLines.some(l => /uploaded/.test(l)), 'progress was narrated');
  await sealGate(client);
  eq(broker._state.gates.bootstrap, 'sealed', '--seal flips the gate; pages go shadow on next open');

  section('Re-running the whole upload is a no-op (idempotent replay)');
  const rep2 = await uploadRun({ client, events, batchSize: 4 });
  eq(rep2.newOnBroker, 0, 'nothing new appended');
  eq(rep2.replayed, events.length, 'every event answered with its original ack');
  eq([rep2.idsOk, rep2.chainOk], [true, true], 'verification still holds');
  eq(broker._state.events.length, events.length, 'the log did not grow');

  section('A crash mid-upload resumes cleanly: retries + replay, never duplicates');
  const broker2 = createBroker();
  let failedOnce = false;
  const net = liveDialect(broker2, { failOn: n => { if (n === 3 && !failedOnce) { failedOnce = true; return true; } return false; } });
  const client2 = createBrokerClient({ url: 'https://x/exec', secret: SECRET, fetchImpl: net.fetchImpl, sleep: () => Promise.resolve() });
  const rep3 = await uploadRun({ client: client2, events, batchSize: 2 });
  eq(rep3.newOnBroker, events.length, 'the transient network failure was retried through; everything landed');
  eq(broker2._state.events.length, events.length, 'exactly once, despite the retry');
  ok(await broker2.verifyChain(), 'the broker-side chain verifies too');

  section('A wrong secret is refused before anything reaches the broker');
  const badClient = createBrokerClient({ url: 'https://x/exec', secret: 'wrong', fetchImpl: liveDialect(broker2).fetchImpl, sleep: () => Promise.resolve(), maxRetries: 0 });
  let err = null;
  await uploadRun({ client: badClient, events, batchSize: 5 }).catch(e => { err = e; });
  ok(err && /auth failed/.test(err.message), 'auth failed surfaces loudly (' + (err && err.message) + ')');
  eq(broker2._state.events.length, events.length, 'and the log is untouched');

  section('A validation refusal keeps the gate OPEN and names the offender');
  const broker3 = createBroker();
  const client3 = createBrokerClient({ url: 'https://x/exec', secret: SECRET, fetchImpl: liveDialect(broker3).fetchImpl, sleep: () => Promise.resolve() });
  const broken = events.slice();
  broken[5] = Object.assign({}, broken[5], { payload: Object.assign({}, broken[5].payload, { amountMinor: -5 }) });
  let err2 = null;
  await uploadRun({ client: client3, events: broken, batchSize: 50 }).catch(e => { err2 = e; });
  ok(err2 && /refused a batch/.test(err2.message), 'the refusal is loud, with the broker\'s reasons');
  ok(broker3._state.gates.bootstrap !== 'sealed', 'the gate never sealed');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
