/* Nothing a device holds is lost to a sync, a sign-out or a wrong clock.

   What failed before (the sync & durability audit):
     - a staff sign-out wiped the device whether or not the final save had
       reached Drive — offline, with an expired sign-in or a failed upload,
       the day's results, marks and grades were simply gone;
     - a trainee deleted and later re-enrolled on the same programme gets the
       same id, and the old tombstone hid the new enrolment everywhere;
     - marking, review and transcript overrides never left the device (results
       were replaced only by a later SUBMISSION); two instructors grading
       different trainees on one assignment erased each other's grade; a
       removed transcript override came back;
     - a failed or garbled download was treated as "nothing new" and the
       device then uploaded over the other device's write; the page-cloud did
       the same with an empty "cloud"; the Centre's server answered every read
       error as "no file";
     - deletions did not stick: the last record of a collection could not be
       deleted at all, the master snapshot restored deleted accounts, payments
       and results, the assignments side file and the chat file brought
       deleted things back, one person's "Clear all" deleted notices for
       everybody, a revoked register window and a withdrawn ruling returned;
     - a device whose clock was wrong reverted other people's edits;
     - a collection too big for localStorage looked ABSENT to every other
       page, and an IndexedDB that would not open hung the page silently.

   These tests run the real rules in cestis-core.js (both builds), the real
   page-cloud and offline store, and functions extracted from the real
   index.html — two- and three-device scenarios, deletion against concurrent
   edits, clock skew, failed pulls, and records written before any of this
   (no stamps), which must never be lost.

   Run: node tests/sync-durability.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const clone = o => JSON.parse(JSON.stringify(o));
const ROOT = path.join(__dirname, '..');
const BUILDS = [
  { where: 'main build', core: require('../cestis-core.js'), dir: ROOT },
  { where: 'Offline System', core: require('../Offline System/cestis-core.js'), dir: path.join(ROOT, 'Offline System') }
];
const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();
const T = n => iso(NOW - 10 * 86400000 + n * 60000);   // T(1) < T(2) < ... all in the past

function extractFunction(src, name) {
  const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function mapStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); }, keys: () => Array.from(m.keys()), _m: m
  };
}

BUILDS.forEach(function (B) {
  const C = B.core, S = C.sync, tag = ' (' + B.where + ')';

  /* ------------------------------------------------------------- clocks */
  console.log('An edit is never dated before the record it changes, and a far-future clock cannot win' + tag);
  {
    assertEq(S.laterStamp(T(1), T(5)), iso(Date.parse(T(5)) + 1), 'a slow clock stamps one millisecond after the stamp it edits');
    assertEq(S.laterStamp(T(9), T(5)), T(9), 'a correct clock stamps now');
    const far = iso(NOW + 400 * 86400000);
    assertEq(S.laterStamp(T(2), far), T(2), 'a stamp a year ahead is not chased: the edit is dated now');
    // stampChanges: a slow device edits a record a fast(er) device stamped.
    const recs = [{ id: 'A', text: 'old', updatedAt: T(5) }];
    const idx = S.stampChanges(recs, r => r.id, null, '');
    recs[0].text = 'corrected';
    S.stampChanges(recs, r => r.id, idx, T(1));
    assert(Date.parse(recs[0].updatedAt) > Date.parse(T(5)), 'the slow device\'s correction is stamped after the version it corrected');
    // ...so it wins on the other device.
    const other = [{ id: 'A', text: 'old', updatedAt: T(5) }];
    S.mergeList(other, recs, r => r.id, {});
    assertEq(other[0].text, 'corrected', 'and the correction reaches the other device instead of being reverted');

    // A copy dated a year ahead is merged as undated: fills, adds, never overwrites.
    const local = [{ id: 'B', text: 'mine', updatedAt: T(3) }];
    S.mergeList(local, [{ id: 'B', text: 'from the fast clock', extra: 'x', updatedAt: far }, { id: 'C', text: 'new', updatedAt: far }], r => r.id, {});
    assertEq(local[0].text, 'mine', 'a far-future copy does not overwrite a dated edit');
    assertEq(local[0].extra, 'x', 'but its extra fields fill blanks (nothing typed is lost)');
    assert(local.some(r => r.id === 'C'), 'and a record only it has is still added');
    const tombsFuture = { B: far };
    assert(!S.deletedAfter(tombsFuture, 'B', local[0]), 'a deletion dated a year ahead deletes nothing');
    assert(S.deletedAfter({ B: T(4) }, 'B', { id: 'B', updatedAt: far }), 'and a far-future edit cannot outlive a real deletion');
    assertEq(S.clockSkew(iso(NOW), NOW, NOW), 0, 'no skew against an accurate server');
    const sk = S.clockSkew(iso(NOW - 3600000), NOW, NOW);
    assert(S.clockLooksWrong(sk) && sk > 0, 'an hour ahead is reported as a wrong clock');
    assert(!S.clockLooksWrong(S.clockSkew(iso(NOW - 60000), NOW, NOW)), 'a minute is not');
  }

  /* -------------------------------------------------------- exam results */
  console.log('Marking, review and overrides travel; re-sits replace; nothing unstamped is lost' + tag);
  {
    const submitted = { id: 'R1', examId: 'E1', studentId: 'S1', score: 50, needsReview: true, reviewComplete: false, submittedAt: T(1), updatedAt: T(1) };
    const A = [clone(submitted)], Bd = [clone(submitted)], Cd = [clone(submitted)];
    // Device A (instructor) marks it.
    Object.assign(A[0], { score: 90, passed: true, reviewComplete: true, gradedAt: T(5), updatedAt: T(5) });
    S.mergeExamResults(Bd, A, {});
    assertEq(Bd[0].score, 90, 'device B takes the marked copy although the submission time is the same');
    // B's next upload cannot put the unmarked copy back on A, nor on a third device.
    S.mergeExamResults(A, Cd, {});
    assertEq(A[0].score, 90, 'an unmarked copy never replaces the marked one on the marking device');
    S.mergeExamResults(Cd, Bd, {});
    S.mergeExamResults(Cd, [clone(submitted)], {});
    assertEq(Cd[0].score, 90, 'a third device keeps the mark against any stale copy');
    // A later override (transcript) beats the mark.
    const ov = clone(A[0]); Object.assign(ov, { score: 75, manualOverride: true, overriddenAt: T(7), updatedAt: T(7) });
    S.mergeExamResults(Bd, [ov], {});
    assertEq(Bd[0].score, 75, 'a later override wins');
    S.mergeExamResults(Bd, A, {});
    assertEq(Bd[0].score, 75, 'and the earlier mark does not undo it');
    // Legacy: neither copy stamped; the reviewed one still wins.
    const L1 = [{ examId: 'E2', studentId: 'S2', score: 40, needsReview: true, submittedAt: T(1) }];
    S.mergeExamResults(L1, [{ examId: 'E2', studentId: 'S2', score: 80, needsReview: true, reviewComplete: true, submittedAt: T(1) }], {});
    assertEq(L1[0].score, 80, 'a legacy reviewed copy (no stamps, no id) beats the unreviewed one');
    // A copy with a later submission but OLDER edit does not override a graded copy of the same attempt.
    const L2 = [{ id: 'R3', examId: 'E3', studentId: 'S3', score: 95, reviewComplete: true, needsReview: true, submittedAt: T(1), updatedAt: T(6) }];
    S.mergeExamResults(L2, [{ id: 'R3', examId: 'E3', studentId: 'S3', score: 100, passed: true, submittedAt: T(4), updatedAt: T(2), needsReview: true, reviewComplete: true }], {});
    assertEq(L2[0].score, 95, 'a later submittedAt with an older edit (a forged copy) does not win');
    // A re-sit (new id) replaces the earlier attempt, as before.
    const L3 = [{ id: 'R4', examId: 'E4', studentId: 'S4', score: 30, submittedAt: T(1) }];
    S.mergeExamResults(L3, [{ id: 'R5', examId: 'E4', studentId: 'S4', score: 70, submittedAt: T(3) }], {});
    assertEq(L3.length, 1, 'a re-sit is still one result per exam and trainee');
    assertEq(L3[0].score, 70, 'the later attempt replaces the earlier');
    // A deleted result stays deleted unless edited after.
    const L4 = [{ id: 'R6', examId: 'E6', studentId: 'S6', score: 10, updatedAt: T(1) }];
    const tombs = { R6: T(2) };
    S.mergeExamResults(L4, [{ id: 'R6', examId: 'E6', studentId: 'S6', score: 10, updatedAt: T(1) }], { tombs });
    assertEq(L4.length, 0, 'a result deleted after its last edit is dropped and not re-added');
    const L5 = [];
    S.mergeExamResults(L5, [{ id: 'R7', examId: 'E7', studentId: 'S7', score: 5 }, null, 'junk', { id: 'R8', examId: 'E8', studentId: 'S8' }], {});
    assertEq(L5.length, 2, 'records only the cloud has are always added; junk is skipped, not thrown on');
    assertEq(S.examResultKey({ examId: 'E', studentId: 'S' }), 'E|S', 'a legacy result is keyed by exam and trainee');
  }

  /* ------------------------------------------------- assignment grades */
  console.log('Two instructors grading different trainees both keep their grade' + tag);
  {
    const base = { id: 'ASN-1', title: 'Weld', grades: {}, updatedAt: T(1) };
    const X = [clone(base)], Y = [clone(base)], Z = [clone(base)];
    C.coursework.recordGrade(X[0], 'stuX', 78, 'Ann', T(2)); X[0].updatedAt = T(2);
    C.coursework.recordGrade(Y[0], 'stuY', 91, 'Ben', T(3)); Y[0].updatedAt = T(3);
    const opts = { perEntry: { grades: 'gradeMeta.gradedAt' }, unionStamps: ['gradeLog'] };
    S.mergeList(X, Y, r => r.id, opts);
    S.mergeList(Y, X, r => r.id, opts);
    S.mergeList(Z, Y, r => r.id, opts);
    [X, Y, Z].forEach((d, i) => {
      assertEq(d[0].grades.stuX, 78, 'device ' + 'XYZ'[i] + ' keeps trainee X\'s 78');
      assertEq(d[0].grades.stuY, 91, 'device ' + 'XYZ'[i] + ' keeps trainee Y\'s 91');
    });
    // A correction made later wins even if the record as a whole is older.
    assertEq(X[0].gradeLog.length, 2, 'the grade history keeps both instructors\' entries');
    const P = [clone(X[0])], Q = [clone(X[0])];
    C.coursework.recordGrade(P[0], 'stuX', 70, 'Ann', T(9)); P[0].updatedAt = T(9);
    C.coursework.recordGrade(Q[0], 'stuZ', 55, 'Ben', T(10)); Q[0].updatedAt = T(10);
    S.mergeList(Q, P, r => r.id, opts);
    assertEq(Q[0].grades.stuX, 70, 'the correction 78→70 survives the other device\'s newer record');
    assertEq(Q[0].grades.stuZ, 55, 'and that device\'s own new grade stays');
    assertEq(Q[0].gradeMeta.stuX.gradedBy, 'Ann', 'with who gave it');
    // Legacy: no gradedAt anywhere: union, the record winner decides a clash.
    const U = [{ id: 'A2', grades: { a: 1 } }];
    S.mergeList(U, [{ id: 'A2', grades: { b: 2 } }], r => r.id, opts);
    assert(U[0].grades.a === 1 && U[0].grades.b === 2, 'legacy grades from both sides are kept');
  }

  /* ------------------------------------------------------- notifications */
  console.log('Read and cleared are each person\'s own; trimming is never a deletion' + tag);
  {
    const n = { id: 'N1', text: 'New exam', forRoles: ['admin', 'student'], read: false };
    const a = [clone(n)], b = [clone(n)], c3 = [clone(n)];
    C.comms.markRead(a[0], 'U-ANN'); a[0].updatedAt = T(2);
    C.comms.markCleared(b[0], 'U-BEN'); b[0].updatedAt = T(3);
    C.comms.markRead(c3[0], 'U-CAT'); c3[0].updatedAt = T(4);
    const opts = { unionStamps: ['readBy', 'clearedBy'] };
    S.mergeList(a, b, r => r.id, opts);
    S.mergeList(a, c3, r => r.id, opts);
    assert(C.comms.isRead(a[0], 'U-ANN') && C.comms.isRead(a[0], 'U-CAT') && !C.comms.isRead(a[0], 'U-ADMIN'),
      'every reader on three devices is kept (each read used to lose to a newer copy), and only theirs');
    assert(C.comms.isCleared(a[0], 'U-BEN') && !C.comms.isCleared(a[0], 'U-ANN'), 'Ben\'s clear hides it for Ben only');
    S.mergeList(b, a, r => r.id, opts);
    assert(C.comms.isRead(b[0], 'U-ANN') && C.comms.isCleared(b[0], 'U-BEN'), 'and the other way round');
    const many = [];
    for (let i = 0; i < 81; i++) many.push({ id: 'CALL-' + i, forUsers: ['M' + i], timestamp: NOW - i });
    many.push({ id: 'EXAM', forRoles: ['student'], timestamp: NOW - 1000 });
    const kept = C.notify.prune(many, 50, 400);
    assertEq(kept.length, 82, 'a call to 81 members keeps every member\'s notice and the Centre\'s other notices');
    const flood = [];
    for (let i = 0; i < 70; i++) flood.push({ id: 'F' + i, forRoles: ['admin'], timestamp: NOW - i });
    assertEq(C.notify.prune(flood, 50, 400).length, 50, 'one audience still keeps only its newest 50');
  }

  /* ---------------------------------------------------- deleting the last */
  console.log('Deleting the last record sticks; a half-loaded page still cannot empty a list' + tag);
  {
    const list = [{ id: 'ANN-1', updatedAt: T(1) }];
    const tombs = { 'ANN-1': T(2) };
    assertEq(S.applyTombstones(list, r => r.id, tombs), 1, 'on load the tombstone removes the record the empty write could not');
    assertEq(list.length, 0, 'and the list is empty');
    assert(S.emptyIsDeliberate([{ id: 'ANN-1', updatedAt: T(1) }], r => r.id, tombs), 'an empty write is allowed when every stored record was deleted');
    assert(!S.emptyIsDeliberate([{ id: 'ANN-1', updatedAt: T(1) }, { id: 'ANN-2' }], r => r.id, tombs), 'but not when any stored record was not');
    assert(!S.emptyIsDeliberate([{ id: 'ANN-1', updatedAt: T(3) }], r => r.id, tombs), 'nor when it was edited after the deletion');
    const map = { P1: { name: 'x', updatedAt: T(1) } };
    S.applyTombstones(map, null, { P1: T(2) });
    assert(!map.P1, 'maps too');
    // Concurrent edit after the deletion wins (no data loss).
    const L = [{ id: 'X', text: 'edited later', updatedAt: T(5) }];
    S.mergeList(L, [], r => r.id, { tombs: { X: T(4) } });
    assertEq(L.length, 1, 'an edit made after the deletion keeps the record');
  }

  /* -------------------------------------------- re-enrolment after delete */
  console.log('A trainee deleted and enrolled again is a new enrolment, not hidden' + tag);
  {
    const s = { id: 'STU-STABLE', name: 'Ann Brown', course: 'Welding', lastModified: T(1) };
    const sid = C.stableStudentId(s);
    const store = mapStore({ voctrain_deletedStudentIds: JSON.stringify([sid]) });   // a legacy tombstone: no time
    assert(C.isStudentTombstoned(Object.assign({}, s, { id: sid }), C.readDeletedIds(store), C.readDeletedStudentTimes(store)), 'the old record is hidden');
    const fresh = { id: sid, name: 'Ann Brown', course: 'Welding', lastModified: iso(NOW) };
    C.markEnrolment(fresh, store, iso(NOW));
    const del = C.readDeletedIds(store), times = C.readDeletedStudentTimes(store);
    assert(!!times[sid], 'enrolling again writes down when the old deletion happened (just before)');
    assert(!C.isStudentTombstoned(fresh, del, times), 'the new enrolment is not hidden');
    assert(C.isStudentTombstoned({ id: sid, name: 'Ann Brown', course: 'Welding', lastModified: iso(NOW + 5000) }, del, times),
      'an old copy edited on a stale device (no new enrolment) stays hidden');
    const dr = C.dropTombstonedStudents([{ id: sid, name: 'Ann Brown', course: 'Welding', lastModified: T(1) }, fresh], del, times);
    assertEq(dr.students.length, 1, 'the old copy goes, the new enrolment stays');
    assertEq(dr.droppedIds.length, 0, 'and its id is not reported dropped, so its login and results stay');
    // The time map unions by the later time; the id list as before.
    const u = JSON.parse(C.unionTombstoneValues(JSON.stringify({ a: T(1), b: T(5) }), JSON.stringify({ a: T(3), c: T(2) })));
    assert(u.a === T(3) && u.b === T(5) && u.c === T(2), 'deletion times union, the later of each');
    assertEq(C.unionTombstoneValues(JSON.stringify({ a: T(3) }), JSON.stringify({ a: T(1) })), null, 'an older time adds nothing');
    assertEq(C.unionTombstoneValues('["a"]', '["b"]'), '["a","b"]', 'the id lists union exactly as before');
    assert(C.isTombstoneKey('voctrain_deletedStudentAt'), 'and the time map is merged as a tombstone everywhere');
    // Page-cloud (LAN) merge: the re-enrolled trainee and her new result come through.
    const other = { id: 'STU-OTHER', name: 'Ben Ray', course: 'Plumbing', lastModified: T(1) };
    const local = { voctrain_students: JSON.stringify([other]), voctrain_deletedStudentIds: JSON.stringify([sid]),
      voctrain_examResults: JSON.stringify([{ id: 'R-BEN', examId: 'E', studentId: 'STU-OTHER', submittedAt: T(1) }]) };
    const cloud = { voctrain_students: JSON.stringify([fresh]), voctrain_deletedStudentIds: JSON.stringify([sid]),
      voctrain_deletedStudentAt: JSON.stringify(times),
      voctrain_examResults: JSON.stringify([{ id: 'R-NEW', examId: 'E', studentId: sid, submittedAt: iso(NOW) },
                                            { id: 'R-OLD', examId: 'E0', studentId: sid, submittedAt: T(1) }]) };
    const res = C.pageCloud.mergeKeys(local, { voctrain_students: T(1), voctrain_examResults: T(1) }, cloud,
      { voctrain_students: T(2), voctrain_examResults: T(2) }, { records: true });
    const studs = JSON.parse(res.data.voctrain_students), results = JSON.parse(res.data.voctrain_examResults);
    assertEq(studs.length, 2, 'the re-enrolled trainee arrives on the Centre\'s server path too');
    assert(results.some(r => r.id === 'R-NEW') && !results.some(r => r.id === 'R-OLD'), 'with her new result, not the deleted enrolment\'s');
  }

  /* ------------------------------------------------------ master snapshot */
  console.log('The master snapshot honours every deletion and never restores per-device keys' + tag);
  {
    const snap = { store: {
      voctrain_users: JSON.stringify([{ id: 'U1' }, { id: 'U-GONE' }]),
      cestiSchoolFeePayments: JSON.stringify([{ id: 'P1' }, { id: 'P-GONE' }]),
      voctrain_examResults: JSON.stringify([{ id: 'R1', examId: 'E', studentId: 'S', updatedAt: T(1) }]),
      voctrain_announcements: JSON.stringify([{ id: 'ANN-1', updatedAt: T(1) }]),
      voctrain_transcriptGrades: JSON.stringify([{ id: 'TG-1', grade: 40, updatedAt: T(1) }]),
      cestisCurrentUser: JSON.stringify({ name: 'Whoever wrote it' }),
      cestis_pagecloud_stamps__X: '{}',
      voctrain_theme: '"blue"'
    } };
    const local = {
      voctrain_users: JSON.stringify([{ id: 'U1' }]),
      voctrain_deletedUserIds: JSON.stringify(['U-GONE']),
      cestiSchoolFeePayments: JSON.stringify([{ id: 'P1' }]),
      cestiSchoolFeeDeletedPaymentIds: JSON.stringify(['P-GONE']),
      voctrain_examResults: JSON.stringify([{ id: 'R0', examId: 'E0', studentId: 'S' }]),
      voctrain_syncTombstones: JSON.stringify({ examResults: { R1: T(2) }, announcements: { 'ANN-1': T(2) } }),
      voctrain_announcements: '[]',
      voctrain_transcriptGrades: JSON.stringify([{ id: 'TG-1', grade: null, removed: true, updatedAt: T(3) }])
    };
    const r = C.reconcileSnapshot(snap, local);
    const st = r.store;
    assert(!JSON.parse(st.voctrain_users).some(u => u.id === 'U-GONE'), 'a deleted account is not restored');
    assert(!JSON.parse(st.cestiSchoolFeePayments).some(p => p.id === 'P-GONE'), 'a deleted payment is not restored');
    assert(!JSON.parse(st.voctrain_examResults).some(x => x.id === 'R1'), 'a deleted result is not restored');
    assertEq(st.voctrain_announcements, '[]', 'the last announcement, deleted on purpose, is not restored into the empty list');
    assertEq(JSON.parse(st.voctrain_transcriptGrades)[0].removed, true, 'a removed override stays removed');
    assertEq(st.cestisCurrentUser, undefined, 'who was signed in on the writing machine is never restored');
    assertEq(st.cestis_pagecloud_stamps__X, undefined, 'nor its sync bookkeeping');
    assertEq(st.voctrain_theme, '"blue"', 'ordinary settings still are');
    assert(!C.isSnapshotableKey('cestisPendingUpload') && !C.isSnapshotableKey('loggedInUser'), 'per-device keys never enter a snapshot');
  }

  /* -------------------------------------------------------- certificates */
  console.log('A withdrawn certificate is not filled back in from an older copy' + tag);
  {
    const certified = { id: 'S1', name: 'Ann', course: 'Weld', stage: 'certified', certNo: 'PL-2026-0042', certDate: 'September 01, 2026', certCollected: true, lastModified: T(1) };
    const withdrawn = Object.assign({}, certified, { stage: 'training', certNo: null, certDate: null, certCollected: false,
      certRevokedAt: T(3), lastModified: T(3) });
    [C.mergeStudentRecords(certified, withdrawn), C.mergeStudentRecords(withdrawn, certified)].forEach((m, i) => {
      assertEq(m.certNo, null, 'merge order ' + i + ': the number is not refilled');
      assertEq(m.certDate, null, 'merge order ' + i + ': nor the date');
      assert(Array.isArray(m.certNoAliases) && m.certNoAliases.indexOf('PL-2026-0042') !== -1, 'merge order ' + i + ': the number survives as an alias (the paper still resolves, as withdrawn)');
    });
    const recert = Object.assign({}, withdrawn, { stage: 'certified', certNo: 'PL-2026-0042', certDate: 'October 01, 2026', certReinstatedAt: T(5), lastModified: T(5) });
    assertEq(C.mergeStudentRecords(withdrawn, recert).certNo, 'PL-2026-0042', 'a later re-certification keeps its number');
  }

  /* ------------------------------------------------ register reopen window */
  console.log('Revoking a register reopen window sticks across syncs' + tag);
  {
    const grant = { instructor: 'Tom', grantedAtMs: NOW - 3600000, expiresAtMs: NOW + 86400000 };
    const admin = [{ id: 'C1', name: 'Weld', instructorPermissions: [], permissionsRevokedAtMs: NOW - 60000 }];
    C.cloudMerge.applySkillAreas(admin, [{ id: 'C1', name: 'Weld', instructorPermissions: [grant] }]);
    assertEq(admin[0].instructorPermissions.length, 0, 'the cloud copy\'s older grant does not come back');
    const instr = [{ id: 'C1', name: 'Weld', instructorPermissions: [grant] }];
    C.cloudMerge.applySkillAreas(instr, admin);
    assertEq(instr[0].instructorPermissions.length, 0, 'and the instructor\'s device drops it too');
    assertEq(instr[0].permissionsRevokedAtMs, admin[0].permissionsRevokedAtMs, 'the revocation travels');
    const later = { instructor: 'Tom', grantedAtMs: NOW, expiresAtMs: NOW + 86400000 };
    C.cloudMerge.applySkillAreas(instr, [{ id: 'C1', name: 'Weld', instructorPermissions: [later] }]);
    assertEq(instr[0].instructorPermissions.length, 1, 'a window granted after the revocation is kept');
    const legacy = [{ id: 'C2', name: 'Plumb' }];
    C.cloudMerge.applySkillAreas(legacy, [{ id: 'C2', name: 'Plumb', instructorPermissions: [{ instructor: 'X', expiresAtMs: NOW + 3600000 }] }]);
    assertEq(legacy[0].instructorPermissions.length, 1, 'with no revocation, grants merge as before');
  }

  /* ------------------------------------------------- page files on Drive */
  console.log('Transcript grades, requests, rulings and the virement register merge record by record' + tag);
  {
    const PC = C.pageCloud, R = PC.DRIVE_RECORD_KEYS;
    assert(R.indexOf('voctrain_transcriptGrades') !== -1 && R.indexOf('cesti_virements') !== -1 && R.indexOf('cestis_cmc_rulings') !== -1,
      'the Drive merges name the collections that were whole-list only');
    const g0 = { id: 'TG-0', grade: 50, updatedAt: T(1) };
    const pcA = JSON.stringify([g0, { id: 'TG-1', grade: 70, updatedAt: T(2) }]);
    const cloud = JSON.stringify([g0, { id: 'TG-2', grade: 80, updatedAt: T(3) }]);
    const m = PC.mergeKeys({ voctrain_transcriptGrades: pcA }, { voctrain_transcriptGrades: T(2) },
      { voctrain_transcriptGrades: cloud }, { voctrain_transcriptGrades: T(3) }, { records: R });
    const ids = JSON.parse(m.data.voctrain_transcriptGrades).map(g => g.id).sort();
    assertEq(ids.join(','), 'TG-0,TG-1,TG-2', 'two offices\' grades both survive (one used to erase the other)');
    const whole = PC.mergeKeys({ voctrain_transcriptGrades: pcA }, { voctrain_transcriptGrades: T(2) },
      { voctrain_transcriptGrades: cloud }, { voctrain_transcriptGrades: T(3) }, {});
    assertEq(JSON.parse(whole.data.voctrain_transcriptGrades).length, 2, 'without the option the old whole-value rule still applies (nothing else changes)');
    // A removed override beats the older live copy.
    const rm = PC.mergeKeys({ voctrain_transcriptGrades: JSON.stringify([{ id: 'TG-0', grade: null, removed: true, updatedAt: T(5) }]) },
      { voctrain_transcriptGrades: T(5) }, { voctrain_transcriptGrades: JSON.stringify([g0]) }, { voctrain_transcriptGrades: T(6) }, { records: R });
    assertEq(JSON.parse(rm.data.voctrain_transcriptGrades)[0].removed, true, 'a removed override is not brought back by an older copy');
    // Virements: decision beats pending; deleted stays deleted; a new request is never dropped.
    const reg = PC.mergeKeys(
      { cesti_virements: JSON.stringify([{ id: 1, status: 'Approved', approvedBy: 'Chair' }, { id: 3, status: 'Pending' }]), cesti_virement_deleted_ids: '[3]' },
      { cesti_virements: T(5) },
      { cesti_virements: JSON.stringify([{ id: 1, status: 'Pending' }, { id: 2, status: 'Pending' }, { id: 3, status: 'Pending' }]) },
      { cesti_virements: T(6) }, { records: R });
    const vr = JSON.parse(reg.data.cesti_virements);
    assertEq(vr.filter(v => v.id === 1)[0].status, 'Approved', 'the Board\'s decision beats a newer "Pending" copy');
    assert(vr.some(v => v.id === 2), 'a request filed meanwhile is not dropped by the countersign');
    assert(!vr.some(v => v.id === 3), 'a deleted request stays deleted');
    // CMC minute book: per ruling.
    const book = PC.mergeKeys(
      { cestis_cmc_rulings: JSON.stringify({ 1: { decision: 'Approved', at: T(1), counterByUsername: 'b', counterAt: T(4) }, 2: { withdrawnAt: T(5) } }) },
      { cestis_cmc_rulings: T(5) },
      { cestis_cmc_rulings: JSON.stringify({ 1: { decision: 'Approved', at: T(1) }, 2: { decision: 'Rejected', at: T(2) }, 3: { decision: 'Approved', at: T(6) } }) },
      { cestis_cmc_rulings: T(6) }, { records: R });
    const bk = JSON.parse(book.data.cestis_cmc_rulings);
    assertEq(bk[1].counterByUsername, 'b', 'a countersignature is not lost to a newer whole book');
    assertEq(bk[2].decision, undefined, 'a withdrawn ruling stays withdrawn');
    assertEq(bk[3].decision, 'Approved', 'a ruling made on the other device arrives');
    // Exam results on the server path follow the result rule.
    const er = PC.mergeKeys({ voctrain_examResults: JSON.stringify([{ id: 'R1', examId: 'E', studentId: 'S', score: 90, reviewComplete: true, needsReview: true, updatedAt: T(2), submittedAt: T(1) }]) },
      { voctrain_examResults: T(2) },
      { voctrain_examResults: JSON.stringify([{ id: 'R1', examId: 'E', studentId: 'S', score: 50, needsReview: true, submittedAt: T(1) }]) },
      { voctrain_examResults: T(9) }, { records: true });
    assertEq(JSON.parse(er.data.voctrain_examResults)[0].score, 90, 'the marked result wins however new the unmarked file is');
    assertEq(C.calendarEventKey({ id: 'EVT-1', title: 'Staff Meeting', date: '2026-10-10' }), 'EVT-1', 'calendar events are known by id');
    assertEq(C.calendarEventKey({ title: 'Staff Meeting ', date: '2026-10-10' }), 'staff meeting|2026-10-10', 'old ones by title and date');
    const exSpec = PC.recordSpec('voctrain_exams');
    assert(exSpec.id({ id: 'EXAM-1', title: 'T', course: 'C' }) !== exSpec.id({ id: 'EXAM-2', title: 'T', course: 'C' }), 'two exams with one title are two records on the server path');
  }

  /* ------------------------------------------------- transcript overrides */
  console.log('Removing a manual grade is written down; a relinked grade has no ghost' + tag);
  {
    const Tr = C.Transcript;
    let grades = Tr.upsertManualGrade([], { studentId: 'S1', qualId: 'Q', unitCode: 'U1', grade: 40, updatedBy: 'x', updatedAt: T(1) });
    grades = Tr.removeManualGrade(grades, 'S1', 'Q', 'U1', 'admin', T(2));
    assertEq(grades.length, 1, 'the record stays');
    assert(grades[0].removed === true && grades[0].grade === null && grades[0].updatedAt === T(2), 'marked removed, with when');
    const rows = Tr.effectiveGrades({ qual: { id: 'Q', units: [{ code: 'U1', name: 'Unit' }] }, studentId: 'S1', manualGrades: grades, exams: [], examResults: [] });
    assertEq(rows[0].source, 'none', 'the transcript falls back from a removed override');
    const old = Tr.upsertManualGrade([], { studentId: 'OLD', qualId: 'Q', unitCode: 'U1', grade: 55, updatedAt: T(1) });
    const neu = Tr.upsertManualGrade([], { studentId: 'NEW', qualId: 'Q', unitCode: 'U1', grade: 75, updatedAt: T(3) });
    const data = { transcriptGrades: old.concat(neu) };
    C.relinkDependentData({ OLD: 'NEW' }, data);
    assertEq(data.transcriptGrades.length, 1, 'after relinking, one record per trainee and unit');
    assertEq(data.transcriptGrades[0].grade, 75, 'the newer grade is the one kept');
    assertEq(data.transcriptGrades[0].id, Tr.manualGradeId('NEW', 'Q', 'U1'), 'and its id follows the trainee');
  }

  /* --------------------------------------------------------------- chat */
  console.log('Chat: a deletion is final, edits and votes from every device survive' + tag);
  {
    const CS = C.chatSync;
    const msg = { id: 'M1', text: 'hello', timestamp: T(1), readBy: ['a'] };
    const del = Object.assign({}, msg, { deleted: true, text: '', originalText: 'hello', deletedAt: T(3), updatedAt: T(3) });
    const stale = Object.assign({}, msg, { readBy: ['a', 'b'] });
    [CS.mergeMessage(del, stale), CS.mergeMessage(stale, del)].forEach((m, i) => {
      assert(m.deleted === true && m.text === '', 'order ' + i + ': a stale copy does not undo a deletion');
      assert(m.readBy.indexOf('b') !== -1, 'order ' + i + ': every reader is kept');
    });
    const edited = Object.assign({}, msg, { text: 'hello all', edited: true, editedAt: T(2), updatedAt: T(2) });
    assertEq(CS.mergeMessage(msg, edited).text, 'hello all', 'an edit beats the unedited copy');
    assertEq(CS.mergeMessage(edited, msg).text, 'hello all', 'in either direction');
    // Three voters on three devices.
    const poll = { id: 'P', type: 'poll', timestamp: T(1), pollOptions: [{ text: 'yes', votes: [] }, { text: 'no', votes: [] }] };
    const d1 = clone(poll), d2 = clone(poll), d3 = clone(poll);
    d1.pollOptions[0].votes.push('v1'); CS.recordVote(d1, 'v1', [0], T(2));
    d2.pollOptions[1].votes.push('v2'); CS.recordVote(d2, 'v2', [1], T(3));
    d3.pollOptions[0].votes.push('v3'); CS.recordVote(d3, 'v3', [0], T(4));
    let m = CS.mergeMessage(CS.mergeMessage(d1, d2), d3);
    assertEq(m.pollOptions[0].votes.sort().join(','), 'v1,v3', 'both "yes" votes survive');
    assertEq(m.pollOptions[1].votes.join(','), 'v2', 'and the "no" vote');
    const change = clone(d1); change.pollOptions[0].votes = []; change.pollOptions[1].votes = ['v1']; CS.recordVote(change, 'v1', [1], T(6));
    m = CS.mergeMessage(m, change);
    assert(m.pollOptions[1].votes.indexOf('v1') !== -1 && m.pollOptions[0].votes.indexOf('v1') === -1, 'a changed vote moves, it is not counted twice');
    // Rooms: a message only one device has is kept; a merged room is sorted.
    const rooms = { R: [msg] };
    assert(CS.mergeRooms(rooms, { R: [del, { id: 'M2', text: 'new', timestamp: T(2) }] }), 'merging rooms reports a change');
    assert(rooms.R.length === 2 && rooms.R[0].deleted, 'deleted message deleted, new message added');
    // Follows: an unfollow is not undone.
    const fA = { u1: ['u2'] }, logA = {};
    CS.recordFollow(fA, logA, 'u1', 'u2', false, T(5)); fA.u1 = [];
    const fB = { u1: ['u2'] };
    CS.mergeFollows(fB, {}, fA, logA);
    assertEq(fB.u1.length, 0, 'the unfollow reaches the device still holding the follow');
    CS.mergeFollows(fA, logA, { u1: ['u2'] }, {});
    assertEq(fA.u1.length, 0, 'and a stale follow list cannot bring it back');
    const nb = CS.withoutBlobs({ R: [{ id: 1, imageData: 'data:x', text: 'pic' }] });
    assert(nb.R[0].imageData === undefined && nb.R[0].text === 'pic', 'pictures are left out of the main backup copy');
  }

  /* ----------------------------------------------- the anti-wipe guard */
  console.log('A write that would empty a collection not yet loaded is refused' + tag);
  {
    const st = mapStore({}); st.mayHoldUnloaded = () => true;
    assertEq(C.pageCloud.guardedSet(st, 'voctrain_submissions', '[]'), false, 'an empty write before the durable copy is read in is refused');
    assertEq(C.pageCloud.guardedSet(st, 'voctrain_submissions', '[{"id":1}]'), true, 'a real write still goes through');
    const st2 = mapStore({}); st2.mayHoldUnloaded = () => false;
    assertEq(C.pageCloud.guardedSet(st2, 'k', '[]'), true, 'and nothing changes for a store that is loaded');
  }

  /* ------------------------------------------------------ shared libraries */
  console.log('Deleted appraisals and withdrawn rulings stay that way' + tag);
  {
    const SA = require(path.join(B.dir, 'staff-appraisals.js'));
    const appr = { updatedAt: T(1), scores: { a: 1 } };
    const local = { cycles: { '2026-2027': {} }, extraStaff: [], deleted: { '2026-2027|ST-1': T(2), 'EXT:X1': T(2) } };
    const remote = { cycles: { '2026-2027': { 'ST-1': appr, 'ST-2': appr } }, extraStaff: [{ id: 'X1', name: 'Gone' }, { id: 'X2', name: 'Here' }] };
    const out = SA.sappMergeData(local, remote);
    assert(!out.cycles['2026-2027']['ST-1'] && !!out.cycles['2026-2027']['ST-2'], 'a deleted appraisal does not come back; others do');
    assert(!out.extraStaff.some(s => s.id === 'X1') && out.extraStaff.some(s => s.id === 'X2'), 'a removed staff member does not come back');
    const back = SA.sappMergeData(out, { cycles: { '2026-2027': { 'ST-1': { updatedAt: T(3), scores: { a: 2 } } } } });
    assert(!!back.cycles['2026-2027']['ST-1'], 'an appraisal re-entered after the deletion is kept');
    const plain = SA.sappMergeData({ cycles: { c: { s: appr } } }, { cycles: { c: { t: appr } } });
    assert(plain.cycles.c.s && plain.cycles.c.t && !plain.deleted, 'data without deletions merges as before');
    const CMC = require(path.join(B.dir, 'cmc-portal.js'));
    const book = CMC.cmcApplyRuling({ 7: { decision: 'Approved', by: 'Chair', at: T(1) } }, 7, null, T(2), 'chair');
    assertEq(CMC.cmcVirementStage({ status: 'Pending' }, CMC.cmcRulingFor(book, 7)), 'pending', 'a withdrawn ruling leaves the request awaiting the Chair');
    assertEq(book[7].withdrawnAt, T(2), 'and is written down, so another copy cannot restore the ruling');
    assertEq(Object.keys(CMC.cmcApplyRuling({ 7: { decision: 'Approved' } }, 7, null)).length, 0, 'without a time, removal works as before');
  }
});

