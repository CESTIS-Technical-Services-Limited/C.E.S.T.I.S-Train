/* Unit tests for CESTISCore.transfer — moving a trainee, or a whole class,
   from one training centre to another.

   Done by hand a transfer means editing the same person in four places: the
   dashboard, their attendance, their user account and School Fee. Whatever is
   missed leaves them half in one centre and half in another. These tests pin
   the rule every one of those lists is moved by:

     - who counts as the centre's: the intake key stamped on them first, the
       centre id next, and the programme name they carry only as a last
       resort — a name is what two intakes of a programme share;
     - what a move writes: the receiving centre's key, id, name, dates and
       fiscal year, and the moment it happened, so the merges keep the move
       instead of a stale copy from another device undoing it;
     - what a move must NOT touch: anybody else's trainees.

   Run: node tests/transfer-core.test.js */
'use strict';

const Core = require('../cestis-core.js');
const T = Core.transfer;
const E = Core.enrolment;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const NOW = '2026-08-03T10:00:00.000Z';
function centres() {
  return [
    { id: 1, name: 'Welding and Fabrication', centreKey: '01', startDate: '2024-09-01', endDate: '2025-06-30' },
    { id: 2, name: 'Welding and Fabrication', centreKey: '02', startDate: '2026-01-01', endDate: '2027-06-30' },
    { id: 3, name: 'Plumbing', centreKey: '03', startDate: '2026-01-01', endDate: '2027-06-30' }
  ];
}

/* ---------- 1. Who belongs to a centre ---------- */
console.log('Who a training centre holds');

const C = centres();
assertEq(T.belongsTo({ id: 'S1', centreKey: '01', course: 'Anything' }, C[0], {}), true,
  'the intake key stamped on them settles it');
assertEq(T.belongsTo({ id: 'S1', centreKey: '01' }, C[1], {}), false,
  'and rules out the other intake of the same programme');
assertEq(T.belongsTo({ id: 'S2', centreId: 3, course: 'Welding and Fabrication' }, C[2], {}), true,
  'the centre id settles it next');
assertEq(T.belongsTo({ id: 'S3', course: '02. Welding and Fabrication' }, C[1], { centres: C }), true,
  'a name written with a key names one intake');
assertEq(T.belongsTo({ id: 'S3', course: '02. Welding and Fabrication' }, C[0], { centres: C }), false,
  'and never the other');
assertEq(T.belongsTo({ id: 'S4', course: 'Welding and Fabrication', enrolmentDate: '2024-10-01' }, C[0], { centres: C }), true,
  'an unstamped trainee falls to the intake running when they enrolled');
assertEq(T.belongsTo({ id: 'S5', skillArea: 'Plumbing' }, C[2], { field: 'skillArea', centres: C }), true,
  'the fee side names its programme in skillArea');
assertEq(T.belongsTo(null, C[0], {}), false, 'null-safe');
assertEq(T.belongsTo({ id: 'S6' }, C[0], { centres: C }), false, 'a record naming nothing belongs nowhere');

console.log('Listing a centre\'s trainees');

const roster = [
  { id: 'S1', name: 'Ann', centreKey: '01' },
  { id: 'S2', name: 'Ben', centreKey: '02' },
  { id: 'S3', name: 'Cy', centreKey: '01' }
];
assertEq(T.traineesOf(roster, C[0], {}).length, 2, 'two on the first intake');
assertEq(T.traineesOf(roster, C[1], {}).length, 1, 'one on the second');
assertEq(T.traineesOf(null, C[0], {}).length, 0, 'null-safe');

/* ---------- 2. What a move writes ---------- */
console.log('What a transfer writes on a trainee');

let list = [{ id: 'S1', name: 'Ann', course: 'Welding and Fabrication', centreKey: '01', centreId: 1,
              courseStart: '2024-09-01', courseEnd: '2025-06-30', fiscalYear: '2024/2025', stage: 'nyc' }];
let out = T.moveTrainees(list, C[0], C[1], { field: 'course', centres: C, now: NOW, toName: 'Welding and Fabrication' });
assertEq(out.moved, 1, 'the trainee moves');
assertEq(list[0].centreKey, '02', 'onto the receiving intake\'s key');
assertEq(list[0].centreId, 2, 'and its id');
assertEq(list[0].courseStart, '2026-01-01', 'carrying its start date');
assertEq(list[0].courseEnd, '2027-06-30', 'and its end date');
assertEq(list[0].fiscalYear, '2025/2026', 'and its fiscal year');
assertEq(list[0].lastModified, NOW, 'stamped with the moment of the move, so no merge undoes it');
assertEq(list[0].transferredFrom, '01. Welding and Fabrication',
  'and with the intake they came from, named by its key');
assertEq(list[0].stage, 'nyc', 'their academic stage is not the transfer\'s business');

