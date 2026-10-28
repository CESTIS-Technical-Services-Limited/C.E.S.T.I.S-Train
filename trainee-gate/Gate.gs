/* ============================================================================
   trainee-gate/Gate.gs — the trainee gate's own script: INPUT AND OUTPUT ONLY
   (docs/trainee-gate/DESIGN.md, Stage 2).

   WHAT IT IS
   A small web app that runs under the Centre's own Google account. A
   trainee's phone or a lab PC asks it for that trainee's own records — and
   only those — and hands it what the trainee sends back. Staff devices
   publish the records (one "slice" per trainee, the papers and the answer
   keys); this script never builds them, never decides who may see what, and
   never marks a test by itself: every one of those rules is Core.gate in
   cestis-core.js, the same code the dashboard and the Centre's own machine
   run. What is here is the plumbing around it — reading and writing files,
   remembering things for a minute, counting tries, sending an email code —
   so the rules can be tested in Node (tests/gate-*.test.js) and this file
   in a simulated Apps Script (tests/gate-appsscript-vm.test.js).

   Pasted as part of trainee-gate/PASTE-GATE.gs (built by build-paste.js;
   never edit the paste). Nothing calls it until an administrator sets it
   up and turns it on (SETUP.md); until then the platform works as before.

   WHERE THINGS LIVE (DESIGN.md §2)
     My Drive/CESTIS Trainee Gate/        made by this script on its first request
       _gate/gate-state.json              informational (and the live checks' test files)
       Exam keys/key.<examId>.json        read at marking and review; NEVER served
       Papers/paper.<examId>.json         served only while the exam is open
       Rooms/room.<roomId>.json           served to the room's members
       Trainees/<Name> (<student ID>)/    one per trainee account, found by the
         from-centre.json                   account id in its description
         CESTISINBOX.L-<lane>.json        what one session sent (one writer each)
         CESTISINBOX.result.<id>.json     a test this script marked
         files/                           the trainee's uploads
       Registrations/                     registrations from home (CESTISREG.<id>.json),
         catalogue.json                     and the programmes taking trainees (staff publish it)
     <the folder holding CESTIS_ACCOUNTS.json>/CESTIS_GATE.json
                                          written here, so staff devices find the folders

   SCRIPT PROPERTIES (Project Settings → Script properties)
     Made by the script (never type or share them):
       GK_SECRET                          signs every session; generated once
       GATE_ROOT_ID GATE_FOLDER_ID TRAINEES_ID KEYS_ID PAPERS_ID ROOMS_ID
       REGISTRATIONS_ID LEDGER_FOUND_ID LEDGER_NOTE GATE_SETUP_VERSION
       fold:<account>  spent:<account>  out:<session>
     An administrator MAY add:
       GATE_OFF = 1                       stop answering (sign-in, reads, deliveries)
       LEDGER_FILE_ID = <file id>         use this accounts list, not the one found by name
       GOOGLE_CLIENT_ID = <client id>     a different sign-in client than the dashboard's
       MIN_CLIENT = <stamp>               refuse clients older than this ?v= stamp
   A file named "gate-off" in the CESTIS Trainee Gate folder also stops it
   (checked once a minute) — the dashboard's "Turn off" may write one.

   THE CALLS (POST, body = JSON as text/plain so no browser pre-flight is
   needed; every answer is JSON {ok:true, …} or {ok:false, error:'<code>'}).
   A request may carry {v: <protocol>, client: '<?v= stamp>'}.
     health                     {} → {service, version, protocol, time, ready, accepting}
     auth.start                 {login} → {nonce, algo, iter, salt}
     auth.password              {login, nonce, proof} → SESSION | NEED2FA
     auth.email                 {accessToken} → SESSION | NEED2FA
     auth.2fa                   {ticket, method:'totp'|'backup'|'email', code} → SESSION
     auth.2fa.send              {ticket} → {sent, to, expiresIn}
       SESSION = {token, sessionKey, sid, lane, exp, account:{id, studentId}, serverTime}
       NEED2FA = {need2fa:true, ticket, methods:[…], email}
     pull                       {token, have?} → {h, slice | same, overlay, token?, exp?, serverTime}
     paper                      {token, examId} → {paper, centreUtcOffset, serverTime}
     attempt.get                {token, examId} → {state, attempt | result | retired, ids?}
     review                     {token, resultId} → {result, revealed}
     room.get                   {token, roomId, have?} → {room | same}
     upload                     {token, name, mime, base64, purpose, refId} → {fileId, size, name}
     file.get                   {token, fileId} → {fileId, name, mime, size, base64}
     signOut                    {token} → {}
     catalogue                  {} → {programmes:[name]}           (no sign-in: what a new trainee may register for)
     register.start             {accessToken} → {state:'new', email, programmes} | {state:'submitted', email, programme, submittedAt}
     register.submit            {accessToken, name, programme, phone?, password:'pbkdf2$…'} → {state:'submitted', …}
                                (registration from home, DESIGN.md §17: an email-account token
                                 only; refused: has-account | pending | rejected | disabled |
                                 not-open | bad-form {field} | too-many | ask-office)
     deliver                    {items:[sealed item], lane?} → {receipts:[{id, ok, reason?, retry?, dup?, result?, retired?}]}
                                (no token: each item carries its own seal; saving an
                                 attempt is a sealed record, submitting it a sealed
                                 'submit' item — marked here, answered with the result)
     diag.echo / diag.tokeninfo the live checks of SETUP.md (sizes and field names only)
   GET ?op=health (the default) or ?op=selfcheck (a page of ✓/✗ lines, counts only).
   ============================================================================ */
/* global CESTISCore, DriveApp, CacheService, PropertiesService, UrlFetchApp, MailApp, Utilities, LockService,
   ContentService, HtmlService, Logger */

// 2: registration from home (catalogue, register.start, register.submit), folders named "<Name> (<student ID>)".
var GATE_VERSION = 2;
var GATE_PROTOCOL = [1];
var GATE_SERVICE = 'cestis-trainee-gate';
// The dashboard's own sign-in client (index.html GOOGLE_DRIVE_CONFIG.CLIENT_ID) — public by nature.
var GATE_DEFAULT_CLIENT_ID = '302497466088-0b619cqa9qno2c606k4rqp742lebc5o8.apps.googleusercontent.com';
var GATE_NAMES = {
  root: 'CESTIS Trainee Gate', state: 'gate-state.json', config: 'CESTIS_GATE.json', ledger: 'CESTIS_ACCOUNTS.json',
  backup: 'CESTIS_LMS_BACKUP.json', slice: 'from-centre.json', inbox: 'CESTISINBOX', lane: 'CESTISINBOX.L-',
  result: 'CESTISINBOX.result.', files: 'files', off: 'gate-off', smokeFolder: 'smoke-description-check', smokeName: 'CESTISSMOKE.name-check.json',
  smokeWrites: 'smoke-write-rate.json', smokeResult: 'smoke-write-rate-result.json'
};
var GATE_SUBFOLDERS = [['gate', 'GATE_FOLDER_ID', '_gate'], ['keys', 'KEYS_ID', 'Exam keys'], ['papers', 'PAPERS_ID', 'Papers'],
  ['rooms', 'ROOMS_ID', 'Rooms'], ['trainees', 'TRAINEES_ID', 'Trainees'], ['reg', 'REGISTRATIONS_ID', 'Registrations']];
var GATE_LIMITS = {
  NONCE_S: 120,                       // a password challenge lasts two minutes, once
  LOCK_FAILS: 5, LOCK_S: 15 * 60,     // five wrong tries on one login: locked for 15 minutes
  START_MAX: 20,                      // more than 20 challenges for one login in 15 minutes: locked
  BUSY_FAILS_PER_MIN: 60,             // more than 60 wrong passwords a minute, all logins: password sign-in busy
  EMAIL_SIGNINS_PER_MIN: 120,         // email sign-ins a minute (each one asks Google once)
  TICKET_MS: 5 * 60 * 1000, TICKET_TRIES: 5,
  EMAIL_CODE_S: 600, EMAIL_CODE_TRIES: 6, EMAIL_RESEND_S: 60,
  CFG_S: 60, INDEX_CHECK_S: 60, CACHE_MAX_S: 21600, CHUNK_CHARS: 30000, CACHE_VALUE_CHARS: 90000,
  UPLOAD_MAX: 5 * 1024 * 1024, UPLOADS_PER_DAY: 50, UPLOAD_BYTES_PER_DAY: 100 * 1024 * 1024, FILE_GET_MAX: 10 * 1024 * 1024,
  DELIVER_MAX_ITEMS: 200, LANE_RECENT_MS: 3 * 24 * 3600 * 1000, OVERLAY_MAX: 20, DIAG_PER_MIN: 10
};
var GATE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// What a trainee may upload (DESIGN.md §5.4): pdf, images, office documents, text, zip.
var GATE_UPLOAD_TYPES = {
  pdf: ['application/pdf'], png: ['image/png'], jpg: ['image/jpeg'], jpeg: ['image/jpeg'], gif: ['image/gif'],
  webp: ['image/webp'], heic: ['image/heic', 'image/heif'], txt: ['text/plain'],
  doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  odt: ['application/vnd.oasis.opendocument.text'], ods: ['application/vnd.oasis.opendocument.spreadsheet'],
  odp: ['application/vnd.oasis.opendocument.presentation'], zip: ['application/zip', 'application/x-zip-compressed']
};

/* ---------------------------------------------------------------- entry */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var op = String(p.op || 'health');
  if (op === 'selfcheck') {
    var page;
    try { page = gateSelfCheckPage(gateContext(), p); }
    catch (err) { gateLog('selfcheck', err); page = '<p>The check could not run: ' + gateEsc(gateErrCode(err)) + '. Try again in a minute.</p>'; }
    return HtmlService.createHtmlOutput(page).setTitle('Trainee sign-in from anywhere — check');
  }
  return gateJsonOut(gateRun({ op: op }, null));
}

function doPost(e) {
  var body = e && e.postData ? e.postData.contents : '';
  var req = null;
  try { req = JSON.parse(body); } catch (err) { req = null; }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return gateJsonOut({ ok: false, error: 'bad-request' });
  return gateJsonOut(gateRun(req, body));
}

var GATE_OPS = {
  'health': function (G) { return gateHealth(G); },
  'auth.start': gateAuthStart, 'auth.password': gateAuthPassword, 'auth.email': gateAuthEmail,
  'auth.2fa': gateAuthTwoStep, 'auth.2fa.send': gateAuthTwoStepSend,
  'pull': gatePull, 'paper': gatePaper, 'attempt.get': gateAttemptGet, 'review': gateReview, 'room.get': gateRoomGet,
  'upload': gateUpload, 'file.get': gateFileGet, 'signOut': gateSignOut, 'deliver': gateDeliver,
  'catalogue': gateCatalogue, 'register.start': gateRegisterStart, 'register.submit': gateRegisterSubmit,
  'diag.echo': gateDiagEcho, 'diag.tokeninfo': gateDiagTokenInfo
};
// Answered even when the gate is switched off (a check must still say so).
var GATE_ALWAYS = { 'health': 1, 'diag.echo': 1, 'diag.tokeninfo': 1 };

