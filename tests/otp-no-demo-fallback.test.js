/* A password-reset code is never shown on screen.

   What happened (comms-04 / accounts-17 in the audit, reproduced on the
   extracted functions of all eight copies): School Fee, the Staff Time Clock,
   Payslips and the time clock inside the dashboard each had a "demo mode":
   whenever the e-mail carrying a reset code could not be sent — and anybody
   can make it fail by switching the Wi-Fi off, blocking the e-mail service in
   the browser or using up its free quota; on the Offline System it ALWAYS
   fails — the page printed the code. Type the bursar's address into "Forgot
   password", read the code off the screen, set a new password, own the fee
   ledger. The dashboard's own sendEmailOtp printed it whenever the e-mail
   library was missing.

   Pinned here, for the root pages (the Offline System copies are regenerated
   from them by the offline generator, so they are reported, not failed): the
   real sendOTPViaEmail of each page, run with an e-mail service that rejects
   and with none at all, never puts the code in an alert — it tells the person
   to contact the administrator — and the dashboard's sendEmailOtp answers
   'send-failed' instead of showing a code.

   Run: node tests/otp-no-demo-fallback.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const ROOT = path.join(__dirname, '..');
function extractFunction(src, name, where) {
  const re = new RegExp('(?:async\\s+)?function ' + name + '\\(');
  const m = re.exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

const OTP = '493817';
async function run(where, src, emailjs) {
  const alerts = [], steps = [];
  const sb = { console: { log: function () {}, error: function () {} }, alert: function (m) { alerts.push(String(m)); },
    window: { EMAILJS_PUBLIC_KEY: 'k', EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't' },
    showOTPStep: function () { steps.push(1); }, currentOTP: OTP };
  if (emailjs) sb.emailjs = emailjs;
  vm.createContext(sb);
  const fns = ['sendOTPViaEmail', 'otpSendFailed'].map(function (n) { return extractFunction(src, n, where); }).join('\n');
  vm.runInContext(fns, sb);
  vm.runInContext("sendOTPViaEmail('bursar@cestis.org', '" + OTP + "', 'Bursar')", sb);
  await new Promise(function (r) { setTimeout(r, 10); });
  return { alerts: alerts, steps: steps, otpLeft: sb.currentOTP };
}

(async function () {
  console.log('The four sibling copies never show the code when e-mail fails');
  const files = ['School.Fee.html', 'Staff.Clock.in.html', 'Staff.Payslip.html', 'index.html'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert(src.indexOf('showDemoOTP') === -1 && !/Falling back to demo mode/.test(src), f + ': the demo fallback is gone');
    const rejecting = { send: function () { return Promise.reject({ text: 'network' }); } };
    let r = await run(f, src, rejecting);
    assert(r.alerts.length > 0 && r.alerts.every(function (a) { return a.indexOf(OTP) === -1; }), f + ': a failed send never puts the code in front of anyone');
    assert(r.alerts.some(function (a) { return /contact the administrator/i.test(a); }), f + ': it sends the person to the administrator instead');
    assert(r.steps.length === 0, f + ': and does not open the "enter the code" step');
    assert(r.otpLeft === null, f + ': the unsent code is discarded');
    r = await run(f, src, null);
    assert(r.alerts.every(function (a) { return a.indexOf(OTP) === -1; }) && r.steps.length === 0, f + ': with no e-mail service at all, the same');
  }
  const offline = files.filter(function (f) {
    try { return fs.readFileSync(path.join(ROOT, 'Offline System', f), 'utf8').indexOf('showDemoOTP') !== -1; } catch (e) { return false; }
  });
  if (offline.length) console.log('  (Offline System copies still awaiting the offline generator: ' + offline.join(', ') + ')');

  console.log('The dashboard\'s own code sender never shows the code');
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(src.indexOf('DEMO MODE') === -1, 'index.html has no DEMO MODE left');
  const alerts = [];
  const sb = { alert: function (m) { alerts.push(m); }, console: console, _emailOtp: null, EMAIL_OTP_TTL_MS: 600000,
    emailOtpConfigured: function () { return false; }, forgotPwMaskEmail: function (e) { return e; } };
  vm.createContext(sb);
  vm.runInContext(['generateEmailOtp', 'accountRecoveryEmail', 'sendEmailOtp'].map(function (n) { return extractFunction(src, n, 'index.html'); }).join('\n'), sb);
  const res = await vm.runInContext("sendEmailOtp({ id: 'U', email: 'admin@cestis.org' }, 'reset')", sb);
  assert(res && res.ok === false && res.reason === 'send-failed', 'with no e-mail library it reports a failed send');
  assert(alerts.length === 0 && sb._emailOtp === null, 'and neither shows nor keeps a code');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
