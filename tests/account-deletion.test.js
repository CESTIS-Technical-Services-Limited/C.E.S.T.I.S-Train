/* An administrator can delete an account — any role — and it stays deleted.

   Until now the Users table could only switch an account OFF. That is right for
   a trainee between intakes, but not for a login that should not exist: a member
   of staff who has left, a duplicate a sync made, a registration typed wrong.
   Those stayed in the table for good, still counted, still holding a password.

   Deleting is disabling that cannot be undone, so it answers to the same rule
   and two more of its own. These tests pin all three, plus the thing that makes
   a deletion actually stick:

     - the Centre can never be locked out of its own platform by a deletion;
     - an administrator cannot delete the account they are signed in with;
     - every role is deletable, because those are exactly the logins that change;
     - the removal is WRITTEN DOWN. Every cloud path adds an account it cannot
       find locally, so an account merely spliced out of the list is handed back
       at the next sync — a revoked login live again, password and all.

   Run: node tests/account-deletion.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');
const AA = Core.accountAccess;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const PW = 'pbkdf2$210000$abcd$ef01';
function acct(over) {
  return Object.assign({ id: 'USR-X', name: 'Someone', role: 'student',
    username: 'someone', password: PW, status: 'active' }, over || {});
}

/* One of every role that signs in, all usable. */
const ROSTER = [
  acct({ id: 'USR-A1', role: 'admin',      username: 'r.barrett'   }),
  acct({ id: 'USR-A2', role: 'admin',      username: 'a.jones'     }),
  acct({ id: 'USR-S1', role: 'adminstaff', username: 'j.brown'     }),
  acct({ id: 'USR-C1', role: 'cmc',        username: 'chair.smith' }),
  acct({ id: 'USR-I1', role: 'instructor', username: 'm.green'     }),
  acct({ id: 'USR-T1', role: 'student',    username: 'john.smith'  })
];

/* ---------- 1. Every role can be deleted ---------- */
console.log('An administrator can delete an account in any role');

['USR-A2', 'USR-S1', 'USR-C1', 'USR-I1', 'USR-T1'].forEach(function (id) {
  const role = ROSTER.find(function (a) { return a.id === id; }).role;
  const res = AA.deletionBlocked(ROSTER, [id], { actingId: 'USR-A1' });
  assertEq(res.blocked, false, 'a ' + role + ' account can be deleted');
});

console.log('Several at once, across roles, in one go');
assertEq(AA.deletionBlocked(ROSTER, ['USR-S1', 'USR-I1', 'USR-T1'], { actingId: 'USR-A1' }).blocked, false,
  'a mixed selection is allowed');

/* ---------- 2. It can never lock the Centre out ---------- */
console.log('It can never leave the Centre unable to administer itself');

let res = AA.deletionBlocked(ROSTER, ['USR-A1', 'USR-A2'], { actingId: null });
assertEq(res.blocked, true, 'deleting every administrator is refused');
assertEq(res.reason, 'strand-admins', 'and says why');
assert(res.message.indexOf('administrator') !== -1, 'in words an administrator can act on');

assertEq(AA.deletionBlocked(ROSTER, ['USR-A2'], { actingId: 'USR-A1' }).blocked, false,
  'deleting one of two administrators is fine');

/* The rule counts administrators who can ACTUALLY sign in — the same distinction
   the Centre kept losing. An admin that merely looks active is not a fallback. */
const WEAK = [
  acct({ id: 'USR-A1', role: 'admin', username: 'r.barrett' }),
  acct({ id: 'USR-A2', role: 'admin', username: 'ghost', password: '' }),        // no password
  acct({ id: 'USR-A3', role: 'admin', username: 'off', status: 'disabled' }),    // switched off
  acct({ id: 'USR-A4', role: 'admin', username: 'new', status: 'pending' })      // never approved
];
res = AA.deletionBlocked(WEAK, ['USR-A1'], { actingId: null });
assertEq(res.blocked, true,
  'deleting the only administrator who can really sign in is refused, even with three other admin rows present');

assertEq(AA.deletionBlocked(WEAK, ['USR-A2', 'USR-A3', 'USR-A4'], { actingId: 'USR-A1' }).blocked, false,
  'and the unusable admin rows themselves can be cleaned up');

/* ---------- 3. Not the chair you are sitting on ---------- */
console.log('An administrator cannot delete the account they are signed in with');

res = AA.deletionBlocked(ROSTER, ['USR-A1'], { actingId: 'USR-A1' });
assertEq(res.blocked, true, 'deleting your own account is refused');
assertEq(res.reason, 'self', 'and says so, rather than blaming the admin count');

res = AA.deletionBlocked(ROSTER, ['USR-T1', 'USR-A1'], { actingId: 'USR-A1' });
assertEq(res.blocked, true, 'including when it is buried in a bulk selection');
assertEq(res.reason, 'self', 'still named for what it is');

