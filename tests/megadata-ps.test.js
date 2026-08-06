/* MegaData — staff pages (Payslip + Clock-in) through docsync: bootstrap↔
   spec doc-id agreement for all seven kinds, the payroll blob decompose/
   recompose (guard fields preserved, unkeyed records kept local), settings
   singleton round-trip, employee rename semantics, cross-page convergence
   (clock and payslip devices), and the cashbook salary hand-off path.
   Run: node tests/megadata-ps.test.js */
'use strict';
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const RM = require('../megadata/pages/roster-model.js');
const DS = require('../megadata/pages/docsync-model.js');
const PS = require('../megadata/pages/ps-model.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const { createBroker } = require('../megadata/broker-core.js');
const { createDAL } = require('../megadata/dal.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const SETTINGS = { schoolName: 'CESTIS', payCycle: 'monthly', nisRate: 3 };
const EMP = { name: 'Tracy-Ann Jennings', position: 'Instructor', baseSalary: 120000, trn: '000-000-001' };
const RUN = { date: '2026-07-31', results: [{ empName: 'Tracy-Ann Jennings', gross: 120000, net: 102000 }] };
const USER = { id: 'U1', username: 'frontdesk', role: 'clerk' };
const PERM = { id: 'PR1', user: 'frontdesk', page: 'payroll', status: 'pending' };
const STAFFM = { id: 'STAFF1700000000000', username: 'tjennings', fullName: 'Tracy-Ann Jennings', workType: 'Full-Time', role: 'Staff', status: 'Active' };
const TREC = { id: 'SESSION_1700000000000', staffId: 'STAFF1700000000000', clockIn: '2026-07-01T08:00:00.000Z', clockOut: '2026-07-01T16:00:00.000Z' };

const specOf = kind => PS.PS_SPECS.concat(PS.CLOCK_SPECS).find(s => s.kind === kind);
async function tick(dal, spec, local, baseline) {
  const plan = await DS.docSyncPlan(dal, spec, local, baseline || {});
  await DS.docSyncPush(dal, plan, 'PS');
  await dal.sync.now();
  return plan;
}
async function freshDal(broker, dev) {
  return createDAL({ adapter: MemoryAdapter(), broker, source: 'ps-' + dev, actor: { name: 'Staff ' + dev, role: 'admin', device: 'dev_' + dev } });
}

(async function main() {

  section('Drift guard: bootstrap and the specs derive IDENTICAL doc ids for all seven kinds');
  const payload = { id: 'test:ps', kind: 'finance-staff-pagecloud', name: 'ps', json: { data: {
    cestisPayroll: JSON.stringify({ settings: SETTINGS, employees: [EMP], payrollRuns: [RUN] }),
    dashboardUsers: JSON.stringify([USER]),
    cestisPermissions: JSON.stringify([PERM]),
    cestisStaffMembers: JSON.stringify([STAFFM]),
    cestisTimeRecords: JSON.stringify([TREC])
  } } };
  const st = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [payload], adapter: st, dryRun: true, runStamp: STAMP, runId: 'imp_ps-1' });
  const bootEvents = await st.get('staging', 'events');
  for (const [kind, raw] of [['payrollSettings', SETTINGS], ['employee', EMP], ['payrollRun', RUN], ['payslipUser', USER], ['permissionRequest', PERM], ['staffMember', STAFFM], ['timeRecord', TREC]]) {
    const spec = specOf(kind);
    const wantId = await RM.bootstrapId('doc', spec.bootKey(raw));
    const evt = bootEvents.find(e => e.type === 'doc.upserted' && e.payload.kind === kind);
    eq(evt && evt.entity.id, wantId, kind + ' doc id agrees between bootstrap and the page spec');
  }

  section('Payroll blob decompose/recompose: guard fields preserved, unkeyed records stay local');
  const blob = { settings: SETTINGS, employees: [EMP, { position: 'no-name row' }], payrollRuns: [RUN], _highWater: { employees: 5 }, syncGuard: true };
  const parts = PS.payrollDecompose(blob);
  eq(parts.employees.length, 1, 'only keyed employees enter the sync');
  eq(parts.unkeyed.length, 1, 'the key-less record is reported, not dropped');
  const rebuilt = PS.payrollRecompose(blob, parts);
  eq(rebuilt._highWater, { employees: 5 }, 'high-water guard fields survive recompose verbatim');
  eq(rebuilt.syncGuard, true, 'unknown top-level fields survive');
  eq(rebuilt.employees.length, 2, 'the unkeyed record is back in its collection');
  eq(rebuilt.settings, SETTINGS, 'settings intact');

  section('Settings singleton: edits round-trip both directions');
  const broker = createBroker();
  const A = await freshDal(broker, 'A');
  const B = await freshDal(broker, 'B');
  const sSpec = specOf('payrollSettings');
  const p1 = await tick(A, sSpec, [SETTINGS], {});
  eq(p1.pushes.length, 1, 'the settings object pushes as ONE doc');
  await B.sync.now();
  const pB = await DS.docSyncPlan(B, sSpec, [], {});
  eq(pB.newLocal.length, 1, 'a fresh device mirrors the settings in');
  eq(pB.newLocal[0].nisRate, 3, 'with the values');
  const edited = Object.assign({}, SETTINGS, { nisRate: 3.5 });
  const p2 = await tick(A, sSpec, [edited], p1.newBaseline);
  eq(p2.pushes.length, 1, 'a rate change pushes');
  await B.sync.now();
  const pB2 = await DS.docSyncPlan(B, sSpec, [SETTINGS], pB.newBaseline);
  eq(pB2.applies.length, 1, "and applies onto B's copy");
  eq(DS.docSyncApply(sSpec, [SETTINGS], pB2).records[0].nisRate, 3.5, 'to the new rate');

  section('Employee rename = new doc + soft removal of the old (bootstrap semantics, audited)');
  const eSpec = specOf('employee');
  const pe1 = await tick(A, eSpec, [EMP], {});
  eq(pe1.pushes.length, 1, 'the employee pushes');
  const renamed = Object.assign({}, EMP, { name: 'Tracy-Ann Jennings-Brown' });
  const pe2 = await tick(A, eSpec, [renamed], pe1.newBaseline);
  const kinds = pe2.pushes.map(p => p.diff._removed === true ? 'removal' : 'record').sort();
  eq(kinds, ['record', 'removal'], 'rename pushes the new doc AND soft-removes the old');
  await B.sync.now();
  const pbE = await DS.docSyncPlan(B, eSpec, [], {});
  eq(pbE.newLocal.length, 1, 'a fresh device sees exactly ONE live employee');
  eq(pbE.newLocal[0].name, 'Tracy-Ann Jennings-Brown', 'the renamed one');

  section('Cross-page hand-off: a cashbook-written payroll run bridges on the payslip tick');
  const rSpec = specOf('payrollRun');
  // The cashbook page appended a salary line into cestisPayroll — the
  // payslip page's next tick simply sees a run it has not pushed yet.
  const cbRun = { date: '2026-08-31', results: [{ empName: 'Tracy-Ann Jennings-Brown', gross: 120000, net: 102000 }], source: 'cashbook-sync' };
  const pr1 = await tick(A, rSpec, [RUN, cbRun], {});
  eq(pr1.pushes.length, 2, 'both runs push (origin does not matter)');
  await B.sync.now();
  const pbR = await DS.docSyncPlan(B, rSpec, [], {});
  eq(pbR.newLocal.length, 2, 'the other device mirrors both in');
  ok(pbR.newLocal.some(r => r.source === 'cashbook-sync'), 'including the cashbook-born one, payload intact');

  section('Clock page: staff + time records converge across devices');
  const stSpec = specOf('staffMember'), trSpec = specOf('timeRecord');
  const ps1 = await tick(A, stSpec, [STAFFM], {});
  const pt1 = await tick(A, trSpec, [TREC], {});
  eq(ps1.pushes.length + pt1.pushes.length, 2, 'staff member and time record push');
  await B.sync.now();
  const pbS = await DS.docSyncPlan(B, stSpec, [], {});
  const pbT = await DS.docSyncPlan(B, trSpec, [], {});
  eq(pbS.newLocal.length, 1, 'staff mirrors in');
  eq(pbT.newLocal.length, 1, 'time record mirrors in');
  eq(pbT.newLocal[0].clockOut, TREC.clockOut, 'clock-out time intact');
  // A correction on device B pushes back and lands on A.
  const fixed = Object.assign({}, TREC, { clockOut: '2026-07-01T17:00:00.000Z' });
  const pbT2 = await tick(B, trSpec, [fixed], pbT.newBaseline);
  eq(pbT2.pushes.length, 1, "B's correction pushes");
  await A.sync.now();
  const paT = await DS.docSyncPlan(A, trSpec, [TREC], pt1.newBaseline);
  eq(paT.applies.length, 1, "and applies onto A's copy");
  eq(DS.docSyncApply(trSpec, [TREC], paT).records[0].clockOut, '2026-07-01T17:00:00.000Z', 'A shows the corrected time');

  section('Same-edit race: one event (P10)');
  const race = Object.assign({}, STAFFM, { status: 'Inactive' });
  const pl1 = await DS.docSyncPlan(A, stSpec, [race], ps1.newBaseline);
  const pl2 = await DS.docSyncPlan(B, stSpec, [JSON.parse(JSON.stringify(race))], ps1.newBaseline);
  await DS.docSyncPush(A, pl1, 'PS'); await DS.docSyncPush(B, pl2, 'PS');
  await A.sync.now(); await B.sync.now(); await A.sync.now();
  const staffDocId = await RM.bootstrapId('doc', stSpec.bootKey(STAFFM));
  const raceEvents = broker._state.events.filter(e => e.entity.id === staffDocId && e.type === 'doc.upserted' && e.payload.diff.status === 'Inactive');
  eq(raceEvents.length, 1, 'same state + same diff → ONE event in the log');
  ok(await broker.verifyChain(), 'the log chain verifies after the whole exercise');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
