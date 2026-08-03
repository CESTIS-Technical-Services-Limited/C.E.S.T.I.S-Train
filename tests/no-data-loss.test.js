/* The fee records must not be losable.

   What happened: School Fee's loadData() only adopts a stored value
   `if (saved…)`, so on a device whose store was empty — a new machine, a
   cleared browser, or simply a page that opened BEFORE its Google Drive pull
   had finished — students/payments stayed at their start-up value of []. The
   page rendered zero of everything, and the next thing that called saveData()
   wrote that [] into storage, stamped it with the current time and queued it
   for upload. A newer timestamp on an empty list beat the Centre's real
   records, so the roll went from Drive too.

   The rule these tests pin: EMPTINESS IS NEVER NEWER DATA. A collection that
   holds records is never replaced by one that holds none, in either direction,
   whatever the timestamps say. Wiping a collection has to be recorded
   deliberately — deleting a trainee, a payment or a training centre writes a
   tombstone, and those paths are unaffected.

   Run: node tests/no-data-loss.test.js */
'use strict';

const Core = require('../cestis-core.js');
const PC = Core.pageCloud;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const OLD = '2026-08-03T03:53:34.000Z';   // when the Centre's backup was written
const NEW = '2026-08-03T09:00:00.000Z';   // "now", on the device that came up empty

/* ---------- 1. What counts as nothing ---------- */
console.log('An absent, blank or empty value is recognised as holding no records');

[null, undefined, '', '   ', '[]', ' [] ', '{}', 'null'].forEach(v => {
  assertEq(PC.isEmptyValue(v), true, JSON.stringify(v) + ' holds no records');
});
[' [{"id":1}] ', '{"a":1}', '0', 'false'].forEach(v => {
  assertEq(PC.isEmptyValue(v), false, JSON.stringify(v) + ' does hold something');
});

console.log('A value that cannot be read is never mistaken for an empty one');
assertEq(PC.isEmptyValue('{ truncated…'), false,
  'a corrupt or half-written value is not "empty" — treating it as empty would ' +
  'be the very mistake this guard exists to prevent');

/* ---------- 2. The exact failure that lost the roll ---------- */
console.log('An empty roll with a NEWER timestamp cannot replace the records');

const ROLL = '[{"id":"STU-1","name":"Shanardo Williams","tuitionFee":48000}]';

let res = PC.mergeKeys(
  { cestiSchoolFeeStudents: '[]' },                       // the device that came up empty
  { cestiSchoolFeeStudents: NEW },                        // …and stamped it just now
  { cestiSchoolFeeStudents: ROLL },                       // the Centre's real roll
  { cestiSchoolFeeStudents: OLD });
assertEq(res.data.cestiSchoolFeeStudents, ROLL,
  'the records win despite the empty side carrying the newer timestamp');
assert(res.rescued.indexOf('cestiSchoolFeeStudents') !== -1,
  'and the save reports that it stopped a wipe, rather than doing it quietly');

console.log('The same holds pointing the other way');
res = PC.mergeKeys(
  { cestiSchoolFeeStudents: ROLL },                       // this device still has them
  { cestiSchoolFeeStudents: OLD },
  { cestiSchoolFeeStudents: '[]' },                       // a bad upload emptied the cloud
  { cestiSchoolFeeStudents: NEW });
assertEq(res.data.cestiSchoolFeeStudents, ROLL,
  'one device uploading an empty list cannot take everybody else down');
assertEq(res.changed.indexOf('cestiSchoolFeeStudents'), -1, 'nothing local is overwritten');

console.log('Not even on a first sync, where the cloud otherwise always wins');
res = PC.mergeKeys(
  { cestiSchoolFeeStudents: ROLL }, {},                   // never synced, but HAS records
  { cestiSchoolFeeStudents: '[]' },
  { cestiSchoolFeeStudents: NEW },
  { firstSync: true });
assertEq(res.data.cestiSchoolFeeStudents, ROLL,
  'a first sync adopts the Centre\'s data, but never its emptiness');

console.log('And a first sync still adopts real data over an empty device');
res = PC.mergeKeys(
  { cestiSchoolFeeStudents: '[]' }, {},
  { cestiSchoolFeeStudents: ROLL },
  { cestiSchoolFeeStudents: OLD },
  { firstSync: true });
assertEq(res.data.cestiSchoolFeeStudents, ROLL, 'which is the whole point of a first sync');

/* ---------- 3. Real editing is untouched ---------- */
console.log('Ordinary edits still merge newest-first');

