/* The conference room's page code, run in Node against the REAL functions
   lifted out of index.html (nothing re-implemented), with fake PeerJS, DOM,
   timers and media objects.
   Run: node tests/vc-page.test.js

   It pins, each of which used to go wrong:
     - Exit, a page change or logout "destroyed" the peer, but PeerJS fires
       'disconnected' BEFORE marking it destroyed and the handler reconnected
       it — the zombie kept the room id, so the instructor could not rejoin;
     - an outage made every tab reconnect about three times a second;
     - any participant's end-meeting / kick / mute / promote was obeyed;
     - the host answered every media call before anyone was admitted, and
       turned-away trainees still exchanged video with the host;
     - 'room-full' called a vcLeaveRoom() that does not exist;
     - a picture that arrived before the room was drawn was thrown away (the
       trainee never saw or heard the instructor);
     - calls were placed without asking to receive, so a trainee without a
       camera (or who switched it off in the lobby) got no picture;
     - trainees sent video to each other's hidden tiles;
     - the recording missed an instructor muted at the start and anyone who
       joined later, and nobody was told it was recording;
     - leaving the page left a Large Class frame running with camera and mic;
     - a trainee's device kept its own register record of a Large Class;
     - an apostrophe in a class name broke the trainee's Join button. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(SRC);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = SRC.indexOf('{', m.index); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (!depth) return SRC.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* ---------- fakes ---------- */
function makeTimers() {
  let now = 0, seq = 0;
  const q = [];
  return {
    setTimeout(fn, ms) { const id = ++seq; q.push({ id, at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { const i = q.findIndex(t => t.id === id); if (i >= 0) q.splice(i, 1); },
    setInterval() { return 0; }, clearInterval() {},
    advance(ms) {
      const until = now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        if (!q.length || q[0].at > until) break;
        const t = q.shift(); now = t.at; t.fn();
      }
      now = until;
    },
    get now() { return now; }
  };
}
class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return this; }
  emit(ev, ...a) { (this.h[ev] || []).slice().forEach(f => f(...a)); }
}
// PeerJS 1.5.4's order: destroy() -> disconnect() emits 'disconnected' -> only
// then is the peer marked destroyed.
class FakePeer extends Emitter {
  constructor(id, opts) { super(); this.id = id; this.opts = opts; this.destroyed = false; this.disconnected = false; this.reconnects = 0; FakePeer.all.push(this); }
  disconnect() { this.disconnected = true; this.emit('disconnected', this.id); }
  destroy() { if (this.destroyed) return; this.disconnect(); this.destroyed = true; }
  reconnect() { this.reconnects++; this.disconnected = false; }
}
FakePeer.all = [];
class FakeTrack { constructor(kind, enabled) { this.kind = kind; this.enabled = enabled !== false; this.id = kind + Math.random().toString(36).slice(2, 7); this.readyState = 'live'; } stop() { this.readyState = 'ended'; } }
class FakeStream {
  constructor(tracks) { this.tracks = (tracks || []).slice(); }
  getTracks() { return this.tracks.slice(); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  addTrack(t) { this.tracks.push(t); }
  removeTrack(t) { this.tracks = this.tracks.filter(x => x !== t); }
}

// A small DOM: enough for the room's tiles.
function makeDom() {
  const byId = {};
  function el(tag) {
    const e = {
      tagName: tag, children: [], style: {}, dataset: {}, parent: null, _id: '', innerHTML: '', textContent: '',
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { (on === undefined ? !this.set.has(c) : on) ? this.set.add(c) : this.set.delete(c); } },
      setAttribute() {}, addEventListener() {}, removeEventListener() {},
      play() { return Promise.resolve(); },
      appendChild(c) { c.parent = e; e.children.push(c); if (c._id) byId[c._id] = c; return c; },
      insertBefore(c, ref) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); const j = e.children.indexOf(ref); e.children.splice(j < 0 ? 0 : j, 0, c); c.parent = e; if (c._id) byId[c._id] = c; return c; },
      remove() { if (e.parent) e.parent.children = e.parent.children.filter(x => x !== e); delete byId[e._id]; },
      querySelector() { return null; }, querySelectorAll() { return []; },
      get firstChild() { return e.children[0] || null; }
    };
    Object.defineProperty(e, 'id', { get() { return e._id; }, set(v) { e._id = v; } });
    return e;
  }
  const doc = {
    byId,
    getElementById(id) { return byId[id] || null; },
    createElement(tag) { return el(tag); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {},
    body: el('body'),
    add(id, tag) { const e = el(tag || 'div'); e.id = id; byId[id] = e; return e; }
  };
  return doc;
}

function sandbox(extra) {
  const sb = Object.assign({
    console: { log() {}, warn() {}, error() {} }, JSON, Math, Date, Object, Array, String, Number, RegExp, Promise, Set, Map, Error,
    CESTISCore: Core, MediaStream: FakeStream, RTCPeerConnection: function () {},
    showToast() {}, saveState() {}, alert() {}, confirm() { return true; },
    location: { hostname: 'localhost', port: '', protocol: 'https:' }
  }, extra || {});
  sb.window = sb;
  vm.createContext(sb);
  return sb;
}
function load(sb, names) { names.forEach(n => vm.runInContext(extractFunction(n), sb)); }
function run(sb, code) { return vm.runInContext(code, sb); }

