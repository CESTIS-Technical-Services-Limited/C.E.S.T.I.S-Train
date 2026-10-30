#!/usr/bin/env node
/* ============================================================================
   cestis-offline-server.js — runs the whole CESTIS system on one computer and
   serves it to every other device on the same local network. No internet.

   WHAT IT DOES
   ------------
   1. Serves every page in this folder over https:// — the system needs a real
      web address, not file://, because browsers refuse storage and page loading
      to documents opened straight off the disk, and it needs an address they
      TRUST or they will not allow video classes (see 2). The certificate is
      made by this computer on first run; see cestis-offline-cert.js.
   2. Introduces browsers to each other so VIDEO CLASSES work. Two browsers
      cannot start a call unaided — something has to carry the first few
      messages between them, and online that job is done by a public server.
      This does it here (see cestis-offline-signalling.js), which is what makes
      the conference pages work with no internet.

      Browsers hand out the camera, the microphone and the video connection
      only to pages served over https://, or opened on this computer as
      localhost — a page fetched over the network as http://192.168.x.x is
      refused all three by every browser. That is why point 1 serves https://.
      Each device shows a certificate warning the first time and never again.

      If this computer has no way to make a certificate, the server falls back
      to http:// and says so: video classes then work on this machine only,
      and everything else carries on as normal.
   3. Provides the SHARED STORE the Google Drive sync normally provides. Each
      page keeps its own file, exactly as it does in the cloud version, except
      the files live in "Offline System/data" on this computer instead of Drive.
      That is what lets the Coordinator's laptop, the office desktop and an
      instructor's tablet see the same trainees, fees and vouchers with no
      internet at all.
   4. Runs the TRAINEE GATE (cestis-offline-gate.js, at /_cestis/gate): a
      trainee's device can sign in there and be given that trainee's own
      records only. With the staff-only switch on (see "the staff-only
      switch" below) the shared store above is then for staff devices only.

   HOW TO RUN IT
   -------------
   Double-click the launcher for your system (START-WINDOWS.bat,
   START-MAC.command, START-LINUX.sh), or from a terminal:
       node cestis-offline-server.js
   It prints the address other devices should type into their browser.

   NO INSTALLATION
   ---------------
   Uses only what Node.js ships with — nothing to download, which is the point
   of an offline build. Node.js 14 or newer is needed; the launchers say so
   and stop if it is missing or older. (They used to fall back to Python's
   web server, which served the records folder and the private key to the
   whole network and shared nothing between devices — see READ ME FIRST.)
   ============================================================================ */
'use strict';

const store = require('./cestis-offline-store.js');
if (store.nodeTooOld(process.versions.node)) {
  console.error('\n  This computer has Node.js ' + process.versions.node + '. The offline system needs');
  console.error('  Node.js ' + store.MIN_NODE_MAJOR + ' or newer — with an older one the pages open but every');
  console.error('  video class fails. Install the current "LTS" version from https://nodejs.org');
  console.error('  (on a computer with internet; copy the installer here), then start again.\n');
  process.exit(1);
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const signalling = require('./cestis-offline-signalling.js');
const lanCert = require('./cestis-offline-cert.js');
// The same merge rules every device uses, so the server can merge each save
// into what it holds instead of replacing it.
let Core = null;
try { Core = require('./cestis-core.js'); } catch (e) { Core = null; }

const ROOT = __dirname;
// Both overridable so the tests can run a server on a scratch folder.
const DATA_DIR = path.resolve(process.env.CESTIS_DATA_DIR || path.join(ROOT, 'data'));
// The largest save the server takes (512 MiB: years of a busy Centre's records).
const MAX_BODY_BYTES = 512 * 1024 * 1024;
const CERT_DIR = path.resolve(process.env.CESTIS_CERT_DIR || path.join(ROOT, 'cert'));
const USER_LOGIN_DIR = path.join(ROOT, 'User Login');
const PORT = Number(process.env.CESTIS_PORT || process.argv[2] || 8080);
// Set CESTIS_HTTP=1 to force plain http:// — video classes then only work on
// this computer (see the note by the video-class banner below).
const FORCE_HTTP = String(process.env.CESTIS_HTTP || '') === '1' ||
                   process.argv.indexOf('--http') !== -1;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',   '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg'
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

/* Every request to the store has to carry this token. The pages fetch it from
   /_cestis/token once they have found this server, so nobody types anything.

   BE HONEST ABOUT WHAT IT DOES: it stops other WEBSITES, open in some browser
   on the network, from reading or rewriting the Centre's records. It does NOT
   stop a person on the Centre's network who can open the system — anyone who
   can load the pages can ask for the token the same way they do. See READ ME
   FIRST, "WHO CAN SEE THE RECORDS".

   It is kept in cert/lan-token so it survives a restart: it used to change
   every time the server started, and every page already open then failed
   every save, silently, until somebody reloaded it.

   With the STAFF-ONLY switch on (below) that changes: the token is replaced,
   and the new one is given only to a member of staff whose password this
   server has checked. A trainee's device then signs in through the trainee
   gate (/_cestis/gate) and is given its own records only. */
let ACCESS_TOKEN = store.loadOrCreateToken(CERT_DIR);
function tokenOk(req) {
  const given = req.headers['x-cestis-token'];
  if (typeof given !== 'string' || given.length !== ACCESS_TOKEN.length) return false;
  // Constant-time compare so the token cannot be guessed a character at a time.
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ACCESS_TOKEN)); }
  catch (e) { return false; }
}

