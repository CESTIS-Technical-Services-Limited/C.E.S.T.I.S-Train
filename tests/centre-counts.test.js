/* Every screen must agree about which training centre holds a trainee.

   They did not. The Training Centres cards worked it out from the programme
   NAME written on a trainee, resolved as of today. Everything else — the
   Transfer Trainees page, the enrolment registers — works it out from the
   centre STAMPED on them (centreKey / centreId), which is what a transfer
   writes.

   The moment those two disagreed, the screens disagreed. A trainee moved back
   into a finished intake keeps that intake's stamp, but the name-based rule
   handed them to whichever intake of the same programme was running NOW. So:

     - "Electrical Installation Level 2", a centre nobody had ever enrolled
       into, displayed a roll of 53 trainees on its card while the Transfer page
       correctly reported "no trainees are held by this training centre";
     - "02. Electrical Installation", which actually held 105, reported 52.

     52 + 53 = 105. The cards were splitting one centre's roll across two.

   CESTISCore.transfer.tally() now answers that question for every screen, with
   the same identity-first rule belongsTo() uses. These tests pin the reported
   numbers and then check the two can never drift apart again.

   Run: node tests/centre-counts.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* The two Electrical intakes exactly as they appear on the Training Centres
   page: the first has ended, the second is running now. */
const CENTRES = [
  { id: 2,  centreKey: '02', name: 'Electrical Installation',
    startDate: '2025-08-04', endDate: '2026-07-31' },
  { id: 23, centreKey: '23', name: 'Electrical Installation Level 2',
    startDate: '2026-08-02', endDate: '2027-07-30' }
];
const OPTS = { field: 'course', centres: CENTRES, nowMs: Date.parse('2026-08-03T12:00:00Z') };

/* The rule the cards used to apply, kept so the fix can be shown to change it. */
function oldCardCount(sk, list) {
  const skNameLower = sk.name.toLowerCase().trim();
  return list.filter(s => {
    if (!s || !s.course) return false;
    if (s.course.toLowerCase().trim() === skNameLower) return true;
    const found = Core.enrolment.findCentre(CENTRES, s.course, { nowMs: OPTS.nowMs });
    return !!found && found.id === sk.id;
  }).length;
}

/* ---------- 1. The reported situation ---------- */
console.log('A trainee moved back into the finished intake is counted there, once');

// 105 trainees stamped to intake 02. Of those, 53 still carry the Level 2
// programme name from before they were moved back — which is what split them.
const ROLL = [];
for (let i = 0; i < 52; i++) {
  ROLL.push({ id: 'S' + i, name: 'Trainee ' + i, course: '02. Electrical Installation',
              centreKey: '02', centreId: 2, enrolmentDate: '2025-09-10' });
}
for (let i = 52; i < 105; i++) {
  ROLL.push({ id: 'S' + i, name: 'Trainee ' + i, course: 'Electrical Installation Level 2',
              centreKey: '02', centreId: 2, enrolmentDate: '2025-09-10' });
}

const before = { ended: oldCardCount(CENTRES[0], ROLL), level2: oldCardCount(CENTRES[1], ROLL) };
console.log('  the old card rule gave: ' + before.ended + ' and ' + before.level2);
assertEq(before.ended, 52, 'the ended intake under-reported, exactly as screenshotted');
assertEq(before.level2, 53, 'and the new centre claimed trainees it did not have');
assertEq(before.ended + before.level2, ROLL.length, 'one roll split across two centres');

const t = Core.transfer.tally(ROLL, CENTRES, OPTS);
assertEq(t.of(CENTRES[0]), 105, 'now the intake that holds them reports all 105');
assertEq(t.of(CENTRES[1]), 0,
  'and the centre nobody enrolled into reports none — matching its Transfer page');

console.log('The card and the Transfer page now give the same number');
CENTRES.forEach(c => {
  assertEq(t.of(c), Core.transfer.traineesOf(ROLL, c, OPTS).length,
    c.name + ': the count and the roll agree');
});

console.log('And the roll it lists is the roll it counted');
CENTRES.forEach(c => {
  assertEq(t.listOf(c).length, t.of(c), c.name + ': listOf and of agree');
  const viaFilter = Core.transfer.traineesOf(ROLL, c, OPTS);
  assertEq(t.listOf(c).length, viaFilter.length, c.name + ': same records as the filter');
  assert(t.listOf(c).every((r, i) => r === viaFilter[i]),
    c.name + ': the identical record objects, in the same order');
});

/* ---------- 2. Unstamped trainees still resolve by when they enrolled ---------- */
console.log('A trainee with no stamp is placed by the intake that was running when they enrolled');

const UNSTAMPED = [
  { id: 'A', name: 'Enrolled in the first intake',  course: 'Electrical Installation', enrolmentDate: '2025-09-10' },
  { id: 'B', name: 'Enrolled in the second intake', course: 'Electrical Installation Level 2', enrolmentDate: '2026-09-10' }
];
const u = Core.transfer.tally(UNSTAMPED, CENTRES, OPTS);
assertEq(u.of(CENTRES[0]), 1, 'the 2025 enrolment belongs to the intake that covered 2025');
assertEq(u.of(CENTRES[1]), 1, 'and the 2026 one to the intake running then');

