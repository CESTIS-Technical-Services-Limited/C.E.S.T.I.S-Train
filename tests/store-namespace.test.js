/* The device store's namespace switch for the trainee gate — off unless it
   is switched on, and then a world of its own.

   The trainee gate (docs/trainee-gate/DESIGN.md §7.1) runs a trainee's gate
   session in its own corner of the browser's storage: a database of its own
   (CESTIS_KV__g1) and every localStorage key under 'g1::'. A lab PC that
   holds the Centre's records keeps them untouched — a trainee's session
   neither reads, changes nor wipes them — and the main store never takes a
   namespace's keys for its own. The switch is the unprefixed localStorage
   key cestisGateNs, which nothing sets yet.

   Pinned here, for BOTH copies of the store (the canonical one in
   cestis-core.js, which every page uses, and the inline fallback in
   index.html):
     - with the switch off, the store behaves EXACTLY as it did before the
       switch existed: every method (getItem, setItem — including a value too
       big for localStorage — removeItem, clear, key, keys, length,
       hasOwnProperty, whenReady, isReady, mayHoldUnloaded, writes) and the
       cross-document 'storage' events, run beside a frozen copy of the old
       store (tests/fixtures/store-before-gate/), give the same answers and
       the same localStorage and IndexedDB writes, write for write;
     - switched on: its own database, every key under 'g1::', keys(), key(),
       length, clear() and the events all inside the namespace, the
       Centre's keys and database untouched;
     - the main store ignores a namespace's keys (on load and in events),
       and the master snapshot never carries them;
     - a value that is not a namespace name leaves the switch off;
     - the two copies of the switch are the same text and do the same.

   Run: node tests/store-namespace.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 5));

/* ------------------------------------------------- the four store copies */
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function slice(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('store copy not found: ' + start.slice(0, 40));
  return src.slice(a, b + end.length);
}
const wrapCore = body => '(function (root) {\n  \'use strict\';\n' + body + '})(typeof window !== \'undefined\' ? window : this);\n';
const STORES = {
  coreNow: wrapCore(slice(CORE_SRC, '  (function () {\n    if (!root || root.CESTISStore) return;', '    root.CESTISStore = Store;\n  })();\n')),
  coreBefore: fs.readFileSync(path.join(__dirname, 'fixtures', 'store-before-gate', 'cestis-core-store.js'), 'utf8'),
  inlineNow: slice(INDEX_SRC, '(function(){\n  if (window.CESTISStore) return;', '  window.CESTISStore = Store;\n})();\n'),
  inlineBefore: fs.readFileSync(path.join(__dirname, 'fixtures', 'store-before-gate', 'index-inline-store.js'), 'utf8')
};

/* ------------------------------------------------ a browser origin, faked
   One localStorage and one IndexedDB shared by every document of the origin;
   a 'storage' event reaches the OTHER documents later, as a queued task. Every
   write to either is recorded, in order. */
