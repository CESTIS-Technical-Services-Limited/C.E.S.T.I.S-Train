/* The trainee gate on the Centre's own server, and the staff-only switch.

   What is true today on the Centre's network (DESIGN.md §1.1, §6): any device
   that opens the system can ask /_cestis/token for the records token, and
   with it read and rewrite every file in the data folder — every account's
   password check, every trainee's results, the answer keys. A trainee's
   device that opens the dashboard holds the whole store.

   Stage 6a gives the Centre's server the trainee gate (Offline System/
   cestis-offline-gate.js, at /_cestis/gate) — the same requests and the same
   rules (CESTISCore.gate) as the online one — and an administrator's switch,
   off unless turned on, that keeps the records token for staff.

   Pinned here, against the REAL cestis-offline-server.js on a scratch data
   folder (CESTIS_DATA_DIR / CESTIS_CERT_DIR), with a Centre whose exams are
   open, closed and still to come by the real clock:
     - every request the gate answers: health and the administrator's check
       page; the password challenge (PBKDF2 and the older hash; an unknown
       login gets a salt like any other); wrong passwords, a spent challenge,
       lockout; pending, default-password and not-yet-linked accounts; two-step
       codes and backup codes (each once only, the backup code then marked
       used in the records); pull (own records only, no answer keys); the
       paper only while the exam is open, only for the trainee's own
       programme; attempt.get; deliver; review (right answers only once
       released); room.get; sign-out; and 'not-available' for what needs the
       internet — every answer in the shapes the online gate
       (trainee-gate/Gate.gs) gives, so one client talks to both;
     - the rules both gates must keep alike (the accounts index, which
       account a login names, when a right password still may not sign in,
       the two-step methods and ticket, the credential version inside a
       session id): Core.gate's pure functions, which this server's gate
       calls — it no longer carries a copy of its own;
     - a delivery is MERGED into the data file by the record rules, with the
       previous version kept in data/.history, a device's save at the same
       moment kept too, and nothing else in the file touched;
     - a test is marked from the key (points the trainee's copy claims are
       ignored); one result per attempt, however often and from however many
       devices it is submitted; answers after the window are kept and
       flagged late;
     - another trainee's student ID, another account's seal, a tampered seal
       and an item older than 60 days are refused;
     - a password change ends the old session: its token and its items are
       answered 'revoked';
     - the switch OFF: /_cestis/token and the records exactly as before;
     - the switch ON: the token is replaced; a trainee's device cannot get it
       nor read the records with the old one; a member of staff signing in
       with a password the server checks gets it; it survives a restart; only
       an administrator can change it; a data folder with no staff login is
       never locked out; turning it off replaces the token again.

   Run: node tests/gate-lan.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const nodeCrypto = require('crypto');
const { spawn } = require('child_process');
const Core = require('../cestis-core.js');
const { crypto, questionBank, pbkdf2 } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const G = Core.gate, X = Core.exams;
const MIN = 60000, DAY = 86400000;
const iso = ms => new Date(ms).toISOString();

const OFF = path.join(__dirname, '..', 'Offline System');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-gate-lan-'));
const DATA = path.join(tmp, 'data'), CERT = path.join(tmp, 'cert');
const LMS = path.join(DATA, 'CESTIS_LMS_Dashboard.json');
const PORT = 10000 + Math.floor(Math.random() * 2000);

/* ------------------------------------------------------------ the server */
let server = null;
async function start(dataDir, certDir) {
  server = spawn(process.execPath, ['cestis-offline-server.js'], {
    cwd: OFF, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: dataDir || DATA,
      CESTIS_CERT_DIR: certDir || CERT })
  });
  server.stdout.on('data', () => {}); server.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 80; i++) {
    await wait(100);
    const h = await req('/_cestis/health');
    if (h.status === 200) return;
  }
  throw new Error('the offline server did not start');
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  await new Promise(r => { s.on('exit', r); s.kill(); });
}
function req(p, o) {
  o = o || {};
  return new Promise(resolve => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: o.method || 'GET', headers: o.headers || {} }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body, json });
      });
    });
    r.on('error', e => resolve({ status: 0, headers: {}, body: '', json: null, error: e.message }));
    if (o.body) r.write(o.body);
    r.end();
  });
}
const gate = body => req('/_cestis/gate', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
  .then(r => r.json || { status: r.status });

/* ------------------------------------------------------------ the Centre */
const OFFSET = '-05:00';
const T0 = Date.now();
const P1 = 'Welding and Fabrication Level 2', P2 = 'Electrical Installation Level 2';
function trainee(n, first, last, course, password, extra) {
  const s = { id: null, name: first + ' ' + last, course, stage: 'training', email: first.toLowerCase() + '.' + last.toLowerCase() + '@mail.test',
    instructor: 'Instructor Teachwell', lastModified: iso(T0 - 10 * DAY) };
  s.id = Core.stableStudentId(s);
  const salt = nodeCrypto.createHash('md5').update('salt' + n).digest('hex');
  const acct = Object.assign({ id: 'USR-T0' + n, name: s.name, role: 'student', username: first.toLowerCase() + '0' + n, email: s.email,
    programme: course, status: 'active', studentDataId: s.id, createdAt: iso(T0 - 60 * DAY), updatedAt: iso(T0 - 30 * DAY),
    password: pbkdf2(password, salt, 1000) }, extra || {});
  return { stu: s, acct, pw: password, login: acct.username };
}
const K = trainee(1, 'Kemar', 'Williams', P1, 'pw-kemar');
const TM = trainee(2, 'Tameka', 'Richards', P1, 'pw-tameka', {
  password: nodeCrypto.createHash('sha256').update('pw-tameka__CESTIS_SALT_2026__').digest('hex'),
  twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP', twoFactorUpdatedAt: iso(T0 - 20 * DAY),
  backupCodes: [{ code: 'BCK-ONE', used: false }, { code: 'BCK-TWO', used: false }] });
const R = trainee(3, 'Rushane', 'Grant', P2, 'pw-rushane');
const SH = trainee(4, 'Shanique', 'Campbell', P1, 'pw-shanique');
const OD = trainee(5, 'Odalys', 'Lindo', P1, 'pw-odalys', { defaultPassword: true });
const pending = { id: 'USR-PEND', name: 'Pendleton Waitingly', role: 'student', status: 'pending', username: 'pend', email: 'pend@mail.test',
  programme: P1, password: pbkdf2('pw-pend', 'aa', 1000) };
const unlinked = { id: 'USR-LOST', name: 'Nobody Enrolled', role: 'student', status: 'active', username: 'lost', email: 'lost@mail.test',
  programme: P1, password: pbkdf2('pw-lost', 'bb', 1000) };
const admin = { id: 'USR-ADMIN1', name: 'Marcia Administrator', role: 'admin', username: 'admin1', email: 'admin1@centre.test', status: 'active',
  password: pbkdf2('Admin-Pass-1', '00112233445566778899aabbccddeeff', 1000) };
const instructor = { id: 'USR-INS1', name: 'Instructor Teachwell', role: 'instructor', username: 'ins1', email: 'ins1@centre.test', status: 'active',
  programme: P1, password: pbkdf2('Teach-Pass-1', '0011223344556677', 1000) };

function exam(id, course, startMs, duration, extra) {
  const p = X.centreParts(startMs, OFFSET);
  return Object.assign({ id, title: id + ' theory', course, date: p.date, time: p.time, duration, passMark: 60, status: 'upcoming',
    questionsPerPage: 3, shuffleQuestions: true, shuffleOptions: true, answersRelease: 'after-close', questionData: questionBank(id),
    questions: 8, updatedAt: iso(T0 - DAY) }, extra || {});
}
const EXAMS = [
  exam('EX-OPEN', P1, T0 - 20 * MIN, 90),                        // open now, for 70 more minutes
  exam('EX-CLOSED', P1, T0 - 100 * MIN, 60),                     // closed 40 minutes ago
  exam('EX-SOON', P1, T0 + 60 * MIN, 60),                        // not open yet
  exam('EX-ELEC', P2, T0 - 20 * MIN, 90),                        // open, another programme's
  exam('EX-OLD', P1, T0 - 30 * DAY, 60, { status: 'completed' }) // long closed: answers released
];
const byExam = {};
EXAMS.forEach(e => { byExam[e.id] = e; });
function rightAnswer(q) {
  return { mcq: 0, tf: false, multi: [0, 2], match: ['Grinder', 'Torch'], shortanswer: 'Flashback Arrestor', numerical: '108', fill: 'butt' }[q.type] ||
    (q.type === 'info' ? null : 'I keep the workshop tidy.');
}
function oldResult(t, id) {
  const qs = X.attemptQuestions(byExam['EX-OLD'].questionData, {});
  const m = X.mark(qs, qs.map(rightAnswer), byExam['EX-OLD'].questionData);
  return { id, examId: 'EX-OLD', studentId: t.stu.id, studentName: t.stu.name, answers: m.gradedResults, score: 80,
    totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: true, submittedAt: iso(T0 - 30 * DAY + 50 * MIN) };
}
// Kemar started the test that has since closed, and his answers were saved while it was open.
const closedQs = X.attemptQuestions(byExam['EX-CLOSED'].questionData, {});
const closedAttempt = { id: 'ATT-K-CLOSED', examId: 'EX-CLOSED', studentId: K.stu.id, studentName: K.stu.name, accountId: K.acct.id,
  questions: closedQs, answers: closedQs.map(rightAnswer), flagged: closedQs.map(() => false), answeredAt: closedQs.map(() => T0 - 70 * MIN),
  flaggedAt: closedQs.map(() => 0), startTime: T0 - 95 * MIN, deadline: T0 - 40 * MIN, status: 'open', updatedAt: iso(T0 - 70 * MIN) };

const CHAT = 'chat-class-101', DM_PEER = 'dm-' + [K.acct.id, R.acct.id].sort().join('-');
const STORE = {
  voctrain_users: [admin, instructor, K.acct, TM.acct, R.acct, SH.acct, OD.acct, pending, unlinked],
  voctrain_students: [K.stu, TM.stu, R.stu, SH.stu, OD.stu],
  voctrain_skillAreas: [{ id: 101, name: P1, icon: 'x' }, { id: 102, name: P2, icon: 'x' }],
  voctrain_exams: EXAMS,
  voctrain_examResults: [oldResult(K, 'RES-OLD-K'), oldResult(R, 'RES-OLD-R')],
  voctrain_examAttempts: [closedAttempt],
  voctrain_assignments: [{ id: 'ASG-1', title: 'Project 1', course: P1, dueDate: '2030-01-01', maxPoints: 10,
    grades: { [K.stu.id]: 7, [TM.stu.id]: 9 }, feedback: { [TM.stu.id]: 'Lovely work Tameka' }, updatedAt: iso(T0 - 2 * DAY) }],
  voctrain_submissions: [],
  voctrain_announcements: [
    { id: 'AN-1', title: 'Welding safety week', body: 'Bring goggles.', course: P1, forRoles: ['student'], date: '2026-11-01', readBy: [TM.acct.id], updatedAt: iso(T0 - DAY) },
    { id: 'AN-2', title: 'Electrical exam room', body: 'Room 4.', course: P2, forRoles: ['student'], date: '2026-11-01', updatedAt: iso(T0 - DAY) }],
  voctrain_notifications: [{ id: 'N-ALL', text: 'Centre closed Friday', forRoles: ['admin', 'instructor', 'student'], timestamp: T0 - DAY, readBy: [] }],
  voctrain_calendarEvents: [],
  voctrain_chatRooms: [
    { id: CHAT, name: P1, icon: 'x', type: 'class', skillAreaId: 101, members: [K.acct.id, TM.acct.id, instructor.id], removed: {} },
    { id: DM_PEER, name: 'Direct Message', type: 'dm', members: [K.acct.id, R.acct.id].sort() }],
  voctrain_chatMessages: { [CHAT]: [{ id: 'msg-1', roomId: CHAT, senderId: TM.acct.id, senderName: TM.stu.name, text: 'Hello class', type: 'text',
    timestamp: iso(T0 - 10 * MIN), readBy: [TM.acct.id] }], [DM_PEER]: [{ id: 'msg-peer', roomId: DM_PEER, senderId: R.acct.id, text: 'secret', timestamp: iso(T0 - MIN) }] },
  voctrain_studentProfiles: { [K.acct.id]: { name: K.stu.name, phone: '876-555-1001', updatedAt: iso(T0 - 9 * DAY) } },
  voctrain_certTranscriptRequests: [],
  voctrain_support_messages: [],
  voctrain_systemSettings: { institutionName: 'C.E.S.T.I.S Training Centre', centreUtcOffset: OFFSET, maintenanceMode: false },
  voctrain_deletedUserIds: [], voctrain_deletedStudentIds: []
};
function writeCentre(file, store) {
  const data = {}, stamps = {};
  Object.keys(store).forEach(k => { data[k] = JSON.stringify(store[k]); stamps[k] = iso(T0 - 5 * MIN); });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json', savedAt: iso(T0 - 5 * MIN),
    savedBy: 'office-pc', keyCount: Object.keys(data).length, stamps, data }));
}
const lms = () => JSON.parse(fs.readFileSync(LMS, 'utf8'));
const col = k => { const v = lms().data[k]; return v ? JSON.parse(v) : null; };
const historyCount = () => { try { return fs.readdirSync(path.join(DATA, '.history', 'CESTIS_LMS_Dashboard.json')).length; } catch (e) { return 0; } };

