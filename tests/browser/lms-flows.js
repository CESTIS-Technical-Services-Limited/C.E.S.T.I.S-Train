/* A training Centre's day, end to end, in real browsers (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/lms-flows.js      (npm run test:browser:flows)

   Proof that a Centre can actually run its day on this system — from a live
   class to examinations and certification — driven through the REAL pages the
   way staff and trainees use them: buttons clicked, forms filled, Enter
   pressed. Nothing is seeded; the first administrator signs in with the
   published first-run password and sets their own.

   The Centre runs the Offline System: a fresh copy of the site is generated
   from this repository (tools/build-offline.js --out, byte for byte the root
   pages) and served by its real server, cestis-offline-server.js, on
   localhost with a scratch data folder. That server is the Centre's shared
   store, issues the staff host tickets and introduces the video calls, so
   every device below is its own browser context with its own storage and
   they share data only through it, as on a Centre network. Every request to
   any other host is aborted (no internet), and the browsers have fake
   cameras and microphones. Devices keep Jamaica time, like the Centre.

     office PC     the administrator; a second tab is the front desk (a
                   trainee registers there, and later collects a certificate)
     laptop        the instructor
     phone         Ama, a trainee
     lab PC        shared: Kofi, then Shanté O'Neil, sign in one after another
     visitor       an employer checking a certificate, no account at all

   Flows: (1) intake, trainees (one with an apostrophe), instructor, a
   self-registration approved; (2) a class scheduled, held in the small room
   with a trainee joining, ended, the live class taken into the attendance
   register, the rest marked by hand, saved, and still there after a reload,
   week by week; (3) an assignment set, submitted, graded (a 0 included), each
   trainee seeing only their own mark; (4) an exam with MCQ, true/false and an
   essay, sat by two trainees (one refreshes mid-exam and resumes with the
   same answers and clock), awaiting marking, marked, answers released;
   (5) Transcript/Grades before and after marking, and its PDF; (6) the
   certificate: eligibility checklist, approval, signing, the trainee's PDF,
   a number that never changes, withdrawal, and the QR address checked by a
   visitor; (7) an announcement read in full, a calendar event, and the
   trainee's agenda. Every tab is checked for page errors and console errors.

   The Centre's devices refresh from its server every 30 seconds by
   themselves; where one device must see another's work, the test brings that
   refresh forward (CESTISPageCloud.loadNow — the app's own refresh) instead
   of waiting, and then waits for the screen to show it.

   Screenshots of every open tab are written on a failure to
   $CESTIS_FLOW_SHOTS (default: <tmp>/cestis-flow-shots).
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_FLOW_SHOTS || path.join(os.tmpdir(), 'cestis-flow-shots');
const TZ = 'America/Jamaica';
const STARTED = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------- reporting */
let passed = 0, failed = 0, current = null;
const steps = [], notes = [];
function ok(cond, msg) {
  if (cond) { passed++; if (current) current.pass++; }
  else { failed++; if (current) { current.fail++; current.failures.push(msg); } console.log('  ✗ FAIL: ' + msg); }
  return !!cond;
}
function note(msg) { notes.push((current ? current.id + ': ' : '') + msg); console.log('  • ' + msg); }

/* ------------------------------------------------------- the Centre's server */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-flows-'));
const SITE = path.join(tmp, 'site'), DATA = path.join(tmp, 'data'), CERT = path.join(tmp, 'cert');
const PORT = 9300 + Math.floor(Math.random() * 600);
const base = 'http://127.0.0.1:' + PORT;
let server = null;
async function startServer() {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-offline.js'), '--out', SITE], { stdio: 'ignore' });
  server = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: SITE, stdio: 'ignore',
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: CERT }) });
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    try { if ((await fetch(base + '/_cestis/health')).ok) return; } catch (e) {}
  }
  throw new Error('the Centre server did not start');
}
// What the Centre's server holds for the dashboard (observation only).
function onServer(key) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8'));
    const v = p.data[key];
    return v == null ? null : JSON.parse(v);
  } catch (e) { return null; }
}
async function serverHas(key, pred, ms) {
  const end = Date.now() + (ms || 20000);
  while (Date.now() < end) {
    const v = onServer(key);
    try { if (v != null && pred(v)) return v; } catch (e) {}
    await sleep(300);
  }
  return null;
}
// "Publishing" the public key file, as the Centre does on its web host.
function publishKeys(text) { fs.writeFileSync(path.join(SITE, 'cert-keys.json'), text); }

/* ----------------------------------------------------------------- devices */
let browser = null;
const devices = [];
// Console errors that say nothing about the product: the outside world is
// cut off on purpose; the service worker's kill-switch file is absent by
// design (a 404 is the answer "carry on"); a page file the Centre's server has
// not been sent yet reads 404; and the pages' <meta http-equiv="X-Frame-
// Options"> is ignored by browsers, which say so as an "error".
function benign(m) {
  const text = m.text(), url = (m.location() || {}).url || '';
  if (/X-Frame-Options may only be set via an HTTP header/.test(text)) return 'x-frame-options meta';
  if (/^Failed to load resource/.test(text)) {
    if (url && !url.startsWith(base)) return 'outside network (blocked)';
    if (/\/sw-disable(\?|$)/.test(url)) return 'sw kill-switch probe';
    if (/\/_cestis\/data\/[^?]+$/.test(url) && /404/.test(text)) return 'server file not yet written';
  }
  return null;
}
async function device(name, opts) {
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true, viewport: { width: 1366, height: 900 }, timezoneId: TZ }, opts || {}));
  await ctx.route('**/*', r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const d = { name, ctx, tabs: [] };
  devices.push(d);
  return d;
}
async function tab(d, label, rel) {
  const page = await d.ctx.newPage();
  const t = { label: d.name + '/' + label, page, errors: [], consoleErrors: [], allowed: {}, dialogs: [] };
  page.on('pageerror', e => t.errors.push(String(e.message).slice(0, 300)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const why = benign(m);
    if (why) t.allowed[why] = (t.allowed[why] || 0) + 1;
    else t.consoleErrors.push(m.text().slice(0, 300) + ((m.location() || {}).url ? ' [' + m.location().url.replace(base, '') + ']' : ''));
  });
  page.on('dialog', dlg => { t.dialogs.push(dlg.message()); dlg.accept().catch(() => {}); });
  d.tabs.push(t);
  await page.goto(base + '/' + (rel || 'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  page.__t = t;
  return page;
}
async function shotAll(id) {
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
  for (const d of devices) for (const t of d.tabs) {
    if (t.page.isClosed()) continue;
    try { await t.page.screenshot({ path: path.join(SHOTS, 'step' + id + '-' + t.label.replace(/[^\w.-]+/g, '_') + '.png'), fullPage: false }); } catch (e) {}
  }
}

/* ---------------------------------------------------------- page helpers */
const waitFor = (page, fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 15000 }).then(() => true, () => false);
async function ackAlerts(page) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const t = await page.evaluate(() => { const m = document.querySelector('.cestis-alert-overlay.active .cestis-alert-msg'); return m ? m.innerText : null; });
    if (t == null) break;
    out.push(t);
    await page.click('.cestis-alert-overlay.active .cestis-alert-ok');
    await page.waitForTimeout(250);
  }
  return out;
}
async function nav(page, dataPage) {
  await ackAlerts(page);
  const sel = '#sidebarNav .nav-item[data-page="' + dataPage + '"]';
  if (!(await page.isVisible(sel))) {
    // Open its collapsed section first, as a person would.
    await page.evaluate(s => { const it = document.querySelector(s); const g = it && it.closest('.nav-section-group'); if (g && g.previousElementSibling) g.previousElementSibling.setAttribute('data-flow-open', '1'); }, sel);
    await page.click('[data-flow-open="1"]');
    await page.evaluate(() => { const l = document.querySelector('[data-flow-open="1"]'); if (l) l.removeAttribute('data-flow-open'); });
  }
  await page.click(sel);
  await page.waitForTimeout(700);
}
// The device's own half-minute refresh from the Centre's server, brought forward.
async function refresh(page) { await page.evaluate(() => CESTISPageCloud.loadNow()); await page.waitForTimeout(500); }
async function syncNow(page) {
  if (!(await page.evaluate(() => !loginSyncCompleted))) return true;
  await page.click('#loginSyncBtn');
  return waitFor(page, () => /Sync complete/.test(document.getElementById('loginSyncStatus').textContent), null, 20000);
}
async function signIn(page, card, user, pass) {
  await ackAlerts(page);
  await syncNow(page);
  if (!(await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), card))) {
    await page.click('#' + card + 'Card .role-enter-btn');
  }
  await page.fill('#' + card + 'User', user);
  await page.fill('#' + card + 'Pass', pass);
  await page.press('#' + card + 'Pass', 'Enter');
  return waitFor(page, () => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, 20000);
}
async function signOut(page) {
  await ackAlerts(page);
  await page.click('.logout-btn');
  return waitFor(page, () => document.getElementById('landingPage').style.display !== 'none' && !document.getElementById('appShell').classList.contains('active'), null, 25000);
}
const text = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return el ? el.innerText : ''; }, sel);
// My Exams keeps showing the last result reviewed until "Back to Exams".
async function examList(page) {
  await nav(page, 's-exams');
  if (await page.isVisible('#studentExamResultView button:has-text("Back to Exams")')) {
    await page.click('#studentExamResultView button:has-text("Back to Exams")');
    await page.waitForTimeout(300);
  }
}
async function download(page, click) {
  const wait = page.waitForEvent('download', { timeout: 40000 }).catch(() => null);
  await click();
  const d = await wait;
  if (!d) return null;
  const buf = fs.readFileSync(await d.path());
  return { name: d.suggestedFilename(), size: buf.length, pdf: buf.slice(0, 5).toString() === '%PDF-', text: buf.toString('utf8') };
}

