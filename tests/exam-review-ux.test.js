/* Four small things the end-to-end flow test tripped over.

   What happened:
     - The instructor's Gradebook card "Exam Submissions Needing Review" was
       written into the page once, at sign-in. Submissions that arrived
       afterwards never appeared on it, and ones just marked stayed listed,
       until the instructor signed in again.
     - My Exams went on showing the last result a trainee had reviewed — over
       the list, on every later visit — until they found "Back to Exams".
     - A multiple-choice answer on the review read "A. (selected)": the letter
       and nothing about what the trainee had actually chosen.
     - index.html carried <meta http-equiv="X-Frame-Options">. Browsers ignore
       that header in a meta tag and say so as a console error on every page
       load; it protected nothing. The flow test had to whitelist the error.

   Pinned here with the real functions extracted from index.html (and
   CESTISCore.exams.optionLabel): the card is redrawn from the current results
   and is on the refresh list; going to My Exams puts a reviewed result away
   (never an exam being sat); the review names the option chosen and the
   correct one; the meta tag is gone from every page and the flow test no
   longer excuses it.

   Run: node tests/exam-review-ux.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

function page(globals) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, style: { display: 'none' }, innerHTML: '' });
  const sb = Object.assign({
    CESTISCore: Core, console: { log() {}, warn() {} }, Date, Math, JSON, Object, Array, String, Number, RegExp,
    document: { getElementById: el }, renders: 0,
    exams: [], examResults: [], students: [], currentRole: 'student', currentInstructor: null,
    instructorCourseMatch: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
  }, globals || {});
  sb.renderStudentExams = () => { sb.renders++; };
  vm.createContext(sb);
  vm.runInContext(['escapeHtml', 'escapeAttr', 'jsArg', 'examCentreOffset', 'showExamResult', 'studentExamsShowList',
    'instructorExamReviewQueueHtml', 'renderInstructorExamReviewQueue'].map(n => extractFunction(INDEX, n)).join('\n\n'), sb);
  sb.el = el;
  return sb;
}

/* ---------- 1. The option chosen, in words ---------- */
console.log('A multiple-choice answer reads as the option chosen');
const Q = { id: 'q1', type: 'mcq', text: 'Which colour is the acetylene hose?', options: ['Blue', 'Red', 'Green', 'Black'], correctAnswer: 1 };
assertEq(Core.exams.optionLabel(Q, 0), 'A. Blue', 'letter and words');
assertEq(Core.exams.optionLabel(Q, 3), 'D. Black', 'any option');
assertEq(Core.exams.optionLabel({ options: [] }, 2), 'C', 'the letter alone when the words are not to hand');
assertEq(Core.exams.optionLabel(null, 1), 'B', 'or there is no question at all');
assertEq(Core.exams.optionLabel(Q, null), '', 'no answer is no label');
assertEq(Core.exams.optionLabel(Q, -1) + Core.exams.optionLabel(Q, 1.5) + Core.exams.optionLabel(Q, '1'), '', 'and nothing that is not an option index');

const exam = { id: 'E1', title: 'Gas safety', passMark: 60, answersRelease: 'released', course: 'Welding',
  questionData: [Q, { id: 'q2', type: 'mcq', text: 'Which <b>gas</b>?', options: ['Oxygen <script>', 'Argon'], correctAnswer: 1 }] };
const result = { id: 'R1', examId: 'E1', studentId: 'S1', score: 0, earnedPoints: 0, totalPoints: 2, correctCount: 0, totalQuestions: 2,
  passed: false, timeTaken: 75, answers: [
    { questionId: 'q1', type: 'mcq', questionText: Q.text, studentAnswer: 0, correctAnswer: 1, isCorrect: false, graded: true, needsManualGrade: false, points: 1, earnedPoints: 0 },
    { questionId: 'q2', type: 'mcq', questionText: 'Which <b>gas</b>?', studentAnswer: 0, correctAnswer: 1, isCorrect: false, graded: true, needsManualGrade: false, points: 1, earnedPoints: 0 }
  ] };
let p = page();
p.showExamResult(result, exam);
let html = p.el('studentExamResultView').innerHTML;
assert(/Your answer: <strong>A\. Blue<\/strong>/.test(html), 'her answer reads "A. Blue"');
assert(html.indexOf('(selected)') === -1, 'never "A. (selected)"');
assert(/Correct answer: B\. Red/.test(html), 'and, released, the correct answer reads "B. Red"');
assert(html.indexOf('Oxygen &lt;script&gt;') !== -1 && html.indexOf('<script>') === -1, 'an option\'s words are escaped');

