/* On the Centre's own network, a shorter list is never a deletion.

   The Offline System keeps the LMS dashboard's data on the Centre's own
   server, and every device saves to it. The merge decided each storage key as
   ONE value — the newer write took the whole thing — so:
     - two trainees submitting an exam within the same half-minute each wrote
       "everything I know + my result"; the second write replaced the first and
       one result was gone from the server and then from every device;
     - a trainee signing out trims that device's copy of the roll, the exam
       results and the attendance to their own records (so a shared PC does not
       keep everybody's data). That trimmed list was the newest write, so it
       replaced the Centre's whole roll, every result and the register on the
       server, and every other device adopted it within half a minute;
     - the same for chat, announcements, submissions and the rest whenever two
       devices saved at once.

   What these pin, against the real CESTISCore.pageCloud.mergeKeys (both
   builds' copies):
     - with `records`, every registered collection is merged record by record:
       nothing either side holds is lost, the newer edit of a record wins, a
       tie goes to the side that wrote the collection last (the old rule, per
       record), and only a tombstone deletes;
     - two devices + a trainee's sign-out, run through the same merges the
       devices and the server perform, leave every record on the server;
     - the server's own merge (`symmetric`) takes the strictly newer stamp,
       treating an unstamped value as the older one;
     - identical values keep the newer stamp (a dropped stamp once left new
       devices keeping their three built-in logins instead of the Centre's);
     - without `records` nothing changes for any other page.

   Run: node tests/lan-record-merge.test.js */
'use strict';

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ids = (raw, f) => JSON.parse(raw).map(r => r[f || 'id']).sort().join(',');
const T0 = '2026-10-01T09:00:00.000Z', T1 = '2026-10-01T10:00:00.000Z', T2 = '2026-10-01T10:00:05.000Z',
      T3 = '2026-10-01T11:00:00.000Z';
const J = v => JSON.stringify(v);

