/* Academic records a training school can stand behind — the shared rules in
   cestis-core.js that the Transcript, Student Progress and dashboard pages use.

   What each block pins (finding ids in brackets):
     - a rename or programme change carries the trainee's manual grades,
       transcript header, requests and profile email to the new id; the grade
       is re-filed under the id its new student gives it (transcripts-02,
       transcripts-22, missed #4);
     - an exam still being marked is never a grade (transcripts-08);
     - one exam is credited to the unit it is FOR, not to every unit whose name
       contains its title, and never to another programme (transcripts-09);
     - each trainee is graded against their own plan (transcripts-10);
     - "Competent" / "NYC" are results, not zeros, and every output judges a
       grade by one pass-mark rule (transcripts-12, transcripts-15);
     - blank / duplicate unit codes are refused; a re-coded unit's grades can
       be carried across; recorded grades are never hidden; an issued
       transcript keeps the catalogue it was issued from (transcripts-13, -14);
     - transcriptReadiness, which the certificate checklist calls
       (transcripts-17);
     - grade resolution indexes results once (transcripts-25);
     - request queues merge request by request on every sync path
       (transcripts-03, missed #2);
     - a person's other enrolments are linked, strictly for a trainee
       (transcripts-26);
     - a deleted trainee's tombstone no longer blocks a new enrolment of the
       same name (admin-04); a new centre never reuses a deleted centre's id
       or key (admin-05); the time-clock merge takes a clock-out (admin-19).

   Run: node tests/transcript-records.test.js */
'use strict';

const Core = require('../cestis-core.js');
const T = Core.Transcript;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function memStore(init) {
  const data = Object.assign({}, init || {});
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
}

/* ---------- 1. A rename carries every academic record ---------- */
console.log('A renamed trainee keeps their grades, transcript header, requests and email');
{
  const before = { id: 'X', name: 'Jhon Brown', course: 'Cosmetology' };
  const oldId = Core.stableStudentId(before);
  before.id = oldId;
  const grade = T.upsertManualGrade([], { studentId: oldId, qualId: 'QUAL-COS-L2', unitCode: 'U2', grade: 88, updatedAt: '2026-01-01T00:00:00Z' });
  const store = memStore({
    voctrain_transcriptGrades: JSON.stringify(grade),
    voctrain_transcriptProfiles: JSON.stringify({ [oldId]: { dob: '01/02/2000', idNo: '123', updatedAt: '2026-01-01T00:00:00Z' } }),
    voctrain_certTranscriptRequests: JSON.stringify([T.newRequest({ studentId: oldId, type: 'transcript' })])
  });
  const profiles = { [oldId]: { email: 'j@x.jm' } };
  const renamed = { id: oldId, name: 'John Brown', course: 'Cosmetology' };
  const bundle = { students: [renamed], userAccounts: [], attendanceRecords: [], certDownloadApprovals: [], examResults: [], studentProfiles: profiles };
  const res = Core.migrateToStableIds(bundle);
  const newId = Core.stableStudentId(renamed);
  assert(newId !== oldId && bundle.students[0].id === newId, 'the rename moved the stable id');
  Core.relinkStoredDependents(res.idMap, store);
  const g = JSON.parse(store.data.voctrain_transcriptGrades);
  assertEq(g[0].studentId, newId, 'the manual grade follows the trainee');
  assertEq(g[0].id, T.manualGradeId(newId, 'QUAL-COS-L2', 'U2'), 'and is re-filed under the id the new student gives it');
  const rows = T.effectiveGrades({ qual: { id: 'QUAL-COS-L2', units: [{ code: 'U2', name: 'Two' }] }, studentId: newId, manualGrades: g });
  assertEq(rows[0].grade, 88, 'so the transcript still shows it');
  // Removal is written down (removed: true, grade null) rather than erased, so
  // no other copy can put the grade back (transcripts-07): the override is
  // gone from the transcript and no ghost record is left behind it.
  const afterRemove = T.removeManualGrade(g, newId, 'QUAL-COS-L2', 'U2');
  const rowsAfter = T.effectiveGrades({ qual: { id: 'QUAL-COS-L2', units: [{ code: 'U2', name: 'Two' }] }, studentId: newId, manualGrades: afterRemove });
  assert(afterRemove.length === 1 && afterRemove[0].removed === true && rowsAfter[0].source !== 'manual',
    'and removing the override really removes it (no ghost)');
  assertEq(JSON.parse(store.data.voctrain_transcriptProfiles)[newId].dob, '01/02/2000', 'the transcript header follows');
  assert(T.hasOpenRequest(JSON.parse(store.data.voctrain_certTranscriptRequests), newId, 'transcript'), 'the open request follows');
  assertEq(bundle.studentProfiles[newId], { email: 'j@x.jm' }, 'the profile email follows');
  assert(!(oldId in bundle.studentProfiles), 'and is no longer stranded on the old id');

  // Both ids already hold a profile / a grade: the newer one stands, nothing is deleted.
  const data = {
    transcriptProfiles: { A: { dob: 'old', updatedAt: '2026-01-01T00:00:00Z' }, B: { dob: 'new', updatedAt: '2026-05-01T00:00:00Z' } },
    transcriptGrades: T.upsertManualGrade(T.upsertManualGrade([], { studentId: 'A', qualId: 'Q', unitCode: 'U', grade: 50, updatedAt: '2026-06-01T00:00:00Z' }),
                                           { studentId: 'B', qualId: 'Q', unitCode: 'U', grade: 70, updatedAt: '2026-02-01T00:00:00Z' })
  };
  Core.relinkDependentData({ A: 'B' }, data);
  assertEq(data.transcriptProfiles.B.dob, 'new', 'the more recently saved header stays under the new id');
  assertEq(data.transcriptProfiles.A.dob, 'old', 'the other is left where it was, not deleted');
  assertEq(data.transcriptGrades.length, 1, 'two grades for one unit collapse to one');
  assertEq(data.transcriptGrades[0].grade, 50, 'the more recently saved grade stands');

  // Nothing moves, nothing is written.
  const s2 = memStore({ voctrain_transcriptGrades: '[]' });
  assertEq(Core.relinkStoredDependents({}, s2), [], 'an empty id map writes nothing');
}

