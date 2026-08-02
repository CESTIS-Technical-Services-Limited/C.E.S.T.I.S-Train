/* Unit tests for CESTISCore.accountAccess — who may sign in, and why not.

   The Centre's rule is that a trainee is kept out only when an administrator has
   kept them out. These tests pin both halves of it:
     - an account an administrator has NOT blocked must be able to sign in, no
       matter how the trainee types their username or how a sync has shuffled
       duplicate records;
     - an account an administrator HAS blocked (disabled, or a registration that
       was refused) must never get through.

   Run: node tests/account-access.test.js */
'use strict';

const Core = require('../cestis-core.js');
const AA = Core.accountAccess;

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const PW = 'pbkdf2$310000$abcd$ef01';
const trainee = function (over) {
  return Object.assign({ id: 'USR-1', name: 'John Smith', role: 'student',
    username: 'john.smith', email: 'john.smith@gmail.com', password: PW, status: 'active' }, over || {});
};

/* ---------- 1. An active trainee gets in ---------- */
console.log('An activated account can sign in');
assertEq(AA.check(trainee()).allowed, true, 'active account with a password is allowed');
assertEq(AA.check(trainee()).reason, 'ok', 'and the reason says so');
assertEq(AA.check(trainee({ status: 'ACTIVE' })).allowed, true, 'status casing does not matter');
assertEq(AA.check(trainee({ status: '' })).allowed, true, 'a blank status is not a block');
assertEq(AA.check(trainee({ status: undefined })).allowed, true, 'a missing status is not a block');

/* ---------- 2. Only an administrator's decision keeps them out ---------- */
console.log('Only an administrator keeps a trainee out');
assertEq(AA.check(trainee({ status: 'disabled' })).reason, 'disabled', 'a disabled account is blocked');
assertEq(AA.check(trainee({ status: 'pending' })).reason, 'pending', 'an unreviewed account is blocked');
assertEq(AA.check(null).reason, 'not-found', 'no account at all');

/* A registration the administrator REFUSED must not sign in. Every login
   handler used to test only 'disabled' and 'pending', so a rejected account
   sailed through the status checks and logged in with full access. */
const rejected = AA.check(trainee({ status: 'rejected' }));
assertEq(rejected.allowed, false, 'a rejected registration cannot sign in');
assertEq(rejected.reason, 'rejected', 'and is named as rejected, not as a bad password');
assertEq(AA.check(trainee({ status: 'Rejected' })).allowed, false, 'rejection is case-insensitive too');

/* Being blocked must never be silent — the person needs to know who to ask. */
['disabled', 'pending', 'rejected', 'no-password'].forEach(function (r) {
  const acct = r === 'no-password' ? trainee({ password: '' }) : trainee({ status: r });
  const res = AA.check(acct);
  assertEq(res.reason, r, r + ' is reported');
  assert(res.message && res.message.length > 20, r + ' explains itself to the reader');
});

/* ---------- 3. An account with no password is unusable, and says so ---------- */
console.log('An account with no password cannot sign in');
/* The fee sync and the chat backfill create trainee accounts with password:''.
   verifyPassword() falls through to a plaintext compare for anything that is
   not a hash, so '' only matches an empty submission — which the login forms
   reject. Such an account is active on screen and impossible to sign into. */
assertEq(AA.hasPassword(trainee()), true, 'a hashed password counts');
assertEq(AA.hasPassword(trainee({ password: '' })), false, 'an empty password does not');
assertEq(AA.hasPassword(trainee({ password: undefined })), false, 'a missing password does not');
assertEq(AA.hasPassword(null), false, 'null-safe');
const noPw = AA.check(trainee({ password: '' }));
assertEq(noPw.allowed, false, 'an account with no password is stopped');
assertEq(noPw.reason, 'no-password', 'and the reason is the missing password, not the status');
assertEq(noPw.adminFix, true, 'an administrator has to set one');
assert(/administrator/i.test(noPw.message), 'the message points at the administrator');

/* Order matters: a DISABLED account with no password reads as disabled — the
   administrator's decision is the headline, not the missing password. */
assertEq(AA.check(trainee({ status: 'disabled', password: '' })).reason, 'disabled',
  'the administrator\'s decision is reported ahead of the missing password');

/* ---------- 4. Letter case never locks a trainee out ---------- */
console.log('Letter case never locks a trainee out');
/* Registration stores the address exactly as typed and derives the username
   from it, so an account can carry capitals the trainee does not reproduce at
   the sign-in box. Comparing with === turned that into "invalid username or
   password" on an account nobody had disabled. */
