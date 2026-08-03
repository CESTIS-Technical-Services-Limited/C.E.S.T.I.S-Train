/* Every trainee exists twice — a Student Progress record and a School Fee
   record — and the two dashboards mirror each other by asking, for every
   record on one side, "which record on the other side is this same person?"

   That question used to be answered by scanning the whole other side,
   normalising two names on every comparison. It ran once per record, in both
   directions, and the dashboard reached for it on every keystroke in the
   student search box and on every save. Two rolls of a thousand is two million
   normalising comparisons between one letter and the next, which is what left
   the mouse barely moving.

   Core.twinIndex / Core.feeTwinIndex answer it from an index instead. These
   tests pin the thing that matters: the index must return EXACTLY the record
   the scan returned — not merely a correct-looking one. Where several records
   could match, the scan returned the FIRST in list order, and so must the
   index, or a mirror would start linking trainees to a different twin than
   before and silently rewrite the wrong record.

   Run: node tests/twin-index.test.js */
'use strict';

const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- The scans these replaced, kept verbatim ---------- */

function scanFindTwin(students, fee) {
  for (let i = 0; i < students.length; i++) {
    if (students[i] && Core.isFeeTwin(students[i], fee)) return students[i];
  }
  return null;
}
function scanFindByName(list, name) {
  const want = Core.normName(name);
  for (let i = 0; i < list.length; i++) {
    if (list[i] && Core.normName(list[i].name) === want) return list[i];
  }
  return null;
}
function scanFindFeeTwin(feeList, student) {
  for (let i = 0; i < feeList.length; i++) {
    if (feeList[i] && Core.isFeeTwin(student, feeList[i])) return feeList[i];
  }
  return null;
}

/* ---------- 1. The straightforward links ---------- */
console.log('Each way a fee record can be linked to a trainee is still found');

const STUDENTS = [
  { id: 'STU-1', name: 'Ann Brown', course: 'Plumbing' },
  { id: 'STU-2', name: 'Ben Clarke', course: 'Cosmetology', schoolFeeId: 'FEE-77' },
  { id: 'SF-FEE-9', name: 'Cara Dean', course: 'Welding' },
  { id: 'STU-4', name: 'Dan Evans', course: 'Plumbing' }
];
let idx = Core.twinIndex(STUDENTS);

assertEq(idx.find({ id: 'F1', lmsId: 'STU-1', name: 'Someone Else' }), STUDENTS[0],
  'an explicit lmsId wins even when the names disagree');
assertEq(idx.find({ id: 'STU-4', name: 'Someone Else' }), STUDENTS[3],
  'a fee record carrying the trainee id itself');
assertEq(idx.find({ id: 'FEE-9', name: 'Nobody' }), STUDENTS[2],
  "the fee page's mirrored 'SF-' twin id");
assertEq(idx.find({ id: 'FEE-77', name: 'Nobody' }), STUDENTS[1],
  'the back-reference the trainee record carries');
assertEq(idx.find({ id: 'F5', name: 'ann   BROWN', skillArea: 'plumbing' }), STUDENTS[0],
  'and a never-linked pair by name and programme, case and spacing set aside');

console.log('A record belonging to nobody matches nobody');
assertEq(idx.find({ id: 'F6', name: 'Zoe Nobody', skillArea: 'Plumbing' }), null, 'no match is null');
assertEq(idx.find(null), null, 'and no record at all is not a crash');
assertEq(idx.find({ id: 'F7', name: '' }), null, 'nor is a nameless one');

console.log('The programme decides between two trainees of the same name');
const SAMENAME = [
  { id: 'A', name: 'Ann Brown', course: 'Cosmetology' },
  { id: 'B', name: 'Ann Brown', course: 'Plumbing' }
];
assertEq(Core.twinIndex(SAMENAME).find({ id: 'F', name: 'Ann Brown', skillArea: 'Plumbing' }), SAMENAME[1],
  'the one actually on that programme');
assertEq(Core.twinIndex(SAMENAME).find({ id: 'F', name: 'Ann Brown' }), SAMENAME[0],
  'and with no programme stated, the first of them — as the scan returned');

/* ---------- 2. Identical to the scan, over an awkward roll ---------- */
console.log('Over a roll built to collide, the index returns exactly what the scan returned');

