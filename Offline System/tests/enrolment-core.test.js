/* Unit tests for CESTISCore.enrolment — the single enrolment-eligibility rule
   shared by the LMS (index.html) and the School Fee dashboard (School.Fee.html).
   Run: node tests/enrolment-core.test.js */
'use strict';

const Core = require('../cestis-core.js');
const E = Core.enrolment;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const TODAY = '2026-08-02';
const areas = [
  { id: 1, name: 'Welding & Fabrication', startDate: '2025-09-01', endDate: '2026-06-30' },  // ended
  { id: 2, name: 'Beauty Therapy',        startDate: '2026-05-01', endDate: '2027-03-31' },  // active
  { id: 3, name: 'Electrical Installation', startDate: '2026-10-01', endDate: '2027-06-30' },// not started
  { id: 4, name: 'Carpentry' }                                                               // no dates
];

/* ---------- 1. Centre resolution ---------- */
console.log('Centre resolution');
assertEq(E.findCentre(areas, 'Beauty Therapy').id, 2, 'exact match');
assertEq(E.findCentre(areas, '  beauty   therapy ').id, 2, 'case/space-insensitive match');
assertEq(E.findCentre(areas, 'Welding').id, 1, 'prefix match finds "Welding & Fabrication"');
assertEq(E.findCentre(areas, 'Underwater Basket Weaving'), null, 'unknown course resolves to null');
assertEq(E.findCentre([], 'Beauty Therapy'), null, 'empty roster resolves to null');
assertEq(E.findCentre(areas, ''), null, 'empty name resolves to null');

/* ---------- 1b. The same programme written two ways ----------
   The fee side of the Centre files courses as "WELDING L2"; the LMS names the
   training centre "Welding and Fabrication Level 2". They are one programme,
   and the School Fee dashboard was reporting "no active training centre" for
   every one of them. */
console.log('Abbreviated course names resolve to their centre');
const written = [
  { id: 10, name: 'Welding and Fabrication Level 2', startDate: '2026-08-02', endDate: '2027-07-30' },
  { id: 11, name: 'Welding and Fabrication Level 3', startDate: '2026-08-02', endDate: '2027-07-30' },
  { id: 12, name: 'General Cosmetology Level 2',     startDate: '2026-08-02', endDate: '2027-07-30' },
  { id: 13, name: 'Business Administration Level 2', startDate: '2026-08-02', endDate: '2027-07-30' },
  { id: 14, name: 'Commis Chef Level 2',             startDate: '2026-08-02', endDate: '2027-07-30' },
  { id: 15, name: 'Hospitality & Tourism Level 2',   startDate: '2026-08-02', endDate: '2027-07-30' }
];
assertEq(E.findCentre(written, 'WELDING L2').id, 10, '"WELDING L2" finds the Level 2 centre');
assertEq(E.findCentre(written, 'WELDING L3').id, 11, '"WELDING L3" finds the Level 3 centre');
assertEq(E.findCentre(written, 'COSMETOLOGY L2').id, 12, 'a name the centre prefixes still resolves');
assertEq(E.findCentre(written, 'BUSINESS ADMIN L2').id, 13, 'a shortened word ("admin") resolves');
assertEq(E.findCentre(written, 'COMMI CHEF L2').id, 14, 'a misspelt shortening ("commi") resolves');
assertEq(E.findCentre(written, 'Welding Level 2').id, 10, 'the long form of the level resolves too');
assert(E.canEnrol(written, 'WELDING L2', { today: TODAY }).allowed,
  'a trainee can be enrolled into the centre the fee name belongs to');

console.log('Level is never crossed');
assertEq(E.findCentre([written[1]], 'WELDING L2'), null, 'Level 2 does not match a Level 3 centre');
assertEq(E.findCentre([written[0]], 'WELDING L3'), null, 'Level 3 does not match a Level 2 centre');
assertEq(E.findCentre(written, 'HOSPITALITY SERVICES L2'), null,
  'one word in common is not enough — Hospitality Services is not Hospitality & Tourism');
