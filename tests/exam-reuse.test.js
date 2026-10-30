/* Re-using a test: Copy, a builder that keeps its draft on this computer,
   and Import Exam for instructors (audit IN-6).
   Run: node tests/exam-reuse.test.js

   What used to happen: there was no way to re-use last intake's test — 20
   questions typed again, ~22 minutes; a reload, crash or closed tab part-way
   through building lost every question (5 typed, reload: 0); and Import
   Exam was the Administrator's alone.

   Pinned here:
   - CESTISCore.exams.copyExam: a new id, every question and its key with new
     question ids, the settings kept, nothing of the old sitting (results,
     activation, pass rate, an early release), and the original untouched;
   - the draft key is device-only: no snapshot, backup or Centre-network
     mirror carries it (CESTISCore.isSnapshotableKey, cestis-page-cloud.js);
   - the dashboard's own draft functions (index.html): written as the test
     is built, one per person, several side by side, never replaced by an
     empty form, cleared when saved, restored with the questions;
   - Copy on the exam lists; the Import Exam page for an instructor, limited
     to her programme. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

console.log('Copy test: the paper and its keys, nothing of the old sitting');
{
  const qs = [
    { id: 'Q-1', type: 'mcq', text: 'Which hose is red?', points: 1, options: ['Oxygen', 'Acetylene'], correctAnswer: 1 },
    { id: 'Q-2', type: 'multi', text: 'PPE?', points: 2, options: ['Helmet', 'Sandals', 'Gloves'], correctAnswer: [0, 2], allOrNothing: true },
    { id: 'Q-3', type: 'match', text: 'Match', points: 2, pairs: [{ prompt: 'O2', answer: 'Green' }, { prompt: 'C2H2', answer: 'Red' }], distractors: ['Blue'] },
    { id: 'Q-4', type: 'numerical', text: 'psi?', points: 1, correctAnswer: 15, tolerance: 0, unit: 'psi' },
    { id: 'I-1', type: 'info', text: 'Section B' },
    { id: 'Q-5', type: 'short', text: 'Describe', points: 5, correctAnswer: 'Close the valves' }
  ];
  const old = { id: 'EXAM-U5', title: 'Unit 5 Theory Test', course: 'Welding & Fabrication', date: '2026-10-27', time: '09:00', duration: 60, passMark: 60,
    status: 'completed', passRate: '74%', activatedAt: '2026-10-27T14:00:00Z', answersRelease: 'released', questionsPerPage: 5, shuffleOptions: true,
    allowFlag: true, instructions: 'Answer every question.', createdBy: 'admin', createdByRole: 'admin', questionData: qs, questions: 5 };
  const before = JSON.stringify(old);
  const c = Core.exams.copyExam(old, { id: 'EXAM-NEW', title: 'Unit 5 Theory Test — January intake', date: '2027-01-12', time: '10:00', by: 'USR-INS-IAN', byRole: 'instructor', at: '2026-10-29T15:00:00Z' });
  assert(c.id === 'EXAM-NEW' && c.copiedFrom === 'EXAM-U5' && c.title === 'Unit 5 Theory Test — January intake', 'a new id, its own title, and which test it came from');
  assert(c.status === 'upcoming' && !('passRate' in c) && !('activatedAt' in c), 'not active, no pass rate, never activated');
  assert(c.answersRelease === 'after-close', 'answers released early on the old sitting are not released on the new one');
  assert(c.date === '2027-01-12' && c.time === '10:00' && c.duration === 60 && c.passMark === 60 && c.questionsPerPage === 5 && c.shuffleOptions === true && c.instructions === 'Answer every question.', 'the new date, every setting kept');
  assert(c.createdBy === 'USR-INS-IAN' && c.createdByRole === 'instructor', 'the copier\'s own test (she may edit and activate it)');
  assert(c.questionData.length === 6 && c.questions === 5, 'every question copied (5, and the information item)');
  assert(c.questionData.every((q, i) => q.id === 'Q-EXAM-NEW-' + (i + 1)), 'each question with a new id of its own');
  const strip = q => { const x = Object.assign({}, q); delete x.id; return JSON.stringify(x); };
  assert(c.questionData.every((q, i) => strip(q) === strip(qs[i])), 'and every key exactly as it was: options, the multi-answer key, the pairs and distractors, the number and tolerance, the model answer');
  assert(Core.exams.keyProblems(c.questionData).length === 0, 'so the copy has no unkeyed question');
  c.questionData[0].correctAnswer = 0; c.questionData[1].correctAnswer.push(1);
  assert(JSON.stringify(old) === before, 'changing the copy never touches the original');
}

console.log('The builder\'s draft never leaves this computer');
{
  assert(Core.isSnapshotableKey('cestisExamBuilderDraft') === false, 'no snapshot or backup carries it');
  const pc = fs.readFileSync(path.join(__dirname, '..', 'cestis-page-cloud.js'), 'utf8');
  assert(/DEVICE_KEYS = \[[^\]]*'cestisExamBuilderDraft'/.test(pc), 'nor the Centre network\'s whole-store mirror');
}

console.log('The dashboard: drafts written as the test is built (index.html)');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
function page(userId) {
  const ls = page.ls || (page.ls = {});
  const els = {};
  ['examTitle', 'examCourse', 'examDate', 'examTime', 'examDuration', 'examPassMark', 'examShuffle', 'examInstructions', 'examAnswersRelease',
    'examPerPage', 'examShuffleOptions', 'examAllowFlag', 'examCloseDate', 'examCloseTime'].forEach(id => { els[id] = { id, value: '' }; });
  els.examCloseEnabled = { id: 'examCloseEnabled', checked: false };
  els.createExamModal = { id: 'createExamModal', classList: { contains: () => true } };
  const sb = {
    console, JSON, Date, Math, String, Object, Array, confirmAnswer: true,
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    document: { getElementById: id => els[id] || null },
    currentLoggedInUser: { id: userId }, currentInstructor: null, currentRole: 'instructor',
    editingExamId: null, examBuilderQuestions: [], examBuilderNewId: null, examBuilderCopiedFrom: null, exams: [],
    toasts: [], showToast(m) { sb.toasts.push(m); }, confirm: () => sb.confirmAnswer,
    openModal() {}, examCloseToggle() {}, goToExamStep1() { sb.step = 1; }, goToExamStep2() { sb.step = 2; }, examDraftBanner() {}
  };
  vm.createContext(sb);
  vm.runInContext('var EXAM_DRAFT_KEY = "cestisExamBuilderDraft"; var _examDraftTimer = null, _examDraftDebounce = null; var examBuilderDraftId = null;' +
    'var EXAM_DRAFT_FIELDS = ' + JSON.stringify(['examTitle', 'examCourse', 'examDate', 'examTime', 'examDuration', 'examPassMark', 'examShuffle', 'examInstructions',
      'examAnswersRelease', 'examPerPage', 'examShuffleOptions', 'examAllowFlag', 'examCloseDate', 'examCloseTime']) + ';' +
    ['examDraftOwner', 'examDraftAll', 'examDraftWrite', 'examDraftList', 'examDraftMine', 'examDraftHasContent', 'examDraftUnchanged', 'examDraftSave', 'examDraftClear', 'examDraftRestore', 'examDraftDiscard'].map(fn).join('\n'), sb);
  return { sb, els, ls };
}
{
  page.ls = {};
  const { sb, els, ls } = page('USR-INS-IAN');
  vm.runInContext('examBuilderDraftId = "new:a"', sb);
  assert(vm.runInContext('examDraftSave()', sb) === false && !('cestisExamBuilderDraft' in ls), 'an empty form writes nothing');
  els.examTitle.value = 'Unit 6 Theory Test'; els.examDuration.value = '60';
  vm.runInContext('examBuilderQuestions = [{ id: "Q1", type: "tf", text: "Statement 0", points: 1, correctAnswer: true }]', sb);
  assert(vm.runInContext('examDraftSave()', sb) === true, 'the title and a question are written as they are typed');
  const stored = JSON.parse(ls.cestisExamBuilderDraft)['USR-INS-IAN']['new:a'];
  assert(stored.fields.examTitle === 'Unit 6 Theory Test' && stored.questions.length === 1 && stored.questions[0].correctAnswer === true, 'the draft holds the form and the questions with their keys');
  // A second test started (another opening) is its own draft.
  vm.runInContext('examBuilderDraftId = "new:b"; examBuilderQuestions = [];', sb);
  els.examTitle.value = '';
  assert(vm.runInContext('examDraftSave()', sb) === false, 'a fresh empty form does not replace the first');
  els.examTitle.value = 'Week 11 quiz';
  vm.runInContext('examDraftSave()', sb);
  assert(vm.runInContext('examDraftList().length', sb) === 2, 'two unsaved tests side by side');
  // Another person on this PC sees neither.
  const other = page('USR-INS-PAULA');
  assert(vm.runInContext('examDraftList().length', other.sb) === 0, 'another instructor on this PC sees none of Ian\'s');
  // A reload: restore the first.
  const after = page('USR-INS-IAN');
  assert(vm.runInContext('examDraftRestore("new:a")', after.sb) === true, 'after a reload the draft is restored');
  assert(after.els.examTitle.value === 'Unit 6 Theory Test' && vm.runInContext('examBuilderQuestions.length', after.sb) === 1 && after.sb.step === 2 && vm.runInContext('examBuilderDraftId', after.sb) === 'new:a',
    'with its title, its question and its key, on the questions step, still writing the same draft');
  assert(/Restored "Unit 6 Theory Test" with 1 question/.test(after.sb.toasts.join('|')), 'and says so');
  vm.runInContext('examDraftClear()', after.sb);
  assert(vm.runInContext('examDraftList().map(function(d){return d.id;}).join()', after.sb) === 'new:b', 'saving it clears that draft only');
  after.sb.confirmAnswer = false;
  vm.runInContext('examDraftDiscard("new:b")', after.sb);
  assert(vm.runInContext('examDraftList().length', after.sb) === 1, 'Discard asks first; "no" keeps it');
  after.sb.confirmAnswer = true;
  vm.runInContext('examDraftDiscard("new:b")', after.sb);
  assert(!('cestisExamBuilderDraft' in page.ls), 'and "yes" removes it (and the key, once empty)');
}
{
  // An exam opened for Edit and closed unchanged is not unsaved work.
  page.ls = {};
  const { sb, els, ls } = page('USR-INS-IAN');
  const ex = { id: 'EXAM-U5', title: 'Unit 5 Theory Test', date: '2026-10-27', time: '09:00', duration: 60, passMark: 60, instructions: '', questionData: [{ id: 'Q1', type: 'tf', text: 'x', points: 1, correctAnswer: true }] };
  vm.runInContext('exams = ' + JSON.stringify([ex]) + '; editingExamId = "EXAM-U5"; examBuilderDraftId = "edit:EXAM-U5:a"; examBuilderQuestions = ' + JSON.stringify(ex.questionData), sb);
  Object.assign(els.examTitle, { value: ex.title }); els.examDate.value = ex.date; els.examTime.value = ex.time; els.examDuration.value = '60'; els.examPassMark.value = '60';
  assert(vm.runInContext('examDraftSave(true)', sb) === false && !('cestisExamBuilderDraft' in ls), 'Edit, then close with nothing changed: no "unsaved test" is left behind');
  els.examTitle.value = 'Unit 5 Theory Test (revised)';
  assert(vm.runInContext('examDraftSave(true)', sb) === true, 'a change is kept as a draft of that edit');
  els.examTitle.value = ex.title;
  vm.runInContext('examDraftSave(true)', sb);
  assert(!('cestisExamBuilderDraft' in ls), 'and changed back, the draft goes again');
}
{
  // The wiring.
  const create = fn('createExam');
  assert(/examDraftClear\(\);\s*examBuilderDraftId = null;\s*closeModal\('createExamModal'\);/.test(create), 'a saved test clears its draft before the builder closes');
  assert(/examBuilderNewId && !exams\.some\(/.test(create) && /newExam\.copiedFrom = examBuilderCopiedFrom/.test(create), 'a copy is published under its new id, saying where it came from');
  assert(/try \{ examDraftSave\(true\); \} catch \(e\) \{\}/.test(fn('examBuilderClosed')), 'closing the builder keeps what was built');
  assert(/examDraftStartTimer\(\);/.test(fn('examBuilderOpening')), 'the builder writes its draft as it goes');
  assert(/onclick="copyExamToBuilder\('\+idx\+'\)"[^>]*>Copy<\/button>/.test(fn('renderInstructorExams')) && /onclick="copyExamToBuilder\('\+idx\+'\)"[^>]*>Copy<\/button>/.test(fn('renderExams')), 'Copy on the instructor\'s and the administrator\'s exam lists');
  assert(/CESTISCore\.exams\.copyExam\(e, \{ id: cestisGenId\('EXAM-'\)/.test(fn('copyExamToBuilder')), 'Copy uses the core rule with a new id');
  assert(/data-page="i-import-exam"/.test(fn('buildInstructorSidebar')) && /id="page-i-import-exam">\s*<div class="cestis-mount" data-feature="import-exam" data-prefix="instructor">/.test(src), 'instructors have Import Exam');
  assert(/You can import an exam for your own programme only/.test(fn('finalizeImportExam')), 'for their own programme only');
}
{
  // The programme list an instructor is offered on Import Exam.
  const opts = [{ value: 'Welding & Fabrication', textContent: 'Welding & Fabrication' }, { value: 'Plumbing', textContent: 'Plumbing' }, { value: 'Cosmetology', textContent: 'Cosmetology' }];
  const sel = { options: opts, innerHTML: '' };
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const sb = { currentRole: 'instructor', currentInstructor: { course: 'Welding & Fabrication' }, document: { getElementById: () => sel }, escapeHtml: esc, escapeAttr: esc,
    instructorCourseMatch: (a, b) => a === b, Array };
  vm.createContext(sb);
  vm.runInContext(fn('importExamInstructorCourses') + fn('importExamLimitCourses'), sb);
  vm.runInContext('importExamLimitCourses()', sb);
  assert(sel.innerHTML === '<option value="Welding &amp; Fabrication">Welding &amp; Fabrication</option>', 'an instructor is offered her own programme only (' + sel.innerHTML + ')');
  sb.currentRole = 'admin'; sel.innerHTML = 'unchanged';
  vm.runInContext('importExamLimitCourses()', sb);
  assert(sel.innerHTML === 'unchanged', 'the Administrator keeps every programme');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