console.log('Two intakes of one programme never claim each other\'s trainees');
const REPEAT = [
  { id: 1, centreKey: '01', name: 'Welding & Fabrication', startDate: '2025-08-04', endDate: '2026-07-31' },
  { id: 9, centreKey: '09', name: 'Welding & Fabrication', startDate: '2026-08-02', endDate: '2027-07-30' }
];
const rOpts = { field: 'course', centres: REPEAT, nowMs: OPTS.nowMs };
const REPEAT_ROLL = [
  { id: 'W1', name: 'Last year', course: 'Welding & Fabrication', centreKey: '01' },
  { id: 'W2', name: 'This year', course: 'Welding & Fabrication', centreKey: '09' },
  { id: 'W3', name: 'This year too', course: 'Welding & Fabrication', centreKey: '09' }
];
const rt = Core.transfer.tally(REPEAT_ROLL, REPEAT, rOpts);
assertEq(rt.of(REPEAT[0]), 1, 'last year\'s intake keeps its one trainee');
assertEq(rt.of(REPEAT[1]), 2, 'and this year\'s keeps its two, though the names are identical');

/* ---------- 3. tally() and belongsTo() can never drift ---------- */
console.log('Over a roll built to collide, the count matches the filter record for record');

function buildRoll(n) {
  const names = ['Electrical Installation', 'Electrical Installation Level 2',
                 '02. Electrical Installation', '23. Electrical Installation Level 2',
                 'ELECTRICAL INSTALLATION', 'Something Else Entirely', ''];
  const dates = ['2025-09-10', '2026-09-10', '', '2024-01-01'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = { id: 'R' + i, name: 'Trainee ' + i, course: names[i % names.length],
                enrolmentDate: dates[i % dates.length] };
    if (i % 4 === 0) r.centreKey = (i % 8 === 0) ? '02' : '23';
    if (i % 5 === 0) r.centreId = (i % 10 === 0) ? 2 : 23;
    if (i % 11 === 0) r.centreId = 999;              // a centre that is not here
    if (i % 13 === 0) r.centreKey = '';              // a blank stamp
    out.push(i % 17 === 0 ? null : r);
  }
  return out;
}

const FUZZ = buildRoll(400);
let drift = 0, counted = 0;
CENTRES.forEach(c => {
  const viaFilter = Core.transfer.traineesOf(FUZZ, c, OPTS);
  const viaTally = Core.transfer.tally(FUZZ, CENTRES, OPTS);
  if (viaTally.of(c) !== viaFilter.length) drift++;
  const listed = viaTally.listOf(c);
  if (listed.length !== viaFilter.length) drift++;
  else if (!listed.every((r, i) => r === viaFilter[i])) drift++;
  counted += viaFilter.length;
});
assertEq(drift, 0, 'the two agree on every centre — one rule, not two');
assert(counted > 100, 'over a roll with real matches (' + counted + ') — not a vacuous check');

console.log('A trainee is never counted by two centres at once');
const fz = Core.transfer.tally(FUZZ, CENTRES, OPTS);
const total = CENTRES.reduce((a, c) => a + fz.of(c), 0);
const anyCentre = FUZZ.filter(r => r && CENTRES.some(c => Core.transfer.belongsTo(r, c, OPTS))).length;
assertEq(total, anyCentre, 'the parts add up to the whole, with nobody double-counted');

console.log('A trainee whose stamp names no existing centre is counted by none');
const orphan = [{ id: 'X', name: 'Orphan', course: 'Electrical Installation', centreId: 999 }];
const ot = Core.transfer.tally(orphan, CENTRES, OPTS);
assertEq(ot.of(CENTRES[0]) + ot.of(CENTRES[1]), 0,
  'rather than being quietly handed to whichever centre the name resembles');
assertEq(Core.transfer.traineesOf(orphan, CENTRES[0], OPTS).length, 0, 'the filter says the same');

/* ---------- 4. Nothing to count ---------- */
console.log('An empty or malformed roll is answered, not thrown at');
assertEq(Core.transfer.tally([], CENTRES, OPTS).of(CENTRES[0]), 0, 'an empty roll');
assertEq(Core.transfer.tally(null, CENTRES, OPTS).of(CENTRES[0]), 0, 'no roll at all');
assertEq(Core.transfer.tally([null, {}, { course: '' }], CENTRES, OPTS).of(CENTRES[0]), 0,
  'rubbish entries are skipped');

console.log('A stamped trainee is placed by their stamp even with no roster to consult');
assertEq(Core.transfer.tally(ROLL, null, OPTS).of(CENTRES[0]), 105,
  'the stamp says intake 02 and that is answer enough — the roster is only needed ' +
  'to resolve an UNSTAMPED name or a centreId');
assertEq(Core.transfer.traineesOf(ROLL, CENTRES[0], { field: 'course', centres: null }).length, 105,
  'and the filter agrees, as it must');
assertEq(Core.transfer.tally(UNSTAMPED, null, OPTS).of(CENTRES[0]), 0,
  'whereas an unstamped trainee cannot be placed without one');