function gateRun(req, rawBody) {
  var op = String(req.op || '');
  var fn = Object.prototype.hasOwnProperty.call(GATE_OPS, op) ? GATE_OPS[op] : null;
  if (!fn) return { ok: false, error: 'unknown-op' };
  try {
    var G = gateContext();
    G.raw = rawBody;
    if (req.v != null && GATE_PROTOCOL.indexOf(Number(req.v)) === -1) return { ok: false, error: 'client-too-old' };
    var cfg = gateCfg(G);
    if (cfg.minClient && req.client != null && String(req.client) < cfg.minClient) return { ok: false, error: 'client-too-old' };
    if (!GATE_ALWAYS[op] && gateIsOff(G)) return { ok: false, error: 'off' };
    var out = fn(G, req);
    if (out && out.ok === undefined) out.ok = true;
    return out;
  } catch (err) {
    var code = gateErrCode(err);
    if (!(err && err.gateError)) gateLog(op, err);       // anything not answered on purpose shows in Executions
    var res = { ok: false, error: code };
    if (code === 'busy' || code === 'internal') res.retry = true;
    if (err && err.gateExtra) Object.keys(err.gateExtra).forEach(function (k) { res[k] = err.gateExtra[k]; });
    return res;
  }
}

/* ----------------------------------------------------- small utilities */
function gateContext() {
  return { now: Date.now(), cache: CacheService.getScriptCache(), props: PropertiesService.getScriptProperties(),
    core: CESTISCore, gate: CESTISCore.gate, crypto: GATE_CRYPTO };
}
function gateFail(code, extra) { var e = new Error(code); e.gateError = code; e.gateExtra = extra || null; throw e; }
function gateErrCode(err) {
  if (err && err.gateError) return err.gateError;
  var msg = String(err && err.message || err);
  // Drive and the other services say "too many" in several ways; all mean "try again shortly".
  if (/rate ?limit|too many|quota|service invoked|try again later|driveWriteVolume|limit exceeded|busy/i.test(msg)) return 'busy';
  return 'internal';
}
function gateLog(where, err) {
  try { console.error('[gate] ' + where + ': ' + (err && err.stack || err)); } catch (e) {}
}
function gateJsonOut(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function gateStr(v) { return v == null ? '' : String(v); }
function gateLower(v) { return gateStr(v).trim().toLowerCase(); }
function gateIso(ms) { return new Date(ms).toISOString(); }
function gateMs(v) { if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0; var t = Date.parse(v || ''); return isFinite(t) && t > 0 ? t : 0; }
function gateEsc(s) { return gateStr(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function gateQ(s) { return gateStr(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }   // inside a Drive query's '…'
function gateReEsc(s) { return gateStr(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Ids that become part of a file name: plain characters only.
function gateSafeId(s, max) { s = gateStr(s); return new RegExp('^[A-Za-z0-9._-]{1,' + (max || 100) + '}$').test(s) && !/^\.+$/.test(s) ? s : null; }
function gateKeyOf(G, text) { return G.core.hashString(gateStr(text)); }
function gateMinute(G) { return Math.floor(G.now / 60000); }
// A Drive query's date: seconds, UTC (the query's default zone).
function gateQueryDate(ms) { return new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 19); }
function gateMask(email) {
  var m = /^([^@]{0,1})[^@]*(@.*)$/.exec(gateStr(email));
  return m ? m[1] + '•••' + m[2] : '';
}
function gateRandomHex(n) { var s = ''; while (s.length < n) s += Utilities.getUuid().replace(/[^0-9a-f]/gi, '').toLowerCase(); return s.slice(0, n); }

/* ------------------------------------------- cryptography, for Core.gate
   Core.gate takes its cryptography handed in (DESIGN.md §14.1). Apps Script
   gives bytes as Java's SIGNED bytes (-128…127) and takes them the same
   way, so every byte is converted on the way in and on the way out. */
function gateSigned(bytes) {
  var out = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) { var b = bytes[i] & 255; out[i] = b > 127 ? b - 256 : b; }
  return out;
}
function gateUnsigned(bytes) {
  var out = new Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) out[i] = (bytes[i] + 256) % 256;
  return out;
}
var GATE_CRYPTO = {
  hmacHex: function (keyBytes, msg) {
    var mac = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, gateSigned(CESTISCore.gate.utf8(msg)), gateSigned(keyBytes));
    return CESTISCore.gate.toHex(gateUnsigned(mac));
  },
  sha256Hex: function (msg) {
    return CESTISCore.gate.toHex(gateUnsigned(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, gateSigned(CESTISCore.gate.utf8(msg)))));
  },
  sha1Bytes: function (bytes) {
    return gateUnsigned(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, gateSigned(bytes)));
  }
};

/* ------------------------------------------------- cache and properties */
function gateCacheJson(G, key) {
  var v = G.cache.get(key);
  if (v == null) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function gateCachePut(G, key, value, seconds) {
  var text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length > GATE_LIMITS.CACHE_VALUE_CHARS) return false;      // too big to remember: read it again next time
  try { G.cache.put(key, text, Math.min(GATE_LIMITS.CACHE_MAX_S, Math.max(1, Math.floor(seconds)))); return true; }
  catch (e) { return false; }
}
// A counter that lives `seconds` from its last change (no atomic add exists: close enough for limits).
function gateCount(G, key, seconds) {
  var n = (parseInt(G.cache.get(key), 10) || 0) + 1;
  G.cache.put(key, String(n), seconds);
  return n;
}
function gateCountOf(G, key) { return parseInt(G.cache.get(key), 10) || 0; }

/* ---------------------------------------------------------------- setup
   The first request makes the gate's secret, its folders and
   CESTIS_GATE.json (DESIGN.md §10.1 step 8). It is the only maker of the
   root folder and the shared folders. A folder an id points at that has
   gone (into the bin) is NEVER made again — that would leave the trainees'
   folders behind — the check says so instead. Setup is the one place a
   lock is taken: it runs once. */
function gateCfg(G) {
  if (G.cfg) return G.cfg;
  var c = gateCacheJson(G, 'cfg');
  if (c && c.v === GATE_VERSION) return (G.cfg = c);
  var p = G.props.getProperties();
  if (!gateSetupComplete(p)) p = gateSetupRun(G);
  G.cfg = gateCfgFrom(p);
  gateCachePut(G, 'cfg', G.cfg, GATE_LIMITS.CFG_S);
  return G.cfg;
}
function gateSetupComplete(p) {
  return /^[0-9a-f]{64}$/.test(p.GK_SECRET || '') && !!p.GATE_ROOT_ID &&
    GATE_SUBFOLDERS.every(function (s) { return !!p[s[1]]; }) && !!(p.LEDGER_FILE_ID || p.LEDGER_FOUND_ID) &&
    p.GATE_SETUP_VERSION === String(GATE_VERSION);
}
function gateCfgFrom(p) {
  var off = gateStr(p.GATE_OFF).trim().toLowerCase();
  return {
    v: GATE_VERSION, secret: p.GK_SECRET || '', rootId: p.GATE_ROOT_ID || '', gateId: p.GATE_FOLDER_ID || '',
    traineesId: p.TRAINEES_ID || '', keysId: p.KEYS_ID || '', papersId: p.PAPERS_ID || '', roomsId: p.ROOMS_ID || '',
    regId: p.REGISTRATIONS_ID || '', ledgerId: p.LEDGER_FILE_ID || p.LEDGER_FOUND_ID || '', ledgerNote: p.LEDGER_NOTE || '',
    clientId: gateStr(p.GOOGLE_CLIENT_ID).trim() || GATE_DEFAULT_CLIENT_ID,
    off: !!off && off !== '0' && off !== 'false' && off !== 'no', minClient: gateStr(p.MIN_CLIENT).trim()
  };
}
function gateNewSecret() {
  var s = '';
  for (var i = 0; i < 4; i++) s += Utilities.getUuid();
  return GATE_CRYPTO.sha256Hex(s + '|' + Date.now() + '|' + Math.random());
}
function gateFolderById(id) {
  if (!id) return null;
  try { var f = DriveApp.getFolderById(id); return f && !f.isTrashed() ? f : null; } catch (e) { return null; }
}
function gateFileById(id) {
  if (!id) return null;
  try { var f = DriveApp.getFileById(id); return f && !f.isTrashed() ? f : null; } catch (e) { return null; }
}
// Of several with the same name, the oldest — the same choice on every run.
function gateOldest(it) {
  var best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    if (!best || f.getDateCreated().getTime() < best.getDateCreated().getTime() ||
      (f.getDateCreated().getTime() === best.getDateCreated().getTime() && f.getId() < best.getId())) best = f;
  }
  return best;
}
function gateNewest(it) {
  var best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    if (!best || f.getLastUpdated().getTime() > best.getLastUpdated().getTime()) best = f;
  }
  return best;
}
function gateFirstParent(f) { var it = f.getParents(); return it.hasNext() ? it.next() : null; }
function gateReadText(file) { return file.getBlob().getDataAsString('UTF-8'); }
function gateReadJsonFile(file) { try { return JSON.parse(gateReadText(file)); } catch (e) { return null; } }

function gateSetupRun(G) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) gateFail('busy');
  try {
    var p = G.props.getProperties(), set = {};
    if (!/^[0-9a-f]{64}$/.test(p.GK_SECRET || '')) set.GK_SECRET = gateNewSecret();
    var root = null;
    if (p.GATE_ROOT_ID) root = gateFolderById(p.GATE_ROOT_ID);
    else {
      root = gateOldest(DriveApp.getRootFolder().getFoldersByName(GATE_NAMES.root)) || DriveApp.createFolder(GATE_NAMES.root);
      set.GATE_ROOT_ID = root.getId();
    }
    var ids = { root: p.GATE_ROOT_ID || set.GATE_ROOT_ID };
    GATE_SUBFOLDERS.forEach(function (s) {
      if (p[s[1]]) { ids[s[0]] = p[s[1]]; return; }
      if (!root) return;
      var f = gateOldest(root.getFoldersByName(s[2])) || root.createFolder(s[2]);
      set[s[1]] = ids[s[0]] = f.getId();
    });
    var merged = {};
    Object.keys(p).forEach(function (k) { merged[k] = p[k]; });
    Object.keys(set).forEach(function (k) { merged[k] = set[k]; });
    var led = gateFindLedger(merged);
    if (led) {
      if (!merged.LEDGER_FILE_ID && merged.LEDGER_FOUND_ID !== led.id) set.LEDGER_FOUND_ID = merged.LEDGER_FOUND_ID = led.id;
      if (merged.LEDGER_NOTE !== led.note) set.LEDGER_NOTE = merged.LEDGER_NOTE = led.note;
    }
    var allIds = GATE_SUBFOLDERS.every(function (s) { return !!ids[s[0]]; }) && !!ids.root;
    if (allIds) {
      gateWriteState(G, ids.gate, led ? led.id : '');
      if (led && led.folder) gateWriteConfigFile(G, led.folder, ids);
    }
    if (allIds && led && /^[0-9a-f]{64}$/.test(merged.GK_SECRET || '')) set.GATE_SETUP_VERSION = merged.GATE_SETUP_VERSION = String(GATE_VERSION);
    if (Object.keys(set).length) G.props.setProperties(set);
    return merged;
  } finally {
    lock.releaseLock();
  }
}
/* The accounts list (DESIGN.md §4.5): set by hand (LEDGER_FILE_ID), or the
   one found by name — exactly one → that one; several → the one beside the
   main backup, newest first. */
