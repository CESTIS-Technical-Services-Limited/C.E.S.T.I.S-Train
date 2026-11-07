/* The administrator's dashboard counts one financial year — "trainees to date".

   The owner: "put a filter fiscal year for dashboard as well that ensure only
   trainee to date are shown, not data for centres closed." The dashboard
   counted every trainee the Centre ever had: last year's groups and finished
   intakes in every total. It now has School Fee's year bar (◀ Previous year |
   FY | Next year ▶, Whole Year, Q1–Q4, All Years) and a switch for closed
   centres, and one rule (CESTISCore.yearView) decides who every figure counts.

   Pinned here, on a made-up Centre on Saturday 7 November 2026 (FY 2026/2027,
   Q3), with trainees across three financial years, open and closed centres,
   trainees stamped at enrolment and trainees with no stamps at all:

     1. where a trainee sits in time — enrolment date, then the stamped year,
        then the centre's dates, then the date the record was made;
     2. the present year: enrolled this year to date, plus trainees of an
        earlier intake still running, leaving out closed centres — and the
        switch that brings them back;
     3. the quarters (by enrolment date), a past year (everything in it,
        closed centres too), a year ahead, and All Years (everyone);
     4. NO TRAINEE IS EVER LOST: in every choice, each trainee on the roll is
        counted, or named in a note (not counted yet, no year, no quarter,
        closed centre), or in another year or quarter;
     5. exams and classes follow the same period and closed-centre rule;
     6. School Fees: with closed centres included it is School Fee's own
        figures (centreFigures.fees) to the dollar; closed centres' accounts
        and payments are left out by default; quarters and All Years;
     7. the choice is this screen's own and survives a new financial year;
        a storage that refuses does not break the dashboard;
     8. the dashboard itself (index.html, both builds): every block draws
        from the one answer (dashScope), the bar says plainly what is shown,
        and nothing it does changes a record.

   Run: node tests/dash-fiscal-year.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const Y = Core.yearView, E = Core.enrolment;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const TODAY = '2026-11-07', NOW = Date.parse('2026-11-07T17:00:00Z');
const at = { today: TODAY, nowMs: NOW };

/* ---------- a made-up Centre ---------- */
const AREAS = [
  { id: 3, name: 'Cosmetology', startDate: '2025-09-08', endDate: '2026-03-20' },            // closed, FY 2025/2026 only
  { id: 1, name: 'Welding & Fabrication', startDate: '2026-09-07', endDate: '2027-06-25' },  // open, this year
  { id: 2, name: 'Electrical Installation', startDate: '2026-04-13', endDate: '2026-08-28' },// closed during this year
  { id: 18, name: 'Solar Energy Tech', startDate: '2026-01-12', endDate: '2026-12-18' },     // open, began last year
  { id: 6, name: 'Plumbing', startDate: '', endDate: '' },                                    // no dates
  { id: 7, name: 'Masonry', startDate: '2024-09-02', endDate: '2025-06-27' }                  // closed, FY 2024/2025, ran into 2025/2026
];
const area = id => AREAS.find(a => a.id === id);
const roll = [];
function stamped(name, centreId, on, stage, extra) {
  roll.push(Object.assign({ id: 'S-' + name.replace(/\W+/g, ''), name, course: area(centreId).name, stage }, E.enrolmentStamp(area(centreId), on), extra || {}));
}
stamped('Cora One', 3, '2025-09-08', 'certified', { certNo: 'CO-1', certDate: 'October 16, 2026' });
stamped('Cora Two', 3, '2025-09-08', 'certified', { certNo: 'CO-2', certDate: '2026-09-03' });
stamped('Cora Three', 3, '2025-09-08', 'collected', { certNo: 'CO-3', certDate: '2026-08-20', certCollected: true });
stamped('Cora Four', 3, '2025-09-08', 'incomplete');
['Wes One', 'Wes Two', 'Wes Three', 'Wes Four', 'Wes Five'].forEach(n => stamped(n, 1, '2026-09-07', 'training'));
stamped('Wes October', 1, '2026-10-15', 'training');
stamped('Wes Late October', 1, '2026-10-20', 'training');
stamped('Wes December', 1, '2026-12-01', 'testing');                 // enrolled with a date after today
stamped('Eli One', 2, '2026-04-13', 'certified', { certNo: 'EL-1', certDate: '2026-09-10' });
stamped('Eli Two', 2, '2026-04-13', 'nyc');
stamped('Eli Three', 2, '2026-04-13', 'collected', { certNo: 'EL-3', certDate: '2026-09-11', certCollected: true });
stamped('Mason One', 7, '2024-09-02', 'collected', { certNo: 'MA-1', certDate: '2025-07-10', certCollected: true });
stamped('Mason Two', 7, '2024-09-02', 'nyc');
// Trainees from before enrolments were stamped: a course name and the day the record was made.
['Sol One', 'Sol Two', 'Sol Three'].forEach(n => roll.push({ id: 'S-' + n.replace(/\W+/g, ''), name: n, course: 'Solar Energy Tech', stage: 'training', createdAt: '2026-01-12T14:00:00.000Z' }));
['Pip One', 'Pip Two'].forEach(n => roll.push({ id: 'S-' + n.replace(/\W+/g, ''), name: n, course: 'Plumbing', stage: 'testing', createdAt: '2026-10-20T15:00:00.000Z' }));
// Only the year stamped, and the centre id.
roll.push({ id: 'S-StampOnly', name: 'Stamp Only', course: 'Welding & Fabrication', centreId: 1, fiscalYear: '2026/2027', stage: 'interview' });
// The centre record is gone; the course dates stamped on the trainee still say it closed.
roll.push({ id: 'S-OldProg', name: 'Old Programme', course: 'Leathercraft', enrolmentDate: '2026-05-04', courseStart: '2026-05-04', courseEnd: '2026-07-31', stage: 'certified', certNo: 'LC-1', certDate: '2026-08-01' });
// Nothing at all says when.
roll.push({ id: 'S-Nowhen', name: 'No When', course: 'Mystery Course', stage: 'training' });
const TOTAL = roll.length;
const centreOf = s => AREAS.find(a => s.centreId != null && a.id === s.centreId) ||
  E.findCentre(AREAS, s.course, { on: s.enrolmentDate || s.createdAt || '' }) || null;
