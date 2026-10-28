/* A password printed in this public repository must never open the platform.

   What happened (accounts-01, accounts-02, accounts-24 and the verifiers'
   admin#4 in the audit):
     - the built-in logins (cestisadmin, adminstaff, cmcadmin) were seeded with
       'cestisadmin123$' and KEPT it until somebody changed it, and a one-time
       reset ('voctrain_adminDefaultReset') even put the administrator BACK on
       it on every device. A trainee at a lab PC typed it from GitHub and got
       the Administrator panel; proven in headless Chromium on a device that
       held a real administrator with a real password.
     - a deleted built-in login came back: an administrator's logout wiped the
       lists of deleted accounts, trainees and centres, so the next page load
       re-seeded the deleted logins with the published password — and the next
       ledger save published the shortened list to every other device.
     - the built-in logins carry placeholder recovery addresses nobody reads,
       and "Forgot password" mailed reset codes there.

   Pinned here (root index.html; the Offline System page is regenerated from
   it by the offline generator):
     - CESTISCore.accountAccess.publishedDefaultLogin: once the Centre has an
       administrator with a password of its own, a login still on a published
       default is refused; before that (a brand-new installation) the default
       only leads to "set a new password" — the first-run path;
     - every password sign-in goes through publishedDefaultGate before the
       two-step gate, and the gate refuses / forces the change as above;
     - the one-time reset to the default is gone, and a real password on an
       old unstamped copy is left alone;
     - logout keeps the deletion lists (and the applied-migration markers),
       and a deleted built-in is not re-seeded on the next load;
     - the ledger save writes down every deletion the ledger already holds
       before writing, so it never publishes fewer;
     - "Forgot password" refuses the placeholder recovery addresses.

   Run: node tests/published-default-login.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const Core = require('../cestis-core.js');
const AA = Core.accountAccess;

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
function makeStore(initial) {
  const data = Object.assign({}, initial);
  return {
    _data: data,
    get length() { return Object.keys(data).length; },
    key: function (i) { return Object.keys(data)[i]; },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    removeItem: function (k) { delete data[k]; }
  };
}

const REAL = 'pbkdf2$210000$0011$2233';
const SEED = 'pbkdf2$210000$aaaa$bbbb';

/* ---------- 1. The rule ---------- */
console.log('A published default opens nothing once the Centre has a real administrator');
{
  const seedAdmin = { id: 'USR-001', role: 'admin', username: 'cestisadmin', password: SEED, defaultPassword: true, status: 'active' };
  const seedStaff = { id: 'USR-011', role: 'adminstaff', username: 'adminstaff', password: SEED, defaultPassword: true, status: 'active' };
  const realAdmin = { id: 'USR-real', role: 'admin', username: 'realadmin', password: REAL, status: 'active' };
  assert(AA.isPublishedDefault('cestisadmin123$') && AA.isPublishedDefault('admin123'), 'both published passwords are recognised');
  assert(!AA.isPublishedDefault('Centre-2026!') && !AA.isPublishedDefault(undefined), 'a real password is not');

  let r = AA.publishedDefaultLogin([seedAdmin, seedStaff, realAdmin], seedAdmin);
  assertEq(r.allowed, false, 'with a real administrator present, the seeded administrator login is refused');
  assert(/Settings → Users/.test(r.message), 'and the person is told who can fix it');
  r = AA.publishedDefaultLogin([seedAdmin, seedStaff, realAdmin], seedStaff);
  assertEq(r.allowed, false, 'so is the seeded Admin Staff login');

  r = AA.publishedDefaultLogin([seedAdmin, seedStaff], seedAdmin);
  assertEq(r.allowed, true, 'a brand-new installation (only seeds) may still get in…');
  assertEq(r.mustChange, true, '…but only to set a new password first');
  r = AA.publishedDefaultLogin([seedAdmin, Object.assign({}, realAdmin, { status: 'disabled' })], seedAdmin);
  assertEq(r.allowed, true, 'a disabled administrator is no way in, so the first-run path stays open (never locked out)');
  r = AA.publishedDefaultLogin([seedAdmin, Object.assign({}, realAdmin, { defaultPassword: true })], seedAdmin);
  assertEq(r.allowed, true, 'an administrator still on a seed does not count as a real one');
  r = AA.publishedDefaultLogin([Object.assign({}, realAdmin)], Object.assign({}, realAdmin));
  assertEq(r.allowed, true, 'an account is never refused because of itself');
}

