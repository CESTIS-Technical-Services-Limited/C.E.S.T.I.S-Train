/* Pass rates come from marked exam results; GPA from the marks.
   Run: node tests/pass-rate-from-marks.test.js

   What used to go wrong (audit M1): "Overall Pass Rate", the per-programme
   pass rates on Reports and "Top Performers" read s.gpa — a GPA only ever
   typed by hand on Student Progress, which nobody types. Every trainee keeps
   the seed '0.0', so the Centre's pass rate read 20% (only the certified
   counted), every running programme 0% (truth: Welding 74%, Electrical 56%),
   and Top Performers listed five 0.0-GPA trainees who were at risk. The
   board's average GPA and GPA chart, and the student export, read the same
   untouched figure (or their own score scale).

   Pinned here: CESTISCore.centreFigures.examPass (over MARKED results — the
   rule of Core.exams.passRateOf); the dashboard's own examPassFigure,
   renderPassRates, renderReportStats, studentGpaFigure and exportStudentsCSV
   read from index.html; Top Performers and the board's GPA figures use
   studentGpaFigure; the CMC portal's averages take the same figure. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const F = Core.centreFigures;

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

// A small Centre: Welding running (five trainees, an exam with one result
// still awaiting marking), Plumbing applicants (no results), every GPA the seed.
const W = 'Welding & Fabrication', P = 'Plumbing';
const students = [
  { id: 'W1', name: 'Tameka Richards', course: W, stage: 'training', gpa: '0.0' },
  { id: 'W2', name: 'Kemar Johnson', course: W, stage: 'training', gpa: '0.0' },
  { id: 'W3', name: 'Shanice Brown', course: W, stage: 'training', gpa: '0.0' },
  { id: 'W4', name: 'Andre Campbell', course: W, stage: 'training', gpa: '0.0' },
  { id: 'W5', name: 'Kimberly Williams', course: W, stage: 'training', gpa: '3.2' },   // set by an administrator
  { id: 'P1', name: 'Kayla Simms', course: P, stage: 'testing', gpa: '0.0' },
  { id: 'P2', name: 'Brandon Lee', course: P, stage: 'interview', gpa: '0.0' }
];
const results = [
  { id: 'R1', examId: 'E1', studentId: 'W1', score: 92, passed: true },
  { id: 'R2', examId: 'E1', studentId: 'W2', score: 74, passed: true },
  { id: 'R3', examId: 'E1', studentId: 'W3', score: 65, passed: true },
  { id: 'R4', examId: 'E1', studentId: 'W4', score: 41, passed: false },
  { id: 'R5', examId: 'E2', studentId: 'W1', score: 50, passed: false, needsReview: true, reviewComplete: false },   // awaiting marking
  { id: 'R6', examId: 'E0', studentId: 'W2', score: 99, passed: true, archived: true }
];

console.log('The rule: pass rates over MARKED results');
{
  const all = F.examPass(results);
  assert(all.rate === 75 && all.of === 4 && all.passed === 3 && all.awaiting === 1, 'the Centre: 3 of 4 marked results passed, 1 awaiting marking (' + JSON.stringify(all) + ')');
  assert(Core.exams.passRateOf(results) === all.rate + '%', 'the same figure as Core.exams.passRateOf');
  const plumb = F.examPass(results, { studentIds: ['P1', 'P2'] });
  assert(plumb.rate === null && plumb.of === 0, 'a programme with no marked results has no rate (not 0%)');
}

console.log('The dashboard (index.html)');
const sb = {
  CESTISCore: Core, console: console, Math: Math, Object: Object, Array: Array, String: String, parseFloat: parseFloat, isFinite: isFinite,
  students, examResults: results, instructorAssignments: [], skillAreas: [{ id: 1, name: W }, { id: 2, name: P }],
  instructorCourseMatch: (a, b) => String(a) === String(b),
  escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  els: {}, exported: null, showToast() {}
};
sb.document = { getElementById: id => (sb.els[id] = sb.els[id] || { innerHTML: '' }) };
sb.centreRollTally = () => Core.transfer.tally(students, sb.skillAreas, { field: 'course', centres: sb.skillAreas, nowMs: Date.parse('2026-10-28T12:00:00Z') });
sb.exportCSV = (rows, headers, name) => { sb.exported = { rows, headers, name }; };
sb.window = sb;
vm.createContext(sb);
try { Core.enrolment.assignCentreKeys(sb.skillAreas); } catch (e) {}
Object.assign(sb, { attendanceRegister: [], attendanceRecords: [], userAccounts: [], instructorData: [], studentCourseStatus: () => 'active' });
vm.runInContext(['studentCourseworkSummary', 'studentEffectiveGpa', 'studentGpaFigure', 'examPassFigure', 'attendancePctByStudent', 'centreFigureSet',
  'reportProgrammeRolls', 'renderPassRates', 'renderReportStats', 'exportStudentsCSV'].map(fn).join('\n'), sb);
{
  sb.renderPassRates();
  const html = sb.els.passRateChart.innerHTML;
  assert(/>75%<\/div><div[^>]*>of 4 marked<\/div>/.test(html), 'Welding: 75% of 4 marked results (it read 0% from the GPA nobody typed)');
  assert(/>—<\/div><div[^>]*>no marked results<\/div>/.test(html), 'Plumbing: no marked results — not 0%');
  sb.renderReportStats();
  const stats = sb.els.reportStats.innerHTML;
  assert(/data-count="75" data-suffix="%">0<\/div><div class="stat-label">Overall Pass Rate<\/div><div class="stat-change"[^>]*>of 4 marked results</.test(stats), 'Overall Pass Rate: 75%, of 4 marked results (it read 0%)');
}
{
  assert(sb.studentGpaFigure(students[0]) != null && sb.studentGpaFigure(students[3]) != null, 'a trainee with marks has a GPA from them');
  assert(sb.studentGpaFigure(students[5]) === null, 'a trainee with no marks and the untouched 0.0 has none (not 0.0)');
  assert(sb.studentGpaFigure(students[4]) === '3.2', 'a GPA an administrator set still stands');
  sb.exportStudentsCSV();
  const g = id => sb.exported.rows.find(r => r.id === id).gpa;
  assert(g('W1') === Core.coursework.gpaFromPercent(92) && g('P1') === '' && g('W5') === '3.2', 'Export Students: the GPA the marks produce, blank where there is none');
  assert(students[0].gpa === '0.0', 'nothing stored is changed');
}
{
  const dash = src.slice(src.indexOf('function buildAdminPages('), src.indexOf('<h3>Top Performers</h3>'));
  assert(/const topPerformers = students\.map\(s => \{ const sum = studentCourseworkSummary\(s\); return \{ s: s, g: studentGpaFigure\(s, sum\)/.test(dash) && !/parseFloat\(b\.gpa\)-parseFloat\(a\.gpa\)/.test(dash),
    'Top Performers ranks by the GPA the marks produce, not the hand-typed figure');
  assert(!/function isStudentPassed\(/.test(src) && !/isStudentPassed\)/.test(src), 'no pass rate is read from a hand-typed GPA any more');
  const cmc = fn('buildCmcPages');
  assert(/studentGpaFigure\(s\)/.test(cmc) && !/parseFloat\(s\.gpa\)/.test(cmc), 'the board\'s average GPA uses the same figure');
  assert(/studentGpaFigure\(s\)/.test(fn('cmcRenderCharts')) && !/parseFloat\(s\.gpa\)/.test(fn('cmcRenderCharts')), 'and its GPA chart');
}

console.log('The CMC portal');
{
  const portal = require('../cmc-portal.js');
  const avg = portal.cmcAverages(students, s => (s.id === 'W1' ? '4.0' : s.id === 'W2' ? '2.0' : null));
  assert(avg.gpa === 3, 'its average GPA takes the dashboard\'s figure and skips trainees with none (' + avg.gpa + ')');
  assert(/cmcAverages\(students, gpaOf\)/.test(fs.readFileSync(path.join(__dirname, '..', 'cmc-portal.js'), 'utf8')), 'and the portal passes it');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
