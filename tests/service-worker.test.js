/* The offline copy (sw.js) must never hide a deploy or touch the Centre's data.

   What it fixes: with no connection the dashboard did not open at all, and a
   first load on a 3G phone waited for ~1.6 MB of libraries nothing on the
   sign-in screen uses (ui-15). sw.js now keeps a copy of the pages and scripts
   a device has loaded and serves it ONLY when the network fails; index.html
   defers the libraries it does not need while it is being read.

   A service worker that caches the wrong thing is worse than none: a stale
   page masking a fix, a cached Drive response, a cached LAN data call. So the
   routing is a pure function and every rule is pinned here:
     - network-first for pages and same-origin scripts; never cache-first;
     - other sites (Google sign-in, Drive, APIs, EmailJS, PeerJS, CDNs), the
       Offline System's /_cestis/ and /peerjs calls, POSTs, range requests,
       the worker itself and the kill-switch file are never touched;
     - it works under a GitHub Pages project folder and at a LAN server root;
     - the install-time copy is read from index.html itself (so it follows
       every ?v= bump), and includes nothing from another site;
     - the kill switch is the same file name in the worker and the page;
     - the generator ships the worker, manifest and icons to the Offline System;
     - index.html's head blocks on no library the sign-in screen does not need.

   Run: node tests/service-worker.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const sw = require('../sw.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const route = (url, extra) => sw.routeRequest(Object.assign({ url: url, method: 'GET' }, extra || {}), SCOPE);
let SCOPE;

/* ---------- 1. GitHub Pages: a project site in a sub-folder ---------- */
console.log('On GitHub Pages (a project site in a sub-folder)');
SCOPE = 'https://cestis-technical-services-limited.github.io/C.E.S.T.I.S-Train/';
[
  ['index.html', { mode: 'navigate' }], ['', { mode: 'navigate' }], ['Transcript-Grades.html?role=student&studentId=S1', { mode: 'navigate' }],
  ['cestis-core.js?v=20261021u'], ['cestis-page-cloud.js?v=20261021u'], ['vendor/pdf-3.11.174.min.js'], ['Pages/Online-Exams.html'],
  ['finance-docs.css'], ['manifest.json'], ['icons/icon-192.png'], ['cert-keys.json'], ['megadata/dal.js?v=1']
].forEach(function (c) {
  assert(route(SCOPE + c[0], c[1]) === 'network-first', c[0] + ' is network-first (the network\'s answer always wins)');
});
[
  ['https://www.googleapis.com/drive/v3/files?q=x', 'Drive API'],
  ['https://accounts.google.com/gsi/client', 'Google sign-in'],
  ['https://oauth2.googleapis.com/token', 'Google OAuth'],
  ['https://api.emailjs.com/api/v1.0/email/send', 'EmailJS'],
  ['https://0.peerjs.com/peerjs/id', 'PeerJS cloud signalling'],
  ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'a CDN'],
  ['https://fonts.googleapis.com/css2?family=DM+Sans', 'Google Fonts'],
  ['https://cestis-technical-services-limited.github.io/other-project/index.html', 'another project on the same github.io host'],
  ['https://cestis-technical-services-limited.github.io/C.E.S.T.I.S-Train', 'the folder without its slash (GitHub redirects it)']
].forEach(function (c) {
  assert(route(c[0]) === 'bypass' && route(c[0], { mode: 'navigate' }) === 'bypass', c[1] + ' is never touched');
});
assert(route(SCOPE + 'sw-disable') === 'bypass' && route(SCOPE + 'sw-disable', { mode: 'navigate' }) === 'bypass', 'the kill-switch file is always fetched fresh');
assert(route(SCOPE + 'sw.js') === 'bypass', 'the worker never serves itself');
assert(route(SCOPE + 'index.html', { method: 'POST' }) === 'bypass' && route(SCOPE + 'x.json', { method: 'PUT' }) === 'bypass', 'nothing but GET');
assert(route(SCOPE + 'vendor/pdf.worker-3.11.174.min.js', { headers: { range: 'bytes=0-99' } }) === 'bypass', 'range requests (video / PDF scrubbing) are left alone');
['recording.mp4', 'docs/handbook.pdf', 'vendor/tesseract/eng.traineddata.gz', 'vendor/x.wasm', 'megadata-broker-url.txt'].forEach(function (f) {
  assert(route(SCOPE + f) === 'bypass', f + ' is not page-shaped and is not kept');
});
assert(route(SCOPE + 'docs/handbook.pdf', { mode: 'navigate' }) === 'bypass', 'opening a PDF in its own tab is not a page either');
['User%20Login/USR-1/profile.json', 'data/CESTIS_ALL_DATA.json', 'cert/key.pem', '.git/config', 'node_modules/x/index.js'].forEach(function (f) {
  assert(route(SCOPE + f) === 'bypass', f + ' is never kept');
});
assert(route('chrome-extension://abc/x.js') === 'bypass' && route('data:text/plain,hi') === 'bypass', 'non-web addresses are left alone');
assert(route(SCOPE + '%E0%A4%A') === 'bypass', 'an unreadable address is left alone rather than throwing');

