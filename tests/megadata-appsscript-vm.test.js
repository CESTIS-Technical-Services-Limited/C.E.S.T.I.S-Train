/* MegaData — the PASTE-ALL-IN-ONE.gs file executed inside a SIMULATED Apps
   Script runtime (Node vm + mocked Utilities/LockService/PropertiesService/
   DriveApp/ContentService). Faithful on the dimension that failed live:
   doPost runs as ONE synchronous call, so native-Promise callbacks would
   not fire before it returns — exactly Google's behaviour. This reproduces
   the real "internal timeout" incident and proves the synchronous-Promise
   prelude fixes it: health check, signed headq, real append (segment +
   head.json written), idempotent replay, wrong secret, gate ops, and the
   Drive-fetch ops. Run: node tests/megadata-appsscript-vm.test.js */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');
const MD = require('../megadata/schemas.js');
const paste = require('../megadata/broker-appsscript/build-paste.js');

let passed = 0, failed = 0;
function ok(cond, msg) { try { assert(cond, msg); passed++; } catch (e) { failed++; console.log('  ✗ FAIL: ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function section(t) { console.log(t); }
const SECRET = 'vm-secret-abcdef0123456789abcdef01';
const FOLDER_ID = 'FOLDER123';

/* ---------- the mocked Apps Script world ---------- */
function gasWorld() {
  const filesById = {}; let fileSeq = 0;
  function makeFile(name, content, folderName) {
    const id = 'file_' + (++fileSeq);
    const f = {
      _name: name, _content: String(content), _trashed: false, _folder: folderName, _updated: new Date('2026-08-0' + ((fileSeq % 8) + 1) + 'T10:00:00Z'),
      getId: () => id, getName: () => f._name, getSize: () => f._content.length,
      getBlob: () => ({ getDataAsString: () => f._content }),
      setContent: (t) => { f._content = String(t); },
      getLastUpdated: () => f._updated, isTrashed: () => f._trashed,
      getParents: () => iter([{ getName: () => f._folder }])
    };
    filesById[id] = f;
    return f;
  }
  function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  const folder = {
    _files: [],
    getFilesByName: (n) => iter(folder._files.filter(x => x._name === n)),
    getFiles: () => iter(folder._files.slice()),
    createFile: (name, content) => { const f = makeFile(name, content, 'MegaData'); folder._files.push(f); return f; }
  };
  const props = { HMAC_SECRET: SECRET, MEGADATA_FOLDER_ID: FOLDER_ID };
  const ctx = {
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_alg, str, _cs) => {
        const buf = nodeCrypto.createHash('sha256').update(String(str), 'utf8').digest();
        return Array.from(buf).map(b => (b > 127 ? b - 256 : b)); // GAS returns SIGNED bytes
      },
      sleep: () => {} // synchronous no-op, exactly as blocking as the real one
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    DriveApp: {
      searchFiles: (q) => { const m = /contains "([^"]+)"/.exec(q); const needle = m ? m[1] : ''; return iter(folder._files.filter(x => !x._trashed && x._name.indexOf(needle) !== -1)); },
      getFolderById: (id) => { if (id !== FOLDER_ID) throw new Error('no folder ' + id); return folder; },
      getFilesByName: (n) => iter(folder._files.filter(x => x._name === n && !x._trashed)),
      getFileById: (id) => { const f = filesById[id]; if (!f) throw new Error('no file ' + id); return f; }
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (t) => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } })
    }
  };
  ctx.globalThis = ctx;
  return { ctx, folder, props };
}

async function signed(op, payload) {
  const auth = await MD.sha256Hex(SECRET + '|' + MD.canon(payload || {}));
  return { postData: { contents: JSON.stringify({ op, auth, payload: payload || {} }) } };
}
function post(ctx, e) { return JSON.parse(ctx.doPost(e).getContent()); }

