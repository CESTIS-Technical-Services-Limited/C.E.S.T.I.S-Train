/* Training centres are distinct things told apart by their key — '01', '02',
   '03' — even when they share a programme name. Trainee IDENTITY has to honour
   that, and it did not: records were compared on the raw course string, so the
   same person written once as 'Electrical Installation' and once as
   '02. Electrical Installation' read as two different people. Every dedup let
   both live, the cross-page mirrors re-created whichever spelling was
   "missing", and the enrolment registers listed every trainee twice.

   The rule these tests pin: one person = one name + one CENTRE, where the
   centre is compared by its key when stated (stamp first, then the key written
   into the label) and by the key-stripped bare name otherwise. And the
   opposite guarantee alongside it: two records keyed to DIFFERENT intakes of
   one programme are never merged — the keys exist precisely so that two
   centres sharing a name stay two centres.

   Run: node tests/centre-key-identity.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- 1. The doubled register, exactly as screenshotted ---------- */
console.log('The same person under two spellings of one centre becomes one record');

// Alex Pryce, Amar Stone, … each present twice: the bare legacy spelling and
// the keyed spelling a transfer wrote — same phone, same date of birth.
const DOUBLED = [];
['Alex Pryce', 'Amar Stone', 'Amaru Oakes', 'Anthony Walters.', 'Dannasha Hartley', 'Devaughn Carter']
  .forEach((name, i) => {
    DOUBLED.push({ id: 'STU-old-' + i, name: name, course: 'Electrical Installation',
                   phone: '87650000' + i, dob: '2006-01-0' + (i + 1), stage: 'training' });
    DOUBLED.push({ id: 'STU-new-' + i, name: name, course: '02. Electrical Installation',
                   centreKey: '02', centreId: 2, phone: '87650000' + i, dob: '2006-01-0' + (i + 1),
                   stage: 'training', lastModified: '2026-08-03T10:00:00.000Z' });
  });

let r = Core.dedupeStudents(DOUBLED);
assertEq(r.students.length, 6, 'twelve records collapse to the six real people');
assertEq(r.removed, 6, 'and the six ghosts are counted as removed');

console.log('The keyed identity survives the merge, so they cannot split again');
r.students.forEach(s => {
  assertEq(s.course, '02. Electrical Installation', s.name + ' keeps the keyed spelling');
  assertEq(String(s.centreKey), '02', s.name + ' keeps the centre stamp');
});

console.log('Every removed id is mapped, so attendance and payments can follow');
for (let i = 0; i < 6; i++) {
  const gone = r.idMap['STU-old-' + i] || r.idMap['STU-new-' + i];
  assert(gone != null, 'one of the pair maps onto the kept record');
}

console.log('Running it again changes nothing — the dedup is idempotent');
let again = Core.dedupeStudents(r.students);
assertEq(again.removed, 0, 'no further merges on a clean roll');

/* ---------- 2. The guarantee the keys exist for ---------- */
console.log('Two records keyed to DIFFERENT intakes are never merged');

const TWO_INTAKES = [
  { id: 'A', name: 'Ann Brown', course: '02. Welding & Fabrication', centreKey: '02' },
  { id: 'B', name: 'Ann Brown', course: '09. Welding & Fabrication', centreKey: '09' }
];
r = Core.dedupeStudents(TWO_INTAKES);
assertEq(r.students.length, 2, 'a person enrolled in two intakes is two records');
assertEq(r.removed, 0, 'nothing is removed');

console.log('An unkeyed legacy record joins the LOWEST intake, not every intake');
const LEGACY_PLUS_TWO = [
  { id: 'L', name: 'Ann Brown', course: 'Welding & Fabrication' },
  { id: 'A', name: 'Ann Brown', course: '02. Welding & Fabrication', centreKey: '02' },
  { id: 'B', name: 'Ann Brown', course: '09. Welding & Fabrication', centreKey: '09' }
];
r = Core.dedupeStudents(LEGACY_PLUS_TWO);
assertEq(r.students.length, 2, 'the legacy spelling folds into one intake');
const keys = r.students.map(s => String(s.centreKey)).sort();
assertEq(keys.join(','), '02,09', 'and both intakes still stand, keyed apart');
assertEq(r.idMap['L'], 'A', 'the legacy record joined intake 02, the lowest');

console.log('Different people are untouched, as ever');
r = Core.dedupeStudents([
  { id: 'A', name: 'Ann Brown', course: 'Plumbing' },
  { id: 'B', name: 'Ben Clarke', course: 'Plumbing' },
  { id: 'C', name: 'Ann Brown', course: 'Cosmetology' }
]);
assertEq(r.students.length, 3, 'same name on a different programme is a different enrolment');

console.log('And the School Fee roll dedupes by the same rule, on skillArea');
r = Core.dedupeStudents([
  { id: 'F1', name: 'Alex Pryce', skillArea: 'Electrical Installation', tuitionFee: 28000 },
  { id: 'F2', name: 'Alex Pryce', skillArea: '02. Electrical Installation', centreKey: '02',
    lastModified: '2026-08-03T10:00:00.000Z' }
], { courseField: 'skillArea' });
assertEq(r.students.length, 1, 'one fee record per person per centre');
assertEq(r.students[0].skillArea, '02. Electrical Installation', 'keeping the keyed spelling');

/* ---------- 3. The mirrors stop re-creating the missing spelling ---------- */
console.log('The twin test recognises the keyed and bare spellings as one programme');

assertEq(Core.isFeeTwin(
  { id: 'S1', name: 'Alex Pryce', course: 'Electrical Installation' },
  { id: 'F1', name: 'Alex Pryce', skillArea: '02. Electrical Installation' }), true,
  'so the fee↔LMS mirrors link this person instead of minting their double');

assertEq(Core.isFeeTwin(
  { id: 'S1', name: 'Alex Pryce', course: '02. Electrical Installation' },
  { id: 'F1', name: 'Alex Pryce', skillArea: '09. Electrical Installation' }), false,
  'while two different intakes of the programme never twin by name+programme');

console.log('twinIndex answers identically, so the indexed mirrors agree');
const roster = [{ id: 'S1', name: 'Alex Pryce', course: 'Electrical Installation' }];
const idx = Core.twinIndex(roster);
assertEq(idx.find({ id: 'F1', name: 'Alex Pryce', skillArea: '02. Electrical Installation' }), roster[0],
  'the index links the keyed fee record to the bare-named student');

/* ---------- 4. programmeIdentity itself ---------- */
console.log('programmeIdentity reads stamp first, label key second, bare name last');

assertEq(Core.programmeIdentity({ course: '02. Electrical Installation' }).key, '02', 'key from the label');
assertEq(Core.programmeIdentity({ course: 'Electrical Installation', centreKey: '7' }).key, '07',
  'an explicit stamp wins and is padded');
assertEq(Core.programmeIdentity({ course: 'Electrical Installation' }).key, '', 'no key stated');
assertEq(Core.programmeIdentity({ course: '02. Electrical Installation' }).bare, 'electrical installation',
  'the bare name is key-stripped and normalised');
assertEq(Core.programmeIdentity({ skillArea: '03. Plumbing' }, 'skillArea').key, '03', 'skillArea field works');
assertEq(Core.programmeIdentity({ course: '2 Day Induction' }).key, '',
  'a name merely beginning with a number is not a key');
assertEq(Core.programmeIdentity(null).bare, '', 'null-safe');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
