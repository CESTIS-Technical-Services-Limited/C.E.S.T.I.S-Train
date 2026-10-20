/* Issuing and withdrawing certificates — one rule, on every page.

   What went wrong (certs-03, certs-06, admin-06, the missed Student Progress
   findings):
     - Student Progress's Update Stage — the screen the Centre actually issues
       certificates from — drew four RANDOM digits every time "Certified" was
       saved. Re-saving a trainee whose certificate was already printed gave
       them a new number and re-dated it, so the paper no longer verified.
     - Its prefix was the raw programme text: "02. Electrical Installation"
       printed certificates numbered 02-2026-xxxx, and a trainee with no
       programme threw a TypeError half-way through the update.
     - Four digits are 9000 numbers: two trainees of one cohort of 60 shared a
       number about one time in five. The dashboard's derived numbers avoided
       a clash only against the local roll, so two devices numbering the same
       pair in a different order gave one number to two people.
     - Moving a certified trainee back to In Training left the certificate and
       the approved download on the record, and the approvals reconcile then
       promoted them straight back to Certified — a trainee could not be
       demoted at all.
   What is pinned here: CESTISCore.certs (the one rule), and the REAL
   updateStudentStage from Student-Progress.html (both builds) driven through
   it, with the dashboard's reconcile run afterwards.

   Run: node tests/cert-issuance.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const BUILDS = [
  { where: '', core: require('../cestis-core.js') },
  { where: 'Offline System/', core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- 1. The shared rule ---------- */
console.log('A certificate number, once issued, never changes; withdrawal keeps it and says so');
BUILDS.forEach(function (b) {
  const K = b.core.certs, w = b.where || 'root';
  const roll = [{ id: 'STU-a', name: 'Ann Brown', course: '02. Electrical Installation', stage: 'training', progress: 70 }];
  const approvals = [];
  const s = roll[0];
  let r = K.applyStage(s, 'certified', { roll, approvals, by: 'Admin', now: '2026-03-01T10:00:00.000Z' });
  assert(r.issued && /^EL-2026-\d{4}-[A-HJ-NP-Z]{2}$/.test(s.certNo), w + ': the intake key never becomes the prefix, and the number is PREFIX-YEAR-NNNN-XX: ' + s.certNo);
  assertEq(s.certDate, 'March 01, 2026', w + ': the certificate is dated the day it was issued');
  const first = s.certNo;
  K.applyStage(s, 'certified', { roll, approvals, now: '2026-05-01T10:00:00.000Z' });
  assertEq(s.certNo, first, w + ': saving Certified again keeps the number');
  assertEq(s.certDate, 'March 01, 2026', w + ': and the date');
  K.applyStage(s, 'collected', { roll, approvals });
  assert(s.certNo === first && s.certCollected === true && s.progress === 100, w + ': Collected keeps the number too');

  approvals.push({ studentId: 'STU-a', certNo: first, approved: true, approvedDate: '2026-03-02T00:00:00.000Z' });
  r = K.applyStage(s, 'training', { roll, approvals, by: 'Registrar', reason: 'Assessment re-sit', now: '2026-06-01T09:00:00.000Z' });
  assert(r.revoked && s.certNo === null && s.certNoAliases.indexOf(first) !== -1, w + ': demotion withdraws the certificate and keeps the number on record');
  assert(K.isRevoked(s) && s.certRevokedBy === 'Registrar' && s.certRevokedReason === 'Assessment re-sit' && s.certRevokedAt === '2026-06-01T09:00:00.000Z', w + ': stamped with who, why and when');
  assert(approvals[0].approved === false && approvals[0].revokedAt === '2026-06-01T09:00:00.000Z', w + ': the download approval is switched off with the same decision time');
  assertEq(K.status(s), 'revoked', w + ': and the number verifies as revoked');
  const hit = K.resolve(first, roll, approvals);
  assert(hit.student === s && hit.via === 'alias' && !hit.ambiguous, w + ': the paper still resolves to its holder');
  assert(s.certHistory.length === 1 && s.certHistory[0].event === 'revoked' && s.certHistory[0].certNo === first && s.certHistory[0].certDate === 'March 01, 2026', w + ': the history keeps what was withdrawn');

  K.applyStage(s, 'certified', { roll, approvals, by: 'Admin', now: '2026-07-01T09:00:00.000Z' });
  assert(s.certNo === first && !K.isRevoked(s) && K.status(s) === 'valid', w + ': re-certified, the same number comes back, current again');
  assertEq(s.certHistory.map(h => h.event).join(','), 'revoked,reinstated', w + ': and the history says so');

  const blank = { id: 'STU-x', name: 'No Programme', stage: 'training' };
  let threw = false;
  try { K.applyStage(blank, 'certified', { roll: [blank] }); } catch (e) { threw = true; }
  assert(!threw && /^CE-\d{4}-\d{4}-[A-Z]{2}$/.test(blank.certNo), w + ': a trainee with no programme gets a number instead of a TypeError: ' + blank.certNo);

  // The old four-digit numbers are left exactly as printed.
  const old = { id: 'STU-o', name: 'Old Hand', course: 'Plumbing', stage: 'certified', certNo: 'PL-2026-0042', certDate: 'January 05, 2026' };
  K.applyStage(old, 'certified', { roll: [old] });
  K.ensureNumber(old, { roll: [old] });
  assertEq(old.certNo, 'PL-2026-0042', w + ': a number issued in the old form is never renumbered');
});

