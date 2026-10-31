/* Extra time on a trainee's clock (prepared assessments).

   An attempt's own deadline never moves; her clock is that deadline plus the
   extra time staff added (on the exam record at the Centre, from the gate at
   home). This runs index.html's own functions in a sandbox and checks:
     - the time the gate gave one trainee is kept for her alone: a second
       trainee on the same phone does not inherit it, and sign-out forgets it;
     - every "has the time run out?" check counts her extra time;
     - from home, the gate is asked once for her extra time before an attempt
       whose own deadline has passed is submitted (on resume and at sign-in),
       so a trainee with time left carries on instead of being submitted.

   Run: node tests/exam-extra-time.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(start, i + 1); } }
  throw new Error(name + ' not closed');
}
const NAMES = ['examExtraKey', 'examExtraMsFor', 'examEffectiveDeadline', 'examAttemptDeadline', 'examGateExtraKeep', 'examGateExtraFetch',
  'examGateExtraForget', 'examResumeDraft', 'examSubmitExpiredAttempts', 'examHasDraftFor'];
const MIN = 60000;
const tick = () => new Promise(r => setTimeout(r, 0));

async function run(where) {
  const src = fs.readFileSync(path.join(__dirname, '..', where, 'index.html'), 'utf8');
  const w = (where || '.') + '/index.html';
  const now = Date.now();
  function world(o) {
    o = o || {};
    const asked = [], resumed = [], submitted = [];
    const sb = {
      Date, Math, Promise, String, Number, Array, Object, JSON, isFinite, console: { log() {}, warn() {} },
      _isExamPreviewMode: false, currentExamSession: null, currentRole: 'student', currentStudent: { id: 'STU-a' },
      cestisGateSession: () => !!o.gate,
      window: {}, CESTISGate: { examTime: (examId) => { asked.push(examId); return Promise.resolve(o.gateAnswer || { ok: true, minutes: 0, grants: [] }); } },
      examFind: () => ({ id: 'EX-1', extraTime: o.localGrants || [] }),
      CESTISCore: { exams: { extraMs: (e, sid) => (o.localMs && o.localMs[sid]) || 0, activityOf: () => ({ v: 1 }), activityLayout: () => ({}) } },
      examActivityReady: () => false, examActivityNote() {}, examActivityNetAtStart() {}, examLoadDraft: () => null, autoSaveExamProgress() {}, examPublishNow() {},
      examShowTakingView() {}, renderExamTaking() {}, startExamTimer() {}, showToast() {}, showPage() {}, examDeviceLabel: () => 'pc',
      submitExam: (auto, opt) => { submitted.push(sb.currentExamSession && sb.currentExamSession.attemptId); sb.currentExamSession = null; },
      examOpenAttemptsFor: () => (o.attempts || []).map(a => ({ attempt: a, ids: [a.id] }))
    };
    sb.window.CESTISGate = sb.CESTISGate;
    vm.createContext(sb);
    vm.runInContext('var _examGateExtra = {}, _examGateExtraAsked = {};\n' + NAMES.map(n => extractFunction(src, n)).join('\n'), sb);
    // Count resumes that went past the "time ran out" check.
    const realResume = sb.examResumeDraft;
    sb.__resumed = resumed;
    return { sb, asked, resumed, submitted };
  }
  const att = (id, overByMin) => ({ id, examId: 'EX-1', studentId: 'STU-a', startTime: now - 200 * MIN, duration: 150, deadline: now - overByMin * MIN,
    questions: [{ id: 'Q1' }], answers: [null], flagged: [false] });

  console.log('The gate\'s time is kept per trainee (' + w + ')');
  {
    const x = world({ gate: true });
    x.sb.examGateExtraKeep('EX-1', 'STU-a', { ok: true, minutes: 15, grants: [{ byRole: 'admin', minutes: 15 }] });
    assert(x.sb.examExtraMsFor('EX-1', 'STU-a') === 15 * MIN, 'her 15 minutes count for her');
    assert(x.sb.examExtraMsFor('EX-1', 'STU-b') === 0, 'a second trainee on the same phone, same exam: none of it');
    x.sb.examGateExtraKeep('EX-1', 'STU-a', { ok: true, minutes: 5 });
    assert(x.sb.examExtraMsFor('EX-1', 'STU-a') === 15 * MIN, 'time is only ever added: a smaller answer does not take hers away');
    x.sb.examGateExtraForget();
    assert(x.sb.examExtraMsFor('EX-1', 'STU-a') === 0, 'signing out forgets it');
    assert(/examGateExtraForget\(\)/.test(extractFunction(src, 'clearSensitiveStudentData')), 'clearSensitiveStudentData forgets it at sign-out');
  }

  console.log('Every "time ran out?" check counts her extra time (' + w + ')');
  {
    const x = world({ localMs: { 'STU-a': 30 * MIN } });
    const a = att('ATT-1', 10);
    assert(x.sb.examAttemptDeadline(a) === a.deadline + 30 * MIN, 'the attempt\'s deadline plus her 30 minutes');
    x.sb.examOpenAttemptsFor = () => [{ attempt: a, ids: [a.id] }];
    assert(x.sb.examHasDraftFor('STU-a', true) === true, 'with 20 minutes still left, the test is still running');
    ['examResumeDraft', 'examSubmitExpiredAttempts', 'examHasDraftFor'].forEach(n => assert(/examAttemptDeadline\(/.test(extractFunction(src, n)), n + ' asks examAttemptDeadline'));
    assert(!/Date\.now\(\) >= d\.deadline/.test(extractFunction(src, 'examResumeDraft')), 'resume no longer compares against the bare deadline');
  }

  console.log('At the Centre: the record\'s time decides at once (' + w + ')');
  {
    const x = world({ gate: false, localMs: { 'STU-a': 30 * MIN } });
    x.sb.examResumeDraft(att('ATT-2', 10), ['ATT-2']);
    assert(x.submitted.length === 0 && x.sb.currentExamSession && x.sb.currentExamSession.attemptId === 'ATT-2', 'resumed, not submitted: she has 20 minutes left');
    assert(x.sb.currentExamSession.timeRemaining > 19 * 60 && x.sb.currentExamSession.timeRemaining <= 20 * 60, 'her clock shows the time left with the extra (' + x.sb.currentExamSession.timeRemaining + ' s)');
    const y = world({ gate: false });
    y.sb.examResumeDraft(att('ATT-3', 10), ['ATT-3']);
    assert(y.submitted.join() === 'ATT-3' && y.asked.length === 0, 'no extra time: submitted, and no gate to ask');
  }

  console.log('From home: the gate is asked before an attempt is called finished (' + w + ')');
  {
    const x = world({ gate: true, gateAnswer: { ok: true, minutes: 30, grants: [] } });
    x.sb.examResumeDraft(att('ATT-4', 10), ['ATT-4']);
    assert(x.submitted.length === 0 && !x.sb.currentExamSession, 'her own deadline passed: nothing submitted before the gate answers');
    await tick(); await tick(); await tick();
    assert(x.asked.join() === 'EX-1', 'the gate was asked for her time');
    assert(x.submitted.length === 0 && x.sb.currentExamSession && x.sb.currentExamSession.attemptId === 'ATT-4', 'the gate gave 30 minutes: she carries on');
    const y = world({ gate: true, gateAnswer: { ok: true, minutes: 0, grants: [] } });
    y.sb.examResumeDraft(att('ATT-5', 10), ['ATT-5']);
    await tick(); await tick(); await tick();
    assert(y.asked.length === 1 && y.submitted.join() === 'ATT-5', 'no extra time at the gate: submitted after one question');
    const z = world({ gate: true });
    z.sb.CESTISGate.examTime = () => { z.asked.push('x'); return Promise.reject(new Error('offline')); };
    z.sb.examResumeDraft(att('ATT-6', 10), ['ATT-6']);
    await tick(); await tick(); await tick();
    assert(z.asked.length === 1 && z.submitted.join() === 'ATT-6', 'the gate could not be reached: asked once, then submitted as before');
  }

  console.log('From home, at sign-in (' + w + ')');
  {
    const x = world({ gate: true, gateAnswer: { ok: true, minutes: 30 }, attempts: [att('ATT-7', 10)] });
    let n = x.sb.examSubmitExpiredAttempts();
    assert(n === 0 && x.submitted.length === 0, 'an attempt past its own deadline: nothing submitted before the gate answers');
    await tick(); await tick(); await tick();
    assert(x.asked.join() === 'EX-1', 'the gate was asked once');
    assert(x.submitted.length === 0, 'the gate gave 30 minutes: not submitted at sign-in');
    const y = world({ gate: true, gateAnswer: { ok: true, minutes: 0 }, attempts: [att('ATT-8', 10)] });
    y.sb.examSubmitExpiredAttempts();
    await tick(); await tick(); await tick(); await tick();
    assert(y.asked.length === 1 && y.submitted.join() === 'ATT-8', 'no extra time: submitted once the gate has answered, asked only once');
  }
}

(async () => {
  for (const where of ['', 'Offline System']) await run(where);
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