/* ====================================================================== */
console.log('Leaving the room releases its id; the service is never hammered');
{
  const t = makeTimers();
  FakePeer.all = [];
  const sb = sandbox({ Peer: FakePeer, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, systemSettings: {}, vcUpdateStatus() {} });
  run(sb, 'var rtcPeer = null, vcReconnectTimer = null, vcSameOriginSignalling = false, VC_SIGNALLING_TIMEOUT_MS = 12000, VC_ICE_SERVERS = [{urls:"stun:x"}];');
  load(sb, ['vcParseSignallingHost', 'vcSignallingCandidates', 'vcIceServers', 'vcCreatePeer', 'vcScheduleReconnect', 'vcDestroyPeer']);
  let opened = 0;
  run(sb, 'vcCreatePeer("cestis-REJ234-host", function(){}, { onOpen: function(){ __opened(); } })'.replace('__opened()', 'globalThis.__o = (globalThis.__o||0)+1'));
  const p = FakePeer.all[0];
  p.emit('open', p.id);
  opened = run(sb, 'globalThis.__o');
  assertEq(opened, 1, 'the room opens once');
  // Exit: the page destroys its peer.
  run(sb, 'vcDestroyPeer()');
  t.advance(60000);
  assertEq(p.reconnects, 0, 'a destroyed peer is never reconnected (it used to come straight back, holding the room id)');
  assertEq(run(sb, 'rtcPeer'), null, 'and the page no longer holds it');

  // The same with a bare destroy() — the order PeerJS itself uses.
  FakePeer.all = [];
  run(sb, 'vcCreatePeer("cestis-REJ234-host", function(){}, {})');
  const p2 = FakePeer.all[0];
  p2.emit('open', p2.id);
  p2.destroy();
  t.advance(60000);
  assertEq(p2.reconnects, 0, 'even when destroy() announces "disconnected" before marking itself destroyed');

  // A genuine drop of the introduction service: reconnect, waiting longer each time.
  FakePeer.all = [];
  run(sb, 'vcCreatePeer("cestis-NET234-host", function(){}, { onOpen: function(){ globalThis.__o2 = (globalThis.__o2||0)+1; } })');
  const p3 = FakePeer.all[0];
  p3.emit('open', p3.id);
  p3.disconnect();                       // service dropped us
  t.advance(700);
  assertEq(p3.reconnects, 0, 'no reconnect within the first 0.7 s');
  t.advance(600);
  assertEq(p3.reconnects, 1, 'one reconnect after about a second');
  p3.disconnected = true; p3.emit('error', { type: 'network' });
  t.advance(1400);
  assertEq(p3.reconnects, 1, 'the second wait is longer');
  t.advance(1200);
  assertEq(p3.reconnects, 2, 'second reconnect after about two seconds');
  let n = p3.reconnects;
  for (let i = 0; i < 20; i++) { p3.disconnected = true; p3.emit('error', { type: 'network' }); t.advance(1000); }
  assert(p3.reconnects - n <= 4, 'an outage of 20 s costs a handful of attempts, not 60 (' + (p3.reconnects - n) + ')');
  p3.emit('open', p3.id);
  assertEq(run(sb, 'globalThis.__o2'), 1, 'coming back online does not redraw (and empty) the room');
}

console.log('Start, Rejoin and Join let go of any earlier peer first');
{
  ['vcCreateRoom', 'vcRejoinRoom', 'vcJoinRoom'].forEach(fn => {
    const body = extractFunction(fn);
    const d = body.indexOf('vcDestroyPeer()');
    const c = Math.max(body.indexOf('vcCreatePeer('), body.indexOf('vcStartHostPeer('));
    assert(d > 0 && c > d, fn + ' destroys the previous peer before registering a new one');
  });
  const join = extractFunction('vcJoinRoom');
  assert(/if \(joined\) return;[\s\S]*vcDestroyPeer\(\)/.test(join), 'a Join that fails (host not there) releases its id');
}

/* ====================================================================== */
function roomSandbox(opts) {
  const calls = { exit: [], alerts: [], admit: [], connect: [], chat: [], action: [], share: [], banner: 0 };
  const mic = new FakeTrack('audio');
  const sb = sandbox({
    exitVideoRoom(r) { calls.exit.push(r); }, alert(m) { calls.alerts.push(m); },
    vcUpdateParticipants() {}, vcUpdateVideoLabel() {}, vcRefreshHostControls() {}, vcStopHostReconnect() {}, vcUpdateStatus() {},
    vcConnectToPeer(id) { calls.connect.push(id); }, vcAdmitPeer(id) { calls.admit.push(id); return true; },
    vcDisplayChat(sender, text) { calls.chat.push(sender + ': ' + text); }, vcRefreshRecordingBanner() { calls.banner++; },
    vcSetRemoteCamState() {}, vcRemoveVideo() {}, vcEnterScreenShareView(id) { calls.share.push(id); }, vcExitScreenShareView() {},
    vcDoHostAction(a, p) { calls.action.push(a + ':' + p); },
    document: { getElementById() { return null; } }
  });
  run(sb, 'var peerNames = {}, peerRoles = {}, mutedPeers = {}, vcCoHosts = {}, vcAdmitted = {}, dataConnections = {}, peerConnections = {},' +
    ' vcDialling = {}, vcRemoteRecorders = {}, vcPendingConns = {}, vcIsCoHost = false, vcRefusedByHost = false, vcHostPermissions = {screenShare:false, recording:false},' +
    ' vcCurrentRole = "student", currentRoomCode = "ABC234", isRoomHost = ' + (opts.host ? 'true' : 'false') + ', rtcPeer = {id: "' + (opts.host ? 'cestis-ABC234-host' : 'cestis-ABC234-me0001') + '"};');
  sb.localStream = new FakeStream([mic]);
  load(sb, ['vcHostPeerId', 'vcCleanPeerName', 'vcCleanPeerRole', 'sanitizePeerId', 'vcOnData']);
  return { sb, calls, mic };
}
const HOST = 'cestis-ABC234-host', STU = 'cestis-ABC234-zz9abc', STU2 = 'cestis-ABC234-yy8abc';
const msg = o => JSON.stringify(o);

