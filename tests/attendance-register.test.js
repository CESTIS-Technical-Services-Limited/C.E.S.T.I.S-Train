/* The attendance register keeps every day, for the whole course.

   It used to keep ONE Mon–Fri row per trainee per quarter. Marking a Monday
   wrote r.days.Mon, so the second week's Monday overwrote the first week's:
   a thirteen-week quarter kept the last state of five cells, and the Date
   picker could only switch quarter. Around that, the copies on different
   devices never converged (a changed mark never propagated, and the
   duplicate fold let "present" beat any correction), another document's
   roster was adopted wholesale over this quarter's, the backup carried only
   the quarter on screen, the lock found a centre by NAME, and an unmarked
   day counted as an absence.

   What these tests pin:
     - one record per trainee per local date (Jamaica, never a UTC stamp),
       with who marked it and when, and the earlier values in its history;
     - the carry-over of the old weekly rows: every slot of a fixture of real
       shapes ends up dated (or filed beside a mark already on that date),
       labelled as an estimate, the old keys untouched, never twice — not on
       this device, not when two devices upgrade on different days;
     - the merge: mark by mark, newest wins, a real mark beats an estimate,
       nothing dropped, the same result whichever side merges;
     - one rate rule for every view: present + late over sessions HELD;
     - the real page functions: a mark writes its date only, the week shown
       is the week picked, "mark all present" leaves marks alone, marks reach
       the device store within a second, the lock follows the trainee's own
       intake, the admin-staff view lists everyone, a trainee's device keeps
       only their own marks, the backup carries every mark, another
       document's copy is merged and never adopted wholesale;
     - live classes are only ever suggestions, and a shared name is flagged.

   Run: node tests/attendance-register.test.js */
'use strict';

