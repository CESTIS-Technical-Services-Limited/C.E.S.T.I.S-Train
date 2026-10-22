/* The adversarial review's proofs of concept, kept as a permanent test, in a
   real browser (run manually / CI with a browser):
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/security-regressions.js
   Drives the real pages in headless Chromium with the network to the outside
   world cut, the way the reviewer did:
     H1/H2 a chat room and a Document Hub entry written by another device, merged
           by the dashboard's own merge functions, run nothing when the
           Administrator opens them (they ran with the Drive token in reach);
     H3    MegaData-Admin in a trainee's session shows "sign in first" and exports
           nothing (it downloaded every account's password hash);
     H4    School.Fee and the finance pages in a trainee's session show nothing
           (School.Fee signed them in as "CESTIS Administrator"); embedded in an
           Administrator's dashboard School.Fee opens as that person, and a
           student list posted by a window that is not its dashboard is ignored;
     H5    the published default opens neither Payroll nor the Cashbook on a PC
           whose dashboard has a real administrator; Payroll's first-run path
           (set a new password) works for an administrator signed in here;
     M1    while the dashboard is idle-locked a new tab cannot open the record
           pages with its session; after unlocking it can;
     L3    a poll with no options does not blank the room;
     M4    the signing key is stored locked in IndexedDB and still signs.
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

const ACCTS = {
  admin: { id: 'USR-real', name: 'Real Admin', role: 'admin', username: 'realadmin', pass: 'S0me-Real-Pass!', card: ['handleAdminClick', 'admin'] },
  student: { id: 'USR-stu1', name: 'Stu Dent', role: 'student', username: 'stu@example.com', pass: 'Stu-Pass-123', programme: 'Plumbing', card: ['handleStudentClick', 'student'] }
};

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  async function fresh() {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    return ctx;
  }
  async function open(ctx, rel, wait) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => (d.type() === 'confirm' ? d.accept() : d.dismiss()).catch(() => {}));
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(wait || 1500);
    return { page, errors };
  }
  async function seed(page) {
    await page.evaluate(async (A) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      for (const k of Object.keys(A)) {
        const a = A[k];
        if (users.some(u => u.id === a.id)) continue;
        users.push({ id: a.id, name: a.name, role: a.role, username: a.username, email: a.username.indexOf('@') > 0 ? a.username : a.username + '@example.com',
          password: await hashPassword(a.pass), status: 'active', programme: a.programme || '', course: a.programme || '', updatedAt: new Date().toISOString() });
      }
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, ACCTS);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
  }
  async function signIn(page, who) {
    const a = ACCTS[who], c = a.card;
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(async (c) => { if (!document.getElementById(c[1] + 'Login').classList.contains('active')) await window[c[0]](); }, c);
    await page.fill('#' + c[1] + 'User', a.username); await page.fill('#' + c[1] + 'Pass', a.pass);
    await page.evaluate(async (c) => { await window[c[0]](); }, c);
    await page.waitForTimeout(1000);
    return page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active') }));
  }
  // A section that throws is a failure of that section; the others still run.
  async function section(title, fn) {
    console.log(title);
    try { await fn(); } catch (e) { ok(false, title + ' — threw: ' + String(e && e.message).split('\n')[0]); }
  }
  const locked = p => p.evaluate(() => !!document.getElementById('cestisSessionLock') && /sign in|not part of your account/i.test(document.getElementById('cestisSessionLock').textContent));

  await section('H1/H2 — what another device writes runs nothing in the Administrator\'s session', async () => {
    const ctx = await fresh();
    const { page, errors } = await open(ctx, 'index.html');
    await seed(page);
    const r = await signIn(page, 'admin');
    ok(r.role === 'admin' && r.shell, 'the administrator signs in');
    await page.evaluate(() => {
      top.__pwn = [];
      const room = { id: 'chat-grp-evil', name: 'Study group', icon: '<img src=x onerror="top.__pwn.push(\'room-icon:\'+typeof googleAccessToken)">',
        type: 'group', members: userAccounts.map(u => u.id), color: '#09f" onmouseover="top.__pwn.push(\'room-color\')', createdBy: 'USR-stu1', updatedAt: new Date().toISOString() };
      // exactly as the shared chat file arrives: lmsChatSyncFromDrive's merge, then its clean-up
      CESTISCore.sync.mergeList(lmsChatRooms, [room], syncKeyById, { tombs: syncTombsFor('chatRooms') });
      saveLmsChatData();
      CESTISCore.sync.mergeList(documentHubFiles, [{ id: 'DOC-evil', title: 'Timetable', category: '<img src=x onerror="top.__pwn.push(\'dochub-category\')">',
        uploadedBy: '<img src=x onerror="top.__pwn.push(\'dochub-by\')">', uploadedDate: '<img src=x onerror="top.__pwn.push(\'dochub-date\')">',
        audience: 'all', fileName: 'a.pdf', fileSize: 10, downloads: '"><img src=x onerror="top.__pwn.push(\'dochub-dl\')">',
        fileData: 'javascript:top.__pwn.push("dochub-file")' }], syncKeyById, { tombs: syncTombsFor('documentHubFiles') });
      saveState();
    });
    await page.evaluate(() => showPage('lms-chat')); await page.waitForTimeout(800);
    await page.evaluate(() => lmsChatOpenRoom('chat-grp-evil', lmsChatGetRolePrefix())); await page.waitForTimeout(800);
    const hdr = await page.evaluate(() => { const e = document.querySelector('[id$=ChatHeaderAvatar]'); return e ? e.innerHTML : null; });
    ok(hdr !== null && hdr.indexOf('<img') === -1, 'the chat header draws the room\'s icon as text (it was innerHTML = room.icon) — got ' + JSON.stringify(hdr));
    await page.evaluate(() => showPage('document-hub')); await page.waitForTimeout(1000);
    await page.evaluate(() => { try { docHubPreviewFile('DOC-evil'); } catch (e) {} }); await page.waitForTimeout(600);
    await page.evaluate(() => { try { docHubDownloadFile('DOC-evil'); } catch (e) {} }); await page.waitForTimeout(400);
    // the shared chat file's own clean-up, run the way the poll does
    await page.evaluate(() => { lmsChatCleanRooms(); lmsChatRenderRoomList(lmsChatGetRolePrefix()); }); await page.waitForTimeout(300);
    const pwn = await page.evaluate(() => top.__pwn);
    ok(Array.isArray(pwn) && pwn.length === 0, 'nothing ran: chat header, room list, Document Hub list, preview, download — got ' + JSON.stringify(pwn));
    ok(await page.evaluate(() => (lmsChatRooms.find(r => r.id === 'chat-grp-evil') || {}).icon === '💬'), 'the merged room\'s icon was cleaned in the store as well');
    ok(errors.length === 0, 'no page errors — got ' + errors.join(' | '));

    console.log('L3 — a poll with no options does not blank the room');
    const poll = await page.evaluate(() => {
      const id = 'chat-grp-evil';
      lmsChatMessages[id] = (lmsChatMessages[id] || []).concat([{ id: 'M-poll', roomId: id, senderId: 'USR-stu1', senderName: 'Stu', type: 'poll', pollQuestion: 'Broken poll', timestamp: new Date().toISOString() },
        { id: 'M-after', roomId: id, senderId: 'USR-stu1', senderName: 'Stu', type: 'text', text: 'after the poll', timestamp: new Date().toISOString() }]);
      let threw = null;
      try { lmsChatRenderMessages(lmsChatGetRolePrefix()); } catch (e) { threw = e.message; }
      const box = document.getElementById(lmsChatGetRolePrefix() + 'ChatMessages');
      return { threw, shows: !!box && /Broken poll/.test(box.textContent) && /after the poll/.test(box.textContent) };
    });
    ok(!poll.threw && poll.shows, 'the room still draws, with the poll and the message after it — ' + JSON.stringify(poll));

    console.log('M4 — the signing key is stored locked and still signs');
    const key = await page.evaluate(async () => {
      const k = await CESTISCore.certs.sig.generateKey('browser test');
      await certSigningKeySave(k);                     // stored the old way: a readable JWK
      const migrated = await certSigningKeyLoad();      // the first load adds the locked copy
      const reread = await _certSigningKeyRead();
      const lockedOk = CESTISCore.certs.sig.isLockedKey(reread && reread.privateKey);
      let exported = true;
      try { await crypto.subtle.exportKey('jwk', reread.privateKey); } catch (e) { exported = false; }
      const done = await certSigningLockStored(migrated); // "the backup is saved": drop the JWK
      const final = await _certSigningKeyRead();
      const rec = await CESTISCore.certs.sig.sign(final, { no: 'WE-1', name: 'A', programme: 'P', date: '2026-10-01' });
      const v = await CESTISCore.certs.sig.verify(rec, { keys: [{ kid: final.kid, publicJwk: final.publicJwk }] });
      return { lockedOk, exported, done, hasJwk: !!final.privateJwk, verifies: v.result };
    });
    ok(key.lockedOk && !key.exported, 'a key stored as a JWK gains a locked copy that no script can export');
    ok(key.done && !key.hasJwk, 'after its backup, the readable copy is gone from IndexedDB');
    ok(key.verifies === 'valid', 'and certificates it signs still verify');
    await ctx.close();
  });

  await section('H3/H4 — pages with no sign-in of their own, in a trainee\'s session on a shared PC', async () => {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    await seed(page);
    // Staff used this PC first: the fee roll and the books are on it.
    await page.evaluate(() => {
      CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify([{ id: 'F1', name: 'Marker Feeperson', skillArea: 'Plumbing', phone: '876-555-0101', tuitionFee: 50000 }]));
      CESTISStore.setItem('cestis_finance_invoices', JSON.stringify([{ id: 'INV-1', no: '12551', client: 'Marker Client', lines: [] }]));
    });
    const r = await signIn(page, 'student');
    ok(r.role === 'student', 'a trainee signs in on the same PC');
    for (const rel of ['MegaData-Admin.html', 'MegaData-Adjudication.html', 'School.Fee.html', 'Virement.Request.html', 'Income.Expenditure.html',
                       'Payments.Invoices.html', 'Finance.Invoice.html', 'Finance.Quote.html', 'Finance.Purchase.Order.html', 'Finance.Payment.Voucher.html']) {
      const o = await open(ctx, rel, 2500);
      const s = await o.page.evaluate(() => ({ marker: /Marker Feeperson|Marker Client/.test(document.body.innerText),
        admin: /CESTIS Administrator/.test(document.body.innerText) }));
      ok(await locked(o.page), rel + ': shows only "sign in first"');
      ok(!s.marker && !s.admin, rel + ': and none of the Centre\'s records (nor a "CESTIS Administrator" session)');
      if (rel === 'MegaData-Admin.html') {
        let dl = null; o.page.once('download', d => { dl = d.suggestedFilename(); });
        const threw = await o.page.evaluate(() => { try { window.__adminExportBuild(); return false; } catch (e) { return true; } });
        await o.page.evaluate(() => { const b = document.getElementById('btnExport'); if (b) b.click(); }); await o.page.waitForTimeout(800);
        ok(threw && dl === null, 'MegaData-Admin: "Export local data" builds and downloads nothing for a trainee (it downloaded every password hash)');
      }
      if (rel === 'School.Fee.html') ok(await o.page.evaluate(() => currentUser === null && feeViewer === null), 'School.Fee: nobody is signed in to it');
      ok(o.errors.length === 0, rel + ': no page errors — got ' + o.errors.join(' | '));
      await o.page.close();
    }
    await ctx.close();
  });

  await section('H4 — School.Fee embedded in the Administrator\'s dashboard opens as that person', async () => {
    const ctx = await fresh();
    const { page, errors } = await open(ctx, 'index.html');
    await seed(page);
    await signIn(page, 'admin');
    await page.evaluate(() => showPage('fee-management')); await page.waitForTimeout(4000);
    const fee = await page.evaluate(() => {
      const w = document.getElementById('feeManagementFrame').contentWindow;
      // (currentUser is a top-level let in the page, not a window property)
      return w && { user: w.eval('currentUser && currentUser.fullName'), role: w.eval('currentUser && currentUser.role'), lock: !!w.document.getElementById('cestisSessionLock'),
        display: (w.document.getElementById('currentUserDisplay') || {}).textContent };
    });
    ok(fee && !fee.lock && fee.user === 'Real Admin' && fee.role === 'Admin', 'embedded, it opens for the signed-in administrator, by name — got ' + JSON.stringify(fee));
    // A window that is not its dashboard posts a forged student list.
    const forged = await page.evaluate(async () => {
      const w = document.getElementById('feeManagementFrame').contentWindow;
      const names = () => w.eval('JSON.stringify(students.map(function (s) { return s.name || s.fullName || ""; }))');
      const before = names();
      const pop = window.open('about:blank');
      // the same origin, but not the frame's parent
      pop.eval('opener.document.getElementById("feeManagementFrame").contentWindow.postMessage({ type: "cestis-lms-students", students: [{ id: "STU-forged", name: "Forged Person", course: "Plumbing" }] }, "*")');
      await new Promise(r => setTimeout(r, 800));
      pop.close();
      const after = names();
      return { before, after, forged: /Forged Person/.test(after) };
    });
    ok(!forged.forged, 'a student list posted by another window is ignored (any window could post one)');
    ok(errors.length === 0, 'no dashboard page errors — got ' + errors.join(' | '));
    await ctx.close();
  });

  await section('H5 — the published default opens neither Payroll nor the Cashbook', async () => {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    await seed(page);                                     // this device holds a real administrator
    let p = (await open(ctx, 'Staff.Payslip.html', 2000)).page;
    await p.fill('#username', 'Cestisadmin'); await p.fill('#password', 'cestisadmin123$');
    await p.evaluate(async () => { await handleLogin(); }); await p.waitForTimeout(1500);
    let s = await p.evaluate(() => ({ user: currentUser && currentUser.username, err: document.getElementById('loginErrorText').textContent,
      change: document.getElementById('loginStepNewPassword').style.display === 'block', in: sessionStorage.getItem('isLoggedIn') === 'true' }));
    ok(!s.user && !s.in && !s.change, 'Payroll refuses the published default here (it opened as Administrator) — ' + JSON.stringify(s));
    ok(/dashboard/i.test(s.err), 'and says an administrator must sign in to the dashboard first');
    await p.close();
    for (const u of ['cestisadmin', 'adminstaff']) {
      p = (await open(ctx, 'CESTIS.Cashbook.html', 1500)).page;
      await p.fill('#loginUser', u); await p.fill('#loginPass', 'cestisadmin123$');
      await p.evaluate(() => handleLogin({ preventDefault() {} })); await p.waitForTimeout(2000);
      const c = await p.evaluate(() => ({ authed: isAuthenticated(), msg: document.getElementById('loginErrorMsg').textContent }));
      ok(!c.authed && /default password/i.test(c.msg), 'the Cashbook refuses ' + u + ' with the published default, and says why — ' + JSON.stringify(c));
      await p.close();
    }
    p = (await open(ctx, 'CESTIS.Cashbook.html', 1500)).page;
    await p.fill('#loginUser', 'realadmin'); await p.fill('#loginPass', 'S0me-Real-Pass!');
    await p.evaluate(() => handleLogin({ preventDefault() {} })); await p.waitForTimeout(2000);
    ok(await p.evaluate(() => isAuthenticated()), 'while the real administrator signs in to the Cashbook');
    await p.evaluate(() => handleLogout());
    await p.close();

    // First run: an administrator signed in to the dashboard sets Payroll's own password.
    await signIn(page, 'admin');
    p = (await open(ctx, 'Staff.Payslip.html', 2000)).page;
    await p.fill('#username', 'Cestisadmin'); await p.fill('#password', 'cestisadmin123$');
    await p.evaluate(async () => { await handleLogin(); }); await p.waitForTimeout(1500);
    ok(await p.evaluate(() => document.getElementById('loginStepNewPassword').style.display === 'block' && sessionStorage.getItem('isLoggedIn') !== 'true'),
      'with an administrator signed in here, the default leads only to "set a new password"');
    await p.fill('#newPassword', 'Payroll-Own-12'); await p.fill('#confirmNewPassword', 'Payroll-Own-12');
    await p.evaluate(async () => { await resetPassword(); }); await p.waitForTimeout(1500);
    s = await p.evaluate(() => ({ in: sessionStorage.getItem('isLoggedIn') === 'true', user: currentUser && currentUser.username,
      stored: (JSON.parse(CESTISStore.getItem('dashboardUsers') || '[]')[0] || {}) }));
    ok(s.in && s.user === 'Cestisadmin' && /^pbkdf2\$/.test(s.stored.password) && !s.stored.defaultPassword, 'after a password of its own, Payroll opens — ' + JSON.stringify({ in: s.in, user: s.user }));
    await p.close();
    await ctx.close();
  });

  await section('M1 — an idle-locked dashboard lends its session to no new tab', async () => {
    const ctx = await fresh();
    const { page } = await open(ctx, 'index.html');
    await seed(page);
    await signIn(page, 'admin');
    const pages = ['Student-Progress.html', 'Transcript-Grades.html', 'Cert-Transcript-Requests.html', 'Staff.Clock.in.html'];
    const viewerOf = p => p.evaluate(() => {
      const v = (typeof SP_VIEWER !== 'undefined' ? SP_VIEWER : (typeof VIEWER !== 'undefined' ? VIEWER : null));
      return { ok: !!(v && v.ok), clock: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.fullName : null };
    });
    let o = await open(ctx, 'Student-Progress.html');
    ok((await viewerOf(o.page)).ok, 'unlocked: a new tab opens Student Progress for the administrator');
    await o.page.close();
    await page.evaluate(() => openIdleLock()); await page.waitForTimeout(300);
    await page.evaluate(() => { try { sessionHeartbeat(); } catch (e) {} });
    for (const rel of pages) {
      o = await open(ctx, rel);
      const v = await viewerOf(o.page);
      ok(!v.ok && !v.clock, rel + ' in a new tab while the dashboard is locked: no session (it got the administrator\'s)');
      await o.page.close();
    }
    await page.fill('#idleLockPassword', 'S0me-Real-Pass!');
    await page.evaluate(async () => { await idleLockUnlock(); }); await page.waitForTimeout(300);
    o = await open(ctx, 'Transcript-Grades.html');
    ok((await viewerOf(o.page)).ok, 'after unlocking with the password, it opens again');
    await o.page.close();
    await ctx.close();
  });

  await browser.close();
  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });   // a crash must not leave the browser holding the run open
