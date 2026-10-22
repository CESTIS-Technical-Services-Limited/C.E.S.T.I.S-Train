/* Upgrade safety: a Centre that updates its site loses nothing.
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/upgrade-no-data-loss.js
     (npm run test:browser:upgrade)

   What it does, in a real browser with every outside request cut:
     1. Materialises the PRE-OVERHAUL build (git commit 3fc154a, or
        CESTIS_OLD_REF) into a temp folder and serves it and this working tree
        from ONE origin, switching the server's root between them — so the
        browser's IndexedDB and localStorage carry over exactly as they do for a
        Centre whose GitHub Pages site is updated under it.
     2. With the OLD build loaded, seeds a whole Centre through the old pages'
        own functions (Student Progress's addStudent, approveUser, saveState,
        approveCertDownload, the fee page's saveData, the Cashbook's
        saveToStorage, the virement page's saveAllData, FinanceDoc.saveDoc, the
        transcript upsert ...), lets every old page settle, and snapshots every
        storage key and every record.
     3. Switches the server to the NEW build, signs in as the administrator
        through the login form, lets every first-load migration run, saves,
        opens every sibling page, reloads, and signs in once as an instructor
        and as a trainee.
     4. Checks every pre-upgrade record is still there (same id, or provably
        migrated — legacy weekly attendance into the dated register), that no
        key which held records is now empty, that no page threw, and that the
        new build's Export Backup carries it all. A trainee's sign-out is run in
        BOTH builds from the same copy of the store and compared, so only what
        the old build also cleared may go.
     5. The Offline System: the real cestis-offline-server.js with a temp data
        folder, seeded through the OLD offline build, then the NEW (generated)
        offline build is put in front of the same data folder; the server's
        files and a fresh device's view must keep every record.
   Set UPGRADE_KEEP=1 to keep the temp folder (snapshots are written there).
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const OLD_REF = process.env.CESTIS_OLD_REF || '3fc154a';
const EXE = process.env.CESTIS_CHROME ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : '/opt/pw-browsers/chromium');
const KEEP = !!process.env.UPGRADE_KEEP;
let passed = 0, failed = 0;
const failures = [], notes = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; failures.push(msg); console.log('  ✗ FAIL: ' + msg); } return !!cond; }
function note(msg) { notes.push(msg); console.log('  · ' + msg); }
function section(t) { console.log('\n' + t); }
const wait = ms => new Promise(r => setTimeout(r, ms));

// The Centre's real passwords — never the published default.
const PW = {
  admin: 'Centre-Admin-2026!', adminstaff: 'Office-Staff-2026!', cmc: 'Board-Chair-2026!',
  instructor: 'Teach-Weld-2026!', student: 'Trainee-Pass-2026!'
};

/* ------------------------------------------------------------------ trees */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-upgrade-'));
const OLD = path.join(TMP, 'old');
fs.mkdirSync(OLD);
execSync('git -C "' + ROOT + '" archive --format=tar ' + OLD_REF + ' | tar -x -C "' + OLD + '"', { stdio: 'inherit', shell: '/bin/bash' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const BLANK = '<!doctype html><meta charset="utf-8"><title>storage probe</title><body>storage probe</body>';
let SERVE_ROOT = OLD;
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/__blank.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(BLANK); }
      const root = SERVE_ROOT;
      const file = path.normalize(path.join(root, p === '/' ? 'index.html' : p));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      // no-store: once the root is switched nothing may come from the HTTP cache.
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ------------------------------------------------------- storage snapshots
   Read straight from the browser's storage on a blank page of the same origin,
   so no application code runs while it is read: localStorage first (the store
   reads it first), then IndexedDB CESTIS_KV for anything only there. */
async function rawDump(ctx, base) {
  const page = await ctx.newPage();
  await page.goto(base + '/__blank.html');
  const out = await page.evaluate(async () => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
    const idb = await new Promise(resolve => {
      const req = indexedDB.open('CESTIS_KV');
      req.onerror = () => resolve({});
      req.onupgradeneeded = e => { try { e.target.result.createObjectStore('kv'); } catch (x) {} };
      req.onsuccess = e => {
        const db = e.target.result, o = {};
        if (!db.objectStoreNames.contains('kv')) { db.close(); return resolve(o); }
        const cur = db.transaction('kv', 'readonly').objectStore('kv').openCursor();
        cur.onsuccess = ev => { const c = ev.target.result; if (c) { o[c.key] = c.value; c.continue(); } else { db.close(); resolve(o); } };
        cur.onerror = () => { db.close(); resolve(o); };
      };
    });
    const dbs = (indexedDB.databases ? await indexedDB.databases() : []).map(d => d.name);
    return { ls, idb, dbs };
  });
  await page.close();
  const eff = {};
  Object.keys(out.idb).forEach(k => { if (out.idb[k] != null) eff[k] = String(out.idb[k]); });
  Object.keys(out.ls).forEach(k => { eff[k] = out.ls[k]; });
  return { eff, ls: out.ls, idb: out.idb, dbs: out.dbs };
}
// Write a dump into a (fresh) browser context's storage, the way the store
// itself writes: both localStorage (when it fits) and IndexedDB.
async function rawRestore(ctx, base, eff) {
  const page = await ctx.newPage();
  await page.goto(base + '/__blank.html');
  await page.evaluate(async (eff) => {
    localStorage.clear();
    Object.keys(eff).forEach(k => { try { localStorage.setItem(k, eff[k]); } catch (e) {} });
    await new Promise(resolve => {
      const req = indexedDB.open('CESTIS_KV', 1);
      req.onupgradeneeded = e => { const d = e.target.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
      req.onsuccess = e => {
        const db = e.target.result, tx = db.transaction('kv', 'readwrite'), os = tx.objectStore('kv');
        os.clear();
        Object.keys(eff).forEach(k => os.put(eff[k], k));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    });
  }, eff);
  await page.close();
}

function parse(v) { try { return JSON.parse(v); } catch (e) { return undefined; } }

/* ------------------------------------------------------- record extraction
   Every key is turned into { recordId: record }. Arrays of records are keyed by
   their id (or the natural key the old code used where it had no id); maps are
   keyed by their own keys; a few structured blobs are opened up. */
const MAIN_ALIAS = { 'main:attendanceRecords': 'voctrain_attendance', 'main:calendarEvents': 'voctrain_calendarEvents',
  'main:transcriptGrades': 'voctrain_transcriptGrades', 'main:virements': 'cesti_virements' };
function ridOf(key, r, i) {
  key = MAIN_ALIAS[key] || key;
  if (key === 'voctrain_calendarEvents') return r.id || (r.title + '|' + r.date);
  // A legacy weekly row has no id; it is the trainee's row WITH those marks.
  if (/^voctrain_attendance(::|$)/.test(key)) return 'row:' + r.studentId + '|' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(d => (r.days || {})[d] || '').join(',');
  if (key === 'voctrain_transcriptGrades') return [r.studentId, r.qualId, r.unitCode].join('|');
  if (key === 'cesti_virements') return 'vir:' + r.id;
  if (r.id != null && r.id !== '') return String(r.id);
  if (r.uid) return 'uid:' + r.uid;
  if (r.username) return 'user:' + r.username;
  if (r.name) return 'name:' + r.name;
  return '#' + i;
}
function recordsOf(key, v) {
  if (v == null || typeof v !== 'object') return null;
  const recs = {};
  if (/^cestis_quarter_/.test(key)) {
    recs.__openingBalance = { value: v.openingBalance };
    (v.transactions || []).forEach((t, i) => { recs['txn:' + (t.uid || t.id || i)] = t; });
    (v.deletedTxnIds || []).forEach(id => { recs['deleted:' + id] = { id }; });
    return recs;
  }
  if (key === 'cestisPayroll' || key === 'cestisPayroll_backup') {
    (v.employees || []).forEach(e => { recs['emp:' + e.name] = e; });
    (v.payrollRuns || []).forEach(r => { recs['run:' + r.date] = r; });
    if (v.settings) recs.__settings = v.settings;
    return recs;
  }
  if (key === 'cestisStaffAppraisals') {
    Object.keys(v.cycles || {}).forEach(ck => Object.keys(v.cycles[ck] || {}).forEach(sid => { recs['app:' + ck + '/' + sid] = v.cycles[ck][sid]; }));
    (v.extraStaff || []).forEach(s => { recs['extra:' + s.id] = s; });
    Object.keys(v.assignments || {}).forEach(s => { recs['assign:' + s] = { value: v.assignments[s] }; });
    return recs;
  }
  if (key === 'voctrain_chatMessages' || /^voctrain_user_.*_chatMessages$/.test(key)) {
    Object.keys(v).forEach(room => (Array.isArray(v[room]) ? v[room] : []).forEach((m, i) => { recs[room + '/' + (m.id || i)] = m; }));
    return recs;
  }
  if (Array.isArray(v)) {
    v.forEach((r, i) => {
      if (r == null || typeof r !== 'object') { recs['val:' + JSON.stringify(r)] = { value: r }; return; }
      recs[ridOf(key, r, i)] = r;
    });
    return recs;
  }
  Object.keys(v).forEach(k => { recs[k] = (v[k] != null && typeof v[k] === 'object') ? v[k] : { value: v[k] }; });
  return recs;
}

// Fields that must never change across an upgrade when the old record had them.
const PROTECTED = ['id', 'name', 'fullName', 'title', 'course', 'skillArea', 'certNo', 'certDate', 'amount', 'deposit',
  'payment', 'value', 'tuitionFee', 'score', 'grade', 'grades', 'passed', 'needsReview', 'password', 'username', 'role',
  'twoFactorSecret', 'twoFactorEnabled', 'backupCodes', 'studentId', 'studentDataId', 'examId', 'assignmentId', 'receiptNumber',
  'date', 'days', 'total', 'lines', 'signatures', 'salary', 'gross', 'netPay', 'results', 'items', 'number', 'text', 'body',
  'questionData', 'answers', 'files', 'approved', 'decision', 'byUsername', 'clockIn', 'clockOut', 'staffId', 'dob', 'address',
  'idNo', 'qualId', 'unitCode', 'openingBalance', 'category', 'details', 'cheque', 'fileName', 'googleDriveFileId', 'type',
  'readBy', 'senderId', 'participants', 'startedAt', 'endedAt', 'members', 'maxPoints', 'passMark', 'email', 'gender', 'nationalId'];
// Fields whose change is a status the new build may legitimately recompute —
// reported, never silently accepted, but not counted as loss.
const STATUS_ONLY = ['status', 'stage', 'balance', 'totalPaid', 'progress', 'attendance', 'students', 'materials', 'time',
  'updatedAt', 'lastModified', 'editedAt', 'centreKey', 'fiscalYear'];
function stable(x) { return JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {}) : v); }

/* ------------------------------------------------------------- the Centre
   Three programmes: two intakes running now, and a Cosmetology intake that has
   finished (its trainees certified). Two different people called Andre Brown
   on two different programmes; one trainee who is deleted (tombstoned). */
const WELD = 'Welding & Fabrication', ELEC = 'Electrical Installation', COSM = 'Cosmetology';
const ROSTER = [].concat(
  ['Andre Brown', 'Kimani Clarke', 'Shanice Reid', 'Tevin Morgan', 'Orane Campbell', 'Jodian Williams', 'Rushane Grant',
   'Kerry-Ann Thomas', 'Damion Henry', 'Tashana Lewis', 'Romario Walker', 'Shamar Bailey', 'Alecia Robinson',
   'Javaughn Palmer', 'Monique Edwards', 'Odane Francis'].map(n => ({ name: n, course: WELD, tag: 'w' })),
  ['Andre Brown', 'Jermaine Wright', 'Kadian Scott', 'Nickoy Allen', 'Sasha-Gaye Hall', 'Rojae Green', 'Tamoy Mitchell',
   'Dwayne Spence', 'Chevelle Hamilton', 'Akeem Johnson', 'Brittany Gordon', 'Kemoy Barrett', 'Shereece Powell',
   'Kemar Deleteme'].map(n => ({ name: n, course: ELEC, tag: 'e' })),
  ['Tiffany Daley', 'Renee Anderson', 'Shauna Brooks', 'Latoya McKenzie', 'Nadine Ellis', 'Keisha Simpson',
   'Annmarie Watson', 'Petagaye Stewart', 'Jhanel Bennett', 'Crystal Ricketts'].map(n => ({ name: n, course: COSM, tag: 'c' }))
).map((t, i) => Object.assign(t, {
  email: t.name.toLowerCase().replace(/[^a-z]+/g, '.') + '.' + t.tag + '@trainee.example',
  gender: (i % 3 === 0) ? 'Male' : 'Female'
}));
const DELETED_TRAINEE = 'Kemar Deleteme';
const STUDENT_LOGIN = { name: 'Kimani Clarke', course: WELD };
const DISABLED_LOGIN = { name: 'Rushane Grant', course: WELD };
const INSTRUCTORS = [
  { name: 'Garfield Myers', username: 'gmyers', programme: WELD },
  { name: 'Paulette Hinds', username: 'phinds', programme: ELEC },
  { name: 'Sophia Grant', username: 'sgrant', programme: COSM }
];

/* ======================= old build: the dashboard (signed in as admin) ===== */
async function oldIndexAccountsAndCentres(a) {
  var PW = a.PW, INSTRUCTORS = a.INSTRUCTORS;
  var C = function (n) { return skillAreas.find(function (s) { return s.name === n; }); };
  C('Welding & Fabrication').startDate = '2026-04-06'; C('Welding & Fabrication').endDate = '2027-03-26';
  C('Electrical Installation').startDate = '2026-04-06'; C('Electrical Installation').endDate = '2027-03-26';
  // Open while its trainees are enrolled; it is closed (ended) after they qualify.
  C('Cosmetology').startDate = '2025-09-01'; C('Cosmetology').endDate = '2027-01-29';
  CESTISCore.enrolment.assignCentreKeys(skillAreas);
  saveCollection('voctrain_skillAreas', skillAreas);
  // The built-in logins carry the Centre's own passwords; two-step on Admin Staff.
  var A = userAccounts.find(function (u) { return u.id === 'USR-001'; });
  A.password = await hashPassword(PW.admin); delete A.defaultPassword; touchAccount(A);
  var S = userAccounts.find(function (u) { return u.id === 'USR-011'; });
  S.password = await hashPassword(PW.adminstaff); delete S.defaultPassword;
  S.twoFactorEnabled = true; S.twoFactorSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  S.backupCodes = [{ code: 'K7PQ2M4X', used: false }, { code: 'R9TW3HZA', used: true }, { code: 'BN6CE8FD', used: false }];   // the old build's own shape (tfaGenerateBackupCodes) S.twoFactorUpdatedAt = new Date().toISOString(); touchAccount(S);
  var M = userAccounts.find(function (u) { return u.id === 'USR-021'; });
  M.password = await hashPassword(PW.cmc); delete M.defaultPassword; touchAccount(M);
  // Run again when the old build's own sign-in sync replaced the list under
  // it (see seedOldCentre), so only what is missing is added.
  var has = function (f) { return userAccounts.some(f); };
  if (!has(function (u) { return u.id === 'USR-DEPUTY'; })) userAccounts.push({ id: 'USR-DEPUTY', name: 'Deputy Administrator', role: 'admin', username: 'deputyadmin',
    password: await hashPassword(PW.admin + '-2'), email: 'deputy@centre.example', programme: '', status: 'active', createdAt: '2026-02-01' });
  if (!has(function (u) { return u.id === 'USR-CMC2'; })) userAccounts.push({ id: 'USR-CMC2', name: 'Board Member Two', role: 'cmc', username: 'cmcmember',
    password: await hashPassword(PW.cmc + '-2'), email: 'board2@centre.example', programme: '', status: 'active', createdAt: '2026-02-01' });
  // Instructors register, then the administrator approves them (which creates their instructor record).
  for (var i = 0; i < INSTRUCTORS.length; i++) {
    var I = INSTRUCTORS[i];
    if (has(function (u) { return u.username === I.username; })) continue;
    var id = cestisGenId('USR-');
    userAccounts.push({ id: id, name: I.name, role: 'instructor', username: I.username, password: await hashPassword(PW.instructor),
      email: I.username + '@centre.example', programme: I.programme, status: 'pending', createdAt: localDateStr(), registeredVia: 'self-registered' });
    approveUser(id);
  }
  saveState();
  var stored = []; try { stored = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]'); } catch (e) {}
  return { users: userAccounts.length, instructors: instructorData.length,
    complete: ['USR-DEPUTY', 'USR-CMC2'].every(function (id) { return stored.some(function (u) { return u.id === id; }); }) &&
      INSTRUCTORS.every(function (x) { return stored.some(function (u) { return u.username === x.username; }); }) };
}

