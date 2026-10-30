/* Tests through the gate: marked from the key, never from the trainee's copy.

   Today a trainee's own device marks their test (submitExam →
   Core.exams.mark), taking each question's POINTS from the trainee's copy of
   the paper — so a copy edited to say a question is worth 1000 marks scored
   1000 marks, and every answer key sits on the device to be read. Through
   the gate (DESIGN.md §5.3) the device never holds a key: it gets a paper
   (Core.gate.buildPaper) and the gatekeeper marks the submitted attempt
   with Core.gate.markAttempt against the key file.

   Pinned here:
     - the questions are rebuilt from the KEY by id: points, type and text
       the trainee's copy claims are ignored; a question the key does not
       have is ignored (never guessed); one left out of the copy still
       counts, unanswered; a question listed twice counts once; the option
       order is display only;
     - the marks agree with today's marking of the same answers;
     - the result's id comes from the attempt's (RES-G-<sha256>), so two
       devices submitting one attempt make one result;
     - late: after the exam's window plus two minutes, or after the time
       the gatekeeper first saw the attempt plus its duration plus two
       minutes — kept and flagged for staff, never refused;
     - the right answers are shown only when the exam's release allows, on
       the GIVEN time (the gatekeeper's), and never in a slice; a result that
       came in the slice gets them back from the key file (fillAnswers)
       exactly as marking gave them, before that decision;
     - an attempt spread over several devices' inboxes resumes as ONE
       attempt with the newest answer to each question and the first
       deadline; a submitted one, or a result, ends it;
     - a paper's questions shuffle for an attempt without losing a matching
       question's prompts and choices (attemptQuestionsFromPaper).

   Run: node tests/gate-exam.test.js */
'use strict';

const Core = require('../cestis-core.js');
const { makeCentre, crypto, NOW, MIN, DAY, iso } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate, X = Core.exams;
const C = makeCentre(Core);
const T = C.trainees[0];
const exam = C.examById.EX1;                         // 09:00–10:30 Centre time = 14:00–15:30Z; NOW is 15:00Z
const keyFile = G.buildKey(exam, '-05:00');
const paper = G.buildPaper(exam, NOW);
const J = v => JSON.parse(JSON.stringify(v));

function seq(values) { let i = 0; return () => values[i++ % values.length]; }
// The right answer to each question, as the trainee records it (the ORIGINAL option index).
function rightAnswer(q) {
  return { mcq: 0, tf: false, multi: [0, 2], match: ['Grinder', 'Torch'], shortanswer: 'Flashback Arrestor', numerical: '108', fill: 'butt', essay: 'I keep it tidy.' }[q.type];
}
function attempt(over, rnd) {
  const qs = X.attemptQuestionsFromPaper(paper.questions, { shuffleQuestions: true, shuffleOptions: true, random: rnd || seq([0.71, 0.13, 0.52, 0.94, 0.3]) });
  return Object.assign({ id: 'ATT-A1', examId: 'EX1', studentId: T.stu.id, studentName: T.stu.name, accountId: T.acct.id, questions: qs,
    answers: qs.map(q => (q.type === 'info' ? null : rightAnswer(q))), flagged: qs.map(() => false), answeredAt: qs.map(() => NOW - 5 * MIN),
    flaggedAt: qs.map(() => 0), startTime: NOW - 40 * MIN, deadline: NOW + 30 * MIN, status: 'open', updatedAt: iso(NOW - 5 * MIN) }, over || {});
}
const mark = (a, o) => G.markAttempt(a, keyFile, NOW, Object.assign({ crypto, receivedAt: NOW }, o || {}));

