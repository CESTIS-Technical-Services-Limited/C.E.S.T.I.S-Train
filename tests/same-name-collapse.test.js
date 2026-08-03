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

/* ---------- 6. "Keep separate": the administrator's exemption ---------- */
console.log('\nA record marked "keep separate" is never merged with its namesake');

// Two REAL people who share a name. The admin marks one of them.
r = Core.collapseSameNameStudents([
  { id: 'JB1', name: 'John Brown', course: 'WELDING L2', stage: 'training', progress: 40 },
  { id: 'JB2', name: 'John Brown', course: 'COSMETOLOGY L2', stage: 'testing', keepSeparate: true }
]);
assertEq(r.students.length, 2, 'both people stand — marking ONE of the two is enough');
assertEq(r.removed, 0, 'nothing removed');
assertEq(Object.keys(r.idMap).length, 0, 'and no id is redirected');

console.log('Marking both works the same way');
r = Core.collapseSameNameStudents([
  { id: 'A', name: 'John Brown', course: 'X', keepSeparate: true },
  { id: 'B', name: 'John Brown', course: 'Y', keepSeparate: true }
]);
assertEq(r.students.length, 2, 'two marked namesakes are two records');

console.log('Unmarked namesakes still collapse among themselves');
r = Core.collapseSameNameStudents([
  { id: 'PINNED', name: 'John Brown', course: 'X', keepSeparate: true },
  { id: 'DUP1',   name: 'John Brown', course: 'Y', stage: 'training', progress: 30 },
  { id: 'DUP2',   name: 'John Brown', course: 'Y', stage: 'testing' }
]);
assertEq(r.students.length, 2, 'the pinned record, plus ONE record for the two duplicates');
assert(r.students.some(s => s.id === 'PINNED'), 'the pinned record is untouched');
assertEq(r.idMap['DUP2'], 'DUP1', 'and the genuine duplicate still folds away');
assert(!r.idMap['PINNED'], 'nothing is ever mapped away from a pinned record');

console.log('The pinned record is never absorbed INTO a stronger namesake either');
r = Core.collapseSameNameStudents([
  { id: 'STRONG', name: 'John Brown', course: 'X', stage: 'certified', progress: 100, certNo: 'C1' },
  { id: 'WEAK',   name: 'John Brown', course: 'Y', stage: 'testing', keepSeparate: true }
]);
assertEq(r.students.length, 2, 'evidence does not override the administrator');
assert(r.students.some(s => s.id === 'WEAK'), 'the pinned record survives on its own');

console.log('The centre-identity dedup honours it too');
r = Core.dedupeStudents([
  { id: 'A', name: 'John Brown', course: 'Electrical Installation' },
  { id: 'B', name: 'John Brown', course: '02. Electrical Installation', centreKey: '02', keepSeparate: true }
]);
assertEq(r.students.length, 2, 'so a pinned record cannot be folded in by the other pass first');

console.log('The marker is recognised however it survived a round trip');
assertEq(Core.isKeptSeparate({ keepSeparate: true }), true, 'a real boolean');
assertEq(Core.isKeptSeparate({ keepSeparate: 'true' }), true, 'the string a form/JSON round trip can leave');
assertEq(Core.isKeptSeparate({ keepSeparate: false }), false, 'unticked');
assertEq(Core.isKeptSeparate({}), false, 'absent');
assertEq(Core.isKeptSeparate(null), false, 'null-safe');

console.log('And it survives a record merge, so it cannot be lost to a sync');
const mergedKeep = Core.mergeStudentRecords(
  { id: 'A', name: 'John Brown', course: 'X', lastModified: '2026-08-03T12:00:00.000Z' },
  { id: 'A', name: 'John Brown', course: 'X', keepSeparate: true, lastModified: '2026-08-01T00:00:00.000Z' });
assertEq(Core.isKeptSeparate(mergedKeep), true,
  'a newer copy without the marker does not strip it — losing it would collapse ' +
  'the record on the next launch, the one thing the admin set it to prevent');

console.log('Clearing the marker lets the records collapse again');
r = Core.collapseSameNameStudents([
  { id: 'A', name: 'John Brown', course: 'X', stage: 'training', progress: 30 },
  { id: 'B', name: 'John Brown', course: 'Y', stage: 'testing' }   // marker removed by the admin
]);
assertEq(r.students.length, 1, 'unticking it puts the record back under the ordinary rule');

/* ---------- 7. The same exemption on the School Fee roll ---------- */
console.log('\nThe exemption works the same on two same-named FEE records');

// Two real people who share a name, each owing on their own programme.
r = Core.collapseSameNameStudents([
  { id: 'SF-1', name: 'John Brown', skillArea: 'WELDING L2',
    tuitionFee: 120000, totalPaid: 40000, balance: 80000 },
  { id: 'SF-2', name: 'John Brown', skillArea: 'COSMETOLOGY L2',
    tuitionFee: 90000, totalPaid: 0, balance: 90000, keepSeparate: true }
], { courseField: 'skillArea' });
assertEq(r.students.length, 2, 'both fee records stand');
assertEq(Object.keys(r.idMap).length, 0,
  'and no id is redirected, so neither account has the other one\'s payments moved onto it');
assertEq(r.students[0].totalPaid, 40000, 'the money stays with the person who paid it');
assertEq(r.students[1].balance, 90000, 'and the other balance is untouched');