/* ---------- 2. Provisional exam scores are never grades ---------- */
console.log('An exam still being marked shows as awaiting marking, never as a grade');
{
  const qual = { id: 'Q', units: [{ code: 'BSB1', name: 'Plan and manage meetings' }] };
  const exams = [{ id: 'E1', title: 'BSB1 final', passMark: 70 }];
  let rows = T.effectiveGrades({ qual, studentId: 'S', exams, manualGrades: [],
    examResults: [{ id: 'R1', examId: 'E1', studentId: 'S', score: 40, needsReview: true, reviewComplete: false, submittedAt: '2026-01-02T00:00:00Z' }] });
  assertEq([rows[0].source, rows[0].grade], ['pending', null], 'a provisional 40 is not the unit grade');
  assertEq(T.displayGrade(rows[0]), 'Awaiting marking', 'and reads "Awaiting marking" on every output');
  assertEq(T.resultForRow(rows[0], qual), 'PENDING', 'with no result yet');
  rows = T.effectiveGrades({ qual, studentId: 'S', exams, manualGrades: [],
    examResults: [{ id: 'R1', examId: 'E1', studentId: 'S', score: 85, needsReview: true, reviewComplete: true, submittedAt: '2026-01-02T00:00:00Z' }] });
  assertEq([rows[0].source, rows[0].grade, rows[0].passMark], ['exam', 85, 70], 'once marked, the final score counts, with the exam\'s pass mark');
}

