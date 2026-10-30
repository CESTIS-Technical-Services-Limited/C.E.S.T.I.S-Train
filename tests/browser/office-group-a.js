/* The office's day, in real browsers (productivity audit, group A — "Let the
   office run itself").

     NODE_PATH=/opt/node-tools/node_modules node tests/browser/office-group-a.js

   The site served from this worktree, the Centre's shared files in memory
   (fake-drive.js), every other request cut off. Checks:
     A. The Administrator's "Office today" lines, one click to their page; the
        menu groups she opened are open again at her next sign-in.
     B. Admin Staff with ticks of their own: the Administrator's WORKING
        Attendance page (Save works), an announcement for one programme only;
        a colleague on the default has neither.
     C. Admin Staff reset a trainee's password: a first-sign-in code and her
        slip (a real PDF); never a staff login. The trainee signs in on an
        office computer with the code and must choose her own password first.
     D. New trainee with no password typed: her slip; gender on her records.
     E. School Fee: the next receipt number filled in (R-2026/27-…); not
        covered on entry.
     F. A request row's "Mark collected": the request collected, the trainee
        told in her own bell.
   No page errors. */
'use strict';
const path = require('path');
const kit = require('./gate-kit');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const Core = require('../../cestis-core.js');
const { chromium } = require('playwright-core');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const ADMIN = { id: 'USR-mthompson', name: 'Marcia Thompson', user: 'mthompson', pass: 'Centre-Admin-2026!' };
const STAFF = { id: 'USR-sbrown', name: 'Sheryl Brown', user: 'sbrown', pass: 'Office-Staff-2026!' };
const STAFF2 = { id: 'USR-ngordon', name: 'Nadine Gordon', user: 'ngordon', pass: 'Office-Staff2-2026!' };
const PROGS = ['Welding & Fabrication', 'Electrical Installation', 'Cosmetology', 'Commercial Cooking', 'Plumbing'];
const NAMES = ['Akeem Williams', 'Brianna Grant', 'Chevaughn Morgan', 'Dalvia Richards', 'Everton Campbell', 'Fabian Thompson', 'Gaynelle Lindo', 'Horace Facey', 'Imani Bailey', 'Jovaun Gordon'];
const T = NAMES.map((n, i) => ({ id: 'USR-t' + i, name: n, user: n.toLowerCase().replace(' ', '.'), prog: PROGS[i % 5], sid: Core.stableStudentId({ name: n, course: PROGS[i % 5] }) }));
const errors = [];

async function computer(browser, base, drive) {
  const ctx = await browser.newContext({ timezoneId: 'America/Jamaica', viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(base)) return r.continue();
    if (/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(u)) return drive ? drive.handle(r) : r.abort();
    return r.abort();
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('cestis_sw_disabled', '1'); } catch (e) {} });
  return ctx;
}
async function seed(page, base, access) {
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(async ({ ADMIN, STAFF, STAFF2, T, token, access }) => {
    const now = new Date().toISOString();
    const hash = await hashPassword('Trainee-Pass-2026');
    const users = [
      { id: ADMIN.id, name: ADMIN.name, role: 'admin', username: ADMIN.user, email: 'mthompson@example.com', password: await hashPassword(ADMIN.pass), status: 'active', updatedAt: now },
      { id: STAFF.id, name: STAFF.name, role: 'adminstaff', username: STAFF.user, email: 'sbrown@example.com', password: await hashPassword(STAFF.pass), status: 'active', updatedAt: now },
      { id: STAFF2.id, name: STAFF2.name, role: 'adminstaff', username: STAFF2.user, email: 'ngordon@example.com', password: await hashPassword(STAFF2.pass), status: 'active', updatedAt: now }];
    const studs = [];
    T.forEach((t, i) => {
      users.push({ id: t.id, name: t.name, role: 'student', username: t.user, email: t.user + '@example.com', programme: t.prog, studentDataId: t.sid, password: hash, status: 'active', updatedAt: now });
      studs.push({ id: t.sid, name: t.name, course: t.prog, stage: 'training', email: t.user + '@example.com', progress: 40, createdAt: '2026-09-01', updatedAt: now });
    });
    users.push({ id: 'USR-home-1', name: 'Shantelle Barrett', role: 'student', username: 'shantelle.barrett', email: 'shantelle.barrett@gmail.com', phone: '876-555-0147', programme: 'Cosmetology',
      password: hash, status: 'pending', registeredVia: 'home-registration', createdAt: '2026-10-27', updatedAt: now });
    CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
    CESTISStore.setItem('voctrain_certTranscriptRequests', JSON.stringify([
      Object.assign(CESTISCore.Transcript.newRequest({ studentId: T[1].sid, studentName: T[1].name, course: T[1].prog, type: 'transcript', requestedAt: new Date(Date.now() - 9 * 86400000).toISOString() }), { status: 'ready' })]));
    CESTISStore.setItem('cestiFeeStructure', JSON.stringify({ 'Welding & Fabrication': { total: 85000, terms: [20000, 20000, 20000, 25000, 0, 0, 0, 0, 0] } }));
    if (access) { access.updatedAt = now; CESTISStore.setItem('voctrain_adminStaffAccess', JSON.stringify(access)); }
    Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k]));
  }, { ADMIN, STAFF, STAFF2, T, token: driveTokenSeed(), access: access || null });
}
async function signIn(page, who, card) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const open = await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), card);
  if (!open) await page.click('#' + card + 'Card .role-enter-btn');
  await page.waitForTimeout(200);
  await page.fill('#' + card + 'User', who.user);
  await page.fill('#' + card + 'Pass', who.pass);
  await page.press('#' + card + 'Pass', 'Enter');
}
async function signedIn(page, role) {
  await page.waitForFunction(r => document.getElementById('appShell').classList.contains('active') && currentRole === r, role, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(x => x.remove()); });
}
async function frameOf(page, rx) {
  for (let i = 0; i < 60; i++) { const f = page.frames().filter(x => rx.test(x.url())).pop(); if (f) { try { await f.waitForLoadState('load'); } catch (e) {} return f; } await page.waitForTimeout(200); }
  return null;
}