/* Every address this computer can be reached on, so whoever is setting the
   Centre up can read one out to the room instead of hunting through settings. */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    });
  });
  return out;
}

/* WHICH NAME WAS USED TO REACH US. A website on the internet can make its own
   name point at this computer's address (DNS rebinding): the browser then
   treats this server as part of that website, and its script could fetch the
   token and read or rewrite the Centre's records. Such a request still says
   the website's name in its Host header, so the store answers only to the
   names this server really has: localhost, this computer's own network
   addresses and its name — plus any listed in CESTIS_HOSTNAMES (comma-
   separated) for a Centre that reaches it by a name of its own. */
const EXTRA_HOSTNAMES = String(process.env.CESTIS_HOSTNAMES || '').split(',')
  .map(h => h.trim().toLowerCase()).filter(Boolean);
function knownHostnames() {
  const names = ['localhost', '127.0.0.1', '[::1]'];
  try {
    const h = String(os.hostname() || '').toLowerCase();
    if (h) names.push(h, h + '.local', h.split('.')[0]);
  } catch (e) {}
  lanAddresses().forEach(a => names.push(String(a.address).toLowerCase()));
  return names.concat(EXTRA_HOSTNAMES);
}
const refusedHosts = new Set();
function hostOk(req) {
  let h = String(req.headers.host || '').trim().toLowerCase();
  if (!h) return false;
  h = h.charAt(0) === '[' ? h.slice(0, h.indexOf(']') + 1) : h.replace(/:\d+$/, '');
  if (knownHostnames().indexOf(h) !== -1) return true;
  if (!refusedHosts.has(h) && refusedHosts.size < 50) {
    refusedHosts.add(h);
    console.log('  Refused the records to a page that reached this server as "' + h + '". If that is this');
    console.log('  computer\'s own name on your network, start the server with CESTIS_HOSTNAMES=' + h);
  }
  return false;
}

/* ------------------------------------------------------------ host tickets */
/* A class room's host place is given only to signed-in staff (see the note in
   cestis-offline-signalling.js). The page sends the password the person has
   just signed in with; it is checked here against the Centre's accounts in
   the data folder, and a short-lived ticket comes back. The secret that signs
   tickets lives in cert/host-secret and never leaves this computer. */
