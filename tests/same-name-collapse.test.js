/* One person, one record.

   The Centre's rule, set deliberately: two trainee records carrying the same
   exact name are the same person, and one of them must go — whatever ids they
   were given and whatever programme each names.

   This is stronger than the centre-identity dedup, which keeps two records
   when their programmes differ. That is what left "Omario Bryan" listed once
   under "Welding & Fabrication" (5% progress, id STU-m6ph27jrre) and again
   under "WELDING L2" (0%, id STU-1sjnz30im1q): two spellings of one enrolment,
   read as two enrolments.

   What these tests pin:
     - same name collapses to one record, across differing programmes and ids;
     - the record that SURVIVES is the one with real use behind it, and it
       inherits everything the discarded one held — the survivor is never
       poorer than either;
     - every discarded id is mapped, so attendance, payments, exam results and
       logins follow the survivor rather than dangling;
     - genuinely different names are never touched.

   Run: node tests/same-name-collapse.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- 1. The reported pair ---------- */
console.log('The same trainee under two programmes and two ids becomes one record');

const REPORTED = [
  { id: 'STU-m6ph27jrre', name: 'Omario Bryan', course: 'Welding & Fabrication',
    stage: 'nyc', progress: 5, email: 'omario@example.invalid' },
  { id: 'STU-1sjnz30im1q', name: 'Omario Bryan', course: 'WELDING L2',
    stage: 'nyc', progress: 0, phone: '8761234567' }
];

let r = Core.collapseSameNameStudents(REPORTED);
assertEq(r.students.length, 1, 'two records become one');
assertEq(r.removed, 1, 'and one is reported removed');
assertEq(r.students[0].name, 'Omario Bryan', 'the person survives');

console.log('The survivor keeps everything BOTH records held');
assertEq(r.students[0].progress, 5, 'the recorded progress is not lost to the 0');
assertEq(r.students[0].email, 'omario@example.invalid', 'the email from one record');
assertEq(r.students[0].phone, '8761234567', 'and the phone from the other');

console.log('The discarded id is mapped, so their attendance and payments follow');
const survivorId = r.students[0].id;
const goneId = REPORTED.map(s => s.id).find(id => id !== survivorId);
assertEq(r.idMap[goneId], survivorId, 'the removed id points at the survivor');

/* ---------- 2. Which record survives ---------- */
console.log('The record with real use behind it is the one kept');

r = Core.collapseSameNameStudents([
  { id: 'EMPTY', name: 'Kemar Cowan', course: 'WELDING L2', stage: 'testing', progress: 0 },
  { id: 'USED',  name: 'Kemar Cowan', course: 'Welding & Fabrication', stage: 'certified',
    progress: 100, certNo: 'CERT-001' }
]);
assertEq(r.students[0].id, 'USED', 'the certified record wins over the blank one');
assertEq(r.idMap['EMPTY'], 'USED', 'and the blank one maps onto it');

console.log('Order on the page does not decide it');
r = Core.collapseSameNameStudents([
  { id: 'USED',  name: 'Kemar Cowan', course: 'X', stage: 'certified', progress: 100, certNo: 'C1' },
  { id: 'EMPTY', name: 'Kemar Cowan', course: 'Y', stage: 'testing', progress: 0 }
]);
assertEq(r.students[0].id, 'USED', 'the used record wins whichever way round they appear');

console.log('A record linked to a School Fee record beats an unlinked one');
r = Core.collapseSameNameStudents([
  { id: 'PLAIN',  name: 'Toniann Cargill', course: 'COSMETOLOGY L2', stage: 'testing' },
  { id: 'LINKED', name: 'Toniann Cargill', course: 'COSMETOLOGY L2', stage: 'testing',
    schoolFeeId: 'SF-9' }
]);
assertEq(r.students[0].id, 'LINKED', 'the fee-linked record is the one to keep');

console.log('The more specific programme spelling is the one kept');
r = Core.collapseSameNameStudents([
  { id: 'A', name: 'Mickhel Brooks', course: 'Welding & Fabrication', stage: 'training', progress: 40 },
  { id: 'B', name: 'Mickhel Brooks', course: '02. Welding & Fabrication', centreKey: '02', stage: 'testing' }
]);
assertEq(r.students.length, 1, 'still one person');
assertEq(r.students[0].course, '02. Welding & Fabrication',
  'the keyed spelling is carried onto the survivor, so their intake is not lost');
