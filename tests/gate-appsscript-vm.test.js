/* The trainee gate's own script — the REAL trainee-gate/PASTE-GATE.gs —
   run inside a simulated Apps Script runtime (Node vm, with the in-memory
   DriveApp, CacheService, PropertiesService, UrlFetchApp, MailApp,
   Utilities, LockService, ContentService and HtmlService of
   tests/gate-appsscript-fakes.js). Live Apps Script cannot run here; what a
   simulation can show, this does, and SETUP.md's live checks cover the rest.

   The failures it pins (DESIGN.md §4, §5, §10, §12 Stage 2):
     - set-up: the first request makes the secret, the six folders and
       CESTIS_GATE.json beside the right accounts list (the copy beside the
       main backup, not a stray older one) — once; a second first request
       makes nothing; before any accounts list exists it says so and
       finishes later by itself;
     - the cryptography adapter turns Apps Script's SIGNED bytes into what
       Core.gate expects (the fake refuses a byte outside -128…127, as the
       real runtime does) and the self-test passes inside the runtime;
     - password sign-in as a challenge, for PBKDF2 and legacy hashes; an
       unknown login gets a believable challenge; a plaintext or published
       default password, a pending account, an ambiguous login and an
       account with no records yet are refused for what they are;
     - email sign-in: a good token, another app's token, an unverified
       address, an expired token; an account with no password;
     - two-step: authenticator code (and the same code refused twice),
       backup code (spent at once, and written into the trainee's lane for
       staff to burn — readable by Stage 1's collector), emailed code,
       tampered and expired tickets, too many tries;
     - lock-out after five wrong passwords, a flood of challenges, and the
       "busy" brake across all logins that leaves email sign-in working;
     - pull: the slice, "same" when the device has it, the overlay of what
       the trainee sent, a refreshed token, and revocation within a minute
       of a password reset, a switch-off or a deletion;
     - deliver: kept in the session's own lane (one writer), idempotent by
       item id, a foreign trainee's record refused, a forged seal refused,
       too old refused, a revoked session answered 'revoked' and delivered
       once re-sealed, a failed Drive write answered retry with nothing
       counted as received;
     - submit: marked from the KEY (points the copy claims ignored),
       idempotent, two devices submitting at the same moment get ONE result
       (one file kept, the younger in the bin), a second attempt at the
       same exam gets the first result, late answers kept and flagged;
     - review: no right answers before the exam closes, then right answers —
       for a result that came only in the slice (marked on a lab PC, its
       copy redacted) too, put back from the key file (Core.gate.fillAnswers)
       exactly as the Centre's whole copy has them; a paper only while the
       exam is open by the gate's clock;
     - uploads: kinds, 5 MB, 50 a day, 100 MB a day — and a lost cache never
       lifts a limit; files only from the trainee's list or own uploads;
     - registration from home (DESIGN.md §17): an email-account token only
       (another app's, an unverified address, an unknown token refused); an
       address that has an account is told to sign in (or how it stands); the
       catalogue staff publish is read without signing in, and nothing is
       open without one; the form is checked (full name, a programme from the
       catalogue, phone, the password as the dashboard stores one); in ONE
       request the registration is kept in Registrations/ AND the trainee's
       folder is made in Trainees/, named "<Name> (<student ID>)" (the
       dashboard's own ID) and described "cestis-trainee acct=<id> v=1
       registration=pending"; sent again — same token or another for the same
       address — it is the same registration, never a second, nor a second
       folder (even after a write that failed half-way); the limits for one
       address and for everybody; once the office approves and publishes,
       the trainee signs in with that account and with the password;
     - rooms to members only; sign-out stops reads (even with the cache
       lost) but still delivers what was sealed; the switch-off property
       and file; old clients; the live-check calls; the check page names no
       trainee; the write-rate check;
     - the committed PASTE-GATE.gs is what build-paste.js builds now (in the
       mode it says), its parts are byte-for-byte cestis-core.js, Gate.gs
       uses only modules the paste carries — and the whole scenario gives
       the SAME answers on the allowlist paste and on the full one.

   Run: node tests/gate-appsscript-vm.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const Core = require('../cestis-core.js');
const fakes = require('./gate-appsscript-fakes.js');
const paste = require('../trainee-gate/build-paste.js');
const { makeCentre, crypto, pbkdf2, NOW, MIN, DAY, iso } = require('./gate-fixture.js');

let passed = 0, failed = 0, MODE = '', VERBOSE = true;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL [' + MODE + ']: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function section(t) { if (VERBOSE) console.log(t); }
const G = Core.gate;
const HOUR = 60 * MIN;
const CLIENT = '302497466088-0b619cqa9qno2c606k4rqp742lebc5o8.apps.googleusercontent.com';
const GATE_URL = 'https://script.google.com/macros/s/FAKE/exec';
const RIGHT = { mcq: 0, tf: false, multi: [0, 2], match: ['Grinder', 'Torch'], shortanswer: 'Flashback Arrestor', numerical: '108', fill: 'butt', essay: 'I keep it tidy.' };
const J = v => JSON.parse(JSON.stringify(v));
let TRANSCRIPT = [], itemSeq = 0, WORLDS = [];

/* ---------------------------------------------------------- the Centre */
function centre() {
  const C = makeCentre(Core);
  const t = i => C.trainees[i];
  t(2).acct.emailOtpLogin = true;                                     // email codes, no authenticator
  t(2).acct.backupCodes = [{ code: 'BC02EMAIL1', used: false }];
  t(5).acct.defaultPassword = true;                                   // still on a published default
  t(6).acct.password = 'plain-six';                                   // never hashed
  t(7).acct.password = '';                                            // signs in with their email account only
  t(11).acct.username = t(10).acct.username;                          // one login, two trainees
  C.lone = { id: 'USR-LONE', name: 'Lonely Unlinked', role: 'student', username: 'lone01', email: 'lone@mail.test', status: 'active',
    programme: C.PROGRAMMES[0].name, password: pbkdf2('lone-pw', '0f0f0f0f0f0f0f0f', 1000) };
  C.store.voctrain_users.push(C.lone);                                // can sign in, but no trainee record: no slice
  return C;
}
function ledgerOf(C) {
  return { version: 1, savedAt: iso(NOW - DAY), savedBy: 'admin1', accounts: J(C.store.voctrain_users), deletedUserIds: J(C.store.voctrain_deletedUserIds || []) };
}
function expectedTrainees(led) {
  const ids = new Set();
  led.accounts.forEach(a => { if (a && a.id && String(a.role).trim().toLowerCase() === 'student' && (led.deletedUserIds || []).indexOf(a.id) === -1) ids.add(a.id); });
  return ids.size;
}

/* ------------------------------------------------- one gate, in a world */
function gateWorld(source, opts) {
  opts = opts || {};
  const C = opts.C || centre();
  const w = fakes.makeWorld({ now: opts.now || (NOW - 30 * MIN), seed: 'gate-vm' });
  if (!opts.noLedger) {
    // A stray older copy of the accounts list elsewhere: not beside the main backup, so never the one used.
    const stray = w.drive.mkdir('root', 'Old copies');
    w.drive.put(stray.id, 'CESTIS_ACCOUNTS.json', { version: 1, accounts: [], deletedUserIds: [] });
  }
  const main = w.drive.mkdir('root', 'CESTIS Main');
  const ledger = opts.noLedger ? null : w.drive.put(main.id, 'CESTIS_ACCOUNTS.json', ledgerOf(C));
  w.drive.put(main.id, 'CESTIS_LMS_BACKUP.json', { version: '1.0', data: {} });
  w.load(source);
  WORLDS.push(w);
  const post0 = w.post, get0 = w.get;
  w.post = b => { const r = post0(b); TRANSCRIPT.push(r); return r; };
  w.get = p => { const r = get0(p); TRANSCRIPT.push(r); return r; };
  const env = { w, C, main, ledger, health: w.get({ op: 'health' }) };
  env.cfgFile = () => w.drive.child(main.id, 'CESTIS_GATE.json', 'file');
  env.cfg = env.cfgFile() ? w.drive.json(env.cfgFile().id) : null;
  env.secret = () => w.props.store.GK_SECRET;
  env.publish = () => publish(env);
  if (env.cfg && opts.publish !== false) env.publish();
  return env;
}
// What a staff device publishes (Stage 3 builds it into the dashboard; Core.gate builds the files).
function publish(env) {
  const { w, C, cfg } = env;
  const all = G.buildAll(C.store, w.clock.now, { gateUrl: GATE_URL, builtBy: 'dev-test' });
  const putOrReplace = (parent, name, body) => { const f = w.drive.child(parent, name, 'file'); return f ? w.drive.replace(f.id, body) : w.drive.put(parent, name, body); };
  Object.keys(all.slices).forEach(acct => {
    const s = all.slices[acct].slice;
    let f = folderOf(env, acct);
    if (!f) f = w.drive.mkdir(cfg.traineesId, s.studentId, { description: 'cestis-trainee acct=' + acct + ' v=1' });
    putOrReplace(f.id, 'from-centre.json', s);
  });
  Object.keys(all.keys).forEach(id => putOrReplace(cfg.keysId, 'key.' + id + '.json', all.keys[id].key));
  Object.keys(all.papers).forEach(id => putOrReplace(cfg.papersId, 'paper.' + id + '.json', all.papers[id].paper));
  Object.keys(all.rooms).forEach(id => putOrReplace(cfg.roomsId, 'room.' + id + '.json', all.rooms[id].room));
  return all;
}
function folderOf(env, acct) {
  return env.w.drive.children(env.cfg.traineesId, 'folder').filter(f => new RegExp('(^|\\s)acct=' + acct + '(\\s|$)').test(f.description))[0] || null;
}
function sliceOf(env, acct) { return env.w.drive.json(env.w.drive.child(folderOf(env, acct).id, 'from-centre.json', 'file').id); }
function updateLedger(env, fn) {
  const led = env.w.drive.json(env.ledger.id);
  fn(led);
  env.w.drive.replace(env.ledger.id, led);
}
function account(led, id) { return led.accounts.filter(a => a.id === id)[0]; }
function inboxFiles(env, acct, prefix) {
  return env.w.drive.children(folderOf(env, acct).id, 'file').filter(f => f.name.indexOf(prefix || 'CESTISINBOX') === 0);
}

/* --------------------------------------------- what a trainee's device does
   Worked out with Node alone (crypto, Core.gate as the client will use it),
   never with the script under test. */
