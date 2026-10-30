/* The trainee gate's staff side: each trainee's own records are published,
   and what trainees send is collected — and with the gate off, nothing at
   all happens.

   docs/trainee-gate/DESIGN.md Stage 3. Once an administrator has set up
   "Trainee sign-in from anywhere" and turned it on, every staff computer
   signed in for syncing publishes, beside its 5-second save, the trainees'
   records (one file per trainee, in a folder named "<Name> (<student ID>)"
   and found by their account), the papers and answer keys of their exams,
   and their chat rooms; and every minute collects what trainees sent.

   The real page functions are taken out of index.html and run here, each
   "computer" in a sandbox of its own (its own storage, its own page state),
   all of them writing through Drive's own calls (gateDriveApi's fetch) to
   ONE in-memory stand-in for the Centre's shared files
   (tests/browser/fake-drive.js). Pinned:

     - with the gate not set up, turned off, on a trainee's session, or with
       no sync sign-in: not one request, nothing written, at all;
     - the build, done a trainee at a time with a pause every 25, gives
       exactly CESTISCore.gate.buildAll's records, papers, keys and rooms, and
       reads nothing outside GATE_STORE_KEYS;
     - the first publish: every trainee gets a folder named with their name
       and student ID, found by the account in its description, holding their
       records; answer keys are written before papers, papers before
       trainees' records, those before rooms; every file says what it is and
       what it holds (appProperties: kind, account or exam, hash, stamp);
     - the throttle: at most 120 writes a turn, at least 500 ms apart;
     - a closed tab resumes: what was written is not written again, the rest
       is, nothing is doubled — even when the tab closed before it noted its
       last write;
     - two staff PCs (publishDecision): the second PC writes nothing over
       the same records; a PC that has seen less never writes over one that
       has seen more; two PCs that differ at the same moment settle on one
       copy and never take turns;
     - a trainee renamed (a new student ID): their folder is renamed and
       their records updated in place — no second folder; a folder still
       named as before (the student ID alone) is renamed to the new pattern;
     - two PCs making the same trainee's folder at once: the oldest is the
       one, on both; the younger is marked, never deleted or trashed, and
       what a trainee sent into it is still collected;
     - collecting: a trainee's inbox merged once (a second turn merges
       nothing), the request queue gets a withdrawn request, a read mark is
       applied, a merge that fails leaves everything to be read again, work
       for an account that is gone waits for a decision and is collected
       once the account is back, and a stray file is ignored;
     - the card's wording and the trainees' sign-in link (#gate=…), and the
       office request queue shows a withdrawn request;
     - registrations from home (§17): one query, collected once into the
       accounts list as a pending, email-verified trainee account carrying
       the gate's folder; never over an account the office has, never back
       after a deletion, never a second account on an address; the folder
       the gate made is taken on (never a second one) and kept marked while
       it waits, standard once approved (the records written into it), and
       marked "rejected" — not deleted — when turned down; the programmes
       taking trainees are published for the form; an account the office
       just made is published at once (gatePublishSoon).

   Run: node tests/gate-publisher.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const { makeCentre, NOW, DAY, iso, crypto: gcrypto } = require('./gate-fixture.js');
const { FakeDrive } = require('./browser/fake-drive.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } return !!cond; }
function assertEq(actual, expected, msg) {
  return assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function extractFunction(src, name) {
  let start = src.indexOf('\nfunction ' + name + '(');
  let lead = 1;
  const a = src.indexOf('\nasync function ' + name + '(');
  if (a !== -1 && (start === -1 || a < start)) { start = a; lead = 1; }
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  start += lead;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
// `var NAME = …;` — up to the first ; outside brackets, strings and comments.
function extractVar(src, name) {
  const start = src.indexOf('\nvar ' + name + ' = ');
  if (start < 0) throw new Error('index.html no longer declares ' + name);
  let depth = 0, q = null;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    else if (c === ';' && !depth) return src.slice(start + 1, i + 1);
  }
  throw new Error('could not read ' + name);
}
const VARS = ['GATE_STAFF_ROLES', 'GATE_CONFIG_FILE', 'GATE_FOLDER_MIME', 'GATE_EXPECTED_VERSION', 'GATE_LIMITS', 'GATE_STORE_KEYS', '_gateRun', 'GATE_REASON_TEXT'];
const FUNCS = ['gateDevRead', 'gateDevWrite', 'gatePublishedState', 'gateCollectedState', 'gateFolderDescription', 'gateFolderAcct',
  'gateFileName', 'gateFileProps', 'gateIndexListing', 'gateBuild', 'gatePlan', 'gateDoOp', 'gateRunQueue', 'gatePublishRun',
  'gateReadConfig', 'gateFolderAcctOf', 'gateCollectRun', 'gateDriveApi', 'gatePause', 'gateStoreMap', 'gateFoldLog', 'gateIdMoves', 'gateStaffOn',
  'gateKillSwitch', 'gateWithLock', 'gateConfigLoad', 'gatePageEnv', 'gatePublishTick', 'gateCollectTick', 'gateMergeRequests',
  'gateApplyOps', 'gateStaffTick', 'gateHealthVerdict', 'gateStatusText', 'gateSignInLink', 'gateCheckHealth', 'gateOlder', 'gateSeenUntil',
  'gateSetOffFile', 'gateApplyOffFile', 'gateCollectRegistrations', 'gateAddRegistrations', 'gatePublishSoon'];
const PAGE_CODE = VARS.map(n => extractVar(SRC, n)).concat(FUNCS.map(n => extractFunction(SRC, n))).join('\n');

const GATE_URL = 'https://script.google.com/macros/s/FAKE-GATE/exec';
// Every computer and the shared files run on the fixture's clock (the
// Centre's records are dated around 2 November 2026), moving on in real time.
const T0 = Date.now();
const clock = () => NOW + (Date.now() - T0);
class FixtureDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock()); }
  static now() { return clock(); }
}
const MAIN_FOLDER = 'MAIN-FOLDER';

/* ---------- Drive's own calls, answered by the shared stand-in ---------- */
function fakeFetch(drive, dev) {
  return async function (url, init) {
    init = init || {};
    const u = String(url), method = (init.method || 'GET').toUpperCase();
    dev.requests.push({ method, url: u, at: dev.events.length });
    dev.events.push(['fetch', method, u]);
    if (u.indexOf(GATE_URL) === 0) {
      if (dev.gateDown) return new Response('down', { status: 502 });
      return new Response(JSON.stringify(dev.health || { ok: true, service: 'cestis-trainee-gate', version: 1, protocol: [1],
        ready: { secret: true, folders: true, ledger: true, trainees: 40 }, accepting: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (!/^https:\/\/www\.googleapis\.com\//.test(u)) return new Response('not here', { status: 404 });
    if (dev.driveDown) throw new TypeError('Failed to fetch');
    const body = init.body == null ? null : Buffer.from(String(init.body), 'utf8');
    const headers = {};
    Object.keys(init.headers || {}).forEach(k => { headers[k.toLowerCase()] = init.headers[k]; });
    let res = null;
    await drive.handle({
      request: () => ({ url: () => u, method: () => method, postDataBuffer: () => body, allHeaders: async () => headers }),
      fulfill: async o => { res = new Response(o.status === 204 ? null : (o.body == null ? '' : o.body), { status: o.status || 200, headers: { 'content-type': o.contentType || 'application/json' } }); }
    });
    return res;
  };
}

/* ---------- One staff computer: its own storage and page state ---------- */
function computer(name, drive, data, opts) {
  opts = opts || {};
  const dev = { name, requests: [], events: [], merges: [], mergeFail: false, gateDown: false, driveDown: false, health: null, notes: [] };
  const ls = new Map(), cache = Object.assign({}, data);
  const localStorage = {
    getItem: k => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); dev.events.push(['ls', k]); },
    removeItem: k => { ls.delete(k); }
  };
  const CESTISStore = {
    namespace: '', writes: 0,
    getItem(k) { const v = localStorage.getItem(k); if (v !== null) return v; return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
    setItem(k, v) { this.writes++; cache[k] = String(v); dev.events.push(['store', k]); },
    removeItem(k) { this.writes++; delete cache[k]; }
  };
  const parse = k => { try { return JSON.parse(cache[k] || 'null'); } catch (e) { return null; } };
  const sb = {
    console: { log() {}, warn(...a) { dev.events.push(['warn', a.join(' ')]); }, error() {} },
    CESTISCore: Core, CESTISStore, localStorage, Response, MessageChannel, URL, Date: FixtureDate,
    navigator: {}, performance: { now: () => Date.now() }, location: { origin: 'https://centre.example', pathname: '/index.html' },
    GOOGLE_DRIVE_CONFIG: { FOLDER_ID: MAIN_FOLDER },
    systemSettings: Object.assign({}, parse('voctrain_systemSettings') || {}, opts.settings || {}),
    currentRole: opts.role || 'admin', isCloudConnected: opts.connected !== false, googleAccessToken: opts.connected === false ? null : 'ya29.fake',
    _sessionWiped: false, _lastPull: { ok: true, changed: false }, _mergeBackupFailed: false,
    currentLoggedInUser: { username: 'admin1' },
    userAccounts: parse('voctrain_users') || [], students: parse('voctrain_students') || [],
    announcements: parse('voctrain_announcements') || [], notifications: parse('voctrain_notifications') || [],
    lmsChatMessages: parse('voctrain_chatMessages') || {}, lmsChatFollows: {}, lmsChatFollowLog: {},
    safeJsonParse: (s, f) => { try { return s ? JSON.parse(s) : f; } catch (e) { return f; } },
    touchAccount: a => { if (a) a.updatedAt = new Date().toISOString(); },
    saveUserAccounts: () => { cache.voctrain_users = JSON.stringify(sb.userAccounts); CESTISStore.writes++; },
    saveNotifications: () => { cache.voctrain_notifications = JSON.stringify(sb.notifications); CESTISStore.writes++; },
    saveState: () => { cache.voctrain_announcements = JSON.stringify(sb.announcements); CESTISStore.writes++; },
    showToast: () => {}, gateCardRefresh: () => {},
    // The real one is index.html's whole merge (the browser suite runs it);
    // here it records what it was given and merges records by id.
    mergeBackupData: async payload => {
      dev.merges.push(payload);
      sb._mergeBackupFailed = !!dev.mergeFail;
      if (dev.mergeFail) return false;
      const by = { supportMessages: 'voctrain_support_messages', assignmentSubmissions: 'voctrain_submissions', examResults: 'voctrain_examResults',
        examAttempts: 'voctrain_examAttempts' };
      Object.keys(payload.data).forEach(n => {
        const k = by[n]; if (!k) return;
        const cur = parse(k) || [];
        payload.data[n].forEach(r => { const i = cur.findIndex(x => x && x.id === r.id); if (i === -1) cur.push(r); else cur[i] = r; });
        cache[k] = JSON.stringify(cur);
      });
      return true;
    },
    findSkillAreaForCourse: c => Core.enrolment.findCentre(parse('voctrain_skillAreas') || [], c, { nowMs: Date.now() }),
    // Registrations from home (§17): the page's own list of programmes taking
    // trainees, and the one account rule (here: added by id, once).
    officeEnrollingProgrammes: () => (opts.programmes || []).slice(),
    mergeCloudAccounts: list => { let n = 0; list.forEach(a => { if (!sb.userAccounts.some(u => u.id === a.id)) { sb.userAccounts.push(Object.assign({}, a)); n++; } }); return n; },
    addNotification: (text, type, icon, roles, id) => { dev.notes.push({ text, id }); }, renderVerifyUsersPage: () => {},
    localDateStr: d => (d instanceof Date ? d : new Date()).toISOString().slice(0, 10)
  };
  // Timers: a pause or a wait is noted and then let go at once (the turn
  // still waits for it, so the order of events is the real one).
  sb.setTimeout = (fn, ms) => { dev.events.push(['sleep', ms || 0]); setImmediate(fn); return 0; };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(PAGE_CODE, sb, { filename: 'index.html (gate staff side)' });
  sb.fetch = fakeFetch(drive, dev);
  dev.sb = sb; dev.ls = ls; dev.cache = cache;
  dev.tick = async () => { await sb.gatePublishTick(); };
  dev.collect = async o => sb.gateCollectTick(o);
  dev.state = () => JSON.parse(ls.get('cestisGatePublished') || 'null');
  dev.queue = () => JSON.parse(ls.get('cestisGatePublishQueue') || '[]');
  dev.forceBuild = () => { sb._gateRun.builtAt = 0; };
  dev.forceLook = () => { sb._gateRun.remoteAt = 0; };
  dev.writes = () => dev.requests.filter(r => /googleapis/.test(r.url) && (r.method === 'POST' || r.method === 'PATCH'));
  dev.reload = () => {   // the same computer, the tab closed and opened again
    const d2 = computer(name, drive, cache, opts);
    ls.forEach((v, k) => d2.ls.set(k, v));
    return d2;
  };
  return dev;
}

// The Centre's shared files as the gate leaves them at its first check
// (trainee-gate/Gate.gs gateSetupRun / gateWriteConfigFile): its folders,
// its live-check files in _gate, and CESTIS_GATE.json beside the accounts list.
function gateDrive(where) {
  const drive = new FakeDrive();
  drive.clock = clock;
  const F = 'application/vnd.google-apps.folder';
  const root = drive.put(null, { name: 'CESTIS Trainee Gate', mimeType: F, parents: ['root'] }, '');
  const mk = n => drive.put(null, { name: n, mimeType: F, parents: [root.id] }, '').id;
  const gateFolderId = mk('_gate');
  const cfg = { format: 'cestis-gate-config', version: 1, gateVersion: 1, protocol: [1], rootId: root.id, gateFolderId, traineesId: mk('Trainees'),
    keysId: mk('Exam keys'), papersId: mk('Papers'), roomsId: mk('Rooms'), registrationsId: mk('Registrations'), writtenAt: new Date(clock()).toISOString() };
  drive.put(null, { name: 'CESTIS_ACCOUNTS.json', parents: [where || MAIN_FOLDER] }, '{"accounts":[]}');
  drive.put(null, { name: 'CESTIS_GATE.json', parents: [where || MAIN_FOLDER] }, JSON.stringify(cfg));
  // The gate's own live checks (SETUP.md 5 and 7): never anybody's inbox.
  drive.put(null, { name: 'CESTISSMOKE.name-check.json', parents: [gateFolderId] }, '{"check":"name"}');
  const smoke = drive.put(null, { name: 'smoke-description-check', mimeType: F, parents: [gateFolderId], description: 'cestis-smoke acct=USR-SMOKECHECK v=1' }, '');
  return { drive, cfg, smokeFolder: smoke.id };
}
const filesIn = (drive, parent) => Object.values(drive.files).filter(f => f.parents.indexOf(parent) !== -1);
const ON = { traineeGate: { url: GATE_URL, enabled: true } };

// A bigger Centre (for the throttle): n trainees, one programme each of three.
function bigCentre(n) {
  const C = makeCentre(Core);
  const store = JSON.parse(JSON.stringify(C.store));
  const progs = ['Welding and Fabrication Level 2', 'Electrical Installation Level 2', 'Commercial Cooking Level 2'];
  for (let i = 0; i < n; i++) {
    const p = progs[i % 3], name = 'Trainee' + String.fromCharCode(65 + (i % 26)) + i + ' Samuels' + i;
    const stu = { id: null, name, course: p, stage: 'training', email: 'big' + i + '@mail.test', lastModified: iso(NOW - 40 * DAY) };
    stu.id = Core.stableStudentId(stu);
    store.voctrain_students.push(stu);
    store.voctrain_users.push({ id: 'USR-B' + i, name, role: 'student', username: 'big' + i, email: stu.email, programme: p, status: 'active',
      studentDataId: stu.id, password: 'pbkdf2$1000$00$' + '0'.repeat(64), createdAt: iso(NOW - 60 * DAY) });
  }
  const out = {};
  Object.keys(store).forEach(k => { out[k] = JSON.stringify(store[k]); });
  return out;
}

(async function main() {
  const C = makeCentre(Core);

  /* ------------------------------------------------ the gate off: nothing */
  console.log('With the gate not set up, turned off, or not for this session: not one request, nothing written');
  {
    const { drive } = gateDrive();
    const before = JSON.stringify(drive.files);
    const cases = [
      ['not set up', { settings: { traineeGate: undefined } }],
      ['set up but turned off', { settings: { traineeGate: { url: GATE_URL, enabled: false } } }],
      ['turned on but not finished (no address)', { settings: { traineeGate: { url: '', enabled: true } } }],
      ['on, but a trainee\'s session', { settings: ON, role: 'student' }],
      ['on, but a board member\'s session', { settings: ON, role: 'cmc' }],
      ['on, but this PC is not signed in for syncing', { settings: ON, connected: false }]
    ];
    for (const [label, o] of cases) {
      const dev = computer('off', drive, C.asStrings, o);
      if (o.settings && o.settings.traineeGate === undefined) delete dev.sb.systemSettings.traineeGate;
      for (let i = 0; i < 3; i++) { dev.sb.gateStaffTick(); await dev.sb.gatePublishTick(); await dev.sb.gateCollectTick(); }
      assertEq(dev.requests.length, 0, label + ': no request of any kind');
      assertEq(dev.ls.size, 0, label + ': nothing written on this PC');
      assertEq(dev.sb.CESTISStore.writes, 0, label + ': nothing written to the Centre\'s records');
      assertEq(dev.sb._gateRun.drive, 0, label + ': the gate\'s request counter is still nought');
    }
    assert(JSON.stringify(drive.files) === before, 'and the shared files are exactly as they were');
    // Turned on before the address made its folders (no CESTIS_GATE.json yet):
    // looked for once, then again a minute later — not at every save.
    {
      const empty = new FakeDrive();
      const early = computer('early', empty, C.asStrings, { settings: ON });
      for (let i = 0; i < 4; i++) { await early.sb.gatePublishTick(); await early.sb.gateCollectTick(); }
      const looks = early.requests.filter(r => /CESTIS_GATE/.test(decodeURIComponent(r.url)));
      assert(looks.length >= 1 && looks.length <= 2 && early.writes().length === 0 && early.sb._gateRun.cfgMissing, 'on before the setup is finished: ' + looks.length + ' look(s) for its note in eight turns, nothing written, the card says so');
    }
    // Where it is called from: beside the 5-second save, after a pull that
    // could be read, and its first act is the off check.
    const autosave = extractFunction(SRC, 'autoSaveToAllFolders');
    const at = autosave.indexOf("try { if (typeof gateStaffTick === 'function') gateStaffTick(); } catch (e)"), pullCheck = autosave.indexOf("reason: 'pull-failed'");
    assert(at !== -1 && pullCheck !== -1 && at > pullCheck && at < autosave.indexOf('_writesNow'), 'autoSaveToAllFolders calls gateStaffTick() after the pull check, before the "nothing new" shortcut, and nothing it does can stop the save');
    const tickSrc = extractFunction(SRC, 'gateStaffTick');
    const beforeOff = tickSrc.slice(0, tickSrc.indexOf('if (!gateStaffOn()) return;'));
    assert(tickSrc.indexOf('if (!gateStaffOn()) return;') !== -1 && /^function gateStaffTick\(\) \{\n(  \/\/[^\n]*\n)*  if \(_gateRun\.offPending && currentRole === 'admin' && !_gateRun\.offBusy\) \{\n/.test(beforeOff) &&
      !/gatePublishTick|gateCollectTick|gateCheckHealth|fetch/.test(beforeOff),
      'gateStaffTick() returns at once when the gate is off (before that, only an administrator\'s own Turn off/on still to be done: ' + beforeOff.length + ' chars)');
    assert(!/gateStaffTick|gatePublishTick|gateCollectTick/.test(SRC.slice(0, SRC.indexOf('async function autoSaveToAllFolders'))), 'nothing before the save loop starts the gate');
  }

  /* ------------------------------------------------ the build */
  console.log('The build, a trainee at a time, gives exactly CESTISCore.gate.buildAll\'s output');
  {
    const dev = computer('A', gateDrive().drive, C.asStrings, { settings: ON });
    let pauses = 0;
    const opts = { builtBy: 'dev-test' };
    const built = await dev.sb.gateBuild(C.asStrings, NOW, opts, async () => { pauses++; }, 25);
    const all = Core.gate.buildAll(C.asStrings, NOW, opts);
    const want = {};
    Object.keys(all.slices).forEach(a => { want['slice:' + a] = all.slices[a].h; });
    Object.keys(all.papers).forEach(e => { want['paper:' + e] = all.papers[e].h; });
    Object.keys(all.keys).forEach(e => { want['key:' + e] = all.keys[e].h; });
    Object.keys(all.rooms).forEach(r => { want['room:' + r] = all.rooms[r].h; });
    const got = {};
    Object.keys(built.items).forEach(p => { got[p] = built.items[p].h; });
    assertEq(Object.keys(got).sort(), Object.keys(want).sort(), 'the same records, papers, keys and rooms');
    assert(Object.keys(want).every(p => got[p] === want[p]), 'each with the same content hash');
    assert(Object.keys(all.rooms).every(r => JSON.stringify(built.items['room:' + r].body.members) === JSON.stringify(all.rooms[r].room.members)), 'rooms list the same members');
    assertEq(pauses, 1, '40 trainees: one pause (every 25)');
    assertEq(built.scrubbed, 0, 'the privacy sweep took nothing out');
    assert(Object.values(built.items).every(it => it.s === all.s), 'every item carries the build\'s newest stamp');
    // Nothing read outside GATE_STORE_KEYS.
    const read = new Set();
    const spy = new Proxy(C.asStrings, { get(t, k) { if (typeof k === 'string') read.add(k); return t[k]; } });
    await dev.sb.gateBuild(spy, NOW, opts, null, 25);
    const keys = new Set(dev.sb.GATE_STORE_KEYS);
    const outside = [...read].filter(k => /^voctrain_/.test(k) && !keys.has(k));
    assertEq(outside, [], 'every collection the build reads is in GATE_STORE_KEYS');
    const map = dev.sb.gateStoreMap();
    assert(Object.keys(map).length > 20 && map.voctrain_users === C.asStrings.voctrain_users, 'gateStoreMap() hands the build the stored records as they are');
  }

  /* ------------------------------------------------ the first publish */
  console.log('The first publish: a folder per trainee, keys before papers before records before rooms');
  const { drive, cfg } = gateDrive();
  const A = computer('A', drive, C.asStrings, { settings: ON });
  {
    for (let i = 0; i < 3 && (i === 0 || A.queue().length); i++) await A.tick();
    const st = A.state();
    const folders = filesIn(drive, cfg.traineesId);
    assertEq(folders.length, 40, '40 trainee folders');
    const byAcct = {};
    folders.forEach(f => { byAcct[A.sb.gateFolderAcct(f.description)] = f; });
    assert(C.trainees.every(t => byAcct[t.acct.id] && byAcct[t.acct.id].name === t.stu.name + ' (' + t.stu.id + ')'), 'each named "<Name> (<student ID>)" and found by the account in its description');
    assert(folders.every(f => /^cestis-trainee acct=USR-T\d\d v=1$/.test(f.description) && f.appProperties.cestisKind === 'folder' && f.appProperties.cestisGate === '1'), 'descriptions read "cestis-trainee acct=… v=1"');
    const slices = C.trainees.map(t => filesIn(drive, byAcct[t.acct.id].id).filter(f => f.name === 'from-centre.json'));
    assert(slices.every(l => l.length === 1), 'each folder holds the trainee\'s records once (from-centre.json)');
    const sl = JSON.parse(slices[0][0].content);
    assert(sl.format === 'cestis-trainee-slice' && sl.accountId === C.trainees[0].acct.id && sl.studentId === C.trainees[0].stu.id, 'the records are that trainee\'s');
    assert(slices[0][0].appProperties.h === sl.hash && slices[0][0].appProperties.acct === sl.accountId && slices[0][0].appProperties.cestisKind === 'slice' &&
      Number(slices[0][0].appProperties.s) === sl.maxStamp, 'and the file says what it holds (kind, account, hash, stamp)');
    assert(sl.builtBy === st.device && /^dev-/.test(st.device), 'built by this PC\'s device id, never a name');
    const keys = filesIn(drive, cfg.keysId), papers = filesIn(drive, cfg.papersId), rooms = filesIn(drive, cfg.roomsId);
    assertEq(keys.map(f => f.name).sort(), ['key.EX1-OLD.json', 'key.EX1.json', 'key.EX2-OLD.json', 'key.EX2.json', 'key.EX3-OLD.json', 'key.EX3.json'], 'answer keys of the exams trainees may sit (never a draft)');
    assertEq(papers.map(f => f.name).sort(), keys.map(f => f.name.replace('key.', 'paper.')).sort(), 'and their papers');
    assert(papers.every(f => !/correctAnswer|"pairs"|distractors|tolerance/.test(f.content)) && keys.every(f => /correctAnswer/.test(f.content)), 'papers carry no answers; keys do');
    assert(keys.every(f => f.appProperties.cestisKind === 'key' && f.appProperties.examId && f.appProperties.h) && papers.every(f => f.appProperties.cestisKind === 'paper'), 'keys and papers say what they are and for which exam');
    assert(rooms.length >= 3 && rooms.every(f => /^room\..+\.json$/.test(f.name) && f.appProperties.cestisKind === 'room'), 'the trainees\' rooms (' + rooms.length + ')');
    assert(!rooms.some(f => f.name === 'room.' + C.dmPeer + '.json'), 'never a conversation between two trainees');
    // The order of the writes.
    const order = A.writes().filter(r => r.method === 'POST').map(r => r.at);
    const kindAt = {};
    Object.values(drive.files).forEach(f => { const k = f.appProperties && f.appProperties.cestisKind; if (k) (kindAt[k] = kindAt[k] || []).push(f.createdTime); });
    const first = k => kindAt[k].slice().sort()[0], last = k => kindAt[k].slice().sort().pop();
    assert(last('key') < first('paper') && last('paper') < first('slice') && last('slice') < first('room'), 'every answer key was written before any paper, every paper before any trainee\'s records, and those before any room');
    assert(first('folder') < first('slice'), 'a trainee\'s folder exists before their records go in');
    assert(order.length === Object.keys(kindAt).reduce((n, k) => n + kindAt[k].length, 0), 'one create per file: ' + order.length);
    assertEq(A.queue(), [], 'nothing left waiting');
    assert(!!st.syncedAt, 'and the PC notes when everything was sent');
    // A second turn over the same records writes nothing.
    const w0 = A.writes().length;
    A.forceBuild(); A.forceLook();
    await A.tick();
    assertEq(A.writes().length - w0, 0, 'a second turn over the same records writes nothing');
    assertEq(A.sb.CESTISStore.writes, 0, 'the publisher\'s own notes never count as a change to the Centre\'s records (the 5-second save is not woken by them)');
    // What other PCs published is looked at every 5 minutes, with one listing.
    const r0 = A.requests.length;
    await A.tick();
    assertEq(A.requests.length - r0, 0, 'a turn within the 5 minutes makes no request at all');
    A.forceLook();
    await A.tick();
    const looked = A.requests.slice(r0);
    assert(looked.length === 1 && /appProperties/.test(decodeURIComponent(looked[0].url)) && /modifiedTime/.test(decodeURIComponent(looked[0].url)),
      'the 5-minute look is one listing of what changed since the last (' + looked.length + ')');
  }

  /* ------------------------------------------------ the throttle */
  console.log('At most 120 writes a turn, at least 500 ms apart');
  {
    const g = gateDrive();
    const big = computer('big', g.drive, bigCentre(150), { settings: ON });
    await big.tick();
    const w1 = big.writes().length;
    assertEq(w1, 120, 'the first turn stops at 120 writes');
    const left1 = big.queue().length;
    assert(left1 > 150, 'the rest wait in the list kept on this PC (' + left1 + ')');
    // Between two writes of one turn the page waits at least 500 ms.
    let gaps = 0, bad = 0, lastWrite = -1;
    big.events.forEach((e, i) => {
      if (e[0] === 'fetch' && /googleapis/.test(e[2]) && (e[1] === 'POST' || e[1] === 'PATCH')) {
        if (lastWrite !== -1) {
          gaps++;
          const between = big.events.slice(lastWrite + 1, i).filter(x => x[0] === 'sleep').reduce((n, x) => n + x[1], 0);
          if (between < 500) bad++;
        }
        lastWrite = i;
      }
    });
    assert(gaps === 119 && bad === 0, 'every write after the first waited ≥ 500 ms (≤ 2 a second): ' + gaps + ' gaps, ' + bad + ' too short');
    await big.tick();
    assertEq(big.writes().length - w1, 120, 'the next turn: 120 more');
    await big.tick();
    await big.tick();
    assertEq(big.queue().length, 0, 'and so on until nothing is waiting');
    const total = big.writes().length;
    const expected = Object.values(g.drive.files).filter(f => f.appProperties && f.appProperties.cestisGate).length;
    assertEq(total, expected, 'exactly one write per file (' + expected + ')');
  }

  /* ------------------------------------------------ resume after a closed tab */
  console.log('A tab closed half-way resumes where it stopped: nothing written twice, nothing doubled');
  {
    const g = gateDrive();
    const P = computer('P', g.drive, C.asStrings, { settings: ON });
    P.sb.GATE_LIMITS.perTick = 50;
    await P.tick();
    assertEq(P.writes().length, 50, 'the first turn wrote 50 and the tab closed');
    const waiting = P.queue().length;
    assert(waiting > 0, 'the list kept on this PC says ' + waiting + ' are still waiting (the card shows it after a reload)');
    // The tab closed just after one more write landed, before it was noted.
    const st = P.state();
    const noted = Object.keys(st.files);
    const lostPath = noted.filter(p => p.indexOf('slice:') === 0).pop();
    delete st.files[lostPath];
    P.ls.set('cestisGatePublished', JSON.stringify(st));
    const P2 = P.reload();
    await P2.tick();
    await P2.tick();
    assertEq(P2.queue().length, 0, 'opened again: the rest is written');
    const all = Object.values(g.drive.files).filter(f => f.appProperties && f.appProperties.cestisGate);
    const paths = {};
    all.forEach(f => { const p = f.appProperties; const k = p.cestisKind + ':' + (p.acct || p.examId || p.roomId); paths[k] = (paths[k] || 0) + 1; });
    assert(Object.keys(paths).every(k => paths[k] === 1), 'no file made twice (' + all.length + ' files)');
    assertEq(P2.writes().filter(r => r.method === 'PATCH').length, 0, 'nothing already written was written again — not even the write whose note was lost');
    assertEq(P.writes().length + P2.writes().length, all.length, 'one write per file in all');
  }

  /* ------------------------------------------------ two staff PCs */
  console.log('Two staff PCs: the second writes nothing over the same records; a PC that has seen less never wins');
  const B = computer('B', drive, C.asStrings, { settings: ON });
  {
    await B.tick();
    assertEq(B.writes().length, 0, 'B, with the same records, writes nothing: everything is already there');
    assert(B.requests.length >= 1 && B.requests.every(r => r.method === 'GET'), 'B only looked (' + B.requests.length + ' reads)');
    // An office edit on A only: a newer announcement to Welding trainees.
    const ann = JSON.parse(A.cache.voctrain_announcements);
    ann[0].body = 'Bring goggles AND gloves.'; ann[0].updatedAt = new Date(clock() + 1000).toISOString();
    A.cache.voctrain_announcements = JSON.stringify(ann);
    A.forceBuild(); A.forceLook();
    const wA = A.writes().length;
    await A.tick();
    const aWrote = A.writes().length - wA;
    const welders = C.trainees.filter(t => t.i % 3 === 0).length;
    assertEq(aWrote, welders, 'A, which has seen the edit, writes what changed: the ' + welders + ' Welding trainees\' records, nothing else');
    const sliceOf = acct => {
      const f = Object.values(drive.files).find(x => x.appProperties && x.appProperties.cestisKind === 'slice' && x.appProperties.acct === acct && x.appProperties.cestisGate === '1');
      return f ? JSON.parse(f.content) : null;
    };
    const welder = C.trainees[0].acct.id;
    assert(/AND gloves/.test(JSON.stringify(sliceOf(welder).data.voctrain_announcements)), 'the Welding trainee\'s records now carry it');
    const hA = sliceOf(welder).hash;
    // B has not seen the edit yet: it must not put its older copy back.
    for (let i = 0; i < 3; i++) { B.forceBuild(); B.forceLook(); await B.tick(); }
    assertEq(B.writes().length, 0, 'B, behind, writes nothing over A\'s newer records (three turns)');
    assert(B.sb._gateRun.decisions.behind === welders && !B.sb._gateRun.decisions.write, 'B\'s decisions: behind (' + B.sb._gateRun.decisions.behind + '), never write');
    assertEq(sliceOf(welder).hash, hA, 'A\'s copy stands');
    // B catches up: nothing to write either.
    B.cache.voctrain_announcements = A.cache.voctrain_announcements;
    B.forceBuild(); B.forceLook();
    await B.tick();
    assertEq(B.writes().length, 0, 'B, caught up, has nothing to write');
    // The same moment, different records (B lacks an old support message):
    // one copy wins and stays; nobody takes turns.
    const sup = JSON.parse(B.cache.voctrain_support_messages);
    const dropped = sup.findIndex(m => m.accountId === welder);
    sup.splice(dropped, 1);
    B.cache.voctrain_support_messages = JSON.stringify(sup);
    const wA2 = A.writes().length, wB2 = B.writes().length;
    B.forceBuild(); await B.sb.gatePublishTick();
    assert(B.sb._gateRun.built.items['slice:' + welder].h !== A.sb._gateRun.built.items['slice:' + welder].h &&
      B.sb._gateRun.built.items['slice:' + welder].s === A.sb._gateRun.built.items['slice:' + welder].s, 'the two PCs now differ at the same newest moment');
    for (let i = 0; i < 4; i++) {
      B.forceBuild(); B.forceLook(); await B.tick();
      A.forceBuild(); A.forceLook(); await A.tick();
    }
    const aw = A.writes().length - wA2, bw = B.writes().length - wB2;
    assert(aw + bw <= 1, 'four rounds each: at most one write between them, then quiet (A ' + aw + ', B ' + bw + ')');
    const win = sliceOf(welder).hash;
    const both = [A.sb._gateRun.built.items['slice:' + welder].h, B.sb._gateRun.built.items['slice:' + welder].h];
    assertEq(win, both.slice().sort().pop(), 'the higher hash holds, as publishDecision rules');
    B.cache.voctrain_support_messages = A.cache.voctrain_support_messages;
  }

  /* ------------------------------------------------ her fees (version 3) */
  console.log('Her fees: published into her folder only by a PC that holds the fee roll; a PC without it, a placeholder or an older roll never replaces them');
  {
    const t = C.trainees[1], acct = t.acct.id;
    const roll = [{ id: t.stu.id, lmsId: t.stu.id, name: t.stu.name, skillArea: t.p.name, tuitionFee: 60000, updatedAt: iso(NOW - 5 * DAY) }];
    const pays = [{ id: 'PAY-1', studentId: t.stu.id, amount: 20000, date: '2026-09-04', method: 'Cash', receiptNumber: 'R-1', notes: 'office only', createdAt: iso(NOW - 50 * DAY) }];
    const withFees = (r, p, gone) => Object.assign({}, A.cache, { cestiSchoolFeeStudents: JSON.stringify(r), cestiSchoolFeePayments: JSON.stringify(p), cestiSchoolFeeDeletedPaymentIds: JSON.stringify(gone || []) });
    const feesFiles = () => Object.values(drive.files).filter(f => f.appProperties && f.appProperties.cestisKind === 'fees' && f.appProperties.cestisGate === '1');
    const herFolder = filesIn(drive, cfg.traineesId).find(f => A.sb.gateFolderAcct(f.description) === acct);
    const F = computer('F', drive, withFees(roll, pays), { settings: ON });
    await F.tick();
    let ff = feesFiles();
    assert(ff.length === 1 && ff[0].name === 'from-centre-fees.json' && ff[0].parents[0] === herFolder.id && ff[0].appProperties.acct === acct,
      'one file, from-centre-fees.json, in her own folder — only the trainee with a fee record gets one (' + ff.length + ')');
    let body = JSON.parse(ff[0].content);
    assertEq([body.fees.tuition, body.fees.paid, body.fees.balance, body.fees.receipts.length], [60000, 20000, 40000, 1], 'her figures and her receipt');
    assert(JSON.stringify(body).indexOf('office only') === -1, 'no notes');
    assertEq(F.writes().length, 1, 'F wrote that one file and nothing else (the records were already there)');
    // A has no fee roll at all: it builds no fees, writes none.
    const wA = A.writes().length;
    A.forceBuild(); A.forceLook(); await A.tick();
    assertEq([A.writes().length - wA, feesFiles().length, JSON.parse(feesFiles()[0].content).fees.paid], [0, 1, 20000], 'a PC without the fee roll publishes nothing and replaces nothing');
    // A PC whose roll holds only a placeholder for her (made just now by the dashboard's mirror): nothing.
    const P = computer('P', drive, withFees([{ id: t.stu.id, lmsId: t.stu.id, name: t.stu.name, skillArea: t.p.name, tuitionFee: 0, totalPaid: 0, needsFeeDetails: true, source: 'lms',
      createdAt: new Date(clock()).toISOString() }], []), { settings: ON });
    await P.tick();
    assertEq([P.writes().length, JSON.parse(feesFiles()[0].content).fees.paid], [0, 20000], 'a placeholder fee record is never published over the real one');
    // A new payment on F: F writes; O, with the older roll, is behind and writes nothing.
    const O = computer('O', drive, withFees(roll, pays), { settings: ON });
    const pays2 = pays.concat([{ id: 'PAY-2', studentId: t.stu.id, amount: 15000, date: '2026-10-20', method: 'Bank transfer', receiptNumber: 'R-2', createdAt: new Date(clock()).toISOString() }]);
    F.cache.cestiSchoolFeePayments = JSON.stringify(pays2);
    F.forceBuild(); F.forceLook(); await F.tick();
    assertEq(JSON.parse(feesFiles()[0].content).fees.paid, 35000, 'a new payment reaches her file');
    for (let i = 0; i < 2; i++) { O.forceBuild(); O.forceLook(); await O.tick(); }
    assertEq([O.writes().length, JSON.parse(feesFiles()[0].content).fees.paid], [0, 35000], 'a PC with the older roll is behind: it never puts the older figures back');
    // A payment deleted at the office (no stamp of its own): the PC that knows it still wins.
    F.cache.cestiSchoolFeeDeletedPaymentIds = JSON.stringify(['PAY-2']);
    F.forceBuild(); F.forceLook(); await F.tick();
    assertEq(JSON.parse(feesFiles()[0].content).fees.receipts.map(r => r.receipt), ['R-1'], 'a deleted payment leaves her receipts');
    O.cache.cestiSchoolFeePayments = JSON.stringify(pays2);
    for (let i = 0; i < 2; i++) { O.forceBuild(); O.forceLook(); await O.tick(); }
    assertEq(JSON.parse(feesFiles()[0].content).fees.receipts.map(r => r.receipt), ['R-1'], 'a PC that has not heard of the deletion never brings it back');
  }

  /* ------------------------------------------------ a student ID changes */
  console.log('A trainee renamed (a new student ID): their folder is renamed, their records updated in place');
  {
    const t = C.trainees[5];
    const users = JSON.parse(A.cache.voctrain_users), studs = JSON.parse(A.cache.voctrain_students);
    const s = studs.find(x => x.id === t.stu.id), u = users.find(x => x.id === t.acct.id);
    s.name = 'Dwayne Thompson-Campbell'; s.lastModified = new Date(clock() + 2000).toISOString();
    const newId = Core.stableStudentId(s);
    s.id = newId; u.name = s.name; u.studentDataId = newId; u.updatedAt = s.lastModified;
    A.cache.voctrain_users = JSON.stringify(users); A.cache.voctrain_students = JSON.stringify(studs);
    const before = filesIn(drive, cfg.traineesId).length;
    const folder = filesIn(drive, cfg.traineesId).find(f => A.sb.gateFolderAcct(f.description) === t.acct.id);
    A.forceBuild(); A.forceLook();
    const r0 = A.requests.length;
    await A.tick();
    const renames = A.requests.slice(r0).filter(r => r.method === 'PATCH' && r.url.indexOf('/drive/v3/files/' + folder.id) !== -1);
    assertEq(renames.length, 1, 'one rename of that folder');
    assertEq(drive.files[folder.id].name, 'Dwayne Thompson-Campbell (' + newId + ')', 'the folder now carries the new name and student ID');
    assertEq(filesIn(drive, cfg.traineesId).length, before, 'no second folder');
    const inside = filesIn(drive, folder.id).filter(f => f.name === 'from-centre.json');
    assert(inside.length === 1 && JSON.parse(inside[0].content).studentId === newId, 'the records in it say the new student ID, in place');
    assert(/acct=USR-T06\b/.test(drive.files[folder.id].description), 'and the folder is still found by the same account');
    // B, behind, does not rename it back.
    B.forceBuild(); B.forceLook();
    await B.tick();
    assertEq(drive.files[folder.id].name, 'Dwayne Thompson-Campbell (' + newId + ')', 'a PC that has not seen the rename does not rename it back');
    B.cache.voctrain_users = A.cache.voctrain_users; B.cache.voctrain_students = A.cache.voctrain_students;
    // A folder still named the way it was before (the student ID alone) is brought to the new name, once.
    const t7 = C.trainees[6], f7 = filesIn(drive, cfg.traineesId).find(f => A.sb.gateFolderAcct(f.description) === t7.acct.id);
    drive.put(f7.id, { name: t7.stu.id }, null);
    A.forceBuild(); A.forceLook();
    const r1 = A.requests.length;
    await A.tick();
    assertEq(drive.files[f7.id].name, t7.stu.name + ' (' + t7.stu.id + ')', 'a folder named with the student ID alone is renamed "<Name> (<student ID>)"');
    assertEq(A.requests.slice(r1).filter(r => r.method === 'PATCH' && r.url.indexOf('/drive/v3/files/' + f7.id) !== -1).length, 1, 'with one rename, nothing else');
  }

  /* ------------------------------------------------ duplicate folders */
  console.log('Two PCs making the same trainee\'s folder at once: the oldest is the one; the younger is marked, never deleted');
  {
    const g = gateDrive();
    const small = JSON.parse(JSON.stringify(C.store));
    small.voctrain_users = small.voctrain_users.filter(u => u.role !== 'student' || ['USR-T01', 'USR-T02', 'USR-T03'].indexOf(u.id) !== -1);
    const data = {}; Object.keys(small).forEach(k => { data[k] = JSON.stringify(small[k]); });
    const X = computer('X', g.drive, data, { settings: ON }), Y = computer('Y', g.drive, data, { settings: ON });
    await Promise.all([X.tick(), Y.tick()]);
    let folders = filesIn(g.drive, g.cfg.traineesId);
    assertEq(folders.length, 6, 'both made all three folders at the same moment: six');
    // A trainee's inbox lands in one of the younger folders before anyone notices.
    const ofT1 = folders.filter(f => /acct=USR-T01 /.test(f.description)).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    const younger = ofT1[1], oldest = ofT1[0];
    const lane = { format: 'cestis-trainee-inbox', version: 1, accountId: 'USR-T01', studentId: C.trainees[0].stu.id, lane: 'L-dup',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      records: { voctrain_support_messages: [{ id: 'SUP-DUP-1', accountId: 'USR-T01', studentId: C.trainees[0].stu.id, name: C.trainees[0].stu.name,
        subject: 'Timetable', message: 'Is Friday on?', timestamp: Date.now() }] }, ops: [] };
    g.drive.put(null, { name: 'CESTISINBOX.L-dup.json', parents: [younger.id] }, JSON.stringify(lane));
    for (let i = 0; i < 2; i++) { X.forceLook(); X.forceBuild(); Y.forceLook(); Y.forceBuild(); await X.tick(); await Y.tick(); }
    const sx = X.state(), sy = Y.state();
    ['USR-T01', 'USR-T02', 'USR-T03'].forEach(acct => {
      const mine = filesIn(g.drive, g.cfg.traineesId).filter(f => f.description.indexOf('acct=' + acct + ' ') !== -1)
        .sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
      assert(sx.folders[acct].id === mine[0].id && sy.folders[acct].id === mine[0].id, acct + ': both PCs take the oldest folder');
      assert(/duplicate-of=/.test(mine[1].description) && mine[1].description.indexOf('duplicate-of=' + mine[0].id) !== -1, acct + ': the younger says which it duplicates');
      assert(mine[1].appProperties.cestisGate === 'dup', acct + ': and is no longer listed as the gate\'s');
      const recs = filesIn(g.drive, mine[0].id).filter(f => f.name === 'from-centre.json');
      assert(recs.length === 1 && recs[0].appProperties.h === X.sb._gateRun.built.items['slice:' + acct].h, acct + ': the oldest folder holds the current records');
    });
    assertEq(filesIn(g.drive, g.cfg.traineesId).length, 6, 'no folder deleted');
    assert(Object.values(g.drive.files).every(f => !f.trashed), 'nothing trashed');
    assert(X.requests.concat(Y.requests).every(r => r.method !== 'DELETE'), 'and no delete was ever asked for');
    assert(filesIn(g.drive, younger.id).some(f => f.name === 'CESTISINBOX.L-dup.json'), 'the younger folder still holds what the trainee sent');
    void oldest;
    // ...and it is still collected, as the trainee's.
    const res = await X.collect();
    assert(res && res.files === 1, 'the collector reads the inbox in the younger folder (' + JSON.stringify(res && { files: res.files, un: res.unassigned }) + ')');
    assert(X.merges.length === 1 && X.merges[0].data.supportMessages[0].id === 'SUP-DUP-1', 'and merges it as that trainee\'s');
  }

  /* ------------------------------------------------ collecting */
  console.log('Collecting: merged once, requests and read marks applied, a failed merge read again, unplaced work waits');
  {
    const t = C.trainees[1], acct = t.acct.id;
    const folder = filesIn(drive, cfg.traineesId).find(f => A.sb.gateFolderAcct(f.description) === acct);
    const reqId = JSON.parse(A.cache.voctrain_certTranscriptRequests).find(r => r.studentId === t.stu.id).id;
    const at = new Date(clock()).toISOString();
    const lane = { format: 'cestis-trainee-inbox', version: 1, accountId: acct, studentId: t.stu.id, lane: 'L-hand', createdAt: at, updatedAt: at,
      records: {
        voctrain_support_messages: [{ id: 'SUP-HAND-1', accountId: acct, studentId: t.stu.id, name: t.stu.name, subject: 'Exam', message: 'What room?', timestamp: Date.now() }],
        voctrain_submissions: [{ id: 'SUB-HAND-1', assignmentId: 'ASG-2', studentId: t.stu.id, submittedAt: at, comment: 'My project', grade: 100 }],
        voctrain_certTranscriptRequests: [{ id: reqId, studentId: t.stu.id, status: 'cancelled', updatedAt: at }]
      },
      ops: [{ id: 'OP-1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-4', at }],
      received: {} };
    drive.put(null, { name: 'CESTISINBOX.L-hand.json', parents: [folder.id] }, JSON.stringify(lane));
    const res = await A.collect();
    assert(res && res.files === 1 && !res.error, 'one inbox collected');
    assertEq(A.merges.length, 1, 'merged once');
    const m = A.merges[0];
    assertEq(Object.keys(m.data).sort(), ['assignmentSubmissions', 'supportMessages'], 'as a partial backup: only what the trainee sent');
    assert(m.data.assignmentSubmissions[0].grade === undefined, 'a grade a trainee wrote on their own work is dropped');
    const reqs = JSON.parse(A.cache.voctrain_certTranscriptRequests);
    assertEq(reqs.find(r => r.id === reqId).status, 'cancelled', 'the request queue holds the withdrawn request');
    assert(A.sb.announcements.find(a => a.id === 'AN-4').readBy.indexOf(acct) !== -1, 'the read mark is the trainee\'s own, applied');
    const col = JSON.parse(A.ls.get('cestisGateCollected'));
    assert(col.watermark && col.seen[Object.values(drive.files).find(f => f.name === 'CESTISINBOX.L-hand.json').id], 'noted as collected, with the mark moved on');
    assert(col.byAcct[acct], 'and when this trainee\'s work was last collected (their records say so)');
    const again = await A.collect();
    assertEq(A.merges.length, 1, 'a second turn merges nothing again');
    assert(again && again.files === 0, 'and reads nothing again');
    // A merge that fails: nothing noted, read again next time.
    const lane2 = Object.assign({}, lane, { lane: 'L-hand2', records: { voctrain_support_messages: [{ id: 'SUP-HAND-2', accountId: acct, studentId: t.stu.id,
      name: t.stu.name, subject: 'Fees', message: 'When?', timestamp: Date.now() }] }, ops: [] });
    const f2 = drive.put(null, { name: 'CESTISINBOX.L-hand2.json', parents: [folder.id] }, JSON.stringify(lane2));
    const wm = JSON.parse(A.ls.get('cestisGateCollected')).watermark;
    A.mergeFail = true;
    const bad = await A.collect();
    assert(bad && bad.error === 'merge', 'the merge failed');
    const col2 = JSON.parse(A.ls.get('cestisGateCollected'));
    assert(col2.watermark === wm && !col2.seen[f2.id], 'the mark did not move and the file is not noted as collected');
    A.mergeFail = false;
    await A.collect();
    assertEq(A.merges.filter(x => x.data.supportMessages && x.data.supportMessages.some(s => s.id === 'SUP-HAND-2')).length, 2, 'next time it is read again and merged (once more, successfully)');
    assert(JSON.parse(A.cache.voctrain_support_messages).some(s => s.id === 'SUP-HAND-2'), 'and is in the Centre\'s records');
    // Work for an account that is gone: waits for a decision, then is collected.
    const gone = C.trainees[2].acct.id;
    const fg = filesIn(drive, cfg.traineesId).find(f => A.sb.gateFolderAcct(f.description) === gone);
    const lane3 = { format: 'cestis-trainee-inbox', version: 1, accountId: gone, studentId: C.trainees[2].stu.id, lane: 'L-gone', createdAt: at, updatedAt: at,
      records: { voctrain_support_messages: [{ id: 'SUP-GONE-1', accountId: gone, studentId: C.trainees[2].stu.id, name: 'x', subject: 'y', message: 'z', timestamp: Date.now() }] }, ops: [] };
    const f3 = drive.put(null, { name: 'CESTISINBOX.L-gone.json', parents: [fg.id] }, JSON.stringify(lane3));
    const keep = A.sb.userAccounts;
    A.sb.userAccounts = keep.filter(u => u.id !== gone);
    const r3 = await A.collect();
    assert(r3 && r3.unassigned === 1, 'an account that is gone: the work waits');
    let un = JSON.parse(A.ls.get('cestisGateUnassigned'));
    assert(un[f3.id] && un[f3.id].reason === 'account-gone' && un[f3.id].items === 1, 'listed for the administrator, with why and how much');
    assert(!JSON.parse(A.ls.get('cestisGateCollected')).seen[f3.id], 'not noted as collected');
    A.sb.userAccounts = keep;
    const r4 = await A.collect({ refetch: true });
    assert(r4 && r4.files === 1, 'the account back: looked at again by id (the mark had passed it) and collected');
    un = JSON.parse(A.ls.get('cestisGateUnassigned'));
    assert(!un[f3.id], 'and no longer waiting');
    // A file that is not in any trainee's folder is nobody's inbox.
    const stray = drive.put(null, { name: 'CESTISINBOX.L-stray.json', parents: [MAIN_FOLDER] }, JSON.stringify(Object.assign({}, lane, { lane: 'L-stray' })));
    const n0 = A.merges.length;
    await A.collect();
    assertEq(A.merges.length, n0, 'a stray inbox outside the trainees\' folders is never merged');
    assert(JSON.parse(A.ls.get('cestisGateCollected')).seen[stray.id], 'and is not read again');
  }

  /* ------------------------------------------------ the gate's own rules (trainee-gate/Gate.gs) */
  console.log('The same rules as the gate: its note of its folders, the oldest copy, its live checks, gate-off');
  {
    // CESTIS_GATE.json: of two, the oldest (the copy the gate keeps up to date).
    const g = gateDrive();
    const newer = Object.assign({}, g.cfg, { traineesId: 'STALE' });
    g.drive.put(null, { name: 'CESTIS_GATE.json', parents: [MAIN_FOLDER] }, JSON.stringify(newer));
    const dev = computer('cfg', g.drive, C.asStrings, { settings: ON });
    const api = dev.sb.gateDriveApi(() => 'ya29.fake');
    let cfg = await dev.sb.gateReadConfig(api, MAIN_FOLDER);
    assert(cfg && cfg.traineesId === g.cfg.traineesId && cfg.gateFolderId === g.cfg.gateFolderId && cfg.rootId === g.cfg.rootId, 'of two notes, the oldest is read, with the gate\'s own folder');
    // Beside an accounts list that is not in the main folder: found there.
    const g2 = gateDrive('ELSEWHERE');
    const dev2 = computer('cfg2', g2.drive, C.asStrings, { settings: ON });
    cfg = await dev2.sb.gateReadConfig(dev2.sb.gateDriveApi(() => 'x'), MAIN_FOLDER);
    assert(cfg && cfg.traineesId === g2.cfg.traineesId, 'a note beside an accounts list kept elsewhere is found too');
    assertEq((await dev2.sb.gateReadConfig(dev2.sb.gateDriveApi(() => 'x'), 'NOWHERE')).traineesId, g2.cfg.traineesId, '(by its name, when the main folder has none)');
    const g3 = gateDrive();
    Object.values(g3.drive.files).filter(f => f.name === 'CESTIS_GATE.json').forEach(f => { f.content = JSON.stringify(Object.assign(JSON.parse(f.content), { version: 2 })); });
    const dev3 = computer('cfg3', g3.drive, C.asStrings, { settings: ON });
    assert((await dev3.sb.gateReadConfig(dev3.sb.gateDriveApi(() => 'x'), MAIN_FOLDER)).tooNew, 'a note of a newer format is not read as anything');
    // Two copies made in the same millisecond: the lower id, as the gate decides.
    const older = dev.sb.gateOlder;
    assert(older({ id: 'a1', created: '2026-11-02T10:00:00.000Z' }, { id: 'a2', created: '2026-11-02T10:00:00.000Z' }) &&
      !older({ id: 'a2', created: '2026-11-02T10:00:00.000Z' }, { id: 'a1', created: '2026-11-02T10:00:00.000Z' }), 'the same millisecond: the lower id is the older');
    assert(older({ id: 'z', created: '2026-11-02T10:00:00.000Z' }, { id: 'a', created: '2026-11-02T10:00:00.001Z' }), 'otherwise the earlier creation time, to the millisecond');
    assertEq(dev.sb.gateFolderAcct('cestis-smoke acct=USR-SMOKECHECK v=1'), '', 'the gate\'s test folder is never taken for a trainee\'s');
    // The live-check files in _gate, and an inbox-named file put there, are never collected.
    const P = computer('smoke', g.drive, C.asStrings, { settings: ON });
    await P.tick();
    g.drive.put(null, { name: 'CESTISINBOX.L-smoke.json', parents: [g.cfg.gateFolderId] }, JSON.stringify({ format: 'cestis-trainee-inbox', version: 1, accountId: 'USR-SMOKECHECK', studentId: 'STU-X', records: {}, ops: [] }));
    g.drive.put(null, { name: 'CESTISINBOX.L-smoke2.json', parents: [g.smokeFolder] }, JSON.stringify({ format: 'cestis-trainee-inbox', version: 1, accountId: 'USR-SMOKECHECK', studentId: 'STU-X', records: {}, ops: [] }));
    const r0 = P.requests.length;
    const res = await P.collect();
    assert(res && res.files === 0 && res.unassigned === 0 && P.merges.length === 0, 'the gate\'s own folder and its test folder hold nobody\'s inbox');
    assert(!P.requests.slice(r0).some(r => r.url.indexOf('/files/' + g.cfg.gateFolderId) !== -1), 'the gate\'s folder is not even looked up');
    // inboxSeenUntil: from the collector's mark, less the 10 minutes' overlap.
    assert(Object.values(P.sb._gateRun.built.items).filter(i => i.kind === 'slice').every(i => i.body.inboxSeenUntil === ''), 'nothing collected yet: the records say so (the gate reads every inbox)');
    const folder = filesIn(g.drive, g.cfg.traineesId)[0];
    const acct = P.sb.gateFolderAcct(folder.description), t = C.trainees.find(x => x.acct.id === acct);
    g.drive.put(null, { name: 'CESTISINBOX.L-seen.json', parents: [folder.id] }, JSON.stringify({ format: 'cestis-trainee-inbox', version: 1, accountId: acct, studentId: t.stu.id,
      lane: 'L-seen', records: { voctrain_support_messages: [{ id: 'SUP-SEEN', accountId: acct, studentId: t.stu.id, name: t.stu.name, subject: 's', message: 'm', timestamp: clock() }] }, ops: [] }));
    await P.collect();
    const W = JSON.parse(P.ls.get('cestisGateCollected')).watermark;
    P.forceBuild();
    await P.tick();
    const want = new Date(Date.parse(W) - 10 * 60000).toISOString();
    const slices = Object.values(P.sb._gateRun.built.items).filter(i => i.kind === 'slice');
    assert(W && slices.length === 40 && slices.every(i => i.body.inboxSeenUntil === want), 'every trainee\'s records carry inboxSeenUntil = the mark less 10 minutes (' + want + ')');
    // gate-off: Turn off writes it in the gate's folder, once; Turn on bins it.
    const api2 = P.sb.gateDriveApi(() => 'x');
    await P.sb.gateSetOffFile(api2, g.cfg, true);
    await P.sb.gateSetOffFile(api2, g.cfg, true);
    let off = Object.values(g.drive.files).filter(f => f.name === 'gate-off' && f.parents.indexOf(g.cfg.rootId) !== -1);
    assert(off.length === 1 && !off[0].trashed, 'Turn off: one "gate-off" in the gate\'s folder');
    await P.sb.gateSetOffFile(api2, g.cfg, false);
    off = Object.values(g.drive.files).filter(f => f.name === 'gate-off');
    assert(off.length === 1 && off[0].trashed, 'Turn on: it goes in the bin (never deleted)');
    // A Turn off that could not reach the gate is tried again beside the next saves — then nothing more.
    const Q = computer('offline-admin', g.drive, C.asStrings, { settings: { traineeGate: { url: GATE_URL, enabled: false } } });
    Q.driveDown = true;
    await Q.sb.gateApplyOffFile(true);
    assertEq(Q.sb._gateRun.offPending, 'off', 'Turn off with no connection: noted to be done');
    Q.driveDown = false;
    Q.sb.gateStaffTick();
    for (let i = 0; i < 20 && Q.sb._gateRun.offBusy; i++) await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 50));
    off = Object.values(g.drive.files).filter(f => f.name === 'gate-off' && !f.trashed);
    assert(off.length === 1 && Q.sb._gateRun.offPending === '', 'done beside the next save');
    const n0 = Q.requests.length;
    for (let i = 0; i < 3; i++) Q.sb.gateStaffTick();
    await new Promise(r => setTimeout(r, 50));
    assertEq(Q.requests.length - n0, 0, 'and with the gate off, nothing more after that');
  }

  /* ------------------------------------------------ registrations from home (§17) */
  console.log('Registrations from home: collected once as pending accounts; the gate\'s folder taken on (never a second), marked while waiting, rejected kept and marked');
  {
    const g = gateDrive(), F = 'application/vnd.google-apps.folder', P0 = C.PROGRAMMES[0].name, P2 = C.PROGRAMMES[2].name;
    const R = computer('R', g.drive, Object.assign({}, C.asStrings), { settings: ON, programmes: [P2, P0] });
    const secret = 'ab'.repeat(32);
    // What the gate leaves for one registration: the folder, then the file.
    const asGate = (name, email, programme, phone) => {
      const acct = Core.gate.reg.accountId(email, secret, gcrypto);
      const value = Core.gate.reg.check({ name, programme, phone, password: 'pbkdf2$210000$' + '0a'.repeat(16) + '$' + '1b'.repeat(32),
        gender: 'Female', dob: '2005-02-14', address: '4 Hope Road, Kingston 6', emergencyName: 'Paulette Barrett', emergencyPhone: '876-555-0145' }, [P0, P2]).value;
      const fold = g.drive.put(null, { name: Core.gate.folderName(value.name, Core.gate.reg.studentId(value.name, value.programme)), mimeType: F,
        parents: [g.cfg.traineesId], description: Core.gate.folderDescription(acct, 'pending') }, '');
      const file = g.drive.put(null, { name: Core.gate.reg.fileName(acct), parents: [g.cfg.registrationsId] },
        JSON.stringify(Core.gate.reg.build({ acct, email, value, folder: { id: fold.id, name: fold.name }, nowMs: clock() })));
      return { acct, fold, file, stu: Core.gate.reg.studentId(value.name, value.programme) };
    };
    const T = asGate('Shantelle Barrett', 'shantelle.barrett@mail.test', P0, '876-555-0101');
    const K = asGate('Kevaughn Blake', 'kevaughn.blake@mail.test', P2, '');
    // Not registrations: another name, and one already the office's.
    g.drive.put(null, { name: 'CESTISREG.notes.txt', parents: [g.cfg.registrationsId] }, 'not one');
    const dupEmail = C.trainees[3].acct.email;
    const D = asGate('Dupli Cate', dupEmail, P0, '');
    const n0 = R.requests.length;
    let res = await R.collect();
    const regLooks = R.requests.slice(n0).filter(r => r.method === 'GET' && /CESTISREG/.test(decodeURIComponent(r.url)) && /files\?q=/.test(r.url));
    assertEq(regLooks.length, 1, 'one query for the registrations');
    const a = R.sb.userAccounts.find(u => u.id === T.acct);
    assert(!!a && a.status === 'pending' && a.role === 'student' && a.registeredVia === 'home-registration' && a.googleVerified === true, 'a registration becomes a PENDING trainee account, its address verified');
    assert(!!a && a.gateFolderId === T.fold.id && a.phone === '876-555-0101' && a.programme === P0 && a.name === 'Shantelle Barrett' && /^pbkdf2\$/.test(a.password),
      'with the folder the gate made, the phone, the programme and the password check (never the password)');
    assert(!!a && a.username === 'shantelle.barrett' && !a.studentDataId, 'a username from the address; no trainee record until the office approves');
    assertEq((res.registrations.added || []).sort(), [T.acct, K.acct].sort(), 'both registrations collected');
    assert(!R.sb.userAccounts.some(u => u.id === D.acct), 'an address another account already has is not made a second account');
    assertEq(R.notes.filter(n => n.id === 'NOTIF-reg-' + T.acct).length, 1, 'the office is told, once (its notice is named by the account)');
    res = await R.collect();
    assertEq([R.sb.userAccounts.filter(u => u.id === T.acct).length, res.registrations.files], [1, 0], 'a second turn reads nothing again and adds nothing');
    // A newer version of the same file (sent again: the gate never does — a person editing it might): the office's copy stands.
    g.drive.put(T.file.id, null, JSON.stringify(Object.assign(JSON.parse(g.drive.files[T.file.id].content), { name: 'Tampered Name' })));
    await R.collect();
    assertEq(R.sb.userAccounts.find(u => u.id === T.acct).name, 'Shantelle Barrett', 'an account already here is never overwritten by a registration file');
    // A registration whose account the office deleted is not brought back.
    const Z = asGate('Zara Deleted', 'zara@mail.test', P0, '');
    R.cache.voctrain_deletedUserIds = JSON.stringify([Z.acct]);
    R.sb.safeJsonParse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch (e) { return f; } };
    await R.collect();
    assert(!R.sb.userAccounts.some(u => u.id === Z.acct), 'a registration the office deleted is never brought back');

    // The publisher: the folders the gate made are taken on, never a second one.
    R.forceBuild(); R.forceLook();
    for (let i = 0; i < 2; i++) await R.tick();
    const mine = acct => filesIn(g.drive, g.cfg.traineesId).filter(f => (f.description || '').indexOf('acct=' + acct) !== -1);
    assertEq([mine(T.acct).length, mine(K.acct).length], [1, 1], 'no second folder for a registration');
    const tf = g.drive.files[T.fold.id];
    assert(tf.appProperties.cestisGate === '1' && tf.appProperties.acct === T.acct, 'the gate\'s folder is taken on as the trainee\'s (every PC\'s listing sees it now)');
    assertEq([tf.name, tf.description], ['Shantelle Barrett (' + T.stu + ')', Core.gate.folderDescription(T.acct, 'pending')], 'named "<Name> (<student ID>)", still marked waiting');
    assert(!filesIn(g.drive, T.fold.id).some(f => f.name === 'from-centre.json'), 'and nothing is published for a registration still waiting');
    const cat = filesIn(g.drive, g.cfg.registrationsId).filter(f => f.name === 'catalogue.json');
    assert(cat.length === 1 && JSON.stringify(Core.gate.reg.catalogueNames(JSON.parse(cat[0].content))) === JSON.stringify([P2, P0].sort()) &&
      cat[0].appProperties.cestisKind === 'catalogue', 'the programmes taking trainees are published for the registration form (catalogue.json)');

    // Approved: the trainee's record is made, and the records go into THAT folder.
    const ua = R.sb.userAccounts.find(u => u.id === T.acct);
    ua.status = 'active'; ua.approvedAt = '2026-11-02'; ua.approvedBy = 'admin'; ua.studentDataId = T.stu; ua.updatedAt = new Date(clock() + 1000).toISOString();
    const studs = JSON.parse(R.cache.voctrain_students);
    studs.push({ id: T.stu, name: 'Shantelle Barrett', course: P0, stage: 'training', email: 'shantelle.barrett@mail.test', lastModified: ua.updatedAt });
    R.cache.voctrain_students = JSON.stringify(studs); R.sb.students = studs;
    // Rejected: the other one.
    const uk = R.sb.userAccounts.find(u => u.id === K.acct);
    uk.status = 'rejected'; uk.approvedAt = '2026-11-02'; uk.approvedBy = 'admin'; uk.updatedAt = ua.updatedAt;
    R.sb.saveUserAccounts();
    R.sb.gatePublishSoon();
    for (let i = 0; i < 40 && (R.sb._gateRun.publishing || R.sb._gateRun.buildNow); i++) await new Promise(r => setTimeout(r, 20));
    await R.tick();
    assertEq([mine(T.acct).length, mine(K.acct).length], [1, 1], 'approved or rejected: still one folder each');
    assertEq(g.drive.files[T.fold.id].description, Core.gate.folderDescription(T.acct, ''), 'approved: the waiting mark goes');
    const rec = filesIn(g.drive, T.fold.id).filter(f => f.name === 'from-centre.json');
    assert(rec.length === 1 && JSON.parse(rec[0].content).accountId === T.acct && JSON.parse(rec[0].content).studentId === T.stu, 'and the trainee\'s records are written into the folder the gate made');
    const kf = g.drive.files[K.fold.id];
    assert(kf && !kf.trashed && kf.description === Core.gate.folderDescription(K.acct, 'rejected'), 'rejected: the folder is kept, marked "registration=rejected"');
    assert(Object.values(g.drive.files).every(f => !f.trashed) && R.requests.every(r => r.method !== 'DELETE'), 'nothing deleted or binned');
    // A folder the gate made that has gone (moved away): this PC makes one instead.
    const W = asGate('Wesley Moved', 'wesley@mail.test', P2, '');
    await R.collect();
    g.drive.put(W.fold.id, { parents: ['somewhere-else'] }, null);
    const uw = R.sb.userAccounts.find(u => u.id === W.acct);
    const wstu = Core.gate.reg.studentId('Wesley Moved', P2);
    uw.status = 'active'; uw.studentDataId = wstu; uw.updatedAt = new Date(clock() + 3000).toISOString();
    const st2 = JSON.parse(R.cache.voctrain_students); st2.push({ id: wstu, name: 'Wesley Moved', course: P2, stage: 'training', lastModified: uw.updatedAt });
    R.cache.voctrain_students = JSON.stringify(st2); R.sb.saveUserAccounts();
    for (let i = 0; i < 3; i++) { R.forceBuild(); R.forceLook(); await R.tick(); }
    const wnew = mine(W.acct).filter(f => f.parents.indexOf(g.cfg.traineesId) !== -1);
    assert(wnew.length === 1 && wnew[0].id !== W.fold.id && wnew[0].name === 'Wesley Moved (' + wstu + ')' && filesIn(g.drive, wnew[0].id).some(f => f.name === 'from-centre.json'),
      'a gate folder that is no longer in Trainees/ is not used: a new one is made, with the records');

    // The office makes an account: published at once (gatePublishSoon), even right after a build.
    const nstu = Core.stableStudentId({ name: 'Marlon Samuda', course: P2 });
    R.sb.userAccounts.push({ id: 'USR-office1', name: 'Marlon Samuda', role: 'student', username: 'marlon.samuda', email: 'marlon.samuda@mail.test', programme: P2, status: 'active',
      studentDataId: nstu, password: 'pbkdf2$210000$' + '0a'.repeat(16) + '$' + '1b'.repeat(32), registeredVia: 'admin-created', createdByRole: 'adminstaff' });
    const st3 = JSON.parse(R.cache.voctrain_students); st3.push({ id: nstu, name: 'Marlon Samuda', course: P2, stage: 'training', lastModified: new Date(clock()).toISOString() });
    R.cache.voctrain_students = JSON.stringify(st3); R.sb.saveUserAccounts();
    assert(R.sb._gateRun.builtAt && Date.now() - 0 >= 0, 'a build was made a moment ago');
    assertEq(R.sb.gatePublishSoon(), true, 'the office\'s new account asks for a turn now');
    for (let i = 0; i < 100 && (R.sb._gateRun.publishing || R.sb._gateRun.buildNow || R.sb._gateRun.again); i++) await new Promise(r => setTimeout(r, 20));
    const of = mine('USR-office1');
    assert(of.length === 1 && of[0].name === 'Marlon Samuda (' + nstu + ')' && filesIn(g.drive, of[0].id).some(f => f.name === 'from-centre.json'),
      'her folder "Marlon Samuda (' + nstu + ')" is made, with her records, in the same moment');
    const off = computer('off2', g.drive, Object.assign({}, C.asStrings), { settings: { traineeGate: { url: GATE_URL, enabled: false } } });
    assertEq([off.sb.gatePublishSoon(), off.requests.length], [false, 0], 'with the gate off: nothing at all');
  }

  /* ------------------------------------------------ the card */
  console.log('The card\'s words and the trainees\' sign-in link');
  {
    const sb = A.sb;
    assertEq(sb.gateStatusText({}, null, {}).text, 'Not set up', 'no address: "Not set up"');
    const h = sb.gateHealthVerdict({ ok: true, service: 'cestis-trainee-gate', version: 1, protocol: [1], ready: { secret: true, folders: true, ledger: true, trainees: 312 } }, 1);
    h.url = GATE_URL;
    assertEq(sb.gateStatusText({ url: GATE_URL }, h, {}).text, 'Ready — version 1 · 312 trainee accounts', 'a good check: "Ready — version 1"');
    assert(/^Needs attention: the address did not answer/.test(sb.gateStatusText({ url: GATE_URL }, { url: GATE_URL, ok: false, reason: 'no-answer' }, {}).text), 'no answer: "Needs attention: …"');
    assert(/^Needs attention: not checked yet/.test(sb.gateStatusText({ url: GATE_URL }, null, {}).text), 'an address never checked says so');
    assertEq(sb.gateHealthVerdict({ service: 'something-else' }).reason, 'not-gate', 'another service is not taken for the gate');
    assertEq(sb.gateHealthVerdict({ ok: true, service: 'cestis-trainee-gate', version: 1, ready: { secret: true, folders: true, ledger: false } }).reason, 'no-accounts', 'no accounts list yet: said so');
    assertEq(sb.gateHealthVerdict({ ok: true, service: 'cestis-trainee-gate', version: 1, protocol: [2], ready: { secret: true, folders: true, ledger: true } }).reason, 'too-new', 'a gate newer than the page: said so');
    assert(sb.gateHealthVerdict({ ok: true, service: 'cestis-trainee-gate', version: 1, ready: { secret: true, folders: true, ledger: true } }, 2).newer, 'a gate older than the page expects: "A newer version is available"');
    const link = sb.gateSignInLink(GATE_URL, 'https://centre.example/lms/index.html?x=1#old');
    const m = /^https:\/\/centre\.example\/lms\/index\.html#gate=([A-Za-z0-9_-]+)$/.exec(link);
    assert(!!m, 'the link is the site\'s own page with #gate=… (' + link + ')');
    assertEq(m ? Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '', GATE_URL, 'whose fragment is the address, base64url');
    assert(sb.gateSignInLink(GATE_URL, 'https://centre.example/').indexOf('https://centre.example/index.html#gate=') === 0, 'a site address ending in / gets index.html');
    // Every word on the card names no place.
    const words = ['Not set up'].concat(Object.values(sb.GATE_REASON_TEXT));
    assert(words.every(w => !/cloud|google|drive|gmail|server|internet|apps script|network/i.test(w)), 'no word on the card says where anything is kept');
    // The address is the Centre's own: it is never written into the site's files.
    const pages = ['index.html', 'Pages/Administration.html'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    assert(!/script\.google\.com\/macros\/s\//.test(pages), 'no gate address in the site\'s files');
    // The health check goes to the address only, never anywhere else.
    const dev = computer('H', gateDrive().drive, C.asStrings, { settings: ON });
    const v = await dev.sb.gateCheckHealth(GATE_URL);
    assert(v.ok && v.version === 1 && v.url === GATE_URL, 'Check reads the address\'s answer: ready');
    assert(dev.requests.length === 1 && dev.requests[0].url === GATE_URL + '?op=health', 'with one request, to the address');
    dev.gateDown = true;
    const v2 = await dev.sb.gateCheckHealth(GATE_URL);
    assert(!v2.ok && v2.reason === 'no-answer', 'an address that does not answer: needs attention');
    assertEq(JSON.parse(dev.ls.get('cestisGatePublished')).health.reason, 'no-answer', 'the last check is kept on this PC for the card');
  }

  /* ------------------------------------------------ the office request queue */
  console.log('The office request queue shows a request the trainee withdrew');
  {
    const ctr = fs.readFileSync(path.join(ROOT, 'Cert-Transcript-Requests.html'), 'utf8');
    assert(/<option value="cancelled">Withdrawn by the trainee<\/option>/.test(ctr), 'the filter offers "Withdrawn by the trainee"');
    assert(/cancelled: 'Withdrawn by the trainee'/.test(ctr), 'a withdrawn request is labelled as such');
    assert(/statuses\.concat\(\['cancelled'\]\)/.test(ctr), 'and its status menu shows it as it is (not as "Pending")');
    assert(/\.b-cancelled\s*\{/.test(ctr), 'with a badge style of its own');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
