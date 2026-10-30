/* The built-in conference room's rules (CESTISCore.vcRoom) and the Large
   Class register's one-record-per-class rules (CESTISCore.vcSessions).
   Run: node tests/vc-room.test.js

   What these pin, each of which used to go wrong:
     - room codes were six characters from Math.random, guessable;
     - any participant's "end the meeting" / "kick" / "mute" was obeyed;
     - an Admin Only meeting admitted anyone holding its code;
     - both trainees of every pair dialled each other (two connections) and
       every trainee uploaded video to classmates whose tiles are hidden;
     - phones filmed at 720p for thumbnail tiles;
     - an outage made every tab reconnect about three times a second;
     - the only relays were a public service's withdrawn shared login;
     - meet.jit.si could not be replaced without editing stored settings;
     - one Large Class became one register record PER DEVICE, and a record a
       device never closed was "in progress" for ever, routing that room code
       into an empty hosted room weeks later;
     - every join/leave re-merged and deep-copied the whole register history;
     - class sessions never became live or completed, and recordings were
       never linked to them, so "Live Now" and "Past Recordings" never showed. */
'use strict';

const Core = require('../cestis-core.js');
const R = Core.vcRoom;
const VS = Core.vcSessions;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---------- Room codes ---------- */
console.log('Room codes are long, random and forgiving to type');
{
  const crypto = require('crypto');
  const codes = new Set();
  for (let i = 0; i < 2000; i++) codes.add(R.generateCode(n => crypto.randomBytes(n)));
  assertEq(codes.size, 2000, 'two thousand codes, no repeats');
  const one = Array.from(codes)[0];
  assertEq(one.length, 10, 'a new code is ten characters');
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/.test(one), 'only characters that cannot be misread (no 0/O, 1/I)');
  // Every character of the alphabet turns up (taking a byte modulo 32 is unbiased).
  const seen = new Set(Array.from(codes).join(''));
  assertEq(seen.size, 32, 'all 32 characters are used');
  assertEq(R.generateCode(n => new Array(n).fill(255)), '9999999999', 'byte 255 maps inside the alphabet');
  assertEq(R.normaliseCode(' k4m9-pq '), 'K4M9PQ', 'typed codes are upper-cased and stripped of spaces and dashes');
  assert(R.isValidCode('K4M9PQ'), 'a six-character code handed out before still works');
  assert(R.isValidCode('ABCDEFGHJK'), 'a new ten-character code works');
  assert(!R.isValidCode('AB1'), 'too short is refused');
  assert(!R.isValidCode('abcdef'), 'an un-normalised code is not taken as valid');
  assertEq(R.hostPeerId('k4m9pq'), 'cestis-K4M9PQ-host', 'the host id is derived from the code');
}

/* ---------- Whose instructions are obeyed ---------- */
console.log('Only the host can end the class, remove, mute or promote');
{
  const hostId = 'cestis-ABC234-host';
  const student = { amHost: false, hostId, fromId: 'cestis-ABC234-zz9abc', admitted: true };
  const fromHost = { amHost: false, hostId, fromId: hostId, admitted: true };
  ['end-meeting', 'kick', 'force-mute', 'force-unmute', 'mute-all', 'force-cam-off', 'promote-host', 'demote-host',
   'permission-update', 'room-full', 'access-denied', 'peer-list', 'new-peer', 'peer-left', 'peer-kicked',
   'peer-muted', 'peer-unmuted', 'peer-name', 'cohost'].forEach(t => {
    assert(!R.acceptFrom(t, student), "a trainee's '" + t + "' is ignored");
    assert(R.acceptFrom(t, fromHost), "the host's '" + t + "' is obeyed");
  });
  const atHost = { amHost: true, hostId, fromId: 'cestis-ABC234-zz9abc', admitted: true };
  assert(!R.acceptFrom('end-meeting', atHost), 'nobody can end the meeting on the host');
  assert(!R.acceptFrom('kick', atHost), 'nobody can remove the host');
  assert(R.acceptFrom('chat', atHost), 'the host hears chat from people in the room');
  assert(!R.acceptFrom('chat', Object.assign({}, atHost, { admitted: false })), '…but not from someone not let in');
  assert(R.acceptFrom('name', Object.assign({}, atHost, { admitted: false })), 'a newcomer may introduce itself');
  assert(!R.acceptFrom('cohost-action', atHost), 'a plain trainee cannot ask the host to act');
  assert(R.acceptFrom('cohost-action', Object.assign({}, atHost, { coHost: true })), 'a co-host the host appointed can');
  assert(!R.acceptFrom('cohost-action', student), 'participants never take co-host actions');
  assert(R.acceptFrom('chat', student), 'classmates can chat');
  assert(!R.acceptFrom('chat', Object.assign({}, student, { admitted: false })), 'someone the host never announced is ignored');
  assert(R.acceptFrom('recording', student), 'anyone may say they are recording (it only warns)');
}