/* ---------- 2. Unique, and the same on every device ---------- */
console.log('Two people never share a number, and two devices agree on everyone\'s');
BUILDS.forEach(function (b) {
  const K = b.core.certs, w = b.where || 'root';
  const cohort = [];
  for (let i = 0; i < 200; i++) cohort.push({ id: 'S' + i, name: 'Trainee ' + i, course: 'Welding', stage: 'certified', certDate: 'October 01, 2026' });
  const a = clone(cohort), r = clone(cohort).reverse();
  a.forEach(s => K.ensureNumber(s, { roll: a }));
  r.forEach(s => K.ensureNumber(s, { roll: r }));
  const nos = a.map(s => s.certNo);
  assertEq(new Set(nos).size, 200, w + ': 200 trainees of one programme and year, 200 numbers');
  const byId = {}; r.forEach(s => { byId[s.id] = s.certNo; });
  assert(a.every(s => byId[s.id] === s.certNo), w + ': numbered in the opposite order, every trainee gets the same number');

  // Trainee 1008 and Trainee 3162 derive the same first number. Whichever is
  // numbered first, the one whose seed sorts first keeps it.
  const pair = [1008, 3162].map(i => ({ id: 'S' + i, name: 'Trainee ' + i, course: 'Welding', stage: 'certified', certDate: 'October 01, 2026' }));
  assertEq(K.generateNumber('WE', pair[0], []), K.generateNumber('WE', pair[1], []), w + ': (the pair really does clash on its first number)');
  const d1 = clone(pair), d2 = clone(pair).reverse();
  d1.forEach(s => K.ensureNumber(s, { roll: d1 }));
  d2.forEach(s => K.ensureNumber(s, { roll: d2 }));
  const n1 = {}, n2 = {};
  d1.forEach(s => { n1[s.id] = s.certNo; }); d2.forEach(s => { n2[s.id] = s.certNo; });
  assert(n1.S1008 === n2.S1008 && n1.S3162 === n2.S3162 && n1.S1008 !== n1.S3162, w + ': the clash resolves the same way on both devices: ' + JSON.stringify(n1) + ' / ' + JSON.stringify(n2));

  // One number found on two different people is reported, not guessed.
  const roll = [{ id: 'A', name: 'Ann', course: 'Welding', certNo: 'WE-2026-1111' }, { id: 'B', name: 'Bob', course: 'Welding', certNo: 'WE-2026-2222', certNoAliases: ['WE-2026-1111'] }];
  const amb = K.resolve('we 2026 1111', roll, []);
  assert(amb.ambiguous === true, w + ': a number held by two different people is reported as ambiguous');
  roll[1].name = 'Ann'; roll[1].id = 'A2';
  assertEq(K.resolve('WE-2026-1111', roll, []).ambiguous, false, w + ': but two copies of one person are not');
});