/* ---------- 3. One exam, the unit it is for ---------- */
console.log('An exam is credited to the unit it is for, and only in its own programme');
{
  const cats = T.seedCatalogs();
  let cross = [];
  cats.forEach(function (q) {
    q.units.forEach(function (a) {
      const hit = T.unitsForExam({ title: a.name }, q.units);
      Object.keys(hit).forEach(function (code) { if (code !== a.code) cross.push(q.id + ': ' + a.name + ' -> ' + code); });
    });
  });
  assertEq(cross, [], 'no seeded unit\'s name credits a different unit of its plan');
  const cos = cats.filter(q => q.id === 'QUAL-COS-L2')[0];
  const shaping = cos.units.filter(u => /^perform hair shaping$/i.test(u.name))[0];
  const curly = cos.units.filter(u => /excessively curly/i.test(u.name))[0];
  assert(shaping && curly, 'the seeded Cosmetology plan has both hair-shaping units');
  const rows = T.effectiveGrades({ qual: cos, studentId: 'S', manualGrades: [], exams: [{ id: 'E', title: 'Perform hair shaping' }],
    examResults: [{ id: 'R', examId: 'E', studentId: 'S', score: 90, submittedAt: '2026-01-01T00:00:00Z' }] });
  const by = {}; rows.forEach(r => { by[r.code] = r.grade; });
  assertEq([by[shaping.code], by[curly.code]], [90, null], '"Perform hair shaping" no longer grades the excessively-curly unit');
  assert(!T.examMatchesUnit({ title: 'hair shaping' }, shaping), 'a title merely contained in a unit name does not match');
  assertEq(Object.keys(T.unitsForExam({ title: 'Anything', unitCodes: [curly.code] }, cos.units)), [curly.code], 'an exam\'s explicit unit codes are the link');
  // Another programme's exam never grades this plan.
  const eim3 = cats.filter(q => q.id === 'QUAL-EIM-L3')[0];
  const u = eim3.units[0];
  const exams = [{ id: 'W', title: u.code + ' ' + u.name, course: 'Welding L3' }];
  const results = [{ id: 'R', examId: 'W', studentId: 'S', score: 77, submittedAt: '2026-01-01T00:00:00Z' }];
  assertEq(T.effectiveGrades({ qual: eim3, studentId: 'S', manualGrades: [], exams, examResults: results, catalogs: cats })[0].grade, null,
    'a Welding exam does not grade an Electrical unit');
  exams[0].course = 'Electrical Installation and Maintenance L3';
  assertEq(T.effectiveGrades({ qual: eim3, studentId: 'S', manualGrades: [], exams, examResults: results, catalogs: cats })[0].grade, 77,
    'the same exam set for the programme does');
}

/* ---------- 4. Each trainee against their own plan ---------- */
console.log('Each trainee is graded against their own programme\'s plan');
{
  const cats = T.seedCatalogs();
  assertEq(T.qualForTrainee(cats, { course: 'Electrical Installation and Maintenance L3' }, 'Electrical Installation').id, 'QUAL-EIM-L3', 'a Level 3 trainee gets the Level 3 plan, not the instructor\'s');
  assertEq(T.qualForTrainee(cats, { course: '', qualId: 'QUAL-WEL-L3' }).id, 'QUAL-WEL-L3', 'a plan pinned on the record wins');
  assertEq(T.qualForTrainee(cats, { course: 'COMMI CHEF L2' }, 'Welding & Fabrication').id, 'QUAL-WEL-L2', 'the instructor\'s course is only the fallback');
}

/* ---------- 5. Competency grades and one pass-mark rule ---------- */
console.log('Competent / NYC are results, and one pass-mark rule decides every output');
{
  const stats = T.gradeStats([{ grade: 40 }, { grade: 81 }, { grade: 'Competent' }]);
  assertEq([stats.graded, stats.average, stats.competent, stats.nyc], [3, 60.5, 2, 1], '"Competent" counts as achieved, not as 0 in the average');
  assertEq(T.resultFor('NYC'), 'NYC', 'NYC typed in is NYC');
  assertEq(T.resultFor('c'), 'COMPETENT', 'C is Competent');
  assertEq(T.resultFor(65, 70), 'NYC', '65 against a pass mark of 70 is not yet competent');
  assertEq(T.resultFor(65, 0), 'COMPETENT', 'a pass mark of 0 is a pass mark');
  assertEq(T.resultFor('A'), 'PENDING', 'an unknown word is not a result');
  assertEq(T.passMarkFor({ passMark: 75, units: [{ code: 'U', passMark: 50 }] }, { code: 'U' }), 50, 'a unit\'s own pass mark beats the plan\'s');
  assertEq(T.passMarkFor({ passMark: 75, units: [] }, { code: 'U', passMark: 0 }), 0, 'an exam row\'s pass mark beats both, 0 included');
  assertEq(T.passMarkFor(null, { code: 'U' }), 60, 'and 60 when nothing says otherwise');
  assertEq(T.gradeStats([{ grade: 90 }, { grade: 80.5 }, { grade: null }, { grade: '' }]).average, 85.3, 'percentage-only averages are unchanged');
}