/* ------------------------------------------------- the page-cloud push */
console.log('A page never uploads over its Drive file after failing to read it');
(async function pagecloud() {
  for (const B of BUILDS) {
    const tag = ' (' + B.where + ')';
    const map = new Map([['schoolDashboardGoogleAccessToken', 'tok'], ['voctrain_transcriptGrades', '[{"id":"mine"}]']]);
    const calls = [];
    let mediaStatus = 503;
    const ctx = {
      console, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
      encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
      setInterval: () => 0, Blob, FormData, addEventListener: () => {},
      fetch: (u, o) => {
        calls.push(((o && o.method) || 'GET') + ' ' + u);
        const ok = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
        if (/files\?q=/.test(u)) return ok(200, { files: [{ id: 'F1', modifiedTime: T(1) }] });
        if (/alt=media/.test(u)) return mediaStatus === 200 ? ok(200, { data: { voctrain_transcriptGrades: '[{"id":"theirs"}]' }, stamps: { voctrain_transcriptGrades: T(5) } }) : ok(mediaStatus, {});
        if (/upload/.test(u)) return ok(200, { id: 'F1' });
        return ok(404, {});
      },
      CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k), keys: () => Array.from(map.keys()), whenReady: () => {} }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(B.dir, 'cestis-core.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(B.dir, 'cestis-page-cloud.js'), 'utf8'), ctx);
    const pg = vm.runInContext("CESTISPageCloud.init({ page: 'T', file: 'CESTIS_Transcript_Grades.json', keys: ['voctrain_transcriptGrades'] })", ctx);
    const r1 = await pg.push();
    assertEq(r1, false, 'a 503 on the download stops the push' + tag);
    assert(!calls.some(c => /^PATCH/.test(c)), 'and nothing is written over the file' + tag);
    mediaStatus = 200;
    const r2 = await pg.push();
    assertEq(r2, true, 'once the file can be read, the push goes ahead' + tag);
    const sent = calls.filter(c => /^PATCH/.test(c)).length;
    assertEq(sent, 1, 'with one upload' + tag);
    const merged = JSON.parse(map.get('voctrain_transcriptGrades')).map(g => g.id).sort().join(',');
    assertEq(merged, 'mine,theirs', 'holding both devices\' grades (merged record by record on Drive)' + tag);
  }

  /* ------------------------------------------------ the Centre's server */
  console.log('The Centre\'s server tells "no file" from "could not read the file"');
  {
    const store = require('../Offline System/cestis-offline-store.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-sync-'));
    const file = path.join(dir, 'X.json');
    fs.mkdirSync(file);                                   // reading it throws EISDIR — "there, but unreadable"
    let threw = false;
    try { await store.save({ file, dataDir: dir, incoming: { data: { k: '1' }, stamps: {} }, core: BUILDS[1].core }); }
    catch (e) { threw = true; }
    assert(threw, 'a file that exists but cannot be read fails the save instead of being replaced');
    const fresh = path.join(dir, 'NEW.json');
    const res = await store.save({ file: fresh, dataDir: dir, incoming: { data: { k: '1' }, stamps: {} }, core: BUILDS[1].core });
    assert(res && fs.existsSync(fresh), 'a file that does not exist yet is created as before');
    const srv = fs.readFileSync(path.join(ROOT, 'Offline System', 'cestis-offline-server.js'), 'utf8');
    assert(/err\.code === 'ENOENT'\) return send\(res, 404/.test(srv) && /send\(res, 503, 'could not read/.test(srv),
      'the server answers 404 only for a missing file and 503 for a read error');
  }

  /* --------------------------------------------- the dashboard (index.html) */
  for (const where of ['index.html', 'Offline System/index.html']) {
    const SRC = fs.readFileSync(path.join(ROOT, where), 'utf8');
    const core = where === 'index.html' ? BUILDS[0].core : BUILDS[1].core;

    console.log('Re-added copies of deleted records go again; the last deletion persists (' + where + ')');
    {
      const map = new Map();
      const sb = {
        console, JSON, Date, Math, Object, Array, String, CESTISCore: core,
        CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) },
        exams: [], announcements: [], calendarEvents: [], lmsChatRooms: [], driveResources: [], classSessions: [],
        adminMeetings: [], instructorAssignments: [], assignmentSubmissions: [], instructorResources: [], instructorData: [],
        adrTasks: [], supportMessages: [], notifications: [], documentHubFiles: [], examResults: [], certDownloadApprovals: [],
        studentProfiles: {}, instructorProfiles: {}, adrStaffMeta: {}, certTemplates: {}, lmsChatProfiles: {},
        systemSettings: {}, adminStaffAccessSettings: {}, syncTombstones: {}, _syncIndex: {},
        safeJsonParse: (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } }
      };
      sb.window = sb;
      vm.createContext(sb);
      const fns = ['syncKeyById', 'syncCollections', 'syncStampAll', 'syncRebaselineAll', 'syncRecordTombstone', 'syncTombstoneRemoved',
        'syncTombsFor', 'syncApplyTombstones', 'saveCollection', 'syncEmptyIsDeliberate'];
      const keysVar = (SRC.match(/var SYNC_STORAGE_KEYS = \{[\s\S]*?\};/) || [''])[0];
      vm.runInContext(fns.map(n => extractFunction(SRC, n)).join('\n') + '\n' + keysVar, sb);
      vm.runInContext("announcements = [{ id: 'ANN-1', title: 'Hi' }]; syncRebaselineAll();", sb);
      // Delete the last announcement: tombstone written; the empty list is now allowed to be stored.
      map.set('voctrain_announcements', JSON.stringify([{ id: 'ANN-1', title: 'Hi' }]));
      vm.runInContext("syncTombstoneRemoved('announcements', announcements, announcements = []); syncStampAll();", sb);
      const ok = vm.runInContext("saveCollection('voctrain_announcements', announcements)", sb);
      assert(ok === true && map.get('voctrain_announcements') === '[]', 'deleting the last announcement reaches storage');
      // A page that has simply not loaded cannot empty a list.
      map.set('voctrain_exams', JSON.stringify([{ id: 'EXAM-9', title: 'Real' }]));
      assertEq(vm.runInContext("saveCollection('voctrain_exams', [])", sb), false, 'an empty exams list over real exams is still refused');
      // A path that re-adds the deleted announcement (an old per-user copy) is undone at the save.
      vm.runInContext("announcements.push({ id: 'ANN-1', title: 'Hi' }); syncStampAll();", sb);
      assertEq(vm.runInContext('announcements.length', sb), 0, 'a deleted announcement re-added without consulting the tombstones goes again');
      vm.runInContext("announcements.push({ id: 'ANN-2', title: 'New' }); syncStampAll();", sb);
      assertEq(vm.runInContext('announcements.length', sb), 1, 'a genuinely new one stays');
      // On load: what the tombstones say was deleted leaves memory.
      vm.runInContext("exams = [{ id: 'EXAM-9', title: 'Real', updatedAt: '" + T(1) + "' }]; syncTombstones.exams = { 'EXAM-9': '" + T(2) + "' }; syncApplyTombstones();", sb);
      assertEq(vm.runInContext('exams.length', sb), 0, 'a deleted exam still in storage is dropped on load');
      assertEq(vm.runInContext("syncCollections().filter(function(c){ return c.name === 'notifications'; })[0].removals", sb), false,
        'a shorter notifications list is never written down as deletions');
      assert(vm.runInContext("syncCollections().some(function(c){ return c.name === 'examResults' && c.removals === false; })", sb),
        'exam results are stamped on every save (so marks travel), and only deliberate removals count');
    }

    console.log('A failed pull is not a merge: no upload over it (' + where + ')');
    {
      const sb = {
        console, JSON, Date, Math, Object, Array, String, Promise, setTimeout,
        googleAccessToken: 'tok', isCloudConnected: true, cloudFileId: 'F', _autoSaveFileIds: {}, GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'FOLD' },
        _mainMergedThisSession: true, _lastCloudVersion: { FOLD: '7' },
        handleCloudAuthExpired: () => {}, cestisNoteServerClock: () => {},
        mergeBackupData: async () => true, merged: 0, fetchMode: 'fail'
      };
      sb._autoSaveFileIds.FOLD = 'F';
      sb.fetch = async (u) => {
        if (/fields=version/.test(u)) return { ok: true, status: 200, json: async () => ({ version: '8' }), headers: { get: () => null } };
        if (sb.fetchMode === 'fail') return { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } };
        if (sb.fetchMode === 'garbled') return { ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON'); }, headers: { get: () => null } };
        return { ok: true, status: 200, json: async () => ({ version: '1.0', data: {} }), headers: { get: () => null } };
      };
      sb.window = sb;
      vm.createContext(sb);
      const pre = (SRC.match(/var _lastPull = \{[^\n]*\n/) || [''])[0] + 'var _pullFailStreak = 0; var _mergeBackupFailed = false;\n';
      vm.runInContext(pre + ['silentMergeFromBackup', 'pullAllowsUpload', 'pullMainIfRemoteNewer', 'mainMovedSincePull'].map(n => extractFunction(SRC, n)).join('\n'), sb);
      await vm.runInContext('pullMainIfRemoteNewer()', sb);
      assertEq(vm.runInContext('_lastPull.ok', sb), false, 'a 503 on the download is reported as a failed pull');
      assertEq(vm.runInContext('pullAllowsUpload()', sb), false, 'and the autosave does not upload this tick');
      assertEq(vm.runInContext("_lastCloudVersion.FOLD", sb), '7', 'the version stays unseen, so the next tick fetches it again');
      sb.fetchMode = 'garbled';
      await vm.runInContext('pullMainIfRemoteNewer()', sb);
      assertEq(vm.runInContext('_lastPull.kind', sb), 'garbled', 'a cut-off download is a failed pull too');
      assertEq(vm.runInContext('pullAllowsUpload()', sb), false, 'and blocks the upload');
      sb.fetchMode = 'ok';
      await vm.runInContext('pullMainIfRemoteNewer()', sb);
      assert(vm.runInContext('_lastPull.ok && pullAllowsUpload()', sb), 'a good download allows the upload');
      assertEq(vm.runInContext("_lastCloudVersion.FOLD", sb), '8', 'and marks the version seen');
    }

    console.log('A staff sign-out keeps work that has not reached the cloud (' + where + ')');
    {
      const run = async function (opts) {
        const map = new Map(Object.entries(opts.store || {}));
        const calls = { cleared: 0, kept: 0 };
        const el = () => ({ classList: { add() {}, remove() {} }, style: {}, innerHTML: '' });
        const sb = {
          console, JSON, Date, Math, Object, Array, String, Promise, setTimeout, clearTimeout,
          document: { getElementById: el }, window: {}, CESTISCore: core,
          CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) },
          currentRole: opts.role, currentStudent: null, currentInstructor: null, currentLoggedInUser: { id: 'U1' },
          isCloudConnected: !!opts.connected, googleAccessToken: opts.connected ? 'tok' : null,
          _sessionSeq: 0, _sessionLocked: false, _isAutoSaving: false, _debouncedCloudSaveTimer: null,
          _lastAutoSaveResult: { uploaded: false }, userAccounts: [], adminLoginShown: 0, studentLoginShown: 0,
          instructorLoginShown: 0, adminStaffLoginShown: 0, cmcLoginShown: 0, loginSyncCompleted: false,
          examEndSessionForSignOut: () => true, closeMobileSidebar() {}, vcCleanupMediaIfNeeded() {}, stopAutoSave() {},
          stopSessionExpiryCheck() {}, closeModal() {}, enableLoginButtons() {}, saveMasterSnapshot() {}, showToast() {},
          lmsChatRTStop() {},
          clearSensitiveStudentData: () => { calls.cleared++; },
          autoSaveToAllFolders: async () => { sb._lastAutoSaveResult = { uploaded: !!opts.uploads }; },
          _sessionWiped: false, cloudFileId: 'F', lastSyncTime: null
        };
        sb.window = sb;
        vm.createContext(sb);
        vm.runInContext(['logout', 'finalCloudSaveBeforeLogout', 'keepUnsyncedDataOnSignOut'].map(n => extractFunction(SRC, n)).join('\n'), sb);
        vm.runInContext('logout(true)', sb);
        await new Promise(r => setTimeout(r, 30));
        return { calls, map };
      };
      let r = await run({ role: 'admin', connected: false, store: { cestisPendingUpload: 'admin|' + T(1), voctrain_examResults: '[1]' } });
      assertEq(r.calls.cleared, 0, 'offline with unsaved work: the device is NOT wiped');
      assert(r.map.has('voctrain_examResults') && r.map.has('cestisUnsyncedOnSignOut'), 'the data stays and the next sign-in is told to upload it');
      r = await run({ role: 'instructor', connected: true, uploads: false, store: { cestisPendingUpload: 'instructor|' + T(1) } });
      assertEq(r.calls.cleared, 0, 'a final upload that failed does not wipe either');
      r = await run({ role: 'admin', connected: true, uploads: true, store: { cestisPendingUpload: 'admin|' + T(1) } });
      assertEq(r.calls.cleared, 1, 'once the upload has succeeded the device is cleared as before');
      r = await run({ role: 'admin', connected: false, store: {} });
      assertEq(r.calls.cleared, 1, 'with nothing unsaved, an offline sign-out clears as before');
      r = await run({ role: 'student', connected: false, store: { cestisPendingUpload: 'student|' + T(1) } });
      assertEq(r.calls.cleared, 1, 'a trainee\'s sign-out still keeps only their own records (their results wait in the outbox)');
      r = await run({ role: 'student', connected: false, store: { cestisPendingUpload: 'admin|' + T(1) } });
      assertEq(r.calls.cleared, 0, 'but it does not trim away a staff member\'s work that never uploaded');
    }

    console.log('The dashboard wires every merge through the shared rules (' + where + ')');
    {
      const merge = extractFunction(SRC, 'mergeBackupData');
      assert(merge.indexOf('CESTISCore.sync.mergeExamResults(examResults') !== -1, 'exam results merge by the result rule');
      // The rules come from the core (Core.sync.RECORD_MAPS), the one
      // definition the Centre's network and its server merge by too.
      assert(merge.indexOf("CESTISCore.sync.mapRules('assignments'") !== -1, 'assignment grades merge trainee by trainee');
      assert(merge.indexOf("CESTISCore.sync.mapRules('notifications'") !== -1, 'notifications merge per person');
      assertEq(JSON.stringify(core.sync.RECORD_MAPS.assignments), JSON.stringify({ perEntry: { grades: 'gradeMeta.gradedAt' }, unionStamps: ['gradeLog'] }),
        'grades are dated per trainee and the grade history is kept whole');
      assertEq(JSON.stringify(core.sync.RECORD_MAPS.notifications), JSON.stringify({ unionStamps: ['readBy', 'clearedBy'] }), 'read and cleared per person');
      assert(merge.indexOf('mergeIncomingTombstoneLists(backupData.data)') !== -1, 'the trainee, centre and account deletion lists travel in the backup');
      assert(merge.indexOf('CESTISCore.calendarEventKey') !== -1, 'calendar events by id');
      assert(merge.indexOf('_mergeBackupFailed = true') !== -1, 'a merge that throws is reported, not taken for a merge');
      const side = extractFunction(SRC, 'syncAssignmentsFromDrive');
      assert(side.indexOf("tombs: syncTombsFor('instructorAssignments')") !== -1 && side.indexOf("CESTISCore.sync.mapRules('assignments'") !== -1,
        'the assignments side file follows the same rules, deletions included');
      assert(extractFunction(SRC, 'saveAssignmentsToDrive').indexOf('tombstones:') !== -1, 'and carries the deletions');
      const chatTo = extractFunction(SRC, 'lmsChatSyncToDrive');
      assert(chatTo.indexOf('await lmsChatSyncFromDrive()') !== -1 && chatTo.indexOf('!pulled || !pulled.ok') !== -1, 'the chat file is read and merged before it is written');
      assert(extractFunction(SRC, 'saveToCloud').indexOf('await autoSaveToAllFolders()') !== -1, '"Save to Cloud" is the safe automatic save');
      assert(extractFunction(SRC, 'importDataBackup').indexOf('window._cestisImporting = true') !== -1 &&
        extractFunction(SRC, 'saveState').indexOf('window._cestisImporting') !== -1, 'a restore cannot be saved over before the reload');
      assert(extractFunction(SRC, 'saveState').indexOf('CESTISStore.isReady()') !== -1, 'nothing saves before the durable store is read in');
      assert(extractFunction(SRC, 'gradeSubmission').indexOf('CESTISCore.coursework.recordGrade(') !== -1 &&
        core.sync.RECORD_MAPS.assignments.perEntry.grades === 'gradeMeta.gradedAt', 'each grade is dated, and merged by that date');
      assert(extractFunction(SRC, 'cdRevokePermissions').indexOf('permissionsRevokedAtMs') !== -1, 'a revocation is dated');
      assert(extractFunction(SRC, 'saveCalendarEventForm').indexOf('Object.assign({}, old, changes, { updatedAt: now })') !== -1, 'a calendar edit keeps its id and is dated');
      assert(extractFunction(SRC, 'clearAllNotifications').indexOf('syncTombstoneRemoved') === -1, '"Clear all" no longer deletes for everyone');
      assert(extractFunction(SRC, 'saveMasterSnapshot').indexOf('cestisUnionMasterTombstones(') !== -1, 'the master snapshot keeps the deletions it held');
      assert(extractFunction(SRC, 'autoSaveToAllFolders').indexOf('deletedStudentIds:') !== -1, 'the backup carries the trainee deletion list');
    }
  }

  /* ------------------------------------------------- the device store */
  console.log('A collection too big for localStorage is never mistaken for a deleted one');
  for (const B of BUILDS) {
    const tag = ' (' + B.where + ')';
    const SRC = fs.readFileSync(path.join(B.dir, 'cestis-core.js'), 'utf8');
    // One origin: a shared localStorage (5-character quota for the test) and
    // a shared IndexedDB; two documents (the dashboard and an embedded page).
    const lsData = new Map();
    const LIMIT = 40;
    const docs = [];
    const localStorage = {
      get length() { return lsData.size; }, key: i => Array.from(lsData.keys())[i],
      getItem: k => (lsData.has(k) ? lsData.get(k) : null),
      setItem: function (k, v) {
        if (String(v).length > LIMIT) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        const old = lsData.has(k) ? lsData.get(k) : null; lsData.set(k, String(v)); fire(this, k, String(v), old);
      },
      removeItem: function (k) { if (!lsData.has(k)) return; const old = lsData.get(k); lsData.delete(k); fire(this, k, null, old); }
    };
    const idbData = new Map();
    function fakeIDB(fail) {
      return {
        open: function () {
          const req = {};
          setTimeout(() => {
            if (fail) { req.onerror && req.onerror({}); return; }
            const db = {
              objectStoreNames: { contains: () => true },
              transaction: () => {
                const tx = { objectStore: () => ({
                  put: (v, k) => { idbData.set(k, v); }, delete: k => { idbData.delete(k); },
                  get: k => { const r = {}; setTimeout(() => { r.result = idbData.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
                  openCursor: () => {
                    const r = {}; const entries = Array.from(idbData.entries()); let i = 0;
                    const step = () => setTimeout(() => {
                      const e = entries[i++];
                      r.onsuccess({ target: { result: e ? { key: e[0], value: e[1], continue: step } : null } });
                    }, 0);
                    step(); return r;
                  } }) };
                return tx;
              }
            };
            req.onsuccess && req.onsuccess({ target: { result: db } });
          }, 0);
          return req;
        }
      };
    }
    // A 'storage' event reaches the OTHER documents later, as a queued task —
    // never inside the write that caused it (as in a browser).
    let writer = null;
    function fire(origin, key, newValue, oldValue) {
      const from = writer;
      setTimeout(() => docs.forEach(d => { if (d !== from) d.listeners.forEach(fn => fn({ key, newValue, oldValue })); }), 0);
    }
    const as = (d, fn) => { writer = d; try { return fn(); } finally { writer = null; } };
    function doc(name, idbFail) {
      const listeners = [], events = [];
      const d = { listeners, events, ls: localStorage, self: false };
      const ctx = {
        console: { info() {}, log() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
        setTimeout, clearTimeout, localStorage, indexedDB: fakeIDB(idbFail),
        addEventListener: (t, fn) => { if (t === 'storage') listeners.push(fn); else events.push({ t, fn }); },
        dispatchEvent: (ev) => { events.filter(e => e.t === ev.type).forEach(e => e.fn(ev)); d.fired = (d.fired || []).concat(ev.type + (ev.detail && ev.detail.reason ? ':' + ev.detail.reason : '')); },
        Event: function (t) { this.type = t; }, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
        navigator: {}
      };
      ctx.window = ctx;
      vm.createContext(ctx);
      vm.runInContext(SRC, ctx);
      d.store = ctx.CESTISStore; d.ctx = ctx;
      docs.push(d);
      return d;
    }
    const A = doc('dashboard'), F = doc('embedded page');
    await new Promise(r => setTimeout(r, 30));
    const big = JSON.stringify([{ id: 1, name: 'a long enough record' }, { id: 2, name: 'another one' }]);
    as(A, () => A.store.setItem('voctrain_submissions', '[{"id":1}]'));
    await new Promise(r => setTimeout(r, 10));
    assertEq(F.store.getItem('voctrain_submissions'), '[{"id":1}]', 'the embedded page reads the small value' + tag);
    as(A, () => A.store.setItem('voctrain_submissions', big));   // too big for localStorage now
    await new Promise(r => setTimeout(r, 30));
    assert(!(A.fired || []).some(t => t === 'cestis-store-write-error'), 'a full localStorage alone raises no "storage failing" alarm' + tag);
    assert(F.store.getItem('voctrain_submissions') !== null, 'the other page does not see the collection as ABSENT' + tag);
    assertEq(F.store.getItem('voctrain_submissions'), big, 'it reads the new value from IndexedDB' + tag);
    assertEq(F.ctx.CESTISCore.pageCloud.guardedSet(F.store, 'voctrain_submissions', '[]'), false, 'so an empty write from it is refused' + tag);
    as(A, () => A.store.removeItem('voctrain_submissions'));
    await new Promise(r => setTimeout(r, 10));
    assertEq(F.store.getItem('voctrain_submissions'), null, 'a real deletion still reaches the other page' + tag);
    // IndexedDB will not open: the page still starts, and is told.
    const D = doc('no indexeddb', true);
    let started = false;
    D.store.whenReady(() => { started = true; });
    await new Promise(r => setTimeout(r, 30));
    assert(started, 'whenReady still fires when IndexedDB cannot open' + tag);
    assert((D.fired || []).indexOf('cestis-store-write-error:idb-unavailable') !== -1, 'and the page is told its storage is not durable' + tag);
    assert(D.store.isReady(), 'the store reports ready' + tag);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