async function step(id, title, fn) {
  const rec = { id, title, pass: 0, fail: 0, failures: [], error: null, ms: 0 };
  steps.push(rec); current = rec;
  console.log('\n' + id + '. ' + title);
  const t0 = Date.now();
  try { await fn(); }
  catch (e) { rec.error = String(e && e.message || e).split('\n')[0]; failed++; rec.fail++; console.log('  ✗ ERROR: ' + rec.error); }
  rec.ms = Date.now() - t0;
  if (rec.fail) await shotAll(id);
  current = null;
}

/* ------------------------------------------------------------ the Centre */
const PROG = 'Welding & Fabrication';
const ADMIN_PW = 'Centre-Admin-2026!';
const INS = { name: 'Ian Instructor', user: 'ian.instructor', pass: 'Ins-Pass-123', email: 'ian@example.test' };
const AMA = { name: 'Ama Mensah', user: 'ama', pass: 'Ama-Pass-123', email: 'ama@example.test' };
const SHANTE = { name: "Shanté O'Neil", user: 'shante', pass: 'Sha-Pass-123', email: 'shante@example.test' };
const KOFI = { name: 'Kofi Boateng', user: 'kofi', pass: 'Kof-Pass-123', email: 'kofi@example.test' };
const YAW = { name: 'Yaw Darko', email: 'yaw.darko@example.test', pass: 'Yaw-Pass-123' };
const CLASS = 'Welding Safety — Session 1';
const ASSIGNMENT = 'Fuel Gas Safety Report';
const EXAM = 'MEMCOR0141D Follow OH&S principles — Unit Test';
const EVENT = 'Workshop safety walk-round';
const ANN_TITLE = "Graduation rehearsal & gown fitting";
const ANN_BODY = "All trainees of the Welding & Fabrication intake: the graduation rehearsal is in the main hall. " +
  "Bring your trainee ID and arrive fifteen minutes early; gowns are fitted in Room 4 after the rehearsal. " +
  "Shanté's group sits on the left, Ama's on the right. Parents and guardians are welcome at the ceremony itself " +
  "but not at the rehearsal. Questions go to the office — the last line of this notice must show in full.";

let office, laptop, phone, lab, A, I, P, L;
const ids = {};
let today = '', weekend = false, signedUrl = '', certNo = '';

