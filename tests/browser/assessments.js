/* Prepared assessments (the owner's plan, approved 31 October 2026) in real
   browsers, against the REAL trainee gate:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/assessments.js
                                               (npm run test:browser:assessments)

   The site served from this worktree; the office PC writing through the
   in-memory shared files (tests/browser/fake-drive.js); the gate is
   trainee-gate/PASTE-GATE.gs itself (tests/browser/fake-gate.js); trainees
   on phones at home. Made-up names only.

   Sections (ASSESS_ONLY=<regex> runs some; ASSESS_SHOTS=<dir> saves the
   owner's screenshots, 1366x768 and 390x844, Light and Dark):
     prepare    The Assessments page: the Welding unit's four assessments
                prepared from its bank, To check; Preview; Check & edit;
                Mark Ready; Open for an intake; groups of 4 or 5 from the
                register. A unit with no bank: "No prepared assessments yet".
     export     Export units on the Qualification Plan page (a CSV).
     theory1    At home: Theory 1 open; the Administrator adds 15 minutes
                for her (who, how much, why); her clock moves; the invigilator
                page shows it; Sign and submit with her script signature; her
                own PDF.
     theory2    Theory 2: short answers that match are marked, the rest and
                the essays wait; the PDF says Provisional; the office files
                it; marked, the final paper replaces it (the earlier version
                kept).
     practical  Group practical: two members add photos at home (made
                smaller, sent in parts), one hands in for the group and signs;
                the other signs later ("Not yet signed" until then); the
                assessor records a result per member; filed with its photos.
     results    The Assessment Results page: filters, counts, View PDF,
                Download, one PDF of several to print, a group's photos and
                their ZIP.
   No page errors anywhere. Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');

const { TRAINEES, TRAINEE_PASS } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const ONLY = process.env.ASSESS_ONLY ? new RegExp(process.env.ASSESS_ONLY) : null;
const SHOTS = process.env.ASSESS_SHOTS || '';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 300); }
}
const W = 'Welding & Fabrication';
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));
// A Welding intake of 9 (made-up names): the gate kit's two Welding trainees and seven more.
const MORE = ['Damion Lewis', 'Nadine Bailey', 'Shanice Brown', 'Andre Campbell', 'Kimberly Thomas', 'Rohan Reid', 'Latoya Clarke']
  .map((name, i) => ({ id: 'USR-wx' + i, name, user: name.toLowerCase().replace(/[^a-z]+/g, '.'), prog: W, sid: Core.stableStudentId({ name, course: W }) }));
const T = {};
TRAINEES.concat(MORE).forEach(t => { T[t.user.split('.')[0]] = t; });

// The Centre on the office PC before it reloads: the Welding intake's dates,
// the instructor, and the seven extra trainees.
function seed({ MORE, PASSHASH }) {
  const now = new Date().toISOString(), today = localDateStr(), A = CESTISCore.attendance;
  const users = JSON.parse(CESTISStore.getItem('voctrain_users'));
  const studs = JSON.parse(CESTISStore.getItem('voctrain_students'));
  MORE.forEach(t => {
    users.push({ id: t.id, name: t.name, role: 'student', username: t.user, email: t.user + '@example.com', programme: t.prog, studentDataId: t.sid, password: PASSHASH, status: 'active', updatedAt: now });
    studs.push({ id: t.sid, name: t.name, course: t.prog, stage: 'training', email: t.user + '@example.com', gender: 'Male', progress: 40, updatedAt: now });
  });
  users.push({ id: 'USR-INS-IAN', name: 'Ian Barrett', role: 'instructor', username: 'ian.barrett', email: 'ian@example.com', programme: 'Welding & Fabrication', course: 'Welding & Fabrication',
    password: PASSHASH, status: 'active', updatedAt: now });
  users.push({ id: 'USR-AS-PH', name: 'Paulette Henry', role: 'adminstaff', username: 'phenry', email: 'phenry@example.com', password: PASSHASH, status: 'active', updatedAt: now });
  CESTISStore.setItem('voctrain_users', JSON.stringify(users));
  CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
  CESTISStore.setItem('voctrain_instructorData', JSON.stringify([{ id: 'USR-INS-IAN', name: 'Ian Barrett', course: 'Welding & Fabrication', email: 'ian@example.com', updatedAt: now }]));
  const sa = JSON.parse(JSON.stringify(skillAreas));
  sa.forEach(s => { s.startDate = A.addDays(today, -55); s.endDate = A.addDays(today, 240); s.updatedAt = now; });
  CESTISStore.setItem('voctrain_skillAreas', JSON.stringify(sa));
}

(async function main() {
  const srv = await kit.serve({ servePaste: true });
  const base = srv.base;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const K = kit.make({ browser, base, errors, gateUrl: GATE_URL });
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive, { seed: 'assessments' });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const PAGES = {};

  async function shot(page, name, opts) {
    if (!SHOTS) return;
    opts = opts || {};
    const was = page.viewportSize();
    await page.evaluate(() => document.querySelectorAll('#toastContainer > *').forEach(t => t.remove())).catch(() => {});
    for (const vp of opts.only === 'phone' ? [{ n: 'phone', w: 390, h: 844 }] : [{ n: 'desktop', w: 1366, h: 768 }, { n: 'phone', w: 390, h: 844 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(t => { try { cestisSetTheme(t); } catch (e) { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); } }, theme);
        await page.waitForTimeout(250);
        if (opts.focus) await page.evaluate(s => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, opts.focus).catch(() => {});
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOTS, name + '-' + vp.n + '-' + theme + '.png') }).catch(() => {});
      }
    }
    await page.evaluate(() => { try { cestisSetTheme('dark'); } catch (e) { document.documentElement.removeAttribute('data-theme'); } }).catch(() => {});
    await page.setViewportSize(was || { width: 1366, height: 768 });
    await page.waitForTimeout(200);
  }
  async function section(id, title, fn) {
    if (ONLY && !ONLY.test(id)) return;
    console.log('\n' + id + ': ' + title);
    const t0 = Date.now();
    try { await fn(); } catch (e) {
      ok(false, id + ' stopped: ' + String(e && e.message || e).split('\n')[0].slice(0, 240));
      const dir = SHOTS || path.join(os.tmpdir(), 'cestis-assess-fail');
      fs.mkdirSync(dir, { recursive: true });
      for (const [lbl, pg] of Object.entries(PAGES)) { try { await pg.screenshot({ path: path.join(dir, 'FAIL-' + id + '-' + lbl + '.png') }); } catch (e2) {} }
    }
    console.log('  (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  const go = (page, p) => page.evaluate(x => showPage(x), p).then(() => page.waitForTimeout(900));
  const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ') : ''; }, sel);
  const clickIn = (page, sel, text) => page.evaluate(([s, t]) => { const b = Array.from(document.querySelectorAll(s)).filter(x => x.offsetParent !== null && (!t || x.textContent.indexOf(t) !== -1))[0]; if (b) b.click(); return !!b; }, [sel, text || '']);

  /* ---------------------------------------------------------- the office */
  const office = await K.computer({ drive, gate });
  const PASSHASH = await (async () => { const p = await office.newPage(); await p.goto(base + '/index.html', { waitUntil: 'load' }); const h = await p.evaluate(pw => hashPassword(pw), TRAINEE_PASS); await p.close(); return h; })();
  const op = await K.adminSignedIn(office, { label: 'office', mutate: seed, mutateArg: { MORE, PASSHASH } });
  PAGES.office = op;

  await section('prepare', 'The Assessments page: prepare, check, Ready, open for an intake, groups', async () => {
    await go(op, 'assessments');
    await op.waitForFunction(() => window.CESTISAssessStaff && document.querySelector('#page-assessments .assess-prog'), null, { timeout: 20000 });
    const head = await txt(op, '#page-assessments .assess');
    ok(/Every prepared test starts as To check/.test(head) && /Unit names come from your Qualification Plan/.test(head), 'the page says every test starts as To check and an instructor checks it');
    ok(/WELDING LEVEL 2/.test(head) && /ELECTRICAL INSTALLATION/.test(head), 'every programme of the Qualification Plan');
    await op.selectOption('#page-assessments [data-ctl="prog"]', 'QUAL-WEL-L2');
    await op.waitForTimeout(400);
    const wl2 = await txt(op, '#page-assessments .assess');
    ok(/MEMFAB0042C/.test(wl2) && /46 units/.test(wl2), 'the Welding Level 2 units, by code and title');
    ok(/No prepared assessments yet/.test(wl2), 'a unit with no bank: "No prepared assessments yet"');
    await op.fill('#page-assessments [data-ctl="q"]', 'MEMFAB0042C');
    await op.waitForTimeout(700);
    ok(await clickIn(op, '#page-assessments [data-act="prepare"]'), 'Prepare this unit\'s four assessments');
    await op.waitForFunction(() => exams.filter(e => CESTISCore.assessments.isMaster(e)).length === 4, null, { timeout: 15000 });
    const prepared = await op.evaluate(() => exams.filter(e => CESTISCore.assessments.isMaster(e)).map(e => ({ k: e.assessment.kind, st: e.status, n: CESTISCore.exams.questionCount(e), d: e.duration, t: e.title, date: e.date })));
    ok(prepared.every(p => p.st === 'draft' && p.date === ''), 'all four are drafts with no date');
    const t1 = prepared.find(p => p.k === 'theory1'), t2 = prepared.find(p => p.k === 'theory2');
    ok(t1 && t1.n === 45 && t1.d === 150 && t2 && t2.n === 25 && t2.d === 215, 'Theory 1: 45 in 150 minutes; Theory 2: 25 in 215 minutes');
    ok(t1 && t1.t === 'Welding & Fabrication — MEMFAB0042C Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW) — Theory 1', 'named after the programme and the unit (' + (t1 && t1.t) + ')');
    await op.waitForTimeout(400);
    const chips = await op.evaluate(() => Array.from(document.querySelectorAll('#page-assessments .assess-kind .assess-chip')).map(c => c.textContent));
    ok(chips.length === 4 && chips.every(c => c === 'To check'), 'each shows To check (' + chips.join(', ') + ')');
    await shot(op, '01-assessments-page');
    // Preview shows the paper with its answers.
    await clickIn(op, '#page-assessments [data-act="preview"]');
    await op.waitForSelector('.assess-dlg', { timeout: 5000 });
    const pv = await txt(op, '.assess-dlg');
    ok(/right answer/.test(pv) && /Which filter shade/.test(pv), 'Preview: the questions and their right answers');
    await op.click('.assess-dlg [data-dlg="close"]');
    // Practical 1: Check & edit its brief.
    const p1 = await op.evaluate(() => exams.find(e => CESTISCore.assessments.isMaster(e) && e.assessment.kind === 'practical1').id);
    await op.click('#page-assessments [data-act="edit"][data-id="' + p1 + '"]');
    await op.waitForSelector('.assess-dlg [data-f="checklist"]', { timeout: 5000 });
    await op.fill('.assess-dlg [data-f="time"]', '3 hours 30 minutes');
    await op.click('.assess-dlg [data-dlg="save"]');
    await op.waitForFunction(() => !document.querySelector('.assess-dlg [data-f="checklist"]'), null, { timeout: 5000 }).catch(async () => console.log('    (dialog still open: ' + await txt(op, '.assess-dlg .assess-err') + ')'));
    ok(await op.evaluate(id => exams.find(e => e.id === id).practical.time === '3 hours 30 minutes', p1), 'Check & edit: a practical\'s brief corrected and saved');
    // Theory 1's Check & edit opens the test builder on it.
    const t1id = await op.evaluate(() => exams.find(e => CESTISCore.assessments.isMaster(e) && e.assessment.kind === 'theory1').id);
    await op.click('#page-assessments [data-act="edit"][data-id="' + t1id + '"]');
    await op.waitForTimeout(600);
    ok(await op.evaluate(() => document.getElementById('createExamModal').classList.contains('active') && examBuilderQuestions.length === 45), 'Check & edit opens the test builder with its 45 questions');
    await op.evaluate(() => { examBuilderQuestions[0].text = 'Which filter shade is suggested for a welding helmet when welding with a 3.2 mm electrode at about 100 to 125 amps?'; createExam(); });
    await op.waitForTimeout(500);
    const after = await op.evaluate(id => { const e = exams.find(x => x.id === id); return { st: e.status, date: e.date, course: e.course, q0: e.questionData[0].text }; }, t1id);
    ok(after.st === 'draft' && after.date === '' && after.course === 'Welding & Fabrication' && /100 to 125/.test(after.q0), 'saved from the builder: still a draft, no date, its programme kept, the correction in (' + JSON.stringify(after).slice(0, 120) + ')');
    await op.evaluate(() => { document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); showPage('assessments'); });
    await op.waitForTimeout(600);
    // Mark Ready, each in turn.
    for (const kind of ['theory1', 'theory2', 'practical1', 'practical2']) {
      const id = await op.evaluate(k => exams.find(e => CESTISCore.assessments.isMaster(e) && e.assessment.kind === k).id, kind);
      await op.click('#page-assessments [data-act="ready"][data-id="' + id + '"]');
      await op.waitForSelector('.assess-dlg [data-dlg="yes"]', { timeout: 5000 });
      await op.click('.assess-dlg [data-dlg="yes"]');
      await op.waitForTimeout(300);
    }
    const ready = await op.evaluate(() => exams.filter(e => CESTISCore.assessments.isMaster(e)).map(e => e.assessment.ready + ':' + e.assessment.readyByName));
    ok(ready.length === 4 && ready.every(r => r === 'true:Marcia Thompson'), 'Mark Ready: Ready, and who checked it (' + ready.join(', ') + ')');
    // Open each for the Welding intake.
    for (const kind of ['theory1', 'theory2', 'practical1', 'practical2']) {
      const id = await op.evaluate(k => exams.find(e => CESTISCore.assessments.isMaster(e) && e.assessment.kind === k).id, kind);
      await op.click('#page-assessments [data-act="open"][data-id="' + id + '"]');
      await op.waitForSelector('.assess-dlg [data-f="intake"]', { timeout: 5000 });
      const intakeText = await op.evaluate(() => document.querySelector('.assess-dlg [data-f="intake"]').selectedOptions[0].textContent);
      if (kind === 'theory1') ok(/Welding/.test(intakeText), 'the intake offered is the Welding training centre (' + intakeText + ')');
      // The theory tests open now, closing late tonight; the practicals open now for five days.
      await op.evaluate(k => {
        const p = CESTISCore.exams.centreParts(Date.now() - 10 * 60000, examCentreOffset());
        document.querySelector('.assess-dlg [data-f="date"]').value = p.date;
        document.querySelector('.assess-dlg [data-f="time"]').value = p.time;
        const c = CESTISCore.exams.centreParts(Date.now() + (k.indexOf('practical') === 0 ? 5 * 86400000 : 8 * 3600000), examCentreOffset());
        document.querySelector('.assess-dlg [data-f="closeDate"]').value = c.date;
        document.querySelector('.assess-dlg [data-f="closeTime"]').value = c.time;
      }, kind);
      if (kind === 'theory1') await shot(op, '02-open-for-an-intake', { only: 'desktop' });
      await op.click('.assess-dlg [data-dlg="open"]');
      await op.waitForTimeout(500);
      if (kind.indexOf('practical') === 0) {
        // The groups dialog follows: split the register into 4s and 5s.
        await op.waitForSelector('.assess-dlg [data-dlg="auto"]', { timeout: 5000 });
        await op.click('.assess-dlg [data-dlg="auto"]');
        await op.waitForTimeout(300);
        if (kind === 'practical1') await shot(op, '03-groups', { only: 'desktop' });
        await op.click('.assess-dlg [data-dlg="save"]');
        await op.waitForTimeout(400);
      }
    }
    const opened = await op.evaluate(() => exams.filter(e => CESTISCore.assessments.isAssessment(e) && !CESTISCore.assessments.isMaster(e)).map(e => ({ k: e.assessment.kind, st: e.status, c: e.course, from: !!e.assessment.from, intake: e.assessment.intake })));
    ok(opened.length === 4 && opened.every(o => (o.st === 'upcoming' || (o.st === 'active' && /theory/.test(o.k))) && o.from && /Welding/.test(o.c)), 'four copies opened for the Welding intake; the theory tests open now (' + JSON.stringify(opened).slice(0, 200) + ')');
    const groups = await op.evaluate(() => assessmentWork.filter(r => r.type === 'group' && !r.withdrawn).map(g => ({ e: g.examId, n: g.name, m: g.members.length })));
    const p1g = groups.filter(g => g.e === groups[0].e);
    ok(groups.length === 4 && p1g.length === 2 && p1g.every(g => g.m === 4 || g.m === 5) && p1g.reduce((a, g) => a + g.m, 0) === 9, 'groups of 4 or 5 for each practical: 9 trainees, Group A and B (' + JSON.stringify(groups) + ')');
    const chips2 = await op.evaluate(() => Array.from(document.querySelectorAll('#page-assessments .assess-kind .assess-chip')).map(c => c.textContent));
    ok(chips2.length === 4 && chips2.every(c => /^Opened for /.test(c)), '"Opened for <intake>" (' + chips2.join(' | ') + ')');
    // Nothing of a draft or a practical in a trainee's exam list; the Online Exams list holds the opened theory tests only.
    const listed = await op.evaluate(() => exams.filter(e => (e.status === 'upcoming' || e.status === 'active') && !examIsPracticalTask(e)).map(e => e.assessment ? e.assessment.kind : 'other'));
    ok(listed.filter(k => k === 'theory1' || k === 'theory2').length === 2 && listed.indexOf('practical1') === -1, 'the Online Exams list shows the two theory tests, never a practical');
    await shot(op, '01b-assessments-opened');
  });

  /* ------------------------------------------- the gate, and phones at home */
  const filesNamed = name => Object.values(drive.files).filter(f => f.name === name && !f.trashed);
  async function gateOn() {
    if (gate._on) return;
    await op.evaluate(() => saveAccountsLedger());
    await until(() => filesNamed('CESTIS_ACCOUNTS.json').length, 20000);
    gate.world.get({ op: 'health' });
    await op.evaluate(G => { systemSettings.traineeGate = { url: G, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
    await published();
    gate._on = true;
  }
  // The office's publishing turn has sent everything it has.
  async function published() {
    const t0 = await op.evaluate(() => { try { GATE_LIMITS.gapMs = 0; _gateRun.builtAt = 0; _gateRun.buildNow = true; } catch (e) {} return new Date().toISOString(); });
    // A publishing turn that began after this call, finished with nothing left to write.
    await op.evaluate(() => { try { return gatePublishSoon(); } catch (e) { return null; } });
    await op.waitForFunction(t0 => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && s.syncedAt >= t0 && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }, t0, { timeout: 180000, polling: 500 });
  }
  async function collect() {
    await op.evaluate(() => { _gateRun.collectAt = 0; GATE_LIMITS.collectMs = 1000; return gateCollectTick({ refetch: true }); });
    await op.waitForFunction(() => !_gateRun.collecting, null, { timeout: 30000 });
  }
  async function phone(label) {
    const ctx = await K.computer({ phone: true, drive: null, gate, theme: 'dark' });
    await ctx.addInitScript(() => { try { localStorage.setItem('cestis_sw_disabled', '1'); } catch (e) {} });
    const page = K.watch(await ctx.newPage(), label);
    await page.goto(base + LINK, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 20000 });
    PAGES[label] = page;
    return page;
  }
  async function traineeIn(page, who) {
    await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
    await page.waitForTimeout(150);
    await page.fill('#studentUser', who.user);
    await page.fill('#studentPass', TRAINEE_PASS);
    await page.press('#studentPass', 'Enter');
    await page.waitForFunction(() => document.readyState === 'complete' && !!(window.CESTISStore && CESTISStore.namespace), null, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  const theoryId = kind => op.evaluate(k => (exams.find(e => CESTISCore.assessments.isAssessment(e) && !CESTISCore.assessments.isMaster(e) && e.assessment.kind === k) || {}).id, kind);
  let tp = null;

  await section('theory1', 'At home: Theory 1, extra time added while she sits it, Sign and submit, her own PDF', async () => {
    await gateOn();
    tp = await phone('tameka');
    await traineeIn(tp, T.tameka);
    await go(tp, 's-assessments');
    await tp.waitForFunction(() => window.CESTISAssess && document.querySelector('#page-s-assessments .assess-kind'), null, { timeout: 20000 });
    const mine = await txt(tp, '#page-s-assessments .assess');
    ok(/My Assessments/.test(mine) && /MEMFAB0042C/.test(mine) && /Theory 1/.test(mine) && /Open now/.test(mine) && /45 questions/.test(mine), 'My Assessments: her unit, Theory 1 open now, 45 questions (' + mine.slice(0, 200) + ')');
    ok(/Group (A|B)/.test(mine), 'and her practical group');
    await shot(tp, '04-trainee-unit-page', { only: 'phone' });
    const t1 = await theoryId('theory1');
    await clickIn(tp, '#page-s-assessments [data-act="start"][data-id="' + t1 + '"]');
    await tp.waitForFunction(() => !!currentExamSession && document.getElementById('studentExamTakingView').style.display !== 'none', null, { timeout: 30000 });
    // She answers every question (the first four by tapping).
    await tp.evaluate(() => { const s = currentExamSession; s.questions.forEach((q, i) => { if (i >= 4) { s.answers[i] = (i * 3) % 4; s.answeredAt[i] = Date.now(); } }); autoSaveExamProgress(); });
    for (let i = 0; i < 4; i++) await tp.evaluate(i => { const lab = document.querySelector('#examQ-' + i + ' label[data-opt]'); if (lab) lab.click(); }, i);
    await tp.waitForTimeout(500);
    const before = await tp.evaluate(() => ({ left: currentExamSession.timeRemaining, extra: (document.getElementById('examTimerExtra') || {}).textContent || '' }));
    ok(before.left > 2 * 3600 && before.left <= 150 * 60 && !before.extra, 'her clock: about 2 h 30 min, no extra time yet (' + before.left + ' s)');
    // The office adds 15 minutes for her, from the invigilator page.
    await go(op, 'invigilator');
    await op.evaluate(id => { if (typeof invigPickExam === 'function') invigPickExam(id); }, t1);
    await op.waitForTimeout(800);
    await op.evaluate(sid => invigAddTime(sid), T.tameka.sid);
    await op.waitForSelector('.assess-dlg [data-f="why"]', { timeout: 10000 });
    await op.fill('.assess-dlg [data-f="why"]', 'Power cut at home');
    await shot(op, '09-add-time-dialog', { only: 'desktop' });
    await op.click('.assess-dlg [data-dlg="add"]');
    await op.waitForTimeout(500);
    const grant = await op.evaluate(id => (exams.find(e => e.id === id).extraTime || [])[0], t1);
    ok(grant && grant.minutes === 15 && grant.studentId === T.tameka.sid && grant.byName === 'Marcia Thompson' && grant.byRole === 'admin' && grant.reason === 'Power cut at home', 'who, how much and why are kept (' + JSON.stringify(grant) + ')');
    await published();
    // Her phone asks every minute: hurry it.
    await tp.evaluate(() => { currentExamSession._xtAt = 0; });
    await until(() => tp.evaluate(() => /15 min/.test((document.getElementById('examTimerExtra') || {}).textContent || '')), 40000, 1000);
    await tp.waitForTimeout(1500);
    const moved = await tp.evaluate(() => ({ left: currentExamSession.timeRemaining, extra: (document.getElementById('examTimerExtra') || {}).textContent || '' }));
    ok(moved && /Extra time: 15 min, added by the Administrator/.test(moved.extra) && moved.left > before.left + 13 * 60, 'at home her clock moves on by 15 minutes and says so (' + JSON.stringify(moved) + ')');
    await shot(tp, '05-theory1-in-progress-extra-time');
    // The invigilator page shows it.
    await op.evaluate(() => { try { invigCheckNow(true); } catch (e) {} });
    await op.waitForTimeout(1500);
    const board = await txt(op, '#invigBoard');
    ok(/\+15 min extra time/.test(board), 'the invigilator page shows her extra time (' + board.slice(0, 160) + ')');
    await shot(op, '10-invigilator-extra-time', { only: 'desktop' });
    // Sign and submit.
    await tp.evaluate(() => examShowSummary());
    await tp.waitForTimeout(400);
    await tp.click('#examSubmitAllBtn');
    await tp.waitForSelector('#examSignName', { timeout: 5000 });
    const sign = await tp.evaluate(() => ({ name: document.getElementById('examSignName').textContent, font: getComputedStyle(document.getElementById('examSignName')).fontFamily,
      disabled: document.getElementById('examConfirmGo').disabled, title: document.getElementById('examConfirmTitle').textContent }));
    ok(sign.title === 'Sign and submit' && sign.name === T.tameka.name && /CESTIS Signature/.test(sign.font) && sign.disabled, '"Sign and submit": her full name in a script, the button waits for the tick (' + JSON.stringify(sign) + ')');
    const fontOk = await tp.evaluate(() => document.fonts.load('40px "CESTIS Signature"').then(l => l.length > 0, () => false));
    ok(fontOk, 'the handwriting font is this site\'s own, loaded');
    await tp.check('#examSignConsent');
    await shot(tp, '06-sign-and-submit');
    await tp.click('#examConfirmGo');
    const res = await until(() => tp.evaluate(() => { const r = examResults.find(x => x && x.examId === (window._t1id || '')); return r || null; }).catch(() => null), 1, 1);
    await tp.evaluate(id => { window._t1id = id; }, t1);
    const result = await until(() => tp.evaluate(id => { const r = examResults.find(x => x && x.examId === id); return r ? { sig: r.signature, score: r.score, prov: !!r.needsReview } : null; }, t1), 40000, 800);
    ok(result && result.sig && result.sig.name === T.tameka.name && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(result.sig.id) && result.prov === false, 'submitted through the gate: marked, with her signature (' + JSON.stringify(result) + ')');
    void res;
    // Her own PDF, made on her phone.
    const dl = tp.waitForEvent('download', { timeout: 60000 });
    await tp.evaluate(id => assessMyRecord(id), t1);
    const d = await dl;
    const file = path.join(os.tmpdir(), 'assess-mine-' + Date.now() + '.pdf');
    await d.saveAs(file);
    const pdf = fs.readFileSync(file);
    ok(/^%PDF/.test(pdf.slice(0, 5).toString()) && d.suggestedFilename() === T.tameka.name + ' (' + T.tameka.sid + ') - MEMFAB0042C Theory 1.pdf', 'her record downloads at once: ' + d.suggestedFilename());
    ok(pdf.indexOf('GreatVibes') !== -1, 'with her signature in the script font embedded');
    if (SHOTS) fs.copyFileSync(file, path.join(SHOTS, 'trainee-own-theory1.pdf'));
  });

  // A phone camera's picture (made in a page: 2400 x 1800, a few hundred KB), labelled.
  async function picture(label, hue) {
    const b64 = await op.evaluate(([label, hue]) => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 2400, 1800); grd.addColorStop(0, 'hsl(' + hue + ',35%,30%)'); grd.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ',30%,55%)');
      g.fillStyle = grd; g.fillRect(0, 0, 2400, 1800);
      for (let i = 0; i < 400; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.15) + ')'; g.fillRect(Math.random() * 2400, Math.random() * 1800, 40 + Math.random() * 200, 4 + Math.random() * 20); }
      g.fillStyle = '#fff'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.fillText(label, 1200, 950);
      g.font = '60px sans-serif'; g.fillText('Sample photo — made-up', 1200, 1080);
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    }, [label, hue]);
    return { name: label.replace(/[^A-Za-z0-9]+/g, '-') + '.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
  }
  const pracId = kind => op.evaluate(k => (exams.find(e => CESTISCore.assessments.isAssessment(e) && !CESTISCore.assessments.isMaster(e) && e.assessment.kind === k) || {}).id, kind);
  async function openPractical(page, kind) {
    await go(page, 's-assessments');
    await page.waitForFunction(() => window.CESTISAssess && document.querySelector('#page-s-assessments .assess-kind'), null, { timeout: 20000 });
    const id = await pracId(kind);
    await clickIn(page, '#page-s-assessments [data-act="group"][data-id="' + id + '"]');
    await page.waitForSelector('.assess-dlg [data-g="body"] .assess-members', { timeout: 10000 });
    return id;
  }
  async function sendPhotos(page, labels, hue) {
    const files = [];
    for (let i = 0; i < labels.length; i++) files.push(await picture(labels[i], hue + i * 25));
    await page.setInputFiles('.assess-dlg input[data-gf="files"]', files);
    await page.waitForSelector('.assess-dlg [data-gact="send"]', { timeout: 20000 });
    const had = await page.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_assessmentWork') || '[]').filter(r => r.type === 'photo').length);
    await page.click('.assess-dlg [data-gact="send"]');
    // Every part in (her photo records written once each file is in), then her records sent.
    ok(await until(() => page.evaluate(n => JSON.parse(CESTISStore.getItem('voctrain_assessmentWork') || '[]').filter(r => r.type === 'photo' && (r.driveFiles || []).length).length >= n, had + labels.length), 120000, 1000),
      labels.length + ' photos sent in parts, each named in her records');
    await until(() => page.evaluate(() => CESTISGate.uploads(CESTISGate.session().acct).then(l => l.length === 0)), 90000, 1000);
    await until(() => page.evaluate(() => CESTISGate.deliverNow().then(() => CESTISGate.status()).then(s => s.waiting === 0)), 60000, 1000);
  }
  let np = null;
  await section('practical', 'Group practical at home: photos from two members, hand in once, every member signs', async () => {
    await gateOn();
    if (!tp) { tp = await phone('tameka'); await traineeIn(tp, T.tameka); }
    const p1 = await openPractical(tp, 'practical1');
    const g1 = await txt(tp, '.assess-dlg');
    ok(/Group B/.test(g1) && /Tameka Richards \(you\)/.test(g1) && /Nadine B\./.test(g1) && /Photos to take/.test(g1), 'her group: herself by name, the others as "Nadine B." (' + g1.slice(0, 160) + ')');
    ok(!/Nadine Bailey|STU-/.test(g1), 'never another member\'s full name or ID on her phone');
    const shotsBefore = await tp.evaluate(() => (CESTISGate.session() || {}).acct);
    void shotsBefore;
    await sendPhotos(tp, ['Station set up', 'Plates tacked square', 'Root pass', 'Finished weld top'], 20);
    const sentT = await tp.evaluate(id => CESTISAssess.Trainee.groupFor(id).photos.filter(p => p.mine).length, p1);
    ok(sentT === 4, 'four photos from Tameka, made smaller and sent in parts (' + sentT + ')');
    const sizes = Object.values(drive.files).filter(f => /files$/.test((drive.files[f.parents && f.parents[0]] || {}).name || '') && /\.jpg$/i.test(f.name)).map(f => f.size || (f.content ? f.content.length : 0));
    ok(sizes.length >= 4 && sizes.every(n => n > 20000 && n < 700 * 1024), 'each kept in her own folder, a few hundred KB at most (' + sizes.join(', ') + ')');
    // Nadine adds three from her phone.
    np = await phone('nadine');
    await traineeIn(np, T.nadine);
    await openPractical(np, 'practical1');
    await sendPhotos(np, ['Finished weld end', 'Fillet gauge check', 'Area cleaned'], 200);
    const nOut = await np.evaluate(() => CESTISGate.outbox().then(l => l.map(e => e.state + ':' + (e.reason || '') + ':' + (e.body && e.body.key || e.kind || ''))));
    const nWork = await np.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_assessmentWork') || '[]').map(r => r.type + ':' + r.studentId + ':' + (r.driveFiles || []).length));
    if (process.env.ASSESS_DEBUG) console.log('    nadine outbox', JSON.stringify(nOut), 'work', JSON.stringify(nWork));
    // The office takes them in, and sends each member the group as it stands.
    await collect();
    const work = await op.evaluate(id => assessmentWork.filter(r => r.examId === id && r.type === 'photo').length, p1);
    ok(work === 7, 'the office has the group\'s seven photos (' + work + ')');
    await published();
    await tp.evaluate(() => CESTISGate.pull().then(r => CESTISGate.applyPull(r)));
    await tp.waitForTimeout(800);
    await tp.evaluate(() => document.querySelectorAll('.assess-dlg-back').forEach(d => d.remove()));
    await openPractical(tp, 'practical1');
    const g2 = await tp.evaluate(id => { const g = CESTISAssess.Trainee.groupFor(id); return { n: g.photos.length, by: g.photos.map(p => p.by) }; }, p1);
    ok(g2.n === 7 && g2.by.filter(b => b === 'Nadine B.').length === 3, 'her phone shows the group\'s seven photos, three "by Nadine B." (' + JSON.stringify(g2) + ')');
    await shot(tp, '07-group-practical-many-photos', { focus: '.assess-dlg [data-g="photos"]' });
    // Tameka hands in for the group, and signs.
    await tp.click('.assess-dlg [data-gact="handin"]');
    await tp.waitForSelector('.assess-dlg [data-f="consent"]', { timeout: 5000 });
    await tp.check('.assess-dlg [data-f="consent"]');
    await tp.click('.assess-dlg [data-dlg="sign"]');
    await tp.waitForTimeout(800);
    await until(() => tp.evaluate(() => CESTISGate.deliverNow().then(() => CESTISGate.status()).then(s => s.waiting === 0)), 60000, 1000);
    const ht = await tp.evaluate(id => CESTISAssess.Trainee.groupFor(id), p1);
    ok(ht.handedInAt && ht.handedInBy === 'You' && ht.mySignature && ht.mySignature.name === T.tameka.name, 'handed in once for the group, signed by her (' + JSON.stringify({ at: ht.handedInAt, by: ht.handedInBy }) + ')');
    await collect();
    const st = await op.evaluate(id => { const g = CESTISCore.assessments.groupsOf(assessmentWork, id).find(x => x.name === 'Group B'); const s = CESTISCore.assessments.groupState(g, assessmentWork); return { handed: !!s.handedIn, signed: Object.keys(s.signed).length, unsigned: s.unsigned.length }; }, p1);
    ok(st.handed && st.signed === 1 && st.unsigned === 3, 'the office: handed in, one signature, three to come (' + JSON.stringify(st) + ')');
    await published();
    // Nadine opens it: she is asked to sign for her part.
    await np.evaluate(() => CESTISGate.pull().then(r => CESTISGate.applyPull(r)));
    await np.waitForTimeout(800);
    await np.evaluate(() => document.querySelectorAll('.assess-dlg-back').forEach(d => d.remove()));
    await go(np, 's-assessments');
    const row = await txt(np, '#page-s-assessments');
    ok(/Sign for your part/.test(row) && /Handed in/.test(row), 'Nadine\'s page: Handed in — "Sign for your part"');
    await clickIn(np, '#page-s-assessments [data-act="group"][data-id="' + p1 + '"]');
    await np.waitForSelector('.assess-dlg [data-f="consent"]', { timeout: 8000 });
    await np.check('.assess-dlg [data-f="consent"]');
    await np.click('.assess-dlg [data-dlg="sign"]');
    await np.waitForTimeout(600);
    await until(() => np.evaluate(() => CESTISGate.deliverNow().then(() => CESTISGate.status()).then(s => s.waiting === 0)), 60000, 1000);
    await collect();
    const st2 = await op.evaluate(id => { const g = CESTISCore.assessments.groupsOf(assessmentWork, id).find(x => x.name === 'Group B'); const s = CESTISCore.assessments.groupState(g, assessmentWork); return { by: s.handedIn && s.handedIn.by, signed: Object.keys(s.signed).length }; }, p1);
    ok(st2.signed === 2 && st2.by === T.tameka.sid, 'the first hand-in stands; Nadine\'s signature joins it (' + JSON.stringify(st2) + ')');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('Page errors:'); errors.slice(0, 20).forEach(e => console.log('  ' + e)); }
  ok(errors.length === 0, 'no page errors (' + errors.length + ')');
  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