assertEq(E.findCentre(written, 'Underwater Basket Weaving L2'), null, 'an unrelated name still resolves to null');

/* ---------- 1c. A programme run again resolves to the new intake ---------- */
console.log('Repeat intakes resolve to the centre that is open');
const repeats = [
  { id: 20, name: 'Beauty Therapy Level 2', startDate: '2024-09-01', endDate: '2025-06-30' }, // last year
  { id: 21, name: 'Beauty Therapy Level 2', startDate: '2026-05-01', endDate: '2027-03-31' }, // this year
  { id: 22, name: 'Beauty Therapy Level 2', startDate: '2025-09-01', endDate: '2026-06-30' }  // finished
];
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { today: TODAY }).id, 21,
  'the open intake wins over the finished ones');
const repeat = E.canEnrol(repeats, 'Beauty Therapy Level 2', { today: TODAY });
assert(repeat.allowed, 'a re-run programme accepts new trainees instead of reporting "course ended"');
assertEq(repeat.fy, '2026/2027', 'the enrolment is grounded in the NEW intake fiscal year');
// With no open intake at all, the most recent finished one is still resolved so
// the refusal can name a real centre and its end date.
const allEnded = [repeats[0], repeats[2]];
assertEq(E.findCentre(allEnded, 'Beauty Therapy Level 2', { today: TODAY }).id, 22,
  'with none open, the latest intake is resolved');
assertEq(E.canEnrol(allEnded, 'Beauty Therapy Level 2', { today: TODAY }).code, 'ended',
  'and enrolment into it is still refused');

/* ---------- 1d. Grounding a record in the intake it belongs to ----------
   Asking "which centre does this trainee belong to" is not the same question as
   "which centre can take somebody today". A trainee who enrolled in 2024 belongs
   to the 2024 intake — resolve them to this year's open centre instead and their
   course never registers as finished, which is how trainees of an ended course
   were left sitting in the Testing stage. */
console.log('Resolving a centre as of a date');
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2024-11-01' }).id, 20,
  'a 2024 enrolment resolves to the 2024 intake');
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2025-11-01' }).id, 22,
  'a 2025 enrolment resolves to the 2025 intake');
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2026-08-02' }).id, 21,
  'a 2026 enrolment resolves to the current intake');
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2025-08-01' }).id, 20,
  'a date between intakes takes the most recent one that had already begun');
assertEq(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2020-01-01' }).id, 20,
  'a date before every intake takes the earliest');
assertEq(E.centreFiscalYear(E.findCentre(repeats, 'Beauty Therapy Level 2', { on: '2024-11-01' })), '2024/2025',
  'and it carries that intake fiscal year, not this one');
// The date form still answers with an abbreviated name.
assertEq(E.findCentre(written, 'WELDING L2', { on: '2026-09-01' }).id, 10,
  'the abbreviation still resolves when a date is given');

/* ---------- 2. The reported bug: ended centres must refuse new trainees ---------- */
console.log('Ended centres refuse enrolment');
const ended = E.canEnrol(areas, 'Welding & Fabrication', { today: TODAY });
assert(!ended.allowed, 'ended course blocks enrolment');
assertEq(ended.code, 'ended', 'code is "ended"');
assert(/create a new training centre/i.test(ended.reason), 'reason tells the user to create a new centre');
assert(ended.reason.indexOf('2026-06-30') !== -1, 'reason states the end date');

/* ---------- 3. Fail CLOSED — this is what was letting bad enrolments through ---------- */
console.log('Fail-closed behaviour');
const unknown = E.canEnrol(areas, 'Ghost Programme', { today: TODAY });
assert(!unknown.allowed, 'unknown centre is refused, not silently allowed');
assertEq(unknown.code, 'no-centre', 'code is "no-centre"');
assert(/create the training centre/i.test(unknown.reason), 'reason tells the user to create the centre first');

