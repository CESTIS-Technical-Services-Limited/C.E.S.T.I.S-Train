/* A new multiple-choice or true/false question starts with no answer key.
   Run: node tests/exam-new-question-no-key.test.js

   What used to go wrong (audit IN-7): a new multiple-choice question started
   keyed to option (a) and a true/false one to True. An author who typed the
   question and its options but never ticked the right one got no warning
   (keyProblems found nothing to report), and the test was marked silently
   against (a) / True.

   Pinned here, on the dashboard's own addExamQuestion / addImportQuestion /
   examKeyProblemText / activateExam read from index.html: a new MC or T/F
   question has no key; keyProblems reports it and the builder row says
   "Answer not set"; an exam holding one cannot be activated; once the key is
   chosen it can. Questions already saved keep their keys: nothing stored is
   changed (an option 0 / True / False key is still a key). */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}

const sb = {
  CESTISCore: Core, Math: Math, String: String, console: console,
  examBuilderQuestions: [], examBuilderOpen: {}, importedQuestions: [],
  cestisGenId: p => p + Math.random().toString(36).slice(2, 8),
  renderExamBuilderQuestions: () => {}, renderImportPreview: () => {},
  document: { getElementById: () => null },
  alerts: [], currentRole: 'instructor', currentInstructor: { id: 'USR-INS' },
  exams: [], resolveExamStatuses: () => {}, renderExams: () => {}, refreshContentDependentViews: () => {}, saveState: () => { sb.saved++; },
  saved: 0, confirm: () => true, showToast: () => {}, addNotification: () => {}
};
sb.alert = m => sb.alerts.push(String(m));
vm.createContext(sb);
vm.runInContext(fn('addExamQuestion') + fn('addImportQuestion') + fn('examKeyProblemText') + fn('activateExam') +
  'function examFind(i) { return exams[i]; }', sb);

console.log('A new question has no key, and says so');
{
  sb.addExamQuestion('mcq');
  sb.addExamQuestion('tf');
  const [mc, tf] = sb.examBuilderQuestions;
  assert(mc.correctAnswer == null, 'a new multiple-choice question has no key (got ' + JSON.stringify(mc.correctAnswer) + ')');
  assert(tf.correctAnswer == null, 'a new true/false question has no key (got ' + JSON.stringify(tf.correctAnswer) + ')');
  assert(mc.options.length === 4, 'the four option boxes are still there to fill in');
  const probs = Core.exams.keyProblems(sb.examBuilderQuestions);
  assert(probs.join() === '1,2', 'keyProblems reports both (got ' + probs.join() + ')');
  assert(sb.examKeyProblemText(mc) === 'select the correct answer' && sb.examKeyProblemText(tf) === 'select the correct answer', 'the builder\'s row reads "Answer not set: select the correct answer"');
  assert(/badge-amber exam-qrow-warn[^>]*>Answer not set</.test(src), '(the row\'s "Answer not set" badge)');
  sb.addImportQuestion();
  assert(sb.importedQuestions[0].correctAnswer == null && Core.exams.keyProblems(sb.importedQuestions).length === 1, 'a question added on the import preview starts unkeyed too');
}

console.log('An exam with an unset key cannot be activated');
{
  const qs = sb.examBuilderQuestions.map(q => Object.assign({}, q, { text: 'Q' }));
  sb.exams = [{ id: 'EX-1', title: 'Unit 4', createdBy: 'USR-INS', status: 'upcoming', duration: 30, questionData: qs }];
  sb.activateExam(0);
  assert(sb.exams[0].status === 'upcoming' && sb.saved === 0, 'Activate refuses');
  assert(/no correct answer selected/.test(sb.alerts[sb.alerts.length - 1] || ''), 'and says which questions: ' + sb.alerts[sb.alerts.length - 1]);
  qs[0].correctAnswer = 2; qs[1].correctAnswer = false;
  sb.activateExam(0);
  assert(sb.exams[0].status === 'active' && sb.saved === 1, 'once every key is chosen, it activates');
}

console.log('Questions already saved keep their keys');
{
  const saved = [
    { type: 'mcq', options: ['a', 'b', 'c'], correctAnswer: 0 },
    { type: 'tf', correctAnswer: true },
    { type: 'tf', correctAnswer: false }
  ];
  assert(Core.exams.keyProblems(saved).length === 0, 'an option-(a) key, a True key and a False key are all keys — nothing to fix in stored exams');
  const m = Core.exams.mark(saved, [0, true, false], saved);
  assert(m.correctCount === 3, 'and they mark as before');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
