#!/usr/bin/env node
/* ============================================================================
   cestis-offline-server.js — runs the whole CESTIS system on one computer and
   serves it to every other device on the same local network. No internet.

   WHAT IT DOES
   ------------
   1. Serves every page in this folder over https:// — the system needs a real
      web address, not file://, because browsers refuse storage and page loading
      to documents opened straight off the disk, and it needs an address they
      TRUST or they will not allow video classes (see 2). The certificate is
      made by this computer on first run; see cestis-offline-cert.js.
   2. Introduces browsers to each other so VIDEO CLASSES work. Two browsers
      cannot start a call unaided — something has to carry the first few
      messages between them, and online that job is done by a public server.
      This does it here (see cestis-offline-signalling.js), which is what makes
      the conference pages work with no internet.

      Browsers hand out the camera, the microphone and the video connection
      only to pages served over https://, or opened on this computer as
      localhost — a page fetched over the network as http://192.168.x.x is
      refused all three by every browser. That is why point 1 serves https://.
      Each device shows a certificate warning the first time and never again.

      If this computer has no way to make a certificate, the server falls back
      to http:// and says so: video classes then work on this machine only,
      and everything else carries on as normal.
   3. Provides the SHARED STORE the Google Drive sync normally provides. Each
      page keeps its own file, exactly as it does in the cloud version, except
      the files live in "Offline System/data" on this computer instead of Drive.
      That is what lets the Coordinator's laptop, the office desktop and an
      instructor's tablet see the same trainees, fees and vouchers with no
      internet at all.

   HOW TO RUN IT
   -------------
   Double-click the launcher for your system (START-WINDOWS.bat,
   START-MAC.command, START-LINUX.sh), or from a terminal:
       node cestis-offline-server.js
   It prints the address other devices should type into their browser.

   NO INSTALLATION
   ---------------
   Uses only what Node.js ships with — nothing to download, which is the point
   of an offline build. Node.js 14 or newer is needed; the launchers say so
   and stop if it is missing or older. (They used to fall back to Python's
   web server, which served the records folder and the private key to the
   whole network and shared nothing between devices — see READ ME FIRST.)
   ============================================================================ */
'use strict';

const store = require('./cestis-offline-store.js');
if (store.nodeTooOld(process.versions.node)) {
  console.error('\n  This computer has Node.js ' + process.versions.node + '. The offline system needs');
  console.error('  Node.js ' + store.MIN_NODE_MAJOR + ' or newer — with an older one the pages open but every');
  console.error('  video class fails. Install the current "LTS" version from https://nodejs.org');
  console.error('  (on a computer with internet; copy the installer here), then start again.\n');
  process.exit(1);
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const signalling = require('./cestis-offline-signalling.js');
const lanCert = require('./cestis-offline-cert.js');
// The same merge rules every device uses, so the server can merge each save
// into what it holds instead of replacing it.
let Core = null;
try { Core = require('./cestis-core.js'); } catch (e) { Core = null; }

const ROOT = __dirname;
// Both overridable so the tests can run a server on a scratch folder.
const DATA_DIR = path.resolve(process.env.CESTIS_DATA_DIR || path.join(ROOT, 'data'));
const CERT_DIR = path.resolve(process.env.CESTIS_CERT_DIR || path.join(ROOT, 'cert'));
const USER_LOGIN_DIR = path.join(ROOT, 'User Login');
const PORT = Number(process.env.CESTIS_PORT || process.argv[2] || 8080);
// Set CESTIS_HTTP=1 to force plain http:// — video classes then only work on
// this computer (see the note by the video-class banner below).
const FORCE_HTTP = String(process.env.CESTIS_HTTP || '') === '1' ||
                   process.argv.indexOf('--http') !== -1;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',   '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg'
};

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

/* Every request to the store has to carry this token. The pages fetch it from
   /_cestis/token once they have found this server, so nobody types anything.

   BE HONEST ABOUT WHAT IT DOES: it stops other WEBSITES, open in some browser
   on the network, from reading or rewriting the Centre's records. It does NOT
   stop a person on the Centre's network who can open the system — anyone who
   can load the pages can ask for the token the same way they do. See READ ME
   FIRST, "WHO CAN SEE THE RECORDS".

   It is kept in cert/lan-token so it survives a restart: it used to change
   every time the server started, and every page already open then failed
   every save, silently, until somebody reloaded it. */
