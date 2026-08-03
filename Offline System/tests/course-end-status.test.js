/* Unit tests for the course-end rule — when a trainee becomes Not Yet
   Competent, and when the Centre's own decision must be left alone.

   The Centre's rule: when a course ends, trainees who were never certified
   become Not Yet Competent, "until an administrator updates them". Two halves
   of that were broken:

     - trainees on programmes that had ended were NOT being marked. The sweep
       skipped any record with no course NAME, and resolved the centre by name
       alone, so a programme that had been renamed, removed or written another
       way left its trainees sitting in Testing;
     - statuses the Centre set by hand kept reverting. A centre with no dates
       counted as "open again", so every trainee the rule had auto-marked was
       dragged back to In Training on every page load — taking any status a
       person had set since with it.

   The functions are read straight out of index.html — the LMS keeps its logic
   inline — and run against a stubbed page.

   Run: node tests/course-end-status.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- Pull the rule out of the page ---------- */

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}') { depth--; if (!depth) return PAGE.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const NAMES = ['courseDurationRecord', 'studentCentreRecord', 'studentCourseStatus',
               'courseEndKeyFor', 'markStageSetByUser', 'applyCourseEndStatuses'];

/* Dates relative to a fixed "today" of 2026-08-03 (the tests never call
   Date.now() themselves — courseDuration.status does, against real time). */
const ENDED = { startDate: '2020-01-01', endDate: '2021-06-30' };
const OPEN = { startDate: '2026-01-01', endDate: '2027-06-30' };
const FUTURE = { startDate: '2099-01-01', endDate: '2099-12-31' };
const NO_DATES = { startDate: '', endDate: '' };

function makePage(centres, students) {
  const sandbox = {
    skillAreas: centres || [],
    students: students || [],
    CESTISCore: Core,
    console: { warn: function () {}, log: function () {} },
    Date: Date, Object: Object, Array: Array, String: String
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(extractFunction).join('\n\n'), sandbox);
  return sandbox;
}

function centre(over) { return Object.assign({ id: 'C1', name: 'Welding and Fabrication Level 2' }, over); }
function trainee(over) { return Object.assign({ id: 'S1', name: 'Ann Brown', course: 'Welding and Fabrication Level 2', stage: 'training' }, over); }

/* ---------- 1. A course that has ended marks its trainees ---------- */
console.log('Trainees of a course that has ended become Not Yet Competent');

let page = makePage([centre(ENDED)], [trainee(), trainee({ id: 'S2', stage: 'testing' })]);
assertEq(page.applyCourseEndStatuses(), true, 'the sweep reports a change');
assertEq(page.students[0].stage, 'nyc', 'the trainee in training is marked');
assertEq(page.students[1].stage, 'nyc', 'and so is the one still in testing');

console.log('Certified trainees are never demoted');

page = makePage([centre(ENDED)], [trainee({ stage: 'certified' }), trainee({ id: 'S2', stage: 'collected' })]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'certified', 'a certified trainee stands');
assertEq(page.students[1].stage, 'collected', 'and a collected one too');

console.log('A trainee whose programme no longer has a name of its own is still marked');

// The course was renamed / removed; the trainee carries the centre they were
// enrolled in. This is the record the old rule skipped outright.
page = makePage([centre(ENDED)], [trainee({ course: '', centreId: 'C1' })]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'nyc', 'resolved through the stamped centre id');

page = makePage([], [trainee({ course: '', centreId: null, courseStart: '2020-01-01', courseEnd: '2021-06-30' })]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'nyc', 'and through their own course dates when the centre is gone');

console.log('A programme written the fee side\'s way still finds its centre');

page = makePage([centre(ENDED)], [trainee({ course: 'WELDING L2', enrolmentDate: '2020-06-01' })]);
assertEq(page.studentCourseStatus(page.students[0]), 'ended', 'the abbreviation resolves through the shared rule');
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'nyc', 'so the trainee is marked');

console.log('A course nobody can place leaves its trainees alone');

page = makePage([], [trainee({ course: 'Something Unknown', stage: 'training' })]);
assertEq(page.applyCourseEndStatuses(), false, 'nothing is guessed');
assertEq(page.students[0].stage, 'training', 'and nothing is changed');

/* ---------- 2. An open course does not mark anybody ---------- */
console.log('A course still running marks nobody');

