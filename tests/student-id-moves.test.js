/* Student ID moves are kept, so the trainee gate can place records that arrive
   later under a trainee's old ID (Core.gate.prepare's opts.relinked).

   Run: node tests/student-id-moves.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
const ROOT = path.join(__dirname, '..');
['', 'Offline System'].forEach(where => {
  const Core = require(path.join(ROOT, where, 'cestis-core.js'));
  const M = Core.studentIdMoves, w = where || 'root';
  console.log(w + ': a move is kept, and later moves carry the older ones along');
  let log = M.record(null, { 'STU-a': 'STU-b' }, 1000);
  assert(M.toMap(log)['STU-a'] === 'STU-b', w + ': A→B kept');
  log = M.record(log, { 'STU-b': 'STU-c' }, 2000);
  let m = M.toMap(log);
  assert(m['STU-a'] === 'STU-c' && m['STU-b'] === 'STU-c', w + ': A→B then B→C gives A→C and B→C — got ' + JSON.stringify(m));
  log = M.record(log, { 'STU-c': 'STU-a' }, 3000);
  m = M.toMap(log);
  assert(!('STU-a' in m) && m['STU-b'] === 'STU-a' && m['STU-c'] === 'STU-a', w + ': a move back to an old ID drops that entry and points the rest at it — got ' + JSON.stringify(m));
  console.log(w + ': nothing odd gets in, and the log is capped');
  log = M.record({ junk: 5, 'STU-x': { to: 'STU-x' }, 'STU-y': { to: '' } }, { 'STU-p': 'STU-p', 'STU-q': '', 'STU-r': null }, 1);
  assert(Object.keys(log).length === 0, w + ': self-moves, blanks and junk are ignored — got ' + JSON.stringify(log));
  const big = {}; for (let i = 0; i < 30; i++) big['STU-old' + i] = 'STU-new' + i;
  log = M.record(null, big, 10);
  log = M.record(log, { 'STU-latest': 'STU-now' }, 20);
  log = M.record(log, {}, 30, 10);
  assert(Object.keys(log).length === 10 && M.toMap(log)['STU-latest'] === 'STU-now', w + ': capped to the newest entries, the newest kept');
  assert(Core.isSnapshotableKey(M.KEY) === false, w + ': the log never travels in the master snapshot');
  assert(Core.gate.DEVICE_KEYS.indexOf(M.KEY) !== -1, w + ': and is one of the gate\'s device keys');
});
const pc = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
assert((pc.match(/'cestisStudentIdMoves'/g) || []).length >= 2, 'the Centre network mirror and page-cloud keep it on the device');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(/relinked: gateIdMoves\(\)/.test(html), 'the publisher passes the kept moves to the slices');
assert(/CESTISStore\.setItem\(_mv\.KEY, JSON\.stringify\(_mv\.record\(_prev, res\.idMap, Date\.now\(\)\)\)\)/.test(html), 'cestisStabilizeStudentIds keeps each move it makes');
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
