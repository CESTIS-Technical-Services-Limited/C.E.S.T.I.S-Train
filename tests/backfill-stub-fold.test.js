/* A trainee who already has an account never gets a second, email-less one.

   What happened (found walking the email sign-in flow in real browsers): an
   administrator's PC is cleared at sign-out — the trainee records go, the
   accounts and the School Fee roll stay. On the next page load, before any
   sync, the dashboard's fee-roll mirror saw Kemar Williams, Rushane Grant and
   Kadian Morgan in the fee roll and nowhere in the (empty) roll, and enrolled
   them again under new ids, with a "Fee System" account for Kemar; the chat
   roster then gave the new Rushane and Kadian records "student-sync" accounts
   of their own. Each person now had a second, password-less, email-less
   "Disabled" account. It went straight into the shared accounts list, Verify
   Users offered to activate it (for Rushane, a registration the office had
   rejected), and although the roll's clean-up later dropped the stubs on that
   PC, it did so with no record — so the accounts list handed them back at the
   next sync, on every device.

   What this pins:
     1  CESTISCore.accountAccess.isBackfillStub — provably nothing but a stub
        (both builds);
     2  accountForTrainee / traineeHasAccount — recognising a trainee's account
        by record link, email, or name in an agreeing programme;
     3  backfillStubFolds — a stub folds only into exactly one real account of
        the same person; anything less certain is left for an administrator;
     4  reviewQueue — Verify Users no longer lists provable duplicates, and
        lists several stubs of one person once;
     5  foldBackfillStubs (the page): the fold removes the stub with a
        tombstone and a note of where it went, real accounts untouched; a
        stale accounts list cannot bring it back; writing the list carries
        the deletion;
     6  rosterAwaitingSync: a device cleared at sign-out waits for the
        Centre's roll before it makes anything from its own;
     7  the fee-roll mirror and the chat roster never enrol / give an account
        to a trainee who already has an account — and still do for somebody
        new;
     8  the fold runs where the roll is settled and where the accounts list is
        read and written; Verify Users marks a possible duplicate.

   Run: node tests/backfill-stub-fold.test.js */
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
const clone = v => JSON.parse(JSON.stringify(v));
function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function store(init) {
  const map = Object.assign({}, init || {});
  return { get length() { return Object.keys(map).length; }, key: i => Object.keys(map)[i],
           getItem: k => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
           setItem: (k, v) => { map[k] = String(v); }, removeItem: k => { delete map[k]; }, _map: map };
}
const quiet = { log() {}, warn() {}, error() {} };

const REAL = 'pbkdf2$210000$0011$2233';
/* The Centre's real accounts, as the office made them. */
const KEMAR = { id: 'USR-KWI', name: 'Kemar Williams', role: 'student', username: 'kwilliams', email: 'Kemar.Williams@Gmail.com', password: REAL,
  status: 'active', programme: 'Welding & Fabrication', registeredVia: 'admin-created', studentDataId: 'STU-11pw7ve8m6u', updatedAt: '2026-10-20T10:00:00.000Z' };
const RUSHANE = { id: 'USR-RGR', name: 'Rushane Grant', role: 'student', username: 'rushane.grant', email: 'rushane.grant@gmail.com', password: REAL,
  status: 'rejected', programme: 'Auto Mechanics', registeredVia: 'registration', studentDataId: 'STU-2bsmi0sffgb', approvedBy: 'admin', approvedAt: '2026-10-02', updatedAt: '2026-10-02T09:00:00.000Z' };
const KADIAN = { id: 'USR-KMO', name: 'Kadian Morgan', role: 'student', username: 'kadian.morgan', email: 'kadian.morgan@gmail.com', password: REAL,
  status: 'disabled', programme: 'Cosmetology', registeredVia: 'registration', studentDataId: 'STU-2cy487nzvsz', disabledBy: 'Marcia Thompson', disabledAt: '2026-10-05T09:00:00.000Z', updatedAt: '2026-10-05T09:00:00.000Z' };
