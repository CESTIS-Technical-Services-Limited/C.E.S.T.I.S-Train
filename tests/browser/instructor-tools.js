/* Group B — "help instructors teach, not type" — in real browsers:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/instructor-tools.js
                                              (npm run test:browser:instructor-tools)

   The Offline System on its real server (cestis-offline-server.js) in a
   scratch data folder, the outside world cut off, Jamaica time. A Welding
   intake of 20 trainees half way through its term (a dated register for six
   weeks, nine marked worksheets, Week 10's report due yesterday with 16 of
   20 handed in, a finished theory test with essays still to mark, a term of
   classes), five Plumbing trainees, a Cosmetology intake that has ended,
   two applicants, and the School Fee roll. Made-up names and figures only.

     office PC   Marcia Thompson, Administrator; Paulette Henry, Admin Staff
     laptop      Ian Barrett, Welding instructor
     phones      trainees

   Sections (GROUPB_ONLY=<regex> runs some):
     attention   Needs attention: the instructor's own list, most urgent
                 first, no money on it; the office's from the dashboard
                 alert, with what each owes; Admin Staff too; Message opens
                 the trainee's chat with a first line typed.
     message     My Students: Message on every row.
     marking     Exact fill-ins already marked; Save & next; Mark by question.
     notices     A Welding assignment reaches Welding trainees, not Plumbing.

   GROUPB_SHOTS=<dir> saves each screen at 1366x768 and 390x844, Light and
   Dark (<name>-desktop-dark.png ...). CESTIS_ROOT=<folder> runs it against
   another copy of the site (the "before" screenshots); a section whose
   feature is not there fails and the run goes on.
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = process.env.CESTIS_ROOT ? path.resolve(process.env.CESTIS_ROOT) : path.join(__dirname, '..', '..');
const OFF = path.join(ROOT, 'Offline System');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.GROUPB_SHOTS || '';
const ONLY = process.env.GROUPB_ONLY ? new RegExp(process.env.GROUPB_ONLY) : null;
let passed = 0, failed = 0;
const failures = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; failures.push(msg); console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 20000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 400); }
}

const W = 'Welding & Fabrication', P = 'Plumbing', C = 'Cosmetology';
const FIRST = ['Tameka', 'Kemar', 'Shanice', 'Andre', 'Kimberly', 'Dwayne', 'Shanté', 'Rohan', 'Latoya', 'Omar', 'Tashana', 'Jermaine', 'Alicia', 'Damion', 'Sasha', 'Ricardo', 'Nadine', 'Leon', 'Kerry-Ann', 'Marlon'];
const LAST = ['Richards', 'Johnson', 'Brown', 'Campbell', 'Williams', 'Thomas', 'O\'Neil', 'Reid', 'Clarke', 'Henry', 'Morgan', 'Gordon', 'Grant', 'Lewis', 'Walker', 'Francis', 'Bailey', 'Stewart', 'Palmer', 'Wright'];
const PEOPLE = {
  marcia: { id: 'USR-ADM-MT', name: 'Marcia Thompson', role: 'admin', user: 'mthompson', pass: 'Marcia-Admin-2026!', card: 'admin' },
  paulette: { id: 'USR-AS-PH', name: 'Paulette Henry', role: 'adminstaff', user: 'phenry', pass: 'Paulette-Staff-2026!', card: 'adminStaff' },
  ian: { id: 'USR-INS-IAN', name: 'Ian Barrett', role: 'instructor', user: 'ian.barrett', pass: 'Ian-Weld-2026!', card: 'instructor', course: W },
  paula: { id: 'USR-INS-PR', name: 'Paula Reid', role: 'instructor', user: 'paula.reid', pass: 'Paula-Plumb-2026!', card: 'instructor', course: P }
};
const TRAINEES = [];
FIRST.forEach((f, i) => TRAINEES.push({ key: 'w' + (i + 1), id: 'USR-W' + (i + 1), sid: 'STU-W' + String(i + 1).padStart(2, '0'), name: f + ' ' + LAST[i], course: W,
  user: 'w' + (i + 1), pass: 'Weld-Pass-' + (i + 1), phone: '876-555-01' + String(10 + i), stage: 'training' }));
['Kayla Simms', 'Brandon Lee', 'Monique Hall', 'Trevor Dixon', 'Ayesha Ford'].forEach((n, i) => TRAINEES.push({ key: 'p' + (i + 1), id: 'USR-P' + (i + 1), sid: 'STU-P' + (i + 1), name: n, course: P,
  user: 'p' + (i + 1), pass: 'Plumb-Pass-' + (i + 1), phone: '876-555-02' + String(10 + i), stage: 'training' }));
['Renee Mitchell', 'Sherika Allen', 'Tanya Edwards'].forEach((n, i) => TRAINEES.push({ key: 'c' + (i + 1), id: 'USR-C' + (i + 1), sid: 'STU-C' + (i + 1), name: n, course: C,
  user: 'c' + (i + 1), pass: 'Cosmo-Pass-' + (i + 1), phone: '876-555-03' + String(10 + i), stage: 'training' }));
['Jordan Blake', 'Stacy-Ann Lawrence'].forEach((n, i) => TRAINEES.push({ key: 'a' + (i + 1), id: 'USR-A' + (i + 1), sid: 'STU-A' + (i + 1), name: n, course: W,
  user: 'a' + (i + 1), pass: 'Apply-Pass-' + (i + 1), phone: '876-555-04' + String(10 + i), stage: 'testing' }));
TRAINEES.forEach(t => { t.role = 'student'; t.card = 'student'; PEOPLE[t.key] = t; });
// Who the Welding term makes struggle (by first name).
const STOPPED = 'Damion Lewis', LOW = 'Nadine Bailey', FAILED = 'Ricardo Francis';
const NOT_HANDED_IN = ['Leon Stewart', 'Kerry-Ann Palmer', 'Marlon Wright', 'Sasha Walker'];   // Week 10

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-groupb-'));
  const DATA = path.join(tmp, 'data');
  const PORT = 9100 + Math.floor(Math.random() * 800);
  const server = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: OFF, stdio: 'ignore',
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
  for (let i = 0; i < 80; i++) { await wait(100); try { if ((await fetch('http://127.0.0.1:' + PORT + '/_cestis/health')).ok) break; } catch (e) {} }
  const origin = 'http://127.0.0.1:' + PORT;
  const centre = k => { try { const d = JSON.parse(fs.readFileSync(path.join(DATA, 'CESTIS_LMS_Dashboard.json'), 'utf8')); return d.data[k] ? JSON.parse(d.data[k]) : null; } catch (e) { return null; } };
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

  async function computer(opts) {
    opts = opts || {};
    const o = opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica', acceptDownloads: true }, o));
    await ctx.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    return ctx;
  }
  function watch(page, label) {
    page.on('pageerror', e => errors.push(label + ': ' + String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    return page;
  }
  let HASHED = null;
  async function open(ctx, label, seed) {
    const page = watch(await ctx.newPage(), label);
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    if (seed) {
      if (!HASHED) {
        HASHED = await page.evaluate(async (PEOPLE) => {
          const out = [];
          for (const k of Object.keys(PEOPLE)) {
            const p = PEOPLE[k];
            out.push({ id: p.id, name: p.name, role: p.role, username: p.user, email: p.user + '@example.test', phone: p.phone, programme: p.course || '', course: p.course || '',
              studentDataId: p.sid, password: await hashPassword(p.pass), status: 'active', updatedAt: '2026-09-01T12:00:00.000Z' });
          }
          return out;
        }, PEOPLE);
      }
      await page.evaluate(({ users, TRAINEES, W, P, C }) => {
        CESTISStore.setItem('voctrain_users', JSON.stringify(users));
        CESTISStore.setItem('voctrain_students', JSON.stringify(TRAINEES.map(t => ({ id: t.sid, name: t.name, course: t.course, stage: t.stage, phone: t.phone,
          email: t.user + '@example.test', score: '0%', progress: 45, gpa: '0.0', updatedAt: '2026-09-01T12:00:00.000Z' }))));
        const sa = JSON.parse(JSON.stringify(skillAreas)), today = localDateStr(), A = CESTISCore.attendance;
        sa.forEach(s => {
          if (s.name === W || s.name === P) { s.startDate = A.addDays(today, -60); s.endDate = A.addDays(today, 150); }
          if (s.name === C) { s.startDate = A.addDays(today, -300); s.endDate = A.addDays(today, -90); }
          s.updatedAt = '2026-09-01T12:00:00.000Z';
        });
        CESTISStore.setItem('voctrain_skillAreas', JSON.stringify(sa));
      }, { users: HASHED, TRAINEES, W, P, C });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(1200);
    }
    return page;
  }
  async function signIn(page, who) {
    const p = PEOPLE[who];
    for (let i = 0; i < 4; i++) { const m = await page.$('.cestis-alert-overlay.active .cestis-alert-ok'); if (!m) break; await m.click(); await page.waitForTimeout(150); }
    const needSync = await page.evaluate(() => !loginSyncCompleted);
    if (needSync) {
      await page.click('#loginSyncBtn').catch(() => {});
      await page.waitForFunction(() => /Sync complete/.test((document.getElementById('loginSyncStatus') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    }
    if (!(await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), p.card))) await page.click('#' + p.card + 'Card .role-enter-btn');
    await page.fill('#' + p.card + 'User', p.user);
    await page.fill('#' + p.card + 'Pass', p.pass);
    await page.press('#' + p.card + 'Pass', 'Enter');
    const inn = await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 25000 }).then(() => true, () => false);
    await page.waitForTimeout(900);
    return inn;
  }
  const go = (page, p) => page.evaluate(x => showPage(x), p).then(() => page.waitForTimeout(700));
  const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const refresh = page => page.evaluate(() => CESTISPageCloud.loadNow()).then(() => page.waitForTimeout(600));
  const push = page => page.evaluate(() => CESTISPageCloud.saveNow()).then(() => page.waitForTimeout(400));
  async function shot(page, name, opts) {
    if (!SHOTS) return;
    opts = opts || {};
    const was = page.viewportSize();
    for (const vp of [{ n: 'desktop', w: 1366, h: 768 }, { n: 'phone', w: 390, h: 844 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(t => { try { cestisSetTheme(t); } catch (e) { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); } }, theme);
        await page.waitForTimeout(250);
        if (opts.focus) await page.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, opts.focus).catch(() => {});
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOTS, name + '-' + vp.n + '-' + theme + '.png') }).catch(() => {});
      }
    }
    await page.evaluate(() => { try { cestisSetTheme('dark'); } catch (e) { document.documentElement.removeAttribute('data-theme'); } });
    await page.setViewportSize(was || { width: 1366, height: 768 });
    await page.waitForTimeout(200);
  }
  async function section(id, title, fn) {
    if (ONLY && !ONLY.test(id)) return;
    console.log('\n' + id + ': ' + title);
    const t0 = Date.now();
    try { await fn(); } catch (e) {
      ok(false, id + ' stopped: ' + String(e && e.message || e).split('\n')[0].slice(0, 240));
      const dir = SHOTS || path.join(os.tmpdir(), 'cestis-groupb-fail');
      fs.mkdirSync(dir, { recursive: true });
      for (const [lbl, pg] of Object.entries(PAGES)) { try { await pg.screenshot({ path: path.join(dir, 'FAIL-' + id + '-' + lbl + '.png') }); } catch (e2) {} }
    }
    // Nothing a failed step left open blocks the next section.
    for (const pg of Object.values(PAGES)) { try { await pg.evaluate(() => { if (typeof closeGradingPanel === 'function') closeGradingPanel(); document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); }); } catch (e) {} }
    console.log('  (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }

  const PAGES = {};
  /* ---------------------------------------------------- the Centre's term */
  const office = await computer();
  const O = await open(office, 'office', true);
  PAGES.office = O;
  ok(await signIn(O, 'marcia'), 'the Administrator signs in');
  const seeded = await O.evaluate(({ W, P, STOPPED, LOW, FAILED, NOT_HANDED_IN }) => {
    const A = CESTISCore.attendance, today = localDateStr(), now = new Date().toISOString();
    const roll = students.filter(s => s.course === W && s.stage === 'training').sort((a, b) => a.name.localeCompare(b.name));
    const plumb = students.filter(s => s.course === P);
    // Six weeks of school days, oldest first, up to yesterday.
    const days = []; let d = today;
    while (days.length < 30) { d = A.addDays(d, -1); const wd = A.weekday(d); if (wd >= 1 && wd <= 5) days.unshift(d); }
    const reg = [];
    const put = (s, date, status) => A.mark(reg, { studentId: s.id, date, status, by: 'USR-INS-IAN', byName: 'Ian Barrett', studentName: s.name, course: s.course, at: date + 'T15:00:00.000Z' });
    roll.concat(plumb).forEach((s, i) => days.forEach((date, k) => {
      let st = (i * 7 + k * 3) % 23 === 0 ? 'absent' : (i * 5 + k) % 17 === 0 ? 'late' : 'present';
      if (s.name === STOPPED && k >= 23) st = 'absent';                 // has not come for the last 7 school days
      if (s.name === LOW) st = k % 2 === 0 ? 'absent' : (k % 3 === 0 ? 'late' : 'present');
      if (s.name === 'Brandon Lee' && k >= 25) st = 'absent';             // a Plumbing trainee too: not Ian's
      put(s, date, st);
    }));
    attendanceRegister = reg;
    saveCollection('voctrain_attendanceRegister', attendanceRegister);
    syncStudentAttendanceFromRegister();
    // Nine marked worksheets and Week 10's report (due yesterday, 16 of 20 in, none marked).
    for (let k = 1; k <= 9; k++) {
      const a = { id: 'ASN-WK' + k, title: 'Week ' + k + ' worksheet', type: 'worksheet', course: W, dueDate: A.addDays(today, -70 + k * 7), maxPoints: 20, weight: 10,
        instructions: 'Complete the worksheet.', attachments: [], requireSubmission: true, allowResubmission: false, createdBy: 'Ian Barrett', createdAt: now, grades: {}, gradeMeta: {} };
      roll.forEach((s, i) => {
        a.grades[s.id] = s.name === FAILED && k >= 8 ? 6 : 13 + ((i * 7 + k * 3) % 8);
        a.gradeMeta[s.id] = { gradedBy: 'Ian Barrett', gradedAt: A.addDays(today, -68 + k * 7) + 'T16:00:00.000Z' };
        assignmentSubmissions.push({ id: 'SUB-WK' + k + '-' + s.id, assignmentId: a.id, studentId: s.id, studentName: s.name, course: W,
          files: [{ name: 'worksheet-' + k + '.pdf', size: 120000, type: 'application/pdf' }], driveFiles: [], comment: '', submittedAt: A.addDays(today, -71 + k * 7) + 'T14:00:00.000Z', attempt: 1 });
      });
      instructorAssignments.push(a);
    }
    const a10 = { id: 'ASN-WK10', title: 'Week 10 — Cutting & gouging report', type: 'report', course: W, dueDate: A.addDays(today, -1), maxPoints: 100, weight: 10,
      instructions: 'Report on the plasma cutting practical.', attachments: [], requireSubmission: true, allowResubmission: false, createdBy: 'Ian Barrett', createdAt: now, grades: {} };
    instructorAssignments.push(a10);
    roll.filter(s => NOT_HANDED_IN.indexOf(s.name) === -1).forEach((s, i) => assignmentSubmissions.push({ id: 'SUB-WK10-' + s.id, assignmentId: a10.id, studentId: s.id, studentName: s.name, course: W,
      files: [{ name: 'report-' + (i + 1) + '.pdf', size: 250000, type: 'application/pdf' }], driveFiles: [], comment: 'Here is my report', submittedAt: A.addDays(today, -2 - (i % 3)) + 'T1' + (i % 9) + ':00:00.000Z', attempt: 1 }));
    // The Unit 5 test closed this week: 20 questions (fill-ins and two essays), sat by every trainee.
    const qs = [];
    for (let i = 1; i <= 10; i++) qs.push({ id: 'MQ' + i, type: 'mcq', points: 1, text: 'Which of the following is the correct procedure, part ' + i + '?', options: ['Open the oxygen valve fully', 'Purge each hose separately', 'Light the torch with a match', 'Check for leaks with soapy water'], correctAnswer: i % 4 });
    for (let i = 1; i <= 4; i++) qs.push({ id: 'TF' + i, type: 'tf', points: 1, text: 'Statement ' + i + ' about cylinder safety.', correctAnswer: i % 2 === 0 });
    qs.push({ id: 'SA1', type: 'shortanswer', points: 1, text: 'Name the device that stops a flame travelling back up the hose.', correctAnswer: ['flashback arrestor'] });
    qs.push({ id: 'NU1', type: 'numerical', points: 1, text: 'Above what pressure, in psi, is acetylene unstable?', correctAnswer: 15, tolerance: 0 });
    qs.push({ id: 'FI1', type: 'fill', points: 1, text: 'Cylinders are stored ______ and chained.', correctAnswer: 'upright' });
    qs.push({ id: 'FI2', type: 'fill', points: 1, text: 'The acetylene hose is coloured ______.', correctAnswer: 'red' });
    qs.push({ id: 'ES1', type: 'short', points: 5, text: 'Describe how to shut down an oxy-acetylene set.', correctAnswer: 'Close the cylinder valves, bleed the lines, release the regulators.' });
    qs.push({ id: 'ES2', type: 'short', points: 5, text: 'Explain the hazards of welding fumes.', correctAnswer: '' });
    const st = CESTISCore.exams.centreParts(Date.now() - 2 * 86400000);
    exams.push({ id: 'EXAM-U5', title: 'Unit 5 Theory Test', course: W, date: st.date, time: '09:00', duration: 60, status: 'completed', passMark: 60, questions: 20,
      questionData: qs, shuffleQuestions: false, answersRelease: 'after-close', questionsPerPage: 5, allowFlag: true, createdBy: 'USR-INS-IAN', createdByRole: 'instructor', instructions: 'Answer every question.' });
    roll.forEach((s, i) => {
      const fail = s.name === FAILED;
      const ans = qs.map((q, k) => q.type === 'mcq' ? ((fail ? (i + k) % 2 === 0 : (i + k) % 5 === 0) ? (q.correctAnswer + 1) % 4 : q.correctAnswer)
        : q.type === 'tf' ? (fail ? !q.correctAnswer : q.correctAnswer) : q.type === 'shortanswer' ? 'Flashback arrestor' : q.type === 'numerical' ? '15'
        : q.type === 'fill' ? (i % 5 === 0 ? 'standing up' : (k % 2 ? ' RED ' : 'Upright')) : 'A written answer of several sentences by ' + s.name.split(' ')[0] + '.');
      const m = CESTISCore.exams.mark(CESTISCore.exams.publicQuestions(qs), ans, qs);
      const score = Math.round(m.earnedPoints / m.totalPoints * 100);
      examResults.push({ id: 'RES-U5-' + s.id, examId: 'EXAM-U5', examTitle: 'Unit 5 Theory Test', studentId: s.id, studentName: s.name, answers: m.gradedResults, score,
        correctCount: m.correctCount, totalQuestions: 20, totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: score >= 60, needsReview: m.manualCount > 0,
        reviewComplete: m.manualCount === 0, pendingCount: m.manualCount, submittedAt: new Date(Date.now() - 2 * 86400000 + i * 60000).toISOString(), timeTaken: 2400 });
    });
    // Ricardo's earlier test, marked: 40%.
    exams.push({ id: 'EXAM-U4', title: 'Unit 4 Theory Test', course: W, date: A.addDays(today, -9), time: '09:00', duration: 45, status: 'completed', passMark: 60, questions: 10,
      questionData: qs.slice(0, 10), createdBy: 'USR-INS-IAN', createdByRole: 'instructor', answersRelease: 'after-close' });
    roll.forEach((s, i) => examResults.push({ id: 'RES-U4-' + s.id, examId: 'EXAM-U4', examTitle: 'Unit 4 Theory Test', studentId: s.id, studentName: s.name, answers: [],
      score: s.name === FAILED ? 40 : 70 + (i % 25), totalPoints: 10, earnedPoints: s.name === FAILED ? 4 : 7, passed: s.name !== FAILED, needsReview: false, reviewComplete: true,
      submittedAt: A.addDays(today, -9) + 'T15:0' + (i % 10) + ':00.000Z', markedBy: 'auto' }));
    // A term of classes: 30 held, 3 to come.
    for (let k = 30; k >= 1; k--) classSessions.push({ id: 'CS-PAST-' + k, name: 'Welding Theory — Session ' + (31 - k), course: W, date: A.addDays(today, -k * 2), time: '09:00', duration: 90,
      type: 'virtual', location: 'Virtual-01', roomCode: 'ROOM' + k + 'PAST', status: 'completed', createdBy: 'Ian Barrett', createdAt: now });
    for (let k = 1; k <= 3; k++) classSessions.push({ id: 'CS-NEXT-' + k, name: 'Welding Practical — Session ' + (30 + k), course: W, date: A.addDays(today, k * 2), time: '09:00', duration: 120,
      type: 'practical', location: 'Workshop Bay 3', roomCode: 'ROOM' + k + 'NEXT', status: 'scheduled', createdBy: 'Ian Barrett', createdAt: now });
    saveState();
    // The School Fee roll: Welding $85,000, paid in part.
    const fee = students.filter(s => s.stage !== 'testing').map((s, i) => ({ id: 'SF-' + (i + 1), name: s.name, skillArea: s.course, tuitionFee: s.course === W ? 85000 : s.course === P ? 72000 : 65000,
      email: s.email, contact: s.phone, updatedAt: '2026-09-01T12:00:00.000Z' }));
    const pay = [];
    fee.forEach((f, i) => { if (i % 4 !== 1) pay.push({ id: 'PAY-' + (i + 1), studentId: f.id, amount: i % 3 === 0 ? f.tuitionFee : 25000 + (i % 5) * 5000, date: A.addDays(today, -40), receiptNumber: 'R-0' + (400 + i) }); });
    CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify(fee));
    CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify(pay));
    return { roll: roll.map(s => ({ id: s.id, name: s.name })), days: days.length, results: examResults.length };
  }, { W, P, STOPPED, LOW, FAILED, NOT_HANDED_IN });
  await push(O);
  ok(seeded.roll.length === 20, 'the Welding intake is on the roll (20)');
  ok(!!(await until(() => { const r = centre('voctrain_examResults'); return r && r.length >= 40; }, 20000)), 'the term is on the Centre\'s server');
  ok(!!(await until(() => { const r = centre('voctrain_attendanceRegister'); return r && r.length >= 600; }, 20000)), 'and the register (' + ((centre('voctrain_attendanceRegister') || []).length) + ' marks)');
  const idOf = name => (seeded.roll.find(r => r.name === name) || {}).id;

  const laptop = await computer();
  const I = await open(laptop, 'instructor', true);
  PAGES.laptop = I;
  ok(await signIn(I, 'ian'), 'Ian Barrett signs in on his laptop');
  await refresh(I);
  ok(await until(() => I.evaluate(() => examResults.length >= 40 && attendanceRegister.length >= 600)), 'his laptop has the term');
  await I.evaluate(() => { buildInstructorPages(); showPage('i-dashboard'); });
  await I.waitForTimeout(500);

  /* --------------------------------------------------------- attention */
  await section('attention', 'Needs attention — the instructor\'s list, the office\'s list, Message', async () => {
    await shot(I, 'b1-instructor-dashboard-alert', { focus: '#iDashLowAttendanceAlert' });
    const alert = await I.$('#iDashLowAttendanceAlert');
    ok(!!alert, 'the instructor\'s dashboard alert is a link');
    if (alert) { await alert.click(); await I.waitForTimeout(700); }
    else await go(I, 'i-needs-attention');
    const rows = await I.evaluate(() => Array.from(document.querySelectorAll('#attnBody-i-needs-attention tr[data-attn-id]')).map(tr => tr.innerText.replace(/\s+/g, ' ')));
    ok(rows.length >= 4, 'his list holds the trainees who need him (' + rows.length + ')');
    ok(/Damion Lewis/.test(rows[0] || ''), 'Damion, absent 7 classes in a row, is first (' + (rows[0] || '').slice(0, 90) + ')');
    ok(rows.some(r => /Nadine Bailey/.test(r)) && rows.some(r => /Ricardo Francis[^]*40%/.test(r)) && rows.some(r => /Sasha Walker[^]*Week 10/.test(r)), 'Nadine (low attendance), Ricardo (40% on Unit 4) and Sasha (Week 10 not handed in) are on it');
    ok(!rows.some(r => /Brandon Lee|Renee Mitchell|Jordan Blake/.test(r)), 'never a Plumbing trainee, an ended intake or an applicant');
    const head = await txt(I, '#attnHead-i-needs-attention');
    ok(!/owes/i.test(head) && !rows.some(r => /\$\d/.test(r)), 'no "Owes" and no money anywhere on the instructor\'s list');
    ok(/876-555-0123/.test(rows[0] || ''), 'Damion\'s phone is on his row');
    await shot(I, 'b1-instructor-needs-attention', { focus: '#page-i-needs-attention' });
    // Message from the list.
    await I.click('#attnBody-i-needs-attention tr[data-attn-id] button:has-text("Message")');
    const dm = await until(() => I.evaluate(() => { const room = (lmsChatRooms || []).find(r => r.type === 'dm' && r.members && r.members.indexOf('USR-W14') !== -1); const inp = document.getElementById('instructorChatInput'); return room && inp ? inp.value : null; }), 10000);
    ok(!!dm && /^Hi Damion, we have missed you in class\./.test(dm), 'Message opens his direct chat with a first line typed, not sent (' + String(dm).slice(0, 60) + ')');
    await shot(I, 'b1-instructor-message-from-list');

    // The office: the dashboard's alert opens the whole Centre's list, with what each owes.
    await go(O, 'dashboard');
    await O.evaluate(() => buildAdminPages()); await O.waitForTimeout(400);
    await shot(O, 'b1-admin-dashboard-alert', { focus: '#dashLowAttendanceAlert' });
    const oa = await O.$('#dashLowAttendanceAlert');
    ok(!!oa, 'the administrator\'s "below 70% attendance" alert is a link');
    if (oa) { const n = Number(((await oa.innerText()).match(/(\d+) student/) || [])[1]); await oa.click(); await O.waitForTimeout(700);
      const lowRows = await O.evaluate(() => Array.from(document.querySelectorAll('#attnBody-needs-attention tr[data-attn-id] td:nth-child(4)')).filter(td => parseFloat(td.innerText) < 70).length);
      ok(n === lowRows && n >= 1, 'it opens the list, and its number is the list\'s count below 70% (' + n + ' / ' + lowRows + ')'); }
    const orows = await O.evaluate(() => Array.from(document.querySelectorAll('#attnBody-needs-attention tr[data-attn-id]')).map(tr => tr.innerText.replace(/\s+/g, ' ')));
    ok(orows.some(r => /Brandon Lee/.test(r)) && orows.some(r => /Damion Lewis/.test(r)), 'the office\'s list covers every programme');
    ok(/owes/i.test(await txt(O, '#attnHead-needs-attention')) && orows.some(r => /\$\d{2},\d{3}\.\d{2}/.test(r)), 'and shows what each owes (' + (orows[0] || '').slice(-80) + ' | ' + (await O.evaluate(() => JSON.stringify(attentionRows().slice(0, 4).map(r => r.owed)) + ' fee:' + String(CESTISStore.getItem('cestiSchoolFeeStudents') || '').length)) + ')');
    ok(!orows.some(r => /Renee Mitchell|Jordan Blake|Stacy-Ann/.test(r)), 'never the ended Cosmetology intake or an applicant');
    await shot(O, 'b1-admin-needs-attention', { focus: '#page-needs-attention' });
  });

  /* ----------------------------------------------------------- message */
  await section('message', 'My Students: Message on every row', async () => {
    await go(I, 'i-students');
    await I.evaluate(() => filterInstructorStudents());
    const n = await I.evaluate(() => document.querySelectorAll('#iStudentTableBody tr button').length);
    ok(n >= 20, 'every trainee\'s row has Message (' + n + ')');
    await shot(I, 'b6-my-students-message', { focus: '#page-i-students .card' });
    const t0 = Date.now();
    await I.click('#iStudentTableBody tr:has-text("Nadine Bailey") button:has-text("Message")');
    const opened = await until(() => I.evaluate(() => !!(lmsChatRooms || []).find(r => r.type === 'dm' && r.members && r.members.indexOf('USR-W17') !== -1) && document.getElementById('page-i-lms-chat').classList.contains('active')), 10000);
    ok(!!opened, 'one click opens her direct chat (' + (Date.now() - t0) + ' ms)');
    await I.fill('#instructorChatInput', 'Hi Nadine — can we talk after class on Thursday?');
    await I.press('#instructorChatInput', 'Enter');
    ok(!!(await until(() => I.evaluate(() => Object.keys(lmsChatMessages).some(k => k.indexOf('dm-') === 0 && (lmsChatMessages[k] || []).some(m => /after class on Thursday/.test(m.text || '')))), 8000)), 'and the message is sent from there');
  });

  /* ----------------------------------------------------------- marking */
  await section('marking', 'Exact fill-ins already marked; Save & next; Mark by question', async () => {
    const u5 = await I.evaluate(() => { const rs = examResults.filter(r => r.examId === 'EXAM-U5'); const fills = []; rs.forEach(r => r.answers.forEach(a => { if (a.type === 'fill') fills.push(a); }));
      return { fills: fills.length, auto: fills.filter(a => a.graded && a.gradedBy === 'auto').length, waiting: fills.filter(a => !a.graded).length }; });
    ok(u5.auto > 0 && u5.auto + u5.waiting === u5.fills, 'exact fill-ins are already marked (' + u5.auto + ' of ' + u5.fills + '); the rest wait (' + u5.waiting + ')');
    await go(I, 'i-exams');
    await I.click('#page-i-exams .tab:has-text("Completed")').catch(() => {});
    await I.waitForTimeout(300);
    await I.locator('#iExamTableBody tr', { hasText: 'Unit 5 Theory Test' }).locator('button:has-text("Results")').click();
    await I.waitForSelector('.exam-results-table');
    await shot(I, 'b4-exam-results-mark-by-question');
    // Save & next: one trainee, then straight to the next.
    await I.locator('.exam-results-table button:has-text("Grade")').first().click();
    await I.waitForSelector('#gradingPanel');
    const first = await I.evaluate(() => gradingResultId);
    await shot(I, 'b4-grading-panel-save-next');
    for (const c of await I.$$('#gradingPanel .grade-question-card.needs-grade .grade-points-input')) { await c.fill('3'); await c.dispatchEvent('change'); }
    ok(!!(await I.$('#gpSaveNext')), 'the panel offers "Save & next"');
    await I.click('#gpSaveNext');
    await I.waitForTimeout(500);
    const second = await I.evaluate(() => gradingResultId);
    ok(!!second && second !== first && !!(await I.$('#gradingPanel')), 'Save & next opens the next trainee at once (' + first + ' → ' + second + ')');
    ok(await I.evaluate(id => CESTISCore.exams.isFinal(examResults.find(r => r.id === id)), first), 'and the first is marked and final');
    await I.evaluate(() => closeGradingPanel());
    // Mark by question: Q19 (ES1) for everyone in one go.
    await I.click('#examMarkByQuestionBtn');
    await I.waitForSelector('#qmSaveAll');
    const firstQ = await I.evaluate(() => questionMarking.questionId);
    ok(firstQ === 'FI1', 'it opens on the first question waiting: the fill-in whose answers were not the expected word (' + firstQ + ')');
    await I.selectOption('#qmQuestion', 'ES1');
    await I.waitForTimeout(400);
    const n = await I.evaluate(() => questionMarking.entries.length);
    ok(n >= 17, 'Mark by question shows every trainee\'s answer to one question (' + n + ')');
    await shot(I, 'b4-mark-by-question-panel');
    for (let k = 0; k < n; k++) await I.click('#qmRow-' + k + ' .grade-quick-btns button.half');
    const q1 = await I.evaluate(() => questionMarking.questionId);
    await I.click('#qmSaveAll');
    await I.waitForTimeout(600);
    const left = await I.evaluate(q => examResults.filter(r => r.examId === 'EXAM-U5').filter(r => r.answers.some(a => a.questionId === q && !a.graded)).length, q1);
    ok(left === 0, 'one Save marks that question for every trainee (' + left + ' left)');
    ok(await I.evaluate(() => !!questionMarking && questionMarking.questionId !== 'ES1' && !!document.getElementById('qmSaveAll')), 'and the next question waiting opens');
    await I.evaluate(() => closeGradingPanel());
  });

  /* ----------------------------------------------------------- notices */
  await section('notices', 'A Welding assignment reaches Welding trainees, not Plumbing', async () => {
    await go(I, 'i-gradebook');
    await I.evaluate(() => openInstructorCreateAssignment());
    await I.fill('#assignTitle', 'Week 11 — Joint preparation worksheet');
    await I.fill('#assignDueDate', await I.evaluate(() => CESTISCore.attendance.addDays(localDateStr(), 7)));
    await I.click('#createAssignmentModal button:has-text("Create")');
    await I.waitForTimeout(800);
    await push(I);
    const note = await until(() => (centre('voctrain_notifications') || []).find(n => /Week 11 — Joint preparation/.test(n.text || '')), 15000);
    ok(!!note && note.forCourse === W, 'the notice is addressed to the Welding programme');
    const phone = await computer({ phone: true });
    const pl = await open(phone, 'plumbing trainee', true);
    ok(await signIn(pl, 'p2'), 'Brandon (Plumbing) signs in on his phone');
    await refresh(pl);
    const bell = await pl.evaluate(() => getFilteredNotifications().map(n => n.text));
    ok(!bell.some(t => /Week 11 — Joint preparation/.test(t)), 'Brandon\'s bell does not have the Welding assignment');
    await phone.close();
    const phone2 = await computer({ phone: true });
    const wl = await open(phone2, 'welding trainee', true);
    ok(await signIn(wl, 'w1'), 'Tameka (Welding) signs in on her phone');
    await refresh(wl);
    ok(!!(await until(() => wl.evaluate(() => getFilteredNotifications().some(n => /Week 11 — Joint preparation/.test(n.text))), 15000, 1500)), 'Tameka\'s bell has it');
    await phone2.close();
  });

  ok(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
  await browser.close();
  server.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
