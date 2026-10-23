/* ============================================================================
   sw.js — the CESTIS service worker: the dashboard opens with no connection.

   WHY THIS EXISTS
   ---------------
   A trainee on a prepaid phone, or a Centre whose internet has dropped, could
   not open the site at all — although every record they need is already on
   the device (IndexedDB). This worker keeps a copy of the pages and scripts
   the device has already loaded, and hands a copy back ONLY when the network
   fails. It is what lets the dashboard be installed as an app (manifest.json).

   THE RULES  (routeRequest below; tests/service-worker.test.js pins them)
   - Pages and scripts are NETWORK-FIRST. Whenever the network answers, its
     answer is what the page gets, so a new deploy is never hidden behind an
     old copy. The copy is used only when the request fails outright.
   - Never touched — the browser handles these exactly as if this worker did
     not exist: anything that is not a GET; anything on another site (Google
     sign-in, Drive and its APIs, EmailJS, PeerJS, the CDNs, fonts); the
     Offline System server's own calls (/_cestis/..., /peerjs...); range
     requests (video and PDF scrubbing); this file and the kill-switch file;
     anything outside this site's own folder (GitHub Pages serves many sites
     from one host).
   - Only page-shaped files are kept: .html .js .css .json and images. Never
     media, never anything under User Login/, data/ or cert/.
   - One cache, named after CACHE_VERSION. A new version deletes every older
     cache when it takes over. Changing this file at all makes every browser
     install the new worker on its next visit.

   KILL SWITCH
   -----------
   Deploy a file named  sw-disable  (any content) next to index.html. The next
   time a page loads — or this worker wakes for a page — the worker deletes
   its cache and unregisters itself, and pages stop registering it. Delete the
   file to allow it again. On one device only: open the site with ?sw=off, or
   run  localStorage.setItem('cestis_sw_disabled', '1')  in the console.

   It works the same on GitHub Pages (a project site lives in a sub-folder; the
   worker's scope is that folder) and on the Offline System's own server
   (scope is the server root). Browsers only run service workers on https://
   or localhost; on a plain-http LAN address it is simply never registered.
   ============================================================================ */
'use strict';

var CACHE_VERSION = 'v1';
var CACHE_PREFIX = 'cestis-shell-';
var CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
var KILL_FILE = 'sw-disable';
// The biggest single file worth keeping (pdf.worker is ~1 MB; xlsx ~0.9 MB).
var MAX_KEEP_BYTES = 8 * 1024 * 1024;
var KEEP_EXT = /\.(?:html?|js|mjs|css|json|webmanifest|png|jpe?g|gif|svg|ico|webp|woff2?)$/i;

/* What to do with one request. Pure: plain values in, one word out —
     'network-first'  fetch it; keep a copy; use the copy only if fetching fails
     'bypass'         do not touch it (the browser fetches it as normal)
   req: { url, method, mode, headers: { range } }; scope: the worker's scope URL. */
