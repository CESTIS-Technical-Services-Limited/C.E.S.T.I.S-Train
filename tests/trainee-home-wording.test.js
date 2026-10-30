/* What a trainee at home is told when a password is forgotten, and why her
   certificate's Download button is off.
   Run: node tests/trainee-home-wording.test.js

   What used to go wrong: on a trainee's own phone, Forgot password answered
   'No account found for "x". Use "Sync Now" first, or contact an
   administrator.' — there is no Sync Now for a trainee at home, and her
   account is not on her phone by design. Her My Certificate page said "Sync
   first — the Download button switches on once this computer has synced."
   in the same situation. Neither told her what she CAN do.

   Pinned here, on the dashboard's own forgotPwLookup / forgotPwTraineeSide /
   certDownloadAllowed read from index.html: from the trainee card, on a
   device that signs trainees in from home, or in a home session, the answer
   is "Ask the office to reset your password."; staff keep today's words. In
   a home session the certificate says "Collect your certificate at the
   Centre, or download it here once the office has finished it." — whether
   the download is allowed is unchanged. The wording scan
   (tools/scan-ui-wording.js) is run by tests/ui-no-sync-source-wording.test.js. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}

function forgotPage(opts) {
  const sb = {
    console: console, String: String,
    document: { getElementById: id => (id === 'forgotPwUser' ? { value: 'tameka.richards' } : null),
      body: { classList: { contains: c => (opts.bodyClasses || []).indexOf(c) !== -1 } } },
    forgotPwState: { account: null, role: opts.role || null },
    userAccounts: [], findLoginAccount: async () => null, cloudFetchAccountData: async () => false,
    CESTISCore: { accountAccess: { findAnyRole: () => null } },
    cestisGateSession: () => !!opts.gate,
    toasts: []
  };
  sb.showToast = (m, k) => sb.toasts.push(m);
  vm.createContext(sb);
  vm.runInContext(extractFunction('forgotPwTraineeSide') + '\nasync ' + extractFunction('forgotPwLookup'), sb);
  return sb;
}

(async function () {
  console.log('Forgot password, when this device does not hold the account');
  for (const [label, opts] of [
    ['from the trainee card', { role: 'student' }],
    ['on a trainee\'s own phone that signs in from home', { role: 'student', bodyClasses: ['gate-trainee', 'gate-trainee-only'] }],
    ['on a device that signs trainees in from home, any card', { role: null, bodyClasses: ['gate-trainee'] }],
    ['in a trainee\'s home session', { role: null, gate: true }]
  ]) {
    const sb = forgotPage(opts);
    await vm.runInContext('forgotPwLookup()', sb);
    assert(sb.toasts.length === 1 && sb.toasts[0] === 'Ask the office to reset your password.', label + ': "Ask the office to reset your password." (got ' + JSON.stringify(sb.toasts) + ')');
    assert(!/sync/i.test(sb.toasts.join(' ')), label + ': nothing about syncing');
  }
  {
    const sb = forgotPage({ role: 'instructor' });
    await vm.runInContext('forgotPwLookup()', sb);
    assert(/^No account found for "tameka\.richards"\. Use "Sync Now" first, or contact an administrator\.$/.test(sb.toasts[0] || ''), 'a staff card on a Centre PC keeps today\'s words (it has Sync Now)');
  }

  console.log('The certificate\'s Download button, before this device has the latest');
  // (Home study, T4, supersedes the earlier wording: at home, an issued and
  // approved certificate downloads there and then — no syncing; signed in on
  // the Centre's own network, or not approved yet, the button itself says
  // "Collect your certificate at the Centre".)
  function certPage(gate, kind, approved) {
    const sb = { console: console, certDownloadApprovals: [{ studentId: 'STU-1', approved: approved !== false }], certSyncDone: () => false,
      cestisGateSession: () => gate, CESTISCore: { certs: { isRevoked: () => false } } };
    sb.CESTISGate = { session: () => (gate ? { base: { kind: kind || 'online' } } : null) };
    sb.window = { CESTISGate: sb.CESTISGate };
    vm.createContext(sb);
    vm.runInContext(extractFunction('homeCertLan') + '\n' + extractFunction('certDownloadAllowed'), sb);
    return sb.certDownloadAllowed({ id: 'STU-1', certNo: 'C-1' });
  }
  const home = certPage(true), homeLan = certPage(true, 'lan'), homeNotYet = certPage(true, 'online', false), lab = certPage(false);
  assert(home.allowed === true, 'at home: issued and approved — she downloads it there (' + JSON.stringify(home) + ')');
  assert(homeLan.allowed === false && homeLan.collect === true && homeNotYet.allowed === false && homeNotYet.collect === true,
    'signed in on the Centre\'s own network, or not approved yet: "Collect your certificate at the Centre" (' + JSON.stringify([homeLan, homeNotYet]) + ')');
  assert(![home, homeLan, homeNotYet].some(r => /sync/i.test(r.reason)), 'at home: nothing about syncing');
  assert(lab.allowed === false && /^Sync first/.test(lab.reason), 'on a Centre PC: unchanged (' + lab.reason + ')');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