function deviceProof(password, ch, nonce, login) {
  const V = ch.algo === 'pbkdf2-sha256'
    ? nodeCrypto.pbkdf2Sync(password, Buffer.from(ch.salt, 'hex'), ch.iter, 32, 'sha256').toString('hex')
    : nodeCrypto.createHash('sha256').update(password + '__CESTIS_SALT_2026__', 'utf8').digest('hex');
  return nodeCrypto.createHmac('sha256', V).update('cestis-gate-v1|' + nonce + '|' + String(login).trim().toLowerCase(), 'utf8').digest('hex');
}
function signIn(env, login, password) {
  const st = env.w.post({ op: 'auth.start', login });
  if (!st.ok) return st;
  return env.w.post({ op: 'auth.password', login, nonce: st.nonce, proof: deviceProof(password, st, st.nonce, login) });
}
function item(env, sess, kind, body) {
  const it = Object.assign({ id: 'IT-' + (++itemSeq), a: sess.account.id, sid: sess.sid, kind, createdAt: iso(env.w.clock.now) }, body);
  return G.seal(it, sess.sessionKey, crypto);
}
function deliver(env, items, lane) { return env.w.post(Object.assign({ op: 'deliver', items }, lane ? { lane } : {})); }
function attemptOf(env, paper, T, id, over) {
  const rnd = fakes.seeded('device-' + id).random, now = env.w.clock.now;
  const qs = Core.exams.attemptQuestionsFromPaper(paper.questions, { shuffleQuestions: true, shuffleOptions: true, random: rnd });
  return Object.assign({ id, examId: paper.examId, studentId: T.stu.id, studentName: T.stu.name, accountId: T.acct.id, questions: qs,
    answers: qs.map(q => (q.type === 'info' ? null : J(RIGHT[q.type]))), flagged: qs.map(() => false), answeredAt: qs.map(() => now - MIN),
    flaggedAt: qs.map(() => 0), startTime: now - 10 * MIN, deadline: now + 60 * MIN, status: 'open', updatedAt: iso(now) }, over || {});
}
const examOf = T => 'EX' + (T.i % 3 + 1);
const hasKey = v => JSON.stringify(v).indexOf('"correctAnswer"') !== -1;

/* ================================================================ setup */
function sSetup(src) {
  section('The pasted file runs in a simulated Apps Script runtime; its first request makes the secret, the folders and CESTIS_GATE.json');
  const env = gateWorld(src, { publish: false }), w = env.w, h = env.health;
  assertEq([h.ok, h.service, h.version, h.protocol, h.accepting], [true, 'cestis-trainee-gate', 2, [1], true], 'health answers who it is (version 2: registration from home)');
  const led = w.drive.json(env.ledger.id);
  assertEq(h.ready, { secret: true, folders: true, ledger: true, ledgerUpdated: iso(w.clock.now), trainees: expectedTrainees(led) },
    'ready: secret, folders, the accounts list and its trainee accounts');
  const root = w.drive.child('root', 'CESTIS Trainee Gate', 'folder');
  assert(!!root, 'the gate\'s folder is made in My Drive');
  const sub = n => w.drive.child(root.id, n, 'folder');
  assertEq(w.drive.children(root.id, 'folder').map(f => f.name).sort(), ['Exam keys', 'Papers', 'Registrations', 'Rooms', 'Trainees', '_gate'], 'with its six folders');
  const cfg = env.cfg;
  assert(!!cfg && env.cfgFile().parent === env.main.id, 'CESTIS_GATE.json is written beside the accounts list (the main folder)');
  assertEq([cfg.format, cfg.version, cfg.rootId, cfg.gateFolderId, cfg.traineesId, cfg.keysId, cfg.papersId, cfg.roomsId, cfg.registrationsId],
    ['cestis-gate-config', 1, root.id, sub('_gate').id, sub('Trainees').id, sub('Exam keys').id, sub('Papers').id, sub('Rooms').id, sub('Registrations').id],
    'and names every folder, so no one types an id');
  assert(/^[0-9a-f]{64}$/.test(env.secret()), 'a 64-hex secret is made and kept in Script Properties');
  assert(JSON.stringify(h).indexOf(env.secret()) === -1 && w.drive.read(env.cfgFile().id).indexOf(env.secret()) === -1, 'and never shown or written to a file');
  const state = w.drive.json(w.drive.child(sub('_gate').id, 'gate-state.json', 'file').id);
  assertEq([state.format, state.gateVersion, state.ledgerFileId, state.upgrades.map(u => u.version)], ['cestis-gate-state', 2, env.ledger.id, [2]], 'gate-state.json records the version and the list used');
  assertEq(w.props.store.LEDGER_FOUND_ID, env.ledger.id, 'of two accounts lists, the one beside the main backup is used');
  assert(/2 copies/.test(w.props.store.LEDGER_NOTE), 'and the check page can say so');

  const items = w.drive.count(), props = JSON.stringify(w.props.store);
  w.cache.clear();
  const h2 = w.get({ op: 'health' });
  assertEq([h2.ok, w.drive.count(), JSON.stringify(w.props.store) === props], [true, items, true], 'a second first request (cache lost) makes nothing new');

  section('Cryptography: Apps Script\'s signed bytes in and out, and the self-test inside the runtime');
  let refused = false;
  try { w.ctx.Utilities.computeDigest('SHA_256', [200]); } catch (e) { refused = true; }
  assert(refused, 'the simulated runtime refuses an unsigned byte, as the real one does');
  const st = w.ctx.CESTISCore.gate.selfTest(w.ctx.GATE_CRYPTO);
  assertEq([st.ok, st.checks.filter(c => !c.ok).map(c => c.name)], [true, []], 'Core.gate.selfTest passes on the gate\'s adapter (SHA-256, HMAC, TOTP, token, proof)');
  const msg = 'gate ✓ ünïcode ' + '€'.repeat(3);
  assertEq(w.ctx.GATE_CRYPTO.hmacHex(Core.gate.utf8('k€y'), msg), crypto.hmacHex(Core.gate.utf8('k€y'), msg), 'its HMAC of non-ASCII text agrees with Node\'s');
  assertEq(w.ctx.GATE_CRYPTO.sha1Bytes([0, 255, 128, 7]), crypto.sha1Bytes([0, 255, 128, 7]), 'its SHA-1 of high bytes agrees with Node\'s (0–255 out)');

  section('Before any accounts list exists, the gate says so — and finishes setting up by itself once one appears');
  const bare = gateWorld(src, { noLedger: true, C: env.C });
  const hb = bare.health;
  assertEq([hb.ready.secret, hb.ready.folders, hb.ready.ledger, hb.ready.trainees], [true, true, false, null], 'folders and secret made; no list yet');
  assertEq(bare.w.post({ op: 'auth.start', login: 'kemar01' }).error, 'not-set-up', 'sign-in answers not-set-up meanwhile');
  const late = bare.w.drive.put(bare.main.id, 'CESTIS_ACCOUNTS.json', ledgerOf(env.C));
  bare.w.advance(61 * 1000);
  const hb2 = bare.w.get({ op: 'health' });
  assertEq([hb2.ready.ledger, hb2.ready.trainees], [true, expectedTrainees(bare.w.drive.json(late.id))], 'a minute after a list appears, it is found');
  assert(!!bare.w.drive.child(bare.main.id, 'CESTIS_GATE.json', 'file'), 'and CESTIS_GATE.json is written beside it');
}

/* =========================================================== passwords */
function sPassword(src) {
  section('Password sign-in is a challenge: the device answers HMAC(stored hash, nonce); the gate does one HMAC');
  const env = gateWorld(src), w = env.w, C = env.C, T1 = C.trainees[1];
  const st = w.post({ op: 'auth.start', login: T1.acct.username });
  const parts = T1.acct.password.split('$');
  assertEq([st.ok, st.algo, st.iter, st.salt], [true, 'pbkdf2-sha256', Number(parts[1]), parts[2]], 'the device is told the algorithm, iterations and salt');
  assert(/^[0-9a-f]{32}$/.test(st.nonce), 'and a fresh nonce');
  const ok = w.post({ op: 'auth.password', login: T1.acct.username, nonce: st.nonce, proof: deviceProof(T1.pw, st, st.nonce, T1.acct.username) });
  assert(ok.ok && !!ok.token && !!ok.sessionKey, 'the right password signs in');
  const v = G.token.verify(ok.token, env.secret(), crypto, { nowMs: w.clock.now });
  assertEq([v.ok, v.claims.a, v.claims.s, v.claims.cv], [true, T1.acct.id, T1.stu.id, G.cv(T1.acct, crypto)],
    'its token verifies with Node\'s own crypto: the account, their student ID, the credential version');
  assertEq([ok.sessionKey, ok.lane, ok.account], [G.sessionKey(env.secret(), T1.acct.id, ok.sid, crypto), 'L-' + ok.sid, { id: T1.acct.id, studentId: T1.stu.id }],
    'the session key and lane are the ones Core.gate derives');
  assertEq(G.sid.check(ok.sid, env.secret(), crypto).iat, w.clock.now, 'the session id carries its own issue time');
  assertEq(w.post({ op: 'auth.password', login: T1.acct.username, nonce: st.nonce, proof: deviceProof(T1.pw, st, st.nonce, T1.acct.username) }).error,
    'bad-nonce', 'a nonce answers once: the same answer cannot be used again');
  assertEq(signIn(env, T1.acct.email.toUpperCase(), T1.pw).ok, true, 'the email as login, in any case');
  assertEq(signIn(env, T1.acct.username, 'wrong').error, 'no-match', 'a wrong password: no match');
  const T9 = C.trainees[9];
  const lst = w.post({ op: 'auth.start', login: T9.acct.username });
  assertEq([lst.algo, lst.salt], ['sha256-legacy', ''], 'a legacy SHA-256 account is challenged as one');
  assertEq(signIn(env, T9.acct.username, T9.pw).ok, true, 'and signs in');

  const u1 = w.post({ op: 'auth.start', login: 'nobody-here' }), u2 = w.post({ op: 'auth.start', login: 'NOBODY-HERE' });
  assertEq([u1.algo, u1.iter, /^[0-9a-f]{32}$/.test(u1.salt), u1.salt === u2.salt], ['pbkdf2-sha256', 210000, true, true],
    'an unknown login gets a believable challenge, the same each time');
  assertEq(signIn(env, 'nobody-here', 'x').error, 'no-match', 'and is refused like a wrong password');
  const T6 = C.trainees[6];
  const p6 = w.post({ op: 'auth.start', login: T6.acct.username });
  assertEq([p6.algo, p6.iter], ['pbkdf2-sha256', 210000], 'a plaintext stored password is never a usable challenge');
  const p6b = w.post({ op: 'auth.password', login: T6.acct.username, nonce: p6.nonce,
    proof: nodeCrypto.createHmac('sha256', 'plain-six').update('cestis-gate-v1|' + p6.nonce + '|' + T6.acct.username).digest('hex') });
  assertEq(p6b.error, 'no-match', 'and no answer opens it');
  const d5 = signIn(env, C.trainees[5].acct.username, C.trainees[5].pw);
  assertEq([d5.error, d5.why], ['ask-office', 'default-password'], 'a login still on a published default password: ask the office');
  assertEq(signIn(env, 'pend@mail.test', 'x').error, 'pending', 'a pending registration: pending (today\'s Awaiting Approval screen)');
  const amb = w.post({ op: 'auth.start', login: C.trainees[10].acct.username });
  assertEq([amb.error, amb.why], ['ask-office', 'ambiguous'], 'one login naming two trainees: ask the office');
  assertEq(signIn(env, 'lone01', 'lone-pw').error, 'not-ready', 'an account with no records published yet: not ready');
  assertEq(w.post({ op: 'auth.password', login: 'x', nonce: 'nope' }).error, 'bad-request', 'a malformed request is refused as one');
}

