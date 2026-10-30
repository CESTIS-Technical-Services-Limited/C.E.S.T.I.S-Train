/* The office's watch on the work: the marking backlog with its age and who
   it waits on, work past due never handed in (audit M6), and the classes
   whose register was not taken on the last school day (M11).
   Run: node tests/office-watch.test.js

   What used to happen: "35 pending" and nothing else — not that 31 were over
   a week old, that one programme's 16 had waited 14 days, nor the 13 pieces
   past due never handed in; and a register left blank for two days showed
   only as empty cells in a weekly grid.

   Pinned here: CESTISCore.officeWatch (backlog, previousSchoolDay,
   registersNotTaken) and the dashboard's officeWatchHtml and alerts. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const OW = Core.officeWatch;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const NOW = Date.parse('2026-10-29T15:00:00Z');
const W = 'Welding & Fabrication', E = 'Electrical Installation';
const students = [
  { id: 'W1', name: 'Tameka Richards', course: W, stage: 'training' }, { id: 'W2', name: 'Kemar Johnson', course: W, stage: 'training' },
  { id: 'W3', name: 'Shanice Brown', course: W, stage: 'training' }, { id: 'E1', name: 'Rohan Reid', course: E, stage: 'training' },
  { id: 'E2', name: 'Latoya Clarke', course: E, stage: 'training' }, { id: 'X1', name: 'Jordan Blake', course: W, stage: 'testing' }];
const assignments = [
  { id: 'A10', title: 'Week 10 report', course: W, createdBy: 'Ian Barrett', dueDate: '2026-10-28', maxPoints: 100, grades: { W1: 70 } },
  { id: 'E5', title: 'Circuit diagram', course: E, createdBy: 'Errol Grant', dueDate: '2026-10-15', maxPoints: 20, grades: {} },
  { id: 'A11', title: 'Week 11', course: W, createdBy: 'Ian Barrett', dueDate: '2026-11-04', maxPoints: 20, grades: {} },
  { id: 'A-DEMO', title: 'Demonstration', course: W, createdBy: 'Ian Barrett', dueDate: '2026-10-01', maxPoints: 10, grades: {}, requireSubmission: false }];
const submissions = [
  { assignmentId: 'A10', studentId: 'W1', submittedAt: '2026-10-27T12:00:00Z' }, { assignmentId: 'A10', studentId: 'W2', submittedAt: '2026-10-27T13:00:00Z' },
  { assignmentId: 'E5', studentId: 'E1', submittedAt: '2026-10-15T09:00:00Z' }, { assignmentId: 'E5', studentId: 'E2', submittedAt: '2026-10-14T09:00:00Z' }];
const exams = [{ id: 'U5', title: 'Unit 5 Theory Test', course: W, createdBy: 'USR-INS-IAN' }];
const pend = { answers: [{ needsManualGrade: true, graded: false }] };
const results = [Object.assign({ id: 'R1', examId: 'U5', studentId: 'W1', submittedAt: '2026-10-26T15:00:00Z' }, pend),
  Object.assign({ id: 'R2', examId: 'U5', studentId: 'W2', submittedAt: '2026-10-26T15:05:00Z' }, pend),
  Object.assign({ id: 'R3', examId: 'U5', studentId: 'W3', submittedAt: '2026-09-01T15:05:00Z', archived: true }, pend),
  { id: 'R4', examId: 'U5', studentId: 'W3', submittedAt: '2026-10-26T15:00:00Z', answers: [{ needsManualGrade: true, graded: true }] }];

console.log('The marking backlog: how much, how old, waiting on whom');
{
  const b = OW.backlog({ assignments, submissions, exams, results, students, nowMs: NOW, ownerOfExam: e => (e.createdBy === 'USR-INS-IAN' ? 'Ian Barrett' : 'Administrator') });
  assert(b.waiting === 5, '5 waiting: Kemar\'s Week 10, both circuit diagrams, two test results (the archived and the marked are not) (' + b.waiting + ')');
  assert(b.oldestDays === 15 && b.items[0].id === 'E5', 'the oldest has waited 15 days: the circuit diagrams (' + b.oldestDays + ')');
  assert(b.byOwner.map(o => o.owner + ':' + o.waiting + ':' + o.oldestDays).join() === 'Errol Grant:2:15,Ian Barrett:3:3', 'by instructor, the longest-waiting first: Errol 2 (15 days), Ian 3 (3 days) (' + b.byOwner.map(o => o.owner + ':' + o.waiting + ':' + o.oldestDays).join() + ')');
  assert(b.pastDueMissing === 1 && b.missingBy.length === 1 && b.missingBy[0].id === 'A10' && b.missingBy[0].trainees.join() === 'Shanice Brown',
    'past due, never handed in: Shanice\'s Week 10 — not work still to come, not a demonstration with nothing to hand in, not an applicant');
}
console.log('The last school day; registers not taken');
{
  assert(OW.previousSchoolDay('2026-11-02') === '2026-10-30' && OW.previousSchoolDay('2026-10-29') === '2026-10-28', 'Monday looks back to Friday; Thursday to Wednesday');
  const day = '2026-10-28';
  const sessions = [
    { id: 'C1', name: 'Welding Theory', course: W, date: day, time: '09:00', createdBy: 'Ian Barrett' },
    { id: 'C2', name: 'Wiring Practical', course: E, date: day, time: '13:00', createdBy: 'Errol Grant' },
    { id: 'C3', name: 'Cancelled class', course: E, date: day, time: '15:00', status: 'cancelled' },
    { id: 'C4', name: 'Solar Theory', course: 'Solar Energy Tech', date: day, time: '09:00' },
    { id: 'C5', name: 'Welding Theory', course: W, date: '2026-10-27', time: '09:00' }];
  const reg = [{ studentId: 'W2', date: day, status: 'absent' }, { studentId: 'E1', date: day, status: 'present', unconfirmed: true }, { studentId: 'E2', date: '2026-10-27', status: 'present' }];
  const nt = OW.registersNotTaken({ day, sessions, register: reg, students });
  assert(nt.map(x => x.session.id).join() === 'C2', 'Wiring Practical is listed: no Electrical trainee marked that day (a carried-over unconfirmed mark and another day\'s mark do not count)');
  assert(nt[0].instructor === 'Errol Grant' && nt[0].trainees === 2, 'with its instructor and how many trainees');
  assert(!nt.some(x => x.session.id === 'C1'), 'not Welding: one absence is a register taken');
  assert(!nt.some(x => x.session.id === 'C3' || x.session.id === 'C4'), 'not a cancelled class, nor a programme with nobody in training');
}

console.log('The dashboard (index.html)');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
{
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const yesterday = OW.previousSchoolDay(Core.attendance.localDate());
  const sb = { console, Date, JSON, CESTISCore: Core, escapeHtml: esc, instructorCourseMatch: (a, b) => a === b, localDateStr: () => Core.attendance.localDate(),
    instructorAssignments: assignments, assignmentSubmissions: submissions, exams, examResults: results, students, instructorData: [{ id: 'USR-INS-IAN', name: 'Ian Barrett' }], userAccounts: [],
    classSessions: [{ id: 'C2', name: 'Wiring Practical', course: E, date: yesterday, time: '13:00', createdBy: 'Errol Grant' }], attendanceRegister: [], currentInstructor: null };
  vm.createContext(sb);
  vm.runInContext(['examOwnerName', 'officeBacklog', 'registersNotTakenList', 'officeDayLabel', 'officeDaysText', 'officeWatchHtml'].map(fn).join('\n'), sb);
  const html = vm.runInContext('officeWatchHtml()', sb);
  assert(/Registers not taken on [^<]*: 1 class<\/div>/.test(html) && /Wiring Practical \(Electrical Installation, 13:00, Errol Grant\)/.test(html), 'the office sees the register not taken, with the class, time and instructor');
  assert(/waiting to be marked, the oldest for \d+ days/.test(html) && /<strong>Ian Barrett<\/strong>/.test(html) && /<strong>Errol Grant<\/strong>/.test(html), 'and the marking: how many, how old, waiting on whom (the test\'s author named from the instructor records)');
  assert(/Past due, never handed in \(\d+\)/.test(html) && /Shanice Brown/.test(html), 'and who never handed in work past due');
  const adm = fn('buildAdminPages');
  assert(/id="dashRegistersNotTaken" onclick="showPage\('attendance'\)"/.test(adm) && /id="dashMarkingBacklog" onclick="showPage\('a-assignments'\)"/.test(adm), 'the administrator\'s dashboard alerts both, each opening its page');
  assert(/bl\.innerHTML = officeWatchHtml\(\{ registers: false \}\)/.test(fn('renderAdminAssignments')), 'the Assignments page carries the backlog');
  assert(/ow\.innerHTML = officeWatchHtml\(\)/.test(fn('renderNeedsAttention')) && /if \(pageId !== 'i-needs-attention'\) sec\.insertAdjacentHTML/.test(fn('ensureAttentionPage')), 'and the office\'s Needs Attention page (so Admin Staff see both)');
  assert(/id="iDashMarkingBacklog" onclick="showPage\('i-gradebook'\)"/.test(fn('buildInstructorPages')) && /officeBacklog\(true\)/.test(fn('renderInstructorGradebook')), 'an instructor sees her own oldest work waiting, on the dashboard and the gradebook');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
