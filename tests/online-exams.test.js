/* Online exams: authoring, sitting, marking and results behave the way a
   training centre needs them to, on every device.

   What went wrong, and what these tests pin (finding ids in brackets):
     - Edit → Cancel → "+ Create Exam" overwrote the exam that had been opened
       for editing (exams-07); editing dropped the date, time, duration, pass
       mark and programme (exams-08).
     - An exam with no date/time became "09:00 today", and one created or
       activated after its window was completed by the next tick (exams-09,
       ui-05). The window was read in each device's own timezone, and a
       trainee's device published the status it computed (exams-10).
     - Deleting an MCQ option above the answer moved the key to another
       option (exams-19); an imported paper without a key was silently keyed
       to A / False (exams-15).
     - A reload or power cut lost every answer and gave a fresh full clock
       (exams-17, ui-04); a sign-out left the clock running and the attempt
       was submitted under the NEXT trainee's name (exams-16, ui-03); a late
       starter got the full duration and any course/status could be started
       by position (exams-18).
     - MCQ choices were mouse-only list items (ui-07); exam instructions
       reached nobody (exams-22).
     - The attempt carried every answer key (exams-04, partly mitigated).
     - Correct answers were shown the moment the first trainee submitted
       (exams-13); every trainee was told every other trainee's score
       (exams-12); provisional results counted as final Fails (exams-14).
     - Exams merged by title|programme collapsed and lost deletions (exams-11);
       a real exam titled like a demo paper never synced (missed); deleting an
       exam hard-deleted its graded results (exams-20); a classmate's sign-out
       on a shared PC deleted a result not yet uploaded (exams-03).
     - The results CSV had no quoting/formula guard and called pending results
       "Failed" (exams-23); "Grade Now" threw when the exams page was not
       mounted (exams-24); instructors defaulted to the first programme and
       could not see their own exams (exams-21).

   The page functions are extracted from the real index.html and run in a
   sandbox with a stub DOM, a fake clock and a fake store.

   Run: node tests/online-exams.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ASYNC_CHECKS = [];
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const Core = require('../cestis-core.js');
const E = Core.exams;

function extractFunction(src, name) {
  const m = new RegExp('(?:^|\\n)(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* Jamaica is UTC-05:00 all year. 2026-10-16 14:00 Jamaica = 19:00Z. */
const JM = (date, time) => Date.parse(date + 'T' + time + ':00-05:00');