function gateFindLedger(p) {
  var pick = function (f, note) { return { id: f.getId(), folder: gateFirstParent(f), note: note, updated: f.getLastUpdated().getTime() }; };
  if (p.LEDGER_FILE_ID) {
    var byHand = gateFileById(p.LEDGER_FILE_ID);
    return byHand ? pick(byHand, 'set by hand') : null;
  }
  if (p.LEDGER_FOUND_ID) {
    var known = gateFileById(p.LEDGER_FOUND_ID);
    if (known && known.getName() === GATE_NAMES.ledger) return pick(known, p.LEDGER_NOTE || 'found');
  }
  var list = [], it = DriveApp.getFilesByName(GATE_NAMES.ledger);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) list.push(f); }
  if (!list.length) return null;
  if (list.length === 1) return pick(list[0], 'found');
  var beside = list.filter(function (x) {
    var par = gateFirstParent(x);
    if (!par) return false;
    var b = par.getFilesByName(GATE_NAMES.backup);
    while (b.hasNext()) if (!b.next().isTrashed()) return true;
    return false;
  });
  var pool = (beside.length ? beside : list).sort(function (a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  return pick(pool[0], 'found ' + list.length + ' copies; using ' + (beside.length ? 'the newest beside the main backup' : 'the newest'));
}
function gateWriteState(G, gateFolderId, ledgerId) {
  var fld = gateFolderById(gateFolderId);
  if (!fld) return;
  var file = gateOldest(fld.getFilesByName(GATE_NAMES.state));
  var st = file ? gateReadJsonFile(file) : null;
  var nowIso = gateIso(G.now);
  if (!st || typeof st !== 'object') st = { format: 'cestis-gate-state', version: 1, createdAt: nowIso, upgrades: [] };
  if (!Array.isArray(st.upgrades)) st.upgrades = [];
  var changed = !file;
  if (Number(st.gateVersion || 0) < GATE_VERSION) { st.upgrades.push({ version: GATE_VERSION, at: nowIso }); st.gateVersion = GATE_VERSION; changed = true; }
  if (ledgerId && st.ledgerFileId !== ledgerId) { st.ledgerFileId = ledgerId; changed = true; }
  if (!changed) return;
  if (file) file.setContent(JSON.stringify(st)); else fld.createFile(GATE_NAMES.state, JSON.stringify(st), 'application/json');
}
/* CESTIS_GATE.json beside the accounts list: how staff devices find the
   folders, so nobody ever types an id (DESIGN.md §2.1). */
function gateWriteConfigFile(G, folder, ids) {
  var body = { format: 'cestis-gate-config', version: 1, gateVersion: GATE_VERSION, protocol: GATE_PROTOCOL.slice(),
    rootId: ids.root, gateFolderId: ids.gate, traineesId: ids.trainees, keysId: ids.keys, papersId: ids.papers,
    roomsId: ids.rooms, registrationsId: ids.reg };
  var file = gateOldest(folder.getFilesByName(GATE_NAMES.config));
  if (file) {
    var cur = gateReadJsonFile(file) || {};
    var same = Object.keys(body).every(function (k) { return JSON.stringify(cur[k]) === JSON.stringify(body[k]); });
    if (same) return;
  }
  body.writtenAt = gateIso(G.now);
  if (file) file.setContent(JSON.stringify(body)); else folder.createFile(GATE_NAMES.config, JSON.stringify(body), 'application/json');
}
function gateReady(G) {
  var cfg = gateCfg(G);
  if (!cfg.secret || !cfg.ledgerId || !cfg.traineesId) gateFail('not-set-up');
  return cfg;
}
/* Switched off (DESIGN.md §10.5): the GATE_OFF property, or a "gate-off"
   file in the gate's folder (looked for at most once a minute). Outboxes
   keep everything meanwhile: an 'off' answer is never a refusal. */
function gateIsOff(G) {
  var cfg = gateCfg(G);
  if (cfg.off) return true;
  var known = G.cache.get('off:file');
  if (known != null) return known === '1';
  var root = gateFolderById(cfg.rootId), off = false;
  if (root) { var it = root.getFilesByName(GATE_NAMES.off); while (it.hasNext()) if (!it.next().isTrashed()) off = true; }
  G.cache.put('off:file', off ? '1' : '0', 60);
  return off;
}

/* -------------------------------------------------------- accounts index
   The accounts list staff already publish (CESTIS_ACCOUNTS.json), read at
   most once a minute and only when it changed, cut down to trainee accounts
   and remembered in the cache in pieces (DESIGN.md §4.5). What the index
   holds, and which account a login names, are Core.gate.indexAccounts and
   Core.gate.lookupLogin — the Centre server's gate uses the same two. */
function gateIndex(G) {
  if (G.idx) return G.idx;
  var cfg = gateReady(G);
  var meta = gateCacheJson(G, 'ix:m');
  if (meta && G.cache.get('ix:c') === String(meta.updated) && meta.ledgerId === cfg.ledgerId) {
    var hot = gateIndexChunks(G, meta);
    if (hot) return (G.idx = hot);
  }
  var file = gateFileById(cfg.ledgerId);
  if (!file) {
    // The list went away: find it again next time (setup runs again).
    G.props.deleteProperty('LEDGER_FOUND_ID');
    G.props.deleteProperty('GATE_SETUP_VERSION');
    G.cache.remove('cfg');
    gateFail('not-set-up');
  }
  var updated = file.getLastUpdated().getTime();
  if (meta && meta.updated === updated && meta.ledgerId === cfg.ledgerId) {
    var same = gateIndexChunks(G, meta);
    if (same) { G.cache.put('ix:c', String(updated), GATE_LIMITS.INDEX_CHECK_S); return (G.idx = same); }
  }
  var led = gateReadJsonFile(file);
  if (!led || !Array.isArray(led.accounts) || Number(led.version || 1) > 1) {
    // Unreadable, or written by a newer dashboard: keep the last good copy, never read it as empty.
    var last = meta ? gateIndexChunks(G, meta) : null;
    gateLog('index', 'accounts list not readable (version ' + (led && led.version) + '); ' + (last ? 'keeping the last good copy' : 'none kept'));
    if (last) return (G.idx = last);
    gateFail('busy');
  }
  var idx = gateBuildIndex(G, led, updated, cfg.ledgerId);
  var text = JSON.stringify(idx), n = Math.ceil(text.length / GATE_LIMITS.CHUNK_CHARS) || 1, parts = {};
  for (var i = 0; i < n; i++) parts['ix:' + updated + ':' + i] = text.slice(i * GATE_LIMITS.CHUNK_CHARS, (i + 1) * GATE_LIMITS.CHUNK_CHARS);
  try {
    G.cache.putAll(parts, GATE_LIMITS.CACHE_MAX_S);
    G.cache.put('ix:m', JSON.stringify({ ledgerId: cfg.ledgerId, updated: updated, n: n }), GATE_LIMITS.CACHE_MAX_S);
    G.cache.put('ix:c', String(updated), GATE_LIMITS.INDEX_CHECK_S);
  } catch (e) { gateLog('index cache', e); }
  return (G.idx = idx);
}
function gateIndexChunks(G, meta) {
  var keys = [];
  for (var i = 0; i < meta.n; i++) keys.push('ix:' + meta.updated + ':' + i);
  var got = G.cache.getAll(keys), text = '';
  for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; text += got[keys[j]]; }
  try { return JSON.parse(text); } catch (e) { return null; }
}
function gateBuildIndex(G, led, updated, ledgerId) {
  var idx = G.gate.indexAccounts(led.accounts, led.deletedUserIds, G.crypto);
  idx.v = 1; idx.ledgerId = ledgerId; idx.updated = updated;
  return idx;
}

/* --------------------------------------------- a trainee's folder, files
   Found by the account id in its description, never by its name (student
   IDs move: DESIGN.md §1.2): remembered, else by the name the account's
   link gives, else by a search of the descriptions — and of several, the
   oldest. Every use checks the folder still names the account. */
function gateDescribes(folder, acct) {
  return new RegExp('(^|\\s)acct=' + gateReEsc(acct) + '(\\s|$)').test(gateStr(folder.getDescription()));
}
function gateTraineeFolder(G, acct, entry) {
  var cfg = gateReady(G), key = 'fd:' + acct;
  var checkId = function (id) {
    var f = gateFolderById(id);
    return f && gateDescribes(f, acct) ? f : null;
  };
  var known = G.cache.get(key);
  if (known === '-') return null;
  var f = known ? checkId(known) : null;
  if (!f) { var saved = G.props.getProperty('fold:' + acct); f = saved ? checkId(saved) : null; }
  if (!f) {
    var trainees = gateFolderById(cfg.traineesId);
    if (!trainees) gateFail('not-set-up');
    // The oldest; at the same moment, the lower id — the rule every staff device uses too.
    var older = function (a, b) {
      var ta = a.getDateCreated().getTime(), tb = b.getDateCreated().getTime();
      return ta < tb || (ta === tb && a.getId() < b.getId());
    };
    var pickOldest = function (it) {
      var best = null;
      while (it.hasNext()) {
        var x = it.next();
        if (x.isTrashed() || !gateDescribes(x, acct)) continue;
        if (!best || older(x, best)) best = x;
      }
      return best;
    };
    if (entry && entry.sdi) f = pickOldest(trainees.getFoldersByName(entry.sdi));
    var found = pickOldest(trainees.searchFolders("fullText contains 'acct=" + gateQ(acct) + "' and trashed = false"));
    if (found && (!f || older(found, f))) f = found;
    if (!f) { G.cache.put(key, '-', 60); return null; }
    if (G.props.getProperty('fold:' + acct) !== f.getId()) G.props.setProperty('fold:' + acct, f.getId());
  }
  G.cache.put(key, f.getId(), GATE_LIMITS.CACHE_MAX_S);
  return f;
}
/* A published JSON file, remembered by its last change (only small ones). */
function gateJsonOf(G, file, cacheKey) {
  var upd = file.getLastUpdated().getTime();
  var hit = cacheKey ? gateCacheJson(G, cacheKey) : null;
  if (hit && hit.u === upd && hit.id === file.getId()) return hit.j;
  var j = gateReadJsonFile(file);
  if (cacheKey && j) gateCachePut(G, cacheKey, { u: upd, id: file.getId(), j: j }, GATE_LIMITS.CACHE_MAX_S);
  return j;
}
/* The trainee's slice (from-centre.json, written by staff devices). A slice
   of a newer version than this script reads is never read as empty. */
function gateSliceOf(G, acct, folder) {
  var file = gateNewest(folder.getFilesByName(GATE_NAMES.slice));
  if (!file) return { error: 'not-ready' };
  var s = gateJsonOf(G, file, 'sl:' + acct);
  if (!s || s.format !== G.gate.FORMAT.slice) return { error: 'not-ready' };
  if (Number(s.version) > G.gate.VERSION) return { error: 'newer-version' };
  if (gateStr(s.accountId) !== gateStr(acct) || !s.studentId) return { error: 'not-ready' };
  return { slice: s, file: file };
}
function gatePlace(G, acct, entry) {
  var folder = gateTraineeFolder(G, acct, entry);
  if (!folder) return { error: 'not-ready' };
  var s = gateSliceOf(G, acct, folder);
  if (s.error) return s;
  return { folder: folder, slice: s.slice };
}
function gateSharedFile(G, folderId, name, cacheKey) {
  var fld = gateFolderById(folderId);
  if (!fld) return null;
  var file = gateNewest(fld.getFilesByName(name));
  if (!file) return null;
  return gateJsonOf(G, file, cacheKey);
}
function gateKeyFile(G, examId) {
  var k = gateSharedFile(G, gateCfg(G).keysId, 'key.' + examId + '.json', 'kf:' + examId);
  return k && k.format === G.gate.FORMAT.key && Number(k.version) <= G.gate.VERSION ? k : null;
}
function gatePaperFile(G, examId) {
  var p = gateSharedFile(G, gateCfg(G).papersId, 'paper.' + examId + '.json', 'pf:' + examId);
  return p && p.format === G.gate.FORMAT.paper && Number(p.version) <= G.gate.VERSION ? p : null;
}
/* What this trainee has sent: their lanes and the results marked here.
   opts: { since (ms: only files changed after), lanes, results }. */