function routeRequest(req, scope) {
  if (!req || String(req.method || 'GET').toUpperCase() !== 'GET') return 'bypass';
  var u, s;
  try { u = new URL(String(req.url)); s = new URL(String(scope)); } catch (e) { return 'bypass'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'bypass';
  if (u.origin !== s.origin) return 'bypass';
  if (u.pathname.indexOf(s.pathname) !== 0) return 'bypass';
  var rel = u.pathname.slice(s.pathname.length);
  try { rel = decodeURIComponent(rel); } catch (e) { return 'bypass'; }
  if (rel === KILL_FILE || rel === KILL_FILE + '.txt' || rel === 'sw.js') return 'bypass';
  if (/(^|\/)(_cestis|peerjs)(\/|$)/i.test(rel)) return 'bypass';
  if (/^(User Login|data|cert|node_modules)(\/|$)/i.test(rel)) return 'bypass';
  if (/(^|\/)\./.test(rel)) return 'bypass';
  var h = req.headers || {};
  if (h.range || h.Range) return 'bypass';
  if (req.mode === 'navigate') {
    // Opening a PDF or a video in its own tab is a navigation too: not a page.
    return (rel === '' || /\/$/.test(rel) || /\.html?$/i.test(rel)) ? 'network-first' : 'bypass';
  }
  return (rel === '' || KEEP_EXT.test(rel)) ? 'network-first' : 'bypass';
}

/* The files a first visit should leave behind so the dashboard opens offline
   the next time: index.html, every script and stylesheet it loads from this
   site, its icons, and the section files it mounts (Pages/*.html, the chat
   and video fragments). Read from index.html itself, so the list can never
   fall out of step with it — including each script's ?v= version. Pure. */
function shellUrlsFromHtml(html, pageUrl) {
  var text = String(html || '');
  var found = [];
  function add(ref) {
    if (!ref || /^(?:data|blob|javascript|mailto):/i.test(ref)) return;
    var abs;
    try { abs = new URL(ref, pageUrl).href; } catch (e) { return; }
    if (found.indexOf(abs) === -1) found.push(abs);
  }
  var m;
  var scriptRx = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = scriptRx.exec(text))) add(m[1]);
  var linkRx = /<link\b[^>]*>/gi;
  while ((m = linkRx.exec(text))) {
    var tag = m[0];
    var rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag);
    var href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (rel && href && /\b(stylesheet|manifest|icon|apple-touch-icon)\b/i.test(rel[1])) add(href[1]);
  }
  var fileRx = /\bfile\s*:\s*["']([A-Za-z0-9._\/-]+\.html)["']/g;   // cestisFeatureConfig entries
  var pageRx = /["'](Pages\/[A-Za-z0-9._-]+\.html)["']/g;
  while ((m = fileRx.exec(text))) add(m[1]);
  while ((m = pageRx.exec(text))) add(m[1]);
  return found.filter(function (url) { return routeRequest({ url: url, method: 'GET' }, pageUrl.replace(/[^\/]*$/, '')) === 'network-first'; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { routeRequest: routeRequest, shellUrlsFromHtml: shellUrlsFromHtml, CACHE_NAME: CACHE_NAME, CACHE_PREFIX: CACHE_PREFIX, KILL_FILE: KILL_FILE };
}

/* ------------------------------------------------------------ the worker */
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof caches !== 'undefined' &&
    typeof module === 'undefined') {

  var scope = function () { return self.registration.scope; };

  var keepable = function (response) {
    if (!response || !response.ok || response.status !== 200 || response.type !== 'basic') return false;
    var cc = response.headers.get('Cache-Control') || '';
    if (/no-store/i.test(cc)) return false;
    var len = parseInt(response.headers.get('Content-Length') || '0', 10);
    return !(len && len > MAX_KEEP_BYTES);
  };

  var killed = false;
  var dropAllCopies = function () {
    return caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0; }).map(function (n) { return caches.delete(n); }));
    });
  };

  // One copy per file: a newer ?v= replaces the older one instead of piling up.
  var keep = function (request, response) {
    if (killed) return Promise.resolve();
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.keys(request, { ignoreSearch: true }).then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.url !== request.url; }).map(function (k) { return cache.delete(k); }));
      }).then(function () { return cache.put(request, response); });
    }).then(function () {
      // Switched off while this was being written: leave nothing behind.
      if (killed) return dropAllCopies();
    }).catch(function () {});
  };

  var fromCache = function (request) {
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request).then(function (hit) {
        if (hit || request.mode !== 'navigate') return hit || null;
        // A page opened with different ?query (Transcript-Grades.html?role=…)
        // is still that page; the scope's bare address is index.html.
        return cache.match(request, { ignoreSearch: true }).then(function (h2) {
          if (h2) return h2;
          var rel = new URL(request.url).pathname.slice(new URL(scope()).pathname.length);
          return (rel === '' || /\/$/.test(rel)) ? cache.match(new URL('index.html', scope()).href, { ignoreSearch: true }) : null;
        });
      });
    }).catch(function () { return null; });
  };

  var offlinePage = function () {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Offline</title><body style="font-family:system-ui,sans-serif;background:#0c1117;color:#e8edf3;padding:32px;line-height:1.6">' +
      '<h1 style="font-size:20px">You are offline</h1><p>This page has not been opened on this device before, so there is no copy of it here yet. ' +
      'Reconnect and try again.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  };

  // ---------------------------------------------------------- kill switch
  var lastKillCheck = 0;
  var checkKillSwitch = function () {
    lastKillCheck = Date.now();
    return fetch(new URL(KILL_FILE, scope()).href, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) return false;
      killed = true;
      return dropAllCopies().then(function () { return self.registration.unregister(); }).then(function () { return true; });
    }, function () { return false; });
  };

  // The page found the kill switch (or ?sw=off): stop answering and keeping
  // at once — an unregistered worker still serves the pages already open.
  self.addEventListener('message', function (event) {
    if (event.data && event.data.cestis === KILL_FILE) {
      killed = true;
      event.waitUntil(dropAllCopies());
    }
  });

  self.addEventListener('install', function (event) {
    self.skipWaiting();
    event.waitUntil(
      checkKillSwitch().then(function (off) {
        if (off) return;
        var indexUrl = new URL('index.html', scope()).href;
        return fetch(indexUrl).then(function (r) {
          if (!keepable(r)) return;
          return r.clone().text().then(function (html) {
            var urls = shellUrlsFromHtml(html, indexUrl);
            return keep(new Request(indexUrl), r).then(function () {
              return Promise.all(urls.map(function (u) {
                return fetch(u).then(function (res) { return keepable(res) ? keep(new Request(u), res) : null; }, function () { return null; });
              }));
            });
          });
        });
      }).catch(function () {})
    );
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); }));
      }).then(function () { return self.clients.claim(); }).catch(function () {})
    );
  });

  self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (killed) return;
    // A request the browser may only answer from its own cache is not ours.
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
    var route = routeRequest({ url: request.url, method: request.method, mode: request.mode,
      headers: { range: request.headers.get('range') } }, scope());
    if (route !== 'network-first') return;
    // Look for the kill switch now and then (at most every ten minutes) when a
    // page is opened; the page itself also looks on every load.
    if (request.mode === 'navigate' && Date.now() - lastKillCheck > 10 * 60 * 1000) event.waitUntil(checkKillSwitch());
    event.respondWith(
      fetch(request).then(function (response) {
        if (keepable(response)) {
          var copy = response.clone();
          event.waitUntil(keep(request, copy));
        }
        return response;
      }, function (err) {
        return fromCache(request).then(function (hit) {
          if (hit) return hit;
          if (request.mode === 'navigate') return offlinePage();
          throw err;
        });
      })
    );
  });
}