/* ---------- the sandbox: stub DOM, fake store, fake clock and timers ---------- */
function makeEl(id) {
  const cls = new Set();
  const el = {
    id: id || '', innerHTML: '', textContent: '', value: '', style: {}, children: [], options: [], attrs: {},
    classList: { add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, contains(c) { return cls.has(c); }, toggle(c) { cls.has(c) ? cls.delete(c) : cls.add(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    querySelectorAll() { return []; }, querySelector() { return null; }, appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, scrollIntoView() {}, click() {}, focus() {}
  };
  return el;
}
const PAGE_FNS = [
  'escapeHtml', 'escapeAttr', 'jsArg', 'safeUrl', 'instructorCourseMatch',
  'examCentreOffset', 'examStatusNow', 'examIsStaffSession', 'examFind', 'resolveExamStatuses', 'parseExamDateTime',
  'examBuilderOpening', 'examBuilderClosed', 'examToggleAnswerRelease', 'examArchiveResultsOf', 'openModal', 'closeModal',
  'goToExamStep1', 'goToExamStep2', 'removeExamOption', 'createExam', 'editExam', 'activateExam', 'completeExam', 'deleteExam',
  'viewExamResults', 'backToExamList', 'viewExamDetail', 'renderInstructorExams',
  'examShowTakingView', 'examLoadDraft', 'examResumeDraft', 'examHasDraftFor', 'examSaveDraftSoon', 'examSubmitSummaryHtml', 'examUpdateProgress',
  'examEndSessionForSignOut', 'examOutboxRead', 'examOutboxWrite', 'examOutboxAdd', 'examOutboxRestore', 'examOutboxConfirm', 'examTraineeUserId',
  'startStudentExam', 'startExamTimer', 'updateExamTimerDisplay', 'renderExamTaking', 'selectExamAnswer', 'toggleExamFlag',
  // The Moodle-style attempt page's pieces (exam-platform preview).
  'examCounts', 'examClock', 'examTakingView', 'examPages', 'examPageOf', 'examStateText', 'examNavBoxClass', 'examNavBoxLabel',
  'examNavPanelHtml', 'examQuestionHtml', 'examAnswerHtml', 'examCrumbsHtml', 'examSetCurrent', 'examRefreshNavBox', 'examGoTo',
  'examFocusQuestion', 'examGoPage', 'examToggleNavStrip', 'examShowSummary', 'examToggleMulti', 'examSetMatch', 'examAnswerChanged',
  'scrollToExamQuestion', 'confirmSubmitExam', 'examReturnToAttempt', 'examCentreDateTime', 'examSummaryHtml', 'examConfirmSubmit',
  'examCloseConfirm', 'examSubmitConfirmed', 'examDurationText', 'examOutcomeLabel', 'examAnswerText', 'examKeyText', 'examReviewAnswerHtml',
  'examReviewGoTo', 'examOptionText', 'examResultsTableHtml', 'examSettingsHeading', 'examSettingsReset', 'examSettingsSections',
  'examSettingsSyncExpand', 'examCloseToggle', 'examKeyProblemText', 'examTypeLabel',
  'autoSaveExamProgress', 'submitExam', 'showExamResult', 'viewExamResultDetail', 'renderStudentExams', 'submitGrading', 'examGraderName', 'examRecordManualMarks', 'notifyMarkingAudience', 'closeGradingPanel',
  'getFilteredNotifications', 'notifViewerId', 'exportExamResults', 'detectQuestionsFromText', 'removeImportOption', 'finalizeImportExam', 'importExamInstructorCourses', 'updateImportSummary',
  'clearSensitiveStudentData',
  // A test in progress that follows the trainee (CESTISCore.exams attempts).
  'safeJsonParse', 'examStampNow', 'examReadDraftRaw', 'examCurrentAttempt', 'examRetireLocalDraft', 'examAttemptRecord',
  'examAttemptsUpsert', 'examAttemptsPersist', 'examAttemptsMergeIncoming', 'examAttemptsRestoreFromDrafts', 'examRetireStaleDrafts',
  'examAttemptsArrived', 'examAdoptAttempt', 'examRedrawKeepingFocus', 'examDismissNote', 'examAttemptEndedElsewhere', 'examListNote',
  'examResultFor', 'examPublishSoon', 'examPublishNow', 'examSaveOnLeaving', 'examPullBeforeStart', 'examCanAskCentre', 'examStartFresh',
  'examSaveDraftNow', 'examOpenAttemptsFor', 'examSubmitExpiredAttempts', 'examSubmittedHere', 'examAfterSignIn', 'examOutboxSendOnLan',
  // What the invigilator sees of the attempt (CESTISCore.exams activity).
  'examActivityReady', 'examDeviceCode', 'examDeviceLabel', 'examActivityEvent', 'examActivityNote', 'examActivityMark', 'examWindowLeft', 'examWindowBack',
  'examPageSwitched', 'examNetBack', 'examActivityNetAtStart', 'examLiveWatched', 'examLiveTargets', 'examLivePulseBody', 'examLivePulse', 'examLivePulseDone'
];
const PAGE_CODE = PAGE_FNS.map(n => extractFunction(SRC, n)).join('\n');

function makePage(opts) {
  opts = opts || {};
  // Any element the page (or the test) asks for exists, like a mounted page.
  const els = new Proxy({}, { get(t, id) { if (typeof id !== 'string') return undefined; return t[id] || (t[id] = makeEl(id)); } });
  const store = Object.assign({}, opts.store || {});
  const timers = [];
  let now = opts.now || JM('2026-10-16', '14:00');
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const out = { toasts: [], notes: [], userNotes: [], alerts: [], confirms: [], saves: 0, csv: null };
  const sb = {
    console, JSON, Math, Array, Object, String, Number, RegExp, parseInt, parseFloat, isNaN, Map, Set,
    Date: FakeDate, CESTISCore: Core,
    document: {
      getElementById(id) { if (opts.missing && opts.missing.indexOf(id) !== -1) return null; return els[id]; },
      querySelectorAll() { return []; }, createElement() { return makeEl(); }, body: makeEl('body'), activeElement: null
    },
    CESTISStore: {
      getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; },
      key(i) { return Object.keys(store)[i]; }, get length() { return Object.keys(store).length; }
    },
    setInterval(fn, ms) { const t = { fn, ms, at: now + ms, every: true, live: true }; timers.push(t); return t; },
    clearInterval(t) { if (t) t.live = false; },
    setTimeout(fn, ms) { const t = { fn, ms, at: now + (ms || 0), every: false, live: true }; timers.push(t); return t; },
    clearTimeout(t) { if (t) t.live = false; },
    alert(m) { out.alerts.push(String(m)); },
    confirm(m) { out.confirms.push(String(m)); return opts.confirmAnswers && opts.confirmAnswers.length ? opts.confirmAnswers.shift() : true; },
    showToast(m) { out.toasts.push(String(m)); },
    addNotification(text, type, icon, forRoles) { out.notes.push({ text, forRoles }); },
    addNotificationForUser(text, type, icon, userId, role) { out.userNotes.push({ text, userId, role }); },
    lmsChatGetCurrentUser() { return { id: sb.__userId || 'unknown' }; },
    saveState() { out.saves++; }, saveCollection() {}, refreshContentDependentViews() {}, renderExams() {},
    renderExamBuilderQuestions() {}, renderImportPreview() {}, goToImportStep() {}, showPage() {}, buildStudentPages() {},
    isRegisterOpenForCourse() { return true; }, syncTombstoneRemoved(c, before, after) { (out.tombed = out.tombed || []).push(before.filter(x => after.indexOf(x) === -1).map(x => x.id)); },
    cestisGenId(p) { out.ids = (out.ids || 0) + 1; return p + 'gen' + out.ids; }, localDateStr() { return '2026-10-16'; },
    findSkillAreaForCourse() { return null; },
    Blob: function (parts) { out.csv = parts.join(''); }, URL: { createObjectURL() { return 'blob:x'; } },
    adminStaffAccessDefaults() { return {}; }, indexedDB: { deleteDatabase() {} },
    exams: [], examResults: [], students: [], userAccounts: [], notifications: [], systemSettings: {},
    currentRole: 'admin', currentStudent: null, currentInstructor: null, currentLoggedInUser: null,
    currentExamSession: null, examTimerInterval: null, _isExamPreviewMode: false, _examDraftTimer: null,
    examBuilderQuestions: [], editingExamId: null, examBuilderNewId: null, examBuilderCopiedFrom: null, examBuilderDraftId: null, importedQuestions: [], importRawTextContent: '', importSelectedFile: null,
    EXAM_OUTBOX_KEY: 'cestisExamOutbox', _sessionWiped: false,
    examAttempts: [], EXAM_PUBLISH_MS: 30000, _examPublishTimer: null, _examLastPublish: 0, _examDraftFirstAt: 0, scheduleDebouncedCloudSave() {},
    _examEventSeq: 0, _examLeft: null, _examBlurTimer: null, _examOffline: null, _examWatchers: {}, EXAM_WATCH_MS: 75000, _examPulseAt: 0, _examPulseTimer: null, lmsChatRTReady: false,
    studentProfiles: {}, attendanceRecords: [], adminMeetings: [], adrTasks: [], adrStaffMeta: {}, adminStaffAccessSettings: {},
    instructorData: [], instructorProfiles: {}, certDownloadApprovals: [], certTemplates: {}, lmsChatMessages: {}, lmsChatProfiles: {},
    lmsChatFollows: {}, cloudFileId: null, lastSyncTime: null, loginSyncCompleted: false,
    __els: els, __store: store, __out: out
  };
  sb.window = sb;
  Object.assign(sb, opts.globals || {});
  vm.createContext(sb);
  vm.runInContext(PAGE_CODE, sb);
  sb.__advance = function (ms) {
    const end = now + ms;
    for (;;) {
      const due = timers.filter(t => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.ms; else due.live = false;
      due.fn();
    }
    now = end;
  };
  sb.__setNow = function (ms) { now = ms; };
  sb.__now = function () { return now; };
  return sb;
}
const run = (sb, code) => vm.runInContext(code, sb);

function sampleExam(over) {
  return Object.assign({
    id: 'EXAM-1', title: 'Unit 3 Test', course: 'Electrical', date: '2026-10-16', time: '13:00', duration: 60,
    status: 'active', passMark: 50, shuffleQuestions: false, instructions: 'Calculators allowed <b>only</b>', createdBy: 'admin',
    questionData: [
      { id: 'Q1', type: 'mcq', text: 'Earth wire colour?', points: 1, options: ['Red', 'Black', 'Green/Yellow', 'Blue'], correctAnswer: 2 },
      { id: 'Q2', type: 'tf', text: 'Mains is 110 V in Jamaica', points: 1, correctAnswer: true }
    ]
  }, over || {});
}
const ANN = { id: 'STU-A', name: 'Ann Brown', course: 'Electrical' };
const BEN = { id: 'STU-B', name: 'Ben Clarke', course: 'Plumbing' };

/* ======================================================================= */
console.log('The exam window is read on the Centre clock, the same on every device (exams-10)');
{
  const ex = sampleExam({ time: '09:00', duration: 90, status: 'upcoming' });
  const at0531 = Date.parse('2026-10-16T10:31:00Z');   // 05:31 in Jamaica
  const script = 'const E=require(' + JSON.stringify(path.join(ROOT, 'cestis-core.js')) + ').exams;' +
    'process.stdout.write(E.statusAt(' + JSON.stringify(ex) + ',' + at0531 + ') + "," + E.statusAt(' + JSON.stringify(ex) + ',' + JM('2026-10-16', '09:30') + '))';
  const utc = execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: 'UTC' }) }).toString();
  const jam = execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: 'America/Jamaica' }) }).toString();
  assertEq(utc, 'upcoming,active', 'a lab PC on UTC sees a 09:00 Jamaica exam as upcoming at 05:31 and open at 09:30');
  assertEq(jam, utc, 'and a PC on Jamaica time sees exactly the same');

  // A trainee's device computes, never writes.
  const t = makePage({ now: JM('2026-10-16', '11:00'), globals: { currentRole: 'student' } });
  t.exams.push(sampleExam({ time: '09:00', duration: 90, status: 'upcoming' }));
  assertEq(run(t, 'resolveExamStatuses()'), false, 'resolveExamStatuses on a trainee device changes nothing');
  assertEq(t.exams[0].status, 'upcoming', 'the stored status is left alone');
  assertEq(t.__out.saves, 0, 'and nothing is saved (so nothing is published)');
  assertEq(run(t, 'examStatusNow(exams[0])'), 'completed', 'while the trainee view still knows the window is over');
  const s = makePage({ now: JM('2026-10-16', '09:30'), globals: { currentRole: 'instructor' } });
  s.exams.push(sampleExam({ time: '09:00', duration: 90, status: 'upcoming' }));
  run(s, 'resolveExamStatuses()');
  assertEq(s.exams[0].status, 'active', 'a staff device opens it at its time');
  assert(s.__out.saves === 1, 'and saves that');
  // Pass rate on completion counts final results only (missed: passRate).
  s.examResults.push({ id: 'R1', examId: 'EXAM-1', studentId: 'a', passed: true, score: 80 },
    { id: 'R2', examId: 'EXAM-1', studentId: 'b', passed: false, score: 30, needsReview: true, reviewComplete: false });
  s.__setNow(JM('2026-10-16', '11:00'));
  run(s, 'resolveExamStatuses()');
  assertEq(s.exams[0].passRate, '100%', 'a result awaiting marking is not counted as a fail in the pass rate');
}