/* ---------- 2. The gate the sign-in handlers use ---------- */
console.log('Every password sign-in goes through the gate before anything opens');
{
  ['admin', 'student', 'instructor', 'adminstaff', 'cmc'].forEach(function (role) {
    const re = new RegExp("publishedDefaultGate\\(\\w+, pw, '" + role + "', function\\(\\)\\{ tfaGateLogin\\(");
    assert(re.test(SRC), 'the ' + role + ' sign-in passes its typed password through publishedDefaultGate, then two-step');
  });
  assert(!/^\s*tfaGateLogin\((adminUser|userAccount), function\(\)\{ currentLoggedInUser = /m.test(SRC),
    'no password sign-in reaches two-step (and the portal) without the gate');

  function runGate(accounts, account, typed) {
    const calls = { alerts: [], forced: null, proceeded: 0 };
    const sb = { CESTISCore: Core, userAccounts: accounts, currentLoggedInUser: null,
      alert: function (m) { calls.alerts.push(m); },
      openForceChangePw: function (role, then) { calls.forced = { role: role, then: then }; } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'publishedDefaultGate'), sb);
    sb.acct = account; sb.typed = typed;
    sb.proceed = function () { calls.proceeded++; };
    vm.runInContext("publishedDefaultGate(acct, typed, 'admin', proceed)", sb);
    calls.loggedIn = sb.currentLoggedInUser;
    return calls;
  }
  const seedAdmin = { id: 'USR-001', role: 'admin', password: SEED, defaultPassword: true, status: 'active' };
  const realAdmin = { id: 'USR-real', role: 'admin', password: REAL, status: 'active' };
  let c = runGate([seedAdmin, realAdmin], seedAdmin, 'cestisadmin123$');
  assertEq(c.proceeded, 0, 'the published default does NOT proceed when a real administrator exists');
  assertEq(c.forced, null, 'and is not even offered a password change (that would be a takeover)');
  assertEq(c.alerts.length, 1, 'the person is told why');
  assertEq(c.loggedIn, null, 'nobody is left signed in');
  c = runGate([seedAdmin], seedAdmin, 'cestisadmin123$');
  assertEq(c.proceeded, 0, 'on a first run the default does not proceed straight in…');
  assert(c.forced && c.forced.role === 'admin' && typeof c.forced.then === 'function', '…it opens "set a new password", which then continues the sign-in');
  c = runGate([seedAdmin, realAdmin], realAdmin, 'S0me-Real-Pass!');
  assertEq(c.proceeded, 1, 'any other password goes straight on');

  const submit = extractFunction(SRC, 'forceChangePwSubmit');
  assert(/KNOWN_DEFAULT_PASSWORDS\.indexOf\(np\) !== -1/.test(submit), 'the new password may not be a published default');
  assert(/if\(then\) then\(\); else enterApp\(role\);/.test(submit), 'after the change the sign-in continues where it left off (two-step included)');
}

/* ---------- 3. Never put back on the default ---------- */
console.log('The one-time reset to the published default is gone');
{
  assert(SRC.indexOf('ADMIN_DEFAULT_RESET') === -1, 'index.html no longer resets the administrator to the default');
  const sb = { CESTISStore: makeStore({ voctrain_users: JSON.stringify([
      { id: 'USR-001', username: 'cestisadmin', role: 'admin', password: REAL, status: 'active' }]) }),
    CESTISCore: Core, console: console, KNOWN_DEFAULT_PASSWORDS: ['cestisadmin123$', 'admin123'], userAccounts: [] };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'loadUserAccounts') + '\nloadUserAccounts();', sb);
  const adm = sb.userAccounts.find(function (a) { return a.id === 'USR-001'; });
  assertEq(adm.password, REAL, 'an unstamped administrator copy keeps its real password');
  assertEq(adm.defaultPassword, undefined, 'and is not marked as a seed');
}