(async function main() {
  await startServer();
  browser = await chromium.launch({ executablePath: EXE,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

  /* ================================================================== 1 */
  await step('1', 'Admin: a new intake, three trainees and an instructor; a self-registration approved', async () => {
    office = await device('office-pc');
    A = await tab(office, 'admin');
    ok(await A.evaluate(() => document.querySelector('#adminCard .role-enter-btn').disabled), 'a brand-new Centre: sign-in waits for a sync');
    ok(await syncNow(A), 'Sync Now syncs with the Centre\'s server and opens sign-in (no internet needed)');
    await A.click('#adminCard .role-enter-btn');
    await A.fill('#adminUser', 'cestisadmin');
    await A.fill('#adminPass', 'cestisadmin123$');
    await A.press('#adminPass', 'Enter');
    ok(await waitFor(A, () => document.getElementById('forceChangePwModal').classList.contains('active')), 'the published first-run password only leads to "set a new password"');
    await A.fill('#forceChangePwNew', ADMIN_PW);
    await A.fill('#forceChangePwConfirm', ADMIN_PW);
    await A.click('#forceChangePwModal button:has-text("Set Password")');
    ok(await waitFor(A, () => currentRole === 'admin' && document.getElementById('appShell').classList.contains('active')), 'the administrator is in');
    today = await A.evaluate(() => localDateStr());
    weekend = await A.evaluate(d => CESTISCore.attendance.dayName(d) === '', today);

    await nav(A, 'training');
    await A.click('#trainingAdminControls button:has-text("Add Training Centre")');
    await A.fill('#newCentreName', PROG);
    await A.fill('#newCentreDesc', 'Welding and fabrication, NVQ-J Level 2 — this year\'s intake');
    await A.click('#addCentreModal button:has-text("Add Centre")');
    await A.waitForTimeout(500);
    const toast = await text(A, '#toastContainer');
    const intake = await A.evaluate(n => { const c = skillAreas.filter(s => s.name === n); const x = c[c.length - 1]; return { id: x.id, key: CESTISCore.enrolment.centreKeyOf(x), n: c.length }; }, PROG);
    ids.intake = intake;
    ok(intake.n === 2 && intake.key && intake.key !== '01' && new RegExp('intake ' + intake.key).test(toast),
      'a programme the Centre already runs gets a NEW intake with its own key (' + intake.key + '): ' + toast.replace(/\s+/g, ' ').slice(0, 120));
    await nav(A, 'course-duration');
    const dates = await A.evaluate(d => ({ start: CESTISCore.attendance.addDays(d, -50), end: CESTISCore.attendance.addDays(d, 160) }), today);
    await A.fill('#cdStart_' + intake.id, dates.start);
    await A.fill('#cdEnd_' + intake.id, dates.end);
    await A.click('button[onclick="cdSaveCentre(' + intake.id + ')"]');
    await A.waitForTimeout(400);
    ok(await A.evaluate(([id, s, e]) => { const c = skillAreas.find(x => x.id === id); return c.startDate === s && c.endDate === e; }, [intake.id, dates.start, dates.end]), 'the intake runs ' + dates.start + ' to ' + dates.end);

    await nav(A, 'settings');
    await A.click('.tab:has-text("User Accounts")');
    for (const [who, role] of [[INS, 'instructor'], [AMA, 'student'], [SHANTE, 'student'], [KOFI, 'student']]) {
      await A.click('button:has-text("+ Create User")');
      await A.fill('#newUserName', who.name);
      await A.selectOption('#newUserRole', role);
      await A.fill('#newUserUsername', who.user);
      await A.fill('#newUserPassword', who.pass);
      await A.fill('#newUserEmail', who.email);
      await A.selectOption('#newUserProgramme', PROG);
      await A.click('#createUserModal button:has-text("Create User")');
      await A.waitForTimeout(600);
    }
    const roll = await A.evaluate(([names, cid]) => names.map(n => { const s = students.find(x => x.name === n); return s ? { id: s.id, centreId: s.centreId, course: s.course, stage: s.stage } : null; }), [[AMA.name, SHANTE.name, KOFI.name], intake.id]);
    ok(roll.every(r => r && r.course === PROG && r.centreId === intake.id), 'each trainee is on the new intake (' + JSON.stringify(roll) + ')');
    [ids.ama, ids.shante, ids.kofi] = roll.map(r => r && r.id);
    ok(/Shanté O'Neil/.test(await text(A, '#page-settings')), 'the apostrophe in "Shanté O\'Neil" shows as typed in the accounts list');
    ok(await A.evaluate(n => instructorData.some(i => i.name === n), INS.name), 'the instructor has an instructor record');
    ok(!!(await serverHas('voctrain_users', l => ['ian.instructor', 'ama', 'shante', 'kofi'].every(u => l.some(a => a.username === u)))), 'the accounts reach the Centre\'s server');

    // A walk-in registers at the front desk: a second tab on the same PC.
    const D = await tab(office, 'front-desk');
    ok(!(await D.evaluate(() => document.querySelector('#studentCard .role-enter-btn').disabled)), 'the front-desk tab is open for sign-in (the PC holds the Centre\'s accounts)');
    await D.click('#studentCard .role-enter-btn');
    await D.click('#studentCard button:has-text("New student? Register here")');
    await D.fill('#regName', YAW.name);
    await D.fill('#regEmail', YAW.email);
    await D.selectOption('#regProgramme', PROG);
    await D.fill('#regPassword', YAW.pass);
    await D.fill('#regPasswordConfirm', YAW.pass);
    await D.click('.reg-actions button:has-text("Register")');
    ok(await waitFor(D, () => /Thank You for Registering/.test((document.getElementById('pendingApprovalScreen') || {}).innerText || '')), 'the registration waits for approval');
    await D.close();
    await nav(A, 'verify-users');
    ok(await waitFor(A, n => /Yaw Darko/.test(document.getElementById('verifyUsersTableBody').innerText), null, 15000), 'the administrator\'s tab lists the registration without a reload');
    await A.click('#verifyUsersTableBody tr:has-text("Yaw Darko") button:has-text("Activate")');
    ok(await waitFor(A, e => { const u = userAccounts.find(x => x.email === e); return !!u && u.status === 'active' && students.some(s => s.name === 'Yaw Darko'); }, YAW.email),
      'approved: the account is active and the trainee is on the roll');
  });

  /* ================================================================== 2 */
  await step('2', 'Instructor: a class scheduled, held live with a trainee, and taken into the register', async () => {
    laptop = await device('laptop');
    I = await tab(laptop, 'instructor');
    ok(await signIn(I, 'instructor', INS.user, INS.pass), 'the instructor signs in on a new laptop (Sync Now first)');
    await nav(I, 'i-classes');
    await I.click('#iVideoContent button:has-text("+ New Class Session")');
    await I.fill('#csSessionName', CLASS);
    await I.selectOption('#csCourse', PROG);
    const now = await I.evaluate(() => ({ d: localDateStr(), t: new Date().toTimeString().slice(0, 5) }));
    await I.fill('#csDate', now.d);
    await I.fill('#csTime', now.t);
    await I.fill('#csDuration', '60');
    await I.click('#createClassSessionModal button:has-text("Create Session")');
    ok(await waitFor(I, n => document.getElementById('iClassSessionsList').innerText.indexOf(n) !== -1, CLASS), 'the session is on the instructor\'s list');
    await I.locator('#iClassSessionsList .class-schedule-card', { hasText: CLASS }).locator('button:has-text("Join")').click();
    await I.waitForTimeout(1200);
    await I.click('#iVideoRoom button:has-text("Start Session")');
    ok(await waitFor(I, () => !!document.querySelector('#vc-video-grid') && isRoomHost && classSessions.some(s => s.status === 'live'), null, 20000), 'the small room is open, hosted by the instructor, and the class is live');

    phone = await device('ama-phone');
    P = await tab(phone, 'ama');
    ok(await signIn(P, 'student', AMA.user, AMA.pass), 'Ama signs in on her phone (Sync Now first)');
    await nav(P, 's-video');
    let live = false;
    for (let i = 0; i < 6 && !live; i++) { await refresh(P); live = /Live Now/.test(await text(P, '#sClassSessionsList')); }
    ok(live, 'My Classes shows the class as Live Now');
    await P.click('#sClassSessionsList button:has-text("Join Class")');
    await P.waitForTimeout(1500);
    ok((await P.inputValue('#vc-join-code')) !== '', 'the lobby carries the room code');
    await P.click('#sVideoRoom button:has-text("Join"):not(:has-text("Class"))');
    ok(await waitFor(P, () => { const v = document.querySelector('#vc-video-grid .host-tile video'); return !!(v && v.srcObject && v.srcObject.getVideoTracks().length); }, null, 30000),
      'Ama sees the instructor\'s tile, with a picture');
    ok(await waitFor(I, n => Object.keys(peerNames).some(k => peerNames[k] === n), AMA.name, 15000), 'the instructor sees Ama in the room');
    await I.waitForTimeout(1500);
    await I.click('#iVideoRoom .vc-end-all-btn');
    ok(await waitFor(P, () => /ended by the host/i.test((document.querySelector('.cestis-alert-overlay.active') || {}).innerText || ''), null, 15000), 'Ama is told the host ended the class');
    await ackAlerts(P);
    ok(await waitFor(I, () => !document.querySelector('#vc-video-grid') && classSessions.some(s => s.status === 'completed')), 'the class is over for the instructor too');

    if (weekend) { note('today is a weekend: the register is Monday–Friday, so the register checks are skipped'); return; }
    await nav(I, 'i-attendance');
    ok(await waitFor(I, () => /Live classes this week/.test(document.getElementById('iAttendanceLiveClasses').innerText)), 'the register offers the live class of this week');
    await I.click('#iAttendanceLiveClasses button:has-text("Review & add to register")');
    const dlg = await text(I, '#attLiveDialog');
    ok(/Ama Mensah/.test(dlg) && /min/.test(dlg), 'the review lists Ama with the time she spent in the room');
    await I.selectOption('#attLiveDialog tr:has-text("Ama Mensah") select', 'present');
    await I.click('#attLiveDialog button:has-text("Add ticked marks")');
    await I.waitForTimeout(400);
    await I.selectOption('#iAttendanceTableBody select[data-date="' + today + '"][data-sid="' + ids.kofi + '"]', 'absent');
    await I.click('button:has-text("Mark all present (picked date)")');
    await I.click('button:has-text("Save Attendance")');
    const marks = () => I.evaluate(d => { const o = {}; document.querySelectorAll('#iAttendanceTableBody select[data-date="' + d + '"]').forEach(s => { o[s.getAttribute('data-sid')] = s.value; }); return o; }, today);
    let m = await marks();
    ok(m[ids.ama] === 'present' && m[ids.kofi] === 'absent' && m[ids.shante] === 'present', 'today: Ama present (from the live class), Kofi absent, Shanté present (' + JSON.stringify(m) + ')');
    const reg = await serverHas('voctrain_attendanceRegister', r => r.filter(x => x.date === today).length >= 4);
    ok(!!reg && reg.some(x => x.studentId === ids.ama && x.date === today && x.source === 'live-class'), 'the dated register reaches the Centre\'s server, the live-class mark marked as such');

    await I.reload({ waitUntil: 'load' });
    await I.waitForTimeout(1200);
    ok(await signIn(I, 'instructor', INS.user, INS.pass), 'after a reload the instructor signs in again');
    await nav(I, 'i-attendance');
    m = await marks();
    ok(m[ids.ama] === 'present' && m[ids.kofi] === 'absent' && m[ids.shante] === 'present', 'the marks for ' + today + ' are still there (' + JSON.stringify(m) + ')');
    const label = () => text(I, '[data-att-week-label]');
    const thisWeek = await label();
    await I.click('#iAttendanceQuarterBar button:has-text("Previous week")');
    await I.waitForTimeout(300);
    ok((await label()) !== thisWeek && Object.keys(await marks()).length === 0, 'Previous week shows another week, without today\'s column');
    await I.click('#iAttendanceQuarterBar button:has-text("Next week")');
    await I.click('#iAttendanceQuarterBar button:has-text("Next week")');
    await I.waitForTimeout(300);
    ok(/Week of/.test(await label()) && Object.keys(await marks()).length === 0, 'Next week moves on again');
    await I.click('#iAttendanceQuarterBar button:has-text("This week")');
    await I.waitForTimeout(300);
    m = await marks();
    ok((await label()) === thisWeek && m[ids.ama] === 'present' && m[ids.kofi] === 'absent', 'This week comes back to today\'s marks');
  });

  /* ================================================================== 3 */
  let due = '';
  await step('3', 'Assignment: set, submitted, graded (a 0 included); each trainee sees only their own mark', async () => {
    await nav(I, 'i-gradebook');
    await I.click('#page-i-gradebook button:has-text("+ New Assignment")');
    due = await I.evaluate(() => CESTISCore.attendance.addDays(localDateStr(), 7));
    await I.fill('#assignTitle', ASSIGNMENT);
    await I.selectOption('#assignType', 'report');
    await I.fill('#assignDueDate', due);
    await I.fill('#assignMaxPoints', '100');
    await I.fill('#assignInstructions', 'Describe how to store and handle oxy-acetylene cylinders.');
    await I.click('#createAssignmentModal button:has-text("Create Assignment")');
    ok(await waitFor(I, n => document.getElementById('iCustomAssignmentsList').innerText.indexOf(n) !== -1, ASSIGNMENT), 'the assignment is on the instructor\'s list, due ' + due);
    await serverHas('voctrain_assignments', l => l.some(a => a.title === ASSIGNMENT));

    await nav(P, 's-assignments');
    let seen = false;
    for (let i = 0; i < 5 && !seen; i++) { await refresh(P); seen = (await text(P, '#page-s-assignments')).indexOf(ASSIGNMENT) !== -1; }
    ok(seen, 'Ama sees the assignment');
    await P.locator('#page-s-assignments .card', { hasText: ASSIGNMENT }).last().locator('button:has-text("Upload Submission")').click();
    await P.setInputFiles('#submitFileInput', { name: 'ama-gas-safety.txt', mimeType: 'text/plain', buffer: Buffer.from('Cylinders upright, chained, valves closed, away from heat.') });
    await P.fill('#submitComment', 'My report');
    await P.click('#submitAssignBtn');
    ok(await waitFor(P, n => { const c = Array.from(document.querySelectorAll('#page-s-assignments .card .card')).find(x => x.innerText.indexOf(n) !== -1); return !!c && /Your Submission/.test(c.innerText) && /ama-gas-safety\.txt/.test(c.innerText); }, ASSIGNMENT),
      'her submission is shown with its file');

    lab = await device('lab-pc');
    L = await tab(lab, 'lab');
    ok(await signIn(L, 'student', KOFI.user, KOFI.pass), 'Kofi signs in on the shared lab PC');
    await nav(L, 's-assignments');
    await L.locator('#page-s-assignments .card', { hasText: ASSIGNMENT }).last().locator('button:has-text("Upload Submission")').click();
    await L.setInputFiles('#submitFileInput', { name: 'kofi-report.txt', mimeType: 'text/plain', buffer: Buffer.from('Kofi') });
    await L.click('#submitAssignBtn');
    await L.waitForTimeout(800);
    ok(!!(await serverHas('voctrain_submissions', l => [ids.ama, ids.kofi].every(s => l.some(x => x.studentId === s)))), 'both submissions reach the Centre\'s server');

    await nav(I, 'i-gradebook');
    let both = false;
    for (let i = 0; i < 5 && !both; i++) { await refresh(I); both = /2 submissions/.test(await I.locator('#iCustomAssignmentsList .card', { hasText: ASSIGNMENT }).innerText()); }
    ok(both, 'the instructor sees both submissions');
    const aid = await I.evaluate(n => instructorAssignments.find(a => a.title === n).id, ASSIGNMENT);
    ids.assignment = aid;
    await I.fill('#grade-' + aid + '-' + ids.ama, '85');
    await I.locator('#grade-' + aid + '-' + ids.ama + ' + button').click();
    await I.waitForTimeout(300);
    await I.fill('#grade-' + aid + '-' + ids.kofi, '0');
    await I.locator('#grade-' + aid + '-' + ids.kofi + ' + button').click();
    await I.waitForTimeout(300);
    const card = await I.locator('#iCustomAssignmentsList .card', { hasText: ASSIGNMENT }).innerText();
    ok(/85\/100/.test(card) && /0\/100/.test(card), 'the instructor\'s list shows 85/100 and 0/100');
    ok(!!(await serverHas('voctrain_assignments', l => { const a = l.find(x => x.id === aid); return a && a.grades && a.grades[ids.ama] != null && a.grades[ids.kofi] != null; })), 'both marks reach the Centre\'s server');

    await refresh(P);
    await nav(P, 's-assignments');
    const pa = await text(P, '#page-s-assignments');
    ok(/Graded: 85\/100 \(85%\)/.test(pa), 'Ama sees her own mark, 85/100');
    ok(!/0\/100/.test(pa) && !/Kofi/.test(pa), 'and nobody else\'s');
    await refresh(L);
    await nav(L, 's-assignments');
    const pl = await text(L, '#page-s-assignments');
    ok(/Graded: 0\/100 \(0%\)/.test(pl), 'Kofi sees his 0 as a mark ("Graded: 0/100"), not as "Submitted"');
    ok(!/85\/100/.test(pl) && !/Ama/.test(pl), 'and not Ama\'s');
  });

  /* ================================================================ 4a */
  let deadline = 0;
  await step('4a', 'Exam: MCQ + true/false + essay, open now; sat by two trainees, one resuming after a refresh', async () => {
    await nav(I, 'i-exams');
    await I.click('#page-i-exams button:has-text("+ Create Exam")');
    await I.fill('#examTitle', EXAM);
    const start = await I.evaluate(() => CESTISCore.exams.centreParts(Date.now() - 60000));
    await I.selectOption('#examCourse', PROG);
    await I.fill('#examDate', start.date);
    await I.fill('#examTime', start.time);
    await I.fill('#examDuration', '45');
    await I.fill('#examPassMark', '60');
    await I.selectOption('#examAnswersRelease', 'after-close');
    await I.fill('#examInstructions', 'Answer every question. The essay is marked by your instructor.');
    await I.click('#examStep1 button:has-text("Next: Add Questions")');
    await I.click('.add-question-bar button:has-text("+ Multiple Choice")');
    const q = n => '#qItem-' + n + ' input[placeholder="Enter your question here..."]';
    await I.fill(q(0), 'Which colour is the acetylene hose?');
    await I.dispatchEvent(q(0), 'change');
    const opts = I.locator('#qItem-0 .q-option-row input[type=text]');
    const OPTS = ['Blue', 'Red', 'Green', 'Black'];
    for (let i = 0; i < 4; i++) { await opts.nth(i).fill(OPTS[i]); await opts.nth(i).dispatchEvent('change'); }
    await I.locator('#qItem-0 .q-option-row input[type=radio]').nth(1).check();
    await I.click('.add-question-bar button:has-text("+ True / False")');
    await I.fill(q(1), 'A flashback arrestor stops a flame travelling back into the cylinder.');
    await I.dispatchEvent(q(1), 'change');
    await I.locator('#qItem-1 input[type=radio]').first().check();
    await I.click('.add-question-bar button:has-text("+ Short Answer")');
    await I.fill(q(2), 'Explain why cylinders must be stored upright and chained.');
    await I.dispatchEvent(q(2), 'change');
    await I.fill('#qItem-2 input[type=number]', '4');
    await I.dispatchEvent('#qItem-2 input[type=number]', 'change');
    await I.click('#createExamPublishBtn');
    ok(await waitFor(I, n => { const e = exams.find(x => x.title === n); return !!e && examStatusNow(e) === 'active' && e.answersRelease === 'after-close' && e.questionData.length === 3; }, EXAM),
      'the exam is open now, three questions, answers shown after it closes');
    await serverHas('voctrain_exams', l => l.some(e => e.title === EXAM));

    await nav(P, 's-exams');
    let listed = false;
    for (let i = 0; i < 5 && !listed; i++) { await refresh(P); listed = (await text(P, '#studentUpcomingExams')).indexOf(EXAM) !== -1; }
    ok(listed, 'Ama sees the exam');
    await P.locator('#studentUpcomingExams .class-schedule-card', { hasText: EXAM }).locator('button:has-text("Take Exam")').click();
    ok(await waitFor(P, () => !!document.querySelector('#studentExamTakingView .exam-taking')), 'Ama starts it');
    await P.locator('#examQ-0 label.exam-opt', { hasText: 'Red' }).click();
    await P.locator('#examQ-1 label.tf-btn', { hasText: 'True' }).click();
    await P.fill('#examQ-2 textarea', 'So they cannot fall: a broken valve turns a cylinder into a rocket.');
    await P.waitForTimeout(1500);                       // the attempt is saved 0.8 s after an answer
    deadline = await P.evaluate(() => currentExamSession.deadline);
    // A refresh in the middle of the exam (the page reloads; the trainee signs in again).
    await P.reload({ waitUntil: 'load' });
    await P.waitForTimeout(1200);
    ok(await signIn(P, 'student', AMA.user, AMA.pass), 'after the refresh Ama signs in again');
    await nav(P, 's-exams');
    const resume = await P.locator('#studentUpcomingExams .class-schedule-card', { hasText: EXAM }).locator('button').innerText();
    ok(/Resume \(\d+:\d\d left\)/.test(resume), 'My Exams offers to resume, with the time left (' + resume + ')');
    await P.locator('#studentUpcomingExams .class-schedule-card', { hasText: EXAM }).locator('button').click();
    ok(await waitFor(P, () => !!document.querySelector('#studentExamTakingView .exam-taking')), 'the exam opens again');
    const back = await P.evaluate(() => ({ deadline: currentExamSession.deadline, mcq: (document.querySelector('#examQ-0 input:checked') || {}).value,
      tf: (document.querySelector('#examQ-1 input:checked') || {}).value, essay: document.querySelector('#examQ-2 textarea').value,
      timer: document.getElementById('examTimerValue').textContent }));
    ok(back.deadline === deadline, 'with the original clock — the same deadline, not a fresh timer (' + back.timer + ' left)');
    ok(back.mcq === '1' && back.tf === 'true' && /rocket/.test(back.essay), 'and every answer restored (' + JSON.stringify({ mcq: back.mcq, tf: back.tf }) + ')');
    await P.click('#studentExamTakingView button:has-text("Submit Exam")');
    ok(await waitFor(P, () => /PENDING INSTRUCTOR REVIEW/i.test(document.getElementById('studentExamResultView').innerText)), 'submitted: the result is pending instructor review (the essay)');
    const rv = await text(P, '#studentExamResultView');
    ok(!/Correct answer:/.test(rv), 'no correct answers are shown yet');
    await P.click('#studentExamResultView button:has-text("Back to Exams")');
    ok(/Awaiting marking/.test(await text(P, '#studentPastExamResults')), 'her past results say "Awaiting marking"');

    // The shared lab PC: Kofi signs out, Shanté signs in and sits the exam.
    ok(await signOut(L), 'Kofi signs out of the lab PC');
    ok(await signIn(L, 'student', SHANTE.user, SHANTE.pass), 'Shanté signs in on the same PC');
    ok(await L.evaluate(n => currentStudent && currentStudent.name === n, SHANTE.name), 'as herself (the apostrophe intact)');
    await nav(L, 's-exams');
    await refresh(L);
    await L.locator('#studentUpcomingExams .class-schedule-card', { hasText: EXAM }).locator('button:has-text("Take Exam")').click();
    await waitFor(L, () => !!document.querySelector('#studentExamTakingView .exam-taking'));
    await L.locator('#examQ-0 label.exam-opt', { hasText: 'Blue' }).click();        // wrong
    await L.locator('#examQ-1 label.tf-btn', { hasText: 'True' }).click();
    await L.fill('#examQ-2 textarea', "Shanté's answer: they could fall and the valve could break off.");
    await L.waitForTimeout(1000);
    await L.click('#studentExamTakingView button:has-text("Submit Exam")');
    ok(await waitFor(L, () => /PENDING INSTRUCTOR REVIEW/i.test(document.getElementById('studentExamResultView').innerText)), 'Shanté\'s result is pending review too');
    const lv = await text(L, '#studentExamResultView');
    ok(/Correct answers will be shown here once the exam has closed/.test(lv) && !/Correct answer:/.test(lv), 'her wrong answer is marked wrong, but the right one is withheld until the exam closes');
    ok(!!(await serverHas('voctrain_examResults', l => [ids.ama, ids.shante].every(s => l.some(r => r.studentId === s)))), 'both results reach the Centre\'s server');

    // Nobody sees a classmate's score.
    await refresh(P);
    await nav(P, 's-exams');
    const mine = await text(P, '#page-s-exams');
    ok(!/Shanté|O'Neil/.test(mine) && !/17%/.test(mine), 'Ama\'s exam page shows no classmate and no classmate\'s score');
    await nav(P, 's-dashboard');
    ok(!/Shanté|O'Neil/.test(await text(P, '#page-s-dashboard')), 'nor does her dashboard');
  });

  /* ================================================================ 5a */
  const tgFrame = () => A.frame({ url: /Transcript-Grades\.html/ });
  async function tgRow() {
    const fr = tgFrame();
    return fr.evaluate(() => Array.from(document.querySelectorAll('table tr')).filter(tr => /MEMCOR0141D/.test(tr.innerText)).map(tr => tr.innerText.replace(/\s+/g, ' ')));
  }
  await step('5a', 'Admin: Transcript/Grades shows the unit "Awaiting marking"; the transcript PDF is produced', async () => {
    await refresh(A);
    await nav(A, 'transcript-grades');
    ok(await waitFor(A, () => { const f = document.getElementById('transcriptGradesFrame'); return !!(f && f.contentWindow && f.contentWindow.VIEWER && f.contentWindow.VIEWER.ok); }, null, 15000), 'the Transcript/Grades editor opens for the administrator');
    const fr = tgFrame();
    await fr.selectOption('#tgStudentSel', ids.ama);
    await A.waitForTimeout(800);
    ok((await fr.evaluate(() => document.getElementById('tgQualSel').value)) === 'QUAL-WEL-L2', 'Ama\'s programme opens its qualification (WELDING LEVEL 2)');
    const rows = await tgRow();
    ok(rows.length > 0 && rows.every(r => /awaiting marking/i.test(r)) && !rows.some(r => /33%/.test(r)), 'unit MEMCOR0141D (the exam carries its code) reads "Awaiting marking", never the provisional 33% (' + rows.join(' / ').slice(0, 220) + ')');
    const pdf = await download(A, () => fr.click('button:has-text("Download Transcript (PDF)")'));
    ok(pdf && pdf.pdf && pdf.size > 1000, 'the transcript PDF is produced (' + (pdf ? pdf.name + ', ' + pdf.size + ' bytes' : 'no download') + ')');
  });

  /* ================================================================ 4b */
  await step('4b', 'Exam: the instructor marks the essays, releases the answers; trainees see their final results', async () => {
    await refresh(I);
    await nav(I, 'i-exams');
    await I.click('#page-i-exams .tab:has-text("Active Now")');
    await I.locator('#iExamTableBody tr', { hasText: EXAM }).locator('button:has-text("Monitor")').click();
    ok(await waitFor(I, () => /2 awaiting marking/.test(document.getElementById('iExamResultsView').innerText)), 'the results show two submissions awaiting marking');
    await I.locator('#iExamResultsView tr', { hasText: AMA.name }).locator('button:has-text("Grade")').click();
    await I.fill('#gradingPanel [id^="gradePoints-"]', '3');
    await I.dispatchEvent('#gradingPanel [id^="gradePoints-"]', 'change');
    ok(/83%/.test(await text(I, '#gpPreviewScore')), 'awarding 3 of 4 moves the preview to 83%');
    await I.fill('#gradingPanel [id^="gradeFeedback-"]', 'Good. Mention the cylinder cap too.');
    await I.click('#gradingPanel button:has-text("Save Grades")');
    ok(await waitFor(I, () => !document.getElementById('gradingPanel')), 'Save Grades closes the panel');
    await I.locator('#iExamResultsView tr', { hasText: SHANTE.name }).locator('button:has-text("Grade")').click();
    await I.click('#gradingPanel .grade-quick-btns button.half');
    await I.click('#gradingPanel button:has-text("Save Grades")');
    await I.waitForTimeout(500);
    const res = await I.evaluate(([e, a, s]) => { const ex = exams.find(x => x.title === e); const r = id => examResults.find(x => x.examId === ex.id && x.studentId === id); return [r(a), r(s)].map(x => x && { score: x.score, passed: x.passed, final: CESTISCore.exams.isFinal(x) }); }, [EXAM, ids.ama, ids.shante]);
    ok(res[0] && res[0].score === 83 && res[0].passed && res[0].final, 'Ama: 83%, passed, final (' + JSON.stringify(res[0]) + ')');
    ok(res[1] && res[1].score === 50 && !res[1].passed && res[1].final, 'Shanté: 50%, not passed, final (' + JSON.stringify(res[1]) + ')');
    await I.click('#iExamResultsView button:has-text("Release correct answers now")');
    ok(await waitFor(I, () => /released to trainees/.test(document.getElementById('iExamResultsView').innerText)), 'the correct answers are released');
    ok(!!(await serverHas('voctrain_exams', l => l.some(e => e.title === EXAM && e.answersRelease === 'released'))) &&
       !!(await serverHas('voctrain_examResults', l => l.filter(r => r.reviewComplete).length >= 2)), 'the marks and the release reach the Centre\'s server');

    await refresh(L);
    await examList(L);
    await L.locator('#studentPastExamResults button:has-text("Review")').first().click();
    ok(await waitFor(L, () => /NOT PASSED/.test(document.getElementById('studentExamResultView').innerText)), 'Shanté sees her final result');
    const sv = await text(L, '#studentExamResultView');
    ok(/50%/.test(sv) && /Correct answer: B/.test(sv), 'with her score (50%) and, now released, the correct answer to the question she got wrong');
    ok(!/Ama/.test(sv), 'and nothing about Ama');
    await refresh(P);
    await examList(P);
    ok(/Passed/.test(await text(P, '#studentPastExamResults')), 'Ama\'s past results now say Passed');
    await P.locator('#studentPastExamResults button:has-text("Review")').first().click();
    const av = await text(P, '#studentExamResultView');
    ok(/83%/.test(av) && /PASSED/.test(av) && /Mention the cylinder cap/.test(av), 'Ama sees 83%, PASSED, and her instructor\'s feedback');
  });

  /* ================================================================ 5b */
  await step('5b', 'Admin: after marking, Transcript/Grades carries the final grade; the PDF again', async () => {
    let rows = [];
    for (let i = 0; i < 6; i++) { await refresh(A); await A.waitForTimeout(1500); rows = await tgRow(); if (rows.some(r => /83%/.test(r))) break; }
    ok(rows.some(r => /83%/.test(r)) && rows.some(r => /live exam/i.test(r)) && !rows.some(r => /awaiting marking/i.test(r)),
      'unit MEMCOR0141D now shows 83% from the live exam (' + rows.join(' / ').slice(0, 220) + ')');
    const pdf = await download(A, () => tgFrame().click('button:has-text("Download Transcript (PDF)")'));
    ok(pdf && pdf.pdf && pdf.size > 1000, 'the transcript PDF is produced (' + (pdf ? pdf.size + ' bytes' : 'no download') + ')');
  });

  /* ================================================================== 6 */
  await step('6', 'Certificate: checklist, approval, signing, the PDF, a number that never changes, withdrawal, QR check', async () => {
    // The Centre's certificate design, once: a background for each page.
    await nav(A, 'cert-downloads');
    await A.selectOption('#certTemplateSkillSelect', PROG);
    await A.click('button:has-text("Edit Template")');
    const png = Buffer.from(await A.evaluate(() => { const c = document.createElement('canvas'); c.width = 1123; c.height = 794; const g = c.getContext('2d'); g.fillStyle = '#fdf8ec'; g.fillRect(0, 0, 1123, 794); g.strokeStyle = '#8a6d1d'; g.lineWidth = 18; g.strokeRect(20, 20, 1083, 754); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    await A.setInputFiles('#ctplBgPage1', { name: 'page1.png', mimeType: 'image/png', buffer: png });
    await A.setInputFiles('#ctplBgPage2', { name: 'page2.png', mimeType: 'image/png', buffer: png });
    await A.fill('#ctplCourseFullName', 'Welding and Fabrication Level 2');
    await A.waitForTimeout(500);
    await A.click('#certTemplateEditorModal button:has-text("Save Template")');
    ok(await waitFor(A, n => !!(certTemplates[n] && certTemplates[n].bgPage1), PROG), 'the certificate design is saved');

    // Issue: Student Progress -> Update -> Certified, with the checklist.
    await nav(A, 'students');
    const sp = () => A.frame({ url: /Student-Progress\.html/ });
    await waitFor(A, () => { const f = document.getElementById('studentProgressFrame'); return !!(f && f.contentWindow && f.contentWindow.students && f.contentWindow.students.length); }, null, 15000);
    await sp().locator('tr', { hasText: AMA.name }).locator('button:has-text("Update")').click();
    await sp().selectOption('#newStage', 'certified');
    const check = await sp().evaluate(() => document.getElementById('spCertChecklist').innerText);
    ok(/Before issuing the certificate/i.test(check) && /Transcript results/.test(check) && /Attendance/.test(check) && /Fees/.test(check),
      'the eligibility checklist shows before the certificate is issued (' + check.replace(/\s+/g, ' ').slice(0, 160) + ')');
    await sp().click('#updateStageModal button:has-text("Update")');
    ok(await waitFor(A, id => { const s = students.find(x => x.id === id); return !!(s && s.stage === 'certified' && s.certNo); }, ids.ama, 15000), 'Ama is certified');
    certNo = await A.evaluate(id => students.find(x => x.id === id).certNo, ids.ama);
    ok(/^WE-\d{4}-\d{4}-[A-Z]{2}$/.test(certNo), 'the certificate number has the Centre\'s format: ' + certNo);

    // A signing key, then the download approval (which signs it).
    await nav(A, 'cert-downloads');
    await A.click('#certSigningPanel button:has-text("Create signing key")');
    ok(await waitFor(A, () => /signs with key/i.test(document.getElementById('certSigningPanel').innerText), null, 15000), 'this PC now holds the Centre\'s signing key');
    await A.locator('#certDlStudentList .cert-approve-row', { hasText: AMA.name }).locator('button:has-text("Approve Download")').click();
    ok(await waitFor(A, n => { const r = Array.from(document.querySelectorAll('#certDlStudentList .cert-approve-row')).find(x => x.innerText.indexOf(n) !== -1); return !!r && /Approved/.test(r.innerText) && /Signed/.test(r.innerText); }, AMA.name, 15000),
      'the download is approved and the certificate signed');
    const keys = await download(A, () => A.click('#certSigningPanel button:has-text("Download cert-keys.json")'));
    ok(keys && /"publicJwk"/.test(keys.text) && !/"d"\s*:/.test(keys.text), 'the public key file is exported (no private part in it)');
    if (keys) publishKeys(keys.text);
    signedUrl = await A.evaluate(id => certSignedUrlFor(students.find(x => x.id === id)), ids.ama);
    ok(/[?&]s=/.test(signedUrl), 'the certificate\'s QR address carries its signature');

    // The trainee's own phone: the certificate is there...
    ok(!!(await serverHas('voctrain_students', l => { const s = l.find(x => x.id === ids.ama); return s && s.stage === 'certified' && s.certNo === certNo; })), 'the certificate reaches the Centre\'s server');
    let mc = '';
    for (let i = 0; i < 5; i++) {
      await refresh(P);
      await nav(P, 's-certificate');
      mc = await text(P, '#page-s-certificate');
      if (mc.indexOf(certNo) !== -1) break;
    }
    ok(mc.indexOf(certNo) !== -1 && /Download Certificate/.test(mc), 'Ama\'s phone shows her certificate and its number' +
      (mc.indexOf(certNo) === -1 ? ' — ' + JSON.stringify(await P.evaluate(id => ({ cur: currentStudent && [currentStudent.id, currentStudent.stage, currentStudent.certNo],
        mem: (students.find(s => s.id === id) || {}).stage, same: students.indexOf(currentStudent) !== -1,
        stored: (JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').find(s => s.id === id) || {}).stage }), ids.ama)) : ''));
    // ...but the design (its background images) lives only on the PC that
    // uploaded it, and on Google Drive online: on the Centre's network a
    // trainee's own device cannot build the PDF. Recorded, not asserted.
    const phoneWait = P.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await P.click('#page-s-certificate button:has-text("Download Certificate")');
    await P.waitForTimeout(1500);
    const phoneSays = (await text(P, '#toastContainer')).replace(/\s+/g, ' ').trim();
    const phonePdf = await phoneWait;
    if (phonePdf) ok(fs.readFileSync(await phonePdf.path()).slice(0, 5).toString() === '%PDF-', 'the certificate PDF is produced on her phone');
    else note('GAP (Offline System): the certificate PDF cannot be built on a trainee\'s own device — the design\'s background images stay on the PC that uploaded them (IndexedDB) and travel only through Google Drive. Her phone says: "' + phoneSays.slice(0, 160) + '"');
    await ackAlerts(P);
    // ...so she collects it at the office: the front desk of the office PC.
    const D = await tab(office, 'front-desk-2');
    ok(await signIn(D, 'student', AMA.user, AMA.pass), 'Ama signs in at the office front desk');
    await nav(D, 's-certificate');
    const pdf = await download(D, () => D.click('#page-s-certificate button:has-text("Download Certificate")'));
    ok(pdf && pdf.pdf && pdf.size > 1000 && pdf.name.indexOf(certNo) !== -1, 'the certificate PDF is produced (' + (pdf ? pdf.name + ', ' + pdf.size + ' bytes' : 'no download') + ')');
    ok(await signOut(D), 'and she signs out of the front desk');
    await D.close();

    // The number never changes: a later stage, a re-approval.
    await nav(A, 'students');
    await sp().locator('tr', { hasText: AMA.name }).locator('button:has-text("Update")').click();
    await sp().selectOption('#newStage', 'collected');
    await sp().click('#updateStageModal button:has-text("Update")');
    ok(await waitFor(A, ([id, no]) => { const s = students.find(x => x.id === id); return !!s && s.stage === 'collected' && s.certNo === no; }, [ids.ama, certNo]), 'marked collected: the number is unchanged');
    await nav(A, 'cert-downloads');
    await A.locator('#certDlStudentList .cert-approve-row', { hasText: AMA.name }).locator('button:has-text("Revoke")').click();
    await A.waitForTimeout(500);
    await A.locator('#certDlStudentList .cert-approve-row', { hasText: AMA.name }).locator('button:has-text("Approve Download")').click();
    ok(await waitFor(A, ([id, no]) => { const s = students.find(x => x.id === id); const ap = certDownloadApprovals.find(x => x.studentId === id); return !!s && s.certNo === no && !!ap && ap.approved; }, [ids.ama, certNo]), 'approval withdrawn and given again: the number is unchanged');
    ok(!!(await serverHas('voctrain_students', l => { const s = l.find(x => x.id === ids.ama); return s && s.certNo === certNo && s.stage === 'collected'; })), 'and the Centre\'s server holds that same number');

    // An employer checks the QR address, signed in nowhere.
    const visitor = await device('employer');
    const V = await tab(visitor, 'verify-1', signedUrl.replace(/^https?:\/\/[^/]+\//, ''));
    ok(await waitFor(V, () => { const c = document.querySelector('#certPortalVerifyResult [data-cert-verdict]'); return !!c; }, null, 20000) &&
       (await V.evaluate(() => document.querySelector('#certPortalVerifyResult [data-cert-verdict]').getAttribute('data-cert-verdict'))) === 'valid',
      'an employer\'s browser verifies the signed certificate with no account');
    const vt = await text(V, '#certPortalVerifyResult');
    ok(/Certificate Verified/.test(vt) && vt.indexOf(AMA.name) !== -1 && vt.indexOf(certNo) !== -1, 'and shows who it was issued to, and its number');

    // Withdrawal: back to In Training.
    await nav(A, 'students');
    await sp().locator('tr', { hasText: AMA.name }).locator('button:has-text("Update")').click();
    await sp().selectOption('#newStage', 'training');
    ok(/withdraws certificate/i.test(await sp().evaluate(() => document.getElementById('spCertChecklist').innerText)), 'demoting says it withdraws the certificate');
    await sp().click('#updateStageModal button:has-text("Update")');
    ok(await waitFor(A, id => { const s = students.find(x => x.id === id); return !!s && s.stage === 'training' && CESTISCore.certs.isRevoked(s); }, ids.ama), 'the certificate is withdrawn');
    await nav(A, 'cert-downloads');
    const keys2 = await download(A, () => A.click('#certSigningPanel button:has-text("Download cert-keys.json")'));
    ok(keys2 && keys2.text.indexOf(certNo) !== -1, 'the published key file now lists ' + certNo + ' as withdrawn');
    if (keys2) publishKeys(keys2.text);
    const visitor2 = await device('employer-later');
    const V2 = await tab(visitor2, 'verify-2', signedUrl.replace(/^https?:\/\/[^/]+\//, ''));
    await waitFor(V2, () => !!document.querySelector('#certPortalVerifyResult [data-cert-verdict]'), null, 20000);
    const verdict = await V2.evaluate(() => { const c = document.querySelector('#certPortalVerifyResult [data-cert-verdict]'); return c ? c.getAttribute('data-cert-verdict') : ''; });
    ok(verdict === 'revoked' && /Certificate Revoked/.test(await text(V2, '#certPortalVerifyResult')), 'verification now says the certificate is revoked (' + verdict + ')');
  });

  /* ================================================================== 7 */
  await step('7', 'Announcements and calendar: read in full; the trainee\'s agenda has the exam, the assignment, the class and the event', async () => {
    await nav(A, 'announcements');
    await A.click('button:has-text("+ New Announcement")');
    await A.fill('#annTitle', ANN_TITLE);
    await A.fill('#annBody', ANN_BODY);
    await A.selectOption('#annPriority', 'info');
    await A.click('button:has-text("Publish Announcement")');
    ok(await waitFor(A, t => document.getElementById('announcementsList').innerText.indexOf(t) !== -1, ANN_TITLE), 'the announcement is published');
    await serverHas('voctrain_announcements', l => l.some(a => a.title === ANN_TITLE));

    await nav(I, 'i-calendar');
    await I.click('button:has-text("+ Add Event")');
    const evDate = await I.evaluate(() => CESTISCore.attendance.addDays(localDateStr(), 3));
    await I.fill('#calEvtTitle', EVENT);
    await I.fill('#calEvtDate', evDate);
    await I.fill('#calEvtTime', '10:30');
    await I.selectOption('#calEvtType', 'class');
    await I.selectOption('#calEvtCourse', PROG);
    await I.click('#calendarEventModal button:has-text("Save Event")');
    ok(await waitFor(I, t => calendarEvents.some(e => e.title === t), EVENT), 'the instructor adds the event through the form (' + evDate + ' 10:30)');
    await serverHas('voctrain_calendarEvents', l => l.some(e => e.title === EVENT));

    await refresh(P);
    await nav(P, 's-announcements');
    const ann = await text(P, '#page-s-announcements');
    ok(ann.indexOf(ANN_TITLE) !== -1 && ann.indexOf(ANN_BODY.slice(-60)) !== -1, 'Ama reads the announcement in full, to its last line');
    await nav(P, 's-calendar');
    const agenda = await text(P, '#sCalEventList');
    ok(agenda.indexOf(EXAM) !== -1, 'her agenda lists the exam');
    ok(agenda.indexOf(ASSIGNMENT) !== -1 && agenda.indexOf(due) !== -1, 'the assignment\'s due date (' + due + ')');
    ok(agenda.indexOf(CLASS) !== -1, 'the class session');
    ok(agenda.indexOf(EVENT) !== -1, 'and the instructor\'s event (' + agenda.replace(/\s+/g, ' ').slice(0, 300) + ')');
  });

  /* ================================================================== E */
  await step('E', 'Every tab: no page errors and no console errors', async () => {
    for (const d of devices) for (const t of d.tabs) {
      ok(t.errors.length === 0, t.label + ': no page errors' + (t.errors.length ? ' — ' + t.errors.slice(0, 3).join(' | ') : ''));
      ok(t.consoleErrors.length === 0, t.label + ': no console errors' + (t.consoleErrors.length ? ' — ' + t.consoleErrors.slice(0, 3).join(' | ') : ''));
      const allowed = Object.keys(t.allowed).map(k => k + ' ×' + t.allowed[k]).join(', ');
      if (allowed) console.log('    ' + t.label + ' (not product errors: ' + allowed + ')');
    }
  });
})().catch(e => { failed++; console.log(e && e.stack || e); }).finally(async () => {
  try { if (browser) await browser.close(); } catch (e) {}
  try { if (server) server.kill(); } catch (e) {}
  await sleep(200);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\nFlow                                                                  checks  result');
  steps.forEach(s => console.log((s.id + '. ' + s.title).slice(0, 70).padEnd(70) + String(s.pass + s.fail).padStart(6) + '  ' +
    (s.fail ? 'FAIL' + (s.error ? ' (' + s.error.slice(0, 60) + ')' : '') : 'pass') + '  ' + Math.round(s.ms / 1000) + 's'));
  if (notes.length) { console.log('\nNotes:'); notes.forEach(n => console.log('  ' + n)); }
  console.log('\n' + passed + ' passed, ' + failed + ' failed  (' + Math.round((Date.now() - STARTED) / 1000) + ' s)');
  process.exit(failed ? 1 : 0);
});