const mixed = trainee({ username: 'John.Smith', email: 'John.Smith@Gmail.com' });
assertEq(AA.idMatches(mixed, 'john.smith'), true, 'lower-case username resolves');
assertEq(AA.idMatches(mixed, 'JOHN.SMITH'), true, 'upper-case username resolves');
assertEq(AA.idMatches(mixed, 'john.smith@gmail.com'), true, 'lower-case email resolves');
assertEq(AA.idMatches(mixed, '  john.smith@gmail.com  '), true, 'stray whitespace tolerated');
assertEq(AA.idMatches(mixed, 'John.Smith@Gmail.com'), true, 'the exact original still resolves');
assertEq(AA.idMatches(mixed, 'jane.doe'), false, 'a different person does not resolve');
assertEq(AA.idMatches(mixed, ''), false, 'a blank identifier matches nobody');
assertEq(AA.idMatches(mixed, null), false, 'null-safe');
/* An account with no email must not be matched by an empty identifier. */
assertEq(AA.idMatches({ username: 'x', email: '' }, ''), false, 'blank never matches a blank field');

/* ---------- 5. Finding the right record ---------- */
console.log('Finding the right account');
const accounts = [
  trainee({ id: 'USR-A', role: 'student', username: 'John.Smith', email: 'John.Smith@Gmail.com' }),
  { id: 'USR-B', role: 'instructor', name: 'John Smith', username: 'john.smith', email: 'tutor@cestis.com', password: PW, status: 'active' }
];
assertEq(AA.find(accounts, 'student', 'john.smith').id, 'USR-A', 'role is respected');
assertEq(AA.find(accounts, 'instructor', 'john.smith').id, 'USR-B', 'the instructor record for the same username');
assertEq(AA.find(accounts, 'STUDENT', 'john.smith').id, 'USR-A', 'role casing does not matter');
assertEq(AA.find(accounts, 'student', 'nobody@nowhere.com'), null, 'an unknown identifier finds nothing');
assertEq(AA.find(null, 'student', 'john.smith'), null, 'null-safe');
assertEq(AA.find([], 'student', 'john.smith'), null, 'empty list is safe');

/* A sync can leave two records for one trainee: the real one they registered
   with, and a thin placeholder created by the fee sync. Whichever comes first
   in the array, the one that can actually sign in must win — otherwise the
   placeholder shadows the real account and the trainee is locked out. */
console.log('A placeholder never shadows the real account');
const placeholder = { id: 'USR-FEE-1', role: 'student', name: 'John Smith', username: 'john.smith', email: '', password: '', status: 'disabled' };
const real = trainee({ id: 'USR-REAL' });
assertEq(AA.find([placeholder, real], 'student', 'john.smith').id, 'USR-REAL', 'placeholder first — real account still wins');
assertEq(AA.find([real, placeholder], 'student', 'john.smith').id, 'USR-REAL', 'real account first — order makes no difference');

/* Password recovery does not know which role the account was filed under. */
console.log('Cross-role lookup for password recovery');
assertEq(AA.findAnyRole(accounts, 'tutor@cestis.com').id, 'USR-B', 'finds an account in any role');
assertEq(AA.findAnyRole(accounts, 'JOHN.SMITH@GMAIL.COM').id, 'USR-A', 'case-insensitive across roles');
assertEq(AA.findAnyRole(accounts, 'missing'), null, 'unknown identifier finds nothing');
assertEq(AA.findAnyRole(null, 'x'), null, 'null-safe');

/* ---------- 6. What the administrator is shown ---------- */
console.log('The accounts table tells the truth');
/* One on/off toggle could not tell "never reviewed" from "refused" from
   "switched off", and an active account with no password looked fully enabled
   while nobody could sign into it. */
assertEq(AA.adminLabel(trainee()).label, 'Active', 'a usable account reads Active');
assertEq(AA.adminLabel(trainee({ status: 'disabled' })).label, 'Disabled', 'switched off reads Disabled');
assertEq(AA.adminLabel(trainee({ status: 'pending' })).label, 'Pending', 'never reviewed reads Pending');
assertEq(AA.adminLabel(trainee({ status: 'rejected' })).label, 'Rejected', 'refused reads Rejected');
assertEq(AA.adminLabel(trainee({ password: '' })).label, 'No password', 'an unusable account is not shown as Active');
assert(AA.adminLabel(trainee({ password: '' })).detail.length > 0, 'and explains what is missing');
assertEq(AA.adminLabel(trainee()).tone, 'good', 'a usable account reads as good');
assertEq(AA.adminLabel(trainee({ password: '' })).tone, 'warn', 'a password-less account warns');

/* ---------- 7. The whole lifecycle, end to end ---------- */
console.log('Account lifecycle, creation to completion');
/* A trainee enrolled by an administrator: a record is created disabled, then
   activated in Verify Users. From that moment they must be able to sign in,
   and must stay able to until an administrator says otherwise. */
const enrolled = { id: 'USR-NEW', role: 'student', name: 'Ann Brown', username: 'ann.brown',
  email: '', password: '', status: 'disabled' };
