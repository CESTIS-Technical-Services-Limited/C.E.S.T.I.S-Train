/* A decision about an account sticks: on every device, and for an open session.

   What happened (accounts-09, accounts-13, accounts-14, accounts-18 and
   comms-13 in the audit):
     - a sign-in stamped the account's edit time (updatedAt). A trainee whose
       phone had not synced signed in from its old 'active' copy — which made
       that copy NEWER than the administrator's earlier "disable" — and the
       next sync switched her back on everywhere. An open session was never
       ended when its account was switched off;
     - regenerating backup codes did not revoke the old ones: the next merge
       added the old set back from any older copy, unused;
     - any open session could change the recovery e-mail with no password —
       and that e-mail then stood in for the authenticator at sign-in;
     - sessions lasted eight hours from sign-in with no idle lock or warning;
     - an account using e-mailed sign-in codes was locked out whenever e-mail
       failed (offline, quota used up): it had no backup codes to fall back on.

   Pinned here (root index.html and cestis-core.js):
     - a sign-in marks verifiedAt, never updatedAt, and a stale signed-in copy
       cannot outrank a newer "disable"; verifiedAt only breaks a tie;
     - an open session whose account is switched off or deleted is signed out
       by the heartbeat;
     - a newer generation of backup codes replaces an older one in a merge;
       an older copy can only burn codes, never add them;
     - changing the recovery e-mail takes the current password (and a code
       with two-step on), and an e-mailed code only replaces the authenticator
       for accounts that chose e-mail codes;
     - sessionAccess.state: idle lock (20 min staff, 60 min trainees), a
       two-minute warning, expiry;
     - turning e-mail codes on hands out backup codes, and the e-mail prompt
       accepts them.

   Run: node tests/account-state-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const Core = require('../cestis-core.js');

function extractFunction(src, name) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

(async function () {
  /* ---------- 1. A stale sign-in never undoes a disable ---------- */
  console.log('A stale device\'s sign-in never switches a disabled account back on');
  const names = ['_bufToHex', '_hexToBuf', 'hashPasswordLegacy', '_pbkdf2Hex', 'hashPassword', 'verifyPassword',
    'cachePlaintextPw', 'maybeUpgradePasswordHash', 'checkPassword', 'stampVerifiedAccount', 'touchAccount', 'mergeCloudAccounts'];
  const sb = { crypto: globalThis.crypto, TextEncoder: TextEncoder, Uint8Array: Uint8Array, console: console, CESTISCore: Core,
    PBKDF2_ITERATIONS: 1000, userAccounts: [], saveUserAccounts: function () {}, isUserDeleted: function () { return false; },
    mergeTwoFactorState: function () { return false; } };
  vm.createContext(sb);
  vm.runInContext(names.map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb);
  const hash = await vm.runInContext("hashPassword('Trainee-2026!')", sb);
  // The phone's copy: unstamped, active. The office disabled her a minute ago.
  sb.userAccounts = [{ id: 'USR-t', username: 'tina', role: 'student', password: hash, status: 'active' }];
  const disabledAt = new Date(Date.now() - 60000).toISOString();
  const ok = await vm.runInContext("checkPassword('Trainee-2026!', userAccounts[0].password, userAccounts[0])", sb);
  assertEq(ok, true, 'the phone still lets her in from its old copy (it has not synced)…');
  assertEq(sb.userAccounts[0].updatedAt, undefined, '…but the sign-in is NOT recorded as an edit');
  assert(!!sb.userAccounts[0].verifiedAt, 'it is recorded as a sign-in (verifiedAt)');
  sb.cloud = [{ id: 'USR-t', username: 'tina', role: 'student', password: hash, status: 'disabled', updatedAt: disabledAt }];
  vm.runInContext('mergeCloudAccounts(cloud)', sb);
  assertEq(sb.userAccounts[0].status, 'disabled', 'the administrator\'s disable wins the next merge');
  // …and the phone's copy, sent the other way, cannot re-enable her.
  assertEq(Core.accountAccess.cloudCopyWins({ id: 'USR-t', status: 'disabled', password: hash, updatedAt: disabledAt },
    { id: 'USR-t', status: 'active', password: hash, verifiedAt: new Date().toISOString() }), false,
    'a newer sign-in never outranks an older edit');
  assertEq(Core.accountAccess.cloudCopyWins({ id: 'U', password: hash }, { id: 'U', password: 'pbkdf2$1$99$99', verifiedAt: new Date().toISOString() }), true,
    'between two unstamped real copies, the one that last let its owner in wins');
  assertEq(Core.accountAccess.cloudCopyWins({ id: 'U', password: hash, verifiedAt: new Date().toISOString() }, { id: 'U', password: 'pbkdf2$1$99$99' }), false,
    'in either direction');

  /* ---------- 2. An open session ends when its account is switched off ---------- */
  console.log('The heartbeat signs out a session whose account was switched off or deleted');
  function revoked(user, accounts, deleted) {
    const s = { currentLoggedInUser: user, userAccounts: accounts, isUserDeleted: function (id) { return !!(deleted && deleted[id]); } };
    vm.createContext(s);
    vm.runInContext(extractFunction(SRC, 'sessionAccountRevoked'), s);
    return vm.runInContext('sessionAccountRevoked()', s);
  }
  assertEq(revoked({ id: 'U1' }, [{ id: 'U1', status: 'disabled' }]), true, 'switched off → signed out');
  assertEq(revoked({ id: 'U1' }, [{ id: 'U1', status: 'active' }], { U1: true }), true, 'deleted → signed out');
  assertEq(revoked({ id: 'U1' }, [{ id: 'U1', status: 'active' }]), false, 'active → stays');
  assertEq(revoked({ id: 'U1' }, []), false, 'merely missing from the list for a moment is never a reason on its own');
  const hb = extractFunction(SRC, 'sessionHeartbeat');
  // Forced (logout(true)): a plain logout() asks "Sign out now?" during a
  // test, and a switched-off account could press Cancel and stay signed in.
  assert(/if\(sessionAccountRevoked\(\)\) \{[\s\S]*?logout\(true\);/.test(hb), 'the heartbeat logs such a session out, without asking');
  assert(/try \{ sessionHeartbeat\(\); \} catch\(e\) \{\}/.test(extractFunction(SRC, 'checkSessionExpiry')), 'and runs with the minute-by-minute session check');

  /* ---------- 3. Idle lock and warning ---------- */
  console.log('Idle sessions lock, and the end of a session is announced');
  const S = Core.sessionAccess, T0 = Date.parse('2026-10-20T08:00:00Z'), EXP = T0 + 8 * 3600e3;
  assertEq(S.state(T0 + 10 * 60e3, T0, EXP, 'admin'), 'ok', 'ten quiet minutes: fine');
  assertEq(S.state(T0 + 21 * 60e3, T0, EXP, 'instructor'), 'lock', 'staff lock after twenty idle minutes');
  assertEq(S.state(T0 + 21 * 60e3, T0, EXP, 'student'), 'ok', 'a trainee (mid-exam, reading) has an hour');
  assertEq(S.state(T0 + 61 * 60e3, T0, EXP, 'student'), 'lock', 'then locks too');
  assertEq(S.state(EXP - 60e3, EXP - 120e3, EXP, 'admin'), 'warn', 'a minute before the hard end: a warning, not a surprise logout');
  assertEq(S.state(EXP + 1, EXP, EXP, 'admin'), 'expired', 'and after it, expired');
  const unlock = extractFunction(SRC, 'idleLockUnlock');
  assert(/verifyPassword\(/.test(unlock), 'unlocking takes the account\'s password');
  assert(/#idleLockModal\.active, #forceChangePwModal\.active/.test(SRC), 'Escape cannot dismiss the lock or the forced password change');

  /* ---------- 4. Backup-code generations ---------- */
  console.log('Regenerated backup codes revoke the old set on every device');
  const m2 = { console: console };
  vm.createContext(m2);
  vm.runInContext(extractFunction(SRC, 'mergeTwoFactorState'), m2);
  const OLD = '2026-09-01T00:00:00.000Z', NEW = '2026-10-01T00:00:00.000Z';
  const on = { twoFactorEnabled: true, twoFactorSecret: 'S' };
  m2.local = Object.assign({ backupCodes: [{ code: 'NEWBBBB1', used: false }, { code: 'NEWBBBB2', used: false }], twoFactorUpdatedAt: NEW }, on);
  m2.cloud = Object.assign({ backupCodes: [{ code: 'OLDAAAA1', used: false }, { code: 'OLDAAAA2', used: false }], twoFactorUpdatedAt: OLD }, on);
  vm.runInContext('mergeTwoFactorState(local, cloud)', m2);
  assertEq(m2.local.backupCodes.map(function (c) { return c.code; }).join(','), 'NEWBBBB1,NEWBBBB2', 'an older copy does not add the revoked codes back');
  m2.local = Object.assign({ backupCodes: [{ code: 'OLDAAAA1', used: false }, { code: 'OLDAAAA2', used: false }], twoFactorUpdatedAt: OLD }, on);
  m2.cloud = Object.assign({ backupCodes: [{ code: 'NEWBBBB1', used: false }, { code: 'NEWBBBB2', used: true }], twoFactorUpdatedAt: NEW }, on);
  vm.runInContext('mergeTwoFactorState(local, cloud)', m2);
  assertEq(m2.local.backupCodes.map(function (c) { return c.code + (c.used ? '*' : ''); }).join(','), 'NEWBBBB1,NEWBBBB2*',
    'a device holding the old set takes the newer set in its place (and a used code stays used)');
  m2.local = Object.assign({ backupCodes: [{ code: 'AAAA1111', used: false }, { code: 'BBBB2222', used: false }], twoFactorUpdatedAt: NEW }, on);
  m2.cloud = Object.assign({ backupCodes: [{ code: 'AAAA1111', used: true }], twoFactorUpdatedAt: OLD }, on);
  vm.runInContext('mergeTwoFactorState(local, cloud)', m2);
  assert(m2.local.backupCodes[0].used === true && m2.local.backupCodes.length === 2, 'an older copy can still BURN a code this device holds');
  m2.local = { emailOtpLogin: false, backupCodes: [{ code: 'CCCC3333', used: false }], twoFactorUpdatedAt: OLD, twoFactorEnabled: true, twoFactorSecret: 'S' };
  m2.cloud = { twoFactorEnabled: false, twoFactorSecret: null, backupCodes: null, twoFactorUpdatedAt: NEW };
  vm.runInContext('mergeTwoFactorState(local, cloud)', m2);
  assertEq(m2.local.backupCodes, null, 'two-step switched off (or cleared by an administrator) elsewhere takes its codes with it');

  /* ---------- 5. The recovery e-mail ---------- */
  console.log('Changing the recovery e-mail takes the password');
  const fields = { tfaEmailInput: { value: 'attacker@evil.example' }, tfaEmailPassword: { value: '' } };
  const toasts = [];
  const acct = { id: 'USR-a', password: await vm.runInContext("hashPassword('Admin-Pass-1')", sb), email: 'admin@cestis.org' };
  const e1 = { CESTISCore: Core, currentLoggedInUser: { id: 'USR-a' }, userAccounts: [acct],
    document: { getElementById: function (id) { return fields[id] || null; } }, showToast: function (m) { toasts.push(m); },
    verifyPassword: function (p, h) { return vm.runInContext('verifyPassword', sb)(p, h); },
    tfaEnabled: function (a) { return !!(a && a.twoFactorEnabled && a.twoFactorSecret); },
    tfaOpenVerify: function (a, o, cb) { e1._verifyCb = cb; }, touchAccount: function (a) { a.updatedAt = 'now'; },
    saveUserAccounts: function () {}, tfaRenderManage: function () {} };
  vm.createContext(e1);
  vm.runInContext(['tfaAccountRecord', 'tfaSaveEmail', 'tfaApplyEmail'].map(function (n) { return extractFunction(SRC, n); }).join('\n'), e1);
  await vm.runInContext('tfaSaveEmail()', e1);
  assertEq(acct.email, 'admin@cestis.org', 'with no password typed, nothing changes');
  fields.tfaEmailPassword.value = 'wrong';
  await vm.runInContext('tfaSaveEmail()', e1);
  assertEq(acct.email, 'admin@cestis.org', 'with the wrong password, nothing changes');
  fields.tfaEmailPassword.value = 'Admin-Pass-1';
  acct.twoFactorEnabled = true; acct.twoFactorSecret = 'S';
  await vm.runInContext('tfaSaveEmail()', e1);
  assertEq(acct.email, 'admin@cestis.org', 'with two-step on, the password alone is not enough…');
  e1._verifyCb();
  assertEq(acct.email, 'attacker@evil.example', '…the change lands only after the authenticator code');
  const gate = extractFunction(SRC, 'tfaGateLogin');
  assert(/allowEmail: !!account\.emailOtpLogin \|\| libMissing/.test(gate), 'an e-mailed code replaces the authenticator only for accounts that chose e-mail codes');

  /* ---------- 6. E-mail codes come with a way in when e-mail fails ---------- */
  console.log('An account using e-mailed codes is never locked out by a failed e-mail');
  const tg = extractFunction(SRC, 'tfaToggleEmailLogin');
  assert(/if\(acct\.emailOtpLogin && !tfaHasUnusedBackupCodes\(acct\)\) \{ _newCodes = tfaGenerateBackupCodes\(\);/.test(tg), 'turning e-mail codes on hands out backup codes');
  assert(/allowBackup: tfaHasUnusedBackupCodes\(tfaAccountRecord\(account\)\)/.test(extractFunction(SRC, 'tfaBeginEmailLogin')), 'and the e-mail prompt accepts them');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
