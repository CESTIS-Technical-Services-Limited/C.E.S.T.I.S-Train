/* The administrator of a brand-new Centre can host a class after setting their
   own password — the host ticket is asked for only once the Centre's server
   holds that password, and never with the published default.

   What happened (the end-to-end flow test, step E, on the Offline System):
   the first administrator signs in with the published first-run password and
   is made to set their own. forceChangePwSubmit() then asked the Centre's
   server for a host ticket (POST /_cestis/host-ticket) with the NEW password —
   but the server checks it against the accounts IT holds, and the new
   password only reaches it with the device's next save, a second and a half
   later. So: 403. The sign-in then carried on (the continuation
   publishedDefaultGate was given) and asked again with the password that had
   been typed to get there — the published default, which the server refuses
   outright: 403 again. Two "Failed to load resource" errors on the console,
   and no ticket: the administrator could not host a class until they signed
   out and in again.

   And asking at the right moment was not enough on its own: the record-level
   merge of the accounts (CESTISCore.pageCloud, the same merge the server runs)
   filled the fields the newer copy lacked from the older one — and the newer
   copy had just DROPPED defaultPassword:true. So the password the
   administrator set came back marked "still the published default", and the
   server, which never trusts a seed, kept refusing it. The marker now travels
   with the password it describes.

   Pinned here, against the REAL Offline System server on a scratch data
   folder (cestis-offline-server.js, which checks the password itself — that
   check is not weakened), one "device" running the real cestis-core.js,
   cestis-page-cloud.js and cestis-offline-rtc.js, and the dashboard's real
   handleAdminClick(), publishedDefaultGate(), openForceChangePw(),
   forceChangePwSubmit(), lanHostTicket() and lanHostTicketAfterSave()
   extracted from index.html:
     - the first-run sign-in ends with a host ticket in this tab;
     - every ticket request the server answered was accepted (no 403);
     - no request ever carried a published default password;
     - when the server cannot be reached at the moment of the change, the
       ticket is asked for once the next save does reach it.

   Run: node tests/lan-host-ticket-first-run.test.js */
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
const RTC_SRC = fs.readFileSync(path.join(ROOT, 'cestis-offline-rtc.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const POLICY_SRC = (function () {
  const i = INDEX.indexOf('CESTISPageCloud.setAuthorPolicy(function (key) {');
  if (i === -1) throw new Error('index.html no longer sets the LAN author policy');
  return INDEX.slice(i, INDEX.indexOf('});', i) + 3);
})();
const LMS_SPEC = (function () {
  const m = /CESTISPageCloud\.initLan\(\{\s*page: '([^']+)',\s*file: '([^']+)',\s*prefixes: \[([^\]]*)\],\s*keys: \[([^\]]*)\]/.exec(INDEX);
  if (!m) throw new Error('index.html no longer registers the dashboard with initLan');
  const list = s => s.split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return { page: m[1], file: m[2], prefixes: list(m[3]), keys: list(m[4]) };
})();
const PAGE_FNS = ['_bufToHex', 'hashPasswordLegacy', '_pbkdf2Hex', 'hashPassword', 'cachePlaintextPw', 'stripSecretFields',
  'touchAccount', 'persistUserAccounts', 'saveUserAccounts', 'publishedDefaultGate', 'openForceChangePw',
  'forceChangePwSubmit', 'lanHostTicket', 'lanHostTicketAfterSave', 'handleAdminClick']
  .map(n => extractFunction(INDEX, n)).join('\n');

/* ------------------------------------------------------------ the server */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cestis-ticket-'));
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

