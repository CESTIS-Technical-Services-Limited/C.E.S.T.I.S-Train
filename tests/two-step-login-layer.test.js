/* Two-step verification must be able to finish a sign-in.

   What happened: an account with two-step verification on typed the right
   password, pressed Sign In, and nothing happened. The password check passed,
   tfaGateLogin() opened the code prompt (#tfaVerifyModal) — and the prompt was
   drawn BEHIND the login screen. The landing page is a fixed layer at
   z-index 1000; the two-step prompt was styled at z-index 300, a value ported
   from School.Fee.html, where the second step lives inside the login card and
   never has to rise above anything. Every other dialog that opens while the
   landing page is up (forgot password, forced password change, privacy,
   support) carries an explicit z-index above 1000; this one did not. The
   sign-in callback then sat waiting on a modal nobody could see or answer.

   The same prompt also opens on top of the forgot-password dialog (the
   "Verify It's You" step of a self-service reset for a two-step account), so
   it has to sit above that layer as well.

   Pinned here, for both builds (online and Offline System):
     - the two-step prompt is layered above the landing page and above the
       forgot-password dialog, read straight from the stylesheet in index.html;
     - the gate itself still behaves: an account without two-step signs
       straight in; an account with it on opens the prompt and does NOT sign in
       until a valid authenticator code or an unused backup code is entered,
       and a used backup code is burned.

   Run: node tests/two-step-login-layer.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const BUILDS = {
  'index.html': fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
  'Offline System/index.html': fs.readFileSync(path.join(__dirname, '..', 'Offline System', 'index.html'), 'utf8')
};

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

/* z-index of a CSS rule whose selector text is `selector` (first match). */
function ruleZIndex(src, selector, where) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  if (!m) throw new Error(where + ' has no CSS rule for ' + selector);
  const z = m[1].match(/z-index\s*:\s*(\d+)/);
  return z ? parseInt(z[1], 10) : null;
}
/* z-index carried inline on the element with this id, if any. */
function inlineZIndex(src, id, where) {
  const re = new RegExp('id="' + id + '"[^>]*style="[^"]*z-index\\s*:\\s*(\\d+)');
  const m = src.match(re);
  if (!m) throw new Error(where + ' has no inline z-index on #' + id);
  return parseInt(m[1], 10);
}

/* ---------- 1. The prompt is drawn above the login screen ---------- */
console.log('The two-step prompt is layered above the landing page');

Object.keys(BUILDS).forEach(function (where) {
  const src = BUILDS[where];
  const landing = ruleZIndex(src, '#landingPage', where);
  const prompt = ruleZIndex(src, '#tfaVerifyModal', where);
  const forgot = inlineZIndex(src, 'forgotPasswordModal', where);
  assert(landing !== null, where + ': the landing page declares a z-index');
  assert(prompt !== null, where + ': #tfaVerifyModal declares a z-index of its own');
  assert(prompt > landing, where + ': #tfaVerifyModal (' + prompt + ') sits above #landingPage (' + landing +
    ') — otherwise the code prompt opens behind the login screen and Sign In appears to do nothing');
  assert(prompt > forgot, where + ': #tfaVerifyModal (' + prompt + ') sits above the forgot-password dialog (' + forgot +
    ') so the "Verify It\'s You" reset step can be answered');
  assert(src.indexOf('id="tfaVerifyModal"') > src.indexOf('id="appShell"'),
    where + ': the prompt is a top-level overlay, not nested inside the landing page');
});

/* ---------- 2. The gate still gates ---------- */
console.log('The sign-in gate opens the prompt and waits for a valid code');

function makeGate(where, opts) {
  const src = BUILDS[where];
  opts = opts || {};
  const elements = {};
  const group = { style: {} };
  function el(id) {
    if (!elements[id]) elements[id] = { id: id, textContent: '', value: '', style: {}, focus: function () {}, closest: function () { return group; } };
    return elements[id];
  }
  const opened = [], closed = [];
  const sandbox = {
    console: { log: function () {}, error: function () {} },
    document: { getElementById: el },
    setTimeout: function (fn) { fn(); },
    openModal: function (id) { opened.push(id); },
    closeModal: function (id) { closed.push(id); },
    showToast: function () {},
    saveUserAccounts: function () { sandbox.saved++; },
    saved: 0,
    userAccounts: opts.accounts || [],
    opened: opened,
    closed: closed,
    group: group,
    crypto: { getRandomValues: function (b) { for (let i = 0; i < b.length; i++) b[i] = i; } }
  };
  if (opts.OTPAuth) sandbox.OTPAuth = opts.OTPAuth;
  vm.createContext(sandbox);
  vm.runInContext('var tfaPendingSecret=null,tfaPendingBackupCodes=null,tfaVerifyAccount=null,tfaVerifyCallback=null,tfaBackupOnly=false,tfaEmailMode=false,_emailOtp=null;', sandbox);
  ['tfaEnabled', 'accountRecoveryEmail', 'tfaAccountRecord', 'tfaShowError', 'tfaVerifyTotp', 'tfaOpenVerify',
    'tfaShowBackupInput', 'tfaCancelVerify', 'tfaSubmitVerify', 'tfaGateLogin'].forEach(function (fn) {
    vm.runInContext(extractFunction(src, fn, where), sandbox);
  });
  // The email-only path is asynchronous and sends mail; it is not under test here.
  vm.runInContext('function tfaBeginEmailLogin(){ throw new Error("email path not expected"); }', sandbox);
  sandbox.el = el;
  return sandbox;
}

