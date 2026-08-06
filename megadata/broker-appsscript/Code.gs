/* MegaData broker — Google Apps Script glue (Phase 5 step 7; docs/02 §9).
 *
 * ⚠ STATUS: NOT YET TESTED AGAINST LIVE APPS SCRIPT / DRIVE (spec 5.3: this
 * build environment has no Drive access). The pure logic it wraps
 * (broker-core.js) carries the full Node test suite; this file is the thin
 * I/O glue and must be smoke-tested at deployment using README-DEPLOY.md.
 *
 * DEPLOY: paste the full contents of megadata/schemas.js, then
 * megadata/broker-core.js, ABOVE this file's contents in one .gs project
 * (Apps Script has no require; the UMD headers no-op there and register on
 * globalThis.MegaData). Then follow README-DEPLOY.md.
 *
 * Script Properties (File → Project properties → Script properties):
 *   HMAC_SECRET         shared secret; the same value an admin enters once
 *                       per device in the app (never committed — public repo)
 *   MEGADATA_FOLDER_ID  Drive id of the MegaData master folder
 */
/* global MegaData, LockService, PropertiesService, DriveApp, ContentService, Utilities */

var STATE_FILE = 'broker-state.json';
var HEAD_FILE = 'head.json';

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function props() { return PropertiesService.getScriptProperties(); }
function folder() { return DriveApp.getFolderById(props().getProperty('MEGADATA_FOLDER_ID')); }

function findFile(fld, name) {
  var it = fld.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function readJsonFile(fld, name, dflt) {
  var f = findFile(fld, name);
  if (!f) return dflt;
  return JSON.parse(f.getBlob().getDataAsString());
}
function writeJsonFile(fld, name, obj) {
  // head/state are the broker's own files, single-writer under the lock —
  // setContent here is safe ONLY because of that lock (docs/02 §1).
  var text = JSON.stringify(obj);
  var f = findFile(fld, name);
  if (f) f.setContent(text); else fld.createFile(name, text, 'application/json');
}

function hmacOk(auth, payload) {
  var secret = props().getProperty('HMAC_SECRET') || '';
  var expected = sha256HexSync(secret + '|' + MegaData.canon(payload || {}));
  return auth === expected;
}
function sha256HexSync(str) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function doGet() {
  return jsonOut({ ok: true, service: 'cestis-megadata-broker', version: 1 });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ error: 'body is not JSON' }); }
  if (!hmacOk(req.auth, req.payload)) return jsonOut({ error: 'auth failed' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return jsonOut({ error: 'busy', retryable: true });
  try {
    var fld = folder();
    var state = readJsonFile(fld, STATE_FILE, null) || MegaData.createBrokerState();
    var broker = MegaData.createBroker(state);
    var before = state.events.length;
    var result;
    switch (req.op) {
      case 'append': result = broker.append(req.payload, { nowIso: new Date().toISOString() }); break;
      case 'pull':   result = broker.pull(req.payload); break;
      case 'headq':  result = broker.headq(); break;
      case 'gate':   result = broker.gate(req.payload); break;
      default: return jsonOut({ error: 'unknown op ' + req.op });
    }
    // broker-core returns Promises; Apps Script's V8 runtime resolves them
    // synchronously here because sha256 falls back to… it does NOT: digest is
    // async in the core. So we drive the promise to completion:
    var out = null, err = null, done = false;
    result.then(function (r) { out = r; done = true; }, function (ex) { err = ex; done = true; });
    // V8 runtime: microtasks run when the call stack empties; Utilities.sleep
    // yields. Bounded wait:
    var waited = 0;
    while (!done && waited < 20000) { Utilities.sleep(50); waited += 50; }
    if (!done) return jsonOut({ error: 'internal timeout' });
    if (err) return jsonOut({ error: String(err && err.message || err) });

    if (req.op === 'append' && out.ok && state.events.length > before) {
      var fresh = state.events.slice(before);
      var segName = 'seg-' + ('000000' + state.segments.length).slice(-6)
        + '-' + fresh[0].seq + '-' + fresh[fresh.length - 1].seq + '.jsonl';
      fld.createFile(segName, fresh.map(function (ev) { return JSON.stringify(ev); }).join('\n'), 'application/json');
      writeJsonFile(fld, HEAD_FILE, { seq: state.seq, chain: state.chain, segments: state.segments, gates: state.gates });
    }
    if (req.op === 'append' || req.op === 'gate') writeJsonFile(fld, STATE_FILE, state);
    return jsonOut(out);
  } finally {
    lock.releaseLock();
  }
}
