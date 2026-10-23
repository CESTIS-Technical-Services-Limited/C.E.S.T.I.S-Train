/* The course-end "Not Yet Competent" rule reads the trainee's transcript.

   When a course ended, every trainee who was not yet certified was marked Not
   Yet Competent — whatever their transcript said. A trainee with every unit
   marked competent, waiting only for the administrator to issue the
   certificate, became NYC the day the course closed; so did one whose last
   exam was still being marked, and nobody could see why anyone was NYC.

   The Centre's rule now (CESTISCore.courseEnd.decide, used by the dashboard's
   sweep and by Student Progress):
     (a) every core unit competent, nothing awaiting marking -> NOT NYC; the
         stage is left and the trainee is flagged "Ready to certify";
     (b) a unit still awaiting marking -> not NYC yet; "Awaiting marking", and
         the next sweep looks again;
     (c) a core unit NYC or without a result -> NYC, with the units named;
     (d) a programme with no unit catalogue -> NYC, exactly as before;
   and a stage a PERSON set for this ending is never overridden.

   Part 1 runs the pure rule; part 2 feeds it real transcript records through
   Core.Transcript.transcriptReadiness; part 3 runs the dashboard's own sweep
   (read out of index.html) and Student Progress's own marker and display
   (read out of Student-Progress.html) against a stubbed page.

   Run: node tests/course-end-transcript.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const CE = Core.courseEnd;
const T = Core.Transcript;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const END = '2026-06-30';
const NOW = '2026-07-01T09:00:00.000Z';
function readiness(over) {
  return Object.assign({ status: 'ready', ready: true, known: true, total: 4, graded: 4, competent: 4, nyc: 0, pending: 0,
    missingCore: [], nycUnits: [], pendingUnits: [] }, over);
}
function trainee(over) { return Object.assign({ id: 'S1', name: 'Shanice Campbell', stage: 'training' }, over); }
function run(s, opts) {
  const d = CE.decide(s, Object.assign({ status: 'ended', endKey: END, nowIso: NOW }, opts));
  CE.apply(s, d);
  return d;
}

/* ---------- 1. The rule itself ---------- */
console.log('(a) Every core unit competent: not NYC, flagged ready to certify');

let s = trainee();
let d = run(s, { readiness: readiness() });
assertEq(d.outcome, 'ready', 'the outcome is ready');
assertEq(s.stage, 'training', 'the stage is left as it was');
assertEq(s.courseEndState, 'ready', 'the trainee is flagged ready');
assertEq(s.readyToCertifyAt, NOW, 'with the moment it was found');
assertEq(s._nycAuto, undefined, 'the rule claims no NYC');
assertEq(s._nycForCourseEnd, undefined, 'and does not close the ending — a later grade change still counts');
assertEq(CE.flag(s).label, 'Ready to certify', 'shown as "Ready to certify"');
d = run(s, { readiness: readiness(), nowIso: '2026-07-02T09:00:00.000Z' });
assertEq(d.changed, false, 'a second sweep changes nothing');
assertEq(s.readyToCertifyAt, NOW, 'and does not re-date the flag');

console.log('A failed elective does not stop a trainee whose core units are all competent');

s = trainee();
d = run(s, { readiness: readiness({ status: 'nyc', ready: false, competent: 3, nyc: 1, nycUnits: ['ELEC-1'] }) });
assertEq(d.outcome, 'ready', 'electives are not required');
assertEq(s.stage, 'training', 'not marked NYC');

console.log('(b) Results still awaiting marking: not NYC yet');

s = trainee({ stage: 'testing' });
d = run(s, { readiness: readiness({ status: 'incomplete', ready: false, missingCore: ['WEL-05'], pendingUnits: ['WEL-05'], pending: 1 }) });
assertEq(d.outcome, 'awaiting-marking', 'the outcome is awaiting marking');
assertEq(s.stage, 'testing', 'the stage is left as it was');
assertEq(s.courseEndState, 'awaiting-marking', 'the trainee is flagged awaiting marking');
assert(/WEL-05/.test(s.courseEndReason), 'naming the unit being marked');
assertEq(s._nycForCourseEnd, undefined, 'the ending stays open for the next sweep');
assertEq(CE.flag(s).label, 'Awaiting marking', 'shown as "Awaiting marking"');

// Even with another core unit already NYC: the decision waits for the marking.
s = trainee();
d = run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-02', 'WEL-05'], nycUnits: ['WEL-02'], pendingUnits: ['WEL-05'] }) });
assertEq(d.outcome, 'awaiting-marking', 'any unit being marked holds the decision');
assertEq(s.stage, 'training', 'no NYC yet');

console.log('...and the next sweep decides once the marking is done');

