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

   The rules these tests pin:
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
  const seed = { id: 'USR-001', username: 'cestisadmin', password: 'pbkdf2$210000$aa$bb', mustChangePassword: true };
  const real = { id: 'USR-001', username: 'cestisadmin', password: REAL, mustChangePassword: false };
  assertEq(AA.cloudCopyWins(seed, real), true, 'a new device takes the real account over its own seed');
  assertEq(AA.cloudCopyWins({ id: 'USR-001', password: 'cestisadmin123$' }, real), true,
    'a still-plaintext seed yields too');

  // The infection: a seeded copy arriving from the cloud never replaces a real password.
  assertEq(AA.cloudCopyWins(real, seed), false, 'a seeded copy in the cloud never replaces a real password');
  assertEq(AA.cloudCopyWins(real, { id: 'USR-001', password: 'cestisadmin123$' }), false,
    'nor does a plaintext default');
  assertEq(AA.cloudCopyWins(real, { id: 'USR-001', password: '' }), false, 'nor a copy with no password at all');

  // A strictly newer stamp still wins in either direction.
  assertEq(AA.cloudCopyWins(Object.assign({}, real, { updatedAt: T1 }), Object.assign({}, seed, { updatedAt: T2 })), true,
    'a newer stamp wins even for a copy marked to change its password (a deliberate reset)');
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

  assertEq(AA.isSeededLogin(seed), true, 'a copy marked to change its default is a seed');
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
  assertEq(AA.cloudCopyWins(sandbox.userAccounts[0], { id: 'USR-001', password: 'pbkdf2$1000$aa$bb', mustChangePassword: true }), false,
    page.where + ': a seed arriving later yields to the stamped account');
  assertEq(AA.cloudCopyWins(sandbox.userAccounts[0], { id: 'USR-001', password: OTHER }), false,
    page.where + ': and so does an unstamped stale real copy');

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

(async function () {
  console.log('A sign-in stamps the copy that authenticated');
  for (const page of PAGES) await signInStamps(page);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
