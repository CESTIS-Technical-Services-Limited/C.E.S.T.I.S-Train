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

   THE CENTRE'S OWN SERVER (the Offline System)
   --------------------------------------------
   The same file runs both builds. When the pages are served by
   cestis-offline-server.js — the "Offline System" folder, on the Centre's own
   network with no internet — that server answers /_cestis/health, and every
   page's file is kept THERE instead of in Drive: same file per page, same
   merge rules, plus a mirror of the whole store. Anywhere else (GitHub Pages,
   a memory stick) nothing answers, and the Drive path below runs exactly as it
   always has. See the LAN section near the end of this file.
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
  /* Which collections a Drive merge treats record by record: all registered
     ones for a page that asks (spec.records), otherwise the ones whose whole
     list was the only copy (CESTISCore.pageCloud.DRIVE_RECORD_KEYS). */
  function driveRecords(spec) {
    if (spec && spec.records) return true;
    var C = core();
    return (C && C.DRIVE_RECORD_KEYS) || false;
  }

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

  /* A push merges the file's newer records into this device's storage on the
     way up ("anything the cloud contributed is now local too"). That is news
     for the page exactly as a pull's changes are, and it used to be written
     without a word: the records reached storage but never the page's memory,
     and every later pull then found storage and file alike and reported
     nothing. On the Centre's network a trainee's device that happened to save
     just after the instructor set an assignment (or an exam, or a class) kept
     showing "No assignments yet" until the page was reloaded. */
  function tellPageOfPushMerge(pg, keys) {
    if (!pg || !keys || !keys.length || typeof pg.spec.onRestore !== 'function') return;
    try { pg.spec.onRestore(keys.slice()); } catch (e) {}
  }

  /* ...and only what nobody changed on this device while the push was on its
     way. A push reads storage, then waits on the network twice (read the
     file, write it); an edit saved in that gap — a date typed and saved a
     moment after the save that started the push — used to be overwritten by
     the merge of the OLDER reading, its stamp with it. The edit was gone from
     storage, and once the page adopts what a push brings back (above), from
     the screen as well. A key edited in the gap is left exactly as it is,
     with its own newer stamp; its own write has already scheduled the push
     that carries it. Writes the rest, sets the stamps, and returns the keys
     it wrote. */
  function writeBackFromPush(pg, snapshot, merged, quietly) {
    var wrote = [], kept = [];
    if (quietly) API._applying = true;
    try {
      merged.changed.forEach(function (k) {
        var now = null;
        try { now = store().getItem(k); } catch (e) { kept.push(k); return; }
        var then = Object.prototype.hasOwnProperty.call(snapshot, k) ? snapshot[k] : null;
        if (now !== then) { kept.push(k); return; }
        try { store().setItem(k, merged.data[k]); wrote.push(k); } catch (e) {}
      });
    } finally { if (quietly) API._applying = false; }
    var stamps = merged.stamps || {};
    if (kept.length) {
      var mine = pg.stamps();
      kept.forEach(function (k) { if (mine[k]) stamps[k] = mine[k]; });
    }
    pg.setStamps(stamps);
    return wrote;
  }

  function Page(spec) {
    this.spec = spec;
    this.stampsKey = 'cestis_pagecloud_stamps__' + spec.file;
    this.fileId = null;
    this.lastPush = '';
    this.state = { connected: false, lastPull: '', lastPush: '', error: '', keys: 0, shared: 0 };
    this._timer = null;
    this._sharedIds = {};        // shared file name -> Drive file id, cached per session
  }

  /* Find any file in the folder by name. */
  function findFile(name, tok) {
    var q = "name='" + name + "' and '" + FOLDER_ID + "' in parents and trashed=false";
    return api('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id)',
      { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d.files && d.files.length) ? d.files[0].id : null; });
  }

  /* Bring down the CROSS-PAGE collections this page reads but does not own.

     A page backs up only the keys it owns, so a page that merely reads a shared
     collection — the trainee roll, the training centres, the fee roll — never
     fetched it from Drive at all. It rendered whatever was in this device's
     local storage, which on a machine that had not opened the owning page meant
     stale data or none.

     Reader semantics, deliberately: what comes down is merged in by the same
     newest-write-wins rule as everything else, and these keys are NEVER pushed
     up as part of this page's own backup (ownsKey() still decides what goes
     into the page's file), so reading a shared collection can never overwrite
     the page that owns it. A page that must also DECIDE something inside a
     shared collection — the CMC Board approving a virement — declares that one
     key in `writes` and sends it back into the OWNING page's file through
     pushShared(); see below.

     Resolves with the keys that changed locally. */
  Page.prototype.pullShared = function () {
    var self = this, tok = token();
    var C = core();
    var reads = self.spec.reads || [];
    if (!tok || !reads.length || !C.sharedPullPlan) return Promise.resolve([]);

    var plan = C.sharedPullPlan(reads, self.spec.file);
    if (!plan.length) return Promise.resolve([]);

    return Promise.all(plan.map(function (src) {
      var idP = self._sharedIds[src.file]
        ? Promise.resolve(self._sharedIds[src.file])
        : findFile(src.file, tok).then(function (id) { self._sharedIds[src.file] = id; return id; });

      return idP.then(function (id) {
        if (!id) return [];
        return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media',
          { headers: { Authorization: 'Bearer ' + tok } })
          .then(function (r) { return r.json(); })
          .then(function (payload) {
            if (!payload || !payload.data) return [];
            // Only the keys this page said it reads — the rest of that file is
            // the owning page's business.
            var cloud = C.pickShared(payload.data, src.keys);
            var cloudStamps = C.pickShared(payload.stamps || {}, src.keys);
            // Picked the same way as the cloud side, so a generated-name
            // collection ('cestis_quarter_*') compares like for like instead of
            // looking absent locally and being adopted wholesale every pull.
            var local = C.pickShared(storeMap(), src.keys);
            var known = self.stamps();
            /* Recency is judged against the OWNING page's stamp too. This
               page's own map only says when it last took a key from the cloud;
               a write the owner made on this device since (a cheque entered on
               the Cashbook while its uploads were stopped) is stamped in the
               owner's map, and without it any newer cloud copy replaced that
               write here — on the first pull it replaced it outright. */
            var owner = {};
            try { owner = JSON.parse(store().getItem('cestis_pagecloud_stamps__' + src.file) || '{}') || {}; } catch (e) { owner = {}; }
            var judged = {};
            Object.keys(known).forEach(function (k) { judged[k] = known[k]; });
            Object.keys(owner).forEach(function (k) {
              if ((Date.parse(owner[k] || '') || 0) > (Date.parse(judged[k] || '') || 0)) judged[k] = owner[k];
            });
            var first = Object.keys(judged).length === 0;
            var res = C.mergeKeys(local, judged, cloud, cloudStamps, { firstSync: first, records: driveRecords(self.spec) });
            res.changed.forEach(function (k) {
              try { store().setItem(k, res.data[k]); } catch (e) {}
            });
            // Remember when each shared key was last taken from the cloud, so
            // the next pull is judged on recency rather than read as a first
            // sync — without claiming to OWN the key.
            if (res.changed.length) {
              var s = self.stamps();
              res.changed.forEach(function (k) { if (res.stamps[k]) s[k] = res.stamps[k]; });
              self.setStamps(s);
            }
            return res.changed;
          })
          .catch(function () { return []; });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var changed = [];
      lists.forEach(function (l) { l.forEach(function (k) { if (changed.indexOf(k) === -1) changed.push(k); }); });
      self.state.shared = changed.length;
      return changed;
    });
  };

  /* Send a DECISION back into a collection this page reads but does not own.

     A reader is normally write-blind, and that is right for a page that only
     displays somebody else's records. But a page can be the one body entitled
     to settle something inside them: the CMC Board approves virement requests
     it does not otherwise operate. Writing that approval only into local
     storage would strand it on the board member's own device.

     So a key named in `writes` — which must also be in `reads`, since deciding
     without reading is nonsense — is merged into the OWNING page's file:
       - only the declared keys are touched; the rest of that file is the
         owning page's business and is copied back untouched;
       - the merge is the same newest-write-wins rule as everywhere else, with
         the same guard that an empty value never replaces records, so a
         decision cannot wipe the register it was recorded in;
       - if the owning page has never published a file, nothing is created
         here. The decision stays local and travels when that page next
         pushes — writing a file on another page's behalf would invent a
         backup nobody had verified.

     Resolves with the keys actually written up. */
  Page.prototype.pushShared = function (keys) {
    var self = this, tok = token(), C = core();
    var allowed = self.spec.writes || [];
    var wanted = (Array.isArray(keys) ? keys : allowed).filter(function (k) { return allowed.indexOf(k) !== -1; });
    if (!tok || !wanted.length || !C.sharedPullPlan) return Promise.resolve([]);

    var plan = C.sharedPullPlan(wanted, self.spec.file);
    if (!plan.length) return Promise.resolve([]);

    return Promise.all(plan.map(function (src) {
      var idP = self._sharedIds[src.file]
        ? Promise.resolve(self._sharedIds[src.file])
        : findFile(src.file, tok).then(function (id) { self._sharedIds[src.file] = id; return id; });

      return idP.then(function (id) {
        if (!id) return [];                               // owner has no file: stay local
        return api('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media',
          { headers: { Authorization: 'Bearer ' + tok } })
          .then(function (r) { return r.json(); })
          .then(function (payload) {
            if (!payload || !payload.data) return [];
            var cloudAll = payload.data, cloudStampsAll = payload.stamps || {};
            var local = C.pickShared(storeMap(), src.keys);
            if (!Object.keys(local).length) return [];
            var cloud = C.pickShared(cloudAll, src.keys);
            var cloudStamps = C.pickShared(cloudStampsAll, src.keys);
            var merged = C.mergeKeys(local, self.stamps(), cloud, cloudStamps, { records: driveRecords(self.spec) });

            var wrote = [];
            Object.keys(merged.data).forEach(function (k) {
              if (cloudAll[k] === merged.data[k]) return;
              cloudAll[k] = merged.data[k];
              if (merged.stamps[k]) cloudStampsAll[k] = merged.stamps[k];
              wrote.push(k);
            });
            if (!wrote.length) return [];
            payload.data = cloudAll;
            payload.stamps = cloudStampsAll;
            payload.savedAt = new Date().toISOString();
            payload.keyCount = Object.keys(cloudAll).length;
            var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            return api('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media',
              { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: blob })
              .then(function () {   // only now is the decision really in the Centre's folder
                // Anything the cloud contributed is now local too.
                merged.changed.forEach(function (k) { try { store().setItem(k, merged.data[k]); } catch (e) {} });
                self.setStamps(merged.stamps);
                return wrote;
              });
          })
          .catch(function () { return []; });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var wrote = [];
      lists.forEach(function (l) { l.forEach(function (k) { if (wrote.indexOf(k) === -1) wrote.push(k); }); });
      return wrote;
    });
  };

  Page.prototype.stamps = function () {
    try { return JSON.parse(store().getItem(this.stampsKey) || '{}') || {}; }
    catch (e) { return {}; }
  };
  Page.prototype.setStamps = function (s) {
    try { store().setItem(this.stampsKey, JSON.stringify(s)); } catch (e) {}
  };
  /* Record that these keys were written here, now. ("Now" by the Centre's
     server clock on its network — see lanNow() — and this device's clock
     everywhere else.) */
  Page.prototype.touch = function (keys) {
    var s = this.stamps(), now = lanNow();
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
        self.remoteModified = (d.files && d.files.length) ? (d.files[0].modifiedTime || '') : '';
        return self.fileId;
      });
  };

  /* Has the file in Drive changed since we last pulled it? One metadata query —
     no download — so the periodic refresh below costs almost nothing when
     nothing moved. Errs on the side of "yes" so a failed check never leaves a
     page stale. */
  Page.prototype.remoteChanged = function (tok) {
    var self = this;
    var q = "name='" + this.spec.file + "' and '" + FOLDER_ID + "' in parents and trashed=false";
    return api('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,modifiedTime)',
      { headers: { Authorization: 'Bearer ' + tok } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var f = (d.files && d.files.length) ? d.files[0] : null;
        if (!f) return false;                       // nothing there to pull
        self.fileId = f.id;
        var changed = (f.modifiedTime || '') !== (self.lastPulledModified || '');
        self.remoteModified = f.modifiedTime || '';
        return changed;
      })
      .catch(function () { return true; });
  };

  /* Bring this page's file down and merge it into local storage. Resolves with
     the keys that changed locally. */
  Page.prototype.pull = function () {
    var self = this, tok = token();
    // A READER owns no keys and publishes no file of its own — there is nothing
    // to pull or create here; pullShared() is its whole job.
    if (self.spec.readOnly) { self.state.connected = !!tok; return Promise.resolve([]); }
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
          // A page whose keys are collections of records (spec.records) merges
          // them record by record, so two offices' edits to different records
          // both stand instead of the later whole list undoing the other's.
          var res = C.mergeKeys(local, known, payload.data, payload.stamps || {}, { firstSync: first, records: driveRecords(self.spec) });
          // Adopting the cloud's copy is not editing — see the note in watch().
          API._applying = true;
          try {
            res.changed.forEach(function (k) {
              try { store().setItem(k, res.data[k]); } catch (e) {}
            });
          } finally { API._applying = false; }
          // Always record stamps after a pull, even when nothing changed, so the
          // next pull is judged on recency rather than treated as a first sync.
          self.setStamps(res.stamps && Object.keys(res.stamps).length ? res.stamps : { __synced: new Date().toISOString() });
          self.state.lastPull = new Date().toISOString();
          self.state.keys = Object.keys(res.data).length;
          // Remember which revision this was, so the periodic refresh can tell
          // "unchanged" from one metadata query instead of a full download.
          self.lastPulledModified = self.remoteModified || '';
          return res.changed;
        });
    }).catch(function (e) { self.state.error = (e && e.message) || 'pull-failed'; return []; });
  };

  /* Write this page's keys up, merged with whatever is already in the file so a
     second device's work is never dropped. */
  Page.prototype.push = function () {
    var self = this, tok = token();
    if (self.spec.readOnly) return Promise.resolve(false);   // a reader never writes
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
          .then(function (p) { return { data: (p && p.data) || {}, stamps: (p && p.stamps) || {} }; });
        // A download that FAILED (a network error, a 5xx, a cut-off body) is
        // not an empty file. It used to be merged as one, and the upload that
        // followed replaced the Centre's file with this device's keys alone.
        // Only "no file at all" (find() found none) starts from empty; a
        // failure stops this push, and the next save or page close retries.
      }
      return remote.then(function (cloud) {
        // Local wins only where local is newer; the union goes up.
        var merged = C.mergeKeys(data, stamps, cloud.data, cloud.stamps, { records: driveRecords(self.spec) });
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
            tellPageOfPushMerge(self, writeBackFromPush(self, data, merged, false));
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
          // A pull writing the cloud's own copy back into storage is not an edit
          // made on this device. Without this test each of those writes was
          // stamped "now" and scheduled straight back up, so the value just
          // taken from Drive was immediately re-uploaded with a newer stamp —
          // and two devices on the refresh cycle could trade the same value
          // between them indefinitely, re-writing the file every time.
          if (API._applying) return r;
          // On the Centre's network, a device that may not author this key
          // (a trainee's, or one whose session was just cleared) writes it
          // locally only — see setAuthorPolicy().
          if (lan.on && API._authorPolicy && !API._authorPolicy(String(k))) return r;
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

  /* ==========================================================================
     THE LAN — the Centre's own server, for the Offline System.

     When the pages are served by cestis-offline-server.js, that server is the
     Centre's shared store: each page's file lives in its data/ folder and every
     device on the network reads and writes it there. Nothing below runs unless
     /_cestis/health answers as that server, so on GitHub Pages (or a page
     opened off a memory stick) the Drive path above is untouched.

     What is different here, and why:
       - Collections of records (the roll, exam results, attendance,
         submissions, chat...) are merged RECORD BY RECORD
         (CESTISCore.pageCloud.mergeKeys with `records`). A shorter list —
         a trainee's device trimming its copy at sign-out, a device that has
         not pulled yet — can never delete anybody else's records; only a
         tombstone deletes. The server merges every save into what it holds
         by the same rule, so two devices saving at once cannot lose either.
       - A few keys never leave the device: who is signed in on THIS screen,
         an exam half-way through, Google tokens.
       - "Now" is the server's clock. Devices on a network with no internet
         have nothing to set their clocks by, and newest-wins is only as good
         as the clocks it compares.
       - The server's access token is fetched once the server has answered,
         and fetched again if the server was restarted, instead of every open
         page silently failing until somebody reloaded it.
     ========================================================================== */
  var LOCAL_BASE = '/_cestis/data/';
  var LAN_REFRESH_MS = 30000;
  var lan = { probe: null, on: false, token: '', offset: 0, synced: false, failures: 0, cache: {} };

  /* Off the Centre's network, "now" is this device's clock as corrected by the
     last server time it measured (CESTISCore.sync.setClockOffset — Google's
     Date header on the dashboard), so a clock days fast does not date its
     writes into the future. */
  function lanNow() {
    if (!lan.on && !lan.offset) {
      var S = root.CESTISCore && root.CESTISCore.sync;
      if (S && typeof S.nowIso === 'function') return S.nowIso();
    }
    return new Date(Date.now() + (lan.offset || 0)).toISOString();
  }

  /* Keys that describe THIS device, never the Centre: copying them to another
     machine would sign people in as each other or resume someone else's exam.
     A trainee's saved exam attempt (cestisExamSession__<trainee>__<exam>) and
     this PC's queue of not-yet-uploaded submissions hold a trainee's answers;
     the results themselves travel in voctrain_examResults. Each user's private
     copy (voctrain_user_<id>_*) holds their direct messages, so it stays on the
     PC it was written on — the shared collections already carry the Centre's
     records.

     Everything that describes THIS browser's session is the device's too:
     the session's trainee and its heartbeat (voctrain_sessionStudentId,
     voctrain_sessionSeenAt — the dashboard withdraws the heartbeat when its
     idle lock closes, and the record pages refuse to open without a fresh
     one; travelling, one device's heartbeat kept every other device's
     "still open", so a locked lab PC's session could be borrowed in a new
     tab), who is signed in for the older pages, this device's "not yet
     uploaded" markers (cestisPendingUpload must stay where the work is
     waiting), its id in the certificate download count, its support e-mail
     budget, its "seen this help" dismissals and its own copy of a video
     room's chat (each line marked as sent from this device or not). */
  var DEVICE_KEYS = ['isLoggedIn', 'loggedInUser', 'cestisCurrentUser', 'cestiCurrentUser', 'cestisAttendanceCurrentUser',
    'cestisPendingUpload', 'cestisUnsyncedOnSignOut', 'cestisCertDeviceSessionId', 'voctrain_supportSendLog',
    'voctrain_sessionUpgradeCarried',
    // This screen's light/dark choice: one person's Light never reaches another device.
    'cestisTheme'];
  function deviceOnly(k) {
    return /^voctrain_session(Expiry|Role|UserId|StudentId|SeenAt)$/.test(k) || k === 'voctrain_examInProgress' ||
           k.indexOf('cestisExamSession__') === 0 || k === 'cestisExamOutbox' ||
           k.indexOf('voctrain_user_') === 0 ||
           DEVICE_KEYS.indexOf(k) !== -1 ||
           k.indexOf('voctrain_extSysCertHelpSeen_') === 0 || k.indexOf('vcChatHistory_') === 0 ||
           /AccessToken$|TokenExpiry$/i.test(k);
  }
  function lanCollect(spec, map) {
    var out = core().collect(spec, map);
    Object.keys(out).forEach(function (k) { if (deviceOnly(k)) delete out[k]; });
    return out;
  }
  function lanOnly(data) {
    var out = {};
    Object.keys(data || {}).forEach(function (k) { if (!deviceOnly(k)) out[k] = data[k]; });
    return out;
  }

  function fetchLanToken() {
    return root.fetch('/_cestis/token', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.token) lan.token = String(d.token); return !!(d && d.token); })
      .catch(function () { return false; });
  }

  /* Is this page being served by the Centre's own server? Asked once. */
  function detectLocalServer() {
    if (lan.probe) return lan.probe;
    var loc = root.location;
    // GitHub Pages is never the Centre's server, and a page opened straight
    // off the disk cannot fetch anything — do not even ask.
    if (!root.fetch || !loc || !/^https?:$/.test(loc.protocol || '') || /\.github\.io$/i.test(loc.hostname || '')) {
      lan.probe = Promise.resolve(false);
      return lan.probe;
    }
    lan.probe = root.fetch('/_cestis/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!(d && d.ok && d.mode === 'offline-lan')) return false;
        var t = Date.parse(d.time || '');
        if (!isNaN(t)) {
          lan.offset = t - Date.now();
          // Merges on this device judge "a day in the future" by the
          // Centre's clock too, not by this device's (Core.sync.trusted).
          try { root.CESTISCore.sync.setClockOffset(lan.offset); } catch (e) {}
        }
        return fetchLanToken().then(function () { lan.on = true; return true; });
      })
      .catch(function () { return false; });
    return lan.probe;
  }

  /* One request to the store, with the token. A 401 means the server was
     restarted with a new token (or the token was never fetched): fetch it
     again and try once more, rather than failing quietly from then on. */
  function lanFetch(file, opts, retried) {
    var o = opts || {};
    var h = {};
    Object.keys(o.headers || {}).forEach(function (k) { h[k] = o.headers[k]; });
    h['X-CESTIS-Token'] = lan.token;
    return root.fetch(LOCAL_BASE + encodeURIComponent(file), {
      method: o.method || 'GET', cache: 'no-store', headers: h, body: o.body
    }).then(function (r) {
      if (r.status === 401 && !retried) {
        return fetchLanToken().then(function () { return lanFetch(file, opts, true); });
      }
      return r;
    });
  }

  /* Read a file from the Centre's server. Resolves { ok, status, payload }:
     payload null when the file does not exist yet. A file that has not changed
     since the last read comes back as "not modified" and the copy already in
     hand is reused, so the half-minute refresh costs almost nothing. */
  function localGet(file) {
    var cached = lan.cache[file];
    var headers = cached && cached.etag ? { 'If-None-Match': cached.etag } : {};
    return lanFetch(file, { headers: headers }).then(function (r) {
      if (r.status === 304 && cached) return { ok: true, status: 304, payload: cached.payload, same: true };
      if (r.status === 404) { delete lan.cache[file]; return { ok: true, status: 404, payload: null }; }
      if (!r.ok) return { ok: false, status: r.status, payload: null };
      var etag = (r.headers && r.headers.get) ? r.headers.get('ETag') : null;
      return r.json().then(function (payload) {
        lan.cache[file] = { etag: etag, payload: payload };
        return { ok: true, status: r.status, payload: payload };
      }, function () { return { ok: false, status: r.status, payload: null }; });
    }).catch(function () { return { ok: false, status: 0, payload: null }; });
  }

  function localPut(file, payload) {
    var body = JSON.stringify(payload);
    return lanFetch(file, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) {
        if (!r.ok) return { ok: false, status: r.status };
        return r.json().then(function (d) { return d || {}; }, function () { return {}; }).then(function (d) {
          // The server merges what it is sent into what it holds. When that
          // left exactly what we sent, our copy IS the file — remember it, so
          // the next refresh is a "not modified".
          if (d.etag && d.changedByServer === false) lan.cache[file] = { etag: d.etag, payload: payload };
          else delete lan.cache[file];
          return { ok: true, status: r.status };
        });
      })
      .catch(function () { return { ok: false, status: 0 }; });
  }

  /* Somebody has to be told when their work is not reaching the server: a
     push failing silently looked exactly like one succeeding. A small notice,
     only on the Centre's network, gone as soon as a save gets through. */
  function lanTrouble(on, why) {
    var doc = root.document;
    if (!doc || !doc.body) return;
    var el = doc.getElementById('cestisLanTrouble');
    if (!on) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) {
      el = doc.createElement('div');
      el.id = 'cestisLanTrouble';
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;padding:10px 14px;' +
        'border-radius:8px;background:#7a2e0e;color:#fff;font:600 13px/1.4 system-ui,sans-serif;' +
        'box-shadow:0 4px 18px rgba(0,0,0,.35);';
      doc.body.appendChild(el);
    }
    el.textContent = 'Not reaching the Centre’s server — your work is saved on this device only. ' +
      (why === 'auth' ? 'Reload this page. ' : '') +
      'If this stays, check the server window is still open.';
  }
  function lanResult(page, ok, status) {
    if (ok) {
      lan.failures = 0;
      page.state.error = '';
      lanTrouble(false);
      return;
    }
    lan.failures++;
    page.state.error = status === 401 ? 'not-authorised' : ('server-' + (status || 'unreachable'));
    if (status === 401 || lan.failures >= 2) lanTrouble(true, status === 401 ? 'auth' : '');
  }

  /* Merge a pulled payload into local storage. Returns the keys that changed. */
  Page.prototype.lanApply = function (payload) {
    var self = this;
    if (!payload || !payload.data) return [];
    var C = core();
    var local = lanCollect(self.spec, storeMap());
    var known = self.stamps();
    var first = Object.keys(known).length === 0;
    var res = C.mergeKeys(local, known, lanOnly(payload.data), payload.stamps || {}, { firstSync: first, records: true });
    // Adopting the server's copy is not an edit made here — see watch().
    API._applying = true;
    try {
      res.changed.forEach(function (k) { try { store().setItem(k, res.data[k]); } catch (e) {} });
    } finally { API._applying = false; }
    self.setStamps(res.stamps && Object.keys(res.stamps).length ? res.stamps : { __synced: lanNow() });
    self.state.lastPull = lanNow();
    self.state.keys = Object.keys(res.data).length;
    return res.changed;
  };

  Page.prototype.lanPull = function () {
    var self = this;
    self.state.connected = true;
    self.state.backend = 'offline-server';
    if (self.spec.readOnly) return Promise.resolve([]);   // a reader has no file of its own
    return localGet(self.spec.file).then(function (got) {
      lanResult(self, got.ok, got.status);
      if (!got.ok) return [];
      lan.synced = true;
      if (got.same && self._lanPulledEtag && self._lanPulledEtag === (lan.cache[self.spec.file] || {}).etag) return [];
      self._lanPulledEtag = (lan.cache[self.spec.file] || {}).etag || null;
      return self.lanApply(got.payload);
    });
  };

  /* Whoever is waiting for this device's next save to reach the Centre's
     server (API.whenLanSaved). Each is called once, after a save the server
     has accepted — or one it already held, which is the same thing. */
  var lanSaveWaiters = [];
  function lanSaved() {
    var due = lanSaveWaiters.splice(0, lanSaveWaiters.length);
    due.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  Page.prototype.lanPush = function () {
    var self = this;
    if (self.spec.readOnly) return Promise.resolve(false);
    self.state.connected = true;
    self.state.backend = 'offline-server';
    var C = core();
    var data = lanCollect(self.spec, storeMap());
    return localGet(self.spec.file).then(function (got) {
      if (!got.ok) { lanResult(self, false, got.status); return false; }
      var remote = got.payload || {};
      var merged = C.mergeKeys(data, self.stamps(), lanOnly(remote.data || {}), remote.stamps || {}, { records: true });
      // Only the data and the stamps say whether anything changed; the
      // payload's own savedAt is new on every call, which made the old
      // "nothing to upload" test impossible to pass.
      var sig = JSON.stringify([merged.data, merged.stamps]);
      if (sig === self._lanLastSig && got.same) { lanSaved(); return true; }
      var payload = C.buildPayload(self.spec, merged.data, merged.stamps, {
        savedAt: lanNow(),
        savedBy: (root.currentLoggedInUser && root.currentLoggedInUser.username) || root.currentRole || 'offline'
      });
      return localPut(self.spec.file, payload).then(function (put) {
        lanResult(self, put.ok, put.status);
        if (!put.ok) return false;
        self._lanLastSig = sig;
        self.state.lastPush = payload.savedAt;
        self.state.keys = payload.keyCount;
        tellPageOfPushMerge(self, writeBackFromPush(self, data, merged, true));
        lanSaved();
        return true;
      });
    });
  };

  /* The collections this page reads but does not own, from the files that do. */
  Page.prototype.lanPullShared = function () {
    var self = this, C = core();
    var reads = self.spec.reads || [];
    if (!reads.length || !C.sharedPullPlan) return Promise.resolve([]);
    var plan = C.sharedPullPlan(reads, self.spec.file);
    return Promise.all(plan.map(function (src) {
      return localGet(src.file).then(function (got) {
        if (!got.ok || !got.payload || !got.payload.data) return [];
        var cloud = lanOnly(C.pickShared(got.payload.data, src.keys));
        var cloudStamps = C.pickShared(got.payload.stamps || {}, src.keys);
        var local = C.pickShared(storeMap(), src.keys);
        var known = self.stamps();
        var res = C.mergeKeys(local, known, cloud, cloudStamps, { firstSync: Object.keys(known).length === 0, records: true });
        API._applying = true;
        try {
          res.changed.forEach(function (k) { try { store().setItem(k, res.data[k]); } catch (e) {} });
        } finally { API._applying = false; }
        if (res.changed.length) {
          var s = self.stamps();
          res.changed.forEach(function (k) { if (res.stamps[k]) s[k] = res.stamps[k]; });
          self.setStamps(s);
        }
        return res.changed;
      });
    })).then(function (lists) {
      var changed = [];
      lists.forEach(function (l) { l.forEach(function (k) { if (changed.indexOf(k) === -1) changed.push(k); }); });
      self.state.shared = changed.length;
      return changed;
    });
  };

  /* A decision this page may make inside another page's collection (see
     pushShared above), sent into that page's file on the Centre's server. As
     with Drive, nothing is created on the owning page's behalf. */
  Page.prototype.lanPushShared = function (keys) {
    var self = this, C = core();
    var allowed = self.spec.writes || [];
    var wanted = (Array.isArray(keys) ? keys : allowed).filter(function (k) { return allowed.indexOf(k) !== -1; });
    if (!wanted.length || !C.sharedPullPlan) return Promise.resolve([]);
    var plan = C.sharedPullPlan(wanted, self.spec.file);
    return Promise.all(plan.map(function (src) {
      return localGet(src.file).then(function (got) {
        if (!got.ok || !got.payload || !got.payload.data) return [];
        var payload = got.payload;
        var local = C.pickShared(storeMap(), src.keys);
        if (!Object.keys(local).length) return [];
        var merged = C.mergeKeys(local, self.stamps(), C.pickShared(payload.data, src.keys),
          C.pickShared(payload.stamps || {}, src.keys), { records: true });
        var out = JSON.parse(JSON.stringify(payload));
        out.stamps = out.stamps || {};
        var wrote = [];
        Object.keys(merged.data).forEach(function (k) {
          if (out.data[k] === merged.data[k]) return;
          out.data[k] = merged.data[k];
          if (merged.stamps[k]) out.stamps[k] = merged.stamps[k];
          wrote.push(k);
        });
        if (!wrote.length) return [];
        out.savedAt = lanNow();
        out.keyCount = Object.keys(out.data).length;
        return localPut(src.file, out).then(function (put) {
          if (!put.ok) return [];
          API._applying = true;
          try {
            merged.changed.forEach(function (k) { try { store().setItem(k, merged.data[k]); } catch (e) {} });
          } finally { API._applying = false; }
          self.setStamps(merged.stamps);
          return wrote;
        });
      });
    })).then(function (lists) {
      var wrote = [];
      lists.forEach(function (l) { l.forEach(function (k) { if (wrote.indexOf(k) === -1) wrote.push(k); }); });
      return wrote;
    });
  };

  /* Every sync entry point asks once which backend it is talking to; the Drive
     versions above run unchanged whenever the Centre's server is not there. */
  var drive = { pull: Page.prototype.pull, push: Page.prototype.push,
                pullShared: Page.prototype.pullShared, pushShared: Page.prototype.pushShared };
  Page.prototype.pull = function () {
    var self = this;
    return detectLocalServer().then(function (on) { return on ? self.lanPull() : drive.pull.call(self); });
  };
  Page.prototype.push = function () {
    var self = this;
    return detectLocalServer().then(function (on) { return on ? self.lanPush() : drive.push.call(self); });
  };
  Page.prototype.pullShared = function () {
    var self = this;
    return detectLocalServer().then(function (on) { return on ? self.lanPullShared() : drive.pullShared.call(self); });
  };
  Page.prototype.pushShared = function (keys) {
    var self = this;
    return detectLocalServer().then(function (on) { return on ? self.lanPushShared(keys) : drive.pushShared.call(self, keys); });
  };

  /* THE WHOLE STORE — the LAN's equivalent of Drive's master snapshot.

     Per-page files cover what each page declared. Online, everything else
     still reaches Drive because the dashboard's master snapshot sweeps EVERY
     storage key; on the Centre's network nothing did, so "saved" quietly meant
     "saved on this machine". This mirrors the whole store into one more file,
     by the same merge rules, so a key nobody declared still reaches the server
     and comes back on the next machine. */
  var ALL_SPEC = {
    page: 'Whole store (everything)',
    file: 'CESTIS_ALL_DATA.json',
    all: true,
    // Kept on the device that wrote them, deliberately:
    exclude: [
      // Google credentials — secret, and meaningless on another machine.
      'schoolDashboardGoogleAccessToken', 'schoolDashboardGoogleTokenExpiry',
      'cestisGoogleAccessToken', 'cestisGoogleTokenExpiry',
      // Which Drive file/folder THIS machine last used.
      'schoolDashboardCloudFileId', 'schoolDashboardLastSyncTime',
      'cestisCloudFileId', 'cestisCloudFolderId', 'cestisLastSyncTime',
      'schoolFeeCloudFileId', 'cestisUserFilesFolderId',
      // Who is signed in HERE, and this screen's own preferences. Syncing these
      // would sign people in as each other and fight over dark mode.
      'isLoggedIn', 'loggedInUser', 'cestisCurrentUser', 'cestiCurrentUser',
      'cestisAttendanceCurrentUser', 'darkMode', 'cestisTimeDarkMode', 'cestisTheme',
      // One-off "I have seen this" dismissals.
      'firstTimeSyncDismissed', 'cestisFirstTimeDismissed',
      'postLoginSyncCompleted', 'cloudSyncCompleted', 'cestisAutoSyncEnabled',
      // This device's own "not yet uploaded" marker.
      'cestisPendingUpload', 'cestisUnsyncedOnSignOut'
    ],
    // This module's own bookkeeping about what it has already synced.
    excludePrefixes: ['cestis_pagecloud_stamps__'],
    // What this file brings down belongs to the pages that own or read it:
    // whichever pull lands first writes a key, and the other then sees nothing
    // new — so the page must be told either way.
    onRestore: function (keys) { API._lanReport(keys, API._all); }
  };

  var API = {
    FOLDER_ID: FOLDER_ID,
    _pages: [],
    // True only while a pull is writing the cloud's copy into local storage, so
    // those writes are not mistaken for edits made on this device.
    _applying: false,
    init: function (spec) {
      if (!spec || !spec.file) throw new Error('CESTISPageCloud.init needs a file name');
      if (!core()) { try { console.warn('[PageCloud] cestis-core.js must load first'); } catch (e) {} return null; }
      var existing = API._pages.filter(function (p) { return p.spec.file === spec.file; })[0];
      if (existing) return existing;
      var pg = new Page(spec);
      API._pages.push(pg);
      if (!spec.readOnly) pg.watch();     // a reader has no keys of its own to watch
      // Own file first, then the cross-page collections this page reads. Both
      // sets of changes are reported to onRestore together, so a page re-renders
      // once with everything the Centre's Drive folder currently holds.
      var start = function () {
        pg.pull().then(function (changed) {
          return pg.pullShared().then(function (sharedChanged) {
            sharedChanged.forEach(function (k) { if (changed.indexOf(k) === -1) changed.push(k); });
            return changed;
          });
        }).then(function (changed) {
          if (changed.length && typeof spec.onRestore === 'function') spec.onRestore(changed);
        });
      };
      if (store() && store().whenReady) store().whenReady(start); else start();

      // On the Centre's own network: mirror the whole store as well, and keep
      // pulling every half minute (see the LAN section above).
      detectLocalServer().then(function (on) { if (on) API._wireLan(); });

      // CLOUD → LOCAL, continuously — not only at page open.
      //
      // 1. The moment a Google token appears (the user pressed Connect on the
      //    dashboard, in this tab or another), pull. Until now a page opened
      //    before the connection simply stayed empty until a reload — which
      //    read as "my records are gone".
      // 2. And every so often while connected, check the file's modifiedTime —
      //    one metadata query — and pull only when another device has actually
      //    written. Local storage stays the fast path; Drive keeps it current.
      if (!API._refreshWired) {
        API._refreshWired = true;
        try {
          root.addEventListener('storage', function (ev) {
            if (!ev || ev.key !== TOKEN_KEY || !ev.newValue) return;
            if (token()) API.loadNow();
          });
        } catch (e) {}
        try {
          setInterval(function () {
            if (root.document && root.document.hidden) return;   // nobody looking
            if (lan.on) return;                                  // the LAN refresh does this job
            var tok = token();
            if (!tok) return;
            API._pages.forEach(function (p) {
              var report = function (keys) {
                if (keys.length && typeof p.spec.onRestore === 'function') {
                  try { p.spec.onRestore(keys); } catch (e) {}
                }
              };
              // A reader has no file of its own, so remoteChanged() would say
              // "nothing new" forever and its shared collections would never
              // refresh. It goes straight to the collections it reads.
              if (p.spec.readOnly) { p.pullShared().then(report); return; }
              p.remoteChanged(tok).then(function (changed) {
                if (!changed) return;
                p.pull().then(function (keys) {
                  return p.pullShared().then(function (sk) {
                    sk.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
                    report(keys);
                  });
                });
              });
            });
          }, 60000);
        } catch (e) {}
      }
      return pg;
    },
    saveNow: function () { return Promise.all(API._pages.map(function (p) { clearTimeout(p._timer); return p.push(); })); },
    loadNow: function () {
      return Promise.all(API._pages.map(function (p) {
        return p.pull().then(function (changed) {
          return p.pullShared().then(function (sharedChanged) {
            sharedChanged.forEach(function (k) { if (changed.indexOf(k) === -1) changed.push(k); });
            if (changed.length && typeof p.spec.onRestore === 'function') {
              try { p.spec.onRestore(changed); } catch (e) {}
            }
            return changed;
          });
        });
      }));
    },
    /* Just the cross-page collections, for a page that wants the Centre's
       current shared data without a full round trip of its own file. */
    loadShared: function () { return Promise.all(API._pages.map(function (p) { return p.pullShared(); })); },
    /* Record a decision this page is entitled to make inside a collection it
       reads but does not own, and send it to the owning page's file. The
       caller has already written the new value to local storage; stamping it
       here is what makes it the newest write, so the merge on the way up keeps
       it instead of the copy it is replacing. */
    saveShared: function (keys) {
      var wanted = Array.isArray(keys) ? keys : [];
      return Promise.all(API._pages.map(function (p) {
        var mine = wanted.filter(function (k) { return (p.spec.writes || []).indexOf(k) !== -1; });
        if (!mine.length) return Promise.resolve([]);
        p.touch(mine);
        return p.pushShared(mine);
      })).then(function (lists) {
        var wrote = [];
        lists.forEach(function (l) { l.forEach(function (k) { if (wrote.indexOf(k) === -1) wrote.push(k); }); });
        return wrote;
      });
    },
    status: function () {
      return API._pages.map(function (p) {
        return { page: p.spec.page, file: p.spec.file, folder: FOLDER_ID,
          connected: p.state.connected, backend: p.state.backend || (lan.on ? 'offline-server' : 'google-drive'),
          keys: p.state.keys, sharedKeys: p.state.shared,
          reads: (p.spec.reads || []).length,
          lastPull: p.state.lastPull, lastPush: p.state.lastPush, error: p.state.error };
      });
    },

    /* ---- The Centre's own server (Offline System) ---- */

    /* Resolves true when these pages are being served by the Centre's own
       server — the Offline System — and false everywhere else. */
    lan: function () { return detectLocalServer(); },
    /* True once this page has read the Centre's server successfully in this
       session: the LAN's answer to "has this device synced?". */
    lanSynced: function () { return !!(lan.on && lan.synced); },
    /* Files of the Centre's own on its server that belong to no page's sync —
       a certificate design's background image, too big to travel with a
       page's records (index.html, certImageSaveToLan). Each is one payload
       { data: { key: string }, stamps: { key: ISO time } }, merged by the
       server into what it holds by the same newest-per-key rule as every page
       file. All three resolve null / false anywhere but on the Centre's
       network.
         lanListFiles()             -> [file names]
         lanReadFile(name)          -> payload | null
         lanWriteFile(name, data)   -> true when the server took it */
    lanListFiles: function () {
      return detectLocalServer().then(function (on) {
        if (!on) return null;
        return lanFetch('', {}).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) { return d && Array.isArray(d.files) ? d.files.map(function (f) { return String(f.file || ''); }) : null; })
          .catch(function () { return null; });
      });
    },
    lanReadFile: function (name) {
      return detectLocalServer().then(function (on) {
        if (!on || !name) return null;
        return localGet(String(name)).then(function (got) { return got.ok ? got.payload : null; });
      });
    },
    lanWriteFile: function (name, data) {
      return detectLocalServer().then(function (on) {
        if (!on || !name || !data) return false;
        var now = lanNow(), stamps = {};
        Object.keys(data).forEach(function (k) { stamps[k] = now; });
        var payload = core().buildPayload({ page: 'Centre file', file: String(name) }, data, stamps, {
          savedAt: now, savedBy: (root.currentLoggedInUser && root.currentLoggedInUser.username) || root.currentRole || 'offline'
        });
        return localPut(String(name), payload).then(function (put) { return !!put.ok; });
      });
    },
    /* fn() once, after this device's next save has reached the Centre's
       server — for something that has to wait until the server holds what was
       just saved here (a host ticket asked for with a password changed a
       moment ago: the server checks it against the accounts IT holds). Never
       called anywhere but on the Centre's network. */
    whenLanSaved: function (fn) { if (typeof fn === 'function') lanSaveWaiters.push(fn); },
    /* The current time by the Centre's server's clock (this device's clock
       anywhere else). */
    now: function () { return lanNow(); },
    /* Register a page's file ONLY when served by the Centre's own server. The
       LMS dashboard syncs through its own Drive backup online, and through
       this on the Centre's network. */
    initLan: function (spec) {
      return detectLocalServer().then(function (on) { return on ? API.init(spec) : null; });
    },
    /* fn(key) -> may this device publish a new value of `key` to the Centre's
       server? Without it, every write is published. The dashboard uses it so
       a trainee's device — and one whose session has just been cleared — can
       never publish a Centre-wide setting; their record writes still go up,
       and those merge record by record so they cannot delete anything. */
    setAuthorPolicy: function (fn) { API._authorPolicy = (typeof fn === 'function') ? fn : null; },
    /* Hand pulled changes to every page that owns or reads them, so one page's
       pull landing first never leaves another page's screen stale. */
    _lanReport: function (changed, from) {
      if (!changed || !changed.length) return;
      API._pages.forEach(function (p) {
        if (p === from || typeof p.spec.onRestore !== 'function') return;
        var mine = changed.filter(function (k) {
          return core().ownsKey(p.spec, k) || (p.spec.reads || []).indexOf(k) !== -1;
        });
        if (mine.length) { try { p.spec.onRestore(mine); } catch (e) {} }
      });
    },
    _wireLan: function () {
      if (API._lanWired) return;
      API._lanWired = true;
      API.initWholeStore();
      try {
        setInterval(function () {
          if (root.document && root.document.hidden) return;   // nobody looking
          API._pages.forEach(function (p) {
            p.pull().then(function (keys) {
              return p.pullShared().then(function (sk) {
                sk.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
                if (keys.length && typeof p.spec.onRestore === 'function') { try { p.spec.onRestore(keys); } catch (e) {} }
              });
            });
          });
        }, LAN_REFRESH_MS);
      } catch (e) {}
    },
    /* Register the whole-store mirror. Safe to call repeatedly. */
    initWholeStore: function () {
      if (API._all) return API._all;
      var pg = new Page(ALL_SPEC);
      API._all = pg;
      API._pages.push(pg);
      pg.watch();
      pg.pull().then(function (keys) { if (keys.length) ALL_SPEC.onRestore(keys); });
      return pg;
    }
  };

  root.CESTISPageCloud = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