function gateInbox(G, folder, opts) {
  opts = opts || {};
  var q = "title contains '" + GATE_NAMES.inbox + "' and trashed = false";
  if (opts.since) q += " and modifiedDate > '" + gateQueryDate(opts.since) + "'";
  var it = folder.searchFiles(q), out = { lanes: [], results: [], files: [] };
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    var name = f.getName(), upd = f.getLastUpdated().getTime();
    var isLane = name.indexOf(GATE_NAMES.lane) === 0, isResult = name.indexOf(GATE_NAMES.result) === 0;
    if (!(isLane && opts.lanes) && !(isResult && opts.results)) continue;
    if (isLane && opts.lanesSince && upd < opts.lanesSince) continue;
    out.files.push({ f: f, name: name, upd: upd, lane: isLane });
  }
  out.files.sort(function (a, b) { return b.upd - a.upd; });
  if (opts.max && out.files.length > opts.max) { out.truncated = true; out.files = out.files.slice(0, opts.max); }
  out.files.forEach(function (x) {
    // A result file never changes once written: remembered by its id.
    var j = x.lane ? gateReadJsonFile(x.f) : gateJsonOf(G, x.f, 'rf:' + x.f.getId());
    if (!j || typeof j !== 'object' || Number(j.version) > G.gate.VERSION) return;
    if (x.lane && j.format === G.gate.FORMAT.inbox) { j._file = x.f.getId(); out.lanes.push(j); }
    if (!x.lane && j.format === G.gate.FORMAT.result) out.results.push(j);
  });
  return out;
}

/* ---------------------------------------------------------- sign-in (§4) */
function gateLoginKey(G, login) { return gateKeyOf(G, 'login|' + gateLower(login)); }
function gateAcctKey(G, acct) { return gateKeyOf(G, 'acct|' + acct); }
// Tries are counted against the ACCOUNT a login names (username or email alike), else the words typed.
function gateTriesKey(G, look, login) { return look && look.id ? gateAcctKey(G, look.id) : gateLoginKey(G, login); }
function gateLocked(G, key) {
  return gateCountOf(G, 'f:' + key) >= GATE_LIMITS.LOCK_FAILS || gateCountOf(G, 's:' + key) > GATE_LIMITS.START_MAX;
}
function gateFailed(G, key) {
  gateCount(G, 'f:' + key, GATE_LIMITS.LOCK_S);
  gateCount(G, 'fm:' + gateMinute(G), 120);
}
function gateBusy(G) { return gateCountOf(G, 'fm:' + gateMinute(G)) > GATE_LIMITS.BUSY_FAILS_PER_MIN; }

function gateAuthStart(G, req) {
  var login = gateStr(req.login).trim();
  if (!login || login.length > 200) gateFail('bad-request');
  gateReady(G);
  var look = G.gate.lookupLogin(gateIndex(G), login), key = gateTriesKey(G, look, login);
  if (gateLocked(G, key)) return { ok: false, error: 'locked', retryAfter: GATE_LIMITS.LOCK_S };
  if (gateBusy(G)) return { ok: false, error: 'busy', retry: true };
  if (gateCount(G, 's:' + key, GATE_LIMITS.LOCK_S) > GATE_LIMITS.START_MAX) return { ok: false, error: 'locked', retryAfter: GATE_LIMITS.LOCK_S };
  if (look.ambiguous) return { ok: false, error: 'ask-office', why: 'ambiguous' };
  var nonce = gateRandomHex(32);
  G.cache.put('n:' + nonce, JSON.stringify({ l: gateLower(login) }), GATE_LIMITS.NONCE_S);
  // An unknown login is given a believable challenge (Core.gate.proof.challenge).
  var ch = G.gate.proof.challenge(look.e ? look.e.pw : null, login, gateCfg(G).secret, G.crypto);
  return { ok: true, nonce: nonce, algo: ch.algo, iter: ch.iter, salt: ch.salt };
}

function gateAuthPassword(G, req) {
  var login = gateStr(req.login).trim(), nonce = gateStr(req.nonce);
  if (!login || !/^[0-9a-f]{32}$/.test(nonce)) gateFail('bad-request');
  gateReady(G);
  var look = G.gate.lookupLogin(gateIndex(G), login), key = gateTriesKey(G, look, login);
  if (gateLocked(G, key)) return { ok: false, error: 'locked', retryAfter: GATE_LIMITS.LOCK_S };
  if (gateBusy(G)) return { ok: false, error: 'busy', retry: true };
  var held = gateCacheJson(G, 'n:' + nonce);
  G.cache.remove('n:' + nonce);                       // a challenge is answered once
  if (!held || held.l !== gateLower(login)) return { ok: false, error: 'bad-nonce' };
  if (look.ambiguous) return { ok: false, error: 'ask-office', why: 'ambiguous' };
  if (!look.e || !G.gate.proof.verify(look.e.pw, nonce, login, gateStr(req.proof), G.crypto)) {
    gateFailed(G, key);
    return { ok: false, error: 'no-match' };
  }
  G.cache.remove('f:' + key);
  return gateAfterCredential(G, look.id, look.e, 'password');
}

/* Signed in with the trainee's own email account: the device sends the
   access token today's sign-in already gets; Google says whose it is, for
   which app, and whether the address is verified (DESIGN.md §4.2). */
function gateTokenInfo(token) {
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  try { return JSON.parse(resp.getContentText()); } catch (e) { return null; }
}
/* Google's word on an access token: given to THIS dashboard (aud), for a
   verified address, not expired, with the email scope. Email sign-in and
   registration from home both rest on it. → { info } | { out: refusal } */
function gateEmailToken(G, req) {
  var token = gateStr(req.accessToken);
  if (!/^[A-Za-z0-9._~+\/-]{10,4096}=*$/.test(token)) gateFail('bad-request');
  var cfg = gateReady(G);
  if (gateCount(G, 'em:' + gateMinute(G), 120) > GATE_LIMITS.EMAIL_SIGNINS_PER_MIN) return { out: { ok: false, error: 'busy', retry: true } };
  var info = gateTokenInfo(token);
  if (!info) return { out: { ok: false, error: 'bad-token' } };
  if (!(gateStr(info.aud) === cfg.clientId || (!info.aud && gateStr(info.azp) === cfg.clientId))) return { out: { ok: false, error: 'wrong-app' } };
  if (gateStr(info.email_verified) !== 'true') return { out: { ok: false, error: 'unverified-email' } };
  if (!(Number(info.expires_in) > 0)) return { out: { ok: false, error: 'bad-token' } };
  if (!/(^|\s)(https:\/\/www\.googleapis\.com\/auth\/userinfo\.email|email)(\s|$)/.test(gateStr(info.scope))) return { out: { ok: false, error: 'bad-token' } };
  return { info: info };
}
function gateAuthEmail(G, req) {
  var t = gateEmailToken(G, req);
  if (t.out) return t.out;
  var info = t.info;
  var look = G.gate.lookupLogin(gateIndex(G), info.email, { emailOnly: true, allowNoPassword: true });
  if (look.ambiguous) return { ok: false, error: 'ask-office', why: 'ambiguous' };
  if (!look.e) return { ok: false, error: 'not-found' };
  return gateAfterCredential(G, look.id, look.e, 'email');
}

/* ------------------------------------------- registration from home (§17)
   A new trainee registers from home, signed in with their own email
   account: the owner's rule, and the only way to register from outside the
   Centre — Google must vouch for the token (gateEmailToken). In the same
   request the gate then:
     - keeps the registration: Registrations/CESTISREG.<account id>.json
       (Core.gate.reg.build: name, address, programme, phone, the password
       as the dashboard stores one — worked out on the trainee's device);
     - makes the trainee's own folder: Trainees/"<Name> (<student ID>)",
       described "cestis-trainee acct=<account id> v=1 registration=pending"
       (the student ID the dashboard will give them: Core.gate.reg.studentId).
   The office's computers bring the registration into Verify Users
   (index.html, the collector). The account id comes from the address and
   the gate's secret (Core.gate.reg.accountId): the same person sending it
   twice finds their registration, never makes a second one. An address
   that already has a trainee account is told to sign in (or how its
   registration stands). Limits: 5 tries an hour for one address, 60
   registrations an hour and 200 in six hours for everybody (each makes a
   folder). The one lock in the gate besides setup is taken here, briefly:
   registrations are rare, and two taps of Register must not make two
   folders. */
var GATE_REG = { CATALOGUE: 'catalogue.json', PER_ADDRESS_PER_HOUR: 5, PER_HOUR: 60, PER_6H: 200, CATALOGUE_S: 60, LOCK_MS: 10000 };
function gateRegFolder(G) {
  var f = gateFolderById(gateReady(G).regId);
  if (!f) gateFail('not-set-up');
  return f;
}
// The programmes taking trainees, as staff devices last published them (remembered a minute).
function gateCatalogueNames(G) {
  var hit = gateCacheJson(G, 'cat');
  if (hit && Array.isArray(hit.p)) return hit.p;
  var f = gateNewest(gateRegFolder(G).getFilesByName(GATE_REG.CATALOGUE));
  var names = f ? G.gate.reg.catalogueNames(gateReadJsonFile(f)) : [];
  gateCachePut(G, 'cat', { p: names }, GATE_REG.CATALOGUE_S);
  return names;
}
function gateCatalogue(G) { return { ok: true, programmes: gateCatalogueNames(G) }; }
// A registration already kept for this account id (by its exact name: no search, no lag).
function gateRegFileOf(G, acct) {
  var f = gateOldest(gateRegFolder(G).getFilesByName(G.gate.reg.fileName(acct)));
  if (!f) return null;
  var r = G.gate.reg.read(gateReadJsonFile(f));
  return r.reg || { unreadable: true };
}
function gateRegSubmitted(email, reg) {
  return { ok: true, state: 'submitted', email: email, programme: gateStr(reg.programme), submittedAt: gateStr(reg.createdAt) };
}
/* Who is registering: Google's word on the token; then whether the address
   already has a trainee account (→ sign in, or how it stands) or a
   registration waiting (→ "it has reached the office"). */
