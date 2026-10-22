/* Work left on a device by the version before the October 2026 upgrade.

   That version had no "pending upload" note. A staff member who closed the
   tab without signing out (the usual way a shared PC is left) kept their
   session keys on the device, and with them any work that had not reached
   the cloud — taken offline, or with an expired Google token. On the first
   load of the new version that session is usually expired, and the page-load
   clean-up then wiped the device: nothing said the work had never left it.

   cestisCarryPreUpgradeWork() runs once per device, before that clean-up. A
   staff member's stored session gets the note for that role, so the existing
   rules (CESTISCore.pendingUpload) keep the data until a staff session's
   upload carries it. A trainee's stored session gets nothing: the old version
   already trimmed a trainee's device, and their own unsent results are kept
   by the exam outbox.

   Run: node tests/pre-upgrade-carry.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const ROOT = path.join(__dirname, '..');
const BUILDS = [{ where: '', label: '' }, { where: 'Offline System', label: 'Offline System/' }];

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(name + ' is not closed');
}

function device(src, stored) {
  const store = Object.assign({}, stored);
  const sb = {
    CESTISCore: Core,
    CESTISStore: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    Date
  };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'cestisCarryPreUpgradeWork'), sb);
  return { run: () => vm.runInContext('cestisCarryPreUpgradeWork()', sb), store };
}

const EXPIRED = String(Date.parse('2026-10-01T09:00:00Z'));

BUILDS.forEach(b => {
  const src = fs.readFileSync(path.join(ROOT, b.where, 'index.html'), 'utf8');
  const w = b.label + 'index.html';

  console.log(w + ': an instructor who closed the tab on the old version keeps their unsent work');
  let d = device(src, { voctrain_sessionRole: 'instructor', voctrain_sessionUserId: 'USR-7', voctrain_sessionExpiry: EXPIRED,
    voctrain_attendance: '[{"studentId":"S1","days":{"Mon":"present"}}]' });
  d.run();
  const note = d.store.cestisPendingUpload;
  assert(!!note && Core.pendingUpload.roleOf(note) === 'instructor', w + ': the note names the instructor — got ' + note);
  assert(Core.pendingUpload.keepOnSignOut(note, 'student', true) === true,
    w + ': a trainee signing in and out next does not trim the instructor\'s work');
  assert(Core.pendingUpload.covers('student', note) === false, w + ': nor can a trainee\'s upload clear the note');
  assert(Core.pendingUpload.covers('instructor', note) === true, w + ': an instructor\'s successful upload does clear it');
  assert(!!d.store.voctrain_sessionUpgradeCarried, w + ': the device remembers this was done');

  console.log(w + ': an administrator\'s stored session is held for an administrator');
  d = device(src, { voctrain_sessionRole: 'admin', voctrain_sessionExpiry: EXPIRED });
  d.run();
  assert(Core.pendingUpload.roleOf(d.store.cestisPendingUpload) === 'admin', w + ': the note names the administrator');
  assert(Core.pendingUpload.covers('instructor', d.store.cestisPendingUpload) === false,
    w + ': an instructor\'s upload does not carry what only an administrator publishes');

  console.log(w + ': a trainee\'s stored session, or none, needs nothing');
  d = device(src, { voctrain_sessionRole: 'student', voctrain_sessionExpiry: EXPIRED });
  d.run();
  assert(!('cestisPendingUpload' in d.store), w + ': no note for a trainee\'s session (the old version already trimmed it)');
  d = device(src, {});
  d.run();
  assert(!('cestisPendingUpload' in d.store), w + ': no note on a device nobody was signed in to');

  console.log(w + ': it runs once, and never overwrites a note');
  d = device(src, { voctrain_sessionRole: 'admin', cestisPendingUpload: 'instructor|2026-10-20T10:00:00.000Z' });
  d.run();
  assert(d.store.cestisPendingUpload === 'instructor|2026-10-20T10:00:00.000Z', w + ': an existing note is left exactly as it was');
  d = device(src, { voctrain_sessionRole: 'admin', voctrain_sessionUpgradeCarried: '2026-10-22T00:00:00.000Z' });
  d.run();
  assert(!('cestisPendingUpload' in d.store), w + ': on a device already carried forward, a later stored session is the new version\'s own business');

  console.log(w + ': it runs before the page-load clean-up of an expired session');
  const callAt = src.indexOf('\ncestisCarryPreUpgradeWork();');
  const cleanupAt = src.indexOf('Expired session detected on page load');
  assert(callAt !== -1 && cleanupAt !== -1 && callAt < cleanupAt, w + ': the carry step is called before the expired-session clean-up');
});

console.log('The one-time flag stays on its own device');
assert(Core.isSnapshotableKey('voctrain_sessionUpgradeCarried') === false, 'the master snapshot never carries it to another device');
const pc = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
assert(/DEVICE_KEYS = \[[^\]]*'voctrain_sessionUpgradeCarried'/.test(pc), 'nor does the Centre network\'s whole-store mirror');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