[['cestis-core.js', require('../cestis-core.js')],
 ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(([where, Core]) => {
  const PC = Core.pageCloud;
  const R = { records: true };
  console.log('\n[' + where + ']');

  /* ---------- 1. Two trainees submit in the same pull window ---------- */
  console.log('Two exam submissions in the same half-minute both survive');
  const base = [{ id: 'RES-0', examId: 'E1', studentId: 'S0', score: 70, submittedAt: T0 }];
  const a = base.concat([{ id: 'RES-A', examId: 'E1', studentId: 'SA', score: 80, submittedAt: T1 }]);
  const b = base.concat([{ id: 'RES-B', examId: 'E1', studentId: 'SB', score: 90, submittedAt: T2 }]);
  // The server already holds A's push; B pushes (B's whole-key stamp is newer).
  let m = PC.mergeKeys({ voctrain_examResults: J(b) }, { voctrain_examResults: T2 },
                       { voctrain_examResults: J(a) }, { voctrain_examResults: T1 }, R);
  assertEq(ids(m.data.voctrain_examResults), 'RES-0,RES-A,RES-B', 'B\'s push keeps A\'s result (it used to replace it)');
  // And the other way round converges on the same set.
  m = PC.mergeKeys({ voctrain_examResults: J(a) }, { voctrain_examResults: T1 },
                   { voctrain_examResults: J(b) }, { voctrain_examResults: T2 }, R);
  assertEq(ids(m.data.voctrain_examResults), 'RES-0,RES-A,RES-B', 'and A\'s pull ends with both too');
  assert(m.changed.indexOf('voctrain_examResults') !== -1, 'which A then writes locally');
  const legacy = PC.mergeKeys({ voctrain_examResults: J(a) }, { voctrain_examResults: T1 },
                              { voctrain_examResults: J(b) }, { voctrain_examResults: T2 });
  assertEq(ids(legacy.data.voctrain_examResults), 'RES-0,RES-B',
    'without `records` the old whole-key rule is unchanged (every other page keeps its behaviour)');

  /* ---------- 2. A trainee signs out ---------- */
  console.log('A trainee\'s sign-out trim cannot shrink the Centre\'s records');
  const roll = [{ id: 'S1', name: 'Ann', course: 'Welding' }, { id: 'S2', name: 'Bob', course: 'Welding' },
                { id: 'S3', name: 'Cy', course: 'Plumbing' }];
  const results = [{ id: 'R1', examId: 'E1', studentId: 'S1', submittedAt: T0 },
                   { id: 'R2', examId: 'E1', studentId: 'S2', submittedAt: T0 },
                   { id: 'R3', examId: 'E1', studentId: 'S3', submittedAt: T0 }];
  const att = [{ studentId: 'S1', date: '2026-10-01', days: { Mon: 'present' } },
               { studentId: 'S2', date: '2026-10-01', days: { Mon: 'absent' } },
               { studentId: 'S3', date: '2026-10-01', days: { Mon: 'late' } }];
  const profiles = { U1: { phone: '1' }, U2: { phone: '2' } };
  const server = { voctrain_students: J(roll), voctrain_examResults: J(results), voctrain_attendance: J(att),
                   voctrain_studentProfiles: J(profiles) };
  const serverStamps = { voctrain_students: T0, voctrain_examResults: T0, voctrain_attendance: T0, voctrain_studentProfiles: T0 };
  // What clearSensitiveStudentData leaves on Ann's device, stamped NOW.
  const trimmed = { voctrain_students: J([roll[0]]), voctrain_examResults: J([results[0]]),
                    voctrain_attendance: J([att[0]]), voctrain_studentProfiles: J({ U1: profiles.U1 }) };
  const nowStamps = { voctrain_students: T3, voctrain_examResults: T3, voctrain_attendance: T3, voctrain_studentProfiles: T3 };
  // 1) Ann's device pushes: GET, merge (device side), PUT.
  const push = PC.mergeKeys(trimmed, nowStamps, server, serverStamps, R);
  // 2) The server merges that PUT into what it holds (peer merge).
  const stored = PC.mergeKeys(server, serverStamps, push.data, push.stamps, { records: true, symmetric: true });
  assertEq(ids(stored.data.voctrain_students), 'S1,S2,S3', 'the server still holds the whole roll');
  assertEq(ids(stored.data.voctrain_examResults), 'R1,R2,R3', 'and every exam result');
  assertEq(JSON.parse(stored.data.voctrain_attendance).length, 3, 'and the whole register');
  assertEq(Object.keys(JSON.parse(stored.data.voctrain_studentProfiles)).sort().join(','), 'U1,U2', 'and every profile');
  // Even a PUT straight from the trimmed device, with no device-side merge at all.
  const raw = PC.mergeKeys(server, serverStamps, trimmed, nowStamps, { records: true, symmetric: true });
  assertEq(ids(raw.data.voctrain_students), 'S1,S2,S3', 'a raw trimmed upload cannot shrink the server\'s roll either');
  // 3) The staff PC's next pull.
  const staff = PC.mergeKeys(server, serverStamps, stored.data, stored.stamps, R);
  assertEq(ids(staff.data.voctrain_examResults), 'R1,R2,R3', 'and the staff PC\'s next pull keeps every result');

  /* ---------- 3. Deletion is a tombstone, and it travels ---------- */
  console.log('A deletion travels as a tombstone, and only as a tombstone');
  const del = PC.mergeKeys(
    { voctrain_students: J(roll.slice(0, 2)), voctrain_deletedStudentIds: J(['S3']),
      voctrain_examResults: J(results.slice(0, 2)) },
    { voctrain_students: T3, voctrain_deletedStudentIds: T3, voctrain_examResults: T3 },
    server, serverStamps, R);
  assertEq(ids(del.data.voctrain_students), 'S1,S2', 'a trainee deleted on this device is not brought back');
  assertEq(ids(del.data.voctrain_examResults), 'R1,R2', 'nor are their exam results');
  const other = PC.mergeKeys(server, serverStamps, del.data, del.stamps, { records: true, symmetric: true });
  assertEq(ids(other.data.voctrain_students), 'S1,S2', 'and the deletion reaches the server\'s copy');
  // The dashboard's own tombstones (syncTombstones) for its collections.
  const ann = [{ id: 'A1', title: 'Open day', updatedAt: T0 }, { id: 'A2', title: 'Exam week', updatedAt: T0 }];
  const tomb = { announcements: { A2: T1 } };
  const ad = PC.mergeKeys({ voctrain_announcements: J([ann[0]]), voctrain_syncTombstones: J(tomb) },
                          { voctrain_announcements: T1, voctrain_syncTombstones: T1 },
                          { voctrain_announcements: J(ann), voctrain_syncTombstones: J({}) },
                          { voctrain_announcements: T0, voctrain_syncTombstones: T0 }, R);
  assertEq(ids(ad.data.voctrain_announcements), 'A1', 'an announcement deleted after its last edit stays deleted');
  const edited = PC.mergeKeys({ voctrain_announcements: J([ann[0]]), voctrain_syncTombstones: J(tomb) },
                              { voctrain_announcements: T1, voctrain_syncTombstones: T1 },
                              { voctrain_announcements: J([ann[0], Object.assign({}, ann[1], { updatedAt: T3 })]) },
                              { voctrain_announcements: T3 }, R);
  assertEq(ids(edited.data.voctrain_announcements), 'A1,A2', 'but one edited AFTER the deletion lives (the house rule)');
  const tm = PC.mergeKeys({ voctrain_syncTombstones: J({ exams: { x: T1 } }) }, { voctrain_syncTombstones: T3 },
                          { voctrain_syncTombstones: J({ exams: { y: T2 }, chatRooms: { r: T0 } }) },
                          { voctrain_syncTombstones: T0 }, R);
  const tmv = JSON.parse(tm.data.voctrain_syncTombstones);
  assert(tmv.exams.x && tmv.exams.y && tmv.chatRooms.r, 'the tombstones themselves are unioned, so no deletion is undone');

  /* ---------- 4. Edits, ties and blanks ---------- */
  console.log('The newer edit of a record wins; a tie loses nothing');
  const s1old = { id: 'S1', name: 'Ann', phone: '', lastModified: T0 };
  const s1new = { id: 'S1', name: 'Ann Brown', lastModified: T2 };
  let e = PC.mergeKeys({ voctrain_students: J([s1old]) }, { voctrain_students: T3 },
                       { voctrain_students: J([s1new]) }, { voctrain_students: T1 }, R);
  assertEq(JSON.parse(e.data.voctrain_students)[0].name, 'Ann Brown', 'the newer edit of a trainee wins, whichever list is newer');
  const tieL = [{ studentId: 'S1', date: 'd', days: { Mon: 'present', Tue: '' } }];
  const tieC = [{ studentId: 'S1', date: 'd', days: { Mon: 'absent', Tue: 'present' }, note: 'late bus' }];
  e = PC.mergeKeys({ voctrain_attendance: J(tieL) }, { voctrain_attendance: T3 },
                   { voctrain_attendance: J(tieC) }, { voctrain_attendance: T1 }, R);
  let row = JSON.parse(e.data.voctrain_attendance)[0];
  assertEq(row.days.Mon, 'present', 'an unstamped tie goes to the side that saved the register last (here)');
  assertEq(row.note, 'late bus', 'and keeps what only the other side had');
  e = PC.mergeKeys({ voctrain_attendance: J(tieL) }, { voctrain_attendance: T1 },
                   { voctrain_attendance: J(tieC) }, { voctrain_attendance: T3 }, R);
  row = JSON.parse(e.data.voctrain_attendance)[0];
  assertEq(row.days.Mon, 'absent', 'and to the server\'s copy when that was saved last');
  const qb = PC.mergeKeys({ 'voctrain_attendance_2026/2027_Q2': J(att.slice(0, 1)) }, {},
                          { 'voctrain_attendance_2026/2027_Q2': J(att.slice(1)) }, {}, R);
  assertEq(JSON.parse(qb.data['voctrain_attendance_2026/2027_Q2']).length, 3, 'every quarter\'s register bucket merges by record too');
  const mk = PC.mergeKeys({ voctrain_attendance_quartered: '1' }, { voctrain_attendance_quartered: T3 },
                          { voctrain_attendance_quartered: '2' }, { voctrain_attendance_quartered: T1 }, R);
  assertEq(mk.data.voctrain_attendance_quartered, '1', 'a value that is not a list keeps the whole-value rule');

  console.log('One trainee stays one record when their id is re-minted');
  const legacyAnn = { id: 'STU1700000000000', name: 'Ann Brown', course: 'Welding', phone: '555' };
  const stableId = Core.stableStudentId(legacyAnn);
  const migrated = { id: stableId, name: 'Ann Brown', course: 'Welding' };
  const twin = { id: 'STU-other', name: 'Ann Brown', course: 'Welding', keepSeparate: true };
  e = PC.mergeKeys({ voctrain_students: J([migrated]) }, { voctrain_students: T3 },
                   { voctrain_students: J([legacyAnn, twin]) }, { voctrain_students: T1 }, R);
  const people = JSON.parse(e.data.voctrain_students);
  assertEq(people.length, 2, 'the old-id copy and the stable-id copy are one person (the online merge\'s name + programme rule)');
  assertEq(people[0].id, stableId, 'which keeps the stable id');
  assertEq(people[0].phone, '555', 'and loses nothing either copy had');
  assert(people.some(p => p.id === 'STU-other'), 'while a namesake marked "keep separate" stays a separate person');

  /* ---------- 5. Accounts, approvals, chat, centres ---------- */
  console.log('Accounts, approvals, chat and centres use the rules their online merges use');
  const uL = [{ id: 'U1', username: 'ann', password: 'h1', updatedAt: T0 }];
  const uC = [{ id: 'U1', username: 'ann', password: 'h2', updatedAt: T2 }, { id: 'U2', username: 'bob', password: 'h3' },
              { id: 'U3', username: 'gone', password: 'h4' }];
  const u = PC.mergeKeys({ voctrain_users: J(uL), voctrain_deletedUserIds: J(['U3']) }, { voctrain_users: T3 },
                         { voctrain_users: J(uC) }, { voctrain_users: T1 }, R);
  const uv = JSON.parse(u.data.voctrain_users);
  assertEq(uv.map(x => x.id).join(','), 'U1,U2', 'a new account arrives; a revoked one does not');
  assertEq(uv[0].password, 'h2', 'and a password changed later elsewhere replaces the old one');
  const ap = PC.mergeKeys({ voctrain_certDownloadApprovals: J([{ studentId: 'S1', approved: false }]) }, { voctrain_certDownloadApprovals: T3 },
                          { voctrain_certDownloadApprovals: J([{ studentId: 'S1', approved: true, approvedDate: T1 }]) },
                          { voctrain_certDownloadApprovals: T1 }, R);
  assertEq(JSON.parse(ap.data.voctrain_certDownloadApprovals)[0].approved, true,
    'a granted certificate approval is never switched back off by a stale "not yet"');
  const ch = PC.mergeKeys({ voctrain_chatMessages: J({ room1: [{ id: 'm0', timestamp: T0 }, { id: 'mA', timestamp: T1 }] }) },
                          { voctrain_chatMessages: T1 },
                          { voctrain_chatMessages: J({ room1: [{ id: 'm0', timestamp: T0 }, { id: 'mB', timestamp: T2 }], room2: [{ id: 'x', timestamp: T0 }] }) },
                          { voctrain_chatMessages: T2 }, R);
  const chv = JSON.parse(ch.data.voctrain_chatMessages);
  assertEq(chv.room1.map(x => x.id).join(','), 'm0,mA,mB', 'two people posting at once both keep their message, in time order');
  assert(chv.room2 && chv.room2.length === 1, 'and a room only the other side had arrives');
  const ce = PC.mergeKeys({ voctrain_skillAreas: J([{ id: '01', name: 'Welding' }]), voctrain_deletedCentreIds: J(['03']) },
                          { voctrain_skillAreas: T3 },
                          { voctrain_skillAreas: J([{ id: '01', name: 'Welding' }, { id: '02', name: 'Plumbing' }, { id: '03', name: 'Old' }]) },
                          { voctrain_skillAreas: T1 }, R);
  assertEq(ids(ce.data.voctrain_skillAreas), '01,02', 'a new centre arrives and a deleted one stays deleted');

  /* ---------- 6. The server's peer merge ---------- */
  console.log('The server merges each save as a peer: the strictly newer stamp wins');
  const sym = (stored, sst, inc, ist) => PC.mergeKeys(stored, sst, inc, ist, { records: true, symmetric: true });
  let sv = sym({ cfg: '"old"' }, { cfg: T1 }, { cfg: '"new"' }, { cfg: T2 });
  assertEq(sv.data.cfg, '"new"', 'a newer save of a setting replaces it');
  sv = sym({ cfg: '"kept"' }, { cfg: T2 }, { cfg: '"stale"' }, { cfg: T1 });
  assertEq(sv.data.cfg, '"kept"', 'an older one does not');
  sv = sym({ cfg: '"legacy"' }, {}, { cfg: '"new"' }, { cfg: T1 });
  assertEq(sv.data.cfg, '"new"', 'a stored value with no stamp is the older one, so it can still be updated');
  sv = sym({ cfg: '"kept"' }, { cfg: T1 }, { cfg: '"unstamped"' }, {});
  assertEq(sv.data.cfg, '"kept"', 'and an unstamped upload never replaces a stamped value');
  sv = sym({ voctrain_students: J(roll) }, { voctrain_students: T0 }, { voctrain_students: '[]' }, { voctrain_students: T3 });
  assertEq(ids(sv.data.voctrain_students), 'S1,S2,S3', 'an empty upload never replaces records');
  sv = sym({ only: '"server"' }, { only: T0 }, { mine: '"device"' }, { mine: T1 });
  assert(sv.data.only === '"server"' && sv.data.mine === '"device"', 'keys only one side has are both kept');

  /* ---------- 7. Identical values keep the newer stamp ---------- */
  console.log('Identical values keep the newer stamp');
  const st = PC.mergeKeys({ voctrain_users: '[1]' }, {}, { voctrain_users: '[1]' }, { voctrain_users: T2 });
  assertEq(st.stamps.voctrain_users, T2, 'the cloud\'s stamp survives an identical value (it used to vanish)');
  const st2 = PC.mergeKeys({ k: 'v' }, { k: T3 }, { k: 'v' }, { k: T1 });
  assertEq(st2.stamps.k, T3, 'and a newer local stamp is kept');

  /* ---------- 8. Registry ---------- */
  console.log('Only registered collections merge by record');
  assert(PC.isRecordKey('voctrain_examResults') && PC.isRecordKey('voctrain_submissions') &&
         PC.isRecordKey('voctrain_chatMessages') && PC.isRecordKey('voctrain_attendance_2026/2027_Q1'),
         'the dashboard\'s record collections are registered');
  assert(!PC.isRecordKey('voctrain_systemSettings') && !PC.isRecordKey('cesti_cashbook_data') && !PC.isRecordKey('voctrain_sessionRole'),
         'settings, other pages\' data and session keys are not');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
