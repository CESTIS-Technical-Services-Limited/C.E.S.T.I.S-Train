/* A test in progress follows the trainee to another computer — and two
   computers touching the same attempt never lose an answer or make two
   results.

   What happened: an attempt in progress was kept only on the PC it was sat
   on. When that PC died (a power cut) the trainee signed in at another one
   and was offered "Take Exam": a FRESH attempt with a full new clock, none of
   her answers, and — once the first PC came back and submitted its saved
   copy — two results for one exam, where "the later submission replaces the
   earlier" put the stale copy over the real one.

   The owner's decision: the attempt travels with the trainee by the same
   routes as a submitted result. These pin the rules every route uses
   (CESTISCore.exams, both builds):
     - two copies of one attempt merge question by question: the newest
       answer to each question wins (answeredAt), the newest flag (flaggedAt),
       the page from the copy moved last; the deadline never moves later;
     - a submitted (retired) record beats any open copy, so a stale device
       cannot bring a submitted attempt back; of two retired copies the first
       submission stands;
     - a list is merged record by record — a shorter list is never a
       deletion — and retired records are let go only months later;
     - two open attempts of one trainee at one exam (a second PC started before
       it heard of the first) are ONE attempt: the first started, with the
       newest answer to each question from both, even when the questions were
       shuffled differently;
     - a live result settles every open attempt of that trainee at that exam;
     - two results from attempts at one exam: the first submission stands, on
       the online merge (mergeExamResults) and the Centre-network merge
       (pageCloud.mergeKeys) alike; results saved before attempts travelled
       keep the old rule;
     - a trainee actively taking a test is not signed out by the session
       clock; an idle PC still is (sessionAccess.examGrace).

   Run: node tests/exam-attempt-travel.test.js */
'use strict';

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const J = v => JSON.stringify(v);
const MIN = 60000;
const T0 = Date.parse('2026-10-20T14:00:00.000Z');   // 09:00 Centre time

const QS = [{ id: 'Q1', type: 'mcq', options: ['a', 'b'] }, { id: 'Q2', type: 'tf' }, { id: 'Q3', type: 'match', rows: ['x', 'y'] }, { id: 'Q4', type: 'short' }];
function attempt(over) {
  return Object.assign({
    id: 'ATT-1', examId: 'EXAM-WS3', studentId: 'STU-TR', studentName: 'Tameka Richards', title: 'Welding Safety', duration: 90,
    questions: QS.map(q => Object.assign({}, q)), answers: [null, null, null, null], flagged: [false, false, false, false],
    answeredAt: [0, 0, 0, 0], flaggedAt: [0, 0, 0, 0], startTime: T0, deadline: T0 + 90 * MIN, page: 0, current: 0, posAt: T0,
    status: 'open', updatedAt: new Date(T0).toISOString()
  }, over || {});
}