const ACCESS_TOKEN = store.loadOrCreateToken(CERT_DIR);
function tokenOk(req) {
  const given = req.headers['x-cestis-token'];
  if (typeof given !== 'string' || given.length !== ACCESS_TOKEN.length) return false;
  // Constant-time compare so the token cannot be guessed a character at a time.
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(ACCESS_TOKEN)); }
  catch (e) { return false; }
}

/* Every address this computer can be reached on, so whoever is setting the
   Centre up can read one out to the room instead of hunting through settings. */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address });
    });
  });
  return out;
}

function send(res, status, body, type, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    // The pages this server serves are same-origin, so they need no CORS grant
    // at all. It used to send '*', which invited EVERY page in every browser on
    // the network — including any website a trainee happened to have open — to
    // read and rewrite the Centre's records.
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CESTIS-Token',
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

/* ---------------------------------------------------------------- the store */
/* One file per page, same shape the Drive backup uses, so a folder copied off
   this machine can be read by the online version and the other way round. */
function safeDataFile(name) {
  // Never let a request reach outside the data folder.
  const clean = String(name || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!clean || clean === '.' || clean === '..') return null;
  return path.join(DATA_DIR, clean.endsWith('.json') ? clean : clean + '.json');
}

function handleData(req, res, name) {
  const file = safeDataFile(name);
  if (!file) return send(res, 400, 'bad file name');

  if (req.method === 'GET') {
    fs.readFile(file, (err, buf) => {
      // Only a file that is not there is "absent". Any other failure (the
      // file busy, locked by a virus scan or a backup tool, too many open
      // files) used to be answered as absent too, and the device then merged
      // its own keys against nothing and saved that over the Centre's file. A
      // 5xx makes the device stop and try again instead.
      if (err) {
        if (err.code === 'ENOENT') return send(res, 404, '{}', MIME['.json']);
        return send(res, 503, 'could not read ' + path.basename(file) + ': ' + (err.code || err.message), null, { 'Retry-After': '5' });
      }
      // A device asking "has it changed since <etag>?" gets a 304 and no body:
      // the half-minute refresh on every device costs next to nothing when
      // nothing moved, instead of the whole file every time.
      const etag = store.etagOf(buf);
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', null, { ETag: etag });
      send(res, 200, buf, MIME['.json'], { ETag: etag });
    });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    // Collect the raw bytes and decode ONCE at the end. Concatenating each
    // chunk as a string decoded every chunk on its own, so a multi-byte
    // character (any accented name, a dash, a currency symbol) that straddled a
    // chunk boundary was torn in half and stored as two replacement characters
    // — and because the JSON still parsed, the damage was saved and synced
    // everywhere without a single error.
    const chunks = [];
    let received = 0, tooBig = false;
    req.on('data', c => {
      received += c.length;
      if (received > 64 * 1024 * 1024) {
        if (!tooBig) { tooBig = true; send(res, 413, 'too large'); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      const body = Buffer.concat(chunks).toString('utf8');
      let incoming;
      try { incoming = JSON.parse(body); } catch (e) { return send(res, 400, 'not JSON'); }
      // Merged into what is stored, one save at a time per file, written to a
      // temporary file of its own and renamed into place, with the previous
      // version kept in data/.history — see cestis-offline-store.js.
      store.save({ file, dataDir: DATA_DIR, incoming, core: Core }).then(r => {
        send(res, 200, JSON.stringify({ ok: true, file: path.basename(file), bytes: r.bytes,
          etag: r.etag, changedByServer: r.changedByServer }), MIME['.json'], { ETag: r.etag });
      }, err => {
        send(res, 500, 'save failed: ' + (err && err.message));
      });
    });
    return;
  }
  send(res, 405, 'method not allowed');
}

function listData(res) {
  ensureDataDir();
  fs.readdir(DATA_DIR, (err, files) => {
    // (data/.history holds earlier versions, not page files, and is a folder.)
    const list = (files || []).filter(f => f.endsWith('.json')).map(f => {
      let size = 0, modified = '';
      try { const st = fs.statSync(path.join(DATA_DIR, f)); size = st.size; modified = st.mtime.toISOString(); } catch (e) {}
      return { file: f, size, modified };
    });
    send(res, 200, JSON.stringify({ ok: true, folder: DATA_DIR, files: list }, null, 2), MIME['.json']);
  });
}

/* --------------------------------------------------------------- the pages */
function serveStatic(req, res, urlPath) {
  // A stray percent sign in the address used to throw out of this line and take
  // the whole server down with it — one mistyped address, one stale bookmark or
  // one network scanner and the entire Centre lost the system until somebody
  // walked over and started it again.
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { return send(res, 400, 'That address could not be read.'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  // A prefix test alone let any SIBLING folder whose name merely starts the same
  // way be served — "Offline System-backup", "Offline System (old)" — each of
  // which holds an older copy of the Centre's data and its own private key.
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');
  // The records folder and the certificate folder are NOT web pages. Serving
  // them as ordinary files handed out the whole store and the server's private
  // key to anyone who guessed the path. "User Login" can hold real per-user
  // exports (password hashes, two-step secrets), dot-files are not pages, and
  // no key file is ever one either.
  const inside = d => full === d || full.startsWith(d + path.sep);
  const relParts = path.relative(ROOT, full).split(path.sep);
  if (inside(DATA_DIR) || inside(CERT_DIR) || inside(path.join(ROOT, 'data')) || inside(path.join(ROOT, 'cert')) ||
      inside(USER_LOGIN_DIR) || relParts.some(p => p.charAt(0) === '.') || /\.(pem|key)$/i.test(full)) {
    return send(res, 403, 'forbidden');
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, 'Not found: ' + rel + '\n\nThis file is not part of the offline system folder.');
    }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    // Range support so long videos and PDFs can be scrubbed rather than
    // downloaded whole before anything plays.
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range) && range !== 'bytes=-') {
      const [s, e] = range.replace('bytes=', '').split('-');
      let start, end;
      if (s === '') {
        // "bytes=-N" means the LAST N bytes. It used to be read as "the first N",
        // so a player asking for the tail of a file was handed the head instead
        // and reported the file as corrupt.
        const n = parseInt(e, 10);
        start = Math.max(0, st.size - n);
        end = st.size - 1;
      } else {
        start = parseInt(s, 10);
        // Clamp: an open-ended or over-long request used to promise more bytes
        // in Content-Length than the file holds, so the player sat waiting for
        // data that could never arrive until the connection timed out.
        end = e ? Math.min(parseInt(e, 10), st.size - 1) : st.size - 1;
      }
      if (start >= st.size || end < start) return send(res, 416, 'range not satisfiable');
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start + 1)
      });
      fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(full).pipe(res);
  });
}

