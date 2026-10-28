/* The Exam Invigilator, in a real browser, on the Centre's own network:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/invigilator.js
                                                   (npm run test:browser:invigilator)

   The owner asked: "I want a exam invigilator page, so that administrative
   staff can track when individuals start their assessments and begin each
   page and questions in real time, which produces a register of attendance
   for trainees. Invigilator see when each trainee complete their
   assessment."

   The Offline System on its real server (cestis-offline-server.js), the
   outside world cut off, the clock on Jamaica time: an invigilator's PC (the
   administrator) and three trainees' PCs sharing the Centre's copy, with the
   exam platform's own paper ("Welding Safety — Unit 3 Assessment", 10
   questions and an information item, three to a page):
     1. the board before anyone starts: three expected, Not started;
     2. Tameka starts (the board shows her In progress, on her PC, page 1 of
        4), moves to page 2, leaves the test window and comes back (the board
        says "Away from the test window now", then "Left the test window
        1× (…)"), and submits (Submitted, by the trainee, with the time);
     3. Kemar starts and his PC loses its connection: "No update for … — the
        connection may be lost"; when it is back, "Connection lost 1× (…)";
        he submits;
     4. Shanice never starts: Not started while the test is open, Absent once
        it has closed;
     5. Tameka's timeline: started on her PC, page 2 opened, questions begun
        and answered, the window left and come back to, submitted — in time
        order, and no answer anywhere on the board;
     6. the register: produced, a note added, signed off, printed, downloaded
        as CSV and PDF, and reopened after the page is reloaded (and on the
        Centre's copy); "Add to the day's attendance" proposes and, confirmed,
        writes Present for Tameka without touching Kemar's existing Late
        mark or marking Shanice;
     7. Admin Staff: no page until the Administrator ticks "Exam
        invigilation" (off by default) — then it appears and works;
     8. Light and Dark: the board's text reads at WCAG AA; on a phone
        (390x844) nothing is wider than the screen;
     and the trainee's test shows nothing new. No page errors anywhere.
   Kept out of the default npm test chain because it needs a browser.
   INVIG_SHOTS=<dir> saves screenshots of the board along the way. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = process.env.CESTIS_ROOT ? path.resolve(process.env.CESTIS_ROOT) : path.join(__dirname, '..', '..');
const OFF = path.join(ROOT, 'Offline System');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.INVIG_SHOTS || '';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 500); }
}

const PROG = 'Welding & Fabrication';
const TITLE = 'Welding Safety — Unit 3 Assessment';
const PEOPLE = {
  marcia: { id: 'USR-ADM-MT', name: 'Marcia Thompson', role: 'admin', user: 'mthompson', pass: 'Marcia-Admin-2026!', card: 'admin' },
  paulette: { id: 'USR-AS-PH', name: 'Paulette Henry', role: 'adminstaff', user: 'phenry', pass: 'Paulette-Staff-2026!', card: 'adminStaff' },
  tameka: { id: 'USR-STU-TR', sid: 'STU-WF-TR', name: 'Tameka Richards', role: 'student', user: 'tameka.richards', pass: 'Tameka-Pass-2026', card: 'student' },
  kemar: { id: 'USR-STU-KJ', sid: 'STU-WF-KJ', name: 'Kemar Johnson', role: 'student', user: 'kemar.johnson', pass: 'Kemar-Pass-2026', card: 'student' },
  shanice: { id: 'USR-STU-SB', sid: 'STU-WF-SB', name: 'Shanice Brown', role: 'student', user: 'shanice.brown', pass: 'Shanice-Pass-2026', card: 'student' }
};
// The exam platform's paper (tests/browser/exam-platform-preview.js).
const QUESTIONS = [
  { id: 'Q1', type: 'mcq', points: 1, text: 'Which colour is the acetylene hose?', options: ['Red', 'Blue', 'Green', 'Black'], correctAnswer: 0 },
  { id: 'Q2', type: 'tf', points: 1, text: 'A flashback arrestor stops a flame travelling back into the cylinder.', correctAnswer: true },
  { id: 'Q3', type: 'multi', points: 3, text: 'Which of these must you wear when arc welding?', options: ['Welding helmet', 'Leather gloves', 'Safety sandals', 'Flame-resistant jacket', 'Polyester overalls'], correctAnswer: [0, 1, 3] },
  { id: 'Q4', type: 'mcq', points: 1, text: 'What should the trainee do FIRST when the hose catches fire?', options: ['Close the cylinder valves', 'Pour water on the torch', 'Bend the hose'], correctAnswer: 0 },
  { id: 'Q5', type: 'shortanswer', points: 1, text: 'Name the device that stops a flame travelling back up the hose.', correctAnswer: ['flashback arrestor'] },
  { id: 'Q6', type: 'numerical', points: 2, text: 'One-seventh of 7,000 litres per hour is how many litres per hour?', correctAnswer: 1000, tolerance: 0, unit: 'litres/hour' },
  { id: 'I1', type: 'info', points: 0, text: 'Section B — the workshop scenario.' },
  { id: 'Q7', type: 'mcq', points: 1, text: 'Which gas is stored dissolved in acetone?', options: ['Acetylene', 'Oxygen', 'Argon'], correctAnswer: 0 },
  { id: 'Q8', type: 'numerical', points: 1, text: 'Above what pressure, in psi, is acetylene unstable?', correctAnswer: 15, tolerance: 0, unit: 'psi' },
  { id: 'Q9', type: 'fill', points: 1, text: 'Cylinders are stored ______ and chained.', correctAnswer: 'upright' },
  { id: 'Q10', type: 'short', points: 5, text: 'Describe how to shut down an oxy-acetylene set.' }
];

(async function main() {
  // The Centre's own server, in a scratch data folder.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-invigilator-'));
  const DATA = path.join(tmp, 'data');
  const PORT = 9100 + Math.floor(Math.random() * 800);
  const server = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: OFF, stdio: 'ignore',
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
  for (let i = 0; i < 60; i++) { await wait(100); try { if ((await fetch('http://127.0.0.1:' + PORT + '/_cestis/health')).ok) break; } catch (e) {} }
  const origin = 'http://127.0.0.1:' + PORT;
  const centre = k => { try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8')); return d.data[k] ? JSON.parse(d.data[k]) : []; } catch (e) { return []; } };
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  /* A computer: its own browser storage. */
  async function computer(opts) {
    opts = opts || {};
    const o = opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica', acceptDownloads: true }, o));
    await ctx.route('**/*', r => {
      if (ctx._offline) return r.abort('internetdisconnected');
      return r.request().url().startsWith(origin) ? r.continue() : r.abort();
    });
    return ctx;
  }
  async function offline(ctx, on) { ctx._offline = on; await ctx.setOffline(on); }
  function watch(page, label) {
    page.on('pageerror', e => errors.push(label + ': ' + String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    return page;
  }
  // The Centre's records on this computer, then the page as it opens with them.
  async function open(ctx, label) {
    const page = watch(await ctx.newPage(), label);
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(async ({ PEOPLE, PROG, TITLE, QUESTIONS }) => {
      const users = [];
      for (const k of Object.keys(PEOPLE)) {
        const p = PEOPLE[k];
        users.push({ id: p.id, name: p.name, role: p.role, username: p.user, email: p.user + '@example.com', programme: p.sid ? PROG : undefined,
          course: p.sid ? PROG : undefined, studentDataId: p.sid, password: await hashPassword(p.pass), status: 'active', updatedAt: '2026-10-01T12:00:00.000Z' });
      }
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      CESTISStore.setItem('voctrain_students', JSON.stringify(Object.keys(PEOPLE).filter(k => PEOPLE[k].sid).map(k => ({
        id: PEOPLE[k].sid, name: PEOPLE[k].name, course: PROG, stage: 'training', score: '0%', progress: 40, updatedAt: '2026-10-01T12:00:00.000Z' }))));
      // Open from five minutes ago for an hour, Centre time.
      const st = CESTISCore.exams.centreParts(Date.now() - 5 * 60000);
      CESTISStore.setItem('voctrain_exams', JSON.stringify([{ id: 'EXAM-WS3', title: TITLE, course: PROG, date: st.date, time: st.time, duration: 60, status: 'active',
        passMark: 60, questions: 10, questionData: QUESTIONS, shuffleQuestions: false, answersRelease: 'after-close', questionsPerPage: 3, allowFlag: true,
        createdBy: 'admin', createdByRole: 'admin', instructions: 'Answer every question.', updatedAt: '2026-10-01T12:00:00.000Z' }]));
      if (!CESTISStore.getItem('voctrain_examResults')) CESTISStore.setItem('voctrain_examResults', '[]');
    }, { PEOPLE, PROG, TITLE, QUESTIONS });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return page;
  }
  async function signIn(page, who) {
    const p = PEOPLE[who];
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    if (!(await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), p.card))) await page.click('#' + p.card + 'Card .role-enter-btn');
    await page.fill('#' + p.card + 'User', p.user);
    await page.fill('#' + p.card + 'Pass', p.pass);
    await page.press('#' + p.card + 'Pass', 'Enter');
    const inn = await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 20000 }).then(() => true, () => false);
    await page.waitForTimeout(900);
    return inn;
  }
  const go = (page, p) => page.evaluate(x => showPage(x), p).then(() => page.waitForTimeout(700));
  const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  // The board's row for a trainee, as the staff PC holds it now.
  const row = (page, who) => page.evaluate(name => {
    const b = invigState.board;
    const r = b && b.rows.find(x => x.name === name);
    const el = Array.prototype.find.call(document.querySelectorAll('#invigBoard .invig-row'), t => t.innerText.indexOf(name) !== -1);
    return r ? { status: r.status, page: r.pageNo, pages: r.pageCount, q: r.qLabel, answered: r.answered, total: r.total, startedAt: r.startedAt,
      submittedAt: r.submittedAt, how: r.how, asOf: r.asOf, live: r.live, warnings: r.warnings.map(w => w.k + ':' + w.text), text: el ? el.innerText.replace(/\s+/g, ' ') : '' } : null;
  }, PEOPLE[who].name);
  const counts = page => page.evaluate(() => invigState.board && invigState.board.counts);
  // A trainee's id on this PC (the dashboard gives every trainee a stable id
  // of its own as it loads, so the seeded one is not it).
  const sidOf = (page, who) => page.evaluate(n => { const s = (students || []).find(x => x && x.name === n); return s ? s.id : null; }, PEOPLE[who].name);
  const clockOf = (page, ms) => page.evaluate(t => CESTISCore.invigilation.clock(t, examCentreOffset()), ms);
  // The trainee's share and the Centre's latest, now (the share interval brought forward).
  const share = page => page.evaluate(async () => {
    try { if (currentExamSession) examPublishNow(); } catch (e) {}
    await new Promise(r => setTimeout(r, 1700));
    await CESTISPageCloud.saveNow();
    return true;
  });
  const examCard = page => page.locator('#studentUpcomingExams .class-schedule-card', { hasText: TITLE });
  async function startFresh(page) {
    await go(page, 's-exams');
    await examCard(page).locator('button:has-text("Take Exam")').click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt', { timeout: 20000 });
    await page.waitForTimeout(400);
  }
  async function submitAll(page) {
    await page.click('#studentExamTakingView .enp-finish');
    await page.waitForSelector('#examSubmitAllBtn', { timeout: 10000 });
    await page.click('#examSubmitAllBtn');
    await page.waitForSelector('#examConfirmGo', { timeout: 10000 });
    await page.click('#examConfirmGo');
    await page.waitForSelector('#studentExamResultView .exam-review', { timeout: 15000 });
    await page.waitForTimeout(400);
  }
  // The page hidden (another tab, another program) and shown again.
  const setVisible = (page, visible) => page.evaluate(v => {
    Object.defineProperty(document, 'visibilityState', { get: () => (v ? 'visible' : 'hidden'), configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
  async function shot(page, name) {
    if (!SHOTS) return;
    try { await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } catch (e) {}
  }
  // Text against what is really behind it (translucent tints composited down).
  async function readable(page, where, sels) {
    const res = await page.evaluate(sels => {
      const rgba = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
      const lum = c => { const v = c.slice(0, 3).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      return sels.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return [sel, null, false];
        const layers = [];
        for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
        let bg = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : [255, 255, 255, 1];
        while (layers.length) bg = over(layers.pop(), bg);
        const cs = getComputedStyle(el), fg = over(rgba(cs.color), bg);
        const a = lum(fg), b = lum(bg), size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        return [sel, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), size >= 24 || (bold && size >= 18.66)];
      });
    }, sels);
    for (const [sel, r, large] of res) ok(r !== null && r >= (large ? 3 : 4.5), where + ': ' + sel + ' reads at ' + (r === null ? 'n/a (missing)' : r.toFixed(2) + ':1'));
    console.log('    contrast, ' + where + ': ' + res.map(([sel, r]) => sel.split(' ').pop() + ' ' + (r === null ? 'n/a' : r.toFixed(2))).join(', '));
  }
  async function section(title, fn) {
    console.log(title);
    const t0 = Date.now();
    try { await fn(); } catch (e) { ok(false, title + ' — threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
    console.log('    (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }

  const office = await computer(), pcA = await computer(), pcB = await computer();
  let O, A, B;
  try {
    await section('1. The board before anyone starts: three trainees expected, none started', async () => {
      O = await open(office, 'office');
      ok(await O.evaluate(() => CESTISPageCloud.lan()), 'the invigilator\'s PC is on the Centre\'s network');
      ok(await signIn(O, 'marcia'), 'Marcia (administrator) signs in');
      ok(await O.evaluate(() => !!document.querySelector('#sidebarNav .nav-item[data-page="invigilator"]')), 'Exam Invigilator is in her sidebar, under the exams');
      await go(O, 'invigilator');
      ok(await until(() => O.evaluate(() => !!invigState.board && invigState.board.rows.length === 3), 15000), 'the board lists the three Welding & Fabrication trainees');
      // A short stand-in for "silence this long means the connection may be lost" (150 s on a real sitting).
      await O.evaluate(() => { INVIG_STALE_MS = 25000; });
      ok(/Welding Safety — Unit 3 Assessment/.test(await O.evaluate(() => document.getElementById('invigExam').selectedOptions[0].textContent)) && /open now/.test(await txt(O, '#invigExam')), 'the open sitting is chosen');
      ok(/Open now — closes at/.test(await txt(O, '#invigMeta')) && /Welding & Fabrication/.test(await txt(O, '#invigMeta')), 'and says when it closes');
      const c = await counts(O);
      ok(c && c.expected === 3 && c.started === 0 && c.notStarted === 3 && c.absent === 0, 'counts: 3 expected, none started (' + JSON.stringify(c) + ')');
      ok((await row(O, 'shanice')).text.indexOf('Not started yet') !== -1, 'each row: "Not started yet"');
      ok(/Updates arrive by themselves — last checked/.test(await txt(O, '#invigFresh')), 'the page says plainly how it keeps itself up to date');
    });

    let tamekaStart = 0;
    await section('2. Tameka starts, changes page, leaves the window and comes back: the board follows', async () => {
      A = await open(pcA, 'Tameka\'s PC');
      ok(await signIn(A, 'tameka'), 'Tameka signs in at her PC');
      await startFresh(A);
      tamekaStart = await A.evaluate(() => currentExamSession.startTime);
      ok(!/invigilat|watched|monitor/i.test(await txt(A, '#studentExamTakingView')), 'her test shows nothing new (no notice of being watched)');
      // The start is shared at once; the staff PC asks the Centre for the latest every 10 s.
      const t0 = Date.now();
      ok(await until(async () => { const r = await row(O, 'tameka'); return r && r.status === 'in-progress'; }, 40000, 1000),
        'the board shows her In progress (' + Math.round((Date.now() - t0) / 1000) + ' s after she started, without a reload)');
      let r = await row(O, 'tameka');
      ok(r.page === 1 && r.pages === 4 && r.q === '1' && /Page 1 of 4 · Question 1/.test(r.text), 'on Page 1 of 4 · Question 1 (' + r.text.slice(0, 120) + ')');
      ok(Math.abs(r.startedAt - tamekaStart) < 2000 && r.text.indexOf(await clockOf(O, tamekaStart)) !== -1 && /Computer · [A-Z0-9]{4}/.test(r.text), 'started at ' + (await clockOf(O, tamekaStart)) + ', on her PC ("Computer · …")');
      ok(/updated (just now|\d+ s ago)/.test(r.text), 'and how fresh the row is ("updated … ago")');
      await A.locator('#examQ-0 label.exam-choice', { hasText: 'Red' }).click();
      await A.locator('#examQ-1 label.exam-choice', { hasText: 'True' }).click();
      await A.click('.exam-next');
      await A.waitForTimeout(400);
      await A.locator('#examQ-3 label.exam-choice', { hasText: 'Close the cylinder valves' }).click();
      // Within the share interval (30 s) and the staff PC's next look.
      const t1 = Date.now();
      ok(await until(async () => { const x = await row(O, 'tameka'); return x && x.page === 2 && x.answered === 3; }, 60000, 1000),
        'her move to page 2 and her answers reach the board (' + Math.round((Date.now() - t1) / 1000) + ' s)');
      r = await row(O, 'tameka');
      ok(/Page 2 of 4 · Question 4/.test(r.text) && /3 of 10/.test(r.text), 'Page 2 of 4 · Question 4, 3 of 10 answered');
      ok(!/\bRed\b|Close the cylinder valves|\bTrue\b/.test(await txt(O, '#invigRoot')), 'no answer shows anywhere on the board');
      // She leaves the test window (another tab) …
      await setVisible(A, false);
      ok(await until(async () => { const x = await row(O, 'tameka'); return x && x.warnings.some(w => /^away-now:Away from the test window now/.test(w)); }, 40000, 1000),
        'the board says she is "Away from the test window now"');
      await shot(O, 'board-tameka-away');
      await A.waitForTimeout(4000);
      // … and comes back.
      await setVisible(A, true);
      await share(A);
      ok(await until(async () => { const x = await row(O, 'tameka'); return x && !x.warnings.some(w => /^away-now/.test(w)) && x.warnings.some(w => /^left:Left the test window 1× \(\d+ s\)/.test(w)); }, 40000, 1000),
        'back: "Left the test window 1× (… s)" (' + ((await row(O, 'tameka')) || { warnings: [] }).warnings.join(' | ') + ')');
      // The live link (the one notifications use), where this network can carry it.
      const rt = await Promise.all([O.evaluate(() => !!lmsChatRTReady), A.evaluate(() => !!lmsChatRTReady)]);
      if (rt[0] && rt[1]) {
        await A.locator('#examQ-4 input, #examAns-4').first().fill('flashback arrestor');
        const tsid = await sidOf(O, 'tameka');
        ok(await until(() => O.evaluate(id => !!invigLive[String(id)], tsid), 30000, 500), 'linked live: a pulse from her PC reaches the board');
      } else console.log('    (the live link is not up in this browser: the board relies on the shared record, as it must)');
    });

    let kemarOffAt = 0;
    await section('3. Kemar starts and his PC loses its connection: the board says so, then how long it was lost', async () => {
      B = await open(pcB, 'Kemar\'s PC');
      ok(await signIn(B, 'kemar'), 'Kemar signs in at his PC');
      await startFresh(B);
      ok(await until(async () => { const r = await row(O, 'kemar'); return r && r.status === 'in-progress'; }, 40000, 1000), 'the board shows him In progress');
      await offline(pcB, true);
      kemarOffAt = Date.now();
      await B.locator('#examQ-0 label.exam-choice', { hasText: 'Blue' }).click();
      ok(await until(async () => { const r = await row(O, 'kemar'); return r && r.warnings.some(w => /^silent:No update for .* — the connection may be lost/.test(w)); }, 70000, 1000),
        'after a while with no word: "No update for … — the connection may be lost" (' + Math.round((Date.now() - kemarOffAt) / 1000) + ' s)');
      ok((await counts(O)).attention >= 1, 'and he is counted under "Needs attention"');
      await shot(O, 'board-kemar-silent');
      await readable(O, 'board, Dark', ['.invig-count .l', '.invig-table th', '#invigBoard .invig-name', '#invigBoard .invig-sub', '#invigBoard .invig-st-in-progress',
        '#invigBoard .invig-st-not-started', '#invigBoard .invig-flag.alert', '#invigBoard .invig-flag.warn', '#invigMeta', '#invigFresh span']);
      await O.evaluate(() => cestisSetTheme('light'));
      await O.waitForTimeout(400);
      await readable(O, 'board, Light', ['.invig-count .l', '.invig-table th', '#invigBoard .invig-name', '#invigBoard .invig-sub', '#invigBoard .invig-st-in-progress',
        '#invigBoard .invig-st-not-started', '#invigBoard .invig-flag.alert', '#invigBoard .invig-flag.warn', '#invigMeta', '#invigFresh span']);
      await shot(O, 'board-light');
      await O.evaluate(() => cestisSetTheme('dark'));
      await B.waitForTimeout(3000);
      await offline(pcB, false);
      await B.waitForTimeout(800);
      await share(B);
      ok(await until(async () => { const r = await row(O, 'kemar'); return r && !r.warnings.some(w => /^silent/.test(w)) && r.warnings.some(w => /^offline:Connection lost 1× \(/.test(w)); }, 40000, 1000),
        'the connection back: "Connection lost 1× (…)", and the silence warning is gone (' + ((await row(O, 'kemar')) || { warnings: [] }).warnings.join(' | ') + ')');
      ok((await row(O, 'kemar')).answered === 1, 'with the answer he gave while it was lost');
    });

    let tamekaRes = null, kemarRes = null;
    await section('4. Both submit; Shanice never starts and is Absent once the test has closed', async () => {
      await submitAll(A);
      tamekaRes = await A.evaluate(() => examResults.find(r => r.studentName === 'Tameka Richards'));
      await share(A);
      ok(await until(async () => { const r = await row(O, 'tameka'); return r && r.status === 'submitted'; }, 40000, 1000), 'Tameka: Submitted');
      let r = await row(O, 'tameka');
      ok(r.how === 'trainee' && r.text.indexOf('Submitted ' + (await clockOf(O, Date.parse(tamekaRes.submittedAt)))) !== -1 && /by the trainee/.test(r.text),
        'at the time she submitted, "by the trainee" (' + r.text.slice(0, 160) + ')');
      await submitAll(B);
      kemarRes = await B.evaluate(() => examResults.find(r => r.studentName === 'Kemar Johnson'));
      await share(B);
      ok(await until(async () => { const x = await row(O, 'kemar'); return x && x.status === 'submitted'; }, 40000, 1000), 'Kemar: Submitted');
      ok((await row(O, 'shanice')).status === 'not-started', 'Shanice: still Not started while the test is open');
      // The test closes (the administrator completes it).
      await O.evaluate(() => completeExam('EXAM-WS3'));
      await O.waitForTimeout(600);
      ok(await until(async () => { const x = await row(O, 'shanice'); return x && x.status === 'absent'; }, 15000, 500), 'Shanice: Absent once the test has closed');
      const c = await counts(O);
      ok(c.expected === 3 && c.started === 2 && c.submitted === 2 && c.absent === 1 && c.notStarted === 0, 'counts: 3 expected, 2 submitted, 1 absent (' + JSON.stringify(c) + ')');
      ok(/Closed/.test(await txt(O, '#invigMeta')), 'and the sitting says it is closed');
      await shot(O, 'board-finished');
    });

    await section('5. Tameka\'s timeline: every moment, in order, with times — and no answers', async () => {
      await O.locator('#invigBoard .invig-row', { hasText: 'Tameka Richards' }).click();
      await O.waitForTimeout(400);
      ok(await O.evaluate(() => document.getElementById('invigTimelineModal').classList.contains('active')), 'choosing her row opens her timeline');
      const items = await O.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#invigTimelineBody .invig-tl li'), li => ({ time: li.querySelector('time').textContent, text: li.querySelector('span').textContent })));
      const texts = items.map(i => i.text);
      const at = s => texts.findIndex(t => t.indexOf(s) === 0);
      const startAt = await O.evaluate(t => CESTISCore.invigilation.clock(t, examCentreOffset(), true), tamekaStart);
      ok(/^Started the test on Computer · [A-Z0-9]{4}$/.test(texts[0]) && Math.abs(Date.parse('2000-01-01T' + items[0].time) - Date.parse('2000-01-01T' + startAt)) <= 1000, 'first: "Started the test on Computer · …" at ' + items[0].time + ' (she started at ' + startAt + ')');
      ok(at('Opened page 1 of 4') !== -1 && at('Opened page 2 of 4') > at('Opened page 1 of 4'), 'pages 1 and 2 opened, in order');
      ok(at('Began question 1') !== -1 && at('Answered question 1') > at('Began question 1') && at('Answered question 4') > at('Opened page 2 of 4'), 'questions begun and answered (question 4 on page 2)');
      ok(at('Left the test window') !== -1 && at('Came back to the test after') > at('Left the test window'), 'left the window, came back after a few seconds');
      ok(at('Submitted the test') === texts.length - 1 || at('Submitted the test') > at('Came back to the test after'), 'and submitted the test');
      ok(items.every((x, i) => !i || items[i - 1].time <= x.time), 'oldest first');
      ok(!/\bRed\b|\bTrue\b|Close the cylinder valves|flashback arrestor/.test(await txt(O, '#invigTimelineBody')), 'no answer appears in it');
      await shot(O, 'timeline-tameka');
      await O.keyboard.press('Escape');
      await O.waitForTimeout(300);
      ok(!(await O.evaluate(() => document.getElementById('invigTimelineModal').classList.contains('active'))), 'Escape closes it');
    });

    const regDate = await O.evaluate(() => invigState.board.date);
    await section('6. The register: produced, noted, signed off, printed, downloaded, reopened; the day\'s attendance proposed and confirmed', async () => {
      await O.click('#invigRegisterBtn');
      await O.waitForTimeout(600);
      ok(await O.isVisible('#invigRegisterView .invig-reg'), 'Attendance register opens the sitting\'s register');
      const rows = await O.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#invigRegisterView tbody tr'), tr => tr.innerText.replace(/\s+/g, ' ')));
      ok(rows.length === 3 && /Kemar Johnson .*Present — completed/.test(rows[0]) && /Shanice Brown .*Absent/.test(rows[1]) && /Tameka Richards .*Present — completed/.test(rows[2]),
        'Present — completed, Absent, Present — completed (' + rows.map(x => x.slice(0, 60)).join(' | ') + ')');
      ok(rows[2].indexOf(await clockOf(O, tamekaStart)) !== -1 && rows[2].indexOf(await clockOf(O, Date.parse(tamekaRes.submittedAt))) !== -1, 'with when she started and submitted');
      ok(/Invigilator: Marcia Thompson/.test(await txt(O, '#invigRegisterView')) && /Not signed off yet/.test(await txt(O, '#invigRegisterView')), 'the invigilator named; not signed off yet');
      ok(/connection lost 1×/.test(rows[0]) && /left the test window 1×/.test(rows[2]), 'what the board noted is carried into the register');
      // A note for Shanice.
      await O.locator('#invigRegisterView tbody tr', { hasText: 'Shanice Brown' }).locator('button:has-text("Add note")').click();
      await O.fill('#invigNoteInput', 'Phoned in sick at 08:40 — informed the office');
      await O.press('#invigNoteInput', 'Enter');
      await O.waitForTimeout(400);
      ok(/Phoned in sick at 08:40 — informed the office/.test(await txt(O, '#invigRegisterView')), 'a note is added to Shanice\'s row');
      await shot(O, 'register');
      // The day's attendance: Kemar was already marked Late that day.
      const ids = { tameka: await sidOf(O, 'tameka'), kemar: await sidOf(O, 'kemar'), shanice: await sidOf(O, 'shanice') };
      await O.evaluate(([id, d]) => setAttendanceMark(id, d, 'late', {}), [ids.kemar, regDate]);
      await O.click('#invigAttendBtn');
      await O.waitForTimeout(400);
      ok(await O.evaluate(() => document.getElementById('invigAttendModal').classList.contains('active')), '"Add to the day\'s attendance" shows what it proposes');
      const prop = await O.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#invigAttendBody tbody tr'), tr => ({
        text: tr.innerText.replace(/\s+/g, ' '), ticked: tr.querySelector('input[type=checkbox]').checked, mark: tr.querySelector('select').value })));
      ok(prop.length === 3 && prop[0].mark === 'present' && !prop[0].ticked && /Late/.test(prop[0].text), 'Kemar: Present proposed, NOT ticked — he is already marked Late (' + prop[0].text + ')');
      ok(prop[1].mark === 'absent' && !prop[1].ticked, 'Shanice: Absent proposed, unticked');
      ok(prop[2].mark === 'present' && prop[2].ticked, 'Tameka: Present, ticked');
      await shot(O, 'attendance-proposal');
      ok(await O.evaluate(([id, d]) => !attendanceRecordFor(id, d), [ids.tameka, regDate]), 'nothing is written before staff confirm');
      await O.click('#invigAttendGo');
      await O.waitForTimeout(500);
      const marks = await O.evaluate(([list, d]) => list.map(id => { const r = attendanceRecordFor(id, d); return r ? r.status + '/' + (r.source || '') : ''; }), [[ids.tameka, ids.kemar, ids.shanice], regDate]);
      ok(marks[0] === 'present/exam', 'confirmed: Tameka Present on that day (from the exam register)');
      ok(/^late\//.test(marks[1]), 'Kemar\'s Late is untouched (' + marks[1] + ')');
      ok(marks[2] === '', 'Shanice is not marked (her absence was left unticked)');
      ok(/Added to the day’s attendance by Marcia Thompson/.test(await txt(O, '#invigRegisterView')), 'the register says it was added, by whom');
      // Sign off.
      await O.click('#invigSignBtn');
      await O.waitForTimeout(500);
      ok(/Signed off by Marcia Thompson at \d\d:\d\d on /.test(await txt(O, '#invigRegisterView')), 'signed off: name and time');
      ok(!(await O.isVisible('#invigRegisterView button:has-text("Update from the board")')) && !(await O.isVisible('#invigRegisterView button:has-text("Add note")')), 'and from then on it is final (no updating, no notes)');
      // Print: the black-on-white sheet only.
      const printed = await O.evaluate(() => { let seen = null; const orig = window.print; window.print = () => { seen = { cls: document.body.classList.contains('invig-printing'), text: document.getElementById('invigPrintSheet').innerText }; }; invigPrintRegister(); window.print = orig; return seen; });
      ok(printed && printed.cls && /Exam attendance register/.test(printed.text) && /Shanice Brown/.test(printed.text) && /Invigilator’s signature/.test(printed.text), 'Print prints the register sheet, with a signature line');
      await O.emulateMedia({ media: 'print' });
      ok(await O.evaluate(() => getComputedStyle(document.getElementById('appShell')).display === 'none' && getComputedStyle(document.getElementById('invigPrintSheet')).display === 'block'), 'and on paper only the sheet shows');
      await shot(O, 'register-print');
      await O.emulateMedia({ media: 'screen' });
      await O.evaluate(() => document.body.classList.remove('invig-printing'));
      // CSV and PDF.
      let dl = O.waitForEvent('download', { timeout: 20000 });
      await O.click('#invigRegisterView button:has-text("Download CSV")');
      let d = await dl;
      const csv = fs.readFileSync(await d.path(), 'utf8');
      ok(/^Exam-register_Welding-Safety-Unit-3-Assessment_\d{4}-\d\d-\d\d\.csv$/.test(d.suggestedFilename()), 'CSV named for the sitting (' + d.suggestedFilename() + ')');
      ok(/"Shanice Brown","STU-[^"]+","Welding & Fabrication","Absent"/.test(csv) && /Phoned in sick at 08:40/.test(csv) && /"Signed off","Marcia Thompson at /.test(csv), 'the CSV has every row, the note and the sign-off');
      dl = O.waitForEvent('download', { timeout: 40000 });
      await O.click('#invigRegisterView button:has-text("Download PDF")');
      d = await dl;
      ok(fs.readFileSync(await d.path()).slice(0, 5).toString() === '%PDF-' && /\.pdf$/.test(d.suggestedFilename()), 'and a PDF (' + d.suggestedFilename() + ')');
      // It is kept: on the Centre's copy, and after a reload.
      await O.evaluate(() => CESTISPageCloud.saveNow());
      ok(await until(() => { const r = centre('voctrain_examRegisters')[0]; return r && r.notes && r.notes[ids.shanice] && /Phoned in sick/.test(r.notes[ids.shanice].text) && Object.keys(r.signoff || {}).length === 1; }, 20000), 'the register (note and sign-off) is in the Centre\'s copy');
      await O.reload({ waitUntil: 'load' });
      await O.waitForTimeout(1500);
      ok(await signIn(O, 'marcia'), 'after a reload Marcia signs in again');
      await go(O, 'invigilator');
      await O.waitForTimeout(800);
      await O.click('#invigRegisterBtn');
      await O.waitForTimeout(600);
      const again = await txt(O, '#invigRegisterView');
      ok(/Signed off by Marcia Thompson/.test(again) && /Phoned in sick at 08:40/.test(again) && /Added to the day’s attendance/.test(again), 'the register reopens as it was left: signed, noted, attendance added');
    });

    await section('7. Admin Staff: nothing until the Administrator ticks "Exam invigilation"; then the page', async () => {
      const desk = await computer();
      const S = await open(desk, 'Paulette\'s PC');
      ok(await signIn(S, 'paulette'), 'Paulette (Admin Staff) signs in');
      ok(!(await S.evaluate(() => !!document.querySelector('#sidebarNav .nav-item[data-page="as-invigilator"]'))), 'no Exam Invigilator in her sidebar by default');
      await S.evaluate(() => showPage('as-invigilator'));
      await S.waitForTimeout(300);
      ok(!(await S.evaluate(() => document.getElementById('page-as-invigilator').classList.contains('active'))), 'and the page is refused if she is sent to it');
      // Marcia ticks it in Settings → Admin Staff access.
      await go(O, 'settings');
      await O.locator('.tab', { hasText: 'Admin Staff Access' }).click();
      await O.waitForTimeout(300);
      const tick = O.locator('#asAccess_invigilation');
      ok(await tick.count() === 1 && /Exam invigilation/.test(await txt(O, '#asAccessGrid')) && !(await tick.isChecked()), 'Settings offers "Exam invigilation", unticked');
      await shot(O, 'staff-access-tick');
      await tick.check();
      await O.click('#settingsTabStaffAccess button:has-text("Save Access Settings")');
      await O.waitForTimeout(500);
      await O.evaluate(() => CESTISPageCloud.saveNow());
      ok(await until(async () => { await S.evaluate(() => CESTISPageCloud.loadNow()); return S.evaluate(() => !!document.querySelector('#sidebarNav .nav-item[data-page="as-invigilator"]')); }, 40000, 2000),
        'Paulette\'s sidebar gets Exam Invigilator once it is ticked');
      await go(S, 'as-invigilator');
      ok(await until(() => S.evaluate(() => !!invigState.board && invigState.board.rows.length === 3), 15000), 'and her board shows the sitting');
      ok((await row(S, 'shanice')).status === 'absent' && (await row(S, 'tameka')).status === 'submitted', 'with the same statuses as Marcia\'s');
      await desk.close();
    });

    await section('8. On a phone (390x844): the board fits the screen', async () => {
      const phone = await computer({ phone: true });
      const P = await open(phone, 'phone');
      ok(await signIn(P, 'marcia'), 'Marcia signs in on her phone');
      await go(P, 'invigilator');
      ok(await until(() => P.evaluate(() => !!invigState.board && invigState.board.rows.length === 3), 20000), 'the board is there');
      const w = await P.evaluate(() => ({ doc: document.documentElement.scrollWidth, main: document.querySelector('.main-content').scrollWidth,
        rows: Array.prototype.map.call(document.querySelectorAll('#invigBoard .invig-row'), r => Math.round(r.getBoundingClientRect().right)) }));
      ok(w.doc <= 390 && w.main <= 390 && w.rows.every(x => x <= 390), 'nothing is wider than the screen (' + JSON.stringify(w) + ')');
      ok(await P.evaluate(() => getComputedStyle(document.querySelector('#invigTable thead')).display === 'none'), 'each trainee is a card');
      await shot(P, 'phone-board');
      await phone.close();
    });

    ok(errors.length === 0, 'no page errors anywhere (' + errors.join(' | ').slice(0, 400) + ')');
  } catch (e) {
    failed++;
    console.log(e && e.stack || e);
  } finally {
    await browser.close();
    server.kill();
    await wait(200);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
