/* The trainee gate itself, for the browser suites: the REAL
   trainee-gate/PASTE-GATE.gs, run in Node `vm` with the simulated Apps Script
   runtime of tests/gate-appsscript-fakes.js — except that its DriveApp is an
   adapter over the SAME tests/browser/fake-drive.js the staff PC writes
   through. So what the staff PC publishes is what the gate serves, what the
   gate writes into a trainee's folder is what the staff PC's collector reads,
   and nothing between them is staged by the test.

     const { FakeDrive } = require('./fake-drive');
     const { makeFakeGate, GATE_URL } = require('./fake-gate');
     const drive = new FakeDrive();
     const gate = makeFakeGate(drive);
     await ctx.route(GATE_URL + '**', r => gate.handle(r));      // GET ?op=… and POST {op, …}
     gate.tokenFor('trainee@example.com')                        // an email-account token tokeninfo vouches for
     gate.down = true                                            // the gate out of reach (requests aborted)

   The gate runs on the real clock (the pages do), and DriveApp's search
   language (Drive v2: title contains / fullText contains / modifiedDate >)
   is answered over FakeDrive's files. */
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const fakes = require('../gate-appsscript-fakes.js');

const ROOT = path.join(__dirname, '..', '..');
const GATE_URL = 'https://script.google.com/macros/s/FAKE/exec';
const CLIENT_ID = require('../../cestis-config.js').googleClientId;   // the Centre's sign-in client
const FOLDER = 'application/vnd.google-apps.folder';

function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => { if (i >= list.length) throw new Error('No more items'); return list[i++]; } }; }
const signedOf = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
function toBuf(v) {
  if (typeof v === 'string') return Buffer.from(v, 'utf8');
  if (Array.isArray(v)) return Buffer.from(v.map(b => b & 255));
  if (Buffer.isBuffer(v)) return v;
  return Buffer.from(String(v == null ? '' : v), 'utf8');
}

/* DriveApp, as the gate's script sees it, over FakeDrive's files. */
function driveAppOver(fd) {
  const isFolder = f => f && f.mimeType === FOLDER;
  const get = id => {
    const f = fd.files[String(id)];
    if (!f) throw new Error('No item with the given ID could be found, or you do not have permission to access it.');
    return f;
  };
  const children = (pid, folders) => Object.values(fd.files).filter(f => f.parents.indexOf(pid) !== -1 && !!isFolder(f) === !!folders);
  const bytesOf = f => (f._bytes ? f._bytes : Buffer.from(f.content || '', 'utf8'));
  const parentApi = id => {
    if (id === 'root') return folderApi(null);
    if (fd.files[id]) return folderApi(fd.files[id]);
    // A folder FakeDrive does not list (the Centre's main folder): it still has its children.
    return folderApi({ id, name: '(folder)', mimeType: FOLDER, parents: [], createdTime: new Date(0).toISOString(), modifiedTime: new Date(0).toISOString(), virtual: true });
  };
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
      if ((m = /^title\s*=\s*'((?:[^'\\]|\\.)*)'$/.exec(c))) { const v = un(m[1]); return x => x.name === v; }
      if ((m = /^title\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) { const v = un(m[1]); return x => x.name.indexOf(v) === 0; }
      if ((m = /^fullText\s+contains\s+'((?:[^'\\]|\\.)*)'$/.exec(c))) {
        const v = un(m[1]).toLowerCase();
        return x => (x.name + ' ' + (x.description || '') + ' ' + (!isFolder(x) && !x._bytes ? (x.content || '') : '')).toLowerCase().indexOf(v) !== -1;
      }
      if ((m = /^trashed\s*=\s*(true|false)$/.exec(c))) { const v = m[1] === 'true'; return x => !!x.trashed === v; }
      if ((m = /^modifiedDate\s*>\s*'([^']+)'$/.exec(c))) {
        const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(m[1]) ? m[1] : m[1] + 'Z');
        if (!isFinite(t)) throw new Error('Invalid argument: q');
        return x => Date.parse(x.modifiedTime) > t;
      }
      if ((m = /^'([^']+)'\s+in\s+parents$/.exec(c))) { const v = m[1]; return x => x.parents.indexOf(v) !== -1; }
      if ((m = /^mimeType\s*=\s*'([^']+)'$/.exec(c))) { const v = m[1]; return x => x.mimeType === v; }
      throw new Error('Invalid argument: q (' + c + ')');
    });
  }
  const search = (q, folders, pid) => {
    const tests = parseQuery(String(q));
    return Object.values(fd.files).filter(x => !!isFolder(x) === !!folders && (!pid || x.parents.indexOf(pid) !== -1) && tests.every(t => t(x)));
  };
  function folderApi(f) {
    const id = f ? f.id : 'root';
    const api = {
      getId: () => id,
      getName: () => (f ? f.name : 'My Drive'),
      setName: n => { fd.put(id, { name: String(n) }, null); return api; },
      getDescription: () => (f && f.description) || null,
      setDescription: d => { fd.put(id, { description: String(d) }, null); return api; },
      getDateCreated: () => new Date(f ? f.createdTime : 0),
      getLastUpdated: () => new Date(f ? f.modifiedTime : 0),
      isTrashed: () => !!(f && f.trashed),
      setTrashed: t => { fd.put(id, { trashed: !!t }, null); return api; },
      getParents: () => iter(f && f.parents && f.parents.length ? [parentApi(f.parents[0])] : []),
      getFiles: () => iter(children(id, false).filter(x => !x.trashed).map(fileApi)),
      getFolders: () => iter(children(id, true).filter(x => !x.trashed).map(folderApi)),
      getFilesByName: n => iter(children(id, false).filter(x => x.name === n && !x.trashed).map(fileApi)),
      getFoldersByName: n => iter(children(id, true).filter(x => x.name === n && !x.trashed).map(folderApi)),
      createFolder: n => folderApi(fd.put(null, { name: String(n), mimeType: FOLDER, parents: [id] }, '')),
      createFile: (a, content, mime) => {
        if (a && typeof a === 'object' && typeof a.getBytes === 'function') {
          const buf = a._buf ? a._buf() : toBuf(a.getBytes());
          const isText = /^(application\/json|text\/)/.test(a.getContentType() || '');
          const nf = fd.put(null, { name: a.getName() || 'Untitled', mimeType: a.getContentType() || 'application/octet-stream', parents: [id] }, isText ? buf.toString('utf8') : buf.toString('latin1'));
          if (!isText) nf._bytes = buf;
          return fileApi(nf);
        }
        return fileApi(fd.put(null, { name: String(a), mimeType: mime || 'text/plain', parents: [id] }, String(content == null ? '' : content)));
      },
      searchFiles: q => iter(search(q, false, id).map(fileApi)),
      searchFolders: q => iter(search(q, true, id).map(folderApi))
    };
    return api;
  }
  function fileApi(f) {
    const api = {
      getId: () => f.id,
      getName: () => f.name,
      setName: n => { fd.put(f.id, { name: String(n) }, null); return api; },
      getSize: () => bytesOf(f).length,
      getMimeType: () => f.mimeType,
      getBlob: () => {
        const buf = bytesOf(f);
        return { getDataAsString: () => buf.toString('utf8'), getBytes: () => signedOf(buf), getContentType: () => f.mimeType, getName: () => f.name, _buf: () => buf };
      },
      setContent: t => { delete f._bytes; fd.put(f.id, null, String(t)); return api; },
      getDescription: () => f.description || null,
      setDescription: d => { fd.put(f.id, { description: String(d) }, null); return api; },
      getDateCreated: () => new Date(f.createdTime),
      getLastUpdated: () => new Date(f.modifiedTime),
      isTrashed: () => !!f.trashed,
      setTrashed: t => { fd.put(f.id, { trashed: !!t }, null); return api; },
      getParents: () => iter(f.parents && f.parents.length ? [parentApi(f.parents[0])] : [])
    };
    return api;
  }
  return {
    getRootFolder: () => folderApi(null),
    getFolderById: id => { const f = get(id); if (!isFolder(f)) throw new Error('Not a folder: ' + id); return folderApi(f); },
    getFileById: id => { const f = get(id); if (isFolder(f)) throw new Error('Not a file: ' + id); return fileApi(f); },
    getFilesByName: n => iter(Object.values(fd.files).filter(x => !isFolder(x) && x.name === n && !x.trashed).map(fileApi)),
    getFoldersByName: n => iter(Object.values(fd.files).filter(x => isFolder(x) && x.name === n && !x.trashed).map(folderApi)),
    searchFiles: q => iter(search(q, false, null).map(fileApi)),
    searchFolders: q => iter(search(q, true, null).map(folderApi)),
    createFolder: n => folderApi(fd.put(null, { name: String(n), mimeType: FOLDER, parents: ['root'] }, '')),
    createFile: (n, c, m) => folderApi(null).createFile(n, c, m),
    getStorageUsed: () => Object.values(fd.files).reduce((s, x) => s + (isFolder(x) ? 0 : bytesOf(x).length), 0)
  };
}

