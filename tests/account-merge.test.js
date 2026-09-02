/* The right password must survive a sync — on a brand-new device most of all.

   What happened: every device seeds the three built-in logins (cestisadmin,
   adminstaff, cmcadmin) with the published default password the first time it
   opens the platform, and only then pulls the real accounts from Drive. The
   merge decided between two copies of an account by their edit stamp
   (updatedAt) and treated a tie — which is what two UNSTAMPED copies are — as
   "the cloud copy wins". Most long-standing accounts are unstamped, the
   administrator's first: the stamp arrived long after their passwords were
   set. So a tie went to whichever copy arrived last — a new device's seed, a
   stale copy in one of the redundant Drive folders, a laptop that had been off
   for months — and the next autosave carried that copy to every device. People
   were told their password was wrong on accounts nobody had touched.

   And the Centre's rule for the built-in logins: cestisadmin signs in with
   cestisadmin123$ on any device unless its password has been changed. The
   seed keeps that password — nothing forces a change at first sign-in — and
   carries the marker defaultPassword:true so a sync can tell a seed from a
   password somebody set.

   The rules these tests pin:
     - a seed keeps the published default until a password is set, and every
       path that sets one clears the marker;
     - a strictly newer stamp wins, in either direction;
     - on a tie, a seeded default never replaces a real password, in either
       direction — the fresh device takes the real account, and a seed can
       never overwrite one;
     - a copy that has just authenticated its owner is stamped, so from then on
       it is the newest copy and every stale one yields to it;
     - the folders are merged oldest copy first, so the newest copy of the
       backup wins whatever tie the record rules leave open.

   Run: node tests/account-merge.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
];

const REAL = 'pbkdf2$210000$0011$2233';     // a password somebody set
const OTHER = 'pbkdf2$210000$4455$6677';    // a different real password
const T1 = '2026-08-01T09:00:00.000Z';
const T2 = '2026-08-20T09:00:00.000Z';

/* ---------- 1. Which copy of an account a merge keeps ---------- */
PAGES.forEach(function (page) {
  const AA = page.core.accountAccess;
  console.log('Merge rule (' + page.where.replace('/index.html', '') + ')');

  // The fresh-device case: the seed yields to the real account.
  const seed = { id: 'USR-001', username: 'cestisadmin', password: 'pbkdf2$210000$aa$bb', defaultPassword: true };
  const legacySeed = { id: 'USR-001', username: 'cestisadmin', password: 'pbkdf2$210000$aa$bb', mustChangePassword: true };
  const real = { id: 'USR-001', username: 'cestisadmin', password: REAL, mustChangePassword: false };
  assertEq(AA.cloudCopyWins(seed, real), true, 'a new device takes the real account over its own seed');
  assertEq(AA.cloudCopyWins({ id: 'USR-001', password: 'cestisadmin123$' }, real), true,
    'a still-plaintext seed yields too');
  assertEq(AA.cloudCopyWins(legacySeed, real), true, 'and a seed an older version marked to change its password');

  // The infection: a seeded copy arriving from the cloud never replaces a real password.
  assertEq(AA.cloudCopyWins(real, seed), false, 'a seeded copy in the cloud never replaces a real password');
  assertEq(AA.cloudCopyWins(real, legacySeed), false, 'nor one an older version marked');
  assertEq(AA.cloudCopyWins(real, { id: 'USR-001', password: 'cestisadmin123$' }), false,
    'nor does a plaintext default');
  assertEq(AA.cloudCopyWins(real, { id: 'USR-001', password: '' }), false, 'nor a copy with no password at all');

  // A strictly newer stamp still wins in either direction.
  assertEq(AA.cloudCopyWins(Object.assign({}, real, { updatedAt: T1 }), Object.assign({}, seed, { updatedAt: T2 })), true,
    'a newer stamp wins even for a copy marked as a seed (a deliberate reset to the default)');
  assertEq(AA.cloudCopyWins(Object.assign({}, real, { updatedAt: T2 }), { id: 'USR-001', password: OTHER, updatedAt: T1 }), false,
    'a fresher local edit is never overwritten by an older cloud copy');
  assertEq(AA.cloudCopyWins({ id: 'USR-001', password: OTHER, updatedAt: T1 }, Object.assign({}, real, { updatedAt: T2 })), true,
    'a fresher cloud edit reaches this device');
  assertEq(AA.cloudCopyWins(Object.assign({}, real, { updatedAt: T1 }), { id: 'USR-001', password: OTHER }), false,
    'a stamped copy beats an unstamped one — the stamp a sign-in leaves is enough');

  // Two unstamped real copies still converge on the cloud, as before.
  assertEq(AA.cloudCopyWins(real, { id: 'USR-001', password: OTHER }), true,
    'two unstamped real copies still converge on the cloud copy');
  assertEq(AA.cloudCopyWins(null, real), true, 'no local copy: the cloud one is taken');
  assertEq(AA.cloudCopyWins(real, null), false, 'no cloud copy: nothing to take');
  assertEq(AA.cloudCopyWins({ password: REAL, updatedAt: 'not a date' }, { password: OTHER, updatedAt: T1 }), true,
    'an unreadable stamp counts as no stamp');

  assertEq(AA.isSeededLogin(seed), true, 'a copy marked as holding the default is a seed');
  assertEq(AA.isSeededLogin(legacySeed), true, 'so is one an older version marked to change it');
  assertEq(AA.isSeededLogin({ password: 'admin123' }), true, 'a plaintext published default is a seed');
  assertEq(AA.isSeededLogin(real), false, 'a real password is not');
});

