/* The requested certificate, opened by the Administrator, in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ctr-certificate.js

   On Certificate / Transcript Requests, a trainee's request for a certificate
   now has "Open certificate" next to "Open transcript" — for the
   Administrator only, and only once the trainee is certified. It opens a page
   with who the certificate is for, its number, date, download approval and
   collection, both pages of the certificate as the trainee's copy draws them,
   and the office's own copy to print (not counted as the trainee's download).
   A trainee with a number left on the record but still in training gets no
   button and no certificate. Screenshots in light and dark go to
   CESTIS_SHOTS (default: tests/browser/shots-ctr-certificate).

   Kept out of `npm test` because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_SHOTS || path.join(__dirname, 'shots-ctr-certificate');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  return new Promise((resolve) => {
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

(async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1300);

  async function signIn(role, username, name) {
    await page.evaluate(async (o) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]').filter(u => u.username !== o.username);
      users.push({ id: 'USR-' + o.username, name: o.name, role: o.role, username: o.username, password: await hashPassword('S0me-Real-Pass!'), status: 'active', updatedAt: new Date().toISOString() });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, { role, username, name });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    if (role === 'admin') {
      await page.evaluate(async () => { if (!document.getElementById('adminLogin').classList.contains('active')) await window.handleAdminClick(); });
      await page.fill('#adminUser', username); await page.fill('#adminPass', 'S0me-Real-Pass!');
      await page.evaluate(async () => { await window.handleAdminClick(); });
    } else {
      await page.evaluate(async (u) => { await doLogin('adminstaff', u, 'S0me-Real-Pass!'); }, username).catch(() => {});
    }
    await page.waitForTimeout(900);
    return page.evaluate(() => currentRole);
  }

  ok(await signIn('admin', 'realadmin', 'Real Admin') === 'admin', 'the Administrator is signed in');

  // Two trainees asking for a certificate: one certified, one still in
  // training with a number left on his record. The programme's design.
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1123; c.height = 794;
    const g = c.getContext('2d'); g.fillStyle = '#fdf8ec'; g.fillRect(0, 0, 1123, 794);
    g.strokeStyle = '#8a6d1d'; g.lineWidth = 18; g.strokeRect(20, 20, 1083, 754);
    g.fillStyle = '#8a6d1d'; g.font = 'bold 40px serif'; g.textAlign = 'center'; g.fillText('CERTIFICATE OF COMPETENCE', 561, 140);
    const bg = c.toDataURL('image/jpeg', 0.9);
    const prog = 'Welding & Fabrication';
    const key = getCertTemplateKey(prog) || prog;
    certTemplates[key] = Object.assign({}, certTemplates[key] || {}, { bgPage1: bg, bgPage2: bg, courseFullName: 'Welding and Fabrication Level 2',
      modules: [{ code: 'WELD001', title: 'Apply safe work practices' }, { code: 'WELD002', title: 'Weld using SMAW' }] });
    const now = new Date().toISOString();
    students.push({ id: 'STU-ctr1', name: 'Shanice Campbell', course: prog, stage: 'certified', certNo: 'WF-2026-4821-QX', certDate: 'October 16, 2026', progress: 90, lastModified: now });
    students.push({ id: 'STU-ctr2', name: 'Steve Barrett', course: prog, stage: 'training', certNo: 'WF-2026-1111-ZZ', progress: 10, lastModified: now });
    certDownloadApprovals.push({ id: 'CDA-STU-ctr1', studentId: 'STU-ctr1', name: 'Shanice Campbell', course: prog, certNo: 'WF-2026-4821-QX', approved: true, approvedDate: now, approvedBy: 'Real Admin', downloadCount: 1 });
    const reqs = [
      { id: 'CTR-1', studentId: 'STU-ctr1', studentName: 'Shanice Campbell', course: prog, type: 'both', status: 'pending', requestedAt: now },
      { id: 'CTR-2', studentId: 'STU-ctr2', studentName: 'Steve Barrett', course: prog, type: 'certificate', status: 'pending', requestedAt: now }
    ];
    CESTISStore.setItem('voctrain_certTranscriptRequests', JSON.stringify(reqs));
    saveState();
  });

  await page.evaluate(() => showPage('cert-transcript-requests'));
  const frame = () => page.frame({ url: /Cert-Transcript-Requests\.html/ });
  for (let i = 0; i < 30 && !(frame() && await frame().$('text=Shanice Campbell')); i++) await page.waitForTimeout(300);
  const f = frame();
  ok(!!f, 'the requests page is open');
  const rowText = async name => f.evaluate(n => { const tr = Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent.indexOf(n) !== -1); return tr ? tr.innerText : ''; }, name);
  ok(/Open certificate/.test(await rowText('Shanice Campbell')), 'a certified trainee\'s request: Open certificate, beside Open transcript');
  ok(!/Open certificate/.test(await rowText('Steve Barrett')), 'a trainee still in training (a number left on his record): no Open certificate');
  ok(/Certify/.test(await rowText('Steve Barrett')), '(he gets Certify instead)');
  await page.screenshot({ path: path.join(SHOTS, 'requests-light.png') });

  await f.evaluate(() => { const tr = Array.from(document.querySelectorAll('tbody tr')).find(r => r.textContent.indexOf('Shanice Campbell') !== -1); tr.querySelector('button[onclick*="certificate"]').click(); });
  for (let i = 0; i < 30 && !(await page.evaluate(() => document.querySelectorAll('#ctrCertPreview img').length >= 2)); i++) await page.waitForTimeout(300);
  const view = await page.evaluate(() => ({ active: document.getElementById('page-ctr-certificate').classList.contains('active'), text: document.getElementById('ctrCertView').innerText, imgs: document.querySelectorAll('#ctrCertPreview img').length }));
  ok(view.active, 'Open certificate opens the Requested Certificate page');
  ok(/Shanice Campbell/.test(view.text) && /WF-2026-4821-QX/.test(view.text) && /October 16, 2026/.test(view.text), 'with her name, the certificate number and the date certified');
  ok(/Approved/.test(view.text) && /Downloads: 1/.test(view.text) && /Not yet/.test(view.text), 'whether her download is approved (and how often she downloaded it) and whether it was collected');
  ok(view.imgs === 2, 'and both pages of the certificate, drawn as her copy is');
  const theme = async t => { await page.evaluate(x => { if (x === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); window.scrollTo(0, 0); }, t); await page.waitForTimeout(300); };
  await theme('light');
  await page.screenshot({ path: path.join(SHOTS, 'certificate-light.png'), fullPage: true });
  await theme('dark');
  await page.screenshot({ path: path.join(SHOTS, 'certificate-dark.png'), fullPage: true });

  // The office copy: a PDF, and the trainee's own count does not move.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Download office copy (PDF)")')
  ]);
  ok(!!dl && /Certificate_Shanice_Campbell_WF-2026-4821-QX\.pdf/.test(dl.suggestedFilename()), 'Download office copy gives the certificate PDF');
  ok(await page.evaluate(() => certDownloadApprovals.find(d => d.studentId === 'STU-ctr1').downloadCount) === 1, 'and it is not counted as her download');

  // Opened for a trainee who is not certified: no certificate, and the way to certify.
  await page.evaluate(() => { renderCtrCertificate('STU-ctr2'); showPage('ctr-certificate'); });
  const none = await page.evaluate(() => ({ text: document.getElementById('ctrCertView').innerText, preview: !!document.querySelector('#ctrCertPreview') }));
  ok(/not marked Certified/.test(none.text) && /Certify in Student Progress/.test(none.text) && !none.preview, 'for a trainee still in training: no certificate, it says why, and offers Certify');
  await theme('light');
  await page.screenshot({ path: path.join(SHOTS, 'not-certified-light.png') });
  await theme('dark');
  await page.screenshot({ path: path.join(SHOTS, 'not-certified-dark.png') });
  await page.evaluate(() => showPage('cert-transcript-requests'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'requests-dark.png') });

  // Only the Administrator: Admin Staff never open one.
  const staffRefused = await page.evaluate(() => { const was = currentRole; currentRole = 'adminstaff'; let msg = ''; const t = window.showToast; window.showToast = m => { msg = m; }; ctrOpenFor('certificate', 'STU-ctr1'); renderCtrCertificate('STU-ctr1'); window.showToast = t; currentRole = was; return { msg, empty: document.getElementById('ctrCertView').innerHTML === '' }; });
  ok(/Only the Administrator/.test(staffRefused.msg) && staffRefused.empty, 'Admin Staff cannot open a certificate');

  ok(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
  await browser.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
