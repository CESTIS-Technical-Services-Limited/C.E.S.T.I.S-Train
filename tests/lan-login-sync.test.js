/* On the Centre's own network, the sign-in page's "Sync Now" syncs with the
   Centre's server — not with Google.

   Every "Enter as ..." button stays switched off on a device until it has
   synced ("All users must sync before logging in"), unless the device already
   holds accounts from an earlier visit. On the Offline System the button went
   to Google, which a Centre network with no internet never reaches: a device
   that had not signed in there before — a trainee's phone, a new lab PC — was
   locked out for good although it had already pulled the Centre's accounts
   from the Centre's server (only reloading the page let them in). A brand-new
   Centre could not sign its first administrator in at all. The certificate
   portal's own Sync Now already used the Centre's server; this one did not.
   Found by the end-to-end flow test (tests/browser/lms-flows.js).

   The real loginPageSync() and loginPageLanSync() are taken from index.html
   and run with the page's helpers stubbed.

   Run: node tests/lan-login-sync.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const SYNC_SRC = 'async ' + extractFunction(INDEX, 'loginPageLanSync') + '\nasync ' + extractFunction(INDEX, 'loginPageSync');

function page(lan) {
  const log = { status: [], google: 0, loads: 0, enabled: 0 };
  const ctx = {
    console, JSON, Date, Math, Promise, Object, Array, String, setTimeout, clearTimeout,
    loginSyncCompleted: false, isLoginPageSync: false, adminLoginShown: false,
    isCloudConnected: false, googleAccessToken: null,
    CESTISStore: { getItem: () => null, setItem() {}, removeItem() {} },
    updateLoginSyncStatus: (m, t) => log.status.push((t || '') + ':' + m),
    setLoginSyncBtnState() {},
    enableLoginButtons: () => { log.enabled++; },
    applyMaintenanceOverlay() {},
    dismissCloudNotification() {},
    loginPageGoogleAuth: () => { log.google++; return Promise.resolve(null); },
    CESTISPageCloud: lan ? {
      lan: () => Promise.resolve(true),
      loadNow: () => { log.loads++; return Promise.resolve([[]]); },
      lanSynced: () => lan.reachable
    } : { lan: () => Promise.resolve(false) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SYNC_SRC, ctx);
  return { ctx, log, run: () => vm.runInContext('loginPageSync()', ctx) };
}

(async () => {
  console.log('Sync Now on the Centre\'s network reads the Centre\'s server and opens sign-in');
  {
    const p = page({ reachable: true });
    await p.run();
    assert(p.log.loads === 1, 'it pulls from the Centre\'s server');
    assert(p.log.google === 0, 'and never asks for a Google sign-in (there is no internet)');
    assert(p.ctx.loginSyncCompleted === true && p.log.enabled === 1, 'the "Enter as ..." buttons switch on');
    assert(/^success:/.test(p.log.status[p.log.status.length - 1]), 'and the bar says the sync is complete (' + p.log.status.join(' | ') + ')');
    assert(p.ctx.isLoginPageSync === false, 'and the sync is no longer marked as running');
  }

  console.log('With the Centre\'s server out of reach, sign-in stays locked and says why');
  {
    const p = page({ reachable: false });
    await p.run();
    assert(p.ctx.loginSyncCompleted === false && p.log.enabled === 0, 'nothing is unlocked without a successful read');
    // It says what to do, never where the data lives (the owner's rule —
    // tests/ui-no-sync-source-wording.test.js): "Could not sync — try again or ask the office".
    assert(/^error:.*Could not sync.*ask the office/.test(p.log.status[p.log.status.length - 1]) &&
      !/server|network|Centre/i.test(p.log.status.join(' ')), 'the bar says it could not sync and what to do, without naming the server (' + p.log.status.join(' | ') + ')');
    assert(p.log.google === 0, 'still no Google sign-in');
  }

  console.log('Online (no Centre server) the button still goes to Google, as before');
  {
    const p = page(null);
    await p.run();
    assert(p.log.google === 1, 'the Google sign-in is asked for');
    assert(p.ctx.loginSyncCompleted === false, 'and a cancelled sign-in unlocks nothing');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
