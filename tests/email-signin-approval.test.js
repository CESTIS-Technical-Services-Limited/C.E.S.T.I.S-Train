/* Signing in with one's own email account, and the administrator's approval.

   The owner asked: "check the flow when persons connect using their Gmail —
   does it work, and when the administrator approves the account?" Walked end
   to end in real browsers (tests/browser/email-signin-flow.js), it did not:

     - a trainee who registered on a lab PC stayed "awaiting approval" on that
       PC after the office approved her — by the email button and by her
       password alike — until somebody pressed Sync Now. A device that holds
       accounts never syncs before a sign-in, and every refusal was answered
       from its own, older copy. A re-approved (once rejected) trainee was
       turned away the same way, and an account the office created since the
       PC last synced was offered a second registration;
     - an approval reached the accounts list every device reads first only on
       the next timed save, and a device writing that list from an older copy
       put "pending" back and dropped accounts created since;
     - the quick account check brought an approved instructor's account to the
       lab PC but not the record the approval made, so the PC made a second
       one of its own — and because a shared PC is wiped at every staff
       sign-out, every later sign-in there made yet another (three sign-ins,
       three "Devon Clarke" records in the Centre's copy);
     - "Register" opened a sign-in window for the Centre's own account, which
       a trainee does not have: she chose her own, it was kept on the shared
       PC as if it were the Centre's, and the registration still went nowhere;
     - the pending screen promised "the administrators will review your
       account" even when the registration had never left the device;
     - Sync Now said "Sync complete! You may now log in." when the person had
       signed in with their own account, which cannot open any of the Centre's
       records: nothing was read, and that account was kept as the Centre's;
     - on the Centre's own network (no internet) the email button could only
       answer "check the connection and reload".

   What this pins (root index.html and cestis-core.js; the Offline copies are
   generated from them, tests/offline-build.test.js):
     1  CESTISCore.accountAccess.recheckBeforeRefusal — when a refusal is
        checked against the shared copy first (both builds);
     2  approvalNotice / loginSyncOutcome and their wording — honest, and
        naming no place (both builds);
     3  recheckAccountBeforeRefusal + refreshAccountsQuietly, the real page
        code: never a pop-up, the newer decision wins, offline falls back to
        this device's answer, the Centre's network is asked on the Centre's
        network;
     4  loginBlocked says which it is (checked / could not check) and sends a
        registration that never left the device once it can;
     5  every sign-in route asks before refusing;
     6  "Register" never opens a sign-in window; the pending screen follows
        what really happened to the registration;
     7  approve / reject (one and all) write the accounts list at once;
     7b the approval wins on every path a copy travels — the accounts list and
        the backups (mergeCloudAccounts), the Centre's network (record merge),
        the master backup (add-only) — and a stale "pending" never undoes it;
     8  the accounts-list write merges what the list holds first: an approval
        made elsewhere stands, an account created elsewhere stays;
     9  the quick account check brings the instructors' records too, and an
        instructor's sign-in asks for their record before making one (made
        under the account's own id, so two devices make the same one);
     10 Sync Now's folder check, and its "nothing was read" outcome;
     11 the email button is taken away where its sign-in cannot load.

   Run: node tests/email-signin-approval.test.js */
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
// The words the owner's rule forbids on screen (tools/scan-ui-wording.js
// checks every page; these strings are built in cestis-core.js).
const PLACE = /\b(clouds?|google|drive|gmail|github|servers?|internet|LAN|wi-?fi|broker|mega\s*data|indexed\s*db|local\s*storage)\b|☁|network/i;
const REAL = 'pbkdf2$210000$0011$2233';