const HOST_SECRET = (function () {
  const file = path.join(CERT_DIR, 'host-secret');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{64}$/.test(t)) return t;
  } catch (e) {}
  const t = crypto.randomBytes(32).toString('hex');
  try { fs.mkdirSync(CERT_DIR, { recursive: true }); fs.writeFileSync(file, t + '\n', { mode: 0o600 }); } catch (e) {}
  return t;
})();
const STAFF_ROLES = { admin: 1, adminstaff: 1, instructor: 1 };
const PUBLISHED_DEFAULTS = ['cestisadmin123$', 'admin123'];
const ACCOUNT_FILES = ['CESTIS_LMS_Dashboard.json', 'CESTIS_ALL_DATA.json'];
const accountCache = new Map();   // file -> { stamp, list }
function accountsIn(file) {
  const full = path.join(DATA_DIR, file);
  let st;
  try { st = fs.statSync(full); } catch (e) { return []; }
  const stamp = st.mtimeMs + ':' + st.size;
  const hit = accountCache.get(file);
  if (hit && hit.stamp === stamp) return hit.list;
  let list = [];
  try {
    const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
    const v = payload && payload.data && payload.data.voctrain_users;
    list = typeof v === 'string' ? JSON.parse(v) : v;
  } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  accountCache.set(file, { stamp, list });
  return list;
}
function centreAccounts() {
  const byId = new Map();
  ACCOUNT_FILES.forEach(f => accountsIn(f).forEach(a => {
    if (!a || a.id == null) return;
    const cur = byId.get(a.id);
    if (!cur || (Date.parse(a.updatedAt || '') || 0) > (Date.parse(cur.updatedAt || '') || 0)) byId.set(a.id, a);
  }));
  return Array.from(byId.values());
}
function isStaffLogin(a) {
  if (!a || !STAFF_ROLES[String(a.role || '').trim().toLowerCase()]) return false;
  const st = String(a.status || '').trim().toLowerCase();
  if (st === 'disabled' || st === 'rejected' || st === 'pending') return false;
  if (typeof a.password !== 'string' || !a.password) return false;
  if (a.defaultPassword === true || a.mustChangePassword) return false;   // still the published seed
  return PUBLISHED_DEFAULTS.indexOf(a.password) === -1;
}
function verifyStoredPassword(password, stored) {
  return new Promise(resolve => {
    const same = (x, y) => { const a = Buffer.from(String(x)), b = Buffer.from(String(y)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
    try {
      if (stored.indexOf('pbkdf2$') === 0) {
        const p = stored.split('$');
        if (p.length !== 4) return resolve(false);
        crypto.pbkdf2(String(password), Buffer.from(p[2], 'hex'), parseInt(p[1], 10) || 210000, 32, 'sha256', (err, key) => {
          resolve(!err && same(key.toString('hex'), p[3]));
        });
        return;
      }
      if (/^[a-f0-9]{64}$/.test(stored)) {
        return resolve(same(crypto.createHash('sha256').update(String(password) + '__CESTIS_SALT_2026__').digest('hex'), stored));
      }
      resolve(same(password, stored));            // an account the dashboard has not hashed yet
    } catch (e) { resolve(false); }
  });
}
// Ten wrong passwords from one device in ten minutes and it waits.
const ticketFailures = new Map();
function ticketThrottled(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  const f = ticketFailures.get(ip);
  if (f && Date.now() - f.since > 10 * 60 * 1000) { ticketFailures.delete(ip); return false; }
  return !!(f && f.count >= 10);
}
function ticketFailed(req) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  const f = ticketFailures.get(ip) || { count: 0, since: Date.now() };
  f.count++;
  ticketFailures.set(ip, f);
}
/* A member of staff proving who they are with the password they have just
   signed in with, checked here against the Centre's accounts. The host
   ticket below asks this way; so do the records token while the staff-only
   switch is on, and (administrators only) the switch itself. `roles` says
   who counts; done(acct, body) runs once the password is right. */
function withStaffPassword(req, res, roles, refusal, done) {
  if (ticketThrottled(req)) return send(res, 429, JSON.stringify({ ok: false, error: 'too many attempts — wait ten minutes' }), MIME['.json']);
  const chunks = [];
  let received = 0, tooBig = false;
  req.on('data', c => {
    received += c.length;
    if (received > 8192) { if (!tooBig) { tooBig = true; send(res, 413, 'too large'); req.destroy(); } return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooBig) return;
    let body = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
    const who = String((body && body.username) || '').trim().toLowerCase();
    const password = body && typeof body.password === 'string' ? body.password : '';
    const refuse = () => { ticketFailed(req); send(res, 403, JSON.stringify({ ok: false, error: refusal }), MIME['.json']); };
    if (!who || !password || PUBLISHED_DEFAULTS.indexOf(password) !== -1) return refuse();
    const acct = centreAccounts().filter(a => isStaffLogin(a) && roles[String(a.role || '').trim().toLowerCase()]).find(a =>
      String(a.username || '').trim().toLowerCase() === who || String(a.email || '').trim().toLowerCase() === who);
    if (!acct) return refuse();
    verifyStoredPassword(password, acct.password).then(ok => {
      if (!ok) return refuse();
      done(acct, body);
    });
  });
}
function handleHostTicket(req, res) {
  if (req.method !== 'POST') return send(res, 405, 'method not allowed');
  withStaffPassword(req, res, STAFF_ROLES, 'not a member of staff with that password', acct => {
    const ticket = signalling.makeTicket(HOST_SECRET, { u: acct.id, r: String(acct.role).toLowerCase() });
    const claims = signalling.verifyTicket(HOST_SECRET, ticket);
    send(res, 200, JSON.stringify({ ok: true, ticket, expires: claims ? claims.exp : 0 }), MIME['.json']);
  });
}

/* ------------------------------------------------- the staff-only switch */
/* "Trainee devices on the Centre network get only their own records"
   (docs/trainee-gate/DESIGN.md §6). OFF unless an administrator turns it on,
   and while it is off everything here works exactly as before.

   Off, any device that opens the system can ask /_cestis/token for the
   records token (see the note at ACCESS_TOKEN and READ ME FIRST section 7).
   ON:
     - the token is REPLACED (cert/lan-token), so every device that already
       had it is refused at its next request;
     - /_cestis/token gives the new one only to a POST of the username and
       password of a member of staff, checked here (as for host tickets);
     - so /_cestis/data/* answers staff devices only, and a trainee's device
       signs in through the trainee gate (/_cestis/gate), which gives it that
       trainee's own records and checks everything it sends back.
   Turning it off replaces the token again and opens /_cestis/token as before.

   The setting lives in the records folder, data/.server/staff-only.json —
   a sub-folder, which /_cestis/data/ cannot reach (it never serves a path).
   Only an administrator can change it, with their password checked here.
   It counts only while the folder holds a staff login with a password of
   its own — a Centre whose data folder was replaced must not be locked out
   of its own records. To turn it off from the server computer itself, stop
   the server, delete that file and start it again (READ ME FIRST). */
const SWITCH_FILE = path.join(DATA_DIR, '.server', 'staff-only.json');
let switchCache = { stamp: null, on: false, setAt: '' };
function staffOnlySetting() {
  let st;
  try { st = fs.statSync(SWITCH_FILE); } catch (e) { return { on: false, setAt: '' }; }
  const stamp = st.mtimeMs + ':' + st.size;
  if (switchCache.stamp === stamp) return switchCache;
  let v = null;
  try { v = JSON.parse(fs.readFileSync(SWITCH_FILE, 'utf8')); } catch (e) { v = null; }
  // A setting that cannot be read is OFF — today's behaviour — and said so.
  if (!v) console.log('  The staff-only setting (data/.server/staff-only.json) could not be read, so it is treated as off.');
  switchCache = { stamp, on: !!(v && v.on === true), setAt: String((v && v.setAt) || '') };
  return switchCache;
}
function staffOnly() {
  return staffOnlySetting().on && centreAccounts().some(isStaffLogin);
}
function handleStaffToken(req, res) {
  withStaffPassword(req, res, STAFF_ROLES, 'not a member of staff with that password', () => {
    send(res, 200, JSON.stringify({ ok: true, token: ACCESS_TOKEN, staffOnly: true }), MIME['.json']);
  });
}
function handleStaffOnlySwitch(req, res) {
  withStaffPassword(req, res, { admin: 1 }, 'not an administrator with that password', (acct, body) => {
    if (typeof body.on !== 'boolean') return send(res, 400, JSON.stringify({ ok: false, error: 'say on: true or on: false' }), MIME['.json']);
    try {
      if (staffOnlySetting().on !== body.on) {
        // The new token reaches the disk first: a switch that said "on" over
        // the old token would leave every trainee device holding it.
        ACCESS_TOKEN = store.rotateToken(CERT_DIR);
        fs.mkdirSync(path.dirname(SWITCH_FILE), { recursive: true });
        store.writeDurable(SWITCH_FILE, JSON.stringify({ format: 'cestis-server-setting', version: 1, on: body.on,
          setAt: new Date().toISOString(), setBy: String(acct.id) }, null, 2));
        console.log('  ' + (body.on ? 'Trainee devices now get only their own records (switched on by an administrator).'
          : 'Every device can be given the records again (switched off by an administrator).'));
      }
    } catch (e) {
      return send(res, 500, JSON.stringify({ ok: false, error: 'the setting could not be saved: ' + (e && e.message) }), MIME['.json']);
    }
    send(res, 200, JSON.stringify({ ok: true, on: staffOnly(), token: ACCESS_TOKEN }), MIME['.json']);
  });
}
/* For the signalling server: may this connection take a room's host place?
   With a valid ticket, yes. With none, only while the data folder holds no
   staff login with a password of its own — a brand-new Centre, where there is
   nothing to check a password against yet. */
function hostCheck(id, key) {
  if (signalling.verifyTicket(HOST_SECRET, key)) return { ok: true };
  if (!centreAccounts().some(isStaffLogin)) return { ok: true };
  return { ok: false, msg: 'Only signed-in staff can host a class on this Centre’s server: sign out and sign in again with your staff account, then start the class.' };
}

function send(res, status, body, type, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    // The pages this server serves are same-origin, so they need no CORS grant
    // at all. It used to send '*', which invited EVERY page in every browser on
    // the network — including any website a trainee happened to have open — to
    // read and rewrite the Centre's records.
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CESTIS-Token, X-CESTIS-Base',
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

/* ---------------------------------------------------------------- the store */
/* One file per page, same shape the Drive backup uses, so a folder copied off
   this machine can be read by the online version and the other way round. */
function safeDataFile(name) {
  // Never let a request reach outside the data folder.
  const clean = String(name || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!clean || clean === '.' || clean === '..') return null;
  return path.join(DATA_DIR, clean.endsWith('.json') ? clean : clean + '.json');
}

function handleData(req, res, name) {
  const file = safeDataFile(name);
  if (!file) return send(res, 400, 'bad file name');

  if (req.method === 'GET') {
    fs.readFile(file, (err, buf) => {
      // Only a file that is not there is "absent". Any other failure (the
      // file busy, locked by a virus scan or a backup tool, too many open
      // files) used to be answered as absent too, and the device then merged
      // its own keys against nothing and saved that over the Centre's file. A
      // 5xx makes the device stop and try again instead.
      if (err) {
        if (err.code === 'ENOENT') return send(res, 404, '{}', MIME['.json']);
        return send(res, 503, 'could not read ' + path.basename(file) + ': ' + (err.code || err.message), null, { 'Retry-After': '5' });
      }
      // A device asking "has it changed since <etag>?" gets a 304 and no body:
      // the half-minute refresh on every device costs next to nothing when
      // nothing moved, instead of the whole file every time.
      const etag = store.etagOf(buf);
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', null, { ETag: etag });
      send(res, 200, buf, MIME['.json'], { ETag: etag });
    });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    // Collect the raw bytes and decode ONCE at the end. Concatenating each
    // chunk as a string decoded every chunk on its own, so a multi-byte
    // character (any accented name, a dash, a currency symbol) that straddled a
    // chunk boundary was torn in half and stored as two replacement characters
    // — and because the JSON still parsed, the damage was saved and synced
    // everywhere without a single error.
    const chunks = [];
    let received = 0, tooBig = false;
    req.on('data', c => {
      received += c.length;
      // A school year's dashboard file is ~52 MB and grows each year; the old
      // 64 MiB ceiling refused every save from about month 13 (EF-5). Saves
      // that carry only what changed (partial-put) are far smaller.
      if (received > MAX_BODY_BYTES) {
        if (!tooBig) { tooBig = true; send(res, 413, 'too large'); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      const body = Buffer.concat(chunks).toString('utf8');
      let incoming;
      try { incoming = JSON.parse(body); } catch (e) { return send(res, 400, 'not JSON'); }
      // Merged into what is stored, one save at a time per file, written to a
      // temporary file of its own and renamed into place, with the previous
      // version kept in data/.history — see cestis-offline-store.js.
      // X-CESTIS-Base: the version (ETag) of the file the device's save was
      // built on. The answer says whether the stored file still was that
      // version, so the device can keep the merged result as its copy
      // instead of downloading the whole file again.
      const base = req.headers['x-cestis-base'] || null;
      store.save({ file, dataDir: DATA_DIR, incoming, core: Core, base }).then(r => {
        send(res, 200, JSON.stringify({ ok: true, file: path.basename(file), bytes: r.bytes,
          etag: r.etag, changedByServer: r.changedByServer, basedOn: r.basedOn === true, resultSig: r.resultSig || null }), MIME['.json'], { ETag: r.etag });
      }, err => {
        if (err && err.code === 'PARTIAL_NEEDS_FULL') return send(res, 409, JSON.stringify({ ok: false, error: 'send the whole file' }), MIME['.json']);
        send(res, 500, 'save failed: ' + (err && err.message));
      });
    });
    return;
  }
  send(res, 405, 'method not allowed');
}

function listData(res) {
  ensureDataDir();
  fs.readdir(DATA_DIR, (err, files) => {
    // (data/.history holds earlier versions, not page files, and is a folder.)
    const list = (files || []).filter(f => f.endsWith('.json')).map(f => {
      let size = 0, modified = '';
      try { const st = fs.statSync(path.join(DATA_DIR, f)); size = st.size; modified = st.mtime.toISOString(); } catch (e) {}
      return { file: f, size, modified };
    });
    // (No folder path: where the records live on this computer is nobody
    // else's business, and it told anyone holding the token.)
    send(res, 200, JSON.stringify({ ok: true, files: list }, null, 2), MIME['.json']);
  });
}

/* --------------------------------------------------------------- the pages */
function serveStatic(req, res, urlPath) {
  // A stray percent sign in the address used to throw out of this line and take
  // the whole server down with it — one mistyped address, one stale bookmark or
  // one network scanner and the entire Centre lost the system until somebody
  // walked over and started it again.
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { return send(res, 400, 'That address could not be read.'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  // A prefix test alone let any SIBLING folder whose name merely starts the same
  // way be served — "Offline System-backup", "Offline System (old)" — each of
  // which holds an older copy of the Centre's data and its own private key.
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');
  // The records folder and the certificate folder are NOT web pages. Serving
  // them as ordinary files handed out the whole store and the server's private
  // key to anyone who guessed the path. "User Login" can hold real per-user
  // exports (password hashes, two-step secrets), dot-files are not pages, and
  // no key file is ever one either.
  const inside = d => full === d || full.startsWith(d + path.sep);
  const relParts = path.relative(ROOT, full).split(path.sep);
  if (inside(DATA_DIR) || inside(CERT_DIR) || inside(path.join(ROOT, 'data')) || inside(path.join(ROOT, 'cert')) ||
      inside(USER_LOGIN_DIR) || relParts.some(p => p.charAt(0) === '.') || /\.(pem|key)$/i.test(full)) {
    return send(res, 403, 'forbidden');
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, 'Not found: ' + rel + '\n\nThis file is not part of the offline system folder.');
    }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    // Range support so long videos and PDFs can be scrubbed rather than
    // downloaded whole before anything plays.
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range) && range !== 'bytes=-') {
      const [s, e] = range.replace('bytes=', '').split('-');
      let start, end;
      if (s === '') {
        // "bytes=-N" means the LAST N bytes. It used to be read as "the first N",
        // so a player asking for the tail of a file was handed the head instead
        // and reported the file as corrupt.
        const n = parseInt(e, 10);
        start = Math.max(0, st.size - n);
        end = st.size - 1;
      } else {
        start = parseInt(s, 10);
        // Clamp: an open-ended or over-long request used to promise more bytes
        // in Content-Length than the file holds, so the player sat waiting for
        // data that could never arrive until the connection timed out.
        end = e ? Math.min(parseInt(e, 10), st.size - 1) : st.size - 1;
      }
      if (start >= st.size || end < start) return send(res, 416, 'range not satisfiable');
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start + 1)
      });
      fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(full).pipe(res);
  });
}