console.log('A participant obeys the host, and only the host');
{
  const { sb, calls, mic } = roomSandbox({ host: false });
  run(sb, 'vcAdmitted["' + HOST + '"] = true; vcAdmitted["' + STU + '"] = true; peerNames["' + STU + '"] = "Shane O\'Brien";');
  sb.vcOnData(msg({ type: 'end-meeting' }), STU);
  sb.vcOnData(msg({ type: 'kick' }), STU);
  assertEq(calls.exit.length, 0, "a classmate's end-meeting and kick are ignored (they used to throw everyone out)");
  sb.vcOnData(msg({ type: 'force-mute' }), STU);
  sb.vcOnData(msg({ type: 'mute-all' }), STU);
  assert(mic.enabled, "a classmate cannot mute me");
  sb.vcOnData(msg({ type: 'promote-host' }), STU);
  assert(!run(sb, 'vcIsCoHost') && !run(sb, 'isRoomHost'), 'a classmate cannot make me (or themselves) a host');
  sb.vcOnData(msg({ type: 'new-peer', peerId: 'cestis-ABC234-evil01' }), STU);
  sb.vcOnData(msg({ type: 'peer-list', peers: [{ peerId: 'cestis-ABC234-evil02' }] }), STU);
  assertEq(calls.connect.length, 0, 'only the host introduces people');
  sb.vcOnData(msg({ type: 'chat', sender: 'The Instructor', text: 'hi' }), STU);
  assertEq(calls.chat[0], "Shane O'Brien: hi", 'chat shows the sender\'s announced name, not the name a message claims');
  sb.vcOnData(msg({ type: 'chat', sender: 'x', text: 'hi' }), 'cestis-ABC234-stranger');
  assertEq(calls.chat.length, 1, 'someone the host never announced is not heard');
  sb.vcOnData(msg({ type: 'screen-share-started' }), STU);
  assertEq(calls.share.length, 0, 'a classmate cannot take over the screen');

  sb.vcOnData(msg({ type: 'force-mute' }), HOST);
  assert(!mic.enabled, 'the host can mute me');
  sb.vcOnData(msg({ type: 'peer-list', peers: [{ peerId: STU2, name: 'B', role: 'instructor' }] }), HOST);
  assertEq(calls.connect.join(','), STU2, 'the host introduces people');
  sb.vcOnData(msg({ type: 'recording', on: true, by: 'Teacher' }), HOST);
  assert(run(sb, 'vcRemoteRecorders["' + HOST + '"]') && calls.banner > 0, 'everyone is told when the host starts recording');
  sb.vcOnData(msg({ type: 'recording', on: true, by: 'x', peerId: STU }), HOST);
  assert(run(sb, '!!vcRemoteRecorders["' + STU + '"]'), 'the host passes on, to a late joiner, who else is recording');
  sb.vcOnData(msg({ type: 'promote-host', by: 'Teacher' }), HOST);
  assert(run(sb, 'vcIsCoHost') && !run(sb, 'isRoomHost'), 'the host can appoint a co-host, who stays a participant');
  sb.vcOnData(msg({ type: 'end-meeting' }), HOST);
  assertEq(calls.exit.length, 1, 'the host can end the meeting');
  assert(run(sb, 'vcRefusedByHost'), 'and the trainee does not then wait for the host to "return"');
}