const noRoster = E.canEnrol([], 'Beauty Therapy', { today: TODAY });
assert(!noRoster.allowed, 'unverifiable roster is refused rather than allowed');
assertEq(noRoster.code, 'no-roster', 'code is "no-roster"');

const noCourse = E.canEnrol(areas, '', { today: TODAY });
assert(!noCourse.allowed, 'missing course is refused');
assertEq(noCourse.code, 'no-course', 'code is "no-course"');
assert(!E.canEnrol(null, 'Beauty Therapy', { today: TODAY }).allowed, 'null roster is refused');

/* ---------- 4. Valid enrolments still pass ---------- */
console.log('Valid enrolments pass');
const ok = E.canEnrol(areas, 'Beauty Therapy', { today: TODAY });
assert(ok.allowed, 'active course allows enrolment');
assertEq(ok.code, 'ok', 'code is "ok"');
assertEq(ok.status, 'active', 'status reported as active');

const future = E.canEnrol(areas, 'Electrical Installation', { today: TODAY });
assert(future.allowed, 'a not-yet-started intake accepts pre-enrolment');
assertEq(future.status, 'not-started', 'status reported as not-started');

const undated = E.canEnrol(areas, 'Carpentry', { today: TODAY });
assert(undated.allowed, 'centre with no dates does not block (dates not set yet)');
assertEq(undated.status, 'no-dates', 'status reported as no-dates');

/* ---------- 5. Instructor reopen permission overrides an ended course ---------- */
console.log('Reopen permission');
const reopened = [{ id: 9, name: 'Welding & Fabrication', startDate: '2025-09-01', endDate: '2026-06-30',
  instructorPermissions: [{ expiresAtMs: 4102444800000 }] }]; // far future
assert(E.canEnrol(reopened, 'Welding & Fabrication', { today: TODAY, nowMs: Date.parse(TODAY) }).allowed,
  'an unexpired reopen permission re-opens the register');

/* ---------- 6. Enrolment date must sit inside the course duration ---------- */
console.log('Enrolment date within course duration');
const late = E.canEnrol(areas, 'Beauty Therapy', { today: TODAY, enrolDate: '2027-06-01' });
assert(!late.allowed, 'enrolment dated after the course ends is refused');
assertEq(late.code, 'enrol-after-end', 'code is "enrol-after-end"');
assert(E.canEnrol(areas, 'Beauty Therapy', { today: TODAY, enrolDate: '2026-08-02' }).allowed,
  'enrolment inside the duration is allowed');
assert(E.canEnrol(areas, 'Beauty Therapy', { today: TODAY, enrolDate: '2027-03-31' }).allowed,
  'enrolment on the final day is allowed');
assert(E.canEnrol(areas, 'Carpentry', { today: TODAY, enrolDate: '2030-01-01' }).allowed,
  'no end date means no date ceiling');

/* ---------- 7. Fiscal year grounding (Apr–Mar) ---------- */
console.log('Fiscal year grounding');
assertEq(E.fiscalYearOf('2026-04-01'), '2026/2027', '1 Apr starts a new FY');
assertEq(E.fiscalYearOf('2026-03-31'), '2025/2026', '31 Mar is still the old FY');
assertEq(E.fiscalYearOf('2026-12-15'), '2026/2027', 'December belongs to the FY that began in April');
assertEq(E.fiscalYearOf(''), null, 'no date yields no FY');
assertEq(E.fiscalYearOf('not a date'), null, 'unparseable date yields no FY');

assertEq(E.centreFiscalYear(areas[1]), '2026/2027', 'centre FY comes from its start date');
assertEq(E.centreFiscalYear(areas[0]), '2025/2026', 'Sep 2025 intake is FY 2025/2026');
assertEq(E.centreFiscalYear({ endDate: '2026-05-01' }), '2026/2027', 'falls back to the end date');
assertEq(E.centreFiscalYear(null), null, 'no centre yields no FY');
assertEq(ok.fy, '2026/2027', 'decision carries the centre fiscal year');

