/* Registration from home, and trainee accounts made in the office, in real
   browsers against the REAL trainee gate:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/home-registration.js
                                               (npm run test:browser:home-registration)

   docs/trainee-gate/DESIGN.md §17. The gate is trainee-gate/PASTE-GATE.gs
   itself, in Node `vm` (tests/browser/fake-gate.js), over the SAME in-memory
   shared files the office PC writes through (tests/browser/fake-drive.js),
   at https://script.google.com/macros/s/FAKE/exec. The email account's
   sign-in window is a stand-in that answers with a token the gate's
   tokeninfo knows; everything else outside the machine is cut off.

     A. Admin Staff, in the office, add a trainee's account (Trainee
        Accounts → "+ Add Trainee Account"): it is active at once, says who
        made it, and — the gate on — the trainee's folder "<Name> (<student
        ID>)" appears in the same moment, with her records; she signs in at
        home with the password the office gave her. Admin Staff are never
        offered a staff role.
     B. A new trainee at home, on her phone, from the trainees' link:
        "New trainee? Register with your email account" (today's form is not
        offered), the email account's sign-in, the form (her name from the
        account), "Your registration has reached the office". The shared
        files then hold her registration AND her folder, made together;
        registering again finds the same one. Signing in before approval:
        "awaiting approval".
     C. The office PC collects it: Verify Users shows "Registered from home ·
        email account verified"; the administrator approves; the publisher
        writes her records into the folder made at her registration (no
        second folder; the waiting mark gone).
     D. She signs in at home with her email account, then with her password,
        and sees her own dashboard.
   Light and Dark screenshots when HOME_REG_SHOTS=<dir>. No page errors
   anywhere. Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');

const { TRAINEES, TRAINEE_PASS, MAIN_FOLDER, ADMIN } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.HOME_REG_SHOTS || '';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 300); }
}
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));
const STAFF = { id: 'USR-sbrown', name: 'Sheryl Brown', user: 'sbrown', pass: 'Office-Staff-2026!' };
const NEW = { name: 'Shantelle Barrett', email: 'shantelle.barrett@gmail.com', given: 'Shantelle', family: 'Barrett', prog: 'Welding & Fabrication', phone: '876-555-0147', pass: 'Shantelle-2026' };
const OFFICE_NEW = { name: 'Jhenelle Morgan', email: 'jhenelle.morgan@gmail.com', prog: 'Cosmetology', phone: '876-555-0188', user: '', pass: 'Jhenelle-2026' };

// The email account's sign-in script, as the page loads it: requestAccessToken()
// answers as window.__fakePopup.email, after the stand-in "window" has been
// open for a moment (the token comes from the fake gate's tokeninfo).
const GSI_STUB = `(function(){
  function popup(cfg) {
    var who = window.__fakePopup;
    if (!who) { setTimeout(function(){ cfg.error_callback && cfg.error_callback({ type: 'popup_closed' }); }, 30); return; }
    fetch('https://accounts.google.com/__fake/token?email=' + encodeURIComponent(who.email)).then(function(r){ return r.json(); })
      .then(function(t){ cfg.callback({ access_token: t.access_token, expires_in: 3599, scope: cfg.scope, token_type: 'Bearer' }); });
  }
  window.google = window.google || {};
  google.accounts = google.accounts || {};
  google.accounts.oauth2 = { initTokenClient: function (cfg) { return { requestAccessToken: function () { popup(cfg); } }; }, revoke: function (t, cb) { if (cb) cb(); } };
})();`;

(async function main() {
  const srv = await kit.serve({});
  const base = srv.base;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  /* A computer. opts: { drive (the shared files it syncs through, or none),
     gate, phone (390×844), dsf (device scale), theme, profiles (the email
     accounts' own details, by address), popupDelay (ms) }. */
  async function computer(gate, opts) {
    opts = opts || {};
    const o = opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1366, height: 768 }, deviceScaleFactor: opts.dsf || 1 };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, o));
    const tokens = {};
    ctx._touched = [];
    await ctx.route('**/*', async r => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (u.indexOf('https://accounts.google.com/gsi/client') === 0) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_STUB });
      if (u.indexOf('https://accounts.google.com/__fake/token') === 0) {
        if (ctx._popupDelay) await wait(ctx._popupDelay);
        const email = new URL(u).searchParams.get('email');
        const t = gate.tokenFor(email);
        tokens[t] = email;
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: t }) });
      }
      if (u.indexOf('https://www.googleapis.com/oauth2/v3/userinfo') === 0 && !opts.drive) {
        const auth = String((await r.request().allHeaders()).authorization || '').replace(/^Bearer /, '');
        const email = tokens[auth];
        const p = (opts.profiles || {})[email] || { email };
        return r.fulfill({ status: email ? 200 : 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(Object.assign({ email, email_verified: true }, p)) });
      }
      if (/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(u)) {
        if (opts.drive) return opts.drive.handle(r);
        ctx._touched.push(u);
        return r.abort();
      }
      if (u.indexOf(GATE_URL) === 0) return gate.handle(r);
      return r.abort();
    });
    await ctx.addInitScript(t => { try { localStorage.setItem('cestis_sw_disabled', '1'); if (t === 'light') localStorage.setItem('cestisTheme', 'light'); } catch (e) {} }, opts.theme || 'dark');
    return ctx;
  }
  function watch(page, label) {
    page.on('pageerror', e => errors.push(label + ': ' + String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    return page;
  }
  /* The Centre's records on a staff PC, then that member of staff signed in
     (card: 'admin' | 'adminStaff'), signed in for syncing, the 5-second save
     running. */
  async function staffSignedIn(ctx, who, card, opts) {
    opts = opts || {};
    const page = watch(await ctx.newPage(), opts.label || card);
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(async ({ ADMIN, STAFF, TRAINEES, TRAINEE_PASS, gateOn, GATE, token }) => {
      const now = new Date().toISOString();
      const hash = await hashPassword(TRAINEE_PASS);
      const users = [
        { id: ADMIN.id, name: ADMIN.name, role: 'admin', username: ADMIN.user, email: 'mthompson@example.com', password: await hashPassword(ADMIN.pass), status: 'active', updatedAt: now },
        { id: STAFF.id, name: STAFF.name, role: 'adminstaff', username: STAFF.user, email: 'sbrown@example.com', password: await hashPassword(STAFF.pass), status: 'active', updatedAt: now }];
      const studs = [];
      TRAINEES.forEach(t => {
        users.push({ id: t.id, name: t.name, role: 'student', username: t.user, email: t.user + '@example.com', programme: t.prog, studentDataId: t.sid, password: hash, status: 'active', updatedAt: now });
        studs.push({ id: t.sid, name: t.name, course: t.prog, stage: 'training', email: t.user + '@example.com', gender: 'Female', progress: 40, updatedAt: now });
      });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
      const ss = JSON.parse(CESTISStore.getItem('voctrain_systemSettings') || '{}');
      if (gateOn) ss.traineeGate = { url: GATE, enabled: true, setAt: now, setBy: 'mthompson' };
      CESTISStore.setItem('voctrain_systemSettings', JSON.stringify(ss));
      Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k]));
    }, { ADMIN, STAFF, TRAINEES, TRAINEE_PASS, gateOn: !!opts.gateOn, GATE: GATE_URL, token: driveTokenSeed() });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1300);
    const p = card === 'admin' ? ADMIN : STAFF;
    await page.evaluate(c => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById(c + 'Login'); if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click(); }, card);
    await page.waitForTimeout(200);
    await page.fill('#' + card + 'User', p.user);
    await page.fill('#' + card + 'Pass', p.pass);
    await page.press('#' + card + 'Pass', 'Enter');
    const role = card === 'admin' ? 'admin' : 'adminstaff';
    await page.waitForFunction(r => document.getElementById('appShell').classList.contains('active') && currentRole === r, role, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove());
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      if (!isCloudConnected || !googleAccessToken) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); }
      if (!_autoSaveIntervalId) startAutoSave();
    });
    return page;
  }
  // The accounts list reaches the shared files, and the gate's first check sets it up beside it.
  async function gateSetUp(page, drive, gate) {
    await page.evaluate(() => saveAccountsLedger());
    await until(() => Object.values(drive.files).some(f => f.name === 'CESTIS_ACCOUNTS.json' && f.parents.indexOf(MAIN_FOLDER) !== -1), 15000);
    const h = gate.world.get({ op: 'health' });
    ok(h.ok && h.version === 4 && h.ready.folders && h.ready.ledger, 'the gate (version 4) set itself up beside the accounts list (' + JSON.stringify(h.ready) + ')');
    await page.evaluate(GATE => { systemSettings.traineeGate = { url: GATE, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
    const done = await until(() => page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }), 120000, 500);
    ok(!!done, 'the office PC published everything');
    return JSON.parse(drive.files[Object.keys(drive.files).find(k => drive.files[k].name === 'CESTIS_GATE.json')].content);
  }
  const folderOf = (drive, cfg, acct) => Object.values(drive.files).filter(f => f.parents.indexOf(cfg.traineesId) !== -1 && f.mimeType === 'application/vnd.google-apps.folder' &&
    new RegExp('(^|\\s)acct=' + acct + '(\\s|$)').test(f.description || ''));
  const filesIn = (drive, id) => Object.values(drive.files).filter(f => f.parents.indexOf(id) !== -1);
  async function shot(page, name, opts) {
    if (!SHOTS) return;
    opts = opts || {};
    try {
      await page.evaluate(() => { document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      const file = path.join(SHOTS, name + '.png');
      if (opts.sel) await page.locator(opts.sel).first().screenshot({ path: file, scale: opts.css ? 'css' : 'device' });
      else await page.screenshot({ path: file, scale: opts.css ? 'css' : 'device' });
    } catch (e) { console.log('  (screenshot ' + name + ' not taken: ' + String(e.message).split('\n')[0] + ')'); }
  }
  // Dark, then Light, then as it was. opts.phone: at 390×844 (the page's own
  // scale, @2x on a phone context); else desktop 1366×768 at one pixel per pixel.
  async function shotBoth(page, name, opts) {
    if (!SHOTS) return;
    opts = opts || {};
    const vp = page.viewportSize();
    const was = await page.evaluate(() => cestisThemeIsLight());
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => cestisSetTheme(t), theme);
      if (opts.phone) await page.setViewportSize({ width: 390, height: 844 });
      else if (opts.desktop) await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(350);
      if (opts.scrollTo) await page.evaluate(q => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: 'center' }); }, opts.scrollTo);
      await shot(page, name + '-' + theme, { css: !!opts.desktop, sel: opts.sel });
    }
    await page.setViewportSize(vp);
    await page.evaluate(l => cestisSetTheme(l ? 'light' : 'dark'), was);
    await page.waitForTimeout(150);
  }
  const say = page => page.evaluate(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden ? b.textContent : ''; });
  async function openCard(page) {
    await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 15000 });
    await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
    await page.waitForTimeout(250);
  }
  async function inPortal(page, timeout) {
    await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: timeout || 45000 });
    await page.waitForTimeout(900);
  }
  const onLandingSignedOut = () => {
    const l = document.getElementById('landingPage');
    return document.readyState === 'complete' && !!l && l.style.display !== 'none' && !!window.CESTISGate && !(window.CESTISStore && CESTISStore.namespace);
  };

  /* ================================================================ A */
  console.log('A. Admin Staff add a trainee\'s account in the office: active at once, her folder made in the same moment');
  const driveA = new FakeDrive();
  const gateA = makeFakeGate(driveA, { seed: 'home-reg-A' });
  const officeA = await computer(gateA, { drive: driveA });
  const sp = await staffSignedIn(officeA, STAFF, 'adminStaff', { label: 'admin-staff' });
  const cfgA = await gateSetUp(sp, driveA, gateA);
  const nav = await sp.evaluate(() => Array.from(document.querySelectorAll('#sidebarNav .nav-item')).map(n => n.textContent.trim()));
  ok(nav.some(t => /^Trainee Accounts/.test(t)), 'Admin Staff have "Trainee Accounts" in their sidebar (allowed unless an Administrator turns it off)');
  await sp.evaluate(() => showPage('as-trainee-accounts'));
  await sp.waitForSelector('#vuAddTraineeBtn', { timeout: 15000 });
  await sp.click('#vuAddTraineeBtn');
  await sp.waitForSelector('#addTraineeModal.active', { timeout: 5000 });
  const offered = await sp.evaluate(() => Array.from(document.querySelectorAll('#atProgramme option')).map(o => o.value).filter(Boolean));
  ok(offered.indexOf(OFFICE_NEW.prog) !== -1 && offered.length >= 5, 'the form offers the programmes taking trainees (' + offered.length + ')');
  ok(await sp.evaluate(() => !document.querySelector('#addTraineeModal select#newUserRole') && !/Administrator|Admin Staff|Instructor/.test(document.getElementById('addTraineeModal').innerText)),
    'and no role to choose: a trainee account only');
  await sp.fill('#atName', OFFICE_NEW.name);
  await sp.fill('#atEmail', OFFICE_NEW.email);
  await sp.fill('#atPhone', OFFICE_NEW.phone);
  await sp.selectOption('#atProgramme', OFFICE_NEW.prog);
  await sp.fill('#atPassword', OFFICE_NEW.pass);
  // The New trainee form asks her gender (OF-7).
  await sp.selectOption('#atGender', 'Female');
  await shotBoth(sp, '08-admin-staff-add-trainee-desktop', { desktop: true });
  // Not on a Settings → Users form either: the rule refuses Admin Staff a staff role whatever calls it.
  const staffRole = await sp.evaluate(() => CESTISCore.accountAccess.officeCreateRefusal({ role: currentRole }, { role: 'admin', name: 'Neville Shaw', username: 'nshaw', password: 'Admin-2026!' }, userAccounts));
  ok(staffRole && staffRole.code === 'role', 'Admin Staff cannot create an administrator (' + (staffRole && staffRole.code) + ')');
  const t0 = Date.now();
  await sp.click('#atCreateBtn');
  await sp.waitForFunction(() => !document.getElementById('addTraineeModal').classList.contains('active'), null, { timeout: 15000 });
  const made = await sp.evaluate(n => { const a = userAccounts.find(u => u.name === n); return a ? { id: a.id, status: a.status, role: a.role, by: a.createdByRole, ap: a.approvedBy, apn: a.approvedByName, sid: a.studentDataId, user: a.username, phone: a.phone } : null; }, OFFICE_NEW.name);
  ok(made && made.status === 'active' && made.role === 'student' && made.by === 'adminstaff' && made.ap === 'adminstaff' && made.apn === STAFF.name && made.phone === OFFICE_NEW.phone,
    'an ACTIVE trainee account, made and approved by Admin Staff, by name (' + JSON.stringify(made) + ')');
  const officeSid = Core.stableStudentId({ name: OFFICE_NEW.name, course: OFFICE_NEW.prog });
  ok(made && made.sid === officeSid, 'her trainee record, under the dashboard\'s own student ID (' + (made && made.sid) + ')');
  // The email and telephone typed on the form used to stay on the account:
  // the trainee record had neither and her fee record was made with contact "".
  const officeContact = await until(() => sp.evaluate(sid => {
    const s = students.find(x => x.id === sid);
    const f = (JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]') || []).find(x => x && x.lmsId === sid);
    return s && f ? { email: s.email, phone: s.phone, feeEmail: f.email, feeContact: f.contact } : null;
  }, officeSid), 15000);
  ok(officeContact && officeContact.email === OFFICE_NEW.email && officeContact.phone === OFFICE_NEW.phone && officeContact.feeEmail === OFFICE_NEW.email && officeContact.feeContact === OFFICE_NEW.phone,
    'her email and telephone reach her trainee record and her fee record (' + JSON.stringify(officeContact) + ')');
  const fA = await until(() => { const f = folderOf(driveA, cfgA, made.id); return f.length && filesIn(driveA, f[0].id).some(x => x.name === 'from-centre.json') ? f : null; }, 30000, 250);
  ok(fA && fA.length === 1 && fA[0].name === OFFICE_NEW.name + ' (' + officeSid + ')' && fA[0].description === 'cestis-trainee acct=' + made.id + ' v=1',
    'her folder "' + OFFICE_NEW.name + ' (' + officeSid + ')" is made — with her records — in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  await shotBoth(sp, '08b-admin-staff-trainee-accounts-desktop', { desktop: true });
  // She signs in at home with the password the office gave her (once the
  // gate has read the accounts list again: it looks once a minute).
  await until(() => { const l = Object.values(driveA.files).find(f => f.name === 'CESTIS_ACCOUNTS.json'); return l && JSON.parse(l.content).accounts.some(a => a.id === made.id && a.status === 'active'); }, 15000);
  gateA.world.cache.clear();
  const homeA = await computer(gateA, { phone: true });
  const ha = watch(await homeA.newPage(), 'jhenelle-home');
  await ha.goto(base + LINK, { waitUntil: 'load' });
  await openCard(ha);
  await ha.fill('#studentUser', OFFICE_NEW.email);
  await ha.fill('#studentPass', OFFICE_NEW.pass);
  await ha.press('#studentPass', 'Enter');
  await inPortal(ha).catch(() => {});
  ok(await ha.evaluate(n => typeof currentStudent !== 'undefined' && !!currentStudent && currentStudent.name === n && CESTISStore.namespace === 'g1', OFFICE_NEW.name),
    'she signs in at home, through the gate, into her own portal (' + (await ha.evaluate(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden ? b.textContent : 'no message'; }).catch(() => '')) + ')');
  const listingA = Object.values(driveA.files);
  await homeA.close();

  /* ================================================================ B */
  console.log('B. A new trainee registers at home with her email account; her registration and her folder are made together');
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive, { seed: 'home-reg-B' });
  // The office PC (an administrator; at twice the pixels, for the phone-sized pictures of Verify Users).
  const office = await computer(gate, { drive, dsf: 2 });
  const op = await staffSignedIn(office, ADMIN, 'admin', { label: 'office' });
  const cfg = await gateSetUp(op, drive, gate);
  const cat = filesIn(drive, cfg.registrationsId).find(f => f.name === 'catalogue.json');
  ok(!!cat && Core.gate.reg.catalogueNames(JSON.parse(cat.content)).indexOf(NEW.prog) !== -1, 'the programmes taking trainees are published for the registration form');

  const home = await computer(gate, { phone: true, profiles: { [NEW.email]: { name: NEW.name, given_name: NEW.given, family_name: NEW.family } } });
  const hp = watch(await home.newPage(), 'shantelle-home');
  await hp.goto(base + LINK, { waitUntil: 'load' });
  await openCard(hp);
  const card = await hp.evaluate(() => ({ gate: document.body.classList.contains('gate-trainee'),
    reg: getComputedStyle(document.querySelector('#studentCard .gate-register-link')).display, today: getComputedStyle(document.querySelector('#studentCard .today-register-link')).display,
    text: document.querySelector('#studentCard .gate-register-link').textContent.trim() }));
  ok(card.gate && card.reg !== 'none' && card.today === 'none', 'the trainee card offers registering with her email account, and not today\'s form (' + JSON.stringify(card) + ')');
  ok(card.text === 'New trainee? Register with your email account', '"' + card.text + '"');
  await shotBoth(hp, '01-register-button-phone', { phone: true, scrollTo: '#studentCard .gate-register-link' });
  // Today's form, asked for directly, goes the same way (never a registration that stays on the phone).
  home._popupDelay = SHOTS ? 4000 : 1200;
  await hp.evaluate(email => { window.__fakePopup = { email }; }, NEW.email);
  await hp.evaluate(() => openRegistrationModal('student'));
  const waiting = await until(() => say(hp).then(t => /Waiting for your email account/.test(t) ? t : ''), 5000, 50);
  ok(!!waiting && !(await hp.$('#regModalOverlay')), 'her email account\'s sign-in opens ("' + waiting + '") — today\'s form does not');
  await shotBoth(hp, '02-email-account-step-phone', { phone: true, scrollTo: '#studentLoginError' });
  await hp.waitForSelector('#gateRegModal', { timeout: 20000 });
  home._popupDelay = 0;
  const form = await hp.evaluate(() => ({ name: document.getElementById('grName').value, email: document.getElementById('grEmail').textContent,
    progs: Array.from(document.querySelectorAll('#grProgramme option')).map(o => o.value).filter(Boolean) }));
  ok(form.name === NEW.name && form.email === NEW.email, 'the form: her name from her account, her address as it is (' + JSON.stringify({ name: form.name, email: form.email }) + ')');
  ok(form.progs.indexOf(NEW.prog) !== -1, 'with the programmes taking trainees (' + form.progs.length + ')');
  // A password too weak is said in the form.
  await hp.selectOption('#grProgramme', NEW.prog);
  await hp.fill('#grPhone', NEW.phone);
  await hp.fill('#grPassword', 'short');
  await hp.fill('#grPassword2', 'short');
  // Her personal details are asked too (OF-3): without them nothing is sent.
  await hp.click('#grSend');
  ok(/choose Female or Male/.test(await hp.evaluate(() => document.getElementById('grSay').textContent)), 'her gender is asked before anything is sent');
  await hp.selectOption('#grGender', 'Female');
  await hp.fill('#grDob', '2005-02-14');
  await hp.fill('#grTrn', '123 456 789');
  await hp.fill('#grAddress', '4 Hope Road, Kingston 6');
  await hp.fill('#grEmergencyName', 'Paulette Barrett');
  await hp.fill('#grEmergencyPhone', '876-555-0145');
  await hp.click('#grSend');
  ok(/at least 6 characters/.test(await hp.evaluate(() => document.getElementById('grSay').textContent)), 'a weak password is said in the form, nothing sent');
  await hp.fill('#grPassword', NEW.pass);
  await hp.fill('#grPassword2', NEW.pass);
  await hp.evaluate(() => { document.getElementById('grSay').textContent = ''; });
  await shotBoth(hp, '03-registration-form-phone', { phone: true });
  const filesBefore = Object.keys(drive.files).length;
  await hp.click('#grSend');
  await hp.waitForSelector('#pendingApprovalScreen', { timeout: 20000 });
  const pend = await hp.evaluate(() => ({ state: document.getElementById('pendingApprovalScreen').getAttribute('data-state'), msg: document.getElementById('pendingApprovalMsg').textContent,
    text: document.getElementById('pendingApprovalScreen').innerText }));
  ok(pend.state === 'sent' && /Your registration has reached the office/.test(pend.msg), 'the pending screen: "' + pend.msg.slice(0, 60) + '…"');
  ok(/shantelle\.barrett@gmail\.com/.test(pend.text) && /Welding & Fabrication/.test(pend.text), 'with her address and programme');
  await shotBoth(hp, '04-reached-the-office-phone', { phone: true });
  const acct = Object.values(drive.files).filter(f => /^CESTISREG\./.test(f.name));
  ok(acct.length === 1 && acct[0].parents[0] === cfg.registrationsId, 'the shared files hold her registration, in Registrations/ (' + (acct[0] && acct[0].name) + ')');
  const reg = JSON.parse(acct[0].content);
  const regSid = Core.stableStudentId({ name: NEW.name, course: NEW.prog });
  const folders = folderOf(drive, cfg, reg.accountId);
  ok(folders.length === 1 && folders[0].name === NEW.name + ' (' + regSid + ')', 'AND her folder in Trainees/, "' + (folders[0] && folders[0].name) + '"');
  ok(folders[0] && folders[0].description === 'cestis-trainee acct=' + reg.accountId + ' v=1 registration=pending', 'described by her account, marked waiting (' + (folders[0] && folders[0].description) + ')');
  ok(Object.keys(drive.files).length === filesBefore + 2, 'made together, by the one request (two new items)');
  ok(/^pbkdf2\$210000\$/.test(reg.password) && JSON.stringify(reg).indexOf(NEW.pass) === -1 && reg.googleVerified === true && reg.phone === NEW.phone,
    'the password only as its check; her address verified; her phone');
  ok(home._touched.length === 0, 'her phone never asked for the shared files (' + home._touched.join(', ') + ')');
  // (The shared files as they are now — her registration waiting — for the listing below.)
  const atRegistration = JSON.parse(JSON.stringify(drive.files));
  // Registering again: the same registration.
  await hp.evaluate(() => closePendingScreen());
  await hp.evaluate(email => { window.__fakePopup = { email }; }, NEW.email);
  await hp.click('#studentCard .gate-register-link');
  await hp.waitForSelector('#pendingApprovalScreen', { timeout: 20000 });
  ok(await hp.evaluate(() => document.getElementById('pendingApprovalScreen').getAttribute('data-state') === 'sent'), 'registering again: "it has reached the office" — the same one');
  ok(Object.values(drive.files).filter(f => /^CESTISREG\./.test(f.name)).length === 1 && folderOf(drive, cfg, reg.accountId).length === 1, 'still one registration and one folder');
  await hp.evaluate(() => closePendingScreen());

  /* ================================================================ C */
  console.log('C. The office collects it; Verify Users shows it; the administrator approves');
  await op.evaluate(() => { GATE_LIMITS.collectMs = 1000; return gateCollectTick({ refetch: true }); });
  const got = await until(() => op.evaluate(id => { const a = userAccounts.find(u => u.id === id); return a ? { status: a.status, via: a.registeredVia, g: a.googleVerified, f: a.gateFolderId, phone: a.phone } : null; }, reg.accountId), 20000);
  ok(got && got.status === 'pending' && got.via === 'home-registration' && got.g === true && got.f === folders[0].id && got.phone === NEW.phone,
    'collected: a pending trainee account, from home, verified, carrying her folder (' + JSON.stringify(got) + ')');
  await op.evaluate(() => showPage('verify-users'));
  await op.waitForSelector('#verifyUsersTableBody .vu-home-note', { timeout: 15000 });
  const row = await op.evaluate(() => Array.from(document.querySelectorAll('#verifyUsersTableBody tr')).map(r => r.innerText.replace(/\s+/g, ' ')).find(t => /Shantelle Barrett/.test(t)) || '');
  ok(/Registered from home · email account verified/.test(row) && /shantelle\.barrett@gmail\.com/.test(row) && /876-555-0147/.test(row), 'Verify Users: "Registered from home · email account verified" (' + row.slice(0, 140) + ')');
  ok(/Born 2005-02-14/.test(row) && /TRN 123-456-789/.test(row) && /Emergency: Paulette Barrett 876-555-0145/.test(row), 'and her personal details, for the office to check (OF-3)');
  ok(await op.evaluate(() => (document.getElementById('pendingUsersBadge') || {}).textContent === '1'), 'and the sidebar counts it');
  await shotBoth(op, '05-verify-users-home-registration-phone', { phone: true, scrollTo: '#verifyUsersTableBody' });
  // On a phone the table scrolls sideways inside its card (the name column stays): its Activate and Reject.
  if (SHOTS) {
    await op.setViewportSize({ width: 390, height: 844 });
    await op.evaluate(() => { const w = document.getElementById('verifyUsersTableBody').closest('.table-wrapper'); if (w) w.scrollLeft = w.scrollWidth; });
    await shotBoth(op, '05c-verify-users-actions-phone', { phone: true, scrollTo: '#verifyUsersTableBody' });
    await op.evaluate(() => { const w = document.getElementById('verifyUsersTableBody').closest('.table-wrapper'); if (w) w.scrollLeft = 0; });
    await op.setViewportSize({ width: 1366, height: 768 });
  }
  await shotBoth(op, '05b-verify-users-home-registration-desktop', { desktop: true, scrollTo: '#verifyUsersTableBody' });
  // Before approval, signing in at home says so.
  await until(() => { const l = Object.values(drive.files).find(f => f.name === 'CESTIS_ACCOUNTS.json'); return l && JSON.parse(l.content).accounts.some(a => a.id === reg.accountId); }, 15000);
  gate.world.cache.clear();                          // the gate reads the accounts list again (it looks once a minute)
  await hp.evaluate(email => { window.__fakePopup = { email }; }, NEW.email);
  await hp.click('#studentCard .gmail-btn');
  await hp.waitForSelector('#pendingApprovalScreen', { timeout: 20000 });
  ok(await hp.evaluate(() => document.getElementById('pendingApprovalScreen').getAttribute('data-state') === 'waiting'), 'signing in before approval: "awaiting approval"');
  await hp.evaluate(() => closePendingScreen());
  // Approved.
  await op.click('#verifyUsersTableBody button:has-text("Activate")');
  const ap = await until(() => op.evaluate(id => { const a = userAccounts.find(u => u.id === id); return a && a.status === 'active' ? { by: a.approvedBy, sid: a.studentDataId } : null; }, reg.accountId), 10000);
  ok(ap && ap.by === 'admin' && ap.sid === regSid, 'approved: active, her trainee record under the student ID her folder was named with (' + JSON.stringify(ap) + ')');
  // Her email and the phone she gave at home reach her trainee record, and the
  // enrolment register shows them (it read "— — —").
  const regContact = await until(() => op.evaluate(sid => { const s = students.find(x => x.id === sid); return s && s.phone ? { email: s.email, phone: s.phone } : null; }, regSid), 10000);
  ok(regContact && regContact.email === NEW.email && regContact.phone === NEW.phone, 'approved: her email and phone are on her trainee record (' + JSON.stringify(regContact) + ')');
  // What she gave at home, on her trainee record and her fee record (OF-3).
  const regDetails = await until(() => op.evaluate(sid => {
    const s = students.find(x => x.id === sid);
    let fee = null; try { fee = JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').find(f => f.lmsId === sid) || null; } catch (e) {}
    return s && fee && fee.emergencyContact ? { gender: s.gender, dob: s.dob, trn: s.trn, address: s.address, feeDob: fee.dateOfBirth, emergency: fee.emergencyContactName + ' ' + fee.emergencyContact } : null;
  }, regSid), 10000);
  ok(regDetails && regDetails.gender === 'Female' && regDetails.dob === '2005-02-14' && regDetails.trn === '123-456-789' && regDetails.feeDob === '2005-02-14' &&
    regDetails.emergency === 'Paulette Barrett 876-555-0145', 'approved: what she gave at home is on her trainee and fee records (' + JSON.stringify(regDetails) + ')');
  await op.evaluate(sid => { showPage('enrolment-registers'); const s = students.find(x => x.id === sid); const c = s && studentCentreRecord(s); if (c) enrolToggleRoster(c.id); }, regSid);
  const regRow = await until(() => op.evaluate(n => { const r = Array.from(document.querySelectorAll('#enrolmentRegistersContent tr')).find(tr => tr.innerText.indexOf(n) !== -1); return r ? r.innerText.replace(/\s+/g, ' ') : null; }, NEW.name), 10000);
  ok(regRow && regRow.indexOf(NEW.phone) !== -1 && regRow.indexOf(NEW.email) !== -1, 'and the enrolment register row shows them (' + regRow + ')');
  await shotBoth(op, '06b-enrolment-register-contact', { scrollTo: '#enrolmentRegistersContent' });
  await op.evaluate(() => showPage('verify-users'));
  const pub = await until(() => { const f = folderOf(drive, cfg, reg.accountId); return f.length === 1 && filesIn(drive, f[0].id).some(x => x.name === 'from-centre.json') && !/registration=/.test(f[0].description) ? f[0] : null; }, 40000, 300);
  ok(pub && pub.id === folders[0].id && pub.name === NEW.name + ' (' + regSid + ')', 'her records are written into the folder made at her registration — no second folder, the waiting mark gone');
  ok(pub && pub.appProperties && pub.appProperties.cestisGate === '1', 'and every office PC now sees it as hers');
  await op.waitForTimeout(500);
  await shotBoth(op, '06-after-approval-phone', { phone: true, scrollTo: '#recentVerifyActions' });

  /* ================================================================ D */
  console.log('D. She signs in at home: with her email account, then with her password');
  await until(() => { const l = Object.values(drive.files).find(f => f.name === 'CESTIS_ACCOUNTS.json'); return l && JSON.parse(l.content).accounts.some(a => a.id === reg.accountId && a.status === 'active'); }, 15000);
  gate.world.cache.clear();
  await hp.evaluate(email => { window.__fakePopup = { email }; }, NEW.email);
  await hp.click('#studentCard .gmail-btn');
  await inPortal(hp);
  const me = await hp.evaluate(() => ({ ns: CESTISStore.namespace, name: currentStudent && currentStudent.name, id: currentStudent && currentStudent.id, users: userAccounts.length, students: students.length,
    who: document.getElementById('sidebarUserName').textContent }));
  ok(me.ns === 'g1' && me.name === NEW.name && me.id === regSid && me.users === 1 && me.students === 1, 'with her email account: her own portal, and nobody else\'s records (' + JSON.stringify(me) + ')');
  await shotBoth(hp, '07-first-sign-in-at-home-phone', { phone: true });
  await hp.evaluate(() => logout());
  await hp.waitForFunction(onLandingSignedOut, null, { timeout: 30000 });
  await openCard(hp);
  await hp.fill('#studentUser', NEW.email);
  await hp.fill('#studentPass', NEW.pass);
  await hp.press('#studentPass', 'Enter');
  await inPortal(hp);
  ok(await hp.evaluate(n => currentStudent && currentStudent.name === n && CESTISStore.namespace === 'g1', NEW.name), 'and with the password she chose at home');

  /* ---- The shared files, as a listing (for the owner's review) ---- */
  if (SHOTS) {
    const lp = watch(await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage(), 'listing');
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const tree = (dr, c, title) => {
      const all = dr.files ? dr.files : dr;
      const kids = id => Object.values(all).filter(f => f.parents.indexOf(id) !== -1 && !f.trashed).sort((a, b) => a.name.localeCompare(b.name));
      const li = (f, depth) => '<tr><td style="padding-left:' + (12 + depth * 22) + 'px">' + (f.mimeType === 'application/vnd.google-apps.folder' ? '📁 ' : '📄 ') + esc(f.name) + '</td><td>' + esc(f.description || '') + '</td><td>' + esc(String(f.createdTime || '').replace('T', ' ').slice(0, 19)) + '</td></tr>';
      let rows = '';
      ['Trainees', 'Registrations'].forEach(n => {
        const id = n === 'Trainees' ? c.traineesId : c.registrationsId;
        rows += li({ name: n + '/', mimeType: 'application/vnd.google-apps.folder', description: '', createdTime: '' }, 0);
        kids(id).forEach(f => { rows += li(f, 1); if (f.mimeType === 'application/vnd.google-apps.folder') kids(f.id).forEach(g => { rows += li(g, 2); }); });
      });
      return '<h2>' + esc(title) + '</h2><table><tr><th>Name</th><th>Description</th><th>Made</th></tr>' + rows + '</table>';
    };
    void listingA;
    await lp.setContent('<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui,sans-serif;margin:20px;color:#1a1a1a;background:#fff}h1{font-size:18px}h2{font-size:15px;margin:18px 0 6px}' +
      'table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f3f3f3}td:nth-child(2){font-family:monospace;font-size:12px;color:#444}</style>' +
      '<h1>The test\'s stand-in for the Centre\'s shared files — CESTIS Trainee Gate (after this run)</h1>' +
      tree(atRegistration, cfg, 'B: the moment her registration was sent from home (Shantelle Barrett) — her registration and her folder, marked waiting') +
      tree(drive, cfg, 'C–D: approved in the office — her records in that same folder, the waiting mark gone') +
      tree(driveA, cfgA, 'A: the account Admin Staff made in the office (Jhenelle Morgan)'));
    await lp.screenshot({ path: path.join(SHOTS, '09-shared-files-listing-desktop.png'), fullPage: true });
  }

  ok(errors.length === 0, 'no page errors — ' + errors.join(' | '));
  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
