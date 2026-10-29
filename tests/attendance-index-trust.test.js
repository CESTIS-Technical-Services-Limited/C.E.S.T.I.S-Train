/* A new attendance mark no longer reads the whole register — and never
   becomes a duplicate.

   What went wrong (EF-10 in the efficiency audit): CESTISCore.attendance.mark
   looked a mark up in the page's index, and when the index did not hold it,
   read the whole register to be sure it was new: 3.4 ms per new mark at
   5,000 marks, 19.5 ms at a school year's 48,000, 48.7 ms at 96,000.

   The index (attendance.indexOf) now notes the register it was built from and
   how many records it held, and mark() keeps both in step when it adds a mark.
   While they match, the index covers every record and an id it does not hold
   is new. Anything else that adds to the register, or replaces it, makes them
   differ, and the register is read as before.

   Pinned here, for both builds:
     - with a whole index: every new mark is added once, an existing one is
       changed in place (never duplicated), and no record is read in full;
     - a record added to the register by other code (the index no longer
       whole): a mark for it changes that record, it is not added twice;
     - an index built for another array, or a plain object: read as before;
     - the index notes are not enumerable (nothing that walks it sees them);
     - in the dashboard, the register is only ever added to by mark() or
       replaced whole, so the index it hands mark() is whole when used.

   Run: node tests/attendance-index-trust.test.js */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const BUILDS = [
  { where: 'cestis-core.js', core: require('../cestis-core.js'), page: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') },
  { where: 'Offline System/cestis-core.js', core: require('../Offline System/cestis-core.js'), page: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8') }
];
const day = i => new Date(Date.UTC(2025, 8, 1) + i * 86400000).toISOString().slice(0, 10);
function register(n) {
  const reg = [];
  for (let i = 0; i < n; i++) {
    const sid = 'STU-' + (i % 300), date = day(Math.floor(i / 300));
    reg.push({ id: 'ATT|' + sid + '|' + date, studentId: sid, date, status: 'present', markedAt: '2025-09-01T15:00:00Z', markedBy: 'x' });
  }
  return reg;
}
const count = (reg, sid, date) => reg.filter(r => r.studentId === sid && r.date === date).length;

for (const B of BUILDS) {
  const A = B.core.attendance, w = B.where;
  console.log('A whole index is trusted (' + w + ')');
  {
    const reg = register(48000);
    const idx = A.indexOf(reg);
    assertEq(Object.keys(idx).filter(k => k.indexOf('__') === 0), [], w + ': the index\'s notes are not enumerable');
    assert(idx.__reg === reg && idx.__n === 48000, w + ': it notes its register and how many records it held');
    // Count every full read of a record's key during the new marks.
    let reads = 0;
    const orig = reg.slice();
    const watched = new Proxy(reg, { get(t, p, r) { if (typeof p === 'string' && /^\d+$/.test(p)) reads++; return Reflect.get(t, p, r); } });
    idx.__reg = watched;
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 30; k++) A.mark(watched, { studentId: 'STU-' + k, date: '2027-01-0' + (1 + k % 9), status: 'present', by: 'x' }, idx);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert(reads < 200, w + ': 30 new marks read ' + reads + ' records, not the whole register (48,000)');
    assert(ms < 50, w + ': and take ' + ms.toFixed(1) + ' ms (they took ~600 ms)');
    assertEq(reg.length, 48030, w + ': each new mark is added once');
    assertEq(idx.__n, 48030, w + ': and the index keeps count');
    // An existing mark, with the index whole: changed in place, not added.
    const r1 = A.mark(reg, { studentId: 'STU-5', date: day(3), status: 'absent', by: 'y' }, Object.assign(idx, { __reg: reg }) && idx);
    assert(r1.changed && reg.length === 48030 && count(reg, 'STU-5', day(3)) === 1 && reg.find(r => r.studentId === 'STU-5' && r.date === day(3)).status === 'absent',
      w + ': an existing mark is changed where it is, never duplicated');
    void orig;
  }

  console.log('A register changed by other code is read as before (' + w + ')');
  {
    const reg = register(3000);
    const idx = A.indexOf(reg);
    // Another piece of code adds a record without the index (a merge, a carry-over).
    reg.push({ id: 'ATT|STU-NEW|2026-02-02', studentId: 'STU-NEW', date: '2026-02-02', status: 'late', markedAt: '2026-02-02T15:00:00Z', markedBy: 'z' });
    const r = A.mark(reg, { studentId: 'STU-NEW', date: '2026-02-02', status: 'present', by: 'x' }, idx);
    assert(r.changed && count(reg, 'STU-NEW', '2026-02-02') === 1 && reg.length === 3001, w + ': a mark for a record the index never saw changes that record — no duplicate');
    // An index built for another array.
    const other = A.indexOf(register(10));
    const reg2 = register(600);
    A.mark(reg2, { studentId: 'STU-7', date: day(1), status: 'absent', by: 'x' }, other);
    assertEq(count(reg2, 'STU-7', day(1)), 1, w + ': an index built for another register: read as before, no duplicate');
    // A plain object as the index (as callers made before).
    const plain = {};
    const reg3 = register(600);
    A.mark(reg3, { studentId: 'STU-8', date: day(1), status: 'late', by: 'x' }, plain);
    assertEq(count(reg3, 'STU-8', day(1)), 1, w + ': a plain index object: read as before, no duplicate');
    // No index at all.
    const reg4 = register(600);
    A.mark(reg4, { studentId: 'STU-9', date: day(0), status: 'late', by: 'x' });
    assertEq(count(reg4, 'STU-9', day(0)), 1, w + ': no index: as before');
    // Many marks in a row, mixed new and existing, with one whole index: none lost, none doubled.
    const reg5 = register(1200), idx5 = A.indexOf(reg5);
    for (let k = 0; k < 400; k++) A.mark(reg5, { studentId: 'STU-' + (k % 350), date: day(k % 7), status: k % 3 ? 'present' : 'absent', by: 'x' }, idx5);
    const keys = reg5.map(r => r.studentId + '|' + r.date);
    assertEq(keys.length, new Set(keys).size, w + ': 400 marks in a row: no record twice');
    assert(['STU-349|' + day(349 % 7)].every(k => keys.indexOf(k) !== -1), w + ': and the new ones are there');
  }

  console.log('The dashboard only adds through mark() or replaces the register (' + w + ')');
  {
    const src = B.page;
    assert(!/attendanceRegister\.(push|splice|pop|shift|unshift)\(/.test(src) && !/attendanceRegister\.length\s*=[^=]/.test(src),
      w.replace('cestis-core.js', 'index.html') + ': nothing adds to or removes from the register in place except mark()');
    assert(/_attRegIdxFor === attendanceRegister && _attRegIdxLen === attendanceRegister\.length/.test(src) && /_attRegIdx = CESTISCore\.attendance\.indexOf\(attendanceRegister\);/.test(src),
      w.replace('cestis-core.js', 'index.html') + ': and its index is rebuilt from the whole register whenever that is replaced');
  }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
