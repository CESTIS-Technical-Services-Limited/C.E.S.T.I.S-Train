/* The Offline System's shared store, end to end: real server, real page-cloud,
   real merge, several devices — and a trainee signing out.

   Once the offline dashboard's saves were made to persist again (its
   saveState() had been calling a function its copy never defined), the way the
   LAN sync merged became able to wipe the Centre's records:
     - a trainee signing out trims that device's copy of the roll, the exam
       results, the attendance and the profiles to their own — and the trimmed
       lists, being the newest writes, replaced the Centre's on the server and
       then on every device that pulled;
     - two devices saving in the same moment: the later whole value won and
       the other device's records were gone;
     - the server restarting gave it a new access token and every open page
       then failed every save, silently, while saying it was connected;
     - who was signed in on a device (voctrain_session*) travelled to every
       other device with everything else — and, after that was closed for the
       role and the user, the session's heartbeat (voctrain_sessionSeenAt) and
       trainee still did: one device's heartbeat refreshed every other
       device's, so a lab PC under the idle lock still read as "open" to the
       record pages. This browser's other markers (work not yet uploaded, its
       id in the certificate download count) travelled the same way.

   What this runs: the real Offline System server (cestis-offline-server.js) on
   a scratch data folder, and several "devices" — each a separate VM context
   with its own storage, running the real cestis-core.js and
   cestis-page-cloud.js, registered exactly as index.html registers the
   dashboard, with the dashboard's real author policy and its real
   clearSensitiveStudentData() extracted from index.html.

   Run: node tests/lan-page-cloud.test.js */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

const ROOT = path.join(__dirname, '..');
const OFF = path.join(ROOT, 'Offline System');
const CORE_SRC = fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8');
const PC_SRC = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp('function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const CLEAR_SRC = extractFunction(INDEX, 'clearSensitiveStudentData');
const POLICY_SRC = (function () {
  const i = INDEX.indexOf('CESTISPageCloud.setAuthorPolicy(function (key) {');
  if (i === -1) throw new Error('index.html no longer sets the LAN author policy');
  const j = INDEX.indexOf('});', i);
  return INDEX.slice(i, j + 3);
})();
const LMS_SPEC = (function () {
  const m = /CESTISPageCloud\.initLan\(\{\s*page: '([^']+)',\s*file: '([^']+)',\s*prefixes: \[([^\]]*)\],\s*keys: \[([^\]]*)\]/.exec(INDEX);
  if (!m) throw new Error('index.html no longer registers the dashboard with initLan');
  const list = s => s.split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return { page: m[1], file: m[2], prefixes: list(m[3]), keys: list(m[4]) };
})();

/* ------------------------------------------------------------ the server */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-lan-'));
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
const onServer = file => { try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return null; } };
const serverList = (file, key) => { const p = onServer(file); return p && p.data && p.data[key] ? JSON.parse(p.data[key]) : null; };

/* ------------------------------------------------------------ a device */
function device(name, opts) {
  opts = opts || {};
  const map = new Map();
  const log = { statuses: [], fetches: 0, restored: [] };
  const ctx = {
    console, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
    setTimeout, clearTimeout,
    setInterval: () => 0,                  // the test drives refreshes itself (loadNow)
    location: opts.location || { protocol: 'http:', hostname: '127.0.0.1', port: String(PORT) },
    fetch: opts.fetch || ((u, o) => {
      log.fetches++;
      return fetch('http://127.0.0.1:' + PORT + u, o).then(r => { log.statuses.push(r.status + ' ' + u); return r; });
    }),
    addEventListener: () => {},
    indexedDB: { deleteDatabase: () => {} },
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
  // The dashboard's globals the author policy and the sign-out read.
  vm.runInContext('var currentRole = ' + JSON.stringify(opts.role || 'admin') + ', currentLoggedInUser = ' +
    JSON.stringify(opts.user || { id: 'U-ADMIN', username: 'admin' }) + ', _sessionWiped = false, currentStudent = null;' +
    'var students = [], examResults = [], studentProfiles = {}, attendanceRecords = [];' +
    'function adminStaffAccessDefaults() { return {}; }' + CLEAR_SRC + POLICY_SRC, ctx);
  const api = ctx.CESTISPageCloud;
  return {
    name, ctx, map, log, api,
    get: k => (map.has(k) ? map.get(k) : null),
    list: k => JSON.parse(map.get(k) || '[]'),
    set: (k, v) => ctx.CESTISStore.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)),
    open: () => api.initLan(Object.assign({}, LMS_SPEC, { onRestore: keys => log.restored.push.apply(log.restored, keys) }))
  };
}

