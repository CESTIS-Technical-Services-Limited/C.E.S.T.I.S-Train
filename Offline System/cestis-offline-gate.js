/* ============================================================================
   cestis-offline-gate.js — the trainee gate, on the Centre's own server.

   WHAT IT IS
   ----------
   Through the "trainee gate" (docs/trainee-gate/DESIGN.md in the main
   repository) a trainee's device is given ONLY that trainee's own records,
   and everything the trainee sends back is checked before it joins the
   Centre's. Online the gate is a small Google script. This file is the same
   gate for devices on the Centre's own network: the same requests, the same
   answers, and the same rules — CESTISCore.gate in cestis-core.js, the very
   file every page loads — so a device has one way of talking to either.
   cestis-offline-server.js serves it at

       POST /_cestis/gate        { op, ... }  → { ok, ... }   (JSON both ways)
       GET  /_cestis/gate        the health answer;  ?op=selfcheck  a small
                                 page for the administrator (counts only)

   WHAT IS DIFFERENT HERE (DESIGN.md §6)
   -------------------------------------
   - Nobody has to publish anything. This computer holds all of the Centre's
     records, so a trainee's own records (their "slice") are BUILT WHEN THEY
     ASK, from data/CESTIS_LMS_Dashboard.json (Core.gate.prepare / sliceFor),
     read again only when that file changes. Papers and answer keys come
     from the same file; an answer key never leaves this computer.
   - What a trainee sends (sealed "items") is checked with
     Core.gate.validateItem and merged STRAIGHT INTO that file by the store's
     own record rules (cestis-offline-store.js) — this server is the single
     writer, every device then sees it on its next refresh, and the previous
     version is kept in data/.history like every other save.
   - Tests are marked here, from the exam's own key (Core.gate.markAttempt):
     points come from the key, never from the trainee's copy; one result per
     attempt; answers that arrive late are kept and flagged, never refused.
   - Sessions are signed with cert/gate-secret: 64 hex characters made on
     first run (like cert/host-secret), never served, never in the
     repository, never shown. A password reset, a switch-off or a two-step
     change ends every session of that account at its next request.
   - The device proves its password the same way it does online (a
     challenge; the password itself never travels): one way for the client
     to work, wherever it is.
   - What needs the internet or Google Drive — signing in with an email
     account, emailed codes, uploading and fetching files — answers
     { ok: false, error: 'unavailable' } here.

   THE REQUESTS (op)
   -----------------
     health                → { ok, service, version, protocol, time, ready, accepting, staffOnly }
     auth.start  {login}   → { ok, nonce, algo, iter, salt }
     auth.password {login, nonce, proof}
                           → { ok, token, sessionKey, sid, accountId, studentId, exp }
                             | { ok, need2fa, ticket, methods } | { ok:false, error }
     auth.2fa {ticket, code}            → the same as a password sign-in
     pull {token, hash?}   → { ok, slice, token? }  ({ ok, same, hash } when unchanged)
     deliver {items}       → { ok, results: [{ id, ok, reason?, known?, result?, state? }] }
     attempt.get {token, examId}        → { ok, state, result? | retired? | attempt?, ids? }
     paper.get {token, examId}          → { ok, paper } | { ok:false, error:'not-open' }
     review {token, resultId}           → { ok, result }  (right answers only once released)
     room.get {token, roomId, sinceEtag?} → { ok, room, etag } | { ok, same, etag }
     auth.email, auth.2fa.send, upload, file.get → { ok:false, error:'unavailable' }
   Every answer also carries `time`, this server's clock. A request the gate
   cannot read is a 400; every answer to a request it could read is a 200,
   as online (a script there cannot answer with anything else).
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const GATE_VERSION = 1;
const PROTOCOL = [1];
const LMS_FILE = 'CESTIS_LMS_Dashboard.json';
const BODY_MAX = 8 * 1024 * 1024;            // a request (DESIGN.md §3.4: ≤ 8 MB)
const MAX_ITEMS = 200;                         // items in one delivery
const CTX_MS = 30 * 1000;                      // a built pass is reused this long while nothing changes
const NONCE_MS = 120 * 1000;                   // a password challenge is good for two minutes, once
const TICKET_MS = 5 * 60 * 1000;               // the two-step ticket
const LOCK_FAILS = 5, LOCK_MS = 15 * 60 * 1000; // five wrong answers: that login waits 15 minutes
const START_MAX = 20;                          // challenges asked for one login in 15 minutes
const BUSY_PER_MIN = 60;                       // wrong passwords a minute, across every login
const MAP_CAP = 20000;                         // bookkeeping never grows without bound

/* ---- Node's cryptography in the shape Core.gate asks for. A key is the
   UTF-8 bytes of its text (Core.gate passes them in already). ---- */
const crypto = {
  hmacHex: (keyBytes, msg) => nodeCrypto.createHmac('sha256', Buffer.from(keyBytes)).update(String(msg), 'utf8').digest('hex'),
  sha256Hex: msg => nodeCrypto.createHash('sha256').update(String(msg), 'utf8').digest('hex'),
  sha1Bytes: bytes => Array.from(nodeCrypto.createHash('sha1').update(Buffer.from(bytes)).digest())
};

/* The secret that signs sessions: made once, kept in cert/ next to the
   certificate and the access token (never served — cestis-offline-server.js
   refuses the whole folder — and git-ignored). */
