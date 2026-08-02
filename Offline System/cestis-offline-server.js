#!/usr/bin/env node
/* ============================================================================
   cestis-offline-server.js — runs the whole CESTIS system on one computer and
   serves it to every other device on the same local network. No internet.

   WHAT IT DOES
   ------------
   1. Serves every page in this folder over http:// — the system needs a real
      web address, not file://, because browsers refuse storage and page loading
      to documents opened straight off the disk.
   2. Introduces browsers to each other so VIDEO CLASSES work. Two browsers
      cannot start a call unaided — something has to carry the first few
      messages between them, and online that job is done by a public server.
      This does it here (see cestis-offline-signalling.js), which is what makes
      the conference pages work with no internet.

      One caveat that is NOT ours to fix here: browsers hand out the camera,
      the microphone and the video connection only to pages served over
      https://, or opened on this computer as localhost. A page fetched over
      the network as http://192.168.x.x is refused them by every browser. So
      video classes run on THIS computer as-is; to run them on other devices
      the pages have to be served over https://. Everything else in the system
      is unaffected and works on every device over http://.
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
   of an offline build. If Node is not available, use the Python launcher
   instead; it serves the pages but not the shared store.
   ============================================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const signalling = require('./cestis-offline-signalling.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.CESTIS_PORT || process.argv[2] || 8080);

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
    // Everything is local; let any device on the network talk to the store.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    fs.readFile(file, 'utf8', (err, txt) => {
      if (err) return send(res, 404, '{}', MIME['.json']);
      send(res, 200, txt, MIME['.json']);
    });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 64 * 1024 * 1024) { req.destroy(); }   // sanity bound
    });
    req.on('end', () => {
      try { JSON.parse(body); } catch (e) { return send(res, 400, 'not JSON'); }
      ensureDataDir();
      // Write to a temporary file and rename, so a power cut mid-save cannot
      // leave a half-written page file behind.
      const tmp = file + '.tmp';
      fs.writeFile(tmp, body, 'utf8', err => {
        if (err) return send(res, 500, 'write failed: ' + err.message);
        fs.rename(tmp, file, err2 => {
          if (err2) return send(res, 500, 'save failed: ' + err2.message);
          send(res, 200, JSON.stringify({ ok: true, file: path.basename(file), bytes: body.length }), MIME['.json']);
        });
      });
    });
    return;
  }
  send(res, 405, 'method not allowed');
}

function listData(res) {
  ensureDataDir();
  fs.readdir(DATA_DIR, (err, files) => {
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
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, 'Not found: ' + rel + '\n\nThis file is not part of the offline system folder.');
    }
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    // Range support so long videos and PDFs can be scrubbed rather than
    // downloaded whole before anything plays.
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = s ? parseInt(s, 10) : 0;
      const end = e ? parseInt(e, 10) : st.size - 1;
      if (start >= st.size) return send(res, 416, 'range not satisfiable');
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

/* ------------------------------------------------------------------ server */
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  const url = req.url || '/';

  if (url === '/_cestis/health') {
    return send(res, 200, JSON.stringify({
      ok: true, mode: 'offline-lan', version: '1.0',
      host: os.hostname(), dataFolder: DATA_DIR, time: new Date().toISOString()
    }), MIME['.json']);
  }
  if (url === '/_cestis/rooms') {
    return send(res, 200, JSON.stringify({ ok: true, connected: sig.count(), rooms: sig.rooms() }, null, 2), MIME['.json']);
  }
  // PeerJS asks for a generated id when a page does not supply one. Every page
  // here names its own, but the endpoint has to exist or the library complains.
  if (url.indexOf('/peerjs/id') === 0) {
    return send(res, 200, Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  if (url === '/_cestis/data' || url === '/_cestis/data/') return listData(res);
  if (url.indexOf('/_cestis/data/') === 0) {
    return handleData(req, res, url.slice('/_cestis/data/'.length));
  }
  serveStatic(req, res, url);
});

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
  console.log('\n' + line);
  console.log('  C.E.S.T.I.S  —  OFFLINE SYSTEM IS RUNNING');
  console.log(line);
  console.log('\n  On THIS computer, open:');
  console.log('      http://localhost:' + PORT + '/index.html');
  if (addrs.length) {
    console.log('\n  On ANY OTHER device on the same network (wifi or cable),');
    console.log('  open one of these in a browser:');
    addrs.forEach(a => console.log('      http://' + a.address + ':' + PORT + '/index.html      (' + a.name + ')'));
  } else {
    console.log('\n  This computer is not on a network yet, so only this machine');
    console.log('  can reach it. Connect to the Centre wifi/router and restart.');
  }
  console.log('\n  VIDEO CLASSES');
  console.log('  This server introduces the browsers to each other, so video needs');
  console.log('  no internet. It does need a page address the browser trusts with');
  console.log('  the camera and microphone, and browsers only trust https:// or');
  console.log('  localhost — never a plain http:// network address.');
  console.log('      Video WORKS at:      http://localhost:' + PORT + '/index.html');
  if (addrs.length) {
    console.log('      Video is BLOCKED at: http://' + addrs[0].address + ':' + PORT + '/index.html');
  }
  console.log('  Everything else — trainees, fees, attendance, documents — works');
  console.log('  normally on every device at the network address above.');
  console.log('\n  Shared data is kept in:');
  console.log('      ' + DATA_DIR);
  console.log('  Back that folder up — it is the Centre\'s records.');
  console.log('\n  Leave this window OPEN while people are using the system.');
  console.log('  Closing it stops the server for everybody.');
  console.log('\n' + line + '\n');
});
