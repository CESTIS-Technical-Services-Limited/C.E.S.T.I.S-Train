/* What a push brings back from the Centre's server reaches the page, not just
   its storage.

   On the Centre's network (the Offline System) a device's push merges the
   server's newer records into its own storage on the way up — "anything the
   cloud contributed is now local too". Those records were written without a
   word to the page: they reached storage but never the page's memory, and
   every later pull then found storage and server alike and reported nothing.
   In the flow test a trainee whose device happened to save just after the
   instructor set an assignment kept seeing "No Assignments Yet" — until the
   page was reloaded — although the assignment sat in their own storage.

   What this runs: the real cestis-core.js and cestis-page-cloud.js in two VM
   "devices", registered as index.html registers the dashboard, talking to the
   Offline System's real store module (cestis-offline-store.js) in-process. The
   instructor's device sets an assignment; the trainee's device, which has
   already pulled, writes a record of its own and pushes; the assignment must
   be handed to its onRestore — the hook the dashboard adopts into memory.

   And a push must not bring back an OLDER copy of a key edited on this device
   while the push was on the wire: it read storage before going to the network,
   and writing its merge of that older reading back over a newer edit lost the
   edit (a centre's dates saved a moment after the centre was created vanished
   in the flow test once pushes were adopted by the page).

   Run: node tests/lan-push-adopt.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const PC_SRC = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const Core = require(path.join(ROOT, 'cestis-core.js'));
const store = require(path.join(ROOT, 'Offline System', 'cestis-offline-store.js'));

const LMS_SPEC = (function () {
  const m = /CESTISPageCloud\.initLan\(\{\s*page: '([^']+)',\s*file: '([^']+)',\s*prefixes: \[([^\]]*)\],\s*keys: \[([^\]]*)\]/.exec(INDEX);
  if (!m) throw new Error('index.html no longer registers the dashboard with initLan');
  const list = s => s.split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return { page: m[1], file: m[2], prefixes: list(m[3]), keys: list(m[4]) };
})();

/* ---------------------------------------------- the Centre's server, in-process */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-push-adopt-'));
const TOKEN = 'push-adopt-token';
function respond(status, body, headers) {
  const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: k => h.get(String(k).toLowerCase()) || null },
    json: () => Promise.resolve(JSON.parse(body)), text: () => Promise.resolve(body) };
}
async function serverFetch(url, opts) {
  opts = opts || {};
  if (url === '/_cestis/health') return respond(200, JSON.stringify({ ok: true, mode: 'offline-lan', time: new Date().toISOString() }));
  if (url === '/_cestis/token') return respond(200, JSON.stringify({ ok: true, token: TOKEN }));
  if (url.indexOf('/_cestis/data/') === 0) {
    if ((opts.headers || {})['X-CESTIS-Token'] !== TOKEN) return respond(401, '{}');
    const file = path.join(DATA, decodeURIComponent(url.slice('/_cestis/data/'.length)));
    if ((opts.method || 'GET') === 'GET') {
      if (!fs.existsSync(file)) return respond(404, '{}');
      const buf = fs.readFileSync(file);
      const etag = store.etagOf(buf);
      if ((opts.headers || {})['If-None-Match'] === etag) return respond(304, '', { ETag: etag });
      return respond(200, buf.toString('utf8'), { ETag: etag });
    }
    const r = await store.save({ file, dataDir: DATA, incoming: JSON.parse(opts.body), core: Core });
    return respond(200, JSON.stringify({ ok: true, etag: r.etag, changedByServer: r.changedByServer }), { ETag: r.etag });
  }
  return respond(404, 'nope');
}