console.log('A genuine fee double still folds away beside a pinned namesake');
r = Core.collapseSameNameStudents([
  { id: 'SF-PIN', name: 'John Brown', skillArea: 'COSMETOLOGY L2', totalPaid: 0, keepSeparate: true },
  { id: 'SF-A',   name: 'John Brown', skillArea: 'WELDING L2',     totalPaid: 15000 },
  { id: 'SF-B',   name: 'John Brown', skillArea: 'Welding & Fabrication', totalPaid: 0 }
], { courseField: 'skillArea' });
assertEq(r.students.length, 2, 'the pinned record, plus one record for the two duplicates');
assertEq(r.idMap['SF-B'], 'SF-A', 'the duplicate\'s payments relink to the survivor');
assert(!r.idMap['SF-PIN'], 'nothing is ever mapped away from the pinned fee record');

/* Why the two propagation helpers (feePropagateKeepSeparate on School Fee,
   spPropagateKeepSeparate on Student Progress) do not stop at the linked twin.

   Marking a fee record has to mark the same person on the dashboard, or one
   side stands while the other is collapsed on the next launch. But the pin is
   usually set AFTER the two records have been collapsed once and re-created —
   and that collapse re-pointed every dashboard link at the survivor, so the
   record being pinned has no id left to be found by. It is still the same
   person by name, which is what the marker is about. */
console.log('After one collapse the twin link no longer reaches the re-created record');
const lmsRoll = [
  { id: 'JB1', name: 'John Brown', course: 'Welding & Fabrication', schoolFeeId: 'SF-1' },
  { id: 'JB2', name: 'John Brown', course: 'Cosmetology', schoolFeeId: 'SF-1' }  // re-pointed by the collapse
];
const reCreated = { id: 'SF-2', name: 'John Brown', skillArea: 'COSMETOLOGY L2' };
assertEq(Core.twinIndex(lmsRoll).find(reCreated), null,
  'the id link is gone and the programme spellings do not agree, so find() has nothing');
assertEq(Core.twinIndex(lmsRoll).findByName(reCreated.name).id, 'JB1',
  'the by-name fallback still reaches the person — and marking EITHER namesake ' +
  'keeps the whole pair, as the collapse rule above shows');

console.log('And the fee-roll index falls back the same way, for the other direction');
const feeRoll = [
  { id: 'SF-1', name: 'John Brown', skillArea: 'WELDING L2', lmsId: 'JB1' },
  { id: 'SF-2', name: 'John Brown', skillArea: 'COSMETOLOGY L2' }
];
const unlinked = { id: 'STU-new', name: 'John Brown', course: 'Cosmetology' };
assertEq(Core.feeTwinIndex(feeRoll).find(unlinked), null, 'nothing links this record yet');
assertEq(Core.feeTwinIndex(feeRoll).findByName(unlinked.name).id, 'SF-1',
  'so the name settles it, exactly as lmsMirrorTarget already resolves a twin');

/* ---------- 8. One rule for "is this the same person?" ----------

   Reported: a trainee stood twice on the roll and the count for their centre
   read double. The launch collapse decided "same person" with normName — case
   folded AND every run of whitespace folded — while the account reconciler
   decided it with .toLowerCase().trim(), which leaves a double space INSIDE a
   name intact. So an imported account reading "Yaneek  Simmonds" and the roll
   reading "Yaneek Simmonds" were one person to the collapse and two to the
   reconciler: the collapse merged them each launch and the reconciler minted
   the second straight back. Everything that asks now asks Core.sameName. */
console.log('\nOne rule decides whether two records are the same person');
assertEq(Core.sameName('Yaneek Simmonds', 'Yaneek  Simmonds'), true,
  'a double space inside the name is still the same person — this is the pair that doubled');
assertEq(Core.sameName('  Yaneek Simmonds  ', 'yaneek simmonds'), true,
  'as are surrounding spaces and case');
assertEq(Core.sameName('Yaneek\tSimmonds', 'Yaneek Simmonds'), true,
  'and a tab, which an import can leave behind');
assertEq(Core.sameName('Yaneek Simmonds', 'Yaneek Simmond'), false,
  'a genuinely different name is still a different person');
assertEq(Core.sameName('', ''), false, 'two nameless records are not "the same person"');
assertEq(Core.sameName(null, undefined), false, 'and neither are two absent ones');
assertEq(Core.sameName('Yaneek Simmonds', ''), false, 'nor a name and a blank');

console.log('The collapse and the name rule agree, which is the whole point');
r = Core.collapseSameNameStudents([
  { id: 'STU-1gtg5dkrt8y', name: 'Yaneek Simmonds', course: 'COSMETOLOGY L2', stage: 'training', progress: 20 },
  { id: '14072025', name: 'Yaneek  Simmonds', course: 'Cosmetology' }
]);
assertEq(r.students.length, 1, 'the pair the reconciler used to re-create is one person');
assertEq(r.idMap['14072025'], 'STU-1gtg5dkrt8y', 'and the minted id maps back onto the real record');

console.log('A nameless record still matches nobody, in either direction');
assertEq(Core.twinIndex(lmsRoll).findByName(''), null, 'no name, no namesake');
assertEq(Core.feeTwinIndex(feeRoll).findByName('   '), null, 'and blanks are not a name');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
