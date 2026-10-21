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

/* ---------------------------------------------------------------- history */
function historyDir(dataDir, file) {
  return path.join(dataDir, '.history', path.basename(file));
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
  const all = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const limit = keep || HISTORY_KEEP;
  all.slice(0, Math.max(0, all.length - limit)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
  return path.join(dir, name);
}

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
  if (!Core || !isPagePayload(incoming) || !isPagePayload(stored)) return incoming;
  const res = Core.pageCloud.mergeKeys(stored.data, stored.stamps || {}, incoming.data, incoming.stamps || {},
    { records: true, symmetric: true });
  const out = {};
  Object.keys(incoming).forEach(k => { out[k] = incoming[k]; });
  out.data = res.data;
  out.stamps = res.stamps;
  out.keyCount = Object.keys(res.data).length;
  return out;
}

/* Save one page file. Resolves { bytes, etag, changedByServer, history }. */
function save(opts) {
  const file = opts.file, dataDir = opts.dataDir, incoming = opts.incoming;
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
    const merged = mergeIncoming(opts.core, storedText, incoming);
    const text = JSON.stringify(merged);
    const changedByServer = text !== JSON.stringify(incoming);
    if (storedText === text) {
      return { bytes: Buffer.byteLength(text), etag: etagOf(Buffer.from(text)), changedByServer, history: null };
    }
    const history = storedText == null ? null : keepHistory(dataDir, file, opts.keep);
    writeDurable(file, text);
    return { bytes: Buffer.byteLength(text), etag: etagOf(Buffer.from(text)), changedByServer, history };
  });
}

module.exports = { nodeTooOld, MIN_NODE_MAJOR, loadOrCreateToken, etagOf, serialise, writeDurable,
  keepHistory, historyDir, mergeIncoming, save, HISTORY_KEEP };