// An exam from before questions carried ids: matched by place while the wording agrees.
const legacy = { id: 'E2', passMark: 60, answersRelease: 'released', questionData: [{ type: 'mcq', text: 'Old question', options: ['Yes', 'No'], correctAnswer: 0 }] };
const legacyResult = Object.assign({}, result, { examId: 'E2', answers: [
  { type: 'mcq', questionText: 'Old question', studentAnswer: 1, correctAnswer: 0, isCorrect: false, graded: true, needsManualGrade: false, points: 1, earnedPoints: 0 }] });
p = page();
p.showExamResult(legacyResult, legacy);
assert(/Your answer: <strong>B\. No<\/strong>/.test(p.el('studentExamResultView').innerHTML), 'an older exam reads the same, by the question\'s place');
legacy.questionData[0].text = 'A different question since';
p.showExamResult(legacyResult, legacy);
assert(/Your answer: <strong>B<\/strong>/.test(p.el('studentExamResultView').innerHTML), 'but never borrows the words of a question that has changed');

/* ---------- 2. My Exams opens on the list ---------- */
console.log('Going to My Exams puts the last reviewed result away');
p = page();
p.showExamResult(result, exam);
p.el('studentExamListView').style.display = 'none';
assertEq(p.el('studentExamResultView').style.display, 'block', 'a result is on screen');
assertEq(p.studentExamsShowList(), true, 'going to My Exams puts it away');
assertEq(p.el('studentExamResultView').style.display, 'none', 'the result is hidden');
assertEq(p.el('studentExamListView').style.display, 'block', 'the list is shown');
assertEq(p.renders, 1, 'and redrawn');
p.el('studentExamTakingView').style.display = 'block';
p.el('studentExamListView').style.display = 'none';
assertEq(p.studentExamsShowList(), false, 'an exam being sat is never closed by the menu');
assertEq(p.el('studentExamTakingView').style.display, 'block', 'it stays open');
const showPage = extractFunction(INDEX, 'showPage');
assert(/if\(pageId === 's-exams'\) \{ try \{ studentExamsShowList\(\); \} catch\(e\) \{\} \}/.test(showPage), 'showPage does this on the way into My Exams');

/* ---------- 3. The Gradebook card follows the results ---------- */
console.log('The Gradebook\'s review card follows the results');
const ins = { name: 'Ian Instructor', course: 'Welding' };
const pending = { id: 'R9', examId: 'E1', studentId: 'S1', score: 50, answers: [{ type: 'short', needsManualGrade: true, graded: false }] };
p = page({ currentRole: 'instructor', currentInstructor: ins, exams: [exam], students: [{ id: 'S1', name: 'Shanté O\'Neil' }] });
assertEq(p.instructorExamReviewQueueHtml(ins), '', 'nothing to review: no card');
p.renderInstructorExamReviewQueue();
assertEq(p.el('iExamReviewQueue').innerHTML, '', 'and none drawn');
p.examResults.push(pending);
p.renderInstructorExamReviewQueue();
html = p.el('iExamReviewQueue').innerHTML;
assert(/Exam Submissions Needing Review/.test(html) && /1 pending/.test(html), 'a submission arriving after sign-in appears on the card');
assert(html.indexOf('Shanté O&#39;Neil') !== -1 || html.indexOf('Shanté O&#x27;Neil') !== -1 || html.indexOf("Shanté O'Neil") !== -1, 'with the trainee\'s name');
pending.answers[0].graded = true;
p.renderInstructorExamReviewQueue();
assertEq(p.el('iExamReviewQueue').innerHTML, '', 'and leaves it once marked');
const content = extractFunction(INDEX, 'refreshContentDependentViews');
assert(content.indexOf("'renderInstructorExamReviewQueue'") !== -1, 'the card is redrawn with every view that shows results');
const build = extractFunction(INDEX, 'buildInstructorPages');
assert(build.indexOf('<div id="iExamReviewQueue">${instructorExamReviewQueueHtml(ins)}</div>') !== -1, 'the Gradebook draws it through the same function');
p.currentRole = 'student';
pending.answers[0].graded = false;
p.renderInstructorExamReviewQueue();
assertEq(p.el('iExamReviewQueue').innerHTML, '', 'and on anybody else\'s screen nothing is drawn');

/* ---------- 4. No ineffective X-Frame-Options meta ---------- */
console.log('No page carries the X-Frame-Options meta tag browsers reject');
const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f)).concat(
  fs.readdirSync(path.join(ROOT, 'Pages')).filter(f => /\.html$/.test(f)).map(f => 'Pages/' + f));
const carrying = pages.filter(f => /<meta[^>]+http-equiv=["']?X-Frame-Options/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
assertEq(carrying.join(', '), '', 'none of ' + pages.length + ' pages');
const flows = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'lms-flows.js'), 'utf8');
assert(!/X-Frame-Options/.test(flows), 'and the flow test no longer excuses its console error');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
