/* Lighter pages for phones, in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/light-pages.js
   - A trainee's sign-in link (index.html#gate=…) does not download the staff
     and board modules (Staff Appraisals, the CMC Board's portal, the
     certificate designs' seed). An office PC still loads them with the page.
   - An administrator signing in on that very page gets them first: the
     dashboard, the appraisal card and the board's portal all work.
   - On such a page a backup merge waits for the appraisals module, so the
     appraisals it carries are kept (never dropped).
   - Transcript-Grades makes its PDFs (jsPDF fetched on first use), and School
     Fee draws its charts and makes its Excel and PDF files (each library
     fetched on first use), with no page errors.
   Outside hosts are cut, as everywhere in these suites. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const Core = require(path.join(ROOT, 'cestis-core.js'));
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const STAFF = /\/(staff-appraisals|cmc-portal|cert-template-seed)\.js/;

(async function main() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8('https://script.google.com/macros/s/FAKE/exec'));

  async function context() {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('cestis_sw_disabled', '1'); } catch (e) {} });
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    return ctx;
  }
  async function open(ctx, rel) {
    const page = await ctx.newPage();
    const errors = [], fetched = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.accept().catch(() => {}));
    page.on('request', r => { if (r.frame() === page.mainFrame()) fetched.push(r.url()); });
    await page.goto(base + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    return { page, errors, fetched };
  }

  console.log('A trainee\'s sign-in link leaves the staff and board modules out; an office PC loads them');
  {
    const ctx = await context();
    const { page, errors, fetched } = await open(ctx, LINK);
    ok(!fetched.some(u => STAFF.test(u)), 'the trainee\'s link fetched none of them (' + fetched.filter(u => STAFF.test(u)).join(', ') + ')');
    ok(await page.evaluate(() => cestisStaffModules.skipped === true && typeof sappCloudExport === 'undefined' && typeof CESTISCmc === 'undefined' && typeof CESTISCertSeed === 'undefined'),
      'and none of them is on the page');
    ok(await page.evaluate(() => !document.querySelector('#studentCard .role-enter-btn').disabled || true), 'the trainee card is there');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    const office = await open(ctx, '/index.html');
    ok(['staff-appraisals', 'cmc-portal', 'cert-template-seed'].every(n => office.fetched.some(u => u.indexOf('/' + n + '.js') !== -1)), 'an office PC (plain address) loads all three with the page');
    ok(await office.page.evaluate(() => cestisStaffModules.skipped === false && typeof sappCloudExport === 'function' && !!window.CESTISCmc && !!window.CESTISCertSeed), 'and they are there before anything runs');
    ok(office.errors.length === 0, 'no page errors — got: ' + office.errors.join(' | '));
    await ctx.close();
  }

  console.log('An administrator signing in on a trainee\'s link gets them first');
  {
    const ctx = await context();
    let { page, errors } = await open(ctx, '/index.html');
    await page.evaluate(async () => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-lp', name: 'Lena Pages', role: 'admin', username: 'lpages', password: await hashPassword('Light-Pages-1!'), status: 'active', updatedAt: new Date().toISOString() });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.close();
    ({ page, errors } = await open(ctx, LINK));
    ok(await page.evaluate(() => cestisStaffModules.skipped === true && typeof sappCloudExport === 'undefined'), 'on the link they are left out');
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(async () => { if (!document.getElementById('adminLogin').classList.contains('active')) await window.handleAdminClick(); });
    // The link opens on the trainee's own card (the staff cards are put away),
    // so the boxes are filled as a member of staff would after opening the card.
    await page.evaluate(async () => {
      document.getElementById('adminUser').value = 'lpages';
      document.getElementById('adminPass').value = 'Light-Pages-1!';
      await window.handleAdminClick();
    });
    await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'admin' && document.getElementById('appShell').classList.contains('active'), null, { timeout: 20000, polling: 100 }).catch(() => {});
    const r = await page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active'),
      sapp: typeof sappCloudExport === 'function' && typeof sappOnPageShow === 'function', cmc: !!window.CESTISCmc, seed: !!window.CESTISCertSeed,
      dueCard: !!document.getElementById('sappAdminDueCard') }));
    ok(r.role === 'admin' && r.shell, 'the administrator\'s dashboard opens');
    ok(r.sapp && r.cmc && r.seed, 'with all three modules fetched first (' + JSON.stringify(r) + ')');
    await page.evaluate(() => showPage('staff-appraisals'));
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => { const p = document.getElementById('page-staff-appraisals'); return !!p && p.innerText.length > 50; }), 'Staff Appraisals opens and draws');
    await page.evaluate(() => showPage('cert-downloads'));
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => { renderCertSeedStatus(); const el = document.getElementById('certSeedStatus');
      return CESTISCertSeed.seedSummary().length > 0 && (!el || (!/not loaded/.test(el.textContent) && !!el.querySelector('table'))); }),
      'the certificate seed is there for the certificate designs');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('On a trainee\'s link, a backup merge waits for the appraisals module and keeps them');
  {
    const ctx = await context();
    const { page, errors } = await open(ctx, LINK);
    const r = await page.evaluate(async () => {
      const before = typeof sappCloudImport;
      const appr = { cycles: { '2026-2027': { 'USR:U1': { cycle: '2026-2027', staffId: 'USR:U1', staffName: 'Garfield Myers', template: 'instructor', s1: { a1: 4 }, s2: {}, s3: {},
        status: 'completed', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z' } } }, assignments: { 'USR:U1': 'instructor' }, extraStaff: [], flags: {} };
      await mergeBackupData({ data: { staffAppraisals: appr } });
      const kept = JSON.parse(CESTISStore.getItem('cestisStaffAppraisals') || '{}');
      return { before, after: typeof sappCloudImport, kept: !!(kept.cycles && kept.cycles['2026-2027'] && kept.cycles['2026-2027']['USR:U1']),
        exported: !!(sappCloudExport() && sappCloudExport().cycles['2026-2027']) };
    });
    ok(r.before === 'undefined' && r.after === 'function', 'the merge fetched the appraisals module first');
    ok(r.kept && r.exported, 'and the appraisals it carried are kept, and go up again with the next backup');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  // The record pages open for a signed-in administrator (as the Centre uses them).
  async function adminContext() {
    const ctx = await context();
    await ctx.addInitScript(() => {
      const now = Date.now();
      let users = [];
      try { users = JSON.parse(localStorage.getItem('voctrain_users') || '[]'); } catch (e) { users = []; }
      if (!users.some(u => u && u.id === 'USR-lp-admin')) {
        users.push({ id: 'USR-lp-admin', name: 'Lena Pages', role: 'admin', username: 'lpadmin', status: 'active', password: 'pbkdf2$1000$00$00' });
        localStorage.setItem('voctrain_users', JSON.stringify(users));
      }
      localStorage.setItem('voctrain_sessionRole', 'admin');
      localStorage.setItem('voctrain_sessionUserId', 'USR-lp-admin');
      localStorage.setItem('voctrain_sessionExpiry', String(now + 3600e3));
      localStorage.setItem('voctrain_sessionSeenAt', String(now));
    });
    return ctx;
  }
  const pdfOk = async dl => { const p = await dl.path(); return !!p && fs.readFileSync(p).slice(0, 5).toString() === '%PDF-'; };

  console.log('Transcript-Grades fetches jsPDF on first use and makes its PDFs');
  {
    const ctx = await adminContext();
    const seed = await ctx.newPage();
    await seed.goto(base + '/index.html', { waitUntil: 'load' });
    await seed.evaluate(() => {
      const roll = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').filter(x => x.id !== 'STU-lp1');
      roll.push({ id: 'STU-lp1', name: 'Petra Pages', course: 'Business Administration', stage: 'training' });
      CESTISStore.setItem('voctrain_students', JSON.stringify(roll));
    });
    await seed.close();
    const { page, errors, fetched } = await open(ctx, '/Transcript-Grades.html');
    ok(!fetched.some(u => /jspdf/.test(u)) && await page.evaluate(() => typeof window.jspdf === 'undefined'), 'the page opens without jsPDF');
    await page.evaluate(() => onPickStudent('STU-lp1'));
    await page.waitForTimeout(300);
    let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.evaluate(() => downloadGradeSheet())]);
    ok(dl && await pdfOk(dl), 'the grade sheet downloads as a PDF (jsPDF fetched for it)');
    ok(await page.evaluate(() => !!(window.jspdf && window.jspdf.jsPDF)), 'jsPDF is now on the page');
    [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.evaluate(() => downloadTranscript())]);
    ok(dl && await pdfOk(dl), 'and the official transcript downloads too');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('School Fee fetches its chart, spreadsheet and PDF libraries on first use');
  {
    const ctx = await adminContext();
    await ctx.addInitScript(data => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      for (const k of Object.keys(data)) if (k !== 'voctrain_users') localStorage.setItem(k, data[k]);
    }, require(path.join(ROOT, 'tests/fixtures/school-fees-backup.json')).data);
    const { page, errors, fetched } = await open(ctx, '/School.Fee.html');
    await page.evaluate(() => { const b = document.getElementById('activateWindowBtn'); if (b && b.offsetParent) b.click(); });
    ok(!fetched.some(u => /xlsx|jspdf/.test(u)), 'the page opens without the spreadsheet and PDF libraries');
    await page.evaluate(() => switchModule('dashboard'));
    await page.waitForFunction(() => !!window.Chart && typeof collectionChart !== 'undefined' && !!collectionChart, null, { timeout: 20000, polling: 100 }).catch(() => {});
    ok(await page.evaluate(() => !!window.Chart && !!collectionChart && !!trendChart), 'the dashboard\'s two charts are drawn once Chart arrives');
    let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.evaluate(() => exportAllData('students'))]);
    ok(dl && /\.xlsx$/.test(dl.suggestedFilename()) && fs.readFileSync(await dl.path()).slice(0, 2).toString() === 'PK', 'Export All Students downloads a spreadsheet (XLSX fetched for it)');
    await page.evaluate(() => switchModule('reports'));
    [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.evaluate(() => exportReportToPDF())]);
    ok(dl && await pdfOk(dl), 'the report downloads as a PDF (jsPDF and its table plug-in fetched for it)');
    const pay = await page.evaluate(() => { const p = payments[0]; const s = p && students.find(x => x.id === p.studentId); return p && s ? [p.id, s.id] : null; });
    if (pay) {
      [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
        page.evaluate(ids => { const p = payments.find(x => x.id === ids[0]); generateReceipt(p, students.find(x => x.id === ids[1])); }, pay)]);
      ok(dl && await pdfOk(dl), 'a payment receipt downloads as a PDF');
    } else ok(false, 'the fixture has a payment to make a receipt for');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
