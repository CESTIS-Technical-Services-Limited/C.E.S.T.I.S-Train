/* Every trainee who joins a small-room live class reaches the instructor.
   Run: node tests/vc-small-room-joiners.test.js

   What used to go wrong: the host of a small (peer-to-peer) room keeps a
   join log in the shared live-session list, marked mode 'mesh', from the
   moment the first trainee arrives. Join asks that list "is this code a
   Large Class that is running?" (vcLiveLargeSession ->
   CESTISCore.vcSessions.liveFor), and liveFor did not look at the mode. So
   once the first trainee was in, every later trainee whose device had synced
   the list was sent to an empty public "Large Class" instead of the
   instructor — in the audit 5 of 5 later joiners, and the register then
   suggested them absent.

   Pinned here: liveFor never answers with a small room's log, still answers
   with a running Large Class of the same code, and the dashboard's own
   vcLiveLargeSession (read from index.html) does the same. The browser half
   (three trainees, the shared list copied to each device) is in
   tests/browser/vc-room.js. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const VS = Core.vcSessions;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

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

const NOW = '2026-10-28T14:10:00.000Z';
function meshLog(code) {
  // Exactly what the small room's host writes (vcMeshLogJoin).
  const s = VS.startSession({ code: code, title: 'Welding Theory', course: 'Welding & Fabrication', hostName: 'Ian Barrett', hostRole: 'instructor', startedAt: '2026-10-28T14:00:00.000Z' });
  s.mode = 'mesh';
  VS.recordJoin(s, 'cestis-' + code + '-abc123', 'Tameka Richards', '2026-10-28T14:01:00.000Z');
  return s;
}
function largeClass(code) {
  const s = VS.startSession({ code: code, title: 'Assembly', startedAt: '2026-10-28T14:00:00.000Z' });
  VS.recordJoin(s, 'j1', 'Kemar Johnson', '2026-10-28T14:02:00.000Z');
  return s;
}

console.log('A small room\'s join log is not a Large Class');
{
  const mesh = meshLog('WELD7Q4M2X');
  assert(VS.isLive(mesh, NOW), 'the small room\'s log is open and fresh while the class runs (the situation that misled Join)');
  assertEq(VS.liveFor([mesh], 'weld7q4m2x', NOW), null, 'a later joiner of the small room is not sent to the Large Class');
  const large = largeClass('HALL9K3P7Z');
  assertEq(VS.liveFor([mesh, large], 'HALL9K3P7Z', NOW), large, 'a running Large Class is still found by its code');
  // The same code with both (a Large Class started over an old small room):
  // the Large Class wins, the small room's log is never the answer.
  const both = largeClass('WELD7Q4M2X');
  assertEq(VS.liveFor([mesh, both], 'WELD7Q4M2X', NOW), both, 'with both, only the Large Class record counts');
}

console.log('The dashboard\'s Join asks the same question and gets the same answer');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sandbox = { CESTISCore: Core, vcSessions: [], CESTISStore: { getItem: () => null }, Date: Date, JSON: JSON, String: String, Array: Array };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(src, 'vcLiveLargeSession', 'index.html'), sandbox);
  // Pin the clock to the class's time.
  sandbox.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return Date.parse(NOW); } };
  sandbox.vcSessions = [meshLog('WELD7Q4M2X')];
  assertEq(sandbox.vcLiveLargeSession('WELD7Q4M2X'), null, 'vcLiveLargeSession: the small room is joined as a small room');
  const large = largeClass('HALL9K3P7Z');
  sandbox.vcSessions = [meshLog('WELD7Q4M2X'), large];
  const got = sandbox.vcLiveLargeSession('HALL9K3P7Z');
  assert(got && got.id === large.id, 'vcLiveLargeSession: a running Large Class is still sent to the hosted room');
  // A device that has not loaded the list yet reads it from its store.
  sandbox.vcSessions = [];
  sandbox.CESTISStore = { getItem: k => k === 'voctrain_vcSessions' ? JSON.stringify([meshLog('WELD7Q4M2X')]) : null };
  assertEq(sandbox.vcLiveLargeSession('WELD7Q4M2X'), null, 'vcLiveLargeSession: the same from the stored list');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