/* ======================================================== email sign-in */
function sEmail(src) {
  section('Email sign-in: tokeninfo must name our app and a verified address');
  const env = gateWorld(src), w = env.w, C = env.C, T1 = C.trainees[1];
  const info = (email, over) => Object.assign({ aud: CLIENT, azp: CLIENT, email, email_verified: 'true', expires_in: '3599',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid' }, over || {});
  w.tokeninfo['tok-good-01'] = info(T1.acct.email.toUpperCase());
  w.tokeninfo['tok-other-app'] = info(T1.acct.email, { aud: 'someone-else.apps.googleusercontent.com', azp: 'someone-else.apps.googleusercontent.com' });
  w.tokeninfo['tok-unverified'] = info(T1.acct.email, { email_verified: 'false' });
  w.tokeninfo['tok-expired-1'] = info(T1.acct.email, { expires_in: '0' });
  w.tokeninfo['tok-noscope-1'] = info(T1.acct.email, { scope: 'openid' });
  w.tokeninfo['tok-stranger'] = info('stranger@mail.test');
  w.tokeninfo['tok-email-only'] = info(C.trainees[7].acct.email);
  w.tokeninfo['tok-twostep-0'] = info(C.trainees[0].acct.email);
  const good = w.post({ op: 'auth.email', accessToken: 'tok-good-01' });
  assertEq([good.ok, good.account && good.account.id], [true, T1.acct.id], 'a good token signs the trainee in (the address in any case)');
  assertEq(w.fetches[w.fetches.length - 1].url, 'https://oauth2.googleapis.com/tokeninfo?access_token=tok-good-01', 'asked of tokeninfo');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-other-app' }).error, 'wrong-app', 'a token made for another app is refused');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-unverified' }).error, 'unverified-email', 'an unverified address is refused');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-expired-1' }).error, 'bad-token', 'an expired token is refused');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-noscope-1' }).error, 'bad-token', 'a token without the email scope is refused');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-made-up-x' }).error, 'bad-token', 'a token Google does not know is refused');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-stranger' }).error, 'not-found', 'an address with no trainee account: not found');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-email-only' }).ok, true, 'an account with no password signs in by email (allowNoPassword)');
  const ts = w.post({ op: 'auth.email', accessToken: 'tok-twostep-0' });
  assertEq([ts.ok, ts.need2fa], [true, true], 'email sign-in still asks for the second step');
}

/* ============================================================ two-step */
function sTwoStep(src) {
  section('Two-step: authenticator, backup and emailed codes, each once');
  const env = gateWorld(src), w = env.w, C = env.C, T0 = C.trainees[0];
  const n1 = signIn(env, T0.acct.username, T0.pw);
  assertEq([n1.ok, n1.need2fa, n1.methods, n1.email, !!n1.token], [true, true, ['totp', 'backup'], '', false],
    'the password alone does not sign in: authenticator or backup code');
  const bad = w.post({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code: '000000' });
  assertEq([bad.error, bad.triesLeft], ['bad-code', 4], 'a wrong code, and how many tries are left');
  const code = G.totp.code(T0.acct.twoFactorSecret, w.clock.now, crypto);
  const in1 = w.post({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code });
  assertEq([in1.ok, in1.account && in1.account.id], [true, T0.acct.id], 'the authenticator\'s code signs in');
  assertEq(w.post({ op: 'auth.2fa', ticket: n1.ticket, method: 'totp', code }).error, 'bad-ticket', 'a ticket is used once');
  const n2 = signIn(env, T0.acct.username, T0.pw);
  assertEq(w.post({ op: 'auth.2fa', ticket: n2.ticket, method: 'totp', code }).error, 'code-used', 'the same code is refused a second time in its step');
  assertEq(w.post({ op: 'auth.2fa', ticket: n2.ticket, method: 'email', code: '123456' }).error, 'not-allowed', 'an emailed code is not offered with an authenticator');
  const bc = T0.acct.backupCodes[0].code;
  const in2 = w.post({ op: 'auth.2fa', ticket: n2.ticket, method: 'backup', code: bc.toLowerCase() });
  assert(in2.ok, 'a backup code signs in');
  const h = G.codeHash(bc);
  assert(JSON.parse(w.props.store['spent:' + T0.acct.id]).indexOf(h) !== -1, 'and is spent at the gate at once');
  const laneFile = w.drive.child(folderOf(env, T0.acct.id).id, 'CESTISINBOX.L-' + in2.sid + '.json', 'file');
  const lane = w.drive.json(laneFile.id);
  assertEq(lane.ops.map(o => [o.kind, o.codeHash]), [['backupCodeUsed', h]], 'and written into the new session\'s lane for staff to burn');
  const col = G.collect([{ fileId: laneFile.id, version: '1', modifiedTime: iso(laneFile.updated), folderAcct: T0.acct.id, json: lane }],
    { accounts: C.store.voctrain_users, students: C.store.voctrain_students, deletedUserIds: [] });
  assertEq(col.ops.map(o => [o.me.acct, o.op.kind, o.op.codeHash]), [[T0.acct.id, 'backupCodeUsed', h]], 'which Stage 1\'s collector reads and accepts (gate-written)');
  const n3 = signIn(env, T0.acct.username, T0.pw);
  assertEq(w.post({ op: 'auth.2fa', ticket: n3.ticket, method: 'backup', code: bc }).error, 'bad-code', 'a spent backup code is refused');
  const forged = n3.ticket.replace(/^t2\.(.)/, (m, c) => 't2.' + (c === 'A' ? 'B' : 'A'));
  assertEq(w.post({ op: 'auth.2fa', ticket: forged, method: 'totp', code: '111111' }).error, 'bad-ticket', 'a tampered ticket is refused');
  w.advance(6 * MIN);
  assertEq(w.post({ op: 'auth.2fa', ticket: n3.ticket, method: 'totp', code: G.totp.code(T0.acct.twoFactorSecret, w.clock.now, crypto) }).error,
    'expired', 'a ticket lasts five minutes');

  const T2 = C.trainees[2];
  const e1 = signIn(env, T2.acct.username, T2.pw);
  const masked = T2.acct.email.charAt(0) + '•••' + T2.acct.email.slice(T2.acct.email.indexOf('@'));
  assertEq([e1.need2fa, e1.methods, e1.email], [true, ['backup', 'email'], masked], 'email codes: offered with the address masked');
  const sent = w.post({ op: 'auth.2fa.send', ticket: e1.ticket });
  assertEq([sent.ok, sent.to, w.mail.sent.length, w.mail.sent[0].to], [true, masked, 1, T2.acct.email], 'a code is emailed to the account\'s address');
  const mailed = /\b(\d{6})\b/.exec(w.mail.sent[0].body)[1];
  assert(!/google|drive|cloud|gate/i.test(w.mail.sent[0].body + w.mail.sent[0].subject), 'the email names no place and no system');
  assertEq(w.post({ op: 'auth.2fa.send', ticket: e1.ticket }).error, 'too-soon', 'not again within a minute');
  assertEq(w.post({ op: 'auth.2fa', ticket: e1.ticket, method: 'email', code: mailed === '000000' ? '000001' : '000000' }).error, 'bad-code', 'a wrong emailed code');
  assertEq(w.post({ op: 'auth.2fa', ticket: e1.ticket, method: 'email', code: mailed }).ok, true, 'the emailed code signs in');
  w.advance(61 * 1000);
  const e2 = signIn(env, T2.acct.username, T2.pw);
  w.post({ op: 'auth.2fa.send', ticket: e2.ticket });
  const code2 = /\b(\d{6})\b/.exec(w.mail.sent[1].body)[1];
  for (let k = 0; k < 5; k++) w.post({ op: 'auth.2fa', ticket: e2.ticket, method: 'email', code: String((Number(code2) + 1 + k) % 1000000).padStart(6, '0') });
  assertEq(w.post({ op: 'auth.2fa', ticket: e2.ticket, method: 'email', code: code2 }).error, 'bad-ticket', 'five wrong codes end the ticket, even for the right code after');
  assertEq(signIn(env, T2.acct.username, T2.pw).error, 'locked', 'and count against the account: it is locked like five wrong passwords');
  w.mail.quota = 0;
  w.advance(61 * 1000);
  w.cache.remove('f:' + Core.hashString('acct|' + T2.acct.id));    // (as if the 15 minutes had passed)
  const e3 = signIn(env, T2.acct.username, T2.pw);
  assertEq(w.post({ op: 'auth.2fa.send', ticket: e3.ticket }).error, 'mail-quota', 'no email codes left today: said so (backup codes still work)');
}

/* ===================================================== lock-out, busy */
function sLockout(src) {
  section('Lock-out: five wrong tries lock one login for 15 minutes; a flood of wrong passwords makes password sign-in busy');
  const env = gateWorld(src), w = env.w, C = env.C, T3 = C.trainees[3];
  for (let k = 0; k < 5; k++) assertEq(signIn(env, T3.acct.username, 'nope' + k).error, 'no-match', 'wrong try ' + (k + 1));
  const lk = w.post({ op: 'auth.start', login: T3.acct.username });
  assertEq([lk.error, lk.retryAfter], ['locked', 900], 'the sixth is locked');
  assertEq(signIn(env, T3.acct.username, T3.pw).error, 'locked', 'even the right password, while locked');
  assertEq(signIn(env, T3.acct.email, T3.pw).error, 'locked', 'and by the account\'s other login (the email): the account is locked, not the words typed');
  w.advance(16 * MIN);
  assertEq(signIn(env, T3.acct.username, T3.pw).ok, true, 'after 15 minutes the right password works');
  const T12 = C.trainees[12];
  let last = null;
  for (let k = 0; k < 21; k++) last = w.post({ op: 'auth.start', login: T12.acct.username });
  assertEq(last.error, 'locked', 'more than 20 challenges for one login in 15 minutes: locked');
  w.advance(16 * MIN);
  for (let k = 0; k < 61; k++) signIn(env, 'flood-' + k, 'x');
  assertEq(w.post({ op: 'auth.start', login: C.trainees[13].acct.username }).error, 'busy', 'over 60 wrong passwords a minute, all logins: password sign-in is busy');
  w.tokeninfo['tok-busy-ok'] = { aud: CLIENT, azp: CLIENT, email: C.trainees[13].acct.email, email_verified: 'true', expires_in: '3000', scope: 'email' };
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-busy-ok' }).ok, true, 'email sign-in still works meanwhile');
  w.advance(2 * MIN);
  assertEq(signIn(env, C.trainees[13].acct.username, C.trainees[13].pw).ok, true, 'and a minute later password sign-in is back');
}