/* The stubs a cleared office PC made of them (exactly as the backfills write them). */
const FEE_KEMAR = { id: 'USR-FEE-1792732502898-401', name: 'Kemar Williams', role: 'student', username: 'kemar.williams', password: '', email: '',
  programme: 'Welding & Fabrication', status: 'disabled', createdAt: '2026-10-22', registeredVia: 'fee-system', studentDataId: 'STU-MVKIMKCN06YG', approvedBy: 'system' };
const CHAT_RUSHANE = { id: 'USR-STU-STU-MVKIMKCN82YE', name: 'Rushane Grant', role: 'student', username: 'rushane.grant2', password: '', email: '',
  programme: 'Auto Mechanics', status: 'disabled', createdAt: '2026-10-22', registeredVia: 'student-sync', studentDataId: 'STU-2bsmi0sffgb', approvedBy: 'system' };
const CHAT_KADIAN = { id: 'USR-STU-STU-MVKIMKCNHOQU', name: 'Kadian Morgan', role: 'student', username: 'kadian.morgan2', password: '', email: '',
  programme: 'Cosmetology', status: 'disabled', createdAt: '2026-10-22', registeredVia: 'student-sync', studentDataId: 'STU-MVKIMKCNHOQU', approvedBy: 'system' };
/* A real placeholder: a fee-roll trainee who has no other account. */
const TAMIKA = { id: 'USR-FEE-1792000000000-12', name: 'Tamika Reid', role: 'student', username: 'tamika.reid', password: '', email: '',
  programme: 'Cosmetology', status: 'disabled', createdAt: '2026-09-02', registeredVia: 'fee-system', studentDataId: 'STU-tamika', approvedBy: 'system' };
const centre = () => clone([KEMAR, RUSHANE, KADIAN, FEE_KEMAR, CHAT_RUSHANE, CHAT_KADIAN, TAMIKA]);