assertEq(Core.transfer.tally(ROLL, CENTRES, OPTS).listOf(null).length, 0, 'and no centre asked for');

/* ---------- 5. A past intake is not this intake ----------

   The reported fault: the Training Centres cards read three times the trainees
   actually enrolled. A programme the Centre has run several times leaves the
   earlier trainees carrying its NAME and no intake key — keys came later — so
   asked which centre "Welding & Fabrication" is, there is only the intake
   running now to answer with, and every past intake piled onto its card. */
console.log('\nA trainee from a past intake is not counted in the one running now');
const ONE_INTAKE = [{ id: 9, centreKey: '09', name: 'Welding & Fabrication',
                      startDate: '2025-08-04', endDate: '2026-07-31' }];
const OPT1 = { field: 'course', centres: ONE_INTAKE };
const MIXED = [
  { id: 'CUR', name: 'Current', course: 'Welding & Fabrication', centreKey: '09', enrolmentDate: '2025-09-10' },
  { id: 'OLD1', name: 'Two years ago', course: 'Welding & Fabrication', enrolmentDate: '2023-09-10' },
  { id: 'OLD2', name: 'A year ago', course: 'Welding & Fabrication', enrolmentDate: '2024-09-10' }
];
assertEq(Core.transfer.tally(MIXED, ONE_INTAKE, OPT1).of(ONE_INTAKE[0]), 1,
  'one trainee is in this intake, not three');
assertEq(Core.transfer.traineesOf(MIXED, ONE_INTAKE[0], OPT1).length, 1,
  'and the enrolment register says the same number as the card');

console.log('But enrolling shortly BEFORE the intake opens is ordinary, and is kept');
assertEq(Core.transfer.tally([{ id: 'EARLY', name: 'Signed up in July',
    course: 'Welding & Fabrication', enrolmentDate: '2025-07-20' }], ONE_INTAKE, OPT1).of(ONE_INTAKE[0]), 1,
  'registered weeks ahead of the start date — same fiscal year, so it is this intake');

console.log('Only a provably impossible placement is refused');
assertEq(Core.transfer.tally([{ id: 'NODATE', name: 'No enrolment date',
    course: 'Welding & Fabrication' }], ONE_INTAKE, OPT1).of(ONE_INTAKE[0]), 1,
  'with no date on the record nothing is proven, so it is counted as before');
assertEq(Core.transfer.tally(MIXED, [{ id: 9, centreKey: '09', name: 'Welding & Fabrication' }],
  { field: 'course', centres: [{ id: 9, centreKey: '09', name: 'Welding & Fabrication' }] })
  .of({ centreKey: '09' }), 3, 'and an intake with no start date cannot rule anybody out');

console.log('An explicit stamp is still believed — this never overrides one');
assertEq(Core.transfer.tally([{ id: 'LATE', name: 'Moved in', course: 'Welding & Fabrication',
    centreKey: '09', enrolmentDate: '2023-09-10' }], ONE_INTAKE, OPT1).of(ONE_INTAKE[0]), 1,
  'a trainee transferred into this intake carries its key and is counted in it');

console.log('And the past trainees are still on the roll — they are not this intake\'s, not gone');
assertEq(MIXED.length, 3, 'nothing is removed from the roll by counting it');

/* ---------- 6. Transferred back to the earlier intake ----------

   Reported: a programme was re-run as "22. Welding and Fabrication Level 2",
   the trainees were transferred BACK to "01. Welding & Fabrication", and both
   intakes went on showing the same people. A transfer stamps the target intake
   on the record; it is the programme TEXT they arrived with that still names
   the intake they left. Counting by that text puts them back where they no
   longer are — so the stamp has to win, on every page. */
console.log('\nA trainee transferred back counts only in the intake they were moved to');
const TWO_INTAKES = [
  { id: 1,  centreKey: '01', name: '01. Welding & Fabrication',
    startDate: '2025-08-04', endDate: '2026-07-31' },
  { id: 22, centreKey: '22', name: '22. Welding and Fabrication Level 2',
    startDate: '2026-08-02', endDate: '2027-07-30' }
];
const OPT2 = { field: 'course', centres: TWO_INTAKES };
// Stamped with intake 01 by the transfer, still carrying intake 22's name.
const MOVED = [{ id: 'W1', name: 'Welder', course: '22. Welding and Fabrication Level 2',
                 centreKey: '01', centreId: 1, enrolmentDate: '2026-08-10' }];
const mt = Core.transfer.tally(MOVED, TWO_INTAKES, OPT2);
assertEq(mt.of(TWO_INTAKES[0]), 1, 'counted in 01, where they were moved to');
assertEq(mt.of(TWO_INTAKES[1]), 0, 'and NOT in 22, which they were moved out of');
assertEq(mt.of(TWO_INTAKES[0]) + mt.of(TWO_INTAKES[1]), MOVED.length,
  'one trainee is one trainee — never counted by two intakes at once');
assertEq(Core.transfer.traineesOf(MOVED, TWO_INTAKES[1], OPT2).length, 0,
  'and the emptied intake\'s register is empty, as the Centre left it');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