/* ---------- Who may join ---------- */
console.log('Admin Only and staff meetings are closed to others whatever code they hold');
{
  const adminOnly = { roomCode: 'X', access: 'adminonly' };
  const legacy = { roomCode: 'X' };                       // saved before access existed
  const allStaff = { roomCode: 'X', access: 'allstaff' };
  assert(!R.canJoinMeeting(adminOnly, 'student').allowed, 'a trainee is refused an Admin Only meeting');
  assert(!R.canJoinMeeting(adminOnly, 'instructor').allowed, 'an instructor is refused an Admin Only meeting');
  assert(R.canJoinMeeting(adminOnly, 'admin').allowed && R.canJoinMeeting(adminOnly, 'adminstaff').allowed, 'Administration may join');
  assert(!R.canJoinMeeting(legacy, 'student').allowed, 'a meeting with no access setting is Admin Only (as meetingAccess reads it)');
  assert(R.canJoinMeeting(allStaff, 'instructor').allowed, 'an instructor may join an All-Staff conference');
  assert(!R.canJoinMeeting(allStaff, 'student').allowed, 'a trainee may not');
  assert(R.canJoinMeeting(null, 'student').allowed, 'a class (not a staff meeting) is open to its code');
  assert(/Administration/.test(R.canJoinMeeting(adminOnly, 'student').reason), 'the refusal says why');
}

/* ---------- Who dials whom, and who sends video ---------- */
console.log('One connection per pair, and video only where it is shown');
{
  const a = 'cestis-ABC234-aaaaaa', b = 'cestis-ABC234-bbbbbb';
  assert(R.shouldInitiate(a, b) !== R.shouldInitiate(b, a), 'exactly one of a pair dials');
  const p2p = R.mediaPlan({ amHost: false, peerIsHost: false });
  assert(!p2p.sendVideo && !p2p.receiveVideo && p2p.sendAudio && p2p.receiveAudio, 'trainee to trainee: sound both ways, no video');
  const toHost = R.mediaPlan({ amHost: false, peerIsHost: true });
  assert(toHost.sendVideo && toHost.receiveVideo, 'trainee and instructor: picture and sound both ways');
  const fromHost = R.mediaPlan({ amHost: true, peerIsHost: false });
  assert(fromHost.sendVideo && fromHost.receiveVideo, 'the host sends to and sees everyone');
  // The 8-person room of the finding: each trainee's encodes go from 13 to 1.
  const n = 8, trainees = n - 1;
  const encodesBefore = 1 + 2 * (trainees - 1);   // host + two duplicate calls to each classmate
  const encodesAfter = [toHost].concat(new Array(trainees - 1).fill(p2p)).filter(p => p.sendVideo).length;
  assertEq(encodesBefore, 13, 'before: a trainee encoded video 13 times in an 8-person room');
  assertEq(encodesAfter, 1, 'after: once, for the instructor');
}

/* ---------- Mobile data: how people start, and what a muted mic costs ---------- */
console.log('Trainees start muted with the camera off; a muted microphone sends nothing');
{
  const t = R.startDevices('student');
  assert(!t.camera && !t.mic, 'a trainee starts with the camera off and the microphone muted');
  ['instructor', 'admin', 'adminstaff'].forEach(role => {
    const s = R.startDevices(role);
    assert(s.camera && s.mic, role + ' starts with camera and microphone on, as before');
  });
  assert(!R.sendSound(false, false), 'muted, nothing shared: no sound is sent at all');
  assert(R.sendSound(true, false), 'unmuted: sound is sent');
  assert(R.sendSound(false, true), 'muted but sharing a tab with sound: the tab is still heard');
  // Trainees still hear each other (a question asked aloud) — voice goes to
  // everyone; it is the MUTED microphone that now costs nothing.
  const p2p = R.mediaPlan({ amHost: false, peerIsHost: false });
  assert(p2p.sendAudio && p2p.receiveAudio && !p2p.sendVideo, 'classmates: sound both ways, never video');
}

