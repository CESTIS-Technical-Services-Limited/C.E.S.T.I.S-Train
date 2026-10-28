/* A simulated Apps Script runtime for the trainee gate (not a test itself:
   tests/gate-appsscript-vm.test.js uses it, and Stage 4's fake gate can run
   the real trainee-gate/PASTE-GATE.gs over the same in-memory Drive).

   makeWorld(opts) gives a Node `vm` context holding in-memory fakes of the
   services the gate's script calls — DriveApp (a folder tree with names,
   descriptions, created/updated times, the bin, and the search queries the
   gate uses), CacheService (expiry by the fake clock, the 100 KB value
   limit), PropertiesService (the 9 KB value / 500 KB total limits),
   UrlFetchApp (tokeninfo answers scripted by the test), MailApp, Utilities
   (Java's SIGNED bytes, both ways: a byte outside -128…127 is refused, as
   the real runtime refuses to convert it), LockService, ContentService and
   HtmlService — and a clock the test moves (Date inside the context reads
   it; Utilities.sleep advances it). Everything that could differ from run
   to run (Utilities.getUuid, Math.random) is seeded, so the same requests
   give the same answers byte for byte — which is how the test shows the
   allowlist paste and the full paste behave alike.

   Modelled on purpose, because the live service does it too:
     - a search by text ("title contains", "fullText contains") may lag
       behind a write by opts.searchLagMs (default 0); exact names and
       folder listings never lag;
     - "title contains" matches the START of a name only (all Drive
       promises), so the gate must check names itself;
     - writes beyond opts.maxWritesPerSecond, or the next drive.failWrites
       writes, throw the real "driveWriteVolume" error. */
'use strict';
const vm = require('vm');
const nodeCrypto = require('crypto');

function seeded(seed) {
  let n = 0;
  const next = () => nodeCrypto.createHash('sha256').update(String(seed) + '|' + (n++)).digest();
  return {
    uuid() { const h = next().toString('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); },
    random() { return next().readUInt32BE(0) / 4294967296; }
  };
}

function toBytes(v, what) {
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (!Array.isArray(v)) throw new Error('Cannot convert ' + typeof v + ' to Byte[] (' + what + ')');
  for (let i = 0; i < v.length; i++) {
    const b = v[i];
    if (typeof b !== 'number' || !Number.isInteger(b) || b < -128 || b > 127) throw new Error('Cannot convert ' + b + ' to byte (' + what + ')');
  }
  return Buffer.from(v.map(b => b & 255));
}
const signedOf = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));

function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => { if (i >= list.length) throw new Error('No more items'); return list[i++]; } }; }