s = trainee();
run(s, { readiness: readiness({ status: 'incomplete', missingCore: ['WEL-05'], pendingUnits: ['WEL-05'] }) });
d = run(s, { readiness: readiness() });
assertEq(d.outcome, 'ready', 'marked competent -> ready');
assertEq(s.courseEndState, 'ready', 'the flag moves on');
assert(!!s.readyToCertifyAt, 'and is dated');

s = trainee();
run(s, { readiness: readiness({ status: 'incomplete', missingCore: ['WEL-05'], pendingUnits: ['WEL-05'] }) });
d = run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-05'], nycUnits: ['WEL-05'] }) });
assertEq(d.outcome, 'nyc', 'marked not yet competent -> NYC');
assertEq(s.stage, 'nyc', 'the trainee is NYC');
assertEq(s.courseEndReason, 'Not yet competent: WEL-05', 'and the reason names the unit');

console.log('(c) A core unit NYC or without a result: NYC, with the units named');

s = trainee();
d = run(s, { readiness: readiness({ status: 'nyc', ready: false, missingCore: ['WEL-02', 'WEL-07', 'WEL-09'], nycUnits: ['WEL-02', 'ELEC-1'] }) });
assertEq(d.outcome, 'nyc', 'the outcome is NYC');
assertEq(s.stage, 'nyc', 'the trainee is marked NYC');
assertEq(s._nycAuto, true, 'by the rule');
assertEq(s._nycForCourseEnd, END, 'once for this ending');
assertEq(s.courseEndReason, 'Not yet competent: WEL-02; No result: WEL-07, WEL-09', 'the reason names the NYC core unit, then the ones with no result');
assertEq(CE.flag(s).state, 'nyc', 'the reason is shown beside the NYC stage');
assertEq(s.readyToCertifyAt, undefined, 'no ready flag');

s = trainee();
run(s, { readiness: readiness({ status: 'incomplete', missingCore: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] }) });
assertEq(s.courseEndReason, 'No result: A1, A2, A3, A4, A5 and 2 more', 'a long list is shortened');

console.log('(d) A programme with no unit catalogue: NYC, exactly as before');

s = trainee();
d = run(s, { readiness: null });
assertEq(d.outcome, 'nyc', 'no catalogue -> NYC');
assertEq(s.stage, 'nyc', 'marked as before');
assertEq(s._nycAuto, true, 'by the rule');
assertEq(s._nycForCourseEnd, END, 'once for this ending');
assertEq(s.courseEndState, undefined, 'and nothing new is written on the record');
s = trainee();
run(s, { readiness: { status: 'no-catalogue', known: false, missingCore: [] } });
assertEq(s.stage, 'nyc', 'the "no catalogue" verdict object reads the same as null');

console.log('A stage set by a person is never overridden');

for (const r of [readiness(), readiness({ status: 'nyc', missingCore: ['WEL-02'], nycUnits: ['WEL-02'] }),
                 readiness({ missingCore: ['WEL-05'], pendingUnits: ['WEL-05'] }), null]) {
  s = trainee({ stage: 'testing', courseEndState: 'awaiting-marking', courseEndReason: 'Awaiting marking: WEL-05' });
  CE.markSetByUser(s, END);                  // the administrator decided after the course ended
  d = run(s, { readiness: r });
  assertEq(d.changed, false, 'the sweep changes nothing (' + (r ? r.status : 'no catalogue') + ')');
  assertEq(s.stage, 'testing', 'their stage stands (' + (r ? r.status : 'no catalogue') + ')');
  assertEq(s.stageSetByUser, true, 'and is recorded as theirs');
}
assertEq(s.courseEndState, undefined, 'a person\'s decision clears what the rule had flagged');
s = trainee();
run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-02'], nycUnits: ['WEL-02'] }) });
CE.markSetByUser(s, END);                    // the administrator confirms the rule's NYC
assertEq(s.courseEndReason, 'Not yet competent: WEL-02', 'confirming the rule\'s NYC keeps its reason');
assertEq(s._nycAuto, undefined, 'and the rule no longer claims it');

s = trainee({ stage: 'training' });
CE.markSetByUser(s, null);                   // set while the course was still running
d = run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-02'], nycUnits: ['WEL-02'] }) });
assertEq(s.stage, 'nyc', 'a stage set before the course ended does not settle the ending (as before)');

console.log('Certified, collected and withdrawn trainees are never touched');

for (const st of ['certified', 'collected', 'withdrawn']) {
  s = trainee({ stage: st });
  run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-02'], nycUnits: ['WEL-02'] }) });
  assertEq(s.stage, st, st + ' stands');
}
s = trainee({ stage: 'certified', courseEndState: 'ready', courseEndReason: 'x', readyToCertifyAt: NOW });
d = run(s, { readiness: readiness() });
assertEq(s.courseEndState, undefined, 'once certified, the ready flag is cleared');
assertEq(CE.flag(trainee({ stage: 'certified', courseEndState: 'ready' })), null, 'and never shown beside a certificate');