console.log('A new exam opens from "now", and activation opens a fresh window (exams-09, ui-05)');
{
  const p = makePage({ now: JM('2026-10-16', '14:02') });
  run(p, "examBuilderOpening()");
  assertEq(p.__els.examDate.value, '2026-10-16', 'the Create form is prefilled with today (Centre time)');
  assertEq(p.__els.examTime.value, '14:05', 'and the next five minutes, not 09:00');
  p.__els.examDate.value = ''; p.__els.examTime.value = '';
  p.__els.examTitle.value = 'Quick quiz'; p.__els.examCourse.value = 'Electrical'; p.__els.examDuration.value = '30'; p.__els.examPassMark.value = '50';
  p.__els.examShuffle.value = 'false';
  run(p, "examBuilderQuestions = [{ id:'Q1', type:'tf', text:'Q', points:1, correctAnswer:true }]; createExam()");
  assertEq(p.exams.length, 1, 'the exam is created');
  assertEq(p.exams[0].date + ' ' + p.exams[0].time, '2026-10-16 14:05', 'blank date/time mean the next five minutes');
  p.currentRole = 'admin';
  run(p, 'resolveExamStatuses()');
  assert(p.exams[0].status !== 'completed', 'it is not completed on the next tick (got ' + p.exams[0].status + ')');

  // An exam scheduled for yesterday, activated today: open for its duration.
  const q = makePage({ now: JM('2026-10-16', '14:00') });
  q.exams.push(sampleExam({ date: '2026-10-15', time: '09:00', status: 'upcoming' }));
  run(q, "activateExam('EXAM-1')");
  assertEq(q.exams[0].status, 'active', 'activating a past-dated exam makes it active');
  assert(!!q.exams[0].activatedAt, 'and records when it was activated');
  q.__advance(30 * 60000);
  run(q, 'resolveExamStatuses()');
  assertEq(q.exams[0].status, 'active', 'it is still active half an hour later');
  q.__advance(31 * 60000);
  run(q, 'resolveExamStatuses()');
  assertEq(q.exams[0].status, 'completed', 'and completes once its duration from activation has passed');
  assert(q.__out.toasts.some(t => /ACTIVE/.test(t)), 'the ACTIVE toast is shown only for an exam that really is active');

  // A chosen window that has already ended is caught at create time.
  const r = makePage({ now: JM('2026-10-16', '14:00'), confirmAnswers: [false] });
  r.__els.examTitle.value = 'Old window'; r.__els.examCourse.value = 'Electrical'; r.__els.examDate.value = '2026-10-16'; r.__els.examTime.value = '09:00';
  r.__els.examDuration.value = '60'; r.__els.examPassMark.value = '60'; r.__els.examShuffle.value = 'false';
  run(r, "examBuilderQuestions = [{ id:'Q1', type:'tf', text:'Q', points:1, correctAnswer:true }]; createExam()");
  assertEq(r.exams.length, 0, 'an exam whose window already ended is not silently created');
  assert(/already ended/.test(r.__out.confirms[0] || ''), 'the author is told the window has passed');
}

console.log('Edit → Cancel → Create creates a NEW exam; an edit saves every field (exams-07, exams-08)');
{
  const p = makePage({ now: JM('2026-10-16', '08:00') });
  p.exams.push(sampleExam({ status: 'upcoming', date: '2026-10-20', time: '09:00', duration: 90, passMark: 60 }));
  run(p, "editExam('EXAM-1')");
  assertEq(p.editingExamId, 'EXAM-1', 'Edit targets the exam by id');
  // The real Cancel handler from the modal markup.
  const cancel = /onclick="(closeModal\('createExamModal'\);examBuilderQuestions=\[\];)">Cancel<\/button>/.exec(SRC);
  assert(!!cancel, 'the Cancel button markup is where it was');
  run(p, cancel[1]);
  run(p, "openModal('createExamModal')");                       // "+ Create Exam"
  assertEq(p.__els.examTitle.value, '', 'the Create form starts empty');
  p.__els.examTitle.value = 'Unit 4 Quiz'; p.__els.examCourse.value = 'Electrical';
  run(p, "examBuilderQuestions = [{ id:'B1', type:'tf', text:'B-q1', points:1, correctAnswer:false }]; createExam()");
  assertEq(p.exams.length, 2, 'a second exam exists');
  const orig = p.exams.find(e => e.id === 'EXAM-1');
  assertEq(orig.title, 'Unit 3 Test', 'the exam that was opened for editing keeps its title');
  assertEq(orig.questionData[0].id, 'Q1', 'and its questions');
  assert(/^EXAM-/.test(p.exams[0].id) && p.exams[0].id !== 'EXAM-1', 'the new exam has its own id');

  // exams-08: the edit applies schedule, length, pass mark and programme.
  run(p, "editExam('EXAM-1')");
  p.__els.examDate.value = '2026-10-22'; p.__els.examTime.value = '13:30'; p.__els.examDuration.value = '120';
  p.__els.examPassMark.value = '50'; p.__els.examCourse.value = 'Welding';
  run(p, 'createExam()');
  const ed = p.exams.find(e => e.id === 'EXAM-1');
  assertEq([ed.date, ed.time, ed.duration, ed.passMark, ed.course].join(' '), '2026-10-22 13:30 120 50 Welding', 'every edited field is saved');
  assertEq(p.exams.length, 2, 'and editing created nothing new');

  // Editing an exam that vanished meanwhile never falls through silently.
  run(p, "editExam('EXAM-1')");
  p.exams.splice(p.exams.findIndex(e => e.id === 'EXAM-1'), 1);
  p.__out.confirms.length = 0;
  const before = p.exams.length;
  run(p, 'createExam()');
  assert(/no longer on this device/.test(p.__out.confirms[0] || ''), 'saving an edit of a vanished exam asks first');
  assertEq(p.exams.length, before + 1, 'and (when confirmed) saves it as a new exam rather than overwriting another');

  // A completed exam rescheduled into the future can be reopened.
  const r = makePage({ now: JM('2026-10-16', '14:00') });
  r.exams.push(sampleExam({ status: 'completed', date: '2026-10-15' }));
  run(r, "editExam('EXAM-1')");
  r.__els.examDate.value = '2026-10-17'; r.__els.examTime.value = '09:00';
  run(r, 'createExam()');
  assertEq(r.exams[0].status, 'upcoming', 'a completed exam moved to a future date reopens as upcoming');
}

console.log('Answer keys follow their option; unkeyed questions are never guessed (exams-19, exams-15)');
{
  const p = makePage();
  run(p, "examBuilderQuestions = [{ id:'Q', type:'mcq', text:'Earth?', points:1, options:['Red','Black','Green/Yellow','Blue'], correctAnswer:2 }]");
  run(p, 'removeExamOption(0, 0)');
  assertEq(p.examBuilderQuestions[0].options[p.examBuilderQuestions[0].correctAnswer], 'Green/Yellow', 'removing an option above the key keeps the key on the same answer');
  run(p, 'removeExamOption(0, 1)');
  assertEq(p.examBuilderQuestions[0].correctAnswer, null, 'removing the keyed option leaves no answer selected');
  p.__els.examTitle.value = 'T'; p.__els.examCourse.value = 'Electrical';
  run(p, 'createExam()');
  assertEq(p.exams.length, 0, 'and the exam cannot be saved until one is chosen');
  assert(/correct answer/.test(p.__out.alerts.join(' ')), 'the author is told which question');

  // Import without a key.
  const q = makePage();
  q.__els.importRawText.value = [
    '1. Which colour is the earth conductor in a flexible cord?', 'A. Red', 'B. Black', 'C. Green and yellow', 'D. Blue', '',
    '2. Which tool is used to measure the current in a circuit?', 'A. Voltmeter', 'B. Ammeter', 'C. Ohmmeter', '',
    '3. Mains supply in Jamaica is nominally 110 volts at 50 hertz.', 'A. True', 'B. False', '',
    '4. Which device protects a circuit against overcurrent faults?', 'A. Fuse', 'B. Switch', 'C. Lamp', 'Answer: E'
  ].join('\n');
  run(q, 'detectQuestionsFromText()');
  assertEq(q.importedQuestions.length, 4, 'all four questions are detected');
  assert(q.importedQuestions.every(x => x.correctAnswer === null), 'none of them gets a guessed key (got ' + JSON.stringify(q.importedQuestions.map(x => x.correctAnswer)) + ')');
  q.__els.importExamTitle.value = 'Imported';
  run(q, 'finalizeImportExam()');
  assertEq(q.exams.length, 0, 'the import is refused until each answer is set');
  run(q, 'importedQuestions.forEach(function(x){ x.correctAnswer = x.type === "tf" ? true : 0; }); finalizeImportExam()');
  assertEq(q.exams.length, 1, 'and goes through once they are');
  assert(!!q.exams[0].createdBy, 'an imported exam records who created it');
  run(q, "importedQuestions = [{ id:'I', type:'mcq', text:'x', points:1, options:['a','b','c'], correctAnswer:1 }]; removeImportOption(0, 0)");
  assertEq(q.importedQuestions[0].correctAnswer, 0, 'the import preview keeps the key on its option too');

  // Marking never treats a missing key as an answer.
  const m = E.mark([{ id: 'X', type: 'mcq', text: 't', points: 1, options: ['a', 'b'] }], [null], [{ id: 'X', type: 'mcq', options: ['a', 'b'], correctAnswer: null }]);
  assertEq(m.correctCount, 0, 'an unanswered question with no key is not "correct" (null === null)');
  assertEq(m.manualCount, 1, 'it goes to the instructor instead');
}

