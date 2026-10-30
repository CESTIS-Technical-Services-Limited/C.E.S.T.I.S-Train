/* Real figures for the board and the regulator, in a real browser (group E).

     NODE_PATH=/opt/node-tools/node_modules node tests/browser/board-figures.js [--shots DIR]

   Seeds the audit's Centre (tests/fixtures/board-centre.js — every name made
   up) into the dashboard's own store, then, signed in as each person who
   uses these screens:

     the CMC board   the School Fees card on its dashboard, the Financial
                     Overview (fees owed, the collected/owed doughnut, fees by
                     programme), the School Fees details and the Oversight
                     Portal's card — every money figure against the hand
                     count; then, after visiting every board page and saving,
                     the fee books are byte-for-byte what they were: the
                     board reads them and never writes them;
     the administrator  the School Fees card on the dashboard, "Earlier years
                     still owing" under School Fee's Total Outstanding, and
                     Reports: the intake and period filters, the heading,
                     and the Programme return downloaded as CSV (each cell
                     against the hand count) and as PDF (its text read back
                     with the Centre's own pdf.js).

   On a phone-sized screen the board's dashboard and Reports must not scroll
   sideways. With --shots DIR, desktop 1366×768 and phone 390×844 pictures in
   the light and dark themes are written to DIR.

   Every request to another host is aborted. Kept out of `npm test` because
   it needs a browser. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright-core').chromium; }
catch (e) { chromium = require('playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const args = process.argv.slice(2);
const shotAt = args.indexOf('--shots');
const SHOTS = shotAt >= 0 ? args[shotAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const D = require(path.join(ROOT, 'tests/fixtures/board-centre.js'));
const Core = require(path.join(ROOT, 'cestis-core.js'));
const T = D.T, money = Core.centreFigures.moneyText;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } return !!c; };

const PEOPLE = {
  admin: { id: 'USR-ADM', name: 'Marcia Thompson', role: 'admin', user: 'mthompson', pass: 'Centre-Admin-2026!', card: 'admin' },
  cmc: { id: 'USR-CMC', name: 'Winston Shaw', role: 'cmc', user: 'wshaw', pass: 'Board-Chair-2026!', card: 'cmc', cmcChair: true }
};

async function seedCentre(page) {
  await page.evaluate(async ({ D, PEOPLE }) => {
    const users = [];
    for (const k of Object.keys(PEOPLE)) {
      const p = PEOPLE[k];
      users.push({ id: p.id, name: p.name, role: p.role, username: p.user, email: p.user + '@example.com', password: await hashPassword(p.pass), status: 'active',
        cmcChair: p.cmcChair, updatedAt: '2026-10-01T12:00:00.000Z' });
    }
    CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    const sk = CESTISCore.freshSkillAreas(), byId = {};
    Object.keys(D.CENTRES).forEach(k => { byId[D.CENTRES[k].id] = D.CENTRES[k]; });
    sk.forEach(a => { const c = byId[a.id]; if (c && c.start) { a.startDate = c.start; a.endDate = c.end; } });
    CESTISStore.setItem('voctrain_skillAreas', JSON.stringify(sk));
    CESTISStore.setItem('voctrain_students', JSON.stringify(D.students));
    const reg = [], idx = {};
    D.att.forEach(r => CESTISCore.attendance.mark(reg, { studentId: r.studentId, date: r.date, status: r.status, by: 'USR-INS', byName: 'Instructor', studentName: r.studentName, course: r.course, source: 'register', at: r.date + 'T16:00:00.000Z' }, idx));
    CESTISStore.setItem('voctrain_attendanceRegister', JSON.stringify(reg));
    CESTISStore.setItem('voctrain_exams', JSON.stringify(D.exams));
    CESTISStore.setItem('voctrain_examResults', JSON.stringify(D.results));
    CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify(D.feeStudents));
    CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify(D.payments));
    CESTISStore.setItem('cestiFeeStructure', JSON.stringify(D.feeStructure));
    CESTISStore.setItem('voctrain_instructorData', JSON.stringify([
      { id: 'INS-1', name: 'Andre Campbell', course: 'Welding & Fabrication' }, { id: 'INS-2', name: 'Dwayne Morgan', course: 'Electrical Installation' },
      { id: 'INS-3', name: 'Kerry Lewis', course: 'Solar Energy Tech' }, { id: 'INS-4', name: 'Sasha Grant', course: 'Cosmetology' }]));
    if (CESTISStore.flush) { try { await CESTISStore.flush(); } catch (e) {} }
  }, { D: { CENTRES: D.CENTRES, students: D.students, att: D.att, exams: D.exams, results: D.results, feeStudents: D.feeStudents, payments: D.payments, feeStructure: D.feeStructure }, PEOPLE });
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
}

async function signIn(page, who) {
  const p = PEOPLE[who];
  await page.evaluate(c => {
    if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); }
    const l = document.getElementById(c + 'Login');
    if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click();
  }, p.card);
  await page.waitForTimeout(200);
  await page.fill('#' + p.card + 'User', p.user);
  await page.fill('#' + p.card + 'Pass', p.pass);
  await page.press('#' + p.card + 'Pass', 'Enter');
  const ok = await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { dismissCloudNotification(); } catch (e) {} document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); });
  return ok;
}

/* An independent count from what this browser's store holds right now:
   plain arithmetic on the financial year of each date (April to March). */
