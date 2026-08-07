/* Unit tests for CESTISCore.vcSessions — Large Class attendance capture.
   Run: node tests/vc-sessions.test.js */
'use strict';

const Core = require('../cestis-core.js');
const VS = Core.vcSessions;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* A class runs 09:00–11:00 on 4 March. */
const T = function (hhmm) { return '2026-03-04T' + hhmm + ':00.000Z'; };

/* ---------- 1. Opening a session ---------- */
console.log('Starting a session');
let s = VS.startSession({ code: 'k4m9pq', title: 'Welding Theory', course: 'WELDING L2',
  hostName: 'Stefan Brooks', hostRole: 'instructor', startedAt: T('09:00'), locked: true, lobby: true });
assertEq(s.code, 'K4M9PQ', 'room code stored upper case');
assertEq(s.title, 'Welding Theory', 'class title kept');
assertEq(s.course, 'WELDING L2', 'course kept for the register');
assertEq(s.hostName, 'Stefan Brooks', 'host recorded');
assertEq(s.startedAt, T('09:00'), 'start time recorded');
assertEq(s.endedAt, '', 'session is open');
assertEq(s.participants.length, 0, 'nobody in the room yet');
assert(s.locked && s.lobby, 'room protection recorded on the session');
assert(!!s.id, 'session has an id');

/* ---------- 2. Join and leave ---------- */
console.log('Join and leave');
VS.recordJoin(s, 'p1', 'Stefan Brooks', T('09:00'));
VS.recordJoin(s, 'p2', 'Tracy-Ann Jennings', T('09:02'));
VS.recordJoin(s, 'p3', 'Rashard Bennett', T('09:05'));
assertEq(s.participants.length, 3, 'three people in the room');
VS.recordLeave(s, 'p3', 'Rashard Bennett', T('09:12'));
assertEq(s.participants[2].minutes, 7, 'a seven minute stay is measured');
assertEq(s.participants[2].lastLeave, T('09:12'), 'leave time recorded');

/* A dropped connection: same person rejoins under a NEW conference id */
VS.recordJoin(s, 'p3-again', 'Rashard Bennett', T('09:20'));
assertEq(s.participants.length, 3, 'a reconnection is the same person, not a new one');
VS.recordLeave(s, 'p3-again', 'Rashard Bennett', T('10:00'));
assertEq(s.participants[2].minutes, 47, 'both stays are added together (7 + 40)');
assertEq(s.participants[2].stays.length, 2, 'each stay is kept');
assertEq(s.participants[2].firstJoin, T('09:05'), 'first join is the earliest');

/* A duplicate join event must not open a second stay */
VS.recordJoin(s, 'p2', 'Tracy-Ann Jennings', T('09:30'));
assertEq(s.participants[1].stays.length, 1, 'a repeated join while still in the room is ignored');

/* A leave for somebody who was never seen is harmless */
VS.recordLeave(s, 'ghost', 'Nobody At All', T('09:40'));
assertEq(s.participants.length, 3, 'an unknown leave does not invent a participant');

/* Null-safety */
assertEq(VS.recordJoin(null, 'p', 'n', T('09:00')), null, 'join is null-safe');
assertEq(VS.recordLeave(null, 'p', 'n', T('09:00')), null, 'leave is null-safe');

/* ---------- 3. Closing the session ---------- */
console.log('Closing the session');
VS.endSession(s, T('11:00'));
assertEq(s.endedAt, T('11:00'), 'end time recorded');
assertEq(VS.sessionMinutes(s), 120, 'the class ran two hours');
/* Stefan and Tracy-Ann never left — they stayed to the end, not zero minutes */
assertEq(s.participants[0].minutes, 120, 'the host stayed the whole class');
assertEq(s.participants[1].minutes, 118, 'a participant still in the room at the end is credited to the end');
assertEq(s.participants[2].minutes, 47, 'someone who left early keeps their own total');
assert(s.participants.every(function (p) { return p.stays.every(function (st) { return !!st.left; }); }),
  'no stay is left open after the class ends');

/* ---------- 4. Present vs partial ---------- */
console.log('Present or partial');
/* Threshold is half the class, capped at 20 minutes -> 20 for a 2 hour class */
assertEq(VS.presentThreshold(s), 20, 'a two hour class needs 20 minutes to count as present');
let sum = VS.summary(s);
assertEq(sum.minutes, 120, 'summary reports the class length');
assertEq(sum.present, 3, 'all three were present long enough');
assertEq(sum.partial, 0, 'nobody is partial');
assertEq(sum.participants[0].name, 'Stefan Brooks', 'summary sorted by time in the room');
assertEq(sum.participants[2].joins, 2, 'reconnections visible in the register');

/* A short class: the ratio, not the 20 minute cap, decides */
let short = VS.startSession({ code: 'AB12CD', title: 'Toolbox Talk', startedAt: T('09:00') });
VS.recordJoin(short, 'a', 'Anna', T('09:00'));
VS.recordJoin(short, 'b', 'Ben', T('09:08'));
VS.endSession(short, T('09:10'));
assertEq(VS.sessionMinutes(short), 10, 'a ten minute session');
assertEq(VS.presentThreshold(short), 5, 'half of a ten minute class is five minutes');
let ssum = VS.summary(short);
assertEq(ssum.present, 1, 'only the person who stayed counts as present');
assertEq(ssum.partial, 1, 'the late arrival is partial, not present');
assertEq(ssum.participants[1].name, 'Ben', 'the partial attendee is still listed');