/* ---------------------------------------------------------------- a device */
function device(role, user) {
  const map = new Map();
  const restored = [];
  const dev = { duringPut: null };
  const ctx = {
    console, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    setTimeout, clearTimeout,
    setInterval: () => 0,                  // the test drives every pull and push itself
    location: { protocol: 'http:', hostname: '127.0.0.1', port: '8080' },
    // A hook to act on this device while its write to the server is on the wire.
    fetch: (u, o) => {
      if (o && o.method === 'PUT' && typeof dev.duringPut === 'function') { const f = dev.duringPut; dev.duringPut = null; f(); }
      return serverFetch(u, o);
    },
    addEventListener: () => {},
    CESTISStore: {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: k => { map.delete(k); },
      keys: () => Array.from(map.keys())
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE_SRC, ctx);
  vm.runInContext(PC_SRC, ctx);
  vm.runInContext('var currentRole = ' + JSON.stringify(role) + ', currentLoggedInUser = ' + JSON.stringify(user) + ';', ctx);
  const api = ctx.CESTISPageCloud;
  return Object.assign(dev, {
    api, map, restored,
    list: k => JSON.parse(map.get(k) || '[]'),
    set: (k, v) => ctx.CESTISStore.setItem(k, JSON.stringify(v)),
    open: () => api.initLan(Object.assign({}, LMS_SPEC, { onRestore: keys => restored.push.apply(restored, keys) })),
    stamps: () => JSON.parse(map.get('cestis_pagecloud_stamps__' + LMS_SPEC.file) || '{}')
  });
}

(async () => {
  try {
    console.log('A push that brings back another device\'s records hands them to the page');
    const instructor = device('instructor', { id: 'U-INS', username: 'ian' });
    const trainee = device('student', { id: 'U-AMA', username: 'ama' });
    await instructor.open();
    await trainee.open();
    await wait(200);

    // The instructor sets the first assignment; the trainee's device pulls it.
    instructor.set('voctrain_assignments', [{ id: 'ASN-1', title: 'Fuel System Report', course: 'Marine', updatedAt: new Date().toISOString() }]);
    await instructor.api.saveNow();
    await trainee.api.loadNow();
    assert(trainee.restored.indexOf('voctrain_assignments') !== -1, 'a pull hands the first assignment to the page (as before)');

    // A second assignment reaches the server; before the trainee's next pull,
    // the trainee's device saves a record of its own (a submission) and pushes.
    instructor.set('voctrain_assignments', instructor.list('voctrain_assignments').concat(
      [{ id: 'ASN-2', title: 'Cooling System Worksheet', course: 'Marine', updatedAt: new Date().toISOString() }]));
    await instructor.api.saveNow();
    trainee.restored.length = 0;
    trainee.set('voctrain_submissions', [{ id: 'SUB-1', assignmentId: 'ASN-1', studentId: 'S-AMA', submittedAt: new Date().toISOString() }]);
    await trainee.api.saveNow();
    const ids = trainee.list('voctrain_assignments').map(a => a.id).sort().join(',');
    assert(ids === 'ASN-1,ASN-2', 'the push merged the new assignment into the trainee\'s storage (' + ids + ')');
    assert(trainee.restored.indexOf('voctrain_assignments') !== -1,
      'and told the page, so it reaches the screen — it used to be written to storage alone (restored: ' + JSON.stringify(trainee.restored) + ')');

    // Nothing is reported when a push brings nothing back.
    trainee.restored.length = 0;
    trainee.set('voctrain_submissions', trainee.list('voctrain_submissions').concat(
      [{ id: 'SUB-2', assignmentId: 'ASN-2', studentId: 'S-AMA', submittedAt: new Date().toISOString() }]));
    await trainee.api.saveNow();
    assert(trainee.restored.indexOf('voctrain_assignments') === -1, 'a push that brings nothing new reports nothing for that collection');
    const onServer = JSON.parse(JSON.parse(fs.readFileSync(path.join(DATA, LMS_SPEC.file), 'utf8')).data.voctrain_submissions).map(s => s.id).sort().join(',');
    assert(onServer === 'SUB-1,SUB-2', 'and the trainee\'s own records still reach the server (' + onServer + ')');

    console.log('An edit saved while a push is on its way is not replaced by that push');
    // The office PC adds a training centre; its push reads storage, and while
    // it is writing to the server the administrator saves the centre's dates.
    const office = device('admin', { id: 'U-ADM', username: 'admin' });
    await office.open();
    await wait(200);
    const centre = { id: 21, name: 'Welding & Fabrication', startDate: '', endDate: '', updatedAt: new Date().toISOString() };
    office.set('voctrain_skillAreas', [centre]);
    // Another device has meanwhile saved the Centre's other centres and a new
    // assignment, so the push has something of the server's to bring back —
    // in the very list being edited, too.
    instructor.set('voctrain_skillAreas', [{ id: 1, name: 'Welding & Fabrication', startDate: '', endDate: '', updatedAt: new Date().toISOString() }]);
    instructor.set('voctrain_assignments', instructor.list('voctrain_assignments').concat(
      [{ id: 'ASN-3', title: 'Third', course: 'Marine', updatedAt: new Date().toISOString() }]));
    await instructor.api.saveNow();
    office.restored.length = 0;
    office.duringPut = () => {
      office.set('voctrain_skillAreas', [Object.assign({}, centre, { startDate: '2026-09-01', endDate: '2027-03-31', updatedAt: new Date().toISOString() })]);
    };
    await office.api.saveNow();
    const kept = office.list('voctrain_skillAreas').find(c => c.id === 21) || {};
    assert(kept.startDate === '2026-09-01' && kept.endDate === '2027-03-31',
      'the dates saved during the push are still in storage (got ' + JSON.stringify([kept.startDate, kept.endDate]) + ')');
    assert(office.restored.indexOf('voctrain_skillAreas') === -1, 'and the page is not handed the older copy to adopt');
    assert(office.list('voctrain_assignments').some(a => a.id === 'ASN-3') && office.restored.indexOf('voctrain_assignments') !== -1,
      'while what the server contributed elsewhere is still brought back and reported');
    await office.api.saveNow();
    const srvList = JSON.parse(JSON.parse(fs.readFileSync(path.join(DATA, LMS_SPEC.file), 'utf8')).data.voctrain_skillAreas || '[]');
    const srvCentre = srvList.find(c => c.id === 21) || {};
    assert(srvCentre.startDate === '2026-09-01' && srvList.some(c => c.id === 1), 'and the next push carries the dates to the server, beside the other device\'s centre (got ' + JSON.stringify(srvCentre.startDate) + ')');
    assert(office.list('voctrain_skillAreas').some(c => c.id === 1), 'and brings that centre here');
  } catch (e) {
    failed++;
    console.error(e && e.stack || e);
  } finally {
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