function isLoopback(req) {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/* ------------------------------------------------------------------ server */
/* https:// when this computer can make itself a certificate, http:// when it
   cannot. The scheme is not cosmetic: browsers only give the camera, the
   microphone and the video connection to a page on an address they trust, so
   video classes work on other devices ONLY over https. Everything else works
   the same either way. See cestis-offline-cert.js. */
const tls = FORCE_HTTP ? null : lanCert.ensure(CERT_DIR, msg => console.log('  ' + msg));
const SCHEME = tls ? 'https' : 'http';

/* The trainee gate (cestis-offline-gate.js): a trainee's device signs in
   there and is given that trainee's own records only, built from the data
   folder by the same rules (cestis-core.js) the online gate uses. Nothing
   calls it until a page is set to; with no cestis-core.js it stays off. */
let gate = null;
try {
  if (Core && Core.gate) {
    gate = require('./cestis-offline-gate.js').create({ core: Core, store, dataDir: DATA_DIR, certDir: CERT_DIR, rootDir: ROOT,
      accounts: centreAccounts, staffOnly, send, log: msg => console.log('  ' + msg) });
  }
} catch (e) {
  gate = null;
  console.log('  Trainee sign-in through this server is off: ' + (e && e.message));
}

const handler = (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = req.url || '/';

  if (url === '/_cestis/health') {
    // Just enough for a page to know this is the Centre's server and to set
    // its clock by — no folder paths or machine names for anyone who asks.
    // (With the staff-only switch on it also says so, so a page knows the
    // records token needs a staff sign-in; off, the answer is as it always was.)
    const h = { ok: true, mode: 'offline-lan', version: '1.1', time: new Date().toISOString() };
    if (staffOnly()) h.staffOnly = true;
    // X-CESTIS-Features: partial-put — a save may carry only the keys that
    // changed (merged into the stored file, which must exist and be readable).
    return send(res, 200, JSON.stringify(h), MIME['.json'], { 'X-CESTIS-Features': 'partial-put' });
  }
  // Everything below /_cestis/ except the health check answers only to this
  // server's own names (see hostOk: a rebound website name gets nothing).
  if (url.indexOf('/_cestis/') === 0 && !hostOk(req)) {
    return send(res, 421, JSON.stringify({ ok: false, error: 'This server answers only at its own addresses.' }), MIME['.json']);
  }
  if (url === '/_cestis/token') {
    if (!staffOnly()) return send(res, 200, JSON.stringify({ ok: true, token: ACCESS_TOKEN }), MIME['.json']);
    // The staff-only switch is on: the token is for a checked staff sign-in.
    if (req.method !== 'POST') {
      return send(res, 403, JSON.stringify({ ok: false, staffOnly: true, error: 'a member of staff must sign in on this device' }), MIME['.json']);
    }
    return handleStaffToken(req, res);
  }
  if (url === '/_cestis/staff-only') {
    // Whether it is on is no secret (a page needs to know); changing it is
    // for an administrator, from a page of this server's (it carries the token).
    if (req.method === 'GET') {
      return send(res, 200, JSON.stringify({ ok: true, on: staffOnly(), setAt: staffOnlySetting().setAt }), MIME['.json']);
    }
    if (req.method !== 'POST') return send(res, 405, 'method not allowed');
    if (!tokenOk(req)) return send(res, 401, JSON.stringify({ ok: false, error: 'not authorised' }), MIME['.json']);
    return handleStaffOnlySwitch(req, res);
  }
  if (url === '/_cestis/gate' || url.indexOf('/_cestis/gate?') === 0) {
    // The trainee gate: needs no records token — it signs trainees in itself
    // and gives each only their own records (cestis-offline-gate.js).
    if (!gate) return send(res, 503, JSON.stringify({ ok: false, error: 'off' }), MIME['.json']);
    return gate.handle(req, res);
  }
  if (url === '/_cestis/rooms') {
    // Every live class's room code — and the room code is all it takes to
    // join. Shown on the server computer itself only (READ ME FIRST, section
    // 5). The token no longer opens it: every device on the network can have
    // the token, and no page of ours asks for this list.
    if (!isLoopback(req)) return send(res, 403, 'Open this on the server computer itself.');
    return send(res, 200, JSON.stringify({ ok: true, connected: sig.count(), rooms: sig.rooms() }, null, 2), MIME['.json']);
  }
  if (url === '/_cestis/host-ticket') {
    if (!tokenOk(req)) return send(res, 401, JSON.stringify({ ok: false, error: 'not authorised' }), MIME['.json']);
    return handleHostTicket(req, res);
  }
  // PeerJS asks for a generated id when a page does not supply one. Every page
  // here names its own, but the endpoint has to exist or the library complains.
  if (url.indexOf('/peerjs/id') === 0) {
    return send(res, 200, Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  if (url === '/_cestis/data' || url === '/_cestis/data/' || url.indexOf('/_cestis/data/') === 0) {
    if (!tokenOk(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'not authorised for this Centre\u2019s records' }), MIME['.json']);
    }
    if (url === '/_cestis/data' || url === '/_cestis/data/') return listData(res);
    return handleData(req, res, url.slice('/_cestis/data/'.length));
  }
  serveStatic(req, res, url);
};

/* Last line of defence. Whatever goes wrong in one request, the Centre keeps
   its system: the fault is written down and the server carries on serving. */
process.on('uncaughtException', err => {
  try { console.error('  A request failed unexpectedly (the system is still running): ' + (err && err.stack || err)); } catch (e) {}
});
process.on('unhandledRejection', err => {
  try { console.error('  A background step failed (the system is still running): ' + (err && err.stack || err)); } catch (e) {}
});

const server = tls
  ? https.createServer({ key: tls.key, cert: tls.cert }, handler)
  : http.createServer(handler);

ensureDataDir();

/* Video classes: carry the introductions between browsers on this network. */
const sig = signalling.attach(server, msg => console.log('  ' + msg), { hostCheck });

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already being used by something else.');
    console.error('  Start it on another port, e.g.:  node cestis-offline-server.js 8090\n');
  } else {
    console.error('\n  Could not start: ' + (err && err.message) + '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const line = '='.repeat(64);
  const url = h => SCHEME + '://' + h + ':' + PORT + '/index.html';
  console.log('\n' + line);
  console.log('  C.E.S.T.I.S  —  OFFLINE SYSTEM IS RUNNING');
  console.log(line);
  console.log('\n  On THIS computer, open:');
  console.log('      ' + url('localhost'));
  if (addrs.length) {
    console.log('\n  On ANY OTHER device on the same network (wifi or cable),');
    console.log('  open one of these in a browser:');
    addrs.forEach(a => console.log('      ' + url(a.address) + '      (' + a.name + ')'));
  } else {
    console.log('\n  This computer is not on a network yet, so only this machine');
    console.log('  can reach it. Connect to the Centre wifi/router and restart.');
  }

  if (tls) {
    console.log('\n  THE FIRST TIME each device opens that address, the browser will');
    console.log('  warn that the connection is "not private". That warning is about');
    console.log('  WHO vouched for this server\'s certificate — nobody did, because');
    console.log('  there is no internet here to ask. The connection itself is');
    console.log('  encrypted. Click Advanced, then Proceed. The device remembers,');
    console.log('  and never asks again.');
    console.log('\n  Video classes work on every device at those addresses.');
    if (tls.created) {
      console.log('  (A certificate for this computer was just created in the "cert"');
      console.log('  folder. Keep it — remaking it makes every device ask again.)');
    }
  } else {
    console.log('\n  VIDEO CLASSES — LIMITED');
    console.log('  This server is speaking plain http://, so browsers will not give');
    console.log('  it the camera or microphone on any device except this one.');
    console.log('      Video WORKS at:      ' + url('localhost'));
    if (addrs.length) console.log('      Video is BLOCKED at: ' + url(addrs[0].address));
    if (!FORCE_HTTP) {
      console.log('\n  To turn video on for the whole network, this computer needs the');
      console.log('  "openssl" command so the server can make itself a certificate.');
      console.log('  It is already on macOS and Linux; on Windows it comes with Git');
      console.log('  (https://git-scm.com). Install it, then start this again.');
    }
    console.log('\n  Everything else — trainees, fees, attendance, documents — works');
    console.log('  normally on every device at the addresses above.');
  }

  console.log('\n  Shared data is kept in:');
  console.log('      ' + DATA_DIR);
  console.log('  Back that folder up — it is the Centre\'s records. The last ' + store.HISTORY_KEEP);
  console.log('  versions of every file are kept in its ".history" folder, so a');
  console.log('  bad save can be undone (see READ ME FIRST, section 3), and one dated');
  console.log('  copy a week of every file, for ' + store.WEEKLY_KEEP + ' weeks, in its ".weekly" folder.');
  if (!Core) console.log('\n  WARNING: cestis-core.js could not be loaded, so saves REPLACE files instead of merging.');
  console.log('\n  Leave this window OPEN while people are using the system.');
  console.log('  Closing it stops the server for everybody.');
  console.log('\n' + line + '\n');
});
