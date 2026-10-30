/* A page's own file catches up with what this device holds, and a value it
   already holds is not sent again — on Google Drive and on the Centre's
   server alike.

   What went wrong: to stop the dashboard re-sending its whole file on the
   Centre's network for one changed mark (EF-5), a value written again
   unchanged was no longer stamped or sent. But a page's file also caught up
   that way with changes ANOTHER page made on the same device: the dashboard
   updates the trainee roll, and the Student Progress page, writing the roll
   again as it saves, sent it to its own file. Without that, its file kept an
   older roll — and a brand-new PC opening Student Progress for the first time
   took that older roll as the Centre's (tests/browser/upgrade-no-data-loss.js,
   "a new device has every record": two trainees and their fee details gone).

   The rule now: a value written again unchanged is skipped only when the
   page's file is known to hold that very value (seen in its last pull or
   sent in its last push). Pinned here with the real cestis-page-cloud.js and
   cestis-core.js against an in-memory Drive:
     1. a value another page changed, written again unchanged: it goes up;
     2. written again once the file holds it: nothing is sent;
     3. a real edit: it goes up.

   (The Centre's server side of the same rule: tests/lan-partial-save.test.js.)

   Run: node tests/page-cloud-rewrite.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');

function drive(initial) {
  const file = { id: 'F1', content: JSON.stringify(initial), modifiedTime: '2026-10-01T09:00:00.000Z' };
  const log = { patches: [] };
  const res = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: { get: () => null } });
  const fetch = async (url, opts) => {
    opts = opts || {};
    if (/^\/_cestis\//.test(url)) return res(404, {});                         // not on the Centre's server
    const u = new URL(url);
    if (/\/upload\/drive\/v3\/files\/F1$/.test(u.pathname) && opts.method === 'PATCH') {
      file.content = typeof opts.body === 'string' ? opts.body : await opts.body.text();
      file.modifiedTime = new Date().toISOString();
      log.patches.push(JSON.parse(file.content));
      return res(200, { id: 'F1' });
    }
    if (/\/drive\/v3\/files\/F1$/.test(u.pathname) && u.searchParams.get('alt') === 'media') return res(200, JSON.parse(file.content));
    if (/\/drive\/v3\/files$/.test(u.pathname)) return res(200, { files: [{ id: 'F1', modifiedTime: file.modifiedTime }] });
    return res(404, {});
  };
  return { file, log, fetch, data: () => JSON.parse(file.content).data };
}

function device(fetch, seed) {
  const map = new Map(Object.entries(seed));
  const ctx = {
    console: { log() {}, warn() {}, error() {}, info() {} }, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, setInterval: () => 0, Blob, URL,
    location: { protocol: 'https:', hostname: 'example.github.io', port: '' },
    fetch, addEventListener: () => {},
    CESTISStore: { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); }, keys: () => Array.from(map.keys()) }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8'), ctx);
  vm.runInContext('var currentRole = "admin", currentLoggedInUser = { id: "U-ADMIN", username: "admin" };', ctx);
  return { map, ctx, api: ctx.CESTISPageCloud, set: (k, v) => ctx.CESTISStore.setItem(k, v), get: k => (map.has(k) ? map.get(k) : null) };
}

(async () => {
  const SPEC = { page: 'Student Progress', file: 'CESTIS_Student_Progress.json', keys: ['sp_roll'] };
  const T1 = '2026-10-01T09:00:00.000Z';
  const OLD = JSON.stringify([{ id: 'S1', name: 'Andre' }]);
  const NOW = JSON.stringify([{ id: 'S1', name: 'Andre', address: '1 Fee Lane' }, { id: 'S2', name: 'Fee Only One' }]);
  const D = drive({ version: '1.0', page: SPEC.page, data: { sp_roll: OLD }, stamps: { sp_roll: T1 } });
  // This PC: the page synced its file once (same stamp); since then the
  // dashboard — another page — changed the roll, out of this page's sight.
  const tokExp = new Date(Date.now() + 3600e3).toISOString();
  const P = device(D.fetch, {
    schoolDashboardGoogleAccessToken: 'tok', schoolDashboardGoogleTokenExpiry: tokExp,
    sp_roll: NOW, ['cestis_pagecloud_stamps__' + SPEC.file]: JSON.stringify({ sp_roll: T1 })
  });
  P.api.init(Object.assign({}, SPEC));
  await wait(300);
  assert(P.get('sp_roll') === NOW, 'the pull keeps what this device holds (same date on both sides)');

  console.log('1. A value another page changed, written again unchanged, goes up');
  P.set('sp_roll', P.get('sp_roll'));          // the page's own save, as it always rewrites its keys
  await wait(2000);                             // the debounced push
  assert(D.log.patches.length === 1 && D.data().sp_roll === NOW, 'the page\'s file now holds this device\'s roll (' + D.log.patches.length + ' upload(s))');

  console.log('2. Written again once the file holds it: nothing is sent');
  const n = D.log.patches.length, stamps0 = P.get('cestis_pagecloud_stamps__' + SPEC.file);
  for (let i = 0; i < 3; i++) P.set('sp_roll', P.get('sp_roll'));
  await wait(2000);
  assert(D.log.patches.length === n, 'no upload (' + (D.log.patches.length - n) + ')');
  assert(P.get('cestis_pagecloud_stamps__' + SPEC.file) === stamps0, 'and the key is not re-dated');

  console.log('3. A real edit goes up');
  const EDIT = JSON.stringify([{ id: 'S1', name: 'Andre Brown', address: '1 Fee Lane' }, { id: 'S2', name: 'Fee Only One' }]);
  P.set('sp_roll', EDIT);
  await wait(2000);
  assert(D.log.patches.length === n + 1 && D.data().sp_roll === EDIT, 'the edit is in the page\'s file');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