/* ---------------------------------------------------------- the paper */
console.log('A paper shuffles for an attempt without losing anything, and never carries a key');
{
  const plain = X.attemptQuestionsFromPaper(paper.questions, {});
  assertEq(plain, paper.questions, 'unshuffled, the attempt is the paper');
  const a = attempt();
  assertEq(a.questions[0].type, 'info', 'an information item stays where staff put it');
  assertEq(a.questions.map(q => q.id).sort(), paper.questions.map(q => q.id).sort(), 'every question is there once');
  const m = a.questions.find(q => q.type === 'match');
  assertEq([m.rows, m.choices.slice().sort()], [['Cuts', 'Joins'], ['Grinder', 'Hammer', 'Torch']], 'a matching question keeps its prompts and every choice');
  const mc = a.questions.find(q => q.type === 'mcq');
  assert(Array.isArray(mc.optionOrder) && mc.optionOrder.slice().sort().join() === '0,1,2', 'options are reordered, the original index recorded');
  // Today's attemptQuestions on the full bank, with the same random numbers, makes the same paper.
  const r1 = seq([0.71, 0.13, 0.52, 0.94, 0.3]), r2 = seq([0.71, 0.13, 0.52, 0.94, 0.3]);
  const fromBank = X.attemptQuestions(exam.questionData, { shuffleQuestions: true, shuffleOptions: true, random: r1 });
  const fromPaper = X.attemptQuestionsFromPaper(paper.questions, { shuffleQuestions: true, shuffleOptions: true, random: r2 });
  assertEq(fromPaper.map(q => q.type === 'match' ? Object.assign({}, q, { choices: q.choices.slice().sort() }) : q),
    fromBank.map(q => q.type === 'match' ? Object.assign({}, q, { choices: q.choices.slice().sort() }) : q), 'the same as attemptQuestions on the bank');
  const leaky = J(paper.questions); leaky[1].correctAnswer = 0; leaky[4].pairs = [{ prompt: 'p', answer: 'a' }];
  assert(X.attemptQuestionsFromPaper(leaky, {}).every(q => !('correctAnswer' in q) && !('pairs' in q)), 'a key that slipped into a paper never reaches the attempt');
}

/* ------------------------------------------------------- marking */
console.log('Marked from the key: what the trainee\'s copy claims changes nothing');
{
  const a = attempt();
  const r = mark(a);
  assert(!r.error && r.result, 'an attempt is marked');
  // Today's marking of the same answers, in the paper's own order, against the exam itself.
  const order = exam.questionData.map(q => q.id);
  const today = X.mark(X.publicQuestions(exam.questionData), order.map(id => a.answers[a.questions.findIndex(q => q.id === id)]), exam.questionData);
  assertEq([r.result.totalPoints, r.result.earnedPoints, r.result.correctCount, r.result.pendingCount],
    [today.totalPoints, today.earnedPoints, today.correctCount, today.manualCount], 'the same marks as today\'s marking of the same answers');
  assertEq([r.result.totalPoints, r.result.earnedPoints, r.result.pendingCount, r.result.needsReview, r.result.passed], [17, 12, 1, true, false],
    'every automatic question right, the exact fill-in too (audit IN-8); the essay waits for staff');
  assertEq(r.result.totalQuestions, 8, 'information items are not questions');
  const base = r.result;

  const pumped = attempt(); pumped.questions.forEach(q => { q.points = 1000; });
  const r2 = mark(pumped).result;
  assertEq([r2.totalPoints, r2.earnedPoints], [base.totalPoints, base.earnedPoints], 'points the copy claims are ignored');
  const retyped = attempt(); retyped.questions.forEach(q => { if (q.type === 'mcq') { q.type = 'shortanswer'; q.text = 'Easy one'; } });
  const r3 = mark(retyped).result;
  const mcqEntry = r3.answers.find(e => e.questionId === 'EX1-Q1');
  assertEq([mcqEntry.type, mcqEntry.questionText, mcqEntry.isCorrect], ['mcq', 'Which gas shields MIG welds?', true], 'so are its type and words');
  const extra = attempt();
  extra.questions.push({ id: 'FAKE-1', type: 'mcq', text: 'Free marks', options: ['a'], points: 50 });
  extra.answers.push(0);
  const r4 = mark(extra).result;
  assertEq([r4.totalPoints, r4.earnedPoints, r4.answers.some(e => e.questionId === 'FAKE-1'), r4.ignoredQuestionIds], [17, 12, false, ['FAKE-1']],
    'a question the key does not have is ignored — noted, never marked');
  const dropped = attempt();
  const hard = dropped.questions.findIndex(q => q.id === 'EX1-Q8');
  dropped.questions.splice(hard, 1); dropped.answers.splice(hard, 1);
  const r5 = mark(dropped).result;
  assertEq([r5.totalPoints, r5.answers.find(e => e.questionId === 'EX1-Q8').studentAnswer], [17, null], 'a question left out of the copy still counts, unanswered');
  const twice = attempt();
  twice.questions.push(J(twice.questions[2])); twice.answers.push(rightAnswer(twice.questions[2]));
  assertEq(mark(twice).result.totalPoints, 17, 'a question listed twice counts once');
  const wrong = attempt();
  const mi = wrong.questions.findIndex(q => q.type === 'mcq');
  wrong.answers[mi] = 1;
  const e = mark(wrong).result.answers.find(x => x.questionId === 'EX1-Q1');
  assertEq([e.isCorrect, e.optionOrder, e.points], [false, wrong.questions[mi].optionOrder, 2], 'an answer is its ORIGINAL option; the order is kept for the review only');
  const badOrder = attempt(); badOrder.questions[mi].optionOrder = [7, 7, 7];
  assert(!('optionOrder' in mark(badOrder).result.answers.find(x => x.questionId === 'EX1-Q1')), 'an option order that is not one is not kept');
  assertEq(mark(attempt({ examId: 'EX2' })).error, 'wrong-exam', 'an attempt is marked only against its own exam\'s key');
  assertEq(G.markAttempt(attempt(), { format: 'x' }, NOW, { crypto }).error, 'no-key', 'never without a key file');
  assertEq(G.markAttempt(attempt(), Object.assign(J(keyFile), { version: 2 }), NOW, { crypto }).error, 'newer-version', 'nor a key file newer than it reads');
}

