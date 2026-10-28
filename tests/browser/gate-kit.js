/* What the trainee gate's browser suites share (tests/browser/gate-staff.js,
   tests/browser/gate-flows.js): the site served from this worktree, the
   Centre's people, and a staff computer — its own browser storage, the
   Centre's shared files (tests/browser/fake-drive.js) and the trainee
   sign-in address — with the administrator signed in on it.

     const kit = require('./gate-kit');
     const srv = await kit.serve();                 // srv.base, srv.servePaste(true|false), srv.close()
     const k = kit.make({ browser, base, errors, gateUrl });
     const ctx = await k.computer({ drive, gate });
     const page = await k.adminSignedIn(ctx, { gateOn, extra, beforeSignIn, mutate, mutateArg }); */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const Core = require('../../cestis-core.js');
const { driveTokenSeed } = require('./fake-drive');

const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gs': 'text/plain', '.md': 'text/plain' };
const MAIN_FOLDER = '1lNpI00Et1BN5c4eaV5WfQwuQVhCMBtv8';   // GOOGLE_DRIVE_CONFIG.FOLDER_ID
const ADMIN = { id: 'USR-mthompson', name: 'Marcia Thompson', user: 'mthompson', pass: 'Centre-Admin-2026!' };
// Their student IDs are the dashboard's own stable ones (name + programme).
const TRAINEES = [
  { id: 'USR-trichards', name: 'Tameka Richards', user: 'tameka.richards', prog: 'Welding & Fabrication' },
  { id: 'USR-kjohnson', name: 'Kemar Johnson', user: 'kemar.johnson', prog: 'Welding & Fabrication' },
  { id: 'USR-rgrant', name: 'Rushane Grant', user: 'rushane.grant', prog: 'Electrical Installation' },
  { id: 'USR-dthompson', name: 'Dwayne Thompson', user: 'dwayne.thompson', prog: 'Electrical Installation' },
  { id: 'USR-scampbell', name: 'Shanique Campbell', user: 'shanique.campbell', prog: 'Cosmetology' },
  { id: 'USR-ofacey', name: 'Odalys Facey', user: 'odalys.facey', prog: 'Cosmetology' }
].map(t => Object.assign(t, { sid: Core.stableStudentId({ name: t.name, course: t.prog }) }));
const TRAINEE_PASS = 'Trainee-Pass-2026';
const QUESTIONS = [
  { id: 'Q1', type: 'mcq', points: 1, text: 'Which colour is the acetylene hose?', options: ['Red', 'Blue', 'Green', 'Black'], correctAnswer: 0 },
  { id: 'Q2', type: 'tf', points: 1, text: 'A flashback arrestor stops a flame travelling back into the cylinder.', correctAnswer: true },
  { id: 'Q3', type: 'shortanswer', points: 1, text: 'Name the device that stops a flame travelling back up the hose.', correctAnswer: ['flashback arrestor'] }
];

function serve(opts) {
  opts = opts || {};
  let paste = !!opts.servePaste;
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      // A site that does not serve the setup code yet (as before Stage 2 was published).
      if (p === '/trainee-gate/PASTE-GATE.gs' && !paste) { res.writeHead(404); return res.end('nope'); }
      if (opts.gateOff && p === '/gate-off' && opts.gateOff()) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('off'); }
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => {
      srv.base = 'http://127.0.0.1:' + srv.address().port;
      srv.servePaste = on => { paste = !!on; };
      resolve(srv);
    });
  });
}

