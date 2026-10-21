/* LMS Chat: who you are, who is in a room, what the realtime channel may do,
   what a logout leaves behind, and how much it downloads.

   What went wrong, and what these tests pin:
     - identity came from the display name (or "the first admin"): same-name
       trainees read each other's DMs, a second administrator posted as
       USR-001, unmatched people shared one 'unknown' identity;
     - an administrator could not remove anyone: the membership pass re-added
       them within 30 seconds, and trainees who moved programme stayed;
     - the realtime channel (a public broker) could create rooms, forge
       messages from anyone and trigger unlimited full-backup pulls;
     - call state was overwritten whole by each device: two joiners became
       one, a join without a microphone stayed listed for ever, an abandoned
       call never ended, and Decline re-rang every poll;
     - logout left the 3.5-second poll running, which wrote every room's
       history back onto the (shared) PC; each user's copy held every room;
     - the poll downloaded the whole chat file every 3.5 s on every page; read
       marks rewrote every message; uploaded attachments' bytes rode every
       upload; presence never went offline;
     - chat attachments were shared with "anyone with the link" and the
       download looked the file up by NAME (two "assignment.pdf"s — the wrong
       one opened); the course-ended lock only stopped text messages;
     - the chat-file merge ignored deletion tombstones and edit stamps.

   Run: node tests/chat-safety.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const pending = [];
const NOW = Date.parse('2026-10-21T15:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

PAGES.forEach(function (page) {
  const CH = page.core.chat, src = page.src;
  const w = page.where.replace('/index.html', '');

  /* ---------- 1. Identity ---------- */
  console.log('Chat knows you by your signed-in account (' + w + ')');
  {
    const accounts = [
      { id: 'USR-STU-111', name: 'John Brown', role: 'student', programme: 'Welding' },
      { id: 'USR-STU-222', name: 'John Brown', role: 'student', programme: 'Plumbing' },
      { id: 'USR-001', name: 'Administrator', role: 'admin' },
      { id: 'USR-777', name: 'Second Admin', role: 'admin' }
    ];
    const sb = { userAccounts: accounts, currentRole: 'student', currentLoggedInUser: { id: 'USR-STU-222' },
      currentStudent: { id: 'S2', name: 'John Brown', course: 'Plumbing' }, currentInstructor: null,
      lmsChatRooms: [{ id: 'dm-USR-I9-USR-STU-111', type: 'dm', members: ['USR-I9', 'USR-STU-111'] }] };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'lmsChatGetCurrentUser', w) + extractFunction(src, 'lmsChatGetUserRooms', w), sb);
    assertEq(vm.runInContext('lmsChatGetCurrentUser().id', sb), 'USR-STU-222', 'the second John Brown is himself');
    assertEq(vm.runInContext('lmsChatGetUserRooms().length', sb), 0, "and cannot see the first John's DM");
    sb.currentRole = 'admin'; sb.currentLoggedInUser = { id: 'USR-777' };
    assertEq(vm.runInContext('lmsChatGetCurrentUser().id', sb), 'USR-777', 'a second administrator is not USR-001');
    sb.currentRole = 'student'; sb.currentLoggedInUser = null; sb.currentStudent = { id: 'S9', name: 'Nobody Match', course: 'X' };
    const a = vm.runInContext('lmsChatGetCurrentUser().id', sb);
    sb.currentStudent = { id: 'S10', name: 'Other Nomatch', course: 'X' };
    const b = vm.runInContext('lmsChatGetCurrentUser().id', sb);
    assert(a !== 'unknown' && b !== 'unknown' && a !== b, 'two unmatched people never share one identity');
  }

  /* ---------- 2. Membership ---------- */
  console.log('Removal sticks; class rooms follow the programme (' + w + ')');
  {
    const accounts = [
      { id: 'USR-001', role: 'admin', status: 'active' },
      { id: 'STU-1', role: 'student', status: 'active', programme: 'Welding' },
      { id: 'STU-2', role: 'student', status: 'active', programme: 'Plumbing' },   // transferred out
      { id: 'STU-3', role: 'student', status: 'active', programme: 'Plumbing' },   // added by hand
      { id: 'STU-4', role: 'student', status: 'active', programme: '' }            // programme not known yet
    ];
    const room = { id: 'chat-class-1', type: 'class', members: ['USR-001', 'STU-1', 'STU-2', 'STU-3', 'STU-4'], removed: {}, manualMembers: { 'STU-3': 'x' } };
    const opts = { accounts, eligible: u => u.status === 'active', programmeMatches: u => u.programme === 'Welding' };
    let out = CH.classRoomMembers(room, opts);
    assertEq(out.members.join(), 'USR-001,STU-1,STU-3,STU-4', 'the transferred trainee leaves; hand-added and unknown-programme members stay');
    assertEq(out.leavers.join(), 'STU-2', 'the leaver is recorded (messages untouched)');
    room.removed['STU-1'] = '2026-10-21';
    out = CH.classRoomMembers(room, opts);
    assert(out.members.indexOf('STU-1') === -1, 'a trainee an administrator removed is not re-added by the membership pass');

    const sb = { lmsChatRooms: [{ id: 'R1', type: 'class', members: ['USR-001', 'STU-1'] }], saved: 0, saveLmsChatData() { sb.saved++; } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'lmsChatToggleMember', w), sb);
    vm.runInContext('lmsChatToggleMember("R1", "STU-1", false)', sb);
    assert(sb.lmsChatRooms[0].removed && sb.lmsChatRooms[0].removed['STU-1'] && sb.lmsChatRooms[0].updatedAt, 'removing writes it on the room, stamped, so it travels');
    vm.runInContext('lmsChatToggleMember("R1", "STU-1", true)', sb);
    assert(!sb.lmsChatRooms[0].removed['STU-1'] && sb.lmsChatRooms[0].members.indexOf('STU-1') !== -1, 're-adding undoes the removal');
    assert(/CESTISCore\.chat\.classRoomMembers\(/.test(extractFunction(src, 'lmsChatEnsureMembership', w)), 'the membership pass uses the rule');
    assert(/room\.removed && room\.removed\[user\.id\]/.test(extractFunction(src, 'lmsChatGetUserRooms', w)), 'the programme fallback honours a removal');
  }

  /* ---------- 3. Realtime channel ---------- */
  console.log('The realtime channel cannot forge or create (' + w + ')');
  {
    const room = { id: 'chat-admin', type: 'admin', members: ['USR-001', 'USR-STU-9'] };
    const sb = {
      CESTISCore: page.core, userAccounts: [{ id: 'USR-001', role: 'admin' }, { id: 'USR-STU-9', role: 'student' }, { id: 'USR-STU-5', role: 'student' }],
      lmsChatRooms: [room], lmsChatMessages: { 'chat-admin': [] }, lmsChatActiveRoom: null, lmsChatDMNotifThrottle: {},
      saves: 0, saveLmsChatData() { sb.saves++; }, lmsChatGetCurrentUser() { return { id: 'USR-001' }; },
      lmsChatGetRolePrefix() { return 'admin'; }, lmsChatRenderRoomList() {}, lmsChatRenderMessages() {}, document: { getElementById() { return null; } },
      cestisRTHandleNotify() { sb.notified = true; }, cestisRTHandleNudge() { sb.nudged = (sb.nudged || 0) + 1; },
      _lmsChatPollTimer: null, _lmsChatPollIdle: 0, lmsChatSchedulePoll() { sb.pulled = true; }
    };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'lmsChatRTUidFromPeerId', w) + extractFunction(src, 'lmsChatRTHandleData', w), sb);
    const msg = { id: 'm1', roomId: 'chat-admin', senderId: 'USR-STU-9', senderName: 'Real', text: 'please reset my grade', type: 'text', timestamp: new Date().toISOString() };
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'chat-msg', msg }) + ', "lmsrt-USRSTU5")', sb);
    assertEq(sb.lmsChatMessages['chat-admin'].length, 0, 'a message claiming another sender is dropped');
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'chat-msg', msg }) + ', "lmsrt-OUTSIDER")', sb);
    assertEq(sb.lmsChatMessages['chat-admin'].length, 0, 'a peer that is no account here is ignored');
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'data-nudge' }) + ', "lmsrt-OUTSIDER")', sb);
    assert(!sb.nudged, "an outsider's nudge triggers no pull");
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'chat-msg', msg: { id: 'm2', roomId: 'dm-evil', senderId: 'USR-STU-9', text: 'x' }, room: { id: 'dm-evil', name: '<img src=x onerror=alert(1)>', members: ['USR-001', 'USR-STU-9'] } }) + ', "lmsrt-USRSTU9")', sb);
    assertEq(sb.lmsChatRooms.length, 1, 'no room is ever created from the channel');
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'chat-msg', msg: Object.assign({}, msg, { type: 'file', fileData: 'data:,x' }) }) + ', "lmsrt-USRSTU9")', sb);
    assertEq(sb.lmsChatMessages['chat-admin'].length, 0, 'files do not arrive over the channel');
    vm.runInContext('lmsChatRTHandleData(' + JSON.stringify({ type: 'chat-msg', msg: Object.assign({}, msg, { extra: '<b>' }) }) + ', "lmsrt-USRSTU9-ab12")', sb);
    assertEq(sb.lmsChatMessages['chat-admin'].length, 1, 'a member\'s own plain message is shown');
    assertEq(Object.keys(sb.lmsChatMessages['chat-admin'][0]).sort().join(), 'id,readBy,roomId,senderId,senderName,text,timestamp,type', 'only the known fields are kept');
    assert(!/room: \{/.test(extractFunction(src, 'lmsChatRTSend', w)), 'outgoing messages no longer carry the room and its member list');
    assert(/_cestisLastNudgePull/.test(extractFunction(src, 'cestisRTHandleNudge', w)), 'nudge pulls are rate-limited');
    assert(/lmsChatPeerOptions\(\)/.test(extractFunction(src, 'lmsChatRTStart', w)), "chat uses the Centre's conference server when Settings names one");
  }

  /* ---------- 4. Presence ---------- */
  console.log('Presence is a heartbeat (' + w + ')');
  assertEq(CH.isOnline({ status: 'online', lastSeen: iso(60 * 1000) }, NOW), true, 'seen a minute ago is online');
  assertEq(CH.isOnline({ status: 'online', lastSeen: iso(60 * 60 * 1000) }, NOW), false, 'seen an hour ago is not');
  assertEq(CH.isOnline({ status: 'online' }, NOW), false, "'online' set once and never cleared is not online");
  assertEq(CH.isOnline({ status: 'offline', lastSeen: iso(1000) }, NOW), false, 'signed off is offline');
  assert(/CESTISCore\.chat\.isOnline\(/.test(extractFunction(src, 'lmsChatRTTargets', w)), 'the realtime sweep dials only people seen recently');

  /* ---------- 5. Calls ---------- */
  console.log('Calls: per-person state (' + w + ')');
  {
    const base = { type: 'voice', startedBy: 'A', startedAt: iso(60000), participants: ['A'], seen: { A: iso(5000) }, left: {} };
    const devB = JSON.parse(JSON.stringify(base)); CH.joinCall(devB, 'B', iso(2000));
    const devC = JSON.parse(JSON.stringify(base)); CH.joinCall(devC, 'C', iso(1000));
    const m = CH.mergeActiveCall(devB, devC, NOW);
    assertEq(m.participants.sort().join(), 'A,B,C', 'two people joining together are both kept');
    const left = JSON.parse(JSON.stringify(m)); CH.leaveCall(left, 'B', iso(500));
    assertEq(CH.mergeActiveCall(left, m, NOW).participants.sort().join(), 'A,C', 'hanging up is not undone by an older copy');
    const ghost = { type: 'voice', startedBy: 'A', startedAt: iso(3600000), participants: ['A'], seen: { A: iso(10 * 60000) } };
    assertEq(CH.mergeActiveCall(ghost, null, NOW), null, 'a call whose last heartbeat is long gone ends');
    const legacy = { type: 'voice', startedBy: 'A', startedAt: iso(3 * 3600000), participants: ['A', 'B'] };
    assertEq(CH.mergeActiveCall(legacy, legacy, NOW), null, 'an old call from before heartbeats ends too');
    const join = extractFunction(src, 'lmsChatJoinCall', w);
    assert(join.indexOf('CESTISCore.chat.joinCall(') > join.indexOf('lmsChatRequestMedia('), 'a joiner is listed only after media is granted');
    assert(/lmsChatDeclinedCalls\[ck\]/.test(extractFunction(src, 'lmsChatCheckForActiveCalls', w)) && /lmsChatDeclinedCalls\[/.test(extractFunction(src, 'lmsChatDeclineIncomingCall', w)), 'Decline is remembered and the popup does not re-ring');
    assert(/mergeActiveCall\(/.test(extractFunction(src, 'lmsChatSyncFromDrive', w)), 'the chat-file merge merges call state per person');
  }

  /* ---------- 6. Logout ---------- */
  console.log('Logout stops the poll and leaves no one else\'s chats behind (' + w + ')');
  {
    const sb = { isCloudConnected: true, googleAccessToken: 'tok', _sessionWiped: true, currentRole: null, fetched: 0,
      fetch() { sb.fetched++; return Promise.resolve({ ok: true, json: () => ({}) }); } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'lmsChatSyncFromDrive', w) + extractFunction(src, 'lmsChatSyncToDrive', w), sb);
    pending.push(Promise.all([vm.runInContext('lmsChatSyncFromDrive()', sb), vm.runInContext('lmsChatSyncToDrive()', sb)]).then(function (r) {
      assertEq(sb.fetched, 0, 'after logout neither the pull nor the push touches Drive (or this PC)');
      assertEq(r[1], false, 'and the push reports it did nothing');
    }));
    const lo = extractFunction(src, 'logout', w);
    assert(/lmsChatSignOff\(\)/.test(lo), 'logout signs chat off before the wipe');
    const off = extractFunction(src, 'lmsChatSignOff', w);
    assert(/lmsChatStopPolling\(\)/.test(off) && /status = 'offline'/.test(off), 'signing off stops the poll and sets presence offline');
    assert(/voctrain_user_' \+ _leavingUserId/.test(lo) && /_leavingRole === 'student'/.test(lo), "a trainee's own chat copy is removed once it is safely on Drive");
    const tick = extractFunction(src, 'lmsChatPollTick', w);
    assert(/if \(!currentRole \|\| _sessionWiped\) return;/.test(tick), 'the poll ends itself once signed out');

    // Per-user copy: only my rooms, uploaded bytes stripped.
    const store = {};
    const sb2 = {
      CESTISCore: page.core, currentLoggedInUser: { id: 'STU-1' }, currentRole: 'student',
      lmsChatMessages: { mine: [{ id: 'm1', driveFileId: 'D1', fileData: 'data:,BIG' }, { id: 'm2', fileData: 'data:,ONLYCOPY' }], theirs: [{ id: 'm3', text: 'private DM' }] },
      lmsChatProfiles: {}, lmsChatFollows: {}, lmsChatRooms: [], studentProfiles: {}, notifications: [],
      lmsChatGetUserRooms() { return [{ id: 'mine' }]; },
      CESTISStore: { setItem(k, v) { store[k] = v; } }, console: { warn() {} }
    };
    vm.createContext(sb2);
    vm.runInContext(extractFunction(src, 'savePerUserLocalData', w), sb2);
    vm.runInContext('savePerUserLocalData()', sb2);
    const copy = JSON.parse(store['voctrain_user_STU-1_chatMessages']);
    assertEq(Object.keys(copy).join(), 'mine', "another person's DM is not copied under this user's key");
    assertEq(copy.mine[0].fileData, undefined, 'bytes Drive already holds are not copied');
    assertEq(copy.mine[1].fileData, 'data:,ONLYCOPY', 'bytes that are the only copy are kept');
  }

  /* ---------- 7. Bandwidth ---------- */
  console.log('The chat file is fetched only when it changed (' + w + ')');
  {
    const pull = extractFunction(src, 'lmsChatSyncFromDrive', w);
    assert(pull.indexOf("fields=modifiedTime") !== -1 && pull.indexOf("fields=modifiedTime") < pull.indexOf('?alt=media'), 'it asks whether the file changed before downloading it');
    assert(/_mt === _lmsChatLastModified\) return/.test(pull), 'and skips the download when it did not');
    assert(/CESTISCore\.sync\.mergeList\(lmsChatRooms, data\.chatRooms, syncKeyById, \{ tombs: syncTombsFor\('chatRooms'\) \}\)/.test(pull) && !/data\.chatRooms\.concat\(/.test(pull), 'rooms merge by edit stamp and honour deletions');
    const delay = extractFunction(src, 'lmsChatPollDelay', w);
    assert(/document\.hidden\) return 60000/.test(delay) && /lmsChatOnChatPage\(\)\) return 20000/.test(delay) && /Math\.pow\(1\.5/.test(delay), 'it polls rarely when hidden or off the chat page, and slows while idle');
    assert(/stripUploadedBytes\(lmsChatMessages\)/.test(extractFunction(src, 'lmsChatSyncToDrive', w)), 'uploaded attachments travel as links in the chat file');
    assert(/stripUploadedBytes\(lmsChatMessages\)/.test(extractFunction(src, 'autoSaveToAllFolders', w)), 'and in the main backup');
    const strip = CH.stripUploadedBytes({ r: [{ id: 'a', driveFileId: 'D', fileData: 'data:,x' }, { id: 'b', fileData: 'data:,y' }] });
    assert(strip.r[0].fileData === undefined && strip.r[1].fileData === 'data:,y', 'only bytes with a Drive copy are left out');
    const open = extractFunction(src, 'lmsChatOpenRoom', w);
    assert(!/m\.readBy\.push/.test(open) && /lastRead/.test(open), 'opening a room records one read mark, not one per message');
    assertEq(CH.unreadCount([{ senderId: 'X', timestamp: iso(5000) }, { senderId: 'X', timestamp: iso(1000) }], 'ME', iso(3000)), 1, 'unread counts what came after my read mark');
    assertEq(CH.unreadCount([{ senderId: 'X', timestamp: iso(5000), readBy: ['ME'] }], 'ME', null), 0, 'the old per-message marks still count');
    assert(/LMS_CHAT_MAX_FILE_BYTES/.test(extractFunction(src, 'lmsChatHandleFileUpload', w)), 'chat files have a size limit');
    assert(/toDataURL\('image\/jpeg'/.test(extractFunction(src, 'lmsChatHandleProfilePic', w)), 'profile photos are shrunk before they are stored');
  }

  /* ---------- 8. Attachments, locks, deletion ---------- */
  console.log('Attachments are private and opened by message; the course lock covers everything (' + w + ')');
  {
    assert(!/type: 'anyone'/.test(extractFunction(src, 'lmsChatUploadFileToDrive', w)), 'chat files are not shared with "anyone with the link"');
    const clicked = [];
    const sb = {
      lmsChatActiveRoom: 'R', lmsChatMessages: { R: [
        { id: 'm1', fileName: 'assignment.pdf', fileData: 'data:,ANN' },
        { id: 'm2', fileName: 'assignment.pdf', fileData: 'data:,BOB' }] },
      document: { createElement() { return { click() { clicked.push(this.href); } }; } },
      cestisOpenDriveFile() {}, showToast() {}
    };
    vm.createContext(sb);
    vm.runInContext(extractFunction(src, 'lmsChatDownloadFile', w), sb);
    vm.runInContext('lmsChatDownloadFile("m2", "assignment.pdf")', sb);
    assertEq(clicked[0], 'data:,BOB', "two files with the same name: the one clicked opens, not the first one");
    ['lmsChatHandleFileUpload', 'lmsChatSendPoll', 'lmsChatVotePoll', 'lmsChatInitiateCall', 'lmsChatJoinCall'].forEach(fn =>
      assert(/lmsChatBlockedByCourseEnd\(/.test(extractFunction(src, fn, w)), fn + ' respects the course-ended lock'));
    assert(/administrators can still see what it said/.test(extractFunction(src, 'lmsChatDeleteMessage', w)), 'deleting tells the person administrators can still read it');
  }
});

Promise.all(pending).catch(e => assert(false, 'async check threw: ' + (e && e.stack || e))).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
