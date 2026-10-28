/* Transcript and Student Progress, in a real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/transcripts-admin.js
   Signs in a real administrator on the real index.html, then drives the real
   Transcript-Grades.html and Student-Progress.html in headless Chromium:
     - typed grades in other rows survive saving one row (transcripts-11);
     - the official preview prints Core/Elective under that heading and
       "Awaiting marking" for an exam still being marked (transcripts-16, -08);
     - a unit with no code cannot be "saved" (transcripts-13);
     - Student Progress deletes the trainee the modal named after the roll is
       reordered underneath it (admin-03);
     - no page errors throughout.
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } }
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
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  async function open(rel) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return { page, errors };
  }

  // A real administrator, signed in.
  const dash = (await open('index.html')).page;
  await dash.evaluate(async () => {
    const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
    users.push({ id: 'USR-real', name: 'Real Admin', role: 'admin', username: 'realadmin', password: await hashPassword('S0me-Real-Pass!'), status: 'active', updatedAt: new Date().toISOString() });
    CESTISStore.setItem('voctrain_users', JSON.stringify(users));
  });
  await dash.reload({ waitUntil: 'load' }); await dash.waitForTimeout(1300);
  await dash.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
  await dash.evaluate(async () => { if (!document.getElementById('adminLogin').classList.contains('active')) await window.handleAdminClick(); });
  await dash.fill('#adminUser', 'realadmin'); await dash.fill('#adminPass', 'S0me-Real-Pass!');
  await dash.evaluate(async () => { await window.handleAdminClick(); });
  await dash.waitForTimeout(800);
  ok(await dash.evaluate(() => currentRole === 'admin'), 'the administrator is signed in');

  // A trainee on the seeded Business Administration plan, one exam awaiting marking.
  await dash.evaluate(() => {
    const T = CESTISCore.Transcript;
    const q = T.seedCatalogs().filter(x => x.id === 'QUAL-BAM-L5')[0];
    const s = { id: 'STU-tx1', name: 'Tia Transcript', course: 'Business Administration', stage: 'training' };
    const roll = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').filter(x => x.id !== s.id);
    roll.push(s);
    CESTISStore.setItem('voctrain_students', JSON.stringify(roll));
    const ex = JSON.parse(CESTISStore.getItem('voctrain_exams') || '[]');
    ex.push({ id: 'EX-tx1', title: q.units[0].code + ' final', course: 'Business Administration', passMark: 60 });
    CESTISStore.setItem('voctrain_exams', JSON.stringify(ex));
    const rs = JSON.parse(CESTISStore.getItem('voctrain_examResults') || '[]');
    rs.push({ id: 'RS-tx1', examId: 'EX-tx1', studentId: s.id, score: 40, needsReview: true, reviewComplete: false, submittedAt: new Date().toISOString() });
    CESTISStore.setItem('voctrain_examResults', JSON.stringify(rs));
  });

  console.log('The Transcript page keeps typed work and prints the right columns');
  {
    const { page, errors } = await open('Transcript-Grades.html');
    await page.evaluate(() => { onPickStudent('STU-tx1'); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => sel.qualId === 'QUAL-BAM-L5'), 'the trainee\'s own plan is picked');
    await page.fill('#tgg-1', '77'); await page.fill('#tgg-2', '66'); await page.fill('#tgg-3', 'Competent');
    await page.evaluate(() => saveUnitGrade(1));
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById('tgg-2').value === '66' && document.getElementById('tgg-3').value === 'Competent'),
      'saving one row leaves the other typed rows as they were');
    await page.evaluate(() => { loadAll(); renderForRole(); });
    ok(await page.evaluate(() => document.getElementById('tgg-2').value === '66'), 'and so does the page refreshing itself');
    const preview = await page.evaluate(() => {
      const cells = document.querySelectorAll('#tgPreview .tr-units tr:nth-child(2) td');
      return cells.length ? [cells[2].textContent, cells[3].textContent] : null;
    });
    ok(preview && preview[0] === 'Core' && preview[1] === 'Awaiting marking', 'the official preview prints Core/Elective and "Awaiting marking" (got ' + JSON.stringify(preview) + ')');
    await page.evaluate(() => saveAllChangedGrades());
    const g = await page.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_transcriptGrades') || '[]').filter(x => x.studentId === 'STU-tx1').map(x => x.grade).sort());
    ok(JSON.stringify(g) === JSON.stringify([66, 77, 'Competent'].sort()), 'Save all stores every changed row (got ' + JSON.stringify(g) + ')');
    // A unit with no code cannot be graded.
    await page.evaluate(() => { const q = qualById('QUAL-BAM-L5'); q.units.unshift({ code: '', name: 'Site induction' }); renderGradeRows(); });
    await page.fill('#tgg-0', '88');
    ok(await page.evaluate(() => saveUnitGrade(0) === false), 'a unit with no code is not "saved"');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
  }

  console.log('Student Progress deletes the trainee the modal named');
  {
    await dash.evaluate(() => {
      const roll = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').filter(x => !/^Del /.test(x.name));
      ['Del Alpha', 'Del Bravo', 'Del Charlie'].forEach(n => roll.push({ id: CESTISCore.stableStudentId({ name: n, course: 'Plumbing' }), name: n, course: 'Plumbing', stage: 'training' }));
      CESTISStore.setItem('voctrain_students', JSON.stringify(roll));
    });
    const { page, errors } = await open('Student-Progress.html');
    const charlie = await page.evaluate(() => students.filter(s => s.name === 'Del Charlie')[0].id);
    await page.evaluate(id => openDeleteStudent(id), charlie);
    await page.evaluate(() => { students.unshift({ id: 'STU-new-top', name: 'Newcomer', course: 'Plumbing' }); });
    await page.evaluate(() => confirmDeleteStudent());
    await page.waitForTimeout(200);
    const names = await page.evaluate(() => students.map(s => s.name));
    ok(names.indexOf('Del Charlie') === -1 && names.indexOf('Del Bravo') !== -1 && names.indexOf('Del Alpha') !== -1, 'the named trainee went and nobody else did');
    ok(await page.evaluate(id => JSON.parse(CESTISStore.getItem('voctrain_deletedStudentIds') || '[]').indexOf(id) !== -1, charlie), 'and only their id is tombstoned');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
  }

  await browser.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
