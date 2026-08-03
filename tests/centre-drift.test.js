/* Data drifting between training centres, and one trainee counted as several.

   The Centre reported three things happening together:

     - trainee counts populating and depopulating between page views;
     - the same records appearing under more than one training centre;
     - "when I go to Course Duration and back to the dashboard it corrects
       itself".

   All three are the same defect. A training centre made with "+ Add Training
   Centre" carries a generated string id ('sa_1754…'), not a number, so
   centreKeyOf() answered '' for it until assignCentreKeys() had run — and
   assignCentreKeys() ran only when somebody opened Course Duration or Transfer
   Trainees, and never saved what it wrote. In that unkeyed state:

     - tally() bucketed by the key, and '' is falsy, so those trainees were
       counted under NO centre. Every card read 0 and the pipeline emptied.
     - belongsTo() compared with `!==`, and '' !== '' is false, so a trainee
       belonged to EVERY unkeyed centre at once. The Transfer page and the
       enrolment registers listed the same person under each of them.

   Opening Course Duration handed every centre a key and both screens agreed
   again — until the next load, when the keys were gone and it started over.

   And because the leftover keys were numbered by walking the array, two devices
   holding the same centres in a different order — which is normal, since the
   snapshot reconcile appends what it did not have onto the end — gave the same
   centre a different key. The centreKey stamped on a trainee then pointed at a
   different programme on each machine, and each sync swapped the rolls over.

   Run: node tests/centre-drift.test.js */
'use strict';

const Core = require('../cestis-core.js');
const E = Core.enrolment;
const T = Core.transfer;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function section(t) { console.log('\n' + t); }

/* Centres exactly as the Training Centres page shows them: a finished intake
   and the Level 2 intake running now, both created through the button, so both
   carry generated string ids and no key. */
function freshCentres() {
  return [
    { id: 'sa_1754300000000', name: 'Welding & Fabrication',
      startDate: '2025-08-04', endDate: '2026-07-31' },
    { id: 'sa_1754300000001', name: 'Welding and Fabrication Level 2',
      startDate: '2026-08-02', endDate: '2027-07-30' },
    { id: 'sa_1754300000002', name: 'Electrical Installation',
      startDate: '2025-08-04', endDate: '2026-07-31' }
  ];
}

const ROLL = [
  { id: 'STU-a', name: 'Shanardo Williams', course: 'Welding & Fabrication', enrolmentDate: '2025-09-01' },
  { id: 'STU-b', name: 'Jadan Walters',     course: 'Welding & Fabrication', enrolmentDate: '2025-09-01' },
  { id: 'STU-c', name: 'Amar Smith',        course: 'Electrical Installation', enrolmentDate: '2025-09-01' }
];
const NOW = Date.parse('2026-08-03T12:00:00Z');
function opts(centres) { return { field: 'course', centres: centres, nowMs: NOW }; }

section('A centre that has not been given a key yet is still told apart from every other');
{
  const centres = freshCentres();
  centres.forEach(function (c) {
    assertEq(E.centreKeyOf(c), '', 'no key has been assigned to ' + c.name + ' yet');
    assert(E.centreIdentity(c) !== '', c.name + ' can still be told apart from the others');
  });
  const ids = centres.map(E.centreIdentity);
  assertEq(new Set(ids).size, 3, 'and no two of them share an identity');
}

section('The cards count the roll BEFORE anything has assigned a key');
{
  const centres = freshCentres();
  const t = T.tally(ROLL, centres, opts(centres));
  assertEq(t.of(centres[0]), 2, 'Welding & Fabrication holds its 2 trainees');
  assertEq(t.of(centres[1]), 0, 'the Level 2 intake, which nobody has enrolled into, holds 0');
  assertEq(t.of(centres[2]), 1, 'Electrical Installation holds its 1');
  assertEq(t.of(centres[0]) + t.of(centres[1]) + t.of(centres[2]), ROLL.length,
    'and every trainee is counted exactly once, under one centre');
}

