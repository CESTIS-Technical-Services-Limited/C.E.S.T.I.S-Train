/* The phone and readability improvements of preview "ui-a", in a real browser
   (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ui-preview-a.js
   Drives the real index.html in headless Chromium with the outside world cut
   off, signed in through the real sign-in form, at a 390px phone and a
   1366px computer screen:
     - search on phones: a magnifier button opens the search across the bar,
       results (still only what the role may see) fill the screen below, and
       it folds away on ✕, Escape, Back and on picking a result; a computer's
       search box is untouched.
   Every page checked must not pan sideways at 390px and must raise no page
   error. Kept out of the default npm test chain because it needs a browser. */
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
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1366, height: 768 } };

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  async function fresh(opts) {
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, opts || DESK));
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('cestis_sw_disabled', '1'); } catch (e) {} });
    return ctx;
  }
  async function open(ctx) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return { page, errors };
  }
  // A small Centre: an administrator and two trainees with their own logins.
  async function seed(page) {
    await page.evaluate(async () => {
      const now = new Date().toISOString();
      students.push({ id: 'STU-ua1', name: 'Aaliyah Campbell', course: 'Welding & Fabrication', stage: 'training', email: 'aaliyah@gmail.com', gender: 'Female', updatedAt: now });
      students.push({ id: 'STU-ua2', name: 'Romario Lewis', course: 'Welding & Fabrication', stage: 'training', email: 'romario@gmail.com', gender: 'Male', updatedAt: now });
      saveState();
      const a = students.find(s => s.name === 'Aaliyah Campbell');
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-ua-admin', name: 'Paulette Henry', role: 'admin', username: 'phenry', password: await hashPassword('Real-Admin-Pass-1'), status: 'active', updatedAt: now });
      users.push({ id: 'USR-ua-stu', name: 'Aaliyah Campbell', role: 'student', username: 'aaliyah', password: await hashPassword('Trainee-Pass-12'), status: 'active', programme: 'Welding & Fabrication', studentDataId: a.id, updatedAt: now });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
  }
  async function signIn(page, card, user, pass) {
    await page.evaluate(c => { const l = document.getElementById(c + 'Login'); if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click(); }, card);
    await page.waitForTimeout(200);
    await page.fill('#' + card + 'User', user);
    await page.fill('#' + card + 'Pass', pass);
    await page.press('#' + card + 'Pass', 'Enter');
    await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 15000 });
    await page.waitForTimeout(800);
  }
  const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  console.log('Search on phones: a button opens it, Escape / ✕ / Back / a result fold it away');
  {
    const ctx = await fresh(PHONE);
    const { page, errors } = await open(ctx);
    await seed(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    const closed = await page.evaluate(() => {
      const t = document.getElementById('globalSearchToggle'), r = t.getBoundingClientRect();
      const box = document.querySelector('.topbar-search');
      return { w: r.width, h: r.height, label: t.getAttribute('aria-label'), expanded: t.getAttribute('aria-expanded'),
        boxShown: getComputedStyle(box).display !== 'none', inView: r.right <= innerWidth && r.left >= 0 };
    });
    ok(closed.w >= 44 && closed.h >= 44 && closed.inView, 'the magnifier button is on screen and at least 44x44 (' + closed.w + 'x' + closed.h + ')');
    ok(closed.label === 'Search' && closed.expanded === 'false', 'it is named "Search" and says it is closed');
    ok(!closed.boxShown, 'the box itself stays folded until asked for');
    await page.tap('#globalSearchToggle');
    await page.waitForTimeout(250);
    await page.keyboard.type('Romario');
    await page.waitForTimeout(400);
    const opened = await page.evaluate(() => {
      const bar = document.querySelector('.topbar-search').getBoundingClientRect();
      const res = document.getElementById('searchResults'), rr = res.getBoundingClientRect();
      return { focus: document.activeElement && document.activeElement.id, expanded: document.getElementById('globalSearchToggle').getAttribute('aria-expanded'),
        barW: Math.round(bar.width), resW: Math.round(rr.width), resTop: Math.round(rr.top), barBottom: Math.round(bar.bottom),
        items: Array.prototype.map.call(res.querySelectorAll('.search-result-item .sr-title'), x => x.textContent),
        closeBtn: (function () { const c = document.querySelector('.topbar-search-close'); const r = c.getBoundingClientRect(); return [r.width, r.height, c.getAttribute('aria-label')]; })() };
    });
    ok(opened.focus === 'globalSearch' && opened.expanded === 'true', 'opening puts the cursor in the box and says it is open');
    ok(opened.barW === 390 && opened.resW === 390 && opened.resTop >= opened.barBottom - 2, 'the box spans the bar and the results the screen below it (' + JSON.stringify(opened) + ')');
    ok(opened.items.length === 1 && opened.items[0] === 'Romario Lewis', 'the administrator finds the trainee by name');
    ok(opened.closeBtn[0] >= 44 && opened.closeBtn[1] >= 44 && opened.closeBtn[2] === 'Close search', 'a labelled ✕ of at least 44x44 closes it');
    ok(await sideways(page) <= 0, 'nothing pans sideways while it is open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const esc = await page.evaluate(() => ({ open: document.querySelector('.topbar').classList.contains('search-open'), focus: document.activeElement && document.activeElement.id,
      val: document.getElementById('globalSearch').value, state: history.state }));
    ok(!esc.open && esc.focus === 'globalSearchToggle' && esc.val === '', 'Escape folds it away and gives focus back to the button');
    ok(!(esc.state && esc.state.cestisPhoneSearch), 'and takes back the history step it added');
    // Back button.
    await page.tap('#globalSearchToggle');
    await page.waitForTimeout(250);
    await page.goBack({ waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({ open: document.querySelector('.topbar').classList.contains('search-open'), shell: document.getElementById('appShell').classList.contains('active'), role: currentRole }));
    ok(!back.open && back.shell && back.role === 'admin', 'the phone\'s Back button folds it away and stays signed in on the dashboard');
    // Picking a result.
    await page.tap('#globalSearchToggle');
    await page.waitForTimeout(250);
    await page.keyboard.type('Romario');
    await page.waitForTimeout(400);
    await page.tap('#searchResults .search-result-item');
    await page.waitForTimeout(600);
    const picked = await page.evaluate(() => ({ open: document.querySelector('.topbar').classList.contains('search-open'), page: (document.querySelector('.page.active') || {}).id }));
    ok(!picked.open && picked.page === 'page-students', 'a result opens its page and the search folds away (' + picked.page + ')');
    // The ✕ button.
    await page.tap('#globalSearchToggle');
    await page.waitForTimeout(250);
    await page.tap('.topbar-search-close');
    await page.waitForTimeout(250);
    ok(await page.evaluate(() => !document.querySelector('.topbar').classList.contains('search-open')), 'the ✕ folds it away');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('A trainee\'s phone search still shows only what a trainee may see');
  {
    const ctx = await fresh(PHONE);
    const { page, errors } = await open(ctx);
    await seed(page);
    await signIn(page, 'student', 'aaliyah', 'Trainee-Pass-12');
    await page.tap('#globalSearchToggle');
    await page.waitForTimeout(250);
    await page.keyboard.type('Romario');
    await page.waitForTimeout(400);
    const other = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#searchResults .sr-title'), x => x.textContent));
    ok(other.indexOf('Romario Lewis') === -1, 'another trainee is not listed (' + other.join(',') + ')');
    await page.fill('#globalSearch', '');
    await page.keyboard.type('Aaliyah');
    await page.waitForTimeout(400);
    const self = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#searchResults .sr-title'), x => x.textContent));
    ok(self.indexOf('Aaliyah Campbell') !== -1, 'her own record is (' + self.join(',') + ')');
    ok(await sideways(page) <= 0, 'no sideways panning on the trainee\'s phone');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  console.log('A computer keeps its search box as it was');
  {
    const ctx = await fresh(DESK);
    const { page, errors } = await open(ctx);
    await seed(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    const d = await page.evaluate(() => {
      const box = document.querySelector('.topbar-search').getBoundingClientRect();
      const t = document.getElementById('globalSearchToggle'), c = document.querySelector('.topbar-search-close');
      return { boxW: Math.round(box.width), toggle: t.getClientRects().length, close: c.getClientRects().length };
    });
    ok(d.boxW === 380 && d.toggle === 0 && d.close === 0, 'the 380px box is in the bar and neither phone button is shown (' + JSON.stringify(d) + ')');
    await page.click('#globalSearch');
    await page.keyboard.type('Romario');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelectorAll('#searchResults .search-result-item').length === 1), 'typing still lists results under it');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !document.getElementById('searchResults').classList.contains('active') && !(history.state && history.state.cestisPhoneSearch)), 'Escape closes the list as before');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
