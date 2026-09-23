/* School Fee — the present fiscal year only, in a real browser.

   "Verify on the dashboard that only the present fiscal year shows and none
   of the past; the user has to deliberately toggle to a past fiscal year to
   see data from that period."

   Loads the page with the fixture roll (368 trainees across six fiscal years)
   while the shared year key remembers a PAST year, then checks every figure,
   chart, list and picker on every tab against an INDEPENDENT oracle — its own
   Apr–Mar date arithmetic, not the page's filter functions. Anything from
   another fiscal year is a leak. It then checks that the past appears only
   through a deliberate step on this page: not when another page changes the
   shared year, and not when a record is saved with a past date.

   Needs a browser, so it is kept out of `npm test` like megadata-smoke:
     node tests/browser/school-fee-present-year.js [page] [--shots DIR]
   Playwright is found as playwright-core or playwright, or via NODE_PATH. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let chromium;
try { chromium = require('playwright-core').chromium; }
catch (e) { chromium = require('playwright').chromium; }
const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const args = process.argv.slice(2);
const shotAt = args.indexOf('--shots');
const OUT = shotAt >= 0 ? args[shotAt + 1] : null;
const PAGE = args.filter((a, i) => shotAt < 0 || (i !== shotAt && i !== shotAt + 1))[0] || 'School.Fee.html';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const snap = (page, name) => OUT ? page.screenshot({ path: path.join(OUT, name) }) : Promise.resolve();
const fixture = require(path.join(ROOT, 'tests/fixtures/school-fees-backup.json')).data;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain' };

let pass = 0, fail = 0; const leaks = [];
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; leaks.push(m); console.log('  ✗ ' + m); } };

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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(data => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    for (const k of Object.keys(data)) localStorage.setItem(k, data[k]);
    // The shared year key remembers a PAST year, as it would after someone
    // stepped back to enter arrears. The page must still open on the present.
    localStorage.setItem('cestis_active_quarter', JSON.stringify({ fy: '2024/2025', q: 3 }));
  }, fixture);
  const page = await ctx.newPage();
  await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(base + '/' + encodeURI(PAGE), { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.getElementById('activateWindowBtn'); if (b && b.offsetParent) b.click(); });
  await page.waitForTimeout(300);

  // Independent oracle, installed in the page: fiscal year from a date string
  // by plain arithmetic (Apr–Mar), no CESTISCore, no page filters.
  await page.evaluate(() => {
    window.__fy = d => {
      const m = /^(\d{4})-(\d{2})/.exec(String(d || ''));
      if (!m) { const t = new Date(d); if (!d || isNaN(t)) return null; return (t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1); }
      const y = +m[1], mo = +m[2]; return mo >= 4 ? y : y - 1;
    };
    const now = new Date(); window.__PRESENT = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    window.__stuFY = s => { const a = __fy(s.enrollmentDate); return a != null ? a : __fy(s.createdAt); };
    window.__presentStudents = () => students.filter(s => __stuFY(s) === __PRESENT);
    window.__presentPayments = () => payments.filter(p => __fy(p.date) === __PRESENT);
    window.__money = t => parseFloat(String(t).replace(/[^0-9.-]/g, '')) || 0;
    window.__clean = () => ['feeRecordsBanner', 'feeToastNote'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
  });
  const present = await page.evaluate(() => __PRESENT + '/' + (__PRESENT + 1));
  const roll = await page.evaluate(() => {
    const by = {}; students.forEach(s => { const k = __stuFY(s); by[k] = (by[k] || 0) + 1; });
    const pb = {}; payments.forEach(p => { const k = __fy(p.date); pb[k] = (pb[k] || 0) + 1; });
    return { students: students.length, payments: payments.length, documents: documents.length, by, pb,
      undatedStudents: students.filter(s => __stuFY(s) == null).length, undatedPayments: payments.filter(p => __fy(p.date) == null).length,
      noEnrolDate: students.filter(s => !s.enrollmentDate).length,
      noEnrolDateByCreated: (() => { const b = {}; students.filter(s => !s.enrollmentDate).forEach(s => { const k = __fy(s.createdAt); b[k] = (b[k] || 0) + 1; }); return b; })() };
  });
  console.log('Roll: ' + roll.students + ' trainees by FY start ' + JSON.stringify(roll.by) + '; ' + roll.payments + ' payments by FY start ' + JSON.stringify(roll.pb) + '; ' + roll.documents + ' documents');
  console.log('Undated: ' + roll.undatedStudents + ' trainees, ' + roll.undatedPayments + ' payments. No enrolment date (year taken from record-created date): ' + roll.noEnrolDate + ' → ' + JSON.stringify(roll.noEnrolDateByCreated));
  console.log('Page under test: ' + PAGE);
  console.log('Present fiscal year: FY ' + present + '\n');

  /* ---------------- DASHBOARD ---------------- */
  console.log('DASHBOARD (fresh load, nothing clicked)');
  await page.evaluate(() => switchModule('dashboard')); await page.waitForTimeout(800); await page.evaluate(() => __clean());
  const d = await page.evaluate(() => {
    const ps = __presentStudents(), pp = __presentPayments();
    const txt = id => document.getElementById(id).innerText;
    const cur = feeActiveQuarter();
    // Charts, read from Chart.js itself
    const cc = typeof collectionChart !== 'undefined' && collectionChart ? collectionChart.data : null;
    const tc = typeof trendChart !== 'undefined' && trendChart ? trendChart.data : null;
    // Oracle for the collection-rate bars
    const nrm = v => (v == null ? '' : String(v)).toLowerCase().trim();
    const exp = {}, col = {};
    ps.forEach(s => { const k = nrm(s.skillArea); exp[k] = (exp[k] || 0) + (parseFloat(s.tuitionFee) || 0); });
    pp.forEach(p => { const k = nrm(p.skillArea); col[k] = (col[k] || 0) + (parseFloat(p.amount) || 0); });
    const rateOracle = cc ? cc.labels.map(l => { const e = exp[nrm(l)] || 0, c = col[nrm(l)] || 0; return e > 0 ? Math.min(100, c / e * 100).toFixed(1) : 0; }) : null;
    // Oracle for the trend line: this FY's twelve months
    const months = []; for (let i = 0; i < 12; i++) { const dt = new Date(__PRESENT, 3 + i, 1); months.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')); }
    const trendOracle = months.map(ym => payments.filter(p => String(p.date).slice(0, 7) === ym).reduce((t, p) => t + (parseFloat(p.amount) || 0), 0));
    const activity = [...document.querySelectorAll('#recentActivity .payment-item small')].map(e => e.innerText.split(' - ')[0].trim());
    const unpricedShown = (/^([\d,]+) trainee/.exec(document.getElementById('feeUnpricedNotice').innerText || '') || [])[1];
    return {
      label: document.querySelector('#dashboardQuarterBar .fee-qfy-label').innerText.trim(), mode: feeScopeMode, fy: cur && cur.fy,
      bar: document.querySelector('#dashboardQuarterBar').innerText.replace(/\s+/g, ' '),
      students: [__money(txt('totalStudents')), ps.length],
      expected: [__money(txt('totalExpected')), ps.reduce((t, s) => t + (parseFloat(s.tuitionFee) || 0), 0)],
      collected: [__money(txt('totalCollected')), pp.reduce((t, p) => t + (parseFloat(p.amount) || 0), 0)],
      outstanding: [__money(txt('totalOutstanding')), ps.reduce((t, s) => t + (parseFloat(s.balance) || 0), 0)],
      scopes: ['totalStudentsScope', 'totalExpectedScope', 'totalCollectedScope', 'totalOutstandingScope'].map(txt),
      rate: cc ? [JSON.stringify(cc.datasets[0].data.map(String)), JSON.stringify(rateOracle.map(String))] : null,
      trendLabels: tc ? tc.labels : null, trend: tc ? [JSON.stringify(tc.datasets[0].data), JSON.stringify(trendOracle)] : null,
      activity, activityFY: activity.map(__fy),
      unpriced: [unpricedShown ? +unpricedShown.replace(/,/g, '') : 0, ps.filter(feeIsUnpriced).length, students.filter(feeIsUnpriced).length]
    };
  });
  await page.evaluate(() => window.scrollTo(0, 0)); await snap(page, '1-dashboard.png');
  ok(d.fy === present && d.mode === 'year', 'opens on FY ' + present + ', whole year, although the shared key remembered FY 2024/2025 (bar: "' + d.label + '", mode ' + d.mode + ')');
  ok(!/past/i.test(d.bar), 'the bar does not flag a past year');
  ok(d.students[0] === d.students[1], 'Total Students ' + d.students[0] + ' = present-year trainees ' + d.students[1]);
  ok(Math.abs(d.expected[0] - d.expected[1]) < 0.01, 'Total Expected ' + d.expected[0] + ' = present-year tuition ' + d.expected[1]);
  ok(Math.abs(d.collected[0] - d.collected[1]) < 0.01, 'Total Collected ' + d.collected[0] + ' = payments dated in FY ' + present + ' ' + d.collected[1]);
  ok(Math.abs(d.outstanding[0] - d.outstanding[1]) < 0.01, 'Total Outstanding ' + d.outstanding[0] + ' = present-year balances ' + d.outstanding[1]);
  ok(d.scopes.every(s => s.indexOf(present) >= 0), 'every card names FY ' + present + ': ' + JSON.stringify(d.scopes));
  ok(d.rate && d.rate[0] === d.rate[1], 'Collection Rate bars match present-year trainees and payments only');
  ok(d.trendLabels && d.trendLabels[0] === 'Apr ' + present.slice(0, 4) && d.trendLabels[11] === 'Mar ' + present.slice(5), 'Payment Trends runs ' + (d.trendLabels || [])[0] + ' – ' + (d.trendLabels || [])[11]);
  ok(d.trend && d.trend[0] === d.trend[1], 'Payment Trends amounts are this fiscal year\'s months only');
  ok(d.activity.length > 0 && d.activityFY.every(y => y === +present.slice(0, 4)), 'Recent Activity: ' + d.activity.length + ' payments, all dated in FY ' + present + ' ' + JSON.stringify(d.activity));
  ok(d.unpriced[0] === d.unpriced[1], 'the "no fee set" notice counts present-year trainees: shows ' + d.unpriced[0] + ', present-year ' + d.unpriced[1] + ' (whole roll ' + d.unpriced[2] + ')');

  /* ---------------- STUDENTS ---------------- */
  console.log('\nSTUDENTS');
  await page.evaluate(() => switchModule('students')); await page.waitForTimeout(700); await page.evaluate(() => __clean());
  const s = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#studentsTableBody tr .merge-checkbox')].map(c => students[+c.dataset.index]);
    return { n: rows.length, past: rows.filter(r => __stuFY(r) !== __PRESENT).map(r => r.name + ' (' + (r.enrollmentDate || r.createdAt) + ')').slice(0, 5), want: __presentStudents().length };
  });
  ok(s.n === s.want && s.past.length === 0, 'table lists ' + s.n + ' trainees, all enrolled in FY ' + present + (s.past.length ? ' — PAST: ' + s.past.join(', ') : ''));

  /* ---------------- PAYMENTS ---------------- */
  console.log('\nPAYMENTS');
  await page.evaluate(() => switchModule('payments')); await page.waitForTimeout(700); await page.evaluate(() => __clean());
  const p = await page.evaluate(() => {
    const dates = [...document.querySelectorAll('#paymentsTableBody tr')].map(r => r.dataset.date);
    const opts = [...document.querySelectorAll('#paymentStudentId option')].filter(o => o.value).map(o => students.find(x => x.id === o.value)).filter(Boolean);
    document.getElementById('traineeSearch').value = 'a'; traineeSearchInput();
    const results = [...document.querySelectorAll('#traineeSearchResults [data-id], #traineeSearchResults .trainee-result')].length;
    const pickerPast = opts.filter(x => __stuFY(x) !== __PRESENT);
    const idx = traineeSearchIndex.map(t => students.find(x => x.id === t.id)).filter(Boolean);
    window.__idx = { n: idx.length, past: idx.filter(x => __stuFY(x) !== __PRESENT).length };
    return { n: dates.length, pastDates: dates.filter(x => __fy(x) !== __PRESENT), want: __presentPayments().length,
      picker: opts.length, pickerPast: pickerPast.length, pickerPastEx: pickerPast.slice(0, 3).map(x => x.name + ' ' + (x.enrollmentDate || '')), results };
  });
  ok(p.n === p.want && p.pastDates.length === 0, 'payments table lists ' + p.n + ' payments, all dated in FY ' + present + (p.pastDates.length ? ' — PAST: ' + p.pastDates.join(', ') : ''));
  ok(p.pickerPast === 0, '"Select Student" picker offers present-year trainees only: ' + p.picker + ' offered, ' + p.pickerPast + ' from past years' + (p.pickerPast ? ' e.g. ' + p.pickerPastEx.join('; ') : ''));
  const idx = await page.evaluate(() => window.__idx);
  ok(idx.past === 0 && idx.n === p.picker, 'the "Find Trainee" search covers the same ' + idx.n + ' present-year trainees, ' + idx.past + ' from past years');
  await snap(page, '3-payments.png');
  await page.evaluate(() => { document.getElementById('traineeSearch').value = ''; traineeSearchInput(); });

  /* ---------------- DOCUMENTS ---------------- */
  console.log('\nDOCUMENTS');
  await page.evaluate(() => switchModule('documents')); await page.waitForTimeout(700);
  // Two documents in memory only (not saved): one for a present-year trainee,
  // one for a past-year trainee, uploaded this year.
  await page.evaluate(() => {
    const pres = __presentStudents()[0], past = students.find(s => __stuFY(s) === __PRESENT - 1);
    const today = new Date().toISOString().slice(0, 10);
    documents.push({ id: 'AUD1', studentId: pres.id, studentName: pres.name, type: 'ID Card', fileName: 'present.pdf', size: 1000, uploadDate: today },
                   { id: 'AUD2', studentId: past.id, studentName: past.name, type: 'ID Card', fileName: 'past.pdf', size: 1000, uploadDate: today });
    renderDocumentsTable();
  });
  const dx = await page.evaluate(() => [...document.querySelectorAll('#documentsTableBody tr')].map(r => r.innerText));
  ok(dx.some(t => /present\.pdf/.test(t)) && !dx.some(t => /past\.pdf/.test(t)), 'documents list shows the present-year trainee\u2019s document and not the past-year trainee\u2019s (' + dx.length + ' row)');
  await snap(page, '5-documents.png');
  const dc = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#documentsTableBody tr')].filter(r => r.cells.length > 2);
    // Owners of the documents actually on screen (Student ID is column 3).
    const owners = rows.map(r => students.find(s => s.id === r.cells[2].innerText.trim())).filter(Boolean);
    const sel = [...document.querySelectorAll('#docStudentId option, #filterDocStudent option')].filter(o => o.value).map(o => students.find(x => x.id === o.value)).filter(Boolean);
    return { rows: rows.length, docs: documents.length, pastOwners: owners.filter(o => __stuFY(o) !== __PRESENT).length, sel: sel.length, selPast: sel.filter(x => __stuFY(x) !== __PRESENT).length };
  });
  ok(dc.pastOwners === 0 || dc.rows === 0, 'documents list: ' + dc.rows + ' row(s) on screen of ' + dc.docs + ' documents; ' + dc.pastOwners + ' on screen belong to past-year trainees');
  ok(dc.selPast === 0, 'document student pickers offer present-year trainees only: ' + dc.sel + ' offered, ' + dc.selPast + ' from past years');

  /* ---------------- REPORTS ---------------- */
  console.log('\nREPORTS');
  await page.evaluate(() => switchModule('reports')); await page.waitForTimeout(600);
  for (const t of ['all', 'outstanding', 'fullypaid', 'skillarea']) {
    const r = await page.evaluate(t => {
      document.getElementById('reportType').value = t; generateReport();
      const title = (document.querySelector('#reportOutput h3') || {}).innerText || '';
      const ps = __presentStudents();
      if (t === 'skillarea') {
        const n = [...document.querySelectorAll('#reportOutput h4')].reduce((a, h) => a + (+(/\((\d+) students\)/.exec(h.innerText) || [0, 0])[1]), 0);
        return { title, n, want: ps.length, past: 0 };
      }
      const ids = [...document.querySelectorAll('#reportOutput tbody tr td:first-child')].map(td => td.innerText);
      const rows = ids.map(id => students.find(s => s.id === id)).filter(Boolean);
      const want = t === 'all' ? ps.length : t === 'outstanding' ? ps.filter(s => s.balance > 0).length : ps.filter(feeIsSettled).length;
      return { title, n: rows.length, want, past: rows.filter(s => __stuFY(s) !== __PRESENT).length };
    }, t);
    ok(r.n === r.want && r.past === 0 && r.title.indexOf(present) >= 0, 'report "' + r.title + '": ' + r.n + ' trainees (present-year oracle ' + r.want + '), ' + r.past + ' from past years');
  }
  const rs = await page.evaluate(() => {
    const ps = __presentStudents();
    const exp = ps.reduce((t, s) => t + s.tuitionFee, 0), col = ps.reduce((t, s) => t + s.totalPaid, 0);
    return { shown: ['collectionRate', 'outstandingCount', 'paidCount'].map(id => document.getElementById(id).innerText),
      want: [(exp > 0 ? (col / exp * 100).toFixed(1) : 0) + '%', String(ps.filter(s => s.balance > 0).length), String(ps.filter(feeIsSettled).length)] };
  });
  ok(JSON.stringify(rs.shown) === JSON.stringify(rs.want), 'report cards ' + JSON.stringify(rs.shown) + ' = present-year oracle ' + JSON.stringify(rs.want));

  /* ---------------- ONLY A DELIBERATE TOGGLE SHOWS THE PAST ---------------- */
  console.log('\nDELIBERATE TOGGLE');
  // Saving a trainee whose enrolment date is in a past year.
  await page.evaluate(() => switchModule('students')); await page.waitForTimeout(500);
  const before = await page.evaluate(() => students.length);
  const lastYearDate = await page.evaluate(() => (__PRESENT - 1) + '-11-20');
  for (const v of await page.$$eval('#skillArea option', os => os.map(o => o.value).filter(Boolean))) {
    await page.fill('#studentName', 'Audit Past Trainee'); await page.selectOption('#skillArea', v); await page.fill('#enrollmentDate', lastYearDate);
    await page.evaluate(() => addStudent()); await page.waitForTimeout(300);
    if (await page.evaluate(() => students.length) > before) break;
  }
  const sv = await page.evaluate(() => {
    const t = document.getElementById('feeToastNote');
    const listed = [...document.querySelectorAll('#studentsTableBody tr')].some(r => r.innerText.includes('Audit Past Trainee'));
    return { added: students.some(s => s.name === 'Audit Past Trainee'), fy: feeActiveQuarter().fy, listed, toast: t ? t.innerText.replace(/\s+/g, ' ') : '', btn: t && t.querySelector('button') ? t.querySelector('button').innerText : '' };
  });
  ok(sv.added && sv.fy === present && !sv.listed, 'saving a trainee enrolled ' + lastYearDate + ' keeps the page on FY ' + present + ' and does not list them there');
  ok(/past year/.test(sv.toast) && /^Show FY/.test(sv.btn), 'the confirmation says where they went and offers "' + sv.btn + '": ' + sv.toast.slice(0, 160));
  await snap(page, '4-saved-into-past-year.png');
  await page.click('#feeToastNote button'); await page.waitForTimeout(600);
  const sv2 = await page.evaluate(() => ({ fy: feeActiveQuarter().fy, listed: [...document.querySelectorAll('#studentsTableBody tr')].some(r => r.innerText.includes('Audit Past Trainee')) }));
  ok(sv2.fy !== present && sv2.listed, 'pressing that button is the deliberate step: now FY ' + sv2.fy + ', trainee listed');
  await page.evaluate(() => feeReturnToPresent()); await page.waitForTimeout(400);
  // Another page (e.g. the Cashbook in another tab/iframe) moves the shared year.
  const other = await ctx.newPage();
  await other.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  await other.goto(base + '/README.md');
  await other.evaluate(() => localStorage.setItem('cestis_active_quarter', JSON.stringify({ fy: '2024/2025', q: 2 })));
  await page.waitForTimeout(800);
  await page.evaluate(() => switchModule('dashboard')); await page.waitForTimeout(600);
  const x = await page.evaluate(() => ({ fy: feeActiveQuarter().fy, mode: feeScopeMode, students: document.getElementById('totalStudents').innerText }));
  ok(x.fy === present && x.mode === 'year', 'a year picked on ANOTHER page does not move this dashboard into the past (now FY ' + x.fy + ', ' + x.mode + ', ' + x.students + ' students)');
  await other.close();
  // The user deliberately presses "Previous year" on this page.
  await page.evaluate(() => feeReturnToPresent()); await page.waitForTimeout(300);
  await page.click('#dashboardQuarterBar .fee-qbtn >> nth=0'); await page.waitForTimeout(700); await page.evaluate(() => __clean());
  const y = await page.evaluate(() => ({ fy: feeActiveQuarter().fy, bar: document.querySelector('#dashboardQuarterBar').innerText.replace(/\s+/g, ' '),
    students: +document.getElementById('totalStudents').innerText.replace(/,/g, ''), want: students.filter(s => __stuFY(s) === __PRESENT - 1).length }));
  ok(y.fy !== present && /past/i.test(y.bar) && y.students === y.want, 'pressing "Previous year" shows FY ' + y.fy + ' (' + y.students + ' trainees), flagged PAST with a way back');
  await page.evaluate(() => window.scrollTo(0, 0)); await snap(page, '2-dashboard-previous-year.png');

  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? '\nLEAKS:\n - ' + leaks.join('\n - ') : ''));
  console.log('page errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  await browser.close(); srv.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