/* ---------- 6. The catalogue: codes, re-codes, hidden grades, issued copies ---------- */
console.log('Catalogue edits never lose or hide a recorded grade, nor rewrite an issued transcript');
{
  const probs = T.validateCatalogUnits([{ code: 'A1', name: 'a' }, { code: '', name: 'Site induction' }, { code: 'a1', name: 'dup' }]);
  assertEq(probs.map(p => p.problem), ['blank-code', 'duplicate-code'], 'a blank code and a duplicate code are both refused');
  const qual = { id: 'Q', title: 'OLD TITLE', units: [{ code: 'NEW1', name: 'One' }] };
  let grades = [];
  ['S1', 'S2', 'S3'].forEach(s => { grades = T.upsertManualGrade(grades, { studentId: s, qualId: 'Q', unitCode: 'OLD1', grade: 80, updatedAt: '2026-01-01T00:00:00Z' }); });
  assertEq(T.orphanedGrades(qual, grades, 'S1').length, 1, 'a grade on a re-coded unit is listed, not hidden');
  const moved = T.renameUnitCode(grades, 'Q', 'OLD1', 'NEW1', 'admin', '2026-02-01T00:00:00Z');
  assertEq(moved.moved, 3, 'the administrator can carry all three grades to the new code');
  assertEq(moved.list.length, 6, 'the old records are kept');
  assertEq(T.orphanedGrades(qual, moved.list).length, 0, 'and, marked superseded, are no longer listed as orphans');
  assertEq(T.effectiveGrades({ qual, studentId: 'S2', manualGrades: moved.list, exams: [], examResults: [] })[0].grade, 80, 'the grade shows on the new code');
  // Issued once, printed from the copy for ever after.
  const issuedProfiles = T.recordIssue({ S1: { dob: 'x' } }, 'S1', qual, '2026-03-01T00:00:00Z');
  assertEq(issuedProfiles.S1.dob, 'x', 'issuing keeps the header');
  const live = { id: 'Q', title: 'NEW TITLE', units: [] };
  const printed = T.issuedQualFor(issuedProfiles, 'S1', 'Q');
  assertEq([printed.title, printed.units.length, printed.issuedSnapshot], ['OLD TITLE', 1, true], 'a re-titled, emptied catalogue does not change an issued transcript');
  assertEq(JSON.stringify(T.recordIssue(issuedProfiles, 'S1', live)), JSON.stringify(issuedProfiles), 'a reprint does not replace the copy');
  assertEq(T.issuedQualFor({}, 'S2', 'Q'), null, 'a trainee never issued one uses the live catalogue');
}

/* ---------- 7. Certification readiness ---------- */
console.log('transcriptReadiness says whether the transcript supports a certificate');
{
  const qual = { id: 'Q', title: 'Plan', units: [{ code: 'C1', name: 'Core one' }, { code: 'C2', name: 'Core two' }, { code: 'E1', name: 'Elective', coreElective: 'Elective' }] };
  let grades = T.upsertManualGrade([], { studentId: 'S', qualId: 'Q', unitCode: 'C1', grade: 80 });
  let r = T.transcriptReadiness({ id: 'S', course: 'x', qualId: 'Q' }, { catalogs: [qual], grades });
  assertEq([r.status, r.ready, r.missingCore], ['incomplete', false, ['C2']], 'a missing core unit means not ready');
  grades = T.upsertManualGrade(grades, { studentId: 'S', qualId: 'Q', unitCode: 'C2', grade: 'NYC' });
  r = T.transcriptReadiness({ id: 'S', qualId: 'Q' }, { catalogs: [qual], grades });
  assertEq([r.status, r.nycUnits], ['nyc', ['C2']], 'a not-yet-competent unit is named');
  grades = T.upsertManualGrade(grades, { studentId: 'S', qualId: 'Q', unitCode: 'C2', grade: 'C' });
  r = T.transcriptReadiness({ id: 'S', qualId: 'Q' }, { catalogs: [qual], grades });
  assertEq([r.status, r.ready, r.electivesAchieved], ['ready', true, 0], 'every core unit achieved is ready (electives are counted, not required)');
  // The certificate checklist's own call shape.
  const viaCore = Core.transcriptReadiness({ id: 'S' }, { qual: qual, manualGrades: grades, exams: [], examResults: [] });
  assert(viaCore && viaCore.ready === true && viaCore.known === true && /ready to certify/.test(viaCore.detail), 'CESTISCore.transcriptReadiness answers the checklist with ready / known / detail');
  assertEq(Core.transcriptReadiness({ id: 'S', course: 'Nothing like it' }, { catalogs: [qual] }), null, 'no catalogue: null, so the checklist falls back to exam results');
}