/* ------------------------------------------------------------ the device */
async function signIn(login, password) {
  const ch = await gate({ op: 'auth.start', login });
  if (!ch.ok) return ch;
  const V = ch.algo === 'pbkdf2-sha256'
    ? nodeCrypto.pbkdf2Sync(password, Buffer.from(ch.salt, 'hex'), ch.iter, 32, 'sha256').toString('hex')
    : nodeCrypto.createHash('sha256').update(password + '__CESTIS_SALT_2026__').digest('hex');
  return gate({ op: 'auth.password', login, nonce: ch.nonce, proof: G.proof.make(V, ch.nonce, login, crypto) });
}
let seq = 0;
function item(sess, fields) {
  return G.seal(Object.assign({ id: 'IT-' + (++seq), a: sess.account.id, sid: sess.sid, createdAt: new Date().toISOString() }, fields), sess.sessionKey, crypto);
}
const deliver = items => gate({ op: 'deliver', items }).then(r => r.receipts || r);
function attemptFrom(paper, id, answered) {
  const qs = X.attemptQuestionsFromPaper(paper.questions, { shuffleQuestions: true, shuffleOptions: true });
  const now = Date.now();
  return { id, examId: paper.examId, studentId: K.stu.id, studentName: K.stu.name, questions: qs,
    answers: qs.map((q, i) => (answered(i) ? rightAnswer(q) : null)), flagged: qs.map(() => false),
    answeredAt: qs.map((q, i) => (answered(i) ? now : 0)), flaggedAt: qs.map(() => 0),
    startTime: now - 5 * MIN, deadline: now + 60 * MIN, status: 'open', updatedAt: iso(now) };
}
const NAMES = [TM, R, SH].map(t => [t.acct.id, t.stu.id, t.stu.name, t.stu.email]).reduce((a, b) => a.concat(b), []);
const KEYS = ['correctAnswer', 'pairs', 'distractors', 'tolerance'];

