/* The administrator's dashboard counts one financial year, in a real browser.

     NODE_PATH=/opt/node-tools/node_modules node tests/browser/dash-fiscal-year.js [--shots DIR]

   The owner: "put a filter fiscal year for dashboard as well that ensure only
   trainee to date are shown, not data for centres closed." The browser's
   clock is held at Saturday 7 November 2026 (FY 2026/2027, Q3). A real
   Administrator signs in to a Centre seeded into the dashboard's own store
   (every name made up) with trainees across three financial years — an open
   intake (Welding), one that closed this year (Electrical), one that closed
   last year (Cosmetology), one that began last year and is still running
   (Solar, trainees with no stamps at all), an undated programme (Plumbing),
   a centre whose record is gone, a trainee enrolled with a date after today
   and one nothing places in any year — plus exams, classes and fee books.

   For each choice on the year bar — this year (the default), with closed
   centres, a quarter, last year, All Years — it reads every figure the
   dashboard shows (the bar's own statement, the four cards, School Fees, the
   pipeline, the alerts) and checks it against the count made here by hand.
   Then: the choice is remembered on this screen across a sign-out; the
   trainees left out are named on the bar; going through every choice
   changed no record; on a phone the bar does not push the page sideways.

   With --shots DIR, pictures (deviceScaleFactor 2) of the dashboard with its
   bar — this year and All Years, dark and light — are written to DIR.

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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const NOW = new Date('2026-11-07T15:00:00-05:00');   // Saturday 7 November 2026, 3 pm in Jamaica

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } return !!c; };

const ADMIN = { id: 'USR-ADM', name: 'Marcia Thompson', role: 'admin', user: 'mthompson', pass: 'Centre-Admin-2026!' };

/* The Centre, built in the page with its own enrolment stamp. */
async function seedCentre(page) {
  await page.evaluate(async (ADMIN) => {
    const E = CESTISCore.enrolment;
    CESTISStore.setItem('voctrain_users', JSON.stringify([{ id: ADMIN.id, name: ADMIN.name, role: 'admin', username: ADMIN.user, email: ADMIN.user + '@example.com',
      password: await hashPassword(ADMIN.pass), status: 'active', updatedAt: '2026-10-01T12:00:00.000Z' }]));
    const dates = { 1: ['2026-09-07', '2027-06-25'], 2: ['2026-04-13', '2026-08-28'], 3: ['2025-09-08', '2026-03-20'], 18: ['2026-01-12', '2026-12-18'], 17: ['2024-09-02', '2025-06-27'] };
    const sk = CESTISCore.freshSkillAreas();
    sk.forEach(a => { if (dates[a.id]) { a.startDate = dates[a.id][0]; a.endDate = dates[a.id][1]; } });
    CESTISStore.setItem('voctrain_skillAreas', JSON.stringify(sk));
    const area = id => sk.find(a => a.id === id);
    const roll = [];
    const add = (s) => { s.id = CESTISCore.stableStudentId(s); s.updatedAt = '2026-10-01T12:00:00.000Z'; roll.push(s); return s; };
    // A record made on the day of enrolment, as the enrolment forms make it.
    const stamped = (name, id, on, stage, extra) => add(Object.assign({ name, course: area(id).name, stage, gender: 'Female', createdAt: on + 'T14:00:00.000Z' }, E.enrolmentStamp(area(id), on), extra || {}));
    stamped('Cora One', 3, '2025-09-08', 'certified', { certNo: 'CO-2026-0001-AB', certDate: 'October 16, 2026' });
    stamped('Cora Two', 3, '2025-09-08', 'certified', { certNo: 'CO-2026-0002-AB', certDate: '2026-09-03' });
    stamped('Cora Three', 3, '2025-09-08', 'collected', { certNo: 'CO-2026-0003-AB', certDate: '2026-08-20', certCollected: true });
    stamped('Cora Four', 3, '2025-09-08', 'incomplete');
    ['Wes One', 'Wes Two', 'Wes Three', 'Wes Four', 'Wes Five'].forEach(n => stamped(n, 1, '2026-09-07', 'training'));
    stamped('Wes October', 1, '2026-10-15', 'training');
    stamped('Wes Late October', 1, '2026-10-20', 'training');
    stamped('Wes December', 1, '2026-12-01', 'testing');
    stamped('Eli One', 2, '2026-04-13', 'certified', { certNo: 'EL-2026-0001-AB', certDate: '2026-09-10' });
    stamped('Eli Two', 2, '2026-04-13', 'nyc');
    stamped('Eli Three', 2, '2026-04-13', 'collected', { certNo: 'EL-2026-0003-AB', certDate: '2026-09-11', certCollected: true });
    stamped('Mason One', 17, '2024-09-02', 'collected', { certNo: 'MA-2025-0001-AB', certDate: '2025-07-10', certCollected: true });
    stamped('Mason Two', 17, '2024-09-02', 'nyc');
    ['Sol One', 'Sol Two', 'Sol Three'].forEach(n => add({ name: n, course: 'Solar Energy Tech', stage: 'training', createdAt: '2026-01-12T14:00:00.000Z' }));
    ['Pip One', 'Pip Two'].forEach(n => add({ name: n, course: 'Plumbing', stage: 'testing', createdAt: '2026-10-20T15:00:00.000Z' }));
    add({ name: 'Stamp Only', course: 'Welding & Fabrication', centreId: 1, fiscalYear: '2026/2027', stage: 'interview' });
    add({ name: 'Old Programme', course: 'Leathercraft', enrolmentDate: '2026-05-04', createdAt: '2026-05-04T14:00:00.000Z', courseStart: '2026-05-04', courseEnd: '2026-07-31', stage: 'certified', certNo: 'LC-2026-0001-AB', certDate: '2026-08-01' });
    add({ name: 'No When', course: 'Mystery Course', stage: 'training' });
    CESTISStore.setItem('voctrain_students', JSON.stringify(roll));
    const idOf = n => roll.find(s => s.name === n).id;
    CESTISStore.setItem('voctrain_exams', JSON.stringify([
      { id: 'EX1', title: 'Welding Unit 1', course: 'Welding & Fabrication', date: '2026-11-20', time: '09:00', duration: 60, status: 'upcoming', passMark: 60, questions: 10, createdBy: 'admin', updatedAt: '2026-10-01T12:00:00.000Z' },
      { id: 'EX5', title: 'Electrical resit', course: 'Electrical Installation', date: '2026-11-25', time: '09:00', duration: 60, status: 'upcoming', passMark: 60, questions: 10, createdBy: 'admin', updatedAt: '2026-10-01T12:00:00.000Z' },
      { id: 'EX2', title: 'Electrical Unit 2', course: 'Electrical Installation', date: '2026-06-10', time: '09:00', duration: 60, status: 'completed', passMark: 60, questions: 10, createdBy: 'admin', updatedAt: '2026-06-10T12:00:00.000Z' },
      { id: 'EX3', title: 'Cosmetology Unit 3', course: 'Cosmetology', date: '2026-02-10', time: '09:00', duration: 60, status: 'completed', passMark: 60, questions: 10, createdBy: 'admin', updatedAt: '2026-02-10T12:00:00.000Z' }]));
    CESTISStore.setItem('voctrain_classSessions', JSON.stringify([
      { id: 'CS1', name: 'Welding practical', course: 'Welding & Fabrication', date: '2026-11-10', time: '09:00', duration: 120, type: 'practical', status: 'scheduled', createdBy: 'Admin', createdAt: '2026-10-01T12:00:00.000Z' },
      { id: 'CS2', name: 'Welding theory', course: 'Welding & Fabrication', date: '2026-11-12', time: '09:00', duration: 120, type: 'lecture', status: 'scheduled', createdBy: 'Admin', createdAt: '2026-10-01T12:00:00.000Z' },
      { id: 'CS3', name: 'Wiring practical', course: 'Electrical Installation', date: '2026-05-05', time: '09:00', duration: 120, type: 'practical', status: 'scheduled', createdBy: 'Admin', createdAt: '2026-04-20T12:00:00.000Z' },
      { id: 'CS4', name: 'Hair and scalp', course: 'Cosmetology', date: '2025-11-04', time: '09:00', duration: 120, type: 'practical', status: 'scheduled', createdBy: 'Admin', createdAt: '2025-10-20T12:00:00.000Z' }]));
    const acct = (id, n, area, on, fee) => ({ id, lmsId: idOf(n), name: n, skillArea: area, tuitionFee: fee, enrollmentDate: on, createdAt: on + 'T12:00:00.000Z', source: 'lms', updatedAt: '2026-10-01T12:00:00.000Z' });
    CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify([
      acct('SF-A', 'Eli One', 'Electrical Installation', '2026-04-13', 20000), acct('SF-B', 'Wes One', 'Welding & Fabrication', '2026-09-07', 28000),
      acct('SF-C', 'Cora Four', 'Cosmetology', '2025-09-08', 30000), acct('SF-E', 'Pip One', 'Plumbing', '2026-10-20', 15000)]));
    const pay = (id, sid, amount, date, area) => ({ id, studentId: sid, skillArea: area, amount, date, method: 'Cash', receiptNumber: 'R-' + id, createdAt: date + 'T12:00:00.000Z' });
    CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify([
      pay('P1', 'SF-A', 5000, '2026-05-01', 'Electrical Installation'), pay('P2', 'SF-B', 10000, '2026-09-20', 'Welding & Fabrication'),
      pay('P3', 'SF-C', 20000, '2025-10-01', 'Cosmetology'), pay('P4', 'SF-GONE', 3000, '2026-06-01', 'Electrical Installation')]));
    if (CESTISStore.flush) { try { await CESTISStore.flush(); } catch (e) {} }
  }, ADMIN);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
}

