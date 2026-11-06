/* Answers that did not reach the result are kept for staff to see.

   What happened (an audit): a trainee answers a test on PC 1, then it is
   submitted on PC 2 (or in another window). The answers PC 1 typed in its
   last moments — before its copy was shared — were not in PC 2's result, and
   when PC 1 heard the test had ended it replaced its own copy with the closed
   record: those answers were dropped, and the trainee was told "Your answers
   are kept with the result", which was not true for them.

   The owner's decision: "keep such late answers aside for staff to see". The
   rules (CESTISCore.exams, both builds):
     - a result's answers carry when each was given (stampAnswers);
     - an answer the device holds is "late" when it is newer than the
       result's copy of that question AND different from it (a result from
       before answers carried a time: newer than the submission);
     - identical or older answers are never flagged; an attempt begun after
       the result is another attempt;
     - late answers are kept ON the result (lateAnswers), never marked: the
       result's answers and mark never change;
     - every merge keeps both copies' lists, once each (mergeExamResults,
       the Centre-network merge); a result without them merges exactly as
       before;
     - a second submission of one attempt (a PC that was away) gives what
       it has that the first lacks before it goes (oneResultPerAttempt);
     - an open copy closed by a result (settleAttempts with info, and
       keepLateAnswers for copies arriving from elsewhere) gives its late
       answers first.

   Run: node tests/exam-late-answers.test.js */
'use strict';

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const J = v => JSON.stringify(v);
const copy = v => JSON.parse(JSON.stringify(v));
const MIN = 60000;
const T0 = Date.parse('2026-10-20T14:00:00.000Z');   // 09:00 Centre time
const iso = ms => new Date(ms).toISOString();

const QS = [
  { id: 'Q1', type: 'mcq', points: 1, text: 'Hose colour?', options: ['Red', 'Blue'], correctAnswer: 0 },
  { id: 'I1', type: 'info', points: 0, text: 'Section B' },
  { id: 'Q2', type: 'tf', points: 1, text: 'Arrestor stops flashback.', correctAnswer: true },
  { id: 'Q3', type: 'fill', points: 1, text: 'Cylinders stored ____.', correctAnswer: 'upright' },
  { id: 'Q4', type: 'short', points: 5, text: 'Describe the shut-down.' }
];
const PUBLIC = QS.map(q => { const c = Object.assign({}, q); delete c.correctAnswer; return c; });
function attempt(over) {
  return Object.assign({
    id: 'ATT-1', examId: 'EXAM-WS3', studentId: 'STU-TR', questions: copy(PUBLIC),
    answers: [null, null, null, null, null], answeredAt: [0, 0, 0, 0, 0], flagged: [false, false, false, false, false], flaggedAt: [0, 0, 0, 0, 0],
    startTime: T0, deadline: T0 + 90 * MIN, status: 'open', updatedAt: iso(T0)
  }, over || {});
}