// Inside the embedded Student Progress frame: its own Add Student form.
async function oldSpAddTrainees(list) {
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    document.getElementById('newStudentName').value = t.name;
    document.getElementById('newStudentEmail').value = t.email;
    document.getElementById('newStudentCourse').value = t.course;
    document.getElementById('newStudentGender').value = t.gender;
    document.getElementById('newStudentStage').value = 'training';
    await addStudent();
    await new Promise(function (r) { setTimeout(r, 25); });
  }
  return students.length;
}

async function oldIndexLogins(a) {
  var PW = a.PW;
  // --- trainee logins: each registers, the administrator approves (links to the record)
  for (var i = 0; i < a.ROSTER.length; i++) {
    var t = a.ROSTER[i];
    var uid = cestisGenId('USR-');
    var known = (t.name === a.STUDENT_LOGIN.name && t.course === a.STUDENT_LOGIN.course);
    userAccounts.push({ id: uid, name: t.name, role: 'student', username: t.email.split('@')[0], email: t.email,
      password: await hashPassword(known ? PW.student : (t.name.split(' ')[0].toLowerCase() + '-Pass-2026')),
      programme: t.course, status: 'pending', createdAt: localDateStr(), registeredVia: 'self-registered' });
    approveUser(uid);
  }
  var dis = userAccounts.find(function (u) { return u.role === 'student' && u.name === a.DISABLED_LOGIN.name; });
  dis.status = 'disabled'; touchAccount(dis);

  saveState();
  return userAccounts.filter(function (u) { return u.role === 'student'; }).length;
}

// Inside the Student Progress frame: its own Delete Student (tombstones the trainee).
async function oldSpDeleteTrainee(name) {
  var idx = students.findIndex(function (s) { return s.name === name; });
  var id = students[idx].id;
  openDeleteStudent(idx);
  confirmDeleteStudent();
  return id;
}

