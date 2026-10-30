/* First-sign-in codes and sign-in slips.

   What happened (office audit OF-4): an intake imported from Excel arrived
   with no passwords; after Approve All 25 trainees were active and 0 could
   sign in; one password took the Administrator ≈25 s (≈10.5 min an intake)
   and Admin Staff could set none; then each had to be handed out.

   What this pins:
     1  CESTISCore.accountAccess (both builds): a code is 10 random digits,
        kept only as its hash; a mark says WHICH password is a code, without
        holding the code; the code is "in force" only while the password is
        still that hash (any new password ends it); her own records at home
        say so as a flag only (the slice card's firstCode), never the code;
     2  the page (index.html): Approve All gives every trainee with no
        password a code; New trainee with no password typed does too; a
        trainee's reset offers a code first; Admin Staff can never give a code
        to a staff login; the codes are saved only as hashes and sent to the
        trainee sign-in at once; ONE slip per trainee (name, username, code,
        link — with its QR code once the trainee sign-in is set up — and three
        steps); the slips dialog says they can be printed only now, and
        closing it forgets the codes;
     3  signing in with a code asks for her own password first, on this
        computer (the existing "set a new password" step) and at home; the
        mark travels with the password it marks between computers.

   Run: node tests/sign-in-slips.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');

/* ---------- 1. The rules ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], C = pair[1], A = C.accountAccess;
  console.log('\n[' + where + '] A code: 10 random digits, kept only as its hash');
  const codes = new Set();
  for (let i = 0; i < 200; i++) { const c = A.makeSignInCode(n => nodeCrypto.randomBytes(n)); assert(/^\d{10}$/.test(c), 'ten digits: ' + c); codes.add(c); }
  assert(codes.size === 200, '200 codes, all different');
  // Bytes 250-255 are thrown away (no digit is likelier than another).
  let calls = 0;
  const fixed = A.makeSignInCode(n => { calls++; return calls === 1 ? Array(n).fill(255) : Array.from({ length: n }, (_, i) => i); });
  assertEq([fixed, calls], ['0123456789', 2], 'biased bytes are never used');
  console.log('[' + where + '] The mark says which password is a code — and nothing else');
  const acct = { id: 'T1', role: 'student', password: 'pbkdf2$210000$' + 'aa'.repeat(16) + '$' + 'bb'.repeat(32) };
  acct.firstSignInCode = A.signInCodeMark(acct.password, '2026-10-30T15:00:00Z');
  assert(A.firstCodeInForce(acct), 'in force while the password is the code\'s hash');
  assert(JSON.stringify(acct.firstSignInCode).indexOf(acct.password) === -1, 'the mark does not hold the hash');
  acct.password = 'pbkdf2$210000$' + 'cc'.repeat(16) + '$' + 'dd'.repeat(32);
  assert(!A.firstCodeInForce(acct), 'any new password ends it — the mark needs no clearing');
  assert(!A.firstCodeInForce({ password: 'x' }) && !A.firstCodeInForce(null) && !A.firstCodeInForce({ password: '', firstSignInCode: { fp: '' } }), 'no mark, no code');
  console.log('[' + where + '] Her own records at home: a flag, never the code');
  const { makeCentre, NOW } = require('./gate-fixture.js');
  const Cn = makeCentre(C);
  const st = JSON.parse(JSON.stringify(Cn.store));
  const me = Cn.trainees[0], other = Cn.trainees[1];
  const u = st.voctrain_users.find(x => x.id === me.acct.id);
  u.firstSignInCode = A.signInCodeMark(u.password, '2026-10-30T15:00:00Z');
  const mine = C.gate.buildSlice(st, me.acct.id, NOW).slice;
  const card = mine.data.voctrain_users[0];
  assert(card.firstCode === true, 'her card says she signed in with a code');
  assert(!('firstSignInCode' in card) && !('password' in card), 'without the mark or any password');
  assert(!('firstCode' in C.gate.buildSlice(st, other.acct.id, NOW).slice.data.voctrain_users[0]), 'another trainee\'s card says nothing');
});

/* ---------- 2. The page ---------- */
const Core = require('../cestis-core.js');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function fn(name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(PAGE);
  if (!m) throw new Error('no ' + name);
  let d = 0;
  for (let i = PAGE.indexOf('{', m.index); i < PAGE.length; i++) { if (PAGE[i] === '{') d++; else if (PAGE[i] === '}') { d--; if (!d) return PAGE.slice(m.index, i + 1); } }
  throw new Error(name);
}
const stmt = (a, b) => { const i = PAGE.indexOf(a); return PAGE.slice(i, PAGE.indexOf(b, i) + b.length); };
const hashOf = pw => 'pbkdf2$210000$' + nodeCrypto.createHash('md5').update('salt' + pw).digest('hex') + '$' + nodeCrypto.createHash('sha256').update(pw).digest('hex');
function page(role, opts) {
  opts = opts || {};
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: (opts.fields || {})[id] || '', innerHTML: '', textContent: '', hidden: false, open: false, style: {} });
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, String, Object, Array, Promise, Uint8Array, CESTISCore: Core,
    window: { crypto: { getRandomValues: a => { nodeCrypto.randomFillSync(a); return a; } } },
    currentRole: role, currentLoggedInUser: { id: role === 'admin' ? 'USR-a' : 'USR-sbrown', name: role === 'admin' ? 'Marcia Thompson' : 'Sheryl Brown' },
    adminStaffAccessSettings: Object.assign({ traineeaccounts: true }, opts.access || {}), systemSettings: opts.settings || { institutionName: 'C.E.S.T.I.S Training Centre' },
    userAccounts: opts.accounts || [], students: [], saved: 0, published: 0, opened: [], closed: [], toasts: [], confirms: [],
    hashPassword: async pw => hashOf(pw), touchAccount(a) { a.updatedAt = '2026-10-30T15:00:00Z'; }, saveUserAccounts() { sb.saved++; }, saveState() {},
    gatePublishSoon() { sb.published++; }, openModal: id => sb.opened.push(id), closeModal: id => sb.closed.push(id), showToast: t => sb.toasts.push(t),
    confirm: m => { sb.confirms.push(m); return true; }, escapeHtml: s => String(s == null ? '' : s).replace(/</g, '&lt;'), localDateStr: () => '2026-10-30',
    gateSiteBase: () => 'https://cestis-centre.example/index.html', gateSignInLink: (u, b) => b + '#gate=abc', gateQrDataUrl: () => 'data:image/png;base64,QR',
    document: { getElementById: el }, els
  };
  vm.createContext(sb);
  vm.runInContext(stmt('var AS_ACCESS_DEFAULTS = {', '};') + '\nvar _slipBatch = null; var _slipDownloaded = false;\n' +
    ['adminStaffAccessDefaults', 'asAccessFor', 'asAccessForMe', 'makeSignInCodeNow', 'giveSignInCode', 'issueSignInCodes', 'signInSlipLink', 'openSignInSlips', 'closeSignInSlips',
      'buildSignInSlipsPdf', 'firstCodeGate', 'homeFirstCodeCheck'].map(fn).join('\n'), sb);
  return sb;
}
(async function () {
  console.log('\n[index.html] Codes for an intake, kept only as hashes, slips to print now');
  {
    const intake = ['Tavia Hylton', 'Romaine Powell', 'Annakay Stewart'].map((n, i) => ({ id: 'USR-SYNC-' + i, name: n, role: 'student', username: n.toLowerCase().replace(' ', '.'), programme: 'Cosmetology', password: '', status: 'active' }));
    const staff = { id: 'USR-ng', name: 'Nadine Gordon', role: 'adminstaff', username: 'ngordon', password: hashOf('Old-1') };
    const sb = page('adminstaff', { accounts: intake.concat([staff]) });
    const slips = await sb.issueSignInCodes(intake.concat([staff]), '3 account(s) approved.');
    assertEq(slips.map(s => s.name), ['Tavia Hylton', 'Romaine Powell', 'Annakay Stewart'], 'one slip per trainee');
    assertEq(staff.password, hashOf('Old-1'), 'Admin Staff never give a code to a staff login');
    slips.forEach((s, i) => {
      const a = intake[i];
      assert(/^\d{10}$/.test(s.code), 'a ten-digit code on the slip');
      assertEq(a.password, hashOf(s.code), 'the account keeps only the code\'s hash');
      assert(JSON.stringify(a).indexOf(s.code) === -1, 'the code itself is nowhere on the account');
      assert(Core.accountAccess.firstCodeInForce(a), 'marked as a first-sign-in code');
    });
    assertEq([sb.saved, sb.published], [1, 1], 'saved, and sent to the trainee sign-in at once');
    assert(sb.opened.indexOf('signInSlipsModal') !== -1 && /3 trainees now sign in with a first-sign-in code/.test(sb.els.slipsWhat.textContent), 'the slips dialog opens, saying what happened');
    assert(/Print the slips now\.<\/strong> The codes are not kept anywhere: once you close this, they cannot be shown again/.test(PAGE), 'and that they can be printed only now');
    sb.closeSignInSlips();
    assert(sb.confirms.length === 1 && /have not been downloaded/.test(sb.confirms[0]), 'closing before downloading asks first');
    assert(vm.runInContext('_slipBatch', sb) === null && sb.els.slipsList.innerHTML === '', 'closed: the codes are forgotten');
  }
  console.log('[index.html] One slip per trainee: name, username, code, the link (and its QR code), three steps');
  {
    const calls = [];
    const fake = function () { return new Proxy({}, { get: (t, k) => k === 'splitTextToSize' ? (s => [String(s)]) : (...a) => { calls.push([k].concat(a)); } }); };
    const slips = [{ name: 'Tavia Hylton', username: 'tavia.hylton', programme: 'Cosmetology', code: '4831295706' }, { name: 'Romaine Powell', username: 'romaine.powell', programme: 'Cosmetology', code: '0730960349' },
      { name: 'Annakay Stewart', username: 'annakay.stewart', programme: 'Cosmetology', code: '9921034456' }, { name: 'Davion Walters', username: 'davion.walters', programme: 'Cosmetology', code: '1029384756' }];
    const sb = page('admin', { settings: { institutionName: 'C.E.S.T.I.S Training Centre', traineeGate: { enabled: true, url: 'https://script.example/exec' } } });
    sb.window.jspdf = { jsPDF: fake };
    sb.buildSignInSlipsPdf(slips);
    const texts = calls.filter(c => c[0] === 'text').map(c => [].concat(c[1]).join(' '));
    slips.forEach(s => ['Tavia Hylton', 'tavia.hylton'].length && assert(texts.indexOf(s.name) !== -1 && texts.indexOf(s.username) !== -1 && texts.indexOf(s.code) !== -1, s.name + ': name, username and code'));
    assert(texts.filter(t => t === 'https://cestis-centre.example/index.html#gate=abc').length === 4, 'the trainee sign-in link on every slip');
    assert(texts.filter(t => /^1\. Open the link above \(or scan the square code\)/.test(t)).length === 4 && texts.filter(t => /^2\. Sign in with your username and the code above\./.test(t)).length === 4 &&
      texts.filter(t => /^3\. Choose your own password when you are asked\. The code then stops working\./.test(t)).length === 4, 'three plain steps on every slip');
    assertEq(calls.filter(c => c[0] === 'addImage').length, 4, 'the QR code on every slip, once the trainee sign-in is set up');
    assertEq(calls.filter(c => c[0] === 'addPage').length, 1, 'three slips to an A4 page, with cut lines');
    assert(!texts.some(t => /google|drive|cloud|server|internet/i.test(t)), 'never a word about where anything is kept');
    const calls2 = []; const fake2 = function () { return new Proxy({}, { get: (t, k) => k === 'splitTextToSize' ? (s => [String(s)]) : (...a) => { calls2.push([k].concat(a)); } }); };
    const off = page('admin');
    off.window.jspdf = { jsPDF: fake2 };
    off.buildSignInSlipsPdf(slips.slice(0, 1));
    assert(calls2.filter(c => c[0] === 'addImage').length === 0 && calls2.some(c => c[0] === 'text' && [].concat(c[1]).join(' ') === 'https://cestis-centre.example/index.html'), 'before the trainee sign-in is set up: the site\'s address, no QR code');
  }
  console.log('[index.html] Where codes are made');
  {
    const aap = fn('approveAllPending');
    assert(/var codeFor = noPw\.filter\(function\(u\) \{ return String\(u\.role \|\| ''\)\.toLowerCase\(\) === 'student'; \}\);[\s\S]*issueSignInCodes\(codeFor/.test(aap), 'Approve All: every trainee with no password');
    assert(/issueSignInCodes\(\[user\], user\.name \+ ' is approved\.'\)/.test(fn('approveUser')), 'one approval of a trainee with no password');
    const cta = fn('createTraineeAccount');
    assert(/var useCode = !password;\s*if\(useCode\) password = makeSignInCodeNow\(\);/.test(cta) && /acct\.firstSignInCode = CESTISCore\.accountAccess\.signInCodeMark\(acct\.password/.test(cta) && /if\(useCode\) openSignInSlips\(/.test(cta),
      'New trainee with no password typed');
    assert(/if\(useCode\) acct\.firstSignInCode = [^;]+;\s*else cachePlaintextPw\(acct, password\);/.test(cta), 'a code is never kept even in memory as a typed password');
    assert(/codeBox\.hidden = String\(user\.role \|\| ''\)\.toLowerCase\(\) !== 'student';/.test(fn('openResetPassword')), 'a trainee\'s reset offers the code first');
    const rv = fn('resetWithSignInCodeVerified');
    assert(/passwordResetRefused\(user\)/.test(rv) && /toLowerCase\(\) !== 'student'/.test(rv) && /issueSignInCodes\(\[user\]/.test(rv), 'only for a trainee, only for somebody who may reset hers');
  }
  console.log('[index.html] Signing in with a code: her own password first');
  {
    const sb = page('student');
    const a = { id: 'T1', role: 'student', password: hashOf('4831295706') };
    a.firstSignInCode = Core.accountAccess.signInCodeMark(a.password, 'x');
    let went = 0, asked = null;
    sb.openForceChangePw = (role, then, why) => { asked = [role, why]; };
    sb.firstCodeGate(a, 'student', () => went++);
    assertEq([asked, went], [['student', 'code'], 0], 'a code in force: "choose your own password" before anything opens');
    asked = null;
    sb.firstCodeGate({ id: 'T2', password: hashOf('Own-Pass-1') }, 'student', () => went++);
    assertEq([asked, went], [null, 1], 'her own password: straight in');
    assert(/firstCodeGate\(userAccount, 'student', function\(\)\{ tfaGateLogin\(/.test(fn('handleStudentClick')), 'the trainee sign-in on this computer goes through it');
    assert(/delete canonical\.firstSignInCode;/.test(fn('forceChangePwSubmit')), 'and her new password ends the code');
    assert(/You signed in with the code on your slip\. Choose your own password now: the code then stops working\./.test(fn('openForceChangePw')), 'in plain words');
    sb.els.homeFirstCodeModal = { id: 'homeFirstCodeModal' };
    assert(sb.homeFirstCodeCheck({ firstCode: true }) === true && sb.opened.indexOf('homeFirstCodeModal') !== -1, 'at home, her records\' flag asks the same');
    assert(sb.homeFirstCodeCheck({}) === false, 'not otherwise');
    assert(/try \{ homeFirstCodeCheck\(acct\); \} catch \(e\) \{\}/.test(fn('gateEnterPortal')), 'when she enters her portal from home');
    assert(/CESTISGate\.changePassword\(\{ oldPassword: code, newPassword: pw \}\)/.test(fn('homeFirstCodeSubmit')), 'through the trainee sign-in\'s own password change, the code typed again (never kept on her device)');
  }
  console.log('[index.html] The mark travels with the password it marks');
  assert(/if \(cloudUser\.firstSignInCode && typeof cloudUser\.firstSignInCode === 'object' &&[\s\S]{0,140}localMatch\.firstSignInCode = cloudUser\.firstSignInCode;/.test(fn('mergeCloudAccounts')),
    'a newer copy brings its mark (an old mark that does not match its password means nothing)');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