const BEFORE = JSON.stringify(roll);
const names = list => list.map(s => s.name).sort().join(', ');
const sc = view => Y.scope(roll, view, Object.assign({ centreOf }, at));
function accounted(r, what) {
  const n = r.roll.length + r.closedOut.length + r.later.length + r.unplaced.length + r.noQuarter.length +
    r.carriedNotInQuarter + r.otherQuarters + r.otherYears;
  assertEq(n, TOTAL, what + ': every one of the ' + TOTAL + ' trainees is counted, named in a note, or in another year or quarter');
}

console.log('1. Where a trainee sits in time');
{
  const p = s => Y.placeOf(s, centreOf(s));
  const by = n => roll.find(s => s.name === n);
  assertEq(JSON.stringify(p(by('Wes One'))), JSON.stringify({ fy: '2026/2027', date: '2026-09-07', joined: '2026-09-07', how: 'enrolled' }), 'enrolment date first');
  assertEq(p(by('Sol One')).fy, '2025/2026', 'no stamp: the centre\'s year (it began in January 2026)');
  assertEq(p(by('Sol One')).how, 'centre', '(said so)');
  assertEq(p(by('Sol One')).date, '2026-01-12', 'and its quarter from the day the record was made');
  assertEq(p(by('Pip One')).fy, '2026/2027', 'an undated centre: the day the record was made');
  assertEq(p(by('Pip One')).how, 'created', '(said so)');
  assertEq(p(by('Stamp Only')).fy, '2026/2027', 'only a stamped year: that year');
  assertEq(p(by('Stamp Only')).date, '2026-09-07', 'and its quarter from its centre\'s start');
  assertEq(p(by('Old Programme')).fy, '2026/2027', 'a centre gone: its own enrolment date still places it');
  assertEq(p(by('No When')).fy, null, 'nothing says when: no year (unplaced, never guessed)');
  assertEq(Y.placeOf({ enrollmentDate: 'October 16, 2026' }, null).fy, '2026/2027', 'a date written in words is read');
  assert(Y.intakeClosed(Y.intakeOf(by('Old Programme'), null), TODAY, NOW), 'a centre record gone: the course dates stamped on the trainee say it closed');
  const reopened = Object.assign({}, area(2), { instructorPermissions: [{ expiresAtMs: NOW + 3600e3 }] });
  assert(!Y.intakeClosed(Y.intakeOf(null, reopened), TODAY, NOW), 'a centre with a reopening window is not closed (canEnrol\'s rule)');
  assertEq(E.canEnrol([area(2)], 'Electrical Installation', { today: TODAY, nowMs: NOW }).code, 'ended', '(the same centre refuses new trainees: the rule it shares)');
}