/* ---------- 2. The newest copy of the backup applies last ---------- */
PAGES.forEach(function (page) {
  const CM = page.core.cloudMerge;
  console.log('Folder order (' + page.where.replace('/index.html', '') + ')');
  const order = CM.oldestFirst([
    { label: 'Main', modifiedTime: '2026-08-20T10:00:00Z' },
    { label: 'Exams', modifiedTime: '2026-05-01T10:00:00Z' },
    { label: 'Chat' },
    { label: 'Recordings', modifiedTime: '2026-08-20T10:00:05Z' },
    { label: 'Assignments', modifiedTime: 'garbage' }
  ]).map(function (e) { return e.label; });
  assertEq(order.join(','), 'Chat,Assignments,Exams,Main,Recordings',
    'unknown ages first, then oldest to newest, so the newest copy applies last');
  assertEq(CM.oldestFirst(undefined).length, 0, 'nothing to order is nothing');
  const same = CM.oldestFirst([{ n: 1, modifiedTime: T1 }, { n: 2, modifiedTime: T1 }]).map(function (e) { return e.n; });
  assertEq(same.join(','), '1,2', 'equal ages keep their list order');
});

/* ---------- 3. Both pages go through the rule, on every account path ---------- */
console.log('Every account merge goes through the shared rule');
PAGES.forEach(function (page) {
  const src = page.src, where = page.where;
  const uses = (src.match(/CESTISCore\.accountAccess\.cloudCopyWins\(/g) || []).length;
  assert(uses >= 2, where + ' decides the cloud-vs-local copy through cloudCopyWins on both merge paths (found ' + uses + ')');
  assert(src.indexOf('if (_cu >= _lu)') === -1 && src.indexOf('if (_cu2 >= _lu2)') === -1,
    where + ' no longer settles an unstamped tie on the cloud copy by itself');
  const orders = (src.match(/CESTISCore\.cloudMerge\.oldestFirst\(/g) || []).length;
  assert(orders >= 2, where + ' merges the folders oldest copy first on both login syncs (found ' + orders + ')');
  assert(src.indexOf('fields=files(id,name,modifiedTime)') !== -1, where + ' asks Drive when each copy was written');
  assert(src.indexOf('stampVerifiedAccount(account)') !== -1, where + ' stamps the copy that authenticated');
  assert(src.indexOf('password:DEFAULT_SEED_PW,mustChangePassword:true') === -1
    && (src.match(/password:DEFAULT_SEED_PW,defaultPassword:true/g) || []).length === 3,
    where + ' seeds the three built-in logins with the default and marks them as seeds, not as must-change');
  assert(src.indexOf('currentLoggedInUser.mustChangePassword') === -1,
    where + ' no longer forces a password change at sign-in — the default stays until somebody changes it');
  assert(src.indexOf('delete user.defaultPassword') !== -1 && src.indexOf('delete acct.defaultPassword') !== -1
    && src.indexOf('delete canonical.defaultPassword') !== -1,
    where + ' clears the seed marker on every path that sets a password');
  assert(src.indexOf('function markDefaultPasswordAccounts') !== -1 && src.indexOf('flagDefaultPasswordAccounts') === -1,
    where + ' keeps the marker true to the hash instead of flagging accounts for a forced change');
  assert((src.match(/cloudUser\.defaultPassword \|\| cloudUser\.mustChangePassword/g) || []).length === 1
    && (src.match(/ca\.defaultPassword \|\| ca\.mustChangePassword/g) || []).length === 1,
    where + ' carries the seed marker with the password on both merge paths');
});

/* ---------- 3b. The seed keeps the published default, and says so ---------- */
console.log('The built-in administrator keeps cestisadmin123$ until somebody changes it');
function makeStore(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; }
  };
}
function loadAccounts(page, stored) {
  const sandbox = { CESTISStore: makeStore(stored), CESTISCore: page.core, console: console,
    KNOWN_DEFAULT_PASSWORDS: ['cestisadmin123$', 'admin123'], userAccounts: [] };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(page.src, 'loadUserAccounts', page.where) + '\nloadUserAccounts();', sandbox);
  return sandbox.userAccounts;
}
PAGES.forEach(function (page) {
  const w = page.where;
  let accts = loadAccounts(page, {});
  const admin = accts.find(function (a) { return a.id === 'USR-001'; });
  assert(!!admin && admin.username === 'cestisadmin', w + ': a fresh device seeds cestisadmin');
  assertEq(admin && admin.password, 'cestisadmin123$', w + ': with the published default password');
  assertEq(admin && admin.defaultPassword, true, w + ': marked as a seed');
  assertEq(admin && admin.mustChangePassword, undefined, w + ': and NOT marked to change it');
  assert(accts.every(function (a) { return !a.mustChangePassword; }), w + ': no seed is marked to change its password');

  // A password somebody set is left exactly as it is — that is "unless changed by user".
  accts = loadAccounts(page, { voctrain_users: JSON.stringify([
    { id: 'USR-001', username: 'cestisadmin', role: 'admin', password: REAL, status: 'active', updatedAt: T1 }]) });
  const kept = accts.find(function (a) { return a.id === 'USR-001'; });
  assertEq(kept && kept.password, REAL, w + ': a changed password is never put back to the default');
  assertEq(kept && kept.defaultPassword, undefined, w + ': and is not marked as a seed');

  // A device on an older version left the seed flagged for a forced change.
  accts = loadAccounts(page, { voctrain_users: JSON.stringify([
    { id: 'USR-001', username: 'cestisadmin', role: 'admin', password: 'pbkdf2$210000$aa$bb', status: 'active', mustChangePassword: true }]) });
  const legacy = accts.find(function (a) { return a.id === 'USR-001'; });
  assertEq(legacy && legacy.defaultPassword, true, w + ': an older version\'s flag becomes the seed marker');
  assertEq(legacy && legacy.mustChangePassword, undefined, w + ': and the forced change is retired');

  // A seed left with no password at all gets the default back.
  accts = loadAccounts(page, { voctrain_users: JSON.stringify([
    { id: 'USR-001', username: 'cestisadmin', role: 'admin', password: '', status: 'active' }]) });
  const restored = accts.find(function (a) { return a.id === 'USR-001'; });
  assertEq(restored && restored.password, 'cestisadmin123$', w + ': an administrator left without a password gets the default back');
  assertEq(restored && restored.defaultPassword, true, w + ': marked as a seed');
});