async function oldIndexCentreData(a) {
  var PW = a.PW, out = {};
  var by = function (name, course) { return students.find(function (s) { return s.name === name && s.course === course; }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // --- profiles
  students.slice(0, 6).forEach(function (s, k) {
    studentProfiles[s.id] = { phone: '876-555-01' + (10 + k), address: (10 + k) + ' Main Street, May Pen', dob: '2001-0' + (1 + k % 9) + '-15',
      nextOfKin: 'Parent ' + s.name.split(' ')[1], trn: '1234567' + k };
  });
  var ins = userAccounts.filter(function (u) { return u.role === 'instructor'; });
  ins.forEach(function (u, k) { instructorProfiles[u.id] = { bio: 'Instructor of ' + u.programme, phone: '876-555-02' + (10 + k) }; });

  // --- exams (two share a title on one programme) and results (one needs review)
  function q(type, text, extra) { return Object.assign({ id: cestisGenId('Q-') + '-' + Math.random().toString(36).substr(2, 4), type: type, text: text, points: 2 }, extra); }
  function exam(id, title, course, date, status) {
    return { id: id, title: title, course: course, date: date, time: '09:00', duration: 60, students: 0, status: status,
      questions: 4, passMark: 60, shuffleQuestions: false, instructions: 'Answer all questions.', createdBy: 'admin', createdByRole: 'admin',
      questionData: [
        q('mcq', title + ': which gas shields a MIG weld?', { options: ['Argon', 'Oxygen', 'Hydrogen', 'Air'], correctAnswer: 0 }),
        q('tf', title + ': PPE is optional', { correctAnswer: false }),
        q('fill', title + ': SMAW stands for Shielded ___ Arc Welding', { correctAnswer: 'Metal' }),
        q('short', title + ': describe a safe workshop', { correctAnswer: '', autoGrade: false })
      ] };
  }
  exams.unshift(exam('EXAM-UPG-W1', 'Welding Theory Unit 1', 'Welding & Fabrication', '2026-06-12', 'completed'));
  exams.unshift(exam('EXAM-UPG-W2', 'Workshop Safety', 'Welding & Fabrication', '2026-07-03', 'completed'));
  exams.unshift(exam('EXAM-UPG-W3', 'Workshop Safety', 'Welding & Fabrication', '2026-11-20', 'upcoming'));
  exams.unshift(exam('EXAM-UPG-E1', 'Electrical Fundamentals', 'Electrical Installation', '2026-06-19', 'completed'));
  exams.unshift(exam('EXAM-UPG-C1', 'Cosmetology Final Theory', 'Cosmetology', '2026-06-26', 'completed'));
  function result(ex, s, k, pending) {
    var qs = ex.questionData, pts = 0, earned = 0, answers = [];
    qs.forEach(function (qq, j) {
      pts += qq.points;
      var right = ((k + j) % 3) !== 0, manual = (qq.type === 'fill' || qq.type === 'short');
      var e = (right && !manual) ? qq.points : 0; earned += e;
      answers.push({ questionId: qq.id, questionText: qq.text, type: qq.type, studentAnswer: right ? qq.correctAnswer : 'x', correctAnswer: qq.correctAnswer,
        isCorrect: manual ? null : right, needsManualGrade: manual && pending, points: qq.points, earnedPoints: e,
        awardedPoints: manual ? (pending ? null : (right ? qq.points : 0)) : e, graded: !(manual && pending), gradedBy: manual ? (pending ? null : 'instructor') : 'auto' });
      if (manual && !pending && right) earned += qq.points;
    });
    var score = Math.round(earned / pts * 100);
    return { id: 'RES-UPG-' + ex.id.slice(-2) + '-' + k, examId: ex.id, studentId: s.id, studentName: s.name, answers: answers, score: score,
      correctCount: answers.filter(function (x) { return x.isCorrect; }).length, totalQuestions: qs.length, totalPoints: pts, earnedPoints: earned,
      passed: pending ? false : score >= 60, needsReview: !!pending, reviewComplete: !pending, pendingCount: pending ? 2 : 0,
      submittedAt: new Date(Date.parse(ex.date + 'T10:30:00Z') + k * 60000).toISOString(), timeTaken: 1500 + k * 7 };
  }
  var exW1 = exams.find(function (e) { return e.id === 'EXAM-UPG-W1'; }), exW2 = exams.find(function (e) { return e.id === 'EXAM-UPG-W2'; });
  var exE1 = exams.find(function (e) { return e.id === 'EXAM-UPG-E1'; }), exC1 = exams.find(function (e) { return e.id === 'EXAM-UPG-C1'; });
  var weld = students.filter(function (s) { return s.course === 'Welding & Fabrication'; });
  var elec = students.filter(function (s) { return s.course === 'Electrical Installation'; });
  var cosm = students.filter(function (s) { return s.course === 'Cosmetology'; });
  weld.slice(0, 10).forEach(function (s, k) { examResults.push(result(exW1, s, k, k === 3)); });
  weld.slice(0, 6).forEach(function (s, k) { examResults.push(result(exW2, s, k + 20, false)); });
  elec.slice(0, 8).forEach(function (s, k) { examResults.push(result(exE1, s, k + 40, false)); });
  cosm.forEach(function (s, k) { examResults.push(result(exC1, s, k + 60, false)); });

  // --- certificates: the Cosmetology intake qualifies; one collected; downloads approved, one revoked
  cosm.slice(0, 7).forEach(function (s, k) { s.stage = (k === 6) ? 'collected' : 'certified'; s.lastModified = new Date().toISOString(); });
  backfillCertificateNumbers();
  cosm.slice(0, 7).forEach(function (s) { approveCertDownload(s.id); });
  revokeCertDownload(cosm[2].id);
  out.certs = cosm.slice(0, 7).map(function (s) { return { id: s.id, name: s.name, certNo: s.certNo }; });

  // --- assignments with grades, one submission carrying a file inside it
  var asnW = { id: cestisGenId('ASN-'), title: 'Fillet Weld Report', type: 'assignment', course: 'Welding & Fabrication', dueDate: '2026-09-30',
    maxPoints: 100, weight: 10, instructions: 'Weld and document.', attachments: [], requireSubmission: true, createdBy: 'Garfield Myers',
    createdAt: '2026-09-01T12:00:00.000Z', grades: {} };
  weld.slice(0, 5).forEach(function (s, k) { asnW.grades[s.id] = 70 + k * 5; });
  var asnE = { id: cestisGenId('ASN-'), title: 'Circuit Diagram', type: 'project', course: 'Electrical Installation', dueDate: '2026-10-15',
    maxPoints: 50, weight: 15, instructions: 'Draw the ring main.', attachments: [], requireSubmission: true, createdBy: 'Paulette Hinds',
    createdAt: '2026-09-10T12:00:00.000Z', grades: {} };
  elec.slice(0, 4).forEach(function (s, k) { asnE.grades[s.id] = 30 + k * 4; });
  instructorAssignments.push(asnW, asnE);
  var pdf = 'data:application/pdf;base64,' + btoa('%PDF-1.4\n% upgrade test submission\n' + 'x'.repeat(600) + '\n%%EOF');
  assignmentSubmissions.push({ id: cestisGenId('SUB-'), assignmentId: asnW.id, studentId: weld[0].id, studentName: weld[0].name, course: weld[0].course,
    files: [{ name: 'fillet-weld-report.pdf', size: 680, type: 'application/pdf', dataUrl: pdf }], driveFiles: [], comment: 'My report', submittedAt: '2026-09-28T15:00:00.000Z' });
  assignmentSubmissions.push({ id: cestisGenId('SUB-'), assignmentId: asnE.id, studentId: elec[1].id, studentName: elec[1].name, course: elec[1].course,
    files: [{ name: 'ring-main.png', size: 120, type: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }],
    driveFiles: [], comment: '', submittedAt: '2026-10-12T15:00:00.000Z' });

  // --- resources, announcements, calendar, sessions, meetings
  instructorResources.push({ id: cestisGenId('RES-'), name: 'Welding Safety Handbook', category: 'Reading', type: 'pdf', url: 'https://example.org/weld.pdf',
    description: 'Read before the practical', course: 'Welding & Fabrication', createdBy: 'Garfield Myers', createdAt: '2026-05-01T10:00:00.000Z' });
  instructorResources.push({ id: cestisGenId('RES-'), name: 'Wiring Regulations', category: 'Reference', type: 'link', url: 'https://example.org/regs',
    description: '', course: 'Electrical Installation', createdBy: 'Paulette Hinds', createdAt: '2026-05-02T10:00:00.000Z' });
  driveResources.push({ id: cestisGenId('DRV-'), name: 'Centre Prospectus 2026', category: 'General', driveFileId: 'drive-file-prospectus', url: 'https://drive.example/prospectus',
    uploadedBy: 'Administrator', uploadedAt: '2026-04-01T10:00:00.000Z', course: 'All' });
  documentHubFiles.push({ id: cestisGenId('DOC-'), name: 'Staff Handbook.pdf', category: 'HR', driveFileId: 'drive-file-handbook', uploadedAt: '2026-04-02T10:00:00.000Z', uploadedBy: 'Administrator' });
  announcements.unshift({ id: cestisGenId('ANN-'), title: 'Term begins', body: 'Welcome back, the term begins on Monday.', priority: 'general', date: '2026-04-06', author: 'Administrator', forRoles: ['admin', 'instructor', 'student'] });
  announcements.unshift({ id: cestisGenId('ANN-'), title: 'Exam timetable', body: 'Exams start on 20 November.', priority: 'urgent', date: '2026-10-01', author: 'Administrator', forRoles: ['student'] });
  announcements.unshift({ id: cestisGenId('ANN-'), title: 'Staff meeting', body: 'Staff meeting Friday 2pm.', priority: 'general', date: '2026-10-05', author: 'Administrator', forRoles: ['admin', 'adminstaff', 'instructor'] });
  var cc = { class: 'var(--blue)', exam: 'var(--red)', deadline: 'var(--accent)', meeting: 'var(--purple)' };
  [['Workshop Safety (resit)', '2026-11-20', '09:00 AM', 'exam'], ['Report due', '2026-09-30', '05:00 PM', 'deadline'],
   ['Board meeting', '2026-10-28', '02:00 PM', 'meeting'], ['Graduation', '2026-12-04', '10:00 AM', 'class']].forEach(function (e) {
    calendarEvents.push({ title: e[0], date: e[1], time: e[2], type: e[3], color: cc[e[3]], forRoles: ['admin', 'adminstaff', 'instructor', 'student'] });
  });
  ['Welding & Fabrication', 'Electrical Installation', 'Welding & Fabrication'].forEach(function (course, k) {
    classSessions.push({ id: cestisGenId('CS-'), name: course + ' theory ' + (k + 1), course: course, date: '2026-10-2' + k, time: '10:00', duration: 90,
      type: 'theory', location: 'Virtual-01', roomCode: 'ROOM' + k + 'X', status: 'scheduled', createdBy: 'Admin', createdAt: new Date().toISOString() });
  });
  adminMeetings.push({ id: cestisGenId('MTG-'), title: 'Budget review', date: '2026-10-30', time: '11:00', agenda: 'Q3 budget', createdBy: 'Administrator', createdAt: new Date().toISOString() });
  var VS = CESTISCore.vcSessions;
  for (var v = 0; v < 2; v++) {
    var ses = VS.startSession({ code: 'VC-UPG-' + v, title: 'Live class ' + (v + 1), course: v ? 'Electrical Installation' : 'Welding & Fabrication',
      hostName: 'Garfield Myers', hostRole: 'instructor', startedAt: '2026-10-0' + (5 + v) + 'T14:00:00.000Z', locked: true, lobby: true });
    VS.recordJoin(ses, 'p1', weld[1].name, '2026-10-0' + (5 + v) + 'T14:01:00.000Z');
    VS.recordJoin(ses, 'p2', weld[2].name, '2026-10-0' + (5 + v) + 'T14:03:00.000Z');
    VS.recordLeave(ses, 'p2', weld[2].name, '2026-10-0' + (5 + v) + 'T14:40:00.000Z');
    VS.endSession(ses, '2026-10-0' + (5 + v) + 'T15:00:00.000Z');
    vcSessions.push(ses);
  }
  saveState();
  for (var n = 0; n < 5; n++) { addNotification('Upgrade test notice ' + (n + 1), n % 2 ? 'exam' : 'info', null, ['admin', 'instructor']); await wait(5); }

  // --- chat: class rooms exist from load; messages, a DM room
  var me = userAccounts.find(function (u) { return u.id === 'USR-001'; });
  var gm = userAccounts.find(function (u) { return u.username === 'gmyers'; });
  var dmId = 'dm-' + [me.id, gm.id].sort().join('-');
  if (!lmsChatRooms.some(function (r) { return r.id === dmId; })) lmsChatRooms.push({ id: dmId, name: gm.name, type: 'dm', members: [me.id, gm.id], createdBy: me.id, icon: '💬' });
  [['chat-admin', me, 'Office opens at 8 tomorrow'], ['chat-class-1', gm, 'Bring your PPE on Monday'], [dmId, me, 'Please submit the marks'], [dmId, gm, 'Marks sent']].forEach(function (m, k) {
    lmsChatMessages[m[0]] = lmsChatMessages[m[0]] || [];
    lmsChatMessages[m[0]].push({ id: 'msg-upg-' + k, roomId: m[0], senderId: m[1].id, senderName: m[1].name, text: m[2], type: 'text',
      timestamp: '2026-10-1' + k + 'T09:00:00.000Z', readBy: [m[1].id] });
  });
  lmsChatProfiles[me.id] = Object.assign({}, lmsChatProfiles[me.id] || {}, { status: 'Available', bio: 'Centre administrator' });
  lmsChatFollows[me.id] = [gm.id];
  saveLmsChatData();
  saveState();
  out.counts = { students: students.length, users: userAccounts.length, exams: exams.length, results: examResults.length,
    approvals: certDownloadApprovals.length, notifications: notifications.length, rooms: lmsChatRooms.length };
  return out;
}

/* Legacy weekly attendance, the way the old register kept it: one row per
   trainee per financial quarter, Mon–Fri, in voctrain_attendance::<FY>_Q<n>.
   Walks the shared quarter bar through Q1, Q2 and the current quarter. */
async function oldIndexAttendance(a) {
  var out = {};
  var cur = CESTISCore.getActiveQuarter();
  var plan = [
    { fy: cur.fy, q: 1, rowDate: '2026-04-13', pattern: ['present', 'present', 'late', 'absent', 'present'] },
    { fy: cur.fy, q: 2, rowDate: '2026-07-06', pattern: ['present', 'late', 'present', 'present', 'absent'] },
    { fy: cur.fy, q: cur.q, rowDate: '2026-10-05', pattern: ['late', 'present', 'present', 'absent', 'present'] }
  ];
  for (var p = 0; p < plan.length; p++) {
    var P = plan[p];
    CESTISCore.setActiveQuarter(P.fy, P.q);
    await new Promise(function (r) { setTimeout(r, 80); });
    attendanceRecords.forEach(function (r, k) {
      var s = students.find(function (x) { return x.id === r.studentId; });
      if (!s) return;
      // Rows of a past quarter were made back then; the current quarter's rows
      // keep the date the old build gave them (marking never changes it).
      if (P.q !== cur.q) r.date = P.rowDate;
      if (s.course === 'Cosmetology') return;       // finished intake: rows stay all-absent (never marked)
      if (k % 7 === 6) return;                        // and one more all-absent row per quarter
      var rot = k % 5;
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(function (d, j) { r.days[d] = P.pattern[(j + rot) % 5]; });
    });
    saveState();
    out[P.fy + '_Q' + P.q] = attendanceRecords.length;
  }
  return out;
}

async function oldIndexAppraisalsAndBoard() {
  // Appraisals arrive through the module's own import (what a cloud pull hands it).
  var cyc = '2026-2027';
  var appr = { cycles: {}, assignments: {}, extraStaff: [{ id: 'X-ASSESSOR', name: 'Visiting Assessor', role: 'extra' }], flags: {} };
  appr.cycles[cyc] = {};
  ['Garfield Myers', 'Paulette Hinds'].forEach(function (n, k) {
    var u = userAccounts.find(function (x) { return x.name === n; });
    var sid = 'USR:' + u.id;
    appr.cycles[cyc][sid] = { cycle: cyc, staffId: sid, staffName: n, template: 'instructor', period: 'April 2026 – March 2027', appraiser: 'Administrator',
      skillArea: u.programme, lengthSupervising: '2 years', typeOfAppraisal: 'Annual', s1: { a1: 4 - k, a2: 3 }, s2: { b1: 4 }, s3: {},
      comments: { overall: 'Good year ' + n }, status: k ? 'draft' : 'completed', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z' };
    appr.assignments[sid] = 'instructor';
  });
  sappCloudImport(appr);
  // The Board: a pending virement ruled on by the Chair, awaiting a countersignature.
  var vir = JSON.parse(CESTISStore.getItem('cesti_virements') || '[]');
  var pend = vir.find(function (r) { return r.status === 'Pending'; });
  var out = { virements: vir.length };
  if (pend && window.CESTISCmc && window.CESTISCmc.cmcRuleVirement) {
    var C = window.CESTISCmc;
    var res = C.cmcRuleVirement(pend, null, 'Approved', { name: 'Board Chair', username: 'cmcadmin', isChair: true }, '2026-10-18T10:00:00.000Z', 'Approved at the October meeting');
    out.ruled = res.ok;
    if (res.ok) {
      var book = C.cmcApplyRuling(typeof cmcRulings === 'function' ? cmcRulings() : JSON.parse(CESTISStore.getItem('cestis_cmc_rulings') || '{}'), pend.id, res.ruling);
      // The old offline dashboard's copy predates the minute book's save; it is
      // the same write.
      if (typeof cmcSaveRulings === 'function') { try { cmcSaveRulings(book, false); } catch (e) { out.saveErr = e.message; } }
      else CESTISStore.setItem('cestis_cmc_rulings', JSON.stringify(book));
    }
  }
  return out;
}

/* ============================ old build: the sibling pages ================ */
async function oldTranscripts(a) {
  // Transcript-Grades (role=admin): manual grades and transcript profiles.
  var cosm = db.students.filter(function (s) { return s.course === 'Cosmetology'; });
  var qual = db.catalogs[0];
  var out = { qual: qual && qual.id, grades: 0 };
  cosm.slice(0, 4).forEach(function (s, k) {
    qual.units.slice(0, 3).forEach(function (u, j) {
      db.grades = T.upsertManualGrade(db.grades, { studentId: s.id, qualId: qual.id, unitCode: u.code, grade: 65 + k * 5 + j,
        date: '1' + j + '/07/2026', examResultId: null, updatedBy: 'Admin' });
      out.grades++;
    });
    db.profiles[s.id] = { dob: '199' + k + '-03-0' + (k + 1), address: (20 + k) + ' Hope Road, Kingston', idNo: 'TRN-90000' + k };
  });
  writeJSON(T.KEYS.grades, db.grades);
  writeJSON(T.KEYS.profiles, db.profiles);
  return out;
}
async function oldRequests(a) {
  var cosm = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]').filter(function (s) { return s.course === 'Cosmetology'; });
  [['transcript', 'pending'], ['certificate', 'ready'], ['both', 'collected']].forEach(function (x, k) {
    var r = T.newRequest({ studentId: cosm[k].id, studentName: cosm[k].name, course: cosm[k].course, type: x[0], note: 'For a job application',
      requestedAt: '2026-09-1' + k + 'T09:00:00.000Z' });
    r.status = x[1];
    if (x[1] !== 'pending') { r.handledBy = 'Admin'; r.handledAt = '2026-09-2' + k + 'T09:00:00.000Z'; }
    requests.push(r);
  });
  save();
  return requests.length;
}

async function oldSchoolFee(a) {
  var out = {};
  // The Centre's own prices.
  feeStructure['WELDING L2'] = { total: 30000, terms: [6000, 6000, 6000, 6000, 6000, 0, 0, 0, 0] };
  feeStructure['ELECTRICAL L2'] = { total: 31000, terms: [7000, 6000, 6000, 6000, 6000, 0, 0, 0, 0] };
  saveFeeStructure();
  var lms = JSON.parse(CESTISStore.getItem('voctrain_students') || '[]');
  var mk = function (name, skill, fee, k) {
    return { id: 'STU' + (1760000000000 + k), name: name, skillArea: skill, tuitionFee: fee, contact: '876-555-1' + (100 + k), email: '',
      enrollmentDate: '2026-04-06', dateOfBirth: '2002-01-1' + (k % 9), gender: k % 2 ? 'Female' : 'Male', nationalId: 'NID' + (5000 + k),
      address: (k + 1) + ' Fee Lane', city: 'May Pen', parentName: 'Guardian ' + k, parentContact: '876-555-2' + (100 + k), emergencyContact: '876-555-3' + (100 + k),
      totalPaid: 0, balance: fee, status: 'Outstanding', createdAt: '2026-04-06T12:00:00.000Z', fiscalYear: '2026/2027' };
  };
  var k = 0;
  lms.filter(function (s) { return s.course === 'Welding & Fabrication'; }).slice(0, 10).forEach(function (s) { students.push(mk(s.name, 'WELDING L2', 30000, k++)); });
  lms.filter(function (s) { return s.course === 'Electrical Installation'; }).slice(0, 5).forEach(function (s) { students.push(mk(s.name, 'ELECTRICAL L2', 31000, k++)); });
  ['Fee Only One', 'Fee Only Two', 'Fee Only Three'].forEach(function (n) { students.push(mk(n, 'BUSINESS ADMIN L2', 28000, k++)); });
  // Payments: 2 each for the first 12, 1 for the rest.
  var pn = 0;
  students.forEach(function (s, i) {
    var times = i < 12 ? 2 : 1;
    for (var t = 0; t < times; t++) {
      var amt = 5000 + (i % 4) * 1250 + t * 500;
      payments.push({ id: 'PAY' + (1760000100000 + pn), studentId: s.id, studentName: s.name, skillArea: s.skillArea, amount: amt,
        date: '2026-0' + (5 + t) + '-1' + (i % 9), method: t ? 'Bank Transfer' : 'Cash', term: 'Term ' + (t + 1),
        receiptNumber: 'RCPT-' + (7000 + pn), notes: '', createdAt: '2026-0' + (5 + t) + '-1' + (i % 9) + 'T12:00:00.000Z' });
      pn++;
    }
  });
  documents.push({ id: 'DOC1760000200000', studentId: students[0].id, studentName: students[0].name, type: 'ID', fileName: 'national-id.pdf', size: 2048,
    uploadDate: '2026-04-07', googleDriveFileId: 'drv-doc-1', googleDriveFileName: 'national-id.pdf', googleDriveWebViewLink: 'https://drive.example/1', googleDriveWebContentLink: null });
  documents.push({ id: 'DOC1760000200001', studentId: students[1].id, studentName: students[1].name, type: 'Birth Certificate', fileName: 'birth.pdf', size: 4096,
    uploadDate: '2026-04-08', googleDriveFileId: 'drv-doc-2', googleDriveFileName: 'birth.pdf', googleDriveWebViewLink: 'https://drive.example/2', googleDriveWebContentLink: null });
  recalculateStudentTotals();
  saveData();
  // A payment entered in error is deleted (tombstoned) through the page's own delete.
  out.deletedPayment = payments.find(function (p) { return p.studentId === students[2].id && p.term === 'Term 2'; }).id;
  try { deletePayment(out.deletedPayment); } catch (e) { out.deletePaymentError = String(e); }
  // A fee-only trainee who left is deleted through the page's own delete.
  var goneIdx = students.findIndex(function (s) { return s.name === 'Fee Only Three'; });
  out.deletedFeeStudent = students[goneIdx].id;
  try { deleteStudent(goneIdx); } catch (e) { out.deleteStudentError = String(e); }
  saveData();
  out.students = students.length; out.payments = payments.length; out.documents = documents.length;
  return out;
}

async function oldCashbook() {
  var out = {};
  var curFY = '2026/2027';
  function txn(date, details, dep, pay, cat, cheque) {
    while (deletedTxnIds.indexOf(nextId) !== -1) nextId++;
    return { id: nextId++, uid: cbNewUid(), date: date, cheque: cheque || '', details: details, deposit: dep, payment: pay, category: cat };
  }
  // Q1
  saveQuarterAndSwitch(curFY, 1);
  OPENING_BALANCE = 512345.67;
  transactions.push(txn('2026-04-08', 'HEART/NSTA subvention', 850000, 0, 'Subvention'));
  transactions.push(txn('2026-04-25', 'Garfield Myers (salary)', 0, 287829.27, 'Welding Instructor', '9101'));
  transactions.push(txn('2026-05-02', 'Welding rods', 0, 45210.5, 'Training Material', '9102'));
  transactions.push(txn('2026-05-25', 'Paulette Hinds (salary)', 0, 287829.27, 'Electrical Instructor', '9103'));
  transactions.push(txn('2026-06-10', 'Fee deposits', 120500, 0, 'Fees'));
  transactions.push(txn('2026-06-20', 'JPS electricity', 0, 38990.12, 'Utilities', '9104'));
  BUDGET['Training Material'] = 175000; BUDGET['Utilities'] = 160000;
  saveToStorage(); saveQuarterBudget();
  out.q1 = transactions.length;
  // Q2 — with a deleted entry
  saveQuarterAndSwitch(curFY, 2);
  OPENING_BALANCE = 821987.15;
  transactions.push(txn('2026-07-07', 'Cheque from C. Palmer', 88800, 0, 'Training Material'));
  var del = txn('2026-07-15', 'Duplicate entry', 0, 1000, 'Admin Expenses', '9201');
  transactions.push(del);
  transactions.push(txn('2026-07-23', 'Crystal-Lee Gordon', 0, 83535.75, 'Administrative Assistant', '9202'));
  transactions.push(txn('2026-08-14', 'Cancelled Cheque', 0, 0, 'Cancelled', '9203'));
  transactions.push(txn('2026-09-02', 'Fee deposits', 66250, 0, 'Fees'));
  saveToStorage();
  deletedTxnIds.push(del.id);
  transactions = transactions.filter(function (t) { return t.id !== del.id; });
  saveToStorage(); saveQuarterBudget();
  out.q2 = transactions.length; out.deletedTxn = del.uid;
  // Q3 (now)
  saveQuarterAndSwitch(curFY, 3);
  OPENING_BALANCE = 793501.4;
  transactions.push(txn('2026-10-03', 'HEART/NSTA subvention', 425000, 0, 'Subvention'));
  transactions.push(txn('2026-10-09', 'Assessor fees', 0, 62000, 'Assessor Fees', '9301'));
  saveToStorage(); saveQuarterBudget();
  out.q3 = transactions.length;
  return out;
}

async function oldPayslip() {
  var emps = [
    { name: 'Garfield Myers', designation: 'Welding Instructor', type: 'Instructor', mobile: '876-555-4001', dob: '1980-02-02', trn: '101-202-303', nis: 'A123456', startDate: '2020-09-01', salary: 287829.27 },
    { name: 'Paulette Hinds', designation: 'Electrical Instructor', type: 'Instructor', mobile: '876-555-4002', dob: '1983-05-05', trn: '101-202-304', nis: 'A123457', startDate: '2021-09-01', salary: 287829.27 },
    { name: 'Crystal-Lee Gordon', designation: 'Administrative Assistant', type: 'Staff', mobile: '876-555-4003', dob: '1990-07-07', trn: '101-202-305', nis: 'A123458', startDate: '2022-01-10', salary: 90000 },
    { name: 'Jodene Williams-Barrett', designation: 'Coordinator', type: 'Staff', mobile: '876-555-4004', dob: '1978-11-11', trn: '101-202-306', nis: 'A123459', startDate: '2019-04-01', salary: 345394.95 }
  ];
  emps.forEach(function (e) { DATA.employees.push(e); });
  ['2026-07-25', '2026-08-25', '2026-09-25'].forEach(function (date, m) {
    var results = emps.map(function (e, k) {
      var gross = e.salary, nis = Math.round(gross * 0.03 * 100) / 100, ed = Math.round(gross * 0.0225 * 100) / 100, nht = Math.round(gross * 0.02 * 100) / 100;
      var it = Math.round((gross - nis - 149948) * 0.25 * 100) / 100; if (it < 0) it = 0;
      var ded = Math.round((nis + ed + nht + it) * 100) / 100;
      return { empName: e.name, empType: e.type, designation: e.designation, trn: e.trn, nis: e.nis, gross: gross, nisEmp: nis, nisEr: nis, edTaxEmp: ed,
        edTaxEr: Math.round(gross * 0.035 * 100) / 100, nhtEmp: nht, nhtEr: Math.round(gross * 0.03 * 100) / 100, heartEr: Math.round(gross * 0.03 * 100) / 100,
        incomeTax: it, totalEmpDeductions: ded, totalErContributions: 0, netPay: Math.round((gross - ded) * 100) / 100 };
    });
    DATA.payrollRuns.push({ date: date, results: results });
  });
  markDataDirty(); saveStore();
  return { employees: DATA.employees.length, runs: DATA.payrollRuns.length };
}

async function oldClockIn() {
  var people = [['jwb', 'Jodene Williams-Barrett', 'Full-Time', 'Admin'], ['clg', 'Crystal-Lee Gordon', 'Full-Time', 'Staff'], ['gm', 'Garfield Myers', 'Part-Time', 'Staff']];
  for (var i = 0; i < people.length; i++) {
    var p = people[i];
    staffMembers.push({ id: 'STAFF17600000' + i, username: p[0], password: await hashPassword('Clock-' + p[0] + '-2026'), fullName: p[1], workType: p[2], role: p[3],
      status: 'Active', createdDate: '2026-04-01T08:00:00.000Z', email: p[0] + '@centre.example', phone: '876-555-500' + i, dateOfBirth: '1985-01-0' + (i + 1),
      gender: i % 2 ? 'Female' : 'Male', address: 'May Pen', emergencyContact: { name: 'EC ' + i, phone: '876-555-600' + i }, department: 'Operations',
      jobTitle: p[3], education: '', startDate: '2026-04-01', qualifications: '', skills: '', documents: [] });
  }
  saveStaffMembers();
  var days = ['2026-10-12', '2026-10-13', '2026-10-14'];
  staffMembers.slice(-3).forEach(function (s, i) {
    days.forEach(function (d, j) {
      timeRecords.push({ id: 'SESSION_UPG_' + i + '_' + j, staffId: s.id, staffName: s.fullName, workType: s.workType, date: d,
        clockIn: d + 'T08:0' + j + ':00.000Z', clockOut: d + 'T16:3' + j + ':00.000Z', status: 'completed', breaks: [{ start: d + 'T12:00:00.000Z', end: d + 'T12:30:00.000Z' }],
        currentBreakStart: null, lastModified: d + 'T16:3' + j + ':00.000Z' });
    });
  });
  saveTimeRecords();
  return { staff: staffMembers.length, records: timeRecords.length };
}

async function oldVirements() {
  var lines = function (amt) { return [{ fromId: 'b1', fromName: 'Remedial English', toId: 'b2', toName: 'Lunch', amount: amt }]; };
  virementRequests.push({ id: 1760000300001, date: '2026-09-10', fy: '2026/2027', quarter: 2, project: 'Lunch top-up', period: 'Q2', requestedBy: 'S. Barrett',
    position: 'Coordinator', total: 100000, totalWords: 'One Hundred Thousand Dollars', lines: lines(100000), deficitComment: '', anyLineComment: '', status: 'Pending' });
  virementRequests.push({ id: 1760000300002, date: '2026-08-05', fy: '2026/2027', quarter: 2, project: 'Materials', period: 'Q2', requestedBy: 'S. Barrett',
    position: 'Coordinator', total: 44288.25, totalWords: 'Forty-Four Thousand Two Hundred Eighty-Eight Dollars and Twenty-Five Cents', lines: lines(44288.25),
    deficitComment: '', anyLineComment: '', status: 'Approved',
    signatures: [{ id: 'USR-001', name: 'Administrator', role: 'admin', at: '2026-08-06T10:00:00.000Z', comment: 'ok' },
                 { id: 'USR-021', name: 'Board Chair', role: 'cmc', at: '2026-08-07T10:00:00.000Z', comment: 'agreed' }],
    approvedBy: 'Administrator and Board Chair', approvalDate: '2026-08-07', approvalAt: '2026-08-07T10:00:00.000Z', approvalComment: 'agreed' });
  virementRequests.push({ id: 1760000300003, date: '2026-08-01', fy: '2026/2027', quarter: 2, project: 'Withdrawn request', period: 'Q2', requestedBy: 'S. Barrett',
    position: 'Coordinator', total: 500, totalWords: 'Five Hundred Dollars', lines: lines(500), deficitComment: '', anyLineComment: '', status: 'Pending' });
  saveAllData();
  deletedRequestIds.add(1760000300003);
  virementRequests = virementRequests.filter(function (r) { return r.id !== 1760000300003; });
  saveAllData();
  return { virements: virementRequests.length, deleted: Array.from(deletedRequestIds) };
}

async function oldFinanceDoc(a) {
  var made = [];
  for (var i = 0; i < a.docs.length; i++) {
    var d = a.docs[i];
    FinanceDoc.newDoc();
    var set = function (id, v) { var el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('input')); } };
    if (d.billedTo) set('fBilledTo', d.billedTo);
    if (d.supplier) set('fSupplier', d.supplier);
    set('fDate', d.date);
    if (d.status) set('fStatus', d.status);
    FinanceDoc.setItem(0, 'itemNo', '1');
    FinanceDoc.setItem(0, 'description', d.desc);
    FinanceDoc.setItem(0, 'qty', d.qty);
    FinanceDoc.setItem(0, 'unitPrice', d.price);
    FinanceDoc.saveDoc();
    made.push(d.desc);
  }
  return JSON.parse(CESTISStore.getItem(a.key) || '[]').length;
}