assertEq(String(r.students[0].centreKey), '02', 'and the centre stamp with it');

/* ---------- 3. Three or more, and chains ---------- */
console.log('Three records of one person collapse to one, with every id mapped');

r = Core.collapseSameNameStudents([
  { id: 'ONE',   name: 'Devaughn Clarke', course: 'A', stage: 'testing' },
  { id: 'TWO',   name: 'Devaughn Clarke', course: 'B', stage: 'training', progress: 30 },
  { id: 'THREE', name: 'Devaughn Clarke', course: 'C', stage: 'testing', email: 'd@example.invalid' }
]);
assertEq(r.students.length, 1, 'one record remains');
assertEq(r.removed, 2, 'two removed');
assertEq(r.students[0].id, 'TWO', 'the one in training is kept');
assertEq(r.idMap['ONE'], 'TWO', 'the first maps onto it');
assertEq(r.idMap['THREE'], 'TWO', 'and so does the third');
assertEq(r.students[0].email, 'd@example.invalid', 'carrying the third\'s email across');
// Nothing may map to a record that is no longer on the roll.
const ids = new Set(r.students.map(s => s.id));
assert(Object.values(r.idMap).every(v => ids.has(v)), 'no id maps to a record that was removed');

/* ---------- 4. Names that are not the same ---------- */
console.log('Different people are never merged');

r = Core.collapseSameNameStudents([
  { id: 'A', name: 'Alex Peart', course: 'WELDING L2' },
  { id: 'B', name: 'Alex Peartt', course: 'WELDING L2' },
  { id: 'C', name: 'Alexa Peart', course: 'WELDING L2' },
  { id: 'D', name: 'Peart Alex', course: 'WELDING L2' }
]);
assertEq(r.students.length, 4, 'a near-miss is a different person — the match is exact, never fuzzy');
assertEq(r.removed, 0, 'nothing removed');

console.log('Case and extra spacing are still the same name');
r = Core.collapseSameNameStudents([
  { id: 'A', name: 'Amar Smith', course: 'X', stage: 'training', progress: 20 },
  { id: 'B', name: '  amar   SMITH ', course: 'Y', stage: 'testing' }
]);
assertEq(r.students.length, 1, 'one person, written two ways');

console.log('A record with no name is passed through untouched');
r = Core.collapseSameNameStudents([
  { id: 'A', name: '', course: 'X' },
  { id: 'B', name: '   ', course: 'Y' },
  { id: 'C', name: 'Real Person', course: 'Z' }
]);
assertEq(r.students.length, 3, 'nameless records are left exactly as they are, never merged together');

/* ---------- 5. Safety ---------- */
console.log('Running it twice changes nothing further');
r = Core.collapseSameNameStudents(REPORTED.map(s => Object.assign({}, s)));
const again = Core.collapseSameNameStudents(r.students);
assertEq(again.removed, 0, 'the collapse is idempotent');

console.log('An empty or malformed roll is answered, not thrown at');
assertEq(Core.collapseSameNameStudents([]).students.length, 0, 'an empty roll');
assertEq(Core.collapseSameNameStudents(null).students.length, 0, 'no roll at all');
assertEq(Core.collapseSameNameStudents([null, undefined]).removed, 0, 'rubbish entries');

console.log('The School Fee roll collapses by the same rule, on skillArea');
r = Core.collapseSameNameStudents([
  { id: 'F1', name: 'Felisha Bassier', skillArea: 'COSMETOLOGY L2', tuitionFee: 38000, totalPaid: 5000 },
  { id: 'F2', name: 'Felisha Bassier', skillArea: 'Cosmetology', tuitionFee: 0, totalPaid: 0 }
], { courseField: 'skillArea' });
assertEq(r.students.length, 1, 'one fee record per person');
assertEq(r.students[0].tuitionFee, 38000, 'the priced record is the one kept');
assertEq(r.students[0].totalPaid, 5000, 'with the money that was recorded against it');
assertEq(r.idMap['F2'], 'F1', 'and the discarded id maps across, so its payments relink');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