console.log('Turned away from a full room: leave, once');
{
  const { sb, calls } = roomSandbox({ host: false });
  run(sb, 'vcAdmitted["' + HOST + '"] = true;');
  sb.vcOnData(msg({ type: 'room-full', cap: 8, reason: 'This room is full.' }), HOST);
  assertEq(calls.exit.length, 1, 'the refused trainee leaves the room');
  assertEq(calls.alerts.length, 1, 'and is told once');
  assert(run(sb, 'vcRefusedByHost'), 'and will not reconnect to be refused again');
  assert(!/vcLeaveRoom\s*\(/.test(SRC), 'nothing calls the vcLeaveRoom() that never existed');
}

console.log('The host takes no orders, and hears only people it let in');
{
  const { sb, calls } = roomSandbox({ host: true });
  run(sb, 'vcAdmitted["' + STU + '"] = true;');
  sb.vcOnData(msg({ type: 'end-meeting' }), STU);
  sb.vcOnData(msg({ type: 'kick' }), STU);
  sb.vcOnData(msg({ type: 'permission-update', permission: 'recording', granted: true }), STU);
  assertEq(calls.exit.length, 0, 'nobody can end the meeting on the host');
  assert(!run(sb, 'vcHostPermissions.recording'), 'nobody can grant themselves recording');
  sb.vcOnData(msg({ type: 'chat', sender: 'x', text: 'eavesdropper' }), 'cestis-ABC234-notin');
  assertEq(calls.chat.length, 0, 'a connection that has not been let in is not heard');
  sb.vcOnData(msg({ type: 'name', name: 'New', role: 'student', uid: 'S9' }), 'cestis-ABC234-newbie');
  assertEq(calls.admit.join(','), 'cestis-ABC234-newbie', "a newcomer's introduction goes to admission");
  sb.vcOnData(msg({ type: 'cohost-action', action: 'kick', peerId: STU2 }), STU);
  assertEq(calls.action.length, 0, 'a plain trainee cannot have the host remove someone');
  run(sb, 'vcCoHosts["' + STU + '"] = true;');
  sb.vcOnData(msg({ type: 'cohost-action', action: 'kick', peerId: STU2 }), STU);
  assertEq(calls.action.join(','), 'kick:' + STU2, "the host carries out its co-host's request");
}

/* ====================================================================== */
console.log('Admission: the host lets people in, or turns them away with the reason');
{
  function hostSb(meetings, capOk) {
    const sent = {};
    const conns = {};
    function conn(id) { sent[id] = []; return (conns[id] = { peer: id, open: true, closed: false, send(m) { sent[id].push(JSON.parse(m)); }, close() { this.closed = true; } }); }
    const t = makeTimers();
    const core = Object.assign({}, Core, { vcCapacity: Object.assign({}, Core.vcCapacity, capOk === false ? { canJoinMesh() { return { allowed: false, cap: 2, reason: 'This room is full.' }; } } : {}) });
    const sb = sandbox({ CESTISCore: core, setTimeout: t.setTimeout, vcRemoveVideo() {}, adminMeetings: meetings || [], screenStream: null });
    run(sb, 'var peerNames = {}, peerRoles = {}, vcCoHosts = {}, vcAdmitted = {}, vcRefusedPeers = {}, vcKickedUids = {}, vcPendingConns = {}, vcPeerUids = {},' +
      ' dataConnections = {}, peerConnections = {}, vcRemoteRecorders = {}, vcIsRecording = false, vcHostPermissions = {screenShare:false, recording:false},' +
      ' vcCurrentRole = "admin", vcCurrentUserName = "Admin", currentRoomCode = "MEET234567", isRoomHost = true, rtcPeer = {id: "cestis-MEET234567-host"},' +
      ' currentStudent = null, currentInstructor = null, currentLoggedInUser = {id: "U1"};');
    load(sb, ['vcHostPeerId', 'vcMeetingForCode', 'vcCurrentUserId', 'vcNameMessage', 'vcAdmitPeer', 'vcWhenAdmitted']);
    return { sb, sent, conn, conns, t };
  }
  // A student holding an Admin Only meeting's code.
  {
    const { sb, sent, conn, t } = hostSb([{ roomCode: 'MEET234567', access: 'adminonly' }]);
    const c = conn('p1'); run(sb, 'vcPendingConns.p1 = __c'.replace('__c', 'globalThis.__c')); sb.__c = c; run(sb, 'vcPendingConns.p1 = globalThis.__c');
    let heldMedia = { closed: false, close() { this.closed = true; } };
    sb.__m = heldMedia; run(sb, 'peerConnections.p1 = { media: globalThis.__m }');
    let answered = false, refused = false;
    run(sb, 'vcWhenAdmitted("p1", function(){ globalThis.__ans = true; }, function(){ globalThis.__ref = true; })');
    assert(!run(sb, 'vcAdmitPeer("p1", {name:"Trainee", role:"student", uid:"S1"})'), 'a trainee is not admitted to an Admin Only meeting');
    assertEq(sent.p1[0].type, 'access-denied', 'and is told why');
    t.advance(500);
    answered = !!run(sb, 'globalThis.__ans'); refused = !!run(sb, 'globalThis.__ref');
    assert(!answered && refused, 'their held media call is refused, never answered');
    assert(heldMedia.closed, 'any call already open with them is closed');
    t.advance(500);
    assert(c.closed, 'and the connection is closed');
    assert(run(sb, '!vcAdmitted.p1 && !!vcRefusedPeers.p1'), 'they are on the refused list');
  }
  // The room is full.
  {
    const { sb, sent, conn } = hostSb([], false);
    sb.__c = conn('p1'); run(sb, 'vcPendingConns.p1 = globalThis.__c');
    assert(!run(sb, 'vcAdmitPeer("p1", {name:"T", role:"student"})'), 'nobody is admitted past the size limit');
    assertEq(sent.p1[0].type, 'room-full', 'the refusal says the room is full');
    assert(run(sb, '!peerConnections.p1'), 'no media is kept with them');
  }
  // A good join.
  {
    const { sb, sent, conn, t } = hostSb([{ roomCode: 'MEET234567', access: 'adminonly' }]);
    sb.__a = conn('a1'); sb.__b = conn('b1');
    run(sb, 'vcPendingConns.a1 = globalThis.__a; vcPendingConns.b1 = globalThis.__b;');
    run(sb, 'vcWhenAdmitted("b1", function(){ globalThis.__ansB = true; }, function(){})');
    assert(run(sb, 'vcAdmitPeer("a1", {name:"Staff A", role:"adminstaff", uid:"U2"})'), 'Administration is admitted to an Admin Only meeting');
    assert(run(sb, 'vcAdmitPeer("b1", {name:"Staff B", role:"admin", uid:"U3"})'), 'and a second');
    t.advance(300);
    assert(run(sb, '!!globalThis.__ansB'), "an admitted person's held call is answered");
    const toB = sent.b1.map(m => m.type);
    assert(toB.indexOf('name') !== -1 && toB.indexOf('peer-list') !== -1, 'the newcomer hears who the host is and who else is here');
    assertEq(sent.b1.filter(m => m.type === 'peer-list')[0].peers.map(p => p.peerId).join(','), 'a1', 'the list is the people let in');
    assertEq(sent.a1.filter(m => m.type === 'new-peer').map(m => m.peerId).join(','), 'b1', 'everyone already in hears of the newcomer');
    // A1's link drops without the host noticing; A1 comes back over a fresh one.
    const oldA = run(sb, 'dataConnections.a1');
    const fresh = conn('a1');
    sb.__a1b = fresh; run(sb, 'vcPendingConns.a1 = globalThis.__a1b;');
    assert(run(sb, 'vcAdmitPeer("a1", {name:"Staff A", role:"adminstaff", uid:"U2"})'), 'someone already in the room is let back in over a fresh link');
    assert(run(sb, 'dataConnections.a1 === globalThis.__a1b && !vcPendingConns.a1'), 'the fresh link replaces the dead one (it used to be dropped 15 s later)');
    assert(oldA.closed, 'and the dead one is closed');
    // Removed, then back under a new connection with the same account.
    run(sb, 'vcKickedUids["U2"] = true;');
    sb.__a2 = conn('a2'); run(sb, 'vcPendingConns.a2 = globalThis.__a2;');
    assert(!run(sb, 'vcAdmitPeer("a2", {name:"Staff A", role:"adminstaff", uid:"U2"})'), 'someone removed cannot walk straight back in');
  }
  // A caller who never introduces itself.
  {
    const { sb, t } = hostSb([]);
    run(sb, 'vcWhenAdmitted("spy", function(){ globalThis.__spyAns = true; }, function(){ globalThis.__spyRef = true; })');
    t.advance(11000);
    assert(!run(sb, 'globalThis.__spyAns') && run(sb, 'globalThis.__spyRef'), "a media call from someone who never joins is refused (it used to be answered with the class's camera and mic)");
  }
}

/* ====================================================================== */
console.log('Calls ask for picture and sound, and trainees send video only to the host');
{
  const sb = sandbox({});
  run(sb, 'var isRoomHost = false, currentRoomCode = "ABC234", localStream = null, screenStream = null;');
  load(sb, ['vcHostPeerId', 'vcMediaPlanFor', 'vcOutgoingStream', 'vcCallOptions']);
  let o = run(sb, 'vcCallOptions("' + HOST + '")');
  assert(o.constraints.offerToReceiveAudio && o.constraints.offerToReceiveVideo, 'with no camera or mic at all, a trainee still asks for the host\'s sound and picture');
  o = run(sb, 'vcCallOptions("' + STU2 + '")');
  assert(o.constraints.offerToReceiveAudio && !o.constraints.offerToReceiveVideo, 'from a classmate: sound only');
  sb.localStream = new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]);
  run(sb, 'localStream = globalThis.localStream');
  assertEq(run(sb, 'vcOutgoingStream("' + HOST + '").getTracks().map(function(t){return t.kind}).sort().join()'), 'audio,video', 'to the host: camera and mic');
  assertEq(run(sb, 'vcOutgoingStream("' + STU2 + '").getTracks().map(function(t){return t.kind}).join()'), 'audio', 'to a classmate: mic only');
  run(sb, 'isRoomHost = true; screenStream = new MediaStream([{kind:"video", id:"screen"}]);');
  assertEq(run(sb, 'vcOutgoingStream("' + STU2 + '").getVideoTracks()[0].id'), 'screen', 'someone arriving while the host shares the screen gets the screen');

  // Every call the room places asks to receive.
  const calls = SRC.match(/rtcPeer\.call\([^;]*\)/g) || [];
  assert(calls.length >= 3, 'the room places its calls through rtcPeer.call (' + calls.length + ')');
  assert(calls.every(c => /vcCallOptions\(/.test(c)), 'every rtcPeer.call passes vcCallOptions: ' + calls.filter(c => !/vcCallOptions\(/.test(c)).join(' | '));
}

console.log('Every room function the page calls exists');
{
  const start = SRC.indexOf('function generateRoomCode()');
  const end = SRC.indexOf('// ============================== CLASS SESSION FUNCTIONS');
  const block = SRC.slice(start, end);
  const called = new Set((block.match(/\bvc[A-Z]\w*(?=\s*\()/g) || []));
  const missing = Array.from(called).filter(n => !new RegExp('function\\s+' + n + '\\s*\\(').test(SRC));
  assertEq(missing.join(','), '', 'no call to an undefined vc… function');
}

/* ====================================================================== */
console.log('A picture that arrives before the room is drawn is shown when it is');
{
  const doc = makeDom();
  const sb = sandbox({ document: doc, vcUpdateParticipants() {}, vcApplyHostOnlyVisibility() {}, vcRecordingAddStream() {} });
  run(sb, 'var isRoomHost = false, currentRoomCode = "LAT234", peerConnections = {}, peerNames = {}, vcPendingStreams = {}, vcCurrentViewMode = "gallery", vcScreenSharingPeerId = null;');
  load(sb, ['sanitizePeerId', 'vcHostPeerId', 'vcAddVideo', 'vcReplayStreams']);
  const hostStream = new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]);
  sb.__s = hostStream;
  run(sb, 'peerConnections["cestis-LAT234-host"] = { stream: globalThis.__s }; vcAddVideo("cestis-LAT234-host", globalThis.__s, "Host")');
  assert(!doc.getElementById('vc-tile-cestis-LAT234-host'), 'no room yet: nothing drawn …');
  assert(run(sb, '!!vcPendingStreams["cestis-LAT234-host"]'), '… but the stream is kept, not dropped');
  const grid = doc.add('vc-video-grid');
  run(sb, 'vcReplayStreams()');
  const tile = doc.getElementById('vc-tile-cestis-LAT234-host');
  assert(!!tile, 'once the room is drawn the instructor\'s tile appears');
  assert(tile && tile.classList.contains('host-tile'), 'marked as the host\'s tile');
  run(sb, 'vcReplayStreams(); vcAddVideo("cestis-LAT234-host", globalThis.__s, "Host")');
  assertEq(grid.children.length, 1, 'drawing again never makes a second tile');
  run(sb, 'vcAddVideo("cestis-LAT234-xyz-host", new MediaStream([]), "Impostor")');
  const imp = doc.getElementById('vc-tile-cestis-LAT234-xyz-host');
  assert(imp && !imp.classList.contains('host-tile') && imp.style.display === 'none', 'an id that merely ends in "-host" is not taken for the host');
}

