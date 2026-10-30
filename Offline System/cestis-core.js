/* ============================================================================
   cestis-core.js — The single shared data-core for the CESTIS LMS.

   WHY THIS FILE EXISTS
   --------------------
   Historically every HTML page re-implemented its own copy of the storage
   layer, the student de-duplication / merge / relink logic and the course
   catalogue. Those copies drifted apart, which is the root cause behind the
   recurring "duplicate students", "stale data" and "didn't update on the other
   page" bugs. This module is the ONE place that logic lives now. Every page
   loads it with <script src="cestis-core.js"></script> BEFORE its own inline
   script, so there is exactly one implementation that cannot drift.

   DESIGN RULES
   ------------
   1. Backward compatible: window.CESTISStore keeps the exact same synchronous
      getItem/setItem/removeItem API the whole app already calls, so existing
      call sites keep working unchanged.
   2. Stable identity: a student's id is derived deterministically from their
      natural key (name|course), so the SAME person gets the SAME id on every
      device. This is what stops cross-device sync from creating duplicates.
   3. Pure & testable: the merge/dedupe/relink/migration helpers are pure
      functions that take data in and return data out, so they can be unit
      tested in Node (see tests/cestis-core.test.js) with no browser.
   4. Node-safe: guarded so this file can be require()'d in Node for testing.
   ============================================================================ */
(function (root) {
  'use strict';

  /* --------------------------------------------------------------------------
     CESTISStore — localStorage-compatible API backed by IndexedDB.
     IndexedDB has a far larger quota than localStorage (~5MB), so large data
     (e.g. staff records with embedded document blobs) no longer overflows.
     A synchronous in-memory cache preserves the existing synchronous
     getItem/setItem/removeItem call sites; writes persist to IndexedDB
     (durable) and mirror to localStorage when they still fit.

     This is the canonical copy. The identical IIFE inlined in each HTML page
     self-guards with `if (window.CESTISStore) return;`, so once this file has
     defined it, every page's inline copy becomes a harmless no-op.
     -------------------------------------------------------------------------- */
  (function () {
    if (!root || root.CESTISStore) return;
    if (typeof indexedDB === 'undefined') return; // Node / non-browser: skip the store, keep the helpers.
    var DB_NAME = 'CESTIS_KV', STORE = 'kv', LS = null;
    try { LS = root.localStorage; } catch (e) { LS = null; }
    /* gate-ns:begin — THE TRAINEE GATE'S OWN NAMESPACE (docs/trainee-gate/DESIGN.md §7.1).
       Off unless this browser's localStorage holds cestisGateNs ('g1'). Then this
       store opens a database of its own (CESTIS_KV__g1) and keeps each of its
       localStorage keys under 'g1::', so a trainee's gate session never reads,
       changes or wipes the Centre's records a lab PC holds; keys(), key(),
       length and the 'storage' events all stay inside the namespace. The main
       store, for its part, never takes a namespace's keys for its own. Kept
       identical in cestis-core.js and index.html (tests/store-namespace.test.js). */
    var GATE_NS = null, NS_KEY = /^g[0-9]{1,3}::/;
    try { var nsv = LS ? LS.getItem('cestisGateNs') : null; if (typeof nsv === 'string' && /^g[0-9]{1,3}$/.test(nsv)) GATE_NS = nsv; } catch (e) { GATE_NS = null; }
    if (GATE_NS) { DB_NAME = DB_NAME + '__' + GATE_NS; LS = nsStorage(LS, GATE_NS + '::'); }
    function nsStorage(ls, p) {
      function own() { var out = []; for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k != null && String(k).indexOf(p) === 0) out.push(String(k).slice(p.length)); } return out; }
      return {
        getItem: function (k) { return ls.getItem(p + k); },
        setItem: function (k, v) { ls.setItem(p + k, v); },
        removeItem: function (k) { ls.removeItem(p + k); },
        key: function (i) { var o = own(); return i >= 0 && i < o.length ? o[i] : null; },
        clear: function () { var o = own(); for (var j = 0; j < o.length; j++) ls.removeItem(p + o[j]); },
        get length() { return own().length; }
      };
    }
    // A 'storage' event as this store sees it: its own namespace's keys only.
    function nsEvent(ev) {
      if (!ev) return null;
      if (!GATE_NS) return (ev.key != null && NS_KEY.test(String(ev.key))) ? null : ev;
      if (ev.key === null) return ev;
      var p = GATE_NS + '::', sk = String(ev.key);
      return sk.indexOf(p) === 0 ? { key: sk.slice(p.length), newValue: ev.newValue, oldValue: ev.oldValue } : null;
    }
    /* gate-ns:end */
    var cache = {};
    try { if (LS) { for (var i = 0; i < LS.length; i++) { var k = LS.key(i); if (k && (k.indexOf('__cestis_idb_only__:') === 0 || (!GATE_NS && NS_KEY.test(k)))) continue; cache[k] = LS.getItem(k); } } } catch (e) {}

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
      // '', or the gate namespace this store opened (gate-ns above).
      namespace: GATE_NS || '',
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
        ev = nsEvent(ev);
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

  /* ==========================================================================
     CESTISCore — shared domain logic. Pure where possible.
     ========================================================================== */
  var Core = {};
  Core.VERSION = '1.0.0';

  /* --- Canonical course catalogue ----------------------------------------
     Previously hardcoded separately in index.html and Qual-Plan-Curriculum.html
     (drift risk). This is now the one source. freshSkillAreas() returns a deep
     copy so callers can mutate the per-render counts without corrupting it. */
  var SKILL_AREAS = [
    { id: 1, name: "Welding & Fabrication", icon: "🔥", color: "#e74c3c", students: 0, materials: 0, desc: "SMAW, MIG, TIG welding processes and metal fabrication" },
    { id: 2, name: "Electrical Installation", icon: "⚡", color: "#f1c40f", students: 0, materials: 0, desc: "Residential and commercial wiring, conduit bending, circuits" },
    { id: 3, name: "Cosmetology", icon: "💇", color: "#e91e63", students: 0, materials: 0, desc: "Hair care, styling, chemical treatments, salon management" },
    { id: 4, name: "Business Administration", icon: "💼", color: "#3498db", students: 0, materials: 0, desc: "Office management, accounting, business communication" },
    { id: 5, name: "Auto Mechanics", icon: "🔧", color: "#e67e22", students: 0, materials: 0, desc: "Engine repair, diagnostics, brake and suspension systems" },
    { id: 6, name: "Plumbing", icon: "🔩", color: "#1abc9c", students: 0, materials: 0, desc: "Pipe fitting, drainage systems, water supply installation" },
    { id: 7, name: "Carpentry", icon: "🪚", color: "#8d6e63", students: 0, materials: 0, desc: "Furniture making, roof framing, cabinet installation" },
    { id: 8, name: "Hospitality & Tourism", icon: "🏨", color: "#9b59b6", students: 0, materials: 0, desc: "Food & beverage service, front office, housekeeping" },
    { id: 9, name: "Information Technology", icon: "💻", color: "#2196f3", students: 0, materials: 0, desc: "Networking, hardware repair, software applications" },
    { id: 10, name: "Garment Construction", icon: "🧵", color: "#ff7043", students: 0, materials: 0, desc: "Pattern drafting, sewing techniques, fashion design basics" },
    { id: 11, name: "Refrigeration & AC", icon: "❄️", color: "#00bcd4", students: 0, materials: 0, desc: "AC installation, refrigerant handling, system maintenance" },
    { id: 12, name: "Heavy Equipment Ops", icon: "🚜", color: "#ff9800", students: 0, materials: 0, desc: "Excavator, loader, bulldozer operation and safety" },
    { id: 13, name: "Commercial Cooking", icon: "👨‍🍳", color: "#4caf50", students: 0, materials: 0, desc: "Culinary arts, food safety, menu planning, pastry arts" },
    { id: 14, name: "Beauty Therapy", icon: "💆", color: "#ce93d8", students: 0, materials: 0, desc: "Facial treatments, body massage, nail technology" },
    { id: 15, name: "Data Operations", icon: "📊", color: "#42a5f5", students: 0, materials: 0, desc: "Data entry, spreadsheets, database management" },
    { id: 16, name: "Agriculture", icon: "🌾", color: "#66bb6a", students: 0, materials: 0, desc: "Crop production, livestock management, agribusiness" },
    { id: 17, name: "Masonry", icon: "🧱", color: "#a1887f", students: 0, materials: 0, desc: "Block laying, plastering, tiling, concrete work" },
    { id: 18, name: "Solar Energy Tech", icon: "☀️", color: "#fdd835", students: 0, materials: 0, desc: "PV installation, solar system design, inverter setup" },
    { id: 19, name: "Early Childhood Ed", icon: "👶", color: "#ef9a9a", students: 0, materials: 0, desc: "Child development, lesson planning, classroom management" },
    { id: 20, name: "Customer Service", icon: "🎯", color: "#7e57c2", students: 0, materials: 0, desc: "Communication skills, conflict resolution, CRM systems" }
  ];
  Core.SKILL_AREAS = SKILL_AREAS;
  Core.freshSkillAreas = function () { return JSON.parse(JSON.stringify(SKILL_AREAS)); };

  Core.STAGES = ['testing', 'interview', 'training', 'certified', 'collected', 'incomplete'];
  Core.STAGE_LABELS = { testing: 'Testing', interview: 'Interview', training: 'In Training', certified: 'Certified', collected: 'Collected', incomplete: 'Incomplete' };
  Core.STAGE_BADGE = { testing: 'badge-blue', interview: 'badge-purple', training: 'badge-amber', certified: 'badge-green', collected: 'badge-green', incomplete: 'badge-red' };
  Core.STAGE_ICONS = { testing: '📝', interview: '🗣️', training: '📚', certified: '🎓', collected: '✅', incomplete: '⚠️' };

  /* --- Hashing (identical to the app's existing cestisHashString) --------- */
  Core.hashString = function (str) {
    str = String(str == null ? '' : str);
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };

  /* --- Normalisation & stable identity -----------------------------------
     The natural key is (name|course), matching the de-dup key the app has
     always used — so migrating to stable ids collapses exactly the records the
     system already considers duplicates, with no surprising new merges/splits.
     The difference is the id is now DETERMINISTIC, so the same person resolves
     to the same id on every device and cloud sync stops minting duplicates. */
  Core.normName = function (s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); };
  Core.normCourse = function (s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); };

  /* Are these two the same person's name?

     One rule, everywhere. It used to be decided in each place that asked, and
     the versions disagreed: the launch collapse compared normName (case folded
     AND every run of whitespace folded to one space), while the account
     reconciler compared `.toLowerCase().trim()`, which leaves a double space
     inside a name intact. So "Yanique  Samuels" on an imported account and
     "Yanique Samuels" on the roll were the same person to one pass and two
     people to the other: the collapse merged them on every launch and the
     reconciler minted the second one straight back, and the roll — and every
     count drawn from it — settled at double.

     Anything comparing names for identity must come through here. */
  Core.sameName = function (a, b) {
    var x = Core.normName(a), y = Core.normName(b);
    return !!x && x === y;
  };

  /* The natural key is the person plus the programme they are on — but the
     programme taken WITHOUT its intake key, exactly as dedupeStudents groups
     them (Core.programmeIdentity below).

     It used to be the raw course string, and that quietly minted duplicates.
     The id is a hash of this key, so anything that rewrites the course text
     MOVES a trainee's id — and two things rewrite it on every single load:
     alignProgrammeTextToIntake(), which sets s.course to the centre's name, and
     the transfer, which writes the keyed label "01. Welding & Fabrication".
     So the same person was 'STU-p7al0hg27' before the text was realigned and
     'STU-1i5e0bi81mr' after it. The snapshot reconcile unions records BY ID,
     found two ids, and kept both: one trainee, listed twice.

     Stripping the key is what makes the id survive that. It also removes a
     disagreement inside this file — dedupeStudents already considered
     'Welding & Fabrication' and '01. Welding & Fabrication' the same person,
     while the id generator considered them two, so the dedup merged them and
     the id generator split them straight back apart on the next load. That
     loop is the "fixes it, then duplicates it again". */
  Core.naturalKey = function (student) {
    if (!student) return '';
    var n = Core.normName(student.name);
    if (!n) return ''; // no usable identity — caller should keep the existing id
    var c;
    try { c = Core.programmeIdentity(student, 'course').bare; }
    catch (e) { c = Core.normCourse(student.course); }
    return n + '|' + c;
  };

  // True if an id looks machine-generated (e.g. 'STU'+Date.now()[+random])
  // rather than human-entered, so it is safe to restabilise. A deterministic
  // stable id ('STU-<hash>') returns false because the dash breaks the digit
  // run — which is what keeps fee-id stabilisation idempotent.
  Core.isAutoGeneratedId = function (id) {
    if (id == null || id === '') return true;
    return /^STU\d{10,}/.test(String(id));
  };

  // Deterministic id derived from the natural key. Prefixed STU- to match the
  // app's id convention and to be visually distinct from raw timestamps.
  Core.stableStudentId = function (student) {
    var key = Core.naturalKey(student);
    if (!key) return null;
    return 'STU-' + Core.hashString(key);
  };

  /* --- Cross-system twin identity (Student Progress <-> School Fee) -------
     Each trainee exists twice: a dashboard student record and a School Fee
     record. The two are linked by an explicit id (fee.lmsId / student
     .schoolFeeId), by a shared stable id (both systems mint ids from the same
     natural key), or — for pairs that predate any link — by name + course.
     Renaming a trainee breaks both fallbacks at once: the names no longer
     match, and the stable id, being derived from the name, has moved. So
     callers pass the identity the record held BEFORE the edit as `was` and the
     twin is still found — which is what makes a rename UPDATE the fee record
     instead of showing up there as a second person. */
  function sameTwinIdentity(name, course, fee) {
    if (!name || !fee) return false;
    if (Core.normName(name) !== Core.normName(fee.name)) return false;
    // Programmes are compared the way training centres are told apart: by the
    // intake key when both sides state one, and by the key-stripped bare name
    // otherwise. Comparing the raw strings meant 'Electrical Installation' and
    // '02. Electrical Installation' read as different programmes, so the same
    // person failed the twin test and the mirrors minted a duplicate of them —
    // while two records keyed to DIFFERENT intakes of one programme are two
    // records and must never link.
    var E = Core.enrolment;
    var a = E ? E.parseCentreLabel(course) : { key: '', name: course };
    var b = E ? E.parseCentreLabel(fee.skillArea || fee.course) : { key: '', name: fee.skillArea || fee.course };
    if (a.key && b.key && a.key !== b.key) return false;
    var c = Core.normCourse(a.name), fc = Core.normCourse(b.name);
    return !c || !fc || c === fc;
  }
  function hasId(v) { return v != null && v !== ''; }

  Core.isFeeTwin = function (student, fee, was) {
    if (!student || !fee) return false;
    was = was || {};
    var lmsIds = {};
    [student.id, was.id].forEach(function (v) { if (hasId(v)) lmsIds[String(v)] = true; });
    // Explicit links and shared stable ids — the only matches that survive a rename.
    if (hasId(fee.lmsId) && lmsIds[String(fee.lmsId)]) return true;
    if (hasId(fee.id) && lmsIds[String(fee.id)]) return true;
    if (hasId(fee.id) && lmsIds['SF-' + fee.id]) return true; // fee page's mirrored twin id
    if (hasId(fee.id) && hasId(student.schoolFeeId) && String(student.schoolFeeId) === String(fee.id)) return true;
    if (hasId(fee.id) && hasId(was.schoolFeeId) && String(was.schoolFeeId) === String(fee.id)) return true;
    // Never-linked pairs: match the person as they read now, or as they read
    // before this edit.
    return sameTwinIdentity(student.name, student.course, fee) ||
           sameTwinIdentity(was.name, ('course' in was ? was.course : student.course), fee);
  };

  /* Core.twinIndex(students) — find a fee record's twin without scanning.

     Mirroring the School Fee roll onto the dashboard asked, for every fee
     record, "is any of these students their twin?" — a scan of the WHOLE
     roster, normalising two names on each comparison. Two rolls of a thousand
     is two million normalising comparisons, and the dashboard ran it on every
     keystroke in the student search box. That is what pinned the main thread.

     This indexes the roster once by every link isFeeTwin() tests, so each fee
     record is a handful of map lookups.

       idx = Core.twinIndex(students)
       idx.find(fee)        -> the same student students.find(s => isFeeTwin(s, fee)) would
       idx.findByName(name) -> the first student of that name, under any programme
       idx.add(student)     -> keep the index current when one is pushed

     find() resolves ties by ROSTER ORDER, not by which kind of link matched, so
     it returns exactly what the scan it replaces returned. */
  Core.twinIndex = function (students) {
    var list = Array.isArray(students) ? students : [];
    var byId = new Map(), bySchoolFeeId = new Map(), byName = new Map();

    function putFirst(map, key, i) {
      if (key == null || key === '') return;
      var k = String(key);
      if (!map.has(k)) map.set(k, i);        // first occurrence wins, as .find() does
    }
    function index(s, i) {
      if (!s) return;
      putFirst(byId, s.id, i);
      putFirst(bySchoolFeeId, s.schoolFeeId, i);
      var n = Core.normName(s.name);
      if (!n) return;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(i);                 // pushed in ascending roster order
    }
    for (var i = 0; i < list.length; i++) index(list[i], i);

    function nameCandidates(name) {
      var n = Core.normName(name);
      return n ? (byName.get(n) || null) : null;
    }

    function find(fee) {
      if (!fee) return null;
      var best = -1;
      var consider = function (at) { if (at != null && at >= 0 && (best < 0 || at < best)) best = at; };

      if (hasId(fee.lmsId)) consider(byId.get(String(fee.lmsId)));
      if (hasId(fee.id)) {
        consider(byId.get(String(fee.id)));
        consider(byId.get('SF-' + fee.id));   // the fee page's mirrored twin id
        consider(bySchoolFeeId.get(String(fee.id)));
      }
      // Never-linked pairs: same name, and a programme that does not contradict.
      var cand = nameCandidates(fee.name);
      if (cand) {
        for (var j = 0; j < cand.length; j++) {
          var s = list[cand[j]];
          if (s && sameTwinIdentity(s.name, s.course, fee)) { consider(cand[j]); break; }
        }
      }
      return best >= 0 ? list[best] : null;
    }

    /* The same person under ANY programme — lmsMirrorTarget's second pass.

       A record with no name matches nothing. The scan this replaces compared
       normalised names with ===, so two NAMELESS records came out equal and it
       reported them as the same person — something find() itself always refused
       (sameTwinIdentity rejects an empty name outright). Both callers already
       return 'skip' before reaching here when the name is empty, so this only
       makes the two halves agree; it cannot change an answer the app asks for. */
    function findByName(name) {
      var cand = nameCandidates(name);
      return (cand && cand.length) ? list[cand[0]] : null;
    }

    function add(student) {
      if (!student) return;
      // Tolerates being called either INSTEAD OF a push onto the same array or
      // just AFTER one, so a caller cannot accidentally add the student twice.
      if (list[list.length - 1] !== student) list.push(student);
      index(student, list.length - 1);
    }

    return { find: find, findByName: findByName, add: add, get size() { return list.length; } };
  };

  /* --- Edit recency -------------------------------------------------------
     The name is the one field both systems may change, so it is resolved by
     which record was edited last. The dashboard stamps `lastModified`, the fee
     page `updatedAt`; creation time is the fallback so a freshly created record
     still outranks one that has never carried a timestamp. */
  Core.editedAt = function (rec) {
    if (!rec) return 0;
    var t = rec.lastModified || rec.updatedAt || rec.createdAt;
    if (!t) return 0;
    var ms = Date.parse(t);
    return isNaN(ms) ? 0 : ms;
  };

  // Should `src`'s name replace the one on `dst`? Only when it is a real,
  // different name and `dst` has not been edited more recently — so a rename
  // propagates across, but never reverts a newer rename made on the other side.
  Core.shouldAdoptName = function (src, dst) {
    if (!src || !dst) return false;
    var name = String(src.name == null ? '' : src.name).trim();
    if (!name) return false;
    if (Core.normName(name) === Core.normName(dst.name)) return false;
    return Core.editedAt(dst) <= Core.editedAt(src);
  };

  /* --- Shared person fields ----------------------------------------------
     The same facts under different names on each side. Everything a user can
     type about a trainee is shared both ways, so correcting a date of birth or
     an address in one system reaches the other.
     Deliberately NOT here: money (tuition, payments, balance, status), which is
     only ever entered on the fee page; and course/skillArea, which stays
     backfill-only because the fee page's skill area drives its tuition lookup
     and must remain a value that page recognises. */
  Core.TWIN_FIELDS = [
    { lms: 'name', fee: 'name' },
    { lms: 'email', fee: 'email' },
    { lms: 'phone', fee: 'contact' },
    { lms: 'gender', fee: 'gender' },
    { lms: 'dob', fee: 'dateOfBirth' },
    { lms: 'address', fee: 'address' },
    { lms: 'trn', fee: 'nationalId' }
  ];

  // Copy every shared field `src` disagrees with `dst` about, unless `dst` was
  // edited more recently — the same last-edit-wins rule the name uses, applied
  // to the whole record. Blank source values are skipped: the two systems
  // collect different subsets of a person's details, so a field one of them
  // simply doesn't hold must never wipe the other's copy.
  // `direction` is 'lms->fee' (default) or 'fee->lms'. Returns the changed keys.
  Core.syncTwinFields = function (src, dst, direction) {
    var changed = [];
    if (!src || !dst) return changed;
    if (Core.editedAt(dst) > Core.editedAt(src)) return changed;
    var lmsToFee = direction !== 'fee->lms';
    Core.TWIN_FIELDS.forEach(function (f) {
      var from = lmsToFee ? f.lms : f.fee;
      var to = lmsToFee ? f.fee : f.lms;
      var v = src[from];
      if (v == null) return;
      v = String(v).trim();
      if (!v) return;
      if (String(dst[to] == null ? '' : dst[to]).trim() === v) return;
      dst[to] = v;
      changed.push(to);
    });
    return changed;
  };

  /* --- Mirroring a fee record onto the dashboard -------------------------
     The School Fee page keeps its own list of trainees and mirrors them onto
     the Student Progress dashboard. Two rules govern that crossing, and both
     were being broken.

     The programme belongs to VocTrain. The fee page may price a programme of
     its own — that is its business — but the dashboard's roster is the
     Centre's training centres, so a fee record whose programme is not one of
     them is not mirrored at all. It stays a fee record.

     A trainee already on the dashboard is never moved. The old twin test
     required the programme to match, so the same person filed under a
     different programme name on the fee side read as a stranger: a SECOND
     record was created for them, under the fee page's programme, and the
     Centre saw trainees appear on programmes nobody had put them in. Being
     the same person is now enough to leave them exactly where they are — only
     the link between the two records is written.

       lmsMirrorTarget(fee, lmsStudents, centres, opts) ->
         { action: 'link' | 'create' | 'skip', match, course, centreCourse, reason }

     `centreCourse` is the training centre's OWN name for this fee record's
     programme, or '' when it answers to none — the only programme name the fee
     side may ever write onto the dashboard.

     opts.findCentre(centres, name, opts) — the centre resolver (the caller
     passes Core.enrolment.findCentre); opts.on — the date to resolve as of. */
  Core.lmsMirrorTarget = function (fee, lmsStudents, centres, opts) {
    opts = opts || {};
    var list = Array.isArray(lmsStudents) ? lmsStudents : [];
    if (!fee || !Core.normName(fee.name)) {
      return { action: 'skip', match: null, course: '', centreCourse: '', reason: 'no-name' };
    }

    // The training centre this fee record's programme answers to, under the
    // centre's own name — so one programme reads as one programme on the
    // dashboard however the fee side spells it.
    //
    // A fee record that is the mirror of a dashboard trainee (it carries their
    // dashboard id, or was made from their record) names the programme the
    // dashboard's way: a training centre's own name. Only that centre is the
    // answer. A like-named one means this device has not received that centre
    // yet — and bringing the trainee over under it put a second record of them
    // on another programme, which the same-name collapse then folded into the
    // real one, programme, intake key, stable id and all.
    var centre = null;
    var name = fee.skillArea || fee.course || '';
    var mirrorOfDashboard = hasId(fee.lmsId) || fee.source === 'lms';
    if (name && typeof opts.findCentre === 'function') {
      try { centre = opts.findCentre(Array.isArray(centres) ? centres : [], name, { on: opts.on, exact: mirrorOfDashboard }); }
      catch (e) { centre = null; }
    }
    var centreCourse = (centre && centre.name) ? centre.name : '';

    // Already on the dashboard? A linked id or the same name+programme first,
    // then the same person under any programme at all — being the same person
    // is enough to leave them exactly where the Centre put them.
    //
    // Both questions are answered from opts.twinIndex when the caller supplies
    // one (see Core.twinIndex). Mirroring a whole roll used to run these two
    // scans for EVERY fee record, which is what made the dashboard crawl.
    var idx = opts.twinIndex || null;
    var match = null, i;
    if (idx) {
      match = idx.find(fee);
    } else {
      for (i = 0; i < list.length; i++) {
        if (list[i] && Core.isFeeTwin(list[i], fee)) { match = list[i]; break; }
      }
    }
    if (match) {
      return { action: 'link', match: match, course: match.course || '',
        centreCourse: centreCourse, reason: 'twin' };
    }
    /* The same person under ANY programme — and deliberately so, unlike
       feeMirrorTarget pointing the other way, which now requires the programmes
       to agree before it links.

       The asymmetry is the point. The Centre's roster belongs to the dashboard:
       the fee page may price any programme it likes, but it may not enrol
       anybody, so a fee record naming a programme this person is not on must
       still find them rather than mint a second dashboard record on a programme
       nobody put them on. Pointing the other way the dashboard IS the authority,
       so a second enrolment it holds has to reach the fee roll and be priced —
       which is why only that direction tests the programme. */
    var byName = idx ? idx.findByName(fee.name) : null;
    if (!idx) {
      var want = Core.normName(fee.name);
      for (i = 0; i < list.length; i++) {
        if (list[i] && Core.normName(list[i].name) === want) { byName = list[i]; break; }
      }
    }
    if (byName) {
      return { action: 'link', match: byName, course: byName.course || '',
        centreCourse: centreCourse, reason: 'already-enrolled-elsewhere' };
    }

    // Nobody there yet: the programme has to be one the Centre actually runs.
    if (!centreCourse) {
      return { action: 'skip', match: null, course: '', centreCourse: '', reason: 'no-training-centre' };
    }
    return { action: 'create', match: null, course: centreCourse, centreCourse: centreCourse, reason: 'ok' };
  };

  /* --- Student record merge (pure; identical semantics to the app) -------- */
  var MERGE_FIELDS = ['stage', 'progress', 'score', 'gpa', 'certNo', 'certDate', 'certCollected',
    'attendance', 'assignments', 'instructor', 'email', 'phone', 'address',
    'dob', 'enrollDate', 'completionDate', 'nqfLevel', 'notes', 'gender',
    // Cross-system link fields — must survive a merge so the School-Fee <-> LMS
    // link is not lost when a fee-linked record and a manual record collapse.
    'schoolFeeId', 'source',
    // The administrator's "keep separate" marker. It must survive every merge
    // and every sync: if it were dropped, the record it protects would be
    // collapsed into its namesake on the very next launch — the one outcome an
    // admin set it to prevent.
    'keepSeparate',
    // A deliberate re-enrolment after the person's earlier record was deleted
    // (see Core.isReEnrolment). Lose it in a merge and the new enrolment is
    // dropped as though it were the deleted record coming back.
    'reEnrolledAt'];

  Core.mergeStudentRecords = function (a, b) {
    var aMod = a && a.lastModified ? new Date(a.lastModified).getTime() : 0;
    var bMod = b && b.lastModified ? new Date(b.lastModified).getTime() : 0;
    var base = (bMod > aMod) ? Object.assign({}, b) : Object.assign({}, a);
    var other = (bMod > aMod) ? a : b;
    MERGE_FIELDS.forEach(function (f) {
      if ((base[f] === undefined || base[f] === null || base[f] === '') &&
          other[f] !== undefined && other[f] !== null && other[f] !== '') {
        base[f] = other[f];
      }
    });
    // A certificate number, once issued, never changes: the FIRST record's
    // number stands whichever copy was edited later (`a` is the record this
    // device holds, or the one it met first), and every number either record
    // ever carried stays with the survivor as an alias, so a certificate
    // printed under any of them still verifies as this person.
    if (a && a.certNo) base.certNo = a.certNo;
    var norm = function (n) { return String(n == null ? '' : n).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    var aliases = [], seen = {};
    [a, b].forEach(function (r) {
      if (!r) return;
      (Array.isArray(r.certNoAliases) ? r.certNoAliases : []).concat(r.certNo ? [r.certNo] : []).forEach(function (n) {
        var k = norm(n);
        if (!k || k === norm(base.certNo) || seen[k]) return;
        seen[k] = true; aliases.push(String(n).trim());
      });
    });
    if (aliases.length) base.certNoAliases = aliases; else delete base.certNoAliases;
    // A withdrawal (or a re-certification) made on either copy stands until a
    // later decision, whichever copy was edited last for other reasons; the
    // newest signature travels too.
    if (Core.certs) Core.certs.mergeLifecycle(base, other || {});
    // ...and a withdrawn certificate stays withdrawn. The blank-filling above
    // (and "the first number stands") put the number, date and collected flag
    // of the OLDER, still-certified copy straight back onto the record that
    // had just been withdrawn, so the certificate verified again after the
    // next sync. While the newest decision on either copy is a withdrawal,
    // the number lives on only as an alias.
    Core.settleWithdrawnCertificate(base);
    return base;
  };

  /* A record whose newest certificate decision is a withdrawal carries no
     live certificate: its number (kept as an alias, so the paper still
     resolves — as withdrawn), date and collected flag are cleared. Returns
     true when it changed anything. */
  Core.settleWithdrawnCertificate = function (rec) {
    if (!rec || !Core.certs || !Core.certs.isRevoked(rec)) return false;
    var changed = false;
    if (rec.certNo) { Core.certs.rememberAlias(rec, rec.certNo); rec.certNo = null; changed = true; }
    if (rec.certDate) { rec.certDate = null; changed = true; }
    if (rec.certCollected) { rec.certCollected = false; changed = true; }
    return changed;
  };

  /* --- Which centre does a record's programme point at, for IDENTITY? ------
     Training centres are distinct things told apart by their key — '01', '02',
     '03' — even when they share a programme name. A record names its centre
     three possible ways: an explicit centreKey stamp (what a transfer writes),
     a key written into the programme name itself ('02. Electrical
     Installation'), or a bare legacy spelling ('Electrical Installation').

     Returns { key, bare }: the key when the record states one (stamp first,
     then the written label), and the key-stripped, normalised programme name.
     Comparing on THIS instead of the raw course string is what stops one
     person from existing twice — once under each spelling — and what stops two
     different intakes from ever being folded into one. */
  Core.programmeIdentity = function (rec, courseField) {
    var out = { key: '', bare: '' };
    if (!rec) return out;
    var E = Core.enrolment;
    var written = rec[courseField || 'course'];
    if (written == null || written === '') written = rec.course != null ? rec.course : rec.skillArea;
    var parsed = E ? E.parseCentreLabel(written) : { key: '', name: String(written == null ? '' : written) };
    out.bare = Core.normCourse(parsed.name);
    if (rec.centreKey != null && String(rec.centreKey).trim() !== '' && E) {
      out.key = E.centreKeyOf({ centreKey: rec.centreKey });
    } else {
      out.key = parsed.key || '';
    }
    return out;
  };

  /* --- One person, one record PER ENROLMENT ------------------------------

     Two trainee records carrying the same exact name and naming the same
     enrolment are the same record, and one of them must go — whatever ids they
     were given and however each spells the programme. That is what left
     "Omarion Blake" listed once under "Welding & Fabrication" and again under
     "WELDING L2" with a second machine-generated id: two spellings of one
     enrolment, which the centre-identity dedup below reads as two because it
     groups on the programme string.

     What it must NOT do is collapse a name across two genuinely different
     programmes. Doing that read the whole roll as one record per name: the
     Centre runs the same subject at Level 2 and Level 3, a trainee who
     progressed from one to the other holds two enrolments with their own
     tuition, attendance and certificate, and among 400-odd trainees plenty of
     real people share a name. The roll opened at 447, the collapse cut it to
     220, and the School Fee page — which prices per enrolment — could then only
     see and bill the survivors. Core.enrolment.programmesAgree decides: two
     records join only when nothing about their programmes contradicts.

     Which record survives is decided by evidence, not by array order
     (studentRecordScore): the one that has actually been used — progress
     recorded, a stage set, a certificate, an explicit link to a School Fee
     record or a login — wins, and every field the loser held that the winner
     lacks is carried across. So the surviving record is never poorer than
     either of the two.

     Returns { students, removed, idMap }; idMap maps every discarded id to the
     survivor so attendance, payments, exam results and accounts follow it.

     `keepSeparate` remains the administrator's override for the case the
     programmes cannot settle: two real people of one name on the SAME
     programme. A record carrying it is exempt — it never absorbs another and is
     never absorbed, here or in the centre-identity dedup. Mark ONE of the two
     and they stay two records; unmarked namesakes still collapse among
     themselves as usual. The marker travels with the record through every merge
     and sync (MERGE_FIELDS above), because a marker that could be lost would
     protect nothing. */

  // True when an administrator has pinned this record as its own person.
  Core.isKeptSeparate = function (s) {
    return !!(s && (s.keepSeparate === true || s.keepSeparate === 'true'));
  };

  /* A record minted as a NEW enrolment for a person whose earlier record was
     deleted (Student Progress "Add Student", when the name + programme it would
     be filed under is tombstoned).

     Deleting a trainee writes down their stable id, a hash of name + programme
     that ignores the intake. Without this, nobody of that name could ever be
     enrolled on that programme again — any intake, any year: the new record got
     exactly the deleted id and was dropped at the next load, taking its
     attendance, results and login with it. A re-enrolment therefore carries an
     id of its own and this marker, and the deleted id goes on blocking only
     copies of the record that was actually deleted (which never carry it). */
  Core.isReEnrolment = function (s) {
    return !!(s && s.reEnrolledAt && String(s.reEnrolledAt).trim() !== '');
  };
  /* Does this record keep the id it has, whatever its name and programme hash
     to? An administrator's "keep separate" pin, or a re-enrolment. */
  Core.keepsOwnId = function (s) {
    return Core.isKeptSeparate(s) || Core.isReEnrolment(s);
  };
  /* The id a new enrolment should get. Normally the stable id; when that id
     is tombstoned (the person — or a namesake — was deleted from this
     programme before), an id of its own plus the re-enrolment marker.
     `deletedMap` is { id: true }. Returns { id, reEnrolledAt }. */
  Core.newEnrolmentId = function (student, deletedMap, nowIso) {
    var stable = Core.stableStudentId(student);
    if (!stable) return { id: null, reEnrolledAt: '' };
    if (!deletedMap || deletedMap[stable] !== true) return { id: stable, reEnrolledAt: '' };
    var at = nowIso || new Date().toISOString();
    return { id: 'STU-' + Core.hashString(Core.naturalKey(student) + '|enrolled|' + at), reEnrolledAt: at };
  };

  // How much real use does this record show? Higher wins.
  Core.studentRecordScore = function (s) {
    if (!s) return -1;
    var score = 0;
    var stage = String(s.stage || '').toLowerCase();
    if (stage === 'collected') score += 60;
    else if (stage === 'certified') score += 50;
    else if (stage === 'nyc' || stage === 'incomplete') score += 20;
    else if (stage === 'training') score += 30;
    else if (stage === 'interview') score += 15;
    else if (stage) score += 5;                       // 'testing' and anything else
    if (s.certNo) score += 40;
    if (s.certCollected) score += 10;
    var prog = parseFloat(s.progress) || 0;
    if (prog > 0) score += Math.min(25, Math.round(prog / 4));
    if (s.schoolFeeId) score += 12;                   // linked to a fee record
    if (s.lmsId) score += 6;
    var att = parseFloat(s.attendance) || 0;
    if (att > 0) score += 6;
    if (parseFloat(s.gpa) > 0) score += 4;
    if (s.score !== undefined && s.score !== null && s.score !== '') score += 4;
    // Contact/personal detail somebody took the trouble to enter.
    ['email', 'phone', 'dob', 'address', 'trn', 'gender', 'instructor'].forEach(function (f) {
      if (s[f] !== undefined && s[f] !== null && s[f] !== '') score += 2;
    });
    // A stamped centre beats an unstamped one; a named programme beats a blank.
    if (s.centreKey != null && String(s.centreKey).trim() !== '') score += 5;
    if (s.course || s.skillArea) score += 3;
    return score;
  };

  Core.collapseSameNameStudents = function (input, opts) {
    opts = opts || {};
    var courseField = opts.courseField || 'course';
    var list = Array.isArray(input) ? input : [];
    var idMap = {};
    // normalised name -> the enrolments found for that person, each
    // { rec, courses[] }. One person can hold several: WELDING L2 and WELDING L3
    // are two, 'Welding & Fabrication' and 'WELDING L2' are one written twice.
    var slots = {};

    // The programme a record names, wherever this roll keeps it. The fee roll
    // calls it skillArea and the dashboard course; a record that carries both
    // (a mirrored twin) is asked for this roll's field first.
    function courseOf(s) {
      var v = s ? s[courseField] : '';
      if (v == null || v === '') v = (s && s.course != null && s.course !== '') ? s.course : (s ? s.skillArea : '');
      return v == null ? '' : v;
    }

    // Two written programmes that could be one enrolment. Falls back to a plain
    // comparison if the enrolment module is not loaded, which is stricter than
    // the old behaviour rather than looser — it can only keep a record.
    function agree(a, b) {
      var E = Core.enrolment;
      if (E && typeof E.programmesAgree === 'function') {
        try { return E.programmesAgree(a, b); } catch (e) { /* fall through */ }
      }
      var x = Core.normCourse(a), y = Core.normCourse(b);
      return !x || !y || x === y;
    }

    // Does this written programme name its NVQ level?
    function programmeStatesLevel(written) {
      var E = Core.enrolment;
      if (!written || !E || typeof E.programmeLevel !== 'function') return false;
      try { return !!E.programmeLevel(written); } catch (e) { return false; }
    }

    /* The enrolment slot a record belongs in, created if it is the first of its
       kind. A record joins a slot only when it agrees with EVERY programme
       already filed there — not just with the survivor. Checking the survivor
       alone let a vague spelling act as a bridge: 'Welding & Fabrication' agrees
       with both 'WELDING L2' and 'WELDING L3', so once it was the survivor's
       programme the Level 3 enrolment folded in behind the Level 2 one. */
    function slotFor(s) {
      var n = Core.normName(s.name);
      var bucket = slots[n] || (slots[n] = []);
      var written = courseOf(s);
      for (var i = 0; i < bucket.length; i++) {
        var fits = true;
        for (var j = 0; j < bucket[i].courses.length; j++) {
          if (!agree(bucket[i].courses[j], written)) { fits = false; break; }
        }
        if (fits) { bucket[i].courses.push(written); return bucket[i]; }
      }
      var made = { rec: s, courses: [written] };
      bucket.push(made);
      return made;
    }

    // Merge `loser` into `winner`, keeping the winner's identity but never
    // losing a value only the loser held.
    function absorb(winner, loser) {
      // Read both programmes BEFORE the backfill below: that loop copies the
      // loser's centreKey onto a winner that has none, which would make the
      // winner look keyed and hide the fact that its programme name is the
      // vaguer of the two.
      var wi = null, li = null;
      var wc = courseOf(winner), lc = courseOf(loser);
      try {
        wi = Core.programmeIdentity(winner, courseField);
        li = Core.programmeIdentity(loser, courseField);
      } catch (e) {}
      // An intake stamp says which intake ONE spelling of the programme belongs
      // to, so it crosses only with that spelling (after the programme is
      // decided, below).
      var STAMPS = { centreKey: 1, centreId: 1, centreName: 1, centreLabel: 1, courseStart: 1, courseEnd: 1,
                     fiscalYear: 1, enrolmentFiscalYear: 1 };
      var fill = function (k) {
        var have = winner[k];
        if (have === undefined || have === null || have === '') {
          var v = loser[k];
          if (v !== undefined && v !== null && v !== '') winner[k] = v;
        }
      };
      Object.keys(loser).forEach(function (k) { if (!STAMPS[k]) fill(k); });
      // A certificate number is never lost in a merge: the loser's, when it
      // differs from the winner's, rides along as an alias (as
      // mergeStudentRecords does), so a certificate printed under it still
      // verifies as this person.
      var normNo = function (n) { return String(n == null ? '' : n).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
      (Array.isArray(loser.certNoAliases) ? loser.certNoAliases : []).concat(loser.certNo ? [loser.certNo] : []).forEach(function (n) {
        var k = normNo(n);
        if (!k || k === normNo(winner.certNo)) return;
        if (!Array.isArray(winner.certNoAliases)) winner.certNoAliases = [];
        if (!winner.certNoAliases.some(function (x) { return normNo(x) === k; })) winner.certNoAliases.push(String(n).trim());
      });
      // Numeric progress: keep the higher of the two, since 0 is a real value
      // that the blank-backfill above would have kept.
      var wp = parseFloat(winner.progress) || 0, lp = parseFloat(loser.progress) || 0;
      if (lp > wp) winner.progress = loser.progress;
      var wa = parseFloat(winner.attendance) || 0, la = parseFloat(loser.attendance) || 0;
      if (la > wa) winner.attendance = loser.attendance;
      // The programme: keep whichever spelling says most about WHICH enrolment
      // this is — the intake key first ("02. Welding …" over "Welding &
      // Fabrication"), then the NVQ level ("WELDING L2" over the bare name).
      //
      // The level half is not cosmetic. A survivor that dropped back to the
      // vague spelling agreed with the trainee's OTHER level too, so the pass
      // after this one folded two real enrolments into one — the collapse was
      // not idempotent and lost a record on every launch.
      //
      // The intake key is taken only with the SAME programme name. Two
      // different names "agree" whenever one reads as shorthand for the other
      // ("Welding" for "Welding & Fabrication"), and that is all a copy minted
      // on a device missing the centre called "Welding" had in common with the
      // real record: taking its keyed name rewrote the administrator's trainee
      // onto the other programme and intake, and the stable id — a hash of the
      // name and the programme — moved with it.
      if (wi && li && !wi.key && li.key && lc && wi.bare === li.bare) {
        winner[courseField] = lc;
      } else if (lc && !programmeStatesLevel(wc) && programmeStatesLevel(lc)) {
        winner[courseField] = lc;
      }
      // The loser's intake stamps follow when the survivor now names the same
      // programme it did (or either names none) — never onto another spelling.
      var nowBare = null;
      try { nowBare = Core.programmeIdentity(winner, courseField).bare; } catch (e) { nowBare = null; }
      if (!li || !nowBare || !li.bare || nowBare === li.bare) Object.keys(STAMPS).forEach(fill);
      return winner;
    }

    // Which slot each record went into, so the rebuild below emits exactly the
    // grouping this pass decided rather than working it out a second time.
    var slotAt = [];

    list.forEach(function (s, at) {
      if (!s) return;
      if (Core.keepsOwnId(s)) return;                  // the admin pinned this one, or a re-enrolment
      if (!Core.normName(s.name)) return;              // nameless records are left alone
      var slot = slotFor(s);
      slotAt[at] = slot;
      if (slot.rec === s) return;                      // first of its enrolment
      var prev = slot.rec;
      var keepPrev = Core.studentRecordScore(prev) >= Core.studentRecordScore(s);
      var winner = keepPrev ? prev : s;
      var loser = keepPrev ? s : prev;
      slot.rec = absorb(winner, loser);
      if (loser.id != null && loser.id !== slot.rec.id) idMap[loser.id] = slot.rec.id;
      // A chain of merges can move the survivor; re-point anything already
      // mapped at the record that just lost, so no id is left dangling.
      Object.keys(idMap).forEach(function (k) {
        if (idMap[k] === loser.id) idMap[k] = slot.rec.id;
      });
    });

    // Rebuild in first-encounter order, one record per enrolment, passing
    // through anything with no usable name exactly as it was.
    var emitted = [], out = [];
    list.forEach(function (s, at) {
      if (!s) { out.push(s); return; }
      if (Core.keepsOwnId(s)) { out.push(s); return; }       // stands on its own
      var slot = slotAt[at];
      if (!slot) { out.push(s); return; }                    // nameless
      if (emitted.indexOf(slot) !== -1) return;
      emitted.push(slot);
      out.push(slot.rec);
    });

    return { students: out, removed: list.length - out.length, idMap: idMap };
  };

  /* --- De-duplicate a student array (pure) -------------------------------
     Returns { students, removed, idMap } where idMap[oldId] = keptId for every
     removed duplicate. Records with no usable natural key are passed through
     untouched.

     Identity is the NAME plus the CENTRE the record points at — compared
     through programmeIdentity, not the raw course string. The raw comparison
     is what filled the enrolment registers with every trainee twice: the same
     person written once as 'Electrical Installation' and once as
     '02. Electrical Installation' read as two different people, survived every
     dedup, and was then faithfully listed twice on every page.

     Within one name + one bare programme:
       - records whose explicit keys AGREE (or that state no key) are the same
         person and merge;
       - records whose explicit keys DIFFER are two intakes' records and are
         NEVER merged — the keys exist precisely so that two centres sharing a
         name stay two centres;
       - a record with no key at all merges into the lowest-keyed group, so the
         legacy spelling joins its keyed twin instead of standing beside it.

     opts.courseField — 'course' (LMS, default) or 'skillArea' (School Fee). */
  Core.dedupeStudents = function (input, opts) {
    opts = opts || {};
    var courseField = opts.courseField || 'course';
    var list = Array.isArray(input) ? input : [];
    var idMap = {};   // oldId -> keptId

    // Group by person + bare programme; partition each group by explicit key.
    var groups = {};  // name|bare -> { keys: {key -> kept}, unkeyed: kept|null }
    function groupOf(s) {
      // A record the administrator pinned as its own person is exempt from
      // every dedup, this one included — and so is a re-enrolment, which must
      // never be folded into a stale copy of the record that was deleted.
      if (Core.keepsOwnId(s)) return null;
      var n = Core.normName(s.name);
      if (!n) return null;
      var pid = Core.programmeIdentity(s, courseField);
      var gk = n + '|' + pid.bare;
      if (!groups[gk]) groups[gk] = { keys: {}, keyList: [], unkeyed: null };
      return { g: groups[gk], key: pid.key };
    }
    // The centre stamps and the keyed spelling must survive the merge whichever
    // record is newer, or the merged person would drop back to the bare name
    // and split again on the next pass.
    var STAMP_FIELDS = ['centreKey', 'centreId', 'centreName', 'courseStart', 'courseEnd', 'fiscalYear'];
    function mergeKeeping(a, b, key) {
      var keyed = null;
      var aPid = Core.programmeIdentity(a, courseField), bPid = Core.programmeIdentity(b, courseField);
      if (aPid.key) keyed = a; else if (bPid.key) keyed = b;
      var kept = Core.mergeStudentRecords(a, b);
      if (keyed && keyed[courseField]) kept[courseField] = keyed[courseField];
      if (keyed) STAMP_FIELDS.forEach(function (f) {
        if (keyed[f] !== undefined && keyed[f] !== null && keyed[f] !== '') kept[f] = keyed[f];
      });
      void key;
      return kept;
    }
    function absorb(slot, s) {
      var prev = slot.rec;
      slot.rec = mergeKeeping(prev, s, slot.key);
      if (slot.rec.id !== prev.id) idMap[prev.id] = slot.rec.id;
      if (slot.rec.id !== s.id) idMap[s.id] = slot.rec.id;
    }

    list.forEach(function (s) {
      if (!s) return;
      var at = groupOf(s);
      if (!at) return;
      if (at.key) {
        if (!at.g.keys[at.key]) { at.g.keys[at.key] = { key: at.key, rec: s }; at.g.keyList.push(at.key); }
        else absorb(at.g.keys[at.key], s);
      } else {
        if (!at.g.unkeyed) at.g.unkeyed = { key: '', rec: s };
        else absorb(at.g.unkeyed, s);
      }
    });

    // Fold each group's unkeyed record into its keyed twin. With several keyed
    // intakes present the LOWEST key takes it — deterministic, and the earliest
    // intake is where an unstamped legacy record actually came from.
    Object.keys(groups).forEach(function (gk) {
      var g = groups[gk];
      if (!g.unkeyed || !g.keyList.length) return;
      var lowest = g.keyList.slice().sort()[0];
      var slot = g.keys[lowest];
      absorb(slot, g.unkeyed.rec);
      g.unkeyed = null;
    });

    // Rebuild in first-encounter order, one record per surviving slot.
    var emitted = {}, deduped = [];
    list.forEach(function (s) {
      if (!s) { deduped.push(s); return; }
      var at = groupOf(s);
      if (!at) { deduped.push(s); return; }
      var slot = at.key ? at.g.keys[at.key] : (at.g.unkeyed || at.g.keys[at.g.keyList.slice().sort()[0]]);
      if (!slot) { deduped.push(s); return; }
      var mark = Core.normName(s.name) + '|' + Core.programmeIdentity(s, courseField).bare + '|' + slot.key;
      if (!emitted[mark]) {
        emitted[mark] = true;
        deduped.push(slot.rec);
      }
      if (s.id !== slot.rec.id) idMap[s.id] = slot.rec.id;
    });

    return { students: deduped, removed: list.length - deduped.length, idMap: idMap };
  };

  /* --- "Best record" scoring, used to collapse duplicate accounts/approvals ---
     When two records end up keyed to the same student we keep exactly one. These
     pure scorers decide which, so the choice never depends on array order. */
  // Higher score = better login account. A record that can actually authenticate
  // (has a password) and is active must always beat a password-less/disabled
  // placeholder for the same student.
  Core.accountLoginScore = function (u) {
    if (!u) return -1;
    var score = 0;
    if (u.password) score += 8;                       // can actually sign in
    if (u.status === 'active') score += 4;
    else if (u.status !== 'disabled') score += 2;     // pending beats disabled
    if (u.twoFactorSecret) score += 1;                // richer, real record
    if (u.email) score += 1;
    return score;
  };
  // Higher score = approval to keep. Approved always beats not-approved; ties
  // break to the most recently touched record.
  Core.approvalScore = function (c) {
    if (!c) return -1;
    var approved = c.approved ? 1 : 0;
    var t = Date.parse(c.approvedDate || c.lastDownloaded || c.approvedAt || '') || 0;
    return approved * 1e15 + t;                        // approved dominates; recency tie-breaks
  };

  /* --- Relink dependent arrays after ids change (pure-ish; mutates input) -
     `data` is an object with any of: userAccounts, attendanceRecords,
     certDownloadApprovals, examResults, transcriptGrades,
     certTranscriptRequests, and the id-keyed maps transcriptProfiles and
     studentProfiles. Every reference to a remapped student
     id is updated to the kept id, and the obvious duplicates that result are
     collapsed — mirroring relinkDependentData() in index.html. */
  Core.relinkDependentData = function (idMap, data) {
    data = data || {};
    if (!idMap || Object.keys(idMap).length === 0) return data;

    if (Array.isArray(data.userAccounts)) {
      data.userAccounts.forEach(function (u) {
        if (u && u.studentDataId && idMap[u.studentDataId]) u.studentDataId = idMap[u.studentDataId];
      });
      // Collapse duplicate accounts that now point at the same student, keeping
      // the single BEST record per student (a real password + active status win)
      // so a thin/disabled placeholder can never shadow a usable login. Two-pass
      // "pick best" so the outcome can't depend on array order.
      var bestAcct = {};
      data.userAccounts.forEach(function (u) {
        if (!u || !u.studentDataId) return;
        var cur = bestAcct[u.studentDataId];
        if (!cur || Core.accountLoginScore(u) > Core.accountLoginScore(cur)) bestAcct[u.studentDataId] = u;
      });
      data.userAccounts = data.userAccounts.filter(function (u) {
        if (!u || !u.studentDataId) return true;   // never touch system/staff accounts
        var win = bestAcct[u.studentDataId];
        if (win === u) return true;                // the winner for each student
        // Two logins that each hold a password somebody set are two people as
        // far as anyone can tell (two trainees whose records collapsed after one
        // renamed herself to the other's name). Silently deleting one locked a
        // real person out with no trace; both stay, for an administrator to
        // settle. Only a password-less placeholder is folded away.
        var real = function (a) { return Core.accountAccess.hasPassword(a) && !Core.accountAccess.isSeededLogin(a); };
        return real(u) && real(win) && u.id !== win.id;
      });
    }

    if (Array.isArray(data.attendanceRecords)) {
      data.attendanceRecords.forEach(function (r) {
        if (r && r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
      });
    }

    // The dated register: a mark's id names its trainee, so it is re-keyed,
    // and two marks that now name one cell fold newest-wins (nothing dropped).
    if (Array.isArray(data.attendanceRegister) && Core.attendance) {
      data.attendanceRegister = Core.attendance.relink(data.attendanceRegister, idMap).register;
    }

    if (Array.isArray(data.certDownloadApprovals)) {
      data.certDownloadApprovals.forEach(function (c) {
        if (c && c.studentId && idMap[c.studentId]) c.studentId = idMap[c.studentId];
      });
      // Keep the BEST approval per student: an approved record always beats an
      // unapproved one, then most-recent wins. First-wins would let an older
      // "not approved yet" row suppress a real approval and darken the download
      // button after a sync.
      var bestCert = {};
      data.certDownloadApprovals.forEach(function (c) {
        if (!c || !c.studentId) return;
        var cur = bestCert[c.studentId];
        if (!cur || Core.approvalScore(c) > Core.approvalScore(cur)) bestCert[c.studentId] = c;
      });
      data.certDownloadApprovals = data.certDownloadApprovals.filter(function (c) {
        if (!c || !c.studentId) return true;
        return bestCert[c.studentId] === c;
      });
    }

    if (Array.isArray(data.examResults)) {
      data.examResults.forEach(function (r) {
        if (r && r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
      });
    }
    // A test in progress follows its trainee to the new id too (Core.exams).
    if (Array.isArray(data.examAttempts)) {
      data.examAttempts.forEach(function (a) {
        if (a && a.studentId && idMap[a.studentId]) a.studentId = idMap[a.studentId];
      });
    }

    if (Array.isArray(data.transcriptGrades)) {
      /* A manual grade's id is a hash of (student | qualification | unit), so
         the record that just followed its trainee to a new id is re-filed under
         the id that student now gives it. Left on the old id it could not be
         edited or removed: saving the unit again wrote a SECOND record beside
         it, and removing the override removed the new one and left the ghost.
         When the new id is already taken (the unit was graded under both ids),
         the more recently saved grade stands. */
      var movedIds = {};
      var gid = Core.Transcript && Core.Transcript.manualGradeId;
      data.transcriptGrades.forEach(function (g) {
        if (!g || !g.studentId || !idMap[g.studentId]) return;
        g.studentId = idMap[g.studentId];
        if (gid && g.qualId && g.unitCode && g.id != null) {
          g.id = gid(g.studentId, g.qualId, g.unitCode);
          movedIds[g.id] = true;
        }
      });
      if (Object.keys(movedIds).length) {
        var gTime = function (g) { var t = Date.parse((g && g.updatedAt) || ''); return isNaN(t) ? 0 : t; };
        var bestGrade = {};
        data.transcriptGrades.forEach(function (g) {
          if (!g || !movedIds[g.id]) return;
          var cur = bestGrade[g.id];
          if (!cur || gTime(g) > gTime(cur)) bestGrade[g.id] = g;
        });
        data.transcriptGrades = data.transcriptGrades.filter(function (g) {
          return !(g && movedIds[g.id]) || bestGrade[g.id] === g;
        });
      }
    }

    if (Array.isArray(data.certTranscriptRequests)) {
      data.certTranscriptRequests.forEach(function (r) {
        if (r && r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
      });
    }

    /* Maps keyed by student id: the transcript header (date of birth, address,
       ID number) and the trainee's profile (email). Nothing re-keyed them, so a
       rename — which moves the stable id — left the header printed blank and
       the email behind on an id no record answers to any more. Moved to the new
       id; when the new id already holds one, the more recently saved one is
       filed under the new id and the other is left where it was, never
       deleted. */
    var rekeyMap = function (map) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) return;
      var has = function (k) { return Object.prototype.hasOwnProperty.call(map, k) && map[k] != null; };
      var at = function (p) { var t = Date.parse((p && p.updatedAt) || ''); return isNaN(t) ? 0 : t; };
      Object.keys(idMap).forEach(function (oldId) {
        var to = idMap[oldId];
        if (to == null || to === oldId || !has(oldId)) return;
        var moving = map[oldId];
        if (!has(to)) { map[to] = moving; delete map[oldId]; return; }
        if (at(moving) > at(map[to])) { map[oldId] = map[to]; map[to] = moving; }
      });
    };
    rekeyMap(data.transcriptProfiles);
    rekeyMap(data.studentProfiles);

    return data;
  };

  /* The collections keyed by student id that live only in the shared store —
     no page holds them in memory except the Transcript page. Every path that
     moves student ids (the stabilisers on the dashboard and in Student
     Progress, the duplicate collapse) must carry them too, or a rename orphans
     the trainee's manual grades, transcript header and open requests. */
  Core.STORE_RELINK_KEYS = {
    transcriptGrades: 'voctrain_transcriptGrades',
    certTranscriptRequests: 'voctrain_certTranscriptRequests',
    transcriptProfiles: 'voctrain_transcriptProfiles'
  };

  /* Relink the store-held collections above through `idMap`, reading each
     fresh from `store` and writing it back only when something moved (and
     never as an empty value — see pageCloud.guardedSet). Returns the keys
     written. One function, so every place that re-ids trainees carries the
     same set of records. */
  Core.relinkStoredDependents = function (idMap, store) {
    if (!idMap || !Object.keys(idMap).length || !store) return [];
    var data = {}, before = {}, k;
    for (k in Core.STORE_RELINK_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(Core.STORE_RELINK_KEYS, k)) continue;
      var raw = null;
      try { raw = store.getItem(Core.STORE_RELINK_KEYS[k]); } catch (e) { raw = null; }
      if (raw == null || raw === '') continue;
      var v;
      try { v = JSON.parse(raw); } catch (e) { continue; }
      if (v == null || typeof v !== 'object') continue;
      before[k] = raw;
      data[k] = v;
    }
    Core.relinkDependentData(idMap, data);
    var wrote = [];
    Object.keys(before).forEach(function (key) {
      var next = JSON.stringify(data[key]);
      if (next === before[key]) return;
      var storageKey = Core.STORE_RELINK_KEYS[key];
      var ok = Core.pageCloud && Core.pageCloud.guardedSet
        ? Core.pageCloud.guardedSet(store, storageKey, next)
        : (function () { try { store.setItem(storageKey, next); return true; } catch (e) { return false; } })();
      if (ok) wrote.push(storageKey);
    });
    return wrote;
  };

  /* --- One-time migration to stable ids (pure-ish; mutates `data`) --------
     1. De-duplicate by natural key (collapses cross-device duplicates).
     2. Assign each surviving student its deterministic stable id.
     3. Relink every dependent array through the composed id map.
     Returns { changed, idMap, removed }. Safe to run repeatedly (idempotent):
     once ids are stable, step 2 produces no changes. */
  Core.migrateToStableIds = function (data) {
    data = data || {};
    var students = Array.isArray(data.students) ? data.students : [];

    var dr = Core.dedupeStudents(students);
    var survivors = dr.students;
    var idMap = {};
    var k;
    for (k in dr.idMap) { if (Object.prototype.hasOwnProperty.call(dr.idMap, k)) idMap[k] = dr.idMap[k]; }

    survivors.forEach(function (s) {
      // A record the administrator pinned as its own person keeps the id it
      // has. The stable id is derived from name + programme, so two REAL
      // people of one name on one programme — exactly what keepSeparate is
      // for — were handed the same id here. Both records survived every dedup,
      // as they are meant to, and then shared an identity: their attendance and
      // results ran together, deleting one tombstoned both, and the next sync
      // that added anything replaced one of them with a copy of the other. The
      // id they already carry is unique on this device and must not move.
      // A re-enrolment keeps its own id for the same reason: its stable id is
      // the deleted record's, and moving onto it would drop it as that record.
      if (Core.keepsOwnId(s) && s.id != null && String(s.id) !== '') return;
      var newId = Core.stableStudentId(s);
      if (!newId) return; // no natural key — leave id alone
      if (s.id !== newId) {
        var oldId = s.id;
        s.id = newId;
        if (oldId != null) idMap[oldId] = newId;
      }
    });

    // Compose: any id previously mapped to a survivor whose id then changed
    // must now point at the survivor's new stable id.
    for (k in idMap) {
      if (!Object.prototype.hasOwnProperty.call(idMap, k)) continue;
      var target = idMap[k];
      // Follow one extra hop if the target itself was later restabilised.
      if (idMap[target] && idMap[target] !== target) idMap[k] = idMap[target];
    }

    data.students = survivors;
    Core.relinkDependentData(idMap, data);

    var changed = Object.keys(idMap).length > 0 || dr.removed > 0;
    return { changed: changed, idMap: idMap, removed: dr.removed };
  };

  /* --- Deletion tombstones ----------------------------------------------
     Stored as a JSON array of ids under voctrain_deletedStudentIds (the format
     the app already uses). Because ids are now stable, a deleted student keeps
     the same id when re-synced from another device, so the tombstone reliably
     prevents resurrection. */
  Core.TOMBSTONE_KEY = 'voctrain_deletedStudentIds';
  function _store(s) { return s || root.CESTISStore; }
  Core.readDeletedIds = function (store) {
    store = _store(store);
    try {
      var raw = store && store.getItem(Core.TOMBSTONE_KEY);
      if (!raw) return {};
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return {};
      var map = {};
      arr.forEach(function (id) { if (id) map[id] = true; });
      return map;
    } catch (e) { return {}; }
  };
  Core.isStudentDeleted = function (id, store) {
    if (!id) return false;
    return Core.readDeletedIds(store)[id] === true;
  };
  Core.recordDeletedStudent = function (id, store, atIso) {
    if (!id) return;
    store = _store(store);
    try {
      var existing = Core.readDeletedIds(store);
      existing[id] = true;
      if (store) store.setItem(Core.TOMBSTONE_KEY, JSON.stringify(Object.keys(existing)));
    } catch (e) {}
    Core.recordStudentDeletionTime(id, store, atIso);
  };

  /* --- WHEN a trainee was deleted, so the same person can enrol again ----

     A trainee's id is derived from their name and programme, so a person
     deleted and later re-enrolled on the same programme gets the SAME id —
     and the tombstone written by the deletion, which nothing ever removed,
     silently dropped the new enrolment on every device, together with its
     login, results and attendance. The id list cannot carry a time without
     breaking every page that reads it as a list of ids, so the time of each
     deletion is kept alongside it under voctrain_deletedStudentAt
     ({ id: deletedAtISO }, unioned like every tombstone, the later time of
     each id standing).

     A record is hidden by a tombstone unless it was ENROLLED after the
     deletion: a new enrolment carries enrolledAt, stamped when it is
     created (markEnrolment). An edit to the old record on a device that had
     not yet heard of the deletion does not bring it back — only a new
     enrolment does. A deletion with no recorded time (every one made before
     this) hides the record as it always did, until somebody re-enrols the
     person, which writes the time down. */
  Core.DELETED_AT_KEY = 'voctrain_deletedStudentAt';
  Core._parseObj = function (raw) {
    try { var v = JSON.parse(raw || 'null'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
    catch (e) { return {}; }
  };
  Core.readDeletedStudentTimes = function (store) {
    store = _store(store);
    try { return Core._parseObj(store && store.getItem(Core.DELETED_AT_KEY)); } catch (e) { return {}; }
  };
  Core.recordStudentDeletionTime = function (id, store, atIso) {
    if (!id) return;
    store = _store(store);
    if (!store) return;
    try {
      var times = Core.readDeletedStudentTimes(store);
      var at = atIso || new Date().toISOString();
      if ((Date.parse(times[id]) || 0) >= (Date.parse(at) || 0)) return;
      times[id] = at;
      store.setItem(Core.DELETED_AT_KEY, JSON.stringify(times));
    } catch (e) {}
  };
  /* Is this record hidden by a tombstone? deletedMap is { id: true }
     (readDeletedIds); times is { id: ISO } (readDeletedStudentTimes) — when
     omitted it is read from the store, so every caller honours re-enrolment. */
  Core.isStudentTombstoned = function (s, deletedMap, times) {
    if (!s) return false;
    deletedMap = deletedMap || {};
    var hit = [];
    if (s.id != null && deletedMap[s.id] === true) hit.push(String(s.id));
    // A deliberate re-enrolment (Core.isReEnrolment) is matched on its OWN id
    // only: its stable id belongs to the record that was deleted.
    var sid = Core.isReEnrolment(s) ? null : Core.stableStudentId(s);
    if (sid && deletedMap[sid] === true && hit.indexOf(sid) === -1) hit.push(sid);
    if (!hit.length) return false;
    var enrolled = Date.parse(s.enrolledAt || '') || 0;
    if (!enrolled) return true;
    if (times === undefined) times = Core.readDeletedStudentTimes();
    times = times || {};
    return hit.some(function (id) {
      var t = Date.parse(times[id] || '') || 0;
      return !t || t >= enrolled;
    });
  };
  /* Stamp a NEW enrolment (a record being created, never an edit), so a
     tombstone left by an earlier deletion of the same person does not hide
     it. A deletion that has no time yet is given one just before this
     enrolment — it still hides every older copy of the record. */
  Core.markEnrolment = function (student, store, nowIso) {
    if (!student) return student;
    var nowMs = Date.parse(nowIso || '') || Date.now();
    student.enrolledAt = new Date(nowMs).toISOString();
    store = _store(store);
    if (!store) return student;
    var deleted = Core.readDeletedIds(store);
    var times = Core.readDeletedStudentTimes(store);
    [student.id, Core.stableStudentId(student)].forEach(function (id) {
      if (id == null || deleted[id] !== true) return;
      if (Date.parse(times[id] || '')) return;
      Core.recordStudentDeletionTime(id, store, new Date(nowMs - 1).toISOString());
    });
    return student;
  };

  // Drop any student that has been tombstoned (deleted), matching on BOTH the
  // record's current id and its deterministic stable id. This is the single
  // chokepoint that prevents a deleted student from re-emerging no matter which
  // path re-added them (cloud merge under a legacy/fee id, account reconcile,
  // recovery, etc.) — because even a copy carrying a different id resolves to
  // the same tombstoned stable id. Returns the kept list + the dropped ids so
  // callers can purge dependent records.
  // A deliberate re-enrolment (Core.isReEnrolment) is matched on its OWN id
  // only, and a record ENROLLED after the deletion (Core.markEnrolment) is a
  // new enrolment of the same person and is kept; `times` is the deletion-time
  // map (read from the store when omitted). An id still held by a kept
  // record is never reported as dropped, so its dependants stay.
  Core.dropTombstonedStudents = function (students, deletedMap, times) {
    deletedMap = deletedMap || {};
    if (times === undefined) times = Core.readDeletedStudentTimes();
    var dropped = {}, keptIds = {};
    var kept = (students || []).filter(function (s) {
      if (!s) return false;
      if (Core.isStudentTombstoned(s, deletedMap, times || {})) {
        if (s.id != null) dropped[s.id] = true;
        return false;
      }
      if (s.id != null) keptIds[s.id] = true;
      return true;
    });
    return { students: kept, droppedIds: Object.keys(dropped).filter(function (id) { return !keptIds[id]; }),
      removed: (students ? students.length : 0) - kept.length };
  };

  /* --- Lightweight change bus -------------------------------------------
     A single in-page pub/sub plus an optional cross-document (postMessage)
     bridge so any page can announce "students changed" and every listener —
     including iframes — reacts, instead of relying on callers to remember to
     call refreshXView(). Opt-in: pages wire emit()/on() where useful. */
  var listeners = {};
  Core.on = function (event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
    return function () { Core.off(event, cb); };
  };
  Core.off = function (event, cb) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(function (f) { return f !== cb; });
  };
  Core.emit = function (event, payload) {
    (listeners[event] || []).slice().forEach(function (cb) {
      try { cb(payload); } catch (e) { /* one bad listener must not break the rest */ }
    });
  };

  /* ==========================================================================
     MASTER SNAPSHOT — one self-describing JSON of the entire data store.
     Saved to Drive on logout / tab-close / periodically; read on login to
     reconcile (merge & repair) and to let an algorithm detect data loss.
     All logic here is pure: it takes a plain { key: value } map of the store
     and returns data out, so it is fully unit-testable without a browser.
     ========================================================================== */
  Core.SNAPSHOT_SCHEMA_VERSION = 1;

  // Where the dated attendance register is stored (see Core.attendance).
  Core.ATTENDANCE_REGISTER_KEY = 'voctrain_attendanceRegister';

  // Collections we report counts / missing-id deltas for (the loss-detection
  // signal). Arrays or id-keyed; everything else is still snapshotted, just not
  // diffed at id granularity.
  Core.SNAPSHOT_COUNT_KEYS = [
    'voctrain_students', 'voctrain_users', 'voctrain_attendance', 'voctrain_examResults',
    'voctrain_certDownloadApprovals', 'voctrain_instructorData',
    'voctrain_unitCatalogs', 'voctrain_transcriptGrades', 'voctrain_certTranscriptRequests',
    'cestiSchoolFeeStudents', 'cestiSchoolFeePayments'
  ];

  // Deletion-tombstone keys. These are UNIONED (never overwritten) during
  // reconcile because tombstones only ever grow — that is how a delete on one
  // device propagates to all others so deleted data cannot re-emerge anywhere.
  //
  // Every list of deletions the platform keeps has to be named here. The
  // training centres' list was not, and that is why a deleted programme came
  // back: a device that had deleted a centre of its own held a tombstone list
  // of its own, so its list was merged as ordinary data — one whole list
  // replacing the other — and whichever side lost took its deletions with it.
  // The centre was still in the other device's roster, nothing said it had been
  // deleted any more, and it reappeared with its chat room and its place in
  // every course list. Same for the deleted payments.
  Core.TOMBSTONE_UNION_KEYS = ['voctrain_deletedStudentIds', 'voctrain_deletedCentreIds',
                               'cestiSchoolFeeDeletedLmsIds', 'cestiSchoolFeeDeletedPaymentIds',
                               // Deleted user accounts. Every cloud path ADDS an account it
                               // does not find locally, so removing one without writing the
                               // removal down means the next sync hands it straight back —
                               // and a login an administrator revoked is live again.
                               'voctrain_deletedUserIds',
                               // School Fee documents and fee-structure programmes
                               // ("key|when" entries, so a name deleted and later
                               // created again can live).
                               'cestiSchoolFeeDeletedDocumentIds', 'cestiSchoolFeeDeletedFeeKeys',
                               // Time-clock sessions an administrator deleted.
                               'cestisTimeRecordTombstones',
                               // Deleted invoices, quotes and purchase orders (by id).
                               'cestis_finance_invoices_deleted', 'cestis_finance_quotes_deleted',
                               'cestis_finance_pos_deleted',
                               // WHEN each trainee was deleted ({ id: ISO }), so a person
                               // re-enrolled after the deletion is not hidden by it
                               // (Core.isStudentTombstoned). Unioned by the later time.
                               'voctrain_deletedStudentAt',
                               // Virement requests deleted on the Virement page (by id).
                               'cesti_virement_deleted_ids'];

  // Is this key a list of deletions — one that must be merged by union rather
  // than by "the newer write wins"?
  Core.isTombstoneKey = function (key) {
    return !!key && Core.TOMBSTONE_UNION_KEYS.indexOf(String(key)) !== -1;
  };

  /* The union of two stored tombstone lists, as a stored value — every id
     either side has ever written down, in a stable order so two devices that
     hold the same deletions produce the same string and stop rewriting each
     other. Returns null when the union adds nothing to `a`. */
  Core.unionTombstoneValues = function (a, b) {
    // A map of deletion times ({ id: ISO }): every id either side holds, with
    // the later time of each.
    var pa = null, pb = null;
    try { pa = JSON.parse(a || 'null'); } catch (e) { pa = null; }
    try { pb = JSON.parse(b || 'null'); } catch (e) { pb = null; }
    var isMap = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
    if (isMap(pa) || isMap(pb)) {
      var out = {}, grew = false;
      Object.keys(isMap(pa) ? pa : {}).forEach(function (k) { out[k] = pa[k]; });
      Object.keys(isMap(pb) ? pb : {}).forEach(function (k) {
        if (out[k] === undefined || (Date.parse(pb[k]) || 0) > (Date.parse(out[k]) || 0)) { out[k] = pb[k]; grew = true; }
      });
      if (!grew) return null;
      var sorted = {};
      Object.keys(out).sort().forEach(function (k) { sorted[k] = out[k]; });
      return JSON.stringify(sorted);
    }
    // Each id is kept exactly as it was written. Ids are compared as text (so
    // 7 and "7" are one deletion), but a page that wrote numbers checks its
    // list with ===: the Virement page's deleted requests are numbers, and a
    // list turned into text no longer stopped a deleted request coming back.
    var set = {}, order = [];
    var take = function (raw) {
      Core._parseArr(raw).forEach(function (id) {
        if (id == null || id === '') return;
        var s = String(id);
        if (!set[s]) { set[s] = true; order.push(id); }
      });
    };
    take(a);
    var before = order.length;
    take(b);
    if (order.length === before) return null;          // `a` already holds them all
    order.sort();
    return JSON.stringify(order);
  };

  // Keys that must NEVER leave the device inside a shared snapshot: auth tokens,
  // session pointers, per-device Drive metadata and volatile UI flags. Excluding
  // these prevents session/token bleed across devices and keeps the file clean.
  Core.isSnapshotableKey = function (key) {
    if (!key) return false;
    key = String(key);
    if (/token/i.test(key)) return false;            // cestisGoogleAccessToken, *Token
    if (/session/i.test(key)) return false;          // voctrain_session*
    if (/cloudfileid/i.test(key)) return false;      // *CloudFileId
    if (/lastsync/i.test(key)) return false;         // *LastSyncTime
    if (key === 'darkMode') return false;
    if (/examInProgress/i.test(key)) return false;   // volatile exam state
    // Who is signed in on THIS machine, its own sync bookkeeping and its
    // one-off dismissals. A master snapshot restored them onto other
    // devices — the time clock then opened as whoever was signed in on the
    // machine that wrote the snapshot.
    if (DEVICE_ONLY_KEYS.indexOf(key) !== -1) return false;
    if (key.indexOf('cestis_pagecloud_stamps__') === 0) return false;
    if (key.indexOf('__cestis_idb_only__:') === 0) return false;
    // A trainee gate session's own records ('g1::…'): that trainee's slice,
    // kept apart on this device, never the Centre's.
    if (/^g[0-9]{1,3}::/.test(key)) return false;
    return true;
  };
  var DEVICE_ONLY_KEYS = ['isLoggedIn', 'loggedInUser', 'cestisCurrentUser', 'cestiCurrentUser',
    'cestisAttendanceCurrentUser', 'cestisTimeDarkMode', 'cestisTheme', 'firstTimeSyncDismissed', 'cestisFirstTimeDismissed',
    'postLoginSyncCompleted', 'cloudSyncCompleted', 'cestisAutoSyncEnabled',
    // "this device holds work not yet uploaded" — true of THIS device only.
    'cestisPendingUpload', 'cestisUnsyncedOnSignOut',
    // The trainee gate's part on THIS device (Core.gate.DEVICE_KEYS): its
    // switch and address, a gate session's token and sealing key, a staff
    // device's publishing and collecting bookkeeping, and another trainee's
    // work held here until they sign in.
    'cestisGateNs', 'cestisGateMode', 'cestisGateToken', 'cestisGateSessionKey', 'cestisGateAddress',
    'cestisDeviceKind', 'cestisGatePublished', 'cestisGatePublishQueue', 'cestisGateCollected',
    'cestisGateUnassigned', 'cestisGateQuarantine', 'cestisStudentIdMoves'];

  Core._parseArr = function (raw) {
    try { var v = JSON.parse(raw || 'null'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  };

  // Deterministic serialisation of the store map (sorted keys) so the checksum
  // is stable regardless of key insertion order across devices.
  Core.stableStringify = function (storeObj) {
    storeObj = storeObj || {};
    return Object.keys(storeObj).sort().map(function (k) {
      return k + '\u0000' + String(storeObj[k]);
    }).join('\u0001');
  };

  Core.snapshotCounts = function (store) {
    store = store || {};
    var c = {};
    Core.SNAPSHOT_COUNT_KEYS.forEach(function (k) {
      var n = 0;
      try {
        var v = JSON.parse(store[k] == null ? 'null' : store[k]);
        if (Array.isArray(v)) n = v.length;
        else if (v && typeof v === 'object') n = Object.keys(v).length;
      } catch (e) {}
      c[k] = n;
    });
    return c;
  };

  // Build the self-describing snapshot object from a { key: value } store map.
  Core.buildSnapshot = function (storeMap, meta) {
    meta = meta || {};
    var store = {};
    Object.keys(storeMap || {}).forEach(function (k) {
      if (!Core.isSnapshotableKey(k)) return;
      var v = storeMap[k];
      if (v == null) return;
      store[k] = (typeof v === 'string') ? v : JSON.stringify(v);
    });
    return {
      schemaVersion: Core.SNAPSHOT_SCHEMA_VERSION,
      app: 'CESTIS-LMS',
      savedAt: meta.savedAt || new Date().toISOString(),
      savedBy: meta.savedBy || 'unknown',
      savedByRole: meta.savedByRole || 'unknown',
      event: meta.event || 'manual',
      keyCount: Object.keys(store).length,
      counts: Core.snapshotCounts(store),
      checksum: Core.hashString(Core.stableStringify(store)),
      store: store
    };
  };

  // Re-derive the checksum and confirm the snapshot's store is intact.
  Core.verifySnapshot = function (snapshot) {
    if (!snapshot || !snapshot.store) return { ok: false, reason: 'no-store' };
    var actual = Core.hashString(Core.stableStringify(snapshot.store));
    return { ok: actual === snapshot.checksum, expected: snapshot.checksum, actual: actual };
  };

  // THE DATA-LOSS ALGORITHM. Compares a snapshot to the current local store map
  // and reports, per collection, how many records the snapshot has that local is
  // missing (i.e. that would be lost without recovery). Tombstoned (deliberately
  // deleted) students are not counted as "lost".
  Core.dataLossReport = function (snapshot, localStoreMap) {
    localStoreMap = localStoreMap || {};
    var rep = { checksumOk: Core.verifySnapshot(snapshot).ok, collections: {}, missingLocally: {}, totalMissing: 0 };
    var snapStore = (snapshot && snapshot.store) || {};
    var deleted = {};
    Core._parseArr(localStoreMap['voctrain_deletedStudentIds']).forEach(function (id) { if (id) deleted[id] = true; });
    Core.SNAPSHOT_COUNT_KEYS.forEach(function (k) {
      var snapArr = Core._parseArr(snapStore[k]);
      var locArr = Core._parseArr(localStoreMap[k]);
      var locIds = {};
      locArr.forEach(function (r) { if (r && r.id != null) locIds[r.id] = true; });
      var isStudents = (k === 'voctrain_students');
      var missing = snapArr.filter(function (r) {
        if (!r || r.id == null) return false;
        if (locIds[r.id]) return false;
        if (isStudents && deleted[r.id]) return false; // intentionally deleted, not lost
        return true;
      });
      rep.collections[k] = { snapshot: snapArr.length, local: locArr.length, missingFromLocal: missing.length };
      if (missing.length) { rep.missingLocally[k] = missing.map(function (r) { return r.id; }); rep.totalMissing += missing.length; }
    });
    return rep;
  };

  // MERGE & REPAIR. Returns a new store map that unions the snapshot into local
  // without losing data: missing records are restored, newer local edits are
  // preserved, tombstoned students are never resurrected, and students are kept
  // duplicate-free via the stable-id dedupe. Non-array keys are restored only
  // when local is missing/empty (never overwrites populated local config).
  Core.reconcileSnapshot = function (snapshot, localStoreMap) {
    localStoreMap = localStoreMap || {};
    var out = {}; var k;
    for (k in localStoreMap) { if (Object.prototype.hasOwnProperty.call(localStoreMap, k)) out[k] = localStoreMap[k]; }
    var snapStore = (snapshot && snapshot.store) || {};
    var result = { store: out, changed: false, restored: {}, recoveredStudents: 0, restoredKeys: [], droppedTombstoned: 0 };

    // 1) Union deletion tombstones (local + snapshot). Tombstones only grow, so
    //    unioning is always safe — this propagates a delete made on one device to
    //    every other device so deleted data cannot re-emerge anywhere.
    Core.TOMBSTONE_UNION_KEYS.forEach(function (tk) {
      var union = Core.unionTombstoneValues(localStoreMap[tk], snapStore[tk]);
      if (union == null) return;                  // the snapshot adds nothing
      out[tk] = union;
      result.changed = true;
      if (result.restoredKeys.indexOf(tk) === -1) result.restoredKeys.push(tk);
    });
    var deletedStudents = {};
    Core._parseArr(localStoreMap['voctrain_deletedStudentIds']).forEach(function (id) { if (id) deletedStudents[id] = true; });
    Core._parseArr(snapStore['voctrain_deletedStudentIds']).forEach(function (id) { if (id) deletedStudents[id] = true; });
    var deletedStudentAt = Core._parseObj(out[Core.DELETED_AT_KEY]);

    /* Every OTHER deletion, too. Only the trainees' tombstones were honoured
       here, so a payment, an account, an exam, an announcement or a result
       deleted on any device came back at the next sign-in from whichever
       snapshot still held it. A snapshot record is not added back when:
         - its id is on the collection's own deletion list (accounts,
           payments), or
         - the record sync's tombstones (voctrain_syncTombstones, this
           device's and the snapshot's together) say it was deleted after its
           last edit — the same rule every sync follows. */
    var idListTombs = {
      voctrain_users: 'voctrain_deletedUserIds',
      cestiSchoolFeePayments: 'cestiSchoolFeeDeletedPaymentIds'
    };
    var syncT = {};
    [localStoreMap.voctrain_syncTombstones, snapStore.voctrain_syncTombstones].forEach(function (raw) {
      var t = Core._parseObj(raw);
      Object.keys(t).forEach(function (col) {
        if (t[col] && typeof t[col] === 'object') syncT[col] = Core.sync.mergeTombstones(syncT[col] || {}, t[col]);
      });
    });
    var gone = function (key, r) {
      if (!r || typeof r !== 'object') return false;
      var lk = idListTombs[key];
      if (lk && r.id != null) {
        var ids = {};
        Core._parseArr(out[lk]).forEach(function (id) { ids[String(id)] = true; });
        if (ids[String(r.id)]) return true;
      }
      var spec = Core.pageCloud && Core.pageCloud.recordSpec ? Core.pageCloud.recordSpec(key) : null;
      if (spec && spec.tombs && typeof spec.id === 'function' && syncT[spec.tombs]) {
        var k = spec.id(r);
        if (k !== undefined && k !== null && Core.sync.deletedAfter(syncT[spec.tombs], k, r)) return true;
      }
      return false;
    };

    // 2) id-keyed array collections: union (add-missing), keep local on id clash.
    var studentIdMap = {};   // oldStudentId -> keptStudentId, from the dedupe below
    Core.SNAPSHOT_COUNT_KEYS.forEach(function (key) {
      var isStudents = (key === 'voctrain_students');
      var snapArr = Core._parseArr(snapStore[key]);
      var locArr = Core._parseArr(localStoreMap[key]);

      /* Start from what this device holds, RECORD BY RECORD, and add only what
         the snapshot has that it does not.

         This used to rebuild the list out of an id->record map: every local
         record was filed under its id and the list re-derived from those ids.
         Two kinds of record did not survive the round trip, and both are
         ordinary:

           - a record with NO id was never filed, so it vanished from the
             rebuilt list — silently, on any reconcile that changed anything.
             It applies to every collection here, so an unidentified attendance
             row, exam result, fee record or payment was dropped just the same.
           - two records SHARING an id filed the second over the first, and the
             list then took that one record twice. One real person, or one real
             payment, was replaced by a copy of another.

         Keeping the local array as the spine fixes both: nothing this device
         holds is dropped for want of an id, and nothing is duplicated for
         sharing one. */
      var byId = {};
      var merged = [];
      locArr.forEach(function (r) {
        if (!r) return;
        merged.push(r);
        if (r.id != null && !(r.id in byId)) byId[r.id] = r;
      });
      var added = 0;
      /* A collection that ranks its records (the fee roll: Core.feeRecordRank)
         lets the snapshot's copy take the place of this device's when it ranks
         higher — a real fee record over the placeholder a new PC minted before
         the real one arrived. Keeping the local copy on every id clash kept
         the placeholder (tuition $0, every ID and address blank). The local
         copy only fills the winner's blanks, never with its placeholder flags. */
      var rankSpec = Core.pageCloud && Core.pageCloud.recordSpec ? Core.pageCloud.recordSpec(key) : null;
      var rankOf = rankSpec && typeof rankSpec.rank === 'function' ? rankSpec.rank : null;
      var outranked = function (r) {
        var here = byId[r.id];
        if (!rankOf || !here || rankOf(r) <= rankOf(here)) return false;
        var win = JSON.parse(JSON.stringify(r)), drop = { updatedAt: true };   // its date is not the winner's
        (rankSpec.rankDrop || []).forEach(function (f) { drop[f] = true; });
        Object.keys(here).forEach(function (f) {
          if (drop[f]) return;
          var v = win[f];
          if ((v === undefined || v === null || v === '') && here[f] !== undefined && here[f] !== null && here[f] !== '') win[f] = here[f];
        });
        var at = merged.indexOf(here);
        if (at !== -1) merged[at] = win;
        byId[r.id] = win;
        return true;
      };
      snapArr.forEach(function (r) {
        if (!r || r.id == null) return;
        if (isStudents && Core.isStudentTombstoned(r, deletedStudents, deletedStudentAt)) return; // honor tombstone on add
        if (r.id in byId) {                              // this device already has it —
          if (!gone(key, r) && outranked(r)) added++;    // unless the snapshot's copy outranks it
          return;
        }
        if (gone(key, r)) return;                        // deleted since — see above
        byId[r.id] = r; merged.push(r); added++;
      });
      var changedHere = (added > 0);
      if (isStudents) {
        // Drop any student (local OR added) that is now tombstoned, then dedupe.
        var dropRes = Core.dropTombstonedStudents(merged, deletedStudents, deletedStudentAt);
        if (dropRes.removed > 0) { merged = dropRes.students; result.droppedTombstoned += dropRes.removed; changedHere = true; }
        var dr = Core.dedupeStudents(merged);
        if (dr.removed > 0) changedHere = true;
        merged = dr.students;
        // Capture which student ids were collapsed so we can re-point the accounts
        // and cert approvals that reference them (below). Losing this map is what
        // left some users unable to log in / download after a sync — their account
        // still pointed at a student id the dedupe had just removed.
        if (dr.idMap) { for (var _im in dr.idMap) { if (Object.prototype.hasOwnProperty.call(dr.idMap, _im)) studentIdMap[_im] = dr.idMap[_im]; } }

        /* Then the same rule the launch applies: one record per enrolment.

           Without this, a correction made at launch was undone by the very next
           sync. The launch folds together two records of one person written
           under two spellings of ONE programme (collapseSameNameStudents).
           Removing a record leaves no trace, so this union simply added it back
           from the snapshot, and the dedupe above did not catch it because it
           groups on name AND programme: "Welding & Fabrication" and "WELDING L2"
           are two groups to it and one enrolment to the Centre.

           Applying the identical rule here settles it in one direction: what the
           launch corrected, a sync keeps corrected, and the master is rewritten
           with the corrected roll.

           It must be the identical rule, and no stronger. When this collapsed by
           NAME alone the roll read 447 on opening and 220 after — a third of the
           Centre's trainees removed on every launch and every sync, because the
           Centre runs the same subject at two levels and real people share a
           name. Two records naming two different programmes are two enrolments
           now, and a sync no longer destroys the second. keepSeparate is
           honoured here exactly as it is there, so namesakes on the SAME
           programme the administrator has pinned still stand apart. */
        if (typeof Core.collapseSameNameStudents === 'function') {
          var cr = Core.collapseSameNameStudents(merged);
          if (cr.removed > 0) {
            merged = cr.students;
            changedHere = true;
            // Re-point anything already mapped at a record this pass removed,
            // then take on its own mappings, so no dependent is left dangling.
            for (var _k in studentIdMap) {
              if (!Object.prototype.hasOwnProperty.call(studentIdMap, _k)) continue;
              if (cr.idMap[studentIdMap[_k]]) studentIdMap[_k] = cr.idMap[studentIdMap[_k]];
            }
            for (var _c in cr.idMap) {
              if (Object.prototype.hasOwnProperty.call(cr.idMap, _c)) studentIdMap[_c] = cr.idMap[_c];
            }
            result.collapsedSameName = (result.collapsedSameName || 0) + cr.removed;
          }
        }
        result.recoveredStudents += added;
      }
      if (changedHere) {
        out[key] = JSON.stringify(merged);
        if (added > 0) result.restored[key] = added;
        result.changed = true;
      }
    });

    // 2b) Re-link every dependent collection through the student-id remap the
    //     dedupe produced, so an account/approval/record that pointed at a
    //     now-collapsed student id follows it to the surviving id instead of
    //     dangling. This is the primary repair for "some users can't log in or
    //     download certificates after syncing from the cloud".
    if (Object.keys(studentIdMap).length) {
      var dep = {
        userAccounts: Core._parseArr(out['voctrain_users']),
        certDownloadApprovals: Core._parseArr(out['voctrain_certDownloadApprovals']),
        attendanceRecords: Core._parseArr(out['voctrain_attendance']),
        examResults: Core._parseArr(out['voctrain_examResults']),
        transcriptGrades: Core._parseArr(out['voctrain_transcriptGrades']),
        certTranscriptRequests: Core._parseArr(out['voctrain_certTranscriptRequests'])
      };
      Core.relinkDependentData(studentIdMap, dep);
      out['voctrain_users'] = JSON.stringify(dep.userAccounts);
      out['voctrain_certDownloadApprovals'] = JSON.stringify(dep.certDownloadApprovals);
      out['voctrain_attendance'] = JSON.stringify(dep.attendanceRecords);
      out['voctrain_examResults'] = JSON.stringify(dep.examResults);
      out['voctrain_transcriptGrades'] = JSON.stringify(dep.transcriptGrades);
      out['voctrain_certTranscriptRequests'] = JSON.stringify(dep.certTranscriptRequests);
      if (result.restoredKeys.indexOf('voctrain_users') === -1) result.restoredKeys.push('voctrain_users');
      result.changed = true;
    }

    // 2c) The dated attendance register is merged mark by mark, newest mark
    //     wins — never fill-only. Fill-only meant a device that already held
    //     a register never took another device's corrections from the master,
    //     and the next master it saved put its stale marks over them.
    if (Core.attendance && snapStore[Core.ATTENDANCE_REGISTER_KEY] != null) {
      var regLocal = Core._parseArr(out[Core.ATTENDANCE_REGISTER_KEY]);
      var regRes = Core.attendance.mergeRegister(regLocal, Core._parseArr(snapStore[Core.ATTENDANCE_REGISTER_KEY]));
      if (regRes.changed) {
        out[Core.ATTENDANCE_REGISTER_KEY] = JSON.stringify(regRes.register);
        if (regRes.added) result.restored[Core.ATTENDANCE_REGISTER_KEY] = regRes.added;
        result.restoredKeys.push(Core.ATTENDANCE_REGISTER_KEY);
        result.changed = true;
      }
    }
    //     The old per-quarter rosters ('voctrain_attendance::<FY>_Q<n>') are
    //     the backup of the marks taken before the dated register: a trainee's
    //     row the snapshot holds and this device does not is added back. A row
    //     this device already has is left exactly as it is.
    Object.keys(snapStore).forEach(function (key) {
      if (key.indexOf('voctrain_attendance::') !== 0) return;
      var mine = Core._parseArr(out[key]);
      if (!mine.length) return;                         // empty here: the fill-only rule below restores it whole
      var have = {};
      mine.forEach(function (r) { if (r && r.studentId != null) have[r.studentId] = true; });
      var add = Core._parseArr(snapStore[key]).filter(function (r) { return r && r.studentId != null && !have[r.studentId] && !deletedStudents[r.studentId]; });
      if (!add.length) return;
      out[key] = JSON.stringify(mine.concat(add));
      result.restored[key] = add.length;
      result.restoredKeys.push(key);
      result.changed = true;
    });

    // 3) Any other snapshot key absent or empty locally: restore (fill-only),
    //    excluding the count keys and tombstone keys already handled above.
    Object.keys(snapStore).forEach(function (key) {
      if (Core.SNAPSHOT_COUNT_KEYS.indexOf(key) !== -1) return;
      if (Core.TOMBSTONE_UNION_KEYS.indexOf(key) !== -1) return;
      if (key === Core.ATTENDANCE_REGISTER_KEY) return;
      // Snapshots written before the per-device keys were excluded still
      // carry them (who was signed in on the writing machine): never restore.
      if (!Core.isSnapshotableKey(key)) return;
      var local = localStoreMap[key];
      var localEmpty = (local == null || local === '' || local === '[]' || local === '{}');
      if (localEmpty && snapStore[key] != null && snapStore[key] !== '') {
        var restore = snapStore[key];
        // A collection emptied by deleting its last record is empty on
        // purpose: what the tombstones say was deleted is not restored.
        var arr = null;
        try { arr = JSON.parse(restore); } catch (e) { arr = null; }
        if (Array.isArray(arr)) {
          var keepRecs = arr.filter(function (r) { return !gone(key, r); });
          if (!keepRecs.length && arr.length) return;
          if (keepRecs.length !== arr.length) restore = JSON.stringify(keepRecs);
        }
        out[key] = restore;
        result.restoredKeys.push(key);
        result.changed = true;
      }
    });

    return result;
  };

  /* ==========================================================================
     QUARTER ENGINE — shared financial-year / quarter state for the whole app.

     WHY THIS EXISTS
     ---------------
     Several pages (Cashbook, Virement, and now School Fee, Staff Clock-In and
     Attendance) present their data one financial quarter at a time. Before this
     engine each page rolled its own FY/quarter maths and persisted the active
     selection differently, so "switch quarter here" did not switch it there.

     This block is the ONE source of truth:
       • the canonical Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar definition,
       • deriveQuarter(date)  — bucket any dated record into its FY+quarter,
       • getActiveQuarter()/setActiveQuarter() — read & write the single shared
         selection, persisted under 'cestis_active_quarter' (the key Cashbook &
         Virement already use, so they line up automatically),
       • setActiveQuarter() fires a 'cestis-quarter-changed' DOM event and the
         browser 'storage' event propagates the change to every other open tab,
         giving true "switch everywhere" behaviour.

     The pure helpers (deriveQuarter / quarterKey / labels) are Node-safe so they
     can be unit-tested without a browser.
     ========================================================================== */
  var ACTIVE_QUARTER_KEY = 'cestis_active_quarter';

  // The Sierra-Leone / CESTIS financial year starts in April. Q1 = Apr–Jun.
  Core.QUARTER_META = [
    { q: 1, label: 'Q1', months: 'Apr–Jun', startMonth: 4 },
    { q: 2, label: 'Q2', months: 'Jul–Sep', startMonth: 7 },
    { q: 3, label: 'Q3', months: 'Oct–Dec', startMonth: 10 },
    { q: 4, label: 'Q4', months: 'Jan–Mar', startMonth: 1 }
  ];

  // FY string for a (calendar year, 1-based month): months Apr..Dec belong to
  // FY <year>/<year+1>; Jan..Mar belong to FY <year-1>/<year>.
  function fyStringFor(year, month) {
    var startYear = (month >= 4) ? year : (year - 1);
    return startYear + '/' + (startYear + 1);
  }

  // Quarter number (1..4) for a 1-based calendar month.
  function quarterForMonth(month) {
    if (month >= 4 && month <= 6) return 1;
    if (month >= 7 && month <= 9) return 2;
    if (month >= 10 && month <= 12) return 3;
    return 4; // Jan, Feb, Mar
  }

  /* deriveQuarter(dateInput) -> { fy:'2026/2027', q:1 } | null
     Accepts a 'YYYY-MM-DD' string, an ISO timestamp, a Date, or anything Date
     can parse. Returns null for missing/unparseable input so callers can decide
     how to treat undated records. */
  Core.deriveQuarter = function (dateInput) {
    if (dateInput == null || dateInput === '') return null;
    var d;
    if (dateInput instanceof Date) {
      d = dateInput;
    } else {
      var s = String(dateInput);
      // Fast path for plain 'YYYY-MM-DD' to avoid timezone shifts.
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      if (m) {
        var yr = parseInt(m[1], 10), mo = parseInt(m[2], 10);
        return { fy: fyStringFor(yr, mo), q: quarterForMonth(mo) };
      }
      d = new Date(s);
    }
    if (isNaN(d.getTime())) return null;
    var month = d.getMonth() + 1, year = d.getFullYear();
    return { fy: fyStringFor(year, month), q: quarterForMonth(month) };
  };

  // The FY+quarter that "today" falls in — the sensible default selection.
  Core.currentQuarter = function (now) {
    return Core.deriveQuarter(now || new Date());
  };

  Core.getQuarterMeta = function (q) {
    for (var i = 0; i < Core.QUARTER_META.length; i++) {
      if (Core.QUARTER_META[i].q === q) return Core.QUARTER_META[i];
    }
    return null;
  };

  // Calendar year that a given FY+quarter actually lands in (Q4 = Jan–Mar of the
  // second year of the FY span; Q1–Q3 are the first year).
  Core.quarterCalendarYear = function (fy, q) {
    var startYear = parseInt(String(fy).split('/')[0], 10);
    return (q === 4) ? startYear + 1 : startYear;
  };

  Core.fyLabel = function (fy) { return 'FY ' + fy; };
  Core.quarterShortLabel = function (fy, q) {
    var meta = Core.getQuarterMeta(q);
    return meta ? (meta.label + ' · ' + meta.months) : ('Q' + q);
  };
  Core.quarterPeriodLabel = function (fy, q) {
    var meta = Core.getQuarterMeta(q);
    var yr = Core.quarterCalendarYear(fy, q);
    return meta ? (meta.months + ' ' + yr) : ('Q' + q + ' ' + yr);
  };

  /* quarterKey(baseKey, fy, q) — namespace a storage key by quarter so a page can
     keep one bucket per quarter when it wants physical separation. Format mirrors
     the Cashbook convention ('<base>::<fy>_Q<n>'). */
  Core.quarterKey = function (baseKey, fy, q) {
    return baseKey + '::' + fy + '_Q' + q;
  };

  // True when two FY+quarter pairs are the same (null-safe).
  Core.sameQuarter = function (a, b) {
    return !!a && !!b && a.fy === b.fy && a.q === b.q;
  };

  /* recordInQuarter(record, fy, q, dateField) — does a dated record belong to the
     given quarter? Reads record[dateField] (default 'date'). Records that already
     carry explicit fy/quarter fields (e.g. Cashbook/Virement) honour those. */
  Core.recordInQuarter = function (record, fy, q, dateField) {
    if (!record) return false;
    if (record.fy != null && record.quarter != null) {
      return record.fy === fy && record.quarter === q;
    }
    var dq = Core.deriveQuarter(record[dateField || 'date']);
    return !!dq && dq.fy === fy && dq.q === q;
  };

  /* --- Active-quarter persistence + cross-page propagation (browser only) --- */
  Core.ACTIVE_QUARTER_KEY = ACTIVE_QUARTER_KEY;

  Core.getActiveQuarter = function () {
    try {
      var raw = root.CESTISStore ? root.CESTISStore.getItem(ACTIVE_QUARTER_KEY) : null;
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.fy && parsed.q) {
          return { fy: parsed.fy, q: parseInt(parsed.q, 10) };
        }
      }
    } catch (e) {}
    return Core.currentQuarter();
  };

  Core.setActiveQuarter = function (fy, q) {
    q = parseInt(q, 10);
    var val = { fy: fy, q: q };
    try {
      if (root.CESTISStore) root.CESTISStore.setItem(ACTIVE_QUARTER_KEY, JSON.stringify(val));
    } catch (e) {}
    // Notify this page's listeners immediately…
    try {
      if (root.dispatchEvent && typeof CustomEvent === 'function') {
        root.dispatchEvent(new CustomEvent('cestis-quarter-changed', { detail: val }));
      }
    } catch (e) {}
    return val;
  };

  /* onQuarterChange(cb) — subscribe to quarter switches from THIS page (custom
     event) AND from OTHER tabs (the native localStorage 'storage' event). Returns
     an unsubscribe function. cb receives { fy, q }. */
  Core.onQuarterChange = function (cb) {
    if (typeof cb !== 'function' || !root.addEventListener) return function () {};
    var localHandler = function (e) { cb((e && e.detail) || Core.getActiveQuarter()); };
    var storageHandler = function (e) {
      if (e && e.key === ACTIVE_QUARTER_KEY) cb(Core.getActiveQuarter());
    };
    root.addEventListener('cestis-quarter-changed', localHandler);
    root.addEventListener('storage', storageHandler);
    return function () {
      root.removeEventListener('cestis-quarter-changed', localHandler);
      root.removeEventListener('storage', storageHandler);
    };
  };

  /* mountQuarterBar(target, opts) — render the shared FY/quarter selector bar
     (the "FY 2026/2027  ◀ ▶  | Q1·Apr–Jun … | ◀ Prev Qtr  Next Qtr ▶" strip) into
     `target` (an element or element id) and keep it in sync with the shared
     active-quarter state. Clicking any control calls setActiveQuarter, which
     propagates to every other bar/page. opts.onChange({fy,q}) fires whenever the
     active quarter changes (from this bar OR another page/tab) so the host can
     re-render its data. Returns { destroy(), refresh() }. Browser-only. */
  Core.mountQuarterBar = function (target, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return { destroy: function () {}, refresh: function () {} };
    var el = (typeof target === 'string') ? document.getElementById(target) : target;
    if (!el) return { destroy: function () {}, refresh: function () {} };

    if (!document.getElementById('cestis-qbar-styles')) {
      var st = document.createElement('style');
      st.id = 'cestis-qbar-styles';
      st.textContent =
        '.cestis-qbar{display:flex;flex-direction:column;gap:8px;align-items:center;padding:12px 14px;border-radius:12px;' +
        'background:linear-gradient(180deg,rgba(13,71,161,.06),rgba(13,71,161,.02));border:1px solid rgba(13,71,161,.18);margin:0 0 16px;}' +
        '.cestis-qbar-fy{display:flex;align-items:center;gap:14px;}' +
        '.cestis-qbar-fy .cestis-qbar-fylabel{font-weight:700;font-size:15px;letter-spacing:.5px;color:var(--text,#0D47A1);min-width:150px;text-align:center;}' +
        '.cestis-qbar-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;}' +
        '.cestis-qbar-tab{cursor:pointer;border:1px solid rgba(13,71,161,.25);background:transparent;color:var(--text-muted,#5b6b80);' +
        'padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;}' +
        '.cestis-qbar-tab:hover{background:rgba(13,71,161,.08);}' +
        '.cestis-qbar-tab.active{background:#0D47A1;color:#fff;border-color:#0D47A1;box-shadow:0 0 0 3px rgba(13,71,161,.18);}' +
        '.cestis-qbar-btn{cursor:pointer;border:1px solid rgba(13,71,161,.25);background:transparent;color:var(--text,#0D47A1);' +
        'padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;}' +
        '.cestis-qbar-btn:hover{background:rgba(13,71,161,.08);}';
      document.head.appendChild(st);
    }

    el.classList.add('cestis-qbar');
    el.innerHTML =
      '<div class="cestis-qbar-fy">' +
        '<button class="cestis-qbar-btn" data-act="fy-1" title="Previous financial year">◀</button>' +
        '<span class="cestis-qbar-fylabel"></span>' +
        '<button class="cestis-qbar-btn" data-act="fy+1" title="Next financial year">▶</button>' +
      '</div>' +
      '<div class="cestis-qbar-tabs">' +
        Core.QUARTER_META.map(function (m) {
          return '<button class="cestis-qbar-tab" data-q="' + m.q + '">' + m.label + ' · ' + m.months + '</button>';
        }).join('') +
        '<button class="cestis-qbar-btn" data-act="q-1" style="margin-left:8px;">◀ Prev Qtr</button>' +
        '<button class="cestis-qbar-btn" data-act="q+1">Next Qtr ▶</button>' +
      '</div>';

    function shiftFY(fy, dir) {
      var start = parseInt(String(fy).split('/')[0], 10) + dir;
      return start + '/' + (start + 1);
    }
    function paint() {
      var cur = Core.getActiveQuarter();
      var lbl = el.querySelector('.cestis-qbar-fylabel');
      if (lbl) lbl.textContent = Core.fyLabel(cur.fy);
      var tabs = el.querySelectorAll('.cestis-qbar-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', parseInt(tabs[i].getAttribute('data-q'), 10) === cur.q);
      }
    }
    function go(fy, q) {
      // clamp quarter into 1..4, rolling the FY across year boundaries
      while (q < 1) { q += 4; fy = shiftFY(fy, -1); }
      while (q > 4) { q -= 4; fy = shiftFY(fy, 1); }
      Core.setActiveQuarter(fy, q);
    }
    // Hosts re-mount the bar on the SAME element every time their page is
    // re-visited (the attendance/cashbook/etc. pages just re-run their init).
    // Each mount used to stack another click listener on `el`, so after N visits
    // one Prev/Next click fired N times and jumped N quarters at once — making
    // quarter navigation look broken ("can't go to previous/next"). Tear down any
    // bar previously mounted on this element first so mounting is idempotent.
    if (typeof el._cestisQbarTeardown === 'function') { try { el._cestisQbarTeardown(); } catch (e) {} }

    function onBarClick(e) {
      var t = e.target.closest('[data-q],[data-act]');
      if (!t || !el.contains(t)) return;
      var cur = Core.getActiveQuarter();
      if (t.hasAttribute('data-q')) { go(cur.fy, parseInt(t.getAttribute('data-q'), 10)); return; }
      switch (t.getAttribute('data-act')) {
        case 'fy-1': go(shiftFY(cur.fy, -1), cur.q); break;
        case 'fy+1': go(shiftFY(cur.fy, 1), cur.q); break;
        case 'q-1': go(cur.fy, cur.q - 1); break;
        case 'q+1': go(cur.fy, cur.q + 1); break;
      }
    }
    el.addEventListener('click', onBarClick);

    var unsub = Core.onQuarterChange(function (cur) {
      paint();
      if (typeof opts.onChange === 'function') opts.onChange(cur);
    });
    paint();

    function teardown() {
      try { unsub(); } catch (e) {}
      el.removeEventListener('click', onBarClick);
      try { delete el._cestisQbarTeardown; } catch (e) { el._cestisQbarTeardown = null; }
    }
    el._cestisQbarTeardown = teardown;

    return {
      refresh: paint,
      destroy: function () { teardown(); el.innerHTML = ''; el.classList.remove('cestis-qbar'); }
    };
  };

  /* ============================== COURSE DURATION ============================
     Every training centre / course carries a start and end date. Course-scoped
     activity (the attendance register first and foremost, plus tests, fee entry,
     certification, etc.) is "open" only while the course is running — OR when an
     instructor has been granted a temporary, time-boxed reopen permission
     (half-day = 12h, full-day = 24h from the grant instant). When a course has
     ended, students who were never certified become Not-Yet-Competent (NYC).

     These helpers are PURE (dates/timestamps passed in, or defaulted to "now")
     so they are unit-testable without a browser and shared by every page.
     ------------------------------------------------------------------------- */
  var COURSE_DAY_MS = 24 * 60 * 60 * 1000;
  Core.courseDuration = (function () {
    function normDate(s) {
      return (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) ? s.slice(0, 10) : '';
    }
    function todayStr(injected) {
      if (injected) return normDate(injected);
      var d = new Date();
      var mo = String(d.getMonth() + 1), da = String(d.getDate());
      return d.getFullYear() + '-' + (mo.length < 2 ? '0' + mo : mo) + '-' + (da.length < 2 ? '0' + da : da);
    }
    // 'no-dates' | 'not-started' | 'active' | 'ended'
    function status(startDate, endDate, today) {
      var t = todayStr(today), s = normDate(startDate), e = normDate(endDate);
      if (!s && !e) return 'no-dates';
      if (s && t < s) return 'not-started';
      if (e && t > e) return 'ended';
      return 'active';
    }
    // A course with no dates is treated as open (never blocks) until dates are set.
    function isActive(startDate, endDate, today) {
      var st = status(startDate, endDate, today);
      return st === 'active' || st === 'no-dates';
    }
    // Expiry timestamp (ms) for a freshly-granted reopen permission.
    function grantExpiry(nowMs, type) {
      return nowMs + (type === 'half' ? (COURSE_DAY_MS / 2) : COURSE_DAY_MS);
    }
    // Any unexpired instructor reopen permission? permissions: [{expiresAtMs}]
    function permissionActiveAt(permissions, nowMs) {
      if (!permissions || !permissions.length) return false;
      var now = (typeof nowMs === 'number') ? nowMs : Date.now();
      for (var i = 0; i < permissions.length; i++) {
        var p = permissions[i];
        if (p && typeof p.expiresAtMs === 'number' && p.expiresAtMs > now) return true;
      }
      return false;
    }
    // course = { startDate, endDate, instructorPermissions:[{expiresAtMs}] }
    function isRegisterOpen(course, today, nowMs) {
      if (!course) return true;
      if (isActive(course.startDate, course.endDate, today)) return true;
      return permissionActiveAt(course.instructorPermissions, nowMs);
    }
    // Drop permissions that have already expired (housekeeping before persist).
    function prunePermissions(permissions, nowMs) {
      if (!permissions || !permissions.length) return [];
      var now = (typeof nowMs === 'number') ? nowMs : Date.now();
      return permissions.filter(function (p) { return p && typeof p.expiresAtMs === 'number' && p.expiresAtMs > now; });
    }
    return {
      normDate: normDate, todayStr: todayStr, status: status, isActive: isActive,
      grantExpiry: grantExpiry, permissionActiveAt: permissionActiveAt,
      isRegisterOpen: isRegisterOpen, prunePermissions: prunePermissions
    };
  })();

  /* ====================== WHAT A COURSE ENDING DECIDES ======================
     When a course ended, every trainee who was not yet certified became Not
     Yet Competent — whatever their transcript said. A trainee with every unit
     marked competent, waiting only for the certificate to be issued, was
     marked NYC the day the course closed; so was one whose last exam was still
     being marked. The transcript now decides (Core.Transcript
     .transcriptReadiness, passed in as `readiness`):

       - every CORE unit competent and nothing awaiting marking: NOT marked
         NYC. The stage is left as it is and the trainee is flagged ready to
         certify (readyToCertifyAt), which the dashboard and Student Progress
         show. Electives are not required — how many a plan demands is not
         recorded anywhere yet.
       - any unit still awaiting marking: not marked yet. The trainee shows as
         "Awaiting marking" and the next sweep looks again.
       - a core unit not yet competent, or with no result: NYC, as before, with
         the units written in courseEndReason so staff can see why.
       - a programme with no unit catalogue: NYC, exactly as before — there is
         nothing to judge by.

     Certified, collected and withdrawn trainees are never touched, and nor is
     a stage a PERSON set for this course ending (markSetByUser): the rule acts
     on an ending once, then leaves it to the Centre. Only a NYC the rule made
     is final for it; "ready" and "awaiting marking" are looked at again on
     every sweep, so a grade corrected later still counts.

     decide() is pure — the course status, which ending this is (its end date)
     and the readiness are passed in — and returns the fields to change; apply()
     writes them onto the record. The dashboard's sweep and Student Progress
     both use these, so the two never judge a trainee differently.
     ========================================================================= */
  Core.courseEnd = (function () {
    var FINAL = { certified: 1, collected: 1, withdrawn: 1 };
    // The fields this rule owns on a trainee record (besides the stage and the
    // _nycAuto / _nycForCourseEnd markers it always used).
    var FLAGS = ['courseEndState', 'courseEndReason', 'readyToCertifyAt'];
    var LABELS = { ready: 'Ready to certify', 'awaiting-marking': 'Awaiting marking', nyc: 'Not Yet Competent' };

    function codes(list, max) {
      list = list || [];
      max = max || 5;
      return list.slice(0, max).join(', ') + (list.length > max ? ' and ' + (list.length - max) + ' more' : '');
    }
    function has(r, k) { return !!(r && Array.isArray(r[k]) && r[k].length); }
    // Does this readiness verdict actually judge the trainee (a catalogue, units)?
    function known(r) { return !!(r && typeof r === 'object' && r.known !== false && r.status !== 'no-catalogue' && Array.isArray(r.missingCore)); }

    /* Why a trainee is not yet competent, naming the units: the core units
       graded NYC, then the core units with no result. */
    function nycReason(r) {
      var nycCore = (r.missingCore || []).filter(function (c) { return (r.nycUnits || []).indexOf(c) !== -1; });
      var none = (r.missingCore || []).filter(function (c) { return nycCore.indexOf(c) === -1 && (r.pendingUnits || []).indexOf(c) === -1; });
      var parts = [];
      if (nycCore.length) parts.push('Not yet competent: ' + codes(nycCore));
      if (none.length) parts.push('No result: ' + codes(none));
      return parts.join('; ') || 'Core units not yet achieved';
    }

    /* student: the trainee record (read, never changed here).
       opts: { status   — Core.courseDuration.status of their course
                          ('ended' | 'active' | 'not-started' | 'no-dates' | 'unknown'),
               endKey   — which ending this is (the course's end date),
               readiness — Core.Transcript.transcriptReadiness(student, …); null,
                          or { known:false }, when the programme has no unit
                          catalogue,
               loading  — true while the transcript data has not loaded yet: a
                          catalogue programme is then left for the next sweep
                          rather than judged on half the records,
               nowIso   — the moment, for readyToCertifyAt }
       -> { outcome, changed, set: { field: value }, unset: [fields], reason }
       outcome: 'none' | 'final' | 'settled' | 'deferred' | 'nyc' | 'ready' |
                'awaiting-marking' | 'revert' */
    function decide(s, opts) {
      opts = opts || {};
      var out = { outcome: 'none', changed: false, set: {}, unset: [], reason: '' };
      if (!s) return out;
      var set = function (k, v) { if (s[k] !== v) { out.set[k] = v; out.changed = true; } };
      var unset = function (k) { if (s[k] !== undefined) { out.unset.push(k); out.changed = true; } };
      var st = opts.status;
      if (st === 'ended') {
        var endKey = opts.endKey || 'ended';
        if (FINAL[s.stage]) {
          // Certified or done: what the rule last said no longer applies.
          out.outcome = 'final';
          FLAGS.forEach(unset);
          return out;
        }
        // This ending has been dealt with: by a person, or by this rule's NYC.
        if (s._nycForCourseEnd === endKey) { out.outcome = 'settled'; return out; }
        // A dropout ("Incomplete") is how this course ended for them, whoever
        // recorded it and whenever — and a stage a person chose (other than In
        // Training, which is exactly what the ending judges) is theirs to
        // change. The sweep turned every dropout into Not Yet Competent the
        // day the course ended, so dropouts were reported as NYC; neither is
        // touched now (as Student Progress's own stage edit promises).
        var stg = String(s.stage || '').trim().toLowerCase();
        if (stg === 'incomplete' || (s.stageSetByUser && stg && stg !== 'training' && stg !== 'in training')) { out.outcome = 'settled'; return out; }
        // Already NYC (set by hand, or arrived so from another device).
        if (s.stage === 'nyc') return out;
        var r = opts.readiness;
        if (!known(r)) {
          if (opts.loading && r === undefined) { out.outcome = 'deferred'; return out; }
          // No unit catalogue: today's rule, unchanged.
          out.outcome = 'nyc';
          set('stage', 'nyc'); set('_nycAuto', true); set('_nycForCourseEnd', endKey);
          FLAGS.forEach(unset);
          return out;
        }
        if (has(r, 'pendingUnits')) {
          out.outcome = 'awaiting-marking';
          out.reason = 'Awaiting marking: ' + codes(r.pendingUnits);
          set('courseEndState', 'awaiting-marking'); set('courseEndReason', out.reason); unset('readyToCertifyAt');
          return out;
        }
        if (!has(r, 'missingCore')) {
          out.outcome = 'ready';
          out.reason = 'Every core unit competent' + (r.total ? ' (' + (r.competent || 0) + ' of ' + r.total + ' units competent)' : '');
          set('courseEndState', 'ready'); set('courseEndReason', out.reason);
          // Stamped once: re-confirming it on every sweep is not a new event.
          if (!s.readyToCertifyAt || s.courseEndState !== 'ready') set('readyToCertifyAt', opts.nowIso || new Date().toISOString());
          return out;
        }
        out.outcome = 'nyc';
        out.reason = nycReason(r);
        set('stage', 'nyc'); set('_nycAuto', true); set('_nycForCourseEnd', endKey);
        set('courseEndState', 'nyc'); set('courseEndReason', out.reason); unset('readyToCertifyAt');
        return out;
      }
      if (st === 'active' || st === 'not-started') {
        // The course is genuinely open again (extended, or not started yet):
        // undo only what THIS rule applied, and only where a person has not
        // since had their say. 'no-dates' and 'unknown' say nothing about
        // whether the course has finished, so they undo nothing.
        if (s.stage === 'nyc' && s._nycAuto && !s.stageSetByUser) {
          out.outcome = 'revert';
          set('stage', 'training'); unset('_nycAuto'); unset('_nycForCourseEnd');
          FLAGS.forEach(unset);
          return out;
        }
        // "Ready" and "awaiting marking" were about the ending; there is none now.
        if (s.courseEndState === 'ready' || s.courseEndState === 'awaiting-marking') {
          out.outcome = 'revert';
          FLAGS.forEach(unset);
        }
      }
      return out;
    }
    // Write a decision onto the record. Returns whether anything changed.
    function apply(s, d) {
      if (!s || !d || !d.changed) return false;
      Object.keys(d.set).forEach(function (k) { s[k] = d.set[k]; });
      d.unset.forEach(function (k) { delete s[k]; });
      return true;
    }

    /* A person, not the rule, has just decided this trainee's stage. The rule
       no longer claims it; when the course has ended (endKey given) it counts
       as the Centre having dealt with this ending, so the sweep leaves it alone.
       What the rule had flagged goes with it — unless the person has confirmed
       the rule's own Not Yet Competent, whose reason still explains it. */
    function markSetByUser(s, endKey) {
      if (!s) return;
      delete s._nycAuto;
      if (endKey) s._nycForCourseEnd = endKey;
      s.stageSetByUser = true;
      if (!(s.stage === 'nyc' && s.courseEndState === 'nyc')) FLAGS.forEach(function (k) { delete s[k]; });
    }

    /* What to show beside a trainee's stage, or null: { state, label, detail, at }.
       "Ready" and "awaiting marking" only while the trainee is still
       uncertified and not NYC; the NYC reason only while they are NYC. */
    function flag(s) {
      if (!s || !s.courseEndState || FINAL[s.stage]) return null;
      var state = s.courseEndState;
      if (state === 'nyc' ? s.stage !== 'nyc' : (s.stage === 'nyc' || !LABELS[state])) return null;
      return { state: state, label: LABELS[state], detail: String(s.courseEndReason || ''), at: s.readyToCertifyAt || '' };
    }

    return { decide: decide, apply: apply, markSetByUser: markSetByUser, flag: flag, nycReason: nycReason,
             FLAGS: FLAGS, LABELS: LABELS };
  })();

  /* ==========================================================================
     ATTENDANCE REGISTER — one mark per trainee per actual date

     WHY THIS EXISTS
     ---------------
     The register used to be ONE Mon–Fri row per trainee per financial quarter.
     Marking a Monday wrote r.days.Mon, so the second week's Monday overwrote
     the first week's, and a thirteen-week quarter kept only the last state of
     five cells. The Date picker could not help: there was nothing dated to
     pick. A training centre must be able to say who was in class on any given
     day of the course, and who changed the mark.

     So every mark is now a record of its own, keyed by the trainee and the
     calendar date the class met (the Centre's local date — never a UTC stamp,
     which after 7 pm in Jamaica is already tomorrow):

       { id: 'ATT|<studentId>|<YYYY-MM-DD>', studentId, date,
         status: 'present' | 'late' | 'absent' | 'excused' | 'noclass' | '',
         markedAt: ISO time, markedBy, studentName, course,
         history: [what the cell said before],
         migratedFrom: { … }  — only on marks carried over from the old rows }

     The id is a function of trainee + date, so two devices marking the same
     cell hold the SAME record and the newer mark wins — instead of two rows
     that the old "present always beats absent" fold then settled. A cleared
     cell is a record with status '' so the clearing travels like any mark.

     'excused' (a trainee with leave) and 'noclass' (a holiday, a cancelled
     class) are kept but never count as absences: a rate is attended over HELD
     sessions only — present + late over present + late + absent.

     The old weekly rows are never touched here. migrateLegacy() reads them and
     writes dated records that say, in migratedFrom, exactly which old slot
     they came from and how their date was chosen — the old rows never said
     which week they were marked in, so the date is an estimate and is labelled
     as one. A row whose five days all still hold the 'absent' every row was
     created with is carried over marked `unconfirmed`: it may never have been
     marked at all, so it is kept and shown but not counted until someone
     confirms it.

     Everything here is pure (dates and "now" are passed in), so it is tested
     in Node and is the same code in the online and the offline builds.
     ========================================================================== */
  Core.attendance = (function () {
    var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var STATUSES = ['present', 'late', 'absent', 'excused', 'noclass'];
    var LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused',
      noclass: 'No class', '': 'Not marked' };
    // Trainees whose course is behind them. Used only when a trainee has no
    // course dates at all — with dates, the dates decide.
    var FINISHED_STAGES = ['certified', 'collected', 'nyc', 'incomplete'];
    var HISTORY_CAP = 20;
    var DAY_MS = 86400000;
    var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    // Calendar arithmetic on 'YYYY-MM-DD' strings. Done in UTC on purpose: it is
    // pure date counting, so no timezone can move a day.
    function parse(s) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
      if (!m) return NaN;
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
      var d = new Date(t);
      return (d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) ? t : NaN;
    }
    function isDate(s) { return !isNaN(parse(s)); }
    function fmt(t) {
      var d = new Date(t);
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    function addDays(date, n) { var t = parse(date); return isNaN(t) ? '' : fmt(t + n * DAY_MS); }
    function weekday(date) { var t = parse(date); return isNaN(t) ? -1 : new Date(t).getUTCDay(); }
    // The Monday of the week a date falls in (a Saturday or Sunday belongs to
    // the week just finished).
    function weekStart(date) { var wd = weekday(date); return wd < 0 ? '' : addDays(date, -((wd + 6) % 7)); }
    function weekDates(date) {
      var mon = weekStart(date);
      return mon ? DAYS.map(function (d, i) { return addDays(mon, i); }) : [];
    }
    function dayName(date) { var wd = weekday(date); return (wd >= 1 && wd <= 5) ? DAYS[wd - 1] : ''; }
    // The calendar date on THIS device's clock — the Centre's own day.
    function localDate(d) {
      d = (d instanceof Date) ? d : (d == null ? new Date() : new Date(d));
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    // First and last day of a financial quarter, inclusive.
    function quarterBounds(fy, q) {
      q = parseInt(q, 10);
      var meta = Core.getQuarterMeta(q);
      if (!meta || !fy) return null;
      var yr = Core.quarterCalendarYear(fy, q);
      var nm = meta.startMonth + 3, ny = yr;
      if (nm > 12) { nm -= 12; ny++; }
      return { start: yr + '-' + pad(meta.startMonth) + '-01', end: addDays(ny + '-' + pad(nm) + '-01', -1) };
    }

    function recordId(studentId, date) { return 'ATT|' + studentId + '|' + date; }
    function keyOf(r) {
      return (r && r.studentId != null && String(r.studentId) !== '' && isDate(r.date))
        ? recordId(r.studentId, r.date) : null;
    }
    function stampMs(r) { var t = r && r.markedAt ? Date.parse(r.markedAt) : NaN; return isNaN(t) ? 0 : t; }
    function normStatus(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    function copy(r) { var o = {}; for (var k in r) { if (hasOwn(r, k)) o[k] = r[k]; } return o; }

    /* ---- history: what a cell said before it was changed ---------------- */
    function historyEntry(r) {
      var h = { status: r.status || '', markedAt: r.markedAt || '', markedBy: r.markedBy || '' };
      if (r.source) h.source = r.source;
      if (r.migratedFrom) h.migratedFrom = r.migratedFrom;
      if (r.unconfirmed) h.unconfirmed = true;
      if (r.notApplied) h.notApplied = true;
      return h;
    }
    function histKey(h) {
      return (h.markedAt || '') + '|' + (h.status || '') + '|' + (h.markedBy || '') + '|' +
        ((h.migratedFrom && h.migratedFrom.ref) || '') + '|' + (h.notApplied ? 'n' : '');
    }
    // Union of history lists, oldest first, without the record's own current
    // state. Capped — but a line that records where an upgraded mark came from
    // is never the one cut, because that is what stops it being carried over
    // a second time.
    function mergeHistory(lists, current) {
      var seen = {}, out = [];
      if (current) seen[histKey(current)] = true;
      lists.forEach(function (list) {
        (Array.isArray(list) ? list : []).forEach(function (h) {
          if (!h || typeof h !== 'object') return;
          var k = histKey(h);
          if (seen[k]) return;
          seen[k] = true; out.push(h);
        });
      });
      out.sort(function (a, b) {
        return String(a.markedAt || '').localeCompare(String(b.markedAt || '')) || histKey(a).localeCompare(histKey(b));
      });
      if (out.length <= HISTORY_CAP) return out;
      var keepFrom = out.length - HISTORY_CAP;
      return out.filter(function (h, i) { return i >= keepFrom || !!h.migratedFrom; });
    }

    /* ---- which of two copies of one cell stands ------------------------- */
    // A real mark outranks one the upgrade estimated, and a confirmed estimate
    // outranks an unconfirmed one — whatever the clocks say. Without this a
    // device that upgraded a minute after an instructor marked the class would
    // put its guess over the instructor's mark, because its stamp is newer.
    function rank(r) { return r.migratedFrom ? (r.unconfirmed ? 0 : 1) : 2; }
    function beats(b, a) {
      var ra = rank(a), rb = rank(b);
      if (ra !== rb) return rb > ra;
      var ta = stampMs(a), tb = stampMs(b);
      if (ta !== tb) return tb > ta;
      // Same instant: any fixed rule will do, as long as every device applies it.
      return ((b.status || '') + '|' + (b.markedBy || '')) > ((a.status || '') + '|' + (a.markedBy || ''));
    }
    function mergeRecord(a, b) {
      if (!a) return b;
      if (!b) return a;
      var win = beats(b, a) ? b : a, lose = (win === b) ? a : b;
      var out = copy(win);
      if (!out.studentName && lose.studentName) out.studentName = lose.studentName;
      if (!out.course && lose.course) out.course = lose.course;
      var cur = historyEntry(win), lost = historyEntry(lose);
      var lists = [a.history, b.history];
      if (histKey(lost) !== histKey(cur)) lists.push([lost]);
      var h = mergeHistory(lists, cur);
      if (h.length) out.history = h; else delete out.history;
      out.id = recordId(out.studentId, out.date);
      return out;
    }
    function sig(r) {
      return [r.markedAt || '', r.status || '', r.markedBy || '', r.unconfirmed ? 1 : 0,
        (r.migratedFrom && r.migratedFrom.ref) || '', r.studentName || '', r.course || '',
        (r.history || []).map(histKey).join(',')].join('\u0001');
    }

    /* Every place an old weekly slot has already been carried over, from the
       records themselves and their history — which travels with the register,
       so a device that receives another's upgrade does not repeat it. */
    function refsIn(register) {
      var refs = {};
      (register || []).forEach(function (r) {
        if (!r) return;
        if (r.migratedFrom && r.migratedFrom.ref) refs[r.migratedFrom.ref] = true;
        (r.history || []).forEach(function (h) { if (h && h.migratedFrom && h.migratedFrom.ref) refs[h.migratedFrom.ref] = true; });
      });
      return refs;
    }

    /* Two devices that each upgraded the same old slot on different days dated
       it differently. The FIRST carry-over stands (earliest migratedFrom.at,
       then earliest date); later copies that are still only estimates are
       dropped — they hold nothing the first does not. A copy someone has since
       marked for real is a real mark and is never dropped. */
    function collapseMigrated(list) {
      var canon = {};
      function consider(ref, at, date) {
        var c = canon[ref];
        if (!c || at < c.at || (at === c.at && date < c.date)) canon[ref] = { at: at, date: date };
      }
      list.forEach(function (r) {
        if (!r) return;
        if (r.migratedFrom && r.migratedFrom.ref) consider(r.migratedFrom.ref, r.migratedFrom.at || '', r.date || '');
        (r.history || []).forEach(function (h) {
          if (h && h.migratedFrom && h.migratedFrom.ref) consider(h.migratedFrom.ref, h.migratedFrom.at || '', r.date || '');
        });
      });
      var dropped = 0, droppedStudents = {};
      var out = list.filter(function (r) {
        if (!r || !r.migratedFrom || !r.migratedFrom.ref) return true;
        var c = canon[r.migratedFrom.ref];
        if (!c || (c.at === (r.migratedFrom.at || '') && c.date === (r.date || ''))) return true;
        dropped++; droppedStudents[r.studentId] = true;
        return false;
      });
      return { register: dropped ? out : list, dropped: dropped, droppedStudents: Object.keys(droppedStudents) };
    }

    /* Merge another copy of the register into this one, record by record.
       Never removes a record either side holds (apart from the duplicate
       estimates above); the newer mark of a cell wins and the older value is
       kept in its history. opts.accept(record) may refuse incoming records
       (a deleted trainee's, say). Returns { register, added, updated, changed,
       affected: [studentIds whose marks changed] }. */
    function mergeRegister(local, incoming, opts) {
      opts = opts || {};
      var out = [], idx = {}, added = 0, updated = 0, folded = 0, affected = {};
      (Array.isArray(local) ? local : []).forEach(function (r) {
        if (!r) return;
        var k = keyOf(r);
        if (!k) { out.push(r); return; }                 // unreadable: kept as it is, never dropped
        if (hasOwn(idx, k)) {                            // the same cell twice locally: fold
          out[idx[k]] = mergeRecord(out[idx[k]], r); folded++; affected[r.studentId] = true; return;
        }
        if (r.id !== k) { r = copy(r); r.id = k; folded++; }
        idx[k] = out.length; out.push(r);
      });
      (Array.isArray(incoming) ? incoming : []).forEach(function (r) {
        var k = keyOf(r);
        if (!k) return;
        if (opts.accept && !opts.accept(r)) return;
        if (!hasOwn(idx, k)) {
          var c = copy(r); c.id = k;
          idx[k] = out.length; out.push(c); added++; affected[r.studentId] = true;
          return;
        }
        var cur = out[idx[k]], m = mergeRecord(cur, r);
        if (sig(m) !== sig(cur)) { out[idx[k]] = m; updated++; affected[r.studentId] = true; }
      });
      var col = collapseMigrated(out);
      col.droppedStudents.forEach(function (sid) { affected[sid] = true; });
      return {
        register: col.register, added: added, updated: updated, folded: folded, dropped: col.dropped,
        changed: !!(added || updated || folded || col.dropped), affected: Object.keys(affected)
      };
    }

    function indexOf(register) {
      var idx = {};
      (register || []).forEach(function (r, i) { var k = keyOf(r); if (k && !hasOwn(idx, k)) idx[k] = i; });
      return idx;
    }

    /* Write one mark into the page's register (mutated in place).
       o = { studentId, date, status, by, byName, at, studentName, course,
             source, vcSessionId, minutes }. `index` is an optional id->position
       map kept in step. A change keeps what the cell said before in history.
       The stamp is never older than the mark it replaces, so an edit made here
       always supersedes what it was made over even if another device's clock
       ran ahead. Returns { changed, record }. */
    function mark(register, o, index) {
      if (!Array.isArray(register) || !o || o.studentId == null || String(o.studentId) === '' || !isDate(o.date)) {
        return { changed: false, record: null };
      }
      var id = recordId(o.studentId, o.date);
      var i = -1;
      if (index && hasOwn(index, id) && register[index[id]] && keyOf(register[index[id]]) === id) i = index[id];
      else {
        for (var j = 0; j < register.length; j++) { if (keyOf(register[j]) === id) { i = j; break; } }
      }
      var prev = i >= 0 ? register[i] : null;
      var status = normStatus(o.status);
      if (prev && !prev.migratedFrom && normStatus(prev.status) === status) return { changed: false, record: prev };
      var at = o.at || new Date().toISOString();
      if (prev && stampMs(prev) >= Date.parse(at)) at = new Date(stampMs(prev) + 1).toISOString();
      var rec = { id: id, studentId: o.studentId, date: o.date, status: status, markedAt: at, markedBy: o.by || '' };
      if (o.byName) rec.markedByName = o.byName;
      if (o.studentName || (prev && prev.studentName)) rec.studentName = o.studentName || prev.studentName;
      if (o.course || (prev && prev.course)) rec.course = o.course || prev.course;
      if (o.source) rec.source = o.source;
      if (o.vcSessionId) rec.vcSessionId = o.vcSessionId;
      if (typeof o.minutes === 'number') rec.minutes = o.minutes;
      if (prev) {
        var h = mergeHistory([prev.history, [historyEntry(prev)]], historyEntry(rec));
        if (h.length) rec.history = h;
        register[i] = rec;
      } else {
        if (index) index[id] = register.length;
        register.push(rec);
      }
      return { changed: true, record: rec };
    }

    /* ---- rates ----------------------------------------------------------- */
    // The one definition of an attendance rate, used by every view: attended
    // (present + late) over HELD sessions (present + late + absent). Excused,
    // no-class, not-marked and unconfirmed carried-over marks are not held
    // sessions. pct is null when nothing has been held — "no attendance taken"
    // is not 0%.
    function summarize(records) {
      var s = { present: 0, late: 0, absent: 0, excused: 0, noclass: 0, unmarked: 0, unconfirmed: 0, other: 0,
        held: 0, attended: 0, pct: null };
      (records || []).forEach(function (r) {
        if (!r) return;
        if (r.unconfirmed) { s.unconfirmed++; return; }
        var st = normStatus(r.status);
        if (st === '') s.unmarked++;
        else if (STATUSES.indexOf(st) !== -1) s[st]++;
        else s.other++;
      });
      s.attended = s.present + s.late;
      s.held = s.attended + s.absent;
      s.pct = s.held ? Math.round(s.attended / s.held * 100) : null;
      return s;
    }
    // The same rule over an old Mon–Fri day map (views that still meet old rows).
    function summarizeDays(days) {
      if (!days || typeof days !== 'object') return summarize([]);
      return summarize(DAYS.map(function (d) { return { status: days[d] }; }));
    }
    /* Per-trainee summaries. opts.from / opts.to limit the dates (inclusive);
       opts.studentIds (a map) limits the trainees. */
    function ratesByStudent(register, opts) {
      opts = opts || {};
      var groups = {};
      (register || []).forEach(function (r) {
        if (!r || r.studentId == null || !isDate(r.date)) return;
        if (opts.from && r.date < opts.from) return;
        if (opts.to && r.date > opts.to) return;
        if (opts.studentIds && !opts.studentIds[r.studentId]) return;
        (groups[r.studentId] = groups[r.studentId] || []).push(r);
      });
      var out = {};
      Object.keys(groups).forEach(function (sid) { out[sid] = summarize(groups[sid]); });
      return out;
    }

    /* ---- carrying the old weekly rows over -------------------------------- */
    function latestOnOrBefore(day, anchor) {
      var target = DAYS.indexOf(day) + 1, wd = weekday(anchor);
      return addDays(anchor, -((wd - target + 7) % 7));
    }
    function firstOnOrAfter(day, start) {
      var target = DAYS.indexOf(day) + 1, wd = weekday(start);
      return addDays(start, (target - wd + 7) % 7);
    }
    /* Which date did an old "Mon" slot most plausibly mean? The row was
       overwritten week after week, so what it holds is the LAST week it was
       marked: the most recent such weekday on or before the upgrade — or, for
       a quarter already over, the last such weekday of that quarter. A quarter
       that has not started yet (someone marked ahead) gets its first week. */
    function attributeLegacyDate(day, opts) {
      opts = opts || {};
      var today = isDate(opts.today) ? opts.today : localDate();
      var b = (opts.fy && opts.q) ? quarterBounds(opts.fy, opts.q) : null;
      if (b && b.start > today) return { date: firstOnOrAfter(day, b.start), basis: 'first-week-of-a-quarter-not-yet-started' };
      if (b && b.end < today) return { date: latestOnOrBefore(day, b.end), basis: 'last-week-of-the-quarter' };
      return { date: latestOnOrBefore(day, today), basis: 'most-recent-' + day + '-on-or-before-the-upgrade' };
    }
    /* The day the register first went dated, as the register itself records
       it (the earliest carry-over anywhere — it travels with the register, so
       every device agrees). '' before any carry-over has happened. */
    function firstUpgradeDay(register) {
      var first = '';
      (register || []).forEach(function (r) {
        if (!r) return;
        [r].concat(r.history || []).forEach(function (h) {
          var at = h && h.migratedFrom && h.migratedFrom.at;
          if (at && (!first || at < first)) first = at;
        });
      });
      return first ? localDate(new Date(first)) : '';
    }
    /* Carry the old rows of one storage key over into the register (mutated in
       place). opts = { key, fy, q, today, at, since }. Every non-empty old slot ends
       up either as a dated record or — when that trainee already has a mark on
       that date — in that record's history, flagged notApplied. Nothing is
       overwritten and nothing is skipped silently: the report counts it all.
       A slot already carried over (by this device or another) is not carried
       over again. */
    function migrateLegacy(register, rows, opts) {
      opts = opts || {};
      var report = { rows: 0, slots: 0, migrated: 0, alreadyMigrated: 0, keptInHistory: 0,
        unconfirmedRows: 0, skippedRows: 0, defaultRowsSkipped: 0, changed: false };
      if (!Array.isArray(register) || !Array.isArray(rows)) return report;
      var key = String(opts.key || 'voctrain_attendance');
      var at = opts.at || new Date().toISOString();
      var refs = refsIn(register), index = indexOf(register);
      rows.forEach(function (row) {
        if (!row) return;
        if (row.studentId == null || String(row.studentId) === '' || !row.days || typeof row.days !== 'object') {
          report.skippedRows++; return;
        }
        var vals = {}, any = false, allAbsent = true;
        DAYS.forEach(function (d) {
          var v = normStatus(row.days[d]);
          vals[d] = v;
          if (v) any = true;
          if (v !== 'absent') allAbsent = false;
        });
        if (!any) return;                                  // nothing was ever in it
        // A roster row created on or after the day the register went dated was
        // never marked the old way — the new pages do not write these rows'
        // days — so its five creation-default absences are not marks, and
        // carrying them over would put a column of "absent?" in front of every
        // trainee enrolled since.
        var made = (typeof row.date === 'string') ? row.date.slice(0, 10) : '';
        if (allAbsent && opts.since && isDate(made) && made >= opts.since) { report.defaultRowsSkipped++; return; }
        report.rows++;
        if (allAbsent) report.unconfirmedRows++;
        DAYS.forEach(function (d) {
          var v = vals[d];
          if (!v) return;
          report.slots++;
          var ref = key + '|' + row.studentId + '|' + d + '|' + v;
          if (refs[ref]) { report.alreadyMigrated++; return; }
          refs[ref] = true;
          var when = attributeLegacyDate(d, opts);
          var rec = {
            id: recordId(row.studentId, when.date), studentId: row.studentId, date: when.date, status: v,
            markedAt: at, markedBy: 'upgrade', source: 'migration',
            migratedFrom: { ref: ref, key: key, day: d, value: v, rowDate: row.date || '', basis: when.basis, at: at }
          };
          if (row.studentName) rec.studentName = row.studentName;
          if (row.course) rec.course = row.course;
          if (allAbsent) rec.unconfirmed = true;
          report.changed = true;
          if (hasOwn(index, rec.id)) {
            // That trainee already has a mark on that date. It stands; the old
            // value is filed beside it so it is still there to see.
            var cur = register[index[rec.id]];
            var line = historyEntry(rec); line.notApplied = true;
            var upd = copy(cur);
            upd.history = mergeHistory([cur.history, [line]], historyEntry(cur));
            register[index[rec.id]] = upd;
            report.keptInHistory++;
            return;
          }
          index[rec.id] = register.length;
          register.push(rec);
          report.migrated++;
        });
      });
      return report;
    }

    /* Follow a trainee whose id changed (a de-duplication, a rename): their
       marks move with them, and two marks for one cell fold newest-wins. */
    function relink(register, idMap) {
      if (!Array.isArray(register) || !idMap) return { register: register, changed: false };
      var moved = false;
      var list = register.map(function (r) {
        if (!r || r.studentId == null || !hasOwn(idMap, r.studentId) || idMap[r.studentId] === r.studentId) return r;
        moved = true;
        var c = copy(r);
        c.studentId = idMap[r.studentId];
        if (isDate(c.date)) c.id = recordId(c.studentId, c.date);
        return c;
      });
      if (!moved) return { register: register, changed: false };
      return { register: mergeRegister(list, []).register, changed: true };
    }

    /* Is a trainee on the register for the days from..to? The course dates
       decide (the trainee's centre first, then the dates stamped on the
       trainee). With no dates anywhere, anyone whose course is not behind them.
       This is what keeps a new quarter from listing every graduate the Centre
       ever had as five absences. Callers always ALSO show anyone who already
       has a mark in those days, so a recorded mark is never hidden. */
    function onRegister(student, centre, from, to) {
      if (!student) return false;
      var nd = function (s) { return (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s)) ? s.slice(0, 10) : ''; };
      var start = nd(centre && centre.startDate) || nd(student.courseStart);
      var end = nd(centre && centre.endDate) || nd(student.courseEnd);
      if (start || end) {
        if (start && to && to < start) return false;
        if (end && from && from > end) return false;
        return true;
      }
      return FINISHED_STAGES.indexOf(String(student.stage || '').toLowerCase()) === -1;
    }

    /* ---- live classes -> suggested marks ---------------------------------- */
    function minutesBetween(a, b) {
      var x = Date.parse(a || ''), y = Date.parse(b || '');
      return (isNaN(x) || isNaN(y) || y < x) ? 0 : (y - x) / 60000;
    }
    function normName(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }
    // Time in the room, counting a stay with no recorded leave up to the end
    // of the session (or the last thing it heard), not as zero.
    function participantMinutes(session, p) {
      var end = session.endedAt || session.updatedAt || '';
      var total = (p.stays || []).reduce(function (a, s) { return a + minutesBetween(s.joined, s.left || end); }, 0);
      if (!total && p.minutes) total = p.minutes;
      return Math.round(total * 10) / 10;
    }
    /* Turn the live classes held on one date into SUGGESTED marks for the
       instructor to confirm — never marks by themselves. A name typed in the
       meeting is matched to the roster only when exactly one trainee answers
       to it; two trainees of one name are flagged, never guessed. The same
       trainee seen by several devices (each records its own copy of a class)
       is counted once, with the longest time any of them saw.
       Returns { joined:[{studentId, studentName, minutes, suggested, names, sessions}],
                 absent:[{studentId, studentName, suggested:'absent'}],
                 unmatched:[{name, minutes, reason:'not-on-roster'|'ambiguous'}] }. */
    function suggestFromLive(sessions, roster, opts) {
      opts = opts || {};
      var VS = Core.vcSessions || {};
      var ratio = VS.PRESENT_MIN_RATIO || 0.5, cap = VS.PRESENT_MIN_MINUTES || 20;
      var keyed = {}, ambiguous = {};
      (roster || []).forEach(function (s) {
        if (!s || s.id == null) return;
        var n = normName(s.name);
        if (!n) return;
        var parts = n.split(' ');
        var keys = [n];
        if (parts.length > 2) keys.push(parts[0] + ' ' + parts[parts.length - 1]);
        keys.forEach(function (k) {
          if (keyed[k] && keyed[k].id !== s.id) ambiguous[k] = true;
          else keyed[k] = s;
        });
      });
      var byStudent = {}, unmatched = [];
      (sessions || []).forEach(function (session) {
        if (!session) return;
        var total = minutesBetween(session.startedAt, session.endedAt || session.updatedAt);
        var threshold = total ? Math.min(cap, total * ratio) : 0;
        (session.participants || []).forEach(function (p) {
          if (!p) return;
          if (p.role && p.role !== 'student') return;      // staff in the room are not trainees
          var n = normName(p.name), parts = n.split(' ');
          var s = null, why = '';
          if (ambiguous[n]) why = 'ambiguous';
          else if (keyed[n]) s = keyed[n];
          else if (parts.length > 1) {
            var k2 = parts[0] + ' ' + parts[parts.length - 1];
            if (ambiguous[k2]) why = 'ambiguous'; else s = keyed[k2] || null;
          }
          var mins = participantMinutes(session, p);
          if (!s) { unmatched.push({ name: p.name || '', minutes: mins, reason: why || 'not-on-roster', sessionId: session.id || '' }); return; }
          var cur = byStudent[s.id];
          if (!cur) cur = byStudent[s.id] = { studentId: s.id, studentName: s.name || '', minutes: 0, present: false, names: [], sessions: [] };
          if (mins > cur.minutes) cur.minutes = mins;
          if (threshold ? mins >= threshold : mins > 0) cur.present = true;
          if (cur.names.indexOf(p.name) === -1) cur.names.push(p.name);
          if (session.id && cur.sessions.indexOf(session.id) === -1) cur.sessions.push(session.id);
        });
      });
      var joined = Object.keys(byStudent).map(function (id) {
        var r = byStudent[id];
        r.suggested = r.present ? 'present' : 'late';
        return r;
      });
      var absent = (roster || []).filter(function (s) { return s && s.id != null && !byStudent[s.id]; })
        .map(function (s) { return { studentId: s.id, studentName: s.name || '', minutes: 0, suggested: 'absent' }; });
      return { joined: joined, absent: absent, unmatched: unmatched };
    }

    /* ---- the register as a spreadsheet ------------------------------------ */
    // One CSV cell. Names are typed by people, so a cell that starts the way a
    // formula does (= + - @, a tab or a return) is given a leading ' — opened
    // in a spreadsheet it is text, never a command.
    function csvCell(v) {
      var s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    /* The dated register for a list of trainees between two dates: one row per
       trainee, one column per date anything was marked, then the totals and
       the rate by the one rule above. */
    function registerCsv(roster, register, from, to) {
      var ids = {}, byCell = {}, dateSet = {};
      (roster || []).forEach(function (s) { if (s && s.id != null) ids[s.id] = true; });
      (register || []).forEach(function (r) {
        if (!r || !ids[r.studentId] || !isDate(r.date)) return;
        if (from && r.date < from) return;
        if (to && r.date > to) return;
        byCell[recordId(r.studentId, r.date)] = r;
        dateSet[r.date] = true;
      });
      var dates = Object.keys(dateSet).sort();
      var lines = [['Trainee', 'Trainee ID', 'Course'].concat(dates, ['Present', 'Late', 'Absent', 'Excused', 'No class', 'Held sessions', 'Attendance %']).map(csvCell).join(',')];
      (roster || []).forEach(function (s) {
        if (!s || s.id == null) return;
        var recs = [];
        var cells = dates.map(function (d) {
          var r = byCell[recordId(s.id, d)];
          if (!r) return '';
          recs.push(r);
          if (r.unconfirmed) return 'Absent? (old register, unconfirmed)';
          var st = normStatus(r.status);
          return hasOwn(LABELS, st) ? LABELS[st] : st;
        });
        var sum = summarize(recs);
        lines.push([s.name || '', s.id, s.course || ''].concat(cells,
          [sum.present, sum.late, sum.absent, sum.excused, sum.noclass, sum.held, sum.pct == null ? '' : sum.pct]).map(csvCell).join(','));
      });
      return lines.join('\n');
    }

    return {
      DAYS: DAYS, STATUSES: STATUSES, LABELS: LABELS, FINISHED_STAGES: FINISHED_STAGES,
      csvCell: csvCell, registerCsv: registerCsv,
      isDate: isDate, addDays: addDays, weekday: weekday, weekStart: weekStart, weekDates: weekDates,
      dayName: dayName, localDate: localDate, quarterBounds: quarterBounds,
      recordId: recordId, keyOf: keyOf, normStatus: normStatus,
      mergeRecord: mergeRecord, mergeRegister: mergeRegister, collapseMigrated: collapseMigrated,
      indexOf: indexOf, mark: mark, refsIn: refsIn,
      summarize: summarize, summarizeDays: summarizeDays, ratesByStudent: ratesByStudent,
      attributeLegacyDate: attributeLegacyDate, migrateLegacy: migrateLegacy, relink: relink,
      firstUpgradeDay: firstUpgradeDay,
      onRegister: onRegister, participantMinutes: participantMinutes, suggestFromLive: suggestFromLive
    };
  })();

  /* ==========================================================================
     VIDEO CONFERENCE CAPACITY

     The built-in conference is a PEER-TO-PEER FULL MESH: every participant
     opens a media connection to every other one. With N people each browser
     encodes and uploads N-1 video streams and decodes N-1 more, so the load
     grows with the square of the room size:

         connections in the room = N x (N-1) / 2
         streams per participant = 2 x (N-1)

     That is fine for a small class and impossible for a large one — at 80
     people every laptop would be sending 79 video streams at once. A mesh
     cannot be tuned into a large room; hosting 80 needs a media server (an
     SFU) that each participant sends ONE stream to. The Centre has no media
     server of its own, so large classes run on a hosted SFU (Jitsi) while
     small ones keep using the built-in mesh with no external dependency.

     These helpers put real numbers behind that choice instead of letting a
     room silently degrade.
     ========================================================================== */
  Core.vcCapacity = (function () {
    // Comfortable ceiling for a browser mesh with video. Beyond this, upstream
    // bandwidth and CPU collapse long before the browser's connection limit.
    var MESH_MAX_VIDEO = 8;
    // Audio-only costs far less per stream, so a mesh stretches further.
    var MESH_MAX_AUDIO = 16;
    // What a hosted SFU room supports (Jitsi's published guidance).
    var SFU_MAX = 100;

    function meshConnections(n) {
      n = Math.max(0, Math.floor(n || 0));
      return n < 2 ? 0 : (n * (n - 1)) / 2;
    }
    function meshStreamsPerParticipant(n) {
      n = Math.max(0, Math.floor(n || 0));
      return n < 2 ? 0 : 2 * (n - 1);
    }
    /* Rough upstream bandwidth each participant needs, in kbps. */
    function meshUplinkKbps(n, kbpsPerStream) {
      n = Math.max(0, Math.floor(n || 0));
      var per = kbpsPerStream || 400;
      return n < 2 ? 0 : (n - 1) * per;
    }
    function meshLimit(audioOnly) { return audioOnly ? MESH_MAX_AUDIO : MESH_MAX_VIDEO; }

    /* Which transport can actually host `expected` people?
       -> { mode:'mesh'|'sfu', limit, feasible, reason } */
    function recommend(expected, opts) {
      opts = opts || {};
      var n = Math.max(1, Math.floor(expected || 1));
      var meshCap = meshLimit(opts.audioOnly);
      if (n <= meshCap) {
        return { mode: 'mesh', limit: meshCap, feasible: true,
          reason: 'A room of ' + n + ' runs directly between the devices, with nothing extra to set up.' };
      }
      if (n <= SFU_MAX) {
        return { mode: 'sfu', limit: SFU_MAX, feasible: true,
          reason: 'A room of ' + n + ' is beyond what a peer-to-peer mesh can carry (' +
                  meshCap + ' max), so it runs on the large-class video service.' };
      }
      return { mode: 'sfu', limit: SFU_MAX, feasible: false,
        reason: 'A single room tops out at about ' + SFU_MAX + ' participants. Split the class into groups.' };
    }

    /* Can one more person join a mesh room that already has `current`? */
    function canJoinMesh(current, audioOnly) {
      var cap = meshLimit(audioOnly);
      var n = Math.max(0, Math.floor(current || 0));
      if (n < cap) return { allowed: true, cap: cap, remaining: cap - n, reason: '' };
      return { allowed: false, cap: cap, remaining: 0,
        reason: 'This room is full. The built-in peer-to-peer conference carries up to ' + cap +
                ' participants; start the session as a Large Class to host more.' };
    }

    /* Above this many trainees the instructor's start screen SUGGESTS a
       Large Class (the owner's decision, October 2026: "classes above about
       6 trainees use Large Class"). In the built-in room the instructor's
       device sends its picture once per trainee, out of one upload: the more
       trainees, the thinner each copy and the harder the instructor's
       connection works. It is a suggestion only — the instructor chooses.
       trainees: how many are expected (the class's register).
       opts.ownServer: the Centre has set its own Large Class video server.
         Without one, Large Class falls back to the public meet.jit.si, which
         cuts an embedded meeting off after a few minutes: then the built-in
         room stays first and the line only says what Large Class would give
         once the Centre adds its own.
       -> { suggest, largeFirst, trainees, line } — `line` is one plain sentence. */
    var SUGGEST_LARGE_ABOVE = 6;
    function largeClassAdvice(trainees, opts) {
      var n = Math.max(0, Math.floor(Number(trainees) || 0));
      if (n <= SUGGEST_LARGE_ABOVE) return { suggest: false, largeFirst: false, trainees: n, line: '' };
      if (!(opts && opts.ownServer === true)) {
        return { suggest: true, largeFirst: false, trainees: n,
          line: 'For more than ' + SUGGEST_LARGE_ABOVE + ' trainees, Large Class saves everyone data once the Centre\u2019s own video server is added in Settings \u2192 Video Conference.' };
      }
      return { suggest: true, largeFirst: true, trainees: n,
        line: 'Large Class is suggested for ' + n + ' trainees: it sends your picture once instead of once per trainee, so everyone uses less data.' };
    }

    return {
      MESH_MAX_VIDEO: MESH_MAX_VIDEO, MESH_MAX_AUDIO: MESH_MAX_AUDIO, SFU_MAX: SFU_MAX,
      SUGGEST_LARGE_ABOVE: SUGGEST_LARGE_ABOVE,
      meshConnections: meshConnections,
      meshStreamsPerParticipant: meshStreamsPerParticipant,
      meshUplinkKbps: meshUplinkKbps,
      meshLimit: meshLimit,
      recommend: recommend,
      canJoinMesh: canJoinMesh,
      largeClassAdvice: largeClassAdvice
    };
  })();

  /* ==========================================================================
     LARGE-CLASS SESSION ATTENDANCE

     A Large Class runs on a hosted conference server, so the platform cannot
     see inside it the way it can see a peer-to-peer room. Driving the meeting
     through the conference server's own API instead of a bare frame gives us
     back the two things that matter: the room can be locked, and we are told
     who joined and who left.

     This module holds the arithmetic — building a session, folding join/leave
     events into per-participant totals, and merging sessions recorded on
     different devices — with no browser or meeting API in sight, so the
     register can be trusted and tested.

     Times are ISO strings. A participant may join and leave several times in
     one class (dropped connection, stepped away); each stay is kept and the
     minutes are summed, so a trainee who reconnects is not double counted and
     is not penalised either.
     ========================================================================== */
  Core.vcSessions = (function () {
    /* A trainee must be present for at least this share of the class to count
       as attending. The Centre's registers treat a brief appearance as absent. */
    var PRESENT_MIN_RATIO = 0.5;
    /* ...but never demand more than this many minutes, so a three-hour class
       does not require 90 minutes before anyone counts as present. */
    var PRESENT_MIN_MINUTES = 20;

    function iso(t) {
      if (!t) return '';
      if (typeof t === 'string') return t;
      try { return new Date(t).toISOString(); } catch (e) { return ''; }
    }
    function ms(t) {
      if (!t) return NaN;
      var v = (t instanceof Date) ? t.getTime() : Date.parse(t);
      return isNaN(v) ? NaN : v;
    }
    function minutesBetween(a, b) {
      var x = ms(a), y = ms(b);
      if (isNaN(x) || isNaN(y) || y < x) return 0;
      return (y - x) / 60000;
    }
    function normName(s) {
      return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' ');
    }

    /* One class is one record. The id used to carry the exact start time of
       whichever device opened it, so the instructor's laptop and every
       trainee's phone each wrote their own record of the same class — and the
       register showed one class as several. The room code and the day are the
       same on every device, so they name the class instead. (The day is the
       device's own calendar day: everyone in a class is in the same place.) */
    function dayOf(t) {
      var v = ms(t);
      var d = isNaN(v) ? new Date() : new Date(v);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }
    function sessionId(code, at) {
      return 'vcs-' + String(code || '').toUpperCase() + '-' + dayOf(at);
    }

    /* Open a session record for a Large Class. */
    function startSession(opts) {
      opts = opts || {};
      return {
        id: opts.id || sessionId(opts.code, opts.startedAt),
        code: String(opts.code || '').toUpperCase(),
        title: opts.title || 'Large Class',
        course: opts.course || '',
        hostName: opts.hostName || '',
        hostRole: opts.hostRole || '',
        startedAt: iso(opts.startedAt),
        endedAt: '',
        locked: !!opts.locked,
        lobby: !!opts.lobby,
        participants: [],
        updatedAt: iso(opts.startedAt)
      };
    }

    /* Find a participant by the conference id, falling back to the display
       name so a reconnection under a new id still lands on the same person. */
    function findParticipant(session, pid, name) {
      var list = (session && session.participants) || [];
      var i;
      for (i = 0; i < list.length; i++) if (pid && list[i].pid === pid) return list[i];
      var n = normName(name);
      if (!n) return null;
      for (i = 0; i < list.length; i++) if (normName(list[i].name) === n) return list[i];
      return null;
    }

    /* Someone joined. Returns the session (mutated) so calls can chain. */
    function recordJoin(session, pid, name, at) {
      if (!session) return session;
      session.participants = session.participants || [];
      var t = iso(at);
      var p = findParticipant(session, pid, name);
      if (!p) {
        p = { pid: pid || '', name: name || 'Participant', stays: [], minutes: 0, firstJoin: t, lastLeave: '' };
        session.participants.push(p);
      }
      p.pid = pid || p.pid;
      if (name) p.name = name;
      if (!p.firstJoin) p.firstJoin = t;
      // An open stay means we never saw the leave — do not open a second one.
      var open = p.stays.length && !p.stays[p.stays.length - 1].left;
      if (!open) p.stays.push({ joined: t, left: '' });
      session.updatedAt = t || session.updatedAt;
      return session;
    }

    /* Someone left. */
    function recordLeave(session, pid, name, at) {
      if (!session) return session;
      var p = findParticipant(session, pid, name);
      if (!p) return session;
      var t = iso(at);
      var last = p.stays[p.stays.length - 1];
      if (last && !last.left) {
        last.left = t;
        p.minutes = Math.round(p.stays.reduce(function (a, s) {
          return a + minutesBetween(s.joined, s.left);
        }, 0) * 10) / 10;
      }
      p.lastLeave = t;
      session.updatedAt = t || session.updatedAt;
      return session;
    }

    /* Close the session. Anyone still in the room is treated as having stayed
       to the end — they did not leave early, the class finished. */
    function endSession(session, at) {
      if (!session) return session;
      var t = iso(at);
      session.endedAt = t;
      (session.participants || []).forEach(function (p) {
        var last = p.stays[p.stays.length - 1];
        if (last && !last.left) { last.left = t; if (!p.lastLeave) p.lastLeave = t; }
        p.minutes = Math.round(p.stays.reduce(function (a, s) {
          return a + minutesBetween(s.joined, s.left);
        }, 0) * 10) / 10;
      });
      session.updatedAt = t || session.updatedAt;
      return session;
    }

    /* The host came back to a class it had left or ended earlier the same
       day. The record carries on — everyone it already holds is kept — and
       says when it reopened, so a copy elsewhere that still shows it ended
       gives way when the two meet (see mergeSessions). */
    function reopenSession(session, at) {
      if (!session) return session;
      var t = iso(at);
      session.reopenedAt = t;
      session.endedAt = '';
      session.updatedAt = t || session.updatedAt;
      return session;
    }

    function isOpen(session) {
      if (!session) return false;
      if (!session.endedAt) return true;
      return !!(session.reopenedAt && session.reopenedAt > session.endedAt);
    }

    /* A record left open by a device that crashed, lost power or simply
       closed the tab would otherwise be "in progress" for ever — and every
       trainee who typed that room code weeks later would be sent into an
       empty hosted room. The host's device touches the record every few
       minutes while the class runs, so an open record that has not moved for
       this long is a class that is over. */
    var STALE_MS = 45 * 60000;
    function isLive(session, now, staleMs) {
      if (!isOpen(session)) return false;
      var last = ms(session.updatedAt || session.startedAt);
      var n = (now == null) ? Date.now() : ms(now);
      if (isNaN(last) || isNaN(n)) return false;
      return (n - last) < (staleMs || STALE_MS);
    }

    /* The running Large Class for a room code, or null. A small room's host
       keeps its join log in this same list (mode 'mesh'), and that log is
       open while the class runs: it is NOT a Large Class. Counting it sent
       every trainee after the first one into an empty hosted room, while the
       instructor waited in the small room for them. */
    function liveFor(list, code, now, staleMs) {
      var want = String(code || '').toUpperCase().trim();
      if (!want) return null;
      var open = (list || []).filter(function (s) {
        return s && s.mode !== 'mesh' && String(s.code || '').toUpperCase() === want && isLive(s, now, staleMs);
      });
      if (!open.length) return null;
      open.sort(function (a, b) { return String(b.startedAt || '').localeCompare(String(a.startedAt || '')); });
      return open[0];
    }

    /* Bring the clock forward on a running class (the host's heartbeat). */
    function touch(session, at) {
      if (session) session.updatedAt = iso(at) || session.updatedAt;
      return session;
    }

    /* Close, at its last activity, every record that was left open and has
       gone stale. Run by a host as it starts a class, so the register stops
       showing old classes as "in progress". Returns how many were closed. */
    function closeStale(list, now, staleMs) {
      var n = 0;
      (list || []).forEach(function (s) {
        if (s && isOpen(s) && !isLive(s, now, staleMs)) {
          endSession(s, s.updatedAt || s.startedAt);
          n++;
        }
      });
      return n;
    }

    /* What the register should show for a record: a stale open record is
       shown as it stood at its last activity, with everyone still in the room
       credited up to then — never as a class everyone attended for 0 minutes.
       Works on a copy; the stored record is untouched. */
    function displayView(session, now, staleMs) {
      if (!session || !isOpen(session) || isLive(session, now, staleMs)) return session;
      var copy = JSON.parse(JSON.stringify(session));
      return endSession(copy, copy.updatedAt || copy.startedAt);
    }

    /* Put one session into the stored list, replacing the copy with the same
       id IN PLACE. A class of 80 records a join or a leave every few seconds;
       re-merging (and deep-copying) every session ever held on each one made
       the host's laptop slower with every class the Centre had run. */
    function upsertSession(list, session) {
      var out = Array.isArray(list) ? list : [];
      if (!session || !session.id) return out;
      for (var i = 0; i < out.length; i++) {
        if (out[i] && out[i].id === session.id) { out[i] = session; return out; }
      }
      out.push(session);
      return out;
    }

    function sessionMinutes(session) {
      if (!session) return 0;
      return Math.round(minutesBetween(session.startedAt, session.endedAt || session.updatedAt) * 10) / 10;
    }

    /* How long someone must have been in the room to count as present. */
    function presentThreshold(session) {
      var total = sessionMinutes(session);
      if (!total) return 0;
      return Math.min(PRESENT_MIN_MINUTES, total * PRESENT_MIN_RATIO);
    }

    /* The register line for a finished session. */
    function summary(session) {
      if (!session) return { code: '', title: '', participants: [], present: 0, partial: 0, minutes: 0 };
      var threshold = presentThreshold(session);
      var rows = (session.participants || []).map(function (p) {
        return { name: p.name, minutes: p.minutes || 0, joins: p.stays.length,
          firstJoin: p.firstJoin, lastLeave: p.lastLeave,
          present: (p.minutes || 0) >= threshold };
      }).sort(function (a, b) { return b.minutes - a.minutes || a.name.localeCompare(b.name); });
      return {
        code: session.code, title: session.title, course: session.course,
        startedAt: session.startedAt, endedAt: session.endedAt,
        minutes: sessionMinutes(session), threshold: Math.round(threshold * 10) / 10,
        participants: rows,
        present: rows.filter(function (r) { return r.present; }).length,
        partial: rows.filter(function (r) { return !r.present; }).length
      };
    }

    /* Match the names people typed in the meeting against the student roster,
       so the Centre sees WHO attended rather than a list of display names.
       Matching is deliberately conservative: exact name, or first+last name. */
    function matchRoster(session, students) {
      var roster = (students || []).filter(Boolean);
      var byName = {};
      roster.forEach(function (s) {
        var n = normName(s.name);
        if (n) byName[n] = s;
        var parts = n.split(' ');
        if (parts.length > 2) byName[parts[0] + ' ' + parts[parts.length - 1]] = s;
      });
      return summary(session).participants.map(function (r) {
        var n = normName(r.name);
        var s = byName[n];
        if (!s) {
          var parts = n.split(' ');
          if (parts.length > 1) s = byName[parts[0] + ' ' + parts[parts.length - 1]];
        }
        return Object.assign({}, r, {
          studentId: s ? s.id : null,
          studentName: s ? s.name : '',
          matched: !!s
        });
      });
    }

    /* Two devices can both be in the same class, and each records what it saw.
       Merge by session id, keeping every participant and the longest record of
       each person's time — never letting one device's shorter view win. */
    function mergeSessions(local, remote) {
      var out = {};
      function put(list) {
        (list || []).forEach(function (s) {
          if (!s || !s.id) return;
          var cur = out[s.id];
          if (!cur) { out[s.id] = JSON.parse(JSON.stringify(s)); return; }
          // Session envelope: earliest start, latest end.
          if (!cur.startedAt || (s.startedAt && s.startedAt < cur.startedAt)) cur.startedAt = s.startedAt;
          if (s.endedAt && (!cur.endedAt || s.endedAt > cur.endedAt)) cur.endedAt = s.endedAt;
          if (s.updatedAt && (!cur.updatedAt || s.updatedAt > cur.updatedAt)) cur.updatedAt = s.updatedAt;
          if (s.reopenedAt && (!cur.reopenedAt || s.reopenedAt > cur.reopenedAt)) cur.reopenedAt = s.reopenedAt;
          if (!cur.course && s.course) cur.course = s.course;
          if (!cur.hostName && s.hostName) cur.hostName = s.hostName;
          cur.locked = cur.locked || s.locked;
          cur.lobby = cur.lobby || s.lobby;
          (s.participants || []).forEach(function (p) {
            var m = findParticipant(cur, p.pid, p.name);
            if (!m) { cur.participants.push(JSON.parse(JSON.stringify(p))); return; }
            if ((p.minutes || 0) > (m.minutes || 0)) { m.minutes = p.minutes; m.stays = JSON.parse(JSON.stringify(p.stays || [])); }
            if (p.firstJoin && (!m.firstJoin || p.firstJoin < m.firstJoin)) m.firstJoin = p.firstJoin;
            if (p.lastLeave && (!m.lastLeave || p.lastLeave > m.lastLeave)) m.lastLeave = p.lastLeave;
            if (!m.pid && p.pid) m.pid = p.pid;
          });
        });
      }
      put(local);
      put(remote);
      // Reopened after the latest end anybody saw: the class is running again.
      Object.keys(out).forEach(function (k) {
        var s = out[k];
        if (s.reopenedAt && s.endedAt && s.reopenedAt > s.endedAt) s.endedAt = '';
      });
      return Object.keys(out).map(function (k) { return out[k]; })
        .sort(function (a, b) { return String(b.startedAt).localeCompare(String(a.startedAt)); });
    }

    /* The room password for a Large Class. Derived from the room code so every
       device already holds it — trainees never have to be told a second secret,
       but nobody who merely guesses the room URL can walk in. */
    function roomPassword(code, salt) {
      var c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!c) return '';
      var s = String(salt || 'CESTIS');
      var h = 0, i;
      var seed = s + '|' + c;
      for (i = 0; i < seed.length; i++) { h = ((h << 5) - h + seed.charCodeAt(i)) | 0; }
      var alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      var x = Math.abs(h);
      for (i = 0; i < 6; i++) { out += alpha[x % alpha.length]; x = Math.floor(x / alpha.length) + 7 * (i + 1); }
      return out;
    }

    return {
      PRESENT_MIN_RATIO: PRESENT_MIN_RATIO,
      PRESENT_MIN_MINUTES: PRESENT_MIN_MINUTES,
      STALE_MS: STALE_MS,
      sessionId: sessionId,
      startSession: startSession,
      reopenSession: reopenSession,
      isOpen: isOpen,
      isLive: isLive,
      liveFor: liveFor,
      touch: touch,
      closeStale: closeStale,
      displayView: displayView,
      upsertSession: upsertSession,
      recordJoin: recordJoin,
      recordLeave: recordLeave,
      endSession: endSession,
      sessionMinutes: sessionMinutes,
      presentThreshold: presentThreshold,
      summary: summary,
      matchRoster: matchRoster,
      mergeSessions: mergeSessions,
      roomPassword: roomPassword
    };
  })();

  /* ==========================================================================
     THE BUILT-IN CONFERENCE ROOM — the rules, without the browser

     The peer-to-peer room has no server of its own to decide anything: every
     decision — who may join, whose instructions to obey, who sends video to
     whom, how long to wait before trying the introduction service again — is
     taken in each participant's browser. These are those decisions, kept here
     so they are the same on every device and can be tested.
     ========================================================================== */
  Core.vcRoom = (function () {
    /* Room codes. Six characters drawn with Math.random could be guessed —
       and a room code is the only key to a class. Ten characters from a
       32-letter alphabet (no 0/O or 1/I to misread) is about 10^15
       possibilities, drawn from the browser's cryptographic generator.
       Codes already handed out (six characters) keep working. */
    var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var CODE_LENGTH = 10;
    var CODE_MIN = 4, CODE_MAX = 16;

    /* randomBytes(n) -> n integers 0..255 (crypto.getRandomValues in a page).
       32 divides 256, so taking each byte modulo 32 is unbiased. */
    function generateCode(randomBytes, length) {
      var n = length || CODE_LENGTH;
      var bytes = randomBytes(n);
      var out = '';
      for (var i = 0; i < n; i++) out += CODE_ALPHABET[(bytes[i] & 255) % CODE_ALPHABET.length];
      return out;
    }
    /* What somebody typed, as a code: upper case, spaces and dashes dropped. */
    function normaliseCode(text) {
      return String(text == null ? '' : text).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    function isValidCode(code) {
      var c = normaliseCode(code);
      return c.length >= CODE_MIN && c.length <= CODE_MAX && c === String(code);
    }
    function hostPeerId(code) { return 'cestis-' + normaliseCode(code) + '-host'; }

    /* Instructions only the room's host may give. Every participant holds a
       connection to every other, so without this check any trainee could end
       the class for everybody, mute the instructor or remove classmates from
       the browser console. The host itself never takes these from anyone. */
    var HOST_ONLY = {
      'end-meeting': 1, 'kick': 1, 'force-mute': 1, 'force-unmute': 1, 'mute-all': 1,
      'force-cam-off': 1, 'promote-host': 1, 'demote-host': 1, 'permission-update': 1,
      'room-full': 1, 'access-denied': 1, 'peer-list': 1, 'new-peer': 1, 'peer-left': 1,
      'peer-kicked': 1, 'peer-muted': 1, 'peer-unmuted': 1, 'peer-name': 1, 'cohost': 1,
      'screen-share-started': 1, 'screen-share-stopped': 1
    };
    /* Messages the host accepts from a co-host it appointed, and acts on. */
    var COHOST_TO_HOST = { 'cohost-action': 1 };

    /* Should this message be acted on?
       ctx: { amHost, hostId, fromId, admitted, coHost }
         admitted — the sender has been let into the room (by this host, or
                    announced by the host to this participant)
         coHost   — the host appointed the sender as co-host */
    function acceptFrom(type, ctx) {
      ctx = ctx || {};
      if (type === 'name') return true;              // how a newcomer introduces itself
      if (ctx.amHost) {
        if (HOST_ONLY[type]) return false;           // nobody instructs the host
        if (!ctx.admitted) return false;             // not in the room yet
        if (COHOST_TO_HOST[type]) return !!ctx.coHost;
        return true;
      }
      if (HOST_ONLY[type]) return !!ctx.hostId && ctx.fromId === ctx.hostId;
      if (COHOST_TO_HOST[type]) return false;
      return ctx.fromId === ctx.hostId || !!ctx.admitted;
    }

    /* The room code is a convenience, not a password: it travels in
       notifications, backups and invitations. A staff meeting marked Admin
       Only is closed to everybody else whatever code they hold.
       meeting — the scheduled admin meeting for this code, if there is one. */
    function canJoinMeeting(meeting, role) {
      if (!meeting) return { allowed: true, reason: '' };
      var access = meeting.access === 'allstaff' ? 'allstaff' : 'adminonly';
      var staff = role === 'admin' || role === 'adminstaff';
      if (access === 'adminonly' && !staff) {
        return { allowed: false, reason: 'This meeting is for the Administration only.' };
      }
      if (access === 'allstaff' && !(staff || role === 'instructor')) {
        return { allowed: false, reason: 'This meeting is for staff only.' };
      }
      return { allowed: true, reason: '' };
    }

    /* Two participants learn about each other at the same moment (the host
       tells the newcomer about everyone, and everyone about the newcomer), so
       both used to dial — two connections and two video streams for every
       pair. Exactly one of them dials: the lower id. */
    function shouldInitiate(myId, theirId) { return String(myId) < String(theirId); }

    /* Who sends video to whom. Trainees see only the instructor (and
       themselves), so a trainee's camera going to every classmate was upload
       spent on tiles nobody shows — on a phone, the difference between a
       class that works and one that breaks up. Trainees still HEAR each other
       (a question asked aloud), so audio goes to everyone — but a muted
       microphone sends nothing at all (see sendSound), so the classroom
       stays a classroom without everyone paying for everyone's silence. */
    function mediaPlan(opts) {
      opts = opts || {};
      var video = !!(opts.amHost || opts.peerIsHost);
      return { sendVideo: video, receiveVideo: video, sendAudio: true, receiveAudio: true };
    }

    /* How each person's camera and microphone start. Trainees join from home
       on phones with mobile data: their camera starts OFF and their
       microphone MUTED, with buttons to turn either on. Staff (the
       instructor running the class, a staff meeting) start as before. */
    function startDevices(role) {
      var trainee = role === 'student';
      return { camera: !trainee, mic: !trainee };
    }

    /* Should sound be sent at all? A browser keeps sending a switched-off
       microphone as silence — 50 packets a second, about 40 kbit/s (18 MB an
       hour) to EVERY other person in the room, measured in Chromium — so a
       muted microphone stops its sender instead. A shared tab's sound (mixed
       with the microphone while sharing) still has to go out. */
    function sendSound(micOn, sharingSound) {
      return !!(micOn || sharingSound);
    }

    /* Class recordings. With no bitrate set, Chromium records at about
       2.5 Mbit/s — up to ~1.1 GB an hour of class. 550 kbit/s of picture (the
       1280x720, 15 frames-a-second stage) and 64 kbit/s of sound is about
       276 MB an hour, and a whiteboard or a demonstration stays legible. */
    var RECORDING_VIDEO_BPS = 550000;
    var RECORDING_AUDIO_BPS = 64000;
    function recorderOptions(mimeType) {
      var o = { videoBitsPerSecond: RECORDING_VIDEO_BPS, audioBitsPerSecond: RECORDING_AUDIO_BPS };
      if (mimeType) o.mimeType = mimeType;
      return o;
    }
    /* Megabytes (1,000,000 bytes) an hour of recording at those rates. */
    function recordingMBPerHour() {
      return Math.round((RECORDING_VIDEO_BPS + RECORDING_AUDIO_BPS) / 8 * 3600 / 1e6);
    }

    /* How much picture each device sends. A phone filming at 720p for a tile
       the size of a thumbnail costs data and battery for nothing.
       opts: { mobile, host, peers }  ->  { width, height, frameRate, maxBitrate } */
    function videoProfile(opts) {
      opts = opts || {};
      var p;
      if (opts.host) {
        p = opts.mobile ? { width: 960, height: 540, frameRate: 24 } : { width: 1280, height: 720, frameRate: 30 };
        // The host uploads one copy per participant: share a fixed budget.
        var n = Math.max(1, Math.floor(opts.peers || 1));
        p.maxBitrate = Math.max(250000, Math.min(1200000, Math.floor(5000000 / n)));
      } else if (opts.mobile) {
        p = { width: 640, height: 360, frameRate: 24, maxBitrate: 350000 };
      } else {
        p = { width: 960, height: 540, frameRate: 24, maxBitrate: 600000 };
      }
      return p;
    }

    /* Wait before reconnecting to the introduction service: 1 s, 2 s, 4 s ...
       up to 30 s, spread a little so a room full of browsers does not knock
       on a recovering service all at the same instant. rand in [0,1). */
    function backoffDelay(attempt, rand) {
      var a = Math.max(0, Math.floor(attempt || 0));
      var base = Math.min(30000, 1000 * Math.pow(2, Math.min(a, 15)));
      var r = (typeof rand === 'number' && rand >= 0 && rand < 1) ? rand : 0.5;
      return Math.round(base * (0.75 + 0.5 * r));
    }

    /* Relay (TURN) servers the Centre configured in Settings, one per line:
         turn:relay.example.org:3478 username password
         turns:relay.example.org:5349 username password
         stun:stun.example.org:3478
       Returns { servers: [...], errors: [line numbers] }. Nothing here is
       ever committed: the Centre types its own server and credentials. */
    function parseIceServers(text) {
      var out = { servers: [], errors: [] };
      String(text == null ? '' : text).split(/\r?\n/).forEach(function (line, i) {
        var t = line.trim();
        if (!t || t.charAt(0) === '#') return;
        var parts = t.split(/\s+/);
        var url = parts[0];
        if (!/^(turns?|stun):[^\s]+$/i.test(url)) { out.errors.push(i + 1); return; }
        var entry = { urls: url };
        if (/^turns?:/i.test(url)) {
          if (parts.length < 3) { out.errors.push(i + 1); return; }
          entry.username = parts[1];
          entry.credential = parts.slice(2).join(' ');
        }
        out.servers.push(entry);
      });
      return out;
    }
    /* The list handed to each connection: a few public STUN servers, then the
       Centre's own relays. Browsers slow down with a long list, so it is
       capped. */
    var ICE_MAX = 6;
    function iceServers(stunDefaults, configuredText) {
      var mine = parseIceServers(configuredText).servers.slice(0, ICE_MAX - 1);
      var stun = (stunDefaults || []).slice(0, Math.max(1, ICE_MAX - mine.length));
      return stun.concat(mine);
    }
    function hasRelay(configuredText) {
      return parseIceServers(configuredText).servers.some(function (s) { return /^turns?:/i.test(s.urls); });
    }

    /* The Large Class server address the Centre typed. Must be https (a
       conference page will not get a camera otherwise). meet.jit.si is
       allowed but flagged: it no longer supports embedding for real classes. */
    function checkLargeRoomBase(text) {
      var raw = String(text == null ? '' : text).trim();
      if (!raw) return { ok: true, base: '', publicJitsi: true, reason: '' };
      if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
      var m = /^(https?):\/\/([^\/\s?#]+)(\/[^\s?#]*)?$/i.exec(raw);
      if (!m) return { ok: false, base: '', publicJitsi: false, reason: 'That address could not be read.' };
      if (m[1].toLowerCase() !== 'https') return { ok: false, base: '', publicJitsi: false, reason: 'The Large Class video server must be an https:// address.' };
      var host = m[2].toLowerCase();
      var path = (m[3] || '/').replace(/\/+$/, '') + '/';
      return { ok: true, base: 'https://' + host + path, publicJitsi: host === 'meet.jit.si', reason: '' };
    }

    /* The scheduled class session a room code belongs to. A code is unique to
       its session, but prefer today's if a code was ever reused. */
    function findClassSession(sessions, code, today) {
      var c = normaliseCode(code);
      if (!c) return null;
      var hits = (sessions || []).filter(function (s) { return s && normaliseCode(s.roomCode) === c; });
      if (!hits.length) return null;
      var t = hits.filter(function (s) { return s.date === today; });
      if (t.length) return t[0];
      hits.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
      return hits[0];
    }
    /* scheduled -> live -> completed, on the one record, stamped so the
       newest-edit-wins merge carries it to every other device. Returns the
       record changed, or null when nothing changed. */
    function setSessionStatus(sessions, code, status, now, today) {
      var s = findClassSession(sessions, code, today);
      if (!s || s.status === status) return null;
      s.status = status;
      s.updatedAt = now;
      if (status === 'live' && !s.startedLiveAt) s.startedLiveAt = now;
      if (status === 'completed') s.completedAt = now;
      return s;
    }
    /* A finished recording, linked to its class so trainees find it under
       Past Recordings. A class still running stays 'live'; it is shown once
       the host closes it. info: { url, fileId, name } */
    function attachRecording(sessions, code, info, now, today) {
      var s = findClassSession(sessions, code, today);
      if (!s || !info || !info.url) return null;
      s.recordingUrl = info.url;
      if (info.fileId) s.recordingDriveId = info.fileId;
      if (info.name) s.recordingName = info.name;
      if (s.status !== 'live') s.status = 'completed';
      s.updatedAt = now;
      return s;
    }

    return {
      CODE_ALPHABET: CODE_ALPHABET, CODE_LENGTH: CODE_LENGTH, CODE_MIN: CODE_MIN, CODE_MAX: CODE_MAX,
      HOST_ONLY: HOST_ONLY,
      generateCode: generateCode,
      normaliseCode: normaliseCode,
      isValidCode: isValidCode,
      hostPeerId: hostPeerId,
      acceptFrom: acceptFrom,
      canJoinMeeting: canJoinMeeting,
      shouldInitiate: shouldInitiate,
      mediaPlan: mediaPlan,
      startDevices: startDevices,
      sendSound: sendSound,
      RECORDING_VIDEO_BPS: RECORDING_VIDEO_BPS,
      RECORDING_AUDIO_BPS: RECORDING_AUDIO_BPS,
      recorderOptions: recorderOptions,
      recordingMBPerHour: recordingMBPerHour,
      videoProfile: videoProfile,
      backoffDelay: backoffDelay,
      parseIceServers: parseIceServers,
      iceServers: iceServers,
      hasRelay: hasRelay,
      checkLargeRoomBase: checkLargeRoomBase,
      findClassSession: findClassSession,
      setSessionStatus: setSessionStatus,
      attachRecording: attachRecording
    };
  })();

  /* ==========================================================================
     UI RULES — the small decisions the dashboard's accessibility layer makes
     the same way everywhere.

     Most of the dashboard's controls are <div onclick> and <span onclick>:
     every sidebar item, every section toggle, the quick-action tiles, the
     cloud menu. None of them could be reached with the Tab key, so a person
     who cannot use a mouse (a screen-reader user, an injured wrist, a tablet
     with a keyboard) could sign in and then go nowhere. Rewriting hundreds of
     call sites was never going to stay done, so index.html marks them up as
     they appear; keyboardRoleFor() decides, for one element, whether it is a
     control and what it should be announced as.

     toastPolicy() and alertKind() decide how long a message stays and how it
     is announced; liveSessionsFor() is the only thing allowed to light the
     sidebar's LIVE badge — it used to be printed on every page load whether a
     class was running or not, so people learned to ignore it.
     ========================================================================== */
  Core.ui = (function () {
    // Already keyboard controls by themselves (or not controls at all).
    var NATIVE = { BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, OPTION: 1, SUMMARY: 1, LABEL: 1,
                   IFRAME: 1, VIDEO: 1, AUDIO: 1, BODY: 1, HTML: 1, FORM: 1 };
    // A clickable table row keeps its table meaning; it only needs to be reachable.
    var TABLE_PARTS = { TR: 1, TD: 1, TH: 1 };
    // Roles that already say "this is a control": keep them, add the Tab stop.
    var CONTROL_ROLES = { button: 1, link: 1, tab: 1, menuitem: 1, option: 1, checkbox: 1, radio: 1,
                          'switch': 1, treeitem: 1, menuitemradio: 1, menuitemcheckbox: 1 };
    // Containers and live regions: never turned into buttons.
    var CONTAINER_ROLES = { presentation: 1, none: 1, dialog: 1, alertdialog: 1, document: 1, application: 1,
                            region: 1, main: 1, navigation: 1, banner: 1, status: 1, alert: 1, log: 1,
                            list: 1, listbox: 1, grid: 1, table: 1, menu: 1, menubar: 1, tablist: 1, group: 1 };

    function classTokens(cls) {
      return String(cls == null ? '' : cls).split(/\s+/).filter(Boolean);
    }

    /* attrs: the element's attributes as plain strings (onclick, role,
       tabindex, href, class, contenteditable). Returns null when the element
       must be left alone, otherwise { tabindex:'0', role, expanded } where
       role is null when the element's own role or table meaning stands, and
       expanded is true/false only for a section toggle. */
    function keyboardRoleFor(tagName, attrs) {
      var tag = String(tagName || '').toUpperCase();
      var a = attrs || {};
      var click = a.onclick == null ? '' : String(a.onclick);
      if (!click.trim()) return null;
      if (NATIVE[tag]) return null;
      if (tag === 'A' && a.href != null) return null;
      // The page already decided where (or whether) it sits in the Tab order.
      if (a.tabindex != null && String(a.tabindex) !== '') return null;
      if (a.contenteditable != null && String(a.contenteditable).toLowerCase() !== 'false') return null;
      // Only keeps a click inside a dialog from reaching its backdrop.
      if (/^\s*(?:event|e)\.stopPropagation\(\)\s*;?\s*$/.test(click)) return null;
      // A backdrop that closes its dialog when clicked beside the box. The
      // dialog has its own close button; a Tab stop on the backdrop would only
      // be a trap that closes everything on Enter.
      if (/(?:event|e)\.target\s*={2,3}\s*this\b/.test(click)) return null;
      var tokens = classTokens(a['class']);
      if (tokens.some(function (t) { return /(^|-)(overlay|backdrop)$/.test(t); })) return null;
      var role = String(a.role == null ? '' : a.role).trim().toLowerCase();
      if (role && CONTAINER_ROLES[role]) return null;
      var out = { tabindex: '0', role: null, expanded: null };
      if (role && CONTROL_ROLES[role]) return out;
      if (TABLE_PARTS[tag]) return out;
      if (tokens.indexOf('nav-section-toggle') !== -1) {
        out.role = 'button';
        out.expanded = tokens.indexOf('collapsed') === -1;
        return out;
      }
      // Sidebar entries and bare <a onclick> take you somewhere: links.
      out.role = (tokens.indexOf('nav-item') !== -1 || tag === 'A') ? 'link' : 'button';
      return out;
    }

    /* How long a toast stays, and how it is announced. Errors are announced
       at once (role=alert) and stay long enough to read twice; everything
       else is a polite status. ms is the time on screen while nobody is
       pointing at or focused on it (the page pauses the clock meanwhile). */
    function toastPolicy(type) {
      switch (type) {
        case 'error': return { role: 'alert', live: 'assertive', ms: 20000 };
        case 'warning': return { role: 'status', live: 'polite', ms: 10000 };
        case 'info': return { role: 'status', live: 'polite', ms: 6000 };
        default: return { role: 'status', live: 'polite', ms: 4000 };
      }
    }

    /* Which icon a styled alert() shows. It used to show the warning sign on
       every message — "Merge from cloud completed!" included. The messages
       already say what they are with their first character. */
    function alertKind(msg) {
      var s = String(msg == null ? '' : msg).replace(/^\s+/, '');
      if (/^(?:✅|✔|✓|☑|🎉)/.test(s)) return 'success';      // ✅ ✔ ✓ ☑ 🎉
      if (/^(?:❌|✗|✘|⛔|🚫|❗)/.test(s)) return 'error';  // ❌ ✗ ✘ ⛔ 🚫 ❗
      if (/^(?:ℹ|💡)/.test(s)) return 'info';                               // ℹ 💡
      return 'warning';
    }

    /* The class sessions that are live today and that this viewer may join.
       viewer: { role, course, name }. matchCourse(sessionCourse, viewerCourse)
       is the page's own course comparison (a session for "Welding Level 2"
       belongs to a trainee on "Welding"); a plain case-insensitive compare is
       used when none is given. A session left 'live' from an earlier day (the
       host's tab closed without ending it) is not live. */
    function liveSessionsFor(sessions, viewer, today, matchCourse) {
      var v = viewer || {};
      var same = typeof matchCourse === 'function' ? matchCourse : function (a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
      };
      return (Array.isArray(sessions) ? sessions : []).filter(function (s) {
        if (!s || s.status !== 'live' || !today || s.date !== today) return false;
        if (v.role === 'admin' || v.role === 'adminstaff') return true;
        if (v.role === 'student') return !!v.course && !!same(s.course, v.course);
        if (v.role === 'instructor') {
          return (!!v.course && !!same(s.course, v.course)) || (!!v.name && s.createdBy === v.name);
        }
        return false;
      });
    }

    /* The one small "is my work safe?" answer the top bar shows (the sync
       health chip). It only READS what the sync code already knows — it
       decides nothing about saving. The chip used to say "Connected" or "Not
       connected", so nobody could tell that their last edits existed only on
       this computer (an expired sign-in, a failing upload, a dropped
       connection) — exactly when a sign-out or a swapped PC loses work.
       Every word it returns is neutral, by the owner's rule: it says whether
       this computer's work has synced and what to do, never where it syncs to
       or from (no Cloud, Google, Drive, the Centre's server or network) —
       the lan/connected inputs change which answer is given, not its words.
       s: {
         now            ms
         online         the browser believes it has a network (navigator.onLine)
         lan            served by the Centre's own server (the Offline System)
         lanTrouble     on that network, saves are not reaching the server
         connected      a Google sign-in this device may still use
         tokenExpiresAt ms when that sign-in ends (or null)
         pending        work saved on this device that has not been uploaded
         pendingSince   ms of the first such save (or null)
         failures       uploads that have failed in a row
         lastSavedAt    ms of the last upload that went through (or null)
         staff          false for a role whose devices are not signed in for
                        syncing (a trainee, the CMC board): not being
                        connected is normal for them, never a warning
         ownPending     (staff false) their own work not sent yet — a
                        trainee's exam result still in the exam outbox
         signinExpired  (staff) the sync sign-in this computer had has run out
         canConnect     the panel below the answer holds a Turn On Sync button
       }
       Returns { state: 'saved'|'waiting'|'offline'|'attention', tone:
       'ok'|'warn'|'bad', icon: 'check'|'sync', label, chip (the label's
       words before its dash), detail, lastSaved, advice: [] }. Times are written by fmt(ms) — the page passes its own
       clock format; HH:MM by default. No count is given for changes waiting:
       the platform saves whole collections, so the only numbers it has count
       internal files, not anyone's edits. */
    function syncHealth(s, fmt) {
      s = s || {};
      var now = typeof s.now === 'number' ? s.now : Date.now();
      var hhmm = typeof fmt === 'function' ? fmt : function (ms) {
        var d = new Date(ms); var h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
      };
      function ago(ms) {
        var mins = Math.max(0, Math.round((now - ms) / 60000));
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        var hrs = Math.round(mins / 60);
        if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
        var days = Math.round(hrs / 24);
        return days + (days === 1 ? ' day ago' : ' days ago');
      }
      var last = s.lastSavedAt ? ('Last synced ' + hhmm(s.lastSavedAt) + ' (' + ago(s.lastSavedAt) + ')') : 'Not synced since this page was opened';
      var since = s.pendingSince ? ' since ' + hhmm(s.pendingSince) : '';
      var keepNote = 'Do not clear this browser’s data until this says All saved.';
      var out;
      if (s.staff === false) {
        /* A trainee's (or a board member's) device is not signed in for
           syncing, and that is normal: it used to show the same red "needs
           attention" as an administrator whose sign-in had run out. Only their
           own unsent work is worth a word — amber, never red. */
        out = s.ownPending
          ? { state: 'waiting', tone: 'warn', label: 'Waiting to send — your work is kept on this computer',
              detail: 'Your latest work is kept on this computer and is sent by itself as soon as it can sync.',
              advice: ['Nothing to do — keep working; nothing is lost.', 'If this stays for more than a day, ask the office.', keepNote] }
          : { state: 'saved', tone: 'ok', label: 'All saved', detail: 'Nothing of yours is waiting to be sent.', advice: [] };
        out.icon = out.state === 'saved' ? 'check' : 'sync';
        out.chip = out.label.split(' — ')[0];
        out.lastSaved = '';
        return out;
      }
      if (s.lan ? s.lanTrouble : s.online === false) {
        // Offline is not a fault: amber, with or without changes waiting.
        out = { state: 'offline', tone: 'warn', label: 'Not synced yet — your work is kept on this computer',
          detail: s.pending ? 'Your changes' + since + ' are kept on this computer and have not synced yet.'
                            : 'This computer cannot sync right now. Anything you change is kept on it.',
          advice: ['Keep working — your changes sync by themselves as soon as this computer can sync again.',
                   'If this does not clear in a few minutes, ask the office.', keepNote] };
      } else if (!s.lan && !s.connected) {
        // Red only when the sign-in this computer had has run out (or saves
        // are failing); a computer not yet set up for syncing is amber.
        out = { state: 'attention', tone: (s.signinExpired || (s.failures || 0) >= 1) ? 'bad' : 'warn', label: 'Sync needs attention — ask the office',
          detail: (s.signinExpired ? 'The sync sign-in on this computer has expired. ' : '') +
                  (s.pending ? 'Your changes' + since + ' are kept on this computer only and have not synced.'
                             : 'This computer is not syncing at the moment.'),
          advice: [!s.canConnect ? 'Ask the office to set up syncing on this computer.'
                   : s.signinExpired ? 'Press Turn On Sync below to sign in again, or ask the office.'
                   : 'Press Turn On Sync below, or ask the office to set up syncing on this computer.', keepNote] };
      } else if (s.pending) {
        var failing = (s.failures || 0) >= 1;
        out = { state: 'waiting', tone: failing ? 'bad' : 'warn', label: 'Changes waiting to sync',
          detail: failing ? 'The last sync did not go through; it is tried again every few seconds.'
                          : 'Your latest changes' + since + ' are syncing now.',
          advice: failing ? ['If this stays for more than a few minutes, ask the office.', keepNote]
                          : ['Nothing to do — this turns to All saved once they have synced.'] };
      } else {
        out = { state: 'saved', tone: 'ok', label: 'All saved',
          detail: 'Everything on this computer has synced.', advice: [] };
      }
      out.icon = out.state === 'saved' ? 'check' : 'sync';
      // The chip itself shows the words before the dash ("Not synced yet");
      // the whole sentence heads its panel and is what a screen reader hears.
      // The full sentences do not all fit a laptop's top bar beside Lock and
      // Sign Out.
      out.chip = out.label.split(' — ')[0];
      out.lastSaved = last;
      // A sign-in about to end: say so while there is still time to renew it.
      if (!s.lan && s.connected && s.tokenExpiresAt && s.tokenExpiresAt - now < 10 * 60000 && s.tokenExpiresAt > now) {
        out.advice = out.advice.concat(['Syncing on this computer must be renewed by ' + hhmm(s.tokenExpiresAt) + ' — ask the office before then.']);
        if (out.tone === 'ok') out.tone = 'warn';
      }
      return out;
    }

    /* The chip's icon: a check once everything has synced, circular arrows
       otherwise — a neutral sign of syncing, never a cloud. Fixed markup (no
       input reaches it), coloured by the chip's tone through currentColor. */
    var SYNC_ICONS = {
      check: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      sync: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>'
    };
    function syncIcon(name) { return SYNC_ICONS[name] || SYNC_ICONS.sync; }

    return {
      keyboardRoleFor: keyboardRoleFor,
      toastPolicy: toastPolicy,
      alertKind: alertKind,
      liveSessionsFor: liveSessionsFor,
      syncHealth: syncHealth,
      syncIcon: syncIcon
    };
  })();

  /* ==========================================================================
     CERTIFICATE TEMPLATE RULES

     Every certificate must come out looking the same. A template carries two
     kinds of data:
       - the LOOK: background images, text positions/sizes, body wording,
         signature titles, contact details. This is identical for every course
         and is inherited from the FIRST template that was set up, so a newly
         added course is already correct without re-doing the layout.
       - the CONTENT: course name, code, modules/clusters, competencies. This
         is per-course and is never inherited.

     Full-time courses call their units CLUSTERS, short courses call them
     MODULES, so the Page 2 heading follows the course type automatically.

     "Technical Competencies Achieved" is derived from the course's own units
     when it has not been filled in by hand, so no certificate goes out with an
     empty competencies column.
     ========================================================================== */
  Core.certTemplate = (function () {
    /* Fields that define the LOOK — copied from the base template to every
       other one. Deliberately excludes course-specific content. */
    var LOOK_FIELDS = [
      'bgPage1', 'bgPage2', 'textPositions', 'bodyText',
      'signatureLeft', 'signatureRight', 'contactEmail', 'contactPhone'
    ];

    function isFullTime(courseType) {
      return /full\s*-?\s*time/i.test(String(courseType || ''));
    }
    /* Page 2 heading: CLUSTERS for full-time programmes, MODULES otherwise. */
    function unitHeading(courseType) {
      return isFullTime(courseType) ? 'CLUSTERS COMPLETED' : 'MODULES COMPLETED';
    }
    /* Singular label used in the editor and elsewhere ("Cluster 1" / "Module 1"). */
    function unitLabel(courseType) {
      return isFullTime(courseType) ? 'Cluster' : 'Module';
    }
    function unitLabelPlural(courseType) {
      return isFullTime(courseType) ? 'Clusters' : 'Modules';
    }

    function clone(v) {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(clone);
      var o = {};
      Object.keys(v).forEach(function (k) { o[k] = clone(v[k]); });
      return o;
    }

    /* Copy the LOOK of `base` onto `target`, leaving the target's own course
       content alone. Existing look values on the target are replaced, so
       "apply to all" genuinely makes every certificate match. */
    function applyLook(base, target) {
      var out = clone(target || {});
      if (!base) return out;
      LOOK_FIELDS.forEach(function (f) {
        if (base[f] !== undefined && base[f] !== null && base[f] !== '') out[f] = clone(base[f]);
      });
      return out;
    }

    /* A brand-new course template: the base template's look, with only the
       course's own identity filled in. */
    function newFromBase(base, courseName) {
      var t = applyLook(base, {});
      t.courseFullName = courseName || '';
      t.courseType = (base && base.courseType) || 'Short Course';
      t.programmeCode = '';
      t.version = (base && base.version) || '1.0';
      t.developedDate = (base && base.developedDate) || '';
      t.programmeSpecs = clone((base && base.programmeSpecs) || {});
      t.modules = [];
      t.competencies = [];
      t.inheritedFromBase = true;
      return t;
    }

    /* Which template is the "first certificate created" whose look everything
       else follows? The one explicitly marked as base, else the earliest
       created, else the first key with a background image (a real, set-up
       template), else simply the first. */
    function pickBaseKey(templates, explicitKey) {
      if (!templates || typeof templates !== 'object') return null;
      var keys = Object.keys(templates);
      if (!keys.length) return null;
      if (explicitKey && templates[explicitKey]) return explicitKey;
      var marked = keys.filter(function (k) { return templates[k] && templates[k].isBaseTemplate; });
      if (marked.length) return marked[0];
      var dated = keys.filter(function (k) { return templates[k] && templates[k].createdAt; });
      if (dated.length) {
        dated.sort(function (a, b) { return String(templates[a].createdAt).localeCompare(String(templates[b].createdAt)); });
        return dated[0];
      }
      var withBg = keys.filter(function (k) { return templates[k] && (templates[k].bgPage1 || templates[k].bgPage2); });
      if (withBg.length) return withBg[0];
      return keys[0];
    }

    /* Push the base template's look onto every other template. Returns the new
       templates object plus the list of keys that changed. */
    function applyLookToAll(templates, baseKey) {
      var out = {}, changed = [];
      if (!templates || typeof templates !== 'object') return { templates: out, changed: changed };
      var bk = pickBaseKey(templates, baseKey);
      var base = bk ? templates[bk] : null;
      Object.keys(templates).forEach(function (k) {
        if (k === bk) { out[k] = clone(templates[k]); return; }
        var before = JSON.stringify(templates[k]);
        var applied = applyLook(base, templates[k]);
        out[k] = applied;
        if (JSON.stringify(applied) !== before) changed.push(k);
      });
      return { templates: out, baseKey: bk, changed: changed };
    }

    /* Derive "Technical Competencies Achieved" from the course's own units.
       Each unit (module/cluster) becomes a competency category, and its topics
       become the competencies demonstrated under it. Used only when the
       template has no hand-written competencies, so manual entries always win. */
    function deriveCompetencies(modules, existing, courseType) {
      if (Array.isArray(existing) && existing.length) return clone(existing);
      var mods = Array.isArray(modules) ? modules : [];
      if (!mods.length) return [];
      var label = unitLabel(courseType);
      var out = [];
      mods.forEach(function (m, i) {
        if (!m) return;
        var name = (typeof m === 'string') ? m : (m.name || m.title || (label + ' ' + (i + 1)));
        var topics = (m && Array.isArray(m.topics)) ? m.topics.filter(Boolean) : [];
        out.push({
          category: name,
          // Without topics the competency is still meaningful: the trainee is
          // competent in the unit itself.
          items: topics.length ? topics.slice() : ['Competent in ' + name],
          derived: true
        });
      });
      return out;
    }

    /* Everything Page 2 needs, with the course-type rules already applied. */
    function page2Content(tpl) {
      var t = tpl || {};
      return {
        unitHeading: unitHeading(t.courseType),
        unitLabel: unitLabel(t.courseType),
        modules: Array.isArray(t.modules) ? t.modules : [],
        competencies: deriveCompetencies(t.modules, t.competencies, t.courseType)
      };
    }

    return {
      LOOK_FIELDS: LOOK_FIELDS,
      isFullTime: isFullTime,
      unitHeading: unitHeading,
      unitLabel: unitLabel,
      unitLabelPlural: unitLabelPlural,
      applyLook: applyLook,
      newFromBase: newFromBase,
      pickBaseKey: pickBaseKey,
      applyLookToAll: applyLookToAll,
      deriveCompetencies: deriveCompetencies,
      page2Content: page2Content
    };
  })();

  /* ==========================================================================
     CERTIFICATES — numbers, issuing and withdrawing, eligibility, signatures

     WHY THIS EXISTS
     ---------------
     A certificate was issued in three places, each with its own rules. The
     Student Progress page — the one the administrator actually uses — drew
     four RANDOM digits every time "Certified" was saved, so re-saving a
     trainee whose certificate was already printed gave them a new number and
     the paper stopped verifying; two trainees of one programme shared a number
     about one cohort in five; an intake key ("02. Electrical") became the
     prefix; and moving a trainee back to In Training left the certificate on
     the record, where the approvals reconcile promoted them straight back.
     The dashboard's own (correct) rules sat in a function nothing called.

     Every path now goes through this one place:
       ensureNumber(s, ctx)   the number a certificate carries: the one it was
                              issued if it has one — a number, once issued,
                              NEVER changes — else the one it carried before a
                              withdrawal, else the approved one, else a new one;
       applyStage(s, stage)   the Update Stage rule, for every page;
       revoke(s, approvals)   withdrawal keeps the number (as an alias) and the
                              history, and stamps when, who and why, so the
                              certificate verifies as REVOKED rather than
                              vanishing — and so the decision outlives a sync.

     New numbers are PREFIX-YEAR-NNNN-XX: the four digits and two letters are
     derived from the trainee (the natural key their stable id is made from),
     so every device mints the same number for the same person, and the space
     is wide enough (5.2 million per prefix and year) that two people meeting
     on one number is a practical impossibility rather than a one-in-five
     event. Numbers already issued in the old PREFIX-YEAR-NNNN form are never
     touched: they stay exactly as printed.
     ========================================================================== */
  Core.certs = (function () {
    var ISSUED = { certified: 1, collected: 1 };
    // Two letters from these: no I or O to be read as 1 or 0.
    var LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

    function t(v) { var n = Date.parse(v || ''); return isNaN(n) ? 0 : n; }
    function nowIso(ctx) { return (ctx && ctx.now) || new Date().toISOString(); }
    function longDate(ctx) {
      var d = ctx && ctx.now ? new Date(ctx.now) : new Date();
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: '2-digit' });
    }

    function numberKey(no) { return String(no == null ? '' : no).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    // The programme's first two letters, with an intake key such as "02. " out
    // of the way — and never a TypeError for a record with no programme.
    function numberPrefix(course) {
      var bare = String(course || '').replace(/^\s*\d+\.\s*/, '').trim();
      return (bare.substring(0, 2).toUpperCase() || 'CE');
    }
    function rememberAlias(student, no) {
      if (!student || !no) return false;
      var key = numberKey(no);
      if (!key) return false;
      if (!Array.isArray(student.certNoAliases)) student.certNoAliases = [];
      if (student.certNoAliases.some(function (a) { return numberKey(a) === key; })) return false;
      student.certNoAliases.push(String(no).trim());
      return true;
    }
    // The number this record was issued before (the latest alias), for a
    // re-certification to take back rather than mint a new one.
    function previousNumber(student) {
      var list = (student && Array.isArray(student.certNoAliases)) ? student.certNoAliases.filter(function (a) { return numberKey(a); }) : [];
      return list.length ? list[list.length - 1] : null;
    }
    function approvalOf(student, approvals) {
      if (!student || !Array.isArray(approvals)) return null;
      for (var i = 0; i < approvals.length; i++) {
        if (approvals[i] && approvals[i].studentId === student.id) return approvals[i];
      }
      return null;
    }
    function approvedNumber(student, approvals) {
      var a = approvalOf(student, approvals);
      return (a && a.certNo) ? a.certNo : null;
    }
    function hasNumber(student, no, approvals) {
      if (!student || !no) return false;
      var key = numberKey(no);
      if (!key) return false;
      if (numberKey(student.certNo) === key) return true;
      if (Array.isArray(student.certNoAliases) && student.certNoAliases.some(function (a) { return numberKey(a) === key; })) return true;
      return numberKey(approvedNumber(student, approvals)) === key;
    }
    // What a trainee's number is derived from: the natural key their stable id
    // is a hash of, so it is the same on every device.
    function numberSeed(student) {
      if (!student) return '';
      var key = '';
      try { key = Core.naturalKey(student) || ''; } catch (e) {}
      if (!key) key = String(student.name || '').toLowerCase().trim() + '|' + String(student.course || '').toLowerCase().trim();
      return key === '|' ? '' : key;
    }
    function shape(prefix, year, n) {
      var digits = String(1000 + (n % 9000));
      var rest = Math.floor(n / 9000);
      var letters = LETTERS.charAt(rest % 24) + LETTERS.charAt(Math.floor(rest / 24) % 24);
      return prefix + '-' + year + '-' + digits + '-' + letters;
    }
    function cryptoObj() {
      return (root && root.crypto) || (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    }
    function randomInt() {
      try {
        var c = cryptoObj();
        if (c && c.getRandomValues) { var a = new Uint32Array(2); c.getRandomValues(a); return (a[0] % 2097152) * 4294967296 + a[1]; }
      } catch (e) {}
      return Math.floor(Math.random() * 9007199254740991);
    }
    /* PREFIX-YEAR-NNNN-XX, unique across the roll it is given. Derived from the
       trainee (the same answer on every device, whatever order the roll is in);
       on the rare clash with SOMEBODY ELSE on this roll the next derivation is
       tried, which is the same for this trainee everywhere too. With no trainee
       to derive from, a random draw from the same space. */
    function generateNumber(prefix, student, roll) {
      prefix = String(prefix || 'CE').toUpperCase();
      var existing = {};
      (Array.isArray(roll) ? roll : []).forEach(function (st) {
        if (!st || (student && (st === student || (student.id != null && st.id === student.id)))) return;
        if (st.certNo) existing[numberKey(st.certNo)] = true;
        (Array.isArray(st.certNoAliases) ? st.certNoAliases : []).forEach(function (a) { existing[numberKey(a)] = true; });
      });
      var yearMatch = student && student.certDate ? /\b(20\d\d)\b/.exec(String(student.certDate)) : null;
      var year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
      var seed = numberSeed(student);
      var c, round;
      var derive = function (sd, r) { return shape(prefix, year, parseInt(Core.hashString(sd + '|cert|' + r), 36) || 0); };
      if (seed) {
        // Who else on this roll is waiting for a number under this prefix and
        // year, and which number they would take first. When two of them want
        // the same one, the trainee whose seed sorts first has it — whichever
        // of the two this device happens to number first — so two devices
        // numbering the same roll in different orders still agree.
        var reserved = {};
        (Array.isArray(roll) ? roll : []).forEach(function (st) {
          if (!st || st === student || (student && student.id != null && st.id === student.id)) return;
          if (st.certNo || !ISSUED[st.stage] || numberPrefix(st.course) !== prefix) return;
          var ym = st.certDate ? /\b(20\d\d)\b/.exec(String(st.certDate)) : null;
          if ((ym ? ym[1] : String(new Date().getFullYear())) !== year) return;
          var ps = numberSeed(st);
          if (ps && ps < seed) reserved[numberKey(derive(ps, 0))] = true;
        });
        for (round = 0; round < 64; round++) {
          c = derive(seed, round);
          if (!existing[numberKey(c)] && !reserved[numberKey(c)]) return c;
        }
      }
      for (round = 0; round < 64; round++) {
        c = shape(prefix, year, randomInt());
        if (!existing[numberKey(c)]) return c;
      }
      return prefix + '-' + year + '-' + Date.now().toString(36).toUpperCase();
    }
    /* THE one place a certificate gets its number. ctx: { roll, approvals }. */
    function ensureNumber(student, ctx) {
      if (!student) return null;
      if (student.certNo) return student.certNo;          // a number, once issued, never changes
      ctx = ctx || {};
      student.certNo = previousNumber(student) || approvedNumber(student, ctx.approvals) ||
        generateNumber(numberPrefix(student.course), student, ctx.roll);
      return student.certNo;
    }

    /* --- Withdrawal ------------------------------------------------------- */
    // A withdrawal stands until a LATER re-certification: two stamps, and the
    // newer of them decides, so either decision survives a sync with a device
    // that has not heard of it yet.
    function isRevoked(student) {
      if (!student) return false;
      var r = t(student.certRevokedAt);
      return r > 0 && r > t(student.certReinstatedAt);
    }
    function pushHistory(student, entry) {
      if (!Array.isArray(student.certHistory)) student.certHistory = [];
      student.certHistory.push(entry);
    }
    /* Withdraw a certificate. The number stays on record (as an alias, and in
       the history), so the paper still resolves — as revoked — and a later
       re-certification reuses it. The download approval is switched off with a
       decision time, so a stale "approved" copy from another device cannot
       outvote it. opts: { by, reason, now }. Returns the number withdrawn. */
    function revoke(student, approvals, opts) {
      if (!student) return null;
      opts = opts || {};
      var at = nowIso(opts);
      var no = student.certNo || previousNumber(student) || approvedNumber(student, approvals);
      if (student.certNo) rememberAlias(student, student.certNo);
      pushHistory(student, { event: 'revoked', certNo: no || null, certDate: student.certDate || null,
        at: at, by: opts.by || '', reason: opts.reason || '' });
      student.certRevokedAt = at;
      student.certRevokedBy = opts.by || '';
      student.certRevokedReason = opts.reason || '';
      student.certNo = null;
      student.certDate = null;
      student.certCollected = false;
      var a = approvalOf(student, approvals);
      if (a) {
        a.approved = false;
        a.revokedAt = at;
        a.revokedBy = opts.by || '';
        if (opts.reason) a.revokedReason = opts.reason;
      }
      return no || null;
    }
    function reinstate(student, opts) {
      opts = opts || {};
      var at = nowIso(opts);
      student.certReinstatedAt = at;
      pushHistory(student, { event: 'reinstated', certNo: student.certNo || null, certDate: student.certDate || null, at: at, by: opts.by || '' });
    }

    /* The Update Stage rule, the same on every page.
       ctx: { roll, approvals, by, reason, now }.
       Returns { issued, revoked, number }. */
    function applyStage(student, newStage, ctx) {
      ctx = ctx || {};
      var out = { issued: false, revoked: false, number: null };
      if (!student) return out;
      var prev = student.stage;
      student.stage = newStage;
      if (ISSUED[newStage]) {
        if (newStage === 'certified') student.progress = 90;
        else { student.progress = 100; student.certCollected = true; }
        if (!student.certDate) student.certDate = longDate(ctx);
        var had = !!student.certNo;
        out.number = ensureNumber(student, ctx);
        out.issued = !had;
        if (isRevoked(student)) reinstate(student, ctx);
      } else {
        if (newStage === 'incomplete') student.progress = Math.min(parseFloat(student.progress) || 0, 40);
        // Demotion: the certificate is withdrawn, not silently left on the
        // record (where the approvals reconcile promoted the trainee straight
        // back) and not silently deleted either.
        if (ISSUED[prev] || student.certNo) {
          out.number = revoke(student, ctx.approvals, ctx);
          out.revoked = true;
        }
      }
      student.lastModified = nowIso(ctx);
      return out;
    }

    /* Bring the certificate's own state across from another copy of the same
       record: every number (as aliases), the newest withdrawal and the newest
       re-certification, the history, and the newest signature. Field merges
       that keep one whole value cannot do this — they would drop a withdrawal
       made on the other device. Returns true when `local` changed. */
    function mergeState(local, other) {
      if (!local || !other || local === other) return false;
      var changed = false;
      if (other.certNo && local.certNo && numberKey(other.certNo) !== numberKey(local.certNo)) {
        if (rememberAlias(local, local.certNo)) changed = true;
        if (rememberAlias(local, other.certNo)) changed = true;
      }
      (Array.isArray(other.certNoAliases) ? other.certNoAliases : []).forEach(function (a) { if (rememberAlias(local, a)) changed = true; });
      return mergeLifecycle(local, other) || changed;
    }
    /* The same, without the numbers (a caller that settles aliases itself).
       Never mutates `other`, nor an array `local` may share with it. */
    function mergeLifecycle(local, other) {
      if (!local || !other || local === other) return false;
      var changed = false;
      if (t(other.certRevokedAt) > t(local.certRevokedAt)) {
        local.certRevokedAt = other.certRevokedAt;
        local.certRevokedBy = other.certRevokedBy || '';
        local.certRevokedReason = other.certRevokedReason || '';
        changed = true;
      }
      if (t(other.certReinstatedAt) > t(local.certReinstatedAt)) { local.certReinstatedAt = other.certReinstatedAt; changed = true; }
      if (Array.isArray(other.certHistory) && other.certHistory.length) {
        var seen = {}, add = [];
        var mine = Array.isArray(local.certHistory) ? local.certHistory : [];
        mine.forEach(function (h) { if (h) seen[h.event + '|' + h.at] = true; });
        other.certHistory.forEach(function (h) {
          if (!h || seen[h.event + '|' + h.at]) return;
          seen[h.event + '|' + h.at] = true;
          add.push(JSON.parse(JSON.stringify(h)));
        });
        if (add.length) {
          local.certHistory = mine.concat(add).sort(function (a, b) { return t(a && a.at) - t(b && b.at); });
          changed = true;
        }
      }
      if (other.certSig && other.certSig.sig && (!local.certSig || t(other.certSig.signedAt) > t(local.certSig.signedAt))) {
        local.certSig = JSON.parse(JSON.stringify(other.certSig));
        changed = true;
      }
      return changed;
    }

    /* Who a certificate number belongs to. Ambiguity — one number held by two
       different people, which only two devices both minting before either
       synced can produce — is reported as such, so the employer is told to
       contact the Centre rather than shown a name that may be the wrong one. */
    function bareCourse(s) { return Core.normCourse(String(s || '').replace(/^\s*\d+\.\s*/, '')); }
    function samePerson(a, b) {
      if (!a || !b) return false;
      if (a === b || (a.id != null && a.id === b.id)) return true;
      return Core.sameName(a.name, b.name) && bareCourse(a.course) === bareCourse(b.course);
    }
    function resolve(query, roll, approvals) {
      var key = numberKey(query);
      var none = { student: null, number: '', via: '', ambiguous: false };
      if (!key) return none;
      roll = Array.isArray(roll) ? roll : [];
      var hits = [];
      roll.forEach(function (s) {
        if (!s) return;
        if (numberKey(s.certNo) === key) { hits.push({ student: s, number: s.certNo, via: 'number' }); return; }
        if (Array.isArray(s.certNoAliases)) {
          var a = s.certNoAliases.filter(function (x) { return numberKey(x) === key; })[0];
          if (a) hits.push({ student: s, number: a, via: 'alias' });
        }
      });
      if (hits.length) {
        var first = hits.filter(function (h) { return h.via === 'number'; })[0] || hits[0];
        var others = hits.filter(function (h) { return !samePerson(h.student, first.student); });
        return { student: first.student, number: first.number, via: first.via, ambiguous: others.length > 0 };
      }
      var appr = (Array.isArray(approvals) ? approvals : []).filter(function (d) { return d && numberKey(d.certNo) === key; })[0];
      if (appr) {
        var hit = roll.filter(function (s) { return s && s.id === appr.studentId; })[0] ||
          roll.filter(function (s) { return s && Core.sameName(s.name, appr.name) && Core.normCourse(s.course || '') === Core.normCourse(appr.course || ''); })[0];
        if (hit) return { student: hit, number: appr.certNo, via: 'approval', ambiguous: false };
      }
      return none;
    }
    /* 'valid' | 'revoked' for a record a number was found on ('none' without). */
    function status(student) {
      if (!student) return 'none';
      if (isRevoked(student) || !student.certNo || !ISSUED[student.stage]) return 'revoked';
      return 'valid';
    }

    /* --- Download approvals ------------------------------------------------
       A revocation is a decision too. Approved used to beat not-approved
       outright, so an "approved" copy still sitting on another device won
       every merge and switched a revoked download back on. Once either copy
       carries a revocation stamp, the LATER decision (approval date or
       revocation date) wins. Downloads are counted per device and merged by
       the larger count for each device, so two devices' downloads add up
       instead of one device's being dropped. */
    function decidedAt(c) { return Math.max(t(c && c.approvedDate), t(c && c.revokedAt)); }
    function pickApproval(a, b) {
      if (a.revokedAt || b.revokedAt) {
        var da = decidedAt(a), db = decidedAt(b);
        if (da !== db) return db > da ? b : a;
      }
      return Core.approvalScore(b) > Core.approvalScore(a) ? b : a;
    }
    function downloadMap(c) {
      return (c && c.downloadsByDevice && typeof c.downloadsByDevice === 'object') ? c.downloadsByDevice : null;
    }
    function sumMap(m) { var s = 0; Object.keys(m).forEach(function (k) { s += Math.max(0, parseInt(m[k], 10) || 0); }); return s; }
    function mergeApprovals(a, b) {
      if (!a) return b || null;
      if (!b) return a;
      var w = pickApproval(a, b), l = w === a ? b : a;
      var mw = downloadMap(w), ml = downloadMap(l);
      var cw = parseInt(w.downloadCount, 10) || 0, cl = parseInt(l.downloadCount, 10) || 0;
      var lastW = t(w.lastDownloaded), lastL = t(l.lastDownloaded);
      if (!mw && !ml && cw >= cl && lastW >= lastL) return w;
      var map = {};
      [mw, ml].forEach(function (m) {
        if (!m) return;
        Object.keys(m).forEach(function (k) { map[k] = Math.max(map[k] || 0, parseInt(m[k], 10) || 0); });
      });
      var out = Object.assign({}, w);
      if (mw || ml) out.downloadsByDevice = map;
      out.downloadCount = Math.max(cw, cl, sumMap(map));
      if (lastL > lastW) out.lastDownloaded = l.lastDownloaded;
      return out;
    }
    /* Record one download made on this device. */
    function recordDownload(approval, deviceId, now) {
      if (!approval) return;
      var m = downloadMap(approval);
      if (!m) {
        m = {};
        var earlier = parseInt(approval.downloadCount, 10) || 0;
        if (earlier) m._earlier = earlier;   // counted before devices were told apart
      }
      var dev = String(deviceId || 'this-device');
      m[dev] = (parseInt(m[dev], 10) || 0) + 1;
      approval.downloadsByDevice = m;
      approval.downloadCount = sumMap(m);
      approval.lastDownloaded = now || new Date().toISOString();
    }

    /* --- Eligibility --------------------------------------------------------
       What the Centre's own records say before a certificate is issued. It
       WARNS — the administrator decides — and says plainly what it could not
       check. opts: { qual, manualGrades, exams, examResults, feeRecord,
       passMark (60, the transcript's COMPETENT line), minAttendance (70, the
       dashboard's low-attendance line) }.
       Returns { items:[{ key, label, state:'ok'|'warn'|'unknown', detail }], warnings }. */
    function eligibility(student, opts) {
      opts = opts || {};
      student = student || {};
      var pass = opts.passMark != null ? Number(opts.passMark) : 60;
      var minAtt = opts.minAttendance != null ? Number(opts.minAttendance) : 70;
      var items = [];
      // 1. Assessments. The transcript system's own readiness verdict when this
      // build has one (Core.transcriptReadiness — added by the transcript
      // work, so it is looked for rather than assumed); else the transcript's
      // units; else the online exams.
      var T = Core.Transcript;
      var ready = null;
      if (typeof Core.transcriptReadiness === 'function') {
        try { ready = Core.transcriptReadiness(student, opts); } catch (e) { ready = null; }
      }
      var rows = (!ready && opts.qual && T) ? T.effectiveGrades({ qual: opts.qual, studentId: student.id,
        manualGrades: opts.manualGrades, exams: opts.exams, examResults: opts.examResults }) : [];
      if (ready !== null && ready !== undefined && (typeof ready === 'boolean' || typeof ready === 'object')) {
        var ok = typeof ready === 'boolean' ? ready : !!(ready.ready || ready.ok || ready.eligible);
        var known = typeof ready === 'boolean' || ready.known !== false;
        items.push({ key: 'units', label: 'Transcript results', state: !known ? 'unknown' : ok ? 'ok' : 'warn',
          detail: String((typeof ready === 'object' && (ready.detail || ready.reason || ready.summary || ready.message)) || (ok ? 'Ready to certify' : 'Not yet ready to certify')) });
      } else if (rows.length) {
        var graded = rows.filter(function (r) { return r.grade != null && r.grade !== '' && !isNaN(Number(r.grade)); });
        var nyc = graded.filter(function (r) { return Number(r.grade) < pass; });
        var missing = rows.length - graded.length;
        items.push({ key: 'units', label: 'Units competent (transcript)',
          state: (!nyc.length && !missing) ? 'ok' : 'warn',
          detail: (graded.length - nyc.length) + ' of ' + rows.length + ' units competent' +
            (nyc.length ? '; not yet competent: ' + nyc.slice(0, 3).map(function (r) { return r.code || r.name; }).join(', ') + (nyc.length > 3 ? '…' : '') : '') +
            (missing ? '; ' + missing + ' not graded' : '') });
      } else {
        var mine = (Array.isArray(opts.examResults) ? opts.examResults : []).filter(function (r) { return r && r.studentId === student.id; });
        if (!mine.length) items.push({ key: 'units', label: 'Assessments passed', state: 'unknown', detail: 'No transcript units or exam results on record' });
        else {
          var failed = mine.filter(function (r) { return r.passed === false || (r.passed == null && Number(r.score) < pass); });
          items.push({ key: 'units', label: 'Assessments passed', state: failed.length ? 'warn' : 'ok',
            detail: (mine.length - failed.length) + ' of ' + mine.length + ' exam results passed' });
        }
      }
      // 2. Attendance — the percentage the register keeps on the record.
      var rawAtt = student.attendance;
      var att = parseFloat(rawAtt);
      if (rawAtt === undefined || rawAtt === null || rawAtt === '' || isNaN(att)) {
        items.push({ key: 'attendance', label: 'Attendance', state: 'unknown', detail: 'No attendance recorded' });
      } else {
        items.push({ key: 'attendance', label: 'Attendance', state: att >= minAtt ? 'ok' : 'warn', detail: Math.round(att) + '% (the line is ' + minAtt + '%)' });
      }
      // 3. Fees — the trainee's School Fee record, when this device has one.
      var f = opts.feeRecord;
      if (!f) items.push({ key: 'fees', label: 'Fees cleared', state: 'unknown', detail: 'No School Fee record on this device' });
      else {
        var tuition = parseFloat(f.tuitionFee) || 0, paid = parseFloat(f.totalPaid) || 0;
        if (tuition <= 0) items.push({ key: 'fees', label: 'Fees cleared', state: 'unknown', detail: 'No tuition set on the fee record' });
        else items.push({ key: 'fees', label: 'Fees cleared', state: paid >= tuition ? 'ok' : 'warn',
          detail: paid >= tuition ? 'Paid in full' : 'Owes $' + (tuition - paid).toFixed(2) });
      }
      return { items: items, warnings: items.filter(function (i) { return i.state === 'warn'; }).length };
    }

    /* --- Template lookup -----------------------------------------------------
       Which template prints a trainee's certificate: the exact name, else the
       Centre's mapping, else ONE unambiguous programme match (intake key and
       letter case aside). Two candidates (a Level 2 and a Level 3), none, or
       an empty programme is a miss — the page then says the template is
       missing instead of quietly printing another programme's certificate. */
    function levelOf(s) { var m = /(?:^|\s)(?:l|lvl|level)\s*(\d+)(?:\s|$)/i.exec(bareCourse(s)); return m ? m[1] : null; }
    function templateKey(course, templates, courseMap) {
      templates = templates || {};
      course = String(course == null ? '' : course);
      if (templates[course]) return course;
      var mapped = courseMap ? courseMap[course] : null;
      if (mapped && templates[mapped]) return mapped;
      var want = bareCourse(course);
      if (!want) return mapped || course;
      var keys = Object.keys(templates);
      var exact = keys.filter(function (k) { return bareCourse(k) === want; });
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return mapped || course;
      var lvl = levelOf(course);
      var loose = keys.filter(function (k) {
        var b = bareCourse(k);
        if (!b || (b.indexOf(want) === -1 && want.indexOf(b) === -1)) return false;
        var kl = levelOf(k);
        return !(lvl && kl && kl !== lvl);
      });
      if (loose.length === 1) return loose[0];
      return mapped || course;
    }

    /* Saving a template from the editor keeps what the editor does not show:
       the plan it was seeded from, its gender wording, any future field — and a
       competency the administrator did not change stays "from the plan", so a
       later re-seed can still refresh it. */
    function keepTemplateProvenance(existing, edited) {
      existing = existing || {};
      var out = Object.assign({}, existing, edited);
      var before = Array.isArray(existing.competencies) ? existing.competencies : [];
      if (Array.isArray(edited.competencies)) {
        out.competencies = edited.competencies.map(function (c) {
          var same = before.filter(function (b) {
            return b && b.fromPlan && b.category === c.category &&
              JSON.stringify(b.items || []) === JSON.stringify(c.items || []);
          })[0];
          return same ? Object.assign({}, c, { fromPlan: same.fromPlan }) : c;
        });
      }
      return out;
    }

    /* The PDF page: A4 in millimetres, turned to suit the picture, with the
       picture fitted inside and centred. The page used to be the picture's
       pixel count read as points (a 2000-pixel background made a 37-inch
       page), so every programme printed at a different size. */
    function pdfPage(width, height) {
      width = width || 1; height = height || 1;
      var landscape = width >= height;
      var pw = landscape ? 297 : 210, ph = landscape ? 210 : 297;
      var scale = Math.min(pw / width, ph / height);
      var w = width * scale, h = height * scale;
      return { orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4',
        pageWidth: pw, pageHeight: ph, x: (pw - w) / 2, y: (ph - h) / 2, w: w, h: h };
    }

    /* --- Page 2: a list laid out in two columns -----------------------------
       Page 2 prints two lists side by side: the units (clusters/modules) on
       the left and the Technical Competencies Achieved on the right, each in
       two columns of its own. The competencies used to be drawn as ONE column
       that wrapped at the page's right edge and never stopped: a long list ran
       over the frame on the right and down through the Programme
       Specifications and off the page, instead of carrying on beside itself
       the way the units did. The units were split by COUNT, half and half,
       with nothing to stop a long half running down the page either, and every
       wrapped line of a bullet got a bullet of its own.

       layoutColumns places a list in a box of equal columns. Each entry is
       wrapped to the width of its OWN column (with the very font it is drawn
       in — `measure(text, font)` is the page's canvas), its continuation
       lines hang under its text rather than under its bullet, and it is never
       split between two columns; a heading stays with its first entry. The
       list fills the first column from the top and carries on at the top of
       the next ('fill'), or shares itself out so the columns end level
       ('balance'). When it does not fit at the template's size the font comes
       down a step at a time to `minSize`; at that size what still does not fit
       is left out and counted (`hidden`) — never drawn outside the box.

         entries  [{ text, style: 'head'|'item', marker? }]
         box      { x, y: first baseline, width, bottom: lowest baseline,
                    columns: 2, gap: 10, padRight: 10 }
         opts     { size, minSize, step: 0.5, mode: 'fill'|'balance',
                    family, groupGap, styles: { head: {...}, item: {...} } }
                    a style is { weight, scale, lineHeight, indent, marker, color }
       Returns { size, fits, hidden, lines: [{ text, x, y, font, color, style,
       column, entry, first }], columns: [{ x, width }] }. */
    var LIST_STYLES = {
      head: { weight: 'bold', scale: 0.85, lineHeight: 1.3, indent: 10, marker: '' },
      item: { weight: '', scale: 0.77, lineHeight: 1.1, indent: 20, marker: '  \u2022  ' }
    };
    function listStyle(opts, name) {
      var base = LIST_STYLES[name] || LIST_STYLES.item;
      var own = (opts && opts.styles && opts.styles[name]) || {};
      var out = {};
      Object.keys(base).forEach(function (k) { out[k] = base[k]; });
      Object.keys(own).forEach(function (k) { out[k] = own[k]; });
      return out;
    }
    function listFont(st, size, family) {
      return (st.weight ? st.weight + ' ' : '') + Math.max(1, Math.round(size * st.scale)) + 'px ' + (family || 'Arial, sans-serif');
    }
    /* Words onto lines no wider than maxW; a word wider than the whole line
       (a long code or address) is broken where it must be, so nothing ever
       runs past the column's edge. */
    function wrapWords(text, maxW, measure, font) {
      var words = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(' ');
      var lines = [], cur = '';
      function breakWord(word) {
        var part = '';
        for (var i = 0; i < word.length; i++) {
          if (part && measure(part + word.charAt(i), font) > maxW) { lines.push(part); part = ''; }
          part += word.charAt(i);
        }
        return part;
      }
      words.forEach(function (word) {
        if (!word) return;
        var test = cur ? cur + ' ' + word : word;
        if (measure(test, font) <= maxW) { cur = test; return; }
        if (cur) lines.push(cur);
        cur = measure(word, font) <= maxW ? word : breakWord(word);
      });
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    }
    function columnsOf(box) {
      var n = Math.max(1, Math.floor(box.columns || 2));
      var gap = box.gap == null ? 10 : box.gap;
      var cw = (box.width - gap * (n - 1)) / n;
      var cols = [];
      for (var c = 0; c < n; c++) cols.push({ x: box.x + c * (cw + gap), width: cw });
      return cols;
    }
    /* Every entry wrapped at one size. Every column is the same width, so an
       entry wraps the same wherever it lands: done once per size. */
    function wrapAt(entries, measure, box, opts, size) {
      var cols = columnsOf(box);
      var padRight = box.padRight == null ? 10 : box.padRight;
      return entries.map(function (e, i) {
        var st = listStyle(opts, e.style);
        var font = listFont(st, size, opts.family);
        var marker = e.marker != null ? String(e.marker) : (st.marker || '');
        var markerW = marker ? measure(marker, font) : 0;
        var avail = Math.max(1, cols[0].width - st.indent - padRight - markerW);
        var lh = Math.max(1, Math.round(size * st.lineHeight));
        var texts = wrapWords(e.text, avail, measure, font);
        return { i: i, st: st, font: font, marker: marker, markerW: markerW, lh: lh, texts: texts,
          head: e.style === 'head', h: lh * (texts.length - 1) };
      });
    }
    /* Place the wrapped entries, column by column. `limit` is the lowest
       baseline allowed: the box's bottom, or higher when balancing. Null when
       the list does not fit (unless truncating, when the rest is counted). */
    function placeAt(blocks, entries, box, opts, limit, truncate) {
      var cols = columnsOf(box);
      var groupGap = opts.groupGap == null ? 6 : opts.groupGap;
      var lines = [], col = 0, y = box.y, empty = true, hidden = 0;
      for (var b = 0; b < blocks.length; b++) {
        var bl = blocks[b];
        // What must fit together: this entry; for a heading, its first entry
        // too (no heading left alone at the foot of a column) — or, with
        // keepGroups, its whole group when the group fits in a column at all.
        var need = bl.h;
        if (bl.head) {
          var j = b + 1, group = bl.h;
          while (j < blocks.length && !blocks[j].head) { group += blocks[j - 1].lh + blocks[j].h; j++; }
          var withFirst = (blocks[b + 1] && !blocks[b + 1].head) ? bl.h + bl.lh + blocks[b + 1].h : bl.h;
          need = (opts.keepGroups && box.y + group <= box.bottom) ? group : withFirst;
        }
        var gap = (bl.head && !empty) ? groupGap : 0;
        if (!empty && y + gap + need > limit) { col++; y = box.y; empty = true; gap = 0; }
        if (col >= cols.length || y + need > limit) {
          if (!truncate) return null;
          hidden = blocks.length - b;
          break;
        }
        y += gap;
        for (var k = 0; k < bl.texts.length; k++) {
          lines.push({
            text: k ? bl.texts[k] : bl.marker + bl.texts[k],
            // Continuation lines hang under the text, not under the bullet.
            x: cols[col].x + bl.st.indent + (k ? bl.markerW : 0), y: y,
            font: bl.font, color: bl.st.color, style: entries[bl.i].style || 'item',
            column: col, entry: bl.i, first: !k
          });
          y += bl.lh;
        }
        empty = false;
      }
      return { lines: lines, hidden: hidden, columns: cols };
    }
    function layoutAt(entries, measure, box, opts, size, truncate) {
      var blocks = wrapAt(entries, measure, box, opts, size);
      var full = placeAt(blocks, entries, box, opts, box.bottom, truncate);
      if (!full || full.hidden || opts.mode !== 'balance' || blocks.length < 2) return full;
      // Balanced: the highest bottom at which the list still fits, so the
      // columns end level instead of the first running to the foot of the box.
      var lo = box.y - 1, hi = box.bottom, best = full;
      while (hi - lo > 1) {
        var mid = Math.floor((lo + hi) / 2);
        var r = placeAt(blocks, entries, box, opts, mid, false);
        if (r) { best = r; hi = mid; } else lo = mid;
      }
      return best;
    }
    function layoutColumns(entries, measure, box, opts) {
      opts = opts || {};
      entries = Array.isArray(entries) ? entries.filter(function (e) { return e && String(e.text == null ? '' : e.text).trim(); }) : [];
      var size = +opts.size > 0 ? +opts.size : 13;
      var minSize = +opts.minSize > 0 ? Math.min(+opts.minSize, size) : size;
      var step = +opts.step > 0 ? +opts.step : 0.5;
      var r = null, s = size;
      for (; s >= minSize - 1e-9; s = Math.round((s - step) * 1000) / 1000) {
        r = layoutAt(entries, measure, box, opts, s, false);
        if (r) break;
      }
      if (!r) { s = minSize; r = layoutAt(entries, measure, box, opts, s, true); }
      return { size: s, fits: !r.hidden, hidden: r.hidden, lines: r.lines, columns: r.columns };
    }
    /* Several lists on one page, at ONE size: the largest at which every one
       of them fits (so the two halves of page 2 never print in two different
       sizes). sets: [{ entries, box, opts }]. */
    function layoutColumnsShared(sets, measure) {
      sets = Array.isArray(sets) ? sets : [];
      var first = sets.map(function (st) { return layoutColumns(st.entries, measure, st.box, st.opts); });
      var size = Math.min.apply(null, first.map(function (l) { return l.size; }).concat([Infinity]));
      return sets.map(function (st, i) {
        if (first[i].size === size) return first[i];
        var o = {};
        Object.keys(st.opts || {}).forEach(function (k) { o[k] = st.opts[k]; });
        o.size = size; o.minSize = size;
        return layoutColumns(st.entries, measure, st.box, o);
      });
    }
    /* The smallest base size page 2's lists may shrink to: their body text
       (scale 0.77 of it) no smaller than about 5 pt once the page is fitted to
       A4 — the size of the small print on a printed form. Never larger than
       the template's own size: a list that already fits is never touched. */
    var LIST_MIN_PT = 5;
    function listMinSize(size, width, height, scale) {
      var pg = pdfPage(width, height);
      var mmPerPx = pg.w / (width || 1);
      var minPx = (LIST_MIN_PT * 25.4 / 72) / mmPerPx;
      var base = minPx / (scale || LIST_STYLES.item.scale);
      return Math.min(+size || 13, Math.round(base * 2) / 2);
    }

    /* --- Dashboard figures --------------------------------------------------
       Certificate dates are stored as "October 16, 2026" (older records as ISO
       dates); Date.parse reads both. The chart used to split on '-', which
       gave nothing for every certificate issued through Update Stage. */
    function certTime(s) { var n = Date.parse((s && s.certDate) || ''); return isNaN(n) ? 0 : n; }
    function byMonth(students, now, months) {
      now = now ? new Date(now) : new Date();
      months = months || 6;
      var out = [];
      for (var i = months - 1; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({ year: d.getFullYear(), month: d.getMonth(), count: 0 });
      }
      (Array.isArray(students) ? students : []).forEach(function (s) {
        var ms = certTime(s);
        if (!ms || !s.certNo || isRevoked(s)) return;
        var d = new Date(ms);
        out.forEach(function (b) { if (b.year === d.getFullYear() && b.month === d.getMonth()) b.count++; });
      });
      return out;
    }
    function certifiedInYear(students, year) {
      return (Array.isArray(students) ? students : []).filter(function (s) {
        if (!s || !ISSUED[s.stage] || isRevoked(s)) return false;
        var ms = certTime(s);
        return !!ms && new Date(ms).getFullYear() === year;
      }).length;
    }

    /* --- Signatures: verification with no login ------------------------------
       The QR code on a certificate carries what the certificate states — its
       number, the holder's name, the programme and the date — and an ECDSA
       P-256 signature over exactly that, made on an administrator's device
       with a private key that never leaves it (it is not in the store, so no
       backup or sync can carry it). The verify page checks the signature in the
       employer's own browser against the Centre's PUBLIC keys, published in
       cert-keys.json in this repository. Nothing is looked up and nothing else
       about the trainee is revealed; one changed letter breaks the signature. */
    var SIG_VERSION = 'CESTIS-CERT-1';
    function sigNorm(v) {
      var s = String(v == null ? '' : v);
      try { s = s.normalize('NFC'); } catch (e) {}
      return s.replace(/\s+/g, ' ').trim();
    }
    function sigFields(student, programme) {
      return { no: sigNorm(student && student.certNo), name: sigNorm(student && student.name),
        programme: sigNorm(programme != null ? programme : String((student && student.course) || '').replace(/^\s*\d+\.\s*/, '')),
        date: sigNorm(student && student.certDate) };
    }
    function canonical(f, kid) {
      return [SIG_VERSION, sigNorm(kid), sigNorm(f.no), sigNorm(f.name), sigNorm(f.programme), sigNorm(f.date)].join('\n');
    }
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    function b64url(bytes) {
      bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      var out = '', i;
      for (i = 0; i + 2 < bytes.length; i += 3) {
        var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
      }
      var rem = bytes.length - i;
      if (rem === 1) { var a = bytes[i] << 16; out += B64[(a >> 18) & 63] + B64[(a >> 12) & 63]; }
      else if (rem === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out += B64[(b >> 18) & 63] + B64[(b >> 12) & 63] + B64[(b >> 6) & 63]; }
      return out;
    }
    function fromB64url(s) {
      s = String(s || '');
      if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
      var out = [], buf = 0, bits = 0;
      for (var i = 0; i < s.length; i++) {
        buf = ((buf << 6) | B64.indexOf(s.charAt(i))) & 0xffffff; bits += 6;
        if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
      }
      return new Uint8Array(out);
    }
    function utf8(s) {
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
      var e = unescape(encodeURIComponent(s)), a = new Uint8Array(e.length);
      for (var i = 0; i < e.length; i++) a[i] = e.charCodeAt(i);
      return a;
    }
    function subtle() { var c = cryptoObj(); return c && c.subtle ? c.subtle : null; }
    function noCrypto() { return Promise.reject(new Error('This browser cannot check signatures (WebCrypto is missing; it needs https or localhost).')); }
    var ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN = { name: 'ECDSA', hash: 'SHA-256' };
    function publicOnly(jwk) { return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }; }
    // A key's short name: the first 12 characters of a hash of the public key.
    function keyId(publicJwk) {
      var s = subtle();
      if (!s) return noCrypto();
      return s.digest('SHA-256', utf8(publicJwk.x + '.' + publicJwk.y)).then(function (d) { return b64url(new Uint8Array(d)).slice(0, 12); });
    }
    function generateKey(label) {
      var s = subtle();
      if (!s) return noCrypto();
      return s.generateKey(ALG, true, ['sign', 'verify']).then(function (kp) {
        return Promise.all([s.exportKey('jwk', kp.privateKey), s.exportKey('jwk', kp.publicKey)]);
      }).then(function (j) {
        var pub = publicOnly(j[1]);
        return keyId(pub).then(function (kid) {
          return { kid: kid, alg: 'ES256', label: label || '', createdAt: new Date().toISOString(), publicJwk: pub,
            privateJwk: { kty: 'EC', crv: 'P-256', x: j[0].x, y: j[0].y, d: j[0].d } };
        });
      });
    }
    /* key: { kid, privateJwk }. Resolves with the signature record kept on
       the trainee's record (certSig). */
    /* The private key as the device keeps it: a LOCKED CryptoKey — usable to
       sign, but its bytes can never be read back out. It used to be kept as a
       plain JWK, so any script that ever ran in an administrator's session
       could copy it and sign certificates in the Centre's name for ever.
       (A script running there can still ask the locked key to sign while the
       page is open; it can no longer carry the key away.) */
    function isLockedKey(k) {
      return !!(k && typeof k === 'object' && k.type === 'private' && k.algorithm && k.extractable === false);
    }
    function lockKey(privateJwk) {
      var s = subtle();
      if (!s) return noCrypto();
      if (!privateJwk || !privateJwk.d) return Promise.reject(new Error('That is not a private signing key.'));
      return s.importKey('jwk', Object.assign({ ext: true }, privateJwk), ALG, false, ['sign']);
    }
    /* Does this private key really sign for this public key? Checked before a
       stored JWK copy is ever given up, so the key is never lost. */
    function checkKey(privateKey, publicJwk) {
      var s = subtle();
      if (!s) return noCrypto();
      var probe = utf8(SIG_VERSION + '\nkey-check\n' + Date.now());
      return s.sign(SIGN, privateKey, probe).then(function (sig) {
        return s.importKey('jwk', Object.assign({ ext: true }, publicOnly(publicJwk)), ALG, false, ['verify']).then(function (pk) {
          return s.verify(SIGN, pk, sig, probe);
        });
      }).then(function (ok) { return !!ok; }, function () { return false; });
    }
    function sign(key, fields, signedAt) {
      var s = subtle();
      if (!s) return noCrypto();
      var locked = key && isLockedKey(key.privateKey);
      if (!key || !key.kid || (!locked && !(key.privateJwk && key.privateJwk.d))) return Promise.reject(new Error('No signing key on this device.'));
      return (locked ? Promise.resolve(key.privateKey) : lockKey(key.privateJwk)).then(function (k) {
        return s.sign(SIGN, k, utf8(canonical(fields, key.kid)));
      }).then(function (sig) {
        return { kid: key.kid, sig: b64url(new Uint8Array(sig)), no: fields.no, name: fields.name,
          programme: fields.programme, date: fields.date, signedAt: signedAt || new Date().toISOString() };
      });
    }
    /* Does a record's signature still describe what its certificate states? */
    function sigCurrent(sigRec, fields) {
      if (!sigRec || !sigRec.sig || !fields) return false;
      return sigNorm(sigRec.no) === fields.no && sigNorm(sigRec.name) === fields.name &&
        sigNorm(sigRec.programme) === fields.programme && sigNorm(sigRec.date) === fields.date;
    }
    function findKey(keysFile, kid) {
      var list = keysFile && Array.isArray(keysFile.keys) ? keysFile.keys : [];
      return list.filter(function (k) { return k && k.kid === kid && k.publicJwk && k.publicJwk.x && k.publicJwk.y; })[0] || null;
    }
    /* Check a signed certificate against the published keys. Resolves with
       { result: 'valid' | 'altered' | 'unknown-key' | 'malformed' | 'unsupported', key }. */
    function verify(signed, keysFile) {
      if (!signed || !signed.sig || !signed.kid || !signed.no) return Promise.resolve({ result: 'malformed', key: null });
      var key = findKey(keysFile, signed.kid);
      if (!key) return Promise.resolve({ result: 'unknown-key', key: null });
      var s = subtle();
      if (!s) return Promise.resolve({ result: 'unsupported', key: key });
      var raw = fromB64url(signed.sig);
      if (!raw || raw.length !== 64) return Promise.resolve({ result: 'altered', key: key });
      var f = { no: sigNorm(signed.no), name: sigNorm(signed.name), programme: sigNorm(signed.programme), date: sigNorm(signed.date) };
      return s.importKey('jwk', Object.assign({ ext: true }, publicOnly(key.publicJwk)), ALG, false, ['verify']).then(function (k) {
        return s.verify(SIGN, k, raw, utf8(canonical(f, signed.kid)));
      }).then(function (ok) { return { result: ok ? 'valid' : 'altered', key: key }; },
        function () { return { result: 'malformed', key: key }; });
    }
    /* The address a signed certificate's QR code carries. */
    function signedUrl(base, sigRec) {
      if (!base || !sigRec || !sigRec.sig) return '';
      var e = encodeURIComponent;
      return String(base).replace(/[#?].*$/, '') + '?certificate=' + e(sigRec.no) + '&n=' + e(sigRec.name) +
        '&p=' + e(sigRec.programme) + '&d=' + e(sigRec.date) + '&k=' + e(sigRec.kid) + '&s=' + e(sigRec.sig);
    }
    /* The signed fields an address carries, or null when it carries none. */
    function parseSigned(search) {
      var q = String(search || '').replace(/^\?/, '');
      var p = {};
      q.split('&').forEach(function (kv) {
        if (!kv) return;
        var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
        if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = v;
      });
      var no = p.certificate || p.verify || p.cert;
      if (!no || !p.s || !p.k) return null;
      if (String(no).length > 60 || String(p.n || '').length > 200 || String(p.p || '').length > 200 ||
          String(p.d || '').length > 60 || String(p.s).length > 200 || String(p.k).length > 40) return null;
      return { no: no, name: p.n || '', programme: p.p || '', date: p.d || '', kid: p.k, sig: p.s };
    }
    /* Withdrawn certificates the Centre has published (cert-keys.json
       "revoked": [{ "no": "...", "at": "..." }]). A signature cannot be taken
       back, so this list is how an employer's browser learns of a withdrawal
       without asking anybody. */
    function publishedRevocation(keysFile, no) {
      var list = keysFile && Array.isArray(keysFile.revoked) ? keysFile.revoked : [];
      var key = numberKey(no);
      return list.filter(function (r) { return r && numberKey(typeof r === 'string' ? r : r.no) === key; })[0] || null;
    }

    return {
      ISSUED: ISSUED,
      numberKey: numberKey, numberPrefix: numberPrefix, rememberAlias: rememberAlias,
      previousNumber: previousNumber, approvalOf: approvalOf, approvedNumber: approvedNumber,
      hasNumber: hasNumber, numberSeed: numberSeed, generateNumber: generateNumber,
      ensureNumber: ensureNumber, isRevoked: isRevoked, revoke: revoke, applyStage: applyStage,
      mergeState: mergeState, mergeLifecycle: mergeLifecycle, resolve: resolve, status: status,
      decidedAt: decidedAt, mergeApprovals: mergeApprovals, recordDownload: recordDownload,
      eligibility: eligibility, templateKey: templateKey, keepTemplateProvenance: keepTemplateProvenance,
      pdfPage: pdfPage, certTime: certTime, byMonth: byMonth, certifiedInYear: certifiedInYear,
      layoutColumns: layoutColumns, layoutColumnsShared: layoutColumnsShared, listMinSize: listMinSize,
      wrapWords: wrapWords, LIST_STYLES: LIST_STYLES,
      sig: {
        VERSION: SIG_VERSION, fields: sigFields, canonical: canonical, b64url: b64url, fromB64url: fromB64url,
        keyId: keyId, generateKey: generateKey, sign: sign, current: sigCurrent, verify: verify,
        lockKey: lockKey, checkKey: checkKey, isLockedKey: isLockedKey,
        url: signedUrl, parse: parseSigned, publishedRevocation: publishedRevocation, publicOnly: publicOnly
      }
    };
  })();

  /* ==========================================================================
     EXTERNAL SYSTEM SETTINGS MERGE (TMS / NQS links + headline notices)

     WHY THIS EXISTS
     ---------------
     The headline comment an administrator writes above an embedded external
     system kept vanishing on the next cloud sync. Three different sync paths
     were to blame: one replaced systemSettings wholesale, one Object.assign'd
     the cloud copy over it (which swaps the whole nested extSystems object),
     and one compared values with !== — which, for an object, is ALWAYS true, so
     the cloud's extSystems overwrote the local one every single time.

     This merges the two copies entry by entry. A blank or missing remote value
     can never erase text that exists locally, and when both sides have text the
     newer updatedAt wins.
     ========================================================================== */
  Core.mergeExtSystems = function (local, remote) {
    var L = (local && typeof local === 'object') ? local : {};
    var R = (remote && typeof remote === 'object') ? remote : {};
    var out = {};
    var keys = {};
    Object.keys(L).forEach(function (k) { keys[k] = 1; });
    Object.keys(R).forEach(function (k) { keys[k] = 1; });

    Object.keys(keys).forEach(function (k) {
      var l = (L[k] && typeof L[k] === 'object') ? L[k] : null;
      var r = (R[k] && typeof R[k] === 'object') ? R[k] : null;
      if (!l) { out[k] = r ? shallow(r) : {}; return; }
      if (!r) { out[k] = shallow(l); return; }

      var lt = Date.parse(l.updatedAt || '') || 0;
      var rt = Date.parse(r.updatedAt || '') || 0;
      // Whichever entry was edited more recently forms the base; where only one
      // side actually carries a value, that value survives regardless.
      var base = (rt > lt) ? r : l;
      var other = (rt > lt) ? l : r;
      var merged = shallow(base);
      ['url', 'headline', 'mode'].forEach(function (f) {
        if (isBlank(merged[f]) && !isBlank(other[f])) merged[f] = other[f];
      });
      out[k] = merged;
    });
    return out;

    function shallow(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }
    function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }
  };

  /* ==========================================================================
     MAINTENANCE MODE MERGE

     WHY THIS EXISTS
     ---------------
     Maintenance mode would not stay switched off. Turning it off is a LOCAL
     change — the cloud copy only changes when an administrator runs a manual
     "Save to Cloud" — but every settings scalar was blanket cloud-wins, and a
     pull runs on every login and every sync. So the stale ON in the cloud came
     straight back, the overlay returned, non-admins were locked out again, and
     the local mirror key was then rewritten to match. The administrator's
     decision could not survive its own next sync.

     The flag now carries its own updatedAt and the more recent decision wins —
     the same discipline as an external-system headline. A side with no stamp
     cannot say WHEN it was set, so a stamped side outranks it; with neither
     stamped, the established cloud-wins rule stands.
     ========================================================================== */
  function mergeMaintenance(out, L, R) {
    var hasL = ('maintenanceMode' in L), hasR = ('maintenanceMode' in R);
    if (!hasL && !hasR) return;
    var lt = Date.parse(L.maintenanceUpdatedAt || '') || 0;
    var rt = Date.parse(R.maintenanceUpdatedAt || '') || 0;
    var takeLocal;
    if (!hasR) takeLocal = true;
    else if (!hasL) takeLocal = false;
    else if (lt || rt) takeLocal = lt > rt;
    else takeLocal = false;                       // neither dated: cloud wins, as before
    var win = takeLocal ? L : R, other = takeLocal ? R : L;
    out.maintenanceMode = win.maintenanceMode === true;
    // A blank message never erases text the other side still has — the same
    // rule the headline merge uses.
    var msg = win.maintenanceMessage;
    if ((msg === undefined || String(msg).trim() === '') && other.maintenanceMessage) msg = other.maintenanceMessage;
    if (msg !== undefined) out.maintenanceMessage = msg;
    var stamp = win.maintenanceUpdatedAt;
    if (stamp) out.maintenanceUpdatedAt = stamp; else delete out.maintenanceUpdatedAt;
  }

  /* Merge a whole systemSettings object from the cloud into the local one.
     Scalars: the cloud copy wins (that is the established behaviour for
     settings). extSystems: merged entry by entry so a headline is never lost.
     Maintenance mode: the more recent decision wins — see above. */
  Core.mergeSystemSettings = function (local, remote) {
    var L = (local && typeof local === 'object') ? local : {};
    var R = (remote && typeof remote === 'object') ? remote : {};
    var out = {};
    Object.keys(L).forEach(function (k) { out[k] = L[k]; });
    // The settings as a whole carry updatedAt (stamped on save when their
    // content changed): a strictly newer local copy keeps its scalars, and a
    // stamped local copy outranks an unstamped cloud one. Otherwise the
    // established cloud-wins rule stands. extSystems and maintenance mode
    // carry their own stamps and are decided below.
    var lt = Date.parse(L.updatedAt || '') || 0, rt = Date.parse(R.updatedAt || '') || 0;
    var localWins = (lt && rt) ? lt > rt : (lt > 0 && !rt);
    Object.keys(R).forEach(function (k) {
      if (k === 'extSystems') return; // handled below
      if (localWins && (k in L)) return;
      out[k] = R[k];
    });
    if (L.extSystems || R.extSystems) {
      out.extSystems = Core.mergeExtSystems(L.extSystems, R.extSystems);
    }
    mergeMaintenance(out, L, R);
    return out;
  };

  /* ==========================================================================
     ENROLMENT ELIGIBILITY — the single rule deciding whether a new trainee may
     be enrolled into a training centre / course.

     WHY THIS EXISTS
     ---------------
     The LMS (index.html) and the School Fee dashboard (School.Fee.html) each
     had their own copy of this check, and BOTH failed OPEN: when a course could
     not be resolved to a training centre they returned "no reason to block", so
     trainees were still being added to centres whose course had already ended.
     This is the one implementation both now call, and it fails CLOSED — if the
     centre cannot be verified, enrolment is refused and the user is told to
     create the centre first.

     It also grounds every enrolment in a fiscal year (Apr–Mar, the same FY the
     rest of the platform uses), so student records carry the course duration
     and FY they belong to instead of floating free.
     ========================================================================== */
  Core.enrolment = (function () {
    function norm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }

    /* --- The intake key ---------------------------------------------------
       A programme the Centre runs more than once has one training centre per
       intake, and they share a name. Matching on the name alone therefore
       swept last year's trainees into this year's centre the moment it was
       created — the very thing the course-end rule exists to prevent.

       Every centre carries a key of its own: '01', '02', '03', … taken from
       the centre's id, so it is unique, never reused, and stable on every
       device. A centre's full name is written with it in front —
       "01. Welding and Fabrication", then "02. Welding and Fabrication" for
       the next intake — and that is the name the fee side prices and enrols
       under. A name carrying a key resolves to THAT centre and no other, so a
       trainee stays with the intake they were enrolled in for good. */

    function padKey(v) {
      var s = String(v == null ? '' : v).trim();
      if (!s) return '';
      if (/^\d+$/.test(s)) return s.length < 2 ? ('0' + s) : s;
      return s;
    }

    // A key is a NUMBER: '01', '02', '03'. An id that is not one (some centres
    // carry a generated string id) gives no key — the centre is allotted the
    // next free number instead, so what the Centre reads is always a count.
    function numericKey(v) {
      var s = String(v == null ? '' : v).trim();
      return /^\d+$/.test(s) ? padKey(s) : '';
    }

    /* The key a centre answers to: its own if it carries one, otherwise the
       one its id gives it. '' when the centre has neither. */
    function centreKeyOf(centre) {
      if (!centre) return '';
      if (centre.centreKey != null && String(centre.centreKey).trim() !== '') return padKey(centre.centreKey);
      if (centre.id != null) return numericKey(centre.id);
      return '';
    }

    /* What tells this centre apart from every other one — for COUNTING, never
       for display.

       centreKeyOf() answers '' for a centre that carries no key and whose id is
       not a number, which is every centre made with "+ Add Training Centre"
       until assignCentreKeys() has run over it. Two things went wrong with that
       empty answer, and between them they are the drift the Centre was seeing:

         - tally() bucketed by the key, and an empty key is falsy, so those
           trainees were counted under NO centre at all. Every card on the
           Training Centres page read 0 and the dashboard pipeline emptied.
         - belongsTo() compared the trainee's centre to the card's with `!==`,
           and '' !== '' is false — so a trainee "belonged to" EVERY unkeyed
           centre at once. The Transfer page offered the same person under
           three programmes, and the registers listed them three times.

       So the same roll read as empty on one screen and as triple on another,
       and opening Course Duration — the one page that calls assignCentreKeys()
       — handed every centre a key and made both screens right again. That is
       the "it corrects itself when I come back from Course Duration".

       An identity is therefore never empty for a centre that exists. The key
       when it has one (so every trainee already stamped with '01' still finds
       centre 01), and its id otherwise — which is unique, already on the
       record, and identical on every device without anything having to be
       assigned first. It is never shown to anybody: centreLabel() still reads
       "01. Welding & Fabrication". */
    function centreIdentity(centre) {
      if (!centre) return '';
      var k = centreKeyOf(centre);
      if (k) return k;
      var id = centre.id == null ? '' : String(centre.id).trim();
      return id ? ('#' + id) : '';
    }

    /* Split a written programme name into the key it states and the rest.
         '02. Welding and Fabrication' -> { key: '02', name: 'Welding and Fabrication' }
         'WELDING L2'                  -> { key: '',   name: 'WELDING L2' }
       Only a leading run of digits followed by a dot counts, so a name that
       merely begins with a number ("2 Day Induction") is left alone. */
    function parseCentreLabel(label) {
      var s = String(label == null ? '' : label).trim();
      var m = /^(\d{1,4})\s*[.)]\s*(.+)$/.exec(s);
      if (!m) return { key: '', name: s };
      return { key: padKey(m[1]), name: m[2].trim() };
    }

    /* A centre's full name, key first. This is what the Centre reads on the
       page and what the fee side prices, so two intakes of one programme are
       two plainly different things. */
    function centreLabel(centre) {
      if (!centre || !centre.name) return '';
      var k = centreKeyOf(centre);
      var bare = parseCentreLabel(centre.name).name;   // never double-prefix
      return k ? (k + '. ' + bare) : bare;
    }

    /* Give every centre that has no key one of its own, in place. Safe to run
       on every load: a centre that already has a key is left alone. Returns
       how many were stamped.

       The allocation must not depend on the ORDER the centres happen to sit in.
       It used to: the leftovers were numbered by walking the array, so the same
       two centres came out '01','02' on a device that held them one way round
       and '02','01' on a device that held them the other. Roster order really
       does differ between devices — reconcileSnapshot keeps the local order and
       appends whatever the snapshot had on the end, and syncFromCloud pushes
       cloud-only centres onto the end too — so this quietly handed the same
       trainee's centreKey stamp to a DIFFERENT programme on each machine. Every
       sync then swapped the rolls back and forth between two centres, which is
       the drift the Centre was watching.

       Leftovers are therefore numbered in a fixed order — by their id, which is
       the one thing about a centre that is the same everywhere — so any two
       devices holding the same centres agree on the keys without having to talk
       to each other. Centres that already carry a key keep it, so nothing
       already stamped on a trainee moves. */
    /* `reservedKeys` (optional) are keys no new centre may take although no
       live centre carries them: the keys of deleted intakes still stamped on
       trainee and fee records. Without it, a new centre created after the
       newest intake was deleted was handed that intake's key — and with it,
       on day one, every trainee who had been on the deleted intake. */
    function assignCentreKeys(areas, reservedKeys) {
      if (!Array.isArray(areas)) return 0;
      var taken = {}, n = 0, i;
      for (i = 0; i < areas.length; i++) {
        if (!areas[i]) continue;
        var k = areas[i].centreKey != null ? padKey(areas[i].centreKey) : '';
        if (k) taken[k] = true;
      }
      (Array.isArray(reservedKeys) ? reservedKeys : []).forEach(function (rk) {
        var p = padKey(rk);
        if (p) taken[p] = true;
      });

      // Everything still unkeyed, in a device-independent order.
      var pending = [];
      for (i = 0; i < areas.length; i++) {
        var a = areas[i];
        if (!a || (a.centreKey != null && String(a.centreKey).trim() !== '')) continue;
        pending.push(a);
      }
      pending.sort(function (x, y) {
        var xi = x.id == null ? '' : String(x.id), yi = y.id == null ? '' : String(y.id);
        // Numeric ids sort as numbers so 2 comes before 10, not after it.
        var xn = /^\d+$/.test(xi), yn = /^\d+$/.test(yi);
        if (xn && yn) return Number(xi) - Number(yi);
        if (xn !== yn) return xn ? -1 : 1;            // numbered centres first
        return xi < yi ? -1 : (xi > yi ? 1 : 0);
      });

      var next = 1;
      var free = function () {
        while (taken[padKey(next)]) next++;
        var k = padKey(next);
        taken[k] = true;
        return k;
      };
      for (i = 0; i < pending.length; i++) {
        var c = pending[i];
        // The id is the centre's identity already, so it gives a key that is
        // unique and the same on every device — but never one already taken.
        var fromId = c.id != null ? numericKey(c.id) : '';
        c.centreKey = (fromId && !taken[fromId]) ? (taken[fromId] = true, fromId) : free();
        n++;
      }
      return n;
    }

    // Joining words that carry no meaning when two course names are compared.
    var STOP_WORDS = { and: 1, the: 1, of: 1, for: 1, with: 1, amp: 1 };

    /* Split a course name into the words worth comparing. The Centre writes the
       same programme two ways — "WELDING L2" on the fee side, "Welding and
       Fabrication Level 2" on the LMS side — so the level shorthand (L2 / Lvl 2)
       is expanded to "level 2" before anything is compared. */
    function tokenise(name) {
      return norm(name)
        .replace(/[&/,+.\-–—()'"]+/g, ' ')
        .replace(/\b(?:l|lvl|lev)\s*([1-9])\b/g, 'level $1')
        .replace(/\s+/g, ' ').trim()
        .split(' ').filter(Boolean);
    }

    /* The NVQ level a name states, or null when it states none. Two programmes
       at different levels are never the same centre, however alike they read. */
    function levelOfTokens(toks) {
      for (var i = 0; i < toks.length - 1; i++) {
        if (toks[i] === 'level' && /^[1-9]$/.test(toks[i + 1])) return toks[i + 1];
      }
      return null;
    }

    /* The distinguishing words of a name: no level marker, no bare numbers, no
       joining words, nothing shorter than three letters. */
    function keyWords(toks) {
      var out = [], seen = {};
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (t === 'level' || STOP_WORDS[t] || t.length < 3 || /^[0-9]+$/.test(t)) continue;
        if (!seen[t]) { seen[t] = 1; out.push(t); }
      }
      return out;
    }

    /* Two words naming the same thing: identical, or one the shortened form of
       the other ("admin" / "administration", "commi" / "commis"). The shortened
       form must be at least four letters, so a chance three-letter opening does
       not join two unrelated programmes. */
    function sameWord(a, b) {
      if (a === b) return true;
      var short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
      return short.length >= 4 && long.indexOf(short) === 0;
    }

    /* Can these two written programmes be two spellings of ONE enrolment?

       The Centre writes a programme several ways — 'Welding & Fabrication',
       'WELDING L2', '02. Welding & Fabrication' — and the same trainee could
       end up recorded once under each. Those are one enrolment.

       But the Centre also runs the SAME subject at two NVQ levels, and a
       trainee who did Welding L2 and went on to Welding L3 has two enrolments,
       each with its own tuition, attendance and certificate. And two different
       people genuinely share a name. Treating every same-named pair as one
       record is what took the roll from 447 to 220.

       So: agree when nothing contradicts, disagree when something does —
         - a record naming no programme contradicts nothing;
         - two DIFFERENT intake keys are two intakes ('01' vs '02');
         - two DIFFERENT stated levels are two programmes (L2 vs L3);
         - distinguishing words that do not line up are two programmes
           (Welding vs Cosmetology).
       Level shorthand is expanded first, so 'WELDING L2' and 'Welding and
       Fabrication Level 2' still agree. */
    /* The NVQ level a written programme states, or null. Exported because the
       level is what tells one enrolment of a subject from the next, so anything
       deciding "same enrolment?" has to be able to see it. */
    function programmeLevel(written) {
      return levelOfTokens(tokenise(parseCentreLabel(written).name));
    }

    function programmesAgree(a, b) {
      var pa = parseCentreLabel(a), pb = parseCentreLabel(b);
      if (pa.key && pb.key && pa.key !== pb.key) return false;
      var an = norm(pa.name), bn = norm(pb.name);
      if (!an || !bn) return true;
      if (an === bn) return true;
      var at = tokenise(pa.name), bt = tokenise(pb.name);
      var al = levelOfTokens(at), bl = levelOfTokens(bt);
      if (al && bl && al !== bl) return false;
      var aw = keyWords(at), bw = keyWords(bt);
      if (!aw.length || !bw.length) return true;
      // The shorter list must be found in the longer one: 'WELDING L2' (welding)
      // is the shorthand for 'Welding & Fabrication' (welding, fabrication).
      var few = aw.length <= bw.length ? aw : bw;
      var many = aw.length <= bw.length ? bw : aw;
      for (var i = 0; i < few.length; i++) {
        var found = false;
        for (var j = 0; j < many.length; j++) {
          if (sameWord(few[i], many[j])) { found = true; break; }
        }
        if (!found) return false;
      }
      return true;
    }

    function registerOpen(centre, today, nowMs) {
      if (!centre) return false;
      return Core.courseDuration.isRegisterOpen(centre, today, nowMs);
    }

    function coversDate(centre, on) {
      var s = Core.courseDuration.normDate(centre.startDate);
      var e = Core.courseDuration.normDate(centre.endDate);
      return (!s || on >= s) && (!e || on <= e);
    }

    /* A programme that has been run more than once has several centres with the
       same (or an equivalent) name — last year's finished intake and this year's
       new one. Which of them is meant depends on what is being asked:

         • Enrolling somebody now (the default): the centre that can still take
           trainees and, among those, the most recent. Without this the
           dashboards resolved a repeat programme to the finished centre and
           reported "course ended" even though a new centre had been created.

         • Grounding a record in time (opts.on = the date it belongs to): the
           intake that was actually running on that date, falling back to the
           most recent one that had already begun. A trainee who enrolled in
           2024 belongs to the 2024 intake, not to whatever opened since. */
    function preferCentre(a, b, opts) {
      if (!a) return b || null;
      if (!b) return a;
      opts = opts || {};
      var as = Core.courseDuration.normDate(a.startDate) || '';
      var bs = Core.courseDuration.normDate(b.startDate) || '';
      var on = opts.on ? Core.courseDuration.normDate(opts.on) : '';

      if (on) {
        var ac = coversDate(a, on), bc = coversDate(b, on);
        if (ac !== bc) return ac ? a : b;
        var ab = !!as && as <= on, bb = !!bs && bs <= on;   // had already begun
        if (ab !== bb) return ab ? a : b;
        if (ab && bb) return as > bs ? a : b;               // the most recent one that had
        if (as !== bs) return as < bs ? a : b;              // both still ahead: the soonest
        return a;
      }

      var ao = registerOpen(a, opts.today, opts.nowMs), bo = registerOpen(b, opts.today, opts.nowMs);
      if (ao !== bo) return ao ? a : b;
      if (as !== bs) return as > bs ? a : b;
      return a;
    }

    /* Resolve a centre by name against a roster of skill areas / training
       centres, in three widening passes:
         1. the exact name (case/space-insensitive);
         2. one name starting the other, so "Welding" finds "Welding & Fabrication";
         3. the same programme written two ways — every distinguishing word of
            the shorter name appearing in the longer one at the same NVQ level,
            so "WELDING L2" finds "Welding and Fabrication Level 2" but never
            "… Level 3".
       Between equally good matches the choice is made by preferCentre, and a
       later pass only runs when the earlier ones found nothing.

       An intake KEY settles it outright. A name written "02. Welding and
       Fabrication", or an explicit opts.centreKey, names one centre and one
       only: if that centre is not in the roster the answer is nothing at all,
       never a like-named intake. This is what keeps a trainee with the intake
       they were enrolled in when the Centre opens the next one under the same
       name.

       opts: { today, nowMs, on, centreKey, exact } — all optional. 'on' is a
       date the answer should belong to; without it the answer is about now.

       opts.exact: the intake key and the exact name only (case and spacing
       aside) — no widening passes. For anything that WRITES the answer onto a
       stored record. The looser passes read "Welding" as shorthand for
       "Welding & Fabrication", which is right for the Centre's own shorthand
       and wrong for a device that simply has not received the centre that IS
       called "Welding" yet: written down, that guess moved the new centre's
       trainees onto the other one on every device, and their ids with them. */
    function findCentre(areas, courseName, opts) {
      if (!Array.isArray(areas) || !courseName) return null;
      opts = opts || {};
      var parsed = parseCentreLabel(courseName);
      var wantKey = padKey(opts.centreKey || parsed.key);
      var cn = norm(wantKey ? parsed.name : courseName);
      var hit = null, i, n;

      if (wantKey) {
        for (i = 0; i < areas.length; i++) {
          if (areas[i] && centreKeyOf(areas[i]) === wantKey) return areas[i];
        }
        return null;                 // that intake is not here — never another one
      }
      if (!cn) return null;

      for (i = 0; i < areas.length; i++) {
        if (areas[i] && norm(parseCentreLabel(areas[i].name).name) === cn) hit = preferCentre(hit, areas[i], opts);
      }
      if (hit || opts.exact) return hit;

      var qT = tokenise(cn), qL = levelOfTokens(qT), qW = keyWords(qT);

      /* One name starting the other — and here too the level decides first.

         Every programme name is a prefix of its own Level 2: "Electrical
         Installation" starts "Electrical Installation Level 2", and a bare
         "ELECTRICAL" starts both. This pass had no level test at all, so both
         intakes matched and preferCentre picked between them by whose register
         was OPEN — which handed the trainees of a finished programme to the new
         Level 2 intake the moment it opened, and moved them again whenever that
         changed. Same rule as the word-matching pass below: a centre stating
         the level being asked for is preferred outright, and the looser reading
         is used only when none does. */
      function prefixScan(exact) {
        var found = null;
        for (var i3 = 0; i3 < areas.length; i3++) {
          var a3 = areas[i3];
          if (!a3) continue;
          var bare = parseCentreLabel(a3.name).name;
          var nn = norm(bare);
          if (!nn) continue;
          if (nn.indexOf(cn) !== 0 && cn.indexOf(nn) !== 0) continue;
          if (exact && levelOfTokens(tokenise(bare)) !== qL) continue;
          found = preferCentre(found, a3, opts);
        }
        return found;
      }
      hit = prefixScan(true) || prefixScan(false);
      if (hit) return hit;

      if (!qW.length) return null;

      /* Score the roster on shared words. `exact` restricts it to centres
         stating the SAME level as the query — where stating none counts as a
         level of its own.

         Run strictly FIRST, because the two are not equally good answers. The
         Centre writes its programmes both ways: some centres carry the level in
         their name ("Electrical Installation Level 2") and some do not
         ("Welding and Fabrication", run twice), while the fee side writes the
         level either way ("ELECTRICAL L2"). Matching loosely — the old rule,
         which only rejected a candidate when BOTH sides named a level — meant a
         Level 2 query matched an unlevelled centre on one shared word, so
         "ELECTRICAL L2" trainees were counted in the Level 1 intake and a plain
         "Electrical Installation" could reach the Level 2 centre. That is the
         two electrical programmes taking trainees from each other.

         Matching ONLY strictly is wrong too: where a programme's centres carry
         no level at all, "WELDING L2" has no exact-level centre to find and
         must still resolve to the intake open now. So the loose pass remains,
         as the fallback it always should have been — used only when nothing
         states the level being asked for. */
      function scan(exact) {
        var best = null, bestScore = 0;
        for (var i2 = 0; i2 < areas.length; i2++) {
          var area = areas[i2];
          if (!area || !area.name) continue;
          var aT = tokenise(parseCentreLabel(area.name).name), aL = levelOfTokens(aT), aW = keyWords(aT);
          if (!aW.length) continue;
          if (exact) { if (aL !== qL) continue; }              // same level, or both unlevelled
          else if (qL && aL && qL !== aL) continue;            // Level 2 is never Level 3
          var shared = 0;
          for (var k = 0; k < qW.length; k++) {
            for (var m = 0; m < aW.length; m++) {
              if (sameWord(qW[k], aW[m])) { shared++; break; }
            }
          }
          // Every distinguishing word of the shorter name must appear in the
          // longer one — an overlap of merely one word out of several is a
          // different programme, not an abbreviation of this one.
          if (!shared || shared < Math.min(qW.length, aW.length)) continue;
          if (shared > bestScore) { bestScore = shared; best = area; }
          else if (shared === bestScore) { best = preferCentre(best, area, opts); }
        }
        return best;
      }
      return scan(true) || scan(false);
    }

    /* Fiscal year (Apr–Mar) that a date belongs to, e.g. '2025/2026'. */
    function fiscalYearOf(dateStr) {
      var dq = Core.deriveQuarter(dateStr);
      return dq ? dq.fy : null;
    }

    /* The FY a centre's intake belongs to — taken from its start date, falling
       back to its end date when only that is set. */
    function centreFiscalYear(centre) {
      if (!centre) return null;
      return fiscalYearOf(centre.startDate) || fiscalYearOf(centre.endDate) || null;
    }

    /* canEnrol(areas, courseName, opts) -> decision
         opts.today      'YYYY-MM-DD' (defaults to the real today)
         opts.enrolDate  the intended enrolment date, if one was entered
         opts.nowMs      for instructor reopen permissions
       decision = { allowed, code, reason, centre, status, fy }
       codes: 'ok' | 'no-course' | 'no-roster' | 'no-centre' | 'ended'
              | 'enrol-after-end' */
    function canEnrol(areas, courseName, opts) {
      opts = opts || {};
      var today = Core.courseDuration.todayStr(opts.today);

      if (!courseName) {
        return { allowed: false, code: 'no-course', centre: null, status: null, fy: null,
          reason: 'Select the training centre / course the trainee is being enrolled into.' };
      }
      if (!Array.isArray(areas) || !areas.length) {
        return { allowed: false, code: 'no-roster', centre: null, status: null, fy: null,
          reason: 'The list of training centres could not be read, so this enrolment cannot be verified.\n\n' +
                  'Open the LMS (or sync it) so the training centres and their durations are available, then try again.' };
      }
      var centre = findCentre(areas, courseName, { today: today, nowMs: opts.nowMs });
      if (!centre) {
        return { allowed: false, code: 'no-centre', centre: null, status: null, fy: null,
          reason: 'There is no training centre named "' + courseName + '".\n\n' +
                  'Create the training centre (with its start and end dates) before enrolling trainees into it.' };
      }

      var status = Core.courseDuration.status(centre.startDate, centre.endDate, today);
      var fy = centreFiscalYear(centre);

      // Course finished — a new intake needs a NEW centre with a fresh duration.
      if (status === 'ended' && !Core.courseDuration.permissionActiveAt(centre.instructorPermissions, opts.nowMs)) {
        return { allowed: false, code: 'ended', centre: centre, status: status, fy: fy,
          reason: 'The course "' + centre.name + '" ENDED' + (centre.endDate ? ' on ' + centre.endDate : '') +
                  ', so new trainees can no longer be enrolled into it.\n\n' +
                  'Create a NEW training centre with a new duration (and fiscal year) before adding new trainees.' };
      }

      // An enrolment cannot be dated after the centre's course has finished:
      // that would ground the trainee outside the centre's duration/fiscal year.
      var ed = Core.courseDuration.normDate(opts.enrolDate);
      var endD = Core.courseDuration.normDate(centre.endDate);
      if (ed && endD && ed > endD) {
        return { allowed: false, code: 'enrol-after-end', centre: centre, status: status, fy: fy,
          reason: 'The enrolment date ' + ed + ' falls after "' + centre.name + '" ends (' + endD + ').\n\n' +
                  'Enrol the trainee within the course duration, or create a new training centre for the next intake.' };
      }

      return { allowed: true, code: 'ok', centre: centre, status: status, fy: fy, reason: '' };
    }

    /* The stamp written onto a student record so their data is grounded in the
       course duration and fiscal year they actually belong to. */
    function enrolmentStamp(centre, enrolDate) {
      if (!centre) return null;
      var ed = Core.courseDuration.normDate(enrolDate) || Core.courseDuration.todayStr();
      return {
        centreId: centre.id != null ? centre.id : null,
        // The intake key is stamped alongside the id: it is what binds this
        // trainee to THIS intake, so the next one opened under the same name
        // never claims them.
        centreKey: centreKeyOf(centre),
        centreName: centre.name || '',
        centreLabel: centreLabel(centre),
        courseStart: Core.courseDuration.normDate(centre.startDate) || '',
        courseEnd: Core.courseDuration.normDate(centre.endDate) || '',
        enrolmentDate: ed,
        // The intake's FY (from the centre) is what reporting groups by; the
        // enrolment's own FY is kept too so a mid-year transfer stays visible.
        fiscalYear: centreFiscalYear(centre) || fiscalYearOf(ed) || null,
        enrolmentFiscalYear: fiscalYearOf(ed) || null
      };
    }

    /* Does an already-enrolled student belong to the given fiscal year?
       Falls back to their enrolment/creation date for legacy records that were
       saved before enrolments were stamped. */
    function studentInFiscalYear(student, fy) {
      if (!student || !fy) return false;
      if (student.fiscalYear) return student.fiscalYear === fy;
      var d = student.enrolmentDate || student.enrollmentDate || student.createdAt;
      return fiscalYearOf(d) === fy;
    }

    /* Centres that may currently take new trainees — used to build the course
       dropdowns so ended centres are never offered in the first place. */
    function openCentres(areas, today, nowMs) {
      if (!Array.isArray(areas)) return [];
      return areas.filter(function (a) {
        if (!a || !a.name) return false;
        return canEnrol(areas, a.name, { today: today, nowMs: nowMs }).allowed;
      });
    }

    return {
      findCentre: findCentre,
      centreKeyOf: centreKeyOf,
      centreIdentity: centreIdentity,
      centreLabel: centreLabel,
      parseCentreLabel: parseCentreLabel,
      assignCentreKeys: assignCentreKeys,
      fiscalYearOf: fiscalYearOf,
      centreFiscalYear: centreFiscalYear,
      canEnrol: canEnrol,
      enrolmentStamp: enrolmentStamp,
      studentInFiscalYear: studentInFiscalYear,
      openCentres: openCentres,
      programmesAgree: programmesAgree,
      programmeLevel: programmeLevel
    };
  })();

  /* ==========================================================================
     Core.catalogue — the one answer to "which programmes may a dropdown offer?"

     Every dashboard used to build that list the same wrong way: take the
     training centres, then UNION IN every course name written on a student
     record and every programme on a user account. That union is why a centre
     deleted on the Training Centres page kept turning up as an option on
     Student Progress, School Fee and everywhere else — one old record still
     carried the name, so the name came straight back, and each page grew a
     longer list than the one before it.

     The training centres are the source of truth. A name no live centre
     answers to is not a programme the Centre runs; it is a leftover on an old
     record. Those names are still needed — a filter has to be able to find
     those trainees, and an edit form must not silently reassign one — so they
     are returned SEPARATELY, labelled archived, and never offered as a place
     to enrol somebody new.
     ========================================================================== */
  Core.catalogue = (function () {
    var DELETED_KEY = 'voctrain_deletedCentreIds';

    function norm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }

    function storeOf(store) { return store || root.CESTISStore || null; }

    /* Ids of training centres that have been deleted. A deletion has to be
       written down: without it the next merge (another tab, the cloud backup)
       sees the centre still present in the other copy, reads it as "missing
       here", and puts it back — which is how a deleted centre reappeared. */
    function deletedIds(store) {
      var s = storeOf(store);
      if (!s) return [];
      try {
        var raw = s.getItem(DELETED_KEY);
        var ids = raw ? JSON.parse(raw) : [];
        return Array.isArray(ids) ? ids.map(String) : [];
      } catch (e) { return []; }
    }

    function recordDeleted(store, id) {
      var s = storeOf(store);
      if (!s || id == null) return deletedIds(store);
      var ids = deletedIds(s);
      if (ids.indexOf(String(id)) === -1) ids.push(String(id));
      try { s.setItem(DELETED_KEY, JSON.stringify(ids)); } catch (e) {}
      return ids;
    }

    /* Re-creating a centre under an id that was deleted before clears its
       tombstone, so a deliberate re-add is never suppressed by an old delete. */
    function clearDeleted(store, id) {
      var s = storeOf(store);
      if (!s || id == null) return deletedIds(store);
      var ids = deletedIds(s).filter(function (x) { return x !== String(id); });
      try { s.setItem(DELETED_KEY, JSON.stringify(ids)); } catch (e) {}
      return ids;
    }

    function isDeleted(id, store) {
      return id != null && deletedIds(store).indexOf(String(id)) !== -1;
    }

    /* The centres that still exist: the stored roster minus everything whose
       deletion has been written down, and minus unnamed rubbish. Every page
       builds its dropdowns through here, so one delete is a delete everywhere. */
    function liveCentres(areas, store) {
      if (!Array.isArray(areas)) return [];
      var gone = deletedIds(store);
      return areas.filter(function (a) {
        if (!a || !a.name || !String(a.name).trim()) return false;
        return a.id == null || gone.indexOf(String(a.id)) === -1;
      });
    }

    /* The programme names a dropdown may offer — one per live training centre,
       written the way the centre itself is written, de-duplicated and sorted. */
    function courseNames(areas, store) {
      var seen = {}, out = [];
      liveCentres(areas, store).forEach(function (a) {
        var name = String(a.name).trim();
        var k = norm(name);
        if (k && !seen[k]) { seen[k] = true; out.push(name); }
      });
      return out.sort(function (a, b) { return a.localeCompare(b); });
    }

    /* True when a live training centre answers to this exact name.

       Deliberately an exact (case/spacing-insensitive) comparison rather than
       enrolment.findCentre's tolerant matching: a loose match would fold
       "Welding" into "Welding & Fabrication", and the trainees recorded under
       the bare name would then be unreachable from every filter. */
    function isLive(areas, name, store) {
      var k = norm(name);
      if (!k) return false;
      return liveCentres(areas, store).some(function (a) { return norm(a.name) === k; });
    }

    /* Names still written on records that no live centre answers to — a centre
       that has since been deleted, or a spelling from before the centres were
       set up. `values` is the raw list off the records (duplicates and blanks
       are fine). These are what a FILTER must keep offering so those people
       stay findable; an enrolment dropdown must not offer them at all. */
    function orphanNames(areas, values, store) {
      var live = {}, seen = {}, out = [];
      liveCentres(areas, store).forEach(function (a) { live[norm(a.name)] = true; });
      (Array.isArray(values) ? values : []).forEach(function (v) {
        var name = String(v == null ? '' : v).trim();
        var k = norm(name);
        if (!k || live[k] || seen[k]) return;
        seen[k] = true;
        out.push(name);
      });
      return out.sort(function (a, b) { return a.localeCompare(b); });
    }

    /* Everything a page needs to build one dropdown, in one call:
         { courses: [live centre names], archived: [orphan names] }
       Pass the record values a filter has to keep reachable via `values`. */
    function options(areas, values, store) {
      return {
        courses: courseNames(areas, store),
        archived: orphanNames(areas, values, store)
      };
    }

    /* The id for a NEW training centre: one more than any id this Centre has
       ever used — live centres AND deleted ones.

       It used to be one more than the highest LIVE id, so deleting the newest
       intake freed its id and the next centre created took it. The deletion is
       written down by id and that list is merged by union on every device, so
       at the next sync the brand-new centre was hidden as "deleted"; until then
       it inherited the deleted intake's trainees (their records carry its id
       and key) and its chat room. Ids are never reused now, so a deletion only
       ever applies to the centre that was deleted. `extraIds` lets a caller add
       ids known elsewhere (the chat rooms of deleted centres). */
    function nextCentreId(areas, store, extraIds) {
      var max = 0;
      var see = function (v) {
        var s = String(v == null ? '' : v).trim();
        if (!/^\d+$/.test(s)) return;
        var n = Number(s);
        if (n > max) max = n;
      };
      (Array.isArray(areas) ? areas : []).forEach(function (a) { if (a) see(a.id); });
      deletedIds(store).forEach(see);
      (Array.isArray(extraIds) ? extraIds : []).forEach(see);
      return max + 1;
    }

    return {
      DELETED_KEY: DELETED_KEY,
      deletedIds: deletedIds,
      nextCentreId: nextCentreId,
      recordDeleted: recordDeleted,
      clearDeleted: clearDeleted,
      isDeleted: isDeleted,
      liveCentres: liveCentres,
      courseNames: courseNames,
      isLive: isLive,
      orphanNames: orphanNames,
      options: options
    };
  })();

  /* How far one copy of a School Fee record can be trusted against another.

     0 — a PLACEHOLDER: the record the LMS mirror (or the fee page seeding itself
     from the trainee roll) makes for a trainee it has no fee record for. It is
     flagged needsFeeDetails and carries nothing a person typed on the fee page:
     no ID, address, date of birth, guardian or emergency contact, and nothing
     paid. 1 — anything else.

     A brand-new PC makes a placeholder for every trainee the moment its
     dashboard has the roll and not yet the fee roll. Those copies are dated
     NOW, so every merge judged on dates let them beat the Centre's real fee
     records: on the new PC every trainee's tuition read $0 and their ID,
     address and guardian were blank (found by the upgrade verifier, Drive
     scenario). A placeholder never outranks a real record, whatever its date;
     two copies of the same rank are settled by date as before. */
  Core.feeRecordRank = function (r) {
    if (!r || typeof r !== 'object') return 0;
    if (r.needsFeeDetails !== true) return 1;
    var typed = ['nationalId', 'address', 'city', 'dateOfBirth', 'parentName', 'parentContact', 'emergencyContact'];
    for (var i = 0; i < typed.length; i++) {
      var v = r[typed[i]];
      if (v != null && String(v).trim() !== '') return 1;
    }
    return (parseFloat(r.totalPaid) || 0) > 0 ? 1 : 0;
  };
  // What a placeholder never hands on to the real record it loses to.
  Core.FEE_PLACEHOLDER_FIELDS = ['needsFeeDetails', 'source'];

  /* The School Fee record a dashboard student belongs to.

     The mirror the other way (lmsMirrorTarget) already refuses to duplicate a
     person; this is the same rule pointing back. Matching on name AND
     programme meant that the moment the two sides named a programme
     differently — after a transfer, or because the fee page prices intakes by
     their key — the same trainee read as a stranger and a SECOND fee record
     was minted for them, with no fee and no payments.

     Unlike the dashboard, the fee page may hold a programme of its own, so
     there is no training centre to satisfy here: being the same person is the
     whole test.

       feeMirrorTarget(student, feeStudents, opts) -> { action: 'link'|'create'|'skip', match, reason }

     opts.index — a Core.feeTwinIndex over the same roll. The mirror runs on
     every save, once per student; without an index that is two scans of the
     whole fee roll per student, normalising names all the way. */
  Core.feeMirrorTarget = function (student, feeStudents, opts) {
    var list = Array.isArray(feeStudents) ? feeStudents : [];
    if (!student || !Core.normName(student.name)) {
      return { action: 'skip', match: null, reason: 'no-name' };
    }
    var idx = (opts && opts.index) || null;
    var course = student.course || student.skillArea || '';
    var i;
    if (idx) {
      var hit = idx.find(student);
      if (hit) return { action: 'link', match: hit, reason: 'twin' };
      var named = idx.findByPerson(student.name, course);
      if (named) return { action: 'link', match: named, reason: 'same-person-other-programme' };
      return { action: 'create', match: null, reason: 'ok' };
    }
    for (i = 0; i < list.length; i++) {
      if (list[i] && Core.isFeeTwin(student, list[i])) {
        return { action: 'link', match: list[i], reason: 'twin' };
      }
    }
    var want = Core.normName(student.name);
    for (i = 0; i < list.length; i++) {
      if (list[i] && Core.normName(list[i].name) === want &&
          feeProgrammesAgree(list[i].skillArea || list[i].course, course)) {
        return { action: 'link', match: list[i], reason: 'same-person-other-programme' };
      }
    }
    return { action: 'create', match: null, reason: 'ok' };
  };

  // The by-name fallback's programme test, shared by the indexed and the
  // scanning path so both mirrors answer alike. Tolerant of the two sides
  // spelling one programme differently; not of two different programmes.
  function feeProgrammesAgree(a, b) {
    var E = Core.enrolment;
    if (!E || typeof E.programmesAgree !== 'function') return true;
    try { return E.programmesAgree(a, b); } catch (e) { return true; }
  }

  /* Core.feeTwinIndex(feeStudents) — Core.twinIndex pointing the other way.

     twinIndex indexes the dashboard roster and is asked "whose twin is this fee
     record?"; this indexes the FEE roll and is asked "which fee record belongs
     to this student?" — the question the save-time mirror asks once per
     student.

       idx.find(student)    -> the same record feeStudents.find(f => isFeeTwin(student, f)) would
       idx.findByName(name) -> the first fee record of that name, under any programme
       idx.add(feeRecord)   -> keep the index current when one is appended

     Ties resolve by ROLL ORDER, so it returns exactly what the scan returned. */
  Core.feeTwinIndex = function (feeStudents) {
    var list = Array.isArray(feeStudents) ? feeStudents : [];
    var byFeeId = new Map(), byLmsId = new Map(), byName = new Map();

    function putFirst(map, key, i) {
      if (key == null || key === '') return;
      var k = String(key);
      if (!map.has(k)) map.set(k, i);
    }
    function index(f, i) {
      if (!f) return;
      putFirst(byFeeId, f.id, i);
      putFirst(byLmsId, f.lmsId, i);
      var n = Core.normName(f.name);
      if (!n) return;
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(i);
    }
    for (var i = 0; i < list.length; i++) index(list[i], i);

    function find(student) {
      if (!student) return null;
      var best = -1;
      var consider = function (at) { if (at != null && at >= 0 && (best < 0 || at < best)) best = at; };
      var sid = hasId(student.id) ? String(student.id) : '';

      if (sid) {
        consider(byLmsId.get(sid));                       // fee.lmsId === student.id
        consider(byFeeId.get(sid));                       // fee.id === student.id
        // student.id === 'SF-' + fee.id — the fee page's mirrored twin id.
        if (sid.indexOf('SF-') === 0) consider(byFeeId.get(sid.slice(3)));
      }
      if (hasId(student.schoolFeeId)) consider(byFeeId.get(String(student.schoolFeeId)));

      var n = Core.normName(student.name);
      if (n) {
        var cand = byName.get(n);
        if (cand) {
          for (var j = 0; j < cand.length; j++) {
            if (sameTwinIdentity(student.name, student.course, list[cand[j]])) { consider(cand[j]); break; }
          }
        }
      }
      return best >= 0 ? list[best] : null;
    }

    function findByName(name) {
      var n = Core.normName(name);
      var cand = n ? byName.get(n) : null;
      return (cand && cand.length) ? list[cand[0]] : null;
    }

    /* This person's fee record for a programme that does not contradict the one
       asked about — see twinIndex.findByPerson for why the plain by-name answer
       is too much. A trainee on Welding L2 and Welding L3 needs a fee record for
       each: each carries its own tuition. */
    function findByPerson(name, course) {
      var n = Core.normName(name);
      var cand = n ? byName.get(n) : null;
      if (!cand) return null;
      for (var j = 0; j < cand.length; j++) {
        var f = list[cand[j]];
        if (f && feeProgrammesAgree(f.skillArea || f.course, course)) return f;
      }
      return null;
    }

    function add(record) {
      if (!record) return;
      if (list[list.length - 1] !== record) list.push(record);
      index(record, list.length - 1);
    }

    return { find: find, findByName: findByName, findByPerson: findByPerson,
      add: add, get size() { return list.length; } };
  };

  /* ==========================================================================
     TRANSFERRING TRAINEES BETWEEN TRAINING CENTRES

     A trainee sometimes has to be moved: a programme is re-run and the class
     carries over, somebody was enrolled into the wrong intake, a centre is
     being wound up. Moving them by hand means editing the same person in the
     LMS, in their attendance, on their account and again in School Fee — and
     whatever is missed leaves them half in one centre and half in another.

     The move is one rule, applied to every list that names a centre. What
     identifies a trainee's centre is the same everywhere: the intake key
     stamped on them, then the centre id, then the programme name they carry
     resolved as of the day they enrolled. What the move writes is the target
     centre's stamps — key, id, name, dates, fiscal year — and the moment it
     happened, so the timestamp merges keep the move instead of a stale copy
     from another device undoing it.
     ========================================================================== */
  Core.transfer = (function () {
    var E = Core.enrolment;

    function nameOf(rec, field) {
      return String((rec && rec[field]) == null ? '' : rec[field]).trim();
    }

    /* Did this trainee enrol BEFORE the intake we are about to credit them to
       had even begun?

       This is the last guard on the name fallback, and it exists because a
       programme name is not an intake. When a Centre re-runs a programme, the
       earlier trainees keep the programme's name on their record and no intake
       key — keys came later, so every record predating them has none. Asked
       "which centre is 'Welding & Fabrication'?", findCentre can only answer
       with the one centre carrying that name, so every trainee the programme
       ever had piled onto the intake running now: three past intakes read as
       three times the roll, on a card that should have shown only the trainees
       actually in it.

       Proof is the whole bar here, and it takes two things, because enrolling
       shortly BEFORE an intake opens is ordinary — trainees are registered
       weeks ahead of the start date all the time, and none of them may be
       dropped. So the record must have enrolled before this intake began AND
       in a different fiscal year from it. A trainee signed up in July for an
       August intake shares its fiscal year and is kept; one who enrolled two
       years earlier does not, and is the earlier intake's.

       With no enrolment date on the record, no start date on the centre, or a
       date that will not parse, nothing is proven and the record is treated
       exactly as it was before. This never overrides an explicit stamp — a
       keyed record has already said where it belongs. */
    function enrolledBeforeIntake(rec, centre) {
      if (!rec || !centre) return false;
      var start = String(centre.startDate || '').trim();
      if (!start) return false;                       // the intake never said when it began
      var on = String(rec.enrolmentDate || rec.enrollmentDate ||
                      rec.enrollDate || rec.createdAt || '').trim();
      if (!on) return false;                          // the record never said when they joined
      var a = Date.parse(on.slice(0, 10)), b = Date.parse(start.slice(0, 10));
      if (isNaN(a) || isNaN(b)) return false;         // unreadable proves nothing
      if (a >= b) return false;                       // enrolled once it was running
      var fyRec = E.fiscalYearOf(on), fyCentre = E.centreFiscalYear(centre);
      if (!fyRec || !fyCentre) return false;          // cannot place either — keep it
      return fyRec !== fyCentre;                      // a different year's intake
    }

    /* Is this record one of the centre's? Identity first, name last — a name
       is what two intakes of a programme share, so it only ever settles a
       record that carries no stamp at all. */
    function belongsTo(rec, centre, opts) {
      if (!rec || !centre) return false;
      opts = opts || {};
      var field = opts.field || 'course';
      // centreIdentity, not centreKeyOf: an unkeyed centre answers '' to
      // centreKeyOf, and '' === '' made a trainee belong to every unkeyed
      // centre at once. See centreIdentity() for what that did to the rolls.
      var key = E.centreIdentity(centre);
      if (!key) return false;                    // a centre we cannot tell apart holds nobody

      if (rec.centreKey != null && String(rec.centreKey).trim() !== '') {
        return E.centreKeyOf({ centreKey: rec.centreKey }) === key;
      }
      if (rec.centreId != null && centre.id != null) return String(rec.centreId) === String(centre.id);

      var written = nameOf(rec, field) || nameOf(rec, 'course') || nameOf(rec, 'skillArea');
      if (!written) return false;
      var centres = Array.isArray(opts.centres) ? opts.centres : [centre];
      var on = rec.enrolmentDate || rec.enrollmentDate || rec.enrollDate || rec.createdAt || '';
      var found = null;
      try { found = E.findCentre(centres, written, { on: on, today: opts.today, nowMs: opts.nowMs }); }
      catch (e) { found = null; }
      if (!found || E.centreIdentity(found) !== key) return false;
      return !enrolledBeforeIntake(rec, found);
    }

    /* Every record of `list` that belongs to `centre`. */
    function traineesOf(list, centre, opts) {
      if (!Array.isArray(list) || !centre) return [];
      return list.filter(function (r) { return belongsTo(r, centre, opts); });
    }

    /* How many of `list` each centre holds — the same question traineesOf()
       answers, asked once per RECORD instead of once per centre.

       This exists so the Training Centres cards can state the same figure the
       Transfer page does. They used to disagree, badly: the cards decided which
       centre a trainee belonged to from the programme NAME written on them,
       resolved as of today, while everything else decides it from the centre
       stamped on them. A trainee moved back to a finished intake keeps the
       stamp of that intake, so the cards went on counting them under whichever
       intake of that programme happened to be running now — and a brand-new
       centre that had never enrolled anybody showed a roll of trainees who were
       not there, while the centre actually holding them under-reported by the
       same number.

       Returns { counts: { centreKey: n }, of(centre) -> n,
                 groups: { centreKey: [records] }, listOf(centre) -> [records] }
       so a page that needs the roll and a page that needs only the number are
       answered by the same pass, and cannot disagree. */
    function tally(list, centres, opts) {
      opts = opts || {};
      var roster = Array.isArray(centres) ? centres : [];
      var byId = {}, out = {}, groups = {};
      roster.forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });

      // findCentre() is the expensive step and a roll shares a handful of
      // programme names, so each (name, date) pair is resolved once.
      var memo = {};
      function resolveByName(written, on) {
        var mk = written + '\u0000' + (on || '');   // a separator no name can contain
        if (Object.prototype.hasOwnProperty.call(memo, mk)) return memo[mk];
        var found = null;
        try { found = E.findCentre(roster, written, { on: on, today: opts.today, nowMs: opts.nowMs }); }
        catch (e) { found = null; }
        memo[mk] = found;
        return found;
      }

      (Array.isArray(list) ? list : []).forEach(function (rec) {
        if (!rec) return;
        var key = null;
        // Identity first, name last — exactly the order belongsTo() applies.
        if (rec.centreKey != null && String(rec.centreKey).trim() !== '') {
          key = E.centreKeyOf({ centreKey: rec.centreKey });
        } else if (rec.centreId != null) {
          var c = byId[String(rec.centreId)];
          key = c ? E.centreIdentity(c) : null;
        } else {
          var field = opts.field || 'course';
          var written = nameOf(rec, field) || nameOf(rec, 'course') || nameOf(rec, 'skillArea');
          if (written) {
            var on = rec.enrolmentDate || rec.enrollmentDate || rec.enrollDate || rec.createdAt || '';
            var found = resolveByName(written, on);
            // A trainee who enrolled before this intake began is an earlier
            // intake's, not this one's — see enrolledBeforeIntake above.
            key = (found && !enrolledBeforeIntake(rec, found)) ? E.centreIdentity(found) : null;
          }
        }
        if (key) {
          out[key] = (out[key] || 0) + 1;
          (groups[key] || (groups[key] = [])).push(rec);
        }
      });

      return {
        counts: out,
        groups: groups,
        of: function (centre) { return (centre && out[E.centreIdentity(centre)]) || 0; },
        listOf: function (centre) { return (centre && groups[E.centreIdentity(centre)]) || []; }
      };
    }

    /* Write the target centre onto one record. Returns true when anything
       actually changed, so a caller can tell a real move from a no-op. */
    function place(rec, to, opts) {
      if (!rec || !to) return false;
      opts = opts || {};
      var field = opts.field || 'course';
      var name = opts.toName || E.centreLabel(to) || to.name || '';
      var stamp = E.enrolmentStamp(to, rec.enrolmentDate || rec.enrollmentDate || rec.enrollDate || rec.createdAt) || {};
      var before = {
        name: nameOf(rec, field), key: rec.centreKey == null ? '' : String(rec.centreKey)
      };
      var changed = false;

      if (name && rec[field] !== name) { rec[field] = name; changed = true; }
      if (rec.centreId !== stamp.centreId) { rec.centreId = stamp.centreId; changed = true; }
      if (rec.centreKey !== stamp.centreKey) { rec.centreKey = stamp.centreKey; changed = true; }
      if (rec.centreName !== stamp.centreName) { rec.centreName = stamp.centreName; changed = true; }
      if (rec.courseStart !== stamp.courseStart) { rec.courseStart = stamp.courseStart; changed = true; }
      if (rec.courseEnd !== stamp.courseEnd) { rec.courseEnd = stamp.courseEnd; changed = true; }
      if (stamp.fiscalYear && rec.fiscalYear !== stamp.fiscalYear) { rec.fiscalYear = stamp.fiscalYear; changed = true; }

      if (changed) {
        // Written down so the move survives every merge: the newest edit wins,
        // and a device still holding the old centre cannot put it back.
        var now = opts.now || new Date().toISOString();
        rec.lastModified = now;
        if (opts.stampUpdatedAt) rec.updatedAt = now;
        rec.transferredAt = now;
        rec.transferredFrom = opts.fromLabel || before.name || '';
      }
      return changed;
    }

    /* Move trainees from one centre to another, in place.
         opts.field    'course' (LMS) or 'skillArea' (School Fee)
         opts.ids      { id: true } — only these; omit to move every trainee
         opts.idOf     how to read a record's id (default r.id)
         opts.toName   the programme name to write (default the centre's label)
         opts.centres  the full roster, so an unstamped record can be placed
       Returns { moved, movedIds, checked }. */
    function moveTrainees(list, from, to, opts) {
      var out = { moved: 0, movedIds: [], checked: 0 };
      if (!Array.isArray(list) || !from || !to) return out;
      opts = opts || {};
      // centreIdentity, not centreKeyOf: two centres that have not been given a
      // key yet both answer '', so this read as "same centre, nowhere to go"
      // and the transfer silently moved nobody.
      var fromId = E.centreIdentity(from), toId = E.centreIdentity(to);
      if (fromId && toId && fromId === toId) return out;           // nowhere to go
      var idOf = opts.idOf || function (r) { return r && r.id; };
      var only = opts.ids || null;
      var fromLabel = opts.fromLabel || E.centreLabel(from) || from.name || '';
      var now = opts.now || new Date().toISOString();

      list.forEach(function (rec) {
        if (!rec) return;
        if (only && !only[String(idOf(rec))]) return;
        if (!belongsTo(rec, from, opts)) return;
        out.checked++;
        if (place(rec, to, { field: opts.field, toName: opts.toName, now: now,
                             fromLabel: fromLabel, stampUpdatedAt: opts.stampUpdatedAt })) {
          out.moved++;
          out.movedIds.push(idOf(rec));
        }
      });
      return out;
    }

    /* Rename the centre a record merely NAMES, without moving anybody: used for
       the trainee-shaped rows that hang off a trainee (attendance, payments),
       which are matched by the trainee's id rather than by their centre. */
    function renameCourseFor(list, ids, toName, opts) {
      var out = { moved: 0 };
      if (!Array.isArray(list) || !ids || !toName) return out;
      opts = opts || {};
      var field = opts.field || 'course';
      var idOf = opts.idOf || function (r) { return r && r.studentId; };
      var now = opts.now || new Date().toISOString();
      list.forEach(function (rec) {
        if (!rec) return;
        if (!ids[String(idOf(rec))]) return;
        if (rec[field] === toName) return;
        rec[field] = toName;
        rec.lastModified = now;
        out.moved++;
      });
      return out;
    }

    return { belongsTo: belongsTo, traineesOf: traineesOf, tally: tally, place: place,
      moveTrainees: moveTrainees, renameCourseFor: renameCourseFor,
      enrolledBeforeIntake: enrolledBeforeIntake };
  })();

  /* ==========================================================================
     TRANSCRIPT / GRADES ENGINE — shared logic for the Transcript & Grades
     system (admin editor, trainee live view, instructor view, PDF exports).

     WHY THIS EXISTS
     ---------------
     A trainee's final grade for a unit can come from two places:
       1. LIVE EXAMS taken on VocTrain (voctrain_examResults), matched to a
          catalogue unit by unit code / unit name appearing in the exam title.
       2. A MANUAL grade entered (or overridden) by Admin on the
          Transcript/Grades page (voctrain_transcriptGrades).
     A manual record always wins over a live exam score for the same unit.
     Every page (admin, trainee, instructor) must resolve grades identically,
     so the resolution logic lives here — pure and unit-testable in Node.

     STORAGE KEYS (all JSON in CESTISStore; snapshot-synced like the rest)
       voctrain_unitCatalogs          [{id,title,skillArea,level,centre,units:[{code,name,coreElective}]}]
       voctrain_transcriptGrades      [{id,studentId,qualId,unitCode,grade,date,source,examResultId,updatedBy,updatedAt}]
       voctrain_certTranscriptRequests[{id,studentId,studentName,course,type,note,status,requestedAt,handledBy,handledAt}]
       voctrain_transcriptProfiles    {studentId:{dob,address,idNo}}
     ========================================================================== */
  Core.Transcript = (function () {
    var T = {};

    T.KEYS = {
      catalogs: 'voctrain_unitCatalogs',
      grades: 'voctrain_transcriptGrades',
      requests: 'voctrain_certTranscriptRequests',
      profiles: 'voctrain_transcriptProfiles'
    };

    // Institution block rendered on the official transcript — matches the
    // approved paper transcript exactly. Do not restyle without approval.
    T.INSTITUTION = {
      nameLine1: 'Community Educational and Skills Training',
      nameLine2: 'Institute and Services Ltd.',
      centre: 'Hazard Skills Training Centre',
      addressLines: ['Mack Chem Complex', 'Paisley Avenue, May Pen', 'Clarendon, Jamaica'],
      email: 'hazardtrainingcentre@gmail.com',
      tel: '876-679-0111,876-365-2325'
    };

    T.REQUEST_TYPES = { transcript: 'Transcript', certificate: 'Certificate', both: 'Transcript & Certificate' };
    T.REQUEST_STATUSES = ['pending', 'processing', 'ready', 'collected', 'declined'];
    T.REQUEST_STATUS_LABELS = { pending: 'Pending', processing: 'Processing', ready: 'Ready for Collection', collected: 'Collected', declined: 'Declined' };

    /* --- The seeded unit catalogues ---------------------------------------
       BUSINESS ADMINISTRATION (MANAGEMENT) LEVEL 5 is seeded verbatim from the
       institution's approved transcript. The other programmes mirror the
       Qualification Plan page's skill areas; Admin fills their units in from
       the Transcript/Grades input section. */
    var BAM_L5_UNITS = [
      ['BSBBAD0553B', 'Plan and manage meetings'],
      ['BSBSBM0163A', 'Develop a business proposal'],
      ['BSBSBM0423A', 'Organize business finances'],
      ['FSFACC0033B', 'Prepare operational budget'],
      ['BSBSBM0143A', 'Apply advanced business communication skills'],
      ['BSBCOR0353B', 'Communicate information relating to work activities'],
      ['BSBMKP1053B', 'Seize a business opportunity'],
      ['BSBMKP0173B', 'Conduct research and prepare a marketing plan to achieve goals'],
      ['BSBMKP0913B', 'Manage business customers'],
      ['PSSCOR0063B', 'Monitor performance and provide feedback'],
      ['BSBBAD1273B', 'Lead and manage people'],
      ['PSSCOR0103B', 'Promote diversity'],
      ['PSSADM0264B', 'Provide leadership across the organization'],
      ['FSFACC0134B', 'Produce management reports to enable effective decision making'],
      ['BSBBAD0274B', 'Manage finances within a budget'],
      ['FSFADM0074B', 'Provide financial and business performance information'],
      ['PSSADM0204B', 'Manage policy implementation'],
      ['BSBSBM0024B', 'Research business opportunities'],
      ['BSBSBM0054C', 'Develop a business plan'],
      ['BSBSBM0354A', 'Protect and use intangible assets'],
      ['PSAHRD0224B', 'Develop and use emotional intelligence'],
      ['BSBIPR0014A', 'Comply with organizational requirements for protection and use of intellectual property'],
      ['BSBIPR0044A', 'Manage intellectual property to protect and grow business'],
      ['FSFACC0884A', 'Implement and maintain internal control procedures'],
      ['PSSADM0144B', 'Exercise delegations'],
      ['BSBLEG0014A', 'Apply the principles of contract law'],
      ['PSSCOR0114B', 'Conduct systems evaluations'],
      ['PSSCOR0124B', 'Use complex workplace communication strategies'],
      ['THHWPO0344B', 'Manage quality guest service'],
      ['PSSCOR0034B', 'Contribute to and manage the change processes'],
      ['BSBBAD1244B', 'Manage workplace (industrial) relations'],
      ['PSSCOR0164B', 'Represent and promote the organization'],
      ['PSSADM0175A', 'Develop partnering arrangements'],
      ['PSSCOR0145B', 'Prepare high-level-sensitive written materials'],
      ['PSSPAD0095B', 'Establish and maintain a strategic planning cycle'],
      ['PSSADM0165B', 'Manage innovation and continuous improvement'],
      ['BSBEBU0085B', 'Evaluate new technologies for business'],
      ['BSBFLM0035B', 'Manage effective workplace relationships'],
      ['BSBBAD1305B', 'Analyse and interpret workforce development trends'],
      ['BSBEBU0125B', 'Use online systems to support managerial decision- making'],
      ['BSBFLM0095B', 'Facilitate continuous improvement'],
      ['PSAHRD0185B', 'Formulate a human resource strategic plan'],
      ['BSBBAD1365B', 'Manage environmental risks'],
      ['BSBBAD1345B', 'Monitor and review strategic direction'],
      ['PSSADM0535B', 'Provide advice to executive team and stakeholders'],
      ['PSSPAD0065B', 'Evaluate an organization’s OHS performance'],
      ['PSSPAD0115B', 'Establish and maintain community, government and business partnerships'],
      ['PSSCOR0023B', 'Develop and implement work unit plan'],
      ['BSBSBM0313A', 'Lead and facilitate offsite staff'],
      ['BSBBAD0473B', 'Plan and manage conferences'],
      ['BSBBAD0793B', 'Promote the business'],
      ['BSBBAD0384B', 'Ensure sales and service delivery'],
      ['PSAHRD0214B', 'Manage performance'],
      ['THTCOT0204B', 'Manage projects'],
      ['BSBADM0034B', 'Develop and use complex spreadsheets'],
      ['FSFACC0294B', 'Report on financial activity'],
      ['BSBBAD1264B', 'Undertake compliance audits'],
      ['CSCSAD0014A', 'Provide community education projects'],
      ['BSBMKP0054B', 'Design and deliver a presentation'],
      ['PSSPAD0075B', 'Develop and implement organizational policies'],
      ['PSSPAD0105B', 'Plan organizational needs'],
      ['PSSADM0285B', 'Advise on organisation policy'],
      ['PSSAPM0065B', 'Negotiate strategic procurement'],
      ['PSSADM0245B', 'Obtain and manage consultancy services'],
      ['FSFADM0025B', 'Develop and monitor financial policy statements and operating procedures'],
      ['BSBFLM0135B', 'Manage budgets and financial plans within the work team'],
      ['PSAHRD0155B', 'Manage remuneration strategies and plans'],
      ['PSSADM0235B', 'Manage self as a board member'],
      ['CSEGCC0075A', 'Provide workplace mentoring'],
      ['PSSADM0215B', 'Manage a board meeting']
    ];

    // GENERAL BEAUTY THERAPY LEVEL 2 - NVQ-J CSB21424 - transcribed from the institution's qualification plan.
    var BT_L2_UNITS = [
      ['CSBBTH0122C', 'Design and apply facial make-up'],
      ['CSBBTH0052E', 'Perform facial treatment'],
      ['CSBBTH0062D', 'Provide lash and brow treatment'],
      ['CSBBTH0072D', 'Provide temporary epilation and bleaching treatments'],
      ['CSBBTH0132C', 'Provide paraffin wax treatment'],
      ['CSBBTH0032C', 'Apply nail art'],
      ['CSBBTH0092B', 'Apply acrylic nail enhancement'],
      ['CSBBTH0102B', 'Apply gel nail enhancement'],
      ['CSBBTH0002D', 'Provide manicure and pedicure service'],
      ['CSBBTH0202A', 'Acquire foundation knowledge of massage therapy'],
      ['CSBBTH0212A', 'Apply knowledge of the history of massage'],
      ['CRIOHS0022A', 'Provide advance first aid'],
      ['CSACMP0012B', 'Comply with infection prevention and control policies and procedures'],
      ['CRIHLT0042A', 'Protect self against communicable diseases in the workplace'],
      ['CSBCOS0032D', 'Sell products and services'],
      ['CSBCOS0042D', 'Conduct financial transactions'],
      ['CSBCOS0052D', 'Perform stock control procedures'],
      ['ITIDAT3552A', 'Perform advanced features of computer applications'],
      ['ITIWEB1012C', 'Use social media tools for collaboration and engagement'],
      ['CRICOM0022B', 'Communicate and interact effectively in the workplace'],
      ['CRICOM0012B', 'Apply language and communication skills'],
      ['CSBCOS0002D', 'Receive and direct clients'],
      ['CRICUS0012A', 'Provide quality customer/client service'],
      ['CSBCOS0012D', 'Schedule and check out clients'],
      ['BSBCOR0382D', 'Display human relations skills'],
      ['BSBSBM0012E', 'Craft personal entrepreneurial strategy'],
      ['CSWCOR0052B', 'Reflect on and improve own professional practice'],
      ['CRIMAT0012B', 'Perform mathematical computations'],
      ['CSBBAR0042D', 'Perform face shave', 'Elective'],
      ['THHFRO0032B', 'Develop and apply conversational skills in a foreign language', 'Elective'],
      ['CSBCOS0202C', 'Perform hair styling services', 'Elective']
    ];

    // COSMETOLOGY LEVEL 2 - NVQ-J CSB21323 - transcribed from the institution's qualification plan.
    var COS_L2_UNITS = [
      ['CSBCOR0021D', 'Plan and organize work'],
      ['CSBCOS0001E', 'Prepare clients for salon service'],
      ['CSBCOS0031C', 'Perform shampooing and conditioning services'],
      ['CSBHDR0011C', 'Perform head, neck and shoulder massage'],
      ['CSBCOS0021C', 'Perform wet hair styling and roller placement'],
      ['CSBCOR0011D', 'Maintain a safe, clean and efficient work environment'],
      ['CSBCOS0011D', 'Perform temporary hair colour services'],
      ['CSBCOS0041B', 'Perform basic hair and scalp treatments'],
      ['CSBBTH0001B', 'Provide basic manicure and pedicure service'],
      ['CSBBTH0112B', 'Apply knowledge of nail science to nail services'],
      ['CSBBTH0002D', 'Provide manicure and pedicure service'],
      ['CSBBTH0132C', 'Provide paraffin wax treatment'],
      ['CSBBTH0032C', 'Apply nail art'],
      ['CSBBTH0052E', 'Perform facial treatment'],
      ['CSBBTH0122C', 'Design and apply facial make-up'],
      ['CSBBAR0042D', 'Perform face shave'],
      ['CSBBTH0062D', 'Provide lash and brow treatment'],
      ['CSBBTH0072D', 'Provide temporary epilation and bleaching treatments'],
      ['CSBCOS0072C', 'Consult with clients and diagnose hair and scalp conditions'],
      ['CSBCOS0242A', 'Utilise sensory skills in beauty service for optimal client experience'],
      ['CSBCOS0162C', 'Perform chemical straightening services'],
      ['CSBCOS0172C', 'Perform permanent wave services'],
      ['CSBCOS0192C', 'Provide permanent hair colour services'],
      ['CSBCOS0102D', 'Perform semi-permanent hair colour services'],
      ['CSBCOS0022C', 'Perform hair shaping'],
      ['CSBCOS0132C', 'Maintain wigs and hair pieces'],
      ['CSBCOS0142C', 'Perform thermal straightening, curling and waving'],
      ['CSBCOS0182C', 'Perform hair braiding services'],
      ['CSBCOS0202C', 'Perform hair styling services'],
      ['CSBBTH0082C', 'Provide advice on retail beauty care products'],
      ['CRICOM0012B', 'Apply language and communication skills'],
      ['BMFCRT0182B', 'Collaborate in a creative process'],
      ['BSSCRE0322C', 'Contribute to effective workplace relationships'],
      ['CRICUS0012A', 'Provide quality customer/client service'],
      ['CSBCOS0002D', 'Receive and direct clients'],
      ['CSBCOS0012D', 'Schedule and check out clients'],
      ['CSBCOS0032D', 'Sell products and services'],
      ['CRIMAT0012B', 'Perform mathematical computations'],
      ['CSBCOS0042D', 'Conduct financial transactions'],
      ['BSBMKP0192C', 'Undertake research and analysis'],
      ['BSBSBM0012E', 'Craft personal entrepreneurial strategy'],
      ['CSBCOS0052D', 'Perform stock control procedures'],
      ['BSBSBM0872B', 'Comply with regulatory and taxation requirements'],
      ['BSBBAD0372E', 'Manage time'],
      ['BMFCUL0072B', 'Exercise professionalism and ethical behaviour'],
      ['ITIDAT0212D', 'Use advanced features of computer applications'],
      ['ITIWEB1012C', 'Use social media tools for collaboration and engagement'],
      ['CSBBAR0022D', 'Perform hair shaping on excessively curly hair', 'Elective'],
      ['LMFIND0112B', 'Research interior decoration and design influences', 'Elective'],
      ['THHFRO0032B', 'Develop and apply conversational skills in a foreign language', 'Elective']
    ];

    // ELECTRICAL INSTALLATION AND MAINTENANCE LEVEL 2 - NVQ-J EEM20723 - transcribed from the institution's qualification plan.
    var EIM_L2_UNITS = [
      ['MEMCOR0141D', 'Follow principles of Occupational Health and Safety (OH&S) in work environment'],
      ['EEMELS0011B', 'Apply basic electrical safety'],
      ['EEMINS0011B', 'Use and maintain hand and power tools for electrical work'],
      ['MEMCOR0171D', 'Use and maintain graduated measuring devices'],
      ['MEMCOR0081E', 'Use marking out tools'],
      ['MEMCOR0161D', 'Plan to undertake a routine task'],
      ['EEMTEC0011B', 'Apply principles and practices in electrical installation'],
      ['MEMCOR0071E', 'Use electrical/electronic measuring devices'],
      ['MEMCOR0091D', 'Draw and interpret sketches and simple drawings'],
      ['MEMINS0071D', 'Prepare for electrical conduits/wiring installation'],
      ['EEMEDR0011B', 'Interpret and draw standard electrical drawings'],
      ['MEMINS0011E', 'Install, terminate and connect electrical wiring systems'],
      ['MEMFAB0011D', 'Perform manual soldering/de-soldering of electrical/electronic components'],
      ['MEMMRD0091D', 'Terminate basic signal and data cables'],
      ['MEMINS0051D', 'Cut, bend and install electrical conduits'],
      ['MEMINS0162C', 'Cut, fit and install trunking system'],
      ['MEMINS0172C', 'Prepare and install basic cable trays'],
      ['MEMINS0062D', 'Terminate and connect specialist cables'],
      ['MEMCOR0012C', 'Plan a complete work activity'],
      ['MEMINS0262D', 'Install distribution panels, metering sockets, terminal mains and meter earthing systems'],
      ['EEMINS0022B', 'Perform basic testing and inspection on electrical installations'],
      ['EEMMRD0022B', 'Dismantle and reassemble electromechanical components'],
      ['EEMMRD0012B', 'Troubleshoot and repair basic electrical/electronic apparatus'],
      ['MEMCOR0132C', 'Use industrial instrumentation measuring devices'],
      ['EEMEDR0012B', 'Use electrical software to draw simple circuits'],
      ['EEMINS0012B', 'Interpret electrical standard, specifications and manuals'],
      ['MEMMRD0072E', 'Shut down/isolate machines/equipment'],
      ['MEMINS0092D', 'Install electrical and electronic apparatus, machinery, fixtures and secondary wiring'],
      ['MEMMRD0182E', 'Locate and repair/rectify electrical circuits'],
      ['CRICOM0012B', 'Apply language and communication skills'],
      ['MEMCOR0122D', 'Write basic technical reports'],
      ['THTCOR0082C', 'Provide quality customer service'],
      ['CRIMAT0012B', 'Perform mathematical computations'],
      ['MEMCOR0152C', 'Use graphical techniques and perform simple statistical computations (Basic)'],
      ['BMFCUL0072B', 'Exercise professionalism and ethical behaviour'],
      ['BSBSBM0012E', 'Craft personal entrepreneurial strategy'],
      ['BSBMKP0342D', 'Prepare quotations'],
      ['MEMMAH0042D', 'Order materials'],
      ['ITIDAT0212D', 'Use advanced features of computer applications'],
      ['ITIWEB1012C', 'Use social media tools for collaboration and engagement'],
      ['EETOPT0092A', 'Develop an understanding of concepts and application of optoelectronics technology', 'Elective'],
      ['EETOPT0112A', 'Install LED technology signs', 'Elective'],
      ['EETOPT0152A', 'Apply the fibre optic technology', 'Elective']
    ];

    // ELECTRICAL INSTALLATION AND MAINTENANCE LEVEL 3 - NVQ MEM32507 - transcribed from the institution's qualification plan.
    var EIM_L3_UNITS = [
      ['MEMCOR0051A', 'Perform related computations – basic'],
      ['MEMCOR0071A', 'Use electrical/electronic measuring devices'],
      ['MEMCOR0081A', 'Mark off/out (general engineering)'],
      ['MEMCOR0091A', 'Draw and interpret sketches and simple drawings'],
      ['MEMCOR0111A', 'Use power tools'],
      ['MEMCOR0131A', 'Undertake interactive workplace communication'],
      ['MEMCOR0141A', 'Follow principles of Occupational Health and Safety (OH&S) in work environment'],
      ['MEMCOR0161A', 'Plan to undertake a routine task'],
      ['MEMCOR0171A', 'Use graduated measuring devices'],
      ['MEMCOR0191A', 'Use hand tools'],
      ['MEMMAH0071A', 'Perform manual handling and lifting'],
      ['MEMMAH0081A', 'Perform housekeeping duties'],
      ['MEMFAB0011A', 'Perform manual soldering/de-soldering – electrical/electronic components'],
      ['MEMINS0011A', 'Install terminate and connect electrical wiring'],
      ['MEMINS0051A', 'Cut bend and install electrical conduits'],
      ['MEMINS0071A', 'Prepare for electrical conduits/wiring installation'],
      ['MEMMRD0091A', 'Terminate signal and data cables – (basic)'],
      ['MEMMRD0121A', 'Perform basic repair to electrical/electronic apparatus'],
      ['MEMMRD0161A', 'Disconnect and reconnect fixed wired electrical machinery appliance and fixtures'],
      ['MEMMRD0181A', 'Attach flexible cables & plugs to electrical machinery appliance and fixtures'],
      ['MEMCOR0012A', 'Plan a complete activity'],
      ['MEMCOR0022A', 'Perform related computations'],
      ['MEMCOR0042A', 'Interpret standard specifications and manuals'],
      ['MEMCOR0052A', 'Operate in an autonomous team environment'],
      ['MEMCOR0122A', 'Write technical reports (basic)'],
      ['MEMINS0062A', 'Terminate and connect specialist cables'],
      ['MEMINS0092A', 'Install electrical/electronic machinery appliances, fixtures'],
      ['MEMINS0162A', 'Cut fit and install trunking system'],
      ['MEMINS0172A', 'Prepare and install cable trays - basic'],
      ['MEMINS0262A', 'Install distribution panels, metering sockets, terminal mains and meter earthing systems'],
      ['MEMMRD0072A', 'Shut down/isolate machines/equipment'],
      ['MEMMRD0182A', 'Fault find and repair/rectify basic electrical circuits and secondary wiring'],
      ['MEMMRD0402A', 'Check/identify/isolate/rectify malfunctioning electrical machinery appliances and fixtures'],
      ['MEMMRD0872A', 'Install and maintain electrical equipment'],
      ['MEMMRD0892A', 'Install and maintain electronic electrical equipment and distribution circuits'],
      ['MEMQUA0012A', 'Perform inspection (basic)'],
      ['MEMMAH0073A', 'Purchase materials'],
      ['MEMPLN0063A', 'Coordinate and manage basic installation projects'],
      ['MEMPLN0113A', 'Plan for wiring and installation of electrical/electronic machinery appliances and fixtures'],
      ['MEMCOM0023A', 'Perform internal and external customer service'],
      ['MEMCOR0093A', 'Plan and organize work'],
      ['MEMCOR0103A', 'Maintain quality systems within a team'],
      ['BSBFLM0023A', 'Support leadership in the workplace'],
      ['MEMMRD0423A', 'Diagnose and repair faults in electrical and electronic systems'],
      ['MEMMRD0663A', 'Perform testing and inspection of electrical installations'],
      ['MEMMRD0673A', 'Coordinate the installation of electrical wiring support system infrastructure'],
      ['MEMMRD0683A', 'Coordinate the installation of electrical cable and fixture'],
      ['MEMMRD0693A', 'Coordinate the installation of electrical equipment, ancillary apparatus and secondary wiring'],
      ['MEMCOR0101A', 'Prepare basic engineering drawing', 'Elective'],
      ['MEMCOR0121A', 'Classify engineering materials – (basic)', 'Elective'],
      ['ITICOR0011A', 'Carry out data entry and retrieval procedures', 'Elective'],
      ['MEMMRD0191A', 'Assemble & disassemble scaffolding to enable access to the work area', 'Elective'],
      ['BSBSBM0012A', 'Craft personal entrepreneurial strategy', 'Elective'],
      ['MEMMAH0042A', 'Order materials', 'Elective'],
      ['MEMINS0122A', 'Install below ground communication cables', 'Elective'],
      ['MEMCOR0132A', 'Use Industrial Instrumentation measuring devices', 'Elective'],
      ['MEMCOR0063A', 'Attend to breakdown in hazardous area', 'Elective'],
      ['MEMCOR0013A', 'Assist in the provision of on the job training', 'Elective'],
      ['MEMMRD0703A', 'Coordinate the installation of substation plant and apparatus', 'Elective'],
      ['MEMMRD0443A', 'Diagnose & repair faults in electrical equipment', 'Elective'],
      ['BSBFLM0053A', 'Support operational plan', 'Elective'],
      ['BSBFLM0093A', 'Support continuous improvement systems and processes', 'Elective'],
      ['MEMPLN0034A', 'Coordinate and manage commissioning processes', 'Elective'],
      ['MEMPLN0094A', 'Determine and plan for electrical installation requirements', 'Elective'],
      ['MEMPLN0104A', 'Interpret and carry out electrical design', 'Elective'],
      ['MEMPLN0114A', 'Evaluate electrical installation', 'Elective'],
      ['MEMPLN0124A', 'Perform testing on complex electrical installation', 'Elective']
    ];

    // HOSPITALITY VILLA/PROPERTIES SERVICES LEVEL 2 - NVQ-J THH22522 - transcribed from the institution's qualification plan.
    var HVP_L2_UNITS = [
      ['THHHOK1211D', 'Clean public areas'],
      ['THHHOK0911D', 'Clean floors, walls, furniture and furnishings'],
      ['THHHOK1181D', 'Clean and maintain soft floor and furnishings'],
      ['THHHOK0921D', 'Prepare guests rooms'],
      ['THHHOK1151D', 'Prepare offices'],
      ['THHHOK0931D', 'Provide laundry service'],
      ['THHGAD0141D', 'Receive and store stock'],
      ['THHFAB0151D', 'Prepare and serve non-alcoholic beverages'],
      ['THHFRO0101D', 'Develop and apply conversational skills in a foreign language'],
      ['THHFRO0141D', 'Carry out rooming procedures'],
      ['THHFRO0091C', 'Provide bell services'],
      ['THHHOK0901C', 'Respond to guest related complaints and requests'],
      ['THHCFP0261E', 'Prepare dishes using basic methods of cookery'],
      ['THHCFP0281D', 'Prepare and present sandwiches'],
      ['THHCFP0321D', 'Prepare and cook poultry dishes'],
      ['THHCFP0331D', 'Prepare and cook meat and seafood'],
      ['THHCFP0651D', 'Prepare vegetables, fruits, eggs and farinaceous dishes'],
      ['THHCFP0271D', 'Prepare and present appetizers and salads'],
      ['THHCFP0251D', 'Clean kitchen premises and equipment'],
      ['THHCFP1031B', 'Use knives for basic task in the kitchen environment'],
      ['THHCFP0671C', 'Prepare stocks, sauces and soups'],
      ['THHCFP0231D', 'Organize, prepare and present simple dishes'],
      ['THHFAB0101D', 'Provide food and beverage service'],
      ['THHHOK1411B', 'Develop and apply principles of professional codes of conduct & ethics'],
      ['THHCOR0011C', 'Work with colleagues and customers'],
      ['THHCOR0031D', 'Develop and update hospitality industry/job knowledge'],
      ['THTTEJ0011D', 'Apply knowledge of Team Jamaica requirements in the workplace'],
      ['CRIDIV0021A', 'Operate in a culturally diverse work environment'],
      ['CRIWHS0061A', 'Apply environmentally sustainable work practices'],
      ['ITCMOB0111B', 'Use mobile IT devices'],
      ['ITICOR0011E', 'Perform basic computer applications'],
      ['ITCWEB0161B', 'Participate in online networks and social media'],
      ['THHFRO0112C', 'Facilitate access to external services'],
      ['THHFRO0152C', 'Provide customized guests services'],
      ['THHHOK1192C', 'Provide linen room services'],
      ['THHFRO0132C', 'Maintain guests\' accounts'],
      ['THHFRO0012C', 'Receive and process reservations'],
      ['THHFRO0022D', 'Provide accommodation reception services'],
      ['THHGFA0042D', 'Process cash and non-cash transactions'],
      ['THHHOK1142D', 'Repair and recycle linen'],
      ['THHFRO0162C', 'Prepare customer accounts and deal with departures'],
      ['THHGCS0222D', 'Promote and up-sell products and services'],
      ['THHPAT0542C', 'Prepare and produce cakes and puddings products'],
      ['THHPAT0532C', 'Prepare and produce pastries'],
      ['THHPAT0552C', 'Prepare and produce yeast goods'],
      ['THHPAT0772D', 'Prepare and present desserts'],
      ['CRIOHS0012A', 'Comply with the occupational health and safety, security and hygiene practices'],
      ['THHCFP1262A', 'Comply with the relevant legislative and regulatory requirements in hospitality'],
      ['BSBSBM0012E', 'Craft personal entrepreneurial strategy'],
      ['CSEJOB0692A', 'Develop an understanding of business operations'],
      ['CSEJOB0362A', 'Use strategies to identify job opportunities'],
      ['CRICOM0012B', 'Apply language and communication skills'],
      ['CRIMAT0022B', 'Perform mathematical computation'],
      ['BSBBAD0362E', 'Manage personal stress in the workplace'],
      ['CSEJOB0382A', 'Respond to familiar workplace problems'],
      ['CSEJOB0682A', 'Apply the principles of customer service'],
      ['BSBWKR0012A', 'Plan and apply time management strategies'],
      ['CSEJOB0372A', 'Enhance self-management skills for work'],
      ['THHHOK1322B', 'Maintain housekeeping supplies', 'Elective'],
      ['THHHOK1342B', 'Administer the current records systems', 'Elective'],
      ['THHHOK1352B', 'Maintain store security and cleanliness', 'Elective']
    ];

    // WELDING LEVEL 2 - NVQ-J MEM22423 - transcribed from the institution's qualification plan.
    var WEL_L2_UNITS = [
      ['MEMCOR0141D', 'Follow principles of Occupational Health and Safety (OH&S) in work environment'],
      ['MEMCOR0171D', 'Use and maintain graduated measuring devices'],
      ['BCGCOR0051D', 'Use hand and power tools'],
      ['MEMMPO0081C', 'Use workshop machines for basic operations'],
      ['MEMCOR0091D', 'Draw and interpret sketches and simple drawings'],
      ['MEMFAB0141C', 'Develop basic geometric shapes'],
      ['MEMCOR0101C', 'Prepare basic engineering drawing'],
      ['MEMFAB0051D', 'Perform brazing and/or silver soldering'],
      ['MEMFAB0111C', 'Perform basic welding using manual metal arc welding process (MMAW)'],
      ['MEMFAB0121C', 'Perform basic welding using oxyacetylene welding process (OAW) - fuel gas welding'],
      ['MEMFAB0151C', 'Prepare for oxyacetylene/metal arc welding processes'],
      ['MEMFAB0041C', 'Carry out mechanical cutting operations – (basic)'],
      ['MEMCOR0081E', 'Use marking out tools'],
      ['MEMCOR0121D', 'Classify engineering materials (basic)'],
      ['MEMFAB0081C', 'Assemble fabricated components'],
      ['MEMFAB0061C', 'Perform manual heating, and thermal cutting'],
      ['MEMFAB0071C', 'Undertake fabrication, forming, bending and shaping'],
      ['ITCMOB0111B', 'Use mobile IT devices'],
      ['ITICOR0011E', 'Perform basic computer applications'],
      ['ITCWEB0161B', 'Participate in online networks and social media'],
      ['MEMDDD0042C', 'Prepare basic mechanical drawings'],
      ['EEMCAD0012A', 'Operate computer aided design (CAD) to produce basic drawing elements'],
      ['MEMFAB0042C', 'Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)'],
      ['MEMFAB0072C', 'Perform advanced welding using oxyacetylene welding process (OAW)'],
      ['MEMCOR0092C', 'Mark off/out structural fabrication and shapes'],
      ['MEMFAB0022C', 'Perform advanced manual thermal cutting, gouging and shaping'],
      ['CSAPQA0012A', 'Apply quality standards and procedures'],
      ['MEMFAB0052C', 'Weld using gas metal arc welding process (GMAW) – metal inert gas (MIG)'],
      ['MEMCOR0012D', 'Plan a complete work activity'],
      ['MEMFAB0142C', 'Perform weld in flat and horizontal positions using flux cored arc welding process (FCAW)'],
      ['MEMFAB0062C', 'Perform weld in flat and horizontal positions using gas tungsten metal arc welding process (GTAW) - (Tungsten inert gas - TIG)'],
      ['CRICOM0012B', 'Apply language and communication skills'],
      ['MEMCOR0122D', 'Write basic technical reports'],
      ['THTCOR0082C', 'Provide quality customer service'],
      ['BMFCUL0072B', 'Exercise professionalism and ethical behaviour'],
      ['BSBSBM0012E', 'Craft personal entrepreneurial strategy'],
      ['BSBMKP0342D', 'Prepare quotations'],
      ['MEMMAH0042D', 'Order materials'],
      ['CRIMAT0012B', 'Perform mathematical computations'],
      ['BSBCOR0382D', 'Display human relations skills'],
      ['BSBBAD0362F', 'Manage personal stress in the workplace'],
      ['BSBWKR0012A', 'Plan and apply time management strategies'],
      ['MEMCOR0042C', 'Interpret standard specifications and manuals'],
      ['MEMPRG0012A', 'Apply introductory machine programming techniques', 'Elective'],
      ['MEMMRD0062C', 'Perform levelling and alignment of machines and engineering components', 'Elective'],
      ['MEMMPO0072B', 'Perform machining operations using horizontal and/or vertical boring machines', 'Elective']
    ];

    // WELDING LEVEL 3 - NVQ MEM30215 - transcribed from the institution's qualification plan.
    var WEL_L3_UNITS = [
      ['MEMCOR0131B', 'Undertake interactive workplace communication'],
      ['MEMCOR0141B', 'Follow principles of Occupational Health and Safety (OH&S) in work environment'],
      ['ITICOR0011B', 'Carry out data entry and retrieval procedures'],
      ['MEMCOR0161B', 'Plan to undertake a routine task'],
      ['MEMCOR0171B', 'Use and maintain graduated measuring devices'],
      ['MEMCOR0191B', 'Use hand tools'],
      ['MEMCOR0051B', 'Perform related computations – (basic)'],
      ['MEMCOR0081B', 'Mark off/out (general engineering)'],
      ['MEMCOR0091B', 'Draw and interpret sketch and simple drawing'],
      ['MEMCOR0111B', 'Use and care power tools'],
      ['MEMCOR0121B', 'Classify engineering materials – (basic)'],
      ['MEMFAB0041B', 'Carry out mechanical cutting operations - (basic)'],
      ['MEMFAB0141B', 'Develop geometric shapes (basic)'],
      ['MEMFAB0151B', 'Prepare for oxyacetylene/metal arc welding processes'],
      ['MEMFAB0051B', 'Perform brazing and/or silver soldering'],
      ['MEMFAB0061B', 'Perform manual heating and thermal cutting'],
      ['MEMFAB0071B', 'Undertake fabrication, forming, bending and shaping – (basic)'],
      ['MEMFAB0081B', 'Assemble fabricated components-(basic)'],
      ['MEMFAB0111B', 'Perform basic welding using manual metal arc welding process (MMAW)'],
      ['MEMFAB0121B', 'Perform basic welding using oxyacetylene welding process (OAW) - Fuel Gas Welding'],
      ['MEMMAH0071B', 'Perform manual handling and lifting'],
      ['MEMMAH0081B', 'Perform housekeeping duties'],
      ['MEMCOR0012B', 'Plan a complete activity'],
      ['MEMCOR0022B', 'Perform related computations'],
      ['MEMCOR0042B', 'Interpret standard specifications and manuals'],
      ['MEMCOR0052B', 'Operate in an autonomous team environment'],
      ['MEMCOR0122C', 'Write technical reports (basic)'],
      ['MEMFAB0022B', 'Perform advanced manual thermal cutting, gouging and shaping'],
      ['MEMFAB0042B', 'Perform advanced welding using manual metal arc welding process (MMAW)'],
      ['MEMFAB0052B', 'Weld using gas metal arc welding process GMAW - (Metal inert gas MIG)'],
      ['MEMFAB0062B', 'Weld using gas tungsten metal arc welding process GTAW - (Tungsten inert gas -TIG)'],
      ['MEMFAB0072B', 'Perform advanced welding using oxyacetylene welding process (OAW)'],
      ['MEMCOR0023C', 'Write technical reports (advanced)'],
      ['MEMCOR0093B', 'Plan and organise work'],
      ['MEMCOR0103C', 'Maintain quality systems within a team'],
      ['MEMCOR0113B', 'Coordinate team activities'],
      ['MEMFAB0023B', 'Perform advanced welding using gas metal arc welding process GMAW -(Metal inert gas MIG)'],
      ['MEMFAB0033B', 'Perform advanced welding using gas tungsten arc welding process (GTAW) –Tungsten inert Gas (TIG)'],
      ['MEMFAB0113B', 'Perform manual metal arc welding process to AWS specification (Alloy steel pipe)'],
      ['MEMCOR0083B', 'Estimate projects'],
      ['BSBFLM0053B', 'Support operational plan'],
      ['MEMCOR0101B', 'Prepare basic engineering drawing', 'Elective'],
      ['MEMSUF0061B', 'Prepare for the application of protective coating', 'Elective'],
      ['MEMMRD0191B', 'Assemble & disassemble scaffolding to enable access to the work area', 'Elective'],
      ['MEMFAB0131B', 'Repair/replace/modify fabrications (basic)', 'Elective'],
      ['MEMQUA0012B', 'Perform inspection - (basic)', 'Elective'],
      ['MEMMAH0042B', 'Order materials', 'Elective'],
      ['MEMCOR0062B', 'Attend to breakdown', 'Elective'],
      ['MEMCOR0092B', 'Mark off/out structural fabrications and shapes', 'Elective'],
      ['BSBSBM0012C', 'Craft personal entrepreneurial strategy', 'Elective'],
      ['MEMFAB0102B', 'Perform manual metal arc welding process to AWS specification (Low carbon steel sheet)', 'Elective'],
      ['MEMFAB0112B', 'Perform manual metal arc welding process to AWS specification (Low carbon steel pipe)', 'Elective'],
      ['MEMFAB0122B', 'Perform oxyacetylene welding process (fuel gas) to AWS specification', 'Elective'],
      ['MEMFAB0142B', 'Weld using flux cored arc welding process to FCAW', 'Elective'],
      ['MEMFAB0013B', 'Monitor quality of production welding/fabrication', 'Elective'],
      ['MEMFAB0043B', 'Weld using submerged arc welding process', 'Elective'],
      ['MEMFAB0053B', 'Perform welding supervision', 'Elective'],
      ['MEMFAB0063B', 'Perform welding/ fabrication inspection', 'Elective'],
      ['MEMFAB0103B', 'Perform manual metal arc welding to weld to AWS specification (Alloy steel plate)', 'Elective'],
      ['MEMFAB0123B', 'Perform gas tungsten arc welding process to AWS specification.(Plate)', 'Elective'],
      ['MEMFAB0133B', 'Perform gas tungsten arc welding process to AWS specification (Pipe)', 'Elective'],
      ['MEMFAB0143B', 'Perform gas metal arc welding process to AWS specification (Pipe and plate)', 'Elective'],
      ['MEMFAB0153B', 'Perform submerged arc welding to AWS specification', 'Elective'],
      ['MEMFAB0193B', 'Perform advanced welding using flux cored arc welding process - FCAW', 'Elective'],
      ['MEMMAH0073B', 'Purchase materials', 'Elective'],
      ['MEMCOR0013B', 'Assist in the provision of on the job training', 'Elective'],
      ['MEMCOM0023B', 'Perform internal and external customer service', 'Elective'],
      ['MEMPLN0063B', 'Coordinate and manage basic installation projects', 'Elective'],
      ['MEMMAH0093B', 'Coordinate materials', 'Elective'],
      ['MEMCOR0063B', 'Attend to break downs in hazardous areas', 'Elective'],
      ['BSBFLM0093B', 'Support continuous improvement systems and processes', 'Elective']
    ];

    function seedQual(id, title, skillArea, level, nvqCode, units) {
      return {
        id: id, title: title, skillArea: skillArea, level: level,
        nvqCode: nvqCode || '',
        centre: T.INSTITUTION.centre,
        units: (units || []).map(function (u) { return { code: u[0], name: u[1], coreElective: u[2] || 'Core' }; }),
        seeded: true
      };
    }

    T.seedCatalogs = function () {
      return [
        seedQual('QUAL-BAM-L5', 'BUSINESS ADMINISTRATION (MANAGEMENT) LEVEL 5', 'Business Administration', 5, '', BAM_L5_UNITS),
        seedQual('QUAL-BT-L2',  'GENERAL BEAUTY THERAPY LEVEL 2', 'Beauty Therapy', 2, 'CSB21424', BT_L2_UNITS),
        seedQual('QUAL-COS-L2', 'COSMETOLOGY LEVEL 2', 'Cosmetology', 2, 'CSB21323', COS_L2_UNITS),
        seedQual('QUAL-EIM-L2', 'ELECTRICAL INSTALLATION AND MAINTENANCE LEVEL 2', 'Electrical Installation', 2, 'EEM20723', EIM_L2_UNITS),
        seedQual('QUAL-EIM-L3', 'ELECTRICAL INSTALLATION AND MAINTENANCE LEVEL 3', 'Electrical Installation', 3, 'MEM32507', EIM_L3_UNITS),
        seedQual('QUAL-HVP-L2', 'HOSPITALITY VILLA/PROPERTIES SERVICES LEVEL 2', 'Hospitality & Tourism', 2, 'THH22522', HVP_L2_UNITS),
        seedQual('QUAL-WEL-L2', 'WELDING LEVEL 2', 'Welding & Fabrication', 2, 'MEM22423', WEL_L2_UNITS),
        seedQual('QUAL-WEL-L3', 'WELDING LEVEL 3', 'Welding & Fabrication', 3, 'MEM30215', WEL_L3_UNITS)
      ];
    };

    // Merge freshly-seeded catalogues into a stored list without disturbing
    // admin edits. Two cases, both idempotent:
    //   1. A qual id absent from the store is appended.
    //   2. A stored scaffold that is still PRISTINE (seeded, never edited,
    //      zero units) is replaced by the current seed — this is how stores
    //      that persisted an empty placeholder receive the real unit list
    //      when a qualification plan is later transcribed into the seeds.
    // The moment an admin saves a catalogue (updatedAt set), their version
    // wins forever.
    T.ensureSeeded = function (catalogs) {
      var list = Array.isArray(catalogs) ? catalogs.slice() : [];
      var idxById = {};
      list.forEach(function (q, i) { if (q && q.id) idxById[q.id] = i; });
      T.seedCatalogs().forEach(function (seed) {
        var i = idxById[seed.id];
        if (i === undefined) { list.push(seed); return; }
        var cur = list[i];
        if (cur && cur.seeded && !cur.updatedAt && (!cur.units || !cur.units.length) && seed.units.length) {
          list[i] = seed;
        }
      });
      return list;
    };

    /* --- Normalisation / formatting ---------------------------------------- */
    T.normText = function (s) {
      return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    };

    // "90.5" / 90.5 / "90.50" -> "90.5%"; 90 -> "90%"; non-numeric passes through.
    T.formatGrade = function (v) {
      if (v == null || v === '') return '';
      var n = Number(v);
      if (isNaN(n)) return String(v);
      var s = String(Math.round(n * 10) / 10);
      return s + '%';
    };

    // ISO / Date-parseable string -> DD/MM/YYYY (the transcript's date format).
    T.formatDateDMY = function (iso) {
      if (!iso) return '';
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(iso))) return String(iso);
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var da = String(d.getDate()), mo = String(d.getMonth() + 1);
      return (da.length < 2 ? '0' + da : da) + '/' + (mo.length < 2 ? '0' + mo : mo) + '/' + d.getFullYear();
    };

    /* --- Live-exam matching -------------------------------------------------
       An exam counts towards a unit when:
         - the exam names its units explicitly (exam.unitCodes) and this is one
           of them — the exact link, used whenever an exam carries it;
         - otherwise its title carries the unit code;
         - otherwise its title IS the unit name, or contains it (names of 12+
           characters, so trivially short ones cannot match everything).
       A title merely contained IN a unit name no longer counts: "Perform
       hair shaping" is contained in "Perform hair shaping on excessively curly
       hair", and every trainee who sat the first exam was being certified in
       the second unit too. effectiveGrades goes further and, when one title
       matches several units of a plan by name, credits only the most specific
       (longest) of them — see unitsForExam. */
    function codeList(exam) {
      return (exam && Array.isArray(exam.unitCodes) ? exam.unitCodes : [])
        .map(function (c) { return T.normText(c); }).filter(Boolean);
    }
    T.examMatchesUnit = function (exam, unit) {
      if (!exam || !unit) return false;
      var code = T.normText(unit.code);
      var explicit = codeList(exam);
      if (explicit.length) return !!code && explicit.indexOf(code) !== -1;
      var title = T.normText(exam.title);
      if (!title) return false;
      if (code && title.indexOf(code) !== -1) return true;
      var name = T.normText(unit.name);
      if (!name) return false;
      if (title === name) return true;
      if (name.length >= 12 && title.indexOf(name) !== -1) return true;
      return false;
    };

    /* The codes of the units in `units` that one exam counts towards. An
       explicit unitCodes list wins; then units whose code is in the title;
       then units named by the title — and of those, only the most specific
       (the longest name the title contains), so one exam is never credited to
       a unit merely because its name is a longer version of another's. */
    T.unitsForExam = function (exam, units) {
      var out = {};
      if (!exam || !Array.isArray(units)) return out;
      var explicit = codeList(exam);
      var title = T.normText(exam.title);
      var byCode = [], byName = [], exact = [];
      units.forEach(function (u) {
        if (!u) return;
        var code = T.normText(u.code), name = T.normText(u.name);
        if (explicit.length) { if (code && explicit.indexOf(code) !== -1) out[u.code] = true; return; }
        if (!title) return;
        if (code && title.indexOf(code) !== -1) { byCode.push(u); return; }
        if (!name) return;
        if (title === name) exact.push(u);
        else if (name.length >= 12 && title.indexOf(name) !== -1) byName.push(u);
      });
      if (explicit.length) return out;
      var chosen = byCode.length ? byCode : (exact.length ? exact : byName);
      if (!byCode.length && !exact.length && byName.length > 1) {
        var longest = 0;
        byName.forEach(function (u) { longest = Math.max(longest, T.normText(u.name).length); });
        chosen = byName.filter(function (u) { return T.normText(u.name).length === longest; });
      }
      chosen.forEach(function (u) { out[u.code] = true; });
      return out;
    };

    /* One pass over the exam results, shared by every trainee and every unit
       drawn in one render. Grade resolution used to rebuild the exams-by-id map
       and scan EVERY result for every unit of every trainee, and the instructor
       view and the 5 s live refresh slowed down year on year as results piled
       up. Build this once per render and hand it to effectiveGrades as
       opts.index; effectiveGrades builds one itself when it is not given. */
    T.gradeIndex = function (exams, examResults, catalogs) {
      var idx = { examsById: {}, byStudent: {}, catalogs: Array.isArray(catalogs) ? catalogs : null,
                  units: {}, courseQual: {} };
      (exams || []).forEach(function (e) { if (e && e.id) idx.examsById[e.id] = e; });
      (examResults || []).forEach(function (r) {
        if (!r || !r.studentId || r.archived) return;
        (idx.byStudent[r.studentId] = idx.byStudent[r.studentId] || []).push(r);
      });
      return idx;
    };
    // Which units of `qual` this exam counts towards — worked out once per
    // (qualification, exam) and remembered in the index.
    function examUnitsFor(idx, qual, exam) {
      var k = qual.id + '\u0001' + exam.id;
      if (!idx.units[k]) {
        var allowed = true;
        // An exam set for another programme never grades this one: a trainee
        // who sat a Welding exam is not assessed on an Electrical unit that
        // happens to share its title. Only applied when the exam names a
        // programme that resolves to a different qualification.
        if (idx.catalogs && exam.course) {
          var ck = T.normText(exam.course);
          if (!Object.prototype.hasOwnProperty.call(idx.courseQual, ck)) {
            var q = T.qualForCourse(idx.catalogs, exam.course);
            idx.courseQual[ck] = q ? q.id : null;
          }
          var qid = idx.courseQual[ck];
          if (qid && qid !== qual.id) allowed = false;
        }
        idx.units[k] = allowed ? T.unitsForExam(exam, qual.units) : {};
      }
      return idx.units[k];
    }

    // Latest submitted exam result for one student+unit. exams/examResults are
    // the app's canonical arrays. Returns null when the unit has no live score.
    // A result archived because its exam was deleted is no longer evidence of
    // anything and is skipped. A result still awaiting manual marking IS
    // returned: it is the latest attempt, and effectiveGrades shows it as
    // pending rather than letting an older attempt's grade stand in for it.
    T.latestExamResultForUnit = function (unit, studentId, exams, examResults) {
      if (!unit || !studentId) return null;
      var examsById = {};
      (exams || []).forEach(function (e) { if (e && e.id) examsById[e.id] = e; });
      var best = null, bestTime = -1;
      (examResults || []).forEach(function (r) {
        if (!r || r.studentId !== studentId || r.archived) return;
        var exam = examsById[r.examId];
        if (!exam || !T.examMatchesUnit(exam, unit)) return;
        var t = r.submittedAt ? new Date(r.submittedAt).getTime() : 0;
        if (isNaN(t)) t = 0;
        if (t >= bestTime) { bestTime = t; best = r; }
      });
      return best;
    };

    // Is this exam result still waiting for its short answers to be marked?
    // Its score is then only the auto-marked part, not a grade.
    T.isProvisionalResult = function (r) { return !!(r && r.needsReview && !r.reviewComplete); };

    /* --- THE RESOLUTION ALGORITHM -------------------------------------------
       One row per catalogue unit: manual grade wins, else latest live exam
       score, else ungraded. Every page renders from this so admin, trainee
       and instructor always see the same grades.

       A row resolved from an exam that is still being marked comes back with
       source 'pending' and NO grade: the provisional score (the auto-marked
       part only) read as "40" and "Failed" on the transcript and the grade
       sheet before an instructor had marked anything. An exam row also carries
       the exam's own pass mark (row.passMark), so its result is judged by the
       same rule the exam used.

       opts: { qual, studentId, exams, examResults, manualGrades,
               index (T.gradeIndex, optional), catalogs (optional — lets an
               exam set for another programme be told apart) } */
    T.effectiveGrades = function (opts) {
      opts = opts || {};
      var qual = opts.qual, studentId = opts.studentId;
      if (!qual || !Array.isArray(qual.units)) return [];
      var idx = opts.index || T.gradeIndex(opts.exams, opts.examResults, opts.catalogs);
      var manual = {};
      (opts.manualGrades || []).forEach(function (g) {
        if (g && g.studentId === studentId && g.qualId === qual.id && g.unitCode && !g.supersededBy) {
          manual[g.unitCode] = g;
        }
      });
      // The latest result per unit for this trainee, from their own results only.
      var latest = {};
      (idx.byStudent[studentId] || []).forEach(function (r) {
        var exam = idx.examsById[r.examId];
        if (!exam) return;
        var hit = examUnitsFor(idx, qual, exam);
        var t = r.submittedAt ? new Date(r.submittedAt).getTime() : 0;
        if (isNaN(t)) t = 0;
        Object.keys(hit).forEach(function (code) {
          var cur = latest[code];
          if (!cur || t >= cur.t) latest[code] = { t: t, r: r, exam: exam };
        });
      });
      return qual.units.map(function (u) {
        var row = {
          code: u.code, name: u.name, coreElective: u.coreElective || 'Core',
          grade: null, date: '', source: 'none', examResultId: null, examTitle: ''
        };
        var m = manual[u.code];
        if (m && m.grade !== '' && m.grade != null) {
          row.grade = m.grade;
          row.date = m.date || '';
          row.source = 'manual';
          row.examResultId = m.examResultId || null;
          return row;
        }
        var hit = latest[u.code];
        if (hit) {
          var res = hit.r;
          var pending = T.isProvisionalResult(res);
          row.grade = pending ? null : res.score;
          row.date = T.formatDateDMY(res.submittedAt);
          row.source = pending ? 'pending' : 'exam';
          row.examResultId = res.id;
          row.examTitle = hit.exam ? hit.exam.title : '';
          var pm = hit.exam ? Number(hit.exam.passMark) : NaN;
          if (hit.exam && hit.exam.passMark != null && hit.exam.passMark !== '' && !isNaN(pm)) row.passMark = pm;
        }
        return row;
      });
    };

    /* --- One rule for "achieved" ---------------------------------------------
       The grade sheet hard-coded 60%, exams used their own pass mark, and the
       official transcript printed no outcome at all — so a 65 on an exam with
       a pass mark of 70 was NOT PASSED in the LMS and COMPETENT on the sheet.
       Now every output asks resultFor(): the exam's own pass mark for an exam
       grade, else the unit's, else the qualification's, else 60. A pass mark
       of 0 is a pass mark (it used to fall through `|| 60`).

       Competency grades are first-class: an assessor may record "C" /
       "Competent" or "NYC" / "Not Yet Competent" instead of a percentage. */
    T.DEFAULT_PASS_MARK = 60;
    var COMPETENT_WORDS = { c: 1, competent: 1, comp: 1, pass: 1, passed: 1 };
    var NYC_WORDS = { nyc: 1, 'not yet competent': 1, 'not competent': 1, fail: 1, failed: 1 };
    T.competencyOf = function (grade) {
      if (grade == null || grade === '' || typeof grade !== 'string') return null;
      var w = T.normText(grade);
      if (COMPETENT_WORDS[w]) return 'competent';
      if (NYC_WORDS[w]) return 'nyc';
      return null;
    };
    T.isNumericGrade = function (grade) {
      if (grade == null || typeof grade === 'boolean') return false;
      var s = String(grade).replace('%', '').trim();
      return s !== '' && !isNaN(Number(s));
    };
    function validMark(v) { return v != null && v !== '' && !isNaN(Number(v)); }
    // The pass mark that decides one row: the exam's, the unit's, the plan's, 60.
    T.passMarkFor = function (qual, row) {
      if (row && validMark(row.passMark)) return Number(row.passMark);
      if (qual && row && Array.isArray(qual.units)) {
        var u = qual.units.filter(function (x) { return x && x.code === row.code; })[0];
        if (u && validMark(u.passMark)) return Number(u.passMark);
      }
      if (qual && validMark(qual.passMark)) return Number(qual.passMark);
      return T.DEFAULT_PASS_MARK;
    };
    // 'COMPETENT' | 'NYC' | 'PENDING' for a grade against a pass mark.
    T.resultFor = function (grade, passMark) {
      var c = T.competencyOf(grade);
      if (c === 'competent') return 'COMPETENT';
      if (c === 'nyc') return 'NYC';
      if (!T.isNumericGrade(grade)) return 'PENDING';
      var pm = validMark(passMark) ? Number(passMark) : T.DEFAULT_PASS_MARK;
      return Number(String(grade).replace('%', '').trim()) >= pm ? 'COMPETENT' : 'NYC';
    };
    T.resultForRow = function (row, qual) {
      if (!row || row.source === 'pending') return 'PENDING';
      return T.resultFor(row.grade, T.passMarkFor(qual, row));
    };
    // How a grade reads on screen and on paper: a percentage, the competency
    // word written out, or "Awaiting marking" for an exam still being marked.
    T.displayGrade = function (row) {
      if (!row) return '';
      if (row.source === 'pending') return 'Awaiting marking';
      var c = T.competencyOf(row.grade);
      if (c === 'competent') return 'Competent';
      if (c === 'nyc') return 'NYC';
      return T.formatGrade(row.grade);
    };

    /* graded counts every unit with a grade of any kind (so completion is
       unchanged); the AVERAGE is over percentage grades only. A unit recorded
       "Competent" used to be counted in the divisor as 0 and dragged a
       competent trainee's average below the pass line. Also counts how many
       units are achieved / not yet competent by resultFor (pass `qual` so a
       plan's own pass mark applies), and how many await marking. */
    T.gradeStats = function (rows, qual) {
      var graded = (rows || []).filter(function (r) { return r && r.grade != null && r.grade !== ''; });
      var sum = 0, numeric = 0, competent = 0, nyc = 0;
      graded.forEach(function (r) {
        if (T.isNumericGrade(r.grade)) { sum += Number(String(r.grade).replace('%', '').trim()); numeric++; }
        var res = T.resultForRow(r, qual);
        if (res === 'COMPETENT') competent++;
        else if (res === 'NYC') nyc++;
      });
      return {
        total: (rows || []).length,
        graded: graded.length,
        numeric: numeric,
        competent: competent,
        nyc: nyc,
        pending: (rows || []).filter(function (r) { return r && r.source === 'pending'; }).length,
        average: numeric ? Math.round((sum / numeric) * 10) / 10 : null
      };
    };

    /* --- Manual grade upsert (pure) -----------------------------------------
       Deterministic id from (studentId|qualId|unitCode) so the SAME unit grade
       resolves to the SAME record on every device — the property the snapshot
       reconcile's id-union relies on to avoid duplicates. */
    T.manualGradeId = function (studentId, qualId, unitCode) {
      return 'TG-' + Core.hashString(String(studentId) + '|' + String(qualId) + '|' + String(unitCode));
    };

    T.upsertManualGrade = function (grades, rec) {
      var list = Array.isArray(grades) ? grades.slice() : [];
      if (!rec || !rec.studentId || !rec.qualId || !rec.unitCode) return list;
      var id = T.manualGradeId(rec.studentId, rec.qualId, rec.unitCode);
      var stored = {
        id: id, studentId: rec.studentId, qualId: rec.qualId, unitCode: rec.unitCode,
        grade: rec.grade, date: rec.date || '', source: 'manual',
        examResultId: rec.examResultId || null,
        updatedBy: rec.updatedBy || '', updatedAt: rec.updatedAt || new Date().toISOString()
      };
      var idx = -1;
      list.forEach(function (g, i) { if (g && g.id === id) idx = i; });
      // An edit is never dated before the record it replaces (a slow clock).
      if (idx !== -1 && !rec.updatedAt && list[idx]) stored.updatedAt = laterIso(stored.updatedAt, list[idx].updatedAt);
      if (idx === -1) list.push(stored); else list[idx] = stored;
      return list;
    };

    /* Removing an override is written down, not erased: the record stays,
       marked removed with the time and who did it. A hard delete left no
       trace, so any other copy (a snapshot, another PC's file) put the old
       grade straight back — and when it was the last override, the empty
       list could not even be saved. effectiveGrades ignores a removed record
       (its grade is null), and the newest record still wins every merge, so
       re-entering a grade later simply replaces it. */
    T.removeManualGrade = function (grades, studentId, qualId, unitCode, by, at) {
      var id = T.manualGradeId(studentId, qualId, unitCode);
      return (Array.isArray(grades) ? grades : []).map(function (g) {
        if (!g || g.id !== id) return g;
        var out = {};
        Object.keys(g).forEach(function (k) { out[k] = g[k]; });
        out.grade = null;
        out.removed = true;
        out.updatedBy = by || g.updatedBy || '';
        out.updatedAt = laterIso(at || new Date().toISOString(), g.updatedAt);
        return out;
      });
    };
    function laterIso(now, prev) { return Core.sync ? Core.sync.laterStamp(now, prev) : now; }

    /* --- The unit catalogue: what an edit must not do ----------------------
       Grades are filed under a unit's CODE. A unit saved with a blank code
       could never hold a grade (the save reported "Grade saved" and stored
       nothing), and two units sharing a code shared one grade. Returns one
       entry per problem: { index, code, problem: 'blank-code'|'duplicate-code' }. */
    T.validateCatalogUnits = function (units) {
      var problems = [], seen = {};
      (Array.isArray(units) ? units : []).forEach(function (u, i) {
        var code = String((u && u.code) || '').trim();
        if (!code) { problems.push({ index: i, code: '', problem: 'blank-code' }); return; }
        var k = code.toUpperCase();
        if (seen[k] !== undefined) problems.push({ index: i, code: code, problem: 'duplicate-code', first: seen[k] });
        else seen[k] = i;
      });
      return problems;
    };

    /* Manual grades recorded for a unit that is no longer in `qual` — its code
       was edited, or the unit was removed from the plan. They stay stored and
       are listed (never silently hidden); a grade carried over to a new code
       (supersededBy) is not listed again. */
    T.orphanedGrades = function (qual, grades, studentId) {
      if (!qual) return [];
      var codes = {};
      (qual.units || []).forEach(function (u) { if (u && u.code) codes[u.code] = true; });
      return (grades || []).filter(function (g) {
        return g && g.qualId === qual.id && g.unitCode && !codes[g.unitCode] && !g.supersededBy &&
          g.grade != null && g.grade !== '' && (studentId == null || g.studentId === studentId);
      });
    };

    /* Carry every manual grade on `oldCode` of one qualification over to
       `newCode` (the administrator confirmed the unit was re-coded). The old
       record is kept, marked supersededBy, never deleted; a grade already
       saved under the new code that is newer than the old one stands.
       Returns { list, moved }. */
    T.renameUnitCode = function (grades, qualId, oldCode, newCode, actor, nowIso) {
      var list = Array.isArray(grades) ? grades.slice() : [];
      if (!qualId || !oldCode || !newCode || oldCode === newCode) return { list: list, moved: 0 };
      var now = nowIso || new Date().toISOString();
      var at = function (g) { var t = Date.parse((g && g.updatedAt) || ''); return isNaN(t) ? 0 : t; };
      var moved = 0;
      list.slice().forEach(function (g) {
        if (!g || g.qualId !== qualId || g.unitCode !== oldCode || g.supersededBy) return;
        if (g.grade == null || g.grade === '') return;
        var newId = T.manualGradeId(g.studentId, qualId, newCode);
        var existing = list.filter(function (x) { return x && x.id === newId; })[0];
        if (!existing || at(existing) < at(g)) {
          list = T.upsertManualGrade(list, {
            studentId: g.studentId, qualId: qualId, unitCode: newCode, grade: g.grade, date: g.date,
            examResultId: g.examResultId, updatedBy: actor || g.updatedBy || '', updatedAt: now
          });
          moved++;
        }
        var i = list.indexOf(g);
        if (i !== -1) list[i] = Object.assign({}, g, { supersededBy: newCode, updatedAt: now, updatedBy: actor || g.updatedBy || '' });
      });
      return { list: list, moved: moved };
    };

    /* --- The catalogue as it was when a transcript was issued ---------------
       Editing a qualification's units used to rewrite every graduate's
       transcript retroactively: a unit re-coded or dropped by a revised plan
       vanished from transcripts already issued, and a re-titled qualification
       changed the heading on documents employers already held. When a
       transcript is issued its catalogue is copied onto the trainee's
       transcript profile (profiles[studentId].issued[qualId]) and every later
       reprint of that trainee's transcript uses the copy. Additive: an older
       profile without it behaves as before. */
    T.snapshotQual = function (qual, nowIso) {
      if (!qual) return null;
      return {
        qualId: qual.id, title: qual.title || '', skillArea: qual.skillArea || '', level: qual.level == null ? null : qual.level,
        nvqCode: qual.nvqCode || '', centre: qual.centre || '',
        passMark: qual.passMark == null ? null : qual.passMark,
        units: (qual.units || []).map(function (u) {
          var c = { code: u.code, name: u.name, coreElective: u.coreElective || 'Core' };
          if (u.passMark != null && u.passMark !== '') c.passMark = u.passMark;
          return c;
        }),
        catalogUpdatedAt: qual.updatedAt || '',
        issuedAt: nowIso || new Date().toISOString()
      };
    };
    // The issued copy as a qualification the renderers can use, or null.
    T.issuedQualFor = function (profiles, studentId, qualId) {
      var p = profiles && studentId ? profiles[studentId] : null;
      var snap = p && p.issued && qualId ? p.issued[qualId] : null;
      if (!snap || !Array.isArray(snap.units)) return null;
      return {
        id: snap.qualId || qualId, title: snap.title, skillArea: snap.skillArea, level: snap.level,
        nvqCode: snap.nvqCode, centre: snap.centre, passMark: snap.passMark,
        units: snap.units.slice(), issuedAt: snap.issuedAt, issuedSnapshot: true
      };
    };
    // Record the issue (pure: returns the new profiles map). An existing copy is
    // kept — a reprint must not quietly move the transcript to today's plan.
    T.recordIssue = function (profiles, studentId, qual, nowIso) {
      var out = Object.assign({}, profiles || {});
      if (!studentId || !qual) return out;
      var p = Object.assign({}, out[studentId] || {});
      var issued = Object.assign({}, p.issued || {});
      if (issued[qual.id]) return out;
      issued[qual.id] = T.snapshotQual(qual, nowIso);
      p.issued = issued;
      p.updatedAt = nowIso || new Date().toISOString();
      out[studentId] = p;
      return out;
    };

    /* --- Which plan a trainee is assessed against ----------------------------
       Each trainee is graded against THEIR OWN programme's catalogue: a
       qualification the administrator pinned on the record (qualId) if it
       still exists, else the one their course resolves to, else the fallback
       course (an instructor's own). The instructor view used one catalogue for
       everybody it listed, so its Level 3 trainees were shown — and given grade
       sheets for — the Level 2 units. */
    T.qualForTrainee = function (catalogs, student, fallbackCourse) {
      var list = Array.isArray(catalogs) ? catalogs : [];
      if (student && student.qualId) {
        var pinned = list.filter(function (q) { return q && q.id === student.qualId; })[0];
        if (pinned) return pinned;
      }
      return (student && T.qualForCourse(list, student.course)) ||
        (fallbackCourse ? T.qualForCourse(list, fallbackCourse) : null);
    };

    /* --- Is this trainee's transcript ready for certification? --------------
       Pure. Certification (and the course-end "Not Yet Competent" rule) used to
       ignore the transcript entirely: a trainee with 10 of 46 units graded and
       two NYC units could be certified without a word. The certificate
       checklist calls this.

         data: { catalogs, grades, exams, examResults, profiles, index }
         -> { status: 'ready' | 'incomplete' | 'nyc' | 'no-catalogue',
              ready, qualId, qualTitle, total, graded, competent, nyc, pending,
              average, missingCore: [codes], nycUnits: [codes],
              pendingUnits: [codes], electivesAchieved }

       'ready' means every CORE unit is achieved (by resultFor) and nothing is
       awaiting marking. Electives are counted but not required — how many a
       plan demands is not recorded anywhere yet. Any graded unit that is NYC
       makes the status 'nyc'. Uses the issued catalogue copy when one exists. */
    T.transcriptReadiness = function (student, data) {
      data = data || {};
      var out = { status: 'no-catalogue', ready: false, qualId: null, qualTitle: '', total: 0, graded: 0,
                  competent: 0, nyc: 0, pending: 0, average: null, missingCore: [], nycUnits: [],
                  pendingUnits: [], electivesAchieved: 0 };
      if (!student) return out;
      // The plan: resolved from the catalogues when given (pinned qualId, then
      // the trainee's course), else the one the caller already resolved
      // (data.qual); the issued copy of it whenever one exists.
      var cats = Array.isArray(data.catalogs) ? T.ensureSeeded(data.catalogs) : null;
      var live = cats ? T.qualForTrainee(cats, student) : (data.qual || null);
      var qual = (live && T.issuedQualFor(data.profiles, student.id, live.id)) || live;
      out.known = false;
      out.detail = 'No unit catalogue for this programme';
      if (!qual || !Array.isArray(qual.units) || !qual.units.length) return out;
      var rows = T.effectiveGrades({ qual: qual, studentId: student.id, manualGrades: data.grades || data.manualGrades || [],
        exams: data.exams, examResults: data.examResults, catalogs: cats, index: data.index });
      var stats = T.gradeStats(rows, qual);
      out.qualId = qual.id; out.qualTitle = qual.title || '';
      out.total = stats.total; out.graded = stats.graded; out.competent = stats.competent;
      out.nyc = stats.nyc; out.pending = stats.pending; out.average = stats.average;
      rows.forEach(function (r) {
        var res = T.resultForRow(r, qual);
        var core = String(r.coreElective || 'Core').toLowerCase() !== 'elective';
        if (r.source === 'pending') out.pendingUnits.push(r.code);
        if (res === 'NYC') out.nycUnits.push(r.code);
        if (core && res !== 'COMPETENT') out.missingCore.push(r.code);
        if (!core && res === 'COMPETENT') out.electivesAchieved++;
      });
      out.known = true;
      if (out.nycUnits.length) out.status = 'nyc';
      else if (out.missingCore.length || out.pendingUnits.length) out.status = 'incomplete';
      else out.status = 'ready';
      out.ready = out.status === 'ready';
      var list = function (codes) { return codes.slice(0, 3).join(', ') + (codes.length > 3 ? '…' : ''); };
      out.detail = out.competent + ' of ' + out.total + ' units competent' +
        (out.nycUnits.length ? '; not yet competent: ' + list(out.nycUnits) : '') +
        (out.pendingUnits.length ? '; awaiting marking: ' + list(out.pendingUnits) : '') +
        (out.missingCore.length && !out.nycUnits.length ? '; core units not yet achieved: ' + out.missingCore.length : '') +
        (out.ready ? ' — ready to certify' : '');
      return out;
    };

    /* --- One person, several enrolments --------------------------------------
       A trainee's id is per (name, programme), so someone who went from Level 2
       to Level 3 has two records, two transcripts and two headers. These are
       the OTHER records of the same person, for the transcript view to link.
       `strict` (the trainee's own view) links only on evidence that it is the
       same human — the same TRN / national ID, or the same date of birth on the
       transcript header — because a namesake on another programme is somebody
       else and must never see this person's grades. Without `strict` (staff)
       a same-name record is offered too, flagged `sameNameOnly`. A record
       pinned "keep separate" is never linked by name. */
    T.otherEnrolments = function (student, students, profiles, strict) {
      if (!student) return [];
      var n = Core.normName(student.name);
      if (!n) return [];
      var idOf = function (s) {
        var p = (profiles && profiles[s.id]) || {};
        return String(s.trn || s.TRN || s.nationalId || p.idNo || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
      };
      var dobOf = function (s) {
        var p = (profiles && profiles[s.id]) || {};
        return String(p.dob || s.dob || '').trim();
      };
      var myId = idOf(student), myDob = dobOf(student);
      var out = [];
      (students || []).forEach(function (s) {
        if (!s || s === student || s.id === student.id || Core.normName(s.name) !== n) return;
        var theirId = idOf(s), theirDob = dobOf(s);
        if (myId && theirId && myId !== theirId) return;           // two different people
        if (myDob && theirDob && myDob !== theirDob) return;
        var strong = !!(myId && theirId && myId === theirId) || !!(myDob && theirDob && myDob === theirDob);
        if (!strong && (strict || Core.isKeptSeparate(s) || Core.isKeptSeparate(student))) return;
        out.push({ student: s, sameNameOnly: !strong });
      });
      return out;
    };

    /* --- Qualification lookup for a trainee's course ----------------------- */

    // "beauty therapy l2" / "welding lvl 3" / "cosmetology level 2" -> 2 / 3 / 2.
    function courseLevel(norm) {
      var m = /(?:^|\s)l(?:vl|evel)?\s*(\d+)(?:\s|$)/.exec(norm);
      return m ? Number(m[1]) : null;
    }
    var LEVEL_TOKEN = /^(?:l|lvl|level)\d*$|^\d+$/;

    // Course names are typed by hand on the enrolment side, so a token still
    // counts as matching on a shared prefix ("cosmetol…") or a one-character
    // typo ("cosmotology" vs "cosmetology").
    function tokenMatches(a, b) {
      if (a === b) return true;
      if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
      if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
      var i = 0;
      while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
      if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
      var s = a.length > b.length ? a : b, t = a.length > b.length ? b : a;
      return s.slice(i + 1) === t.slice(i);
    }

    T.qualForCourse = function (catalogs, course) {
      var list = Array.isArray(catalogs) ? catalogs : [];
      var c = T.normText(course);
      if (!c) return null;
      var lvl = courseLevel(c);
      function levelOk(q) { return lvl == null || q.level == null || Number(q.level) === lvl; }
      var exact = list.filter(function (q) { return q && T.normText(q.skillArea) === c; })[0];
      if (exact) return exact;
      var contains = list.filter(function (q) {
        if (!q || !levelOk(q)) return false;
        var sa = T.normText(q.skillArea), ti = T.normText(q.title);
        return (sa && (c.indexOf(sa) !== -1 || sa.indexOf(c) !== -1)) ||
               (ti && (ti.indexOf(c) !== -1 || c.indexOf(ti) !== -1));
      })[0];
      if (contains) return contains;
      // Fuzzy fallback: score each catalogue by how many of the course's
      // significant words appear in its skill area / title. A course that
      // shares no words with any catalogue resolves to null so callers can
      // clear a stale selection instead of keeping the previous skill area.
      var words = c.split(' ').filter(function (w) { return w && !LEVEL_TOKEN.test(w); });
      if (!words.length) return null;
      var best = null, bestScore = 0;
      list.forEach(function (q) {
        if (!q || !levelOk(q)) return;
        var qWords = (T.normText(q.skillArea) + ' ' + T.normText(q.title)).split(' ');
        var hits = 0;
        words.forEach(function (w) {
          if (qWords.some(function (u) { return tokenMatches(w, u); })) hits++;
        });
        var score = hits / words.length;
        if (hits && score >= 0.5 && score > bestScore) { best = q; bestScore = score; }
      });
      return best;
    };

    /* --- Certificate / Transcript requests --------------------------------- */
    T.newRequest = function (opts) {
      opts = opts || {};
      return {
        id: 'CTR-' + Core.hashString(String(opts.studentId) + '|' + String(opts.type) + '|' + String(opts.requestedAt || new Date().toISOString())),
        studentId: opts.studentId || '',
        studentName: opts.studentName || '',
        course: opts.course || '',
        type: opts.type === 'certificate' || opts.type === 'both' ? opts.type : 'transcript',
        note: opts.note || '',
        status: 'pending',
        requestedAt: opts.requestedAt || new Date().toISOString(),
        // When this copy of the request last changed: what decides, request by
        // request, which device's copy is current (see mergeRequestLists).
        updatedAt: opts.requestedAt || new Date().toISOString(),
        handledBy: '', handledAt: '', adminNote: ''
      };
    };

    /* A request queue is merged REQUEST BY REQUEST, never as one list.

       Trainees append requests on their own devices and the administration
       changes their status on another. Writing the whole list from whatever
       copy a page loaded a few seconds earlier — or letting the newest whole
       list win a sync — meant a trainee's new request erased a status change
       made meanwhile, or the reverse, and a trainee's device, which keeps only
       its own requests after sign-out, could replace the Centre's whole queue.
       Every request either side holds survives; when both hold one, the copy
       changed last (updatedAt, else handledAt, else requestedAt) wins and its
       blanks are filled from the other. Pure; returns a new list. */
    T.REQUEST_STAMPS = ['updatedAt', 'handledAt', 'requestedAt'];
    function requestTime(r) {
      var best = 0;
      T.REQUEST_STAMPS.forEach(function (f) {
        var t = Date.parse((r && r[f]) || '');
        if (!isNaN(t) && t > best) best = t;
      });
      return best;
    }
    T.mergeRequestLists = function (a, b) {
      var out = [], at = {};
      var take = function (r, fromB) {
        if (!r || typeof r !== 'object') return;
        var id = r.id != null ? String(r.id) : null;
        if (id === null || at[id] === undefined) {
          if (id !== null) at[id] = out.length;
          out.push(r);
          return;
        }
        var cur = out[at[id]];
        var win = requestTime(r) > requestTime(cur) ? r : cur;
        var lose = win === r ? cur : r;
        var merged = Object.assign({}, win);
        Object.keys(lose).forEach(function (f) {
          if ((merged[f] === undefined || merged[f] === null || merged[f] === '') &&
              lose[f] !== undefined && lose[f] !== null && lose[f] !== '') merged[f] = lose[f];
        });
        out[at[id]] = merged;
      };
      (Array.isArray(a) ? a : []).forEach(function (r) { take(r, false); });
      (Array.isArray(b) ? b : []).forEach(function (r) { take(r, true); });
      return out;
    };

    /* Change one request's status, by id, on the CURRENT list (read it from
       the store just before calling). Returns { list, request } — request is
       null when no such request exists any more. */
    T.setRequestStatus = function (requests, id, status, actor, note, nowIso) {
      var list = Array.isArray(requests) ? requests.slice() : [];
      var now = nowIso || new Date().toISOString();
      var hit = null;
      list = list.map(function (r) {
        if (!r || r.id !== id) return r;
        hit = Object.assign({}, r, { status: status, handledBy: actor || '', handledAt: now, updatedAt: now });
        if (note != null) hit.adminNote = note;
        return hit;
      });
      return { list: list, request: hit };
    };

    // A trainee may have at most one OPEN (pending/processing/ready) request
    // per document type; further clicks are ignored instead of piling up.
    T.hasOpenRequest = function (requests, studentId, type) {
      return (requests || []).some(function (r) {
        return r && r.studentId === studentId &&
          (r.type === type || r.type === 'both' || type === 'both') &&
          (r.status === 'pending' || r.status === 'processing' || r.status === 'ready');
      });
    };

    T.pendingRequestCount = function (requests) {
      return (requests || []).filter(function (r) { return r && (r.status === 'pending' || r.status === 'processing') ; }).length;
    };

    return T;
  })();

  /* Is this trainee's transcript ready for a certificate? (Core.Transcript
     .transcriptReadiness.) The certificate checklist looks for it here. With
     no unit catalogue to judge by it answers null, so the checklist falls back
     to the trainee's exam results instead of reporting "unknown". */
  Core.transcriptReadiness = function (student, data) {
    var r = Core.Transcript.transcriptReadiness(student, data);
    return (r && r.known) ? r : null;
  };

  /* --------------------------------------------------------------------------
     Core.Finance — pure helpers for the Payments/Invoices module.

     Payment vouchers are generated straight from the cashbook's quarterly
     transaction records ({id, date, cheque, details, deposit, payment,
     category}). The classification rule mirrors office practice: a payment
     WITH a cheque number gets a HEART/NSTA Cheque Payment Voucher; a payment
     WITHOUT one is a bank transfer and gets a CESTIS Bank Transfer voucher.
     Deposits and cancelled/voided cheques get no voucher at all.
     -------------------------------------------------------------------------- */
  Core.Finance = (function () {
    var F = {};

    var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
                'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
                'Seventeen', 'Eighteen', 'Nineteen'];
    var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    var SCALES = [
      { value: 1e9, name: 'Billion' },
      { value: 1e6, name: 'Million' },
      { value: 1e3, name: 'Thousand' }
    ];

    function threeDigitsToWords(n) { // 0..999 -> 'Nine Hundred and Ninety-Nine'
      var parts = [];
      var hundreds = Math.floor(n / 100), rest = n % 100;
      if (hundreds) parts.push(ONES[hundreds] + ' Hundred');
      if (rest) {
        var restWords = rest < 20 ? ONES[rest]
          : TENS[Math.floor(rest / 10)] + (rest % 10 ? '-' + ONES[rest % 10] : '');
        parts.push(hundreds ? 'and ' + restWords : restWords);
      }
      return parts.join(' ');
    }

    /* Whole number to words: 130565 -> 'One Hundred and Thirty Thousand, Five
       Hundred and Sixty-Five'. Handles 0 .. 999,999,999,999. */
    F.numberToWords = function (n) {
      n = Math.floor(Math.abs(Number(n) || 0));
      if (n === 0) return 'Zero';
      var parts = [];
      for (var i = 0; i < SCALES.length; i++) {
        var count = Math.floor(n / SCALES[i].value);
        if (count) { parts.push(threeDigitsToWords(count) + ' ' + SCALES[i].name); n %= SCALES[i].value; }
      }
      if (n) parts.push(threeDigitsToWords(n));
      return parts.join(', ');
    };

    /* Voucher-style money in words, matching how the office writes it:
       130565.96 -> 'One Hundred and Thirty Thousand, Five Hundred and
       Sixty-Five Dollars and 96/100'. */
    F.amountToWords = function (amount) {
      var n = Math.abs(Number(amount) || 0);
      var dollars = Math.floor(n);
      var cents = Math.round((n - dollars) * 100);
      if (cents === 100) { dollars += 1; cents = 0; } // 12.999 rounds up to 13.00
      var words = F.numberToWords(dollars) + (dollars === 1 ? ' Dollar' : ' Dollars');
      return words + (cents ? ' and ' + (cents < 10 ? '0' + cents : cents) + '/100' : '');
    };

    F.formatMoney = function (n) {
      n = Number(n) || 0;
      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    /* Classify a cashbook transaction: 'cheque' | 'transfer' | null (no voucher).
       Only actual payments qualify — deposits, zero rows and cancelled/voided
       cheques (the cashbook marks both with category 'Cancelled') are skipped. */
    F.voucherTypeFor = function (txn) {
      if (!txn) return null;
      if (String(txn.category || '') === 'Cancelled') return null;
      if (!(Number(txn.payment) > 0)) return null;
      return String(txn.cheque == null ? '' : txn.cheque).trim() ? 'cheque' : 'transfer';
    };

    /* Expand a quarter's transactions into printable voucher records. */
    F.vouchersFromTransactions = function (transactions) {
      return (Array.isArray(transactions) ? transactions : []).reduce(function (out, t) {
        var type = F.voucherTypeFor(t);
        if (!type) return out;
        out.push({
          txnId: t.id,
          txnUid: t.uid || '',                          // the same cheque on every device
          type: type,                                   // 'cheque' | 'transfer'
          date: t.date || '',
          payee: t.details || '',
          detail: t.details || '',
          accountCharged: t.category || '',
          chequeNo: type === 'cheque' ? String(t.cheque).trim() : '',
          amount: Number(t.payment) || 0
        });
        return out;
      }, []);
    };

    /* Next document number: max numeric value found + 1, or the seed when the
       list is empty / non-numeric. Accepts numbers or strings ('12550'). */
    F.nextDocNumber = function (existingNumbers, seed) {
      var max = 0;
      (Array.isArray(existingNumbers) ? existingNumbers : []).forEach(function (n) {
        var v = parseInt(String(n).replace(/[^0-9]/g, ''), 10);
        if (isFinite(v) && v > max) max = v;
      });
      return max ? max + 1 : (Number(seed) || 1);
    };

    /* Line-item total that understands both document styles:
       - standard rows: qty × unit price
       - school/RBF rows: percentage% × budget amount */
    F.lineTotal = function (item, schoolStyle) {
      if (!item) return 0;
      var a = Number(item.qty) || 0, b = Number(item.unitPrice) || 0;
      return schoolStyle ? (a / 100) * b : a * b;
    };

    /* Document totals: subtotal over item rows (description-only rows carry no
       amounts), discount as a percentage, tax as a percentage of the discounted
       balance. Returns every figure the paper layout prints. */
    F.docTotals = function (doc) {
      doc = doc || {};
      var school = doc.template === 'school';
      var subtotal = (Array.isArray(doc.items) ? doc.items : []).reduce(function (s, it) {
        return s + (it && !it.isNote ? F.lineTotal(it, school) : 0);
      }, 0);
      var discountPct = Number(doc.discountPct) || 0;
      var discount = subtotal * discountPct / 100;
      var taxPct = Number(doc.taxPct) || 0;
      var tax = (subtotal - discount) * taxPct / 100;
      var amountDue = subtotal - discount + tax;
      var depositPct = Number(doc.depositPct) || 0;
      return {
        subtotal: subtotal, discount: discount, tax: tax, amountDue: amountDue,
        deposit: depositPct ? amountDue * depositPct / 100 : 0
      };
    };

    return F;
  })();

  /* ==========================================================================
     ACCOUNT ACCESS — who may sign in, and why not

     WHY THIS EXISTS
     ---------------
     Each of the five role login handlers used to test account status inline,
     and they did not agree with each other. Between them:
       - NO handler tested for 'rejected'. rejectUser() sets that status, so a
         registration an administrator had explicitly refused could still sign
         in with full access — the opposite of what rejecting means.
       - NO handler tested whether the account has a password at all. The fee
         sync and the chat backfill create trainee accounts with password:'',
         so a trainee could be activated by an administrator and still be told
         "invalid username or password" on every attempt, with nothing on the
         admin side showing why.
       - The admin handler alone never tested 'pending'.
       - Identifiers were compared with ===, so an account registered as
         "John.Smith@Gmail.com" could not be reached by typing the same address
         in lower case. Nobody had disabled anything; the trainee was simply
         locked out by letter case.

     The rule the Centre wants is simple: a trainee is kept out only when an
     administrator has kept them out. Everything below either enforces that or
     names the exact reason so the administrator can fix it.
     ========================================================================== */
  Core.accountAccess = (function () {

    /* Compare a typed username/email against an account's. Case and surrounding
       whitespace never decide whether someone can sign in. */
    function idMatches(account, identifier) {
      if (!account) return false;
      var want = String(identifier == null ? '' : identifier).trim().toLowerCase();
      if (!want) return false;
      var u = String(account.username || '').trim().toLowerCase();
      var e = String(account.email || '').trim().toLowerCase();
      return (!!u && u === want) || (!!e && e === want);
    }

    /* A stored password that can never authenticate. verifyPassword() falls
       through to a plaintext compare for anything that is not a PBKDF2 or
       legacy hash, so '' only ever matches an empty submission — which the
       login forms reject. Such an account is unusable until a password is set. */
    function hasPassword(account) {
      return !!(account && typeof account.password === 'string' && account.password.length > 0);
    }

    /* Can this account sign in right now? Returns the outcome plus a message
       written for the person reading it.
         allowed  - proceed to the password check
         reason   - 'ok' | 'not-found' | 'disabled' | 'rejected' | 'pending' | 'no-password'
         adminFix - true when an administrator must act before this account works
                    (as opposed to the account simply being switched off on purpose) */
    function check(account) {
      if (!account) {
        return { allowed: false, reason: 'not-found', adminFix: false,
          message: 'No account found for that username or email on this device. Use "Sync Now" first, or contact an administrator.' };
      }
      var status = String(account.status || '').trim().toLowerCase();
      if (status === 'disabled') {
        return { allowed: false, reason: 'disabled', adminFix: false,
          message: 'This account has been disabled. Contact an administrator.' };
      }
      if (status === 'rejected') {
        return { allowed: false, reason: 'rejected', adminFix: false,
          message: 'This registration was not approved. Contact an administrator.' };
      }
      if (status === 'pending') {
        return { allowed: false, reason: 'pending', adminFix: true,
          message: 'This account is awaiting approval by an administrator.' };
      }
      if (!hasPassword(account)) {
        return { allowed: false, reason: 'no-password', adminFix: true,
          message: 'No password has been set for this account yet. Ask an administrator to set one for you (Settings → Users → Reset Password).' };
      }
      return { allowed: true, reason: 'ok', adminFix: false, message: '' };
    }

    /* Find the account a login attempt refers to. Role and identifier must both
       match; where more than one record does (a duplicate left by a sync), the
       one that can actually sign in wins, so a password-less or disabled
       placeholder can never shadow the trainee's real account. */
    function find(accounts, role, identifier) {
      var list = Array.isArray(accounts) ? accounts : [];
      var want = String(role == null ? '' : role).trim().toLowerCase();
      var best = null;
      list.forEach(function (a) {
        if (!a) return;
        if (String(a.role || '').trim().toLowerCase() !== want) return;
        if (!idMatches(a, identifier)) return;
        if (!best || Core.accountLoginScore(a) > Core.accountLoginScore(best)) best = a;
      });
      return best;
    }

    /* The same lookup across every role — used by password recovery, where the
       person may not know which role their account was filed under. */
    function findAnyRole(accounts, identifier) {
      var list = Array.isArray(accounts) ? accounts : [];
      var best = null;
      list.forEach(function (a) {
        if (!a || !idMatches(a, identifier)) return;
        if (!best || Core.accountLoginScore(a) > Core.accountLoginScore(best)) best = a;
      });
      return best;
    }

    /* What an administrator should see in the accounts table. The old table
       showed one on/off toggle, so "never reviewed", "refused" and "switched
       off" were indistinguishable — and an account with no password looked
       fully enabled while nobody could sign into it. */
    function adminLabel(account) {
      var res = check(account);
      if (res.reason === 'ok') return { label: 'Active', tone: 'good', detail: '' };
      if (res.reason === 'disabled') return { label: 'Disabled', tone: 'off', detail: 'Switched off by an administrator' };
      if (res.reason === 'rejected') return { label: 'Rejected', tone: 'bad', detail: 'Registration was refused' };
      if (res.reason === 'pending') return { label: 'Pending', tone: 'warn', detail: 'Awaiting approval in Verify Users' };
      if (res.reason === 'no-password') return { label: 'No password', tone: 'warn', detail: 'Cannot sign in until a password is set' };
      return { label: 'Unknown', tone: 'off', detail: '' };
    }

    /* Accounts that can actually administer the platform right now: role admin,
       not blocked, and holding a password somebody can sign in with. An account
       that merely LOOKS active is not enough — that is the distinction the
       Centre kept losing. */
    function usableAdmins(accounts) {
      return (Array.isArray(accounts) ? accounts : []).filter(function (a) {
        return a && String(a.role || '').trim().toLowerCase() === 'admin' && check(a).allowed;
      });
    }

    /* Would disabling these account ids leave nobody able to administer the
       platform? Bulk Deactivate had no such guard: selecting every row switched
       off every administrator, and the only way back in was the seeded recovery
       login. Returns the ids that must keep their access. */
    function wouldStrandAdmins(accounts, idsToDisable) {
      var ids = Array.isArray(idsToDisable) ? idsToDisable : [idsToDisable];
      var current = usableAdmins(accounts);
      var remaining = current.filter(function (a) { return ids.indexOf(a.id) === -1; });
      return remaining.length === 0 ? current.map(function (a) { return a.id; }) : [];
    }

    /* Should the seeded recovery administrator (USR-001) be forced back to a
       usable state?
       The loader used to do this unconditionally, on every single page load —
       along with rewriting the seeded admin-staff and board usernames back to
       'adminstaff' and 'cmcadmin'. Renaming those shared logins to a real member
       of staff therefore lasted until the next refresh, after which that person
       could no longer sign in; nobody had disabled them. Recovery only needs to
       step in when there is no other way in. */
    function needsRecoveryAdmin(accounts) {
      return usableAdmins(accounts).length === 0;
    }

    /* May these accounts be deleted? Deleting is disabling that cannot be undone,
       so it answers to the same rule and two more of its own.

       An administrator can remove any role — a trainee, an instructor, admin
       staff, a board member, another administrator — because the Centre's staff
       change and a login nobody owns any more is the thing being cleaned up.
       What they must not be able to do by accident is lock the Centre out of its
       own platform, or delete the chair they are sitting on.

         actingId - the id of the administrator doing the deleting, if known */
    function deletionBlocked(accounts, idsToDelete, opts) {
      opts = opts || {};
      var ids = (Array.isArray(idsToDelete) ? idsToDelete : [idsToDelete])
        .filter(function (v) { return v != null && v !== ''; });
      if (!ids.length) {
        return { blocked: true, reason: 'none-selected', ids: [],
          message: 'No accounts were selected.' };
      }
      if (opts.actingId && ids.indexOf(opts.actingId) !== -1) {
        return { blocked: true, reason: 'self', ids: [opts.actingId],
          message: 'You cannot delete the account you are signed in with.\n\n' +
            'Ask another administrator to remove it, or sign in as someone else first.' };
      }
      var stranded = wouldStrandAdmins(accounts, ids);
      if (stranded.length) {
        return { blocked: true, reason: 'strand-admins', ids: stranded,
          message: 'That would delete every administrator who can sign in, leaving nobody ' +
            'able to manage the platform.\n\nKeep at least one administrator, or create ' +
            'another one first (+ Create User).' };
      }
      return { blocked: false, reason: 'ok', ids: ids, message: '' };
    }

    /* Remove every account whose id has been written down as deleted.

       Deleting an account is written down rather than acted out, for the same
       reason a deleted trainee is: the record is still present in the other
       device's copy, and every merge reads "missing here" as "new there" and
       adds it back. This is the sweep that makes the removal stick — run it
       wherever the list is loaded or saved and a revoked login cannot return by
       ANY path, without each of those paths having to know about it. */
    function dropDeleted(accounts, deletedMap) {
      var list = Array.isArray(accounts) ? accounts : [];
      var del = deletedMap || {};
      var droppedIds = [];
      var kept = list.filter(function (a) {
        if (a && a.id != null && del[a.id] === true) { droppedIds.push(a.id); return false; }
        return true;
      });
      return { accounts: kept, removed: droppedIds.length, droppedIds: droppedIds };
    }

    /* ---- Which copy of an account a cloud merge keeps ----------------------

       Every device seeds the three built-in logins (cestisadmin, adminstaff,
       cmcadmin) with the published default password the first time it opens
       the platform, and only then pulls the real accounts from Drive. The merge
       decided between two copies of an account by their edit stamp (updatedAt)
       and treated a tie — which is what two UNSTAMPED copies are — as "the
       cloud copy wins". Most long-standing accounts are unstamped: the stamp
       arrived long after their passwords were set. So a tie went to whichever
       copy happened to arrive last: a brand-new device's seed, the backup in a
       redundant Drive folder that a failed write left behind, a laptop that had
       been off for months. Any of those carried a stale or default password
       over the real one, and the next autosave carried it to every other
       device. The Centre saw accounts nobody had touched refuse the right
       password — the administrator's first, since that is the account every
       device seeds and every backup ever written contains.

       The rule is now:
         1. a strictly newer stamp wins, in either direction (as before);
         2. on a tie, a seeded copy — one still marked as holding its
            published default — yields to a copy holding a real password, in
            either direction: a fresh device takes the real account, and a
            seed can never replace a real password;
         3. any other tie converges on the cloud copy, as before, so legacy
            deployments still settle. (checkPassword stamps an unstamped copy
            the moment it authenticates its owner, so after one sign-in the
            working password is the newest copy and rule 1 protects it.) */
    var KNOWN_DEFAULT_PASSWORDS = ['cestisadmin123$', 'admin123'];

    /* A copy still on the platform's published default: seeded by a device
       that had never seen the real account, or never changed since. The seed
       carries defaultPassword:true (older versions marked the same thing as
       mustChangePassword), and a seed that has not been hashed yet is the
       published text itself. */
    function isSeededLogin(account) {
      if (!account) return false;
      if (account.defaultPassword === true || account.mustChangePassword) return true;
      return KNOWN_DEFAULT_PASSWORDS.indexOf(account.password) !== -1;
    }

    function editStamp(account) {
      var t = Date.parse((account && account.updatedAt) || '');
      return isNaN(t) ? 0 : t;
    }

    /* Should the cloud copy of an account replace the local one? */
    function cloudCopyWins(local, cloud) {
      if (!cloud) return false;
      if (!local) return true;
      var cu = editStamp(cloud), lu = editStamp(local);
      if (cu > lu) return true;
      if (lu > cu) return false;
      var cloudReal = hasPassword(cloud) && !isSeededLogin(cloud);
      var localReal = hasPassword(local) && !isSeededLogin(local);
      if (localReal && !cloudReal) return false;   // a default never replaces a real password
      if (cloudReal && !localReal) return true;    // the seed on a fresh device yields
      // Two real copies with the same edit stamp: the one that most recently
      // let its owner sign in is the working one. (A sign-in used to stamp
      // updatedAt itself, which made a stale device's copy NEWER than an
      // administrator's earlier "disable" — and the next sync switched the
      // account back on everywhere. The sign-in proof now has its own field,
      // verifiedAt, and only ever breaks a tie; status, role and name follow
      // updatedAt alone.)
      var cv = Date.parse((cloud && cloud.verifiedAt) || '') || 0;
      var lv = Date.parse((local && local.verifiedAt) || '') || 0;
      if (lv > cv) return false;
      if (cv > lv) return true;
      return true;                                 // legacy tie: converge on the cloud copy
    }

    /* Is this a password printed in the platform's own (public) repository? */
    function isPublishedDefault(password) {
      return typeof password === 'string' && KNOWN_DEFAULT_PASSWORDS.indexOf(password) !== -1;
    }

    /* A sign-in has just matched a published default password. May it go on?

       The built-in logins were seeded with a password anybody can read on
       GitHub, and they kept it until somebody changed it — so a trainee at a lab
       PC could type it and get the Administrator panel, the Admin Staff portal
       or the Board's countersignature. The default now opens nothing by
       itself:
         - once the Centre has ANY administrator with a password of its own
           (not a seed), a login still on the default is refused outright — an
           administrator sets its password in Settings → Users;
         - before that (a brand-new installation, or a Centre whose every
           administrator is still on the seed), the default is accepted only
           to set a new password, before anything else opens. That is the
           first-run path that keeps the Centre from ever being locked out.
       Returns { allowed, mustChange, message }. */
    function publishedDefaultLogin(accounts, account) {
      var real = usableAdmins(accounts).filter(function (a) {
        return a !== account && !(account && a.id != null && a.id === account.id) && !isSeededLogin(a);
      });
      if (real.length) {
        return { allowed: false, mustChange: false,
          message: 'This login is still on the default password published with the platform, so it cannot be used to sign in.\n\n' +
            'Ask an administrator to set a new password for it (Settings → Users → Reset Password).' };
      }
      return { allowed: true, mustChange: true, message: '' };
    }

    /* The same rule for a finance tool that keeps its OWN list of logins
       (Payroll). Its built-in administrator was seeded with the published
       default and nothing ever made anyone change it, so on a lab PC where the
       dashboard already refused the default, Payroll still opened with it as
       Administrator. The default now opens nothing there either:
         - if another administrator of the tool has a password of its own,
           it is refused outright (that administrator sets a new one);
         - otherwise it may only be used to set a new password, before
           anything opens — and only when an administrator is signed in to the
           dashboard on this computer, or on a brand-new installation whose
           dashboard has no administrator with a real password yet. A trainee
           at a lab PC can do neither, and the Centre is never locked out: an
           administrator signs in to the dashboard, opens Payroll, and sets it.
       opts: { otherRealAdmin: bool, lmsAccounts: [voctrain_users], lmsAdminSession: bool }
       Returns { allowed: false, mustChange, message } — the default itself is
       never "allowed"; mustChange means "ask for a new password now". */
    function toolDefaultLogin(opts) {
      opts = opts || {};
      if (opts.otherRealAdmin) {
        return { allowed: false, mustChange: false,
          message: 'This login is still on the default password published with the platform, so it cannot be used to sign in.\n\n' +
            'Ask another administrator of this page to set a new password for it.' };
      }
      var centreReal = usableAdmins(opts.lmsAccounts).filter(function (a) { return !isSeededLogin(a); }).length > 0;
      if (centreReal && !opts.lmsAdminSession) {
        return { allowed: false, mustChange: false,
          message: 'This login is still on the default password published with the platform, so it cannot be used to sign in.\n\n' +
            'An administrator must sign in to the C.E.S.T.I.S dashboard on this computer first, then open this page and set a new password for it.' };
      }
      return { allowed: false, mustChange: true, message: '' };
    }

    /* The recovery e-mail the built-in logins were seeded with. Nobody at the
       Centre reads that domain, so a reset code sent there is lost — or, if
       the domain ever changes hands, read by a stranger. */
    var PLACEHOLDER_RECOVERY_EMAILS = ['admin@heartlms.edu.jm', 'adminstaff@heartlms.edu.jm', 'cmc@heartlms.edu.jm'];
    function isPlaceholderRecoveryEmail(email) {
      return PLACEHOLDER_RECOVERY_EMAILS.indexOf(String(email == null ? '' : email).trim().toLowerCase()) !== -1;
    }

    /* The role a self-registration may ask for. The form carried it in a
       hidden field and the value was stored as typed, so editing that field in
       the browser's inspector filed a registration as 'admin' — and Approve All
       made the registrant an Administrator on every device. A registration is a
       trainee's or an instructor's request at most; any other role is decided
       by the approving administrator (Edit User). */
    function registrationRole(requested) {
      return String(requested == null ? '' : requested).trim().toLowerCase() === 'instructor' ? 'instructor' : 'student';
    }
    /* A registration that came in through the public form but carries a staff
       role — tampered, or from a version before the rule above. Approving it
       must never be one click. */
    function isPrivilegedSelfRegistration(account) {
      if (!account || (account.registeredVia !== 'registration' && account.registeredVia !== 'home-registration')) return false;
      var r = String(account.role || '').trim().toLowerCase();
      // A registration from home is a trainee's, always (the trainee gate files nothing else).
      return account.registeredVia === 'home-registration' ? r !== 'student' : (r !== 'student' && r !== 'instructor');
    }

    /* Is this a person's full name — a first name AND a last name? Two or
       more words of two letters or more, titles (Mr, Mrs, Dr …) not counted.
       It is the rule every account form already applies (Staff Appraisals'
       sappIsFullName in staff-appraisals.js, kept equal to this by
       tests/office-trainee-accounts.test.js); it is here as well so the
       trainee gate, which has no page of its own, applies the same one. */
    var NAME_TITLES = { mr: 1, mrs: 1, ms: 1, miss: 1, dr: 1, prof: 1, hon: 1, rev: 1 };
    function isFullName(name) {
      var toks = String(name == null ? '' : name).toLowerCase().replace(/[-_.,'’]/g, ' ').split(/\s+/)
        .filter(function (t) { return t && !NAME_TITLES[t] && t.length >= 2; });
      return toks.length >= 2;
    }

    /* May the office create this account? (The owner: "both the office admin
       staff and administrators can create accounts for students".)

       An administrator may create any role. Admin Staff may create TRAINEE
       accounts only — never an administrator, admin staff, instructor or
       board login — and only while the Administrator leaves "Trainee
       accounts" ticked in Admin Staff access (actor.allowed). Every account
       answers to the rules each sign-up form already follows: a full name, no
       markup in a name or address, a username nobody holds (in any case), a
       password of six characters or more, a programme for anybody who is not
       office staff. A trainee account also needs an email address nobody
       holds (in any case, any role — the registration form's rule, so email
       sign-in can never name two people; left blank, it is not checked) and
       a programme that is taking trainees now (opts.enrolBlock: the page's
       courseEnrolmentBlockReason() for it).
         actor: { role, allowed }   draft: { role, name, username, email, programme, password }
       → null when it may be created, else { code, message }. */
    var STAFF_ROLES = { admin: 1, adminstaff: 1, cmc: 1 };
    // A phone number as people write one: digits, spaces, + - . ( ), 7–20 long.
    var PHONE_RE = /^(?=(?:\D*\d){7})[0-9+()\-.\s]{7,20}$/;
    function officeCreateRefusal(actor, draft, accounts, opts) {
      opts = opts || {};
      actor = actor || {};
      draft = draft || {};
      var who = String(actor.role || '').trim().toLowerCase();
      var role = String(draft.role || '').trim().toLowerCase();
      var no = function (code, message) { return { code: code, message: message }; };
      if (who !== 'admin' && who !== 'adminstaff') return no('not-allowed', 'Only the office can create accounts.');
      if (who === 'adminstaff' && actor.allowed === false) {
        return no('not-allowed', 'Creating trainee accounts has been switched off for Admin Staff by the Administrator.');
      }
      if (who === 'adminstaff' && role !== 'student') return no('role', 'Admin Staff can create trainee accounts only.');
      if (!role) return no('missing', 'Please choose a role.');
      var name = String(draft.name == null ? '' : draft.name).trim();
      var username = String(draft.username == null ? '' : draft.username).trim();
      var email = String(draft.email == null ? '' : draft.email).trim();
      var password = String(draft.password == null ? '' : draft.password);
      if (!name || !username || !password) return no('missing', 'Please fill in Name, Username, and Password.');
      if (!isFullName(name)) {
        return no('full-name', role === 'student'
          ? 'Please enter the trainee\'s FULL name — first name AND last name (e.g. "John Smith").'
          : 'Please enter the user\'s FULL name — first name AND last name (e.g. "John Smith").\n\nThe full name is required to link staff to their Payslip employee record.');
      }
      if (/[<>]/.test(name) || /[<>"]/.test(email) || /[<>"]/.test(username)) {
        return no('markup', 'Names, usernames and email addresses cannot contain < > or " characters.');
      }
      if (password.length < 6) return no('password', 'Password must be at least 6 characters.');
      if (draft.phone != null && String(draft.phone).trim() && !PHONE_RE.test(String(draft.phone).trim())) {
        return no('phone', 'Please enter the phone number with digits only (spaces and + - ( ) are fine), or leave it blank.');
      }
      var list = Array.isArray(accounts) ? accounts : [];
      var un = username.toLowerCase();
      if (list.some(function (u) { return u && String(u.username || '').trim().toLowerCase() === un; })) return no('username-taken', 'Username already exists.');
      if (!STAFF_ROLES[role] && !String(draft.programme == null ? '' : draft.programme).trim()) return no('programme', 'Please select a programme.');
      if (role === 'student') {
        if (email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return no('email', 'Please enter a valid email address, or leave it blank.');
          var em = email.toLowerCase();
          if (list.some(function (u) { return u && String(u.email || '').trim().toLowerCase() === em; })) {
            return no('email-taken', 'An account with this email already exists. Find it in the accounts list instead of creating a second one.');
          }
        }
        if (opts.enrolBlock) return no('enrol', String(opts.enrolBlock));
      }
      return null;
    }

    /* What Verify Users lists, and what Approve All / Reject All act on.

       It used to be every pending account PLUS every disabled one except
       administrators — so a departed member of Admin Staff, a removed
       instructor or an expelled trainee an administrator had switched off on
       purpose came back to life the next time somebody pressed Approve All
       for a batch of new registrations. The queue is now:
         - every account awaiting approval (status 'pending'), and
         - trainee placeholders that are disabled only because nobody has
           looked at them yet: role student, created by the fee roll, the chat
           backfill or an administrator, and never approved by a person.
       An account a person switched off is managed in Settings → Users. */
    var PLACEHOLDER_SOURCES = { 'fee-system': 1, 'student-sync': 1, 'admin-created': 1, 'student-progress': 1 };
    function reviewQueue(accounts) {
      var list = Array.isArray(accounts) ? accounts : [];
      var queue = list.filter(function (u) {
        if (!u) return false;
        var st = String(u.status || '').trim().toLowerCase();
        if (st === 'pending') return true;
        if (st !== 'disabled') return false;
        if (String(u.role || '').trim().toLowerCase() !== 'student') return false;
        if (!PLACEHOLDER_SOURCES[u.registeredVia]) return false;
        if (u.disabledAt || u.disabledBy) return false;          // switched off by a person
        var by = String(u.approvedBy || '').trim().toLowerCase();
        return !u.approvedAt || by === '' || by === 'system' || by === 'fee-system';
      });
      /* A backfill stub of a trainee who already has an account is nobody to
         review: "Activate" on it handed a second, password-less login to a
         person who has one — or, for a rejected registrant, a way round the
         rejection. It is folded away (backfillStubFolds); until then it is
         not listed. Stubs that cannot be proven duplicates stay, each person
         once. */
      var folded = {};
      backfillStubFolds(list).folds.forEach(function (f) { folded[f.id] = true; });
      var seen = {};
      return queue.filter(function (u) {
        if (folded[u.id]) return false;
        if (!isBackfillStub(u)) return true;
        var key = Core.normName(u.name) + '|' + Core.normCourse(u.programme || '');
        if (!Core.normName(u.name)) return true;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    /* Which trainee record does a sign-in account belong to, when its own link
       (studentDataId) is missing or stale and only the NAME is left to go on?

       Name alone used to decide: the first trainee of that name, in any
       programme. A second John Brown registering for Plumbing was handed the
       Welding John Brown's record — his scores, his attendance, his
       certificate — and his own exam submissions landed on that man's record.
       A name now links only to a namesake whose programme agrees with the
       account's (Core.enrolment.programmesAgree, which still treats 'WELDING L2'
       and 'Welding & Fabrication' as one programme), and only when exactly one
       such namesake exists (or exactly one carries the very same programme).
         { match }            - the record to link to
         { ambiguous: true }  - several agreeing namesakes: an administrator decides
         {}                   - nobody of that name in that programme: a new person */
    function studentLinkFor(account, students) {
      var list = Array.isArray(students) ? students : [];
      if (!account || !account.name) return {};
      var want = Core.normName(account.name);
      if (!want) return {};
      var prog = String(account.programme || '');
      var E = Core.enrolment;
      var agree = list.filter(function (s) {
        if (!s || Core.normName(s.name) !== want) return false;
        if (!prog || !s.course) return true;
        if (E && typeof E.programmesAgree === 'function') { try { return E.programmesAgree(prog, s.course); } catch (e) {} }
        return Core.normCourse(prog) === Core.normCourse(s.course);
      });
      if (agree.length === 1) return { match: agree[0] };
      if (!agree.length) return {};
      if (prog) {
        var exact = agree.filter(function (s) { return s.course && Core.normCourse(s.course) === Core.normCourse(prog); });
        if (exact.length === 1) return { match: exact[0] };
      }
      return { ambiguous: true };
    }

    /* Backfill stubs: the sign-in accounts the fee roll ('fee-system') and the
       chat roster ('student-sync') make for a trainee record that seems to have
       none — disabled, no password, no email, approved by nobody.

       An administrator's PC is cleared at sign-out: the trainee records go,
       the accounts and the fee roll stay. On the next page load the fee-roll
       mirror saw Kemar Williams, Rushane Grant and Kadian Morgan in the fee
       roll and nowhere in the (empty) roll, and enrolled them again under new
       ids; the chat roster then gave the new records accounts of their own.
       Each person now had a second, email-less "Disabled" account; it went
       into the shared accounts list and Verify Users offered to activate it —
       for Rushane, a registration the office had rejected. The roll's own
       clean-up later dropped the stubs on that PC, but without a record of
       having done so, so the accounts list handed them straight back.

       isBackfillStub: provably nothing but a stub — made by a backfill, never
       activated, approved, disabled, edited or signed in to by anybody, with
       no password and no email. Anything a person may have touched is not. */
    var BACKFILL_SOURCES = { 'fee-system': 1, 'student-sync': 1 };
    function isBackfillStub(a) {
      if (!a || typeof a !== 'object') return false;
      if (String(a.role || '').trim().toLowerCase() !== 'student') return false;
      if (!BACKFILL_SOURCES[a.registeredVia]) return false;
      if (String(a.status || '').trim().toLowerCase() !== 'disabled') return false;
      if (hasPassword(a) || a._plaintextPw || a.defaultPassword || a.mustChangePassword) return false;
      if (String(a.email || '').trim()) return false;
      var by = String(a.approvedBy || '').trim().toLowerCase();
      if (by && by !== 'system' && by !== 'fee-system') return false;        // a person decided on it
      if (a.disabledAt || a.disabledBy) return false;                        // a person switched it off
      if (a.updatedAt) return false;                                         // a person edited it (every edit is stamped)
      if (a.verifiedAt || a.lastLoginAt || a.lastLogin) return false;        // somebody signed in with it
      if (a.twoFactorEnabled || a.twoFactorSecret || a.emailOtpLogin) return false;
      return true;
    }
    function programmesAgree(a, b) {
      if (!a || !b) return true;
      var E = Core.enrolment;
      if (E && typeof E.programmesAgree === 'function') { try { return E.programmesAgree(a, b); } catch (e) {} }
      return Core.normCourse(a) === Core.normCourse(b);
    }

    /* Does a trainee already have a sign-in account? candidate:
       { name, programme, email, ids: [record ids it may be linked under] }.
       In order: an account linked to one of those records; the same email;
       the same name in an agreeing programme (the one-person-one-record rule
       the roll itself follows). opts.skip(account) leaves accounts out.
         { match, by: 'link'|'email'|'name' }  - that account
         { ambiguous: true }                   - several: a person decides
         {}                                    - nobody: a new person */
    function accountForTrainee(accounts, cand, opts) {
      opts = opts || {};
      cand = cand || {};
      var list = (Array.isArray(accounts) ? accounts : []).filter(function (a) {
        return a && String(a.role || '').trim().toLowerCase() === 'student' && !(opts.skip && opts.skip(a));
      });
      var ids = (cand.ids || []).filter(function (x) { return x != null && x !== ''; }).map(String);
      if (ids.length) {
        var linked = list.filter(function (a) { return a.studentDataId != null && ids.indexOf(String(a.studentDataId)) !== -1; });
        if (linked.length === 1) return { match: linked[0], by: 'link' };
        if (linked.length > 1) return { ambiguous: true };
      }
      var em = String(cand.email || '').trim().toLowerCase();
      if (em) {
        var byEmail = list.filter(function (a) { return String(a.email || '').trim().toLowerCase() === em; });
        if (byEmail.length === 1) return { match: byEmail[0], by: 'email' };
        if (byEmail.length > 1) return { ambiguous: true };
      }
      var want = Core.normName(cand.name);
      if (!want) return {};
      var same = list.filter(function (a) { return Core.normName(a.name) === want && programmesAgree(a.programme, cand.programme); });
      if (same.length === 1) return { match: same[0], by: 'name' };
      if (!same.length) return {};
      if (cand.programme) {
        var exact = same.filter(function (a) { return a.programme && Core.normCourse(a.programme) === Core.normCourse(cand.programme); });
        if (exact.length === 1) return { match: exact[0], by: 'name' };
      }
      return { ambiguous: true };
    }
    /* "Does this trainee have an account?" for a backfill about to make one:
       a match or several candidates both mean yes — never invent another. */
    function traineeHasAccount(accounts, cand) {
      var r = accountForTrainee(accounts, cand);
      return !!(r.match || r.ambiguous);
    }

    /* Which stubs fold into the account of the same person, and which cannot
       be proven duplicates. A stub folds only into exactly one account that is
       not itself a stub, of the same normalised name, found by its record link
       or by name in an agreeing programme. records (optional): the trainee
       records this device holds — a stub whose own record here belongs to
       somebody of another name is not folded. Returns
         { folds: [{ id, into, by }], unsure: [id] }
       unsure: stubs with a namesake account that could not be told apart
       (several, or a disagreeing record) — left for an administrator. */
    function backfillStubFolds(accounts, records) {
      var list = Array.isArray(accounts) ? accounts : [];
      var recs = {};
      (Array.isArray(records) ? records : []).forEach(function (r) { if (r && r.id != null) recs[String(r.id)] = r; });
      var folds = [], unsure = [];
      list.forEach(function (stub) {
        if (!isBackfillStub(stub)) return;
        var nm = Core.normName(stub.name);
        if (!nm) return;
        var own = stub.studentDataId != null ? recs[String(stub.studentDataId)] : null;
        if (own && own.name && Core.normName(own.name) !== nm) { unsure.push(stub.id); return; }
        var r = accountForTrainee(list, { name: stub.name, programme: stub.programme,
                                          ids: stub.studentDataId != null ? [stub.studentDataId] : [] },
          { skip: function (a) { return a === stub || isBackfillStub(a); } });
        if (r.match && Core.normName(r.match.name) === nm && r.match.id !== stub.id) {
          folds.push({ id: stub.id, into: r.match.id, by: r.by });
        } else if (r.ambiguous || r.match) {
          unsure.push(stub.id);
        }
      });
      return { folds: folds, unsure: unsure };
    }

    /* Should this device ask the shared copy before it turns a sign-in away?

       "Awaiting approval", "not approved", "disabled" and "no password yet"
       are all lifted by an administrator — on the administrator's own PC. A
       device that already holds accounts never syncs before a sign-in, so a
       trainee who registered on a lab PC kept that PC's "pending" copy: after
       she was approved in the office she was still told "awaiting approval"
       on the lab PC, by the email button and by her password alike, until
       somebody happened to press Sync Now. Every refusal of an account this
       device knows is therefore checked once against the shared copy first;
       the merge is newest-edit-wins (cloudCopyWins), so the check can only
       bring a newer decision here, never an older one. With
       opts.ifMissing, an address this device does not know at all is checked
       too (the email button: an account the office created since this device
       last synced is found, instead of a second registration). With
       opts.allowNoPassword (the email button, which needs no password), an
       account with no password yet is not a refusal and is not checked. */
    function recheckBeforeRefusal(account, opts) {
      opts = opts || {};
      if (!account) return !!opts.ifMissing;
      var res = check(account);
      if (res.allowed) return false;
      if (res.reason === 'no-password' && opts.allowNoPassword) return false;
      return true;
    }

    /* What the "awaiting approval" screen says — by what actually happened.

       It used to say the same thing every time: "the system administrators
       will review your account". On a trainee's own phone, and on a lab PC
       whose sign-in had expired, the registration had never left the device,
       so nobody would ever review it. The screen now says what is true:
         'sending'   a registration on its way to the office
         'sent'      it reached the copy the office reviews
         'not-sent'  it did not reach it
         'checking'  a returning person: checking their registration
         'waiting'   a returning person, checked: still awaiting approval
         'unchecked' a returning person this device could not check just now
       It names no place and no service — the office, this device. */
    var APPROVAL_NOTICES = {
      sending: { title: 'Thank You for Registering!', tone: 'info',
        message: 'Sending your registration to the office…' },
      sent: { title: 'Thank You for Registering!', tone: 'good',
        message: 'Your registration has reached the office. The system administrators will review your account, and approval will be given once you are a verified staff member or student.' },
      'not-sent': { title: 'Registration Not Sent Yet', tone: 'warn',
        message: 'Your registration has not reached the office yet, so nobody can approve it. Please tell the office you have registered so they can set up your access.' },
      checking: { title: 'Awaiting Approval', tone: 'info',
        message: 'Checking your registration with the office…' },
      waiting: { title: 'Awaiting Approval', tone: 'info',
        message: 'Your account is awaiting approval. The system administrators will review your account, and you can sign in once it has been approved.' },
      unchecked: { title: 'Awaiting Approval', tone: 'warn',
        message: 'Your account is awaiting approval. This device could not check for a newer answer just now — if the office has already approved you, ask them to press Sync Now on this device, then try again.' }
    };
    function approvalNotice(state) {
      var key = Object.prototype.hasOwnProperty.call(APPROVAL_NOTICES, state) ? state : 'waiting';
      var n = APPROVAL_NOTICES[key];
      return { state: key, title: n.title, message: n.message, tone: n.tone };
    }
    /* Added to a refusal ("not approved", "disabled") this device could not
       check against the shared copy just now. */
    var UNCHECKED_REFUSAL_NOTE = 'This device could not check for a newer answer just now. If this has changed, ask the office to press Sync Now on this device, then try again.';

    /* What a pre-login Sync Now actually achieved.

       It said "Sync complete! You may now log in." whenever nothing threw —
       including when the person had signed in with their OWN email account,
       which cannot see any of the Centre's records: nothing was read, the
       phone held no accounts, and a registration made next never reached
       anyone. Something was read (the accounts ledger, or any backup copy),
       or the Centre's folder answered and is simply empty (a brand-new
       Centre): 'ok'. The folder said "not found" to this sign-in: 'no-access'.
       The sign-in was refused as expired: 'expired'. Anything else: 'failed'.
         info: { ledgerRead, copiesFound, folderAccess: 'yes'|'no'|'expired'|'unknown' } */
    function loginSyncOutcome(info) {
      info = info || {};
      if (info.ledgerRead || (info.copiesFound || 0) > 0) return 'ok';
      if (info.folderAccess === 'yes') return 'ok';
      if (info.folderAccess === 'no') return 'no-access';
      if (info.folderAccess === 'expired') return 'expired';
      return 'failed';
    }
    var NO_ACCESS_SYNC_MESSAGE = 'Could not sync — this sign-in cannot open the Centre’s records. Sign in with the Centre’s account, or ask the office.';

    return {
      idMatches: idMatches, hasPassword: hasPassword, check: check,
      find: find, findAnyRole: findAnyRole, adminLabel: adminLabel,
      usableAdmins: usableAdmins, wouldStrandAdmins: wouldStrandAdmins,
      needsRecoveryAdmin: needsRecoveryAdmin,
      deletionBlocked: deletionBlocked, dropDeleted: dropDeleted,
      isSeededLogin: isSeededLogin, cloudCopyWins: cloudCopyWins,
      isPublishedDefault: isPublishedDefault, publishedDefaultLogin: publishedDefaultLogin, toolDefaultLogin: toolDefaultLogin,
      isPlaceholderRecoveryEmail: isPlaceholderRecoveryEmail,
      registrationRole: registrationRole, isPrivilegedSelfRegistration: isPrivilegedSelfRegistration,
      isFullName: isFullName, officeCreateRefusal: officeCreateRefusal, PHONE_RE: PHONE_RE,
      reviewQueue: reviewQueue, studentLinkFor: studentLinkFor,
      isBackfillStub: isBackfillStub, accountForTrainee: accountForTrainee, traineeHasAccount: traineeHasAccount,
      backfillStubFolds: backfillStubFolds,
      recheckBeforeRefusal: recheckBeforeRefusal, approvalNotice: approvalNotice,
      UNCHECKED_REFUSAL_NOTE: UNCHECKED_REFUSAL_NOTE,
      loginSyncOutcome: loginSyncOutcome, NO_ACCESS_SYNC_MESSAGE: NO_ACCESS_SYNC_MESSAGE
    };

  })();

  /* ==========================================================================
     WHO IS LOOKING AT THIS PAGE

     The record pages (Student Progress, Transcript / Grades, the request
     queue) are embedded in the dashboard, which passed the viewer's role in
     the iframe address — '?role=admin', '?studentId=…' — and the pages
     believed it. Opened on their own, with no address at all, they defaulted
     to the most powerful view there is. So on a lab PC a trainee could type
     …/Transcript-Grades.html and get the grade editor and every trainee's
     date of birth and address, or edit the address to read a classmate's
     grades.

     The viewer now comes from the signed-in session the dashboard writes
     ('voctrain_sessionRole', '_UserId', '_Expiry', '_StudentId', and a
     heartbeat '_SeenAt'), or — when embedded — from the dashboard window
     itself. The address can only NARROW the view (an administrator previewing
     a trainee's page); it can never widen it, and it never picks whose
     records a trainee sees. With no live session the page shows nothing but
     "sign in first". (This is a browser-side check: it stops a person using
     the pages, not one rewriting their code — the broker is the real lock.)
     ========================================================================== */
  Core.sessionAccess = (function () {
    var RANK = { student: 1, instructor: 2, cmc: 2, adminstaff: 3, admin: 4 };
    var FRESH_MS = 10 * 60 * 1000;   // the dashboard refreshes its heartbeat every minute

    function parseUsers(raw) {
      try { var v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }
    function refuse(reason) {
      var msg = reason === 'not-allowed'
        ? 'This page is not part of your account. Open it from the C.E.S.T.I.S dashboard.'
        : 'Please sign in to the C.E.S.T.I.S dashboard first, then open this page from there.';
      return { ok: false, reason: reason, message: msg, role: null, userId: null, studentId: null, account: null };
    }

    /* opts: { get: function(key) -> stored string | null, now: ms,
               allowed: [roles], urlRole, urlStudentId,
               parent: null | { role, userId, studentId }  (the embedding dashboard, if same-origin),
               freshMs } */
    function resolve(opts) {
      opts = opts || {};
      var get = typeof opts.get === 'function' ? opts.get : function () { return null; };
      var now = typeof opts.now === 'number' ? opts.now : Date.now();
      var allowed = Array.isArray(opts.allowed) ? opts.allowed : [];
      var fresh = typeof opts.freshMs === 'number' ? opts.freshMs : FRESH_MS;
      var sessionRole, userId, studentId;
      var p = opts.parent;
      if (p && p.role) {
        sessionRole = String(p.role); userId = p.userId || null; studentId = p.studentId || null;
      } else {
        var expiry = Number(get('voctrain_sessionExpiry')) || 0;
        if (!expiry || now > expiry) return refuse('no-session');
        var seen = Number(get('voctrain_sessionSeenAt')) || 0;
        if (!seen || now - seen > fresh) return refuse('no-session');   // the dashboard was closed
        sessionRole = String(get('voctrain_sessionRole') || '');
        userId = get('voctrain_sessionUserId') || null;
        studentId = get('voctrain_sessionStudentId') || null;
        if (!sessionRole || !userId) return refuse('no-session');
      }
      var account = null;
      if (userId) {
        account = parseUsers(get('voctrain_users')).filter(function (u) { return u && u.id === userId; })[0] || null;
      }
      // Outside the dashboard the stored account must back the stored role up,
      // and still be allowed in: a role key edited by hand, or an account
      // switched off since, opens nothing.
      if (!(p && p.role)) {
        if (!account) return refuse('no-session');
        if (String(account.role || '').trim().toLowerCase() !== sessionRole) return refuse('no-session');
        var st = String(account.status || '').trim().toLowerCase();
        if (st === 'disabled' || st === 'rejected' || st === 'pending') return refuse('no-session');
      }
      if (allowed.indexOf(sessionRole) === -1) return refuse('not-allowed');
      var role = sessionRole;
      var want = String(opts.urlRole || '').trim().toLowerCase();
      if (want && allowed.indexOf(want) !== -1 && (RANK[want] || 0) < (RANK[sessionRole] || 0)) role = want;
      if (role === 'student') {
        if (sessionRole === 'student') studentId = studentId || (account && account.studentDataId) || null;
        else studentId = opts.urlStudentId || null;                      // staff previewing a trainee's page
        if (!studentId) return refuse('no-session');
      } else {
        studentId = null;
      }
      return { ok: true, reason: 'ok', message: '', role: role, sessionRole: sessionRole,
               userId: userId, studentId: studentId, account: account };
    }

    /* Idle lock and expiry, as one decision the dashboard asks every minute.
       Sessions used to last eight hours from sign-in with nothing in between:
       a lab PC left signed in handed the gradebook to the next person for the
       rest of the day, and the forced logout at hour eight landed mid-exam
       with no warning. */
    var IDLE_MS = { student: 60 * 60 * 1000, staff: 20 * 60 * 1000 };
    var WARN_MS = 2 * 60 * 1000;
    function idleLimit(role) { return role === 'student' ? IDLE_MS.student : IDLE_MS.staff; }
    function state(now, lastActivity, expiry, role) {
      if (expiry && now > expiry) return 'expired';
      if (lastActivity && now - lastActivity > idleLimit(role)) return 'lock';
      if (expiry && expiry - now <= WARN_MS) return 'warn';
      return 'ok';
    }
    /* A trainee in the middle of a test is not signed out by the clock. The
       session lasts eight hours from sign-in, so a 90-minute exam started in
       the afternoon was cut off part-way ("Your session has expired") — the
       answers were saved, but she had to sign in again with her clock still
       running. When the session is about to end (within WARN_MS) and she has
       used the page in the last EXAM_ACTIVE_MS, it is carried on by up to
       EXAM_STEP_MS at a time, never beyond the test's own deadline plus
       EXAM_AFTER_MS (to read the result). A PC left idle is not kept signed
       in: without recent use nothing is extended, and the idle lock is
       untouched. Returns the expiry to use (the same one when unchanged). */
    var EXAM_ACTIVE_MS = 10 * 60 * 1000, EXAM_STEP_MS = 15 * 60 * 1000, EXAM_AFTER_MS = 10 * 60 * 1000;
    function examGrace(now, lastActivity, expiry, deadline) {
      if (!expiry || !deadline || !(deadline > now)) return expiry;
      if (expiry - now > WARN_MS) return expiry;
      if (!lastActivity || now - lastActivity > EXAM_ACTIVE_MS) return expiry;
      return Math.max(expiry, Math.min(deadline + EXAM_AFTER_MS, now + EXAM_STEP_MS));
    }
    /* Teaching a live class, or watching a sitting on the Exam Invigilator,
       is using the PC even when nobody touches the keyboard: the instructor
       is talking to the camera, the invigilator is watching the board. Only
       key presses and clicks used to count, so an instructor was locked out
       21 minutes into a lesson, a trainee at minute 61 of one, and an
       invigilator part-way through a sitting. The dashboard asks this every
       minute and, while it says yes, counts the minute as activity.
         info.inLiveRoom        this device is in a running class (small room
                                or Large Class), as host or as a trainee
         info.invigilatorBoard  the board on screen, if any (Core.invigilation
                                .board): it keeps the PC awake while its
                                sitting is open now, or somebody is still
                                writing (time not yet up) after it closed
       A PC with nothing of the kind open still locks exactly as before; a
       board left on a sitting that has not opened yet, or is over with
       everyone finished (or their time up), does not keep it awake. */
    function keepsAwake(info) {
      info = info || {};
      if (info.inLiveRoom) return true;
      var b = info.invigilatorBoard;
      if (!b) return false;
      if (b.status === 'active') return true;
      return (Array.isArray(b.rows) ? b.rows : []).some(function (r) { return r && r.status === 'in-progress' && !r.timeUp; });
    }

    /* The dashboard this page is embedded in, if it is the same site and
       somebody is signed in to it. (A page on another site cannot read it.) */
    function embeddingSession(win) {
      // The dashboard may be one frame further up: Virement and Payroll sit
      // inside the Cashbook, which sits inside the dashboard.
      var w = win;
      for (var depth = 0; depth < 3; depth++) {
        try {
          var p = w && w.parent;
          if (!p || p === w) break;
          if (p.currentRole) {
            return { role: p.currentRole,
                     userId: p.currentLoggedInUser ? p.currentLoggedInUser.id : null,
                     studentId: (p.currentRole === 'student' && p.currentStudent) ? p.currentStudent.id : null };
          }
          w = p;
        } catch (e) { break; }
      }
      return null;
    }
    /* resolve() for the page that is running: its own store, its own address,
       and its embedding dashboard. */
    function forPage(opts) {
      opts = opts || {};
      var win = typeof window !== 'undefined' ? window : null;
      var store = root.CESTISStore || null;
      var qs = null;
      try { qs = new URLSearchParams(win.location.search); } catch (e) { qs = null; }
      return resolve({
        get: function (k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } },
        now: Date.now(),
        allowed: opts.allowed,
        urlRole: qs ? qs.get('role') : '',
        urlStudentId: qs ? qs.get('studentId') : '',
        parent: embeddingSession(win)
      });
    }

    /* The pages with no sign-in of their own that still show the Centre's
       records — School Fee, the finance documents, MegaData's device setup and
       export. They trusted whoever opened them: School Fee signed the visitor
       in as "CESTIS Administrator", and MegaData Admin's "Export local data"
       downloaded every account's password hash for a trainee at a shared PC.
       They now open only for a live dashboard session holding one of
       `allowed` (embedded in the dashboard, or the dashboard signed in on this
       computer), or for another sign-in the page itself accepts (opts.also —
       e.g. the Cashbook a page is embedded in). cb(viewer) runs once: at once
       when the answer is clear, otherwise when this computer's store has
       finished loading (an account kept only in IndexedDB cannot be read
       before then, and a refusal must not come from reading too early). */
    function guard(opts, cb) {
      opts = opts || {};
      var store = root.CESTISStore || null;
      var finished = false;
      function decide() {
        var v = forPage(opts);
        if (!v.ok && typeof opts.also === 'function') {
          var other = false;
          try { other = !!opts.also(); } catch (e) { other = false; }
          if (other) v = { ok: true, reason: 'also', message: '', role: null, sessionRole: null, userId: null, studentId: null, account: null };
        }
        return v;
      }
      function finish(v) { if (finished) return; finished = true; if (typeof cb === 'function') cb(v); }
      var first = decide();
      if (first.ok || !store || typeof store.whenReady !== 'function' || (typeof store.isReady === 'function' && store.isReady())) {
        finish(first);
        return first;
      }
      store.whenReady(function () { finish(decide()); });
      return null;
    }
    /* Cover a refused page with the reason, hiding (not removing) what is
       behind it, so the page's own scripts never trip over a missing element. */
    function lockPage(message) {
      var doc = typeof document !== 'undefined' ? document : null;
      if (!doc) return;
      var put = function () {
        if (!doc.body || doc.getElementById('cestisSessionLock')) return;
        var st = doc.createElement('style');
        st.textContent = 'body > :not(#cestisSessionLock) { display: none !important; }';
        (doc.head || doc.body).appendChild(st);
        var note = doc.createElement('div');
        note.id = 'cestisSessionLock';
        note.setAttribute('role', 'alert');
        note.style.cssText = 'padding:60px 24px;text-align:center;font-family:sans-serif;font-size:16px;line-height:1.5;';
        note.textContent = '🔒 ' + (message || refuse('no-session').message);
        doc.body.insertBefore(note, doc.body.firstChild);
      };
      if (doc.body) put(); else doc.addEventListener('DOMContentLoaded', put);
    }

    /* What the top search box may look through. It searched the whole roll
       for everybody, so a trainee typing two letters got a directory of every
       enrolled person with their student ID and programme. Staff search the
       roll (an instructor only their own programme's trainees); a trainee
       finds only themselves and their own programme's exams; the Board
       searches no trainees at all.
         ctx: { students, exams, me (the trainee record), myCourse,
                courseMatch(a, b) -> bool } */
    function searchPool(role, ctx) {
      ctx = ctx || {};
      var students = Array.isArray(ctx.students) ? ctx.students : [];
      var exams = Array.isArray(ctx.exams) ? ctx.exams : [];
      var match = typeof ctx.courseMatch === 'function' ? ctx.courseMatch
        : function (a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); };
      if (role === 'admin' || role === 'adminstaff') return { students: students, exams: exams };
      if (role === 'instructor') {
        var c = ctx.myCourse;
        if (!c) return { students: [], exams: [] };
        return { students: students.filter(function (s) { return s && match(s.course, c); }),
                 exams: exams.filter(function (e) { return e && match(e.course, c); }) };
      }
      if (role === 'student') {
        var me = ctx.me;
        if (!me) return { students: [], exams: [] };
        return { students: [me], exams: exams.filter(function (e) { return e && match(e.course, me.course); }) };
      }
      return { students: [], exams: [] };
    }

    return { resolve: resolve, state: state, idleLimit: idleLimit, RANK: RANK, FRESH_MS: FRESH_MS, examGrace: examGrace, keepsAwake: keepsAwake,
             embeddingSession: embeddingSession, forPage: forPage, guard: guard, lockPage: lockPage, searchPool: searchPool };
  })();

  /* ==========================================================================
     WORK NOT YET UPLOADED — the dashboard's "pending upload" note
     ('cestisPendingUpload' = "role|when"), and who may clear it.

     A staff sign-out whose final save did not reach the cloud keeps the
     Centre's data on the device: "the next sign-in uploads it". On a shared
     lab PC the next sign-in is usually a TRAINEE. A trainee's backup leaves
     the dated attendance register out, and a non-administrator's leaves out
     what only an administrator publishes (it carries the cloud's copy of
     those forward instead) — yet that session's first successful upload
     deleted the note, so at the trainee's sign-out the device trimmed the
     register to the trainee's own marks. The instructor's marks for the rest
     of the class had never left the PC, and were gone.

     A session may clear the note only when its upload carries everything the
     session that wrote the note had: a trainee never clears a staff
     member's note, an instructor never clears an administrator's. Roles are
     ranked by what their backup carries (Core.sessionAccess.RANK: trainee <
     instructor / board < admin staff < administrator); an unknown signed-in
     role counts as staff. While a staff member's note stands, nothing on
     the device is trimmed or wiped by any session that cannot clear it. */
  Core.pendingUpload = (function () {
    var RANK = Core.sessionAccess.RANK;
    function roleOf(marker) { var s = String(marker || ''); var i = s.indexOf('|'); return i === -1 ? s : s.slice(0, i); }
    function rank(role) { return role ? (RANK[role] || RANK.instructor) : 0; }
    /* The note to store after a save by `role`: written when there is none,
       and raised to `role` when that role's work reaches further. */
    function mark(marker, role, nowIso) {
      if (!role) return marker || null;
      if (!marker || rank(role) > rank(roleOf(marker))) return role + '|' + (nowIso || '');
      return marker;
    }
    /* May a successful upload by a session of `role` clear this note? */
    function covers(role, marker) { return !!role && (!marker || rank(role) >= rank(roleOf(marker))); }
    /* Is the note a staff member's (anything but a trainee's own)? */
    function isStaff(marker) { return !!marker && roleOf(marker) !== 'student'; }
    /* Must the sign-out (or expiry) of a `role` session keep the device's
       data? `safe`: its final save reached the cloud. A trainee's own unsent
       results are kept by the exam outbox, so only a staff note holds back a
       trainee's trim — and holds it back even when the trainee's save
       succeeded, because that save did not carry the staff work. */
    function keepOnSignOut(marker, role, safe) {
      if (!marker || !role) return false;
      if (role === 'student') return isStaff(marker);
      return safe !== true || !covers(role, marker);
    }
    return { roleOf: roleOf, mark: mark, covers: covers, isStaff: isStaff, keepOnSignOut: keepOnSignOut };
  })();

  /* ==========================================================================
     CLOUD MERGE RULES

     The main autosave/merge pair converges properly: it merges student records
     on lastModified, keeps the newest account edit, and covers every dataset the
     save writes. Three narrower sync paths did not follow those rules, and each
     one could undo work that had already been done:

       - the pre-login account fetch REPLACED each student record with the cloud
         copy outright ("cloud is authoritative"), discarding local edits that
         had not been uploaded yet;
       - both that path and the trainee's own "Refresh from Cloud" REPLACED the
         certificate-download approval with whatever the cloud held, so a stale
         "not approved yet" row switched a granted approval back off and the
         trainee's Download button went dark again;
       - every merge re-added training centres that had been deleted, because
         deletion left no record for the merges to honour.

     These are the shared rules, kept pure so they can be tested.
     ========================================================================== */
  Core.cloudMerge = (function () {

    /* Which of two copies of one certificate-download approval to keep.
       Approved always beats not-approved (an approval is a decision somebody
       made; its absence is just the default), then the most recent wins. */
    function bestApproval(a, b) {
      if (!a) return b || null;
      if (!b) return a;
      // A stamped revocation is a decision too, and the later decision wins;
      // downloads made on either device are kept (Core.certs.mergeApprovals).
      if (Core.certs) return Core.certs.mergeApprovals(a, b);
      return Core.approvalScore(b) > Core.approvalScore(a) ? b : a;
    }

    /* Merge one cloud student record into the local list, in place.
       Returns 'added' | 'merged' | 'skipped' so callers can report what moved. */
    function applyStudent(localList, cloudStudent, isDeleted) {
      if (!Array.isArray(localList) || !cloudStudent) return 'skipped';
      if (typeof isDeleted === 'function' && isDeleted(cloudStudent)) return 'skipped';
      var idx = -1;
      for (var i = 0; i < localList.length; i++) {
        if (localList[i] && localList[i].id === cloudStudent.id) { idx = i; break; }
      }
      if (idx === -1) { localList.push(cloudStudent); return 'added'; }
      // mergeStudentRecords keeps the newer lastModified and fills blanks from
      // the other copy, so neither side loses a field the other one has.
      localList[idx] = Core.mergeStudentRecords(localList[idx], cloudStudent);
      return 'merged';
    }

    /* Merge one cloud approval into the local list, in place. */
    function applyApproval(localList, cloudApproval) {
      if (!Array.isArray(localList) || !cloudApproval || !cloudApproval.studentId) return 'skipped';
      for (var i = 0; i < localList.length; i++) {
        if (localList[i] && localList[i].studentId === cloudApproval.studentId) {
          localList[i] = bestApproval(localList[i], cloudApproval);
          return 'merged';
        }
      }
      localList.push(cloudApproval);
      return 'added';
    }

    /* How a training centre is described — whoever wrote last is as good as
       any other, so a non-empty cloud value is taken. */
    var CENTRE_IDENTITY = ['name', 'desc', 'icon', 'color'];

    /* The course DURATION. This decides whether the register is open and
       whether a trainee's course has ended, so it is merged on its own terms:
       the copy edited most recently wins, by the stamp written when an
       administrator saved it. A device that was never given the dates cannot
       push its own over them. */
    var CENTRE_DURATION = ['startDate', 'endDate', 'level', 'project'];

    function durationStamp(centre) {
      return (centre && Date.parse(centre.durationModified || '')) || 0;
    }

    /* Should the cloud copy's duration replace this device's?
         - a newer stamp always wins;
         - with no stamps on either side (data written before durations were
           stamped) the cloud copy still wins, as it always did, so an
           administrator's dates reach the other devices;
         - a local copy that has been stamped is never overwritten by an
           unstamped one — that is a device that has not been told yet. */
    function durationWins(local, cloud) {
      var lc = durationStamp(local), cc = durationStamp(cloud);
      if (cc && lc) return cc > lc;
      if (lc) return false;
      return true;
    }

    /* Merge cloud training centres into the local list, in place. A centre the
       Centre has deleted stays deleted — without this every sync brought it
       back, along with its chat room and its place in the course lists.

       Course durations are merged too. The Drive merges used to copy only the
       name, description, icon and colour, so an end date set by the
       administrator never reached anybody else: every device kept its own idea
       of when a course finished, which is why the same trainee showed a
       different status on every machine and why courses that had ended left
       their trainees sitting in Testing. */
    function applySkillAreas(localList, cloudList, isDeleted) {
      var out = { added: 0, updated: 0, skipped: 0 };
      if (!Array.isArray(localList) || !Array.isArray(cloudList)) return out;
      cloudList.forEach(function (sa) {
        if (!sa || sa.id == null) return;
        if (typeof isDeleted === 'function' && isDeleted(sa.id)) { out.skipped++; return; }
        var local = null;
        for (var i = 0; i < localList.length; i++) {
          if (localList[i] && localList[i].id === sa.id) { local = localList[i]; break; }
        }
        if (!local) { localList.push(sa); out.added++; return; }

        CENTRE_IDENTITY.forEach(function (f) {
          if (sa[f] !== undefined && sa[f] !== null && sa[f] !== '' && sa[f] !== local[f]) {
            local[f] = sa[f];
            out.updated++;
          }
        });

        if (durationWins(local, sa)) {
          CENTRE_DURATION.forEach(function (f) {
            if (sa[f] !== undefined && sa[f] !== null && sa[f] !== '' && sa[f] !== local[f]) {
              local[f] = sa[f];
              out.updated++;
            }
          });
          if (sa.durationModified && sa.durationModified !== local.durationModified) {
            local.durationModified = sa.durationModified;
          }
        }

        // A reopen window granted to an instructor is added, never removed:
        // they expire by their own clock, so the union cannot outlast them.
        // The exception is a REVOCATION (permissionsRevokedAtMs, the later of
        // the two copies standing): a grant made before it is dropped on both
        // sides. Without it, "Revoke" emptied the list here and the next sync
        // refilled it from any copy still holding the grant.
        var revokedAt = Math.max(+local.permissionsRevokedAtMs || 0, +sa.permissionsRevokedAtMs || 0);
        if (revokedAt > (+local.permissionsRevokedAtMs || 0)) { local.permissionsRevokedAtMs = revokedAt; out.updated++; }
        if (revokedAt && Array.isArray(local.instructorPermissions)) {
          var keptGrants = local.instructorPermissions.filter(function (p) { return !p || grantedAtMs(p) > revokedAt; });
          if (keptGrants.length !== local.instructorPermissions.length) { local.instructorPermissions = keptGrants; out.updated++; }
        }
        if (Array.isArray(sa.instructorPermissions) && sa.instructorPermissions.length) {
          if (!Array.isArray(local.instructorPermissions)) local.instructorPermissions = [];
          sa.instructorPermissions.forEach(function (p) {
            if (!p) return;
            if (revokedAt && grantedAtMs(p) <= revokedAt) return;
            var known = local.instructorPermissions.some(function (lp) {
              return lp && lp.instructor === p.instructor && lp.expiresAtMs === p.expiresAtMs;
            });
            if (!known) { local.instructorPermissions.push(p); out.updated++; }
          });
        }
      });
      return out;
    }
    /* When a reopen window was granted. Grants from before grantedAtMs was
       recorded are taken as granted one day before they expire (the longest
       window the page offers). */
    function grantedAtMs(p) {
      if (p && +p.grantedAtMs) return +p.grantedAtMs;
      return (+(p && p.expiresAtMs) || 0) - 24 * 60 * 60 * 1000;
    }

    /* Order the copies of a backup so the newest applies LAST — and so wins
       every tie the record-level rules cannot decide (two unstamped copies of
       the same account, say). Every Drive folder holds a copy of the same
       backup; a copy a failed write left behind is older than the rest, and
       merging the folders in list order let such a copy overrule the current
       one simply by coming later in the list. Copies whose age is unknown go
       first: they are the ones a known-newer copy should overrule. */
    function oldestFirst(entries, stampOf) {
      var get = stampOf || function (e) { return e && e.modifiedTime; };
      return (Array.isArray(entries) ? entries.slice() : []).map(function (e, i) {
        var t = Date.parse(get(e) || '');
        return { e: e, i: i, t: isNaN(t) ? 0 : t };
      }).sort(function (a, b) { return (a.t - b.t) || (a.i - b.i); }).map(function (x) { return x.e; });
    }

    return { bestApproval: bestApproval, applyStudent: applyStudent,
      applyApproval: applyApproval, applySkillAreas: applySkillAreas,
      oldestFirst: oldestFirst };
  })();

  /* ==========================================================================
     RESTORING A BACKUP FILE (Settings → Import Backup)

     The import wrote every key in the file over what the device held. Restoring
     last month's export to recover one thing therefore put every account back
     on last month's password and status, brought back every account and
     trainee deleted since (the deletion lists were replaced by older, shorter
     ones), and threw away everything entered since. A backup is now MERGED in
     by the same rules a sync follows:
       - deletion lists are unioned — a backup never un-deletes anything;
       - a list of records is merged record by record: one the device lacks is
         added, one the device holds is replaced only by a strictly newer copy
         (updatedAt), otherwise only its blanks are filled;
       - a map gains the entries it lacks; anything else the device already
         holds is kept;
       - nothing empty is ever written over something that is not.
     Returns the value to store for the key, or null to leave it alone. Order
     the keys with restoreOrder() so the deletions land first.

     RECORDS INSIDE ONE STORED VALUE. "A map gains the entries it lacks" was
     the whole rule for any stored object, and the import said "Backup
     merged" — but a Cashbook quarter is one object holding every cheque, and
     the payroll one object holding every employee and payroll run. A quarter
     the device had re-entered one cheque into kept that one and none of the
     backup's forty (its opening balance stayed 0 while the backup's date for
     it was copied); the payroll restored nothing, not even over the page's
     empty start-up skeleton; and old weekly attendance rows, which carry no
     `id`, were skipped as records with no identity. Each key is now merged
     by the rule its own pages use:
       - a Cashbook quarter (cestis_quarter_*) by Core.cashbook.mergeQuarter,
         its budget (cestis_budget_<FY>_Q<n>) by mergeBudget;
       - the payroll by the Payslip page's rule (Core.payroll), and an empty
         start-up payroll simply takes the backup;
       - every collection the sync merges record by record (the roll, results,
         the attendance register and weekly rows, exams, assignments, the
         virement register, ...) by that same rule (Core.pageCloud
         .mergeRecordValue), honouring the deletions this device holds;
       - any other list by id, and a record with no id is added unless this
         device already holds exactly that record.
     What still cannot be merged — a setting this device holds with another
     value, an entry inside some other stored object, a stored value that
     cannot be read — is kept as it is here and REPORTED (mergeKey().kept),
     so the import says what it did not restore instead of "merged". */
  Core.backupRestore = (function () {
    function parse(raw) { if (raw == null || raw === '') return null; try { return JSON.parse(raw); } catch (e) { return undefined; } }
    function isEmpty(v) {
      return v == null || v === '' || (Array.isArray(v) && !v.length) ||
        (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    }
    function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function copy(v) { return JSON.parse(JSON.stringify(v)); }
    function byId(r) { return r && r.id != null ? String(r.id) : undefined; }
    var SYNC_TOMBS = 'voctrain_syncTombstones';
    // Deletions are restored first and then honoured by every record merge.
    function isDeletionKey(k) { return Core.isTombstoneKey(k) || k === SYNC_TOMBS; }
    var DELETION_SOURCES = [SYNC_TOMBS, 'voctrain_deletedStudentIds', 'voctrain_deletedUserIds', 'voctrain_deletedCentreIds',
      'voctrain_deletedStudentAt', 'cesti_virement_deleted_ids'];
    function deletionsHere(read) {
      var data = {};
      if (typeof read === 'function') {
        DELETION_SOURCES.forEach(function (k) {
          var v = null;
          try { v = read(k); } catch (e) { v = null; }
          if (v != null && v !== '') data[k] = v;
        });
      }
      return Core.pageCloud.tombContext(data, {});
    }
    // A list: by id (Core.sync's rule), then the records with no id that
    // this device does not already hold exactly.
    function mergeArray(stored, incoming) {
      var res = Core.sync.mergeList(stored, incoming, byId, {});
      var changed = !!(res.added || res.updated || res.removed);
      var have = {};
      stored.forEach(function (r) { if (r && typeof r === 'object') have[JSON.stringify(r)] = 1; });
      incoming.forEach(function (r) {
        if (!r || typeof r !== 'object' || byId(r) !== undefined) return;
        var s = JSON.stringify(r);
        if (have[s]) return;
        have[s] = 1; stored.push(copy(r)); changed = true;
      });
      return changed;
    }
    /* opts.read(key) -> this device's stored value of another key (the
       deletion lists). Returns { value: string to store | null, kept: true
       when the backup holds something this merge left out }. */
    function mergeKey(key, storedRaw, incoming, opts) {
      opts = opts || {};
      var res = { value: null, kept: false };
      if (incoming === undefined || incoming === null) return res;
      if (Core.isTombstoneKey(key)) { res.value = Core.unionTombstoneValues(storedRaw, JSON.stringify(incoming)); return res; }
      var stored = parse(storedRaw);
      // Unreadable here: never mistaken for empty, never overwritten.
      if (stored === undefined) { res.kept = !isEmpty(incoming); return res; }
      if (isEmpty(incoming)) return res;                          // nothing empty is written over anything
      if (isEmpty(stored)) { res.value = JSON.stringify(incoming); return res; }
      var inc = copy(incoming);
      var done = function (changed) { if (changed) res.value = JSON.stringify(stored); return res; };
      var quarter = Core.cashbook.parseQuarterKey(key);
      if (quarter && isPlain(stored) && isPlain(inc)) {
        return done(String(key).indexOf('cestis_budget_') === 0 ? Core.cashbook.mergeBudget(stored, inc).changed
          : Core.cashbook.mergeQuarter(stored, inc, quarter.fy, quarter.q).changed);
      }
      if (key === 'cestisPayroll' && isPlain(stored) && isPlain(inc)) {
        if (Core.payroll.isSkeleton(stored)) { res.value = JSON.stringify(inc); return res; }
        var was = JSON.stringify(stored);
        Core.payroll.mergeData(stored, inc);
        return done(JSON.stringify(stored) !== was);
      }
      if (Core.pageCloud.isRecordKey(key)) {
        var merged = Core.pageCloud.mergeRecordValue(key, storedRaw, JSON.stringify(inc), false, deletionsHere(opts.read));
        if (merged != null) { if (merged !== storedRaw) res.value = merged; return res; }
      }
      if (Array.isArray(stored) && Array.isArray(inc)) {
        var grew = mergeArray(stored, inc);
        // A plain value (not a record) missing here cannot be told from one
        // removed here on purpose: reported, not added.
        res.kept = inc.some(function (v) { return (v === null || typeof v !== 'object') && stored.indexOf(v) === -1; });
        return done(grew);
      }
      if (isPlain(stored) && isPlain(inc)) {
        var added = 0;
        // A part this device holds as an EMPTY list or object is a blank, and
        // the backup fills it, as it fills an empty key. A page's start-up
        // shell is exactly that: the staff appraisals write
        // { cycles: {}, extraStaff: [], flags: {…} } when the administrator
        // first signs in on a new PC, and restoring the Centre's backup there
        // then kept the empty shell and left every appraisal out.
        var hollow = function (v) { return (Array.isArray(v) && !v.length) || (isPlain(v) && !Object.keys(v).length); };
        Object.keys(inc).forEach(function (k) {
          if (!(k in stored)) { if (inc[k] !== undefined) { stored[k] = inc[k]; added++; } }
          else if (hollow(stored[k]) && !isEmpty(inc[k])) { stored[k] = inc[k]; added++; }
          else if (JSON.stringify(stored[k]) !== JSON.stringify(inc[k])) res.kept = true;
        });
        return done(added > 0);
      }
      res.kept = JSON.stringify(stored) !== JSON.stringify(inc);   // a value the device already holds stands
      return res;
    }
    function mergeValue(key, storedRaw, incoming, opts) { return mergeKey(key, storedRaw, incoming, opts).value; }
    function restoreOrder(keys) {
      var list = Array.isArray(keys) ? keys.slice() : [];
      return list.filter(isDeletionKey).concat(list.filter(function (k) { return !isDeletionKey(k); }));
    }
    return { mergeKey: mergeKey, mergeValue: mergeValue, restoreOrder: restoreOrder };
  })();

  /* ==========================================================================
     PER-PAGE CLOUD BACKUP — merge rules

     Most pages here own a slice of the data and had no cloud path of their own:
     the finance documents, the vouchers, the transcript pages and the chat all
     reached Google Drive only if the LMS dashboard happened to be open and
     connected, because its master snapshot sweeps every storage key. Work done
     with the dashboard closed stayed on one machine.

     Each page now writes its own backup file. Two devices editing the same page
     must converge without either one's work disappearing, so every key carries
     the moment it was last written and the newer write wins — the same rule the
     student and account merges already follow. A key only one side has is
     always taken; that is new work, not a deletion.
     ========================================================================== */
  /* ==========================================================================
     RECORD SYNC — newest edit wins, deletions travel, on EVERY collection

     WHY THIS EXISTS
     ---------------
     Most collections merged add-only: a record the cloud had and this device
     did not was added, and that was all. An exam edited on one machine, an
     announcement corrected, a grade changed, a notification dismissed, a
     resource removed — none of it reached any other device, and a deleted
     record came straight back on the next sync. Every device held its own
     version of the Centre's data and called it synced.

     Two things make convergence possible, and both are decided here so every
     collection follows the same rule:

       - a record carries updatedAt, the moment it last changed. Records are
         not stamped by the code that edits them (there are hundreds of edit
         sites); they are stamped on SAVE, by comparing each record's content
         with a fingerprint taken the last time it was saved or loaded. A
         record whose content changed but whose stamp did not was edited
         here — stamp it now. A record whose stamp changed too arrived from
         elsewhere with its own stamp — keep it.
       - a deletion leaves a tombstone: the record's key and the moment it
         was removed. Tombstones travel with the backup, and a record is
         dropped on every device unless it was edited AFTER it was deleted,
         in which case the edit wins and the record lives.

     The merge: the cloud copy replaces the local one only when it is
     strictly newer; a strictly newer local copy is kept; two copies with no
     stamp — records from before this existed — keep the local one and fill
     its blanks from the cloud, exactly as the old add-only merges did, so a
     legacy deployment settles the way it always has.
     ========================================================================== */
  Core.sync = (function () {
    var STAMP = 'updatedAt';
    var IGNORE = { updatedAt: 1, _plaintextPw: 1 };

    function stampOf(r) { var t = Date.parse((r && r[STAMP]) || ''); return isNaN(t) ? 0 : t; }
    function isBlank(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }
    function isPlain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

    /* CLOCKS. "Newest wins" is only as good as the clocks it compares, and
       every device stamps with its own. Two rules keep one wrong clock from
       doing damage:
         - an edit never goes BACKWARDS: a record edited here is stamped one
           millisecond after the stamp it already carries when this device's
           clock reads earlier than that (laterStamp). A device whose clock is
           slow used to stamp its correction EARLIER than the record it
           corrected, so the correction lost every merge and was reverted
           everywhere — its own copy included.
         - a stamp more than a day ahead of the receiving device's clock is
           not believed (trusted): such a copy is merged as an undated one —
           it fills blanks and adds what is missing, but cannot overwrite a
           dated edit or delete anything. A device whose clock had jumped a
           year ahead used to win every merge for a year. Nothing is lost:
           the record is kept, and the page warns that a clock is wrong
           (clockSkew).
         - but an edit made HERE on a clock that was days fast is this
           device's own work, not a stranger's claim. It used to be merged
           away twice: other devices treated it as undated, and once this
           clock was put right its own copy lost to their older one too — the
           correction was gone everywhere. A copy this device holds whose
           stamp is more than a day ahead of the correct time is now re-dated
           to the correct time (restampOwn), on save and on every merge, so
           it competes as an edit made now and travels.
       "The correct time" is this device's clock corrected by the offset last
       measured against a server (setClockOffset: Google's Date header online,
       the Centre server's clock on its network) — so a device whose clock is
       still wrong stamps, and re-dates, by the server's time. */
    var MAX_AHEAD_MS = 24 * 60 * 60 * 1000;
    var SKEW_WARN_MS = 5 * 60 * 1000;
    var clockOffsetMs = 0;
    /* ms to add to this device's clock to read the correct time (the
       negative of clockSkew). 0 when unknown or when the clock is right. */
    function setClockOffset(ms) { clockOffsetMs = (typeof ms === 'number' && isFinite(ms)) ? Math.round(ms) : 0; }
    function clockOffset() { return clockOffsetMs; }
    function now() { return Date.now() + clockOffsetMs; }
    function nowIso() { return new Date(now()).toISOString(); }
    function trusted(t, nowMs) {
      if (!t) return 0;
      var at = (typeof nowMs === 'number' && !isNaN(nowMs)) ? nowMs : now();
      return t > at + MAX_AHEAD_MS ? 0 : t;
    }
    /* Re-date THIS device's own copy where a field is more than a day ahead
       of the correct time (see above). Returns whether anything changed. */
    function restampOwn(r, fields, nowMs) {
      if (!r || typeof r !== 'object') return false;
      var at = (typeof nowMs === 'number' && !isNaN(nowMs)) ? nowMs : now();
      var changed = false;
      (fields || [STAMP]).forEach(function (f) {
        var t = Date.parse(r[f] || '');
        if (!isNaN(t) && t > at + MAX_AHEAD_MS) { r[f] = new Date(at).toISOString(); changed = true; }
      });
      return changed;
    }
    function laterStamp(nowIso, prevIso, nowMs) {
      var p = Date.parse(prevIso || ''), n = Date.parse(nowIso || '');
      if (isNaN(p) || isNaN(n) || n > p) return nowIso;
      if (!trusted(p, (typeof nowMs === 'number') ? nowMs : n)) return nowIso;   // never chase a wrong clock
      return new Date(p + 1).toISOString();
    }
    /* How far this device's clock is from a server's (a Drive response's
       Date header, the Centre server's /health time), in ms; positive when
       this device is AHEAD. Returns null when the server time is unreadable.
       `sentMs`/`receivedMs` bracket the request, so its travel time is not
       counted as skew. */
    function clockSkew(serverTime, sentMs, receivedMs) {
      var s = typeof serverTime === 'number' ? serverTime : Date.parse(serverTime || '');
      if (!s || isNaN(s)) return null;
      var mid = (typeof sentMs === 'number' && typeof receivedMs === 'number') ? (sentMs + receivedMs) / 2
        : (typeof receivedMs === 'number' ? receivedMs : Date.now());
      var off = mid - s;
      // HTTP dates have one-second resolution; never call that skew.
      return Math.abs(off) < 2000 ? 0 : Math.round(off);
    }
    function clockLooksWrong(skewMs) { return typeof skewMs === 'number' && Math.abs(skewMs) > SKEW_WARN_MS; }

    /* The content of a record, stamp excluded — what "changed" means. */
    function fingerprint(r, ignoreKeys) {
      if (!r || typeof r !== 'object') return Core.hashString(String(r));
      var c = {};
      Object.keys(r).sort().forEach(function (k) {
        if (IGNORE[k] || (ignoreKeys && ignoreKeys[k])) return;
        c[k] = r[k];
      });
      return Core.hashString(JSON.stringify(c));
    }

    /* Stamp every record whose content changed here since the index was
       taken; return the new index. An index of null means "no baseline yet":
       nothing is stamped, the baseline is simply taken. A record not in the
       index is new here and is stamped unless it already carries a stamp. */
    function stampChanges(records, keyOf, index, now, ignoreKeys) {
      var next = {};
      var list = Array.isArray(records) ? records : Object.keys(records || {}).map(function (k) { return records[k]; });
      var keys = Array.isArray(records) ? null : Object.keys(records || {});
      var nowMs = Date.parse(now || '');
      list.forEach(function (r, i) {
        if (!r || typeof r !== 'object') return;
        var k = keys ? keys[i] : keyOf(r);
        if (k === undefined || k === null) return;
        var fp = fingerprint(r, ignoreKeys);
        if (index) {
          var prev = index[k];
          if (!prev) { if (!r[STAMP]) r[STAMP] = now; }
          else if (prev.fp !== fp && (r[STAMP] || '') === (prev.stamp || '')) { r[STAMP] = laterStamp(now, r[STAMP]); }
          // A copy dated days ahead of now (a clock that was wrong when it
          // was edited) is re-dated now, so it can travel (restampOwn).
          if (!isNaN(nowMs)) restampOwn(r, [STAMP], nowMs);
        }
        next[k] = { fp: fp, stamp: r[STAMP] || '' };
      });
      return next;
    }

    /* Keys in the index that the list no longer holds. A blanked list is
       never a deletion (emptiness is never an edit), and neither is a sweep
       that removes more than a quarter of a collection at once — that is
       what a bug looks like, not what a person does; a deliberate bulk
       removal is written down by the code that performs it. */
    function detectRemovals(records, keyOf, index) {
      if (!index) return [];
      var have = {};
      if (Array.isArray(records)) records.forEach(function (r) { if (r && typeof r === 'object') have[keyOf(r)] = 1; });
      else Object.keys(records || {}).forEach(function (k) { have[k] = 1; });
      var was = Object.keys(index);
      var gone = was.filter(function (k) { return !have[k]; });
      if (!gone.length) return [];
      if (!Object.keys(have).length) return [];
      if (gone.length > 5 && gone.length > was.length / 4) return [];
      return gone;
    }

    /* Merge one collection's tombstones with another's: the later removal
       of each key stands. Mutates and returns `into`. */
    function mergeTombstones(into, from) {
      into = into || {};
      Object.keys(from || {}).forEach(function (k) {
        var t = Date.parse(from[k] || '') || 0, have = Date.parse(into[k] || '') || 0;
        if (t > have) into[k] = from[k];
      });
      return into;
    }
    /* Was this record deleted after its last edit? A deletion dated more than
       a day in the future (a wrong clock) is not acted on — keeping a record
       can be undone, losing it cannot — and neither is an edit so dated
       allowed to outlive a real deletion. */
    function deletedAfter(tombs, k, r, nowMs) {
      var t = tombs && tombs[k] ? (Date.parse(tombs[k]) || 0) : 0;
      t = trusted(t, nowMs);
      return t > 0 && t >= trusted(stampOf(r), nowMs);
    }

    /* Replace the local record's content with the cloud copy's, keeping the
       fields listed in keep (device-only data such as certificate images). */
    function takeOver(local, cloud, keep) {
      Object.keys(local).forEach(function (k) { if (!(keep && keep[k]) && !(k in cloud)) delete local[k]; });
      Object.keys(cloud).forEach(function (k) { if (!(keep && keep[k]) || isBlank(local[k])) local[k] = cloud[k]; });
    }
    /* Two copies neither of which says when it changed: keep ours, fill its
       blanks from theirs — one level into plain objects too (grades). */
    function fillBlanks(local, cloud) {
      var changed = false;
      Object.keys(cloud).forEach(function (k) {
        if (IGNORE[k]) return;
        if (isBlank(local[k]) && !isBlank(cloud[k])) { local[k] = cloud[k]; changed = true; }
        else if (isPlain(local[k]) && isPlain(cloud[k])) {
          Object.keys(cloud[k]).forEach(function (j) {
            if (local[k][j] === undefined && cloud[k][j] !== undefined) { local[k][j] = cloud[k][j]; changed = true; }
          });
        }
      });
      return changed;
    }

    /* MAPS INSIDE A RECORD that several people write at once.

       A whole record wins or loses as one: the newer copy replaces the other.
       That is wrong for a map whose entries belong to different people — an
       assignment's grades {trainee: score}, a notice's readBy {user: when}.
       Two instructors grading two different trainees on the same assignment
       each produced a newer copy holding only their own grade, and whichever
       synced last erased the other's grade everywhere. These maps are merged
       entry by entry instead:
         perEntry:    { field: stampField } — field is {key: value} and
                      stampField says when each entry was written: a map
                      {key: ISO}, or 'meta.prop' for {key: {prop: ISO}}; the
                      newer entry wins, an entry only one side has is kept,
                      and with no stamps the copy that won the record decides
                      (as before).
         unionStamps: [field] — field is {key: ISO} (every key either side
                      has is kept, with the later time) or a list (every
                      element either side has is kept, once). */
    function copyOf(v) { return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v; }
    /* Where an entry's own time is kept: 'gradedAt' is a map { key: ISO } on
       the record; 'gradeMeta.gradedAt' is a map { key: { gradedAt: ISO, ... } }. */
    function stampSpec(sf) {
      var dot = String(sf).indexOf('.');
      return dot === -1 ? { field: sf, prop: null } : { field: sf.slice(0, dot), prop: sf.slice(dot + 1) };
    }
    function entryStamp(rec, spec, k) {
      var m = rec[spec.field];
      if (!isPlain(m) || m[k] == null) return 0;
      var v = spec.prop ? (isPlain(m[k]) ? m[k][spec.prop] : null) : m[k];
      var t = Date.parse(v || '');
      return isNaN(t) ? 0 : t;
    }
    function snapshotMaps(r, opts) {
      var s = {};
      Object.keys(opts.perEntry || {}).forEach(function (f) {
        var sp = stampSpec(opts.perEntry[f]);
        s[f] = copyOf(r[f]);
        s[sp.field] = copyOf(r[sp.field]);
      });
      (opts.unionStamps || []).forEach(function (f) { s[f] = copyOf(r[f]); });
      return s;
    }
    function reconcileMaps(target, mine, theirs, opts, theirsWon, nowMs) {
      var changed = false;
      var at = (typeof nowMs === 'number' && !isNaN(nowMs)) ? nowMs : now();
      Object.keys(opts.perEntry || {}).forEach(function (f) {
        var sp = stampSpec(opts.perEntry[f]);
        var A = mine[f], B = theirs[f];
        if (!isPlain(A) && !isPlain(B)) return;
        A = isPlain(A) ? A : {}; B = isPlain(B) ? B : {};
        var AS = isPlain(mine[sp.field]) ? mine[sp.field] : {}, BS = isPlain(theirs[sp.field]) ? theirs[sp.field] : {};
        var val = {}, st = {};
        Object.keys(A).concat(Object.keys(B)).forEach(function (k) {
          if (k in val) return;
          var inA = A[k] !== undefined, inB = B[k] !== undefined;
          // This device's own entry dated days ahead (a wrong clock) counts
          // as written now, and is re-dated so (restampOwn) — it is never
          // simply outvoted by an older entry.
          var ra = entryStamp(mine, sp, k), ownFuture = ra > 0 && !trusted(ra, at);
          var ta = ownFuture ? at : trusted(ra, at), tb = trusted(entryStamp(theirs, sp, k), at);
          var useB;
          if (!inA) useB = true;
          else if (!inB) useB = false;
          else if (ta !== tb) useB = tb > ta;
          else useB = theirsWon;
          val[k] = useB ? B[k] : A[k];
          var stamp = useB ? (BS[k] !== undefined ? BS[k] : AS[k]) : (AS[k] !== undefined ? AS[k] : BS[k]);
          if (stamp !== undefined) {
            st[k] = copyOf(stamp);
            if (!useB && ownFuture) {
              if (sp.prop && isPlain(st[k])) st[k][sp.prop] = new Date(at).toISOString();
              else if (!sp.prop) st[k] = new Date(at).toISOString();
            }
          }
        });
        // Entries of the stamp map with no value beside them are kept as well.
        Object.keys(AS).concat(Object.keys(BS)).forEach(function (k) {
          if (st[k] === undefined) st[k] = copyOf(BS[k] !== undefined && entryStamp(theirs, sp, k) >= entryStamp(mine, sp, k) ? BS[k] : AS[k]);
        });
        if (JSON.stringify(target[f]) !== JSON.stringify(val)) { target[f] = val; changed = true; }
        if (Object.keys(st).length && JSON.stringify(target[sp.field]) !== JSON.stringify(st)) { target[sp.field] = st; changed = true; }
      });
      (opts.unionStamps || []).forEach(function (f) {
        var A = mine[f], B = theirs[f];
        if (Array.isArray(A) || Array.isArray(B)) {
          // A list (who has read it, a grade history): everything either side
          // holds, once, in this device's order first.
          var seen = {}, list = [];
          [A, B].forEach(function (arr) {
            (Array.isArray(arr) ? arr : []).forEach(function (x) {
              var key = JSON.stringify(x);
              if (seen[key]) return;
              seen[key] = true; list.push(copyOf(x));
            });
          });
          if (JSON.stringify(target[f]) !== JSON.stringify(list)) { target[f] = list; changed = true; }
          return;
        }
        if (!isPlain(A) && !isPlain(B)) return;
        var u = {};
        [A, B].forEach(function (m) {
          if (!isPlain(m)) return;
          Object.keys(m).forEach(function (k) {
            if (u[k] === undefined || (Date.parse(m[k]) || 0) > (Date.parse(u[k]) || 0)) u[k] = m[k];
          });
        });
        if (JSON.stringify(target[f]) !== JSON.stringify(u)) { target[f] = u; changed = true; }
      });
      return changed;
    }

    /* Merge a cloud list into a local list IN PLACE. opts: { tombs, keep,
       accept, perEntry, unionStamps, nowMs }. Returns { added, updated, removed }. */
    function mergeList(local, cloud, keyOf, opts) {
      opts = opts || {};
      var out = { added: 0, updated: 0, removed: 0 };
      if (!Array.isArray(local)) return out;
      var tombs = opts.tombs || {};
      var nowMs = opts.nowMs;
      var maps = !!(opts.perEntry || opts.unionStamps);
      // Deletions first: a record removed elsewhere after its last edit here.
      for (var i = local.length - 1; i >= 0; i--) {
        var r = local[i];
        if (r && typeof r === 'object' && deletedAfter(tombs, keyOf(r), r, nowMs)) { local.splice(i, 1); out.removed++; }
      }
      var byKey = {};
      local.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        byKey[keyOf(r)] = r;
        // This device's own copy dated days ahead: re-dated now (restampOwn),
        // so it is not outvoted by an older copy and is believed elsewhere.
        if (restampOwn(r, [STAMP], nowMs)) out.updated++;
      });
      (Array.isArray(cloud) ? cloud : []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        if (opts.accept && !opts.accept(c)) return;
        var k = keyOf(c);
        if (k === undefined || k === null) return;
        if (deletedAfter(tombs, k, c, nowMs)) return;
        var l = byKey[k];
        if (!l) {
          var fresh = {}; Object.keys(c).forEach(function (f) { if (!IGNORE[f] || f === STAMP) fresh[f] = c[f]; });
          local.push(fresh); byKey[k] = fresh; out.added++; return;
        }
        var mine = maps ? snapshotMaps(l, opts) : null;
        var cs = trusted(stampOf(c), nowMs), ls = trusted(stampOf(l), nowMs);
        var touched = false;
        // opts.rank(record) -> number: a copy of a higher rank wins whatever the
        // dates say (a placeholder never beats a real record — see
        // Core.feeRecordRank); the loser only fills the winner's blanks, minus
        // the fields named in opts.rankDrop.
        var rl = opts.rank ? opts.rank(l) : 0, rc = opts.rank ? opts.rank(c) : 0;
        if (rc !== rl) {
          var before = JSON.stringify(l);
          if (rc > rl) {
            var lost = {};
            Object.keys(l).forEach(function (f) { if (!opts.rankDrop || opts.rankDrop.indexOf(f) === -1) lost[f] = l[f]; });
            takeOver(l, c, opts.keep);
            fillBlanks(l, lost);
          } else {
            var theirs = {};
            Object.keys(c).forEach(function (f) { if (!opts.rankDrop || opts.rankDrop.indexOf(f) === -1) theirs[f] = c[f]; });
            fillBlanks(l, theirs);
          }
          if (JSON.stringify(l) !== before) out.updated++;
          return;
        }
        if (cs > ls) { takeOver(l, c, opts.keep); touched = true; }
        // Two undated copies — or one whose date cannot be believed (a wrong
        // clock): keep ours and fill its blanks, so nothing typed is lost.
        else if ((cs === ls || (!cs && stampOf(c))) && fillBlanks(l, c)) touched = true;
        if (maps && reconcileMaps(l, mine, c, opts, cs > ls, nowMs)) touched = true;
        if (touched) out.updated++;
      });
      return out;
    }

    /* EXAM RESULTS — one rule for every path that merges them.

       Results used to be merged by trainee and exam, and a copy replaced
       another only when it was SUBMITTED later. Marking a short answer,
       an instructor's review and a transcript override change the score but
       never the submission time, so the marked copy never travelled: every
       other device kept "pending review", and its next upload put the
       unmarked copy back over the instructor's work.

       Now, for one attempt (the same result id; a legacy row without an id
       is paired by exam and trainee):
         - a reviewed copy beats one still awaiting review — marking only
           ever moves forward;
         - otherwise the later edit wins (updatedAt, gradedAt, reviewedAt,
           markedAt, overriddenAt);
         - with nothing to tell them apart, the local copy stands and its
           blanks are filled.
       Two DIFFERENT attempts at one exam (a re-sit) are decided as before:
       the later submission replaces the earlier. A result deleted after its
       last edit stays deleted (tombs, keyed by examResultKey). */
    var EDIT_FIELDS = ['updatedAt', 'gradedAt', 'reviewedAt', 'markedAt', 'overriddenAt'];
    function examResultKey(r) {
      if (!r) return undefined;
      return (r.id != null && r.id !== '') ? String(r.id) : String(r.examId) + '|' + String(r.studentId);
    }
    function attemptKey(r) { return String(r.examId) + '|' + String(r.studentId); }
    function editStamp(r, nowMs) {
      var best = 0;
      EDIT_FIELDS.forEach(function (f) { var t = Date.parse((r && r[f]) || ''); if (!isNaN(t) && t > best) best = t; });
      return trusted(best, nowMs);
    }
    function reviewed(r) { return !!(r && (r.reviewComplete || !r.needsReview)); }
    function pickResult(l, c, nowMs) {
      var sameAttempt = (l.id != null && l.id !== '' && c.id != null && c.id !== '') ? String(l.id) === String(c.id) : true;
      var ls = Date.parse(l.submittedAt || '') || 0, cs = Date.parse(c.submittedAt || '') || 0;
      // Two results that both came from a travelling attempt (attemptId) are
      // ONE attempt submitted twice — a PC that was away submitted its own
      // stale copy later. The first submission stands; "the later replaces
      // the earlier" would have put the stale copy over the real one.
      if (!sameAttempt && l.attemptId && c.attemptId) {
        if (cs && ls && cs !== ls) return cs < ls ? 'replace' : 'keep';
        return String(c.id) < String(l.id) ? 'replace' : 'keep';
      }
      if (!sameAttempt) return cs > ls ? 'replace' : 'keep';
      if (reviewed(c) !== reviewed(l)) return reviewed(c) ? 'cloud' : 'keep';
      var te = editStamp(c, nowMs), tl = editStamp(l, nowMs);
      if (te !== tl) return te > tl ? 'cloud' : 'keep';
      if (cs !== ls && cs && ls) return cs > ls ? 'cloud' : 'keep';
      if (l.score === undefined && c.score !== undefined) return 'cloud';
      return 'tie';
    }
    function mergeExamResults(local, cloud, opts) {
      opts = opts || {};
      var out = { added: 0, updated: 0, removed: 0 };
      if (!Array.isArray(local)) return out;
      var tombs = opts.tombs || {}, nowMs = opts.nowMs;
      for (var i = local.length - 1; i >= 0; i--) {
        var r = local[i];
        if (r && typeof r === 'object' && deletedAfter(tombs, examResultKey(r), r, nowMs)) { local.splice(i, 1); out.removed++; }
      }
      var byId = {}, byAttempt = {};
      var index = function (r, at) {
        if (r.id != null && r.id !== '') byId[String(r.id)] = at;
        if (byAttempt[attemptKey(r)] === undefined) byAttempt[attemptKey(r)] = at;
      };
      local.forEach(function (r, at) {
        if (!r || typeof r !== 'object') return;
        index(r, at);
        // A mark or review made here on a clock days fast is re-dated now.
        if (restampOwn(r, EDIT_FIELDS, nowMs)) out.updated++;
      });
      (Array.isArray(cloud) ? cloud : []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        if (opts.accept && !opts.accept(c)) return;
        if (deletedAfter(tombs, examResultKey(c), c, nowMs)) return;
        var at = (c.id != null && c.id !== '' && byId[String(c.id)] !== undefined) ? byId[String(c.id)] : byAttempt[attemptKey(c)];
        if (at === undefined) {
          var fresh = JSON.parse(JSON.stringify(c));
          local.push(fresh); index(fresh, local.length - 1); out.added++; return;
        }
        var l = local[at];
        var how = pickResult(l, c, nowMs);
        if (how === 'replace') { local[at] = JSON.parse(JSON.stringify(c)); index(local[at], at); out.updated++; }
        else if (how === 'cloud') { takeOver(l, JSON.parse(JSON.stringify(c)), opts.keep); out.updated++; }
        else if (how === 'tie' && fillBlanks(l, c)) out.updated++;
      });
      // And a device already holding both copies of one attempt keeps one.
      if (Core.exams && Core.exams.oneResultPerAttempt) out.removed += Core.exams.oneResultPerAttempt(local).length;
      return out;
    }

    /* The same for a map of key -> record. */
    function mergeMap(local, cloud, opts) {
      opts = opts || {};
      var out = { added: 0, updated: 0, removed: 0 };
      if (!isPlain(local)) return out;
      var tombs = opts.tombs || {};
      Object.keys(local).forEach(function (k) {
        if (deletedAfter(tombs, k, local[k], opts.nowMs)) { delete local[k]; out.removed++; return; }
        if (isPlain(local[k]) && restampOwn(local[k], [STAMP], opts.nowMs)) out.updated++;
      });
      Object.keys(isPlain(cloud) ? cloud : {}).forEach(function (k) {
        var c = cloud[k];
        if (!isPlain(c)) { if (local[k] === undefined) { local[k] = c; out.added++; } return; }
        if (deletedAfter(tombs, k, c, opts.nowMs)) return;
        var l = local[k];
        if (!isPlain(l)) { var fresh = {}; Object.keys(c).forEach(function (f) { if (f !== '_plaintextPw') fresh[f] = c[f]; }); local[k] = fresh; out.added++; return; }
        var cs = trusted(stampOf(c), opts.nowMs), ls = trusted(stampOf(l), opts.nowMs);
        if (cs > ls) { takeOver(l, c, opts.keep); out.updated++; }
        else if ((cs === ls || (!cs && stampOf(c))) && fillBlanks(l, c)) out.updated++;
      });
      return out;
    }

    /* Remove, IN PLACE, every record a tombstone says was deleted after its
       last edit. A deletion is written down at once, but the list it came
       from is only written to storage when that write is allowed — and the
       anti-wipe guard (rightly) refuses to replace stored records with an
       empty list, so deleting the LAST record of a collection never reached
       storage and the record came back on reload. Applying the tombstones on
       load settles it without weakening that guard. Returns how many went. */
    function applyTombstones(list, keyOf, tombs, nowMs) {
      if (Array.isArray(list)) return mergeList(list, [], keyOf, { tombs: tombs, nowMs: nowMs }).removed;
      if (isPlain(list)) return mergeMap(list, {}, { tombs: tombs, nowMs: nowMs }).removed;
      return 0;
    }
    /* May this list be written as EMPTY over what is stored? Only when every
       stored record is one a tombstone says was deleted after its last edit:
       then "[]" is the truth, written down deliberately, and not a page that
       had not loaded yet. */
    function emptyIsDeliberate(storedList, keyOf, tombs, nowMs) {
      if (!Array.isArray(storedList) || !storedList.length) return false;
      return storedList.every(function (r) {
        if (!r || typeof r !== 'object') return false;
        var k = keyOf(r);
        return k !== undefined && k !== null && deletedAfter(tombs, k, r, nowMs);
      });
    }

    /* The maps inside a record that several people write at once, per
       collection — ONE definition for every path that merges these records:
       the dashboard's Drive backup and assignments side file
       (Core.sync.mergeList), and the Centre's network, where each device and
       the Centre's own server merge the stored collections
       (Core.pageCloud.mergeRecordValue). The Drive merge kept both
       instructors' grades while the Centre's network still let the newer
       whole assignment win, so one grade was erased there.
         assignments   — grades {trainee: score}, each dated by
                         gradeMeta[trainee].gradedAt; the grade history kept
                         whole from both sides.
         notifications — who has read / cleared it, person by person. */
    var RECORD_MAPS = {
      assignments: { perEntry: { grades: 'gradeMeta.gradedAt' }, unionStamps: ['gradeLog'] },
      notifications: { unionStamps: ['readBy', 'clearedBy'] },
      // A sitting's attendance register (Core.invigilation): two invigilators
      // noting different trainees, or one signing off while the other notes,
      // both keep what they wrote.
      examRegisters: { perEntry: { notes: 'noteAt', signoff: 'signoffAt' }, unionStamps: ['attendanceLog'] }
    };
    /* mergeList options for one of those collections, plus the caller's own
       (tombs, accept, ...). */
    function mapRules(name, extra) {
      var out = {}, rule = RECORD_MAPS[name] || {};
      Object.keys(rule).forEach(function (k) { out[k] = copyOf(rule[k]); });
      Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
      return out;
    }

    return { stampOf: stampOf, fingerprint: fingerprint, stampChanges: stampChanges, detectRemovals: detectRemovals,
      mergeTombstones: mergeTombstones, deletedAfter: deletedAfter, mergeList: mergeList, mergeMap: mergeMap,
      MAX_AHEAD_MS: MAX_AHEAD_MS, trusted: trusted, laterStamp: laterStamp, clockSkew: clockSkew,
      clockLooksWrong: clockLooksWrong, examResultKey: examResultKey, mergeExamResults: mergeExamResults,
      applyTombstones: applyTombstones, emptyIsDeliberate: emptyIsDeliberate,
      setClockOffset: setClockOffset, clockOffset: clockOffset, now: now, nowIso: nowIso, restampOwn: restampOwn,
      snapshotMaps: snapshotMaps, reconcileMaps: reconcileMaps, RECORD_MAPS: RECORD_MAPS, mapRules: mapRules };
  })();

  /* ==========================================================================
     CASHBOOK: one merge rule for every quarter, on every path.

     A transaction's `id` counts up from 100 in each quarter on each device, so
     the same number names different cheques on different machines once rows
     have been adopted across devices. The merges for the active quarter
     matched by `uid`, but the merges for every OTHER quarter, the login
     restore, Merge from Cloud and the Payment Voucher's pull still matched by
     id or replaced whole quarters — dropping one device's cheque, doubling
     another's, letting a deletion on one PC remove a DIFFERENT live cheque on
     the next, and erasing anything entered while uploads were stopped. Rows
     that never had a uid (the Subvention panel, saves into another quarter,
     everything from before uids) were given a RANDOM uid by whichever device
     adopted them, so the originating device saw an unknown uid come back and
     adopted it again: the quarter's subvention was counted twice.

     The rule now:
       - every row is known by its uid. A row without one gets a uid DERIVED
         from what it says (quarter, date, cheque, details, amounts — the
         original amounts for a voided cheque), so every device names the same
         legacy row the same way; exact duplicates are told apart by order;
       - a deletion is written down by uid (deletedTxnUids) and travels;
         a quarter's old id-based list only ever applies to its own rows;
       - the copy of a row changed later (updatedAt) wins, so voids and edits
         reach every device; the Balance B/F carries openingBalanceAt;
       - a row only one side holds is kept; an adopted row whose id is taken
         here is given the next free id, never dropped;
       - a row a device once adopted under a random uid is recognised as the
         same legacy row (one-to-one), so the doubled subvention stops spreading.
     Pure: it mutates and returns the local quarter blob it is given.
     ========================================================================== */
  /* A calendar event's identity in every merge: its id, and for an event
     saved before events carried one, its title and date (the key those
     events have always been merged and tombstoned under). By title and date
     alone, two different events with one title on one day were folded into
     one, and renaming an event deleted it. */
  Core.calendarEventKey = function (r) {
    if (!r) return undefined;
    if (r.id != null && r.id !== '') return String(r.id);
    var lower = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
    return lower(r.title) + '|' + lower(r.date);
  };

  /* ==========================================================================
     CHAT — messages, votes and follows merged so nobody's action is undone.

     The chat file was written whole by whichever device saved last, and read
     back with the cloud copy of every message winning. So a message deleted
     on one device reappeared the moment a device that had not yet seen the
     deletion opened a room (opening a room saves); an edit was reverted the
     same way; twenty trainees voting in one poll each wrote "the poll with my
     vote", and only the last vote survived; an unfollow came straight back
     from any device still holding the follow. Now:
       - a message: the copy changed last wins (updatedAt / editedAt /
         deletedAt), its blanks are filled from the other (a picture carried by
         one copy only), and a DELETION is final whichever copy is newer;
         readBy is the union of both;
       - a poll: each voter's choice is kept on its own with its time
         (voteLog), so every voter's latest vote stands; votes recorded before
         this are kept as they were;
       - a follow: each (follower, followed) pair keeps its latest
         follow-or-unfollow with its time (the follow log).
     ========================================================================== */
  Core.chatSync = (function () {
    function t(v) { var x = Date.parse(v || ''); return isNaN(x) ? 0 : x; }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function stampOf(m) { return Math.max(t(m && m.updatedAt), t(m && m.editedAt), t(m && m.deletedAt)); }
    function blank(v) { return v === undefined || v === null || v === ''; }

    function mergeVotes(out, a, b) {
      var log = {};
      [a.voteLog, b.voteLog].forEach(function (lg) {
        if (!lg || typeof lg !== 'object') return;
        Object.keys(lg).forEach(function (uid) {
          var e = lg[uid];
          if (!e) return;
          if (!log[uid] || t(e.at) > t(log[uid].at)) log[uid] = clone(e);
        });
      });
      if (!Array.isArray(out.pollOptions)) return;
      var opts = out.pollOptions;
      var legacy = opts.map(function (o, i) {
        var set = {};
        [a, b].forEach(function (m) {
          var po = m && Array.isArray(m.pollOptions) ? m.pollOptions[i] : null;
          (po && Array.isArray(po.votes) ? po.votes : []).forEach(function (v) { set[v] = true; });
        });
        return set;
      });
      opts.forEach(function (o, i) {
        var votes = [];
        Object.keys(legacy[i]).forEach(function (v) { if (!log[v]) votes.push(v); });
        Object.keys(log).forEach(function (uid) {
          var chosen = Array.isArray(log[uid].opts) ? log[uid].opts : [];
          if (chosen.indexOf(i) !== -1) votes.push(uid);
        });
        o.votes = votes;
      });
      if (Object.keys(log).length) out.voteLog = log;
    }

    /* The merged copy of one message. Never mutates its arguments. */
    function mergeMessage(l, c) {
      if (!l) return c ? clone(c) : l;
      if (!c) return clone(l);
      var cloudNewer = stampOf(c) > stampOf(l);
      var base = clone(cloudNewer ? c : l), other = cloudNewer ? l : c;
      Object.keys(other).forEach(function (k) {
        if (blank(base[k]) && !blank(other[k]) && !(k === 'text' && (l.deleted || c.deleted))) base[k] = clone(other[k]);
      });
      if (l.deleted || c.deleted) {
        var d = l.deleted && c.deleted ? (t(l.deletedAt) >= t(c.deletedAt) ? l : c) : (l.deleted ? l : c);
        base.deleted = true;
        base.text = '';
        base.deletedAt = d.deletedAt || base.deletedAt;
        if (d.deletedBy) base.deletedBy = d.deletedBy;
        if (d.originalText) base.originalText = d.originalText;
        delete base.imageData; delete base.fileData;
      }
      if (Array.isArray(l.readBy) || Array.isArray(c.readBy)) {
        var rb = [];
        (l.readBy || []).concat(c.readBy || []).forEach(function (u) { if (rb.indexOf(u) === -1) rb.push(u); });
        base.readBy = rb;
      }
      if (base.type === 'poll' || l.voteLog || c.voteLog) mergeVotes(base, l, c);
      return base;
    }

    /* Merge one room's messages from `cloud` into `local` (arrays), returning
       { list, changed }. Every message either side has is kept, in time order. */
    function mergeRoom(local, cloud) {
      local = Array.isArray(local) ? local : [];
      cloud = Array.isArray(cloud) ? cloud : [];
      var byId = {}, out = [], changed = false;
      local.forEach(function (m) { if (!m) return; out.push(m); if (m.id != null) byId[String(m.id)] = out.length - 1; });
      cloud.forEach(function (c) {
        if (!c) return;
        var at = c.id != null ? byId[String(c.id)] : undefined;
        if (at === undefined) {
          out.push(clone(c)); changed = true;
          if (c.id != null) byId[String(c.id)] = out.length - 1;
          return;
        }
        var merged = mergeMessage(out[at], c);
        if (JSON.stringify(merged) !== JSON.stringify(out[at])) { out[at] = merged; changed = true; }
      });
      if (changed) out.sort(function (a, b) { return t(a && a.timestamp) - t(b && b.timestamp); });
      return { list: out, changed: changed };
    }

    /* { roomId: [messages] } — merged into `rooms` IN PLACE. Returns true
       when anything changed. */
    function mergeRooms(rooms, cloudRooms) {
      if (!rooms || typeof rooms !== 'object' || !cloudRooms || typeof cloudRooms !== 'object') return false;
      var changed = false;
      Object.keys(cloudRooms).forEach(function (roomId) {
        if (!Array.isArray(cloudRooms[roomId])) return;
        var res = mergeRoom(rooms[roomId], cloudRooms[roomId]);
        if (res.changed || !rooms[roomId]) { rooms[roomId] = res.list; changed = changed || res.changed; }
      });
      return changed;
    }

    /* Record this user's vote on a poll message (opts: the chosen option
       indexes), with its time. The options' vote lists follow from it. */
    function recordVote(msg, userId, opts, at) {
      if (!msg || userId == null) return;
      if (!msg.voteLog || typeof msg.voteLog !== 'object') msg.voteLog = {};
      msg.voteLog[userId] = { opts: (opts || []).slice(), at: at || new Date().toISOString() };
      msg.updatedAt = at || new Date().toISOString();
    }

    /* Follows: follows { uid: [followedId] }, log { uid: { followedId: { on, at } } }. */
    function recordFollow(follows, log, uid, target, on, at) {
      if (!follows || !log || uid == null || target == null) return;
      if (!log[uid] || typeof log[uid] !== 'object') log[uid] = {};
      log[uid][target] = { on: !!on, at: at || new Date().toISOString() };
    }
    function mergeFollows(follows, log, cloudFollows, cloudLog) {
      if (!follows || typeof follows !== 'object') return false;
      log = (log && typeof log === 'object') ? log : {};
      var before = JSON.stringify([follows, log]);
      if (cloudLog && typeof cloudLog === 'object') {
        Object.keys(cloudLog).forEach(function (uid) {
          var cl = cloudLog[uid];
          if (!cl || typeof cl !== 'object') return;
          if (!log[uid] || typeof log[uid] !== 'object') log[uid] = {};
          Object.keys(cl).forEach(function (tg) {
            if (!cl[tg]) return;
            if (!log[uid][tg] || t(cl[tg].at) > t(log[uid][tg].at)) log[uid][tg] = clone(cl[tg]);
          });
        });
      }
      Object.keys(cloudFollows && typeof cloudFollows === 'object' ? cloudFollows : {}).forEach(function (uid) {
        if (!Array.isArray(cloudFollows[uid])) return;
        if (!Array.isArray(follows[uid])) follows[uid] = [];
        cloudFollows[uid].forEach(function (f) { if (follows[uid].indexOf(f) === -1) follows[uid].push(f); });
      });
      Object.keys(log).forEach(function (uid) {
        Object.keys(log[uid] || {}).forEach(function (tg) {
          var e = log[uid][tg];
          if (!Array.isArray(follows[uid])) follows[uid] = [];
          var i = follows[uid].indexOf(tg);
          if (e.on && i === -1) follows[uid].push(tg);
          if (!e.on && i !== -1) follows[uid].splice(i, 1);
        });
      });
      return JSON.stringify([follows, log]) !== before;
    }

    /* A copy of the rooms without the pictures and files messages carry —
       for every channel but the chat's own file. */
    function withoutBlobs(rooms) {
      var out = {};
      Object.keys(rooms || {}).forEach(function (r) {
        out[r] = (Array.isArray(rooms[r]) ? rooms[r] : []).map(function (m) {
          if (!m || (m.imageData === undefined && m.fileData === undefined)) return m;
          var c = {};
          Object.keys(m).forEach(function (k) { if (k !== 'imageData' && k !== 'fileData') c[k] = m[k]; });
          return c;
        });
      });
      return out;
    }

    return { mergeMessage: mergeMessage, mergeRoom: mergeRoom, mergeRooms: mergeRooms, recordVote: recordVote,
      recordFollow: recordFollow, mergeFollows: mergeFollows, withoutBlobs: withoutBlobs, stampOf: stampOf };
  })();

  /* NOTIFICATIONS — trimming the list is housekeeping, never a deletion.

     (Read and cleared are each person's own: readBy / clearedBy, see
     Core.comms, merged person by person by Core.sync.mergeList unionStamps.)

     The list was cut to the newest 50 for the whole Centre, so one call to an
     80-member class room pushed out every other notice — and each one cut
     was written down as a deletion for ever. prune() keeps the newest
     `perAudience` for each audience (a person, or a set of roles) and never
     more than `max` in all. */
  Core.notify = (function () {
    function audience(n) {
      if (n && Array.isArray(n.forUsers) && n.forUsers.length) return 'u:' + n.forUsers.slice().sort().join(',');
      var k = 'r:' + ((n && Array.isArray(n.forRoles)) ? n.forRoles.slice().sort().join(',') : '');
      // A programme's notices, and one instructor's marking notices, are kept
      // as their own audience: a busy programme, or a marking session, no
      // longer pushes everybody else's notices out of the bell.
      if (n && n.forCourse) k += '|c:' + String(n.forCourse);
      if (n && Array.isArray(n.forInstructors) && n.forInstructors.length) k += '|i:' + n.forInstructors.slice().sort().join(',');
      return k;
    }
    /* Who a notice reaches beyond its roles. Two optional fields, on new
       notices only — every notice already stored has neither and reaches
       everybody in its roles exactly as before:
         n.forCourse       a programme's notice (a new class, a resource, an
                           instructor's announcement): a TRAINEE sees it only
                           when it is her programme (or 'General'); staff as
                           before. A Plumbing trainee's bell held every
                           Welding class, resource and announcement.
         n.forInstructors  [account ids]: a marking notice reaches the
                           instructor who marked (and the administrators),
                           not every instructor in the Centre.
       viewer { role, userId, course, sameProgramme(a, b) } -> true | false */
    function reaches(n, viewer) {
      if (!n) return false;
      var v = viewer || {};
      if (v.role === 'student' && n.forCourse) return Core.coursework.resourceVisible(n.forCourse, v.course, v.sameProgramme);
      if (v.role === 'instructor' && Array.isArray(n.forInstructors) && n.forInstructors.length) {
        return !!v.userId && n.forInstructors.indexOf(v.userId) !== -1;
      }
      return true;
    }
    function prune(list, perAudience, max) {
      if (!Array.isArray(list)) return list;
      perAudience = perAudience || 50; max = max || 400;
      var ordered = list.slice().sort(function (a, b) { return ((b && +b.timestamp) || 0) - ((a && +a.timestamp) || 0); });
      var seen = {}, keep = [];
      ordered.forEach(function (n) {
        if (!n) return;
        var k = audience(n);
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] <= perAudience && keep.length < max) keep.push(n);
      });
      if (keep.length === list.length) return list;
      return list.filter(function (n) { return n && keep.indexOf(n) !== -1; });
    }
    return { prune: prune, reaches: reaches };
  })();

  Core.cashbook = (function () {
    function str(v) { return v == null ? '' : String(v).trim(); }
    function amt(v) { var n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
    function stampOf(r) { var t = Date.parse((r && r.updatedAt) || ''); return isNaN(t) ? 0 : t; }

    /* The uid every device derives for a row from before uids existed. */
    function legacyUid(fy, q, t) {
      var orig = function (k, o) { return t[o] !== undefined && t[o] !== null && t[o] !== '' ? t[o] : t[k]; };
      var sig = [str(fy), 'Q' + str(q), str(t.date), str(t.cheque), str(orig('details', '_origDetails')).toLowerCase(),
                 amt(orig('deposit', '_origDeposit')), amt(orig('payment', '_origPayment'))].join('|');
      return 'L-' + Core.hashString(sig);
    }
    /* Give every uid-less row in a quarter blob its derived uid. Returns how
       many were given one. Rows are never added or removed. */
    function ensureUids(blob, fy, q) {
      if (!blob || !Array.isArray(blob.transactions)) return 0;
      var seen = {}, n = 0;
      blob.transactions.forEach(function (t) { if (t && t.uid) seen[t.uid] = 1; });
      blob.transactions.forEach(function (t) {
        if (!t || typeof t !== 'object' || t.uid) return;
        var base = legacyUid(fy, q, t), u = base, k = 0;
        while (seen[u]) { k++; u = base + '-' + k; }
        t.uid = u; seen[u] = 1; n++;
      });
      return n;
    }
    function parseQuarterKey(key) {
      var m = /^cestis_(?:quarter|budget)_(\d{4}\/\d{4})_Q([1-4])$/.exec(String(key || ''));
      return m ? { fy: m[1], q: parseInt(m[2], 10) } : null;
    }
    function copy(o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; }

    /* Merge a cloud quarter blob into the local one IN PLACE.
       Returns { changed, added, updated, removed }. */
    function mergeQuarter(local, cloud, fy, q) {
      var out = { changed: false, added: 0, updated: 0, removed: 0 };
      if (!local || typeof local !== 'object' || !cloud || typeof cloud !== 'object') return out;
      if (!Array.isArray(local.transactions)) local.transactions = [];
      if (!Array.isArray(local.deletedTxnIds)) local.deletedTxnIds = [];
      if (ensureUids(local, fy, q)) out.changed = true;
      // The cloud quarter's own id-based deletions apply to its own legacy rows
      // only; ids mean nothing on this device.
      var cDel = {};
      (Array.isArray(cloud.deletedTxnIds) ? cloud.deletedTxnIds : []).forEach(function (id) { cDel[id] = 1; });
      var cBlob = { transactions: (Array.isArray(cloud.transactions) ? cloud.transactions : [])
        .filter(function (t) { return t && typeof t === 'object' && (t.uid || !cDel[t.id]); }).map(copy) };
      ensureUids(cBlob, fy, q);

      // Deletions by uid: the union of both sides.
      var tomb = {}, tombList = Array.isArray(local.deletedTxnUids) ? local.deletedTxnUids.slice() : [];
      tombList.forEach(function (u) { tomb[u] = 1; });
      (Array.isArray(cloud.deletedTxnUids) ? cloud.deletedTxnUids : []).forEach(function (u) {
        if (u && !tomb[u]) { tomb[u] = 1; tombList.push(u); out.changed = true; }
      });
      if (tombList.length || local.deletedTxnUids) local.deletedTxnUids = tombList;
      var before = local.transactions.length;
      local.transactions = local.transactions.filter(function (t) { return !(t && tomb[t.uid]); });
      out.removed = before - local.transactions.length;

      var byUid = {}, byContent = {}, cloudUids = {}, matched = {};
      cBlob.transactions.forEach(function (c) { cloudUids[c.uid] = 1; });
      var used = {}, maxId = 99;
      local.transactions.forEach(function (t) {
        if (!t) return;
        byUid[t.uid] = t;
        var ck = legacyUid(fy, q, t);
        (byContent[ck] = byContent[ck] || []).push(t);
        used[t.id] = 1; maxId = Math.max(maxId, Number(t.id) || 0);
      });
      local.deletedTxnIds.forEach(function (id) { used[id] = 1; maxId = Math.max(maxId, Number(id) || 0); });

      cBlob.transactions.forEach(function (c) {
        if (tomb[c.uid]) return;
        var l = byUid[c.uid];
        if (!l) {
          // The same legacy row under a uid a device once invented for it?
          var ck = legacyUid(fy, q, c);
          var cands = (byContent[ck] || []).filter(function (t) { return !cloudUids[t.uid]; });
          var isL = function (u) { return String(u || '').indexOf('L-') === 0; };
          var pick = null;
          for (var i = 0; i < cands.length && !pick; i++) {
            if (!matched[cands[i].uid] && (isL(c.uid) || isL(cands[i].uid))) pick = cands[i];
          }
          if (!pick && !isL(c.uid)) {
            for (var j = 0; j < cands.length && !pick; j++) if (isL(cands[j].uid)) pick = cands[j];
          }
          if (pick) {
            matched[pick.uid] = 1;
            // Converge on the derived name, so both devices end with one uid.
            if (isL(c.uid) && !isL(pick.uid)) { delete byUid[pick.uid]; pick.uid = c.uid; byUid[c.uid] = pick; out.changed = true; }
            l = pick;
          }
        }
        if (!l) {
          var row = copy(c);
          if (row.id == null || used[row.id]) { do { maxId++; } while (used[maxId]); row.id = maxId; }
          used[row.id] = 1; maxId = Math.max(maxId, Number(row.id) || 0);
          local.transactions.push(row);
          byUid[row.uid] = row;
          out.added++;
          return;
        }
        if (stampOf(c) > stampOf(l)) {
          // The newer copy wins — all but this device's own id for the row.
          var keepId = l.id, keepUid = l.uid;
          Object.keys(l).forEach(function (k) { if (!(k in c)) delete l[k]; });
          Object.keys(c).forEach(function (k) { l[k] = c[k]; });
          l.id = keepId; l.uid = keepUid;
          out.updated++;
        }
      });

      // Balance B/F: the later-dated value wins; an undated one never replaces.
      var cAt = Date.parse(cloud.openingBalanceAt || '') || 0, lAt = Date.parse(local.openingBalanceAt || '') || 0;
      if (typeof cloud.openingBalance === 'number' && cAt > lAt) {
        if (local.openingBalance !== cloud.openingBalance) out.changed = true;
        local.openingBalance = cloud.openingBalance;
        local.openingBalanceAt = cloud.openingBalanceAt;
      }
      if (out.added || out.updated || out.removed) out.changed = true;
      return out;
    }

    /* Merge a cloud quarter budget ({ budget, sections, budgetAt }) into the
       local one IN PLACE: a line only the cloud has is added; a line both have
       takes the later-dated amount; an undated line never replaces. */
    function mergeBudget(local, cloud) {
      var out = { changed: false };
      if (!local || !cloud || typeof cloud.budget !== 'object' || !cloud.budget) return out;
      if (!local.budget || typeof local.budget !== 'object') local.budget = {};
      if (!local.sections || typeof local.sections !== 'object') local.sections = {};
      var lAt = local.budgetAt && typeof local.budgetAt === 'object' ? local.budgetAt : null;
      var cAt = cloud.budgetAt && typeof cloud.budgetAt === 'object' ? cloud.budgetAt : {};
      Object.keys(cloud.budget).forEach(function (cat) {
        var ct = Date.parse(cAt[cat] || '') || 0, lt = lAt ? (Date.parse(lAt[cat] || '') || 0) : 0;
        if (local.budget[cat] === undefined || (ct > lt && local.budget[cat] !== cloud.budget[cat])) {
          local.budget[cat] = cloud.budget[cat];
          if (cAt[cat]) { if (!local.budgetAt) local.budgetAt = lAt = {}; local.budgetAt[cat] = cAt[cat]; }
          out.changed = true;
        }
      });
      Object.keys(cloud.sections && typeof cloud.sections === 'object' ? cloud.sections : {}).forEach(function (cat) {
        if (!local.sections[cat]) { local.sections[cat] = cloud.sections[cat]; out.changed = true; }
      });
      return out;
    }

    return { legacyUid: legacyUid, ensureUids: ensureUids, parseQuarterKey: parseQuarterKey,
             mergeQuarter: mergeQuarter, mergeBudget: mergeBudget };
  })();

  /* ==========================================================================
     PAYROLL ('cestisPayroll'): the Staff Payslip page's merge rule, for the
     merges that run outside that page (Import Backup on the dashboard).

     The payroll is ONE stored object — { settings, employees, payrollRuns,
     deleted } — so a merge that only looked at its top-level keys restored
     nothing at all from a backup: every key already existed on the device
     (even the page's empty start-up skeleton has them), so the employees and
     every payroll run in the backup were dropped while the import reported
     success. This is Staff.Payslip.html _mergeDataIntoLocal, unchanged in
     meaning (a test runs the two side by side): employees by name, runs by
     date, each run's results by employee; the copy changed later
     (updatedAt) wins; undated copies keep the local one and fill its
     blanks; a record deleted (deleted { key: when }) after its last edit
     stays deleted. Merges IN PLACE; returns a summary. */
  Core.payroll = (function () {
    function keyEmp(e) { return 'emp:' + String(e && e.name || '').trim().toLowerCase(); }
    function keyRun(r) { return 'run:' + String(r && r.date || ''); }
    function keyRes(run, res) { return 'res:' + String(run && run.date || '') + '|' + String(res && res.empName || '').trim().toLowerCase(); }
    function stampOf(r) { var t = Date.parse((r && r.updatedAt) || ''); return isNaN(t) ? 0 : t; }
    function blank(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); }
    function fold(local, inc, skip) {
      var cs = stampOf(inc), ls = stampOf(local), changed = false;
      if (cs > ls) {
        Object.keys(local).forEach(function (k) { if (!(skip && skip[k]) && !(k in inc)) { delete local[k]; changed = true; } });
        Object.keys(inc).forEach(function (k) { if (skip && skip[k]) return; if (local[k] !== inc[k]) { local[k] = inc[k]; changed = true; } });
      } else if (cs === ls) {
        Object.keys(inc).forEach(function (k) { if (skip && skip[k]) return; if (blank(local[k]) && !blank(inc[k])) { local[k] = inc[k]; changed = true; } });
      }
      return changed;
    }
    function mergeData(data, incoming) {
      var summary = { addedEmployees: 0, updatedEmployees: 0, addedRuns: 0, updatedRuns: 0, removed: 0 };
      if (!data || typeof data !== 'object' || !incoming || typeof incoming !== 'object') return summary;
      if (!Array.isArray(data.employees)) data.employees = [];
      if (!Array.isArray(data.payrollRuns)) data.payrollRuns = [];
      // Deletions, from both sides: the later removal of each key stands.
      if (!data.deleted || typeof data.deleted !== 'object') data.deleted = {};
      if (incoming.deleted && typeof incoming.deleted === 'object' && !Array.isArray(incoming.deleted)) {
        Object.keys(incoming.deleted).forEach(function (k) {
          var t = Date.parse(incoming.deleted[k] || '') || 0, have = Date.parse(data.deleted[k] || '') || 0;
          if (t > have) data.deleted[k] = incoming.deleted[k];
        });
      }
      var tombs = data.deleted;
      var gone = function (k, r) { var t = tombs[k] ? (Date.parse(tombs[k]) || 0) : 0; return t > 0 && t >= stampOf(r); };
      data.employees = data.employees.filter(function (e) { if (e && e.name && gone(keyEmp(e), e)) { summary.removed++; return false; } return true; });
      data.payrollRuns = data.payrollRuns.filter(function (run) { if (run && run.date && gone(keyRun(run), run)) { summary.removed++; return false; } return true; });
      data.payrollRuns.forEach(function (run) {
        if (!run || !Array.isArray(run.results)) return;
        run.results = run.results.filter(function (res) { if (res && res.empName && gone(keyRes(run, res), res)) { summary.removed++; return false; } return true; });
      });
      // Employees.
      if (Array.isArray(incoming.employees)) {
        var byName = {};
        data.employees.forEach(function (le) { if (le && le.name) byName[keyEmp(le)] = le; });
        incoming.employees.forEach(function (ie) {
          if (!ie || !ie.name) return;
          var key = keyEmp(ie);
          if (gone(key, ie)) return;
          var existing = byName[key];
          if (!existing) {
            var fresh = Object.assign({}, ie);
            data.employees.push(fresh); byName[key] = fresh;
            summary.addedEmployees++;
          } else if (fold(existing, ie)) {
            summary.updatedEmployees++;
          }
        });
      }
      // Payroll runs, and each run's results.
      if (Array.isArray(incoming.payrollRuns)) {
        var byDate = {};
        data.payrollRuns.forEach(function (lr) { if (lr && lr.date) byDate[lr.date] = lr; });
        incoming.payrollRuns.forEach(function (ir) {
          if (!ir || !ir.date) return;
          if (gone(keyRun(ir), ir)) return;
          var existingRun = byDate[ir.date];
          if (!existingRun) {
            var cloned = Object.assign({}, ir);
            cloned.results = (Array.isArray(ir.results) ? ir.results : []).filter(function (res) { return !(res && res.empName && gone(keyRes(ir, res), res)); })
              .map(function (res) { return Object.assign({}, res); });
            data.payrollRuns.push(cloned); byDate[ir.date] = cloned;
            summary.addedRuns++;
            return;
          }
          if (!Array.isArray(existingRun.results)) existingRun.results = [];
          var runChanged = false;
          if (Array.isArray(ir.results)) {
            var byEmp = {};
            existingRun.results.forEach(function (lr) { if (lr && lr.empName) byEmp[keyRes(existingRun, lr)] = lr; });
            ir.results.forEach(function (ires) {
              if (!ires || !ires.empName) return;
              var rkey = keyRes(ir, ires);
              if (gone(rkey, ires)) return;
              var localRes = byEmp[rkey];
              if (!localRes) {
                var r2 = Object.assign({}, ires);
                existingRun.results.push(r2); byEmp[rkey] = r2;
                runChanged = true;
              } else if (fold(localRes, ires)) {
                runChanged = true;
              }
            });
          }
          if (fold(existingRun, ir, { results: 1 })) runChanged = true;
          if (runChanged) summary.updatedRuns++;
        });
      }
      // Settings: the copy changed later wins; undated copies fill blanks.
      if (incoming.settings && typeof incoming.settings === 'object') {
        if (!data.settings || typeof data.settings !== 'object') data.settings = Object.assign({}, incoming.settings);
        else fold(data.settings, incoming.settings);
      }
      return summary;
    }
    /* The page's empty start-up structure: no employee, no run, no
       deletion, settings never saved (undated). A backup restored onto it
       is taken whole — its settings are the Centre's own rates, which the
       page's defaults must not outvote. */
    function isSkeleton(d) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
      var none = function (v) { return v == null || (Array.isArray(v) && !v.length); };
      var del = d.deleted && typeof d.deleted === 'object' ? Object.keys(d.deleted).length : 0;
      return none(d.employees) && none(d.payrollRuns) && !del && !(d.settings && d.settings.updatedAt);
    }
    return { keyEmp: keyEmp, keyRun: keyRun, keyRes: keyRes, mergeData: mergeData, isSkeleton: isSkeleton };
  })();

  /* ==========================================================================
     STAFF TIME CLOCK: merge a cloud file into this device's lists.

     Each staff member's Drive file holds only THAT person — their own staff
     row and their own sessions. Five sync paths (login "Sync Now", Connect,
     Sync from Cloud, the selective sync and the sign-in page sync) assigned
     that one-person slice over the whole staff list and every staff member's
     time history, so after Mary pressed Sync on the office PC only Mary could
     sign in, everybody else's hours were gone, and page-cloud then pushed the
     one-person list to every other PC.

     A per-user file is a slice, so it is only ever MERGED: a session the other
     side holds and this one does not is added; a session both hold keeps the
     copy changed later (lastModified); the session somebody is clocked into
     right now is never replaced; a session written down as deleted is dropped
     and not re-added; and staff are added by id or username, never removed.
     Pure — returns new lists and leaves the arguments alone except for the
     local record objects it keeps (so a live session keeps its identity).
     ========================================================================== */
  Core.mergeTimeClock = function (local, cloud, opts) {
    local = local || {}; cloud = cloud || {}; opts = opts || {};
    var out = { staffMembers: [], timeRecords: [], added: 0, updated: 0, removed: 0, staffAdded: 0 };
    var deleted = {};
    (Array.isArray(opts.deletedIds) ? opts.deletedIds : []).forEach(function (id) { if (id != null && id !== '') deleted[String(id)] = 1; });
    var active = opts.activeSessionId != null ? String(opts.activeSessionId) : null;
    var mod = function (r) { var t = Date.parse((r && r.lastModified) || ''); return isNaN(t) ? 0 : t; };

    var recs = [], at = {};
    (Array.isArray(local.timeRecords) ? local.timeRecords : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var id = r.id != null ? String(r.id) : null;
      if (id && deleted[id] && id !== active) { out.removed++; return; }
      if (id) at[id] = recs.length;
      recs.push(r);
    });
    (Array.isArray(cloud.timeRecords) ? cloud.timeRecords : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || c.id == null) return;
      var id = String(c.id);
      if (deleted[id]) return;
      if (at[id] === undefined) { at[id] = recs.length; recs.push(Object.assign({}, c)); out.added++; return; }
      if (id === active) return;
      if (mod(c) > mod(recs[at[id]])) { recs[at[id]] = Object.assign({}, c); out.updated++; }
    });
    out.timeRecords = recs;

    var staff = (Array.isArray(local.staffMembers) ? local.staffMembers : []).slice();
    var ids = {}, names = {};
    staff.forEach(function (s) { if (!s) return; if (s.id != null) ids[String(s.id)] = 1; if (s.username) names[String(s.username)] = 1; });
    (Array.isArray(cloud.staffMembers) ? cloud.staffMembers : []).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      if ((s.id != null && ids[String(s.id)]) || (s.username && names[String(s.username)])) return;
      staff.push(Object.assign({}, s)); out.staffAdded++;
      if (s.id != null) ids[String(s.id)] = 1;
      if (s.username) names[String(s.username)] = 1;
    });
    out.staffMembers = staff;
    return out;
  };

  /* ==========================================================================
     VIREMENT REQUESTS — the Virement page's one merge rule, for the merges
     that run outside that page.

     The Virement page folds two copies of a request with vrMergeRequest: a
     ruling only moves between copies that ask for the SAME thing
     (vrContentRev); when the two copies ask for different things, the one
     edited later (editedAt) wins whole, and neither side's ruling crosses
     over. Editing an approved request sends it back to Pending with a new
     editedAt, because a signature belongs to the figures that were signed.

     The page-cloud merge (Google Drive and the Centre's server) had its own,
     opposite rule — "a decision beats Pending, whichever was saved later" —
     so a correction to an approved request (44,288.25 → 39,000) lost to the
     old Approved copy on Drive and then on the PC that made it: the request
     was back at the old figures with two signatures nobody gave the new ones.

     These are the page's functions, unchanged in meaning (tests pin the two
     together), so every path decides a request the same way. Pure. */
  Core.virements = (function () {
    function contentRev(r) {
      if (!r) return '';
      var sig = JSON.stringify([r.date || '', r.fy || '', r.quarter || '', r.project || '', r.period || '',
        r.requestedBy || '', r.position || '', Math.round((Number(r.total) || 0) * 100),
        (Array.isArray(r.lines) ? r.lines : []).map(function (l) {
          return [l.fromId || '', l.toId || '', Math.round((Number(l.amount) || 0) * 100), !!l.anyLine];
        }),
        r.deficitComment || '', r.anyLineComment || '']);
      var h = 5381;
      for (var i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
      return 'v' + (h >>> 0).toString(36) + sig.length.toString(36);
    }
    function signatures(r) { return Array.isArray(r && r.signatures) ? r.signatures : []; }
    function validSignatures(r) {
      var rev = contentRev(r);
      return signatures(r).filter(function (s) { return s && (!s.rev || s.rev === rev); });
    }
    function edited(r) { return Date.parse((r && r.editedAt) || '') || 0; }
    /* Fold another copy of the same request into `local` (IN PLACE).
       Returns whether `local` changed. Virement.Request.html vrMergeRequest. */
    function mergeRequest(local, cr) {
      if (!local || !cr || local === cr) return false;
      if (contentRev(local) !== contentRev(cr)) {
        if (edited(cr) > edited(local)) {
          var copy = JSON.parse(JSON.stringify(cr));
          Object.keys(local).forEach(function (k) { if (!(k in copy)) delete local[k]; });
          Object.keys(copy).forEach(function (k) { local[k] = copy[k]; });
          return true;
        }
        return false;
      }
      var decided = function (st) { return st === 'Approved' || st === 'Rejected' || st === 'Awaiting Second Signature'; };
      var signing = function (st) { return st === 'Approved' || st === 'Awaiting Second Signature'; };
      var at = function (r) { return Date.parse(r.approvalAt || r.approvalDate || '') || 0; };
      if (signing(local.status) && signing(cr.status)) {
        var seen = {}, sigs = [];
        validSignatures(local).concat(validSignatures(cr)).forEach(function (sg) {
          var k = sg.id || sg.name;
          if (!k || seen[k]) return;
          seen[k] = 1; sigs.push(sg);
        });
        if (!sigs.length || sigs.length === signatures(local).length) return false;
        sigs.sort(function (a, b) { return (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0); });
        local.signatures = sigs;
        if (sigs.length >= 2) { local.status = 'Approved'; local.approvedBy = sigs.map(function (sg) { return sg.name; }).join(' and '); }
        else { local.status = 'Awaiting Second Signature'; local.approvedBy = sigs[0].name + ' (awaiting a second signature)'; }
        local.approvalAt = sigs[sigs.length - 1].at || local.approvalAt;
        local.approvalDate = String(local.approvalAt || '').split('T')[0];
        return true;
      }
      var cloudDecided = decided(cr.status), localDecided = decided(local.status);
      if (cloudDecided && (!localDecided || at(cr) > at(local))) {
        if (local.status === cr.status && local.approvalAt === (cr.approvalAt || cr.approvalDate) &&
            JSON.stringify(signatures(local)) === JSON.stringify(validSignatures(cr))) return false;
        local.status = cr.status;
        local.approvedBy = cr.approvedBy;
        local.approvalDate = cr.approvalDate;
        local.approvalAt = cr.approvalAt || cr.approvalDate;
        local.approvalComment = cr.approvalComment;
        local.signatures = validSignatures(cr);
        return true;
      }
      if (cloudDecided && localDecided && at(cr) === at(local) && cr.status !== local.status) {
        // Same instant, different answers: the safe reading of a disagreement
        // about money is that nothing was agreed.
        local.status = 'Pending';
        local.signatures = [];
        local.approvedBy = '';
        local.approvalComment = 'Two devices recorded different decisions at the same moment — this needs signing again.';
        return true;
      }
      return false;
    }
    /* The record to keep when two copies of one request meet in a merge of
       whole collections (Core.pageCloud). mergeRequest's rule, except that
       two DIFFERENT versions neither of which says which was edited later
       go to the side that wrote its collection last (`preferCloud`) — the
       page-cloud's tie rule — taken whole, so no ruling crosses over. */
    function pick(l, c, preferCloud) {
      if (contentRev(l) !== contentRev(c) && edited(l) === edited(c)) {
        return JSON.parse(JSON.stringify(preferCloud ? c : l));
      }
      var a = JSON.parse(JSON.stringify(l));
      mergeRequest(a, c);
      return a;
    }
    return { contentRev: contentRev, validSignatures: validSignatures, mergeRequest: mergeRequest, pick: pick };
  })();

  Core.pageCloud = (function () {

    function stampOf(stamps, key) {
      return (stamps && Date.parse(stamps[key] || '')) || 0;
    }

    /* Is this stored value "nothing"? An absent key, an empty list, an empty
       object, or an unreadable value that carries no records. */
    function isEmptyValue(raw) {
      if (raw == null) return true;
      var s = String(raw).trim();
      if (s === '' || s === 'null' || s === 'undefined') return true;
      if (s === '[]' || s === '{}') return true;
      try {
        var v = JSON.parse(s);
        if (v == null) return true;
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === 'object') return Object.keys(v).length === 0;
        return false;                       // a number/string/boolean is content
      } catch (e) {
        return false;                       // unreadable, but not empty — never discard it
      }
    }

    /* Would replacing `from` with `to` throw records away?

       This is the rule that makes a collection unloseable. A timestamp says
       WHEN a value was written, not that it is right: a page that came up
       before its data had loaded, wrote an empty list and stamped it NOW would
       otherwise win every merge and take the Centre's records with it — on this
       device and then, on the next push, in Drive.

       Emptiness is therefore never treated as newer data. Wiping a collection
       has to be recorded deliberately (a tombstone list, an explicit reset),
       which is exactly how deleting a trainee, a payment or a training centre
       already works — those write a record of the deletion, not an empty list. */
    function wouldDiscardRecords(from, to) {
      return !isEmptyValue(from) && isEmptyValue(to);
    }

    /* Write a collection to the store unless doing so would throw records away.

       The same rule as the merge above, applied one step earlier — at the write
       itself — so an empty list never even reaches storage, let alone a stamp
       and an upload. Returns true when written, false when refused.

       Every page persists its collections wholesale ("write out the whole list
       of students"), which is only safe while that list is actually loaded. It
       is not loaded during the moments this guards: before a cloud pull has
       landed, after a failed read, on a device whose store was cleared. */
    function guardedSet(store, key, value, onRefuse) {
      if (!store || !key) return false;
      var next = (typeof value === 'string') ? value : JSON.stringify(value);
      var current = null;
      try { current = store.getItem(key); } catch (e) { current = null; }
      // Nothing readable here YET is not the same as nothing stored: before
      // IndexedDB has been read in, or for a collection that lives in
      // IndexedDB only and has not reached this document, the durable copy
      // is still out there — and an empty write would replace it.
      if (current == null && isEmptyValue(next) && typeof store.mayHoldUnloaded === 'function') {
        var unloaded = false;
        try { unloaded = !!store.mayHoldUnloaded(key); } catch (e) { unloaded = false; }
        if (unloaded) {
          if (typeof onRefuse === 'function') { try { onRefuse(key, null); } catch (e) {} }
          return false;
        }
      }
      if (wouldDiscardRecords(current, next)) {
        if (typeof onRefuse === 'function') { try { onRefuse(key, current); } catch (e) {} }
        return false;
      }
      try { store.setItem(key, next); } catch (e) { return false; }
      return true;
    }

    /* --- Collections of RECORDS, merged record by record -------------------

       WHY THIS EXISTS
       ---------------
       mergeKeys below decides each storage key as ONE value: the newer write
       wins the whole thing. That is right for a setting, and wrong for a list
       of records. In the Offline System every device on the Centre's network
       saves the LMS dashboard's collections to the Centre's own server, and
       with whole-value merging:
         - two trainees submitting an exam within the same half-minute each
           wrote "everything I know + my result"; the second write replaced
           the first and one result was gone everywhere;
         - a trainee signing out trims that device's copy to their own records
           (so a shared PC does not keep everybody's data) — and that trimmed
           list, being the newest write, replaced the Centre's whole roll,
           every exam result and the attendance on the server and then on
           every device that pulled it.

       So these collections are merged the way the online build's Drive merge
       already treats them: by record. A record either side has survives; when
       both sides have it the newer edit wins (the record's own updatedAt /
       lastModified / submittedAt stamp); a record goes away ONLY through a
       tombstone — the same deletion lists the app already writes. A shorter
       list is therefore never a deletion, however new it is.

       A tie (neither copy says which is newer) goes to the side whose copy of
       the whole collection was written more recently — exactly what the old
       whole-value rule did, only now per record — and the loser's blank
       fields are still filled in from it, so nothing typed is dropped.

       Nothing here applies unless a caller asks for it (opts.records), and a
       value that does not parse as the expected list or map falls straight
       back to the whole-value rule, so a key that is not really a record
       collection is never mangled. */
    function lower(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    function byId(r) { return r && r.id != null ? String(r.id) : undefined; }
    var DEMO_STUDENT = /^STU-20260[0-7][0-9]$/;          // the purged demo roll (STU-2026000..079)
    var DEMO_EXAM = /^EXAM-0(0[1-9]|1[0-2])$/;           // and its demo exams (EXAM-001..012)

    // storage key (or prefix) -> how its records are told apart and merged.
    // `tombs` names the dashboard's own tombstone collection (syncCollections()
    // in index.html), so a deletion made on one device travels here too.
    var RECORD_KEYS = [
      { key: 'voctrain_students', type: 'students' },
      { key: 'voctrain_users', type: 'users' },
      // Exam results follow the one result rule every merge uses
      // (Core.sync.mergeExamResults): a marked copy beats an unmarked one,
      // then the later edit — not the later submission, which marking never
      // changes. Deletions are the dashboard's 'examResults' tombstones.
      { key: 'voctrain_examResults', type: 'examResults', studentField: 'studentId', tombs: 'examResults',
        id: function (r) { return Core.sync.examResultKey(r); },
        accept: function (r) { return !DEMO_EXAM.test(String(r.examId || '')) && !DEMO_STUDENT.test(String(r.studentId || '')); } },
      // Attempts in progress, so a trainee can carry on at another PC: merged
      // question by question (Core.exams.mergeAttemptLists). A trainee's
      // device may publish them (a record key passes the author policy).
      { key: 'voctrain_examAttempts', type: 'examAttempts', studentField: 'studentId', id: byId },
      // The invigilator's register of each sitting (Core.invigilation): by
      // register; its notes and sign-offs entry by entry.
      { key: 'voctrain_examRegisters', type: 'list', tombs: 'examRegisters', id: byId, maps: 'examRegisters' },
      // The dated register: merged mark by mark with the register's own rule
      // (a real mark beats an upgrade estimate; newest mark wins; history kept).
      // Listed before the prefix below, which would otherwise claim it.
      { key: 'voctrain_attendanceRegister', type: 'attendanceRegister', studentField: 'studentId' },
      // The old weekly register, and every quarter's bucket of it (voctrain_attendance::<FY>_Q<n>).
      { prefix: 'voctrain_attendance', type: 'list', studentField: 'studentId',
        id: function (r) { return lower(r.studentId) + '|' + lower(r.date); },
        stamps: ['updatedAt', 'markedAt'],
        accept: function (r) { return !DEMO_STUDENT.test(String(r.studentId || '')); } },
      { key: 'voctrain_certDownloadApprovals', type: 'approvals' },
      // Certificate / transcript requests: each request is its own record, so
      // one office marking REQ-1 Ready and another marking REQ-2 Collected
      // both stand, instead of the later whole list undoing the other. Merged
      // by request on EVERY path (`always`), Drive included and whether or not
      // the caller asked for record merging: trainees append on their own
      // devices while the administration changes statuses on another, and a
      // trainee's device keeps only its own requests after sign-out — one
      // whole list winning would erase the other side's requests or decisions.
      { key: 'voctrain_certTranscriptRequests', type: 'list', studentField: 'studentId', id: byId,
        stamps: ['updatedAt', 'handledAt', 'requestedAt'], always: true },
      { key: 'voctrain_skillAreas', type: 'centres' },
      { key: 'voctrain_vcSessions', type: 'vcSessions' },
      { key: 'voctrain_syncTombstones', type: 'tombstones' },
      { key: 'voctrain_chatMessages', type: 'rooms' },
      // Exams and calendar events by id, as the dashboard keys them — by
      // title, two different exams (or two events on one day) with the same
      // title were folded into one here.
      { key: 'voctrain_exams', type: 'list', tombs: 'exams',
        id: function (r) { return Core.exams.syncKey(r); },
        accept: function (r) { return !DEMO_EXAM.test(String(r.id || '')); } },
      { key: 'voctrain_announcements', type: 'list', tombs: 'announcements',
        id: function (r) { return r.id != null ? String(r.id) : 'title:' + lower(r.title); } },
      { key: 'voctrain_calendarEvents', type: 'list', tombs: 'calendarEvents',
        id: function (r) { return Core.calendarEventKey(r); } },
      // The transcript pages' records. Each manual grade, unit catalogue and
      // request is its own record: two offices grading two trainees used to
      // write two whole lists, and the later one erased the other's grade.
      // Removing a manual grade is a record too (Transcript.removeManualGrade).
      { key: 'voctrain_transcriptGrades', type: 'list', id: byId, stamps: ['updatedAt'] },
      { key: 'voctrain_unitCatalogs', type: 'list', id: byId, stamps: ['updatedAt'] },
      { key: 'voctrain_transcriptProfiles', type: 'map', stamps: ['updatedAt', 'lastModified'] },
      // The virement register: per request; a decision beats "Pending"; a
      // request deleted on the Virement page stays deleted (its own list).
      { key: 'cesti_virements', type: 'virements', id: byId, idListTomb: 'cesti_virement_deleted_ids' },
      // The CMC Board's minute book { virementId: ruling }: per ruling, the
      // later ruling, countersignature or withdrawal wins.
      { key: 'cestis_cmc_rulings', type: 'map', stamps: ['counterAt', 'at', 'withdrawnAt'], whole: true },
      { key: 'voctrain_driveResources', type: 'list', tombs: 'driveResources',
        id: function (r) { return r.driveFileId ? 'drive:' + r.driveFileId : byId(r); } },
      { key: 'voctrain_chatRooms', type: 'list', tombs: 'chatRooms', id: byId },
      { key: 'voctrain_classSessions', type: 'list', tombs: 'classSessions', id: byId },
      { key: 'voctrain_adminMeetings', type: 'list', tombs: 'adminMeetings', id: byId },
      // An assignment carries every trainee's grade inside it: the grades, and
      // who has read a notice, merge entry by entry (Core.sync.RECORD_MAPS —
      // the same rule as the Drive backup), not as one whole record.
      { key: 'voctrain_assignments', type: 'list', tombs: 'instructorAssignments', id: byId, maps: 'assignments' },
      { key: 'voctrain_submissions', type: 'list', tombs: 'assignmentSubmissions', id: byId },
      { key: 'voctrain_resources', type: 'list', tombs: 'instructorResources', id: byId },
      { key: 'voctrain_instructorData', type: 'list', tombs: 'instructorData', id: byId },
      { key: 'voctrain_adrTasks', type: 'list', tombs: 'adrTasks', id: byId },
      { key: 'voctrain_support_messages', type: 'list', tombs: 'supportMessages', id: byId },
      { key: 'voctrain_notifications', type: 'list', tombs: 'notifications', id: byId, maps: 'notifications' },
      { key: 'voctrain_documentHubFiles', type: 'list', tombs: 'documentHubFiles', id: byId },
      { key: 'voctrain_studentProfiles', type: 'map', tombs: 'studentProfiles' },
      { key: 'voctrain_instructorProfiles', type: 'map', tombs: 'instructorProfiles' },
      { key: 'voctrain_adrStaffMeta', type: 'map', tombs: 'adrStaffMeta' },
      { key: 'voctrain_certTemplates', type: 'map', tombs: 'certTemplates' },
      { key: 'voctrain_chatProfiles', type: 'map' },
      // The School Fee roll, trainee by trainee. Its whole list used to be one
      // value, newest write wins — so a new PC whose dashboard had just made a
      // placeholder for every trainee (dated now) kept its placeholders over the
      // Centre's priced, detailed records. A placeholder never outranks a real
      // record (Core.feeRecordRank); a trainee deleted on the fee page (its
      // cestiSchoolFeeDeletedLmsIds list, which travels in the same file) is not
      // brought back by the other side's copy.
      { key: 'cestiSchoolFeeStudents', type: 'feeStudents', id: byId, stamps: ['updatedAt'],
        rank: function (r) { return Core.feeRecordRank(r); }, rankDrop: Core.FEE_PLACEHOLDER_FIELDS }
    ];

    function recordSpec(key) {
      if (!key) return null;
      key = String(key);
      for (var i = 0; i < RECORD_KEYS.length; i++) {
        var s = RECORD_KEYS[i];
        if (s.key === key) return s;
        // 'voctrain_attendance_quartered' is a one-off marker ('1'), not a
        // bucket; it fails the list parse below and keeps the whole-value rule.
        if (s.prefix && key.indexOf(s.prefix) === 0) return s;
      }
      return null;
    }
    /* Is this key merged record by record? */
    function isRecordKey(key) { return !!recordSpec(key); }
    /* ...even when the caller did not ask for record merging (opts.records)? */
    function isAlwaysRecordKey(key) { var sp = recordSpec(key); return !!(sp && sp.always); }

    /* The collections the Google Drive page files merge record by record.
       (On the Centre's own server every registered collection is; on Drive
       the LMS dashboard's collections have their own record merge in its
       backup, so only the pages whose whole list was their only path are
       switched over.) Two offices grading, handling requests or ruling at
       once each wrote their whole list, and the later upload erased the
       other's work. */
    var DRIVE_RECORD_KEYS = ['voctrain_transcriptGrades', 'voctrain_unitCatalogs', 'voctrain_transcriptProfiles',
      'voctrain_certTranscriptRequests', 'cesti_virements', 'cestis_cmc_rulings', 'cestiSchoolFeeStudents'];

    function parseJson(raw) { try { return JSON.parse(raw); } catch (e) { return undefined; } }
    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function newestOf(r, fields) {
      var best = 0;
      (fields || ['updatedAt', 'lastModified']).forEach(function (f) {
        var t = Date.parse((r && r[f]) || '');
        if (!isNaN(t) && t > best) best = t;
      });
      return best;
    }
    /* Fill the winner's blank fields from the loser: a tie must never drop
       something that was typed on one side only. */
    function fillFrom(winner, loser) {
      var out = {};
      Object.keys(winner).forEach(function (f) { out[f] = winner[f]; });
      Object.keys(loser || {}).forEach(function (f) {
        var w = out[f];
        if (f === '_plaintextPw') return;
        if ((w === undefined || w === null || w === '') && loser[f] !== undefined && loser[f] !== null && loser[f] !== '') out[f] = loser[f];
      });
      return out;
    }

    /* Which tombstones apply, read from BOTH sides being merged — a deletion
       either device has written down stands. */
    function tombContext(localData, cloudData) {
      var ids = function (k) {
        var set = {};
        [localData[k], cloudData[k]].forEach(function (raw) {
          Core._parseArr(raw).forEach(function (id) { if (id != null && id !== '') set[String(id)] = true; });
        });
        return set;
      };
      var sync = {};
      [localData.voctrain_syncTombstones, cloudData.voctrain_syncTombstones].forEach(function (raw) {
        var t = parseJson(raw || 'null');
        if (!isObj(t)) return;
        Object.keys(t).forEach(function (col) {
          if (isObj(t[col])) sync[col] = Core.sync.mergeTombstones(sync[col] || {}, t[col]);
        });
      });
      var at = parseJson(Core.unionTombstoneValues(localData[Core.DELETED_AT_KEY] || '{}', cloudData[Core.DELETED_AT_KEY] || '{}') ||
        localData[Core.DELETED_AT_KEY] || '{}');
      return { students: ids('voctrain_deletedStudentIds'), users: ids('voctrain_deletedUserIds'),
               centres: ids('voctrain_deletedCentreIds'), sync: sync, studentsAt: isObj(at) ? at : {}, ids: ids };
    }
    /* Does this record belong to a deleted trainee? Not when it was written
       after the deletion by a trainee enrolled again since (a re-enrolment
       keeps the same id — see Core.isStudentTombstoned). */
    function ownerDeleted(ctx, id, r) {
      if (id == null || !ctx.students[String(id)]) return false;
      var t = Date.parse((ctx.studentsAt || {})[String(id)] || '') || 0;
      if (!t) return true;
      return newestOf(r, ['updatedAt', 'submittedAt', 'markedAt', 'requestedAt']) <= t;
    }

    /* Union two lists of records by identity, IN THIS DEVICE'S ORDER: the
       local records first as they stand, then what only the other side has.
       (Keeping one order whichever side is newer stops a list flipping order
       on every sync, which would rewrite and re-upload it each time.)
       pick(localRecord, cloudRecord) decides a record both sides hold.
       Duplicate identities on one side are kept as duplicates rather than
       folded, so the merge itself can never shrink a list. */
    function unionList(local, cloud, idOf, pick, keep) {
      var out = [], slots = {}, used = {}, i;
      for (i = 0; i < local.length; i++) {
        var l = local[i];
        if (!l || typeof l !== 'object' || !keep(l)) continue;
        out.push(l);
        var lid = idOf(l);
        if (lid !== undefined && lid !== null) (slots[lid] = slots[lid] || []).push(out.length - 1);
      }
      for (i = 0; i < cloud.length; i++) {
        var c = cloud[i];
        if (!c || typeof c !== 'object' || !keep(c)) continue;
        var id = idOf(c);
        var list = (id !== undefined && id !== null) ? slots[id] : null;
        var n = list ? (used[id] || 0) : 0;
        if (list && n < list.length) {
          used[id] = n + 1;
          out[list[n]] = pick(out[list[n]], c);
        } else {
          out.push(c);
        }
      }
      return out;
    }

    /* Merge one record collection. `preferCloud` says which side wins a tie.
       Returns the merged value as a string, or null when the values are not
       the shape this key is registered as (the caller then uses the
       whole-value rule). */
    function mergeRecordValue(key, localRaw, cloudRaw, preferCloud, ctx) {
      var spec = recordSpec(key);
      if (!spec) return null;
      var L = parseJson(localRaw), C = parseJson(cloudRaw);
      var wantMap = spec.type === 'map' || spec.type === 'tombstones' || spec.type === 'rooms';
      if (wantMap ? !(isObj(L) && isObj(C)) : !(Array.isArray(L) && Array.isArray(C))) return null;
      ctx = ctx || { students: {}, users: {}, centres: {}, sync: {} };
      var tombs = spec.tombs ? (ctx.sync[spec.tombs] || {}) : {};
      var out;
      // Two copies of one record, dated by `fields`: the newer wins; on a tie
      // the side that wrote the collection last; and the winner's blanks are
      // filled from the loser either way.
      var newer = function (l, c, fields) {
        // A copy of a higher rank wins whatever the dates say (spec.rank — a
        // placeholder never beats a real record); it takes only the loser's
        // fields it lacks, minus spec.rankDrop.
        if (spec.rank) {
          var rl = spec.rank(l), rc = spec.rank(c);
          if (rl !== rc) {
            var top = rc > rl ? c : l, low = rc > rl ? l : c, keepLow = {};
            Object.keys(low).forEach(function (f) { if (!spec.rankDrop || spec.rankDrop.indexOf(f) === -1) keepLow[f] = low[f]; });
            return fillFrom(top, keepLow);
          }
        }
        var tl = newestOf(l, fields), tc = newestOf(c, fields);
        var cloudWins = (tc > tl || (tc === tl && preferCloud));
        // A record that must be taken whole (a withdrawn ruling is an entry
        // with NO decision — filling the blank would put the ruling back).
        if (spec.whole) return cloudWins ? c : l;
        var won = cloudWins ? fillFrom(c, l) : fillFrom(l, c);
        // Maps inside the record that several people write (an assignment's
        // grades, a notice's readers) are then settled entry by entry, by the
        // one rule every path uses — the copy that won the record decides
        // only the entries neither side dated. Without this a trainee's
        // resubmission, or a second instructor's mark, carried a stale grades
        // map that erased a mark on the Centre's server and every device.
        var rule = spec.maps && Core.sync.RECORD_MAPS[spec.maps];
        if (rule) Core.sync.reconcileMaps(won, l, c, rule, cloudWins);
        return won;
      };

      if (spec.type === 'tombstones') {
        out = {};
        Object.keys(L).forEach(function (col) { out[col] = isObj(L[col]) ? Core.sync.mergeTombstones({}, L[col]) : L[col]; });
        Object.keys(C).forEach(function (col) {
          if (isObj(C[col]) && isObj(out[col])) out[col] = Core.sync.mergeTombstones(out[col], C[col]);
          else if (out[col] === undefined) out[col] = C[col];
        });
        return JSON.stringify(out);
      }

      if (spec.type === 'rooms') {
        // { roomId: [message, ...] } — every message either side has, by id,
        // in time order.
        out = {};
        Object.keys(L).concat(Object.keys(C)).forEach(function (room) {
          if (out[room]) return;
          var a = L[room], b = C[room];
          if (!Array.isArray(a) || !Array.isArray(b)) { out[room] = a !== undefined ? a : b; return; }
          // The chat's own rule: the later edit, a deletion always, every
          // reader and every voter kept (Core.chatSync).
          var merged = Core.chatSync.mergeRoom(a, b).list;
          merged.sort(function (x, y) { return (Date.parse(x && x.timestamp) || 0) - (Date.parse(y && y.timestamp) || 0); });
          out[room] = merged;
        });
        return JSON.stringify(out);
      }

      if (spec.type === 'map') {
        out = {};
        Object.keys(L).concat(Object.keys(C).filter(function (k) { return !(k in L); })).forEach(function (k) {
          var a = L[k], b = C[k];
          var cand;
          if (a === undefined) cand = b;
          else if (b === undefined) cand = a;
          else if (isObj(a) && isObj(b)) cand = newer(a, b, spec.stamps);
          else cand = preferCloud ? b : a;
          if (isObj(cand) && Core.sync.deletedAfter(tombs, k, cand)) return;
          out[k] = cand;
        });
        return JSON.stringify(out);
      }

      if (spec.type === 'examResults') {
        // Both copies of one attempt, decided by the result rule; a re-sit
        // under a new id is a record of its own and both are kept.
        out = unionList(L, C, spec.id, function (l, c) {
          var a = [JSON.parse(JSON.stringify(l))];
          Core.sync.mergeExamResults(a, [c], {});
          return a[0];
        }, function (r) {
          if (spec.accept && !spec.accept(r)) return false;
          if (ownerDeleted(ctx, r[spec.studentField], r)) return false;
          if (Core.sync.deletedAfter(tombs, spec.id(r), r)) return false;
          return true;
        });
        // Two submissions of one travelling attempt (a PC that was away sent
        // its own copy): the first stands, as on every other path.
        Core.exams.oneResultPerAttempt(out);
        return JSON.stringify(out);
      }

      if (spec.type === 'examAttempts') {
        // Attempts in progress: question by question, newest answer wins; a
        // submitted (retired) record beats any open copy (Core.exams).
        var keepA = function (r) { return !ownerDeleted(ctx, r[spec.studentField], r); };
        out = Core.exams.mergeAttemptLists(L.filter(keepA), C.filter(keepA)).list;
        return JSON.stringify(out);
      }

      if (spec.type === 'virements') {
        var deletedReq = spec.idListTomb ? ctx.ids(spec.idListTomb) : {};
        out = unionList(L, C, spec.id, function (l, c) {
          // The Virement page's own rule (Core.virements): two different
          // versions of a request — the one edited later wins whole; only
          // copies asking for the same thing exchange rulings, where a
          // decision beats Pending. An edited approved request is Pending
          // again with a newer editedAt, and must not be undone by the old
          // Approved copy.
          return Core.virements.pick(l, c, preferCloud);
        }, function (r) { return !(r.id != null && deletedReq[String(r.id)]); });
        return JSON.stringify(out);
      }

      if (spec.type === 'students') {
        var dead = ctx.students;
        var live = function (r) {
          if (DEMO_STUDENT.test(String(r.id || ''))) return false;
          return Core.dropTombstonedStudents([r], dead, ctx.studentsAt || {}).removed === 0;
        };
        // One person is one record however their id was minted: the app moves
        // trainees onto deterministic ids (Core.stableStudentId), so the same
        // person can arrive under an old id and a new one. Paired by id, else
        // by name + programme (the online merge's rule), never across a
        // "keep separate" marker; the pair keeps the stable id.
        var natural = function (r) { return r.keepSeparate ? null : (Core.naturalKey(r) || null); };
        var pair = function (l, c) {
          // mergeStudentRecords keeps the newer lastModified and fills blanks;
          // on a tie its first argument stands, so the tie-winner goes first.
          var m = preferCloud ? Core.mergeStudentRecords(c, l) : Core.mergeStudentRecords(l, c);
          var stable = Core.stableStudentId(m);
          if (stable && (l.id === stable || c.id === stable)) m.id = stable;
          return m;
        };
        out = [];
        var slotById = {}, slotByName = {};
        L.forEach(function (l) {
          if (!l || typeof l !== 'object' || !live(l)) return;
          out.push(l);
          if (l.id != null && slotById[String(l.id)] === undefined) slotById[String(l.id)] = out.length - 1;
          var nk = natural(l);
          if (nk && slotByName[nk] === undefined) slotByName[nk] = out.length - 1;
        });
        C.forEach(function (c) {
          if (!c || typeof c !== 'object' || !live(c)) return;
          var at = (c.id != null) ? slotById[String(c.id)] : undefined;
          if (at === undefined) {
            var nk = natural(c);
            if (nk && slotByName[nk] !== undefined && natural(out[slotByName[nk]]) === nk) at = slotByName[nk];
          }
          // Several copies of one person on the other side all fold into the
          // one record here.
          if (at !== undefined) { out[at] = pair(out[at], c); return; }
          out.push(c);
          if (c.id != null && slotById[String(c.id)] === undefined) slotById[String(c.id)] = out.length - 1;
          var nk2 = natural(c);
          if (nk2 && slotByName[nk2] === undefined) slotByName[nk2] = out.length - 1;
        });
        return JSON.stringify(out);
      }

      if (spec.type === 'users') {
        var gone = ctx.users;
        out = unionList(L, C, byId, function (l, c) {
          // cloudCopyWins is the one rule every account merge follows: the
          // newer edit, and a real password is never replaced by a default.
          var w = Core.accountAccess.cloudCopyWins(l, c) ? c : l;
          var other = w === c ? l : c;
          var merged = fillFrom(w, other);
          delete merged._plaintextPw;
          // The seed marker describes a password — the winner's — and travels
          // with it, as on every other account merge. Filled in from the older
          // copy, a password somebody had just set went on saying "still the
          // published default": the Centre's server then refused that
          // administrator a host ticket, and every device read the account as
          // a seed.
          if (w.password && other && other.password !== w.password) {
            ['defaultPassword', 'mustChangePassword'].forEach(function (f) {
              if (w[f] === undefined || w[f] === null || w[f] === '') delete merged[f];
            });
          }
          return merged;
        }, function (r) { return !(r.id != null && gone[String(r.id)]); });
        return JSON.stringify(out);
      }

      if (spec.type === 'approvals') {
        out = unionList(L, C, function (r) { return r.studentId != null ? String(r.studentId) : undefined; },
          function (l, c) {
            // An approval beats no approval, then the newer; a tie stays with
            // the tie-winner (bestApproval keeps its first argument).
            return preferCloud ? Core.cloudMerge.bestApproval(c, l) : Core.cloudMerge.bestApproval(l, c);
          },
          function (r) { return !(r.studentId != null && ctx.students[String(r.studentId)]); });
        return JSON.stringify(out);
      }

      if (spec.type === 'centres') {
        // applySkillAreas lets the list it is GIVEN win a centre's name and
        // description, so the tie-winner is the one applied onto the other;
        // the result keeps this device's order.
        var deadCentre = function (id) { return !!ctx.centres[String(id)]; };
        var alive = function (list) { return JSON.parse(JSON.stringify(list)).filter(function (c) { return !(c && deadCentre(c.id)); }); };
        var base = alive(preferCloud ? L : C);
        Core.cloudMerge.applySkillAreas(base, preferCloud ? C : L, deadCentre);
        var byCentre = {};
        base.forEach(function (c) { if (c && c.id != null) byCentre[String(c.id)] = c; });
        out = [];
        L.concat(C).forEach(function (c) {
          var id = c && c.id != null ? String(c.id) : null;
          if (id !== null && byCentre[id]) { out.push(byCentre[id]); delete byCentre[id]; }
        });
        base.forEach(function (c) { if (!c || c.id == null || byCentre[String(c.id)]) out.push(c); });
        return JSON.stringify(out);
      }

      if (spec.type === 'vcSessions') {
        return JSON.stringify(Core.vcSessions.mergeSessions(L, C));
      }

      if (spec.type === 'attendanceRegister') {
        return JSON.stringify(Core.attendance.mergeRegister(L, C, { accept: function (r) {
          return !(r && r.studentId != null && ctx.students[String(r.studentId)]);
        } }).register);
      }

      if (spec.type === 'feeStudents') {
        // The fee page's own deletion list (ids and their LMS links), from both
        // sides, as dropTombstonedFeeStudents reads it on the page.
        var feeGone = ctx.ids ? ctx.ids('cestiSchoolFeeDeletedLmsIds') : {};
        var feeLive = function (r) {
          return !(feeGone[String(r.id)] || (r.lmsId && feeGone[String(r.lmsId)]) || feeGone['SF-' + r.id]);
        };
        out = unionList(L, C, spec.id, function (l, c) { return newer(l, c, spec.stamps); }, feeLive);
        // A sweep that would leave no trainee at all is a fault, not a
        // deletion (the page refuses the same sweep): keep the roll as it is.
        if (!out.length && (L.length || C.length)) return null;
        return JSON.stringify(out);
      }

      // A plain list of records.
      out = unionList(L, C, spec.id, function (l, c) { return newer(l, c, spec.stamps); }, function (r) {
        if (spec.accept && !spec.accept(r)) return false;
        if (spec.studentField && ownerDeleted(ctx, r[spec.studentField], r)) return false;
        if (spec.tombs && Core.sync.deletedAfter(tombs, spec.id(r), r)) return false;
        return true;
      });
      return JSON.stringify(out);
    }

    /* Merge a cloud backup into this device's copy.
         localData/cloudData   - { storageKey: rawStringValue }
         localStamps/cloudStamps - { storageKey: ISO time last written }
       opts.firstSync - this device has never synced this file (see below)
       opts.records   - merge the registered record collections record by
                        record (RECORD_KEYS above) instead of as one value
       opts.symmetric - the copies are peers rather than "this device" and "the
                        cloud": the strictly newer stamp wins, and a value with
                        no stamp is simply the older one. The Centre's own
                        server merges every incoming save into what it holds
                        this way.
       Returns the union plus the keys whose local value must be rewritten. */
    function mergeKeys(localData, localStamps, cloudData, cloudStamps, opts) {
      localData = localData || {}; cloudData = cloudData || {};
      opts = opts || {};
      var data = {}, stamps = {}, changed = [], rescued = [], k, ctx = null;

      for (k in localData) {
        if (!Object.prototype.hasOwnProperty.call(localData, k)) continue;
        data[k] = localData[k];
        if (localStamps && localStamps[k]) stamps[k] = localStamps[k];
      }
      for (k in cloudData) {
        if (!Object.prototype.hasOwnProperty.call(cloudData, k)) continue;
        var haveLocal = Object.prototype.hasOwnProperty.call(localData, k);
        if (!haveLocal) {
          // Only the cloud has it — another device's work.
          data[k] = cloudData[k];
          if (cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
          changed.push(k);
          continue;
        }
        if (localData[k] === cloudData[k]) {              // identical, nothing to do —
          // except keep the newer of the two stamps. Dropping the cloud's stamp
          // here left the key UNSTAMPED in what this device pushed next, and a
          // new device's first sync only adopts a stamped value — so it kept
          // its own start-up defaults (three built-in logins instead of the
          // Centre's accounts) and pushed those.
          var ils = stampOf(localStamps, k), ics = stampOf(cloudStamps, k);
          if (ics > ils && cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
          continue;
        }

        /* A list of DELETIONS is merged by union, never by whose write is
           newer. It only ever grows, so both sides are always right, and one
           whole list replacing the other is a deletion being undone.

           That is exactly how a deleted training centre came back. Two devices
           each delete a centre; each now holds a tombstone list the other has
           never seen. Judged as ordinary data, the newer list wins outright and
           the older one's deletion is simply gone — the centre is still in the
           roster, nothing says it was deleted any more, so it reappears with
           its chat room and its place in every course list, on every device, at
           the next sync. Unioned, neither delete can be lost. */
        if (Core.isTombstoneKey(k)) {
          var union = Core.unionTombstoneValues(localData[k], cloudData[k]);
          if (union != null) { data[k] = union; changed.push(k); }
          // The union is now the newest thing either side has said about this
          // key, so it carries the later stamp and goes up on the next push.
          var lts = stampOf(localStamps, k), cts = stampOf(cloudStamps, k);
          if (cts > lts && cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
          continue;
        }

        // An empty local copy NEVER replaces records, however new its stamp
        // looks. This is the guard that keeps a collection unloseable: a page
        // that came up before its data had loaded, wrote an empty list and
        // stamped it now would otherwise win here and take the records with it.
        if (wouldDiscardRecords(cloudData[k], localData[k])) {
          data[k] = cloudData[k];
          if (cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
          changed.push(k);
          rescued.push(k);
          continue;
        }
        // And the same in reverse: an empty cloud copy never wipes what this
        // device still holds, so one bad upload cannot take everyone down.
        if (wouldDiscardRecords(localData[k], cloudData[k])) {
          rescued.push(k);
          continue;
        }

        var lt = stampOf(localStamps, k), ct = stampOf(cloudStamps, k);
        // A collection registered to merge by record on every path (`always`)
        // is a union even on a first sync: a device's own unsent records are
        // never replaced by the cloud's list, and the cloud's never by its.
        if (isAlwaysRecordKey(k)) {
          if (!ctx) ctx = tombContext(localData, cloudData);
          var mergedAlways = mergeRecordValue(k, localData[k], cloudData[k], ct > lt, ctx);
          if (mergedAlways != null) {
            if (mergedAlways !== localData[k]) { data[k] = mergedAlways; changed.push(k); }
            if (ct > lt && cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
            continue;
          }
        }
        // The cloud only wins when BOTH sides can be dated and it is the newer
        // of the two. Local data with no stamp predates this backup existing;
        // its age cannot be established, so it is never overwritten — it stands
        // and gets pushed (and stamped) on the next save. Anything else would
        // let a first sync quietly replace work nobody could date.
        //
        // The exception is a device syncing this page for the FIRST time
        // (opts.firstSync). It has no history of its own, so whatever it holds
        // is either empty or the page's own start-up defaults — and those must
        // not beat the Centre's real data. Without this, opening a page on a
        // new machine kept its blank template and pushed that up.
        if (opts.firstSync && ct > 0) {
          data[k] = cloudData[k];
          stamps[k] = cloudStamps[k];
          changed.push(k);
          continue;
        }
        // A collection of records: neither copy replaces the other — see
        // RECORD_KEYS above. The union carries the newer of the two stamps.
        // opts.records: true for every registered collection, or a list of
        // the keys to treat so (the Drive paths opt in key by key).
        if (opts.records && isRecordKey(k) && (opts.records === true || (Array.isArray(opts.records) && opts.records.indexOf(k) !== -1))) {
          if (!ctx) ctx = tombContext(localData, cloudData);
          var merged = mergeRecordValue(k, localData[k], cloudData[k], ct > lt, ctx);
          if (merged != null) {
            if (merged !== localData[k]) { data[k] = merged; changed.push(k); }
            if (ct > lt && cloudStamps && cloudStamps[k]) stamps[k] = cloudStamps[k];
            continue;
          }
        }
        if (opts.symmetric) {
          if (ct > lt) {
            data[k] = cloudData[k];
            stamps[k] = cloudStamps[k];
            changed.push(k);
          }
          continue;
        }
        if (lt > 0 && ct > lt) {
          data[k] = cloudData[k];
          stamps[k] = cloudStamps[k];
          changed.push(k);
        }
      }
      // `rescued` names the keys where one side was empty and the records won
      // anyway — worth surfacing, because it means a device tried to sync a
      // collection away and was stopped.
      return { data: data, stamps: stamps, changed: changed, rescued: rescued };
    }

    /* --- Shared collections, and which backup file carries them ------------

       Some collections belong to one page but are READ by several: the trainee
       roll, the training centres and their tombstones, the fee roll. A page
       backs up only the keys it OWNS, so a page that merely reads a shared
       collection never fetched it from Drive at all — it rendered whatever
       happened to be in this device's local storage. On a machine that had not
       opened the owning page, that meant stale data or none, and the page then
       wrote its own view back over everyone else's.

       This registry says where each shared collection actually lives, so any
       page can pull the current copy from Drive when it syncs. A reader pulls
       and merges; it never pushes a key it does not own, so it cannot overwrite
       the owning page's data. */
    var SHARED_SOURCES = [
      {
        file: 'CESTIS_Student_Progress.json',
        page: 'Student Progress',
        keys: ['voctrain_students', 'voctrain_skillAreas', 'voctrain_studentProfiles',
               'voctrain_instructorData', 'voctrain_attendance', 'voctrain_examResults',
               'voctrain_certDownloadApprovals', 'voctrain_deletedStudentIds',
               'voctrain_deletedCentreIds', 'voctrain_deletedStudentAt']
      },
      {
        file: 'CESTIS_School_Fees.json',
        page: 'School Fee Management',
        keys: ['cestiFeeStructure', 'cestiSchoolFeeStudents', 'cestiSchoolFeePayments',
               'cestiSchoolFeeDocuments', 'cestiSchoolFeeDeletedLmsIds',
               'cestiSchoolFeeDeletedPaymentIds']
      },
      {
        file: 'CESTIS_Transcript_Grades.json',
        page: 'Transcript / Grades',
        keys: ['voctrain_transcriptGrades', 'voctrain_unitCatalogs', 'voctrain_transcriptProfiles']
      },
      {
        file: 'CESTIS_Transcript_Requests.json',
        page: 'Certificate / Transcript Requests',
        keys: ['voctrain_certTranscriptRequests']
      },
      /* The operating books. The CMC Board oversees these but operates none of
         them, so its dashboards are pure readers — and a reader that is not in
         this registry has nowhere to pull from, which is why those dashboards
         used to sit empty behind a "Sync Drive Data" button. The Cashbook's
         quarters are generated key names (cestis_quarter_<FY>_Q<n>), so they
         are listed by prefix. */
      {
        file: 'CESTIS_Cashbook.json',
        page: 'Cashbook',
        keys: ['cesti_cashbook_data', 'cestis_active_quarter'],
        prefixes: ['cestis_quarter_', 'cestis_budget_']
      },
      {
        file: 'CESTIS_Staff_Payslips.json',
        page: 'Staff Payslips',
        keys: ['cestisPayroll']
      },
      {
        file: 'CESTIS_Staff_TimeClock.json',
        page: 'Staff Time Clock',
        keys: ['cestisStaffMembers', 'cestisTimeRecords']
      },
      {
        file: 'CESTIS_Virement_Requests.json',
        page: 'Virement Requests',
        keys: ['cesti_virements', 'cesti_virement_deleted_ids']
      }
    ];

    function sharedSources() { return SHARED_SOURCES; }

    /* A collection whose key names are GENERATED — the Cashbook's quarters are
       `cestis_quarter_<FY>_Q<n>` — cannot be asked for by name, because a
       reader does not know which quarters exist until it has the file. Such a
       collection is read by writing the declared prefix with a trailing star:
       `reads: ['cestis_quarter_*']`. Everything else is an exact key, exactly
       as before. */
    function starPrefix(entry) {
      var s = String(entry == null ? '' : entry);
      return s.charAt(s.length - 1) === '*' ? s.slice(0, -1) : null;
    }
    function sourceClaims(src, entry) {
      var pfx = starPrefix(entry);
      if (pfx) return (src.prefixes || []).indexOf(pfx) !== -1;
      if (src.keys.indexOf(entry) !== -1) return true;
      var list = src.prefixes || [];
      for (var i = 0; i < list.length; i++) if (String(entry).indexOf(list[i]) === 0) return true;
      return false;
    }

    /* Is this key one several pages depend on? */
    function isShared(key) {
      for (var i = 0; i < SHARED_SOURCES.length; i++) {
        if (sourceClaims(SHARED_SOURCES[i], key)) return true;
      }
      return false;
    }

    /* The file that carries a shared key, or null if nothing claims it. */
    function sourceOf(key) {
      for (var i = 0; i < SHARED_SOURCES.length; i++) {
        if (sourceClaims(SHARED_SOURCES[i], key)) return SHARED_SOURCES[i];
      }
      return null;
    }

    /* Which files a page must pull to have current copies of `keys`, and which
       of those keys each file supplies. `ownFile` is the page's own backup — it
       is already pulled in the normal way, so it is never listed again.

       Returns [{ file, page, keys: [...] }], one entry per file, in registry
       order. Keys nothing claims are simply not fetched: they are page-local. */
    function sharedPullPlan(keys, ownFile) {
      var wanted = Array.isArray(keys) ? keys : [];
      var plan = [], byFile = {};
      wanted.forEach(function (k) {
        var src = sourceOf(k);
        if (!src || src.file === ownFile) return;
        if (!byFile[src.file]) {
          byFile[src.file] = { file: src.file, page: src.page, keys: [] };
          plan.push(byFile[src.file]);
        }
        if (byFile[src.file].keys.indexOf(k) === -1) byFile[src.file].keys.push(k);
      });
      return plan;
    }

    /* Take just the shared keys a reader asked for out of a pulled payload.
       Everything else in that file belongs to the owning page and is left
       alone — a reader adopts what it reads, never the whole file. */
    function pickShared(payloadData, keys) {
      var out = {}, wanted = Array.isArray(keys) ? keys : [];
      if (!payloadData) return out;
      wanted.forEach(function (k) {
        var pfx = starPrefix(k);
        if (pfx) {
          // A generated-name collection: take every key the file carries under
          // this prefix, since the reader cannot know their names in advance.
          Object.keys(payloadData).forEach(function (pk) { if (pk.indexOf(pfx) === 0) out[pk] = payloadData[pk]; });
          return;
        }
        if (Object.prototype.hasOwnProperty.call(payloadData, k)) out[k] = payloadData[k];
      });
      return out;
    }

    /* Does a storage key belong to this page's backup? Pages declare exact key
       names and/or prefixes (the Cashbook's quarters are `cestis_quarter_<FY>_Q<n>`,
       so they can only be described as a prefix). */
    function ownsKey(spec, key) {
      if (!spec || !key) return false;
      var i;
      // `all: true` claims the WHOLE store — every key a page has ever written,
      // including ones no page thought to declare. This is how the offline build
      // matches what Google Drive does for the online one: the master snapshot
      // there sweeps everything, so nothing depends on somebody having
      // remembered to list it. `exclude` / `excludePrefixes` carve out the few
      // things that must stay on the device they were written on — access
      // tokens, which are per-machine and secret, and local display choices.
      if (spec.all) {
        var ex = spec.exclude || [], exp = spec.excludePrefixes || [];
        for (i = 0; i < ex.length; i++) if (ex[i] === key) return false;
        for (i = 0; i < exp.length; i++) if (key.indexOf(exp[i]) === 0) return false;
        return true;
      }
      var keys = spec.keys || [], prefixes = spec.prefixes || [];
      for (i = 0; i < keys.length; i++) if (keys[i] === key) return true;
      for (i = 0; i < prefixes.length; i++) if (key.indexOf(prefixes[i]) === 0) return true;
      return false;
    }

    /* The subset of a storage map this page is responsible for. */
    function collect(spec, storeMap) {
      var out = {};
      Object.keys(storeMap || {}).forEach(function (k) {
        if (ownsKey(spec, k)) out[k] = storeMap[k];
      });
      return out;
    }

    /* The backup file a page writes. Kept small and explicit so a person
       looking in Drive can tell which page produced it and when. */
    function buildPayload(spec, data, stamps, meta) {
      meta = meta || {};
      return {
        version: '1.0',
        page: spec.page || '',
        file: spec.file || '',
        savedAt: meta.savedAt || '',
        savedBy: meta.savedBy || '',
        keyCount: Object.keys(data || {}).length,
        stamps: stamps || {},
        data: data || {}
      };
    }

    return { mergeKeys: mergeKeys, ownsKey: ownsKey, collect: collect, buildPayload: buildPayload,
             sharedSources: sharedSources, isShared: isShared, sourceOf: sourceOf,
             sharedPullPlan: sharedPullPlan, pickShared: pickShared,
             isEmptyValue: isEmptyValue, wouldDiscardRecords: wouldDiscardRecords,
             guardedSet: guardedSet, isRecordKey: isRecordKey, mergeRecordValue: mergeRecordValue,
             recordSpec: recordSpec, DRIVE_RECORD_KEYS: DRIVE_RECORD_KEYS, tombContext: tombContext };
  })();

  /* --------------------------------------------------------------------------
     Core.html — the ONE escaping toolkit every page uses when it builds markup
     out of strings.

     Why it exists: names, course titles, chat messages, file names, resource
     links and notification texts are typed by trainees, instructors and even
     anonymous visitors (the Support form), then shown in the Administrator's
     browser — the session that holds the Centre's Google Drive token. Anything
     that reaches innerHTML unescaped there can read or destroy every record.
     The pages had grown four slightly different escapers, some of which forgot
     quotes, and inline onclick handlers that "escaped" an apostrophe as &#39; —
     which the browser decodes straight back before the JavaScript runs. These
     helpers are the single correct version; the page-level escapeHtml,
     escapeAttr, _certEsc and lmsChatEscapeHtml now hand their work to them.

       esc(s)        text or a quoted attribute value: & < > " ' ` all encoded.
       jsArg(s)      a JavaScript string literal that is safe INSIDE a
                     double-quoted inline handler: onclick="f(' + jsArg(x) + ')".
                     The literal is JSON-quoted first, then HTML-escaped, so the
                     browser's attribute decoding gives back exactly x.
       safeUrl(u)    u if it is an http(s)/mailto/tel/blob/relative link or a
                     data:image, otherwise '' — so a javascript: link can never
                     be clicked. { data: true } also allows any data: URL, for
                     the download links of files stored inline.
       linkify(t, { style }) escapes plain chat text and turns http(s) links
                     into anchors built from the escaped address, which can no
                     longer run past a quote into a new attribute.
       escKeepCharRefs(s) like esc, but keeps numeric character references
                     such as &#128222; (some stored notification texts carry
                     their emoji that way). A numeric reference can only ever
                     produce one character of text, never markup.
       notifIcon(icon, fallback) a notification's icon only if it is an
                     emoji/character reference, otherwise the fallback.
       cleanNotification(n) a fresh notification object built only from the
                     known fields of one that arrived from another device.
     -------------------------------------------------------------------------- */
  Core.html = (function () {
    var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
    }

    function jsArg(s) {
      var lit = JSON.stringify(String(s == null ? '' : s))
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      return esc(lit);
    }

    // Browsers ignore leading/trailing spaces and control characters, and
    // every tab or newline anywhere, when they read a link's scheme — so
    // " java\tscript:" is still javascript:. Look at the URL the same way.
    function schemeOf(u) {
      var s = String(u == null ? '' : u).replace(/^[\u0000-\u0020]+/, '').replace(/[\t\n\r]/g, '');
      var m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(s);
      return m ? m[1].toLowerCase() : '';
    }

    var SAFE_SCHEMES = { http: 1, https: 1, mailto: 1, tel: 1, blob: 1 };
    // Any picture is fine: an image (even an SVG) shown in <img> runs no script,
    // and browsers refuse to open a data: URL as a page.
    var SAFE_DATA_IMAGE = /^data:image\/[a-z0-9.+\-]+[;,]/i;

    function safeUrl(u, opts) {
      if (u == null) return '';
      var raw = String(u).trim();
      if (!raw) return '';
      var scheme = schemeOf(raw);
      if (!scheme) return raw;                      // relative link: same site, no script
      if (SAFE_SCHEMES[scheme]) return raw;
      if (scheme === 'data') {
        if (opts && opts.data) return raw;          // inline file download
        var compact = raw.replace(/[\u0000-\u0020]+/g, '');
        if (SAFE_DATA_IMAGE.test(compact)) return raw;
      }
      return '';
    }

    // A link inside chat text ends at whitespace or at any character that
    // could close an attribute or open a tag.
    var URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

    function linkify(text, opts) {
      var s = String(text == null ? '' : text);
      var style = opts && opts.style ? ' style="' + esc(opts.style) + '"' : '';
      var out = '', last = 0, m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(s))) {
        out += esc(s.slice(last, m.index));
        var url = m[0];
        out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' + style + '>' + esc(url) + '</a>';
        last = m.index + url.length;
      }
      return out + esc(s.slice(last));
    }

    function escKeepCharRefs(s) {
      return esc(s).replace(/&amp;#(\d{1,7}|x[0-9a-fA-F]{1,6});/g, '&#$1;');
    }

    // An icon is one or two emoji (possibly written as numeric references) —
    // never letters, never markup. Anything else gets the fallback.
    function notifIcon(icon, fallback) {
      var s = String(icon == null ? '' : icon);
      if (s && s.length <= 24 && /^(?:&#\d{1,7};|[^\x00-\x7F]|\s)+$/.test(s)) return s;
      return fallback == null ? '\uD83D\uDD14' : String(fallback);
    }

    var NOTIF_TYPES = { info: 1, success: 1, warning: 1 };
    var ROLES = { admin: 1, adminstaff: 1, instructor: 1, student: 1, cmc: 1 };

    function strList(a, max, allow) {
      if (!Array.isArray(a)) return [];
      var out = [];
      for (var i = 0; i < a.length && out.length < max; i++) {
        if (typeof a[i] !== 'string' && typeof a[i] !== 'number') continue;
        var v = String(a[i]).slice(0, 80);
        if (allow && !allow[v]) continue;
        out.push(v);
      }
      return out;
    }

    // Another device (or anyone on the public realtime broker) can send us a
    // notification. Keep only the fields the bell uses, as plain strings of a
    // sensible length; everything else is dropped. Returns null for junk.
    function cleanNotification(n) {
      if (!n || typeof n !== 'object' || n.id == null || n.text == null) return null;
      var ts = Number(n.timestamp);
      var out = {
        id: String(n.id).slice(0, 80),
        text: String(n.text).slice(0, 500),
        timestamp: isFinite(ts) && ts > 0 ? ts : Date.now(),
        time: 'Just now',
        read: false,
        icon: notifIcon(n.icon),
        type: NOTIF_TYPES[n.type] ? n.type : 'info',
        forRoles: strList(n.forRoles, 8, ROLES)
      };
      var users = strList(n.forUsers, 50);
      if (users.length) out.forUsers = users;
      // Who else it is for (Core.notify.reaches): a programme, the marking instructor.
      if (n.forCourse != null && String(n.forCourse).trim()) out.forCourse = String(n.forCourse).slice(0, 120);
      var ins = strList(n.forInstructors, 20);
      if (ins.length) out.forInstructors = ins;
      return out;
    }

    return { esc: esc, attr: esc, jsArg: jsArg, safeUrl: safeUrl, linkify: linkify,
             escKeepCharRefs: escKeepCharRefs, notifIcon: notifIcon, cleanNotification: cleanNotification };
  })();

  /* --------------------------------------------------------------------------
     Core.exams — the rules of an online exam that every page must agree on.

     Why it exists: each device decided these for itself, and got them wrong
     in ways that cost trainees their results.
       - The exam window was read in the device's OWN timezone, so a lab PC
         left on UTC closed a 09:00 Jamaica exam at 05:31 and published that
         to every other device. The Centre's schedule is Centre time: Jamaica
         is UTC-05:00 all year (no daylight saving), so a date and a time
         typed by staff mean one fixed instant everywhere.
       - A manually activated exam had no record of WHEN it was activated, so
         an exam scheduled for 09:00 and activated at 14:00 was "over" by the
         next tick. activatedAt opens a fresh window of `duration` minutes.
       - The clock of an attempt restarted from full on every reload. The
         deadline is now an absolute moment fixed when the attempt starts,
         and never later than the window's end.
       - Marking compared answers with keys that might be missing (an import
         with no answer key, a deleted option): null === null scored an
         unanswered question as correct. A question with no usable key now
         goes to the instructor instead of being guessed.
       - Results awaiting manual marking were counted as final Fails in pass
         rates and averages. Only final results count.

       centreTime(date, time, offset)   ms of a Centre-local date + time
       centreParts(ms, offset)          { date:'YYYY-MM-DD', time:'HH:MM' }
       defaultStart(now, offset)        the next 5-minute mark, Centre time
       windowOf(exam, offset)           { start, end } in ms, or null
       statusAt(exam, now, offset)      'upcoming' | 'active' | 'completed'
       sessionDeadline(exam, startedAt, offset)  ms the attempt must end by
       publicQuestions(questionData)    the questions WITHOUT their keys
       mark(questions, answers, keyed)  marks an attempt against the exam's keys
       keyProblems(questions)           question numbers whose MCQ/TF key is unset
       fixKeyAfterOptionRemoved(q, i)   keeps the key on the same option text
       isProvisional(r) / isFinal(r)    awaiting marking / counts towards scores
       passRateOf(results)              '67%' over final results, or null
       averageOf(results)               mean score of final results, or null
       canRevealAnswers(exam, now, off) may a trainee see the correct answers?
       syncKey(exam) / legacyKey(exam)  the exam's merge key (id) / old key
       translateLegacyTombs(tombs, lists...) old title|course tombstones -> ids
       csvCell(v)                       a CSV cell, quoted and formula-safe
       draftKey(studentId, examId)      where an attempt in progress is kept
       outboxAdd / outboxPending / outboxRestore  results not yet in the cloud

     The question types (q.type). The ids are stored in every exam and every
     result, so they never change; the names are what staff and trainees see.
       mcq          Multiple choice, one answer       key: option index
       tf           True / False                      key: true | false
       multi        Multiple answers ("one or more")  key: [option indexes]
       match        Matching                          key: q.pairs [{prompt, answer}]
       shortanswer  Short answer, marked by the key   key: [accepted answers]
       numerical    Numerical                         key: number (± q.tolerance)
       fill         Fill in the blank (staff confirm) key: expected text
       short        Essay, marked by staff            key: model answer (optional)
       info         Information only (no answer, no marks)
     ('short' is the essay: the id predates the name, and renaming it would
     strand every stored result. 'shortanswer' is the auto-marked one.)

       markMulti(chosen, key, opts)     share of the marks for a "one or more"
       markMatch(chosen, pairs)         share of the marks for a matching question
       shortAnswerMatches(ans, accepted) does a typed answer match the key?
       numericalMatches(ans, key, tol)  is a typed number within the tolerance?
       parseNumber(s)                   a typed number, or null
       matchChoices(q, shuffle)         the answers a matching row offers
       answerState(q, ans)              'none' | 'partial' | 'complete' | 'info'
       attemptQuestions(qd, opts)       the trainee's copy: keys stripped, shuffled
       pagesOf(questions, perPage)      question indexes on each page
       questionNumbers(questions)       1, 2, 'i', 3 ... (information is not numbered)
     -------------------------------------------------------------------------- */
  Core.exams = (function () {
    var DEFAULT_OFFSET = '-05:00';
    var MIN = 60000;

    function offsetMinutes(off) {
      if (typeof off === 'number' && isFinite(off)) return off;
      var m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(String(off == null || off === '' ? DEFAULT_OFFSET : off).trim());
      if (!m) m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(DEFAULT_OFFSET);
      var v = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
      return m[1] === '-' ? -v : v;
    }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function centreTime(dateStr, timeStr, offset) {
      var d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(dateStr || '').trim());
      if (!d) return null;
      var t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '00:00').trim()) || [null, '0', '0'];
      var utc = Date.UTC(+d[1], +d[2] - 1, +d[3], parseInt(t[1], 10) || 0, parseInt(t[2], 10) || 0);
      return utc - offsetMinutes(offset) * MIN;
    }
    function centreParts(ms, offset) {
      var x = new Date(ms + offsetMinutes(offset) * MIN);
      return {
        date: x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()),
        time: pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes())
      };
    }
    /* "Now", rounded UP to the next five minutes — what a blank date and time
       on a new exam mean, instead of 09:00 today (which, after 10:30, made
       the exam finished before anyone could sit it). */
    function defaultStart(nowMs, offset) {
      var step = 5 * MIN;
      return centreParts(Math.ceil(nowMs / step) * step, offset);
    }
    function durationMs(exam) { return (parseInt(exam && exam.duration, 10) || 90) * MIN; }
    function hasQuestions(exam) { return !!(exam && Array.isArray(exam.questionData) && exam.questionData.length); }

    /* An exam may name its own closing moment (closeDate + closeTime, Centre
       time), like Moodle's "Close the quiz": open from Monday 09:00 to Friday
       17:00 with a 45-minute limit per attempt. Without one — every exam
       saved before this existed — it closes `duration` minutes after it
       opens, as it always has. A closing time at or before the opening is
       ignored rather than shutting the exam before it starts. */
    function closeOf(exam, start, offset) {
      if (!exam || !exam.closeDate) return null;
      var c = centreTime(exam.closeDate, exam.closeTime || '23:59', offset);
      return c != null && start != null && c > start ? c : null;
    }

    function windowOf(exam, offset) {
      if (!exam) return null;
      var dur = durationMs(exam);
      var start = centreTime(exam.date, exam.time, offset);
      var close = closeOf(exam, start, offset);
      var end = start == null ? null : (close != null ? close : start + dur);
      var act = Date.parse(exam.activatedAt || '');
      if (!isNaN(act)) {
        start = start == null ? act : Math.min(start, act);
        end = Math.max(end == null ? 0 : end, act + dur);
      }
      return start == null ? null : { start: start, end: end };
    }

    /* The status an exam should have NOW. Pure: it never changes the exam.
       'completed' is final until staff reschedule; an exam without questions
       never opens by itself. */
    function statusAt(exam, nowMs, offset) {
      if (!exam) return 'upcoming';
      var stored = exam.status === 'active' || exam.status === 'completed' ? exam.status : 'upcoming';
      if (stored === 'completed') return 'completed';
      var w = windowOf(exam, offset);
      if (!w) return stored;
      if (stored === 'upcoming' && (nowMs < w.start || !hasQuestions(exam))) return 'upcoming';
      return nowMs >= w.end ? 'completed' : 'active';
    }

    function sessionDeadline(exam, startedAt, offset) {
      var d = startedAt + durationMs(exam);
      var w = windowOf(exam, offset);
      if (w && w.end != null) d = Math.min(d, w.end);
      return d;
    }

    /* The trainee's copy of the questions: everything that would give an
       answer away is left out. A matching question's key IS its pairs, so the
       trainee gets the prompts (rows) and the list of answers to choose from
       (choices, in alphabetical order so their order says nothing about which
       row they belong to); the tolerance of a numerical answer goes too. */
    var KEY_FIELDS = { correctAnswer: 1, pairs: 1, distractors: 1, tolerance: 1 };
    function publicQuestions(questionData) {
      return (Array.isArray(questionData) ? questionData : []).map(function (q) {
        var c = {};
        Object.keys(q || {}).forEach(function (k) { if (!KEY_FIELDS[k]) c[k] = q[k]; });
        if (q && q.type === 'match') {
          c.rows = matchPairs(q).map(function (p) { return p.prompt; });
          c.choices = matchChoices(q);
        }
        return c;
      });
    }

    function isIndex(k, n) { return typeof k === 'number' && k >= 0 && k < n && Math.floor(k) === k; }
    function matchPairs(q) {
      return (q && Array.isArray(q.pairs) ? q.pairs : []).filter(function (p) { return p && typeof p === 'object'; });
    }
    function validKey(q, key) {
      if (!q) return false;
      if (q.type === 'mcq') return isIndex(key, (q.options || []).length);
      if (q.type === 'tf') return key === true || key === false;
      if (q.type === 'multi') {
        var n = (q.options || []).length, seen = {};
        return Array.isArray(key) && key.length > 0 && key.every(function (k) {
          if (!isIndex(k, n) || seen[k]) return false;
          seen[k] = 1; return true;
        });
      }
      if (q.type === 'match') {
        var pairs = matchPairs(q);
        return pairs.length >= 2 && pairs.length === (q.pairs || []).length && pairs.every(function (p) {
          return String(p.prompt == null ? '' : p.prompt).trim() !== '' && String(p.answer == null ? '' : p.answer).trim() !== '';
        });
      }
      if (q.type === 'shortanswer') return acceptedAnswers(key).length > 0;
      if (q.type === 'numerical') {
        var tol = q.tolerance == null || q.tolerance === '' ? 0 : Number(q.tolerance);
        return parseNumber(key) != null && isFinite(tol) && tol >= 0;
      }
      return true;
    }
    /* Question numbers (1-based, as staff number them in the builder) whose
       answer key is missing or unusable. Fill-in-the-blank, the essay and
       information items have no key that marking depends on. */
    var KEYED = { mcq: 1, tf: 1, multi: 1, match: 1, shortanswer: 1, numerical: 1 };
    function keyProblems(questions) {
      var out = [];
      (questions || []).forEach(function (q, i) {
        if (q && KEYED[q.type] && !validKey(q, q.correctAnswer)) out.push(i + 1);
      });
      return out;
    }
    /* An option was deleted in the builder: the key stays on the same option
       text. For "one or more", the deleted option leaves the key and the rest
       move up with their options. */
    function fixKeyAfterOptionRemoved(q, optIdx) {
      if (q && typeof q.correctAnswer === 'number') {
        if (q.correctAnswer === optIdx) q.correctAnswer = null;
        else if (q.correctAnswer > optIdx) q.correctAnswer--;
      } else if (q && Array.isArray(q.correctAnswer)) {
        q.correctAnswer = q.correctAnswer.filter(function (k) { return k !== optIdx; })
          .map(function (k) { return typeof k === 'number' && k > optIdx ? k - 1 : k; });
      }
      return q;
    }

    /* ---- Marking the new question types (pure; each returns a share 0..1) ---- */

    /* "Select one or more", the way Moodle recommends it is set up: every
       right option is worth an equal share of the marks, and every wrong
       option takes away an equal share — the wrong options together cancel
       all of it — so ticking every box scores nothing. Never below 0.
       opts.allOrNothing: full marks only for exactly the right set. */
    function markMulti(chosen, key, opts) {
      opts = opts || {};
      var n = Math.max(0, opts.optionCount | 0);
      var right = {}, nRight = 0;
      (Array.isArray(key) ? key : []).forEach(function (k) { if (isIndex(k, n || 1e9) && !right[k]) { right[k] = 1; nRight++; } });
      if (!nRight) return 0;
      var nWrong = n ? Math.max(0, n - nRight) : 0;
      var picked = {}, hit = 0, miss = 0;
      (Array.isArray(chosen) ? chosen : []).forEach(function (k) {
        if (typeof k !== 'number' || picked[k]) return;
        picked[k] = 1;
        if (right[k]) hit++; else miss++;
      });
      if (opts.allOrNothing) return hit === nRight && miss === 0 ? 1 : 0;
      var f = hit / nRight - (miss ? (nWrong ? miss / nWrong : 1) : 0);
      return f <= 0 ? 0 : f >= 1 ? 1 : f;
    }

    function normText(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

    /* Matching: each row is worth an equal share; a row left on "Choose…" is
       simply not right. `chosen` holds the answer text picked for each row. */
    function markMatch(chosen, pairs) {
      var list = (Array.isArray(pairs) ? pairs : []).filter(function (p) { return p && typeof p === 'object'; });
      if (!list.length) return 0;
      var got = Array.isArray(chosen) ? chosen : [];
      var hit = 0;
      list.forEach(function (p, i) {
        var a = got[i];
        if (a != null && a !== '' && normText(a) === normText(p.answer)) hit++;
      });
      return hit / list.length;
    }

    /* The answers a matching question offers in every row: each pair's answer
       once, plus any extra wrong answers ("distractors"), alphabetically —
       or shuffled (random) when the exam shuffles its options. */
    function matchChoices(q, random) {
      var seen = {}, out = [];
      matchPairs(q).map(function (p) { return p.answer; }).concat(Array.isArray(q && q.distractors) ? q.distractors : [])
        .forEach(function (a) {
          var t = String(a == null ? '' : a).trim();
          if (!t || seen[normText(t)]) return;
          seen[normText(t)] = 1; out.push(t);
        });
      if (typeof random === 'function') shuffleInPlace(out, random);
      else out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0; });
      return out;
    }

    /* Short answer: the key is a list of accepted answers. Capitals and extra
       spaces never matter ("Flashback  Arrestor" is "flashback arrestor"); a
       * in an accepted answer stands for any letters ("arrest*" accepts
       arrestor and arrester). A blank answer matches nothing. */
    function acceptedAnswers(key) {
      var list = Array.isArray(key) ? key : (key == null ? [] : String(key).split(/\r?\n|\|/));
      return list.map(function (a) { return String(a == null ? '' : a).trim(); }).filter(function (a) { return a !== '' && a.replace(/\*/g, '').trim() !== ''; });
    }
    function shortAnswerMatches(ans, key) {
      var a = normText(ans);
      if (!a) return false;
      return acceptedAnswers(key).some(function (pat) {
        var p = normText(pat);
        if (p.indexOf('*') === -1) return a === p;
        var re = new RegExp('^' + p.split('*').map(function (part) { return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }).join('.*') + '$');
        return re.test(a);
      });
    }

    /* A number as a trainee types it: "1000", "1,000" (thousands commas),
       "-2.5", ".5", "1e3". Anything else ("about 1000", "1,5") is not a
       number and so not the answer. */
    function parseNumber(s) {
      if (typeof s === 'number') return isFinite(s) ? s : null;
      var t = String(s == null ? '' : s).replace(/\s+/g, '');
      if (!t) return null;
      if (t.indexOf(',') !== -1) {
        if (!/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return null;
        t = t.replace(/,/g, '');
      }
      if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
      var n = Number(t);
      return isFinite(n) ? n : null;
    }
    /* Right when within ± tolerance of the key (0: exactly the key). A hair of
       slack absorbs binary rounding (0.1 + 0.2 is 0.3 here). */
    function numericalMatches(ans, key, tolerance) {
      var a = parseNumber(ans), k = parseNumber(key);
      if (a == null || k == null) return false;
      var tol = Math.abs(Number(tolerance) || 0);
      return Math.abs(a - k) <= tol + 1e-9 * Math.max(1, Math.abs(k));
    }

    /* How far a question has been answered: 'none', 'partial' (a matching
       question with some rows still on "Choose…"), 'complete', or 'info' for
       an information item. What the navigation boxes, the summary and the
       "N unanswered" warning count. */
    function answerState(q, ans) {
      if (q && q.type === 'info') return 'info';
      if (ans === null || ans === undefined) return 'none';
      if (Array.isArray(ans)) {
        var set = ans.filter(function (a) { return a !== null && a !== undefined && a !== ''; }).length;
        if (!set) return 'none';
        if (q && q.type === 'match') {
          var rows = Array.isArray(q.rows) ? q.rows.length : matchPairs(q).length;
          return set < rows ? 'partial' : 'complete';
        }
        return 'complete';
      }
      if (typeof ans === 'string') return ans.trim() === '' ? 'none' : 'complete';
      return 'complete';
    }

    function shuffleInPlace(list, random) {
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    }
    /* The trainee's copy of the paper for one attempt: keys stripped
       (publicQuestions), the questions shuffled when the exam says so
       (information items stay where staff put them: they introduce what
       follows), and each multiple-choice question's options shuffled when
       the exam says so. A shuffled question carries optionOrder — the
       original option index shown in each place — so answers are always
       recorded as the ORIGINAL option index and marking never changes. */
    function attemptQuestions(questionData, opts) {
      opts = opts || {};
      var random = typeof opts.random === 'function' ? opts.random : Math.random;
      var qs = publicQuestions(questionData);
      if (opts.shuffleQuestions) {
        var slots = [], movable = [];
        qs.forEach(function (q, i) { if (!(q && q.type === 'info')) { slots.push(i); movable.push(q); } });
        shuffleInPlace(movable, random);
        slots.forEach(function (at, k) { qs[at] = movable[k]; });
      }
      if (opts.shuffleOptions) {
        qs.forEach(function (q, i) {
          if (!q) return;
          if ((q.type === 'mcq' || q.type === 'multi') && Array.isArray(q.options) && q.options.length > 1) {
            q.optionOrder = shuffleInPlace(q.options.map(function (_, k) { return k; }), random);
          } else if (q.type === 'match') {
            q.choices = matchChoices((questionData || []).filter(function (x) { return x && x.id === q.id; })[0] || q, random);
          }
        });
      }
      return qs;
    }

    /* Which questions are on which page: perPage of them (information items
       take a place like a question), or all on one page when perPage is 0 /
       unset — every exam saved before paging existed. */
    function pagesOf(questions, perPage) {
      var n = (questions || []).length, per = parseInt(perPage, 10) || 0;
      var out = [];
      if (!n) return [[]];
      if (per <= 0 || per >= n) { var all = []; for (var i = 0; i < n; i++) all.push(i); return [all]; }
      for (var s = 0; s < n; s += per) {
        var page = [];
        for (var k = s; k < Math.min(n, s + per); k++) page.push(k);
        out.push(page);
      }
      return out;
    }
    /* The number each item shows: questions 1, 2, 3 ...; an information item
       shows 'i' and does not take a number. */
    function questionNumbers(questions) {
      var n = 0;
      return (questions || []).map(function (q) { return q && q.type === 'info' ? 'i' : ++n; });
    }
    /* How many questions an exam has, for lists and counts: information items
       are not questions. An exam without its question bank on this device
       falls back to the count it was saved with. */
    function questionCount(exam) {
      var qd = exam && Array.isArray(exam.questionData) ? exam.questionData : null;
      if (qd && qd.length) return qd.filter(function (q) { return !(q && q.type === 'info'); }).length;
      return Number(exam && exam.questions) || 0;
    }
    function round2(x) { return Math.round(x * 100) / 100; }

    /* Mark an attempt. `questions` are what the trainee saw (keys stripped),
       `keyed` is the exam's own questionData, matched by question id. A
       question whose key is missing or unusable is never auto-marked: it is
       sent to the instructor, like a short answer. */
    function mark(questions, answers, keyed) {
      var byId = {};
      (keyed || []).forEach(function (k) { if (k && k.id != null) byId[String(k.id)] = k; });
      var out = { gradedResults: [], totalPoints: 0, earnedPoints: 0, correctCount: 0, manualCount: 0 };
      (questions || []).forEach(function (q, i) {
        // An information item asks nothing and is worth nothing: no entry.
        if (q && q.type === 'info') return;
        var src = q && q.id != null && byId[String(q.id)] ? byId[String(q.id)] : null;
        var key = src ? src.correctAnswer : (q && 'correctAnswer' in q ? q.correctAnswer : null);
        if (key === undefined) key = null;
        var pts = Number(q.points) || 0;
        var ans = answers ? answers[i] : null;
        if (ans === undefined) ans = null;
        var isCorrect = false, manual = false, autoMatch = null;
        if (q.type === 'multi' || q.type === 'match' || q.type === 'shortanswer' || q.type === 'numerical') {
          // The types that earn part of the marks. Their key is read from the
          // exam's own question (kq); one that cannot be read goes to staff.
          var kq = src || q, frac = null, extra = {};
          if (q.type === 'match') {
            if (validKey(kq, null)) { frac = markMatch(ans, kq.pairs); key = matchPairs(kq).map(function (p) { return p.answer; }); extra.rows = matchPairs(kq).map(function (p) { return p.prompt; }); }
          } else if (validKey(kq, key)) {
            if (q.type === 'multi') frac = markMulti(ans, key, { allOrNothing: !!kq.allOrNothing, optionCount: (kq.options || q.options || []).length });
            else if (q.type === 'shortanswer') frac = shortAnswerMatches(ans, key) ? 1 : 0;
            else { frac = numericalMatches(ans, key, kq.tolerance) ? 1 : 0; extra.tolerance = Number(kq.tolerance) || 0; }
          }
          out.totalPoints += pts;
          var entry = { questionId: q.id, questionText: q.text, type: q.type, studentAnswer: ans, correctAnswer: frac == null ? null : key };
          if (frac == null) {
            out.manualCount++;
            Object.assign(entry, { isCorrect: null, needsManualGrade: true, points: pts, earnedPoints: 0, awardedPoints: null, graded: false, gradedBy: null, autoMatch: null });
          } else {
            var earned = round2(pts * frac);
            out.earnedPoints = round2(out.earnedPoints + earned);
            if (frac === 1) out.correctCount++;
            Object.assign(entry, { isCorrect: frac === 1, needsManualGrade: false, points: pts, earnedPoints: earned, awardedPoints: earned,
              graded: true, gradedBy: 'auto', autoMatch: null, fraction: Math.round(frac * 10000) / 10000 }, extra);
          }
          if (Array.isArray(q.optionOrder)) entry.optionOrder = q.optionOrder.slice();
          out.gradedResults.push(entry);
          return;
        }
        if (q.type === 'mcq' || q.type === 'tf') {
          if (validKey(q, key)) isCorrect = ans === key;
          else { manual = true; key = null; }
        } else if (q.type === 'fill') {
          autoMatch = typeof key === 'string' && key.trim() !== '' &&
            String(ans == null ? '' : ans).trim().toLowerCase() === key.trim().toLowerCase();
          isCorrect = autoMatch;
          manual = true; // the instructor confirms every fill-in
        } else {
          manual = true;
        }
        out.totalPoints += pts;
        if (isCorrect && !manual) { out.earnedPoints = round2(out.earnedPoints + pts); out.correctCount++; }
        if (manual) out.manualCount++;
        var row = {
          questionId: q.id,
          questionText: q.text,
          type: q.type,
          studentAnswer: ans,
          correctAnswer: key,
          isCorrect: manual ? null : isCorrect,
          needsManualGrade: manual,
          points: pts,
          earnedPoints: (isCorrect && !manual) ? pts : 0,
          awardedPoints: manual ? null : (isCorrect ? pts : 0),
          graded: !manual,
          gradedBy: manual ? null : 'auto',
          autoMatch: q.type === 'fill' ? autoMatch : null
        };
        // The order the options were shown in, when the exam shuffled them,
        // so the review shows the paper as the trainee saw it.
        if (Array.isArray(q.optionOrder)) row.optionOrder = q.optionOrder.slice();
        out.gradedResults.push(row);
      });
      return out;
    }

    function isProvisional(r) { return !!(r && r.needsReview && !r.reviewComplete); }
    function isFinal(r) { return !!(r && !r.archived && !isProvisional(r)); }
    function passRateOf(results) {
      var fin = (results || []).filter(isFinal);
      if (!fin.length) return null;
      return Math.round(fin.filter(function (r) { return r.passed; }).length / fin.length * 100) + '%';
    }
    function averageOf(results) {
      var fin = (results || []).filter(function (r) { return isFinal(r) && !isNaN(parseFloat(r.score)); });
      if (!fin.length) return null;
      return Math.round(fin.reduce(function (a, r) { return a + parseFloat(r.score); }, 0) / fin.length);
    }

    /* A trainee sees the correct answers only once the exam has closed, or
       when staff release them; staff may also withhold them for good.
       An exam saved before this existed has no setting: after close. */
    function canRevealAnswers(exam, nowMs, offset) {
      if (!exam) return false;
      if (exam.answersRelease === 'released') return true;
      if (exam.answersRelease === 'withheld') return false;
      return statusAt(exam, nowMs, offset) === 'completed';
    }

    function lower(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    function legacyKey(e) { return lower(e && e.title) + '|' + lower(e && e.course); }
    function syncKey(e) { return e && e.id != null && e.id !== '' ? String(e.id) : legacyKey(e); }
    /* Exams used to be merged by title|programme, so the deletions already
       written down are under that key. Carry each one over to the exam's id,
       but only when exactly one exam answers to it — two same-titled exams
       must never both go because one was deleted.

       Called as (tombs, thisDevicesExams, incomingExams...). A device still
       running the old code writes that same tombstone when it merely RENAMES
       an exam (the old title|programme key disappears from its list), and
       its upload carries the renamed exam under the same id. Read as a
       deletion, the exam, its question bank and its results' standing went
       on every new device — and each then wrote an id tombstone the rest
       obeyed. So a legacy tombstone is carried over only when it can really
       mean "deleted":
         - every copy of that exam (here and incoming) still has the title
           and programme the tombstone names — a copy under another title is
           a rename, not a deletion; and
         - the exam is not in what arrived: a device that deleted it sends a
           list without it, so an incoming copy means it still exists there.
       A deletion that cannot be told from a rename is not acted on: keeping
       an exam can be undone, losing it cannot. */
    function translateLegacyTombs(tombs) {
      var out = {};
      Object.keys(tombs || {}).forEach(function (k) { out[k] = tombs[k]; });
      var ids = {}, keysOfId = {}, incoming = {};
      Array.prototype.slice.call(arguments, 1).forEach(function (list, n) {
        (list || []).forEach(function (e) {
          if (!e || e.id == null || e.id === '') return;
          var lk = legacyKey(e), id = String(e.id);
          (ids[lk] = ids[lk] || {})[id] = 1;
          (keysOfId[id] = keysOfId[id] || {})[lk] = 1;
          if (n > 0) incoming[id] = 1;
        });
      });
      Object.keys(tombs || {}).forEach(function (k) {
        if (k.indexOf('|') === -1 || !ids[k]) return;
        var match = Object.keys(ids[k]);
        if (match.length !== 1) return;
        var id = match[0];
        if (Object.keys(keysOfId[id]).length !== 1 || incoming[id]) return;
        var t = Date.parse(tombs[k]) || 0, have = Date.parse(out[id] || '') || 0;
        if (t > have) out[id] = tombs[k];
      });
      return out;
    }

    /* One CSV cell: quotes doubled, and a leading = + - @ (which a
       spreadsheet would run as a formula) neutralised with an apostrophe. */
    function csvCell(v) {
      var s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }

    /* An attempt in progress lives on the device it is sat on, under a key
       per trainee and exam: outside the voctrain_ prefix so a staff sign-out
       on a shared PC does not wipe it, and with "Session" in its name so it
       never goes into a shared snapshot (isSnapshotableKey). */
    var DRAFT_PREFIX = 'cestisExamSession__';
    function draftKey(studentId, examId) { return DRAFT_PREFIX + String(studentId) + '__' + String(examId); }

    /* Results submitted on this device that the cloud has not yet been seen
       to hold. A sign-out on a shared PC keeps only the signed-in trainee's
       rows (or, for staff, none) — these come back until they are safe. */
    function outboxAdd(list, result) {
      var out = (Array.isArray(list) ? list : []).filter(function (r) { return r && r.id !== result.id; });
      out.push(result);
      return out;
    }
    function outboxPending(list, cloudResults) {
      var inCloud = {};
      (cloudResults || []).forEach(function (r) { if (r && r.id != null) inCloud[String(r.id)] = 1; });
      return (Array.isArray(list) ? list : []).filter(function (r) { return r && !inCloud[String(r.id)]; });
    }
    function outboxRestore(examResults, list) {
      if (!Array.isArray(examResults)) return 0;
      var added = 0;
      (Array.isArray(list) ? list : []).forEach(function (r) {
        if (!r || r.id == null) return;
        var have = examResults.some(function (x) {
          return x && (x.id === r.id || (x.examId === r.examId && x.studentId === r.studentId));
        });
        if (!have) { examResults.push(r); added++; }
      });
      return added;
    }

    /* ---- An attempt that follows the trainee --------------------------------
       The owner's rule: a trainee whose PC dies (a power cut) signs in on
       another one and carries on with the SAME attempt — never a fresh second
       one — under its ORIGINAL deadline. So an attempt in progress is also a
       shared record (voctrain_examAttempts) that travels by the same routes as
       a submitted result, beside the device-only copy (draftKey), which stays
       the instant safety net when nothing can be sent.

       An open attempt record is the draft itself — the trainee's copy of the
       paper (no answer keys), answers[], flagged[], and for each question
       WHEN its answer and its flag were last changed (answeredAt[],
       flaggedAt[], ms), the fixed startTime and deadline, the page and
       question on screen (posAt: when that last moved) and status 'open'.
       Once submitted anywhere it is replaced by a small retired record — the
       tombstone — that carries no answers (the result holds them):
         { id, examId, studentId, status: 'submitted', submittedAt, resultId,
           startTime, deadline, updatedAt }
       (and the attempt's `activity`, below — WHEN things happened, never an
       answer — so the invigilator's timeline outlives the submission).

       Two devices may each hold an older or newer copy of one attempt (the
       first PC comes back to life). A whole copy is never put over another:
         - each question takes its newest answer (answeredAt) and its newest
           flag (flaggedAt); the page and question come from the copy moved
           last (posAt);
         - the deadline only ever moves EARLIER (the first one set stands);
         - a retired copy beats any open one, so a stale device cannot bring
           a submitted attempt back; of two retired copies the FIRST
           submission stands;
         - two open attempts of one trainee at one exam (a second device
           started before it heard of the first) are read as ONE: the one
           started first, with the newest answer to each question from both
           (attemptFor). Submitting retires them all.
       An exam allows one attempt (the builder fixes it at 1), so a live
       result for the trainee and exam settles every open attempt of theirs
       at it (settleAttempts), and of two results that came from attempts
       (attemptId set) only the first submission stands (oneResultPerAttempt).

         attemptIsOpen(a) / attemptIsRetired(a)
         mergeAttempt(a, b)               two copies, question by question
         mergeAttemptLists(local, other)  record by record -> { list, changed }
         attemptFor(list, sid, eid)       { attempt, ids } in progress, or null
         retireAttempt(a, resultId, at)   the small record that stands for it
         settleAttempts(list, results)    retire what a result already answers
         oneResultPerAttempt(results)     drop a second submission (in place) */
    var ATTEMPT_KEEP_MS = 120 * 24 * 3600 * 1000;   // retired records are let go after this
    function attemptIsRetired(a) { return !!(a && typeof a === 'object' && a.status === 'submitted'); }
    function attemptIsOpen(a) {
      return !!(a && typeof a === 'object' && !attemptIsRetired(a) && a.id != null && a.examId != null && a.studentId != null &&
        Array.isArray(a.questions) && Array.isArray(a.answers));
    }
    function hasAnswerValue(v) {
      if (v === null || v === undefined || v === '') return false;
      if (Array.isArray(v)) return v.some(function (x) { return x !== null && x !== undefined && x !== ''; });
      return true;
    }
    function copyJson(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
    function msOf(v) { var t = typeof v === 'number' ? v : Date.parse(v || ''); return isFinite(t) && t > 0 ? t : 0; }
    function laterIso(a, b) { return msOf(b) > msOf(a) ? b : (a || b); }
    /* When an answer or flag was last changed. A copy saved before answers
       carried their own time: as old as the save that holds it. */
    function changedAt(a, field, i, isSet) {
      var t = Array.isArray(a && a[field]) ? Number(a[field][i]) || 0 : 0;
      if (!t && isSet) t = msOf(a.savedAt) || msOf(a.updatedAt) || Number(a.startTime) || 0;
      return t;
    }
    function startedFirst(a, b) {
      var sa = Number(a.startTime) || Infinity, sb = Number(b.startTime) || Infinity;
      if (sa !== sb) return sa < sb ? a : b;
      return String(a.id) <= String(b.id) ? a : b;
    }
    function sameOrder(a, b) {
      if (a.questions.length !== b.questions.length) return false;
      return a.questions.every(function (q, i) { var o = b.questions[i]; return String(q && q.id) === String(o && o.id); });
    }
    function retiredOf(a, b) {
      var ra = attemptIsRetired(a), rb = attemptIsRetired(b), out;
      if (ra !== rb) out = copyJson(ra ? a : b);
      else {
        var ta = msOf(a.submittedAt) || Infinity, tb = msOf(b.submittedAt) || Infinity;
        var first = ta !== tb ? (ta < tb ? a : b) : (String(a.resultId || '') <= String(b.resultId || '') ? a : b);
        out = copyJson(first);
        out.updatedAt = laterIso(a.updatedAt, b.updatedAt);
      }
      // What happened during the attempt, from both copies: the copy that was
      // away may hold moments the submitted one never heard of.
      var act = mergeActivity(a.activity, b.activity, null, true);
      if (act) out.activity = act;
      return out;
    }
    function mergeAttempt(a, b) {
      var oka = !!(a && typeof a === 'object'), okb = !!(b && typeof b === 'object');
      if (!oka || !okb) return oka ? copyJson(a) : (okb ? copyJson(b) : null);
      if (attemptIsRetired(a) || attemptIsRetired(b)) return retiredOf(a, b);
      if (!attemptIsOpen(a) || !attemptIsOpen(b)) {
        var kept = copyJson(attemptIsOpen(a) ? a : b), act0 = mergeActivity(a.activity, b.activity, null, true);
        if (act0) kept.activity = act0;
        return kept;
      }
      var same = String(a.id) === String(b.id);
      var base = same ? a : startedFirst(a, b), other = base === a ? b : a;
      var out = copyJson(base);
      if (!Array.isArray(out.flagged)) out.flagged = [];
      out.answeredAt = []; out.flaggedAt = [];
      var at = {}, qmap = [];
      other.questions.forEach(function (q, j) { if (q && q.id != null && at[String(q.id)] === undefined) at[String(q.id)] = j; });
      for (var i = 0; i < out.questions.length; i++) {
        var q = out.questions[i];
        var j = q && q.id != null && at[String(q.id)] !== undefined ? at[String(q.id)] : (same && i < other.questions.length ? i : -1);
        qmap[i] = j;
        if (out.answers[i] === undefined) out.answers[i] = null;
        out.flagged[i] = !!out.flagged[i];
        var ta = changedAt(base, 'answeredAt', i, hasAnswerValue(out.answers[i]));
        var fa = changedAt(base, 'flaggedAt', i, out.flagged[i]);
        out.answeredAt[i] = ta; out.flaggedAt[i] = fa;
        if (j < 0) continue;
        var ob = other.answers[j] === undefined ? null : other.answers[j];
        var tb = changedAt(other, 'answeredAt', j, hasAnswerValue(ob));
        if (tb > ta || (tb === ta && !hasAnswerValue(out.answers[i]) && hasAnswerValue(ob))) { out.answers[i] = copyJson(ob); out.answeredAt[i] = tb; }
        var of = !!(other.flagged && other.flagged[j]);
        var fb = changedAt(other, 'flaggedAt', j, of);
        if (fb > fa) { out.flagged[i] = of; out.flaggedAt[i] = fb; }
      }
      // The clock is the first one set: a copy can never give more time.
      var da = Number(a.deadline), db = Number(b.deadline);
      if (isFinite(da) && da > 0 && isFinite(db) && db > 0) out.deadline = Math.min(da, db);
      var sa = Number(a.startTime), sb = Number(b.startTime);
      if (isFinite(sa) && sa > 0 && isFinite(sb) && sb > 0) out.startTime = Math.min(sa, sb);
      var aligned = same || sameOrder(a, b);
      if (aligned) {
        var pa = Number(a.posAt) || 0, pb = Number(b.posAt) || 0, pos = pb > pa ? b : a;
        out.page = pos.page; out.current = pos.current; out.posAt = Math.max(pa, pb);
      }
      // When each page and question was first reached and first answered,
      // and every moment either copy holds (the invigilator's record).
      var act = mergeActivity(base.activity, other.activity, qmap, aligned && (Number(a.perPage) || 0) === (Number(b.perPage) || 0));
      if (act) out.activity = act; else delete out.activity;
      out.updatedAt = laterIso(a.updatedAt, b.updatedAt);
      if (a.savedAt || b.savedAt) out.savedAt = laterIso(a.savedAt, b.savedAt);
      out.status = 'open';
      return out;
    }
    /* Record by record, by attempt id. A shorter list is never a deletion;
       only a retired record ends an attempt, and a retired record is let go
       ATTEMPT_KEEP_MS after its submission (the result it names settles the
       attempt from then on — settleAttempts). */
    function mergeAttemptLists(local, other, opts) {
      var now = opts && typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
      var out = [], slot = {}, changed = false;
      var take = function (r, fromOther) {
        if (!r || typeof r !== 'object' || r.id == null) return;
        var k = String(r.id);
        if (slot[k] === undefined) { slot[k] = out.length; out.push(fromOther ? copyJson(r) : r); if (fromOther) changed = true; return; }
        var m = mergeAttempt(out[slot[k]], r);
        if (JSON.stringify(m) !== JSON.stringify(out[slot[k]])) { out[slot[k]] = m; changed = true; }
      };
      (Array.isArray(local) ? local : []).forEach(function (r) { take(r, false); });
      (Array.isArray(other) ? other : []).forEach(function (r) { take(r, true); });
      var kept = out.filter(function (r) { return !(attemptIsRetired(r) && msOf(r.submittedAt) && now - msOf(r.submittedAt) > ATTEMPT_KEEP_MS); });
      if (kept.length !== out.length) changed = true;
      // A submitted attempt keeps its full activity for ACTIVITY_KEEP_MS (the
      // sitting's register keeps its own summary for good), then only the
      // counts, so months of retired records do not weigh down every save.
      for (var c = 0; c < kept.length; c++) {
        var r = kept[c];
        if (!attemptIsRetired(r) || !r.activity || !activityIsFull(r.activity)) continue;
        if (!(msOf(r.submittedAt) && now - msOf(r.submittedAt) > ACTIVITY_KEEP_MS)) continue;
        var small = copyJson(r);
        small.activity = compactActivity(r.activity);
        kept[c] = small;
        changed = true;
      }
      return { list: kept, changed: changed };
    }
    function samePair(r, studentId, examId) { return !!r && String(r.studentId) === String(studentId) && String(r.examId) === String(examId); }
    /* The trainee's attempt in progress at one exam, as ONE attempt however
       many copies and devices it is spread over: { attempt, ids } (ids: every
       open record folded into it), or null. */
    function attemptFor(list, studentId, examId) {
      var retired = {}, open = [];
      (Array.isArray(list) ? list : []).forEach(function (r) { if (samePair(r, studentId, examId) && attemptIsRetired(r)) retired[String(r.id)] = 1; });
      (Array.isArray(list) ? list : []).forEach(function (r) { if (samePair(r, studentId, examId) && attemptIsOpen(r) && !retired[String(r.id)]) open.push(r); });
      if (!open.length) return null;
      var acc = open[0];
      for (var i = 1; i < open.length; i++) acc = mergeAttempt(acc, open[i]);
      return { attempt: copyJson(acc), ids: open.map(function (r) { return String(r.id); }) };
    }
    function retireAttempt(a, resultId, submittedAt) {
      var out = { id: a.id, examId: a.examId, studentId: a.studentId, status: 'submitted',
        submittedAt: submittedAt || new Date().toISOString(), resultId: resultId == null ? null : resultId,
        startTime: a.startTime, deadline: a.deadline, updatedAt: submittedAt || new Date().toISOString() };
      // The moments of the attempt (no answers) stay with it for the
      // invigilator's timeline and the sitting's register.
      var act = a.activity ? activityOf(a.activity) : null;
      if (act) out.activity = act;
      return out;
    }
    /* One attempt per exam: a live result for the trainee and exam (by
       whatever route it arrived) means every open attempt of theirs at it is
       over. Retires them IN PLACE; returns how many. */
    function settleAttempts(list, results) {
      if (!Array.isArray(list)) return 0;
      var live = {};
      (Array.isArray(results) ? results : []).forEach(function (r) {
        if (!r || r.archived || r.examId == null || r.studentId == null) return;
        var k = String(r.studentId) + '|' + String(r.examId);
        if (!live[k] || msOf(r.submittedAt) < msOf(live[k].submittedAt)) live[k] = r;
      });
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!attemptIsOpen(a)) continue;
        var r = live[String(a.studentId) + '|' + String(a.examId)];
        if (!r) continue;
        list[i] = retireAttempt(a, r.id, r.submittedAt);
        n++;
      }
      return n;
    }
    /* Two results that came from attempts (attemptId set) for one trainee at
       one exam are one attempt submitted twice — a device that was away
       submitted its own copy. The FIRST submission stands; the later is
       dropped IN PLACE. Results without attemptId (every result saved
       before attempts travelled) are left to the rules they always had.
       Returns the dropped results. */
    function oneResultPerAttempt(results) {
      if (!Array.isArray(results)) return [];
      var first = {};
      results.forEach(function (r, i) {
        if (!r || !r.attemptId || r.examId == null || r.studentId == null) return;
        var k = String(r.studentId) + '|' + String(r.examId), f = first[k];
        if (!f) { first[k] = { r: r, i: i }; return; }
        var tr = msOf(r.submittedAt) || Infinity, tf = msOf(f.r.submittedAt) || Infinity;
        if (tr < tf || (tr === tf && String(r.id) < String(f.r.id))) first[k] = { r: r, i: i };
      });
      var dropped = [];
      for (var i = results.length - 1; i >= 0; i--) {
        var r = results[i];
        if (!r || !r.attemptId || r.examId == null || r.studentId == null) continue;
        var f = first[String(r.studentId) + '|' + String(r.examId)];
        if (f && f.r !== r) { dropped.unshift(r); results.splice(i, 1); }
      }
      return dropped;
    }

    /* ---- What the invigilator sees: the attempt's activity ------------------
       The owner asked for an invigilator page: office staff follow, as it
       happens, when each trainee starts a test, opens each page and begins
       each question, and when each one finishes — and the sitting gives a
       register of attendance. The attempt record above already reaches every
       staff PC by every route a result takes (and will through the trainee
       gate, which collects these same records), so what happened rides inside
       it as `activity`, and the invigilator page reads nothing else. It holds
       only WHEN things happened — never an answer.

         activity = {
           v: 1,
           lay:   { n, per, info: [i] }  the paper's shape (how many items, how
                                         many to a page, which are information
                                         items): a submitted attempt no longer
                                         holds the paper, and its timeline must
                                         still say "question 12"
           pages: [ms]   when each page was first opened (by page index)
           seen:  [ms]   when each item first became the one in hand (by index)
           first: [ms]   when each question was first answered (by index)
           ev:    [{ id, k, t, ... }] the moments, oldest first. An id starts
                  with the code of the device that wrote it ("7KQ2.3.mgx1"):
                    start {d}  resume {d}         d names the device ("Computer · 7KQ2")
                    left {why: 'hidden'|'blur'}   back {of, ms}     the test window
                    offline                       online {of, ms}   the connection
                    flag {q, on}
                    submit {how: 'trainee'|'time'|'away', late}
           more:  { device: { left, away, offline, offMs, flag } } — counted,
                  not listed, once a device has listed ACT_EACH_MAX of a kind
           sum:   the counts a submitted attempt keeps once ACTIVITY_KEEP_MS
                  has passed (compactActivity)
         }

       Two copies merge without losing a moment: each page's and question's
       first time is the earliest either copy saw (questions lined up by id,
       as their answers are, so two shuffled copies agree); the moments are
       the union of both, by id; the counts take the larger. It stays small:
       a device lists at most ACT_EACH_MAX of each repeatable kind and then
       only counts them, the times are one number per page and per question,
       and ACT_LOG_MAX is a last guard — a 100-question test cannot swell its
       record.

         activityOf(a)                      a clean copy, or null
         activityLayout(questions, per)     the paper's shape, for `lay`
         activityNote(act, ev)              a moment added (listed or counted)
         activityMark(act, field, i, t)     the first time of a page / question
         mergeActivity(a, b, qmap, pages)   two copies as one
         activitySummary(attempt)           the counts the board shows
         compactActivity(act)               the counts only */
    var ACTIVITY_KEEP_MS = 14 * 24 * 3600 * 1000;
    var ACT_EACH_MAX = 20, ACT_LOG_MAX = 600, ACT_INDEX_MAX = 2000;
    var ACT_KINDS = { start: 1, resume: 1, left: 1, back: 1, offline: 1, online: 1, flag: 1, submit: 1 };
    var ACT_COUNTED = { left: 1, offline: 1, flag: 1 };   // a device stops listing these after ACT_EACH_MAX
    var ACT_KEPT = { start: 1, resume: 1, submit: 1 };    // never let go, even past ACT_LOG_MAX
    var SUM_STRINGS = { dev: 1, how: 1 };
    function actStamps(v) {
      if (!Array.isArray(v)) return [];
      var out = v.slice(0, ACT_INDEX_MAX).map(function (x) { var n = Number(x); return isFinite(n) && n > 0 ? Math.round(n) : 0; });
      while (out.length && !out[out.length - 1]) out.pop();
      return out;
    }
    function actEvent(e) {
      if (!e || typeof e !== 'object' || e.id == null || !ACT_KINDS[e.k]) return null;
      var t = Number(e.t);
      if (!isFinite(t) || t <= 0) return null;
      var out = { id: String(e.id).slice(0, 48), k: e.k, t: Math.round(t) };
      ['d', 'why', 'how', 'of'].forEach(function (f) { if (typeof e[f] === 'string' && e[f]) out[f] = e[f].slice(0, 48); });
      ['ms', 'q'].forEach(function (f) { var n = Number(e[f]); if (e[f] != null && e[f] !== '' && isFinite(n) && n >= 0) out[f] = Math.round(n); });
      if (e.on === true || e.on === false) out.on = e.on;
      if (e.late === true) out.late = true;
      return out;
    }
    function actByTime(x, y) { return (x.t - y.t) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); }
    function actDevice(e) { return String(e && e.id || '').split('.')[0]; }
    /* Every moment either list holds, once (the same moment twice keeps one
       copy, whichever way round), oldest first; past ACT_LOG_MAX the oldest
       repeatable moments give way, never a start, a resume or a submission. */
    function actUnion(x, y) {
      var by = {};
      (Array.isArray(x) ? x : []).concat(Array.isArray(y) ? y : []).forEach(function (raw) {
        var e = actEvent(raw);
        if (!e) return;
        var c = by[e.id];
        if (!c || JSON.stringify(e) > JSON.stringify(c)) by[e.id] = e;
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(actByTime);
      if (list.length > ACT_LOG_MAX) {
        var keep = list.filter(function (e) { return ACT_KEPT[e.k]; });
        var rest = list.filter(function (e) { return !ACT_KEPT[e.k]; });
        rest = rest.slice(Math.max(0, rest.length - Math.max(0, ACT_LOG_MAX - keep.length)));
        list = keep.concat(rest).sort(actByTime);
      }
      return list;
    }
    function actCounts(m, strings) {
      var out = {}, any = false;
      Object.keys(m && typeof m === 'object' ? m : {}).forEach(function (f) {
        var v = m[f];
        if (strings && strings[f]) { if (typeof v === 'string' && v) { out[f] = v.slice(0, 48); any = true; } return; }
        var n = Number(v);
        if (isFinite(n) && n > 0) { out[f] = Math.round(n); any = true; }
      });
      return any ? out : null;
    }
    function actLay(l) {
      if (!l || typeof l !== 'object') return null;
      var n = Math.min(ACT_INDEX_MAX, Math.max(0, Math.round(Number(l.n) || 0)));
      if (!n) return null;
      var info = (Array.isArray(l.info) ? l.info : []).map(Number).filter(function (i) { return isFinite(i) && i >= 0 && i < n && i === Math.floor(i); });
      return { n: n, per: Math.max(0, Math.round(Number(l.per) || 0)), info: info };
    }
    /* A clean copy of an attempt's activity (unknown fields and malformed
       moments left out), or null when there is none. */
    function activityOf(a) {
      if (!a || typeof a !== 'object') return null;
      var out = { v: 1 };
      var lay = actLay(a.lay);
      if (lay) out.lay = lay;
      ['pages', 'seen', 'first'].forEach(function (f) { var l = actStamps(a[f]); if (l.length) out[f] = l; });
      var ev = actUnion(a.ev, null);
      if (ev.length) out.ev = ev;
      if (a.more && typeof a.more === 'object') {
        var more = {};
        Object.keys(a.more).slice(0, 20).forEach(function (d) { var c = actCounts(a.more[d]); if (c) more[String(d).slice(0, 16)] = c; });
        if (Object.keys(more).length) out.more = more;
      }
      var sum = actCounts(a.sum, SUM_STRINGS);
      if (sum) out.sum = sum;
      return out;
    }
    /* The paper's shape, for an activity started on it: how many items, how
       many to a page, and which are information items. */
    function activityLayout(questions, perPage) {
      var qs = Array.isArray(questions) ? questions : [];
      var info = [];
      qs.forEach(function (q, i) { if (q && q.type === 'info') info.push(i); });
      return actLay({ n: qs.length, per: parseInt(perPage, 10) || 0, info: info });
    }
    /* A moment added on the device it happened on. A repeatable kind (the
       test window left, the connection lost, a flag) is listed until this
       device has listed ACT_EACH_MAX of it, then only counted; a return is
       listed when the leaving it answers is (so the two always pair up). */
    function activityNote(act, ev) {
      var a = activityOf(act) || { v: 1 };
      var e = actEvent(ev);
      if (!e) return a;
      var list = a.ev || [];
      if (list.some(function (x) { return x.id === e.id; })) return a;
      var dev = actDevice(e), listed = true;
      if (ACT_COUNTED[e.k]) {
        listed = list.filter(function (x) { return x.k === e.k && actDevice(x) === dev; }).length < ACT_EACH_MAX;
      } else if ((e.k === 'back' || e.k === 'online') && e.of) {
        listed = list.some(function (x) { return x.id === e.of; });
      }
      if (listed) { a.ev = actUnion(list, [e]); return a; }
      var more = a.more = a.more || {};
      var c = more[dev] = more[dev] || {};
      var add = function (f, n) { c[f] = (c[f] || 0) + n; };
      if (e.k === 'left') add('left', 1);
      else if (e.k === 'back') add('away', e.ms || 0);
      else if (e.k === 'offline') add('offline', 1);
      else if (e.k === 'online') add('offMs', e.ms || 0);
      else if (e.k === 'flag') add('flag', 1);
      return a;
    }
    /* The first time a page was opened, or a question reached ('seen') or
       answered ('first'). A later time never replaces it. */
    function activityMark(act, field, i, t) {
      var a = activityOf(act) || { v: 1 };
      i = Number(i); t = Number(t);
      if ((field !== 'pages' && field !== 'seen' && field !== 'first') || !(i >= 0) || i !== Math.floor(i) || i >= ACT_INDEX_MAX || !(t > 0)) return a;
      var l = a[field] ? a[field].slice() : [];
      while (l.length <= i) l.push(0);
      if (!l[i]) l[i] = Math.round(t);
      a[field] = l;
      return a;
    }
    function earliestOf(x, y) { return x && y ? Math.min(x, y) : (x || y || 0); }
    /* Two copies of an attempt's activity as one. qmap[i] is where the
       first copy's item i sits in the second (-1: not there; no qmap: the
       same place, as for two copies of one attempt); samePages: the page
       numbers mean the same pages in both. Returns undefined when neither
       copy has any. */
    function mergeActivity(A, B, qmap, samePages) {
      var a = activityOf(A), b = activityOf(B);
      if (!a && !b) return undefined;
      a = a || { v: 1 }; b = b || { v: 1 };
      var out = { v: 1 };
      var lay = a.lay || (!qmap ? b.lay : null);
      if (lay) out.lay = copyJson(lay);
      ['seen', 'first'].forEach(function (f) {
        var la = a[f] || [], lb = b[f] || [], r = [];
        var n = qmap ? qmap.length : Math.max(la.length, lb.length);
        for (var i = 0; i < n; i++) {
          var j = qmap ? qmap[i] : i;
          r.push(earliestOf(la[i] || 0, j != null && j >= 0 ? (lb[j] || 0) : 0));
        }
        r = actStamps(r);
        if (r.length) out[f] = r;
      });
      var pa = a.pages || [], pb = samePages ? (b.pages || []) : [], rp = [];
      for (var p = 0; p < Math.max(pa.length, pb.length); p++) rp.push(earliestOf(pa[p] || 0, pb[p] || 0));
      rp = actStamps(rp);
      if (rp.length) out.pages = rp;
      var ev = actUnion(a.ev, b.ev);
      if (ev.length) out.ev = ev;
      var more = {};
      [a.more, b.more].forEach(function (m) {
        Object.keys(m || {}).forEach(function (d) {
          var c = more[d] = more[d] || {};
          Object.keys(m[d]).forEach(function (f) { c[f] = Math.max(c[f] || 0, m[d][f] || 0); });
        });
      });
      if (Object.keys(more).length) out.more = more;
      if (a.sum || b.sum) {
        var sum = {}, sa = a.sum || {}, sb = b.sum || {};
        Object.keys(sa).concat(Object.keys(sb)).forEach(function (f) {
          if (f in sum) return;
          if (SUM_STRINGS[f]) {
            var x = sa[f] || '', y = sb[f] || '';
            sum[f] = x && y ? (x <= y ? x : y) : (x || y);
          } else sum[f] = Math.max(Number(sa[f]) || 0, Number(sb[f]) || 0);
        });
        var cs = actCounts(sum, SUM_STRINGS);
        if (cs) out.sum = cs;
      }
      return out;
    }
    /* What the board shows of one attempt (attempt: { activity, startTime,
       answeredAt, flaggedAt, posAt, status }):
         { startedAt, device, devices, moved, resumes,
           left, awayMs, awaySince,          the test window (awaySince: away now)
           offline, offlineMs, offlineSince, the connection
           flags, pages, seen, firstAnswered, submit: { t, how, late } | null,
           lastAt }                          the trainee's last moment, as known */
    function activitySummary(att) {
      var act = activityOf(att && att.activity) || { v: 1 };
      var ev = act.ev || [], sum = act.sum || {};
      var s = { startedAt: 0, device: '', devices: [], moved: false, resumes: 0, left: 0, awayMs: 0, awaySince: 0,
        offline: 0, offlineMs: 0, offlineSince: 0, flags: 0, pages: 0, seen: 0, firstAnswered: 0, submit: null, lastAt: 0 };
      var openLeft = null, openOff = null;
      var addDev = function (d) { if (d && s.devices.indexOf(d) === -1) s.devices.push(d); };
      var closeAway = function (t) { if (openLeft) { s.awayMs += Math.max(0, t - openLeft.t); openLeft = null; } };
      ev.forEach(function (e) {
        s.lastAt = Math.max(s.lastAt, e.t);
        if (e.k === 'start') {
          if (!s.startedAt || e.t < s.startedAt) s.startedAt = e.t;
          if (e.d && !s.device) s.device = e.d;
          addDev(e.d);
        } else if (e.k === 'resume') {
          s.resumes++; addDev(e.d);
          // Carried on (on this device or another): back in a test window.
          closeAway(e.t);
        } else if (e.k === 'left') { if (!openLeft) { s.left++; openLeft = e; } }
        else if (e.k === 'back') {
          if (openLeft) { s.awayMs += e.ms != null ? e.ms : Math.max(0, e.t - openLeft.t); openLeft = null; }
          else if (e.ms) s.awayMs += e.ms;
        } else if (e.k === 'offline') { if (!openOff) { s.offline++; openOff = e; } }
        else if (e.k === 'online') {
          if (openOff) { s.offlineMs += e.ms != null ? e.ms : Math.max(0, e.t - openOff.t); openOff = null; }
          else if (e.ms) s.offlineMs += e.ms;
        } else if (e.k === 'flag') { if (e.on !== false) s.flags++; }
        else if (e.k === 'submit') {
          if (!s.submit || e.t < s.submit.t) s.submit = { t: e.t, how: e.how || '', late: !!e.late };
          closeAway(e.t);
          if (openOff) { s.offlineMs += Math.max(0, e.t - openOff.t); openOff = null; }
        }
      });
      var done = attemptIsRetired(att) || !!s.submit;
      if (openLeft && !done) s.awaySince = openLeft.t;
      if (openOff && !done) s.offlineSince = openOff.t;
      Object.keys(act.more || {}).forEach(function (d) {
        var c = act.more[d];
        s.left += c.left || 0; s.awayMs += c.away || 0; s.offline += c.offline || 0; s.offlineMs += c.offMs || 0; s.flags += c.flag || 0;
      });
      var count = function (l) { return (l || []).filter(Boolean).length; };
      s.pages = count(act.pages); s.seen = count(act.seen); s.firstAnswered = count(act.first);
      // A submitted attempt past ACTIVITY_KEEP_MS keeps only its counts.
      s.left = Math.max(s.left, sum.left || 0); s.awayMs = Math.max(s.awayMs, sum.away || 0);
      s.offline = Math.max(s.offline, sum.offline || 0); s.offlineMs = Math.max(s.offlineMs, sum.offMs || 0);
      s.flags = Math.max(s.flags, sum.flags || 0); s.pages = Math.max(s.pages, sum.pages || 0);
      s.seen = Math.max(s.seen, sum.seen || 0); s.firstAnswered = Math.max(s.firstAnswered, sum.first || 0);
      s.resumes = Math.max(s.resumes, sum.resumes || 0);
      if (!s.device && sum.dev) { s.device = sum.dev; addDev(sum.dev); }
      if (!s.submit && sum.how) s.submit = { t: sum.at || 0, how: sum.how, late: !!sum.late };
      if (!s.startedAt) s.startedAt = sum.start || Number(att && att.startTime) || 0;
      s.moved = s.devices.length > 1 || !!sum.moved;
      [act.pages, act.seen, act.first, att && att.answeredAt, att && att.flaggedAt].forEach(function (l) {
        (Array.isArray(l) ? l : []).forEach(function (t) { var n = Number(t); if (isFinite(n) && n > s.lastAt) s.lastAt = n; });
      });
      var pos = Number(att && att.posAt);
      if (isFinite(pos) && pos > s.lastAt) s.lastAt = pos;
      if (!s.lastAt) s.lastAt = s.startedAt;
      return s;
    }
    function activityIsFull(act) {
      return !!(act && typeof act === 'object' && ((Array.isArray(act.ev) && act.ev.length) || (Array.isArray(act.pages) && act.pages.length) ||
        (Array.isArray(act.seen) && act.seen.length) || (Array.isArray(act.first) && act.first.length) || (act.more && Object.keys(act.more).length)));
    }
    /* The counts only — what a submitted attempt keeps of its activity after
       ACTIVITY_KEEP_MS (the sitting's register keeps its own copy for good). */
    function compactActivity(act) {
      var a = activityOf(act) || { v: 1 };
      var s = activitySummary({ activity: a, status: 'submitted' });
      var sum = { left: s.left, away: s.awayMs, offline: s.offline, offMs: s.offlineMs, flags: s.flags, pages: s.pages,
        seen: s.seen, first: s.firstAnswered, resumes: s.resumes, start: s.startedAt, dev: s.device };
      if (s.submit) { sum.how = s.submit.how; sum.at = s.submit.t; if (s.submit.late) sum.late = 1; }
      if (s.moved) sum.moved = 1;
      var out = { v: 1 };
      if (a.lay) out.lay = a.lay;
      var cs = actCounts(sum, SUM_STRINGS);
      if (cs) out.sum = cs;
      return out;
    }

    /* How a multiple-choice answer reads on a result: its letter and the
       option's own words — "B. Red" — where the review used to say
       "A. (selected)", which told the trainee nothing about what they had
       chosen. The letter alone when the option's words are not to hand, and
       '' for no answer at all. */
    /* How one marked answer came out, for the review and the staff results:
       'pending' (waiting for staff), 'correct', 'partial' (some of the marks,
       by the automatic share or by the marker) or 'incorrect'. */
    function outcomeOf(a) {
      if (!a) return 'incorrect';
      if (a.needsManualGrade && !a.graded) return 'pending';
      if (a.isCorrect) return 'correct';
      var e = Number(a.earnedPoints) || 0, p = Number(a.points) || 0;
      return e > 0 && e < p ? 'partial' : 'incorrect';
    }
    /* When an attempt started. Results saved before startedAt existed carry
       the time taken, so it is worked back from the submission. */
    function attemptStartMs(r) {
      if (!r) return null;
      var s = Date.parse(r.startedAt || '');
      if (!isNaN(s)) return s;
      var sub = Date.parse(r.submittedAt || '');
      return isNaN(sub) ? null : sub - (Number(r.timeTaken) || 0) * 1000;
    }
    /* A mark as Moodle writes it: 1.50, 0.00. */
    function formatMark(n) {
      var x = Number(n);
      return (isFinite(x) ? Math.round(x * 100) / 100 : 0).toFixed(2);
    }

    function optionLabel(question, index) {
      if (typeof index !== 'number' || index < 0 || index !== Math.floor(index) || index > 25) return '';
      var letter = String.fromCharCode(65 + index);
      var opts = question && Array.isArray(question.options) ? question.options : null;
      var text = opts && opts[index] != null ? String(opts[index]).trim() : '';
      return text ? letter + '. ' + text : letter;
    }

    return {
      optionLabel: optionLabel,
      DEFAULT_OFFSET: DEFAULT_OFFSET, offsetMinutes: offsetMinutes, centreTime: centreTime, centreParts: centreParts,
      defaultStart: defaultStart, windowOf: windowOf, hasQuestions: hasQuestions, statusAt: statusAt,
      sessionDeadline: sessionDeadline, publicQuestions: publicQuestions, mark: mark, keyProblems: keyProblems,
      fixKeyAfterOptionRemoved: fixKeyAfterOptionRemoved, isProvisional: isProvisional, isFinal: isFinal,
      passRateOf: passRateOf, averageOf: averageOf, canRevealAnswers: canRevealAnswers,
      legacyKey: legacyKey, syncKey: syncKey, translateLegacyTombs: translateLegacyTombs, csvCell: csvCell,
      DRAFT_PREFIX: DRAFT_PREFIX, draftKey: draftKey,
      outboxAdd: outboxAdd, outboxPending: outboxPending, outboxRestore: outboxRestore,
      attemptIsOpen: attemptIsOpen, attemptIsRetired: attemptIsRetired, mergeAttempt: mergeAttempt,
      mergeAttemptLists: mergeAttemptLists, attemptFor: attemptFor, retireAttempt: retireAttempt,
      settleAttempts: settleAttempts, oneResultPerAttempt: oneResultPerAttempt, ATTEMPT_KEEP_MS: ATTEMPT_KEEP_MS,
      activityOf: activityOf, activityLayout: activityLayout, activityNote: activityNote, activityMark: activityMark,
      mergeActivity: mergeActivity, activitySummary: activitySummary, compactActivity: compactActivity, activityIsFull: activityIsFull,
      hasAnswerValue: hasAnswerValue, ACTIVITY_KEEP_MS: ACTIVITY_KEEP_MS, ACTIVITY_EACH_MAX: ACT_EACH_MAX, ACTIVITY_LOG_MAX: ACT_LOG_MAX,
      markMulti: markMulti, markMatch: markMatch, matchChoices: matchChoices, acceptedAnswers: acceptedAnswers,
      shortAnswerMatches: shortAnswerMatches, parseNumber: parseNumber, numericalMatches: numericalMatches,
      answerState: answerState, attemptQuestions: attemptQuestions, pagesOf: pagesOf, questionNumbers: questionNumbers, questionCount: questionCount,
      validKey: validKey, outcomeOf: outcomeOf, attemptStartMs: attemptStartMs, formatMark: formatMark
    };
  })();

  /* ==========================================================================
     INVIGILATION — the invigilator's live board, a trainee's timeline, and the
     sitting's attendance register.

     The owner's request: "an exam invigilator page, so that administrative
     staff can track when individuals start their assessments and begin each
     page and questions in real time, which produces a register of attendance
     for trainees. Invigilator see when each trainee complete their
     assessment."

     Everything here is worked out from records a staff PC already holds —
     the exam, its programme's roll, the attempts (Core.exams, with their
     `activity`) and the results — plus, when a trainee's computer is linked
     live, the latest word it sent (`live`, held in memory, never stored).
     So the board works the same however the attempts reach the staff PC:
     the online backup, the Centre's network, or the trainee gate that staff
     PCs collect from. Nothing it returns holds an answer.

       canOpen(role, access)                       who may open the page
       examsFor(role, exams, opts)                 which exams they may watch
       rollFor(exam, students, attempts, results, opts)  who is expected
       sittingDates(exam, attempts, offset, now)   the days it was / is sat
       board(exam, opts)                           { rows, counts, ... }
       sortRows(rows, by) / filterRows(rows, show)
       timeline(row, offset)                       every moment, in words
       duration(ms) / ago(ms) / clock(ms, offset, seconds)
       registerId(examId, date) / registerFrom(board, exam, opts) / isSigned(reg)
       registerCsv(register, offset) / attendanceProposal(register, markOf)
     ========================================================================== */
  Core.invigilation = (function () {
    var X = Core.exams;
    // An attempt in progress that has said nothing for this long is flagged
    // ("No update for 3 min — the connection may be lost"). A trainee's
    // computer re-saves its attempt at least every half minute while the test
    // is open, so silence this long means the copy is not getting through.
    var STALE_MS = 150000;
    function lower(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    function msOf(v) { var t = typeof v === 'number' ? v : Date.parse(v || ''); return isFinite(t) && t > 0 ? t : 0; }
    function iso(ms) { return ms ? new Date(ms).toISOString() : ''; }
    function copy(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
    function byName(a, b) { return lower(a && a.name) < lower(b && b.name) ? -1 : lower(a && a.name) > lower(b && b.name) ? 1 : 0; }

    /* Administrators and instructors may always open it (an instructor for
       their own programmes' exams); Admin Staff when the Administrator has
       ticked "Exam invigilation" for them (off until then). */
    function canOpen(role, access) {
      if (role === 'admin' || role === 'instructor') return true;
      if (role === 'adminstaff') return !!(access && access.invigilation === true);
      return false;
    }
    /* The exams this person may watch: every exam for an administrator or
       Admin Staff, an instructor's own programmes' (opts.courses, matched by
       opts.match as their exam list matches them) and the ones they set
       (opts.userId). Open now first, then the next to open, then the most
       recently finished. Exams with no questions are left out (nobody can sit
       them) unless somebody already has. */
    function examsFor(role, exams, opts) {
      opts = opts || {};
      if (role !== 'admin' && role !== 'adminstaff' && role !== 'instructor') return [];
      var now = opts.now || Date.now(), off = opts.offset;
      var match = typeof opts.match === 'function' ? opts.match : function (a, b) { return lower(a) === lower(b); };
      var courses = (Array.isArray(opts.courses) ? opts.courses : []).filter(Boolean);
      var list = (Array.isArray(exams) ? exams : []).filter(function (e) {
        if (!e || e.id == null) return false;
        if (!X.hasQuestions(e) && !(opts.sat && opts.sat[String(e.id)])) return false;
        if (role !== 'instructor') return true;
        if (opts.userId && e.createdBy === opts.userId) return true;
        return courses.some(function (c) { return e.course && match(e.course, c); });
      });
      var rank = { active: 0, upcoming: 1, completed: 2 };
      return list.map(function (e) {
        var w = X.windowOf(e, off);
        return { e: e, st: X.statusAt(e, now, off), start: w ? w.start : 0 };
      }).sort(function (a, b) {
        if (rank[a.st] !== rank[b.st]) return rank[a.st] - rank[b.st];
        if (a.st === 'completed') return b.start - a.start;
        return a.start - b.start;
      }).map(function (x) { return x.e; });
    }
    function inTraining(s) { var st = lower(s && s.stage); return !st || st === 'training' || st === 'in training'; }
    /* Who is expected at the sitting: the exam's programme roll (trainees in
       training whose programme matches the exam's, by opts.match), and anyone
       who has an attempt or a result at it whatever their stage. By name. */
    function rollFor(exam, students, attempts, results, opts) {
      opts = opts || {};
      if (!exam) return [];
      var match = typeof opts.match === 'function' ? opts.match : function (a, b) { return lower(a) === lower(b); };
      var sat = {};
      (Array.isArray(attempts) ? attempts : []).forEach(function (a) { if (a && String(a.examId) === String(exam.id) && a.studentId != null) sat[String(a.studentId)] = 1; });
      (Array.isArray(results) ? results : []).forEach(function (r) { if (r && !r.archived && String(r.examId) === String(exam.id) && r.studentId != null) sat[String(r.studentId)] = 1; });
      var seen = {};
      return (Array.isArray(students) ? students : []).filter(function (s) {
        if (!s || s.id == null || seen[String(s.id)]) return false;
        var mine = !!sat[String(s.id)] || !!(s.course && exam.course && match(s.course, exam.course) && inTraining(s));
        if (mine) seen[String(s.id)] = 1;
        return mine;
      }).sort(byName);
    }
    function dateOf(ms, off) { return ms ? X.centreParts(ms, off).date : ''; }
    /* The days of a sitting: the exam's own day; for an exam open over
       several days, every day somebody started it, and today while it is
       open. */
    function sittingDates(exam, attempts, offset, nowMs) {
      var w = X.windowOf(exam, offset);
      if (!w) return exam && exam.date ? [exam.date] : [];
      var first = dateOf(w.start, offset), last = dateOf(Math.max(w.start, w.end - 1), offset);
      if (first === last) return [first];
      var set = {};
      set[first] = 1;
      (Array.isArray(attempts) ? attempts : []).forEach(function (a) {
        if (a && String(a.examId) === String(exam.id) && Number(a.startTime) > 0) set[dateOf(Number(a.startTime), offset)] = 1;
      });
      var now = nowMs || Date.now();
      if (now >= w.start && now < w.end) set[dateOf(now, offset)] = 1;
      return Object.keys(set).filter(Boolean).sort();
    }

    var STATUS_LABEL = { 'not-started': 'Not started', 'in-progress': 'In progress', submitted: 'Submitted', absent: 'Absent', 'other-day': 'Sat on another day' };
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    /* 100 s -> "1 min 40 s"; 4000 s -> "1 h 6 min". */
    function duration(ms) {
      var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      if (s < 60) return s + ' s';
      var m = Math.floor(s / 60);
      if (m < 60) return m + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
      return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    }
    /* How long ago, said plainly: "just now", "12 s ago", "3 min ago". */
    function ago(ms) {
      var s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      if (s < 5) return 'just now';
      if (s < 60) return s + ' s ago';
      var m = Math.floor(s / 60);
      if (m < 60) return m + ' min ago';
      return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') + ' ago';
    }
    /* A time of day on the Centre's clock: "09:41" (or "09:41:07"). */
    function clock(ms, offset, seconds) {
      if (!ms) return '';
      var p = X.centreParts(ms, offset).time;
      if (!seconds) return p;
      var sec = Math.floor(((ms + X.offsetMinutes(offset) * 60000) % 60000 + 60000) % 60000 / 1000);
      return p + ':' + (sec < 10 ? '0' : '') + sec;
    }
    function layNumbers(lay) {
      if (!lay) return null;
      var info = {}, n = 0, out = [];
      (lay.info || []).forEach(function (i) { info[i] = 1; });
      for (var i = 0; i < lay.n; i++) out.push(info[i] ? 'i' : ++n);
      return out;
    }
    function layPages(lay) {
      if (!lay || !lay.n) return 0;
      return lay.per <= 0 || lay.per >= lay.n ? 1 : Math.ceil(lay.n / lay.per);
    }
    function answeredOf(questions, answers) {
      var c = { answered: 0, total: 0 };
      (questions || []).forEach(function (q, i) {
        var st = X.answerState(q, answers ? answers[i] : null);
        if (st === 'info') return;
        c.total++;
        if (st === 'complete') c.answered++;
      });
      return c;
    }

    /* The live board of one sitting. opts:
         students  the roll (rollFor), attempts, results
         live      { studentId: { p, rcv } } the latest word from a trainee's
                   computer over the live link (p: its pulse; rcv: when this
                   PC heard it) — newer than the shared record, held in memory
         now, offset, date (the sitting's day), staleMs
       Returns { examId, title, course, date, dates, multiDay, window, status,
       closed, rows, counts }. Each row:
         { studentId, name, course, status, statusLabel, startedAt,
           submittedAt, how ('trainee'|'time'|'away'), late, resultPending,
           pageNo, pageCount, qLabel, onSummary, answered, total, deadline,
           timeLeftMs, timeUp, lastActivityAt, asOf (how fresh the copy is),
           live, warnings: [{ k, level: 'alert'|'warn'|'info', text }],
           summary, timeTakenSec, otherDate, src (for the timeline) } */
    function board(exam, opts) {
      opts = opts || {};
      var now = opts.now || Date.now(), off = opts.offset, stale = opts.staleMs || STALE_MS;
      var w = X.windowOf(exam, off);
      var status = X.statusAt(exam, now, off);
      var closed = status === 'completed';
      var dates = sittingDates(exam, opts.attempts, off, now);
      var multiDay = !!(w && dateOf(w.start, off) !== dateOf(Math.max(w.start, w.end - 1), off));
      var date = opts.date || (multiDay ? (dates.indexOf(dateOf(now, off)) !== -1 ? dateOf(now, off) : dates[dates.length - 1]) : dates[0]) || exam.date || '';
      var eid = String(exam.id);
      var attempts = (Array.isArray(opts.attempts) ? opts.attempts : []).filter(function (a) { return a && String(a.examId) === eid; });
      var results = (Array.isArray(opts.results) ? opts.results : []).filter(function (r) { return r && !r.archived && String(r.examId) === eid; });
      var rows = (Array.isArray(opts.students) ? opts.students : []).map(function (s) {
        var sid = String(s.id);
        var mine = attempts.filter(function (a) { return String(a.studentId) === sid; });
        var open = X.attemptFor(mine, sid, eid);
        var att = open ? open.attempt : null;
        var retired = mine.filter(X.attemptIsRetired);
        var res = results.filter(function (r) { return String(r.studentId) === sid; })
          .sort(function (a, b) { return msOf(a.submittedAt) - msOf(b.submittedAt); })[0] || null;
        var lv = opts.live && opts.live[sid];
        var p = lv && lv.p && String(lv.p.examId) === eid ? lv.p : null;
        // The live word is believed only for this attempt (or before this PC
        // has heard of any), and only while it is newer than the record.
        if (p && att && open.ids.indexOf(String(p.attemptId)) === -1 && retired.every(function (r) { return String(r.id) !== String(p.attemptId); })) p = null;
        var pNewer = !!(p && (!att || (Number(p.at) || 0) > msOf(att.savedAt)));
        // What happened, from every copy: the open attempt, the submitted
        // records, and the live word.
        var act = att ? X.activityOf(att.activity) : null;
        retired.forEach(function (r) { act = X.mergeActivity(act, r.activity, null, true); });
        if (p && p.activity) act = X.mergeActivity(act, p.activity, null, true);
        var startedAt = (res && X.attemptStartMs(res)) || (att && Number(att.startTime)) || (p && Number(p.startTime)) ||
          (retired[0] && Number(retired[0].startTime)) || 0;
        var summary = X.activitySummary({ activity: act, startTime: startedAt, answeredAt: att && att.answeredAt,
          flaggedAt: att && att.flaggedAt, posAt: att && att.posAt, status: (res || retired.length) ? 'submitted' : 'open' });
        if (!startedAt) startedAt = summary.startedAt;
        var st, submittedAt = 0, resultPending = false;
        if (res) { st = 'submitted'; submittedAt = msOf(res.submittedAt); }
        else if (retired.length) {
          st = 'submitted'; resultPending = true;
          submittedAt = Math.min.apply(null, retired.map(function (r) { return msOf(r.submittedAt) || Infinity; }));
          if (!isFinite(submittedAt)) submittedAt = 0;
        } else if (p && p.done) { st = 'submitted'; resultPending = true; submittedAt = Number(p.submittedAt) || Number(p.at) || 0; }
        else if (att || p) st = 'in-progress';
        else st = closed ? 'absent' : 'not-started';
        var row = { studentId: s.id, name: s.name || '', course: s.course || '', status: st, startedAt: startedAt, submittedAt: submittedAt,
          resultPending: resultPending, how: '', late: false, pageNo: 0, pageCount: 0, qLabel: '', onSummary: false, answered: 0, total: 0,
          deadline: 0, timeLeftMs: 0, timeUp: false, lastActivityAt: 0, asOf: 0, live: false, warnings: [], summary: summary,
          timeTakenSec: res && res.timeTaken != null && isFinite(Number(res.timeTaken)) ? Number(res.timeTaken) : null, otherDate: '',
          attemptId: (att && att.id) || (retired[0] && retired[0].id) || (p && p.attemptId) || null, resultId: res ? res.id : null };
        // A sitting over several days: an attempt begun on another day
        // belongs to that day's register.
        if (multiDay && startedAt && dateOf(startedAt, off) !== date) { row.status = 'other-day'; row.otherDate = dateOf(startedAt, off); }
        row.statusLabel = row.status === 'other-day' ? 'Sat on ' + row.otherDate : STATUS_LABEL[row.status];
        if (st === 'in-progress') {
          if (att && !pNewer) {
            var pages = X.pagesOf(att.questions, att.perPage);
            var cur = Number(att.current) || 0, nums = X.questionNumbers(att.questions);
            row.pageNo = Math.min(pages.length, (Number(att.page) || 0) + 1); row.pageCount = pages.length;
            row.qLabel = nums[cur] == null ? '' : String(nums[cur]);
            var c = answeredOf(att.questions, att.answers);
            row.answered = c.answered; row.total = c.total;
            row.deadline = Number(att.deadline) || 0;
          } else {
            row.pageNo = (Number(p.page) || 0) + 1; row.pageCount = Number(p.pages) || 0;
            row.qLabel = p.q == null ? '' : String(p.q); row.onSummary = p.view === 'summary';
            row.answered = Number(p.answered) || 0; row.total = Number(p.total) || 0;
            row.deadline = Number(p.deadline) || (att && Number(att.deadline)) || 0;
          }
          row.timeLeftMs = row.deadline ? Math.max(0, row.deadline - now) : 0;
          row.timeUp = !!(row.deadline && now >= row.deadline);
        } else if (res) {
          var ans = Array.isArray(res.answers) ? res.answers : [];
          row.answered = ans.filter(function (a) { return a && X.hasAnswerValue(a.studentAnswer); }).length;
          row.total = Number(res.totalQuestions) || ans.length;
        }
        row.how = (summary.submit && summary.submit.how) || (res && res.autoSubmitted ? 'time' : (res ? 'trainee' : ''));
        row.late = !!((res && res.late) || (summary.submit && summary.submit.late));
        row.lastActivityAt = Math.max(summary.lastAt || 0, p && Number(p.last) || 0, submittedAt || 0);
        row.asOf = Math.max(att ? msOf(att.savedAt) : 0, p ? Number(p.at) || 0 : 0, submittedAt || 0,
          Math.max.apply(null, [0].concat(retired.map(function (r) { return msOf(r.updatedAt); }))));
        row.live = !!(lv && lv.rcv && p && now - lv.rcv < 30000);
        var warn = function (k, level, text) { row.warnings.push({ k: k, level: level, text: text }); };
        if (st === 'in-progress' && summary.awaySince) warn('away-now', 'alert', 'Away from the test window now — since ' + clock(summary.awaySince, off) + ' (' + duration(now - summary.awaySince) + ')');
        // (Away now and never before: the line above says it all.)
        if (summary.left && !(st === 'in-progress' && summary.awaySince && summary.left === 1)) warn('left', 'warn', 'Left the test window ' + summary.left + '× (' + duration(summary.awayMs + (st === 'in-progress' && summary.awaySince ? now - summary.awaySince : 0)) + ')');
        if (st === 'in-progress' && summary.offlineSince) warn('offline-now', 'alert', 'Connection lost now — since ' + clock(summary.offlineSince, off));
        if (summary.offline) warn('offline', 'warn', 'Connection lost ' + summary.offline + '× (' + duration(summary.offlineMs) + ')');
        if (st === 'in-progress' && !row.timeUp && row.asOf && now - row.asOf > stale) warn('silent', 'alert', 'No update for ' + duration(now - row.asOf) + ' — the connection may be lost');
        if (st === 'in-progress' && row.timeUp) warn('time-up', 'warn', 'Time is up: the answers are submitted as soon as that computer is back');
        if (summary.moved) warn('moved', 'info', 'Continued on another device');
        if (resultPending) warn('pending', 'info', 'Submitted — the result is on its way to this computer');
        if (row.late) warn('late', 'warn', 'Submitted after the test closed');
        row.src = { activity: act, startedAt: startedAt, submittedAt: submittedAt, how: row.how, late: row.late };
        return row;
      });
      var counts = { expected: 0, started: 0, inProgress: 0, submitted: 0, notStarted: 0, absent: 0, otherDay: 0, attention: 0 };
      rows.forEach(function (r) {
        if (r.status === 'other-day') { counts.otherDay++; return; }
        counts.expected++;
        if (r.status === 'in-progress') { counts.inProgress++; counts.started++; }
        else if (r.status === 'submitted') { counts.submitted++; counts.started++; }
        else if (r.status === 'not-started') counts.notStarted++;
        else if (r.status === 'absent') counts.absent++;
        if (r.warnings.some(function (x) { return x.level === 'alert'; })) counts.attention++;
      });
      return { examId: exam.id, title: exam.title || '', course: exam.course || '', date: date, dates: dates, multiDay: multiDay,
        window: w ? { start: w.start, end: w.end } : null, status: status, closed: closed, rows: rows, counts: counts, now: now };
    }
    var STATUS_ORDER = { 'in-progress': 0, 'not-started': 1, submitted: 2, absent: 3, 'other-day': 4 };
    /* by: 'name' | 'status' | 'started' | 'activity' (most recent first) | 'progress' (most answered first). */
    function sortRows(rows, by) {
      var r = (rows || []).slice();
      var name = byName;
      var cmp = {
        name: name,
        status: function (a, b) { return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || name(a, b); },
        started: function (a, b) { return ((a.startedAt || Infinity) - (b.startedAt || Infinity)) || name(a, b); },
        activity: function (a, b) { return ((b.lastActivityAt || 0) - (a.lastActivityAt || 0)) || name(a, b); },
        progress: function (a, b) {
          var pa = a.total ? a.answered / a.total : -1, pb = b.total ? b.answered / b.total : -1;
          return (pb - pa) || name(a, b);
        }
      }[by] || name;
      return r.sort(cmp);
    }
    /* show: 'all' | 'in-progress' | 'submitted' | 'not-started' | 'absent' | 'attention'. */
    function filterRows(rows, show) {
      if (!show || show === 'all') return (rows || []).slice();
      return (rows || []).filter(function (r) {
        if (show === 'attention') return r.warnings.some(function (x) { return x.level === 'alert' || x.level === 'warn'; });
        return r.status === show;
      });
    }
    var KIND_ORDER = { start: 0, resume: 1, page: 2, seen: 3, first: 4, flag: 5, left: 6, back: 7, offline: 8, online: 9, submit: 10 };
    function submitText(how, late) {
      var t = how === 'time' ? 'Submitted automatically when the time ran out'
        : how === 'away' ? 'Submitted automatically: the time ran out while away from the test'
        : 'Submitted the test';
      return t + (late ? ' (after the test closed)' : '');
    }
    /* Every moment of a trainee's attempt, oldest first, in words:
       [{ t, kind, text }]. From the board row (row.src). */
    function timeline(row, offset) {
      var src = (row && row.src) || {};
      var act = X.activityOf(src.activity) || { v: 1 };
      var nums = layNumbers(act.lay), pageCount = layPages(act.lay);
      var item = function (i) {
        var n = nums ? nums[i] : null;
        if (n === 'i') return 'the information item';
        return 'question ' + (n != null ? n : Number(i) + 1);
      };
      var out = [], hadStart = false, hadSubmit = false, startDev = '';
      (act.ev || []).forEach(function (e) {
        var text = '';
        if (e.k === 'start') { hadStart = true; if (!startDev) startDev = e.d || ''; text = 'Started the test' + (e.d ? ' on ' + e.d : ''); }
        else if (e.k === 'resume') text = 'Continued the test' + (e.d ? ' on ' + e.d : '') + (e.d && startDev && e.d !== startDev ? ' (another device)' : '');
        else if (e.k === 'left') text = e.why === 'blur' ? 'Switched away from the test window' : e.why === 'page' ? 'Left the test for another page of the site' : 'Left the test window';
        else if (e.k === 'back') text = 'Came back to the test' + (e.ms ? ' after ' + duration(e.ms) : '');
        else if (e.k === 'offline') text = 'Connection lost';
        else if (e.k === 'online') text = 'Connection back' + (e.ms ? ' after ' + duration(e.ms) : '');
        else if (e.k === 'flag') text = (e.on === false ? 'Removed the flag on ' : 'Flagged ') + item(e.q);
        else if (e.k === 'submit') { hadSubmit = true; text = submitText(e.how, e.late); }
        if (text) out.push({ t: e.t, kind: e.k, text: text });
      });
      if (!hadStart && src.startedAt) out.push({ t: src.startedAt, kind: 'start', text: 'Started the test' });
      (act.pages || []).forEach(function (t, p) { if (t) out.push({ t: t, kind: 'page', text: 'Opened page ' + (p + 1) + (pageCount ? ' of ' + pageCount : '') }); });
      (act.seen || []).forEach(function (t, i) { if (t && !(nums && nums[i] === 'i')) out.push({ t: t, kind: 'seen', text: 'Began ' + item(i) }); });
      (act.first || []).forEach(function (t, i) { if (t) out.push({ t: t, kind: 'first', text: 'Answered ' + item(i) }); });
      if (!hadSubmit && src.submittedAt) out.push({ t: src.submittedAt, kind: 'submit', text: submitText(src.how, src.late) });
      out.sort(function (a, b) { return (a.t - b.t) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]); });
      out.forEach(function (x) { x.time = clock(x.t, offset, true); });
      return out;
    }

    /* ---- The sitting's attendance register --------------------------------
       One record per sitting (exam + day), in voctrain_examRegisters, so it
       is kept and can be opened again: a row per expected trainee as the
       board showed them (Present — completed / Present — did not finish /
       Absent), the invigilator's notes per trainee (notes {studentId:
       {text, by, byName}} dated in noteAt), and the sign-off (signoff
       {userId: {name}} dated in signoffAt). Merged like the Centre's other
       records — newest copy wins the record, and the notes, the sign-offs and
       the attendance log entry by entry (Core.sync.RECORD_MAPS.examRegisters),
       so two invigilators writing at once both keep what they wrote. A signed
       register is never rewritten from the board again. */
    var REG_STATUS = { completed: 'Present — completed', unfinished: 'Present — did not finish', sitting: 'Present — still sitting',
      absent: 'Absent', 'not-started': 'Not started yet', 'other-day': 'Sat on another day' };
    function registerId(examId, date) { return 'XREG-' + String(examId) + '-' + String(date || ''); }
    function isSigned(reg) { return !!(reg && reg.signoff && typeof reg.signoff === 'object' && Object.keys(reg.signoff).length); }
    /* opts: { existing, now, by, byName }. */
    function registerFrom(b, exam, opts) {
      opts = opts || {};
      var prev = opts.existing && typeof opts.existing === 'object' ? opts.existing : null;
      if (prev && isSigned(prev)) return copy(prev);
      var now = opts.now || Date.now(), at = iso(now);
      var rows = (b && b.rows || []).map(function (r) {
        // An attempt still open while the test is: still sitting. Once the
        // test has closed (or her time is up) without a submission: did not finish.
        var status = r.status === 'submitted' ? 'completed' : r.status === 'in-progress' ? (b.closed || r.timeUp ? 'unfinished' : 'sitting') : r.status;
        var spent = 0;
        if (r.startedAt) {
          if (r.status === 'submitted' && r.timeTakenSec != null) spent = Math.max(0, Math.round(r.timeTakenSec));
          else {
            var end = r.submittedAt || Math.min(r.lastActivityAt || now, r.deadline || now);
            spent = Math.max(0, Math.round((end - r.startedAt) / 1000));
          }
        }
        var s = r.summary || {};
        var row = { studentId: r.studentId, name: r.name, course: r.course, status: status, startedAt: iso(r.startedAt),
          submittedAt: iso(r.submittedAt), spentSec: spent, how: r.how || '', left: s.left || 0, awayMs: s.awayMs || 0,
          offline: s.offline || 0, offlineMs: s.offlineMs || 0 };
        if (r.late) row.late = true;
        if (s.moved) row.moved = true;
        if (r.status === 'other-day') row.otherDate = r.otherDate;
        return row;
      });
      var counts = { expected: 0, present: 0, completed: 0, unfinished: 0, absent: 0 };
      rows.forEach(function (r) {
        if (r.status === 'other-day') return;
        counts.expected++;
        if (r.status === 'completed') { counts.completed++; counts.present++; }
        else if (r.status === 'unfinished') { counts.unfinished++; counts.present++; }
        else if (r.status === 'sitting') { counts.sitting = (counts.sitting || 0) + 1; counts.present++; }
        else if (r.status === 'absent') counts.absent++;
      });
      var reg = prev ? copy(prev) : {};
      reg.id = registerId(exam.id, b.date);
      reg.examId = exam.id; reg.examTitle = exam.title || ''; reg.course = exam.course || '';
      reg.date = b.date; reg.time = exam.time || ''; reg.duration = exam.duration || '';
      reg.rows = rows; reg.counts = counts;
      reg.windowClosed = !!b.closed;
      if (!reg.producedAt) { reg.producedAt = at; reg.producedBy = opts.byName || ''; }
      reg.refreshedAt = at; reg.refreshedBy = opts.byName || '';
      ['notes', 'noteAt', 'signoff', 'signoffAt'].forEach(function (f) { if (!reg[f] || typeof reg[f] !== 'object') reg[f] = {}; });
      if (!Array.isArray(reg.attendanceLog)) reg.attendanceLog = [];
      reg.updatedAt = at;
      return reg;
    }
    function statusText(r) {
      if (r.status === 'other-day') return 'Sat on ' + (r.otherDate || 'another day');
      return REG_STATUS[r.status] || r.status;
    }
    function howText(how) { return how === 'time' ? 'Automatically, time ran out' : how === 'away' ? 'Automatically, time ran out while away' : how === 'trainee' ? 'By the trainee' : ''; }
    function signedText(reg, offset) {
      return Object.keys(reg.signoff || {}).map(function (u) {
        var at = msOf(reg.signoffAt && reg.signoffAt[u]);
        return (reg.signoff[u] && reg.signoff[u].name || 'Invigilator') + (at ? ' at ' + clock(at, offset) + ' on ' + dateOf(at, offset) : '');
      }).join('; ');
    }
    /* The register as a spreadsheet (CSV, with a byte-order mark so a
       spreadsheet program reads the dashes and accents). */
    function registerCsv(reg, offset) {
      var c = X.csvCell, lines = [];
      var line = function (cells) { lines.push(cells.map(c).join(',')); };
      line(['Exam attendance register']);
      line(['Exam', reg.examTitle || '']);
      line(['Programme', reg.course || '']);
      line(['Date', reg.date || '']);
      line(['Invigilator', reg.producedBy || '']);
      line(['Signed off', signedText(reg, offset) || 'Not yet']);
      line([]);
      line(['Trainee', 'Student ID', 'Programme', 'Status', 'Started', 'Submitted', 'Time spent', 'How it was submitted', 'Left the test window', 'Connection lost', 'Note']);
      (reg.rows || []).forEach(function (r) {
        var note = reg.notes && reg.notes[r.studentId] ? reg.notes[r.studentId].text || '' : '';
        line([r.name, r.studentId, r.course, statusText(r) + (r.late ? ' (late)' : ''),
          r.startedAt ? clock(msOf(r.startedAt), offset) : '', r.submittedAt ? clock(msOf(r.submittedAt), offset) : '',
          r.startedAt ? duration(r.spentSec * 1000) : '', howText(r.how),
          r.left ? r.left + '× (' + duration(r.awayMs) + ')' : '', r.offline ? r.offline + '× (' + duration(r.offlineMs) + ')' : '', note]);
      });
      return '﻿' + lines.join('\r\n') + '\r\n';
    }
    /* "Add to the day's attendance": a proposal per trainee who sat or was
       absent — Present for anyone who started the test, Absent for anyone
       who did not — beside the mark the day already has (markOf(studentId)
       -> status or ''). Nothing is written by this: staff confirm. A cell
       already marked is not ticked, and nor is an absence (the trainee may
       have been in class without sitting the test). */
    function attendanceProposal(reg, markOf) {
      return ((reg && reg.rows) || []).filter(function (r) {
        return r.status === 'completed' || r.status === 'unfinished' || r.status === 'sitting' || r.status === 'absent';
      }).map(function (r) {
        var current = typeof markOf === 'function' ? (markOf(r.studentId) || '') : '';
        var status = r.status === 'absent' ? 'absent' : 'present';
        return { studentId: r.studentId, name: r.name, status: status, current: current,
          tick: !current && status === 'present', reason: statusText(r) };
      });
    }

    return { STALE_MS: STALE_MS, STATUS_LABEL: STATUS_LABEL, REG_STATUS: REG_STATUS, canOpen: canOpen, examsFor: examsFor,
      rollFor: rollFor, sittingDates: sittingDates, board: board, sortRows: sortRows, filterRows: filterRows, timeline: timeline,
      duration: duration, ago: ago, clock: clock, plural: plural, registerId: registerId, isSigned: isSigned,
      registerFrom: registerFrom, registerCsv: registerCsv, statusText: statusText, howText: howText, signedText: signedText,
      attendanceProposal: attendanceProposal };
  })();

  // ===================== COURSEWORK: dates, marks, attempts =====================
  // The assignment pages decided "past due", averages and resubmission inline,
  // each a little differently. These are the rules, once, so every page (and
  // the tests) agree.
  Core.coursework = (function () {
    var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    // 'YYYY-MM-DD' for the device's own calendar day (Jamaica on the Centre's
    // machines). toISOString() would give the UTC day, which is tomorrow from
    // 7 PM onwards in Kingston.
    function localDateStr(d) {
      d = d instanceof Date ? d : (d == null ? new Date() : new Date(d));
      if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function isDateOnly(s) {
      var m = DATE_ONLY.exec(String(s == null ? '' : s).trim());
      if (!m) return false;
      var d = new Date(+m[1], +m[2] - 1, +m[3]);
      return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
    }

    // A due date typed into <input type=date> is a calendar day, not an
    // instant. new Date('2026-10-16') reads it as UTC midnight — 7 PM on the
    // 15th in Jamaica — so work showed "Past Due" from the evening before and
    // all through the day it was due. Read it on the local calendar instead:
    // the start of the day, or (endOfDay) its last millisecond.
    function parseLocalDate(s, endOfDay) {
      if (s == null || s === '') return null;
      var str = String(s).trim();
      if (isDateOnly(str)) {
        var m = DATE_ONLY.exec(str);
        return endOfDay ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999) : new Date(+m[1], +m[2] - 1, +m[3]);
      }
      var d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    }

    // Due on a day means "by the end of that day, here".
    function isPastDue(dueDate, now) {
      if (!dueDate) return false;
      var d = parseLocalDate(dueDate, true);
      if (!d) return false;
      var t = now instanceof Date ? now.getTime() : (now == null ? Date.now() : Number(now));
      return d.getTime() < t;
    }

    // Whole calendar days from today (local) to a date: 0 = today, 1 = tomorrow.
    function daysUntil(dateStr, now) {
      var d = parseLocalDate(dateStr, false);
      if (!d) return null;
      var n = now instanceof Date ? now : (now == null ? new Date() : new Date(now));
      var today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
      return Math.round((d.getTime() - today.getTime()) / 86400000);
    }

    // A mark is a number, and 0 is a mark. `parseInt(g) || null` and `!grade`
    // both read a trainee's legitimate 0 as "not graded yet".
    function gradeValue(g) {
      if (g == null || g === '') return null;
      var n = typeof g === 'number' ? g : Number(String(g).trim());
      return isFinite(n) ? n : null;
    }

    function percentOf(points, maxPoints) {
      var p = gradeValue(points), max = Number(maxPoints);
      if (p == null || !(max > 0)) return null;
      return p / max * 100;
    }

    // The create form's default weight. Exams carry no weight setting, so each
    // counts as one standard item.
    var DEFAULT_WEIGHT = 10;
    function weightOf(w) {
      var n = Number(w);
      return isFinite(n) && n > 0 ? n : DEFAULT_WEIGHT;
    }

    // Mean of percentages, each counted by its weight, over the items that
    // actually have a mark. null when nothing is marked yet.
    function weightedAverage(items) {
      var sum = 0, wsum = 0;
      (items || []).forEach(function (it) {
        if (!it || it.pct == null || !isFinite(it.pct)) return;
        var w = weightOf(it.weight);
        sum += it.pct * w; wsum += w;
      });
      return wsum > 0 ? sum / wsum : null;
    }

    // The gradebook's own bands (A 80+, B 70+, C 60+, D 50+, F) on a 4-point scale.
    function gpaFromPercent(p) {
      if (p == null || !isFinite(p)) return null;
      var g = p >= 80 ? 4 : p >= 70 ? 3 : p >= 60 ? 2 : p >= 50 ? 1 : 0;
      return g.toFixed(1);
    }

    // GPA is hand-edited by administrators; a hand-set figure stands. Only the
    // untouched seed ('0.0', blank) gives way to the figure the marks produce.
    function effectiveGpa(stored, computed) {
      var s = stored == null ? '' : String(stored).trim();
      var isSeed = s === '' || Number(s) === 0;
      if (isSeed && computed != null) return computed;
      return s === '' ? '0.0' : s;
    }

    // Everything a trainee's dashboard says about coursework, from the marks.
    // opts: { assignments, examResults, exams } — assignments already filtered
    // to the trainee's programme.
    function studentSummary(studentId, opts) {
      opts = opts || {};
      var items = [], graded = 0;
      var assignments = opts.assignments || [];
      assignments.forEach(function (a) {
        var g = a && a.grades ? gradeValue(a.grades[studentId]) : null;
        if (g == null) return;
        graded++;
        items.push({ pct: percentOf(g, a.maxPoints), weight: a.weight });
      });
      // One result per exam: the latest attempt.
      var latest = {};
      (opts.examResults || []).forEach(function (r) {
        if (!r || r.studentId !== studentId) return;
        var k = r.examId || r.examTitle || r.id;
        var t = Date.parse(r.submittedAt || r.date || r.completedAt || '') || 0;
        if (!latest[k] || t >= latest[k].t) latest[k] = { r: r, t: t };
      });
      Object.keys(latest).forEach(function (k) {
        var s = gradeValue(latest[k].r.score);
        if (s != null) items.push({ pct: s, weight: DEFAULT_WEIGHT });
      });
      var avg = weightedAverage(items);
      var percent = avg == null ? null : Math.round(avg);
      return { graded: graded, total: assignments.length, percent: percent, gpa: gpaFromPercent(avg) };
    }

    /* The instructor's gradebook: a column for EVERY exam and EVERY assignment
       of the programme, newest first, and each trainee's average over all of
       them. It used to show the first seven exams and the first seven
       assignments only, and average just those: from week 8 a trainee's
       latest marks were not on screen and her average still read 90% when
       the truth was 71%.
         opts { students, exams, assignments, results, isFinal(result) }
       Exams count as one standard item each; an assignment by its Weight
       (%). An exam's mark is the trainee's final result for it (isFinal: one
       still awaiting marking, or archived, is not a mark yet).
       -> { columns: [{ kind:'exam'|'assignment', id, title, label, weight, date }],
            rows: [{ student, cells: [pct|null per column], average: pct|null }] } */
    function gradebook(opts) {
      opts = opts || {};
      var isFinal = typeof opts.isFinal === 'function' ? opts.isFinal : function (r) { return !!r; };
      var cols = [];
      (opts.exams || []).forEach(function (e) {
        if (!e) return;
        cols.push({ kind: 'exam', id: e.id, title: e.title || 'Exam', label: e.title || 'Exam', weight: DEFAULT_WEIGHT,
          date: String(e.date || '') + ' ' + String(e.time || ''), src: e });
      });
      (opts.assignments || []).forEach(function (a) {
        if (!a) return;
        cols.push({ kind: 'assignment', id: a.id, title: a.title || 'Assignment', label: (a.title || 'Assignment') + ' (' + weightOf(a.weight) + '%)',
          weight: a.weight, date: String(a.dueDate || '') + ' ' + String(a.createdAt || ''), src: a });
      });
      // Newest first; the order they were set in breaks a tie.
      cols = cols.map(function (c, i) { c._i = i; return c; }).sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : b._i - a._i;
      });
      var results = (opts.results || []).filter(function (r) { return r && isFinal(r); });
      var rows = (opts.students || []).map(function (st) {
        var mine = results.filter(function (r) { return r.studentId === st.id; });
        var items = cols.map(function (c) {
          if (c.kind === 'exam') {
            var r = mine.filter(function (x) { return x.examId === c.id || x.examTitle === c.src.title; })[0];
            return { pct: r ? gradeValue(r.score) : null, weight: DEFAULT_WEIGHT };
          }
          return { pct: percentOf(c.src.grades ? c.src.grades[st.id] : null, c.src.maxPoints), weight: c.src.weight };
        });
        return { student: st, cells: items.map(function (it) { return it.pct; }), average: weightedAverage(items) };
      });
      return {
        columns: cols.map(function (c) { return { kind: c.kind, id: c.id, title: c.title, label: c.label, weight: c.kind === 'exam' ? DEFAULT_WEIGHT : weightOf(c.weight), date: c.date.trim() }; }),
        rows: rows
      };
    }
    /* "Export Grades": the gradebook as a spreadsheet — a row per trainee, a
       column per exam and assignment (newest first, as on screen), whole
       percentages, then the average. Cells that start like a formula are
       made text (Core.attendance.csvCell). */
    function gradebookCsv(book) {
      var cell = Core.attendance.csvCell;
      var pct = function (v) { return v == null ? '' : String(Math.round(v)); };
      var lines = [['Trainee', 'Student ID'].concat(book.columns.map(function (c) { return c.label + ' %'; })).concat(['Average %']).map(cell).join(',')];
      book.rows.forEach(function (r) {
        lines.push([r.student.name || '', r.student.id || ''].concat(r.cells.map(pct)).concat([pct(r.average)]).map(cell).join(','));
      });
      return lines.join('\n');
    }

    // A changed mark is recorded, not just overwritten: who, when, and what it
    // was before. HEART/NSTA moderation asks exactly that.
    function recordGrade(assignment, studentId, points, by, nowIso) {
      if (!assignment || studentId == null) return { changed: false };
      if (!assignment.grades) assignment.grades = {};
      var prev = assignment.grades[studentId];
      var prevVal = gradeValue(prev);
      var newVal = gradeValue(points);
      if (newVal == null) return { changed: false };
      if (prevVal === newVal) return { changed: false, previous: prevVal };
      var at = nowIso || new Date().toISOString();
      assignment.grades[studentId] = newVal;
      if (!Array.isArray(assignment.gradeLog)) assignment.gradeLog = [];
      assignment.gradeLog.push({ studentId: studentId, points: newVal, previous: prevVal, gradedBy: by || '', gradedAt: at });
      if (!assignment.gradeMeta || typeof assignment.gradeMeta !== 'object') assignment.gradeMeta = {};
      assignment.gradeMeta[studentId] = { gradedBy: by || '', gradedAt: at };
      return { changed: true, previous: prevVal };
    }

    function pairOf(subs, assignmentId, studentId) {
      return (subs || []).filter(function (s) { return s && s.assignmentId === assignmentId && s.studentId === studentId; });
    }
    function subTime(s) { return Date.parse(s && s.submittedAt || '') || 0; }

    // Every attempt a trainee made at one assignment, oldest first.
    function submissionHistory(subs, assignmentId, studentId) {
      return pairOf(subs, assignmentId, studentId).sort(function (a, b) {
        return subTime(a) - subTime(b) || (a.attempt || 0) - (b.attempt || 0);
      });
    }
    // The attempt that counts: the newest. Older ones stay as history.
    function latestSubmission(subs, assignmentId, studentId) {
      var h = submissionHistory(subs, assignmentId, studentId);
      return h.length ? h[h.length - 1] : null;
    }
    // One entry per trainee for an assignment: their latest attempt.
    function latestPerStudent(subs, assignmentId) {
      var by = {};
      (subs || []).forEach(function (s) {
        if (!s || s.assignmentId !== assignmentId) return;
        var cur = by[s.studentId];
        if (!cur || subTime(s) > subTime(cur) || (subTime(s) === subTime(cur) && (s.attempt || 0) > (cur.attempt || 0))) by[s.studentId] = s;
      });
      return Object.keys(by).map(function (k) { return by[k]; });
    }

    // May this trainee upload (again)? Before any submission: when the
    // assignment asks for one. Before it is marked: yes, as always. After it
    // is marked: only when the instructor allowed resubmission on it.
    function canSubmit(assignment, hasSubmission, grade) {
      if (!assignment) return false;
      if (!hasSubmission) return assignment.requireSubmission !== false;
      if (gradeValue(grade) == null) return true;
      return assignment.allowResubmission === true;
    }

    // Every file is copied into the Centre's data (and, offline, into one file
    // on the Centre's server with a 64 MB ceiling), so a single upload has to
    // stay small. 5 MB covers a phone photo, a scanned page or a PDF report.
    var MAX_FILE_BYTES = 5 * 1024 * 1024;
    function oversizeFiles(files, maxBytes) {
      var max = maxBytes || MAX_FILE_BYTES;
      var out = [];
      for (var i = 0; i < (files ? files.length : 0); i++) {
        var f = files[i];
        if (f && Number(f.size) > max) out.push(f.name || ('file ' + (i + 1)));
      }
      return out;
    }

    // Resources follow the same programme rule as assignments. 'General' or no
    // programme means the whole Centre.
    function resourceVisible(resCourse, studentCourse, sameProgramme) {
      var rc = Core.normCourse(resCourse);
      if (!rc || rc === 'general' || rc === 'all' || rc === 'all programmes' || rc === 'all courses') return true;
      if (!studentCourse) return false;
      return !!(sameProgramme && sameProgramme(studentCourse, resCourse));
    }

    return {
      DEFAULT_WEIGHT: DEFAULT_WEIGHT, MAX_FILE_BYTES: MAX_FILE_BYTES,
      localDateStr: localDateStr, isDateOnly: isDateOnly, parseLocalDate: parseLocalDate,
      isPastDue: isPastDue, daysUntil: daysUntil,
      gradeValue: gradeValue, percentOf: percentOf, weightOf: weightOf, weightedAverage: weightedAverage,
      gpaFromPercent: gpaFromPercent, effectiveGpa: effectiveGpa, studentSummary: studentSummary,
      gradebook: gradebook, gradebookCsv: gradebookCsv,
      recordGrade: recordGrade, submissionHistory: submissionHistory, latestSubmission: latestSubmission,
      latestPerStudent: latestPerStudent, canSubmit: canSubmit, oversizeFiles: oversizeFiles,
      resourceVisible: resourceVisible
    };
  })();

  // ===================== THE CENTRE'S FIGURES: one rule per figure =====================
  // The administrator's dashboard, Reports and the CMC board's screens each
  // counted the Centre their own way, out of the same records: attendance over
  // every record (applicants who never attended counted as 0%), completion as
  // certified over everyone ever enrolled (running intakes and applicants
  // included), the exam pass rate with work still awaiting marking counted as
  // a fail — or, worse, a "pass rate" read from a GPA typed by hand that
  // nobody had typed (20% overall, 0% for every running programme). The audit
  // measured the same Centre at 76% / 84% attendance, 20% / 67% completion and
  // 67% / 73% exam passes depending on the screen. These are the rules, once;
  // each figure says what it is a rate OF ("84% of 60 active").
  Core.centreFigures = (function () {
    function stageOf(s) {
      var st = String((s && s.stage) || '').trim().toLowerCase().replace(/\s+/g, '');
      return st === 'intraining' ? 'training' : st;
    }
    // Testing or interview: not admitted yet.
    function isApplicant(s) { var st = stageOf(s); return st === 'testing' || st === 'interview'; }
    // A dropout: Incomplete, or marked so on the enrolment register.
    function isDropout(s) { return stageOf(s) === 'incomplete' || String((s && s.enrolStatus) || '').toLowerCase() === 'dropout'; }
    // In training now (a record with no stage at all is read as in training,
    // as the invigilator's roll reads it).
    function isActive(s) { var st = stageOf(s); return !!s && (st === 'training' || st === '') && !isDropout(s); }
    function isCertified(s) { var st = stageOf(s); return st === 'certified' || st === 'collected'; }
    function list(a) { return (Array.isArray(a) ? a : []).filter(Boolean); }
    function rate(n, d, dp) { if (!d) return null; var f = Math.pow(10, dp || 0); return Math.round(n / d * 100 * f) / f; }
    function figure(v) {
      if (v == null || v === '') return null;
      var n = typeof v === 'number' ? v : parseFloat(v);
      return isFinite(n) ? n : null;
    }

    /* "Total Enrolled" is everyone on the roll; "Active" those in training. */
    function enrolment(students) {
      var l = list(students);
      return { total: l.length, active: l.filter(isActive).length, applicants: l.filter(isApplicant).length,
        certified: l.filter(isCertified).length, dropouts: l.filter(isDropout).length };
    }
    /* Attendance: the average of ACTIVE trainees' attendance (pctOf(s), by
       default their recorded s.attendance), over those with a figure.
       -> { rate, of, active } */
    function attendance(students, pctOf) {
      var act = list(students).filter(isActive), vals = [];
      act.forEach(function (s) { var v = figure(pctOf ? pctOf(s) : s.attendance); if (v != null) vals.push(v); });
      return { rate: vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : null, of: vals.length, active: act.length };
    }
    /* Completion and dropout: over the trainees of intakes that have ENDED
       (endedOf(s) — their course is over), applicants never admitted left out.
       A running intake has not completed or failed to yet.
       -> { rate, of, certified } / { rate (one decimal), of, dropouts } */
    function endedPopulation(students, endedOf) {
      return list(students).filter(function (s) { return !isApplicant(s) && typeof endedOf === 'function' && !!endedOf(s); });
    }
    function completion(students, endedOf) {
      var pop = endedPopulation(students, endedOf), done = pop.filter(isCertified).length;
      return { rate: rate(done, pop.length), of: pop.length, certified: done };
    }
    function dropout(students, endedOf) {
      var pop = endedPopulation(students, endedOf), out = pop.filter(isDropout).length;
      return { rate: rate(out, pop.length, 1), of: pop.length, dropouts: out };
    }
    /* Exam passes: over MARKED results only (Core.exams.isFinal — one still
       awaiting marking, or archived, is not a result yet). opts.studentIds
       narrows it to some trainees (a programme's roll).
       -> { rate, of, passed, awaiting } */
    function examPass(results, opts) {
      opts = opts || {};
      var ids = null;
      if (opts.studentIds) { ids = {}; opts.studentIds.forEach(function (id) { ids[String(id)] = 1; }); }
      var mine = list(results).filter(function (r) { return !r.archived && (!ids || ids[String(r.studentId)]); });
      var marked = mine.filter(function (r) { return Core.exams.isFinal(r); });
      var passed = marked.filter(function (r) { return !!r.passed; }).length;
      return { rate: rate(passed, marked.length), of: marked.length, passed: passed, awaiting: mine.length - marked.length };
    }
    /* Instructors: the Centre's instructor records and the accounts that
       carry the instructor role, one per name. */
    function instructorCount(records, accounts) {
      var seen = {};
      list(records).forEach(function (i) { var n = String(i.name || '').trim().toLowerCase(); if (n) seen[n] = 1; });
      list(accounts).forEach(function (u) {
        if (u.role !== 'instructor') return;
        var n = String(u.name || '').trim().toLowerCase();
        if (n) seen[n] = 1;
      });
      return Object.keys(seen).length;
    }
    /* A rate with what it is a rate of: "84% of 60 active",
       "— (no marked results yet)" when there is nothing to divide. */
    function rateText(f, noun, none) {
      if (!f || f.rate == null) return '— (' + (none || 'none yet') + ')';
      return f.rate + '% of ' + f.of + ' ' + noun;
    }
    return { isApplicant: isApplicant, isActive: isActive, isDropout: isDropout, isCertified: isCertified,
      enrolment: enrolment, attendance: attendance, completion: completion, dropout: dropout, examPass: examPass,
      instructorCount: instructorCount, rateText: rateText };
  })();

  // ===================== A TRAINEE'S CONTACT DETAILS FROM THEIR ACCOUNT =====================
  // The email and telephone typed when a trainee account is made (by the
  // office, or by the trainee registering from home) stayed on the account:
  // the trainee record and the fee record were created without them, so the
  // enrolment register read "— —" and the office had no number to call.
  // They are now carried across — filling ONLY what is blank: a value
  // somebody already typed is never replaced.
  Core.traineeContact = (function () {
    function blank(v) { return v == null || String(v).trim() === ''; }
    /* record: a trainee record ({email, phone}) or a fee record — map gives
       the record's own field names, e.g. { email: 'email', phone: 'contact' }.
       Returns the record fields it filled. */
    function fillFromAccount(record, account, map) {
      var out = [];
      if (!record || !account) return out;
      map = map || { email: 'email', phone: 'phone' };
      ['email', 'phone'].forEach(function (k) {
        var to = map[k], v = account[k];
        if (!to || blank(v) || !blank(record[to])) return;
        record[to] = String(v).trim();
        out.push(to);
      });
      return out;
    }
    return { fillFromAccount: fillFromAccount, FEE_FIELDS: { email: 'email', phone: 'contact' } };
  })();

  // ===================== RECEIPT NUMBERS: a number already given =====================
  // Receipt numbers are typed by hand on School Fee, and the same number was
  // accepted for two trainees without a word ("R-0412" twice: two receipt
  // PDFs with one number). It is not refused — a parent may pay for two
  // trainees on one receipt — but the page asks first. Blank numbers are not
  // compared (how they are generated is unchanged).
  Core.receiptNumbers = (function () {
    function key(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
    /* The payment (other than exceptId) that already carries this receipt
       number, trimmed and case-insensitively; null when none. */
    function usedBy(payments, number, exceptId) {
      var k = key(number);
      if (!k) return null;
      var list = Array.isArray(payments) ? payments : [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p && key(p.receiptNumber) === k && (exceptId == null || String(p.id) !== String(exceptId))) return p;
      }
      return null;
    }
    /* "Receipt R-0412 is already used for Ann Brown on 2026-10-12. Use it again?" */
    function question(number, p) {
      return 'Receipt ' + String(number).trim() + ' is already used for ' + (p.studentName || 'another payment') + (p.date ? ' on ' + p.date : '') + '. Use it again?';
    }
    return { usedBy: usedBy, question: question };
  })();

  // ===================== COMMUNICATIONS: announcements, agenda, bell =====================
  Core.comms = (function () {
    var CW = Core.coursework;

    function stampOf(r) { return Date.parse(r && (r.updatedAt || r.createdAt) || '') || 0; }

    // Newest first: by the announcement's date, then its last edit. Always on a
    // copy — the shared list's order is what sync and the delete buttons see.
    function sortAnnouncements(list) {
      return (list || []).slice().sort(function (a, b) {
        var da = String(a && a.date || ''), db = String(b && b.date || '');
        if (da !== db) return da < db ? 1 : -1;
        var sa = stampOf(a), sb = stampOf(b);
        if (sa !== sb) return sb - sa;
        return String(b && b.id || '').localeCompare(String(a && a.id || ''));
      });
    }

    var ALL = ['admin', 'instructor', 'student'];
    // Is this announcement (or calendar event) for this viewer? A record with
    // no `course` is for every programme, as every record was before the field.
    function forViewer(rec, role, course, sameProgramme) {
      if (!rec) return false;
      var roles = Array.isArray(rec.forRoles) && rec.forRoles.length ? rec.forRoles : ALL;
      var ok = roles.indexOf(role) !== -1 || (role === 'adminstaff' && roles.indexOf('admin') !== -1);
      if (!ok) return false;
      if (role === 'student' && rec.course) {
        if (!course) return false;
        return !!(sameProgramme && sameProgramme(course, rec.course));
      }
      return true;
    }

    function excerpt(text, n) {
      var s = String(text == null ? '' : text);
      return s.length > n ? s.slice(0, n).replace(/\s+$/, '') + '…' : s;
    }

    var EVENT_TYPES = ['class', 'exam', 'deadline', 'meeting'];
    var EVENT_ROLES = ['admin', 'adminstaff', 'instructor', 'student'];
    function hhmm(t) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
      if (!m || +m[1] > 23 || +m[2] > 59) return null;
      return pad2(+m[1]) + ':' + m[2];
    }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    // A calendar event the grid can actually show: a real YYYY-MM-DD day, a
    // known type, an audience. The old prompt() flow stored '20/11/2026' as is,
    // announced it to everyone, and it never appeared on any calendar.
    function validateEvent(ev) {
      var errors = [];
      ev = ev || {};
      if (!String(ev.title || '').trim()) errors.push('Enter a title.');
      if (!CW.isDateOnly(ev.date)) errors.push('Choose a date.');
      if (ev.time && !hhmm(ev.time)) errors.push('The time must look like 09:30.');
      if (EVENT_TYPES.indexOf(ev.type) === -1) errors.push('Choose the kind of event.');
      var roles = (ev.forRoles || []).filter(function (r) { return EVENT_ROLES.indexOf(r) !== -1; });
      if (!roles.length) errors.push('Choose at least one audience.');
      return { ok: errors.length === 0, errors: errors };
    }

    // Everything a trainee has coming up, worked out when the page is drawn
    // from what is already stored — exams, assignment due dates, class sessions
    // and calendar events — so nothing is copied and nothing can go stale.
    // opts: { course, calendarEvents, exams, assignments, classSessions, sameProgramme }
    function studentAgenda(opts) {
      opts = opts || {};
      var course = opts.course, same = opts.sameProgramme || function () { return false; };
      var mine = function (c) { return !!c && !!course && same(course, c); };
      var out = [];
      (opts.calendarEvents || []).forEach(function (e) {
        if (!e || !CW.isDateOnly(e.date)) return;
        if (!forViewer(e, 'student', course, same)) return;
        out.push({ kind: e.type === 'deadline' ? 'deadline' : (e.type || 'event'), type: e.type || 'meeting', date: e.date, time: e.time || '',
          title: e.title || 'Event', color: e.color || '', source: 'calendar', ref: e });
      });
      (opts.exams || []).forEach(function (x) {
        if (!x || !CW.isDateOnly(x.date) || !mine(x.course)) return;
        if (x.status === 'draft' || x.status === 'cancelled') return;
        out.push({ kind: 'exam', type: 'exam', date: x.date, time: x.time || '', title: x.title || 'Exam', color: 'var(--red)', source: 'exam', ref: x });
      });
      (opts.assignments || []).forEach(function (a) {
        if (!a || !CW.isDateOnly(a.dueDate) || !mine(a.course)) return;
        out.push({ kind: 'deadline', type: 'deadline', date: a.dueDate, time: '', title: (a.title || 'Assignment') + ' due', color: 'var(--accent)', source: 'assignment', ref: a });
      });
      (opts.classSessions || []).forEach(function (s) {
        if (!s || !CW.isDateOnly(s.date) || !mine(s.course)) return;
        out.push({ kind: 'class', type: 'class', date: s.date, time: s.time || '', title: s.name || s.title || 'Class', color: 'var(--blue)', source: 'class', ref: s });
      });
      return out.sort(function (a, b) {
        return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.time).localeCompare(String(b.time));
      });
    }

    // From today on, soonest first, on a copy.
    function upcoming(items, today, n) {
      var t = today || CW.localDateStr(new Date());
      var list = (items || []).filter(function (e) { return e && CW.isDateOnly(e.date) && e.date >= t; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.time || '').localeCompare(String(b.time || '')); });
      return n == null ? list : list.slice(0, n);
    }

    // ---- The bell: read and cleared are each person's own ----
    // The list is shared by everyone. A shared `read` flag meant one person
    // opening a notice marked it read for all, and "Clear all" deleted the
    // records — other trainees' personal notices included. Each viewer now
    // gets their own mark on the record; nothing is deleted.
    function has(list, id) { return Array.isArray(list) && list.indexOf(id) !== -1; }
    function isRead(n, uid) {
      if (!n) return true;
      // `read: true` is from before per-person marks (nobody knows who read
      // it) and stays read; new notices start `read: false` and only gain
      // names in readBy.
      return n.read === true || has(n.readBy, uid);
    }
    function isCleared(n, uid) { return !!n && has(n.clearedBy, uid); }
    function markRead(n, uid) {
      if (!n || uid == null) return false;
      if (!Array.isArray(n.readBy)) n.readBy = [];
      if (has(n.readBy, uid)) return false;
      n.readBy.push(uid);
      return true;
    }
    function markCleared(n, uid) {
      if (!n || uid == null) return false;
      markRead(n, uid);
      if (!Array.isArray(n.clearedBy)) n.clearedBy = [];
      if (has(n.clearedBy, uid)) return false;
      n.clearedBy.push(uid);
      return true;
    }

    // Duty-register reminders get one id per task per hour, so every admin
    // device that notices the same overdue task produces the SAME record and
    // the sync collapses them into one.
    function reminderId(kind, taskId, when) {
      var d = when instanceof Date ? when : new Date(when == null ? Date.now() : when);
      return 'ADR-REM-' + kind + '-' + String(taskId) + '-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours());
    }

    // A small send budget: at most `perWindow` sends in `windowMs`.
    function allowSend(history, nowMs, perWindow, windowMs) {
      var now = nowMs == null ? Date.now() : nowMs;
      var recent = (history || []).filter(function (t) { return now - t < windowMs; });
      return { ok: recent.length < perWindow, history: recent };
    }

    return {
      sortAnnouncements: sortAnnouncements, forViewer: forViewer, excerpt: excerpt,
      EVENT_TYPES: EVENT_TYPES, EVENT_ROLES: EVENT_ROLES, validateEvent: validateEvent, normTime: hhmm,
      studentAgenda: studentAgenda, upcoming: upcoming,
      isRead: isRead, isCleared: isCleared, markRead: markRead, markCleared: markCleared,
      reminderId: reminderId, allowSend: allowSend
    };
  })();

  // ===================== CHAT: membership, presence, calls, realtime =====================
  Core.chat = (function () {
    function ms(v) { var t = Date.parse(v || ''); return isFinite(t) ? t : 0; }

    // Who belongs in a class room now. Staff always; instructors and trainees
    // while their programme is the room's; anyone an administrator added by
    // hand; never anyone an administrator removed (until re-added). People
    // whose programme moved on leave — written down in `leavers`, their
    // messages untouched.
    // opts: { accounts, eligible(u), programmeMatches(u) }
    function classRoomMembers(room, opts) {
      var removed = (room && room.removed) || {};
      var manual = (room && room.manualMembers) || {};
      var byId = {};
      (opts.accounts || []).forEach(function (u) { if (u && u.id != null) byId[u.id] = u; });
      var isStaff = function (u) { return u && (u.role === 'admin' || u.role === 'adminstaff'); };
      var set = {}, order = [], leavers = [];
      function add(id) { if (!set[id]) { set[id] = true; order.push(id); } }
      ((room && room.members) || []).forEach(function (id) {
        if (removed[id]) return;
        var u = byId[id];
        if (manual[id] || !u) { add(id); return; }            // hand-added, or an account this device has not got yet
        if ((u.role === 'student' || u.role === 'instructor') && !u.programme) { add(id); return; } // programme unknown is not "moved on"
        if (isStaff(u) || ((u.role === 'student' || u.role === 'instructor') && opts.programmeMatches(u))) { add(id); return; }
        if (u.role !== 'student' && u.role !== 'instructor') { add(id); return; }
        leavers.push(id);
      });
      (opts.accounts || []).forEach(function (u) {
        if (!u || removed[u.id] || !opts.eligible(u)) return;
        if (isStaff(u)) add(u.id);
        else if ((u.role === 'student' || u.role === 'instructor') && opts.programmeMatches(u)) add(u.id);
      });
      return { members: order, leavers: leavers };
    }

    // Presence is a heartbeat, not a flag: 'online' was set on opening the
    // chat and never unset, so everyone who ever opened it was "online"
    // forever and every device dialled all of them every 20 seconds.
    var ONLINE_WINDOW_MS = 10 * 60 * 1000;
    function isOnline(profile, nowMs) {
      if (!profile || profile.status === 'offline') return false;
      var seen = ms(profile.lastSeen);
      return seen > 0 && (nowMs == null ? Date.now() : nowMs) - seen < ONLINE_WINDOW_MS;
    }

    // ---- Calls ----
    // A call's state is written by several devices at once. Each person's
    // own entry is kept apart (seen = heartbeat, left = when they hung up) so
    // two people joining together are both kept, a joiner who never got a
    // microphone is never listed, and a caller who closed the laptop stops
    // being "in the call" once their heartbeat goes quiet.
    var CALL_STALE_MS = 90 * 1000;
    var LEGACY_CALL_MS = 10 * 60 * 1000;
    function callKey(call) { return call ? String(call.startedAt || '') + '|' + String(call.startedBy || '') : ''; }
    function liveParticipants(call, nowMs) {
      if (!call) return [];
      var now = nowMs == null ? Date.now() : nowMs;
      var seen = call.seen || {}, left = call.left || {};
      var ids = Object.keys(seen);
      if (!ids.length) {
        // A call written before heartbeats: trust its list for a short while only.
        return now - ms(call.startedAt) < LEGACY_CALL_MS ? (call.participants || []).slice() : [];
      }
      return ids.filter(function (id) {
        var s = ms(seen[id]);
        return s > ms(left[id]) && now - s < CALL_STALE_MS;
      });
    }
    function normalise(call, nowMs) {
      if (!call) return null;
      var c = {};
      Object.keys(call).forEach(function (k) { c[k] = call[k]; });
      c.seen = Object.assign({}, call.seen || {});
      c.left = Object.assign({}, call.left || {});
      c.participants = liveParticipants(c, nowMs);
      return c.participants.length ? c : null;
    }
    function newest(a, b) { return ms(a) >= ms(b) ? a : b; }
    function mergeActiveCall(a, b, nowMs) {
      if (!a && !b) return null;
      if (!a || !b) return normalise(a || b, nowMs);
      if (callKey(a) !== callKey(b)) {
        // Two different calls: the later one, if anyone is still in it.
        var first = ms(a.startedAt) >= ms(b.startedAt) ? a : b, second = first === a ? b : a;
        return normalise(first, nowMs) || normalise(second, nowMs);
      }
      var m = {};
      Object.keys(b).forEach(function (k) { m[k] = b[k]; });
      Object.keys(a).forEach(function (k) { m[k] = a[k]; });
      m.seen = {}; m.left = {};
      [a, b].forEach(function (c) {
        Object.keys(c.seen || {}).forEach(function (id) { m.seen[id] = m.seen[id] ? newest(m.seen[id], c.seen[id]) : c.seen[id]; });
        Object.keys(c.left || {}).forEach(function (id) { m.left[id] = m.left[id] ? newest(m.left[id], c.left[id]) : c.left[id]; });
      });
      if (!Object.keys(m.seen).length) {
        var u = {};
        (a.participants || []).concat(b.participants || []).forEach(function (id) { u[id] = true; });
        m.participants = Object.keys(u);
      }
      return normalise(m, nowMs);
    }
    function joinCall(call, uid, nowIso) {
      if (!call || uid == null) return call;
      if (!call.seen) call.seen = {};
      call.seen[uid] = nowIso || new Date().toISOString();
      if (!Array.isArray(call.participants)) call.participants = [];
      if (call.participants.indexOf(uid) === -1) call.participants.push(uid);
      return call;
    }
    function leaveCall(call, uid, nowIso) {
      if (!call || uid == null) return call;
      if (!call.left) call.left = {};
      call.left[uid] = nowIso || new Date().toISOString();
      call.participants = (call.participants || []).filter(function (id) { return id !== uid; });
      return call;
    }

    // ---- Realtime fast-lane ----
    // The realtime channel runs over a public broker, so what arrives on it is
    // only believed this far: a plain text message, for a room this device
    // already has, from a member of that room who is the sender it claims to
    // be. Rooms are never created from it; files, polls and calls arrive only
    // with the Drive copy.
    function acceptRealtimeMessage(raw, fromUid, room, myId) {
      if (!raw || typeof raw !== 'object' || !room || !fromUid) return null;
      var members = Array.isArray(room.members) ? room.members : (room.dmBetween || []);
      if (members.indexOf(myId) === -1 || members.indexOf(fromUid) === -1) return null;
      if (raw.senderId !== fromUid || raw.roomId !== room.id) return null;
      if ((raw.type || 'text') !== 'text' || typeof raw.text !== 'string' || raw.id == null) return null;
      var ts = ms(raw.timestamp);
      return {
        id: String(raw.id).slice(0, 80), roomId: room.id, senderId: fromUid,
        senderName: String(raw.senderName == null ? '' : raw.senderName).slice(0, 120),
        text: raw.text.slice(0, 5000), type: 'text',
        timestamp: ts ? new Date(ts).toISOString() : new Date().toISOString(),
        readBy: [fromUid]
      };
    }

    // Unread = newer than my last-read mark (kept on my own profile, which only
    // I write) and not sent by me; the old per-message readBy still counts.
    function unreadCount(msgs, myId, lastReadIso) {
      var lr = ms(lastReadIso), n = 0;
      for (var i = (msgs || []).length - 1; i >= 0; i--) {
        var m = msgs[i];
        if (!m) continue;
        if (m.senderId === myId) break;
        if (lr && ms(m.timestamp) <= lr) break;
        if (Array.isArray(m.readBy) && m.readBy.indexOf(myId) !== -1) continue;
        n++;
      }
      return n;
    }

    // What goes to Drive: an attachment that already has its own Drive copy
    // travels as that link only. A file whose upload has not happened yet keeps
    // its bytes — they are the only copy.
    function stripUploadedBytes(messagesByRoom) {
      var out = {};
      Object.keys(messagesByRoom || {}).forEach(function (rid) {
        out[rid] = (messagesByRoom[rid] || []).map(function (m) {
          if (!m || !m.driveFileId || (m.fileData == null && m.imageData == null)) return m;
          var c = {};
          Object.keys(m).forEach(function (k) { if (k !== 'fileData' && k !== 'imageData') c[k] = m[k]; });
          return c;
        });
      });
      return out;
    }

    // ---- Rooms that arrive from other devices ----
    // A room's icon and colour are drawn into every member's room list and
    // chat header — the Administrator's too, the session that holds the
    // Centre's Drive token. Rooms come from whatever device last wrote the
    // chat file or the backup, and the header set innerHTML = room.icon, so a
    // trainee's device could put markup in a room's icon and have it run in the
    // Administrator's session the moment the room was opened. An icon is a
    // short run of emoji or plain characters, never markup; a colour is a hex
    // colour, a theme variable or a colour name — never a way out of a style
    // attribute. Anything else gets the default.
    var ROOM_ICON = '💬', ROOM_COLOR = '#6c757d';
    function roomIcon(icon) {
      var s = (typeof icon === 'string' || typeof icon === 'number') ? String(icon).trim() : '';
      if (!s || /[<>&"'`\\\u0000-\u001f]/.test(s)) return ROOM_ICON;
      var n = typeof Array.from === 'function' ? Array.from(s).length : s.length;
      return n <= 16 ? s : ROOM_ICON;
    }
    function roomColor(color) {
      var s = typeof color === 'string' ? color.trim() : '';
      if (/^#[0-9a-f]{3,8}$/i.test(s) || /^var\(--[a-z0-9-]{1,40}\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s) ||
          /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s\/]{1,60}\)$/i.test(s)) return s;
      return ROOM_COLOR;
    }
    /* Make a room safe to draw, in place. Only icon and colour are touched,
       and only when they are not safe already. Returns true if it changed. */
    function cleanRoom(room) {
      if (!room || typeof room !== 'object') return false;
      var changed = false;
      var icon = roomIcon(room.icon), color = roomColor(room.color);
      // A field the room does not have is left absent (direct messages carry
      // no icon), so nothing is added to a record that did not need it.
      if (room.icon != null && room.icon !== icon) { room.icon = icon; changed = true; }
      if (room.color != null && room.color !== color) { room.color = color; changed = true; }
      return changed;
    }
    function cleanRooms(rooms) {
      var n = 0;
      (Array.isArray(rooms) ? rooms : []).forEach(function (r) { if (cleanRoom(r)) n++; });
      return n;
    }

    return {
      classRoomMembers: classRoomMembers, isOnline: isOnline, ONLINE_WINDOW_MS: ONLINE_WINDOW_MS,
      CALL_STALE_MS: CALL_STALE_MS, callKey: callKey, liveParticipants: liveParticipants,
      mergeActiveCall: mergeActiveCall, joinCall: joinCall, leaveCall: leaveCall,
      acceptRealtimeMessage: acceptRealtimeMessage, unreadCount: unreadCount, stripUploadedBytes: stripUploadedBytes,
      roomIcon: roomIcon, roomColor: roomColor, cleanRoom: cleanRoom, cleanRooms: cleanRooms
    };
  })();

  /* ==========================================================================
     THE TRAINEE GATE — the rules (docs/trainee-gate/DESIGN.md, Stage 1)

     The owner's decision: each trainee's own phone or a lab PC gets ONLY that
     trainee's records. Staff devices publish one "slice" per trainee into a
     folder named with the trainee's student ID; a small gatekeeper under the
     Centre's own account hands each trainee's device its own slice and
     nothing else, takes back what the trainee sends, and marks tests from an
     answer-key file the trainee's device never sees. The Centre's own machine
     answers the same questions on its network.

     These are the rules every one of those places runs: pure and
     synchronous, no storage, no network, no clock of their own (the time is
     always handed in). Nothing calls them until the gate is set up and
     switched on — until then the platform behaves exactly as before.

     Cryptography is handed in, so the same rules run in a browser, in Node
     and in the gatekeeper's own script:
       crypto.hmacHex(keyBytes, msg)  HMAC-SHA256 of the UTF-8 text msg, as hex
       crypto.sha256Hex(msg)          SHA-256 of the UTF-8 text msg, as hex
       crypto.sha1Bytes(bytes)        SHA-1 of a byte array, as 20 bytes
                                      (two-step codes: HMAC-SHA1 is built on it)
     A key is always the UTF-8 bytes of its text — a hex secret is used as
     written, never decoded — so every side derives the same bytes. Building
     slices, papers and key files needs no cryptography at all, so a staff
     device publishes with the ordinary page code.
     ========================================================================== */

  /* The trainee's copy of a published paper, for one attempt.

     A paper (Core.gate.buildPaper) already carries the public questions: no
     keys, and each matching question's prompts (rows) and answers to choose
     from (choices), worked out by the publisher. attemptQuestions() cannot be
     run on it a second time — it works rows and choices out again from the
     pairs, which a paper does not have, and leaves them empty. This shuffles
     what the paper carries by the same rules: information items stay where
     staff put them, a shuffled question records the ORIGINAL index of the
     option shown in each place (optionOrder), and a matching question's
     choices are shuffled when the exam shuffles its options. Anything that
     would give an answer away is dropped even if a paper carried it. */
  Core.exams.attemptQuestionsFromPaper = function (questions, opts) {
    opts = opts || {};
    var random = typeof opts.random === 'function' ? opts.random : Math.random;
    var KEY = { correctAnswer: 1, pairs: 1, distractors: 1, tolerance: 1 };
    var shuffle = function (list) {
      for (var i = list.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1));
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list;
    };
    var qs = (Array.isArray(questions) ? questions : []).map(function (q) {
      var c = {};
      Object.keys(q && typeof q === 'object' ? q : {}).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(KEY, k) && q[k] !== undefined) c[k] = JSON.parse(JSON.stringify(q[k]));
      });
      return c;
    });
    if (opts.shuffleQuestions) {
      var slots = [], movable = [];
      qs.forEach(function (q, i) { if (!(q && q.type === 'info')) { slots.push(i); movable.push(q); } });
      shuffle(movable);
      slots.forEach(function (at, k) { qs[at] = movable[k]; });
    }
    if (opts.shuffleOptions) {
      qs.forEach(function (q) {
        if ((q.type === 'mcq' || q.type === 'multi') && Array.isArray(q.options) && q.options.length > 1) {
          q.optionOrder = shuffle(q.options.map(function (_, k) { return k; }));
        } else if (q.type === 'match' && Array.isArray(q.choices)) {
          q.choices = shuffle(q.choices.slice());
        }
      });
    }
    return qs;
  };

  /* Do two programmes name the same programme — a trainee's and an
     instructor's, an assignment's, a class's, an announcement's? The exact
     name, or the same training centre as findSkill resolves each of them.
     This is the dashboard's instructorCourseMatch, moved here unchanged so the
     gate decides "this trainee's programme" exactly as the trainee's own
     portal does: the dashboard passes its findSkillAreaForCourse, the gate
     the shared Core.enrolment.findCentre over the Centre's skill areas. The
     answer is whatever the old function answered (a truthy or falsy value). */
  Core.enrolment.courseMatch = function (studentCourse, instructorCourse, findSkill) {
    if (!studentCourse || !instructorCourse) return false;
    if (studentCourse.toLowerCase().trim() === instructorCourse.toLowerCase().trim()) return true;
    if (typeof findSkill !== 'function') return false;
    var stuSk = findSkill(studentCourse);
    var insSk = findSkill(instructorCourse);
    return stuSk && insSk && stuSk.id && insSk.id && stuSk.id === insSk.id;
  };

  Core.gate = (function () {
    var VERSION = 1;
    var FORMAT = {
      slice: 'cestis-trainee-slice', paper: 'cestis-exam-paper', key: 'cestis-exam-key',
      room: 'cestis-chat-room', inbox: 'cestis-trainee-inbox', result: 'cestis-gate-result',
      registration: 'cestis-registration', catalogue: 'cestis-programme-catalogue'
    };
    /* Keys that describe THIS device's part in the gate. None of them may
       ever reach another device: the master snapshot (Core.isSnapshotableKey)
       and the Centre network's whole-store mirror (cestis-page-cloud.js
       DEVICE_KEYS) both leave them out. */
    var DEVICE_KEYS = [
      'cestisGateNs',            // which store namespace this browser opens (the switch itself)
      'cestisGateMode',          // this page is a gate session
      'cestisGateToken',         // the gate session's token
      'cestisGateSessionKey',    // the key that seals what the trainee sends
      'cestisGateAddress',       // the gate's address, from the trainee's link or QR code
      'cestisDeviceKind',        // 'staff' once a staff member has signed in here
      'cestisGatePublished',     // what this staff device last published, and where
      'cestisGatePublishQueue',  // the publisher's writes still to make
      'cestisGateCollected',     // what this staff device has already collected
      'cestisGateUnassigned',    // trainee work waiting for an administrator's decision
      'cestisGateQuarantine',    // another trainee's unsent work, held until they sign in here
      'cestisStudentIdMoves'     // student IDs this device saw move (rename/transfer): old → current
    ];
    // A key written inside a gate namespace ('g1::voctrain_students').
    var NS_KEY = /^g[0-9]{1,3}::/;
    // Anything that would give an answer away. Never in a slice or a paper.
    var KEY_NAMES = { correctAnswer: 1, pairs: 1, distractors: 1, tolerance: 1 };

    var hasOwn = Object.prototype.hasOwnProperty;
    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
    function str(v) { return v == null ? '' : String(v); }
    function lower(v) { return str(v).trim().toLowerCase(); }
    function msOf(v) {
      if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0;
      var t = Date.parse(v || '');
      return isFinite(t) && t > 0 ? t : 0;
    }
    function iso(ms) { return new Date(ms).toISOString(); }
    function dict() { return Object.create(null); }
    function pick(rec, fields) {
      var o = {};
      fields.forEach(function (f) { if (rec && rec[f] !== undefined) o[f] = copy(rec[f]); });
      return o;
    }
    function uniqSorted(list) {
      var seen = dict(), out = [];
      (list || []).forEach(function (x) { var s = str(x); if (s && !seen[s]) { seen[s] = 1; out.push(s); } });
      return out.sort();
    }

    /* ---- Canonical text: sorted keys, recursively — the same output as
       MegaData.canon (megadata/schemas.js), so a seal or a hash computed on
       either side of the gate agrees byte for byte. ---- */
    function canon(value) {
      if (value === null) return 'null';
      var t = typeof value;
      if (t === 'number') {
        if (!isFinite(value)) throw new Error('canon: non-finite number');
        if (Object.is(value, -0)) value = 0;
        return JSON.stringify(value);
      }
      if (t === 'boolean' || t === 'string') return JSON.stringify(value);
      if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
      if (t === 'object') {
        var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
        return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(value[k]); }).join(',') + '}';
      }
      throw new Error('canon: unsupported type ' + t);
    }
    // The content hash every publisher and reader compares ('h1-…').
    function hashOf(v) { return 'h1-' + Core.hashString(canon(copy(v))); }

    /* ---- Bytes ---- */
    function utf8(s) {
      s = str(s);
      var out = [];
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          var d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
          if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
          else c = 0xfffd;
        } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return out;
    }
    function fromUtf8(bytes) {
      var s = '', i = 0;
      while (i < bytes.length) {
        var b = bytes[i++], c;
        if (b < 0x80) c = b;
        else if (b >= 0xc0 && b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
        else if (b >= 0xe0 && b < 0xf0) { c = ((b & 15) << 12) | ((bytes[i] & 63) << 6) | (bytes[i + 1] & 63); i += 2; }
        else { c = ((b & 7) << 18) | ((bytes[i] & 63) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3; }
        if (c > 0xffff) { c -= 0x10000; s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
        else s += String.fromCharCode(c);
      }
      return s;
    }
    function utf8Length(s) { return utf8(s).length; }
    function toHex(bytes) {
      var h = '';
      for (var i = 0; i < bytes.length; i++) h += ((bytes[i] & 255) | 256).toString(16).slice(1);
      return h;
    }
    function fromHex(hex) {
      var s = str(hex), out = [];
      if (s.length % 2 || /[^0-9a-f]/i.test(s)) return null;
      for (var i = 0; i < s.length; i += 2) out.push(parseInt(s.substr(i, 2), 16));
      return out;
    }
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    function b64url(bytes) {
      var out = '', i;
      for (i = 0; i + 2 < bytes.length; i += 3) {
        var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64.charAt(n >> 18 & 63) + B64.charAt(n >> 12 & 63) + B64.charAt(n >> 6 & 63) + B64.charAt(n & 63);
      }
      if (bytes.length - i === 1) {
        out += B64.charAt(bytes[i] >> 2) + B64.charAt((bytes[i] & 3) << 4);
      } else if (bytes.length - i === 2) {
        var m = (bytes[i] << 8) | bytes[i + 1];
        out += B64.charAt(m >> 10) + B64.charAt(m >> 4 & 63) + B64.charAt((m & 15) << 2);
      }
      return out;
    }
    function unb64url(s) {
      s = str(s);
      if (/[^A-Za-z0-9_-]/.test(s) || s.length % 4 === 1) return null;
      var out = [], bits = 0, val = 0;
      for (var i = 0; i < s.length; i++) {
        val = (val << 6) | B64.indexOf(s.charAt(i)); bits += 6;
        if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); val &= (1 << bits) - 1; }
      }
      return out;
    }
    /* Equal texts, compared in a time that does not depend on where they
       first differ. */
    function same(a, b) {
      a = str(a); b = str(b);
      var diff = a.length ^ b.length;
      for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
      return diff === 0;
    }
    function need(c, fn) {
      if (!c || typeof c[fn] !== 'function') throw new Error('Core.gate: crypto.' + fn + ' is required');
      return c;
    }
    function hmac(c, key, msg) { return str(need(c, 'hmacHex').hmacHex(utf8(key), str(msg))).toLowerCase(); }

    /* ---- Sessions (§4.4) ------------------------------------------------
       Token:  v1.<base64url(canon {a, s, sid, iat, exp, cv})>.<HMAC hex>
       The account (a), its student ID when signed in (s), the session (sid),
       issued / expires (ms), and cv — the account's credential version: a
       password reset, a switch-off or a two-step change gives a new cv, and
       every token carrying the old one stops working within the minute the
       gatekeeper takes to see the accounts list again. */
    var TOKEN_TTL_MS = 12 * 3600 * 1000, TOKEN_REFRESH_MS = 4 * 3600 * 1000;
    function cvOf(account, crypto) {
      var a = account || {};
      var basis = [a.password, a.status, a.disabledAt, a.twoFactorUpdatedAt].map(str).join('|');
      return str(need(crypto, 'sha256Hex').sha256Hex(basis)).toLowerCase().slice(0, 12);
    }
    function tokenClaims(o, nowMs) {
      var iat = Math.floor(typeof o.iat === 'number' ? o.iat : nowMs);
      return { a: str(o.a), s: str(o.s), sid: str(o.sid), iat: iat,
        exp: Math.floor(typeof o.exp === 'number' ? o.exp : iat + TOKEN_TTL_MS), cv: str(o.cv) };
    }
    function signToken(claims, secret, crypto) {
      var body = b64url(utf8(canon(tokenClaims(claims || {}, Date.now()))));
      return 'v1.' + body + '.' + hmac(crypto, secret, 'tok|' + body);
    }
    /* opts: { nowMs, cvOf(accountId) → the account's current cv, or null
       when it may no longer sign in (deleted, not a trainee). } */
    function verifyToken(tok, secret, crypto, opts) {
      opts = opts || {};
      var parts = str(tok).split('.');
      if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !/^[0-9a-f]{64}$/.test(parts[2])) return { ok: false, reason: 'malformed' };
      if (!same(hmac(crypto, secret, 'tok|' + parts[1]), parts[2])) return { ok: false, reason: 'bad-signature' };
      var claims = null;
      try { var bytes = unb64url(parts[1]); claims = bytes ? JSON.parse(fromUtf8(bytes)) : null; } catch (e) { claims = null; }
      if (!isObj(claims) || !claims.a || typeof claims.exp !== 'number') return { ok: false, reason: 'malformed' };
      var now = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
      if (now >= claims.exp) return { ok: false, reason: 'expired', claims: claims };
      if (typeof opts.cvOf === 'function') {
        var cur = opts.cvOf(claims.a);
        if (cur == null) return { ok: false, reason: 'unknown-account', claims: claims };
        if (!same(cur, claims.cv)) return { ok: false, reason: 'revoked', claims: claims };
      }
      return { ok: true, claims: claims, refresh: claims.exp - now < TOKEN_REFRESH_MS };
    }
    /* A session id carries its own issue time and a short seal, so its age
       can be checked without any table of sessions: <iat36>.<rand>.<mac8>. */
    function makeSid(iatMs, rand, secret, crypto) {
      var head = Math.floor(iatMs).toString(36) + '.' + str(rand).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
      return head + '.' + hmac(crypto, secret, 'sid|' + head).slice(0, 8);
    }
    function checkSid(sid, secret, crypto) {
      var m = /^([0-9a-z]+)\.([A-Za-z0-9]{1,24})\.([0-9a-f]{8})$/.exec(str(sid));
      if (!m) return { ok: false, reason: 'malformed' };
      if (!same(hmac(crypto, secret, 'sid|' + m[1] + '.' + m[2]).slice(0, 8), m[3])) return { ok: false, reason: 'bad-signature' };
      return { ok: true, iat: parseInt(m[1], 36) };
    }
    function sessionKey(secret, accountId, sid, crypto) { return hmac(crypto, secret, 'sk|' + str(accountId) + '|' + str(sid)); }

    /* ---- Sealed items (§5.1): every write a trainee makes is sealed with the
       session key, so it can be delivered later by any session on the device
       and nobody can forge one after the session ends. ---- */
    var ITEM_MAX_AGE_MS = 60 * 24 * 3600 * 1000;
    function sealBasis(item) {
      var c = {};
      Object.keys(item || {}).forEach(function (k) { if (k !== 'mac') c[k] = item[k]; });
      return canon(copy(c));
    }
    function seal(item, key, crypto) {
      var out = copy(item);
      delete out.mac;
      out.mac = hmac(crypto, key, sealBasis(out));
      return out;
    }
    function sealOk(item, key, crypto) {
      if (!isObj(item) || typeof item.mac !== 'string') return false;
      return same(hmac(crypto, key, sealBasis(item)), item.mac.toLowerCase());
    }

    /* ---- Password sign-in, as a challenge (§4.1) --------------------------
       The device works the stored hash out itself (PBKDF2 with the stored
       salt, or the legacy SHA-256) and answers HMAC(hash, nonce|login); the
       gatekeeper does one HMAC with the hash it already holds. The password
       never travels, and a captured answer cannot be used twice (the nonce is
       spent). A plaintext or empty stored password is never accepted here. */
    var PBKDF2_ITERATIONS = 210000;
    var PROOF_PREFIX = 'cestis-gate-v1|';
    function parseStored(stored) {
      var s = str(stored);
      if (s.indexOf('pbkdf2$') === 0) {
        var p = s.split('$');
        if (p.length !== 4 || !/^[0-9a-f]+$/i.test(p[2]) || !/^[0-9a-f]+$/i.test(p[3])) return null;
        return { algo: 'pbkdf2-sha256', iter: parseInt(p[1], 10) || PBKDF2_ITERATIONS, salt: p[2].toLowerCase(), verifier: p[3].toLowerCase() };
      }
      if (/^[a-f0-9]{64}$/.test(s)) return { algo: 'sha256-legacy', iter: 0, salt: '', verifier: s };
      return null;
    }
    function proofMessage(nonce, login) { return PROOF_PREFIX + str(nonce) + '|' + lower(login); }
    /* What the device is told to compute. An unknown login gets a salt that
       is the same every time it is asked and looks like any other, so the
       answer does not say whether an account exists. */
    function proofChallenge(stored, login, secret, crypto) {
      var p = parseStored(stored);
      if (p) return { algo: p.algo, iter: p.iter, salt: p.salt };
      return { algo: 'pbkdf2-sha256', iter: PBKDF2_ITERATIONS, salt: hmac(crypto, secret, 'fake|' + lower(login)).slice(0, 32) };
    }
    function proofMake(verifier, nonce, login, crypto) { return hmac(crypto, str(verifier).toLowerCase(), proofMessage(nonce, login)); }
    function proofExpected(stored, nonce, login, crypto) {
      var p = parseStored(stored);
      return p ? proofMake(p.verifier, nonce, login, crypto) : null;
    }
    function proofVerify(stored, nonce, login, proof, crypto) {
      var want = proofExpected(stored, nonce, login, crypto);
      return !!want && typeof proof === 'string' && same(want, proof.toLowerCase());
    }

    /* ---- Two-step codes (RFC 6238): SHA-1, 30-second steps, 6 digits, one
       step either side — what the authenticator apps and the dashboard's own
       check (OTPAuth) use. ---- */
    function base32(s) {
      var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', clean = str(s).replace(/[\s=-]/g, '').toUpperCase();
      if (!clean) return null;
      var out = [], bits = 0, val = 0;
      for (var i = 0; i < clean.length; i++) {
        var x = A.indexOf(clean.charAt(i));
        if (x < 0) return null;
        val = (val << 5) | x; bits += 5;
        if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); val &= (1 << bits) - 1; }
      }
      return out;
    }
    function hmacSha1(key, msg, crypto) {
      need(crypto, 'sha1Bytes');
      var sha1 = function (b) { return Array.prototype.slice.call(crypto.sha1Bytes(b)); };
      var k = Array.prototype.slice.call(key);
      if (k.length > 64) k = sha1(k);
      while (k.length < 64) k.push(0);
      var ipad = k.map(function (b) { return b ^ 0x36; }), opad = k.map(function (b) { return b ^ 0x5c; });
      return sha1(opad.concat(sha1(ipad.concat(Array.prototype.slice.call(msg)))));
    }
    function hotp(keyBytes, counter, digits, crypto) {
      var hi = Math.floor(counter / 4294967296), lo = counter % 4294967296;
      var msg = [hi >>> 24 & 255, hi >>> 16 & 255, hi >>> 8 & 255, hi & 255, lo >>> 24 & 255, lo >>> 16 & 255, lo >>> 8 & 255, lo & 255];
      var h = hmacSha1(keyBytes, msg, crypto), off = h[19] & 15;
      var bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
      var code = String(bin % Math.pow(10, digits));
      while (code.length < digits) code = '0' + code;
      return code;
    }
    function totpKey(secret) { return typeof secret === 'string' ? base32(secret) : (secret ? Array.prototype.slice.call(secret) : null); }
    function totpCode(secret, nowMs, crypto, opts) {
      opts = opts || {};
      var key = totpKey(secret);
      if (!key || !key.length) return null;
      var step = Math.floor(nowMs / 1000 / (opts.period || 30));
      return hotp(key, step, opts.digits || 6, crypto);
    }
    /* { ok, step } — the step the code belongs to, so the gatekeeper can
       refuse the same code twice inside it (opts.used(step) → true). */
    function totpVerify(secret, code, nowMs, crypto, opts) {
      opts = opts || {};
      var digits = opts.digits || 6, period = opts.period || 30, win = opts.window == null ? 1 : opts.window;
      var key = totpKey(secret), c = str(code).replace(/\s+/g, '');
      if (!key || !key.length || !new RegExp('^\\d{' + digits + '}$').test(c)) return { ok: false };
      var base = Math.floor(nowMs / 1000 / period);
      var order = [0];
      for (var w = 1; w <= win; w++) order.push(-w, w);
      for (var i = 0; i < order.length; i++) {
        var step = base + order[i];
        if (step < 0) continue;
        if (same(hotp(key, step, digits, crypto), c)) {
          if (typeof opts.used === 'function' && opts.used(step)) return { ok: false, reason: 'used', step: step };
          return { ok: true, step: step };
        }
      }
      return { ok: false };
    }
    // How a spent backup code is named in a trainee's inbox (never the code itself).
    function codeHash(code) { return 'h1-' + Core.hashString('bc|' + str(code).trim().toUpperCase()); }

    /* ---- Who a login names, and whether they may go on (§4.1–§4.5) -------
       The decisions both gatekeepers make — the online one (trainee-gate/
       Gate.gs) and the Centre server's (Offline System/cestis-offline-
       gate.js) — written once, so the two answer every sign-in alike. Each
       of them used to carry its own copy, kept equal by a test. Pure: the
       cache, the lock-out counters and the clock stay with the gatekeeper. */
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    /* The accounts index: trainee accounts only, deleted ones dropped
       (Core.accountAccess.dropDeleted), one entry per account id — of two
       copies, the one that can sign in (Core.accountLoginScore) — with what
       sign-in needs: the credential version (cv), why it may not sign in, if
       it may not (st: Core.accountAccess.check's reason), its password check
       (pw), whether it is still a published default (sd), its two-step
       secret (tf), whether it signs in with emailed codes (eo) and to which
       address (em), its unused backup codes, trimmed and upper case (bc), its record link
       (sdi) and its name (nm: the gate finds a folder named "<Name> (<student
       ID>)" by that name without a search, §17). Then who answers to each
       username (user) and each email (mail), in lower case.
       → { n, a: { id: entry }, user, mail } */
    function indexAccounts(accounts, deletedUserIds, crypto) {
      var A = Core.accountAccess, del = {};
      (Array.isArray(deletedUserIds) ? deletedUserIds : []).forEach(function (id) { if (id != null && id !== '') del[id] = true; });
      var list = A.dropDeleted(Array.isArray(accounts) ? accounts : [], del).accounts;
      var idx = { n: 0, a: {}, user: {}, mail: {} }, score = {};
      list.forEach(function (acc) {
        if (!isObj(acc) || acc.id == null || acc.id === '' || lower(acc.role) !== 'student') return;
        var id = String(acc.id), sc = Core.accountLoginScore(acc);
        if (idx.a[id] && score[id] >= sc) return;          // the same id twice: the copy that can sign in
        if (!idx.a[id]) idx.n++;
        score[id] = sc;
        var email = str(acc.email).trim();
        idx.a[id] = {
          cv: cvOf(acc, crypto), st: A.check(acc).reason, pw: typeof acc.password === 'string' ? acc.password : '',
          sd: A.isSeededLogin(acc) ? 1 : 0,
          tf: acc.twoFactorEnabled && acc.twoFactorSecret ? str(acc.twoFactorSecret) : '',
          eo: acc.emailOtpLogin && EMAIL_RE.test(email) ? 1 : 0, em: email,
          bc: (Array.isArray(acc.backupCodes) ? acc.backupCodes : []).filter(function (c) { return c && c.code && !c.used; })
            .map(function (c) { return str(c.code).trim().toUpperCase(); }),
          sdi: acc.studentDataId != null ? str(acc.studentDataId) : '',
          nm: str(acc.name).trim()
        };
        var add = function (map, v) { v = lower(v); if (!v) return; map[v] = map[v] || []; if (map[v].indexOf(id) === -1) map[v].push(id); };
        add(idx.user, acc.username); add(idx.mail, acc.email);
      });
      return idx;
    }
    /* Which trainee account a login names: a username or an email, any case
       (opts.emailOnly: an email only). When two trainee accounts answer to it
       and exactly one of them can sign in, that one (as Core.accountAccess
       .find prefers the usable copy; opts.allowNoPassword counts an account
       with no password yet as usable — the email sign-in); otherwise the
       office must sort it out. → { none } | { id, e } | { ambiguous } */
    function lookupLogin(idx, login, opts) {
      opts = opts || {};
      var l = lower(login), ids = [];
      (opts.emailOnly ? [idx.mail] : [idx.user, idx.mail]).forEach(function (m) {
        (m[l] || []).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
      });
      if (!ids.length) return { none: true };
      if (ids.length === 1) return { id: ids[0], e: idx.a[ids[0]] };
      var usable = ids.filter(function (id) { var s = idx.a[id].st; return s === 'ok' || (opts.allowNoPassword && s === 'no-password'); });
      if (usable.length === 1) return { id: usable[0], e: idx.a[usable[0]] };
      return { ambiguous: true };
    }
    /* The credential is right: may the account go on? (The dashboard's
       loginBlocked, as a gatekeeper sees it.) null, or the refusal
       { error, why? }. via: 'password' | 'email' — an account with no
       password yet may still use its email account; a login still on a
       password published with the platform opens nothing. */
    function credentialRefusal(entry, via) {
      var e = entry || {};
      if (e.st === 'pending' || e.st === 'disabled' || e.st === 'rejected') return { error: e.st };
      if (e.st !== 'ok' && !(via === 'email' && e.st === 'no-password')) return { error: e.st || 'no-match' };
      if (via === 'password' && e.sd) return { error: 'ask-office', why: 'default-password' };
      return null;
    }
    /* Which second steps an account is offered: its authenticator, its
       unused backup codes, an emailed code (only where email can be sent).
       unusedCodes: the backup codes still good, or a function giving them —
       asked only when a second step is needed (it may cost a read). An empty
       list for an account that needs a second step: it cannot finish here.
       Backup codes alone never ask for one. → { needed, methods } */
    function twoStep(entry, unusedCodes, canEmail) {
      var e = entry || {}, needed = !!(e.tf || e.eo), methods = [];
      var codes = typeof unusedCodes === 'function' ? (needed ? unusedCodes() : []) : unusedCodes;
      if (e.tf) methods.push('totp');
      if (Array.isArray(codes) && codes.length) methods.push('backup');
      if (e.eo && canEmail) methods.push('email');
      return { needed: needed, methods: methods };
    }
    /* The two-step ticket (§4.3): t2.<base64url(canon {a, cv, exp, m, via, n})>.<HMAC hex>.
       claims: { a (account), cv (its credential version), exp (ms), m
       (methods offered), via, n (a random nonce) }. Read back: the claims and
       `mac`, the first 32 hex characters of its seal — the name a gatekeeper
       counts tries and single use under — or { error: 'bad-ticket' |
       'expired' }. */
    function ticketMake(claims, secret, crypto) {
      var c = claims || {};
      var body = b64url(utf8(canon({ a: str(c.a), cv: str(c.cv), exp: c.exp, m: c.m, via: str(c.via), n: str(c.n) })));
      return 't2.' + body + '.' + hmac(crypto, secret, 't2|' + body);
    }
    function ticketRead(ticket, secret, crypto, nowMs) {
      var parts = str(ticket).split('.');
      if (parts.length !== 3 || parts[0] !== 't2' || !/^[0-9a-f]{64}$/.test(parts[2])) return { error: 'bad-ticket' };
      if (!same(hmac(crypto, secret, 't2|' + parts[1]), parts[2])) return { error: 'bad-ticket' };
      var c = null;
      try { var bytes = unb64url(parts[1]); c = bytes ? JSON.parse(fromUtf8(bytes)) : null; } catch (e) { c = null; }
      if (!isObj(c) || !c.a || typeof c.exp !== 'number') return { error: 'bad-ticket' };
      if (nowMs >= c.exp) return { error: 'expired' };
      c.mac = parts[2].slice(0, 32);
      return c;
    }
    /* A session id's random part begins with the account's credential
       version (sealed by the gatekeeper's secret with the rest: sid.make), so
       an item sealed in a session whose password, status or two-step has
       changed since is known as revoked with no table of sessions. sidCv
       reads it back ('' when the id is not one of these). */
    function sidRand(cv, randHex12) { return str(cv).slice(0, 12) + str(randHex12); }
    function sidCv(sid) { var m = /^[0-9a-z]+\.([A-Za-z0-9]{12})[A-Za-z0-9]*\.[0-9a-f]{8}$/.exec(str(sid)); return m ? m[1] : ''; }

    /* ---- Reading a store map ---- */
    function reader(storeMap) {
      var map = storeMap || {}, memo = dict();
      return function (k, kind) {
        if (!(k in memo)) {
          var v = map[k];
          if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
          memo[k] = v;
        }
        var val = memo[k];
        if (kind === 'list') return Array.isArray(val) ? val.filter(isObj) : [];
        if (kind === 'map') return isObj(val) ? val : {};
        return val == null ? null : val;
      };
    }

    /* Can this account sign in through the gate at all (and so need a
       slice)? A password that works, or no password yet but an email to sign
       in with (the email sign-in needs none). Pending, disabled and rejected
       accounts get nothing until an administrator decides. */
    function eligible(a) {
      if (!isObj(a) || lower(a.role) !== 'student' || a.id == null || a.id === '') return false;
      var c = Core.accountAccess.check(a);
      return c.allowed || (c.reason === 'no-password' && !!str(a.email).trim());
    }
    /* The trainee record a sign-in account belongs to, by the same steps the
       dashboard's sign-in takes (findStudentRecordForAccount): its own link,
       then the stable id of its name and programme, then a namesake in an
       agreeing programme when there is exactly one. Never repairs anything. */
    function studentFor(account, students) {
      if (!isObj(account)) return null;
      var list = Array.isArray(students) ? students : [], m = null, i;
      if (account.studentDataId != null && account.studentDataId !== '') {
        for (i = 0; i < list.length && !m; i++) if (list[i] && String(list[i].id) === String(account.studentDataId)) m = list[i];
      }
      if (!m) {
        var sid = Core.stableStudentId({ name: account.name, course: account.programme || '' });
        for (i = 0; sid && i < list.length && !m; i++) if (list[i] && list[i].id === sid) m = list[i];
      }
      if (!m) m = Core.accountAccess.studentLinkFor(account, list).match || null;
      return m;
    }

    /* The newest trusted moment a record was written. Stamps more than a day
       ahead of the time handed in are a wrong clock, not news (Core.sync). */
    var STAMP_FIELDS = ['updatedAt', 'lastModified', 'submittedAt', 'markedAt', 'gradedAt', 'reviewedAt', 'overriddenAt',
      'handledAt', 'requestedAt', 'editedAt', 'deletedAt', 'createdAt', 'savedAt', 'timestamp', 'activatedAt',
      'approvedAt', 'disabledAt', 'twoFactorUpdatedAt', 'maintenanceUpdatedAt', 'startedAt', 'endedAt'];
    function stampOf(rec, nowMs) {
      if (!isObj(rec)) return 0;
      var best = 0;
      STAMP_FIELDS.forEach(function (f) {
        var t = Core.sync.trusted(msOf(rec[f]), nowMs);
        if (t > best) best = t;
      });
      if (isObj(rec.gradeMeta)) Object.keys(rec.gradeMeta).forEach(function (k) {
        var t = Core.sync.trusted(msOf(rec.gradeMeta[k] && rec.gradeMeta[k].gradedAt), nowMs);
        if (t > best) best = t;
      });
      return best;
    }

    /* Every collection a slice is built from. LIST and MAP say how each is
       read; the owned ones are indexed by trainee once, so the whole roll is
       sliced in one pass. */
    var LISTS = ['voctrain_exams', 'voctrain_examResults', 'voctrain_examAttempts', 'voctrain_attendanceRegister',
      'voctrain_assignments', 'voctrain_submissions', 'voctrain_announcements', 'voctrain_notifications',
      'voctrain_calendarEvents', 'voctrain_classSessions', 'voctrain_vcSessions', 'voctrain_resources',
      'voctrain_driveResources', 'voctrain_transcriptGrades', 'voctrain_unitCatalogs', 'voctrain_certTranscriptRequests',
      'voctrain_certDownloadApprovals', 'voctrain_support_messages', 'voctrain_chatRooms', 'voctrain_skillAreas',
      'voctrain_instructorData'];
    var MAPS = ['voctrain_transcriptProfiles', 'voctrain_studentProfiles', 'voctrain_certTemplates'];
    var OWNED = ['voctrain_examResults', 'voctrain_examAttempts', 'voctrain_attendanceRegister', 'voctrain_submissions',
      'voctrain_transcriptGrades', 'voctrain_certTranscriptRequests', 'voctrain_certDownloadApprovals'];
    // Deletions a trainee's device may need: those of the shared pools a slice draws on.
    var PROGRAMME_TOMBS = ['announcements', 'exams', 'calendarEvents', 'classSessions', 'instructorAssignments',
      'instructorResources', 'driveResources', 'chatRooms', 'notifications', 'certTemplates'];
    var TOMB_WINDOW_MS = 120 * 24 * 3600 * 1000;

    var USER_FIELDS = ['id', 'name', 'role', 'username', 'email', 'programme', 'status', 'studentDataId', 'createdAt', 'updatedAt'];
    var EXAM_FIELDS = ['id', 'title', 'course', 'date', 'time', 'closeDate', 'closeTime', 'duration', 'passMark', 'status',
      'activatedAt', 'questionsPerPage', 'shuffleQuestions', 'shuffleOptions', 'answersRelease', 'allowFlag', 'instructions',
      'passRate', 'createdAt', 'updatedAt'];
    var PAPER_FIELDS = ['id', 'title', 'course', 'date', 'time', 'closeDate', 'closeTime', 'duration', 'passMark',
      'questionsPerPage', 'shuffleQuestions', 'shuffleOptions', 'answersRelease', 'status', 'activatedAt', 'allowFlag', 'instructions'];
    var VC_FIELDS = ['id', 'code', 'title', 'course', 'hostName', 'hostRole', 'startedAt', 'endedAt', 'locked', 'lobby', 'updatedAt'];
    var ROOM_FIELDS = ['id', 'name', 'icon', 'type', 'color', 'skillAreaId', 'createdAt', 'updatedAt'];
    var PER_TRAINEE_MAPS = ['grades', 'gradeMeta', 'feedback', 'comments', 'marks'];

    /* System notices that name a trainee. A trainee sees one only when it
       names them; the score and mark notices never reach a trainee at all
       (the bell already hid them: getFilteredNotifications). */
    var STAFF_ONLY_NOTICES = [/^Grading completed: .+ scored -?\d+% —/, /^.+ scored -?\d+% on .+ — (PASSED|NOT PASSED|pending review)$/,
      /^.+ graded -?[\d.]+\/\d+ on ".*"$/];
    var NAMED_NOTICES = [/^Certificate issued: (.+) — /, /^Certificate collected: (.+) — /, /^(.+) (?:resubmitted|submitted) work for "/,
      /^Name change requested by (.+) \(/, /^Account approved: (.+) \(/, /^(.+) moved to /];

    // The order each list is kept in, so the same records always give the same slice.
    var ORDER = {
      voctrain_notifications: function (a, b) { return (msOf(b.timestamp) - msOf(a.timestamp)) || cmpId(a, b); },
      voctrain_examResults: function (a, b) { return (msOf(a.submittedAt) - msOf(b.submittedAt)) || cmpId(a, b); },
      voctrain_attendanceRegister: function (a, b) { return str(a.date) < str(b.date) ? -1 : str(a.date) > str(b.date) ? 1 : cmpId(a, b); }
    };
    function cmpId(a, b) {
      var x = a && a.id != null ? str(a.id) : canon(copy(a)), y = b && b.id != null ? str(b.id) : canon(copy(b));
      if (x === y && a && b && a.id != null && b.id != null) { x = canon(copy(a)); y = canon(copy(b)); }
      return x < y ? -1 : x > y ? 1 : 0;
    }
    function ordered(key, list) { return list.slice().sort(ORDER[key] || cmpId); }

    /* ---- Who is another trainee, for the privacy sweep ---- */
    function addTo(m, v, norm) { var s = norm ? norm(v) : str(v); if (s) m[s] = 1; }
    function identityOf(account, student) {
      var o = { ids: dict(), names: dict(), emails: dict(), secrets: dict() };
      if (account) {
        addTo(o.ids, account.id); addTo(o.ids, account.studentDataId);
        addTo(o.names, account.name, Core.normName); addTo(o.emails, account.email, lower);
        addTo(o.secrets, account.password); addTo(o.secrets, account.twoFactorSecret);
        (Array.isArray(account.backupCodes) ? account.backupCodes : []).forEach(function (c) { addTo(o.secrets, c && c.code); });
      }
      if (student) {
        addTo(o.ids, student.id); addTo(o.ids, student.schoolFeeId); addTo(o.ids, Core.stableStudentId(student));
        addTo(o.names, student.name, Core.normName); addTo(o.emails, student.email, lower);
      }
      return o;
    }
    function mergeIdentity(into, from) {
      ['ids', 'names', 'emails', 'secrets'].forEach(function (k) { Object.keys(from[k]).forEach(function (v) { into[k][v] = 1; }); });
    }
    var ID_START = /(?:STU|USR|SF)-/g;
    function foreignText(s, F, own) {
      if (!s) return false;
      if (F.ids[s] && !own.ids[s]) return true;
      if (s.indexOf('-') !== -1) {
        ID_START.lastIndex = 0;
        var m;
        while ((m = ID_START.exec(s))) {
          for (var j = m.index + m[0].length; j <= s.length; j++) {
            var ch = s.charAt(j), end = j === s.length || !/[A-Za-z0-9_-]/.test(ch);
            if (end || ch === '-') { var cand = s.slice(m.index, j); if (F.ids[cand] && !own.ids[cand]) return true; }
            if (end) break;
          }
        }
      }
      var n = Core.normName(s);
      if (n && F.names[n] && !own.names[n]) return true;
      var e = lower(s);
      if (e && F.emails[e] && !own.emails[e]) return true;
      return !!(F.secrets[s] && !own.secrets[s]);
    }
    var OWNER_FIELDS = ['studentId', 'accountId', 'userId', 'studentDataId', 'senderId'];
    /* The last line of defence: whatever the rules above let through, a
       slice never carries another trainee's id, name, email, password check,
       two-step secret or backup code, nor anything that gives an answer
       away. A record about somebody else goes; a field naming them goes.
       Returns how many were taken out (the rules should leave nothing). */
    function scrub(node, F, own) {
      var n = 0;
      if (Array.isArray(node)) {
        for (var i = node.length - 1; i >= 0; i--) {
          var x = node[i];
          if (typeof x === 'string') { if (foreignText(x, F, own)) { node.splice(i, 1); n++; } }
          else if (x && typeof x === 'object') {
            var theirs = !Array.isArray(x) && OWNER_FIELDS.some(function (f) { return typeof x[f] === 'string' && foreignText(x[f], F, own); });
            if (theirs) { node.splice(i, 1); n++; } else n += scrub(x, F, own);
          }
        }
      } else if (node && typeof node === 'object') {
        Object.keys(node).forEach(function (k) {
          var v = node[k];
          if (hasOwn.call(KEY_NAMES, k) || foreignText(k, F, own) || (typeof v === 'string' && foreignText(v, F, own))) { delete node[k]; n++; return; }
          if (v && typeof v === 'object') n += scrub(v, F, own);
        });
      }
      return n;
    }

    /* ---- One pass over the Centre's records (§3.1) ----------------------
       prepare() reads everything once; sliceFor() then builds one trainee's
       slice. buildAll() is the two together for the whole roll — a staff
       device that must stay responsive calls sliceFor() itself and yields
       between trainees. opts: { builtBy, gateUrl, inboxSeenUntil: {acct: iso},
       findSkill(course) → training centre (the dashboard passes its own
       findSkillAreaForCourse; the default is Core.enrolment.findCentre),
       folds (accounts folded into others: Core.gate.foldMap's input) }. */
    function prepare(storeMap, nowMs, opts) {
      opts = opts || {};
      var now = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
      var read = reader(storeMap);
      var ctx = { now: now, opts: opts, L: {}, M: {} };
      LISTS.forEach(function (k) { ctx.L[k] = read(k, 'list'); });
      MAPS.forEach(function (k) { ctx.M[k] = read(k, 'map'); });
      ctx.settings = read('voctrain_systemSettings', 'map');
      ctx.offset = str(ctx.settings.centreUtcOffset) || Core.exams.DEFAULT_OFFSET;
      ctx.tombs = read('voctrain_syncTombstones', 'map');

      var idList = function (k) { var v = read(k); return Array.isArray(v) ? v : []; };
      var allAccounts = read('voctrain_users', 'list');
      var delUsers = {};
      idList('voctrain_deletedUserIds').forEach(function (id) { if (id != null && id !== '') delUsers[id] = true; });
      ctx.accounts = Core.accountAccess.dropDeleted(allAccounts, delUsers).accounts;
      var allStudents = read('voctrain_students', 'list');
      var delStu = {};
      idList('voctrain_deletedStudentIds').forEach(function (id) { if (id) delStu[id] = true; });
      ctx.students = Core.dropTombstonedStudents(allStudents, delStu, read('voctrain_deletedStudentAt', 'map')).students;

      var skills = ctx.L.voctrain_skillAreas, skillMemo = dict();
      var findSkill = typeof opts.findSkill === 'function' ? opts.findSkill
        : function (c) { return Core.enrolment.findCentre(skills, c, { nowMs: now }); };
      ctx.findSkill = function (c) {
        var k = str(c);
        if (!(k in skillMemo)) skillMemo[k] = findSkill(c);
        return skillMemo[k];
      };
      var memo = dict();
      ctx.same = function (a, b) {
        var k = str(a) + '\u0000' + str(b);
        if (!(k in memo)) {
          var r = false;
          try { r = !!Core.enrolment.courseMatch(a, b, ctx.findSkill); } catch (e) { r = false; }
          memo[k] = r;
        }
        return memo[k];
      };

      // Staff: their ids may stay in a trainee's slice (a teacher in a room).
      ctx.staffIds = dict();
      var staffNames = dict();
      allAccounts.forEach(function (a) {
        if (lower(a.role) === 'student') return;
        addTo(ctx.staffIds, a.id); addTo(staffNames, a.name, Core.normName);
      });
      ctx.L.voctrain_instructorData.forEach(function (i) { addTo(staffNames, i.name, Core.normName); });

      // Everybody who is a trainee, deleted or not: the privacy sweep's list.
      ctx.F = { ids: dict(), names: dict(), emails: dict(), secrets: dict() };
      allAccounts.forEach(function (a) { if (lower(a.role) === 'student') mergeIdentity(ctx.F, identityOf(a, null)); });
      allStudents.forEach(function (s) { mergeIdentity(ctx.F, identityOf(null, s)); });
      Object.keys(staffNames).forEach(function (n) { delete ctx.F.names[n]; });
      Object.keys(ctx.staffIds).forEach(function (id) { delete ctx.F.ids[id]; });

      // Accounts folded into another: their ids are that trainee's own.
      ctx.foldedInto = dict();
      var folds = foldsOf(opts.folds, allAccounts, allStudents);
      Object.keys(folds).forEach(function (stub) {
        var to = folds[stub], hops = 0;
        while (folds[to] && hops++ < 10) to = folds[to];   // (a circle of folds ends here, unplaced)
        (ctx.foldedInto[to] = ctx.foldedInto[to] || []).push(stub);
      });

      // Owned records, by trainee.
      ctx.owned = {};
      OWNED.forEach(function (k) {
        var by = dict();
        ctx.L[k].forEach(function (r) { if (r.studentId != null) (by[str(r.studentId)] = by[str(r.studentId)] || []).push(r); });
        ctx.owned[k] = by;
      });
      ctx.support = dict();
      ctx.L.voctrain_support_messages.forEach(function (m) {
        [m.accountId, m.studentId].forEach(function (id) { if (id != null && id !== '') (ctx.support[str(id)] = ctx.support[str(id)] || []).push(m); });
      });

      /* maxStamp (§3.3): the newest trusted stamp over EVERY record this pass
         examined. Every record of every collection a slice draws on is
         examined for every trainee — the ones a trainee's slice leaves out
         included — so a device that has not yet seen an edit anywhere (an
         announcement moved to another programme, a result moved to another
         trainee) can never out-rank one that has. */
      var s = 0;
      var see = function (r) { var t = stampOf(r, now); if (t > s) s = t; };
      LISTS.forEach(function (k) { ctx.L[k].forEach(see); });
      MAPS.forEach(function (k) { Object.keys(ctx.M[k]).forEach(function (mk) { see(ctx.M[k][mk]); }); });
      allAccounts.forEach(see); allStudents.forEach(see); see(ctx.settings);
      var seeTimes = function (m) {
        Object.keys(isObj(m) ? m : {}).forEach(function (k) { var t = Core.sync.trusted(msOf(m[k]), now); if (t > s) s = t; });
      };
      Object.keys(ctx.tombs).forEach(function (col) { seeTimes(ctx.tombs[col]); });
      seeTimes(read('voctrain_deletedStudentAt', 'map'));
      ctx.maxStamp = s;

      // The shared pools' recent deletions, once.
      ctx.programmeTombs = {};
      PROGRAMME_TOMBS.forEach(function (col) {
        var t = ctx.tombs[col];
        if (!isObj(t)) return;
        var keep = {};
        Object.keys(t).forEach(function (id) { if (msOf(t[id]) && now - msOf(t[id]) <= TOMB_WINDOW_MS) keep[id] = t[id]; });
        if (Object.keys(keep).length) ctx.programmeTombs[col] = keep;
      });

      // The trainees who get a slice.
      ctx.trainees = []; ctx.byAcct = dict(); ctx.unlinked = [];
      ctx.accounts.forEach(function (a) {
        if (!eligible(a)) return;
        var st = studentFor(a, ctx.students);
        if (!st || st.id == null) { ctx.unlinked.push(str(a.id)); return; }
        var t = { acct: str(a.id), stu: str(st.id), account: a, student: st, course: str(st.course || a.programme) };
        ctx.trainees.push(t); ctx.byAcct[t.acct] = t;
      });
      // The student IDs they had before — a rename, a transfer, a folded duplicate (formerIdsOf).
      formerIdsOf(ctx, allAccounts, delStu, opts.relinked);
      return ctx;
    }

    /* ---- A trainee's former student IDs ----------------------------------
       A student ID is a hash of the name and the programme, so a rename or a
       transfer moves it (Core.stableStudentId). The dashboard moves the
       records it holds at that moment (Core.relinkDependentData) — but a
       result marked since on a lab PC that still knew the old ID, an
       assignment grade (which no relink carries), and the records of a
       duplicate the fee roll made and a fold later removed, stay under the
       old ID, and a slice built by student ID alone left them out.

       Each trainee's former IDs are taken from what the records themselves
       say, where they say it:
         - a stub account folded into theirs (the fold log, opts.folds, or
           Core.accountAccess.backfillStubFolds): the record it linked to —
           from the stub's own copy, deleted or not, or the ID a
           deterministic stub id (USR-SYNC-…, USR-STU-…) is made of;
         - the dashboard's own identity rule (Core.migrateToStableIds, run
           on a copy of the roll): a duplicate of their record, or the ID
           their record is about to move to;
         - a move the caller kept: opts.relinked { oldId: newId } (the
           stabiliser's idMaps; chains are followed);
         - a record of theirs that names their account (accountId) under
           another student ID.
       The privacy back-check, before any ID is taken: never another
       trainee's current student ID; never a record another account links
       to; never a deleted trainee's ID; never a record the office pinned as
       its own person; a live record only on the dashboard's own decisions
       (the identity rule, a kept move), never on a fold or an account alone;
       and an ID two trainees could both claim goes to neither (formerUnsure).
       ctx.formerIds: { acct: [ids] }; ctx.formerNames: { acct: [the names
       of live records taken] } (theirs too, for the sweep). */
    function formerIdsOf(ctx, allAccounts, deleted, relinked) {
      var claims = dict(), current = dict(), live = dict(), mine = dict(), linkedBy = dict();
      deleted = deleted || {};
      ctx.trainees.forEach(function (t) {
        current[t.stu] = t.acct;
        mine[t.acct] = t.acct;
        (ctx.foldedInto[t.acct] || []).forEach(function (s) { mine[str(s)] = t.acct; });
      });
      ctx.students.forEach(function (s) { if (s.id != null && s.id !== '') live[str(s.id)] = s; });
      ctx.accounts.forEach(function (a) {
        if (a.studentDataId != null && a.studentDataId !== '') (linkedBy[str(a.studentDataId)] = linkedBy[str(a.studentDataId)] || []).push(str(a.id));
      });
      var claim = function (id, t, strong) {
        id = str(id);
        if (!id || id === t.stu || deleted[id] === true || current[id] !== undefined) return;
        if ((linkedBy[id] || []).some(function (a) { return mine[a] !== t.acct; })) return;
        var rec = live[id];
        if (rec && (!strong || Core.keepsOwnId(rec))) return;
        (claims[id] = claims[id] || dict())[t.acct] = 1;
      };
      // Where a map leads an id, following its chain (a circle leads nowhere).
      var end = function (m, id) {
        var seen = dict(), hops = 0;
        id = str(id);
        while (hasOwn.call(m, id) && str(m[id]) !== id) {
          if (seen[id] || hops++ > 50) return '';
          seen[id] = 1;
          id = str(m[id]);
        }
        return id;
      };

      // A stub folded into theirs: the record it linked to.
      var copiesOf = dict();
      allAccounts.forEach(function (a) { if (a.id != null) (copiesOf[str(a.id)] = copiesOf[str(a.id)] || []).push(a); });
      ctx.trainees.forEach(function (t) {
        (ctx.foldedInto[t.acct] || []).forEach(function (stub) {
          (copiesOf[str(stub)] || []).forEach(function (a) { claim(a.studentDataId, t, false); });
          var m = /^USR-(?:SYNC|STU)-(STU.+)$/.exec(str(stub));
          if (m) claim(m[1], t, false);
        });
      });

      // The dashboard's own identity rule, on a copy of the roll.
      var idMap = {};
      try { idMap = Core.migrateToStableIds({ students: copy(ctx.students) }).idMap || {}; } catch (e) { idMap = {}; }
      var groups = dict();
      Object.keys(idMap).concat(Object.keys(live)).forEach(function (id) {
        var to = end(idMap, id);
        if (to) (groups[to] = groups[to] || []).push(id);
      });
      var byEnd = dict();
      ctx.trainees.forEach(function (t) {
        var to = end(idMap, t.stu);
        if (!to) return;
        (byEnd[to] = byEnd[to] || []).push(t);
        [to].concat(groups[to] || []).forEach(function (id) { claim(id, t, true); });
      });

      // A move the caller kept.
      var kept = isObj(relinked) ? relinked : {};
      Object.keys(kept).forEach(function (old) {
        var to = end(kept, old);
        if (!to) return;
        var whose = current[to] !== undefined ? [ctx.byAcct[current[to]]] : (byEnd[end(idMap, to)] || []);
        var chain = [], id = str(old), hops = 0;
        while (id && id !== to && hops++ < 50) { chain.push(id); id = str(kept[id]); }
        whose.forEach(function (t) { chain.concat([to]).forEach(function (x) { claim(x, t, true); }); });
      });

      // A record of theirs that names their account under another student ID.
      OWNED.forEach(function (k) {
        ctx.L[k].forEach(function (r) {
          if (r.studentId == null || r.accountId == null) return;
          var t = mine[str(r.accountId)] ? ctx.byAcct[mine[str(r.accountId)]] : null;
          if (t && str(r.studentId) !== t.stu) claim(r.studentId, t, false);
        });
      });

      ctx.formerIds = dict(); ctx.formerNames = dict(); ctx.formerUnsure = [];
      Object.keys(claims).sort().forEach(function (id) {
        var who = Object.keys(claims[id]);
        if (who.length !== 1) { ctx.formerUnsure.push(id); return; }
        (ctx.formerIds[who[0]] = ctx.formerIds[who[0]] || []).push(id);
        if (live[id] && Core.normName(live[id].name)) (ctx.formerNames[who[0]] = ctx.formerNames[who[0]] || []).push(Core.normName(live[id].name));
      });
    }
    /* A trainee's records still filed under a former student ID, as theirs
       today: copies with the student ID (and a folded stub's account id)
       rewritten (reown). A record whose id the current ID already holds is
       the one kept; a record with no id (a download approval) comes only
       when the current ID holds none of that kind. */
    function formerOwned(ctx, key, t) {
      var former = (ctx.formerIds && ctx.formerIds[t.acct]) || [];
      if (!former.length) return [];
      var now = ctx.owned[key][t.stu] || [], have = dict(), out = [];
      now.forEach(function (r) { if (r.id != null) have[str(r.id)] = 1; });
      former.forEach(function (id) {
        (ctx.owned[key][id] || []).forEach(function (r) {
          if (r.id == null) { if (!now.length) out.push(r); return; }
          if (have[str(r.id)]) return;
          have[str(r.id)] = 1;
          out.push(r);
        });
      });
      if (!out.length) return out;
      var recs = {}; recs[key] = out;
      return reown(recs, { stus: former, accts: ctx.foldedInto[t.acct] || [] }, { stu: t.stu, acct: t.acct })[key];
    }

    function cutList(list, own) { return (Array.isArray(list) ? list : []).filter(function (x) { return own[str(x)]; }); }
    function ownedOf(ctx, key, t) { return (ctx.owned[key][t.stu] || []).map(copy).concat(formerOwned(ctx, key, t)); }
    function cutReaders(rec, own) {
      var r = copy(rec);
      ['readBy', 'clearedBy', 'dismissedBy'].forEach(function (f) { if (Array.isArray(r[f])) r[f] = cutList(r[f], own); });
      return r;
    }
    function examMeta(e) {
      var m = pick(e, EXAM_FIELDS);
      m.questions = Core.exams.questionCount(e);
      m.questionData = [];
      return m;
    }
    function examForTrainee(ctx, e, t) {
      if (e.id == null || e.id === '' || e.status === 'draft' || e.status === 'cancelled') return false;
      return !!e.course && (e.course === t.course || ctx.same(e.course, t.course));
    }
    function stripKeys(q) {
      var c = {};
      Object.keys(isObj(q) ? q : {}).forEach(function (k) { if (!hasOwn.call(KEY_NAMES, k)) c[k] = copy(q[k]); });
      return c;
    }
    function inRoom(ctx, room, t) {
      var members = (Array.isArray(room.members) ? room.members : []).map(str);
      if (room.type === 'dm') return members.indexOf(t.acct) !== -1;
      if (isObj(room.removed) && room.removed[t.acct]) return false;
      if (members.indexOf(t.acct) !== -1) return true;
      var prog = str(t.account.programme);
      if (room.type === 'class' && prog) {
        var rn = lower(room.name);
        if (lower(prog) === rn) return true;
        var us = null, rs = null;
        try { us = ctx.findSkill(prog); } catch (e) { us = null; }
        if (room.skillAreaId != null) ctx.L.voctrain_skillAreas.forEach(function (sk) { if (sk.id === room.skillAreaId) rs = sk; });
        if (us && rs && us.id && rs.id && us.id === rs.id) return true;
        if (us && us.name && lower(us.name) === rn) return true;
      }
      return false;
    }
    /* Rooms a trainee belongs to, as their slice lists them: who else is in
       the room is the staff only (classmates are seen in the room's own
       history, which only members are served). A direct conversation with
       another trainee is not listed: its very id names them. */
    function roomsFor(ctx, t) {
      var out = [];
      ctx.L.voctrain_chatRooms.forEach(function (room) {
        if (room.id == null || !inRoom(ctx, room, t)) return;
        var members = (Array.isArray(room.members) ? room.members : []).map(str);
        if (room.type === 'dm' && members.some(function (m) { return m !== t.acct && !ctx.staffIds[m]; })) return;
        var r = pick(room, ROOM_FIELDS);
        r.members = members.filter(function (m) { return m === t.acct || ctx.staffIds[m]; }).sort();
        out.push(r);
      });
      return out;
    }
    function noticeFor(n, t, ownNames) {
      if (Array.isArray(n.forUsers) && n.forUsers.length) return n.forUsers.map(str).indexOf(t.acct) !== -1;
      if (Array.isArray(n.forRoles) && n.forRoles.length && n.forRoles.indexOf('student') === -1) return false;
      var text = str(n.text);
      if (STAFF_ONLY_NOTICES.some(function (re) { return re.test(text); })) return false;
      for (var i = 0; i < NAMED_NOTICES.length; i++) {
        var m = NAMED_NOTICES[i].exec(text);
        if (m) return !!ownNames[Core.normName(m[1])];
      }
      return true;
    }
    function fileIdsOf(node, out, depth) {
      if (depth > 6 || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(function (x) { fileIdsOf(x, out, depth + 1); }); return; }
      Object.keys(node).forEach(function (k) {
        if (k === 'driveFileId' && typeof node[k] === 'string' && node[k]) out.push(node[k]);
        else fileIdsOf(node[k], out, depth + 1);
      });
    }

    function sliceFor(ctx, acct) {
      var t = ctx.byAcct[str(acct)];
      if (!t) return null;
      var course = t.course, now = ctx.now, d = {};
      var own = identityOf(t.account, t.student);
      (ctx.foldedInto[t.acct] || []).forEach(function (id) { own.ids[id] = 1; });
      // Student IDs this trainee had before are theirs too (formerIdsOf).
      var former = (ctx.formerIds && ctx.formerIds[t.acct]) || [], wasMine = dict();
      former.forEach(function (id) { own.ids[id] = 1; wasMine[id] = 1; });
      ((ctx.formerNames && ctx.formerNames[t.acct]) || []).forEach(function (n) { own.names[n] = 1; });
      var readers = dict(); readers[t.acct] = 1;
      var forStudent = function (r) { return Core.comms.forViewer(r, 'student', course, ctx.same); };
      var sameCourse = function (c) { return !!c && !!course && (c === course || !!ctx.same(course, c)); };

      d.voctrain_students = [copy(t.student)];
      var card = pick(t.account, USER_FIELDS);
      card.twoFactorEnabled = !!t.account.twoFactorEnabled;
      card.emailOtpLogin = !!t.account.emailOtpLogin;
      d.voctrain_users = [card];
      d.voctrain_exams = ctx.L.voctrain_exams.filter(function (e) { return examForTrainee(ctx, e, t); }).map(examMeta);
      d.voctrain_examResults = ownedOf(ctx, 'voctrain_examResults', t).map(function (r) { return redactResult(r, null, now, ctx.offset); });
      d.voctrain_examAttempts = ownedOf(ctx, 'voctrain_examAttempts', t).map(function (a) {
        if (Array.isArray(a.questions)) a.questions = a.questions.map(stripKeys);
        return a;
      });
      d.voctrain_attendanceRegister = ownedOf(ctx, 'voctrain_attendanceRegister', t);
      d.voctrain_assignments = ctx.L.voctrain_assignments.filter(function (a) { return sameCourse(a.course); }).map(function (a) {
        var r = copy(a);
        PER_TRAINEE_MAPS.forEach(function (f) {
          if (!isObj(r[f])) return;
          var keep = {};
          if (r[f][t.stu] !== undefined) keep[t.stu] = r[f][t.stu];
          // A grade still under a former student ID (no relink carries these maps) is theirs, under today's.
          else former.some(function (x) { if (hasOwn.call(r[f], x) && r[f][x] !== undefined) { keep[t.stu] = r[f][x]; return true; } return false; });
          r[f] = keep;
        });
        if (Array.isArray(r.gradeLog)) r.gradeLog = r.gradeLog.filter(function (g) { return g && str(g.studentId) === t.stu; });
        if (Array.isArray(a.gradeLog) && former.length) a.gradeLog.forEach(function (g) {
          if (g && wasMine[str(g.studentId)]) { var c = copy(g); c.studentId = t.stu; r.gradeLog.push(c); }
        });
        return r;
      });
      d.voctrain_submissions = ownedOf(ctx, 'voctrain_submissions', t);
      d.voctrain_announcements = ctx.L.voctrain_announcements.filter(forStudent).map(function (a) { return cutReaders(a, readers); });
      d.voctrain_notifications = ctx.L.voctrain_notifications.filter(function (n) { return noticeFor(n, t, own.names); }).map(function (n) {
        var r = cutReaders(n, readers);
        if (Array.isArray(r.forUsers)) r.forUsers = cutList(r.forUsers, readers);
        return r;
      });
      d.voctrain_calendarEvents = ctx.L.voctrain_calendarEvents.filter(forStudent).map(function (e) { return cutReaders(e, readers); });
      d.voctrain_classSessions = ctx.L.voctrain_classSessions.filter(function (cs) { return sameCourse(cs.course); }).map(function (cs) {
        var r = copy(cs);
        if (Array.isArray(r.attendees)) r.attendees = r.attendees.filter(function (x) {
          if (!isObj(x)) return false;
          if (x.id != null && x.id !== '') return !!own.ids[str(x.id)];
          return !!own.names[Core.normName(x.name)];
        });
        return r;
      });
      d.voctrain_vcSessions = ctx.L.voctrain_vcSessions.filter(function (v) { return sameCourse(v.course); }).map(function (v) { return pick(v, VC_FIELDS); });
      ['voctrain_resources', 'voctrain_driveResources'].forEach(function (k) {
        d[k] = ctx.L[k].filter(function (r) { return Core.coursework.resourceVisible(r.course, course, ctx.same); }).map(copy);
      });
      d.voctrain_transcriptGrades = ownedOf(ctx, 'voctrain_transcriptGrades', t);
      var quals = dict();
      d.voctrain_transcriptGrades.forEach(function (g) { if (g.qualId != null) quals[str(g.qualId)] = 1; });
      d.voctrain_unitCatalogs = ctx.L.voctrain_unitCatalogs.filter(function (c) {
        return (c.id != null && quals[str(c.id)]) || sameCourse(c.skillArea || c.centre || c.title);
      }).map(copy);
      d.voctrain_certTranscriptRequests = ownedOf(ctx, 'voctrain_certTranscriptRequests', t);
      d.voctrain_certDownloadApprovals = ownedOf(ctx, 'voctrain_certDownloadApprovals', t);
      d.voctrain_support_messages = (ctx.support[t.acct] || []).concat(ctx.support[t.stu] || []).filter(function (m, i, all) {
        return all.indexOf(m) === i;
      }).map(copy);
      if (former.length) {
        var sent = dict();
        d.voctrain_support_messages.forEach(function (m) { if (m.id != null) sent[str(m.id)] = 1; });
        var earlier = [];
        former.forEach(function (id) { (ctx.support[id] || []).forEach(function (m) { if (m.id == null || !sent[str(m.id)]) { if (m.id != null) sent[str(m.id)] = 1; earlier.push(m); } }); });
        d.voctrain_support_messages = d.voctrain_support_messages.concat(reown({ s: earlier }, { stus: former }, t).s);
      }
      d.voctrain_chatRooms = roomsFor(ctx, t);
      var mine = null;
      try { mine = course ? ctx.findSkill(course) : null; } catch (e) { mine = null; }
      d.voctrain_skillAreas = ctx.L.voctrain_skillAreas.filter(function (sk) {
        return (mine && mine.id && sk.id === mine.id) || sameCourse(sk.name);
      }).map(copy);
      var seenIns = dict();
      d.voctrain_instructorData = ctx.L.voctrain_instructorData.filter(function (i) {
        return (i.name && t.student.instructor && Core.normName(i.name) === Core.normName(t.student.instructor)) || sameCourse(i.course);
      }).map(function (i) { return { name: str(i.name), course: str(i.course) }; }).filter(function (i) {
        var k = i.name + '|' + i.course;
        if (seenIns[k]) return false;
        seenIns[k] = 1; return true;
      });
      var ownMap = function (m, keys) {
        var o = {};
        keys.forEach(function (k) { if (k && hasOwn.call(m, k)) o[k] = copy(m[k]); });
        return o;
      };
      d.voctrain_transcriptProfiles = ownMap(ctx.M.voctrain_transcriptProfiles, [t.stu]);
      d.voctrain_studentProfiles = ownMap(ctx.M.voctrain_studentProfiles, [t.acct, t.stu]);
      // A profile still under a former ID, where today's has none, under today's (as the relink files it).
      former.forEach(function (x) {
        ['voctrain_transcriptProfiles', 'voctrain_studentProfiles'].forEach(function (k) {
          if (!hasOwn.call(d[k], t.stu) && hasOwn.call(ctx.M[k], x)) d[k][t.stu] = copy(ctx.M[k][x]);
        });
      });
      d.voctrain_certTemplates = {};
      Object.keys(ctx.M.voctrain_certTemplates).forEach(function (k) {
        if (!(k === course || sameCourse(k))) return;
        var tpl = copy(ctx.M.voctrain_certTemplates[k]);
        if (isObj(tpl)) { delete tpl.bgPage1; delete tpl.bgPage2; }
        d.voctrain_certTemplates[k] = tpl;
      });

      Object.keys(d).forEach(function (k) { if (Array.isArray(d[k])) d[k] = ordered(k, d[k]); });

      var tombstones = copy(ctx.programmeTombs);
      // A direct conversation's id names both people: only theirs with staff.
      if (tombstones.chatRooms) {
        var mineDm = dict();
        Object.keys(ctx.staffIds).forEach(function (sid) { mineDm['dm-' + [t.acct, sid].sort().join('-')] = 1; });
        Object.keys(tombstones.chatRooms).forEach(function (id) { if (id.indexOf('dm-') === 0 && !mineDm[id]) delete tombstones.chatRooms[id]; });
        if (!Object.keys(tombstones.chatRooms).length) delete tombstones.chatRooms;
      }
      var profTombs = isObj(ctx.tombs.studentProfiles) ? ctx.tombs.studentProfiles : {};
      [t.acct, t.stu].forEach(function (k) {
        if (hasOwn.call(profTombs, k)) (tombstones.studentProfiles = tombstones.studentProfiles || {})[k] = profTombs[k];
      });

      var files = [];
      ['voctrain_resources', 'voctrain_driveResources', 'voctrain_assignments', 'voctrain_submissions'].forEach(function (k) { fileIdsOf(d[k], files, 0); });
      var access = {
        papers: uniqSorted(d.voctrain_exams.filter(function (e) { return e.questions > 0; }).map(function (e) { return e.id; })),
        rooms: uniqSorted(d.voctrain_chatRooms.map(function (r) { return r.id; })),
        files: uniqSorted(files)
      };
      var S = ctx.settings;
      var settings = {
        centreName: str(S.institutionName), centreUtcOffset: ctx.offset,
        maintenanceMode: S.maintenanceMode === true,
        maintenanceMessage: S.maintenanceMode === true ? str(S.maintenanceMessage) : '',
        gateUrl: str(ctx.opts.gateUrl || (isObj(S.traineeGate) ? S.traineeGate.url : ''))
      };

      var body = { data: d, tombstones: tombstones, access: access };
      var scrubbed = scrub(body, ctx.F, own);
      var h = hashOf({ version: VERSION, accountId: t.acct, studentId: t.stu, settings: settings, data: body.data,
        tombstones: body.tombstones, access: body.access });
      var seen = ctx.opts.inboxSeenUntil && ctx.opts.inboxSeenUntil[t.acct];
      var slice = {
        format: FORMAT.slice, version: VERSION, accountId: t.acct, studentId: t.stu,
        builtAt: iso(now), builtBy: str(ctx.opts.builtBy), hash: h, maxStamp: ctx.maxStamp,
        inboxSeenUntil: str(seen), settings: settings, access: body.access, data: body.data, tombstones: body.tombstones
      };
      return { slice: slice, h: h, s: ctx.maxStamp, scrubbed: scrubbed };
    }

    /* ---- Papers, keys, rooms ---- */
    function buildPaper(exam, nowMs) {
      var meta = pick(exam, PAPER_FIELDS);
      var questions = Core.exams.publicQuestions(exam && exam.questionData);
      var h = hashOf({ exam: meta, questions: questions });
      return { format: FORMAT.paper, version: VERSION, examId: str(exam && exam.id), hash: h,
        builtAt: iso(typeof nowMs === 'number' ? nowMs : Date.now()), exam: meta, questions: questions };
    }
    function buildKey(exam, centreUtcOffset) {
      var full = copy(exam || {});
      var off = str(centreUtcOffset) || Core.exams.DEFAULT_OFFSET;
      return { format: FORMAT.key, version: VERSION, examId: str(full.id), hash: hashOf({ exam: full, centreUtcOffset: off }),
        exam: full, centreUtcOffset: off };
    }
    var ROOM_HISTORY = 300;
    /* A room's own file (served to its members only): who is in it, and its
       last 300 messages with attachments as links. */
    function buildRoom(room, messages, members, nowMs) {
      var list = (Array.isArray(messages) ? messages : []).filter(isObj).slice()
        .sort(function (a, b) { return (msOf(a.timestamp) - msOf(b.timestamp)) || cmpId(a, b); });
      list = list.slice(Math.max(0, list.length - ROOM_HISTORY));
      var byRoom = {}; byRoom[str(room && room.id)] = list;
      var msgs = (Core.chat.stripUploadedBytes(byRoom)[str(room && room.id)] || []).map(function (m) {
        var c = copy(m); delete c.imageData; delete c.fileData; return c;
      });
      var who = uniqSorted(members);
      return { format: FORMAT.room, version: VERSION, roomId: str(room && room.id), hash: hashOf({ room: pick(room, ROOM_FIELDS), members: who, messages: msgs }),
        builtAt: iso(typeof nowMs === 'number' ? nowMs : Date.now()), room: pick(room, ROOM_FIELDS), members: who, messages: msgs };
    }

    function buildAll(storeMap, nowMs, opts) {
      opts = opts || {};
      var ctx = prepare(storeMap, nowMs, opts);
      var only = Array.isArray(opts.only) ? opts.only.map(str) : null;
      var out = { slices: {}, papers: {}, keys: {}, rooms: {}, unlinked: ctx.unlinked.slice(), s: ctx.maxStamp };
      var papers = dict(), rooms = dict();
      ctx.trainees.forEach(function (t) {
        if (only && only.indexOf(t.acct) === -1) return;
        var r = sliceFor(ctx, t.acct);
        out.slices[t.acct] = r;
        r.slice.access.papers.forEach(function (id) { papers[id] = 1; });
        r.slice.access.rooms.forEach(function (id) { rooms[id] = 1; });
      });
      ctx.L.voctrain_exams.forEach(function (e) {
        if (!papers[str(e.id)] || out.papers[str(e.id)]) return;
        var p = buildPaper(e, ctx.now), k = buildKey(e, ctx.offset);
        out.papers[p.examId] = { paper: p, h: p.hash };
        out.keys[k.examId] = { key: k, h: k.hash };
      });
      var allMsgs = reader(storeMap)('voctrain_chatMessages', 'map');
      ctx.L.voctrain_chatRooms.forEach(function (room) {
        var id = str(room.id);
        if (!rooms[id] || out.rooms[id]) return;
        var members = (Array.isArray(room.members) ? room.members : []).map(str).filter(function (m) { return !(isObj(room.removed) && room.removed[m]); });
        ctx.trainees.forEach(function (t) { if (inRoom(ctx, room, t)) members.push(t.acct); });
        var f = buildRoom(room, allMsgs[id], members, ctx.now);
        out.rooms[id] = { room: f, h: f.hash };
      });
      return out;
    }
    /* One trainee's slice (the Centre's own machine builds them on request).
       { slice, h, s, scrubbed } — or { error: 'not-found' | 'unlinked' }. */
    function buildSlice(storeMap, accountId, nowMs, opts) {
      var ctx = prepare(storeMap, nowMs, opts);
      if (ctx.byAcct[str(accountId)]) return sliceFor(ctx, accountId);
      return { error: ctx.unlinked.indexOf(str(accountId)) !== -1 ? 'unlinked' : 'not-found' };
    }

    /* Should this device write its copy over the one already published?
       'skip'   the same content is there;
       'write'  this device has seen newer records (maxStamp), or the same
                newest moment and the higher hash — so two devices that agree
                on the moment settle on one copy and never take turns;
       'behind' the published copy has seen newer records: wait for this
                device's own sync to catch up;
       'keep'   the same newest moment, and the published copy wins the tie. */
    function publishDecision(local, remote) {
      if (!remote || !remote.h) return 'write';
      if (str(local && local.h) === str(remote.h)) return 'skip';
      var ls = Number(local && local.s) || 0, rs = Number(remote.s) || 0;
      if (ls > rs) return 'write';
      if (ls < rs) return 'behind';
      return str(local && local.h) > str(remote.h) ? 'write' : 'keep';
    }

    /* How a slice's exam reads now on the trainee's device. A slice never
       carries the questions, only how many there are, so "has questions"
       comes from that count (Core.exams.statusAt reads questionData). */
    function sliceExamStatus(exam, nowMs, offset) {
      if (!exam) return 'upcoming';
      var e = copy(exam);
      e.questionData = (Number(exam.questions) || 0) > 0 ? [{ id: 'q', type: 'info' }] : [];
      return Core.exams.statusAt(e, nowMs, offset);
    }
    // May the paper be served now? Only while the exam is open, by the gatekeeper's clock.
    function paperOpen(keyFile, nowMs) {
      if (!isObj(keyFile) || !isObj(keyFile.exam)) return false;
      return Core.exams.statusAt(keyFile.exam, nowMs, keyFile.centreUtcOffset) === 'active';
    }

    /* ---- What a trainee may send (§5.2) ---------------------------------
       validateItem(item, me, slice, opts) → { id, ok, reason? } and, when ok,
       what to keep: { key, rec, recId } for a record, { op } for an
       operation, { attempt } for a submission. me = { acct, stu } from the
       token or the seal. slice: the trainee's current slice — its access
       lists and own records decide what is theirs; without one (a staff
       device checking a collected inbox again) only ownership and shape are
       checked. opts: { papers: { examId: paper } (or paper), ownUploads:
       [fileId], lane: true when the item came out of a gatekeeper-written
       inbox }. Every refused item says why: 'not-yours', 'malformed',
       'too-large', 'not-open', 'unknown-exam', 'unknown-question',
       'bad-order', 'unknown-assignment', 'not-own-file', 'not-pending',
       'unknown-room', 'unknown-record', 'inline-file'. */
    var ITEM_MAX_BYTES = 500 * 1024, TEXT_MAX_BYTES = 4 * 1024, PHOTO_MAX_CHARS = 300 * 1024;
    var STAFF_SUBMISSION_FIELDS = ['grade', 'feedback', 'gradedBy', 'gradedAt', 'marks'];
    var PROFILE_FIELDS = ['email', 'phone', 'emergencyName', 'emergencyPhone', 'bio', 'photo', 'profilePic', 'preferences', 'requestedName', 'updatedAt'];
    var SUPPORT_FIELDS = ['id', 'name', 'email', 'phone', 'subject', 'message', 'timestamp', 'date', 'createdAt'];
    var CHAT_FIELDS = ['id', 'roomId', 'senderId', 'senderName', 'text', 'type', 'timestamp', 'driveFileId', 'fileName', 'fileSize', 'mimeType', 'replyTo'];
    function verdict(item, ok, extra) {
      var out = { id: item && item.id != null ? str(item.id) : '', ok: ok };
      Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
      return out;
    }
    function idsOf(list) { var m = dict(); (Array.isArray(list) ? list : []).forEach(function (r) { if (r && r.id != null) m[str(r.id)] = r; }); return m; }
    function sliceData(slice, key) { return slice && slice.data && Array.isArray(slice.data[key]) ? slice.data[key] : []; }
    function paperOf(opts, examId) {
      if (opts.paper && str(opts.paper.examId) === str(examId)) return opts.paper;
      return opts.papers && isObj(opts.papers[str(examId)]) ? opts.papers[str(examId)] : null;
    }
    function isPermutation(order, n) {
      if (!Array.isArray(order) || order.length !== n) return false;
      var seen = {};
      return order.every(function (k) {
        if (typeof k !== 'number' || k < 0 || k >= n || Math.floor(k) !== k || seen[k]) return false;
        seen[k] = 1; return true;
      });
    }
    function ownFiles(slice, opts) {
      var m = dict();
      (Array.isArray(opts.ownUploads) ? opts.ownUploads : []).forEach(function (id) { if (id) m[str(id)] = 1; });
      var ids = []; fileIdsOf(sliceData(slice, 'voctrain_submissions'), ids, 0);
      ids.forEach(function (id) { m[id] = 1; });
      return m;
    }
    function checkAttempt(a, me, slice, opts, submitting) {
      if (!isObj(a)) return 'malformed';
      if (str(a.studentId) !== str(me.stu) || (a.accountId != null && str(a.accountId) !== str(me.acct))) return 'not-yours';
      // Only the gatekeeper retires an attempt: what a trainee sends is open.
      if (submitting ? (a.status != null && a.status !== 'open') : a.status !== 'open') return 'not-open';
      if (!Core.exams.attemptIsOpen(a) || a.id == null || a.id === '') return 'malformed';
      if (a.answers.length > a.questions.length) return 'malformed';
      if (utf8Length(JSON.stringify(a)) > ITEM_MAX_BYTES) return 'too-large';
      var paper = paperOf(opts, a.examId);
      if (slice) {
        if (!slice.access || (slice.access.papers || []).map(str).indexOf(str(a.examId)) === -1) return 'unknown-exam';
        if (!paper) return 'unknown-exam';
      }
      var byId = null;
      if (paper) {
        byId = dict();
        (paper.questions || []).forEach(function (q) { if (q && q.id != null) byId[str(q.id)] = q; });
      }
      for (var i = 0; i < a.questions.length; i++) {
        var q = a.questions[i];
        if (!isObj(q) || q.id == null) return 'malformed';
        var pq = byId ? byId[str(q.id)] : q;
        if (!pq) return 'unknown-question';
        if (q.optionOrder !== undefined && !isPermutation(q.optionOrder, (pq.options || []).length)) return 'bad-order';
      }
      return null;
    }
    function normAttempt(a, me) {
      var r = copy(a);
      r.questions = r.questions.map(stripKeys);
      r.accountId = str(me.acct);
      r.status = 'open';
      // The attempt's activity (when things happened, for the invigilator)
      // travels with it, as the clean copy Core.exams keeps everywhere: only
      // its known fields and well-formed moments, never anything else.
      if (r.activity !== undefined) {
        var act = Core.exams.activityOf ? Core.exams.activityOf(r.activity) : null;
        if (act) r.activity = act; else delete r.activity;
      }
      return r;
    }
    function validateRecord(item, me, slice, opts) {
      var key = str(item.key), rec = item.rec;
      if (!isObj(rec)) return verdict(item, false, { reason: 'malformed' });
      var mine = function (f) { return rec[f] == null || str(rec[f]) === (f === 'studentId' ? str(me.stu) : str(me.acct)); };
      var data = slice && slice.data ? slice.data : null;
      var ownStudent = sliceData(slice, 'voctrain_students')[0] || null;
      var ownUser = sliceData(slice, 'voctrain_users')[0] || null;

      if (key === 'voctrain_examAttempts') {
        var why = checkAttempt(rec, me, slice, opts, false);
        if (why) return verdict(item, false, { reason: why });
        return verdict(item, true, { key: key, rec: normAttempt(rec, me) });
      }
      if (key === 'voctrain_submissions') {
        if (str(rec.studentId) !== str(me.stu) || !mine('accountId')) return verdict(item, false, { reason: 'not-yours' });
        if (rec.id == null || rec.id === '' || rec.assignmentId == null) return verdict(item, false, { reason: 'malformed' });
        if (data && !idsOf(data.voctrain_assignments)[str(rec.assignmentId)]) return verdict(item, false, { reason: 'unknown-assignment' });
        var files = []; fileIdsOf(rec, files, 0);
        if (slice || Array.isArray(opts.ownUploads)) {
          var allowed = ownFiles(slice, opts);
          if (files.some(function (f) { return !allowed[f]; })) return verdict(item, false, { reason: 'not-own-file' });
        }
        var sub = copy(rec);
        STAFF_SUBMISSION_FIELDS.forEach(function (f) { delete sub[f]; });
        sub.accountId = str(me.acct);
        if (ownStudent) sub.studentName = str(ownStudent.name);
        return verdict(item, true, { key: key, rec: sub });
      }
      if (key === 'voctrain_certTranscriptRequests') {
        if (str(rec.studentId) !== str(me.stu) || !mine('accountId')) return verdict(item, false, { reason: 'not-yours' });
        if (rec.id == null || rec.id === '') return verdict(item, false, { reason: 'malformed' });
        var known = data ? idsOf(data.voctrain_certTranscriptRequests)[str(rec.id)] : null;
        var out = copy(rec);
        if (!data) {
          // Checked again from an inbox: the gatekeeper held the slice then.
          if (rec.status !== 'pending' && rec.status !== 'cancelled') return verdict(item, false, { reason: 'not-pending' });
        } else if (known) {
          // The trainee may only withdraw a request still waiting.
          if (known.status !== 'pending') return verdict(item, false, { reason: 'not-pending' });
          if (rec.status !== 'cancelled' && rec.status !== 'pending') return verdict(item, false, { reason: 'not-pending' });
          out = copy(known);
          out.status = rec.status;
          out.updatedAt = str(rec.updatedAt) || out.updatedAt;
        } else {
          if (rec.status !== 'pending') return verdict(item, false, { reason: 'not-pending' });
          ['handledBy', 'handledAt', 'adminNote'].forEach(function (f) { out[f] = ''; });
          if (['transcript', 'certificate', 'both'].indexOf(out.type) === -1) out.type = 'transcript';
          if (ownStudent) { out.studentName = str(ownStudent.name); out.course = str(ownStudent.course); }
        }
        out.accountId = str(me.acct);
        return verdict(item, true, { key: key, rec: out });
      }
      if (key === 'voctrain_support_messages') {
        if (!mine('accountId') || !mine('studentId')) return verdict(item, false, { reason: 'not-yours' });
        if (rec.id == null || rec.id === '') return verdict(item, false, { reason: 'malformed' });
        var text = [rec.name, rec.email, rec.phone, rec.subject, rec.message].map(str).join('');
        if (utf8Length(text) > TEXT_MAX_BYTES) return verdict(item, false, { reason: 'too-large' });
        if (data && idsOf(data.voctrain_support_messages)[str(rec.id)]) return verdict(item, true, { key: key, known: true });
        var msg = pick(rec, SUPPORT_FIELDS);
        msg.accountId = str(me.acct); msg.studentId = str(me.stu);
        msg.read = false; msg.replied = false; msg.delivered = true;
        return verdict(item, true, { key: key, rec: msg });
      }
      if (key === 'voctrain_chatMessages') {
        if (str(rec.senderId) !== str(me.acct)) return verdict(item, false, { reason: 'not-yours' });
        if (rec.id == null || rec.id === '' || rec.roomId == null) return verdict(item, false, { reason: 'malformed' });
        if (slice && (!slice.access || (slice.access.rooms || []).map(str).indexOf(str(rec.roomId)) === -1)) return verdict(item, false, { reason: 'unknown-room' });
        if (rec.imageData != null || rec.fileData != null) return verdict(item, false, { reason: 'inline-file' });
        if (utf8Length(str(rec.text)) > TEXT_MAX_BYTES) return verdict(item, false, { reason: 'too-large' });
        if (rec.driveFileId && (slice || Array.isArray(opts.ownUploads)) && !ownFiles(slice, opts)[str(rec.driveFileId)]) {
          return verdict(item, false, { reason: 'not-own-file' });
        }
        var m = pick(rec, CHAT_FIELDS);
        if (['text', 'image', 'file'].indexOf(m.type) === -1) m.type = 'text';
        if (ownUser) m.senderName = str(ownUser.name);
        m.readBy = [str(me.acct)];
        return verdict(item, true, { key: key, rec: m });
      }
      if (key === 'voctrain_studentProfiles') {
        var pk = str(item.recId);
        if (pk !== str(me.acct) && pk !== str(me.stu)) return verdict(item, false, { reason: 'not-yours' });
        if (rec.photo != null && str(rec.photo).length > PHOTO_MAX_CHARS) return verdict(item, false, { reason: 'too-large' });
        if (rec.profilePic != null && str(rec.profilePic).length > PHOTO_MAX_CHARS) return verdict(item, false, { reason: 'too-large' });
        var p = pick(rec, PROFILE_FIELDS);
        // A name is the office's to change: a different one is a request to them.
        var ownName = ownStudent ? str(ownStudent.name) : '';
        if (rec.name != null && ownName && Core.normName(rec.name) !== Core.normName(ownName)) p.requestedName = str(rec.name);
        if (ownName) p.name = ownName;
        else if (rec.name != null) p.name = str(rec.name);
        return verdict(item, true, { key: key, recId: pk, rec: p });
      }
      return verdict(item, false, { reason: 'not-yours' });
    }
    function validateOp(item, me, slice, opts) {
      var op = item.op;
      if (!isObj(op)) return verdict(item, false, { reason: 'malformed' });
      var out = { id: str(op.id || item.id), kind: str(op.kind), at: str(op.at || item.createdAt) };
      var data = slice && slice.data ? slice.data : null;
      if (op.kind === 'read' || op.kind === 'clearNotif') {
        var key = op.kind === 'clearNotif' ? 'voctrain_notifications' : str(op.key);
        if (key === 'voctrain_chatMessages' && op.kind === 'read') {
          if (op.roomId == null) return verdict(item, false, { reason: 'malformed' });
          if (slice && (slice.access && slice.access.rooms || []).map(str).indexOf(str(op.roomId)) === -1) return verdict(item, false, { reason: 'unknown-room' });
          out.key = key; out.roomId = str(op.roomId);
          return verdict(item, true, { op: out });
        }
        if (key !== 'voctrain_announcements' && key !== 'voctrain_notifications') return verdict(item, false, { reason: 'not-yours' });
        if (op.recId == null) return verdict(item, false, { reason: 'malformed' });
        if (data && !idsOf(data[key])[str(op.recId)]) return verdict(item, false, { reason: 'unknown-record' });
        out.key = key; out.recId = str(op.recId);
        return verdict(item, true, { op: out });
      }
      if (op.kind === 'chatFollow') {
        var target = str(op.target);
        if (!target || target === str(me.acct)) return verdict(item, false, { reason: 'malformed' });
        if (data) {
          var people = dict();
          sliceData(slice, 'voctrain_chatRooms').forEach(function (r) { (r.members || []).forEach(function (m) { people[str(m)] = 1; }); });
          if (!people[target]) return verdict(item, false, { reason: 'unknown-record' });
        }
        out.target = target; out.on = op.on !== false;
        return verdict(item, true, { op: out });
      }
      if (op.kind === 'backupCodeUsed') {
        // Written into an inbox by the gatekeeper itself when a backup code is
        // spent at sign-in — never something a trainee's device may send.
        if (opts.lane !== true || !/^h1-[0-9a-z]+$/.test(str(op.codeHash))) return verdict(item, false, { reason: 'not-yours' });
        out.codeHash = str(op.codeHash);
        return verdict(item, true, { op: out });
      }
      return verdict(item, false, { reason: 'not-yours' });
    }
    function validateItem(item, me, slice, opts) {
      opts = opts || {};
      if (!isObj(item) || !isObj(me) || !me.acct || !me.stu) return verdict(item, false, { reason: 'malformed' });
      if (item.a != null && str(item.a) !== str(me.acct)) return verdict(item, false, { reason: 'not-yours' });
      var size = 0;
      try { size = utf8Length(JSON.stringify(item)); } catch (e) { return verdict(item, false, { reason: 'malformed' }); }
      if (size > ITEM_MAX_BYTES + 4096) return verdict(item, false, { reason: 'too-large' });
      if (item.kind === 'rec') return validateRecord(item, me, slice, opts);
      if (item.kind === 'op') return validateOp(item, me, slice, opts);
      if (item.kind === 'submit') {
        var why = checkAttempt(item.attempt, me, slice, opts, true);
        if (why) return verdict(item, false, { reason: why });
        return verdict(item, true, { attempt: normAttempt(item.attempt, me) });
      }
      return verdict(item, false, { reason: 'not-yours' });
    }

    /* ---- Operations, applied on a staff device (§5.6) --------------------
       store: the collections the operations touch, by store key —
       voctrain_announcements, voctrain_notifications, voctrain_chatMessages,
       voctrain_chatFollows, voctrain_chatFollowLog, voctrain_users. Changed
       IN PLACE; each operation touches only the trainee's own mark, and
       applying one twice changes nothing. Returns { applied, skipped,
       changed: [store keys], touchedAccounts: [ids] } — an account whose
       backup code was burnt must be stamped (touchAccount) by the page. */
    function applyOps(store, ops, me) {
      store = store || {};
      var res = { applied: 0, skipped: 0, changed: [], touchedAccounts: [] };
      var changed = function (k) { if (res.changed.indexOf(k) === -1) res.changed.push(k); };
      var acct = str(me && me.acct);
      (Array.isArray(ops) ? ops : []).forEach(function (op) {
        if (!isObj(op) || !acct) { res.skipped++; return; }
        var did = false;
        if ((op.kind === 'read' || op.kind === 'clearNotif') && op.recId != null) {
          var key = op.kind === 'clearNotif' ? 'voctrain_notifications' : op.key;
          var rec = (Array.isArray(store[key]) ? store[key] : []).filter(function (r) { return r && str(r.id) === str(op.recId); })[0];
          if (rec) did = op.kind === 'clearNotif' ? Core.comms.markCleared(rec, acct) : Core.comms.markRead(rec, acct);
          if (did) changed(key);
        } else if (op.kind === 'read' && op.key === 'voctrain_chatMessages') {
          var room = isObj(store.voctrain_chatMessages) ? store.voctrain_chatMessages[str(op.roomId)] : null;
          var upTo = msOf(op.at) || Infinity;
          (Array.isArray(room) ? room : []).forEach(function (m) {
            if (!isObj(m) || msOf(m.timestamp) > upTo) return;
            if (!Array.isArray(m.readBy)) m.readBy = [];
            if (m.readBy.indexOf(acct) === -1) { m.readBy.push(acct); did = true; }
          });
          if (did) changed('voctrain_chatMessages');
        } else if (op.kind === 'chatFollow' && op.target) {
          if (!isObj(store.voctrain_chatFollows)) store.voctrain_chatFollows = {};
          if (!isObj(store.voctrain_chatFollowLog)) store.voctrain_chatFollowLog = {};
          var lg = {}; lg[acct] = {}; lg[acct][str(op.target)] = { on: op.on !== false, at: str(op.at) || new Date(0).toISOString() };
          did = Core.chatSync.mergeFollows(store.voctrain_chatFollows, store.voctrain_chatFollowLog, {}, lg);
          if (did) { changed('voctrain_chatFollows'); changed('voctrain_chatFollowLog'); }
        } else if (op.kind === 'backupCodeUsed' && op.codeHash) {
          var account = (Array.isArray(store.voctrain_users) ? store.voctrain_users : []).filter(function (a) { return a && str(a.id) === acct; })[0];
          (account && Array.isArray(account.backupCodes) ? account.backupCodes : []).forEach(function (c) {
            if (c && !c.used && codeHash(c.code) === op.codeHash) { c.used = true; did = true; }
          });
          if (did) { changed('voctrain_users'); if (res.touchedAccounts.indexOf(acct) === -1) res.touchedAccounts.push(acct); }
        } else { res.skipped++; return; }
        if (did) res.applied++;
      });
      return res;
    }

    /* ---- From an inbox to the backup merge (§5.6) ---- */
    var PAYLOAD_NAMES = { voctrain_examAttempts: 'examAttempts', voctrain_submissions: 'assignmentSubmissions',
      voctrain_support_messages: 'supportMessages', voctrain_studentProfiles: 'studentProfiles',
      voctrain_chatMessages: 'chatMessages', voctrain_examResults: 'examResults' };
    // Merged by the record rules of the Centre's network (Core.pageCloud), not mergeBackupData.
    var RECORD_ONLY = { voctrain_certTranscriptRequests: 1 };
    /* A partial backup payload: only the collections present, each under the
       name mergeBackupData() reads ({version, data}); a partial payload
       touches nothing else. Collections the backup has no name for go under
       `records`, by store key. A collection a trainee may not write is not
       carried at all. */
    function toPayload(records) {
      var out = { version: '1.0', data: {}, records: {} };
      Object.keys(isObj(records) ? records : {}).sort().forEach(function (k) {
        if (PAYLOAD_NAMES[k]) out.data[PAYLOAD_NAMES[k]] = copy(records[k]);
        else if (RECORD_ONLY[k]) out.records[k] = copy(records[k]);
      });
      return out;
    }

    /* Accounts folded into others (a provable duplicate stub folded into the
       trainee's real account): { stubId: intoId }. Accepts the dashboard's
       log ({ stubId: { mergedInto } }, cestisFoldedAccounts), a plain map, or
       Core.accountAccess.backfillStubFolds()'s { folds: [{ id, into }] }. */
    function foldMap(input) {
      var out = dict();
      var list = Array.isArray(input) ? input : (isObj(input) && Array.isArray(input.folds) ? input.folds : null);
      if (list) list.forEach(function (f) { if (isObj(f) && f.id != null && f.into != null) out[str(f.id)] = str(f.into); });
      else if (isObj(input)) Object.keys(input).forEach(function (k) {
        var v = input[k], to = isObj(v) ? v.mergedInto : v;
        if (to != null && to !== '' && typeof to !== 'object') out[str(k)] = str(to);
      });
      return out;
    }
    /* Every fold that applies: those the dashboard has already made (its
       log, cestisFoldedAccounts — a folded stub is deleted, so only the log
       still knows it) and those the accounts list proves but this device has
       not made yet (Core.accountAccess.backfillStubFolds). The log wins. */
    function foldsOf(given, accounts, students) {
      var out = foldMap(given);
      if (Core.accountAccess && typeof Core.accountAccess.backfillStubFolds === 'function') {
        var live = foldMap(Core.accountAccess.backfillStubFolds(Array.isArray(accounts) ? accounts : [], Array.isArray(students) ? students : []));
        Object.keys(live).forEach(function (k) { if (!out[k]) out[k] = live[k]; });
      }
      return out;
    }
    /* Whose work is this now? The account named by the trainee's folder,
       followed through any fold, with the trainee record it belongs to
       TODAY (a rename or a transfer moves the student ID). { acct, stu,
       account, student } — or { reason } when it cannot be placed:
       'account-gone', 'not-a-trainee', 'student-gone', 'ambiguous' (two
       records it could be, or folds that go round in a circle). */
    function resolveOwner(acct, cx) {
      cx = cx || {};
      var folds = foldsOf(cx.folds, cx.accounts, cx.students), id = str(acct), hops = 0, been = dict();
      while (folds[id]) {
        been[id] = 1;
        id = folds[id];
        hops++;
        if (been[id]) return { reason: 'ambiguous' };
      }
      var del = {};
      (Array.isArray(cx.deletedUserIds) ? cx.deletedUserIds : []).forEach(function (x) { del[x] = true; });
      var accounts = Core.accountAccess.dropDeleted(Array.isArray(cx.accounts) ? cx.accounts : [], del).accounts;
      var account = accounts.filter(function (a) { return a && str(a.id) === id; })[0];
      if (!account) return { reason: 'account-gone' };
      if (lower(account.role) !== 'student') return { reason: 'not-a-trainee' };
      var students = Array.isArray(cx.students) ? cx.students : [];
      var st = studentFor(account, students);
      if (!st) return { reason: Core.accountAccess.studentLinkFor(account, students).ambiguous ? 'ambiguous' : 'student-gone' };
      return { acct: id, stu: str(st.id), account: account, student: st, folded: hops > 0 };
    }
    /* Rewrite the trainee's ids in what they sent to who they are now: every
       studentId and accountId (and a chat message's sender) that was theirs
       when written. Anything else is left exactly as it is. A copy. */
    function reown(records, from, to) {
      var oldS = dict(), oldA = dict();
      [from && from.stu].concat(from && from.stus || []).forEach(function (x) { if (x) oldS[str(x)] = 1; });
      [from && from.acct].concat(from && from.accts || []).forEach(function (x) { if (x) oldA[str(x)] = 1; });
      var out = copy(isObj(records) ? records : {});
      var fix = function (r) {
        if (!isObj(r)) return;
        if (r.studentId != null && oldS[str(r.studentId)]) r.studentId = str(to.stu);
        if (r.accountId != null && oldA[str(r.accountId)]) r.accountId = str(to.acct);
        if (r.senderId != null && oldA[str(r.senderId)]) r.senderId = str(to.acct);
        if (Array.isArray(r.readBy)) r.readBy = r.readBy.map(function (x) { return oldA[str(x)] ? str(to.acct) : x; })
          .filter(function (x, i, all) { return all.indexOf(x) === i; });
      };
      Object.keys(out).forEach(function (k) {
        var v = out[k];
        if (k === 'voctrain_studentProfiles' && isObj(v)) {
          var m = {};
          Object.keys(v).forEach(function (pk) {
            var nk = oldS[pk] ? str(to.stu) : (oldA[pk] ? str(to.acct) : pk);
            if (m[nk] && msOf(m[nk].updatedAt) >= msOf(v[pk] && v[pk].updatedAt)) return;
            m[nk] = v[pk];
          });
          out[k] = m;
        } else if (k === 'voctrain_chatMessages' && isObj(v)) {
          Object.keys(v).forEach(function (room) { (Array.isArray(v[room]) ? v[room] : []).forEach(fix); });
        } else if (Array.isArray(v)) v.forEach(fix);
      });
      return out;
    }
    // Two copies of a record from two inboxes: the attempt rules for attempts,
    // the first submission for results, otherwise the copy written last.
    function mergeRecords(acc, recs) {
      Object.keys(recs || {}).forEach(function (k) {
        var v = recs[k];
        if (k === 'voctrain_examAttempts') { acc[k] = Core.exams.mergeAttemptLists(acc[k] || [], v || []).list; return; }
        if (k === 'voctrain_certTranscriptRequests' && Core.Transcript && Core.Transcript.mergeRequestLists) {
          acc[k] = Core.Transcript.mergeRequestLists(acc[k] || [], v || []); return;
        }
        if (k === 'voctrain_studentProfiles' || k === 'voctrain_chatMessages') {
          var m = acc[k] || {};
          Object.keys(isObj(v) ? v : {}).forEach(function (mk) {
            if (k === 'voctrain_chatMessages') m[mk] = byIdNewest(m[mk] || [], v[mk] || []);
            else if (!m[mk] || stampOf(v[mk]) >= stampOf(m[mk])) m[mk] = v[mk];
          });
          acc[k] = m; return;
        }
        acc[k] = byIdNewest(acc[k] || [], v || []);
        if (k === 'voctrain_examResults') Core.exams.oneResultPerAttempt(acc[k]);
      });
      return acc;
    }
    function byIdNewest(a, b) {
      var out = a.slice(), at = dict();
      out.forEach(function (r, i) { if (r && r.id != null) at[str(r.id)] = i; });
      (Array.isArray(b) ? b : []).forEach(function (r) {
        if (!isObj(r)) return;
        var k = r.id != null ? str(r.id) : null;
        if (k === null || at[k] === undefined) { if (k !== null) at[k] = out.length; out.push(r); return; }
        if (stampOf(r) > stampOf(out[at[k]])) out[at[k]] = r;
      });
      return out;
    }

    /* ---- A session's lane (§5.1) ----------------------------------------
       What one session sent, in its own inbox file (one writer, so no lock):
       an attempt merged question by question (Core.exams.mergeAttemptLists),
       a profile kept by its key, a chat message by its id within its room,
       anything else by its id — the copy stamped last wins, and on a tie the
       one just sent. laneStamp is that stamp: the newest of updatedAt,
       timestamp, submittedAt, requestedAt and createdAt, as written (only the
       session's own copies are compared). laneMerge(lane, v, nowMs) takes
       what validateItem kept (v: { key, rec, recId }) and changes the lane
       in place. */
    function laneStamp(r) {
      if (!isObj(r)) return 0;
      return Math.max(msOf(r.updatedAt), msOf(r.timestamp), msOf(r.submittedAt), msOf(r.requestedAt), msOf(r.createdAt));
    }
    function laneMerge(lane, v, nowMs) {
      var R = lane.records || (lane.records = {}), k = v.key, rec = v.rec;
      var byId = function (list, r) {
        list = Array.isArray(list) ? list : [];
        for (var i = 0; i < list.length; i++) {
          if (list[i] && str(list[i].id) === str(r.id)) { if (laneStamp(r) >= laneStamp(list[i])) list[i] = r; return list; }
        }
        list.push(r);
        return list;
      };
      if (k === 'voctrain_examAttempts') { R[k] = Core.exams.mergeAttemptLists(R[k] || [], [rec], { nowMs: nowMs }).list; return; }
      if (k === 'voctrain_studentProfiles') {
        var m = isObj(R[k]) ? R[k] : {};
        if (!m[v.recId] || laneStamp(rec) >= laneStamp(m[v.recId])) m[v.recId] = rec;
        R[k] = m; return;
      }
      if (k === 'voctrain_chatMessages') {
        var rooms = isObj(R[k]) ? R[k] : {};
        var room = str(rec.roomId), msg = {};
        Object.keys(rec).forEach(function (f) { if (f !== 'roomId') msg[f] = rec[f]; });
        rooms[room] = byId(rooms[room], msg);
        R[k] = rooms; return;
      }
      R[k] = byId(R[k], rec);
    }
    /* When the gatekeeper first saw an attempt — for the late flag only
       (§5.3): written once into the lane's firstSeen; true when this call
       wrote it. firstSeenOf: the earliest of those times, over every lane, of
       any of the attempt's ids (several devices' copies of one attempt), or
       nowMs when none has one. */
    function laneFirstSeen(lane, attemptId, nowMs) {
      if (!isObj(lane.firstSeen)) lane.firstSeen = {};
      var k = str(attemptId);
      if (lane.firstSeen[k]) return false;
      lane.firstSeen[k] = iso(nowMs);
      return true;
    }
    function firstSeenOf(lanes, ids, nowMs) {
      var first = nowMs;
      (Array.isArray(lanes) ? lanes : []).forEach(function (l) {
        (Array.isArray(ids) ? ids : []).forEach(function (id) { var t = msOf(l && l.firstSeen && l.firstSeen[id]); if (t && t < first) first = t; });
      });
      return first;
    }
    /* Everything a staff device's collector does between downloading the
       inbox files and merging them (§5.6 steps 2–4), as one pure step.
       files: [{ fileId, version, modifiedTime, folderAcct (from the folder's
       description — never from the file), json }]. cx: { accounts,
       deletedUserIds, students, folds, seen: { fileId: version } }. Every
       record is checked again for ownership and shape. Returns { payload (toPayload of every record, re-owned),
       ops: [{ me, op }], unassigned: [{ file, accountId, studentId, reason,
       records, ops }], refused: [{ file, id, reason }], seen, watermark }.
       A file already collected at its version is skipped, so running it
       twice merges nothing twice. Work that cannot be placed is never
       dropped: it is listed as unassigned and NOT marked seen, so it is
       collected again once an administrator has placed the trainee. */
    function collect(files, cx) {
      cx = cx || {};
      var seen = copy(isObj(cx.seen) ? cx.seen : {});
      var out = { payload: null, ops: [], unassigned: [], refused: [], seen: seen, watermark: str(cx.watermark), files: 0 };
      var acc = {};
      (Array.isArray(files) ? files : []).forEach(function (f) {
        if (!isObj(f)) return;
        var tag = str(f.fileId || f.id || f.name), ver = str(f.version != null ? f.version : f.modifiedTime);
        if (!tag || seen[tag] === ver) return;
        var j = f.json;
        if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { j = null; } }
        if (!isObj(j) || (j.format !== FORMAT.inbox && j.format !== FORMAT.result)) {
          out.refused.push({ file: tag, reason: 'malformed' }); seen[tag] = ver; return;
        }
        // A newer format than this device knows: left for a newer device, never read as empty.
        if (Number(j.version) > VERSION) { out.refused.push({ file: tag, reason: 'newer-version' }); return; }
        var folderAcct = str(f.folderAcct);
        var from = { acct: str(j.accountId), stu: str(j.studentId) };
        var me = { acct: from.acct, stu: from.stu };
        var recs = {}, ops = [];
        if (!folderAcct || from.acct !== folderAcct || !from.stu) {
          out.unassigned.push({ file: tag, accountId: folderAcct, studentId: from.stu, reason: 'owner-mismatch', records: {}, ops: [] });
          return;
        }
        // Checked again for ownership and shape: what the trainee may reach
        // (their programme's exams, their rooms) was checked by the
        // gatekeeper when it was sent, and may have moved since (a transfer).
        var slice = null;
        if (j.format === FORMAT.result) {
          var r = j.result;
          if (!isObj(r) || str(r.studentId) !== from.stu || r.markedBy !== 'gate' || str(r.attemptId) !== str(j.attemptId)) {
            out.refused.push({ file: tag, id: str(r && r.id), reason: 'not-yours' }); seen[tag] = ver; return;
          }
          recs.voctrain_examResults = [copy(r)];
          if (isObj(j.retired) && str(j.retired.studentId) === from.stu && Core.exams.attemptIsRetired(j.retired)) recs.voctrain_examAttempts = [copy(j.retired)];
        } else {
          var R = isObj(j.records) ? j.records : {};
          Object.keys(R).forEach(function (key) {
            var v = R[key];
            var check = function (rec, recId) {
              var res = validateItem({ id: rec && rec.id, kind: 'rec', key: key, rec: rec, recId: recId }, me, slice, { lane: true });
              if (!res.ok) { out.refused.push({ file: tag, id: str(rec && rec.id), reason: res.reason }); return null; }
              return res.rec || null;
            };
            if (key === 'voctrain_studentProfiles' && isObj(v)) {
              Object.keys(v).forEach(function (pk) {
                var p = check(v[pk], pk);
                if (p) { recs[key] = recs[key] || {}; recs[key][pk] = p; }
              });
            } else if (key === 'voctrain_chatMessages' && isObj(v)) {
              Object.keys(v).forEach(function (room) {
                (Array.isArray(v[room]) ? v[room] : []).forEach(function (m) {
                  var c = check(Object.assign({ roomId: room }, m));
                  if (c) { recs[key] = recs[key] || {}; (recs[key][room] = recs[key][room] || []).push(c); }
                });
              });
            } else if (Array.isArray(v)) {
              v.forEach(function (rec) {
                // (An attempt here is always open: the gatekeeper retires one
                // in its result file, never in a trainee's inbox.)
                var c = check(rec);
                if (c) (recs[key] = recs[key] || []).push(c);
              });
            } else out.refused.push({ file: tag, id: key, reason: 'malformed' });
          });
          (Array.isArray(j.ops) ? j.ops : []).forEach(function (op) {
            var res = validateItem({ id: op && op.id, kind: 'op', op: op }, me, slice, { lane: true });
            if (res.ok) ops.push(res.op); else out.refused.push({ file: tag, id: str(op && op.id), reason: res.reason });
          });
        }
        var owner = resolveOwner(folderAcct, cx);
        if (!owner.acct) {
          out.unassigned.push({ file: tag, accountId: folderAcct, studentId: from.stu, reason: owner.reason, records: recs, ops: ops });
          return;
        }
        mergeRecords(acc, reown(recs, from, owner));
        ops.forEach(function (op) { out.ops.push({ me: { acct: owner.acct, stu: owner.stu }, op: op }); });
        seen[tag] = ver;
        out.files++;
        if (str(f.modifiedTime) > out.watermark) out.watermark = str(f.modifiedTime);
      });
      out.payload = toPayload(acc);
      return out;
    }

    /* ---- Marking at the gate (§5.3) --------------------------------------
       The questions are rebuilt FROM THE KEY, by id — their text, type and
       points — never taken from the trainee's copy, so a copy edited to say
       a question is worth more, or to leave a hard one out, changes nothing:
       every question of the key counts (one left out is unanswered), and a
       question the key does not have is ignored, never guessed. The answers
       come from the attempt; optionOrder only says how the paper looked.
       The result's id comes from the attempt's, so two devices submitting
       the same attempt make the same result. opts: { crypto, receivedAt,
       firstSeen (when the gatekeeper first saw this attempt), auto,
       studentName }. Returns { result, retired, file } or { error }. */
    var LATE_GRACE_MS = 2 * 60 * 1000;
    function resultId(attemptId, crypto) { return 'RES-G-' + str(need(crypto, 'sha256Hex').sha256Hex(str(attemptId))).toLowerCase().slice(0, 16); }
    function markAttempt(attempt, keyFile, nowMs, opts) {
      opts = opts || {};
      if (!isObj(keyFile) || keyFile.format !== FORMAT.key || !isObj(keyFile.exam)) return { error: 'no-key' };
      if (Number(keyFile.version) > VERSION) return { error: 'newer-version' };
      if (!isObj(attempt) || !Array.isArray(attempt.questions) || attempt.id == null) return { error: 'malformed' };
      var exam = keyFile.exam;
      if (str(exam.id) !== str(attempt.examId) || str(keyFile.examId) !== str(attempt.examId)) return { error: 'wrong-exam' };
      var keyed = Array.isArray(exam.questionData) ? exam.questionData : [];
      var byId = dict();
      keyed.forEach(function (q) { if (q && q.id != null && !byId[str(q.id)]) byId[str(q.id)] = q; });
      var used = dict(), qs = [], answers = [], ignored = [];
      attempt.questions.forEach(function (q, i) {
        var id = q && q.id != null ? str(q.id) : null;
        if (id === null || !byId[id]) { if (id !== null) ignored.push(id); return; }
        if (used[id]) return;
        used[id] = 1;
        var pub = Core.exams.publicQuestions([byId[id]])[0];
        if (Array.isArray(q.optionOrder) && isPermutation(q.optionOrder, (pub.options || []).length)) pub.optionOrder = q.optionOrder.slice();
        qs.push(pub);
        answers.push(Array.isArray(attempt.answers) && attempt.answers[i] !== undefined ? copy(attempt.answers[i]) : null);
      });
      keyed.forEach(function (q) {
        if (!q || q.id == null || used[str(q.id)]) return;
        used[str(q.id)] = 1;
        qs.push(Core.exams.publicQuestions([q])[0]);
        answers.push(null);
      });
      var m = Core.exams.mark(qs, answers, keyed);
      var needsReview = m.manualCount > 0;
      var score = m.totalPoints > 0 ? Math.round(m.earnedPoints / m.totalPoints * 100) : 0;
      var passMark = Number(exam.passMark);
      var start = msOf(attempt.startTime) || nowMs;
      var deadline = Core.exams.sessionDeadline(exam, start, keyFile.centreUtcOffset);
      if (msOf(attempt.deadline) && msOf(attempt.deadline) < deadline) deadline = msOf(attempt.deadline);
      var received = msOf(opts.receivedAt) || nowMs;
      var id = resultId(attempt.id, opts.crypto);
      var result = {
        id: id, attemptId: str(attempt.id), examId: str(attempt.examId), studentId: str(attempt.studentId),
        studentName: str(opts.studentName != null ? opts.studentName : attempt.studentName),
        answers: m.gradedResults, score: score, correctCount: m.correctCount,
        totalQuestions: qs.filter(function (q) { return !(q && q.type === 'info'); }).length,
        totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: needsReview ? false : score >= passMark,
        needsReview: needsReview, reviewComplete: !needsReview, pendingCount: m.manualCount,
        submittedAt: iso(received), startedAt: iso(start),
        timeTaken: Math.max(0, Math.floor((Math.min(received, deadline) - start) / 1000)),
        markedBy: 'gate', markedAt: iso(nowMs), receivedAt: iso(received)
      };
      if (opts.auto) result.autoSubmitted = true;
      if (ignored.length) result.ignoredQuestionIds = ignored;
      // Late answers are kept and flagged for staff, never refused.
      var win = Core.exams.windowOf(exam, keyFile.centreUtcOffset);
      var first = msOf(opts.firstSeen);
      var dur = (parseInt(exam.duration, 10) || 90) * 60000;
      if ((win && win.end != null && received > win.end + LATE_GRACE_MS) || (first && received > first + dur + LATE_GRACE_MS)) result.late = true;
      var retired = Core.exams.retireAttempt(attempt, id, result.submittedAt);
      var keyHash = str(keyFile.hash) || hashOf({ exam: exam, centreUtcOffset: str(keyFile.centreUtcOffset) });
      return { result: result, retired: retired, keyHash: keyHash,
        file: { format: FORMAT.result, version: VERSION, accountId: str(opts.accountId || attempt.accountId), studentId: result.studentId,
          attemptId: result.attemptId, keyHash: keyHash, markedAt: result.markedAt, result: result, retired: retired } };
    }
    /* A result as a trainee may see it: the right answers only once the
       exam's release policy allows, on the GIVEN time (the gatekeeper's, never
       the device's). With no exam to ask, never. A copy. */
    function redactResult(result, exam, nowMs, offset) {
      var r = copy(result);
      if (!isObj(r)) return r;
      var reveal = !!exam && Core.exams.canRevealAnswers(exam, nowMs, offset);
      if (Array.isArray(r.answers)) r.answers.forEach(function (a) {
        if (!isObj(a)) return;
        delete a.pairs; delete a.distractors;
        if (!reveal) { delete a.correctAnswer; delete a.tolerance; }
      });
      return r;
    }
    /* The right answers put back into a result, from the exam's key file.

       Every result in a slice is redacted (a slice never carries a key), so
       a test marked on a lab PC reaches the trainee's own device without its
       right answers — and the online gatekeeper, answering `review` from
       that copy, said "released" and showed none, while the Centre's server,
       which holds the result whole, showed them. Before redactResult decides
       (on the gatekeeper's clock) whether they may be shown, each answer's
       right answer is worked out from the key's own question exactly as
       marking shows it (Core.exams.mark). An answer that already carries one
       keeps it (a result the gate marked, the Centre's own copy); one whose
       question the key no longer has stays without; a key file of another
       exam fills nothing. Each answer keeps marking's own order of fields,
       so the copy reads byte for byte as the whole one. A copy. */
    function fillAnswers(result, keyFile) {
      var r = copy(result);
      if (!isObj(r) || !Array.isArray(r.answers)) return r;
      if (!isObj(keyFile) || keyFile.format !== FORMAT.key || !isObj(keyFile.exam) || str(keyFile.exam.id) !== str(r.examId)) return r;
      var byId = dict();
      (Array.isArray(keyFile.exam.questionData) ? keyFile.exam.questionData : []).forEach(function (q) {
        if (q && q.id != null && !byId[str(q.id)]) byId[str(q.id)] = q;
      });
      r.answers.forEach(function (a, i) {
        if (!isObj(a) || a.questionId == null || hasOwn.call(a, 'correctAnswer')) return;
        var kq = byId[str(a.questionId)];
        if (!kq || kq.type === 'info') return;
        var row = Core.exams.mark(Core.exams.publicQuestions([kq]), [null], [kq]).gradedResults[0];
        if (!row) return;
        var put = { correctAnswer: copy(row.correctAnswer) };
        if (row.tolerance !== undefined && !hasOwn.call(a, 'tolerance')) put.tolerance = row.tolerance;
        var out = {};
        Object.keys(row).forEach(function (k) { if (hasOwn.call(a, k)) out[k] = a[k]; else if (hasOwn.call(put, k)) out[k] = put[k]; });
        Object.keys(a).forEach(function (k) { if (!hasOwn.call(out, k)) out[k] = a[k]; });
        Object.keys(put).forEach(function (k) { if (!hasOwn.call(out, k)) out[k] = put[k]; });
        r.answers[i] = out;
      });
      return r;
    }
    /* The trainee's attempt at one exam, however many devices and inboxes it
       is spread over (§5.3 attempt.get): their result if there is one, else
       'retired' (submitted elsewhere, result not here yet), else the attempt
       in progress as ONE attempt (Core.exams.attemptFor), else 'none'.
       src: { lanes: [inbox], results: [result file], slice }. */
    function resumeAttempt(src, studentId, examId) {
      src = src || {};
      var lists = [], results = [];
      (Array.isArray(src.lanes) ? src.lanes : []).forEach(function (l) {
        var v = l && isObj(l.records) ? l.records.voctrain_examAttempts : null;
        if (Array.isArray(v)) lists.push(v);
      });
      (Array.isArray(src.results) ? src.results : []).forEach(function (f) {
        if (f && isObj(f.result)) results.push(f.result);
        if (f && isObj(f.retired)) lists.push([f.retired]);
      });
      if (src.slice) { lists.push(sliceData(src.slice, 'voctrain_examAttempts')); results = results.concat(sliceData(src.slice, 'voctrain_examResults')); }
      var merged = [];
      lists.forEach(function (l) { merged = Core.exams.mergeAttemptLists(merged, copy(l)).list; });
      var pair = function (r) { return r && str(r.studentId) === str(studentId) && str(r.examId) === str(examId); };
      var when = function (r) { return msOf(r.submittedAt) || Number.MAX_VALUE; };
      var mine = results.filter(function (r) { return pair(r) && !r.archived; })
        .sort(function (a, b) { return when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : cmpId(a, b); });
      if (mine.length) return { state: 'result', result: copy(mine[0]) };
      var retired = merged.filter(function (a) { return pair(a) && Core.exams.attemptIsRetired(a); })[0];
      if (retired) return { state: 'retired', retired: copy(retired) };
      var cur = Core.exams.attemptFor(merged, studentId, examId);
      if (cur) return { state: 'attempt', attempt: cur.attempt, ids: cur.ids };
      return { state: 'none' };
    }

    /* ---- Clearing a device that holds everything (§7.3) -----------------
       cleanupPlan(storeKeys, markers) → { remove, keep, send, defer }.
       markers: { gateOn, viaGate (the trainee has just signed in through the
       gate), deviceKind, pendingUpload (the raw cestisPendingUpload note),
       unsent: { key: true } — keys holding work not yet sent (the caller
       reads them), receipts: { key: true } — keys whose unsent work has been
       delivered (or, for another trainee's, put aside), unreadable: [keys] }.
       Nothing is removed while anything is unsent; the Centre's records go
       only once every receipt is in; when anything is unclear, everything is
       kept and the plan says why (defer), to be tried at the next sign-in.
       Keys this does not recognise are kept. */
    var CENTRE_TOKENS = ['schoolDashboardGoogleAccessToken', 'schoolDashboardGoogleTokenExpiry', 'cestisGoogleAccessToken',
      'cestisGoogleTokenExpiry', 'schoolDashboardCloudFileId', 'cestisCloudFileId', 'cestisCloudFolderId', 'schoolFeeCloudFileId',
      'cestisUserFilesFolderId', 'dashboardUsers'];
    var KEEP_KEYS = ['cestisTheme', 'darkMode', 'cestisTimeDarkMode', 'firstTimeSyncDismissed', 'cestisFirstTimeDismissed',
      'cestisPendingUpload', 'cestisUnsyncedOnSignOut', 'cestisCertDeviceSessionId', 'voctrain_supportSendLog',
      'voctrain_sessionUpgradeCarried', 'voctrain_examInProgress', 'cestisExamOutbox', 'isLoggedIn', 'loggedInUser',
      'cestisCurrentUser', 'cestiCurrentUser', 'cestisAttendanceCurrentUser', 'postLoginSyncCompleted', 'cloudSyncCompleted',
      'cestisAutoSyncEnabled'];
    function centreKey(k) {
      if (CENTRE_TOKENS.indexOf(k) !== -1) return true;
      if (/^voctrain_session/.test(k) || k.indexOf('voctrain_extSysCertHelpSeen_') === 0) return false;
      if (k.indexOf('voctrain_') === 0) return true;          // the Centre's record collections, per-user copies included
      if (/^cesti/.test(k)) {
        if (k.indexOf('cestisExamSession__') === 0 || k.indexOf('cestis_pagecloud_stamps__') === 0) return false;
        return true;                                           // fees, payroll, finance, the time clock, quarters
      }
      return /LastSyncTime$/.test(k);
    }
    function cleanupPlan(storeKeys, markers) {
      markers = markers || {};
      var keys = uniqSorted(storeKeys);
      var unsent = isObj(markers.unsent) ? markers.unsent : {}, receipts = isObj(markers.receipts) ? markers.receipts : {};
      var plan = { remove: [], keep: keys.slice(), send: [], defer: null };
      var defer = function (why) { plan.remove = []; plan.keep = keys.slice(); plan.defer = why; return plan; };
      var has = function (m, k) { return hasOwn.call(m, k) && !!m[k]; };
      plan.send = keys.filter(function (k) { return has(unsent, k) && !has(receipts, k); });
      if (!markers.gateOn) return defer('gate-off');
      if (!markers.viaGate) return defer('not-a-gate-sign-in');
      if (markers.deviceKind === 'staff') return defer('staff-device');
      if (markers.pendingUpload && Core.pendingUpload.isStaff(markers.pendingUpload)) return defer('staff-work-not-uploaded');
      if (Array.isArray(markers.unreadable) && markers.unreadable.length) return defer('unreadable');
      if (plan.send.length) return defer('unsent-work');
      var removed = dict();
      keys.forEach(function (k) {
        if (DEVICE_KEYS.indexOf(k) !== -1 || NS_KEY.test(k) || k.indexOf('__cestis_idb_only__:') === 0) return;
        if (has(unsent, k) && has(receipts, k)) { removed[k] = 1; return; }    // delivered: the gate holds it now
        if (KEEP_KEYS.indexOf(k) !== -1) return;
        if (centreKey(k)) removed[k] = 1;
      });
      // A marker saying "this key lives in IndexedDB only" goes with its key.
      var IDB_ONLY = '__cestis_idb_only__:';
      keys.forEach(function (k) { if (k.indexOf(IDB_ONLY) === 0 && removed[k.slice(IDB_ONLY.length)]) removed[k] = 1; });
      plan.remove = keys.filter(function (k) { return removed[k]; });
      plan.keep = keys.filter(function (k) { return !removed[k]; });
      return plan;
    }

    /* ---- Self-test (§10.3): the known answers, computed by whatever runtime
       is running this. A runtime that computes any of them differently is
       not fit to run the gate, and says so. ---- */
    var SELF_TOKEN = 'v1.eyJhIjoiVVNSLVQiLCJjdiI6IjAxMjM0NTY3ODlhYiIsImV4cCI6MTcwMDA0MzIwMDAwMCwiaWF0IjoxNzAwMDAwMDAwMDAwLCJzIjoiU1RVLVQiLCJzaWQiOiJreC5hYmMuMTIzNDU2NzgifQ.e9f79ad401b4ccc21e58bd5831f4d9bf15be00ecdd1ba2ccad2e57d6c5728d04';
    function selfTest(crypto) {
      var checks = [];
      var check = function (name, fn) {
        var ok = false;
        try { ok = fn() === true; } catch (e) { ok = false; }
        checks.push({ name: name, ok: ok });
      };
      check('canon', function () { return canon({ b: [1, 'x', null], a: { d: true, c: -0 } }) === '{"a":{"c":0,"d":true},"b":[1,"x",null]}'; });
      check('sha256', function () { return crypto.sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'; });
      check('hmac-sha256', function () {
        return toHex(fromHex(crypto.hmacHex(utf8('Jefe'), 'what do ya want for nothing?'))) === '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
      });
      check('totp', function () { return hotp(utf8('12345678901234567890'), 1, 8, crypto) === '94287082' && totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000, crypto, { digits: 8 }) === '94287082'; });
      check('token', function () {
        var tok = signToken({ a: 'USR-T', s: 'STU-T', sid: 'kx.abc.12345678', iat: 1700000000000, exp: 1700043200000, cv: '0123456789ab' }, 'selftest-secret', crypto);
        return tok === SELF_TOKEN && verifyToken(tok, 'selftest-secret', crypto, { nowMs: 1700000000001 }).ok === true &&
          verifyToken(tok, 'selftest-secret', crypto, { nowMs: 1700043200000 }).reason === 'expired';
      });
      check('proof', function () {
        return proofMake('ABC123', 'n0', ' Ann@X ', crypto) === hmac(crypto, 'abc123', 'cestis-gate-v1|n0|ann@x');
      });
      return { ok: checks.every(function (c) { return c.ok; }), version: VERSION, checks: checks };
    }

    /* ---- A trainee's folder: its name and its description (DESIGN.md §17)
       A trainee's folder in Trainees/ is named "<Full Name> (<student ID>)",
       e.g. "Tameka Richards (STU-3wfiayryzq)": the owner asked first for the
       student ID, then for the trainee's name, and this keeps both, so the
       office finds a folder by either. It is still FOUND by the account in
       its description ("cestis-trainee acct=USR-… v=1"), never by its name,
       because names and student IDs change; the oldest folder naming an
       account is that account's (every reader's rule). A registration from
       home adds one word to the description while it waits
       ("registration=pending"), another if the office turns it down
       ("registration=rejected"). No folder is ever deleted or binned. */
    var FOLDER_NAME_MAX = 100;
    function folderName(name, stu) {
      var n = str(name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim();
      if (n.length > FOLDER_NAME_MAX) n = n.slice(0, FOLDER_NAME_MAX).trim();
      var s = str(stu).trim();
      if (!n) return s;
      return s ? n + ' (' + s + ')' : n;
    }
    var FOLDER_MARKS = { pending: 1, rejected: 1 };
    function folderDescription(acct, mark) {
      return 'cestis-trainee acct=' + str(acct) + ' v=1' + (FOLDER_MARKS[mark] ? ' registration=' + mark : '');
    }
    function folderMark(description) {
      var m = /(?:^|\s)registration=(pending|rejected)(?:\s|$)/.exec(str(description));
      return m ? m[1] : '';
    }
    // The mark an account's folder carries: a registration still waiting, or one the office turned down.
    function folderMarkFor(account) {
      var st = lower(account && account.status);
      return st === 'pending' ? 'pending' : st === 'rejected' ? 'rejected' : '';
    }

    /* ---- Registration from home (DESIGN.md §17) ---------------------------
       The owner: trainees register at home, for the office to approve; they
       must use their own email account (a Google one) to sign in, so the
       account that reaches the office is theirs. The gate takes a
       registration only with a sign-in token Google gave the dashboard
       (aud), for a verified address, and then — in the same request — keeps
       the registration in Registrations/ and makes the trainee's own folder
       in Trainees/. The rules for both are here (pure); the gate does the
       reading and writing; the staff collector (index.html) brings each
       registration into the accounts list as 'pending', for Verify Users.

       One account per address, however often it is sent: the account id is
       worked out from the address with the gate's own secret
       (regAccountId), so the same person always gets the same id, the same
       file (CESTISREG.<id>.json) and the same folder — never two. */
    var REG_FILE_PREFIX = 'CESTISREG.';
    var REG_ID_PREFIX = 'USR-home-';
    var STORED_PW_RE = /^pbkdf2\$(\d{5,7})\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
    var REG_NAME_MAX = 80;
    function regAccountId(email, secret, crypto) { return REG_ID_PREFIX + hmac(crypto, secret, 'reg|' + lower(email)).slice(0, 20); }
    function regFileName(acct) { return REG_FILE_PREFIX + str(acct) + '.json'; }
    function isRegFileName(name) { return /^CESTISREG\.USR-home-[0-9a-f]{20}\.json$/.test(str(name)); }
    // The student ID the dashboard will give this trainee — its own function, so the two always agree.
    function regStudentId(name, programme) { return Core.stableStudentId({ name: str(name), course: str(programme) }) || ''; }
    function cleanName(name) { return str(name).replace(/\s+/g, ' ').trim(); }

    /* The programmes a trainee may register for: the ones taking trainees
       now, which staff devices publish (Registrations/catalogue.json) — the
       same list the office's own "Add Trainee Account" offers. */
    function buildCatalogue(programmes, nowMs) {
      var seen = dict(), names = [];
      (Array.isArray(programmes) ? programmes : []).forEach(function (p) {
        var n = str(isObj(p) ? p.name : p).trim();
        if (n && !seen[n]) { seen[n] = 1; names.push(n); }
      });
      names.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
      var body = { format: FORMAT.catalogue, version: VERSION, programmes: names.map(function (n) { return { name: n }; }) };
      body.hash = hashOf({ programmes: body.programmes });
      body.builtAt = iso(nowMs);
      return body;
    }
    // The programme names a published catalogue offers ([] for anything that is not one).
    function catalogueNames(cat) {
      if (!isObj(cat) || cat.format !== FORMAT.catalogue || Number(cat.version) > VERSION || !Array.isArray(cat.programmes)) return [];
      return cat.programmes.map(function (p) { return str(isObj(p) ? p.name : p).trim(); }).filter(Boolean);
    }

    /* What the registration form sends, checked: the full name (first and
       last — Core.accountAccess.isFullName, the rule of every account form),
       a programme from the catalogue, an optional phone, and the password as
       the dashboard stores one (pbkdf2$<iterations>$<salt>$<hash>, worked out
       on the trainee's device with a fresh salt — the password itself never
       travels). → { ok, value } | { ok: false, field } */
    function checkRegistration(form, programmes) {
      form = isObj(form) ? form : {};
      var name = cleanName(form.name);
      if (!name || name.length > REG_NAME_MAX || /[<>"\u0000-\u001f]/.test(name) || !Core.accountAccess.isFullName(name)) return { ok: false, field: 'name' };
      var programme = str(form.programme).trim();
      if (!programme || (Array.isArray(programmes) ? programmes : []).indexOf(programme) === -1) return { ok: false, field: 'programme' };
      var phone = str(form.phone).trim();
      if (phone && !Core.accountAccess.PHONE_RE.test(phone)) return { ok: false, field: 'phone' };
      var pw = str(form.password), m = STORED_PW_RE.exec(pw);
      if (!m || Number(m[1]) < 100000 || Number(m[1]) > 1000000) return { ok: false, field: 'password' };
      return { ok: true, value: { name: name, programme: programme, phone: phone, password: pw } };
    }
    /* The registration file (Registrations/CESTISREG.<id>.json). o: { acct,
       email, value (checkRegistration's), folder: { id, name }, nowMs }. */
    function buildRegistration(o) {
      o = o || {};
      var v = o.value || {};
      var out = { format: FORMAT.registration, version: VERSION, accountId: str(o.acct), studentId: regStudentId(v.name, v.programme),
        name: str(v.name), email: str(o.email).trim(), programme: str(v.programme), password: str(v.password),
        googleVerified: true, registeredVia: 'home-registration', status: 'pending', createdAt: iso(o.nowMs) };
      if (v.phone) out.phone = str(v.phone);
      if (o.folder && o.folder.id) { out.folderId = str(o.folder.id); out.folderName = str(o.folder.name); }
      return out;
    }
    /* A registration file read back — by the gate (is one waiting?) and by
       the staff collector. → { reg } | { error: 'not-registration' |
       'newer-version' | 'malformed' } */
    function readRegistration(json) {
      var r = json;
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
      if (!isObj(r) || r.format !== FORMAT.registration) return { error: 'not-registration' };
      if (Number(r.version) > VERSION) return { error: 'newer-version' };
      var ok = str(r.accountId).indexOf(REG_ID_PREFIX) === 0 && EMAIL_RE.test(str(r.email).trim()) && Core.accountAccess.isFullName(r.name) &&
        !/[<>"]/.test(str(r.name) + str(r.email)) && !!str(r.programme).trim() && STORED_PW_RE.test(str(r.password)) && !!msOf(r.createdAt);
      return ok ? { reg: r } : { error: 'malformed' };
    }
    /* What a staff device does with a registration it has collected: add it
       to the accounts list as a 'pending' trainee account for Verify Users
       (the gate's account id, so the folder made for it is already theirs) —
       once. An account of that id already there (collected before, approved,
       rejected): left as the office has it. An id the office deleted: never
       brought back. An address another account already has: not a second
       account (the gate refuses those; this covers an account the office
       made at the same time). opts.dateOf(iso) → the account's createdAt
       day as the dashboard writes it (local), else the date in the ISO text.
       → { action: 'add', account } | { action: 'have', id } |
         { action: 'skip', reason } | { action: 'hold', reason } */
    function importRegistration(json, accounts, deletedUserIds, opts) {
      opts = opts || {};
      var rd = readRegistration(json);
      if (rd.error === 'newer-version') return { action: 'hold', reason: rd.error };
      if (rd.error) return { action: 'skip', reason: rd.error };
      var r = rd.reg, id = str(r.accountId), list = Array.isArray(accounts) ? accounts : [];
      if ((Array.isArray(deletedUserIds) ? deletedUserIds : []).map(str).indexOf(id) !== -1) return { action: 'skip', reason: 'deleted' };
      if (list.some(function (a) { return a && str(a.id) === id; })) return { action: 'have', id: id };
      var em = lower(r.email);
      if (list.some(function (a) { return a && lower(a.email) === em; })) return { action: 'skip', reason: 'email-taken' };
      var base = lower(str(r.email).split('@')[0]).replace(/[^a-z0-9._-]/g, '') || 'trainee', un = base, n = 1;
      var taken = function (u) { return list.some(function (a) { return a && lower(a.username) === u; }); };
      while (taken(un)) { n++; un = base + n; }
      var day = typeof opts.dateOf === 'function' ? str(opts.dateOf(r.createdAt)) : '';
      var acct = { id: id, name: cleanName(r.name), role: 'student', username: un, password: str(r.password), email: str(r.email).trim(),
        programme: str(r.programme).trim(), status: 'pending', createdAt: day || str(r.createdAt).slice(0, 10), registeredVia: 'home-registration',
        googleVerified: true, registeredAt: str(r.createdAt), updatedAt: str(r.createdAt) };
      if (r.phone && Core.accountAccess.PHONE_RE.test(str(r.phone).trim())) acct.phone = str(r.phone).trim();
      if (r.folderId) acct.gateFolderId = str(r.folderId);
      return { action: 'add', account: acct };
    }
    /* What the gate tells somebody registering whose address already has a
       trainee account: sign in ('has-account'), or the account's own state. */
    function regExisting(entry) {
      var st = entry && entry.st;
      if (st === 'pending' || st === 'rejected' || st === 'disabled') return st;
      return 'has-account';
    }

    return {
      folderName: folderName, folderDescription: folderDescription, folderMark: folderMark, folderMarkFor: folderMarkFor,
      reg: { accountId: regAccountId, fileName: regFileName, isFileName: isRegFileName, studentId: regStudentId, buildCatalogue: buildCatalogue,
        catalogueNames: catalogueNames, check: checkRegistration, build: buildRegistration, read: readRegistration, importOne: importRegistration,
        existing: regExisting, FILE_PREFIX: REG_FILE_PREFIX, ID_PREFIX: REG_ID_PREFIX, STORED_PW_RE: STORED_PW_RE },
      indexAccounts: indexAccounts, lookupLogin: lookupLogin, credentialRefusal: credentialRefusal, twoStep: twoStep,
      ticketMake: ticketMake, ticketRead: ticketRead, sidRand: sidRand, sidCv: sidCv,
      laneStamp: laneStamp, laneMerge: laneMerge, laneFirstSeen: laneFirstSeen, firstSeenOf: firstSeenOf,
      fillAnswers: fillAnswers,
      VERSION: VERSION, FORMAT: FORMAT, DEVICE_KEYS: DEVICE_KEYS, NS_KEY: NS_KEY, KEY_NAMES: KEY_NAMES,
      canon: canon, hashOf: hashOf, utf8: utf8, toHex: toHex, fromHex: fromHex, b64url: b64url, unb64url: unb64url, same: same,
      prepare: prepare, sliceFor: sliceFor, buildAll: buildAll, buildSlice: buildSlice,
      buildPaper: buildPaper, buildKey: buildKey, buildRoom: buildRoom, publishDecision: publishDecision,
      sliceExamStatus: sliceExamStatus, paperOpen: paperOpen, studentFor: studentFor, eligible: eligible,
      validateItem: validateItem, applyOps: applyOps, toPayload: toPayload, PAYLOAD_NAMES: PAYLOAD_NAMES,
      foldMap: foldMap, resolveOwner: resolveOwner, reown: reown, collect: collect,
      markAttempt: markAttempt, resultId: resultId, redactResult: redactResult, resumeAttempt: resumeAttempt,
      token: { sign: signToken, verify: verifyToken, claims: tokenClaims, TTL_MS: TOKEN_TTL_MS, REFRESH_MS: TOKEN_REFRESH_MS },
      cv: cvOf, sid: { make: makeSid, check: checkSid }, sessionKey: sessionKey,
      seal: seal, sealOk: sealOk, ITEM_MAX_AGE_MS: ITEM_MAX_AGE_MS,
      proof: { challenge: proofChallenge, message: proofMessage, make: proofMake, expected: proofExpected, verify: proofVerify, parse: parseStored },
      totp: { code: totpCode, verify: totpVerify, hotp: hotp, base32: base32 }, codeHash: codeHash,
      cleanupPlan: cleanupPlan, selfTest: selfTest
    };
  })();

  /* Student IDs that moved, kept by the device that saw the move.

     A trainee's stable ID comes from name + programme, so a rename or a
     transfer moves it (Core.migrateToStableIds returns the move as idMap).
     The dashboard used to throw that map away, so the trainee gate could not
     tell that records arriving later under the old ID are this trainee's
     (Core.gate.prepare's opts.relinked { oldId: newId }). This keeps the
     moves: a later move of the new ID carries the older ones along (A→B then
     B→C keeps A→C and B→C), a move back to an old ID drops that entry, and
     the log is capped to the newest `cap` entries so it never grows without
     end. Pure; the page stores the log on this device only. */
  Core.studentIdMoves = (function () {
    function record(log, idMap, nowMs, cap) {
      var out = {};
      var src = (log && typeof log === 'object' && !Array.isArray(log)) ? log : {};
      Object.keys(src).forEach(function (k) { var e = src[k]; if (e && typeof e.to === 'string' && e.to && e.to !== k) out[k] = { to: e.to, at: Number(e.at) || 0 }; });
      var map = (idMap && typeof idMap === 'object') ? idMap : {};
      var at = Number(nowMs) || 0;
      Object.keys(map).forEach(function (from) {
        var to = map[from];
        if (typeof to !== 'string' || !to || to === from) return;
        Object.keys(out).forEach(function (k) { if (out[k].to === from) out[k] = { to: to, at: at }; });
        out[from] = { to: to, at: at };
        if (out[to]) delete out[to];
      });
      Object.keys(out).forEach(function (k) { if (out[k].to === k) delete out[k]; });
      var keys = Object.keys(out);
      var max = Math.max(1, Number(cap) || 2000);
      if (keys.length > max) {
        keys.sort(function (a, b) { return (out[b].at - out[a].at) || (a < b ? -1 : a > b ? 1 : 0); });
        keys.slice(max).forEach(function (k) { delete out[k]; });
      }
      return out;
    }
    function toMap(log) {
      var m = {};
      if (log && typeof log === 'object') Object.keys(log).forEach(function (k) { var e = log[k]; if (e && typeof e.to === 'string' && e.to && e.to !== k) m[k] = e.to; });
      return m;
    }
    return { record: record, toMap: toMap, KEY: 'cestisStudentIdMoves' };
  })();

  root.CESTISCore = Core;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
