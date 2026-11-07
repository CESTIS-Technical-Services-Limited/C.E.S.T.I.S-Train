/* Tidy Programme Names, in a real browser — the owner's list, tidied by the
   Administrator, and another office PC receiving it:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/programme-tidy.js

   PC A holds the owner's training centres (Business Administration,
   Commercial Cooking, Cosmetology, Electrical Installation, Electrical
   Installation and Maintenance Level 3, Electrical Installation Level 2,
   General Cosmetology Level 2, Hospitality & Tourism, Photovoltaic Installer,
   Plumbing, Welding & Fabrication, Welding and Fabrication Level 2) and
   trainees, fee records and sign-ins written under the leftover spellings
   (BEAUTY THERAPY L2, COMMI CHEF L2, COSMETOLOGY L2, ELECTRICAL L2,
   HOSPITALITY SERVICES L2, Welding, WELDING L2).
     1. Before: Student Progress's filter lists each programme once already —
        a leftover spelling of exactly one programme is filed under it — and
        only names that match no single programme are archived.
     2. The Administrator opens Administration → Tidy Programme Names: the
        programmes written more than one way, "Electrical Installation" under
        Needs your choice, the names no centre uses. Chooses Level 2 for it,
        files COMMI CHEF L2 under Commercial Cooking, previews, renames (the
        confirm step is on the page).
     3. After: one filter entry per programme; every trainee is still found,
        under one programme each; nobody's id moved; no centre deleted.
     4. Reloaded and signed in again: still so.
     5. PC B, holding the Centre's records as they were (old names), signs in:
        it takes the new centre names, programmes and fee records, and its
        filter lists each programme once too.
     6. Undo on PC A puts the old names back.
   Screenshots (light and dark) of the tool and the filter before and after:
   CESTIS_SHOTS (default tests/browser/shots-programme-tidy). The outside
   world is cut off; no page errors. Kept out of `npm test` (needs a browser). */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_SHOTS || path.join(__dirname, 'shots-programme-tidy');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));

const LIVE = ['Business Administration', 'Commercial Cooking', 'Cosmetology', 'Electrical Installation',
  'Electrical Installation and Maintenance Level 3', 'Electrical Installation Level 2', 'General Cosmetology Level 2',
  'Hospitality & Tourism', 'Photovoltaic Installer', 'Plumbing', 'Welding & Fabrication', 'Welding and Fabrication Level 2'];
const AFTER = ['Business Administration', 'Commercial Cooking', 'Electrical Installation and Maintenance Level 3', 'Electrical Installation Level 2',
  'General Cosmetology Level 2', 'Hospitality & Tourism', 'Photovoltaic Installer', 'Plumbing', 'Welding and Fabrication Level 2'];

/* The owner's Centre, written into a PC before its Administrator signs in —
   records as a PC holds them from before today (dated last week, so PC B's
   copy is older than PC A's tidy, as it would be). */
