/* ============================================================================
   cestis-offline-store.js — how the Centre's server keeps its records folder.

   cestis-offline-server.js answers the requests; this file decides what a save
   does to the data/ folder. It is kept separate so each rule can be tested on
   its own (tests/offline-server-hardening.test.js and the root test suite).

   WHAT WAS WRONG, AND WHAT EACH PART BELOW FIXES
   ----------------------------------------------
   1. Two saves at once shared ONE temporary file ("<file>.tmp"). Both wrote
      into it, the first rename published the mixture, and the second rename
      failed — so most overlapping saves came back as errors, and the file on
      disk was regularly not even valid JSON. In a class every device saves
      after every click, so saves overlap all the time. Each save now writes
      its own uniquely named temporary file, flushed to the disk before it is
      renamed into place, and saves to one file run strictly one after
      another.
   2. A save REPLACED the file with whatever the device sent. A device that
      had not pulled yet, or had trimmed its copy, replaced the Centre's
      records with its own smaller view. The server now MERGES every save into
      what it already holds, by the same rules every device uses
      (CESTISCore.pageCloud.mergeKeys — newer write per key, records merged
      record by record, an empty value never replacing records), so no single
      save can take records away.
   3. There was no history. One bad save and the records were gone, with no
      Drive revision history to go back to. Every replace now keeps the
      previous version in data/.history/<file>/ (the newest HISTORY_KEEP of
      them), so a bad save can be undone by copying one back.
   4. The access token changed every time the server restarted, and every page
      already open then failed every save, silently, until someone reloaded
      it. The token is now kept in cert/lan-token and survives restarts.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const HISTORY_KEEP = 40;            // versions kept per data file
const MIN_NODE_MAJOR = 14;

/* ------------------------------------------------------------ Node version */
/* Older Node (Ubuntu 18.04's packaged 8.x, say) starts the server and serves
   pages, then fails every video join because a piece the signalling needs is
   missing. Refusing to start with a clear message beats that. */
function nodeTooOld(version) {
  const major = parseInt(String(version || '').replace(/^v/, ''), 10);
  return !(major >= MIN_NODE_MAJOR);
}

/* ------------------------------------------------------------------ token */
/* One token per Centre, kept with the certificate (both are per-machine and
   secret; both are git-ignored). Made once, on first start. */
function loadOrCreateToken(certDir) {
  const file = path.join(certDir, 'lan-token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(t)) return t;
  } catch (e) {}
  const t = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  } catch (e) {}
  return t;
}
/* A NEW token in place of the old one, for the staff-only switch
   (cestis-offline-server.js): every device still holding the old token is
   refused until it asks again, and only staff are given the new one. It must
   reach the disk — a token changed only in memory would be the old one again
   after a restart — so a failure throws and the switch is not changed. */
function rotateToken(certDir) {
  const file = path.join(certDir, 'lan-token');
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(certDir, { recursive: true });
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, t + '\n', { mode: 0o600 });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) {} throw e; }
  return t;
}

/* ------------------------------------------------------------------- etag */
function etagOf(buf) {
  return '"' + crypto.createHash('sha1').update(buf).digest('hex') + '"';
}

/* --------------------------------------------------------- one file at once */
const queues = new Map();
function serialise(key, job) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(job, job);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

/* ------------------------------------------------------------ safe writing */
function writeDurable(file, text) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text, null, 'utf8');
    try { fs.fsyncSync(fd); } catch (e) {}          // not every filesystem supports it
  } finally {
    fs.closeSync(fd);
  }
  // Windows refuses to rename over a file another request is reading at that
  // instant (EPERM/EBUSY). That clears in milliseconds; try a few times.
  let lastErr = null;
  for (let i = 0; i < 20; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      lastErr = e;
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') break;
      const until = Date.now() + 25; while (Date.now() < until) { /* brief wait */ }
    }
  }
  try { fs.unlinkSync(tmp); } catch (e) {}
  throw lastErr;
}

/* ---------------------------------------------------------------- history
   The last HISTORY_KEEP versions of every file. The newest HISTORY_PLAIN of
   them stay plain JSON, so the version most likely wanted is restored by
   copying it back, as before; the older ones are kept gzip-compressed
   ("<name>.json.gz", about a tenth of the size — 40 full copies of a school
   year's dashboard file came to ~4 GB). readHistory() reads either kind, and
   so does anything that lists the folder with historyVersions(). Compressing
   happens after the save has answered, off the request, one file at a time. */
