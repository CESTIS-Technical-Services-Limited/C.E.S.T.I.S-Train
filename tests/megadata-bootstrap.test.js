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

  section('Interrupt and resume converge to the same result, at EVERY checkpoint boundary (docs/04 §6, spec §8)');
  for (const step of ['extract', 'resolve', 'synthesize', 'verify']) {
    const C = MemoryAdapter();
    let interrupted = false;
    try { await BOOT.runBootstrap({ sources: [feeSrc()], adapter: C, dryRun: true, runStamp: STAMP, runId: 'imp_test-1', failAfterStep: step }); }
    catch (e) { interrupted = !!e.simulated; }
    ok(interrupted, 'the run was interrupted after the ' + step + ' checkpoint');
    const cp = await C.get('checkpoint', 'state');
    eq(cp.step, step, 'the checkpoint recorded the completed step (' + step + ')');
    const repResumed = await BOOT.runBootstrap({ sources: [feeSrc()], adapter: C, dryRun: true, runStamp: STAMP, runId: 'imp_test-1' });
    const evC = await C.get('staging', 'events');
    eq(MD.canon(evC), MD.canon(evA), 'resume after ' + step + ' produced the byte-identical event set');
    eq(repResumed.verification.financialIdentityHolds, true, 'and the financial identity still holds after ' + step + ' resume');
  }

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

  section('Cross-source unification: a linked fee+LMS pair is ONE person; bad links go to humans');
  const unifFee = { id: 'test:fee2', kind: 'schoolfee-pagecloud', name: 'fee2', json: { data: {
    cestiSchoolFeeStudents: JSON.stringify([
      { id: 'SF-L1', lmsId: 'L1', name: 'Unified Person', skillArea: 'WELDING L2', tuitionFee: 100, balance: 70, updatedAt: '2026-02-01' },
      { id: 'STU-x9', name: 'Solo Fee Person', skillArea: 'WELDING L2', tuitionFee: 50 },
      { id: 'SF-L3', lmsId: 'L3', name: 'Different Name', skillArea: 'WELDING L2', tuitionFee: 20 }
    ]),
    cestiSchoolFeePayments: JSON.stringify([{ id: 'PAYu1', studentId: 'SF-L1', amount: 30, date: '2026-02-02', method: 'cash' }]),
    cestiFeeStructure: JSON.stringify({ 'WELDING L2': { total: 100, terms: [100] } }),
    cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]'
  } } };
  const unifSp = { id: 'test:sp1', kind: 'student-progress-pagecloud', name: 'sp1', json: { data: {
    voctrain_students: JSON.stringify([
      { id: 'L1', name: 'Unified  person', course: 'WELDING L2', stage: 'training', progress: 40, gpa: '3.2', lastModified: '2026-03-01' },
      { id: 'L2', name: 'Tombstoned Person', course: 'WELDING L2', stage: 'testing' },
      { id: 'L3', name: 'Linked Wrongly', course: 'WELDING L2', stage: 'testing' }
    ]),
    voctrain_deletedStudentIds: JSON.stringify(['L2'])
  } } };
  const repU = await BOOT.runBootstrap({ sources: [unifFee, unifSp], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-3' });
  eq(repU.inventory.totals.lmsStudents, 2, 'two live LMS students (the legacy-deleted one is excluded)');
  eq(repU.inventory.totals.tombstonedLmsStudents, 1, 'and the tombstoned one is accounted, not imported');
  eq(repU.events.byType['person.registered'], 4, '5 source records → 4 people: the corroborated link pair collapsed to one');
  eq(repU.events.byType['enrolment.created'], 4, 'one enrolment each');
  eq(repU.events.byType['doc.upserted'], 3, 'roster documents for L1+L3 PLUS the queue item as a canonical doc (the queue folds on every device)');
  ok(repU.adjudicationQueue.some(q => /conflicting names/.test(q.suggestion)), 'the shared link with disagreeing names is a HUMAN queue item, not a merge');
  eq(repU.verification.storedBalanceDisagreements, 0, 'the unified ledger still matches the stored balance (100 − 30 = 70)');
  eq(repU.verification.financialIdentityHolds, true, 'and the financial identity holds across both sources');

  section('Academic coverage: attendance, exam results, grades, catalogues, profiles import losslessly');
  const acadSp = { id: 'test:sp2', kind: 'student-progress-pagecloud', name: 'sp2', json: { data: {
    voctrain_students: JSON.stringify([{ id: 'L9', name: 'Acad Person', course: 'WELDING L2' }]),
    voctrain_deletedStudentIds: '[]',
    voctrain_attendance: JSON.stringify([
      { studentId: 'L9', studentName: 'Acad Person', course: 'WELDING L2', date: '2026-03-02', days: { Mon: 'present', Tue: 'late' } },
      { studentName: 'No Ids Row' }
    ]),
    voctrain_examResults: JSON.stringify([
      { id: 'RES-1', examId: 'EX-1', studentId: 'L9', score: 78, passed: true },
      { examId: 'EX-2' }
    ])
  } } };
  const acadTg = { id: 'test:tg1', kind: 'transcript-grades-pagecloud', name: 'tg1', json: { data: {
    voctrain_transcriptGrades: JSON.stringify([{ id: 'TG-1', studentId: 'L9', qualId: 'QUAL-1', unitCode: 'U101', grade: 85, date: '02/03/2026', source: 'manual' }]),
    voctrain_unitCatalogs: JSON.stringify([{ id: 'QUAL-1', title: 'Welding L2', units: [{ code: 'U101', name: 'Safety' }] }]),
    voctrain_transcriptProfiles: JSON.stringify({ L9: { dob: '2002-03-04', address: '1 Test Lane', idNo: 'X1' } })
  } } };
  const repA = await BOOT.runBootstrap({ sources: [acadSp, acadTg], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-4' });
  eq(repA.inventory.totals.attendanceRows, 1, 'one valid attendance row staged');
  eq(repA.inventory.totals.examResults, 1, 'one valid exam result staged');
  eq(repA.inventory.totals.transcriptGrades, 1, 'the manual grade staged');
  eq(repA.inventory.totals.unitCatalogs, 1, 'the unit catalogue staged');
  eq(repA.inventory.totals.transcriptProfiles, 1, 'the transcript profile staged');
  eq(repA.events.byType['doc.upserted'], 6, 'roster + attendance + exam + grade + catalogue + profile documents (6)');
  ok(repA.quarantine.some(q => /attendance row without/.test(q.reason)) && repA.quarantine.some(q => /exam result without id/.test(q.reason)), 'invalid academic rows quarantined, not dropped');
  ok(repA.verification.brokerAccepted === repA.events.count && repA.verification.chainVerified, 'all academic documents pass the broker gates');

  section('LMS main backup: every collection imports; id-less records quarantine');
  const lmsBackup = { id: 'test:lmsb', kind: 'lms-backup', name: 'lmsb', json: { data: {
    userAccounts: [{ id: 'USR-1', username: 'admin1', role: 'admin', password: 'pbkdf2$1$s$h' }, { role: 'ghost' }],
    exams: [{ id: 'EX-1', title: 'Welding Final' }],
    announcements: [{ id: 'ANN-1', text: 'Term starts' }],
    chatMessages: { 'chat-admin': [{ id: 'msg-1', text: 'hello' }, { text: 'no id' }] },
    studentProfiles: { L1: { email: 'x@example.invalid' } },
    systemSettings: { institutionName: 'CESTIS' },
    students: [{ id: 'L1', name: 'Backup Person', course: 'WELDING L2' }],
    attendanceRecords: [{ studentId: 'L1', date: '2026-03-02', days: { Mon: 'present' } }]
  } } };
  const repL = await BOOT.runBootstrap({ sources: [lmsBackup], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-5' });
  eq(repL.inventory.totals.lmsDocs, 6, 'six collection documents staged (account, exam, announcement, chat message, profile, settings)');
  eq(repL.events.byType['doc.upserted'], 8, 'plus the roster document and the attendance row → 8 documents');
  eq(repL.events.byType['person.registered'], 1, 'the backup roster feeds the same identity pipeline');
  const lreasons = repL.quarantine.map(q => q.reason).join(' | ');
  ok(/account record without id/.test(lreasons), 'the id-less account is quarantined, not dropped');
  ok(/chat message without id/.test(lreasons), 'the id-less chat message is quarantined, not dropped');
  ok(repL.verification.brokerAccepted === repL.events.count && repL.verification.chainVerified, 'everything passes the broker gates');

  section('Master snapshot: all extractors run over the store; every key is accounted');
  const snap = { id: 'test:snap', kind: 'master-snapshot', name: 'snap', json: { store: {
    cestiSchoolFeeStudents: JSON.stringify([{ id: 'SF-Z1', name: 'Snap Person', skillArea: 'WELDING L2', tuitionFee: 10 }]),
    cestiSchoolFeePayments: '[]', cestiFeeStructure: '{}',
    cestiSchoolFeeDeletedPaymentIds: '[]', cestiSchoolFeeDeletedLmsIds: '[]',
    voctrain_users: JSON.stringify([{ id: 'USR-9', username: 'snapadmin', role: 'admin' }]),
    'cestis_quarter_2025/2026_Q3': '{}',
    weird_legacy_key: '1',
    schoolDashboardGoogleAccessToken: 'tok-should-be-ignored'
  } } };
  const repS = await BOOT.runBootstrap({ sources: [snap], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-6' });
  eq(repS.events.byType['person.registered'], 1, 'the fee student imports from the snapshot store');
  ok(repS.events.byType['doc.upserted'] >= 1, 'the account collection imports through the alias name');
  const sreasons = repS.quarantine.map(q => q.reason + '@' + q.path).join(' | ');
  ok(!/cestis_quarter_/.test(sreasons), 'cashbook keys are now CLAIMED by the finance extractor (no longer deferred)');
  ok(/not yet mapped@weird_legacy_key/.test(sreasons), 'an unknown key is loudly reported');
  ok(!/AccessToken/.test(sreasons), 'per-machine token keys are deliberately excluded, not noise');

  section('Finance/staff family: cashbook Tier-A, virements, docs, payroll — all gates');
  const fin = { id: 'test:fin', kind: 'finance-staff-pagecloud', name: 'fin', json: { data: {
    'cestis_quarter_2025/2026_Q3': JSON.stringify({ openingBalance: 100, transactions: [
      { id: 3, date: '2025-10-25', cheque: '', details: 'SUBVENTION', deposit: 200, payment: 0, category: 'Subvention' },
      { id: 9, date: '2025-10-25', cheque: '1000109', details: 'Salary October', deposit: 0, payment: 50, category: 'Coordinator Salary' },
      { id: 20, date: '2025-11-11', cheque: '1000119', details: 'Cancelled Cheque', deposit: 0, payment: 0, category: 'Cancelled', _origPayment: 25, _origCategory: 'Lunch', _origDetails: 'Lunch Register' },
      { id: 21, date: '2025-11-11', cheque: '1000120', details: 'Cancelled Cheque', deposit: 0, payment: 0, category: 'Cancelled' },
      { id: 30, date: '2025-11-12', cheque: '', details: 'Deleted later', deposit: 0, payment: 10, category: 'Admin Expenses' }
    ], deletedTxnIds: [30] }),
    'cestis_budget_2025/2026_Q3': JSON.stringify({ budget: { 'Coordinator Salary': 300, Lunch: 40 }, sections: { 'Coordinator Salary': 'Salaries', Lunch: 'Admin & Operations' } }),
    cesti_virements: JSON.stringify([
      { id: 111, fy: '2025/2026', quarter: 3, requestedBy: 'Coordinator', status: 'Approved', approvedBy: 'Admin', approvalDate: '2025-12-01', lines: [{ fromId: 'coordinator', toId: 'statutory', amount: 24.5 }] },
      { id: 222, fy: '2025/2026', quarter: 3, requestedBy: 'Coordinator', status: 'Pending', lines: [] }
    ]),
    cesti_virement_deleted_ids: '[]',
    cestis_finance_invoices: JSON.stringify([{ id: 'FD-1', number: '12551', docType: 'invoice', items: [] }]),
    cestis_finance_quotes: JSON.stringify([{ id: 'FD-2', docType: 'quote', items: [] }]),
    cestisPayroll: JSON.stringify({ settings: { nisRate: 3 }, employees: [{ name: 'Employee One', salary: 37145 }], payrollRuns: [{ date: '2026-07-25', results: [] }] }),
    cestisStaffMembers: JSON.stringify([{ id: 'STAFF1', username: 'staff1', fullName: 'Employee One' }]),
    cestisTimeRecords: JSON.stringify([{ id: 'SESSION_1', staffId: 'STAFF1', date: '2026-07-01' }]),
    cestiUsers: JSON.stringify([{ id: 7, username: 'feeadmin', role: 'Admin' }])
  } } };
  const repF = await BOOT.runBootstrap({ sources: [fin], adapter: MemoryAdapter(), dryRun: true, runStamp: STAMP, runId: 'imp_test-7' });
  eq(repF.inventory.totals.cashbookEntries, 3, 'three importable entries (income, salary, voided-orig)');
  eq(repF.inventory.totals.cashbookIncomeMinor, 20000, 'income baseline 200.00');
  eq(repF.inventory.totals.cashbookExpenseMinor, 5000, 'expense baseline 50.00 — the voided cheque counts ZERO, like the legacy totals');
  eq(repF.inventory.totals.cashbookVoided, 1, 'and is accounted as a voided import');
  eq(repF.inventory.totals.cashbookDeletedTxns, 1, 'the legacy-deleted txn is accounted, not imported');
  ok(repF.verification.cashbookIdentityHolds, 'CASHBOOK identity: fold income/expense equals the inventory baseline to the cent');
  eq(repF.events.byType['cashbook.entry.recorded'], 3, 'entries synthesized');
  eq(repF.events.byType['cashbook.cheque.voided'], 1, 'the voided cheque superseded, not erased');
  eq(repF.events.byType['budget.set'], 1, 'budget imported');
  eq(repF.events.byType['virement.requested'], 1, 'the valid virement imported');
  eq(repF.events.byType['virement.decided'], 1, 'with its approval as a decision event');
  ok(repF.quarantine.some(q => /virement without valid lines/.test(q.reason)), 'the line-less virement quarantines, not dropped');
  eq(repF.events.byType['findoc.issued'], 2, 'both finance documents imported');
  ok(repF.verification.brokerAccepted === repF.events.count && repF.verification.chainVerified, 'everything passes the broker gates');
  // Legacy numbers preserved; missing numbers get the new series.
  const finEvents = await (async () => { const m = MemoryAdapter(); await BOOT.runBootstrap({ sources: [fin], adapter: m, dryRun: true, runStamp: STAMP, runId: 'imp_test-7' }); return m.get('staging', 'events'); })();
  const BRK = require('../megadata/broker-core.js');
  const b2 = BRK.createBroker();
  const res2 = await b2.append({ events: finEvents }, { nowIso: STAMP });
  const invEvt = finEvents.find(e => e.type === 'findoc.issued' && e.payload.kind === 'invoice');
  const quoEvt = finEvents.find(e => e.type === 'findoc.issued' && e.payload.kind === 'quote');
  eq(res2.acks[invEvt.id].assigned, null, 'the legacy invoice KEEPS number 12551 — no reassignment');
  eq(res2.acks[quoEvt.id].assigned, { number: 'QUO-000001' }, 'the number-less quote gets the new series');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