[['cestis-core.js', Core], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], AA = pair[1].accountAccess;

  /* ---------- 1. What a stub is ---------- */
  console.log('\n[' + where + '] A backfill stub is provably nothing but a stub');
  [FEE_KEMAR, CHAT_RUSHANE, CHAT_KADIAN, TAMIKA].forEach(s => assert(AA.isBackfillStub(s), s.id + ' is a stub'));
  [KEMAR, RUSHANE, KADIAN].forEach(a => assert(!AA.isBackfillStub(a), a.id + ' (a real account) is not'));
  const touched = {
    'a password': { password: REAL }, 'a password typed but not yet hashed': { _plaintextPw: 'x' }, 'an email': { email: 'kw@example.com' },
    'activated': { status: 'active' }, 'approved by a person': { approvedBy: 'admin', approvedAt: '2026-10-21' },
    'switched off by a person': { disabledBy: 'Marcia Thompson', disabledAt: '2026-10-21T00:00:00Z' },
    'edited by a person': { updatedAt: '2026-10-21T00:00:00Z' }, 'signed in to': { verifiedAt: '2026-10-21T00:00:00Z' },
    'two-step verification': { twoFactorEnabled: true }, 'a registration': { registeredVia: 'registration' },
    'made by an administrator': { registeredVia: 'admin-created' }, 'an instructor': { role: 'instructor' }
  };
  Object.keys(touched).forEach(k => assert(!AA.isBackfillStub(Object.assign(clone(FEE_KEMAR), touched[k])), 'a stub with ' + k + ' is not provably a stub'));

  /* ---------- 2. Recognising a trainee's account ---------- */
  console.log('[' + where + '] A trainee\'s account is recognised by link, email, or name in an agreeing programme');
  const accts = clone([KEMAR, RUSHANE, KADIAN]);
  let r = AA.accountForTrainee(accts, { name: 'Somebody Else', ids: ['STU-2bsmi0sffgb'] });
  assertEq(r.match && r.match.id + '/' + r.by, 'USR-RGR/link', 'by the record it is linked to');
  r = AA.accountForTrainee(accts, { name: 'K. W.', email: ' kemar.williams@gmail.com ' });
  assertEq(r.match && r.match.id + '/' + r.by, 'USR-KWI/email', 'by email, in any casing');
  r = AA.accountForTrainee(accts, { name: 'kemar   WILLIAMS', programme: 'WELDING L2' });
  assertEq(r.match && r.match.id + '/' + r.by, 'USR-KWI/name', 'by name, in a programme spelled another way');
  assertEq(JSON.stringify(AA.accountForTrainee(accts, { name: 'Kemar Williams', programme: 'Plumbing' })), '{}', 'not by name in another programme');
  assertEq(JSON.stringify(AA.accountForTrainee(accts, { name: 'Tashana Brown', programme: 'Welding & Fabrication' })), '{}', 'nobody: a new person');
  const twins = [{ id: 'A', role: 'student', name: 'John Brown', programme: 'Plumbing', password: REAL, email: 'jb1@x.com' },
                 { id: 'B', role: 'student', name: 'John Brown', programme: 'Plumbing', password: REAL, email: 'jb2@x.com' }];
  assert(AA.accountForTrainee(twins, { name: 'John Brown', programme: 'Plumbing' }).ambiguous, 'two namesakes in one programme: a person decides');
  assert(AA.traineeHasAccount(twins, { name: 'John Brown', programme: 'Plumbing' }), 'and either way the backfill must not make a third');
  assert(!AA.traineeHasAccount(accts, { name: 'Tashana Brown' }), 'a new person has none');

  /* ---------- 3. What folds ---------- */
  console.log('[' + where + '] A stub folds only into exactly one real account of the same person');
  const f = AA.backfillStubFolds(centre());
  const into = {}; f.folds.forEach(x => { into[x.id] = x.into + '/' + x.by; });
  assertEq(into[FEE_KEMAR.id], 'USR-KWI/name', 'Kemar\'s "Fee System" stub folds into his account (same name, same programme)');
  assertEq(into[CHAT_RUSHANE.id], 'USR-RGR/link', 'Rushane\'s stub folds into his rejected registration (the same record)');
  assertEq(into[CHAT_KADIAN.id], 'USR-KMO/name', 'Kadian\'s into her disabled account');
  assert(!into[TAMIKA.id] && f.unsure.indexOf(TAMIKA.id) === -1, 'a placeholder for somebody with no other account stays, untouched');
  assertEq(f.folds.length, 3, 'nothing else folds');
  const amb = AA.backfillStubFolds(twins.concat([Object.assign(clone(TAMIKA), { id: 'S1', name: 'John Brown', programme: 'Plumbing', studentDataId: 'STU-jb' })]));
  assert(!amb.folds.length && amb.unsure[0] === 'S1', 'a stub of a name two real people share is left for an administrator');
  const otherRec = AA.backfillStubFolds(clone([KEMAR, FEE_KEMAR]), [{ id: FEE_KEMAR.studentDataId, name: 'Andre Henry' }]);
  assert(!otherRec.folds.length && otherRec.unsure[0] === FEE_KEMAR.id, 'a stub whose own record here is somebody else\'s is left alone');
  assert(!AA.backfillStubFolds([clone(FEE_KEMAR), Object.assign(clone(CHAT_RUSHANE), { name: 'Kemar Williams', programme: 'Welding & Fabrication', id: 'S2' })]).folds.length,
    'two stubs of one person and no real account: neither is folded into the other');
  const edited = Object.assign(clone(FEE_KEMAR), { updatedAt: '2026-10-21T00:00:00Z' });
  assert(!AA.backfillStubFolds([clone(KEMAR), edited]).folds.length, 'a stub somebody edited is never folded');

  /* ---------- 4. Verify Users ---------- */
  console.log('[' + where + '] Verify Users no longer lists provable duplicates');
  const pend = { id: 'USR-TB', role: 'student', name: 'Tashana Brown', status: 'pending', registeredVia: 'registration', password: REAL, email: 'tashana.brown@gmail.com' };
  const q = AA.reviewQueue(centre().concat([pend])).map(u => u.id).sort().join(',');
  assertEq(q, ['USR-TB', TAMIKA.id].sort().join(','), 'only the pending registration and the real placeholder are listed');
  const twoStubs = [clone(TAMIKA), Object.assign(clone(TAMIKA), { id: 'USR-STU-STU-tamika2', registeredVia: 'student-sync', studentDataId: 'STU-tamika2' })];
  assertEq(AA.reviewQueue(twoStubs).length, 1, 'two stubs of one person (and no real account) are listed once');
});