async function oldVoucher() {
  // Edit the payee on the first generated voucher through the page's own editor.
  var inputs = document.querySelectorAll('input[data-txn][data-field]');
  var target = Array.prototype.find.call(inputs, function (el) { return el.getAttribute('data-field') === 'payee'; }) || inputs[0];
  if (!target) return { edited: 0, inputs: inputs.length };
  target.value = 'Garfield Myers (edited payee)';
  PV.edit(target);
  return { edited: 1, key: Object.keys(JSON.parse(CESTISStore.getItem('cestis_finance_voucher_overrides') || '{}')) };
}

/* ================================================================ compare */
// Per-device housekeeping, sessions and tokens: not Centre records.
const IGNORE_KEY = /^(voctrain_session|voctrain_loginAttempts|voctrain_examInProgress|voctrain_lastActivity|cestisGoogle|schoolDashboardGoogle|cestisLastSyncTime|schoolDashboardLastSyncTime|cestisCloud|schoolDashboardCloudFileId|schoolFeeCloudFileId|cestisUserFilesFolderId|cestisCurrentUser|cestisDataHighWater|cestis_page_cloud|cestisPageCloud|cestis_pagecloud_stamps__|cestis_auth_session|__)/;
function recordMap(dump) {
  const out = {};
  Object.keys(dump).forEach(k => {
    if (IGNORE_KEY.test(k)) return;
    const v = parse(dump[k]);
    const recs = recordsOf(k, v);
    if (recs && Object.keys(recs).length) out[k] = recs;
  });
  return out;
}
function fieldDiffs(a, b) {
  const out = [];
  Object.keys(a || {}).forEach(f => {
    if (a[f] === undefined) return;
    if (stable(a[f]) === stable(b ? b[f] : undefined)) return;
    out.push({ field: f, from: a[f], to: b ? b[f] : undefined });
  });
  return out;
}
const short = v => { const s = JSON.stringify(v); return s && s.length > 140 ? s.slice(0, 140) + '…' : s; };
/* What happened to every record in `before` once it got to `after`. */
/* Why a record of `before` may legitimately be absent from `after`, or null.
   Only two reasons are accepted, and both are reported: the trainee it
   belongs to was deleted (tombstoned) — an old copy that still carried them
   is not a loss — or the trainee was re-identified (the same person on the
   same programme now under another id, as the old build's own id
   stabilisation does). */
function deadIdsOf(maps) {
  const dead = {};
  const t = maps.voctrain_deletedStudentIds || {};
  Object.keys(t).forEach(rid => { const v = t[rid] && t[rid].value; if (v) dead[v] = 1; });
  return dead;
}
function explainAbsence(key, rec, afterMaps, dead) {
  if (!rec || typeof rec !== 'object') return null;
  const who = rec.studentId || rec.studentDataId || (key === 'voctrain_students' ? rec.id : null);
  if (who && dead[who]) return 'belongs to a deleted trainee';
  if (rec.name === DELETED_TRAINEE || rec.studentName === DELETED_TRAINEE) return 'belongs to a deleted trainee';
  if (key === 'voctrain_students' && afterMaps[key]) {
    const same = Object.keys(afterMaps[key]).map(r => afterMaps[key][r]).find(x => x && x.name === rec.name && x.course === rec.course);
    if (same) return 're-identified as ' + same.id + ' (same name and programme)';
  }
  return null;
}
// A per-user copy of the chat or the bell (voctrain_user_<id>_<x>) is a cache
// of the shared collection: a record it lost is still a record if the shared
// key holds it.
function keptInShared(key, rid, afterMaps) {
  const m = /^voctrain_user_.+_(chatFollows|chatProfiles|chatMessages|chatRooms|notifications)$/.exec(key);
  if (!m) return false;
  const shared = afterMaps['voctrain_' + m[1]];
  return !!(shared && shared[rid] !== undefined);
}
// The old build's plain weekly sheet (voctrain_attendance) is a mirror of the
// active quarter's bucket (voctrain_attendance::<FY>_Q<n>): it wrote the bucket
// after every write to the sheet (mirrorActiveAttendance). A sheet row the new
// device lacks is still the Centre's record when the identical row — same
// trainee, same week, same marks — is in a bucket there (attendanceCarriedOver
// then checks every bucket mark reached the dated register).
function keptInBucket(key, rec, afterMaps) {
  if (key !== 'voctrain_attendance' || !rec || !rec.days) return false;
  return Object.keys(afterMaps).some(k => /^voctrain_attendance::/.test(k) &&
    Object.keys(afterMaps[k]).some(rid => {
      const r = afterMaps[k][rid];
      return r && r.studentId === rec.studentId && r.date === rec.date && stable(r.days) === stable(rec.days);
    }));
}
function compare(before, after, label) { return compareMaps(recordMap(before), recordMap(after), label); }
function compareMaps(B, A, label, opts) {
  opts = opts || {};
  const dead = deadIdsOf(A);
  const rep = { label, keysChecked: 0, records: 0, missingKeys: [], missing: [], changed: [], recomputed: [], explained: [], newKeys: [] };
  Object.keys(B).forEach(k => {
    rep.keysChecked++;
    const recs = B[k];
    let unexplained = 0;
    Object.keys(recs).forEach(rid => {
      rep.records++;
      const o = recs[rid], n = A[k] ? A[k][rid] : undefined;
      if (n === undefined) {
        const why = explainAbsence(k, o, A, dead) || (keptInShared(k, rid, A) ? 'kept in the shared collection' : null) ||
          (keptInBucket(k, o, A) ? 'kept, identical, in its quarter\'s bucket' : null);
        if (why) rep.explained.push({ key: k, rid, why });
        else { unexplained++; if (A[k]) rep.missing.push({ key: k, rid, rec: o }); }
        return;
      }
      fieldDiffs(o, n).forEach(d => {
        const entry = { key: k, rid, field: d.field, from: d.from, to: d.to };
        // A list that only GAINED entries (room members, read-by) lost nothing.
        const grew = Array.isArray(d.from) && Array.isArray(d.to) && d.from.every(x => typeof x !== 'object' && d.to.indexOf(x) !== -1);
        // A stale copy brought up to the newest copy the Centre had.
        const newest = opts.newest && opts.newest[k] && opts.newest[k][rid] && stable(opts.newest[k][rid][d.field]) === stable(d.to);
        // A class chat room's members are DERIVED — every dashboard rebuilds
        // them from the accounts and their programmes
        // (CESTISCore.chat.classRoomMembers) — so a device that has not yet
        // run that pass with the Centre's accounts, or a disabled login that
        // left, is a recomputation, not a lost record. (Checked: the new
        // device's rooms read 25/27/24 members again at its next sign-in.)
        const derived = d.field === 'members' && /chatRooms$/.test(k) && ((o && o.type === 'class') || (n && n.type === 'class'));
        if (PROTECTED.indexOf(d.field) !== -1 && !grew && !newest && !derived) rep.changed.push(entry);
        else rep.recomputed.push(entry);
      });
    });
    if (!A[k] && unexplained) rep.missingKeys.push({ key: k, records: unexplained });
  });
  Object.keys(A).forEach(k => { if (!B[k]) rep.newKeys.push(k); });
  return rep;
}

/* Every mark of every old weekly row, in every quarter bucket, must be in the
   new dated register (carried over, or filed in a record's history beside a
   mark already on that date) — or be one of the creation-default all-absent
   rows the carry-over skips BY DESIGN (made on or after the upgrade day). */
function attendanceCarriedOver(before, after) {
  const reg = parse(after.voctrain_attendanceRegister) || [];
  const refs = {};
  let firstAt = '';
  reg.forEach(r => [r].concat(r.history || []).forEach((h, i) => {
    const m = h && h.migratedFrom;
    if (!m) return;
    // Where the old value ended up: AS the record (it is what the register
    // shows), or filed in the history beside a mark already on that date.
    refs[m.ref] = { status: h.status || r.status, live: i === 0, rec: r };
    if (!firstAt || m.at < firstAt) firstAt = m.at;
  }));
  const since = firstAt ? new Date(firstAt) : null;
  const sinceDay = since ? since.getFullYear() + '-' + String(since.getMonth() + 1).padStart(2, '0') + '-' + String(since.getDate()).padStart(2, '0') : '';
  const out = { slots: 0, carried: 0, wrongStatus: [], missing: [], shadowed: [], skippedByDesign: 0, rows: 0 };
  Object.keys(before).filter(k => /^voctrain_attendance::/.test(k)).forEach(k => {
    (parse(before[k]) || []).forEach(row => {
      if (!row || !row.days) return;
      out.rows++;
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      const allAbsent = days.every(d => row.days[d] === 'absent');
      days.forEach(d => {
        const v = row.days[d];
        if (!v) return;
        out.slots++;
        const ref = k + '|' + row.studentId + '|' + d + '|' + v;
        const hit = refs[ref];
        if (hit) {
          out.carried++;
          if (hit.status !== v) out.wrongStatus.push({ ref, got: hit.status });
          // Filed beside another mark: fine when that mark is a real one taken
          // since; NOT when it is just another copy's estimate (an unconfirmed
          // carry-over) standing in front of a real old mark.
          else if (!hit.live && !allAbsent && hit.rec.source === 'migration' && hit.rec.status !== v) {
            out.shadowed.push({ ref, shows: hit.rec.status + (hit.rec.unconfirmed ? ' (unconfirmed)' : ''), from: hit.rec.migratedFrom && hit.rec.migratedFrom.ref });
          }
          return;
        }
        if (allAbsent && sinceDay && String(row.date || '').slice(0, 10) >= sinceDay) { out.skippedByDesign++; return; }
        out.missing.push(ref);
      });
    });
  });
  return out;
}

/* Money: the totals the old pages showed must come out the same. */
function moneyFacts(dump) {
  const f = { quarters: {}, fee: {} };
  Object.keys(dump).filter(k => /^cestis_quarter_/.test(k)).forEach(k => {
    const q = parse(dump[k]) || {};
    const t = (q.transactions || []).reduce((a, x) => ({ dep: a.dep + (+x.deposit || 0), pay: a.pay + (+x.payment || 0) }), { dep: 0, pay: 0 });
    f.quarters[k] = Math.round(((+q.openingBalance || 0) + t.dep - t.pay) * 100) / 100;
  });
  const pays = parse(dump.cestiSchoolFeePayments) || [];
  const dead = {}; (parse(dump.cestiSchoolFeeDeletedPaymentIds) || []).forEach(id => { dead[id] = 1; });
  pays.forEach(p => { if (!dead[p.id]) f.fee[p.studentId] = Math.round(((f.fee[p.studentId] || 0) + (+p.amount || 0)) * 100) / 100; });
  return f;
}

function reportCompare(rep, opts) {
  opts = opts || {};
  console.log('  ' + rep.label + ': ' + rep.keysChecked + ' keys, ' + rep.records + ' records checked');
  rep.missingKeys.forEach(m => console.log('    MISSING KEY ' + m.key + ' (' + m.records + ' records)'));
  const byKey = {};
  rep.missing.forEach(m => { (byKey[m.key] = byKey[m.key] || []).push(m.rid); });
  Object.keys(byKey).forEach(k => console.log('    MISSING in ' + k + ': ' + byKey[k].length + ' — ' + byKey[k].slice(0, 8).join(', ')));
  rep.changed.forEach(c => console.log('    CHANGED ' + c.key + ' ' + c.rid + ' .' + c.field + ': ' + short(c.from) + ' → ' + short(c.to)));
  const ex = {};
  rep.explained.forEach(e => { const kk = e.key + ': ' + e.why.replace(/ as \S+/, ''); ex[kk] = (ex[kk] || 0) + 1; });
  Object.keys(ex).forEach(kk => console.log('    (accounted for) ' + kk + ' ×' + ex[kk]));
  if (opts.showRecomputed) {
    const g = {};
    rep.recomputed.forEach(c => { const kk = c.key + '.' + c.field; g[kk] = (g[kk] || 0) + 1; });
    Object.keys(g).forEach(kk => console.log('    (recomputed) ' + kk + ' ×' + g[kk]));
  }
}

/* The sibling pages as the Centre opens them, with the save each one makes
   when somebody works in it (run once on the upgraded data, so whatever the
   page does with the old shapes is written back and checked). */
const SIBLINGS = [
  { rel: 'School.Fee.html', ready: 'students.length > 0 && payments.length > 0', save: 'saveData()' },
  { rel: 'CESTIS.Cashbook.html', login: 'cashbook', ready: 'transactions.length > 0', save: 'saveToStorage(); saveQuarterBudget()' },
  { rel: 'Staff.Payslip.html', ready: 'DATA.employees.length > 0', save: 'markDataDirty(); saveStore()' },
  { rel: 'Staff.Clock.in.html', ready: 'staffMembers.length > 0 && timeRecords.length > 0', save: 'saveStaffMembers(); saveTimeRecords()' },
  { rel: 'Virement.Request.html', ready: 'virementRequests.length > 0', save: 'saveAllData()' },
  { rel: 'Finance.Invoice.html' },
  { rel: 'Finance.Quote.html' },
  { rel: 'Finance.Purchase.Order.html' },
  { rel: 'Finance.Payment.Voucher.html' },
  { rel: 'Transcript-Grades.html?role=admin' },
  { rel: 'Student-Progress.html', ready: 'students.length > 0', save: 'saveData()' },
  { rel: 'Cert-Transcript-Requests.html', ready: 'requests.length > 0', save: 'save()' },
  { rel: 'Income.Expenditure.html' },
  { rel: 'Payments.Invoices.html' }
];

/* Every sibling page on its own, signed in to it the way its user is, then
   its own save — run only once the page has its records in memory (a save
   from a page still at its login screen is not something a person can do). */
