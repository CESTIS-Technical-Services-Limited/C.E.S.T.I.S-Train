/* Reports & Analytics: every panel counts the same roll, and each one draws.

   Reported: "Reports page is not consistent." It read 329 trainees in the Student
   Stage Distribution while the Dashboard read 220 — from the same array — the
   stage donut showed a bare number with no ring, the gender split came to
   43% + 46% = 89%, Attendance Rate read 0% for the whole Centre, and the
   programme panels listed "Electrical In…" twice and "Beauty T" twice, rows a
   reader cannot tell apart.

   Five separate faults:

     1. STALE. All seven panels ran once at the tail of buildAdminPages() and
        appeared on no refresh list, so Reports showed the roll as it stood when
        the app opened. The Dashboard has refreshDashboardStudentTotals() and
        stayed current — hence 329 against 220.
     2. THE DONUT DID NOT DRAW. 'nyc' is in `stages` but had no entry in the
        donut's colour map, so its slice was the string "undefined". One invalid
        colour voids the whole conic-gradient, and nyc is the Centre's largest
        stage (213 of 329) — no ring at all.
     3. THE GENDER SHARES DID NOT ADD UP. Trainees with no gender recorded were
        counted in the denominator and then left off the chart.
     4. THREE PANELS, THREE PROGRAMME LISTS. Pass rates walked the live centres;
        Enrollment by Course and the Heatmap walked the whole catalogue (~18 empty
        bars) and resolved names back to centres, which cannot tell two intakes
        apart. The heatmap matched attendance with `record.course === name`, so a
        record written under another spelling of the programme read as absence.
     5. NaN. One trainee with no attendance recorded made the average NaN, and
        the Attendance Rate card showed 0% for the entire Centre.

   Run: node tests/reports-analytics.test.js */
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

/* Both builds are checked. index.html and the Offline System's copy of it are
   separate files that drift, and the offline build is what the Centre runs on
   site. Pass a path to check just one. */
const PAGES = process.argv[2]
  ? [process.argv[2]]
  : [path.join(__dirname, '..', 'index.html'),
     path.join(__dirname, '..', 'Offline System', 'index.html')];
let SRC = '', PAGE = '';

/* Lift a top-level function out of the page and run it for real. */
function extractFunction(name) {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error(PAGE + ' no longer defines ' + name);
  let depth = 0, i = SRC.indexOf('{', at);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(at, i + 1);
}

const PANELS = ['reportProgrammeRolls', 'renderPassRates', 'renderEnrollmentBars',
  'renderDonutChart', 'renderGenderDist', 'renderReportStats', 'renderAttendanceHeatmap'];

const STAGES = ['testing', 'interview', 'training', 'certified', 'collected', 'nyc', 'incomplete'];

function makePage(opts) {
  opts = opts || {};
  const students = opts.students || [];
  const skillAreas = opts.skillAreas ||
    [...new Set(students.map(s => s.course).filter(Boolean))].map((n, i) => ({ id: i + 1, name: n }));
  try { Core.enrolment.assignCentreKeys(skillAreas); } catch (e) {}
  const els = {};
  const sandbox = {
    students: students,
    skillAreas: skillAreas,
    attendanceRecords: opts.attendance || [],
    courses: [...new Set(students.map(s => s.course).filter(Boolean))],
    stages: STAGES,
    stageLabels: { testing: 'Testing', interview: 'Interview', training: 'In Training',
      certified: 'Certified', collected: 'Collected', nyc: 'Not Yet Competent', incomplete: 'Incomplete' },
    CESTISCore: Core,
    CESTISStore: { getItem: () => null, setItem: () => {} },
    isStudentPassed: s => !!(s && (s.stage === 'certified' || s.stage === 'collected')),
    escapeHtml: s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    centreRollTally: () => Core.transfer.tally(students, skillAreas,
      { field: 'course', centres: skillAreas, nowMs: Date.parse('2026-08-04T00:00:00Z') }),
    backfillCertificateNumbers: () => false,
    document: { getElementById: id => (els[id] = els[id] || { id, innerHTML: '' }) },
    console: { log() {}, warn() {} },
    Date, Object, Array, String, Map, Set, Math, JSON, parseFloat, isNaN
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PANELS.map(extractFunction).join('\n\n'), sandbox);
  sandbox._html = id => (els[id] ? els[id].innerHTML : '');
  return sandbox;
}

/* The Centre's roll as its own export holds it: ten training centres, two of
   them near-namesakes of two others ('Cosmetology' beside 'COSMETOLOGY L2',
   'Welding' beside 'WELDING L2' and 'Welding & Fabrication'). */