(async function () {
  /* ---------- 5. The fold on the page ---------- */
  console.log('\nThe page folds the stubs away with a tombstone, and real accounts stay');
  function pageSandbox(accounts, init) {
    const st = store(init);
    const sb = { CESTISCore: Core, CESTISStore: st, console: quiet, userAccounts: clone(accounts), students: [],
      _delUserIdsMemo: null, _delUserIdsAt: 0, ledgerSaves: 0,
      stripSecretFields: (k, v) => (k === '_plaintextPw' ? undefined : v),
      scheduleAccountsLedgerSave() { sb.ledgerSaves++; } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(['foldBackfillStubs', 'recordDeletedUser', '_getDeletedUserIds', 'isUserDeleted', 'dropDeletedAccounts', 'persistUserAccounts', 'mergeCloudAccounts']
      .map(n => extractFunction(SRC, n)).join('\n'), sb);
    return sb;
  }
  const pg = pageSandbox(centre());
  assertEq(vm.runInContext("foldBackfillStubs('test')", pg), 3, 'three stubs folded');
  assertEq(pg.userAccounts.map(u => u.id).sort().join(','), ['USR-KWI', 'USR-RGR', 'USR-KMO', TAMIKA.id].sort().join(','),
    'Kemar, Rushane, Kadian and Tamika\'s placeholder remain — nobody real is touched');
  assertEq(JSON.stringify(pg.userAccounts.find(u => u.id === 'USR-KWI')), JSON.stringify(KEMAR), 'Kemar\'s own account is exactly as it was');
  const dead = JSON.parse(pg.CESTISStore.getItem('voctrain_deletedUserIds') || '[]').sort().join(',');
  assertEq(dead, [FEE_KEMAR.id, CHAT_RUSHANE.id, CHAT_KADIAN.id].sort().join(','), 'each fold leaves the deletion record an administrator\'s delete leaves');
  const note = JSON.parse(pg.CESTISStore.getItem('cestisFoldedAccounts') || '{}');
  assertEq(note[FEE_KEMAR.id] && note[FEE_KEMAR.id].mergedInto, 'USR-KWI', 'and a note of which account it was folded into');
  assertEq(JSON.parse(pg.CESTISStore.getItem('voctrain_users')).length, 4, 'the stored accounts are written without them');
  assertEq(pg.ledgerSaves, 1, 'the accounts list is written again, carrying the deletions');
  assertEq(vm.runInContext("foldBackfillStubs('again')", pg), 0, 'a second pass finds nothing to fold');
  // A stale device's accounts list still holds the stubs.
  vm.runInContext('mergeCloudAccounts(stale)', Object.assign(pg, { stale: centre() }));
  assert(!pg.userAccounts.some(u => /^USR-(FEE|STU)-.*MVK|USR-FEE-1792732502898/.test(u.id)), 'an older accounts list cannot bring them back');

  /* writing the accounts list from a device whose list still holds them */
  console.log('Writing the accounts list carries the fold');
  {
    const sent = [];
    const ledger = { accounts: centre(), deletedUserIds: [] };
    const sb = { CESTISStore: store({}), CESTISCore: Core, console: quiet, isCloudConnected: true, googleAccessToken: 'tok',
      _accountsLedgerSaving: false, _sessionWiped: false, _accountsLedgerFileId: 'LEDGER', ACCOUNTS_LEDGER_FILE: 'CESTIS_ACCOUNTS.json',
      GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F' }, currentLoggedInUser: null, _delUserIdsMemo: null, _delUserIdsAt: 0, students: [],
      userAccounts: clone([KEMAR, RUSHANE, KADIAN, TAMIKA]),
      stripSecretFields: (k, v) => (k === '_plaintextPw' ? undefined : v), handleCloudAuthExpired() {}, scheduleAccountsLedgerSave() { throw new Error('the writer must not schedule itself'); },
      fetch: async function (url, opts) {
        if (!opts || !opts.method) return { ok: true, json: async () => clone(ledger) };
        sent.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({}) };
      } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(['ledgerHeaders', 'findAccountsLedgerFile', 'foldBackfillStubs', '_getDeletedUserIds', 'isUserDeleted', 'recordDeletedUser', 'dropDeletedAccounts',
      'mergeCloudAccounts', 'persistUserAccounts', 'saveAccountsLedger'].map(n => extractFunction(SRC, n)).join('\n'), sb);
    assertEq(await vm.runInContext('saveAccountsLedger()', sb), true, 'the list is written');
    const body = sent[0] || { accounts: [], deletedUserIds: [] };
    assertEq(body.accounts.map(a => a.id).sort().join(','), ['USR-KWI', 'USR-RGR', 'USR-KMO', TAMIKA.id].sort().join(','), 'without the stubs it held');
    assert([FEE_KEMAR.id, CHAT_RUSHANE.id, CHAT_KADIAN.id].every(id => body.deletedUserIds.indexOf(id) !== -1), 'and with their deletion records, for every other device');
  }

  /* ---------- 6. A device cleared at sign-out waits ---------- */
  console.log('A device cleared at sign-out waits for the Centre\'s roll before it makes anything');
  function rosterSandbox(accounts, students, extra) {
    const sb = Object.assign({ CESTISCore: Core, console: quiet, userAccounts: clone(accounts), students: clone(students), _rosterReadThisSession: false }, extra || {});
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'rosterAwaitingSync'), sb);
    return sb;
  }
  const real3 = [KEMAR, RUSHANE, KADIAN];
  assert(vm.runInContext('rosterAwaitingSync()', rosterSandbox(real3, [])), 'accounts pointing at records this device does not hold: wait');
  assert(!vm.runInContext('rosterAwaitingSync()', rosterSandbox(real3, [], { _rosterReadThisSession: true })), 'once the Centre\'s roll has been read this session: go');
  assert(!vm.runInContext('rosterAwaitingSync()', rosterSandbox(real3, real3.map(a => ({ id: a.studentDataId, name: a.name })))), 'a device holding the roll: go');
  assert(!vm.runInContext('rosterAwaitingSync()', rosterSandbox(real3, [], { isStudentDeleted: () => true })), 'records deleted on purpose do not count as missing');
  assert(!vm.runInContext('rosterAwaitingSync()', rosterSandbox(real3, [], { CESTISPageCloud: { lanSynced: () => true } })), 'on the Centre\'s network, once it has answered: go');
  assert(!vm.runInContext('rosterAwaitingSync()', rosterSandbox([Object.assign(clone(KEMAR), { status: 'pending' })], [])), 'a registration awaiting approval has no record to wait for');

  /* ---------- 7. The backfills ---------- */
  console.log('The fee-roll mirror never re-enrols a trainee who has an account, and still enrols somebody new');
  const CENTRES = [{ id: 1, name: 'Welding & Fabrication', startDate: '2026-01-05', endDate: '2026-12-18' },
                   { id: 2, name: 'Auto Mechanics', startDate: '2026-01-05', endDate: '2026-12-18' },
                   { id: 3, name: 'Cosmetology', startDate: '2026-01-05', endDate: '2026-12-18' },
                   { id: 4, name: 'Plumbing', startDate: '2026-01-05', endDate: '2026-12-18' }];
  Core.enrolment.assignCentreKeys(CENTRES);
  function dashboard(accounts, students, feeRoll, extra) {
    const st = store({ cestiSchoolFeeStudents: JSON.stringify(feeRoll) });
    const sb = Object.assign({
      CESTISCore: Core, CESTISStore: st, console: quiet, Date, Math, JSON, Object, Array, String, Number, RegExp, Set, Map,
      skillAreas: clone(CENTRES), students: clone(students), userAccounts: clone(accounts),
      instructorData: [], attendanceRecords: [], studentProfiles: {}, _delStudentAtMemo: null,
      _feeMirrorLastRaw: null, _feeMirrorCheckedAt: 0, FEE_MIRROR_MIN_INTERVAL_MS: 1000, _rosterReadThisSession: false,
      saveState() {}, updateSkillAreaCounts() {}, broadcastStudentsToFeeFrames() {}, saveUserAccounts() {},
      localDateStr: () => '2026-10-22'
    }, extra || {});
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(['cestisGenId', 'findSkillAreaForCourse', 'instructorCourseMatch', 'syncStudentsFromLocalFeeSystem', 'rosterAwaitingSync',
      'traineeRecordExistsElsewhere', 'lmsChatEnsureStudentAccounts'].map(n => extractFunction(SRC, n)).join('\n\n'), sb);
    return sb;
  }
  // The fee roll as the office's dashboard wrote it: each trainee linked to their record.
  const feeRoll = real3.map(a => ({ id: a.studentDataId, lmsId: a.studentDataId, name: a.name, skillArea: a.programme, enrollmentDate: '2026-01-05' }));
  let pc = dashboard(real3, [], feeRoll);
  vm.runInContext('syncStudentsFromLocalFeeSystem(true)', pc);
  assertEq(pc.students.length + '/' + pc.userAccounts.length, '0/3', 'the cleared office PC enrols nobody from the fee roll before it has read the roll');
  pc = dashboard(real3, [], feeRoll.map(f => Object.assign({}, f, { id: 'SF-' + f.id, lmsId: '' })), { _rosterReadThisSession: true });
  vm.runInContext('syncStudentsFromLocalFeeSystem(true)', pc);
  assertEq(pc.students.length + '/' + pc.userAccounts.length, '0/3',
    'after a sync, a fee record that has lost its link still finds the trainee\'s account by name and makes nothing');
  const newcomers = [{ id: 'SF-9001', name: 'Shanique Campbell', skillArea: 'Plumbing', enrollmentDate: '2026-01-05' },
                     { id: 'SF-9002', name: 'Jhanelle Spence', skillArea: 'Plumbing', enrollmentDate: '2026-01-05' }];
  const jhanelle = { id: 'USR-JS', role: 'student', name: 'Jhanelle Spence', email: 'jhanelle.spence@gmail.com', username: 'jhanelle.spence', password: REAL,
    status: 'pending', programme: 'Plumbing', registeredVia: 'registration' };
  pc = dashboard(real3.concat([jhanelle]), real3.map(a => ({ id: a.studentDataId, name: a.name, course: a.programme })), feeRoll.concat(newcomers));
  vm.runInContext('syncStudentsFromLocalFeeSystem(true)', pc);
  const names = pc.students.map(s => s.name).sort().join(',');
  assertEq(names, 'Jhanelle Spence,Kadian Morgan,Kemar Williams,Rushane Grant,Shanique Campbell', 'somebody new is still enrolled from the fee roll — and a registrant awaiting approval gets her record');
  assertEq(pc.userAccounts.filter(u => u.name === 'Shanique Campbell').length, 1, 'the newcomer gets her placeholder account, as before');
  assertEq(pc.userAccounts.filter(u => u.name === 'Jhanelle Spence').length, 1, 'the registrant keeps her one account — no "Fee System" second');

  console.log('The chat roster never gives a second account to a trainee who has one');
  const strayRec = { id: 'STU-MVKIMKCN82YE', name: 'Rushane Grant', course: 'Auto Mechanics' };
  pc = dashboard(real3, [strayRec], []);
  assertEq(vm.runInContext('lmsChatEnsureStudentAccounts()', pc), false, 'on a cleared device it waits');
  pc = dashboard(real3, [strayRec], [], { _rosterReadThisSession: true });
  vm.runInContext('lmsChatEnsureStudentAccounts()', pc);
  assertEq(pc.userAccounts.filter(u => u.name === 'Rushane Grant').length, 1, 'a record of somebody who has an account gets no stub');
  pc = dashboard(real3, [{ id: 'STU-dc', name: 'Devon Clarke', course: 'Plumbing' }], [], { _rosterReadThisSession: true });
  vm.runInContext('lmsChatEnsureStudentAccounts()', pc);
  const dc = pc.userAccounts.filter(u => u.name === 'Devon Clarke');
  assertEq(dc.length + ':' + (dc[0] && dc[0].registeredVia), '1:student-sync', 'a record of somebody with no account still gets one, as before');

  /* ---------- 8. Where the fold runs ---------- */
  console.log('The fold runs where the roll is settled and the accounts list is read and written');
  const settle = extractFunction(SRC, 'cestisSettleRoster');
  assert(settle.indexOf('foldBackfillStubs(') !== -1 && settle.indexOf('foldBackfillStubs(') < settle.indexOf('cestisStabilizeStudentIds()'),
    'the roll\'s settle folds first, before its own clean-up could drop them unrecorded');
  const led = extractFunction(SRC, 'loadAccountsLedger');
  assert(led.indexOf('foldBackfillStubs(') > led.indexOf('mergeCloudAccounts('), 'reading the accounts list folds what it brought');
  const sav = extractFunction(SRC, 'saveAccountsLedger');
  assert(/foldBackfillStubs\('writing the accounts list', \{ noLedgerSave: true \}\)/.test(sav) && sav.indexOf('foldBackfillStubs(') < sav.indexOf('JSON.stringify({'),
    'writing the accounts list folds before it writes');
  const mb = extractFunction(SRC, 'mergeBackupData'), cf = extractFunction(SRC, 'cloudFetchAccountData');
  assert(/_rosterReadThisSession = true/.test(mb) && /_rosterReadThisSession = true/.test(cf), 'reading a backup, or the quick account check, ends the wait');
  const fee2 = extractFunction(SRC, 'syncStudentsFromFeeSystem');
  assert(/traineeRecordExistsElsewhere\(/.test(fee2) && /traineeHasAccount\(/.test(fee2), 'the fee backup mirror recognises the trainee too');
  const vu = extractFunction(SRC, 'renderVerifyUsersPage');
  assert(/backfillStubFolds\(userAccounts, students\)\.unsure/.test(vu) && /may be a second account/.test(vu), 'Verify Users marks a placeholder that may be a second account');

  /* ---------- the Offline System carries the same page code ---------- */
  const OFF = fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8');
  ['foldBackfillStubs', 'rosterAwaitingSync', 'traineeRecordExistsElsewhere', 'syncStudentsFromLocalFeeSystem', 'lmsChatEnsureStudentAccounts', 'cestisSettleRoster'].forEach(function (fn) {
    assertEq(extractFunction(OFF, fn), extractFunction(SRC, fn), 'the Offline System\'s ' + fn + '() is the main build\'s');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
