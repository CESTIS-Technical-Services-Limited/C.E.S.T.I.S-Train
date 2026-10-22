/* UI preview B, in a real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ui-preview-b.js
   Drives the real pages in headless Chromium with the outside world cut off,
   at a desktop size and at a 390-pixel phone, and checks what the owner was
   shown in the preview screenshots:
     - item 4: a sign-in failure is said under the card's own fields (no
       pop-up), the top bar names who is signed in, Lock covers the session
       with the idle lock, and the "sync first" note is there;
     - item 5: the sync health chip shows each state (simulated from the very
       values the save code keeps), its panel fits and closes with Escape,
       refreshing it writes nothing, and the sibling pages carry it too;
     - item 8: the forms that replaced prompt() boxes take focus, keep Tab
       inside, refuse a bad entry in place, save exactly what the prompt's
       answer saved, and no browser prompt box is used;
     - item 7: every sibling app loads the shared theme, has the dashboard's
       background and dark text on its amber buttons, prints without it, and
       does not scroll sideways on a phone;
   Every page is checked for page errors, console errors and sideways
   scrolling on the phone.
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
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
const VIEWPORTS = {
  desktop: { viewport: { width: 1366, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
};
const PW = { admin: 'Centre-Office-2026!', staff: 'Staff-Pass-2026!' };
// The owner's rule: nothing this preview shows says where the Centre's
// records come from or are kept (no Cloud, Google, Drive, server, network…).
const SOURCE_WORDS = /cloud|☁|google|\bdrive\b|gmail|server|network|\blan\b|offline|internet|emailjs|peerjs|broker|megadata/i;

/* A Centre with real accounts (each with a password of its own). */
async function seedAccounts(PW) {
  const now = new Date().toISOString();
  const add = async (u) => {
    const pw = u.pw; delete u.pw;
    if (userAccounts.some(x => x.id === u.id)) return;
    userAccounts.push(Object.assign({ status: 'active', createdAt: '2026-04-02', updatedAt: now }, u, { password: await hashPassword(pw) }));
  };
  await add({ id: 'USR-MTH', name: 'Marcia Thompson', role: 'admin', username: 'mthompson', pw: PW.admin });
  await add({ id: 'USR-KGO', name: 'Kemar Gordon', role: 'instructor', username: 'kgordon', programme: 'Electrical Installation', status: 'disabled', pw: PW.staff });
  await add({ id: 'USR-SWI', name: 'Shanice Williams', role: 'student', username: 'shanice.w', programme: 'Cosmetology', status: 'pending', pw: PW.staff });
  saveState();
  try { persistUserAccounts(); } catch (e) {}
  await new Promise(r => setTimeout(r, 300));
}

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  async function fresh(kind) {
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, VIEWPORTS[kind || 'desktop']));
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    ctx.errors = []; ctx.consoleErrors = [];
    return ctx;
  }
  async function open(ctx, rel, settle) {
    const page = await ctx.newPage();
    page.on('pageerror', e => ctx.errors.push(rel + ': ' + String(e.message)));
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text(), u = (m.location() || {}).url || '';
      // The outside world is cut off on purpose (Google, the CDNs, the public
      // video/chat relay). A missing file of our own is caught by the
      // response check below instead (the console names the page, not the file).
      if (/^Failed to load resource/.test(t)) return;
      if (/^WebSocket connection to 'wss?:\/\/(?!127\.0\.0\.1)/.test(t)) return;
      ctx.consoleErrors.push(rel + ': ' + t.slice(0, 200));
    });
    // Our own files must all be there. Two answers are 404 by design: the
    // Centre-server probe (this is not the Offline System) and the service
    // worker's kill switch.
    page.on('response', r => {
      const u = r.url();
      if (r.status() >= 400 && u.startsWith(base) && !/\/_cestis\/health|\/sw-disable/.test(u)) ctx.consoleErrors.push(rel + ': ' + r.status() + ' ' + u.replace(base, ''));
    });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(settle || 1500);
    return page;
  }
  async function seeded(ctx) {
    const page = await open(ctx, 'index.html');
    await page.evaluate(seedAccounts, PW);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    return page;
  }
  async function cardSignIn(page, card, user, pass) {
    if (!(await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), card))) {
      await page.click('#' + card + 'Card .role-enter-btn');
      await page.waitForTimeout(200);
    }
    await page.fill('#' + card + 'User', user);
    await page.fill('#' + card + 'Pass', pass);
    await page.press('#' + card + 'Pass', 'Enter');
    await page.waitForTimeout(900);
  }
  const noSideways = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const popups = page => page.evaluate(() => document.querySelectorAll('.cestis-alert-overlay.active').length);

  try {
    /* ------------------------------------------------ item 4: sign-in feedback */
    for (const kind of ['desktop', 'phone']) {
      console.log('Item 4 (' + kind + '): sign-in failures are said under the card');
      const ctx = await fresh(kind);
      const page = await seeded(ctx);
      await cardSignIn(page, 'admin', 'mthompson', 'not-the-password');
      let r = await page.evaluate(() => ({ text: document.getElementById('adminLoginError').innerText, shown: !document.getElementById('adminLoginError').hidden,
        role: document.getElementById('adminLoginError').getAttribute('role'), invalid: document.getElementById('adminPass').getAttribute('aria-invalid'),
        shell: document.getElementById('appShell').classList.contains('active') }));
      ok(r.shown && r.text === 'Password incorrect for "mthompson".', kind + ': a wrong password is said under the Administrator card (got "' + r.text + '")');
      ok(r.role === 'alert' && r.invalid === 'true', kind + ': announced (role=alert) and the field is marked invalid');
      ok(!r.shell && (await popups(page)) === 0, kind + ': no pop-up, and nobody is signed in');
      ok(await noSideways(page), kind + ': no sideways scrolling on the sign-in screen with the message showing');
      await page.type('#adminPass', 'x');
      ok(await page.evaluate(() => document.getElementById('adminLoginError').hidden), kind + ': typing again clears the message');
      await cardSignIn(page, 'instructor', 'kgordon', PW.staff);
      ok(/has been disabled/.test(await page.evaluate(() => document.getElementById('instructorLoginError').innerText)), kind + ': a switched-off account is said under its card');
      await cardSignIn(page, 'student', 'shanice.w', PW.staff);
      ok(/awaiting approval/.test(await page.evaluate(() => document.getElementById('studentLoginError').innerText)) &&
        !(await page.evaluate(() => !!document.getElementById('pendingApprovalScreen'))), kind + ': a registration still waiting is said under its card (no "Thank you for registering")');
      await cardSignIn(page, 'admin', 'cestisadmin', 'cestisadmin123$');
      ok(/default password published/.test(await page.evaluate(() => document.getElementById('adminLoginError').innerText)), kind + ': the published default, refused, is said under the card');
      ok((await popups(page)) === 0, kind + ': none of them raised a pop-up');

      console.log('Item 4 (' + kind + '): the top bar names who is signed in; Lock covers the session');
      await cardSignIn(page, 'admin', 'mthompson', PW.admin);
      await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      r = await page.evaluate(() => {
        const box = document.getElementById('topbarWho').getBoundingClientRect(), lock = document.getElementById('topbarLockBtn').getBoundingClientRect();
        return { name: document.getElementById('topbarWhoName').textContent, role: document.getElementById('topbarWhoRole').textContent,
          label: document.getElementById('topbarWho').getAttribute('aria-label'), avatar: document.getElementById('topbarWhoAvatar').textContent,
          inView: box.width > 0 && box.right <= innerWidth && lock.width > 0 && lock.right <= innerWidth, vw: innerWidth };
      });
      ok(r.name === 'Marcia Thompson' && r.role === 'Administrator' && r.avatar === 'MT', kind + ': the top bar says Marcia Thompson, Administrator');
      ok(r.label === 'Signed in as Marcia Thompson (Administrator)', kind + ': and says so to a screen reader');
      ok(r.inView, kind + ': the who block and Lock are on screen');
      ok(await noSideways(page), kind + ': no sideways scrolling on the dashboard');
      await page.click('#topbarLockBtn');
      await page.waitForTimeout(400);
      r = await page.evaluate(() => ({ locked: _sessionLocked, open: document.getElementById('idleLockModal').classList.contains('active'),
        why: document.getElementById('idleLockWhy').textContent, focus: document.activeElement && document.activeElement.id,
        beat: CESTISStore.getItem('voctrain_sessionSeenAt') }));
      ok(r.locked && r.open && r.why === 'You locked this session.', kind + ': Lock opens the session lock at once, saying the person locked it');
      ok(r.focus === 'idleLockPassword' && !r.beat, kind + ': the password box has focus and the session stops lending itself to new tabs');
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => document.getElementById('idleLockModal').classList.contains('active')), kind + ': Escape does not walk past it');
      await page.fill('#idleLockPassword', PW.admin);
      await page.press('#idleLockPassword', 'Enter');
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => !_sessionLocked && !document.getElementById('idleLockModal').classList.contains('active')), kind + ': the right password opens it again');

      console.log('Item 4 (' + kind + '): a new computer says "Sync first" in neutral words');
      const ctx2 = await fresh(kind);
      const p2 = await open(ctx2, 'index.html');
      r = await p2.evaluate(() => { const d = document.getElementById('loginSyncWhy'), b = d && d.getBoundingClientRect();
        return { there: !!d, text: d && d.innerText, visible: !!b && b.height > 0 && b.right <= innerWidth + 1 }; });
      ok(r.there && r.visible && /^Sync first — this brings this computer up to date before anyone signs in\./.test(r.text) && /ask the office for help\.$/.test(r.text),
        kind + ': the one-line "Sync first" note is under the sync bar (got "' + (r && r.text) + '")');
      ok(!SOURCE_WORDS.test(r.text), kind + ': and it names no place the records come from or are kept');
      r = await p2.evaluate(() => { document.getElementById('adminLogin').classList.add('active'); requireLoginSync('admin');
        const e = document.getElementById('adminLoginError'); return { shown: !e.hidden, text: e.innerText }; });
      ok(r.shown && /Sync Now/.test(r.text) && !SOURCE_WORDS.test(r.text), kind + ': a card pressed before syncing says so under it, naming no place ("' + r.text.replace(/\n+/g, ' ') + '")');
      ok(await noSideways(p2), kind + ': no sideways scrolling on a new computer\'s sign-in screen');
      ok(ctx.errors.length + ctx2.errors.length === 0, kind + ': no page errors — got: ' + ctx.errors.concat(ctx2.errors).join(' | '));
      ok(ctx.consoleErrors.length + ctx2.consoleErrors.length === 0, kind + ': no console errors — got: ' + ctx.consoleErrors.concat(ctx2.consoleErrors).join(' | '));
      await ctx.close(); await ctx2.close();
    }

    /* ------------------------------------------------ item 5: sync health chip */
    for (const kind of ['desktop', 'phone']) {
      console.log('Item 5 (' + kind + '): the top bar\'s chip says whether this computer\'s work is safe');
      const ctx = await fresh(kind);
      const page = await seeded(ctx);
      await cardSignIn(page, 'admin', 'mthompson', PW.admin);
      await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      // States are simulated by setting the very values the save code keeps
      // (no Google here: the outside world is cut off).
      const chipNow = () => page.evaluate(() => { refreshSyncChip(); const c = document.getElementById('syncChip');
        return { state: c.getAttribute('data-state'), label: document.getElementById('syncChipLabel').textContent, shown: document.getElementById('syncChipWrap').classList.contains('on') }; });
      let r = await chipNow();
      ok(r.shown && r.state === 'signin', kind + ': no Google sign-in on this computer — "' + r.label + '"');
      await page.evaluate(() => { CESTISStore.setItem('cestisPendingUpload', 'admin|' + new Date(Date.now() - 300000).toISOString()); });
      r = await chipNow();
      ok(r.state === 'signin' && /tone-bad/.test(await page.getAttribute('#syncChip', 'class')), kind + ': with unsent work it turns red');
      await page.evaluate(() => {
        googleAccessToken = 'simulated'; isCloudConnected = true;
        CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', new Date(Date.now() + 3000e3).toISOString());
      });
      r = await chipNow();
      ok(r.state === 'waiting' && r.label === 'Changes waiting', kind + ': connected with unsent work — Changes waiting');
      await page.evaluate(() => { CESTISStore.removeItem('cestisPendingUpload'); _lastAutoSaveResult = { uploaded: true, reason: 'nothing-new' }; });
      r = await chipNow();
      ok(r.state === 'saved' && r.label === 'All saved', kind + ': nothing waiting — All saved');
      await ctx.setOffline(true);
      await page.waitForTimeout(300);
      r = await chipNow();
      ok(r.state === 'offline' && r.label === 'Offline — saved on this device', kind + ': the connection drops — Offline — saved on this device');
      await ctx.setOffline(false);
      await page.click('#syncChip');
      r = await page.evaluate(() => { const p = document.getElementById('syncChipPanel'), b = p.getBoundingClientRect();
        return { open: !p.hidden, expanded: document.getElementById('syncChip').getAttribute('aria-expanded'), text: p.innerText, inView: b.left >= 0 && b.right <= innerWidth + 1 }; });
      ok(r.open && r.expanded === 'true' && /Last saved|No save recorded/.test(r.text), kind + ': pressing it shows the panel with the last saved time');
      ok(r.inView, kind + ': the panel fits on screen');
      ok(await noSideways(page), kind + ': no sideways scrolling with the panel open');
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => document.getElementById('syncChipPanel').hidden && document.activeElement.id === 'syncChip'), kind + ': Escape closes it and returns to the chip');
      const writes = await page.evaluate(() => { const w = CESTISStore.writes; for (let i = 0; i < 5; i++) refreshSyncChip(); return CESTISStore.writes - w; });
      ok(writes === 0, kind + ': refreshing the chip writes nothing to the store');

      console.log('Item 5 (' + kind + '): the sibling pages carry the same chip in their headers');
      const sib = await open(ctx, kind === 'desktop' ? 'Virement.Request.html' : 'Income.Expenditure.html', 2500);
      r = await sib.evaluate(() => { const c = document.querySelector('.cestis-sync-chip'); return c ? { state: c.getAttribute('data-state'), label: c.getAttribute('aria-label') } : null; });
      ok(!!r && ['saved', 'waiting', 'offline', 'signin'].indexOf(r.state) !== -1, kind + ': the sibling page shows its chip (' + (r && r.label) + ')');
      await sib.click('.cestis-sync-chip');
      ok(await sib.evaluate(() => !document.querySelector('.cestis-sync-chip-panel').hidden), kind + ': and its panel opens');
      ok(ctx.errors.length === 0, kind + ': no page errors — got: ' + ctx.errors.join(' | '));
      ok(ctx.consoleErrors.length === 0, kind + ': no console errors — got: ' + ctx.consoleErrors.join(' | '));
      await ctx.close();
    }

    /* ------------------------------------------------ item 8: prompt() boxes become forms */
    for (const kind of ['desktop', 'phone']) {
      console.log('Item 8 (' + kind + '): the document hub asks with one labelled form');
      const ctx = await fresh(kind);
      const page = await seeded(ctx);
      const asked = [];
      page.on('dialog', d => asked.push(d.type()));
      await cardSignIn(page, 'admin', 'mthompson', PW.admin);
      await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active'), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => {
        documentHubFiles.push({ id: 'DOC-T1', title: 'Fire Safety Policy 2026', description: 'Evacuation routes.', category: 'Policies', fileName: 'fire.pdf', fileType: 'application/pdf', fileSize: 1000, fileData: '', uploadedBy: 'Marcia Thompson', uploadedAt: '2026-09-14T10:00:00.000Z' });
        showPage('document-hub');
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.__back = document.activeElement; docHubEditFile('DOC-T1'); });
      await page.waitForTimeout(300);
      let r = await page.evaluate(() => { const o = document.querySelector('.cestis-form-overlay'), a = document.activeElement;
        return { open: !!o, role: o && o.getAttribute('role'), modal: o && o.getAttribute('aria-modal'), label: a && a.labels && a.labels[0] && a.labels[0].textContent, value: a && a.value,
          fits: o && o.querySelector('.cestis-form-box').getBoundingClientRect().right <= innerWidth }; });
      ok(r.open && r.role === 'dialog' && r.modal === 'true', kind + ': a modal dialog opens');
      ok(r.label === 'Title' && r.value === 'Fire Safety Policy 2026', kind + ': focus is in the labelled Title field, filled in');
      ok(r.fits && await noSideways(page), kind + ': it fits the screen, no sideways scrolling');
      for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
      ok(await page.evaluate(() => document.querySelector('.cestis-form-overlay').contains(document.activeElement)), kind + ': Tab stays inside the form');
      await page.fill('.cestis-form-overlay input', '   ');
      await page.click('.cestis-form-overlay .cf-submit');
      r = await page.evaluate(() => ({ err: document.querySelector('.cestis-form-error').innerText, invalid: document.querySelector('.cestis-form-overlay input').getAttribute('aria-invalid'),
        open: !!document.querySelector('.cestis-form-overlay'), title: documentHubFiles.find(d => d.id === 'DOC-T1').title }));
      ok(r.open && /Please fill in “Title”/.test(r.err) && r.invalid === 'true' && r.title === 'Fire Safety Policy 2026', kind + ': an empty title is refused in place, nothing saved');
      await page.fill('.cestis-form-overlay input', 'Fire Safety Policy 2026 (revised)');
      await page.press('.cestis-form-overlay input', 'Enter');
      await page.waitForTimeout(300);
      r = await page.evaluate(() => ({ open: !!document.querySelector('.cestis-form-overlay'), doc: documentHubFiles.find(d => d.id === 'DOC-T1'),
        stored: JSON.parse(CESTISStore.getItem('voctrain_documentHubFiles') || '[]').find(d => d.id === 'DOC-T1') }));
      ok(!r.open && r.doc.title === 'Fire Safety Policy 2026 (revised)' && r.doc.description === 'Evacuation routes.', kind + ': Enter saves both fields');
      ok(r.stored && r.stored.title === 'Fire Safety Policy 2026 (revised)', kind + ': and it is in the store, as the old prompt left it');
      await page.evaluate(() => docHubEditFile('DOC-T1'));
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => !document.querySelector('.cestis-form-overlay') && documentHubFiles.find(d => d.id === 'DOC-T1').title === 'Fire Safety Policy 2026 (revised)'),
        kind + ': Escape closes it and changes nothing');

      console.log('Item 8 (' + kind + '): Payroll asks for a corrected gross with an amount field');
      const pay = await open(ctx, 'Staff.Payslip.html', 2500);
      pay.on('dialog', d => asked.push(d.type()));
      await pay.evaluate('(' + fs.readFileSync(path.join(ROOT, 'tests/browser/upgrade-no-data-loss.js'), 'utf8').match(/async function oldPayslip\(\) \{[\s\S]*?\n\}/)[0] + ')()');
      await pay.evaluate(() => { const a = users.find(u => isAdminRole(u.role)); completeLogin(Object.assign({}, a)); _adminPayrollUnlockedUntil = new Date(Date.now() + 600000); });
      await pay.waitForTimeout(300);
      const before = await pay.evaluate(() => { const run = DATA.payrollRuns[DATA.payrollRuns.length - 1]; return { gross: run.results[0].gross, net: run.results[0].netPay }; });
      await pay.evaluate(() => editPayrollEntry(DATA.payrollRuns.length - 1, 0));
      await pay.waitForTimeout(300);
      await pay.fill('.cestis-form-overlay input', '300,000.5x');
      await pay.press('.cestis-form-overlay input', 'Enter');
      r = await pay.evaluate(() => ({ err: (document.querySelector('.cestis-form-error') || {}).innerText, gross: DATA.payrollRuns[DATA.payrollRuns.length - 1].results[0].gross }));
      ok(/must be a number/.test(r.err) && r.gross === before.gross, kind + ': letters in the amount are refused in place');
      await pay.fill('.cestis-form-overlay input', '300,000.50');
      await pay.press('.cestis-form-overlay input', 'Enter');
      await pay.waitForTimeout(400);
      r = await pay.evaluate(() => { const e = DATA.payrollRuns[DATA.payrollRuns.length - 1].results[0]; return { gross: e.gross, net: e.netPay, open: !!document.querySelector('.cestis-form-overlay') }; });
      ok(!r.open && r.gross === 300000.5 && r.net !== before.net, kind + ': the new gross is saved and the net pay worked out again');
      ok(asked.filter(t => t === 'prompt').length === 0, kind + ': no browser prompt box was used');
      ok(ctx.errors.length === 0, kind + ': no page errors — got: ' + ctx.errors.join(' | '));
      ok(ctx.consoleErrors.length === 0, kind + ': no console errors — got: ' + ctx.consoleErrors.join(' | '));
      await ctx.close();
    }

    /* ------------------------------------------------ item 7: one look across the sibling apps */
    for (const kind of ['desktop', 'phone']) {
      console.log('Item 7 (' + kind + '): every sibling app wears the dashboard\'s look on screen, and prints as before');
      const ctx = await fresh(kind);
      const page = await seeded(ctx);
      await cardSignIn(page, 'admin', 'mthompson', PW.admin);
      await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active'), null, { timeout: 15000 }).catch(() => {});
      const lms = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      for (const rel of ['School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html', 'Virement.Request.html',
        'Income.Expenditure.html', 'Payments.Invoices.html', 'Finance.Invoice.html', 'Finance.Payment.Voucher.html']) {
        if (kind === 'phone' && ['School.Fee.html', 'CESTIS.Cashbook.html', 'Virement.Request.html', 'Staff.Clock.in.html'].indexOf(rel) === -1) continue;
        const p = await open(ctx, rel, 2200);
        const r = await p.evaluate(() => {
          const sheet = [...document.styleSheets].find(s => /cestis-theme\.css/.test(s.href || ''));
          const prim = document.querySelector('.btn-primary, .btn-gold, .fd-actions > .btn:not(.ghost):not(.green)');
          return { loaded: !!(sheet && sheet.cssRules.length), bg: getComputedStyle(document.body).backgroundColor,
            primText: prim ? getComputedStyle(prim).color : null };
        });
        ok(r.loaded, kind + ': ' + rel + ' loads the shared theme');
        ok(r.bg === lms, kind + ': ' + rel + ' has the dashboard\'s background (' + r.bg + ' vs ' + lms + ')');
        if (r.primText) ok(r.primText === 'rgb(0, 0, 0)', kind + ': ' + rel + ': its primary button carries dark text on the amber');
        if (kind === 'phone') ok(await noSideways(p), kind + ': ' + rel + ' has no sideways scrolling on a phone');
        if (kind === 'desktop') {
          await p.emulateMedia({ media: 'print' });
          await p.waitForTimeout(500);   // School Fee eases its background over 0.3 s
          const printBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
          ok(printBg !== lms, kind + ': ' + rel + ' prints without the theme (' + printBg + ')');
          await p.emulateMedia({ media: 'screen' });
        }
        await p.close();
      }
      ok(ctx.errors.length === 0, kind + ': no page errors — got: ' + ctx.errors.join(' | '));
      ok(ctx.consoleErrors.length === 0, kind + ': no console errors — got: ' + ctx.consoleErrors.join(' | '));
      await ctx.close();
    }

    /* ------------------------------------------------ (later items append here) */
  } catch (e) {
    failed++;
    console.log('  ✗ harness: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
