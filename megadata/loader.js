/* MegaData — the on-demand loader for everyday pages.

   MegaData is built but dormant: no broker is set up, so every page runs in
   its legacy mode (page-boot.js decides that from the broker settings this
   browser keeps — and there are none). Loading the whole stack on every
   everyday page still cost 100–122 KB and a Storage wrapper on every page
   load, for nothing.

   So an everyday page loads only this file, with its MegaData scripts listed
   in the tag (in order, with their ?v= tags, which `npm run stamp` keeps):

     <script src="megadata/loader.js?v=…" data-megadata="megadata/schemas.js?v=… …"></script>

   It looks — without creating anything — for the broker settings that
   MegaData-Admin.html stores in this browser (IndexedDB CESTIS_MEGA, key
   meta/brokerConfig). Only if a broker has been set up on this device does it
   load the page's MegaData scripts, in order, and they start exactly as they
   would have (each glue file starts at once when the page has already been
   read). With no broker — every device today — nothing more is fetched and the
   page behaves as legacy mode always did.

   The MegaData admin pages (MegaData-Admin.html, MegaData-Adjudication.html)
   still load the whole stack directly. window.__cestisMegaLoad is a promise of
   'loaded' or 'dormant', for tests. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var me = document.currentScript;
  var list = String((me && me.getAttribute('data-megadata')) || '').split(/\s+/).filter(Boolean);
  var DB = 'CESTIS_MEGA', SEP = '\u0000';

  /* Is a broker set up in this browser? Never creates the database: opening
     one that does not exist is cancelled in onupgradeneeded. */
  function brokerSetUp() {
    return new Promise(function (resolve) {
      var idb;
      try { idb = window.indexedDB; } catch (e) { idb = null; }
      if (!idb || !list.length) return resolve(false);
      var req;
      try { req = idb.open(DB, 1); } catch (e) { return resolve(false); }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (e) {} };
      req.onerror = function () { resolve(false); };
      req.onblocked = function () { resolve(false); };
      req.onsuccess = function () {
        var db = req.result;
        var done = function (v) { try { db.close(); } catch (e) {} resolve(v); };
        try {
          if (!db.objectStoreNames.contains('kv')) return done(false);
          var g = db.transaction('kv', 'readonly').objectStore('kv').get('meta' + SEP + 'brokerConfig');
          g.onsuccess = function () { var bc = g.result; done(!!(bc && bc.url && bc.secret)); };
          g.onerror = function () { done(false); };
        } catch (e) { done(false); }
      };
    });
  }

  function loadInOrder(i) {
    if (i >= list.length) return Promise.resolve('loaded');
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = list[i];
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(list[i] + ' could not be loaded')); };
      (document.head || document.documentElement).appendChild(s);
    }).then(function () { return loadInOrder(i + 1); });
  }

  window.__cestisMegaLoad = brokerSetUp().then(function (yes) {
    if (!yes) return 'dormant';
    return loadInOrder(0).catch(function (e) {
      console.warn('[MegaData] ' + e.message + ' — this page stays in legacy mode');
      return 'dormant';
    });
  });
})();