(async () => {
  /* ---------------------------------------------------------- the shared rules
     (Core.gate: what trainee-gate/Gate.gs decides too. The server's module
     used to carry its own copy of them; now both gates call these.) */
  console.log('The rules both gates keep alike (Core.gate, called by both)');
  {
    const lanSrc = fs.readFileSync(path.join(OFF, 'cestis-offline-gate.js'), 'utf8');
    assert(!('rules' in require(path.join(OFF, 'cestis-offline-gate.js'))) && !/TODO\(core\)/.test(lanSrc),
      'the server\'s gate carries no copy of its own any more');
    assert(['indexAccounts', 'lookupLogin', 'credentialRefusal', 'twoStep', 'ticketMake', 'ticketRead', 'sidRand', 'sidCv']
      .every(f => new RegExp('\\bG\\.' + f + '\\(').test(lanSrc)), 'it calls Core.gate\'s');
    const rules = G;
    const twin = Object.assign({}, K.acct, { password: '', status: 'disabled', updatedAt: iso(T0 - 99 * DAY) });   // a copy that cannot sign in
    const idx = rules.indexAccounts([admin, K.acct, twin, TM.acct, pending, Object.assign({}, R.acct, { username: 'shared' }),
      Object.assign({}, SH.acct, { username: 'shared' }), Object.assign({}, OD.acct, { id: 'USR-GONE' })], ['USR-GONE'], crypto);
    assertEq([idx.n, Object.keys(idx.a).sort()], [5, [K.acct.id, TM.acct.id, R.acct.id, SH.acct.id, 'USR-PEND'].sort()],
      'the index: trainee accounts only, deleted ones dropped, one per account id');
    assertEq([idx.a[K.acct.id].st, idx.a[K.acct.id].pw, idx.a[K.acct.id].cv], ['ok', K.acct.password, G.cv(K.acct, crypto)],
      'of two copies of one account, the one that can sign in');
    assertEq([idx.a[TM.acct.id].tf, idx.a[TM.acct.id].bc, idx.a['USR-PEND'].st], ['JBSWY3DPEHPK3PXP', ['BCK-ONE', 'BCK-TWO'], 'pending'],
      'with its two-step secret, its unused backup codes, and why it may not sign in');
    assertEq(rules.lookupLogin(idx, ' KEMAR01 ').id, K.acct.id, 'a login is a username, any case');
    assertEq(rules.lookupLogin(idx, TM.acct.email.toUpperCase()).id, TM.acct.id, 'or an email');
    assertEq(rules.lookupLogin(idx, 'nobody'), { none: true }, 'nobody: none');
    const both = rules.lookupLogin(idx, 'shared');
    assertEq(both, { ambiguous: true }, 'two accounts that can both sign in behind one login: the office must sort it out');
    const idx2 = rules.indexAccounts([Object.assign({}, R.acct, { username: 'shared' }), Object.assign({}, SH.acct, { username: 'shared', status: 'disabled' })], [], crypto);
    assertEq(rules.lookupLogin(idx2, 'shared').id, R.acct.id, '— but when only one of them can, that one');
    assertEq(rules.credentialRefusal({ st: 'pending' }, 'password'), { error: 'pending' }, 'a right password still: pending is refused as pending');
    assertEq(rules.credentialRefusal({ st: 'ok', sd: 1 }, 'password'), { error: 'ask-office', why: 'default-password' }, 'a published default: ask the office');
    assertEq(rules.credentialRefusal({ st: 'no-password' }, 'email'), null, 'an account with no password may use its email account');
    assertEq(rules.credentialRefusal({ st: 'ok', sd: 0 }, 'password'), null, 'an ordinary account goes on');
    assertEq(rules.twoStep({ tf: 'X', eo: 1 }, ['C1'], true), { needed: true, methods: ['totp', 'backup', 'email'] }, 'two-step: authenticator, backup codes, email');
    assertEq(rules.twoStep({ tf: '', eo: 1 }, [], false), { needed: true, methods: [] }, 'email codes where none can be sent: nothing to finish with');
    assertEq(rules.twoStep({ tf: '', eo: 0 }, ['C1'], true), { needed: false, methods: ['backup'] }, 'backup codes alone do not ask for a second step');
    let asked = 0;
    const codes = () => { asked++; return ['C1']; };
    assertEq([rules.twoStep({ tf: '', eo: 0 }, codes, true).needed, asked], [false, 0], 'the spent codes are not even read when no second step is needed');
    assertEq([rules.twoStep({ tf: 'X', eo: 0 }, codes, true).methods, asked], [['totp', 'backup'], 1], 'and read once when one is');
    const secret = 'ab'.repeat(32);
    const tk = rules.ticketMake({ a: 'USR-X', cv: 'cv1', exp: T0 + 60000, m: ['totp'], via: 'password', n: 'n1' }, secret, crypto);
    assert(/^t2\.[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(tk), 'a ticket is t2.<claims>.<HMAC hex>');
    const back = rules.ticketRead(tk, secret, crypto, T0);
    assertEq([back.a, back.cv, back.m, back.via, back.mac], ['USR-X', 'cv1', ['totp'], 'password', tk.split('.')[2].slice(0, 32)], 'and reads back, named by its mac');
    assertEq(rules.ticketRead(tk, secret, crypto, T0 + 60000).error, 'expired', 'until it runs out');
    assertEq(rules.ticketRead(tk, 'cd'.repeat(32), crypto, T0).error, 'bad-ticket', 'and only with the secret that made it');
    const sid = G.sid.make(T0, rules.sidRand('0123456789ab', 'feedfacecafe'), secret, crypto);
    assertEq([rules.sidCv(sid), rules.sidCv('nonsense')], ['0123456789ab', ''], 'a session id carries the credential version, sealed');
  }

  writeCentre(LMS, STORE);
  await start();
  try {
    /* ---------------------------------------------------------- health */
    console.log('The gate answers on the Centre\'s server, and says what it is');
    const h = (await req('/_cestis/gate')).json || {};
    assertEq([h.ok, h.service, h.version, h.protocol, h.accepting, h.staffOnly], [true, 'cestis-trainee-gate', 2, [1], true, false],
      'GET /_cestis/gate is the gate\'s health answer, accepting, switch off');
    assertEq([h.ready.secret, h.ready.ledger, h.ready.trainees], [true, true, 7], 'with its secret, the records found and 7 trainee accounts');
    assert(Math.abs(Date.parse(h.time) - Date.now()) < 60000, 'and the server\'s clock');
    const hp = await gate({ op: 'health' });
    assert(hp.service === 'cestis-trainee-gate' && hp.ok, 'POST {op:"health"} answers the same');
    const page = await req('/_cestis/gate?op=selfcheck');
    assert(page.status === 200 && /text\/html/.test(page.headers['content-type']) && /✓ Self-test: token/.test(page.body) &&
      /Records ready for 5 of 7/.test(page.body), 'the administrator\'s check page has ✓ lines and counts');
    assert(NAMES.concat([K.stu.name, K.acct.id]).every(n => page.body.indexOf(n) === -1), 'and no names or ids');
    const secret = fs.readFileSync(path.join(CERT, 'gate-secret'), 'utf8').trim();
    assert(/^[a-f0-9]{64}$/.test(secret), 'sessions are signed with cert/gate-secret, made on first run');
    if (process.platform !== 'win32') assert((fs.statSync(path.join(CERT, 'gate-secret')).mode & 0o777) === 0o600, 'readable by its owner only');
    assert((await req('/cert/gate-secret')).status === 403, 'and never served');
    assert((await req('/_cestis/gate', { headers: { Host: 'evil.example:' + PORT } })).status === 421,
      'the gate answers only at the server\'s own names, like the rest of /_cestis/');
    assert((await req('/_cestis/gate', { method: 'POST', body: '{nope' })).status === 400, 'a request it cannot read is a 400');
    assertEq((await gate({ op: 'frobnicate' })).error, 'unknown-op', 'an unknown request is named as such');
    assertEq((await gate({ op: 'auth.start', login: 'x', v: 2 })).error, 'client-too-old', 'a protocol it does not speak: client-too-old (as online)');
    for (const op of ['auth.email', 'auth.2fa.send', 'upload', 'file.get']) {
      assertEq((await gate({ op })).error, 'not-available', op + ' needs the internet: not-available here');
    }
    // Registration from home needs the trainee's own email account (DESIGN.md §17): never here — the office creates the account.
    for (const op of ['catalogue', 'register.start', 'register.submit']) {
      assertEq((await gate({ op, accessToken: 'ya29.anything', name: 'Shantelle Barrett', programme: 'Welding', password: 'pbkdf2$210000$' + '0'.repeat(32) + '$' + '0'.repeat(64) })).error,
        'not-available', op + ': registering from home is not available on the Centre\'s network');
    }

    /* ---------------------------------------------------------- sign-in */
    console.log('A trainee signs in with a challenge: the password never travels');
    const ch = await gate({ op: 'auth.start', login: K.login });
    const kStored = G.proof.parse(K.acct.password);
    assertEq([ch.ok, ch.algo, ch.iter, ch.salt], [true, 'pbkdf2-sha256', 1000, kStored.salt], 'the challenge names the stored salt and rounds');
    assert(/^[0-9a-f]{32}$/.test(ch.nonce), 'with a fresh nonce');
    const legacy = await gate({ op: 'auth.start', login: TM.acct.email });
    assertEq(legacy.algo, 'sha256-legacy', 'an older password check is asked for as it was stored');
    const u1 = await gate({ op: 'auth.start', login: 'nobody@nowhere.test' }), u2 = await gate({ op: 'auth.start', login: 'NOBODY@nowhere.test ' });
    assert(u1.algo === 'pbkdf2-sha256' && /^[0-9a-f]{32}$/.test(u1.salt) && u1.salt === u2.salt,
      'an unknown login gets a salt like any other, the same every time — no telling whether an account exists');
    const wrong = await gate({ op: 'auth.password', login: K.login, nonce: ch.nonce, proof: 'f'.repeat(64) });
    assertEq(wrong.error, 'no-match', 'a wrong answer: "do not match"');
    const reuse = await gate({ op: 'auth.password', login: K.login, nonce: ch.nonce, proof: 'f'.repeat(64) });
    assertEq(reuse.error, 'bad-nonce', 'and the challenge cannot be answered twice');
    const KS = await signIn(K.login, K.pw);
    assert(KS.ok && /^v1\./.test(KS.token) && /^[0-9a-f]{64}$/.test(KS.sessionKey) && KS.account.id === K.acct.id && KS.account.studentId === K.stu.id,
      'the right password: a token, a key to seal with, the account and the student ID');
    assert(KS.lane === 'L-' + KS.sid && Math.abs(Date.parse(KS.serverTime) - Date.now()) < 60000, 'its lane named as online, and the server\'s time');
    assertEq(G.sid.check(KS.sid, fs.readFileSync(path.join(CERT, 'gate-secret'), 'utf8').trim(), crypto).ok, true, 'a session id this gate made');
    assertEq(KS.sid.split('.')[1].slice(0, 12), G.cv(K.acct, crypto), 'carrying the credential version');
    assert(KS.exp - Date.now() > 11 * 3600 * 1000, 'for twelve hours');
    assertEq((await signIn(TM.acct.email.toUpperCase(), 'pw-tameka')).need2fa, true, 'by email, any case, with the older hash too');
    assertEq((await signIn('pend', 'pw-pend')).error, 'pending', 'an account awaiting approval is told so (after its password is proved)');
    assertEq((await signIn('pend', 'not-it')).error, 'no-match', '— and with the wrong password learns nothing');
    const od = await signIn(OD.login, OD.pw);
    assertEq([od.error, od.why], ['ask-office', 'default-password'], 'a password still to be changed cannot be used through the gate');
    assertEq((await signIn('lost', 'pw-lost')).error, 'not-ready', 'an account not yet linked to a trainee record: "being prepared"');
    const guesses = [];
    for (let i = 0; i < 5; i++) guesses.push((await signIn(SH.login, 'guess-' + i)).error);
    assertEq(guesses, ['no-match', 'no-match', 'no-match', 'no-match', 'no-match'], 'five wrong passwords');
    const lk = await signIn(SH.login, SH.pw);
    assertEq([lk.error, lk.retryAfter], ['locked', 900], 'and the login is locked, even to the right one, for fifteen minutes');
    let lastStart = null;
    for (let i = 0; i < 21; i++) lastStart = await gate({ op: 'auth.start', login: 'flood@nowhere.test' });
    assertEq(lastStart.error, 'locked', 'and a login asked for over twenty times in fifteen minutes waits too');

    console.log('Two-step codes, each once');
    const t1 = await signIn(TM.login, 'pw-tameka');
    assertEq([t1.need2fa, t1.methods, t1.email], [true, ['totp', 'backup'], ''], 'an account with two-step needs its code: authenticator or backup code');
    assert(!t1.token && !t1.sessionKey, 'and gets no session before it');
    const bad = await gate({ op: 'auth.2fa', ticket: t1.ticket, method: 'totp', code: '000000' });
    assertEq([bad.error, bad.triesLeft], ['bad-code', 4], 'a wrong code is refused, the tries left said');
    assertEq((await gate({ op: 'auth.2fa', ticket: t1.ticket, method: 'email', code: '123456' })).error, 'not-allowed', 'a way not offered is not allowed');
    const forged = t1.ticket.slice(0, -1) + (t1.ticket.slice(-1) === '0' ? '1' : '0');
    assertEq((await gate({ op: 'auth.2fa', ticket: forged, method: 'totp', code: '000000' })).error, 'bad-ticket', 'a tampered ticket is refused');
    const code = G.totp.code(TM.acct.twoFactorSecret, Date.now(), crypto);
    const TS = await gate({ op: 'auth.2fa', ticket: t1.ticket, method: 'totp', code });
    assert(TS.ok && TS.account.id === TM.acct.id && TS.account.studentId === TM.stu.id, 'the authenticator\'s code signs her in');
    assertEq((await gate({ op: 'auth.2fa', ticket: t1.ticket, method: 'totp', code })).error, 'bad-ticket', 'a ticket is used once');
    const t2 = await signIn(TM.login, 'pw-tameka');
    assertEq((await gate({ op: 'auth.2fa', ticket: t2.ticket, method: 'totp', code })).error, 'code-used', 'the same code cannot be used twice');
    const TB = await gate({ op: 'auth.2fa', ticket: t2.ticket, method: 'backup', code: ' bck-one ' });
    assert(TB.ok && TB.account.id === TM.acct.id, 'a backup code signs her in (case and spaces do not matter)');
    await wait(400);
    const tmAcct = col('voctrain_users').find(a => a.id === TM.acct.id);
    assert(tmAcct.backupCodes.find(c => c.code === 'BCK-ONE').used === true && tmAcct.backupCodes.find(c => c.code === 'BCK-TWO').used === false,
      'the backup code is marked used in the Centre\'s records, the other left alone');
    assert(tmAcct.password === TM.acct.password && Date.parse(tmAcct.updatedAt) > Date.parse(TM.acct.updatedAt),
      'the account stamped as the dashboard stamps it, its password untouched');
    const t3 = await signIn(TM.login, 'pw-tameka');
    assertEq((await gate({ op: 'auth.2fa', ticket: t3.ticket, method: 'backup', code: 'BCK-ONE' })).error, 'bad-code', 'and that backup code is spent');

    /* ---------------------------------------------------------- reading */
    console.log('Pull: the trainee\'s own records, built on request');
    const p1 = await gate({ op: 'pull', token: KS.token });
    const sl = p1.slice;
    assertEq([p1.h, p1.overlay, Math.abs(Date.parse(p1.serverTime) - Date.now()) < 60000], [sl && sl.hash, { lanes: [], results: [], truncated: false }, true],
      'with its hash, an empty overlay (what was sent is in the records already) and the server\'s time');
    assert(p1.ok && sl && sl.format === 'cestis-trainee-slice' && sl.accountId === K.acct.id && sl.studentId === K.stu.id, 'a slice for Kemar');
    assertEq(sl.data.voctrain_students.map(s => s.id), [K.stu.id], 'his trainee record only');
    assertEq(sl.access.papers, ['EX-CLOSED', 'EX-OLD', 'EX-OPEN', 'EX-SOON'], 'his programme\'s exams');
    assertEq(sl.access.rooms, [CHAT], 'his class room, not a conversation with another trainee');
    const sj = JSON.stringify(sl);
    assert(NAMES.every(n => sj.indexOf(n) === -1), 'no other trainee\'s id, name or email anywhere in it');
    assert(KEYS.every(k => sj.indexOf('"' + k + '"') === -1), 'and no answer key anywhere in it');
    assert(sj.indexOf('pbkdf2$') === -1 && sj.indexOf('JBSWY3DP') === -1 && sj.indexOf('BCK-') === -1, 'nor any password check, secret or backup code');
    const same = await gate({ op: 'pull', token: KS.token, have: sl.hash });
    assertEq([same.ok, same.same, same.h, !!same.slice], [true, true, sl.hash, false], 'asked again with its hash: "the same", nothing resent');
    assertEq((await gate({ op: 'pull', token: KS.token.slice(0, -2) + '00' })).error, 'bad-token', 'a token that was tampered with is refused');

    console.log('The paper: own programme, only while open, never a key');
    const pg = await gate({ op: 'paper', token: KS.token, examId: 'EX-OPEN' });
    assertEq(pg.centreUtcOffset, OFFSET, 'with the Centre\'s time zone');
    assert(pg.ok && pg.paper && pg.paper.format === 'cestis-exam-paper' && pg.paper.questions.length === 9, 'the open exam\'s paper');
    assert(KEYS.every(k => JSON.stringify(pg.paper).indexOf('"' + k + '"') === -1), 'with no answer key in it');
    const soon = await gate({ op: 'paper', token: KS.token, examId: 'EX-SOON' });
    assertEq([soon.error, soon.status], ['not-open', 'upcoming'], 'an exam not open yet: not-open (by the server\'s clock)');
    const shut = await gate({ op: 'paper', token: KS.token, examId: 'EX-CLOSED' });
    assertEq([shut.error, shut.status], ['not-open', 'completed'], 'nor a closed one');
    assertEq((await gate({ op: 'paper', token: KS.token, examId: 'EX-ELEC' })).error, 'unknown-exam', 'another programme\'s exam: unknown');
    assertEq((await gate({ op: 'attempt.get', token: KS.token, examId: 'EX-ELEC' })).error, 'unknown-exam', 'and its attempts are not asked about');
    assertEq((await gate({ op: 'attempt.get', token: KS.token, examId: 'EX-OPEN' })).state, 'none', 'no attempt yet');
    assertEq((await gate({ op: 'attempt.get', token: KS.token, examId: 'EX-CLOSED' })).state, 'attempt', 'the closed exam\'s saved attempt is found');

    /* ---------------------------------------------------------- delivering */
    console.log('What a trainee sends is merged into the Centre\'s records file');
    const before = lms(), hist0 = historyCount();
    const att1 = attemptFrom(pg.paper, 'ATT-K-OPEN', i => i % 2 === 0);
    att1.gateFirstSeen = '2001-01-01T00:00:00.000Z';      // whatever a device claims, the server dates it
    const sent = [
      item(KS, { kind: 'rec', key: 'voctrain_examAttempts', rec: att1 }),
      item(KS, { kind: 'rec', key: 'voctrain_submissions', rec: { id: 'SUB-K-1', assignmentId: 'ASG-1', studentId: K.stu.id, comment: 'Done',
        submittedAt: new Date().toISOString(), grade: 10, feedback: 'I gave myself full marks' } }),
      item(KS, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-K-1', subject: 'Login', message: 'Please help', timestamp: Date.now() } }),
      item(KS, { kind: 'rec', key: 'voctrain_studentProfiles', recId: K.acct.id, rec: { name: 'Kemar A. Williams', phone: '876-555-9999', updatedAt: new Date().toISOString() } }),
      item(KS, { kind: 'rec', key: 'voctrain_chatMessages', rec: { id: 'msg-k-1', roomId: CHAT, senderId: K.acct.id, text: 'Morning all', type: 'text', timestamp: new Date().toISOString() } }),
      item(KS, { kind: 'rec', key: 'voctrain_certTranscriptRequests', rec: Object.assign(Core.Transcript.newRequest({ studentId: K.stu.id, studentName: K.stu.name,
        course: P1, type: 'transcript', requestedAt: new Date().toISOString() }), { id: 'REQ-K-1', accountId: K.acct.id }) }),
      item(KS, { kind: 'op', op: { id: 'OP-1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-1', at: new Date().toISOString() } }),
      item(KS, { kind: 'op', op: { id: 'OP-2', kind: 'read', key: 'voctrain_chatMessages', roomId: CHAT, at: new Date().toISOString() } })
    ];
    // A staff device saving the calendar at the same moment.
    const TOKEN = (await req('/_cestis/token')).json.token;
    const devicePut = req('/_cestis/data/CESTIS_LMS_Dashboard.json', { method: 'PUT', headers: { 'X-CESTIS-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json', savedBy: 'office-pc',
        stamps: { voctrain_calendarEvents: new Date().toISOString() },
        data: { voctrain_calendarEvents: JSON.stringify([{ id: 'CE-NEW', title: 'Graduation', date: '2030-12-15', forRoles: ['student'] }]) } }) });
    const [rs] = await Promise.all([deliver(sent), devicePut]);
    assert(Array.isArray(rs) && rs.length === 8 && rs.every(r => r.ok), 'every item is accepted — ' + JSON.stringify(rs));
    assertEq(rs.map(r => r.id), sent.map(s => s.id), 'answered item by item, by id');
    const atts = col('voctrain_examAttempts');
    const kOpen = atts.find(a => a.id === 'ATT-K-OPEN');
    assert(kOpen && kOpen.status === 'open' && kOpen.accountId === K.acct.id, 'the attempt is in the records file');
    assert(kOpen && Math.abs(Date.parse(kOpen.gateFirstSeen) - Date.now()) < 60000, 'dated by the server when it first saw it, not by the device');
    assert(atts.some(a => a.id === 'ATT-K-CLOSED'), 'beside the attempt already there');
    const sub = col('voctrain_submissions').find(s => s.id === 'SUB-K-1');
    assert(sub && sub.studentName === K.stu.name && sub.grade === undefined && sub.feedback === undefined, 'the submission, without the grade it gave itself');
    assert(col('voctrain_support_messages').some(m => m.id === 'SUP-K-1' && m.accountId === K.acct.id && m.studentId === K.stu.id), 'the support message, as his');
    const prof = col('voctrain_studentProfiles')[K.acct.id];
    assert(prof.phone === '876-555-9999' && prof.name === K.stu.name && prof.requestedName === 'Kemar A. Williams',
      'his profile: the phone changed, a new name only asked for');
    const room = col('voctrain_chatMessages')[CHAT];
    assert(room.some(m => m.id === 'msg-k-1' && m.senderName === K.stu.name) && room.find(m => m.id === 'msg-1').readBy.indexOf(K.acct.id) !== -1,
      'his chat message is in the room, and the class message marked read by him');
    assert(col('voctrain_certTranscriptRequests').some(r => r.id === 'REQ-K-1' && r.status === 'pending'), 'his transcript request, pending');
    const an1 = col('voctrain_announcements').find(a => a.id === 'AN-1');
    assertEq(an1.readBy.slice().sort(), [K.acct.id, TM.acct.id].sort(), 'the notice marked read by him, the other reader kept');
    assert(col('voctrain_calendarEvents').some(e => e.id === 'CE-NEW'), 'the staff device\'s save at the same moment landed too');
    const after = lms();
    ['voctrain_students', 'voctrain_users', 'voctrain_exams', 'voctrain_examResults', 'voctrain_assignments', 'voctrain_systemSettings'].forEach(k => {
      assert(after.data[k] === before.data[k], 'nothing else in the file changed: ' + k);
    });
    assertEq([after.page, after.file, after.version], ['LMS Dashboard', 'CESTIS_LMS_Dashboard.json', '1.0'], 'and the file still says what it is');
    assert(historyCount() >= hist0 + 2, 'the versions it replaced are kept in data/.history (' + hist0 + ' → ' + historyCount() + ')');
    const again = await deliver([sent[2]]);
    assertEq([again[0].ok, again[0].dup], [true, true], 'the same support message delivered again is acknowledged, not taken twice');
    assertEq(col('voctrain_support_messages').filter(m => m.id === 'SUP-K-1').length, 1, '— still one');
    const resumed = await gate({ op: 'attempt.get', token: KS.token, examId: 'EX-OPEN' });
    assert(resumed.state === 'attempt' && resumed.attempt.id === 'ATT-K-OPEN' && resumed.attempt.answers.filter(a => a !== null).length === 4,
      'attempt.get finds the saved attempt, with its answers, for another device to carry on');

    console.log('What is not theirs is refused');
    const foreign = await deliver([
      item(KS, { kind: 'rec', key: 'voctrain_submissions', rec: { id: 'SUB-X', assignmentId: 'ASG-1', studentId: R.stu.id, submittedAt: new Date().toISOString() } }),
      item(KS, { kind: 'rec', key: 'voctrain_examResults', rec: { id: 'RES-FAKE', examId: 'EX-OPEN', studentId: K.stu.id, score: 100 } }),
      item(KS, { kind: 'rec', key: 'voctrain_examAttempts', rec: Object.assign(attemptFrom(pg.paper, 'ATT-R', () => true), { studentId: R.stu.id }) }),
      G.seal({ id: 'IT-AS-TAMEKA', a: TM.acct.id, sid: KS.sid, kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-T', message: 'x' } }, KS.sessionKey, crypto),
      Object.assign(item(KS, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-TAMPER', message: 'x' } }), { kind: 'rec', key: 'voctrain_users' }),
      item(KS, { kind: 'op', op: { id: 'OP-BC', kind: 'backupCodeUsed', codeHash: G.codeHash('BCK-TWO') } })
    ]);
    assertEq(foreign.map(r => r.reason), ['not-yours', 'not-yours', 'not-yours', 'revoked', 'bad-seal', 'not-yours'],
      'another trainee\'s student ID, a result, their attempt, another account under this session, a tampered item, a spent-code claim');
    assert(!col('voctrain_submissions').some(s => s.id === 'SUB-X') && !col('voctrain_examResults').some(r => r.id === 'RES-FAKE'),
      'and none of them reached the records');
    // An item from a session sixty-one days old (sealed as that session would have sealed it).
    const oldSid = G.sid.make(Date.now() - 61 * DAY, G.cv(K.acct, crypto) + 'abcdef123456', secret, crypto);
    const stale = G.seal({ id: 'IT-OLD', a: K.acct.id, sid: oldSid, kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-OLD', message: 'x' } },
      G.sessionKey(secret, K.acct.id, oldSid, crypto), crypto);
    assertEq((await deliver([stale]))[0].reason, 'expired', 'an item older than sixty days is refused (and stays on its device)');

    console.log('A test is marked here, from the key, once');
    const full = attemptFrom(pg.paper, 'ATT-K-OPEN', () => true);
    full.questions.forEach(q => { q.points = 1000; q.text = 'easy'; });     // the copy claims a thousand marks a question
    const keyFile = G.buildKey(byExam['EX-OPEN'], OFFSET);
    const want = G.markAttempt(full, keyFile, Date.now(), { crypto, receivedAt: Date.now() }).result;
    const sub1 = (await deliver([item(KS, { kind: 'submit', attempt: full })]))[0];
    assert(sub1.ok && sub1.result && sub1.result.id === G.resultId('ATT-K-OPEN', crypto), 'submitted: a result with the id its attempt gives it');
    assertEq([sub1.result.score, sub1.result.earnedPoints, sub1.result.totalPoints, sub1.result.markedBy],
      [want.score, want.earnedPoints, want.totalPoints, 'gate'], 'marked from the key: the points the copy claimed changed nothing');
    assert(sub1.result.totalPoints < 100 && !sub1.result.late, 'its real total, and on time');
    assert(KEYS.every(k => JSON.stringify(sub1.result).indexOf('"' + k + '"') === -1), 'the answer comes back without the right answers');
    const mine = () => col('voctrain_examResults').filter(r => r.studentId === K.stu.id && r.examId === 'EX-OPEN');
    assertEq(mine().map(r => r.id), [sub1.result.id], 'the records hold the result');
    assert(col('voctrain_examAttempts').find(a => a.id === 'ATT-K-OPEN').status === 'submitted', 'and the attempt is retired');
    const sub2 = (await deliver([item(KS, { kind: 'submit', attempt: full })]))[0];
    assert(sub2.ok && sub2.result.id === sub1.result.id, 'submitted again: the same result');
    const other = (await deliver([item(KS, { kind: 'submit', attempt: attemptFrom(pg.paper, 'ATT-K-OTHER-PC', () => false) })]))[0];
    assert(other.ok && other.result && other.result.id === sub1.result.id, 'from another PC\'s attempt at the same exam: still that result');
    assertEq(mine().length, 1, 'one result for the attempt, however often and from wherever it was sent');
    const late = (await deliver([item(KS, { kind: 'submit', attempt: closedAttempt })]))[0];
    assert(late.ok && late.result && late.result.late === true, 'answers sent after the window closed are kept and flagged late, never refused');
    assert(col('voctrain_examResults').some(r => r.examId === 'EX-CLOSED' && r.studentId === K.stu.id && r.late === true), '— in the records');

    console.log('Review: the right answers only once released');
    const rvNow = await gate({ op: 'review', token: KS.token, resultId: sub1.result.id });
    assert(rvNow.ok && rvNow.result.answers.length && rvNow.result.answers.every(a => a.correctAnswer === undefined),
      'an exam still open: no right answers yet');
    const rvOld = await gate({ op: 'review', token: KS.token, resultId: 'RES-OLD-K' });
    assert(rvOld.ok && rvOld.result.answers.some(a => a.correctAnswer !== undefined), 'a closed exam: the right answers are shown');
    assertEq((await gate({ op: 'review', token: KS.token, resultId: 'RES-OLD-R' })).error, 'not-found', 'another trainee\'s result: not found');
    assertEq([rvNow.revealed, rvOld.revealed], [false, true], 'and each says whether the answers were released');

    console.log('A chat room\'s history, for its members');
    const rm = await gate({ op: 'room.get', token: KS.token, roomId: CHAT });
    assert(rm.ok && rm.room.format === 'cestis-chat-room' && rm.room.messages.some(m => m.id === 'msg-k-1') && rm.room.messages.some(m => m.id === 'msg-1'),
      'his class room, with his message and the class\'s');
    assertEq((await gate({ op: 'room.get', token: KS.token, roomId: CHAT, have: rm.h })).same, true, 'unchanged since: "the same"');
    assertEq((await gate({ op: 'room.get', token: KS.token, roomId: DM_PEER })).error, 'unknown-room', 'a conversation he is not served: unknown');

    console.log('A password change ends the old session');
    const oldItem = item(KS, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-K-2', message: 'after the change' } });
    const file = lms();
    const users = JSON.parse(file.data.voctrain_users);
    const k = users.find(a => a.id === K.acct.id);
    k.password = pbkdf2('pw-kemar-NEW', 'cafebabecafebabe', 1000);
    k.updatedAt = new Date().toISOString();
    file.data.voctrain_users = JSON.stringify(users);
    fs.writeFileSync(LMS, JSON.stringify(file));          // as the office's save would land it
    assertEq((await gate({ op: 'pull', token: KS.token })).error, 'revoked', 'the old token is answered "revoked"');
    assertEq((await deliver([oldItem]))[0].reason, 'revoked', 'and so is an item sealed in that session — kept on the device, to be sealed again');
    assertEq((await signIn(K.login, K.pw)).error, 'no-match', 'the old password no longer signs in');
    const KS2 = await signIn(K.login, 'pw-kemar-NEW');
    assert(KS2.ok && KS2.sid !== KS.sid, 'the new one does, as a new session');
    const resealed = G.seal(Object.assign({}, oldItem, { sid: KS2.sid, mac: undefined }), KS2.sessionKey, crypto);
    assert((await deliver([resealed]))[0].ok && col('voctrain_support_messages').some(m => m.id === 'SUP-K-2'),
      'the item sealed again in the new session is delivered');
    assertEq((await gate({ op: 'pull', token: TS.token })).ok, true, 'and nobody else\'s session was touched');

    console.log('Sign-out: the token reads nothing more, what was sealed is still delivered');
    const sealedBefore = item(TS, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-T-OUT', message: 'sent after sign-out' } });
    assertEq(await gate({ op: 'signOut', token: TS.token }), { ok: true }, 'signOut answers {ok:true}');
    assertEq((await gate({ op: 'pull', token: TS.token })).error, 'signed-out', 'the token is "signed-out" from then on');
    assert((await deliver([sealedBefore]))[0].ok && col('voctrain_support_messages').some(m => m.id === 'SUP-T-OUT'),
      'an item sealed in that session is still delivered');
    assertEq(await gate({ op: 'signOut', token: 'nonsense' }), { ok: true }, 'signing out a token that is no good answers the same');

    /* ---------------------------------------------------------- the switch */
    console.log('The staff-only switch, off: the records token exactly as before');
    const healthOff = (await req('/_cestis/health')).json;
    assertEq(Object.keys(healthOff).sort(), ['mode', 'ok', 'time', 'version'], 'the server\'s health answer is as it always was');
    const tokGet = await req('/_cestis/token');
    assert(tokGet.status === 200 && tokGet.json.token === TOKEN && TOKEN === fs.readFileSync(path.join(CERT, 'lan-token'), 'utf8').trim(),
      'GET /_cestis/token gives any device the token');
    const tokPost = await req('/_cestis/token', { method: 'POST', body: '{"username":"kemar01","password":"x"}' });
    assert(tokPost.status === 200 && tokPost.json.token === TOKEN, 'and so does any POST, whatever it says');
    assert((await req('/_cestis/data/CESTIS_LMS_Dashboard.json', { headers: { 'X-CESTIS-Token': TOKEN } })).status === 200,
      'and the token reads the records');
    assertEq((await req('/_cestis/staff-only')).json.on, false, 'the switch says it is off');
    assert(!fs.existsSync(path.join(DATA, '.server')), 'and nothing was written for it');

    console.log('Only an administrator can turn it on');
    const flip = (body, tok) => req('/_cestis/staff-only', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' },
      tok === null ? {} : { 'X-CESTIS-Token': tok || TOKEN }), body: JSON.stringify(body) });
    assert((await flip({ username: 'admin1', password: 'Admin-Pass-1', on: true }, null)).status === 401, 'not without the records token (another website cannot)');
    assert((await flip({ username: 'ins1', password: 'Teach-Pass-1', on: true })).status === 403, 'not an instructor');
    assert((await flip({ username: 'admin1', password: 'wrong', on: true })).status === 403, 'not with the wrong password');
    assert((await flip({ username: K.login, password: 'pw-kemar-NEW', on: true })).status === 403, 'not a trainee');
    const on = await flip({ username: 'Admin1@Centre.test', password: 'Admin-Pass-1', on: true });
    const TOKEN2 = on.json && on.json.token;
    assert(on.status === 200 && on.json.on === true && /^[a-f0-9]{48}$/.test(TOKEN2) && TOKEN2 !== TOKEN,
      'the administrator turns it on, and the token is replaced');
    assert(fs.readFileSync(path.join(CERT, 'lan-token'), 'utf8').trim() === TOKEN2, 'on the disk, so a restart keeps the new one');
    const setting = JSON.parse(fs.readFileSync(path.join(DATA, '.server', 'staff-only.json'), 'utf8'));
    assertEq([setting.on, setting.setBy], [true, admin.id], 'the setting is kept in the records folder');
    assert(!(await req('/_cestis/data', { headers: { 'X-CESTIS-Token': TOKEN2 } })).json.files.some(f => /staff-only/.test(f.file)),
      'out of reach of the records requests');

    console.log('On: a trainee\'s device gets neither the token nor the records');
    const tg = await req('/_cestis/token');
    assert(tg.status === 403 && tg.json.staffOnly === true && !tg.json.token, 'GET /_cestis/token is refused, saying staff must sign in');
    assert((await req('/_cestis/token', { method: 'POST', body: JSON.stringify({ username: K.login, password: 'pw-kemar-NEW' }) })).status === 403,
      'a trainee\'s own password does not get it');
    assert((await req('/_cestis/token', { method: 'POST', body: JSON.stringify({ username: 'ins1', password: 'nope' }) })).status === 403,
      'nor a wrong staff password');
    for (const p of ['/_cestis/data', '/_cestis/data/CESTIS_LMS_Dashboard.json']) {
      assert((await req(p, { headers: { 'X-CESTIS-Token': TOKEN } })).status === 401, p + ' refuses the old token');
      assert((await req(p)).status === 401, p + ' refuses no token');
    }
    assert((await req('/_cestis/data/CESTIS_LMS_Dashboard.json', { method: 'PUT', headers: { 'X-CESTIS-Token': TOKEN }, body: '{"data":{}}' })).status === 401,
      'and the old token cannot write');
    assertEq((await req('/_cestis/health')).json.staffOnly, true, 'the health answer says the records are for staff');
    assertEq((await req('/_cestis/gate')).json.staffOnly, true, 'and so does the gate\'s');
    const tp = await gate({ op: 'pull', token: KS2.token });
    assert(tp.ok && tp.slice.studentId === K.stu.id, 'the trainee still gets his own records, through the gate');

    console.log('On: a member of staff signs in with a password the server checks');
    const st = await req('/_cestis/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ins1', password: 'Teach-Pass-1' }) });
    assert(st.status === 200 && st.json.token === TOKEN2, 'the instructor\'s sign-in gets the new token');
    assert((await req('/_cestis/data/CESTIS_LMS_Dashboard.json', { headers: { 'X-CESTIS-Token': TOKEN2 } })).status === 200, 'and reads the records with it');
    const ticket = await req('/_cestis/host-ticket', { method: 'POST', headers: { 'X-CESTIS-Token': TOKEN2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ins1', password: 'Teach-Pass-1' }) });
    assert(ticket.status === 200 && !!ticket.json.ticket, 'and can host a class as before');

    console.log('It survives a restart');
    await stop(); await start();
    assertEq((await req('/_cestis/staff-only')).json.on, true, 'still on');
    assert((await req('/_cestis/token')).status === 403, 'the token still refused to anyone who asks');
    assert((await req('/_cestis/data', { headers: { 'X-CESTIS-Token': TOKEN2 } })).status === 200, 'and the staff token still works');
    assert((await gate({ op: 'pull', token: KS2.token })).ok, 'as does the trainee\'s session');
    assertEq((await gate({ op: 'pull', token: TS.token })).error, 'signed-out', 'and a signed-out session stays signed out');

    console.log('Off again: the token replaced, and open to every device as before');
    const offR = await flip({ username: 'admin1', password: 'Admin-Pass-1', on: false }, TOKEN2);
    const TOKEN3 = offR.json && offR.json.token;
    assert(offR.status === 200 && offR.json.on === false && TOKEN3 && TOKEN3 !== TOKEN2, 'turned off, the token is replaced again');
    const back = await req('/_cestis/token');
    assert(back.status === 200 && back.json.token === TOKEN3, 'GET /_cestis/token gives it to any device again');
    assertEq(Object.keys((await req('/_cestis/health')).json).sort(), ['mode', 'ok', 'time', 'version'], 'and the health answer is as before');
    await stop();

    console.log('A data folder with no staff login is never locked out of its records');
    const DATA2 = path.join(tmp, 'data2'), CERT2 = path.join(tmp, 'cert2');
    const lonely = Object.assign({}, STORE, { voctrain_users: [K.acct, TM.acct] });
    writeCentre(path.join(DATA2, 'CESTIS_LMS_Dashboard.json'), lonely);
    fs.mkdirSync(path.join(DATA2, '.server'), { recursive: true });
    fs.writeFileSync(path.join(DATA2, '.server', 'staff-only.json'), JSON.stringify({ on: true }));
    await start(DATA2, CERT2);
    assert((await req('/_cestis/token')).status === 200, 'the switch counts only once a staff login with its own password exists');
    assertEq((await req('/_cestis/staff-only')).json.on, false, 'and says so');
  } catch (e) {
    failed++;
    console.error(e && e.stack || e);
  } finally {
    await stop();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
