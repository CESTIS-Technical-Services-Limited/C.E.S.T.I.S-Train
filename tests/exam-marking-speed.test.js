/* Marking a test takes minutes, not a quarter of an hour (audit IN-8).
   Run: node tests/exam-marking-speed.test.js

   What used to slow it down: every fill-in waited for the instructor, even
   the 32 of 40 that were the expected word exactly; the marking panel closed
   after each trainee, so marking 20 trainees meant finding and opening the
   next one 20 times; and there was no way to mark one question across the
   whole class.

   Pinned here:
   - CESTISCore.exams.mark: an exact fill-in (case and surrounding spaces
     aside) is marked right away; anything else still waits for a person;
   - CESTISCore.exams.applyManualMarks / pendingForQuestion / questionsAwaiting
     / nextAwaiting: the rules the panel and "Mark by question" share;
   - the dashboard's own submitGrading(true) ("Save & next") and
     openQuestionMarking / saveQuestionMarking, read from index.html. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const E = Core.exams;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

console.log('Exact fill-ins are marked at once; anything else waits');
{
  const qd = [
    { id: 'F1', type: 'fill', text: 'Cylinders are stored ____', points: 1, correctAnswer: 'upright' },
    { id: 'F2', type: 'fill', text: 'Acetylene hose colour ____', points: 2, correctAnswer: 'Red' },
    { id: 'F3', type: 'fill', text: 'No key yet ____', points: 1, correctAnswer: '' },
    { id: 'M1', type: 'mcq', text: 'x', points: 1, options: ['a', 'b'], correctAnswer: 1 }
  ];
  const pub = E.publicQuestions(qd);
  const m = E.mark(pub, ['  UPRIGHT ', 'red', 'anything', 1], qd);
  const [f1, f2, f3] = m.gradedResults;
  assert(f1.graded && !f1.needsManualGrade && f1.earnedPoints === 1 && f1.gradedBy === 'auto' && f1.autoMatch === true, 'the expected word, in capitals with spaces around it, is marked right');
  assert(f2.graded && f2.earnedPoints === 2 && f2.isCorrect === true, 'a two-point fill-in earns both points');
  assert(f3.needsManualGrade && !f3.graded, 'a fill-in with no expected answer still waits');
  assert(m.manualCount === 1 && m.earnedPoints === 4 && m.correctCount === 3, 'only that one is left for a person (' + JSON.stringify([m.manualCount, m.earnedPoints, m.correctCount]) + ')');
  const w = E.mark(pub, ['standing', 'red hose', 'x', 0], qd);
  assert(w.gradedResults[0].needsManualGrade && w.gradedResults[0].autoMatch === false && w.gradedResults[1].needsManualGrade, 'a different word waits for a person (it may still be right: "red hose")');
  assert(w.gradedResults[0].earnedPoints === 0 && w.gradedResults[0].awardedPoints === null, 'and earns nothing until marked');
  const all = E.mark(E.publicQuestions(qd.slice(0, 2).concat(qd[3])), ['upright', 'Red', 1], qd);
  assert(all.manualCount === 0, 'a test whose fill-ins were all exact is final at once (no "Awaiting marking")');
}

console.log('A person\'s marks: held to the question, the rest left waiting, totals worked out again');
function result() {
  return { id: 'R1', examId: 'EX', studentId: 'S1', studentName: 'Tameka Richards', totalPoints: 12, earnedPoints: 2, score: 17, passed: false, needsReview: true, pendingCount: 2,
    answers: [
      { questionId: 'Q1', type: 'mcq', points: 2, earnedPoints: 2, isCorrect: true, graded: true, needsManualGrade: false },
      { questionId: 'Q2', type: 'short', points: 5, earnedPoints: 0, graded: false, needsManualGrade: true },
      { questionId: 'Q3', type: 'short', points: 5, earnedPoints: 0, graded: false, needsManualGrade: true }
    ] };
}
{
  const r = result();
  let res = E.applyManualMarks(r, { 1: { points: '3.5', feedback: '  Name the regulators too. ' } }, { by: 'Ian Barrett', at: '2026-10-29T15:00:00.000Z', passMark: 60 });
  assert(res.applied === 1 && res.pendingLeft === 1 && !res.final, 'one answer marked, one still waiting');
  assert(r.answers[1].earnedPoints === 3.5 && r.answers[1].feedback === 'Name the regulators too.' && r.answers[1].gradedBy === 'Ian Barrett', 'a half point is kept, and the feedback with who marked it');
  assert(r.needsReview === true && r.pendingCount === 1 && !r.markedBy, 'the result is still provisional');
  res = E.applyManualMarks(r, { 2: { points: 9 } }, { by: 'Ian Barrett', passMark: 60 });
  assert(r.answers[2].earnedPoints === 5, 'a mark above the question\'s points is held to its 5');
  assert(res.final && r.reviewComplete === true && r.score === 88 && r.passed === true && r.markedBy === 'Ian Barrett', 'now final: 10.5 of 12, 88%, passed (' + r.score + ')');
  const before = JSON.stringify(r);
  E.applyManualMarks(r, { 1: { points: 0 } }, { by: 'Someone else' });
  assert(JSON.stringify(r).replace(/"markedAt":"[^"]*"/, '') === before.replace(/"markedAt":"[^"]*"/, ''), 'an answer already marked is never changed here');
  const r2 = result();
  E.applyManualMarks(r2, { 1: { points: '' } }, {});
  assert(!r2.answers[1].graded, 'a blank mark leaves the answer waiting');
}

console.log('One question across the class; the next trainee waiting');
{
  const exam = { id: 'EX', questionData: [{ id: 'Q1', type: 'mcq', text: 'x', points: 2 }, { id: 'Q2', type: 'short', text: 'Describe shutting down', points: 5 }, { id: 'Q3', type: 'short', text: 'Fumes', points: 5 }] };
  const a = result(), b = result(), c = result(), old = result();
  b.id = 'R2'; b.studentId = 'S2'; b.answers = [b.answers[2], b.answers[0], b.answers[1]];   // a shuffled paper
  c.id = 'R3'; c.studentId = 'S3'; E.applyManualMarks(c, { 1: { points: 5 }, 2: { points: 5 } }, {});
  old.id = 'R4'; old.studentId = 'S4'; old.answers.forEach(x => { delete x.questionId; });         // an older result: by place
  const arch = result(); arch.id = 'R5'; arch.archived = true;
  const list = [a, b, c, old, arch];
  const q2 = E.pendingForQuestion(list, 'Q2', 1);
  assert(q2.map(x => x.resultId + ':' + x.index).join() === 'R1:1,R2:2,R4:1', 'Q2 waits for R1 (place 2), R2 (shuffled to place 3) and the older R4 by its place — not the marked or the archived (' + q2.map(x => x.resultId + ':' + x.index).join() + ')');
  const aw = E.questionsAwaiting(exam, list);
  assert(aw.map(x => x.number + '=' + x.waiting).join() === '2=3,3=3', 'questions waiting: Q2 three answers, Q3 three');
  assert(E.nextAwaiting(list, 'R1').id === 'R2' && E.nextAwaiting(list, 'R2').id === 'R4', 'after R1 comes R2, then R4 (R3 is marked)');
  assert(E.nextAwaiting(list, 'R4').id === 'R1', 'after the last, back to the first still waiting');
  assert(E.nextAwaiting([a], 'R1') === null, 'nothing else waiting: no next');
}

console.log('The dashboard: Save & next, and Mark by question (index.html)');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const m = new RegExp('function ' + name + '\\(').exec(INDEX);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = INDEX.indexOf('{', m.index); i < INDEX.length; i++) { if (INDEX[i] === '{') d++; else if (INDEX[i] === '}') { d--; if (!d) return INDEX.slice(m.index, i + 1); } }
  throw new Error(name);
}
function makePage() {
  const byId = new Map();
  function el(tag) {
    const e = { tagName: tag, style: {}, children: [], _html: '', textContent: '', value: '',
      appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      remove() { if (this.id && byId.get(this.id) === this) byId.delete(this.id); }, setAttribute() {}, getAttribute() { return null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(h) {
      this._html = h; const re = /id="([^"]+)"([^>]*)>/g; let mm;
      while ((mm = re.exec(h))) { const ch = el('x'); ch.id = mm[1]; const v = /value="([^"]*)"/.exec(mm[2]); if (v) ch.value = v[1]; byId.set(ch.id, ch); }
    } });
    return e;
  }
  return { document: { createElement: el, body: el('body'), getElementById: id => byId.get(id) || null, querySelectorAll: () => [] } };
}
function setup() {
  const page = makePage();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ctx = {
    document: page.document, console, JSON, Math, Date, String, Number, parseInt, isNaN,
    alert: m => { throw new Error('alert: ' + m); }, escapeHtml: esc, escapeAttr: esc, jsArg: s => JSON.stringify(String(s)),
    saves: 0, toasts: [], notices: [], views: 0,
    saveState() { ctx.saves++; }, showToast(m) { ctx.toasts.push(m); },
    addNotification(t) { ctx.notices.push(t); }, addNotificationForUser() {}, examTraineeUserId() { return null; }, viewExamResults() { ctx.views++; },
    CESTISCore: Core, currentInstructor: { id: 'INS-1', name: 'Ian Barrett' }, currentRole: 'instructor', currentLoggedInUser: { id: 'USR-INS-IAN' },
    exams: [{ id: 'EX', title: 'Unit 5 Theory Test', passMark: 60, status: 'completed', questionData: [{ id: 'Q1', type: 'mcq', text: 'x', points: 2 }, { id: 'Q2', type: 'short', text: 'Describe shutting down', points: 5, correctAnswer: 'Close the valves' }, { id: 'Q3', type: 'short', text: 'Fumes', points: 5 }] }],
    students: [{ id: 'S1', name: 'Tameka Richards' }, { id: 'S2', name: 'Kemar Johnson' }, { id: 'S3', name: 'Shanice Brown' }],
    examResults: ['S1', 'S2', 'S3'].map((sid, i) => Object.assign(result(), { id: 'R' + (i + 1), studentId: sid, studentName: ['Tameka Richards', 'Kemar Johnson', 'Shanice Brown'][i] }))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var gradingResultId = null; var questionMarking = null;\n' +
    ['openGradingPanel', 'closeGradingPanel', 'setGradePoints', 'updateGradingPreview', 'submitGrading', 'notifyMarkingAudience', 'examTypeLabel',
     'examGraderName', 'examRecordManualMarks', 'examMarkingGuideHtml', 'openQuestionMarking', 'qmSet', 'saveQuestionMarking'].map(fn).join('\n'), ctx);
  return ctx;
}
{
  const ctx = setup();
  vm.runInContext('openGradingPanel("R1")', ctx);
  assert(!!ctx.document.getElementById('gpSaveNext'), 'with more trainees waiting, the panel offers "Save & next"');
  vm.runInContext('setGradePoints(1, 4); setGradePoints(2, 3)', ctx);
  vm.runInContext('submitGrading(true)', ctx);
  assert(ctx.examResults[0].reviewComplete === true && ctx.examResults[0].score === 75, 'Tameka\'s two essays are marked: 9 of 12, 75%');
  assert(vm.runInContext('gradingResultId', ctx) === 'R2' && !!ctx.document.getElementById('gradingPanel'), 'and Kemar\'s panel is open next, with no search for him');
  assert(ctx.saves === 1 && ctx.notices.filter(t => /Grading completed: Tameka/.test(t)).length === 1, 'saved once, with the marking notice as before');
}
{
  const ctx = setup();
  vm.runInContext('openQuestionMarking("EX")', ctx);
  assert(vm.runInContext('questionMarking && questionMarking.questionId', ctx) === 'Q2' && vm.runInContext('questionMarking.entries.length', ctx) === 3, 'Mark by question opens Q2 with all three trainees\' answers');
  ctx.document.getElementById('qmPoints-0').value = '5';
  ctx.document.getElementById('qmPoints-1').value = '2';
  ctx.document.getElementById('qmFeedback-1').value = 'Bleed the lines first.';
  vm.runInContext('saveQuestionMarking()', ctx);
  assert(ctx.examResults[0].answers[1].earnedPoints === 5 && ctx.examResults[1].answers[1].earnedPoints === 2 && ctx.examResults[1].answers[1].feedback === 'Bleed the lines first.', 'one Save marks Q2 for two trainees, feedback included');
  assert(!ctx.examResults[2].answers[1].graded, 'the answer left blank stays waiting');
  assert(ctx.saves === 1 && /2 answers marked, 1 left waiting/.test(ctx.toasts.join('|')), 'saved once, and it says so (' + ctx.toasts.join('|') + ')');
  assert(vm.runInContext('questionMarking && questionMarking.questionId', ctx) === 'Q3', 'and the next question waiting (Q3) opens');
}
assert(/id="examMarkByQuestionBtn" onclick="openQuestionMarking\('\+jsArg\(e\.id\)\+'\)"/.test(fn('viewExamResults')), 'the results page offers "Mark by question" while answers wait');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