[['cestis-core.js', require('../cestis-core.js')],
 ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(([where, Core]) => {
  const X = Core.exams;
  console.log('\n[' + where + ']');
  // PC 2's attempt as submitted at 09:30: Q1 (09:10), Q2 (09:12), Q3 (09:20).
  const atPc2 = attempt({ answers: [0, null, true, 'upright', null], answeredAt: [T0 + 10 * MIN, 0, T0 + 12 * MIN, T0 + 20 * MIN, 0] });
  function submitted(att, at) {
    const m = X.mark(att.questions, att.answers, QS);
    X.stampAnswers(m.gradedResults, att);
    return { id: 'RES-1', attemptId: att.id, examId: att.examId, studentId: att.studentId, answers: m.gradedResults,
      score: Math.round(m.earnedPoints / m.totalPoints * 100), earnedPoints: m.earnedPoints, totalPoints: m.totalPoints,
      needsReview: m.manualCount > 0, reviewComplete: !(m.manualCount > 0), passed: false, submittedAt: iso(at) };
  }
  const result = submitted(atPc2, T0 + 30 * MIN);

  console.log('A result\'s answers say when each was given');
  assertEq(result.answers.map(a => a.questionId), ['Q1', 'Q2', 'Q3', 'Q4'], 'information items are not answers');
  assertEq(result.answers.map(a => a.answeredAt), [T0 + 10 * MIN, T0 + 12 * MIN, T0 + 20 * MIN, 0], 'each answer\'s time, 0 for a blank');

  console.log('Late answers are found');
  // PC 1 held: Q1 the same (older), Q3 changed at 09:25 (newer than PC 2's
  // 09:20, never shared), Q4 typed at 09:28 (PC 2 never had it), Q2 changed
  // at 09:05 (OLDER than PC 2's 09:12 — PC 2's answer is the newest).
  const atPc1 = attempt({ answers: [0, null, false, 'upright and chained', 'Close the torch valves first'],
    answeredAt: [T0 + 10 * MIN, 0, T0 + 5 * MIN, T0 + 25 * MIN, T0 + 28 * MIN] });
  const NOW = T0 + 31 * MIN;
  const late = X.lateAnswersOf(atPc1, result, NOW);
  assertEq(late.map(e => e.questionId), ['Q3', 'Q4'], 'Q3 (newer and different) and Q4 (never in the result) are late');
  assertEq(late.map(e => e.index), [2, 3], 'each with its place in the result (the information item is not counted)');
  assertEq(late.map(e => e.answer), ['upright and chained', 'Close the torch valves first'], 'with the answer as given');
  assertEq(late.map(e => e.answeredAt), [T0 + 25 * MIN, T0 + 28 * MIN], 'and when it was given');
  assert(late.every(e => e.foundAt === iso(NOW) && e.attemptId === 'ATT-1'), 'and when it was found, and the attempt');

  console.log('Identical or older answers are not flagged');
  assertEq(X.lateAnswersOf(atPc2, result, NOW), [], 'the submitted copy itself has none');
  assertEq(X.lateAnswersOf(attempt({ answers: [0, null, true, 'upright', null], answeredAt: [T0 + 29 * MIN, 0, T0 + 29 * MIN, T0 + 29 * MIN, 0] }), result, NOW), [],
    'the same answers given again later are not late (nothing differs)');
  assertEq(X.lateAnswersOf(attempt({ answers: [1, null, null, null, null], answeredAt: [T0 + 2 * MIN, 0, 0, 0, 0] }), result, NOW), [],
    'a different but OLDER answer is not late (the result has the newest)');
  assertEq(X.lateAnswersOf(attempt({ answers: [null, null, null, null, ''], answeredAt: [0, 0, 0, 0, T0 + 40 * MIN] }), result, NOW), [],
    'a blank is never a late answer');
  assertEq(X.lateAnswersOf(attempt({ id: 'ATT-2', startTime: T0 + 60 * MIN, answers: [1, null, null, null, null], answeredAt: [T0 + 61 * MIN, 0, 0, 0, 0] }), result, NOW), [],
    'an attempt begun after the result was submitted is another attempt');
  // A result from before answers had a time: only answers given after the submission.
  const old = copy(result); old.answers.forEach(a => delete a.answeredAt);
  assertEq(X.lateAnswersOf(atPc1, old, NOW), [], 'an older result: answers given before the submission are not counted');
  assertEq(X.lateAnswersOf(attempt({ answers: [null, null, null, 'chained', null], answeredAt: [0, 0, 0, T0 + 35 * MIN, 0] }), old, NOW).map(e => e.questionId), ['Q3'],
    'an older result: an answer given after the submission is');

  console.log('Kept on the result — the mark and the answers never change');
  const r1 = copy(result);
  const before = J({ answers: r1.answers, score: r1.score, earnedPoints: r1.earnedPoints, passed: r1.passed });
  assertEq(X.addLateAnswers(r1, late), 2, 'two kept');
  assertEq(X.addLateAnswers(r1, late), 0, 'kept once: the same two again add nothing');
  assertEq(r1.lateAnswers.map(e => e.questionId), ['Q3', 'Q4'], 'in question order');
  assertEq(J({ answers: r1.answers, score: r1.score, earnedPoints: r1.earnedPoints, passed: r1.passed }), before, 'answers, score and mark unchanged');

  console.log('Merging keeps both sides\' late answers (once each)');
  // PC 1 found Q3 and Q4; a third device found Q4 again (later foundAt) and Q1.
  const rA = copy(result); X.addLateAnswers(rA, late);
  const rB = copy(result);
  X.addLateAnswers(rB, [Object.assign({}, late[1], { foundAt: iso(NOW + 5 * MIN) }),
    { questionId: 'Q1', index: 0, answer: 1, answeredAt: T0 + 29 * MIN, foundAt: iso(NOW + 5 * MIN), attemptId: 'ATT-1' }]);
  const ab = [copy(rA)], ba = [copy(rB)];
  Core.sync.mergeExamResults(ab, [copy(rB)], {});
  Core.sync.mergeExamResults(ba, [copy(rA)], {});
  assertEq(ab[0].lateAnswers.map(e => e.questionId + '@' + e.answeredAt), ['Q1@' + (T0 + 29 * MIN), 'Q3@' + (T0 + 25 * MIN), 'Q4@' + (T0 + 28 * MIN)], 'the union, no duplicates');
  assertEq(J(ab[0].lateAnswers), J(ba[0].lateAnswers), 'the same list whichever side merges');
  // Staff marked the essay on their copy (reviewed, so it wins); the trainee's
  // copy carries late answers: the mark stands and the answers are kept.
  const staff = copy(result);
  staff.answers[3] = Object.assign({}, staff.answers[3], { graded: true, gradedBy: 'INS-1', awardedPoints: 4, earnedPoints: 4 });
  Object.assign(staff, { earnedPoints: staff.earnedPoints + 4, reviewComplete: true, needsReview: false, reviewedAt: iso(T0 + 120 * MIN) });
  const staffMark = J({ answers: staff.answers, earnedPoints: staff.earnedPoints, score: staff.score });
  for (const [first, second, how] of [[staff, rA, 'staff copy local'], [rA, staff, 'trainee copy local']]) {
    const list = [copy(first)];
    const out = Core.sync.mergeExamResults(list, [copy(second)], {});
    assert(out.updated > 0, how + ': reported as changed');
    assertEq(J({ answers: list[0].answers, earnedPoints: list[0].earnedPoints, score: list[0].score }), staffMark, how + ': the staff mark stands');
    assertEq((list[0].lateAnswers || []).map(e => e.questionId), ['Q3', 'Q4'], how + ': and the late answers are kept');
  }
  const kept = [copy(staff)];
  assert(Core.sync.mergeExamResults(kept, [copy(rA)], {}).updated === 1, 'a copy that only adds late answers is a change (so it is saved and sent on)');
  assert(Core.sync.mergeExamResults(kept, [copy(rA)], {}).updated === 0, 'merging the same again is not');

  console.log('A result without late answers merges exactly as before');
  const legacyA = copy(result), legacyB = copy(result);
  legacyB.answers[3] = Object.assign({}, legacyB.answers[3], { graded: true, awardedPoints: 2, earnedPoints: 2 });
  Object.assign(legacyB, { reviewComplete: true, needsReview: false, reviewedAt: iso(T0 + 60 * MIN) });
  const m1 = [copy(legacyA)]; Core.sync.mergeExamResults(m1, [copy(legacyB)], {});
  assertEq(J(m1[0]), J(legacyB), 'the marked copy wins, nothing added');
  assert(!('lateAnswers' in m1[0]), 'and no lateAnswers field appears');
  const m2 = [copy(legacyB)]; const o2 = Core.sync.mergeExamResults(m2, [copy(legacyA)], {});
  assertEq(J(m2[0]), J(legacyB), 'the other way round too');
  assertEq(o2.updated, 0, 'and it is no change');
  // Two submissions of one attempt, neither with times (saved before this):
  // the first stands, exactly as before.
  const s1 = copy(old), s2 = copy(old);
  s2.id = 'RES-2'; s2.submittedAt = iso(T0 + 40 * MIN); s2.answers[0] = Object.assign({}, s2.answers[0], { studentAnswer: 1, isCorrect: false, earnedPoints: 0 });
  const two = [copy(s1)]; Core.sync.mergeExamResults(two, [copy(s2)], {});
  assertEq(J(two), J([s1]), 'two older results of one attempt: the first stands, unchanged');

  console.log('A second submission of one attempt gives its late answers before it goes');
  // PC 1, away, submitted its own copy at 09:40 (after PC 2's at 09:30).
  const pc1Result = Object.assign(submitted(atPc1, T0 + 40 * MIN), { id: 'RES-2' });
  const list = [copy(result), copy(pc1Result)];
  const dropped = X.oneResultPerAttempt(list);
  assertEq(dropped.map(r => r.id), ['RES-2'], 'PC 1\'s later submission is dropped');
  assertEq(list.length, 1, 'one result');
  assertEq(list[0].lateAnswers.map(e => e.questionId), ['Q3', 'Q4'], 'with PC 1\'s Q3 and Q4 kept on it');
  assertEq(J(list[0].answers), J(result.answers), 'its answers and mark are the first submission\'s');
  const viaMerge = [copy(result)];
  Core.sync.mergeExamResults(viaMerge, [copy(pc1Result)], {});
  assertEq(viaMerge.map(r => r.id), ['RES-1'], 'online merge: the first stands');
  assertEq(viaMerge[0].lateAnswers.map(e => e.questionId), ['Q3', 'Q4'], 'online merge: with the late answers');
  const viaMerge2 = [copy(pc1Result)];
  Core.sync.mergeExamResults(viaMerge2, [copy(result)], {});
  assertEq(viaMerge2.map(r => r.id + ':' + (r.lateAnswers || []).map(e => e.questionId).join()), ['RES-1:Q3,Q4'], 'online merge, the other way round: the same');
  const PC = Core.pageCloud;
  let lan = PC.mergeKeys({ voctrain_examResults: J([pc1Result]) }, { voctrain_examResults: iso(T0 + 300 * MIN) },
    { voctrain_examResults: J([result]) }, { voctrain_examResults: iso(T0 + 40 * MIN) }, { records: true });
  assertEq(JSON.parse(lan.data.voctrain_examResults).map(r => r.id + ':' + (r.lateAnswers || []).map(e => e.questionId).join()), ['RES-1:Q3,Q4'],
    'the Centre-network merge: the first stands, with the late answers');
  lan = PC.mergeKeys({ voctrain_examResults: J([staff]) }, { voctrain_examResults: iso(T0 + 300 * MIN) },
    { voctrain_examResults: J([rA]) }, { voctrain_examResults: iso(T0 + 40 * MIN) }, { records: true });
  const lanR = JSON.parse(lan.data.voctrain_examResults)[0];
  assertEq([lanR.earnedPoints, (lanR.lateAnswers || []).map(e => e.questionId)], [staff.earnedPoints, ['Q3', 'Q4']], 'the Centre-network merge: the staff mark and the trainee\'s late answers both kept');

  console.log('An open copy closed by a result gives its late answers first');
  const res = [copy(result)];
  const atts = [copy(atPc1)];
  const info = { late: 0, nowMs: NOW };
  assertEq(X.settleAttempts(atts, res, info), 1, 'the open copy is closed');
  assert(X.attemptIsRetired(atts[0]), 'retired');
  assertEq(info.late, 2, 'two late answers kept');
  assertEq(res[0].lateAnswers.map(e => e.questionId), ['Q3', 'Q4'], 'on the result');
  const res2 = [copy(result)], atts2 = [copy(atPc1)];
  assertEq(X.settleAttempts(atts2, res2), 1, 'without info: closed as before');
  assert(!('lateAnswers' in res2[0]), 'and the result untouched, as before');
  const res3 = [copy(result)];
  assertEq(X.keepLateAnswers([copy(atPc1), copy(atPc2), X.retireAttempt(atPc1, 'RES-1')], res3, NOW), 2, 'copies arriving from elsewhere: the open ones are read');
  assertEq(X.keepLateAnswers([copy(atPc1)], res3, NOW), 0, 'and read again, nothing new');
  assertEq(X.keepLateAnswers([copy(atPc1)], [Object.assign(copy(result), { archived: true })], NOW), 0, 'an archived result answers nothing');

  console.log('Through the trainee gate: the gate\'s own marking says when each answer was given');
  if (Core.gate && Core.gate.markAttempt) {
    const keyFile = { format: Core.gate.FORMAT.key, version: 1, examId: 'EXAM-WS3', exam: { id: 'EXAM-WS3', title: 'Welding', passMark: 50, duration: 90, questionData: copy(QS) }, centreUtcOffset: '-05:00' };
    const crypto = { sha256Hex: s => require('crypto').createHash('sha256').update(String(s)).digest('hex') };
    const m = Core.gate.markAttempt(copy(atPc2), keyFile, T0 + 30 * MIN, { crypto: crypto, receivedAt: T0 + 30 * MIN });
    assert(m && m.result, 'marked');
    if (m && m.result) {
      assertEq(m.result.answers.map(a => a.answeredAt), [T0 + 10 * MIN, T0 + 12 * MIN, T0 + 20 * MIN, 0], 'each answer with its time');
      assertEq(X.lateAnswersOf(atPc1, m.result, NOW).map(e => e.questionId), ['Q3', 'Q4'], 'so the other device\'s answers are found the same way');
    }
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
