/* A realistic small Centre, as of Wed 28 Oct 2026, with independent ground
   truth — the productivity audit's Centre (management area), made up from
   start to finish: every name, number and date is invented.

     Welding & Fabrication   25 in training   (intake Sep 2026)
     Electrical Installation 20 in training   (intake Sep 2026)
     Solar Energy Tech       15 in training   (intake Sep 2026)
     Cosmetology             30, intake ended 31 Jul 2026: 12 certified,
                             8 collected, 6 Not Yet Competent, 4 dropouts
     Plumbing                10 applicants (testing / interview)

   9,165 dated register marks, 7 exams / 139 results (12 awaiting marking),
   90 fee accounts. Fees this financial year (2026/2027): billed $1,785,000,
   collected $909,000, owed $876,000; earlier years: $140,000 still owed by
   10 Cosmetology trainees.

   The truth (T) is counted here with plain arithmetic of its own — never by
   the rules under test — so a figure a screen shows can be compared with it.
   Used by tests/board-figures.test.js and tests/browser/board-figures.js. */
'use strict';
const Core = require('../../cestis-core.js');
let seed = 20261028;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const FIRST = ['Tameka','Kemar','Shanice','Andre','Kerry-Ann','Dwayne','Sasha','Romaine','Nadine','Omar','Tashana','Jermaine','Alicia','Ricardo','Kadian','Shawn','Monique','Damion','Latoya','Garfield','Simone','Christopher','Natalie','Odane','Peta-Gaye','Kevin','Jodi-Ann','Marlon','Stacy-Ann','Rushane','Abigail','Devon','Kimberly','Leon','Shellyann','Duane','Tanisha','Oneil','Crystal','Javier'];
const LAST = ['Brown','Williams','Campbell','Thompson','Smith','Johnson','Clarke','Reid','Morgan','Lewis','Grant','Henry','Francis','Gordon','Walker','Edwards','Allen','Bennett','Stewart','Richards','Robinson','Wright','Graham','Hall','Ellis','Palmer','Barrett','McKenzie','Spence','Douglas'];
const used = {};
function person() {
  for (;;) { const n = FIRST[Math.floor(rnd() * FIRST.length)] + ' ' + LAST[Math.floor(rnd() * LAST.length)]; if (!used[n]) { used[n] = 1; return n; } }
}
const TODAY = '2026-10-28';
function days(from, to) { // weekdays from..to inclusive, Jamaica local dates
  const out = []; const d = new Date(from + 'T12:00:00Z'); const end = new Date(to + 'T12:00:00Z');
  while (d <= end) { const w = d.getUTCDay(); if (w >= 1 && w <= 5) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const CENTRES = {
  W: { id: 1, name: 'Welding & Fabrication', start: '2026-09-07', end: '2027-06-25', n: 25, instructor: 'Andre Campbell', fee: 28000 },
  E: { id: 2, name: 'Electrical Installation', start: '2026-09-07', end: '2027-06-25', n: 20, instructor: 'Dwayne Morgan', fee: 28000 },
  S: { id: 18, name: 'Solar Energy Tech', start: '2026-09-14', end: '2027-03-26', n: 15, instructor: 'Kerry Lewis', fee: 35000 },
  C: { id: 3, name: 'Cosmetology', start: '2025-09-08', end: '2026-07-31', n: 30, instructor: 'Sasha Grant', fee: 30000 },
  P: { id: 6, name: 'Plumbing', start: '', end: '', n: 10, instructor: '', fee: 0 }
};
const students = [], att = [], truth = { stopped: [], chronic: [], byCentre: {} };
const HOLIDAY = '2026-10-19';
Object.keys(CENTRES).forEach(k => {
  const c = CENTRES[k];
  for (let i = 0; i < c.n; i++) {
    const name = person();
    const s = { name, course: c.name, centreId: c.id, gender: rnd() < 0.5 ? 'Male' : 'Female', instructor: c.instructor,
      createdAt: (c.start || '2026-10-01') + 'T14:00:00.000Z', courseStart: c.start, courseEnd: c.end, score: '', progress: 0, gpa: '0.0',
      email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', phone: '876555' + String(1000 + students.length).slice(-4), updatedAt: '2026-10-01T12:00:00.000Z' };
    s.id = Core.stableStudentId(s);
    s._k = k; s._i = i;
    if (k === 'P') s.stage = i < 6 ? 'testing' : 'interview';
    else if (k === 'C') s.stage = i < 12 ? 'certified' : i < 20 ? 'collected' : i < 26 ? 'nyc' : 'incomplete';
    else s.stage = 'training';
    if (k === 'C' && i < 20) {
      const m = i < 6 ? '08' : i < 14 ? '09' : '10';
      s.certNo = 'CO-2026-' + String(4100 + i) + '-AB'; s.certDate = '2026-' + m + '-' + String(5 + i).padStart(2, '0');
      s.certCollected = i >= 12;
    }
    if (k === 'C' && i >= 26) s.enrolStatus = 'dropout';
    students.push(s);
  }
});
// A few genders not recorded, and dates of birth for some trainees only, so
// the programme return's "not recorded" rows have something to count.
(function () {
  const by = k => students.filter(s => s._k === k);
  by('W').forEach((s, i) => { if (i === 20 || i === 21) s.gender = ''; if (i < 15) s.dob = (1990 + i) + '-0' + (1 + (i % 9)) + '-15'; });
  by('E').forEach((s, i) => { if (i < 10) s.dob = (2000 + i) + '-05-20'; });
  by('P').forEach((s, i) => { if (i === 9) s.gender = ''; });
})();
// Attendance
function mark(s, date, status) { att.push({ studentId: s.id, date, status, studentName: s.name, course: s.course }); }
students.forEach(s => {
  const c = CENTRES[s._k];
  if (!c.start) return;
  const last = s._k === 'C' ? c.end : '2026-10-27';
  const list = days(c.start, last);
  const stopped = s._k !== 'C' && s._i < 3;          // stopped coming from 1 Oct
  const chronic = s._k !== 'C' && (s._i === 3 || s._i === 4);
  const dropC = s._k === 'C' && s._i >= 26;
  if (stopped) truth.stopped.push(s.name);
  if (chronic) truth.chronic.push(s.name);
  list.forEach(d => {
    if (d === HOLIDAY) return mark(s, d, 'noclass');
    if (s._k === 'S' && d >= '2026-10-26') return;     // instructor has not taken this week's register
    let st;
    if (stopped && d >= '2026-10-01') st = 'absent';
    else if (dropC && d >= '2026-01-12') st = 'absent';
    else if (chronic) st = rnd() < 0.42 ? 'absent' : 'present';
    else { const r = rnd(); st = r < 0.06 ? 'absent' : r < 0.11 ? 'late' : 'present'; }
    mark(s, d, st);
  });
});
// Exams + results
const exams = [], results = [];
function exam(id, title, k, date, status, extra) { const e = Object.assign({ id, title, course: CENTRES[k].name, date, time: '09:00', duration: 60, status, passMark: 60, questions: 20, createdBy: 'admin', createdByRole: 'admin', updatedAt: date + 'T12:00:00.000Z' }, extra || {}); exams.push(e); return e; }
function result(e, s, score, opts) {
  opts = opts || {};
  results.push(Object.assign({ id: 'RES-' + e.id + '-' + s.id, examId: e.id, examTitle: e.title, studentId: s.id, studentName: s.name, course: s.course,
    score, passed: !opts.review && score >= 60, correctCount: Math.round(score / 5), totalQuestions: 20, submittedAt: e.date + 'T10:00:00.000Z', date: e.date }, opts.review ? { needsReview: true, reviewComplete: false } : {}));
}
const byK = k => students.filter(s => s._k === k);
const W = byK('W'), E = byK('E'), S = byK('S'), C = byK('C');
const eW1 = exam('EX-W1', 'Welding Safety — Unit 1', 'W', '2026-10-02', 'completed');
W.forEach((s, i) => { if (i < 2) return; result(eW1, s, i < 8 ? 40 + i * 2 : 65 + (i % 7) * 5); });
const eW2 = exam('EX-W2', 'Welding Theory — Unit 2 (essay)', 'W', '2026-10-23', 'completed');
W.forEach((s, i) => { if (i < 5) return; if (i < 17) result(eW2, s, 50, { review: true }); else result(eW2, s, i < 19 ? 45 : 72); });
const eE1 = exam('EX-E1', 'Electrical Principles — Unit 1', 'E', '2026-10-09', 'completed');
E.forEach((s, i) => { if (i < 2) return; result(eE1, s, i < 10 ? 35 + i * 2 : 66 + (i % 5) * 6); });
exam('EX-S1', 'Solar PV Fundamentals', 'S', '2026-11-05', 'upcoming');
['2026-02-13', '2026-04-17', '2026-06-19'].forEach((d, j) => {
  const e = exam('EX-C' + (j + 1), 'Cosmetology Unit ' + (j + 1), 'C', d, 'completed');
  C.forEach((s, i) => { if (i >= 26) return; result(e, s, i >= 20 ? 48 + j : 70 + (i % 6) * 4); });
});
// Assignments + submissions
const assignments = [], subs = [];
function assignment(id, title, k, due, gradedN, subN, maxPoints) {
  const a = { id, title, course: CENTRES[k].name, type: 'report', dueDate: due, maxPoints: maxPoints || 100, weight: 10, createdBy: CENTRES[k].instructor, grades: {}, createdAt: '2026-09-20T12:00:00.000Z', updatedAt: '2026-09-20T12:00:00.000Z' };
  assignments.push(a);
  const roll = byK(k);
  roll.forEach((s, i) => {
    if (i < roll.length - subN) return;
    subs.push({ id: 'SUB-' + id + '-' + s.id, assignmentId: id, studentId: s.id, studentName: s.name, course: s.course, submittedAt: due + 'T15:00:00.000Z', files: [], attempt: 1 });
  });
  const mine = subs.filter(x => x.assignmentId === id);
  mine.slice(0, gradedN).forEach((x, j) => { a.grades[x.studentId] = 55 + (j % 9) * 5; });
  return a;
}
assignment('A-W1', 'Weld joint portfolio', 'W', '2026-10-09', 21, 21);
assignment('A-W2', 'Workshop safety report', 'W', '2026-10-16', 5, 20);
assignment('A-E1', 'Circuit calculations worksheet', 'E', '2026-10-14', 0, 16);
assignment('A-S1', 'Site survey', 'S', '2026-10-30', 0, 4);
// Requests
const reqs = [];
function req(i, s, type, status, at) { reqs.push({ id: 'REQ-' + i, studentId: s.id, studentName: s.name, course: s.course, type, status, requestedAt: at, updatedAt: at }); }
req(1, C[0], 'transcript', 'pending', '2026-09-15T14:00:00.000Z');
req(2, C[1], 'certificate', 'pending', '2026-09-29T14:00:00.000Z');
req(3, C[2], 'transcript', 'pending', '2026-10-20T14:00:00.000Z');
req(4, C[21], 'transcript', 'pending', '2026-10-26T14:00:00.000Z');
req(5, C[3], 'transcript', 'processing', '2026-10-02T14:00:00.000Z');
req(6, C[4], 'certificate', 'processing', '2026-10-12T14:00:00.000Z');
req(7, C[5], 'transcript', 'ready', '2026-10-05T14:00:00.000Z');
req(8, C[6], 'transcript', 'ready', '2026-10-07T14:00:00.000Z');
req(9, C[13], 'transcript', 'collected', '2026-08-20T14:00:00.000Z');
// Fees (School Fee app records, linked to the LMS ids)
const feeStudents = [], payments = [];
let rc = 1000;
students.forEach(s => {
  const c = CENTRES[s._k];
  if (s._k === 'P') return;
  const fee = c.fee;
  // payment pattern
  let paid;
  const r = rnd();
  if (s._k === 'C') paid = s._i >= 26 ? 10000 : r < 0.75 ? fee : fee - 10000;
  else paid = s._i < 3 ? 5000 : r < 0.3 ? fee : r < 0.8 ? 15000 : 5000;
  const pays = [];
  let left = paid, n = 0;
  while (left > 0) { const amt = Math.min(left, n === 0 ? 5000 : 10000); pays.push(amt); left -= amt; n++; }
  pays.forEach((amt, j) => {
    const d = new Date((c.start) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 14 + j * 30);
    payments.push({ id: 'PAY-' + (rc++), studentId: 'SF-' + s.id, studentName: s.name, skillArea: c.name, amount: amt, date: d.toISOString().slice(0, 10), method: 'Cash', term: 'Term ' + (j + 1), receiptNumber: 'R' + rc, notes: '', createdAt: d.toISOString() });
  });
  feeStudents.push({ id: 'SF-' + s.id, lmsId: s.id, name: s.name, skillArea: c.name, tuitionFee: fee, contact: s.phone, email: s.email, enrollmentDate: c.start, dateOfBirth: '2000-01-01', gender: s.gender,
    totalPaid: paid, balance: fee - paid, status: paid >= fee ? 'Fully Paid' : paid > 0 ? 'Partial Payment' : 'Outstanding', createdAt: c.start + 'T12:00:00.000Z', source: 'lms', centreId: c.id, centreName: c.name, courseStart: c.start, courseEnd: c.end, updatedAt: '2026-10-01T12:00:00.000Z' });
});
const feeStructure = { 'Welding & Fabrication': { total: 28000, terms: [10000, 10000, 8000] }, 'Electrical Installation': { total: 28000, terms: [10000, 10000, 8000] },
  'Solar Energy Tech': { total: 35000, terms: [12000, 12000, 11000] }, 'Cosmetology': { total: 30000, terms: [10000, 10000, 10000] } };

// ---------- ground truth ----------
const T = {};
const roster = students;
T.total = roster.length;
T.active = roster.filter(s => s.stage === 'training').length;
T.byStage = roster.reduce((a, s) => { a[s.stage] = (a[s.stage] || 0) + 1; return a; }, {});
function rate(recs) { let a = 0, h = 0; recs.forEach(r => { if (r.status === 'present' || r.status === 'late') { a++; h++; } else if (r.status === 'absent') h++; }); return h ? a / h * 100 : null; }
const attBy = {}; att.forEach(r => { (attBy[r.studentId] = attBy[r.studentId] || []).push(r); });
T.ratePerStudent = {}; roster.forEach(s => { const r = rate(attBy[s.id] || []); if (r != null) T.ratePerStudent[s.id] = Math.round(r); });
const active = roster.filter(s => s.stage === 'training');
T.activeBelow70 = active.filter(s => T.ratePerStudent[s.id] < 70).map(s => s.name);
const lastPresent = {}; att.forEach(r => { if ((r.status === 'present' || r.status === 'late') && (!lastPresent[r.studentId] || r.date > lastPresent[r.studentId])) lastPresent[r.studentId] = r.date; });
T.activeNotSeen14d = active.filter(s => !lastPresent[s.id] || lastPresent[s.id] < '2026-10-14').map(s => s.name);
T.avgAttActive = Math.round(active.reduce((a, s) => a + (T.ratePerStudent[s.id] || 0), 0) / active.length);
const vals = Object.values(T.ratePerStudent); T.avgAttAllWithRecords = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
// this quarter (FY Q3 = Oct-Dec) attendance for running intakes
const q = att.filter(r => r.date >= '2026-10-01' && r.date <= '2026-12-31'); T.rateThisQuarter = Math.round(rate(q));
// exams
const fin = results.filter(r => !r.needsReview);
T.examResults = results.length; T.examFinal = fin.length; T.examPassedFinal = fin.filter(r => r.passed).length; T.examPending = results.length - fin.length;
T.examPassRateFinal = Math.round(T.examPassedFinal / T.examFinal * 100);
T.examPassRateNaive = Math.round(results.filter(r => r.passed).length / results.length * 100);
// latest per student per exam failing -> retake list
T.retakeNeeded = []; const seen = {}; fin.forEach(r => { if (!r.passed) { const s = roster.find(x => x.id === r.studentId); if (s && s.stage !== 'certified' && s.stage !== 'collected') T.retakeNeeded.push(s.name + ' / ' + r.examTitle); } });
// coursework
T.subsTotal = subs.length; T.subsGraded = subs.filter(x => { const a = assignments.find(a => a.id === x.assignmentId); return a.grades[x.studentId] != null; }).length; T.subsPending = T.subsTotal - T.subsGraded;
T.pendingOver7d = subs.filter(x => { const a = assignments.find(a => a.id === x.assignmentId); return a.grades[x.studentId] == null && x.submittedAt.slice(0, 10) <= '2026-10-21'; }).length;
T.missingPastDue = assignments.filter(a => a.dueDate < TODAY).reduce((n, a) => n + (byK(Object.keys(CENTRES).find(k => CENTRES[k].name === a.course)).length - subs.filter(x => x.assignmentId === a.id).length), 0);
// certification
T.certIssued = roster.filter(s => s.certNo).length; T.certCollected = roster.filter(s => s.certCollected).length; T.certUncollected = T.certIssued - T.certCollected;
T.certThisYear = roster.filter(s => s.certDate && s.certDate.startsWith('2026')).length;
T.reqOpen = reqs.filter(r => r.status === 'pending' || r.status === 'processing').length; T.reqReady = reqs.filter(r => r.status === 'ready').length;
T.reqOldestOpenDays = Math.round((Date.parse(TODAY) - Date.parse('2026-09-15')) / 864e5);
// fees
T.feeBilled = feeStudents.reduce((a, f) => a + f.tuitionFee, 0); T.feeCollected = payments.reduce((a, p) => a + p.amount, 0);
T.feeOutstanding = feeStudents.reduce((a, f) => a + f.balance, 0); T.feeDebtors = feeStudents.filter(f => f.balance > 0).length;
T.feeByProgramme = {}; feeStudents.forEach(f => { const o = T.feeByProgramme[f.skillArea] = T.feeByProgramme[f.skillArea] || { billed: 0, paid: 0, owed: 0, debtors: 0 }; o.billed += f.tuitionFee; o.paid += f.totalPaid; o.owed += f.balance; if (f.balance > 0) o.debtors++; });
T.stoppedOwing = feeStudents.filter(f => truth.stopped.includes(f.name)).map(f => f.name + ' owes ' + f.balance);
// completion — for ENDED intakes only
const ended = roster.filter(s => s._k === 'C');
T.completionEndedIntakes = Math.round(ended.filter(s => s.stage === 'certified' || s.stage === 'collected').length / ended.length * 100);
T.completionNaive = Math.round(roster.filter(s => s.stage === 'certified' || s.stage === 'collected').length / roster.length * 100);
T.dropoutEnded = Math.round(ended.filter(s => s.stage === 'incomplete').length / ended.length * 1000) / 10;
T.stopped = truth.stopped; T.chronic = truth.chronic;

// ---------- fees by financial year (April to March), counted by hand ----------
// An account's year is the year its enrolment date falls in; a payment's, the
// year it is dated in. FY 2026/2027 is the present year for a Centre in Oct 2026.
function fyStartOf(d) { const m = /^(\d{4})-(\d{2})/.exec(String(d || '')); return m ? (+m[2] >= 4 ? +m[1] : +m[1] - 1) : null; }
const paidOf = {};
payments.forEach(p => { paidOf[p.studentId] = (paidOf[p.studentId] || 0) + p.amount; });
T.feesFY = { fy: '2026/2027', billed: 0, collected: 0, owed: 0, accounts: 0, debtors: 0, byProgramme: {} };
T.feesEarlier = { owed: 0, trainees: 0, byProgramme: {} };
feeStudents.forEach(f => {
  const y = fyStartOf(f.enrollmentDate), owes = f.tuitionFee - (paidOf[f.id] || 0);
  if (y === 2026) {
    const o = T.feesFY.byProgramme[f.skillArea] = T.feesFY.byProgramme[f.skillArea] || { billed: 0, collected: 0, owed: 0, accounts: 0, debtors: 0 };
    T.feesFY.billed += f.tuitionFee; o.billed += f.tuitionFee;
    T.feesFY.owed += owes; o.owed += owes;
    T.feesFY.accounts++; o.accounts++;
    if (owes > 0) { T.feesFY.debtors++; o.debtors++; }
  } else if (y < 2026 && owes > 0) {
    const e = T.feesEarlier.byProgramme[f.skillArea] = T.feesEarlier.byProgramme[f.skillArea] || { owed: 0, trainees: 0 };
    T.feesEarlier.owed += owes; T.feesEarlier.trainees++; e.owed += owes; e.trainees++;
  }
});
payments.forEach(p => {
  if (fyStartOf(p.date) !== 2026) return;
  T.feesFY.collected += p.amount;
  const o = T.feesFY.byProgramme[p.skillArea]; if (o) o.collected += p.amount;
});

// ---------- the programme return, counted by hand ----------
// Per programme (each is one intake here), for a period [from, to] (no bounds:
// every date). Enrolment and stages are as at the Centre's "today"; attendance,
// marked test results and payments are those DATED in the period.
function inPeriod(d, from, to) { d = String(d || '').slice(0, 10); return (!from || d >= from) && (!to || d <= to); }
function ageOn(dob, on) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || '')); if (!m) return null;
  const o = /^(\d{4})-(\d{2})-(\d{2})/.exec(on);
  let a = +o[1] - +m[1]; if (+o[2] < +m[2] || (+o[2] === +m[2] && +o[3] < +m[3])) a--; return a;
}
function band(a) { return a == null ? 'Not recorded' : a < 18 ? 'Under 18' : a <= 24 ? '18–24' : a <= 34 ? '25–34' : a <= 44 ? '35–44' : '45 and over'; }
function returnTruth(from, to, asAt) {
  const out = {};
  Object.keys(CENTRES).forEach(k => {
    const c = CENTRES[k], roll = students.filter(s => s.course === c.name);
    const ended = !!c.end && c.end < TODAY;
    const isApp = s => s.stage === 'testing' || s.stage === 'interview';
    const isDrop = s => s.stage === 'incomplete' || s.enrolStatus === 'dropout';
    const active = roll.filter(s => s.stage === 'training' && !isDrop(s));
    // attendance: each active trainee's own rate in the period, then the average
    const rates = [];
    active.forEach(s => {
      let a = 0, h = 0;
      att.forEach(r => { if (r.studentId !== s.id || !inPeriod(r.date, from, to)) return; if (r.status === 'present' || r.status === 'late') { a++; h++; } else if (r.status === 'absent') h++; });
      if (h) rates.push(Math.round(a / h * 100));
    });
    const ids = {}; roll.forEach(s => { ids[s.id] = 1; });
    const mine = results.filter(r => ids[r.studentId] && inPeriod(r.date, from, to));
    const marked = mine.filter(r => !r.needsReview);
    const accts = feeStudents.filter(f => ids[f.lmsId]);
    const accIds = {}; accts.forEach(f => { accIds[f.id] = 1; });
    const endedPop = ended ? roll.filter(s => !isApp(s)) : [];
    const genders = {}, ages = {};
    roll.forEach(s => {
      const g = s.gender ? s.gender : 'Not recorded';
      const b = band(ageOn(s.dob, asAt));
      [[genders, g], [ages, b]].forEach(([map, key]) => {
        const o = map[key] = map[key] || { applicants: 0, enrolled: 0, active: 0, completed: 0, certified: 0, nyc: 0, dropouts: 0 };
        if (isApp(s)) { o.applicants++; return; }
        o.enrolled++;
        if (s.stage === 'training' && !isDrop(s)) o.active++;
        if (ended && !isDrop(s)) o.completed++;
        if (s.stage === 'certified' || s.stage === 'collected') o.certified++;
        if (s.stage === 'nyc') o.nyc++;
        if (isDrop(s)) o.dropouts++;
      });
    });
    out[c.name] = {
      onRoll: roll.length,
      applicants: roll.filter(isApp).length,
      enrolled: roll.filter(s => !isApp(s)).length,
      active: active.length,
      completed: ended ? roll.filter(s => !isApp(s) && !isDrop(s)).length : 0,
      certified: roll.filter(s => s.stage === 'certified' || s.stage === 'collected').length,
      nyc: roll.filter(s => s.stage === 'nyc').length,
      dropouts: roll.filter(isDrop).length,
      completion: endedPop.length ? { rate: Math.round(endedPop.filter(s => s.stage === 'certified' || s.stage === 'collected').length / endedPop.length * 100), of: endedPop.length } : { rate: null, of: 0 },
      attendance: rates.length ? { rate: Math.round(rates.reduce((x, y) => x + y, 0) / rates.length), of: rates.length } : { rate: null, of: 0 },
      pass: { rate: marked.length ? Math.round(marked.filter(r => r.passed).length / marked.length * 100) : null, of: marked.length, awaiting: mine.length - marked.length },
      billed: accts.reduce((x, f) => x + f.tuitionFee, 0),
      collected: payments.filter(p => accIds[p.studentId] && inPeriod(p.date, from, to)).reduce((x, p) => x + p.amount, 0),
      owed: accts.reduce((x, f) => x + f.tuitionFee - (paidOf[f.id] || 0), 0),
      genders, ages
    };
  });
  return out;
}
T.returnAll = returnTruth('', '', TODAY);
T.returnQ3 = returnTruth('2026-10-01', '2026-12-31', '2026-12-31');      // FY 2026/2027 Q3, Oct–Dec 2026
T.TODAY = TODAY;

students.forEach(s => { delete s._k; delete s._i; });
module.exports = { students, att, exams, results, assignments, subs, reqs, feeStudents, payments, feeStructure, T, CENTRES };
if (require.main === module) {
  console.log(JSON.stringify(T, null, 1));
  console.log('records: students', students.length, 'att', att.length, 'exams', exams.length, 'results', results.length, 'assign', assignments.length, 'subs', subs.length, 'fees', feeStudents.length, 'payments', payments.length);
}