/* ---------- 4. A sign-in stamps the copy that worked ---------- */
function extractFunction(src, name, where) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  const start = m.index;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

async function signInStamps(page) {
  const names = ['_bufToHex', '_hexToBuf', 'hashPasswordLegacy', '_pbkdf2Hex', 'hashPassword', 'verifyPassword',
    'cachePlaintextPw', 'maybeUpgradePasswordHash', 'checkPassword', 'stampVerifiedAccount', 'touchAccount'];
  const code = names.map(function (n) { return extractFunction(page.src, n, page.where); }).join('\n');
  const saves = [];
  const sandbox = {
    crypto: globalThis.crypto, TextEncoder: TextEncoder, Uint8Array: Uint8Array, console: console,
    CESTISCore: page.core,
    PBKDF2_ITERATIONS: 1000, userAccounts: [], saveUserAccounts: function () { saves.push(1); }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const run = function (expr) { return vm.runInContext(expr, sandbox); };

  const hash = await run("hashPassword('Centre-2026!')");
  assert(hash.indexOf('pbkdf2$') === 0, 'a fresh hash is PBKDF2');

  // The long-standing account: a real hash, no stamp — as on every device today.
  sandbox.userAccounts = [{ id: 'USR-001', username: 'cestisadmin', role: 'admin', password: hash, status: 'active' }];
  const before = Date.now();
  assertEq(await run("checkPassword('wrong-password', userAccounts[0].password, userAccounts[0])"), false,
    page.where + ': a wrong password is refused');
  assertEq(sandbox.userAccounts[0].updatedAt, undefined, page.where + ': a wrong password stamps nothing');
  assertEq(saves.length, 0, page.where + ': and saves nothing');

  assertEq(await run("checkPassword('Centre-2026!', userAccounts[0].password, userAccounts[0])"), true,
    page.where + ': the right password is accepted');
  const stamp = sandbox.userAccounts[0].updatedAt;
  assert(typeof stamp === 'string' && Date.parse(stamp) >= before, page.where + ': the copy that worked is stamped now');
  assertEq(sandbox.userAccounts[0].password, hash, page.where + ': the hash itself is untouched');
  assert(saves.length >= 1, page.where + ': and saved, so the stamp reaches Drive');

  // From here on a stale unstamped copy — the seed, an old folder — yields.
  const AA = page.core.accountAccess;
  assertEq(AA.cloudCopyWins(sandbox.userAccounts[0], { id: 'USR-001', password: 'pbkdf2$1000$aa$bb', defaultPassword: true }), false,
    page.where + ': a seed arriving later yields to the stamped account');
  assertEq(AA.cloudCopyWins(sandbox.userAccounts[0], { id: 'USR-001', password: OTHER }), false,
    page.where + ': and so does an unstamped stale real copy');

  // Signing in with the published default on a seed stamps NOTHING: the seed
  // must never become the newest copy, or it would replace a real password on
  // the next sync — the opposite of "the default, unless changed".
  const seedHash = await run("hashPassword('cestisadmin123$')");
  sandbox.userAccounts.push({ id: 'USR-011', username: 'adminstaff', role: 'adminstaff', password: seedHash, defaultPassword: true, status: 'active' });
  assertEq(await run("checkPassword('cestisadmin123$', userAccounts[1].password, userAccounts[1])"), true,
    page.where + ': the published default signs in on a seed');
  assertEq(sandbox.userAccounts[1].updatedAt, undefined, page.where + ': but a seed is never stamped');
  // The same when the sign-in upgrades an old-format seed to PBKDF2.
  const legacySeedHash = await run("hashPasswordLegacy('cestisadmin123$')");
  sandbox.userAccounts.push({ id: 'USR-021', username: 'cmcadmin', role: 'cmc', password: legacySeedHash, defaultPassword: true, status: 'active' });
  assertEq(await run("checkPassword('cestisadmin123$', userAccounts[2].password, userAccounts[2])"), true,
    page.where + ': an old-format seed still signs in with the default');
  assert(sandbox.userAccounts[2].password.indexOf('pbkdf2$') === 0, page.where + ': and is upgraded to PBKDF2');
  assertEq(sandbox.userAccounts[2].updatedAt, undefined, page.where + ': without being stamped');
  assertEq(sandbox.userAccounts[2].defaultPassword, true, page.where + ': and still marked as a seed');

  // A stamp that exists is never moved by a sign-in.
  sandbox.userAccounts[0].updatedAt = T1;
  await run("checkPassword('Centre-2026!', userAccounts[0].password, userAccounts[0])");
  assertEq(sandbox.userAccounts[0].updatedAt, T1, page.where + ': an existing stamp is left where a real edit put it');

  // The login handlers pass the record they found; the stamp lands on the canonical one.
  const copy = Object.assign({}, sandbox.userAccounts[0]); delete copy.updatedAt; delete sandbox.userAccounts[0].updatedAt;
  sandbox.found = copy;
  await run("checkPassword('Centre-2026!', found.password, found)");
  assert(!!sandbox.userAccounts[0].updatedAt && sandbox.userAccounts[0].updatedAt === copy.updatedAt,
    page.where + ': the stamp lands on the stored record and on the copy the handler holds');
}

async function sweepKeepsMarkerHonest(page) {
  const names = ['_bufToHex', '_hexToBuf', 'hashPasswordLegacy', '_pbkdf2Hex', 'hashPassword', 'verifyPassword',
    'isHashedPassword', 'markDefaultPasswordAccounts'];
  const code = names.map(function (n) { return extractFunction(page.src, n, page.where); }).join('\n');
  const sandbox = { crypto: globalThis.crypto, TextEncoder: TextEncoder, Uint8Array: Uint8Array, console: console,
    PBKDF2_ITERATIONS: 1000, KNOWN_DEFAULT_PASSWORDS: ['cestisadmin123$', 'admin123'], _defaultPwSweepDone: false,
    userAccounts: [], saveUserAccounts: function () {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const run = function (expr) { return vm.runInContext(expr, sandbox); };
  const seedHash = await run("hashPassword('cestisadmin123$')");
  const realHash = await run("hashPassword('Centre-2026!')");
  sandbox.userAccounts = [
    { id: 'USR-001', role: 'admin', password: seedHash },                        // hashed seed, never marked
    { id: 'USR-011', role: 'adminstaff', password: realHash, defaultPassword: true }, // changed, marker forgotten
    { id: 'USR-7', role: 'student', password: seedHash }                          // out of the sweep's scope
  ];
  await run('markDefaultPasswordAccounts()');
  assertEq(sandbox.userAccounts[0].defaultPassword, true, page.where + ': a hashed seed is marked as a seed');
  assertEq(sandbox.userAccounts[1].defaultPassword, undefined, page.where + ': a real password loses a stale marker');
  assertEq(sandbox.userAccounts[2].defaultPassword, undefined, page.where + ': only privileged accounts are swept');
}

(async function () {
  console.log('The sweep keeps the seed marker true to the hash');
  for (const page of PAGES) await sweepKeepsMarkerHonest(page);
  console.log('A sign-in stamps the copy that authenticated');
  for (const page of PAGES) await signInStamps(page);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
