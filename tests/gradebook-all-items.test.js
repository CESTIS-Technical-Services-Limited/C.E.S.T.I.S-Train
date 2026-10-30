/* The instructor's gradebook shows every exam and assignment, averages them
   all, and "Export Grades" exports the marks.
   Run: node tests/gradebook-all-items.test.js

   What used to go wrong (audit IN-2): the gradebook took the first seven
   exams and the first seven assignments (.slice(0, 7)) and averaged only
   those. From week 8 a trainee's latest work was not on screen, and one who
   scored 18/20 for seven weeks then 2/20 twice still showed 90%. "Export
   Grades" exported the trainee list (stage, score, attendance, GPA) — no
   marks at all.

   Pinned here: CESTISCore.coursework.gradebook (a column per exam and per
   assignment, newest first; the average over all of them; only final exam
   results count) and gradebookCsv (the marks, formula-safe); the dashboard's
   own instructorGradebookData / exportInstructorGradebookCSV read from
   index.html, and the gradebook block no longer cuts at seven. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const CW = Core.coursework;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const PROG = 'Welding & Fabrication';
const roll = [{ id: 'STU-1', name: 'Tameka Richards' }, { id: 'STU-2', name: 'Kemar Johnson' }, { id: 'STU-3', name: '=Shanice Brown' }];
function addDays(d, n) { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const assignments = [];
for (let k = 1; k <= 10; k++) {
  const a = { id: 'ASN-WK' + k, title: 'Week ' + k + ' worksheet', course: PROG, dueDate: addDays('2026-08-20', k * 7), maxPoints: 20, weight: 10, grades: {} };
  if (k <= 9) {
    a.grades['STU-1'] = k >= 8 ? 2 : 18;              // fell behind in weeks 8 and 9
    a.grades['STU-2'] = 15;
  }
  assignments.push(a);
}
const exams = [
  { id: 'EX-1', title: 'Unit 1 Test', course: PROG, date: '2026-09-01', time: '09:00' },
  { id: 'EX-5', title: 'Unit 5 Test', course: PROG, date: '2026-10-27', time: '09:00' }
];
const results = [
  { id: 'R1', examId: 'EX-1', studentId: 'STU-1', score: 80, reviewComplete: true },
  { id: 'R2', examId: 'EX-5', studentId: 'STU-1', score: 40, needsReview: true, reviewComplete: false },   // still awaiting marking
  { id: 'R3', examId: 'EX-5', studentId: 'STU-2', score: 70 }
];
const isFinal = r => Core.exams.isFinal(r);

console.log('Every exam and assignment has a column, newest first');
const book = CW.gradebook({ students: roll, exams, assignments, results, isFinal });
{
  assert(book.columns.length === 12, '10 assignments + 2 exams = 12 columns (got ' + book.columns.length + ')');
  assert(book.columns[0].id === 'ASN-WK10', 'the newest item first (got ' + book.columns[0].id + ')');
  assert(book.columns[1].id === 'EX-5' && book.columns[book.columns.length - 1].id === 'ASN-WK1', 'exams and assignments in one order; the oldest last (got ' + book.columns[1].id + ' … ' + book.columns[book.columns.length - 1].id + ')');
  const ds = book.columns.map(c => c.date);
  assert(ds.every((d, i) => !i || ds[i - 1] >= d), 'in date order, newest first');
  assert(book.columns.some(c => c.id === 'ASN-WK8') && book.columns.some(c => c.id === 'ASN-WK9'), 'weeks 8 and 9 are on screen');
  assert(book.columns.find(c => c.id === 'ASN-WK1').label === 'Week 1 worksheet (10%)', 'an assignment column says its weight');
}

console.log('The average covers every item');
{
  const t = book.rows[0];
  // Weeks 1-7 at 90%, weeks 8-9 at 10%, Unit 1 at 80% (Unit 5 awaits marking; week 10 unmarked).
  const truth = (90 * 7 + 10 * 2 + 80) / 10;
  assert(Math.round(t.average) === Math.round(truth), 'the trainee who fell behind: ' + Math.round(t.average) + '% (truth ' + Math.round(truth) + '%), not the 90% of the first seven');
  const old = CW.weightedAverage(assignments.slice(0, 7).map(a => ({ pct: CW.percentOf(a.grades['STU-1'], 20), weight: 10 })).concat([{ pct: 80, weight: 10 }]));
  assert(Math.round(old) !== Math.round(t.average), '(the first-seven average was ' + Math.round(old) + '%)');
  const i5 = book.columns.findIndex(c => c.id === 'EX-5');
  assert(t.cells[i5] === null, 'a result still awaiting marking is not a mark yet');
  assert(book.rows[1].cells[i5] === 70, 'a final one is');
  assert(book.rows[2].average === null, 'a trainee with nothing marked has no average');
}

console.log('Export Grades: the marks, as on screen');
{
  const csv = CW.gradebookCsv(book).split('\n');
  assert(csv.length === 4, 'a header and a row per trainee');
  assert(/^"?Trainee"?,"?Student ID"?,"?Week 10 worksheet \(10%\) %"?/.test(csv[0]) && /Average %"?$/.test(csv[0]), 'columns: trainee, ID, each item newest first, average (' + csv[0].slice(0, 80) + ')');
  assert(/^Tameka Richards,STU-1,,,10,10,90,90,90,90,90,90,80,90,73$/.test(csv[1]), 'her marks as whole percentages, blanks where not marked yet (' + csv[1] + ')');
  assert(csv[3].indexOf("'=Shanice Brown") !== -1, 'a name that starts like a formula is made text');
}

console.log('The dashboard uses it (index.html)');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = src.indexOf('<section class="page" id="page-i-gradebook">');
  const block = src.slice(start, src.indexOf('</section>', start));
  assert(start > 0 && !/slice\(0,\s*7\)/.test(block), 'the gradebook block no longer cuts at seven');
  assert(/instructorGradebookData\(ins, myStudents, myExams\)/.test(block), 'it draws from instructorGradebookData');
  assert(/onclick="exportInstructorGradebookCSV\(\)">📄 Export Grades/.test(block), 'Export Grades exports the gradebook');
  assert(/overflow:auto/.test(block), 'the table scrolls inside its card');
  function fn(name) {
    const s = src.indexOf('function ' + name + '(');
    let d = 0;
    for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
    throw new Error(name);
  }
  const saved = [];
  const sb = {
    CESTISCore: Core, String: String, console: console,
    currentInstructor: { name: 'Ian Barrett', course: PROG }, students: roll.map(s => Object.assign({ course: PROG }, s)),
    exams, examResults: results, instructorAssignments: assignments,
    instructorCourseMatch: (a, b) => String(a) === String(b),
    Blob: function (parts) { saved.push(parts.join('')); }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() { sb.file = this.download; }, style: {} }), body: { appendChild() {}, removeChild() {} } },
    showToast: () => {}
  };
  vm.createContext(sb);
  vm.runInContext(fn('instructorGradebookData') + fn('exportInstructorGradebookCSV'), sb);
  sb.exportInstructorGradebookCSV();
  assert(saved.length === 1 && /Week 10 worksheet/.test(saved[0]) && /Unit 1 Test/.test(saved[0]), 'Export Grades writes the gradebook\'s columns');
  assert(/Tameka Richards/.test(saved[0]) && !/stage|attendance|progress/i.test(saved[0].split('\n')[0]), 'with marks, not the trainee list');
  assert(/^gradebook_Welding_Fabrication\.csv$/.test(sb.file || ''), 'named for the programme (' + sb.file + ')');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