/* ================================================ pull, refresh, revocation */
function sPull(src) {
  section('pull: the slice, "same" when the device has it, the overlay, a refreshed token — and revocation within a minute');
  const env = gateWorld(src), w = env.w, C = env.C, T1 = C.trainees[1];
  const s = signIn(env, T1.acct.username, T1.pw);
  const p = w.post({ op: 'pull', token: s.token });
  const published = sliceOf(env, T1.acct.id);
  assertEq([p.ok, p.h, p.slice], [true, published.hash, published], 'the trainee\'s own slice, as published');
  assertEq([p.overlay.lanes, p.overlay.results, p.token], [[], [], undefined], 'nothing sent yet; no new token needed');
  const same = w.post({ op: 'pull', token: s.token, have: published.hash });
  assertEq([same.same, same.slice], [true, undefined], 'a device that has it is told "same", without the slice');
  const sup = item(env, s, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-PULL-1', accountId: T1.acct.id, studentId: T1.stu.id, name: T1.stu.name,
    email: T1.acct.email, subject: 'Hello', message: 'A question', timestamp: w.clock.now } });
  assertEq(deliver(env, [sup]).receipts[0].ok, true, 'something sent…');
  const p2 = w.post({ op: 'pull', token: s.token, have: published.hash });
  assertEq(p2.overlay.lanes.map(l => [l.lane, (l.records.voctrain_support_messages || []).map(m => m.id)]), [['L-' + s.sid, ['SUP-PULL-1']]],
    '…comes back in the overlay until staff collect it');
  w.advance(9 * HOUR);
  const p3 = w.post({ op: 'pull', token: s.token, have: published.hash });
  assert(!!p3.token && p3.exp > G.token.verify(s.token, env.secret(), crypto, { nowMs: w.clock.now }).claims.exp, 'with less than four hours left, a fresh token');
  const v3 = G.token.verify(p3.token, env.secret(), crypto, { nowMs: w.clock.now });
  assertEq([v3.ok, v3.claims.sid, v3.claims.cv], [true, s.sid, G.cv(T1.acct, crypto)], 'for the same session');
  updateLedger(env, led => { const a = account(led, T1.acct.id); a.password = pbkdf2('new-pw', 'abcdefabcdefabcd', 1000); a.updatedAt = iso(w.clock.now); });
  assertEq(w.post({ op: 'pull', token: p3.token }).ok, true, 'a password reset is seen within the minute (not before)');
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'pull', token: p3.token }).error, 'revoked', 'then every token of the old password stops working');
  assertEq(signIn(env, T1.acct.username, 'new-pw').ok, true, 'and the new password signs in');
  const T2 = C.trainees[13];
  const s2 = signIn(env, T2.acct.username, T2.pw);
  updateLedger(env, led => { const a = account(led, T2.acct.id); a.status = 'disabled'; a.disabledAt = iso(w.clock.now); a.updatedAt = iso(w.clock.now); });
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'pull', token: s2.token }).error, 'revoked', 'switched off: revoked');
  assertEq(signIn(env, T2.acct.username, T2.pw).error, 'disabled', 'and sign-in says switched off');
  const T7 = C.trainees[16];
  w.tokeninfo['tok-deleted-16'] = { aud: CLIENT, email: T7.acct.email, email_verified: 'true', expires_in: '3000', scope: 'email' };
  const s7 = w.post({ op: 'auth.email', accessToken: 'tok-deleted-16' });
  const n7 = s7.need2fa ? w.post({ op: 'auth.2fa', ticket: s7.ticket, method: 'totp', code: G.totp.code(T7.acct.twoFactorSecret, w.clock.now, crypto) }) : s7;
  assert(n7.ok, 'a trainee signs in by email');
  updateLedger(env, led => { led.deletedUserIds.push(T7.acct.id); });
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'pull', token: n7.token }).error, 'revoked', 'deleted: revoked');
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-deleted-16' }).error, 'not-found', 'and gone from sign-in');
  const T8 = C.trainees[17];
  const s8 = signIn(env, T8.acct.username, T8.pw);
  w.advance(12 * HOUR + 1000);
  assertEq(w.post({ op: 'pull', token: s8.token }).error, 'expired', 'a token not refreshed for 12 hours expires');
  assertEq(w.post({ op: 'pull', token: s8.token.slice(0, -2) + '00' }).error, 'bad-token', 'a forged token is refused');
}

/* ===================================================== folders, versions */
function sFolders(src) {
  section('A trainee\'s folder is found by the account in its description — renamed, duplicated, or not yet indexed');
  const env = gateWorld(src), w = env.w, C = env.C, T = C.trainees[30];
  const s = signIn(env, T.acct.username, T.pw);
  const f = folderOf(env, T.acct.id), original = sliceOf(env, T.acct.id);
  const forget = () => { w.cache.clear(); delete w.props.store['fold:' + T.acct.id]; };
  f.name = 'STU-RENAMED-30';                                    // the student ID moved; the account did not
  forget();
  assertEq(w.post({ op: 'pull', token: s.token }).h, original.hash, 'a folder under another name is found by its description');
  assertEq(w.props.store['fold:' + T.acct.id], f.id, 'and remembered');
  const dup = w.drive.mkdir(env.cfg.traineesId, T.stu.id, { description: 'cestis-trainee acct=' + T.acct.id + ' v=1 duplicate-of=' + f.id });
  const other = J(original); other.hash = 'h1-different';
  w.drive.put(dup.id, 'from-centre.json', other);
  forget();
  assertEq(w.post({ op: 'pull', token: s.token }).h, original.hash, 'of two folders naming the account, the oldest is used (made in the same millisecond: the lower id, as staff devices choose)');
  w.drive.state.searchLagMs = 10 * MIN;
  const late = C.trainees[29], fl = folderOf(env, late.acct.id);
  fl.name = 'STU-NOT-INDEXED'; fl.updated = w.clock.now;        // renamed just now: the search has not caught up
  const sl = signIn(env, late.acct.username, late.pw);
  assertEq(sl.error, 'not-ready', 'a folder the search cannot see yet (and not under the account\'s student ID): not ready…');
  w.advance(11 * MIN);
  assertEq(signIn(env, late.acct.username, late.pw).ok, true, '…and found once the search has caught up');
  w.drive.state.searchLagMs = 0;

  section('A file of a newer version than the gate reads is never read as empty');
  const sf = w.drive.child(f.id, 'from-centre.json', 'file');
  w.drive.replace(sf.id, Object.assign(J(original), { version: 2 }));
  assertEq(w.post({ op: 'pull', token: s.token }).error, 'newer-version', 'a slice written by a newer dashboard: newer-version (the device keeps its last good copy)');
  w.advance(1000);
  w.drive.replace(sf.id, original);
  assertEq(w.post({ op: 'pull', token: s.token }).h, original.hash, 'and once a slice it reads is published again, that is served');
  const led = w.drive.json(env.ledger.id);
  w.drive.replace(env.ledger.id, { version: 2, accounts: [] });
  w.advance(61 * 1000);
  const kept = signIn(env, T.acct.username, T.pw);
  assertEq([kept.ok, kept.error], [true, undefined], 'an accounts list written by a newer dashboard: the last good copy is kept');
  w.cache.clear();
  assertEq(signIn(env, T.acct.username, T.pw).error, 'busy', 'with no good copy left, "busy" — never "no such account"');
  w.drive.replace(env.ledger.id, led);
  w.advance(61 * 1000);
  assertEq(signIn(env, T.acct.username, T.pw).ok, true, 'and all is well once the list is readable again');
}