/* --------------------------------------------- one result per attempt */
console.log('One attempt makes one result, whichever device submits it');
{
  const a = attempt();
  const r1 = mark(a, { receivedAt: NOW }), r2 = mark(a, { receivedAt: NOW + 900 });
  const want = 'RES-G-' + crypto.sha256Hex('ATT-A1').slice(0, 16);
  assertEq([r1.result.id, r2.result.id], [want, want], 'the result\'s id is RES-G-<sha256(attempt id)>, the same from two devices');
  assertEq(mark(attempt({ id: 'ATT-A2' })).result.id, 'RES-G-' + crypto.sha256Hex('ATT-A2').slice(0, 16), 'another attempt, another id');
  const both = [r2.result, r1.result].map(J);
  X.oneResultPerAttempt(both);
  assertEq(both.map(r => r.submittedAt), [iso(NOW)], 'a device holding both keeps the first submission');
  assertEq([r1.result.attemptId, r1.result.markedBy, r1.result.receivedAt, r1.result.startedAt],
    ['ATT-A1', 'gate', iso(NOW), iso(NOW - 40 * MIN)], 'it names its attempt, says the gate marked it, and when');
  assertEq(r1.retired, X.retireAttempt(a, want, iso(NOW)), 'the attempt is retired by a small record naming the result');
  assertEq([r1.file.format, r1.file.version, r1.file.accountId, r1.file.studentId, r1.file.attemptId, r1.file.keyHash],
    ['cestis-gate-result', 1, T.acct.id, T.stu.id, 'ATT-A1', keyFile.hash], 'the result file (CESTISINBOX.result.<attempt>.json)');
  assertEq(r1.result.timeTaken, 40 * 60, 'time taken from the start to the gatekeeper\'s receipt');
  assertEq(mark(a, { receivedAt: NOW + 50 * MIN }).result.timeTaken, 70 * 60, 'never past the deadline');
  assert(mark(a, { auto: true }).result.autoSubmitted === true, 'a submission by the clock says so');
}

/* ------------------------------------------------------------- late */
console.log('Late answers are kept and flagged, never refused');
{
  const end = Date.parse('2026-11-02T15:30:00Z');
  const at = (ms, o) => mark(attempt(), Object.assign({ receivedAt: ms }, o || {})).result;
  assert(!at(end + 60000).late, 'within two minutes of the window\'s end: on time');
  const late = at(end + 3 * 60000);
  assert(late.late === true && late.answers.length === 8, 'after: kept, marked, and flagged late');
  assert(!at(NOW, { firstSeen: NOW - 60 * MIN }).late, 'inside the window and inside its own time: on time');
  assert(at(NOW, { firstSeen: NOW - 93 * MIN }).late === true, 'past the time the gatekeeper first saw it plus its duration plus two minutes: late');
}

