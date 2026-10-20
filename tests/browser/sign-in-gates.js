/* Sign-in gates, in a real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/sign-in-gates.js
   Drives the real index.html and record pages in headless Chromium with the
   network to the outside world cut, the way a stranger at a lab PC would:
     - the published default password: on a device holding a real
       administrator it opens nothing; on a brand-new device it only leads to
       "set a new password", after which the person is in (accounts-01);
     - the record pages opened by their bare address with no session show
       only "sign in first" and raise no errors; inside a signed-in
       administrator's session they work (ui-14, transcripts-01, accounts-06,
       admin-12, sync#3);
     - Ctrl+Shift+E downloads nothing for a trainee and a backup for a signed-in
       administrator (accounts-12).
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
  async function fresh() {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    return ctx;
  }
  async function open(ctx, rel) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return { page, errors };
  }
  // kind: 'admin' (the Administrator card) or 'adminStaff' (the Admin Staff card).
  async function signIn(page, user, pass, kind) {
    kind = kind || 'admin';
    const handler = kind === 'admin' ? 'handleAdminClick' : 'handleAdminStaffClick';
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(async (h) => { if (!document.getElementById(h === 'handleAdminClick' ? 'adminLogin' : 'adminStaffLogin').classList.contains('active')) await window[h](); }, handler);
    await page.fill('#' + kind + 'User', user); await page.fill('#' + kind + 'Pass', pass);
    await page.evaluate(async (h) => { await window[h](); }, handler);
    await page.waitForTimeout(700);
    return page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active'),
      forced: document.getElementById('forceChangePwModal').classList.contains('active') }));
  }

  console.log('The published default password opens nothing by itself');
  {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    let r = await signIn(page, 'cestisadmin', 'cestisadmin123$');
    ok(!r.shell && r.role === null && r.forced, 'brand-new device: the default only opens "set a new password"');
    await page.fill('#forceChangePwNew', 'cestisadmin123$'); await page.fill('#forceChangePwConfirm', 'cestisadmin123$');
    await page.evaluate(async () => { await forceChangePwSubmit(); });
    r = await page.evaluate(() => ({ shell: document.getElementById('appShell').classList.contains('active') }));
    ok(!r.shell, 'the published default cannot be chosen again as the "new" password');
    await page.fill('#forceChangePwNew', 'Centre-First-Run-1'); await page.fill('#forceChangePwConfirm', 'Centre-First-Run-1');
    await page.evaluate(async () => { await forceChangePwSubmit(); });
    await page.waitForTimeout(700);
    r = await page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active'),
      seed: (userAccounts.find(u => u.id === 'USR-001') || {}).defaultPassword }));
    ok(r.shell && r.role === 'admin' && r.seed === undefined, 'after setting a real password the administrator is in, and the account is no longer a seed');
    await ctx.close();
  }
  {
    const ctx = await fresh();
    let { page } = await open(ctx, 'index.html');
    await page.evaluate(async () => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-real', name: 'Real Admin', role: 'admin', username: 'realadmin', password: await hashPassword('S0me-Real-Pass!'), status: 'active', updatedAt: new Date().toISOString() });
      users.push({ id: 'USR-stu', name: 'Stu Dent', role: 'student', username: 'stu', password: await hashPassword('Stu-Pass-12'), status: 'active', programme: 'Plumbing' });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    let r = await signIn(page, 'cestisadmin', 'cestisadmin123$');
    ok(!r.shell && r.role === null && !r.forced, 'a device holding a real administrator: the default opens nothing at all');
    r = await signIn(page, 'adminstaff', 'cestisadmin123$', 'adminStaff');
    ok(!r.shell && r.role === null && !r.forced, 'nor the Admin Staff login');
    r = await signIn(page, 'realadmin', 'S0me-Real-Pass!');
    ok(r.shell && r.role === 'admin', 'the real administrator signs in as before');

    console.log('Inside a signed-in session the record pages work');
    const keys = await page.evaluate(() => ({ role: CESTISStore.getItem('voctrain_sessionRole'), beat: !!CESTISStore.getItem('voctrain_sessionSeenAt') }));
    ok(keys.role === 'admin' && keys.beat, 'the session and its heartbeat are written for the record pages');
    let o = await open(ctx, 'Transcript-Grades.html');
    ok(await o.page.evaluate(() => VIEWER.ok && ROLE === 'admin' && !/sign in/i.test(document.getElementById('tgApp').textContent)), 'Transcript-Grades opens the editor for the signed-in administrator');
    ok(o.errors.length === 0, 'with no page errors — got: ' + o.errors.join(' | '));
    o = await open(ctx, 'Transcript-Grades.html?role=student&studentId=STU-x');
    ok(await o.page.evaluate(() => ROLE === 'student' && MY_STUDENT_ID === 'STU-x'), 'an administrator may narrow to preview a trainee');
    o = await open(ctx, 'Student-Progress.html');
    ok(await o.page.evaluate(() => SP_VIEWER.ok && spCanManage() && document.getElementById('spAddStudentBtn').style.display !== 'none'), 'Student Progress opens with its controls for the administrator');
    ok(o.errors.length === 0, 'with no page errors — got: ' + o.errors.join(' | '));
    o = await open(ctx, 'Cert-Transcript-Requests.html');
    ok(await o.page.evaluate(() => VIEWER.ok && !/sign in/i.test(document.getElementById('crRows').textContent)), 'the request queue opens for the administrator');

    // Embedded in the dashboard, as the Centre actually uses them.
    await page.evaluate(() => { showPage('students'); });
    await page.waitForTimeout(1800);
    const emb = await page.evaluate(() => {
      const f = document.getElementById('studentProgressFrame');
      const w = f && f.contentWindow;
      return { ok: !!(w && w.SP_VIEWER && w.SP_VIEWER.ok), manage: !!(w && w.spCanManage && w.spCanManage()) };
    });
    ok(emb.ok && emb.manage, 'Student Progress embedded in the administrator\'s dashboard takes the dashboard\'s session');
    await page.evaluate(() => { showPage('transcript-grades'); });
    await page.waitForTimeout(1800);
    const embTg = await page.evaluate(() => {
      const w = document.getElementById('transcriptGradesFrame').contentWindow;
      return w && w.VIEWER ? w.VIEWER.ok + '/' + w.ROLE : 'none';
    });
    ok(embTg === 'true/admin', 'and so does Transcript-Grades (got ' + embTg + ')');

    console.log('Ctrl+Shift+E is an administrator\'s');
    let got = null;
    page.once('download', d => { got = d.suggestedFilename(); });
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(800);
    ok(!!got && /^CESTIS_Backup_/.test(got), 'a signed-in administrator gets the backup file');
    // A trainee's session on the same device.
    await page.evaluate(() => { currentRole = 'student'; currentLoggedInUser = userAccounts.find(u => u.id === 'USR-stu'); });
    got = null;
    page.once('download', d => { got = d.suggestedFilename(); });
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(800);
    ok(got === null, 'a trainee pressing it downloads nothing');
    await ctx.close();
  }

  console.log('A trainee\'s embedded transcript page shows their own record');
  {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    await page.evaluate(async () => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-stu', name: 'Stu Dent', role: 'student', username: 'stu', password: await hashPassword('Stu-Pass-12'), status: 'active', programme: 'Plumbing' });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(async () => { await handleStudentClick(); });
    await page.fill('#studentUser', 'stu'); await page.fill('#studentPass', 'Stu-Pass-12');
    await page.evaluate(async () => { await handleStudentClick(); });
    await page.waitForTimeout(800);
    const me = await page.evaluate(() => ({ role: currentRole, id: currentStudent && currentStudent.id }));
    ok(me.role === 'student' && !!me.id, 'the trainee signs in');
    await page.evaluate(() => { showPage('s-transcript-grades'); });
    await page.waitForTimeout(1800);
    const tg = await page.evaluate(() => {
      const w = document.getElementById('sTranscriptGradesFrame').contentWindow;
      return w && w.VIEWER ? { role: w.ROLE, sid: w.MY_STUDENT_ID } : null;
    });
    ok(tg && tg.role === 'student' && tg.sid === me.id, 'the embedded Transcript-Grades shows the trainee\'s own record, as a trainee');
    let got = null;
    page.once('download', d => { got = d.suggestedFilename(); });
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(800);
    ok(got === null, 'and Ctrl+Shift+E in a real trainee session downloads nothing');
    await ctx.close();
  }

  console.log('Opened by their address with no session, the record pages show only "sign in first"');
  {
    const ctx = await fresh();
    for (const rel of ['Transcript-Grades.html', 'Transcript-Grades.html?role=admin', 'Cert-Transcript-Requests.html', 'Student-Progress.html', 'Staff.Clock.in.html']) {
      const o = await open(ctx, rel);
      const s = await o.page.evaluate(() => ({ text: document.body.innerText,
        tg: typeof renderAdmin === 'function' && !!document.querySelector('#tgApp select'),
        clockUser: typeof currentUser !== 'undefined' ? currentUser : 'n/a' }));
      ok(/sign in to the C\.E\.S\.T\.I\.S dashboard first/i.test(s.text), rel + ': tells the visitor to sign in first');
      ok(!s.tg, rel + ': no editor is rendered');
      if (rel === 'Staff.Clock.in.html') ok(s.clockUser === null, rel + ': nobody is signed in to the time clock');
      ok(o.errors.length === 0, rel + ': no page errors — got: ' + o.errors.join(' | '));
    }
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