assertEq(AA.deletionBlocked(ROSTER, ['USR-A1'], {}).blocked, false,
  'with no signed-in id known, the admin-count rule is what applies');

console.log('An empty selection is refused rather than silently doing nothing');
assertEq(AA.deletionBlocked(ROSTER, []).reason, 'none-selected', 'nothing selected');
assertEq(AA.deletionBlocked(ROSTER, [null, '']).reason, 'none-selected', 'blank ids are not a selection');

/* ---------- 4. The deletion sticks ---------- */
console.log('A deleted account cannot come back at the next sync');

const deleted = { 'USR-I1': true, 'USR-T1': true };
let drop = AA.dropDeleted(ROSTER, deleted);
assertEq(drop.removed, 2, 'both deleted accounts are dropped');
assertEq(drop.accounts.length, ROSTER.length - 2, 'and the rest are untouched');
assert(drop.accounts.every(function (a) { return !deleted[a.id]; }), 'none of them survives the sweep');

console.log('The sweep is what makes a merge safe — it runs over whatever the merge produced');
/* A cloud copy still holding the deleted instructor is merged in; the sweep is
   the thing that stops the revoked login being live again. */
const afterMerge = ROSTER.concat([acct({ id: 'USR-I1', role: 'instructor', username: 'm.green' })]);
assertEq(AA.dropDeleted(afterMerge, deleted).accounts.filter(function (a) { return a.id === 'USR-I1'; }).length, 0,
  'the account a sync handed back is removed again');

assertEq(AA.dropDeleted(ROSTER, {}).removed, 0, 'nothing deleted, nothing dropped');
assertEq(AA.dropDeleted(ROSTER, null).removed, 0, 'null-safe');
assertEq(AA.dropDeleted(null, deleted).removed, 0, 'and survives a missing list');

console.log('The deletion list is merged by union, so two devices keep each other’s removals');
assertEq(Core.isTombstoneKey('voctrain_deletedUserIds'), true,
  'voctrain_deletedUserIds is a tombstone list — merged by union, never one list replacing the other');

const union = Core.unionTombstoneValues('["USR-I1"]', '["USR-T1"]');
const ids = JSON.parse(union).slice().sort();
assertEq(ids.join(','), 'USR-I1,USR-T1',
  'a device that deleted the instructor and one that deleted the trainee end up with both');

/* ---------- 5. Wired into the page ---------- */
console.log('The page offers it, warns first, and honours it everywhere');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ADMINPAGE = fs.readFileSync(path.join(__dirname, '..', 'Pages', 'Administration.html'), 'utf8');

assert(PAGE.indexOf('id="deleteUserModal"') !== -1, 'there is a warning popup before anything is deleted');
assert(PAGE.indexOf('This cannot be undone.') !== -1, 'it says the deletion cannot be undone');
assert(/onclick="confirmDeleteUsers\(\)"/.test(PAGE), 'and nothing is deleted until it is confirmed');
assert(PAGE.indexOf('openDeleteUser(') !== -1, 'every row offers Delete');
assert(ADMINPAGE.indexOf('openBulkDeleteUsers()') !== -1, 'and the bulk bar offers it for a selection');

/* The guard has to be re-checked after the popup, not only before it. */
const confirmFn = PAGE.slice(PAGE.indexOf('function confirmDeleteUsersVerified('));
assert(confirmFn.slice(0, 1200).indexOf('deletionBlocked') !== -1,
  'the rules are checked again on confirm — the roster can move while the popup is open');
assert(confirmFn.slice(0, 1600).indexOf('recordDeletedUser') !== -1,
  'and the removal is written down, not just spliced out');

/* Every path that adds an account from the cloud must honour the tombstone.
   Every such path now runs through ONE function, mergeCloudAccounts, so the
   check is structural: that function checks the tombstone, and it is the
   only place a cloud account is pushed onto the list. */
function mergeFn(src) {
  const at = src.indexOf('function mergeCloudAccounts(');
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  return '';
}
const mergeSrc = mergeFn(PAGE);
assert(mergeSrc.indexOf('isUserDeleted(') !== -1, 'the one account merge checks the tombstone first');
const cloudPushes = (PAGE.match(/userAccounts\.push\((cloudUser|cu|ca|fresh)\)/g) || []);
assert(cloudPushes.length === 1 && mergeSrc.indexOf('userAccounts.push(fresh)') !== -1,
  'and it is the only place a cloud account is added (found ' + cloudPushes.length + ')');
assert(PAGE.indexOf('function dropDeletedAccounts(') !== -1 && (PAGE.match(/dropDeletedAccounts\(\)/g) || []).length >= 2,
  'and the tombstones are swept wherever the list is read or saved');
assert(PAGE.indexOf("'voctrain_deletedUserIds'") !== -1, 'the deletions are stored');
assert(PAGE.indexOf("'voctrain_deletedCentreIds','voctrain_deletedStudentIds','voctrain_deletedUserIds'") !== -1,
  'and travel with the accounts in every backup — restore the users without them and every deleted login returns');