function seedOwnersList(LIVE) {
  const now = '2026-11-01T09:00:00.000Z';
  const areas = LIVE.map((n, i) => ({ id: i + 1, name: n, icon: '📋', color: '#3498db', students: 0, materials: 0, desc: n,
    centreKey: String(i + 1).padStart(2, '0'), startDate: i === 10 ? '2025-01-06' : '2026-01-12', endDate: i === 10 ? '2025-12-12' : '2027-06-30',
    level: '', project: '', instructorPermissions: [] }));
  CESTISStore.setItem('voctrain_skillAreas', JSON.stringify(areas));
  const studs = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]');
  const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
  const hash = (users.find(u => u.role === 'student') || {}).password || '';
  [['Omarion Blake', 'WELDING L2'], ['Jovaun Grant', 'Welding'], ['Dalvia Lindo', 'Welding and Fabrication Level 2'],
   ['Rohan Spence', 'Electrical Installation Level 2'], ['Kerry Daley', 'ELECTRICAL L2'], ['Mikhail Reid', 'Electrical Installation and Maintenance Level 3'],
   ['Brianna Morgan', 'COSMETOLOGY L2'], ['Gaynelle Henry', 'General Cosmetology Level 2'], ['Petagaye Clarke', 'BEAUTY THERAPY L2'],
   ['Nordia Palmer', 'COMMI CHEF L2'], ['Sashana Bryan', 'Commercial Cooking'], ['Imani Reid', 'HOSPITALITY SERVICES L2'],
   ['Everton Bailey', 'Hospitality & Tourism'], ['Leroy Wright', 'Plumbing'], ['Fabian Gordon', 'Photovoltaic Installer'],
   ['Venessa Spence', 'Business Administration']].forEach(([name, course], i) => {
    const id = CESTISCore.stableStudentId({ name, course });
    const user = name.toLowerCase().replace(/\s+/g, '.');
    studs.push({ id, name, course, stage: 'training', progress: 20, email: user + '@example.com', gender: 'Female', enrolmentDate: '2026-02-02', lastModified: now });
    users.push({ id: 'USR-tidy' + i, name, role: 'student', username: user, email: user + '@example.com', programme: course, studentDataId: id, password: hash, status: 'active', updatedAt: now });
  });
  const fee = studs.map((s, i) => {
    s.schoolFeeId = 'STU-fee-' + i;
    return { id: 'STU-fee-' + i, name: s.name, skillArea: s.course, lmsId: s.id, contact: '876-555-01' + String(i).padStart(2, '0'), email: s.email || '',
      tuitionFee: 150000, totalPaid: 0, balance: 150000, status: 'Outstanding', enrollmentDate: '2026-02-02', createdAt: now, updatedAt: now };
  });
  studs.forEach(s => { if (s.updatedAt) s.updatedAt = now; });
  users.forEach(u => { if (u.updatedAt) u.updatedAt = now; });
  CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
  CESTISStore.setItem('voctrain_users', JSON.stringify(users));
  CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify(fee));
  CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify([{ id: 'PAY-1', studentId: 'STU-fee-6', amount: 20000, skillArea: 'WELDING L2', date: '2026-03-01', receiptNo: 'R-0001', updatedAt: now }]));
  CESTISStore.setItem('cestiFeeStructure', JSON.stringify({ 'WELDING L2': { total: 120000, terms: [60000, 60000, 0, 0, 0, 0, 0, 0, 0] } }));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const K = kit.make({ browser, base: srv.base, errors });
  const theme = async (page, t) => { await page.evaluate(x => { if (x === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); window.scrollTo(0, 0); }, t); await page.waitForTimeout(250); };
  const spFrame = page => page.frames().find(f => /Student-Progress\.html/.test(f.url()));
  // The dashboard scrolls inside its own panel, so a whole-page picture is
  // taken with a window as tall as the page's content.
  async function shoot(page, name) {
    const vp = page.viewportSize();
    const h = await page.evaluate(() => {
      const r = document.getElementById('tidyProgRoot');
      window.scrollTo(0, 0);
      for (let el = r && r.parentElement; el; el = el.parentElement) if (el.scrollTop) el.scrollTop = 0;
      const top = r ? r.getBoundingClientRect().top : 0;
      return Math.ceil((r ? r.scrollHeight : 800) + top + 120);
    });
    await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, Math.min(h, 6000)) });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, name + '.png') });
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
  }
  async function openStudentProgress(page) {
    await page.evaluate(() => showPage('students'));
    for (let i = 0; i < 40; i++) {
      const f = spFrame(page);
      if (f && await f.evaluate(() => !!document.getElementById('filterCourse') && document.getElementById('filterCourse').options.length > 1).catch(() => false)) return f;
      await wait(250);
    }
    return spFrame(page);
  }
  async function filterMenu(f) {
    return f.evaluate(() => {
      const sel = document.getElementById('filterCourse');
      const out = { courses: [], archived: [] };
      Array.from(sel.children).forEach(ch => {
        if (ch.tagName === 'OPTGROUP') Array.from(ch.children).forEach(o => out.archived.push(o.value));
        else if (ch.value !== 'all') out.courses.push(ch.value);
      });
      return out;
    });
  }
  // Every trainee, under each filter entry (the ids Student Progress shows).
  async function findable(f) {
    return f.evaluate(() => {
      const sel = document.getElementById('filterCourse');
      sel.value = 'all'; filterStudents();
      const all = _spShown.slice();
      const by = {};
      Array.from(sel.options).forEach(o => {
        if (o.value === 'all') return;
        sel.value = o.value; filterStudents();
        _spShown.forEach(id => { (by[id] = by[id] || []).push(o.value); });
      });
      sel.value = 'all'; filterStudents();
      return { all, by };
    });
  }
  // The filter menu, opened out, for the owner's screenshot.
  async function shootMenu(page, f, name) {
    await f.evaluate(() => { const s = document.getElementById('filterCourse'); s.size = Math.min(s.options.length + 6, 30); s.style.height = 'auto'; s.style.width = '420px'; s.style.position = 'relative'; s.style.zIndex = '50'; s.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(200);
    const el = await f.$('#filterCourse');
    // (Student Progress has one look, whatever the dashboard's theme.)
    await el.screenshot({ path: path.join(SHOTS, name + '.png') });
    await theme(page, 'light');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, name + '-in-dashboard-light.png') });
    await theme(page, 'dark');
    await page.screenshot({ path: path.join(SHOTS, name + '-in-dashboard-dark.png') });
    await f.evaluate(() => { const s = document.getElementById('filterCourse'); s.size = 0; s.removeAttribute('style'); s.style.width = '200px'; });
  }
  const feeFrame = page => page.frames().find(f => /School\.Fee\.html/.test(f.url()));
  async function openSchoolFee(page) {
    await page.evaluate(() => showPage('fee-management'));
    for (let i = 0; i < 60; i++) {
      const f = feeFrame(page);
      if (f && await f.evaluate(() => !!window.CESTISPageCloud && Array.isArray(window.students) && students.length > 0).catch(() => false)) return f;
      await wait(500);
    }
    return feeFrame(page);
  }
  const feeOf = page => page.evaluate(() => JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').map(r => ({ name: r.name, skillArea: r.skillArea, id: r.id })));
  const state = page => page.evaluate(() => ({
    centres: skillAreas.map(c => ({ id: c.id, name: c.name, key: c.centreKey, start: c.startDate })),
    students: students.map(s => ({ id: s.id, name: s.name, course: s.course, idCourse: s.idCourse || '' })),
    fee: JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').map(f => ({ id: f.id, name: f.name, skillArea: f.skillArea, lmsId: f.lmsId })),
    accounts: userAccounts.filter(u => u.role === 'student').map(u => ({ id: u.id, programme: u.programme, sid: u.studentDataId }))
  }));
  try {
    console.log('1. PC A, before the tidy');
    const ctxA = await K.computer({ drive, scale: 2 });
    const A = await K.adminSignedIn(ctxA, { label: 'PC A', mutate: seedOwnersList, mutateArg: LIVE });
    await wait(4000);
    // School Fee opened once, as the office does every day.
    await openSchoolFee(A);
    await A.evaluate(() => autoSaveToAllFolders()).catch(() => {});
    await wait(6000);
    // PC B: a second office PC with the same records, running alongside.
    const ctxB = await K.computer({ drive });
    const B = await K.adminSignedIn(ctxB, { label: 'PC B', mutate: seedOwnersList, mutateArg: LIVE });
    await openSchoolFee(B);
    await wait(6000);
    await A.bringToFront();
    const before = await state(A);
    ok(before.centres.length === 12 && before.students.length >= 22, 'the owner\'s 12 training centres and ' + before.students.length + ' trainees are on PC A');
    let f = await openStudentProgress(A);
    const menu0 = await filterMenu(f);
    ok(JSON.stringify(menu0.courses) === JSON.stringify(LIVE), 'the filter lists the 12 training-centre names');
    ok(JSON.stringify(menu0.archived) === JSON.stringify(['BEAUTY THERAPY L2', 'COMMI CHEF L2', 'HOSPITALITY SERVICES L2']),
      'already better before any tidy: only names that match no single programme are archived (' + menu0.archived.join(', ') + ')');
    const find0 = await findable(f);
    ok(find0.all.length === before.students.length && find0.all.every(id => (find0.by[id] || []).length >= 1), 'every trainee is found under a filter entry');
    const weldL2 = await f.evaluate(() => { const s = document.getElementById('filterCourse'); s.value = 'Welding and Fabrication Level 2'; filterStudents(); const r = _spShown.slice(); s.value = 'all'; filterStudents(); return r; });
    ok(weldL2.some(id => before.students.find(s => s.id === id && s.course === 'WELDING L2')), 'WELDING L2 trainees are found under Welding and Fabrication Level 2');
    await shootMenu(A, f, 'filter-before');

    console.log('2. Administration → Tidy Programme Names');
    await A.evaluate(() => { document.querySelectorAll('.nav-section-toggle').forEach(l => { if (/Administration/.test(l.textContent) && l.classList.contains('collapsed')) toggleNavSection(l); }); });
    const navText = await A.evaluate(() => { const n = document.querySelector('.nav-item[data-page="tidy-programmes"]'); return n ? n.closest('.nav-section-group').previousElementSibling.textContent.trim() : ''; });
    ok(/^Administration/.test(navText), 'the page is in the Administration section of the Administrator\'s menu');
    await A.click('.nav-item[data-page="tidy-programmes"]');
    await A.waitForSelector('#tidyProgBody .tidy-group', { timeout: 15000 });
    const page0 = await A.evaluate(() => ({ title: document.getElementById('topbarTitle').textContent,
      text: document.getElementById('tidyProgRoot').innerText }));
    ok(/Tidy Programme Names/.test(page0.title), 'titled "Tidy Programme Names"');
    ok(/Programmes written more than one way/.test(page0.text) && /Needs your choice/.test(page0.text) && /Names no training centre uses/.test(page0.text), 'it lists the programmes written more than one way, the ones needing a choice and the names no centre uses');
    ok(/WELDING L2/.test(page0.text) && /Welding & Fabrication/.test(page0.text) && /training centre, 1 intake/.test(page0.text), 'each spelling with what carries it');
    const choice = await A.evaluate(() => Array.from(document.querySelectorAll('select[data-tidy-choose]')).map(s => ({ norm: s.getAttribute('data-tidy-choose'), opts: Array.from(s.options).map(o => o.text) })));
    const ei = choice.find(c => c.norm === 'electrical installation');
    ok(!!ei && ei.opts.join('|') === 'Leave as it is|It is Electrical Installation and Maintenance Level 3|It is Electrical Installation Level 2', '"Electrical Installation" is not guessed: Level 2, Level 3 or leave it');
    // Text never below 12px; no sideways scroll.
    const minPx = await A.evaluate(() => {
      let min = 99;
      document.querySelectorAll('#tidyProgRoot *').forEach(el => { if (!el.childNodes.length || !Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) return; if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return; min = Math.min(min, parseFloat(getComputedStyle(el).fontSize)); });
      return min;
    });
    ok(minPx >= 12, 'no text smaller than 12px (smallest ' + minPx + 'px)');
    for (const t of ['dark', 'light']) { await theme(A, t); await shoot(A, 'tool-groups-' + t); }
    await theme(A, 'dark');

    // The choices.
    await A.selectOption('select[data-tidy-choose="electrical installation"]', 'g:electrical installation level 2');
    await A.waitForTimeout(300);
    const commi = await A.evaluate(() => { const s = document.querySelector('select[data-tidy-choose="commi chef l2"]'); return Array.from(s.options).find(o => /Commercial Cooking/.test(o.text)).value; });
    await A.selectOption('select[data-tidy-choose="commi chef l2"]', commi);
    await A.waitForTimeout(300);
    const needs = await A.$('select[data-tidy-choose="electrical installation"]');
    for (const t of ['dark', 'light']) {
      await theme(A, t);
      await needs.evaluate(el => el.closest('.card').scrollIntoView({ block: 'start' }));
      await (await needs.evaluateHandle(el => el.closest('.card'))).asElement().screenshot({ path: path.join(SHOTS, 'tool-needs-your-choice-' + t + '.png') });
    }
    await theme(A, 'dark');
    // Phone width: nothing scrolls sideways.
    await A.setViewportSize({ width: 390, height: 844 });
    await A.waitForTimeout(400);
    const sideways = await A.evaluate(() => { const r = document.getElementById('tidyProgRoot'); return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, root: r.scrollWidth - r.clientWidth }; });
    ok(sideways.page <= 1 && sideways.root <= 1, 'at phone width nothing scrolls sideways (' + JSON.stringify(sideways) + ')');
    await shoot(A, 'tool-phone-dark');
    await A.setViewportSize({ width: 1366, height: 768 });
    await A.waitForTimeout(300);

    console.log('3. Preview, confirm, rename');
    await A.click('button[data-tidy-act="preview"]');
    await A.waitForSelector('button[data-tidy-act="apply"]');
    const preview = await A.evaluate(() => document.getElementById('tidyProgBody').innerText);
    ok(/What will change/.test(preview) && /Welding & Fabrication \(training centre, 1 intake, \d+ trainees?, \d+ fee records?, \d+ sign-in accounts?/.test(preview) && /→ Welding and Fabrication Level 2/.test(preview),
      'the preview says exactly what changes: "Welding & Fabrication (training centre, 1 intake, …) → Welding and Fabrication Level 2"');
    ok(/COMMI CHEF L2 \(.*\) → Commercial Cooking/.test(preview) && /Electrical Installation \(training centre, 1 intake.*\) → Electrical Installation Level 2/.test(preview), 'and the two choices made');
    ok(/Nothing is deleted/.test(preview) && /undone/.test(preview), 'it says nothing is deleted and it can be undone');
    ok(!/BEAUTY THERAPY L2/.test(preview), 'names left as they are are not in it') || console.log(preview);
    for (const t of ['dark', 'light']) { await theme(A, t); await shoot(A, 'tool-preview-confirm-' + t); }
    await theme(A, 'dark');
    let dialogs = 0;
    A.on('dialog', () => { dialogs++; });
    await A.click('button[data-tidy-act="apply"]');
    await A.waitForSelector('#tidyProgBody .tidy-box.done', { timeout: 60000 });
    ok(dialogs === 0, 'the confirm step is on the page (no pop-up)');
    const done = await A.evaluate(() => document.getElementById('tidyProgRoot').innerText);
    ok(/Renamed\./.test(done) && /one entry for each programme/.test(done), 'it says what was renamed');
    ok(/Undo last tidy/.test(done) && /by Marcia Thompson/.test(done), 'the log shows the tidy, who made it, and Undo last tidy');
    for (const t of ['dark', 'light']) { await theme(A, t); await shoot(A, 'tool-done-log-' + t); }
    await theme(A, 'dark');

    const after = await state(A);
    ok(after.centres.length === 12 && JSON.stringify(after.centres.map(c => c.id)) === JSON.stringify(before.centres.map(c => c.id)), 'no training centre was deleted or merged');
    ok(after.centres.filter(c => c.name === 'Welding and Fabrication Level 2').map(c => c.key).join(',') === '11,12', 'both Welding intakes keep their own key, sharing one name');
    ok(JSON.stringify(after.students.map(s => s.id).sort()) === JSON.stringify(before.students.map(s => s.id).sort()), 'every trainee keeps their id');
    ok(after.students.find(s => s.name === 'Omarion Blake').course === 'Welding and Fabrication Level 2', 'WELDING L2 trainees now read Welding and Fabrication Level 2');
    const sids = {}; after.students.forEach(s => { sids[s.id] = true; });
    ok(after.accounts.every(a => !a.sid || sids[a.sid]), 'every sign-in account still finds its trainee');
    ok(after.fee.every(x => sids[x.lmsId]) && after.fee.find(x => x.name === 'Omarion Blake').skillArea === 'Welding and Fabrication Level 2', 'fee records follow, still linked');

    f = await openStudentProgress(A);
    await A.waitForTimeout(800);
    const menu1 = await filterMenu(f);
    ok(JSON.stringify(menu1.courses) === JSON.stringify(AFTER), 'Student Progress lists one entry per programme: ' + menu1.courses.join(', '));
    ok(JSON.stringify(menu1.archived) === JSON.stringify(['BEAUTY THERAPY L2', 'HOSPITALITY SERVICES L2']), 'only the names left as they are stay archived');
    const find1 = await findable(f);
    ok(find1.all.length === before.students.length, 'every trainee is still listed (' + find1.all.length + ')');
    // (HOSPITALITY SERVICES L2, left as it is, still also answers to the
    // dashboard's own alias for Hospitality & Tourism, as it always has.)
    ok(find1.all.every(id => { const st = after.students.find(x => x.id === id); return (find1.by[id] || []).indexOf(st.course) !== -1; }) &&
       find1.all.every(id => (find1.by[id] || []).filter(v => AFTER.indexOf(v) !== -1).length <= 1), 'and each is found under their own programme, never under two programmes') ||
      console.log(find1.all.map(id => id + ' ' + JSON.stringify(after.students.find(s => s.id === id)) + ' → ' + JSON.stringify(find1.by[id])).join('\n'));
    await shootMenu(A, f, 'filter-after');

    console.log('4. Reloaded, signed in again');
    await A.evaluate(() => autoSaveToAllFolders()).catch(() => {});
    await wait(3000);
    await A.reload({ waitUntil: 'load' });
    await A.waitForTimeout(1300);
    await A.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById('adminLogin'); if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    await A.fill('#adminUser', kit.ADMIN.user); await A.fill('#adminPass', kit.ADMIN.pass); await A.press('#adminPass', 'Enter');
    await A.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'admin', null, { timeout: 30000 });
    await A.waitForTimeout(2500);
    await A.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); if (!isCloudConnected || !googleAccessToken) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); } if (!_autoSaveIntervalId) startAutoSave(); });
    const reloaded = await state(A);
    ok(JSON.stringify(reloaded.students.map(s => s.id + s.course).sort()) === JSON.stringify(after.students.map(s => s.id + s.course).sort()), 'after a reload and sign-in the roll is exactly as tidied (ids and programmes)');
    ok(JSON.stringify(reloaded.centres.map(c => c.name)) === JSON.stringify(after.centres.map(c => c.name)), 'and the centre names too');
    f = await openStudentProgress(A);
    ok(JSON.stringify((await filterMenu(f)).courses) === JSON.stringify(AFTER), 'the filter still lists one entry per programme');
    // Everything up: the Centre's backup, and School Fee's own file.
    await A.evaluate(() => autoSaveToAllFolders()).catch(() => {});
    let feeUp = false;
    for (let i = 0; i < 40 && !feeUp; i++) {
      await wait(1000);
      const ff = Object.values(drive.files).find(x => x.name === 'CESTIS_School_Fees.json');
      try { feeUp = !!ff && JSON.parse(JSON.parse(ff.content).data.cestiSchoolFeeStudents).some(r => r.name === 'Omarion Blake' && r.skillArea === 'Welding and Fabrication Level 2'); } catch (e) { feeUp = false; }
    }
    ok(feeUp, 'School Fee\'s own copy for the other computers carries the renamed fee records');

    console.log('5. PC B, running alongside, takes the renames');
    await B.bringToFront();
    await B.evaluate(() => cestisPullAndRefresh()).catch(() => {});
    let got = null;
    for (let i = 0; i < 30; i++) {
      await wait(3000);
      got = await state(B);
      if (got.centres.filter(c => c.name === 'Welding and Fabrication Level 2').length === 2 && got.students.find(s => s.name === 'Omarion Blake' && s.course === 'Welding and Fabrication Level 2')) break;
    }
    ok(got.centres.filter(c => c.name === 'Welding and Fabrication Level 2').length === 2 && !got.centres.some(c => c.name === 'Welding & Fabrication'), 'PC B takes the new centre names');
    ok(JSON.stringify(got.students.map(s => s.id + '|' + s.course).sort()) === JSON.stringify(after.students.map(s => s.id + '|' + s.course).sort()), 'and every trainee\'s new programme, under the same ids, nobody added twice') ||
      console.log('B:', JSON.stringify(got.students.map(s => s.id + '|' + s.course + '|' + s.idCourse).sort(), null, 1), '\nA:', JSON.stringify(after.students.map(s => s.id + '|' + s.course).sort(), null, 1));
    const fB = await openSchoolFee(B);
    let feeB = false;
    for (let i = 0; i < 20 && !feeB; i++) {
      if (fB && i % 5 === 0) await fB.evaluate(() => CESTISPageCloud.loadNow()).catch(() => {});
      await wait(1500);
      feeB = await B.evaluate(() => JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').some(r => r.name === 'Omarion Blake' && r.skillArea === 'Welding and Fabrication Level 2'));
    }
    ok(feeB, 'its School Fee records take the new names') || console.log(await B.evaluate(() => JSON.stringify(JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]').map(r => r.name + '|' + r.skillArea + '|' + r.updatedAt))));
    const fb = await openStudentProgress(B);
    await B.waitForTimeout(800);
    const menuB = await filterMenu(fb);
    ok(JSON.stringify(menuB.courses) === JSON.stringify(AFTER), 'PC B\'s filter lists one entry per programme too');
    ok(await B.evaluate(() => (JSON.parse(CESTISStore.getItem('voctrain_programmeTidyLog') || '[]')[0] || {}).by === 'Marcia Thompson'), 'and its Tidy log shows who tidied');
    // PC A pulls again: PC B's copy cannot put an old name back.
    await B.evaluate(() => autoSaveToAllFolders()).catch(() => {});
    await wait(4000);
    await A.evaluate(() => cestisPullAndRefresh()).catch(() => {});
    await wait(2000);
    const back = await state(A);
    ok(!back.centres.some(c => c.name === 'Welding & Fabrication') && JSON.stringify(back.students.map(s => s.course).sort()) === JSON.stringify(after.students.map(s => s.course).sort()), 'PC A, after taking PC B\'s copy in, still has the new names') ||
      console.log(JSON.stringify(back.centres.map(c => c.name)), JSON.stringify(back.students.map(s => s.name + '|' + s.course)));

    const feeA2 = await feeOf(A);
    ok(feeA2.find(r => r.name === 'Omarion Blake').skillArea === 'Welding and Fabrication Level 2', 'and its fee records too');

    console.log('5b. PC C, switched off during the tidy (old names), signs in');
    const ctxC = await K.computer({ drive });
    const C = await K.adminSignedIn(ctxC, { label: 'PC C', mutate: seedOwnersList, mutateArg: LIVE });
    let gotC = null;
    for (let i = 0; i < 30; i++) {
      await wait(3000);
      gotC = await state(C);
      if (gotC.students.find(s => s.name === 'Omarion Blake' && s.course === 'Welding and Fabrication Level 2')) break;
    }
    ok(gotC.centres.filter(c => c.name === 'Welding and Fabrication Level 2').length === 2 &&
       JSON.stringify(gotC.students.map(s => s.id + '|' + s.course).sort()) === JSON.stringify(after.students.map(s => s.id + '|' + s.course).sort()),
      'PC C takes the new names on signing in, under the same ids') || console.log(JSON.stringify(gotC.students.map(s => s.id + '|' + s.course)));
    await C.close();

    console.log('6. Undo on PC A');
    await A.bringToFront();
    await A.evaluate(() => showPage('tidy-programmes'));
    await A.waitForSelector('button[data-tidy-act="undo-ask"]', { timeout: 15000 });
    await A.click('button[data-tidy-act="undo-ask"]');
    await A.waitForSelector('button[data-tidy-act="undo-go"]');
    for (const t of ['dark', 'light']) { await theme(A, t); await shoot(A, 'tool-undo-confirm-' + t); }
    await theme(A, 'dark');
    await A.click('button[data-tidy-act="undo-go"]');
    await A.waitForSelector('#tidyProgBody .tidy-box.done', { timeout: 60000 });
    const undone = await state(A);
    ok(JSON.stringify(undone.centres.map(c => c.name)) === JSON.stringify(LIVE), 'the old centre names are back');
    ok(undone.students.find(s => s.name === 'Omarion Blake').course === 'WELDING L2' && JSON.stringify(undone.students.map(s => s.id).sort()) === JSON.stringify(before.students.map(s => s.id).sort()),
      'the trainees\' old programmes are back, under the same ids');
    ok(/Undone/.test(await A.evaluate(() => document.getElementById('tidyProgLog').innerText)), 'the log says it was undone');
    for (const t of ['dark', 'light']) { await theme(A, t); await shoot(A, 'tool-undone-' + t); }

    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