function isLoopback(req) {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/* ------------------------------------------------------------------ server */
/* https:// when this computer can make itself a certificate, http:// when it
   cannot. The scheme is not cosmetic: browsers only give the camera, the
   microphone and the video connection to a page on an address they trust, so
   video classes work on other devices ONLY over https. Everything else works
   the same either way. See cestis-offline-cert.js. */
const tls = FORCE_HTTP ? null : lanCert.ensure(CERT_DIR, msg => console.log('  ' + msg));
const SCHEME = tls ? 'https' : 'http';

const handler = (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = req.url || '/';

  if (url === '/_cestis/health') {
    // Just enough for a page to know this is the Centre's server and to set
    // its clock by — no folder paths or machine names for anyone who asks.
    return send(res, 200, JSON.stringify({
      ok: true, mode: 'offline-lan', version: '1.1', time: new Date().toISOString()
    }), MIME['.json']);
  }
  if (url === '/_cestis/token') {
    return send(res, 200, JSON.stringify({ ok: true, token: ACCESS_TOKEN }), MIME['.json']);
  }
  if (url === '/_cestis/rooms') {
    // Every live class's room code — and the room code is all it takes to
    // join. Shown on the server computer itself (READ ME FIRST, section 5),
    // or to one of our pages carrying the token; not to the whole network.
    if (!isLoopback(req) && !tokenOk(req)) return send(res, 403, 'Open this on the server computer itself.');
    return send(res, 200, JSON.stringify({ ok: true, connected: sig.count(), rooms: sig.rooms() }, null, 2), MIME['.json']);
  }
  // PeerJS asks for a generated id when a page does not supply one. Every page
  // here names its own, but the endpoint has to exist or the library complains.
  if (url.indexOf('/peerjs/id') === 0) {
    return send(res, 200, Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  if (url === '/_cestis/data' || url === '/_cestis/data/' || url.indexOf('/_cestis/data/') === 0) {
    if (!tokenOk(req)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'not authorised for this Centre\u2019s records' }), MIME['.json']);
    }
    if (url === '/_cestis/data' || url === '/_cestis/data/') return listData(res);
    return handleData(req, res, url.slice('/_cestis/data/'.length));
  }
  serveStatic(req, res, url);
};

