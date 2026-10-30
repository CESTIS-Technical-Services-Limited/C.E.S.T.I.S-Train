/* Screenshots of "Keeping the records safe for years" (group F, safety and
   visibility), for the owner — before and after, on a desktop (1366×768)
   and a phone (390×844), in Dark and Light, with made-up names:
     NODE_PATH=/opt/node-tools/node_modules SHOTS_DIR=<folder> node tests/browser/records-safe-shots.js
   "before": point SHOTS_ROOT at a copy of the site before this change and
   set SHOTS_TAG=before (the screens are taken the same way; what the older
   site does not have is simply not there).

   Scenes: the System health card green / amber / red; the storage warning;
   "Storage is full" (office staff and the Administrator); the last-backup
   line and its prompt; the weekly restore's preview; Reconnect; the trainee
   sign-in card's check buttons. The outside world is cut off. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');
const SITE = process.env.SHOTS_ROOT || path.join(__dirname, '..', '..');
const OUT = process.env.SHOTS_DIR || path.join(require('os').tmpdir(), 'records-safe-shots');
const TAG = process.env.SHOTS_TAG || 'after';
const kit = require(path.join(SITE, 'tests', 'browser', 'gate-kit.js'));       // serves that site
const { FakeDrive, driveTokenSeed } = require('./fake-drive');                    // this tree's (copy, quota, full)
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const ONLY = process.env.SHOTS_ONLY ? new RegExp(process.env.SHOTS_ONLY) : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, every) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { try { if (await fn()) return true; } catch (e) {} await wait(every || 400); } return false; }
fs.mkdirSync(OUT, { recursive: true });
const STAFF = { id: 'USR-dbrown', name: 'Donovan Brown', user: 'dbrown', pass: 'Office-Staff-2026!' };
const taken = [];

const GSI = `(function(){
  window.google = window.google || {}; google.accounts = google.accounts || {};
  google.accounts.oauth2 = { initTokenClient: function (cfg) { return { requestAccessToken: function () {
    var ev = window.event; if (!(ev && ev.isTrusted)) { setTimeout(function(){ cfg.error_callback && cfg.error_callback({ type: 'popup_failed_to_open' }); }, 20); return; }
    fetch('https://accounts.google.com/__fake/token', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (t) { cfg.callback({ access_token: t.access_token, expires_in: 3599, scope: cfg.scope }); });
  } }; }, revoke: function (t, cb) { cb && cb(); }, hasGrantedAllScopes: function () { return true; } };
})();`;

(async () => {
  const srv = await kit.serve({ servePaste: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const K = kit.make({ browser, base: srv.base, errors, gateUrl: GATE_URL });
  const variants = [];
  ['desktop', 'phone'].forEach(dev => ['dark', 'light'].forEach(theme => variants.push({ dev, theme })));
  for (const v of variants) {
    const tag = TAG + '-' + v.dev + '-' + v.theme;
    const drive = new FakeDrive();
    drive.files['1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec'] = { id: '1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec', name: 'Master Snapshot', mimeType: 'application/vnd.google-apps.folder', parents: ['CENTRE-ROOT'], createdTime: '2025-01-01T00:00:00.000Z', modifiedTime: '2025-01-01T00:00:00.000Z', version: 1, content: '' };
    const gate = makeFakeGate(drive);
    const extraRoute = (r, u) => {
      if (/^https:\/\/accounts\.google\.com\/gsi\/client/.test(u)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI });
      if (/^https:\/\/accounts\.google\.com\/__fake\/token/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: gate.tokenFor('owner@example.com') }) });
      return null;
    };
    const ctx = await K.computer({ drive, gate, extraRoute, theme: v.theme, phone: v.dev === 'phone', stubTraineeClient: true });
    const A = await K.adminSignedIn(ctx, { label: tag, mutate: async ({ STAFF }) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: STAFF.id, name: STAFF.name, role: 'adminstaff', username: STAFF.user, email: 'dbrown@example.com', password: await hashPassword(STAFF.pass), status: 'active', updatedAt: new Date().toISOString() });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, mutateArg: { STAFF } });
    const has = name => A.evaluate(n => typeof window[n] === 'function', name);
    const after = await has('renderSystemHealthCard');
    await until(() => A.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.uploaded), 90000);
    await wait(1500);
    const clean = () => A.evaluate(() => { document.querySelectorAll('.toast, .cestis-toast, #toastContainer > *').forEach(t => t.remove()); document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); });
    async function shot(name, sel) {
      if (ONLY && !ONLY.test(name)) return;
      await clean();
      const file = path.join(OUT, name + '-' + tag + '.png');
      if (sel) {
        // A tall card: the window made tall enough to hold it whole, then put back.
        const el = await A.$(sel);
        if (el) {
          const vp = A.viewportSize();
          const h = await el.evaluate(e => Math.ceil(e.getBoundingClientRect().height));
          if (h + 160 > vp.height) await A.setViewportSize({ width: vp.width, height: h + 160 });
          await el.scrollIntoViewIfNeeded().catch(() => {}); await wait(350);
          await el.screenshot({ path: file });
          await A.setViewportSize(vp); await wait(200);
        } else await A.screenshot({ path: file });
      } else await A.screenshot({ path: file });
      taken.push(path.basename(file));
      console.log('  ' + path.basename(file));
    }
    const openPanel = () => A.evaluate(() => { const p = document.getElementById('syncChipPanel'); refreshSyncChip(); if (p.hidden) toggleSyncChipPanel(); });
    const closePanel = () => A.evaluate(() => { if (typeof closeSyncChipPanel === 'function') closeSyncChipPanel(); });
    const DAY = 86400000, G = 1073741824;
    // The health card's inputs, as this PC would know them.
    const health = (o) => A.evaluate(({ o, GATE }) => {
      const now = Date.now(), DAY = 86400000, G = 1073741824;
      const label = CESTISCore.backups ? CESTISCore.backups.isoWeek(now - o.weekly * DAY).label : '';
      localStorage.setItem('cestisThisPc_weeklyBackups', JSON.stringify({ doneWeek: CESTISCore.backups ? CESTISCore.backups.isoWeek(now).label : '', checkedAt: new Date(now).toISOString(),
        last: { week: label, at: now - o.weekly * DAY, id: 'wk', name: 'CESTIS-backup-' + label + '.json' }, count: 12 }));
      localStorage.setItem('cestisThisPc_master', JSON.stringify({ savedAt: new Date(now - o.master * 3600000).toISOString(), savedBy: 'mthompson', students: 214, records: 3402 }));
      localStorage.setItem('cestisThisPc_storage', JSON.stringify({ limit: 15 * G, usage: o.storage * G, usageInDriveTrash: (o.trash || 0) * G, at: new Date(now).toISOString() }));
      systemSettings.lastExport = { at: new Date(now - o.exported * DAY).toISOString(), by: 'mthompson' };
      systemSettings.traineeGate = { url: GATE, enabled: true, setAt: new Date(now - 30 * DAY).toISOString(), setBy: 'mthompson' };
      const st = gatePublishedState(gateDevRead('cestisGatePublished', null));
      st.health = o.gateOk ? { ok: true, version: 3, trainees: 214, accepting: true, url: GATE, at: new Date(now - 3600000).toISOString() } : { ok: false, reason: 'no-answer', url: GATE, at: new Date(now - 3600000).toISOString() };
      st.syncedAt = new Date(now - 180000).toISOString(); delete st.waitingSince;
      gateDevWrite('cestisGatePublished', st); gateDevWrite('cestisGatePublishQueue', []);
      _gateRun.cfgMissing = false; _gateRun.lastError = ''; _gateRun.cfgTooNew = false;
      const dev = {};
      const add = (id, name, role, label, ago) => { dev[id] = { by: name.split(' ')[0].toLowerCase(), name, role, label, at: new Date(now - ago).toISOString() }; };
      add('pc-office1', 'Marcia Thompson', 'admin', 'Windows · Chrome', 120000);
      add('pc-office2', 'Donovan Brown', 'adminstaff', 'Windows · Edge', o.silent ? 12 * DAY : 3600000);
      add('pc-lab', 'Andrea Clarke', 'instructor', 'Android · Chrome', 2 * DAY);
      CESTISStore.setItem('voctrain_deviceSaves', JSON.stringify(dev));
      _storageFull = o.full ? { at: now, where: 'save' } : null;
      showPage('dashboard');
      renderSystemHealthCard();
    }, { o, GATE: GATE_URL });

    // ---- The System health card ----
    await A.evaluate(() => { stopAutoSave(); showPage('dashboard'); });
    await wait(600);
    if (after) {
      await health({ weekly: 1, master: 2, storage: 6.1, trash: 0.2, exported: 5, gateOk: true });
      await shot('01-health-card-green', '#systemHealthCard');
      await health({ weekly: 8, master: 30, storage: 12.5, trash: 1.2, exported: 40, gateOk: true, silent: true });
      await shot('02-health-card-amber', '#systemHealthCard');
      await health({ weekly: 16, master: 9 * 24, storage: 14.9, exported: 70, gateOk: false, full: true, silent: true });
      await shot('03-health-card-red', '#systemHealthCard');
      await A.evaluate(() => { _storageFull = null; });
    } else {
      await shot('01-health-card-green', '#mainContent');   // the dashboard as it was: no health card
    }

    // ---- The last-backup line, its prompt, and the storage warning (the Administrator's sync panel) ----
    if (after) await health({ weekly: 1, master: 2, storage: 6.1, exported: 5, gateOk: true });
    await openPanel(); await wait(300);
    await shot('04-last-backup-line');
    await closePanel();
    if (after) {
      await health({ weekly: 8, master: 2, storage: 12.5, trash: 1.2, exported: 5, gateOk: true });
      await openPanel(); await wait(300);
      await shot('05-last-backup-prompt-and-storage-warning');
      await closePanel();
    }
    await A.evaluate(() => { if (!_autoSaveIntervalId) startAutoSave(); });

    // ---- The weekly restore's preview ----
    if (after) {
      await A.evaluate(() => saveMasterSnapshot('shots', true));
      await A.evaluate(() => { localStorage.removeItem('cestisThisPc_weeklyBackups'); _weeklyRun.triedAt = 0; _weeklyRun.last = null; });
      await until(() => A.evaluate(() => !!_weeklyRun.last && !_weeklyRun.busy), 60000);
      await A.evaluate(() => { students = students.filter(s => s.name !== 'Kemar Johnson'); saveState(); });
      await A.evaluate(() => { window.__r = restoreFromWeeklyBackup(); });
      await until(() => A.evaluate(() => !!document.querySelector('.cestis-form-overlay select')), 20000);
      await wait(300);
      await shot('06-weekly-restore-pick');
      await A.click('.cestis-form-overlay .cf-submit');
      await until(() => A.evaluate(() => /Restore from week/.test((document.querySelector('.cestis-form-overlay h3') || {}).textContent || '')), 20000);
      await wait(300);
      await shot('07-weekly-restore-preview');
      await A.click('.cestis-form-overlay .cf-submit');
      await A.evaluate(() => window.__r);
      await wait(800);
    }

    // ---- Storage is full: office staff, then the Administrator ----
    if (!ONLY || ONLY.test('08-storage-full')) {
      const ctxS = await K.computer({ drive, theme: v.theme, phone: v.dev === 'phone' });
      const S = K.watch(await ctxS.newPage(), 'S');
      await S.goto(srv.base + '/index.html', { waitUntil: 'load' });
      await S.evaluate(seed => { Object.keys(seed).forEach(k => CESTISStore.setItem(k, seed[k])); }, driveTokenSeed());
      await S.reload({ waitUntil: 'load' }); await wait(1500);
      await S.evaluate(() => { const l = document.getElementById('adminStaffLogin'); if (!l.classList.contains('active')) document.querySelector('#adminStaffCard .role-enter-btn').click(); });
      await S.evaluate(() => loginPageSync()).catch(() => {});
      await until(() => S.evaluate(() => loginSyncCompleted), 120000);
      await S.evaluate(() => { const l = document.getElementById('adminStaffLogin'); if (!l.classList.contains('active')) document.querySelector('#adminStaffCard .role-enter-btn').click(); });
      await S.fill('#adminStaffUser', STAFF.user); await S.fill('#adminStaffPass', STAFF.pass); await S.press('#adminStaffPass', 'Enter');
      await S.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'adminstaff', null, { timeout: 60000 });
      await S.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); if (!isCloudConnected) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); } if (!_autoSaveIntervalId) startAutoSave(); });
      await until(() => S.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.uploaded), 90000);
      drive.full = true;
      await S.evaluate(() => { const t = students.find(s => s.name === 'Shanique Campbell'); t.phone = '876-555-0777'; t.lastModified = new Date().toISOString(); saveState(); });
      await until(() => S.evaluate(() => (_consecutiveCloudSaveFailures || 0) >= 1 || (typeof cestisStorageIsFull === 'function' && cestisStorageIsFull())), 40000);
      await wait(1200);
      await S.evaluate(() => { document.querySelectorAll('.toast, .cestis-toast, #toastContainer > *').forEach(t => t.remove()); refreshSyncChip(); const p = document.getElementById('syncChipPanel'); if (p.hidden) toggleSyncChipPanel(); });
      await wait(300);
      const f = path.join(OUT, '08-storage-full-office-staff-' + tag + '.png');
      await S.screenshot({ path: f }); taken.push(path.basename(f)); console.log('  ' + path.basename(f));
      await ctxS.close();
      await A.evaluate(() => { const t = students.find(s => s.name === 'Odalys Facey'); t.phone = '876-555-0888'; t.lastModified = new Date().toISOString(); saveState(); });
      await until(() => A.evaluate(() => (_consecutiveCloudSaveFailures || 0) >= 1 || (typeof cestisStorageIsFull === 'function' && cestisStorageIsFull())), 40000);
      await wait(1200);
      await openPanel(); await wait(300);
      await shot('09-storage-full-administrator');
      await closePanel();
      drive.full = false;
      if (after) await A.evaluate(() => cestisStorageRefresh(true));
      await until(() => A.evaluate(() => !(typeof cestisStorageIsFull === 'function' && cestisStorageIsFull()) && (_consecutiveCloudSaveFailures || 0) === 0), 60000);
    }

    // ---- The trainee sign-in card's check buttons ----
    await A.evaluate(GATE => { systemSettings.traineeGate = { url: GATE, enabled: false, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); showPage('settings'); }, GATE_URL);
    await A.waitForSelector('#page-settings .tab');
    await A.evaluate(() => { const t = Array.from(document.querySelectorAll('#page-settings .tab')).find(x => /Trainee Sign-in/.test(x.textContent)); t.click(); });
    await wait(500);
    if (after) {
      await A.click('#gateCheckBtn').catch(() => {});
      await wait(1500);
      await A.click('#gateCheckReach'); await until(() => A.evaluate(() => !!document.getElementById('gateCheck-reach')), 30000);
      await A.click('#gateCheckLarge'); await until(() => A.evaluate(() => /7 MB|largest|even/.test((document.getElementById('gateCheck-large') || {}).textContent || '')), 90000, 800);
      await A.click('#gateCheckEmail'); await until(() => A.evaluate(() => /gate-tone-(ok|bad|warn)/.test((document.getElementById('gateCheck-email') || {}).className || '')), 30000);
      const pop = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
      await A.click('#gateCheckPage'); const p2 = await pop; if (p2) { await p2.waitForLoadState('load').catch(() => {}); await p2.close().catch(() => {}); }
      await A.click('#gateCheckSearch'); await until(() => A.evaluate(() => /gate-tone-(ok|warn|bad)/.test((document.getElementById('gateCheck-search') || {}).className || '')), 30000);
      await shot('10-trainee-sign-in-check-buttons', '#gateChecksBox');
    }
    await shot('11-trainee-sign-in-card', '#gateCard');

    // ---- Reconnect: the sign-in could not renew itself / has run out ----
    await A.evaluate(() => showPage('dashboard'));
    await wait(500);
    const tok = await A.evaluate(() => ({ t: CESTISStore.getItem('schoolDashboardGoogleAccessToken'), e: CESTISStore.getItem('schoolDashboardGoogleTokenExpiry') }));
    await A.evaluate(() => { declareCloudAuthExpired(); });
    await wait(1200);
    await A.evaluate(() => refreshSyncChip());
    await shot('12-reconnect-button-with-notice');
    await A.evaluate(() => { if (typeof dismissCloudNotification === 'function') dismissCloudNotification(); });
    await wait(600);
    await shot('12-reconnect-button');
    await A.evaluate(() => { if (typeof dismissCloudNotification === 'function') dismissCloudNotification(); });
    await wait(500);
    await openPanel(); await wait(300);
    await shot('13-reconnect-panel');
    await closePanel();
    await A.evaluate(t => { CESTISStore.setItem('schoolDashboardGoogleAccessToken', t.t); CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', t.e); }, tok);
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log('\n' + taken.length + ' screenshots in ' + OUT + (errors.length ? '\npage errors: ' + errors.slice(0, 5).join(' | ') : ''));
})().catch(e => { console.error(e); process.exit(1); });
