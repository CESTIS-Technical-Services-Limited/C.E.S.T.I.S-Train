/* The Centre's own server (the Offline System): a save sends only what
   changed, the history takes a tenth of the disk, and a year's file fits.

   What went wrong (EF-5 in the efficiency audit):
     - every write through the store was stamped and sent — the same value
       written again too — and the dashboard rewrites every collection on each
       save, so one changed mark re-sent CESTIS_LMS_Dashboard.json and
       CESTIS_ALL_DATA.json whole (a month-1 register: 52 saves, 306 MB);
     - the server kept 40 full copies of every file (about 4 GB at a school
       year's size);
     - it refused any save over 64 MiB, which the dashboard file reaches at
       about month 13.

   Pinned here, with the real server (cestis-offline-server.js) on a scratch
   folder and devices running the real cestis-core.js and cestis-page-cloud.js:
     1. writing a value that is already there is not an edit: nothing is sent;
     2. a change sends only the keys that changed; the server merges them into
        the file it holds (every other key kept), and the device keeps the
        merged result as its copy — the next refresh is a "not modified";
     3. another device's change still arrives, and both changes are kept;
     4. the server's file gone: the save of only the changed keys is refused
        and the whole file is sent instead — nothing is lost;
     5. the store: a partial save never becomes a file on its own; the
        history keeps 40 versions, the newest 3 plain, the rest compressed,
        and every one — and an old plain one — reads back whole;
     6. the server takes saves up to 512 MiB.

   Run: node tests/lan-partial-save.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { spawn } = require('child_process');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');
const OFF = path.join(ROOT, 'Offline System');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const PC_SRC = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
const store = require(path.join(OFF, 'cestis-offline-store.js'));
const Core = require(path.join(OFF, 'cestis-core.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-partial-'));
const DATA = path.join(tmp, 'data'), CERT = path.join(tmp, 'cert');
const PORT = 9000 + Math.floor(Math.random() * 900);
let server = null;
function startServer() {
  server = spawn(process.execPath, ['cestis-offline-server.js'], {
    cwd: OFF, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { CESTIS_HTTP: '1', CESTIS_PORT: String(PORT), CESTIS_DATA_DIR: DATA, CESTIS_CERT_DIR: CERT })
  });
  return (async () => {
    for (let i = 0; i < 60; i++) {
      await wait(100);
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/_cestis/health'); if (r.ok) return; } catch (e) {}
    }
    throw new Error('offline server did not start');
  })();
}
async function stopServer() {
  if (!server) return;
  const s = server; server = null;
  await new Promise(r => { s.on('exit', r); s.kill(); });
}
const SPEC = { page: 'Test page', file: 'CESTIS_TEST_PAGE.json', prefixes: ['tp_'], keys: [] };
const onServer = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, SPEC.file), 'utf8')); } catch (e) { return null; } };

function device(name) {
  const map = new Map();
  const log = { puts: [], gets: [] };
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, setInterval: () => 0,
    location: { protocol: 'http:', hostname: '127.0.0.1', port: String(PORT) },
    fetch: (u, o) => fetch('http://127.0.0.1:' + PORT + u, o).then(r => {
      if (o && o.method === 'PUT') { let b = null; try { b = JSON.parse(o.body); } catch (e) {} log.puts.push({ file: decodeURIComponent(u.split('/').pop()), status: r.status, bytes: (o.body || '').length, partial: !!(b && b.partial), keys: b && b.data ? Object.keys(b.data).sort() : [] }); }
      else if (/\/_cestis\/data\//.test(u)) log.gets.push(decodeURIComponent(u.split('/').pop()) + ' ' + r.status);
      return r;
    }),
    addEventListener: () => {},
    CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); }, keys: () => Array.from(map.keys()) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE_SRC, ctx);
  vm.runInContext(PC_SRC, ctx);
  vm.runInContext('var currentRole = "admin", currentLoggedInUser = { id: "U-ADMIN", username: "admin" };', ctx);
  const api = ctx.CESTISPageCloud;
  return { name, map, log, api, ctx, set: (k, v) => ctx.CESTISStore.setItem(k, v), get: k => (map.has(k) ? map.get(k) : null), open: () => api.initLan(Object.assign({}, SPEC)) };
}

(async () => {
  try {
    await startServer();
    const health = await fetch('http://127.0.0.1:' + PORT + '/_cestis/health');
    assertEq(health.headers.get('X-CESTIS-Features'), 'partial-put', 'the server says it takes saves of only the changed keys');

    console.log('1. A value written again is not an edit');
    const A = device('A');
    assert(await A.api.lan(), 'device A finds the server');
    await A.open(); await wait(200);
    const BIG = 'x'.repeat(200000);
    for (let i = 0; i < 20; i++) A.set('tp_key' + i, JSON.stringify([{ id: 'R' + i, text: BIG.slice(0, 10000 + i) }]));
    await A.api.saveNow();
    const first = A.log.puts.slice(-1)[0];
    assert(first && !first.partial && first.keys.length === 20, 'the first save (no file on the server yet) sends the whole file (' + (first && first.keys.length) + ' keys)');
    let putsBefore = A.log.puts.length;
    for (let i = 0; i < 20; i++) A.set('tp_key' + i, A.get('tp_key' + i));     // as saveState does
    await A.api.saveNow();
    assertEq(A.log.puts.length - putsBefore, 0, 'every key written again with the same value: nothing sent');

    console.log('2. A change sends only what changed');
    putsBefore = A.log.puts.length;
    A.set('tp_key7', JSON.stringify([{ id: 'R7', text: 'edited' }]));
    await A.api.saveNow();
    const putAll = A.log.puts.slice(putsBefore);
    const put = putAll.filter(p => p.file === SPEC.file);
    assert(put.length === 1 && put[0].partial === true && put[0].keys.join() === 'tp_key7', 'one save of the page\'s file, of the one key that changed (' + JSON.stringify(put.map(p => p.keys)) + ')');
    assert(putAll.every(p => p.partial && p.keys.join() === 'tp_key7'), 'and of the whole-store mirror, the same one key (' + putAll.length + ' saves)');
    assert(put[0].bytes < first.bytes / 10, 'a fraction of the whole file (' + put[0].bytes + ' bytes against ' + first.bytes + ')');
    let srv = onServer();
    assert(srv && Object.keys(srv.data).length === 20 && JSON.parse(srv.data.tp_key7)[0].text === 'edited' && JSON.parse(srv.data.tp_key3)[0].id === 'R3',
      'the server merged it into the file: every other key kept');
    assert(!('partial' in srv), 'and the stored file is a whole file (no "partial" mark)');
    const g0 = A.log.gets.length;
    await A.api.loadNow();
    assert(A.log.gets.slice(g0).length >= 1 && A.log.gets.slice(g0).every(g => / 304$/.test(g)), 'the device\'s copies of the merged files are right: the next refresh is "not modified" (' + A.log.gets.slice(g0).join(', ') + ')');

    console.log('3. Another device\'s change arrives, and both are kept');
    const B = device('B');
    await B.api.lan(); await B.open(); await wait(300);
    assertEq(JSON.parse(B.get('tp_key7'))[0].text, 'edited', 'device B has A\'s change');
    const bPuts = B.log.puts.length;
    B.set('tp_key12', JSON.stringify([{ id: 'R12', text: 'from B' }]));
    await B.api.saveNow();
    assert(B.log.puts.slice(bPuts).every(p => p.partial) && B.log.puts.slice(bPuts).some(p => p.keys.indexOf('tp_key12') !== -1), 'B sends only its change');
    await A.api.loadNow();
    assertEq(JSON.parse(A.get('tp_key12'))[0].text, 'from B', 'A gets B\'s change');
    A.set('tp_key0', JSON.stringify([{ id: 'R0', text: 'A again' }]));
    await A.api.saveNow();
    srv = onServer();
    assert(JSON.parse(srv.data.tp_key0)[0].text === 'A again' && JSON.parse(srv.data.tp_key12)[0].text === 'from B' && JSON.parse(srv.data.tp_key7)[0].text === 'edited',
      'the server holds both devices\' changes');

    console.log('4. The server\'s file gone: the whole file is sent instead');
    fs.unlinkSync(path.join(DATA, SPEC.file));
    putsBefore = A.log.puts.length;
    A.set('tp_key1', JSON.stringify([{ id: 'R1', text: 'after the loss' }]));
    await A.api.saveNow();
    const p4 = A.log.puts.slice(putsBefore);
    srv = onServer();
    assert(srv && Object.keys(srv.data).length === 20 && JSON.parse(srv.data.tp_key1)[0].text === 'after the loss' && JSON.parse(srv.data.tp_key12)[0].text === 'from B',
      'the file is back whole (' + (srv ? Object.keys(srv.data).length : 0) + ' keys), nothing lost — ' + JSON.stringify(p4.map(p => [p.status, p.partial, p.keys.length])));
  } catch (e) {
    failed++; console.error('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await stopServer();
  }

  console.log('5. The store: partial saves and the history');
  {
    const D = path.join(tmp, 'store');
    const F = path.join(D, 'P.json');
    const page = (data, stamps, extra) => Object.assign({ version: '1.0', page: 'P', file: 'P.json', savedAt: '', savedBy: '', keyCount: Object.keys(data).length, stamps, data }, extra || {});
    let threw = null;
    await store.save({ file: F, dataDir: D, core: Core, incoming: page({ a: '1' }, { a: '2026-10-01T00:00:00Z' }, { partial: true }) }).catch(e => { threw = e; });
    assert(threw && threw.code === 'PARTIAL_NEEDS_FULL' && !fs.existsSync(F), 'a partial save with no file to merge into is refused, and writes nothing');
    await store.save({ file: F, dataDir: D, core: Core, incoming: page({ a: '1', b: '2' }, { a: '2026-10-01T00:00:00Z', b: '2026-10-01T00:00:00Z' }) });
    const etag = store.etagOf(fs.readFileSync(F));
    const r = await store.save({ file: F, dataDir: D, core: Core, base: etag, incoming: page({ b: '3' }, { b: '2026-10-02T00:00:00Z' }, { partial: true }) });
    const now = JSON.parse(fs.readFileSync(F, 'utf8'));
    assert(now.data.a === '1' && now.data.b === '3' && !('partial' in now), 'merged in: the other key kept, the file whole');
    assert(r.basedOn === true && r.resultSig === Core.pageCloud.resultSig(now.data, now.stamps), 'it says it was built on the stored version, with the result\'s fingerprint');
    const r2 = await store.save({ file: F, dataDir: D, core: Core, base: '"stale"', incoming: page({ c: '4' }, { c: '2026-10-03T00:00:00Z' }, { partial: true }) });
    assert(r2.basedOn === false, 'built on an older version: it says so (the device reads the file again)');
    fs.writeFileSync(F, 'not json at all');
    threw = null;
    await store.save({ file: F, dataDir: D, core: Core, incoming: page({ d: '5' }, {}, { partial: true }) }).catch(e => { threw = e; });
    assert(threw && threw.code === 'PARTIAL_NEEDS_FULL' && fs.readFileSync(F, 'utf8') === 'not json at all', 'nor onto a file that cannot be read');

    // History: 45 saves; 40 kept; the newest 3 plain, the rest compressed.
    const H = path.join(D, 'H.json');
    const hdir = store.historyDir(D, H);
    fs.mkdirSync(hdir, { recursive: true });
    // An old version from before this change, uncompressed (as on a Centre's server today).
    fs.writeFileSync(path.join(hdir, '2026-01-01T00-00-00-000Z-000001.json'), JSON.stringify({ n: 'old' }));
    for (let i = 0; i < 45; i++) {
      await store.save({ file: H, dataDir: D, core: null, incoming: { n: i, pad: 'y'.repeat(5000) } });
      await store.historySettled(D, H);
    }
    const vs = store.historyVersions(D, H);
    assertEq(vs.length, store.HISTORY_KEEP, 'the last ' + store.HISTORY_KEEP + ' versions are kept');
    assertEq(vs.slice(-3).map(f => /\.gz$/.test(f)), [false, false, false], 'the newest 3 are plain (copy one back to restore it)');
    assert(vs.slice(0, -3).every(f => /\.json\.gz$/.test(f)), 'the older ones are compressed');
    assertEq(JSON.parse(store.readHistory(D, H, vs[vs.length - 1])).n, 43, 'the newest kept is the one just replaced');
    assertEq(JSON.parse(store.readHistory(D, H, vs[0])).n, 4, 'and the oldest kept reads back whole, from its compressed copy');
    const files = fs.readdirSync(hdir);
    assert(files.every(f => /\.json(\.gz)?$/.test(f)) && files.length === store.HISTORY_KEEP, 'nothing else is left in the folder (' + files.length + ')');
    const plainBytes = Buffer.byteLength(JSON.stringify({ n: 1, pad: 'y'.repeat(5000) }));
    const gzBytes = fs.statSync(path.join(hdir, vs[0])).size;
    assert(gzBytes * 5 < plainBytes, 'a compressed version is a fraction of the size (' + gzBytes + ' against ' + plainBytes + ' bytes)');
    // An old uncompressed version still reads back, before and after it is compressed.
    const D2 = path.join(tmp, 'store2'), H2 = path.join(D2, 'H.json'), h2 = store.historyDir(D2, H2);
    fs.mkdirSync(h2, { recursive: true });
    fs.writeFileSync(path.join(h2, '2026-01-01T00-00-00-000Z-000001.json'), JSON.stringify({ n: 'old' }));
    assertEq(JSON.parse(store.readHistory(D2, H2, '2026-01-01T00-00-00-000Z-000001.json')).n, 'old', 'an old plain version reads back as before');
    for (let i = 0; i < 5; i++) { await store.save({ file: H2, dataDir: D2, core: null, incoming: { n: i } }); await store.historySettled(D2, H2); }
    const v2 = store.historyVersions(D2, H2);
    assertEq(JSON.parse(store.readHistory(D2, H2, v2[0])).n, 'old', 'and once compressed it still reads back whole');
  }

  console.log('6. The server takes a school year\'s file');
  {
    const src = fs.readFileSync(path.join(OFF, 'cestis-offline-server.js'), 'utf8');
    assert(/const MAX_BODY_BYTES = 512 \* 1024 \* 1024;/.test(src) && /received > MAX_BODY_BYTES/.test(src) && !/64 \* 1024 \* 1024/.test(src), 'saves up to 512 MiB (it was 64)');
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