(async () => {
  const srv = await kit.serve({});
  const base = srv.base;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    /* ---------------- A ---------------- */
    console.log('A. The Administrator\'s "Office today", and her menu groups');
    {
      const ctx = await computer(browser, base, new FakeDrive());
      const page = await ctx.newPage();
      await seed(page, base);
      await signIn(page, ADMIN, 'admin');
      await signedIn(page, 'admin');
      await page.waitForSelector('#officeTodayCard .ot-line', { timeout: 10000 });
      const lines = await page.evaluate(() => Array.from(document.querySelectorAll('#officeTodayCard .ot-line')).map(b => b.getAttribute('data-ot') + ':' + b.innerText.replace(/\s+/g, ' ')));
      ok(lines.some(l => /^registrations:1 registration waiting for approval/.test(l)), 'a registration waiting (' + lines[0] + ')');
      ok(lines.some(l => /^details:/.test(l)) && lines.some(l => /^fees:/.test(l)) && lines.some(l => /^certificates:/.test(l)) && lines.some(l => /^requests:/.test(l)), 'five lines for the Administrator');
      await page.click('#officeTodayCard .ot-line[data-ot="registrations"]');
      await page.waitForTimeout(800);
      ok(await page.evaluate(() => document.getElementById('page-verify-users').classList.contains('active')), 'one click opens Verify Users');
      await page.click('#sidebarNav .nav-section-toggle:has-text("Administration")');
      await signIn(page, ADMIN, 'admin');
      await signedIn(page, 'admin');
      ok(await page.evaluate(() => { const l = Array.from(document.querySelectorAll('#sidebarNav .nav-section-toggle')).find(x => /Administration/.test(x.textContent)); return !!l && !l.classList.contains('collapsed'); }),
        'signed in again: Administration is still open (remembered on this computer)');
      await ctx.close();
    }
    /* ---------------- B + C ---------------- */
    console.log('B. Admin Staff do the work they are given; C. a trainee\'s code and slip');
    {
      const drive = new FakeDrive();
      const ctx = await computer(browser, base, drive);
      const page = await ctx.newPage();
      const now = new Date().toISOString();
      await seed(page, base, { traineeaccounts: true, video: true, people: { [STAFF.id]: { attendance: true, announcements: true, certificates: true, traineeaccounts: true, video: true, updatedAt: now } } });
      await signIn(page, STAFF, 'adminStaff');
      await signedIn(page, 'adminstaff');
      const nav = await page.evaluate(() => Array.from(document.querySelectorAll('#sidebarNav .nav-item')).map(n => n.getAttribute('data-page')));
      ok(nav.indexOf('attendance') !== -1 && nav.indexOf('announcements') !== -1 && nav.indexOf('certificates') !== -1, 'her own ticks: the Administrator\'s working pages');
      await page.click('#sidebarNav .nav-item[data-page="attendance"]');
      await page.waitForSelector('#attendanceTableBody', { timeout: 10000 });
      await page.waitForTimeout(800);
      await page.click('button[onclick="attendanceMarkAllToday(\'admin\')"]');
      await page.click('button[onclick="saveAttendance()"]');
      await page.waitForTimeout(800);
      ok(await page.evaluate(() => (attendanceRegister || []).length > 0), 'Attendance: marked and saved by Admin Staff');
      await page.click('#sidebarNav .nav-item[data-page="announcements"]');
      await page.waitForSelector('button[onclick="toggleAnnouncementForm()"]', { timeout: 10000 });
      await page.click('button[onclick="toggleAnnouncementForm()"]');
      await page.fill('#annTitle', 'Cosmetology kits');
      await page.fill('#annBody', 'Collect your kits from the office on Monday between 9 and 12.');
      await page.selectOption('#annCourse', 'Cosmetology');
      await page.click('#announcementForm button[onclick="createAnnouncement()"]');
      await page.waitForTimeout(500);
      ok(await page.evaluate(() => { const a = announcements.find(x => x.title === 'Cosmetology kits'); return !!a && a.course === 'Cosmetology'; }), 'an announcement for Cosmetology trainees only');
      // C: a trainee's code
      await page.click('#sidebarNav .nav-item[data-page="as-trainee-accounts"]');
      await page.waitForSelector('#vuResetSearch', { timeout: 10000 });
      await page.fill('#vuResetSearch', 'ngordon');
      await page.waitForTimeout(300);
      ok(/No trainee account matches/.test(await page.evaluate(() => document.getElementById('vuResetResults').innerText)), 'a staff login is not offered for a reset');
      await page.fill('#vuResetSearch', 'Brianna');
      await page.waitForTimeout(300);
      await page.click('#vuResetResults button:has-text("Reset password")');
      await page.waitForSelector('#resetPasswordModal.active', { timeout: 5000 });
      ok(await page.isVisible('#resetPwCodeBtn'), 'a trainee\'s reset offers a first-sign-in code');
      await page.click('#resetPwCodeBtn');
      await page.waitForSelector('#signInSlipsModal.active', { timeout: 20000 });
      const code = await page.evaluate(() => (document.querySelector('#slipsList .slips-code') || {}).textContent || '');
      ok(/^\d{10}$/.test(code), 'her slip\'s code is shown, ten digits');
      ok(/cannot be shown again/.test(await page.evaluate(() => document.getElementById('signInSlipsModal').innerText)), 'the dialog says the slips can be printed only now');
      const dl = page.waitForEvent('download', { timeout: 30000 });
      await page.click('#slipsDownloadBtn');
      const d = await dl;
      const pdf = require('fs').readFileSync(await d.path());
      ok(pdf.slice(0, 5).toString() === '%PDF-' && /Brianna Grant/.test(d.suggestedFilename()), 'her slip, a PDF (' + d.suggestedFilename() + ')');
      await page.click('#signInSlipsModal button:has-text("Done")');
      const acct = await page.evaluate(() => { const a = userAccounts.find(u => u.name === 'Brianna Grant'); return { inForce: CESTISCore.accountAccess.firstCodeInForce(a), json: JSON.stringify(a) }; });
      ok(acct.inForce && acct.json.indexOf(code) === -1, 'her account holds the code only as its hash');
      // The trainee signs in on this office computer with her code.
      await page.evaluate(() => { try { saveUserAccounts(); } catch (e) {} });
      await page.waitForTimeout(500);
      await page.evaluate(() => { try { logout(); } catch (e) {} });
      await page.waitForTimeout(1500);
      await signIn(page, { user: 'brianna.grant', pass: code }, 'student');
      await page.waitForSelector('#forceChangePwModal.active', { timeout: 20000 });
      ok(/You signed in with the code on your slip/.test(await page.evaluate(() => document.getElementById('forceChangePwWhy').textContent)), 'signed in with the code: she must choose her own password first');
      await page.fill('#forceChangePwNew', 'Brianna-Own-2026');
      await page.fill('#forceChangePwConfirm', 'Brianna-Own-2026');
      await page.click('#forceChangePwModal button.btn-primary');
      await signedIn(page, 'student');
      ok(await page.evaluate(() => { const a = userAccounts.find(u => u.name === 'Brianna Grant'); return !CESTISCore.accountAccess.firstCodeInForce(a) && !a.firstSignInCode; }), 'her own password set: the code no longer works');
      await ctx.close();
    }
    /* ---------------- B (a colleague on the default) ---------------- */
    {
      const ctx = await computer(browser, base, new FakeDrive());
      const page = await ctx.newPage();
      await seed(page, base, { traineeaccounts: true, video: true, people: { [STAFF.id]: { attendance: true, updatedAt: new Date().toISOString() } } });
      await signIn(page, STAFF2, 'adminStaff');
      await signedIn(page, 'adminstaff');
      const nav = await page.evaluate(() => Array.from(document.querySelectorAll('#sidebarNav .nav-item')).map(n => n.getAttribute('data-page')));
      ok(nav.indexOf('attendance') === -1, 'a colleague on the default does not get her ticks');
      await ctx.close();
    }
    /* ---------------- D + E + F ---------------- */
    console.log('D. New trainee with no password; E. the next receipt number; F. a request collected');
    {
      const drive = new FakeDrive();
      const ctx = await computer(browser, base, drive);
      const page = await ctx.newPage();
      await seed(page, base);
      await signIn(page, ADMIN, 'admin');
      await signedIn(page, 'admin');
      await page.click('.quick-action-btn:has-text("Add Student")');
      await page.waitForSelector('#addTraineeModal.active', { timeout: 5000 });
      ok((await page.evaluate(() => document.getElementById('addTraineeTitle').textContent)) === 'New trainee', 'the dashboard\'s Add Student opens the New trainee form');
      await page.fill('#atName', 'Jhenelle Morgan');
      await page.selectOption('#atGender', 'Female');
      await page.fill('#atEmail', 'jhenelle.morgan@gmail.com');
      await page.selectOption('#atProgramme', 'Welding & Fabrication');
      await page.click('#atMore summary');
      await page.fill('#atDob', '2006-07-21');
      await page.fill('#atEmergencyName', 'Marcia Morgan');
      await page.fill('#atEmergencyPhone', '876-555-0190');
      await page.click('#atCreateBtn');
      await page.waitForSelector('#signInSlipsModal.active', { timeout: 20000 });
      ok(/Jhenelle Morgan/.test(await page.evaluate(() => document.getElementById('slipsList').innerText)), 'no password typed: her slip to print');
      await page.click('#signInSlipsModal button:has-text("Done")');
      await page.waitForTimeout(1000);
      const rec = await page.evaluate(() => { const s = students.find(x => x.name === 'Jhenelle Morgan'); let f = null; try { f = JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').find(x => x.lmsId === s.id); } catch (e) {}
        return { gender: s && s.gender, dob: s && s.dob, fee: f && { dob: f.dateOfBirth, emergency: f.emergencyContactName + ' ' + f.emergencyContact } }; });
      ok(rec.gender === 'Female' && rec.dob === '2006-07-21' && rec.fee && rec.fee.dob === '2006-07-21' && rec.fee.emergency === 'Marcia Morgan 876-555-0190', 'her trainee and fee records have her details (' + JSON.stringify(rec) + ')');
      // E
      await page.evaluate(() => showPage('fee-management'));
      const fr = await frameOf(page, /School\.Fee\.html/);
      await fr.waitForFunction(() => typeof students !== 'undefined' && students.length > 5, null, { timeout: 30000 });
      ok(!(await fr.evaluate(() => inactivityScreenActive)), 'School Fee is not covered on entry');
      await fr.click('button.nav-tab:has-text("Payments")');
      await fr.fill('#traineeSearch', 'Akeem');
      await page.waitForTimeout(400);
      await fr.click('#traineeSearchResults [role=option]');
      await page.waitForTimeout(2500);
      const rn = await fr.evaluate(() => document.getElementById('receiptNumber').value);
      ok(/^R-2026\/27-0001(-[A-Z2-9]{2})?$/.test(rn), 'the next receipt number filled in: ' + rn);
      // F
      await page.evaluate(() => showPage('cert-transcript-requests'));
      const cr = await frameOf(page, /Cert-Transcript-Requests\.html/);
      await cr.waitForSelector('#crRows button', { timeout: 15000 });
      ok(/9 days waiting/.test(await cr.evaluate(() => document.getElementById('crRows').innerText)), 'the request says "9 days waiting"');
      await cr.click('#crRows button:has-text("Mark collected")');
      await page.waitForTimeout(1500);
      const after = await page.evaluate(sid => { const r = JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests'))[0]; const u = userAccounts.find(a => a.studentDataId === sid);
        return { status: r.status, told: (notifications || []).filter(n => n.forUsers && n.forUsers.indexOf(u.id) !== -1).map(n => n.text) }; }, T[1].sid);
      ok(after.status === 'collected' && after.told.some(t => /request is complete/.test(t)), 'Mark collected: the request collected, and she is told in her own bell (' + JSON.stringify(after) + ')');
      await ctx.close();
    }
  } catch (e) {
    failed++;
    console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  console.log('page errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  process.exit(failed || errors.length ? 1 : 0);
})();