console.log('Recordings are made at a set bitrate (about 270 MB an hour)');
{
  const o = R.recorderOptions('video/webm;codecs=vp9,opus');
  assertEq(o.mimeType, 'video/webm;codecs=vp9,opus', 'the chosen format is kept');
  assertEq(o.videoBitsPerSecond, 550000, 'picture at 550 kbit/s');
  assertEq(o.audioBitsPerSecond, 64000, 'sound at 64 kbit/s');
  assert(!('mimeType' in R.recorderOptions('')), 'no format named when the browser offered none');
  const mbh = R.recordingMBPerHour();
  assert(mbh >= 260 && mbh <= 290, 'about 270 MB an hour (' + mbh + ')');
  assert(mbh * 3 < 1100, 'under a third of the ~1.1 GB an hour recorded before');
}

console.log('The start screen suggests Large Class above 6 trainees, and says why');
{
  const VC = Core.vcCapacity;
  assertEq(VC.SUGGEST_LARGE_ABOVE, 6, 'the owner\'s threshold: about 6 trainees');
  [0, 1, 6].forEach(n => {
    assert(!VC.largeClassAdvice(n, { ownServer: true }).suggest && !VC.largeClassAdvice(n).suggest, n + ' trainees: the built-in room, no suggestion, with or without the Centre\'s own video server');
  });
  // The Centre has its own Large Class video server: Large Class first.
  const a = VC.largeClassAdvice(9, { ownServer: true });
  assert(a.suggest && a.largeFirst && a.trainees === 9, '9 trainees, the Centre\'s own server: Large Class first');
  assert(/^Large Class is suggested for 9 trainees: /.test(a.line) && /once per trainee/.test(a.line) && /less data/.test(a.line), 'in one plain line that says why: ' + a.line);
  assert(a.line.indexOf('\n') === -1 && a.line.length < 200, 'one line');
  // No server of its own (the public fallback cuts embedded meetings off
  // after a few minutes): the built-in room stays first, one line explains.
  const p = VC.largeClassAdvice(9);
  assert(p.suggest && !p.largeFirst, '9 trainees, no Centre server: the built-in room stays first');
  assert(/^For more than 6 trainees, Large Class saves everyone data once the Centre’s own video server is added in Settings → Video Conference\.$/.test(p.line), 'and one plain line says what to add: ' + p.line);
  assert(!VC.largeClassAdvice(9, { ownServer: 'yes' }).largeFirst && !VC.largeClassAdvice(9, {}).largeFirst, 'only a real "own server: yes" puts Large Class first');
  assert(!/cloud|google|drive|stored|kept/i.test(a.line + p.line), 'neither line says where anything is kept');
  assert(!VC.largeClassAdvice('x').suggest && !VC.largeClassAdvice(-3).suggest && !VC.largeClassAdvice(null).suggest, 'no size known: no suggestion');
  assert(VC.SUGGEST_LARGE_ABOVE < VC.MESH_MAX_VIDEO, 'suggested before the built-in room is full');
}

/* ---------- How much picture ---------- */
console.log('Phones send a smaller picture; the host shares a budget');
{
  const phone = R.videoProfile({ mobile: true });
  assert(phone.width <= 640 && phone.height <= 360 && phone.maxBitrate <= 400000, 'a trainee phone sends at most 640x360');
  const desk = R.videoProfile({ mobile: false });
  assert(desk.width < 1280 && desk.maxBitrate <= 600000, 'a trainee on a computer sends less than 720p');
  const host1 = R.videoProfile({ host: true, peers: 1 }), host8 = R.videoProfile({ host: true, peers: 8 });
  assert(host1.width === 1280 && host1.maxBitrate === 1200000, 'an instructor with one trainee sends 720p at 1.2 Mbps');
  assertEq(host8.maxBitrate, 625000, 'with eight trainees each copy gets a share of 5 Mbps');
  assertEq(R.videoProfile({ host: true, peers: 100 }).maxBitrate, 250000, 'never below 250 kbps a copy');
}

