/* Deletions must survive every merge.

   The Centre reported programmes it had deleted coming back — on the LMS
   dashboard, and then on every other page that reads the training centres.

   A deletion is written down rather than acted out: the record is removed AND
   its id is added to a tombstone list, because the next merge sees the record
   still present in the other copy and would otherwise read it as "missing here"
   and put it back. That part worked. What did not is the tombstone list itself:
   it was merged as ordinary data, one whole list replacing the other by
   whichever was written last. Two devices that had each deleted something each
   held a list the other had never seen, so whichever list lost took its
   deletions with it — and the centre, still sitting in the roster with nothing
   left to say it had gone, reappeared everywhere at the next sync.

   Tombstone lists only ever grow, so both sides are always right: they are
   merged by UNION, in both merge paths (the per-page Drive backup and the
   master snapshot). These tests pin that.

   Run: node tests/deletion-tombstones.test.js */
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
function ids(raw) { return JSON.parse(raw || '[]').slice().sort(); }

const OLD = '2026-07-01T09:00:00.000Z';
const NEW = '2026-08-01T09:00:00.000Z';

/* ---------- 1. Every list of deletions is named ---------- */
console.log('Every deletion list the platform keeps is merged by union');
['voctrain_deletedStudentIds', 'voctrain_deletedCentreIds',
 'cestiSchoolFeeDeletedLmsIds', 'cestiSchoolFeeDeletedPaymentIds'].forEach(function (k) {
  assertEq(Core.isTombstoneKey(k), true, k + ' is treated as a tombstone list');
});
assertEq(Core.isTombstoneKey('voctrain_skillAreas'), false, 'the roster itself is not one');
assertEq(Core.isTombstoneKey(''), false, 'blank key');
assertEq(Core.isTombstoneKey(null), false, 'null-safe');

/* The training centres' list is the one that was missing, so say so directly. */
assertEq(Core.TOMBSTONE_UNION_KEYS.indexOf('voctrain_deletedCentreIds') !== -1, true,
  'the training centres\' deletions are unioned — this is the bug that let a deleted centre return');

/* ---------- 2. Neither device's deletions can be lost ---------- */
console.log('Two devices, one delete each: both deletes survive');
/* Device B deleted centre 7 this morning. Device A deleted centre 22 this
   afternoon and its file is the newer of the two. Judged as ordinary data the
   newer list would win outright and centre 7 would be back on B by teatime. */
let res = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["7"]' },  { voctrain_deletedCentreIds: OLD },
  { voctrain_deletedCentreIds: '["22"]' }, { voctrain_deletedCentreIds: NEW });
assertEq(ids(res.data.voctrain_deletedCentreIds).join(','), '22,7', 'both deletions are kept');
assertEq(res.changed.indexOf('voctrain_deletedCentreIds') !== -1, true, 'and the union is written back locally');

/* The same when the LOCAL list is the newer one — a union has no winner. */
res = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["7"]' },  { voctrain_deletedCentreIds: NEW },
  { voctrain_deletedCentreIds: '["22"]' }, { voctrain_deletedCentreIds: OLD });
assertEq(ids(res.data.voctrain_deletedCentreIds).join(','), '22,7',
  'a newer local list still takes the other device\'s deletion');

/* ---------- 3. Nothing is rewritten when there is nothing to add ---------- */
console.log('A list that already holds everything is left alone');
res = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["7","22"]' }, { voctrain_deletedCentreIds: OLD },
  { voctrain_deletedCentreIds: '["22"]' },     { voctrain_deletedCentreIds: NEW });
assertEq(res.data.voctrain_deletedCentreIds, '["7","22"]', 'the local list is untouched');
assertEq(res.changed.length, 0, 'and nothing is rewritten');

/* ---------- 4. A device that has deleted nothing still learns of a delete ---------- */
console.log('A device with no deletions of its own adopts the other\'s');
res = PC.mergeKeys(
  { voctrain_deletedCentreIds: '[]' }, {},
  { voctrain_deletedCentreIds: '["22"]' }, { voctrain_deletedCentreIds: NEW });
assertEq(ids(res.data.voctrain_deletedCentreIds).join(','), '22', 'the deletion arrives');

/* And a device that has never held the key at all. */
res = PC.mergeKeys({}, {}, { voctrain_deletedCentreIds: '["22"]' }, { voctrain_deletedCentreIds: NEW });
assertEq(ids(res.data.voctrain_deletedCentreIds).join(','), '22', 'a key this device never had is taken');

/* ---------- 5. Two devices holding the same deletions agree on the value ---------- */
console.log('The union is written the same way on every device');
const a = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["22","7"]' }, {},
  { voctrain_deletedCentreIds: '["3"]' }, {});
const b = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["3","7"]' }, {},
  { voctrain_deletedCentreIds: '["22"]' }, {});
assertEq(a.data.voctrain_deletedCentreIds, b.data.voctrain_deletedCentreIds,
  'the same deletions produce the same stored value, so the devices stop rewriting each other');

/* ---------- 6. The master snapshot merges them the same way ---------- */
console.log('The master snapshot unions them too');
const rec = Core.reconcileSnapshot(
  { store: { voctrain_deletedCentreIds: '["22"]' } },
  { voctrain_deletedCentreIds: '["7"]' });
assertEq(ids(rec.store.voctrain_deletedCentreIds).join(','), '22,7',
  'reconcile keeps this device\'s deletions and takes the snapshot\'s');
assertEq(rec.changed, true, 'and reports the change');

const quiet = Core.reconcileSnapshot(
  { store: { voctrain_deletedCentreIds: '["22"]' } },
  { voctrain_deletedCentreIds: '["22","7"]' });
assertEq(quiet.restoredKeys.indexOf('voctrain_deletedCentreIds'), -1,
  'a snapshot that adds nothing rewrites nothing');

/* ---------- 7. End to end: the centre stays deleted ---------- */
console.log('A centre deleted on one device stays gone on the other');
/* Device B holds the full roster and has deleted centre 7 of its own. Device A
   deleted centre 22 and uploaded. After the sync, B must show NEITHER. */
const roster = [
  { id: 7,  name: 'Photovoltaic Installer' },
  { id: 22, name: 'Welding and Fabrication Level 2' },
  { id: 23, name: 'Electrical Installation Level 2' }
];
const synced = PC.mergeKeys(
  { voctrain_deletedCentreIds: '["7"]' },  { voctrain_deletedCentreIds: NEW },
  { voctrain_deletedCentreIds: '["22"]' }, { voctrain_deletedCentreIds: OLD });

const store = {
  getItem: function (k) { return synced.data[k] == null ? null : synced.data[k]; },
  setItem: function () {}
};
const live = Core.catalogue.liveCentres(roster, store).map(function (c) { return c.name; });
assertEq(live.join(','), 'Electrical Installation Level 2',
  'both deleted centres are gone from the roster every page reads');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