/* ------------------------------------------------------------ the office PC */
const SEED = 'cestisadmin123$';
const NEW_PW = 'Centre-Admin-2026!';
function device() {
  const map = new Map(), session = new Map();
  const log = { tickets: [], ticketBodies: [], down: false };
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', style: {}, textContent: '', classList: { add() {}, remove() {} }, focus() {} });
  const ctx = {
    console: { log() {}, warn() {}, error: console.error }, JSON, Date, Math, Promise, Object, Array, String, Number, Boolean, RegExp, Error, Map, Set,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, TextEncoder, Uint8Array, crypto: globalThis.crypto,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    location: { protocol: 'http:', hostname: '127.0.0.1', port: String(PORT) },
    fetch: (u, o) => {
      if (log.down && u.indexOf('/_cestis/data/') === 0) return Promise.reject(new Error('the server is out of reach'));
      return fetch('http://127.0.0.1:' + PORT + u, o).then(r => {
        if (u === '/_cestis/host-ticket') { log.tickets.push(r.status); log.ticketBodies.push(String(o && o.body || '')); }
        return r;
      });
    },
    addEventListener: () => {},
    sessionStorage: { getItem: k => (session.has(k) ? session.get(k) : null), setItem: (k, v) => { session.set(k, String(v)); } },
    document: { getElementById: el },
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
  vm.runInContext(RTC_SRC, ctx);
  vm.runInContext(
    // The dashboard's globals and the sign-in's neighbours this test does not exercise.
    'var currentRole = null, currentLoggedInUser = null, _sessionWiped = false, loginSyncCompleted = true;' +
    'var adminLoginShown = true, _forceChangePwRole = null, _forceChangePwThen = null, entered = [], twoStep = 0;' +
    'var PBKDF2_ITERATIONS = 1000, KNOWN_DEFAULT_PASSWORDS = ["cestisadmin123$", "admin123"];' +
    'var userAccounts = [{ id: "USR-001", name: "Administrator", role: "admin", username: "cestisadmin", password: "cestisadmin123$",' +
    '  defaultPassword: true, email: "admin@heartlms.edu.jm", status: "active", createdAt: "2026-01-01" }];' +
    'function requireLoginSync() { return false; } function checkLoginRateLimit() { return { allowed: true }; }' +
    'async function findLoginAccount(role, u) { return userAccounts.find(a => a.username === u) || null; }' +
    'function loginBlocked() { return false; } async function checkPasswordWithCloud() { return true; }' +
    'function recordLoginFailure() {} function clearLoginFailures() {} function alert(m) { throw new Error("alert: " + m); }' +
    'function tfaGateLogin(acct, go) { twoStep++; go(); } function enterApp(role) { currentRole = role; entered.push(role); }' +
    'function openModal() {} function closeModal() {} function showToast() {}' +
    'function scheduleAccountsLedgerSave() {} function scheduleDebouncedCloudSave() {}' +
    'function dropDeletedAccounts() {}' + PAGE_FNS + POLICY_SRC, ctx);
  return { ctx, map, log, el, api: ctx.CESTISPageCloud,
    ticket: () => { try { return JSON.parse(session.get('cestisLanHostTicket') || 'null'); } catch (e) { return null; } } };
}
async function until(pred, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) { if (pred()) return true; await wait(50); }
  return !!pred();
}
async function firstRun(d) {
  d.el('adminUser').value = 'cestisadmin';
  d.el('adminPass').value = SEED;
  await vm.runInContext('handleAdminClick()', d.ctx);
  assert(typeof d.ctx._forceChangePwThen === 'function', 'the published password only leads to "set a new password"');
  d.el('forceChangePwNew').value = NEW_PW;
  d.el('forceChangePwConfirm').value = NEW_PW;
  await vm.runInContext('forceChangePwSubmit()', d.ctx);
  assertEq(d.ctx.entered.join(','), 'admin', 'and the sign-in carries on into the administrator\'s pages');
}