function origin(opts) {
  opts = opts || {};
  const LIMIT = opts.limit || 60;
  const ls = new Map(Object.entries(opts.ls || {}));
  const dbs = new Map();
  Object.keys(opts.idb || {}).forEach(name => dbs.set(name, new Map(Object.entries(opts.idb[name]))));
  const log = [], opened = [], docs = [];
  let writer = null;
  const fire = (key, newValue, oldValue) => {
    const from = writer;
    setTimeout(() => docs.forEach(d => { if (d !== from) d.listeners.forEach(fn => fn({ key, newValue, oldValue })); }), 0);
  };
  const localStorage = {
    get length() { return ls.size; },
    key: i => (i < ls.size ? Array.from(ls.keys())[i] : null),
    getItem: k => (ls.has(String(k)) ? ls.get(String(k)) : null),
    setItem(k, v) {
      k = String(k); v = String(v);
      if (v.length > LIMIT) { log.push('ls.refuse ' + k); const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      const old = ls.has(k) ? ls.get(k) : null;
      ls.set(k, v); log.push('ls.set ' + k + '=' + v); fire(k, v, old);
    },
    removeItem(k) { k = String(k); if (!ls.has(k)) return; const old = ls.get(k); ls.delete(k); log.push('ls.remove ' + k); fire(k, null, old); },
    clear() { ls.clear(); log.push('ls.clear'); fire(null, null, null); }
  };
  function db(name) { if (!dbs.has(name)) dbs.set(name, new Map()); return dbs.get(name); }
  const indexedDB = {
    open(name) {
      opened.push(name);
      const req = {};
      setTimeout(() => {
        const data = db(name);
        const handle = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              put: (v, k) => { data.set(k, v); log.push('idb[' + name + '].put ' + k); },
              delete: k => { data.delete(k); log.push('idb[' + name + '].delete ' + k); },
              clear: () => { data.clear(); log.push('idb[' + name + '].clear'); },
              get: k => { const r = {}; setTimeout(() => { r.result = data.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
              openCursor: () => {
                const r = {}; const entries = Array.from(data.entries()); let i = 0;
                const step = () => setTimeout(() => { const e = entries[i++]; r.onsuccess({ target: { result: e ? { key: e[0], value: e[1], continue: step } : null } }); }, 0);
                step(); return r;
              }
            })
          })
        };
        req.onsuccess && req.onsuccess({ target: { result: handle } });
      }, 0);
      return req;
    }
  };
  function doc(src) {
    const listeners = [], events = [], fired = [];
    const d = { listeners, fired };
    const ctx = {
      console: { info() {}, log() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
      setTimeout, clearTimeout, localStorage, indexedDB, navigator: { storage: { persist() {} } },
      addEventListener: (t, fn) => { if (t === 'storage') listeners.push(fn); else events.push({ t, fn }); },
      dispatchEvent: ev => { fired.push(ev.type + (ev.detail ? ':' + ev.detail.key + (ev.detail.reason ? ':' + ev.detail.reason : '') : '')); events.filter(e => e.t === ev.type).forEach(e => e.fn(ev)); },
      Event: function (t) { this.type = t; }, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    d.store = ctx.CESTISStore; d.ctx = ctx;
    docs.push(d);
    return d;
  }
  const as = (d, fn) => { writer = d; try { return fn(); } finally { writer = null; } };
  return { ls, dbs, log, opened, doc, as, snapshot: () => ({ ls: Array.from(ls.entries()), idb: Array.from(dbs.entries()).map(([n, m]) => [n, Array.from(m.entries())]) }) };
}

/* Every method, the way the pages use them, and what another document sees. */
async function exercise(src, seed) {
  const o = origin(seed);
  const A = o.doc(src), B = o.doc(src);
  const out = [];
  const S = A.store;
  // The inline copy is an older generation: some methods are not there.
  const call = (st, fn, ...args) => (typeof st[fn] === 'function' ? st[fn](...args) : 'n/a');
  out.push(['before ready', call(S, 'isReady'), call(S, 'mayHoldUnloaded', 'voctrain_users'), S.getItem('cestisTheme'), S.getItem('voctrain_users')]);
  await new Promise(r => S.whenReady(r));
  await tick(20);
  out.push(['ready', call(S, 'isReady'), S.getItem('voctrain_users'), S.getItem('voctrain_students'), S.getItem('nope'), call(S, 'mayHoldUnloaded', 'nope'), S.keys().slice().sort(), S.length]);
  o.as(A, () => S.setItem('voctrain_students', '[1,2]'));
  o.as(A, () => S.setItem('voctrain_big', 'X'.repeat(80)));          // too big for localStorage
  out.push(['wrote', S.getItem('voctrain_students'), S.getItem('voctrain_big'), call(S, 'mayHoldUnloaded', 'voctrain_big'), S.hasOwnProperty('voctrain_big'),
    S.hasOwnProperty('nope'), typeof S.writes === 'number' ? S.writes : 'n/a', S.key(0), S.keys().slice().sort(), S.length]);
  await tick(20);
  out.push(['B sees', B.store.getItem('voctrain_students'), B.store.getItem('voctrain_big'), call(B.store, 'mayHoldUnloaded', 'voctrain_big')]);
  o.as(B, () => B.store.setItem('voctrain_announcements', '[9]'));
  o.as(B, () => B.store.removeItem('cestisTheme'));
  await tick(20);
  out.push(['A sees B', S.getItem('voctrain_announcements'), S.getItem('cestisTheme'), S.hasOwnProperty('cestisTheme'), S.keys().slice().sort()]);
  o.as(A, () => S.removeItem('voctrain_big'));
  await tick(20);
  out.push(['removed', S.getItem('voctrain_big'), B.store.getItem('voctrain_big'), B.store.hasOwnProperty('voctrain_big')]);
  o.as(A, () => S.clear());
  await tick(20);
  out.push(['cleared', S.keys(), S.length, B.store.keys(), A.fired, B.fired]);
  return { out, after: o.snapshot(), log: o.log, opened: o.opened };
}
const SEED = {
  ls: { cestisTheme: 'light', voctrain_students: '[0]' },
  idb: { CESTIS_KV: { voctrain_users: '[{"id":"U1"}]', voctrain_students: '[0]' } }
};

(async () => {
  /* ------------------------------------------------- off: as it always was */
  console.log('With the switch off, the store does exactly what it did before');
  for (const [now, before, label] of [['coreNow', 'coreBefore', 'cestis-core.js'], ['inlineNow', 'inlineBefore', 'index.html']]) {
    const a = await exercise(STORES[now], SEED), b = await exercise(STORES[before], SEED);
    assertEq(a.out, b.out, label + ': every method answers as before');
    assertEq(a.log, b.log, label + ': the same localStorage and IndexedDB writes, write for write (' + b.log.length + ')');
    assertEq(a.after, b.after, label + ': and leaves the same storage behind');
    assertEq(a.opened, ['CESTIS_KV', 'CESTIS_KV'], label + ': the same database, in both documents');
  }
  {
    const o = origin(SEED), A = o.doc(STORES.coreNow);
    assertEq(A.store.namespace, '', 'the store says it opened no namespace');
  }

  /* ---------------------------------------------------- on: its own world */
  async function namespaced(src, big) {
    const o = origin({ ls: { voctrain_students: '[centre]', voctrain_users: '[accounts]' },
      idb: { CESTIS_KV: { voctrain_students: '[centre]', voctrain_examResults: '[all]' } } });
    const main = o.doc(STORES.coreNow);        // the Centre's dashboard, open in another tab
    o.ls.set('cestisGateNs', 'g1');            // then a gate sign-in switches this browser over
    const G = o.doc(src), G2 = o.doc(src);
    const r = [];
    await new Promise(res => G.store.whenReady(res)); await tick(20);
    r.push(['opened', G.store.namespace, G.store.getItem('voctrain_students'), G.store.getItem('voctrain_users'), G.store.keys(), G.store.length]);
    o.as(G, () => G.store.setItem('voctrain_students', '[mine]'));
    o.as(G, () => G.store.setItem('voctrain_examResults', '[small]'));
    if (big) o.as(G, () => G.store.setItem('voctrain_examResults', 'Y'.repeat(80)));   // too big: IndexedDB only
    o.as(G, () => G.store.setItem('cestisGateToken', 'tok'));
    r.push(['wrote', G.store.getItem('voctrain_students'), G.store.getItem('voctrain_examResults').length, G.store.keys().slice().sort(), G.store.length, G.store.key(5)]);
    const lsAfterWrite = Array.from(o.ls.keys()).sort();
    await tick(30);
    r.push(['other gate tab', G2.store.getItem('voctrain_students'), G2.store.getItem('voctrain_examResults') && G2.store.getItem('voctrain_examResults').length]);
    o.as(main, () => main.store.setItem('voctrain_announcements', '[centre-news]'));
    await tick(20);
    r.push(['a Centre write', G.store.getItem('voctrain_announcements'), G.store.hasOwnProperty('voctrain_announcements')]);
    o.as(G, () => G.store.removeItem('cestisGateToken'));
    o.as(G2, () => G2.store.clear());
    await tick(30);
    r.push(['cleared', G.store.keys(), G2.store.keys(), G.store.getItem('voctrain_students')]);
    return { r, o, main, lsAfterWrite };
  }
  console.log('Switched on, the store keeps to its own database and keys');
  const N = await namespaced(STORES.coreNow, true), o = N.o;
  assertEq(N.r[0], ['opened', 'g1', null, null, [], 0], 'it opens empty: none of the Centre\'s records on this PC are visible');
  assert(o.opened.indexOf('CESTIS_KV__g1') !== -1, 'it opens a database of its own (CESTIS_KV__g1)');
  assertEq(N.r[1], ['wrote', '[mine]', 80, ['cestisGateToken', 'voctrain_examResults', 'voctrain_students'], 3, null], 'its keys(), key() and length are its own');
  assertEq(N.lsAfterWrite, ['cestisGateNs', 'g1::__cestis_idb_only__:voctrain_examResults', 'g1::cestisGateToken', 'g1::voctrain_students',
    'voctrain_students', 'voctrain_users'], 'every key it writes is under g1:: — a too-big value\'s marker too');
  assertEq(o.ls.get('voctrain_students'), '[centre]', 'the Centre\'s own copy is untouched');
  assertEq(Array.from(o.dbs.get('CESTIS_KV').entries()).filter(e => e[0] !== 'voctrain_users' && e[0] !== 'voctrain_announcements'),
    [['voctrain_students', '[centre]'], ['voctrain_examResults', '[all]']], 'and so is the Centre\'s database');
  assert(o.log.filter(l => l.indexOf('idb[CESTIS_KV]') === 0).every(l => !/voctrain_students|voctrain_examResults|cestisGateToken/.test(l)) &&
    o.log.some(l => l === 'idb[CESTIS_KV__g1].put voctrain_examResults'),
    'its database writes go to its own database (the Centre tab\'s to the Centre\'s)');
  assertEq(N.r[2], ['other gate tab', '[mine]', 80], 'another gate tab sees its writes, a too-big one included');
  assertEq(N.r[3], ['a Centre write', null, false], 'a write by a Centre tab is not seen in the namespace');
  assertEq(N.main.store.getItem('voctrain_students'), '[centre]', 'and the Centre tab never sees the namespace\'s');
  assert(N.main.store.keys().every(k => k.indexOf('g1::') !== 0 && k !== 'cestisGateToken'), 'nor takes its keys for its own');
  assertEq(N.r[4], ['cleared', [], [], null], 'clear() empties the namespace only');
  assertEq([o.ls.get('cestisGateNs'), o.ls.get('voctrain_students'), o.ls.get('voctrain_users')], ['g1', '[centre]', '[accounts]'],
    'the switch and the Centre\'s keys survive it');
  assert(Array.from(o.ls.keys()).every(k => k.indexOf('g1::') !== 0), 'no g1:: key is left behind');

  console.log('The main store ignores a namespace it finds on the device');
  {
    const o2 = origin({ ls: { voctrain_students: '[centre]', 'g1::voctrain_students': '[trainee]', 'g1::cestisGateToken': 't' } });
    const M = o2.doc(STORES.coreNow), M2 = o2.doc(STORES.inlineNow);
    await tick(20);
    assertEq(M.store.keys(), ['voctrain_students'], 'on load it does not take g1:: keys (canonical copy)');
    assertEq(M2.store.keys(), ['voctrain_students'], 'nor does the inline copy');
    const g = o2.doc(STORES.coreNow);
    o2.ls.set('cestisGateNs', 'g1');
    const Gd = o2.doc(STORES.coreNow);
    o2.as(Gd, () => Gd.store.setItem('voctrain_x', '1'));
    await tick(20);
    assert(!M.store.hasOwnProperty('g1::voctrain_x') && !M.store.hasOwnProperty('voctrain_x'), 'nor from a namespace\'s storage event');
    assertEq(Gd.store.getItem('voctrain_students'), '[trainee]', 'while the namespace finds what it left there');
    assert(g.store.namespace === '' && Gd.store.namespace === 'g1', 'each document says which it opened');
    const Core = require('../cestis-core.js');
    assert(!Core.isSnapshotableKey('g1::voctrain_students') && !Core.isSnapshotableKey('g12::x') && Core.isSnapshotableKey('voctrain_attendance::2026_Q3'),
      'the master snapshot never carries a namespace key (and still carries the attendance quarters)');
  }

  console.log('Anything but a namespace name leaves the switch off');
  for (const v of ['', 'g', 'G1', 'g1234', '1', 'g1::', 'true']) {
    const o3 = origin({ ls: { cestisGateNs: v, voctrain_students: '[centre]' } });
    const d = o3.doc(STORES.coreNow), e = o3.doc(STORES.inlineNow);
    await tick(20);
    assert(d.store.namespace === '' && e.store.namespace === '' && d.store.getItem('voctrain_students') === '[centre]' &&
      o3.opened.every(n => n === 'CESTIS_KV'), JSON.stringify(v) + ' opens the main store');
  }

  /* ----------------------------------- the gate's keys stay on the device */
  console.log('The gate\'s own keys never leave this device');
  {
    const Core = require('../cestis-core.js');
    const PC = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
    const grab = (start, end) => { const a = PC.indexOf(start); return PC.slice(a, PC.indexOf(end, a) + end.length); };
    const ctx = { core: () => Core };
    vm.createContext(ctx);
    vm.runInContext(grab('  var DEVICE_KEYS = [', '\n  }\n') + grab('  var ALL_SPEC = {', '\n  };\n'), ctx);
    const keys = Core.gate.DEVICE_KEYS.concat(['g1::voctrain_students', 'g1::cestisGateToken', 'g2::anything']);
    const map = { voctrain_students: '[1]', cestisTheme: 'dark' };
    keys.forEach(k => { map[k] = 'x'; });
    const snap = Core.buildSnapshot(map, { event: 'test' });
    assertEq(keys.filter(k => k in snap.store), [], 'the master snapshot carries none of them');
    assert('voctrain_students' in snap.store, '(and still carries the Centre\'s records)');
    const mirror = Core.pageCloud.collect(ctx.ALL_SPEC, map);
    assertEq(Core.gate.DEVICE_KEYS.filter(k => k in mirror), [], 'the Centre network\'s whole-store mirror leaves out every gate key');
    Object.keys(mirror).forEach(k => { if (ctx.deviceOnly(k)) delete mirror[k]; });   // what the mirror then sends (lanCollect)
    assertEq(keys.filter(k => k in mirror), [], 'and with its device-only rule, the namespace\'s keys too');
    assert('voctrain_students' in mirror, '(the Centre\'s records still go)');
    assertEq(Core.gate.DEVICE_KEYS.filter(k => ctx.DEVICE_KEYS.indexOf(k) === -1), [], 'the mirror\'s list names every gate key');
  }

  /* -------------------------------------------- the two copies agree */
  console.log('The canonical and inline copies of the switch agree');
  {
    const block = src => {
      const m = /\/\* gate-ns:begin[\s\S]*?\/\* gate-ns:end \*\//.exec(src);
      return m ? m[0].split('\n').map(l => l.trim()).join('\n') : null;
    };
    const a = block(CORE_SRC), b = block(INDEX_SRC);
    assert(!!a && a === b, 'the switch is the same text in cestis-core.js and index.html');
    // (The inline copy is an older generation with no marker for a value too
    // big for localStorage, so the two are compared on values that fit.)
    const I = await namespaced(STORES.inlineNow, false), C2 = await namespaced(STORES.coreNow, false);
    assertEq(I.r.map(x => JSON.stringify(x)), C2.r.map(x => JSON.stringify(x)), 'and does the same, answer for answer');
    assertEq(I.lsAfterWrite, C2.lsAfterWrite, 'writing the same keys');
    const keysOf = oo => Array.from(oo.ls.keys()).sort();
    assertEq(keysOf(I.o), keysOf(C2.o), 'and leaving the same keys behind');
    assert(I.o.opened.indexOf('CESTIS_KV__g1') !== -1, 'in the same database');
    const off = INDEX_SRC.slice(0, INDEX_SRC.indexOf('<body'));
    assert(off.indexOf('cestis-core.js') < off.indexOf('if (window.CESTISStore) return;'), 'the page loads the canonical copy first; the inline one is its fallback');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