assertEq(AA.check(enrolled).reason, 'disabled', 'starts out disabled, as created');
enrolled.status = 'active';
assertEq(AA.check(enrolled).reason, 'no-password', 'activating alone does not grant access — no password was set');
enrolled.password = PW;
assertEq(AA.check(enrolled).allowed, true, 'once a password is set the trainee can sign in');
/* Nothing about the training itself may take that access away. */
assertEq(AA.check(Object.assign({}, enrolled, { programme: 'Welding' })).allowed, true, 'programme does not gate access');
enrolled.status = 'disabled';
assertEq(AA.check(enrolled).allowed, false, 'and only an administrator takes it away again');
enrolled.status = 'active';
assertEq(AA.check(enrolled).allowed, true, 're-enabling restores access');

/* ---------- 8. Staff, board and administrator accounts ---------- */
console.log('Every role is judged by the same rule');
/* The five login handlers each tested status inline and disagreed; the admin
   handler never tested 'pending' at all. One gate now serves all of them, so a
   rule fixed for trainees is fixed for instructors, admin staff and the board. */
['admin', 'adminstaff', 'instructor', 'cmc', 'student'].forEach(function (role) {
  assertEq(AA.check(trainee({ role: role })).allowed, true, role + ' signs in when nothing blocks them');
  assertEq(AA.check(trainee({ role: role, status: 'pending' })).reason, 'pending', role + ' awaiting approval is stopped');
  assertEq(AA.check(trainee({ role: role, status: 'rejected' })).reason, 'rejected', role + ' refused is stopped');
  assertEq(AA.check(trainee({ role: role, status: 'disabled' })).reason, 'disabled', role + ' disabled is stopped');
  assertEq(AA.check(trainee({ role: role, password: '' })).reason, 'no-password', role + ' with no password cannot sign in');
});

console.log('The Centre cannot lock itself out of administration');
const admin = function (over) { return Object.assign({ id: 'A1', role: 'admin', name: 'Admin One', username: 'admin.one', password: PW, status: 'active' }, over || {}); };
const staff = { id: 'S1', role: 'adminstaff', name: 'Staff One', username: 'staff.one', password: PW, status: 'active' };

assertEq(AA.usableAdmins([admin(), staff]).length, 1, 'one usable administrator');
assertEq(AA.usableAdmins([admin(), admin({ id: 'A2', username: 'admin.two' })]).length, 2, 'two usable administrators');
assertEq(AA.usableAdmins([admin({ status: 'disabled' })]).length, 0, 'a disabled admin is not usable');
assertEq(AA.usableAdmins([admin({ password: '' })]).length, 0, 'an admin with no password is not usable');
assertEq(AA.usableAdmins([admin({ status: 'pending' })]).length, 0, 'an unapproved admin is not usable');
assertEq(AA.usableAdmins(null).length, 0, 'null-safe');
assertEq(AA.usableAdmins([staff]).length, 0, 'admin staff do not count as administrators');

/* Bulk Deactivate had no guard: selecting every row switched off every
   administrator and the platform could only be recovered through the seeded
   login. */
const twoAdmins = [admin(), admin({ id: 'A2', username: 'admin.two' }), staff];
assertEq(AA.wouldStrandAdmins(twoAdmins, ['A1']).length, 0, 'disabling one of two administrators is fine');
assertEq(AA.wouldStrandAdmins(twoAdmins, ['A1', 'A2']).length, 2, 'disabling both is refused');
assertEq(AA.wouldStrandAdmins(twoAdmins, ['S1']).length, 0, 'disabling admin staff never strands the platform');
assertEq(AA.wouldStrandAdmins([admin()], 'A1').length, 1, 'the only administrator cannot switch themselves off');
assertEq(AA.wouldStrandAdmins([admin()], ['A2']).length, 0, 'disabling an unrelated account is fine');

/* Recovery replaces the old unconditional rewrite, which re-activated the
   seeded admin on every page load — so deliberately disabling it never stuck,
   and the seeded admin-staff and board usernames were reverted underneath
   whoever had been renamed to them. */
console.log('Recovery steps in only when there is no way back in');
assertEq(AA.needsRecoveryAdmin([admin(), staff]), false, 'a working administrator needs no recovery');
assertEq(AA.needsRecoveryAdmin([admin({ status: 'disabled' }), staff]), true, 'every administrator disabled — recovery is needed');
assertEq(AA.needsRecoveryAdmin([admin({ password: '' })]), true, 'administrator with no password — recovery is needed');
assertEq(AA.needsRecoveryAdmin([staff]), true, 'admin staff alone cannot administer the platform');
assertEq(AA.needsRecoveryAdmin([]), true, 'no accounts at all');
/* A renamed shared login stays renamed, because it is still a usable admin. */
assertEq(AA.needsRecoveryAdmin([admin({ id: 'USR-001', username: 'principal.brown' })]), false,
  'renaming the built-in administrator does not trigger a rewrite');

/* ---------- summary ---------- */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