const STORE_COUNT = () => {
  const fy = d => { const m = /^(\d{4})-(\d{2})/.exec(String(d || '')); return m ? (+m[2] >= 4 ? +m[1] : +m[1] - 1) : null; };
  const now = new Date(), present = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const acc = JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]'), pay = JSON.parse(CESTISStore.getItem('cestiSchoolFeePayments') || '[]');
  const paid = {}; pay.forEach(p => { paid[p.studentId] = (paid[p.studentId] || 0) + (+p.amount || 0); });
  const out = { accounts: 0, debtors: 0, billed: 0, owed: 0, collected: 0, earlierOwed: 0, earlierTrainees: 0 };
  acc.forEach(a => {
    const y = fy(a.enrollmentDate) != null ? fy(a.enrollmentDate) : fy(a.createdAt), owes = (+a.tuitionFee || 0) - (paid[a.id] || 0);
    if (y == null || y === present) { out.accounts++; out.billed += +a.tuitionFee || 0; out.owed += owes; if (owes > 0) out.debtors++; }
    else if (y < present && owes > 0) { out.earlierOwed += owes; out.earlierTrainees++; }
  });
  pay.forEach(p => { const y = fy(p.date); if (y == null || y === present) out.collected += +p.amount || 0; });
  return out;
};