const ONE = '[{"id":"STU-1","name":"Shanardo Williams"}]';
const TWO = '[{"id":"STU-1","name":"Shanardo Williams"},{"id":"STU-2","name":"Quentlon Mclean"}]';

res = PC.mergeKeys({ k: ONE }, { k: OLD }, { k: TWO }, { k: NEW });
assertEq(res.data.k, TWO, 'a trainee added on another device arrives here');

res = PC.mergeKeys({ k: TWO }, { k: NEW }, { k: ONE }, { k: OLD });
assertEq(res.data.k, TWO, 'and an older copy never undoes a newer edit');
assertEq(res.rescued.length, 0, 'neither of those is a rescue — both sides had records');

console.log('Removing SOME records is a normal edit, not a wipe');
res = PC.mergeKeys({ k: ONE }, { k: NEW }, { k: TWO }, { k: OLD });
assertEq(res.data.k, ONE,
  'deleting one of two trainees still syncs — only emptying the whole collection is refused');

console.log('Deleting everything is done by tombstone, which is unaffected');
res = PC.mergeKeys(
  { cestiSchoolFeeDeletedLmsIds: '["STU-1","STU-2"]' }, { cestiSchoolFeeDeletedLmsIds: NEW },
  { cestiSchoolFeeDeletedLmsIds: '["STU-1"]' }, { cestiSchoolFeeDeletedLmsIds: OLD });
assertEq(res.data.cestiSchoolFeeDeletedLmsIds, '["STU-1","STU-2"]',
  'a deletion recorded here still travels — the guard protects records, not the ' +
  'act of deleting them');

/* ---------- 4. Against the Centre's actual backup ---------- */
const fs = require('fs');
const path = require('path');
const BACKUP = path.join(__dirname, 'fixtures', 'school-fees-backup.json');

if (fs.existsSync(BACKUP)) {
  // The Centre's own CESTIS_School_Fees.json, with every trainee's name,
  // contact, date of birth and address replaced — this repository is public.
  // What matters to this test is preserved exactly: the number of records, the
  // dates, the programmes and every dollar.
  console.log('Against the shape of the real CESTIS_School_Fees.json backup');
  const payload = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  const cloud = payload.data, stamps = payload.stamps;

  const students = JSON.parse(cloud.cestiSchoolFeeStudents);
  const payments = JSON.parse(cloud.cestiSchoolFeePayments);
  assert(students.length > 300, 'the fixture carries the real roll (' + students.length + ' trainees)');
  assert(payments.length > 100, 'and the real payments (' + payments.length + ')');

  // The device as it was: everything empty, stamped now.
  const emptyLocal = {
    cestiSchoolFeeStudents: '[]',
    cestiSchoolFeePayments: '[]',
    cestiSchoolFeeDocuments: '[]',
    cestiFeeStructure: '{}'
  };
  const nowStamps = {};
  Object.keys(emptyLocal).forEach(k => { nowStamps[k] = NEW; });

  const merged = PC.mergeKeys(emptyLocal, nowStamps, cloud, stamps);
  assertEq(JSON.parse(merged.data.cestiSchoolFeeStudents).length, students.length,
    'every trainee comes back — ' + students.length + ' records');
  assertEq(JSON.parse(merged.data.cestiSchoolFeePayments).length, payments.length,
    'and every payment — ' + payments.length + ' records');
  assertEq(Object.keys(JSON.parse(merged.data.cestiFeeStructure)).length,
    Object.keys(JSON.parse(cloud.cestiFeeStructure)).length, 'and every priced programme');
  assert(merged.rescued.length >= 3,
    'the merge reports it rescued them rather than doing it silently (' +
    merged.rescued.join(', ') + ')');

  // Nothing about the money is altered on the way through.
  const totalIn = payments.reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
  const totalOut = JSON.parse(merged.data.cestiSchoolFeePayments)
    .reduce((a, p) => a + (parseFloat(p.amount) || 0), 0);
  assertEq(totalOut, totalIn, 'and every dollar is intact ($' + totalIn.toLocaleString() + ')');

  console.log('A push from that empty device would upload the records, not the emptiness');
  // push() merges local with the cloud copy and uploads the result.
  const outgoing = PC.mergeKeys(emptyLocal, nowStamps, cloud, stamps);
  assertEq(JSON.parse(outgoing.data.cestiSchoolFeeStudents).length, students.length,
    'so even a save from the broken device repairs Drive instead of wiping it');
} else {
  console.log('(the real backup fixture is not present — skipping that section)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
