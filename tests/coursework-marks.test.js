/* Coursework: due dates, marks, attempts and files behave the way a training
   centre needs them to.

   What went wrong, and what these tests pin:
     - an assignment due 16 October showed "Past Due" from 7 PM on the 15th in
       Jamaica: 'YYYY-MM-DD' was read as UTC midnight. A due day now means the
       end of that day, here;
     - the gradebook averaged raw points (8/10 and 80/100 made 44), ignored
       the Weight (%) it asked for, read a legitimate 0 as "not graded", and
       hid every assignment column whenever the course had an exam;
     - the trainee dashboard's "Assignments Done" and "GPA" were the seed
       values (0/10, 0.0) for ever; they now come from the marks, and a GPA an
       administrator typed by hand still stands;
     - a changed mark overwrote the old one with no trace; it is now logged
       with who, when and what it was;
     - a resubmission spliced the earlier attempt away, a marked trainee could
       not resubmit even when the instructor allowed it, and a 0 counted as
       "not marked" so the re-upload button appeared; attempts are now kept
       as history and resubmission after marking follows the assignment's
       setting;
     - a double tap on Submit created two submissions and two uploads;
     - files of any size were embedded in the Centre's data; there is now a
       5 MB limit, and a file Drive holds is kept as its link, not its bytes;
     - submission files were shared with "anyone with the link";
     - resources matched programmes by shared words ("Information Technology"
       showed to "Solar Energy Tech"); they now follow the assignment rule.

   Run: node tests/coursework-marks.test.js */
'use strict';
process.env.TZ = 'America/Jamaica';   // before the first Date is made

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const at = (s) => new Date(s);   // local time (TZ above)
const pending = [];