/* Empty and null sessions do not throw */
assertEq(VS.summary(null).participants.length, 0, 'null session summarises to nothing');
assertEq(VS.sessionMinutes(null), 0, 'null session has no length');
assertEq(VS.summary(VS.startSession({ code: 'X', startedAt: T('09:00') })).present, 0, 'an empty class has nobody present');

/* ---------- 5. Matching the meeting names to the roster ---------- */
console.log('Matching against the student roster');
const students = [
  { id: 11, name: 'Tracy-Ann Jennings', course: 'WELDING L2' },
  { id: 12, name: 'Rashard Anthony Bennett', course: 'WELDING L2' },
  { id: 13, name: 'Someone Else', course: 'WELDING L2' }
];
const matched = VS.matchRoster(s, students);
const byName = {};
matched.forEach(function (m) { byName[m.name] = m; });
assertEq(byName['Tracy-Ann Jennings'].studentId, 11, 'an exact name matches the roster');
assert(byName['Tracy-Ann Jennings'].matched, 'match flagged');
assertEq(byName['Rashard Bennett'].studentId, 12, 'first + last name matches a trainee with a middle name');
assertEq(byName['Stefan Brooks'].studentId, null, 'the instructor is not on the student roster');
assert(!byName['Stefan Brooks'].matched, 'unmatched names are flagged, not guessed');
assertEq(VS.matchRoster(s, []).filter(function (m) { return m.matched; }).length, 0, 'no roster -> no matches');
assertEq(VS.matchRoster(s, null).length, 3, 'null roster still lists who attended');
/* Matching must not lose the attendance figures */
assertEq(byName['Tracy-Ann Jennings'].minutes, 118, 'matched rows keep their minutes');
assert(byName['Tracy-Ann Jennings'].present, 'matched rows keep their present flag');

/* ---------- 6. Merging what two devices saw ---------- */
console.log('Merging sessions across devices');
/* The instructor's laptop saw the whole class. */
const host = VS.startSession({ code: 'K4M9PQ', title: 'Welding Theory', startedAt: T('09:00'), id: 'S1' });
VS.recordJoin(host, 'p1', 'Stefan Brooks', T('09:00'));
VS.recordJoin(host, 'p2', 'Tracy-Ann Jennings', T('09:02'));
VS.endSession(host, T('11:00'));
/* A trainee's phone joined late and only saw part of it. */
const guest = VS.startSession({ code: 'K4M9PQ', title: 'Welding Theory', startedAt: T('09:30'), id: 'S1' });
VS.recordJoin(guest, 'p2', 'Tracy-Ann Jennings', T('09:30'));
VS.recordJoin(guest, 'p9', 'Late Joiner', T('09:35'));
VS.endSession(guest, T('10:30'));

let merged = VS.mergeSessions([host], [guest]);
assertEq(merged.length, 1, 'the same class merges into one session');
let m = merged[0];
assertEq(m.startedAt, T('09:00'), 'earliest start wins');
assertEq(m.endedAt, T('11:00'), 'latest end wins');
assertEq(m.participants.length, 3, 'everyone either device saw is kept');
const mp = {}; m.participants.forEach(function (p) { mp[p.name] = p; });
assertEq(mp['Tracy-Ann Jennings'].minutes, 118, 'the fuller record of a person wins over the shorter one');
assertEq(mp['Late Joiner'].minutes, 55, 'a participant only the phone saw is not lost');
/* Order must not matter */
const reversed = VS.mergeSessions([guest], [host]);
assertEq(reversed[0].participants.length, 3, 'merge is order independent');
assertEq(reversed[0].startedAt, T('09:00'), 'earliest start wins either way');
assertEq(reversed[0].endedAt, T('11:00'), 'latest end wins either way');

/* Different classes stay separate, newest first */
const other = VS.startSession({ code: 'ZZ99ZZ', title: 'Cosmetology Practical', startedAt: T('13:00'), id: 'S2' });
const two = VS.mergeSessions([host], [other]);
assertEq(two.length, 2, 'two different classes stay two sessions');
assertEq(two[0].id, 'S2', 'most recent session first');
assertEq(VS.mergeSessions(null, null).length, 0, 'merging nothing yields nothing');
assertEq(VS.mergeSessions([host], null).length, 1, 'a missing remote does not erase local sessions');
assertEq(VS.mergeSessions(null, [host]).length, 1, 'a missing local does not discard remote sessions');
/* The merge must not alias the inputs */
two[0].title = 'TAMPERED';
assertEq(other.title, 'Cosmetology Practical', 'merge returns copies, not references');

/* ---------- 7. Room password ---------- */
console.log('Room password');
const pw = VS.roomPassword('K4M9PQ');
assertEq(pw.length, 6, 'six character password');
assert(/^[A-Z0-9]+$/.test(pw), 'password is unambiguous upper case');
assertEq(VS.roomPassword('k4m9pq'), pw, 'case of the room code does not matter');
assertEq(VS.roomPassword('K4M9-PQ'), pw, 'punctuation in the room code does not matter');
assert(VS.roomPassword('AB12CD') !== pw, 'a different room gets a different password');
assertEq(VS.roomPassword(''), '', 'no room code, no password');
assertEq(VS.roomPassword(null), '', 'null-safe');
assert(VS.roomPassword('K4M9PQ', 'OTHER-SALT') !== pw, 'the salt changes the password');
/* It must be stable — every device derives the same one from the room code */
assertEq(VS.roomPassword('K4M9PQ'), VS.roomPassword('K4M9PQ'), 'derivation is deterministic');
/* And it must not simply be the room code */
assert(pw !== 'K4M9PQ', 'the password is not the room code itself');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