function make(env) {
  const { browser, base } = env;
  const errors = env.errors || [];
  const GATE = env.gateUrl;
  /* A computer: its own browser storage, the Centre's shared files, and
     (when given) the trainee sign-in address. opts.phone: a phone's screen.
     opts.drive null: a device that never reaches the shared files at all. */
  async function computer(opts) {
    const o = opts.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 768 } };
    const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Jamaica' }, o));
    ctx._drive = opts.drive; ctx._gate = opts.gate; ctx._log = [];
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(base)) return r.continue();
      if (opts.extraRoute) { const done = opts.extraRoute(r, u); if (done) return done; }
      if (/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//.test(u)) {
        ctx._log.push(r.request().method() + ' ' + u);
        return opts.drive ? opts.drive.handle(r) : r.abort();
      }
      if (opts.gate && GATE && u.indexOf(GATE) === 0) { ctx._log.push('GATE ' + u); return opts.gate.handle(r); }
      return r.abort();
    });
    await ctx.addInitScript(t => { try { localStorage.setItem('cestis_sw_disabled', '1'); if (t === 'light') localStorage.setItem('cestisTheme', 'light'); } catch (e) {} }, opts.theme || 'dark');
    // Turn on waits for the trainee side. Stand it in unless a check asks to see the card without it.
    if (opts.stubTraineeClient) await ctx.addInitScript(() => { if (!window.CESTISGate) window.CESTISGate = { signIn: function () {}, stub: true }; });
    return ctx;
  }
  function watch(page, label) {
    page.on('pageerror', e => errors.push((label || '') + ' ' + String(e.message).slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    if (process.env.GATE_DEBUG) page.on('console', m => { if (new RegExp(process.env.GATE_DEBUG, 'i').test(m.text())) console.log('    [' + label + '] ' + m.text().slice(0, 300)); });
    return page;
  }
  // The Centre's records on this PC, then the administrator signed in.
  async function adminSignedIn(ctx, opts) {
    opts = opts || {};
    const page = watch(await ctx.newPage(), opts.label || 'admin');
    await page.goto(base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.evaluate(async ({ ADMIN, TRAINEES, QUESTIONS, extra, gateOn, GATE, token, TRAINEE_PASS }) => {
      const now = new Date().toISOString();
      const hash = await hashPassword(TRAINEE_PASS);
      const users = [{ id: ADMIN.id, name: ADMIN.name, role: 'admin', username: ADMIN.user, email: 'mthompson@example.com', password: await hashPassword(ADMIN.pass), status: 'active', updatedAt: now }];
      const studs = [];
      const list = TRAINEES.concat(extra ? Array.from({ length: extra }, (_, i) => {
        const F = ['Akeem', 'Brianna', 'Chevaughn', 'Dalvia', 'Everton', 'Fabian', 'Gaynelle', 'Horace', 'Imani', 'Jovaun', 'Kerry-Ann', 'Leroy', 'Mikhail', 'Nordia', 'Oneil', 'Petagaye', 'Rohan', 'Sashana', 'Tyrone', 'Venessa'];
        const L = ['Williams', 'Grant', 'Morgan', 'Richards', 'Campbell', 'Thompson', 'Lindo', 'Facey', 'Bailey', 'Gordon', 'Henry', 'Lewis', 'Reid', 'Wright', 'Mullings', 'Palmer', 'Spence', 'Bryan', 'Clarke', 'Daley'];
        const P = ['Welding & Fabrication', 'Electrical Installation', 'Cosmetology', 'Commercial Cooking', 'Plumbing'];
        const name = F[i % 20] + ' ' + L[Math.floor(i / 20) % 20] + (i >= 400 ? ' ' + i : '');
        return { id: 'USR-gen' + i, sid: CESTISCore.stableStudentId({ name, course: P[i % 5] }), name, user: 'trainee' + i, prog: P[i % 5] };
      }) : []);
      list.forEach(t => {
        users.push({ id: t.id, name: t.name, role: 'student', username: t.user, email: t.user + '@example.com', programme: t.prog, studentDataId: t.sid, password: hash, status: 'active', updatedAt: now });
        studs.push({ id: t.sid, name: t.name, course: t.prog, stage: 'training', email: t.user + '@example.com', gender: 'Female', progress: 40, updatedAt: now });
      });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
      CESTISStore.setItem('voctrain_students', JSON.stringify(studs));
      const st = CESTISCore.exams.centreParts(Date.now() + 2 * 86400000);
      CESTISStore.setItem('voctrain_exams', JSON.stringify([
        { id: 'EXAM-WS3', title: 'Welding Safety — Unit 3 Assessment', course: 'Welding & Fabrication', date: st.date, time: '09:00', duration: 60, status: 'upcoming', passMark: 60,
          questions: 3, questionData: QUESTIONS, answersRelease: 'after-close', questionsPerPage: 3, createdBy: 'admin', updatedAt: now },
        { id: 'EXAM-EI2', title: 'Electrical Installation — Circuits Quiz', course: 'Electrical Installation', date: st.date, time: '13:00', duration: 45, status: 'upcoming', passMark: 50,
          questions: 2, questionData: QUESTIONS.slice(0, 2), answersRelease: 'after-close', createdBy: 'admin', updatedAt: now },
        { id: 'EXAM-DRAFT', title: 'Not ready yet', course: 'Cosmetology', date: st.date, time: '10:00', duration: 30, status: 'draft', passMark: 50,
          questions: 1, questionData: QUESTIONS.slice(0, 1), createdBy: 'admin', updatedAt: now }]));
      CESTISStore.setItem('voctrain_assignments', JSON.stringify([{ id: 'ASG-WF-1', title: 'Butt joint practice piece', course: 'Welding & Fabrication', dueDate: '2026-11-20', maxPoints: 10, grades: {}, updatedAt: now }]));
      CESTISStore.setItem('voctrain_announcements', JSON.stringify([{ id: 'AN-WF-1', title: 'Welding safety week', body: 'Bring your goggles and gloves on Monday.', course: 'Welding & Fabrication',
        forRoles: ['student'], date: now.slice(0, 10), priority: 'normal', author: ADMIN.name, readBy: [], updatedAt: now }]));
      CESTISStore.setItem('voctrain_certTranscriptRequests', JSON.stringify([CESTISCore.Transcript.newRequest({ studentId: TRAINEES[0].sid, studentName: 'Tameka Richards',
        course: 'Welding & Fabrication', type: 'transcript', requestedAt: new Date(Date.now() - 86400000).toISOString() })]));
      const ss = JSON.parse(CESTISStore.getItem('voctrain_systemSettings') || '{}');
      if (gateOn) ss.traineeGate = { url: GATE, enabled: true, setAt: now, setBy: 'mthompson' };
      CESTISStore.setItem('voctrain_systemSettings', JSON.stringify(ss));
      Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k]));
    }, { ADMIN, TRAINEES, QUESTIONS, extra: opts.extra || 0, gateOn: !!opts.gateOn, GATE, token: driveTokenSeed(), TRAINEE_PASS });
    if (opts.mutate) await page.evaluate(opts.mutate, opts.mutateArg === undefined ? null : opts.mutateArg);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1300);
    if (opts.beforeSignIn) await page.evaluate(opts.beforeSignIn);
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } const l = document.getElementById('adminLogin'); if (!l.classList.contains('active')) document.querySelector('#adminCard .role-enter-btn').click(); });
    await page.waitForTimeout(200);
    await page.fill('#adminUser', ADMIN.user);
    await page.fill('#adminPass', ADMIN.pass);
    await page.press('#adminPass', 'Enter');
    await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && currentRole === 'admin', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    // Signed in for syncing (the seeded sign-in), the 5-second save running.
    await page.evaluate(() => {
      document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove());
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
      if (!isCloudConnected || !googleAccessToken) { googleAccessToken = CESTISStore.getItem('schoolDashboardGoogleAccessToken'); isCloudConnected = true; updateCloudUI(true); }
      if (!_autoSaveIntervalId) startAutoSave();
    });
    return page;
  }
  return { computer, watch, adminSignedIn };
}

module.exports = { serve, make, ROOT, MAIN_FOLDER, ADMIN, TRAINEES, TRAINEE_PASS, QUESTIONS };