console.log('2. The present year, to date, open centres (the default)');
{
  const r = sc(null);
  assertEq(JSON.stringify(r.view), JSON.stringify({ mode: 'year', fy: '2026/2027', q: 3, closed: false }), 'the default is this financial year, closed centres left out');
  assertEq(r.roll.length, 13, '13 trainees counted');
  assertEq(r.enrolled, 10, '10 enrolled this year to date (Welding 7, Plumbing 2, the stamped one)');
  assertEq(r.carried, 3, '3 still in training from an earlier year (Solar, began January, runs to December)');
  assertEq(names(r.closedOut), 'Eli One, Eli Three, Eli Two, Old Programme', 'closed centres left out: Electrical (ended August) and the one whose record is gone');
  assertEq(names(r.later), 'Wes December', 'enrolled with a date after today: not counted yet');
  assertEq(names(r.unplaced), 'No When', 'no year at all: named, not counted');
  assertEq(r.otherYears, 6, 'Cosmetology (ended in March) and Masonry are earlier years');
  assertEq(Y.headline(r), 'FY 2026/2027 · open centres · 13 trainees', 'the bar says what is shown');
  accounted(r, 'present year');
  const c = sc({ closed: true });
  assertEq(c.roll.length, 17, 'Include closed centres: 17');
  assertEq(c.enrolled, 14, '(Electrical and the gone centre back in)');
  assertEq(c.closedOut.length, 0, 'nothing left out as closed');
  assertEq(Y.headline(c), 'FY 2026/2027 · open and closed centres · 17 trainees', 'and the bar says so');
  accounted(c, 'present year with closed centres');
  assert(r.roll.every(s => c.ids[s.id]), 'switching closed centres on only ever adds trainees');
  assertEq(JSON.stringify(sc({ mode: 'nonsense', fy: 'last year', q: 9 }).view), JSON.stringify(r.view), 'anything unreadable falls back to the present year');
}