page = makePage([centre(OPEN)], [trainee()]);
assertEq(page.applyCourseEndStatuses(), false, 'no change');
assertEq(page.students[0].stage, 'training', 'the trainee carries on');

page = makePage([centre(FUTURE)], [trainee({ stage: 'testing' })]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'testing', 'nor does one that has not started');

/* ---------- 3. Extending a course undoes only what the rule did ---------- */
console.log('Extending a course returns the trainees the rule marked');

page = makePage([centre(ENDED)], [trainee()]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'nyc', 'marked while ended');
page.skillAreas[0].endDate = OPEN.endDate;
page.skillAreas[0].startDate = OPEN.startDate;
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'training', 'and returned when the course is extended');

console.log('A status the Centre set by hand is never undone');

page = makePage([centre(ENDED)], [trainee()]);
page.applyCourseEndStatuses();                       // auto-marked NYC
page.markStageSetByUser(page.students[0]);           // an administrator confirms it
page.skillAreas[0].endDate = OPEN.endDate;
page.skillAreas[0].startDate = OPEN.startDate;
assertEq(page.applyCourseEndStatuses(), false, 'the extension changes nothing');
assertEq(page.students[0].stage, 'nyc', 'their decision stands');

console.log('A trainee marked Not Yet Competent by hand is left alone');

page = makePage([centre(OPEN)], [trainee({ stage: 'nyc' })]);   // never auto-marked
assertEq(page.applyCourseEndStatuses(), false, 'no change');
assertEq(page.students[0].stage, 'nyc', 'a hand-set status on an open course stands');

console.log('A centre with no dates says nothing, and undoes nothing');

// This is the loop the Centre kept seeing: a centre whose dates are blank read
// as "open again", so every auto-marked trainee went back to In Training on
// every page load, over and over.
page = makePage([centre(ENDED)], [trainee()]);
page.applyCourseEndStatuses();
assertEq(page.students[0].stage, 'nyc', 'marked while ended');
page.skillAreas[0].startDate = NO_DATES.startDate;
page.skillAreas[0].endDate = NO_DATES.endDate;
assertEq(page.applyCourseEndStatuses(), false, 'blank dates change nothing');
assertEq(page.students[0].stage, 'nyc', 'the trainee is not dragged back to In Training');

/* ---------- 4. One ending is acted on once ---------- */
console.log('The rule acts on a course ending once, then leaves it to the Centre');

page = makePage([centre(ENDED)], [trainee()]);
page.applyCourseEndStatuses();
page.students[0].stage = 'training';                 // the administrator puts them back
assertEq(page.applyCourseEndStatuses(), false, 'the same ending does not re-mark them');
assertEq(page.students[0].stage, 'training', 'their change survives the next sweep');

console.log('A status set before the sweep ever ran is respected too');

page = makePage([centre(ENDED)], [trainee({ stage: 'testing' })]);
page.markStageSetByUser(page.students[0]);           // set on the day the course ended
assertEq(page.applyCourseEndStatuses(), false, 'the sweep does not overrule it');
assertEq(page.students[0].stage, 'testing', 'the Centre\'s status stands');

console.log('A NEW intake that ends is a new decision');

page = makePage([centre(ENDED)], [trainee()]);
page.applyCourseEndStatuses();
page.students[0].stage = 'training';
page.skillAreas[0].endDate = '2022-06-30';           // a different course ending
assertEq(page.applyCourseEndStatuses(), true, 'the later ending is acted on');
assertEq(page.students[0].stage, 'nyc', 'and marks them again');

console.log('Running the sweep twice changes nothing further');

page = makePage([centre(ENDED)], [trainee(), trainee({ id: 'S2', stage: 'testing' })]);
page.applyCourseEndStatuses();
assertEq(page.applyCourseEndStatuses(), false, 'the second pass is a no-op');

/* ---------- 5. A hand-set status is stamped so the cloud keeps it ---------- */
console.log('A hand-set status is stamped, so a sync cannot pull the old one back');

page = makePage([centre(ENDED)], [trainee()]);
page.markStageSetByUser(page.students[0]);
assert(!!page.students[0].lastModified, 'the edit carries the moment it was made');
assertEq(page.students[0].stageSetByUser, true, 'and is marked as the Centre\'s own');
assertEq(page.students[0]._nycAuto, undefined, 'the rule no longer claims it');

/* ---------- Result ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
