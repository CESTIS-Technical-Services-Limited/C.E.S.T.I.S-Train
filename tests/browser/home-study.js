/* Home study made smooth (the owner's group C) in real browsers, against the
   REAL trainee gate:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/home-study.js
                                               (npm run test:browser:home-study)

   The gate is trainee-gate/PASTE-GATE.gs itself (tests/browser/fake-gate.js),
   over the same in-memory shared files the office PC writes through
   (tests/browser/fake-drive.js). A Welding class part-way through its course
   (made-up names): a class live now, a test open now, marked tests, a
   register, a certified trainee whose download is approved, fees.

     1. The office publishes: her records, and her fees (only on a PC that
        holds the fee roll; only hers; never the office's notes).
     T14 The trainees' link opens on her own form (staff cards out of the
         way, one tap back); 44 px targets on a phone.
     T1/T13 Signed in: "Your class is live — Join class" and "Test open now —
         Start test" at the top of her home screen; her phone asks every
         minute around a class.
     T7  The bell glows three times, then stays still.
     T11 My Progress: her register's attendance, her marked tests.
     T2  A 12-megapixel photo is made about 0.4 MB on the phone; the signal
         drops part-way; the page says so plainly; closing the page loses
         nothing; back online it finishes by itself; the office collects her
         submission naming the file, and the file is in her folder.
     OF-12 My Fees: her balance and receipts (nobody else's). Change
         Password: a wrong current password said plainly; changed — the old
         one no longer signs her in, the new one does; the office's computer
         takes the change.
     T4  Kemar downloads his certificate at home (a PDF); the office counts
         the download for his phone.
     T6  A new trainee registers: "within 1–2 working days … We'll email you
         at <her address>"; the office approves; the gate sends the email.
     T13 Start test opens her test.
   No page errors anywhere. Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');

const { TRAINEES, TRAINEE_PASS, MAIN_FOLDER } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 300); }
}
const T = {};
TRAINEES.forEach(t => { T[t.user.split('.')[0]] = t; });
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));
const NEW = { name: 'Shanice Walters', email: 'shanice.walters@example.com', given: 'Shanice', family: 'Walters', pass: 'Welder2026' };
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

// The Welding class, part-way through (runs in the office PC before it reloads).
function seed({ T, PNG_W }) {
  const now = Date.now(), iso = ms => new Date(ms).toISOString(), day = 86400000, C = 'Welding & Fabrication';
  const pad = n => String(n).padStart(2, '0');
  const local = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const exams = JSON.parse(CESTISStore.getItem('voctrain_exams'));
  const p = CESTISCore.exams.centreParts(now - 5 * 60000);
  Object.assign(exams.find(e => e.id === 'EXAM-WS3'), { date: p.date, time: p.time, duration: 60, updatedAt: iso(now) });
  const results = [];
  [['EXAM-P1', 'Welding Unit 1 Theory Test', 78], ['EXAM-P2', 'Welding Unit 2 Theory Test', 54]].forEach(([id, title, score], k) => {
    const pp = CESTISCore.exams.centreParts(now - (k + 2) * 9 * day);
    exams.push({ id, title, course: C, date: pp.date, time: '09:00', duration: 45, status: 'completed', passMark: 60, questions: 3, createdBy: 'admin', updatedAt: iso(now - 20 * day) });
    results.push({ id: 'RES-' + id, examId: id, examTitle: title, studentId: T.tameka.sid, studentName: T.tameka.name, score, passed: score >= 60, correctCount: 2, totalQuestions: 3,
      submittedAt: iso(now - (k + 2) * 9 * day + 3600000), markedAt: iso(now - (k + 2) * 9 * day + 7200000), updatedAt: iso(now - 10 * day) });
  });
  CESTISStore.setItem('voctrain_exams', JSON.stringify(exams));
  CESTISStore.setItem('voctrain_examResults', JSON.stringify(results));
  const reg = [];
  for (let i = 1; i <= 7; i++) {
    const d = local(new Date(now - i * day));
    reg.push({ id: T.tameka.sid + '|' + d, studentId: T.tameka.sid, studentName: T.tameka.name, course: C, date: d, status: i === 3 ? 'absent' : 'present', markedAt: iso(now - i * day), markedBy: 'USR-mthompson', markedByName: 'Marcia Thompson' });
  }
  CESTISStore.setItem('voctrain_attendanceRegister', JSON.stringify(reg));
  CESTISStore.setItem('voctrain_notifications', JSON.stringify([{ id: 'NOTIF-WF-1', text: 'The workshop is closed on Friday for maintenance.', timestamp: now - 3600000,
    time: '1 hour ago', read: false, icon: '🔔', type: 'info', forRoles: ['student'] }]));
  const start = new Date(now - 6 * 60000);
  CESTISStore.setItem('voctrain_classSessions', JSON.stringify([{ id: 'CS-LIVE-1', name: 'Welding theory — fillet joints', course: C, date: local(start),
    time: pad(start.getHours()) + ':' + pad(start.getMinutes()), duration: 60, type: 'theory', location: 'Virtual-01', roomCode: 'WF4821', status: 'live',
    createdBy: 'Marcia Thompson', createdAt: iso(now - day), updatedAt: iso(now - 60000) }]));
  const studs = JSON.parse(CESTISStore.getItem('voctrain_students'));
  Object.assign(studs.find(s => s.id === T.kemar.sid), { stage: 'certified', certNo: 'WF-2026-4821-QX', certDate: iso(now).slice(0, 10), certIssueDate: iso(now).slice(0, 10), progress: 100, updatedAt: iso(now) });
  CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
  CESTISStore.setItem('voctrain_certDownloadApprovals', JSON.stringify([{ id: 'CDA-1', studentId: T.kemar.sid, studentName: T.kemar.name, approved: true, approvedBy: 'Marcia Thompson', approvedAt: iso(now), updatedAt: iso(now) }]));
  const tpls = JSON.parse(CESTISStore.getItem('voctrain_certTemplates') || '{}') || {};
  tpls[C] = Object.assign({}, tpls[C] || {}, { course: C, modules: [], textPositions: {}, updatedAt: iso(now) });
  delete tpls[C].bgPage1; delete tpls[C].bgPage2;
  CESTISStore.setItem('voctrain_certTemplates', JSON.stringify(tpls));
  CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify([
    { id: T.tameka.sid, lmsId: T.tameka.sid, name: T.tameka.name, skillArea: C, tuitionFee: 85000, totalPaid: 1, balance: 1, status: 'Partial Payment', contact: '876-555-0141', createdAt: iso(now - 80 * day), updatedAt: iso(now - 9 * day) },
    { id: T.kemar.sid, lmsId: T.kemar.sid, name: T.kemar.name, skillArea: C, tuitionFee: 85000, createdAt: iso(now - 200 * day), updatedAt: iso(now - 30 * day) }]));
  CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify([
    { id: 'PAY-T1', studentId: T.tameka.sid, studentName: T.tameka.name, amount: 30000, date: iso(now - 78 * day).slice(0, 10), method: 'Cash', term: 'Term 1', receiptNumber: 'R-2026-0141', notes: 'first instalment', createdAt: iso(now - 78 * day) },
    { id: 'PAY-T2', studentId: T.tameka.sid, studentName: T.tameka.name, amount: 20000, date: iso(now - 9 * day).slice(0, 10), method: 'Bank transfer', term: 'Term 2', receiptNumber: 'R-2026-0187', createdAt: iso(now - 9 * day) },
    { id: 'PAY-K1', studentId: T.kemar.sid, studentName: T.kemar.name, amount: 85000, date: iso(now - 190 * day).slice(0, 10), method: 'Cheque', term: 'Full', receiptNumber: 'R-2026-0009', createdAt: iso(now - 190 * day) }]));
  void PNG_W;
}

(async function main() {
  const srv = await kit.serve({ servePaste: true });
  const base = srv.base;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const K = kit.make({ browser, base, errors, gateUrl: GATE_URL });
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive, { seed: 'home-study' });

  /* Each phone's own line to the gate: parts of a file can be made to fail
     (the signal dropping part-way through her upload). */
  function lineTo() {
    const l = { partsLeft: Infinity, dropped: 0 };
    l.handle = async r => {
      const body = r.request().method() === 'POST' ? (r.request().postData() || '') : '';
      if (/"op":"upload\.part"/.test(body) && l.partsLeft-- <= 0) { l.dropped++; return r.abort('internetdisconnected'); }
      return gate.handle(r);
    };
    return l;
  }
  async function phone(opts) {
    opts = opts || {};
    const line = lineTo();
    const ctx = await K.computer({ phone: true, theme: 'light', drive: null, gate: line, extraRoute: (r, u) => {
      if (u.indexOf('https://accounts.google.com/gsi/client') === 0) return r.fulfill({ status: 200, contentType: 'text/javascript', body: GSI_STUB });
      if (u.indexOf('https://accounts.google.com/__fake/token') === 0) {
        const email = new URL(u).searchParams.get('email');
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ access_token: gate.tokenFor(email) }) });
      }
      if (u.indexOf('https://www.googleapis.com/oauth2/v3/userinfo') === 0) {
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(opts.profile || {}) });
      }
      return null;
    } });
    ctx._line = line;
    return ctx;
  }
  async function open(ctx, label) {
    const page = K.watch(await ctx.newPage(), label);
    await page.goto(base + LINK, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 20000 });
    return page;
  }
  async function signIn(page, login, pass) {
    await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
    await page.waitForTimeout(150);
    await page.fill('#studentUser', login);
    await page.fill('#studentPass', pass);
    await page.press('#studentPass', 'Enter');
  }
  const inPortal = (page, ms) => page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: ms || 60000 }).then(() => page.waitForTimeout(1200));
  const onLanding = () => { const l = document.getElementById('landingPage'); return document.readyState === 'complete' && !!l && l.style.display !== 'none' && !!window.CESTISGate && !(window.CESTISStore && CESTISStore.namespace); };
  // What the card says once an attempt is over (never its "Signing in…" status line).
  const loginSay = page => page.evaluate(() => { const b = document.getElementById('studentLoginError'); return b && !b.hidden && !b.classList.contains('is-status') ? b.textContent : ''; });
  const filesNamed = name => Object.values(drive.files).filter(f => f.name === name && !f.trashed);

  /* ---------------------------------------------------------------- 1 */
  console.log('1. The office publishes her records — and her fees, only hers');
  const office = await K.computer({ drive, gate });
  const op = await K.adminSignedIn(office, { label: 'office', mutate: seed, mutateArg: { T, PNG_W: 800 } });
  await op.evaluate(() => saveAccountsLedger());
  await until(() => filesNamed('CESTIS_ACCOUNTS.json').length, 20000);
  gate.world.get({ op: 'health' });
  await op.evaluate(G => { systemSettings.traineeGate = { url: G, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
  await op.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }, null, { timeout: 180000, polling: 500 });
  const feeFiles = filesNamed('from-centre-fees.json');
  ok(feeFiles.length === 2, 'a fees file for each of the two trainees on the fee roll, and nobody else (' + feeFiles.length + ')');
  const tFees = feeFiles.map(f => JSON.parse(f.content)).find(j => j.studentId === T.tameka.sid);
  ok(tFees && tFees.fees.balance === 35000 && tFees.fees.receipts.length === 2 && !/first instalment|876-555|R-2026-0009/.test(JSON.stringify(tFees)),
    'hers: balance worked out from her receipts, her two receipts, no notes, no contact details, no other trainee (' + JSON.stringify(tFees && tFees.fees).slice(0, 160) + ')');
  // The certificate's background, as the office's template page uploads it.
  const png = await op.evaluate(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 566; const g = c.getContext('2d'); g.fillStyle = '#f7f1e3'; g.fillRect(0, 0, 800, 566); g.strokeStyle = '#8a6d1d'; g.lineWidth = 12; g.strokeRect(20, 20, 760, 526); return c.toDataURL('image/png'); });
  drive.put(null, { name: 'cert_template_Welding___Fabrication_bgPage1.txt', parents: [MAIN_FOLDER], mimeType: 'text/plain' }, png);
  async function collect() {
    await op.evaluate(() => { _gateRun.collectAt = 0; GATE_LIMITS.collectMs = 1000; return gateCollectTick({ refetch: true }); });
    await op.waitForFunction(() => !_gateRun.collecting, null, { timeout: 30000 });
  }

  /* ------------------------------------------------------------- T14 */
  console.log('T14. The trainees\' link opens on her own form');
  const tctx = await phone({});
  let tp = await open(tctx, 'tameka');
  const card = await tp.evaluate(() => {
    const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    const foot = Array.from(document.querySelectorAll('.landing-footer a')).filter(vis).map(a => Math.round(a.getBoundingClientRect().height));
    return { first: document.body.classList.contains('trainee-first'), form: document.getElementById('studentLogin').classList.contains('active'),
      staff: vis(document.getElementById('adminCard')), toggle: vis(document.querySelector('.staff-cards-toggle')), foot };
  });
  ok(card.first && card.form && !card.staff && card.toggle, 'her form is open at once; the staff cards are out of her way, one tap back (' + JSON.stringify(card) + ')');
  ok(card.foot.length > 0 && card.foot.every(h => h >= 44), 'Privacy / Support links are at least 44 px tall on a phone (' + card.foot.join(',') + ')');

  /* --------------------------------------------------------- T1/T13 */
  console.log('T1/T13. Her class is live — Join; a test is open — Start');
  await signIn(tp, T.tameka.user, TRAINEE_PASS);
  await tp.waitForFunction(() => document.readyState === 'complete' && !!(window.CESTISStore && CESTISStore.namespace), null, { timeout: 30000 }).catch(() => {});
  await inPortal(tp);
  const now1 = await tp.evaluate(() => {
    const box = id => { const el = document.getElementById(id); const b = el && el.querySelector('button'); return el && !el.hidden ? { text: el.innerText.replace(/\s+/g, ' '), h: b ? Math.round(b.getBoundingClientRect().height) : 0, top: Math.round(el.getBoundingClientRect().top) } : null; };
    return { live: box('sHomeLiveClass'), test: box('sHomeOpenTest'), banner: Math.round(document.querySelector('.student-welcome-banner').getBoundingClientRect().top), delay: homePullDelay() };
  });
  ok(now1.live && /Your class is live/.test(now1.live.text) && /Join class/.test(now1.live.text) && now1.live.h >= 52, '"Your class is live — Join class", a big button (' + JSON.stringify(now1.live) + ')');
  ok(now1.test && /Test open now/.test(now1.test.text) && /Welding Safety/.test(now1.test.text) && /Start test/.test(now1.test.text), '"Test open now — Start test" (' + JSON.stringify(now1.test) + ')');
  ok(now1.live && now1.test && now1.live.top < now1.banner && now1.test.top < now1.banner, 'both at the very top of her home screen');
  ok(now1.delay === 60000, 'around a class her phone asks every minute (' + now1.delay + ' ms)');

  /* ------------------------------------------------------------- T7 */
  const bell = await tp.evaluate(() => { const b = document.querySelector('.topbar-btn.notif-active'); if (!b) return null; const a = getComputedStyle(b, '::after'); return { n: a.animationIterationCount, name: a.animationName }; });
  ok(bell && bell.n === '3' && bell.name === 'bellGlow', 'T7. a new notice: the bell glows three times, not for ever (' + JSON.stringify(bell) + ')');

  /* ------------------------------------------------------------- T11 */
  console.log('T11. My Progress: her register\'s attendance, her marked tests');
  await tp.evaluate(() => showPage('s-progress'));
  await tp.waitForTimeout(600);
  const prog = await tp.evaluate(() => ({ sum: document.getElementById('sProgressSummary').innerText.replace(/\s+/g, ' '), tests: document.getElementById('sProgressTests').innerText.replace(/\s+/g, ' ') }));
  ok(/86%/.test(prog.sum), 'attendance from her register: 6 of 7 days, 86% (' + prog.sum.slice(0, 160) + ')');
  ok(/Unit 1 Theory Test/.test(prog.tests) && /78%/.test(prog.tests) && /Unit 2 Theory Test/.test(prog.tests) && /54%/.test(prog.tests), 'her two marked tests with their scores (' + prog.tests.slice(0, 160) + ')');

  /* ------------------------------------------------------------- T2 */
  console.log('T2. A phone photo, made small; the signal drops; nothing lost');
  await tp.evaluate(() => showPage('s-assignments'));
  await tp.waitForTimeout(1200);
  const photo = await tp.evaluate(async () => {
    const c = new OffscreenCanvas(4000, 3000), x = c.getContext('2d');
    const img = x.createImageData(4000, 3000);
    for (let i = 0; i < img.data.length; i += 4) { const v = (i / 4) % 4000; img.data[i] = (v * 7 + Math.random() * 90) & 255; img.data[i + 1] = (Math.random() * 255) | 0; img.data[i + 2] = ((i / 16000) + Math.random() * 60) & 255; img.data[i + 3] = 255; }
    x.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return btoa(s);
  });
  const photoBytes = Buffer.from(photo, 'base64');
  await tp.evaluate(() => openSubmitAssignment('ASG-WF-1', 'Butt joint practice piece'));
  const t0 = Date.now();
  await tp.setInputFiles('#submitFileInput', { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: photoBytes });
  await tp.waitForFunction(() => _submitShrinking === 0 && _submitPendingFiles.length === 1, null, { timeout: 30000 });
  const shrinkMs = Date.now() - t0;
  const made = await tp.evaluate(async () => { const f = _submitPendingFiles[0]; const b = await createImageBitmap(f); return { size: f.size, w: b.width, h: b.height, type: f.type, name: f.name, from: f._homeFrom, list: document.getElementById('submitFileList').innerText }; });
  ok(made.w === 1600 && made.h === 1200 && made.type === 'image/jpeg' && made.size <= 480 * 1024 && made.from === photoBytes.length,
    'a ' + (photoBytes.length / 1048576).toFixed(1) + ' MB 4000×3000 photo became ' + (made.size / 1048576).toFixed(2) + ' MB, 1600×1200 JPEG, in ' + shrinkMs + ' ms');
  console.log('   photo: ' + photoBytes.length + ' B 4000×3000 → ' + made.size + ' B ' + made.w + '×' + made.h + ' in ' + shrinkMs + ' ms');
  ok(/MB → 0\.\d MB, made smaller for sending/.test(made.list), 'she sees it: "' + made.list.replace(/\s+/g, ' ').trim() + '"');
  tctx._line.partsLeft = 0;          // the signal drops before the first part
  await tp.click('#submitAssignBtn');
  await tp.waitForFunction(() => /No signal just now/.test((document.getElementById('submitProgressText') || {}).textContent || ''), null, { timeout: 60000 }).catch(() => {});
  const waitSay = await tp.evaluate(() => document.getElementById('submitProgressText').textContent);
  ok(/No signal just now\. Your work is saved on this device and will finish sending by itself/.test(waitSay) && !/check your connection/i.test(waitSay), 'the signal drops: "' + waitSay + '"');
  await tp.evaluate(() => closeModal('submitAssignmentModal'));
  await tp.waitForTimeout(400);
  const listNow = await tp.evaluate(() => (document.getElementById('studentAssignmentsPageList') || {}).innerText || '');
  ok(/Sending…/.test(listNow) && /saved on this device/.test(listNow) && !/Upload Submission/.test(listNow), 'her assignment says "Sending…" and offers no second upload');
  // She closes the app, and opens it again later.
  await tp.reload({ waitUntil: 'load' });
  await inPortal(tp);
  const kept = await tp.evaluate(() => CESTISGate.uploads(CESTISGate.session().acct).then(l => l.map(u => ({ state: u.state, bytes: u.bytes, files: u.files.length }))));
  ok(kept.length === 1 && kept[0].state === 'wait' && kept[0].bytes === made.size, 'the page closed and opened again: her work is still on the device (' + JSON.stringify(kept) + ')');
  tctx._line.partsLeft = Infinity;   // the signal is back
  await tp.evaluate(() => CESTISGate.uploadPump({ force: true }));
  const done = await until(() => tp.evaluate(() => CESTISGate.uploads(CESTISGate.session().acct).then(l => l.length === 0 && assignmentSubmissions.find(s => s.assignmentId === 'ASG-WF-1' && (s.driveFiles || []).length === 1)).then(s => s || null)), 60000, 500);
  ok(done && done.files.length === 0 && done.driveFiles[0].size === made.size, 'back online: it finishes by itself, and her submission names the file (' + JSON.stringify(done && done.driveFiles) + ')');
  await tp.evaluate(() => showPage('s-assignments'));
  await tp.waitForTimeout(800);
  ok(/Submitted/.test(await tp.evaluate(() => document.getElementById('studentAssignmentsPageList').innerText)), 'her assignment says Submitted');
  await until(() => tp.evaluate(() => CESTISGate.deliverNow().then(() => CESTISGate.status()).then(s => s.waiting === 0)), 30000, 1000);
  await collect();
  const atOffice = await until(() => op.evaluate(() => assignmentSubmissions.find(s => s.assignmentId === 'ASG-WF-1' && (s.driveFiles || []).length === 1) || null), 20000, 1000);
  const inFolder = atOffice && drive.files[atOffice.driveFiles[0].driveFileId];
  ok(atOffice && inFolder && (inFolder._bytes ? inFolder._bytes.length : Buffer.byteLength(inFolder.content || '', 'latin1')) > 0, 'the office collects her submission; the photo is a file in her own folder');

  /* ----------------------------------------------------------- OF-12 */
  console.log('OF-12. My Fees, and Change Password');
  await tp.evaluate(() => showPage('s-fees'));
  await tp.waitForFunction(() => /\$35,000\.00/.test(document.getElementById('sFeesContent').innerText), null, { timeout: 30000 }).catch(() => {});
  const feesTxt = await tp.evaluate(() => document.getElementById('sFeesContent').innerText.replace(/\s+/g, ' '));
  ok(/\$85,000\.00/.test(feesTxt) && /\$50,000\.00/.test(feesTxt) && /\$35,000\.00/.test(feesTxt) && /R-2026-0187/.test(feesTxt) && /R-2026-0141/.test(feesTxt), 'her fee, what she paid, her balance, her receipts (' + feesTxt.slice(0, 200) + ')');
  ok(!/first instalment|R-2026-0009|Kemar/.test(feesTxt), 'nothing of anybody else, and not the office\'s notes');
  await tp.click('#topbarWho');
  await tp.waitForTimeout(200);
  ok(await tp.evaluate(() => { const b = document.getElementById('tamChangePassword'); return !!b && getComputedStyle(b).display !== 'none'; }), 'Change Password is in her account menu');
  await tp.click('#tamChangePassword');
  await tp.waitForSelector('#homePasswordModal.active', { timeout: 5000 });
  await tp.fill('#homePwOld', 'Not-My-Password-1');
  await tp.fill('#homePwNew', NEW.pass);
  await tp.fill('#homePwNew2', NEW.pass);
  await tp.click('#homePwBtn');
  await tp.waitForFunction(() => /not right/.test(document.getElementById('homePwSay').textContent), null, { timeout: 20000 }).catch(() => {});
  ok(/Your current password is not right/.test(await tp.evaluate(() => document.getElementById('homePwSay').textContent)), 'a wrong current password: said plainly');
  await tp.fill('#homePwOld', TRAINEE_PASS);
  await tp.click('#homePwBtn');
  await tp.waitForFunction(() => !document.getElementById('homePasswordModal').classList.contains('active'), null, { timeout: 30000 }).catch(() => {});
  ok(!(await tp.evaluate(() => document.getElementById('homePasswordModal').classList.contains('active'))), 'changed: the window closes');
  const oldHash = await op.evaluate(id => userAccounts.find(u => u.id === id).password, T.tameka.id);
  await collect();
  const acctNow = await until(() => op.evaluate(id => { const a = userAccounts.find(u => u.id === id); return a && a.passwordChangedVia === 'home' ? { pw: a.password, at: a.passwordChangedAt, up: a.updatedAt } : null; }, T.tameka.id), 30000, 1000);
  ok(acctNow && acctNow.pw !== oldHash && /^pbkdf2\$/.test(acctNow.pw) && acctNow.at && Date.parse(acctNow.up) >= Date.parse(acctNow.at), 'the office\'s computer takes the change, with its own moment (' + JSON.stringify(acctNow && { at: acctNow.at, up: acctNow.up }) + ')');
  await tp.evaluate(() => logout());
  await tp.waitForFunction(onLanding, null, { timeout: 30000 });
  await signIn(tp, T.tameka.user, TRAINEE_PASS);
  const refused = await until(() => loginSay(tp), 30000, 300);
  ok(refused && !(await tp.evaluate(() => !!(window.CESTISStore && CESTISStore.namespace))), 'the old password no longer signs her in ("' + refused + '")');
  await signIn(tp, T.tameka.user, NEW.pass);
  await inPortal(tp).catch(() => {});
  ok(await tp.evaluate(() => typeof currentRole !== 'undefined' && currentRole === 'student' && currentStudent.name === 'Tameka Richards'), 'the new one does');

  /* ------------------------------------------------------------- T13 */
  await tp.evaluate(() => showPage('s-dashboard'));
  await tp.waitForTimeout(500);
  await tp.click('#sHomeOpenTest button');
  const started = await until(() => tp.evaluate(() => !!(typeof currentExamSession !== 'undefined' && currentExamSession && currentExamSession.examId === 'EXAM-WS3')), 30000, 300);
  ok(started, 'T13. "Start test" opens her test');
  await tctx.close();

  /* -------------------------------------------------------------- T4 */
  console.log('T4. Kemar downloads his certificate at home');
  const kctx = await phone({});
  const kp = await open(kctx, 'kemar');
  await signIn(kp, T.kemar.user, TRAINEE_PASS);
  await kp.waitForFunction(() => document.readyState === 'complete' && !!(window.CESTISStore && CESTISStore.namespace), null, { timeout: 30000 }).catch(() => {});
  await inPortal(kp);
  await kp.evaluate(() => showPage('s-certificate'));
  await kp.waitForTimeout(1500);
  const cbtn = await kp.evaluate(() => { const b = document.getElementById('certPublicDownloadBtn'); return b ? { text: b.innerText.trim(), disabled: b.disabled } : null; });
  ok(cbtn && /Download Certificate/.test(cbtn.text) && !cbtn.disabled, 'his Download button works at home — no "sync first" (' + JSON.stringify(cbtn) + ')');
  const [dl] = await Promise.all([kp.waitForEvent('download', { timeout: 60000 }).catch(() => null), kp.click('#certPublicDownloadBtn')]);
  let pdfHead = '';
  if (dl) { const p = await dl.path(); pdfHead = fs.readFileSync(p).slice(0, 5).toString('latin1'); }
  ok(dl && pdfHead === '%PDF-' && /WF-2026-4821-QX/.test(dl.suggestedFilename()), 'a PDF of his certificate (' + (dl && dl.suggestedFilename()) + ')');
  await until(() => kp.evaluate(() => CESTISGate.deliverNow().then(() => CESTISGate.status()).then(s => s.waiting === 0)), 30000, 1000);
  await collect();
  const counted = await until(() => op.evaluate(sid => { const a = certDownloadApprovals.find(x => x.studentId === sid); const m = a && a.downloadsByDevice; return m && Object.keys(m).some(k => /^home-/.test(k)) ? m : null; }, T.kemar.sid), 30000, 1000);
  ok(counted && Object.keys(counted).filter(k => /^home-/.test(k)).every(k => counted[k] === 1), 'the office counts the download for his phone (' + JSON.stringify(counted) + ')');
  await kctx.close();

  /* -------------------------------------------------------------- T6 */
  console.log('T6. A new trainee registers from home, and is emailed once approved');
  const rctx = await phone({ profile: { email: NEW.email, name: NEW.name, given_name: NEW.given, family_name: NEW.family, email_verified: true } });
  const rp = await open(rctx, 'register');
  await rp.evaluate(e => { window.__fakePopup = { email: e }; }, NEW.email);
  await rp.evaluate(() => gateRegisterStart());
  await rp.waitForSelector('#gateRegModal', { timeout: 20000 });
  await rp.selectOption('#grProgramme', { index: 1 });
  await rp.fill('#grPhone', '876-555-0199');
  // Her personal details, which the form asks before anything is sent (office group, OF-3).
  await rp.selectOption('#grGender', 'Female');
  await rp.fill('#grDob', '2006-05-09');
  await rp.fill('#grAddress', '12 Spanish Town Road, Kingston 13');
  await rp.fill('#grEmergencyName', 'Marlene Wallace');
  await rp.fill('#grEmergencyPhone', '876-555-0177');
  await rp.fill('#grPassword', NEW.pass);
  await rp.fill('#grPassword2', NEW.pass);
  await rp.click('#grSend');
  await rp.waitForSelector('#pendingApprovalWhen', { timeout: 20000 }).catch(() => {});
  const when = await rp.evaluate(() => (document.getElementById('pendingApprovalWhen') || {}).textContent || '');
  ok(when === 'The office usually approves registrations within 1–2 working days. We’ll email you at ' + NEW.email + ' when you can sign in.', 'the pending screen: "' + when + '"');
  await collect();
  const regId = await until(() => op.evaluate(e => { const a = userAccounts.find(u => u.email === e && u.registeredVia === 'home-registration'); return a ? a.id : null; }, NEW.email), 20000, 1000);
  ok(!!regId, 'the office collects her registration');
  await op.evaluate(() => { document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); showPage('verify-users'); });
  await op.waitForTimeout(800);
  await op.click('#verifyUsersTableBody button:has-text("Activate")').catch(() => op.evaluate(id => approveUser(id), regId));
  await until(() => op.evaluate(id => (userAccounts.find(u => u.id === id) || {}).status === 'active', regId), 10000);
  await until(() => { const l = filesNamed('CESTIS_ACCOUNTS.json')[0]; return l && JSON.parse(l.content).accounts.some(a => a.id === regId && a.status === 'active'); }, 30000, 500);
  let mailed = null;
  for (let i = 0; i < 6 && !mailed; i++) {
    gate.world.cache.clear();
    gate.world.get({ op: 'health' });          // reads the accounts list again (notes her approval), then sends
    gate.world.get({ op: 'health' });
    mailed = gate.world.mail.sent.find(m => JSON.stringify(m).indexOf(NEW.email) !== -1) || null;
    if (!mailed) await wait(1000);
  }
  ok(mailed && /You can sign in now/.test(JSON.stringify(mailed)) && /Shanice/.test(JSON.stringify(mailed)) && !/Drive|server/.test(JSON.stringify(mailed)), 'approved: the gate emails her that she can sign in (' + JSON.stringify(mailed).slice(0, 200) + ')');
  await rctx.close();

  ok(errors.length === 0, 'no page errors (' + errors.slice(0, 5).join(' | ') + ')');
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  await browser.close();
  srv.close();
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
