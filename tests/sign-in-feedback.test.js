/* Sign-in tells you what went wrong under the card you used, the top bar says
   who is signed in with a Lock beside Sign Out, and the "sync first" step is
   explained in plain words (UI preview, owner's item 4).

   What was wrong:
     - every sign-in failure — wrong password, an account switched off, a
       registration still waiting, the published default refused, too many
       attempts — was a pop-up that covered the very form the person had to
       correct, and on a phone hid where they were;
     - a registration still waiting showed "Thank you for registering", as if
       the person had just registered again;
     - nothing in the top bar said whose session was open on a shared PC, and
       the only way to lock it was to wait for the idle timer;
     - a new computer greyed out every card with no word on why "Sync Now"
       comes first. (The first note written for that named Google, the
       Centre's network and its server; by the owner's rule nothing on
       screen may say where the records come from or are kept, so it is now
       one neutral line, and that is pinned in section 5.)

   The words and the checks are the ones the pop-ups used; only where they
   appear has changed. Pinned here from the real index.html (Node, no
   browser); tests/browser/ui-preview-b.js drives the same things for real.

   Run: node tests/sign-in-feedback.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(src, name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start < 0) start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

/* A tiny page: elements by id, each with the bits the sign-in code touches. */
function page(opts) {
  opts = opts || {};
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, value: '', hidden: true, textContent: '', style: {}, attrs: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    getClientRects() { return (opts.offscreen || []).indexOf(id) !== -1 ? [] : [{}]; },
    focus() {}
  });
  const alerts = [];
  const sb = {
    document: { getElementById: el, addEventListener() {} },
    alert: m => alerts.push(String(m)),
    console: { log() {}, error() {} },
    setTimeout: fn => fn(),
    CESTISCore: {
      accountAccess: {
        check: a => a.status === 'disabled' ? { allowed: false, reason: 'disabled', message: 'This account has been disabled. Contact an administrator.' }
          : a.status === 'pending' ? { allowed: false, reason: 'pending', message: 'This account is awaiting approval by an administrator.' }
          : { allowed: true },
        isPublishedDefault: pw => pw === 'cestisadmin123$',
        publishedDefaultLogin: () => ({ allowed: false, message: 'This login is still on the default password published with the platform, so it cannot be used to sign in.' })
      }
    }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(
    'var loginSyncCompleted = true, adminLoginShown = true, userAccounts = [], currentLoggedInUser = null, entered = [], pendingScreens = [];' +
    'var LOGIN_ATTEMPTS = {};' +
    'function checkLoginRateLimit(u) { return LOGIN_ATTEMPTS[u] >= 5 ? { allowed: false, remainSeconds: 300 } : { allowed: true }; }' +
    'function recordLoginFailure(u) { LOGIN_ATTEMPTS[u] = (LOGIN_ATTEMPTS[u] || 0) + 1; } function clearLoginFailures() {}' +
    'async function findLoginAccount(role, u) { return userAccounts.find(a => a.username === u) || null; }' +
    'async function checkPasswordWithCloud(pw, a) { return pw === a.pw; }' +
    'function tfaGateLogin(a, go) { go(); } function lanHostTicket() {} function enterApp(r) { entered.push(r); }' +
    'function openForceChangePw() {} function showPendingApprovalScreen(a) { pendingScreens.push(a.username); }', sb);
  ['signInSay', 'signInQuiet', 'requireLoginSync', 'loginBlocked', 'publishedDefaultGate', 'handleAdminClick']
    .forEach(n => vm.runInContext(extractFunction(INDEX, n), sb));
  vm.runInContext(/var SIGNIN_CARD_FOR_ROLE = [^;]+;/.exec(INDEX)[0], sb);
  return { sb, el, alerts, run: code => vm.runInContext(code, sb) };
}

/* ---------- 1. Each card carries its own message line ---------- */
console.log('Each sign-in card has a message line under its fields, announced to screen readers');
const landing = INDEX.slice(INDEX.indexOf('<div class="role-cards'), INDEX.indexOf('<!-- Certificate Check Button -->'));
['admin', 'student', 'instructor', 'adminStaff', 'cmc'].forEach(c => {
  const form = new RegExp('<div class="role-login" id="' + c + 'Login">([\\s\\S]*?)</form>').exec(landing);
  assert(form && new RegExp('<div class="role-login-error" id="' + c + 'LoginError" role="alert" hidden></div>').test(form[1]),
    c + ': a hidden role="alert" message line sits inside the card\'s form');
  assert(new RegExp('id="' + c + 'Pass"[^>]*aria-describedby="' + c + 'LoginError"').test(landing), c + ': the password field is described by it');
});

