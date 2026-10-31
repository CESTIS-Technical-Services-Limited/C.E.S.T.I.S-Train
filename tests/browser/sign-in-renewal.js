/* The hourly renewal of the sync sign-in, when the browser blocks it — in a
   real browser (owner approved, group F; the operations audit's OPS-11):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/sign-in-renewal.js

   The sync sign-in lasts about an hour and is renewed from a timer and when
   the page comes back into view — never from a click — and a browser may
   block the small window that renewal opens. Here the sign-in client is a
   stand-in that behaves as a pop-up blocker does: its window opens only
   while a person's press is being handled (a trusted click or key), and
   otherwise fails with "popup_failed_to_open". With the Centre's shared files an in-memory
   stand-in (tests/browser/fake-drive.js):
     1. the timer's renewal is blocked: a small "Reconnect" button appears
        beside the sync control;
     2. the sign-in then runs out (the shared files refuse the old one): the
        work done meanwhile is kept on the PC — in its store, marked "not yet
        sent" — and the panel says to press Reconnect;
     3. pressing Reconnect renews from that press: the new sign-in arrives,
        the button goes, and the kept work reaches the shared copy;
     4. how signing in itself works is unchanged (Turn On Sync opens the same
        sign-in as before).
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { try { if (await fn()) return true; } catch (e) {} await wait(every || 400); } return false; }

// The sign-in client, as a browser lets it behave: its window opens only from a press.
const GSI_STUB = `(function(){
  window.__gsi = { log: [], n: 0 };
  window.google = window.google || {};
  google.accounts = google.accounts || {};
  google.accounts.oauth2 = {
    initTokenClient: function (cfg) {
      return { requestAccessToken: function (o) {
        // Inside a person's press (a trusted click or key, handled right now) — as a pop-up blocker asks.
        var ev = window.event, g = window.__gsi;
        var active = !!(ev && ev.isTrusted && /^(click|keydown|keyup|mouseup|pointerup|touchend)$/.test(ev.type));
        g.log.push({ scope: cfg.scope, prompt: o && o.prompt, active: active, at: Date.now() });
        if (!active) { setTimeout(function () { if (cfg.error_callback) cfg.error_callback({ type: 'popup_failed_to_open', message: 'Failed to open popup window' }); }, 30); return; }
        g.n++;
        setTimeout(function () { cfg.callback({ access_token: 'ya29.fake-renewed-' + g.n, expires_in: 3600, scope: cfg.scope, token_type: 'Bearer' }); }, 80);
      } };
    },
    revoke: function (t, cb) { if (cb) cb(); },
    hasGrantedAllScopes: function () { return true; }
  };
})();`;

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  // The shared files refuse a sign-in that has run out.
  let refuse = '';
  const handle = drive.handle.bind(drive);
  drive.handle = async route => {
    const auth = (await route.request().allHeaders()).authorization || '';
    if (refuse && auth === 'Bearer ' + refuse) return route.fulfill({ status: 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }) });
    return handle(route);
  };
  const K = kit.make({ browser, base: srv.base, errors });
  const gsi = (r, u) => (/^https:\/\/accounts\.google\.com\/gsi\/client/.test(u) ? r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_STUB }) : null);
  const mainPhone = () => { const f = Object.values(drive.files).find(f => f.name === 'CESTIS_LMS_BACKUP.json' && f.parents[0] === kit.MAIN_FOLDER); try { return JSON.parse(f.content).data.students.find(s => s.name === 'Kemar Johnson').phone; } catch (e) { return null; } };
  try {
    const ctx = await K.computer({ drive, extraRoute: gsi });
    const A = await K.adminSignedIn(ctx, { label: 'A' });
    ok(await A.evaluate(() => !!(window.google && google.accounts && google.accounts.oauth2 && window.__gsi)), 'the sign-in client is the stand-in');
    ok(await until(() => A.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.uploaded), 90000), 'syncing on PC A');
    ok(await A.evaluate(() => document.getElementById('syncReconnectBtn').hidden), 'no Reconnect while all is well');

    console.log('1. The timer\'s renewal is blocked');
    const n0 = await A.evaluate(() => window.__gsi.log.length);
    if (n0) console.log('    (asked ' + n0 + ' time(s) during the sign-in itself: ' + JSON.stringify(await A.evaluate(() => window.__gsi.log)) + ')');
    await wait(6000);   // a person's press lasts a few seconds in the browser's eyes
    await A.evaluate(() => { CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', new Date(Date.now() + 4 * 60000).toISOString()); _lastSilentRefreshAt = 0; _silentRefreshInFlight = false; });
    ok(await until(() => A.evaluate(n => window.__gsi.log.length > n, n0), 45000, 500), 'within 30 seconds the timer asks for a new sign-in by itself');
    const first = await A.evaluate(n => window.__gsi.log[n], n0);
    ok(first && first.active === false && first.prompt === '', 'not from a press (so the browser blocks its window)');
    ok(await until(() => A.evaluate(() => !document.getElementById('syncReconnectBtn').hidden), 10000), 'a small "Reconnect" button appears beside the sync control');
    const adv = await A.evaluate(() => { refreshSyncChip(); return document.getElementById('syncChipPanelAdvice').textContent; });
    ok(/press Reconnect \(beside this\)/i.test(adv), 'the panel says to press it: "' + adv.replace(/\s+/g, ' ').slice(0, 160) + '"');

    console.log('2. The sign-in runs out; the work is kept on the PC');
    refuse = await A.evaluate(() => googleAccessToken);
    console.log('    (the sign-in that runs out: ' + refuse + ')');
    await A.evaluate(() => CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', new Date(Date.now() - 60000).toISOString()));
    const stopped = await until(() => A.evaluate(() => !isCloudConnected && !googleAccessToken), 60000);
    ok(stopped, 'the next sync is refused: syncing stops (as before)' + (stopped ? '' : ' — ' + JSON.stringify(await A.evaluate(() => ({ c: isCloudConnected, t: googleAccessToken, log: window.__gsi.log, r: _lastAutoSaveResult, tick: !!_autoSaveIntervalId })))));
    await A.evaluate(() => { const t = students.find(s => s.name === 'Kemar Johnson'); t.phone = '876-555-0321'; t.lastModified = new Date().toISOString(); saveState(); });
    await wait(6000);
    const kept = await A.evaluate(() => ({ store: (JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').find(s => s.name === 'Kemar Johnson') || {}).phone, marker: !!CESTISStore.getItem('cestisPendingUpload') }));
    ok(kept.store === '876-555-0321' && kept.marker, 'a change made meanwhile is saved on the PC, marked "not yet sent"');
    ok(mainPhone() !== '876-555-0321', 'and has not reached the shared copy');
    await A.reload({ waitUntil: 'load' });
    await wait(2000);
    const afterReload = await A.evaluate(() => ({ store: (JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').find(s => s.name === 'Kemar Johnson') || {}).phone, marker: !!CESTISStore.getItem('cestisPendingUpload') }));
    ok(afterReload.store === '876-555-0321' && afterReload.marker, 'still kept after a reload');
    // Signed in again on the dashboard (the sync sign-in still run out).
    await A.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById('adminLogin'); if (l && !l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    if (await A.evaluate(() => !currentRole)) {
      await A.fill('#adminUser', kit.ADMIN.user); await A.fill('#adminPass', kit.ADMIN.pass); await A.press('#adminPass', 'Enter');
      await A.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'admin', null, { timeout: 30000 });
      await A.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); });
    }
    await wait(1500);
    const chip = await A.evaluate(() => { refreshSyncChip(); return { btn: !document.getElementById('syncReconnectBtn').hidden, state: document.getElementById('syncChip').dataset.state,
      adv: document.getElementById('syncChipPanelAdvice').textContent }; });
    ok(chip.btn && chip.state === 'attention', 'the chip says sync needs attention, with Reconnect beside it');
    ok(/Press Reconnect/.test(chip.adv), 'and says to press Reconnect');
    ok(mainPhone() !== '876-555-0321', 'still not in the shared copy');

    console.log('3. Reconnect renews from the press');
    const before = await A.evaluate(() => window.__gsi.log.length);
    await A.click('#syncReconnectBtn');
    ok(await until(() => A.evaluate(() => isCloudConnected && /^ya29\.fake-renewed-/.test(googleAccessToken || '')), 20000), 'a new sign-in arrives');
    const press = await A.evaluate(n => window.__gsi.log.slice(n), before);
    ok(press.length >= 1 && press[press.length - 1].active === true && press[press.length - 1].prompt === '', 'asked from the press (the browser lets its window open)');
    ok(await until(() => A.evaluate(() => document.getElementById('syncReconnectBtn').hidden), 10000), 'the Reconnect button goes');
    ok(await until(() => mainPhone() === '876-555-0321', 90000, 1000), 'the change kept on the PC reaches the shared copy');
    ok(await until(() => A.evaluate(() => !CESTISStore.getItem('cestisPendingUpload')), 60000), 'nothing left waiting');
    ok(await A.evaluate(() => Date.parse(CESTISStore.getItem('schoolDashboardGoogleTokenExpiry')) > Date.now() + 50 * 60000), 'the renewed sign-in lasts about an hour');

    console.log('4. Signing in itself is unchanged');
    const turnOn = await A.evaluate(() => (document.querySelector('#cloudNotConnected button') || {}).getAttribute('onclick'));
    ok(/connectToGoogleDrive\(\)/.test(turnOn || ''), 'Turn On Sync opens the same sign-in as before');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