/* ---------- 4. Deletions survive a logout; a deleted built-in stays deleted ---------- */
console.log('A logout keeps what was deleted, and a deleted built-in login is not re-seeded');
{
  const store = makeStore({
    voctrain_users: '[]', voctrain_students: '[1]', voctrain_deletedUserIds: '["USR-001","USR-011","USR-021"]',
    voctrain_deletedStudentIds: '["STU-x"]', voctrain_deletedCentreIds: '["C-1"]', voctrain_dataVersion: '4',
    voctrain_adminDefaultReset: '1', voctrain_syncTombstones: '{}', voctrain_sessionRole: 'admin'
  });
  const sb = { CESTISStore: store, CESTISCore: Core, console: console, adminStaffAccessDefaults: function () { return {}; },
    indexedDB: { deleteDatabase: function () {} }, _sessionWiped: false };
  vm.createContext(sb);
  vm.runInContext(extractFunction(SRC, 'clearAllSessionData') + '\nclearAllSessionData();', sb);
  ['voctrain_deletedUserIds', 'voctrain_deletedStudentIds', 'voctrain_deletedCentreIds', 'voctrain_dataVersion', 'voctrain_adminDefaultReset']
    .forEach(function (k) { assert(store.getItem(k) !== null, k + ' survives an administrator\'s logout'); });
  assertEq(store.getItem('voctrain_students'), null, 'the session\'s data is still wiped');
  assertEq(store.getItem('voctrain_sessionRole'), null, 'and so is the session');

  // The next load: the three built-ins were deleted, a real administrator exists.
  store.setItem('voctrain_users', JSON.stringify([{ id: 'USR-real', role: 'admin', username: 'realadmin', password: REAL, status: 'active' }]));
  const sb2 = { CESTISStore: store, CESTISCore: Core, console: console, KNOWN_DEFAULT_PASSWORDS: ['cestisadmin123$', 'admin123'],
    userAccounts: [], _delUserIdsMemo: null, _delUserIdsAt: 0 };
  vm.createContext(sb2);
  vm.runInContext(['_getDeletedUserIds', 'isUserDeleted', 'recordDeletedUser', 'clearDeletedUser', 'dropDeletedAccounts', 'loadUserAccounts']
    .map(function (n) { return extractFunction(SRC, n); }).join('\n') + '\nloadUserAccounts();', sb2);
  assertEq(sb2.userAccounts.map(function (a) { return a.id; }).join(','), 'USR-real', 'none of the deleted built-in logins is seeded back');
}

/* ---------- 5. The ledger never publishes fewer deletions than it holds ---------- */
console.log('The accounts ledger save writes down the ledger\'s deletions first');
(async function () {
  const store = makeStore({ voctrain_deletedUserIds: '["USR-021"]' });
  const sent = [];
  const sb = { CESTISStore: store, CESTISCore: Core, console: console, isCloudConnected: true, googleAccessToken: 'tok',
    _accountsLedgerSaving: false, _sessionWiped: false, _accountsLedgerFileId: 'FILE1', ACCOUNTS_LEDGER_FILE: 'CESTIS_ACCOUNTS.json',
    GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F' }, currentLoggedInUser: { username: 'realadmin' }, _delUserIdsMemo: null, _delUserIdsAt: 0,
    userAccounts: [{ id: 'USR-real', role: 'admin' }, { id: 'USR-011', role: 'adminstaff', password: SEED, defaultPassword: true }],
    stripSecretFields: function (k, v) { return k === '_plaintextPw' ? undefined : v; },
    handleCloudAuthExpired: function () {},
    fetch: async function (url, opts) {
      if (!opts || !opts.method) return { ok: true, json: async function () { return { accounts: [], deletedUserIds: ['USR-011', 'USR-001'] }; } };
      sent.push(JSON.parse(opts.body));
      return { ok: true, json: async function () { return {}; } };
    } };
  vm.createContext(sb);
  vm.runInContext(['ledgerHeaders', 'findAccountsLedgerFile', '_getDeletedUserIds', 'isUserDeleted', 'recordDeletedUser', 'dropDeletedAccounts', 'mergeCloudAccounts', 'persistUserAccounts', 'saveAccountsLedger']
    .map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb);
  const ok = await vm.runInContext('saveAccountsLedger()', sb);
  assertEq(ok, true, 'the ledger is written');
  const body = sent[0] || {};
  const del = (body.deletedUserIds || []).slice().sort().join(',');
  assertEq(del, 'USR-001,USR-011,USR-021', 'it carries the ledger\'s deletions AND this device\'s — never fewer than it held');
  assert((body.accounts || []).every(function (a) { return a.id !== 'USR-011'; }), 'and an account the ledger had deleted is not published back');

  /* ---------- 6. Placeholder recovery addresses ---------- */
  console.log('"Forgot password" never mails a placeholder address');
  assert(AA.isPlaceholderRecoveryEmail('admin@heartlms.edu.jm') && AA.isPlaceholderRecoveryEmail(' CMC@heartlms.edu.jm '), 'the seeded addresses are recognised');
  assert(!AA.isPlaceholderRecoveryEmail('bursar@cestis.org') && !AA.isPlaceholderRecoveryEmail(''), 'real addresses are not');
  const fp = extractFunction(SRC, 'forgotPwLookup');
  assert(fp.indexOf('isPlaceholderRecoveryEmail(recovery)') !== -1 && fp.indexOf('isPlaceholderRecoveryEmail(recovery)') < fp.indexOf('sendEmailOtp('),
    'forgotPwLookup refuses a placeholder address before any code is sent');
  assert(/isPlaceholderRecoveryEmail\(currentLoggedInUser\.email\)/.test(extractFunction(SRC, 'enterApp')), 'and a login still on one is asked for a real address at sign-in');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