async function exerciseSiblings(env, ctx, origin, label, noSave) {
  for (const sib of SIBLINGS) {
    const o = await env.open(ctx, sib.rel, { origin, settle: 2500 });
    if (sib.login === 'cashbook') {
      await o.page.fill('#loginUser', 'cestisadmin'); await o.page.fill('#loginPass', PW.admin);
      await o.page.evaluate(() => handleLogin({ preventDefault() {} }));
      await o.page.waitForTimeout(2500);
      if (await o.page.evaluate(() => !document.getElementById('loginOverlay').classList.contains('hidden'))) {
        await o.page.fill('#loginUser', 'deputyadmin'); await o.page.fill('#loginPass', PW.admin + '-2');
        await o.page.evaluate(() => handleLogin({ preventDefault() {} }));
        await o.page.waitForTimeout(2500);
      }
    }
    let saveErr2 = '', ran = false;
    if (sib.save && !noSave) {
      const r = await o.page.evaluate(a => { try { if (!(0, eval)(a.ready)) return { ran: false }; (0, eval)(a.save); return { ran: true }; } catch (e) { return { ran: false, err: e.message }; } }, sib);
      ran = r.ran; saveErr2 = r.err || '';
      if (!ran && !saveErr2) note(label + ': ' + sib.rel + ': its records were not in memory when opened on its own, so its save was not exercised');
    }
    await o.page.waitForTimeout(2600);   // the page's debounced push, before the tab closes
    ok(o.errors.length === 0 && !saveErr2, label + ': ' + sib.rel + ' loads' + (ran ? ' and saves' : '') + ' without errors — got: ' + o.errors.concat(saveErr2 ? [saveErr2] : []).join(' | ').slice(0, 400));
    await o.page.close();
  }
}

/* The pages the security work locked (and the ones with a sign-in of their
   own), visited with NO live dashboard session — a trainee typing the address
   at a lab PC, or a session that has ended — then hidden and closed. A locked
   page holds nothing of the Centre's in memory, so nothing it does on the way
   out may reach the store. Every stored value must read exactly as before. */
const LOCKED_VISITS = ['School.Fee.html', 'Virement.Request.html', 'Income.Expenditure.html', 'Payments.Invoices.html',
  'Finance.Invoice.html', 'Finance.Quote.html', 'Finance.Purchase.Order.html', 'Finance.Payment.Voucher.html',
  'Student-Progress.html', 'Transcript-Grades.html', 'Cert-Transcript-Requests.html', 'MegaData-Admin.html',
  'MegaData-Adjudication.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html'];
async function rawRemove(ctx, base, keys) {
  const page = await ctx.newPage();
  await page.goto(base + '/__blank.html');
  await page.evaluate(async (keys) => {
    keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    await new Promise(resolve => {
      const req = indexedDB.open('CESTIS_KV');
      req.onerror = () => resolve();
      req.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); return resolve(); }
        const tx = db.transaction('kv', 'readwrite');
        keys.forEach(k => tx.objectStore('kv').delete(k));
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
    });
  }, keys);
  await page.close();
}
async function refusedVisits(env, ctx) {
  section('A visit with no live session (a locked page) changes nothing');
  SERVE_ROOT = ROOT;
  // What the dashboard's sign-out does first: the record pages stop accepting its session.
  await rawRemove(ctx, env.base, ['voctrain_sessionSeenAt', 'voctrain_sessionStudentId']);
  const before = (await rawDump(ctx, env.base)).eff;
  const locked = [];
  for (const rel of LOCKED_VISITS) {
    const o = await env.open(ctx, rel, { settle: 2500 });
    if (await o.page.evaluate(() => !!document.getElementById('cestisSessionLock'))) locked.push(rel);
    await o.page.evaluate(() => {
      try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); } catch (e) {}
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await o.page.waitForTimeout(400);
    await o.page.close({ runBeforeUnload: true });
    await wait(400);
    ok(o.errors.length === 0, 'locked visit: ' + rel + ' opens and closes without errors — got: ' + o.errors.join(' | ').slice(0, 300));
  }
  await wait(800);
  const after = (await rawDump(ctx, env.base)).eff;
  const changed = Object.keys(Object.assign({}, before, after))
    .filter(k => !IGNORE_KEY.test(k) && before[k] !== after[k]);
  console.log('  ' + locked.length + ' of ' + LOCKED_VISITS.length + ' pages showed "sign in first": ' + locked.join(', '));
  changed.forEach(k => console.log('    CHANGED ' + k + ': ' + short(before[k]) + ' → ' + short(after[k])));
  const mustLock = ['School.Fee.html', 'Virement.Request.html', 'Income.Expenditure.html', 'Payments.Invoices.html', 'Finance.Invoice.html'];
  ok(mustLock.every(p => locked.indexOf(p) !== -1), 'the fee and finance pages are locked without a live session (missing: ' +
    mustLock.filter(p => locked.indexOf(p) === -1).join(', ') + ')');
  ok(changed.length === 0, 'no stored value changed after the locked visits (' + changed.join(', ') + ')');
}

async function upgradePhase(env) {
  const { S0, base, open, signIn, newCtx, frameOf, pageErrors, dialogs } = env;
  let ctx = env.ctx;
  if (!ctx) { ctx = await newCtx(); await rawRestore(ctx, base, S0); }
  /* ------------------------------------------------------------------ NEW */
  section('NEW build: the site is updated under the same storage');
  SERVE_ROOT = ROOT;
  let { page: I, errors } = await open(ctx, 'index.html', { settle: 3000 });
  ok(errors.length === 0, 'new build: the dashboard\'s first load raises no errors — got: ' + errors.join(' | ').slice(0, 400));
  let who = await signIn(I, 'cestisadmin', 'cestisadmin123$');
  ok(!who.shell, 'the published default password opens nothing on a Centre with real passwords');
  who = await signIn(I, 'cestisadmin', PW.admin);
  ok(who.role === 'admin' && who.shell && !who.forced, 'the administrator signs in with the Centre\'s own password (got ' + JSON.stringify(who) + ')');
  await I.waitForTimeout(3000);
  // A save cycle: the whole-state save, and the page-cloud push path.
  const saveErr = await I.evaluate(() => {
    const errs = [];
    try { saveState(); } catch (e) { errs.push('saveState: ' + e.message); }
    try { if (typeof flushAttendanceRegister === 'function') flushAttendanceRegister(); } catch (e) { errs.push('flushAttendanceRegister: ' + e.message); }
    try { if (typeof scheduleDebouncedCloudSave === 'function') scheduleDebouncedCloudSave(); } catch (e) { errs.push('cloud save: ' + e.message); }
    try { if (window.CESTISPageCloud && CESTISPageCloud.flushNow) CESTISPageCloud.flushNow(); } catch (e) { errs.push('page cloud: ' + e.message); }
    return errs;
  });
  ok(saveErr.length === 0, 'the save cycle runs without throwing — got: ' + saveErr.join(' | '));
  await I.waitForTimeout(1500);
  // The embedded pages, as the administrator reaches them from the sidebar.
  for (const pid of ['students', 'fee-management', 'cashbook', 'income-expenditure', 'transcript-grades', 'cert-transcript-requests', 'timetracking', 'attendance', 'certificates', 'exams']) {
    const err = await I.evaluate(p => { try { showPage(p); return ''; } catch (e) { return e.message; } }, pid);
    ok(!err, 'showPage(' + pid + ') does not throw — got: ' + err);
    await I.waitForTimeout(pid === 'fee-management' || pid === 'cashbook' ? 3500 : 1800);
  }
  await I.evaluate(() => { try { showPage('dashboard'); saveState(); } catch (e) {} });
  await I.waitForTimeout(1500);
  ok(errors.length === 0, 'new build: no errors on the dashboard or its embedded pages — got: ' + errors.join(' | ').slice(0, 400));
  await I.close();

  await exerciseSiblings(env, ctx, base, 'new build');
  ({ page: I, errors } = await open(ctx, 'index.html', { settle: 3000 }));
  who = await signIn(I, 'cestisadmin', PW.admin);
  ok(who.role === 'admin', 'after every page ran, the administrator signs in again');
  await I.waitForTimeout(2500);
  ok(errors.length === 0, 'new build: the reload raises no errors — got: ' + errors.join(' | ').slice(0, 400));

  // Export Backup from the new build, with every record in it.
  let backup = null;
  const dl = I.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await I.evaluate(() => exportDataBackup());
  const d = await dl;
  if (d) { const fp = path.join(TMP, 'backup.json'); await d.saveAs(fp); backup = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  ok(!!backup, 'Export Backup produces a file for the signed-in administrator');
  await I.close();
  await wait(800);
  const S1 = (await rawDump(ctx, base)).eff;
  fs.writeFileSync(path.join(TMP, 'S1-new.json'), JSON.stringify(S1, null, 1));
  await refusedVisits(env, ctx);
  await checkUpgrade(S0, S1, backup);
  if (backup) await importOnFreshDevice(env, S1, path.join(TMP, 'backup.json'));
  await checkPeopleSignIn(env, S0, S1);
}

/* ---------------------------------------------- the old → new comparison */
async function checkUpgrade(S0, S1, backup) {
  section('Every record the old build held is still there');
  const rep = compare(S0, S1, 'old → new (same device, after the upgrade)');
  reportCompare(rep, { showRecomputed: true });
  ok(rep.missingKeys.length === 0, 'no key that held records is gone or empty: ' + rep.missingKeys.map(m => m.key).join(', '));
  ok(rep.missing.length === 0, 'no record is missing (' + rep.missing.length + ' missing: ' + rep.missing.slice(0, 12).map(m => m.key + '/' + m.rid).join(', ') + ')');
  ok(rep.changed.length === 0, 'no protected field changed (' + rep.changed.length + ': ' + rep.changed.slice(0, 8).map(c => c.key + '/' + c.rid + '.' + c.field).join(', ') + ')');
  fs.writeFileSync(path.join(TMP, 'compare-old-new.json'), JSON.stringify(rep, null, 1));

  section('Legacy weekly attendance is carried into the dated register');
  const att = attendanceCarriedOver(S0, S1);
  console.log('  ' + att.rows + ' old rows, ' + att.slots + ' marked slots: ' + att.carried + ' carried over, ' + att.skippedByDesign +
    ' creation-default all-absent slots skipped by design, ' + att.missing.length + ' missing, ' + att.wrongStatus.length + ' with a different status');
  ok(att.slots > 300, 'there were old marks to carry (' + att.slots + ')');
  ok(att.missing.length === 0, 'every old mark is in the dated register — missing: ' + att.missing.slice(0, 6).join(', '));
  ok(att.wrongStatus.length === 0, 'with the same status — differ: ' + JSON.stringify(att.wrongStatus.slice(0, 4)));
  ok(att.shadowed.length === 0, 'and no real old mark is hidden behind another copy\'s estimate — ' + att.shadowed.length + ': ' + JSON.stringify(att.shadowed.slice(0, 3)));
  if (att.skippedByDesign) note(att.skippedByDesign + ' all-absent slots on rows dated on/after the upgrade day were not carried (by design: creation defaults); the rows themselves are kept in their buckets');

  section('Certificates, grades and money read the same');
  const st0 = parse(S0.voctrain_students) || [], st1 = parse(S1.voctrain_students) || [];
  const certs0 = st0.filter(s => s.certNo);
  ok(certs0.length >= 7 && certs0.every(s => (st1.find(x => x.id === s.id) || {}).certNo === s.certNo),
    'every certificate number is unchanged (' + certs0.length + ')');
  const cda0 = parse(S0.voctrain_certDownloadApprovals) || [], cda1 = parse(S1.voctrain_certDownloadApprovals) || [];
  ok(cda0.every(a => { const b = cda1.find(x => x.id === a.id); return b && b.approved === a.approved && b.certNo === a.certNo; }),
    'every certificate download approval (incl. the revoked one) is as it was');
  const tg0 = parse(S0.voctrain_transcriptGrades) || [], tg1 = parse(S1.voctrain_transcriptGrades) || [];
  ok(tg0.length > 0 && tg0.every(g => tg1.some(h => h.studentId === g.studentId && h.qualId === g.qualId && h.unitCode === g.unitCode && String(h.grade) === String(g.grade))),
    'every manual transcript grade is there with its grade (' + tg0.length + ')');
  const m0 = moneyFacts(S0), m1 = moneyFacts(S1);
  ok(stable(m0.quarters) === stable(m1.quarters), 'every cashbook quarter closes on the same balance: ' + JSON.stringify(m0.quarters) + (stable(m0.quarters) === stable(m1.quarters) ? '' : ' vs ' + JSON.stringify(m1.quarters)));
  ok(stable(m0.fee) === stable(m1.fee), 'every trainee\'s fee payments add up to the same amount');
  const r0 = parse(S0.voctrain_examResults) || [], r1 = parse(S1.voctrain_examResults) || [];
  ok(r0.every(r => { const n = r1.find(x => x.id === r.id); return n && n.score === r.score && !!n.needsReview === !!r.needsReview; }),
    'every exam result keeps its score and its needs-review flag (' + r0.length + ')');

  section('Export Backup from the new build carries everything');
  if (backup) {
    const asDump = {};
    Object.keys(backup.data || {}).forEach(k => { asDump[k] = JSON.stringify(backup.data[k]); });
    Object.keys(backup.raw || {}).forEach(k => { asDump[k] = backup.raw[k]; });
    const rb = compare(S1, asDump, 'store after upgrade → Export Backup');
    // Device-only keys the export deliberately leaves out.
    const deviceOnly = /^(cestis_pagecloud_stamps__|voctrain_user_|cesti_virement_cloud_cache$|voctrain_maintenanceMode$|voctrain_adminStaffAccess$)/;
    rb.missingKeys = rb.missingKeys.filter(m => !deviceOnly.test(m.key));
    rb.missing = rb.missing.filter(m => !deviceOnly.test(m.key));
    reportCompare(rb);
    ok(rb.missingKeys.length === 0, 'the backup has every key that holds records: missing ' + rb.missingKeys.map(m => m.key + '(' + m.records + ')').join(', '));
    ok(rb.missing.length === 0 && rb.changed.length === 0, 'and every record in it, unchanged');
    const ro = compare(S0, asDump, 'old build store → Export Backup');
    ro.missingKeys = ro.missingKeys.filter(m => !deviceOnly.test(m.key));
    ro.missing = ro.missing.filter(m => !deviceOnly.test(m.key));
    ok(ro.missing.length === 0, 'every pre-upgrade record is in the new build\'s backup (' + ro.missing.length + ' missing: ' + ro.missing.slice(0, 8).map(m => m.key + '/' + m.rid).join(', ') + ')');
  }
}

/* The Export Backup file from the upgraded device, imported on a brand-new
   device (whose first sign-in has to replace the published password): every
   record must come back, nested ones included (cashbook quarters, payroll). */
async function importOnFreshDevice(env, S1, backupPath) {
  section('Import Backup on a brand-new device brings every record back');
  SERVE_ROOT = ROOT;
  const ctx = await env.newCtx();
  const { page, errors } = await env.open(ctx, 'index.html', { settle: 3000, accept: true });
  let who = await env.signIn(page, 'cestisadmin', 'cestisadmin123$');
  if (who.forced) {
    await page.fill('#forceChangePwNew', 'Fresh-Device-1!'); await page.fill('#forceChangePwConfirm', 'Fresh-Device-1!');
    await page.evaluate(async () => { await forceChangePwSubmit(); });
    await page.waitForTimeout(1200);
    who = await page.evaluate(() => ({ role: currentRole }));
  }
  ok(who.role === 'admin', 'a brand-new device: the administrator gets in (published default → new password)');
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
  await page.evaluate(() => { importDataBackup(); });
  const fc = await chooser;
  ok(!!fc, 'Import Backup asks for the file');
  if (fc) await fc.setFiles(backupPath);
  await page.waitForTimeout(8000);   // read, merge, and the reload that follows
  const R = (await rawDump(ctx, env.base)).eff;
  fs.writeFileSync(path.join(TMP, 'import-fresh.json'), JSON.stringify(R, null, 1));
  const r = compare(S1, R, 'upgraded store → Export Backup → Import on a brand-new device');
  const devOnly = /^(cestis_pagecloud_stamps__|voctrain_user_|cesti_virement_cloud_cache$|voctrain_maintenanceMode$|voctrain_adminStaffAccess$|cestisPendingUpload$)/;
  r.missingKeys = r.missingKeys.filter(m => !devOnly.test(m.key));
  r.missing = r.missing.filter(m => !devOnly.test(m.key));
  // The new device's administrator set a password after the backup was made:
  // a newer local edit stands (the merge rule), so that one field may differ.
  r.changed = r.changed.filter(c => !(c.key === 'voctrain_users' && c.rid === 'USR-001' && c.field === 'password'));
  reportCompare(r);
  ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0,
    'every record of the upgraded Centre is back after the import (' + r.missingKeys.map(m => m.key + '(' + m.records + ')').join(', ') +
    (r.missing.length ? '; missing ' + r.missing.slice(0, 8).map(m => m.key + '/' + m.rid).join(', ') : '') +
    (r.changed.length ? '; changed ' + r.changed.slice(0, 6).map(c => c.key + '/' + c.rid + '.' + c.field).join(', ') : '') + ')');
  ok(errors.length === 0, 'and the import raised no page errors — got: ' + errors.join(' | ').slice(0, 300));
  await ctx.close();
}

