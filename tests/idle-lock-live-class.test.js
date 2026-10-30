/* Nobody is locked out mid-lesson or mid-invigilation by the idle lock.
   Run: node tests/idle-lock-live-class.test.js

   What used to go wrong: the idle lock (20 minutes for staff, 60 for a
   trainee) counted only key presses, clicks, scrolls and touches as use of the
   PC. An instructor teaching to the camera, a trainee following the lesson
   and an invigilator watching the board press nothing — so the audit had the
   instructor locked 21 minutes into a live class, a trainee at minute 61 of
   one, and the invigilator part-way through a sitting.

   Pinned here: CESTISCore.sessionAccess.keepsAwake (a running class, or an
   invigilator board on a sitting that is open or still being written, counts
   as use), and the dashboard's own sessionHeartbeat / sessionKeptAwake read
   from index.html: in a running class or on an open sitting the heartbeat
   does not lock; with nothing open, an idle PC still locks exactly as before. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const SA = Core.sessionAccess;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

function extractFunction(src, name, where) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

console.log('The rule: what counts as use of the PC besides keys and clicks');
{
  assert(SA.keepsAwake({ inLiveRoom: true }) === true, 'being in a running class keeps the PC awake');
  assert(SA.keepsAwake({}) === false && SA.keepsAwake() === false, 'nothing open: nothing keeps it awake');
  assert(SA.keepsAwake({ invigilatorBoard: { status: 'active', rows: [] } }) === true, 'a board on a sitting that is open now keeps it awake');
  assert(SA.keepsAwake({ invigilatorBoard: { status: 'upcoming', rows: [] } }) === false, 'a board on a sitting that has not opened does not');
  assert(SA.keepsAwake({ invigilatorBoard: { status: 'completed', rows: [{ status: 'submitted' }, { status: 'absent' }] } }) === false,
    'a board on a sitting that is over, everyone finished, does not');
  assert(SA.keepsAwake({ invigilatorBoard: { status: 'completed', rows: [{ status: 'in-progress', timeUp: false }] } }) === true,
    'a sitting past its close with somebody still writing keeps it awake');
  assert(SA.keepsAwake({ invigilatorBoard: { status: 'completed', rows: [{ status: 'in-progress', timeUp: true }] } }) === false,
    'an attempt whose time is up does not keep a closed board awake for ever');
  // The rule never changes the lock itself.
  const now = Date.parse('2026-10-28T15:00:00Z');
  assert(SA.state(now, now - 21 * 60000, now + 3600000, 'instructor') === 'lock', 'the staff idle limit is unchanged (21 min idle -> lock)');
  assert(SA.state(now, now - 61 * 60000, now + 3600000, 'student') === 'lock', 'the trainee idle limit is unchanged (61 min idle -> lock)');
}

console.log('The dashboard\'s heartbeat, read from index.html');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function dashboard(opts) {
  const now = Date.now();
  const store = { voctrain_sessionExpiry: String(now + 4 * 3600000) };
  const grid = opts.grid ? {} : null;
  const sb = {
    CESTISCore: Core, Date: Date, Number: Number, String: String, console: console,
    currentRole: opts.role || 'instructor', currentExamSession: null, _isExamPreviewMode: false,
    _sessionLocked: false, _sessionWarned: false, _sessionLastActivity: now - (opts.idleMin || 21) * 60000,
    currentRoomCode: opts.code || '', rtcPeer: opts.rtcPeer ? {} : null, vcLargeRoomActive: opts.large ? { code: opts.code } : null,
    invigState: { board: opts.board || null }, invigPageActive: () => !!opts.invigOpen,
    document: { getElementById: id => (id === 'vc-video-grid' ? grid : null) },
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionAccountRevoked: () => false, showToast: () => {}, logout: () => {},
    locks: 0
  };
  sb.openIdleLock = function () { sb.locks++; sb._sessionLocked = true; };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'sessionKeptAwake', 'index.html'), sb);
  vm.runInContext(extractFunction(src, 'sessionHeartbeat', 'index.html'), sb);
  vm.runInContext('sessionHeartbeat();', sb);
  return sb;
}
{
  assert(dashboard({ role: 'instructor', code: 'WELD7Q4M2X', rtcPeer: true, grid: true, idleMin: 21 }).locks === 0,
    'an instructor teaching a small-room class for 21 minutes without a click is not locked');
  assert(dashboard({ role: 'student', code: 'WELD7Q4M2X', rtcPeer: true, grid: true, idleMin: 61 }).locks === 0,
    'a trainee in the class at minute 61 is not locked');
  assert(dashboard({ role: 'student', code: 'HALL9K3P7Z', large: true, idleMin: 61 }).locks === 0,
    'a trainee in a Large Class at minute 61 is not locked');
  assert(dashboard({ role: 'admin', invigOpen: true, board: { status: 'active', rows: [] }, idleMin: 25 }).locks === 0,
    'an invigilator watching an open sitting for 25 minutes is not locked');
  assert(dashboard({ role: 'instructor', idleMin: 21 }).locks === 1, 'an idle PC with nothing open still locks at 21 minutes');
  assert(dashboard({ role: 'student', idleMin: 61 }).locks === 1, 'an idle trainee PC with nothing open still locks at 61 minutes');
  assert(dashboard({ role: 'instructor', code: 'WELD7Q4M2X', rtcPeer: true, grid: false, idleMin: 21 }).locks === 1,
    'a lobby that never reached a class does not keep the PC unlocked');
  assert(dashboard({ role: 'admin', invigOpen: false, board: { status: 'active', rows: [] }, idleMin: 25 }).locks === 1,
    'a board the invigilator navigated away from does not keep the PC awake');
  assert(dashboard({ role: 'admin', invigOpen: true, board: { status: 'completed', rows: [{ status: 'submitted' }] }, idleMin: 25 }).locks === 1,
    'a board on a finished sitting does not keep the PC awake');
  const kept = dashboard({ role: 'instructor', code: 'WELD7Q4M2X', rtcPeer: true, grid: true, idleMin: 21 });
  assert(Date.now() - kept._sessionLastActivity < 5000, 'the heartbeat counts the class as activity just now');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
