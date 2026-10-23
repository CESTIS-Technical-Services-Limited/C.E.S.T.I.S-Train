/* A test that is interrupted is picked up where it stopped — on the same
   computer, or on another one — in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/exam-resume.js
                                                   (npm run test:browser:resume)

   The owner asked: "look at what happens when tests are being done and the
   person is kicked out of the page, or disconnected, they should be able to
   pick up where they stopped" and "save test answers ... so that trainees can
   go to another device and sign in and do their test", along with the
   device's own copy. Drives the real index.html in headless Chromium, the
   outside world cut off and the clock on Jamaica time, with the exam
   platform's own seed ("Welding Safety — Unit 3 Assessment", 10 questions of
   every type and an information item, three to a page — the same as
   tests/browser/exam-platform-preview.js):

     1. the same PC: a reload, the tab closed, the browser crashing — on page
        2 with every type answered, an essay half typed, a flag, and the last
        answer typed a moment before the end — then signing in again:
        "Continue your attempt (mm:ss left)" puts back every answer, the page
        and the ORIGINAL clock;
     2. kicked out: the session running out (and the rule that carries an
        active test taker on, while an idle PC is still signed out),
        maintenance mode, the account switched off (no "Sign out now?" with a
        Cancel), another trainee signing in on the same PC (never sees or
        submits the first one's answers; she carries on later);
     3. disconnected: answering on, changing pages and submitting with the
        network gone — the result waits, the trainee is told calmly, and it is
        sent once when the network is back: no duplicate, nothing lost;
     4. the time running out while she was away: submitted automatically,
        once, with a note;
     5. TWO PCs sharing one copy, by both routes the Centre uses (online, an
        in-memory stand-in for the shared copy: tests/browser/fake-drive.js;
        and the Centre's own network, its real server): start on PC 1, PC 1
        dies, carry on and submit on PC 2; PC 1 comes back with its old copy
        and is told the test was submitted on another device — one result,
        no answer lost. And both PCs answering at once: question by question
        the newest answer wins, and the side that changed is told;
     6. on a phone (390x844): a reload, the page killed, the network gone;
     7. the same test in two tabs of one PC;
     8. Light and Dark: every new message and button reads at WCAG AA.
   No page errors anywhere. Kept out of the default npm test chain because it
   needs a browser.

   It takes about twelve minutes (the two-PC sections wait for the real
   share and sync intervals). EXAM_RESUME_ONLY=<regex> runs only the sections
   whose title matches (e.g. '^[1-4]' then '^[5-7]');
   EXAM_RESUME_SHOTS=<dir> saves screenshots of the new screens there. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');

const ROOT = process.env.CESTIS_ROOT ? path.resolve(process.env.CESTIS_ROOT) : path.join(__dirname, '..', '..');
const OFF = path.join(ROOT, 'Offline System');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const ONLY = process.env.EXAM_RESUME_ONLY ? new RegExp(process.env.EXAM_RESUME_ONLY, 'i') : null;
const SHOTS = process.env.EXAM_RESUME_SHOTS || '';
let passed = 0, failed = 0;
let THEME = 'dark';
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: [' + THEME + '] ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const PROG = 'Welding & Fabrication';
const TITLE = 'Welding Safety — Unit 3 Assessment';
const PEOPLE = {
  tameka: { id: 'USR-STU-TR', sid: 'STU-WF-TR', name: 'Tameka Richards', role: 'student', user: 'tameka.richards', pass: 'Tameka-Pass-2026', card: 'student' },
  kemar: { id: 'USR-STU-KJ', sid: 'STU-WF-KJ', name: 'Kemar Johnson', role: 'student', user: 'kemar.johnson', pass: 'Kemar-Pass-2026', card: 'student' }
};
// The exam platform's own paper (tests/browser/exam-platform-preview.js):
// 11 items, three to a page — page 1: Q1–Q3, page 2: Q4–Q6, page 3: the
// information item, Q7, Q8, page 4: Q9, Q10 (the essay).
const QUESTIONS = [
  { id: 'Q1', type: 'mcq', points: 1, text: 'Which colour is the acetylene hose?', options: ['Red', 'Blue', 'Green', 'Black'], correctAnswer: 0 },
  { id: 'Q2', type: 'tf', points: 1, text: 'A flashback arrestor stops a flame travelling back into the cylinder.', correctAnswer: true },
  { id: 'Q3', type: 'multi', points: 3, text: 'Which of these must you wear when arc welding?', options: ['Welding helmet', 'Leather gloves', 'Safety sandals', 'Flame-resistant jacket', 'Polyester overalls'], correctAnswer: [0, 1, 3] },
  { id: 'Q4', type: 'match', points: 4, text: 'Match each hazard with its control.', pairs: [
    { prompt: 'Welding fumes', answer: 'Local exhaust ventilation' }, { prompt: 'Arc flash', answer: 'Shade 10–13 filter lens' },
    { prompt: 'Electric shock', answer: 'Dry gloves and an insulated mat' }, { prompt: 'Hot slag', answer: 'Leather spats and apron' }], distractors: ['A dust mask'] },
  { id: 'Q5', type: 'shortanswer', points: 1, text: 'Name the device that stops a flame travelling back up the hose.', correctAnswer: ['flashback arrestor', 'flash back arrest*'] },
  { id: 'Q6', type: 'numerical', points: 2, text: 'One-seventh of 7,000 litres per hour is how many litres per hour?', correctAnswer: 1000, tolerance: 0, unit: 'litres/hour' },
  { id: 'I1', type: 'info', points: 0, text: 'Section B — the workshop scenario.' },
  { id: 'Q7', type: 'mcq', points: 1, text: 'What should the trainee do FIRST?', options: ['Close the cylinder valves', 'Pour water on the torch', 'Bend the hose'], correctAnswer: 0 },
  { id: 'Q8', type: 'numerical', points: 1, text: 'Above what pressure, in psi, is acetylene unstable?', correctAnswer: 15, tolerance: 0, unit: 'psi' },
  { id: 'Q9', type: 'fill', points: 1, text: 'Cylinders are stored ______ and chained.', correctAnswer: 'upright' },
  { id: 'Q10', type: 'short', points: 5, text: 'Describe how to shut down an oxy-acetylene set.' }
];
const ESSAY_HALF = 'Close the oxygen valve on the torch first, then the acetylene valve, then the cyl';
const MATCH = ['Local exhaust ventilation', 'Shade 10–13 filter lens', 'Dry gloves and an insulated mat', 'Leather spats and apron'];
// What a trainee who answered everything below has on her paper.
const EXPECT = [0, true, [0, 1, 4], MATCH, 'Flashback arrestor', '1,000', null, 0, '15', 'upright', ESSAY_HALF];

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const allErrors = [];
  const dialogs = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  /* A computer: its own browser storage. opts.phone, opts.drive (a FakeDrive
     both PCs share), opts.origin (the Centre's own server). */
  async function computer(opts) {
    opts = opts || {};
    const o = opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, o));
    const origin = opts.origin || base;
    await ctx.route('**/*', r => {
      const u = r.request().url();
      // (A routed request is answered before the browser's own offline
      // switch is consulted, so the routes honour it themselves.)
      if (ctx._offline) return r.abort('internetdisconnected');
      if (u.startsWith(origin)) return r.continue();
      if (opts.drive && /^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(u)) return opts.drive.handle(r);
      return r.abort();
    });
    if (THEME === 'light') await ctx.addInitScript(() => { try { localStorage.setItem('cestisTheme', 'light'); } catch (e) {} });
    ctx._origin = origin; ctx._opts = opts;
    return ctx;
  }
  function watch(page, label) {
    page.on('pageerror', e => allErrors.push((label || '') + ' ' + String(e.message).slice(0, 200)));
    page.on('dialog', d => { dialogs.push({ type: d.type(), msg: d.message(), label }); d.accept().catch(() => {}); });
    if (process.env.EXAM_RESUME_DEBUG) page.on('console', m => { if (new RegExp(process.env.EXAM_RESUME_DEBUG, 'i').test(m.text())) console.log('    [' + (label || 'page') + '] ' + m.text().slice(0, 300)); });
    return page;
  }
  // The Centre's records on this computer (as a PC that has synced holds
  // them), then the page as it opens with them.
  async function open(ctx, opts) {
    opts = opts || {};
    const page = watch(await ctx.newPage(), opts.label);
    await page.goto(ctx._origin + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    if (opts.seed !== false) {
      await page.evaluate(async ({ PEOPLE, PROG, TITLE, QUESTIONS, examOver, token }) => {
        const users = [];
        for (const k of Object.keys(PEOPLE)) {
          const p = PEOPLE[k];
          users.push({ id: p.id, name: p.name, role: p.role, username: p.user, email: p.user + '@example.com', programme: PROG, course: PROG,
            studentDataId: p.sid, password: await hashPassword(p.pass), status: 'active', updatedAt: '2026-10-01T12:00:00.000Z' });
        }
        CESTISStore.setItem('voctrain_users', JSON.stringify(users));
        CESTISStore.setItem('voctrain_students', JSON.stringify(Object.keys(PEOPLE).map(k => ({
          id: PEOPLE[k].sid, name: PEOPLE[k].name, course: PROG, stage: 'training', score: '0%', progress: 40, updatedAt: '2026-10-01T12:00:00.000Z' }))));
        // Open from five minutes ago for an hour, Centre time.
        const st = CESTISCore.exams.centreParts(Date.now() - 5 * 60000);
        const exam = Object.assign({ id: 'EXAM-WS3', title: TITLE, course: PROG, date: st.date, time: st.time, duration: 60, status: 'active', passMark: 60,
          questions: 10, questionData: QUESTIONS, shuffleQuestions: false, answersRelease: 'after-close', questionsPerPage: 3, allowFlag: true,
          createdBy: 'admin', createdByRole: 'admin', instructions: 'Answer every question.', updatedAt: '2026-10-01T12:00:00.000Z' }, examOver || {});
        CESTISStore.setItem('voctrain_exams', JSON.stringify([exam]));
        if (!CESTISStore.getItem('voctrain_examResults')) CESTISStore.setItem('voctrain_examResults', '[]');
        if (token) Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k]));
      }, { PEOPLE, PROG, TITLE, QUESTIONS, examOver: opts.examOver, token: ctx._opts.drive ? driveTokenSeed() : null });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(1300);
    }
    return page;
  }
  // Another visit to the page on a computer that already has the records.
  async function reopen(ctx, label) {
    const page = watch(await ctx.newPage(), label);
    await page.goto(ctx._origin + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
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
  const cls = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.className : ''; }, sel);
  const examCard = page => page.locator('#studentUpcomingExams .class-schedule-card', { hasText: TITLE });
  const signedIn = page => page.evaluate(() => document.getElementById('appShell').classList.contains('active') && !!currentRole);
  async function shot(page, name, clip) {
    if (!SHOTS) return;
    const file = path.join(SHOTS, name + '-' + THEME + '.png');
    try {
      if (clip && typeof clip === 'string') await page.locator(clip).first().screenshot({ path: file });
      else await page.screenshot({ path: file, clip: clip || undefined });
    } catch (e) { console.log('  (screenshot ' + name + ' not taken: ' + String(e.message).split('\n')[0] + ')'); }
  }
  async function myExams(page) {
    await go(page, 's-exams');
    return (await examCard(page).locator('button').count()) ? (await examCard(page).locator('button').first().innerText()).trim() : (await examCard(page).innerText()).trim();
  }
  async function startFresh(page) {
    await go(page, 's-exams');
    await examCard(page).locator('button:has-text("Take Exam")').click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt');
  }
  async function continueAttempt(page) {
    await go(page, 's-exams');
    const b = examCard(page).locator('button:has-text("Continue your attempt")');
    if (!(await b.count())) return false;
    await b.click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt', { timeout: 15000 });
    await page.waitForTimeout(300);
    return true;
  }
  // A question's box in the navigation (on a phone the boxes fold away
  // behind "Questions": one tap opens them).
  const navTo = async (page, i) => {
    if (!(await page.isVisible('#examNav-' + i)) && (await page.isVisible('#examNavToggle'))) { await page.click('#examNavToggle'); await page.waitForTimeout(200); }
    await page.click('#examNav-' + i);
    await page.waitForTimeout(350);
  };
  // Page 1, then 4, then 3, then page 2 — where she is when it ends — with
  // the numerical answer on page 2 typed key by key as the very last thing.
  async function answerEverything(page, opts) {
    opts = opts || {};
    await page.locator('#examQ-0 label.exam-choice', { hasText: 'Red' }).click();
    await page.locator('#examQ-1 label.exam-choice', { hasText: 'True' }).click();
    await page.click('#examFlag-1');
    for (const t of ['Welding helmet', 'Leather gloves', 'Polyester overalls']) await page.locator('#examQ-2 label.exam-choice', { hasText: t }).click();
    await navTo(page, 9);
    await page.fill('#examAns-9', 'upright');
    await page.click('#examAns-10');
    await page.keyboard.type(ESSAY_HALF, { delay: 5 });       // half typed: she was in the middle of the sentence
    await navTo(page, 7);
    await page.locator('#examQ-7 label.exam-choice', { hasText: 'Close the cylinder valves' }).click();
    await page.fill('#examAns-8', '15');
    await navTo(page, 3);
    for (let r = 0; r < 4; r++) await page.selectOption('#examAns-3-' + r, MATCH[r]);
    await page.fill('#examAns-4', 'Flashback arrestor');
    if (opts.lastTyped === false) return;
    await page.click('#examAns-5');
    await page.keyboard.type('1,000');                         // and the end comes straight after this key
  }
  // What the attempt on the screen holds.
  const onScreen = page => page.evaluate(() => {
    const s = currentExamSession;
    return s ? { page: s.page, answers: s.answers, flagged: s.flagged, deadline: s.deadline, attemptId: s.attemptId, studentId: s.studentId } : null;
  });
  function sameAnswers(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function restoredOk(where, got, deadline) {
    ok(!!got, where + ': the attempt is open again');
    if (!got) return;
    ok(got.page === 1, where + ': on page 2, where she was (page index ' + got.page + ')');
    ok(sameAnswers(got.answers, EXPECT), where + ': every answer is back, the half-typed essay and the last key typed included (' + JSON.stringify(got.answers).slice(0, 220) + ')');
    ok(got.flagged[1] === true && got.flagged.filter(Boolean).length === 1, where + ': question 2 is still flagged, nothing else');
    if (deadline) ok(got.deadline === deadline, where + ': with the ORIGINAL deadline (' + got.deadline + ' vs ' + deadline + ')');
  }
  async function onScreenMatches(page, where) {
    const v = await page.evaluate(() => ({
      q5: (document.getElementById('examAns-4') || {}).value, q6: (document.getElementById('examAns-5') || {}).value,
      rows: [0, 1, 2, 3].map(r => (document.getElementById('examAns-3-' + r) || {}).value),
      pg: (document.querySelector('.exam-page-nav') || {}).innerText || '', flag: (document.getElementById('examNav-1') || {}).className || '',
      essayBox: (document.getElementById('examNav-10') || {}).className || ''
    }));
    ok(/Page 2 of 4/.test(v.pg) && v.q5 === 'Flashback arrestor' && v.q6 === '1,000' && sameAnswers(v.rows, MATCH), where + ': page 2 shows her matching rows and typed answers (' + JSON.stringify(v).slice(0, 160) + ')');
    ok(/flagged/.test(v.flag) && /answered/.test(v.essayBox), where + ': the navigation shows the flag and the essay as answered');
  }
  function leftOk(where, label, deadline) {
    const m = /Continue your attempt \((\d+):(\d\d) left\)/.exec(label || '');
    ok(!!m, where + ': My Exams offers "Continue your attempt (mm:ss left)" — got "' + label + '"');
    if (!m || !deadline) return;
    const shown = Number(m[1]) * 60 + Number(m[2]), real = (deadline - Date.now()) / 1000;
    ok(Math.abs(shown - real) < 90, where + ': and the time left is right (' + shown + ' s shown, ' + Math.round(real) + ' s really)');
  }
  async function readable(page, where, sels) {
    const res = await page.evaluate(sels => {
      const rgba = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
      const lum = c => { const v = c.slice(0, 3).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      return sels.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return [sel, null, false];
        // A button painted with a gradient (the theme's accent) is read
        // against each of its colours, the worst one counting.
        let stops = null;
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const st = getComputedStyle(n);
          if (/gradient/.test(st.backgroundImage)) { stops = (st.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(rgba).filter(Boolean); if (stops.length) break; }
          const c = rgba(st.backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
        }
        let bg = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : [255, 255, 255, 1];
        while (layers.length) bg = over(layers.pop(), bg);
        const cs = getComputedStyle(el), size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const ratio = b0 => { const fg = over(rgba(cs.color), b0), a = lum(fg), b = lum(b0); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        const r = stops && stops.length ? Math.min.apply(null, stops.map(c => ratio(over(c, bg)))) : ratio(bg);
        return [sel, r, size >= 24 || (bold && size >= 18.66)];
      });
    }, sels);
    for (const [sel, r, large] of res) ok(r !== null && r >= (large ? 3 : 4.5), where + ': ' + sel + ' reads at ' + (r === null ? 'n/a (missing)' : r.toFixed(2) + ':1'));
    console.log('    contrast, ' + where + ': ' + res.map(([sel, r]) => sel.split(' ').pop() + ' ' + (r === null ? 'n/a' : r.toFixed(2) + ':1')).join(', '));
  }
  const resultsFor = (page, who) => page.evaluate(sid => (examResults || []).filter(r => r && !r.archived && r.examId === 'EXAM-WS3' && (r.studentName === sid)), PEOPLE[who].name);
  // Each section is listed first and run at the end: all of them in Dark,
  // and those that show the new messages and buttons again in Light.
  const PLAN = [];
  function section(title, fn, opts) { PLAN.push({ title, fn, light: !!(opts && opts.light) }); }
  async function runSection(sec) {
    if (ONLY && !ONLY.test(sec.title)) return;
    console.log('[' + THEME + '] ' + sec.title);
    const t0 = Date.now();
    try { await sec.fn(); } catch (e) { ok(false, sec.title + ' — threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
    console.log('    (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  // How a computer's page ends.
  async function kill(ctx, page, how) {
    if (how === 'reload') { await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500); return page; }
    if (how === 'close') { await page.close({ runBeforeUnload: false }); return reopen(ctx, 'after close'); }
    if (how === 'crash') {
      // The renderer dies on the spot: no pagehide, no beforeunload, nothing
      // the page can run. (The crash never answers, so it is not awaited.)
      const cdp = await ctx.newCDPSession(page);
      const crashed = new Promise(r => page.once('crash', () => r(true)));
      cdp.send('Page.crash').catch(() => {});
      ok(await Promise.race([crashed, wait(5000).then(() => false)]), 'the browser tab crashed');
      await Promise.race([page.close().catch(() => {}), wait(3000)]);
      return reopen(ctx, 'after crash');
    }
    throw new Error('how? ' + how);
  }

  // ---------------------------------------------------------------- 1
  for (const how of ['reload', 'close', 'crash']) {
    await section('1. The same PC: ' + (how === 'reload' ? 'a reload' : how === 'close' ? 'the tab closed' : 'the browser crashing') + ' on page 2 — she signs in and carries on where she stopped', async () => {
      const ctx = await computer();
      let page = await open(ctx);
      ok(await signIn(page, 'tameka'), 'Tameka signs in');
      await startFresh(page);
      await answerEverything(page);
      const before = await onScreen(page);
      ok(sameAnswers(before.answers, EXPECT) && before.page === 1, 'before the end: everything answered, on page 2');
      if (how === 'crash') await shot(page, '01-pc1-mid-attempt-desktop');
      page = await kill(ctx, page, how);
      ok(!(await signedIn(page)), 'after the ' + how + ' the page is back at the sign-in');
      await recordToasts(page);
      ok(await signIn(page, 'tameka'), 'she signs in again');
      ok(await until(async () => /You have a test in progress\. Open My Exams and choose Continue your attempt/.test(await toasts(page)), 8000), how + ': and is pointed to her test in progress');
      const label = await myExams(page);
      leftOk(how, label, before.deadline);
      ok(/In progress\. Your answers are saved\./.test(await txt(page, '#studentUpcomingExams')), how + ': and says "In progress. Your answers are saved."');
      await readable(page, 'My Exams', ['#studentUpcomingExams .exam-continue .btn', '#studentUpcomingExams .exam-continue-note']);
      if (how === 'reload') await shot(page, '02a-same-pc-my-exams-continue-desktop', '#studentUpcomingExams');
      ok(await continueAttempt(page), how + ': "Continue your attempt" opens it');
      restoredOk(how, await onScreen(page), before.deadline);
      await onScreenMatches(page, how);
      ok(before.attemptId && (await onScreen(page)).attemptId === before.attemptId, how + ': it is the same attempt, not a second one');
      if (how === 'crash') await shot(page, '08-same-pc-after-crash-desktop');
      await ctx.close();
    }, { light: how === 'reload' });
  }

  // Every toast the page shows from now on, for reading afterwards.
  const recordToasts = page => page.evaluate(() => {
    window.__toasts = [];
    const c = document.getElementById('toastContainer');
    if (c && !window.__toastObs) {
      window.__toastObs = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.innerText) window.__toasts.push(n.innerText); })));
      window.__toastObs.observe(c, { childList: true });
    }
  });
  const toasts = page => page.evaluate(() => (window.__toasts || []).join(' | '));
  // This computer's own copies of the trainee's attempts (a closed one is a
  // small record without her name: found by her record's id).
  const draftOf = (page, who) => page.evaluate(name => {
    const ids = (typeof students !== 'undefined' && Array.isArray(students) ? students : []).filter(s => s && s.name === name).map(s => String(s.id));
    const out = [];
    CESTISStore.keys().forEach(k => { if (k.indexOf(CESTISCore.exams.DRAFT_PREFIX) === 0) { const d = JSON.parse(CESTISStore.getItem(k) || 'null'); if (d && (d.studentName === name || ids.indexOf(String(d.studentId)) !== -1)) out.push(d); } });
    return out;
  }, PEOPLE[who].name);
  // A page on the same computer, for writing what another tab would write.
  async function setOffline(ctx, v) { ctx._offline = !!v; await ctx.setOffline(!!v); }
  async function sideTab(ctx) {
    const p = await ctx.newPage();
    await p.goto(ctx._origin + '/cestis-core.js');
    return p;
  }
  async function submitAll(page) {
    if (!(await page.isVisible('.enp-finish')) && (await page.isVisible('#examNavToggle'))) { await page.click('#examNavToggle'); await page.waitForTimeout(200); }
    await page.click('.enp-finish');
    await page.waitForSelector('.exam-summary-table');
    await page.click('#examSubmitAllBtn');
    await page.click('#examConfirmGo');
    await page.waitForSelector('#studentExamResultView .exam-review', { timeout: 15000 });
    await page.waitForTimeout(400);
  }

  // ---------------------------------------------------------------- 2
  await section('2a. Kicked out by the session clock: an active test taker is carried on, an idle PC is signed out, and she carries on later', async () => {
    const ctx = await computer();
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await startFresh(page);
    await answerEverything(page);
    const before = await onScreen(page);
    // Two minutes of session left, and she is working: carried on.
    await page.evaluate(() => CESTISStore.setItem('voctrain_sessionExpiry', String(Date.now() + 60000)));
    await page.locator('#examQ-4 .exam-q-text').click();       // she is using the page
    const kept = await page.evaluate(() => { sessionHeartbeat(); return { exp: Number(CESTISStore.getItem('voctrain_sessionExpiry')), now: Date.now() }; });
    ok(kept.exp - kept.now > 14 * 60000 && kept.exp - kept.now <= 15 * 60000 + 1000, 'an active test taker near the end of the session is carried on 15 minutes (' + Math.round((kept.exp - kept.now) / 60000) + ' min)');
    ok(await signedIn(page), 'and stays signed in');
    // Now she walks away: nobody has touched the PC for eleven minutes.
    const idle = await page.evaluate(() => {
      CESTISStore.setItem('voctrain_sessionExpiry', String(Date.now() + 60000));
      _sessionLastActivity = Date.now() - 11 * 60000;
      const was = Number(CESTISStore.getItem('voctrain_sessionExpiry'));
      sessionHeartbeat();
      return { was, now: Number(CESTISStore.getItem('voctrain_sessionExpiry')) };
    });
    ok(idle.now === idle.was, 'an idle PC is NOT carried on (the expiry stays where it was)');
    await recordToasts(page);
    // ...and the minute check after the expiry signs it out.
    await page.evaluate(() => { CESTISStore.setItem('voctrain_sessionExpiry', String(Date.now() - 1000)); checkSessionExpiry(); });
    await page.waitForTimeout(1500);
    ok(!(await signedIn(page)), 'when the session runs out on the idle PC, it is signed out');
    ok(/Your session has expired/.test(await toasts(page)), 'with "Your session has expired" (' + (await toasts(page)).slice(0, 120) + ')');
    ok(!dialogs.some(d => /Sign out now\?/.test(d.msg) && d.label !== 'x'), 'nobody was asked "Sign out now?" by the clock');
    const d = await draftOf(page, 'tameka');
    ok(d.length === 1 && sameAnswers(d[0].answers, EXPECT), 'her answers are saved on this computer');
    ok(await signIn(page, 'tameka'), 'she signs in again');
    leftOk('after the session ran out', await myExams(page), before.deadline);
    ok(await continueAttempt(page), 'and carries on');
    restoredOk('after the session ran out', await onScreen(page), before.deadline);
    await ctx.close();
  });

  await section('2b. Kicked out by maintenance mode: answers saved, she carries on when the site is back', async () => {
    const ctx = await computer();
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await startFresh(page);
    await answerEverything(page);
    const before = await onScreen(page);
    await recordToasts(page);
    const admin = await sideTab(ctx);
    await admin.evaluate(() => localStorage.setItem('voctrain_maintenanceMode', JSON.stringify({ active: true, message: '', updatedAt: new Date().toISOString() })));
    await page.waitForTimeout(3500);
    ok(!(await signedIn(page)), 'maintenance mode signs her out');
    ok(/Your test answers are saved: carry on when the site is back/.test(await toasts(page)), 'and tells her the answers are saved (' + (await toasts(page)).slice(0, 160) + ')');
    ok(await page.evaluate(() => document.getElementById('maintenanceOverlay').style.display === 'flex'), 'the maintenance screen is up');
    const d = await draftOf(page, 'tameka');
    ok(d.length === 1 && sameAnswers(d[0].answers, EXPECT), 'her answers are saved on this computer, the last key typed included');
    await admin.evaluate(() => localStorage.setItem('voctrain_maintenanceMode', JSON.stringify({ active: false, message: '', updatedAt: new Date(Date.now() + 1000).toISOString() })));
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => document.getElementById('maintenanceOverlay').style.display === 'none'), 'the site is back');
    ok(await signIn(page, 'tameka'), 'she signs in again');
    ok(await continueAttempt(page), 'and carries on');
    restoredOk('after maintenance', await onScreen(page), before.deadline);
    await admin.close();
    await ctx.close();
  });

  await section('2c. Kicked out because her account was switched off: signed out with no "Cancel", answers saved', async () => {
    const ctx = await computer();
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await startFresh(page);
    await answerEverything(page);
    const before = await onScreen(page);
    await recordToasts(page);
    const asked = dialogs.length;
    await page.evaluate(() => { const u = userAccounts.find(x => x.id === currentLoggedInUser.id); u.status = 'disabled'; sessionHeartbeat(); });
    await page.waitForTimeout(1200);
    ok(dialogs.slice(asked).filter(x => x.type === 'confirm').length === 0, 'she is NOT asked "Sign out now?" (a Cancel there kept a switched-off account in the test)');
    ok(!(await signedIn(page)), 'she is signed out');
    ok(/switched off by an administrator.*Your test answers are saved/.test(await toasts(page)), 'told why, and that her answers are saved (' + (await toasts(page)).slice(0, 160) + ')');
    if (SHOTS) await shot(page, '09-switched-off-signed-out-after-desktop');
    const d = await draftOf(page, 'tameka');
    ok(d.length === 1 && sameAnswers(d[0].answers, EXPECT), 'her answers are saved on this computer');
    // The office switches her back on.
    await page.evaluate(() => { const u = userAccounts.find(x => x.username === 'tameka.richards'); u.status = 'active'; u.updatedAt = new Date().toISOString(); saveUserAccounts(); });
    ok(await signIn(page, 'tameka'), 'switched back on, she signs in');
    ok(await continueAttempt(page), 'and carries on');
    restoredOk('after the account was switched back on', await onScreen(page), before.deadline);
    await ctx.close();
  });

  await section('2d. Another trainee signs in on the same PC: he never sees or submits her answers; she carries on later', async () => {
    const ctx = await computer();
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await startFresh(page);
    await answerEverything(page);
    const before = await onScreen(page);
    const asked = dialogs.length;
    await page.click('.logout-btn');
    await page.waitForTimeout(1500);
    ok(dialogs.slice(asked).some(x => x.type === 'confirm' && /middle of an exam/.test(x.msg)), 'pressing Sign Out asks first (a person may stay)');
    ok(!(await signedIn(page)), 'she signs out');
    ok(await signIn(page, 'kemar'), 'Kemar signs in on the same PC');
    const label = await myExams(page);
    ok(label === 'Take Exam', 'his My Exams offers his own "Take Exam", not her attempt (' + label + ')');
    const leak = await page.evaluate(([e, s]) => document.body.innerText.indexOf(e) !== -1 || document.body.innerText.indexOf(s) !== -1 || !!currentExamSession, [ESSAY_HALF.slice(0, 30), 'Flashback arrestor']);
    ok(!leak, 'none of her answers is on his screen');
    await startFresh(page);
    const his = await onScreen(page);
    ok(his.attemptId !== before.attemptId && his.answers.every(a => a === null), 'his attempt is his own, with nothing answered');
    await page.locator('#examQ-0 label.exam-choice', { hasText: 'Blue' }).click();
    await submitAll(page);
    const kr = await resultsFor(page, 'kemar');
    ok(kr.length === 1 && kr[0].answers[0].studentAnswer !== undefined, 'his result is his');
    ok(kr.length === 1 && JSON.stringify(kr[0]).indexOf(ESSAY_HALF.slice(0, 30)) === -1 && JSON.stringify(kr[0]).indexOf('Flashback arrestor') === -1, 'and carries none of her answers');
    ok((await resultsFor(page, 'tameka')).length === 0, 'nothing was submitted for her');
    await page.click('#studentExamResultView button:has-text("Back")').catch(() => {});
    await page.click('.logout-btn');
    await page.waitForTimeout(1500);
    ok(await signIn(page, 'tameka'), 'later, Tameka signs in again on the same PC');
    leftOk('after Kemar', await myExams(page), before.deadline);
    ok(await continueAttempt(page), 'and carries on');
    restoredOk('after another trainee used the PC', await onScreen(page), before.deadline);
    await ctx.close();
  });

  // The shared copy the online build syncs through: every copy of the main
  // backup (one per folder), each collection a list.
  function driveCopies(drive) {
    return Object.values(drive.files).filter(f => f.name === 'CESTIS_LMS_BACKUP.json' && !f.trashed).map(f => {
      try { return JSON.parse(f.content || '{}').data || {}; } catch (e) { return {}; }
    });
  }
  const driveResults = (drive, who) => driveCopies(drive).map(d => (d.examResults || []).filter(r => r && !r.archived && r.examId === 'EXAM-WS3' && r.studentName === PEOPLE[who].name));
  const driveAttempts = (drive, who) => driveCopies(drive).map(d => (d.examAttempts || []).filter(a => a && a.examId === 'EXAM-WS3' && a.studentName === PEOPLE[who].name || (a && a.status === 'submitted')));
  async function until(fn, ms, step) {
    const end = Date.now() + (ms || 30000);
    for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 500); }
  }
  // What a result says she answered, in the order of the paper (no
  // information item).
  const EXPECT_Q = EXPECT.filter((a, i) => QUESTIONS[i].type !== 'info');
  const resultAnswers = r => (r.answers || []).map(a => a.studentAnswer === undefined ? null : a.studentAnswer);

  // ---------------------------------------------------------------- 3
  await section('3. Disconnected: she answers on, changes pages and submits with the network gone; the result is sent once when it is back', async () => {
    const drive = new FakeDrive();
    const ctx = await computer({ drive });
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in on a PC that syncs');
    ok(await until(() => driveCopies(drive).length > 0, 30000), 'the PC has synced (the shared copy exists)');
    await startFresh(page);
    await page.locator('#examQ-0 label.exam-choice', { hasText: 'Red' }).click();
    ok(await until(() => driveAttempts(drive, 'tameka').some(l => l.some(a => a.status === 'open')), 30000), 'her attempt is shared at its first answer');
    await setOffline(ctx, true);
    ok(await page.evaluate(() => navigator.onLine === false), 'the network is gone');
    await answerEverything(page);
    await page.waitForTimeout(6500);                          // an autosave tick or so with no network
    ok(!!(await onScreen(page)), 'she is still in her test');
    const d = await draftOf(page, 'tameka');
    ok(d.length === 1 && sameAnswers(d[0].answers, EXPECT), 'every answer is saved on the computer meanwhile');
    await recordToasts(page);
    await submitAll(page);
    const note = await txt(page, '#examResultNote');
    ok(/Your answers are safe on this computer, and your result will be sent to the office when it is back online\./.test(note), 'a calm, true message: "' + note + '"');
    await readable(page, 'offline note', ['#examResultNote .exam-note-text']);
    const chip = await txt(page, '#syncChip');
    ok(/Waiting to send/.test(chip), 'the top bar\'s chip agrees at once: "' + chip.trim() + '"');
    await page.waitForTimeout(800);                           // the offline notice has slid in
    await shot(page, '06-offline-submit-desktop');
    ok((await page.evaluate(() => JSON.parse(CESTISStore.getItem('cestisExamOutbox') || '[]').length)) === 1, 'the result waits on this computer, ready to be sent');
    ok(driveResults(drive, 'tameka').every(l => l.length === 0), 'nothing has reached the shared copy yet');
    await setOffline(ctx, false);
    ok(await until(() => driveResults(drive, 'tameka').some(l => l.length === 1), 45000), 'back online, the result is sent');
    await page.waitForTimeout(7000);                           // another tick or two: nothing more is sent
    const sent = driveResults(drive, 'tameka');
    ok(sent.every(l => l.length <= 1), 'no copy of the shared data holds it twice (' + sent.map(l => l.length).join(',') + ')');
    const r = sent.find(l => l.length)[0];
    ok(sameAnswers(resultAnswers(r), EXPECT_Q), 'with every answer she gave offline (' + JSON.stringify(resultAnswers(r)).slice(0, 160) + ')');
    ok(await until(() => page.evaluate(() => !CESTISStore.getItem('cestisExamOutbox')), 30000), 'once the shared copy holds it, the computer lets its waiting copy go');
    ok(await until(async () => /All saved/.test(await txt(page, '#syncChip')), 15000, 1000), 'and the chip says "All saved"');
    ok(!!r.attemptId && r.attemptId === d[0].id, 'from her one attempt');
    ok((await resultsFor(page, 'tameka')).length === 1, 'and this computer holds one result');
    ok(driveAttempts(drive, 'tameka').every(l => !l.some(a => a.status === 'open' && a.id === r.attemptId)), 'the shared copy of the attempt is closed (submitted)');
    await ctx.close();
  }, { light: true });

  // ---------------------------------------------------------------- 4
  await section('4. The time ran out while she was away: submitted automatically, once, with a note', async () => {
    const ctx = await computer();
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await startFresh(page);
    await answerEverything(page);
    page = await kill(ctx, page, 'crash');
    // She is away longer than the time she had: the clock ran out two
    // minutes ago (the attempt's own start and deadline moved back an hour).
    await page.evaluate(() => {
      const X = CESTISCore.exams, back = 62 * 60000;
      CESTISStore.keys().filter(k => k.indexOf(X.DRAFT_PREFIX) === 0).forEach(k => {
        const d = JSON.parse(CESTISStore.getItem(k)); d.startTime -= back; d.deadline -= back; CESTISStore.setItem(k, JSON.stringify(d));
      });
      const list = JSON.parse(CESTISStore.getItem('voctrain_examAttempts') || '[]');
      list.forEach(a => { if (a.startTime) { a.startTime -= back; a.deadline -= back; } });
      CESTISStore.setItem('voctrain_examAttempts', JSON.stringify(list));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await recordToasts(page);
    ok(await signIn(page, 'tameka'), 'she signs in again, after the time ran out');
    ok(await until(() => page.evaluate(() => !!document.getElementById('examResultNote')), 15000), 'she is shown her result straight away, without pressing anything');
    const note = await txt(page, '#examResultNote');
    ok(/Time ran out on this test while you were away\. The answers saved for you were submitted automatically on /.test(note), 'with the note: "' + note + '"');
    ok(!/clock is still running/.test(await toasts(page)), 'and is not told "the clock is still running" (' + (await toasts(page)).slice(0, 120) + ')');
    await readable(page, 'time-ran-out note', ['#examResultNote .exam-note-text']);
    await shot(page, '07-time-ran-out-auto-submitted-desktop');
    let mine = await resultsFor(page, 'tameka');
    ok(mine.length === 1 && mine[0].autoSubmitted === true, 'one result, marked as submitted automatically');
    ok(mine.length === 1 && sameAnswers(resultAnswers(mine[0]), EXPECT_Q), 'with every answer she had saved');
    const label = await myExams(page);
    ok(/Completed/.test(await txt(page, '#studentUpcomingExams')) || !(await examCard(page).count()), 'My Exams no longer offers the test (' + label + ')');
    ok(!/Continue your attempt|Submit saved answers|Take Exam/.test(await txt(page, '#studentUpcomingExams')), 'nothing to continue, submit or start again');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    ok(await signIn(page, 'tameka'), 'signing in once more');
    await page.waitForTimeout(2500);
    mine = await resultsFor(page, 'tameka');
    ok(mine.length === 1, 'still one result — it is never submitted twice');
    ok(!(await page.evaluate(() => !!document.getElementById('examResultNote') && document.getElementById('studentExamResultView').style.display !== 'none')), 'and no second "submitted automatically"');
    await ctx.close();
  }, { light: true });

  // ---------------------------------------------------------------- 5
  const ESSAY_FULL = ESSAY_HALF + 'inder valves, then bleed both lines and back off the regulators.';
  // One sync of this PC now (the 5-second sync, brought forward), with the
  // test's 30-second share brought forward too when one is open.
  const syncNow = page => page.evaluate(async () => {
    for (let i = 0; i < 80 && _isAutoSaving; i++) await new Promise(r => setTimeout(r, 250));
    try { if (currentExamSession) examPublishNow(); } catch (e) {}
    await autoSaveToAllFolders();
    return _lastAutoSaveResult && _lastAutoSaveResult.uploaded;
  });
  const openShared = (lists, id) => lists.some(l => l.some(a => a.status === 'open' && (!id || a.id === id)));
  const sharedHas = (lists, id, answers) => lists.some(l => l.some(a => a.id === id && a.status === 'open' && sameAnswers(a.answers, answers)));
  async function finishEssay(page) {
    await navTo(page, 10);
    await page.click('#examAns-10');
    await page.keyboard.press('End');
    await page.keyboard.type(ESSAY_FULL.slice(ESSAY_HALF.length), { delay: 3 });
  }

  await section('5a. Two PCs, online: PC 1 dies mid-test; she carries on and submits on PC 2; PC 1 comes back — one result, nothing lost', async () => {
    const drive = new FakeDrive();
    const pc1 = await computer({ drive }), pc2 = await computer({ drive });
    let p1 = await open(pc1, { label: 'PC 1' });
    ok(await signIn(p1, 'tameka'), 'PC 1: Tameka signs in');
    ok(await until(() => driveCopies(drive).length > 0, 30000), 'PC 1 has synced');
    await startFresh(p1);
    await answerEverything(p1);
    const before = await onScreen(p1);
    await shot(p1, '01-pc1-mid-attempt-desktop');
    const t0 = Date.now();
    ok(await until(() => sharedHas(driveAttempts(drive, 'tameka'), before.attemptId, EXPECT), 60000, 1000), 'within the share interval her answers reach the shared copy (' + Math.round((Date.now() - t0) / 1000) + ' s after the last key)');
    // PC 1 dies (a power cut): nothing on it runs again for now.
    const cdp = await pc1.newCDPSession(p1);
    cdp.send('Page.crash').catch(() => {});
    await wait(800);
    await Promise.race([p1.close().catch(() => {}), wait(3000)]);
    // She goes to PC 2, which has the Centre's records and syncs.
    let p2 = await open(pc2, { label: 'PC 2' });
    ok(await signIn(p2, 'tameka'), 'PC 2: she signs in');
    let label = '';
    ok(await until(async () => { label = await myExams(p2); return /Continue your attempt/.test(label); }, 30000, 1500), 'PC 2 offers "Continue your attempt", not a fresh "Take Exam" (' + label + ')');
    leftOk('PC 2', label, before.deadline);
    await shot(p2, '02-pc2-my-exams-continue-desktop');
    ok(await continueAttempt(p2), 'PC 2: Continue opens it');
    restoredOk('PC 2', await onScreen(p2), before.deadline);
    await onScreenMatches(p2, 'PC 2');
    ok((await onScreen(p2)).attemptId === before.attemptId, 'PC 2: the same attempt, never a second one');
    await shot(p2, '03-pc2-restored-page2-desktop');
    await finishEssay(p2);
    await submitAll(p2);
    const r2 = (await resultsFor(p2, 'tameka'))[0];
    ok(!!r2 && r2.attemptId === before.attemptId, 'PC 2: submitted, as that attempt');
    ok(!!r2 && sameAnswers(resultAnswers(r2), EXPECT_Q.slice(0, -1).concat([ESSAY_FULL])), 'with everything from PC 1 and the essay finished on PC 2');
    ok(await until(() => driveResults(drive, 'tameka').some(l => l.length === 1), 30000), 'the result reaches the shared copy');
    // PC 1 comes back, holding its old copy of the open attempt.
    p1 = await reopen(pc1, 'PC 1 back');
    ok((await draftOf(p1, 'tameka')).some(d => d.status === 'open'), 'PC 1 still holds its old copy of the attempt');
    await recordToasts(p1);
    ok(await signIn(p1, 'tameka'), 'PC 1: she signs in there again');
    ok(await until(async () => /Completed/.test(await txt(p1, '#studentUpcomingExams')) || !(await examCard(p1).count()) || (await myExams(p1)) === 'Completed', 30000, 1500), 'PC 1: the test reads as done');
    await go(p1, 's-exams');
    ok(!/Continue your attempt|Take Exam|Submit saved answers/.test(await txt(p1, '#studentUpcomingExams')), 'PC 1 offers nothing to continue, submit or start again');
    ok((await p1.locator('#studentPastExamResults .class-schedule-card').count()) === 1, 'and lists one result');
    ok(!/in progress/.test(await toasts(p1)), 'PC 1 does not tell her "You have a test in progress" (' + (await toasts(p1)).slice(0, 100) + ')');
    await shot(p1, '05-pc1-back-one-result-desktop');
    const old1 = await draftOf(p1, 'tameka');
    ok(old1.length === 1 && old1[0].status === 'submitted' && !old1[0].answers, 'its old copy is closed (' + old1.map(d => d.status).join() + ')');
    await p1.waitForTimeout(6000);
    await syncNow(p1);
    const onDrive = driveResults(drive, 'tameka');
    ok(onDrive.every(l => l.length === 1), 'one result in the shared copy (' + onDrive.map(l => l.length).join(',') + ')');
    ok(onDrive.every(l => l[0].id === r2.id && sameAnswers(resultAnswers(l[0]), resultAnswers(r2))), 'and it is PC 2\'s, with every answer');
    ok((await resultsFor(p1, 'tameka')).length === 1, 'PC 1 holds that one result too');
    ok(!openShared(driveAttempts(drive, 'tameka'), before.attemptId), 'the shared copy of the attempt stays closed (PC 1\'s old copy did not reopen it)');
    await pc1.close(); await pc2.close();
  });

  await section('5b. Two PCs, online: PC 1 is cut off with the test open; PC 2 submits; PC 1 reconnects and is told calmly', async () => {
    const drive = new FakeDrive();
    const pc1 = await computer({ drive }), pc2 = await computer({ drive });
    let p1 = await open(pc1, { label: 'PC 1' });
    ok(await signIn(p1, 'tameka'), 'PC 1: Tameka signs in');
    ok(await until(() => driveCopies(drive).length > 0, 30000), 'PC 1 has synced');
    await startFresh(p1);
    await answerEverything(p1);
    const before = await onScreen(p1);
    ok(await until(() => sharedHas(driveAttempts(drive, 'tameka'), before.attemptId, EXPECT), 60000, 1000), 'her answers reach the shared copy');
    await setOffline(pc1, true);                                 // the network cable is pulled; the page stays open
    let p2 = await open(pc2, { label: 'PC 2' });
    ok(await signIn(p2, 'tameka'), 'PC 2: she signs in');
    ok(await until(async () => /Continue your attempt/.test(await myExams(p2)), 30000, 1500), 'PC 2 offers "Continue your attempt"');
    ok(await continueAttempt(p2), 'and opens it');
    await finishEssay(p2);
    await submitAll(p2);
    ok(await until(() => driveResults(drive, 'tameka').some(l => l.length === 1), 30000), 'PC 2\'s result reaches the shared copy');
    await setOffline(pc1, false);
    ok(await until(() => p1.evaluate(() => !currentExamSession), 40000, 1000), 'PC 1, back online, closes the test');
    const note = (await txt(p1, '#examResultNote')) || (await txt(p1, '#examListNote'));
    ok(/This test was submitted on another device\. Your answers are kept with the result\./.test(note), 'and says so calmly: "' + note + '"');
    ok(await p1.isVisible('#studentExamResultView .exam-review'), 'showing that one result');
    await readable(p1, 'submitted-elsewhere note', [(await p1.$('#examResultNote')) ? '#examResultNote .exam-note-text' : '#examListNote .exam-note-text']);
    await shot(p1, '04-pc1-back-submitted-elsewhere-desktop');
    await p1.waitForTimeout(6000);
    await syncNow(p1);
    ok(driveResults(drive, 'tameka').every(l => l.length === 1), 'still one result in the shared copy — PC 1 never submitted its own');
    ok((await resultsFor(p1, 'tameka')).length === 1, 'and one on PC 1');
    await pc1.close(); await pc2.close();
  }, { light: true });

  await section('5c. Two PCs, online, both answering at once: question by question the newest answer wins, and each side is told', async () => {
    const drive = new FakeDrive();
    const pc1 = await computer({ drive }), pc2 = await computer({ drive });
    let p1 = await open(pc1, { label: 'PC 1' });
    ok(await signIn(p1, 'tameka'), 'PC 1: Tameka signs in');
    ok(await until(() => driveCopies(drive).length > 0, 30000), 'PC 1 has synced');
    await startFresh(p1);
    await answerEverything(p1, { lastTyped: false });
    await syncNow(p1);
    let p2 = await open(pc2, { label: 'PC 2' });
    ok(await signIn(p2, 'tameka'), 'PC 2: she signs in');
    ok(await until(async () => /Continue your attempt/.test(await myExams(p2)), 30000, 1500), 'PC 2 offers "Continue your attempt"');
    ok(await continueAttempt(p2), 'PC 2 opens the same attempt while PC 1 still has it open');
    // Q7 on PC 1, then Q7 differently on PC 2 (newer), then Q8 on PC 1 (newer still).
    await navTo(p1, 7);
    await p1.locator('#examQ-7 label.exam-choice', { hasText: 'Pour water on the torch' }).click();
    await wait(300);
    await navTo(p2, 7);
    await p2.locator('#examQ-7 label.exam-choice', { hasText: 'Bend the hose' }).click();
    await wait(300);
    await p1.fill('#examAns-8', '20');
    await syncNow(p1);
    await syncNow(p2);
    await syncNow(p1);
    const a1 = (await onScreen(p1)).answers, a2 = (await onScreen(p2)).answers;
    ok(a1[7] === 2 && a2[7] === 2, 'Q7: PC 2\'s later answer wins on both (' + a1[7] + ', ' + a2[7] + ')');
    ok(a1[8] === '20' && a2[8] === '20', 'Q8: PC 1\'s later answer wins on both (' + a1[8] + ', ' + a2[8] + ')');
    ok(sameAnswers(a1, a2), 'both PCs show the same paper');
    ok(a1[5] === null && a1[3] && a1[10] === ESSAY_HALF, 'and nothing else was lost or changed');
    const n1 = await txt(p1, '#examElsewhereNote'), n2 = await txt(p2, '#examElsewhereNote');
    ok(/This test was continued on another device\. Your answers are kept: the newest answer to each question is used\./.test(n1), 'PC 1 is told: "' + n1 + '"');
    ok(/continued on another device/.test(n2), 'PC 2 is told too: "' + n2 + '"');
    ok((await p2.inputValue('#examAns-8').catch(() => '')) === '20' || (await onScreen(p2)).page !== 2, 'PC 2\'s screen shows PC 1\'s answer to Q8');
    await readable(p1, 'continued-elsewhere note', ['#examElsewhereNote .exam-note-text', '#examElsewhereNote .btn']);
    await shot(p1, '10-both-pcs-at-once-note-desktop', '#examAttemptMain');
    await submitAll(p2);
    ok(await until(() => p1.evaluate(() => !currentExamSession), 40000, 1000), 'PC 2 submits; PC 1 closes the test once it hears');
    await p1.waitForTimeout(6000);
    await syncNow(p1); await syncNow(p2);
    ok(driveResults(drive, 'tameka').every(l => l.length === 1), 'one result in the shared copy');
    const r = driveResults(drive, 'tameka').find(l => l.length)[0];
    ok(resultAnswers(r)[6] === 2 && resultAnswers(r)[7] === '20', 'with the newest answer to each question (Q7 from PC 2, Q8 from PC 1)');
    await pc1.close(); await pc2.close();
  }, { light: true });

  // The Centre's own network: the Offline System on its real server, the
  // outside world unreachable.
  async function centreServer() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-exam-resume-'));
    const DATA = path.join(tmp, 'data');
    const PORT = 9100 + Math.floor(Math.random() * 800);
    const proc = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: OFF, stdio: 'ignore',
      env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
    for (let i = 0; i < 50; i++) { await wait(100); try { if ((await fetch('http://127.0.0.1:' + PORT + '/_cestis/health')).ok) break; } catch (e) {} }
    const list = k => { try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8')); return d.data[k] ? JSON.parse(d.data[k]) : []; } catch (e) { return []; } };
    return { origin: 'http://127.0.0.1:' + PORT, list,
      results: who => list('voctrain_examResults').filter(r => r && !r.archived && r.examId === 'EXAM-WS3' && r.studentName === PEOPLE[who].name),
      attempts: who => list('voctrain_examAttempts').filter(a => a && a.examId === 'EXAM-WS3' && (a.studentName === PEOPLE[who].name || a.status === 'submitted')),
      stop: async () => { proc.kill(); await wait(200); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} } };
  }
  // This PC's share and the network's latest, now (the share and the
  // 30-second refresh, brought forward).
  const lanSyncNow = page => page.evaluate(async () => {
    try { if (currentExamSession) examPublishNow(); } catch (e) {}
    await new Promise(r => setTimeout(r, 1700));                // the store's own push, debounced
    await CESTISPageCloud.saveNow();
    await CESTISPageCloud.loadNow();
    return true;
  });

  await section('5d. Two PCs on the Centre\'s network: PC 1 dies mid-test; she carries on and submits on PC 2; PC 1 comes back — one result, nothing lost', async () => {
    const lan = await centreServer();
    try {
      const pc1 = await computer({ origin: lan.origin }), pc2 = await computer({ origin: lan.origin });
      let p1 = await open(pc1, { label: 'LAN PC 1' });
      ok(await p1.evaluate(() => CESTISPageCloud.lan()), 'PC 1 is on the Centre\'s network');
      ok(await signIn(p1, 'tameka'), 'PC 1: Tameka signs in');
      await startFresh(p1);
      await answerEverything(p1);
      const before = await onScreen(p1);
      const t0 = Date.now();
      ok(await until(() => lan.attempts('tameka').some(a => a.id === before.attemptId && a.status === 'open' && sameAnswers(a.answers, EXPECT)), 60000, 1000),
        'within the share interval her answers reach the Centre\'s copy (' + Math.round((Date.now() - t0) / 1000) + ' s after the last key)');
      const cdp = await pc1.newCDPSession(p1);
      cdp.send('Page.crash').catch(() => {});
      await wait(800);
      await Promise.race([p1.close().catch(() => {}), wait(3000)]);
      let p2 = await open(pc2, { label: 'LAN PC 2' });
      ok(await signIn(p2, 'tameka'), 'PC 2: she signs in');
      let label = '';
      ok(await until(async () => { label = await myExams(p2); return /Continue your attempt/.test(label); }, 40000, 2000), 'PC 2 offers "Continue your attempt" (' + label + ')');
      leftOk('LAN PC 2', label, before.deadline);
      if (SHOTS) await shot(p2, '02b-lan-pc2-my-exams-continue-desktop');
      ok(await continueAttempt(p2), 'PC 2: Continue opens it');
      restoredOk('LAN PC 2', await onScreen(p2), before.deadline);
      await onScreenMatches(p2, 'LAN PC 2');
      await finishEssay(p2);
      await submitAll(p2);
      const r2 = (await resultsFor(p2, 'tameka'))[0];
      ok(!!r2 && r2.attemptId === before.attemptId && sameAnswers(resultAnswers(r2), EXPECT_Q.slice(0, -1).concat([ESSAY_FULL])), 'PC 2: submitted, as that attempt, with everything');
      ok(await until(() => lan.results('tameka').length === 1, 30000), 'the result reaches the Centre\'s copy');
      ok(await until(() => p2.evaluate(() => !CESTISStore.getItem('cestisExamOutbox')), 20000), 'PC 2 lets its waiting copy go once the Centre holds it');
      ok(await until(async () => /All saved/.test(await txt(p2, '#syncChip')), 10000, 1000), 'and its top bar says "All saved" (' + (await txt(p2, '#syncChip')).trim() + ')');
      p1 = await reopen(pc1, 'LAN PC 1 back');
      // On the Centre's network the page has the Centre's latest as it opens,
      // so its old copy is closed before anybody signs in.
      ok((await draftOf(p1, 'tameka')).length === 1, 'PC 1 still has its own copy of the attempt (' + (await draftOf(p1, 'tameka')).map(d => d.status).join() + ')');
      ok(await signIn(p1, 'tameka'), 'PC 1: she signs in there again');
      await go(p1, 's-exams');
      ok(await until(async () => { await go(p1, 's-exams'); return !/Continue your attempt|Take Exam|Submit saved answers/.test(await txt(p1, '#studentUpcomingExams')); }, 40000, 2000), 'PC 1 offers nothing to continue, submit or start again');
      ok(await until(async () => { const o = await draftOf(p1, 'tameka'); return o.length === 1 && o[0].status === 'submitted'; }, 20000), 'its old copy is closed');
      await lanSyncNow(p1);
      ok(lan.results('tameka').length === 1 && lan.results('tameka')[0].id === r2.id, 'one result in the Centre\'s copy — PC 2\'s (' + lan.results('tameka').length + ')');
      ok((await resultsFor(p1, 'tameka')).length === 1, 'and one on PC 1');
      ok(!lan.attempts('tameka').some(a => a.id === before.attemptId && a.status === 'open'), 'the attempt stays closed in the Centre\'s copy');
      await pc1.close(); await pc2.close();
    } finally { await lan.stop(); }
  });

  await section('5e. Two PCs on the Centre\'s network, both answering at once; then PC 1 is cut off, PC 2 submits, and PC 1 is told when it is back', async () => {
    const lan = await centreServer();
    try {
      const pc1 = await computer({ origin: lan.origin }), pc2 = await computer({ origin: lan.origin });
      let p1 = await open(pc1, { label: 'LAN PC 1' });
      ok(await signIn(p1, 'tameka'), 'PC 1: Tameka signs in');
      await startFresh(p1);
      await answerEverything(p1, { lastTyped: false });
      await lanSyncNow(p1);
      let p2 = await open(pc2, { label: 'LAN PC 2' });
      ok(await signIn(p2, 'tameka'), 'PC 2: she signs in');
      ok(await until(async () => /Continue your attempt/.test(await myExams(p2)), 40000, 2000), 'PC 2 offers "Continue your attempt"');
      ok(await continueAttempt(p2), 'PC 2 opens the same attempt while PC 1 still has it open');
      await navTo(p1, 7);
      await p1.locator('#examQ-7 label.exam-choice', { hasText: 'Pour water on the torch' }).click();
      await wait(300);
      await navTo(p2, 7);
      await p2.locator('#examQ-7 label.exam-choice', { hasText: 'Bend the hose' }).click();
      await wait(300);
      await p1.fill('#examAns-8', '20');
      await lanSyncNow(p1);
      await lanSyncNow(p2);
      await lanSyncNow(p1);
      const a1 = (await onScreen(p1)).answers, a2 = (await onScreen(p2)).answers;
      ok(a1[7] === 2 && a2[7] === 2, 'Q7: PC 2\'s later answer wins on both (' + a1[7] + ', ' + a2[7] + ')');
      ok(a1[8] === '20' && a2[8] === '20', 'Q8: PC 1\'s later answer wins on both (' + a1[8] + ', ' + a2[8] + ')');
      ok(sameAnswers(a1, a2) && a1[10] === ESSAY_HALF, 'both PCs show the same paper, nothing else lost');
      ok(/continued on another device/.test(await txt(p1, '#examElsewhereNote')) && /continued on another device/.test(await txt(p2, '#examElsewhereNote')), 'each side is told calmly');
      await setOffline(pc1, true);
      await submitAll(p2);
      ok(await until(() => lan.results('tameka').length === 1, 30000), 'PC 2 submits; the result reaches the Centre\'s copy');
      await setOffline(pc1, false);
      ok(await until(async () => { await p1.evaluate(() => CESTISPageCloud.loadNow().catch(() => {})); return p1.evaluate(() => !currentExamSession); }, 40000, 2000), 'PC 1, back on the network, closes the test');
      const note = (await txt(p1, '#examResultNote')) || (await txt(p1, '#examListNote'));
      ok(/This test was submitted on another device\. Your answers are kept with the result\./.test(note), 'and says so: "' + note + '"');
      await lanSyncNow(p1); await lanSyncNow(p2);
      ok(lan.results('tameka').length === 1, 'one result in the Centre\'s copy');
      const r = lan.results('tameka')[0];
      ok(r && resultAnswers(r)[6] === 2 && resultAnswers(r)[7] === '20', 'with the newest answer to each question');
      ok((await resultsFor(p1, 'tameka')).length === 1, 'PC 1 holds that one result');
      await pc1.close(); await pc2.close();
    } finally { await lan.stop(); }
  });

  // ---------------------------------------------------------------- 6
  for (const how of ['reload', 'crash']) {
    section('6' + (how === 'reload' ? 'a' : 'b') + '. On a phone (390x844): ' + (how === 'reload' ? 'a reload' : 'the page killed') + ' mid-test — she carries on where she stopped', async () => {
      const ctx = await computer({ phone: true });
      let page = await open(ctx);
      ok(await signIn(page, 'tameka'), 'Tameka signs in on her phone');
      await startFresh(page);
      await answerEverything(page);
      const before = await onScreen(page);
      ok(sameAnswers(before.answers, EXPECT), 'phone: everything answered through its own controls');
      if (how === 'reload') await shot(page, '11-phone-mid-attempt');
      page = await kill(ctx, page, how);
      ok(await signIn(page, 'tameka'), 'phone: she signs in again');
      const label = await myExams(page);
      leftOk('phone ' + how, label, before.deadline);
      if (how === 'reload') await shot(page, '12-phone-my-exams-continue');
      ok(await continueAttempt(page), 'phone: Continue opens it');
      restoredOk('phone ' + how, await onScreen(page), before.deadline);
      await onScreenMatches(page, 'phone ' + how);
      const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, w: innerWidth }));
      ok(wide.doc <= wide.w, 'phone: nothing is wider than the screen (' + JSON.stringify(wide) + ')');
      const tap = await page.evaluate(() => { const b = document.querySelector('#studentExamTakingView .exam-page-nav .btn'); return b ? b.getBoundingClientRect().height : 0; });
      ok(tap >= 44, 'phone: the page buttons are still easy to tap (' + tap + 'px)');
      if (how === 'crash') await shot(page, '13-phone-restored-after-kill');
      await ctx.close();
    });
  }
  section('6c. On a phone, the network gone: she answers on and submits; the result is sent once when it is back', async () => {
    const drive = new FakeDrive();
    const ctx = await computer({ phone: true, drive });
    let page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in on her phone');
    ok(await until(() => driveCopies(drive).length > 0, 30000), 'the phone has synced');
    await startFresh(page);
    await setOffline(ctx, true);
    await answerEverything(page);
    await submitAll(page);
    const note = await txt(page, '#examResultNote');
    ok(/your result will be sent to the office when it is back online/.test(note), 'phone: the calm message (' + note + ')');
    const nb = await page.locator('#examResultNote').boundingBox();
    ok(nb && nb.y >= 0 && nb.y + nb.height <= 844, 'phone: the result opens at its top, the message in view (y=' + (nb && Math.round(nb.y)) + ')');
    await readable(page, 'phone offline note', ['#examResultNote .exam-note-text']);
    const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, w: innerWidth }));
    ok(wide.doc <= wide.w, 'phone: the note fits the screen (' + JSON.stringify(wide) + ')');
    await shot(page, '14-phone-offline-submit');
    ok(driveResults(drive, 'tameka').every(l => l.length === 0), 'phone: nothing sent while the network is gone');
    await setOffline(ctx, false);
    ok(await until(() => driveResults(drive, 'tameka').some(l => l.length === 1), 45000), 'phone: back online, the result is sent');
    await page.waitForTimeout(6000);
    ok(driveResults(drive, 'tameka').every(l => l.length <= 1), 'phone: once');
    const r = driveResults(drive, 'tameka').find(l => l.length)[0];
    ok(sameAnswers(resultAnswers(r), EXPECT_Q), 'phone: with every answer');
    await ctx.close();
  }, { light: true });

  // ---------------------------------------------------------------- 7
  section('7. The same test in two tabs of one PC: each shows the other\'s answers, never writes an older copy back, and it is submitted once', async () => {
    const ctx = await computer();
    const a = await open(ctx, { label: 'tab A' });
    ok(await signIn(a, 'tameka'), 'tab A: Tameka signs in');
    await startFresh(a);
    await a.locator('#examQ-0 label.exam-choice', { hasText: 'Red' }).click();
    await a.click('#examFlag-1');
    const b = await reopen(ctx, 'tab B');
    ok(await signIn(b, 'tameka'), 'tab B: she opens the site again and signs in');
    ok(await continueAttempt(b), 'tab B: "Continue your attempt" opens the same attempt');
    ok((await onScreen(b)).attemptId === (await onScreen(a)).attemptId, 'the same attempt in both tabs');
    // Tab A answers Q3; tab B (older until it hears) must not undo it.
    for (const t of ['Welding helmet', 'Leather gloves', 'Polyester overalls']) await a.locator('#examQ-2 label.exam-choice', { hasText: t }).click();
    await b.waitForTimeout(600);
    ok(sameAnswers((await onScreen(b)).answers[2], [0, 1, 4]), 'tab B shows tab A\'s new answer at once');
    const nb = await txt(b, '#examElsewhereNote');
    ok(/This test is also open in another window\. Your answers are kept: the newest answer to each question is used\./.test(nb), 'and says so: "' + nb + '"');
    await readable(b, 'other-window note', ['#examElsewhereNote .exam-note-text', '#examElsewhereNote .btn']);
    await shot(b, '15-two-tabs-note-desktop', '#examAttemptMain');
    await navTo(b, 3);
    await b.fill('#examAns-4', 'Flashback arrestor');
    await a.waitForTimeout(600);
    ok((await onScreen(a)).answers[4] === 'Flashback arrestor', 'tab A shows tab B\'s answer');
    // Tab A saves again (its 15-second clock): tab B's answer is kept.
    await a.evaluate(() => autoSaveExamProgress());
    const d = await draftOf(a, 'tameka');
    ok(d.length === 1 && d[0].answers[4] === 'Flashback arrestor' && sameAnswers(d[0].answers[2], [0, 1, 4]) && d[0].answers[0] === 0 && d[0].flagged[1] === true,
      'the saved attempt holds both tabs\' answers — an older window\'s save no longer puts its copy over newer answers');
    await submitAll(a);
    await b.waitForTimeout(1200);
    ok(await b.evaluate(() => !currentExamSession), 'tab B closes the attempt when tab A submits');
    const tb = await txt(b, '#examResultNote');
    ok(/This test was submitted in another window\. Your answers are kept with the result\./.test(tb), 'and says so: "' + tb + '"');
    ok(await b.isVisible('#studentExamResultView .exam-review') && !(await b.$('#examListNote')), 'showing the result itself (it is stored before the attempt is closed, so the other tab finds it)');
    await readable(b, 'submitted-in-another-window note', ['#examResultNote .exam-note-text']);
    await shot(b, '16-two-tabs-submitted-in-other-window-desktop');
    await b.waitForTimeout(16000);                                  // both tabs' clocks: nothing more is submitted
    const stored = await a.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_examResults') || '[]').filter(r => r.examId === 'EXAM-WS3' && !r.archived));
    ok(stored.length === 1, 'one result for the attempt (two windows used to submit two)');
    ok((await resultsFor(b, 'tameka')).length <= 1 && (await resultsFor(a, 'tameka')).length === 1, 'each tab holds at most that one');
    await ctx.close();
  }, { light: true });

  for (const theme of ['dark', 'light']) {
    THEME = theme;
    for (const sec of PLAN) if (theme === 'dark' || sec.light) await runSection(sec);
  }
  ok(allErrors.length === 0, 'no page errors anywhere — got: ' + allErrors.join(' | '));
  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
