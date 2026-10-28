/* The trainee gate's trainee side, in a real browser, against the REAL gate:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/gate-flows.js
                                               (npm run test:browser:gate)

   docs/trainee-gate/DESIGN.md Stage 4. The gate is trainee-gate/PASTE-GATE.gs
   itself, run in Node `vm` (tests/browser/fake-gate.js) over the SAME
   in-memory shared files the staff PC writes through
   (tests/browser/fake-drive.js), answering at
   https://script.google.com/macros/s/FAKE/exec — so the staff PC publishes,
   the gate serves what it published, and the staff PC's collector reads what
   the gate wrote, with nothing staged in between. Everything else outside
   the machine is cut off.

     1. A staff PC publishes (the administrator signs in; the gate's first
        check sets it up; Turn on; the 5-second save publishes).
     2. A phone — empty storage, opened from the trainees' link (#gate=…) —
        signs in by password ("Signing in…", "Getting your records…", her
        dashboard and My Exams), another by their email account, and a third
        with two-step (a wrong code, then the authenticator's).
     3. Each phone's storage — every localStorage key and every IndexedDB
        database, dumped — holds NO other trainee's id, name or email, NO
        account's password check, two-step secret or backup code, and NO
        answer key.
     4. The phone sits a test: the paper is fetched once; the network drops
        mid-test (requests aborted) and the answers are kept and sealed on the
        phone; a second device signs in as her, continues the SAME attempt
        with the SAME deadline, and submits once; the staff PC's collector
        then holds exactly one result. The first phone, back online, sends
        what it kept and learns the test was submitted elsewhere.
     5. A lab PC that holds the Centre's records: a trainee's gate session
        leaves its own storage (the main namespace) byte for byte as it was.
     6. The gate out of reach: the lab PC falls back to today's sign-in; the
        phone refuses, with today's words for it.
     7. The kill switch (a gate-off file next to the page) and Turn off: the
        trainee card is today's again.
     8. Signing out with a submitted test still unsent: the namespace stays,
        and the next session on the phone sends it; staff see one result.
     9. The same against the Centre's own server's /_cestis/gate (the
        Offline System, staff-only on): password sign-in, a test, one result.
   Light and Dark screenshots of every new screen when GATE_FLOWS_SHOTS=<dir>.
   No page errors anywhere. Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const nodeCrypto = require('crypto');
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');
const { crypto: NODE_CRYPTO } = require('../gate-fixture.js');

const { ROOT, TRAINEES, TRAINEE_PASS, QUESTIONS, MAIN_FOLDER } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.GATE_FLOWS_SHOTS || '';
const ONLY = process.env.GATE_FLOWS_ONLY ? new RegExp(process.env.GATE_FLOWS_ONLY, 'i') : null;
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const T = {};
TRAINEES.forEach(t => { T[t.user.split('.')[0]] = t; });   // T.tameka, T.kemar, T.rushane, …
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const BACKUP = 'K7M2Q9X4';
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));

// The provider's sign-in script, as the page loads it: requestAccessToken()
// answers as window.__fakePopup.email with a token the fake gate's tokeninfo knows.
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
  let killFile = false;
  const srv = await kit.serve({ gateOff: () => killFile });
  const base = srv.base;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const K = kit.make({ browser, base, errors, gateUrl: GATE_URL });
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive);

  /* Each device's own line to the gate, which can be cut (requests aborted). */
  function lineTo() {
    const l = { down: false, calls: [], delay: 0 };
    l.handle = async r => {
      l.calls.push(r.request().method());
      if (l.delay) await wait(l.delay);     // a slow connection, to see what is on screen meanwhile
      return l.down ? r.abort('internetdisconnected') : gate.handle(r);
    };
    return l;
  }
  // A trainee's own phone: nothing of the Centre's, never the shared files.
  async function phone(opts) {
    opts = opts || {};
    const line = lineTo();
    const touched = [];
    const ctx = await K.computer({ phone: !opts.desktop, theme: opts.theme, drive: null, gate: line, extraRoute: (r, u) => {
      if (u.indexOf('https://accounts.google.com/gsi/client') === 0) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_STUB });
      if (u.indexOf('https://accounts.google.com/__fake/token') === 0) {
        const email = new URL(u).searchParams.get('email');
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: gate.tokenFor(email) }) });
      }
      if (/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(u)) { touched.push(u); return null; }
      return null;
    } });
    ctx._line = line; ctx._touched = touched;
    return ctx;
  }
  async function open(ctx, label, url) {
    const page = K.watch(await ctx.newPage(), label);
    await page.goto(base + (url || LINK), { waitUntil: 'load' });
    return page;
  }
  // The trainee card, as a person uses it.
  async function traineeSignIn(page, login, pass) {
    await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 15000 });
    await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
    await page.waitForTimeout(150);
    await page.fill('#studentUser', login);
    await page.fill('#studentPass', pass);
    await page.press('#studentPass', 'Enter');
  }
  async function inPortal(page, timeout) {
    await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: timeout || 45000 });
    await page.waitForTimeout(800);
  }
  // Signed out, back on the sign-in page (which reloads on the way: nothing is
  // read until the new page and its scripts are all there).
  const onLandingSignedOut = () => {
    const l = document.getElementById('landingPage');
    return document.readyState === 'complete' && !!l && l.style.display !== 'none' && !!window.CESTISGate && !(window.CESTISStore && CESTISStore.namespace);
  };
  const say = page => page.evaluate(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden ? b.textContent : ''; });
  async function shot(page, name, sel) {
    if (!SHOTS) return;
    try {
      await page.evaluate(() => { document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      const file = path.join(SHOTS, name + '.png');
      if (sel) await page.locator(sel).first().screenshot({ path: file });
      else await page.screenshot({ path: file });
    } catch (e) { console.log('  (screenshot ' + name + ' not taken: ' + String(e.message).split('\n')[0] + ')'); }
  }
  /* A screen in all four ways a trainee may see it: a phone (390×844 @2x)
     and a desktop (1366×768), Dark and Light — the same page, resized and
     re-themed, then put back as it was (the device's own theme setting too).
     sel: scrolled into view first. */
  async function shotAll(page, name, sel) {
    if (!SHOTS) return;
    const vp = page.viewportSize();
    const theme0 = await page.evaluate(() => { try { return { v: localStorage.getItem('cestisTheme'), light: cestisThemeIsLight() }; } catch (e) { return { v: null, light: false }; } });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => cestisSetTheme(t), theme);
      for (const form of ['phone', 'desktop']) {
        await page.setViewportSize(form === 'phone' ? { width: 390, height: 844 } : { width: 1366, height: 768 });
        await page.waitForTimeout(300);
        if (sel) await page.evaluate(q => { const e = document.querySelector(q); if (e) e.scrollIntoView({ block: 'center' }); }, sel);
        await shot(page, name + '-' + form + '-' + theme);
      }
    }
    await page.setViewportSize(vp);
    await page.evaluate(t => { cestisSetTheme(t.light ? 'light' : 'dark'); try { if (t.v == null) localStorage.removeItem('cestisTheme'); else localStorage.setItem('cestisTheme', t.v); } catch (e) {} }, theme0);
    await page.waitForTimeout(150);
  }
  // Everything a device keeps: every localStorage key, every IndexedDB database.
  const dumpDevice = page => page.evaluate(async () => {
    const out = { ls: {}, idb: {} };
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.ls[k] = localStorage.getItem(k); }
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const d of dbs) {
      out.idb[d.name] = await new Promise(resolve => {
        const req = indexedDB.open(d.name);
        req.onsuccess = () => {
          const db = req.result, all = {};
          const names = Array.from(db.objectStoreNames);
          if (!names.length) { db.close(); return resolve(all); }
          const tx = db.transaction(names, 'readonly');
          names.forEach(n => {
            const os = tx.objectStore(n), keys = os.getAllKeys(), vals = os.getAll();
            vals.onsuccess = () => { keys.onsuccess = null; all[n] = {}; (keys.result || []).forEach((k, i) => { const v = vals.result[i]; all[n][String(k)] = typeof v === 'string' ? v : JSON.stringify(v); }); };
          });
          tx.oncomplete = () => { db.close(); resolve(all); };
          tx.onerror = () => { db.close(); resolve(all); };
        };
        req.onerror = () => resolve({ error: String(req.error) });
      });
    }
    return out;
  });
  // Every key a device keeps, with where it is: 'ls:<key>' or 'idb:<database>/<store>/<key>'.
  function dumpEntries(dump) {
    const out = [];
    Object.keys(dump.ls || {}).forEach(k => out.push(['ls:' + k, k + '=' + dump.ls[k]]));
    Object.keys(dump.idb || {}).forEach(db => Object.keys(dump.idb[db] || {}).forEach(st => {
      const o = dump.idb[db][st];
      if (o && typeof o === 'object') Object.keys(o).forEach(k => out.push(['idb:' + db + '/' + st + '/' + k, k + '=' + o[k]]));
      else out.push(['idb:' + db + '/' + st, String(o)]);
    }));
    return out;
  }
  // What a device must never hold of anyone but the trainee signed in on it.
  // opts.allowMain: keys of the main namespace that today's page keeps on any
  // device that opens it (the built-in first-run logins), outside the gate's.
  function privacyScan(dump, me, accounts, opts) {
    opts = opts || {};
    const found = [];
    dumpEntries(dump).forEach(([where, text]) => {
      if (opts.allowMain && opts.allowMain.test(where)) return;
      const hit = what => found.push(what + ' in ' + where);
      TRAINEES.filter(t => t.id !== me.id).forEach(t => {
        [t.id, t.sid, t.name, t.user + '@example.com', t.user].forEach(x => { if (text.indexOf(x) !== -1) hit(t.name + ': ' + x); });
      });
      // (A staff member's name and account id may appear — she wrote the notice the
      // trainee reads, she is in the class's room — never her email or her password check.)
      ['mthompson@example.com'].forEach(x => { if (text.indexOf(x) !== -1) hit('staff account: ' + x); });
      (accounts || []).forEach(a => { if (a.password && text.indexOf(String(a.password).split('$').pop()) !== -1) hit('password check of ' + a.id); });
      if (/pbkdf2\$|\\"password\\":\\"[0-9a-f]{64}|"password":"[0-9a-f]{64}/.test(text)) hit('a stored password check');
      if (text.indexOf(TOTP_SECRET) !== -1) hit('a two-step secret');
      if (text.indexOf(BACKUP) !== -1) hit('a backup code');
      ['correctAnswer', '"pairs"', '\\"pairs\\"', 'distractors', 'tolerance', 'acceptedAnswers'].forEach(x => { if (text.indexOf(x) !== -1) hit('an answer key (' + x + ')'); });
    });
    return found;
  }

  const PLAN = [];
  function section(title, fn) { PLAN.push({ title, fn }); }
  const shared = {};

  /* ------------------------------------------------------------------ 1 */
  section('1. A staff PC publishes', async () => {
    const office = await K.computer({ drive, gate });
    const page = await K.adminSignedIn(office, { label: 'office', mutate: ({ TOTP_SECRET, BACKUP }) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users'));
      const kemar = users.find(u => u.id === 'USR-kjohnson');
      Object.assign(kemar, { twoFactorEnabled: true, twoFactorSecret: TOTP_SECRET, backupCodes: [{ code: BACKUP, used: false }], twoFactorUpdatedAt: new Date().toISOString() });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      // The welding test is open now: started five minutes ago, an hour long.
      const exams = JSON.parse(CESTISStore.getItem('voctrain_exams'));
      const ws = exams.find(e => e.id === 'EXAM-WS3');
      const p = CESTISCore.exams.centreParts(Date.now() - 5 * 60000);
      Object.assign(ws, { date: p.date, time: p.time, duration: 60, shuffleOptions: true, updatedAt: new Date().toISOString() });
      // And the electrical quiz too (section 8).
      Object.assign(exams.find(e => e.id === 'EXAM-EI2'), { date: p.date, time: p.time, duration: 45, updatedAt: new Date().toISOString() });
      // A notice for every trainee, and the welding class's chat room with a message from the office.
      CESTISStore.setItem('voctrain_notifications', JSON.stringify([{ id: 'NOTIF-WF-1', text: 'The workshop is closed on Friday for maintenance.', timestamp: Date.now() - 3600000,
        time: '1 hour ago', read: false, icon: '🔔', type: 'info', forRoles: ['student'] }]));
      const now = new Date().toISOString();
      CESTISStore.setItem('voctrain_chatRooms', JSON.stringify([{ id: 'ROOM-WF', name: 'Welding & Fabrication', icon: '🔥', type: 'class', members: ['USR-mthompson'], createdAt: now, updatedAt: now }]));
      CESTISStore.setItem('voctrain_chatMessages', JSON.stringify({ 'ROOM-WF': [{ id: 'msg-office-1', roomId: 'ROOM-WF', senderId: 'USR-mthompson', senderName: 'Marcia Thompson',
        text: 'Welcome to the welding class room. Ask your questions here.', type: 'text', timestamp: new Date(Date.now() - 600000).toISOString(), readBy: ['USR-mthompson'] }] }));
      CESTISStore.setItem('voctrain_exams', JSON.stringify(exams));
    }, mutateArg: { TOTP_SECRET, BACKUP } });
    // The accounts list reaches the shared files; the gate's first check then sets it up beside it.
    await page.evaluate(() => saveAccountsLedger());
    for (let i = 0; i < 30 && !Object.values(drive.files).some(f => f.name === 'CESTIS_ACCOUNTS.json' && f.parents.indexOf(MAIN_FOLDER) !== -1); i++) await wait(500);
    const h = gate.world.get({ op: 'health' });
    ok(h.ok && h.ready && h.ready.folders && h.ready.ledger && h.ready.trainees === TRAINEES.length, 'the gate set itself up beside the accounts list (' + JSON.stringify(h.ready) + ')');
    await page.evaluate(GATE => { systemSettings.traineeGate = { url: GATE, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
    await page.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }, null, { timeout: 120000, polling: 500 });
    const slices = Object.values(drive.files).filter(f => f.name === 'from-centre.json');
    ok(slices.length === TRAINEES.length, 'every trainee\'s records are published (' + slices.length + ')');
    ok(Object.values(drive.files).some(f => f.name === 'paper.EXAM-WS3.json') && Object.values(drive.files).some(f => f.name === 'key.EXAM-WS3.json'), 'and the open test\'s paper and key');
    shared.office = office; shared.officePage = page;
    shared.accounts = await page.evaluate(() => userAccounts.map(u => ({ id: u.id, password: u.password })));
  });

  /* ------------------------------------------------------------------ 2, 3 */
  section('2. A phone signs in from the link: by password, by email account, with two-step; 3. it keeps nobody else\'s records', async () => {
    // Tameka, by password, on her own phone.
    const ctx = await phone({});
    const page = await open(ctx, 'tameka-phone');
    await page.waitForFunction(() => document.body.classList.contains('gate-trainee'), null, { timeout: 15000 }).catch(() => {});
    const card = await page.evaluate(() => ({
      gate: document.body.classList.contains('gate-trainee'), only: document.body.classList.contains('gate-trainee-only'),
      enter: !document.querySelector('#studentCard .role-enter-btn').disabled, syncBar: getComputedStyle(document.getElementById('loginSyncBar')).display,
      address: localStorage.getItem('cestisGateAddress'), hash: location.hash
    }));
    ok(card.gate && card.enter, 'the trainee card signs in through the gate, no Sync Now needed (' + JSON.stringify(card) + ')');
    ok(card.only && card.syncBar === 'none', 'a trainee\'s own phone is not asked to "Sync before signing in"');
    ok(card.address === GATE_URL && card.hash === '', 'the link\'s address is kept on the phone and taken out of the address bar');
    await page.evaluate(() => document.querySelector('#studentCard .role-enter-btn').click());   // "Enter as Student"
    await page.waitForTimeout(300);
    await shotAll(page, '01-link-opened', '#studentCard');
    // A slow connection, so what she sees meanwhile can be checked (and pictured).
    ctx._line.delay = SHOTS ? 5000 : 600;
    await traineeSignIn(page, T.tameka.user, TRAINEE_PASS);
    const onScreen = () => {
      const b = document.getElementById('gateBootScreen');
      const t = b && !b.hidden ? document.getElementById('gateBootText').textContent : '';
      const s = document.getElementById('studentLoginError');
      return t || (s && !s.hidden ? s.textContent : '') || '';
    };
    const s1 = await page.waitForFunction(f => { const t = (0, eval)('(' + f + ')')(); return /Signing in…/.test(t) ? t : ''; }, onScreen.toString(), { timeout: 15000, polling: 20 }).then(h => h.jsonValue()).catch(() => '');
    ok(s1 === 'Signing in…', 'the trainee sees "Signing in…" (' + s1 + ')');
    await shotAll(page, '02-signing-in', '#studentCard');
    // Then, after the reload into her own namespace, the first time only:
    await page.waitForFunction(() => document.readyState === 'complete' && !!(window.CESTISStore && CESTISStore.namespace), null, { timeout: 30000 }).catch(() => {});
    const s2 = await page.waitForFunction(f => { const t = (0, eval)('(' + f + ')')(); return /Getting your records…/.test(t) ? t : ''; }, onScreen.toString(), { timeout: 20000, polling: 20 }).then(h => h.jsonValue()).catch(() => '');
    ok(s2 === 'Getting your records…', 'then "Getting your records…" (' + s2 + ')');
    await shotAll(page, '02b-getting-your-records');
    ctx._line.delay = 0;
    await inPortal(page);
    const p = await page.evaluate(() => ({ ns: CESTISStore.namespace, who: document.getElementById('sidebarUserName').textContent,
      role: document.getElementById('sidebarUserRole').textContent, autosave: !!_autoSaveIntervalId, students: students.length, users: userAccounts.length }));
    ok(p.ns === 'g1' && p.who === 'Tameka Richards' && /Welding/.test(p.role), 'she is in her own portal, in the gate\'s namespace (' + JSON.stringify(p) + ')');
    ok(!p.autosave && p.students === 1 && p.users === 1, 'no 5-second save; one trainee, one account on the phone');
    await shotAll(page, '03-dashboard');
    await page.evaluate(() => showPage('s-exams'));
    await page.waitForTimeout(1200);
    const exams = await page.evaluate(() => (document.getElementById('studentUpcomingExams') || {}).innerText || '');
    ok(/Welding Safety/.test(exams) && /Take Exam/.test(exams), 'My Exams lists her open test, ready to take (' + exams.replace(/\s+/g, ' ').slice(0, 120) + ')');
    await shotAll(page, '04-my-exams');
    ok(ctx._touched.length === 0, 'the phone never asked for the shared files (' + ctx._touched.length + ')');
    shared.tameka = { ctx, page };
    const d1 = await dumpDevice(page);
    const leak1 = privacyScan(d1, T.tameka, shared.accounts);
    ok(leak1.length === 0, '3. Tameka\'s phone holds nobody else\'s records, no password check, no answer key — found: ' + leak1.join('; '));
    ok(!!d1.idb.CESTIS_KV__g1 && /Tameka Richards/.test(JSON.stringify(d1.idb.CESTIS_KV__g1)), '   (her own records are there, in the gate\'s namespace)');

    // Rushane, with his own email account.
    const ctx2 = await phone({});
    const p2 = await open(ctx2, 'rushane-phone');
    await page.waitForTimeout(10);
    await p2.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided && !!_gateT.base, null, { timeout: 15000 });
    await p2.evaluate(() => { document.querySelector('#studentCard .role-enter-btn').click(); window.__fakePopup = { email: 'rushane.grant@example.com' }; });
    await p2.waitForTimeout(200);
    await p2.click('#studentCard .gmail-btn');
    await inPortal(p2);
    ok(await p2.evaluate(() => CESTISStore.namespace === 'g1' && currentStudent.name === 'Rushane Grant'), 'Rushane signs in with his email account, into his own portal');
    const leak2 = privacyScan(await dumpDevice(p2), T.rushane, shared.accounts);
    ok(leak2.length === 0, '3. Rushane\'s phone holds nobody else\'s records — found: ' + leak2.join('; '));
    ok(ctx2._touched.every(u => /oauth2\/v3\/userinfo/.test(u)) , 'and never the shared files (' + ctx2._touched.join(', ') + ')');
    await ctx2.close();

    // Kemar, with two-step: a wrong code first, then his authenticator's.
    const ctx3 = await phone({});
    const p3 = await open(ctx3, 'kemar-phone');
    await traineeSignIn(p3, T.kemar.user, TRAINEE_PASS);
    await p3.waitForFunction(() => document.getElementById('gateTfaModal').classList.contains('active'), null, { timeout: 20000 });
    const tfa = await p3.evaluate(() => ({ sub: document.getElementById('gateTfaSubtitle').textContent, other: document.getElementById('gateTfaOther').innerText }));
    ok(/authenticator app/.test(tfa.sub) && /backup code/.test(tfa.other), 'two-step asks for the authenticator code, with a backup code as the way out (' + tfa.sub + ' | ' + tfa.other.replace(/\n/g, ' / ') + ')');
    await shotAll(p3, '06-two-step');
    await p3.fill('#gateTfaCode', '000000');
    await p3.click('#gateTfaVerifyBtn');
    await p3.waitForFunction(() => getComputedStyle(document.getElementById('gateTfaError')).display !== 'none', null, { timeout: 15000 });
    ok(/That code is not right/.test(await p3.evaluate(() => document.getElementById('gateTfaError').textContent)), 'a wrong code: "That code is not right. Check it and try again."');
    await shotAll(p3, '07-two-step-wrong-code');
    const code = Core.gate.totp.code(TOTP_SECRET, Date.now(), NODE_CRYPTO);
    await p3.fill('#gateTfaCode', code);
    await p3.click('#gateTfaVerifyBtn');
    await inPortal(p3);
    ok(await p3.evaluate(() => CESTISStore.namespace === 'g1' && currentStudent.name === 'Kemar Johnson'), 'the authenticator\'s code lets Kemar in');
    const d3 = await dumpDevice(p3);
    const leak3 = privacyScan(d3, T.kemar, shared.accounts);
    ok(leak3.length === 0, '3. Kemar\'s phone holds nobody else\'s records, and not his own two-step secret or backup codes — found: ' + leak3.join('; '));
    await ctx3.close();
  });

  /* A lab PC that holds the Centre's records (as after Sync Now): they are in
     its storage before the page first opens. */
  async function labPc(snap, line) {
    const lab = await K.computer({ drive: null, gate: line });
    await lab.addInitScript(s => {
      try { if (localStorage.getItem('__labSeeded')) return; Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); localStorage.setItem('__labSeeded', '1'); } catch (e) {}
    }, snap);
    return lab;
  }
  // Answer the test on a page, by question id, as a person does.
  async function answer(page, qid, how) {
    const i = await page.evaluate(id => currentExamSession.questions.findIndex(q => q.id === id), qid);
    if (how.opt !== undefined) await page.click('#examQ-' + i + ' label[data-opt="' + how.opt + '"]');
    if (how.text !== undefined) await page.fill('#examAns-' + i, how.text);
    await page.waitForTimeout(150);
  }
  async function submitAll(page) {
    await page.locator('button:visible:has-text("Finish attempt")').first().click();
    await page.waitForSelector('#examSubmitAllBtn', { timeout: 10000 });
    await page.click('#examSubmitAllBtn');
    await page.waitForSelector('#examConfirmGo', { timeout: 10000 });
    await page.click('#examConfirmGo');
  }
  const outboxWaiting = page => page.evaluate(() => CESTISGate.status().then(s => s.waiting));
  async function collect(n) {
    const op = shared.officePage;
    for (let i = 0; i < (n || 1); i++) {
      await op.evaluate(() => { _gateRun.collectAt = 0; return gateCollectTick(); });
      await op.waitForFunction(() => !_gateRun.collecting, null, { timeout: 30000 });
    }
  }
  const officeResults = (sid, examId) => shared.officePage.evaluate(([sid, examId]) => examResults.filter(r => r && !r.archived && r.studentId === sid && r.examId === examId).map(r => ({ id: r.id, score: r.score, by: r.markedBy })), [sid, examId]);

  /* ------------------------------------------------------------------ 4 */
  section('4. The phone takes a test; the network drops; a second device carries on; one result', async () => {
    const { ctx, page } = shared.tameka;
    await page.evaluate(() => showPage('s-exams'));
    await page.waitForTimeout(600);
    const papers0 = gate.ops('paper');
    await page.click('#studentUpcomingExams button:has-text("Take Exam")');
    await page.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display === 'block', null, { timeout: 25000 });
    ok(gate.ops('paper') === papers0 + 1, 'the paper is fetched from the gate, once (' + (gate.ops('paper') - papers0) + ')');
    const s1 = await page.evaluate(() => ({ qs: currentExamSession.questions.map(q => q.id).sort().join(), keys: /correctAnswer|"pairs"|tolerance/.test(JSON.stringify(currentExamSession)),
      deadline: currentExamSession.deadline, id: currentExamSession.attemptId, paper: /correctAnswer/.test(JSON.stringify(CESTISGate.storedPaper('EXAM-WS3'))) }));
    ok(s1.qs === 'Q1,Q2,Q3' && !s1.keys && !s1.paper, 'three questions, and no right answer anywhere on the phone (' + s1.qs + ')');
    ok(Math.abs(s1.deadline - (Date.now() + 55 * 60000)) < 2 * 60000, 'the deadline is the window\'s, on the gate\'s clock (' + Math.round((s1.deadline - Date.now()) / 60000) + ' min left)');
    await answer(page, 'Q1', { opt: 0 });
    await shotAll(page, '05-taking-a-test');
    // Saved on the phone at once; the shared copy follows within 30 seconds of
    // a change, and at once when the page is hidden — as here.
    await page.evaluate(() => examPublishNow());
    const laneHas = pred => Object.values(drive.files).filter(f => /^CESTISINBOX\.L-/.test(f.name)).map(f => JSON.parse(f.content))
      .filter(l => l.accountId === T.tameka.id).some(l => (l.records.voctrain_examAttempts || []).some(a => a.id === s1.id && pred(a)));
    let inLane = false;
    for (let i = 0; i < 40 && !inLane; i++) { await wait(500); inLane = laneHas(a => a.answers.some(x => x === 0)); }
    await page.waitForFunction(() => CESTISGate.outbox().then(l => l.length === 0), null, { timeout: 15000, polling: 300 }).catch(() => {});
    const st1 = await page.evaluate(() => CESTISGate.outbox().then(l => l.map(e => e.state + ':' + e.kind + ':' + (e.item && e.item.key) + ':' + (e.reason || ''))));
    ok(inLane && !st1.length, 'the first answer reaches the gate, sealed, into her session\'s own lane (' + st1.join(', ') + ')');
    // The phone's connection to the gate drops.
    ctx._line.down = true;
    await answer(page, 'Q2', { opt: 'true' });
    await page.evaluate(() => { examPublishNow(); return CESTISGate.capture().then(() => CESTISGate.deliver({ force: true })); });
    await page.waitForTimeout(800);
    const w1 = await outboxWaiting(page);
    ok(w1 >= 1, 'with no connection the next answer is kept on the phone, sealed, waiting (' + w1 + ')');
    // A second device: she carries on there.
    const ctx2 = await phone({ desktop: true });
    const p2 = await open(ctx2, 'tameka-desktop');
    await traineeSignIn(p2, T.tameka.user, TRAINEE_PASS);
    await inPortal(p2);
    await p2.evaluate(() => showPage('s-exams'));
    await p2.waitForTimeout(800);
    await p2.click('#studentUpcomingExams button');
    await p2.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display === 'block', null, { timeout: 25000 });
    const s2 = await p2.evaluate(() => ({ id: currentExamSession.attemptId, deadline: currentExamSession.deadline,
      a: currentExamSession.questions.map((q, i) => q.id + '=' + JSON.stringify(currentExamSession.answers[i])).sort().join(' ') }));
    ok(s2.id === s1.id && s2.deadline === s1.deadline, 'the second device continues the SAME attempt with the SAME deadline (' + [s2.id === s1.id, s2.deadline - s1.deadline].join(', ') + ')');
    ok(/Q1=0/.test(s2.a) && /Q2=null/.test(s2.a), 'with the answer that reached the gate, not the one still on the phone (' + s2.a + ')');
    await answer(p2, 'Q2', { opt: 'true' });
    await answer(p2, 'Q3', { text: 'flashback arrestor' });
    await submitAll(p2);
    await p2.waitForFunction(() => { const v = document.getElementById('studentExamResultView'); return v && v.style.display === 'block' && /Passed|Not passed|Awaiting/.test(v.innerText); }, null, { timeout: 30000 });
    const r2 = await p2.evaluate(() => ({ text: document.getElementById('studentExamResultView').innerText, results: examResults.map(r => r.id) }));
    ok(/100%/.test(r2.text) && /Passed/.test(r2.text) && r2.results.length === 1 && /^RES-G-/.test(r2.results[0]), 'one submit: the gate marks it and the result shows at once (' + r2.results.join() + ')');
    ok(await p2.evaluate(() => document.querySelectorAll('#studentExamResultView .r-mark.bad').length === 0 && document.querySelectorAll('#studentExamResultView .r-mark.ok').length >= 2),
      'her right answers are ticked, never crossed, though the key is not on the device');
    ok(/Correct answers will be shown here once the exam has closed/.test(r2.text) && !/flashback arrestor\b.*Correct answer/i.test(r2.text), 'the right answers wait for the test to close');
    await collect(1);
    let res = await officeResults(T.tameka.sid, 'EXAM-WS3');
    ok(res.length === 1 && res[0].score === 100, 'the staff PC\'s collector then holds exactly one result (' + JSON.stringify(res) + ')');
    // The phone comes back: what it kept is sent, and it hears the test was submitted elsewhere.
    ctx._line.down = false;
    await page.evaluate(() => CESTISGate.deliver({ force: true }));
    await page.evaluate(() => gatePullAndApply().then(r => { if (r && r.applied) gateAfterApply(r.applied); }));
    await page.waitForFunction(() => !currentExamSession, null, { timeout: 20000 }).catch(() => {});
    const back = await page.evaluate(() => ({ open: !!currentExamSession, waiting: 0, text: (document.getElementById('studentExamResultView') || {}).innerText || '' }));
    ok(!back.open && /submitted on another device/.test(back.text), 'the phone, back online, closes the attempt: "This test was submitted on another device." (' + back.text.slice(0, 80).replace(/\s+/g, ' ') + ')');
    ok(await outboxWaiting(page) === 0, 'and has nothing left waiting');
    await collect(2);
    res = await officeResults(T.tameka.sid, 'EXAM-WS3');
    ok(res.length === 1, 'staff still see exactly one result (' + res.length + ')');
    const d = await dumpDevice(page);
    const leak = privacyScan(d, T.tameka, shared.accounts);
    ok(leak.length === 0, '3. after the test, still no answer key and nobody else\'s records on the phone — found: ' + leak.join('; '));
    await ctx2.close();
  });

  /* ------------------------------------------------------------------ 4b */
  section('4b. Her other work reaches the office: a notice read, her profile, a support message, coursework, a request, chat', async () => {
    const { ctx, page } = shared.tameka;
    // The bell: "Mark all read".
    await page.evaluate(() => gatePullAndApply().then(r => { if (r && r.applied) gateAfterApply(r.applied); }));
    const bell = await page.evaluate(() => (getFilteredNotifications() || []).map(n => n.id));
    ok(bell.indexOf('NOTIF-WF-1') !== -1, 'the office\'s notice is in her bell (' + bell.join() + ' | mem ' + await page.evaluate(() => JSON.stringify((notifications || []).map(n => n.id))) +
      ' | slice ' + await page.evaluate(() => JSON.stringify(((JSON.parse(CESTISStore.getItem('cestisGateSlice') || '{}').data || {}).voctrain_notifications || []).map(n => n.id))) +
      ' | office ' + await shared.officePage.evaluate(() => JSON.stringify((notifications || []).map(n => n.id))) + ')');
    await page.evaluate(() => markAllNotificationsRead());
    // Her profile: a new phone number.
    await page.evaluate(() => { showPage('s-profile'); openEditStudentProfile(); });
    await page.waitForSelector('#editProfilePhone', { state: 'visible', timeout: 10000 });
    await page.fill('#editProfilePhone', '876-555-0142');
    await page.evaluate(() => saveStudentProfile());
    // A support message, through the support form's own code (the form itself is on the sign-in page).
    await page.evaluate(() => {
      document.getElementById('supportName').value = 'Tameka Richards';
      document.getElementById('supportEmail').value = 'tameka.richards@example.com';
      document.getElementById('supportPhone').value = '876-555-0142';
      const s = document.getElementById('supportSubject'); s.value = s.options[1] ? s.options[1].value : 'Other';
      document.getElementById('supportMessage').value = 'Is the welding practical still on Friday?';
      submitSupportMessage();
    });
    await page.waitForFunction(() => /sent to the Centre/.test((document.getElementById('supportFormSuccess') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    ok(/sent to the Centre/.test(await page.evaluate(() => document.getElementById('supportFormSuccess').textContent)), 'the support message is sent ("' + (await page.evaluate(() => document.getElementById('supportFormSuccess').textContent)).slice(0, 60) + '")');
    await page.evaluate(() => closeModal('supportContactModal'));
    // Coursework: a photo of her butt joint, sent first, then the submission.
    await page.evaluate(() => { showPage('s-assignments'); openSubmitAssignment('ASG-WF-1', 'Butt joint practice piece'); });
    await page.setInputFiles('#submitFileInput', { name: 'butt-joint.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% butt joint photos\n') });
    await page.evaluate(() => { document.getElementById('submitComment').value = 'My butt joint, front and back.'; return submitStudentAssignment(); });
    const sub = await page.evaluate(() => assignmentSubmissions.filter(s => s.assignmentId === 'ASG-WF-1').map(s => ({ files: s.files.length, drive: (s.driveFiles || []).map(f => f.driveFileId) })));
    ok(sub.length === 1 && sub[0].files === 0 && sub[0].drive.length === 1 && !!sub[0].drive[0], 'coursework: the file is sent through the gate first, and the submission names it (' + JSON.stringify(sub) + ')');
    const upFile = Object.values(drive.files).find(f => f.id === (sub[0] && sub[0].drive[0]));
    ok(!!upFile && /butt-joint\.pdf$/.test(upFile.name) && /acct=USR-trichards/.test(upFile.description || ''), 'into her own folder, private (' + (upFile && upFile.name) + ')');
    // A certificate request, from the embedded Transcript / Grades page (another document in the same namespace).
    await page.evaluate(() => showPage('s-transcript-grades'));
    // As a person would: wait for her own view, then press "Request Certificate".
    const tg = page.frameLocator('#sTranscriptGradesFrame');
    const certBtn = tg.locator('button', { hasText: 'Request Certificate' });
    await certBtn.waitFor({ state: 'visible', timeout: 20000 });
    await certBtn.click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('g1::voctrain_certTranscriptRequests') || '[]').some(r => r.type === 'certificate'), null, { timeout: 10000 }).catch(() => {});
    const inFrame = await page.evaluate(() => { const w = document.getElementById('sTranscriptGradesFrame').contentWindow; return { ns: w.CESTISStore && w.CESTISStore.namespace,
      reqs: JSON.parse(localStorage.getItem('g1::voctrain_certTranscriptRequests') || '[]').map(r => r.type + ':' + r.status),
      main: localStorage.getItem('voctrain_certTranscriptRequests') }; });
    ok(inFrame.ns === 'g1' && inFrame.reqs.some(r => /^certificate:pending/.test(r)) && inFrame.main === null, 'the embedded page works in her namespace and keeps the request there (' + inFrame.reqs.join(', ') + ')');
    // Chat: the class room's history comes from the gate, and her reply goes back.
    await page.evaluate(() => showPage('s-lms-chat'));
    await page.waitForFunction(() => (lmsChatMessages['ROOM-WF'] || []).some(m => m.id === 'msg-office-1'), null, { timeout: 30000 }).catch(() => {});
    ok(await page.evaluate(() => (lmsChatMessages['ROOM-WF'] || []).some(m => m.id === 'msg-office-1')), 'chat: the class room\'s history arrives from the gate');
    await page.evaluate(() => { lmsChatOpenRoom('ROOM-WF', 'student'); });
    await page.waitForTimeout(300);
    await page.fill('#studentChatInput', 'Thank you, Miss. See you Friday.');
    await page.evaluate(() => lmsChatSendMessage('student'));
    // All of it sealed and delivered…
    await page.waitForFunction(() => CESTISGate.capture().then(() => CESTISGate.deliver({ force: true })).then(() => CESTISGate.status()).then(s => s.waiting === 0), null, { timeout: 40000, polling: 1500 });
    const refusedHere = await page.evaluate(() => CESTISGate.outbox().then(l => l.filter(e => e.state === 'refused').map(e => (e.item.key || e.item.kind) + ':' + e.reason)));
    ok(refusedHere.length === 0, 'nothing she sent was refused (' + refusedHere.join(', ') + ')');
    // …and the staff PC's collector takes it in.
    await collect(1);
    const office = await shared.officePage.evaluate(sid => ({
      read: ((notifications || []).find(n => n.id === 'NOTIF-WF-1') || {}).readBy || [],
      phone: (studentProfiles[sid] || {}).phone,
      support: (supportMessages || []).filter(m => /welding practical/.test(m.message || '')).map(m => m.accountId),
      subs: (assignmentSubmissions || []).filter(s => s.studentId === sid && s.assignmentId === 'ASG-WF-1').map(s => ((s.driveFiles || [])[0] || {}).driveFileId),
      reqs: JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests') || '[]').filter(r => r.studentId === sid).map(r => r.type + ':' + r.status),
      chat: ((lmsChatMessages || {})['ROOM-WF'] || []).filter(m => m.senderId === 'USR-trichards').map(m => m.text)
    }), T.tameka.sid);
    ok(office.read.indexOf('USR-trichards') !== -1, 'the office sees the notice read by her (' + office.read.join() + ')');
    ok(office.phone === '876-555-0142', 'her new phone number (' + office.phone + ')');
    ok(office.support.length === 1 && office.support[0] === 'USR-trichards', 'her support message, as hers (' + office.support.join() + ')');
    ok(office.subs.length === 1 && office.subs[0] === sub[0].drive[0], 'her coursework, naming the file she sent');
    ok(office.reqs.indexOf('certificate:pending') !== -1, 'her certificate request, from the embedded page (' + office.reqs.join(', ') + ')');
    ok(office.chat.indexOf('Thank you, Miss. See you Friday.') !== -1, 'and her chat reply (' + office.chat.join(' | ') + ')');
  });

  /* ------------------------------------------------------------------ 5, 6 */
  section('5. A lab PC holding the Centre\'s records: a gate session leaves them byte for byte; 6. gate out of reach: the lab PC falls back, the phone refuses', async () => {
    // A lab PC: the Centre's records as the office holds them (after Sync Now).
    const snap = await shared.officePage.evaluate(() => { const o = {}; CESTISStore.keys().forEach(k => { if (!/^g\d+::/.test(k) && !/AccessToken|TokenExpiry|^voctrain_session|cestisGatePublish|cestisGateCollected|cestisPendingUpload/.test(k)) o[k] = CESTISStore.getItem(k); }); return o; });
    const line = lineTo();
    const lab = await labPc(snap, line);
    let page = await open(lab, 'lab', '/index.html');
    await page.waitForTimeout(1500);
    const mainOf = p => p.evaluate(async () => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/^g\d+::/.test(k) && k !== 'cestisGateNs') ls[k] = localStorage.getItem(k); }
      const idb = await new Promise(resolve => { const r = indexedDB.open('CESTIS_KV'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readonly'); const os = tx.objectStore('kv'); const ks = os.getAllKeys(), vs = os.getAll(); tx.oncomplete = () => { const o = {}; ks.result.forEach((k, i) => { o[k] = vs.result[i]; }); db.close(); resolve(o); }; }; r.onerror = () => resolve(null); });
      return JSON.stringify({ ls: Object.keys(ls).sort().map(k => [k, ls[k]]), idb: Object.keys(idb || {}).sort().map(k => [k, idb[k]]) });
    });
    ok(await page.evaluate(() => userAccounts.length > 3 && students.length === 6), 'the lab PC holds the Centre\'s records');
    await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 15000 });
    ok(await page.evaluate(() => !!_gateT.base && !document.body.classList.contains('gate-trainee-only')), 'its trainee card signs in through the gate (and staff still see Sync Now)');
    const before = await mainOf(page);
    await traineeSignIn(page, T.tameka.user, TRAINEE_PASS);
    await inPortal(page);
    ok(await page.evaluate(() => CESTISStore.namespace === 'g1' && students.length === 1), 'Tameka\'s gate session on the lab PC sees only her own records');
    const during = await mainOf(page);
    // She does things: reads her notices, opens My Exams, changes her phone number.
    await page.evaluate(() => { showPage('s-announcements'); });
    await page.waitForTimeout(800);
    await page.evaluate(() => { const a = announcements.find(x => x.id === 'AN-WF-1'); if (a) { CESTISCore.comms.markRead(a, currentLoggedInUser.id); saveState(); } });
    await page.evaluate(() => showPage('s-exams'));
    await page.waitForTimeout(800);
    const during2 = await mainOf(page);
    ok(before === during && during === during2, '5. the lab PC\'s own storage is byte for byte as it was, all through her session (' + before.length + ' bytes)');
    await page.evaluate(() => logout());
    await page.waitForFunction(onLandingSignedOut, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const after = await mainOf(page);
    const B = JSON.parse(before), A = JSON.parse(after);
    const diffKeys = [];
    const bm = new Map(B.ls), am = new Map(A.ls);
    new Set([...bm.keys(), ...am.keys()]).forEach(k => { if (bm.get(k) !== am.get(k)) diffKeys.push('ls:' + k); });
    const bi = new Map(B.idb), ai = new Map(A.idb);
    new Set([...bi.keys(), ...ai.keys()]).forEach(k => { if (bi.get(k) !== ai.get(k)) diffKeys.push('idb:' + k); });
    ok(diffKeys.length === 0, '   and after she signs out, too — changed: ' + diffKeys.join(', '));
    ok(await page.evaluate(() => !localStorage.getItem('cestisGateNs') && !Object.keys(localStorage).some(k => /^g1::/.test(k))), 'her session\'s namespace is gone from the lab PC (nothing of hers was left to send)');
    /* 6. The gate out of reach. */
    line.down = true;
    await traineeSignIn(page, T.rushane.user, TRAINEE_PASS);
    await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student', null, { timeout: 30000 }).catch(() => {});
    const fb = await page.evaluate(() => ({ role: currentRole, ns: CESTISStore.namespace, who: currentStudent && currentStudent.name, say: document.getElementById('studentLoginError').textContent }));
    ok(fb.role === 'student' && fb.ns === '' && fb.who === 'Rushane Grant', '6. the gate out of reach: the lab PC, which holds the Centre\'s records, signs him in today\'s way (' + JSON.stringify(fb) + ')');
    await page.close();
    // A phone with the gate out of reach: refused, with today's words.
    const ctxP = await phone({});
    const pp = await open(ctxP, 'phone-unreachable');
    ctxP._line.down = true;
    await traineeSignIn(pp, T.tameka.user, TRAINEE_PASS);
    await pp.waitForFunction(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden && !b.classList.contains('is-status') && b.textContent; }, null, { timeout: 30000 });
    ok(await say(pp) === 'Could not sign in right now. Check your connection and try again.', '   the phone, which holds nothing to fall back on, says "' + await say(pp) + '"');
    ok(await pp.evaluate(() => !(window.CESTISStore && CESTISStore.namespace) && !localStorage.getItem('cestisGateNs')), '   and stays signed out');
    await shotAll(pp, '13-error-unreachable', '#studentCard');
    shared.phoneP = { ctx: ctxP, page: pp };
    await lab.close();
  });

  /* ------------------------------------------------------------------ 7 */
  section('7. The kill switch and Turn off: today\'s sign-in again', async () => {
    killFile = true;
    const ctxK = await phone({});
    const pk = await open(ctxK, 'phone-killed');
    await pk.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 15000 });
    ok(await pk.evaluate(() => !_gateT.base && !document.body.classList.contains('gate-trainee')), 'a gate-off file next to the page: the trainee card is today\'s');
    await pk.waitForTimeout(500);
    const kc = await pk.evaluate(() => ({ dis: document.querySelector('#studentCard .role-enter-btn').disabled, lsc: loginSyncCompleted, users: userAccounts.length, pend: document.querySelector('.role-cards').className }));
    ok(kc.dis && kc.pend.indexOf('sync-pending') !== -1, '   (on a phone holding nothing, today\'s card waits for Sync Now: ' + JSON.stringify(kc) + ')');
    killFile = false;
    await ctxK.close();
    // Turned off on the Centre's settings (a lab PC's copy says enabled: false).
    const off = lineTo();
    const lab = await labPc({ voctrain_users: await shared.officePage.evaluate(() => CESTISStore.getItem('voctrain_users')),
      voctrain_systemSettings: JSON.stringify({ traineeGate: { url: GATE_URL, enabled: false, setAt: new Date().toISOString() } }) }, off);
    const pl = await open(lab, 'lab-off', '/index.html');
    await pl.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 15000 });
    ok(await pl.evaluate(() => !_gateT.base), 'Turn off: a PC whose copy of the settings says off uses today\'s sign-in');
    ok(off.calls.length === 0, '   and asks the gate nothing (' + off.calls.length + ')');
    await lab.close();
    // The gate itself answering "off" (its gate-off file): a phone that knows only the link signs in today's way.
    const root = Object.values(drive.files).find(f => f.name === 'CESTIS Trainee Gate');
    const offFile = drive.put(null, { name: 'gate-off', parents: [root.id] }, 'off');
    gate.world.cache.remove('off:file');
    const ctxO = await phone({});
    const po = await open(ctxO, 'phone-gate-off');
    await traineeSignIn(po, T.tameka.user, TRAINEE_PASS);
    await po.waitForFunction(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden && !b.classList.contains('is-status') && b.textContent; }, null, { timeout: 30000 });
    ok(/sync first/i.test(await say(po)), 'the gate switched off: the phone gets today\'s sign-in ("' + (await say(po)).split('\n')[0] + '")');
    drive.put(offFile.id, { trashed: true }, null);
    gate.world.cache.remove('off:file');
    await ctxO.close();
  });

  /* ------------------------------------------------------------------ 8 */
  section('8. Signed out with a submitted test unsent: the next session on the phone sends it', async () => {
    const ctx = await phone({});
    const page = await open(ctx, 'dwayne-phone');
    await traineeSignIn(page, T.dwayne.user, TRAINEE_PASS);
    await inPortal(page);
    await page.evaluate(() => showPage('s-exams'));
    await page.waitForTimeout(800);
    await page.click('#studentUpcomingExams button:has-text("Take Exam")');
    await page.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display === 'block', null, { timeout: 25000 });
    // No connection at all (the browser says so, and nothing reaches the gate).
    await ctx.setOffline(true);
    ctx._line.down = true;
    await answer(page, 'Q1', { opt: 0 });
    await answer(page, 'Q2', { opt: 'false' });
    await submitAll(page);
    await page.waitForFunction(() => { const n = document.getElementById('examListNote'); return n && /back online/.test(n.textContent); }, null, { timeout: 40000 }).catch(async e => {
      console.log('    state:', await page.evaluate(() => JSON.stringify({ open: !!currentExamSession, note: (document.getElementById('examListNote') || {}).textContent, list: (document.getElementById('studentExamListView') || {}).style && document.getElementById('studentExamListView').style.display,
        res: (document.getElementById('studentExamResultView') || {}).innerText && document.getElementById('studentExamResultView').innerText.slice(0, 100), conf: !!document.getElementById('examConfirmOverlay') })));
      throw e;
    });
    const note = await page.evaluate(() => document.getElementById('examListNote').textContent);
    ok(note === 'Your test is submitted here and will be sent to the office when you\'re back online.', 'offline submit: "' + note + '"');
    await page.evaluate(() => refreshSyncChip());
    await page.waitForTimeout(400);
    const chip = await page.evaluate(() => ({ label: document.getElementById('syncChipPanelTitle').textContent, chip: document.getElementById('syncChipLabel').textContent }));
    ok(/^Saved here — will be sent when you're back online \(\d+ waiting\)$/.test(chip.label), 'the top bar: "' + chip.label + '"');
    ok(await page.evaluate(() => /Submitted — waiting to send/.test(document.getElementById('studentUpcomingExams').innerText)), 'My Exams: "Submitted — waiting to send", never offered again');
    await page.evaluate(() => { try { dismissCloudNotification(); } catch (e) {} });   // (the browser's own "You are offline" notice, as she closes it)
    await shotAll(page, '08-offline-submit');
    // Signed out with the gate still out of reach (the site itself is there again).
    await ctx.setOffline(false);
    ctx._line.down = true;
    await page.evaluate(() => logout());
    await page.waitForFunction(onLandingSignedOut, null, { timeout: 40000 });
    const left = await page.evaluate(() => ({ ns: localStorage.getItem('cestisGateNs'), keys: Object.keys(localStorage).filter(k => /^g1::/.test(k)).length, token: localStorage.getItem('g1::cestisGateToken'), key: localStorage.getItem('g1::cestisGateSessionKey') }));
    ok(!left.ns && left.keys > 0 && !left.token && !left.key, 'signed out: his records stay on the phone while his test waits, but the session\'s token and key are gone (' + JSON.stringify(left) + ')');
    ok(await outboxWaiting(page) >= 1, 'the sealed submit still waits in the outbox');
    // The connection returns: the next session on the phone (nobody signed in) sends it.
    ctx._line.down = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => CESTISGate.status().then(s => s.all === 0), null, { timeout: 60000, polling: 1000 });
    ok(true, 'the next session on the phone delivers the submit');
    await collect(1);
    const res = await officeResults(T.dwayne.sid, 'EXAM-EI2');
    ok(res.length === 1 && res[0].score === 50, 'staff see exactly one result: his (' + JSON.stringify(res) + ')');
    // Nothing left to send: the next load clears his records off the phone.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    ok(await page.evaluate(() => !Object.keys(localStorage).some(k => /^g1::/.test(k))), 'and once nothing of his waits, his records go from the phone');
    await ctx.close();
  });

  /* ------------------------------------------------------------------ 9 */
  section('9. The same on the Centre\'s own server (/_cestis/gate, staff-only on): password sign-in, a test, one result', async () => {
    const OFF = path.join(ROOT, 'Offline System');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-gate-flows-lan-'));
    const DATA = path.join(tmp, 'data');
    const PORT = 9300 + Math.floor(Math.random() * 600);
    const lan = 'http://127.0.0.1:' + PORT;
    // The Centre's records on its server: the office's own, as its 5-second save leaves them.
    const now = new Date().toISOString();
    const pb = (pw, salt) => 'pbkdf2$1000$' + salt + '$' + nodeCrypto.pbkdf2Sync(pw, Buffer.from(salt, 'hex'), 1000, 32, 'sha256').toString('hex');
    const users = [{ id: kit.ADMIN.id, name: kit.ADMIN.name, role: 'admin', username: kit.ADMIN.user, email: 'mthompson@example.com', status: 'active',
      password: pb(kit.ADMIN.pass, '00112233445566778899aabbccddeeff'), updatedAt: now }];
    const studs = [];
    TRAINEES.forEach((t, i) => {
      users.push({ id: t.id, name: t.name, role: 'student', username: t.user, email: t.user + '@example.com', programme: t.prog, studentDataId: t.sid,
        password: pb(TRAINEE_PASS, nodeCrypto.createHash('md5').update('lan' + i).digest('hex')), status: 'active', updatedAt: now });
      studs.push({ id: t.sid, name: t.name, course: t.prog, stage: 'training', email: t.user + '@example.com', updatedAt: now });
    });
    const p = Core.exams.centreParts(Date.now() - 5 * 60000);
    const store = {
      voctrain_users: users, voctrain_students: studs,
      voctrain_exams: [{ id: 'EXAM-WS3', title: 'Welding Safety — Unit 3 Assessment', course: 'Welding & Fabrication', date: p.date, time: p.time, duration: 60,
        status: 'upcoming', passMark: 60, questions: 3, questionData: QUESTIONS, answersRelease: 'after-close', questionsPerPage: 3, shuffleOptions: true, updatedAt: now }],
      voctrain_examResults: [], voctrain_examAttempts: [],
      voctrain_systemSettings: { institutionName: 'C.E.S.T.I.S Training Centre', maintenanceMode: false }
    };
    const data = {}, stamps = {};
    Object.keys(store).forEach(k => { data[k] = JSON.stringify(store[k]); stamps[k] = now; });
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json',
      savedAt: now, savedBy: 'office-pc', keyCount: Object.keys(data).length, stamps, data }));
    const dashList = k => { try { return JSON.parse(JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8')).data[k] || '[]'); } catch (e) { return null; } };
    const server = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: OFF, stdio: 'ignore',
      env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
    try {
      for (let i = 0; i < 80; i++) { await wait(100); try { if ((await fetch(lan + '/_cestis/health')).ok) break; } catch (e) {} }
      // An administrator turns "trainee devices get only their own records" on, with a password the server checks.
      const tok = (await (await fetch(lan + '/_cestis/token')).json()).token;
      const flip = await fetch(lan + '/_cestis/staff-only', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CESTIS-Token': tok },
        body: JSON.stringify({ username: kit.ADMIN.user, password: kit.ADMIN.pass, on: true }) }).then(r => r.json());
      ok(flip.on === true, 'the Centre\'s server: the records are for staff only (' + JSON.stringify({ on: flip.on }) + ')');
      // Tameka's phone on the Centre's network: nothing outside it answers.
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Jamaica' });
      const asked = [];
      await ctx.route('**/*', r => { const u = r.request().url(); if (!u.startsWith(lan)) return r.abort(); asked.push(r.request().method() + ' ' + u.slice(lan.length).split('?')[0]); return r.continue(); });
      const answered = [];
      ctx.on('response', r => { const u = r.url(); if (u.startsWith(lan)) answered.push(r.request().method() + ' ' + u.slice(lan.length).split('?')[0] + ' ' + r.status()); });
      await ctx.addInitScript(() => { try { localStorage.setItem('cestis_sw_disabled', '1'); } catch (e) {} });
      const page = K.watch(await ctx.newPage(), 'tameka-lan');
      await page.goto(lan + '/index.html', { waitUntil: 'load' });
      await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 20000 });
      await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
      await page.waitForTimeout(300);
      const card = await page.evaluate(() => ({ base: _gateT.base && _gateT.base.kind, url: _gateT.base && _gateT.base.url, email: !!document.querySelector('#studentCard .gmail-btn') && getComputedStyle(document.querySelector('#studentCard .gmail-btn')).display,
        only: document.body.classList.contains('gate-trainee-only') }));
      ok(card.base === 'lan' && card.url === lan + '/_cestis/gate', 'the trainee card signs in through the Centre\'s server (' + JSON.stringify(card) + ')');
      ok(card.email === 'none' && card.only, 'without the email-account button, which needs the internet, and without "Sync before signing in"');
      await shotAll(page, '09-centre-network-card', '#studentCard');
      await traineeSignIn(page, T.tameka.user, TRAINEE_PASS);
      await inPortal(page);
      ok(await page.evaluate(() => CESTISStore.namespace === 'g1' && currentStudent.name === 'Tameka Richards' && students.length === 1 && userAccounts.length === 1),
        'signed in by a PBKDF2 proof, into her own portal, with only her own records');
      // The test.
      await page.evaluate(() => showPage('s-exams'));
      await page.waitForTimeout(800);
      await page.click('#studentUpcomingExams button:has-text("Take Exam")');
      await page.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display === 'block', null, { timeout: 25000 });
      await answer(page, 'Q1', { opt: 0 });
      await answer(page, 'Q2', { opt: 'true' });
      await answer(page, 'Q3', { text: 'flashback arrestor' });
      await submitAll(page);
      await page.waitForFunction(() => /100%/.test((document.getElementById('studentExamResultView') || {}).innerText || ''), null, { timeout: 30000 }).catch(() => {});
      const shown = await page.evaluate(() => (document.getElementById('studentExamResultView') || {}).innerText || '');
      ok(/100%/.test(shown) && /Passed/.test(shown), 'submitted: the server marks it and the result shows at once');
      ok(await page.evaluate(() => document.querySelectorAll('#studentExamResultView .r-mark.bad').length === 0), '   her right answers ticked, never crossed');
      await shotAll(page, '09-centre-network-result');
      // Sent again, as a device does when it is not sure the first went: still one.
      await page.evaluate(() => CESTISGate.deliver({ force: true }));
      ok(await outboxWaiting(page) === 0, 'nothing is left waiting on the phone');
      const res = (dashList('voctrain_examResults') || []).filter(r => r.studentId === T.tameka.sid && r.examId === 'EXAM-WS3');
      ok(res.length === 1 && res[0].score === 100, 'the Centre\'s records hold exactly one result, hers, 100 (' + JSON.stringify(res.map(r => [r.id, r.score])) + ')');
      // What the phone asked for, and what it keeps.
      const given = answered.filter(a => /\/_cestis\/(data|token)/.test(a) && / 200$/.test(a));
      ok(asked.some(a => /^POST \/_cestis\/gate$/.test(a)) && given.length === 0, 'it spoke to /_cestis/gate, and was given neither the records token nor any of the records\' files (' + given.join(', ') + ')');
      // (Its own storage, outside the gate's, holds what today's page keeps on
      // any device that opens it: the three built-in first-run logins, whose
      // published default opens nothing once the Centre has an administrator.)
      const dumpL = await dumpDevice(page);
      const seeds = JSON.parse(dumpL.ls.voctrain_users || '[]');
      ok(seeds.every(u => ['USR-001', 'USR-011', 'USR-021'].indexOf(u.id) !== -1 && u.defaultPassword === true), '   (outside the gate\'s storage: only the built-in first-run logins — ' + seeds.map(u => u.id).join(', ') + ')');
      const leak = privacyScan(dumpL, T.tameka, users, { allowMain: /^(ls:voctrain_users|idb:CESTIS_KV\/kv\/voctrain_users)$/ });
      ok(leak.length === 0, '3. the phone holds nobody else\'s records, no password check, no answer key — found: ' + leak.join('; '));
      // Signing out leaves nothing of hers.
      await page.evaluate(() => logout());
      await page.waitForFunction(onLandingSignedOut, null, { timeout: 40000 });
      await page.waitForTimeout(800);
      ok(await page.evaluate(() => !localStorage.getItem('cestisGateNs') && !Object.keys(localStorage).some(k => /^g1::/.test(k))), 'signed out, nothing of hers stays on the phone');
      await ctx.close();
    } finally {
      server.kill();
      await wait(200);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  });

  /* ------------------------------------------------------------------ 10 */
  section('10. What a trainee is told: each refusal in the gate\'s own words', async () => {
    // The office switches one trainee off, a registration is still waiting, and
    // a new account's records have not been sent to the gate yet.
    await shared.officePage.evaluate(async PASS => {
      const now = new Date().toISOString(), hash = await hashPassword(PASS);
      const sh = userAccounts.find(u => u.id === 'USR-scampbell');
      sh.status = 'disabled'; sh.updatedAt = now;
      userAccounts.push({ id: 'USR-pwaiting', name: 'Pendleton Waitingly', role: 'student', username: 'pendleton.waitingly', email: 'pendleton.waitingly@example.com',
        programme: 'Plumbing', password: hash, status: 'pending', createdAt: now, updatedAt: now });
      userAccounts.push({ id: 'USR-nnewly', name: 'Nadine Newly', role: 'student', username: 'nadine.newly', email: 'nadine.newly@example.com',
        programme: 'Plumbing', studentDataId: 'STU-NOT-YET', password: hash, status: 'active', createdAt: now, updatedAt: now });
      persistUserAccounts();
      await saveAccountsLedger();
    }, TRAINEE_PASS);
    gate.world.cache.remove('ix:c');     // (the gate reads the accounts list again at once, not within the minute)
    const ctx = await phone({});
    const page = await open(ctx, 'phone-refusals');
    async function tryOnce(login, pass) {
      await page.evaluate(() => { closePendingScreen(); const b = document.getElementById('studentLoginError'); if (b) { b.hidden = true; b.textContent = ''; b.classList.remove('is-status'); } });
      await traineeSignIn(page, login, pass);
      await page.waitForFunction(() => { const b = document.getElementById('studentLoginError'); return !!document.getElementById('pendingApprovalScreen') || !!(b && !b.hidden && !b.classList.contains('is-status') && b.textContent); }, null, { timeout: 30000 });
      return say(page);
    }
    let said = await tryOnce(T.kemar.user, 'Not-His-Password-1');
    ok(said === 'That email/username and password do not match.', 'a wrong password: "' + said + '"');
    await shotAll(page, '10-error-wrong-password', '#studentCard');
    for (let i = 0; i < 5; i++) said = await tryOnce(T.odalys.user, 'Wrong-' + i);
    said = await tryOnce(T.odalys.user, TRAINEE_PASS);
    ok(said === 'Too many tries. Wait 15 minutes, or ask the office.', 'five wrong tries, then even the right password: "' + said + '"');
    await shotAll(page, '11-error-locked', '#studentCard');
    said = await tryOnce(T.shanique.user, TRAINEE_PASS);
    ok(said === 'This account has been switched off. Please contact the office.', 'an account the office switched off: "' + said + '"');
    await shotAll(page, '12-error-switched-off', '#studentCard');
    said = await tryOnce('nadine.newly', TRAINEE_PASS);
    ok(said === 'Your records are being prepared. Try again in a few minutes, or ask the office.', 'records not sent to the gate yet: "' + said + '"');
    await shotAll(page, '14-error-not-ready', '#studentCard');
    await tryOnce('pendleton.waitingly', TRAINEE_PASS);
    const pend = await page.evaluate(() => { const p = document.getElementById('pendingApprovalScreen'); return p ? document.getElementById('pendingApprovalTitle').textContent : ''; });
    ok(/Awaiting Approval/i.test(pend), 'a registration still waiting: today\'s "Awaiting Approval" screen (' + pend + ')');
    await shotAll(page, '15-pending-approval');
    ok(await page.evaluate(() => !(window.CESTISStore && CESTISStore.namespace) && !localStorage.getItem('cestisGateNs') && !Object.keys(localStorage).some(k => /^g1::/.test(k))),
      'none of them leaves anything of a session on the phone');
    await ctx.close();
  });

  /* ------------------------------------------------------------------ 11 */
  section('11. A trainee sits a test at home while the office watches the Exam Invigilator board', async () => {
    const op = shared.officePage;
    // The office opens the Exam Invigilator on the electrical quiz.
    await op.evaluate(() => showPage('invigilator'));
    await op.waitForFunction(() => !!document.getElementById('invigBoard') && typeof invigPickExam === 'function', null, { timeout: 20000 });
    await op.evaluate(() => invigPickExam('EXAM-EI2'));
    const rowOf = name => op.evaluate(n => {
      const r = Array.prototype.find.call(document.querySelectorAll('#invigBoard .invig-row'), t => t.innerText.indexOf(n) !== -1);
      return r ? { text: r.innerText.replace(/\s+/g, ' '), status: (r.querySelector('.invig-td-status') || {}).innerText || '' } : null;
    }, name);
    // "Check now", as the invigilator presses it: what trainees sent is collected, then the board is drawn.
    const checkNow = async () => {
      await op.evaluate(() => invigCheckNow(true));
      await op.waitForFunction(() => !invigState.checking && !_gateRun.collecting, null, { timeout: 40000, polling: 300 });
      await op.evaluate(() => invigRender());
    };
    await checkNow();
    let row = await rowOf('Rushane Grant');
    ok(row && /Not started/i.test(row.status), 'the board expects Rushane, not started yet (' + (row && row.text) + ')');
    // Rushane, at home on his phone.
    const ctx = await phone({});
    const page = await open(ctx, 'rushane-home');
    await traineeSignIn(page, T.rushane.user, TRAINEE_PASS);
    await inPortal(page);
    await page.evaluate(() => showPage('s-exams'));
    await page.waitForTimeout(800);
    await page.click('#studentUpcomingExams button:has-text("Take Exam")');
    await page.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display === 'block', null, { timeout: 25000 });
    await answer(page, 'Q1', { opt: 0 });
    // He switches to another app and comes back.
    const setVisible = v => page.evaluate(v => {
      Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: !v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
    await setVisible(false);
    await page.waitForTimeout(1200);
    await setVisible(true);
    // (The shared copy follows within 30 seconds of a change; sent at once here.)
    await page.evaluate(() => examPublishNow());
    await page.waitForFunction(() => CESTISGate.capture().then(() => CESTISGate.deliver({ force: true })).then(() => CESTISGate.status()).then(s => s.waiting === 0), null, { timeout: 40000, polling: 1000 });
    const mine = await page.evaluate(() => (currentExamSession.activity.ev || []).map(e => e.k).join(','));
    ok(/^start,left,back/.test(mine), 'his phone notes the moments, as on any other device (' + mine + ')');
    // The office: "Check now".
    await checkNow();
    row = await rowOf('Rushane Grant');
    ok(row && /In progress/i.test(row.status) && /Page 1 of 1 · Question \d/.test(row.text), 'the board: Rushane in progress, on page 1, the question he is on (' + (row && row.text) + ')');
    ok(row && /Left the test window 1×/.test(row.text), '   and that he left the test window once');
    const fresh = await op.evaluate(() => ({ checked: (document.getElementById('invigChecked') || {}).textContent || '', at: invigState.lastCheckDone, collected: _gateRun.collectAt }));
    ok(/just now|\d+ s(ec)? ago|seconds? ago/i.test(fresh.checked) && fresh.at >= fresh.collected, '   "last checked ' + fresh.checked + '" — the moment the office last collected what trainees sent');
    ok(row && /updated/.test(row.text), '   and the row says how old its copy is (' + (row && (row.text.match(/updated[^·]*?ago/) || [''])[0]) + ')');
    await op.locator('#invigBoard .invig-row', { hasText: 'Rushane Grant' }).click();
    await op.waitForSelector('#invigTimelineModal.active', { timeout: 10000 });
    let tl = await op.evaluate(() => document.getElementById('invigTimelineBody').innerText);
    ok(/Started the test on (Phone|Computer|Tablet) · /.test(tl) && /Opened page 1/.test(tl) && /Answered question/.test(tl) && /Left the test window/.test(tl) && /Came back to the test/.test(tl),
      'his timeline: started (on his device, named), page 1 opened, a question answered, left the window and came back (' + tl.replace(/\s+/g, ' ').slice(0, 260) + ')');
    await shotAll(op, '16-invigilator-timeline-in-progress');
    await op.evaluate(() => invigCloseTimeline());
    await shotAll(op, '16-invigilator-board-in-progress');
    // He finishes.
    await answer(page, 'Q2', { opt: 'true' });
    await submitAll(page);
    await page.waitForFunction(() => /%/.test((document.getElementById('studentExamResultView') || {}).innerText || ''), null, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => CESTISGate.status().then(s => s.waiting === 0), null, { timeout: 40000, polling: 1000 });
    await checkNow();
    row = await rowOf('Rushane Grant');
    ok(row && /Submitted/i.test(row.status) && /by the trainee/.test(row.text), 'the board: submitted, by the trainee (' + (row && row.text) + ')');
    await op.locator('#invigBoard .invig-row', { hasText: 'Rushane Grant' }).click();
    await op.waitForSelector('#invigTimelineModal.active', { timeout: 10000 });
    tl = await op.evaluate(() => document.getElementById('invigTimelineBody').innerText);
    ok(/Submitted/.test(tl) && /Started the test on (Phone|Computer|Tablet) · /.test(tl) && /Left the test window/.test(tl), '   and his whole timeline, the submission last (' + tl.replace(/\s+/g, ' ').slice(-120) + ')');
    ok(!/\bRed\b|\bBlue\b|\bTrue\b|\bFalse\b/.test(tl), '   never an answer');
    await shotAll(op, '17-invigilator-timeline-submitted');
    await op.evaluate(() => invigCloseTimeline());
    await shotAll(op, '17-invigilator-board-submitted');
    const att = await op.evaluate(sid => (examAttempts || []).filter(a => a && a.studentId === sid && a.examId === 'EXAM-EI2').map(a => ({ status: a.status, ev: ((a.activity || {}).ev || []).map(e => e.k).join(',') })), T.rushane.sid);
    ok(att.length === 1 && att[0].status === 'submitted' && /start,left,back.*submit/.test(att[0].ev), 'the office holds one submitted attempt of his, its activity whole (' + JSON.stringify(att) + ')');
    await op.evaluate(() => showPage('dashboard'));
    await ctx.close();
  });

  for (const sec of PLAN) {
    if (ONLY && !ONLY.test(sec.title)) continue;
    console.log(sec.title);
    const t0 = Date.now();
    try { await sec.fn(); } catch (e) { ok(false, sec.title + ' — threw: ' + String(e && e.stack || e).split('\n').slice(0, 4).join(' / ')); }
    console.log('    (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  ok(errors.length === 0, 'no page errors — ' + errors.join(' | '));
  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
