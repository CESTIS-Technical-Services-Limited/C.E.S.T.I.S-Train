/* An instructor can mark a short-answer (essay) question.

   openGradingPanel() noted which result it was opening, then called
   closeGradingPanel() "to remove any panel already open" — and closing a panel
   forgets its result. Every grading panel therefore opened with no result
   behind it: the preview never moved, "Save Grades" returned without doing
   anything, and no short answer could be marked at all. Every exam with an
   essay stayed "Pending instructor review" for good, which kept the trainee's
   transcript at "Awaiting marking" and their certificate out of reach. Found by
   the end-to-end flow test (tests/browser/lms-flows.js).

   The real openGradingPanel(), closeGradingPanel(), updateGradingPreview(),
   setGradePoints() and submitGrading() are taken from index.html and run
   against a small stand-in for the page.

   Run: node tests/exam-grading-panel.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* A page with just enough DOM: elements by id, and the inputs the panel's
   markup declares (id="gradePoints-N" value="..."), as a browser would make. */
function makePage() {
  const byId = new Map();
  function el(tag) {
    const e = { tagName: tag, style: {}, children: [], _html: '', textContent: '', value: '',
      appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
      remove() { if (this.id && byId.get(this.id) === this) byId.delete(this.id); },
      setAttribute() {}, getAttribute() { return null; } };
    Object.defineProperty(e, 'innerHTML', {
      get() { return this._html; },
      set(h) {
        this._html = h;
        const re = /id="([^"]+)"([^>]*)>/g;
        let m;
        while ((m = re.exec(h))) {
          const child = el('x');
          child.id = m[1];
          const v = /value="([^"]*)"/.exec(m[2]);
          if (v) child.value = v[1];
          byId.set(child.id, child);
        }
      }
    });
    return e;
  }
  const body = el('body');
  return {
    byId,
    document: { createElement: el, body, getElementById: id => byId.get(id) || null, querySelectorAll: () => [] }
  };
}

function setup() {
  const page = makePage();
  const ctx = {
    document: page.document, console, JSON, Math, Date, String, Number, parseInt, isNaN,
    alert: m => { throw new Error('alert: ' + m); },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    jsArg: s => JSON.stringify(String(s)),
    saves: 0, toasts: [],
    saveState() { ctx.saves++; }, showToast(m) { ctx.toasts.push(m); },
    addNotification() {}, addNotificationForUser() {}, examTraineeUserId() { return null; }, viewExamResults() {},
    CESTISCore: { exams: { passRateOf: () => null } },
    currentInstructor: { id: 'INS-1', name: 'Ian Instructor' },
    exams: [{ id: 'EX-1', title: 'Unit 1 Test', passMark: 60, status: 'active' }],
    students: [{ id: 'S-1', name: 'Ama Mensah', score: '' }],
    examResults: [{
      id: 'RES-1', examId: 'EX-1', studentId: 'S-1', studentName: 'Ama Mensah',
      score: 33, earnedPoints: 2, totalPoints: 6, correctCount: 2, totalQuestions: 3,
      passed: false, needsReview: true, reviewComplete: false, pendingCount: 1,
      answers: [
        { type: 'mcq', questionText: 'Q1', points: 1, earnedPoints: 1, isCorrect: true, graded: true, needsManualGrade: false },
        { type: 'tf', questionText: 'Q2', points: 1, earnedPoints: 1, isCorrect: true, graded: true, needsManualGrade: false },
        { type: 'short', questionText: 'Explain flushing.', studentAnswer: 'Salt corrodes.', points: 4, earnedPoints: 0, needsManualGrade: true, graded: false, correctAnswer: '' }
      ]
    }]
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('var gradingResultId = null;\n' +
    ['openGradingPanel', 'closeGradingPanel', 'setGradePoints', 'updateGradingPreview', 'submitGrading']
      .map(n => extractFunction(INDEX, n)).join('\n'), ctx);
  return { ctx, page };
}

console.log('Opening the grading panel remembers which result it is for');
{
  const { ctx } = setup();
  vm.runInContext('openGradingPanel("RES-1")', ctx);
  assert(vm.runInContext('gradingResultId', ctx) === 'RES-1', 'the open panel is for RES-1 (it used to be null)');
  assert(!!ctx.document.getElementById('gradingPanel'), 'the panel is on the page');
  vm.runInContext('openGradingPanel("RES-1")', ctx);
  assert(vm.runInContext('gradingResultId', ctx) === 'RES-1', 'opening it again (replacing the old panel) still knows its result');
}

console.log('Awarding points moves the preview, and Save Grades marks the essay');
{
  const { ctx } = setup();
  vm.runInContext('openGradingPanel("RES-1")', ctx);
  vm.runInContext('setGradePoints(2, 3)', ctx);
  const preview = ctx.document.getElementById('gpPreviewScore');
  assert(preview && /83%/.test(preview.textContent), 'the preview shows 5 of 6 points, 83% (got ' + (preview && preview.textContent) + ')');
  ctx.document.getElementById('gradeFeedback-2').value = 'Mention the thermostat.';
  vm.runInContext('submitGrading()', ctx);
  const r = ctx.examResults[0];
  assert(r.answers[2].graded === true && r.answers[2].earnedPoints === 3, 'the short answer is marked 3/4');
  assert(r.score === 83 && r.passed === true, 'the result is now 83% and passed (got ' + r.score + '% / ' + r.passed + ')');
  assert(r.reviewComplete === true && r.needsReview === false && r.pendingCount === 0, 'and is final: nothing left awaiting marking');
  assert(r.markedBy === 'Ian Instructor', 'recorded as marked by the instructor');
  assert(ctx.students[0].score === '83%', 'the trainee\'s score follows the final result');
  assert(ctx.saves === 1, 'and it was saved');
  assert(!ctx.document.getElementById('gradingPanel') && vm.runInContext('gradingResultId', ctx) === null, 'the panel closes afterwards');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
