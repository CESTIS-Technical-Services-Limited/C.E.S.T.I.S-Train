/* An in-memory stand-in for the shared copy the online build syncs through
   (the Google Drive v3 calls the pages make: list by query, read,
   create/update by multipart or media upload, metadata, delete), for the
   browser suites that need two "PCs" to share one copy without the browser
   ever leaving the machine. Copied from the emulation inside
   tests/browser/upgrade-no-data-loss.js (that suite keeps its own copy).

     const { FakeDrive, driveTokenSeed } = require('./fake-drive');
     const drive = new FakeDrive();
     await ctx.route(/^https:\/\/(www\.googleapis\.com|oauth2\.googleapis\.com)\//, r => drive.handle(r));
     // and put driveTokenSeed() into the device's storage so it syncs

   Also (the records-safe suite):
     drive.quota = { limit, usage, usageInDriveTrash }   what about.get's storageQuota says
     drive.full = true          the account is out of room: every upload, new
                                file and copy is refused with 403
                                storageQuotaExceeded (reads, listings and a
                                move to the trash still work, as on the real one)
     drive.copyBroken = true    files.copy answers 500 (a copy that cannot be made)
     drive.copies               how many server-side copies were made

   A file that is not text (a PDF, a photo) is kept byte for byte (f._bytes)
   and read back as it was sent, with its own type; a file's content
   replaced is kept as a revision (f.revisions: { version, size, md5,
   modifiedTime, keepForever } — keepForever: that content was sent with
   keepRevisionForever=true, as Drive marks the new head revision). */