console.log('3. Quarters, a past year, a year ahead, All Years');
{
  const q = n => sc({ mode: 'quarter', q: n });
  assertEq(q(1).roll.length, 0, 'Q1 · Apr–Jun: 0 — its intakes have closed');
  assertEq(q(1).closedOut.length, 4, '(the 4 closed ones are named)');
  assertEq(sc({ mode: 'quarter', q: 1, closed: true }).roll.length, 4, 'Q1 with closed centres: Electrical 3 and the gone centre');
  assertEq(names(q(2).roll), 'Stamp Only, Wes Five, Wes Four, Wes One, Wes Three, Wes Two', 'Q2 · Jul–Sep: enrolled in September');
  assertEq(q(2).carriedNotInQuarter, 3, 'Q2: trainees from earlier years are in the Whole Year, not a quarter (said so)');
  assertEq(names(q(3).roll), 'Pip One, Pip Two, Wes Late October, Wes October', 'Q3 · Oct–Dec: enrolled in October, to date');
  assertEq(names(q(3).later), 'Wes December', 'Q3: the December enrolment is not counted yet');
  assertEq(q(4).roll.length, 0, 'Q4 · Jan–Mar: nobody yet');
  [1, 2, 3, 4].forEach(n => accounted(q(n), 'Q' + n));
  assertEq(q(2).enrolled + q(3).enrolled + q(4).enrolled + q(1).enrolled + sc(null).carried, sc(null).roll.length, 'the quarters and the trainees carried in add up to the whole year');
  assertEq(Y.headline(q(3)), 'Q3 · Oct–Dec 2026 · open centres · 4 trainees', 'a quarter is named as School Fee names it');
  const noDate = Y.scope([{ id: 'X', name: 'Stamp No Centre', course: 'Nowhere', fiscalYear: '2026/2027', stage: 'training' }], { mode: 'quarter', q: 3 }, Object.assign({ centreOf }, at));
  assertEq(noDate.noQuarter.length, 1, 'a trainee of the year with no date inside it: named under "no quarter", not lost');

  const past = sc({ fy: '2025/2026' });
  assertEq(past.tense, 'past', 'FY 2025/2026 is a past year');
  assertEq(names(past.roll), 'Cora Four, Cora One, Cora Three, Cora Two, Mason One, Mason Two, Sol One, Sol Three, Sol Two', 'a past year: everyone in it, closed centres too');
  assertEq(past.carried, 2, '(Masonry, enrolled in 2024, still in training until June 2025)');
  assertEq(past.closedOut.length + past.later.length, 0, 'nothing left out for being closed or "after today" in a past year');
  assertEq(sc({ fy: '2025/2026', closed: false }).roll.length, sc({ fy: '2025/2026', closed: true }).roll.length, 'the closed-centre switch changes nothing in a past year');
  assertEq(Y.headline(past), 'FY 2025/2026 · every centre · 9 trainees', 'and the bar says every centre');
  accounted(past, 'past year');
  assertEq(sc({ fy: '2024/2025' }).roll.length, 2, 'FY 2024/2025: Masonry');
  const ahead = sc({ fy: '2027/2028' });
  assertEq(ahead.tense, 'future', 'FY 2027/2028 is ahead');
  assertEq(ahead.roll.length, 9, 'a year ahead: the intakes still running into it (Welding, to June 2027)');
  accounted(ahead, 'a year ahead');
  const all = sc({ mode: 'all' });
  assertEq(all.roll.length, TOTAL, 'All Years: every trainee on the roll, as the dashboard always counted');
  assertEq(Y.headline(all), 'All years · every centre · ' + TOTAL + ' trainees', 'and the bar says so');
  assertEq(JSON.stringify(roll), BEFORE, 'working all of this out changed no record');
}

console.log('4. Exams and classes follow the period and the closed-centre rule');
{
  const recOf = r => E.findCentre(AREAS, r.course, { on: r.date || '' }) || null;
  const exams = [
    { id: 'EX1', course: 'Welding & Fabrication', date: '2026-11-20', status: 'upcoming' },
    { id: 'EX2', course: 'Electrical Installation', date: '2026-06-10', status: 'completed' },
    { id: 'EX3', course: 'Cosmetology', date: '2026-02-10', status: 'completed' },
    { id: 'EX4', course: 'Plumbing', date: '', status: 'upcoming' }
  ];
  const ids = view => exams.filter(e => Y.recordIn(e, view, Object.assign({ centreOf: recOf }, at))).map(e => e.id).join(',');
  assertEq(ids(null), 'EX1,EX4', 'this year, open centres: Welding\'s, and the undated one with the present');
  assertEq(ids({ closed: true }), 'EX1,EX2,EX4', 'with closed centres: Electrical\'s June exam too');
  assertEq(ids({ fy: '2025/2026' }), 'EX3', 'last year: last year\'s');
  assertEq(ids({ mode: 'quarter', q: 1, closed: true }), 'EX2', 'a quarter: dated in it');
  assertEq(ids({ mode: 'quarter', q: 3 }), 'EX1,EX4', 'the present quarter: November\'s exam, and the undated one');
  assertEq(ids({ mode: 'quarter', q: 4 }), '', 'a later quarter: neither');
  assertEq(ids({ mode: 'all' }), 'EX1,EX2,EX3,EX4', 'All Years: all of them');
}

