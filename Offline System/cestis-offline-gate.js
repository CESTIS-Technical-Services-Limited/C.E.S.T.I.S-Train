/* ============================================================================
   cestis-offline-gate.js — the trainee gate, on the Centre's own server.

   WHAT IT IS
   ----------
   Through the "trainee gate" (docs/trainee-gate/DESIGN.md in the main
   repository) a trainee's device is given ONLY that trainee's own records,
   and everything the trainee sends back is checked before it joins the
   Centre's. Online the gate is a small Google script (trainee-gate/Gate.gs).
   This file is the same gate for devices on the Centre's own network: the
   SAME requests and the SAME answers, field for field, by the same rules —
   CESTISCore.gate in cestis-core.js, the very file every page loads — so one
   client talks to either. cestis-offline-server.js serves it at

       POST /_cestis/gate        { op, v?, client?, ... } → { ok:true, ... }
                                 or { ok:false, error, retry?, retryAfter?, why? }
       GET  /_cestis/gate        the health answer;  ?op=selfcheck  a small
                                 page for the administrator (counts only)

   WHAT IS DIFFERENT HERE (DESIGN.md §6)
   -------------------------------------
   - Nobody has to publish anything. This computer holds all of the Centre's
     records, so a trainee's own records (their "slice") are BUILT WHEN THEY
     ASK, from data/CESTIS_LMS_Dashboard.json (Core.gate.prepare / sliceFor),
     read again only when that file changes. Papers and answer keys come
     from the same file (Core.gate.buildPaper / buildKey); a key never leaves
     this computer.
   - What a trainee sends (sealed "items") is checked with
     Core.gate.validateItem and merged STRAIGHT INTO that file by the store's
     own record rules (cestis-offline-store.js) — no lanes: this server is the
     single writer, every device sees it on its next refresh, and the
     previous version is kept in data/.history like every other save. So a
     pull's "overlay" (what was sent but is not in the slice yet) is always
     empty here: it is already in the slice.
   - Tests are marked here, from the exam's own key (Core.gate.markAttempt):
     points come from the key, never from the trainee's copy; one result per
     attempt; answers that arrive late are kept and flagged, never refused.
   - Sessions are signed with cert/gate-secret: 64 hex characters made on
     first run (like cert/host-secret), never served, never in the
     repository, never shown. A password reset, a switch-off or a two-step
     change ends every session of that account at its next request.
   - What needs the internet or Google Drive — signing in with an email
     account, emailed codes, uploading and fetching files — answers
     { ok:false, error:'not-available' } here.

   THE REQUESTS (as trainee-gate/Gate.gs answers them)
   ---------------------------------------------------
     health                     → {service, version, protocol, time, ready, accepting, staffOnly}
     auth.start {login}         → {nonce, algo, iter, salt}
     auth.password {login, nonce, proof}            → SESSION | NEED2FA
     auth.2fa {ticket, method:'totp'|'backup', code} → SESSION
       SESSION = {token, sessionKey, sid, lane, exp, account:{id, studentId}, serverTime}
       NEED2FA = {need2fa:true, ticket, methods:[…], email}
     pull {token, have?}        → {h, slice | same, overlay:{lanes, results, truncated}, token?, exp?, serverTime}
     paper {token, examId}      → {paper, centreUtcOffset, serverTime} | {error:'not-open', status, serverTime}
     attempt.get {token, examId} → {state, attempt | result | retired, ids?, serverTime}
     review {token, resultId}   → {result, revealed}
     room.get {token, roomId, have?} → {room, h} | {same, h}
     signOut {token}            → {}
     deliver {items, lane?}     → {receipts:[{id, ok, reason?, retry?, dup?, already?, result?, retired?}]}
                                  (no token: each item carries its own seal)
     auth.email, auth.2fa.send, upload, file.get → {ok:false, error:'not-available'}
     catalogue, register.start, register.submit → {ok:false, error:'not-available'}
       (registration from home needs the trainee's own email account, signed
        in with Google: never here — the office creates the account instead)
   A request that is not JSON is a 400; every answer to one that is, is a
   200, as online (a script there cannot answer with anything else).
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

// 2 with the online gate: registration from home (answered 'not-available' here).
const GATE_VERSION = 2;
const PROTOCOL = [1];
const SERVICE = 'cestis-trainee-gate';
const LMS_FILE = 'CESTIS_LMS_Dashboard.json';
const LIMITS = {
  BODY_MAX: 8 * 1024 * 1024,          // a request (DESIGN.md §3.4: ≤ 8 MB)
  DELIVER_MAX_ITEMS: 200,
  CTX_MS: 30 * 1000,                  // a built pass is reused this long while nothing changes
  NONCE_MS: 120 * 1000,               // a password challenge lasts two minutes, once
  LOCK_FAILS: 5, LOCK_S: 15 * 60,     // five wrong tries on one login: locked for 15 minutes
  START_MAX: 20,                      // more than 20 challenges for one login in 15 minutes: locked
  BUSY_FAILS_PER_MIN: 60,             // more than 60 wrong passwords a minute, all logins: busy
  TICKET_MS: 5 * 60 * 1000, TICKET_TRIES: 5,
  MAP_CAP: 20000                      // bookkeeping never grows without bound
};

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
function randomHex(n) { return nodeCrypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n); }
// Ids that name an exam, a room, a file: plain characters only (as the online gate takes them).
function safeId(s, max) { s = str(s); return new RegExp('^[A-Za-z0-9._-]{1,' + (max || 100) + '}$').test(s) && !/^\.+$/.test(s) ? s : null; }
function maskEmail(email) { const m = /^([^@]{0,1})[^@]*(@.*)$/.exec(str(email)); return m ? m[1] + '•••' + m[2] : ''; }

/* The decisions both gates make alike — the accounts index, which account a
   login names, when a right password still may not sign in, which second
   steps an account is offered, the two-step ticket, the credential version
   inside a session id — are Core.gate's (indexAccounts, lookupLogin,
   credentialRefusal, twoStep, ticketMake / ticketRead, sidRand / sidCv), the
   same functions trainee-gate/Gate.gs calls. What is here is this server's
   own part: its counters, its memory, its files. */

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
  const certDir = opts.certDir || path.join(rootDir, 'cert');
  const LMS = path.join(dataDir, LMS_FILE);
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const accounts = typeof opts.accounts === 'function' ? opts.accounts : () => [];
  const staffOnly = typeof opts.staffOnly === 'function' ? opts.staffOnly : () => false;
  const SECRET = loadOrCreateSecret(certDir);

  // A runtime that computes the known answers differently must not run the gate.
  let selfOk = false;
  try { selfOk = !!G && G.selfTest(crypto).ok === true; } catch (e) { selfOk = false; }
  if (G && !selfOk) log('The trainee sign-in check failed its own self-test on this computer; trainee sign-in through this server is off.');

  // The administrator's kill switch (DESIGN.md §10.5): a file named gate-off beside index.html.
  const killed = () => { try { return fs.existsSync(path.join(rootDir, 'gate-off')); } catch (e) { return false; } };

  function fail(code, extra) { const e = new Error(code); e.gateError = code; e.gateExtra = extra || null; throw e; }

  /* ---------------------------------------------------------- the records */
  function statStamp(file) {
    try { const st = fs.statSync(file); return st.mtimeMs + ':' + st.size; }
    catch (e) { if (e && e.code === 'ENOENT') return 'none'; throw e; }
  }
  function parsePage(text) {
    if (text == null) return null;
    let p;
    try { p = JSON.parse(text); } catch (e) { fail('busy'); }
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
    const key = lmsStamp + '|' + Math.floor(t / LIMITS.CTX_MS);
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
    const idx = G.indexAccounts(map.voctrain_users, read('voctrain_deletedUserIds'), crypto);
    cache = {
      key, ctx, payload, map, list, mapOf, idx,
      updated: payload ? (() => { try { return fs.statSync(LMS).mtime.toISOString(); } catch (e) { return null; } })() : null,
      exam: id => list('voctrain_exams').filter(e => str(e.id) === str(id) && e.status !== 'draft' && e.status !== 'cancelled')[0] || null,
      slices: {}
    };
    return cache;
  }
  // Before anything else: are there records to answer from at all?
  function ready(t, storedText) {
    const c = context(t, storedText);
    if (!c.payload) fail('not-set-up');
    return c;
  }
  // A trainee's own records, built now (once per pass and account), or { error: 'not-ready' }.
  function place(c, acct) {
    const k = str(acct);
    if (!(k in c.slices)) { const r = G.sliceFor(c.ctx, k); c.slices[k] = r ? r.slice : null; }
    return c.slices[k] ? { slice: copy(c.slices[k]) } : { error: 'not-ready' };
  }
  const accessHas = (slice, list, id) => !!(slice.access && Array.isArray(slice.access[list]) && slice.access[list].map(String).indexOf(String(id)) !== -1);

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

  /* ------------------------------------------------- counters and memory */
  // A counter that lives LOCK_S (or `ms`) from its last change, as the online gate's cache counters do.
  const counters = new Map();
  function count(key, ms, t) {
    const c = counters.get(key);
    const n = (c && c.exp > t ? c.n : 0) + 1;
    counters.set(key, { n, exp: t + ms });
    if (counters.size > LIMITS.MAP_CAP) counters.forEach((v, k) => { if (v.exp <= t) counters.delete(k); });
    return n;
  }
  function countOf(key, t) { const c = counters.get(key); return c && c.exp > t ? c.n : 0; }
  const nonces = new Map();       // nonce → { l, exp }
  const usedSteps = new Map();    // account:step → exp (an authenticator code once only)
  const usedTickets = new Map();  // ticket mac → exp
  const spent = new Map();        // account → [codeHash] spent here (until the records show them used)
  function remember(map, key, value, t) {
    map.set(key, value);
    if (map.size > LIMITS.MAP_CAP) map.forEach((v, k) => { if ((typeof v === 'number' ? v : v && v.exp) <= t) map.delete(k); });
  }
  /* Signed-out sessions, until their token would have run out anyway. Kept
     in cert/ beside the secret, so a restart does not bring one back. */
  const OUT_FILE = path.join(certDir, 'gate-signed-out.json');
  let signedOut = {};
  try { const v = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); if (isObj(v)) signedOut = v; } catch (e) {}
  function signOutSid(sid, exp, t) {
    signedOut[sid] = exp;
    Object.keys(signedOut).forEach(k => { if (!(Number(signedOut[k]) > t)) delete signedOut[k]; });
    try {
      fs.mkdirSync(certDir, { recursive: true });
      const tmp = OUT_FILE + '.' + process.pid + '.' + randomHex(12) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(signedOut), { mode: 0o600 });
      fs.renameSync(tmp, OUT_FILE);
    } catch (e) { log('A sign-out could not be written down (it holds until the server restarts): ' + (e && e.message)); }
  }
  const isSignedOut = (sid, t) => Number(signedOut[sid]) > t;

  /* ------------------------------------------------------------ sign-in */
  const triesKey = (look, login) => (look && look.id ? 'acct|' + look.id : 'login|' + lower(login));
  const locked = (key, t) => countOf('f:' + key, t) >= LIMITS.LOCK_FAILS || countOf('s:' + key, t) > LIMITS.START_MAX;
  const minute = t => Math.floor(t / 60000);
  function failed(key, t) { count('f:' + key, LIMITS.LOCK_S * 1000, t); count('fm:' + minute(t), 120000, t); }
  const busy = t => countOf('fm:' + minute(t), t) > LIMITS.BUSY_FAILS_PER_MIN;
  const LOCKED = () => ({ ok: false, error: 'locked', retryAfter: LIMITS.LOCK_S });

  function authStart(req, t) {
    const login = str(req.login).trim();
    if (!login || login.length > 200) fail('bad-request');
    const c = ready(t);
    const look = G.lookupLogin(c.idx, login), key = triesKey(look, login);
    if (locked(key, t)) return LOCKED();
    if (busy(t)) return { ok: false, error: 'busy', retry: true };
    if (count('s:' + key, LIMITS.LOCK_S * 1000, t) > LIMITS.START_MAX) return LOCKED();
    if (look.ambiguous) return { ok: false, error: 'ask-office', why: 'ambiguous' };
    const nonce = randomHex(32);
    remember(nonces, nonce, { l: lower(login), exp: t + LIMITS.NONCE_MS }, t);
    // An unknown login is given a believable challenge (Core.gate.proof.challenge).
    const ch = G.proof.challenge(look.e ? look.e.pw : null, login, SECRET, crypto);
    return { ok: true, nonce, algo: ch.algo, iter: ch.iter, salt: ch.salt };
  }

  function authPassword(req, t) {
    const login = str(req.login).trim(), nonce = str(req.nonce);
    if (!login || !/^[0-9a-f]{32}$/.test(nonce)) fail('bad-request');
    const c = ready(t);
    const look = G.lookupLogin(c.idx, login), key = triesKey(look, login);
    if (locked(key, t)) return LOCKED();
    if (busy(t)) return { ok: false, error: 'busy', retry: true };
    const held = nonces.get(nonce);
    nonces.delete(nonce);                               // a challenge is answered once
    if (!held || held.exp <= t || held.l !== lower(login)) return { ok: false, error: 'bad-nonce' };
    if (look.ambiguous) return { ok: false, error: 'ask-office', why: 'ambiguous' };
    if (!look.e || !G.proof.verify(look.e.pw, nonce, login, str(req.proof), crypto)) {
      failed(key, t);
      return { ok: false, error: 'no-match' };
    }
    counters.delete('f:' + key);
    return afterCredential(c, look.id, look.e, 'password', t);
  }

  function afterCredential(c, acct, e, via, t) {
    const refusal = G.credentialRefusal(e, via);
    if (refusal) return Object.assign({ ok: false }, refusal);
    const p = place(c, acct);
    if (p.error) return { ok: false, error: p.error };
    const two = G.twoStep(e, unusedCodes(acct, e), false);
    if (two.needed) {
      // Emailed codes need the internet; here only the authenticator and backup codes can finish it.
      if (!two.methods.length) return { ok: false, error: 'not-available', why: 'email-code' };
      const ticket = G.ticketMake({ a: acct, cv: e.cv, exp: t + LIMITS.TICKET_MS, m: two.methods, via, n: randomHex(8) }, SECRET, crypto);
      return { ok: true, need2fa: true, ticket, methods: two.methods, email: e.eo ? maskEmail(e.em) : '' };
    }
    return issue(acct, e, p.slice, t);
  }
  const unusedCodes = (acct, e) => { const gone = spent.get(acct) || []; return (e.bc || []).filter(code => gone.indexOf(G.codeHash(code)) === -1); };

  /* A session (DESIGN.md §4.4): the token (12 hours) and the key the device
     seals what it sends with; its lane is named as online, though here what
     it sends goes straight into the Centre's records. */
  function issue(acct, e, slice, t) {
    const sid = G.sid.make(t, G.sidRand(e.cv, randomHex(12)), SECRET, crypto);
    const exp = t + G.token.TTL_MS;
    const token = G.token.sign({ a: acct, s: slice.studentId, sid, iat: t, exp, cv: e.cv }, SECRET, crypto);
    return { ok: true, token, sessionKey: G.sessionKey(SECRET, acct, sid, crypto), sid, lane: 'L-' + sid,
      exp, account: { id: acct, studentId: slice.studentId }, serverTime: iso(t) };
  }

  function authTwoStep(req, t) {
    const c = ready(t);
    const tk = G.ticketRead(req.ticket, SECRET, crypto, t);
    if (tk.error) return { ok: false, error: tk.error };
    if (usedTickets.has(tk.mac) || countOf('tf:' + tk.mac, t) >= LIMITS.TICKET_TRIES) return { ok: false, error: 'bad-ticket' };
    const e = c.idx.a[tk.a];
    if (!e || e.cv !== tk.cv) return { ok: false, error: 'revoked' };
    const akey = 'acct|' + tk.a;
    if (locked(akey, t)) return LOCKED();
    const method = str(req.method), code = str(req.code).replace(/\s+/g, '');
    const methods = Array.isArray(tk.m) ? tk.m : [];
    if (methods.indexOf(method) === -1) return { ok: false, error: 'not-allowed' };
    let ok = false, why = 'bad-code', backup = null;
    if (method === 'totp') {
      const v = G.totp.verify(e.tf, code, t, crypto, { used: step => usedSteps.get(tk.a + ':' + step) > t });
      if (v.ok) { ok = true; remember(usedSteps, tk.a + ':' + v.step, t + 120000, t); }
      else if (v.reason === 'used') why = 'code-used';
    } else if (method === 'backup') {
      const want = code.toUpperCase();
      if (want && unusedCodes(tk.a, e).indexOf(want) !== -1) { ok = true; backup = want; }
    }
    if (!ok) {
      const tries = count('tf:' + tk.mac, LIMITS.TICKET_MS, t);
      failed(akey, t);
      return { ok: false, error: why, triesLeft: Math.max(0, LIMITS.TICKET_TRIES - tries) };
    }
    remember(usedTickets, tk.mac, tk.exp, t);
    counters.delete('f:' + akey);
    if (backup) spendBackupCode(tk.a, backup, t);
    const p = place(c, tk.a);
    if (p.error) return { ok: false, error: p.error };
    return issue(tk.a, e, p.slice, t);
  }

  /* A backup code used here is spent at once (in memory), and written into
     the account in the records file — marked used, the account stamped, as
     the dashboard's own sign-in does (touchAccount) — so every device burns
     it too. The account's newest copy (from either file) is the one written,
     so nothing newer is undone. (Online it is noted in the trainee's lane for
     a staff device to burn; here this server is that staff device.) */
  function spendBackupCode(acct, code, t) {
    const h = G.codeHash(code);
    const list = (spent.get(acct) || []).concat([h]);
    spent.set(acct, list);
    saveRecords(storedText => {
      const c = context(t, storedText);
      const account = (Array.isArray(c.map.voctrain_users) ? c.map.voctrain_users : []).filter(a => a && str(a.id) === acct)[0];
      if (!c.payload || !account) return null;
      const S = { voctrain_users: [copy(account)] };
      if (!G.applyOps(S, [{ kind: 'backupCodeUsed', codeHash: h }], { acct }).applied) return null;
      S.voctrain_users[0].updatedAt = iso(t);
      return payloadWith(c.payload, { voctrain_users: S.voctrain_users }, t);
    }).catch(err => log('A spent backup code could not be written to the records yet (it stays spent): ' + (err && err.message)));
  }

  /* Who is asking: the token checked against the accounts as they are now
     (a password reset, a switch-off or a two-step change revokes it), not
     signed out, and their records. */
  function session(req, t) {
    const c = ready(t);
    const v = G.token.verify(str(req.token), SECRET, crypto, { nowMs: t, cvOf: a => (c.idx.a[a] ? c.idx.a[a].cv : null) });
    if (!v.ok) fail(v.reason === 'expired' ? 'expired' : (v.reason === 'revoked' || v.reason === 'unknown-account') ? 'revoked' : 'bad-token');
    const claims = v.claims, e = c.idx.a[claims.a];
    if (isSignedOut(claims.sid, t)) fail('signed-out');
    if (e.st !== 'ok' && e.st !== 'no-password') fail('revoked');
    const p = place(c, claims.a);
    if (p.error) fail(p.error);
    return { c, claims, entry: e, slice: p.slice, refresh: v.refresh, me: { acct: str(claims.a), stu: str(p.slice.studentId) } };
  }

  /* ---------------------------------------------------------- reading */
  function pull(req, t) {
    const s = session(req, t), out = { ok: true, h: s.slice.hash, serverTime: iso(t) };
    if (req.have && str(req.have) === str(s.slice.hash)) out.same = true; else out.slice = s.slice;
    // What was sent is already in the Centre's records here, so in the slice.
    out.overlay = { lanes: [], results: [], truncated: false };
    if (s.refresh) {
      const exp = t + G.token.TTL_MS;
      out.token = G.token.sign({ a: s.me.acct, s: s.me.stu, sid: s.claims.sid, iat: t, exp, cv: s.claims.cv }, SECRET, crypto);
      out.exp = exp;
    }
    return out;
  }

  // paper: only an exam on the trainee's list, and only while it is open by THIS clock.
  function paper(req, t) {
    const s = session(req, t), examId = safeId(req.examId);
    if (!examId || !accessHas(s.slice, 'papers', examId)) return { ok: false, error: 'unknown-exam' };
    const exam = s.c.exam(examId), offset = s.slice.settings.centreUtcOffset;
    const key = exam ? G.buildKey(exam, offset) : null;
    if (!key || !G.paperOpen(key, t)) {
      return { ok: false, error: 'not-open', status: key ? Core.exams.statusAt(key.exam, t, key.centreUtcOffset) : 'upcoming', serverTime: iso(t) };
    }
    return { ok: true, paper: G.buildPaper(exam, t), centreUtcOffset: key.centreUtcOffset, serverTime: iso(t) };
  }

  // attempt.get: the attempt in progress (one, however many devices), a result, or nothing.
  function attemptGet(req, t) {
    const s = session(req, t), examId = safeId(req.examId);
    if (!examId || !accessHas(s.slice, 'papers', examId)) return { ok: false, error: 'unknown-exam' };
    const r = G.resumeAttempt({ slice: s.slice }, s.me.stu, examId);
    const out = { ok: true, state: r.state, serverTime: iso(t) };
    if (r.state === 'result') out.result = G.redactResult(r.result, null, t);
    if (r.state === 'retired') out.retired = r.retired;
    if (r.state === 'attempt') { out.attempt = r.attempt; out.ids = r.ids; }
    return out;
  }

  /* review: a marked test of their own, the right answers only when the
     exam's release allows — on THIS clock. The Centre holds results whole;
     any answer stored without its right answer has it put back from the
     exam's key first (Core.gate.fillAnswers), as the online gate does. */
  function review(req, t) {
    const s = session(req, t), id = str(req.resultId);
    if (!id) fail('bad-request');
    const found = s.c.list('voctrain_examResults').filter(r => str(r.id) === id && str(r.studentId) === s.me.stu)[0];
    if (!found) return { ok: false, error: 'not-found' };
    const exam = safeId(found.examId) ? s.c.exam(found.examId) : null, offset = s.slice.settings.centreUtcOffset;
    const key = exam ? G.buildKey(exam, offset) : null;
    return { ok: true, result: G.redactResult(G.fillAnswers(found, key), exam, t, offset), revealed: !!exam && Core.exams.canRevealAnswers(exam, t, offset) };
  }

  // room.get: a room's history (the online gate's room file, built now), to its members only.
  function roomGet(req, t) {
    const s = session(req, t), roomId = safeId(req.roomId, 200);
    if (!roomId || !accessHas(s.slice, 'rooms', roomId)) return { ok: false, error: 'unknown-room' };
    const built = G.buildAll(s.c.map, t, { builtBy: 'centre-server', only: [s.me.acct] }).rooms[roomId];
    if (!built) return { ok: false, error: 'not-ready', retry: true };
    const room = built.room;
    if (!Array.isArray(room.members) || room.members.map(String).indexOf(s.me.acct) === -1) return { ok: false, error: 'unknown-room' };
    if (req.have && str(req.have) === str(room.hash)) return { ok: true, same: true, h: room.hash };
    return { ok: true, room, h: room.hash };
  }

  // signOut: this token reads nothing more; what the session already sealed is still delivered.
  function signOutOp(req, t) {
    const v = G.token.verify(str(req.token), SECRET, crypto, { nowMs: t });
    if (v.ok) signOutSid(v.claims.sid, v.claims.exp, t);
    return { ok: true };
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
     the answer ("already"), and nothing is marked twice. */
  Work.prototype.submit = function (item, attempt, me, slice) {
    const t = this.t, offset = slice.settings.centreUtcOffset;
    if (!safeId(attempt.id) || !safeId(attempt.examId)) return { ok: false, reason: 'malformed' };
    const exam = this.c.exam(attempt.examId);
    const key = exam ? G.buildKey(exam, offset) : null;
    if (!key) return { ok: false, reason: 'not-ready', retry: true };
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
    const writes = !done;
    if (writes) {
      this.add('voctrain_examAttempts', att);
      m.attempts = Core.exams.mergeAttemptLists(m.attempts, [att]).list;
    }
    if (state.state === 'result') {
      const full = this.c.list('voctrain_examResults').filter(r => str(r.id) === str(state.result.id))[0] || state.result;
      return { ok: true, already: true, result: G.redactResult(full, key.exam, t, key.centreUtcOffset), writes };
    }
    if (state.state === 'retired') return { ok: true, already: true, retired: state.retired, writes };
    if (state.state !== 'attempt') return { ok: false, reason: 'malformed' };
    const cur = state.attempt;
    const seen = m.attempts.filter(a => state.ids.indexOf(str(a.id)) !== -1).map(a => Date.parse(a.gateFirstSeen || '') || 0).filter(Boolean);
    const marked = G.markAttempt(cur, key, t, { crypto, receivedAt: t,
      firstSeen: seen.length ? Math.min.apply(null, seen) : t, auto: item.auto === true,
      studentName: (slice.data.voctrain_students[0] || {}).name, accountId: me.acct });
    if (marked.error) return { ok: false, reason: marked.error, retry: marked.error === 'no-key' };
    this.add('voctrain_examResults', marked.result);
    m.results.push(marked.result);
    // Every open copy folded into this attempt is over now.
    const retired = state.ids.map(aid => (aid === str(cur.id) ? marked.retired
      : Core.exams.retireAttempt(m.attempts.filter(a => str(a.id) === aid)[0] || { id: aid, examId: att.examId, studentId: me.stu },
        marked.result.id, marked.result.submittedAt)));
    retired.forEach(r => this.add('voctrain_examAttempts', r));
    m.attempts = Core.exams.mergeAttemptLists(m.attempts, retired).list;
    return { ok: true, result: G.redactResult(marked.result, key.exam, t, key.centreUtcOffset), writes: true };
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

  /* One session's items (as the online gate takes them): its id must be one
     this gate made (else 'revoked': sign in and seal again), young enough,
     its account still with the same credentials, each item's seal good —
     then the shared rules decide. Fills `out` (receipts by position) and
     `writing` (positions that depend on the save). */
  function deliverSession(c, w, acct, sid, group, out, writing, t) {
    const all = reason => group.forEach(x => { out[x.i] = { id: str(x.item.id), ok: false, reason }; });
    const sc = G.sid.check(sid, SECRET, crypto);
    if (!sc.ok) return all('revoked');
    if (t - sc.iat > G.ITEM_MAX_AGE_MS) return all('expired');
    const e = c.idx.a[acct];
    if (!e) return all('unknown-account');
    if (G.sidCv(sid) !== str(e.cv).slice(0, 12)) return all('revoked');
    const key = G.sessionKey(SECRET, acct, sid, crypto);
    const good = group.filter(x => {
      const no = reason => { out[x.i] = { id: str(x.item.id), ok: false, reason }; return false; };
      if (str(x.item.a) !== acct || str(x.item.sid) !== sid) return no('malformed');
      if (!G.sealOk(x.item, key, crypto)) return no('bad-seal');
      return true;
    });
    if (!good.length) return;
    const p = place(c, acct);
    if (p.error) { good.forEach(x => { out[x.i] = { id: str(x.item.id), ok: false, reason: p.error, retry: true }; }); return; }
    const slice = p.slice, me = { acct, stu: str(slice.studentId) };
    good.forEach(x => {
      const it = x.item, id = str(it.id);
      const v = G.validateItem(it, me, slice, { papers: w.papers(slice) });
      if (!v.ok) { out[x.i] = { id, ok: false, reason: v.reason || 'not-yours' }; return; }
      if (it.kind === 'submit') {
        const r = w.submit(it, v.attempt, me, slice);
        if (r.writes) writing.push(x.i);
        delete r.writes;
        out[x.i] = Object.assign({ id }, r);
        return;
      }
      if (v.known) { out[x.i] = { id, ok: true, dup: true }; return; }   // already in the Centre's records
      if (it.kind === 'op') { if (w.op(v.op, me)) writing.push(x.i); }
      else { w.record(v.key, v.rec, v.recId, me, slice); writing.push(x.i); }
      out[x.i] = { id, ok: true };
    });
  }

  function deliver(req, t) {
    const items = req.items;
    if (!Array.isArray(items) || !items.length || items.length > LIMITS.DELIVER_MAX_ITEMS) fail('bad-request');
    const suffix = req.lane != null && req.lane !== '' ? str(req.lane) : '';
    if (suffix && !/^[A-Za-z0-9]{1,12}$/.test(suffix)) fail('bad-request');
    ready(t);
    const out = new Array(items.length);
    let writing = [], decided = false;
    return saveRecords(storedText => {
      writing = []; decided = false;
      const c = ready(t, storedText);
      const w = new Work(c, t), groups = {}, order = [];
      items.forEach((it, i) => {
        if (!isObj(it) || it.id == null || !it.a || !it.sid) { out[i] = { id: isObj(it) && it.id != null ? str(it.id) : '', ok: false, reason: 'malformed' }; return; }
        const k = str(it.a) + '\u0000' + str(it.sid);
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push({ i, item: it });
      });
      order.forEach(k => { const g = groups[k]; deliverSession(c, w, str(g[0].item.a), str(g[0].item.sid), g, out, writing, t); });
      decided = true;
      const values = w.values();
      return Object.keys(values).length ? payloadWith(c.payload, values, t) : null;
    }).then(() => ({ ok: true, receipts: out }), err => {
      if (err && err.gateError && !decided) throw err;
      // Nothing was written: every item that was to be written is answered
      // "retry", stays on the device and is sent again.
      log('A trainee\'s work could not be saved just now (their device will send it again): ' + (err && err.message));
      (decided ? writing : items.map((_, i) => i)).forEach(i => { out[i] = { id: out[i] ? out[i].id : str(items[i] && items[i].id), ok: false, reason: 'retry', retry: true }; });
      return { ok: true, receipts: out };
    });
  }

  /* ---------------------------------------------------------- health */
  function health(t) {
    const r = { secret: !!SECRET, folders: true, ledger: false, ledgerUpdated: null, trainees: null };
    if (G) {
      try {
        const c = context(t);
        r.ledger = !!c.payload;
        if (c.payload) { r.ledgerUpdated = c.updated; r.trainees = c.idx.n; }
      } catch (e) { r.ledger = false; }
    }
    // staffOnly (this server only): whether its records are kept for staff
    // devices (cestis-offline-server.js) — then a trainee's device signs in here.
    return { ok: true, service: SERVICE, version: GATE_VERSION, protocol: PROTOCOL.slice(), time: iso(t), ready: r,
      accepting: !!G && selfOk && !killed(), staffOnly: !!staffOnly() };
  }
  // The administrator's page: ✓ / ✗ lines, counts only — no names, no ids.
  function selfcheckPage(t) {
    const h = health(t);
    let exams = 0, linked = 0;
    try {
      const c = context(t);
      exams = c.list('voctrain_exams').filter(e => e.status !== 'draft' && e.status !== 'cancelled' && Core.exams.questionCount(e) > 0).length;
      linked = Object.keys(c.idx.a).filter(id => !place(c, id).error).length;
    } catch (e) {}
    const st = G ? G.selfTest(crypto) : { ok: false, checks: [] };
    const line = (ok, text) => '<li>' + (ok ? '✓ ' : '✗ ') + text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</li>';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Trainee sign-in check</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px;color:#111;background:#fff}' +
      'li{list-style:none;margin:4px 0}</style></head><body><h1>Trainee sign-in check</h1><ul>' +
      line(true, 'Version ' + GATE_VERSION + ' (protocol ' + PROTOCOL.join(', ') + ')') +
      line(h.accepting, h.accepting ? 'Answering trainees' : 'Switched off — trainees use today\'s sign-in') +
      line(h.ready.secret, 'Session secret present') +
      line(h.ready.ledger, h.ready.ledger ? 'Accounts found: ' + h.ready.trainees + ' trainee accounts, records updated ' + h.ready.ledgerUpdated : 'No records yet') +
      line(linked > 0 || !h.ready.trainees, 'Records ready for ' + linked + ' of ' + (h.ready.trainees || 0) + ' trainee accounts (built when they ask)') +
      line(true, 'Answer keys: ' + exams + ' exams') +
      st.checks.map(ch => line(ch.ok, 'Self-test: ' + ch.name)).join('') +
      '</ul></body></html>';
  }

  /* ---------------------------------------------------------- dispatch */
  const OPS = {
    'health': (req, t) => health(t),
    'auth.start': authStart, 'auth.password': authPassword, 'auth.2fa': authTwoStep,
    'pull': pull, 'paper': paper, 'attempt.get': attemptGet, 'review': review, 'room.get': roomGet,
    'signOut': signOutOp, 'deliver': deliver,
    // Need the internet or Google Drive: not on the Centre's own network.
    'auth.email': () => ({ ok: false, error: 'not-available' }), 'auth.2fa.send': () => ({ ok: false, error: 'not-available' }),
    'upload': () => ({ ok: false, error: 'not-available' }), 'file.get': () => ({ ok: false, error: 'not-available' }),
    // Registration from home needs the trainee's own email account: never on the Centre's own network.
    'catalogue': () => ({ ok: false, error: 'not-available' }), 'register.start': () => ({ ok: false, error: 'not-available' }),
    'register.submit': () => ({ ok: false, error: 'not-available' })
  };
  function errCode(err) {
    if (err && err.gateError) return err.gateError;
    const msg = String(err && err.message || err);
    if (/EBUSY|EPERM|EACCES|EMFILE|ENFILE|EAGAIN|busy/i.test(msg)) return 'busy';
    return 'internal';
  }
  function run(req, t) {
    if (typeof t !== 'number') t = now();
    const op = str(req && req.op);
    const fn = Object.prototype.hasOwnProperty.call(OPS, op) ? OPS[op] : null;
    if (!fn) return Promise.resolve({ ok: false, error: 'unknown-op' });
    return Promise.resolve().then(() => {
      if (req.v != null && PROTOCOL.indexOf(Number(req.v)) === -1) return { ok: false, error: 'client-too-old' };
      if (op !== 'health' && (!G || !selfOk || killed())) return { ok: false, error: 'off' };
      return fn(req, t);
    }).then(out => {
      if (out && out.ok === undefined) out.ok = true;
      return out;
    }, err => {
      const code = errCode(err);
      if (!(err && err.gateError)) log('A trainee sign-in request failed (the system is still running): ' + (err && err.stack || err));
      const res = { ok: false, error: code };
      if (code === 'busy' || code === 'internal') res.retry = true;
      if (err && err.gateExtra) Object.keys(err.gateExtra).forEach(k => { res[k] = err.gateExtra[k]; });
      return res;
    });
  }

  function reply(res, status, obj) { opts.send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8'); }
  function handle(req, res) {
    const url = String(req.url || '');
    if (req.method === 'GET') {
      const q = new URLSearchParams(url.indexOf('?') === -1 ? '' : url.slice(url.indexOf('?') + 1));
      const op = q.get('op') || 'health';
      if (op === 'selfcheck') return opts.send(res, 200, selfcheckPage(now()), 'text/html; charset=utf-8');
      return run({ op }).then(out => reply(res, 200, out));
    }
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'bad-request' });
    const chunks = [];
    let received = 0, over = false;
    req.on('data', ch => {
      received += ch.length;
      if (received > LIMITS.BODY_MAX) { if (!over) { over = true; reply(res, 413, { ok: false, error: 'too-large' }); req.destroy(); } return; }
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

  return { handle, run, health, GATE_VERSION };
}

module.exports = { create, loadOrCreateSecret, crypto, GATE_VERSION, PROTOCOL, LIMITS, LMS_FILE };
