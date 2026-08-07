/* MegaData step 7 — glue: broker HTTP client (HMAC, backoff, replay-safety),
   enforcement-shim policy, putMany atomic-batch contract, and a DAL run over
   the HTTP client against an in-process broker "server".
   Run: node tests/megadata-glue.test.js */
'use strict';
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const MD = require('../megadata/schemas.js');
const { MemoryAdapter, FileAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createBrokerClient } = require('../megadata/broker-client.js');
const { createShimPolicy } = require('../megadata/enforcement-shim.js');
const { createDAL } = require('../megadata/dal.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }

const SECRET = 'test-secret';

// An in-process "Apps Script": verifies HMAC exactly like Code.gs, drives broker-core.
function makeServer(broker, chaos) {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++;
    if (chaos && chaos.failFirst && calls <= chaos.failFirst) {
      if (chaos.kind === 'network') throw new Error('network down (fetch failed)');
      return { status: 503, text: async () => 'busy' };
    }
    const req = JSON.parse(init.body);
    const expected = await MD.sha256Hex(SECRET + '|' + MD.canon(req.payload || {}));
    if (req.auth !== expected) return { status: 200, text: async () => JSON.stringify({ error: 'auth failed' }) };
    const out = await ({ append: broker.append, pull: broker.pull, headq: broker.headq, gate: broker.gate })[req.op](req.payload);
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  return { fetchImpl, callCount: () => calls };
}

(async function main() {

  section('Broker client: signed requests round-trip; a wrong secret is refused');
  const broker = createBroker();
  const server = makeServer(broker);
  const client = createBrokerClient({ url: 'https://broker.test/exec', secret: SECRET, fetchImpl: server.fetchImpl, sleep: () => Promise.resolve() });
  const h = await client.headq();
  eq(h, { seq: 0, chain: 'genesis' }, 'headq round-trips through the HTTP dialect');
  const badClient = createBrokerClient({ url: 'https://broker.test/exec', secret: 'wrong', fetchImpl: server.fetchImpl, sleep: () => Promise.resolve() });
  let authErr = '';
  try { await badClient.headq(); } catch (e) { authErr = e.message; }
  ok(/auth failed/.test(authErr), 'a mis-signed request is rejected by the server check');

  section('Backoff: transient failures retry and succeed; retries never double-append');
  const flakyServer = makeServer(broker, { failFirst: 2, kind: 'network' });
  const delays = [];
  const flakyClient = createBrokerClient({
    url: 'https://broker.test/exec', secret: SECRET, fetchImpl: flakyServer.fetchImpl,
    sleep: (ms) => { delays.push(ms); return Promise.resolve(); }
  });
  const per = MD.mintId('per');
  const evt = await MD.buildEvent('person.registered', per, { names: { full: 'Glue Test' } }, { name: 'T', role: 'admin', device: 'dev_G' }, 'glue');
  const res1 = await flakyClient.append({ events: [evt] });
  ok(res1.ok, 'append succeeded after transient failures');
  eq(delays, [2000, 4000], 'exponential backoff: 2s then 4s');
  const res2 = await flakyClient.append({ events: [evt] });
  eq(res2.acks[evt.id].seq, res1.acks[evt.id].seq, 'a full client-level replay returns the original ack (P10)');
  eq(broker._state.events.length, 1, 'and the log did not grow');

  section('A DAL running over the HTTP client behaves identically to a direct broker');
  const dal = await createDAL({ adapter: MemoryAdapter(), broker: client, source: 'glue', actor: { name: 'Clerk', role: 'admin', device: 'dev_H' } });
  await dal.sync.now();
  const { programmeId } = await dal.defineProgramme({ name: 'ELECTRICAL L2' });
  const { intakeId } = await dal.openIntake(programmeId, { label: 'Electrical 2026', start: '2026-09-01', fiscalYear: '2026/2027' });
  const rp = await dal.registerPerson({ names: { full: 'Wired Person' } });
  const { enrolmentId } = await dal.enrol(rp.personId, intakeId, { enrolledAt: '2026-09-01' });
  await dal.assessCharge(enrolmentId, { termNo: 1, amountMinor: 100000 });
  await dal.recordPayment(enrolmentId, { amountMinor: 40000, method: 'cash', date: '2026-09-02' });
  await dal.sync.now();
  eq(dal.getBalance(enrolmentId), 60000, 'fold correct across the HTTP seam');
  eq(dal.getLedger(enrolmentId).entries.find(e => e.kind === 'payment').receiptNo, 'R-000001', 'broker-assigned number crosses the HTTP seam');

  section('Enforcement shim policy: allow / report / throw with a shrinking allowlist');
  const report = createShimPolicy({ mode: 'report', page: 'School.Fee', allow: ['cestiSchoolFee', 'cestiFeeStructure'] });
  eq(report.decide('storage', 'setItem', 'cestiSchoolFeeStudents'), 'allow', 'allowlisted legacy key passes during migration');
  eq(report.decide('storage', 'setItem', 'voctrain_students'), 'report', 'non-allowlisted access is reported');
  eq(report.violations.length, 1, 'the violation is recorded');
  eq(report.violations[0].key, 'voctrain_students', 'with the exact key');
  const strict = createShimPolicy({ mode: 'throw', page: 'School.Fee', allow: [] });
  eq(strict.decide('storage', 'setItem', 'cestiSchoolFeeStudents'), 'throw', 'at cutover the same access throws');
  eq(strict.decide('storage', 'setItem', 'cestis_mega_settings'), 'allow', "the DAL's own keys always pass");
  eq(strict.decide('fetch', 'googleapis', 'https://www.googleapis.com/drive/v3/files'), 'throw', 'direct Drive fetches are bypasses too');
  const off = createShimPolicy({ mode: 'off', page: 'X' });
  eq(off.decide('storage', 'setItem', 'anything'), 'allow', 'off mode is inert');

  section('putMany contract holds on both Node adapters (the IDB atomicity seam)');
  for (const [name, ad] of [['memory', MemoryAdapter()], ['file', FileAdapter(fs.mkdtempSync(path.join(os.tmpdir(), 'mega-glue-')))]]) {
    await ad.putMany([{ ns: 'a', k: '1', v: 'x' }, { ns: 'b', k: '2', v: { y: 1 } }, { ns: 'a', k: '3', v: 7 }]);
    eq(await ad.get('a', '1'), 'x', name + ': batch write landed in ns a');
    eq(await ad.get('b', '2'), { y: 1 }, name + ': batch write landed in ns b');
    eq((await ad.scan('a')).length, 2, name + ': scan sees both ns-a keys');
  }

  section('The operator paste file is exactly its sources (drift guard) and Apps Script-ready');
  {
    const paste = require('../megadata/broker-appsscript/build-paste.js');
    const fs2 = require('fs');
    eq(fs2.readFileSync(paste.artifact, 'utf8') === paste.build(), true,
      'PASTE-ALL-IN-ONE.gs matches a fresh build — rebuild after editing schemas/broker-core/Code.gs');
    const src = fs2.readFileSync(require.resolve('../megadata/schemas.js'), 'utf8');
    ok(src.indexOf('Utilities.computeDigest') !== -1,
      'sha256Hex carries the Apps Script digest branch — the paste file needs NO post-paste edits');
  }

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