[['cestis-core.js', require('../cestis-core.js')],
 ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(([where, Core]) => {
  const X = Core.exams;
  console.log('\n[' + where + ']');

  console.log('Two copies of one attempt: the newest answer to each question wins');
  // PC 1 answered Q1 and half of Q3 at 09:10, then died. PC 2 continued: it
  // changed Q1 at 09:20 and answered Q4; PC 1's copy of Q3 is still its newest.
  const pc1 = attempt({ answers: [0, true, ['A', null], null], answeredAt: [T0 + 10 * MIN, T0 + 10 * MIN, T0 + 11 * MIN, 0],
    flagged: [false, true, false, false], flaggedAt: [0, T0 + 10 * MIN, 0, 0], page: 1, current: 2, posAt: T0 + 11 * MIN });
  const pc2 = attempt({ answers: [1, true, null, 'Close the valves'], answeredAt: [T0 + 20 * MIN, T0 + 10 * MIN, 0, T0 + 21 * MIN],
    flagged: [false, false, false, false], flaggedAt: [0, T0 + 19 * MIN, 0, 0], page: 1, current: 3, posAt: T0 + 21 * MIN });
  for (const [a, b, how] of [[pc1, pc2, 'PC 1 first'], [pc2, pc1, 'PC 2 first']]) {
    const m = X.mergeAttempt(a, b);
    assertEq(m.answers, [1, true, ['A', null], 'Close the valves'], how + ': Q1 from PC 2 (newer), Q3 from PC 1 (only one), Q4 from PC 2');
    assertEq(m.flagged[1], false, how + ': the flag taken off on PC 2 later stays off');
    assertEq([m.page, m.current], [1, 3], how + ': the page and question PC 2 moved to last');
    assertEq(m.deadline, T0 + 90 * MIN, how + ': the original deadline');
    assert(m.status === 'open' && m.id === 'ATT-1', how + ': still the one open attempt');
  }
  assertEq(J(X.mergeAttempt(pc1, pc2)), J(X.mergeAttempt(X.mergeAttempt(pc1, pc2), pc1)), 'merging again with the stale copy changes nothing');
  const shorter = X.mergeAttempt(attempt({ deadline: T0 + 90 * MIN }), attempt({ deadline: T0 + 200 * MIN, answers: [0, null, null, null], answeredAt: [T0 + MIN, 0, 0, 0] }));
  assertEq(shorter.deadline, T0 + 90 * MIN, 'a copy with a later deadline never gives more time');
  // A draft saved before answers carried their own time: as old as its save.
  const legacy = attempt({ answers: [0, null, null, 'old essay'], answeredAt: undefined, flaggedAt: undefined, savedAt: new Date(T0 + 5 * MIN).toISOString() });
  delete legacy.answeredAt; delete legacy.flaggedAt;
  const newer = attempt({ answers: [null, false, null, 'new essay'], answeredAt: [0, T0 + 6 * MIN, 0, T0 + 7 * MIN] });
  assertEq(X.mergeAttempt(legacy, newer).answers, [0, false, null, 'new essay'], 'an old-format draft merges: its answers dated by its save');

  console.log('A submitted attempt cannot be brought back by a stale copy');
  const retired = X.retireAttempt(pc2, 'RES-PC2', new Date(T0 + 40 * MIN).toISOString());
  assert(X.attemptIsRetired(retired) && retired.answers === undefined && retired.resultId === 'RES-PC2', 'the retired record carries no answers, only the result it names');
  for (const [a, b, how] of [[pc1, retired, 'stale first'], [retired, pc1, 'retired first']]) {
    const m = X.mergeAttempt(a, b);
    assert(X.attemptIsRetired(m) && m.resultId === 'RES-PC2', how + ': the retired record wins');
  }
  const laterRetire = X.retireAttempt(pc1, 'RES-PC1', new Date(T0 + 95 * MIN).toISOString());
  assertEq(X.mergeAttempt(laterRetire, retired).resultId, 'RES-PC2', 'two submissions: the first one stands');
  assertEq(X.mergeAttempt(retired, laterRetire).resultId, 'RES-PC2', '... whichever arrives first');

  console.log('Lists merge record by record; a shorter list deletes nothing');
  const other = attempt({ id: 'ATT-KJ', studentId: 'STU-KJ', studentName: 'Kemar Johnson' });
  let r = X.mergeAttemptLists([pc1], [other, pc2]);
  assert(r.changed && r.list.length === 2 && r.list[0].answers[0] === 1, 'both trainees\' attempts kept; Tameka\'s merged question by question');
  assert(!X.mergeAttemptLists(r.list, [pc1]).changed, 'a stale copy that adds nothing is not a change (no upload loop)');
  assert(!X.mergeAttemptLists(r.list, []).changed && X.mergeAttemptLists(r.list, []).list.length === 2, 'an empty list removes nothing');
  r = X.mergeAttemptLists([pc1, other], [retired]);
  assert(X.attemptIsRetired(r.list[0]) && X.attemptIsOpen(r.list[1]), 'the retired record replaces only that attempt');
  const old = X.retireAttempt(other, 'RES-OLD', new Date(T0 - 200 * 24 * 3600 * 1000).toISOString());
  r = X.mergeAttemptLists([old, pc1], [], { nowMs: T0 });
  assert(r.changed && r.list.length === 1 && r.list[0].id === 'ATT-1', 'a retired record is let go months after its submission');

  console.log('Two attempts started on two PCs are one attempt');
  // PC 2 did not know of PC 1's attempt and started its own, shuffled differently.
  const pc2fresh = attempt({ id: 'ATT-2', startTime: T0 + 15 * MIN, deadline: T0 + 105 * MIN,
    questions: [QS[3], QS[0], QS[2], QS[1]].map(q => Object.assign({}, q)), answers: ['Purge the hoses', null, null, false],
    answeredAt: [T0 + 16 * MIN, 0, 0, T0 + 17 * MIN] });
  const one = X.attemptFor([pc2fresh, other, pc1], 'STU-TR', 'EXAM-WS3');
  assert(one && one.attempt.id === 'ATT-1' && one.ids.sort().join() === 'ATT-1,ATT-2', 'the one started first, both records folded in');
  assertEq(one.attempt.answers, [0, false, ['A', null], 'Purge the hoses'], 'answers matched by question, newest each (Q2 from PC 2, the rest)');
  assertEq(one.attempt.deadline, T0 + 90 * MIN, 'and the FIRST attempt\'s deadline');
  assert(X.attemptFor([pc1, other], 'STU-KJ', 'EXAM-WS3').attempt.studentName === 'Kemar Johnson' && X.attemptFor([pc1], 'STU-KJ', 'EXAM-WS3') === null,
    'a trainee only ever gets their own attempt');
  assert(X.attemptFor([pc1, retired], 'STU-TR', 'EXAM-WS3') === null, 'nothing to continue once it is submitted');

  console.log('A result settles the attempt; one result per attempt');
  const list = [pc1, other];
  assertEq(X.settleAttempts(list, [{ id: 'RES-A', examId: 'EXAM-WS3', studentId: 'STU-KJ', archived: true }]), 0, 'an archived result settles nothing');
  assertEq(X.settleAttempts(list, [{ id: 'RES-PC2', examId: 'EXAM-WS3', studentId: 'STU-TR', submittedAt: new Date(T0 + 40 * MIN).toISOString() }]), 1, 'a live result settles her open attempt');
  assert(X.attemptIsRetired(list[0]) && list[0].resultId === 'RES-PC2' && X.attemptIsOpen(list[1]), '... and only hers');
  const real = { id: 'RES-PC2', attemptId: 'ATT-1', examId: 'EXAM-WS3', studentId: 'STU-TR', score: 85, submittedAt: new Date(T0 + 40 * MIN).toISOString() };
  const stale = { id: 'RES-PC1', attemptId: 'ATT-1', examId: 'EXAM-WS3', studentId: 'STU-TR', score: 30, autoSubmitted: true, submittedAt: new Date(T0 + 300 * MIN).toISOString() };
  for (const [loc, cl, how] of [[[stale], [real], 'the stale PC merges the real one'], [[real], [stale], 'the office merges the stale one']]) {
    const local = loc.map(x => Object.assign({}, x));
    Core.sync.mergeExamResults(local, cl);
    assert(local.length === 1 && local[0].id === 'RES-PC2' && local[0].score === 85, how + ': one result, the first submission (' + J(local.map(x => x.id)) + ')');
  }
  const both = [stale, real].map(x => Object.assign({}, x));
  assertEq(X.oneResultPerAttempt(both).map(x => x.id), ['RES-PC1'], 'a device holding both drops the later');
  // Results saved before attempts travelled keep the rule they had: the later replaces.
  const legacyLocal = [{ id: 'RES-OLD1', examId: 'E9', studentId: 'S9', score: 40, submittedAt: new Date(T0).toISOString() }];
  Core.sync.mergeExamResults(legacyLocal, [{ id: 'RES-OLD2', examId: 'E9', studentId: 'S9', score: 70, submittedAt: new Date(T0 + MIN).toISOString() }]);
  assert(legacyLocal.length === 1 && legacyLocal[0].id === 'RES-OLD2', 'older results: unchanged rule');

  console.log('The Centre network merges attempts and results the same way');
  const PC = Core.pageCloud;
  assert(PC.isRecordKey('voctrain_examAttempts'), 'attempts are a record collection (a trainee\'s device may publish them)');
  let m = PC.mergeKeys({ voctrain_examAttempts: J([pc1]) }, { voctrain_examAttempts: new Date(T0 + 60 * MIN).toISOString() },
    { voctrain_examAttempts: J([pc2, other]) }, { voctrain_examAttempts: new Date(T0 + 30 * MIN).toISOString() }, { records: true });
  const lan = JSON.parse(m.data.voctrain_examAttempts);
  assert(lan.length === 2 && J(lan.find(x => x.id === 'ATT-1').answers) === J([1, true, ['A', null], 'Close the valves']),
    'PC 1 coming back with the NEWER whole-key stamp does not put its stale copy over PC 2\'s answers');
  m = PC.mergeKeys({ voctrain_examAttempts: J([pc1]) }, { voctrain_examAttempts: new Date(T0 + 60 * MIN).toISOString() },
    { voctrain_examAttempts: J([retired]) }, { voctrain_examAttempts: new Date(T0 + 30 * MIN).toISOString() }, { records: true });
  assert(X.attemptIsRetired(JSON.parse(m.data.voctrain_examAttempts)[0]), 'nor bring back the attempt the server has as submitted');
  m = PC.mergeKeys({ voctrain_examResults: J([stale]) }, { voctrain_examResults: new Date(T0 + 300 * MIN).toISOString() },
    { voctrain_examResults: J([real]) }, { voctrain_examResults: new Date(T0 + 40 * MIN).toISOString() }, { records: true });
  assertEq(JSON.parse(m.data.voctrain_examResults).map(x => x.id), ['RES-PC2'], 'one result on the server: the first submission');

  console.log('A trainee taking a test is not signed out by the session clock; an idle PC is');
  const S = Core.sessionAccess, now = T0 + 60 * MIN, expiry = now + 90 * 1000, deadline = now + 40 * MIN;
  const kept = S.examGrace(now, now - 30 * 1000, expiry, deadline);
  assert(kept > expiry && kept <= now + 15 * MIN, 'active in the last minute: carried on, a step at a time');
  assertEq(S.examGrace(now, now - 30 * 1000, now + 30 * MIN, deadline), now + 30 * MIN, 'not near the end yet: unchanged');
  assertEq(S.examGrace(now, now - 25 * MIN, expiry, deadline), expiry, 'nobody has touched the PC for 25 minutes: it is signed out as before');
  assert(S.examGrace(now, now - 1000, expiry, now + 2 * MIN) <= now + 12 * MIN, 'never beyond the deadline plus ten minutes to read the result');
  assertEq(S.examGrace(now, now - 1000, expiry, now - MIN), expiry, 'a test already over keeps nothing open');
  assertEq(S.state(now, now - 1000, kept, 'student'), 'ok', 'and the "session ends in two minutes" warning is not shown');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
