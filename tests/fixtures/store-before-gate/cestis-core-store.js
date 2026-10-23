/* cestis-core.js — the device store EXACTLY as it was before the trainee gate
   added its namespace switch (integration branch at 2001866). Frozen on
   purpose: tests/store-namespace.test.js runs it beside the current store
   and requires the same behaviour, write for write, while the switch is
   off. Never edit it to make that test pass. If the store itself is
   deliberately changed later, refreeze it from the commit before that
   change and say so in that commit. */
(function (root) {
  'use strict';
  (function () {
    if (!root || root.CESTISStore) return;
    if (typeof indexedDB === 'undefined') return; // Node / non-browser: skip the store, keep the helpers.
    var DB_NAME = 'CESTIS_KV', STORE = 'kv', LS = null;
    try { LS = root.localStorage; } catch (e) { LS = null; }
    var cache = {};
    try { if (LS) { for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && k.indexOf('__cestis_idb_only__:') === 0) continue; cache[k] = LS.getItem(k); } } } catch (e) {}

    var db = null, ready = false, wq = [];
    // A key that no longer fits in localStorage lives in IndexedDB only. Its
    // localStorage copy is removed (see setItem), and every OTHER document of
    // this origin hears that removal as a 'storage' event with no value — the
    // same event a real deletion sends. Taken at face value, an embedded page
    // or another tab dropped the collection from its cache, read it back as
    // ABSENT, and then wrote its own stale or partial copy over the durable
    // one. This small marker says "the value is in IndexedDB, not gone", so
    // that removal is never mistaken for a deletion.
    var IDB_ONLY = '__cestis_idb_only__:';
    function markIdbOnly(k, on) {
      try { if (!LS) return; if (on) LS.setItem(IDB_ONLY + k, '1'); else if (LS.getItem(IDB_ONLY + k) !== null) LS.removeItem(IDB_ONLY + k); } catch (e) {}
    }
    function isIdbOnly(k) { try { return !!LS && LS.getItem(IDB_ONLY + k) !== null; } catch (e) { return false; } }
    // Read one key straight from IndexedDB into the cache (used when another
    // document has just written a value too large for localStorage).
    function refreshFromIDB(k) {
      if (!db) return;
      try {
        var rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
        rq.onsuccess = function () { if (rq.result !== undefined && rq.result !== null) cache[k] = rq.result; };
      } catch (e) {}
    }
    // Durable-write failure tracking: quota errors on the IndexedDB transaction
    // fire asynchronously (transaction onerror/onabort), so a plain try/catch
    // never sees them. Record the failure and notify the app so it can warn the
    // user instead of silently losing every write from that point on.
    var writeFailCount = 0;
    function reportWriteFailure(k, err) {
      writeFailCount++;
      try { root._cestisStoreWriteFailures = writeFailCount; } catch (_) {}
      try { console.error('[CESTISStore] Durable write FAILED for key "' + k + '":', err); } catch (_) {}
      try { root.dispatchEvent(new CustomEvent('cestis-store-write-error', { detail: { key: k, count: writeFailCount } })); } catch (_) {}
    }
    function drainQueue() { var q = wq; wq = []; for (var i = 0; i < q.length; i++) { writeIDB(q[i].k, q[i].v, q[i].del); } }
    function writeIDB(k, v, del) {
      if (!db) { if (!ready) { wq.push({ k: k, v: v, del: del }); } return; }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.onerror = function (e) { reportWriteFailure(k, e && e.target && e.target.error); };
        tx.onabort = function (e) { reportWriteFailure(k, (e && e.target && e.target.error) || 'transaction aborted'); };
        var os = tx.objectStore(STORE); if (del) { os.delete(k); } else { os.put(v, k); }
      } catch (e) { reportWriteFailure(k, e); }
    }
    // Ask the browser to protect this origin's storage from automatic eviction —
    // essential for a system whose primary datastore is IndexedDB for years.
    try { if (root.navigator && root.navigator.storage && root.navigator.storage.persist) { root.navigator.storage.persist(); } } catch (e) {}
    try {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) { var d = e.target.result; if (!d.objectStoreNames.contains(STORE)) { d.createObjectStore(STORE); } };
      req.onsuccess = function (e) {
        db = e.target.result;
        try {
          var idbKeys = {};
          var cur = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (c) { idbKeys[c.key] = 1; if (!(c.key in cache)) { cache[c.key] = c.value; } c.continue(); }
            else {
              try {
                var ws = db.transaction(STORE, 'readwrite').objectStore(STORE);
                for (var kk in cache) { if (Object.prototype.hasOwnProperty.call(cache, kk) && !idbKeys[kk]) { ws.put(cache[kk], kk); } }
              } catch (_) {}
              ready = true; drainQueue(); try { root.dispatchEvent(new Event('cestis-store-ready')); } catch (_) {}
            }
          };
          cur.onerror = function () { ready = true; drainQueue(); announceReady(); };
        } catch (e) { ready = true; drainQueue(); announceReady(); }
      };
      // IndexedDB would not open (private window, blocked storage, a broken
      // profile). Everything that waits for the store must still start — the
      // page-cloud sync, the dashboard's reload — and the person must be told
      // their work is held in this browser's small localStorage only. Before,
      // nothing was announced: whenReady() waited for ever, the queued writes
      // were silently abandoned, and no warning appeared.
      req.onerror = function () { idbUnavailable(); };
    } catch (e) { idbUnavailable(); }
    function announceReady() { try { root.dispatchEvent(new Event('cestis-store-ready')); } catch (_) {} }
    function idbUnavailable() {
      db = null; ready = true; wq = [];
      announceReady();
      writeFailCount++;
      try { root._cestisStoreWriteFailures = writeFailCount; } catch (_) {}
      try { root.dispatchEvent(new CustomEvent('cestis-store-write-error', { detail: { key: '*', count: writeFailCount, reason: 'idb-unavailable' } })); } catch (_) {}
    }

    var Store = {
      _cache: cache,
      // Read through to localStorage before trusting the cache. Every document
      // (a page, each of its iframes, other tabs) runs its OWN copy of this
      // store, so a key written in one would otherwise still read as this one's
      // stale copy — and saving that copy back silently reverts the other
      // document's write. That is what stopped an edit made in an embedded page
      // from reaching the rest of the system. The 'storage' event below is not
      // enough on its own: it is delivered asynchronously, while a re-read
      // immediately after an iframe reports a change is synchronous.
      getItem: function (k) {
        k = String(k);
        // When localStorage is full its write throws and the PREVIOUS value is
        // left sitting there untouched. This read trusts any non-null answer
        // from localStorage, so from that moment on every read returned the
        // STALE copy while the data the user had just entered sat unreachable
        // in IndexedDB — and the next save wrote the stale copy back over the
        // good one and uploaded it. Dropping the stale entry on a failed write
        // (see setItem below) is what makes this read safe.
        if (LS) { try { var lv = LS.getItem(k); if (lv !== null) { cache[k] = lv; return lv; } } catch (e) {} }
        return (k in cache) ? cache[k] : null;
      },
      /* Might this key have a durable copy that has not reached this document
         yet? True before IndexedDB has been read in (any key might be there),
         and for a key known to live in IndexedDB only that this document's
         cache does not hold. A write that would EMPTY such a key must not go
         ahead: "not loaded yet" is not "nothing stored" (pageCloud.guardedSet). */
      mayHoldUnloaded: function (k) {
        k = String(k);
        if (k in cache) return false;
        return !ready || isIdbOnly(k);
      },
      isReady: function () { return ready; },
      // `writes` counts every mutation made through this store. It lets the
      // periodic cloud save ask "has anything changed since my last upload?"
      // for the price of an integer compare, instead of re-serialising the
      // whole dataset every tick to find out the answer is no.
      writes: 0,
      setItem: function (k, v) {
        k = String(k); v = String(v); Store.writes++; cache[k] = v;
        // A failed localStorage write leaves the OLD value in place. Left there,
        // it out-votes the truth on every later read (see getItem above), so the
        // stale entry is removed and the read falls through to the cache and
        // IndexedDB, which both hold what was actually written.
        //
        // A full localStorage is not a failure of durable storage: IndexedDB
        // still holds the value. It used to raise the "Device Storage Is
        // Failing — recent changes may be lost" alarm on every save once one
        // collection outgrew the ~5 MB mirror, although nothing was lost. Only
        // a failure with no IndexedDB behind it is reported now (IndexedDB's
        // own failures are reported by writeIDB).
        // (Other documents hear the removal below as a queued 'storage'
        // event, so the marker set straight after it is there when they do.)
        var lsOk = false;
        try { if (LS) { LS.setItem(k, v); lsOk = true; } }
        catch (e) {
          try { if (LS) LS.removeItem(k); } catch (e2) {}
          markIdbOnly(k, true);
          try { console.info('[CESTISStore] "' + k + '" is too large for localStorage; it is kept in IndexedDB.'); } catch (_) {}
          if (ready && !db) reportWriteFailure(k, e);
        }
        if (lsOk) markIdbOnly(k, false);
        writeIDB(k, v, false);
      },
      removeItem: function (k) { k = String(k); Store.writes++; delete cache[k]; markIdbOnly(k, false); try { if (LS) LS.removeItem(k); } catch (e) {} writeIDB(k, null, true); },
      clear: function () {
        for (var k in cache) { if (Object.prototype.hasOwnProperty.call(cache, k)) delete cache[k]; }
        try { if (LS) LS.clear(); } catch (e) {}
        if (db) { try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch (e) {} }
      },
      key: function (i) { return Object.keys(cache)[i]; },
      keys: function () { return Object.keys(cache); },
      hasOwnProperty: function (k) { return Object.prototype.hasOwnProperty.call(cache, String(k)); },
      whenReady: function (cb) { if (ready) { cb(); } else { root.addEventListener('cestis-store-ready', cb, { once: true }); } },
      get length() { return Object.keys(cache).length; }
    };
    // Deletions and clears cannot be seen by the read-through above (a removed
    // key and a key too large for localStorage both read as null), so mirror
    // them from the storage event, which fires in every OTHER document of this
    // origin — including this page's iframes and the user's other tabs.
    try {
      root.addEventListener('storage', function (ev) {
        if (!ev) return;
        if (ev.key === null) { for (var ck in cache) { if (Object.prototype.hasOwnProperty.call(cache, ck)) delete cache[ck]; } return; }
        var sk = String(ev.key);
        if (sk.indexOf(IDB_ONLY) === 0) {
          // The marker went: the value is back in localStorage (read through
          // as usual) — or it was deleted, which localStorage itself could
          // not announce, since it never held the value.
          if (ev.newValue === null) {
            var real = sk.slice(IDB_ONLY.length);
            var inLS = null;
            try { inLS = LS ? LS.getItem(real) : null; } catch (e) {}
            if (inLS === null) delete cache[real];
          }
          return;
        }
        if (ev.newValue === null) {
          // The value moved to IndexedDB (too large for localStorage) rather
          // than being deleted: keep what this document holds and fetch the
          // new value from IndexedDB, instead of treating the collection as gone.
          if (isIdbOnly(sk)) { refreshFromIDB(sk); return; }
          delete cache[sk];
        } else { cache[sk] = ev.newValue; }
      });
    } catch (e) {}
    root.CESTISStore = Store;
  })();
})(typeof window !== 'undefined' ? window : this);
