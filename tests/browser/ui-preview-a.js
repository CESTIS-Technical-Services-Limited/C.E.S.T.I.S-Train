/* The phone and readability improvements of preview "ui-a", in a real browser
   (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ui-preview-a.js
   Drives the real index.html in headless Chromium with the outside world cut
   off, signed in through the real sign-in form, at a 390px phone and a
   1366px computer screen:
     - search on phones: a magnifier button opens the search across the bar,
       results (still only what the role may see) fill the screen below, and
       it folds away on ✕, Escape, Back and on picking a result; a computer's
       search box is untouched;
     - phone layouts for the busiest screens: the attendance register, the
       certificate registry and approvals, Settings' users (and its seven
       tabs), the gradebook, School Fee payments and the Cashbook ledger each
       scroll inside their own card with the name still on screen when swiped
       to the far end, buttons and marks at least 44px; chat shows the
       conversation with no empty strip and 44px buttons; the video room's
       call buttons sit in a bar along the bottom and the 💬 button opens chat
       over the room; a computer's attendance register is unchanged;
     - minimum readable text: the registration form, the dashboard, exams,
       certificates, attendance, announcements and the Student Progress page
       show no text below 12px at 1366px or 390px, still with no sideways
       page, and the bell's counter (11px) still fits its 16px dot;
     - image descriptions: Chromium's accessibility tree of the sign-in screen
       no longer reads the "V" tile, the sync icon (now plain sync arrows,
       not a cloud) or the role-card emoji and has
       no unnamed image, while every heading and button keeps its name; a
       profile photo is named after the person on its own (Edit my profile,
       My Chat Profile) and decorative beside the name (sidebar); no <img>
       on the page is left without an alt.
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
// UIPA_ONLY=2,5 runs only those sections (by order), for quick checks.
const ONLY = (process.env.UIPA_ONLY || '').split(',').filter(Boolean).map(Number);
const want = i => !ONLY.length || ONLY.indexOf(i) !== -1;
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

  if (want(1)) {
  console.log('Search on phones: a button opens it, Escape / ✕ / Back / a result fold it away');
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

  if (want(2)) {
  console.log('A trainee\'s phone search still shows only what a trainee may see');
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

  if (want(3)) {
  console.log('A computer keeps its search box in the bar');
    const ctx = await fresh(DESK);
    const { page, errors } = await open(ctx);
    await seed(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    const d = await page.evaluate(() => {
      const box = document.querySelector('.topbar-search').getBoundingClientRect();
      const t = document.getElementById('globalSearchToggle'), c = document.querySelector('.topbar-search-close');
      return { boxW: Math.round(box.width), toggle: t.getClientRects().length, close: c.getClientRects().length };
    });
    // With preview B's chip, who-is-signed-in and Lock beside it, the box
    // shares the bar (B gives it a 120px floor); it is still a box, not a button.
    ok(d.boxW >= 120 && d.boxW <= 380 && d.toggle === 0 && d.close === 0, 'the box is in the bar (120-380px) and neither phone button is shown (' + JSON.stringify(d) + ')');
    await page.click('#globalSearch');
    await page.keyboard.type('Romario');
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelectorAll('#searchResults .search-result-item').length === 1), 'typing still lists results under it');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !document.getElementById('searchResults').classList.contains('active') && !(history.state && history.state.cestisPhoneSearch)), 'Escape closes the list as before');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  /* ---------------- Phone layouts for the busiest screens ---------------- */
  // A bigger roll for the tables: marks this week, two certified trainees,
  // an instructor with an exam and a marked assignment.
  async function seedTables(page) {
    await page.evaluate(async () => {
      const now = new Date().toISOString();
      const names = ['Brandon Williams', 'Chantelle Reid', 'Zara-Lee Montgomery-Fitzgerald', 'Dwayne Thompson', 'Shanté O\'Neil'];
      names.forEach((n, i) => students.push({ id: 'STU-ub' + i, name: n, course: 'Welding & Fabrication', stage: i < 2 ? 'certified' : 'training',
        certNo: i < 2 ? 'WF-2026-29' + i : '', certDate: i < 2 ? '2026-09-1' + i : '', certCollected: i === 0, email: 'u' + i + '@gmail.com', updatedAt: now }));
      saveState();
      exams.push({ id: 'EX-ub', title: 'SMAW Safety & Theory — Unit 3', course: 'Welding & Fabrication', date: '2026-09-18', time: '09:00', duration: 45, status: 'completed', questions: 1, passMark: 60, questionData: [], createdByRole: 'instructor' });
      students.filter(s => /Weld/.test(s.course)).forEach((s, i) => examResults.push({ id: 'RES-ub' + i, examId: 'EX-ub', studentId: s.id, studentName: s.name, score: 60 + i * 5, passed: true, needsReview: false, reviewComplete: true, pendingCount: 0, submittedAt: now }));
      saveState();
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-ua-ins', name: 'Marcia Brown', role: 'instructor', username: 'marcia', email: 'marcia@gmail.com', password: await hashPassword('Instructor-Pass-9'), status: 'active', programme: 'Welding & Fabrication', updatedAt: now });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
  }
  async function showAndWait(page, id) {
    await page.evaluate(p => showPage(p), id);
    await page.waitForTimeout(1500);
  }
  // A table on screen: does it scroll inside its own box, is its name column
  // pinned, and is the name still on screen when swiped to the far end?
  const tableFacts = (page, sel, col) => page.evaluate(([sel, col]) => {
    const body = document.querySelector(sel); if (!body) return null;
    const table = body.closest('table');
    let box = table.parentElement;
    while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement;
    const row = Array.prototype.find.call(body.rows, r => r.cells.length > 2);
    const cell = row.cells[col - 1];
    const before = cell.getBoundingClientRect().left;
    box.scrollLeft = box.scrollWidth;
    const after = cell.getBoundingClientRect(), b = box.getBoundingClientRect();
    const btns = Array.prototype.filter.call(table.querySelectorAll('tbody button, tbody .btn'), x => x.getClientRects().length)
      .map(x => x.getBoundingClientRect()).filter(r => r.height < 44 || r.width < 44).length;
    const out = { scrollsInBox: box.scrollWidth > box.clientWidth, pinned: getComputedStyle(cell).position, nameLeftBefore: Math.round(before),
      nameOnScreenAfterSwipe: after.right > b.left + 20 && after.left >= b.left - 1, small: btns };
    box.scrollLeft = 0;
    return out;
  }, [sel, col]);

  if (want(4)) {
  console.log('Phones: the busy tables scroll in their own card with the name pinned, and their buttons are finger-sized');
    const ctx = await fresh(PHONE);
    const { page, errors } = await open(ctx);
    await seed(page);
    await seedTables(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    await page.evaluate(() => {
      const A = CESTISCore.attendance, dates = A.weekDates(localDateStr());
      students.forEach((s, i) => { setAttendanceMark(s.id, dates[0], i % 2 ? 'present' : 'late'); });
    });
    await showAndWait(page, 'attendance');
    let f = await tableFacts(page, '#attendanceTableBody', 1);
    ok(f && f.scrollsInBox && f.pinned === 'sticky' && f.nameOnScreenAfterSwipe, 'attendance: the register scrolls in its card and the trainee stays on screen at Friday (' + JSON.stringify(f) + ')');
    const att = await page.evaluate(() => {
      const row = document.querySelector('#attendanceTableBody tr');
      const sel = row.querySelector('select.att-cell').getBoundingClientRect();
      return { idCol: getComputedStyle(row.querySelector('.att-col-id')).display, sub: getComputedStyle(row.querySelector('.att-phone-sub')).display,
        subText: row.querySelector('.att-phone-sub').textContent, selH: sel.height, firstDay: (function () { const c = row.cells[3].getBoundingClientRect(); return c.left < innerWidth; })() };
    });
    ok(att.idCol === 'none' && att.sub === 'block' && /STU-ub|·/.test(att.subText), 'attendance: the ID and course fold into a line under the name (' + JSON.stringify(att) + ')');
    ok(att.selH >= 44 && att.firstDay, 'attendance: a day mark is on screen as the page opens and is at least 44px tall');
    ok(f.small === 0, 'attendance: no button in the register is smaller than 44x44');
    ok(await sideways(page) <= 0, 'attendance: the page itself does not pan sideways');

    await showAndWait(page, 'certificates');
    f = await tableFacts(page, '#certTableBody', 1);
    ok(f && f.scrollsInBox && f.pinned === 'sticky' && f.nameOnScreenAfterSwipe && f.small === 0, 'certificates: the registry scrolls in its card, name pinned, 44px buttons (' + JSON.stringify(f) + ')');
    ok(await sideways(page) <= 0, 'certificates: no sideways page');
    await showAndWait(page, 'cert-downloads');
    const dl = await page.evaluate(() => {
      const r = document.querySelector('.cert-approve-row'); if (!r) return null;
      const info = r.querySelector('.cert-approve-info').getBoundingClientRect(), act = r.querySelector('.cert-approve-actions').getBoundingClientRect();
      const b = r.querySelector('.cert-approve-actions .btn, .cert-approve-actions button'); const br = b && b.getBoundingClientRect();
      return { stacked: act.top >= info.bottom - 1, btnH: br ? br.height : 0 };
    });
    ok(dl && dl.stacked && dl.btnH >= 44, 'certificate approvals: the status and button sit under the name, 44px tall (' + JSON.stringify(dl) + ')');
    ok(await sideways(page) <= 0, 'certificate downloads: no sideways page');

    await showAndWait(page, 'settings');
    const tabs = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#page-settings .tabs .tab'), t => { const r = t.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.height >= 44; }));
    ok(tabs.length === 8 && tabs.every(Boolean), 'settings: all eight tabs (Trainee Sign-in included) are on screen and 44px tall (' + tabs.join(',') + ')');
    await page.evaluate(() => { const t = Array.prototype.find.call(document.querySelectorAll('#page-settings .tab'), x => /User Accounts/.test(x.textContent)); t.click(); });
    await page.waitForTimeout(800);
    f = await tableFacts(page, '#umTableBody', 2);
    ok(f && f.scrollsInBox && f.pinned === 'sticky' && f.nameOnScreenAfterSwipe && f.small === 0, 'users: the user column stays while the status and actions slide in; actions 44x44 (' + JSON.stringify(f) + ')');
    ok(await page.evaluate(() => { const m = document.querySelector('.main-content'); return m.scrollWidth <= m.clientWidth; }), 'settings: nothing is hidden past the page\'s edge any more');

    await showAndWait(page, 'lms-chat');
    const chat = await page.evaluate(() => {
      const r = lmsChatRooms[0]; lmsChatOpenRoom(r.id, 'admin');
      const cont = document.getElementById('adminChatContainer').getBoundingClientRect(), inp = document.querySelector('#adminChatActive .lms-chat-input-area').getBoundingClientRect();
      const small = Array.prototype.filter.call(document.querySelectorAll('#adminChatActive button'), b => b.getClientRects().length && (b.getBoundingClientRect().width < 44 || b.getBoundingClientRect().height < 44))
        .map(b => (b.className || b.title || b.textContent).slice(0, 20) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
      return { gap: Math.round(cont.bottom - inp.bottom), small, list: getComputedStyle(document.getElementById('adminChatSidebar')).display };
    });
    ok(chat.list === 'none' && chat.gap <= 2, 'chat: the conversation replaces the room list and the message box sits at the bottom (gap ' + chat.gap + ')');
    ok(chat.small.length === 0, 'chat: every button in the conversation is at least 44x44 (' + chat.small.join(', ') + ')');
    ok(await sideways(page) <= 0, 'chat: no sideways page');

    // The video room's own layout rules, on the room's real class names.
    const vc = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<div class="vc-conference-wrapper"><div class="vc-conference-body"><div class="vc-main-video-area"><div class="video-grid"><div class="video-tile"></div><div class="video-tile"></div></div>' +
        '<div class="video-controls"><button class="vc-btn">1</button><button class="vc-btn">2</button></div></div><div class="vc-side-panel"><div class="vc-sidepanel-close" style="display:none;"><button class="btn">x</button></div></div></div></div>';
      document.querySelector('.page.active').appendChild(host);
      const bar = host.querySelector('.video-controls'), cs = getComputedStyle(bar), btn = host.querySelector('.vc-btn').getBoundingClientRect();
      const tiles = host.querySelectorAll('.video-tile');
      const r = { pos: cs.position, bottom: Math.round(innerHeight - bar.getBoundingClientRect().bottom), btn: [btn.width, btn.height],
        stacked: tiles[1].getBoundingClientRect().top >= tiles[0].getBoundingClientRect().bottom, panelHidden: getComputedStyle(host.querySelector('.vc-side-panel')).display === 'none' };
      document.body.classList.add('vc-show-sidepanel');
      const p = host.querySelector('.vc-side-panel'); r.panelOpen = getComputedStyle(p).display + '/' + getComputedStyle(p).position;
      r.closeShown = getComputedStyle(host.querySelector('.vc-sidepanel-close')).display;
      document.body.classList.remove('vc-show-sidepanel'); host.remove();
      return r;
    });
    ok(vc.pos === 'fixed' && vc.bottom === 0 && vc.btn[0] >= 44 && vc.btn[1] >= 44, 'video room: the call buttons are a 44px bar along the bottom (' + JSON.stringify(vc) + ')');
    ok(vc.stacked && vc.panelHidden && vc.panelOpen === 'flex/fixed' && vc.closeShown === 'block', 'video room: pictures stack; chat opens over the room with its Close button');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  if (want(5)) {
  console.log('Phones: the gradebook keeps the trainee in view; the marking boxes are finger-sized');
    const ctx = await fresh(PHONE);
    const { page, errors } = await open(ctx);
    await seed(page);
    await seedTables(page);
    await signIn(page, 'instructor', 'marcia', 'Instructor-Pass-9');
    await showAndWait(page, 'i-gradebook');
    const f = await tableFacts(page, '#iGradebookBody', 1);
    ok(f && f.pinned === 'sticky' && f.nameOnScreenAfterSwipe, 'gradebook: the trainee column is pinned (' + JSON.stringify(f) + ')');
    ok(await sideways(page) <= 0, 'gradebook: no sideways page');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  if (want(6)) {
  console.log('Phones: School Fee and the Cashbook keep the name beside the money');
    const ctx = await fresh(PHONE);
    const { page, errors } = await open(ctx);
    await seed(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    await page.evaluate(() => {
      CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify([{ id: 'FS-1', name: 'Romario Lewis', skillArea: 'WELDING L2', tuitionFee: 28000, totalPaid: 5000, balance: 23000, status: 'Partial', enrollmentDate: '2026-04-14', createdAt: '2026-04-14T10:00:00Z' }]));
      CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify([{ id: 'PAY-1', studentId: 'FS-1', studentName: 'Romario Lewis', skillArea: 'WELDING L2', amount: 5000, date: localDateStr(), method: 'Cash', term: 'Term 1', receiptNumber: 'RC-4151' }]));
    });
    await showAndWait(page, 'fee-management');
    await page.waitForTimeout(2000);
    const fee = page.frames().find(fr => /School\.Fee/.test(fr.url()));
    await fee.evaluate(() => { const b = document.getElementById('activateWindowBtn'); if (b && b.offsetParent) b.click(); switchModule('payments'); });
    await fee.waitForTimeout(800);
    const fp = await fee.evaluate(() => {
      const row = document.querySelector('#paymentsTableBody tr'); if (!row) return null;
      const cs = i => getComputedStyle(row.cells[i]);
      const box = row.closest('.table-container');
      const amount = row.cells[5].getBoundingClientRect();
      return { date: cs(0).display, name: cs(2).position, sub: (row.querySelector('.fee-phone-sub') || {}).textContent, amountOnScreen: amount.right <= box.getBoundingClientRect().right + 1,
        btnH: Math.min.apply(null, Array.prototype.map.call(row.querySelectorAll('.action-btn'), b => b.getBoundingClientRect().height)),
        side: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok(fp && fp.date === 'none' && fp.name === 'sticky' && /RC-4151/.test(fp.sub) && fp.amountOnScreen, 'School Fee: the payment\'s date and receipt sit under the pinned name, the amount beside it (' + JSON.stringify(fp) + ')');
    ok(fp && fp.btnH >= 44 && fp.side <= 0, 'School Fee: row buttons are 44px and the page does not pan sideways (' + JSON.stringify(fp) + ')');
    await showAndWait(page, 'cashbook');
    await page.waitForTimeout(2000);
    const cb = page.frames().find(fr => /Cashbook/.test(fr.url()));
    const cf = await cb.evaluate(() => {
      CESTISStore.setItem(AUTH_SESSION_KEY, JSON.stringify({ loggedIn: true, user: 'phenry', role: 'admin', timestamp: Date.now() }));
      window.showMandatorySyncOverlay = function () {}; showApp(); try { hideMandatorySyncOverlay(); } catch (e) {}
      const qm = getQuarterMeta(activeQ), m = String(qm.monthNums[0]).padStart(2, '0'), y = qm.monthNums[0] < 4 ? +String(activeFY).slice(0, 4) + 1 : String(activeFY).slice(0, 4);
      transactions = [{ id: 100, uid: 'x', date: y + '-' + m + '-05', cheque: '004512', details: 'Jamaica Public Service — electricity', category: 'Utilities', deposit: 0, payment: 86540.25 }];
      renderTransactions(); showPageDirect('transactions');
      const row = document.querySelector('#txnBody tr:nth-child(2)');
      return { date: getComputedStyle(row.cells[0]).display, details: getComputedStyle(row.cells[2]).position, sub: (row.querySelector('.cb-phone-sub') || {}).textContent,
        btn: Math.min.apply(null, Array.prototype.map.call(row.querySelectorAll('.btn-sm'), b => b.getBoundingClientRect().height)),
        side: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    ok(cf.date === 'none' && cf.details === 'sticky' && /004512/.test(cf.sub) && /Utilities/.test(cf.sub), 'Cashbook: date, cheque and category sit under the pinned details (' + JSON.stringify(cf) + ')');
    ok(cf.btn >= 44 && cf.side <= 0, 'Cashbook: row buttons are 44px and the page does not pan sideways');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  if (want(7)) {
  console.log('A computer keeps every table as it was');
    const ctx = await fresh(DESK);
    const { page, errors } = await open(ctx);
    await seed(page);
    await seedTables(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    await showAndWait(page, 'attendance');
    const d = await page.evaluate(() => {
      const row = document.querySelector('#attendanceTableBody tr');
      return { id: getComputedStyle(row.querySelector('.att-col-id')).display, sub: getComputedStyle(row.querySelector('.att-phone-sub')).display, pos: getComputedStyle(row.cells[0]).position };
    });
    ok(d.id === 'table-cell' && d.sub === 'none' && d.pos === 'static', 'attendance on a computer: ID column shown, no phone line, nothing pinned (' + JSON.stringify(d) + ')');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }

  /* ---------------- Minimum readable text size ---------------- */
  // Visible text drawn below 12px in this document, except the bell's counter.
  const smallText = page => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.trim(); if (!t) continue;
      const el = n.parentElement; const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      const f = parseFloat(cs.fontSize);
      if (f > 0 && f < 11.95 && !el.closest('.topbar-btn .dot')) out.push(t.slice(0, 20) + '@' + f);
    }
    return out;
  });
  if (want(8)) {
  console.log('Text on screen is at least 12px; the bell\'s counter still fits its dot');
  for (const opts of [DESK, PHONE]) {
    const ctx = await fresh(opts);
    const { page, errors } = await open(ctx);
    await seed(page);
    await seedTables(page);
    const label = opts === PHONE ? 'phone' : 'computer';
    await page.evaluate(() => openRegistrationModal('student'));
    await page.waitForTimeout(400);
    let s = await smallText(page);
    ok(s.length === 0, label + ': the registration form has no text under 12px (' + s.slice(0, 5).join(', ') + ')');
    await page.evaluate(() => closeRegistrationModal());
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    for (const id of ['dashboard', 'exams', 'certificates', 'attendance', 'announcements']) {
      await showAndWait(page, id);
      s = await smallText(page);
      ok(s.length === 0, label + ' ' + id + ': no text under 12px (' + s.slice(0, 5).join(', ') + ')');
      ok(await sideways(page) <= 0, label + ' ' + id + ': still no sideways page');
    }
    await page.evaluate(() => addNotification('Twelve trainees awaiting approval', 'warning', null, ['admin']));
    await page.waitForTimeout(300);
    const dot = await page.evaluate(() => { const d = document.getElementById('notifDot'); const r = d.getBoundingClientRect(); return { f: parseFloat(getComputedStyle(d).fontSize), fits: d.scrollWidth <= d.clientWidth + 1 && d.scrollHeight <= d.clientHeight + 1, h: r.height }; });
    ok(dot.f === 11 && dot.fits, label + ': the bell counter is 11px and fits its 16px dot (' + JSON.stringify(dot) + ')');
    await showAndWait(page, 'students');
    await page.waitForTimeout(1500);
    const sp = page.frames().find(fr => /Student-Progress/.test(fr.url()));
    s = sp ? await smallText(sp) : ['no frame'];
    ok(s.length === 0, label + ' Student Progress (sibling page): no text under 12px (' + s.slice(0, 5).join(', ') + ')');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }
  }

  /* ---------------- Image descriptions ---------------- */
  if (want(9)) {
  console.log('Pictures say what they show; the sign-in screen\'s decoration is not read out');
  {
    const ctx = await fresh(DESK);
    const { page, errors } = await open(ctx);
    // What Chromium hands a screen reader on the sign-in screen.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const read = nodes.filter(n => !n.ignored).map(n => ({ role: n.role && n.role.value, name: n.name ? String(n.name.value) : '' }));
    const emoji = read.filter(n => n.role === 'StaticText' && /^(V|☁️|🔄|🛡️|🎓|📚|📋|🏛️)$/.test(n.name.trim()));
    ok(emoji.length === 0, 'sign-in: the "V" tile, the sync icon and the role-card emoji are not read out (' + emoji.map(n => n.name).join(' ') + ')');
    // The sync box shows plain sync arrows, not a cloud: nothing on screen says where the information is kept.
    ok(await page.$eval('#loginSyncBar .sync-icon', el => el.textContent.trim()) === '🔄', 'sign-in: the sync box shows the sync arrows, not a cloud');
    ok(!read.some(n => n.role === 'image'), 'sign-in: no unnamed image is left in the tree');
    ['VocTrain', 'Administrator', 'Student', 'Instructor', 'Administrative Staff', 'CMC Board'].forEach(h =>
      ok(read.some(n => n.role === 'heading' && n.name === h), 'sign-in: the heading "' + h + '" is still read'));
    ok(read.some(n => n.role === 'button' && n.name === 'Certificate Portal'), 'sign-in: the Certificate Portal button keeps its name');
    await seed(page);
    await signIn(page, 'admin', 'phenry', 'Real-Admin-Pass-1');
    // A real photo for this administrator, then every place that shows it.
    const r = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const pic = c.toDataURL('image/png');
      const me = currentLoggedInUser;
      lmsChatProfiles[me.id] = Object.assign({}, lmsChatProfiles[me.id] || {}, { profilePic: pic });
      updateSidebarAvatar(me.id, me.name);
      const side = document.querySelector('#sidebarAvatar img');
      openAccountProfileEdit();
      await new Promise(res => setTimeout(res, 300));
      const prev = document.querySelector('#editAcctPicPreview img');
      const out = { side: side && side.getAttribute('alt'), edit: prev && prev.getAttribute('alt'), name: me.name };
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      return out;
    });
    ok(r.side === '', 'the sidebar photo is decorative — the name is printed beside it (alt="' + r.side + '")');
    ok(r.edit === r.name, 'Edit my profile: the photo is named after the person (alt="' + r.edit + '")');
    await showAndWait(page, 'lms-chat');
    const chat = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
      const cu = lmsChatGetCurrentUser();
      lmsChatProfiles[cu.id] = Object.assign({}, lmsChatProfiles[cu.id] || {}, { profilePic: c.toDataURL('image/png') });
      lmsChatOpenProfileModal();
      await new Promise(res => setTimeout(res, 300));
      const img = document.querySelector('#lmsChatProfilePreview img');
      return { alt: img && img.getAttribute('alt'), name: cu.name };
    });
    ok(chat.alt === chat.name, 'My Chat Profile: the photo is named after the person (alt="' + chat.alt + '")');
    const bare = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('img'), i => !i.hasAttribute('alt')).map(i => (i.src || '').slice(0, 40)));
    ok(bare.length === 0, 'no picture on the page is left without an alt (' + bare.join(', ') + ')');
    ok(errors.length === 0, 'no page errors — got: ' + errors.join(' | '));
    await ctx.close();
  }
  }

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