/* ---------- 8. One pass over the results ---------- */
console.log('Grade resolution indexes the results once per render');
{
  const qual = T.seedCatalogs().filter(q => q.id === 'QUAL-EIM-L3')[0];
  const exams = qual.units.map((u, i) => ({ id: 'E' + i, title: u.code + ' ' + u.name }));
  const results = [];
  for (let i = 0; i < 4000; i++) results.push({ id: 'R' + i, examId: 'E' + (i % exams.length), studentId: 'S' + (i % 30), score: 50 + (i % 50), submittedAt: '2026-01-01T00:00:00Z' });
  const t0 = Date.now();
  const index = T.gradeIndex(exams, results);
  let graded = 0;
  for (let s = 0; s < 30; s++) graded += T.gradeStats(T.effectiveGrades({ qual, studentId: 'S' + s, manualGrades: [], index })).graded;
  const ms = Date.now() - t0;
  assert(ms < 1500, '30 trainees × ' + qual.units.length + ' units × 4,000 results resolve quickly (' + ms + ' ms)');
  assert(graded > 0, 'and the results are found');
  const plain = T.effectiveGrades({ qual, studentId: 'S3', manualGrades: [], exams, examResults: results });
  const viaIndex = T.effectiveGrades({ qual, studentId: 'S3', manualGrades: [], index });
  assertEq(viaIndex, plain, 'with or without a shared index, the rows are identical');
}

/* ---------- 9. Request queues merge request by request ---------- */
console.log('A trainee\'s new request and the administration\'s status change both survive');
{
  const admin = [Object.assign(T.newRequest({ studentId: 'A', type: 'transcript', requestedAt: '2026-01-01T00:00:00Z' }), {})];
  const changed = T.setRequestStatus(admin, admin[0].id, 'ready', 'Office', null, '2026-01-05T00:00:00Z').list;
  assertEq([changed[0].status, changed[0].updatedAt], ['ready', '2026-01-05T00:00:00Z'], 'a status change is stamped');
  const trainee = [admin[0], T.newRequest({ studentId: 'B', type: 'certificate', requestedAt: '2026-01-03T00:00:00Z' })];
  const merged = T.mergeRequestLists(trainee, changed);
  assertEq(merged.length, 2, 'both requests are kept');
  assertEq(merged.filter(r => r.studentId === 'A')[0].status, 'ready', 'the newer status wins over the trainee\'s stale pending copy');
  // The same through the page-cloud merge, on a first sync and with a newer local stamp.
  const local = { voctrain_certTranscriptRequests: JSON.stringify(trainee) };
  const cloud = { voctrain_certTranscriptRequests: JSON.stringify(changed) };
  [[{}, { voctrain_certTranscriptRequests: '2026-01-02T00:00:00Z' }, { firstSync: true }],
   [{ voctrain_certTranscriptRequests: '2026-02-01T00:00:00Z' }, { voctrain_certTranscriptRequests: '2026-01-02T00:00:00Z' }, {}],
   [{ voctrain_certTranscriptRequests: '2026-01-01T00:00:00Z' }, { voctrain_certTranscriptRequests: '2026-03-02T00:00:00Z' }, {}]]
    .forEach(function (c, i) {
      const res = Core.pageCloud.mergeKeys(local, c[0], cloud, c[1], c[2]);
      const list = JSON.parse(res.data.voctrain_certTranscriptRequests);
      assert(list.length === 2 && list.filter(r => r.studentId === 'A')[0].status === 'ready', 'page-cloud merge case ' + (i + 1) + ': neither side\'s request or decision is lost');
    });
}

/* ---------- 10. One person, several enrolments ---------- */
console.log('A trainee\'s other enrolments are linked — strictly for the trainee themselves');
{
  const l2 = { id: 'L2', name: 'Ann Brown', course: 'Welding L2', trn: '111-222-333' };
  const l3 = { id: 'L3', name: 'Ann Brown', course: 'Welding L3', trn: '111222333' };
  const other = { id: 'OT', name: 'Ann Brown', course: 'Plumbing' };
  const someoneElse = { id: 'SE', name: 'Ann Brown', course: 'Cosmetology', trn: '999' };
  const students = [l2, l3, other, someoneElse];
  assertEq(T.otherEnrolments(l2, students, {}, true).map(o => o.student.id), ['L3'], 'the trainee sees only the enrolment proven to be them');
  assertEq(T.otherEnrolments(l2, students, {}, false).map(o => [o.student.id, o.sameNameOnly]), [['L3', false], ['OT', true]], 'staff also see a same-name record, flagged');
}