(async function main() {

  section('The pasted file loads and serves inside the simulated Apps Script runtime');
  const { ctx, folder } = gasWorld();
  vm.createContext(ctx);
  vm.runInContext(paste.build(), ctx, { filename: 'PASTE-ALL-IN-ONE.gs' });
  ok(typeof ctx.doGet === 'function' && typeof ctx.doPost === 'function', 'doGet/doPost exist');
  const health = JSON.parse(ctx.doGet().getContent());
  eq(health.ok, true, 'health check answers ok');

  section('REGRESSION — the live "internal timeout": signed headq answers synchronously');
  const h0 = post(ctx, await signed('headq', {}));
  ok(!h0.error, 'no error — the incident (“internal timeout”) cannot recur: got ' + JSON.stringify(h0));
  eq(h0.seq, 0, 'fresh broker: seq 0');
  eq(h0.chain, 'genesis', 'chain genesis');

  section('A REAL signed append: validated, numbered, segment + head.json written to Drive');
  const evt = await MD.buildEvent('person.registered', 'per_vm00000000000000000001',
    { names: { full: 'VM Person' } }, { name: 'VM', role: 'admin', device: 'dev_vm' }, 'vm-test', {});
  const ap = post(ctx, await signed('append', { events: [evt] }));
  eq(ap.ok, true, 'append accepted');
  ok(ap.acks[evt.id] && ap.acks[evt.id].seq === 1, 'acked at seq 1');
  ok(folder._files.some(f => /^seg-000000-1-1\.jsonl$/.test(f.getName())), 'segment file created');
  ok(folder._files.some(f => f.getName() === 'head.json'), 'head.json written');
  ok(folder._files.some(f => f.getName() === 'broker-state.json'), 'state persisted');

  section('Idempotent replay across REQUESTS (state reloaded from Drive each time)');
  const ap2 = post(ctx, await signed('append', { events: [evt] }));
  eq(ap2.ok, true, 'replay accepted');
  eq(ap2.acks[evt.id].seq, 1, 'answered with the ORIGINAL ack');
  eq(folder._files.filter(f => /^seg-/.test(f.getName())).length, 1, 'no second segment');
  const h1 = post(ctx, await signed('headq', {}));
  eq(h1.seq, 1, 'head unchanged');

  section('Auth and gates');
  const bad = post(ctx, { postData: { contents: JSON.stringify({ op: 'headq', auth: 'nope', payload: {} }) } });
  eq(bad.error, 'auth failed', 'wrong secret refused');
  const g1 = post(ctx, await signed('gate', { op: 'setBootstrap', value: 'sealed' }));
  eq(g1.gates.bootstrap, 'sealed', 'gate set');
  const g2 = post(ctx, await signed('gate', { op: 'get' }));
  eq(g2.gates.bootstrap, 'sealed', 'gate persisted across requests');

  section('Drive-fetch ops (the --from-drive path) work in the same runtime');
  folder._files.push(...[]);
  folder.createFile('CESTIS_School_Fees.json', '{"data":{}}');
  folder.createFile('CESTIS_USER_admin_USR-001.json', '{"data":{}}');
  folder.createFile('CESTIS_USER_staff_USR-002.json', '{"data":{}}');
  const ls = post(ctx, await signed('listLegacy', { names: ['CESTIS_School_Fees.json', 'CESTIS_Cashbook.json'], prefixes: ['CESTIS_USER_'], folderIds: [] }));
  eq(ls.files.filter(f => f.name === 'CESTIS_School_Fees.json').length, 1, 'listLegacy finds the backup by name');
  eq(ls.files.filter(f => f.name.indexOf('CESTIS_USER_') === 0).length, 2, 'PREFIX search finds every per-user file');
  const ff = post(ctx, await signed('fetchLegacy', { fileId: ls.files.find(f => f.name === 'CESTIS_School_Fees.json').id }));
  eq(ff.content, '{"data":{}}', 'fetchLegacy returns the exact content');

  section('The prelude is present and FIRST in the paste file (drift-guarded)');
  const built = paste.build();
  ok(built.indexOf('synchronous-Promise prelude') !== -1, 'prelude included');
  ok(built.indexOf('appsscript-prelude.js') < built.indexOf('megadata/schemas.js'), 'and it comes before the modules');
  eq(fs.readFileSync(paste.artifact, 'utf8') === built, true, 'committed artifact matches the build');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(function (e) { console.error(e); process.exitCode = 1; });