/* ---------- 3. A withdrawal survives a sync ---------- */
console.log('A withdrawal and a revoked approval outlive a sync with a device that has not heard of them');
BUILDS.forEach(function (b) {
  const C = b.core, K = C.certs, w = b.where || 'root';
  const certified = { id: 'S1', name: 'Ann', course: 'Welding', stage: 'certified', certNo: 'WE-2026-1111', certDate: 'March 01, 2026', lastModified: '2026-06-01T00:00:00.000Z' };
  const withdrawn = clone(certified);
  K.revoke(withdrawn, [], { by: 'Admin', now: '2026-06-02T00:00:00.000Z' });
  withdrawn.stage = 'training'; withdrawn.lastModified = '2026-06-02T00:00:00.000Z';
  // The other device later edits something else on its old certified copy.
  const later = Object.assign(clone(certified), { attendance: 88, lastModified: '2026-06-03T00:00:00.000Z' });
  const m = C.mergeStudentRecords(withdrawn, later);
  assert(K.isRevoked(m), w + ': the merged record is still withdrawn, though the other copy was edited later');
  assertEq(K.status(m), 'revoked', w + ': and verifies as revoked');
  assert(!K.isRevoked(later) && later.certRevokedAt === undefined, w + ': (neither input is changed by the merge)');

  const approved = { studentId: 'S1', approved: true, approvedDate: '2026-03-02T00:00:00.000Z', downloadCount: 1 };
  const revoked = { studentId: 'S1', approved: false, approvedDate: '2026-03-02T00:00:00.000Z', revokedAt: '2026-06-02T00:00:00.000Z', downloadCount: 1 };
  assertEq(C.cloudMerge.bestApproval(revoked, approved).approved, false, w + ': a stale approved copy no longer outvotes a revocation');
  assertEq(C.cloudMerge.bestApproval(approved, revoked).approved, false, w + ': whichever side it arrives from');
  const reApproved = Object.assign(clone(revoked), { approved: true, approvedDate: '2026-07-01T00:00:00.000Z' });
  assertEq(C.cloudMerge.bestApproval(revoked, reApproved).approved, true, w + ': a later re-approval wins in turn');
  const list = [clone(revoked)];
  C.cloudMerge.applyApproval(list, approved);
  assertEq(list[0].approved, false, w + ': applyApproval follows the same rule');

  // Downloads on two devices add up.
  const a1 = { studentId: 'S1', approved: true, approvedDate: '2026-03-02T00:00:00.000Z', downloadCount: 2, lastDownloaded: '2026-03-03T00:00:00.000Z' };
  const a2 = clone(a1);
  K.recordDownload(a1, 'D-office', '2026-04-01T00:00:00.000Z');
  K.recordDownload(a2, 'D-kiosk', '2026-04-02T00:00:00.000Z');
  K.recordDownload(a2, 'D-kiosk', '2026-04-03T00:00:00.000Z');
  const merged = C.cloudMerge.bestApproval(a1, a2);
  assertEq(merged.downloadCount, 5, w + ': two earlier downloads plus one here and two there make five, not three');
  assertEq(merged.lastDownloaded, '2026-04-03T00:00:00.000Z', w + ': the latest download time is kept');
  assertEq(C.cloudMerge.bestApproval(merged, a1).downloadCount, 5, w + ': merging an older copy again changes nothing');
});

