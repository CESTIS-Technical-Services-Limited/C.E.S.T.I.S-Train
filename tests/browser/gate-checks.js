/* The setup sheet's live checks, as buttons on the trainee sign-in card —
   in a real browser (owner approved, group F; the operations audit's OPS-4):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/gate-checks.js

   trainee-gate/SETUP.md §3 had the administrator press F12 and paste code
   for four checks. Each is a button now, using the gate's own answers. Here
   the gate is the REAL trainee-gate/PASTE-GATE.gs (tests/browser/fake-gate.js,
   version 3, unchanged) over the same in-memory shared files as the PC:
     1. "This page can reach it" — the plain-text POST (live check 2);
     2. "A large file arrives whole" — 7 MB echoed (live check 3);
     3. "Email sign-in is accepted" — a sign-in from the press, then the
        gate's tokeninfo check (live check 4);
     4. "Open the full check page" — the gate's ✓/✗ page in a new tab, which
        makes the name-search test file; "Files are found by name" then
        finds it (live check 5);
     5. an address that does not answer says so, with what to do;
     6. no line names where anything is kept.
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { try { if (await fn()) return true; } catch (e) {} await wait(every || 400); } return false; }
const FORBIDDEN = /\b(google|drive|cloud|server|gmail|internet|apps?\s*script)\b/i;

(async () => {
  const srv = await kit.serve({ servePaste: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive);
  // The email sign-in window: it opens from a press, and answers with an account the gate's tokeninfo vouches for.
  const GSI = `(function(){
    window.google = window.google || {}; google.accounts = google.accounts || {};
    google.accounts.oauth2 = { initTokenClient: function (cfg) { return { requestAccessToken: function () {
      var ev = window.event; if (!(ev && ev.isTrusted)) { setTimeout(function(){ cfg.error_callback && cfg.error_callback({ type: 'popup_failed_to_open' }); }, 20); return; }
      fetch('https://accounts.google.com/__fake/token', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (t) { cfg.callback({ access_token: t.access_token, expires_in: 3599, scope: cfg.scope }); });
    } }; }, revoke: function (t, cb) { cb && cb(); }, hasGrantedAllScopes: function () { return true; } };
  })();`;
  const extraRoute = (r, u) => {
    if (/^https:\/\/accounts\.google\.com\/gsi\/client/.test(u)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI });
    if (/^https:\/\/accounts\.google\.com\/__fake\/token/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: gate.tokenFor('marcia.owner@example.com') }) });
    return null;
  };
  const K = kit.make({ browser, base: srv.base, errors, gateUrl: GATE_URL });
  try {
    const ctx = await K.computer({ drive, gate, extraRoute, stubTraineeClient: true });
    const A = await K.adminSignedIn(ctx, { label: 'A', gateOn: true });
    await A.evaluate(() => showPage('settings'));
    await A.waitForSelector('#page-settings .tab');
    await A.evaluate(() => { const t = Array.from(document.querySelectorAll('#page-settings .tab')).find(x => /Trainee Sign-in/.test(x.textContent)); t.click(); });
    await A.waitForSelector('#gateChecksBox');
    const buttons = await A.evaluate(() => Array.from(document.querySelectorAll('#gateChecksBox button')).map(b => b.textContent.trim()));
    ok(buttons.join(' | ') === 'This page can reach it | A large file arrives whole | Email sign-in is accepted | Files are found by name | Open the full check page', 'five buttons on the card: ' + buttons.join(' | '));
    const say = kind => A.evaluate(k => { const li = document.getElementById('gateCheck-' + k); return li ? { t: li.textContent, cls: li.className } : null; }, kind);

    console.log('1. This page can reach it (live check 2)');
    await A.click('#gateCheckReach');
    ok(await until(async () => { const r = await say('reach'); return r && /gate-tone-ok/.test(r.cls); }, 30000), (await say('reach') || {}).t || 'no answer');
    ok(gate.calls.some(c => c.op === 'health'), 'it asked the gate itself');

    console.log('2. A large file arrives whole (live check 3)');
    await A.click('#gateCheckLarge');
    ok(await until(async () => { const r = await say('large'); return r && /7 MB/.test(r.t); }, 90000, 800), (await say('large') || {}).t || 'no answer');
    ok(/gate-tone-ok/.test((await say('large') || {}).cls || ''), 'green');

    console.log('3. Email sign-in is accepted (live check 4)');
    await A.click('#gateCheckEmail');
    ok(await until(async () => { const r = await say('email'); return r && /gate-tone-(ok|bad|warn)/.test(r.cls); }, 30000), (await say('email') || {}).t || 'no answer');
    ok(/gate-tone-ok/.test((await say('email') || {}).cls || '') && /accepted/.test((await say('email') || {}).t), 'green: the gate saw this site\'s own sign-in');
    ok(gate.calls.some(c => c.op === 'diag.tokeninfo'), 'through the gate\'s own check');

    console.log('4. The full check page, then the name search (live check 5)');
    await A.click('#gateCheckSearch');
    ok(await until(async () => { const r = await say('search'); return r && /gate-tone-warn/.test(r.cls) && /Open the full check page once/.test(r.t); }, 30000), 'before the check page has run: "not found yet", and what to do');
    const popup = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
    await A.click('#gateCheckPage');
    const page2 = await popup;
    if (page2) { await page2.waitForLoadState('load').catch(() => {}); }
    const text2 = page2 ? await page2.evaluate(() => document.body.innerText).catch(() => '') : '';
    ok(page2 && /Trainee sign-in from anywhere — check/.test(text2) && /Version 3/.test(text2), 'the gate\'s own check page opens in a new tab');
    ok(/new tab/.test((await say('page') || {}).t || ''), 'and the card says what to look for');
    ok(Object.values(drive.files).some(f => f.name === 'CESTISSMOKE.name-check.json'), 'the check page made the name-search test file');
    await A.click('#gateCheckSearch');
    ok(await until(async () => { const r = await say('search'); return r && /gate-tone-ok/.test(r.cls); }, 30000), (await say('search') || {}).t || 'no answer');

    console.log('5. An address that does not answer');
    gate.down = true;
    await A.click('#gateCheckReach');
    ok(await until(async () => { const r = await say('reach'); return r && /gate-tone-bad/.test(r.cls); }, 40000), (await say('reach') || {}).t || 'no answer');
    ok(/Who has access/.test((await say('reach') || {}).t), 'with what to check in the setup sheet');
    gate.down = false;

    console.log('6. No line names where anything is kept');
    const all = await A.evaluate(() => document.getElementById('gateChecksBox').textContent);
    ok(!FORBIDDEN.test(all), 'the checks name no place');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