/* ============================================================== deliver */
function sDeliver(src) {
  section('deliver: sealed items into the session\'s own lane — idempotent, owned, revocable, never lost');
  const env = gateWorld(src), w = env.w, C = env.C, T = C.trainees[14], O = C.trainees[20];
  const s = signIn(env, T.acct.username, T.pw);
  const sup = item(env, s, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-NEW-1', accountId: T.acct.id, studentId: T.stu.id, name: T.stu.name,
    email: T.acct.email, subject: 'Login', message: 'Help please', timestamp: w.clock.now } });
  const r1 = deliver(env, [sup]);
  assertEq(r1.receipts, [{ id: sup.id, ok: true }], 'a sealed record is accepted');
  const laneName = 'CESTISINBOX.L-' + s.sid + '.json';
  const lf = w.drive.child(folderOf(env, T.acct.id).id, laneName, 'file');
  const lane = w.drive.json(lf.id);
  assertEq([lane.format, lane.version, lane.accountId, lane.studentId, lane.lane, lane.records.voctrain_support_messages.map(m => m.id), !!lane.received[sup.id]],
    ['cestis-trainee-inbox', 1, T.acct.id, T.stu.id, 'L-' + s.sid, ['SUP-NEW-1'], true], 'into the session\'s own lane file, with its receipt time');
  const at = lf.updated;
  w.advance(1000);
  assertEq(deliver(env, [sup]).receipts, [{ id: sup.id, ok: true, dup: true }], 'the same item again: acknowledged, not taken twice');
  assertEq(w.drive.get(lf.id).updated, at, 'and the lane is not even written');
  const ann = sliceOf(env, T.acct.id).data.voctrain_announcements[0];
  const rd = item(env, s, 'op', { op: { id: 'OP-1', kind: 'read', key: 'voctrain_announcements', recId: ann.id, at: iso(w.clock.now) } });
  const rdBad = item(env, s, 'op', { op: { id: 'OP-2', kind: 'read', key: 'voctrain_announcements', recId: 'AN-NOT-MINE' } });
  const bcOp = item(env, s, 'op', { op: { id: 'OP-3', kind: 'backupCodeUsed', codeHash: 'h1-abc' } });
  const foreign = item(env, s, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-X', accountId: O.acct.id, studentId: O.stu.id, subject: 'x', message: 'y' } });
  const results = item(env, s, 'rec', { key: 'voctrain_examResults', rec: { id: 'RES-FAKE', studentId: T.stu.id, score: 100 } });
  const forgedSeal = Object.assign(item(env, s, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-F', accountId: T.acct.id, subject: 'a', message: 'b' } }), { mac: '0'.repeat(64) });
  const r2 = deliver(env, [rd, rdBad, bcOp, foreign, results, forgedSeal]);
  assertEq(r2.receipts.map(r => [r.ok, r.reason || '']), [[true, ''], [false, 'unknown-record'], [false, 'not-yours'], [false, 'not-yours'], [false, 'not-yours'], [false, 'bad-seal']],
    'a read mark of their own notice is kept; another\'s record, results, a backup-code note and a forged seal are refused');
  const lane2 = w.drive.json(lf.id);
  assertEq([lane2.ops.map(o => o.id), lane2.records.voctrain_support_messages.length], [['OP-1'], 1], 'only what was accepted is in the lane');

  const paper = sliceOf(env, T.acct.id).access.papers;
  assert(paper.indexOf(examOf(T)) !== -1, 'the trainee\'s exam is on their list');
  const pp = w.post({ op: 'paper', token: s.token, examId: examOf(T) }).paper;
  const stolen = attemptOf(env, pp, O, 'ATT-STOLEN');
  assertEq(deliver(env, [item(env, s, 'rec', { key: 'voctrain_examAttempts', rec: stolen })]).receipts[0].reason, 'not-yours', 'an attempt with another trainee\'s student ID is refused');
  const sOther = signIn(env, O.acct.username, O.pw);
  const posing = G.seal({ id: 'IT-POSE', a: O.acct.id, sid: s.sid, kind: 'rec', key: 'voctrain_support_messages',
    rec: { id: 'SUP-P', accountId: O.acct.id, subject: 'a', message: 'b' }, createdAt: iso(w.clock.now) }, s.sessionKey, crypto);
  assertEq(deliver(env, [posing]).receipts[0].ok, false, 'a session cannot speak for another account');
  assert(!!sOther.ok, '(that other trainee can sign in themselves)');

  section('deliver: too old, unknown sessions and revoked sessions — re-sealed and delivered after the next sign-in');
  const oldSid = G.sid.make(w.clock.now - 61 * DAY, G.cv(T.acct, crypto).slice(0, 12) + 'abcdefabcdef', env.secret(), crypto);
  const oldKey = G.sessionKey(env.secret(), T.acct.id, oldSid, crypto);
  const oldItem = G.seal({ id: 'IT-OLD', a: T.acct.id, sid: oldSid, kind: 'rec', key: 'voctrain_support_messages',
    rec: { id: 'SUP-OLD', accountId: T.acct.id, subject: 'a', message: 'b' }, createdAt: iso(w.clock.now - 61 * DAY) }, oldKey, crypto);
  assertEq(deliver(env, [oldItem]).receipts[0].reason, 'expired', 'an item from a session over 60 days old is refused');
  const alienSid = G.sid.make(w.clock.now, 'abcdefabcdefabcdefabcdef', 'another-secret', crypto);
  const alien = G.seal({ id: 'IT-ALIEN', a: T.acct.id, sid: alienSid, kind: 'op', op: { id: 'OP-A', kind: 'read', key: 'voctrain_announcements', recId: ann.id } },
    G.sessionKey('another-secret', T.acct.id, alienSid, crypto), crypto);
  assertEq(deliver(env, [alien]).receipts[0].reason, 'revoked', 'a session this gate never made (a new secret): revoked, so the device seals it again');
  const R = C.trainees[15];
  const sr = signIn(env, R.acct.username, R.pw);
  const pending = item(env, sr, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-R-1', accountId: R.acct.id, studentId: R.stu.id,
    subject: 'Sent late', message: 'From my phone', timestamp: w.clock.now } });
  updateLedger(env, led => { const a = account(led, R.acct.id); a.password = pbkdf2('reset-pw', '1234123412341234', 1000); a.updatedAt = iso(w.clock.now); });
  w.advance(61 * 1000);
  assertEq(deliver(env, [pending]).receipts[0].reason, 'revoked', 'after a password reset, items of the old session: revoked (kept in the outbox)');
  const sr2 = signIn(env, R.acct.username, 'reset-pw');
  const resealed = G.seal(Object.assign(J(pending), { sid: sr2.sid, mac: undefined }), sr2.sessionKey, crypto);
  assertEq(deliver(env, [resealed]).receipts[0], { id: pending.id, ok: true }, 'the next sign-in seals them again and they are delivered');
  const loneSid = G.sid.make(w.clock.now, 'abcdefabcdefabcdefabcdef', env.secret(), crypto);
  const lone = G.seal({ id: 'IT-LONE', a: 'USR-LONE', sid: loneSid, kind: 'op', op: { id: 'OP-L', kind: 'read', key: 'voctrain_announcements', recId: 'AN-2' } },
    G.sessionKey(env.secret(), 'USR-LONE', loneSid, crypto), crypto);
  const lr = deliver(env, [lone]).receipts[0];
  assertEq([lr.ok, lr.reason], [false, 'revoked'], 'a session whose credential version is not the account\'s: revoked');
  const loneSid2 = G.sid.make(w.clock.now, G.cv(C.lone, crypto).slice(0, 12) + 'abcdefabcdef', env.secret(), crypto);
  const lone2 = G.seal({ id: 'IT-LONE-2', a: 'USR-LONE', sid: loneSid2, kind: 'op', op: { id: 'OP-L2', kind: 'read', key: 'voctrain_announcements', recId: 'AN-2' } },
    G.sessionKey(env.secret(), 'USR-LONE', loneSid2, crypto), crypto);
  assertEq(deliver(env, [lone2]).receipts[0], { id: 'IT-LONE-2', ok: false, reason: 'not-ready', retry: true },
    'a good session whose records are not published (yet, or any more): not ready, try again — never refused');

  section('deliver: a failed write is answered retry, and nothing of it counts as received');
  const more = item(env, s, 'rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-NEW-2', accountId: T.acct.id, studentId: T.stu.id, subject: 'Two', message: 'Second' } });
  w.drive.state.failWrites = 1;
  assertEq(deliver(env, [more]).receipts[0], { id: more.id, ok: false, reason: 'retry', retry: true }, 'Drive refused the write: retry');
  assert(!w.drive.json(lf.id).received[more.id], 'and the lane does not hold it');
  assertEq(deliver(env, [more]).receipts[0], { id: more.id, ok: true }, 'the retry is accepted');
  const tab = deliver(env, [item(env, s, 'op', { op: { id: 'OP-T', kind: 'read', key: 'voctrain_announcements', recId: ann.id } })], 'tab2');
  assertEq([tab.receipts[0].ok, !!w.drive.child(folderOf(env, T.acct.id).id, 'CESTISINBOX.L-' + s.sid + '~tab2.json', 'file')], [true, true],
    'a tab without Web Locks writes its own lane (one writer per lane)');
  assertEq(deliver(env, [], '').error, 'bad-request', 'an empty delivery is refused as malformed');

  const files = inboxFiles(env, T.acct.id).map(f => ({ fileId: f.id, version: String(f.updated), modifiedTime: iso(f.updated), folderAcct: T.acct.id, json: w.drive.json(f.id) }));
  const col = G.collect(files, { accounts: C.store.voctrain_users, students: C.store.voctrain_students, deletedUserIds: [] });
  assertEq([(col.payload.data.supportMessages || []).map(m => m.id).sort(), col.refused, col.unassigned], [['SUP-NEW-1', 'SUP-NEW-2'], [], []],
    'Stage 1\'s collector reads the gate\'s lanes: every accepted record, nothing refused');
}