/* ---------- 6. The offline build has the same feature, under the same rules ----------

   The Centre runs a self-hosted copy from `Offline System/` when there is no
   internet — the same platform, the same people, the same staff turnover. An
   administrator who can delete a stale login on one build and not the other has
   half a feature, and the two would drift apart on exactly the rules that decide
   who may be removed. So the rules are the SAME BYTES in both cores, and these
   tests are run against both. */
console.log('The offline build offers it too, under the same rules');

const OfflineCore = require('../Offline System/cestis-core.js');
const OAA = OfflineCore.accountAccess;

assertEq(typeof OAA.deletionBlocked, 'function', 'the offline core knows the deletion rules');
assertEq(typeof OAA.dropDeleted, 'function', 'and how to sweep a deleted account away');
assertEq(OfflineCore.isTombstoneKey('voctrain_deletedUserIds'), true,
  'and merges the deletion list by union, so an offline machine and an online one keep each other\'s removals');

/* The rules themselves, not just their presence — re-run the cases that matter. */
assertEq(OAA.deletionBlocked(ROSTER, ['USR-I1'], { actingId: 'USR-A1' }).blocked, false,
  'offline: an instructor can be deleted');
assertEq(OAA.deletionBlocked(ROSTER, ['USR-S1', 'USR-C1', 'USR-T1'], { actingId: 'USR-A1' }).blocked, false,
  'offline: admin staff, board member and trainee too');
assertEq(OAA.deletionBlocked(ROSTER, ['USR-A1', 'USR-A2'], {}).reason, 'strand-admins',
  'offline: it still cannot leave the Centre unable to administer itself');
assertEq(OAA.deletionBlocked(WEAK, ['USR-A1'], {}).reason, 'strand-admins',
  'offline: counting administrators who can really sign in, not rows that look active');
assertEq(OAA.deletionBlocked(ROSTER, ['USR-A1'], { actingId: 'USR-A1' }).reason, 'self',
  'offline: still not the chair you are sitting on');
assertEq(OAA.dropDeleted(ROSTER, { 'USR-I1': true, 'USR-T1': true }).removed, 2,
  'offline: the sweep removes what was deleted');

/* Same source, so the two builds cannot answer differently. */
function rulesBlock(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const a = src.indexOf('    /* May these accounts be deleted?');
  const b = src.indexOf('    return {\n      idMatches: idMatches', a);
  return a > -1 && b > a ? src.slice(a, b) : null;
}
const onlineRules = rulesBlock('cestis-core.js');
const offlineRules = rulesBlock('Offline System/cestis-core.js');
assert(onlineRules && onlineRules.length > 500, 'the online build states the rules');
assertEq(offlineRules, onlineRules,
  'and the offline build states them in the SAME BYTES — the two cannot drift on who may be deleted');

console.log('The offline page offers it, warns first, and honours it everywhere');

const OPAGE = fs.readFileSync(path.join(__dirname, '..', 'Offline System', 'index.html'), 'utf8');
const OADMIN = fs.readFileSync(path.join(__dirname, '..', 'Offline System', 'Pages', 'Administration.html'), 'utf8');

assert(OPAGE.indexOf('id="deleteUserModal"') !== -1, 'offline: the warning popup is there');
assert(OPAGE.indexOf('This cannot be undone.') !== -1, 'offline: it says the deletion cannot be undone');
assert(OPAGE.indexOf('openDeleteUser(') !== -1, 'offline: every row offers Delete');
assert(OADMIN.indexOf('openBulkDeleteUsers()') !== -1, 'offline: the bulk bar offers it for a selection');
assert(OPAGE.indexOf('function recordDeletedUser(') !== -1, 'offline: the removal is written down');
assert(OPAGE.indexOf('function dropDeletedAccounts(') !== -1, 'offline: and swept wherever the list is read or saved');

const oMerge = mergeFn(OPAGE);
assert(oMerge.indexOf('isUserDeleted(') !== -1, 'offline: the one account merge checks the tombstone first');
const oPushes = (OPAGE.match(/userAccounts\.push\((cloudUser|cu|ca|fresh)\)/g) || []);
assert(oPushes.length === 1 && oMerge.indexOf('userAccounts.push(fresh)') !== -1,
  'offline: and it is the only place a cloud account is added (found ' + oPushes.length + ')');
assert(OPAGE.indexOf("'voctrain_deletedUserIds',") !== -1,
  'offline: the deletions travel with the accounts in the local backup');

/* The delete flow is lifted from the online build, so a fix to one is a fix to
   both. Compare the part that actually removes accounts. */
function flowBlock(src) {
  const a = src.indexOf('function confirmDeleteUsersVerified(');
  const b = src.indexOf('function bulkExportUsers(', a);
  return a > -1 && b > a ? src.slice(a, b).trim() : null;
}
assertEq(flowBlock(OPAGE), flowBlock(PAGE),
  'both builds delete accounts with the same code — one fix, both builds');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