console.log('Transcript records not loaded yet: the trainee is left for the next sweep');

s = trainee();
d = run(s, { loading: true });
assertEq(d.outcome, 'deferred', 'deferred');
assertEq(d.changed, false, 'nothing changes');
assertEq(s.stage, 'training', 'not marked NYC on half the records');

console.log('A course that reopens takes back only what the rule did');

s = trainee();
run(s, { readiness: readiness({ status: 'nyc', missingCore: ['WEL-02'], nycUnits: ['WEL-02'] }) });
d = CE.decide(s, { status: 'active' }); CE.apply(s, d);
assertEq(s.stage, 'training', 'the rule\'s NYC is undone');
assertEq(s.courseEndReason, undefined, 'with its reason');
s = trainee();
run(s, { readiness: readiness() });
CE.apply(s, CE.decide(s, { status: 'active' }));
assertEq(s.courseEndState, undefined, '"ready" no longer applies to a running course');
s = trainee();
run(s, { readiness: readiness() });
d = CE.decide(s, { status: 'no-dates' });
assertEq(d.changed, false, 'a centre with no dates says nothing, and undoes nothing');

/* ---------- 2. Real transcript records ---------- */
console.log('Real transcript records decide it (Core.Transcript.transcriptReadiness)');

const QUAL = { id: 'QUAL-TEST-WEL', title: 'WELDING LEVEL 2', skillArea: 'Welding & Fabrication', level: 2, updatedAt: '2026-01-10',
  units: [
    { code: 'WEL-01', name: 'Follow OH&S principles', coreElective: 'Core' },
    { code: 'WEL-02', name: 'Use hand and power tools', coreElective: 'Core' },
    { code: 'WEL-03', name: 'Weld with shielded metal arc', coreElective: 'Core' },
    { code: 'WEL-04', name: 'Perform oxy-acetylene cutting', coreElective: 'Elective' }
  ] };
const EXAM = { id: 'EX-3', title: 'WEL-03 practical', unitCodes: ['WEL-03'] };
function grade(studentId, unitCode, g) { return { studentId, qualId: QUAL.id, unitCode, grade: g, date: '12/06/2026' }; }
const DATA = {
  catalogs: [QUAL],
  grades: [
    grade('R', 'WEL-01', 82), grade('R', 'WEL-02', 'Competent'), grade('R', 'WEL-03', 74),
    grade('P', 'WEL-01', 80), grade('P', 'WEL-02', 77),
    grade('N', 'WEL-01', 45), grade('N', 'WEL-02', 71)
  ],
  exams: [EXAM],
  examResults: [{ id: 'ER-P', examId: 'EX-3', studentId: 'P', score: 40, submittedAt: '2026-06-25T10:00:00Z', needsReview: true, reviewComplete: false }],
  profiles: {}
};
function judge(id) {
  const st = { id, name: id, course: 'Welding Level 2', qualId: QUAL.id, stage: 'training' };
  CE.apply(st, CE.decide(st, { status: 'ended', endKey: END, nowIso: NOW, readiness: T.transcriptReadiness(st, DATA) }));
  return st;
}
const R = judge('R'), P = judge('P'), N = judge('N');
assertEq(R.stage, 'training', 'all core competent (elective ungraded): left as is');
assertEq(R.courseEndState, 'ready', 'and ready to certify');
assertEq(P.stage, 'training', 'an exam still being marked: left as is');
assertEq(P.courseEndState, 'awaiting-marking', 'and awaiting marking');
assertEq(P.courseEndReason, 'Awaiting marking: WEL-03', 'naming the unit');
assertEq(N.stage, 'nyc', 'a core unit at 45%, another with no result: NYC');
assertEq(N.courseEndReason, 'Not yet competent: WEL-01; No result: WEL-03', 'naming both');
const noCat = { id: 'Z', course: 'Underwater Basket Weaving', stage: 'training' };
const rz = T.transcriptReadiness(noCat, DATA);
CE.apply(noCat, CE.decide(noCat, { status: 'ended', endKey: END, readiness: rz }));
assertEq(noCat.stage, 'nyc', 'a programme with no catalogue: NYC as before');
assertEq(Core.transcriptReadiness(noCat, DATA), null, '(Core.transcriptReadiness answers null for it)');