const ids = list => (list || []).map(r => r.id).sort().join(',');

(async () => {
  try {
    await startServer();
    const DASH = LMS_SPEC.file, ALL = 'CESTIS_ALL_DATA.json';

    /* ---------- 1. The office PC sets up the Centre ---------- */
    console.log('The office PC saves the Centre\'s records to its own server');
    const office = device('office');
    assert(await office.api.lan(), 'the page finds the Centre\'s server');
    await office.open();
    await wait(200);
    const roll = [{ id: 'S1', name: 'Ann', course: 'Welding' }, { id: 'S2', name: 'Bob', course: 'Welding' },
                  { id: 'S3', name: 'Cy', course: 'Plumbing' }];
    office.set('voctrain_students', roll);
    office.set('voctrain_examResults', [{ id: 'R1', examId: 'E1', studentId: 'S1', submittedAt: '2026-10-01T09:00:00Z' },
      { id: 'R2', examId: 'E1', studentId: 'S2', submittedAt: '2026-10-01T09:00:00Z' },
      { id: 'R3', examId: 'E1', studentId: 'S3', submittedAt: '2026-10-01T09:00:00Z' }]);
    office.set('voctrain_attendance', roll.map(s => ({ studentId: s.id, studentName: s.name, date: '2026-10-01', days: { Mon: 'present' } })));
    office.set('voctrain_studentProfiles', { U1: { phone: '1' }, U2: { phone: '2' }, U3: { phone: '3' } });
    office.set('voctrain_systemSettings', { institutionName: 'CESTIS' });
    office.set('voctrain_sessionRole', 'admin');
    office.set('voctrain_examInProgress', '{"examId":"E1"}');
    office.set('cestisExamSession__S1__E1', { answers: { q1: 'B' } });
    office.set('cestisExamOutbox', [{ id: 'R9' }]);
    office.set('voctrain_user_U1_chat', { dm: 'private' });
    const THIS_BROWSER = { voctrain_sessionSeenAt: '1700000000000', voctrain_sessionStudentId: 'S9', voctrain_sessionUserId: 'U-ADMIN',
      voctrain_sessionExpiry: '1800000000000', cestisPendingUpload: 'true', cestisUnsyncedOnSignOut: '1',
      cestisCertDeviceSessionId: 'D-office', voctrain_supportSendLog: '[1]', voctrain_extSysCertHelpSeen_tms: '1',
      vcChatHistory_ROOM1: '[{"text":"hi","isLocal":true}]' };
    Object.keys(THIS_BROWSER).forEach(k => office.set(k, THIS_BROWSER[k]));
    await office.api.saveNow();
    assertEq(ids(serverList(DASH, 'voctrain_students')), 'S1,S2,S3', 'the dashboard file holds the roll');
    assertEq(ids(serverList(ALL, 'voctrain_examResults')), 'R1,R2,R3', 'and the whole-store mirror holds the results');
    const dash = onServer(DASH);
    assert(!('voctrain_sessionRole' in dash.data) && !('voctrain_examInProgress' in dash.data),
      'who is signed in HERE, and an exam half-way through, never leave the device');
    assert(!('voctrain_sessionRole' in onServer(ALL).data), 'not even through the whole-store mirror');
    ['cestisExamSession__S1__E1', 'cestisExamOutbox', 'voctrain_user_U1_chat'].forEach(k => {
      assert(!(k in onServer(ALL).data) && !(k in dash.data),
        k + ' (a trainee\'s answers, or one user\'s private messages) stays on the PC that wrote it');
    });
    Object.keys(THIS_BROWSER).forEach(k => {
      assert(!(k in onServer(ALL).data) && !(k in dash.data), k + ' describes this browser, so it stays on this browser');
    });

    /* ---------- 2. A trainee signs in on a lab PC, then out ---------- */
    console.log('A trainee signs in on a lab PC and out again');
    const lab = device('lab', { role: 'student', user: { id: 'U1', username: 'ann' } });
    await lab.open();
    await wait(300);
    assertEq(ids(lab.list('voctrain_students')), 'S1,S2,S3', 'the lab PC has the roll after its first pull');
    assertEq(lab.get('voctrain_sessionRole'), null, 'and has NOT been signed in as the office PC\'s administrator');
    Object.keys(THIS_BROWSER).forEach(k => assertEq(lab.get(k), null, 'nor taken the office PC\'s ' + k));
    // The lab PC's own session beats; the office PC's goes on beating.
    lab.set('voctrain_sessionSeenAt', '1700000500000');
    office.set('voctrain_sessionSeenAt', '1700000999000');
    await office.api.saveNow(); await lab.api.saveNow();
    await lab.api.loadNow(); await office.api.loadNow();
    assertEq(lab.get('voctrain_sessionSeenAt'), '1700000500000', 'one device\'s heartbeat never refreshes another\'s');
    assertEq(office.get('voctrain_sessionSeenAt'), '1700000999000', 'in either direction');
    // A server file written by an older version still holds a heartbeat: it is not adopted.
    {
      const file = path.join(DATA, DASH), before = fs.readFileSync(file, 'utf8'), p = JSON.parse(before);
      p.data.voctrain_sessionSeenAt = '1999999999999'; p.stamps.voctrain_sessionSeenAt = '2099-01-01T00:00:00Z';
      p.data.cestisPendingUpload = 'true'; p.stamps.cestisPendingUpload = '2099-01-01T00:00:00Z';
      fs.writeFileSync(file, JSON.stringify(p));
      const fresh = device('fresh', { role: 'student', user: { id: 'U2', username: 'bob' } });
      await fresh.open();
      await wait(300);
      assertEq(fresh.get('voctrain_sessionSeenAt'), null, 'a heartbeat already on the server is never taken by a device');
      assertEq(fresh.get('cestisPendingUpload'), null, 'nor another device\'s "not yet uploaded" marker');
      fs.writeFileSync(file, before);                   // the rest of this test reads the server as it was
    }
    // The trainee's device writes a Centre-wide setting (every saveState does).
    lab.set('voctrain_systemSettings', { institutionName: 'Hacked by a trainee' });
    vm.runInContext('currentStudent = { id: "S1", name: "Ann" };' +
      'students = JSON.parse(CESTISStore.getItem("voctrain_students"));' +
      'examResults = JSON.parse(CESTISStore.getItem("voctrain_examResults"));' +
      'attendanceRecords = JSON.parse(CESTISStore.getItem("voctrain_attendance"));' +
      'studentProfiles = JSON.parse(CESTISStore.getItem("voctrain_studentProfiles"));' +
      'clearSensitiveStudentData();', lab.ctx);
    assertEq(ids(lab.list('voctrain_students')), 'S1', 'the sign-out trims the lab PC\'s roll to Ann (its purpose)');
    await wait(2600);                       // the debounced push (1.5 s) after the trim
    assertEq(ids(serverList(DASH, 'voctrain_students')), 'S1,S2,S3', 'the server STILL holds the whole roll');
    assertEq(ids(serverList(DASH, 'voctrain_examResults')), 'R1,R2,R3', 'and every exam result');
    assertEq((serverList(DASH, 'voctrain_attendance') || []).length, 3, 'and the whole register');
    assertEq(Object.keys(JSON.parse(onServer(DASH).data.voctrain_studentProfiles)).length, 3, 'and every profile');
    assertEq(ids(serverList(ALL, 'voctrain_students')), 'S1,S2,S3', 'the whole-store mirror too');
    assertEq(JSON.parse(onServer(DASH).data.voctrain_systemSettings).institutionName, 'CESTIS',
      'a trainee\'s device never publishes a Centre-wide setting');
    await office.api.loadNow();
    assertEq(ids(office.list('voctrain_students')), 'S1,S2,S3', 'the office PC\'s next refresh still has everybody');

    /* ---------- 3. Two devices save in the same moment ---------- */
    console.log('Two trainees submit in the same moment on two PCs');
    const pcA = device('pcA', { role: 'student', user: { id: 'U2', username: 'bob' } });
    const pcB = device('pcB', { role: 'student', user: { id: 'U3', username: 'cy' } });
    await pcA.open(); await pcB.open();
    await wait(300);
    pcA.set('voctrain_examResults', pcA.list('voctrain_examResults').concat([{ id: 'RA', examId: 'E2', studentId: 'S2', submittedAt: '2026-10-02T10:00:00Z' }]));
    pcB.set('voctrain_examResults', pcB.list('voctrain_examResults').concat([{ id: 'RB', examId: 'E2', studentId: 'S3', submittedAt: '2026-10-02T10:00:01Z' }]));
    await Promise.all([pcA.api.saveNow(), pcB.api.saveNow()]);
    assertEq(ids(serverList(DASH, 'voctrain_examResults')), 'R1,R2,R3,RA,RB', 'both submissions are on the server');
    assertEq(ids(serverList(ALL, 'voctrain_examResults')), 'R1,R2,R3,RA,RB', 'and in the whole-store mirror');
    office.log.restored.length = 0;
    await office.api.loadNow();
    assertEq(ids(office.list('voctrain_examResults')), 'R1,R2,R3,RA,RB', 'the office PC\'s refresh brings both down');
    assert(office.log.restored.indexOf('voctrain_examResults') !== -1,
      'and tells the page (onRestore), so the screen — and the copy it saves — is not stale');

    /* ---------- 4. Deleting is a tombstone, and it travels ---------- */
    console.log('A deletion travels to every device');
    office.set('voctrain_deletedStudentIds', ['S3']);
    office.set('voctrain_students', roll.slice(0, 2));
    await office.api.saveNow();
    await pcA.api.loadNow();
    assertEq(ids(pcA.list('voctrain_students')), 'S1,S2', 'a trainee deleted at the office is gone on the other PCs');
    assertEq(ids(serverList(DASH, 'voctrain_students')), 'S1,S2', 'and on the server');

    /* ---------- 5. Nothing changed: the refresh is a "not modified" ---------- */
    console.log('An idle refresh costs almost nothing');
    office.log.statuses.length = 0;
    await office.api.loadNow();
    const gets = office.log.statuses.filter(s => /_cestis\/data\//.test(s));
    assert(gets.length > 0 && gets.every(s => /^304 /.test(s)), 'every file answers 304 when nothing moved (' + gets.join('; ') + ')');

    /* ---------- 6. History ---------- */
    console.log('Every replace keeps the previous version');
    const hist = path.join(DATA, '.history', DASH);
    const versions = fs.existsSync(hist) ? fs.readdirSync(hist).length : 0;
    assert(versions >= 3, 'data/.history holds earlier versions of the dashboard file (' + versions + ')');
    assert(!fs.readdirSync(DATA).some(f => /\.tmp$/.test(f)), 'and no temporary file is left behind');

    /* ---------- 7. The server restarts ---------- */
    console.log('The server restarts while pages are open');
    await stopServer();
    office.set('voctrain_announcements', [{ id: 'AN1', title: 'Server down' }]);
    await office.api.saveNow();
    assert(office.api.status().some(s => s.error), 'a save while the server is down is reported, not silently "connected"');
    await startServer();
    office.set('voctrain_announcements', [{ id: 'AN1', title: 'Back' }]);
    await office.api.saveNow();
    assert(office.api.status().every(s => !s.error), 'after a restart the same open page saves again (token kept)');
    assertEq((serverList(DASH, 'voctrain_announcements') || [])[0].title, 'Back', 'and the save arrived');
    // Even if the token DID change (its file deleted), the open page recovers by itself.
    await stopServer();
    fs.unlinkSync(path.join(CERT, 'lan-token'));
    await startServer();
    office.set('voctrain_announcements', [{ id: 'AN1', title: 'New token' }]);
    await office.api.saveNow();
    assertEq((serverList(DASH, 'voctrain_announcements') || [])[0].title, 'New token',
      'a page opened before a token change fetches the new token and carries on');

    /* ---------- 8. Online, none of this exists ---------- */
    console.log('Online (GitHub Pages) the LAN code does nothing at all');
    let calls = 0;
    const online = device('online', { location: { protocol: 'https:', hostname: 'cestis.github.io', port: '' },
      fetch: () => { calls++; return Promise.reject(new Error('no network in this test')); } });
    assertEq(await online.api.lan(), false, 'it is not the Centre\'s server');
    assertEq(await online.open(), null, 'the dashboard does not register a shared store');
    assertEq(calls, 0, 'and not one request was made to find out');
    const elsewhere = device('elsewhere', { location: { protocol: 'https:', hostname: 'example.org', port: '' },
      fetch: () => { calls++; return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }); } });
    assertEq(await elsewhere.api.lan(), false, 'a host where /_cestis/health is a 404 is not the Centre\'s server either');
    assertEq(calls, 1, 'one probe, once');
  } catch (e) {
    failed++;
    console.error(e && e.stack || e);
  } finally {
    await stopServer();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
