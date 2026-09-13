/* Turning two-step verification OFF must stay off — and an administrator must
   be able to turn it off for somebody else.

   What happened: staff switched two-step verification off, the panel said OFF,
   and the next sign-in asked for a 6-digit code again. The cross-device merge
   was the cause. Its "this device has no two-step state yet, so adopt the
   cloud's" escape hatch tested `!localHas2fa` — whether two-step was off RIGHT
   NOW — instead of whether the device had ever seen a decision. Switching
   two-step off makes that true by definition, so the very next sync against an
   older cloud copy that still said ON walked past the newest-wins check and
   restored the old secret and the old backup codes. The account was disabled on
   the device that disabled it and enabled everywhere else, for ever.

   The same merge re-seeded backup codes onto an account that had just been
   switched off, leaving live one-time codes on a disabled account.

   And there was no way out for the person it happened to: every route to
   turning two-step off asks for a code from the authenticator app, so anyone
   who had lost their phone (or never enrolled the secret the cloud was
   insisting on) could not sign in and no administrator could help them.

   Pinned here, for both builds (online and Offline System):
     - a STALE cloud copy never undoes a newer switch-off, in either the enabled
       flag, the secret, or the backup codes;
     - a device that has genuinely never seen the account still adopts the
       cloud's two-step state on first sight;
     - a NEWER cloud change still wins in both directions (on and off);
     - a spent backup code is still burned everywhere it appears;
     - the administrator's clear wipes the authenticator, the secret, the backup
       codes and the email sign-in codes, and stamps the change so it beats every
       other device's older copy;
     - the clear is administrator-only and is offered in the Users table only
       for accounts that actually have something to clear.

   Run: node tests/two-step-state-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const BUILDS = {
  'index.html': fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
  'Offline System/index.html': fs.readFileSync(path.join(__dirname, '..', 'Offline System', 'index.html'), 'utf8')
};

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

const YESTERDAY = '2026-09-11T10:00:00.000Z';
const TODAY = '2026-09-12T10:00:00.000Z';

function mergeIn(where, local, cloud) {
  const sandbox = { console: { log: function () {}, error: function () {} } };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(BUILDS[where], 'mergeTwoFactorState', where), sandbox);
  sandbox.local = local; sandbox.cloud = cloud;
  const changed = vm.runInContext('mergeTwoFactorState(local, cloud)', sandbox);
  return { local: local, changed: changed };
}

/* ---------- 1. A switch-off stays off ---------- */
console.log('A stale cloud copy never turns two-step back on');

Object.keys(BUILDS).forEach(function (where) {
  // Switched off here today; the cloud still carries yesterday's ON copy.
  let r = mergeIn(where,
    { id: 'U1', twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null, twoFactorUpdatedAt: TODAY },
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'OLDSECRET', backupCodes: [{ code: 'AAAA1111', used: false }], twoFactorUpdatedAt: YESTERDAY });
  assert(r.local.twoFactorEnabled === false,
    where + ': a switch-off made today survives a sync with yesterday\'s enabled copy — this is the bug that kept asking disabled accounts for a code');
  assert(!r.local.twoFactorSecret, where + ': the old authenticator secret is not restored');
  assert(!(r.local.backupCodes || []).length, where + ': old backup codes are not re-seeded onto a disabled account');

  // Same, with the email sign-in option rather than an authenticator.
  r = mergeIn(where,
    { id: 'U2', twoFactorEnabled: false, twoFactorSecret: null, emailOtpLogin: false, twoFactorUpdatedAt: TODAY },
    { id: 'U2', twoFactorEnabled: false, twoFactorSecret: null, emailOtpLogin: true, twoFactorUpdatedAt: YESTERDAY });
  assert(r.local.emailOtpLogin === false, where + ': an older cloud copy does not turn email sign-in codes back on');
});

/* ---------- 2. The cases that must keep working ---------- */
console.log('First sight, and a newer change from another device, still apply');

