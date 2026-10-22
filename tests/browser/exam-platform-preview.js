/* The Moodle-style exam platform, in a real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/exam-platform-preview.js
                                                   (npm run test:browser:exams)

   Drives the real index.html in headless Chromium, the outside world cut
   off and the clock on Jamaica time, through what a trainee and staff do:
     - the attempt page: breadcrumb, the navigation panel (a button per
       question; answered / flagged / on this page / current / "i"), the
       time left, three questions a page, Previous / Next page, a box that
       jumps to another page by keyboard;
     - every new question type answered through its own controls and marked
       by the exam's keys: "select one or more" (partial credit), matching
       (a share per row), short answer (capitals and spaces ignored),
       numerical ("1,000");
     - a reload part-way: signed in again, the attempt resumes on the page it
       was on, with every answer, the flag and the same deadline;
     - the Summary of attempt and the on-page "Submit all and finish?" (says
       how many are unanswered; Escape cancels);
     - the review under each release policy: after the exam closes (answers
       held back while it is open), released, never;
     - on a phone: the strip at the top (time left always in view, boxes
       opened with one tap), Previous / Next pinned to the bottom, nothing
       wider than the screen;
     - staff: the results with a column per question, the grading panel,
       and an exam built on the settings page with the type picker,
       reordered by arrow and by dragging, with paging and a closing time;
     - no page errors anywhere.
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
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
  kemar: { id: 'USR-STU-KJ', sid: 'STU-WF-KJ', name: 'Kemar Johnson', role: 'student', user: 'kemar.johnson', pass: 'Kemar-Pass-2026', card: 'student' },
  marlon: { id: 'USR-INS-MG', name: 'Marlon Grant', role: 'instructor', user: 'marlon.grant', pass: 'Grant-Weld-2026!', card: 'instructor' }
};
// Every type, three to a page: 11 items (10 questions + one information item).
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

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const allErrors = [];
  async function fresh(phone) {
    const o = phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, o));
    await ctx.route('**/*', r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    return ctx;
  }
  async function open(ctx, examOver, results) {
    const page = await ctx.newPage();
    page.on('pageerror', e => allErrors.push(String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(async ({ PEOPLE, PROG, TITLE, QUESTIONS, examOver, results }) => {
      const users = [];
      for (const k of Object.keys(PEOPLE)) {
        const p = PEOPLE[k];
        users.push({ id: p.id, name: p.name, role: p.role, username: p.user, email: p.user + '@example.com', programme: PROG, course: PROG,
          studentDataId: p.sid, password: await hashPassword(p.pass), status: 'active', updatedAt: new Date().toISOString() });
      }
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      CESTISStore.setItem('voctrain_students', JSON.stringify(Object.keys(PEOPLE).filter(k => PEOPLE[k].sid).map(k => ({
        id: PEOPLE[k].sid, name: PEOPLE[k].name, course: PROG, stage: 'training', score: '0%', progress: 40 }))));
      // Open from five minutes ago for an hour, Centre time.
      const st = CESTISCore.exams.centreParts(Date.now() - 5 * 60000);
      const exam = Object.assign({ id: 'EXAM-WS3', title: TITLE, course: PROG, date: st.date, time: st.time, duration: 60, status: 'active', passMark: 60,
        questions: 10, questionData: QUESTIONS, shuffleQuestions: false, answersRelease: 'after-close', questionsPerPage: 3, allowFlag: true,
        createdBy: 'admin', createdByRole: 'admin', instructions: 'Answer every question.' }, examOver || {});
      CESTISStore.setItem('voctrain_exams', JSON.stringify([exam]));
      CESTISStore.setItem('voctrain_examResults', JSON.stringify(results || []));
    }, { PEOPLE, PROG, TITLE, QUESTIONS, examOver, results });
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
    return page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 20000 }).then(() => true, () => false);
  }
  const go = (page, p) => page.evaluate(x => showPage(x), p).then(() => page.waitForTimeout(700));
  const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const cls = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.className : ''; }, sel);
  async function section(title, fn) {
    console.log(title);
    try { await fn(); } catch (e) { ok(false, title + ' — threw: ' + String(e && e.message).split('\n')[0]); }
  }

  let deadline = 0;
  await section('The attempt page: breadcrumb, navigation panel, time left, paging, flagging', async () => {
    const ctx = await fresh();
    const page = await open(ctx);
    ok(await signIn(page, 'tameka'), 'Tameka signs in');
    await go(page, 's-exams');
    await page.locator('#studentUpcomingExams .class-schedule-card', { hasText: TITLE }).locator('button:has-text("Take Exam")').click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt');
    const crumbs = await txt(page, '.exam-crumbs');
    ok(/My courses/.test(crumbs) && crumbs.indexOf(PROG) !== -1 && /Exams/.test(crumbs) && crumbs.indexOf(TITLE) !== -1, 'breadcrumb: My courses ▸ programme ▸ Exams ▸ exam (' + crumbs.replace(/\s+/g, ' ') + ')');
    ok((await page.locator('.enp-boxes button.qnbox').count()) === 11, 'a navigation box (a button) for each of the 11 items');
    ok((await txt(page, '#examNav-6')).trim() === 'i' && /info/.test(await cls(page, '#examNav-6')), 'the information item shows "i"');
    ok(/^\d:\d\d:\d\d$/.test((await txt(page, '#examTimerValue')).trim()), 'Time left reads like 0:54:59 (' + (await txt(page, '#examTimerValue')) + ')');
    ok((await page.locator('#studentExamTakingView .exam-q').count()) === 3 && /Page 1 of 4/.test(await txt(page, '.exam-page-nav')), 'three questions on page 1 of 4');
    ok(/thispage/.test(await cls(page, '#examNav-0')) && !/thispage/.test(await cls(page, '#examNav-3')), 'the boxes of this page have the thick border');
    ok((await txt(page, '#examQ-0 .exam-q-info')).indexOf('Not yet answered') !== -1 && /Marked out of 1\.00/.test(await txt(page, '#examQ-0 .exam-q-info')), 'grey box: Question 1, Not yet answered, Marked out of 1.00');
    ok(/Select one:/.test(await txt(page, '#examQ-0')) && /Select one or more:/.test(await txt(page, '#examQ-2')), '"Select one:" and "Select one or more:"');
    ok(/^a\.\s*Red/.test((await txt(page, '#examQ-0 .exam-choice')).trim()), 'options lettered a., b., c.');
    ok(await page.evaluate(() => document.querySelector('#examQState-0').getAttribute('aria-live') === 'polite' && !!document.querySelector('#examQ-0 fieldset legend')), 'the state is a polite live region; each question is a fieldset with a legend');
    await page.locator('#examQ-0 label.exam-choice', { hasText: 'Red' }).click();
    ok(/answered/.test(await cls(page, '#examNav-0')) && /Answer saved/.test(await txt(page, '#examQState-0')), 'answering: "Answer saved" and the box is shaded');
    await page.locator('#examQ-1 label.exam-choice', { hasText: 'True' }).click();
    await page.click('#examFlag-1');
    ok(await page.evaluate(() => document.getElementById('examFlag-1').getAttribute('aria-pressed') === 'true') && /flagged/.test(await cls(page, '#examNav-1')) && /Remove flag/.test(await txt(page, '#examFlag-1')),
      'Flag question: aria-pressed, the box gets its red corner, the button says Remove flag');
    // "Select one or more": a, b and e ticked (two right, one wrong).
    for (const t of ['Welding helmet', 'Leather gloves', 'Polyester overalls']) await page.locator('#examQ-2 label.exam-choice', { hasText: t }).click();
    ok(await page.evaluate(() => JSON.stringify(currentExamSession.answers[2])) === '[0,1,4]', 'ticked options are recorded by their own positions');
    // Keyboard: the box for question 4 (on page 2), Enter.
    await page.focus('#examNav-3');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    ok(/Page 2 of 4/.test(await txt(page, '.exam-page-nav')) && /current/.test(await cls(page, '#examNav-3')), 'Enter on a box opens its page with that question current');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'examQNo-3'), 'and focus moves to the question');
    // Matching: three right, one wrong.
    await page.selectOption('#examAns-3-0', 'Local exhaust ventilation');
    await page.selectOption('#examAns-3-1', 'Shade 10–13 filter lens');
    ok(/Incomplete answer/.test(await txt(page, '#examQState-3')) && /partial/.test(await cls(page, '#examNav-3')), 'two rows chosen: "Incomplete answer"');
    await page.selectOption('#examAns-3-2', 'A dust mask');
    await page.selectOption('#examAns-3-3', 'Leather spats and apron');
    ok(/Answer saved/.test(await txt(page, '#examQState-3')), 'every row chosen: Answer saved');
    await page.fill('#examAns-4', '  Flashback   ARRESTOR ');
    await page.fill('#examAns-5', '1,000');
    ok(/litres\/hour/.test(await txt(page, '#examQ-5')), 'the numerical answer shows its unit');
    await page.click('.exam-page-nav button:has-text("Next page")');
    await page.waitForTimeout(400);
    ok(/Page 3 of 4/.test(await txt(page, '.exam-page-nav')) && (await page.locator('#examQ-6.is-info').count()) === 1, 'Next page: page 3, starting with the information item');
    await page.click('.exam-page-nav button:has-text("Previous page")');
    await page.waitForTimeout(400);
    ok(/Page 2 of 4/.test(await txt(page, '.exam-page-nav')) && (await page.inputValue('#examAns-5')) === '1,000', 'Previous page: back to page 2, answers still there');
    await page.waitForTimeout(1200);              // the attempt is saved 0.8 s after an answer
    deadline = await page.evaluate(() => currentExamSession.deadline);

    console.log('A reload part-way resumes on the same page with every answer and the same clock');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1300);
    ok(await signIn(page, 'tameka'), 'signed in again after the reload');
    await go(page, 's-exams');
    const btn = page.locator('#studentUpcomingExams .class-schedule-card', { hasText: TITLE }).locator('button');
    ok(/Resume \(\d+:\d\d left\)/.test(await btn.innerText()), 'My Exams offers Resume with the time left');
    await btn.click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt');
    const back = await page.evaluate(() => ({ page: currentExamSession.page, deadline: currentExamSession.deadline, flagged: currentExamSession.flagged[1], a: currentExamSession.answers }));
    ok(back.page === 1 && /Page 2 of 4/.test(await txt(page, '.exam-page-nav')), 'it opens on page 2, where it was');
    ok(back.deadline === deadline, 'with the ORIGINAL deadline');
    ok(back.flagged === true && /flagged/.test(await cls(page, '#examNav-1')), 'question 2 is still flagged');
    ok((await page.inputValue('#examAns-3-2')) === 'A dust mask' && (await page.inputValue('#examAns-4')).indexOf('ARRESTOR') !== -1, 'the matching rows and the typed answers are back');
    ok(JSON.stringify(back.a[2]) === '[0,1,4]' && back.a[0] === 0 && back.a[1] === true, 'and the earlier pages\' answers');

    console.log('Summary of attempt, and "Submit all and finish?" on the page');
    await page.fill('#examAns-5', '1,000');
    await page.click('#examNav-8');                 // page 3: question 8
    await page.waitForTimeout(300);
    await page.fill('#examAns-8', '15');
    await page.click('.enp-finish');
    await page.waitForSelector('.exam-summary-table');
    const rows = await page.locator('.exam-summary-table tbody tr').count();
    ok(rows === 10, 'the summary lists the 10 questions (not the information item): ' + rows);
    const sum = await txt(page, '.exam-summary-table');
    ok(/Answer saved/.test(sum) && /Not yet answered/.test(sum) && /Flagged/.test(sum), 'with Answer saved, Not yet answered and the flag');
    ok(/Time left/.test(await txt(page, '.exam-summary-actions')) && /must be submitted by/.test(await txt(page, '.exam-summary-actions')), 'the time left and when it must be submitted by');
    await page.click('.exam-summary-actions button:has-text("Return to attempt")');
    await page.waitForTimeout(300);
    ok((await page.locator('.exam-summary-table').count()) === 0 && (await page.locator('#studentExamTakingView .exam-q').count()) > 0, 'Return to attempt goes back to the questions');
    await page.click('.enp-finish');
    await page.click('#examSubmitAllBtn');
    await page.waitForSelector('#examConfirmOverlay [role="dialog"]');
    const dlg = await txt(page, '#examConfirmOverlay');
    ok(/You have 3 unanswered questions/.test(dlg), 'the dialog says how many are unanswered (' + dlg.replace(/\s+/g, ' ').slice(0, 90) + ')');
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'examConfirmCancel'), 'focus starts on Cancel');
    await page.keyboard.press('Escape');
    ok((await page.locator('#examConfirmOverlay').count()) === 0 && (await page.evaluate(() => examResults.length)) === 0, 'Escape cancels; nothing submitted');
    await page.click('#examSubmitAllBtn');
    await page.click('#examConfirmGo');
    await page.waitForSelector('#studentExamResultView .exam-review');
    // (The app may re-key a trainee's record to its stable id at sign-in: the result is under currentStudent.id.)
    const r = await page.evaluate(() => examResults.find(x => x.studentId === currentStudent.id));
    const by = id => r.answers.find(a => a.questionId === id);
    ok(r && by('Q3').earnedPoints === 0.5 && by('Q3').isCorrect === false, '"one or more": two right of three, one wrong of two: 1/3·2 − 1/2 of 3 marks = 0.50 (' + (r && by('Q3').earnedPoints) + ')');
    ok(by('Q4').earnedPoints === 3, 'matching: three rows right of four = 3 of 4 marks');
    ok(by('Q5').earnedPoints === 1, 'short answer: "Flashback ARRESTOR" with extra spaces is right');
    ok(by('Q6').earnedPoints === 2 && by('Q8').earnedPoints === 1, 'numerical: "1,000" and "15" are right');
    ok(by('Q10').needsManualGrade && !by('Q10').graded && r.needsReview, 'the essay waits for staff, so the result is provisional');
    ok(r.totalQuestions === 10 && !!r.startedAt, 'ten questions; the start time is recorded');
    await ctx.close();
  });

  await section('The review page under each release policy', async () => {
    const ctx = await fresh();
    // Kemar's attempt, fully marked by staff, built by the page's own marking.
    const page = await open(ctx);
    const result = await page.evaluate(() => {
      const e = exams[0];
      const qs = CESTISCore.exams.publicQuestions(e.questionData);
      const ans = { Q1: 0, Q2: false, Q3: [0, 1], Q4: ['Local exhaust ventilation', 'Shade 10–13 filter lens', 'Leather spats and apron', 'Leather spats and apron'],
        Q5: 'flashback arrestor', Q6: '1000', Q7: 1, Q8: '25', Q9: 'upright', Q10: 'Close the valves, bleed the lines, back off the regulators.' };
      const m = CESTISCore.exams.mark(qs, qs.map(q => ans[q.id] === undefined ? null : ans[q.id]), e.questionData);
      m.gradedResults.forEach(a => { if (a.needsManualGrade) { a.graded = true; a.gradedBy = 'Marlon Grant'; a.awardedPoints = a.earnedPoints = a.type === 'fill' ? 1 : 4; a.isCorrect = a.type === 'fill'; a.feedback = a.type === 'short' ? 'Good: say why you bleed the lines.' : ''; } });
      const earned = m.gradedResults.reduce((s, a) => s + a.earnedPoints, 0);
      return { id: 'RES-KJ', examId: e.id, studentId: 'STU-WF-KJ', studentName: 'Kemar Johnson', answers: m.gradedResults, score: Math.round(earned / m.totalPoints * 100),
        correctCount: m.gradedResults.filter(a => a.isCorrect).length, totalQuestions: 10, totalPoints: m.totalPoints, earnedPoints: earned, passed: earned / m.totalPoints >= 0.6,
        needsReview: false, reviewComplete: true, pendingCount: 0, submittedAt: new Date(Date.now() - 60000).toISOString(), startedAt: new Date(Date.now() - 19 * 60000).toISOString(), timeTaken: 1080 };
    });
    for (const [policy, expectKey] of [['after-close', false], ['released', true], ['withheld', false]]) {
      const c2 = await fresh();
      const p2 = await open(c2, { answersRelease: policy }, [result]);
      await signIn(p2, 'kemar');
      await go(p2, 's-exams');
      await p2.locator('#studentPastExamResults button:has-text("Review")').first().click();
      await p2.waitForSelector('#studentExamResultView .exam-review');
      const v = await txt(p2, '#studentExamResultView');
      const head = await txt(p2, '.exam-review-summary');
      ok(['Started on', 'Completed on', 'Time taken', 'Marks', 'Grade', 'Result'].every(k => head.indexOf(k) !== -1) && /Passed/.test(head), policy + ': the summary table (started, completed, time taken, marks, grade, Passed)');
      ok(!(await p2.isVisible('#studentExamListView')), policy + ': the review is a page of its own');
      ok(/Partially correct/.test(v) && /Mark 2\.00 out of 3\.00/.test(v) && /Incorrect/.test(v) && /Correct/.test(v), policy + ': Correct / Incorrect / Partially correct with "Mark 2.00 out of 3.00"');
      ok(/r-partial/.test(await cls(p2, '#examR-2')) && /r-correct/.test(await cls(p2, '.enp-boxes .qnbox')) , policy + ': coloured boxes and blocks');
      ok(/Good: say why you bleed the lines/.test(v), policy + ': the marker\'s feedback is shown');
      if (expectKey) ok(/Correct answer: a\. Red/.test(v) || /Correct answer:/.test(v), 'released: the right answers are shown');
      else ok(!/Correct answer:/.test(v), policy + ': no right answers are shown');
      if (policy === 'after-close') ok(/once the exam has closed/.test(v), 'after-close: the trainee is told they come once it closes');
      if (policy === 'withheld') ok(/not released for this exam/.test(v), 'withheld: the trainee is told they are not released');
      if (policy === 'released') ok(/Correct answer: Welding fumes → Local exhaust ventilation/.test(v) && /Correct answer: 15 psi/.test(v), 'released: matching pairs and the numerical answer with its unit');
      await c2.close();
    }
    await ctx.close();
  });

  await section('On a phone: the strip at the top, Previous / Next at the bottom, nothing wider than the screen', async () => {
    const ctx = await fresh(true);
    const page = await open(ctx);
    await signIn(page, 'tameka');
    await go(page, 's-exams');
    await page.locator('#studentUpcomingExams .class-schedule-card', { hasText: TITLE }).locator('button:has-text("Take Exam")').click();
    await page.waitForSelector('#studentExamTakingView .exam-attempt');
    ok(!(await page.isVisible('#examNavBody')) && await page.isVisible('#examNavToggle'), 'the boxes start folded away behind "Questions"');
    await page.evaluate(() => { document.querySelector('.main-content').scrollTop = 900; });
    await page.waitForTimeout(300);
    const timer = await page.locator('#examTimerBox').boundingBox();
    ok(timer && timer.y >= 0 && timer.y < 200, 'the time left stays in view at the top while scrolling (y=' + (timer && Math.round(timer.y)) + ')');
    const bar = await page.locator('.exam-page-nav').boundingBox();
    ok(bar && bar.y + bar.height <= 844 + 1 && bar.y > 600, 'Previous / Next is pinned to the bottom (y=' + (bar && Math.round(bar.y)) + ')');
    await page.click('#examNavToggle');
    ok(await page.isVisible('#examNavBody') && (await page.getAttribute('#examNavToggle', 'aria-expanded')) === 'true', 'one tap opens the boxes');
    const boxes = await page.evaluate(() => { const b = document.querySelector('.enp-boxes'); return { sw: b.scrollWidth, cw: b.clientWidth }; });
    ok(boxes.sw > boxes.cw, 'the boxes scroll sideways inside the strip');
    await page.click('#examNav-4');
    await page.waitForTimeout(500);
    ok(/Page 2 of 4/.test(await txt(page, '.exam-page-nav')) && !(await page.isVisible('#examNavBody')), 'choosing a question opens its page and folds the strip');
    const wide = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, main: document.querySelector('.main-content').scrollWidth, w: innerWidth }));
    ok(wide.doc <= wide.w && wide.main <= wide.w, 'nothing is wider than the screen (' + JSON.stringify(wide) + ')');
    const tap = await page.evaluate(() => Array.from(document.querySelectorAll('#examQ-3 select, .exam-page-nav .btn, .qnbox')).every(e => e.getBoundingClientRect().height >= 44 || e.offsetParent === null));
    ok(tap, 'selects, page buttons and boxes are at least 44px tall');
    await ctx.close();
  });

  await section('Staff: results by question, the grading panel, and building an exam on the settings page', async () => {
    const ctx = await fresh();
    const page = await open(ctx);
    const res = await page.evaluate(() => {
      const e = exams[0], qs = CESTISCore.exams.publicQuestions(e.questionData);
      const m = CESTISCore.exams.mark(qs, qs.map(() => null), e.questionData);
      return { id: 'RES-TR', examId: e.id, studentId: 'STU-WF-TR', studentName: 'Tameka Richards', answers: m.gradedResults, score: 0, correctCount: 0, totalQuestions: 10,
        totalPoints: m.totalPoints, earnedPoints: 0, passed: false, needsReview: true, reviewComplete: false, pendingCount: 2, submittedAt: new Date().toISOString(), timeTaken: 600 };
    });
    const c2 = await fresh();
    const p = await open(c2, null, [res]);
    ok(await signIn(p, 'marlon'), 'the instructor signs in');
    await go(p, 'i-exams');
    await p.click('#page-i-exams .tab:has-text("Active Now")');
    await p.waitForTimeout(300);
    await p.locator('#iExamTableBody tr', { hasText: TITLE }).locator('button:has-text("Monitor")').click();
    await p.waitForSelector('.exam-results-table');
    ok((await p.locator('.exam-results-table th.rq-head').count()) === 10, 'a column per question (10)');
    ok((await p.locator('.exam-results-table td.rq-pending').count()) === 2 && (await p.locator('.exam-results-table td.rq-incorrect').count()) === 8, 'unanswered questions read wrong; the essay and fill-in wait for marking');
    await p.locator('.exam-results-table tr', { hasText: 'Tameka Richards' }).locator('button:has-text("Grade")').click();
    await p.waitForSelector('#gradingPanel');
    ok(/Marked automatically/i.test(await txt(p, '#gradingPanel')) && (await p.locator('#gradingPanel .gp-auto-row').count()) === 8, 'the grading panel lists the eight automatically marked questions');
    await p.click('#gradingPanel button:has-text("Cancel")');
    await p.click('#iExamResultsView button:has-text("Back to Exams")');

    // A new exam: settings, three types from the picker, reordered, saved.
    await go(p, 'i-exams');
    await p.click('#page-i-exams button:has-text("+ Create Exam")');
    ok(/Adding a new Exam/.test(await txt(p, '#createExamModalTitle')), 'the form is "Adding a new Exam"');
    ok(await p.evaluate(() => document.getElementById('examSetGeneral').open && !document.getElementById('examSetTiming').open), 'General open, the other sections folded');
    await p.click('#examSetExpandAll');
    ok(await p.evaluate(() => Array.from(document.querySelectorAll('.exam-set-section')).every(s => s.open)) && /Collapse all/.test(await txt(p, '#examSetExpandAll')), 'Expand all opens every section');
    ok(await p.evaluate(() => document.getElementById('examAttempts').disabled && document.getElementById('examGradeMethod').disabled), 'attempts and grading method are shown but fixed (one attempt)');
    await p.fill('#examTitle', 'Welding Safety — Unit 4 Quiz');
    const st = await p.evaluate(() => CESTISCore.exams.centreParts(Date.now() + 86400000));
    await p.fill('#examDate', st.date); await p.fill('#examTime', '09:00');
    await p.check('#examCloseEnabled');
    ok(await p.evaluate(() => !document.getElementById('examCloseDate').disabled && !!document.getElementById('examCloseDate').value), 'Close the exam: switched on, it suggests a date');
    await p.selectOption('#examPerPage', '2');
    await p.selectOption('#examShuffleOptions', 'true');
    await p.click('#examStep1 button:has-text("Next: Add Questions")');
    const addQ = async type => { await p.click('#examAddQuestionBtn'); await p.check('#examTypePicker input[name="examNewType"][value="' + type + '"]'); await p.click('#examTypeAddBtn'); await p.waitForTimeout(200); };
    await p.click('#examAddQuestionBtn');
    ok(await p.isVisible('#examTypePicker') && /Choose a question type to add/.test(await txt(p, '#examTypePicker')), '"+ Add question" opens the type picker');
    await p.check('#examTypePicker input[value="numerical"]');
    ok(/within the tolerance/.test(await txt(p, '#examTypeDesc')), 'each type is explained');
    await p.keyboard.press('Escape');
    ok(!(await p.isVisible('#examTypePicker')), 'Escape closes it');
    await addQ('multi');
    await p.fill('#qItem-0 .q-text-input', 'Which are PPE?'); await p.dispatchEvent('#qItem-0 .q-text-input', 'change');
    await p.locator('#qItem-0 .q-option-row input[type=checkbox]').nth(0).check();
    await p.locator('#qItem-0 .q-option-row input[type=checkbox]').nth(2).check();
    await addQ('numerical');
    await p.fill('#qItem-1 .q-text-input', 'psi?'); await p.dispatchEvent('#qItem-1 .q-text-input', 'change');
    await p.fill('#qItem-1 .q-num-grid input >> nth=0', '15'); await p.dispatchEvent('#qItem-1 .q-num-grid input >> nth=0', 'change');
    await addQ('match');
    await p.fill('#qItem-2 .q-text-input', 'Match them'); await p.dispatchEvent('#qItem-2 .q-text-input', 'change');
    for (let r = 0; r < 3; r++) {
      const row = p.locator('#qItem-2 .q-pair-row').nth(r).locator('input[type=text]');
      await row.nth(0).fill('Prompt ' + (r + 1)); await row.nth(0).dispatchEvent('change');
      await row.nth(1).fill('Answer ' + (r + 1)); await row.nth(1).dispatchEvent('change');
    }
    ok(/3 questions/.test(await txt(p, '#examQCount')), 'three questions listed');
    await p.click('#qMove-2-up');                   // matching moves above numerical
    ok(await p.evaluate(() => examBuilderQuestions.map(q => q.type).join()) === 'multi,match,numerical', 'the ↑ button moves a question up');
    // Fold the editors (the ✎ button) so both rows are on screen, then drag.
    while (await p.locator('.exam-qrow.open .q-edit').count()) { await p.locator('.exam-qrow.open .q-edit').first().click(); await p.waitForTimeout(100); }
    ok((await p.locator('.exam-qrow.open').count()) === 0, 'the ✎ button folds a question\'s editor away');
    await p.locator('#qItem-2 .exam-qrow-grip').dragTo(p.locator('#qItem-0'));
    ok(await p.evaluate(() => examBuilderQuestions.map(q => q.type).join()) === 'numerical,multi,match', 'dragging by the grip moves it (' + (await p.evaluate(() => examBuilderQuestions.map(q => q.type).join())) + ')');
    await p.click('#createExamPublishBtn');
    await p.waitForTimeout(500);
    const saved = await p.evaluate(() => exams.find(e => e.title === 'Welding Safety — Unit 4 Quiz'));
    ok(saved && saved.questionsPerPage === 2 && saved.shuffleOptions === true && saved.allowFlag === true && !!saved.closeDate, 'saved with 2 per page, shuffled options, flagging on and its closing time');
    ok(saved && saved.questionData.map(q => q.type).join() === 'numerical,multi,match' && JSON.stringify(saved.questionData[1].correctAnswer) === '[0,2]' && saved.questionData[0].correctAnswer === 15, 'in the order arranged, with each key');
    await c2.close();
    await ctx.close();
  });

  ok(allErrors.length === 0, 'no page errors anywhere — got: ' + allErrors.join(' | '));
  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