PAGES.forEach(function (page) {
  const CW = page.core.coursework;
  const w = page.where.replace('/index.html', '');

  /* ---------- 1. Due dates are calendar days in Jamaica ---------- */
  console.log('A due date is the end of that day, here (' + w + ')');
  assertEq(CW.isPastDue('2026-10-16', at('2026-10-15T19:30:00')), false, 'not past due at 7:30 PM the evening before');
  assertEq(CW.isPastDue('2026-10-16', at('2026-10-16T12:00:00')), false, 'not past due at noon on the due day');
  assertEq(CW.isPastDue('2026-10-16', at('2026-10-16T23:59:00')), false, 'not past due one minute before midnight');
  assertEq(CW.isPastDue('2026-10-16', at('2026-10-17T00:00:01')), true, 'past due once the day is over');
  assertEq(CW.isPastDue('', at('2026-10-17T00:00:01')), false, 'no due date is never past due');
  assertEq(CW.localDateStr(at('2026-10-20T21:00:00')), '2026-10-20', 'the local day, not the UTC day, at 9 PM');
  assertEq(CW.daysUntil('2026-10-16', at('2026-10-16T08:00:00')), 0, 'due today is 0 days away all day');
  assertEq(CW.daysUntil('2026-10-18', at('2026-10-16T20:00:00')), 2, 'two days away in the evening too');
  assertEq(CW.isDateOnly('20/11/2026'), false, 'a slash date is not a calendar day the grid understands');
  assertEq(CW.isDateOnly('2026-02-30'), false, 'an impossible day is refused');

  /* ---------- 2. Gradebook maths ---------- */
  console.log('Marks: percentages of their own maximum, weighted, 0 counts (' + w + ')');
  assertEq(CW.gradeValue(0), 0, 'a 0 is a mark');
  assertEq(CW.gradeValue('0'), 0, 'a stored "0" is a mark');
  assertEq(CW.gradeValue(''), null, 'blank is not a mark');
  assertEq(CW.gradeValue(undefined), null, 'missing is not a mark');
  assertEq(CW.percentOf(8, 10), 80, '8/10 is 80%');
  assertEq(CW.percentOf(80, 100), 80, '80/100 is 80%');
  assertEq(Math.round(CW.weightedAverage([{ pct: 80, weight: 10 }, { pct: 80, weight: 10 }])), 80, '8/10 and 80/100 average 80, not 44');
  // A final project at 40% (scored 50%) and a quiz at 10% (scored 100%):
  assertEq(CW.weightedAverage([{ pct: 50, weight: 40 }, { pct: 100, weight: 10 }]), 60, 'weights are applied: (50*40 + 100*10) / 50 = 60');
  assertEq(CW.weightedAverage([{ pct: 0, weight: 10 }, { pct: 100, weight: 10 }]), 50, 'a 0 pulls the average down instead of vanishing');
  assertEq(CW.weightedAverage([{ pct: null, weight: 10 }]), null, 'nothing marked is no average, not 0%');
  assertEq(CW.weightOf('abc'), CW.DEFAULT_WEIGHT, 'an unreadable weight counts as a standard item');

  /* ---------- 3. Dashboard figures come from the marks ---------- */
  console.log('Dashboard: marked count and GPA from the marks (' + w + ')');
  const assignments = [
    { id: 'A1', maxPoints: 10, weight: 40, grades: { S1: 5 } },
    { id: 'A2', maxPoints: 100, weight: 10, grades: { S1: 100 } },
    { id: 'A3', maxPoints: 20, weight: 10, grades: {} }
  ];
  const sum = CW.studentSummary('S1', { assignments: assignments, examResults: [] });
  assertEq(sum.graded, 2, 'two assignments are marked');
  assertEq(sum.total, 3, 'out of three for the programme');
  assertEq(sum.percent, 60, 'the weighted average');
  assertEq(sum.gpa, '2.0', '60% is a C, 2.0');
  const withExam = CW.studentSummary('S1', { assignments: [], examResults: [
    { studentId: 'S1', examId: 'E1', score: 40, submittedAt: '2026-01-01' },
    { studentId: 'S1', examId: 'E1', score: 90, submittedAt: '2026-02-01' },
    { studentId: 'S2', examId: 'E1', score: 10 }
  ] });
  assertEq(withExam.percent, 90, 'an exam counts once, by its latest attempt, and only for its own trainee');
  assertEq(CW.effectiveGpa('0.0', '3.0'), '3.0', 'the seed GPA gives way to the marks');
  assertEq(CW.effectiveGpa('3.25', '1.0'), '3.25', 'a GPA set by hand stands');
  assertEq(CW.effectiveGpa('', null), '0.0', 'nothing either way reads 0.0');

  /* ---------- 4. Grade audit trail ---------- */
  console.log('A changed mark leaves a record (' + w + ')');
  const a = { id: 'A1', maxPoints: 10, grades: {} };
  let r = CW.recordGrade(a, 'S1', 7, 'Ina Instructor', '2026-10-01T10:00:00.000Z');
  assert(r.changed && a.grades.S1 === 7, 'the first mark is recorded');
  r = CW.recordGrade(a, 'S1', 0, 'Ina Instructor', '2026-10-02T10:00:00.000Z');
  assert(r.changed && a.grades.S1 === 0 && r.previous === 7, 'a re-mark to 0 is a change, and says what it was');
  assertEq(a.gradeLog.length, 2, 'both marks are in the log');
  assertEq(JSON.stringify(a.gradeLog[1]), JSON.stringify({ studentId: 'S1', points: 0, previous: 7, gradedBy: 'Ina Instructor', gradedAt: '2026-10-02T10:00:00.000Z' }), 'the log entry holds who, when, the mark and the previous mark');
  assertEq(a.gradeMeta.S1.gradedBy, 'Ina Instructor', 'the latest marker is on the record');
  assertEq(CW.recordGrade(a, 'S1', 0, 'X', 'later').changed, false, 'the same mark again is not a change');

  /* ---------- 5. Attempts and resubmission ---------- */
  console.log('Attempts are kept; resubmission follows the assignment (' + w + ')');
  const subs = [
    { id: 'SUB-1', assignmentId: 'A1', studentId: 'S1', submittedAt: '2026-10-01T10:00:00Z', attempt: 1 },
    { id: 'SUB-2', assignmentId: 'A1', studentId: 'S1', submittedAt: '2026-10-03T10:00:00Z', attempt: 2, previousId: 'SUB-1' },
    { id: 'SUB-3', assignmentId: 'A1', studentId: 'S2', submittedAt: '2026-10-02T10:00:00Z' }
  ];
  assertEq(CW.latestSubmission(subs, 'A1', 'S1').id, 'SUB-2', 'the newest attempt counts');
  assertEq(CW.submissionHistory(subs, 'A1', 'S1').map(s => s.id).join(','), 'SUB-1,SUB-2', 'earlier attempts remain, oldest first');
  assertEq(CW.latestPerStudent(subs, 'A1').length, 2, 'one entry per trainee in the counts');
  assertEq(CW.canSubmit({ requireSubmission: true }, false, null), true, 'a first submission is allowed');
  assertEq(CW.canSubmit({}, true, null), true, 'unmarked work can be replaced');
  assertEq(CW.canSubmit({}, true, 0), false, 'a 0 is a mark: no resubmission unless allowed');
  assertEq(CW.canSubmit({ allowResubmission: true }, true, 6), true, 'marked work may come back when the assignment allows it');

  /* ---------- 6. File size and resource scope ---------- */
  console.log('Files have a size limit; resources follow the programme rule (' + w + ')');
  assertEq(CW.oversizeFiles([{ name: 'ok.pdf', size: 4 * 1048576 }, { name: 'big.mp4', size: 30 * 1048576 }]).join(), 'big.mp4', 'a 30 MB video is turned away');
  const same = (s, c) => s === c;   // stands in for instructorCourseMatch
  assertEq(CW.resourceVisible('General', 'Welding Level 2', same), true, "'General' resources are for everyone");
  assertEq(CW.resourceVisible('', 'Welding Level 2', same), true, 'a resource with no programme is for everyone');
  assertEq(CW.resourceVisible('Information Technology', 'Solar Energy Tech', same), false, 'IT materials do not reach Solar trainees');
  assertEq(CW.resourceVisible('Welding Level 3', 'Welding Level 2', same), false, 'Level 3 materials do not reach Level 2');
  assertEq(CW.resourceVisible('Welding Level 2', 'Welding Level 2', same), true, 'a trainee sees their own programme');

  /* ---------- 7. The page uses the rules ---------- */
  console.log('The page wiring (' + w + ')');
  const src = page.src;
  assertEq((src.match(/new Date\(a\.dueDate\) < new Date\(\)/g) || []).length, 0, 'no assignment view parses the due date as UTC');
  assertEq((src.match(/CESTISCore\.coursework\.isPastDue\(a\.dueDate\)/g) || []).length, 4, 'all four assignment views use the local due-day rule');
  const res = extractFunction(src, 'renderStudentDriveResources', w);
  assert(/CESTISCore\.coursework\.resourceVisible\(resCourse, studentCourse, instructorCourseMatch\)/.test(res) && !/indexOf\(sc\)/.test(res), 'resources use the assignment programme rule, not substring matching');
  ['uploadSubmissionFileToDrive', 'uploadAssignmentFileToDrive'].forEach(fn => {
    assert(!/type: 'anyone'/.test(extractFunction(src, fn, w)), fn + ' never shares with "anyone with the link"');
  });
  const book = src.slice(src.indexOf('// Build gradebook dynamically'), src.indexOf('// Grade distribution from actual scores'));
  // The columns and their marks come from CESTISCore.coursework.gradebook
  // (every exam and assignment, newest first — tests/gradebook-all-items.test.js),
  // which reads each assignment mark with percentOf.
  assert(/instructorGradebookData\(ins, myStudents, myExams\)/.test(book) && /CW\.weightedAverage\(/.test(book) && !/parseInt\(g\)\|\|null/.test(book) &&
    /percentOf\(c\.src\.grades/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'cestis-core.js'), 'utf8')), 'the gradebook table uses percentages, weights and keeps 0');
  const kinds = require('../cestis-core.js').coursework.gradebook({ students: [], exams: [{ id: 'E1', date: '2026-01-01' }], assignments: [{ id: 'A1', dueDate: '2026-01-02' }] }).columns.map(c => c.kind);
  assert(/book\.columns\.map\(function\(c\)\{ return c\.label; \}\)/.test(book) && kinds.indexOf('exam') !== -1 && kinds.indexOf('assignment') !== -1, 'exam and assignment columns sit side by side');
  assert(/<th>'\+escapeHtml\(c\)\+'<\/th>/.test(book), 'column titles are escaped');
  const dash = extractFunction(src, 'buildStudentPages', w);
  assert(/cwSum\.graded\}\/\$\{cwSum\.total\}/.test(dash) && /escapeHtml\(shownGpa\)/.test(dash), 'the dashboard tiles show the marks, not the seed values');
  assert(!/mySub && !myGrade/.test(src), 'nowhere reads a 0 mark as "not marked"');

  /* ---------- 8. Grading through the page records the trail ---------- */
  console.log('Grading on the page (' + w + ')');
  {
    const asg = { id: 'A9', title: 'Weld test', maxPoints: 10, grades: { S1: 4 }, gradeMeta: { S1: { resubmittedAt: 'x' } } };
    const input = { value: '0' };
    const sb = {
      CESTISCore: page.core, instructorAssignments: [asg], students: [{ id: 'S1', name: 'Ann' }],
      currentLoggedInUser: { name: 'Ina' }, currentInstructor: null, currentRole: 'instructor',
      document: { getElementById: () => input }, toasts: [],
      showToast(t) { sb.toasts.push(t); }, saveState() { sb.saved = (sb.saved || 0) + 1; }, scheduleDebouncedCloudSave() {}, saveAssignmentsToDrive() {},
      addNotification(t, ty, ic, roles) { sb.roles = roles; }, renderInstructorGradebook() {}, refreshContentDependentViews() {}
    };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'gradeSubmission', w), sb);
    vm.runInContext('gradeSubmission("A9", "S1")', sb);
    assertEq(asg.grades.S1, 0, 'a 0 is accepted as a mark');
    assertEq(asg.gradeLog && asg.gradeLog[0].previous, 4, 'the previous mark is logged');
    assertEq(asg.gradeLog[0].gradedBy, 'Ina', 'the marker is logged');
    assertEq(asg.gradeMeta.S1.resubmittedAt, undefined, 're-marking clears the "resubmitted" flag');
    assert(/was 4/.test(sb.toasts.join()), 'the instructor is told what the mark was');
    assert(sb.roles && sb.roles.indexOf('student') === -1, "a trainee's mark is not announced to the whole class");
  }

  /* ---------- 9. Submitting: one at a time, attempts kept, Drive link instead of bytes ---------- */
  console.log('Submitting on the page (' + w + ')');
  {
    const els = {};
    const el = id => els[id] || (els[id] = { value: '', textContent: '', disabled: false });
    const asg = { id: 'A1', title: 'Report', requireSubmission: true, grades: { S1: 6 }, allowResubmission: true, gradeMeta: { S1: { gradedAt: 't' } } };
    const prior = { id: 'SUB-OLD', assignmentId: 'A1', studentId: 'S1', submittedAt: '2026-10-01T00:00:00Z', files: [{ name: 'v1.pdf', dataUrl: 'data:,old' }] };
    let release;
    const gate = new Promise(r => { release = r; });
    let uploads = 0;
    const sb = {
      CESTISCore: page.core, instructorAssignments: [asg], assignmentSubmissions: [prior],
      currentStudent: { id: 'S1', name: 'Ann', course: 'Welding' },
      _submitPendingFiles: [{ name: 'v2.pdf', size: 1000, type: 'application/pdf' }],
      isCloudConnected: true, googleAccessToken: 'tok',
      document: { getElementById: el }, Promise, console: { log() {}, warn() {} },
      fileToDataUrl(f) { return Promise.resolve({ name: f.name, size: f.size, type: f.type, dataUrl: 'data:,BYTES' }); },
      uploadSubmissionFileToDrive() { uploads++; return gate.then(() => ({ id: 'DRV1', name: 'Ann_Report_v2.pdf', webViewLink: 'https://drive.google.com/file/d/DRV1/view' })); },
      cestisGenId(p) { return p + Math.random().toString(36).slice(2); },
      showToast(t) { sb.toast = t; }, saveState() {}, scheduleDebouncedCloudSave() {}, saveAssignmentsToDrive() {}, closeModal() {},
      addNotification() {}, renderStudentAssignments() {}, renderStudentAssignmentsPage() {}, refreshContentDependentViews() {}
    };
    vm.createContext(sb);
    const fnSrc = extractFunction(src, 'submitStudentAssignment', w);
    vm.runInContext('var _submitInFlight = false;\n' + fnSrc, sb);
    el('submitAssignId').value = 'A1';
    const first = vm.runInContext('submitStudentAssignment()', sb);
    vm.runInContext('submitStudentAssignment()', sb);   // the impatient second tap
    assert(el('submitAssignBtn').disabled === true, 'the Submit button is disabled while the first one runs');
    release();
    pending.push(first.then(function () {
      const mine = sb.assignmentSubmissions.filter(s => s.studentId === 'S1');
      assertEq(uploads, 1, 'the file is uploaded once, not twice');
      assertEq(mine.length, 2, 'one new attempt, and the earlier attempt is still there');
      const neu = mine.find(s => s.id !== 'SUB-OLD');
      assertEq(neu.attempt, 2, 'the new one is attempt 2');
      assertEq(neu.previousId, 'SUB-OLD', 'it points back at the attempt before it');
      assertEq(neu.files.length, 0, 'a file Drive holds is not embedded again');
      assertEq(neu.driveFiles[0].id, 'DRV1', 'it is kept as its Drive link');
      assertEq(neu.driveFiles[0].origName, 'v2.pdf', 'with the name the trainee gave it');
      assertEq(asg.gradeMeta.S1.resubmittedAt, neu.submittedAt, 'the instructor is flagged to re-mark');
      assertEq(el('submitAssignBtn').disabled, false, 'the button comes back afterwards');
    }));
  }
});

Promise.all(pending).catch(function (e) { assert(false, 'submitting threw: ' + (e && e.stack || e)); }).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
