/* "Needs attention": who is struggling, most urgent first (audit IN-3, M3).
   Run: node tests/needs-attention.test.js

   What used to happen: the dashboard said "5 students below 70% attendance"
   and named nobody. An instructor found who was struggling by opening each
   trainee's grades in turn; the office learnt nobody's name, last
   attendance or phone from the alert (the management audit found nine
   trainees unseen for two weeks or more, owing $228,000, that no screen
   showed).

   Pinned here:
   - CESTISCore.attention.list: who is listed (attendance below 70%, three or
     more absences in a row, a marked result below the pass mark in the last
     four weeks, work past its due date not handed in), who never is
     (applicants, ended intakes, graduates, dropouts), the facts on each row
     (last attended, absences in a row from the dated register — excused and
     no-class marks do not break a run — attendance %, the marks below the
     pass mark, the missing work, the average from the marks, never a typed
     GPA), most urgent first;
   - CESTISCore.attention.owedFrom: what a trainee owes on her School Fee
     record, found the fee page's own way;
   - the dashboard (index.html): an instructor's list is her programme's
     trainees and never reads the fee records; the office's list has "Owes";
     the dashboards' attendance alerts open the list and count by its rule. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const AT = Core.attention;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const TODAY = '2026-10-29';   // a Thursday
const W = 'Welding & Fabrication', P = 'Plumbing', C = 'Cosmetology';
const days = (() => { const out = []; let d = TODAY; while (out.length < 20) { d = Core.attendance.addDays(d, -1); const wd = Core.attendance.weekday(d); if (wd >= 1 && wd <= 5) out.push(d); } return out; })(); // newest first
function marks(sid, pattern) {   // pattern newest first: P present, A absent, E excused, N no class, L late, U unconfirmed
  return pattern.split('').map((c, i) => ({ id: 'ATT|' + sid + '|' + days[i], studentId: sid, date: days[i],
    status: { P: 'present', A: 'absent', E: 'excused', N: 'noclass', L: 'late', U: 'absent' }[c], unconfirmed: c === 'U' || undefined }));
}
const students = [
  { id: 'S-DAMION', name: 'Damion Lewis', course: W, stage: 'training', phone: '876-555-0143', gpa: '3.8' },
  { id: 'S-NADINE', name: 'Nadine Bailey', course: W, stage: 'training', phone: '876-555-0188' },
  { id: 'S-RICARDO', name: 'Ricardo Francis', course: W, stage: 'training' },
  { id: 'S-SASHA', name: 'Sasha Walker', course: W, stage: 'training' },
  { id: 'S-TAMEKA', name: 'Tameka Richards', course: W, stage: 'training' },
  { id: 'S-APPLICANT', name: 'Kayla Simms', course: P, stage: 'testing' },
  { id: 'S-ENDED', name: 'Monique Hall', course: C, stage: 'training' },
  { id: 'S-DROPOUT', name: 'Trevor Dixon', course: W, stage: 'incomplete' },
  { id: 'S-GRAD', name: 'Ayesha Ford', course: C, stage: 'certified' }
];
const register = [].concat(
  marks('S-DAMION', 'AAEAANPPPPPPPPPPPPPP'),     // absent 4 held in a row (the excused and no-class do not break it), 80% before
  marks('S-NADINE', 'PAPAPAAPPAPAAPAPPAPU'),     // 50%, last attended yesterday's-yesterday
  marks('S-RICARDO', 'PPPPPPPPPPPPPPPPPPPP'),
  marks('S-SASHA', 'PLPPPPPPPPPPPPPPPPPP'),
  marks('S-TAMEKA', 'PPPPPPPPPPPPPPPPPPPP'),
  marks('S-APPLICANT', 'AAAAAAAAAAAAAAAAAAAA'),
  marks('S-ENDED', 'AAAAAAAAAAAAAAAAAAAA'),
  marks('S-DROPOUT', 'AAAAAAAAAAAAAAAAAAAA'));
const exams = [{ id: 'EX-U5', title: 'Unit 5 Theory Test', course: W, passMark: 60 }, { id: 'EX-U1', title: 'Unit 1 Test', course: W, passMark: 50 }];
const results = [
  { id: 'R1', examId: 'EX-U5', studentId: 'S-RICARDO', score: 40, passed: false, submittedAt: '2026-10-20T15:00:00Z' },            // recent, below 60
  { id: 'R2', examId: 'EX-U1', studentId: 'S-SASHA', score: 45, passed: false, submittedAt: '2026-08-20T15:00:00Z' },             // long ago: not "recent"
  { id: 'R3', examId: 'EX-U5', studentId: 'S-TAMEKA', score: 30, passed: false, needsReview: true, submittedAt: '2026-10-28T15:00:00Z' }, // still being marked
  { id: 'R4', examId: 'EX-U5', studentId: 'S-DAMION', score: 90, passed: true, submittedAt: '2026-10-20T15:00:00Z' }
];
const assignments = [
  { id: 'A9', title: 'Week 9 worksheet', course: W, dueDate: '2026-10-21', maxPoints: 20, weight: 10, grades: { 'S-NADINE': 6, 'S-DAMION': 18, 'S-RICARDO': 15, 'S-SASHA': 14, 'S-TAMEKA': 16 },
    gradeMeta: { 'S-NADINE': { gradedAt: '2026-10-23T14:00:00Z' }, 'S-DAMION': { gradedAt: '2026-10-23T14:00:00Z' } } },
  { id: 'A10', title: 'Week 10 — Cutting & gouging report', course: W, dueDate: '2026-10-28', maxPoints: 100, weight: 10, grades: {}, requireSubmission: true },
  { id: 'A11', title: 'Week 11 worksheet', course: W, dueDate: '2026-11-04', maxPoints: 20, grades: {} },
  { id: 'A-NOSUB', title: 'Class demonstration', course: W, dueDate: '2026-10-20', maxPoints: 10, grades: {}, requireSubmission: false }
];
const submissions = ['S-DAMION', 'S-NADINE', 'S-RICARDO', 'S-TAMEKA'].map(sid => ({ id: 'SUB-' + sid, assignmentId: 'A10', studentId: sid, submittedAt: '2026-10-27T12:00:00Z' }));
const ended = s => s.course === C;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const NOW = Date.parse('2026-10-29T15:00:00Z');
const rows = AT.list({ students, register, today: TODAY, endedOf: ended, results, exams, assignments, submissions, sameProgramme: same, nowMs: NOW });
const by = Object.fromEntries(rows.map(r => [r.id, r]));

console.log('Who is listed, and who never is');
{
  assert(rows.map(r => r.id).join() === 'S-DAMION,S-NADINE,S-RICARDO,S-SASHA', 'Damion (stopped coming), Nadine (53%), Ricardo (failed a test), Sasha (work not handed in) — in that order (' + rows.map(r => r.id).join() + ')');
  assert(!by['S-APPLICANT'] && !by['S-ENDED'] && !by['S-DROPOUT'] && !by['S-GRAD'], 'never an applicant, an ended intake, a dropout or a graduate');
  assert(!by['S-TAMEKA'], 'not a trainee whose only weak mark is still being marked');
}
console.log('The facts on each row');
{
  const d = by['S-DAMION'];
  assert(d.absentRun === 4 && d.lastAttended === days[6] && d.pct === 78, 'Damion: 4 absences in a row (excused/no-class skipped), last attended ' + days[6] + ', 78% (14 of 18 held) (' + [d.absentRun, d.lastAttended, d.pct] + ')');
  assert(d.daysSinceAttended === 9, 'and how many days ago (' + d.daysSinceAttended + ')');
  assert(d.phone === '876-555-0143' && d.course === W, 'with his phone and programme');
  assert(d.average === 90 && d.gpa === '4.0', 'his average and GPA come from his marks (90% / 4.0), never the typed 3.8 (' + d.average + ' / ' + d.gpa + ')');
  assert(d.reasons.join() === 'absent-run' && AT.reasonText(d) === 'absent 4 classes in a row', 'listed for stopping coming: ' + AT.reasonText(d));
  const n = by['S-NADINE'];
  assert(n.pct === 53 && n.held === 19 && n.absentRun === 0 && n.lastAttended === days[0], 'Nadine: 53% (10 of 19 held: the unconfirmed carried-over mark is not counted), here on the last school day (' + [n.pct, n.held, n.absentRun, n.lastAttended] + ')');
  assert(n.belowPass.length === 1 && n.belowPass[0].title === 'Week 9 worksheet' && n.belowPass[0].pct === 30 && n.belowPass[0].passMark === 60, 'and her 6/20 worksheet (30%, pass 60%)');
  const r = by['S-RICARDO'];
  assert(r.belowPass.length === 1 && r.belowPass[0].kind === 'exam' && r.belowPass[0].pct === 40 && r.belowPass[0].passMark === 60, 'Ricardo: the Unit 5 test, 40% against its own pass mark of 60%');
  const s = by['S-SASHA'];
  assert(s.missing.map(m => m.id).join() === 'A10' && s.belowPass.length === 0, 'Sasha: the Week 10 report past due and not handed in (the August fail is not recent; work not due yet or not to be handed in is not "missing")');
  assert(s.pct === 100, 'late counts as attended');
}
console.log('What a trainee owes (office only), found the fee page\'s way');
{
  const fee = [{ id: 'SF-1', name: 'Damion Lewis', skillArea: W, tuitionFee: 85000 }, { id: 'SF-2', name: 'Nadine Bailey', skillArea: W, tuitionFee: 0, totalPaid: 0 },
    { id: 'SF-3', name: 'Ricardo Francis', skillArea: W, tuitionFee: 85000, totalPaid: 85000 }];
  const pay = [{ studentId: 'SF-1', amount: 25000 }, { studentId: 'SF-1', amount: '10000' }];
  const idx = Core.feeTwinIndex(fee);
  assert(AT.owedFrom(students[0], fee, pay, idx) === 50000, 'Damion owes $50,000 of $85,000 (two payments)');
  assert(AT.owedFrom(students[1], fee, pay, idx) === 'unpriced', 'a record with no fee set owes an unknown amount, never "nothing"');
  assert(AT.owedFrom(students[2], fee, pay, idx) === 0, 'paid up');
  assert(AT.owedFrom(students[3], fee, pay, idx) === null, 'no record: nothing said');
  const withFee = AT.list({ students, register, today: TODAY, endedOf: ended, results, exams, assignments, submissions, sameProgramme: same, nowMs: NOW,
    feeOf: s => AT.owedFrom(s, fee, pay, idx) });
  assert(withFee[0].owed === 50000, 'the office\'s rows carry it');
  assert(!('owed' in rows[0]), 'and rows built without it carry nothing about money');
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
function page(role) {
  const els = {};
  const reads = [];
  const store = { cestiSchoolFeeStudents: JSON.stringify([{ id: 'SF-1', name: 'Damion Lewis', skillArea: W, tuitionFee: 85000 }]), cestiSchoolFeePayments: JSON.stringify([{ studentId: 'SF-1', amount: 35000 }]) };
  const plumber = { id: 'S-PLUMB', name: 'Brandon Lee', course: P, stage: 'training' };
  const sb = {
    console, JSON, Math, Date, String, Number, Object, CESTISCore: Core, currentRole: role,
    currentInstructor: role === 'instructor' ? { name: 'Ian Barrett', course: W } : null,
    students: students.concat([plumber]), attendanceRegister: register.concat(marks('S-PLUMB', 'AAAAPPPPPPPPPPPPPPPP')),
    examResults: results, exams, instructorAssignments: assignments, assignmentSubmissions: submissions,
    localDateStr: () => TODAY, studentCourseStatus: s => (s.course === C ? 'ended' : 'running'), instructorCourseMatch: same,
    CESTISStore: { getItem: k => { reads.push(k); return store[k] || null; } },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    jsArg: s => JSON.stringify(String(s)).replace(/"/g, '&quot;'),
    document: { getElementById: id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '' }), querySelectorAll: () => [] }
  };
  sb.escapeAttr = sb.escapeHtml;
  vm.createContext(sb);
  vm.runInContext('var ATTENTION_PAGES = { "needs-attention": "admin", "as-needs-attention": "adminstaff", "i-needs-attention": "instructor" };' +
    ['attentionIsOffice', 'attentionScope', 'attentionFeeOf', 'attentionRows', 'attentionLowAttendanceCount', 'ensureAttentionPage', 'attentionShortDate', 'renderNeedsAttention'].map(fn).join('\n'), sb);
  return { sb, els, reads };
}
{
  const { sb, els, reads } = page('instructor');
  const r = vm.runInContext('attentionRows()', sb);
  assert(r.every(x => x.course === W) && r.length === 4, 'an instructor\'s list: her own programme\'s trainees only (the Plumbing trainee absent 4 in a row is not on it)');
  assert(reads.length === 0 && r.every(x => !('owed' in x)), 'and the fee records are never read for her');
  vm.runInContext('renderNeedsAttention("i-needs-attention")', sb);
  assert(!/Owes/.test(els['attnHead-i-needs-attention'].innerHTML), 'her table has no "Owes" column');
  const body = els['attnBody-i-needs-attention'].innerHTML;
  assert(body.indexOf('Damion Lewis') < body.indexOf('Nadine Bailey') && /tel:8765550143/.test(body) && /openDirectChatWithTrainee\(/.test(body), 'most urgent first, the phone to call, and Message on every row');
  assert(!/\$/.test(body), 'no money anywhere on it');
  assert(vm.runInContext('attentionLowAttendanceCount()', sb) === 1, 'the dashboard alert counts by the same rule: 1 below 70% (Nadine)');
}
{
  const { sb, els, reads } = page('admin');
  const r = vm.runInContext('attentionRows()', sb);
  assert(r.some(x => x.course === P) && r.length === 5, 'the office\'s list: every programme');
  assert(reads.indexOf('cestiSchoolFeeStudents') !== -1 && r.find(x => x.id === 'S-DAMION').owed === 50000, 'with what each owes (Damion $50,000)');
  vm.runInContext('renderNeedsAttention("needs-attention")', sb);
  assert(/<th class="num">Owes<\/th>/.test(els['attnHead-needs-attention'].innerHTML) && /\$50,000\.00/.test(els['attnBody-needs-attention'].innerHTML), 'its table shows "Owes": $50,000.00');
  const as = page('adminstaff'); vm.runInContext('renderNeedsAttention("as-needs-attention")', as.sb);
  assert(/Owes/.test(as.els['attnHead-as-needs-attention'].innerHTML), 'Admin Staff see it too');
}
{
  assert(/const lowAttendance = attentionLowAttendanceCount\(\);/.test(fn('buildAdminPages')) && /id="dashLowAttendanceAlert" onclick="showPage\('needs-attention'\)"/.test(fn('buildAdminPages')), 'the administrator\'s "below 70% attendance" alert opens the list and counts by its rule');
  assert(/id="iDashLowAttendanceAlert" onclick="showPage\('i-needs-attention'\)"/.test(fn('buildInstructorPages')), 'so does the instructor\'s');
  assert(/data-page="as-needs-attention"/.test(fn('buildAdminStaffSidebar')) && /data-page="i-needs-attention"/.test(fn('buildInstructorSidebar')) && /data-page="needs-attention"/.test(fn('buildAdminSidebar')), 'each of the three has it in the sidebar');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
