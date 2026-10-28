/* The signed-in trainee's own record follows the roll this page adopts.

   The dashboard keeps the signed-in trainee's record as an object taken from
   the roll (currentStudent), and the instructor's from the instructor list
   (currentInstructor). When another tab, an embedded page or the Centre's
   server changes the roll, the page adopts it (CESTIS_SHARED_COLLECTIONS) — as
   a NEW array of new objects. The trainee's reference kept pointing at the old
   object: certified on the office PC, a trainee went on reading "In Training —
   Certificate Not Yet Available" on their own device, although the roll it had
   just taken from the Centre's server said Certified and carried the
   certificate number. Found by the end-to-end flow test
   (tests/browser/lms-flows.js).

   The real CESTIS_SHARED_COLLECTIONS and cestisRepointSessionRecords() are
   taken from index.html.

   Run: node tests/session-record-follows-roll.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const MAP_SRC = (function () {
  const i = INDEX.indexOf('var CESTIS_SHARED_COLLECTIONS = {');
  if (i === -1) throw new Error('index.html no longer declares CESTIS_SHARED_COLLECTIONS');
  return INDEX.slice(i, INDEX.indexOf('\n};', i) + 3);
})();

function page() {
  const ctx = { console, JSON, Array, Object, String };
  vm.createContext(ctx);
  vm.runInContext('var students = [], instructorData = [], currentStudent = null, currentInstructor = null;\n' +
    extractFunction(INDEX, 'cestisRepointSessionRecords') + '\n' + MAP_SRC, ctx);
  return ctx;
}

console.log('A trainee signed in on their own device sees the roll the server just sent');
{
  const ctx = page();
  vm.runInContext('students = [{ id: "S-AMA", name: "Ama Mensah", stage: "training", certNo: null }, { id: "S-KOFI", name: "Kofi Boateng", stage: "training" }];' +
    'currentStudent = students[0];', ctx);
  const incoming = [{ id: 'S-KOFI', name: 'Kofi Boateng', stage: 'training' },
                    { id: 'S-AMA', name: 'Ama Mensah', stage: 'certified', certNo: 'WE-2026-8895-TN' }];
  ctx.CESTIS_SHARED_COLLECTIONS.voctrain_students(incoming);
  assert(vm.runInContext('students', ctx) === incoming, 'the adopted roll replaces the page\'s copy (as before)');
  assert(vm.runInContext('currentStudent', ctx) === incoming[1], 'the signed-in trainee\'s record is now the adopted one (it was the stale object)');
  assert(vm.runInContext('currentStudent.stage + " " + currentStudent.certNo', ctx) === 'certified WE-2026-8895-TN', 'so their certificate shows');
}

console.log('A roll without the trainee leaves their session as it was');
{
  const ctx = page();
  vm.runInContext('students = [{ id: "S-AMA", stage: "training" }]; currentStudent = students[0];', ctx);
  const before = vm.runInContext('currentStudent', ctx);
  ctx.CESTIS_SHARED_COLLECTIONS.voctrain_students([{ id: 'S-OTHER', stage: 'training' }]);
  assert(vm.runInContext('currentStudent', ctx) === before, 'no record of theirs: the session keeps the one it has');
}

console.log('An instructor\'s record follows the instructor list in the same way');
{
  const ctx = page();
  vm.runInContext('instructorData = [{ id: "INS-1", name: "Ian", course: "Welding & Fabrication" }]; currentInstructor = instructorData[0];', ctx);
  const incoming = [{ id: 'INS-1', name: 'Ian', course: 'Welding & Fabrication', phone: '555' }];
  ctx.CESTIS_SHARED_COLLECTIONS.voctrain_instructorData(incoming);
  assert(vm.runInContext('currentInstructor', ctx) === incoming[0], 'the instructor\'s record is the adopted one');
}

console.log('Nobody signed in: adopting a roll is harmless');
{
  const ctx = page();
  ctx.CESTIS_SHARED_COLLECTIONS.voctrain_students([{ id: 'S-1' }]);
  assert(vm.runInContext('currentStudent', ctx) === null, 'still nobody');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