(async function () {
  [['cestis-core.js', Core], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
    const where = pair[0], AA = pair[1].accountAccess;

    /* ---------- 1. When a refusal is checked first ---------- */
    console.log('\n[' + where + '] A refusal is checked against the shared copy before it is given');
    const active = { id: 'U1', role: 'student', status: 'active', password: REAL };
    assertEq(AA.recheckBeforeRefusal(active), false, 'an account that may sign in is not checked (no delay for anybody let in)');
    ['pending', 'rejected', 'disabled'].forEach(function (st) {
      assertEq(AA.recheckBeforeRefusal({ id: 'U2', role: 'student', status: st, password: REAL }), true, 'a "' + st + '" copy is checked before the person is turned away');
    });
    const noPw = { id: 'U3', role: 'student', status: 'active' };
    assertEq(AA.recheckBeforeRefusal(noPw), true, 'an account with no password yet is checked on the password route');
    assertEq(AA.recheckBeforeRefusal(noPw, { allowNoPassword: true }), false, 'but not on the email route, which needs no password');
    assertEq(AA.recheckBeforeRefusal(null), false, 'an unknown name on the password route is left to the existing lookup');
    assertEq(AA.recheckBeforeRefusal(null, { ifMissing: true }), true, 'an unknown address on the email route is checked (an account the office created since)');

    /* ---------- 2. What the screens say ---------- */
    console.log('[' + where + '] The pending screen and Sync Now say what really happened, and name no place');
    ['sending', 'sent', 'not-sent', 'checking', 'waiting', 'unchecked'].forEach(function (k) {
      const n = AA.approvalNotice(k);
      assertEq(n.state, k, 'the "' + k + '" notice exists');
      assert(n.title && n.message && /^(info|good|warn)$/.test(n.tone), 'it has a title, a message and a tone');
      assert(!PLACE.test(n.title + ' ' + n.message), 'the "' + k + '" notice names no place — "' + n.message + '"');
    });
    assertEq(AA.approvalNotice('nonsense').state, 'waiting', 'an unknown state falls back to plain "awaiting approval"');
    assertEq(AA.approvalNotice().state, 'waiting', 'and so does none');
    assert(/has reached the office/.test(AA.approvalNotice('sent').message), '"sent" says the registration reached the office');
    assert(/not reached the office/.test(AA.approvalNotice('not-sent').message) && !/will review/.test(AA.approvalNotice('not-sent').message),
      '"not-sent" says it has NOT reached the office, and promises no review');
    assert(/could not check/.test(AA.approvalNotice('unchecked').message), '"unchecked" says this device could not check just now');
    assert(!PLACE.test(AA.UNCHECKED_REFUSAL_NOTE), 'the could-not-check note names no place');
    assert(!PLACE.test(AA.NO_ACCESS_SYNC_MESSAGE), 'the "this sign-in cannot open the Centre’s records" message names no place');
    assert(/Could not sync/.test(AA.NO_ACCESS_SYNC_MESSAGE) && !/complete/i.test(AA.NO_ACCESS_SYNC_MESSAGE), 'and says the sync did not happen');

    assertEq(AA.loginSyncOutcome({ ledgerRead: true }), 'ok', 'the accounts list was read: ok');
    assertEq(AA.loginSyncOutcome({ copiesFound: 2, folderAccess: 'unknown' }), 'ok', 'a backup copy was read: ok');
    assertEq(AA.loginSyncOutcome({ folderAccess: 'yes' }), 'ok', 'nothing to read but the Centre\'s folder answers (a brand-new Centre): ok');
    assertEq(AA.loginSyncOutcome({ folderAccess: 'no' }), 'no-access', 'nothing read and the folder says "not found" (somebody\'s own account): no-access');
    assertEq(AA.loginSyncOutcome({ folderAccess: 'expired' }), 'expired', 'the sign-in was refused as expired: expired');
    assertEq(AA.loginSyncOutcome({}), 'failed', 'no answer at all: failed — never "complete"');
    assertEq(AA.loginSyncOutcome(), 'failed', 'and nothing given: failed');
  });

  /* ---------- 3. The page's quiet check ---------- */
  console.log('\nThe page asks the shared copy quietly — never a pop-up — and the newer decision wins');
  function recheckSandbox(opts) {
    opts = opts || {};
    const calls = { fetch: [], lanLoad: 0, dropped: 0 };
    const sb = {
      CESTISCore: Core, console: console, Date: Date,
      userAccounts: opts.accounts || [],
      window: opts.lan ? { CESTISPageCloud: null } : {},
      _cloudAcctFetchPromise: null, _cloudAcctFetchLastAt: opts.lastAt || 0, _cloudAcctFetchLastOk: !!opts.lastOk,
      cloudFetchAccountData: async function (interactive) {
        calls.fetch.push(interactive);
        if (opts.fetchThrows) throw new Error('offline');
        if (opts.onFetch) opts.onFetch(sb);
        return !!opts.fetchOk;
      },
      dropDeletedAccounts: function () { calls.dropped++; if (opts.onDrop) opts.onDrop(sb); }
    };
    if (opts.lan) {
      sb.window.CESTISPageCloud = sb.CESTISPageCloud = {
        lan: async function () { return true; },
        loadNow: async function () { calls.lanLoad++; if (opts.onFetch) opts.onFetch(sb); return []; },
        lanSynced: function () { return !!opts.lanOk; }
      };
    }
    vm.createContext(sb);
    vm.runInContext('var _cloudAcctFetchLastOk = ' + (!!opts.lastOk) + ';\n' +
      extractFunction(SRC, 'refreshAccountsQuietly').replace(/^var _cloudAcctFetchLastOk[^\n]*\n/m, '') + '\n' +
      extractFunction(SRC, 'recheckAccountBeforeRefusal'), sb);
    return { sb, calls };
  }
  const stale = () => ({ id: 'USR-TB', role: 'student', email: 'tashana.brown@gmail.com', username: 'tashana.brown', status: 'pending', password: REAL, registeredVia: 'registration' });
  const approve = function (sb) { sb.userAccounts.forEach(function (u) { if (u.id === 'USR-TB') { u.status = 'active'; u.updatedAt = '2026-10-20T15:00:00.000Z'; } }); };
  const find = 'function(){ return CESTISCore.accountAccess.findAnyRole(userAccounts, "Tashana.Brown@gmail.com"); }';

  let t = recheckSandbox({ accounts: [stale()], fetchOk: true, onFetch: approve });
  let r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(r.checked, true, 'a pending copy is checked once against the shared copy');
  assertEq(r.account && r.account.status, 'active', 'and the approval given in the office lets her in');
  assertEq(JSON.stringify(t.calls.fetch), '[false]', 'the check never opens a sign-in window (interactive = false)');
  assertEq(t.calls.dropped, 1, 'an account the office deleted is dropped before she is looked up again');

  t = recheckSandbox({ accounts: [stale()], fetchOk: false });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(r.checked, false, 'offline (or with no usable sign-in) the device could not check');
  assertEq(r.account && r.account.status, 'pending', 'and its own answer stands');

  t = recheckSandbox({ accounts: [stale()], fetchThrows: true });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(r.checked, false, 'a check that fails outright is "could not check", not an error');

  t = recheckSandbox({ accounts: [Object.assign(stale(), { status: 'active' })], fetchOk: true });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(r.checked, null, 'an account that may sign in is not checked at all');
  assertEq(t.calls.fetch.length, 0, 'so nobody let in waits for a check');

  t = recheckSandbox({ accounts: [], fetchOk: true, onFetch: function (sb) { sb.userAccounts.push(Object.assign(stale(), { status: 'active', registeredVia: 'admin-created' })); } });
  r = await vm.runInContext('recheckAccountBeforeRefusal(null, ' + find + ', { ifMissing: true })', t.sb);
  assertEq(r.account && r.account.id, 'USR-TB', 'the email route finds an account the office created since this device last synced');

  t = recheckSandbox({ accounts: [stale()], lastAt: Date.now() - 5000, lastOk: true });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(t.calls.fetch.length, 0, 'a check made seconds ago is not repeated');
  assertEq(r.checked, true, 'and counts as checked when it succeeded');

  t = recheckSandbox({ accounts: [stale()], lan: true, lanOk: true, onFetch: approve });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(t.calls.lanLoad, 1, 'on the Centre\'s network the Centre\'s own copy is asked');
  assertEq(t.calls.fetch.length, 0, 'and nothing else');
  assertEq(r.checked === true && r.account && r.account.status, 'active', 'the approval arrives that way too');
  t = recheckSandbox({ accounts: [stale()], lan: true, lanOk: false });
  r = await vm.runInContext('recheckAccountBeforeRefusal(userAccounts[0], ' + find + ')', t.sb);
  assertEq(r.checked, false, 'and when it does not answer, "could not check"');

  /* ---------- 4. What the refusal says ---------- */
  console.log('A refusal says whether it was checked, and a registration that never left is sent');
  function blockedSandbox(sendResult) {
    const seen = { screens: [], states: [], alerts: [], sent: [] };
    const sb = {
      CESTISCore: Core, console: console,
      showPendingApprovalScreen: function (u, o) { seen.screens.push((o && o.state) || 'waiting'); },
      setPendingApprovalState: function (s) { seen.states.push(s); },
      sendRegistration: function (u) { seen.sent.push(u.id); return Promise.resolve(sendResult); },
      alert: function (m) { seen.alerts.push(m); }
    };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'loginBlocked'), sb);
    return { sb, seen };
  }
  const tick = () => new Promise(res => setImmediate(res));
  let b = blockedSandbox(true);
  b.sb.acct = stale();
  assertEq(vm.runInContext('loginBlocked(acct, { checked: false })', b.sb), true, 'pending is still a stop');
  assertEq(b.seen.screens.join(), 'unchecked', 'could not check: "awaiting approval — this device could not check just now"');
  assertEq(b.seen.sent.length, 0, 'and nothing is sent');
  b = blockedSandbox(true); b.sb.acct = stale();
  vm.runInContext('loginBlocked(acct, { checked: true })', b.sb); await tick();
  assertEq(b.seen.screens.join() + '|' + b.seen.states.join(), 'checking|waiting', 'checked and still pending: her registration is made sure of, then "awaiting approval"');
  assertEq(b.seen.sent.join(), 'USR-TB', 'it is sent from this device if the office did not have it');
  b = blockedSandbox(false); b.sb.acct = stale();
  vm.runInContext('loginBlocked(acct, { checked: true })', b.sb); await tick();
  assertEq(b.seen.states.join(), 'not-sent', 'and when it cannot be sent, the screen says so');
  b = blockedSandbox(true); b.sb.acct = Object.assign(stale(), { registeredVia: 'admin-created' });
  vm.runInContext('loginBlocked(acct, { checked: true })', b.sb);
  assertEq(b.seen.sent.length + '|' + b.seen.screens.join(), '0|waiting', 'an account the office made is never "sent" as a registration');
  b = blockedSandbox(true); b.sb.acct = Object.assign(stale(), { status: 'rejected' });
  vm.runInContext('loginBlocked(acct, { checked: false })', b.sb);
  assert(/not approved/.test(b.seen.alerts[0] || '') && (b.seen.alerts[0] || '').indexOf(Core.accountAccess.UNCHECKED_REFUSAL_NOTE) !== -1,
    'a refusal this device could not check says so — got ' + JSON.stringify(b.seen.alerts));
  b = blockedSandbox(true); b.sb.acct = Object.assign(stale(), { status: 'rejected' });
  vm.runInContext('loginBlocked(acct, { checked: true })', b.sb);
  assert((b.seen.alerts[0] || '').indexOf(Core.accountAccess.UNCHECKED_REFUSAL_NOTE) === -1, 'a checked refusal does not');
  b = blockedSandbox(true); b.sb.acct = { id: 'X', role: 'student', status: 'active' };
  assertEq(vm.runInContext('loginBlocked(acct, { allowNoPassword: true })', b.sb), false, 'the email route still lets a password-less account in');

  /* ---------- 5. Every route asks first ---------- */
  console.log('Every sign-in route asks before it refuses');
  ['handleAdminClick', 'handleStudentClick', 'handleInstructorClick', 'handleAdminStaffClick', 'handleCmcClick'].forEach(function (fn) {
    const body = extractFunction(SRC, fn);
    const ask = body.indexOf('recheckAccountBeforeRefusal('), gate = body.indexOf('loginBlocked(');
    assert(ask !== -1 && gate !== -1 && ask < gate, fn + ' checks before loginBlocked');
    assert(/loginBlocked\([^)]*checked:\s*_recheck\.checked/.test(body), fn + ' tells loginBlocked whether it could check');
  });
  const gp = extractFunction(SRC, 'handleGmailProfile');
  assert(/recheckAccountBeforeRefusal\(findMine\(\), findMine, \{ ifMissing: true, allowNoPassword: true \}\)/.test(gp), 'the email route checks too, unknown addresses included');
  assert(gp.indexOf('recheckAccountBeforeRefusal(') < gp.indexOf('openRegistrationModal('), 'before it offers a registration');
  assert(/return handleGmailProfile\(profile, role\)/.test(extractFunction(SRC, 'gmailSignIn')), 'an error in the email route is reported, not swallowed');

  /* ---------- 6. Registering: no pop-up, an honest screen ---------- */
  console.log('"Register" never opens a sign-in window, and the pending screen follows what happened');
  {
    let popped = 0;
    const sb = { CESTISCore: Core, console: { log: function () {}, warn: function () {} }, googleAccessToken: null, CESTISStore: makeStore({}),
      GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F', BACKUP_FILE_NAME: 'CESTIS_LMS_BACKUP.json' },
      loginPageGoogleAuth: async function () { popped++; return 'personal-token'; },
      fetch: async function () { throw new Error('no request expected without a token'); } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'studentPushRegistration'), sb);
    const res = await vm.runInContext('studentPushRegistration({ id: "USR-J", email: "jhanelle.spence@gmail.com" })', sb);
    assertEq(res, false, 'with no sign-in this device already holds, the registration waits on the device');
    assertEq(popped, 0, 'and no sign-in window is opened for it');
    assertEq(sb.CESTISStore.getItem('schoolDashboardGoogleAccessToken'), null, 'nobody\'s own sign-in is kept as the Centre\'s');
    sb.CESTISStore.setItem('schoolDashboardGoogleAccessToken', 'old'); sb.CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', new Date(Date.now() - 60000).toISOString());
    assertEq(await vm.runInContext('studentPushRegistration({ id: "USR-J", email: "j@x" })', sb), false, 'an expired sign-in is not used');
    assertEq(popped, 0, 'and still no window');
  }
  for (const pushed of [true, false]) {
    const states = [];
    const fields = { regName: 'Tashana Brown', regEmail: 'tashana.brown@gmail.com', regProgramme: 'Welding & Fabrication',
      regPassword: 'Tashana2026', regPasswordConfirm: 'Tashana2026', regRole: 'student' };
    const sb = {
      CESTISCore: Core, console: { log: function () {}, warn: function () {} }, userAccounts: [], window: {},
      document: { getElementById: function (id) { return { value: fields[id] }; } },
      alert: function (m) { throw new Error('unexpected alert: ' + m); },
      courseEnrolmentBlockReason: function () { return ''; },
      hashPassword: async function (p) { return REAL; }, cestisGenId: function (p) { return p + 'NEW'; }, localDateStr: function () { return '2026-10-22'; },
      cachePlaintextPw: function () {}, saveState: function () {}, closeRegistrationModal: function () {},
      studentPushRegistration: function () { return Promise.resolve(pushed); },
      showPendingApprovalScreen: function (u, o) { states.push((o && o.state) || 'none'); },
      setPendingApprovalState: function (s) { states.push(s); }
    };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'submitRegistration') + '\n' + extractFunction(SRC, 'sendRegistration'), sb);
    await vm.runInContext('submitRegistration()', sb); await tick();
    assertEq(states.join(), pushed ? 'sending,sent' : 'sending,not-sent', 'the screen says "sending", then ' + (pushed ? '"it has reached the office"' : '"it has NOT reached the office"'));
  }
  {
    // On the Centre's network the device's own save carries the registration.
    let saved = 0;
    const sb = { window: {}, studentPushRegistration: function () { throw new Error('not on the Centre\'s network'); } };
    sb.window.CESTISPageCloud = sb.CESTISPageCloud = { lan: async () => true, saveNow: async () => { saved++; return [true, false]; } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'sendRegistration'), sb);
    assertEq(await vm.runInContext('sendRegistration({})', sb), true, 'on the Centre\'s network a registration is sent by the device\'s own save');
    sb.CESTISPageCloud.saveNow = async () => [false, false];
    assertEq(await vm.runInContext('sendRegistration({})', sb), false, 'and is "not sent" when that save is refused');
  }

  /* ---------- 7. Approve / reject write the accounts list at once ---------- */
  console.log('Approve and Reject (one or all) write the accounts list at once');
  ['approveUser', 'rejectUser', 'approveAllPending', 'rejectAllPending'].forEach(function (fn) {
    const body = extractFunction(SRC, fn);
    assert(/touchAccount\(/.test(body), fn + ' stamps the decision (newest edit wins)');
    assert(/saveUserAccounts\(\)/.test(body), fn + ' writes the accounts list at once (it used to wait for the next timed save)');
  });

  /* ---------- 7b. Every merge path keeps the approval ---------- */
  console.log('The approval wins on every path a copy travels: accounts list, backups, the Centre\'s network, the master backup');
  {
    // The lab PC's copy, as her registration made it, and the office's after Approve.
    const pend = () => ({ id: 'USR-TB', role: 'student', email: 'tashana.brown@gmail.com', username: 'tashana.brown', status: 'pending', password: REAL, registeredVia: 'registration', createdAt: '2026-10-19' });
    const appr = () => Object.assign(pend(), { status: 'active', approvedAt: '2026-10-20', approvedBy: 'admin', studentDataId: 'STU-TB', updatedAt: '2026-10-20T15:00:00.000Z' });
    // The accounts list and the folder backups both merge through mergeCloudAccounts.
    function viaMerge(local, cloud) {
      const sb = { CESTISCore: Core, userAccounts: [local], isUserDeleted: function () { return false; } };
      vm.createContext(sb);
      vm.runInContext(extractFunction(SRC, 'mergeCloudAccounts'), sb);
      vm.runInContext('mergeCloudAccounts(cloud)', Object.assign(sb, { cloud: [cloud] }));
      return sb.userAccounts;
    }
    let out = viaMerge(pend(), appr());
    assertEq(out.length + ':' + out[0].status + ':' + out[0].studentDataId, '1:active:STU-TB', 'accounts list / backup → the lab PC: its "pending" becomes "active", linked to her record');
    out = viaMerge(appr(), pend());
    assertEq(out[0].status, 'active', 'and a stale "pending" arriving at the office never undoes the approval');
    const rej = Object.assign(pend(), { status: 'rejected', updatedAt: '2026-10-02T09:00:00.000Z' });
    out = viaMerge(rej, Object.assign(appr(), { updatedAt: '2026-10-21T09:00:00.000Z' }));
    assertEq(out[0].status, 'active', 'a re-approval reaches a device still holding the rejection');

    // The Centre's network: the server and every device merge per account.
    const PC = Core.pageCloud, R = { records: true }, J = JSON.stringify;
    const T1 = '2026-10-19T10:00:00.000Z', T2 = '2026-10-20T15:00:00.000Z';
    let m = PC.mergeKeys({ voctrain_users: J([pend()]) }, { voctrain_users: T1 }, { voctrain_users: J([appr()]) }, { voctrain_users: T2 }, R);
    assertEq(JSON.parse(m.data.voctrain_users)[0].status, 'active', 'Centre\'s network → the lab PC: the approval arrives');
    m = PC.mergeKeys({ voctrain_users: J([pend()]) }, { voctrain_users: T2 }, { voctrain_users: J([appr()]) }, { voctrain_users: T1 }, R);
    assertEq(JSON.parse(m.data.voctrain_users)[0].status, 'active', 'even when the lab PC wrote its whole list more recently');
    m = PC.mergeKeys({ voctrain_users: J([appr()]) }, { voctrain_users: T1 }, { voctrain_users: J([pend()]) }, { voctrain_users: T2 }, R);
    assertEq(JSON.parse(m.data.voctrain_users)[0].status, 'active', 'and the lab PC\'s later save does not put "pending" back');

    // The master backup only adds what a device is missing; it never decides a clash.
    const snapOf = list => ({ store: { voctrain_users: J(list) } });
    let rc = Core.reconcileSnapshot(snapOf([pend()]), { voctrain_users: J([appr()]) });
    assertEq(JSON.parse(rc.store.voctrain_users).filter(u => u.id === 'USR-TB').map(u => u.status).join(), 'active', 'an older master backup holding "pending" never undoes the approval');
    rc = Core.reconcileSnapshot(snapOf([appr()]), { voctrain_users: J([]) });
    assertEq(JSON.parse(rc.store.voctrain_users).map(u => u.status).join(), 'active', 'and a device missing her account gets the approved one');
  }

  /* ---------- 8. Writing the accounts list keeps what it holds ---------- */
  console.log('Writing the accounts list merges what it holds first: an approval made elsewhere stands');
  {
    const sent = [];
    const ledger = { accounts: [
      { id: 'USR-TB', role: 'student', email: 'tashana.brown@gmail.com', username: 'tashana.brown', status: 'active', password: REAL, studentDataId: 'STU-TB', approvedAt: '2026-10-20', updatedAt: '2026-10-20T15:00:00.000Z' },
      { id: 'USR-SL', role: 'student', email: 'Shamar.Lewis@gmail.com', username: 'slewis', status: 'active', password: REAL, registeredVia: 'admin-created', updatedAt: '2026-10-20T16:00:00.000Z' }
    ], deletedUserIds: [] };
    const sb = { CESTISStore: makeStore({}), CESTISCore: Core, console: { log: function () {}, warn: function () {}, error: function () {} },
      isCloudConnected: true, googleAccessToken: 'tok', _accountsLedgerSaving: false, _sessionWiped: false, _accountsLedgerFileId: 'LEDGER',
      ACCOUNTS_LEDGER_FILE: 'CESTIS_ACCOUNTS.json', GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F' }, currentLoggedInUser: null, _delUserIdsMemo: null, _delUserIdsAt: 0,
      // The lab PC: her registration as it made it ("pending", no edit stamp).
      userAccounts: [{ id: 'USR-MT', role: 'admin', username: 'mthompson', status: 'active', password: REAL, updatedAt: '2026-09-01T00:00:00.000Z' },
                     { id: 'USR-TB', role: 'student', email: 'tashana.brown@gmail.com', username: 'tashana.brown', status: 'pending', password: REAL, registeredVia: 'registration', createdAt: '2026-10-19' }],
      stripSecretFields: function (k, v) { return k === '_plaintextPw' ? undefined : v; },
      handleCloudAuthExpired: function () {},
      fetch: async function (url, opts) {
        if (!opts || !opts.method) return { ok: true, json: async function () { return JSON.parse(JSON.stringify(ledger)); } };
        sent.push(JSON.parse(opts.body));
        return { ok: true, json: async function () { return {}; } };
      } };
    vm.createContext(sb);
    vm.runInContext(['ledgerHeaders', 'findAccountsLedgerFile', '_getDeletedUserIds', 'isUserDeleted', 'recordDeletedUser', 'dropDeletedAccounts', 'mergeCloudAccounts', 'persistUserAccounts', 'saveAccountsLedger']
      .map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb);
    assertEq(await vm.runInContext('saveAccountsLedger()', sb), true, 'the list is written');
    const body = sent[0] || { accounts: [] };
    const tb = body.accounts.filter(function (a) { return a.id === 'USR-TB'; });
    assertEq(tb.length + ':' + (tb[0] && tb[0].status), '1:active', 'the office\'s approval stands — the lab PC\'s older "pending" is not written back');
    assertEq(tb[0] && tb[0].studentDataId, 'STU-TB', 'with the link to her trainee record');
    assert(body.accounts.some(function (a) { return a.id === 'USR-SL'; }), 'an account the office created since is not dropped');
    assert(body.accounts.some(function (a) { return a.id === 'USR-MT'; }), 'and this device\'s own accounts are written too');
    assertEq(sb.userAccounts.find(function (a) { return a.id === 'USR-TB'; }).status, 'active', 'the lab PC itself now holds the approval');
  }

  /* ---------- 9. The quick account check brings instructors' records ---------- */
  console.log('The quick account check brings the instructors\' records, so no second one is made');
  {
    const backup = { data: {
      userAccounts: [{ id: 'USR-DC', role: 'instructor', name: 'Devon Clarke', email: 'devon.clarke@gmail.com', username: 'devon.clarke', status: 'active', password: REAL, updatedAt: '2026-10-20T15:00:00.000Z' }],
      students: [], certDownloadApprovals: [], certTemplates: {}, skillAreas: [],
      instructorData: [{ id: 'INS-OFFICE', name: 'Devon Clarke', course: 'Electrical Installation', email: 'devon.clarke@gmail.com' }]
    } };
    const urls = [];
    const sb = { CESTISCore: Core, console: { log: function () {}, warn: function () {}, error: function () {} }, Date: Date,
      googleAccessToken: 'centre-token', CESTISStore: makeStore({}), GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F', BACKUP_FILE_NAME: 'CESTIS_LMS_BACKUP.json' },
      _cloudAcctFetchPromise: null, _cloudAcctFetchLastAt: 0, _cloudAcctFetchLastOk: false,
      userAccounts: [{ id: 'USR-DC', role: 'instructor', name: 'Devon Clarke', email: 'devon.clarke@gmail.com', username: 'devon.clarke', status: 'pending', password: REAL, registeredVia: 'registration' }],
      students: [], instructorData: [], certDownloadApprovals: [], certTemplates: {}, skillAreas: [], syncTombstones: {},
      updateLoginSyncStatus: function () {}, loadAccountsLedger: async function () { return false; }, loginPageGoogleAuth: async function () { throw new Error('no pop-up'); },
      cestisIsStudentTombstoned: function () { return false; }, isCentreDeleted: function () { return false; }, saveState: function () {},
      isUserDeleted: function () { return false; },
      fetch: async function (url) {
        urls.push(url);
        if (/\/files\?q=/.test(url)) return { ok: true, json: async function () { return { files: [{ id: 'BK' }] }; } };
        return { ok: true, json: async function () { return JSON.parse(JSON.stringify(backup)); } };
      } };
    vm.createContext(sb);
    vm.runInContext(['syncKeyById', 'syncTombsFor', 'mergeCloudAccounts', 'cloudFetchAccountData'].map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb);
    assertEq(await vm.runInContext('cloudFetchAccountData(false)', sb), true, 'the check reads the shared copy');
    assertEq(sb.userAccounts[0].status, 'active', 'his approval arrives');
    assertEq(sb.instructorData.map(function (i) { return i.id; }).join(), 'INS-OFFICE', 'and so does the record the approval made — the sign-in finds it instead of making another');
    await vm.runInContext('_cloudAcctFetchLastAt = 0; cloudFetchAccountData(false)', sb);
    assertEq(sb.instructorData.length, 1, 'read twice, still one record');
  }
  console.log('An instructor signing in on a wiped shared PC gets their record back, not a new one');
  {
    const devon = { id: 'USR-DC', role: 'instructor', name: 'Devon Clarke', email: 'devon.clarke@gmail.com', programme: 'Electrical Installation', status: 'active', password: REAL };
    function insSandbox(refresh, tombs) {
      const seen = { refresh: 0, ids: 0 };
      const sb = { CESTISCore: Core, console: console, instructorData: [], syncTombstones: tombs ? { instructorData: tombs } : {},
        saveState: function () {}, cestisGenId: function (p) { seen.ids++; return p + 'RANDOM'; },
        refreshAccountsQuietly: async function () { seen.refresh++; if (refresh) sb.instructorData.push({ id: 'INS-OFFICE', name: 'Devon Clarke', course: 'Electrical Installation' }); return !!refresh; } };
      vm.createContext(sb);
      vm.runInContext(['syncTombsFor', 'findInstructorRecordForAccount', 'instructorRecordForSignIn', 'createInstructorDataForAccount'].map(function (n) { return extractFunction(SRC, n); }).join('\n'), sb);
      sb.acct = devon;
      return { sb, seen };
    }
    let x = insSandbox(true);
    let rec = await vm.runInContext('instructorRecordForSignIn(acct)', x.sb);
    assertEq(rec && rec.id, 'INS-OFFICE', 'a device holding no record asks the shared copy and uses the record the office made');
    assertEq(x.sb.instructorData.length, 1, 'and makes none of its own');
    rec = await vm.runInContext('instructorRecordForSignIn(acct)', x.sb);
    assertEq(x.seen.refresh, 1, 'a device that holds the record does not ask again');
    x = insSandbox(false);
    rec = await vm.runInContext('instructorRecordForSignIn(acct)', x.sb);
    assertEq(rec && rec.id, 'INS-USR-DC', 'offline, the record it has to make carries the account\'s own id — the one any other device would make');
    assertEq(x.seen.ids, 0, 'not a random one');
    x = insSandbox(false, { 'INS-USR-DC': '2026-10-01T00:00:00.000Z' });
    rec = await vm.runInContext('instructorRecordForSignIn(acct)', x.sb);
    assertEq(rec && rec.id, 'INS-RANDOM', 'a record that was deliberately deleted is not made again under its old id');
    ['handleInstructorClick', 'handleGmailProfile'].forEach(function (fn) {
      assert(/await instructorRecordForSignIn\(/.test(extractFunction(SRC, fn)) && !/createInstructorDataForAccount\(/.test(extractFunction(SRC, fn)),
        fn + ' gets the record through instructorRecordForSignIn');
    });
  }

  /* ---------- 10. Sync Now: was anything of the Centre's read? ---------- */
  console.log('Sync Now asks the Centre\'s folder when nothing was read, and says so honestly');
  {
    const sb = { GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'CENTRE' }, status: 200, threw: false, seen: null,
      fetch: async function (url, opts) { sb.seen = { url: url, auth: opts.headers.Authorization }; if (sb.threw) throw new Error('offline'); return { ok: sb.status === 200, status: sb.status }; } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'centreFolderAccess'), sb);
    assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'yes', 'the Centre\'s folder answers its own account');
    assert(/\/files\/CENTRE\?fields=id$/.test(sb.seen.url) && sb.seen.auth === 'Bearer tok', 'it asks for the folder itself, with this sign-in');
    sb.status = 404; assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'no', '"not found" to somebody\'s own account');
    sb.status = 403; assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'no', 'or "not allowed"');
    sb.status = 401; assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'expired', 'an expired sign-in');
    sb.status = 500; assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'unknown', 'a hiccup is "unknown"');
    sb.threw = true; assertEq(await vm.runInContext('centreFolderAccess("tok")', sb), 'unknown', 'and so is no answer');
    assertEq(await vm.runInContext('centreFolderAccess(null)', sb), 'unknown', 'no sign-in: unknown');
  }
  {
    const ls = extractFunction(SRC, 'loginPageSync');
    const outcome = ls.indexOf('CESTISCore.accountAccess.loginSyncOutcome(');
    assert(outcome !== -1 && outcome < ls.indexOf("'Sync complete! You may now log in.'"), 'Sync Now decides whether anything was read BEFORE it says "Sync complete"');
    const noAccess = ls.slice(ls.indexOf("err.syncOutcome === 'no-access'"));
    assert(/NO_ACCESS_SYNC_MESSAGE/.test(noAccess.slice(0, 600)) && /removeItem\('schoolDashboardGoogleAccessToken'\)/.test(noAccess.slice(0, 600)),
      'a sign-in that cannot open the Centre\'s records says so and is not kept on the device');
  }

  /* ---------- 11. The email button where its sign-in cannot load ---------- */
  console.log('The email button is taken away where its sign-in cannot load');
  {
    assert(/<script src="https:\/\/accounts\.google\.com\/gsi\/client" async defer onerror="[^"]*markEmailSignInUnavailable/.test(SRC), 'the sign-in script reports when it cannot load');
    assert(/if \(window\.__cestisEmailSignInOff\) markEmailSignInUnavailable\(\);/.test(SRC), 'and a failure before the page script ran is not missed');
    const el = (cls, prev) => ({ classList: { contains: c => c === cls }, style: {}, previousElementSibling: prev || null });
    const orS = el('gmail-divider'), btnS = el('gmail-btn', orS), orI = el('gmail-divider'), btnI = el('gmail-btn', orI);
    const sb = { document: { querySelectorAll: function (q) { return q === '.role-card .gmail-btn' ? [btnS, btnI] : []; } } };
    vm.createContext(sb);
    vm.runInContext(extractFunction(SRC, 'markEmailSignInUnavailable'), sb);
    vm.runInContext('markEmailSignInUnavailable()', sb);
    assert(btnS.style.display === 'none' && btnI.style.display === 'none', 'both email buttons are taken away');
    assert(orS.style.display === 'none' && orI.style.display === 'none', 'with their "or"');
  }

  /* ---------- the Offline System carries the same page code ---------- */
  const OFF = fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8');
  ['recheckAccountBeforeRefusal', 'refreshAccountsQuietly', 'loginBlocked', 'sendRegistration', 'markEmailSignInUnavailable', 'centreFolderAccess', 'instructorRecordForSignIn', 'createInstructorDataForAccount'].forEach(function (fn) {
    assertEq(extractFunction(OFF, fn), extractFunction(SRC, fn), 'the Offline System\'s ' + fn + '() is the main build\'s');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