function gateRegWho(G, req) {
  var t = gateEmailToken(G, req);
  if (t.out) return { out: t.out };
  var email = gateStr(t.info.email).trim();
  if (!GATE_EMAIL_RE.test(email)) return { out: { ok: false, error: 'bad-token' } };
  var look = G.gate.lookupLogin(gateIndex(G), email, { emailOnly: true, allowNoPassword: true });
  if (look.ambiguous) return { out: { ok: false, error: 'ask-office', why: 'ambiguous' } };
  if (look.e) return { out: { ok: false, error: G.gate.reg.existing(look.e) } };
  var acct = G.gate.reg.accountId(email, gateCfg(G).secret, G.crypto);
  var reg = gateRegFileOf(G, acct);
  if (reg) return { out: gateRegSubmitted(email, reg) };
  return { email: email, acct: acct };
}
function gateRegisterStart(G, req) {
  var w = gateRegWho(G, req);
  if (w.out) return w.out;
  var programmes = gateCatalogueNames(G);
  if (!programmes.length) return { ok: false, error: 'not-open' };
  return { ok: true, state: 'new', email: w.email, programmes: programmes };
}
function gateRegisterSubmit(G, req) {
  var w = gateRegWho(G, req);
  if (w.out) { if (w.out.state === 'submitted') w.out.already = true; return w.out; }
  var programmes = gateCatalogueNames(G);
  if (!programmes.length) return { ok: false, error: 'not-open' };
  var chk = G.gate.reg.check({ name: req.name, programme: req.programme, phone: req.phone, password: req.password }, programmes);
  if (!chk.ok) return { ok: false, error: 'bad-form', field: chk.field };
  var akey = 'rga:' + gateAcctKey(G, w.acct), hkey = 'rgh:' + Math.floor(G.now / 3600000), skey = 'rg6:' + Math.floor(G.now / 21600000);
  if (gateCountOf(G, akey) >= GATE_REG.PER_ADDRESS_PER_HOUR || gateCountOf(G, hkey) >= GATE_REG.PER_HOUR || gateCountOf(G, skey) >= GATE_REG.PER_6H) {
    return { ok: false, error: 'too-many', retryAfter: 3600 };
  }
  gateCount(G, akey, 3600); gateCount(G, hkey, 3600); gateCount(G, skey, 21600);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(GATE_REG.LOCK_MS)) gateFail('busy');
  try {
    var again = gateRegFileOf(G, w.acct);
    if (again) { var a = gateRegSubmitted(w.email, again); a.already = true; return a; }
    var v = chk.value, cfg = gateCfg(G);
    // A folder made by an earlier try that could not finish is that same folder (never a second).
    var folder = gateTraineeFolder(G, w.acct, null);
    if (!folder) {
      var trainees = gateFolderById(cfg.traineesId);
      if (!trainees) gateFail('not-set-up');
      folder = trainees.createFolder(G.gate.folderName(v.name, G.gate.reg.studentId(v.name, v.programme)));
      folder.setDescription(G.gate.folderDescription(w.acct, 'pending'));
    }
    G.props.setProperty('fold:' + w.acct, folder.getId());
    G.cache.put('fd:' + w.acct, folder.getId(), GATE_LIMITS.CACHE_MAX_S);
    var body = G.gate.reg.build({ acct: w.acct, email: w.email, value: v, folder: { id: folder.getId(), name: folder.getName() }, nowMs: G.now });
    gateRegFolder(G).createFile(G.gate.reg.fileName(w.acct), JSON.stringify(body), 'application/json');
    return gateRegSubmitted(w.email, body);
  } finally {
    lock.releaseLock();
  }
}

/* The credential is right: may this account go on, and does it need its
   second step? (The dashboard's loginBlocked and tfaGateLogin, as the gate
   sees them: Core.gate.credentialRefusal and Core.gate.twoStep.) */
function gateAfterCredential(G, acct, e, via) {
  var refusal = G.gate.credentialRefusal(e, via);
  if (refusal) return Object.assign({ ok: false }, refusal);
  var place = gatePlace(G, acct, e);
  if (place.error) return { ok: false, error: place.error };
  // Emailed codes can be sent from here. The spent codes are read only when a second step is needed.
  var two = G.gate.twoStep(e, function () { return gateUnusedCodes(G, acct, e); }, true);
  if (two.needed) {
    var ticket = G.gate.ticketMake({ a: acct, cv: e.cv, exp: G.now + GATE_LIMITS.TICKET_MS, m: two.methods, via: via, n: gateRandomHex(8) },
      gateCfg(G).secret, G.crypto);
    return { ok: true, need2fa: true, ticket: ticket, methods: two.methods, email: e.eo ? gateMask(e.em) : '' };
  }
  return gateIssue(G, acct, e, place, []);
}
/* A session (DESIGN.md §4.4). The session id carries its credential
   version in its random part (Core.gate.sidRand) — sealed by the gate's own
   secret — so an item sealed in a session whose password has since been
   reset is known for what it is (revoked) without any table of sessions. */
function gateIssue(G, acct, e, place, ops) {
  var cfg = gateCfg(G);
  var sid = G.gate.sid.make(G.now, G.gate.sidRand(e.cv, gateRandomHex(12)), cfg.secret, G.crypto);
  var exp = G.now + G.gate.token.TTL_MS;
  var token = G.gate.token.sign({ a: acct, s: place.slice.studentId, sid: sid, iat: G.now, exp: exp, cv: e.cv }, cfg.secret, G.crypto);
  if (ops && ops.length) {
    try {
      var laneId = 'L-' + sid, lane = gateLaneNew(G, acct, place.slice.studentId, laneId);
      ops.forEach(function (op) { lane.ops.push(op); });
      gateLaneWrite(G, place.folder, laneId, null, lane);
    } catch (err) { gateLog('backup-code note', err); }  // the spent list below still refuses the code here
  }
  return { ok: true, token: token, sessionKey: G.gate.sessionKey(cfg.secret, acct, sid, G.crypto), sid: sid, lane: 'L-' + sid,
    exp: exp, account: { id: acct, studentId: place.slice.studentId }, serverTime: gateIso(G.now) };
}

/* Two-step (DESIGN.md §4.3). The ticket is Core.gate.ticketMake's; here it
   is also refused once used, or after too many wrong codes. */
