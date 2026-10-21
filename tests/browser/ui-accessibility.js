/* Keyboard, dialogs, messages, phone widths and the offline copy, in a real
   browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ui-accessibility.js
   Drives the real index.html and its record pages in headless Chromium with
   the outside world cut off:
     - a first visit raises no "Storage quota may be full" warning (ui-11);
     - Enter in a password field signs in; every sign-in field has its label
       and its autocomplete hint (ui-08);
     - the sidebar, its section toggles and the dashboard tiles are reached
       with Tab and work with Enter; the shell is not an "application" (ui-06);
     - a dialog takes focus, says it is a dialog, and gives focus back when
       Escape closes it (ui-19);
     - a 20-line alert keeps its lines and its OK button is on a phone's
       screen; toasts are readable and an error stays (ui-09, ui-10);
     - Student Progress does not pan sideways on a phone, and a trainee's
       transcript table scrolls inside its card (ui-18);
     - the LIVE badge appears only while a class is live (ui-17);
     - the service worker installs, the dashboard opens with the network cut,
       and the sw-disable file removes it again (ui-15).
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml' };
let killSwitch = false;
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/sw-disable') {
        if (killSwitch) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('off'); }
        res.writeHead(404); return res.end('nope');
      }
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function lum(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function rgbOf(s) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : null; }

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  async function fresh(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {}));
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    return ctx;
  }
  async function open(ctx, rel) {
    const page = await ctx.newPage();
    const errors = [], logs = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('console', m => logs.push(m.text()));
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return { page, errors, logs };
  }
  async function seedAdmin(page) {
    await page.evaluate(async () => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-real', name: 'Real Admin', role: 'admin', username: 'realadmin', password: await hashPassword('S0me-Real-Pass!'), status: 'active', updatedAt: new Date().toISOString() });
      users.push({ id: 'USR-stu', name: 'Stu Dent', role: 'student', username: 'stu', password: await hashPassword('Stu-Pass-12'), status: 'active', programme: 'Plumbing' });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
  }

  console.log('A first visit raises no storage warning and no errors');
  {
    const ctx = await fresh();
    const { page, errors, logs } = await open(ctx, 'index.html');
    const toasts = await page.evaluate(() => document.getElementById('toastContainer').innerText);
    ok(!/quota/i.test(toasts), 'no "Storage quota may be full" toast on a clean device — got: ' + JSON.stringify(toasts));
    ok(!logs.some(l => /saveState: a save stopped part-way/.test(l)), 'and no save stopped part-way while the page started');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    const shell = await page.evaluate(() => ({ role: document.getElementById('appShell').getAttribute('role'),
      menubar: document.getElementById('sidebarNav').getAttribute('role') }));
    ok(shell.role === null && shell.menubar === null, 'the shell is not an "application" and the sidebar is not a menubar');

    console.log('The big libraries arrive when first needed, from this site');
    const libs = await page.evaluate(() => ({ pdf: typeof pdfjsLib, mammoth: typeof mammoth, chart: typeof Chart, jspdf: typeof jspdf,
      otp: typeof OTPAuth, qr: typeof QRCode, mail: typeof emailjs }));
    ok(libs.pdf === 'undefined' && libs.mammoth === 'undefined' && libs.chart === 'undefined' && libs.jspdf === 'undefined',
      'the sign-in screen loads none of pdf.js, mammoth, Chart or jsPDF (' + JSON.stringify(libs) + ')');
    ok(libs.otp === 'object' && libs.qr === 'function' && libs.mail === 'object', 'the two-step and e-mail libraries are there (deferred)');
    const got = await page.evaluate(async () => {
      await Promise.all([cestisNeedLib('pdfjsLib'), cestisNeedLib('mammoth'), cestisNeedLib('Chart'), cestisNeedLib('jspdf')]);
      return { pdf: !!window.pdfjsLib && pdfjsLib.GlobalWorkerOptions.workerSrc, mammoth: !!window.mammoth, chart: typeof Chart, jspdf: !!(window.jspdf && jspdf.jsPDF),
        scripts: Array.prototype.map.call(document.querySelectorAll('script[src*="vendor/"]'), s => s.getAttribute('src')) };
    });
    ok(got.pdf === 'vendor/pdf.worker-3.11.174.min.js' && got.mammoth && got.chart === 'function' && got.jspdf,
      'asked for, each one loads from this site (and pdf.js gets its local worker): ' + JSON.stringify(got));
    ok(errors.length === 0, 'still no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('Sign-in is a real form: labels, autocomplete, Enter signs in');
  {
    const ctx = await fresh();
    const { page, errors } = await open(ctx, 'index.html');
    await seedAdmin(page);
    const labels = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.role-login input'), i => ({
      id: i.id, label: !!(i.labels && i.labels.length), form: !!i.form,
      ac: i.getAttribute('autocomplete') })));
    ok(labels.length >= 10 && labels.every(l => l.label), 'every sign-in field is named by its label (' + labels.filter(l => !l.label).map(l => l.id).join(',') + ')');
    ok(labels.every(l => l.form), 'and sits in a form');
    ok(labels.filter(l => /Pass$/.test(l.id)).every(l => l.ac === 'current-password') &&
       labels.filter(l => /User$/.test(l.id)).every(l => l.ac === 'username'), 'username / current-password hints for password managers');
    // Keyboard only: Tab to the Admin button, Enter reveals, type, Enter signs in.
    await page.focus('#adminCard .role-enter-btn');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const revealed = await page.evaluate(() => document.getElementById('adminLogin').classList.contains('active') && document.activeElement && document.activeElement.id);
    ok(revealed === 'adminUser', 'Enter on "Enter as Admin" opens the fields and puts the cursor in the username (got ' + revealed + ')');
    await page.keyboard.type('realadmin');
    await page.keyboard.press('Tab');
    await page.keyboard.type('S0me-Real-Pass!');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active') }));
    ok(r.role === 'admin' && r.shell, 'Enter in the password field signs the administrator in');

    console.log('The sidebar and the dashboard work from the keyboard');
    const nav = await page.evaluate(() => {
      const items = Array.prototype.slice.call(document.querySelectorAll('#sidebarNav .nav-item'));
      return { total: items.length, focusable: items.filter(i => i.tabIndex >= 0).length,
        links: items.filter(i => i.getAttribute('role') === 'link').length,
        current: (document.querySelector('#sidebarNav [aria-current="page"]') || {}).textContent || '' };
    });
    ok(nav.total > 20 && nav.focusable === nav.total, 'every sidebar entry has a Tab stop (' + nav.focusable + '/' + nav.total + ')');
    ok(nav.links === nav.total, 'and is announced as a link');
    // Real Tab presses reach well past the seven controls the topbar has.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const k = await page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('data-page') || a.tagName + ':' + (a.textContent || '').trim().slice(0, 30)) : ''; });
      seen.add(k);
    }
    ok(seen.size >= 20 && seen.has('students') && seen.has('settings'), 'sixty presses of Tab visit ' + seen.size + ' different controls, sidebar entries included (was 7)');
    // Open a collapsed section with Enter, then go to a page with Enter.
    const toggle = await page.evaluate(() => {
      const t = Array.prototype.find.call(document.querySelectorAll('#sidebarNav .nav-section-toggle'), x => x.classList.contains('collapsed'));
      if (!t) return null;
      t.focus();
      return { expanded: t.getAttribute('aria-expanded'), role: t.getAttribute('role') };
    });
    ok(toggle && toggle.expanded === 'false' && toggle.role === 'button', 'a collapsed section toggle is a button that says it is collapsed');
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => document.activeElement.getAttribute('aria-expanded') + '/' + document.activeElement.classList.contains('collapsed'));
    ok(after === 'true/false', 'Enter opens it and it says so (got ' + after + ')');
    await page.focus('#sidebarNav .nav-item[data-page="announcements"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const pg = await page.evaluate(() => ({ title: document.getElementById('topbarTitle').textContent,
      cur: document.querySelector('#sidebarNav .nav-item[data-page="announcements"]').getAttribute('aria-current') }));
    ok(/Announcements/.test(pg.title) && pg.cur === 'page', 'Enter on a sidebar entry opens that page and marks it current');

    console.log('A dialog takes focus and gives it back');
    await page.evaluate(() => showPage('dashboard'));
    await page.waitForTimeout(300);
    const tile = await page.evaluate(() => {
      const t = Array.prototype.find.call(document.querySelectorAll('.quick-action-btn'), x => /Create Exam/.test(x.textContent));
      if (!t) return null; t.focus(); return { role: t.getAttribute('role'), tab: t.tabIndex };
    });
    ok(tile && tile.role === 'button' && tile.tab === 0, 'a dashboard tile is a focusable button');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const dlg = await page.evaluate(() => {
      const ov = document.getElementById('createExamModal');
      const box = ov.querySelector('.modal');
      return { open: ov.classList.contains('active'), role: box.getAttribute('role'), modal: box.getAttribute('aria-modal'),
        named: !!box.getAttribute('aria-labelledby') && !!document.getElementById(box.getAttribute('aria-labelledby')),
        inside: ov.contains(document.activeElement) };
    });
    ok(dlg.open, 'Enter on the tile opens Create Exam');
    ok(dlg.role === 'dialog' && dlg.modal === 'true' && dlg.named, 'the box is a named, modal dialog');
    ok(dlg.inside, 'focus moved into the dialog');
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    ok(await page.evaluate(() => document.getElementById('createExamModal').contains(document.activeElement)), 'Tab stays inside the dialog');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ open: document.getElementById('createExamModal').classList.contains('active'),
      focus: document.activeElement && /Create Exam/.test(document.activeElement.textContent || '') && document.activeElement.classList.contains('quick-action-btn') }));
    ok(!back.open && back.focus, 'Escape closes it and focus is back on the tile that opened it');

    console.log('Messages are readable; an error stays');
    await page.evaluate(() => { showToast('Saved', ''); showToast('Could not reach Drive', 'error'); showToast('Heads up', 'warning'); showToast('FYI', 'info'); });
    const tc = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#toastContainer .toast'), t => {
      const cs = getComputedStyle(t); return { cls: t.className, color: cs.color, bg: cs.backgroundColor, role: t.getAttribute('role') };
    }));
    const bad = tc.filter(t => { const c = rgbOf(t.color), b = rgbOf(t.bg); return !c || !b || ratio(c, b) < 4.5; });
    ok(tc.length === 4 && bad.length === 0, 'every toast reads at 4.5:1 or better — failing: ' + JSON.stringify(bad));
    ok(tc.find(t => /toast-error/.test(t.cls)).role === 'alert' && tc.filter(t => t.role === 'status').length === 3, 'an error is an alert, the rest are status messages');
    await page.waitForTimeout(5000);
    const left = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('#toastContainer .toast'), t => !t.classList.contains('toast-leaving')).map(t => t.textContent));
    ok(left.some(t => /Could not reach Drive/.test(t)) && !left.some(t => /Saved/.test(t)), 'five seconds later the error is still there, the success has gone');
    await page.click('#toastContainer .toast-error .toast-close');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.querySelector('#toastContainer .toast-error')), 'its close button dismisses it');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('A long alert on a phone keeps its lines and its OK button');
  {
    const ctx = await fresh({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const { page } = await open(ctx, 'index.html');
    await page.evaluate(() => {
      const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'opener'; document.body.appendChild(b); b.focus();
      const lines = ['✅ Backup Files in Google Drive:']; for (let i = 1; i <= 20; i++) lines.push(i + '. voctrain_backup_2026-10-' + (10 + i) + '.json  Modified: 10/16/2026  Size: 3.42 MB');
      alert(lines.join('\n'));
    });
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => {
      const ok = document.querySelector('.cestis-alert-ok').getBoundingClientRect();
      const msg = document.querySelector('.cestis-alert-msg');
      return { okTop: ok.top, okBottom: ok.bottom, vh: innerHeight, ws: getComputedStyle(msg).whiteSpace,
        scrolls: msg.scrollHeight > msg.clientHeight, icon: document.querySelector('.cestis-alert-icon').className,
        focus: document.activeElement === document.querySelector('.cestis-alert-ok') };
    });
    ok(a.okTop >= 0 && a.okBottom <= a.vh, 'the OK button is on screen (' + Math.round(a.okTop) + '-' + Math.round(a.okBottom) + ' of ' + a.vh + ')');
    ok(a.ws === 'pre-line' && a.scrolls, 'the message keeps its line breaks and scrolls inside the box');
    ok(/kind-success/.test(a.icon), 'a message starting with ✅ shows the success icon, not the warning sign');
    ok(a.focus, 'focus is on OK');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.querySelector('.cestis-alert-overlay') && document.activeElement && document.activeElement.id === 'opener'), 'Enter closes it and focus goes back');
    await page.evaluate(() => { alert('one'); alert('two'); });
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelectorAll('.cestis-alert-overlay').length === 1 && /one/.test(document.querySelector('.cestis-alert-msg').textContent)), 'one Enter closes only the top alert');
    await ctx.close();
  }

  console.log('Phones: no sideways page, tables scroll in their card');
  {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    await seedAdmin(page);
    await page.evaluate(async () => { await handleAdminClick(); });
    await page.fill('#adminUser', 'realadmin'); await page.fill('#adminPass', 'S0me-Real-Pass!');
    await page.evaluate(async () => { await handleAdminClick(); });
    await page.waitForTimeout(800);
    // One trainee on the roll (the Centre's id scheme may re-key it on save).
    await page.evaluate(() => {
      students.push({ id: 'STU-ui', name: 'Stu Dent', course: 'Welding', stage: 'training', email: '', gender: 'Male' });
      saveState();
    });
    await page.waitForTimeout(600);
    const sid = await page.evaluate(() => (students.find(s => s.name === 'Stu Dent') || {}).id);
    const phone = await ctx.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base + '/Student-Progress.html', { waitUntil: 'load' });
    await phone.waitForTimeout(1300);
    const sp = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(sp.sw <= sp.cw, 'Student Progress fits a 390px phone (' + sp.sw + ' <= ' + sp.cw + ')');
    // A trainee's own transcript view, previewed by the administrator.
    await phone.goto(base + '/Transcript-Grades.html?role=student&studentId=' + encodeURIComponent(sid), { waitUntil: 'load' });
    await phone.waitForTimeout(1300);
    const tg = await phone.evaluate(() => {
      const de = document.documentElement;
      const wraps = Array.prototype.map.call(document.querySelectorAll('.tg-card-body'), b => getComputedStyle(b).overflowX);
      const th = Array.prototype.find.call(document.querySelectorAll('.tg-table th'), x => /final grade/i.test(x.textContent));
      return { sw: de.scrollWidth, cw: de.clientWidth, wraps: wraps, gradeRight: th ? Math.round(th.getBoundingClientRect().right) : null };
    });
    ok(tg.sw <= tg.cw, 'the transcript page does not pan sideways (' + tg.sw + ' <= ' + tg.cw + ')');
    ok(tg.wraps.length > 0 && tg.wraps.every(o => o === 'auto'), 'its tables scroll inside their cards');
    ok(tg.gradeRight !== null && tg.gradeRight <= 390, 'and the trainee\'s Final grade column is on screen (right edge ' + tg.gradeRight + ')');

    console.log('LIVE only while a class is live');
    const live = await page.evaluate(() => {
      buildAdminSidebar();
      const before = document.querySelector('#sidebarNav .nav-live-badge').hidden;
      const newBadges = document.querySelectorAll('#sidebarNav .nav-badge').length;
      const txt = Array.prototype.filter.call(document.querySelectorAll('#sidebarNav .nav-badge'), b => !b.hidden && b.style.display !== 'none').map(b => b.textContent);
      classSessions.push({ id: 'CS-live', name: 'Live class', course: 'Plumbing', date: localDateStr(), time: '09:00', status: 'live', roomCode: 'ABC234', updatedAt: new Date().toISOString() });
      refreshNavLiveBadges();
      const during = document.querySelector('#sidebarNav .nav-live-badge').hidden;
      classSessions.pop(); refreshNavLiveBadges();
      return { before, during, after: document.querySelector('#sidebarNav .nav-live-badge').hidden, txt, newBadges };
    });
    ok(live.before === true && live.during === false && live.after === true, 'the badge is hidden, shows while a class is live, and hides again');
    ok(!live.txt.some(t => /NEW|LIVE/.test(t)), 'no permanent NEW or LIVE badges (' + live.txt.join(',') + ')');
    await ctx.close();
  }

  console.log('The offline copy: installs, opens with the network cut, and has a kill switch');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    const reg = await page.evaluate(() => navigator.serviceWorker.ready.then(r => r.scope));
    ok(reg === base + '/', 'the worker registers for the site folder (' + reg + ')');
    // Wait for the install-time copy to be written.
    await page.waitForFunction(() => caches.keys().then(k => k.some(n => n.indexOf('cestis-shell-') === 0)), null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    const cached = await page.evaluate(() => caches.open('cestis-shell-v1').then(c => c.keys()).then(k => k.map(r => r.url)));
    ok(cached.some(u => /\/index\.html$/.test(u)) && cached.some(u => /cestis-core\.js\?v=/.test(u)) && cached.some(u => /Pages\/Online-Exams\.html$/.test(u)),
      'the first visit leaves index.html, its scripts and its section files behind (' + cached.length + ' files)');
    ok(!cached.some(u => !u.startsWith(base)), 'and nothing from any other site');
    await page.reload({ waitUntil: 'load' });
    ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'after a reload the page is served through it');
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const offline = await page.evaluate(() => ({ title: document.title, cards: document.querySelectorAll('.role-card').length, core: !!window.CESTISCore }));
    ok(offline.cards >= 5 && offline.core, 'with the network cut, the dashboard still opens (' + JSON.stringify(offline) + ')');
    await ctx.setOffline(false);
    killSwitch = true;
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const gone = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !r).then(none => caches.keys().then(k => ({ none, left: k.filter(n => n.indexOf('cestis-shell-') === 0).length }))));
    ok(gone.none && gone.left === 0, 'a sw-disable file unregisters it and deletes its copies (' + JSON.stringify(gone) + ')');
    killSwitch = false;
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
