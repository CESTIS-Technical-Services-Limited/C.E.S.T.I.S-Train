/* Signing in with one's own email account, end to end, in real browsers:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/email-signin-flow.js
     (npm run test:browser:email)

   The owner's question: "check the flow when persons connect using their
   Gmail — does it work, and when the administrator approves the account?"

   A person presses "Sign in with your email account", registers, waits, the
   administrator approves them on ANOTHER computer, and they sign in. Every
   device is its own browser context with its own storage; they share data
   only through one emulated Drive held in this process, exactly as two PCs
   share the Centre's backup. Every other request is aborted.

   THE PROVIDER IS FAKED ENTIRELY, IN THE PAGE AND HERE:
     - https://accounts.google.com/gsi/client is answered with a small stub of
       google.accounts.oauth2.initTokenClient. Its requestAccessToken() is "the
       pop-up": it answers as whichever identity the test has put in
       window.__fakePopup (the person choosing their account in the provider's
       window), or closes ("popup_closed") when nobody chose — and it counts
       every opening, so a pop-up nobody asked for is caught.
     - Tokens are minted here, per identity and scope, with an expiry.
     - userinfo, and Drive v3 (list/search, get ?alt=media, ?fields=version,
       media/multipart upload PATCH/POST, metadata), are answered from ONE
       in-memory store shared by every browser context.

   PERMISSIONS (the assumption this suite makes, stated plainly): the Centre's
   folders belong to the Centre's own account. Only a token for that account
   can list, read, create or update anything in them. A trainee's personal
   email token can read their own profile and nothing of the Centre's: a
   search in the Centre's folders returns no files (as Drive does for a
   folder you cannot see), and reading the folder itself, or a file in it, is
   "File not found". Files somebody creates outside the Centre's folders are
   theirs alone.

   Scenarios (numbered as in the owner's brief):
     1  lab PC at the Centre (online, the Centre's token saved by staff): a new
        trainee registers through the email button; the form is prefilled;
        the pending screen; the registration reaches the shared copy
     1b the same PC once the Centre's sign-in has expired: another trainee
        registers — no sign-in window, and the screen says plainly that the
        registration has not reached the office
     1c she tries again once the PC can send: it is sent, "awaiting approval"
     2  the same trainee presses the button again before approval: "awaiting
        approval", no sign-in, no error
     3  the administrator's PC: Sync Now, sign in, the "awaiting approval"
        notification, Verify Users lists her, Approve: trainee record created
        and linked, saved to the shared copy (backup and accounts ledger)
     4  back on the lab PC, reloaded, holding its stale "pending" copy: the
        email button lands her on her dashboard; so does the password route;
        with the Centre's token valid and with it expired (4c); an account the
        office created since (4d); no connection at all (4e)
     5  the trainee's own phone (no Centre token): what Sync Now and a
        registration really do, and what the screens claim
     6  an existing administrator-created trainee, address in other casing:
        straight in; two-step verification still applies
     7  rejected and disabled accounts: a clear message, no sign-in; a
        rejection the administrator reverses reaches the lab PC
     8  an instructor registers by email, is approved, lands on the instructor
        dashboard; one instructor record however often they sign in on the
        shared lab PC (which clears staff records at every sign-out)
     9  the hidden role field set to "admin": still a trainee
     10 the Centre-network build (no internet): the email button, which
        cannot work there, is not offered; the password sign-in is
     11 at the end: the shared copy and both devices hold exactly one active
        account and one trainee record for her

   Screenshots for the owner: set CESTIS_EMAIL_SHOTS=<dir> (and optionally
   CESTIS_EMAIL_SHOT_TAG=before|after). CESTIS_SERVE_ROOT=<dir> serves another
   copy of the site (used to take BEFORE pictures of the unfixed build).
   Kept out of the default npm test chain because it needs a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const REPO = path.join(__dirname, '..', '..');
const ROOT = process.env.CESTIS_SERVE_ROOT ? path.resolve(process.env.CESTIS_SERVE_ROOT) : REPO;
const EXE = process.env.CESTIS_CHROME ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : '/opt/pw-browsers/chromium');
const SHOTS = process.env.CESTIS_EMAIL_SHOTS || '';
const TAG = process.env.CESTIS_EMAIL_SHOT_TAG || '';
const TZ = 'America/Jamaica';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const failures = [], notes = [];
function ok(cond, msg) { if (cond) passed++; else { failed++; failures.push(msg); console.log('  ✗ FAIL: ' + msg); } return !!cond; }
function note(msg) { notes.push(msg); console.log('  · ' + msg); }
function section(t) { console.log('\n' + t); }

/* ------------------------------------------------------------- the people */
const CENTRE = { email: 'cestis.centre@gmail.com', name: 'CESTIS Training Centre' };
const PEOPLE = {
  tashana: { email: 'tashana.brown@gmail.com', name: 'Tashana Brown', given_name: 'Tashana', family_name: 'Brown' },
  shanique: { email: 'shanique.campbell@gmail.com', name: 'Shanique Campbell' },
  kemar: { email: 'kemar.williams@gmail.com', name: 'Kemar Williams' },          // registered as Kemar.Williams@Gmail.com
  rushane: { email: 'rushane.grant@gmail.com', name: 'Rushane Grant' },
  kadian: { email: 'kadian.morgan@gmail.com', name: 'Kadian Morgan' },
  devon: { email: 'devon.clarke@gmail.com', name: 'Devon Clarke' },
  tamika: { email: 'tamika.reid@gmail.com', name: 'Tamika Reid' },
  jhanelle: { email: 'jhanelle.spence@gmail.com', name: 'Jhanelle Spence' },
  shamar: { email: 'shamar.lewis@gmail.com', name: 'Shamar Lewis' }
};
PEOPLE.centre = CENTRE;
const PW = { admin: 'Marcia-Admin-2026!', kemar: 'Kemar-Weld-2026', tashana: 'Tashana2026', devon: 'Devon-Wire-2026', tamika: 'Tamika2026x', shanique: 'Shanique2026', jhanelle: 'Jhanelle2026', shamar: 'Shamar-Plumb-2026' };
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
// The stubs an earlier version left in the shared copy (see the setup).
const OLD_STUBS = [
  { id: 'USR-FEE-1792000000001-401', name: 'Kemar Williams', role: 'student', username: 'kemar.williams', password: '', email: '', programme: 'Welding & Fabrication',
    status: 'disabled', createdAt: '2026-10-15', registeredVia: 'fee-system', studentDataId: 'STU-OLDSTUBKW01', approvedBy: 'system' },
  { id: 'USR-STU-STU-OLDSTUBRG01', name: 'Rushane Grant', role: 'student', username: 'rushane.grant2', password: '', email: '', programme: 'Auto Mechanics',
    status: 'disabled', createdAt: '2026-10-15', registeredVia: 'student-sync', studentDataId: 'STU-OLDSTUBRG01', approvedBy: 'system' },
  { id: 'USR-STU-STU-OLDSTUBKM01', name: 'Kadian Morgan', role: 'student', username: 'kadian.morgan2', password: '', email: '', programme: 'Cosmetology',
    status: 'disabled', createdAt: '2026-10-15', registeredVia: 'student-sync', studentDataId: 'STU-OLDSTUBKM01', approvedBy: 'system' }
];
const STUB_PEOPLE = ['Kemar Williams', 'Rushane Grant', 'Kadian Morgan'];

