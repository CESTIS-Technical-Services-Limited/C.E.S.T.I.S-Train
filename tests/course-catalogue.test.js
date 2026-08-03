/* Unit tests for CESTISCore.catalogue — the one answer to "which programmes
   may a dropdown offer?".

   Every dashboard used to build that list the same wrong way: take the training
   centres, then union in every course name written on a student record and
   every programme on a user account. That union is what these tests pin down as
   fixed:

     - a training centre deleted on the Training Centres page went on being
       offered as an option on Student Progress, School Fee and everywhere else,
       because one old student record still carried its name;
     - the deletion was written down but never applied on load, so the next
       merge from a cloud copy or another tab put the centre back;
     - the "All Courses" filter grew a longer list on every page, mixing real
       centres with spellings nobody runs any more.

   The rule: the centres are the source of truth. Names left on old records are
   returned separately so a FILTER can still reach those trainees, but they are
   never a place to enrol somebody new.

   Run: node tests/course-catalogue.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* A stand-in for CESTISStore. The catalogue only ever reads and writes the one
   tombstone key through it. */
function makeStore(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    _raw: data
  };
}

function centre(id, name, over) {
  return Object.assign({ id: id, name: name, startDate: '', endDate: '' }, over || {});
}

/* The roster from the Training Centres page in the report. */
const CENTRES = [
  centre(1, 'Welding & Fabrication'),
  centre(2, 'Electrical Installation'),
  centre(3, 'Cosmetology'),
  centre(9, 'Welding and Fabrication Level 2')
];

/* The course names sitting on old student/user records — including two the
   Centre has not run for years, and one belonging to a deleted centre. */
const RECORD_VALUES = ['Welding & Fabrication', 'COMMI CHEF L2', 'Welding',
                       'BEAUTY THERAPY L2', 'Cosmetology', '', null];

/* ---------- 1. A dropdown offers the training centres, nothing else ---------- */
console.log('A dropdown is built from the training centres alone');

let store = makeStore();
let names = Core.catalogue.courseNames(CENTRES, store);

assertEq(names.length, 4, 'one option per training centre');
assertEq(names.join('|'),
  'Cosmetology|Electrical Installation|Welding & Fabrication|Welding and Fabrication Level 2',
  'listed alphabetically, exactly as the centres are named');
assert(names.indexOf('COMMI CHEF L2') === -1, 'a name only an old record carries is not offered');
assert(names.indexOf('Welding') === -1, 'nor a loose spelling of a real centre');

console.log('Two intakes of one programme stay two separate options');
assert(names.indexOf('Welding & Fabrication') !== -1 &&
       names.indexOf('Welding and Fabrication Level 2') !== -1,
  'the Level 2 intake is not folded into the original centre');

/* ---------- 2. Leftovers stay reachable, but only as archived ---------- */
console.log('Names left on old records come back separately, labelled archived');

let archived = Core.catalogue.orphanNames(CENTRES, RECORD_VALUES, store);
assertEq(archived.join('|'), 'BEAUTY THERAPY L2|COMMI CHEF L2|Welding',
  'only the names no live centre answers to, sorted, blanks dropped');
assert(archived.indexOf('Cosmetology') === -1, 'a name a live centre answers to is not archived');

console.log('The same programme written with different spacing or case is one name');
assertEq(Core.catalogue.orphanNames(CENTRES, ['  cosmetology  ', 'COSMETOLOGY'], store).length, 0,
  'case and spacing are set aside when deciding what is a leftover');

console.log('Archiving is exact, so a bare name keeps its own trainees findable');
assert(Core.catalogue.orphanNames(CENTRES, ['Welding'], store).length === 1,
  '"Welding" is not quietly folded into "Welding & Fabrication" — the trainees ' +
  'recorded under the bare name would otherwise be unreachable from every filter');

/* ---------- 3. options() answers a whole dropdown in one call ---------- */
console.log('One call answers a whole dropdown');

let opts = Core.catalogue.options(CENTRES, RECORD_VALUES, store);
assertEq(opts.courses.length, 4, 'the live centres');
assertEq(opts.archived.length, 3, 'and the leftovers, kept apart from them');

