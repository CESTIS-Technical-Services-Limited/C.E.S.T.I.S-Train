/* Study kits and learner guides, in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/study-kits.js

   A Welding trainee opens My Resources: her programme's study kits are
   listed; one opens over the page (Course, Notes, Practice test); she takes
   the practice test, submits, sees each answer explained, and her best grade
   shows on the list. The Administrator sees every programme's kits (a kit
   not yet checked says so), uploads a learner guide made as a web page for
   one unit, and it opens in a sealed frame: its own script runs, but cannot
   read this site's storage. Screenshots (light and dark, desktop and phone)
   go to CESTIS_SHOTS (default: tests/browser/shots-study-kits); with
   CESTIS_FONTS=1 the kit's own fonts are fetched, as online.

   Kept out of `npm test` because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_SHOTS || path.join(__dirname, 'shots-study-kits');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// With no Welding kit in the repository yet (or STUDY_KITS_FIXTURE=1): the
// test's own small kit, served in its place.
const OVERRIDE = {};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (OVERRIDE[p]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(OVERRIDE[p]); }
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'study-kits', 'index.json'), 'utf8'));
let WELD = INDEX.kits.find(k => k.programme === 'Welding & Fabrication');
let KIT_TEXT = WELD ? fs.readFileSync(path.join(ROOT, 'study-kits', WELD.file), 'utf8') : null;
if (!WELD || process.env.STUDY_KITS_FIXTURE === '1') {
  KIT_TEXT = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'study-kit-sample.json'), 'utf8');
  const k = JSON.parse(KIT_TEXT);
  WELD = { file: 'welding-fabrication/memfab0111c.json', programme: k.programme, qualId: k.qualification.id, qualTitle: k.qualification.title, qualCode: k.qualification.code,
    level: k.level, unitCode: k.unit.code, unitTitle: k.unit.title, written: k.written, status: k.status, sections: k.sections.length, questions: k.questions.length };
  INDEX.kits = INDEX.kits.filter(e => e.file !== WELD.file).concat([WELD]);
  OVERRIDE['/study-kits/index.json'] = JSON.stringify(INDEX);
  OVERRIDE['/study-kits/' + WELD.file] = KIT_TEXT;
  console.log('  (the test\'s own sample kit stands in for the Welding kit)');
}
// A learner guide made as a web page: its script tries to read the site's storage.
const GUIDE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Guide</title><style>body{font-family:sans-serif;padding:24px;background:#fffbea;color:#222}h1{color:#8a6d1d}</style></head><body>' +
  '<h1>MMAW Learner Guide</h1><p>Strike the arc, hold a short arc, keep a steady travel speed.</p><p id="probe">…</p>' +
  '<script>var r;try{r=String(window.localStorage.length)}catch(e){r="blocked"}document.getElementById("probe").textContent="storage: "+r;</script></body></html>';

(async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  async function newPage(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }, opts || {}));
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      // CESTIS_FONTS=1: the kit's own fonts, as a trainee online sees them (for screenshots).
      if (process.env.CESTIS_FONTS === '1' && /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)) return r.continue();
      // The guide's file on the Centre's Drive.
      if (/googleapis\.com\/drive\/v3\/files\/GUIDEFILE1\?alt=media/.test(u)) return r.fulfill({ status: 200, contentType: 'text/html', body: GUIDE_HTML });
      return r.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e.message)));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1300);
    return page;
  }
  async function seed(page, o) {
    await page.evaluate(async (o) => {
      const now = new Date().toISOString();
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]').filter(u => u.username !== o.username);
      users.push(Object.assign({ id: 'USR-' + o.username, name: o.name, role: o.role, username: o.username, password: await hashPassword('S0me-Real-Pass!'), status: 'active', updatedAt: now }, o.extra || {}));
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      if (o.student) {
        const st = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').filter(s => s.id !== o.student.id);
        st.push(Object.assign({ stage: 'training', progress: 20, lastModified: now, updatedAt: now }, o.student));
        CESTISStore.setItem('voctrain_students', JSON.stringify(st));
      }
    }, o);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1300);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
  }
  const theme = async (page, t) => { await page.evaluate(x => { if (x === 'light') { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('cestisTheme', 'light'); } else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('cestisTheme'); } }, t); await page.waitForTimeout(300); };
  const kitFrame = page => page.frames().find(f => /study-kits\/kit\.html/.test(f.url()));

  /* ---- The trainee ---- */
  const tp = await newPage();
  await seed(tp, { role: 'student', username: 'kerry.lewis', name: 'Kerry-Ann Lewis', extra: { programme: 'Welding & Fabrication', studentDataId: 'STU-kl01', email: 'kerry@example.com' },
    student: { id: 'STU-kl01', name: 'Kerry-Ann Lewis', course: 'Welding & Fabrication', email: 'kerry@example.com' } });
  await tp.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
  await tp.waitForTimeout(200);
  await tp.fill('#studentUser', 'kerry.lewis'); await tp.fill('#studentPass', 'S0me-Real-Pass!'); await tp.press('#studentPass', 'Enter');
  await tp.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: 60000 });
  await tp.evaluate(() => showPage('s-resources'));
  await tp.waitForFunction(() => !!document.querySelector('#sResStudyKits .kit-row'), null, { timeout: 20000 });
  const list = await tp.evaluate(() => ({ text: document.getElementById('sResStudyKits').innerText, rows: document.querySelectorAll('#sResStudyKits .kit-row').length, noRes: getComputedStyle(document.getElementById('studentNoResourcesMsg')).display }));
  ok(list.rows >= 1 && list.text.indexOf(WELD.unitCode) !== -1 && /Study Kits/.test(list.text), 'My Resources: her programme\'s study kits, the ' + WELD.unitCode + ' kit among them (' + list.rows + ')');
  ok(!/Cosmetology|CSBCOS/i.test(list.text), 'and not another programme\'s');
  ok(list.noRes === 'none', '"No Resources Available Yet" is not said while kits are listed');
  ok(!/Not yet checked/.test(list.text), 'a trainee is not told a kit is unchecked');
  await theme(tp, 'dark'); await tp.screenshot({ path: path.join(SHOTS, '01-trainee-resources-dark.png') });
  await theme(tp, 'light'); await tp.screenshot({ path: path.join(SHOTS, '01-trainee-resources-light.png') });

  // The Study Kits tab shows the kits only; Videos hides them.
  await tp.evaluate(() => { const t = Array.from(document.querySelectorAll('#sResourceTabs .tab')).find(x => /Videos/.test(x.textContent)); t.click(); });
  ok(await tp.evaluate(() => document.getElementById('sResStudyKits').style.display === 'none'), 'the Videos tab hides the kits');
  await tp.evaluate(() => { const t = Array.from(document.querySelectorAll('#sResourceTabs .tab')).find(x => /Study Kits/.test(x.textContent)); t.click(); });
  ok(await tp.evaluate(() => document.getElementById('sResStudyKits').style.display !== 'none'), 'the Study Kits tab shows them');

  // Open the kit.
  await tp.evaluate(f => { const b = Array.from(document.querySelectorAll('#sResStudyKits .kit-row')).find(li => li.textContent.indexOf(f) !== -1).querySelector('.btn-primary'); b.click(); }, WELD.unitCode);
  await tp.waitForFunction(() => { const f = document.querySelector('#cestisViewer.open iframe'); return f && f.contentDocument && f.contentDocument.querySelector('#v-home:not([hidden]) .activity'); }, null, { timeout: 20000 });
  let kf = kitFrame(tp);
  const home = await kf.evaluate(() => ({ title: document.getElementById('page-title').textContent, theme: document.documentElement.getAttribute('data-theme'), staff: !document.getElementById('staff-note').hidden, summary: document.getElementById('home-summary').textContent }));
  ok(home.title.indexOf(WELD.unitCode) !== -1 && home.summary.length > 40, 'the kit opens over the page: its course page, with the unit and what it is about');
  ok(home.theme === 'light' && !home.staff, 'in the light theme the dashboard is set to; no staff note for a trainee');
  await tp.screenshot({ path: path.join(SHOTS, '02-kit-course-light.png') });
  await kf.evaluate(() => { location.hash = '#notes'; });
  await tp.waitForTimeout(400);
  const notes = await kf.evaluate(() => ({ secs: document.querySelectorAll('.sec').length, shown: document.querySelectorAll('.sec:not([hidden])').length, tables: document.querySelectorAll('.sec table.gen').length, drawer: document.querySelectorAll('.ci').length }));
  ok(notes.secs >= 5 && notes.shown === 1 && notes.drawer === notes.secs && notes.tables >= 1, 'Notes: ' + notes.secs + ' sections, one at a time, with the course index and tables');
  await tp.screenshot({ path: path.join(SHOTS, '03-kit-notes-light.png') });
  await kf.evaluate(() => document.querySelector('.ci[data-i="1"]').click());
  await tp.waitForTimeout(300);
  await tp.screenshot({ path: path.join(SHOTS, '03b-kit-notes-section2-light.png') });

  // The practice test: answer everything with the first option, submit.
  await kf.evaluate(() => { location.hash = '#test'; });
  await tp.waitForTimeout(400);
  await kf.click('#btn-attempt');
  await tp.waitForTimeout(300);
  await tp.screenshot({ path: path.join(SHOTS, '04-kit-question-light.png') });
  const n = await kf.evaluate(() => document.querySelectorAll('#qn-grid .qn').length);
  ok(n === WELD.questions, 'the practice test: ' + n + ' questions, one per page');
  // Answer every question correctly, from the kit itself.
  const kit = JSON.parse(KIT_TEXT);
  for (let i = 0; i < n; i++) {
    await kf.evaluate(({ i, ans }) => {
      const st = JSON.parse(localStorage.getItem('cestis_kit_attempt:' + new URLSearchParams(location.search).get('u')));
      const k = st.order[i].indexOf(ans);
      document.querySelectorAll('#answer label')[k].click();
      document.getElementById('next').click();
    }, { i, ans: kit.questions[i].a });
  }
  await tp.waitForTimeout(300);
  ok(await kf.evaluate(() => !document.getElementById('q-summary').hidden && /Answer saved/.test(document.getElementById('sum-body').textContent) && !/Not yet answered/.test(document.getElementById('sum-body').textContent)), 'Summary of attempt: every answer saved');
  await kf.click('#submit-all'); await kf.click('#m-ok');
  await tp.waitForTimeout(400);
  const rev = await kf.evaluate(() => ({ sum: document.getElementById('rev-sum').innerText, items: document.querySelectorAll('#rev-list .rq').length, why: document.querySelectorAll('#rev-list .outcome').length, best: localStorage.getItem('cestis_kit_best:' + new URLSearchParams(location.search).get('u')) }));
  ok(/100\.00/.test(rev.sum) && /Well done/.test(rev.sum) && rev.items === n && rev.why === n, 'submitted: 100%, every question shown with its explanation');
  ok(!!rev.best && JSON.parse(rev.best).grade === 100, 'the best grade is kept on the device');
  await tp.screenshot({ path: path.join(SHOTS, '05-kit-review-light.png') });
  await theme(tp, 'dark');
  await tp.waitForTimeout(300);
  ok(await kf.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'the kit follows the dashboard to dark');
  await tp.screenshot({ path: path.join(SHOTS, '05-kit-review-dark.png') });
  await kf.evaluate(() => { location.hash = '#notes'; });
  await tp.waitForTimeout(300);
  await tp.screenshot({ path: path.join(SHOTS, '03-kit-notes-dark.png') });
  await tp.click('#cestisViewer .cv-back');
  await tp.waitForTimeout(400);
  const after = await tp.evaluate(() => ({ open: document.getElementById('cestisViewer').classList.contains('open'), text: document.getElementById('sResStudyKits').innerText }));
  ok(!after.open && /Best 100% ✓/.test(after.text), 'Back to Resources: the list shows her best grade');

  /* ---- On a phone ---- */
  const pp = await newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await pp.goto(base + '/study-kits/kit.html?u=' + encodeURIComponent(WELD.file) + '#notes', { waitUntil: 'load' });
  await pp.waitForFunction(() => document.querySelectorAll('.sec').length > 0, null, { timeout: 15000 });
  const phone = await pp.evaluate(() => ({ select: getComputedStyle(document.querySelector('.mobile-index')).display !== 'none', drawer: getComputedStyle(document.querySelector('.drawer')).display, wide: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  ok(phone.select && phone.drawer === 'none' && !phone.wide, 'on a phone: the section picker instead of the side index, nothing wider than the screen');
  await pp.screenshot({ path: path.join(SHOTS, '06-phone-notes-dark.png') });
  await pp.evaluate(() => { localStorage.setItem('cestisTheme', 'light'); document.documentElement.setAttribute('data-theme', 'light'); location.hash = '#test'; });
  await pp.waitForTimeout(300);
  await pp.click('#btn-attempt'); await pp.waitForTimeout(300);
  await pp.screenshot({ path: path.join(SHOTS, '06-phone-question-light.png') });
  const bad = await pp.evaluate(async () => { const r = await fetch('kit.html?u=../cestis-core.js'); return r.ok; });
  await pp.goto(base + '/study-kits/kit.html?u=..%2Fcestis-core.js', { waitUntil: 'load' });
  ok(await pp.evaluate(() => /No study kit chosen/.test(document.getElementById('msg-h').textContent)) && bad, 'the page opens a kit\'s own file only (anything else: "No study kit chosen")');

  /* ---- The Administrator ---- */
  const ap = await newPage();
  await seed(ap, { role: 'admin', username: 'realadmin', name: 'Real Admin' });
  await ap.evaluate(async () => { if (!document.getElementById('adminLogin').classList.contains('active')) await window.handleAdminClick(); });
  await ap.fill('#adminUser', 'realadmin'); await ap.fill('#adminPass', 'S0me-Real-Pass!');
  await ap.evaluate(async () => { await window.handleAdminClick(); });
  await ap.waitForFunction(() => currentRole === 'admin', null, { timeout: 30000 });
  await ap.evaluate(() => showPage('a-resources'));
  await ap.waitForFunction(() => !!document.querySelector('#arStudyKits .kit-row'), null, { timeout: 20000 });
  const adm = await ap.evaluate(() => ({ text: document.getElementById('arStudyKits').innerText, progs: document.querySelectorAll('#arStudyKits details.kit-prog, #arStudyKits .kit-prog-h').length }));
  ok(adm.progs >= Math.min(2, new Set(INDEX.kits.map(k => k.qualId)).size) && /Not yet checked/.test(adm.text), 'Resource Manager: every programme\'s kits, folded by programme; an unchecked kit says so (' + adm.progs + ' programmes)');
  await ap.evaluate(() => document.querySelectorAll('#arStudyKits details.kit-prog').forEach(d => { d.open = true; }));
  await theme(ap, 'dark'); await ap.screenshot({ path: path.join(SHOTS, '07-admin-resources-dark.png') });
  await theme(ap, 'light'); await ap.screenshot({ path: path.join(SHOTS, '07-admin-resources-light.png') });
  // Filter: one programme, Study Kits only.
  await ap.evaluate(() => { const t = document.getElementById('arFilterType'); t.value = 'kits'; renderAdminResources(); });
  ok(await ap.evaluate(() => document.getElementById('adminResourcesList').innerHTML === '' && !!document.querySelector('#arStudyKits .kit-row')), 'the type filter "Study Kits" shows the kits only');
  await ap.evaluate(() => { document.getElementById('arFilterType').value = 'all'; renderAdminResources(); });

  // Upload Resource: Learner Guide, a unit, a web page.
  await ap.evaluate(() => openModal('driveUploadModal'));
  await ap.waitForTimeout(400);
  await ap.selectOption('#driveResCourse', { index: 1 }).catch(() => {});
  await ap.evaluate(() => { const s = document.getElementById('driveResCourse'); const o = Array.from(s.options).find(x => /Weld/i.test(x.value)); if (o) { s.value = o.value; s.dispatchEvent(new Event('change')); } });
  await ap.setInputFiles('#driveFileInput', { name: 'MMAW-learner-guide.html', mimeType: 'text/html', buffer: Buffer.from(GUIDE_HTML) });
  await ap.waitForTimeout(300);
  const form = await ap.evaluate(() => ({ cat: document.getElementById('driveResCategory').value, fmt: document.getElementById('driveResFormat').value, unitShown: document.getElementById('driveResUnitWrap').style.display !== 'none', units: document.querySelectorAll('#driveResUnit option').length }));
  ok(form.cat === 'learner-guide' && form.fmt === 'HTML' && form.unitShown && form.units > 10, 'choosing a web page makes it a Learner Guide, with the programme\'s units to choose from (' + form.units + ')');
  await ap.evaluate(u => { const s = document.getElementById('driveResUnit'); s.value = u; document.getElementById('driveResName').value = 'MMAW Learner Guide'; }, WELD.unitCode);
  await ap.screenshot({ path: path.join(SHOTS, '08-upload-learner-guide-light.png') });
  await ap.evaluate(() => closeModal('driveUploadModal'));
  // The upload itself goes to the Centre's Drive (not reachable here): the record it makes.
  await ap.evaluate(u => {
    driveResources.push({ id: 'DRES-guide1', resourceId: 'VT-GUIDE-0001', name: 'MMAW Learner Guide', course: 'Welding & Fabrication', category: 'learner-guide', format: 'HTML',
      url: 'https://drive.google.com/file/d/GUIDEFILE1/view', driveFileId: 'GUIDEFILE1', driveFileName: 'VT-GUIDE-0001_MMAW-learner-guide.html', unitCode: u, unitTitle: '', mime: 'text/html',
      uploadedBy: 'Admin', uploadedByRole: 'admin', uploadedAt: new Date().toISOString() });
    isCloudConnected = true; googleAccessToken = 'test-token';
    renderAdminResources();
  }, WELD.unitCode);
  const guideRow = await ap.evaluate(u => { const li = Array.from(document.querySelectorAll('#arStudyKits .kit-row')).find(x => x.textContent.indexOf(u) !== -1); return li ? li.innerText : ''; }, WELD.unitCode);
  ok(/Learner guide/.test(guideRow), 'the guide shows beside its unit\'s kit');
  ok(/Learner guide for/.test(await ap.evaluate(() => document.getElementById('adminResourcesList').innerText)), 'and in the resource list, with its unit');
  await ap.evaluate(() => openLearnerGuide('DRES-guide1'));
  await ap.waitForFunction(() => { const f = document.querySelector('#cestisViewer.open iframe'); return f && f.getAttribute('sandbox') !== null; }, null, { timeout: 15000 });
  await ap.waitForTimeout(800);
  const sealed = await ap.evaluate(() => { const f = document.querySelector('#cestisViewer iframe'); let reach; try { reach = !!f.contentDocument; } catch (e) { reach = false; } return { sandbox: f.getAttribute('sandbox'), reach, tab: document.querySelector('#cestisViewer .cv-tab').hidden }; });
  ok(!/allow-same-origin/.test(sealed.sandbox) && /allow-scripts/.test(sealed.sandbox) && !sealed.reach && sealed.tab, 'the guide opens sealed: its script runs, the page cannot be reached from it, no "new tab"');
  let probe = '';
  for (const f of ap.frames()) {
    if (f === ap.mainFrame()) continue;
    const t = await f.evaluate(() => { const el = document.getElementById('probe'); return el ? el.textContent : ''; }).catch(() => '');
    if (t) { probe = t; break; }
  }
  ok(/storage: blocked/.test(probe), 'its script cannot read this site\'s storage (' + probe + ')');
  await ap.screenshot({ path: path.join(SHOTS, '09-learner-guide-light.png') });
  // Opened again with no connection: from the device's own copy.
  await ap.evaluate(() => { cestisViewerClose(); isCloudConnected = false; googleAccessToken = null; });
  await ap.evaluate(() => openLearnerGuide('DRES-guide1'));
  await ap.waitForTimeout(800);
  ok(await ap.evaluate(() => !!document.querySelector('#cestisViewer.open iframe[sandbox]')), 'opened again with no connection: it opens from the copy kept on this device');
  await ap.evaluate(() => cestisViewerClose());

  // Admin opening a kit: the staff note.
  await ap.evaluate(f => openStudyKit(f), WELD.file);
  await ap.waitForFunction(() => { const f = document.querySelector('#cestisViewer.open iframe'); return f && f.contentDocument && f.contentDocument.querySelector('#v-home:not([hidden])'); }, null, { timeout: 15000 });
  kf = kitFrame(ap);
  ok(await kf.evaluate(() => !document.getElementById('staff-note').hidden), 'staff opening an unchecked kit are told to read it through first');
  await ap.screenshot({ path: path.join(SHOTS, '10-admin-kit-course-light.png') });

  ok(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
  await browser.close(); srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