console.log('5. School Fees');
{
  const D = require('./fixtures/board-centre.js');
  const F = Core.centreFigures;
  const keys = ['billed', 'collected', 'owed', 'accounts', 'debtors', 'unpriced'];
  ['2026/2027', '2025/2026', '2024/2025'].forEach(fy => {
    const want = F.fees(D.feeStudents, D.payments, { fy });
    const got = Y.fees(D.feeStudents, D.payments, { fy, closed: true }, at);
    assert(keys.every(k => got[k] === want[k]) && got.earlier.owed === want.earlier.owed && got.earlier.trainees === want.earlier.trainees,
      'FY ' + fy + ', closed centres included: exactly School Fee\'s own figures (' + keys.map(k => k + ' ' + got[k]).join(', ') + ')');
  });
  // A small set of books with a closed centre in this year.
  const acc = [
    { id: 'SF-A', lmsId: 'S-EliOne', skillArea: 'Electrical Installation', enrollmentDate: '2026-04-13', tuitionFee: 20000 },
    { id: 'SF-B', lmsId: 'S-WesOne', skillArea: 'Welding & Fabrication', enrollmentDate: '2026-09-07', tuitionFee: 28000 },
    { id: 'SF-C', lmsId: 'S-CoraFour', skillArea: 'Cosmetology', enrollmentDate: '2025-09-08', tuitionFee: 30000 },
    { id: 'SF-D', skillArea: 'Plumbing', tuitionFee: 15000 }
  ];
  const pay = [
    { id: 'P1', studentId: 'SF-A', amount: 5000, date: '2026-05-01' },
    { id: 'P2', studentId: 'SF-B', amount: 10000, date: '2026-09-20' },
    { id: 'P3', studentId: 'SF-C', amount: 20000, date: '2025-10-01' },
    { id: 'P4', studentId: 'SF-GONE', skillArea: 'Electrical Installation', amount: 3000, date: '2026-06-01' }
  ];
  const closedIds = { 'SF-A': 1 };
  const opts = Object.assign({ closedOf: f => !!closedIds[f.id], paymentClosed: p => p.skillArea === 'Electrical Installation' }, at);
  const d = Y.fees(acc, pay, null, opts);
  assert(d.billed === 43000 && d.owed === 33000 && d.collected === 10000 && d.accounts === 2 && d.closedOut === 1,
    'this year, open centres: the closed centre\'s account and both its payments left out (billed ' + d.billed + ', owed ' + d.owed + ', collected ' + d.collected + ')');
  assert(d.earlier.owed === 10000 && d.earlier.trainees === 1, 'earlier years still owing stays beside it: $10,000 (1)');
  const w = Y.fees(acc, pay, { closed: true }, opts), want = F.fees(acc, pay, { fy: '2026/2027' });
  assert(w.billed === 63000 && w.owed === 48000 && w.collected === 18000 && keys.every(k => w[k] === want[k]), 'with closed centres: School Fee\'s figures ($63,000 / $18,000 / $48,000)');
  const q2 = Y.fees(acc, pay, { mode: 'quarter', q: 2 }, opts);
  assert(q2.billed === 43000 && q2.collected === 10000, 'Q2: accounts enrolled in it (the undated one belongs to every year, as on School Fee) and payments dated in it');
  const all = Y.fees(acc, pay, { mode: 'all' }, opts);
  assert(all.billed === 93000 && all.collected === 38000 && all.owed === 58000 && all.earlier === null && all.closedOut === 0, 'All Years: every account and every payment, no "earlier years" line');
  assertEq(Y.fees(acc, pay, { fy: '2025/2026' }, opts).closedOut, 0, 'a past year leaves nothing out');
}

