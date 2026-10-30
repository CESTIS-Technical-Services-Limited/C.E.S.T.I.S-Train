/* The staff modules are kept for offline use on staff computers.

   Trainee pages skip Staff Appraisals, the board's portal and the certificate
   seed (lighter pages for phones), so the offline worker's first-visit list
   no longer names them, and on a computer's first visit they load before the
   worker is running. A staff page therefore asks the worker to keep them once
   it is ready. This runs the real sw.js in a sandbox and checks:
     - the worker keeps the files a staff page names (same site only, at most 10);
     - it refuses another site's address and its own data calls;
     - after the kill switch it keeps nothing;
     - index.html asks only on staff pages, and again after a late load().

   Run: node tests/staff-modules-offline.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
const ROOT = path.join(__dirname, '..');
const SWSRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

function worker() {
  const listeners = {};
  const kept = [];
  const fetched = [];
  const SCOPE = 'https://example.github.io/C.E.S.T.I.S-Train/';
  class Req { constructor(u) { this.url = typeof u === 'string' ? u : u.url; this.method = 'GET'; } }
  const okResponse = () => ({ ok: true, status: 200, type: 'basic', headers: { get: () => null }, clone() { return this; } });
  const cache = {
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    put: (req) => { kept.push(req.url); return Promise.resolve(); },
    match: () => Promise.resolve(null)
  };
  const sb = {
    self: { addEventListener: (n, f) => { listeners[n] = f; }, registration: { scope: SCOPE }, skipWaiting() {}, clients: { claim: () => Promise.resolve() } },
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
    fetch: (u) => { fetched.push(typeof u === 'string' ? u : u.url); return Promise.resolve(okResponse()); },
    Request: Req, URL, Promise, console, Date, setTimeout
  };
  vm.createContext(sb);
  vm.runInContext(SWSRC, sb);
  async function send(data) {
    const waits = [];
    listeners.message({ data, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }
  return { listeners, kept, fetched, send, SCOPE };
}

(async () => {
  console.log('The worker keeps the files a staff page names');
  let w = worker();
  assert(typeof w.listeners.message === 'function', 'the worker listens for messages');
  await w.send({ cestisKeep: ['staff-appraisals.js?v=017111e8', 'cmc-portal.js?v=65318ed9', 'cert-template-seed.js?v=3081872c'] });
  assert(w.kept.length === 3 && w.kept.every(u => u.indexOf(w.SCOPE) === 0), 'all three are kept, at this site\'s own addresses (' + w.kept.join(', ') + ')');

  console.log('It keeps nothing from another site, nor the Centre server\'s data calls');
  w = worker();
  await w.send({ cestisKeep: ['https://evil.example/x.js', 'https://www.googleapis.com/drive/v3/files', '/_cestis/data/CESTIS_ALL_DATA.json', 'staff-appraisals.js?v=1'] });
  assert(w.kept.length === 1 && /staff-appraisals\.js/.test(w.kept[0]), 'only the site\'s own script is kept (' + w.kept.join(', ') + ')');
  assert(!w.fetched.some(u => /evil|googleapis|_cestis/.test(u)), 'and nothing else is even fetched');

  console.log('At most ten files a message');
  w = worker();
  await w.send({ cestisKeep: Array.from({ length: 25 }, (_, i) => 'f' + i + '.js') });
  assert(w.kept.length === 10, 'ten kept, not 25 (' + w.kept.length + ')');

  console.log('After the kill switch it keeps nothing');
  w = worker();
  const kill = (SWSRC.match(/var KILL_FILE = '([^']+)'/) || [])[1];
  await w.send({ cestis: kill });
  await w.send({ cestisKeep: ['staff-appraisals.js?v=1'] });
  assert(!!kill && w.kept.length === 0, 'nothing kept once switched off');

  console.log('index.html asks only on staff pages');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const loader = idx.slice(idx.indexOf('var FILES = [\'staff-appraisals.js'), idx.indexOf('var tag = \'script\';'));
  assert(/function keepOffline\(\)/.test(loader) && /postMessage\(\{ cestisKeep: FILES \}\)/.test(loader), 'the loader asks the worker to keep FILES');
  assert(/if \(!trainee\) \{ try \{ window\.addEventListener\('load', keepOffline\)/.test(loader), 'on load, and only when this is not a trainee\'s page');
  assert(/have\(\)\) throw new Error\('the staff modules did not load'\); keepOffline\(\);/.test(loader), 'and again when a staff member signs in on a trainee\'s phone (load())');
  ['', 'Offline System'].forEach(where => {
    const src = fs.readFileSync(path.join(ROOT, where, 'sw.js'), 'utf8');
    assert(/cestisKeep/.test(src), (where || '.') + '/sw.js handles the request');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