// The Centre's own clock. Set before anything reads a date.
process.env.TZ = 'America/Jamaica';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BUILDS = [
  { where: 'index.html', src: read('index.html'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: read('Offline System/index.html'), core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where, indented) {
  const m = new RegExp('\\n' + (indented ? '[ \\t]*' : '') + '(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error((where || '') + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function section(src, startMarker, endMarker, where) {
  const a = src.indexOf(startMarker), b = src.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error(where + ': cannot find ' + startMarker.slice(0, 60));
  return src.slice(a, b);
}

/* =====================================================================
   1. The model (pure, in the shared core)
   ===================================================================== */
BUILDS.forEach(function (B) {
  const A = B.core.attendance;
  const tag = ' (' + B.where.replace('/index.html', '') + ')';
  console.log('One record per trainee per date' + tag);

  assertEq(A.weekDates('2026-10-21'), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
    'a Wednesday shows its own Mon–Fri week');
  assertEq(A.weekStart('2026-10-25'), '2026-10-19', 'a Sunday belongs to the week just finished');
  assertEq(A.quarterBounds('2026/2027', 4), { start: '2027-01-01', end: '2027-03-31' }, 'Q4 is Jan–Mar of the second year');
  assertEq(A.quarterBounds('2026/2027', 2), { start: '2026-07-01', end: '2026-09-30' }, 'Q2 is Jul–Sep');
  // 8:30 pm on 30 September in Jamaica is already 1 October in UTC.
  const evening = new Date('2026-10-01T01:30:00Z');
  assertEq(A.localDate(evening), '2026-09-30', 'an evening mark is dated the Centre\'s day, not UTC\'s (attendance-20)');
  assert(evening.toISOString().slice(0, 10) === '2026-10-01', '(the UTC stamp would have said 1 October — the next quarter)');

  const reg = [];
  A.mark(reg, { studentId: 'S1', date: '2026-10-05', status: 'present', by: 'INS-1', at: '2026-10-05T14:00:00Z' });
  A.mark(reg, { studentId: 'S1', date: '2026-10-12', status: 'absent', by: 'INS-1', at: '2026-10-12T14:00:00Z' });
  assertEq(reg.length, 2, 'two Mondays are two records — week 2 no longer overwrites week 1 (attendance-02)');
  assertEq(reg[0].id, 'ATT|S1|2026-10-05', 'the id names the trainee and the date');
  assertEq(A.summarize(reg).pct, 50, 'and the rate over them is 50%');
  const r2 = A.mark(reg, { studentId: 'S1', date: '2026-10-12', status: 'excused', by: 'ADM', at: '2026-10-13T10:00:00Z' });
  assert(r2.changed && reg.length === 2, 'correcting a day replaces that record, it does not add one');
  assertEq(reg[1].history && reg[1].history.map(h => h.status), ['absent'], 'and what it said before is kept in its history');
  assertEq(reg[1].markedBy, 'ADM', 'with who changed it');
  const same = A.mark(reg, { studentId: 'S1', date: '2026-10-12', status: 'excused', by: 'ADM' });
  assert(!same.changed, 'marking the same value again changes nothing');
  // A clock that ran ahead elsewhere cannot make a fresh edit lose.
  const ahead = [{ id: 'ATT|S2|2026-10-05', studentId: 'S2', date: '2026-10-05', status: 'absent', markedAt: '2030-01-01T00:00:00Z' }];
  A.mark(ahead, { studentId: 'S2', date: '2026-10-05', status: 'present', at: '2026-10-06T00:00:00Z' });
  assert(Date.parse(ahead[0].markedAt) > Date.parse('2030-01-01T00:00:00Z'), 'an edit is always stamped after the mark it replaces');

  console.log('One rate rule: attended over sessions held' + tag);
  const s = A.summarize([{ status: 'present' }, { status: 'late' }, { status: 'absent' }, { status: 'excused' },
    { status: 'noclass' }, { status: '' }, { status: 'absent', unconfirmed: true }]);
  assertEq([s.held, s.attended, s.pct], [3, 2, 67], 'present + late over present + late + absent (attendance-10/14)');
  assertEq([s.excused, s.noclass, s.unmarked, s.unconfirmed], [1, 1, 1, 1], 'excused, no-class, unmarked and unconfirmed are counted apart, not as absences');
  assertEq(A.summarize([{ status: 'noclass' }, { status: '' }]).pct, null, 'nothing held is "no attendance taken", never 0%');
  assertEq(A.summarize([{ status: 'late' }, { status: 'late' }]).pct, 100, 'a class that all came late attended');
  assertEq(A.summarizeDays({ Mon: 'present', Tue: 'late', Wed: 'absent' }).pct, 67, 'the old weekly rows are read by the same rule');

  /* ---------- merge ---------- */
  console.log('Copies merge mark by mark, newest wins, nothing dropped' + tag);
  const local = [
    { studentId: 'ALICE', date: '2026-10-12', status: 'absent', markedAt: '2026-10-12T15:00:00Z', markedBy: 'B' },
    { studentId: 'BOB', date: '2026-10-12', status: 'present', markedAt: '2026-10-12T14:00:00Z', markedBy: 'B' },
    { studentId: 'CARL', date: '2026-10-13', status: 'late', markedAt: '2026-10-13T14:00:00Z', markedBy: 'B' }
  ];
  const cloud = [
    { studentId: 'ALICE', date: '2026-10-12', status: 'present', markedAt: '2026-10-12T16:00:00Z', markedBy: 'A' },
    { studentId: 'BOB', date: '2026-10-12', status: 'absent', markedAt: '2026-10-12T13:00:00Z', markedBy: 'A' },
    { studentId: 'DORA', date: '2026-10-12', status: 'present', markedAt: '2026-10-12T14:00:00Z', markedBy: 'A' }
  ];
  const m1 = A.mergeRegister(JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(cloud)));
  const get = (list, sid, d) => list.find(r => r.studentId === sid && r.date === d);
  assertEq(get(m1.register, 'ALICE', '2026-10-12').status, 'present', 'a newer mark from another device is taken (attendance-04: it never was)');
  assertEq(get(m1.register, 'BOB', '2026-10-12').status, 'present', 'an older one is not — whatever its value');
  assert(get(m1.register, 'BOB', '2026-10-12').history.some(h => h.status === 'absent'), 'and the losing value is kept in history');
  assertEq(m1.register.length, 4, 'nothing either side holds is dropped');
  const m2 = A.mergeRegister(JSON.parse(JSON.stringify(cloud)), JSON.parse(JSON.stringify(local)));
  const norm = l => JSON.stringify(l.map(r => [r.id, r.status, r.markedAt, (r.history || []).map(h => h.status + h.markedAt)]).sort());
  assertEq(norm(m2.register), norm(m1.register), 'and both devices end with the same register, whichever merges');
  const again = A.mergeRegister(m1.register, m2.register);
  assert(!again.changed, 'merging what is already merged changes nothing (no endless re-upload)');
  const corr = A.mergeRegister([{ studentId: 'BOB', date: '2026-10-12', status: 'present', markedAt: '2026-10-12T14:00:00Z' }],
    [{ studentId: 'BOB', date: '2026-10-12', status: 'absent', markedAt: '2026-10-12T18:00:00Z' }]);
  assertEq(corr.register[0].status, 'absent', 'a correction to absent survives — "present always wins" is gone');
  const refused = A.mergeRegister([], cloud, { accept: r => r.studentId !== 'DORA' });
  assert(!refused.register.some(r => r.studentId === 'DORA'), 'a merge can refuse a deleted trainee\'s marks');

  /* ---------- carry-over of the old weekly rows ---------- */
  console.log('Every old weekly mark is carried over, dated, labelled, once' + tag);
  const fixture = {
    // Q2 (Jul–Sep), already over: marks were the last state of that quarter.
    'voctrain_attendance::2026/2027_Q2': [
      { studentId: 'S1', studentName: 'Ann', course: 'Welding', date: '2026-07-01', days: { Mon: 'present', Tue: 'late', Wed: 'absent', Thu: 'present', Fri: 'present' } },
      { studentId: 'S2', studentName: 'Ben', course: 'Welding', date: '2026-07-01', days: { Mon: 'absent', Tue: 'absent', Wed: 'absent', Thu: 'absent', Fri: 'absent' } },
      { studentId: 'S3', studentName: 'Cy', course: 'Welding', date: '2026-07-01', days: { Mon: 'present' } },
      { studentId: 'S4', date: '2026-07-01' },                       // no day map
      null
    ],
    // Q3, the current quarter (upgrade on Wed 21 Oct 2026).
    'voctrain_attendance::2026/2027_Q3': [
      { studentId: 'S1', studentName: 'Ann', course: 'Welding', date: '2026-04-02', days: { Mon: 'present', Tue: 'present', Wed: 'late', Thu: 'absent', Fri: 'present' } },
      { studentId: 'S5', studentName: 'Dee', course: 'Plumbing', date: '2026-10-01', days: { Mon: 'absent', Tue: 'present', Wed: '', Thu: 'present', Fri: 'excused' } },
      { studentId: 'S6', studentName: 'Eve', course: 'Plumbing', date: '2026-10-01', days: {} }
    ]
  };
  const before = JSON.stringify(fixture);
  const register = [
    // Dee already has a real mark on Tue 20 Oct: it stands.
    { id: 'ATT|S5|2026-10-20', studentId: 'S5', date: '2026-10-20', status: 'absent', markedAt: '2026-10-20T15:00:00Z', markedBy: 'INS' }
  ];
  const AT = '2026-10-21T16:00:00.000Z';
  const reports = Object.keys(fixture).map(k => {
    const m = /::(\d{4}\/\d{4})_Q(\d)$/.exec(k);
    return A.migrateLegacy(register, fixture[k], { key: k, fy: m[1], q: +m[2], today: '2026-10-21', at: AT });
  });
  assertEq(JSON.stringify(fixture), before, 'the old rows are only read — the legacy keys stay exactly as they were');
  // Zero marks lost: every non-empty old slot is in the register, as a record
  // or (where that trainee was already marked that day) in that record's history.
  const refs = A.refsIn(register);
  let slots = 0, missing = [];
  Object.keys(fixture).forEach(k => (fixture[k] || []).forEach(row => {
    if (!row || !row.days) return;
    A.DAYS.forEach(d => {
      const v = A.normStatus(row.days[d]);
      if (!v) return;
      slots++;
      if (!refs[k + '|' + row.studentId + '|' + d + '|' + v]) missing.push(k + ' ' + row.studentId + ' ' + d);
    });
  }));
  assertEq(missing, [], 'every one of the ' + slots + ' old marks is in the register — none lost');
  assertEq(reports.reduce((a, r) => a + r.migrated + r.keptInHistory, 0), slots, 'and the report accounts for every one');
  assertEq(reports[0].skippedRows, 1, 'a row with no day map is reported, not silently passed over');
  const ann = register.filter(r => r.studentId === 'S1' && r.migratedFrom && r.migratedFrom.key.endsWith('Q2'));
  assertEq(ann.map(r => r.date).sort(), ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'],
    'a finished quarter\'s marks are dated in its last week');
  assert(ann.every(r => r.migratedFrom.basis === 'last-week-of-the-quarter' && r.markedBy === 'upgrade'),
    'and say so: the date is labelled an estimate, by the upgrade');
  const annQ3 = register.filter(r => r.studentId === 'S1' && r.migratedFrom && r.migratedFrom.key.endsWith('Q3'));
  assertEq(annQ3.map(r => r.date).sort(), ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'],
    'the current quarter\'s marks are dated on the most recent such weekday up to the upgrade');
  const ben = register.filter(r => r.studentId === 'S2');
  assert(ben.length === 5 && ben.every(r => r.unconfirmed), 'a row still all "absent" (the creation default) is carried over as UNCONFIRMED');
  assertEq(A.summarize(ben).pct, null, '— kept and shown, but not counted until someone confirms it');
  const dee = register.find(r => r.id === 'ATT|S5|2026-10-20');
  assertEq(dee.status, 'absent', 'a real mark already on that date is never overwritten by the carry-over');
  assert(dee.history.some(h => h.migratedFrom && h.status === 'present' && h.notApplied), 'the old value is filed beside it, marked as not applied');
  assert(!register.some(r => r.studentId === 'S6'), 'an empty old row adds nothing');
  const n0 = register.length;
  Object.keys(fixture).forEach(k => {
    const m = /::(\d{4}\/\d{4})_Q(\d)$/.exec(k);
    A.migrateLegacy(register, fixture[k], { key: k, fy: m[1], q: +m[2], today: '2026-11-04', at: '2026-11-04T16:00:00Z' });
  });
  assertEq(register.length, n0, 'running it again, even weeks later, carries nothing a second time');
  // A row made after the register went dated holds only its creation default.
  const late = A.migrateLegacy(register, [{ studentId: 'S9', date: '2026-10-21', days: { Mon: 'absent', Tue: 'absent', Wed: 'absent', Thu: 'absent', Fri: 'absent' } }],
    { key: 'voctrain_attendance::2026/2027_Q3', fy: '2026/2027', q: 3, today: '2026-10-22', since: A.firstUpgradeDay(register) });
  assertEq([late.migrated, late.defaultRowsSkipped], [0, 1], 'a roster row created since the upgrade is not read as five absences');

  console.log('Two devices that upgrade on different days still agree' + tag);
  const rowsA = [{ studentId: 'T1', date: '2026-10-01', days: { Mon: 'present', Fri: 'late' } }];
  const devA = [], devB = [];
  A.migrateLegacy(devA, rowsA, { key: 'voctrain_attendance::2026/2027_Q3', fy: '2026/2027', q: 3, today: '2026-10-21', at: '2026-10-21T12:00:00Z' });
  A.migrateLegacy(devB, rowsA, { key: 'voctrain_attendance::2026/2027_Q3', fy: '2026/2027', q: 3, today: '2026-10-27', at: '2026-10-27T12:00:00Z' });
  // Meanwhile on device B an instructor marks Monday 26 Oct for real.
  A.mark(devB, { studentId: 'T1', date: '2026-10-26', status: 'absent', by: 'INS', at: '2026-10-27T13:00:00Z' });
  const ab = A.mergeRegister(devA, devB), ba = A.mergeRegister(devB, devA);
  assertEq(norm(ab.register), norm(ba.register), 'both orders give the same register');
  const t1 = ab.register.filter(r => r.studentId === 'T1');
  assertEq(t1.filter(r => r.migratedFrom).map(r => r.date).sort(), ['2026-10-16', '2026-10-19'],
    'the FIRST carry-over stands; the later duplicate estimate is dropped (it held nothing new)');
  assert(t1.some(r => r.date === '2026-10-26' && r.status === 'absent' && !r.migratedFrom), 'a real mark is never dropped');
  const realVsGuess = A.mergeRegister(
    [{ studentId: 'T2', date: '2026-10-19', status: 'present', markedAt: '2026-10-19T14:00:00Z', markedBy: 'INS' }],
    [{ studentId: 'T2', date: '2026-10-19', status: 'absent', markedAt: '2026-10-21T14:00:00Z', markedBy: 'upgrade', migratedFrom: { ref: 'x', at: '2026-10-21T14:00:00Z' } }]);
  assertEq(realVsGuess.register[0].status, 'present', 'an instructor\'s mark beats a later upgrade estimate for the same day');

  console.log('Marks follow a re-identified trainee' + tag);
  const rl = A.relink([{ studentId: 'OLD', date: '2026-10-19', status: 'present', markedAt: '2026-10-19T14:00:00Z' },
    { studentId: 'NEW', date: '2026-10-19', status: 'absent', markedAt: '2026-10-19T15:00:00Z' }], { OLD: 'NEW' });
  assert(rl.changed && rl.register.length === 1 && rl.register[0].id === 'ATT|NEW|2026-10-19' && rl.register[0].status === 'absent',
    'two marks for one cell fold newest-wins under the new id');
  const dep = { attendanceRegister: [{ studentId: 'OLD', date: '2026-10-20', status: 'late', markedAt: '2026-10-20T14:00:00Z' }] };
  B.core.relinkDependentData({ OLD: 'NEW' }, dep);
  assertEq(dep.attendanceRegister[0].id, 'ATT|NEW|2026-10-20', 'the shared relink carries the register too');

  console.log('The master snapshot merges the register mark by mark' + tag);
  const snapReg = [{ id: 'ATT|S1|2026-08-03', studentId: 'S1', date: '2026-08-03', status: 'absent', markedAt: '2026-08-10T10:00:00Z' }];
  const locReg = [{ id: 'ATT|S1|2026-08-03', studentId: 'S1', date: '2026-08-03', status: 'present', markedAt: '2026-08-03T10:00:00Z' },
    { id: 'ATT|S1|2026-08-04', studentId: 'S1', date: '2026-08-04', status: 'present', markedAt: '2026-08-04T10:00:00Z' }];
  const rec = B.core.reconcileSnapshot({ store: { voctrain_attendanceRegister: JSON.stringify(snapReg),
    'voctrain_attendance::2026/2027_Q2': JSON.stringify([{ studentId: 'S1' }, { studentId: 'S7' }]) } },
    { voctrain_attendanceRegister: JSON.stringify(locReg), 'voctrain_attendance::2026/2027_Q2': JSON.stringify([{ studentId: 'S1', days: { Mon: 'present' } }]) });
  const outReg = JSON.parse(rec.store.voctrain_attendanceRegister);
  assertEq(outReg.find(r => r.date === '2026-08-03').status, 'absent', 'another device\'s later correction is taken from the master (it used to be fill-only)');
  assert(outReg.length === 2, 'and this device\'s own marks stay');
  const outBucket = JSON.parse(rec.store['voctrain_attendance::2026/2027_Q2']);
  assert(outBucket.length === 2 && outBucket[0].days.Mon === 'present', 'an old roster gets back a row it lacked, its own rows untouched');

  console.log('The Centre\'s own server merges the register by its rule' + tag);
  const lan = B.core.pageCloud.mergeKeys(
    { voctrain_attendanceRegister: JSON.stringify([{ studentId: 'Z', date: '2026-10-19', status: 'present', markedAt: '2026-10-19T14:00:00Z' }]) },
    { voctrain_attendanceRegister: '2026-10-19T14:00:00Z' },
    { voctrain_attendanceRegister: JSON.stringify([{ studentId: 'Z', date: '2026-10-19', status: 'absent', markedAt: '2026-10-21T14:00:00Z', migratedFrom: { ref: 'r', at: '2026-10-21T14:00:00Z' } },
      { studentId: 'Y', date: '2026-10-19', status: 'late', markedAt: '2026-10-19T14:00:00Z' }]) },
    { voctrain_attendanceRegister: '2026-10-21T14:00:00Z' }, { records: true });
  const lanReg = JSON.parse(lan.data.voctrain_attendanceRegister);
  assert(lanReg.length === 2 && lanReg.find(r => r.studentId === 'Z').status === 'present',
    'two machines\' registers are merged mark by mark — the newer whole list does not win');

  console.log('Live classes are suggestions; a shared name is never guessed' + tag);
  const roster = [{ id: 'S1', name: 'Ann Lee' }, { id: 'S2', name: 'John Brown' }, { id: 'S3', name: 'John Brown' }, { id: 'S4', name: 'Kim Day' }];
  const sess = (id, start, end, parts) => ({ id: id, startedAt: start, endedAt: end, updatedAt: end, participants: parts });
  const stay = (j, l) => ({ joined: j, left: l });
  const sug = A.suggestFromLive([
    sess('vcs-A', '2026-10-20T14:00:00Z', '2026-10-20T15:00:00Z', [
      { pid: 'p1', name: 'ann lee', stays: [stay('2026-10-20T14:00:00Z', '2026-10-20T14:10:00Z')] },
      { pid: 'p2', name: 'John Brown', stays: [stay('2026-10-20T14:00:00Z', '2026-10-20T15:00:00Z')] },
      { pid: 'p3', name: 'Mr Teacher', role: 'instructor', stays: [stay('2026-10-20T14:00:00Z', '')] },
      { pid: 'p4', name: 'Stranger', stays: [stay('2026-10-20T14:00:00Z', '')] }]),
    // The same class seen by a second device: Ann stayed longer than the first saw.
    sess('vcs-B', '2026-10-20T14:01:00Z', '2026-10-20T15:00:00Z', [
      { pid: 'q1', name: 'Ann Lee', stays: [stay('2026-10-20T14:01:00Z', '2026-10-20T14:45:00Z')] }])
  ], roster);
  const annS = sug.joined.find(j => j.studentId === 'S1');
  assert(annS && annS.minutes === 44 && annS.suggested === 'present', 'one trainee seen by two devices counts once, with the longest time');
  assert(!sug.joined.some(j => j.studentId === 'S2' || j.studentId === 'S3') && sug.unmatched.some(u => u.name === 'John Brown' && u.reason === 'ambiguous'),
    'two trainees named John Brown: flagged, not guessed (vc-14)');
  assert(!sug.unmatched.some(u => u.name === 'Mr Teacher'), 'staff in the room are not trainees');
  assert(sug.unmatched.some(u => u.name === 'Stranger' && u.reason === 'not-on-roster'), 'a name not on the register is shown, not dropped');
  assertEq(sug.absent.map(a => a.studentId).sort(), ['S2', 'S3', 'S4'], 'those not seen are offered as absent — for the instructor to decide');
  const partial = A.suggestFromLive([sess('vcs-C', '2026-10-20T14:00:00Z', '2026-10-20T16:00:00Z', [
    { pid: 'k', name: 'Kim Day', stays: [stay('2026-10-20T15:50:00Z', '2026-10-20T16:00:00Z')] }])], roster);
  assertEq(partial.joined[0].suggested, 'late', 'ten minutes of a two-hour class is suggested as late, not present');

  console.log('The register as a spreadsheet' + tag);
  const csv = A.registerCsv([{ id: 'S1', name: '=HYPERLINK("x")', course: 'Weld, L2' }],
    [{ studentId: 'S1', date: '2026-10-19', status: 'present' }, { studentId: 'S1', date: '2026-10-20', status: 'absent' }], '2026-10-01', '2026-12-31');
  const lines = csv.split('\n');
  assert(lines[0].indexOf('2026-10-19') !== -1 && lines[0].indexOf('2026-10-20') !== -1, 'one column per date marked (attendance-22)');
  assert(lines[1].indexOf('"\'=HYPERLINK(""x"")"') === 0, 'a name that looks like a formula is exported as text');
  assert(lines[1].indexOf('"Weld, L2"') !== -1 && /,50$/.test(lines[1]), 'cells are quoted where needed, and the rate is the one rule');

  console.log('Who is on the register for a week' + tag);
  assert(A.onRegister({ stage: 'training' }, { startDate: '2026-09-01', endDate: '2027-06-30' }, '2026-10-19', '2026-10-23'), 'a running intake is on it');
  assert(!A.onRegister({ stage: 'certified' }, { startDate: '2025-09-01', endDate: '2026-06-30' }, '2026-10-19', '2026-10-23'),
    'a finished intake is not (attendance-13: every graduate used to be five absences)');
  assert(!A.onRegister({ stage: 'certified' }, null, '2026-10-19', '2026-10-23'), 'a graduate with no dates is not');
  assert(A.onRegister({ stage: 'testing' }, null, '2026-10-19', '2026-10-23'), 'a trainee with no dates and no finished stage still is — nobody vanishes');
});

/* =====================================================================
   2. The real page functions
   ===================================================================== */
function makeStore(init) {
  const data = Object.assign({}, init || {});
  return {
    writes: 0, _data: data,
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { this.writes++; data[k] = String(v); },
    removeItem(k) { delete data[k]; },
    keys() { return Object.keys(data); },
    get length() { return Object.keys(data).length; },
    key(i) { return Object.keys(data)[i]; }
  };
}
function makeEl(id) {
  return {
    id: id, innerHTML: '', textContent: '', value: '', className: '', title: '', checked: false, style: {}, readOnly: false,
    children: [], appendChild(c) { this.children.push(c); return c; }, insertBefore() {}, remove() {},
    setAttribute(n, v) { this['_' + n] = v; }, getAttribute(n) { return this['_' + n] != null ? this['_' + n] : null; },
    addEventListener() {}, contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; }
  };
}
function makePage(B, opts) {
  opts = opts || {};
  const els = {};
  const timers = [];
  const toasts = [];
  const store = makeStore(opts.store);
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Math, Date, Object, Array, String, Number, Map, Set, RegExp, parseInt, parseFloat, isNaN,
    CESTISCore: B.core, CESTISStore: store,
    document: {
      getElementById(id) { if (opts.missing && opts.missing.indexOf(id) !== -1) return null; return els[id] = els[id] || makeEl(id); },
      querySelectorAll() { return []; }, createElement() { return makeEl(''); }, activeElement: null,
      body: makeEl('body'), addEventListener() {}
    },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    showToast(m) { toasts.push(m); }, addNotification() {}, refreshStudentDependentViews() {}, saveState() { sb.saveStateCalls = (sb.saveStateCalls || 0) + 1; },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    students: opts.students || [], attendanceRecords: opts.rows || [], attendanceRegister: opts.register || [], vcSessions: opts.vcSessions || [],
    skillAreas: opts.skillAreas || [], currentRole: opts.role || 'instructor', currentLoggedInUser: { id: 'USR-9', name: 'Ms Instructor' },
    currentInstructor: opts.instructor || null, currentAttendanceDate: '',
    instructorCourseMatch: (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase(),
    _getDeletedStudentIds: () => opts.deleted || {}
  };
  sb.escapeAttr = sb.escapeHtml;
  sb.window = sb;
  vm.createContext(sb);
  const src = B.src;
  ['localDateStr', 'safeJsonParse', 'saveCollection', 'studentCentreRecord', 'courseDurationRecord', 'studentCourseStatus',
   'renderAsAttendance', 'cmcBuildAttendanceDetail', 'clearSensitiveStudentData', 'attendanceInstructorFilter', 'renderInstructorAttendance', 'saveInstructorAttendance']
    .forEach(n => vm.runInContext(extractFunction(src, n, B.where), sb));
  vm.runInContext(section(src, '/* ============================== ATTENDANCE — PER-QUARTER SEPARATION', '\nfunction initAttendanceQuarters(', B.where), sb);
  vm.runInContext(section(src, '/* ============================== ATTENDANCE REGISTER — ONE MARK PER DATE', '\nfunction toggleAnnouncementForm(', B.where), sb);
  vm.runInContext('var _attInstructorCfg = ' + /var _attInstructorCfg = (\{[\s\S]*?\});/.exec(src)[1] + ';', sb);
  vm.runInContext('var ATTENDANCE_REGISTER_KEY = "voctrain_attendanceRegister";', sb);
  sb._els = els; sb._timers = timers; sb._toasts = toasts; sb._store = store;
  sb._runTimers = () => { while (timers.length) timers.shift()(); };
  return sb;
}

BUILDS.forEach(function (B) {
  const A = B.core.attendance;
  const tag = ' (' + B.where.replace('/index.html', '') + ')';
  const today = A.localDate();
  const week = A.weekDates(today);

  console.log('A mark writes its own date, and the week shown is the week picked' + tag);
  {
    const page = makePage(B, { students: [{ id: 'S1', name: 'Ann', course: 'Welding', stage: 'training' }], role: 'admin' });
    vm.runInContext('onAttendanceDateChange("2026-10-05")', page);
    const sel = page.document.getElementById('cell');
    sel.setAttribute('data-sid', 'S1'); sel.setAttribute('data-date', '2026-10-05'); sel.value = 'present';
    vm.runInContext('updateAttendanceCell(sel)', Object.assign(page, { sel }));
    vm.runInContext('onAttendanceDateChange("2026-10-12")', page);
    const sel2 = page.document.getElementById('cell2');
    sel2.setAttribute('data-sid', 'S1'); sel2.setAttribute('data-date', '2026-10-12'); sel2.value = 'absent';
    vm.runInContext('updateAttendanceCell(sel2)', Object.assign(page, { sel2 }));
    const dates = page.attendanceRegister.map(r => r.date + ':' + r.status).sort();
    assertEq(dates, ['2026-10-05:present', '2026-10-12:absent'], 'week 1\'s Monday survives week 2\'s (the real updateAttendanceCell)');
    assertEq(page.students[0].attendance, 50, 'and students[].attendance follows by the one rule');
    assertEq(page.attendanceRegister[0].markedBy, 'USR-9', 'each mark records who made it');
    assert(!page._store.getItem('voctrain_attendanceRegister'), 'not yet written the instant it is made…');
    page._runTimers();
    assertEq(JSON.parse(page._store.getItem('voctrain_attendanceRegister')).length, 2, '…but within a second, with no Save pressed (attendance-16)');
    assertEq(JSON.parse(page._store.getItem('voctrain_students'))[0].attendance, 50, 'the derived % is saved with it');
    assert(page.document.getElementById('attendanceSaveState').textContent.indexOf('saved') !== -1, 'and the page says the marks are saved');
    assertEq(page.attendanceCurrentDate(), '2026-10-12', 'the picked date is the one shown');
    assert(!/setActiveQuarter/.test(extractFunction(B.src, 'onAttendanceDateChange')),
      'picking a date no longer moves the whole app\'s financial quarter (attendance-17)');
  }

  console.log('The register table shows the picked week, dated, with every status' + tag);
  {
    const page = makePage(B, {
      students: [{ id: 'S1', name: 'Ann', course: 'Welding', stage: 'training', instructor: 'Ms Instructor' },
        { id: 'S2', name: 'Grad', course: 'Welding', stage: 'certified' }],
      register: [{ id: 'ATT|S1|' + week[1], studentId: 'S1', date: week[1], status: 'excused', markedAt: '2026-01-01T00:00:00Z' }],
      instructor: { name: 'Ms Instructor', course: 'Welding' }
    });
    vm.runInContext('renderInstructorAttendance()', page);
    const html = page._els.iAttendanceTableBody.innerHTML;
    week.forEach(d => assert(html.indexOf('data-date="' + d + '"') !== -1, 'a cell for ' + d));
    assert(/<option value="excused" selected>/.test(html), 'an excused day shows as excused');
    assert(html.indexOf('No class') !== -1 && html.indexOf('value="late"') !== -1, 'late, excused and no-class can be chosen (attendance-10)');
    assert(html.indexOf('Grad') === -1, 'a graduate with no course dates is not listed as five absences (attendance-13)');
    assert(page._els.iAttendanceTableHead.innerHTML.indexOf("attendanceMarkAll('" + week[0] + "','present','instructor')") !== -1,
      'each day has a one-tap "all present"');
    vm.runInContext('attendanceToggleShowAll(true)', page);
    assert(page._els.iAttendanceTableBody.innerHTML.indexOf('Grad') !== -1, '"Show every trainee" lists them all');
  }

  console.log('"Mark all present" fills only cells nobody has marked' + tag);
  {
    const studs = [];
    for (let i = 0; i < 30; i++) studs.push({ id: 'S' + i, name: 'Trainee ' + i, course: 'Welding', stage: 'training', instructor: 'Ms Instructor' });
    const page = makePage(B, { students: studs, instructor: { name: 'Ms Instructor', course: 'Welding' },
      register: [{ id: 'ATT|S3|' + week[2], studentId: 'S3', date: week[2], status: 'absent', markedAt: '2026-01-01T00:00:00Z' }] });
    vm.runInContext('attendanceViewDate = "' + week[2] + '"; renderInstructorAttendance(); attendanceMarkAll("' + week[2] + '", "present", "instructor")', page);
    const onDay = page.attendanceRegister.filter(r => r.date === week[2]);
    assertEq(onDay.length, 30, 'a class of thirty is marked in one tap');
    assertEq(onDay.find(r => r.studentId === 'S3').status, 'absent', 'an absence already recorded is left as it was');
    assert(page._toasts.some(t => /29 trainees/.test(t) && /1 already marked/.test(t)), 'and the instructor is told so');
  }

  console.log('The lock follows the trainee\'s own intake, not the first centre of that name' + tag);
  {
    const skill = [{ id: 'SA-1', name: 'Welding', startDate: '2025-09-01', endDate: '2026-06-30' },
                   { id: 'SA-2', name: 'Welding', startDate: '2026-09-01', endDate: '2027-06-30' }];
    [skill, skill.slice().reverse()].forEach((sa, i) => {
      const page = makePage(B, { skillAreas: sa, students: [{ id: 'NEW', name: 'New', course: 'Welding', centreId: 'SA-2' }, { id: 'OLD', name: 'Old', course: 'Welding', centreId: 'SA-1' }] });
      assert(vm.runInContext('isRegisterOpenForStudent(students[0])', page) === true, 'the running intake is open (order ' + i + ') — attendance-08');
      assert(vm.runInContext('isRegisterOpenForStudent(students[1])', page) === false, 'the ended intake is closed (order ' + i + ')');
      assertEq(vm.runInContext('setAttendanceMark("OLD", "2026-10-19", "present")', page), 'locked', 'and a mark there is refused');
    });
    const page = makePage(B, { skillAreas: [{ id: 'SA-3', name: 'Plumbing', startDate: '2099-01-01', endDate: '2099-06-30' }],
      students: [{ id: 'P', name: 'P', course: 'Plumbing', centreId: 'SA-3' }] });
    assertEq(vm.runInContext('attendanceLockReason(students[0])', page), 'not started', 'a course not started yet says so, not "ended"');
  }

  console.log('The admin-staff view lists every trainee, with a filter and a search' + tag);
  {
    const studs = [];
    for (let i = 0; i < 120; i++) studs.push({ id: 'S' + i, name: 'Trainee ' + i, course: i % 2 ? 'Welding' : 'Plumbing', stage: 'training' });
    const page = makePage(B, { students: studs, role: 'adminstaff' });
    vm.runInContext('renderAsAttendance()', page);
    assertEq((page._els.asAttBody.innerHTML.match(/<tr>/g) || []).length, 120, 'all 120, not the first 40 (attendance-18)');
    assert(/Showing 120 of 120/.test(page._els.asAttCount.textContent), 'with a count');
    page._els.asAttendanceSearch = Object.assign(makeEl('asAttendanceSearch'), { value: 'trainee 11' });
    vm.runInContext('renderAsAttendance()', page);
    assert(/Showing \d+ of 120/.test(page._els.asAttCount.textContent) && (page._els.asAttBody.innerHTML.match(/<tr>/g) || []).length < 120, 'the search narrows it');
    assert(page._els.asAttBody.innerHTML.indexOf('<select') === -1, 'and it stays read-only');
  }

  console.log('Another document\'s copy is merged, never adopted wholesale' + tag);
  {
    const page = makePage(B, { students: [{ id: 'A1', name: 'A' }, { id: 'A2', name: 'B' }],
      rows: [{ studentId: 'A1', date: '2026-10-12', days: {} }],
      register: [{ id: 'ATT|A1|2026-10-12', studentId: 'A1', date: '2026-10-12', status: 'present', markedAt: '2026-10-12T15:00:00Z' }] });
    vm.runInContext('attnLoadedQuarter = { fy: "2026/2027", q: 3 }', page);
    // A roster another page last saw in Q2, all absent.
    const stale = [{ studentId: 'A1', date: '2026-07-01', days: { Mon: 'absent' } }, { studentId: 'A2', date: '2026-07-01', days: { Mon: 'absent' } }];
    vm.runInContext('mergeIncomingAttendance({ attendanceRecords: stale, attendanceRegister: [{ studentId: "A1", date: "2026-10-12", status: "absent", markedAt: "2026-10-11T00:00:00Z" }] })', Object.assign(page, { stale }));
    assertEq(page.attendanceRecords.map(r => r.studentId), ['A1'], 'another quarter\'s rows are not put into this quarter\'s roster (attendance-05/06)');
    assertEq(page.attendanceRegister[0].status, 'present', 'an older mark does not replace a newer one');
    vm.runInContext('mergeIncomingAttendance({ attendanceQuarter: { fy: "2026/2027", q: 3 }, attendanceRecords: [{ studentId: "A2", date: "2026-04-01", days: {} }] })', page);
    assertEq(page.attendanceRecords.map(r => r.studentId), ['A1', 'A2'], 'a row the backup says is THIS quarter\'s is added, whatever date it was created');
    vm.runInContext('mergeIncomingAttendance({ savedByRole: "student", attendanceRegister: [{ studentId: "A1", date: "2026-10-12", status: "absent", markedAt: "2099-01-01T00:00:00Z" }] })', page);
    assertEq(page.attendanceRegister[0].status, 'present', 'marks in a backup a trainee\'s device published are not trusted');
  }

  console.log('The old rosters are never written over with nothing' + tag);
  {
    const bucket = 'voctrain_attendance::2026/2027_Q3';
    const page = makePage(B, { store: { [bucket]: JSON.stringify([{ studentId: 'S1', days: { Mon: 'present' } }, { studentId: 'S2', days: {} }]) } });
    vm.runInContext('attnLoadedQuarter = { fy: "2026/2027", q: 3 }; attendanceRecords = []; mirrorActiveAttendance();', page);
    assertEq(JSON.parse(page._store.getItem(bucket)).length, 2, 'an emptied roster in memory does not replace the stored bucket (missed: raw mirror)');
    const page2 = makePage(B, { store: { [bucket]: '{"half-written' } });
    vm.runInContext('loadAttendanceForQuarter({ fy: "2026/2027", q: 3 }); attendanceRecords = [{ studentId: "X", days: {} }]; mirrorActiveAttendance();', page2);
    assertEq(page2._store.getItem(bucket), '{"half-written', 'a bucket that could not be read is left exactly as it is, never overwritten');
  }

  console.log('A new quarter is back-filled only with trainees whose course runs in it' + tag);
  {
    const page = makePage(B, {
      skillAreas: [{ id: 'C1', name: 'Welding', startDate: '2025-01-01', endDate: '2025-12-31' }, { id: 'C2', name: 'Plumbing', startDate: '2026-09-01', endDate: '2027-06-30' }],
      students: [{ id: 'G', name: 'Grad', course: 'Welding', centreId: 'C1', stage: 'certified' }, { id: 'N', name: 'Now', course: 'Plumbing', centreId: 'C2', stage: 'training' }] });
    vm.runInContext('attnLoadedQuarter = { fy: "2026/2027", q: 3 }; attendanceRecords = []; backfillAttendanceRoster();', page);
    assertEq(page.attendanceRecords.map(r => r.studentId), ['N'], 'the graduate is not added (attendance-13)');
    assertEq([page.attendanceRecords[0].fy, page.attendanceRecords[0].quarter], ['2026/2027', 3], 'the row says which quarter it is in (attendance-06)');
    assertEq(page.attendanceRecords[0].days, {}, 'and starts unmarked, not as five absences (attendance-10)');
  }

  console.log('The old-row fold no longer rewrites history' + tag);
  {
    const page = makePage(B, { students: [{ id: 'S1', name: 'Moved', course: 'Plumbing' }, { id: 'J1', name: 'John', course: 'Weld' }, { id: 'J2', name: 'John', course: 'Weld' }],
      rows: [{ studentId: 'S1', studentName: 'Moved', course: 'Welding', days: { Mon: 'present' } },
             { studentId: 'OLD', studentName: 'John', course: 'Weld', days: { Mon: 'late' } },
             { studentId: 'GONE', studentName: 'Nobody', course: 'X', days: { Mon: 'present' } }] });
    vm.runInContext('attnLoadedQuarter = { fy: "2025/2026", q: 2 }; dedupeAttendanceRecords();', page);
    assertEq(page.attendanceRecords.find(r => r.studentId === 'S1').course, 'Welding', 'a past quarter keeps the programme the trainee was on (attendance-15a)');
    assert(!page.attendanceRecords.some(r => r.studentId === 'J1' || r.studentId === 'J2'), 'a name two live trainees share attaches to neither (15b)');
    const orphans = JSON.parse(page._store.getItem('voctrain_attendance_orphans') || '[]');
    assert(orphans.some(o => o.studentId === 'GONE') && orphans.some(o => o.studentId === 'OLD'), 'rows that match nobody are set aside, not thrown away (15c)');
    const empty = makePage(B, { students: [], rows: [{ studentId: 'S1', days: { Mon: 'present' } }] });
    assertEq(vm.runInContext('dedupeAttendanceRecords()', empty), false, 'and with no roll loaded it does not judge at all');
  }

  console.log('A trainee\'s device keeps only their own attendance' + tag);
  {
    const bucket = 'voctrain_attendance::2026/2027_Q3';
    const page = makePage(B, {
      store: { [bucket]: JSON.stringify([{ studentId: 'ME' }, { studentId: 'X' }, { studentId: 'Y' }]), voctrain_attendance_orphans: '[{"studentId":"Z"}]' },
      students: [{ id: 'ME', name: 'Me' }, { id: 'X', name: 'X' }],
      register: [{ studentId: 'ME', date: '2026-10-19', status: 'present' }, { studentId: 'X', date: '2026-10-19', status: 'absent' }] });
    Object.assign(page, { currentRole: 'student', _sessionWiped: false, lmsChatRooms: [], supportMessages: [], currentStudent: { id: 'ME', name: 'Me' }, currentLoggedInUser: { id: 'U-ME' }, examResults: [], studentProfiles: {},
      adminMeetings: [], adrTasks: [], adrStaffMeta: {}, instructorData: [], instructorProfiles: {}, certDownloadApprovals: [], certTemplates: {},
      lmsChatMessages: {}, lmsChatProfiles: {}, lmsChatFollows: {}, adminStaffAccessDefaults: () => ({}), indexedDB: { deleteDatabase() {} } });
    vm.runInContext('clearSensitiveStudentData()', page);
    assertEq(JSON.parse(page._store.getItem(bucket)).map(r => r.studentId), ['ME'], 'every per-quarter roster is narrowed to the trainee (missed: privacy)');
    assertEq(JSON.parse(page._store.getItem('voctrain_attendanceRegister')).map(r => r.studentId), ['ME'], 'and so is the dated register');
    assert(page._store.getItem('voctrain_attendance_orphans') == null, 'the set-aside rows are not left behind either');
  }

  console.log('Live classes reach the register only through the instructor' + tag);
  {
    const s0 = '2026-10-20T14:00:00Z';
    const page = makePage(B, {
      students: [{ id: 'S1', name: 'Ann Lee', course: 'Welding', stage: 'training', instructor: 'Ms Instructor' }, { id: 'S2', name: 'Bo Day', course: 'Welding', stage: 'training', instructor: 'Ms Instructor' }],
      instructor: { name: 'Ms Instructor', course: 'Welding' },
      vcSessions: [{ id: 'vcs-1', mode: 'mesh', startedAt: s0, endedAt: '2026-10-20T15:00:00Z', updatedAt: '2026-10-20T15:00:00Z',
        participants: [{ pid: 'p', name: 'Ann Lee', role: 'student', stays: [{ joined: s0, left: '2026-10-20T15:00:00Z' }] }] }] });
    vm.runInContext('attendanceViewDate = "2026-10-20"; renderInstructorAttendance();', page);
    assert(page._els.iAttendanceLiveClasses.innerHTML.indexOf('attendanceOpenLiveDialog(\'2026-10-20\',\'instructor\')') !== -1,
      'the class held that day is offered with one click (vc-14)');
    assertEq(page.attendanceRegister.length, 0, 'showing it writes nothing');
    vm.runInContext('attendanceOpenLiveDialog("2026-10-20", "instructor")', page);
    const dlg = page._attLiveDialog || vm.runInContext('_attLiveDialog', page);
    assertEq(dlg.rows.map(r => [r.studentId, r.status, r.tick]), [['S1', 'present', true], ['S2', 'absent', false]],
      'the joiner is pre-ticked as present; the one who never joined is suggested absent but NOT ticked');
    // Simulate the dialog: ticked row 0 only.
    const box = page.document.getElementById('attLiveDialog');
    box.querySelector = sel => /data-att-live="0"/.test(sel) ? { checked: true } : /data-att-live-status="0"/.test(sel) ? { value: 'present' } : null;
    vm.runInContext('attendanceApplyLiveDialog()', page);
    assertEq(page.attendanceRegister.map(r => [r.studentId, r.date, r.status, r.source]), [['S1', '2026-10-20', 'present', 'live-class']],
      'only what the instructor confirmed is written, dated the day of the class');
  }

  console.log('The CMC board reads the same rate' + tag);
  {
    const page = makePage(B, { students: [{ id: 'S1', name: 'Ann', course: 'W' }, { id: 'S2', name: 'Bo', course: 'W' }],
      rows: [{ studentId: 'S1', days: { Mon: 'absent', Tue: 'absent', Wed: 'absent', Thu: 'absent', Fri: 'absent' } }],
      register: [{ studentId: 'S1', date: '2026-10-19', status: 'late' }, { studentId: 'S1', date: '2026-10-20', status: 'excused' },
        { studentId: 'S2', date: '2026-10-19', status: 'absent' }, { studentId: 'S2', date: '2026-10-20', status: 'noclass' }] });
    const html = vm.runInContext('cmcBuildAttendanceDetail()', page);
    assert(/Average Attendance<\/div><div class="stat-value">50%/.test(html), 'average over trainees, held sessions only (late attended, excused / no class not counted)');
    assert(/Below 60%<\/div><div class="stat-value" style="color:var\(--red\)">1</.test(html), 'and "Below 60%" counts only the trainee who missed a held session');
  }

  console.log('Every path that brings attendance in uses the one merge' + tag);
  ['mergeBackupData', 'mergeFromCloud', 'recoverCourseDataFromCloud', 'autoSyncOnLogin'].forEach(fn => {
    const body = extractFunction(B.src, fn, B.where);
    assert(/mergeIncomingAttendance\(/.test(body), fn + ' merges attendance through mergeIncomingAttendance');
    assert(!/attendanceRecords\.push\(/.test(body), fn + ' no longer pushes rows of its own');
  });
  // One backup payload now: "Save to Cloud" runs the automatic save
  // (sync-22), so the register travels in the one payload every save builds.
  const payloads = (B.src.match(/attendanceRegister: currentRole === 'student' \? undefined : attendanceRegister,/g) || []).length;
  assert(payloads >= 1 && /await autoSaveToAllFolders\(\)/.test(extractFunction(B.src, 'saveToCloud', B.where)),
    'every Drive backup carries every dated mark, every quarter (attendance-07)');
  assert((B.src.match(/attendanceQuarter: \(typeof attnLoadedQuarter/g) || []).length >= 1, 'and says which quarter its weekly rows are');
  assert(/voctrain_attendanceRegister:\s*function\(v\)\{ mergeIncomingAttendance\(\{ attendanceRegister: v \}\); \}/.test(B.src) &&
    /voctrain_attendance:\s*function\(v\)\{ mergeIncomingAttendance\(\{ attendanceRecords: v \}\); \}/.test(B.src),
    'another tab\'s write is merged, not swapped in (attendance-05)');
  assert(/saveCollection\('voctrain_attendanceRegister', attendanceRegister\)/.test(extractFunction(B.src, 'saveState', B.where)),
    'saveState writes the register through the anti-blanking guard');
  const rawReg = B.src.match(/CESTISStore\.setItem\('voctrain_attendanceRegister', JSON\.stringify\(([A-Za-z_$][\w$]*)\)/g) || [];
  assert(rawReg.every(m => /\(my[A-Z]/.test(m)), 'the register is written raw only by the trainee-device narrowing');
});

/* =====================================================================
   3. The other pages
   ===================================================================== */
console.log('Student Progress and the stand-alone clock');
['Student-Progress.html', 'Offline System/Student-Progress.html'].forEach(f => {
  const sp = read(f);
  const keys = /CESTISPageCloud\.init\(\{[\s\S]*?keys: \[([^\]]*)\]/.exec(sp);
  assert(keys && keys[1].indexOf("'voctrain_attendance'") === -1, f + ': its Drive file no longer publishes the roster that was adopted wholesale (attendance-05)');
  assert(sp.indexOf("toISOString().split('T')[0]") === -1, f + ': no UTC date stamps left (attendance-20)');
  assert(/spRegisterAttendance\(s\.id\)/.test(sp) && /_attIn\.readOnly = !!_reg/.test(sp), f + ': the edit form shows the register\'s figure, read-only, when there is one (attendance-12)');
});
['Staff.Clock.in.html', 'Offline System/Staff.Clock.in.html'].forEach(f => {
  const src = read(f);
  assert(src.indexOf("toISOString().split('T')[0]") === -1, f + ': sessions are dated by the Centre\'s clock, not UTC (attendance-20)');
  const sb = { Date, String };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'clockLocalDate', f, true), sb);
  assertEq(vm.runInContext('clockLocalDate(new Date("2026-10-03T00:30:00Z"))', sb), '2026-10-02', f + ': a 7:30 pm Friday clock-in is dated Friday');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