/* ================================================= the provider (emulated) */
function FakeGoogle() {
  this.files = {}; this.seq = 0; this.calls = 0; this.errors = []; this.tokens = {};
  this.log = [];      // every Drive request: { who, method, path }
}
FakeGoogle.prototype.mint = function (email, scope, ttlSec) {
  const t = 'ya29.fake-' + crypto.randomBytes(9).toString('hex');
  this.tokens[t] = { email, scope: scope || '', exp: Date.now() + (ttlSec == null ? 3600 : ttlSec) * 1000 };
  return t;
};
FakeGoogle.prototype.expireAll = function (email) {
  Object.keys(this.tokens).forEach(t => { if (!email || this.tokens[t].email === email) this.tokens[t].exp = Date.now() - 1000; });
};
FakeGoogle.prototype.who = function (req) {
  const h = req.headers()['authorization'] || '';
  const tok = h.replace(/^Bearer\s+/i, '');
  const rec = this.tokens[tok];
  if (!rec) return { bad: 'unknown' };
  if (rec.exp < Date.now()) return { bad: 'expired', email: rec.email };
  return { email: rec.email, scope: rec.scope };
};
// A parent that is not a file in the store is one of the Centre's folders
// (their ids are fixed in the pages). The Centre's account owns them.
FakeGoogle.prototype.isCentreFolder = function (id) { return !this.files[id]; };
FakeGoogle.prototype.canSee = function (email, f) {
  if (!f) return false;
  if (f.owner === email) return true;
  return email === CENTRE.email && (f.parents || []).some(p => this.isCentreFolder(p) || (this.files[p] && this.files[p].owner === CENTRE.email));
};
FakeGoogle.prototype.canCreateIn = function (email, parents) {
  return (parents || []).every(p => this.isCentreFolder(p) ? email === CENTRE.email : this.canSee(email, this.files[p]));
};
FakeGoogle.prototype.list = function (q, email) {
  const clauses = String(q || '').split(/\s+and\s+/i).map(c => c.trim()).filter(Boolean);
  const unq = s => s.replace(/^'|'$/g, '').replace(/\\'/g, "'");
  return Object.values(this.files).filter(f => this.canSee(email, f) && clauses.every(c => {
    let m;
    if ((m = /^name\s*=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.name === unq(m[1]);
    if ((m = /^name\s+contains\s+('(?:[^'\\]|\\.)*')$/.exec(c))) return f.name.indexOf(unq(m[1])) !== -1;
    if ((m = /^('(?:[^'\\]|\\.)*')\s+in\s+parents$/.exec(c))) return f.parents.indexOf(unq(m[1])) !== -1;
    if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) return String(!!f.trashed) === m[1];
    if ((m = /^mimeType\s*=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.mimeType === unq(m[1]);
    if ((m = /^mimeType\s*!=\s*('(?:[^'\\]|\\.)*')$/.exec(c))) return f.mimeType !== unq(m[1]);
    return true;
  }));
};
FakeGoogle.prototype.meta = function (f) {
  return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime, createdTime: f.createdTime,
    version: String(f.version), size: String(Buffer.byteLength(f.content || '')), webViewLink: 'https://drive.example/' + f.id,
    md5Checksum: crypto.createHash('md5').update(f.content || '').digest('hex') };
};
FakeGoogle.prototype.put = function (id, meta, content, owner) {
  const now = new Date(Date.now() + (this.seq++)).toISOString();
  let f = id ? this.files[id] : null;
  if (!f) {
    id = id || ('fake' + (++this.seq) + 'x' + Math.random().toString(36).slice(2, 8));
    f = this.files[id] = { id, name: 'Untitled', mimeType: 'application/json', parents: [], createdTime: now, version: 0, content: '', owner: owner };
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
// The provider's sign-in script, as the page loads it. requestAccessToken()
// is the pop-up: it answers as window.__fakePopup.email, or closes.
const GSI_STUB = `(function(){
  window.__fakeGsi = { opened: 0, log: [] };
  function popup(cfg, o) {
    var g = window.__fakeGsi; g.opened++;
    var choice = window.__fakePopup;
    g.log.push({ scope: cfg.scope, prompt: o && o.prompt, as: choice ? (choice.email || 'cancel') : 'nobody' });
    if (!choice || choice.cancel) { setTimeout(function(){ if (cfg.error_callback) cfg.error_callback({ type: 'popup_closed', message: 'Popup window closed' }); }, 40); return; }
    fetch('https://accounts.google.com/__fake/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: choice.email, scope: cfg.scope }) })
      .then(function(r){ return r.json(); })
      .then(function(t){ cfg.callback({ access_token: t.access_token, expires_in: t.expires_in, scope: cfg.scope, token_type: 'Bearer' }); });
  }
  window.google = window.google || {};
  google.accounts = google.accounts || {};
  google.accounts.oauth2 = {
    initTokenClient: function (cfg) { return { requestAccessToken: function (o) { popup(cfg, o); } }; },
    revoke: function (t, cb) { if (cb) cb(); },
    hasGrantedAllScopes: function () { return true; }
  };
})();`;
FakeGoogle.prototype.handle = async function (route) {
  const req = route.request(), url = new URL(req.url()), method = req.method(), p = url.pathname;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Date, ETag, Location', Date: new Date().toUTCString() };
  const json = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
  try {
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.hostname === 'accounts.google.com') {
      if (p === '/gsi/client') return route.fulfill({ status: 200, contentType: 'text/javascript', headers: cors, body: GSI_STUB });
      if (p === '/__fake/token') {
        const b = JSON.parse(req.postData() || '{}');
        return json({ access_token: this.mint(b.email, b.scope, 3600), expires_in: 3600 });
      }
      return route.abort();
    }
    this.calls++;
    const w = this.who(req);
    this.log.push({ who: w.email || w.bad, method, path: p + url.search });
    if (w.bad) return json({ error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } }, 401);
    if (/\/oauth2\/v\d\/userinfo$/.test(p)) {
      const person = Object.values(PEOPLE).find(x => x.email === w.email) || { email: w.email, name: w.email.split('@')[0] };
      return json(Object.assign({ sub: crypto.createHash('md5').update(person.email).digest('hex'), email_verified: true }, person));
    }
    if (/\/drive\/v3\/about$/.test(p)) return json({ user: { emailAddress: w.email }, storageQuota: { limit: '16106127360', usage: '1024' } });
    let m;
    const body = req.postDataBuffer() || Buffer.alloc(0);
    const ctype = (await req.allHeaders())['content-type'] || '';
    const notFound = id => json({ error: { code: 404, message: 'File not found: ' + id + '.' } }, 404);
    if (/^\/upload\/drive\/v3\/files\/?$/.test(p) && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'resumable') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
        if (!this.canCreateIn(w.email, meta.parents)) return notFound((meta.parents || [])[0]);
        const f = this.put(null, meta, '', w.email);
        return route.fulfill({ status: 200, headers: Object.assign({ Location: 'https://www.googleapis.com/upload/drive/v3/files/' + f.id + '?uploadType=resumable-put' }, cors), body: '' });
      }
      const mp = parseMultipart(body, ctype) || { meta: null, content: body.toString('utf8') };
      if (!this.canCreateIn(w.email, (mp.meta || {}).parents)) return notFound(((mp.meta || {}).parents || [])[0]);
      return json(this.meta(this.put(null, mp.meta || {}, mp.content == null ? '' : mp.content, w.email)));
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && (method === 'PATCH' || method === 'PUT')) {
      if (!this.canSee(w.email, this.files[m[1]])) return notFound(m[1]);
      const type = url.searchParams.get('uploadType');
      if (type === 'multipart') { const mp = parseMultipart(body, ctype) || {}; return json(this.meta(this.put(m[1], mp.meta, mp.content))); }
      return json(this.meta(this.put(m[1], null, body.toString('utf8'))));
    }
    if (/^\/drive\/v3\/files\/?$/.test(p)) {
      if (method === 'GET') {
        let files = this.list(url.searchParams.get('q'), w.email).map(f => this.meta(f));
        if (/modifiedTime desc/.test(url.searchParams.get('orderBy') || '')) files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
        return json({ files });
      }
      if (method === 'POST') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
        if (!this.canCreateIn(w.email, meta.parents)) return notFound((meta.parents || [])[0]);
        return json(this.meta(this.put(null, meta, '', w.email)));
      }
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/.exec(p))) {
      const f = this.files[m[1]];
      if (!f && method === 'GET' && this.isCentreFolder(m[1])) {
        // One of the Centre's folders, asked for by id.
        if (w.email !== CENTRE.email) return notFound(m[1]);
        return json({ id: m[1], name: 'Centre folder', mimeType: 'application/vnd.google-apps.folder', parents: [], version: '1' });
      }
      if (!this.canSee(w.email, f)) return notFound(m[1]);
      if (m[2]) return json({ id: 'perm1', role: 'reader', type: 'anyone' });
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'application/json', headers: Object.assign({ ETag: '"' + f.version + '"' }, cors), body: f.content || '' });
        return json(this.meta(f));
      }
      if (method === 'PATCH') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
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
// What the shared copy says about the accounts, file by file.
FakeGoogle.prototype.accountsIn = function (name) {
  return Object.values(this.files).filter(f => f.name === name && !f.trashed).map(f => {
    let v = null; try { v = JSON.parse(f.content); } catch (e) {}
    if (!v) return { id: f.id, accounts: null };
    const list = Array.isArray(v.accounts) ? v.accounts : (v.data && Array.isArray(v.data.userAccounts)) ? v.data.userAccounts : Array.isArray(v.userAccounts) ? v.userAccounts : null;
    return { id: f.id, parents: f.parents, accounts: list, data: v.data || v };
  });
};
FakeGoogle.prototype.backups = function () { return this.accountsIn('CESTIS_LMS_BACKUP.json'); };
// Put accounts into the shared accounts list and the main backup, as an older
// version of the dashboard left them there.
FakeGoogle.prototype.injectAccounts = function (mainFolder, list) {
  Object.values(this.files).forEach(f => {
    if (f.trashed) return;
    let v = null; try { v = JSON.parse(f.content); } catch (e) { return; }
    if (!v) return;
    if (f.name === 'CESTIS_ACCOUNTS.json' && Array.isArray(v.accounts)) { v.accounts = v.accounts.concat(list); this.put(f.id, null, JSON.stringify(v)); }
    if (f.name === 'CESTIS_LMS_BACKUP.json' && (f.parents || []).indexOf(mainFolder) !== -1 && v.data && Array.isArray(v.data.userAccounts)) {
      v.data.userAccounts = v.data.userAccounts.concat(list); this.put(f.id, null, JSON.stringify(v));
    }
  });
};
FakeGoogle.prototype.ledger = function () { return this.accountsIn('CESTIS_ACCOUNTS.json')[0] || null; };
FakeGoogle.prototype.mainBackup = function (mainFolder) { return this.backups().find(b => (b.parents || []).indexOf(mainFolder) !== -1) || null; };
function byEmail(list, email) { return (list || []).filter(a => a && String(a.email || '').toLowerCase() === email); }

/* ------------------------------------------------------------- the site */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const file = path.normalize(path.join(root, p === '/' ? 'index.html' : p));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let browser, base, fake, MAIN_FOLDER;
const devices = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
async function device(name, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 768 }, timezoneId: TZ }, opts || {}));
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(base)) return r.continue();
    // fake.offline: the device has no connection at all (every request fails).
    if (/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com|accounts\.google\.com)\//.test(u)) return fake.offline ? r.abort('internetdisconnected') : fake.handle(r);
    return r.abort();
  });
  const d = { name, ctx, page: null, dialogs: [], errors: [] };
  devices.push(d);
  return d;
}
async function open(d) {
  if (!d.page) {
    d.page = await d.ctx.newPage();
    d.page.on('pageerror', e => d.errors.push(String(e.message).slice(0, 300)));
    d.console = [];
    d.page.on('console', m => { d.console.push(m.type() + ': ' + m.text().slice(0, 240)); if (d.console.length > 400) d.console.shift(); });
    d.page.on('dialog', async dl => {
      d.dialogs.push({ type: dl.type(), text: dl.message() });
      try { await (dl.type() === 'confirm' ? dl.accept() : dl.dismiss()); } catch (e) {}
    });
    await d.page.goto(base + '/index.html', { waitUntil: 'load' });
  } else {
    await d.page.reload({ waitUntil: 'load' });
  }
  await d.page.waitForFunction(() => window.CESTISStore && (!CESTISStore.isReady || CESTISStore.isReady()), null, { timeout: 15000 }).catch(() => {});
  await d.page.waitForTimeout(1400);
  return d.page;
}
async function waitFor(page, fn, arg, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    try { const v = await page.evaluate(fn, arg); if (v) return v; } catch (e) {}
    await sleep(200);
  }
  return null;
}
async function waitDrive(pred, ms) {
  const end = Date.now() + (ms || 30000);
  while (Date.now() < end) { try { const v = pred(); if (v) return v; } catch (e) {} await sleep(300); }
  return null;
}
async function shot(page, name, opts) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // <NN>-<what>-<before|after>-<desktop|phone>.png, as the Centre's review expects.
  const file = path.join(SHOTS, (TAG ? (/-(desktop|phone)$/.test(name) ? name.replace(/-(desktop|phone)$/, '-' + TAG + '-$1') : name + '-' + TAG) : name) + '.png');
  try {
    if (opts && opts.el) await page.locator(opts.el).first().screenshot({ path: file });
    else await page.screenshot({ path: file, clip: opts && opts.clip, fullPage: false });
    console.log('    [shot] ' + file);
  } catch (e) { console.log('    [shot failed] ' + name + ': ' + e.message); }
}
// The token a member of staff left on a device when they last synced it.
async function saveCentreToken(d, ttlSec) {
  const tok = fake.mint(CENTRE.email, DRIVE_SCOPE, ttlSec);
  const exp = new Date(Date.now() + ttlSec * 1000).toISOString();
  await d.page.evaluate(([t, e]) => {
    ['schoolDashboardGoogle', 'cestisGoogle'].forEach(p => { localStorage.setItem(p + 'AccessToken', t); localStorage.setItem(p + 'TokenExpiry', e); });
    try { CESTISStore.setItem('schoolDashboardGoogleAccessToken', t); CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', e); } catch (x) {}
  }, [tok, exp]);
  return tok;
}
async function expireCentreTokenOn(d) {
  await d.page.evaluate(() => {
    const past = new Date(Date.now() - 60000).toISOString();
    ['schoolDashboardGoogle', 'cestisGoogle'].forEach(p => { if (localStorage.getItem(p + 'AccessToken')) localStorage.setItem(p + 'TokenExpiry', past); });
    try { CESTISStore.setItem('schoolDashboardGoogleTokenExpiry', past); } catch (x) {}
  });
}
// The dashboard's alert() is its own overlay (window.alert is replaced), so
// what it said is read off the screen, and it is closed with its OK button.
async function overlayAlerts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.cestis-alert-overlay .cestis-alert-msg')).map(e => e.innerText));
}
async function closeAlerts(page) {
  await page.evaluate(() => document.querySelectorAll('.cestis-alert-overlay').forEach(o => o.remove()));
}
async function popups(page) { return page.evaluate(() => (window.__fakeGsi && window.__fakeGsi.opened) || 0); }
async function choose(page, who) { await page.evaluate(e => { window.__fakePopup = e ? { email: e } : undefined; }, who ? PEOPLE[who].email : null); }
async function screenState(page) {
  return page.evaluate(() => ({
    role: typeof currentRole !== 'undefined' ? currentRole : null,
    shell: document.getElementById('appShell').classList.contains('active'),
    pending: !!document.getElementById('pendingApprovalScreen'),
    pendingText: (document.getElementById('pendingApprovalScreen') || {}).innerText || '',
    reg: !!document.getElementById('regModalOverlay'),
    tfa: !!(document.getElementById('tfaVerifyModal') && document.getElementById('tfaVerifyModal').classList.contains('active')),
    student: (typeof currentStudent !== 'undefined' && currentStudent) ? { id: currentStudent.id, name: currentStudent.name, course: currentStudent.course } : null,
    instructor: (typeof currentInstructor !== 'undefined' && currentInstructor) ? { id: currentInstructor.id, name: currentInstructor.name, course: currentInstructor.course } : null,
    user: (typeof currentLoggedInUser !== 'undefined' && currentLoggedInUser) ? { id: currentLoggedInUser.id, status: currentLoggedInUser.status } : null,
    sync: (document.getElementById('loginSyncStatus') || {}).textContent || ''
  }));
}
async function landing(d) {
  // Back to the sign-in page as a fresh visit (the device keeps its storage).
  await open(d);
}
async function revealCard(page, card) {
  const shown = await page.evaluate(c => document.getElementById(c + 'Login').classList.contains('active'), card);
  if (!shown) await page.click('#' + card + 'Card .role-enter-btn', { timeout: 5000 });
  await page.waitForTimeout(250);
}
// The email button on a card, as the person presses it, answering the
// provider's pop-up as `who`. Resolves when something visible happened.
async function emailButton(d, card, who) {
  const page = d.page;
  await closeAlerts(page);
  await revealCard(page, card);
  await choose(page, who);
  const before = d.dialogs.length;
  await page.click('#' + card + 'Card .gmail-btn');
  await waitFor(page, () => !!document.getElementById('regModalOverlay') || !!document.getElementById('pendingApprovalScreen') ||
    document.getElementById('appShell').classList.contains('active') || !!document.querySelector('.cestis-alert-overlay') ||
    (document.getElementById('tfaVerifyModal') && document.getElementById('tfaVerifyModal').classList.contains('active')), null, 12000);
  await page.waitForTimeout(900);
  await choose(page, null);
  const st = await screenState(page);
  st.alerts = d.dialogs.slice(before).map(x => x.text).concat(await overlayAlerts(page));
  await closeAlerts(page);
  return st;
}
async function passwordSignIn(d, card, user, pass) {
  const page = d.page;
  await closeAlerts(page);
  await revealCard(page, card);
  await page.fill('#' + card + 'User', user);
  await page.fill('#' + card + 'Pass', pass);
  const before = d.dialogs.length;
  await page.click('#' + card + 'Card .role-enter-btn');
  await waitFor(page, () => !!document.getElementById('pendingApprovalScreen') || document.getElementById('appShell').classList.contains('active') ||
    !!document.querySelector('.cestis-alert-overlay'), null, 8000);
  await page.waitForTimeout(900);
  const st = await screenState(page);
  st.alerts = d.dialogs.slice(before).map(x => x.text).concat(await overlayAlerts(page));
  await closeAlerts(page);
  return st;
}
async function syncNow(d) {
  const page = d.page;
  await closeAlerts(page);
  await page.click('#loginSyncBtn');
  await waitFor(page, () => !document.getElementById('loginSyncBtn').disabled && !/Syncing|Connecting|Reading|Locating|Checking|Opening/.test(document.getElementById('loginSyncStatus').textContent), null, 30000);
  await page.waitForTimeout(500);
  return page.evaluate(() => document.getElementById('loginSyncStatus').textContent);
}
async function signOut(d) {
  await d.page.evaluate(() => { try { logout(true); } catch (e) {} });
  // The final save and the device's tidy-up run after the screen changes.
  await d.page.waitForTimeout(3000);
}
// A clean sign-out on a staff PC once its work has been uploaded: the trainee
// records go, the accounts and the School Fee roll stay (clearAllSessionData).
async function clearedSignOut(d) {
  await signOut(d);
  await d.page.evaluate(() => { try { if (Array.isArray(students) && students.length) clearAllSessionData(); } catch (e) {} });
  await d.page.waitForTimeout(500);
}
async function localAccounts(d, email) {
  return d.page.evaluate(e => ({
    accounts: userAccounts.filter(u => u && String(u.email || '').toLowerCase() === e).map(u => ({ id: u.id, status: u.status, role: u.role, studentDataId: u.studentDataId, updatedAt: u.updatedAt })),
    stored: JSON.parse(CESTISStore.getItem('voctrain_users') || '[]').filter(u => u && String(u.email || '').toLowerCase() === e).map(u => ({ id: u.id, status: u.status }))
  }), email);
}
// Fill and send the registration form that the email button opened.
async function register(d, programme, password, opts) {
  const page = d.page;
  await page.selectOption('#regProgramme', programme);
  await page.fill('#regPassword', password);
  await page.fill('#regPasswordConfirm', password);
  if (opts && opts.beforeSubmit) await opts.beforeSubmit(page);
  const before = d.dialogs.length;
  await page.click('#regModalOverlay .btn-primary');
  await waitFor(page, () => !!document.getElementById('pendingApprovalScreen') || !!document.querySelector('.cestis-alert-overlay'), null, 8000);
  const said = d.dialogs.slice(before).map(x => x.text).concat(await overlayAlerts(page));
  await closeAlerts(page);
  return said;
}
// Wait until the registration push (or its failure) has been reported.
async function pushSettled(page) {
  await waitFor(page, () => { const el = document.getElementById('pendingApprovalScreen'); return !el || !/Sending/i.test(el.innerText); }, null, 20000);
  await page.waitForTimeout(600);
}