console.log('Sitting an exam: late start, programme, status and the clock (exams-18)');
{
  const p = makePage({ now: JM('2026-10-16', '13:50'), globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, ANN);
  p.exams.push(sampleExam());                                   // 13:00-14:00
  run(p, "startStudentExam('EXAM-1')");
  assert(!!p.currentExamSession, 'the exam starts by id');
  assert(p.currentExamSession.timeRemaining <= 600, 'a late starter gets only what is left of the window (got ' + p.currentExamSession.timeRemaining + 's)');
  assertEq(p.currentExamSession.deadline, JM('2026-10-16', '14:00'), 'the deadline is the window end');
  assert(p.currentExamSession.questions.every(q => !('correctAnswer' in q)), 'the attempt holds no answer keys (exams-04)');

  const o = makePage({ now: JM('2026-10-16', '13:30'), globals: { currentRole: 'student' } });
  o.currentStudent = Object.assign({}, BEN);
  o.exams.push(sampleExam());
  run(o, "startStudentExam('EXAM-1')");
  assertEq(o.currentExamSession, null, 'a trainee cannot start another programme\'s exam');
  const u = makePage({ now: JM('2026-10-16', '12:00'), globals: { currentRole: 'student' } });
  u.currentStudent = Object.assign({}, ANN);
  u.exams.push(sampleExam({ status: 'upcoming' }));
  run(u, "startStudentExam('EXAM-1')");
  assertEq(u.currentExamSession, null, 'or an exam that is not open yet');
}

console.log('Resume after a reload or power cut, with the original clock (exams-17, ui-04)');
{
  const store = {};
  const p = makePage({ now: JM('2026-10-16', '13:05'), store, globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, ANN);
  p.exams.push(sampleExam());
  run(p, "startStudentExam('EXAM-1')");
  run(p, 'selectExamAnswer(0, 2); selectExamAnswer(1, true)');
  p.__advance(1000);                                             // the debounced save
  const key = E.draftKey('STU-A', 'EXAM-1');
  assert(!!p.__store[key], 'the attempt is saved on this device under the trainee and exam');
  assert(p.__store[key].indexOf('correctAnswer') === -1, 'the saved attempt holds no answer keys (exams-04)');
  const deadline = p.currentExamSession.deadline;

  // "Reload": a fresh page over the same store, 20 minutes later.
  const r = makePage({ now: JM('2026-10-16', '13:25'), store: p.__store, globals: { currentRole: 'student' } });
  r.currentStudent = Object.assign({}, ANN);
  r.exams.push(sampleExam());
  run(r, "startStudentExam('EXAM-1')");
  assert(!!r.currentExamSession, 'the exam resumes');
  assertEq(JSON.stringify(r.currentExamSession.answers), '[2,true]', 'with the answers restored');
  assertEq(r.currentExamSession.deadline, deadline, 'and the ORIGINAL deadline');
  assert(r.currentExamSession.timeRemaining <= 35 * 60, 'no fresh full clock (got ' + r.currentExamSession.timeRemaining + 's)');

  // Away past the deadline: the saved answers are submitted on return.
  const z = makePage({ now: JM('2026-10-16', '15:00'), store: p.__store, globals: { currentRole: 'student' } });
  z.currentStudent = Object.assign({}, ANN);
  z.exams.push(sampleExam());
  run(z, "startStudentExam('EXAM-1')");
  assertEq(z.examResults.length, 1, 'an expired attempt is submitted with its saved answers');
  assertEq(z.examResults[0].score, 100, 'and marked against the exam\'s keys (both saved answers were right)');
  // Not removed: replaced by the small retired record (no answers), so a
  // second window still open on the attempt cannot write it back or submit
  // it again (CESTISCore.exams.retireAttempt).
  assert(E.attemptIsRetired(JSON.parse(z.__store[key] || 'null')) && z.__store[key].indexOf('"answers"') === -1, 'the saved attempt is retired once submitted');
  run(z, "startStudentExam('EXAM-1')");
  assertEq(z.examResults.length, 1, 'and opening the exam again never submits it a second time');

  // ...and she need not press anything: after the sign-in sync, a test whose
  // time ran out while she was away is submitted by itself, once, with the
  // note — it used to wait as "Submit saved answers" for a press that a
  // trainee who never came back to My Exams never gave (no result at all).
  const awayStore = JSON.parse(JSON.stringify(p.__store));
  const a = makePage({ now: JM('2026-10-16', '15:00'), store: awayStore, globals: { currentRole: 'student' } });
  a.CESTISStore.keys = function () { return Object.keys(a.__store); };
  a.currentStudent = Object.assign({}, ANN);
  a.exams.push(sampleExam());
  assertEq(run(a, 'examHasDraftFor("STU-A", true)'), false, 'a test whose time ran out is not "in progress, the clock is still running" at sign-in');
  assertEq(run(a, 'examHasDraftFor("STU-A")'), true, '(though its saved answers are still waiting)');
  assertEq(run(a, 'examSubmitExpiredAttempts()'), 1, 'after the sign-in sync it is submitted by itself');
  assertEq(a.examResults.length, 1, 'one result');
  assert(a.examResults[0].autoSubmitted === true && a.examResults[0].score === 100, 'marked as submitted automatically, with her saved answers (score ' + a.examResults[0].score + ')');
  assert(!!a.examResults[0].attemptId, 'and the attempt it came from');
  assertEq(run(a, 'examSubmitExpiredAttempts()'), 0, 'a second sign-in submits nothing more');
  assertEq(a.examResults.length, 1, 'still one result');
  // A test still running is left for her to continue.
  const b = makePage({ now: JM('2026-10-16', '13:30'), store: JSON.parse(JSON.stringify(p.__store)), globals: { currentRole: 'student' } });
  b.CESTISStore.keys = function () { return Object.keys(b.__store); };
  b.currentStudent = Object.assign({}, ANN);
  b.exams.push(sampleExam());
  assertEq(run(b, 'examSubmitExpiredAttempts()'), 0, 'a test whose clock is still running is not submitted at sign-in');
  assertEq(b.examResults.length + (b.currentExamSession ? 1 : 0), 0, 'nor opened behind her back');
  assertEq(run(b, 'examHasDraftFor("STU-A", true)'), true, 'and the sign-in points her to it');
  // Another trainee signed in: her expired test is not his to submit.
  const c2 = makePage({ now: JM('2026-10-16', '15:00'), store: JSON.parse(JSON.stringify(p.__store)), globals: { currentRole: 'student' } });
  c2.CESTISStore.keys = function () { return Object.keys(c2.__store); };
  c2.currentStudent = Object.assign({}, BEN, { course: 'Electrical' });
  c2.exams.push(sampleExam());
  assertEq(run(c2, 'examSubmitExpiredAttempts()'), 0, 'another trainee\'s sign-in never submits her test');
  // The result is stored before the attempt is closed: another window that
  // hears the close looks for the result (it said "will show here as soon as
  // it reaches this computer" while the result sat unsaved a moment longer).
  const se = extractFunction(SRC, 'submitExam');
  assert(se.indexOf("saveCollection('voctrain_examResults', examResults)") !== -1 && se.indexOf("saveCollection('voctrain_examResults', examResults)") < se.indexOf('X.retireAttempt('),
    'submitExam stores the result before it closes the attempt');
  // Submitted in another window of this PC (its result waits in this PC's
  // outbox) or on another device: the note says which.
  const w = makePage({ now: JM('2026-10-16', '15:00'), globals: { currentRole: 'student' } });
  w.__store.cestisExamOutbox = JSON.stringify([{ id: 'RES-1', examId: 'EXAM-1', studentId: 'STU-A', attemptId: 'ATT-1' }]);
  assertEq(run(w, "examSubmittedHere({ resultId: 'RES-1' }, ['ATT-9'])"), true, 'a result in this PC\'s outbox was submitted here (another window)');
  assertEq(run(w, "examSubmittedHere({ resultId: null }, ['ATT-1'])"), true, '(found by its attempt too)');
  assertEq(run(w, "examSubmittedHere({ resultId: 'RES-2' }, ['ATT-2'])"), false, 'anything else was submitted on another device');
  // A waiting result is let go once this PC's own upload of the Main copy
  // carried it (noted as serialised), not only after a later download.
  const asv = extractFunction(SRC, 'autoSaveToAllFolders');
  assert(asv.indexOf('examOutboxConfirm(_sentResultIds)') !== -1 && asv.indexOf('_sentResultIds = ') < asv.indexOf('ALL_DRIVE_FOLDERS.map(folder => silentSaveToFolder') &&
    /f\.id === GOOGLE_DRIVE_CONFIG\.FOLDER_ID && results\[i\]/.test(asv), 'the autosave lets a waiting result go once the Main copy\'s upload carried it');
  // On the Centre's network: let go once a push to the Centre's server
  // succeeded (it never downloads the online backup that used to confirm it).
  ASYNC_CHECKS.push((async () => {
    const mk = (pushOk) => {
      const q = makePage({ now: JM('2026-10-16', '15:00'), globals: { currentRole: 'student' } });
      q.__store.cestisExamOutbox = JSON.stringify([{ id: 'RES-9', examId: 'EXAM-1', studentId: 'STU-A' }]);
      q.__store.voctrain_examResults = JSON.stringify([{ id: 'RES-9', examId: 'EXAM-1', studentId: 'STU-A' }]);
      q.CESTISPageCloud = { lan: () => Promise.resolve(true), saveNow: () => Promise.resolve([pushOk]) };
      return q;
    };
    const good = mk(true), bad = mk(false);
    await run(good, 'examOutboxSendOnLan()');
    await run(bad, 'examOutboxSendOnLan()');
    assert(!good.__store.cestisExamOutbox, 'on the Centre\'s network a result is let go once its push succeeded');
    assert(!!bad.__store.cestisExamOutbox, 'and kept while the push fails');
    const off = makePage({ now: JM('2026-10-16', '15:00'), globals: { currentRole: 'student' } });
    off.__store.cestisExamOutbox = JSON.stringify([{ id: 'RES-9' }]);
    off.CESTISPageCloud = { lan: () => Promise.resolve(false), saveNow: () => Promise.resolve([true]) };
    await run(off, 'examOutboxSendOnLan()');
    assert(!!off.__store.cestisExamOutbox, 'online it is left to the online backup');
  })().catch(e => assert(false, 'examOutboxSendOnLan threw: ' + e.message)));
  // The top bar's chip hears of a result waiting to be sent (or sent) at once.
  assert(extractFunction(SRC, 'examOutboxWrite').indexOf('refreshSyncChip()') !== -1, 'the outbox tells the sync chip when it changes');
  // And the result opens at its top, where the note is.
  assert(/scrollTop = 0/.test(extractFunction(SRC, 'showExamResult')), 'the result page opens at its top (on a phone the note was scrolled out of sight)');
  const ea = extractFunction(SRC, 'enterApp');
  assert(/autoSyncOnLogin\(\)\.then\(function\(\) \{[\s\S]*?_afterLoginSync\(\)/.test(ea) && ea.indexOf('examAfterSignIn()') !== -1, 'enterApp runs it once the sign-in sync is done (or failed)');
  // "You have a test in progress" is said after that sync too, never from
  // this PC's own (possibly stale) copy as the pages are built.
  assert(extractFunction(SRC, 'buildStudentPages').indexOf('You have a test in progress') === -1, 'the pages are built without the in-progress note');
  const t1 = makePage({ now: JM('2026-10-16', '13:30'), store: JSON.parse(JSON.stringify(p.__store)), globals: { currentRole: 'student' } });
  t1.CESTISStore.keys = function () { return Object.keys(t1.__store); };
  t1.currentStudent = Object.assign({}, ANN); t1.exams.push(sampleExam());
  run(t1, 'examAfterSignIn()');
  assert(t1.__out.toasts.some(m => /You have a test in progress/.test(m)), 'after the sync, a running test is pointed out');
  const t2 = makePage({ now: JM('2026-10-16', '13:30'), store: JSON.parse(JSON.stringify(p.__store)), globals: { currentRole: 'student' } });
  t2.CESTISStore.keys = function () { return Object.keys(t2.__store); };
  t2.currentStudent = Object.assign({}, ANN); t2.exams.push(sampleExam());
  t2.examResults.push({ id: 'RES-ELSE', examId: 'EXAM-1', studentId: 'STU-A', submittedAt: '2026-10-16T18:20:00Z', attemptId: 'X' });
  run(t2, 'examAfterSignIn()');
  assert(!t2.__out.toasts.some(m => /in progress/.test(m)), 'a test the sync shows was finished elsewhere is not "in progress"');
  const t3 = makePage({ now: JM('2026-10-16', '15:00'), store: JSON.parse(JSON.stringify(p.__store)), globals: { currentRole: 'student' } });
  t3.CESTISStore.keys = function () { return Object.keys(t3.__store); };
  t3.currentStudent = Object.assign({}, ANN); t3.exams.push(sampleExam());
  run(t3, 'examAfterSignIn()');
  assert(t3.examResults.length === 1 && !t3.__out.toasts.some(m => /clock is still running/.test(m)), 'one whose time ran out is submitted, without "the clock is still running"');
}

console.log('Sign-out mid-exam never submits under the next trainee (exams-16, ui-03)');
{
  const p = makePage({ now: JM('2026-10-16', '13:05'), globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, ANN);
  p.exams.push(sampleExam({ course: 'Electrical' }));
  run(p, "startStudentExam('EXAM-1')");
  run(p, 'selectExamAnswer(0, 2)');
  assertEq(run(p, 'examEndSessionForSignOut(false)'), true, 'the session ends for sign-out');
  assertEq(p.currentExamSession, null, 'no attempt is left running on the page');
  p.currentStudent = Object.assign({}, BEN, { course: 'Electrical' });
  p.__advance(2 * 3600 * 1000);
  assertEq(p.examResults.length, 0, 'nothing is submitted when the old clock would have run out');
  assert(!!p.__store[E.draftKey('STU-A', 'EXAM-1')], 'Ann\'s answers are kept for Ann');

  // Even if a submit happens while someone else is signed in, it is refused.
  const q = makePage({ now: JM('2026-10-16', '13:05'), globals: { currentRole: 'student' } });
  q.currentStudent = Object.assign({}, ANN);
  q.exams.push(sampleExam());
  run(q, "startStudentExam('EXAM-1')");
  q.currentStudent = Object.assign({}, BEN, { course: 'Electrical' });
  run(q, 'submitExam(true)');
  assertEq(q.examResults.filter(r => r.studentId === 'STU-B').length, 0, 'an attempt is never recorded under whoever is signed in now');
  // A person pressing Sign Out is asked first.
  const c = makePage({ now: JM('2026-10-16', '13:05'), confirmAnswers: [true, false], globals: { currentRole: 'student' } });
  c.currentStudent = Object.assign({}, ANN);
  c.exams.push(sampleExam());
  run(c, "startStudentExam('EXAM-1')");
  assertEq(run(c, 'examEndSessionForSignOut(true)'), false, 'a trainee who presses Sign Out mid-exam can cancel');
  // The hooks are where they must be.
  const lo = extractFunction(SRC, 'logout');
  assert(lo.indexOf('examEndSessionForSignOut(') !== -1 && lo.indexOf('examEndSessionForSignOut(') < lo.indexOf('clearSensitiveStudentData'), 'logout() ends the exam session before anything is wiped');
  const ce = extractFunction(SRC, 'checkSessionExpiry');
  assert(ce.indexOf('examEndSessionForSignOut(false)') !== -1 && ce.indexOf('examEndSessionForSignOut(false)') < ce.indexOf('clearSensitiveDataOnExpiry'), 'an expiring session saves the attempt before the wipe');
}

console.log('Choices are real radio buttons; instructions are shown (ui-07, exams-22)');
{
  const p = makePage({ now: JM('2026-10-16', '13:05'), globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, ANN);
  p.exams.push(sampleExam());
  run(p, "startStudentExam('EXAM-1')");
  const html = p.__els.studentExamTakingView.innerHTML;
  assertEq((html.match(/<input type="radio" name="examAns-0"/g) || []).length, 4, 'each MCQ option is a named radio input');
  assertEq((html.match(/<input type="radio" name="examAns-1"/g) || []).length, 2, 'True/False are radio inputs too');
  assert(/<fieldset[^>]*>\s*<legend/.test(html), 'grouped in a fieldset with a legend');
  assert(html.indexOf('<li') === -1 && html.indexOf('onclick="selectExamAnswer') === -1, 'no mouse-only list items remain');
  assert(/aria-pressed="false"/.test(html) && /aria-label="Flag question 1/.test(html), 'the flag button is labelled and reports its state');
  assert(html.indexOf('Calculators allowed &lt;b&gt;only&lt;/b&gt;') !== -1, 'the exam instructions are shown, escaped');
  run(p, 'selectExamAnswer(0, 1)');
  assertEq(p.__els.studentExamTakingView.innerHTML, html, 'choosing an answer does not rebuild the exam (focus stays put)');
}

console.log('Marking, results and who sees what (exams-04, exams-12, exams-13, exams-14)');
{
  const p = makePage({ now: JM('2026-10-16', '13:05'), globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, ANN);
  p.exams.push(sampleExam());
  run(p, "startStudentExam('EXAM-1')");
  run(p, 'selectExamAnswer(0, 0); selectExamAnswer(1, false); submitExam()');
  const r = p.examResults[0];
  assertEq(r.studentId, 'STU-A', 'the result belongs to the trainee who sat it');
  assertEq(r.score, 0, 'marked against the exam\'s keys although the attempt carried none');
  assert(p.__out.notes.every(n => n.forRoles.indexOf('student') === -1), 'the score is announced to staff only, never to every trainee');
  const shown = p.__els.studentExamResultView.innerHTML;
  assert(shown.indexOf('Correct answer:') === -1, 'while the exam is open the correct answers are not shown');
  assert(/once the exam has closed/.test(shown), 'the trainee is told when they will be');
  p.__setNow(JM('2026-10-16', '14:30'));
  run(p, "viewExamResultDetail('EXAM-1','STU-A')");
  assert(/Correct answer: c\. Green\/Yellow/.test(p.__els.studentExamResultView.innerHTML), 'after the window closes they are shown');
  p.__setNow(JM('2026-10-16', '13:30'));
  p.exams[0].answersRelease = 'released';
  run(p, "viewExamResultDetail('EXAM-1','STU-A')");
  assert(/Correct answer: c\. Green\/Yellow/.test(p.__els.studentExamResultView.innerHTML), 'staff can release them early');
  p.__setNow(JM('2026-10-17', '09:00'));
  p.exams[0].answersRelease = 'withheld';
  run(p, "viewExamResultDetail('EXAM-1','STU-A')");
  assert(p.__els.studentExamResultView.innerHTML.indexOf('Correct answer:') === -1, 'or withhold them for good');
  assert(!!p.__store.cestisExamOutbox && p.__store.cestisExamOutbox.indexOf(r.id) !== -1, 'the submission is kept aside until the cloud holds it (exams-03)');

  // Old broadcast score notices are hidden from trainees.
  p.notifications = [{ id: 'N1', text: 'Ann Brown scored 45% on Unit 3 Test — NOT PASSED', forRoles: ['admin', 'instructor', 'student'] },
    { id: 'N2', text: 'Grading completed: Ann Brown scored 70% — PASSED', forRoles: ['admin', 'instructor', 'student'] },
    { id: 'N3', text: 'Exam activated: "Unit 3 Test" — students can now take this exam', forRoles: ['admin', 'instructor', 'student'] }];
  assertEq(run(p, 'getFilteredNotifications().map(function(n){return n.id;}).join()'), 'N3', 'a trainee no longer sees classmates\' scores already in the bell');
  p.currentRole = 'admin';
  assertEq(run(p, 'getFilteredNotifications().length'), 3, 'staff still do');

  // Grading: the trainee alone is told their mark.
  const g = makePage({ now: JM('2026-10-16', '15:00'), globals: { currentRole: 'instructor', currentInstructor: { id: 'INS-1', name: 'Mr Ivan', course: 'Electrical' } } });
  g.userAccounts.push({ id: 'USR-ANN', role: 'student', name: 'Ann Brown', studentDataId: 'STU-A' });
  g.exams.push(sampleExam({ status: 'completed' }));
  g.examResults.push({ id: 'R9', examId: 'EXAM-1', studentId: 'STU-A', studentName: 'Ann Brown', score: 50, totalPoints: 2, passed: false, needsReview: true, reviewComplete: false,
    answers: [{ type: 'mcq', points: 1, earnedPoints: 1, isCorrect: true, graded: true }, { type: 'short', points: 1, earnedPoints: 0, needsManualGrade: true, graded: false, questionText: 'x' }] });
  g.__els['gradePoints-1'].value = '1';
  run(g, "gradingResultId = 'R9'; submitGrading()");
  assertEq(g.examResults[0].score, 100, 'the manual mark is applied');
  assert(g.__out.notes.every(n => n.forRoles.indexOf('student') === -1), 'the grading notice goes to staff only');
  assert(g.__out.userNotes.length === 1 && g.__out.userNotes[0].userId === 'USR-ANN', 'the trainee gets their own result, addressed to their account');
  assertEq(g.exams[0].passRate, '100%', 'the completed exam\'s pass rate takes the newly marked result in');

  // exams-14: provisional is not final anywhere.
  const qual = { id: 'QL', units: [{ code: 'ELE-101', name: 'Unit 3 Test' }] };
  const rows = Core.Transcript.effectiveGrades({ qual, studentId: 'S', exams: [{ id: 'X', title: 'ELE-101 Unit 3 Test' }],
    examResults: [{ id: 'old', examId: 'X', studentId: 'S', score: 70, submittedAt: '2026-10-01T10:00:00Z' },
      { id: 'new', examId: 'X', studentId: 'S', score: 40, needsReview: true, submittedAt: '2026-10-16T10:00:00Z' }] });
  assertEq(rows[0].grade, null, 'a result awaiting marking is not the unit grade');
  assertEq(rows[0].source, 'pending', 'it shows as pending (and does not fall back to the older attempt)');
  assertEq(E.passRateOf([{ passed: true }, { passed: false, needsReview: true }]), '100%', 'pass rates leave pending results out');
  assertEq(E.averageOf([{ score: 80 }, { score: 20, needsReview: true }, { score: 10, archived: true }]), 80, 'averages leave pending and archived results out');
  const t = makePage({ now: JM('2026-10-16', '15:00'), globals: { currentRole: 'student' } });
  t.currentStudent = Object.assign({}, ANN);
  t.exams.push(sampleExam({ status: 'completed' }));
  t.examResults.push({ id: 'R1', examId: 'EXAM-1', studentId: 'STU-A', score: 40, passed: false, needsReview: true, reviewComplete: false, correctCount: 1, totalQuestions: 2 });
  run(t, 'renderStudentExams()');
  const past = t.__els.studentPastExamResults.innerHTML;
  assert(/Awaiting marking/.test(past) && !/>Failed</.test(past), 'the trainee sees "Awaiting marking", not "Failed"');
}

console.log('Exams sync by id; deletions and archives travel (exams-11, exams-20, missed demo-title filter)');
{
  const jan = { id: 'EXAM-jan', title: 'Module 1 Quiz', course: 'Welding', date: '2026-01-10', updatedAt: '2026-01-01T00:00:00Z' };
  const jun = { id: 'EXAM-jun', title: 'Module 1 Quiz', course: 'Welding', date: '2026-06-15', updatedAt: '2026-06-01T00:00:00Z' };
  const local = [Object.assign({}, jan)];
  Core.sync.mergeList(local, [jan, jun], E.syncKey, { tombs: E.translateLegacyTombs({}, local, [jan, jun]) });
  assertEq(local.map(e => e.id).sort().join(), 'EXAM-jan,EXAM-jun', 'two same-titled exams in one programme both survive a merge');
  assertEq(local.find(e => e.id === 'EXAM-jan').date, '2026-01-10', 'and January keeps its own content');
  // Legacy title|programme deletions: carried over only when unambiguous.
  const tombs = { 'unit 9|welding': '2026-09-01T00:00:00Z', 'module 1 quiz|welding': '2026-09-01T00:00:00Z' };
  const nine = { id: 'EXAM-9', title: 'Unit 9', course: 'Welding' };
  const tr = E.translateLegacyTombs(tombs, [nine, jan, jun], []);
  assert(!!tr['EXAM-9'], 'an old deletion of a uniquely titled exam still applies to it');
  assert(!tr['EXAM-jan'] && !tr['EXAM-jun'], 'an old deletion matching two exams deletes neither');
  // The page's own merge and stamping use the id.
  const merge = extractFunction(SRC, 'mergeBackupData');
  assert(merge.indexOf('CESTISCore.sync.mergeList(exams, backupData.data.exams, CESTISCore.exams.syncKey') !== -1, 'the page merges exams by id');
  assert(merge.indexOf('translateLegacyTombs(syncTombsFor(\'exams\')') !== -1, 'with the legacy deletions translated');
  assert(/accept: function\(c\)\{ return !_de\[c\.id\] && !\(_det\[c\.title\] && \(c\.id == null/.test(merge), 'a real exam with a demo-like title is no longer refused');
  assert(merge.indexOf('examArchiveResultsOf(') !== -1, 'an exam deleted elsewhere archives its results here');
  assert(/name: 'exams',[^\n]*CESTISCore\.exams\.syncKey/.test(extractFunction(SRC, 'syncCollections')), 'the save-time stamping keys exams by id');

  // deleteExam archives, never destroys.
  const p = makePage();
  p.exams.push(sampleExam());
  p.examResults.push({ id: 'R1', examId: 'EXAM-1', studentId: 'STU-A', score: 80, passed: true });
  run(p, "deleteExam('EXAM-1')");
  assertEq(p.exams.length, 0, 'the exam is deleted');
  assertEq(p.examResults.length, 1, 'its graded result is not destroyed');
  assert(p.examResults[0].archived === true && p.examResults[0].archivedReason === 'exam-deleted', 'it is archived, with the reason');
  assertEq(JSON.stringify(p.__out.tombed), '[["EXAM-1"]]', 'and the exam\'s deletion is written down');
}

console.log('A result not yet uploaded survives a classmate\'s sign-out on a shared PC (exams-03)');
{
  const store = { cestisExamOutbox: JSON.stringify([{ id: 'R-ANN', examId: 'EXAM-1', studentId: 'STU-A', score: 80 }]) };
  const p = makePage({ store, globals: { currentRole: 'student' } });
  p.currentStudent = Object.assign({}, BEN);
  p.examResults.push({ id: 'R-ANN', examId: 'EXAM-1', studentId: 'STU-A', score: 80 }, { id: 'R-BEN', examId: 'EXAM-1', studentId: 'STU-B', score: 60 });
  run(p, 'clearSensitiveStudentData()');
  assert(p.examResults.some(r => r.id === 'R-ANN'), 'Ben\'s sign-out keeps Ann\'s not-yet-uploaded result');
  assert(JSON.parse(p.__store.voctrain_examResults).some(r => r.id === 'R-ANN'), 'in the store too');
  const q = makePage({ store: { cestisExamOutbox: store.cestisExamOutbox } });
  q.examResults = [];
  assertEq(run(q, 'examOutboxRestore()'), 1, 'after a staff wipe, the next session puts it back');
  run(q, "examOutboxConfirm([{ id: 'R-ANN' }])");
  assert(!q.__store.cestisExamOutbox, 'once the cloud holds it, it is let go');
  assert(!/^voctrain_/.test(E.draftKey('a', 'b')) && !/^voctrain_/.test('cestisExamOutbox'), 'neither key is swept by the voctrain_ session wipe');
  assertEq(Core.isSnapshotableKey(E.draftKey('a', 'b')), false, 'an attempt in progress never goes into a shared snapshot');
}

console.log('Instructors, CSV export and Grade Now (exams-21, exams-23, exams-24)');
{
  const ins = { id: 'INS-1', name: 'Ivy', course: 'Electrical Installation' };
  // Both names belong to the same skill area — what instructorCourseMatch tests.
  const p = makePage({ globals: { currentRole: 'instructor', currentInstructor: ins,
    findSkillAreaForCourse(c) { return /^Electrical/.test(String(c)) ? { id: 'SK-ELEC' } : null; } } });
  p.__els.examCourse.options = [{ value: 'Agriculture' }, { value: 'Electrical Installation' }];
  p.__els.examCourse.value = 'Agriculture';
  run(p, 'examBuilderOpening()');
  assertEq(p.__els.examCourse.value, 'Electrical Installation', 'a new exam defaults to the instructor\'s own programme');
  p.exams.push(sampleExam({ course: 'Electrical', status: 'upcoming', createdBy: 'INS-1', date: '2026-10-20' }));
  run(p, "renderInstructorExams('upcoming')");
  assert(p.__els.iExamTableBody.innerHTML.indexOf('Unit 3 Test') !== -1, 'the instructor sees an exam of a matching programme name');

  const c = makePage({ globals: { currentRole: 'admin' } });
  c.exams.push(sampleExam({ title: 'Quiz "A", part 1' }));
  c.examResults.push({ id: 'R1', examId: 'EXAM-1', studentId: 'S1', studentName: '=HYPERLINK("http://x","Ann")', score: 40, correctCount: 1, totalQuestions: 2, passed: false, needsReview: true, submittedAt: 'T' });
  run(c, 'exportExamResults()');
  assert(c.__out.csv.indexOf('"Quiz ""A"", part 1"') !== -1, 'quotes inside a cell are doubled');
  assert(c.__out.csv.indexOf('"\'=HYPERLINK(""http://x"",""Ann"")"') !== -1, 'a value that would run as a formula is neutralised');
  assert(c.__out.csv.indexOf('"Pending review"') !== -1 && c.__out.csv.indexOf('"Failed"') === -1, 'a result awaiting marking is exported as Pending review');
  const ci = makePage({ globals: { currentRole: 'instructor', currentInstructor: { id: 'I', course: 'Plumbing' } } });
  ci.exams.push(sampleExam());
  ci.examResults.push({ id: 'R1', examId: 'EXAM-1', studentId: 'S1', studentName: 'Ann', score: 80, passed: true });
  run(ci, 'exportExamResults()');
  assert(ci.__out.csv.indexOf('Unit 3 Test') === -1 && ci.__out.csv.indexOf('Ann') === -1, 'an instructor exports their own programme only');

  const g = makePage({ missing: ['examResultsView', 'examListView', 'iExamResultsView', 'iExamListView'] });
  g.exams.push(sampleExam());
  let threw = false;
  try { run(g, "viewExamResults('EXAM-1'); backToExamList()"); } catch (e) { threw = e; }
  assertEq(threw, false, 'opening results where the exams page is not mounted does not throw');
}

console.log('The Moodle-style settings page saves its new options; an existing exam keeps its old behaviour (exam-platform preview)');
{
  const E = Core.exams;
  const same = (a, b, m) => assertEq(JSON.stringify(a), JSON.stringify(b), m);
  const fill = (p, v) => Object.keys(v).forEach(k => { p.__els[k].value = v[k]; });
  const base = { examTitle: 'Unit 4 Quiz', examCourse: 'Electrical', examDate: '2026-10-19', examTime: '09:00', examDuration: '45', examPassMark: '60', examShuffle: 'false' };
  const p = makePage({ now: JM('2026-10-16', '08:00') });
  run(p, 'examBuilderOpening()');
  same([p.__els.examPerPage.value, p.__els.examShuffleOptions.value, p.__els.examAllowFlag.value, p.__els.examCloseEnabled.checked],
    ['0', 'false', 'true', false], 'a new exam starts as every exam always was: one page, options in order, flagging on, no closing time');
  fill(p, Object.assign({}, base, { examPerPage: '3', examShuffleOptions: 'true', examAllowFlag: 'false', examCloseDate: '2026-10-23', examCloseTime: '17:00' }));
  p.__els.examCloseEnabled.checked = true;
  run(p, "examBuilderQuestions = [{ id:'M1', type:'multi', text:'PPE?', points:3, options:['a','b','c'], correctAnswer:[0,2] }, { id:'I1', type:'info', text:'Section B', points:0 }, { id:'N1', type:'numerical', text:'psi?', points:1, correctAnswer:15, tolerance:0 }]; createExam()");
  const e = p.exams[0];
  same([e.questionsPerPage, e.shuffleOptions, e.allowFlag, e.closeDate, e.closeTime, e.questions], [3, true, false, '2026-10-23', '17:00', 2],
    'every new setting is saved; the information item is not counted as a question');
  assertEq(E.statusAt(e, JM('2026-10-21', '12:00')), 'active', 'and the exam is open on the Wednesday, until it closes on Friday');

  const q = makePage({ now: JM('2026-10-16', '08:00') });
  fill(q, base);
  run(q, "examBuilderQuestions = [{ id:'M1', type:'multi', text:'PPE?', points:3, options:['a','b','c'], correctAnswer:[] }, { id:'T1', type:'match', text:'Match', points:2, pairs:[{prompt:'a',answer:''},{prompt:'b',answer:'B'}] }]; createExam()");
  assertEq(q.exams.length, 0, 'a "one or more" with nothing ticked, or a matching question missing an answer, cannot be saved');
  assert(/tick the right option/.test(q.__out.alerts.join(' ')) && /complete pairs/.test(q.__out.alerts.join(' ')), 'the author is told what each one needs');
  const c = makePage({ now: JM('2026-10-16', '08:00') });
  fill(c, Object.assign({}, base, { examCloseDate: '2026-10-18', examCloseTime: '09:00' }));
  c.__els.examCloseEnabled.checked = true;
  run(c, "examBuilderQuestions = [{ id:'Q1', type:'tf', text:'Q', points:1, correctAnswer:true }]; createExam()");
  assertEq(c.exams.length, 0, 'a closing time before the opening is refused');
  assert(/must close after it opens/.test(c.__out.alerts.join(' ')), 'with the reason');

  const o = makePage({ now: JM('2026-10-16', '08:00') });
  o.exams.push(sampleExam({ status: 'upcoming', date: '2026-10-20' }));
  run(o, "editExam('EXAM-1')");
  same([o.__els.examPerPage.value, o.__els.examShuffleOptions.value, o.__els.examAllowFlag.value, o.__els.examCloseEnabled.checked],
    ['0', 'false', 'true', false], 'an existing exam opens with its old behaviour selected');
  run(o, 'createExam()');
  const oe = o.exams[0];
  assert(!('closeDate' in oe) && !('closeTime' in oe), 'saving it adds no closing time');
  same([oe.questionsPerPage, oe.shuffleOptions, oe.allowFlag], [0, false, true], 'and keeps all-on-one-page, options in order, flagging on');
  assertEq(E.windowOf(oe).end - E.windowOf(oe).start, 60 * 60000, 'its window is still its duration');
}

console.log('A paged attempt: pages, flagging off, the summary and the on-page submit question (exam-platform preview)');
{
  const same = (a, b, m) => assertEq(JSON.stringify(a), JSON.stringify(b), m);
  const store = {};
  const qd = [
    { id: 'P1', type: 'multi', text: 'PPE?', points: 3, options: ['Helmet', 'Gloves', 'Sandals'], correctAnswer: [0, 1] },
    { id: 'P2', type: 'tf', text: 'Flashback arrestor?', points: 1, correctAnswer: true },
    { id: 'P3', type: 'numerical', text: 'psi?', points: 1, correctAnswer: 15, tolerance: 0, unit: 'psi' }
  ];
  const t = makePage({ now: JM('2026-10-16', '13:05'), store, globals: { currentRole: 'student' } });
  t.currentStudent = Object.assign({}, ANN);
  t.exams.push(sampleExam({ questionsPerPage: 1, allowFlag: false, questionData: qd }));
  run(t, "startStudentExam('EXAM-1')");
  let html = t.__els.studentExamTakingView.innerHTML;
  assert(/Page 1 of 3/.test(html) && /Next page/.test(html) && !/Previous page/.test(html), 'one question a page: page 1 of 3, Next page');
  assertEq((html.match(/<div class="exam-q /g) || []).length, 1, 'only this page\'s question is drawn');
  assert(/Select one or more:/.test(html) && (html.match(/<input type="checkbox" name="examAns-0"/g) || []).length === 3, '"Select one or more" with a real checkbox per option');
  assert(html.indexOf('examFlag-') === -1, 'flagging switched off: no flag button');
  assert(/Exam navigation/.test(html) && /id="examNav-2"/.test(html) && /Time left/.test(html), 'the navigation panel has a box for every question and the time left');
  run(t, 'examToggleMulti(0, 1, true); examToggleMulti(0, 0, true)');
  assertEq(JSON.stringify(t.currentExamSession.answers[0]), '[0,1]', 'ticked options are the answer, in option order');
  run(t, 'examGoPage(1)');
  html = t.__els.studentExamTakingView.innerHTML;
  assert(/Page 2 of 3/.test(html) && /Previous page/.test(html), 'Next page shows page 2, with Previous page');
  run(t, 'selectExamAnswer(1, true)');
  t.__advance(1000);
  const draft = JSON.parse(t.__store[Core.exams.draftKey('STU-A', 'EXAM-1')]);
  same([draft.page, draft.perPage, draft.allowFlag], [1, 1, false], 'the saved attempt remembers its page and layout');
  // Reload: back on page 2 with the answers.
  const r = makePage({ now: JM('2026-10-16', '13:20'), store: t.__store, globals: { currentRole: 'student' } });
  r.currentStudent = Object.assign({}, ANN);
  r.exams.push(sampleExam({ questionsPerPage: 1, questionData: qd }));
  run(r, "startStudentExam('EXAM-1')");
  assertEq(r.currentExamSession.page, 1, 'a resumed attempt opens on the page it was on');
  assert(/Page 2 of 3/.test(r.__els.studentExamTakingView.innerHTML), 'and draws it');
  run(r, 'examShowSummary()');
  html = r.__els.studentExamTakingView.innerHTML;
  assert(/Summary of attempt/.test(html) && /Submit all and finish/.test(html) && /Return to attempt/.test(html), 'Finish attempt shows the Summary of attempt');
  assertEq((html.match(/Answer saved/g) || []).length, 2, 'two questions show Answer saved');
  assert(/Not yet answered/.test(html), 'and the third Not yet answered');
  run(r, 'examConfirmSubmit()');
  const dlg = r.document.body.children[r.document.body.children.length - 1];
  assert(/You have <strong>1 unanswered question<\/strong>/.test(dlg.innerHTML) && /role="dialog"/.test(dlg.innerHTML), 'Submit all and finish asks on the page, saying one question is unanswered');
  assertEq(r.examResults.length, 0, 'nothing is submitted until it is confirmed');
  run(r, 'examSubmitConfirmed()');
  assertEq(r.examResults.length, 1, 'confirming submits');
  assertEq(r.examResults[0].earnedPoints, 4, 'marked against the exam\'s keys: both right options and True (3 + 1)');
  assertEq(r.examResults[0].totalQuestions, 3, 'three questions');
  assert(!!r.examResults[0].startedAt, 'the result records when the attempt started');
}

console.log('Shared libraries stay identical in both builds');
assert(fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'Offline System', 'cestis-core.js'), 'utf8'), 'cestis-core.js is byte-identical in Offline System/');

// The checks that wait on a promise (the Centre's network push) finish first.
Promise.all(ASYNC_CHECKS).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