/* ---------- 8. Enrolment stamp grounds the student record ---------- */
console.log('Enrolment stamp');
const stamp = E.enrolmentStamp(areas[1], '2026-08-02');
assertEq(stamp.centreId, 2, 'stamp carries the centre id');
assertEq(stamp.centreName, 'Beauty Therapy', 'stamp carries the centre name');
assertEq(stamp.courseStart, '2026-05-01', 'stamp carries the course start');
assertEq(stamp.courseEnd, '2027-03-31', 'stamp carries the course end');
assertEq(stamp.fiscalYear, '2026/2027', 'stamp carries the intake fiscal year');
assertEq(stamp.enrolmentFiscalYear, '2026/2027', 'stamp carries the enrolment fiscal year');
assertEq(E.enrolmentStamp(null, '2026-08-02'), null, 'no centre yields no stamp');
// A trainee joining in Feb of a course that began the previous April keeps the
// intake FY, while their own enrolment FY is recorded separately.
const midYear = E.enrolmentStamp({ id: 7, name: 'X', startDate: '2025-04-10', endDate: '2026-03-20' }, '2026-02-01');
assertEq(midYear.fiscalYear, '2025/2026', 'intake FY from the centre');
assertEq(midYear.enrolmentFiscalYear, '2025/2026', 'enrolment FY of a February join');

/* ---------- 9. Fiscal-year membership of existing students ---------- */
console.log('Student fiscal-year membership');
assert(E.studentInFiscalYear({ fiscalYear: '2026/2027' }, '2026/2027'), 'stamped student matches its FY');
assert(!E.studentInFiscalYear({ fiscalYear: '2025/2026' }, '2026/2027'), 'stamped student excluded from another FY');
assert(E.studentInFiscalYear({ enrollmentDate: '2026-05-02' }, '2026/2027'), 'legacy record falls back to enrollmentDate');
assert(E.studentInFiscalYear({ createdAt: '2026-05-02' }, '2026/2027'), 'legacy record falls back to createdAt');
assert(!E.studentInFiscalYear({}, '2026/2027'), 'undated record belongs to no FY');
assert(!E.studentInFiscalYear(null, '2026/2027'), 'null student is not in any FY');

/* ---------- 10. openCentres drives the dropdowns ---------- */
console.log('Open centres for dropdowns');
const open = E.openCentres(areas, TODAY).map(c => c.name);
assert(open.indexOf('Welding & Fabrication') === -1, 'ended centre is not offered');
assert(open.indexOf('Beauty Therapy') !== -1, 'active centre is offered');
assert(open.indexOf('Electrical Installation') !== -1, 'future intake is offered');
assert(open.indexOf('Carpentry') !== -1, 'undated centre is offered');
assertEq(open.length, 3, 'exactly the three enrollable centres');
assertEq(E.openCentres([], TODAY).length, 0, 'empty roster offers nothing');
assertEq(E.openCentres(null, TODAY).length, 0, 'null roster offers nothing');


/* ---------- 6. Every intake has a key of its own ----------
   A programme the Centre runs again has a second training centre with the same
   name. Matching on the name alone swept the first intake's trainees into it
   the moment it was created. Each centre now carries a key — '01', '02', … —
   and its full name is written with the key in front, so an intake is a thing
   in its own right and a trainee stays with the one they enrolled in. */
console.log('Every intake has a key of its own');

const twice = [
  { id: 1, name: 'Welding and Fabrication', startDate: '2024-09-01', endDate: '2025-06-30' }, // last year
  { id: 2, name: 'Welding and Fabrication', startDate: '2026-01-01', endDate: '2027-06-30' }  // this year
];
E.assignCentreKeys(twice);
assertEq(twice[0].centreKey, '01', 'the first intake is 01');
assertEq(twice[1].centreKey, '02', 'the second is 02');
assertEq(E.centreLabel(twice[0]), '01. Welding and Fabrication', 'and reads with its key in front');
assertEq(E.centreLabel(twice[1]), '02. Welding and Fabrication', 'as does the next one');

console.log('A keyed name resolves to that intake and no other');