/* ---------- 3. The pages use the shared rule ---------- */
console.log('The dashboard\'s sweep decides through the shared rule');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SP = fs.readFileSync(path.join(__dirname, '..', 'Student-Progress.html'), 'utf8');
function extractFrom(src, name, file) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(file + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const NAMES = ['courseDurationRecord', 'studentCentreRecord', 'studentCourseStatus', 'courseEndKeyFor',
  'markStageSetByUser', 'studentStampedElsewhere', 'courseEndTranscriptData', 'applyCourseEndStatuses'];
assert(/CESTISCore\.courseEnd\.decide\(/.test(extractFrom(PAGE, 'applyCourseEndStatuses', 'index.html')), 'applyCourseEndStatuses asks CESTISCore.courseEnd.decide');

function makeStore(map, loading) {
  return {
    getItem: k => (k in map ? JSON.stringify(map[k]) : null),
    mayHoldUnloaded: () => !!loading,
    isReady: () => !loading
  };
}
function makePage(students, store) {
  const sandbox = {
    skillAreas: [{ id: 'C1', name: 'Welding Level 2', startDate: '2026-01-05', endDate: '2026-06-30' }],
    students, CESTISCore: Core, CESTISStore: store,
    exams: DATA.exams, examResults: DATA.examResults,
    console: { warn() {}, log() {} }, Date, Object, Array, String, JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(NAMES.map(n => extractFrom(PAGE, n, 'index.html')).join('\n\n'), sandbox);
  return sandbox;
}
const stored = { voctrain_unitCatalogs: [QUAL], voctrain_transcriptGrades: DATA.grades, voctrain_transcriptProfiles: {} };
function roll() {
  return ['R', 'P', 'N'].map(id => ({ id, name: id, course: 'Welding Level 2', centreId: 'C1', qualId: QUAL.id, stage: 'training' }));
}
let page = makePage(roll(), makeStore(stored));
assertEq(page.applyCourseEndStatuses(), true, 'the sweep reports a change');
assertEq(page.students[0].courseEndState, 'ready', 'the competent trainee is ready to certify');
assertEq(page.students[0].stage, 'training', 'and not NYC');
assertEq(page.students[1].courseEndState, 'awaiting-marking', 'the one being marked is awaiting marking');
assertEq(page.students[1].stage, 'training', 'and not NYC');
assertEq(page.students[2].stage, 'nyc', 'the one with a core unit NYC is NYC');
assert(/WEL-01/.test(page.students[2].courseEndReason), 'with the unit that decided it');
assertEq(page.students[2]._nycForCourseEnd, '2026-06-30', 'stamped with this ending');
assertEq(page.applyCourseEndStatuses(), false, 'a second sweep changes nothing');

console.log('...and leaves everyone alone while the transcript records are still loading');

page = makePage(roll(), makeStore(stored, true));
assertEq(page.applyCourseEndStatuses(), false, 'no change while loading');
assert(page.students.every(st => st.stage === 'training' && !st.courseEndState), 'nobody judged on missing records');

console.log('A stage the Centre set on the dashboard stands');

page = makePage(roll(), makeStore(stored));
page.markStageSetByUser(page.students[2]);       // decided by hand after the course ended
page.applyCourseEndStatuses();
assertEq(page.students[2].stage, 'training', 'the sweep does not overrule it');

console.log('Student Progress marks and shows it through the same rule');

const spSandbox = {
  skillAreas: [{ id: 'C1', name: 'Welding Level 2', startDate: '2026-01-05', endDate: '2026-06-30' }],
  CESTISCore: Core, window: { CESTISCore: Core }, Date, Object, Array, String
};
vm.createContext(spSandbox);
vm.runInContext(['sanitizeInput', 'spMarkStageSetByUser', 'spCourseEndNote'].map(n => extractFrom(SP, n, 'Student-Progress.html')).join('\n\n'), spSandbox);
const handSet = { id: 'N', name: 'N', course: 'Welding Level 2', centreId: 'C1', qualId: QUAL.id, stage: 'testing', courseEndState: 'awaiting-marking' };
spSandbox.spMarkStageSetByUser(handSet);
assertEq(handSet._nycForCourseEnd, '2026-06-30', 'a stage set in Student Progress settles the ending');
assertEq(handSet.courseEndState, undefined, 'and clears what the rule had flagged');
page = makePage([handSet], makeStore(stored));
page.applyCourseEndStatuses();
assertEq(handSet.stage, 'testing', 'so the dashboard\'s sweep leaves it alone');
const shown = roll();
page = makePage(shown, makeStore(stored));
page.applyCourseEndStatuses();
assert(/Ready to certify/.test(spSandbox.spCourseEndNote(shown[0])), 'Student Progress shows "Ready to certify"');
assert(/Awaiting marking/.test(spSandbox.spCourseEndNote(shown[1])), 'and "Awaiting marking"');
assert(/Not yet competent: WEL-01/.test(spSandbox.spCourseEndNote(shown[2])), 'and the reason beside an NYC');
assertEq(spSandbox.spCourseEndNote({ stage: 'training' }), '', 'and nothing for a trainee the rule has not judged');

/* ---------- Result ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
