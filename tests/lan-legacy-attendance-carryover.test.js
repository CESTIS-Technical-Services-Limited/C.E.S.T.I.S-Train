/* Old weekly attendance that ARRIVES from the Centre's server is carried into
   the dated register at once, not on some later page load.

   What happened (found by tests/browser/upgrade-no-data-loss.js, Offline
   System scenario): a Centre upgraded its offline server, and the first device
   to open the new build was a brand-new one. Its dashboard ran the carry-over
   of the old weekly rows (voctrain_attendance::<FY>_Q<n>) when the page
   loaded — when its storage was still empty — and the old rows only arrived a
   moment later, pulled from the server. Nothing ran the carry-over again, so
   all 585 old marks stayed out of the dated register and out of every
   attendance view on that device until the page happened to be reloaded; and
   if it was the only device (the office PC replaced, its browser cleared),
   the Centre saw no attendance history at all.

   Pinned here with the REAL functions from index.html (the LAN adoption
   adoptLanPull, scheduleAttendanceMigration, migrateLegacyAttendance) and the
   real cestis-core.js: old rows landing in storage from a pull are carried
   into the register, each mark with its status and its migratedFrom label,
   exactly once; a pull that brings nothing old schedules nothing.

   Run: node tests/lan-legacy-attendance-carryover.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');

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

function device() {
  const store = {};
  const timers = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    CESTISStore: {
      getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }, keys: () => Object.keys(store)
    },
    safeJsonParse: (v, d) => { try { return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    localDateStr: () => '2026-10-21',
    saveCollection: (k, v) => { store[k] = JSON.stringify(v); return true; },
    syncStudentAttendanceFromRegister: () => {},
    refreshStudentDependentViews: () => {}, refreshContentDependentViews: () => {},
    CESTIS_SHARED_COLLECTIONS: {}, LAN_COLLECTIONS: {},
    students: [], attendanceRegister: [], ATTENDANCE_REGISTER_KEY: 'voctrain_attendanceRegister',
    _attRegIdx: null, _attStudentsDirty: false,
    // Quarter separation is running on the dashboard (the plain key is a mirror).
    attnLoadedQuarter: { fy: '2026/2027', q: 3 }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(CORE_SRC, sb);
  vm.runInContext([
    'var _attMigrationTimer = null;',
    extractFunction(INDEX, 'scheduleAttendanceMigration'),
    extractFunction(INDEX, 'migrateLegacyAttendance'),
    extractFunction(INDEX, 'adoptLanPull')
  ].join('\n'), sb);
  sb.runTimers = () => { while (timers.length) timers.shift()(); };
  return { sb, store };
}

const ROWS = [
  { studentId: 'STU-a', studentName: 'Andre Brown', course: 'Welding & Fabrication', date: '2026-04-13',
    days: { Mon: 'present', Tue: 'late', Wed: 'absent', Thu: 'present', Fri: 'present' } },
  { studentId: 'STU-b', studentName: 'Kimani Clarke', course: 'Welding & Fabrication', date: '2026-04-13',
    days: { Mon: 'absent', Tue: 'present', Wed: 'present', Thu: 'late', Fri: 'present' } }
];

console.log('Old weekly rows pulled from the server are carried into the register');
{
  const { sb, store } = device();
  // The page loaded on an empty device: the carry-over found nothing.
  vm.runInContext('migrateLegacyAttendance()', sb);
  assertEq(sb.attendanceRegister.length, 0, 'a brand-new device has nothing to carry when the page loads');
  // The server's copy of the old Q1 register arrives.
  store['voctrain_attendance::2026/2027_Q1'] = JSON.stringify(ROWS);
  vm.runInContext("adoptLanPull(['voctrain_attendance::2026/2027_Q1'])", sb);
  sb.runTimers();
  const reg = sb.attendanceRegister;
  assertEq(reg.length, 10, 'every one of the ten old marks is now in the dated register');
  const want = {};
  ROWS.forEach(r => Object.keys(r.days).forEach(d => { want['voctrain_attendance::2026/2027_Q1|' + r.studentId + '|' + d + '|' + r.days[d]] = r.days[d]; }));
  assert(reg.every(r => r.migratedFrom && want[r.migratedFrom.ref] === r.status), 'each with its old status and labelled with the slot it came from');
  const saved = JSON.parse(store.voctrain_attendanceRegister || '[]');
  assertEq(saved.length, 10, 'and the register is saved (so it goes to the server and the other devices)');
  assertEq(JSON.parse(store['voctrain_attendance::2026/2027_Q1']).length, 2, 'the old rows stay exactly as they were, as the backup');

  // The same rows pulled again (the half-minute refresh) carry nothing twice.
  vm.runInContext("adoptLanPull(['voctrain_attendance::2026/2027_Q1'])", sb);
  sb.runTimers();
  assertEq(sb.attendanceRegister.length, 10, 'a second pull of the same rows adds nothing');
}

console.log('A pull with no old rows in it schedules nothing');
{
  const { sb } = device();
  let ran = 0;
  sb.migrateLegacyAttendance = () => { ran++; };
  vm.runInContext("adoptLanPull(['voctrain_exams', 'voctrain_attendanceRegister'])", sb);
  sb.runTimers();
  assertEq(ran, 0, 'only an old weekly register arriving starts the carry-over');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
