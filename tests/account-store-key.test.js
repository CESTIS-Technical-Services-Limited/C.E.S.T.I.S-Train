/* The user accounts must not be losable — and with them, everybody's password.

   What happened: the Student Progress frame nudges the dashboard with a
   'students-updated' message whenever the roll changes, and the dashboard's
   handler re-reads the collections it also holds in memory. One of those reads
   named the key 'voctrain_userAccounts'. Nothing in the system has ever written
   that key — accounts live under 'voctrain_users' — so the read always missed,
   fell back to '[]', and assigned an empty list straight over userAccounts.

   The saveState() at the end of the same handler then wrote that empty list back
   to 'voctrain_users', destroying every account on the device (hashed passwords,
   two-step secrets and all) and uploading the blank list to Google Drive, which
   carried the wipe to every other machine. The next page load found no accounts
   and re-seeded the three built-in logins, so every real user was told their
   password was wrong and no administrator could see why.

   The two rules these tests pin:
     - a re-read only ever ADOPTS records; a missing, empty or corrupt stored
       value leaves what is already in memory alone;
     - the account list is never written empty over a stored list that holds
       accounts. Deleting a user is a filter over a loaded list and still leaves
       the built-in logins behind, so real removals still save.

   The functions are read straight out of index.html — the LMS keeps its logic
   inline — and run against a stubbed store.

   Run: node tests/account-store-key.test.js */
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
function assertDeep(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OFFLINE = fs.readFileSync(path.join(__dirname, '..', 'Offline System', 'index.html'), 'utf8');

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

/* A localStorage stand-in that records what was written. */
function makeStore(initial) {
  const data = Object.assign({}, initial);
  return {
    data: data,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); }
  };
}

/* ---------- 1. The key the accounts are actually stored under ---------- */
console.log('Every account read and write names the same key');

assert(PAGE.indexOf("getItem('voctrain_userAccounts')") === -1,
  "index.html no longer reads 'voctrain_userAccounts' — a key nothing writes, so the " +
  'read returned nothing and blanked every account');
assert(OFFLINE.indexOf("getItem('voctrain_userAccounts')") === -1,
  "the offline copy no longer reads 'voctrain_userAccounts' either");

/* Whatever key the accounts are READ from at start-up must be the key they are
   WRITTEN to. This is the check that would have caught the original typo. */
const readKeys = (PAGE.match(/getItem\('voctrain_users'\)/g) || []).length;
const writeKeys = (PAGE.match(/setItem\(\s*CESTISStore\s*,\s*'voctrain_users'|'voctrain_users',/g) || []).length;
assert(readKeys > 0, "the accounts are read from 'voctrain_users'");
assert(writeKeys > 0, "and written to 'voctrain_users'");

/* ---------- 2. A re-read never blanks what is loaded ---------- */
console.log('Re-reading a collection only ever adopts records');

const ACCOUNTS = [
  { id: 'USR-001', username: 'cestisadmin', role: 'admin', password: 'pbkdf2$210000$aa$bb', status: 'active' },
  { id: 'USR-7', username: 'john.smith', role: 'student', password: 'pbkdf2$210000$cc$dd', status: 'active' }
];

function runAdopt(storeData) {
  const sandbox = { CESTISStore: makeStore(storeData), console: console };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(PAGE, 'adoptStoredCollection', 'index.html'), sandbox);
  return sandbox;
}

let s = runAdopt({ voctrain_users: JSON.stringify(ACCOUNTS) });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_users', [])", s), ACCOUNTS,
  'the stored accounts are adopted when the store holds them');

s = runAdopt({});
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_users', " + JSON.stringify(ACCOUNTS) + ")", s), ACCOUNTS,
  'a key the store does not hold leaves the loaded accounts alone — this is the ' +
  'exact miss that wiped every password');

s = runAdopt({ voctrain_users: '[]' });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_users', " + JSON.stringify(ACCOUNTS) + ")", s), ACCOUNTS,
  'an empty stored list does not replace loaded accounts');

s = runAdopt({ voctrain_users: '{ truncated' });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_users', " + JSON.stringify(ACCOUNTS) + ")", s), ACCOUNTS,
  'a half-written value is never mistaken for an empty one');

s = runAdopt({ voctrain_users: 'null' });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_users', " + JSON.stringify(ACCOUNTS) + ")", s), ACCOUNTS,
  'a stored null does not replace loaded accounts');

s = runAdopt({ voctrain_studentProfiles: '{"STU-1":{"name":"John Smith"}}' });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_studentProfiles', {})", s),
  { 'STU-1': { name: 'John Smith' } }, 'object collections are adopted too');

s = runAdopt({ voctrain_studentProfiles: '{}' });
assertDeep(vm.runInContext("adoptStoredCollection('voctrain_studentProfiles', {\"STU-1\":{\"name\":\"John Smith\"}})", s),
  { 'STU-1': { name: 'John Smith' } }, 'an empty object does not replace a loaded one');

/* ---------- 3. The account list is never written away ---------- */
console.log('An empty account list never overwrites the stored accounts');

function runPersist(accounts, storeData) {
  const store = makeStore(storeData);
  const sandbox = {
    CESTISStore: store, CESTISCore: Core, console: console,
    userAccounts: accounts,
    stripSecretFields: function (k, v) { return k === '_plaintextPw' ? undefined : v; }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(PAGE, 'persistUserAccounts', 'index.html'), sandbox);
  const wrote = vm.runInContext('persistUserAccounts()', sandbox);
  return { wrote: wrote, store: store };
}

let r = runPersist([], { voctrain_users: JSON.stringify(ACCOUNTS) });
assertEq(r.wrote, false, 'writing an empty list over stored accounts is refused');
assertDeep(JSON.parse(r.store.getItem('voctrain_users')), ACCOUNTS,
  'and the stored accounts — every password with them — are still there');

r = runPersist(ACCOUNTS, { voctrain_users: '[]' });
assertEq(r.wrote, true, 'real accounts are saved over an empty stored list');
assertDeep(JSON.parse(r.store.getItem('voctrain_users')), ACCOUNTS, 'and they are what was stored');

r = runPersist(ACCOUNTS, {});
assertEq(r.wrote, true, 'a device saving for the first time still writes');

r = runPersist([ACCOUNTS[0]], { voctrain_users: JSON.stringify(ACCOUNTS) });
assertEq(r.wrote, true, 'removing a user is a real edit and still saves');
assertEq(JSON.parse(r.store.getItem('voctrain_users')).length, 1, 'the removal took effect');

console.log('A session password cache never reaches storage');
const cached = [Object.assign({ _plaintextPw: 'hunter2' }, ACCOUNTS[1])];
r = runPersist(cached, {});
assert(r.store.getItem('voctrain_users').indexOf('hunter2') === -1,
  'the plaintext cache is stripped on the way out');

/* ---------- 4. Both writers go through the guard ---------- */
console.log('Both account writers go through the guard');

['index.html', 'Offline System/index.html'].forEach(function (f) {
  const src = f === 'index.html' ? PAGE : OFFLINE;
  assert(src.indexOf("setItem('voctrain_users', JSON.stringify(userAccounts") === -1,
    f + ' writes the accounts only through persistUserAccounts()');
  assert(src.indexOf('function persistUserAccounts(') !== -1,
    f + ' defines the guarded account writer');
  assert(src.indexOf('function adoptStoredCollection(') !== -1,
    f + ' defines the non-destructive re-read');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