/* -------------------------------------- instructors and trainees sign in
   On a fresh copy of a store: sign in through the login card, look around,
   sign out, and read the store after each step. */
async function personRun(env, which, startDump, kind, user, pass) {
  const { base, open, signIn, newCtx } = env;
  SERVE_ROOT = which === 'old' ? OLD : ROOT;
  const ctx = await newCtx();
  await rawRestore(ctx, base, startDump);
  const { page, errors } = await open(ctx, 'index.html', { settle: 3000 });
  const who = await signIn(page, user, pass, kind);
  await page.waitForTimeout(2500);
  const view = await page.evaluate(() => {
    const mine = (typeof currentStudent !== 'undefined' && currentStudent) ? currentStudent : null;
    return {
      student: mine ? { id: mine.id, name: mine.name, course: mine.course } : null,
      instructor: (typeof currentInstructor !== 'undefined' && currentInstructor) ? { name: currentInstructor.name, course: currentInstructor.course } : null,
      results: mine ? examResults.filter(r => r.studentId === mine.id).length : examResults.length,
      students: students.length, exams: exams.length
    };
  });
  const afterLogin = (await rawDump(ctx, base)).eff;
  await page.evaluate(() => { try { logout(); } catch (e) { return e.message; } });
  await page.waitForTimeout(5000);
  const afterLogout = (await rawDump(ctx, base)).eff;
  await ctx.close();
  return { who, view, afterLogin, afterLogout, errors };
}
// key|rid of every record of `before` that `after` still has.
function keptSet(before, after) {
  const B = recordMap(before), A = recordMap(after), out = {};
  Object.keys(B).forEach(k => Object.keys(B[k]).forEach(rid => { if (A[k] && A[k][rid] !== undefined) out[k + '\u0001' + rid] = B[k][rid]; }));
  return out;
}

async function checkPeopleSignIn(env, S0, S1) {
  const st1 = parse(S1.voctrain_students) || [];
  const me = st1.find(s => s.name === STUDENT_LOGIN.name && s.course === STUDENT_LOGIN.course);

  section('An instructor signs in on the upgraded device');
  const ins = await personRun(env, 'new', S1, 'instructor', 'gmyers', PW.instructor);
  ok(ins.who.role === 'instructor' && ins.view.instructor && ins.view.instructor.name === 'Garfield Myers',
    'the instructor signs in to his own portal (got ' + JSON.stringify(ins.who) + ')');
  ok(ins.errors.length === 0, 'with no page errors — got: ' + ins.errors.join(' | ').slice(0, 300));
  let r = compare(S1, ins.afterLogin, 'upgraded store → after the instructor signs in');
  reportCompare(r);
  ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0, 'an instructor signing in removes or changes nothing');
  const insOld = await personRun(env, 'old', S0, 'instructor', 'gmyers', PW.instructor);
  logoutRegression('instructor', S0, insOld.afterLogout, S1, ins.afterLogout, null);

  section('A trainee signs in on the upgraded device, then signs out');
  const stu = await personRun(env, 'new', S1, 'student', STUDENT_LOGIN.name.toLowerCase().replace(/[^a-z]+/g, '.') + '.w', PW.student);
  ok(stu.who.role === 'student' && stu.view.student && me && stu.view.student.id === me.id,
    'the trainee signs in to HER/HIS own record — ' + STUDENT_LOGIN.name + ' on ' + STUDENT_LOGIN.course + ' (got ' + JSON.stringify(stu.view.student) + ')');
  ok(stu.errors.length === 0, 'with no page errors — got: ' + stu.errors.join(' | ').slice(0, 300));
  r = compare(S1, stu.afterLogin, 'upgraded store → after the trainee signs in');
  reportCompare(r);
  ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0, 'a trainee signing in removes or changes nothing');
  const stuOld = await personRun(env, 'old', S0, 'student', STUDENT_LOGIN.name.toLowerCase().replace(/[^a-z]+/g, '.') + '.w', PW.student);
  ok(stuOld.who.role === 'student', 'old build: the same trainee signs in (for the comparison)');
  logoutRegression('trainee', S0, stuOld.afterLogout, S1, stu.afterLogout, me && me.id);
  // The trainee's own records must survive their own sign-out in the new build.
  const mineAfter = (parse(stu.afterLogout.voctrain_examResults) || []).filter(x => me && x.studentId === me.id).length;
  const mineBefore = (parse(S1.voctrain_examResults) || []).filter(x => me && x.studentId === me.id).length;
  ok(mineAfter === mineBefore, 'the trainee\'s own results are still on the device after the sign-out (' + mineAfter + '/' + mineBefore + ')');

  section('The first person on the upgraded site is a trainee');
  const first = await personRun(env, 'new', S0, 'student', STUDENT_LOGIN.name.toLowerCase().replace(/[^a-z]+/g, '.') + '.w', PW.student);
  ok(first.who.role === 'student' && first.view.student && first.view.student.name === STUDENT_LOGIN.name, 'a trainee can be the first to sign in after the update');
  r = compare(S0, first.afterLogin, 'old store → new build, a trainee signs in first');
  reportCompare(r);
  ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0, 'the upgrade migrations run under a trainee\'s session lose nothing');
  const att = attendanceCarriedOver(S0, first.afterLogin);
  ok(att.missing.length === 0 && att.shadowed.length === 0 && att.carried > 0, 'and the old weekly marks are carried into the register under that session too (' + att.carried + ' carried, ' + att.missing.length + ' missing, ' + att.shadowed.length + ' hidden)');
  logoutRegression('trainee (first after the update)', S0, stuOld.afterLogout, S0, first.afterLogout, first.view.student && first.view.student.id);
}

/* Sign-outs clear the device on purpose (the Centre's copy is on Drive or its
   server). What matters for the upgrade: nothing the OLD build kept through
   the same sign-out may now be cleared — except the documented narrowing of a
   trainee's device to that trainee's own records. */
const STAFF_ONLY_ON_TRAINEE_SIGNOUT = ['voctrain_documentHubFiles'];
function logoutRegression(who, oldStart, oldEnd, newStart, newEnd, ownId) {
  const keptOld = keptSet(oldStart, oldEnd), keptNew = keptSet(newStart, newEnd);
  const keysNewStart = recordMap(newStart);
  const regress = [], narrowed = [];
  Object.keys(keptOld).forEach(id => {
    if (keptNew[id]) return;
    const [k, rid] = id.split('\u0001');
    if (!keysNewStart[k] || keysNewStart[k][rid] === undefined) return;   // migrated away by the upgrade itself (checked above)
    const rec = keptOld[id];
    const sid = rec && (rec.studentId || (k === 'voctrain_transcriptProfiles' ? rid : null));
    // Staff documents (HR, policy) have no trainee audience; the new build
    // clears them from a trainee's device on purpose (clearSensitiveStudentData).
    if (ownId && ((sid && sid !== ownId) || STAFF_ONLY_ON_TRAINEE_SIGNOUT.indexOf(k) !== -1)) narrowed.push(k);
    else regress.push(id.replace('\u0001', '/'));
  });
  const kOld = Object.keys(keptOld).length, kNew = Object.keys(keptNew).length;
  console.log('  ' + who + ' sign-out: old build kept ' + kOld + ' records, new build kept ' + kNew);
  if (narrowed.length) {
    const g = {}; narrowed.forEach(k => { g[k] = (g[k] || 0) + 1; });
    note(who + ' sign-out: the new build also clears OTHER trainees\' records the old build left behind (documented privacy narrowing): ' + JSON.stringify(g));
  }
  ok(regress.length === 0, who + ' sign-out clears nothing the old build kept (beyond other people\'s records): ' + regress.length + ' — ' + regress.slice(0, 10).join(', '));
}

/* ================================================================== main */
/* ==================================================== the Offline System
   The real cestis-offline-server.js. The OLD server runs from the old tree's
   own "Offline System" folder in the temp directory (its data folder is a
   throw-away copy — never the repository's); the NEW build is generated from
   this working tree with tools/build-offline.js --out and started on the SAME
   port against the SAME data folder, as a Centre replaces the program folder
   and keeps "data". */
function readServerFiles(dir) {
  const out = {};
  fs.readdirSync(dir).filter(f => /\.json$/i.test(f)).forEach(f => {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); out[f] = (j && j.data && typeof j.data === 'object') ? j.data : j; }
    catch (e) { out[f] = '__unreadable__'; }
  });
  return out;
}
// Every record any of the server's files holds, per key (a key may live in a
// page's own file AND in the whole-store mirror; a record in either counts).
function serverUnion(files) {
  const out = {};
  Object.keys(files).forEach(f => {
    const d = files[f];
    if (!d || typeof d !== 'object') return;
    const dump = {};
    Object.keys(d).forEach(k => { dump[k] = typeof d[k] === 'string' ? d[k] : JSON.stringify(d[k]); });
    const m = recordMap(dump);
    Object.keys(m).forEach(k => { out[k] = out[k] || {}; Object.keys(m[k]).forEach(rid => { if (!(rid in out[k])) out[k][rid] = m[k][rid]; }); });
  });
  return out;
}
async function startOfflineServer(dir, port, extraEnv) {
  const proc = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: dir, stdio: 'ignore',
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(port) }, extraEnv || {}) });
  for (let i = 0; i < 80; i++) {
    await wait(100);
    try { if ((await fetch('http://127.0.0.1:' + port + '/_cestis/health')).ok) return proc; } catch (e) {}
  }
  proc.kill();
  throw new Error('the offline server in ' + dir + ' did not start');
}

async function offlinePhase(env) {
  section('OFFLINE SYSTEM: the old Centre server is replaced by the new build, same data folder');
  const OFF_OLD = path.join(OLD, 'Offline System');
  const DATA = path.join(OFF_OLD, 'data');               // the temp tree's, never the repo's
  const NEWOFF = path.join(TMP, 'offline-new');
  execSync('node "' + path.join(ROOT, 'tools', 'build-offline.js') + '" --out "' + NEWOFF + '"', { stdio: 'pipe' });
  ok(fs.existsSync(path.join(NEWOFF, 'cestis-offline-server.js')) && fs.existsSync(path.join(NEWOFF, 'index.html')), 'the new offline build is generated');
  const port = 9100 + Math.floor(Math.random() * 800);
  const origin = 'http://127.0.0.1:' + port;
  let proc = null;
  try {
    env.setOfflineBuild('old-offline');
    proc = await startOfflineServer(OFF_OLD, port);
    const A = await env.newCtx(origin);
    const seededOff = await seedOldCentre(env, A, origin, 'offline', true);
    const A0 = seededOff.S0;
    await wait(4000);                                      // the debounced pushes to the server
    const F0 = readServerFiles(DATA);
    fs.writeFileSync(path.join(TMP, 'offline-F0.json'), JSON.stringify(F0, null, 1));
    const v0 = serverUnion(F0);
    console.log('  old offline server: ' + Object.keys(F0).length + ' files, ' + Object.keys(v0).length + ' keys with records (' +
      Object.keys(v0).reduce((a, k) => a + Object.keys(v0[k]).length, 0) + ' records)');
    ok(Object.keys(F0).length >= 5, 'the old offline pages kept files on the Centre\'s server: ' + Object.keys(F0).join(', '));
    proc.kill(); proc = null; await wait(600);

    env.setOfflineBuild('new-offline');
    proc = await startOfflineServer(NEWOFF, port, { CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(TMP, 'offline-cert') });
    // The first device to open the new build is a brand-new one: all it has is
    // what the old build left in the server's files.
    section('A brand-new device is the first to open the upgraded offline system');
    const B0 = await env.newCtx(origin);
    let { page: I, errors } = await env.open(B0, 'index.html', { origin, settle: 4000 });
    let who0 = await env.signIn(I, 'cestisadmin', PW.admin);
    ok(who0.role === 'admin', 'the administrator signs in on a brand-new device with only the server\'s files (accounts came from the server)');
    await I.waitForTimeout(5000);
    await I.close();
    await exerciseSiblings(env, B0, origin, 'first device (new offline)', true);
    await wait(3000);
    const B0d = (await rawDump(B0, origin)).eff;
    fs.writeFileSync(path.join(TMP, 'offline-B0.json'), JSON.stringify(B0d, null, 1));
    const devOnly0 = /^(cestis_pagecloud_stamps__|voctrain_user_|cestis_auth_session|cestisPendingUpload|cestisUnsyncedOnSignOut)/;
    let r0 = compareMaps(v0, recordMap(B0d), 'old server files → the first new-build device', { newest: recordMap(A0) });
    r0.missingKeys = r0.missingKeys.filter(m => !devOnly0.test(m.key));
    r0.missing = r0.missing.filter(m => !devOnly0.test(m.key));
    reportCompare(r0);
    ok(r0.missingKeys.length === 0 && r0.missing.length === 0 && r0.changed.length === 0,
      'the first device has every record the old server held (' + r0.missingKeys.length + ' keys, ' + r0.missing.length + ' missing, ' + r0.changed.length + ' changed)');
    const att0 = attendanceCarriedOver(A0, B0d);
    console.log('  first device: ' + att0.slots + ' old marked slots — ' + att0.carried + ' carried, ' + att0.missing.length + ' missing, ' + att0.shadowed.length + ' hidden behind an estimate, ' + att0.skippedByDesign + ' skipped by design');
    ok(att0.missing.length === 0 && att0.shadowed.length === 0, 'the first device carries the old weekly marks the server held into the register (missing ' +
      att0.missing.slice(0, 4).join(', ') + '; hidden ' + JSON.stringify(att0.shadowed.slice(0, 2)) + ')');
    await B0.close();

    section('The office PC that held the old build opens the upgraded offline system');
    ({ page: I, errors } = await env.open(A, 'index.html', { origin, settle: 3500 }));
    ok(errors.length === 0, 'new offline build: the dashboard loads over the old data without errors — got: ' + errors.join(' | ').slice(0, 300));
    ok(await I.evaluate(() => CESTISPageCloud.lan()), 'it finds the Centre\'s server');
    let who = await env.signIn(I, 'cestisadmin', PW.admin);
    ok(who.role === 'admin' && who.shell, 'the administrator signs in to the upgraded offline system');
    await I.waitForTimeout(3000);
    await I.evaluate(() => { try { saveState(); } catch (e) {} });
    await I.waitForTimeout(2500);
    await I.close();
    await exerciseSiblings(env, A, origin, 'new offline');
    ({ page: I, errors } = await env.open(A, 'index.html', { origin, settle: 3000 }));
    await env.signIn(I, 'cestisadmin', PW.admin);
    await I.waitForTimeout(3000);
    await I.close();
    await wait(4000);
    const A1 = (await rawDump(A, origin)).eff;
    const F1 = readServerFiles(DATA);
    fs.writeFileSync(path.join(TMP, 'offline-A1.json'), JSON.stringify(A1, null, 1));
    fs.writeFileSync(path.join(TMP, 'offline-F1.json'), JSON.stringify(F1, null, 1));

    let r = compare(A0, A1, 'offline device: old build → new build');
    reportCompare(r);
    ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0,
      'the office PC keeps every record through the offline upgrade (' + r.missingKeys.length + ' keys, ' + r.missing.length + ' records missing, ' + r.changed.length + ' changed)');
    const att = attendanceCarriedOver(A0, A1);
    ok(att.missing.length === 0 && att.shadowed.length === 0 && att.carried > 0, 'its old weekly marks are in the dated register (' + att.carried + ' carried, ' + att.missing.length + ' missing, ' + att.shadowed.length + ' hidden behind an estimate)');

    Object.keys(F0).forEach(f => {
      if (F0[f] === '__unreadable__') return;
      ok(F1[f] && F1[f] !== '__unreadable__', 'the server still has a readable ' + f);
    });
    const rf = compareMaps(v0, serverUnion(F1), 'the server\'s data files: old build → new build', { newest: recordMap(A0) });
    reportCompare(rf);
    ok(rf.missingKeys.length === 0 && rf.missing.length === 0 && rf.changed.length === 0,
      'every record in the server\'s files is still there after the upgrade (' + rf.missingKeys.length + ' keys, ' + rf.missing.length + ' records missing, ' + rf.changed.length + ' changed)');
    // And everything the office PC held now reaches the server.
    const deviceOnly = /^(cestis_pagecloud_stamps__|voctrain_user_|cestis_auth_session|cestisPendingUpload|cestisUnsyncedOnSignOut)/;
    const ra = compareMaps(recordMap(A0), serverUnion(F1), 'office PC (old build) → the server after the upgrade');
    ra.missingKeys = ra.missingKeys.filter(m => !deviceOnly.test(m.key) && !IGNORE_KEY.test(m.key));
    ra.missing = ra.missing.filter(m => !deviceOnly.test(m.key));
    reportCompare(ra);
    ok(ra.missingKeys.length === 0 && ra.missing.length === 0 && ra.changed.length === 0, 'every record the office PC held before the upgrade is on the server after it');

    section('A fresh device on the Centre network sees every record');
    const B = await env.newCtx(origin);
    ({ page: I, errors } = await env.open(B, 'index.html', { origin, settle: 4000 }));
    who = await env.signIn(I, 'cestisadmin', PW.admin);
    ok(who.role === 'admin', 'the administrator signs in on a brand-new device (accounts came from the server)');
    await I.waitForTimeout(4000);
    await I.close();
    await exerciseSiblings(env, B, origin, 'fresh device', true);
    await wait(2000);
    const B1 = (await rawDump(B, origin)).eff;
    fs.writeFileSync(path.join(TMP, 'offline-B1.json'), JSON.stringify(B1, null, 1));
    const rb = compare(A0, B1, 'office PC (old build) → a fresh device after the upgrade');
    rb.missingKeys = rb.missingKeys.filter(m => !deviceOnly.test(m.key));
    rb.missing = rb.missing.filter(m => !deviceOnly.test(m.key));
    reportCompare(rb);
    ok(rb.missingKeys.length === 0 && rb.missing.length === 0 && rb.changed.length === 0, 'a fresh device has every record the Centre had before the upgrade (' +
      rb.missingKeys.length + ' keys, ' + rb.missing.length + ' records missing)');
    const rbs = compareMaps(v0, recordMap(B1), 'old server files → a fresh device after the upgrade', { newest: recordMap(A0) });
    rbs.missingKeys = rbs.missingKeys.filter(m => !deviceOnly.test(m.key));
    rbs.missing = rbs.missing.filter(m => !deviceOnly.test(m.key));
    reportCompare(rbs);
    ok(rbs.missingKeys.length === 0 && rbs.missing.length === 0 && rbs.changed.length === 0, 'and every record the old server held');
    await A.close(); await B.close();
  } finally {
    env.setOfflineBuild(null);
    if (proc) { proc.kill(); await wait(300); }
  }
}