/* ---------- 4. The live Update Stage, in Student Progress ---------- */
console.log('Student Progress\'s Update Stage issues and withdraws through the shared rule');
BUILDS.forEach(function (b) {
  const w = (b.where || '') + 'Student-Progress.html';
  const src = fs.readFileSync(path.join(ROOT, b.where, 'Student-Progress.html'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, b.where, 'index.html'), 'utf8');
  const store = {};
  const sb = {
    console, Math, Date, JSON, String, Array, Object, parseFloat, RegExp,
    CESTISCore: b.core, CESTISStore: { getItem: k => (k in store ? store[k] : null) },
    students: [], certDownloadApprovals: [], examResults: [], skillAreas: [],
    stages: ['testing', 'interview', 'training', 'certified', 'collected', 'nyc', 'incomplete'],
    stageLabels: { training: 'In Training', certified: 'Certified', collected: 'Collected' },
    _sel: 'certified', _confirms: [], _confirmAnswer: true, saved: 0,
    confirm(msg) { sb._confirms.push(msg); return sb._confirmAnswer; },
    closeModal() {}, filterStudents() {}, updatePipelineCounts() {}, showToast() {}, saveData() { sb.saved++; }, saveState() { sb.saved++; },
    // The viewer here may manage trainees (the view-only gate is pinned in
    // record-page-session-gate.test.js); this test is about what issuing does.
    spRefuseEdit() { return false; },
    window: {}
  };
  sb.document = { getElementById: id => id === 'newStage' ? { value: sb._sel } : id === 'spStageNotes' ? { value: 'Re-sit' } : null };
  vm.createContext(sb);
  vm.runInContext(['spCertEligibility', 'spActorName', 'spMarkStageSetByUser', 'updateStudentStage'].map(n => extractFunction(src, n, w)).join('\n'), sb);
  // The dashboard's reconcile, which used to promote a demoted trainee back.
  vm.runInContext(['_certApprovalList', '_certRoll', 'certNumberKey', 'certRememberAlias', '_certApprovalOf', 'certAlignNumberWithApproval', 'reconcileCertifiedFromApprovals']
    .map(n => extractFunction(idx, n, 'index.html')).join('\n'), sb);
  assert(extractFunction(src, 'updateStudentStage', w).indexOf('Math.random') === -1, w + ': no random number is drawn any more');

  sb.students.push({ id: 'STU-1', name: 'Kemar Grant', course: '01. Plumbing', stage: 'training', attendance: 92 });
  sb.examResults.push({ id: 'R1', studentId: 'STU-1', examId: 'E1', score: 45, passed: false });
  vm.runInContext('updateStudentStage(0)', sb);
  const s = sb.students[0];
  assert(/^PL-\d{4}-\d{4}-[A-Z]{2}$/.test(s.certNo), w + ': Certified issues PREFIX-YEAR-NNNN-XX from the programme, not the intake key: ' + s.certNo);
  assert(s.stageSetByUser === true, w + ': the stage is marked as the Centre\'s decision');
  const no = s.certNo, date = s.certDate;
  vm.runInContext('updateStudentStage(0)', sb);
  assert(s.certNo === no && s.certDate === date, w + ': saving Certified again keeps the number and the date');
  assertEq(sb._confirms.length, 1, w + ': a failed exam on record is put to the administrator before issuing (and only once: re-saving issues nothing new)');
  assert(/Assessments passed: 0 of 1/.test(sb._confirms[0]) && /Attendance: 92%/.test(sb._confirms[0]) && /Fees cleared/.test(sb._confirms[0]),
    w + ': and it lists assessments, attendance and fees');

  sb.certDownloadApprovals.push({ studentId: 'STU-1', name: s.name, course: s.course, certNo: no, approved: true, approvedDate: '2026-01-01T00:00:00.000Z' });
  sb._sel = 'training';
  vm.runInContext('updateStudentStage(0)', sb);
  assert(s.stage === 'training' && s.certNo === null && s.certNoAliases.indexOf(no) !== -1 && s.certRevokedReason === 'Re-sit', w + ': demoting withdraws the certificate, keeping the number and the reason');
  assertEq(sb.certDownloadApprovals[0].approved, false, w + ': and switches the download off');
  vm.runInContext('reconcileCertifiedFromApprovals()', sb);
  assertEq(s.stage, 'training', w + ': the dashboard\'s reconcile no longer promotes them back');

  sb._sel = 'certified';
  vm.runInContext('updateStudentStage(0)', sb);
  assert(s.certNo === no && !b.core.certs.isRevoked(s), w + ': re-certified, the same number comes back');

  // A trainee with no programme no longer throws half-way through.
  sb.students.push({ id: 'STU-2', name: 'No Course', stage: 'training' });
  let threw = false;
  try { vm.runInContext('updateStudentStage(1)', sb); } catch (e) { threw = true; }
  assert(!threw && sb.students[1].stage === 'certified' && !!sb.students[1].certNo, w + ': a record with no programme is certified without a TypeError');

  // Declining the checklist issues nothing.
  sb.students.push({ id: 'STU-3', name: 'Low Attendance', course: 'Plumbing', stage: 'training', attendance: 40 });
  sb._confirmAnswer = false;
  vm.runInContext('updateStudentStage(2)', sb);
  assert(sb.students[2].stage === 'training' && !sb.students[2].certNo, w + ': answering No to the checklist leaves the trainee as they were');
});

/* ---------- 5. The eligibility checklist ---------- */
console.log('The checklist warns from the Centre\'s own records, and says what it could not check');
BUILDS.forEach(function (b) {
  const K = b.core.certs, w = b.where || 'root';
  const qual = { id: 'Q1', units: [{ code: 'U1', name: 'Unit one' }, { code: 'U2', name: 'Unit two' }] };
  const s = { id: 'S1', name: 'Ann', course: 'Welding', attendance: 85 };
  let e = K.eligibility(s, { qual, manualGrades: [{ studentId: 'S1', qualId: 'Q1', unitCode: 'U1', grade: 75 }, { studentId: 'S1', qualId: 'Q1', unitCode: 'U2', grade: 55 }],
    feeRecord: { tuitionFee: 1000, totalPaid: 400 } });
  const by = {}; e.items.forEach(i => { by[i.key] = i; });
  assert(by.units.state === 'warn' && /1 of 2 units competent/.test(by.units.detail) && /U2/.test(by.units.detail), w + ': a unit below 60 is named');
  assertEq(by.attendance.state, 'ok', w + ': 85% attendance clears the line');
  assert(by.fees.state === 'warn' && /Owes \$600\.00/.test(by.fees.detail), w + ': an unpaid balance is shown');
  assertEq(e.warnings, 2, w + ': two things to check');
  e = K.eligibility({ id: 'S2', name: 'Bob' }, {});
  assert(e.warnings === 0 && e.items.every(i => i.state === 'unknown'), w + ': nothing on record is "unknown", not a pass and not a block');
  // The transcript system's own verdict is used when this build has one.
  b.core.transcriptReadiness = function () { return { ready: false, detail: 'Two units outstanding' }; };
  e = K.eligibility(s, { qual });
  delete b.core.transcriptReadiness;
  assert(e.items[0].state === 'warn' && e.items[0].detail === 'Two units outstanding', w + ': CESTISCore.transcriptReadiness, when present, answers the assessments line');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