/* ====================================================================== */
console.log('The recording hears everyone, including the muted and the late, and says so');
{
  const sources = [], sent = [];
  class FakeAudioContext { createMediaStreamDestination() { return { stream: new FakeStream([new FakeTrack('audio')]) }; } createMediaStreamSource(s) { const t = s.getTracks()[0]; return { connect() { sources.push(t.id); } }; } close() {} }
  class FakeRecorder { constructor(s, o) { this.stream = s; this.mimeType = o.mimeType; this.state = 'inactive'; } start() { this.state = 'recording'; } stop() { this.state = 'inactive'; } }
  FakeRecorder.isTypeSupported = () => true;
  const doc = makeDom();
  doc.createElement = (tag) => tag === 'canvas'
    ? { width: 0, height: 0, getContext() { return { fillRect() {}, fillText() {}, drawImage() {} }; }, captureStream() { return new FakeStream([new FakeTrack('video')]); } }
    : { muted: false, setAttribute() {}, play() { return Promise.resolve(); } };
  const sb = sandbox({ document: doc, AudioContext: FakeAudioContext, MediaRecorder: FakeRecorder, setInterval() { return 1; }, clearInterval() {},
    vcBroadcastData(m) { sent.push(m); }, vcRecStoreBegin() {}, vcRecStoreChunk() {}, vcOnRecordingComplete() {} });
  run(sb, 'var vcIsRecording = false, vcRecordingAudioCtx = null, vcMediaRecorder = null, vcRecordedChunks = [], vcRecordingStartTime = null, vcRecTimerInterval = null,' +
    ' vcRecMixDest = null, vcRecMixed = {}, vcRecDrawTimer = null, vcRecId = null, vcRecSeq = 0, vcRecMeta = null, vcRecStoreFailed = false,' +
    ' isRoomHost = true, currentRoomCode = "REC234", vcCurrentRoomTitle = "Welding", vcCurrentUserName = "Teacher", screenStream = null, peerConnections = {};');
  const mutedMic = new FakeTrack('audio', false);
  const peerA = new FakeTrack('audio');
  sb.__ls = new FakeStream([mutedMic, new FakeTrack('video')]);
  sb.__pa = new FakeStream([peerA]);
  run(sb, 'localStream = globalThis.__ls; peerConnections.a = { stream: globalThis.__pa };');
  load(sb, ['vcHostPeerId', 'vcGetSupportedMimeType', 'vcRecordingAddStream', 'vcRecordingStageTrack', 'vcStartRecordingCanvas', 'vcStartRecording', 'vcStopRecording']);
  run(sb, 'vcStartRecording()');
  assert(sources.indexOf(mutedMic.id) !== -1, 'an instructor muted when recording starts is still wired in (heard once unmuted)');
  assert(sources.indexOf(peerA.id) !== -1, 'participants already in the room are heard');
  const late = new FakeTrack('audio');
  sb.__late = new FakeStream([late]);
  run(sb, 'vcRecordingAddStream(globalThis.__late); vcRecordingAddStream(globalThis.__late);');
  assertEq(sources.filter(x => x === late.id).length, 1, 'someone who joins later is added, once');
  assert(sent.some(m => m.type === 'recording' && m.on === true), 'everyone in the room is told recording has started');
  const rec = run(sb, 'vcMediaRecorder');
  assertEq(rec.stream.getVideoTracks().length, 1, 'the picture recorded is the stage canvas (it follows camera and screen changes)');
  run(sb, 'vcStopRecording()');
  assert(sent.some(m => m.type === 'recording' && m.on === false), 'and told when it stops');
  run(sb, 'vcRecordingAddStream(new MediaStream([{kind:"audio", id:"after"}]))');
  assert(sources.indexOf('after') === -1, 'nothing is wired in after the recording stops');
  assert(/addEventListener\('beforeunload'[\s\S]{0,120}vcIsRecording/.test(SRC), 'closing the tab while recording asks first');
}

/* ====================================================================== */
console.log('Leaving the page during a Large Class leaves the meeting properly');
{
  const doc = makeDom();
  ['videoRoom', 'iVideoRoom', 'sVideoRoom', 'asVideoRoom'].forEach(id => { const e = doc.add(id); e.style.display = 'none'; });
  ['videoClassList', 'iVideoContent', 'sVideoClassList', 'asVideoContent'].forEach(id => { const e = doc.add(id); e.style.display = 'none'; });
  doc.byId.asVideoRoom.style.display = 'block'; doc.byId.asVideoRoom.innerHTML = '<div>LIVE</div>';
  let disposed = 0, saved = [], marked = [];
  const sb = sandbox({ document: doc, vcCloseAllConnections() {}, vcMarkClassSession(c, s) { marked.push(c + ':' + s); },
    saveCollection(k, v) { saved.push(k); }, renderVcSessionAttendance() {}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {} });
  run(sb, 'var vcJitsiApi = { dispose: function(){ globalThis.__disp = (globalThis.__disp||0)+1; } }, vcLargeRoomActive = {code:"BIG234"}, vcLargeCutOff = false, vcLargeLeaving = false,' +
    ' vcSessions = [], vcActiveSessionMine = true, vcSessionHeartbeat = null, vcSessionSaveTimer = null, isRoomHost = true, rtcPeer = null, currentRoomCode = "BIG234", vcHostPermissions = {};');
  run(sb, 'var vcActiveSession = CESTISCore.vcSessions.startSession({ code: "BIG234", startedAt: new Date().toISOString() });');
  load(sb, ['vcSaveSessionsNow', 'vcSaveActiveSession', 'vcCloseActiveSession', 'vcCleanupMediaIfNeeded']);
  run(sb, 'vcCleanupMediaIfNeeded()');
  disposed = run(sb, 'globalThis.__disp || 0');
  assertEq(disposed, 1, 'the conference frame is disposed (camera and mic stop)');
  assert(run(sb, 'vcJitsiApi === null && vcActiveSession === null'), 'nothing of it is left running');
  assert(saved.indexOf('voctrain_vcSessions') !== -1, 'the register record is saved as it stood');
  assertEq(run(sb, 'vcSessions[0].endedAt'), '', 'without ending the class for the trainees still in it');
  assert(doc.byId.asVideoRoom.style.display === 'none' && doc.byId.asVideoRoom.innerHTML === '' && doc.byId.asVideoContent.style.display === 'block',
    'the Admin Staff room (which used to be missed) is put back to its list');
}

console.log('A trainee\'s device keeps no register record of its own');
{
  const listeners = {};
  function FakeJitsi() { this.addEventListener = (ev, fn) => { listeners[ev] = fn; }; this.executeCommand = () => {}; this.getNumberOfParticipants = () => 2; }
  function mk(host) {
    const saved = [];
    const sb = sandbox({ JitsiMeetExternalAPI: FakeJitsi, document: { getElementById() { return null; } }, saveCollection(k, v) { saved.push(JSON.parse(JSON.stringify(v))); },
      setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, renderVcSessionAttendance() {}, vcShowLargeRoomCutOff() { sb.__cut = true; },
      exitLargeRoom() {}, vcLargeRoomHost() { return 'meet.example'; }, vcLargeRoomName(c) { return 'CESTIS-' + c; } });
    run(sb, 'var systemSettings = {}, isRoomHost = ' + host + ', activeHostRoom = null, vcCurrentUserName = "' + (host ? 'Teacher' : 'Trainee') + '", vcSessions = [],' +
      ' vcActiveSession = null, vcActiveSessionMine = false, vcSessionHeartbeat = null, vcSessionSaveTimer = null, vcLargeLeaving = false, vcLargeCutOff = false, vcJitsiApi = null;');
    load(sb, ['vcSaveSessionsNow', 'vcSaveActiveSession', 'vcCloseActiveSession', 'vcStartJitsi']);
    run(sb, 'vcStartJitsi({}, "Welding", "' + (host ? 'instructor' : 'student') + '", "BIG234")');
    return { sb, saved };
  }
  const t = mk(false);
  listeners.videoConferenceJoined({ id: 'me', displayName: 'Trainee' });
  listeners.participantJoined({ id: 'p2', displayName: 'Other' });
  assertEq(t.saved.length, 0, 'nothing is written to the register from a trainee\'s device');
  const h = mk(true);
  assert(h.saved.length >= 1, 'the host\'s device writes the record');
  const rec = h.saved[h.saved.length - 1][0];
  assertEq(rec.id, Core.vcSessions.sessionId('BIG234', new Date().toISOString()), 'under the one id for this class and day');
  listeners.videoConferenceJoined({ id: 'host', displayName: 'Teacher' });
  listeners.videoConferenceLeft();
  assert(h.sb.__cut, 'a meeting the server ends within minutes is explained, with ways on');
  assertEq(run(h.sb, 'vcSessions[0].endedAt'), '', 'and the register is not quietly closed at five minutes');
}

/* ====================================================================== */
console.log('Class names with apostrophes can be joined');
{
  const sb = sandbox({ currentStudent: { name: 'T', course: 'Hair' }, instructorCourseMatch() { return true; }, localDateStr() { return '2026-10-20'; },
    document: { getElementById() { return sb.__el; } } });
  sb.__el = { innerHTML: '' };
  sb.classSessions = [
    { id: 'CS1', name: "Children's Hair Care", course: 'Hair', date: '2026-10-20', time: '09:00', roomCode: 'ABCDEFGHJK', status: 'live' },
    { id: 'CS2', name: 'Say "Cheese" \\ Photography', course: 'Hair', date: '2026-10-20', time: '10:00', roomCode: 'K4M9PQ', status: 'scheduled' }
  ];
  load(sb, ['escapeHtml', 'jsArg', 'renderStudentClassSessions']);
  run(sb, 'renderStudentClassSessions()');
  const html = sb.__el.innerHTML;
  const onclicks = (html.match(/onclick="([^"]*)"/g) || []).map(a => a.slice(9, -1)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#96;/g, '`').replace(/&amp;/g, '&'));
  assertEq(onclicks.length, 2, 'two Join buttons');
  const got = [];
  onclicks.forEach(code => {
    let ok = true;
    try { new Function('enterVideoRoom', code)(function () { got.push(Array.from(arguments)); }); } catch (e) { ok = false; }
    assert(ok, 'the Join handler is valid JavaScript: ' + code);
  });
  assertEq(JSON.stringify(got[0]), JSON.stringify(["Children's Hair Care", 'student', 'ABCDEFGHJK']), 'it opens the class with its exact name and code');
  assertEq(got[1][0], 'Say "Cheese" \\ Photography', 'quotes and backslashes survive too');
}

/* ====================================================================== */
console.log('Settings: relays and the Large Class server are checked before saving');
{
  const toasts = [];
  const fields = {};
  const doc = { getElementById(id) { return fields[id] || null; } };
  const sb = sandbox({ document: doc, showToast(m) { toasts.push(m); }, saveState() { sb.__saved = (sb.__saved || 0) + 1; } });
  run(sb, 'var systemSettings = { institutionName: "C", adminEmail: "a@b", academicYear: "2025/2026", vcProvider: "Google Meet", somethingElse: 42 };');
  load(sb, ['vcParseSignallingHost', 'fillSystemSettingsForm', 'saveSystemSettings']);
  ['settInstitution', 'settAdminEmail', 'settAcadYear', 'settVcProvider', 'settVcSignalling', 'settVcTurn', 'settVcLargeBase', 'settVcRoomSalt'].forEach(id => { fields[id] = { value: '' }; });
  run(sb, 'fillSystemSettingsForm()');
  assertEq(fields.settVcProvider.value, 'Built-in (WebRTC)', 'a provider that never did anything reads as the built-in room');
  fields.settVcTurn.value = 'turn:relay.centre.org:3478';           // no login
  run(sb, 'saveSystemSettings()');
  assert(!sb.__saved && /line 1/.test(toasts.pop()), 'a relay line without a login is refused, naming the line');
  fields.settVcTurn.value = 'turn:relay.centre.org:3478 centre s3cret';
  fields.settVcLargeBase.value = 'http://meet.centre.org';
  run(sb, 'saveSystemSettings()');
  assert(!sb.__saved && /https/.test(toasts.pop()), 'an http Large Class server is refused');
  fields.settVcLargeBase.value = 'meet.centre.org';
  fields.settVcRoomSalt.value = '  our phrase ';
  run(sb, 'saveSystemSettings()');
  assertEq(sb.__saved, 1, 'valid settings are saved');
  assertEq(run(sb, 'systemSettings.vcTurnServers'), 'turn:relay.centre.org:3478 centre s3cret', 'the relay is stored with the Centre\'s settings');
  assertEq(run(sb, 'systemSettings.vcLargeRoomBase'), 'https://meet.centre.org/', 'the Large Class server is stored as an https address');
  assertEq(run(sb, 'systemSettings.vcRoomPasswordSalt'), 'our phrase', 'the password phrase is stored');
  assertEq(run(sb, 'systemSettings.somethingElse'), 42, 'no other setting is touched');
  const adminPage = fs.readFileSync(path.join(__dirname, '..', 'Pages', 'Administration.html'), 'utf8');
  assert(/id="settVcTurn"/.test(adminPage) && /id="settVcLargeBase"/.test(adminPage) && /id="settVcRoomSalt"/.test(adminPage), 'Settings has the three fields');
  assert(!/Zoom Integration|Microsoft Teams|Google Meet/.test(adminPage), 'providers that do nothing are no longer offered');
}

/* ====================================================================== */
console.log('A data link that reports "open" twice is set up once, without an error');
// Seen in the end-to-end run on the Centre's network: the second 'open' ran the
// set-up again with the early messages already handed on, and threw
// "Cannot read properties of null (reading 'forEach')" on the instructor's page.
for (const host of [true, false]) {
  const timers = makeTimers();
  const heard = [], closes = [];
  const sb = sandbox({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    vcRefusedPeers: {}, vcPendingConns: {}, dataConnections: {}, peerConnections: {}, isRoomHost: host,
    vcOnData(d, pid) { heard.push(pid + ':' + d); }, vcOnPeerConnClosed(pid) { closes.push(pid); },
    vcWhenAdmitted(pid, ok) { ok(); }, vcNameMessage() { return { type: 'name' }; } });
  load(sb, ['vcHandleDataConn']);
  const conn = new Emitter();
  conn.peer = 'cestis-ABC234-p1'; conn.send = () => {}; conn.close = () => {};
  sb.vcHandleDataConn(conn);
  conn.emit('data', 'hello');
  let threw = null;
  try { conn.emit('open'); conn.emit('open'); } catch (e) { threw = e; }
  assertEq(threw && threw.message, null, (host ? 'the host' : 'a participant') + ': a second "open" throws nothing');
  assertEq(heard.join(','), 'cestis-ABC234-p1:hello', (host ? 'the host' : 'a participant') + ': the early message is heard once');
  conn.emit('data', 'later');
  assertEq(heard.length, 2, (host ? 'the host' : 'a participant') + ': and later ones as they come');
  assertEq((conn.h.close || []).length, 1, (host ? 'the host' : 'a participant') + ': one close handler, not two');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