async function signIn(page) {
  await page.evaluate(() => {
    if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); }
    const l = document.getElementById('adminLogin');
    if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click();
  });
  await page.waitForTimeout(200);
  await page.fill('#adminUser', ADMIN.user);
  await page.fill('#adminPass', ADMIN.pass);
  await page.press('#adminPass', 'Enter');
  const done = await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 30000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { try { dismissCloudNotification(); } catch (e) {} document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); });
  return done;
}

// Everything the dashboard says, read off the screen.
const READ = () => {
  const t = id => { const e = document.getElementById(id); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
  const num = id => { const e = document.getElementById(id); return e ? Number(String(e.textContent).replace(/,/g, '')) : null; };
  const fee = label => { const c = Array.from(document.querySelectorAll('#dashFeesCard .dash-fees-cell')).find(x => x.querySelector('.stat-label').textContent === label); return c ? c.querySelector('.dash-fees-v').textContent : null; };
  const alert = id => { const e = document.getElementById(id); return e ? parseInt(e.querySelector('.alert-msg').textContent, 10) : null; };
  return {
    headline: t('dashYearHeadline'), bar: t('dashYearBar'),
    enrolled: num('dashTotalEnrolled'), active: t('dashActiveLine'), certified: num('dashCertified'),
    certLabel: (document.getElementById('dashCertified') || {}).nextElementSibling ? document.getElementById('dashCertified').nextElementSibling.textContent : null,
    exams: num('dashUpcomingExams'), classes: num('dashClassSessions'),
    feeTitle: (document.querySelector('#dashFeesCard h3') || {}).textContent, billed: fee('Billed'), collected: fee('Collected'), owed: fee('Outstanding'),
    earlier: t('dashFeesEarlier'), feeNote: t('dashFeesCard'),
    pipe: ['pTest', 'pInterview', 'pTraining', 'pCertified', 'pCollected', 'pNyc', 'pIncomplete'].map(num).join(' '),
    pendingCerts: alert('dashPendingCertsAlert'), incomplete: alert('dashIncompleteAlert'), examsAlert: alert('dashExamsAlert'),
    pressed: Array.from(document.querySelectorAll('#dashYearBar .dyb-tab[aria-pressed="true"]')).map(b => b.textContent.replace('✓ ', '')).join(','),
    closedBox: (document.getElementById('dashIncludeClosed') || {}).checked
  };
};

/* The hand count, choice by choice (see the header for who is where). */
const WANT = {
  'this year (default)': { headline: 'FY 2026/2027 · open centres · 13 trainees', pressed: 'Whole Year', enrolled: 13, active: '10 active (in training) · 3 applicants', certified: 0,
    exams: 1, classes: 2, feeTitle: 'School Fees — FY 2026/2027', billed: '$43,000', collected: '$10,000', owed: '$33,000', earlier: 'Earlier years still owing: $10,000 (1 trainee)',
    pipe: '2 1 10 0 0 0 0', pendingCerts: 0, incomplete: 0, examsAlert: 1, closedBox: false },
  'this year, closed centres included': { headline: 'FY 2026/2027 · open and closed centres · 17 trainees', pressed: 'Whole Year', enrolled: 17, active: '10 active (in training) · 3 applicants', certified: 3,
    exams: 2, classes: 3, feeTitle: 'School Fees — FY 2026/2027', billed: '$63,000', collected: '$18,000', owed: '$48,000',
    pipe: '2 1 10 2 1 1 0', pendingCerts: 2, incomplete: 0, examsAlert: 2, closedBox: true },
  'Q2 · Jul–Sep': { headline: 'Q2 · Jul–Sep 2026 · open centres · 6 trainees', pressed: 'Q2 · Jul–Sep', enrolled: 6, active: '5 active (in training) · 1 applicant', certified: 0,
    exams: 0, classes: 0, feeTitle: 'School Fees — Q2 · Jul–Sep 2026', billed: '$28,000', collected: '$10,000', owed: '$18,000', pipe: '0 1 5 0 0 0 0' },
  'FY 2025/2026 (a past year)': { headline: 'FY 2025/2026 · every centre · 9 trainees', pressed: 'Whole Year', enrolled: 9, active: '3 active (in training) · 0 applicants', certified: 4,
    exams: 0, classes: 1, feeTitle: 'School Fees — FY 2025/2026', billed: '$30,000', collected: '$20,000', owed: '$10,000', earlier: 'Earlier years still owing: nothing',
    pipe: '0 0 3 2 2 1 1', pendingCerts: 2, incomplete: 1, examsAlert: 0, closedBox: undefined },
  'All Years': { headline: 'All years · every centre · 25 trainees', pressed: 'All Years', enrolled: 25, active: '11 active (in training) · 4 applicants', certified: 6,
    exams: 2, classes: 4, feeTitle: 'School Fees — All years', billed: '$93,000', collected: '$38,000', owed: '$58,000', earlier: null,
    pipe: '3 1 11 4 3 2 1', pendingCerts: 4, incomplete: 1, examsAlert: 2, closedBox: undefined }
};
function check(what, got) {
  const want = WANT[what];
  const bad = Object.keys(want).filter(k => got[k] !== want[k]);
  ok(!bad.length, what + ': ' + want.headline + (bad.length ? ' — differs: ' + bad.map(k => k + ' shown ' + JSON.stringify(got[k]) + ', counted ' + JSON.stringify(want[k])).join('; ') : ' — every figure as counted by hand'));
}

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
  async function session(combo) {
    combo = combo || 'desktop-dark';
    const phone = combo.startsWith('phone'), light = combo.endsWith('light');
    const ctx = await browser.newContext({ timezoneId: 'America/Jamaica', acceptDownloads: true, viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 900 },
      deviceScaleFactor: SHOTS || phone ? 2 : 1, isMobile: phone, hasTouch: phone });
    await ctx.clock.setFixedTime(NOW);
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await ctx.addInitScript(l => { try { localStorage.setItem('cestis_sw_disabled', '1'); if (l) localStorage.setItem('cestisTheme', 'light'); } catch (e) {} }, light);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(combo + ': ' + e.message));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await seedCentre(page);
    ok(await signIn(page), combo + ': the Administrator signs in');
    await page.evaluate(() => showPage('dashboard'));
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const click = async (page, sel) => { await page.click(sel); await page.waitForTimeout(500); };
  const shot = async (page, name, combo) => {
    if (!SHOTS) return;
    await page.evaluate(() => { const b = document.getElementById('dashYearBar'); if (b) b.scrollIntoView({ block: 'start' }); document.getElementById('mainContent').scrollTop -= 12; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, name + '-' + combo + '.png') });
  };

  console.log('EVERY FIGURE, CHOICE BY CHOICE');
  {
    const { ctx, page } = await session('desktop-dark');
    ok(await page.evaluate(() => new Date().toISOString().slice(0, 10) === '2026-11-07' && CESTISCore.yearView.presentFY() === '2026/2027'), 'the browser\'s clock reads 7 November 2026 (FY 2026/2027)');
    ok(await page.evaluate(() => students.length === 25), 'the Centre\'s 25 trainees are on the roll');
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => ({ s: CESTISStore.getItem('voctrain_students'), f: CESTISStore.getItem('cestiSchoolFeeStudents'), p: CESTISStore.getItem('cestiSchoolFeePayments'),
      k: CESTISStore.getItem('voctrain_skillAreas'), e: CESTISStore.getItem('voctrain_exams'), c: CESTISStore.getItem('voctrain_classSessions') }));
    const order = ['#dashYearBar', '#dashStats', '#dashFeesCard', '#pTest', '#systemHealthCard', '#dashAlertsCard'];
    ok(await page.evaluate(o => { const at = o.map(s => document.querySelector(s)); return at.every(Boolean) && at.every((e, i) => !i || (at[i - 1].compareDocumentPosition(e) & 4)) &&
      (document.getElementById('officeTodayCard').compareDocumentPosition(at[0]) & 4); }, order), 'the year bar sits below Office today and above every figure');

    check('this year (default)', await page.evaluate(READ));
    const bar = await page.evaluate(() => document.getElementById('dashYearBar').innerText.replace(/\s+/g, ' '));
    ok(bar.indexOf('◀ Previous year FY 2026/2027 Next year ▶') !== -1 && /✓ Whole Year Q1 · Apr–Jun Q2 · Jul–Sep Q3 · Oct–Dec Q4 · Jan–Mar All Years/.test(bar), 'School Fee\'s bar: the years and the tabs');
    ok(bar.indexOf('10 enrolled this year to date · 3 trainees still in training from earlier years') !== -1, 'it says who: 10 enrolled this year to date, 3 still in training from earlier years');
    ok(/Include closed centres \(4 trainees not counted\)/.test(bar), 'the closed-centre switch, off, saying it leaves 4 out');
    ok(/1 trainee is enrolled with a date after today, so not counted yet/.test(bar) && /1 trainee has no enrolment date, year or centre dates, so no year can be given — counted under All Years/.test(bar),
      'the trainee not counted yet and the one with no year are both accounted for');
    await page.click('#dashYearBar .dyb-note:nth-of-type(1) summary').catch(() => {});
    await page.evaluate(() => document.querySelectorAll('#dashYearBar details').forEach(d => { d.open = true; }));
    const who = await page.evaluate(() => document.getElementById('dashYearBar').innerText);
    ok(/Wes December — Welding & Fabrication \(enrolled 2026-12-01\)/.test(who) && /No When — Mystery Course/.test(who), 'and "Show who" names them');
    const feeNote = (await page.evaluate(READ)).feeNote;
    ok(/Closed centres are left out \(4 fee records\); tick Include closed centres to count them, as School Fee does\./.test(feeNote), 'School Fees says the closed centres\' 4 fee records are left out, and how to count them');

    // The dashboard's Export Report counts what the dashboard counts.
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('.quick-action-btn:has-text("Export Report")')]);
    if (ok(!!dl, 'the dashboard\'s Export Report gives a file: ' + (dl && dl.suggestedFilename()))) {
      const f = path.join(SHOTS || require('os').tmpdir(), 'dash-fy-export-' + process.pid + '.csv'); await dl.saveAs(f);
      const rows = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).slice(1).map(l => l.split(','));
      if (!SHOTS) { try { fs.unlinkSync(f); } catch (e) {} }
      const total = rows.reduce((n, r) => n + Number(r[1]), 0);
      ok(dl.suggestedFilename() === 'report_export_FY-2026-2027.csv' && total === 13 && !rows.some(r => /Electrical|Cosmetology|Masonry/.test(r[0])),
        'and it is this year\'s, open centres only: ' + rows.map(r => r[0] + ' ' + r[1]).join(', '));
    }
    await page.check('#dashIncludeClosed'); await page.waitForTimeout(600);
    check('this year, closed centres included', await page.evaluate(READ));
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'dashIncludeClosed'), 'the keyboard stays on the switch after the redraw');
    await page.uncheck('#dashIncludeClosed'); await page.waitForTimeout(500);

    await click(page, '#dashYearBar [data-dyb="q2"]');
    check('Q2 · Jul–Sep', await page.evaluate(READ));
    ok(/3 trainees in training from earlier years are counted under Whole Year, not a quarter\./.test(await page.evaluate(() => document.getElementById('dashYearBar').innerText)), 'a quarter says where the trainees carried in went');
    await click(page, '#dashYearBar [data-dyb="year"]');

    await click(page, '#dashYearBar [data-dyb="prev"]');
    check('FY 2025/2026 (a past year)', await page.evaluate(READ));
    const pastBar = await page.evaluate(() => document.getElementById('dashYearBar').innerText.replace(/\s+/g, ' '));
    ok(/FY 2025\/2026 PAST/i.test(pastBar) && /You are looking at FY 2025\/2026, not the present year\. Every centre of that year is counted, closed ones too — by now all of them have closed\. Return to FY 2026\/2027/.test(pastBar),
      'a past year is marked, says every centre is counted, and offers the way back');
    await click(page, '#dashYearBar [data-dyb="present"]');
    ok((await page.evaluate(READ)).headline === WANT['this year (default)'].headline, '"Return to FY 2026/2027" goes back to the present year');

    await click(page, '#dashYearBar [data-dyb="all"]');
    check('All Years', await page.evaluate(READ));
    ok(await page.evaluate(() => document.getElementById('dashCertified').nextElementSibling.textContent === 'Certified This Year'), 'All Years: the cards are what they always were ("Certified This Year")');
    await click(page, '#dashYearBar [data-dyb="all"]');
    ok((await page.evaluate(READ)).pressed === 'Whole Year', 'All Years pressed again: back to one year, as on School Fee');

    // The other pages open and the dashboard, opened again, is drawn the same.
    await click(page, '#dashYearBar [data-dyb="q3"]');
    await page.evaluate(() => showPage('students')); await page.waitForTimeout(800);
    await page.evaluate(() => showPage('dashboard')); await page.waitForTimeout(800);
    ok((await page.evaluate(READ)).headline === 'Q3 · Oct–Dec 2026 · open centres · 4 trainees', 'leaving the dashboard and coming back keeps the choice: Q3, 4 trainees');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ s: CESTISStore.getItem('voctrain_students'), f: CESTISStore.getItem('cestiSchoolFeeStudents'), p: CESTISStore.getItem('cestiSchoolFeePayments'),
      k: CESTISStore.getItem('voctrain_skillAreas'), e: CESTISStore.getItem('voctrain_exams'), c: CESTISStore.getItem('voctrain_classSessions') }));
    ok(Object.keys(before).every(k => before[k] === after[k]), 'every choice made changed no record: trainees, fee books, centres, exams and classes byte-for-byte as they were');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('cestisDashYearView')).mode === 'quarter' && CESTISCore.isSnapshotableKey('cestisDashYearView') === false),
      'the choice is kept on this screen only (never in a backup)');
    // Signed out and in again on the same screen: the choice is still there.
    await page.evaluate(() => { try { handleLogout(); } catch (e) { try { logout(); } catch (e2) {} } });
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(2000);
    ok(await signIn(page), 'signed in again');
    await page.evaluate(() => showPage('dashboard')); await page.waitForTimeout(1200);
    ok((await page.evaluate(READ)).headline === 'Q3 · Oct–Dec 2026 · open centres · 4 trainees', 'the choice is remembered on this screen: still Q3');
    await page.evaluate(() => dashReturnToPresent()); await page.waitForTimeout(400);
    await ctx.close();
  }

  console.log('\nON A PHONE' + (SHOTS ? ', AND THE PICTURES' : ''));
  const combos = SHOTS ? ['desktop-dark', 'desktop-light', 'phone-dark'] : ['phone-dark'];
  for (const combo of combos) {
    const { ctx, page } = await session(combo);
    if (combo.startsWith('phone')) {
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.getElementById('dashYearBar').scrollWidth <= document.getElementById('dashYearBar').clientWidth + 1),
        combo + ': the bar wraps on a phone; nothing scrolls sideways');
      const small = await page.evaluate(() => Array.from(document.querySelectorAll('#dashYearBar *')).filter(e => e.childNodes.length && Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()))
        .map(e => parseFloat(getComputedStyle(e).fontSize)).filter(s => s < 12));
      ok(!small.length, combo + ': no text on the bar below 12px');
    }
    await shot(page, 'dashboard-this-year', combo);
    await page.evaluate(() => dashSelectAll()); await page.waitForTimeout(600);
    await shot(page, 'dashboard-all-years', combo);
    if (combo === 'desktop-dark') {
      await page.evaluate(() => { dashSelectYear(); dashShiftFY(-1); }); await page.waitForTimeout(600);
      await shot(page, 'dashboard-past-year', combo);
      await page.evaluate(() => { dashReturnToPresent(); dashSetClosed(true); }); await page.waitForTimeout(600);
      await shot(page, 'dashboard-closed-included', combo);
    }
    await page.evaluate(() => { dashReturnToPresent(); dashSetClosed(false); });
    await ctx.close();
  }

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
