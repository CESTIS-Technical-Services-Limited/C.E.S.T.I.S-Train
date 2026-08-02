/* ============================================================================
   cestis-page-cloud.js — a Google Drive save path for every page.

   WHY THIS EXISTS
   ---------------
   Most pages in this system own a slice of the data — the finance documents,
   the payment vouchers, the transcript pages, the chat — and had no cloud path
   of their own. Their data reached Drive only if the LMS dashboard happened to
   be open and connected at the time, because that dashboard's master snapshot
   sweeps every storage key. Work done with the dashboard closed sat on one
   machine, and on any other machine the page came up empty.

   Each page now writes its OWN backup file, all of them into one folder, so
   what a page saved can be found and restored without depending on some other
   page having been open.

   WHAT A PAGE HAS TO DO
   ---------------------
     <script src="cestis-core.js"></script>
     <script src="cestis-page-cloud.js"></script>
     <script>
       CESTISPageCloud.init({
         page: 'Payment Vouchers',                 // shown in the file and in logs
         file: 'CESTIS_Payment_Vouchers.json',     // its own file in the folder
         keys: ['cestis_finance_voucher_overrides'],
         prefixes: ['cestis_quarter_']             // optional, for generated key names
       });
     </script>

   From then on the page pulls its file when the store is ready and pushes,
   debounced, whenever one of its own keys is written. Merging is per key and
   newest-write-wins (CESTISCore.pageCloud.mergeKeys), so two devices editing
   the same page converge instead of overwriting each other.

   AUTHENTICATION
   --------------
   Reuses the Google token the dashboard already stores. This file never asks
   for consent of its own: a page that opens without a token simply stays local
   and says so through status(), rather than throwing an OAuth popup at somebody
   in the middle of typing an invoice.
   ============================================================================ */