/* ---------- 11. Re-enrolment after a deletion ---------- */
console.log('Deleting a trainee no longer blocks a new enrolment of the same name');
{
  const gone = { name: 'Jane Doe', course: '01. Plumbing' };
  const sid = Core.stableStudentId(gone);
  const deleted = { [sid]: true };
  const ne = Core.newEnrolmentId({ name: 'Jane Doe', course: '02. Plumbing' }, deleted, '2027-01-10T09:00:00Z');
  assert(ne.id && ne.id !== sid && ne.reEnrolledAt === '2027-01-10T09:00:00Z', 'the new enrolment gets an id of its own and the marker');
  assertEq(Core.newEnrolmentId({ name: 'Jim Doe', course: 'Plumbing' }, deleted).reEnrolledAt, '', 'an ordinary enrolment keeps the stable id');
  const fresh = { id: ne.id, name: 'Jane Doe', course: '02. Plumbing', reEnrolledAt: ne.reEnrolledAt };
  const stale = { id: sid, name: 'Jane Doe', course: '01. Plumbing' };
  const randomCopy = { id: 'STU-RANDOM123', name: 'Jane Doe', course: 'Plumbing' };
  const r = Core.dropTombstonedStudents([fresh, stale, randomCopy], deleted);
  assertEq(r.students.map(s => s.id), [ne.id], 'the re-enrolment stays; copies of the deleted record are still dropped');
  const bundle = { students: [fresh], userAccounts: [], attendanceRecords: [], certDownloadApprovals: [], examResults: [] };
  Core.migrateToStableIds(bundle);
  assertEq(bundle.students[0].id, ne.id, 'the stable-id migration does not move it onto the deleted id');
  const dd = Core.dedupeStudents([stale, fresh]);
  assertEq(dd.students.length, 2, 'nor is it folded into a stale copy of the deleted record');
  const m = Core.mergeStudentRecords({ id: ne.id, name: 'Jane Doe', lastModified: '2027-02-01' }, fresh);
  assertEq(m.reEnrolledAt, ne.reEnrolledAt, 'the marker survives a merge');
  assertEq(Core.dropTombstonedStudents([fresh], { [ne.id]: true }).removed, 1, 'and deleting the new enrolment deletes it');
}

/* ---------- 12. A new centre never reuses a deleted one ---------- */
console.log('A new training centre never takes a deleted centre\'s id or intake key');
{
  const store = memStore({ voctrain_deletedCentreIds: JSON.stringify(['3']) });
  const areas = [{ id: 1, name: 'Welding', centreKey: '01' }, { id: 2, name: 'Plumbing', centreKey: '02' }];
  const next = Core.catalogue.nextCentreId(areas, store);
  assertEq(next, 4, 'the deleted centre\'s id 3 is not reused');
  assertEq(Core.catalogue.nextCentreId(areas, store, ['7']), 8, 'nor the id of a deleted centre\'s chat room');
  const withNew = areas.concat([{ id: next, name: 'Auto Mechanics' }]);
  Core.enrolment.assignCentreKeys(withNew, ['03']);
  assertEq(withNew[2].centreKey, '04', 'a key still stamped on the deleted intake\'s trainees is not handed out');
  const roll = [{ id: 'S', name: 'X', course: 'Cosmetology', centreKey: '03' }];
  assertEq(Core.transfer.traineesOf(roll, withNew[2], { centres: withNew }).length, 0, 'so the new centre starts with nobody on its roll');
  const legacy = [{ id: 5, name: 'Old' }];
  Core.enrolment.assignCentreKeys(legacy);
  assertEq(legacy[0].centreKey, '05', 'without reserved keys the allocation is unchanged');
}

/* ---------- 13. The time clock takes a clock-out ---------- */
console.log('An administrator\'s aggregate picks up a clock-out made on the staff member\'s device');
{
  const open = { id: 'T1', staffId: 'M', clockIn: '2026-10-01T13:00:00Z', clockOut: null, lastModified: '2026-10-01T13:00:00Z' };
  const closed = Object.assign({}, open, { clockOut: '2026-10-01T21:00:00Z', lastModified: '2026-10-01T21:00:00Z' });
  const res = Core.mergeTimeClock({ timeRecords: [open], staffMembers: [{ id: 'A' }, { id: 'M' }] }, { timeRecords: [closed], staffMembers: [{ id: 'M' }] });
  assertEq(res.timeRecords[0].clockOut, '2026-10-01T21:00:00Z', 'the session held open locally takes the clock-out');
  assertEq(res.staffMembers.length, 2, 'and a one-person file never shrinks the staff list');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