function makeDrive(clock, opts) {
  opts = opts || {};
  const items = new Map();
  let seq = 0;
  const state = { failWrites: 0, writes: [], onCreateFile: null, maxWritesPerSecond: opts.maxWritesPerSecond || Infinity, searchLagMs: opts.searchLagMs || 0 };
  function newId(kind) { return (kind === 'folder' ? 'fld' : 'fil') + '_' + String(++seq).padStart(6, '0'); }
  function write(what) {
    if (state.failWrites > 0) { state.failWrites--; throw new Error('Service invoked too many times in a short time: driveWriteVolume rateMax. Try Utilities.sleep(1000) between calls.'); }
    const t = clock.now;
    state.writes = state.writes.filter(x => t - x < 1000);
    if (state.writes.length >= state.maxWritesPerSecond) throw new Error('Service invoked too many times in a short time: driveWriteVolume rateMax. Try Utilities.sleep(1000) between calls.');
    state.writes.push(t);
  }
  function add(kind, name, parent, extra) {
    const id = (extra && extra.id) || newId(kind);
    if (items.has(id)) throw new Error('fake drive: id taken ' + id);
    const it = Object.assign({ id, kind, name: String(name), parent: parent || null, description: '', created: clock.now, updated: clock.now,
      trashed: false, content: Buffer.alloc(0), mime: kind === 'folder' ? 'application/vnd.google-apps.folder' : 'text/plain', appProperties: {} }, extra || {});
    it.id = id;
    items.set(id, it);
    return it;
  }
  const root = add('folder', 'My Drive', null, { id: 'root' });
  function get(id) { const it = items.get(String(id)); if (!it) throw new Error('No item with the given ID could be found, or you do not have permission to access it.'); return it; }
  function touch(it) { it.updated = clock.now; }
  function children(parentId, kind) { return [...items.values()].filter(x => x.parent === parentId && (!kind || x.kind === kind)); }

  /* ---- the query language subset the gate uses (Drive v2 syntax) ---- */
  function parseQuery(q) {
    const clauses = [];
    let cur = '', inq = false;
    for (let i = 0; i < q.length; i++) {
      const ch = q[i];
      if (ch === '\\' && inq) { cur += ch + q[++i]; continue; }
      if (ch === "'") inq = !inq;
      if (!inq && q.slice(i, i + 5).toLowerCase() === ' and ') { clauses.push(cur.trim()); cur = ''; i += 4; continue; }
      cur += ch;
    }
    if (cur.trim()) clauses.push(cur.trim());
    const un = s => s.replace(/\\(.)/g, '$1');
    return clauses.map(c => {
      let m;
      if ((m = /^title\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) { const v = un(m[1]); return { text: false, test: x => x.name === v }; }
      if ((m = /^title\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) { const v = un(m[1]); return { text: true, test: x => x.name.indexOf(v) === 0 }; }
      if ((m = /^fullText\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) {
        const v = un(m[1]).toLowerCase();
        return { text: true, test: x => (x.name + ' ' + x.description + ' ' + (x.kind === 'file' && x.content.length < 1e6 ? x.content.toString('utf8') : '')).toLowerCase().indexOf(v) !== -1 };
      }
      if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) { const v = m[1] === 'true'; return { text: false, test: x => x.trashed === v }; }
      if ((m = /^modifiedDate\s*>\s*'([^']+)'$/.exec(c))) {
        const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(m[1]) ? m[1] : m[1] + 'Z');
        if (!isFinite(t)) throw new Error('Invalid argument: q');
        return { text: false, test: x => x.updated > t };
      }
      if ((m = /^'([^']+)'\s+in\s+parents$/.exec(c))) { const v = m[1]; return { text: false, test: x => x.parent === v }; }
      if ((m = /^mimeType\s*=\s*'([^']+)'$/.exec(c))) { const v = m[1]; return { text: false, test: x => x.mime === v }; }
      throw new Error('Invalid argument: q (' + c + ')');
    });
  }
  function search(q, kind, parentId) {
    const cl = parseQuery(q);
    const lagged = cl.some(c => c.text) && state.searchLagMs > 0;
    return [...items.values()].filter(x => x.kind === kind && x.id !== 'root' && (!parentId || x.parent === parentId) &&
      (!lagged || clock.now - x.updated >= state.searchLagMs) && cl.every(c => c.test(x)));
  }

  /* ---- what the script sees ---- */
  function blobOf(bytes, mime, name) {
    let buf = Buffer.from(bytes), type = mime || 'application/octet-stream', nm = name || null;
    return {
      getDataAsString: () => buf.toString('utf8'), getBytes: () => signedOf(buf), getContentType: () => type,
      getName: () => nm, setName(n) { nm = String(n); return this; }, setContentType(t) { type = String(t); return this; },
      _buf: () => buf
    };
  }
  function folderApi(it) {
    const api = {
      getId: () => it.id, getName: () => it.name, setName: n => { write('name'); it.name = String(n); touch(it); return api; },
      getDescription: () => it.description || null, setDescription: d => { write('description'); it.description = String(d); touch(it); return api; },
      getDateCreated: () => new Date(it.created), getLastUpdated: () => new Date(it.updated),
      isTrashed: () => it.trashed, setTrashed: t => { write('trash'); it.trashed = !!t; touch(it); return api; },
      getParents: () => iter(it.parent ? [folderApi(get(it.parent))] : []),
      getFiles: () => iter(children(it.id, 'file').filter(x => !x.trashed).map(fileApi)),
      getFolders: () => iter(children(it.id, 'folder').filter(x => !x.trashed).map(folderApi)),
      getFilesByName: n => iter(children(it.id, 'file').filter(x => x.name === n && !x.trashed).map(fileApi)),
      getFoldersByName: n => iter(children(it.id, 'folder').filter(x => x.name === n && !x.trashed).map(folderApi)),
      createFolder: n => { write('create'); return folderApi(add('folder', n, it.id)); },
      createFile: (a, content, mime) => {
        let name, buf, type;
        if (a && typeof a === 'object' && typeof a.getBytes === 'function') { name = a.getName() || 'Untitled'; buf = a._buf ? a._buf() : toBytes(a.getBytes(), 'blob'); type = a.getContentType(); }
        else { name = String(a); buf = Buffer.from(String(content == null ? '' : content), 'utf8'); type = mime || 'text/plain'; }
        if (typeof state.onCreateFile === 'function') { const hook = state.onCreateFile; state.onCreateFile = null; hook(name, it.id); }
        write('create');
        return fileApi(add('file', name, it.id, { content: buf, mime: type }));
      },
      searchFiles: q => iter(search(q, 'file', it.id).map(fileApi)),
      searchFolders: q => iter(search(q, 'folder', it.id).map(folderApi))
    };
    return api;
  }
  function fileApi(it) {
    const api = {
      getId: () => it.id, getName: () => it.name, setName: n => { write('name'); it.name = String(n); touch(it); return api; },
      getSize: () => (it.size != null ? it.size : it.content.length), getMimeType: () => it.mime,
      getBlob: () => blobOf(it.content, it.mime, it.name),
      setContent: t => { write('content'); it.content = Buffer.from(String(t), 'utf8'); delete it.size; touch(it); return api; },
      getDescription: () => it.description || null, setDescription: d => { write('description'); it.description = String(d); touch(it); return api; },
      getDateCreated: () => new Date(it.created), getLastUpdated: () => new Date(it.updated),
      isTrashed: () => it.trashed, setTrashed: t => { write('trash'); it.trashed = !!t; touch(it); return api; },
      getParents: () => iter(it.parent ? [folderApi(get(it.parent))] : [])
    };
    return api;
  }
  const DriveApp = {
    getRootFolder: () => folderApi(root),
    getFolderById: id => { const it = get(id); if (it.kind !== 'folder') throw new Error('Not a folder: ' + id); return folderApi(it); },
    getFileById: id => { const it = get(id); if (it.kind !== 'file') throw new Error('Not a file: ' + id); return fileApi(it); },
    getFilesByName: n => iter([...items.values()].filter(x => x.kind === 'file' && x.name === n && !x.trashed).map(fileApi)),
    getFoldersByName: n => iter([...items.values()].filter(x => x.kind === 'folder' && x.id !== 'root' && x.name === n && !x.trashed).map(folderApi)),
    searchFiles: q => iter(search(q, 'file', null).map(fileApi)),
    searchFolders: q => iter(search(q, 'folder', null).map(folderApi)),
    createFolder: n => { write('create'); return folderApi(add('folder', n, 'root')); },
    createFile: (n, c, m) => folderApi(root).createFile(n, c, m),
    getStorageUsed: () => [...items.values()].reduce((s, x) => s + (x.kind === 'file' ? (x.size != null ? x.size : x.content.length) : 0), 0)
  };

  /* ---- what the test uses (no write limits: this is the "staff PC") ---- */
  const T = {
    root,
    items,
    state,
    get: id => items.get(String(id)) || null,
    mkdir(parentId, name, extra) { return add('folder', name, parentId || 'root', extra); },
    put(parentId, name, content, extra) {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
      return add('file', name, parentId || 'root', Object.assign({ content: buf, mime: 'application/json' }, extra || {}));
    },
    replace(id, content) { const it = get(id); it.content = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8'); delete it.size; touch(it); return it; },
    read(id) { return get(id).content.toString('utf8'); },
    json(id) { return JSON.parse(T.read(id)); },
    children: (parentId, kind) => children(parentId, kind),
    child(parentId, name, kind) { return children(parentId, kind).filter(x => x.name === name && !x.trashed)[0] || null; },
    find: (name, kind) => [...items.values()].filter(x => x.name === name && (!kind || x.kind === kind)),
    count: () => items.size
  };
  return { DriveApp, T };
}

function makeCache(clock) {
  const m = new Map();
  const live = k => { const e = m.get(k); if (!e) return null; if (e.exp <= clock.now) { m.delete(k); return null; } return e.v; };
  const check = (k, v, ttl) => {
    if (typeof k !== 'string' || !k || k.length > 250) throw new Error('Argument too large: key');
    if (typeof v !== 'string') throw new Error('Cache values must be strings');
    if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
    if (ttl != null && (ttl < 1 || ttl > 21600)) throw new Error('Invalid argument: expirationInSeconds');
  };
  const cache = {
    get: k => live(String(k)),
    getAll: keys => { const o = {}; keys.forEach(k => { const v = live(String(k)); if (v != null) o[k] = v; }); return o; },
    put: (k, v, ttl) => { check(k, v, ttl); m.set(k, { v, exp: clock.now + (ttl == null ? 600 : ttl) * 1000 }); },
    putAll: (o, ttl) => { Object.keys(o).forEach(k => cache.put(k, o[k], ttl)); },
    remove: k => { m.delete(String(k)); },
    removeAll: keys => keys.forEach(k => m.delete(String(k)))
  };
  return { CacheService: { getScriptCache: () => cache }, cache, clear: () => m.clear(), map: m };
}

function makeProps(initial) {
  const p = Object.assign({}, initial || {});
  const stats = { reads: 0, writes: 0 };
  const total = () => Object.keys(p).reduce((s, k) => s + Buffer.byteLength(k) + Buffer.byteLength(p[k]), 0);
  const set = (k, v) => {
    v = String(v);
    if (Buffer.byteLength(v) > 9 * 1024) throw new Error('Argument too large: value (Properties 9 KB)');
    const old = p[k]; p[k] = v;
    if (total() > 500 * 1024) { if (old === undefined) delete p[k]; else p[k] = old; throw new Error('You have exceeded the property storage quota.'); }
  };
  const props = {
    getProperty: k => { stats.reads++; return Object.prototype.hasOwnProperty.call(p, k) ? p[k] : null; },
    setProperty: (k, v) => { stats.writes++; set(k, v); return props; },
    setProperties: (o, deleteAllOthers) => { stats.writes++; if (deleteAllOthers) Object.keys(p).forEach(k => delete p[k]); Object.keys(o).forEach(k => set(k, o[k])); return props; },
    getProperties: () => { stats.reads++; return Object.assign({}, p); },
    getKeys: () => Object.keys(p),
    deleteProperty: k => { stats.writes++; delete p[k]; return props; }
  };
  return { PropertiesService: { getScriptProperties: () => props }, store: p, stats };
}

function makeWorld(opts) {
  opts = opts || {};
  const clock = { now: opts.now || Date.parse('2026-11-02T13:00:00.000Z') };
  const rnd = seeded(opts.seed || 'gate-vm');
  const drive = makeDrive(clock, opts);
  const cache = makeCache(clock);
  const props = makeProps(opts.props);
  const mail = { sent: [], quota: opts.mailQuota == null ? 100 : opts.mailQuota };
  const fetches = [];
  const tokeninfo = {};        // access token → the JSON tokeninfo answers (anything else: HTTP 400)
  const errors = [];
  let lockHeld = false;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  }
  const quiet = { log() {}, info() {}, warn() {}, error(...a) { errors.push(a.map(String).join(' ')); } };
  const ctx = {
    console: quiet,
    Date: FakeDate,
    Logger: { log() {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5' },
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(alg, value) {
        const name = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' }[alg];
        if (!name) throw new Error('Unknown digest ' + alg);
        return signedOf(nodeCrypto.createHash(name).update(toBytes(value, 'digest value')).digest());
      },
      computeHmacSignature(alg, value, key) {
        if (alg !== 'HMAC_SHA_256') throw new Error('Unknown mac ' + alg);
        if (typeof value === 'string' !== (typeof key === 'string')) throw new Error('computeHmacSignature: value and key must both be text or both bytes');
        return signedOf(nodeCrypto.createHmac('sha256', toBytes(key, 'mac key')).update(toBytes(value, 'mac value')).digest());
      },
      computeHmacSha256Signature(value, key) { return ctx.Utilities.computeHmacSignature('HMAC_SHA_256', value, key); },
      getUuid: () => rnd.uuid(),
      base64Encode: d => toBytes(d, 'base64').toString('base64'),
      base64EncodeWebSafe: d => toBytes(d, 'base64').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: s => signedOf(Buffer.from(String(s), 'base64')),
      base64DecodeWebSafe: s => signedOf(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob(data, type, name) {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : toBytes(data, 'blob');
        let t = type || 'application/octet-stream', n = name || null;
        return { getDataAsString: () => buf.toString('utf8'), getBytes: () => signedOf(buf), getContentType: () => t, getName: () => n,
          setName(x) { n = String(x); return this; }, setContentType(x) { t = String(x); return this; }, _buf: () => buf };
      },
      sleep(ms) { clock.now += Math.max(0, Number(ms) || 0); }
    },
    CacheService: cache.CacheService,
    PropertiesService: props.PropertiesService,
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (lockHeld) return false; lockHeld = true; return true; },
      waitLock: () => { if (lockHeld) throw new Error('Lock timeout'); lockHeld = true; },
      releaseLock: () => { lockHeld = false; }, hasLock: () => lockHeld
    }) },
    UrlFetchApp: {
      fetch(url, params) {
        fetches.push({ url: String(url), params });
        const m = /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?access_token=(.*)$/.exec(String(url));
        const info = m ? tokeninfo[decodeURIComponent(m[1])] : undefined;
        const code = info ? 200 : 400, body = info ? JSON.stringify(info) : JSON.stringify({ error: 'invalid_token' });
        return { getResponseCode: () => code, getContentText: () => body };
      }
    },
    MailApp: {
      sendEmail(a, subject, body) {
        const msg = typeof a === 'object' ? a : { to: a, subject, body };
        if (mail.quota < 1) throw new Error('Service invoked too many times for one day: email.');
        mail.quota--; mail.sent.push(msg);
      },
      getRemainingDailyQuota: () => mail.quota
    },
    DriveApp: drive.DriveApp,
    ContentService: { MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput: t => ({ _t: String(t), _m: 'TEXT', setMimeType(m) { this._m = m; return this; }, getMimeType() { return this._m; }, getContent() { return this._t; } }) },
    HtmlService: { createHtmlOutput: h => ({ _h: String(h), _title: '', setTitle(t) { this._title = t; return this; }, getTitle() { return this._title; }, getContent() { return this._h; } }) }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Math.random inside the context, seeded (the gate mixes it into its secret).
  ctx.__seededRandom = rnd.random;
  vm.runInContext('Math.random = function () { return __seededRandom(); };', ctx);

  const world = {
    ctx, clock, drive: drive.T, cache: Object.assign({}, cache.cache, { clear: cache.clear }), props, mail, fetches, tokeninfo, errors,
    load(source, filename) { vm.runInContext(source, ctx, { filename: filename || 'PASTE-GATE.gs' }); return world; },
    post(body) {
      const contents = typeof body === 'string' ? body : JSON.stringify(body);
      return JSON.parse(ctx.doPost({ postData: { contents, type: 'text/plain', length: contents.length } }).getContent());
    },
    get(params) {
      const out = ctx.doGet({ parameter: params || {} });
      const text = out.getContent();
      return out._h !== undefined ? { html: text, title: out.getTitle() } : JSON.parse(text);
    },
    advance(ms) { clock.now += ms; return clock.now; }
  };
  return world;
}

module.exports = { makeWorld, seeded, signedOf };
