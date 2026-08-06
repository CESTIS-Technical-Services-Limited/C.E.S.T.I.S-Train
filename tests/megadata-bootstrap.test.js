/* MegaData step 5 — bootstrap pipeline against the Centre's real (anonymised)
   School-Fee backup fixture + synthetic edge cases: inventory baseline,
   deterministic convergence, interrupt/resume, quarantine-never-drop,
   adjudication tiers, financial identity. Run: node tests/megadata-bootstrap.test.js */
'use strict';
const fs = require('fs');
const assert = require('assert');
const MD = require('../megadata/schemas.js');
const { MemoryAdapter } = require('../megadata/adapters.js');
const BOOT = require('../megadata/bootstrap-core.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const STAMP = '2026-08-06T00:00:00.000Z';

const fixture = JSON.parse(fs.readFileSync(__dirname + '/fixtures/school-fees-backup.json', 'utf8'));
function feeSrc() { return { id: 'drive:CESTIS_School_Fees.json', kind: 'schoolfee-pagecloud', name: 'School Fee page-cloud backup', json: fixture }; }

// Expected baseline computed INDEPENDENTLY from the raw fixture.
function rawBaseline() {
  const d = fixture.data || {};
  const parse = (k) => (typeof d[k] === 'string' ? JSON.parse(d[k]) : d[k]) || [];
  const students = parse('cestiSchoolFeeStudents');
  const payments = parse('cestiSchoolFeePayments');
  const tomb = new Set(parse('cestiSchoolFeeDeletedPaymentIds'));
  let totalMinor = 0, live = 0;
  payments.forEach(p => { if (!tomb.has(p.id)) { totalMinor += Math.round((Number(p.amount) || 0) * 100); live++; } });
  return { students: students.length, livePayments: live, totalMinor };
}

(async function main() {
  const base = rawBaseline();

  section('The real fee backup imports: inventory equals an independent count');
  const rep = await BOOT.runBootstrap({ sources: [feeSrc()], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
  eq(rep.inventory.totals.students, base.students, 'trainee count matches the raw payload (' + base.students + ')');
  eq(rep.inventory.totals.payments, base.livePayments, 'live payment count matches (' + base.livePayments + ')');
  eq(rep.inventory.totals.paymentsTotalMinor, base.totalMinor, 'financial baseline from atomic records, to the cent');

  section('Verification: every event passes the broker gates; the identity holds');
  ok(rep.verification.brokerAccepted === rep.events.count, 'all ' + rep.events.count + ' synthesized events accepted by the real validation gates');
  ok(rep.verification.financialIdentityHolds, 'Σ imported payment events equals the inventory baseline exactly');
  ok(rep.verification.chainVerified, 'the synthesized log hash-chain verifies');
  eq(rep.verification.storedBalanceDisagreements, 0, 'legacy stored balances agree with the fold (fixture is internally consistent)');
  ok(rep.events.byType['person.registered'] > 0 && rep.events.byType['enrolment.created'] >= rep.events.byType['person.registered'], 'people and enrolments synthesized');

  section('Determinism: two independent runs produce the identical event set (P10)');
  const rep2 = await BOOT.runBootstrap({ sources: [feeSrc()], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
  eq(rep2.events.count, rep.events.count, 'same event count');
  const A = MemoryAdapter(), B = MemoryAdapter();
  await BOOT.runBootstrap({ sources: [feeSrc()], adapter: A, dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
  await BOOT.runBootstrap({ sources: [feeSrc()], adapter: B, dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
  const evA = await A.get('staging', 'events'), evB = await B.get('staging', 'events');
  eq(MD.canon(evA), MD.canon(evB), 'byte-identical events, ids and hashes included');

  section('Interrupt and resume converge to the same result (docs/04 §6)');
  const C = MemoryAdapter();
  let interrupted = false;
  try { await BOOT.runBootstrap({ sources: [feeSrc()], adapter: C, dryRun: true, runStamp: STAMP, runId: 'imp_test-1', failAfterStep: 'resolve' }); }
  catch (e) { interrupted = !!e.simulated; }
  ok(interrupted, 'the run was interrupted after the resolve checkpoint');
  const cp = await C.get('checkpoint', 'state');
  eq(cp.step, 'resolve', 'the checkpoint recorded the completed step');
  const repResumed = await BOOT.runBootstrap({ sources: [feeSrc()], adapter: C, dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
  const evC = await C.get('staging', 'events');
  eq(MD.canon(evC), MD.canon(evA), 'resumed run produced the byte-identical event set');
  eq(repResumed.verification.financialIdentityHolds, true, 'and the financial identity still holds');

  section('Dry-run writes no output events');
  const outEvents = await A.get('out', 'events');
  eq(outEvents, null, 'dry-run leaves the output namespace empty (report is returned, not committed)');

  section('Nothing is skipped silently: quarantine and adjudication tiers');
  const synthetic = {
    id: 'test:edge-cases', kind: 'schoolfee-pagecloud', name: 'edge cases', json: {
      data: {
        cestiSchoolFeeStudents: JSON.stringify([
          { id: 'STU-a1', name: 'Twin Case', dateOfBirth: '2001-01-01', skillArea: 'WELDING L2', tuitionFee: 100, updatedAt: '2026-01-02' },
          { id: 'STU-a2', name: 'Twin Case', dateOfBirth: '2001-01-01', skillArea: 'WELDING L2', tuitionFee: 100 },
          { id: 'STU-b1', name: 'Name Only', skillArea: 'WELDING L2', tuitionFee: 0 },
          { id: 'STU-b2', name: 'Name Only', skillArea: 'COSMETOLOGY L2', tuitionFee: 0 },
          { name: 'No Id Record' },
          { id: 'STU-c1', name: 'Balance Drift', skillArea: 'WELDING L2', tuitionFee: 100, balance: 90, totalPaid: 0 }
        ]),
        cestiSchoolFeePayments: JSON.stringify([
          { id: 'PAY1', studentId: 'STU-a1', amount: 40, date: '2026-01-05', method: 'cash' },
          { id: 'PAY2', studentId: 'STU-ghost', amount: 10, date: '2026-01-06', method: 'cash' },
          { id: 'PAY3', studentId: 'STU-a1', amount: -5, date: '2026-01-07', method: 'cash' },
          { id: 'PAY4', studentId: 'STU-a1', amount: 25, date: '2026-01-08', method: 'cash' }
        ]),
        cestiFeeStructure: JSON.stringify({ 'WELDING L2': { total: 100, terms: [50, 50] } }),
        cestiSchoolFeeDeletedPaymentIds: JSON.stringify(['PAY4']),
        cestiSchoolFeeDeletedLmsIds: JSON.stringify([])
      }
    }
  };
  const repE = await BOOT.runBootstrap({ sources: [synthetic], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-2' });
  eq(repE.adjudicationQueue.length, 1, 'same name + same dob (no strong id) → ONE tier-B human item');
  eq(repE.adjudicationQueue[0].tier, 'B', 'tier B, suggested not merged');
  ok(repE.keepSeparate.some(k => k.name === 'Name Only'), 'same name alone → kept separate, listed (tier C)');
  const reasons = repE.quarantine.map(q => q.reason).join(' | ');
  ok(/without id/.test(reasons), 'the id-less student was quarantined, not dropped');
  ok(/unknown student/.test(reasons), 'the ghost-student payment was quarantined, not dropped');
  ok(/non-positive/.test(reasons), 'the negative payment was quarantined, not dropped');
  eq(repE.inventory.totals.tombstonedPayments, 1, 'the legacy-deleted payment is accounted, not imported');
  eq(repE.verification.financialIdentityHolds, true, 'financial identity holds over the imported subset');
  eq(repE.verification.storedBalanceDisagreements, 1, 'the drifted stored balance is reported for human review (absent balances are not noise)');
  eq(repE.verification.balanceDiffSample[0].storedBalanceMinor, 9000, 'with the stored value…');
  eq(repE.verification.balanceDiffSample[0].foldedBalanceMinor, 10000, '…against the fold (100 charged, nothing paid)');
  eq(repE.verification.quarantinedPaymentsMinor, 500, 'the quarantined payments are accounted to the cent (10.00 ghost − 5.00 negative)');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