(function (root) {
  'use strict';

  // The one folder every page's backup goes into.
  var FOLDER_ID = '11vWe_Nc40TtJ1Hi7PoE7EZ3JrpR-K0Vj';

  var TOKEN_KEY = 'schoolDashboardGoogleAccessToken';
  var EXPIRY_KEY = 'schoolDashboardGoogleTokenExpiry';
  var PUSH_DELAY_MS = 1500;   // debounce: a burst of edits becomes one upload

  function store() { return root.CESTISStore || root.localStorage; }
  function core() { return root.CESTISCore && root.CESTISCore.pageCloud; }

  function token() {
    try {
      var t = store().getItem(TOKEN_KEY);
      if (!t) return null;
      var exp = store().getItem(EXPIRY_KEY);
      if (exp && new Date(exp) <= new Date()) return null;   // expired: treat as offline
      return t;
    } catch (e) { return null; }
  }

  function storeMap() {
    var out = {}, s = store();
    try {
      var keys = s.keys ? s.keys() : Object.keys(root.localStorage);
      keys.forEach(function (k) { try { out[k] = s.getItem(k); } catch (e) {} });
    } catch (e) {}
    return out;
  }

  function api(url, opts) {
    return root.fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('http-' + r.status);
      return r;
    });
  }

  function Page(spec) {
    this.spec = spec;
    this.stampsKey = 'cestis_pagecloud_stamps__' + spec.file;
    this.fileId = null;
    this.lastPush = '';
    this.state = { connected: false, lastPull: '', lastPush: '', error: '', keys: 0 };
    this._timer = null;
  }

  Page.prototype.stamps = function () {
    try { return JSON.parse(store().getItem(this.stampsKey) || '{}') || {}; }
    catch (e) { return {}; }
  };
  Page.prototype.setStamps = function (s) {
    try { store().setItem(this.stampsKey, JSON.stringify(s)); } catch (e) {}
  };
  /* Record that these keys were written here, now. */
  Page.prototype.touch = function (keys) {
    var s = this.stamps(), now = new Date().toISOString();
    (keys || []).forEach(function (k) { s[k] = now; });
    this.setStamps(s);
  };

  Page.prototype.find = function (tok) {
    var self = this;
    if (this.fileId) return Promise.resolve(this.fileId);
    var q = "name='" + this.spec.file + "' and '" + FOLDER_ID + "' in parents and trashed=false";
    return api('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,modifiedTime)',
      { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        self.fileId = (d.files && d.files.length) ? d.files[0].id : null;
        return self.fileId;
      });
  };

  /* Bring this page's file down and merge it into local storage. Resolves with
     the keys that changed locally. */
  Page.prototype.pull = function () {
    var self = this, tok = token();
    if (!tok) { self.state.connected = false; return Promise.resolve([]); }
    self.state.connected = true;
    return self.find(tok).then(function (id) {
      if (!id) return [];
      return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media',
        { headers: { Authorization: 'Bearer ' + tok } })
        .then(function (r) { return r.json(); })
        .then(function (payload) {
          if (!payload || !payload.data) return [];
          var C = core();
          var local = C.collect(self.spec, storeMap());
          var known = self.stamps();
          // No stamps at all means this device has never synced this page: its
          // storage holds nothing, or the page's own start-up defaults. The
          // Centre's data in the cloud wins that first time.
          var first = Object.keys(known).length === 0;
          var res = C.mergeKeys(local, known, payload.data, payload.stamps || {}, { firstSync: first });
          res.changed.forEach(function (k) {
            try { store().setItem(k, res.data[k]); } catch (e) {}
          });
          // Always record stamps after a pull, even when nothing changed, so the
          // next pull is judged on recency rather than treated as a first sync.
          self.setStamps(res.stamps && Object.keys(res.stamps).length ? res.stamps : { __synced: new Date().toISOString() });
          self.state.lastPull = new Date().toISOString();
          self.state.keys = Object.keys(res.data).length;
          return res.changed;
        });
    }).catch(function (e) { self.state.error = (e && e.message) || 'pull-failed'; return []; });
  };

  /* Write this page's keys up, merged with whatever is already in the file so a
     second device's work is never dropped. */
  Page.prototype.push = function () {
    var self = this, tok = token();
    if (!tok) { self.state.connected = false; return Promise.resolve(false); }
    self.state.connected = true;
    var C = core();
    var data = C.collect(self.spec, storeMap());
    var stamps = self.stamps();

    return self.find(tok).then(function (id) {
      var remote = Promise.resolve({ data: {}, stamps: {} });
      if (id) {
        remote = api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media',
          { headers: { Authorization: 'Bearer ' + tok } })
          .then(function (r) { return r.json(); })
          .then(function (p) { return { data: (p && p.data) || {}, stamps: (p && p.stamps) || {} }; })
          .catch(function () { return { data: {}, stamps: {} }; });
      }
      return remote.then(function (cloud) {
        // Local wins only where local is newer; the union goes up.
        var merged = C.mergeKeys(data, stamps, cloud.data, cloud.stamps);
        var payload = C.buildPayload(self.spec, merged.data, merged.stamps, {
          savedAt: new Date().toISOString(),
          savedBy: (root.currentLoggedInUser && root.currentLoggedInUser.username) || root.currentRole || 'unknown'
        });
        var body = JSON.stringify(payload);
        if (body === self.lastPush) return true;      // nothing changed since last upload
        var blob = new Blob([body], { type: 'application/json' });
        var done = function (ok) {
          if (ok) {
            self.lastPush = body;
            self.state.lastPush = payload.savedAt;
            self.state.keys = payload.keyCount;
            // Anything the cloud contributed is now local too.
            merged.changed.forEach(function (k) { try { store().setItem(k, merged.data[k]); } catch (e) {} });
            self.setStamps(merged.stamps);
          }
          return ok;
        };
        if (id) {
          return api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media',
            { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: blob })
            .then(function () { return done(true); });
        }
        var fd = new FormData();
        fd.append('metadata', new Blob([JSON.stringify({ name: self.spec.file, parents: [FOLDER_ID], mimeType: 'application/json' })], { type: 'application/json' }));
        fd.append('file', blob);
        return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) { self.fileId = d.id || self.fileId; return done(true); });
      });
    }).catch(function (e) { self.state.error = (e && e.message) || 'push-failed'; return false; });
  };

  Page.prototype.schedulePush = function () {
    var self = this;
    clearTimeout(self._timer);
    self._timer = setTimeout(function () { self.push(); }, PUSH_DELAY_MS);
  };

  /* Watch this page's own keys. Every write through CESTISStore is stamped and
     queued for upload; writes from another tab arrive as storage events. */
  Page.prototype.watch = function () {
    var self = this, s = store();
    if (s && typeof s.setItem === 'function' && !s.__pageCloudWrapped) {
      var orig = s.setItem.bind(s);
      s.setItem = function (k, v) {
        var r = orig(k, v);
        try {
          (root.CESTISPageCloud._pages || []).forEach(function (pg) {
            if (core().ownsKey(pg.spec, String(k))) { pg.touch([String(k)]); pg.schedulePush(); }
          });
        } catch (e) {}
        return r;
      };
      s.__pageCloudWrapped = true;
    }
    try {
      root.addEventListener('storage', function (ev) {
        if (!ev || !ev.key) return;
        if (core().ownsKey(self.spec, String(ev.key))) self.schedulePush();
      });
    } catch (e) {}
    // Last chance to get an edit out when the page is being closed.
    try {
      root.addEventListener('pagehide', function () { clearTimeout(self._timer); self.push(); });
    } catch (e) {}
  };

  var API = {
    FOLDER_ID: FOLDER_ID,
    _pages: [],
    init: function (spec) {
      if (!spec || !spec.file) throw new Error('CESTISPageCloud.init needs a file name');
      if (!core()) { try { console.warn('[PageCloud] cestis-core.js must load first'); } catch (e) {} return null; }
      var existing = API._pages.filter(function (p) { return p.spec.file === spec.file; })[0];
      if (existing) return existing;
      var pg = new Page(spec);
      API._pages.push(pg);
      pg.watch();
      var start = function () { pg.pull().then(function (changed) { if (changed.length && typeof spec.onRestore === 'function') spec.onRestore(changed); }); };
      if (store() && store().whenReady) store().whenReady(start); else start();
      return pg;
    },
    saveNow: function () { return Promise.all(API._pages.map(function (p) { clearTimeout(p._timer); return p.push(); })); },
    loadNow: function () { return Promise.all(API._pages.map(function (p) { return p.pull(); })); },
    status: function () {
      return API._pages.map(function (p) {
        return { page: p.spec.page, file: p.spec.file, folder: FOLDER_ID,
          connected: p.state.connected, keys: p.state.keys,
          lastPull: p.state.lastPull, lastPush: p.state.lastPush, error: p.state.error };
      });
    }
  };

  root.CESTISPageCloud = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