// Deliberately nasty: shared names, ids that are other records' twin ids,
// blank programmes, missing names, nulls, and duplicate ids.
function buildRoll(n) {
  const students = [], fee = [];
  const names = ['Ann Brown', 'Ben Clarke', 'Cara Dean', 'ANN   brown', 'Dan Evans', ''];
  const courses = ['Plumbing', 'Cosmetology', 'Welding', '', 'Plumbing'];
  for (let i = 0; i < n; i++) {
    const s = {
      id: (i % 11 === 0) ? ('SF-FEE-' + i) : ('STU-' + i),
      name: names[i % names.length] + (i % 7 === 0 ? '' : ' ' + i),
      course: courses[i % courses.length]
    };
    if (i % 5 === 0) s.schoolFeeId = 'FEE-' + i;
    if (i % 13 === 0) s.id = 'STU-' + (i - 1);      // a duplicate id
    students.push(i % 17 === 0 ? null : s);

    const f = {
      id: 'FEE-' + i,
      name: names[(i + 2) % names.length] + (i % 7 === 0 ? '' : ' ' + i),
      skillArea: courses[(i + 1) % courses.length]
    };
    if (i % 4 === 0) f.lmsId = 'STU-' + ((i * 3) % n);
    fee.push(i % 19 === 0 ? null : f);
  }
  return { students, fee };
}

const { students: ROLL_S, fee: ROLL_F } = buildRoll(220);
idx = Core.twinIndex(ROLL_S);

let mismatch = 0, hits = 0, misses = 0;
ROLL_F.forEach(f => {
  const got = idx.find(f);
  const want = f ? scanFindTwin(ROLL_S, f) : null;
  if (got !== want) mismatch++;
  if (want) hits++; else misses++;
});
assertEq(mismatch, 0, 'every fee record resolves to the identical trainee object');
assert(hits > 20, 'the roll produces real matches (' + hits + ') — the comparison is not vacuous');
assert(misses > 5, 'and real non-matches (' + misses + ') too');

console.log('The same holds for "the same person under any programme"');
mismatch = 0;
let named = 0;
ROLL_F.forEach(f => {
  if (!f || !Core.normName(f.name)) return;   // callers return 'skip' before this point
  named++;
  if (idx.findByName(f.name) !== scanFindByName(ROLL_S, f.name)) mismatch++;
});
assertEq(mismatch, 0, 'findByName returns the identical trainee the scan did');
assert(named > 50, 'over a real number of named records (' + named + ')');

/* The one deliberate difference, and the guards that make it unreachable. */
console.log('Two records with no name are not treated as the same person');

const NAMELESS = [{ id: 'A', name: '', course: 'Plumbing' }, { id: 'B', name: 'Ann', course: 'Plumbing' }];
const nIdx = Core.twinIndex(NAMELESS);
assertEq(nIdx.findByName(''), null,
  'a nameless record matches nobody — the scan compared normalised names with ' +
  '===, so two BLANK names came out equal and it paired them off');
assertEq(nIdx.find({ id: 'F', name: '' }), null,
  'which is what find() has always done, so the two halves now agree');

// And it cannot be reached: both mirrors refuse a nameless record up front.
assertEq(Core.lmsMirrorTarget({ id: 'F', name: '' }, NAMELESS, [], {}).action, 'skip',
  'lmsMirrorTarget skips a nameless fee record before it ever asks');
assertEq(Core.lmsMirrorTarget({ id: 'F', name: '   ' }, NAMELESS, [], {}).reason, 'no-name',
  'whitespace is not a name either');
assertEq(Core.feeMirrorTarget({ id: 'S', name: '' }, [], {}).action, 'skip',
  'and feeMirrorTarget skips a nameless trainee');

console.log('And for the mirror pointing the other way');
const feeIdx = Core.feeTwinIndex(ROLL_F);
mismatch = 0; hits = 0;
ROLL_S.forEach(s => {
  if (!s) return;
  const got = feeIdx.find(s);
  const want = scanFindFeeTwin(ROLL_F, s);
  if (got !== want) mismatch++;
  if (want) hits++;
});
assertEq(mismatch, 0, 'every trainee resolves to the identical fee record');
assert(hits > 20, 'with real matches (' + hits + ') — again not vacuous');