function loadOrCreateSecret(certDir) {
  const file = path.join(certDir, 'gate-secret');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{64}$/.test(t)) return t;
  } catch (e) {}
  const t = nodeCrypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(certDir, { recursive: true }); fs.writeFileSync(file, t + '\n', { mode: 0o600 }); } catch (e) {}
  return t;
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return v == null ? '' : String(v); }
function lower(v) { return str(v).trim().toLowerCase(); }
function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function iso(ms) { return new Date(ms).toISOString(); }
function parseValue(v) {
  if (typeof v !== 'string') return v == null ? null : v;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function isPage(p) { return isObj(p) && isObj(p.data); }
function prune(map, now) {
  if (map.size < MAP_CAP) return;
  map.forEach((v, k) => { if (!v || (typeof v.exp === 'number' && v.exp < now) || (typeof v === 'number' && v < now)) map.delete(k); });
  if (map.size >= MAP_CAP) map.clear();
}

/* opts: {
     core      the CESTISCore the server loaded (cestis-core.js)
     store     cestis-offline-store.js
     dataDir   the records folder;  certDir  where the secrets live;  rootDir  this folder
     accounts  () → every account the data folder holds (the server's centreAccounts():
               the newest copy of each, from both files that carry them)
     staffOnly () → is the staff-only switch on (reported by health)
     send      the server's send(res, status, body, type)
     now       () → ms (the clock; tests may hand in their own)
     log       (line) → void
   } */
function create(opts) {
  const Core = opts.core || null;
  const G = Core && Core.gate ? Core.gate : null;
  const store = opts.store;
  const dataDir = opts.dataDir, rootDir = opts.rootDir || __dirname;
  const LMS = path.join(dataDir, LMS_FILE);
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const accounts = typeof opts.accounts === 'function' ? opts.accounts : () => [];
  const staffOnly = typeof opts.staffOnly === 'function' ? opts.staffOnly : () => false;
  const SECRET = loadOrCreateSecret(opts.certDir || path.join(rootDir, 'cert'));
  const hmac = msg => crypto.hmacHex(G.utf8(SECRET), msg);

  // A runtime that computes the known answers differently must not run the gate.
  let selfOk = false;
  try { selfOk = !!G && G.selfTest(crypto).ok === true; } catch (e) { selfOk = false; }
  if (G && !selfOk) log('The trainee sign-in check failed its own self-test on this computer; trainee sign-in through this server is off.');

  // The administrator's kill switch (DESIGN.md §10.5): a file named gate-off beside index.html.
  const killed = () => { try { return fs.existsSync(path.join(rootDir, 'gate-off')); } catch (e) { return false; } };

  /* ---------------------------------------------------------- the records */
  function statStamp(file) {
    try { const st = fs.statSync(file); return st.mtimeMs + ':' + st.size; }
    catch (e) { if (e && e.code === 'ENOENT') return 'none'; throw e; }
  }
  function parsePage(text) {
    if (text == null) return null;
    let p;
    try { p = JSON.parse(text); } catch (e) { throw new Error('the records file could not be read'); }
    return isPage(p) ? p : null;
  }
  let lms = { stamp: null, payload: null };
  function readLms(stamp) {
    if (stamp === lms.stamp) return lms.payload;
    // Only a file that is not there is "no records"; one that is there but
    // cannot be read right now fails the request, and the device asks again.
    const payload = stamp === 'none' ? null : parsePage(fs.readFileSync(LMS, 'utf8'));
    lms = { stamp, payload };
    return payload;
  }

  /* One pass over the Centre's records (Core.gate.prepare), kept until the
     records file changes, or for CTX_MS at most (what an exam shows depends
     on the clock). The whole-store mirror (CESTIS_ALL_DATA.json), which also
     carries the accounts, changes with nearly every device's save, so it is
     read again on that clock only: an account changed only there (a
     password reset) still ends its sessions within half a minute, inside
     the minute DESIGN.md §4.4 allows. Inside a save the stored text handed
     over by the store is the truth; outside one, the file as it is now. */
  let cache = { key: null };
  function context(t, storedText) {
    const lmsStamp = statStamp(LMS);
    const key = lmsStamp + '|' + Math.floor(t / CTX_MS);
    if (cache.key === key) return cache;
    const payload = storedText !== undefined ? parsePage(storedText) : readLms(lmsStamp);
    const map = Object.assign({}, payload ? payload.data : {});
    map.voctrain_users = accounts();
    const ctx = G.prepare(map, t, { builtBy: 'centre-server' });
    // Collections read on demand, once per pass: list(k) of records, mapOf(k) of keyed values.
    const memo = {};
    const read = k => { if (!(k in memo)) memo[k] = parseValue(map[k]); return memo[k]; };
    const list = k => { const v = read(k); return Array.isArray(v) ? v.filter(isObj) : []; };
    const mapOf = k => { const v = read(k); return isObj(v) ? v : {}; };
    // The trainee accounts, as sign-in sees them: deleted accounts are gone.
    const delIds = read('voctrain_deletedUserIds'), del = {};
    (Array.isArray(delIds) ? delIds : []).forEach(id => { if (id != null && id !== '') del[id] = true; });
    const users = Array.isArray(map.voctrain_users) ? map.voctrain_users : [];
    const trainees = Core.accountAccess.dropDeleted(users, del).accounts.filter(a => isObj(a) && lower(a.role) === 'student' && a.id != null);
    const byId = {};
    trainees.forEach(a => { byId[str(a.id)] = a; });
    cache = {
      key, ctx, payload, map, list, mapOf, trainees, byId,
      cvOf: id => (byId[str(id)] ? G.cv(byId[str(id)], crypto) : null),
      exam: id => list('voctrain_exams').filter(e => str(e.id) === str(id) && e.status !== 'draft' && e.status !== 'cancelled')[0] || null,
      slices: {}
    };
    return cache;
  }
  // A trainee's own records, built now (once per pass and account).
  function sliceOf(c, acct) {
    const k = str(acct);
    if (!(k in c.slices)) { const r = G.sliceFor(c.ctx, k); c.slices[k] = r ? r.slice : null; }
    return c.slices[k] ? copy(c.slices[k]) : null;
  }

  /* What to merge into the records file: the stored copy says what it is
     (page, file, version — kept as they are), and only the collections this
     request touched are sent, each stamped just after whatever the file
     already says about it, so the record rules take this server's copy
     where two copies tie. */
  function payloadWith(stored, values, t) {
    const out = {};
    Object.keys(stored).forEach(k => { if (k !== 'data' && k !== 'stamps' && k !== 'keyCount') out[k] = stored[k]; });
    out.stamps = {}; out.data = {};
    Object.keys(values).forEach(k => {
      out.data[k] = typeof values[k] === 'string' ? values[k] : JSON.stringify(values[k]);
      const prev = Date.parse((isObj(stored.stamps) && stored.stamps[k]) || '') || 0;
      out.stamps[k] = iso(Math.max(t, prev + 1));
    });
    return out;
  }
  function saveRecords(build) {
    return store.save({ file: LMS, dataDir, core: Core, incoming: build });
  }

  /* ------------------------------------------------------------ sign-in */
  const nonces = new Map();     // nonce → { login, exp }
  const fails = new Map();      // who → { n, since, until }
  const starts = new Map();     // who → { n, since }
  const usedSteps = new Map();  // account|step → exp (a two-step code once only)
  const usedTickets = new Map();// ticket → exp
  const spent = new Map();      // account → Set of spent backup codes (until the file has them)
  let recentFails = [];

  const whoKey = (account, login) => (account ? 'a:' + str(account.id) : 'l:' + lower(login));
  const lockedNow = (who, t) => { const f = fails.get(who); return !!(f && f.until > t); };
  function failed(who, t) {
    let f = fails.get(who);
    if (!f || t - f.since > LOCK_MS) f = { n: 0, since: t, until: 0 };
    f.n++;
    if (f.n >= LOCK_FAILS) f.until = t + LOCK_MS;
    fails.set(who, f);
    prune(fails, t);
    recentFails.push(t);
    return f.until > t;
  }
  function busy(t) {
    recentFails = recentFails.filter(x => t - x < 60000);
    return recentFails.length > BUSY_PER_MIN;
  }

  /* Which trainee account a typed login names. Two usable accounts behind
     one email or username: the office has to sort that out. */
  function findLogin(c, login) {
    const want = lower(login);
    const hits = c.trainees.filter(a => lower(a.username) === want || lower(a.email) === want);
    if (hits.length <= 1) return { account: hits[0] || null };
    const usable = hits.filter(a => Core.accountAccess.check(a).allowed);
    if (usable.length > 1) return { ambiguous: true, account: null };
    return { account: usable[0] || Core.accountAccess.find(hits, 'student', want) };
  }

  function authStart(body, t) {
    const login = lower(body.login);
    if (!login || login.length > 254) return { ok: false, error: 'bad-request' };
    const c = context(t);
    const f = findLogin(c, login);
    const who = whoKey(f.account, login);
    if (lockedNow(who, t)) return { ok: false, error: 'locked' };
    let s = starts.get(who);
    if (!s || t - s.since > LOCK_MS) s = { n: 0, since: t };
    s.n++;
    starts.set(who, s);
    prune(starts, t);
    if (s.n > START_MAX) {
      fails.set(who, { n: LOCK_FAILS, since: t, until: t + LOCK_MS });
      return { ok: false, error: 'locked' };
    }
    // An unknown login is given a salt that looks like any other and is the
    // same every time, so the answer never says whether the account exists.
    const ch = G.proof.challenge(f.account && !f.ambiguous ? f.account.password : null, login, SECRET, crypto);
    const nonce = nodeCrypto.randomBytes(16).toString('hex');
    nonces.set(nonce, { login, exp: t + NONCE_MS });
    prune(nonces, t);
    return { ok: true, nonce, algo: ch.algo, iter: ch.iter, salt: ch.salt };
  }

  function authPassword(body, t) {
    const login = lower(body.login), nonce = str(body.nonce);
    if (!login || !nonce || typeof body.proof !== 'string') return { ok: false, error: 'bad-request' };
    if (busy(t)) return { ok: false, error: 'busy' };
    const c = context(t);
    const f = findLogin(c, login);
    const who = whoKey(f.account, login);
    if (lockedNow(who, t)) return { ok: false, error: 'locked' };
    const n = nonces.get(nonce);
    nonces.delete(nonce);                               // a challenge answers once
    if (!n || n.exp < t || n.login !== login) return { ok: false, error: 'expired-challenge' };
    if (f.ambiguous) return { ok: false, error: 'ask-office' };
    const a = f.account;
    if (!a || !G.proof.verify(a.password, nonce, login, body.proof, crypto)) {
      return { ok: false, error: failed(who, t) ? 'locked' : 'wrong-password' };
    }
    fails.delete(who);
    return admit(c, a, t);
  }

  /* The password (or email) is right: may this account come in, and does it
     need its second step? The office's own reasons come back by name. */
  function admit(c, a, t) {
    const check = Core.accountAccess.check(a);
    if (!check.allowed) return { ok: false, error: check.reason };
    // A password the office set to be changed at first sign-in, or one the
    // platform shipped with, cannot be changed through the gate.
    if (a.defaultPassword === true || Core.accountAccess.isPublishedDefault(a.password)) return { ok: false, error: 'default-password' };
    if (a.mustChangePassword) return { ok: false, error: 'must-change-password' };
    if (!sliceOf(c, a.id)) return { ok: false, error: 'not-ready' };
    const totpOn = !!(a.twoFactorEnabled && a.twoFactorSecret);
    const emailOn = !!a.emailOtpLogin && !!str(a.email).trim();
    if (!totpOn && !emailOn) return session(c, a, t);
    const methods = [];
    if (totpOn) methods.push('totp');
    // Emailed codes need the internet; backup codes stand in for them here.
    if (unusedBackupCodes(a).length) methods.push('backup');
    if (!methods.length) return { ok: false, error: 'two-step-unavailable' };
    return { ok: true, need2fa: true, ticket: makeTicket(a, methods, t), methods };
  }
  function unusedBackupCodes(a) {
    const gone = spent.get(str(a.id));
    return (Array.isArray(a.backupCodes) ? a.backupCodes : []).filter(b => b && b.code && !b.used && !(gone && gone.has(G.codeHash(b.code))));
  }

  /* The two-step ticket: t2.<base64url(canon {a, cv, exp, m})>.<HMAC hex>. */
  function makeTicket(a, methods, t) {
    const body = G.b64url(G.utf8(G.canon({ a: str(a.id), cv: G.cv(a, crypto), exp: t + TICKET_MS, m: methods })));
    return 't2.' + body + '.' + hmac('t2|' + body);
  }
  function readTicket(ticket, t) {
    const p = str(ticket).split('.');
    if (p.length !== 3 || p[0] !== 't2' || !/^[0-9a-f]{64}$/.test(p[2]) || !G.same(hmac('t2|' + p[1]), p[2])) return null;
    let claims = null;
    try { const bytes = G.unb64url(p[1]); claims = bytes ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null; } catch (e) { claims = null; }
    if (!isObj(claims) || typeof claims.exp !== 'number' || claims.exp <= t || !claims.a || !Array.isArray(claims.m)) return null;
    return claims;
  }

  function authTwoStep(body, t) {
    const ticket = str(body.ticket), code = str(body.code).replace(/\s+/g, '');
    if (!ticket || !code) return { ok: false, error: 'bad-request' };
    const tk = readTicket(ticket, t);
    if (!tk || usedTickets.has(ticket)) return { ok: false, error: 'expired-challenge' };
    const c = context(t);
    const a = c.byId[str(tk.a)];
    if (!a || !G.same(G.cv(a, crypto), tk.cv)) return { ok: false, error: 'revoked' };
    const who = whoKey(a);
    if (lockedNow(who, t)) return { ok: false, error: 'locked' };
    let ok = false, backup = null;
    if (tk.m.indexOf('totp') !== -1 && /^\d{6}$/.test(code)) {
      const v = G.totp.verify(a.twoFactorSecret, code, t, crypto, { used: step => usedSteps.has(str(a.id) + '|' + step) });
      if (v.ok) { ok = true; usedSteps.set(str(a.id) + '|' + v.step, t + 5 * 60 * 1000); prune(usedSteps, t); }
    }
    if (!ok && tk.m.indexOf('backup') !== -1) {
      backup = unusedBackupCodes(a).filter(b => G.same(str(b.code).trim().toUpperCase(), code.toUpperCase()))[0] || null;
      ok = !!backup;
    }
    if (!ok) return { ok: false, error: failed(who, t) ? 'locked' : 'wrong-code' };
    fails.delete(who);
    usedTickets.set(ticket, tk.exp);
    prune(usedTickets, t);
    if (backup) spendBackupCode(a, backup.code, t);
    return session(c, a, t);
  }

  /* A backup code used here is spent at once (in memory), and written into
     the account in the records file — marked used, the account stamped, as
     the dashboard's own sign-in does (touchAccount) — so every device burns
     it too. The account's newest copy (from either file) is the one written,
     so nothing newer is undone. */
  function spendBackupCode(a, code, t) {
    const h = G.codeHash(code), id = str(a.id);
    if (!spent.has(id)) spent.set(id, new Set());
    spent.get(id).add(h);
    saveRecords(storedText => {
      const c = context(t, storedText);
      const acct = c.byId[id];
      if (!c.payload || !acct) return null;
      const S = { voctrain_users: [copy(acct)] };
      if (!G.applyOps(S, [{ kind: 'backupCodeUsed', codeHash: h }], { acct: id }).applied) return null;
      S.voctrain_users[0].updatedAt = iso(t);
      return payloadWith(c.payload, { voctrain_users: S.voctrain_users }, t);
    }).catch(e => log('A spent backup code could not be written to the records yet (it stays spent): ' + (e && e.message)));
  }

  /* A session: the token (12 hours), and the key the device seals what it
     sends with. The session id carries its own issue time and the account's
     credential version (the first 12 characters after the time), sealed, so
     a delivery can be refused as "revoked" without any table of sessions. */
  function session(c, a, t) {
    const slice = sliceOf(c, a.id);
    if (!slice) return { ok: false, error: 'not-ready' };
    const cv = G.cv(a, crypto);
    const sid = G.sid.make(t, cv + nodeCrypto.randomBytes(6).toString('hex'), SECRET, crypto);
    const token = G.token.sign({ a: str(a.id), s: slice.studentId, sid, iat: t, cv }, SECRET, crypto);
    return { ok: true, token, sessionKey: G.sessionKey(SECRET, str(a.id), sid, crypto), sid,
      accountId: str(a.id), studentId: slice.studentId, exp: t + G.token.TTL_MS };
  }
  const sidCv = sid => (str(sid).split('.')[1] || '').slice(0, 12);

  /* Who is asking, from their token: { c, me, slice, claims, refresh } or { error }. */
  function signedIn(body, t) {
    const c = context(t);
    const v = G.token.verify(body.token, SECRET, crypto, { nowMs: t, cvOf: c.cvOf });
    if (!v.ok) return { error: v.reason === 'expired' ? 'expired' : (v.reason === 'revoked' || v.reason === 'unknown-account') ? 'revoked' : 'bad-token' };
    const slice = sliceOf(c, v.claims.a);
    if (!slice) return { error: 'not-ready' };
    return { c, slice, claims: v.claims, refresh: v.refresh, me: { acct: str(v.claims.a), stu: slice.studentId } };
  }

  /* ---------------------------------------------------------- reading */
  function pull(body, t) {
    const s = signedIn(body, t);
    if (s.error) return { ok: false, error: s.error };
    const out = { ok: true };
    if (body.hash && str(body.hash) === s.slice.hash) { out.same = true; out.hash = s.slice.hash; }
    else out.slice = s.slice;
    // Less than four hours left, and the account still in good standing.
    if (s.refresh) out.token = G.token.sign({ a: s.me.acct, s: s.me.stu, sid: s.claims.sid, iat: t, cv: s.claims.cv }, SECRET, crypto);
    return out;
  }

  function attemptGet(body, t) {
    const s = signedIn(body, t);
    if (s.error) return { ok: false, error: s.error };
    if (body.examId == null || body.examId === '') return { ok: false, error: 'bad-request' };
    const r = G.resumeAttempt({ slice: s.slice }, s.me.stu, str(body.examId));
    const out = { ok: true, state: r.state };
    if (r.result) out.result = G.redactResult(r.result, null, t);
    if (r.retired) out.retired = r.retired;
    if (r.attempt) { out.attempt = r.attempt; out.ids = r.ids; }
    return out;
  }

  // The questions, only for an exam of the trainee's own, only while it is open — on this server's clock.
  function paperGet(body, t) {
    const s = signedIn(body, t);
    if (s.error) return { ok: false, error: s.error };
    const examId = str(body.examId);
    if (!examId || s.slice.access.papers.indexOf(examId) === -1) return { ok: false, error: 'unknown-exam' };
    const exam = s.c.exam(examId);
    if (!exam) return { ok: false, error: 'unknown-exam' };
    if (!G.paperOpen(G.buildKey(exam, s.slice.settings.centreUtcOffset), t)) return { ok: false, error: 'not-open' };
    return { ok: true, paper: G.buildPaper(exam, t) };
  }

  // A marked test of the trainee's own, with the right answers only once the exam releases them.
  function review(body, t) {
    const s = signedIn(body, t);
    if (s.error) return { ok: false, error: s.error };
    const id = str(body.resultId);
    const r = s.c.list('voctrain_examResults').filter(x => str(x.id) === id && str(x.studentId) === s.me.stu)[0];
    if (!id || !r) return { ok: false, error: 'unknown-result' };
    return { ok: true, result: G.redactResult(r, s.c.exam(r.examId), t, s.slice.settings.centreUtcOffset) };
  }

  // A chat room's history, for its members only.
  function roomGet(body, t) {
    const s = signedIn(body, t);
    if (s.error) return { ok: false, error: s.error };
    const roomId = str(body.roomId);
    if (!roomId || s.slice.access.rooms.indexOf(roomId) === -1) return { ok: false, error: 'unknown-room' };
    const built = G.buildAll(s.c.map, t, { builtBy: 'centre-server', only: [s.me.acct] }).rooms[roomId];
    if (!built) return { ok: false, error: 'unknown-room' };
    if (body.sinceEtag && str(body.sinceEtag) === built.h) return { ok: true, same: true, etag: built.h };
    return { ok: true, room: built.room, etag: built.h };
  }

  /* ---------------------------------------------------------- delivering */
  /* Everything a delivery changes, gathered while its items are checked
     one by one, so a submission later in the same delivery sees an answer
     saved earlier in it. */
  function Work(c, t) {
    this.c = c; this.t = t;
    this.lists = {};       // store key → records to merge in
    this.maps = {};        // store key → { key: record } (profiles) / { room: [messages] } (chat)
    this.opLists = {};     // store key → Map id → record changed by a read mark
    this.opRooms = {};     // room → its messages, a read mark applied
    this.follows = null;   // { voctrain_chatFollows, voctrain_chatFollowLog } when changed
    this.mine = {};        // account → { attempts, results } as this delivery leaves them
    this.paperMemo = {};
  }
  Work.prototype.add = function (key, rec) { (this.lists[key] = this.lists[key] || []).push(rec); };
  Work.prototype.papers = function (slice) {
    const out = {};
    slice.access.papers.forEach(id => {
      if (!(id in this.paperMemo)) { const e = this.c.exam(id); this.paperMemo[id] = e ? G.buildPaper(e, this.t) : null; }
      if (this.paperMemo[id]) out[id] = this.paperMemo[id];
    });
    return out;
  };
  Work.prototype.mineOf = function (me, slice) {
    if (!this.mine[me.acct]) this.mine[me.acct] = { attempts: slice.data.voctrain_examAttempts.slice(), results: slice.data.voctrain_examResults.slice() };
    return this.mine[me.acct];
  };
  /* An attempt is dated by THIS server the first time it sees it (the late
     flag's "first seen", DESIGN.md §5.3); whatever the device wrote there is
     not taken. A copy already held keeps its own date in every merge. */
  Work.prototype.firstSeen = function (att, m) {
    delete att.gateFirstSeen;
    if (!m.attempts.some(a => str(a.id) === str(att.id))) att.gateFirstSeen = iso(this.t);
  };
  Work.prototype.record = function (key, rec, recId, me, slice) {
    if (key === 'voctrain_examAttempts') {
      const m = this.mineOf(me, slice);
      this.firstSeen(rec, m);
      m.attempts = Core.exams.mergeAttemptLists(m.attempts, [rec]).list;
      this.add(key, rec);
    } else if (key === 'voctrain_studentProfiles') {
      (this.maps[key] = this.maps[key] || {})[recId] = rec;
    } else if (key === 'voctrain_chatMessages') {
      const rooms = this.maps[key] = this.maps[key] || {};
      (rooms[str(rec.roomId)] = rooms[str(rec.roomId)] || []).push(rec);
    } else this.add(key, rec);
  };
  Work.prototype.op = function (op, me) {
    const S = {};
    if ((op.kind === 'read' || op.kind === 'clearNotif') && op.recId != null) {
      const key = op.kind === 'clearNotif' ? 'voctrain_notifications' : op.key;
      const held = this.opLists[key] = this.opLists[key] || new Map();
      let rec = held.get(str(op.recId));
      if (!rec) {
        rec = copy(this.c.list(key).filter(r => str(r.id) === str(op.recId))[0] || null);
        if (!rec) return false;                       // gone since: nothing to mark
      }
      S[key] = [rec];
      if (G.applyOps(S, [op], me).applied) { held.set(str(op.recId), rec); return true; }
      return false;
    }
    if (op.kind === 'read' && op.key === 'voctrain_chatMessages') {
      const room = str(op.roomId);
      if (!this.opRooms[room]) {
        const all = this.c.mapOf('voctrain_chatMessages');
        this.opRooms[room] = copy(Array.isArray(all[room]) ? all[room] : []);
      }
      S.voctrain_chatMessages = {}; S.voctrain_chatMessages[room] = this.opRooms[room];
      return G.applyOps(S, [op], me).applied > 0;
    }
    if (op.kind === 'chatFollow') {
      if (!this.follows) {
        this.follows = { voctrain_chatFollows: copy(this.c.mapOf('voctrain_chatFollows')),
          voctrain_chatFollowLog: copy(this.c.mapOf('voctrain_chatFollowLog')), changed: false };
      }
      const did = G.applyOps(this.follows, [op], me).applied > 0;
      if (did) this.follows.changed = true;
      return did;
    }
    return false;
  };
  /* A submitted test: the attempt as the Centre holds it with what was just
     sent folded in (Core.gate.resumeAttempt), marked from the key. Already
     submitted — from this device or another — the result already made is
     the answer, and nothing is marked twice. */
  Work.prototype.submit = function (item, attempt, me, slice) {
    const id = str(item.id), t = this.t;
    const exam = this.c.exam(attempt.examId);
    if (!exam) return { id, ok: false, reason: 'unknown-exam' };
    const m = this.mineOf(me, slice);
    const att = copy(attempt);
    this.firstSeen(att, m);
    const pair = x => x && str(x.studentId) === me.stu && str(x.examId) === str(att.examId);
    const state = G.resumeAttempt({ slice: { data: { voctrain_examAttempts: m.attempts.filter(pair).concat([att]),
      voctrain_examResults: m.results.filter(pair) } } }, me.stu, str(att.examId));
    // The copy sent is kept whatever happens next: a submitted record beats an
    // open one in every merge, and nothing the trainee typed is thrown away.
    // (One already submitted here needs no second write.)
    const done = m.attempts.some(a => str(a.id) === str(att.id) && Core.exams.attemptIsRetired(a));
    if (!done) {
      this.add('voctrain_examAttempts', att);
      m.attempts = Core.exams.mergeAttemptLists(m.attempts, [att]).list;
    }
    if (state.state === 'result') return { id, ok: true, result: G.redactResult(state.result, null, t), writes: !done };
    if (state.state === 'retired') return { id, ok: true, state: 'retired', writes: !done };
    if (state.state !== 'attempt') return { id, ok: false, reason: 'malformed' };
    const cur = state.attempt;
    const seen = m.attempts.filter(a => state.ids.indexOf(str(a.id)) !== -1).map(a => Date.parse(a.gateFirstSeen || '') || 0).filter(Boolean);
    const offset = slice.settings.centreUtcOffset;
    const marked = G.markAttempt(cur, G.buildKey(exam, offset), t, { crypto, receivedAt: t,
      firstSeen: seen.length ? Math.min.apply(null, seen) : t, auto: item.auto === true,
      studentName: str((slice.data.voctrain_students[0] || {}).name), accountId: me.acct });
    if (marked.error) return { id, ok: false, reason: marked.error };
    this.add('voctrain_examResults', marked.result);
    m.results.push(marked.result);
    // Every open copy folded into this attempt is over now.
    const retired = state.ids.map(aid => (aid === str(cur.id) ? marked.retired
      : Core.exams.retireAttempt(m.attempts.filter(a => str(a.id) === aid)[0] || { id: aid, examId: att.examId, studentId: me.stu },
        marked.result.id, marked.result.submittedAt)));
    retired.forEach(r => this.add('voctrain_examAttempts', r));
    m.attempts = Core.exams.mergeAttemptLists(m.attempts, retired).list;
    return { id, ok: true, result: G.redactResult(marked.result, null, t) };
  };
  Work.prototype.values = function () {
    const v = {};
    Object.keys(this.lists).forEach(k => { v[k] = this.lists[k].slice(); });
    Object.keys(this.opLists).forEach(k => { if (this.opLists[k].size) v[k] = (v[k] || []).concat(Array.from(this.opLists[k].values())); });
    if (this.maps.voctrain_studentProfiles) v.voctrain_studentProfiles = this.maps.voctrain_studentProfiles;
    const rooms = {};
    Object.keys(this.opRooms).forEach(r => { rooms[r] = this.opRooms[r].slice(); });
    const sent = this.maps.voctrain_chatMessages || {};
    Object.keys(sent).forEach(r => { rooms[r] = (rooms[r] || []).concat(sent[r]); });
    if (Object.keys(rooms).length) v.voctrain_chatMessages = rooms;
    if (this.follows && this.follows.changed) {
      v.voctrain_chatFollows = this.follows.voctrain_chatFollows;
      v.voctrain_chatFollowLog = this.follows.voctrain_chatFollowLog;
    }
    return v;
  };

  /* One item: sealed by a session of this server, not too old, from an
     account still in good standing — then the shared rules decide. */
  function deliverOne(item, c, w, t) {
    const id = isObj(item) && item.id != null ? str(item.id) : '';
    const no = reason => ({ receipt: { id, ok: false, reason } });
    if (!isObj(item) || typeof item.mac !== 'string' || !item.a || !item.sid) return no('malformed');
    const sid = G.sid.check(item.sid, SECRET, crypto);
    if (!sid.ok) return no('bad-seal');
    if (t - sid.iat > G.ITEM_MAX_AGE_MS) return no('expired');
    if (!G.sealOk(item, G.sessionKey(SECRET, str(item.a), str(item.sid), crypto), crypto)) return no('bad-seal');
    // A password reset, switch-off or two-step change since that session: the
    // device keeps the item and seals it again at the next sign-in.
    const cv = c.cvOf(item.a);
    if (cv == null || !G.same(cv, sidCv(item.sid))) return no('revoked');
    const slice = sliceOf(c, item.a);
    if (!slice) return no('not-ready');
    const me = { acct: str(item.a), stu: slice.studentId };
    const v = G.validateItem(item, me, slice, { papers: w.papers(slice) });
    if (!v.ok) return no(v.reason);
    if (v.known) return { receipt: { id, ok: true, known: true } };
    if (v.op) { const did = w.op(v.op, me); return { receipt: { id, ok: true }, writes: did }; }
    if (v.attempt) {
      const r = w.submit(item, v.attempt, me, slice);
      const writes = r.writes !== undefined ? r.writes : r.ok;
      delete r.writes;
      return { receipt: r, writes };
    }
    w.record(v.key, v.rec, v.recId, me, slice);
    return { receipt: { id, ok: true }, writes: true };
  }

  function deliver(body, t) {
    const items = body.items;
    if (!Array.isArray(items) || !items.length) return Promise.resolve({ ok: false, error: 'bad-request' });
    if (items.length > MAX_ITEMS) return Promise.resolve({ ok: false, error: 'too-many' });
    const receipts = items.map(it => ({ id: isObj(it) && it.id != null ? str(it.id) : '', ok: false, reason: 'busy' }));
    let writing = [], decided = false;
    return saveRecords(storedText => {
      writing = []; decided = false;
      const c = context(t, storedText);
      const w = new Work(c, t);
      items.forEach((item, i) => {
        if (!c.payload) { receipts[i] = { id: receipts[i].id, ok: false, reason: 'not-ready' }; return; }
        const r = deliverOne(item, c, w, t);
        receipts[i] = r.receipt;
        if (r.writes) writing.push(i);
      });
      decided = true;
      const values = w.values();
      return Object.keys(values).length ? payloadWith(c.payload, values, t) : null;
    }).then(() => ({ ok: true, results: receipts }), err => {
      // Nothing was written: every item that was to be written is answered
      // "busy", stays on the device and is sent again.
      log('A trainee\'s work could not be saved just now (their device will send it again): ' + (err && err.message));
      (decided ? writing : items.map((_, i) => i)).forEach(i => { receipts[i] = { id: receipts[i].id, ok: false, reason: 'busy' }; });
      return { ok: true, results: receipts };
    });
  }

  /* ---------------------------------------------------------- health */
  function health(t) {
    const ready = { secret: !!SECRET, folders: true, ledger: false, ledgerUpdated: '', trainees: 0 };
    if (G) {
      try {
        const c = context(t);
        ready.ledger = !!c.payload;
        try { ready.ledgerUpdated = c.payload ? fs.statSync(LMS).mtime.toISOString() : ''; } catch (e) {}
        ready.trainees = c.trainees.length;
      } catch (e) {}
    }
    // staffOnly: whether this server keeps the records for staff devices only
    // (cestis-offline-server.js) — then a trainee's device signs in here.
    return { ok: true, service: 'cestis-trainee-gate', version: GATE_VERSION, protocol: PROTOCOL.slice(), time: iso(t),
      ready, accepting: !!G && selfOk && !killed(), staffOnly: !!staffOnly() };
  }
  // The administrator's page: ✓ / ✗ lines, counts only — no names, no ids.
  function selfcheckPage(t) {
    const h = health(t);
    let exams = 0, linked = 0;
    try {
      const c = context(t);
      exams = c.list('voctrain_exams').filter(e => e.status !== 'draft' && e.status !== 'cancelled' && Core.exams.questionCount(e) > 0).length;
      linked = c.trainees.filter(a => !!sliceOf(c, a.id)).length;
    } catch (e) {}
    const st = G ? G.selfTest(crypto) : { ok: false, checks: [] };
    const line = (ok, text) => '<li>' + (ok ? '✓ ' : '✗ ') + text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</li>';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Trainee sign-in check</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px;color:#111;background:#fff}' +
      'li{list-style:none;margin:4px 0}</style></head><body><h1>Trainee sign-in check</h1><ul>' +
      line(true, 'Version ' + GATE_VERSION) +
      line(h.ready.secret, 'Session secret present') +
      line(h.ready.ledger, 'Accounts found: ' + h.ready.trainees + ' trainee accounts' + (h.ready.ledgerUpdated ? ', records updated ' + h.ready.ledgerUpdated : '')) +
      line(linked > 0 || h.ready.trainees === 0, 'Records ready for ' + linked + ' of ' + h.ready.trainees + ' trainee accounts (built when they ask)') +
      line(true, 'Answer keys: ' + exams + ' exams') +
      st.checks.map(ch => line(ch.ok, 'Self-test: ' + ch.name)).join('') +
      line(h.accepting, h.accepting ? 'Accepting sign-ins' : 'Not accepting sign-ins') +
      '</ul></body></html>';
  }

  /* ---------------------------------------------------------- dispatch */
  const UNAVAILABLE = { 'auth.email': 1, 'auth.2fa.send': 1, upload: 1, 'file.get': 1 };
  function run(body, t) {
    if (typeof t !== 'number') t = now();
    return Promise.resolve().then(() => {
      const op = str(body && body.op);
      if (op === 'health') return health(t);
      if (!G || !selfOk || killed()) return { ok: false, error: 'off' };
      if (body.v != null && body.v !== 1) return { ok: false, error: Number(body.v) < 1 ? 'client-too-old' : 'unsupported', protocol: PROTOCOL.slice() };
      if (UNAVAILABLE[op]) return { ok: false, error: 'unavailable' };
      switch (op) {
        case 'auth.start': return authStart(body, t);
        case 'auth.password': return authPassword(body, t);
        case 'auth.2fa': return authTwoStep(body, t);
        case 'pull': return pull(body, t);
        case 'deliver': return deliver(body, t);
        case 'attempt.get': return attemptGet(body, t);
        case 'paper.get': return paperGet(body, t);
        case 'review': return review(body, t);
        case 'room.get': return roomGet(body, t);
        default: return { ok: false, error: 'unknown-op' };
      }
    }).catch(e => {
      log('A trainee sign-in request failed (the system is still running): ' + (e && e.message));
      return { ok: false, error: 'busy' };
    }).then(out => { out.time = iso(t); return out; });
  }

  function reply(res, status, obj) { opts.send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
  function handle(req, res) {
    const url = String(req.url || '');
    if (req.method === 'GET') {
      const q = new URLSearchParams(url.indexOf('?') === -1 ? '' : url.slice(url.indexOf('?') + 1));
      const op = q.get('op') || 'health';
      if (op === 'selfcheck') return opts.send(res, 200, selfcheckPage(now()), 'text/html; charset=utf-8');
      if (op === 'health') return reply(res, 200, health(now()));
      return reply(res, 200, { ok: false, error: 'unknown-op', time: iso(now()) });
    }
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method-not-allowed' });
    const chunks = [];
    let received = 0, over = false;
    req.on('data', ch => {
      received += ch.length;
      if (received > BODY_MAX) { if (!over) { over = true; reply(res, 413, { ok: false, error: 'too-large' }); req.destroy(); } return; }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (over) return;
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
      if (!isObj(body)) return reply(res, 400, { ok: false, error: 'bad-request' });
      run(body).then(out => reply(res, 200, out));
    });
  }

  return { handle, run, health, GATE_VERSION, secretFile: path.join(opts.certDir || path.join(rootDir, 'cert'), 'gate-secret') };
}

module.exports = { create, loadOrCreateSecret, crypto, GATE_VERSION, PROTOCOL, LMS_FILE };