/* ---------- 2. The Offline System's own server (scope = the server root) ---------- */
console.log('On the Offline System server (scope is the server root)');
SCOPE = 'https://192.168.1.20:8443/';
assert(route(SCOPE + 'index.html', { mode: 'navigate' }) === 'network-first', 'its pages are network-first');
assert(route(SCOPE + 'cestis-offline-rtc.js?v=20261020a') === 'network-first', 'and its scripts');
['_cestis/health', '_cestis/token', '_cestis/rooms', '_cestis/data/CESTIS_LMS_Dashboard.json', '_cestis/data', 'peerjs/id', 'peerjs?key=x'].forEach(function (f) {
  assert(route(SCOPE + f) === 'bypass', '/' + f + ' (the server\'s API) is never touched');
});
SCOPE = 'http://localhost:8090/';
assert(route(SCOPE + '_cestis/data/CESTIS_LMS_Dashboard.json', { method: 'PUT' }) === 'bypass' &&
  route(SCOPE + '_cestis/data/CESTIS_LMS_Dashboard.json') === 'bypass', 'reads and writes of the Centre\'s records go straight to the server');

/* ---------- 3. The install-time copy ---------- */
console.log('The first visit\'s copy is read from index.html itself');
SCOPE = 'https://cestis-technical-services-limited.github.io/C.E.S.T.I.S-Train/';
const shell = sw.shellUrlsFromHtml(INDEX, SCOPE + 'index.html');
const rel = shell.map(u => u.slice(SCOPE.length));
const coreTag = /<script src="(cestis-core\.js\?v=[^"]+)"/.exec(INDEX)[1];
assert(rel.indexOf(coreTag) !== -1, 'it takes cestis-core.js with the exact ?v= the page asks for (' + coreTag + ')');
const cloudTag = /<script src="(cestis-page-cloud\.js\?v=[^"]+)"/.exec(INDEX)[1];
['vendor/otpauth-9.2.2.umd.min.js', 'vendor/peerjs-1.5.4.min.js', 'manifest.json', 'icons/icon.svg',
 'Pages/Online-Exams.html', 'Pages/Student-Certificate.html', 'LMS-Chat.html', 'Video-Conference-Student.html', cloudTag].forEach(function (f) {
  assert(rel.indexOf(f) !== -1, 'it keeps ' + f);
});
// The libraries fetched on first use are kept when they are first used, not
// downloaded up front: a trainee on prepaid data never pays for the exam
// importer or the board's charts.
['vendor/pdf-3.11.174.min.js', 'vendor/mammoth-1.6.0.browser.min.js', 'vendor/chart-4.4.1.umd.min.js', 'vendor/jspdf-2.5.1.umd.min.js'].forEach(function (f) {
  assert(rel.indexOf(f) === -1, 'it does not download ' + f + ' ahead of its first use');
});
assert(shell.every(u => u.indexOf(SCOPE) === 0), 'and nothing from any other site (' + shell.filter(u => u.indexOf(SCOPE) !== 0).join(', ') + ')');
assert(!rel.some(f => /^https?:/.test(f) || /gsi\/client|googleapis|cdnjs|jsdelivr|unpkg/.test(f)), 'no Google, Drive or CDN address slips in');
assert(rel.length === new Set(rel).size, 'no file twice');
assert(sw.shellUrlsFromHtml('<script src="https://evil.example/x.js"></script><script src="data:text/javascript,1"></script>', SCOPE + 'index.html').length === 0,
  'a foreign or data: script is never taken');

