/* One client, two gates: the online trainee gate (trainee-gate/Gate.gs,
   pasted as PASTE-GATE.gs) and the Centre server's (Offline System/
   cestis-offline-gate.js) must answer the SAME requests with the SAME
   answers, so a trainee's device has one way of talking to either
   (DESIGN.md §6, D9).

   They are built differently — online, staff devices publish each trainee's
   records into Drive and what a trainee sends waits in their own "lane"
   file; on the Centre's machine the records are built on request and what
   is sent goes straight into the records file — and that is exactly how
   two copies of one API drift apart. So this runs one scenario, on one
   Centre (tests/gate-fixture.js) at one moment, against both:
     - the REAL PASTE-GATE.gs inside the simulated Apps Script runtime of
       tests/gate-appsscript-fakes.js (Stage 2), the records published into
       its Drive as a staff device publishes them;
     - the Centre server's gate in-process (the same create() the server
       calls), on a scratch data folder holding the same records, the same
       clock handed in;
   and compares, step by step, what a client reads: the fields of every
   answer, every error code, the account and student ID of a session, the
   credential version in its session id, the slice's hash (the two build
   byte-for-byte the same records), the paper's questions, every receipt,
   the result's id, score and late flag, review's "revealed", the room's
   hash, sign-out, and revocation after a password change; and review of a
   result that reached the trainee only in their slice (marked on a lab PC,
   redacted there): withheld, or released — the same result, its right
   answers put back from the key, from both. And, first, that
   the rules the two share (the accounts index, the login lookup, refusals,
   two-step methods and ticket, the credential version in a session id) are
   Core.gate's in both — neither gate carries a copy of its own any more.

   What only one of them can do is left out on purpose, and listed: email
   sign-in, emailed codes, uploads and file downloads need the internet
   (the Centre's server answers 'not-available'); the Centre's health also
   says whether its staff-only switch is on (staffOnly).

   Needs Stage 2's files: trainee-gate/PASTE-GATE.gs and
   tests/gate-appsscript-fakes.js, in this tree or in the folder named by
   CESTIS_GATE_STAGE2. Without them it says so and passes (nothing to
   compare yet).

   Run: node tests/gate-contract.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const Core = require('../cestis-core.js');
const { makeCentre, questionBank, crypto, pbkdf2, NOW, MIN, DAY, iso } = require('./gate-fixture.js');

const ROOT = path.join(__dirname, '..');
const OFF = path.join(ROOT, 'Offline System');
function stage2(rel) {
  const here = path.join(ROOT, rel);
  if (fs.existsSync(here)) return here;
  const dir = process.env.CESTIS_GATE_STAGE2;
  if (dir && fs.existsSync(path.join(dir, rel))) return path.join(dir, rel);
  return null;
}
const PASTE = stage2(path.join('trainee-gate', 'PASTE-GATE.gs'));
const FAKES = stage2(path.join('tests', 'gate-appsscript-fakes.js'));
if (!PASTE || !FAKES) {
  console.log('The online gate (Stage 2: trainee-gate/PASTE-GATE.gs, tests/gate-appsscript-fakes.js) is not in this tree —');
  console.log('nothing to compare the Centre server\'s gate with yet. Set CESTIS_GATE_STAGE2 to a checkout that has it.');
  console.log('\n0 passed, 0 failed (skipped)');
  process.exit(0);
}
const fakes = require(FAKES);
const lanGate = require(path.join(OFF, 'cestis-offline-gate.js'));
const lanStore = require(path.join(OFF, 'cestis-offline-store.js'));

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function same(step, online, lan, project) {
  const a = JSON.stringify(project ? project(online) : online), b = JSON.stringify(project ? project(lan) : lan);
  assert(a === b, step + '\n      online: ' + a + '\n      centre: ' + b);
}
const keys = (o, drop) => Object.keys(o || {}).filter(k => (drop || []).indexOf(k) === -1).sort();
const G = Core.gate;
const J = v => JSON.parse(JSON.stringify(v));
const RIGHT = { mcq: 0, tf: false, multi: [0, 2], match: ['Grinder', 'Torch'], shortanswer: 'Flashback Arrestor', numerical: '108', fill: 'butt', essay: 'I keep it tidy.' };

/* ---------------------------------------------------------- one Centre */
const C = makeCentre(Core);
const T = i => C.trainees[i];
T(5).acct.defaultPassword = true;                           // still on a published default
C.lone = { id: 'USR-LONE', name: 'Lonely Unlinked', role: 'student', username: 'lone01', email: 'lone@mail.test', status: 'active',
  programme: C.PROGRAMMES[0].name, password: pbkdf2('lone-pw', '0f0f0f0f0f0f0f0f', 1000) };
