/* A person's own profile changes stay — in real browsers:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/profile-persistence.js
                                               (npm run test:browser:profile)

   The owner's report: "when account holders change profile picture, status
   etc, and any other thing to their personal profile, it should be added to
   their drive folder created by VocTrain and changes always show and not
   disappear when log out and log in back."

   What went wrong (see CESTISCore.profiles): the device kept chat profiles
   without their pictures, and merged profiles WHOLE by a date that moves
   every time their owner is seen online — so a device holding the profile
   without its picture, just seen online, deleted the picture (and put an old
   status message back) everywhere; sign-in and sign-out wrote "online" and
   "offline" over the status the person chose; a trainee's sign-out threw her
   own phone and e-mail away (kept under the wrong key); a member of staff's
   phone number never left the computer it was typed on, and their name and
   e-mail went back at the next sync (the account was never dated); and a
   trainee at home through the trainee gate could change her picture and
   status, but they never left her phone at all.

   Here, over the Centre's shared files (tests/browser/fake-drive.js) and the
   REAL trainee gate (tests/browser/fake-gate.js), every device its own
   browser storage:
     1. A trainee on an office PC: Edit Profile — a new picture, status Away,
        a status message, a new phone number — Save; she signs out and in
        again on the same PC, then on another PC: all of it is there, the
        status still Away after the chat page has seen her online, and her
        own folder holds her profile and her picture as a file.
     2. The shared copies lose her profile (as an older build's copy did):
        a third PC brings it all back from her own folder.
     3. Staff: the administrator (picture, status, message, phone, e-mail)
        and an instructor (picture, status, phone, about): signed out and in
        again on another PC — all there.
     4. A trainee at home through the trainee gate: her picture, status,
        message and phone reach the office; she signs out (her phone is
        emptied) and signs in on another phone: all there.
   Screenshots (light and dark) of the profile with its picture are written
   to $CESTIS_PROFILE_SHOTS (default: <tmp>/cestis-profile-shots).
   No page errors anywhere. Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');

const { TRAINEES, TRAINEE_PASS, ADMIN } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_PROFILE_SHOTS || path.join(os.tmpdir(), 'cestis-profile-shots');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 400); }
}
const TAMEKA = TRAINEES[0], KEMAR = TRAINEES[1];
const INSTR = { id: 'USR-kbrown', name: 'Kevin Brown', user: 'kbrown', pass: 'Instructor-Pass-2026', prog: 'Welding & Fabrication' };
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));

// A real photo for the file input (a JPEG made by a canvas, 640×480).
async function makeJpeg(page, colour) {
  const b64 = await page.evaluate(async (colour) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 640, 480);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(320, 200, 110, 0, Math.PI * 2); g.fill(); g.fillRect(170, 330, 300, 150);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, colour);
  return Buffer.from(b64, 'base64');
}

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const K = kit.make({ browser, base: srv.base, errors });

  const landed = page => page.waitForFunction(() => document.getElementById('landingPage').style.display !== 'none' && !document.getElementById('appShell').classList.contains('active'), null, { timeout: 30000 });
  async function signIn(page, card, user, pass) {
    await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(c => { const l = document.getElementById(c + 'Login'); if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click(); }, card);
    await page.waitForTimeout(200);
    await page.fill('#' + card + 'User', user);
    await page.fill('#' + card + 'Pass', pass);
    await page.press('#' + card + 'Pass', 'Enter');
    await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });
  }
  // The person presses Sign Out; the device is wiped once the last save has gone.
  async function signOut(page) {
    await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });
    await page.click('.logout-btn');
    await landed(page);
    await page.waitForFunction(() => !currentRole, null, { timeout: 30000 });
    await page.waitForTimeout(800);
  }
  // A PC that has never been used: the Centre's sign-in for syncing, then its first sync.
  async function freshPc(label) {
    const ctx = await K.computer({ drive, scale: 2 });
    const page = K.watch(await ctx.newPage(), label);
    await page.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.evaluate(token => { Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k])); }, driveTokenSeed());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => loginSyncCompleted && userAccounts.some(u => u && u.role === 'student'), null, { timeout: 60000 }).catch(() => {});
    return page;
  }
  // What the page holds of a person's own profile.
  const mine = (page, acct, sid, iid) => page.evaluate(({ acct, sid, iid }) => {
    const cp = lmsChatProfiles[acct] || {};
    const u = userAccounts.find(a => a && a.id === acct) || {};
    const side = document.querySelector('#sidebarAvatar img');
    return { pic: cp.profilePic || '', choice: CESTISCore.profiles.chosenStatus(cp), shown: cp.status, msg: cp.statusMsg || '', bio: cp.bio || '',
      sp: sid ? (studentProfiles[sid] || {}) : null, ip: iid ? (instructorProfiles[iid] || {}) : null, phone: u.phone || '', email: u.email || '', name: u.name || '',
      sidebar: side ? side.getAttribute('src') : '' };
  }, { acct, sid, iid });
  const ownFolderFiles = acct => {
    const prof = Object.values(drive.files).find(f => f.name === 'profile.json' && !f.trashed && (() => { try { return JSON.parse(f.content).accountId === acct; } catch (e) { return false; } })());
    if (!prof) return { prof: null };
    const j = JSON.parse(prof.content);
    const pic = j.chat && j.chat.picture ? Object.values(drive.files).find(f => f.name === j.chat.picture.file && f.parents[0] === prof.parents[0] && !f.trashed) : null;
    const folder = drive.files[prof.parents[0]];
    return { prof: j, pic, folder: folder && folder.name };
  };
  async function shots(page, name) {
    try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (e) {}
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => cestisSetTheme(t), theme);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, name + '-' + theme + '.png') });
    }
    await page.evaluate(() => cestisSetTheme('dark'));
  }

  try {
    /* ------------------------------------------------------------- 1 */
    console.log('1. A trainee on an office PC: picture, status, message, phone — out and in again, here and elsewhere');
    const ctxA = await K.computer({ drive, scale: 2 });
    const A = await K.adminSignedIn(ctxA, { label: 'PC A', mutate: async ({ INSTR }) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users'));
      users.push({ id: INSTR.id, name: INSTR.name, role: 'instructor', username: INSTR.user, email: INSTR.user + '@example.com', programme: INSTR.prog, password: await hashPassword(INSTR.pass), status: 'active', updatedAt: new Date().toISOString() });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, mutateArg: { INSTR } });
    await wait(9000);   // the Centre's records reach the shared files
    await signOut(A);
    await signIn(A, 'student', TAMEKA.user, TRAINEE_PASS);
    const photo = await makeJpeg(A, '#2a7ab0');
    // As she does it: My Profile → Edit Profile → Change Photo, Away, a message, her phone → Save Profile.
    await A.evaluate(() => showPage('s-profile'));
    await A.waitForTimeout(400);
    await A.click('#page-s-profile .profile-header button.btn-secondary');
    await A.waitForSelector('#editStudentProfileModal.active');
    await A.setInputFiles('#editStuPicInput', { name: 'me.jpg', mimeType: 'image/jpeg', buffer: photo });
    await A.waitForFunction(() => !!_pendingProfilePics.student, null, { timeout: 10000 });
    await A.selectOption('#editStuStatus', 'away');
    await A.fill('#editStuStatusMsg', 'In the welding shop until 4');
    await A.fill('#editProfilePhone', '876-555-0147');
    await A.fill('#editProfileEmergencyName', 'Joan Richards');
    await A.click('#editStudentProfileModal .btn-primary');
    await A.waitForTimeout(600);
    let t = await mine(A, TAMEKA.id, TAMEKA.sid);
    const PIC = t.pic;
    ok(/^data:image\/jpeg;base64,/.test(PIC) && PIC.length < 60000, 'her photo is kept as a small picture (' + PIC.length + ' characters, from a ' + photo.length + '-byte photo)');
    ok(t.choice === 'away' && t.shown === 'away' && t.msg === 'In the welding shop until 4' && t.sp.phone === '876-555-0147', 'saved: Away, her message, her phone');
    ok(t.sidebar === PIC, 'her picture is in the sidebar at once');
    await shots(A, 'trainee-profile-saved');
    await A.evaluate(() => showPage('s-lms-chat'));
    await A.waitForTimeout(2500);
    await until(async () => (await mine(A, TAMEKA.id, TAMEKA.sid)).shown === 'away', 5000);
    ok((await mine(A, TAMEKA.id, TAMEKA.sid)).shown === 'away', 'the chat page sees her online and shows her as she chose: Away');
    await wait(7000);   // the 5-second save
    await signOut(A);
    const wiped = await A.evaluate(acct => ({ others: Object.keys(lmsChatProfiles).filter(k => k !== acct).length, mine: !!lmsChatProfiles[acct] }), TAMEKA.id);
    ok(wiped.others === 0 && wiped.mine, 'signed out: nobody else\'s profile stays on the PC; her own does');
    await signIn(A, 'student', TAMEKA.user, TRAINEE_PASS);
    t = await mine(A, TAMEKA.id, TAMEKA.sid);
    ok(t.pic === PIC && t.sidebar === PIC, 'signed in again on the same PC: her picture (sidebar too)');
    ok(t.choice === 'away' && t.msg === 'In the welding shop until 4', 'her status (Away) and message (' + t.choice + ', "' + t.msg + '")');
    ok(t.sp.phone === '876-555-0147' && t.sp.emergencyName === 'Joan Richards', 'her phone and emergency contact (' + t.sp.phone + ')');
    ok(/876-555-0147/.test(await A.evaluate(() => document.getElementById('sProfilePhone').textContent)), 'My Profile shows the phone');
    await A.evaluate(() => openEditStudentProfile());
    const form = await A.evaluate(() => ({ status: document.getElementById('editStuStatus').value, msg: document.getElementById('editStuStatusMsg').value, img: !!document.querySelector('#editStuPicPreview img') }));
    ok(form.status === 'away' && form.msg === 'In the welding shop until 4' && form.img, 'Edit Profile opens on what she set (' + JSON.stringify(form) + ')');
    await shots(A, 'trainee-edit-profile');
    await A.evaluate(() => closeModal('editStudentProfileModal'));
    const own = ownFolderFiles(TAMEKA.id);
    ok(own.prof && own.prof.chat && own.prof.chat.statusChoice === 'away' && own.prof.chat.statusMsg === 'In the welding shop until 4' && own.prof.studentProfile && own.prof.studentProfile.phone === '876-555-0147',
      'her own folder ("' + (own.folder || '?') + '") holds her profile: status, message, phone');
    ok(own.pic && own.pic._bytes && own.pic._bytes.length > 1000 && own.pic.mimeType === 'image/jpeg', 'and her picture as a file beside it (' + (own.pic && own.pic.name) + ', ' + (own.pic && own.pic._bytes && own.pic._bytes.length) + ' bytes)');
    await wait(6000);
    await signOut(A);

    const B = await freshPc('PC B');
    await signIn(B, 'student', TAMEKA.user, TRAINEE_PASS);
    t = await mine(B, TAMEKA.id, TAMEKA.sid);
    ok(t.pic === PIC && t.sidebar === PIC, 'another PC: her picture');
    ok(t.choice === 'away' && t.msg === 'In the welding shop until 4' && t.sp.phone === '876-555-0147', 'her status, message and phone (' + [t.choice, t.msg, t.sp.phone].join(' / ') + ')');
    await B.evaluate(() => showPage('s-lms-chat'));
    await B.waitForTimeout(2500);
    ok((await mine(B, TAMEKA.id, TAMEKA.sid)).shown === 'away', 'its chat page shows her Away too');
    await wait(6000);
    await signOut(B);

    /* ------------------------------------------------------------- 2 */
    console.log('2. The shared copies lose her profile: her own folder brings it back');
    // Every shared file but her own folder's: her chat profile becomes what
    // an older build's copy looked like (no picture, no status, no message,
    // just seen online), and her profile record is gone.
    let lost = 0;
    const ownFolder = ownFolderFiles(TAMEKA.id);
    const ownParent = Object.values(drive.files).find(f => f.name === 'profile.json' && (() => { try { return JSON.parse(f.content).accountId === TAMEKA.id; } catch (e) { return false; } })()).parents[0];
    const scrub = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(scrub); return; }
      if (node.chatProfiles && node.chatProfiles[TAMEKA.id]) { node.chatProfiles[TAMEKA.id] = { name: 'Tameka Richards', role: 'student', status: 'online', lastSeen: new Date().toISOString(), updatedAt: new Date().toISOString() }; lost++; }
      if (node.studentProfiles && node.studentProfiles[TAMEKA.sid]) { delete node.studentProfiles[TAMEKA.sid]; lost++; }
      Object.keys(node).forEach(k => {
        const v = node[k];
        if (typeof v === 'string' && (/^voctrain_(chatProfiles|studentProfiles|chatPictures)$/.test(k) || v.indexOf(PIC.slice(40, 120)) !== -1)) {
          try { const inner = JSON.parse(v); scrub({ chatProfiles: inner, studentProfiles: inner }); if (inner[TAMEKA.id] && inner[TAMEKA.id].pic) delete inner[TAMEKA.id]; node[k] = JSON.stringify(inner); } catch (e) {}
        } else scrub(v);
      });
    };
    Object.values(drive.files).forEach(f => {
      if (f.trashed || f._bytes || f.parents[0] === ownParent) return;
      let j; try { j = JSON.parse(f.content); } catch (e) { return; }
      scrub(j);
      f.content = JSON.stringify(j);
      f.modifiedTime = new Date().toISOString();
    });
    const still = Object.values(drive.files).filter(f => !f.trashed && f.parents[0] !== ownParent && typeof f.content === 'string' && (f.content.indexOf(PIC.slice(40, 120)) !== -1 || f.content.indexOf('In the welding shop until 4') !== -1));
    ok(lost > 0 && !still.length && ownFolder.prof, 'every shared copy has lost her picture, status, message and phone (' + lost + ' changed; still holding them: ' + still.map(f => f.name).join(', ') + ')');
    const C = await freshPc('PC C');
    await signIn(C, 'student', TAMEKA.user, TRAINEE_PASS);
    t = await mine(C, TAMEKA.id, TAMEKA.sid);
    ok(t.pic === PIC && t.choice === 'away' && t.msg === 'In the welding shop until 4' && t.sp.phone === '876-555-0147',
      'a third PC: picture, Away, message and phone all back from her own folder (' + [t.pic === PIC, t.choice, t.msg, t.sp.phone].join(' / ') + ')');
    await wait(7000);
    await signOut(C);
    const healed = (() => { const f = Object.values(drive.files).find(x => x.name === 'CESTIS_LMS_BACKUP.json' && x.parents[0] === kit.MAIN_FOLDER); const d = JSON.parse(f.content).data; return { pic: (d.chatProfiles[TAMEKA.id] || {}).profilePic === PIC, phone: (d.studentProfiles[TAMEKA.sid] || {}).phone }; })();
    ok(healed.pic && healed.phone === '876-555-0147', 'and the Centre\'s shared copy has them again (' + JSON.stringify(healed) + ')');

    /* ------------------------------------------------------------- 3 */
    console.log('3. Staff: the administrator and an instructor, out and in again on another PC');
    const D = await freshPc('PC D');
    await signIn(D, 'admin', ADMIN.user, ADMIN.pass);
    const aPhoto = await makeJpeg(D, '#b0602a');
    await D.click('.sidebar-user');
    await D.waitForSelector('#editAccountProfileModal.active');
    await D.setInputFiles('#editAcctPicInput', { name: 'marcia.jpg', mimeType: 'image/jpeg', buffer: aPhoto });
    await D.waitForFunction(() => !!_pendingProfilePics.account, null, { timeout: 10000 });
    await D.selectOption('#editAcctStatus', 'away');
    await D.fill('#editAcctStatusMsg', 'At the board meeting');
    await D.fill('#editAcctPhone', '876-555-0190');
    await D.fill('#editAcctEmail', 'marcia.thompson@example.com');
    await D.click('#editAccountProfileModal .btn-primary');
    await D.waitForTimeout(500);
    const APIC = (await mine(D, ADMIN.id)).pic;
    ok(/^data:image\/jpeg/.test(APIC), 'the administrator\'s picture is saved');
    await wait(7000);
    await signOut(D);
    const E = await freshPc('PC E');
    await signIn(E, 'admin', ADMIN.user, ADMIN.pass);
    let a = await mine(E, ADMIN.id);
    ok(a.pic === APIC && a.sidebar === APIC, 'another PC: the administrator\'s picture');
    ok(a.choice === 'away' && a.msg === 'At the board meeting', 'her status and message');
    ok(a.phone === '876-555-0190' && a.email === 'marcia.thompson@example.com', 'her phone and e-mail (' + a.phone + ', ' + a.email + ')');
    await E.click('.sidebar-user');
    await E.waitForSelector('#editAccountProfileModal.active');
    const aForm = await E.evaluate(() => ({ phone: document.getElementById('editAcctPhone').value, status: document.getElementById('editAcctStatus').value, img: !!document.querySelector('#editAcctPicPreview img') }));
    ok(aForm.phone === '876-555-0190' && aForm.status === 'away' && aForm.img, 'Edit Profile opens on them (' + JSON.stringify(aForm) + ')');
    await shots(E, 'admin-edit-profile');
    await E.evaluate(() => closeModal('editAccountProfileModal'));
    ok(ownFolderFiles(ADMIN.id).prof && ownFolderFiles(ADMIN.id).pic, 'her own folder holds her profile and picture');
    await wait(6000);
    await signOut(E);

    await signIn(E, 'instructor', INSTR.user, INSTR.pass);
    const iPhoto = await makeJpeg(E, '#2ab05a');
    const IID = await E.evaluate(() => currentInstructor.id);
    await E.click('.sidebar-user');
    await E.waitForSelector('#editInstructorProfileModal.active');
    await E.setInputFiles('#editInsPicInput', { name: 'kevin.jpg', mimeType: 'image/jpeg', buffer: iPhoto });
    await E.waitForFunction(() => !!_pendingProfilePics.instructor, null, { timeout: 10000 });
    await E.selectOption('#editInsStatus', 'offline');
    await E.fill('#editInsStatusMsg', 'Marking week');
    await E.fill('#editInsProfilePhone', '876-555-0222');
    await E.fill('#editInsProfileBio', 'Twenty years <b>on</b> the tools.');
    await E.click('#editInstructorProfileModal .btn-primary');
    await E.waitForTimeout(500);
    const IPIC = (await mine(E, INSTR.id)).pic;
    await wait(7000);
    await signOut(E);
    const F = await freshPc('PC F');
    await signIn(F, 'instructor', INSTR.user, INSTR.pass);
    const i = await mine(F, INSTR.id, null, IID);
    ok(/^data:image\/jpeg/.test(IPIC) && i.pic === IPIC, 'another PC: the instructor\'s picture');
    ok(i.choice === 'offline' && i.shown === 'offline' && i.msg === 'Marking week', 'his chosen status (Offline) and message');
    ok(i.ip && i.ip.phone === '876-555-0222' && i.ip.bio === 'Twenty years <b>on</b> the tools.', 'his phone and about');
    await F.evaluate(() => showPage('i-profile'));
    await F.waitForTimeout(400);
    const iPage = await F.evaluate(() => document.getElementById('page-i-profile').innerHTML);
    ok(/Twenty years &lt;b&gt;on&lt;\/b&gt; the tools\./.test(iPage) && /876-555-0222/.test(iPage), 'My Profile shows his phone, and his about as text (never as markup)');
    await wait(6000);
    await signOut(F);

    /* ------------------------------------------------------------- 4 */
    console.log('4. A trainee at home, through the trainee gate: out, and in again on another phone');
    const gate = makeFakeGate(drive, { seed: 'profile-persistence' });
    const KG = kit.make({ browser, base: srv.base, errors, gateUrl: GATE_URL });
    const officeCtx = await KG.computer({ drive, gate });
    const op = K.watch(await officeCtx.newPage(), 'office');
    await op.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await op.evaluate(token => { Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k])); }, driveTokenSeed());
    await op.reload({ waitUntil: 'load' });
    await op.waitForFunction(() => loginSyncCompleted && userAccounts.some(u => u && u.role === 'student'), null, { timeout: 60000 }).catch(() => {});
    await signIn(op, 'admin', ADMIN.user, ADMIN.pass);
    await op.evaluate(() => { if (!isCloudConnected || !googleAccessToken) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); } if (!_autoSaveIntervalId) startAutoSave(); saveAccountsLedger(); });
    await until(() => Object.values(drive.files).some(f => f.name === 'CESTIS_ACCOUNTS.json'), 20000);
    gate.world.get({ op: 'health' });
    await op.evaluate(G => { systemSettings.traineeGate = { url: G, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
    const published = () => op.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }, null, { timeout: 180000, polling: 500 });
    await published();
    async function phone(label) {
      const ctx = await KG.computer({ phone: true, drive: null, gate });
      const page = KG.watch(await ctx.newPage(), label);
      await page.goto(srv.base + LINK, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 20000 });
      await page.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
      await page.waitForTimeout(150);
      await page.fill('#studentUser', KEMAR.user);
      await page.fill('#studentPass', TRAINEE_PASS);
      await page.press('#studentPass', 'Enter');
      await page.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      return page;
    }
    const P1 = await phone('phone 1');
    const kPhoto = await makeJpeg(P1, '#7a2ab0');
    await P1.evaluate(() => { showPage('s-profile'); openEditStudentProfile(); });
    await P1.waitForSelector('#editStudentProfileModal.active');
    await P1.setInputFiles('#editStuPicInput', { name: 'kemar.jpg', mimeType: 'image/jpeg', buffer: kPhoto });
    await P1.waitForFunction(() => !!_pendingProfilePics.student, null, { timeout: 10000 });
    await P1.selectOption('#editStuStatus', 'away');
    await P1.fill('#editStuStatusMsg', 'Studying at home');
    await P1.fill('#editProfilePhone', '876-555-0333');
    await P1.selectOption('#editProfileGender', 'Male');
    await P1.click('#editStudentProfileModal .btn-primary');
    await P1.waitForTimeout(800);
    const KPIC = (await mine(P1, KEMAR.id, KEMAR.sid)).pic;
    ok(/^data:image\/jpeg/.test(KPIC) && KPIC.length < 60000, 'at home: his picture is kept small enough for the gate (' + KPIC.length + ' characters)');
    await until(() => P1.evaluate(() => CESTISGate.capture().then(() => CESTISGate.deliverNow()).then(() => CESTISGate.status()).then(s => s.waiting === 0)), 40000, 1000);
    await op.evaluate(() => { _gateRun.collectAt = 0; GATE_LIMITS.collectMs = 1000; return gateCollectTick({ refetch: true }); });
    await op.waitForFunction(() => !_gateRun.collecting, null, { timeout: 30000 });
    const atOffice = await until(() => op.evaluate(({ acct, sid }) => { const cp = lmsChatProfiles[acct] || {}; const s = students.find(x => x.id === sid) || {};
      return cp.profilePic && cp.statusMsg === 'Studying at home' ? { pic: cp.profilePic, choice: CESTISCore.profiles.chosenStatus(cp), phone: (studentProfiles[sid] || {}).phone, gender: s.gender } : null; }, { acct: KEMAR.id, sid: KEMAR.sid }), 30000, 1000);
    ok(atOffice && atOffice.pic === KPIC && atOffice.choice === 'away' && atOffice.phone === '876-555-0333', 'the office has his picture, status, message and phone (' + JSON.stringify(atOffice && { choice: atOffice.choice, phone: atOffice.phone }) + ')');
    ok(atOffice && atOffice.gender === 'Male', 'and his gender on his record (' + (atOffice && atOffice.gender) + ')');
    const kFolder = await until(() => ownFolderFiles(KEMAR.id).pic ? ownFolderFiles(KEMAR.id) : null, 30000, 1000);
    ok(kFolder && kFolder.prof.chat.statusMsg === 'Studying at home', 'his own folder holds his profile and his picture');
    await P1.evaluate(() => logout());
    await P1.waitForFunction(() => !(window.CESTISStore && CESTISStore.namespace) && document.readyState === 'complete', null, { timeout: 40000 }).catch(() => {});
    await P1.waitForTimeout(1000);
    const left = await P1.evaluate(() => { let n = 0; for (let k = 0; k < localStorage.length; k++) if (/^g1::voctrain_/.test(localStorage.key(k))) n++; return n; });
    ok(left === 0, 'signed out at home: the phone keeps none of his records (' + left + ')');
    await op.evaluate(() => { _gateRun.buildNow = true; gatePublishSoon(); });
    await until(() => Object.values(drive.files).some(f => f.name === 'from-centre.json' && !f.trashed && /Studying at home/.test(f.content || '')), 120000, 1500);
    const P2 = await phone('phone 2');
    const k2 = await until(async () => { const v = await mine(P2, KEMAR.id, KEMAR.sid); return v.pic ? v : null; }, 30000, 1000);
    ok(k2 && k2.pic === KPIC && k2.sidebar === KPIC, 'another phone: his picture (sidebar too)');
    ok(k2 && k2.choice === 'away' && k2.msg === 'Studying at home' && k2.sp.phone === '876-555-0333', 'his status, message and phone (' + (k2 && [k2.choice, k2.msg, k2.sp.phone].join(' / ')) + ')');
    ok(await P2.evaluate(pic => { const im = document.querySelector('#topbarWhoAvatar img'); return !!im && im.getAttribute('src') === pic; }, KPIC), 'on a phone, his picture is in the top bar');
    await shots(P2, 'home-trainee-dashboard');
    await P2.evaluate(() => { showPage('s-profile'); openEditStudentProfile(); });
    await P2.waitForSelector('#editStudentProfileModal.active');
    const kForm = await P2.evaluate(() => ({ status: document.getElementById('editStuStatus').value, msg: document.getElementById('editStuStatusMsg').value, phone: document.getElementById('editProfilePhone').value, img: !!document.querySelector('#editStuPicPreview img') }));
    ok(kForm.status === 'away' && kForm.msg === 'Studying at home' && kForm.phone === '876-555-0333' && kForm.img, 'Edit Profile on the other phone opens on what he set (' + JSON.stringify(kForm) + ')');
    await shots(P2, 'home-trainee-edit-profile');

    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