/* ------------------------------------------------------- redaction */
console.log('The right answers: only when the release allows, by the gatekeeper\'s clock');
{
  const r = mark(attempt()).result;
  const has = res => res.answers.filter(e => 'correctAnswer' in e).length;
  assertEq(has(r), 8, 'the marked result itself carries the right answers (staff see them)');
  const during = G.redactResult(r, exam, NOW, '-05:00');
  assertEq([has(during), during.answers.filter(e => 'tolerance' in e).length], [0, 0], 'while the exam is open: none, and no tolerance');
  assertEq(during.score, r.score, 'the marks themselves are kept');
  assertEq(has(G.redactResult(r, exam, NOW + DAY, '-05:00')), 8, 'once it has closed (the default release): shown');
  assertEq(has(G.redactResult(r, Object.assign({}, exam, { answersRelease: 'released' }), NOW, '-05:00')), 8, 'released by staff: shown at once');
  assertEq(has(G.redactResult(r, Object.assign({}, exam, { answersRelease: 'withheld' }), NOW + 300 * DAY, '-05:00')), 0, 'withheld: never');
  assertEq(has(G.redactResult(r, null, NOW + 300 * DAY, '-05:00')), 0, 'with no exam to ask: never');
  assertEq(has(r), 8, 'and the result itself is never changed');
}

/* A test marked on a lab PC reaches the trainee's device only in their slice,
   and every result in a slice has its right answers taken out. The online
   gatekeeper answered `review` from that copy: "released", and no right
   answers — where the Centre's server, holding the result whole, showed
   them. fillAnswers puts them back from the key file, as marking shows them. */
console.log('A result that came in the slice: the right answers put back from the key, then released or not');
{
  const sliceOf = acct => G.buildSlice(C.store, acct, NOW).slice;
  const old = C.examById['EX1-OLD'], oldKey = G.buildKey(old, '-05:00');
  const stored = C.store.voctrain_examResults.find(r => r.id === 'RES-' + T.acct.id);
  const copy = sliceOf(T.acct.id).data.voctrain_examResults.find(r => r.id === stored.id);
  const has = res => res.answers.filter(e => 'correctAnswer' in e).length;
  assertEq(has(copy), 0, '(the slice\'s copy has no right answers)');
  const filled = G.fillAnswers(copy, oldKey);
  assertEq(filled.answers.map(a => [a.questionId, a.correctAnswer, a.tolerance]), stored.answers.map(a => [a.questionId, a.correctAnswer, a.tolerance]),
    'every answer gets the right answer marking gave it (the tolerance too)');
  assertEq(G.redactResult(filled, old, NOW, '-05:00'), G.redactResult(stored, old, NOW, '-05:00'),
    'released (long closed): what the trainee sees is what the Centre\'s whole copy shows, field for field');
  assertEq(has(copy), 0, 'the slice\'s copy itself is not changed');
  const open = C.examById.EX1, aq = X.attemptQuestions(open.questionData, {});
  const lab = X.mark(aq, aq.map(q => (q.type === 'info' ? null : rightAnswer(q))), open.questionData);
  const labResult = { id: 'RES-LAB', examId: 'EX1', studentId: T.stu.id, answers: lab.gradedResults, score: 90 };
  const labCopy = G.redactResult(labResult, null, NOW);
  assertEq(G.fillAnswers(labCopy, keyFile).answers, labResult.answers, 'a lab PC\'s marking of the open exam: put back exactly');
  assertEq(has(G.redactResult(G.fillAnswers(labCopy, keyFile), open, NOW, '-05:00')), 0, 'and while the exam is open, taken out again: none shown');
  assertEq(has(G.redactResult(G.fillAnswers(labCopy, keyFile), Object.assign({}, open, { answersRelease: 'withheld' }), NOW + 300 * DAY, '-05:00')), 0,
    'withheld: never');
  const gateMarked = mark(attempt()).result;
  assertEq(G.fillAnswers(gateMarked, keyFile), gateMarked, 'a result that has its right answers keeps them as they are');
  assertEq(G.fillAnswers(copy, keyFile), copy, 'the key file of another exam fills nothing');
  assertEq(G.fillAnswers(copy, G.buildPaper(old, NOW)), copy, 'nor does a paper (it has no key)');
  assertEq([G.fillAnswers(copy, null), G.fillAnswers(null, oldKey)], [copy, null], 'nor nothing');
  const fewer = J(oldKey);
  fewer.exam.questionData = fewer.exam.questionData.filter(q => q.type !== 'mcq');
  const part = G.fillAnswers(copy, fewer);
  assertEq([has(part), 'correctAnswer' in part.answers.find(a => a.type === 'mcq')], [7, false], 'a question the key no longer has stays without');
}