function makeFakeGate(fd, opts) {
  opts = opts || {};
  const world = fakes.makeWorld({ now: Date.now(), seed: opts.seed || 'gate-flows' });
  // The real clock (the pages run on it); Utilities.sleep still moves it on.
  let skew = 0;
  Object.defineProperty(world.clock, 'now', { get: () => Date.now() + skew, set: v => { skew = v - Date.now(); }, configurable: true });
  world.ctx.DriveApp = driveAppOver(fd);
  world.load(fs.readFileSync(path.join(ROOT, 'trainee-gate', 'PASTE-GATE.gs'), 'utf8'), 'PASTE-GATE.gs');
  const g = { world, url: GATE_URL, down: false, calls: [], log: [] };
  // An access token the trainee's email account gives this site (tokeninfo vouches for it).
  g.tokenFor = (email, over) => {
    const t = 'ya29.fake-' + nodeCrypto.createHash('sha256').update(email + '|' + Math.random()).digest('hex').slice(0, 24);
    world.tokeninfo[t] = Object.assign({ aud: CLIENT_ID, azp: CLIENT_ID, email, email_verified: 'true', expires_in: '3599',
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid' }, over || {});
    return t;
  };
  g.handle = async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (g.down) { g.log.push('DOWN ' + req.method()); return route.abort('internetdisconnected'); }
    let out;
    try {
      if (req.method() === 'GET') {
        const u = new URL(req.url());
        const params = {};
        u.searchParams.forEach((v, k) => { params[k] = v; });
        out = world.get(params);
        g.calls.push({ op: params.op || 'health' });
        if (out && out.html !== undefined) return route.fulfill({ status: 200, contentType: 'text/html', headers: cors, body: out.html });
      } else {
        const body = req.postData() || '';
        let op = '';
        try { op = JSON.parse(body).op; } catch (e) {}
        g.calls.push({ op, at: Date.now() });
        out = world.post(body);
      }
    } catch (e) { out = { ok: false, error: 'internal', retry: true, thrown: String(e && e.message || e) }; }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
  };
  g.ops = name => g.calls.filter(c => c.op === name).length;
  return g;
}

module.exports = { makeFakeGate, driveAppOver, GATE_URL, CLIENT_ID };