function gateTicketRead(G, ticket) {
  var c = G.gate.ticketRead(ticket, gateCfg(G).secret, G.crypto, G.now);
  if (c.error) return c;
  if (G.cache.get('tu:' + c.mac)) return { error: 'bad-ticket' };
  if (gateCountOf(G, 'tf:' + c.mac) >= GATE_LIMITS.TICKET_TRIES) return { error: 'bad-ticket' };
  return c;
}
// Backup codes still good here: unused in the accounts list and not spent at the gate since.
function gateUnusedCodes(G, acct, e) {
  var spent = gateSpent(G, acct);
  return (e.bc || []).filter(function (c) { return spent.indexOf(G.gate.codeHash(c)) === -1; });
}
function gateSpent(G, acct) {
  try { var v = JSON.parse(G.props.getProperty('spent:' + acct) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function gateAuthTwoStep(G, req) {
  gateReady(G);
  var t = gateTicketRead(G, req.ticket);
  if (t.error) return { ok: false, error: t.error };
  var idx = gateIndex(G), e = idx.a[t.a];
  if (!e || e.cv !== t.cv) return { ok: false, error: 'revoked' };
  var akey = gateAcctKey(G, t.a);
  if (gateLocked(G, akey)) return { ok: false, error: 'locked', retryAfter: GATE_LIMITS.LOCK_S };
  var method = gateStr(req.method), code = gateStr(req.code).replace(/\s+/g, ''), ok = false, ops = [], why = 'bad-code';
  var methods = Array.isArray(t.m) ? t.m : [];
  if (methods.indexOf(method) === -1) return { ok: false, error: 'not-allowed' };
  if (method === 'totp') {
    var v = G.gate.totp.verify(e.tf, code, G.now, G.crypto, { used: function (step) { return G.cache.get('tt:' + t.a + ':' + step) != null; } });
    if (v.ok) { ok = true; G.cache.put('tt:' + t.a + ':' + v.step, '1', 120); }
    else if (v.reason === 'used') why = 'code-used';
  } else if (method === 'backup') {
    var c = code.toUpperCase();
    if (c && gateUnusedCodes(G, t.a, e).indexOf(c) !== -1) {
      ok = true;
      var h = G.gate.codeHash(c), spent = gateSpent(G, t.a);
      // Prune what the accounts list itself now shows as used, then add this one.
      var live = (e.bc || []).map(function (x) { return G.gate.codeHash(x); });
      spent = spent.filter(function (x) { return live.indexOf(x) !== -1; });
      spent.push(h);
      G.props.setProperty('spent:' + t.a, JSON.stringify(spent));
      ops.push({ id: 'OP-bc-' + h, kind: 'backupCodeUsed', codeHash: h, at: gateIso(G.now) });
    }
  } else if (method === 'email') {
    var ec = gateCacheJson(G, 'ec:' + t.mac);
    if (ec && /^\d{6}$/.test(code)) {
      if (G.gate.same(G.crypto.sha256Hex('ec|' + t.a + '|' + code), ec.h)) { ok = true; G.cache.remove('ec:' + t.mac); }
      else {
        ec.n = (ec.n || 0) + 1;
        if (ec.n >= GATE_LIMITS.EMAIL_CODE_TRIES) G.cache.remove('ec:' + t.mac);
        else G.cache.put('ec:' + t.mac, JSON.stringify(ec), GATE_LIMITS.EMAIL_CODE_S);
      }
    }
  }
  if (!ok) {
    var tries = gateCount(G, 'tf:' + t.mac, Math.ceil(GATE_LIMITS.TICKET_MS / 1000));
    gateFailed(G, akey);
    return { ok: false, error: why, triesLeft: Math.max(0, GATE_LIMITS.TICKET_TRIES - tries) };
  }
  G.cache.put('tu:' + t.mac, '1', Math.ceil(GATE_LIMITS.TICKET_MS / 1000));
  G.cache.remove('f:' + akey);
  var place = gatePlace(G, t.a, e);
  if (place.error) return { ok: false, error: place.error };
  return gateIssue(G, t.a, e, place, ops);
}
function gateAuthTwoStepSend(G, req) {
  gateReady(G);
  var t = gateTicketRead(G, req.ticket);
  if (t.error) return { ok: false, error: t.error };
  if ((t.m || []).indexOf('email') === -1) return { ok: false, error: 'not-allowed' };
  var e = gateIndex(G).a[t.a];
  if (!e || e.cv !== t.cv) return { ok: false, error: 'revoked' };
  if (!e.eo || !GATE_EMAIL_RE.test(e.em)) return { ok: false, error: 'no-email' };
  if (G.cache.get('es:' + t.a)) return { ok: false, error: 'too-soon', retryAfter: GATE_LIMITS.EMAIL_RESEND_S };
  if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, error: 'mail-quota' };
  var n = parseInt(gateRandomHex(8), 16) % 1000000, code = String(1000000 + n).slice(1);
  G.cache.put('ec:' + t.mac, JSON.stringify({ h: G.crypto.sha256Hex('ec|' + t.a + '|' + code), n: 0 }), GATE_LIMITS.EMAIL_CODE_S);
  try {
    MailApp.sendEmail({ to: e.em, subject: 'Your sign-in code',
      body: 'Your sign-in code is ' + code + '.\n\nIt works once, for the next 10 minutes. If you did not try to sign in, ignore this email and tell the office.' });
  } catch (err) { gateLog('mail', err); return { ok: false, error: 'mail-failed', retry: true }; }
  G.cache.put('es:' + t.a, '1', GATE_LIMITS.EMAIL_RESEND_S);
  return { ok: true, sent: true, to: gateMask(e.em), expiresIn: GATE_LIMITS.EMAIL_CODE_S };
}

/* -------------------------------------------------- signed-in requests */
function gateSignedOut(G, sid) {
  var got = G.cache.getAll(['out:' + sid, 'in:' + sid]);
  if (got['out:' + sid]) return true;
  if (got['in:' + sid]) return false;
  var exp = Number(G.props.getProperty('out:' + sid)) || 0;
  if (exp > G.now) { G.cache.put('out:' + sid, '1', Math.min(GATE_LIMITS.CACHE_MAX_S, Math.ceil((exp - G.now) / 1000))); return true; }
  G.cache.put('in:' + sid, '1', 600);
  return false;
}
/* Who is asking: the token checked against the accounts list as it is now
   (a password reset, a switch-off or a two-step change revokes it within the
   minute), not signed out, and their folder and slice. */
function gateSession(G, req) {
  var cfg = gateReady(G), idx = gateIndex(G);
  var v = G.gate.token.verify(gateStr(req.token), cfg.secret, G.crypto, {
    nowMs: G.now, cvOf: function (a) { var e = idx.a[a]; return e ? e.cv : null; }
  });
  if (!v.ok) gateFail(v.reason === 'expired' ? 'expired' : (v.reason === 'revoked' || v.reason === 'unknown-account') ? 'revoked' : 'bad-token');
  var c = v.claims, e = idx.a[c.a];
  if (gateSignedOut(G, c.sid)) gateFail('signed-out');
  if (e.st !== 'ok' && e.st !== 'no-password') gateFail('revoked');
  var place = gatePlace(G, c.a, e);
  if (place.error) gateFail(place.error);
  return { claims: c, entry: e, folder: place.folder, slice: place.slice, refresh: v.refresh,
    me: { acct: gateStr(c.a), stu: gateStr(place.slice.studentId) } };
}
function gateRedact(G, result, key) {
  return G.gate.redactResult(result, key ? key.exam : null, G.now, key ? key.centreUtcOffset : undefined);
}
function gateAccessHas(slice, list, id) {
  return !!(slice.access && Array.isArray(slice.access[list]) && slice.access[list].map(String).indexOf(String(id)) !== -1);
}

/* pull: the slice (unless the device already has it), what the trainee sent
   that the slice does not show yet (the overlay), and a fresh token when
   less than four hours are left. */
function gatePull(G, req) {
  var s = gateSession(G, req), out = { ok: true, h: s.slice.hash, serverTime: gateIso(G.now) };
  if (req.have && gateStr(req.have) === gateStr(s.slice.hash)) out.same = true; else out.slice = s.slice;
  var seen = gateMs(s.slice.inboxSeenUntil);
  var inbox = gateInbox(G, s.folder, { since: seen || (G.now - G.gate.ITEM_MAX_AGE_MS), lanes: true, results: true, max: GATE_LIMITS.OVERLAY_MAX });
  out.overlay = {
    lanes: inbox.lanes.map(function (l) { return { lane: l.lane, updatedAt: l.updatedAt, records: l.records || {}, ops: l.ops || [] }; }),
    results: inbox.results.map(function (r) { return { result: gateRedact(G, r.result, null), retired: r.retired || null }; }),
    truncated: !!inbox.truncated
  };
  if (s.refresh) {
    var c = s.claims, exp = G.now + G.gate.token.TTL_MS;
    out.token = G.gate.token.sign({ a: c.a, s: s.me.stu, sid: c.sid, iat: G.now, exp: exp, cv: c.cv }, gateCfg(G).secret, G.crypto);
    out.exp = exp;
  }
  return out;
}
// paper: only an exam on the trainee's list, and only while it is open by THIS clock.
function gatePaper(G, req) {
  var s = gateSession(G, req), examId = gateSafeId(req.examId);
  if (!examId || !gateAccessHas(s.slice, 'papers', examId)) return { ok: false, error: 'unknown-exam' };
  var key = gateKeyFile(G, examId);
  if (!key || !G.gate.paperOpen(key, G.now)) {
    return { ok: false, error: 'not-open', status: key ? G.core.exams.statusAt(key.exam, G.now, key.centreUtcOffset) : 'upcoming', serverTime: gateIso(G.now) };
  }
  var paper = gatePaperFile(G, examId);
  if (!paper) return { ok: false, error: 'not-open', status: 'upcoming', serverTime: gateIso(G.now) };
  return { ok: true, paper: paper, centreUtcOffset: key.centreUtcOffset, serverTime: gateIso(G.now) };
}
// attempt.get: the attempt in progress (one, however many devices), a result, or nothing (Core.gate.resumeAttempt).
function gateAttemptGet(G, req) {
  var s = gateSession(G, req), examId = gateSafeId(req.examId);
  if (!examId || !gateAccessHas(s.slice, 'papers', examId)) return { ok: false, error: 'unknown-exam' };
  var inbox = gateInbox(G, s.folder, { lanes: true, results: true, lanesSince: G.now - GATE_LIMITS.LANE_RECENT_MS });
  var r = G.gate.resumeAttempt({ lanes: inbox.lanes, results: inbox.results, slice: s.slice }, s.me.stu, examId);
  var out = { ok: true, state: r.state, serverTime: gateIso(G.now) };
  if (r.state === 'result') out.result = gateRedact(G, r.result, null);
  if (r.state === 'retired') out.retired = r.retired;
  if (r.state === 'attempt') { out.attempt = r.attempt; out.ids = r.ids; }
  return out;
}
/* review: a marked test, with the right answers only when the exam's
   release allows — on THIS clock. A result that reached the trainee only in
   their slice (marked on a lab PC) has had its right answers taken out
   there; they are put back from the key file first (Core.gate.fillAnswers),
   so the trainee sees them once released, as on the Centre's server. */
function gateReview(G, req) {
  var s = gateSession(G, req), id = gateStr(req.resultId);
  if (!id) gateFail('bad-request');
  var inbox = gateInbox(G, s.folder, { results: true }), found = null;
  inbox.results.forEach(function (f) { if (!found && f.result && gateStr(f.result.id) === id && gateStr(f.result.studentId) === s.me.stu) found = f.result; });
  if (!found) {
    ((s.slice.data && s.slice.data.voctrain_examResults) || []).forEach(function (r) { if (!found && r && gateStr(r.id) === id) found = r; });
  }
  if (!found) return { ok: false, error: 'not-found' };
  var examId = gateSafeId(found.examId), key = examId ? gateKeyFile(G, examId) : null;
  return { ok: true, result: gateRedact(G, G.gate.fillAnswers(found, key), key), revealed: !!key && G.core.exams.canRevealAnswers(key.exam, G.now, key.centreUtcOffset) };
}
// room.get: a room's own file, to its members only.
function gateRoomGet(G, req) {
  var s = gateSession(G, req), roomId = gateSafeId(req.roomId, 200);
  if (!roomId || !gateAccessHas(s.slice, 'rooms', roomId)) return { ok: false, error: 'unknown-room' };
  var room = gateSharedFile(G, gateCfg(G).roomsId, 'room.' + roomId + '.json', 'rm:' + roomId);
  if (!room || room.format !== G.gate.FORMAT.room || Number(room.version) > G.gate.VERSION) return { ok: false, error: 'not-ready', retry: true };
  if (!Array.isArray(room.members) || room.members.map(String).indexOf(s.me.acct) === -1) return { ok: false, error: 'unknown-room' };
  if (req.have && gateStr(req.have) === gateStr(room.hash)) return { ok: true, same: true, h: room.hash };
  return { ok: true, room: room, h: room.hash };
}

/* Uploads (DESIGN.md §5.4): the allowed kinds, 5 MB each, 50 a day and
   100 MB a day per account, into the trainee's own files/ folder, private. */
function gateFilesFolder(G, folder, make) {
  var f = gateOldest(folder.getFoldersByName(GATE_NAMES.files));
  return f || (make ? folder.createFolder(GATE_NAMES.files) : null);
}
function gateDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
/* The trainee's own uploads: every file id in files/, and today's count and
   bytes. Remembered; on a miss the folder itself is counted, so a lost
   memory never lifts a limit. */
function gateOwnUploads(G, s) {
  var key = 'own:' + s.me.acct, day = gateDay(G.now);
  var hit = gateCacheJson(G, key);
  if (hit && Array.isArray(hit.ids)) { if (hit.day !== day) { hit.day = day; hit.n = 0; hit.bytes = 0; } return hit; }
  var out = { ids: [], day: day, n: 0, bytes: 0 };
  var files = gateFilesFolder(G, s.folder, false);
  if (files) {
    var it = files.getFiles();
    while (it.hasNext()) {
      var f = it.next();
      if (f.isTrashed()) continue;
      out.ids.push(f.getId());
      if (gateDay(f.getDateCreated().getTime()) === day) { out.n++; out.bytes += f.getSize(); }
    }
  }
  gateCachePut(G, key, out, GATE_LIMITS.CACHE_MAX_S);
  return out;
}
function gateSafeName(name) {
  var n = gateStr(name).replace(/[\\\/]/g, '_').replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/\s+/g, ' ').trim();
  if (n.length > 80) { var dot = n.lastIndexOf('.'); n = dot > 0 && n.length - dot <= 6 ? n.slice(0, 80 - (n.length - dot)) + n.slice(dot) : n.slice(0, 80); }
  return n.replace(/^\.+/, '') || 'file';
}
function gateUpload(G, req) {
  var s = gateSession(G, req);
  var name = gateSafeName(req.name), ext = (/\.([A-Za-z0-9]{1,5})$/.exec(name) || [])[1];
  ext = ext ? ext.toLowerCase() : '';
  var kinds = Object.prototype.hasOwnProperty.call(GATE_UPLOAD_TYPES, ext) ? GATE_UPLOAD_TYPES[ext] : null;
  var mime = gateLower(req.mime);
  if (!kinds) return { ok: false, error: 'type-not-allowed' };
  if (!mime || mime === 'application/octet-stream') mime = kinds[0];
  if (kinds.indexOf(mime) === -1) return { ok: false, error: 'type-not-allowed' };
  var purpose = req.purpose === 'chat' ? 'chat' : req.purpose === 'submission' ? 'submission' : null;
  if (!purpose) gateFail('bad-request');
  var b64 = gateStr(req.base64).replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!b64 || /[^A-Za-z0-9+\/=_-]/.test(b64)) gateFail('bad-request');
  if (b64.length > Math.ceil(GATE_LIMITS.UPLOAD_MAX / 3) * 4 + 4) return { ok: false, error: 'too-large', max: GATE_LIMITS.UPLOAD_MAX };
  var bytes = /[-_]/.test(b64) ? Utilities.base64DecodeWebSafe(b64) : Utilities.base64Decode(b64);
  if (!bytes.length) gateFail('bad-request');
  if (bytes.length > GATE_LIMITS.UPLOAD_MAX) return { ok: false, error: 'too-large', max: GATE_LIMITS.UPLOAD_MAX };
  var own = gateOwnUploads(G, s);
  if (own.n >= GATE_LIMITS.UPLOADS_PER_DAY || own.bytes + bytes.length > GATE_LIMITS.UPLOAD_BYTES_PER_DAY) return { ok: false, error: 'quota' };
  var ref = gateSafeId(req.refId, 64) || 'x';
  var fileName = ref + '-' + name;
  var file = gateFilesFolder(G, s.folder, true).createFile(Utilities.newBlob(bytes, mime, fileName));
  try { file.setDescription('cestis-upload acct=' + s.me.acct + ' purpose=' + purpose); } catch (e) {}
  own.ids.push(file.getId()); own.n++; own.bytes += bytes.length;
  gateCachePut(G, 'own:' + s.me.acct, own, GATE_LIMITS.CACHE_MAX_S);
  return { ok: true, fileId: file.getId(), size: bytes.length, name: fileName };
}
// file.get: a file on the trainee's list (resources, their work) or one they uploaded; 10 MB at most.
function gateFileGet(G, req) {
  var s = gateSession(G, req), id = gateSafeId(req.fileId, 200);
  if (!id) gateFail('bad-request');
  if (!gateAccessHas(s.slice, 'files', id) && gateOwnUploads(G, s).ids.indexOf(id) === -1) return { ok: false, error: 'not-yours' };
  var f = gateFileById(id);
  if (!f) return { ok: false, error: 'not-found' };
  if (f.getSize() > GATE_LIMITS.FILE_GET_MAX) return { ok: false, error: 'too-large', max: GATE_LIMITS.FILE_GET_MAX };
  var blob = f.getBlob();
  return { ok: true, fileId: id, name: f.getName(), mime: blob.getContentType(), size: f.getSize(), base64: Utilities.base64Encode(blob.getBytes()) };
}
/* signOut: this token reads nothing more. What the session already sealed
   is still delivered later (its outbox items carry their own seal). */