/* ================================================================ exams */
function sExams(src) {
  section('Papers only while the exam is open, by the gate\'s clock');
  const env = gateWorld(src, { now: NOW - 90 * MIN }), w = env.w, C = env.C, T = C.trainees[17];
  const s = signIn(env, T.acct.username, T.pw);
  const early = w.post({ op: 'paper', token: s.token, examId: examOf(T) });
  assertEq([early.error, early.status], ['not-open', 'upcoming'], 'before the start: not open');
  assertEq(w.post({ op: 'paper', token: s.token, examId: 'EX1' }).error, 'unknown-exam', 'another programme\'s exam is not on the list');
  assertEq(w.post({ op: 'paper', token: s.token, examId: '../key.EX3' }).error, 'unknown-exam', 'nor is a made-up name');
  w.advance(60 * MIN);                                                   // 14:30Z: open
  const pr = w.post({ op: 'paper', token: s.token, examId: examOf(T) });
  assertEq([pr.ok, pr.paper.examId, pr.centreUtcOffset, hasKey(pr.paper)], [true, examOf(T), '-05:00', false], 'open: the paper, and never a key');

  section('Saving and submitting: marked from the key, one result per attempt');
  const att = attemptOf(env, pr.paper, T, 'ATT-17A');
  const save = item(env, s, 'rec', { key: 'voctrain_examAttempts', rec: att });
  assertEq(deliver(env, [save]).receipts[0].ok, true, 'an attempt save is accepted');
  const lf = w.drive.child(folderOf(env, T.acct.id).id, 'CESTISINBOX.L-' + s.sid + '.json', 'file');
  assertEq(w.drive.json(lf.id).firstSeen['ATT-17A'], iso(w.clock.now), 'the gate notes when it first saw the attempt');
  const ag = w.post({ op: 'attempt.get', token: s.token, examId: examOf(T) });
  assertEq([ag.state, ag.attempt && ag.attempt.id, ag.attempt && ag.attempt.answers.filter(x => x !== null).length], ['attempt', 'ATT-17A', 8], 'attempt.get resumes it');
  const pumped = J(att); pumped.questions.forEach(q => { q.points = 1000; });
  w.advance(5 * MIN);
  const sub = item(env, s, 'submit', { attempt: pumped });
  const r1 = deliver(env, [sub]).receipts[0];
  const want = 'RES-G-' + crypto.sha256Hex('ATT-17A').slice(0, 16);
  assertEq([r1.ok, r1.result.id, r1.result.attemptId, r1.result.markedBy, r1.result.totalPoints, r1.result.earnedPoints, r1.result.pendingCount, r1.result.late],
    [true, want, 'ATT-17A', 'gate', 17, 11, 2, undefined], 'submitted: marked from the key — the points the copy claims are ignored');
  assert(!hasKey(r1.result), 'and the right answers are not shown while the exam is open');
  const rfs = inboxFiles(env, T.acct.id, 'CESTISINBOX.result.');
  assertEq(rfs.map(f => f.name), ['CESTISINBOX.result.ATT-17A.json'], 'the result is kept in the trainee\'s folder');
  const rfile = w.drive.json(rfs[0].id);
  assertEq([rfile.format, rfile.accountId, rfile.studentId, rfile.retired.status, rfile.retired.resultId], ['cestis-gate-result', T.acct.id, T.stu.id, 'submitted', want],
    'with the retired attempt');
  const again = deliver(env, [sub]).receipts[0];
  assertEq([again.ok, again.already, again.result], [true, true, r1.result], 'the same submit again: the same result');
  const sub2 = item(env, s, 'submit', { attempt: att });
  assertEq(deliver(env, [sub2]).receipts[0].result, r1.result, 'another submit of the same attempt: the same result');
  const sB = signIn(env, T.acct.username, T.pw);
  const attB = attemptOf(env, pr.paper, T, 'ATT-17B');
  const rB = deliver(env, [item(env, sB, 'submit', { attempt: attB })]).receipts[0];
  assertEq([rB.ok, rB.already, rB.result && rB.result.id], [true, true, want], 'a second device\'s own attempt at the same exam: the first result stands');
  assertEq(inboxFiles(env, T.acct.id, 'CESTISINBOX.result.').length, 1, 'one result file in all');
  assertEq(w.post({ op: 'attempt.get', token: s.token, examId: examOf(T) }).state, 'result', 'attempt.get now finds the result');
  const col = G.collect(rfs.map(f => ({ fileId: f.id, version: '1', modifiedTime: iso(f.updated), folderAcct: T.acct.id, json: w.drive.json(f.id) })),
    { accounts: C.store.voctrain_users, students: C.store.voctrain_students, deletedUserIds: [] });
  assertEq([col.payload.data.examResults.map(r => r.id), col.payload.data.examAttempts.map(a => a.status)], [[want], ['submitted']],
    'Stage 1\'s collector takes the result and the retired attempt');

  section('Two devices submitting the same attempt at the same moment get ONE result');
  const D = C.trainees[18];
  const dA = signIn(env, D.acct.username, D.pw), dB = signIn(env, D.acct.username, D.pw);
  const dPaper = w.post({ op: 'paper', token: dA.token, examId: examOf(D) }).paper;
  const dAtt = attemptOf(env, dPaper, D, 'ATT-18');
  deliver(env, [item(env, dA, 'rec', { key: 'voctrain_examAttempts', rec: dAtt })]);
  const subA = item(env, dA, 'submit', { attempt: dAtt }), subB = item(env, dB, 'submit', { attempt: dAtt });
  let inner = null;
  const hook = name => { if (name.indexOf('CESTISINBOX.result.') === 0) inner = deliver(env, [subB]); else w.drive.state.onCreateFile = hook; };
  w.drive.state.onCreateFile = hook;
  const outer = deliver(env, [subA]);
  assert(!!inner, '(the second submit ran while the first was writing its result)');
  assertEq([outer.receipts[0].ok, inner.receipts[0].ok], [true, true], 'both are answered');
  assertEq(outer.receipts[0].result, inner.receipts[0].result, 'with the same result, to the millisecond');
  const dfs = w.drive.children(folderOf(env, D.acct.id).id, 'file').filter(f => f.name === 'CESTISINBOX.result.ATT-18.json');
  assertEq([dfs.filter(f => !f.trashed).length, dfs.filter(f => f.trashed).length], [1, 1], 'one result file kept; the younger copy in the bin (never deleted)');

  section('Late answers are kept and flagged; right answers only once the exam has closed');
  const L = C.trainees[19], K = C.trainees[21];
  const sL = signIn(env, L.acct.username, L.pw), sK = signIn(env, K.acct.username, K.pw);
  const lAtt = attemptOf(env, w.post({ op: 'paper', token: sL.token, examId: examOf(L) }).paper, L, 'ATT-19');
  deliver(env, [item(env, sL, 'rec', { key: 'voctrain_examAttempts', rec: lAtt })]);
  const kAtt = attemptOf(env, w.post({ op: 'paper', token: sK.token, examId: examOf(K) }).paper, K, 'ATT-21');
  const kRes = deliver(env, [item(env, sK, 'submit', { attempt: kAtt })]).receipts[0].result;
  const rv1 = w.post({ op: 'review', token: sK.token, resultId: kRes.id });
  assertEq([rv1.ok, rv1.revealed, hasKey(rv1.result)], [true, false, false], 'review while the exam is open: no right answers');
  assertEq(w.post({ op: 'review', token: sK.token, resultId: r1.result.id }).error, 'not-found', 'another trainee\'s result is not found');
  w.clock.now = NOW + 33 * MIN;                                          // 15:33Z: closed at 15:30Z
  const lr = deliver(env, [item(env, sL, 'submit', { attempt: lAtt })]).receipts[0];
  assertEq([lr.ok, lr.result.late, lr.result.totalPoints], [true, true, 17], 'answers that arrive after the window (+2 min) are kept, flagged late');
  const rv2 = w.post({ op: 'review', token: sK.token, resultId: kRes.id });
  assertEq([rv2.revealed, rv2.result.answers.filter(a => a.questionId === 'EX1-Q1')[0].correctAnswer], [true, 0], 'after the close: the right answers');
  const shut = w.post({ op: 'paper', token: sK.token, examId: examOf(K) });
  assertEq([shut.error, shut.status], ['not-open', 'completed'], 'and no paper any more');
  const slr = sliceOf(env, K.acct.id).data.voctrain_examResults[0];
  const rv3 = w.post({ op: 'review', token: sK.token, resultId: slr.id });
  assertEq([rv3.ok, rv3.result.id], [true, slr.id], 'a result that came in the slice (marked on a lab PC) is served for review too');
  const whole = C.store.voctrain_examResults.filter(r => r.id === slr.id)[0];
  assertEq([rv3.revealed, hasKey(slr), hasKey(whole)], [true, false, true], '(its exam closed long ago; the slice\'s copy has no right answers, the Centre\'s has)');
  assertEq(rv3.result.answers, whole.answers, 'released: the right answers are put back from the key file, exactly as the Centre\'s whole copy has them');
}

/* ============================================================== uploads */
function sUploads(src) {
  section('Uploads: the allowed kinds, 5 MB, 50 a day, 100 MB a day; files only from the trainee\'s list or their own');
  const env = gateWorld(src), w = env.w, C = env.C, T = C.trainees[22];
  const s = signIn(env, T.acct.username, T.pw);
  const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 7) & 255));
  const up = w.post({ op: 'upload', token: s.token, name: 'Report 1.pdf', mime: 'application/pdf', base64: bytes.toString('base64'), purpose: 'submission', refId: 'ASG-2' });
  assertEq([up.ok, up.size, up.name], [true, 1024, 'ASG-2-Report 1.pdf'], 'a PDF is stored');
  const filesFolder = w.drive.child(folderOf(env, T.acct.id).id, 'files', 'folder');
  const stored = w.drive.get(up.fileId);
  assertEq([stored.parent, stored.content.equals(bytes), stored.mime], [filesFolder.id, true, 'application/pdf'], 'byte for byte, in the trainee\'s own files/ folder');
  const back = w.post({ op: 'file.get', token: s.token, fileId: up.fileId });
  assertEq([back.ok, back.base64, back.size], [true, bytes.toString('base64'), 1024], 'and read back by its owner');
  const subOk = item(env, s, 'rec', { key: 'voctrain_submissions', rec: { id: 'SUB-22-NEW', assignmentId: 'ASG-2', studentId: T.stu.id, submittedAt: iso(w.clock.now),
    comment: 'Done', driveFiles: [{ driveFileId: up.fileId, name: 'Report 1.pdf' }] } });
  const subBad = item(env, s, 'rec', { key: 'voctrain_submissions', rec: { id: 'SUB-22-BAD', assignmentId: 'ASG-2', studentId: T.stu.id,
    driveFiles: [{ driveFileId: 'FILE-' + C.trainees[3].acct.id, name: 'theirs.pdf' }] } });
  assertEq(deliver(env, [subOk, subBad]).receipts.map(r => [r.ok, r.reason || '']), [[true, ''], [false, 'not-own-file']],
    'a submission may name the trainee\'s own upload, never another trainee\'s file');
  w.drive.put('root', 'video.mp4', 'VIDEO', { id: 'FILE-VIDEO-2' });
  w.drive.put('root', 'notes.pdf', 'NOTES', { id: 'FILE-NOTES-1' });
  assertEq(w.post({ op: 'file.get', token: s.token, fileId: 'FILE-VIDEO-2' }).ok, true, 'a resource on the trainee\'s list is served');
  assertEq(w.post({ op: 'file.get', token: s.token, fileId: 'FILE-NOTES-1' }).error, 'not-yours', 'another programme\'s resource is not');
  const b64 = n => Buffer.alloc(n, 65).toString('base64');
  assertEq(w.post({ op: 'upload', token: s.token, name: 'run.exe', mime: 'application/octet-stream', base64: b64(10), purpose: 'submission' }).error, 'type-not-allowed', 'a program is refused');
  assertEq(w.post({ op: 'upload', token: s.token, name: 'photo.pdf', mime: 'image/png', base64: b64(10), purpose: 'submission' }).error, 'type-not-allowed', 'a kind that does not match its name is refused');
  assertEq(w.post({ op: 'upload', token: s.token, name: 'notes.txt', mime: '', base64: b64(10), purpose: 'chat', refId: 'chat-class-102' }).ok, true, 'a text file with no stated kind is taken as text');
  const big = w.post({ op: 'upload', token: s.token, name: 'big.pdf', mime: 'application/pdf', base64: b64(5 * 1024 * 1024 + 1), purpose: 'submission' });
  assertEq([big.error, big.max], ['too-large', 5 * 1024 * 1024], 'over 5 MB is refused');
  w.drive.state.failWrites = 1;
  assertEq(w.post({ op: 'upload', token: s.token, name: 'busy.pdf', mime: 'application/pdf', base64: b64(10), purpose: 'submission' }),
    { ok: false, error: 'busy', retry: true }, 'Drive refusing a write mid-upload: busy, try again (nothing counted)');
  let n = 2, last = null;
  while (n < 51) { last = w.post({ op: 'upload', token: s.token, name: 'p' + n + '.pdf', mime: 'application/pdf', base64: b64(100), purpose: 'submission' }); n++; }
  assertEq(last.error, 'quota', 'the 51st upload of the day is refused');
  w.cache.clear();
  assertEq(w.post({ op: 'upload', token: s.token, name: 'again.pdf', mime: 'application/pdf', base64: b64(100), purpose: 'submission' }).error, 'quota',
    'and a lost cache does not lift the limit (the folder itself is counted)');
  w.advance(DAY);
  w.cache.clear();
  const s2 = signIn(env, T.acct.username, T.pw);
  assertEq(w.post({ op: 'upload', token: s2.token, name: 'tomorrow.pdf', mime: 'application/pdf', base64: b64(100), purpose: 'submission' }).ok, true, 'the next day uploads work again');
  const B = C.trainees[23];
  const sb = signIn(env, B.acct.username, B.pw);
  const bf = w.drive.mkdir(folderOf(env, B.acct.id).id, 'files');
  w.drive.put(bf.id, 'earlier.zip', 'x', { size: 100 * 1024 * 1024 - 50 });
  assertEq(w.post({ op: 'upload', token: sb.token, name: 'more.pdf', mime: 'application/pdf', base64: b64(100), purpose: 'submission' }).error, 'quota', 'over 100 MB in a day is refused');
}