C.store.voctrain_users.push(C.lone);
/* Two tests of his marked on a lab PC: they reach his device only in his
   slice, where every result is redacted. Staff hold back the answers of one
   and released the other's — kept on the Centre without its right answers
   (an older copy) — so both gates must put them back from the key alike. */
function labResult(exam, t, strip) {
  const qs = Core.exams.attemptQuestions(exam.questionData, {});
  const m = Core.exams.mark(qs, qs.map(q => (q.type === 'info' ? null : J(RIGHT[q.type]))), exam.questionData);
  const r = { id: 'RES-LAB-' + exam.id, examId: exam.id, studentId: t.stu.id, studentName: t.stu.name, answers: m.gradedResults,
    score: 90, totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: true, submittedAt: iso(NOW - 12 * DAY) };
  if (strip) r.answers.forEach(a => { delete a.correctAnswer; delete a.tolerance; });
  return r;
}
const labExam = (id, release) => ({ id, title: 'Quiz ' + id, course: T(1).p.name, date: '2026-10-15', time: '09:00', duration: 30, passMark: 50,
  status: 'completed', answersRelease: release, questionData: questionBank(id.replace(/-/g, '')), questions: 8, updatedAt: iso(NOW - 12 * DAY) });
const WITHHELD = labExam('EX2-W', 'withheld'), RELEASED = labExam('EX2-R', 'released');
C.store.voctrain_exams.push(WITHHELD, RELEASED);
C.store.voctrain_examResults.push(labResult(WITHHELD, T(1), false), labResult(RELEASED, T(1), true));

/* ---------------------------------------------------------- online */
const w = fakes.makeWorld({ now: NOW - 30 * MIN, seed: 'gate-contract' });
const main = w.drive.mkdir('root', 'CESTIS Main');
const ledger = w.drive.put(main.id, 'CESTIS_ACCOUNTS.json', { version: 1, savedAt: iso(NOW - 60 * MIN), savedBy: 'admin1',
  accounts: J(C.store.voctrain_users), deletedUserIds: J(C.store.voctrain_deletedUserIds || []) });
w.drive.put(main.id, 'CESTIS_LMS_BACKUP.json', { version: '1.0', data: {} });
w.load(fs.readFileSync(PASTE, 'utf8'));
w.get({ op: 'health' });                                    // the first request sets the gate up
const cfg = w.drive.json(w.drive.child(main.id, 'CESTIS_GATE.json', 'file').id);
function publish() {
  const all = G.buildAll(C.store, w.clock.now, { builtBy: 'dev-contract' });
  const put = (parent, name, body) => { const f = w.drive.child(parent, name, 'file'); return f ? w.drive.replace(f.id, body) : w.drive.put(parent, name, body); };
  Object.keys(all.slices).forEach(acct => {
    const s = all.slices[acct].slice;
    let f = w.drive.children(cfg.traineesId, 'folder').filter(x => new RegExp('(^|\\s)acct=' + acct + '(\\s|$)').test(x.description))[0];
    if (!f) f = w.drive.mkdir(cfg.traineesId, s.studentId, { description: 'cestis-trainee acct=' + acct + ' v=1' });
    put(f.id, 'from-centre.json', s);
  });
  Object.keys(all.keys).forEach(id => put(cfg.keysId, 'key.' + id + '.json', all.keys[id].key));
  Object.keys(all.papers).forEach(id => put(cfg.papersId, 'paper.' + id + '.json', all.papers[id].paper));
  Object.keys(all.rooms).forEach(id => put(cfg.roomsId, 'room.' + id + '.json', all.rooms[id].room));
}
publish();
const online = body => Promise.resolve(w.post(body));