assertEq(E.findCentre(twice, '01. Welding and Fabrication').id, 1, 'the first intake');
assertEq(E.findCentre(twice, '02. Welding and Fabrication').id, 2, 'the second intake');
assertEq(E.findCentre(twice, '01. Welding and Fabrication', { nowMs: Date.parse('2026-08-02') }).id, 1,
  'the ended intake is still itself — it is never swapped for the open one');
assertEq(E.findCentre(twice, '03. Welding and Fabrication'), null,
  'an intake that is not here resolves to nothing, never to a like-named one');
assertEq(E.findCentre([twice[1]], '01. Welding and Fabrication'), null,
  'and the surviving intake does not answer for the missing one');

console.log('A trainee is stamped with the intake they enrolled in');

const intakeStamp = E.enrolmentStamp(twice[0], '2024-10-01');
assertEq(intakeStamp.centreKey, '01', 'the key is stamped on the trainee');
assertEq(intakeStamp.centreLabel, '01. Welding and Fabrication', 'along with the name they read');
assertEq(intakeStamp.centreId, 1, 'and the centre id');

console.log('Enrolling names the intake, not just the programme');

assertEq(E.canEnrol(twice, '02. Welding and Fabrication', { today: '2026-08-02' }).allowed, true,
  'the open intake takes trainees');
const endedDec = E.canEnrol(twice, '01. Welding and Fabrication', { today: '2026-08-02' });
assertEq(endedDec.allowed, false, 'the finished intake does not');
assertEq(endedDec.code, 'ended', 'and says so — it is not silently redirected to the new one');

console.log('Naming the programme without a key still works as it did');

assertEq(E.findCentre(twice, 'Welding and Fabrication', { today: '2026-08-02' }).id, 2,
  'an unkeyed name still prefers the intake that can take trainees');
assertEq(E.findCentre(twice, 'WELDING L2', { today: '2026-08-02' }).id, 2,
  'and so does the fee side\'s way of writing it');

console.log('Keys are given out once and never taken from a centre that has one');

const mixed = [
  { id: 7, name: 'Plumbing', centreKey: '05' },
  { id: 8, name: 'Masonry' },
  { id: 5, name: 'Tiling' }
];
assertEq(E.assignCentreKeys(mixed), 2, 'only the two without a key are stamped');
assertEq(mixed[0].centreKey, '05', 'an existing key is never reassigned');
assertEq(mixed[1].centreKey, '08', 'a centre takes the key its id gives it');
assertEq(mixed[2].centreKey, '01', 'unless that key is taken, and then the first free one');
assertEq(E.assignCentreKeys(mixed), 0, 'running it again stamps nothing');
assertEq(E.assignCentreKeys(null), 0, 'null-safe');

// A key is always a number the Centre can read as a count, even where the
// centre's id is a generated string.
const strIds = [{ id: 'c1', name: 'Plumbing' }, { id: 'c2', name: 'Plumbing' }];
E.assignCentreKeys(strIds);
assertEq(strIds[0].centreKey, '01', 'a string id yields the first free number');
assertEq(strIds[1].centreKey, '02', 'and the next one after it');
assertEq(E.centreLabel(strIds[1]), '02. Plumbing', 'read as a count, never "c2."');
assertEq(E.findCentre(strIds, '01. Plumbing').id, 'c1', 'and the key still names one intake only');

console.log('Reading a written name apart');

assertEq(E.parseCentreLabel('02. Welding and Fabrication').key, '02', 'the key');
assertEq(E.parseCentreLabel('02. Welding and Fabrication').name, 'Welding and Fabrication', 'and the name');
assertEq(E.parseCentreLabel('2 Day Induction').key, '', 'a name that merely starts with a number is left alone');
assertEq(E.parseCentreLabel('2 Day Induction').name, '2 Day Induction', 'and kept whole');
assertEq(E.centreLabel({ name: '01. Welding', centreKey: '01' }), '01. Welding', 'a label is never double-prefixed');
assertEq(E.centreLabel(null), '', 'null-safe');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