/* A stand-in for the authenticator library: one code is right, everything else wrong. */
const FakeOTP = {
  TOTP: function (cfg) {
    this.secret = cfg.secret;
    this.validate = function (o) { return (o.token === '123456' && this.secret === 'JBSWY3DPEHPK3PXP') ? 0 : null; };
  }
};

Object.keys(BUILDS).forEach(function (where) {
  const plain = { id: 'USR-1', username: 'plain', role: 'admin' };
  const guarded = { id: 'USR-2', username: 'guarded', role: 'admin', twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP',
    backupCodes: [{ code: 'AAAA1111', used: false }, { code: 'BBBB2222', used: true }] };

  // No two-step: straight through.
  let s = makeGate(where, { accounts: [plain], OTPAuth: FakeOTP });
  s.acct = plain; s.entered = 0;
  vm.runInContext('tfaGateLogin(acct, function(){ entered++; })', s);
  assert(s.entered === 1 && s.opened.length === 0, where + ': an account without two-step signs straight in');

  // Two-step on: the prompt opens, sign-in waits.
  s = makeGate(where, { accounts: [guarded], OTPAuth: FakeOTP });
  s.acct = guarded; s.entered = 0;
  vm.runInContext('tfaGateLogin(acct, function(){ entered++; })', s);
  assert(s.entered === 0, where + ': a two-step account does not sign in before a code is given');
  assert(s.opened.length === 1 && s.opened[0] === 'tfaVerifyModal', where + ': the two-step prompt is what opens');
  assert(s.group.style.display === '', where + ': the 6-digit code field is shown when the authenticator library is present');

  // Wrong code stays put; right code signs in.
  s.el('tfaVerifyCode').value = '000000';
  vm.runInContext('tfaSubmitVerify()', s);
  assert(s.entered === 0 && s.closed.length === 0, where + ': a wrong authenticator code is refused');
  s.el('tfaVerifyCode').value = '123456';
  vm.runInContext('tfaSubmitVerify()', s);
  assert(s.entered === 1 && s.closed[0] === 'tfaVerifyModal', where + ': the right authenticator code finishes the sign-in');

  // Backup code path: a used code is refused, an unused one works once and is burned.
  s = makeGate(where, { accounts: [guarded], OTPAuth: FakeOTP });
  guarded.backupCodes[0].used = false;
  s.acct = guarded; s.entered = 0;
  vm.runInContext('tfaGateLogin(acct, function(){ entered++; }); tfaShowBackupInput();', s);
  s.el('tfaVerifyBackup').value = 'bbbb2222';
  vm.runInContext('tfaSubmitVerify()', s);
  assert(s.entered === 0, where + ': an already-used backup code is refused');
  s.el('tfaVerifyBackup').value = 'aaaa1111';
  vm.runInContext('tfaSubmitVerify()', s);
  assert(s.entered === 1, where + ': an unused backup code finishes the sign-in');
  assert(guarded.backupCodes[0].used === true && s.saved === 1, where + ': the backup code is burned and the accounts are saved');
  assert(typeof guarded.twoFactorUpdatedAt === 'string', where + ': the burn is stamped so it travels to other devices');

  // Authenticator library missing: the prompt still opens, driven to backup codes.
  s = makeGate(where, { accounts: [guarded] });
  s.acct = guarded; s.entered = 0;
  vm.runInContext('tfaGateLogin(acct, function(){ entered++; })', s);
  assert(s.opened[0] === 'tfaVerifyModal' && s.entered === 0, where + ': without the library the prompt still opens');
  assert(s.el('tfaBackupSection').style.display === 'block' && s.group.style.display === 'none',
    where + ': without the library the user is sent straight to backup-code entry');

  // Cancelling clears the pending sign-in.
  vm.runInContext('tfaCancelVerify()', s);
  assert(vm.runInContext('tfaVerifyAccount === null && tfaVerifyCallback === null', s), where + ': cancelling forgets the pending sign-in');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
