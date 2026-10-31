/* The rules the Centre's server keeps its records folder by, one at a time —
   and the launchers and certificate around it.

   What was wrong, and what each section pins:
     1. Saves shared one "<file>.tmp", so overlapping saves tore the file. Each
        save now has a temporary file of its own and is flushed before the
        rename; nothing is left behind.
     2. A save replaced the file wholesale; now it is MERGED into the stored
        copy by the same rules every device uses, and a file that is not a
        page backup (or a stored copy that cannot be read) is still simply
        replaced, as before.
     3. There was no history to recover a bad save from; the previous version
        is now kept, the newest HISTORY_KEEP of them.
     4. The access token changed on every restart; it is now kept.
     5. Old Node started the server and then failed every video class; it is
        now refused at start with a clear message.
     6. The launchers fell back to Python's web server — which served the
        records folder and the private key to the whole network — and on most
        Windows PCs merely opened the Microsoft Store. The fallback is gone and
        every launcher checks the Node version.
     7. The certificate is its own authority (so devices can trust it); it is
        now limited by name constraints to private addresses and this
        computer's names, so its key cannot vouch for a public website.
   And for the trainee gate (cestis-offline-gate.js): a save can read what is
   stored and decide what to write inside the file's queue, so no device's
   save lands between the gate's read and its write; and the token can be
   replaced (the staff-only switch), on the disk, not just in memory.

   Run: node tests/offline-store.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../cestis-offline-store.js');
const Core = require('../cestis-core.js');
const cert = require('../cestis-offline-cert.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-store-'));
const DATA = path.join(tmp, 'data');

(async () => {
  /* ---------- 1. Durable writes ---------- */
  console.log('A save is written whole, through a temporary file of its own');
  fs.mkdirSync(DATA, { recursive: true });
  const f = path.join(DATA, 'X.json');
  store.writeDurable(f, '{"a":1}');
  assert(fs.readFileSync(f, 'utf8') === '{"a":1}', 'the file holds exactly what was written');
  assert(fs.readdirSync(DATA).length === 1, 'and no temporary file is left behind');
  const src = fs.readFileSync(path.join(ROOT, 'cestis-offline-store.js'), 'utf8');
  assert(/randomBytes\(6\)/.test(src) && /fsyncSync/.test(src), 'each temporary name is unique, and flushed before the rename');

  /* ---------- 2. Merge, not replace ---------- */
  console.log('A save merges into the stored copy');
  const T1 = '2026-10-01T09:00:00.000Z', T2 = '2026-10-01T10:00:00.000Z';
  const pagefile = (list, stamp, extra) => Object.assign({ version: '1.0', page: 'P', file: 'P.json',
    stamps: { voctrain_examResults: stamp }, data: { voctrain_examResults: JSON.stringify(list) } }, extra || {});
  const P = path.join(DATA, 'P.json');
  await store.save({ file: P, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'R1' }, { id: 'R2' }], T1) });
  const r = await store.save({ file: P, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'R3' }], T2, { savedBy: 'lab-pc' }) });
  const stored = JSON.parse(fs.readFileSync(P, 'utf8'));
  assert(JSON.parse(stored.data.voctrain_examResults).map(x => x.id).join(',') === 'R1,R2,R3',
    'a newer save with fewer results keeps every result already stored');
  assert(stored.savedBy === 'lab-pc' && stored.keyCount === 1, 'and records who saved it');
  assert(r.changedByServer === true && /^"[a-f0-9]{40}"$/.test(r.etag), 'the reply says the server merged it, with the new ETag');
  // Concurrent saves are taken one at a time and none is lost.
  await Promise.all(['RA', 'RB', 'RC', 'RD'].map((id, i) => store.save({ file: P, dataDir: DATA, core: Core,
    incoming: pagefile([{ id }], '2026-10-02T0' + i + ':00:00.000Z') })));
  assert(JSON.parse(JSON.parse(fs.readFileSync(P, 'utf8')).data.voctrain_examResults).length === 7,
    'four saves at the same moment all land');
  // Not a page backup: replaced, as before.
  const Q = path.join(DATA, 'Q.json');
  await store.save({ file: Q, dataDir: DATA, core: Core, incoming: { a: 1, b: 2 } });
  await store.save({ file: Q, dataDir: DATA, core: Core, incoming: { a: 3 } });
  assert(fs.readFileSync(Q, 'utf8') === '{"a":3}', 'a file that is not a page backup is simply replaced');
  fs.writeFileSync(path.join(DATA, 'C.json'), '{ this is not json');
  await store.save({ file: path.join(DATA, 'C.json'), dataDir: DATA, core: Core, incoming: pagefile([{ id: 'Z' }], T1) });
  assert(JSON.parse(fs.readFileSync(path.join(DATA, 'C.json'), 'utf8')).data.voctrain_examResults === '[{"id":"Z"}]',
    'a stored copy that cannot be read is replaced rather than blocking every save');
  assert(fs.readdirSync(path.join(DATA, '.history', 'C.json')).length === 1,
    '— and the unreadable copy is kept in the history, not thrown away');
  const same = await store.save({ file: Q, dataDir: DATA, core: Core, incoming: { a: 3 } });
  assert(same.history === null, 'saving exactly what is already there writes nothing and keeps no extra version');

  // The trainee gate's save: read what is stored and decide, inside the queue.
  console.log('A save can decide from what is stored, with no other save in between');
  const G = path.join(DATA, 'G.json');
  await store.save({ file: G, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'G1' }], T1, { savedBy: 'office' }) });
  const seenBy = [];
  const decide = id => text => {
    const p = JSON.parse(text);
    seenBy.push(JSON.parse(p.data.voctrain_examResults).map(x => x.id).join(','));
    return { version: p.version, page: p.page, file: p.file, savedBy: p.savedBy,
      stamps: { voctrain_examResults: '2026-10-03T00:00:00.000Z' }, data: { voctrain_examResults: JSON.stringify([{ id }]) } };
  };
  await Promise.all([
    store.save({ file: G, dataDir: DATA, core: Core, incoming: decide('G2') }),
    store.save({ file: G, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'G3' }], '2026-10-02T00:00:00.000Z', { savedBy: 'lab-pc' }) }),
    store.save({ file: G, dataDir: DATA, core: Core, incoming: decide('G4') })
  ]);
  assert(seenBy.join(' / ') === 'G1 / G1,G2,G3', 'each one read the file as every earlier save had left it — ' + seenBy.join(' / '));
  const g = JSON.parse(fs.readFileSync(G, 'utf8'));
  assert(JSON.parse(g.data.voctrain_examResults).map(x => x.id).join(',') === 'G1,G2,G3,G4' && g.savedBy === 'lab-pc' && g.page === 'P',
    'every record landed, and the file kept what it said about itself');
  const before = fs.readFileSync(G, 'utf8');
  const nothing = await store.save({ file: G, dataDir: DATA, core: Core, incoming: () => null });
  assert(nothing.skipped === true && fs.readFileSync(G, 'utf8') === before, 'nothing to save writes nothing');
  let threw = null;
  await store.save({ file: G, dataDir: DATA, core: Core, incoming: () => { throw new Error('not now'); } }).catch(e => { threw = e; });
  assert(threw && threw.message === 'not now' && fs.readFileSync(G, 'utf8') === before, 'and a refusal fails the save, writing nothing');
  let gotText;
  await store.save({ file: path.join(DATA, 'NEW.json'), dataDir: DATA, core: Core, incoming: t => { gotText = t; return null; } });
  assert(gotText === null && !fs.existsSync(path.join(DATA, 'NEW.json')), 'a file not there yet is handed over as null');

  /* ---------- 3. History ---------- */
  console.log('Earlier versions are kept, up to a limit');
  const H = path.join(DATA, 'H.json');
  for (let i = 0; i < 6; i++) await store.save({ file: H, dataDir: DATA, core: null, incoming: { n: i }, keep: 3 });
  const kept = fs.readdirSync(path.join(DATA, '.history', 'H.json')).sort();
  assert(kept.length === 3, 'only the newest versions are kept (3 here, ' + store.HISTORY_KEEP + ' normally)');
  assert(JSON.parse(fs.readFileSync(path.join(DATA, '.history', 'H.json', kept[2]), 'utf8')).n === 4,
    'and the newest kept is the one just replaced, ready to copy back');

  /* ---------- 3b. One dated copy a week, for 12 weeks (OPS-1) ---------- */
  console.log('One dated copy of every file a week, kept for 12 weeks');
  const zlib = require('zlib');
  const W = path.join(DATA, 'W.json');
  const DAY = 86400000, mon = new Date(2026, 9, 26, 9).getTime();   // Monday of week 44
  assert(store.isoWeekLabel(mon) === '2026-W44' && store.isoWeekLabel(mon - DAY) === '2026-W43' && store.isoWeekLabel(new Date(2027, 0, 1, 12).getTime()) === '2026-W53',
    'weeks are ISO weeks, Monday to Sunday');
  await store.save({ file: W, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'W1' }], T1), now: mon });
  await store.weeklySettled(DATA, W);
  assert(store.weeklyCopies(DATA, W).length === 0, 'a file saved for the first time has nothing to copy yet');
  await store.save({ file: W, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'W2' }], T2), now: mon + 3600000 });
  await store.weeklySettled(DATA, W);
  let wk = store.weeklyCopies(DATA, W);
  assert(wk.join() === '2026-W44.json.gz', 'the first change of the week keeps a dated copy: ' + wk.join());
  const firstCopy = JSON.parse(store.readWeekly(DATA, W, wk[0]));
  assert(JSON.parse(firstCopy.data.voctrain_examResults).map(x => x.id).join() === 'W1', 'it is the file as it stood when the week\'s first change came in');
  assert(zlib.gunzipSync(fs.readFileSync(path.join(store.weeklyDir(DATA, W), wk[0]))).toString('utf8') === JSON.stringify(firstCopy), 'compressed, and readable with any unzip tool');
  await store.save({ file: W, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'W3' }], '2026-10-01T11:00:00.000Z'), now: mon + 2 * DAY });
  await store.weeklySettled(DATA, W);
  assert(store.weeklyCopies(DATA, W).length === 1 && JSON.parse(store.readWeekly(DATA, W, '2026-W44.json.gz')).data.voctrain_examResults === firstCopy.data.voctrain_examResults,
    'later changes the same week keep it as it was (one copy a week)');
  for (let i = 1; i <= 14; i++) {
    await store.save({ file: W, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'X' + i }], new Date(Date.parse('2026-10-01T12:00:00.000Z') + i * 60000).toISOString()), now: mon + i * 7 * DAY });
    await store.weeklySettled(DATA, W);
  }
  wk = store.weeklyCopies(DATA, W);
  assert(wk.length === 12, 'the newest 12 weeks are kept: ' + wk.length);
  assert(wk[0] === store.isoWeekLabel(mon + 3 * 7 * DAY) + '.json.gz' && wk[11] === store.isoWeekLabel(mon + 14 * 7 * DAY) + '.json.gz', 'older weeks are removed (' + wk[0] + ' … ' + wk[11] + ')');
  fs.writeFileSync(path.join(store.weeklyDir(DATA, W), 'keep me.txt'), 'notes');
  await store.save({ file: W, dataDir: DATA, core: Core, incoming: pagefile([{ id: 'Y' }], '2026-10-02T12:00:00.000Z'), now: mon + 15 * 7 * DAY });
  await store.weeklySettled(DATA, W);
  assert(fs.existsSync(path.join(store.weeklyDir(DATA, W), 'keep me.txt')), 'only weekly copies are ever removed from the folder');
  assert(store.weeklyCopies(DATA, W).length === 12 && JSON.parse(fs.readFileSync(W, 'utf8')).data.voctrain_examResults.indexOf('"W1"') !== -1,
    'and the records file itself still holds everything (the copies are extra)');
  assert(fs.readdirSync(path.dirname(store.weeklyDir(DATA, W))).every(f => !/\.tmp$/.test(f)), 'no temporary file is left behind');
  assert(store.WEEKLY_KEEP === 12, '12 weeks by default');
  const server2 = fs.readFileSync(path.join(ROOT, 'cestis-offline-server.js'), 'utf8');
  assert(/\.weekly/.test(server2) && /WEEKLY_KEEP/.test(server2), 'the server says so when it starts');
  assert(/ONE COPY A WEEK, FOR 12 WEEKS/.test(fs.readFileSync(path.join(ROOT, 'READ ME FIRST.txt'), 'utf8')), 'and READ ME FIRST says how to use one');

  /* ---------- 4. Token ---------- */
  console.log('The access token survives a restart');
  const CERT = path.join(tmp, 'cert');
  const t1 = store.loadOrCreateToken(CERT), t2 = store.loadOrCreateToken(CERT);
  assert(/^[a-f0-9]{48}$/.test(t1) && t1 === t2, 'the same token comes back every start');
  const t3 = store.rotateToken(CERT);
  assert(/^[a-f0-9]{48}$/.test(t3) && t3 !== t1, 'a rotated token is a new one');
  assert(store.loadOrCreateToken(CERT) === t3, 'and it is what the next start reads');
  assert(fs.readdirSync(CERT).join(',') === 'lan-token', 'with no temporary file left behind');
  if (process.platform !== 'win32') assert((fs.statSync(path.join(CERT, 'lan-token')).mode & 0o777) === 0o600, 'readable by this computer\'s owner only');

  /* ---------- 5. Node version ---------- */
  console.log('Old Node is refused at start');
  assert(store.nodeTooOld('8.10.0') && store.nodeTooOld('v12.22.1') && store.nodeTooOld(''), 'Node 8 or 12 is too old');
  assert(!store.nodeTooOld('14.0.0') && !store.nodeTooOld(process.versions.node), 'Node 14 and this one are fine');
  const server = fs.readFileSync(path.join(ROOT, 'cestis-offline-server.js'), 'utf8');
  assert(server.indexOf('nodeTooOld(process.versions.node)') !== -1 &&
         server.indexOf('nodeTooOld') < server.indexOf("require('http')"),
    'the server checks before it starts anything');

  /* ---------- 6. Launchers ---------- */
  console.log('The launchers never serve the folder to the network, and check Node');
  ['START-WINDOWS.bat', 'START-MAC.command', 'START-LINUX.sh'].forEach(l => {
    const s = fs.readFileSync(path.join(ROOT, l), 'utf8');
    const code = s.split('\n').filter(line => !/^\s*(rem |#)/i.test(line)).join('\n');
    assert(!/http\.server|SimpleHTTPServer|python/i.test(code), l + ' has no Python web server fallback');
    assert(/process\.versions\.node/.test(s) && />=14/.test(s), l + ' refuses Node older than 14');
    assert(/nodejs\.org/.test(s), l + ' says where to get Node');
  });
  assert(/"node": ">=14"/.test(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), 'package.json says Node 14 too');

  /* ---------- 7. Certificate ---------- */
  console.log('The certificate cannot vouch for a public website');
  const names = { dns: ['localhost', 'office-pc', 'office-pc.local'], ips: ['127.0.0.1', '::1', '192.168.1.24', '100.64.3.2'] };
  const cfg = cert.opensslConfig(names);
  const nc = (cfg.match(/^nameConstraints = .*$/m) || [''])[0];
  assert(/^nameConstraints = critical,permitted;/.test(nc), 'it carries critical name constraints');
  ['IP:10.0.0.0/255.0.0.0', 'IP:172.16.0.0/255.240.0.0', 'IP:192.168.0.0/255.255.0.0', 'DNS:localhost', 'DNS:.local',
   'DNS:office-pc', 'IP:100.64.3.2/255.255.255.255'].forEach(p => {
    assert(nc.indexOf('permitted;' + p) !== -1, 'it permits ' + p);
  });
  assert(!/excluded|DNS:\.com|IP:0\.0\.0\.0/.test(nc), 'and nothing public');
  assert(!/nameConstraints/.test(cert.opensslConfig(names, false)),
    'an openssl too old for the constraints still gets a certificate (without them) rather than none');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