/* ---------- 4. A deleted centre is gone everywhere ---------- */
console.log('A deleted training centre stops being an option');

store = makeStore();
Core.catalogue.recordDeleted(store, 3);              // Cosmetology is deleted

let live = Core.catalogue.liveCentres(CENTRES, store);
assertEq(live.length, 3, 'the deleted centre is dropped from the roster');
assert(!live.some(c => c.name === 'Cosmetology'), 'and it is the right one that went');

names = Core.catalogue.courseNames(CENTRES, store);
assert(names.indexOf('Cosmetology') === -1, 'it is no longer offered as an option');
assertEq(Core.catalogue.isLive(CENTRES, 'Cosmetology', store), false, 'and no longer reads as live');
assertEq(Core.catalogue.isLive(CENTRES, 'Electrical Installation', store), true,
  'while the centres that remain are untouched');

console.log('Its trainees are still findable, under the archived group');
archived = Core.catalogue.orphanNames(CENTRES, RECORD_VALUES, store);
assert(archived.indexOf('Cosmetology') !== -1,
  'the deleted centre\'s name moves to archived rather than vanishing, so the ' +
  'trainees recorded against it can still be listed');

console.log('The deletion is written down, so a merge cannot bring it back');
assertEq(Core.catalogue.deletedIds(store).join(','), '3', 'the tombstone is stored');
assertEq(JSON.parse(store.getItem('voctrain_deletedCentreIds')).join(','), '3',
  'under the shared key every page reads');
// Simulate the merge that used to resurrect it: a cloud copy still carrying the
// centre is read back in, and the roster is rebuilt through the catalogue.
let fromCloud = CENTRES.slice();
assertEq(Core.catalogue.liveCentres(fromCloud, store).length, 3,
  'a copy that still carries the centre does not put it back');

console.log('Deleting the same centre twice records it once');
Core.catalogue.recordDeleted(store, 3);
assertEq(Core.catalogue.deletedIds(store).length, 1, 'no duplicate tombstone');

console.log('Re-creating the centre clears its tombstone');
Core.catalogue.clearDeleted(store, 3);
assertEq(Core.catalogue.deletedIds(store).length, 0, 'the tombstone is lifted');
assertEq(Core.catalogue.courseNames(CENTRES, store).length, 4, 'and the centre is offered again');

/* ---------- 5. Ids compare across the string/number divide ---------- */
console.log('A centre id stored as a number and deleted as text is still deleted');

store = makeStore({ voctrain_deletedCentreIds: JSON.stringify(['9']) });
live = Core.catalogue.liveCentres(CENTRES, store);
assert(!live.some(c => c.id === 9), 'the numeric id 9 matches the recorded "9"');

/* ---------- 6. Rubbish in never becomes an option ---------- */
console.log('Unnamed or malformed entries are never offered');

store = makeStore();
const messy = [null, {}, { id: 50, name: '' }, { id: 51, name: '   ' }, centre(52, 'Plumbing')];
assertEq(Core.catalogue.courseNames(messy, store).join('|'), 'Plumbing',
  'only the entry that actually names a programme');
assertEq(Core.catalogue.courseNames(null, store).length, 0, 'no roster at all is an empty list, not a crash');
assertEq(Core.catalogue.orphanNames(null, null, store).length, 0, 'and neither side has to be given');

/* ---------- 7. Missing store: read-only fallbacks, never a throw ---------- */
console.log('With no store to read, the centres still answer for themselves');

assertEq(Core.catalogue.deletedIds(null).length, 0, 'no store means no recorded deletions');
assertEq(Core.catalogue.courseNames(CENTRES, null).length, 4, 'and every centre is offered');

store = makeStore({ voctrain_deletedCentreIds: '{ not json' });
assertEq(Core.catalogue.deletedIds(store).length, 0, 'unreadable tombstones are ignored, not fatal');
assertEq(Core.catalogue.courseNames(CENTRES, store).length, 4, 'so no centre is lost to a bad write');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