/* ---------------------------------------------------------- the Centre's */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-gate-contract-'));
const DATA = path.join(tmp, 'data'), LMS = path.join(DATA, 'CESTIS_LMS_Dashboard.json');
fs.mkdirSync(DATA, { recursive: true });
const asStrings = {};                                       // (as the records stand now, with the changes above)
Object.keys(C.store).forEach(k => { asStrings[k] = JSON.stringify(C.store[k]); });
fs.writeFileSync(LMS, JSON.stringify({ version: '1.0', page: 'LMS Dashboard', file: 'CESTIS_LMS_Dashboard.json', savedAt: iso(NOW - 60 * MIN),
  savedBy: 'office', keyCount: Object.keys(asStrings).length, stamps: {}, data: asStrings }));
const lanAccounts = () => { try { return JSON.parse(JSON.parse(fs.readFileSync(LMS, 'utf8')).data.voctrain_users); } catch (e) { return []; } };
const L = lanGate.create({ core: Core, store: lanStore, dataDir: DATA, certDir: path.join(tmp, 'cert'), rootDir: tmp,
  accounts: lanAccounts, staffOnly: () => false, send: () => {}, now: () => w.clock.now, log: () => {} });
const centre = body => L.run(J(body), w.clock.now);
const both = body => Promise.all([online(body), centre(body)]);

/* ---------------------------------------------------------- the device */
function proof(password, ch, login) {
  const V = ch.algo === 'pbkdf2-sha256'
    ? nodeCrypto.pbkdf2Sync(password, Buffer.from(ch.salt, 'hex'), ch.iter, 32, 'sha256').toString('hex')
    : nodeCrypto.createHash('sha256').update(password + '__CESTIS_SALT_2026__', 'utf8').digest('hex');
  return G.proof.make(V, ch.nonce, login, crypto);
}
async function signInOn(gate, login, password) {
  const ch = await gate({ op: 'auth.start', login });
  if (!ch.ok) return ch;
  return gate({ op: 'auth.password', login, nonce: ch.nonce, proof: proof(password, ch, login) });
}
const signIn = (login, password) => Promise.all([signInOn(online, login, password), signInOn(centre, login, password)]);
let seq = 0;
function item(sess, body) {
  return G.seal(Object.assign({ id: 'IT-C-' + (++seq), a: sess.account.id, sid: sess.sid, createdAt: iso(w.clock.now) }, body), sess.sessionKey, crypto);
}
// The same item sealed for each gate's own session (each gate has its own secret).
const pairItems = (sessions, make) => sessions.map(s => make(s));
const deliverBoth = (sessions, make) => {
  const [a, b] = pairItems(sessions, make);
  return Promise.all([online({ op: 'deliver', items: [].concat(a) }), centre({ op: 'deliver', items: [].concat(b) })]);
};
function attemptOf(paper, t, id) {
  const now = w.clock.now;
  const qs = Core.exams.attemptQuestionsFromPaper(paper.questions, { shuffleQuestions: true, shuffleOptions: true, random: fakes.seeded('dev-' + id).random });
  return { id, examId: paper.examId, studentId: t.stu.id, studentName: t.stu.name, accountId: t.acct.id, questions: qs,
    answers: qs.map(q => (q.type === 'info' ? null : J(RIGHT[q.type]))), flagged: qs.map(() => false), answeredAt: qs.map(() => now - MIN),
    flaggedAt: qs.map(() => 0), startTime: now - 10 * MIN, deadline: now + 60 * MIN, status: 'open', updatedAt: iso(now) };
}
const receipt = r => r && { ok: r.ok, reason: r.reason, retry: r.retry, dup: r.dup, already: r.already,
  result: r.result ? { id: r.result.id, score: r.result.score, earnedPoints: r.result.earnedPoints, totalPoints: r.result.totalPoints,
    late: !!r.result.late, markedBy: r.result.markedBy, keys: KEYS.some(k => JSON.stringify(r.result).indexOf('"' + k + '"') !== -1) } : undefined,
  retired: r.retired ? r.retired.status : undefined };