/* ---------- 2. Every message of the five handlers goes there ---------- */
console.log('The five sign-in handlers say every failure inline, in the words the pop-ups used');
[['handleAdminClick', 'admin'], ['handleStudentClick', 'student'], ['handleInstructorClick', 'instructor'],
 ['handleAdminStaffClick', 'adminStaff'], ['handleCmcClick', 'cmc']].forEach(([fn, card]) => {
  const body = extractFunction(INDEX, fn);
  assert(!/\balert\(/.test(body), fn + ': no pop-up is left in it');
  assert(new RegExp("requireLoginSync\\('" + card + "'\\)").test(body), fn + ': "sync first" is said under its card');
  assert(new RegExp("loginBlocked\\(\\w+, \\{[^}]*card: '" + card + "' \\}\\)").test(body), fn + ': a blocked account is said under its card');
  assert(new RegExp("signInQuiet\\('" + card + "'\\)").test(body), fn + ': the last attempt\'s message is cleared before a new one');
  assert(/Too many failed attempts\. Please wait ' \+ rateCheck\.remainSeconds \+ ' seconds before trying again\./.test(body), fn + ': the too-many-attempts words are unchanged');
});
assert(/Password incorrect for "' \+ uname \+ '"\./.test(extractFunction(INDEX, 'handleAdminClick')), 'the administrator\'s wrong-password words are unchanged');

/* ---------- 3. Behaviour: the same checks, the message under the card ---------- */
console.log('A wrong password: the message is under the card, no pop-up, still not signed in');
(async () => {
  let P = page();
  P.run("userAccounts.push({ id: 'U1', username: 'mthompson', pw: 'Right-1', status: 'active' })");
  P.el('adminUser').value = 'mthompson'; P.el('adminPass').value = 'wrong';
  await P.run('handleAdminClick()');
  assert(P.alerts.length === 0, 'no pop-up');
  assert(P.el('adminLoginError').hidden === false && P.el('adminLoginError').textContent === 'Password incorrect for "mthompson".', 'the message line shows the old words: ' + P.el('adminLoginError').textContent);
  assert(P.el('adminPass').attrs['aria-invalid'] === 'true', 'the password field is marked invalid');
  assert(P.run('entered.length') === 0, 'and nobody is signed in');
  P.el('adminPass').value = 'Right-1';
  await P.run('handleAdminClick()');
  assert(P.el('adminLoginError').hidden === true && P.el('adminLoginError').textContent === '', 'the next attempt clears the message first');
  assert(P.run('entered.join()') === 'admin', 'the right password signs in exactly as before');

  console.log('Switched off, still waiting, the published default, too many tries: all under the card');
  P = page();
  P.run("userAccounts.push({ id: 'U2', username: 'kgordon', pw: 'x', status: 'disabled' }, { id: 'U3', username: 'shanice', pw: 'x', status: 'pending' }, { id: 'U4', username: 'cestisadmin', pw: 'cestisadmin123$', status: 'active' })");
  P.el('adminUser').value = 'kgordon'; P.el('adminPass').value = 'x';
  await P.run('handleAdminClick()');
  assert(/has been disabled\. Contact a system administrator\./.test(P.el('adminLoginError').textContent) && P.alerts.length === 0, 'a switched-off account: under the card, naming who can fix it');
  P.el('adminUser').value = 'shanice';
  await P.run('handleAdminClick()');
  assert(/awaiting approval/.test(P.el('adminLoginError').textContent) && /once it has been approved/.test(P.el('adminLoginError').textContent),
    'a registration still waiting: said under the card');
  assert(P.run('pendingScreens.length') === 0, 'and the "Thank you for registering" screen no longer opens at sign-in');
  P.el('adminUser').value = 'cestisadmin'; P.el('adminPass').value = 'cestisadmin123$';
  await P.run('handleAdminClick()');
  assert(/default password published with the platform/.test(P.el('adminLoginError').textContent) && P.run('entered.length') === 0,
    'the published default, refused: said under the card, and nothing opens');
  P.el('adminUser').value = 'mthompson'; P.el('adminPass').value = 'nope';
  for (let i = 0; i < 6; i++) await P.run('handleAdminClick()');
  assert(/Too many failed attempts/.test(P.el('adminLoginError').textContent), 'too many attempts: said under the card');
  assert(P.alerts.length === 0, 'none of them raised a pop-up');

  console.log('Where no card is on screen, or no card is named, the pop-up still speaks');
  P = page({ offscreen: ['adminLogin'] });
  P.run("userAccounts.push({ id: 'U1', username: 'mthompson', pw: 'Right-1', status: 'active' })");
  P.el('adminUser').value = 'mthompson'; P.el('adminPass').value = 'wrong';
  await P.run('handleAdminClick()');
  assert(P.alerts.length === 1 && /Password incorrect/.test(P.alerts[0]), 'a card that is not showing falls back to the pop-up');
  P = page();
  assert(P.run("loginBlocked({ status: 'pending', username: 'g' }, { allowNoPassword: true })") === true && P.run('pendingScreens.length') === 1,
    'Google sign-in (no card) keeps its own waiting screen');
  assert(P.run("loginBlocked({ status: 'disabled' }, {})") === true && P.alerts.length === 1, 'and its own pop-up for a switched-off account');
  P.run('loginSyncCompleted = false');
  assert(P.run("requireLoginSync('admin')") === true && /Sync Now/.test(P.el('adminLoginError').textContent), '"sync first" from a card: said under it');

  /* ---------- 4. The top bar: who, and Lock ---------- */
  console.log('The top bar says who is signed in and has a Lock that uses the idle lock');
  const topbar = INDEX.slice(INDEX.indexOf('<header class="topbar">'), INDEX.indexOf('</header>', INDEX.indexOf('<header class="topbar">')));
  assert(/id="topbarWho"/.test(topbar) && /id="topbarWhoName"/.test(topbar) && /id="topbarWhoRole"/.test(topbar), 'the top bar has a who-is-signed-in block');
  assert(/<button type="button" class="topbar-lock-btn" id="topbarLockBtn" onclick="lockSessionNow\(\)" aria-label="[^"]+"/.test(topbar), 'and a labelled Lock button');
  assert(topbar.indexOf('topbarLockBtn') < topbar.indexOf('class="logout-btn"'), 'Lock sits just before Sign Out');
  // Narrow screens: the who block (initials) opens a menu holding Lock, the
  // Light/Dark switch, Two-Step Verification and Sign Out, so the page's name
  // shows in full on a phone (combined preview).
  assert(/<button type="button" class="topbar-who" id="topbarWho" title="Signed in" onclick="toggleAccountMenu\(event\)" aria-haspopup="menu" aria-expanded="false" aria-controls="topbarAccountMenu">/.test(topbar), 'the who block is a button that opens the account menu');
  const acct = topbar.slice(topbar.indexOf('id="topbarAccountMenu"'), topbar.indexOf('id="topbarLockBtn"'));
  assert(/role="menu"/.test(acct) && /hidden>/.test(acct), 'a menu, closed at first');
  [['lockSessionNow\\(\\)', 'Lock'], ['cestisToggleTheme\\(\\)', 'Light mode'], ['tfaOpenManage\\(\\)', 'Two-Step Verification'], ['logout\\(\\)', 'Sign Out']].forEach(([fn, word]) =>
    assert(new RegExp('role="menuitem"[^>]*onclick="[^"]*' + fn + '"[\\s\\S]*?' + word).test(acct), 'the menu holds ' + word));
  assert(/data-theme-toggle onclick="cestisToggleTheme\(\)"/.test(acct), 'its Light/Dark item is kept in step with the theme like the other switches');
  const narrow = (INDEX.match(/@media \(max-width:960px\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(/\.topbar-lock-btn, \.topbar \.theme-toggle, \.topbar \.topbar-tfa-btn \{ display:none; \}/.test(narrow), '960px and below: Lock, Light/Dark and Two-Step leave the bar for the menu');
  assert(/\.topbar \.logout-btn \{ display:none; \}/.test(INDEX), 'on a phone, Sign Out is in the menu too');
  const tam = extractFunction(INDEX, 'toggleAccountMenu');
  assert(/closeSyncChipPanel\(\)/.test(tam) && /aria-expanded/.test(tam), 'opening it closes the sync panel and says it is open');
  const lockNow = extractFunction(INDEX, 'lockSessionNow');
  assert(/openIdleLock\(true\)/.test(lockNow) && /!currentRole \|\| _sessionLocked/.test(lockNow), 'Lock opens the existing idle lock, once, only when signed in');
  const sb2 = { document: { getElementById: id => sb2.els[id] || (sb2.els[id] = { textContent: '', value: '', style: {} }) }, els: {}, opened: [],
    CESTISStore: { removeItem() {} }, setTimeout() {}, openModal: id => sb2.opened.push(id) };
  vm.createContext(sb2);
  vm.runInContext('var _sessionLocked = false, currentRole = "admin", currentLoggedInUser = { name: "Marcia Thompson" };' + extractFunction(INDEX, 'openIdleLock') + lockNow, sb2);
  vm.runInContext('lockSessionNow()', sb2);
  assert(sb2.opened.join() === 'idleLockModal' && vm.runInContext('_sessionLocked', sb2) === true, 'pressing Lock covers the session with the idle lock');
  assert(sb2.els.idleLockWhy.textContent === 'You locked this session.', 'whose first line says the person locked it');
  vm.runInContext('lockSessionNow()', sb2);
  assert(sb2.opened.length === 1, 'pressing it again while locked does nothing');
  vm.runInContext('_sessionLocked = false; openIdleLock()', sb2);
  assert(/left idle/.test(sb2.els.idleLockWhy.textContent), 'the idle timer\'s lock still says the session was left idle');
  assert(/updateTopbarWho\(\);\s*initGlobalSearch\(\);/.test(extractFunction(INDEX, 'enterApp')), 'every role\'s sign-in fills the who block');
  assert(/updateTopbarWho\(\)/.test(extractFunction(INDEX, 'updateSidebarAvatar')), 'and a renamed profile updates it');

  /* ---------- 5. Sync first, in neutral words ---------- */
  // The owner's rule: nothing on screen says where the Centre's records come
  // from or are kept — no Cloud, Google, Drive, server, network or the like.
  const SOURCE_WORDS = /cloud|☁|google|\bdrive\b|gmail|server|network|\blan\b|offline|internet|emailjs|peerjs|broker|megadata/i;
  console.log('The "sync first" step is one plain line that names no place');
  const why = /<p class="login-sync-why" id="loginSyncWhy" role="note">([\s\S]*?)<\/p>/.exec(INDEX);
  assert(!!why, 'one line sits under the sync bar');
  const whyText = why ? why[1].replace(/<[^>]+>/g, '') : '';
  assert(whyText === 'Why Sync Now comes first: it gives this computer the latest accounts and records, so everyone signs in with their current password. If it could not sync, try again or ask the office.',
    'it says why Sync Now comes first and who helps when it could not sync (got "' + whyText + '")');
  // The sync bar right above it says what Sync Now does ("Brings this computer
  // up to date before anyone signs in"); the line must not say it again.
  const bar = /<div class="login-sync-bar" id="loginSyncBar">([\s\S]*?)<button/.exec(INDEX);
  assert(!!bar && /Brings this computer up to date before anyone signs in\./.test(bar[1]) && whyText.indexOf('up to date before anyone signs in') === -1,
    'it does not repeat the sync bar\'s own sentence');
  assert(!SOURCE_WORDS.test(whyText), 'it never says where the records come from or are kept');
  assert(INDEX.indexOf('id="loginSyncWhy"') > INDEX.indexOf('id="loginSyncBar"') && INDEX.indexOf('id="loginSyncWhy"') < INDEX.indexOf('<div class="role-cards'),
    'between the sync bar and the cards');
  assert(!/Staff: why|No Google access|It reads the Centre’s server/.test(INDEX), 'the old note naming Google, the Centre\'s network and its server is gone');

  console.log('Every message this preview puts under a card, and the top bar\'s words, name no place');
  P = page();
  P.run('loginSyncCompleted = false');
  P.run("requireLoginSync('admin')");
  const syncFirst = P.el('adminLoginError').textContent;
  assert(/Sync Now/.test(syncFirst) && !SOURCE_WORDS.test(syncFirst), '"sync first" under a card: ' + JSON.stringify(syncFirst));
  const said = [];
  INDEX.replace(/signInSay\([^,]+,\s*('(?:[^'\\]|\\.)*')/g, (m, s) => { said.push(s); return m; });
  assert(said.length >= 20, 'the card messages were found (' + said.length + ')');
  said.forEach(s => assert(!SOURCE_WORDS.test(s), 'card message names no place: ' + s));
  // The who block is now a button that opens the account menu (Lock,
  // Light/Dark, Two-Step Verification, Sign Out) — all of it is read here.
  const whoLock = topbar.slice(topbar.indexOf('<div class="topbar-account"'), topbar.indexOf('</button>', topbar.indexOf('id="topbarLockBtn"')));
  assert(whoLock.length > 100 && !SOURCE_WORDS.test(whoLock.replace(/<!--[\s\S]*?-->/g, '')), 'the who block and Lock button (text, tooltip, aria-label) name no place');
  ['You locked this session.', 'This session was left idle, so it has been locked.'].forEach(s =>
    assert(INDEX.indexOf(s) !== -1 && !SOURCE_WORDS.test(s), 'the lock\'s first line names no place: ' + s));
  const whoFn = extractFunction(INDEX, 'updateTopbarWho');
  assert(/'Signed in as '/.test(whoFn) && !SOURCE_WORDS.test((whoFn.match(/'[^']*'/g) || []).join(' ')), 'the who block\'s tooltip names no place');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