/* Last line of defence. Whatever goes wrong in one request, the Centre keeps
   its system: the fault is written down and the server carries on serving. */
process.on('uncaughtException', err => {
  try { console.error('  A request failed unexpectedly (the system is still running): ' + (err && err.stack || err)); } catch (e) {}
});
process.on('unhandledRejection', err => {
  try { console.error('  A background step failed (the system is still running): ' + (err && err.stack || err)); } catch (e) {}
});

const server = tls
  ? https.createServer({ key: tls.key, cert: tls.cert }, handler)
  : http.createServer(handler);

ensureDataDir();

/* Video classes: carry the introductions between browsers on this network. */
const sig = signalling.attach(server, msg => console.log('  ' + msg));

server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('\n  Port ' + PORT + ' is already being used by something else.');
    console.error('  Start it on another port, e.g.:  node cestis-offline-server.js 8090\n');
  } else {
    console.error('\n  Could not start: ' + (err && err.message) + '\n');
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const line = '='.repeat(64);
  const url = h => SCHEME + '://' + h + ':' + PORT + '/index.html';
  console.log('\n' + line);
  console.log('  C.E.S.T.I.S  —  OFFLINE SYSTEM IS RUNNING');
  console.log(line);
  console.log('\n  On THIS computer, open:');
  console.log('      ' + url('localhost'));
  if (addrs.length) {
    console.log('\n  On ANY OTHER device on the same network (wifi or cable),');
    console.log('  open one of these in a browser:');
    addrs.forEach(a => console.log('      ' + url(a.address) + '      (' + a.name + ')'));
  } else {
    console.log('\n  This computer is not on a network yet, so only this machine');
    console.log('  can reach it. Connect to the Centre wifi/router and restart.');
  }

  if (tls) {
    console.log('\n  THE FIRST TIME each device opens that address, the browser will');
    console.log('  warn that the connection is "not private". That warning is about');
    console.log('  WHO vouched for this server\'s certificate — nobody did, because');
    console.log('  there is no internet here to ask. The connection itself is');
    console.log('  encrypted. Click Advanced, then Proceed. The device remembers,');
    console.log('  and never asks again.');
    console.log('\n  Video classes work on every device at those addresses.');
    if (tls.created) {
      console.log('  (A certificate for this computer was just created in the "cert"');
      console.log('  folder. Keep it — remaking it makes every device ask again.)');
    }
  } else {
    console.log('\n  VIDEO CLASSES — LIMITED');
    console.log('  This server is speaking plain http://, so browsers will not give');
    console.log('  it the camera or microphone on any device except this one.');
    console.log('      Video WORKS at:      ' + url('localhost'));
    if (addrs.length) console.log('      Video is BLOCKED at: ' + url(addrs[0].address));
    if (!FORCE_HTTP) {
      console.log('\n  To turn video on for the whole network, this computer needs the');
      console.log('  "openssl" command so the server can make itself a certificate.');
      console.log('  It is already on macOS and Linux; on Windows it comes with Git');
      console.log('  (https://git-scm.com). Install it, then start this again.');
    }
    console.log('\n  Everything else — trainees, fees, attendance, documents — works');
    console.log('  normally on every device at the addresses above.');
  }

  console.log('\n  Shared data is kept in:');
  console.log('      ' + DATA_DIR);
  console.log('  Back that folder up — it is the Centre\'s records. The last ' + store.HISTORY_KEEP);
  console.log('  versions of every file are kept in its ".history" folder, so a');
  console.log('  bad save can be undone (see READ ME FIRST, section 3).');
  if (!Core) console.log('\n  WARNING: cestis-core.js could not be loaded, so saves REPLACE files instead of merging.');
  console.log('\n  Leave this window OPEN while people are using the system.');
  console.log('  Closing it stops the server for everybody.');
  console.log('\n' + line + '\n');
});