Object.keys(BUILDS).forEach(function (where) {
  // A device that has never seen this account adopts what the cloud holds.
  let r = mergeIn(where,
    { id: 'U1' },
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', backupCodes: [{ code: 'AAAA1111', used: false }], twoFactorUpdatedAt: YESTERDAY });
  assert(r.local.twoFactorEnabled === true && r.local.twoFactorSecret === 'SECRET',
    where + ': a device seeing the account for the first time adopts the cloud two-step state');
  assert((r.local.backupCodes || []).length === 1, where + ': and its backup codes');

  // Turned ON elsewhere, later than anything here.
  r = mergeIn(where,
    { id: 'U1', twoFactorEnabled: false, twoFactorSecret: null, twoFactorUpdatedAt: YESTERDAY },
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'NEWSECRET', twoFactorUpdatedAt: TODAY });
  assert(r.local.twoFactorEnabled === true && r.local.twoFactorSecret === 'NEWSECRET',
    where + ': a newer switch-on from another device reaches this one');

  // Turned OFF elsewhere, later than anything here.
  r = mergeIn(where,
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorUpdatedAt: YESTERDAY },
    { id: 'U1', twoFactorEnabled: false, twoFactorSecret: null, twoFactorUpdatedAt: TODAY });
  assert(r.local.twoFactorEnabled === false && !r.local.twoFactorSecret,
    where + ': a newer switch-off from another device reaches this one');

  // A code spent on another device is still burned here.
  r = mergeIn(where,
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', backupCodes: [{ code: 'AAAA1111', used: false }], twoFactorUpdatedAt: TODAY },
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', backupCodes: [{ code: 'AAAA1111', used: true }], twoFactorUpdatedAt: YESTERDAY });
  assert(r.local.backupCodes[0].used === true,
    where + ': a backup code spent anywhere is burned everywhere, whichever copy is newer');

  // An account still on two-step still gains codes it has not seen.
  r = mergeIn(where,
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', backupCodes: [{ code: 'AAAA1111', used: false }], twoFactorUpdatedAt: TODAY },
    { id: 'U1', twoFactorEnabled: true, twoFactorSecret: 'SECRET', backupCodes: [{ code: 'BBBB2222', used: false }], twoFactorUpdatedAt: YESTERDAY });
  assert(r.local.backupCodes.length === 2,
    where + ': codes are still unioned while two-step is on');
});

/* ---------- 3. The administrator's override ---------- */
console.log('An administrator can turn two-step off for another account');

function adminSandbox(where, role, accounts) {
  const sandbox = {
    console: { log: function () {}, error: function () {} },
    currentRole: role,
    userAccounts: accounts,
    currentLoggedInUser: null,
    toasts: [],
    showToast: function (m) { sandbox.toasts.push(m); },
    saved: 0,
    saveUserAccounts: function () { sandbox.saved++; },
    confirm: function () { return true; },
    Date: Date
  };
  vm.createContext(sandbox);
  ['accountHasTwoStep', 'adminClearTwoStepApply'].forEach(function (fn) {
    vm.runInContext(extractFunction(BUILDS[where], fn, where), sandbox);
  });
  return sandbox;
}

Object.keys(BUILDS).forEach(function (where) {
  const src = BUILDS[where];

  const target = { id: 'U9', name: 'C Gordon', username: 'cgordonadmin', twoFactorEnabled: true,
    twoFactorSecret: 'SECRET', backupCodes: [{ code: 'AAAA1111', used: false }], emailOtpLogin: true,
    twoFactorUpdatedAt: YESTERDAY };
  const s = adminSandbox(where, 'admin', [target]);
  const ok = vm.runInContext("adminClearTwoStepApply('U9')", s);
  assert(ok === true, where + ': the clear reports that it ran');
  assert(target.twoFactorEnabled === false, where + ': the authenticator flag is cleared');
  assert(target.twoFactorSecret === null, where + ': the secret is cleared');
  assert(target.backupCodes === null, where + ': the backup codes are cleared');
  assert(target.emailOtpLogin === false, where + ': email sign-in codes are cleared too');
  assert(target.twoFactorUpdatedAt !== YESTERDAY && Date.parse(target.twoFactorUpdatedAt) > Date.parse(YESTERDAY),
    where + ': the clear is stamped NEWER, so it beats every other device\'s copy instead of being merged away');
  assert(s.saved === 1, where + ': the accounts are saved');

  // The freshly cleared record now survives a sync with the old enabled copy.
  const after = mergeIn(where, target, { id: 'U9', twoFactorEnabled: true, twoFactorSecret: 'SECRET',
    backupCodes: [{ code: 'AAAA1111', used: false }], emailOtpLogin: true, twoFactorUpdatedAt: YESTERDAY });
  assert(after.local.twoFactorEnabled === false && !after.local.twoFactorSecret,
    where + ': and the administrator\'s clear is not undone by the next sync');

  // A missing account is refused rather than throwing.
  const s2 = adminSandbox(where, 'admin', []);
  assert(vm.runInContext("adminClearTwoStepApply('NOPE')", s2) === false,
    where + ': clearing an account that is not on this device does nothing');

  // Who may press it, and when it is shown.
  assert(/function adminClearTwoStep\(userId\)\{[\s\S]{0,200}currentRole !== 'admin'/.test(src),
    where + ': the control refuses anybody who is not an administrator');
  assert(src.indexOf("tfaOpenVerify(actor, { title: 'Authorize Two-Step Removal'") !== -1,
    where + ': an administrator who has two-step on must enter their own code first, as for a password reset');
  assert(src.indexOf('accountHasTwoStep(u) ?') !== -1 && src.indexOf('adminClearTwoStep(\\\'') !== -1,
    where + ': the Users table offers the control only for accounts that have something to clear');

  // The emailed code no longer calls itself two-step verification.
  assert(src.indexOf("{ title: 'Email Sign-in Code', subtitle: 'Sending a verification code to your email") !== -1,
    where + ': an emailed sign-in code is titled as one, not as authenticator two-step');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