console.log('Nobody else is touched');

list = [
  { id: 'S1', name: 'Ann', centreKey: '01' },
  { id: 'S2', name: 'Ben', centreKey: '02' },
  { id: 'S3', name: 'Cy', centreKey: '03' }
];
out = T.moveTrainees(list, C[0], C[2], { field: 'course', centres: C, now: NOW });
assertEq(out.moved, 1, 'only the centre\'s own trainee moves');
assertEq(list[0].centreKey, '03', 'Ann moves');
assertEq(list[1].centreKey, '02', 'Ben is left alone');
assertEq(list[2].centreKey, '03', 'Cy was already there and is unchanged');

console.log('Only the trainees chosen are moved');

list = [
  { id: 'S1', name: 'Ann', centreKey: '01' },
  { id: 'S2', name: 'Ben', centreKey: '01' }
];
out = T.moveTrainees(list, C[0], C[2], { field: 'course', centres: C, now: NOW, ids: { S1: true } });
assertEq(out.moved, 1, 'one of the two');
assertEq(list[0].centreKey, '03', 'the chosen one moves');
assertEq(list[1].centreKey, '01', 'the other stays');

console.log('The programme name written is the caller\'s to choose');

list = [{ id: 'S1', name: 'Ann', skillArea: '01. Welding and Fabrication', centreKey: '01' }];
T.moveTrainees(list, C[0], C[1], { field: 'skillArea', centres: C, now: NOW,
  toName: '02. Welding and Fabrication', stampUpdatedAt: true });
assertEq(list[0].skillArea, '02. Welding and Fabrication', 'the fee side keeps its own way of naming a programme');
assertEq(list[0].updatedAt, NOW, 'and its own edit stamp, which its merge reads');

console.log('A transfer to nowhere, or to the same centre, does nothing');

list = [{ id: 'S1', name: 'Ann', centreKey: '01' }];
assertEq(T.moveTrainees(list, C[0], C[0], { centres: C }).moved, 0, 'the same centre is not a transfer');
assertEq(list[0].centreKey, '01', 'and changes nothing');
assertEq(T.moveTrainees(list, C[0], null, {}).moved, 0, 'no receiving centre');
assertEq(T.moveTrainees(null, C[0], C[1], {}).moved, 0, 'null-safe');

console.log('Transferring twice is the same as transferring once');

list = [{ id: 'S1', name: 'Ann', centreKey: '01', course: 'Welding and Fabrication' }];
T.moveTrainees(list, C[0], C[2], { field: 'course', centres: C, now: NOW, toName: 'Plumbing' });
const after = JSON.stringify(list[0]);
assertEq(T.moveTrainees(list, C[0], C[2], { field: 'course', centres: C, now: NOW, toName: 'Plumbing' }).moved, 0,
  'they are no longer the old centre\'s to move');
assertEq(JSON.stringify(list[0]), after, 'and the record is untouched');

/* ---------- 3. What hangs off a trainee follows them ---------- */
console.log('Attendance and payments follow the trainee');

const attendance = [
  { studentId: 'S1', date: '2026-05-01', course: 'Welding and Fabrication' },
  { studentId: 'S1', date: '2026-05-02', course: 'Welding and Fabrication' },
  { studentId: 'S9', date: '2026-05-01', course: 'Welding and Fabrication' }
];
const res = T.renameCourseFor(attendance, { S1: true }, 'Plumbing', { field: 'course', now: NOW });
assertEq(res.moved, 2, 'both of the trainee\'s rows are re-filed');
assertEq(attendance[2].course, 'Welding and Fabrication', 'and nobody else\'s');
assertEq(attendance[0].lastModified, NOW, 'stamped so the merge keeps it');
assertEq(T.renameCourseFor(attendance, { S1: true }, 'Plumbing', { field: 'course', now: NOW }).moved, 0,
  'running it again changes nothing');

const payments = [
  { id: 'P1', studentId: 'F1', skillArea: '01. Welding and Fabrication', amount: 5000 },
  { id: 'P2', studentId: 'F2', skillArea: '01. Welding and Fabrication', amount: 5000 }
];
T.renameCourseFor(payments, { F1: true }, '02. Welding and Fabrication', { field: 'skillArea', now: NOW });
assertEq(payments[0].skillArea, '02. Welding and Fabrication', 'the moved trainee\'s payment is re-filed');
assertEq(payments[1].skillArea, '01. Welding and Fabrication', 'the other trainee\'s is not');
assertEq(payments[0].amount, 5000, 'and the money itself is never touched');

assertEq(T.renameCourseFor(null, { F1: true }, 'X', {}).moved, 0, 'null-safe');
assertEq(T.renameCourseFor(payments, null, 'X', {}).moved, 0, 'no ids, no change');

/* ---------- Result ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