const PROGRAMMES = [
  ['COSMETOLOGY L2', 81], ['Electrical Installation', 53], ['Welding & Fabrication', 31],
  ['Photovoltaic Installer', 26], ['WELDING L2', 9], ['HOSPITALITY SERVICES L2', 8],
  ['BEAUTY THERAPY L2', 7], ['Cosmetology', 2], ['Welding', 2], ['COMMI CHEF L2', 1]
];
function buildRoll() {
  const out = [];
  let n = 0;
  PROGRAMMES.forEach(([course, count]) => {
    for (let i = 0; i < count; i++) {
      n++;
      out.push({ id: 'STU' + n, name: 'Trainee ' + n, course: course,
        stage: n % 11 === 0 ? 'certified' : 'nyc', progress: 5,
        // Most records carry no attendance at all, exactly as the export shows.
        attendance: n % 7 === 0 ? 55 : undefined,
        gender: n % 3 === 0 ? 'Male' : (n % 3 === 1 ? 'Female' : '') });
    }
  });
  return out;
}
function runFor(pageFile) {
  SRC = fs.readFileSync(pageFile, 'utf8');
  PAGE = path.relative(path.join(__dirname, '..'), pageFile);
  console.log('\n=== ' + PAGE + ' ===');
  const ROLL = buildRoll();
  assertEq(ROLL.length, 220, 'the fixture is the Centre\'s roll size');

  /* ---------- 1. Every panel counts the same roll ---------- */
  console.log('Every panel counts the same trainees, and they add up to the roll');

  let page = makePage({ students: ROLL });
  const progs = page.reportProgrammeRolls();
  assertEq(progs.reduce((t, p) => t + p.roll.length, 0), ROLL.length,
    'the programme rolls together account for every trainee');
  assertEq(progs.length, PROGRAMMES.length, 'one row per training centre that has trainees');

  console.log('The stage donut counts the roll, not a snapshot of it');
  page.renderDonutChart();
  const donut = page._html('donutChartContainer');
  assert(donut.indexOf('>' + ROLL.length + '<') !== -1,
    'the figure in the donut is the roll — it read 329 against the Dashboard\'s 220');

  console.log('Pass rates and enrolment bars draw the same programmes');
  page.renderPassRates();
  page.renderEnrollmentBars();
  const rateRows = (page._html('passRateChart').match(/progress-bar/g) || []).length;
  const barCols = (page._html('enrollmentBarChart').match(/bar-col/g) || []).length;
  assertEq(rateRows, progs.length, 'a pass-rate row per programme');
  assertEq(barCols, progs.length, 'and a bar per programme — the bars used to draw the whole catalogue');
  assertEq(rateRows, barCols, 'so the two panels cannot disagree about what exists');

  console.log('A programme with nobody on it is not drawn as an empty bar');
  page = makePage({
    students: [{ id: 'A', name: 'A', course: 'WELDING L2', stage: 'nyc' }],
    skillAreas: [{ id: 1, name: 'WELDING L2' }, { id: 2, name: 'COSMETOLOGY L2' },
      { id: 3, name: 'Carpentry' }, { id: 4, name: 'Masonry' }]
  });
  assertEq(page.reportProgrammeRolls().length, 1, 'only the programme that has a trainee');

  /* ---------- 2. Rows a reader can tell apart ---------- */
  console.log('\nNo two programmes are listed identically');

  page = makePage({ students: ROLL });
  [0, 8, 12, 28].forEach(function (maxLabel) {
    const rows = page.reportProgrammeRolls(maxLabel ? { maxLabel: maxLabel } : undefined);
    const labels = rows.map(r => r.label);
    assertEq(new Set(labels).size, labels.length,
      'labels stay unique at maxLabel ' + (maxLabel || 'none') + ' — truncation used to render ' +
      '"Electrical In…" twice and "Beauty T" twice');
  });

  console.log('Two intakes of ONE programme are told apart by their intake key');
  page = makePage({
    students: [
      { id: 'A', name: 'A', course: '01. Welding & Fabrication', stage: 'nyc' },
      { id: 'B', name: 'B', course: '02. Welding & Fabrication', stage: 'nyc' }
    ],
    skillAreas: [{ id: 1, name: '01. Welding & Fabrication', centreKey: '01' },
      { id: 2, name: '02. Welding & Fabrication', centreKey: '02' }]
  });
  let rows = page.reportProgrammeRolls({ maxLabel: 28 });
  assertEq(rows.length, 2, 'both intakes are listed');
  assertEq(new Set(rows.map(r => r.label)).size, 2, 'and they do not read the same');
  assert(rows.every(r => /0[12]/.test(r.label)), 'the intake key is what distinguishes them');

  console.log('A single programme keeps its plain name — the key is only added when needed');
  page = makePage({ students: [{ id: 'A', name: 'A', course: 'COSMETOLOGY L2', stage: 'nyc' }] });
  rows = page.reportProgrammeRolls({ maxLabel: 28 });
  assertEq(rows[0].label, 'COSMETOLOGY L2', 'no key clutter when nothing collides');
  assert(rows[0].full.indexOf('COSMETOLOGY L2') !== -1, 'the full label is still available for the tooltip');

  /* ---------- 3. The donut actually draws ---------- */
  console.log('\nThe stage donut renders a ring, for every stage the roll can hold');

  page = makePage({ students: ROLL });
  page.renderDonutChart();
  const ring = page._html('donutChartContainer');
  assert(ring.indexOf('undefined') === -1,
    'no stage renders as "undefined" — one invalid colour voids the whole conic-gradient');
  assert(ring.indexOf('conic-gradient') !== -1, 'a gradient is emitted');

  console.log('Including "Not Yet Competent", which is the Centre\'s largest stage');
  const nyc = ROLL.filter(s => s.stage === 'nyc').length;
  assert(nyc > ROLL.length / 2, 'the fixture really is mostly nyc (' + nyc + ' of ' + ROLL.length + ')');
  assert(ring.indexOf('Not Yet Competent: ' + nyc) !== -1, 'and it is counted in the legend');

  console.log('Every stage in `stages` has a colour of its own');
  const colourBlock = SRC.slice(SRC.indexOf('const colors = {testing:'), SRC.indexOf('const uncoloured'));
  STAGES.forEach(function (st) {
    assert(new RegExp('\\b' + st + ':').test(colourBlock), st + ' has a donut colour');
  });
  const used = STAGES.map(st => (colourBlock.match(new RegExp(st + ":\\s*'([^']+)'")) || [])[1]);
  assert(used.every(Boolean), 'every colour resolves to a value');
  assertEq(new Set(used).size, used.length, 'and no two stages share one, so slices stay distinguishable');

  /* ---------- 4. The gender shares add to 100 ---------- */
  console.log('\nThe gender shares always total 100%');

  function genderPcts(male, female, blank) {
    const roll = [];
    for (let i = 0; i < male; i++) roll.push({ id: 'm' + i, gender: 'Male' });
    for (let i = 0; i < female; i++) roll.push({ id: 'f' + i, gender: 'female' });
    for (let i = 0; i < blank; i++) roll.push({ id: 'b' + i });
    const p = makePage({ students: roll });
    p.renderGenderDist();
    const html = p._html('genderDistContainer');
    return { pcts: [...html.matchAll(/serif;">(\d+)%/g)].map(m => +m[1]), html: html };
  }

  // The reported shape: 43% + 46% = 89%, with 11% counted and never drawn.
  let g = genderPcts(95, 101, 24);
  assertEq(g.pcts.reduce((a, b) => a + b, 0), 100, 'the reported 43/46 split now accounts for the rest');
  assertEq(g.pcts.length, 3, 'the unrecorded share is shown rather than dropped');
  assert(g.html.indexOf('Not recorded') !== -1, 'and it is named, so it is not read as a third gender');
  assert(g.html.indexOf('24 of 220') !== -1, 'with the count it came from');

  console.log('A fully recorded roll is still just the two figures');
  g = genderPcts(120, 100, 0);
  assertEq(g.pcts.length, 2, 'nothing is invented when there is nothing missing');
  assertEq(g.pcts.reduce((a, b) => a + b, 0), 100, 'and they still total 100');

  console.log('Rounding never loses or invents a percent');
  [[1, 1, 1], [2, 3, 5], [7, 7, 7], [1, 0, 2], [0, 1, 99], [33, 33, 34]].forEach(function (t) {
    const r = genderPcts(t[0], t[1], t[2]);
    assertEq(r.pcts.reduce((a, b) => a + b, 0), 100,
      'shares total 100 for ' + t.join('/') + ' (got ' + r.pcts.join('+') + ')');
  });

  console.log('A roll with no gender recorded anywhere says so, rather than drawing zeros');
  g = genderPcts(0, 0, 50);
  assertEq(g.pcts.length, 0, 'no percentages are drawn');
  assert(g.html.indexOf('not available') !== -1, 'it explains why instead');

  /* ---------- 5. Averages survive a blank field ---------- */
  console.log('\nOne unrecorded field does not zero a whole statistic');

  page = makePage({ students: ROLL });
  page.renderReportStats();
  const stats = page._html('reportStats');
  assert(stats.indexOf('NaN') === -1, 'no card reads NaN');
  const attendance = +(stats.match(/data-count="([^"]*)"[^>]*>0<\/div><div class="stat-label">Attendance Rate/) || [])[1];
  const recorded = ROLL.filter(s => typeof s.attendance === 'number');
  assert(recorded.length > 0 && recorded.length < ROLL.length,
    'the fixture mixes recorded and unrecorded attendance, as the export does');
  const want = Math.round(ROLL.reduce((a, s) => a + (parseFloat(s.attendance) || 0), 0) / ROLL.length);
  assertEq(attendance, want,
    'the average counts the attendance that IS recorded — adding an undefined made it ' +
    'NaN, and the card then read 0% for the whole Centre');
  assert(attendance > 0, 'so a Centre with some attendance recorded no longer reads 0%');

  console.log('An empty roll is answered, not divided by zero');
  page = makePage({ students: [] });
  page.renderReportStats();
  assert(page._html('reportStats').indexOf('NaN') === -1, 'still no NaN');
  page.renderDonutChart();
  assert(page._html('donutChartContainer').indexOf('undefined') === -1, 'and the donut still emits a valid gradient');

  /* ---------- 6. Attendance reaches its programme ---------- */
  console.log('\nAttendance reaches its programme however the record spells it');

  // The two sides spell one programme differently, which is the norm here: the
  // roll says 'Welding & Fabrication', the attendance record says 'WELDING L2'.
  page = makePage({
    students: [{ id: 'S1', name: 'One', course: 'Welding & Fabrication', stage: 'nyc' }],
    skillAreas: [{ id: 1, name: 'Welding & Fabrication' }],
    attendance: [{ studentId: 'S1', studentName: 'One', course: 'WELDING L2',
      days: { Mon: 'present', Tue: 'present', Wed: 'present', Thu: 'present', Fri: 'present' } }]
  });
  page.renderAttendanceHeatmap();
  let heat = page._html('attendanceHeatmap');
  assert(heat.indexOf('heat-4') !== -1,
    'a full week present reads as full attendance — matching on the programme STRING ' +
    'missed the record entirely and drew the row as absence');
  assert(heat.indexOf('no attendance recorded') === -1, 'and the row is not reported as unrecorded');

  console.log('No attendance taken is not the same as nobody attending');
  page = makePage({
    students: [{ id: 'S1', name: 'One', course: 'WELDING L2', stage: 'nyc' }],
    skillAreas: [{ id: 1, name: 'WELDING L2' }],
    attendance: []
  });
  page.renderAttendanceHeatmap();
  heat = page._html('attendanceHeatmap');
  assert(heat.indexOf('no attendance recorded') !== -1, 'it says nothing was recorded');
  assert(heat.indexOf('heat-absent') === -1, 'rather than colouring the row as absence');

  console.log('A record missing its day map is skipped, not thrown at');
  page = makePage({
    students: [{ id: 'S1', name: 'One', course: 'WELDING L2', stage: 'nyc' }],
    skillAreas: [{ id: 1, name: 'WELDING L2' }],
    attendance: [{ studentId: 'S1' }, { studentId: 'S1', days: null },
      { studentId: 'nobody', days: { Mon: 'present' } }]
  });
  let threw = false;
  try { page.renderAttendanceHeatmap(); } catch (e) { threw = true; }
  assertEq(threw, false, 'a malformed record does not blank the panel');

  /* ---------- 7. Reports is on the refresh path ---------- */
  console.log('\nReports is redrawn when the roll changes, and on opening the page');

  assert(/function refreshReportsAnalytics\(\)/.test(SRC),
    'there is one function that redraws every panel');
  const refreshList = SRC.slice(SRC.indexOf('function refreshStudentDependentViews()'),
    SRC.indexOf('function refreshContentDependentViews()'));
  assert(refreshList.indexOf("'refreshReportsAnalytics'") !== -1,
    'and it is on the list that runs whenever the roll changes — none of the panels ' +
    'was, which is why Reports froze at whatever the roll was when the page was built');
  assert(/pageId === 'reports'[\s\S]{0,120}refreshReportsAnalytics/.test(SRC),
    'and Reports is redrawn on the way in');

  const body = SRC.slice(SRC.indexOf('function refreshReportsAnalytics()'),
    SRC.indexOf('function renderReportStats()'));
  ['renderReportStats', 'renderDonutChart', 'renderPassRates', 'renderEnrollmentBars',
   'renderGaugeChart', 'renderAttendanceHeatmap', 'renderGenderDist'].forEach(function (fn) {
    assert(body.indexOf(fn) !== -1, fn + ' is refreshed');
  });

}

PAGES.forEach(runFor);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