/* ---------- Reconnecting to the introduction service ---------- */
console.log('Reconnects wait longer each time');
{
  const d = [0, 1, 2, 3, 4, 5, 6, 10].map(a => R.backoffDelay(a, 0.5));
  assertEq(d.slice(0, 6).join(','), '1000,2000,4000,8000,16000,30000', '1 s, 2 s, 4 s … capped at 30 s');
  assertEq(d[7], 30000, 'and stays at the cap');
  assert(R.backoffDelay(0, 0) >= 750 && R.backoffDelay(0, 0.999) <= 1250, 'spread by at most a quarter either way');
  // The outage the finding measured: 31 attempts in 10 s from one tab.
  let t = 0, n = 0;
  while (true) { t += R.backoffDelay(n, 0); if (t > 10000) break; n++; }
  assert(n <= 4, 'at most 4 attempts in the first 10 s of an outage (was 31): ' + n);
}

/* ---------- Relay servers ---------- */
console.log('Relay (TURN) servers come from Settings, never from the code');
{
  const fs = require('fs'), path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert(!/openrelayproject/.test(page), 'the withdrawn public relay login is gone from the page');
  assert(!/turn:[^'"\s]+['"]\s*,\s*username\s*:/.test(page), 'no relay address with a login is written into the page');
  const parsed = R.parseIceServers('turn:relay.c.org:3478 alice s3cret\n# comment\n\nturns:relay.c.org:5349 alice two words\nstun:stun.c.org:3478');
  assertEq(parsed.errors.length, 0, 'well-formed lines parse');
  assertEq(parsed.servers.length, 3, 'three servers');
  assertEq(parsed.servers[0].username + '/' + parsed.servers[0].credential, 'alice/s3cret', 'username and password read');
  assertEq(parsed.servers[1].credential, 'two words', 'a password with a space is kept whole');
  assert(!('username' in parsed.servers[2]), 'a STUN line needs no login');
  assertEq(R.parseIceServers('turn:relay.c.org:3478\nhttp://x').errors.join(','), '1,2', 'a relay with no login, and a non-relay address, are reported by line');
  const stun = [{ urls: 'stun:a' }, { urls: 'stun:b' }, { urls: 'stun:c' }];
  assertEq(R.iceServers(stun, '').length, 3, 'with nothing configured: STUN only');
  const merged = R.iceServers(stun, 'turn:r1:3478 u p\nturn:r2:3478 u p\nturn:r3:3478 u p\nturn:r4:3478 u p');
  assert(merged.length <= 6, 'the list stays short (browsers slow down with long ones): ' + merged.length);
  assertEq(merged.filter(s => /^turn:/.test(s.urls)).length, 4, 'every configured relay is kept');
  assert(R.hasRelay('turn:r1:3478 u p') && !R.hasRelay('stun:x:1'), 'it can tell whether a relay is configured');
}

/* ---------- The Large Class server ---------- */
console.log('The Large Class server can be the Centre\'s own');
{
  assert(R.checkLargeRoomBase('').ok && R.checkLargeRoomBase('').publicJitsi, 'blank means the public service, and says so');
  const own = R.checkLargeRoomBase('meet.centre.org');
  assert(own.ok && own.base === 'https://meet.centre.org/' && !own.publicJitsi, 'a bare host becomes an https address');
  assertEq(R.checkLargeRoomBase('https://meet.centre.org/jitsi//').base, 'https://meet.centre.org/jitsi/', 'a path is kept, with one trailing slash');
  assert(!R.checkLargeRoomBase('http://meet.centre.org').ok, 'http is refused (no camera there)');
  assert(!R.checkLargeRoomBase('https://a b').ok, 'nonsense is refused');
  assert(R.checkLargeRoomBase('https://meet.jit.si').publicJitsi, 'meet.jit.si is flagged');
}

/* ---------- One class, one register record ---------- */
console.log('A Large Class is one record, whichever devices were in it');
{
  const T = h => '2026-03-04T' + h + ':00';            // local times
  // Exactly as the page does it: no id given, each device its own start time.
  const host = VS.startSession({ code: 'K4M9PQ', title: 'Welding', startedAt: T('09:00') });
  const guest = VS.startSession({ code: 'k4m9pq', title: 'Welding', startedAt: T('09:02') });
  assertEq(host.id, guest.id, 'host and trainee name the class the same way');
  assertEq(host.id, 'vcs-K4M9PQ-2026-03-04', 'by room code and day');
  VS.recordJoin(host, 'p1', 'Stefan', T('09:00'));
  VS.recordJoin(guest, 'p2', 'Tracy', T('09:02'));
  assertEq(VS.mergeSessions([host], [guest]).length, 1, 'the two devices\' records fold into one');
  assert(VS.sessionId('K4M9PQ', T('09:00')) !== VS.sessionId('K4M9PQ', '2026-03-05T09:00:00'), 'another day is another class');

  // The host steps out and comes back the same day: same record, nobody lost.
  const s = VS.startSession({ code: 'K4M9PQ', startedAt: T('09:00') });
  VS.recordJoin(s, 'p1', 'Stefan', T('09:00'));
  VS.recordJoin(s, 'p2', 'Tracy', T('09:05'));
  VS.endSession(s, T('09:30'));
  const elsewhere = JSON.parse(JSON.stringify(s));   // another device synced the ended copy
  VS.reopenSession(s, T('09:40'));
  assert(VS.isOpen(s), 'a reopened class is open again');
  VS.recordJoin(s, 'p2b', 'Tracy', T('09:41'));
  assertEq(s.participants.length, 2, 'reopening keeps everyone already recorded');
  const m = VS.mergeSessions([elsewhere], [s]);
  assertEq(m.length, 1, 'still one record');
  assert(VS.isOpen(m[0]), 'a copy that still says "ended" gives way to the reopening');
  VS.endSession(s, T('11:00'));
  const m2 = VS.mergeSessions([elsewhere], [s]);
  assert(!VS.isOpen(m2[0]) && m2[0].endedAt === T('11:00'), 'once ended again, it is ended everywhere');
}

console.log('A record a device never closed stops being "live"');
{
  const T = h => '2026-03-04T' + h + ':00.000Z';
  const s = VS.startSession({ code: 'K4M9PQ', startedAt: T('09:00') });
  VS.recordJoin(s, 'p1', 'Stefan', T('09:00'));
  VS.recordJoin(s, 'p2', 'Tracy', T('09:02'));
  assert(VS.isLive(s, T('09:30')), 'live while it is being touched');
  assert(!VS.isLive(s, T('10:00')), 'not live after 45 minutes of silence');
  assert(!VS.isLive(s, '2026-04-01T09:00:00.000Z'), 'and certainly not weeks later');
  assertEq(VS.liveFor([s], 'k4m9pq', T('09:30')), s, 'the room code finds the running class');
  assertEq(VS.liveFor([s], 'K4M9PQ', '2026-04-01T09:00:00.000Z'), null, 'weeks later the code is no longer sent to the hosted room');
  VS.touch(s, T('10:30'));
  assert(VS.isLive(s, T('11:00')), 'the host\'s heartbeat keeps a long class live');

  // The register shows a stale record as it stood, everyone credited to then.
  const stale = VS.startSession({ code: 'Q', startedAt: T('09:00') });
  VS.recordJoin(stale, 'p1', 'Stefan', T('09:00'));
  VS.recordJoin(stale, 'p2', 'Tracy', T('09:02'));
  VS.touch(stale, T('11:00'));
  const view = VS.displayView(stale, '2026-04-01T09:00:00.000Z');
  const sum = VS.summary(view);
  assertEq(sum.minutes, 120, 'the class is counted to its last activity');
  assertEq(sum.present, 2, 'everyone still in the room then is present (was 0 minutes each)');
  assertEq(stale.endedAt, '', 'the stored record is not changed by showing it');
  const list = [stale, VS.startSession({ code: 'Z', startedAt: '2026-04-01T08:50:00.000Z' })];
  assertEq(VS.closeStale(list, '2026-04-01T09:00:00.000Z'), 1, 'a host starting a class closes the stale one only');
  assertEq(stale.endedAt, T('11:00'), 'closed at its last activity, not at "now"');
  assertEq(list[1].endedAt, '', 'a class that is genuinely running is left alone');
}

console.log('Saving a join replaces one record, not the whole history');
{
  const history = [];
  for (let i = 0; i < 300; i++) {
    const old = VS.startSession({ code: 'C' + i, startedAt: '2025-01-01T09:00:00.000Z', id: 'old-' + i });
    for (let p = 0; p < 30; p++) VS.recordJoin(old, 'p' + p, 'Person ' + p, '2025-01-01T09:00:00.000Z');
    VS.endSession(old, '2025-01-01T11:00:00.000Z');
    history.push(old);
  }
  const before = history.slice();
  const live = VS.startSession({ code: 'LIVE', startedAt: '2026-03-04T09:00:00.000Z' });
  let list = history;
  const t0 = Date.now();
  for (let j = 0; j < 80; j++) {
    VS.recordJoin(live, 'n' + j, 'New ' + j, '2026-03-04T09:00:00.000Z');
    list = VS.upsertSession(list, live);
  }
  const ms = Date.now() - t0;
  assert(ms < 200, '80 joins into a 300-class history take well under a fifth of a second (' + ms + ' ms)');
  assertEq(list.length, 301, 'the live class is added once');
  assert(list === history && before.every((s, i) => list[i] === s), 'no earlier class is copied or replaced');
  assertEq(list[300], live, 'the live class is the very object being recorded');
}

/* ---------- Class sessions: live, completed, recorded ---------- */
console.log('Class sessions move scheduled -> live -> completed, and carry their recording');
{
  const sessions = [
    { id: 'CS1', name: 'Hair', roomCode: 'ABCDEFGHJK', date: '2026-10-20', status: 'scheduled', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'CS2', name: 'Other', roomCode: 'ZZZZZZ', date: '2026-10-20', status: 'scheduled' }
  ];
  const now = '2026-10-20T09:00:00.000Z';
  const r = R.setSessionStatus(sessions, 'abcdefghjk', 'live', now, '2026-10-20');
  assertEq(r && r.id, 'CS1', 'the session is found by its room code');
  assertEq(sessions[0].status, 'live', 'and is live');
  assertEq(sessions[0].updatedAt, now, 'stamped, so the newest edit wins on every other device');
  assertEq(sessions[1].status, 'scheduled', 'no other session is touched');
  assertEq(R.setSessionStatus(sessions, 'ABCDEFGHJK', 'live', now, '2026-10-20'), null, 'setting the same status again changes nothing');
  assertEq(R.setSessionStatus(sessions, 'NOPE', 'live', now, '2026-10-20'), null, 'an unscheduled code changes nothing');
  const att = R.attachRecording(sessions, 'ABCDEFGHJK', { url: 'https://drive.google.com/file/d/X/view', fileId: 'X', name: 'rec.webm' }, '2026-10-20T10:00:00.000Z', '2026-10-20');
  assertEq(att.recordingUrl, 'https://drive.google.com/file/d/X/view', 'the recording link is kept on the session');
  assertEq(att.status, 'live', 'a class still running stays live');
  R.setSessionStatus(sessions, 'ABCDEFGHJK', 'completed', '2026-10-20T10:30:00.000Z', '2026-10-20');
  assertEq(sessions[0].status, 'completed', 'and completes when the host closes it');
  const pastRecordings = sessions.filter(cs => cs.status === 'completed' && cs.recordingUrl);
  assertEq(pastRecordings.length, 1, 'which is exactly what Past Recordings lists');
  const sessions2 = [{ id: 'A', roomCode: 'R1', date: '2026-10-19', status: 'completed' }];
  assertEq(R.attachRecording(sessions2, 'R1', { url: 'https://x' }, now, '2026-10-20').status, 'completed', 'a finished class takes the recording as it is');
  assertEq(R.attachRecording(sessions2, 'R1', { url: '' }, now, '2026-10-20'), null, 'no link, nothing attached');
  const reused = [{ id: 'old', roomCode: 'R', date: '2026-10-01' }, { id: 'today', roomCode: 'R', date: '2026-10-20' }];
  assertEq(R.findClassSession(reused, 'R', '2026-10-20').id, 'today', 'a reused code finds today\'s session');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