'use strict';
function parse(v) { try { return JSON.parse(v); } catch (e) { return undefined; } }
const isTextType = t => !t || /json|^text\/|charset/i.test(String(t));
const bytesOf = f => (f._bytes ? f._bytes : Buffer.from(f.content || '', 'utf8'));
function FakeDrive() { this.files = {}; this.seq = 0; this.calls = 0; this.errors = []; this.quota = null; this.full = false; this.copyBroken = false; this.copies = 0; this.refused = 0; }
// The answer the real one gives when the account has no room left.
const QUOTA_REFUSAL = { error: { code: 403, message: "The user's Drive storage quota has been exceeded.",
  errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded', message: "The user's Drive storage quota has been exceeded." }] } };
// The query's clauses, split on "and" — but not inside quotes, nor inside
// an appProperties { key=… and value=… } clause.
function clausesOf(q) {
  const out = []; let cur = '', depth = 0, quote = false;
  const src = String(q || '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { cur += c; if (c === '\\') { cur += src[++i] || ''; } else if (c === "'") quote = false; continue; }
    if (c === "'") { quote = true; cur += c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
    const m = !depth && /\s/.test(c) ? /^\s+and\s+/i.exec(src.slice(i)) : null;
    if (m) { out.push(cur.trim()); cur = ''; i += m[0].length - 1; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
FakeDrive.prototype.list = function (q) {
  const clauses = clausesOf(q);
  const unq = s => s.replace(/^'|'$/g, '').replace(/\\'/g, "'");
  const Q = "('(?:[^'\\\\]|\\\\.)*')";
  return Object.values(this.files).filter(f => clauses.every(c => {
    let m;
    if ((m = new RegExp('^name\\s*=\\s*' + Q + '$').exec(c))) return f.name === unq(m[1]);
    if ((m = new RegExp('^name\\s+contains\\s+' + Q + '$').exec(c))) return f.name.indexOf(unq(m[1])) !== -1;
    if ((m = new RegExp('^' + Q + '\\s+in\\s+parents$').exec(c))) return f.parents.indexOf(unq(m[1])) !== -1;
    if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) return String(!!f.trashed) === m[1];
    if ((m = new RegExp('^mimeType\\s*=\\s*' + Q + '$').exec(c))) return f.mimeType === unq(m[1]);
    if ((m = new RegExp('^mimeType\\s*!=\\s*' + Q + '$').exec(c))) return f.mimeType !== unq(m[1]);
    if ((m = new RegExp('^modifiedTime\\s*(>=|>|<=|<)\\s*' + Q + '$').exec(c))) {
      const a = Date.parse(f.modifiedTime), b = Date.parse(unq(m[2]));
      return m[1] === '>' ? a > b : m[1] === '>=' ? a >= b : m[1] === '<' ? a < b : a <= b;
    }
    if ((m = new RegExp('^appProperties\\s+has\\s*\\{\\s*key\\s*=\\s*' + Q + '\\s+and\\s+value\\s*=\\s*' + Q + '\\s*\\}$').exec(c))) {
      const ap = f.appProperties || {};
      return Object.prototype.hasOwnProperty.call(ap, unq(m[1])) && String(ap[unq(m[1])]) === unq(m[2]);
    }
    if ((m = new RegExp('^fullText\\s+contains\\s+' + Q + '$').exec(c))) return (f.name + ' ' + (f.description || '') + ' ' + (f.content || '')).indexOf(unq(m[1])) !== -1;
    return true;   // a clause this emulation does not model narrows nothing
  }));
};
FakeDrive.prototype.meta = function (f) {
  return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime, createdTime: f.createdTime,
    description: f.description || '', appProperties: Object.assign({}, f.appProperties || {}), trashed: !!f.trashed,
    version: String(f.version), size: String(bytesOf(f).length), webViewLink: 'https://drive.example/' + f.id,
    webContentLink: 'https://drive.example/dl/' + f.id, md5Checksum: require('crypto').createHash('md5').update(bytesOf(f)).digest('hex') };
};
FakeDrive.prototype.put = function (id, meta, content, opts) {
  // (clock: an optional stand-in for the time, for a suite that runs its
  // pages on a clock of its own.)
  const now = new Date((this.clock ? this.clock() : Date.now()) + (this.seq++)).toISOString();
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
    if (meta.description != null) f.description = String(meta.description);
    // appProperties merge key by key, as Drive does (null removes one).
    if (meta.appProperties && typeof meta.appProperties === 'object') {
      f.appProperties = Object.assign({}, f.appProperties || {});
      Object.keys(meta.appProperties).forEach(k => { if (meta.appProperties[k] === null) delete f.appProperties[k]; else f.appProperties[k] = String(meta.appProperties[k]); });
    }
  }
  if (content != null) {
    // The content it had is kept as a revision (as Drive keeps one).
    if (f.version > 0 && (f.content || f._bytes)) {
      const old = bytesOf(f);
      (f.revisions = f.revisions || []).push({ version: f.version, size: old.length, md5: require('crypto').createHash('md5').update(old).digest('hex'),
        modifiedTime: f.modifiedTime, keepForever: !!f.headKeep });
    }
    if (Buffer.isBuffer(content)) { f._bytes = content; f.content = content.toString('latin1'); }
    else { delete f._bytes; f.content = content; }
    // keepRevisionForever marks the content just sent (the new head).
    f.headKeep = !!(opts && opts.keepForever);
  }
  f.version++; f.modifiedTime = now;
  return f;
};
function parseMultipart(buf, ctype) {
  const m = /boundary=("?)([^";]+)\1/i.exec(ctype || '');
  if (!m) return null;
  const s = buf.toString('latin1'), parts = s.split('--' + m[2]).slice(1).filter(p => !/^--/.test(p));
  const out = { meta: null, content: null };
  // A multipart/related upload names no parts: the first is the metadata,
  // the second the content (as the real upload reads them).
  const headOf = p => p.slice(0, Math.max(0, p.indexOf('\r\n\r\n')));
  if (parts.length >= 2 && !parts.some(p => /name="/i.test(headOf(p)))) {
    const bodyOf = p => { const i = p.indexOf('\r\n\r\n'); return i === -1 ? '' : Buffer.from(p.slice(i + 4).replace(/\r\n$/, ''), 'latin1').toString('utf8'); };
    const rawOf = p => { const i = p.indexOf('\r\n\r\n'); return i === -1 ? Buffer.alloc(0) : Buffer.from(p.slice(i + 4).replace(/\r\n$/, ''), 'latin1'); };
    const typeOf = p => (/content-type:\s*([^\r\n;]+)/i.exec(headOf(p)) || [])[1] || '';
    try { out.meta = JSON.parse(bodyOf(parts[0])); } catch (e) { out.meta = null; }
    out.content = isTextType(typeOf(parts[1])) ? bodyOf(parts[1]) : rawOf(parts[1]);
    return out;
  }
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
    if (/\/drive\/v3\/about$/.test(p)) {
      const q = this.quota || { limit: 16106127360, usage: 1024 };
      const sq = {};
      Object.keys(q).forEach(k => { sq[k] = String(q[k]); });
      return json({ user: { displayName: 'Centre Drive', emailAddress: 'centre@example.org' }, storageQuota: sq });
    }
    let m;
    const body = req.postDataBuffer() || Buffer.alloc(0);
    const ctype = (await req.allHeaders())['content-type'] || '';
    // Out of room: whatever would take more space is refused (OPS-2).
    const growing = (/^\/upload\//.test(p) && (method === 'POST' || method === 'PATCH' || method === 'PUT')) ||
      (/^\/drive\/v3\/files\/?$/.test(p) && method === 'POST') || (/\/copy$/.test(p) && method === 'POST');
    if (this.full && growing) {
      this.refused++;
      const fm = /\/files\/([^/?]+)/.exec(p), tf = fm && this.files[fm[1]];
      (this.refusedLog = this.refusedLog || []).push({ at: Date.now(), what: method + ' ' + (tf ? tf.name : p) });
      return json(QUOTA_REFUSAL, 403);
    }
    // files.copy: a copy made where the file is kept (no upload).
    if ((m = /^\/drive\/v3\/files\/([^/]+)\/copy$/.exec(p)) && method === 'POST') {
      const src = this.files[m[1]];
      if (!src) return json({ error: { code: 404, message: 'File not found: ' + m[1] } }, 404);
      if (this.copyBroken) return json({ error: { code: 500, message: 'Internal Error' } }, 500);
      let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
      const f = this.put(null, Object.assign({ name: src.name, mimeType: src.mimeType, parents: src.parents }, meta), src._bytes ? Buffer.from(src._bytes) : src.content);
      this.copies++;
      return json(this.meta(f));
    }
    if (/^\/upload\/drive\/v3\/files\/?$/.test(p) && method === 'POST') {
      const type = url.searchParams.get('uploadType');
      if (type === 'resumable') {
        let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {}
        const f = this.put(null, meta, '');
        return route.fulfill({ status: 200, headers: Object.assign({ Location: 'https://www.googleapis.com/upload/drive/v3/files/' + f.id + '?uploadType=resumable-put' }, cors), body: '' });
      }
      const mp = parseMultipart(body, ctype) || { meta: null, content: isTextType(ctype) ? body.toString('utf8') : Buffer.from(body) };
      return json(this.meta(this.put(null, mp.meta || {}, mp.content == null ? '' : mp.content, { keepForever: url.searchParams.get('keepRevisionForever') === 'true' })));
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && (method === 'PATCH' || method === 'PUT')) {
      if (!this.files[m[1]]) return json({ error: { code: 404, message: 'File not found' } }, 404);
      const type = url.searchParams.get('uploadType');
      const keep = { keepForever: url.searchParams.get('keepRevisionForever') === 'true' };
      if (type === 'multipart') { const mp = parseMultipart(body, ctype) || {}; return json(this.meta(this.put(m[1], mp.meta, mp.content, keep))); }
      return json(this.meta(this.put(m[1], null, isTextType(ctype) ? body.toString('utf8') : Buffer.from(body), keep)));
    }
    if (/^\/drive\/v3\/files\/?$/.test(p)) {
      if (method === 'GET') {
        let files = this.list(url.searchParams.get('q')).map(f => this.meta(f));
        const ob = url.searchParams.get('orderBy') || '';
        if (/modifiedTime desc/.test(ob)) files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
        else if (/modifiedTime/.test(ob)) files.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
        return json({ files });
      }
      if (method === 'POST') { let meta = {}; try { meta = JSON.parse(body.toString('utf8') || '{}'); } catch (e) {} return json(this.meta(this.put(null, meta, ''))); }
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/.exec(p))) {
      const f = this.files[m[1]];
      if (m[2]) return json({ id: 'perm1', role: 'reader', type: 'anyone' });
      if (!f) return json({ error: { code: 404, message: 'File not found: ' + m[1] } }, 404);
      if (method === 'GET') {
        if (url.searchParams.get('alt') === 'media') {
          if (f._bytes) return route.fulfill({ status: 200, contentType: f.mimeType || 'application/octet-stream', headers: Object.assign({ ETag: '"' + f.version + '"' }, cors), body: f._bytes });
          return route.fulfill({ status: 200, contentType: 'application/json', headers: Object.assign({ ETag: '"' + f.version + '"' }, cors), body: f.content || '' });
        }
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
    if (f._bytes) return;
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
module.exports = { FakeDrive, driveTokenSeed };