/* ---------------------------------------------------------- resume */
console.log('An attempt spread over several devices resumes as one');
{
  const base = attempt();
  const n = base.questions.length;
  const laneA = { records: { voctrain_examAttempts: [Object.assign(J(base), { answers: base.answers.map((x, i) => (i === 1 ? x : null)),
    answeredAt: base.answers.map((x, i) => (i === 1 ? NOW - 20 * MIN : 0)), deadline: NOW + 30 * MIN })] } };
  const laneB = { records: { voctrain_examAttempts: [Object.assign(J(base), { answers: base.answers.map((x, i) => (i === 2 ? x : i === 1 ? 'stale' : null)),
    answeredAt: base.answers.map((x, i) => (i === 2 ? NOW - 10 * MIN : i === 1 ? NOW - 30 * MIN : 0)), deadline: NOW + 45 * MIN })] } };
  const r = G.resumeAttempt({ lanes: [laneA, laneB] }, T.stu.id, 'EX1');
  assertEq(r.state, 'attempt', 'it is in progress');
  assertEq([r.attempt.answers[1], r.attempt.answers[2], r.attempt.answers.filter(x => x != null).length],
    [base.answers[1], base.answers[2], 2], 'with the newest answer to each question from either device');
  assertEq(r.attempt.deadline, NOW + 30 * MIN, 'and the first deadline set');
  // A second device that started its own attempt before it heard of the first: one attempt.
  const second = Object.assign(J(base), { id: 'ATT-A9', startTime: NOW - 35 * MIN, answers: base.answers.map((x, i) => (i === 3 ? x : null)),
    answeredAt: base.answers.map((x, i) => (i === 3 ? NOW - 2 * MIN : 0)) });
  const r2 = G.resumeAttempt({ lanes: [laneA, { records: { voctrain_examAttempts: [second] } }] }, T.stu.id, 'EX1');
  assertEq([r2.attempt.id, r2.ids.slice().sort(), r2.attempt.answers[3]], ['ATT-A1', ['ATT-A1', 'ATT-A9'], base.answers[3]], 'two started on two devices are the one started first');
  assertEq(G.resumeAttempt({ lanes: [laneA], slice: { data: { voctrain_examAttempts: [second], voctrain_examResults: [] } } }, T.stu.id, 'EX1').ids.length, 2,
    'the slice\'s copy counts too');
  const marked = mark(base);
  const done = G.resumeAttempt({ lanes: [laneA, laneB], results: [marked.file] }, T.stu.id, 'EX1');
  assertEq([done.state, done.result.id], ['result', marked.result.id], 'a result ends it: the trainee sees their result');
  const gone = G.resumeAttempt({ lanes: [laneA, { records: { voctrain_examAttempts: [marked.retired] } }] }, T.stu.id, 'EX1');
  assertEq(gone.state, 'retired', 'submitted on another device, result not here yet: "submitted on another device"');
  const older = G.resumeAttempt({ slice: { data: { voctrain_examAttempts: [], voctrain_examResults: [{ id: 'RES-OLD', examId: 'EX1', studentId: T.stu.id, submittedAt: iso(NOW - MIN) }] } },
    lanes: [laneA] }, T.stu.id, 'EX1');
  assertEq(older.state, 'result', 'a result made the old way, on a lab PC, ends it too');
  assertEq(G.resumeAttempt({ lanes: [laneA, laneB] }, C.trainees[3].stu.id, 'EX1').state, 'none', 'another trainee has nothing here');
  assertEq(G.resumeAttempt({}, T.stu.id, 'EX1').state, 'none', 'and with nothing at all: none');
  assertEq(n, 9, '(the paper has nine items)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