/* ===================================== rooms, sign-out, switches, checks */
function sMisc(src) {
  section('Rooms to their members; sign-out stops reads but still delivers what was sealed');
  const env = gateWorld(src), w = env.w, C = env.C, T = C.trainees[26];
  const s = signIn(env, T.acct.username, T.pw);
  const roomId = 'chat-class-103';
  const rm = w.post({ op: 'room.get', token: s.token, roomId });
  assertEq([rm.ok, rm.room.roomId, rm.room.members.indexOf(T.acct.id) !== -1], [true, roomId, true], 'a trainee gets their class room');
  assertEq(w.post({ op: 'room.get', token: s.token, roomId, have: rm.h }).same, true, 'or "same" when they have it');
  assertEq(w.post({ op: 'room.get', token: s.token, roomId: 'chat-class-101' }).error, 'unknown-room', 'never another programme\'s');
  const S = C.trainees[25];
  const so = signIn(env, S.acct.username, S.pw), other = signIn(env, S.acct.username, S.pw);
  const sealed = item(env, so, 'op', { op: { id: 'OP-SO', kind: 'read', key: 'voctrain_announcements', recId: sliceOf(env, S.acct.id).data.voctrain_announcements[0].id } });
  assertEq(w.post({ op: 'signOut', token: so.token }).ok, true, 'sign-out');
  assertEq(w.post({ op: 'pull', token: so.token }).error, 'signed-out', 'its token reads nothing more');
  w.cache.clear();
  assertEq(w.post({ op: 'pull', token: so.token }).error, 'signed-out', 'even when the cache is lost');
  assertEq(deliver(env, [sealed]).receipts[0].ok, true, 'what the session sealed before is still delivered');
  assertEq(w.post({ op: 'pull', token: other.token }).ok, true, 'the trainee\'s other session goes on');

  section('Switched off, old clients, and the live-check calls');
  const K = C.trainees[27];
  w.props.store.GATE_OFF = '1';
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'auth.start', login: K.acct.username }).error, 'off', 'GATE_OFF: sign-in answers off');
  assertEq(deliver(env, [item(env, other, 'op', { op: { id: 'OP-OFF', kind: 'read', key: 'voctrain_announcements', recId: 'AN-2' } })]).error, 'off',
    'and deliveries too (the outbox keeps them)');
  assertEq(w.get({ op: 'health' }).accepting, false, 'health says it is not accepting');
  assert(/Switched off/.test(w.get({ op: 'selfcheck' }).html), 'and so does the check page');
  delete w.props.store.GATE_OFF;
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'auth.start', login: K.acct.username }).ok, true, 'back on within a minute');
  const offFile = w.drive.put(env.cfg.rootId, 'gate-off', '');
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'auth.start', login: K.acct.username }).error, 'off', 'a "gate-off" file in the gate\'s folder switches it off');
  w.drive.get(offFile.id).trashed = true;
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'auth.start', login: K.acct.username }).ok, true, 'and binning it switches it on again');
  assertEq(w.post({ op: 'health', v: 2 }).error, 'client-too-old', 'a client of a protocol this gate does not speak: too old');
  w.props.store.MIN_CLIENT = '20261101a';
  w.advance(61 * 1000);
  assertEq([w.post({ op: 'health', client: '20261028b' }).error, w.post({ op: 'health', client: '20261102a' }).ok], ['client-too-old', true], 'MIN_CLIENT refuses older pages');
  delete w.props.store.MIN_CLIENT;
  assertEq(w.post({ op: 'what-is-this' }).error, 'unknown-op', 'an unknown call');
  assertEq(w.post('not json').error, 'bad-request', 'a body that is not JSON');
  const body = JSON.stringify({ op: 'diag.echo', pad: 'x'.repeat(7 * 1024 * 1024) });
  const echo = w.post(body);
  assertEq([echo.ok, echo.chars, echo.sha256], [true, body.length, crypto.sha256Hex(body)], 'diag.echo: a 7 MB request arrives whole (its length and digest)');
  w.tokeninfo['tok-diag'] = { aud: CLIENT, azp: CLIENT, email: K.acct.email, email_verified: 'true', expires_in: '3000', scope: 'email openid' };
  const ti = w.post({ op: 'diag.tokeninfo', accessToken: 'tok-diag' });
  assertEq([ti.ok, ti.audIsOurs, ti.emailVerified, ti.hasEmailScope, ti.fields.indexOf('aud') !== -1], [true, true, true, true, true], 'diag.tokeninfo: which fields tokeninfo gives');
  assert(JSON.stringify(ti).indexOf(K.acct.email) === -1, 'never the address itself');

  section('The check page shows counts only — no trainee is named on it');
  const page = w.get({ op: 'selfcheck' });
  const text = page.html;
  assertEq(page.title, 'Trainee sign-in from anywhere — check', 'its title');
  assert(/✓ Self-test passed/.test(text) && /✓ Name search finds/.test(text) && /✓ Description search finds/.test(text) && /Records published for 40 of 43 trainees/.test(text), 'self-test, live checks and counts');
  const leaks = [];
  C.trainees.forEach(t => [t.stu.name, t.stu.id, t.acct.id, t.acct.email, t.acct.username].forEach(v => { if (v && text.indexOf(v) !== -1) leaks.push(v); }));
  assertEq(leaks, [], 'no name, id, address or username of any trainee');
  assert(!/google|drive|\bgate\b/i.test(text.replace(/<style>[\s\S]*?<\/style>/, '')), 'and it names no place and no system');

  section('Live check 6 runs from the editor: one write a second for five minutes');
  const wr = w.ctx.gateSmokeWriteRate();
  assertEq([wr.writes, wr.errors], [300, 0], 'three hundred writes, none refused');
  assert(/✓ Write-rate check .*300 writes, 0 refused/.test(w.get({ op: 'selfcheck' }).html), 'and the check page shows it');
  w.drive.state.failWrites = 3;
  assertEq(w.ctx.gateSmokeWriteRate().errors, 3, 'refused writes are counted and reported');
}

