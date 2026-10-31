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
    await op.waitForTimeout(300);
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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('Page errors:'); errors.slice(0, 20).forEach(e => console.log('  ' + e)); }
  ok(errors.length === 0, 'no page errors (' + errors.length + ')');
  await browser.close();
  srv.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
