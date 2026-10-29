/* One rule per figure, on every screen that shows it, with its denominator.
   Run: node tests/centre-figures.test.js

   What used to go wrong (audit M4): the same Centre read differently on each
   screen because each counted its own population —
     attendance: Reports averaged all 100 records (applicants who never
       attended counted as 0%): 76%, against 84% for the trainees in training;
     completion: certified over everyone ever enrolled, running intakes and
       applicants included: 20%, against 67% for the intake that has ended;
     dropouts: 4% of everyone, against 13.3% of the ended intake;
     exam passes: the board counted work still awaiting marking as a fail
       (67% against 73%);
     instructors: the CMC portal counted accounts only (2 of 4);
     "Total Enrolled 100" was read as the Centre's size, though 10 were
       applicants and 30 had finished (60 active) —
   and no figure said what it was a rate OF.

   Pinned here: CESTISCore.centreFigures (enrolment, attendance, completion,
   dropout, examPass, instructorCount, rateText); the dashboard's own
   centreFigureSet / renderReportStats / renderGaugeChart / exportReportCSV /
   dashActiveLineText read from index.html; and the board's dashboard, its
   KPI refresher and the CMC portal wired to the same figures. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const F = Core.centreFigures;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

// A Centre in miniature: Welding running (6 in training, one with no
// attendance recorded yet), Cosmetology ended (3 certified/collected, 1 NYC,
// 1 dropout), Plumbing applicants (2, never attended).
const W = 'Welding & Fabrication', C = 'Cosmetology', P = 'Plumbing';
const roll = [];
[90, 80, 70, 100, 60, null].forEach((a, i) => roll.push({ id: 'W' + i, name: 'W' + i, course: W, stage: 'training', attendance: a }));
roll.push({ id: 'W9', name: 'W9', course: W, stage: 'In Training', attendance: 50 });          // older spelling of the stage
[['certified', 95], ['collected', 92], ['certified', 88], ['nyc', 40], ['incomplete', 20]].forEach(([st, a], i) =>
  roll.push({ id: 'C' + i, name: 'C' + i, course: C, stage: st, attendance: a, ended: true }));
roll.push({ id: 'P0', name: 'P0', course: P, stage: 'testing', attendance: 0 }, { id: 'P1', name: 'P1', course: P, stage: 'interview' });
const endedOf = s => !!s.ended;

console.log('The rules');
{
  const e = F.enrolment(roll);
  assert(e.total === 14 && e.active === 7 && e.applicants === 2 && e.certified === 3 && e.dropouts === 1, 'enrolment: 14 on the roll, 7 active, 2 applicants (' + JSON.stringify(e) + ')');
  const att = F.attendance(roll);
  assertEq(att.rate, Math.round((90 + 80 + 70 + 100 + 60 + 50) / 6), 'attendance: over the ACTIVE trainees with a figure — not the applicants\' 0, not the ended intake');
  assert(att.of === 6 && att.active === 7, 'of 6 active with attendance recorded (7 active)');
  const all = Math.round(roll.reduce((a, s) => a + (parseFloat(s.attendance) || 0), 0) / roll.length);
  assert(all !== att.rate, '(the old all-records average was ' + all + '%)');
  const comp = F.completion(roll, endedOf);
  assert(comp.rate === 60 && comp.of === 5 && comp.certified === 3, 'completion: 3 of 5 in ended intakes = 60% (' + JSON.stringify(comp) + ')');
  const drop = F.dropout(roll, endedOf);
  assert(drop.rate === 20 && drop.of === 5 && drop.dropouts === 1, 'dropouts: 1 of 5 in ended intakes = 20.0%');
  assert(F.completion(roll, () => false).rate === null, 'no intake ended yet: no completion rate (not 0%)');
  assert(F.completion([{ stage: 'testing', ended: true }], endedOf).of === 0, 'an applicant of an ended intake was never admitted: not counted');
  const ex = F.examPass([{ studentId: 'W0', passed: true }, { studentId: 'W1', passed: false }, { studentId: 'W2', passed: false, needsReview: true, reviewComplete: false }]);
  assert(ex.rate === 50 && ex.of === 2 && ex.awaiting === 1, 'exam passes: over MARKED results; one awaiting marking is not a fail');
  assertEq(F.instructorCount([{ name: 'Andre Campbell' }, { name: 'Kerry Lewis' }, { name: 'Sasha Grant' }],
    [{ role: 'instructor', name: 'andre campbell ' }, { role: 'instructor', name: 'Dwayne Morgan' }, { role: 'admin', name: 'Marcia' }]), 4,
    'instructors: the records and the instructor accounts, one per name (accounts alone said 2)');
  assertEq(F.rateText(att, 'active'), att.rate + '% of 6 active', 'a figure says what it is a rate of');
  assertEq(F.rateText({ rate: null }, 'marked results', 'no marked results yet'), '— (no marked results yet)', 'and says so when there is nothing to divide');
}

console.log('The dashboard\'s Reports (index.html)');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
const skillAreas = [{ id: 1, name: W }, { id: 2, name: C }, { id: 3, name: P }];
try { Core.enrolment.assignCentreKeys(skillAreas); } catch (e) {}
const sb = {
  CESTISCore: Core, console: console, Math: Math, Object: Object, Array: Array, String: String, Date: Date, parseFloat: parseFloat, isFinite: isFinite,
  students: roll, examResults: [], instructorAssignments: [], attendanceRegister: [], attendanceRecords: [], skillAreas,
  userAccounts: [{ role: 'instructor', name: 'Dwayne Morgan' }], instructorData: [{ name: 'Andre Campbell' }],
  studentCourseStatus: s => (s && s.ended ? 'ended' : 'active'),
  escapeHtml: s => String(s == null ? '' : s), els: {}, exported: null, showToast() {}
};
sb.document = { getElementById: id => (sb.els[id] = sb.els[id] || { innerHTML: '' }) };
sb.window = sb;
sb.centreRollTally = () => Core.transfer.tally(roll, skillAreas, { field: 'course', centres: skillAreas, nowMs: Date.parse('2026-10-28T12:00:00Z') });
sb.exportCSV = (rows, headers) => { sb.exported = { rows, headers }; };
vm.createContext(sb);
vm.runInContext(['attendancePctByStudent', 'centreFigureSet', 'examPassFigure', 'reportProgrammeRolls', 'renderReportStats', 'renderGaugeChart',
  'exportReportCSV', 'dashActiveLineText'].map(fn).join('\n'), sb);
{
  const fig = sb.centreFigureSet();
  assert(fig.attendance.rate === F.attendance(roll).rate && fig.completion.rate === 60 && fig.dropout.rate === 20 && fig.instructors === 2,
    'centreFigureSet: the rules over this device\'s roll');
  sb.renderReportStats();
  const st = sb.els.reportStats.innerHTML;
  assert(new RegExp('data-count="' + fig.attendance.rate + '" data-suffix="%">0</div><div class="stat-label">Attendance Rate</div><div class="stat-change"[^>]*>of 6 active<').test(st), 'Reports: Attendance Rate, "of 6 active"');
  assert(/data-count="20.0" data-suffix="%">0<\/div><div class="stat-label">Dropout Rate<\/div><div class="stat-change"[^>]*>of 5 in ended intakes</.test(st), 'Reports: Dropout Rate 20.0%, "of 5 in ended intakes"');
  sb.renderGaugeChart();
  const g = sb.els.gaugeContainer.innerHTML;
  assert(/gauge-value">60%</.test(g) && /Overall Completion Rate — 3 of 5 in ended intakes/.test(g), 'Reports: completion 60%, "3 of 5 in ended intakes"');
  sb.exportReportCSV();
  const row = c => sb.exported.rows.find(r => String(r.course).indexOf(c) !== -1);
  assert(row(W).avgAttendance === F.attendance(roll.filter(s => s.course === W)).rate && row(C).avgAttendance === '' && row(P).avgAttendance === '',
    'Export Report: average attendance over each programme\'s active trainees (blank where none is in training)');
  assertEq(sb.dashActiveLineText(), '7 active (in training) · 2 applicants', 'the dashboard\'s Total Enrolled card says how many are active, separately');
  assert(/id="dashActiveLine"[^>]*>\$\{dashActiveLineText\(\)\}</.test(src), '(drawn under Total Enrolled Students)');
}

console.log('The board\'s screens use the same figures');
{
  const cmc = fn('buildCmcPages');
  assert(/var _fig = centreFigureSet\(\);/.test(cmc) && /var totalInstructors = _fig\.instructors;/.test(cmc), 'the board\'s dashboard reads centreFigureSet');
  assert(/var avgAttendance = _fig\.attendance\.rate == null \? 0 : _fig\.attendance\.rate;/.test(cmc) && /'of ' \+ _fig\.attendance\.of \+ ' active'/.test(cmc), 'Avg Attendance over active trainees, with its denominator');
  assert(/var completionRate = _fig\.completion\.rate == null \? 0 : _fig\.completion\.rate;/.test(cmc) && /' in ended intakes'/.test(cmc), 'Completion over ended intakes, with its denominator');
  assert(/var examPassRate = _fig\.examPass\.rate == null \? 0 : _fig\.examPass\.rate;/.test(cmc) && /' marked results passed'/.test(cmc) && /' awaiting marking'/.test(cmc), 'Exam passes over marked results; awaiting marking said separately');
  assert(/_fig\.enrolment\.active \+ ' active \(in training\)/.test(cmc), 'Total Enrolment with Active separately');
  assert(!/totalCertified\/totalStudents/.test(cmc), 'no certified-over-everyone rate is left');
  assert(/centreFigureSet\(\)\.attendance/.test(fn('cmcUpdateLocalKpis')), 'the KPI refresher keeps the same rule');
  assert(/centreFigureSet\(\)\.instructors/.test(fn('cmcRenderCharts')), 'the staff chart counts instructors by the rule');
  assert(/centreFigureSet\(\)\.attendance/.test(fn('cmcBuildAttendanceDetail')), 'the attendance detail\'s average is the same figure');
  const portal = fs.readFileSync(path.join(__dirname, '..', 'cmc-portal.js'), 'utf8');
  assert(/root\.centreFigureSet\(\)/.test(portal) && /' in ended intakes'/.test(portal) && /'of ' \+ fig\.attendance\.of \+ ' active'/.test(portal) && /fig\.instructors/.test(portal),
    'the CMC portal: the same figures, with denominators');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
