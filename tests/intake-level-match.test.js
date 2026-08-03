/* "The two electrical programmes keep taking trainees from each other, although
    only 01 Electrical Installation has students and that programme had ended."

   A programme and its Level 2 are two centres whose names overlap almost
   entirely, and resolving a trainee's programme text ran through two passes
   that could not tell them apart:

     - the PREFIX pass. Every programme name starts its own Level 2 name, and a
       bare "ELECTRICAL" starts both, so both intakes matched. Nothing about the
       level was tested, so preferCentre chose between them on whose register
       was OPEN — which handed the trainees of the finished Level 1 programme to
       the Level 2 intake the moment it opened, and moved them again whenever
       that changed.

     - the WORD-MATCHING pass. It rejected a candidate only when BOTH names
       stated a level, so a Level 2 query matched an unlevelled centre on the
       one shared word. The fee side writes "ELECTRICAL L2"; the roster holds
       "Electrical Installation"; those trainees were counted in Level 1.

   Both passes now prefer a centre stating the level being asked for, and fall
   back to the looser reading only when none does — which is still needed,
   because a programme run twice may carry no level in either centre's name
   ("Welding and Fabrication", 01 and 02), and "WELDING L2" must still find the
   intake that is open.

   Run: node tests/intake-level-match.test.js */
'use strict';

const Core = require('../cestis-core.js');
const E = Core.enrolment, T = Core.transfer;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function section(t) { console.log('\n' + t); }

/* The two electrical intakes as the Training Centres page shows them: the first
   has ended, the Level 2 one is running now. */
function electrical() {
  const c = [
    { id: 2,       name: 'Electrical Installation',        startDate: '2025-08-04', endDate: '2026-07-31' },
    { id: 'sa_e2', name: 'Electrical Installation Level 2', startDate: '2026-08-02', endDate: '2027-07-30' }
  ];
  E.assignCentreKeys(c);
  return c;
}
const AFTER_L2_OPENED = Date.parse('2026-08-03T12:00:00Z');
const nameOf = (c) => c ? c.name : '(nowhere)';

section('A trainee of the finished programme is never taken by the new intake');
{
  const c = electrical();
  const opts = { field: 'course', centres: c, nowMs: AFTER_L2_OPENED };
  // Spellings that miss an exact match and fall through to the fuzzy passes,
  // with no enrolment date to ground them — where the OPEN intake used to win.
  ['Electrical Installation', 'Electrical Installations', 'ELECTRICAL', 'Electrical Wiring Installation']
    .forEach(function (written) {
      const rec = { id: 'x', name: 'T', course: written };
      const t = T.tally([rec], c, opts);
      assertEq(t.of(c[1]), 0, '"' + written + '" is not counted in the Level 2 intake');
      assertEq(t.of(c[0]), 1, '"' + written + '" is counted in the programme it names');
    });
}

section('And the Level 1 roll does not move when the Level 2 intake opens');
{
  const c = electrical();
  const roll = [];
  for (let i = 0; i < 15; i++) {
    roll.push({ id: 'L1-' + i, name: 'L1 Trainee ' + i, course: 'Electrical Installation',
                enrolmentDate: '2025-09-01' });
  }
  [['2026-07-01T12:00:00Z', 'while Level 1 was still running'],
   ['2026-08-03T12:00:00Z', 'after Level 2 opened']].forEach(function (pair) {
    const t = T.tally(roll, c, { field: 'course', centres: c, nowMs: Date.parse(pair[0]) });
    assertEq(t.of(c[0]), 15, 'Level 1 still holds its 15 ' + pair[1]);
    assertEq(t.of(c[1]), 0, 'and Level 2 holds none ' + pair[1]);
  });
}

section('The fee side\'s shorthand finds the LEVEL it names, not the bare programme');
{
  const c = electrical();
  assertEq(nameOf(E.findCentre(c, 'ELECTRICAL L2', { nowMs: AFTER_L2_OPENED })),
    'Electrical Installation Level 2', '"ELECTRICAL L2" is the Level 2 centre');
  assertEq(nameOf(E.findCentre(c, 'ELECTRICAL INSTALLATION', { nowMs: AFTER_L2_OPENED })),
    'Electrical Installation', 'and the unlevelled spelling stays with the unlevelled centre');
}

section('Three levels of one programme stay three separate centres');
{
  const c = [
    { id: 1, name: 'Electrical Installation',                         startDate: '2025-08-04', endDate: '2026-07-31' },
    { id: 2, name: 'Electrical Installation Level 2',                 startDate: '2026-08-02', endDate: '2027-07-30' },
    { id: 3, name: 'Electrical Installation and Maintenance Level 3', startDate: '2026-08-02', endDate: '2027-07-30' }
  ];
  E.assignCentreKeys(c);
  assertEq(nameOf(E.findCentre(c, 'ELECTRICAL L3', { nowMs: AFTER_L2_OPENED })),
    'Electrical Installation and Maintenance Level 3', 'Level 3 shorthand finds Level 3');
  assertEq(nameOf(E.findCentre(c, 'ELECTRICAL L2', { nowMs: AFTER_L2_OPENED })),
    'Electrical Installation Level 2', 'and Level 2 shorthand finds Level 2');
}

section('The looser reading still applies where no centre states a level at all');
{
  // One programme run twice; neither centre carries a level in its name.
  const twice = [
    { id: 1, centreKey: '01', name: 'Welding and Fabrication', startDate: '2024-09-01', endDate: '2025-06-30' },
    { id: 2, centreKey: '02', name: 'Welding and Fabrication', startDate: '2026-01-01', endDate: '2027-06-30' }
  ];
  const found = E.findCentre(twice, 'WELDING L2', { today: '2026-08-02' });
  assert(!!found, '"WELDING L2" still resolves when nothing states a level');
  assertEq(found.id, 2, 'and it is the intake that can still take trainees');
}

section('A level stated on both sides is still never crossed');
{
  const lv = [
    { id: 1, name: 'Welding and Fabrication Level 2', startDate: '2026-08-02', endDate: '2027-07-30' },
    { id: 2, name: 'Welding and Fabrication Level 3', startDate: '2026-08-02', endDate: '2027-07-30' }
  ];
  E.assignCentreKeys(lv);
  assertEq(nameOf(E.findCentre(lv, 'WELDING L2', { nowMs: AFTER_L2_OPENED })),
    'Welding and Fabrication Level 2', 'Level 2 shorthand never reaches the Level 3 centre');
  assertEq(nameOf(E.findCentre(lv, 'WELDING L3', { nowMs: AFTER_L2_OPENED })),
    'Welding and Fabrication Level 3', 'nor the other way round');
}

section('An intake key still settles it outright, whatever the level says');
{
  const c = electrical();
  const k1 = E.centreKeyOf(c[0]);
  const rec = { id: 'x', name: 'T', course: 'Electrical Installation Level 2', centreKey: k1 };
  const t = T.tally([rec], c, { field: 'course', centres: c, nowMs: AFTER_L2_OPENED });
  assertEq(t.of(c[0]), 1, 'the stamp wins over the programme text, as it always has');
  assertEq(t.of(c[1]), 0, 'and the Level 2 centre does not claim them');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