const HISTORY_PLAIN = 3;
function historyDir(dataDir, file) {
  return path.join(dataDir, '.history', path.basename(file));
}
function isHistoryName(f) { return /\.json(\.gz)?$/.test(f); }
// The versions of one file, oldest first ("<time>-<n>.json" or ".json.gz").
function historyVersions(dataDir, file) {
  const dir = historyDir(dataDir, file);
  let all = [];
  try { all = fs.readdirSync(dir).filter(isHistoryName); } catch (e) { return []; }
  const base = f => f.replace(/\.gz$/, '');
  // One version written both ways (a compression that stopped half-way): the plain one counts.
  const seen = {};
  all.sort().forEach(f => { const b = base(f); if (!seen[b] || !/\.gz$/.test(f)) seen[b] = f; });
  return Object.keys(seen).sort().map(b => seen[b]);
}
// One version's text, plain or compressed.
function readHistory(dataDir, file, name) {
  const buf = fs.readFileSync(path.join(historyDir(dataDir, file), name));
  return (/\.gz$/.test(name) ? zlib.gunzipSync(buf) : buf).toString('utf8');
}
const compressQueue = new Map();
function compressOlder(dir, keepPlain) {
  const job = () => new Promise(resolve => {
    let plain = [];
    try { plain = fs.readdirSync(dir).filter(f => /\.json$/.test(f)).sort(); } catch (e) { return resolve(); }
    const older = plain.slice(0, Math.max(0, plain.length - keepPlain));
    (function next(i) {
      if (i >= older.length) return resolve();
      const src = path.join(dir, older[i]);
      fs.readFile(src, (err, buf) => {
        if (err) return next(i + 1);
        zlib.gzip(buf, { level: 6 }, (zerr, gz) => {
          if (zerr) return next(i + 1);
          // Written beside the version folder, read back and checked; only
          // then moved in, and the plain copy removed in the same step — so
          // the folder never shows a version twice, or half-written.
          const dst = src + '.gz';
          const tmp = path.join(path.dirname(dir), '.' + path.basename(dir) + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.gz.tmp');
          fs.writeFile(tmp, gz, werr => {
            if (werr) { fs.unlink(tmp, () => next(i + 1)); return; }
            fs.readFile(tmp, (e1, back) => {
              if (e1) { fs.unlink(tmp, () => next(i + 1)); return; }
              zlib.gunzip(back, (e2, out) => {
                if (e2 || !out.equals(buf)) { fs.unlink(tmp, () => next(i + 1)); return; }
                try { fs.renameSync(tmp, dst); fs.unlinkSync(src); }
                catch (e3) { try { fs.unlinkSync(tmp); } catch (e4) {} }
                next(i + 1);
              });
            });
          });
        });
      });
    })(0);
  });
  const prev = compressQueue.get(dir) || Promise.resolve();
  const p = prev.then(job, job);
  compressQueue.set(dir, p);
  p.then(() => { if (compressQueue.get(dir) === p) compressQueue.delete(dir); });
  return p;
}
let historySeq = 0;
function keepHistory(dataDir, file, keep) {
  let old;
  try { old = fs.readFileSync(file); } catch (e) { return null; }   // nothing to keep yet
  const dir = historyDir(dataDir, file);
  fs.mkdirSync(dir, { recursive: true });
  // Sortable by name: the time, then a counter for saves in the same millisecond.
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + String(++historySeq).padStart(6, '0') + '.json';
  fs.writeFileSync(path.join(dir, name), old);
  const limit = keep || HISTORY_KEEP;
  const all = historyVersions(dataDir, file);
  all.slice(0, Math.max(0, all.length - limit)).forEach(f => {
    try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
    // (and its other form, if a compression had left both)
    try { fs.unlinkSync(path.join(dir, /\.gz$/.test(f) ? f.replace(/\.gz$/, '') : f + '.gz')); } catch (e) {}
  });
  compressOlder(dir, HISTORY_PLAIN);
  return path.join(dir, name);
}
// Wait for the background compression of a file's history (tests, shutdown).
function historySettled(dataDir, file) { return compressQueue.get(historyDir(dataDir, file)) || Promise.resolve(); }

/* ------------------------------------------------------------------ merge */
function isPagePayload(p) {
  return !!p && typeof p === 'object' && !Array.isArray(p) && !!p.data && typeof p.data === 'object' && !Array.isArray(p.data);
}

/* What the file should hold after this save: the stored copy with the
   incoming one merged in. Peers, not "device and cloud": the strictly newer
   stamp wins each key, records merge record by record, and an empty value
   never replaces records. A file that is not a page backup (or a stored copy
   that cannot be read) is simply replaced, as before. */
function mergeIncoming(Core, storedText, incoming) {
  let stored = null;
  try { stored = storedText == null ? null : JSON.parse(storedText); } catch (e) { stored = null; }
  // A save that carries only the keys that changed (partial: true, EF-5) is
  // only ever merged into a stored file: it can never become the file, or
  // every key it does not mention would be gone. The device sends the whole
  // file instead (the server answers 409).
  if (incoming && incoming.partial === true && (!Core || !isPagePayload(stored) || !isPagePayload(incoming))) {
    const e = new Error('a partial save needs the stored file'); e.code = 'PARTIAL_NEEDS_FULL'; throw e;
  }
  if (!Core || !isPagePayload(incoming) || !isPagePayload(stored)) return incoming;
  const res = Core.pageCloud.mergeKeys(stored.data, stored.stamps || {}, incoming.data, incoming.stamps || {},
    { records: true, symmetric: true });
  const out = {};
  Object.keys(incoming).forEach(k => { if (k !== 'partial') out[k] = incoming[k]; });
  out.data = res.data;
  out.stamps = res.stamps;
  out.keyCount = Object.keys(res.data).length;
  return out;
}

/* Save one page file. Resolves { bytes, etag, changedByServer, history }.

   opts.incoming is what to merge in — or a FUNCTION, called inside this
   file's queue with the stored text (null when there is no file yet), that
   returns it, or returns null when there is nothing to save after all
   (resolves { skipped: true }). The trainee gate (cestis-offline-gate.js)
   saves this way: it reads what the Centre holds, checks what a trainee
   sent against it and writes the result in one step, so no other save can
   land between its read and its write. Whatever it throws fails the save
   and nothing is written. */
function save(opts) {
  const file = opts.file, dataDir = opts.dataDir;
  return serialise(file, () => {
    fs.mkdirSync(dataDir, { recursive: true });
    let storedText = null;
    // Only a missing file is "nothing stored". A file that exists but could
    // not be read right now (busy, locked, out of handles) must not be
    // treated as empty: the save would then write this one device's keys
    // over the Centre's whole file. Throwing fails this save (500) and the
    // device tries again.
    try { storedText = fs.readFileSync(file, 'utf8'); }
    catch (e) { if (e && e.code === 'ENOENT') storedText = null; else throw e; }
    const incoming = typeof opts.incoming === 'function' ? opts.incoming(storedText) : opts.incoming;
    if (incoming == null && typeof opts.incoming === 'function') {
      const buf = Buffer.from(storedText == null ? '' : storedText);
      return { skipped: true, bytes: buf.length, etag: storedText == null ? null : etagOf(buf), changedByServer: false, history: null };
    }
    // opts.base: the version (ETag) the device built its save on. basedOn says
    // whether the stored file still was that version when this save ran.
    const basedOn = !!opts.base && storedText != null && etagOf(Buffer.from(storedText)) === opts.base;
    const merged = mergeIncoming(opts.core, storedText, incoming);
    const text = JSON.stringify(merged);
    const changedByServer = text !== JSON.stringify(incoming);
    // A save of only the changed keys: the fingerprint of what the file now
    // holds, so the device can tell whether its own prediction of it is right.
    let resultSig = null;
    try {
      if (incoming && incoming.partial === true && opts.core && opts.core.pageCloud.resultSig && isPagePayload(merged)) resultSig = opts.core.pageCloud.resultSig(merged.data, merged.stamps);
    } catch (e) { resultSig = null; }
    if (storedText === text) {
      return { bytes: Buffer.byteLength(text), etag: etagOf(Buffer.from(text)), changedByServer, history: null, basedOn, resultSig };
    }
    const history = storedText == null ? null : keepHistory(dataDir, file, opts.keep);
    writeDurable(file, text);
    return { bytes: Buffer.byteLength(text), etag: etagOf(Buffer.from(text)), changedByServer, history, basedOn, resultSig };
  });
}

module.exports = { nodeTooOld, MIN_NODE_MAJOR, loadOrCreateToken, rotateToken, etagOf, serialise, writeDurable,
  keepHistory, historyDir, historyVersions, readHistory, historySettled, mergeIncoming, save, HISTORY_KEEP, HISTORY_PLAIN };