(async () => {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  async function session(who, combo) {
    combo = combo || 'desktop-dark';
    const phone = combo.startsWith('phone'), light = combo.endsWith('light');
    const ctx = await browser.newContext({ timezoneId: 'America/Jamaica', acceptDownloads: true,
      viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await ctx.addInitScript(l => { try { localStorage.setItem('cestis_sw_disabled', '1'); if (l) localStorage.setItem('cestisTheme', 'light'); } catch (e) {} }, light);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(combo + '/' + who + ': ' + e.message));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await seedCentre(page);
    ok(await signIn(page, who), combo + ': ' + PEOPLE[who].name + ' (' + who + ') signs in');
    return { ctx, page };
  }
  const shot = async (page, combo, name, sel, frame) => {
    if (!SHOTS) return;
    await (frame || page).evaluate(s => { const e = s && document.querySelector(s); if (e) e.scrollIntoView({ block: 'start' }); }, sel || '').catch(() => {});
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, name + '-' + combo + '.png') });
  };
  const txt = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  /* ======================= the board ======================= */
  console.log('THE CMC BOARD');
  {
    const { ctx, page } = await session('cmc');
    const before = await page.evaluate(() => ({ s: CESTISStore.getItem('cestiSchoolFeeStudents'), p: CESTISStore.getItem('cestiSchoolFeePayments') }));
    const count = await page.evaluate(STORE_COUNT);
    ok(count.billed === T.feesFY.billed && count.collected === T.feesFY.collected && count.owed === T.feesFY.owed && count.earlierOwed === T.feesEarlier.owed,
      'the books in this browser count as the fixture does: ' + money(count.billed) + ' / ' + money(count.collected) + ' / ' + money(count.owed) + ', earlier ' + money(count.earlierOwed));
    await page.evaluate(() => showPage('cmc-dashboard')); await page.waitForTimeout(1200);
    const card = await txt(page, '#cmcKpiFeesCard');
    ok(card.indexOf('BILLED $1,785,000') !== -1 || /Billed \$1,785,000/i.test(card), 'dashboard: Billed shown $1,785,000, truth ' + money(T.feesFY.billed));
    ok(/Collected \$909,000/i.test(card), 'dashboard: Collected shown $909,000, truth ' + money(T.feesFY.collected));
    ok(/Owed \$876,000/i.test(card), 'dashboard: Owed shown $876,000, truth ' + money(T.feesFY.owed));
    ok(card.indexOf('Earlier years still owing: $140,000 (10 trainees) — not included in Owed') !== -1, 'dashboard: "Earlier years still owing: $140,000 (10 trainees)", truth ' + money(T.feesEarlier.owed) + ' (' + T.feesEarlier.trainees + ')');
    ok(card.indexOf(count.debtors + ' of ' + count.accounts + ' trainees') !== -1, 'dashboard: ' + count.debtors + ' of ' + count.accounts + ' still owe (counted from the books)');
    ok(!/\bD\d/.test(await txt(page, '#page-cmc-dashboard')), 'no money printed with a "D"');
    await page.evaluate(() => cmcShowDetail('fees')); await page.waitForTimeout(500);
    const det = await txt(page, '.cmc-detail-overlay');
    ok(/School Fees — FY 2026\/2027/.test(det) && !/GPA/.test(det), '"School Fees" details are money, not stages and GPAs');
    Object.keys(T.feesFY.byProgramme).forEach(n => { const t = T.feesFY.byProgramme[n];
      ok(det.indexOf(n + ' ' + money(t.billed) + ' ' + money(t.collected) + ' ' + money(t.owed) + ' ' + t.debtors + ' of ' + t.accounts) !== -1, 'details: ' + n + ' ' + money(t.billed) + ' / ' + money(t.collected) + ' / ' + money(t.owed)); });
    await page.evaluate(() => document.querySelectorAll('.cmc-detail-overlay').forEach(o => o.remove()));
    await page.evaluate(() => cmcShowDetail('completion')); await page.waitForTimeout(400);
    ok(/Completion — Trainees by Stage/.test(await txt(page, '.cmc-detail-overlay')), 'the Completion card opens completion details');
    await page.evaluate(() => document.querySelectorAll('.cmc-detail-overlay').forEach(o => o.remove()));
    await page.evaluate(() => showPage('cmc-financial')); await page.waitForTimeout(1500);
    const fin = await txt(page, '#cmcFinFeesCard');
    ok(/School Fees Owed — FY 2026\/2027 \$876,000 \$909,000 collected of \$1,785,000 billed/i.test(fin), 'Financial Overview: fees owed, of what was billed (was "Fee Completion")');
    const chart = await page.evaluate(() => { const c = cmcChartInstances.fees; return c ? c.data.datasets[0].data : null; });
    ok(chart && chart[0] === T.feesFY.collected && chart[1] === T.feesFY.owed, 'the doughnut is $909,000 collected and $876,000 owed (was certificates)');
    const table = await txt(page, '#cmcFinFeesTable');
    ok(table.indexOf('All programmes $1,785,000 $909,000 $876,000') !== -1 && table.indexOf('Cosmetology $140,000 10') !== -1, 'fees by programme, totals and earlier years');
    await page.evaluate(() => showPage('cmc-portal')); await page.waitForTimeout(1500);
    const portal = await txt(page, '#cmcpFees');
    ok(/School Fees — FY 2026\/2027 🔒 View only/.test(portal) && portal.indexOf('All programmes $1,785,000 $909,000 $876,000') !== -1 &&
      portal.indexOf('Earlier years still owing: $140,000 (10 trainees)') !== -1, 'Oversight Portal: a read-only School Fees card with the same figures');
    // Read only: every board page visited, a save forced, and a new trainee
    // on the roll that has no fee record (the mirror would have minted one).
    for (const pg of ['cmc-virements', 'cmc-staff', 'cmc-academic', 'cmc-my-appraisal', 'cmc-profile', 'cmc-dashboard']) { await page.evaluate(x => showPage(x), pg); await page.waitForTimeout(500); }
    await page.evaluate(() => { students.push({ id: 'STU-board-probe', name: 'Probe Trainee', course: 'Plumbing', stage: 'testing' }); try { saveState(); } catch (e) {} students.pop(); try { cmcLoadAllData(); } catch (e) {} });
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({ s: CESTISStore.getItem('cestiSchoolFeeStudents'), p: CESTISStore.getItem('cestiSchoolFeePayments') }));
    ok(after.s === before.s && after.p === before.p, 'the board read the fee books and wrote nothing to them (fee roll and payments byte-identical)');
    await ctx.close();
  }

  /* ======================= the administrator ======================= */
  console.log('\nTHE ADMINISTRATOR');
  {
    const { ctx, page } = await session('admin');
    await page.evaluate(() => showPage('dashboard')); await page.waitForTimeout(1000);
    const card = await txt(page, '#dashFeesCard');
    ok(/Billed \$1,785,000 Collected \$909,000 Outstanding \$876,000 Earlier years still owing: \$140,000 \(10 trainees\)/i.test(card),
      'dashboard: Billed $1,785,000, Collected $909,000, Outstanding $876,000, and the earlier years right under Outstanding');
    // School Fee, inside the dashboard.
    await page.evaluate(() => showPage('fee-management')); await page.waitForTimeout(5000);
    const fee = page.frames().find(f => /School\.Fee/.test(f.url()));
    if (ok(!!fee, 'School Fee opens')) {
      await fee.evaluate(() => { const b = document.getElementById('activateWindowBtn'); if (b && b.offsetParent) b.click(); }).catch(() => {});
      await page.waitForTimeout(600);
      await fee.evaluate(() => { try { switchModule('dashboard'); } catch (e) {} });
      await page.waitForTimeout(800);
      const out = await fee.evaluate(() => ({ v: document.getElementById('totalOutstanding').innerText, e: document.getElementById('totalEarlierYears').innerText,
        shown: getComputedStyle(document.getElementById('totalEarlierYears')).display !== 'none' }));
      ok(out.v === '$876,000.00', 'School Fee: Total Outstanding $876,000.00 (truth ' + money(T.feesFY.owed) + ')');
      ok(out.shown && out.e === 'Earlier years still owing: $140,000 (10 trainees) · not included above', 'School Fee: "' + out.e + '" under it');
      await fee.evaluate(() => { feeScopeMode = 'all'; updateDashboard(); });
      ok(await fee.evaluate(() => getComputedStyle(document.getElementById('totalEarlierYears')).display === 'none'), 'School Fee "Every year": the line is not repeated (already included)');
      await fee.evaluate(() => { feeScopeMode = 'year'; updateDashboard(); });
    }
    // Reports and the Programme return.
    await page.evaluate(() => showPage('reports')); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ heading: document.getElementById('prHeading').innerText.split('\n')[0],
      intakes: document.querySelectorAll('#prIntake option').length, periods: document.querySelectorAll('#prPeriod option').length,
      period: document.getElementById('prPeriod').value }));
    ok(r.intakes === 6 && r.periods >= 9, 'Reports: an intake filter (all + 5 intakes) and a period filter (' + r.periods + ' choices)');
    ok(/^Programme return — All intakes — 1 Oct – 31 Dec 2026 \(Q3, FY 2026\/2027\)/.test(r.heading), 'a plain heading: "' + r.heading + '"');
    ok(await page.evaluate(() => Array.from(document.querySelectorAll('#prBody .table-wrapper')).every(w => w.scrollWidth <= w.clientWidth + 1)),
      'on a 1366-wide screen every table of the return fits without scrolling sideways');
    await page.selectOption('#prPeriod', 'q:2026/2027:3');
    await page.waitForTimeout(300);
    const [csvDl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('text=Download CSV')]);
    let csv = '';
    if (ok(!!csvDl, 'Download CSV gives a file: ' + (csvDl && csvDl.suggestedFilename()))) {
      const f = path.join(SHOTS || require('os').tmpdir(), csvDl.suggestedFilename()); await csvDl.saveAs(f); csv = fs.readFileSync(f, 'utf8');
    }
    const lines = csv.replace(/^﻿/, '').split(/\r\n/);
    const hdr = (lines.find(l => /^Programme \/ intake,/.test(l)) || '').split(',');
    const tQ3 = T.returnQ3;
    ['Welding & Fabrication', 'Electrical Installation', 'Solar Energy Tech', 'Plumbing'].forEach(n => {
      const row = (lines.find(l => new RegExp('^\\d+\\. ' + n.replace('&', '\\&') + ',').test(l)) || '').split(','), t = tQ3[n];
      const c = h => row[hdr.indexOf(h)];
      const want = { 'Applicants': t.applicants, 'Enrolled': t.enrolled, 'Active (in training)': t.active, 'Attendance %': t.attendance.rate == null ? '' : t.attendance.rate,
        'Test pass rate %': t.pass.rate == null ? '' : t.pass.rate, 'Marked test results': t.pass.of, 'Fees billed (JMD)': t.billed, 'Fees collected in period (JMD)': t.collected, 'Fees owed as at today (JMD)': t.owed };
      const bad = Object.keys(want).filter(h => c(h) !== String(want[h]));
      ok(row.length > 5 && !bad.length, 'CSV ' + n + ' = hand count' + (bad.length ? ' — ' + bad.map(h => h + ' ' + c(h) + ' vs ' + want[h]).join('; ') : ''));
    });
    ok(lines.some(l => /^Not on this return \(did not run in this period\),03\. Cosmetology/.test(l)), 'CSV names the intake left out');
    const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.click('text=Download PDF')]);
    if (ok(!!pdfDl, 'Download PDF gives a file: ' + (pdfDl && pdfDl.suggestedFilename()))) {
      const f = path.join(SHOTS || require('os').tmpdir(), pdfDl.suggestedFilename()); await pdfDl.saveAs(f);
      const bytes = fs.readFileSync(f);
      ok(bytes.slice(0, 5).toString() === '%PDF-', 'it is a PDF');
      const text = await page.evaluate(async b64 => {
        const lib = await cestisNeedLib('pdfjsLib');
        const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const doc = await lib.getDocument({ data }).promise;
        const pg = await doc.getPage(1); const tc = await pg.getTextContent();
        return tc.items.map(i => i.str).join(' ');
      }, bytes.toString('base64')).catch(e => 'pdf.js failed: ' + e.message);
      ok(/Programme return/.test(text) && /All intakes - 1 Oct - 31 Dec 2026 \(Q3, FY 2026\/2027\)/.test(text) && text.indexOf('$271,000') !== -1 && text.indexOf('80% of 25 active') !== -1,
        'the PDF reads back (pdf.js): the heading, $271,000 collected and 80% of 25 active for Welding');
    }
    await ctx.close();
  }

  /* ======================= phone layout, and pictures ======================= */
  console.log('\nON A PHONE' + (SHOTS ? ', AND THE PICTURES' : ''));
  const combos = SHOTS ? ['desktop-dark', 'desktop-light', 'phone-dark', 'phone-light'] : ['phone-dark'];
  for (const combo of combos) {
    {
      const { ctx, page } = await session('cmc', combo);
      await page.evaluate(() => showPage('cmc-dashboard')); await page.waitForTimeout(1500);
      if (combo.startsWith('phone')) ok(await noSideScroll(page), combo + ': the board\'s dashboard does not scroll sideways');
      await shot(page, combo, 'cmc-dashboard-fees', '#cmcKpiFeesCard');
      await page.evaluate(() => cmcShowDetail('fees')); await page.waitForTimeout(500);
      await shot(page, combo, 'cmc-fees-details');
      await page.evaluate(() => document.querySelectorAll('.cmc-detail-overlay').forEach(o => o.remove()));
      await page.evaluate(() => showPage('cmc-financial')); await page.waitForTimeout(1800);
      await shot(page, combo, 'cmc-financial-overview', '#page-cmc-financial');
      await shot(page, combo, 'cmc-financial-fees-table', '#cmcFinFeesTitle');
      await page.evaluate(() => showPage('cmc-portal')); await page.waitForTimeout(1500);
      if (combo.startsWith('phone')) ok(await noSideScroll(page), combo + ': the Oversight Portal does not scroll sideways');
      await shot(page, combo, 'cmc-portal-fees', '#cmcpFees');
      await ctx.close();
    }
    {
      const { ctx, page } = await session('admin', combo);
      await page.evaluate(() => showPage('dashboard')); await page.waitForTimeout(1200);
      if (combo.startsWith('phone')) ok(await noSideScroll(page), combo + ': the administrator\'s dashboard does not scroll sideways');
      await shot(page, combo, 'admin-dashboard-fees', '#dashFeesCard');
      await page.evaluate(() => showPage('reports')); await page.waitForTimeout(1500);
      if (combo.startsWith('phone')) ok(await noSideScroll(page), combo + ': Reports does not scroll sideways');
      await shot(page, combo, 'reports-filters', '#programmeReturnCard');
      await shot(page, combo, 'reports-return-table', '#prBody');
      if (SHOTS) {
        await page.evaluate(() => showPage('fee-management')); await page.waitForTimeout(5000);
        const fee = page.frames().find(f => /School\.Fee/.test(f.url()));
        if (fee) {
          await fee.evaluate(() => { const b = document.getElementById('activateWindowBtn'); if (b && b.offsetParent) b.click(); }).catch(() => {});
          await page.waitForTimeout(600);
          await fee.evaluate(() => { try { switchModule('dashboard'); } catch (e) {} ['feeRecordsBanner', 'feeToastNote'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); }); });
          await page.waitForTimeout(800);
          await shot(page, combo, 'school-fee-outstanding', '#totalOutstanding', fee);
        }
      }
      await ctx.close();
    }
  }

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
