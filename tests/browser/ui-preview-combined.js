/* The combined UI preview's top bar, in a real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ui-preview-combined.js
   Drives the real index.html in headless Chromium with the outside world cut
   off, signed in through the real sign-in form as an administrator and as a
   trainee, in Dark and in Light, and checks the four things the owner was
   not to be shown again:
     1. ONE sync control: nothing else in the top bar is a sync button; its
        panel holds the answer and, for staff only, the sync actions;
     2. a trainee whose phone is not signed in for syncing sees a calm
        "All saved" (never the red "needs attention"), and an amber "Waiting
        to send" only when an exam result of hers is still to be sent;
     3. on a phone (320-414px) nothing runs off the edge and the page's name
        shows in full from 360px (a long one, "Attendance Management", on two
        lines); Lock, Light/Dark, Two-Step Verification and
        Sign Out are in the menu behind the initials;
     4. from 769 to 960px the magnifier stands in for the hidden search box
        and opens the search; from 769 to 1366px nothing overlaps or runs off.
   Every page checked must raise no page error. Kept out of the default npm
   test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
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
const ADMIN = { user: 'mthompson', pass: 'Centre-Admin-2026!' };
const TRAINEE = { user: 'tashana.brown', pass: 'Weld-Fab-2026' };
const SOURCE_WORDS = /cloud|☁|google|\bdrive\b|gmail|server|network|\blan\b|offline|internet|emailjs|peerjs|broker|megadata/i;

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  async function session(vp, theme, who) {
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica', viewport: { width: vp.w, height: vp.h || 800 } },
      vp.phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}));
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    await ctx.addInitScript(t => { try { localStorage.setItem('cestis_sw_disabled', '1'); if (t === 'light') localStorage.setItem('cestisTheme', 'light'); } catch (e) {} }, theme);
    const errors = [];
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    // A small Centre: the administrator and a trainee with logins of their own.
    await page.evaluate(async ({ ADMIN, TRAINEE }) => {
      const now = new Date().toISOString();
      students.push({ id: 'STU-tbrown', name: 'Tashana Brown', course: 'Welding & Fabrication', stage: 'training', email: 'tashana.brown@example.com', gender: 'Female', updatedAt: now });
      saveState();
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      users.push({ id: 'USR-mthompson', name: 'Marcia Thompson', role: 'admin', username: ADMIN.user, password: await hashPassword(ADMIN.pass), status: 'active', updatedAt: now });
      users.push({ id: 'USR-tbrown', name: 'Tashana Brown', role: 'student', username: TRAINEE.user, password: await hashPassword(TRAINEE.pass), status: 'active', programme: 'Welding & Fabrication', studentDataId: 'STU-tbrown', updatedAt: now });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, { ADMIN, TRAINEE });
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    const card = who === 'admin' ? 'admin' : 'student', cred = who === 'admin' ? ADMIN : TRAINEE;
    await page.evaluate(c => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById(c + 'Login'); if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click(); }, card);
    await page.waitForTimeout(200);
    await page.fill('#' + card + 'User', cred.user);
    await page.fill('#' + card + 'Pass', cred.pass);
    await page.press('#' + card + 'Pass', 'Enter');
    await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      try { dismissCloudNotification(); } catch (e) {}
      document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove());
      document.querySelectorAll('.modal-overlay.active, .modal.active').forEach(m => m.classList.remove('active'));
      isCloudConnected = false; googleAccessToken = null; updateCloudUI(false); refreshSyncChip();
    });
    await page.waitForTimeout(200);
    return { ctx, page, errors };
  }
  const bar = page => page.evaluate(() => {
    const t = document.getElementById('topbarTitle');
    const vis = Array.from(document.querySelectorAll('.topbar-right > *, .mobile-menu-btn, #topbarTitle')).filter(e => e.getClientRects().length);
    const boxes = vis.map(e => ({ id: e.id || String(e.className).split(' ')[0], r: e.getBoundingClientRect() })).filter(b => b.r.width > 0);
    const overlap = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap.push(boxes[i].id + '/' + boxes[j].id);
    }
    const panel = document.getElementById('syncChipPanel');
    const outside = Array.from(document.querySelectorAll('.topbar .cloud-sync-btn, .topbar .cloud-dropdown > button')).filter(e => !panel.contains(e) && e.getClientRects().length);
    const mag = document.getElementById('globalSearchToggle').getBoundingClientRect();
    return { title: t.textContent, full: t.scrollWidth <= t.clientWidth + 1 && t.scrollHeight <= t.clientHeight + 1, sideways: document.documentElement.scrollWidth - innerWidth,
      offEdge: Math.max.apply(null, boxes.map(b => b.r.right)) - innerWidth, overlap: overlap.join(','), extraSync: outside.length,
      mag: mag.width ? [Math.round(mag.width), Math.round(mag.height)] : null, box: getComputedStyle(document.querySelector('.topbar-search')).display,
      lock: !!document.getElementById('topbarLockBtn').getClientRects().length, signOut: !!document.querySelector('.topbar .logout-btn').getClientRects().length };
  });

  try {
    /* ---------- 3 and 4: every width, both roles ---------- */
    const WIDTHS = [{ w: 320, phone: 1 }, { w: 360, phone: 1 }, { w: 390, phone: 1 }, { w: 414, phone: 1 },
      { w: 769 }, { w: 800 }, { w: 900 }, { w: 960 }, { w: 1024 }, { w: 1180 }, { w: 1366, h: 768 }];
    for (const who of ['admin', 'student']) {
      console.log('The top bar at every width (' + who + ')');
      for (const vp of WIDTHS) {
        const { ctx, page, errors } = await session(vp, vp.w === 390 || vp.w === 900 ? 'light' : 'dark', who);
        for (const pg of who === 'admin' ? ['dashboard', 'exams', 'attendance'] : ['s-dashboard', 's-exams']) {
          await page.evaluate(p => showPage(p), pg); await page.waitForTimeout(300);
          const r = await bar(page);
          const at = who + ' ' + vp.w + 'px ' + pg;
          ok(r.sideways <= 0 && r.offEdge <= 0 && !r.overlap, at + ': nothing runs off the edge or overlaps (' + JSON.stringify({ s: r.sideways, o: r.offEdge, x: r.overlap }) + ')');
          if (vp.w >= 360) ok(r.full, at + ': the page\'s name shows in full ("' + r.title + '")');
          ok(r.extraSync === 0, at + ': one sync control — no second sync button in the bar');
          if (vp.w <= 960) {
            ok(r.mag && r.mag[0] >= 44 && r.mag[1] >= 44 && r.box === 'none', at + ': the magnifier (44x44) stands in for the search box');
            ok(!r.lock, at + ': Lock is in the menu behind the initials');
          } else ok(!r.mag && r.box !== 'none', at + ': the search box is in the bar');
          if (vp.phone) ok(!r.signOut, at + ': Sign Out is in that menu too');
        }
        ok(errors.length === 0, who + ' ' + vp.w + 'px: no page errors — ' + errors.join(' | '));
        await ctx.close();
      }
    }

    /* ---------- 4: search from the magnifier at 900px ---------- */
    console.log('At 900px the magnifier opens the search');
    {
      const { ctx, page, errors } = await session({ w: 900 }, 'dark', 'admin');
      await page.click('#globalSearchToggle');
      await page.keyboard.type('Tashana');
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => ({ open: document.querySelector('.topbar').classList.contains('search-open'), n: document.querySelectorAll('#searchResults .search-result-item').length,
        w: document.querySelector('.topbar-search').getBoundingClientRect().width }));
      ok(r.open && r.n >= 1 && r.w > 500, 'it opens across the bar and lists results (' + JSON.stringify(r) + ')');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      ok(await page.evaluate(() => !document.querySelector('.topbar').classList.contains('search-open')), 'Escape folds it away');
      ok(errors.length === 0, 'no page errors — ' + errors.join(' | '));
      await ctx.close();
    }

    /* ---------- 1 and 3: the one control's panel, and the account menu ---------- */
    for (const theme of ['dark', 'light']) {
      console.log('An administrator\'s one sync control and account menu (' + theme + ', phone)');
      const { ctx, page, errors } = await session({ w: 390, phone: 1 }, theme, 'admin');
      ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === (theme === 'light' ? 'light' : null), 'the page is in ' + theme);
      await page.click('#syncChip'); await page.waitForTimeout(250);
      let r = await page.evaluate(() => { const p = document.getElementById('syncChipPanel'), b = p.getBoundingClientRect();
        const btn = p.querySelector('#cloudNotConnected button');
        return { open: !p.hidden, inView: b.left >= 0 && b.right <= innerWidth, turnOn: btn && btn.offsetParent !== null && btn.textContent.trim(), text: p.innerText }; });
      ok(r.open && r.inView, 'the panel opens on screen');
      ok(r.turnOn === '🔄Turn On Sync' || /Turn On Sync$/.test(r.turnOn || ''), 'for staff it holds Turn On Sync (' + r.turnOn + ')');
      ok(!SOURCE_WORDS.test(r.text), 'its words name no place');
      await page.evaluate(() => { isCloudConnected = true; googleAccessToken = 'simulated'; updateCloudUI(true); refreshSyncChip(); });
      r = await page.evaluate(() => Array.from(document.querySelectorAll('#syncChipPanel .cloud-dropdown-item')).filter(e => e.offsetParent).map(e => e.textContent.trim()));
      ok(['Send My Changes', 'Get Latest Changes', 'Disconnect'].every(w => r.some(t => t.indexOf(w) !== -1)), 'connected, it lists the sync actions (' + r.join(' / ') + ')');
      await page.evaluate(() => toggleCloudMenu()); await page.waitForTimeout(150);
      ok(await page.evaluate(() => document.getElementById('syncChipPanel').hidden), '"open the sync menu" toggles the same panel');
      await page.click('#topbarWho'); await page.waitForTimeout(250);
      r = await page.evaluate(() => { const m = document.getElementById('topbarAccountMenu'), b = m.getBoundingClientRect();
        return { open: !m.hidden, inView: b.left >= 0 && b.right <= innerWidth, items: Array.from(m.querySelectorAll('.tam-item')).filter(e => e.offsetParent).map(e => e.innerText.trim()),
          // (Items not on screen for this person — Change Password is a trainee's at home — are not measured.)
          small: Array.from(m.querySelectorAll('.tam-item')).filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).length }; });
      ok(r.open && r.inView, 'the initials open the account menu, on screen');
      ok(['Lock', theme === 'light' ? 'Dark mode' : 'Light mode', 'Two-Step Verification', 'Sign Out'].every(w => r.items.indexOf(w) !== -1), 'it holds Lock, the theme switch, Two-Step Verification and Sign Out (' + r.items.join(' / ') + ')');
      ok(r.small === 0, 'each item is at least 44px tall');
      await page.click('#topbarAccountMenu .tam-item[data-theme-toggle]'); await page.waitForTimeout(250);
      ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === (theme === 'light' ? null : 'light'), 'its theme item switches the theme');
      await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      ok(await page.evaluate(() => document.getElementById('topbarAccountMenu').hidden), 'Escape closes the menu');
      ok(errors.length === 0, 'no page errors — ' + errors.join(' | '));
      await ctx.close();
    }

    /* ---------- 2: a trainee ---------- */
    for (const theme of ['dark', 'light']) {
      console.log('A trainee\'s phone is calm (' + theme + ')');
      const { ctx, page, errors } = await session({ w: 390, phone: 1 }, theme, 'student');
      let r = await page.evaluate(() => ({ cls: document.getElementById('syncChip').className, title: document.getElementById('syncChip').title,
        staff: document.getElementById('syncChipWrap').classList.contains('staff') }));
      ok(/tone-ok/.test(r.cls) && r.title === 'All saved' && !r.staff, 'not signed in for syncing: "All saved", calm, no sync actions (' + r.cls + ' / ' + r.title + ')');
      await page.click('#syncChip'); await page.waitForTimeout(250);
      r = await page.evaluate(() => { const p = document.getElementById('syncChipPanel'); return { text: p.innerText, actions: !!p.querySelector('.sync-panel-actions').offsetParent }; });
      ok(!r.actions && /Nothing of yours is waiting/.test(r.text) && !/attention|ask the office/i.test(r.text), 'its panel says nothing of hers is waiting, with no actions');
      await page.evaluate(() => { examOutboxWrite([{ id: 'RES-1', studentId: currentStudent ? currentStudent.id : 'STU-tbrown', examId: 'EX-1', score: 80 }]); refreshSyncChip(); });
      r = await page.evaluate(() => ({ cls: document.getElementById('syncChip').className, title: document.getElementById('syncChip').title }));
      ok(/tone-warn/.test(r.cls) && /^Waiting to send/.test(r.title), 'an exam result of hers still to send: amber "Waiting to send" (' + r.title + ')');
      await page.evaluate(() => { googleAccessToken = null; isCloudConnected = false; CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', new Date(Date.now() - 3600e3).toISOString()); _consecutiveCloudSaveFailures = 3; refreshSyncChip(); });
      ok(!/tone-bad/.test(await page.getAttribute('#syncChip', 'class')), 'never red for a trainee, whatever this phone\'s sync state');
      ok(errors.length === 0, 'no page errors — ' + errors.join(' | '));
      await ctx.close();
    }
  } catch (e) {
    failed++; console.log('  ✗ harness: ' + (e && e.message));
  }
  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