/* ================================================= Google Drive (emulated)
   An in-memory Drive answering the v3 calls the pages make (list by query,
   read, create/update by multipart or media upload, metadata, delete), so the
   online build's real sync paths run: the OLD build uploads the Centre to it,
   the upgraded device merges against it, and a brand-new device rebuilds the
   Centre from it. Nothing leaves the machine — the browser never reaches
   Google; these requests are answered by the test. */
function FakeDrive() { this.files = {}; this.seq = 0; this.calls = 0; this.errors = []; }
FakeDrive.prototype.list = function (q) {
  const clauses = String(q || '').split(/\s+and\s+/i).map(c => c.trim()).filter(Boolean);
  const unq = s => s.replace(/^'|'$/g, '').replace(/\\'/g, "'");
  return Object.values(this.files).filter(f => clauses.every(c => {
    let m;
    if ((m = /^name\s*=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.name === unq(m[1]);
    if ((m = /^name\s+contains\s+('(?:[^'\\]|\\.)*')$/.exec(c))) return f.name.indexOf(unq(m[1])) !== -1;
    if ((m = /^('(?:[^'\\]|\\.)*')\s+in\s+parents$/.exec(c))) return f.parents.indexOf(unq(m[1])) !== -1;
    if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) return String(!!f.trashed) === m[1];
    if ((m = /^mimeType\s*=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.mimeType === unq(m[1]);
    if ((m = /^mimeType\s*!=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.mimeType !== unq(m[1]);
    return true;   // a clause this emulation does not model narrows nothing
  }));
};
FakeDrive.prototype.meta = function (f) {
  return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime, createdTime: f.createdTime,
    version: String(f.version), size: String(Buffer.byteLength(f.content || '')), webViewLink: 'https://drive.example/' + f.id,
    webContentLink: 'https://drive.example/dl/' + f.id, md5Checksum: require('crypto').createHash('md5').update(f.content || '').digest('hex') };
};
FakeDrive.prototype.put = function (id, meta, content) {
  const now = new Date(Date.now() + (this.seq++)).toISOString();
  let f = id ? this.files[id] : null;
  if (!f) {
    id = id || ('fake' + (++this.seq) + 'x' + Math.random().toString(36).slice(2, 8));
    f = this.files[id] = { id, name: 'Untitled', mimeType: 'application/json', parents: [], createdTime: now, version: 0, content: '' };
  }
  if (meta) {
    if (meta.name) f.name = meta.name;
    if (meta.mimeType) f.mimeType = meta.mimeType;
    if (Array.isArray(meta.parents)) f.parents = meta.parents.slice();
    if (meta.trashed != null) f.trashed = !!meta.trashed;
  }
  if (content != null) f.content = content;
  f.version++; f.modifiedTime = now;
  return f;
};
function parseMultipart(buf, ctype) {
  const m = /boundary=("?)([^";]+)\1/i.exec(ctype || '');
  if (!m) return null;
  const s = buf.toString('latin1'), parts = s.split('--' + m[2]).slice(1).filter(p => !/^--/.test(p));
  const out = { meta: null, content: null };
  parts.forEach(p => {
    const i = p.indexOf('\r\n\r\n');
    if (i === -1) return;
    const head = p.slice(0, i), body = Buffer.from(p.slice(i + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8');
    if (!out.meta && (/name="metadata"/i.test(head) || (/application\/json/i.test(head) && /^\s*\{/.test(body) && /"(name|parents|mimeType)"/.test(body) && body.length < 4000 && out.content === null && !/name="file"/i.test(head)))) {
      try { out.meta = JSON.parse(body); return; } catch (e) {}
    }
    out.content = body;
  });
  return out;
}
FakeDrive.prototype.handle = async function (route) {
  const req = route.request(), url = new URL(req.url()), method = req.method(), p = url.pathname;
  this.calls++;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Date, ETag, Location', Date: new Date().toUTCString() };
  const json = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
  try {
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/\/oauth2\/v\d\/userinfo$/.test(p)) return json({ email: 'centre@example.org', name: 'Centre Drive' });
    if (/\/drive\/v3\/about$/.test(p)) return json({ user: { displayName: 'Centre Drive', emailAddress: 'centre@example.org' }, storageQuota: { limit: '16106127360', usage: '1024' } });
    let m;
    const body = req.postDataBuffer() || Buffer.alloc(0);
    const ctype = (await req.allHeaders())['content-type'] || '';
    if (/^\/upload\/drive\/v3\/files\/?$/.test(p) && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'resumable') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
        const f = this.put(null, meta, '');
        return route.fulfill({ status: 200, headers: Object.assign({ Location: 'https://www.googleapis.com/upload/drive/v3/files/' + f.id + '?uploadType=resumable-put' }, cors), body: '' });
      }
      const mp = parseMultipart(body, ctype) || { meta: null, content: body.toString('utf8') };
      return json(this.meta(this.put(null, mp.meta || {}, mp.content == null ? '' : mp.content)));
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && (method === 'PATCH' || method === 'PUT')) {
      if (!this.files[m[1]]) return json({ error: { code: 404, message: 'File not found' } }, 404);
      const type = url.searchParams.get('uploadType');
      if (type === 'multipart') { const mp = parseMultipart(body, ctype) || {}; return json(this.meta(this.put(m[1], mp.meta, mp.content))); }
      return json(this.meta(this.put(m[1], null, body.toString('utf8'))));
    }
    if (/^\/drive\/v3\/files\/?$/.test(p)) {
      if (method === 'GET') {
        let files = this.list(url.searchParams.get('q')).map(f => this.meta(f));
        if (/modifiedTime desc/.test(url.searchParams.get('orderBy') || '')) files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
        return json({ files });
      }
      if (method === 'POST') { let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {} return json(this.meta(this.put(null, meta, ''))); }
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/.exec(p))) {
      const f = this.files[m[1]];
      if (m[2]) return json({ id: 'perm1', role: 'reader', type: 'anyone' });
      if (!f) return json({ error: { code: 404, message: 'File not found: ' + m[1] } }, 404);
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'application/json', headers: Object.assign({ ETag: '"' + f.version + '"' }, cors), body: f.content || '' });
        return json(this.meta(f));
      }
      if (method === 'PATCH') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
        const add = url.searchParams.get('addParents'), rem = url.searchParams.get('removeParents');
        if (add) meta.parents = (meta.parents || f.parents).concat(add.split(','));
        if (rem) meta.parents = (meta.parents || f.parents).filter(x => rem.split(',').indexOf(x) === -1);
        return json(this.meta(this.put(m[1], meta, null)));
      }
      if (method === 'DELETE') { delete this.files[m[1]]; return route.fulfill({ status: 204, headers: cors, body: '' }); }
    }
    this.errors.push(method + ' ' + p + url.search);
    return json({ error: { code: 400, message: 'not emulated: ' + method + ' ' + p } }, 400);
  } catch (e) {
    this.errors.push('handler: ' + e.message);
    return json({ error: { code: 500, message: e.message } }, 500);
  }
};
// Every Drive file as a { key: string } dump, by file name: a page's own file
// and the whole-store files carry storage keys (data / store); the
// dashboard's main backup carries its collections by name ("main:<name>").
FakeDrive.prototype.dumps = function () {
  const out = {};
  Object.values(this.files).forEach(f => {
    const v = parse(f.content);
    if (!v || typeof v !== 'object') return;
    let dump = {};
    const strMap = o => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length && Object.keys(o).every(k => typeof o[k] === 'string');
    if (strMap(v.store)) dump = v.store;
    else if (strMap(v.data)) dump = v.data;
    else if (v.data && typeof v.data === 'object') Object.keys(v.data).forEach(k => { dump['main:' + k] = JSON.stringify(v.data[k]); });
    else Object.keys(v).forEach(k => { dump['file:' + k] = JSON.stringify(v[k]); });
    const name = f.name + (out[f.name] ? '#' + f.id : '');
    out[name] = dump;
  });
  return out;
};
const DRIVE_TOKEN_KEYS = ['schoolDashboardGoogleAccessToken', 'cestisGoogleAccessToken'];
function driveTokenSeed() {
  const exp = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const seed = {};
  DRIVE_TOKEN_KEYS.forEach(k => { seed[k] = 'ya29.fake-centre-token'; seed[k.replace('AccessToken', 'TokenExpiry')] = exp; });
  return seed;
}
async function driveCtx(env, drive) {
  const ctx = await env.newCtx();
  await ctx.route(/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//, r => drive.handle(r));
  return ctx;
}

/* The Centre's administrator, whichever way in still works: the old build's
   one-time reset (v1, "2026-09-03") put cestisadmin back on the PUBLISHED
   default whenever a Drive copy carried that reset, and the new build rightly
   refuses the published default where a real administrator exists — so the
   deputy administrator (a real password) is the way in then. */
async function signInAnyAdmin(env, page) {
  let who = await env.signIn(page, 'cestisadmin', PW.admin);
  if (who.role === 'admin') return Object.assign({ as: 'cestisadmin' }, who);
  who = await env.signIn(page, 'deputyadmin', PW.admin + '-2');
  return Object.assign({ as: 'deputyadmin' }, who);
}

async function drivePhase(env) {
  section('GOOGLE DRIVE (emulated): the old build syncs a Centre to Drive; the new build merges it and rebuilds it on a new device');
  const drive = new FakeDrive();
  const A = await driveCtx(env, drive);
  SERVE_ROOT = OLD;
  env.setOfflineBuild('old-drive');
  await rawRestore(A, env.base, driveTokenSeed());
  // Wait until the page has made no Drive call for three seconds.
  const driveQuiet = async (page) => {
    let last = -1, still = 0;
    for (let i = 0; i < 60 && still < 3; i++) { await page.waitForTimeout(1000); if (drive.calls === last) still++; else { still = 0; last = drive.calls; } }
  };
  const seededD = await seedOldCentre(Object.assign({}, env, { driveQuiet }), A, env.base, 'drive', false);
  // The old dashboard's own upload: the autosave, then the master snapshot.
  let { page: I } = await env.open(A, 'index.html', { accept: true, settle: 2500 });
  const oldWho = await signInAnyAdmin(env, I);
  if (oldWho.as !== 'cestisadmin') note('Drive (old build): cestisadmin no longer took the Centre\'s password — the old build\'s one-time reset put it back on the published default via Drive; signed in as ' + oldWho.as);
  const up = await I.evaluate(async () => {
    const out = {};
    try { await autoSaveToAllFolders(); out.autosave = true; } catch (e) { out.autosave = e.message; }
    try { await saveMasterSnapshot('test', true); out.snapshot = true; } catch (e) { out.snapshot = e.message; }
    return out;
  });
  await I.waitForTimeout(4000);
  await I.close();
  const S0d = (await rawDump(A, env.base)).eff;
  const D0 = drive.dumps();
  fs.writeFileSync(path.join(TMP, 'drive-D0.json'), JSON.stringify(D0, null, 1));
  console.log('  old build wrote ' + Object.keys(D0).length + ' Drive files: ' + Object.keys(D0).join(', ') + ' (' + drive.calls + ' Drive calls; upload: ' + JSON.stringify(up) + ')');
  if (drive.errors.length) note('Drive calls the emulation did not model (old build): ' + drive.errors.slice(0, 6).join(' | '));
  ok(Object.keys(D0).length >= 3, 'the old build uploaded the Centre to Drive');

  // Upgrade: the same device, the same Drive.
  SERVE_ROOT = ROOT;
  env.setOfflineBuild('new-drive');
  let errors;
  ({ page: I, errors } = await env.open(A, 'index.html', { settle: 3500 }));
  let who = await signInAnyAdmin(env, I);
  ok(who.role === 'admin', 'Drive: the administrator signs in to the upgraded build (as ' + who.as + ')');
  await I.waitForTimeout(6000);                    // the sign-in pull, merge and upload
  await I.evaluate(async () => { try { saveState(); } catch (e) {} try { await autoSaveToAllFolders(); } catch (e) {} });
  await I.waitForTimeout(3000);
  ok(errors.length === 0, 'Drive: the upgraded dashboard raises no errors while syncing — got: ' + errors.join(' | ').slice(0, 300));
  await I.close();
  await exerciseSiblings(env, A, env.base, 'new build + Drive');
  ({ page: I } = await env.open(A, 'index.html', { settle: 3000 }));
  await signInAnyAdmin(env, I);
  await I.waitForTimeout(5000);
  await I.close();
  const S1d = (await rawDump(A, env.base)).eff;
  const D1 = drive.dumps();
  fs.writeFileSync(path.join(TMP, 'drive-D1.json'), JSON.stringify(D1, null, 1));
  const tokenish = /^(schoolDashboardGoogle|cestisGoogle)/;
  let r = compare(S0d, S1d, 'Drive: the device, old build → new build after syncing');
  reportCompare(r);
  ok(r.missingKeys.length === 0 && r.missing.length === 0 && r.changed.length === 0,
    'Drive: the upgraded device keeps every record through the sync (' + r.missingKeys.length + ' keys, ' + r.missing.length + ' missing, ' + r.changed.length + ' changed)');
  const att = attendanceCarriedOver(S0d, S1d);
  ok(att.missing.length === 0 && att.shadowed.length === 0 && att.carried > 0, 'Drive: old weekly marks carried into the register (' + att.carried + ' carried, ' + att.missing.length + ' missing, ' + att.shadowed.length + ' hidden behind an estimate)');
  // Drive itself: every record any old file held is still in some file.
  const u0 = serverUnion(D0), u1 = serverUnion(D1);
  const rd = compareMaps(u0, u1, 'Drive files: before → after the upgrade', { newest: recordMap(S0d) });
  reportCompare(rd);
  ok(rd.missingKeys.length === 0 && rd.missing.length === 0 && rd.changed.length === 0, 'Drive: no record is lost from the Centre\'s Drive files');
  if (drive.errors.length) note('Drive calls the emulation did not model (all builds): ' + Array.from(new Set(drive.errors)).slice(0, 8).join(' | '));

  // A brand-new device rebuilds the Centre from Drive.
  section('A brand-new device rebuilds the Centre from Drive');
  const B = await driveCtx(env, drive);
  await rawRestore(B, env.base, driveTokenSeed());
  ({ page: I, errors } = await env.open(B, 'index.html', { settle: 3000 }));
  const pulled = await I.evaluate(async () => { try { await loginPageSync(); return true; } catch (e) { return e.message; } });
  await I.waitForTimeout(4000);
  who = await signInAnyAdmin(env, I);
  ok(pulled === true && who.role === 'admin', 'the administrator signs in on a new device after "Sync Now" (got ' + JSON.stringify(who) + ', ' + pulled + ')');
  await I.waitForTimeout(6000);
  await I.close();
  await exerciseSiblings(env, B, env.base, 'new device + Drive', true);
  const F1 = (await rawDump(B, env.base)).eff;
  fs.writeFileSync(path.join(TMP, 'drive-F1.json'), JSON.stringify(F1, null, 1));
  const rf = compare(S0d, F1, 'Drive: the old device\'s Centre → a new device after the upgrade');
  const devOnly = /^(cestis_pagecloud_stamps__|voctrain_user_|cestis_auth_session|cestisPendingUpload|cestisUnsyncedOnSignOut|cestisPayroll_backup|cesti_virement_cloud_cache)/;
  rf.missingKeys = rf.missingKeys.filter(m => !devOnly.test(m.key) && !tokenish.test(m.key));
  rf.missing = rf.missing.filter(m => !devOnly.test(m.key));
  reportCompare(rf);
  ok(rf.missingKeys.length === 0 && rf.missing.length === 0 && rf.changed.length === 0, 'Drive: a new device has every record the Centre had before the upgrade (' +
    rf.missingKeys.map(m => m.key + '(' + m.records + ')').join(', ') + (rf.missing.length ? '; ' + rf.missing.length + ' records missing' : '') +
    (rf.changed.length ? '; changed ' + rf.changed.slice(0, 6).map(c => c.key + '/' + c.rid + '.' + c.field).join(', ') : '') + ')');
  await A.close(); await B.close();
  env.setOfflineBuild(null);
  return seededD;
}

function reportDialogsAndErrors(env) {
  section('What the new build asked or showed (dialogs answered "Cancel")');
  const seen = {};
  env.dialogs.filter(d => !/^old/.test(d.build)).forEach(d => {
    const k = d.page + ' ' + d.type + ': ' + d.msg;
    seen[k] = (seen[k] || 0) + 1;
  });
  Object.keys(seen).forEach(k => console.log('  ' + (seen[k] > 1 ? seen[k] + '× ' : '') + k));
  if (!Object.keys(seen).length) console.log('  (none)');
  const newErr = env.pageErrors.filter(e => /^new/.test(e.build));
  ok(newErr.length === 0, 'no page of the new build threw anywhere in the run — got: ' + newErr.map(e => e.build + ' ' + e.page + ': ' + e.msg).slice(0, 8).join(' | '));
}

/* Seed a whole Centre through the OLD pages served at `origin` (the online
   build, or the old Offline System on its own server), let them settle, and
   return the store. */
async function seedOldCentre(env, ctx, origin, label, offline) {
  const { open, signIn, frameOf } = env;
  const seeded = {};
    let { page: I } = await open(ctx, 'index.html', { origin, accept: true, settle: 2500 });
    let who = await signIn(I, 'cestisadmin', 'cestisadmin123$');
    if (offline) {
      /* The old offline dashboard called saveCollection() and never defined it,
         so its saveState() threw on the first line and kept nothing (fixed by
         the generator). Records reached an old offline device only through the
         sibling pages or a restore. Give the old page the online build's own
         saveCollection so the seed lands as a restored Centre would. */
      seeded.offlineShim = await I.evaluate(() => {
        if (typeof saveCollection === 'function') return false;
        window.saveCollection = function (k, v) { return CESTISCore.pageCloud.guardedSet(CESTISStore, k, v); };
        return true;
      });
    }
    ok(who.role === 'admin' && who.shell, 'old build: the administrator signs in');
    /* With Google Drive connected the old build's sign-in starts a pull that
       later REPLACES its account list in memory — accounts added meanwhile
       are dropped (an old-build race, seen as a missing deputy administrator).
       Let that pull finish, and add again whatever it still dropped. */
    if (env.driveQuiet) await env.driveQuiet(I);
    seeded.accounts = await I.evaluate(oldIndexAccountsAndCentres, { PW, INSTRUCTORS });
    for (let t = 0; t < 3 && !seeded.accounts.complete; t++) {
      note(label + ' seed (old build): the old build\'s own sign-in sync dropped accounts the seed had just added; adding them again');
      if (env.driveQuiet) await env.driveQuiet(I); else await I.waitForTimeout(3000);
      seeded.accounts = await I.evaluate(oldIndexAccountsAndCentres, { PW, INSTRUCTORS });
    }
    ok(seeded.accounts.complete, label + ' (old build): every seeded account is stored');
    await I.evaluate(() => showPage('students'));
    const sp = await frameOf(I, /Student-Progress/);
    ok(!!sp, 'old build: the Student Progress frame opens');
    seeded.spStudents = await sp.evaluate(oldSpAddTrainees, ROSTER);
    await I.waitForTimeout(1500);
    await I.evaluate(() => showPage('dashboard'));
    seeded.studentLogins = await I.evaluate(oldIndexLogins, { PW, ROSTER, STUDENT_LOGIN, DISABLED_LOGIN });
    await I.evaluate(() => showPage('students'));
    const sp2 = await frameOf(I, /Student-Progress/);
    await sp2.evaluate(() => { try { loadData(); } catch (e) {} });
    seeded.deletedTrainee = await sp2.evaluate(oldSpDeleteTrainee, DELETED_TRAINEE);
    await I.waitForTimeout(1200);
    await I.evaluate(() => showPage('dashboard'));
    seeded.centre = await I.evaluate(oldIndexCentreData, { PW, ROSTER, STUDENT_LOGIN, DISABLED_LOGIN, DELETED_TRAINEE });
    seeded.attendance = await I.evaluate(oldIndexAttendance, {});
    // The Cosmetology intake is over now that its trainees qualified.
    await I.evaluate(() => { const c = skillAreas.find(s => s.name === 'Cosmetology'); c.endDate = '2026-08-28'; saveCollection('voctrain_skillAreas', skillAreas); saveState(); });
    await I.waitForTimeout(800);
    await I.waitForTimeout(2600); await I.close();

    let o = await open(ctx, 'Transcript-Grades.html?role=admin', { origin, accept: true });
    seeded.transcripts = await o.page.evaluate(oldTranscripts, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Cert-Transcript-Requests.html', { origin, accept: true });
    seeded.requests = await o.page.evaluate(oldRequests, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'School.Fee.html', { origin, accept: true, settle: 2500 });
    seeded.fee = await o.page.evaluate(oldSchoolFee, {}); await o.page.waitForTimeout(500); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'CESTIS.Cashbook.html', { origin, accept: true, settle: 2500 });
    seeded.cashbook = await o.page.evaluate(oldCashbook, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Staff.Payslip.html', { origin, accept: true });
    seeded.payroll = await o.page.evaluate(oldPayslip, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Staff.Clock.in.html', { origin, accept: true });
    seeded.clock = await o.page.evaluate(oldClockIn, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Virement.Request.html', { origin, accept: true });
    seeded.virements = await o.page.evaluate(oldVirements, {}); await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Finance.Invoice.html', { origin, accept: true });
    seeded.invoices = await o.page.evaluate(oldFinanceDoc, { key: 'cestis_finance_invoices', docs: [
      { billedTo: 'HEART/NSTA Trust', date: '2026-09-01', desc: 'Training subvention — Welding', qty: 16, price: 45000 },
      { billedTo: 'Jamaica Public Service', date: '2026-09-15', desc: 'Short course — Electrical safety', qty: 1, price: 125000 }] });
    await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Finance.Quote.html', { origin, accept: true });
    seeded.quotes = await o.page.evaluate(oldFinanceDoc, { key: 'cestis_finance_quotes', docs: [
      { billedTo: 'Clarendon Parish Council', date: '2026-10-01', desc: 'Welding repairs to market stalls', qty: 4, price: 32500 }] });
    await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Finance.Purchase.Order.html', { origin, accept: true });
    seeded.pos = await o.page.evaluate(oldFinanceDoc, { key: 'cestis_finance_pos', docs: [
      { supplier: 'Industrial Gases Ltd', date: '2026-10-02', desc: 'Argon cylinders', qty: 6, price: 18750 }] });
    await o.page.waitForTimeout(2600); await o.page.close();
    o = await open(ctx, 'Finance.Payment.Voucher.html', { origin, accept: true });
    seeded.voucher = await o.page.evaluate(oldVoucher, {}); await o.page.waitForTimeout(2600); await o.page.close();

    ({ page: I } = await open(ctx, 'index.html', { origin, accept: true, settle: 2500 }));
    who = await signIn(I, 'cestisadmin', PW.admin);
    if (who.role !== 'admin' && label === 'drive') {
      // See signInAnyAdmin: the old build's reset reached this device from Drive.
      note('drive seed (old build): cestisadmin was put back on the published default by the old build\'s one-time reset arriving from Drive; continuing as deputyadmin');
      who = await signIn(I, 'deputyadmin', PW.admin + '-2');
    }
    ok(who.role === 'admin', label + ' (old build): the administrator signs in with the Centre\'s own password');
    seeded.board = await I.evaluate(oldIndexAppraisalsAndBoard, {});
    await I.evaluate(() => saveState());
    await I.waitForTimeout(800);
    await I.waitForTimeout(2600); await I.close();

    // Let every old page run its own load-time passes once more, then read the store.
    for (const rel of ['Student-Progress.html', 'School.Fee.html', 'CESTIS.Cashbook.html', 'Staff.Payslip.html', 'Staff.Clock.in.html',
      'Virement.Request.html', 'Transcript-Grades.html?role=admin', 'Cert-Transcript-Requests.html', 'Income.Expenditure.html']) {
      const s = await open(ctx, rel, { origin, accept: true, settle: 1500 }); await s.page.close();
    }
    ({ page: I } = await open(ctx, 'index.html', { origin, accept: true, settle: 2500 }));
    if ((await signIn(I, 'cestisadmin', PW.admin)).role !== 'admin') await signIn(I, 'deputyadmin', PW.admin + '-2');
    await I.waitForTimeout(1000);
    await I.waitForTimeout(2600); await I.close();
    await wait(500);
    const S0 = (await rawDump(ctx, origin)).eff;
    fs.writeFileSync(path.join(TMP, label + '-S0-old.json'), JSON.stringify(S0, null, 1));
    const counts = {};
    const m0 = recordMap(S0);
    Object.keys(m0).sort().forEach(k => { counts[k] = Object.keys(m0[k]).length; });
    seeded.counts = counts;
    console.log('  seeded (' + label + '): ' + JSON.stringify(seeded, null, 0).slice(0, 2000));
    console.log('  record counts per key (old build, settled):');
    Object.keys(counts).forEach(k => console.log('    ' + k + ': ' + counts[k]));
    const oldErr = env.pageErrors.filter(e => /^old/.test(e.build));
    if (oldErr.length) note('old build page errors while seeding (pre-existing, not the upgrade): ' + oldErr.map(e => e.page + ': ' + e.msg).slice(0, 6).join(' | '));
    ok(Object.keys(counts).length > (offline ? 25 : 40), label + ': the seed filled more than 40 storage keys (got ' + Object.keys(counts).length + ')');

  return { S0, seeded };
}

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const dialogs = [];
  const pageErrors = [];
  async function newCtx(origin) {
    origin = origin || base;
    const ctx = await browser.newContext({ acceptDownloads: true });
    // Every outside request is cut: Google, CDNs, PeerJS — the Centre's
    // offline reality, and nothing here may reach the internet.
    await ctx.route('**/*', r => (r.request().url().startsWith(origin) ? r.continue() : r.abort()));
    try { await ctx.routeWebSocket(/.*/, ws => { try { ws.close(); } catch (e) {} }); } catch (e) {}
    return ctx;
  }
  let offlineBuild = null;   // set while the offline scenario runs
  const build = () => offlineBuild || (SERVE_ROOT === OLD ? 'old' : 'new');
  async function open(ctx, rel, opts) {
    opts = opts || {};
    const page = await ctx.newPage();
    const errors = [];
    const b = build();
    page.on('pageerror', e => { errors.push(String(e.message)); pageErrors.push({ build: b, page: rel, msg: String(e.message) }); });
    page.on('dialog', d => {
      dialogs.push({ build: b, page: rel, type: d.type(), msg: d.message().replace(/\s+/g, ' ').slice(0, 220) });
      (opts.accept ? d.accept() : d.dismiss()).catch(() => {});
    });
    await page.goto((opts.origin || base) + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(opts.settle || 1800);
    return { page, errors };
  }
  // kind: 'admin' | 'adminStaff' | 'instructor' | 'student' (the login cards).
  async function signIn(page, user, pass, kind) {
    kind = kind || 'admin';
    const handler = { admin: 'handleAdminClick', adminStaff: 'handleAdminStaffClick', instructor: 'handleInstructorClick', student: 'handleStudentClick' }[kind];
    const box = { admin: 'adminLogin', adminStaff: 'adminStaffLogin', instructor: 'instructorLogin', student: 'studentLogin' }[kind];
    await page.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(async (a) => { if (!document.getElementById(a.box).classList.contains('active')) await window[a.handler](); }, { box, handler });
    await page.fill('#' + kind + 'User', user); await page.fill('#' + kind + 'Pass', pass);
    await page.evaluate(async (h) => { await window[h](); }, handler);
    await page.waitForTimeout(1200);
    return page.evaluate(() => ({ role: currentRole, shell: document.getElementById('appShell').classList.contains('active'),
      forced: !!(document.getElementById('forceChangePwModal') && document.getElementById('forceChangePwModal').classList.contains('active')),
      student: (typeof currentStudent !== 'undefined' && currentStudent) ? currentStudent.id : null,
      instructor: (typeof currentInstructor !== 'undefined' && currentInstructor) ? currentInstructor.name : null }));
  }
  async function frameOf(page, re, ms) {
    for (let i = 0; i < (ms || 60); i++) {
      const f = page.frames().find(fr => re.test(fr.url()));
      if (f) { try { await f.waitForLoadState('load'); } catch (e) {} await page.waitForTimeout(1200); return f; }
      await page.waitForTimeout(100);
    }
    return null;
  }
  const env = { base, open, signIn, newCtx, frameOf, pageErrors, dialogs, setOfflineBuild: b => { offlineBuild = b; } };
  try {
    // Development switches: UPGRADE_ONLY_OFFLINE / UPGRADE_ONLY_DRIVE run one
    // scenario; UPGRADE_S0=<file> starts the online scenario from a kept
    // snapshot; UPGRADE_SKIP_OFFLINE / UPGRADE_SKIP_DRIVE leave one out.
    const only = process.env.UPGRADE_ONLY_OFFLINE ? 'offline' : process.env.UPGRADE_ONLY_DRIVE ? 'drive' : '';
    if (!only) {
      let S0, ctx = null;
      if (process.env.UPGRADE_S0) {
        S0 = JSON.parse(fs.readFileSync(process.env.UPGRADE_S0, 'utf8'));
        note('using the old-build snapshot in ' + process.env.UPGRADE_S0 + ' instead of seeding');
      } else {
        section('OLD build (' + OLD_REF + '): seeding a whole Centre through the old pages');
        SERVE_ROOT = OLD;
        ctx = await newCtx();
        S0 = (await seedOldCentre(env, ctx, base, 'online', false)).S0;
      }
      await upgradePhase(Object.assign({ S0, ctx }, env));
    }
    if ((!only && !process.env.UPGRADE_SKIP_OFFLINE) || only === 'offline') await offlinePhase(env);
    if ((!only && !process.env.UPGRADE_SKIP_DRIVE) || only === 'drive') await drivePhase(env);
    reportDialogsAndErrors(env);
  } catch (e) {
    failed++;
    failures.push('harness: ' + (e && e.stack || e));
    console.log(e && e.stack || e);
  } finally {
    await browser.close();
    srv.close();
    if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }
    else console.log('\nkept: ' + TMP);
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) { console.log('Failures:'); failures.forEach(f => console.log('  - ' + f.slice(0, 300))); }
  process.exit(failed ? 1 : 0);
})();