console.log('6. The choice belongs to this screen');
{
  const mem = {};
  const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  assert(Y.write(ls, { mode: 'quarter', fy: '2026/2027', q: 3, closed: true }, TODAY), 'remembered');
  assertEq(Object.keys(mem).join(), 'cestisDashYearView', 'under one key of its own');
  assertEq(JSON.stringify(Y.read(ls, TODAY)), JSON.stringify({ mode: 'quarter', fy: '2026/2027', q: 3, closed: true }), 'and read back');
  assertEq(Y.read(ls, '2027-05-02').fy, '2027/2028', '"this year" stays this year: opened in May 2027 it shows FY 2027/2028');
  Y.write(ls, { fy: '2025/2026' }, TODAY);
  assertEq(Y.read(ls, '2027-05-02').fy, '2025/2026', 'a past year chosen on purpose stays chosen');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assertEq(Y.read(broken, TODAY).fy, '2026/2027', 'a storage that refuses: the present year, no error');
  assertEq(Y.write(broken, null, TODAY), false, 'and saving the choice fails quietly');
  mem.cestisDashYearView = 'not json';
  assertEq(Y.read(ls, TODAY).mode, 'year', 'something unreadable: the default');
  assert(Core.isSnapshotableKey('cestisDashYearView') === false, 'never in a backup');
  const PC = fs.readFileSync(path.join(__dirname, '..', 'cestis-page-cloud.js'), 'utf8');
  assert(/DEVICE_KEYS = \[[^\]]*'cestisDashYearView'/.test(PC) && /exclude: \[[\s\S]*?'cestisDashYearView'/.test(PC), 'and never in the shared copy of this screen\'s store');
}

console.log('7. The dashboard (index.html, both builds)');
function fnOf(src, name) {
  const m = new RegExp('\\n[ \\t]*function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(m.index, i + 1); } }
  throw new Error(name);
}
['index.html', 'Offline System/index.html'].forEach(file => {
  const SRC = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const w = file + ': ';
  const build = fnOf(SRC, 'buildAdminPages');
  assert(build.indexOf('id="dashYearBar" role="region" aria-label="The year the figures below count">${dashYearBarHtml()}') !== -1 &&
    build.indexOf('id="dashYearBar"') < build.indexOf('id="dashStats"') && build.indexOf('id="officeTodayCard"') < build.indexOf('id="dashYearBar"'),
    w + 'the year bar sits above the figures, below the work waiting today');
  ['dashStatsHtml', 'dashFeesCardInner', 'dashAlertsHtml', 'dashTopPerformersHtml', 'dashRecentActivityHtml', 'dashCertMonthsHtml'].forEach(f => {
    assert(build.indexOf('${' + f + '()}') !== -1, w + f + ' is drawn on the dashboard');
    assert(new RegExp("dashFill\\('[a-zA-Z]+', " + f + '\\)').test(fnOf(SRC, 'refreshAdminDashboard')), w + 'and redrawn when the year changes: ' + f);
  });
  // One answer: every block reads dashScope (or the view, for the fees and the timetable).
  assert(/var sc = dashScope\(\), roll = sc\.roll/.test(fnOf(SRC, 'dashStatsHtml')) && !/\bstudents\b/.test(fnOf(SRC, 'dashStatsHtml')), w + 'the four cards count dashScope\'s trainees, never the whole roll');
  assert(/const sc = dashScope\(\), roll = sc\.roll;/.test(fnOf(SRC, 'dashAlertsHtml')) && !/\bstudents\./.test(fnOf(SRC, 'dashAlertsHtml')), w + 'so do the alerts about trainees');
  assert(/const roll = dashRoll\(\);/.test(fnOf(SRC, 'dashTopPerformersHtml')) && !/\bstudents\b/.test(fnOf(SRC, 'dashTopPerformersHtml')), w + 'Top Performers');
  assert(/sc\.ids\[String\(r\.studentId\)\]/.test(fnOf(SRC, 'dashRecentActivityHtml')) && !/\bstudents\./.test(fnOf(SRC, 'dashRecentActivityHtml')), w + 'Recent Activity');
  assert(/const sc = dashScope\(\), roll = sc\.roll;/.test(fnOf(SRC, 'dashCertMonthsHtml')), w + 'the certificate chart');
  assert(/dashScope\(\)\.roll\.forEach/.test(fnOf(SRC, 'updatePipelineCounts')), w + 'the pipeline');
  assert(/CESTISCore\.yearView\.fees\(books\.accounts, books\.payments, view,/.test(fnOf(SRC, 'dashFeesCardInner')), w + 'School Fees, by the same view');
  assert(/CESTISCore\.yearView\.scope\(roll, v, \{ centreOf: studentCentreRecord \}\)/.test(fnOf(SRC, 'dashScope')), w + 'dashScope asks the one rule, with the dashboard\'s own centre of each trainee');
  assert(/CESTISCore\.yearView\.recordIn\(r, dashYearView\(\)/.test(fnOf(SRC, 'dashRecordInView')), w + 'exams and classes follow the same view');
  assert(/dashFill\('dashYearBar', dashYearBarHtml\)/.test(fnOf(SRC, 'refreshDashboardStudentTotals')) && /dashFill\('dashStats', dashStatsHtml\)/.test(fnOf(SRC, 'refreshDashboardStudentTotals')),
    w + 'when the roll changes, the bar\'s count and the cards change together');
  assert(/pageId === 'dashboard'[^\n]*refreshAdminDashboard\(\)/.test(fnOf(SRC, 'showPage')), w + 'and everything is redrawn whenever the dashboard is opened');
  assert(build.indexOf('onclick="exportReportCSV({ dashboard: true })"') !== -1 && /const sc = opts && opts\.dashboard \? dashScope\(\) : null;/.test(fnOf(SRC, 'exportReportCSV')) &&
    /sc \? p\.roll\.filter\(s => s && sc\.ids\[String\(s\.id\)\]\) : p\.roll/.test(fnOf(SRC, 'exportReportCSV')), w + 'the dashboard\'s Export Report counts the same trainees (the Reports page\'s own export is unchanged)');
  // Writes nothing but its own choice.
  const block = SRC.slice(SRC.indexOf('/* ============ THE DASHBOARD\'S YEAR ============'), SRC.indexOf('function renderSkills() {'));
  assert(block.length > 1000 && !/CESTISStore\.setItem|saveState\(|persist[A-Z]\w*\(|\.push\(/.test(block.replace(/items\.push|notes\.push/g, '')), w + 'the dashboard\'s year code saves nothing but its own choice');
  assert(/try \{ return window\.localStorage; \} catch \(e\) \{ return null; \}/.test(block), w + 'reading this screen\'s storage is guarded');
  // Readable text, both themes.
  const css = SRC.slice(SRC.indexOf('.dash-yearbar {'), SRC.indexOf('.dyb-card-sub'));
  const sizes = (css.match(/font-size:\s*(\d+)px/g) || []).map(s => +/(\d+)/.exec(s)[1]);
  assert(sizes.length > 5 && Math.min.apply(null, sizes) >= 12, w + 'no text on the bar below 12px (' + sizes.join(', ') + ')');
  assert(/\.dyb-tab, \.dyb-btn \{[^}]*color:var\(--text-primary\)/.test(css) && /\.dash-yearbar \{[^}]*background:var\(--bg-card\)/.test(css), w + 'the bar takes the theme\'s colours (dark and light)');
});

console.log('8. The bar, drawn by the page\'s own code');
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const block = SRC.slice(SRC.indexOf('/* ============ THE DASHBOARD\'S YEAR ============'), SRC.indexOf('function renderSkills() {'));
  // The page's own clock is pinned to 7 November 2026.
  const YAt = Object.assign({}, Y, {
    read: s => Y.read(s, TODAY), write: (s, v) => Y.write(s, v, TODAY), normalise: v => Y.normalise(v, TODAY),
    presentFY: () => Y.presentFY(TODAY), tense: fy => Y.tense(fy, TODAY), periodLabel: v => Y.periodLabel(v, TODAY),
    scope: (st, v, o) => Y.scope(st, v, Object.assign({}, o, at)), recordIn: (r, v, o) => Y.recordIn(r, v, Object.assign({}, o, at)),
    fees: (a, p, v, o) => Y.fees(a, p, v, Object.assign({}, o, at)), intakeClosed: ik => Y.intakeClosed(ik, TODAY, NOW)
  });
  const CoreAt = Object.assign({}, Core, { yearView: YAt, currentQuarter: () => Core.currentQuarter(new Date(TODAY + 'T12:00:00')) });
  const mem = {};
  const sb = {
    CESTISCore: CoreAt, students: JSON.parse(BEFORE), skillAreas: AREAS, exams: [], classSessions: [], examResults: [], Promise,
    studentCentreRecord: centreOf, console: { warn() {}, log() {} },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    document: { getElementById: () => null, activeElement: null },
    CESTISStore: { getItem: () => null, setItem: () => { throw new Error('the dashboard wrote to the store'); } }
  };
  sb.escapeAttr = sb.escapeHtml;
  sb.window = { localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } } };
  vm.createContext(sb);
  vm.runInContext(block, sb);
  const bar = () => vm.runInContext('_dashScopeMemo = null; dashYearBarHtml()', sb);
  const text = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  let h = bar();
  assert(/◀ Previous year FY 2026\/2027 Next year ▶ ✓ Whole Year Q1 · Apr–Jun Q2 · Jul–Sep Q3 · Oct–Dec Q4 · Jan–Mar All Years/.test(text(h)), 'School Fee\'s bar: the years and the tabs, Whole Year chosen');
  assert(text(h).indexOf('FY 2026/2027 · open centres · 13 trainees 10 enrolled this year to date · 3 trainees still in training from earlier years') !== -1, 'it says plainly what is shown: "' + text(h).slice(text(h).indexOf('FY 2026/2027 ·'), text(h).indexOf('Include')) + '"');
  assert(/Include closed centres \(4 trainees not counted\)/.test(text(h)) && /id="dashIncludeClosed"[^>]*onchange="dashSetClosed\(this\.checked\)"/.test(h) && !/data-dyb="closed" checked/.test(h), 'the closed-centre switch, off, saying how many it leaves out');
  assert(/1 trainee is enrolled with a date after today, so not counted yet\. Show who Wes December — Welding &amp; Fabrication \(enrolled 2026-12-01\)/.test(text(h)), 'the trainee not counted yet is named');
  assert(/1 trainee has no enrolment date, year or centre dates, so no year can be given — counted under All Years\. Show who No When — Mystery Course/.test(text(h)), 'the trainee with no year is named');
  assertEq(vm.runInContext('dashActiveLineText()', sb), '10 active (in training) · 3 applicants', 'under Total Enrolled: of the trainees shown');
  vm.runInContext('dashSetClosed(true)', sb);
  assertEq(JSON.parse(mem.cestisDashYearView).closed, true, 'ticking the switch is remembered on this screen');
  h = bar();
  assert(text(h).indexOf('FY 2026/2027 · open and closed centres · 17 trainees') !== -1 && /data-dyb="closed" checked/.test(h), 'ticked: 17 trainees, open and closed centres');
  vm.runInContext('dashSelectQuarter(2)', sb);
  h = bar();
  assert(/aria-pressed="true"[^>]*>Q2 · Jul–Sep</.test(h) && text(h).indexOf('Q2 · Jul–Sep 2026 · open and closed centres · 6 trainees') !== -1, 'Q2: 6 trainees');
  assert(/3 trainees in training from earlier years are counted under Whole Year, not a quarter\./.test(text(h)), 'and where the trainees carried in went');
  vm.runInContext('dashShiftFY(-1)', sb);
  h = bar();
  assert(/FY 2025\/2026 past/.test(text(h)) && text(h).indexOf('Q2 · Jul–Sep 2025 · every centre') !== -1, 'one year back keeps the quarter, and is marked past');
  vm.runInContext('dashSelectYear()', sb);
  h = bar();
  assert(text(h).indexOf('FY 2025/2026 · every centre · 9 trainees') !== -1 && !/dashIncludeClosed/.test(h), 'last year, whole: 9 trainees, every centre (no switch: a past year counts them all)');
  assert(/You are looking at FY 2025\/2026 , not the present year\. Every centre of that year is counted, closed ones too — by now all of them have closed\. Return to FY 2026\/2027/.test(text(h)), 'a past year says so, with the way back');
  vm.runInContext('dashSelectAll()', sb);
  h = bar();
  assert(/aria-pressed="true"[^>]*>✓ All Years</.test(h) && text(h).indexOf('All years · every centre · ' + TOTAL + ' trainees') !== -1, 'All Years: ' + TOTAL + ' trainees');
  assert(/Every year is counted together, so these figures include past groups and closed centres\. Show FY 2026\/2027 only/.test(text(h)), 'and says what that means');
  vm.runInContext('dashSelectAll()', sb);
  assertEq(vm.runInContext('dashYearView().mode', sb), 'year', 'All Years pressed again: back to one year, as on School Fee');
  vm.runInContext('dashReturnToPresent()', sb);
  assertEq(JSON.stringify(vm.runInContext('dashYearView()', sb)), JSON.stringify({ mode: 'year', fy: '2026/2027', q: 3, closed: true }), 'Return to the present year');
  assertEq(JSON.stringify(sb.students), BEFORE, 'nothing the bar did changed a record');
  // A screen that refuses its storage still draws the dashboard.
  sb.window = { get localStorage() { throw new Error('blocked'); } };
  vm.runInContext('_dashYearView = null; dashSetClosed(false);', sb);
  assert(text(bar()).indexOf('FY 2026/2027 · open centres · 13 trainees') !== -1, 'with storage refused: the present year, and the switch still works');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
