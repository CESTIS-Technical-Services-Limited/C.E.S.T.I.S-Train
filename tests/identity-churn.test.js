/* "Data sync keeps fixing and repopulating data, which causes a duplication."

   A trainee's id is a hash of their natural key, and the natural key was the
   name plus the RAW course string. That made the id move whenever the course
   text was rewritten — and the dashboard rewrites it on every single load:

     - alignProgrammeTextToIntake() sets s.course to the stamped centre's name;
     - a transfer writes the keyed label, "01. Welding & Fabrication".

   So one person was 'STU-p7al0hg27' before the text was realigned and
   'STU-1i5e0bi81mr' after it. reconcileSnapshot unions records BY ID, found
   both, and kept both: one trainee, listed twice. The launch dedup then
   collapsed them, the next load moved the id again, and the pair came back —
   which is what "fixes it, then duplicates it again" describes.

   There was also a disagreement inside cestis-core itself. dedupeStudents
   groups on programmeIdentity().bare, the course name with its intake key
   stripped, so it already considered 'Welding & Fabrication' and
   '01. Welding & Fabrication' the same person. stableStudentId did not. The
   dedup merged them and the id generator split them apart again on the next
   pass, for ever.

   The natural key now uses the same key-stripped programme name the dedup
   groups on, so the two agree and the id stops moving.

   Run: node tests/identity-churn.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function section(t) { console.log('\n' + t); }

section('The intake key written into the programme text does not move the id');
{
  const bare  = { name: 'Shanardo Williams', course: 'Welding & Fabrication' };
  const keyed = { name: 'Shanardo Williams', course: '01. Welding & Fabrication' };
  assertEq(Core.stableStudentId(keyed), Core.stableStudentId(bare),
    'the same person keeps one id whichever way the programme is spelt');
  assertEq(Core.naturalKey(keyed), Core.naturalKey(bare),
    'because both spellings give the same natural key');
}

section('Which is the same rule dedupeStudents already applied');
{
  const roll = [
    { id: 'STU-old', name: 'Omario Bryan', course: 'Welding & Fabrication', progress: 45 },
    { id: 'STU-new', name: 'Omario Bryan', course: '01. Welding & Fabrication' }
  ];
  const r = Core.dedupeStudents(roll.map(function (s) { return Object.assign({}, s); }));
  assertEq(r.students.length, 1, 'the dedup reads them as one person');

  const bundle = { students: roll.map(function (s) { return Object.assign({}, s); }) };
  Core.migrateToStableIds(bundle);
  assertEq(bundle.students.length, 1, 'and so does the id migration — one record, not two');
}

section('Realigning the programme text leaves the id where it was');
{
  const s = { id: null, name: 'Anthony Williams', course: 'Welding & Fabrication' };
  s.id = Core.stableStudentId(s);
  const enrolled = s.id;
  // What alignProgrammeTextToIntake() does on every load.
  s.course = '01. Welding & Fabrication';
  assertEq(Core.stableStudentId(s), enrolled, 'the id survives the rewrite');
}

section('Two intakes of one programme are still two different enrolments');
{
  const l1 = { name: 'Jadan Walters', course: 'Welding & Fabrication' };
  const l2 = { name: 'Jadan Walters', course: 'Welding and Fabrication Level 2' };
  assert(Core.stableStudentId(l1) !== Core.stableStudentId(l2),
    'a genuinely different programme still gives a different id');
}

section('And the id is stable across devices and across repeated migrations');
{
  const mk = function () {
    return [{ id: 'STU1700000000000', name: 'Amar Smith', course: 'Electrical Installation' }];
  };
  const a = { students: mk() }, b = { students: mk() };
  Core.migrateToStableIds(a);
  Core.migrateToStableIds(b);
  assertEq(a.students[0].id, b.students[0].id, 'two devices mint the same id for the same person');

  const before = a.students[0].id;
  const again = Core.migrateToStableIds(a);
  assertEq(a.students[0].id, before, 'running the migration again does not move it');
  assertEq(again.changed, false, 'and reports nothing changed');
}

section('The whole round trip: realign the text, sync, and nobody is duplicated');
{
  // Device A holds the roll as enrolled. Device B has had its programme text
  // realigned to the keyed label, so before the fix its ids had all moved.
  const enrolled = [
    { id: null, name: 'Shanardo Williams', course: 'Welding & Fabrication', progress: 5 },
    { id: null, name: 'Jadan Walters',     course: 'Welding & Fabrication', progress: 5 }
  ];
  enrolled.forEach(function (s) { s.id = Core.stableStudentId(s); });

  const deviceA = { students: enrolled.map(function (s) { return Object.assign({}, s); }) };
  const deviceB = { students: enrolled.map(function (s) {
    return Object.assign({}, s, { course: '01. Welding & Fabrication' });
  }) };
  Core.migrateToStableIds(deviceA);
  Core.migrateToStableIds(deviceB);

  // The snapshot reconcile unions the two rolls BY ID.
  const snapshot = Core.buildSnapshot({ voctrain_students: JSON.stringify(deviceB.students) }, {});
  const merged = Core.reconcileSnapshot(snapshot, { voctrain_students: JSON.stringify(deviceA.students) });
  const out = JSON.parse(merged.store.voctrain_students);
  assertEq(out.length, 2, 'two trainees in, two trainees out — no duplicates minted by the union');

  const names = out.map(function (s) { return s.name; }).sort();
  assertEq(names.join(','), 'Jadan Walters,Shanardo Williams', 'and they are the right two people');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