function gateSignOut(G, req) {
  var cfg = gateReady(G);
  var v = G.gate.token.verify(gateStr(req.token), cfg.secret, G.crypto, { nowMs: G.now });
  if (!v.ok) return { ok: true };
  var sid = v.claims.sid, exp = v.claims.exp;
  G.cache.put('out:' + sid, '1', Math.min(GATE_LIMITS.CACHE_MAX_S, Math.max(1, Math.ceil((exp - G.now) / 1000))));
  G.cache.remove('in:' + sid);
  if (exp - G.now > GATE_LIMITS.CACHE_MAX_S * 1000) G.props.setProperty('out:' + sid, String(exp));
  if (!G.cache.get('out:pruned')) {
    // Signed-out sessions that have expired anyway are let go, at most once an hour.
    var all = G.props.getProperties();
    Object.keys(all).forEach(function (k) { if (k.indexOf('out:') === 0 && Number(all[k]) <= G.now) G.props.deleteProperty(k); });
    G.cache.put('out:pruned', '1', 3600);
  }
  return { ok: true };
}

/* -------------------------------------------- what trainees send (§5.1)
   deliver {items, lane?}: sealed items from a device's outbox, any session,
   any account, no token. For each session: its id must be one this gate
   made (else 'revoked': sign in and seal again), young enough, its account
   still with the same credentials ('revoked' otherwise), and every item's
   seal good. Then Core.gate.validateItem decides, against the trainee's
   slice, and what it keeps is merged into that session's own lane file —
   one writer per lane, so no locks. Nothing is refused for a passing
   reason: a write that fails is answered retry, and nothing of it counts as
   received. A submitted test is marked here and answered with its result. */
function gateDeliver(G, req) {
  var items = req.items;
  if (!Array.isArray(items) || !items.length || items.length > GATE_LIMITS.DELIVER_MAX_ITEMS) gateFail('bad-request');
  gateReady(G);
  var suffix = req.lane != null && req.lane !== '' ? gateStr(req.lane) : '';
  if (suffix && !/^[A-Za-z0-9]{1,12}$/.test(suffix)) gateFail('bad-request');
  var groups = {}, order = [], receipts = {};
  items.forEach(function (it, i) {
    if (!it || typeof it !== 'object' || it.id == null || !it.a || !it.sid) { receipts[i] = { id: it && it.id != null ? gateStr(it.id) : '', ok: false, reason: 'malformed' }; return; }
    var k = gateStr(it.a) + '\u0000' + gateStr(it.sid);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push({ i: i, item: it });
  });
  order.forEach(function (k) {
    var g = groups[k];
    var res = gateDeliverSession(G, gateStr(g[0].item.a), gateStr(g[0].item.sid), g.map(function (x) { return x.item; }), suffix);
    g.forEach(function (x, j) { receipts[x.i] = res[j]; });
  });
  return { ok: true, receipts: items.map(function (_, i) { return receipts[i]; }) };
}
function gateDeliverSession(G, acct, sid, items, suffix) {
  var cfg = gateCfg(G), g = G.gate;
  var all = function (extra) { return items.map(function (it) { var r = { id: gateStr(it.id), ok: false }; Object.keys(extra).forEach(function (x) { r[x] = extra[x]; }); return r; }); };
  var sc = g.sid.check(sid, cfg.secret, G.crypto);
  if (!sc.ok) return all({ reason: 'revoked' });
  if (G.now - sc.iat > g.ITEM_MAX_AGE_MS) return all({ reason: 'expired' });
  var e = gateIndex(G).a[acct];
  if (!e) return all({ reason: 'unknown-account' });
  if (g.sidCv(sid) !== gateStr(e.cv).slice(0, 12)) return all({ reason: 'revoked' });
  var key = g.sessionKey(cfg.secret, acct, sid, G.crypto);
  var out = items.map(function (it) { return { id: gateStr(it.id), ok: false }; });
  var good = [];
  items.forEach(function (it, j) {
    if (gateStr(it.a) !== acct || gateStr(it.sid) !== sid) { out[j].reason = 'malformed'; return; }
    if (!g.sealOk(it, key, G.crypto)) { out[j].reason = 'bad-seal'; return; }
    good.push(j);
  });
  if (!good.length) return out;
  var place = gatePlace(G, acct, e);
  if (place.error) { good.forEach(function (j) { out[j].reason = place.error; out[j].retry = true; }); return out; }
  var slice = place.slice, me = { acct: acct, stu: gateStr(slice.studentId) };
  // What validateItem needs to know: the papers of the exams named, the trainee's own uploads.
  var papers = {}, needFiles = false;
  good.forEach(function (j) {
    var it = items[j], a = it.kind === 'submit' ? it.attempt : (it.kind === 'rec' && it.key === 'voctrain_examAttempts' ? it.rec : null);
    var exam = a && gateSafeId(a.examId);
    if (exam && !papers[exam] && gateAccessHas(slice, 'papers', exam)) { var p = gatePaperFile(G, exam); if (p) papers[exam] = p; }
    if (it.kind === 'rec' && (it.key === 'voctrain_submissions' || it.key === 'voctrain_chatMessages')) needFiles = true;
  });
  var opts = { papers: papers };
  if (needFiles) opts.ownUploads = gateOwnUploads(G, { me: me, folder: place.folder }).ids;
  var laneId = 'L-' + sid + (suffix ? '~' + suffix : '');
  var laneFile = gateNewest(place.folder.getFilesByName(GATE_NAMES.inbox + '.' + laneId + '.json'));
  var lane = laneFile ? gateReadJsonFile(laneFile) : null;
  if (lane && Number(lane.version) > g.VERSION) { good.forEach(function (j) { out[j].reason = 'newer-version'; out[j].retry = true; }); return out; }
  if (!lane || lane.format !== g.FORMAT.inbox) lane = gateLaneNew(G, acct, me.stu, laneId);
  ['records', 'received', 'firstSeen'].forEach(function (f) { if (!lane[f] || typeof lane[f] !== 'object' || Array.isArray(lane[f])) lane[f] = {}; });
  if (!Array.isArray(lane.ops)) lane.ops = [];
  var changed = false, accepted = [], submits = [];
  good.forEach(function (j) {
    var it = items[j];
    if (it.kind !== 'submit' && lane.received[gateStr(it.id)]) { out[j] = { id: gateStr(it.id), ok: true, dup: true }; return; }
    var v = g.validateItem(it, me, slice, opts);
    if (!v.ok) { out[j].reason = v.reason || 'not-yours'; return; }
    if (it.kind === 'submit') {
      g.laneFirstSeen(lane, v.attempt.id, G.now) && (changed = true);
      submits.push({ j: j, item: it, attempt: v.attempt });
      return;
    }
    if (it.kind === 'rec' && !v.known) g.laneMerge(lane, v, G.now);
    if (it.kind === 'rec' && v.key === 'voctrain_examAttempts') g.laneFirstSeen(lane, v.rec.id, G.now);
    if (it.kind === 'op' && !lane.ops.some(function (o) { return o && o.id === v.op.id; })) lane.ops.push(v.op);
    lane.received[gateStr(it.id)] = gateIso(G.now);
    changed = true;
    accepted.push(j);
  });
  if (changed) {
    try { gateLaneWrite(G, place.folder, laneId, laneFile, lane); }
    catch (err) {
      gateLog('lane write', err);
      accepted.concat(submits.map(function (x) { return x.j; })).forEach(function (j) { out[j] = { id: gateStr(items[j].id), ok: false, reason: 'retry', retry: true }; });
      return out;
    }
  }
  accepted.forEach(function (j) { out[j] = { id: gateStr(items[j].id), ok: true }; });
  submits.forEach(function (x) {
    var r;
    try { r = gateSubmit(G, place, me, lane, x.item, x.attempt); }
    catch (err) { gateLog('submit', err); r = { ok: false, reason: 'retry', retry: true }; }
    r.id = gateStr(x.item.id);
    out[x.j] = r;
  });
  return out;
}
function gateLaneNew(G, acct, stu, laneId) {
  var nowIso = gateIso(G.now);
  return { format: G.gate.FORMAT.inbox, version: G.gate.VERSION, accountId: acct, studentId: stu, lane: laneId,
    createdAt: nowIso, updatedAt: nowIso, records: {}, ops: [], received: {}, firstSeen: {} };
}
function gateLaneWrite(G, folder, laneId, file, lane) {
  lane.updatedAt = gateIso(G.now);
  var text = JSON.stringify(lane);
  if (file) file.setContent(text);
  else folder.createFile(GATE_NAMES.inbox + '.' + laneId + '.json', text, 'application/json');
}
/* What goes into a lane, and when an attempt was first seen there (the
   late flag only), are Core.gate.laneMerge and Core.gate.laneFirstSeen. */

/* A submitted test (DESIGN.md §5.3): marked from the key file by
   Core.gate.markAttempt, after the attempt is put together from every
   device's lane and the slice (Core.gate.resumeAttempt). One result per
   attempt without a lock: the result's id and file name come from the
   attempt, a second submit finds the file, and when two arrive at once and
   both write, the OLDEST file is the result both are answered with — the
   younger copy, this request's own, goes to the bin. */
function gateResultName(attemptId) { return GATE_NAMES.result + attemptId + '.json'; }
function gateResultFile(G, folder, attemptId) {
  var it = folder.getFilesByName(gateResultName(attemptId));
  return gateOldest(it);
}
function gateSubmit(G, place, me, lane, item, attempt) {
  var g = G.gate, folder = place.folder;
  var aid = gateSafeId(attempt.id);
  if (!aid || !gateSafeId(attempt.examId)) return { ok: false, reason: 'malformed' };
  var key = gateKeyFile(G, attempt.examId);
  var answer = function (resFile, already) {
    var out = { ok: true, result: gateRedact(G, resFile.result, key) };
    if (already) out.already = true;
    return out;
  };
  var done = gateResultFile(G, folder, aid);
  if (done) { var dj = gateJsonOf(G, done, 'rf:' + done.getId()); if (dj && dj.result) return answer(dj, true); }
  if (!key) return { ok: false, reason: 'not-ready', retry: true };
  var inbox = gateInbox(G, folder, { lanes: true, results: true, lanesSince: G.now - GATE_LIMITS.LANE_RECENT_MS });
  var lanes = inbox.lanes.filter(function (l) { return l.lane !== lane.lane; });
  lanes.push(lane);
  lanes.push({ records: { voctrain_examAttempts: [attempt] } });
  var r = g.resumeAttempt({ lanes: lanes, results: inbox.results, slice: place.slice }, me.stu, attempt.examId);
  if (r.state === 'result') return { ok: true, already: true, result: gateRedact(G, r.result, key) };
  if (r.state === 'retired') return { ok: true, already: true, retired: r.retired };
  var target = r.state === 'attempt' ? r.attempt : attempt;
  var tid = gateSafeId(target.id);
  if (!tid) return { ok: false, reason: 'malformed' };
  if (tid !== aid) {
    var other = gateResultFile(G, folder, tid);
    if (other) { var oj = gateJsonOf(G, other, 'rf:' + other.getId()); if (oj && oj.result) return answer(oj, true); }
  }
  var first = g.firstSeenOf(lanes, r.ids || [aid], G.now);
  var students = (place.slice.data && place.slice.data.voctrain_students) || [];
  var m = g.markAttempt(target, key, G.now, { crypto: G.crypto, receivedAt: G.now, firstSeen: first, auto: item.auto === true,
    studentName: students[0] ? students[0].name : undefined, accountId: me.acct });
  if (m.error) return { ok: false, reason: m.error, retry: m.error === 'no-key' };
  var name = gateResultName(tid);
  var mine = folder.createFile(name, JSON.stringify(m.file), 'application/json');
  // Two submits at the same moment: one result, the first file written.
  var copies = [], it = folder.getFilesByName(name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) copies.push(f); }
  if (!copies.some(function (f) { return f.getId() === mine.getId(); })) copies.push(mine);
  copies.sort(function (a, b) { return (a.getDateCreated().getTime() - b.getDateCreated().getTime()) || (a.getId() < b.getId() ? -1 : a.getId() > b.getId() ? 1 : 0); });
  var winner = copies[0];
  if (winner.getId() !== mine.getId()) {
    try { mine.setTrashed(true); } catch (e) { gateLog('duplicate result', e); }
    var wj = gateJsonOf(G, winner, 'rf:' + winner.getId());
    if (wj && wj.result) return answer(wj, true);
  }
  gateCachePut(G, 'rf:' + mine.getId(), { u: mine.getLastUpdated().getTime(), id: mine.getId(), j: m.file }, GATE_LIMITS.CACHE_MAX_S);
  return answer(m.file, false);
}