/* ============================================ the paste itself, and both modes */
function sPaste() {
  section('PASTE-GATE.gs is what build-paste.js builds now, and carries cestis-core.js byte for byte');
  const committed = fs.readFileSync(paste.artifact, 'utf8');
  const mode = paste.modeOf(committed);
  assert(mode === 'allowlist' || mode === 'full', 'the paste says which mode it was built in: ' + mode);
  assert(committed === paste.build(mode), 'the committed PASTE-GATE.gs is up to date (run: npm run build:gate)');
  const prelude = committed.indexOf('appsscript-prelude.js'), core = committed.indexOf('======== cestis-core.js'), gate = committed.indexOf('======== trainee-gate/Gate.gs');
  assert(prelude !== -1 && prelude < core && core < gate, 'prelude first, then the rules, then Gate.gs');
  const coreText = fs.readFileSync(path.join(__dirname, '..', 'cestis-core.js'), 'utf8');
  const al = paste.allowlistCore(coreText);
  assert(al.chunks.every(c => coreText.indexOf(c.text) !== -1), 'every allowlisted part is a verbatim run of cestis-core.js');
  assertEq(al.chunks.map(c => c.name.split(' ')[0]), ['the', 'Core.naturalKey', 'Core.stableStudentId', 'Core.programmeIdentity', 'Core.accountLoginScore', 'Core.accountAccess', 'Core.exams', 'Core.enrolment', 'Core.gate'],
    'the parts: the helpers, the student ID (naturalKey, stableStudentId, programmeIdentity, enrolment), accountLoginScore, accountAccess, exams, gate');
  const gs = fs.readFileSync(path.join(__dirname, '..', 'trainee-gate', 'Gate.gs'), 'utf8');
  const used = new Set();
  for (const m of gs.matchAll(/\b(?:G\.core|CESTISCore)\.([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
  const carried = new Set(['hashString', 'normName', 'normCourse', 'naturalKey', 'stableStudentId', 'programmeIdentity', 'accountLoginScore', 'accountAccess', 'exams', 'enrolment', 'gate']);
  assertEq([...used].filter(u => !carried.has(u)), [], 'Gate.gs uses only modules the allowlist paste carries');
  const sizes = { allowlist: Buffer.byteLength(paste.build('allowlist')), full: Buffer.byteLength(paste.build('full')) };
  console.log('  paste size: allowlist ' + sizes.allowlist + ' bytes, full ' + sizes.full + ' bytes; left out: ' + al.missing.join(', '));
  return sizes;
}

/* ======================================== registration from home (§17) */
// The password as the dashboard stores one, worked out once (PBKDF2, 210 000 rounds).
const REG_PW = 'Shantelle-2026';
const REG_STORED = pbkdf2(REG_PW, '00112233445566778899aabbccddeeff', 210000);
function sRegister(src) {
  section('Registration from home: only with an email-account token; the registration AND the trainee\'s folder in one request; once per address');
  const env = gateWorld(src), w = env.w, C = env.C, cfg = env.cfg;
  const P = C.PROGRAMMES.map(p => p.name);
  const info = (email, over) => Object.assign({ aud: CLIENT, azp: CLIENT, email, email_verified: 'true', expires_in: '3599',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid' }, over || {});
  const EMAIL = 'shantelle.barrett@mail.test';
  w.tokeninfo['tok-reg-new1'] = info(EMAIL);
  w.tokeninfo['tok-reg-new2'] = info(EMAIL.toUpperCase());
  w.tokeninfo['tok-reg-wrong'] = info(EMAIL, { aud: 'someone-else.apps.googleusercontent.com', azp: 'someone-else.apps.googleusercontent.com' });
  w.tokeninfo['tok-reg-unver'] = info(EMAIL, { email_verified: 'false' });
  w.tokeninfo['tok-reg-has01'] = info(C.trainees[2].acct.email);
  w.tokeninfo['tok-reg-pend1'] = info(C.pending.email);
  const submit = over => w.post(Object.assign({ op: 'register.submit', accessToken: 'tok-reg-new1', name: 'Shantelle  Barrett', programme: P[0], phone: '876-555-0101', password: REG_STORED }, over || {}));
  const regFolder = () => w.drive.children(cfg.registrationsId, 'file').filter(f => /^CESTISREG\./.test(f.name));
  const traineeFolders = () => w.drive.children(cfg.traineesId, 'folder');

  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-new1' }).error, 'not-open', 'before staff publish the programmes: not open');
  assertEq(w.post({ op: 'catalogue' }), { ok: true, programmes: [] }, 'the catalogue answers without signing in — empty');
  w.drive.put(cfg.registrationsId, 'catalogue.json', G.reg.buildCatalogue([P[2], P[0]], w.clock.now));
  w.advance(61 * 1000);                                  // the gate remembers the catalogue for a minute
  assertEq(w.post({ op: 'catalogue' }), { ok: true, programmes: [P[2], P[0]].sort() }, 'the programmes taking trainees, as staff published them');

  section('Only a token Google gave this dashboard, for a verified address');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-wrong' }).error, 'wrong-app', 'a token made for another app is refused');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-unver' }).error, 'unverified-email', 'an unverified address is refused');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-made-up-1' }).error, 'bad-token', 'a token Google does not know is refused');
  assertEq(submit({ accessToken: 'tok-reg-wrong' }).error, 'wrong-app', 'and the same when sending the form');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-has01' }).error, 'has-account', 'an address that has an account: sign in');
  assertEq(submit({ accessToken: 'tok-reg-has01' }).error, 'has-account', 'and it cannot register a second one');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-pend1' }).error, 'pending', 'an account awaiting approval: says so');
  updateLedger(env, led => { account(led, C.trainees[4].acct.id).status = 'rejected'; });
  w.advance(61 * 1000);
  w.tokeninfo['tok-reg-rej01'] = info(C.trainees[4].acct.email);
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-rej01' }).error, 'rejected', 'a registration the office turned down: says so (no second try around it)');

  section('The form is checked: a full name, a programme on the list, a phone, the password as the dashboard stores it');
  const st = w.post({ op: 'register.start', accessToken: 'tok-reg-new1' });
  assertEq([st.ok, st.state, st.email, st.programmes], [true, 'new', EMAIL, [P[2], P[0]].sort()], 'a new address: the form, with the programmes');
  assertEq(submit({ name: 'Shantelle' }).field, 'name', 'a first name alone');
  assertEq(submit({ name: 'Shantelle <b>Barrett</b>' }).field, 'name', 'markup in a name');
  assertEq(submit({ programme: P[1] }).field, 'programme', 'a programme not taking trainees');
  assertEq(submit({ phone: 'call me' }).field, 'phone', 'a phone that is not one');
  assertEq(submit({ password: 'Shantelle-2026' }).field, 'password', 'a password as typed — never taken (it must arrive as its check)');
  assertEq(submit({ password: pbkdf2(REG_PW, '00112233445566778899aabbccddeeff', 1000) }).field, 'password', 'a check of too few rounds');
  assertEq([regFolder().length, traineeFolders().length], [0, 40], 'nothing made for a form that was refused');

  section('Sent: the registration and the trainee\'s folder, in the same request');
  const acct = G.reg.accountId(EMAIL, env.secret(), crypto), stu = Core.stableStudentId({ name: 'Shantelle Barrett', course: P[0] });
  const okr = submit();
  assertEq([okr.ok, okr.state, okr.email, okr.programme, !!okr.already], [true, 'submitted', EMAIL, P[0], false], 'it reaches the office');
  const files = regFolder();
  assertEq(files.map(f => f.name), [G.reg.fileName(acct)], 'Registrations/CESTISREG.<account id>.json');
  const reg = w.drive.json(files[0].id);
  assertEq([reg.format, reg.accountId, reg.studentId, reg.name, reg.email, reg.programme, reg.phone, reg.password, reg.googleVerified, reg.registeredVia, reg.status],
    ['cestis-registration', acct, stu, 'Shantelle Barrett', EMAIL, P[0], '876-555-0101', REG_STORED, true, 'home-registration', 'pending'], 'holding what the office needs — the password only as its check');
  assert(JSON.stringify(reg).indexOf(REG_PW) === -1, 'never the password itself');
  const mine = traineeFolders().filter(f => new RegExp('(^|\\s)acct=' + acct + '(\\s|$)').test(f.description));
  assertEq(mine.map(f => [f.name, f.description]), [['Shantelle Barrett (' + stu + ')', 'cestis-trainee acct=' + acct + ' v=1 registration=pending']],
    'and her own folder in Trainees/, named "<Name> (<student ID>)" — the dashboard\'s own student ID — and marked waiting');
  assertEq([reg.folderId, reg.folderName], [mine[0].id, mine[0].name], 'the registration names its folder');
  assertEq(G.reg.importOne(reg, C.store.voctrain_users, []).account.gateFolderId, mine[0].id, 'which the office\'s collector carries onto the account');

  section('Sent again — the same registration, never a second');
  const again = submit();
  assertEq([again.ok, again.state, again.already], [true, 'submitted', true], 'the same token again: "it has reached the office"');
  const again2 = submit({ accessToken: 'tok-reg-new2', name: 'Someone Else' });
  assertEq([again2.state, again2.already, again2.programme], ['submitted', true, P[0]], 'another sign-in for the same address (another case): the same registration, unchanged');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-new2' }).state, 'submitted', 'and starting again says it was sent');
  assertEq([regFolder().length, traineeFolders().length], [1, 41], 'still one registration and one folder');

  section('A write that fails half-way is finished by the next try — with the same folder');
  const E2 = 'kevaughn.blake@mail.test';
  w.tokeninfo['tok-reg-kev01'] = info(E2);
  w.drive.state.onCreateFile = () => { w.drive.state.failWrites = 1; };   // the registration file's write is refused
  const half = submit({ accessToken: 'tok-reg-kev01', name: 'Kevaughn Blake', programme: P[2], phone: '' });
  assertEq([half.ok, half.error, half.retry], [false, 'busy', true], 'a refused write: try again (nothing is said to have arrived)');
  assertEq([regFolder().length, traineeFolders().length], [1, 42], 'its folder was made, its registration not yet');
  const done = submit({ accessToken: 'tok-reg-kev01', name: 'Kevaughn Blake', programme: P[2], phone: '' });
  assertEq([done.ok, done.state, regFolder().length, traineeFolders().length], [true, 'submitted', 2, 42], 'the next try keeps it — in the folder already made, not a second');
  assertEq(w.drive.json(regFolder().filter(f => f.name.indexOf(G.reg.accountId(E2, env.secret(), crypto)) !== -1)[0].id).folderName,
    'Kevaughn Blake (' + Core.stableStudentId({ name: 'Kevaughn Blake', course: P[2] }) + ')', 'and names it');

  section('Limits: a few tries an hour for one address; a ceiling for everybody');
  w.tokeninfo['tok-reg-lim01'] = info('limit@mail.test');
  const tries = [];
  for (let i = 0; i < 6; i++) { w.drive.state.failWrites = 1; tries.push(submit({ accessToken: 'tok-reg-lim01', name: 'Lim Ited' }).error); }
  assertEq(tries, ['busy', 'busy', 'busy', 'busy', 'busy', 'too-many'], 'five tries an hour for one address, then "too many"');
  w.drive.state.failWrites = 0;
  w.tokeninfo['tok-reg-cap01'] = info('cap@mail.test');
  w.cache.put('rgh:' + Math.floor(w.clock.now / 3600000), '60', 3600);
  assertEq(submit({ accessToken: 'tok-reg-cap01', name: 'Cap Reached' }).error, 'too-many', 'sixty registrations an hour for everybody (each makes a folder)');

  section('Approved and published: she signs in with that account, and with her password');
  updateLedger(env, led => {
    led.accounts.push({ id: acct, name: 'Shantelle Barrett', role: 'student', username: 'shantelle.barrett', email: EMAIL, programme: P[0], status: 'pending',
      password: REG_STORED, registeredVia: 'home-registration', googleVerified: true, gateFolderId: mine[0].id });
  });
  w.advance(61 * 1000);
  assertEq(w.post({ op: 'auth.email', accessToken: 'tok-reg-new1' }).error, 'pending', 'collected, not yet approved: "awaiting approval"');
  assertEq(w.post({ op: 'register.start', accessToken: 'tok-reg-new1' }).error, 'pending', 'and registering again says the same');
  C.store.voctrain_students.push({ id: stu, name: 'Shantelle Barrett', course: P[0], stage: 'training', email: EMAIL, lastModified: iso(w.clock.now) });
  C.store.voctrain_users.push({ id: acct, name: 'Shantelle Barrett', role: 'student', username: 'shantelle.barrett', email: EMAIL, programme: P[0], status: 'active',
    password: REG_STORED, studentDataId: stu, registeredVia: 'home-registration', gateFolderId: mine[0].id });
  updateLedger(env, led => { const a = account(led, acct); a.status = 'active'; a.studentDataId = stu; a.approvedAt = '2026-11-02'; });
  w.advance(61 * 1000);
  env.publish();
  assertEq(traineeFolders().length, 42, 'the office publishes into the folder made at her registration (no second one)');
  const em = w.post({ op: 'auth.email', accessToken: 'tok-reg-new1' });
  assertEq([em.ok, em.account && em.account.id, em.account && em.account.studentId], [true, acct, stu], 'signed in with her email account');
  const pw = signIn(env, EMAIL, REG_PW);
  assertEq([pw.ok, pw.account && pw.account.id], [true, acct], 'and with the password she chose at home');
  assertEq(w.post({ op: 'pull', token: pw.token }).slice.studentId, stu, 'her own records');
}

function runAll(src) {
  TRANSCRIPT = []; itemSeq = 0;
  sSetup(src); sPassword(src); sEmail(src); sTwoStep(src); sLockout(src); sPull(src); sFolders(src); sDeliver(src); sExams(src); sUploads(src); sMisc(src); sRegister(src);
  return TRANSCRIPT;
}

(function main() {
  sPaste();
  const committed = fs.readFileSync(paste.artifact, 'utf8');
  MODE = paste.modeOf(committed) || 'allowlist';
  const first = runAll(committed);
  const other = MODE === 'full' ? 'allowlist' : 'full';
  section('The same scenario on the ' + other + ' paste gives the same answers, byte for byte');
  VERBOSE = false; MODE = other;
  const second = runAll(paste.build(other));
  VERBOSE = true;
  assertEq(second.length, first.length, 'the same number of answers');
  let diff = -1;
  for (let i = 0; i < first.length; i++) if (JSON.stringify(first[i]) !== JSON.stringify(second[i])) { diff = i; break; }
  assert(diff === -1, 'every answer the same' + (diff === -1 ? '' : ' (first difference at answer ' + diff + ': ' + JSON.stringify(first[diff]).slice(0, 200) + ' vs ' + JSON.stringify(second[diff]).slice(0, 200) + ')'));
  const internal = first.concat(second).filter(r => r && r.error === 'internal');
  assertEq(internal.length, 0, 'and no request ended in an internal error');
  const strays = [].concat.apply([], WORLDS.map(x => x.errors)).filter(e => /not in the gate's paste/.test(e));
  assertEq(strays, [], 'nothing the gate did needed a module the allowlist paste leaves out');
  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