/* ---------- 4. Worker code: network first, one cache, versioned ---------- */
console.log('The worker itself');
const SWSRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const fetchHandler = SWSRC.slice(SWSRC.indexOf("self.addEventListener('fetch'"));
assert(/event\.respondWith\(\s*fetch\(request\)\.then\(/.test(fetchHandler), 'a request goes to the network first');
assert(/fromCache\(request\)/.test(fetchHandler.slice(fetchHandler.indexOf('function (err)'))), 'and to the copy only when the network fails');
assert(!/caches\.match\([^)]*\)\.then\(function \(hit\) \{\s*if \(hit\) return hit;\s*return fetch/.test(SWSRC), 'never cache-first');
assert(/response\.type !== 'basic'/.test(SWSRC) && /no-store/.test(SWSRC) && /status !== 200/.test(SWSRC), 'only complete same-site answers are kept, and never one marked no-store');
assert(/n\.indexOf\(CACHE_PREFIX\) === 0 && n !== CACHE_NAME/.test(SWSRC), 'activation deletes every older version of its cache');
assert(sw.CACHE_NAME.indexOf(sw.CACHE_PREFIX) === 0, 'the cache name carries the version prefix');
assert(/self\.registration\.unregister\(\)/.test(SWSRC) && /KILL_FILE/.test(SWSRC), 'the worker can switch itself off');
assert(/addEventListener\('message'/.test(SWSRC) && /event\.data\.cestis === KILL_FILE/.test(SWSRC) && /if \(killed\) return Promise\.resolve\(\)/.test(SWSRC),
  'told by the page, it stops answering and keeping at once (an unregistered worker still serves open pages)');

/* ---------- 5. The page: manifest, registration, kill switch ---------- */
console.log('index.html installs it safely');
const head = INDEX.slice(0, INDEX.indexOf('</head>'));
assert(/<link rel="manifest" href="manifest\.json">/.test(head) && /<meta name="theme-color"/.test(head) && /<link rel="icon" href="icons\/icon\.svg"/.test(head),
  'the page links its manifest, theme colour and icon');
const reg = head.slice(head.indexOf('(function registerOfflineCopy()'), head.indexOf('})();', head.indexOf('(function registerOfflineCopy()')));
assert(/window\.addEventListener\('load'/.test(reg) && /serviceWorker\.register\('sw\.js'\)/.test(reg), 'it registers sw.js (relative: works in a sub-folder) only after the page has loaded');
assert(/isSecureContext/.test(reg), 'and only where browsers allow it (https or localhost)');
assert(reg.indexOf("fetch('" + sw.KILL_FILE + "'") !== -1, 'it looks for the same kill-switch file as the worker (' + sw.KILL_FILE + ')');
assert(/sw=off/.test(reg) && /cestis_sw_disabled/.test(reg) && /unregister\(\)/.test(reg), '?sw=off or a local flag removes it on one device');
assert(reg.indexOf("postMessage({ cestis: '" + sw.KILL_FILE + "' })") !== -1, 'and the page tells the running worker to stop first');
assert(/disabled === null\) return/.test(reg), 'with no network the check is skipped and nothing is removed');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
assert(/^\.\//.test(manifest.start_url) && manifest.scope === './', 'the manifest is relative, so it works in a GitHub Pages sub-folder');
assert(manifest.icons.length >= 2 && manifest.icons.every(i => fs.existsSync(path.join(ROOT, i.src))), 'every icon it names exists');
assert(manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'), 'with the 192 and 512 sizes an install needs');

/* ---------- 6. The Offline System ships it ---------- */
console.log('The Offline System generator ships it');
const planned = require('../tools/build-offline.js').plan();
['sw.js', 'manifest.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'].forEach(function (f) {
  assert(planned.has(f), 'the offline build ships ' + f);
});

/* ---------- 7. The head blocks on nothing the sign-in screen does not need ---------- */
console.log('Nothing the sign-in screen does not use holds up its first paint');
const tags = INDEX.slice(0, INDEX.indexOf('<body')).match(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g) || [];
// Read by the page while it is being parsed, or wrapped as they load (PeerJS by cestis-offline-rtc.js).
const MAY_BLOCK = /^(cestis-core|cestis-page-cloud|staff-appraisals|cmc-portal|cert-template-seed|cestis-offline-rtc)\.js|^vendor\/peerjs-/;
// (A CDN address here is PeerJS's document.write fallback, written only when the local copy is missing.)
const blocking = tags.filter(t => !/\b(defer|async)\b/.test(t)).map(t => /src="([^"?]+)/.exec(t)[1])
  .filter(s => !MAY_BLOCK.test(s) && !/^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/(npm\/)?peerjs@/.test(s));
assert(blocking.length === 0, 'no other library blocks the first paint — still blocking: ' + blocking.join(', '));
// Small and possibly needed at sign-in (two-step, e-mailed codes): deferred.
['otpauth-9.2.2', 'qrcode-1.0.0', 'emailjs-4'].forEach(function (lib) {
  assert(tags.some(t => t.indexOf('vendor/' + lib) !== -1 && /\bdefer\b/.test(t)), lib + ' is deferred');
});
// Big and needed by one screen each: not loaded by the page at all.
['pdf-3.11.174', 'mammoth-1.6.0', 'chart-4.4.1', 'jspdf-2.5.1'].forEach(function (lib) {
  assert(!tags.some(t => t.indexOf('vendor/' + lib) !== -1), lib + ' is not loaded with the page');
});
const fb = head.slice(head.indexOf('(function cestisVendorLoader()'), head.indexOf('})();', head.indexOf('(function cestisVendorLoader()')));
[['pdfjsLib', 'vendor/pdf-3.11.174.min.js'], ['mammoth', 'vendor/mammoth-1.6.0.browser.min.js'], ['Chart', 'vendor/chart-4.4.1.umd.min.js'],
 ['jspdf', 'vendor/jspdf-2.5.1.umd.min.js']].forEach(function (p) {
  assert(new RegExp(p[0] + ": \\{ local: '" + p[1].replace(/\./g, '\\.') + "'").test(fb), p[0] + ' is fetched on first use from this site (' + p[1] + '), a CDN only if that fails');
});
['OTPAuth', 'QRCode', 'emailjs'].forEach(function (g) {
  assert(new RegExp(g + ': \\{ cdn:').test(fb), 'a deferred ' + g + ' that did not load is fetched from a CDN (without document.write)');
});
['pdfjsLib', 'mammoth', 'Chart', 'OTPAuth', 'QRCode', 'emailjs', 'jspdf'].forEach(function (g) {
  assert(!new RegExp('window\\.' + g + "\\|\\|\\(.*document\\.write").test(INDEX), 'no document.write fallback is left for ' + g);
});
assert(/flag: '__cestisPdfjsCdnjs'/.test(fb) && /flag: '__cestisPdfjsFallback'/.test(fb) && /cestisPdfWorkerSetup/.test(fb), 'pdf.js still picks the worker that matches where it came from');
assert(/lib\.promise = null; reject/.test(fb), 'a failed load is not remembered: asking again (back online) tries again');
// Every use waits for its library.
function useSite(fn) {
  const i = INDEX.indexOf('function ' + fn + '(');
  return i < 0 ? '' : INDEX.slice(i, i + 5000);
}
[['extractTextFromPDF', 'pdfjsLib'], ['extractTextFromDocx', 'mammoth'], ['cmcRenderCharts', 'Chart'],
 ['generateEnrolmentRegisterPDF', 'jspdf'], ['generateCertificatePDF', 'jspdf']].forEach(function (p) {
  assert(new RegExp("cestisNeedLib\\('" + p[1] + "'\\)\\.then\\(").test(useSite(p[0])), p[0] + '() waits for ' + p[1] + ' before using it');
});
assert(!/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf[^'"]*['"];\s*\n\s*script\.onload/.test(INDEX), 'the certificate builders no longer go straight to a CDN (which fails on the Centre\'s offline network)');
assert(/cestisPdfWorkerSetup\(\);\s*\n\s*pdfjsLib\.getDocument/.test(INDEX), 'pdf.js\'s worker is set up before each use');
assert(/if\(typeof emailjs !== 'undefined'\)\{ go\(\); \}\s*\n\s*else \{ document\.addEventListener\('DOMContentLoaded', go\); \}/.test(INDEX),
  'EmailJS is still initialised once its deferred script has run');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