/* --------------------------------------------------- health and checks */
function gateHealth(G) {
  var cfg = gateCfg(G), ready = { secret: !!cfg.secret, folders: false, ledger: !!cfg.ledgerId, ledgerUpdated: null, trainees: null };
  ready.folders = !!cfg.rootId && GATE_SUBFOLDERS.every(function (s) {
    var id = s[0] === 'gate' ? cfg.gateId : s[0] === 'reg' ? cfg.regId : cfg[s[0] + 'Id'];
    return !!gateFolderById(id);
  });
  if (cfg.ledgerId) {
    try { var idx = gateIndex(G); ready.trainees = idx.n; ready.ledgerUpdated = gateIso(idx.updated); }
    catch (e) { ready.ledger = false; }
  }
  return { ok: true, service: GATE_SERVICE, version: GATE_VERSION, protocol: GATE_PROTOCOL.slice(), time: gateIso(G.now),
    ready: ready, accepting: !gateIsOff(G) };
}
/* The administrator's page (DESIGN.md §10.3): ✓/✗ lines, counts only — no
   names, no ids. It names no place either: it is a screen. */
function gateSelfCheckPage(G, params) {
  var lines = [], tick = function (ok, text) { lines.push((ok === null ? '• ' : ok ? '✓ ' : '✗ ') + text); };
  var cfg = gateCfg(G), h = gateHealth(G);
  tick(true, 'Version ' + GATE_VERSION + ' (protocol ' + GATE_PROTOCOL.join(', ') + ')');
  tick(h.accepting, h.accepting ? 'Answering trainees' : 'Switched off — trainees use today\'s sign-in');
  tick(h.ready.secret, h.ready.secret ? 'Secret made' : 'Secret missing');
  tick(h.ready.folders, h.ready.folders ? 'Folders present' : 'A folder is missing — if it is in the bin, restore it (it is never made again)');
  tick(h.ready.ledger, h.ready.ledger ? 'Accounts list found (' + h.ready.trainees + ' trainee accounts, updated ' + h.ready.ledgerUpdated + ')' +
    (cfg.ledgerNote && cfg.ledgerNote !== 'found' ? ' — ' + cfg.ledgerNote : '') : 'Accounts list not found yet — a staff member must sign in on the dashboard once');
  var slices = 0, oldest = null;
  var sit = DriveApp.searchFiles("title = '" + GATE_NAMES.slice + "' and trashed = false");
  while (sit.hasNext()) { var sf = sit.next(); slices++; var su = sf.getLastUpdated().getTime(); if (oldest === null || su < oldest) oldest = su; }
  tick(slices > 0 ? true : null, 'Records published for ' + slices + ' of ' + (h.ready.trainees || 0) + ' trainees' + (oldest ? ' (oldest ' + gateIso(oldest) + ')' : ''));
  var keys = 0, kf = gateFolderById(cfg.keysId);
  if (kf) { var kit = kf.getFiles(); while (kit.hasNext()) { if (!kit.next().isTrashed()) keys++; } }
  tick(null, 'Answer keys held for ' + keys + ' tests');
  try { tick(null, 'Storage used: ' + (DriveApp.getStorageUsed() / 1073741824).toFixed(2) + ' GB'); } catch (e) { tick(false, 'Storage used: could not read'); }
  try { tick(null, 'Email codes left today: ' + MailApp.getRemainingDailyQuota()); } catch (e) { tick(false, 'Email codes left today: could not read'); }
  var st = G.gate.selfTest(G.crypto);
  tick(st.ok, 'Self-test ' + (st.ok ? 'passed' : 'FAILED') + ': ' + st.checks.map(function (c) { return (c.ok ? '✓' : '✗') + c.name; }).join(' '));
  // Live checks (SETUP.md): the searches the gate and the staff collector rely on.
  lines.push(gateSmokeName(G));
  lines.push(gateSmokeDescription(G));
  var gf = gateFolderById(cfg.gateId), res = gf ? gateOldest(gf.getFilesByName(GATE_NAMES.smokeResult)) : null;
  var wr = res ? gateReadJsonFile(res) : null;
  tick(wr ? wr.errors === 0 : null, wr ? 'Write-rate check (' + wr.at + '): ' + wr.writes + ' writes, ' + wr.errors + ' refused' :
    'Write-rate check not run yet (SETUP.md, live check 6)');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font:16px/1.5 system-ui,sans-serif;margin:16px;max-width:720px;color:#1a1a1a;background:#fff}' +
    'li{list-style:none;margin:4px 0}@media (prefers-color-scheme: dark){body{background:#121212;color:#eee}}</style>' +
    '<h1 style="font-size:20px">Trainee sign-in from anywhere — check</h1><ul>' +
    lines.map(function (l) { return '<li>' + gateEsc(l) + '</li>'; }).join('') + '</ul><p>Checked ' + gateEsc(gateIso(G.now)) + '.</p>';
}
/* Live check 5: is a file found by the start of a dotted name — the search
   the gate (title contains) and the staff collector (name contains) make
   for 'CESTISINBOX…'? A test file named the same way, but with a prefix no
   collector reads, is made once in _gate, then looked for. */
function gateSmokeName(G) {
  var gf = gateFolderById(gateCfg(G).gateId);
  if (!gf) return '✗ Name search: no _gate folder';
  var f = gateOldest(gf.getFilesByName(GATE_NAMES.smokeName));
  if (!f) f = gf.createFile(GATE_NAMES.smokeName, '{"check":"name"}', 'application/json');
  var it = DriveApp.searchFiles("title contains 'CESTISSMOKE' and trashed = false"), found = false;
  while (it.hasNext()) if (it.next().getId() === f.getId()) found = true;
  if (found) return '✓ Name search finds a file by the start of its name';
  var mins = Math.round((G.now - f.getDateCreated().getTime()) / 60000);
  return (mins > 30 ? '✗' : '•') + ' Name search has not found the test file yet (made ' + mins + ' min ago)' +
    (mins > 30 ? ' — see SETUP.md, live check 5' : ' — look again in a few minutes');
}
/* Live check 7: is a folder found by text in its description? A test folder
   is made once in _gate (never a trainee's), then looked for. */
function gateSmokeDescription(G) {
  var gf = gateFolderById(gateCfg(G).gateId);
  if (!gf) return '✗ Description search: no _gate folder';
  var mark = 'acct=USR-SMOKECHECK';
  var f = gateOldest(gf.getFoldersByName(GATE_NAMES.smokeFolder));
  if (!f) { f = gf.createFolder(GATE_NAMES.smokeFolder); f.setDescription('cestis-smoke ' + mark + ' v=1'); }
  var it = gf.searchFolders("fullText contains '" + mark + "' and trashed = false"), found = false;
  while (it.hasNext()) if (it.next().getId() === f.getId()) found = true;
  if (found) return '✓ Description search finds a folder by its description';
  var mins = Math.round((G.now - f.getDateCreated().getTime()) / 60000);
  return (mins > 30 ? '✗' : '•') + ' Description search has not found the test folder yet (made ' + mins + ' min ago)' +
    (mins > 30 ? ' — see SETUP.md, live check 7' : ' — look again in a few minutes');
}
function gateDiagLimit(G) {
  if (gateCount(G, 'dg:' + gateMinute(G), 120) > GATE_LIMITS.DIAG_PER_MIN) gateFail('busy');
}
// Live check 3: how much of a large request arrived (its length and digest only).
function gateDiagEcho(G) {
  gateDiagLimit(G);
  var body = gateStr(G.raw);
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, body, Utilities.Charset.UTF_8);
  return { ok: true, chars: body.length, sha256: G.gate.toHex(gateUnsigned(d)) };
}
// Live check 4: which fields tokeninfo reports — never the address itself.
function gateDiagTokenInfo(G, req) {
  gateDiagLimit(G);
  var info = gateTokenInfo(gateStr(req.accessToken));
  if (!info) return { ok: false, error: 'bad-token' };
  var cfg = gateCfg(G);
  return { ok: true, fields: Object.keys(info).sort(), audIsOurs: gateStr(info.aud) === cfg.clientId, azpIsOurs: gateStr(info.azp) === cfg.clientId,
    emailVerified: gateStr(info.email_verified) === 'true', hasEmailScope: /userinfo\.email|(^|\s)email(\s|$)/.test(gateStr(info.scope)),
    expiresIn: Number(info.expires_in) || 0 };
}

/* -------------------------------------------- run from the editor (SETUP.md) */
// Makes the folders and the secret, and asks for the permissions, without deploying anything.
function gateSetupNow() {
  var G = gateContext();
  G.cache.remove('cfg');
  var h = gateHealth(G);
  Logger.log(JSON.stringify(h, null, 2));
  return h;
}
/* Live check 6: one write a second for five minutes, into _gate only. The
   outcome is kept in _gate/smoke-write-rate-result.json and shown on the
   check page. */
function gateSmokeWriteRate() {
  var G = gateContext(), cfg = gateCfg(G), gf = gateFolderById(cfg.gateId);
  if (!gf) throw new Error('Run gateSetupNow first.');
  var f = gateOldest(gf.getFilesByName(GATE_NAMES.smokeWrites)) || gf.createFile(GATE_NAMES.smokeWrites, '{}', 'application/json');
  var start = Date.now(), writes = 0, errors = 0, firstError = '';
  for (var i = 0; i < 300; i++) {
    var due = start + i * 1000, wait = due - Date.now();
    if (wait > 0) Utilities.sleep(wait);
    try { f.setContent(JSON.stringify({ i: i, at: new Date().toISOString() })); writes++; }
    catch (e) { errors++; if (!firstError) firstError = String(e && e.message || e); }
  }
  var out = { at: new Date().toISOString(), seconds: Math.round((Date.now() - start) / 1000), writes: writes, errors: errors, firstError: firstError };
  var r = gateOldest(gf.getFilesByName(GATE_NAMES.smokeResult));
  if (r) r.setContent(JSON.stringify(out)); else gf.createFile(GATE_NAMES.smokeResult, JSON.stringify(out), 'application/json');
  Logger.log(JSON.stringify(out));
  return out;
}