console.log('feeMirrorTarget decides the same with an index as without one');
mismatch = 0;
const decisions = {};
ROLL_S.forEach(s => {
  if (!s) return;
  const withIdx = Core.feeMirrorTarget(s, ROLL_F, { index: Core.feeTwinIndex(ROLL_F.slice()) });
  const without = Core.feeMirrorTarget(s, ROLL_F);
  decisions[without.action] = (decisions[without.action] || 0) + 1;
  if (withIdx.action !== without.action || withIdx.reason !== without.reason) mismatch++;
  if (withIdx.match !== without.match) mismatch++;
});
assertEq(mismatch, 0, 'same action, same reason, same record');
assert(Object.keys(decisions).length > 1,
  'the roll exercises more than one outcome (' + JSON.stringify(decisions) + ')');

console.log('lmsMirrorTarget decides the same with an index as without one');
const CENTRES = [{ id: 1, name: 'Plumbing' }, { id: 2, name: 'Cosmetology' }, { id: 3, name: 'Welding' }];
mismatch = 0;
const lmsDecisions = {};
ROLL_F.forEach(f => {
  if (!f) return;
  const opts = { findCentre: Core.enrolment.findCentre };
  const without = Core.lmsMirrorTarget(f, ROLL_S, CENTRES, opts);
  const withIdx = Core.lmsMirrorTarget(f, ROLL_S, CENTRES,
    { findCentre: Core.enrolment.findCentre, twinIndex: Core.twinIndex(ROLL_S) });
  lmsDecisions[without.action] = (lmsDecisions[without.action] || 0) + 1;
  if (withIdx.action !== without.action || withIdx.reason !== without.reason ||
      withIdx.match !== without.match || withIdx.course !== without.course) mismatch++;
});
assertEq(mismatch, 0, 'same action, reason, record and programme');
assert(Object.keys(lmsDecisions).length > 1,
  'exercising more than one outcome (' + JSON.stringify(lmsDecisions) + ')');

/* ---------- 3. Adding as the mirror walks the roll ---------- */
console.log('A trainee added mid-pass is seen by the rest of the pass');

const growing = [{ id: 'STU-1', name: 'Ann Brown', course: 'Plumbing' }];
const gIdx = Core.twinIndex(growing);
const added = { id: 'STU-2', name: 'Ben Clarke', course: 'Welding' };
gIdx.add(added);
assertEq(growing.length, 2, 'the roster itself grew');
assertEq(gIdx.find({ id: 'F', name: 'Ben Clarke', skillArea: 'Welding' }), added,
  'and the new trainee is found straight away — which is what stops a person ' +
  'listed twice in one roll from being created twice');

console.log('add() cannot double-count a record already pushed');
const pushed = [{ id: 'STU-1', name: 'Ann Brown', course: 'Plumbing' }];
const pIdx = Core.twinIndex(pushed);
const extra = { id: 'STU-9', name: 'Zed Young', course: 'Welding' };
pushed.push(extra);
pIdx.add(extra);                       // called AFTER a push, not instead of one
assertEq(pushed.length, 2, 'the record appears once, not twice');
assertEq(pIdx.find({ id: 'F', name: 'Zed Young', skillArea: 'Welding' }), extra, 'and is still found');

console.log('The same for the fee side');
const feeGrowing = [];
const fgIdx = Core.feeTwinIndex(feeGrowing);
const newFee = { id: 'STU-5', lmsId: 'STU-5', name: 'Eve Frost', skillArea: 'Plumbing' };
fgIdx.add(newFee);
assertEq(feeGrowing.length, 1, 'the roll grew');
assertEq(fgIdx.find({ id: 'STU-5', name: 'Eve Frost', course: 'Plumbing' }), newFee, 'and the record is found');

/* ---------- 4. Nothing to index ---------- */
console.log('An empty or malformed roll is answered, not thrown at');
assertEq(Core.twinIndex([]).find({ id: 'F', name: 'Ann' }), null, 'an empty roster matches nothing');
assertEq(Core.twinIndex(null).find({ id: 'F', name: 'Ann' }), null, 'and neither does no roster at all');
assertEq(Core.feeTwinIndex(null).find({ id: 'S', name: 'Ann' }), null, 'the same on the fee side');
assertEq(Core.twinIndex([null, undefined, {}]).find({ id: 'F', name: 'Ann' }), null,
  'rubbish entries are skipped');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