section('A trainee belongs to ONE unkeyed centre, not to all of them');
{
  const centres = freshCentres();
  assertEq(T.traineesOf(ROLL, centres[0], opts(centres)).length, 2, 'Welding & Fabrication holds 2');
  assertEq(T.traineesOf(ROLL, centres[1], opts(centres)).length, 0,
    'the Level 2 intake holds none of them');
  assertEq(T.traineesOf(ROLL, centres[2], opts(centres)).length, 1, 'Electrical Installation holds 1');
}

section('The cards and the Transfer page cannot disagree, keys or no keys');
{
  const centres = freshCentres();
  const t = T.tally(ROLL, centres, opts(centres));
  centres.forEach(function (c) {
    assertEq(t.of(c), T.traineesOf(ROLL, c, opts(centres)).length,
      'the card and the Transfer page state the same figure for ' + c.name);
  });
}

section('Opening Course Duration no longer CHANGES the answer — it only confirms it');
{
  const centres = freshCentres();
  const before = centres.map(function (c) { return T.tally(ROLL, centres, opts(centres)).of(c); });
  E.assignCentreKeys(centres);                     // what Course Duration does
  const after = centres.map(function (c) { return T.tally(ROLL, centres, opts(centres)).of(c); });
  assertEq(JSON.stringify(after), JSON.stringify(before),
    'the counts are the same before and after the keys are stamped');
  assertEq(JSON.stringify(before), JSON.stringify([2, 0, 1]), 'and they were right all along');
}

section('Two devices holding the same centres in a different order agree on the keys');
{
  const a = freshCentres();
  const b = [freshCentres()[2], freshCentres()[0], freshCentres()[1]];   // reconcile appended them differently
  E.assignCentreKeys(a);
  E.assignCentreKeys(b);
  a.forEach(function (c) {
    const twin = b.filter(function (x) { return x.id === c.id; })[0];
    assertEq(E.centreKeyOf(twin), E.centreKeyOf(c),
      c.name + ' has the same intake key on both devices');
  });
}

section('A centre that already carries a key is never renumbered');
{
  const centres = [
    { id: 'sa_z', centreKey: '07', name: 'Plumbing' },
    { id: 'sa_y', name: 'Cosmetology' },
    { id: 2, name: 'Beauty Therapy' }
  ];
  E.assignCentreKeys(centres);
  assertEq(centres[0].centreKey, '07', 'the stamped key is left exactly as it was');
  assertEq(centres[2].centreKey, '02', 'a numeric id still gives its own key');
  assert(centres[1].centreKey && centres[1].centreKey !== '07' && centres[1].centreKey !== '02',
    'and the leftover gets a free one, never a key already in use');
  const keys = centres.map(E.centreKeyOf);
  assertEq(new Set(keys).size, 3, 'so no two centres end up sharing a key');
}

section('Running the assignment again changes nothing');
{
  const centres = freshCentres();
  E.assignCentreKeys(centres);
  const first = centres.map(E.centreKeyOf).join(',');
  assertEq(E.assignCentreKeys(centres), 0, 'a second pass stamps nobody');
  assertEq(centres.map(E.centreKeyOf).join(','), first, 'and leaves every key where it was');
}

section('A trainee stamped with a key still finds their own intake');
{
  const centres = freshCentres();
  E.assignCentreKeys(centres);
  const moved = { id: 'STU-d', name: 'Anthony Williams', course: 'Welding & Fabrication',
                  centreKey: E.centreKeyOf(centres[1]) };          // transferred into Level 2
  const t = T.tally([moved], centres, opts(centres));
  assertEq(t.of(centres[1]), 1, 'the stamp puts them in the intake they were moved to');
  assertEq(t.of(centres[0]), 0, 'and not in the one their programme text still names');
}

section('A centre with neither a key nor an id holds nobody, rather than everybody');
{
  const orphan = { name: 'Nameless Centre' };
  assertEq(E.centreIdentity(orphan), '', 'it cannot be told apart from anything');
  assertEq(T.traineesOf(ROLL, orphan, { field: 'course', centres: [orphan], nowMs: NOW }).length, 0,
    'so no trainee is attributed to it');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