const KEYS = ['correctAnswer', 'pairs', 'distractors', 'tolerance'];

(async () => {
  try {
    console.log('Both gates call the rules they share (Core.gate); neither carries a copy of its own');
    {
      const gs = fs.readFileSync(path.join(ROOT, 'trainee-gate', 'Gate.gs'), 'utf8');
      const lan = fs.readFileSync(path.join(OFF, 'cestis-offline-gate.js'), 'utf8');
      const SHARED = ['indexAccounts', 'lookupLogin', 'credentialRefusal', 'twoStep', 'ticketMake', 'ticketRead', 'sidRand', 'sidCv'];
      const calls = (src, f) => new RegExp('\\b(?:G\\.gate|g|G)\\.' + f + '\\(').test(src);
      same('the sign-in rules each gate calls', SHARED.filter(f => calls(gs, f)), SHARED.filter(f => calls(lan, f)));
      assertEq(SHARED.filter(f => !calls(gs, f)), [], 'the online gate calls every one of them');
      assertEq(['laneMerge', 'laneFirstSeen', 'firstSeenOf', 'fillAnswers'].filter(f => !calls(gs, f)), [], 'and the lane rules and fillAnswers');
      assert(calls(lan, 'fillAnswers'), 'the Centre server\'s review puts right answers back the same way');
      const COPIES = ['gateLookup', 'gateSidCv', 'gateTicketMake', 'gateBytesText', 'gateRecStamp', 'gateLaneMerge', 'gateFirstSeen'];
      assertEq(COPIES.filter(f => new RegExp('function ' + f + '\\(').test(gs)), [], 'Gate.gs defines none of its old copies');
      assert(!/TODO\(core\)/.test(lan) && !('rules' in lanGate), 'nor does the Centre server\'s gate');
    }

    console.log('Health and the answers to requests it cannot take');
    const [h1, h2] = await both({ op: 'health' });
    same('health: the same fields (the Centre also says whether its staff-only switch is on)', keys(h1), keys(h2, ['staffOnly']));
    same('health: who it is, and whether it answers', h1, h2, h => [h.ok, h.service, h.version, h.protocol, h.accepting, h.ready.secret, h.ready.trainees]);
    same('an unknown request', ...(await both({ op: 'frobnicate' })));
    same('an old client', ...(await both({ op: 'health', v: 0 })));
    same('a delivery with nothing in it', ...(await both({ op: 'deliver', items: [] })));
    same('a challenge with no login', ...(await both({ op: 'auth.start', login: '' })));
    same('an answer with a malformed nonce', ...(await both({ op: 'auth.password', login: 'x', nonce: 'zz', proof: 'p' })));
    same('a pull with no token', ...(await both({ op: 'pull' })));

    console.log('Password sign-in');
    const K = T(1);
    const [c1, c2] = await both({ op: 'auth.start', login: K.acct.username });
    same('the challenge for a stored PBKDF2 password', c1, c2, c => [c.ok, keys(c), c.algo, c.iter, c.salt]);
    const [u1, u2] = await both({ op: 'auth.start', login: 'nobody@nowhere.test' });
    same('the challenge for a login nobody has (believable, not the same salt: each gate has its own secret)', u1, u2, c => [c.ok, keys(c), c.algo, c.iter, c.salt.length]);
    const [l1, l2] = await both({ op: 'auth.start', login: T(4).acct.email });
    same('the challenge for the older password check', l1, l2, c => [c.algo, c.iter, c.salt]);
    const w1 = await online({ op: 'auth.password', login: K.acct.username, nonce: c1.nonce, proof: 'f'.repeat(64) });
    const w2 = await centre({ op: 'auth.password', login: K.acct.username, nonce: c2.nonce, proof: 'f'.repeat(64) });
    same('a wrong answer', w1, w2);
    const r1 = await online({ op: 'auth.password', login: K.acct.username, nonce: c1.nonce, proof: 'f'.repeat(64) });
    const r2 = await centre({ op: 'auth.password', login: K.acct.username, nonce: c2.nonce, proof: 'f'.repeat(64) });
    same('a challenge answered twice', r1, r2);
    const [S1, S2] = await signIn(K.acct.username, K.pw);
    same('a session: the same fields', keys(S1), keys(S2));
    same('a session: the account, its lane, how long it lasts, the time', S1, S2, s => [s.ok, s.account, s.lane === 'L-' + s.sid, s.exp - w.clock.now, s.serverTime]);
    same('a session id carries the same credential version', S1, S2, s => s.sid.split('.')[1].slice(0, 12));
    same('a pending account', ...(await signIn('pend@mail.test', 'x')));
    same('a published default password', ...(await signIn(T(5).acct.username, T(5).pw)));
    same('an account with no trainee record yet', ...(await signIn('lone01', 'lone-pw')));
    const lock1 = [], lock2 = [];
    for (let i = 0; i < 6; i++) { const [a, b] = await signIn(T(7).acct.username, 'guess-' + i); lock1.push(a); lock2.push(b); }
    same('five wrong passwords, then locked', lock1, lock2);

    console.log('Two-step');
    const TF = T(0);
    const [n1, n2] = await signIn(TF.acct.username, TF.pw);
    same('the second step asked for', n1, n2, n => [n.ok, keys(n), n.need2fa, n.methods, n.email]);
    same('a way not offered', await online({ op: 'auth.2fa', ticket: n1.ticket, method: 'email', code: '123456' }),
      await centre({ op: 'auth.2fa', ticket: n2.ticket, method: 'email', code: '123456' }));
    same('a wrong code', await online({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code: '000000' }),
      await centre({ op: 'auth.2fa', ticket: n2.ticket, method: 'totp', code: '000000' }));
    const code = G.totp.code(TF.acct.twoFactorSecret, w.clock.now, crypto);
    const [A1, A2] = [await online({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code }), await centre({ op: 'auth.2fa', ticket: n2.ticket, method: 'totp', code })];
    same('the authenticator\'s code: a session', A1, A2, s => [s.ok, keys(s), s.account]);
    same('the ticket again', await online({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code }),
      await centre({ op: 'auth.2fa', ticket: n2.ticket, method: 'totp', code }));
    const [m1, m2] = await signIn(TF.acct.username, TF.pw);
    same('the same code with a new ticket', await online({ op: 'auth.2fa', ticket: m1.ticket, method: 'totp', code }),
      await centre({ op: 'auth.2fa', ticket: m2.ticket, method: 'totp', code }));
    const bc = TF.acct.backupCodes[0].code.toLowerCase();
    same('a backup code: a session', await online({ op: 'auth.2fa', ticket: m1.ticket, method: 'backup', code: bc }),
      await centre({ op: 'auth.2fa', ticket: m2.ticket, method: 'backup', code: bc }), s => [s.ok, keys(s), s.account]);
    const [o1, o2] = await signIn(TF.acct.username, TF.pw);
    same('that backup code, spent', await online({ op: 'auth.2fa', ticket: o1.ticket, method: 'backup', code: bc }),
      await centre({ op: 'auth.2fa', ticket: o2.ticket, method: 'backup', code: bc }));

    console.log('Reading: pull, paper, attempt, room');
    const [p1, p2] = await Promise.all([online({ op: 'pull', token: S1.token }), centre({ op: 'pull', token: S2.token })]);
    same('pull: the same fields', keys(p1), keys(p2));
    same('pull: the slice\'s hash — both hold byte-for-byte the same records for him', p1, p2, p => [p.ok, p.h, p.slice.hash, p.slice.studentId, p.overlay, p.serverTime]);
    same('pull with the hash it has', await online({ op: 'pull', token: S1.token, have: p1.h }), await centre({ op: 'pull', token: S2.token, have: p2.h }));
    const exam = 'EX' + (K.i % 3 + 1);
    const [q1, q2] = await Promise.all([online({ op: 'paper', token: S1.token, examId: exam }), centre({ op: 'paper', token: S2.token, examId: exam })]);
    same('the open exam\'s paper', q1, q2, q => [q.ok, keys(q), q.paper.examId, q.paper.hash, q.paper.questions, q.centreUtcOffset, q.serverTime]);
    same('a closed exam\'s paper', await online({ op: 'paper', token: S1.token, examId: exam + '-OLD' }), await centre({ op: 'paper', token: S2.token, examId: exam + '-OLD' }));
    same('another programme\'s', await online({ op: 'paper', token: S1.token, examId: 'EX9' }), await centre({ op: 'paper', token: S2.token, examId: 'EX9' }));
    same('attempt.get, nothing yet', await online({ op: 'attempt.get', token: S1.token, examId: exam }), await centre({ op: 'attempt.get', token: S2.token, examId: exam }));
    const room = p1.slice.access.rooms[0];
    const [g1, g2] = await Promise.all([online({ op: 'room.get', token: S1.token, roomId: room }), centre({ op: 'room.get', token: S2.token, roomId: room })]);
    same('room.get: his class room, the same history', g1, g2, g => [g.ok, keys(g), g.h, g.room.members, g.room.messages.map(m => m.id)]);
    same('room.get with the hash it has', await online({ op: 'room.get', token: S1.token, roomId: room, have: g1.h }),
      await centre({ op: 'room.get', token: S2.token, roomId: room, have: g2.h }));
    same('a room he is not in', await online({ op: 'room.get', token: S1.token, roomId: C.dmPeer }), await centre({ op: 'room.get', token: S2.token, roomId: C.dmPeer }));

    console.log('Delivering');
    const ss = [S1, S2];
    const save = s => item(s, { kind: 'rec', key: 'voctrain_examAttempts', rec: attemptOf(q1.paper, K, 'ATT-CONTRACT') });
    same('an attempt saved', ...(await deliverBoth(ss, save)), r => r.receipts.map(receipt));
    same('attempt.get finds it', await online({ op: 'attempt.get', token: S1.token, examId: exam }), await centre({ op: 'attempt.get', token: S2.token, examId: exam }),
      r => [r.state, r.attempt && r.attempt.id, r.attempt && r.attempt.answers]);
    const support = ss.map(s => item(s, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-CONTRACT', subject: 'Hi', message: 'Help', timestamp: w.clock.now } }));
    same('a support message', await online({ op: 'deliver', items: [support[0]] }), await centre({ op: 'deliver', items: [support[1]] }), r => r.receipts.map(receipt));
    same('the same item again', await online({ op: 'deliver', items: [support[0]] }), await centre({ op: 'deliver', items: [support[1]] }), r => r.receipts.map(receipt));
    same('not his: another trainee\'s student ID, a result, a tampered item, a spent-code claim', ...(await deliverBoth(ss, s => [
      item(s, { kind: 'rec', key: 'voctrain_submissions', rec: { id: 'SUB-X', assignmentId: 'ASG-1', studentId: T(3).stu.id } }),
      item(s, { kind: 'rec', key: 'voctrain_examResults', rec: { id: 'RES-X', examId: exam, studentId: K.stu.id, score: 100 } }),
      Object.assign(item(s, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-T', message: 'x' } }), { key: 'voctrain_users' }),
      item(s, { kind: 'op', op: { id: 'OP-BC', kind: 'backupCodeUsed', codeHash: G.codeHash('X') } })
    ])), r => r.receipts.map(receipt));
    const full = attemptOf(q1.paper, K, 'ATT-CONTRACT');
    full.questions.forEach(q => { q.points = 1000; });
    same('submitted: marked from the key, one result id', ...(await deliverBoth(ss, s => item(s, { kind: 'submit', attempt: full }))), r => r.receipts.map(receipt));
    same('submitted again', ...(await deliverBoth(ss, s => item(s, { kind: 'submit', attempt: full }))), r => r.receipts.map(receipt));
    same('another device\'s attempt at the same exam', ...(await deliverBoth(ss, s => item(s, { kind: 'submit', attempt: attemptOf(q1.paper, K, 'ATT-CONTRACT-2') }))),
      r => r.receipts.map(receipt));
    const resId = G.resultId('ATT-CONTRACT', crypto);
    same('review: not released yet', await online({ op: 'review', token: S1.token, resultId: resId }), await centre({ op: 'review', token: S2.token, resultId: resId }),
      r => [r.ok, keys(r), r.revealed, r.result.id, KEYS.some(k => JSON.stringify(r.result).indexOf('"' + k + '"') !== -1)]);
    same('review: a result that is not his', await online({ op: 'review', token: S1.token, resultId: 'RES-' + T(3).acct.id }),
      await centre({ op: 'review', token: S2.token, resultId: 'RES-' + T(3).acct.id }));
    const review = id => Promise.all([online({ op: 'review', token: S1.token, resultId: id }), centre({ op: 'review', token: S2.token, resultId: id })]);
    const shown = r => r.result.answers.filter(a => 'correctAnswer' in a).length;
    const [e1, e2] = await review('RES-' + K.acct.id);
    same('review: his earlier test (marked on a lab PC, in his slice without its right answers), long closed — released, the SAME result field for field',
      e1, e2, r => [r.ok, r.revealed, r.result]);
    assertEq([shown(e1), shown(e2)], [8, 8], '— the right answers shown by both (online, put back from the key file)');
    const [h1r, h2r] = await review('RES-LAB-EX2-W');
    same('review: one whose answers staff hold back — none, from either', h1r, h2r, r => [r.ok, r.revealed, KEYS.some(k => JSON.stringify(r.result).indexOf('"' + k + '"') !== -1)]);
    const [rl1, rl2] = await review('RES-LAB-EX2-R');
    same('review: one whose answers staff released, kept without them — both put them back, the same', rl1, rl2, r => [r.ok, r.revealed, r.result]);
    assertEq([rl1.revealed, shown(rl1)], [true, 8], '— all eight');

    console.log('Sign-out and revocation');
    same('sign-out', await online({ op: 'signOut', token: A1.token }), await centre({ op: 'signOut', token: A2.token }));
    same('a signed-out token', await online({ op: 'pull', token: A1.token }), await centre({ op: 'pull', token: A2.token }));
    const old = ss.map(s => item(s, { kind: 'rec', key: 'voctrain_support_messages', rec: { id: 'SUP-AFTER', message: 'later' } }));
    const changed = pbkdf2('a-new-password', 'abcdefabcdef0101', 1000);
    const led = w.drive.json(ledger.id);
    led.accounts.filter(a => a.id === K.acct.id)[0].password = changed;
    w.advance(1000);                                        // the office saves the list a moment later
    w.drive.replace(ledger.id, led);
    const file = JSON.parse(fs.readFileSync(LMS, 'utf8')), users = JSON.parse(file.data.voctrain_users);
    users.filter(a => a.id === K.acct.id)[0].password = changed;
    file.data.voctrain_users = JSON.stringify(users);
    fs.writeFileSync(LMS, JSON.stringify(file));
    w.advance(61 * 1000);                                   // the online gate looks at the accounts list once a minute
    same('after a password change, the old token', await online({ op: 'pull', token: S1.token }), await centre({ op: 'pull', token: S2.token }));
    same('and an item sealed in that session', await online({ op: 'deliver', items: [old[0]] }), await centre({ op: 'deliver', items: [old[1]] }), r => r.receipts.map(receipt));
    same('the old password', ...(await signIn(K.acct.username, K.pw)));
    const [N1, N2] = await signIn(K.acct.username, 'a-new-password');
    same('the new one: a session', N1, N2, s => [s.ok, s.account, s.sid.split('.')[1].slice(0, 12)]);

    console.log('Left out on purpose (the Centre\'s network has no internet): auth.email, auth.2fa.send, upload, file.get');
    for (const op of ['auth.email', 'auth.2fa.send', 'upload', 'file.get']) {
      assert((await centre({ op, token: N2.token })).error === 'not-available', op + ' is not-available on the Centre\'s server');
    }
  } catch (e) {
    failed++;
    console.error(e && e.stack || e);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