(async () => {
  try {
    await startServer();

    /* ---------- 1. A brand-new Centre: the first administrator ---------- */
    console.log('A brand-new Centre: the first administrator sets a password and holds a host ticket');
    const office = device();
    assert(await office.api.lan(), 'the page finds the Centre\'s server');
    office.ctx.CESTISStore.setItem('voctrain_users', JSON.stringify(office.ctx.userAccounts));
    await office.api.initLan(Object.assign({}, LMS_SPEC, { onRestore: () => {} }));
    await office.api.saveNow();                         // Sync Now: the server holds the seeded login
    await firstRun(office);
    assert(await until(() => !!office.ticket()), 'this tab holds a host ticket once the new password has reached the server');
    assertEq((office.ticket() || {}).uid, 'USR-001', 'issued to the administrator');
    assert(office.log.tickets.length >= 1, 'the server was asked (' + office.log.tickets.join(',') + ')');
    assert(office.log.tickets.every(s => s === 200), 'and never refused: no 403 for the console (' + office.log.tickets.join(',') + ')');
    assert(office.log.ticketBodies.every(b => b.indexOf(SEED) === -1 && b.indexOf('admin123') === -1),
      'no ticket request ever carried a published default password');
    await wait(300);
    assertEq(office.log.tickets.length, 1, 'exactly one request — the continuation does not ask again with the default');

    /* ---------- 2. The server out of reach at the moment of the change ---------- */
    console.log('The server out of reach when the password is set: the ticket follows the next save that lands');
    await stopServer();
    fs.rmSync(DATA, { recursive: true, force: true });
    await startServer();
    const lab = device();
    assert(await lab.api.lan(), 'the page finds the Centre\'s server');
    lab.ctx.CESTISStore.setItem('voctrain_users', JSON.stringify(lab.ctx.userAccounts));
    await lab.api.initLan(Object.assign({}, LMS_SPEC, { onRestore: () => {} }));
    await lab.api.saveNow();
    lab.log.down = true;                                 // saves cannot reach it for now
    await firstRun(lab);
    await wait(2200);                                    // past the debounced save, which fails too
    assertEq(lab.ticket(), null, 'no ticket while the new password is not on the server');
    assertEq(lab.log.tickets.length, 0, 'and nothing was sent that the server could only refuse');
    lab.log.down = false;
    await lab.api.saveNow();                             // the next save gets through
    assert(await until(() => !!lab.ticket()), 'the ticket is asked for, and given, once a save has landed');
    assert(lab.log.tickets.length === 1 && lab.log.tickets[0] === 200, 'one request, accepted (' + lab.log.tickets.join(',') + ')');

    /* ---------- 3. The merge keeps the marker with its password ---------- */
    console.log('A merge never puts the seed marker back on a password somebody set');
    const C = office.ctx.CESTISCore.pageCloud;
    const seed = { id: 'USR-001', role: 'admin', username: 'cestisadmin', password: SEED, defaultPassword: true, updatedAt: '2026-10-01T00:00:00Z' };
    const real = { id: 'USR-001', role: 'admin', username: 'cestisadmin', password: 'pbkdf2$1000$aa$bb', updatedAt: '2026-10-02T00:00:00Z' };
    const viaLocal = C.mergeKeys({ voctrain_users: JSON.stringify([real]) }, { voctrain_users: real.updatedAt },
      { voctrain_users: JSON.stringify([seed]) }, { voctrain_users: seed.updatedAt }, { records: true });
    const viaCloud = C.mergeKeys({ voctrain_users: JSON.stringify([seed]) }, { voctrain_users: seed.updatedAt },
      { voctrain_users: JSON.stringify([real]) }, { voctrain_users: real.updatedAt }, { records: true });
    [viaLocal, viaCloud].forEach((m, i) => {
      const a = JSON.parse(m.data.voctrain_users)[0];
      assert(a.password === real.password && a.defaultPassword === undefined,
        (i ? 'pulled' : 'pushed') + ': the newer, real password carries no seed marker (' + JSON.stringify(a) + ')');
    });
    const same = C.mergeKeys({ voctrain_users: JSON.stringify([Object.assign({}, seed, { defaultPassword: undefined, updatedAt: '2026-10-03T00:00:00Z' })]) },
      { voctrain_users: '2026-10-03T00:00:00Z' }, { voctrain_users: JSON.stringify([seed]) }, { voctrain_users: seed.updatedAt }, { records: true });
    assertEq(JSON.parse(same.data.voctrain_users)[0].defaultPassword, true, 'while the same seeded password keeps its marker');

    /* ---------- 4. The server's own check is unchanged ---------- */
    console.log('The server still checks the password itself');
    const tok = await (await fetch('http://127.0.0.1:' + PORT + '/_cestis/token')).json();
    const ask = pw => fetch('http://127.0.0.1:' + PORT + '/_cestis/host-ticket', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CESTIS-Token': tok.token }, body: JSON.stringify({ username: 'cestisadmin', password: pw }) });
    assertEq((await ask('not-the-password')).status, 403, 'a wrong password is refused');
    assertEq((await ask(SEED)).status, 403, 'the published default is refused');
    assertEq((await ask(NEW_PW)).status, 200, 'the password the administrator set is accepted');
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