/* ===================================================================== run */
(async function main() {
  fake = new FakeGoogle();
  const srv = await serve(ROOT);
  base = 'http://127.0.0.1:' + srv.address().port;
  browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  MAIN_FOLDER = (/FOLDER_ID:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) || [])[1];
  let lanServer = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-email-'));

  try {
    /* ------------------------------------------------------------ the Centre */
    section('SETUP — the administrator\'s PC publishes the Centre to the shared copy');
    const office = await device('office PC');
    let page = await open(office);
    await saveCentreToken(office, 6 * 3600);
    // The Centre's people, as the administrator created them earlier.
    await page.evaluate(async (a) => {
      const users = JSON.parse(CESTISStore.getItem('voctrain_users') || '[]');
      const now = new Date().toISOString();
      users.push({ id: 'USR-MTH', name: 'Marcia Thompson', role: 'admin', username: 'mthompson', email: 'marcia.thompson@cestis.edu.jm', password: await hashPassword(a.admin), status: 'active', updatedAt: now });
      users.push({ id: 'USR-AHE', name: 'Andre Henry', role: 'instructor', username: 'ahenry', email: 'andre.henry@cestis.edu.jm', password: await hashPassword('Andre-Weld-2026'), status: 'active', programme: 'Welding & Fabrication', updatedAt: now });
      users.push({ id: 'USR-KWI', name: 'Kemar Williams', role: 'student', username: 'kwilliams', email: 'Kemar.Williams@Gmail.com', password: await hashPassword(a.kemar), status: 'active', programme: 'Welding & Fabrication', registeredVia: 'admin-created', createdAt: '2026-09-07', updatedAt: now });
      users.push({ id: 'USR-RGR', name: 'Rushane Grant', role: 'student', username: 'rushane.grant', email: 'rushane.grant@gmail.com', password: await hashPassword('Rushane2026'), status: 'rejected', programme: 'Auto Mechanics', registeredVia: 'registration', createdAt: '2026-10-01', approvedAt: '2026-10-02', approvedBy: 'admin', updatedAt: now });
      users.push({ id: 'USR-KMO', name: 'Kadian Morgan', role: 'student', username: 'kadian.morgan', email: 'kadian.morgan@gmail.com', password: await hashPassword('Kadian2026'), status: 'disabled', programme: 'Cosmetology', registeredVia: 'registration', createdAt: '2026-09-01', approvedAt: '2026-09-02', approvedBy: 'admin', disabledAt: now, disabledBy: 'Marcia Thompson', updatedAt: now });
      CESTISStore.setItem('voctrain_users', JSON.stringify(users));
    }, PW);
    page = await open(office);
    let s = await syncNow(office);
    note('office PC Sync Now (empty shared copy): "' + s + '"');
    let st = await passwordSignIn(office, 'admin', 'mthompson', PW.admin);
    ok(st.shell && st.role === 'admin', 'Marcia Thompson signs in as administrator on the office PC');
    // The Centre's existing trainee has his record.
    await page.evaluate(() => {
      const k = userAccounts.find(u => u.id === 'USR-KWI');
      if (!findStudentRecordForAccount(k)) createStudentDataForAccount(k);
      // Andre Henry's instructor record, made long ago under a random id.
      if (!instructorData.some(i => i.name === 'Andre Henry')) instructorData.push({ id: 'INS-mf2k7q1a-x83jd0', name: 'Andre Henry', course: 'Welding & Fabrication', email: 'andre.henry@cestis.edu.jm', specialization: 'Welding & Fabrication Instruction', yearsExp: 9, phone: '876-555-0142' });
      saveUserAccounts(); saveState();
    });
    const pub = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const l = fake.ledger(); return b && b.accounts && byEmail(b.accounts, 'kemar.williams@gmail.com').length && l && l.accounts ? b : null; }, 45000);
    ok(!!pub, 'the office PC published the Centre (main backup and accounts ledger) to the shared copy');
    note('shared copy holds: ' + Object.values(fake.files).map(f => f.name).join(', '));
    // What an earlier version left in the shared copy: the email-less
    // "Disabled" stubs a cleared office PC made of three trainees who already
    // had accounts (the fee roll's for Kemar, the chat roster's for the others).
    fake.injectAccounts(MAIN_FOLDER, OLD_STUBS);
    // The office PC is cleared at sign-out, as every staff PC is once its work
    // is uploaded: its trainee records go; its accounts and fee roll stay.
    await clearedSignOut(office);
    ok(await page.evaluate(() => students.length === 0 && userAccounts.some(u => u.id === 'USR-KWI') && !!CESTISStore.getItem('cestiSchoolFeeStudents')),
      'the office PC signed out clean: no trainee records, its accounts and fee roll kept');

    /* ----------------------------------------------- scenario 1: the lab PC */
    section('1  Lab PC at the Centre: a new trainee registers through "Sign in with your email account"');
    const lab = await device('lab PC');
    page = await open(lab);
    await saveCentreToken(lab, 6 * 3600);
    page = await open(lab);
    s = await syncNow(lab);
    note('lab PC Sync Now by staff earlier: "' + s + '"');
    ok(await page.evaluate(() => userAccounts.some(u => u.id === 'USR-MTH')), 'the lab PC holds the Centre\'s accounts after staff synced it');
    page = await open(lab);
    await revealCard(page, 'student');
    await shot(page, '01-student-card-desktop', { el: '#studentCard' });
    let p0 = await popups(page);
    st = await emailButton(lab, 'student', 'tashana');
    ok(st.reg && !st.shell, 'a new address opens the registration form, not a sign-in');
    const form = await page.evaluate(() => ({ name: document.getElementById('regName').value, email: document.getElementById('regEmail').value,
      ro: document.getElementById('regEmail').readOnly, role: document.getElementById('regRole').value }));
    ok(form.name === 'Tashana Brown' && form.email === PEOPLE.tashana.email && form.ro, 'the form is prefilled with her name and her (read-only) address — got ' + JSON.stringify(form));
    ok((await popups(page)) - p0 === 1, 'exactly one pop-up: the provider\'s own sign-in');
    await page.selectOption('#regProgramme', 'Welding & Fabrication');
    await shot(page, '02-registration-form-desktop', { el: '#regModalOverlay .reg-modal' });
    p0 = await popups(page);
    const regAlerts = await register(lab, 'Welding & Fabrication', PW.tashana);
    ok(regAlerts.length === 0, 'the registration is accepted without an error — alerts: ' + JSON.stringify(regAlerts));
    st = await screenState(page);
    ok(st.pending && !st.shell, 'the pending screen is shown after registering');
    await pushSettled(page);
    ok((await popups(page)) - p0 === 0, 'no pop-up while the registration is sent (the Centre\'s token on this PC is used)');
    const reg = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const a = b && byEmail(b.accounts, PEOPLE.tashana.email); return a && a.length ? a : null; }, 20000);
    ok(reg && reg.length === 1 && reg[0].status === 'pending' && reg[0].programme === 'Welding & Fabrication' && reg[0].role === 'student',
      'the registration reached the shared copy: one pending trainee account for Welding & Fabrication');
    const tashanaId = reg && reg[0] && reg[0].id;
    st = await screenState(page);
    note('pending screen text: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 400)));
    await shot(page, '03-pending-screen-desktop', { el: '#pendingApprovalScreen .pending-card' });

    /* ------------------- scenario 1b: registering while the token is stale */
    section('1b Lab PC whose Centre sign-in has expired: another trainee registers by email');
    await expireCentreTokenOn(lab);
    page = await open(lab);
    st = await emailButton(lab, 'student', 'jhanelle');
    ok(st.reg, 'the registration form opens');
    // In the provider's window she would pick her own account, the one she is signed in with.
    await choose(page, 'jhanelle');
    p0 = await popups(page);
    await register(lab, 'Electrical Installation', PW.jhanelle);
    await pushSettled(page);
    await choose(page, null);
    const pushPopups = (await popups(page)) - p0;
    const heldTok = await page.evaluate(() => CESTISStore.getItem('schoolDashboardGoogleAccessToken'));
    const heldBy = (fake.tokens[heldTok] || {}).email || 'none';
    st = await screenState(page);
    const jReached = !!(fake.mainBackup(MAIN_FOLDER) && byEmail(fake.mainBackup(MAIN_FOLDER).accounts, PEOPLE.jhanelle.email).length);
    note('1b: pop-ups while sending: ' + pushPopups + '; the lab PC now holds a token for: ' + heldBy + '; reached the office: ' + jReached);
    note('1b pending screen says: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 400)));
    ok(pushPopups === 0, '1b: no pop-up after pressing Register (the trainee cannot sign in for the Centre)');
    ok(heldBy !== PEOPLE.jhanelle.email, '1b: the trainee\'s own sign-in is not kept on the lab PC as if it were the Centre\'s');
    ok(jReached || /not reached/i.test(st.pendingText), '1b: the pending screen says plainly when the registration has not reached the office');
    await shot(page, '10-registration-not-sent-desktop', { el: '#pendingApprovalScreen .pending-card' });
    // Staff come back to the lab PC: the Centre's token is valid again.
    page = await open(lab);
    await saveCentreToken(lab, 6 * 3600);

    /* ---- 1c: the trainee whose registration was not sent tries again ---- */
    section('1c The trainee whose registration could not be sent presses the email button again (the lab PC can send now)');
    page = await open(lab);
    p0 = await popups(page);
    st = await emailButton(lab, 'student', 'jhanelle');
    await waitFor(page, () => { const el = document.getElementById('pendingApprovalScreen'); return !el || el.getAttribute('data-state') !== 'checking'; }, null, 20000);
    st = await screenState(page);
    const jSent = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const a = b && byEmail(b.accounts, PEOPLE.jhanelle.email); return a && a.length === 1 && a[0].status === 'pending' ? a[0] : null; }, 20000);
    note('1c pending screen says: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 300)));
    ok(st.pending && !st.shell && !st.reg, '1c: "awaiting approval" — not a sign-in, not a second registration');
    ok(!!jSent, '1c: her registration, kept on the lab PC, now reaches the office (one pending account)');
    ok(/awaiting approval/i.test(st.pendingText) && !/not reached/i.test(st.pendingText), '1c: the screen says it is awaiting approval once it has been sent');
    ok((await popups(page)) - p0 === 1, '1c: no pop-up beyond the provider\'s own sign-in');
    if (st.pending) await shot(page, '13-registration-sent-later-desktop', { el: '#pendingApprovalScreen .pending-card' });

    /* ----------------------------------------- scenario 2: again, too early */
    section('2  The same trainee presses the email button again before approval');
    page = await open(lab);
    p0 = await popups(page);
    st = await emailButton(lab, 'student', 'tashana');
    ok(st.pending && !st.shell && !st.reg, 'the "awaiting approval" screen — not a sign-in, not the form again');
    ok(st.alerts.length === 0, 'and no error message — alerts: ' + JSON.stringify(st.alerts));
    ok((await popups(page)) - p0 === 1, 'and no pop-up beyond the provider\'s own sign-in');

    /* -------------------------------------- scenario 3: the administrator */
    section('3  The administrator\'s PC: Sync Now, sign in, Verify Users, Approve');
    page = await open(office);
    s = await syncNow(office);
    note('office PC Sync Now: "' + s + '"');

    section('3a The office PC was cleared at sign-out: no new duplicate accounts, and the old stubs fold away');
    const people = await page.evaluate(names => names.map(n => ({ n,
      accts: userAccounts.filter(u => u && u.name === n).map(u => u.id + ':' + u.status + ':' + (u.registeredVia || '') + ':' + (u.password ? 'pw' : 'nopw') + ':' + (u.email || '')),
      recs: students.filter(x => x && x.name === n).length })), STUB_PEOPLE);
    note('3a office PC after Sync Now: ' + JSON.stringify(people));
    people.forEach(x => ok(x.accts.length === 1, '3a: ' + x.n + ' has exactly one account on the office PC — got ' + JSON.stringify(x.accts)));
    people.forEach(x => ok(x.recs === 1, '3a: and exactly one trainee record — got ' + x.recs));
    const realKept = await page.evaluate(() => {
      const g = id => userAccounts.find(u => u.id === id) || {};
      return g('USR-KWI').status === 'active' && !!g('USR-KWI').password && /gmail/i.test(g('USR-KWI').email || '') &&
             g('USR-RGR').status === 'rejected' && !!g('USR-RGR').password && g('USR-KMO').status === 'disabled' && g('USR-KMO').disabledBy === 'Marcia Thompson';
    });
    ok(realKept, '3a: the real accounts are untouched (Kemar active with his password and email, Rushane rejected, Kadian disabled by Marcia Thompson)');
    ok(await page.evaluate(ids => ids.every(id => isUserDeleted(id) && !userAccounts.some(u => u.id === id)), OLD_STUBS.map(x => x.id)),
      '3a: the old stubs are folded away, each with a deletion record');
    const ledgerClean = await waitDrive(() => {
      const l = fake.ledger(); if (!l || !l.accounts) return null;
      const raw = JSON.parse(Object.values(fake.files).find(f => f.name === 'CESTIS_ACCOUNTS.json').content);
      const dels = raw.deletedUserIds || [];
      return STUB_PEOPLE.every(n => l.accounts.filter(a => a.name === n).length === 1) && OLD_STUBS.every(x => dels.indexOf(x.id) !== -1);
    }, 30000);
    ok(!!ledgerClean, '3a: the shared accounts list holds one account per person, and carries the fold to every other device');

    st = await passwordSignIn(office, 'admin', 'mthompson', PW.admin);
    ok(st.shell && st.role === 'admin', 'the administrator signs in');
    const notif = await page.evaluate(() => (notifications || []).filter(n => /awaiting approval/.test(n.text || '')).map(n => n.text));
    const queued = await page.evaluate(() => CESTISCore.accountAccess.reviewQueue(userAccounts).filter(u => u.status === 'pending').length);
    ok(queued >= 1 && notif.some(t => new RegExp('\\b' + queued + ' account\\(s\\) awaiting approval').test(t)), 'the "' + queued + ' account(s) awaiting approval — go to Verify Users" notification is there — got ' + JSON.stringify(notif));
    await page.evaluate(() => { toggleNotifications(); });
    await page.waitForTimeout(500);
    await shot(page, '04a-admin-notice-desktop');
    await page.evaluate(() => { toggleNotifications(); showPage('verify-users'); });
    await page.waitForTimeout(1200);
    const listed = await page.evaluate(() => (document.getElementById('verifyUsersTableBody') || {}).innerText || '');
    ok(/Tashana Brown/.test(listed) && /Welding & Fabrication/.test(listed), 'Verify Users lists Tashana Brown, Welding & Fabrication');
    await shot(page, '04b-verify-users-pending-desktop');
    ok(!STUB_PEOPLE.some(n => listed.indexOf(n) !== -1), '3a: Verify Users lists none of the trainees who already have accounts — got ' + JSON.stringify(listed.replace(/\s+/g, ' ').slice(0, 300)));
    await shot(page, '14-duplicate-stubs-desktop', { el: '#page-verify-users' });
    await page.click('button[onclick="approveUser(\'' + tashanaId + '\')"]');
    await page.waitForTimeout(1200);
    const approved = await page.evaluate(id => {
      const u = userAccounts.find(x => x.id === id);
      const rec = u && students.find(x => x.id === u.studentDataId);
      return { status: u && u.status, link: u && u.studentDataId, rec: rec ? { name: rec.name, course: rec.course } : null,
        records: students.filter(x => x.name === 'Tashana Brown').length };
    }, tashanaId);
    ok(approved.status === 'active' && approved.rec && approved.rec.course === 'Welding & Fabrication' && approved.records === 1,
      'Approve: active, a trainee record created and linked (Welding & Fabrication) — got ' + JSON.stringify(approved));
    await shot(page, '05-after-approve-desktop');
    const upB = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const a = b && byEmail(b.accounts, PEOPLE.tashana.email); return a && a.length === 1 && a[0].status === 'active' ? a[0] : null; }, 40000);
    ok(!!upB && !!upB.studentDataId, 'the approval reached the shared main backup (active, linked to her record)');
    const upL = await waitDrive(() => { const l = fake.ledger(); const a = l && byEmail(l.accounts, PEOPLE.tashana.email); return a && a.length === 1 && a[0].status === 'active' ? a[0] : null; }, 20000);
    ok(!!upL, 'the approval reached the shared accounts ledger too');
    const recUp = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); return b && (b.data.students || []).filter(x => x.name === 'Tashana Brown').length === 1; }, 20000);
    ok(!!recUp, 'her trainee record reached the shared copy');
    await signOut(office);

    /* ------------------------------ scenario 4: back on the lab PC (stale) */
    section('4  Back on the lab PC, which still holds her "pending" copy');
    page = await open(lab);
    let loc = await localAccounts(lab, PEOPLE.tashana.email);
    ok(loc.accounts.length === 1 && loc.accounts[0].status === 'pending', 'the lab PC still holds the stale pending copy before she signs in');
    p0 = await popups(page);
    st = await emailButton(lab, 'student', 'tashana');
    const landed = st.shell && st.role === 'student' && st.student && st.student.course === 'Welding & Fabrication';
    if (!landed) await shot(page, '07-stale-pending-desktop');
    ok(landed, '4a (Centre token valid): the email button lands her on her trainee dashboard with her programme — got ' + JSON.stringify({ shell: st.shell, role: st.role, pending: st.pending, student: st.student, alerts: st.alerts }));
    ok((await popups(page)) - p0 === 1, '4a: no surprise pop-up while the device checked for her approval');
    if (landed) {
      await page.waitForTimeout(1500);
      await shot(page, '06-trainee-first-dashboard-desktop');
      await shot(page, '07-stale-pending-desktop');
      const sameRec = await page.evaluate(() => currentStudent.id);
      ok(sameRec === approved.link, '4a: it is the record the administrator created (not a second one)');
    }
    await signOut(lab);
    // The password route on the same PC: reload, so the device is as she found it.
    page = await open(lab);
    await page.evaluate(id => { const u = userAccounts.find(x => x.id === id); if (u) { u.status = 'pending'; delete u.updatedAt; delete u.approvedAt; } persistUserAccounts(); }, tashanaId);
    page = await open(lab);
    st = await passwordSignIn(lab, 'student', PEOPLE.tashana.email, PW.tashana);
    ok(st.shell && st.role === 'student' && st.student && st.student.course === 'Welding & Fabrication',
      '4b (Centre token valid): the password route lands her on her dashboard too — got ' + JSON.stringify({ shell: st.shell, pending: st.pending, alerts: st.alerts }));
    await signOut(lab);
    // The Centre's token has expired (staff synced this PC more than an hour ago).
    page = await open(lab);
    await page.evaluate(id => { const u = userAccounts.find(x => x.id === id); if (u) { u.status = 'pending'; delete u.updatedAt; delete u.approvedAt; } persistUserAccounts(); }, tashanaId);
    await expireCentreTokenOn(lab);
    page = await open(lab);
    p0 = await popups(page);
    st = await emailButton(lab, 'student', 'tashana');
    ok((await popups(page)) - p0 === 1, '4c (Centre token expired): no surprise pop-up — the device does not ask anybody to sign in for it');
    ok(!st.shell && st.pending, '4c (Centre token expired): the device cannot check, so it answers from what it holds — awaiting approval');
    note('4c pending screen says: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 500)));
    await shot(page, '12-expired-token-pending-desktop', { el: '#pendingApprovalScreen .pending-card' });
    page = await open(lab);
    st = await passwordSignIn(lab, 'student', PEOPLE.tashana.email, PW.tashana);
    ok(!st.shell && st.pending, '4c: the password route says the same, from what the device holds');
    // Staff re-sync the PC (the Centre's sign-in) — then she is in.
    page = await open(lab);
    await choose(page, 'centre');
    s = await syncNow(lab);
    await choose(page, null);
    note('4c staff Sync Now with the Centre\'s sign-in: "' + s + '"');
    page = await open(lab);
    st = await emailButton(lab, 'student', 'tashana');
    ok(st.shell && st.role === 'student', '4c: after staff press Sync Now on the lab PC, the email button lets her in');
    await signOut(lab);

    /* ----------------- scenario 4e: the lab PC has no connection at all */
    section('4e The lab PC has no connection at all (Centre token still valid), holding a stale "pending" copy');
    page = await open(lab);
    await page.evaluate(id => { const u = userAccounts.find(x => x.id === id); if (u) { u.status = 'pending'; delete u.updatedAt; delete u.approvedAt; } persistUserAccounts(); }, tashanaId);
    fake.offline = true;
    page = await open(lab);
    const emailShownOffline = await page.evaluate(() => { const b = document.querySelector('#studentCard .gmail-btn'); return !!(b && getComputedStyle(b).display !== 'none'); });
    p0 = await popups(page);
    st = await passwordSignIn(lab, 'student', PEOPLE.tashana.email, PW.tashana);
    note('4e offline: email button ' + (emailShownOffline ? 'shown' : 'taken away') + '; password route says: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 300)) + ' alerts ' + JSON.stringify(st.alerts));
    ok(!st.shell && st.pending && /could not check/i.test(st.pendingText), '4e: offline, the device answers from what it holds — "awaiting approval", and says it could not check');
    ok(st.alerts.length === 0, '4e: no error message');
    ok((await popups(page)) - p0 === 0, '4e: no pop-up');
    ok(!emailShownOffline, '4e: with no connection, the email button (which cannot work) is not offered');
    fake.offline = false;

    /* ------------- scenario 4d: an account created since the lab PC synced */
    section('4d The office creates a trainee\'s account after the lab PC last synced');
    page = await open(office);
    st = await passwordSignIn(office, 'admin', 'mthompson', PW.admin);
    await page.evaluate(async (pw) => {
      userAccounts.push({ id: 'USR-SLE', name: 'Shamar Lewis', role: 'student', username: 'slewis', email: 'Shamar.Lewis@gmail.com', password: await hashPassword(pw),
        status: 'active', programme: 'Plumbing', registeredVia: 'admin-created', createdAt: localDateStr(), updatedAt: new Date().toISOString() });
      saveUserAccounts(); saveState();
    }, PW.shamar);
    ok(!!await waitDrive(() => { const l = fake.ledger(); return l && byEmail(l.accounts, PEOPLE.shamar.email).length === 1; }, 20000), 'the new account reached the shared copy');
    await signOut(office);
    page = await open(lab);
    ok(!(await localAccounts(lab, PEOPLE.shamar.email)).accounts.length, 'the lab PC does not hold it yet');
    p0 = await popups(page);
    st = await emailButton(lab, 'student', 'shamar');
    ok(st.shell && st.role === 'student' && !st.reg, '4d: the email button finds the account the office created and signs him in — not a second registration — got ' + JSON.stringify({ shell: st.shell, reg: st.reg, alerts: st.alerts }));
    ok((await popups(page)) - p0 === 1, '4d: no pop-up beyond the provider\'s own sign-in');
    if (st.reg) await page.evaluate(() => closeRegistrationModal());
    else await signOut(lab);
    ok((await localAccounts(lab, PEOPLE.shamar.email)).accounts.length <= 1, '4d: one account for him on the lab PC');

    /* ----------------------------------- scenario 6: existing trainee, casing */
    section('6  An administrator-created trainee uses the email button (address in other casing)');
    page = await open(lab);
    st = await emailButton(lab, 'student', 'kemar');
    ok(st.shell && st.role === 'student' && st.student && st.student.name === 'Kemar Williams', 'Kemar Williams (registered as Kemar.Williams@Gmail.com) signs straight in — no password asked');
    await signOut(lab);
    // Two-step verification turned on for him: the email button still asks for it.
    page = await open(lab);
    await page.evaluate(() => { const u = userAccounts.find(x => x.id === 'USR-KWI'); u.twoFactorEnabled = true; u.twoFactorSecret = 'JBSWY3DPEHPK3PXP'; u.twoFactorUpdatedAt = new Date().toISOString(); persistUserAccounts(); });
    page = await open(lab);
    st = await emailButton(lab, 'student', 'kemar');
    ok(!st.shell && st.tfa, 'with two-step verification on, the email button stops at the code — no sign-in without it');
    page = await open(lab);
    await page.evaluate(() => { const u = userAccounts.find(x => x.id === 'USR-KWI'); u.twoFactorEnabled = false; delete u.twoFactorSecret; u.twoFactorUpdatedAt = new Date().toISOString(); persistUserAccounts(); });

    /* ------------------------------------- scenario 7: rejected and disabled */
    section('7  Rejected and disabled accounts through the email button');
    page = await open(lab);
    st = await emailButton(lab, 'student', 'rushane');
    ok(!st.shell && st.alerts.some(t => /not approved/i.test(t)), 'a rejected registration: "not approved — contact an administrator", no sign-in — got ' + JSON.stringify(st.alerts));
    page = await open(lab);
    st = await emailButton(lab, 'student', 'kadian');
    ok(!st.shell && st.alerts.some(t => /disabled/i.test(t)), 'a disabled account: "has been disabled", no sign-in — got ' + JSON.stringify(st.alerts));
    // The administrator reverses the rejection on the office PC.
    page = await open(office);
    st = await passwordSignIn(office, 'admin', 'mthompson', PW.admin);
    await page.evaluate(() => { const u = userAccounts.find(x => x.id === 'USR-RGR'); u.status = 'active'; u.approvedAt = localDateStr(); u.approvedBy = 'admin'; touchAccount(u); saveUserAccounts(); saveState(); });
    ok(!!await waitDrive(() => { const l = fake.ledger(); const a = l && byEmail(l.accounts, PEOPLE.rushane.email); return a && a[0] && a[0].status === 'active'; }, 20000), 'the reversal reached the shared copy');
    await signOut(office);
    page = await open(lab);
    st = await emailButton(lab, 'student', 'rushane');
    ok(st.shell && st.role === 'student', 'the lab PC, holding the stale "rejected" copy, lets him in once the administrator has re-approved him — got ' + JSON.stringify({ shell: st.shell, alerts: st.alerts }));
    await signOut(lab);

    /* ------------------------------------------- scenario 8: an instructor */
    section('8  An instructor registers through the email button');
    page = await open(lab);
    st = await emailButton(lab, 'instructor', 'devon');
    ok(st.reg, 'the instructor registration form opens');
    await register(lab, 'Electrical Installation', PW.devon);
    await pushSettled(page);
    st = await screenState(page);
    ok(st.pending, 'pending screen for the instructor');
    const devReg = await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const a = b && byEmail(b.accounts, PEOPLE.devon.email); return a && a.length === 1 ? a[0] : null; }, 20000);
    ok(devReg && devReg.role === 'instructor' && devReg.status === 'pending', 'the instructor registration reached the shared copy');
    page = await open(office);
    await syncNow(office);
    st = await passwordSignIn(office, 'admin', 'mthompson', PW.admin);
    await page.evaluate(() => showPage('verify-users'));
    await page.waitForTimeout(800);
    if (devReg) await page.click('button[onclick="approveUser(\'' + devReg.id + '\')"]');
    await page.waitForTimeout(1000);
    ok(await page.evaluate(() => instructorData.filter(i => i.name === 'Devon Clarke').length === 1), 'approving creates one instructor record');
    const devOfficeId = await page.evaluate(() => (instructorData.find(i => i.name === 'Devon Clarke') || {}).id);
    ok(!!await waitDrive(() => { const b = fake.mainBackup(MAIN_FOLDER); const a = b && byEmail(b.accounts, PEOPLE.devon.email); return a && a[0] && a[0].status === 'active'; }, 40000), 'the approval reached the shared main backup');
    ok(!!await waitDrive(() => { const l = fake.ledger(); const a = l && byEmail(l.accounts, PEOPLE.devon.email); return a && a[0] && a[0].status === 'active'; }, 20000), 'and the shared accounts ledger');
    await signOut(office);
    // The lab PC is shared: signing out clears the staff records from it, so
    // every sign-in here starts without his record and must find the office's.
    const usedIds = [];
    for (let i = 0; i < 3; i++) {
      page = await open(lab);
      st = await emailButton(lab, 'instructor', 'devon');
      ok(st.shell && st.role === 'instructor' && st.instructor && st.instructor.name === 'Devon Clarke', 'sign-in ' + (i + 1) + ': the instructor lands on the instructor dashboard');
      usedIds.push(st.instructor && st.instructor.id);
      await page.waitForTimeout(4000);   // the sign-in's own sync and save
      await signOut(lab);
    }
    const devShared = ((fake.mainBackup(MAIN_FOLDER) || { data: {} }).data.instructorData || []).filter(i => i.name === 'Devon Clarke').map(i => i.id);
    note('8: the office made ' + devOfficeId + '; the three sign-ins on the lab PC used ' + JSON.stringify(usedIds) + '; the shared copy holds ' + JSON.stringify(devShared));
    ok(usedIds.every(id => id && id === devOfficeId), 'every sign-in on the lab PC uses the record the office\'s approval made — not one of its own');
    ok(devShared.length === 1 && devShared[0] === devOfficeId, 'the shared copy holds exactly that one instructor record for Devon Clarke after three sign-ins — got ' + JSON.stringify(devShared));
    // An instructor whose record was made before this change (a random id),
    // signing in twice by password on the same shared PC.
    const andreIds = [];
    for (let i = 0; i < 2; i++) {
      page = await open(lab);
      st = await passwordSignIn(lab, 'instructor', 'ahenry', 'Andre-Weld-2026');
      andreIds.push(st.instructor && st.instructor.id);
      await page.waitForTimeout(4000);
      await signOut(lab);
    }
    const andreShared = ((fake.mainBackup(MAIN_FOLDER) || { data: {} }).data.instructorData || []).filter(i => i.name === 'Andre Henry');
    note('8: Andre Henry\'s two password sign-ins on the lab PC used ' + JSON.stringify(andreIds) + '; the shared copy holds ' + JSON.stringify(andreShared.map(i => i.id)));
    ok(andreIds.every(id => id === 'INS-mf2k7q1a-x83jd0'), 'an instructor whose record predates this change gets that same record at every sign-in on the shared PC');
    ok(andreShared.length === 1 && andreShared[0].yearsExp === 9 && andreShared[0].phone === '876-555-0142', 'and the shared copy still holds one record for him, with its details intact');

    /* ------------------------------------------- scenario 9: tampered role */
    section('9  The hidden role field changed to "admin" before registering');
    page = await open(lab);
    st = await emailButton(lab, 'student', 'tamika');
    await register(lab, 'Cosmetology', PW.tamika, { beforeSubmit: async pg => { await pg.evaluate(() => { document.getElementById('regRole').value = 'admin'; }); } });
    await pushSettled(page);
    const tam = await page.evaluate(() => userAccounts.filter(u => u.email === 'tamika.reid@gmail.com').map(u => u.role));
    ok(tam.length === 1 && tam[0] === 'student', 'she is still registered as a trainee — got ' + JSON.stringify(tam));

    /* ------------------------------------- scenario 5: the trainee's phone */
    section('5  The trainee\'s own phone: no Centre token on it');
    const phone = await device('phone', PHONE);
    page = await open(phone);
    const btnOff = await page.evaluate(() => document.querySelector('#studentCard .role-enter-btn').disabled);
    note('on a brand-new phone the sign-in buttons are ' + (btnOff ? 'switched off until Sync Now' : 'available'));
    await choose(page, 'shanique');
    p0 = await popups(page);
    s = await syncNow(phone);
    await choose(page, null);
    const after = await page.evaluate(() => ({ unlocked: !document.querySelector('#studentCard .role-enter-btn').disabled, accounts: userAccounts.length,
      kept: !!CESTISStore.getItem('schoolDashboardGoogleAccessToken') }));
    note('phone Sync Now, signing in with her own email account (' + ((await popups(page)) - p0) + ' pop-up): "' + s + '" — accounts on the phone: ' + after.accounts + ', buttons ' + (after.unlocked ? 'unlocked' : 'still locked') + ', her token ' + (after.kept ? 'kept on the phone' : 'not kept'));
    ok(!/complete/i.test(s), 'Sync Now does not say "Sync complete" when nothing of the Centre\'s could be read — got "' + s + '"');
    ok(!after.kept, 'her own sign-in is not kept on the phone as if it were the Centre\'s');
    await shot(page, '08-phone-sync-honest-phone', { clip: { x: 0, y: 0, width: 390, height: 520 } });
    if (after.unlocked) {
      st = await emailButton(phone, 'student', 'shanique');
      if (st.reg) {
        await register(phone, 'Plumbing', PW.shanique);
        await pushSettled(page);
        st = await screenState(page);
        const reached = !!(fake.mainBackup(MAIN_FOLDER) && byEmail(fake.mainBackup(MAIN_FOLDER).accounts, PEOPLE.shanique.email).length);
        note('phone registration reached the office: ' + reached + '; pending screen says: ' + JSON.stringify(st.pendingText.replace(/\s+/g, ' ').slice(0, 500)));
        ok(!reached, 'as expected under the permission model, a registration from her own phone cannot reach the Centre\'s copy');
        ok(!/will review your account/i.test(st.pendingText) || /not reached|not been sent|could not be sent/i.test(st.pendingText),
          'the pending screen does not promise the office will review a registration that never left the phone');
        await shot(page, '09-phone-registration-phone');
      } else note('phone: the email button gave ' + JSON.stringify({ alerts: st.alerts, pending: st.pending, shell: st.shell }));
    } else {
      note('phone: sign-in and registration stay closed until the phone has synced with the Centre');
      ok(!after.unlocked, 'the phone cannot register or sign in before it has synced with the Centre');
      await page.evaluate(() => document.getElementById('studentCard').scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await shot(page, '09-phone-registration-phone');
    }
    const leaked = fake.log.filter(l => l.who === PEOPLE.shanique.email && /upload|POST/.test(l.method + l.path) && !/userinfo/.test(l.path));
    note('writes attempted with her personal token: ' + leaked.length + (leaked.length ? ' (' + leaked.slice(0, 4).map(l => l.method + ' ' + l.path.slice(0, 60)).join(' | ') + ')' : ''));

    /* ------------------------------------------ scenario 10: Centre network */
    section('10 The Centre-network build (no internet): the email button');
    {
      const SITE = path.join(tmp, 'site'), DATA = path.join(tmp, 'data');
      execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-offline.js'), '--out', SITE], { stdio: 'ignore' });
      const PORT = 9700 + Math.floor(Math.random() * 200);
      lanServer = spawn(process.execPath, ['cestis-offline-server.js'], { cwd: SITE, stdio: 'ignore',
        env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: path.join(tmp, 'cert') }) });
      const lanBase = 'http://127.0.0.1:' + PORT;
      for (let i = 0; i < 80; i++) { await sleep(100); try { if ((await fetch(lanBase + '/_cestis/health')).ok) break; } catch (e) {} }
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: TZ });
      await ctx.route('**/*', r => (r.request().url().startsWith(lanBase) ? r.continue() : r.abort()));
      const lp = await ctx.newPage();
      const dl = [];
      lp.on('dialog', async x => { dl.push(x.message()); try { await x.dismiss(); } catch (e) {} });
      await lp.goto(lanBase + '/index.html', { waitUntil: 'load' });
      await lp.waitForTimeout(2000);
      await lp.evaluate(() => { if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
      await lp.click('#studentCard .role-enter-btn');
      await lp.waitForTimeout(300);
      await lp.evaluate(() => document.getElementById('studentCard').scrollIntoView({ block: 'center' }));
      const visible = await lp.evaluate(() => { const b = document.querySelector('#studentCard .gmail-btn'); return !!(b && b.offsetParent); });
      const orShown = await lp.evaluate(() => { const d = document.querySelector('#studentCard .gmail-divider'); return !!(d && d.offsetParent); });
      if (visible) {
        await lp.click('#studentCard .gmail-btn', { timeout: 3000 }).catch(() => {});
        await lp.waitForTimeout(800);
        (await overlayAlerts(lp)).forEach(t => dl.push(t));
      }
      await shot(lp, '11-centre-network-email-button-desktop');
      await closeAlerts(lp);
      note('Centre network: email button ' + (visible ? 'visible' : 'hidden') + (visible ? '; pressing it says: ' + JSON.stringify(dl) : ''));
      ok(!visible && !orShown, 'the email button (and its "or") is not offered where the sign-in it needs cannot load');
      ok(await lp.evaluate(() => { const b = document.querySelector('#studentCard .role-enter-btn'); return !!(b && b.offsetParent) && !!document.getElementById('studentPass'); }), 'the password sign-in is still there');
      ok(dl.length === 0 || dl.every(t => !/\b(google|gmail|internet|server|network|cloud)\b/i.test(t)), 'its message names no place or provider');
      await ctx.close();
    }

    /* ---------------------------------------------- scenario 11: no doubles */
    section('11 No duplicate accounts, no lost records');
    page = await open(office);
    await syncNow(office);
    page = await open(lab);
    await page.evaluate(() => { loginSyncCompleted = false; });
    await choose(page, 'centre');
    await syncNow(lab);
    await choose(page, null);
    const shared = { backup: byEmail((fake.mainBackup(MAIN_FOLDER) || {}).accounts, PEOPLE.tashana.email), ledger: byEmail((fake.ledger() || {}).accounts, PEOPLE.tashana.email) };
    const recs = (fake.mainBackup(MAIN_FOLDER) || { data: {} }).data.students || [];
    ok(shared.backup.length === 1 && shared.backup[0].status === 'active', 'the shared backup: exactly one Tashana Brown account, active');
    ok(shared.ledger.length === 1 && shared.ledger[0].status === 'active', 'the shared ledger: exactly one, active');
    ok(recs.filter(x => x.name === 'Tashana Brown').length === 1, 'the shared copy: exactly one trainee record for her');
    for (const d of [office, lab]) {
      const l = await localAccounts(d, PEOPLE.tashana.email);
      const r = await d.page.evaluate(() => students.filter(x => x.name === 'Tashana Brown').length);
      ok(l.accounts.length === 1 && l.accounts[0].status === 'active' && l.stored.length === 1 && r === 1, d.name + ': one active account, one trainee record — got ' + JSON.stringify(l) + ' records ' + r);
    }
    // Nobody else's record was lost on the way.
    const everyone = (fake.mainBackup(MAIN_FOLDER) || {}).accounts || [];
    ['USR-MTH', 'USR-AHE', 'USR-KWI', 'USR-RGR', 'USR-KMO'].forEach(id => ok(everyone.some(a => a.id === id), 'the shared copy still holds ' + id));
    const pageErrors = devices.reduce((n, d) => n.concat(d.errors.map(e => d.name + ': ' + e)), []);
    ok(pageErrors.length === 0, 'no page errors on any device — got ' + JSON.stringify(pageErrors.slice(0, 5)));
    if (fake.errors.length) note('Drive calls the emulation did not model: ' + Array.from(new Set(fake.errors)).slice(0, 8).join(' | '));
  } catch (e) {
    failed++; failures.push('crashed: ' + (e && e.stack || e));
    console.log('CRASH', e && e.stack || e);
  } finally {
    if (lanServer) try { lanServer.kill(); } catch (e) {}
    await browser.close();
    srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (notes.length) { console.log('\nNotes:'); notes.forEach(n => console.log('  · ' + n)); }
  if (failed) { console.log('\nFailures:'); failures.forEach(f => console.log('  ✗ ' + f)); }
  process.exit(failed ? 1 : 0);
})();
