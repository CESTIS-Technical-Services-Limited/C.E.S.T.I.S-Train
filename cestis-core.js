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
    var cache = {};
    try { if (LS) { for (var i = 0; i < LS.length; i++) { var k = LS.key(i); cache[k] = LS.getItem(k); } } } catch (e) {}

    var db = null, ready = false, wq = [];
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
          cur.onerror = function () { ready = true; drainQueue(); };
        } catch (e) { ready = true; drainQueue(); }
      };
      req.onerror = function () { db = null; ready = true; };
    } catch (e) { db = null; ready = true; }

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
        if (LS) { try { var lv = LS.getItem(k); if (lv !== null) { cache[k] = lv; return lv; } } catch (e) {} }
        return (k in cache) ? cache[k] : null;
      },
      // `writes` counts every mutation made through this store. It lets the
      // periodic cloud save ask "has anything changed since my last upload?"
      // for the price of an integer compare, instead of re-serialising the
      // whole dataset every tick to find out the answer is no.
      writes: 0,
      setItem: function (k, v) { k = String(k); v = String(v); Store.writes++; cache[k] = v; try { if (LS) LS.setItem(k, v); } catch (e) {} writeIDB(k, v, false); },
      removeItem: function (k) { k = String(k); Store.writes++; delete cache[k]; try { if (LS) LS.removeItem(k); } catch (e) {} writeIDB(k, null, true); },
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
        if (ev.newValue === null) { delete cache[sk]; } else { cache[sk] = ev.newValue; }
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

  Core.naturalKey = function (student) {
    if (!student) return '';
    var n = Core.normName(student.name);
    var c = Core.normCourse(student.course);
    if (!n) return ''; // no usable identity — caller should keep the existing id
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
    var centre = null;
    var name = fee.skillArea || fee.course || '';
    if (name && typeof opts.findCentre === 'function') {
      try { centre = opts.findCentre(Array.isArray(centres) ? centres : [], name, { on: opts.on }); }
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
    'keepSeparate'];

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
    return base;
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

  /* --- One person, one record: collapse by NAME alone ---------------------

     The Centre's rule, set deliberately: if two trainee records carry the same
     exact name they are the same person, and one of them must go — whatever
     ids they were given and whatever programme each names.

     This is stronger than the centre-identity dedup below, which keeps two
     records when their programmes differ. That is what left "Omario Bryan"
     listed once under "Welding & Fabrication" and again under "WELDING L2"
     with a second machine-generated id: two spellings of one enrolment,
     correctly read as two enrolments, wrongly for this Centre's purposes.

     Which record survives is decided by evidence, not by array order
     (studentRecordScore): the one that has actually been used — progress
     recorded, a stage set, a certificate, an explicit link to a School Fee
     record or a login — wins, and every field the loser held that the winner
     lacks is carried across. So the surviving record is never poorer than
     either of the two.

     Returns { students, removed, idMap }; idMap maps every discarded id to the
     survivor so attendance, payments, exam results and accounts follow it.

     NOTE the deliberate consequence: two DIFFERENT people who genuinely share
     a name become one record. That is the instruction — the Centre knows its
     roll — but it is why this collapses only on an exact name match, after
     normalising case and spacing, and never on a partial or fuzzy one.

     And it is why `keepSeparate` exists. An administrator who has two real
     trainees of one name marks the records: a record carrying keepSeparate is
     exempt — it never absorbs another and is never absorbed, here or in the
     centre-identity dedup. Mark ONE of the two and they stay two records;
     unmarked namesakes still collapse among themselves as usual. The marker
     travels with the record through every merge and sync (MERGE_FIELDS above),
     because a marker that could be lost would protect nothing. */

  // True when an administrator has pinned this record as its own person.
  Core.isKeptSeparate = function (s) {
    return !!(s && (s.keepSeparate === true || s.keepSeparate === 'true'));
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
    var slots = {};        // normalised name -> { rec }
    var order = [];        // names in first-encounter order

    // Merge `loser` into `winner`, keeping the winner's identity but never
    // losing a value only the loser held.
    function absorb(winner, loser) {
      // Read both programmes BEFORE the backfill below: that loop copies the
      // loser's centreKey onto a winner that has none, which would make the
      // winner look keyed and hide the fact that its programme name is the
      // vaguer of the two.
      var wi = null, li = null;
      try {
        wi = Core.programmeIdentity(winner, courseField);
        li = Core.programmeIdentity(loser, courseField);
      } catch (e) {}
      Object.keys(loser).forEach(function (k) {
        var have = winner[k];
        if (have === undefined || have === null || have === '') {
          var v = loser[k];
          if (v !== undefined && v !== null && v !== '') winner[k] = v;
        }
      });
      // Numeric progress: keep the higher of the two, since 0 is a real value
      // that the blank-backfill above would have kept.
      var wp = parseFloat(winner.progress) || 0, lp = parseFloat(loser.progress) || 0;
      if (lp > wp) winner.progress = loser.progress;
      var wa = parseFloat(winner.attendance) || 0, la = parseFloat(loser.attendance) || 0;
      if (la > wa) winner.attendance = loser.attendance;
      // The programme: prefer whichever spelling states an intake key, so the
      // survivor keeps the more specific of "WELDING L2" / "02. Welding …".
      if (wi && li && !wi.key && li.key && loser[courseField]) {
        winner[courseField] = loser[courseField];
      }
      return winner;
    }

    list.forEach(function (s) {
      if (!s) return;
      if (Core.isKeptSeparate(s)) return;              // the admin pinned this one
      var n = Core.normName(s.name);
      if (!n) return;                                  // nameless records are left alone
      var slot = slots[n];
      if (!slot) { slots[n] = { rec: s }; order.push(n); return; }
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

    // Rebuild in first-encounter order, one record per name, passing through
    // anything with no usable name exactly as it was.
    var emitted = {}, out = [];
    list.forEach(function (s) {
      if (!s) { out.push(s); return; }
      if (Core.isKeptSeparate(s)) { out.push(s); return; }   // stands on its own
      var n = Core.normName(s.name);
      if (!n) { out.push(s); return; }
      if (emitted[n]) return;
      emitted[n] = true;
      out.push(slots[n].rec);
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
      // every dedup, this one included.
      if (Core.isKeptSeparate(s)) return null;
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
     certDownloadApprovals, examResults. Every reference to a remapped student
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
        return bestAcct[u.studentDataId] === u;    // keep only the winner for each student
      });
    }

    if (Array.isArray(data.attendanceRecords)) {
      data.attendanceRecords.forEach(function (r) {
        if (r && r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
      });
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

    if (Array.isArray(data.transcriptGrades)) {
      data.transcriptGrades.forEach(function (g) {
        if (g && g.studentId && idMap[g.studentId]) g.studentId = idMap[g.studentId];
      });
    }

    if (Array.isArray(data.certTranscriptRequests)) {
      data.certTranscriptRequests.forEach(function (r) {
        if (r && r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
      });
    }

    return data;
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
  Core.recordDeletedStudent = function (id, store) {
    if (!id) return;
    store = _store(store);
    try {
      var existing = Core.readDeletedIds(store);
      existing[id] = true;
      if (store) store.setItem(Core.TOMBSTONE_KEY, JSON.stringify(Object.keys(existing)));
    } catch (e) {}
  };

  // Drop any student that has been tombstoned (deleted), matching on BOTH the
  // record's current id and its deterministic stable id. This is the single
  // chokepoint that prevents a deleted student from re-emerging no matter which
  // path re-added them (cloud merge under a legacy/fee id, account reconcile,
  // recovery, etc.) — because even a copy carrying a different id resolves to
  // the same tombstoned stable id. Returns the kept list + the dropped ids so
  // callers can purge dependent records.
  Core.dropTombstonedStudents = function (students, deletedMap) {
    deletedMap = deletedMap || {};
    var dropped = {};
    var kept = (students || []).filter(function (s) {
      if (!s) return false;
      var sid = Core.stableStudentId(s);
      if (deletedMap[s.id] === true || (sid && deletedMap[sid] === true)) {
        if (s.id != null) dropped[s.id] = true;
        return false;
      }
      return true;
    });
    return { students: kept, droppedIds: Object.keys(dropped), removed: (students ? students.length : 0) - kept.length };
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
  Core.TOMBSTONE_UNION_KEYS = ['voctrain_deletedStudentIds', 'cestiSchoolFeeDeletedLmsIds'];

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
    return true;
  };

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
      var snapIds = Core._parseArr(snapStore[tk]);
      if (!snapIds.length) return;
      var set = {}; Core._parseArr(localStoreMap[tk]).forEach(function (id) { if (id) set[id] = true; });
      var addedAny = false;
      snapIds.forEach(function (id) { if (id && !set[id]) { set[id] = true; addedAny = true; } });
      if (addedAny) { out[tk] = JSON.stringify(Object.keys(set)); result.changed = true; if (result.restoredKeys.indexOf(tk) === -1) result.restoredKeys.push(tk); }
    });
    var deletedStudents = {};
    Core._parseArr(localStoreMap['voctrain_deletedStudentIds']).forEach(function (id) { if (id) deletedStudents[id] = true; });
    Core._parseArr(snapStore['voctrain_deletedStudentIds']).forEach(function (id) { if (id) deletedStudents[id] = true; });

    // 2) id-keyed array collections: union (add-missing), keep local on id clash.
    var studentIdMap = {};   // oldStudentId -> keptStudentId, from the dedupe below
    Core.SNAPSHOT_COUNT_KEYS.forEach(function (key) {
      var isStudents = (key === 'voctrain_students');
      var snapArr = Core._parseArr(snapStore[key]);
      var locArr = Core._parseArr(localStoreMap[key]);
      var byId = {}; var order = [];
      locArr.forEach(function (r) { if (r && r.id != null) { byId[r.id] = r; order.push(r.id); } });
      var added = 0;
      snapArr.forEach(function (r) {
        if (!r || r.id == null) return;
        if (isStudents && deletedStudents[r.id]) return; // honor tombstone on add
        if (!(r.id in byId)) { byId[r.id] = r; order.push(r.id); added++; }
      });
      var merged = order.map(function (id) { return byId[id]; });
      var changedHere = (added > 0);
      if (isStudents) {
        // Drop any student (local OR added) that is now tombstoned, then dedupe.
        var dropRes = Core.dropTombstonedStudents(merged, deletedStudents);
        if (dropRes.removed > 0) { merged = dropRes.students; result.droppedTombstoned += dropRes.removed; changedHere = true; }
        var dr = Core.dedupeStudents(merged);
        if (dr.removed > 0) changedHere = true;
        merged = dr.students;
        // Capture which student ids were collapsed so we can re-point the accounts
        // and cert approvals that reference them (below). Losing this map is what
        // left some users unable to log in / download after a sync — their account
        // still pointed at a student id the dedupe had just removed.
        if (dr.idMap) { for (var _im in dr.idMap) { if (Object.prototype.hasOwnProperty.call(dr.idMap, _im)) studentIdMap[_im] = dr.idMap[_im]; } }
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

    // 3) Any other snapshot key absent or empty locally: restore (fill-only),
    //    excluding the count keys and tombstone keys already handled above.
    Object.keys(snapStore).forEach(function (key) {
      if (Core.SNAPSHOT_COUNT_KEYS.indexOf(key) !== -1) return;
      if (Core.TOMBSTONE_UNION_KEYS.indexOf(key) !== -1) return;
      var local = localStoreMap[key];
      var localEmpty = (local == null || local === '' || local === '[]' || local === '{}');
      if (localEmpty && snapStore[key] != null && snapStore[key] !== '') {
        out[key] = snapStore[key];
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
          reason: 'A room of ' + n + ' runs peer-to-peer with no server.' };
      }
      if (n <= SFU_MAX) {
        return { mode: 'sfu', limit: SFU_MAX, feasible: true,
          reason: 'A room of ' + n + ' is beyond what a peer-to-peer mesh can carry (' +
                  meshCap + ' max), so it runs on a hosted conference server.' };
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

    return {
      MESH_MAX_VIDEO: MESH_MAX_VIDEO, MESH_MAX_AUDIO: MESH_MAX_AUDIO, SFU_MAX: SFU_MAX,
      meshConnections: meshConnections,
      meshStreamsPerParticipant: meshStreamsPerParticipant,
      meshUplinkKbps: meshUplinkKbps,
      meshLimit: meshLimit,
      recommend: recommend,
      canJoinMesh: canJoinMesh
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

    /* Open a session record for a Large Class. */
    function startSession(opts) {
      opts = opts || {};
      return {
        id: opts.id || ('vcs-' + String(opts.code || '') + '-' + iso(opts.startedAt)),
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
      startSession: startSession,
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

  /* Merge a whole systemSettings object from the cloud into the local one.
     Scalars: the cloud copy wins (that is the established behaviour for
     settings). extSystems: merged entry by entry so a headline is never lost. */
  Core.mergeSystemSettings = function (local, remote) {
    var L = (local && typeof local === 'object') ? local : {};
    var R = (remote && typeof remote === 'object') ? remote : {};
    var out = {};
    Object.keys(L).forEach(function (k) { out[k] = L[k]; });
    Object.keys(R).forEach(function (k) {
      if (k === 'extSystems') return; // handled below
      out[k] = R[k];
    });
    if (L.extSystems || R.extSystems) {
      out.extSystems = Core.mergeExtSystems(L.extSystems, R.extSystems);
    }
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
       how many were stamped. */
    function assignCentreKeys(areas) {
      if (!Array.isArray(areas)) return 0;
      var taken = {}, n = 0, i;
      for (i = 0; i < areas.length; i++) {
        if (!areas[i]) continue;
        var k = areas[i].centreKey != null ? padKey(areas[i].centreKey) : '';
        if (k) taken[k] = true;
      }
      var next = 1;
      var free = function () {
        while (taken[padKey(next)]) next++;
        var k = padKey(next);
        taken[k] = true;
        return k;
      };
      for (i = 0; i < areas.length; i++) {
        var a = areas[i];
        if (!a || (a.centreKey != null && String(a.centreKey).trim() !== '')) continue;
        // The id is the centre's identity already, so it gives a key that is
        // unique and the same on every device — but never one already taken.
        var fromId = a.id != null ? numericKey(a.id) : '';
        a.centreKey = (fromId && !taken[fromId]) ? (taken[fromId] = true, fromId) : free();
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

       opts: { today, nowMs, on, centreKey } — all optional. 'on' is a date the
       answer should belong to; without it the answer is about now. */
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
      if (hit) return hit;

      for (i = 0; i < areas.length; i++) {
        n = norm(areas[i] && parseCentreLabel(areas[i].name).name);
        if (!n) continue;
        if (n.indexOf(cn) === 0 || cn.indexOf(n) === 0) hit = preferCentre(hit, areas[i], opts);
      }
      if (hit) return hit;

      var qT = tokenise(cn), qL = levelOfTokens(qT), qW = keyWords(qT);
      if (!qW.length) return null;
      var best = null, bestScore = 0;
      for (i = 0; i < areas.length; i++) {
        var area = areas[i];
        if (!area || !area.name) continue;
        var aT = tokenise(parseCentreLabel(area.name).name), aL = levelOfTokens(aT), aW = keyWords(aT);
        if (!aW.length) continue;
        if (qL && aL && qL !== aL) continue;      // Level 2 is not Level 3
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
      centreLabel: centreLabel,
      parseCentreLabel: parseCentreLabel,
      assignCentreKeys: assignCentreKeys,
      fiscalYearOf: fiscalYearOf,
      centreFiscalYear: centreFiscalYear,
      canEnrol: canEnrol,
      enrolmentStamp: enrolmentStamp,
      studentInFiscalYear: studentInFiscalYear,
      openCentres: openCentres
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

    return {
      DELETED_KEY: DELETED_KEY,
      deletedIds: deletedIds,
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
    var i;
    if (idx) {
      var hit = idx.find(student);
      if (hit) return { action: 'link', match: hit, reason: 'twin' };
      var named = idx.findByName(student.name);
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
      if (list[i] && Core.normName(list[i].name) === want) {
        return { action: 'link', match: list[i], reason: 'same-person-other-programme' };
      }
    }
    return { action: 'create', match: null, reason: 'ok' };
  };

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

    function add(record) {
      if (!record) return;
      if (list[list.length - 1] !== record) list.push(record);
      index(record, list.length - 1);
    }

    return { find: find, findByName: findByName, add: add, get size() { return list.length; } };
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
      var key = E.centreKeyOf(centre);

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
      if (!found || E.centreKeyOf(found) !== key) return false;
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
          key = c ? E.centreKeyOf(c) : null;
        } else {
          var field = opts.field || 'course';
          var written = nameOf(rec, field) || nameOf(rec, 'course') || nameOf(rec, 'skillArea');
          if (written) {
            var on = rec.enrolmentDate || rec.enrollmentDate || rec.enrollDate || rec.createdAt || '';
            var found = resolveByName(written, on);
            // A trainee who enrolled before this intake began is an earlier
            // intake's, not this one's — see enrolledBeforeIntake above.
            key = (found && !enrolledBeforeIntake(rec, found)) ? E.centreKeyOf(found) : null;
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
        of: function (centre) { return (centre && out[E.centreKeyOf(centre)]) || 0; },
        listOf: function (centre) { return (centre && groups[E.centreKeyOf(centre)]) || []; }
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
      if (E.centreKeyOf(from) === E.centreKeyOf(to)) return out;   // nowhere to go
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
       An exam counts towards a unit when its title carries the unit code, or
       its title is (or contains / is contained by) the unit name. Length
       guards stop trivially-short names from matching everything. */
    T.examMatchesUnit = function (exam, unit) {
      if (!exam || !unit) return false;
      var title = T.normText(exam.title);
      if (!title) return false;
      var code = T.normText(unit.code);
      if (code && title.indexOf(code) !== -1) return true;
      var name = T.normText(unit.name);
      if (!name) return false;
      if (title === name) return true;
      if (name.length >= 12 && title.indexOf(name) !== -1) return true;
      if (title.length >= 12 && name.indexOf(title) !== -1) return true;
      return false;
    };

    // Latest submitted exam result for one student+unit. exams/examResults are
    // the app's canonical arrays. Returns null when the unit has no live score.
    T.latestExamResultForUnit = function (unit, studentId, exams, examResults) {
      if (!unit || !studentId) return null;
      var examsById = {};
      (exams || []).forEach(function (e) { if (e && e.id) examsById[e.id] = e; });
      var best = null, bestTime = -1;
      (examResults || []).forEach(function (r) {
        if (!r || r.studentId !== studentId) return;
        var exam = examsById[r.examId];
        if (!exam || !T.examMatchesUnit(exam, unit)) return;
        var t = r.submittedAt ? new Date(r.submittedAt).getTime() : 0;
        if (isNaN(t)) t = 0;
        if (t >= bestTime) { bestTime = t; best = r; }
      });
      return best;
    };

    /* --- THE RESOLUTION ALGORITHM -------------------------------------------
       One row per catalogue unit: manual grade wins, else latest live exam
       score, else ungraded. Every page renders from this so admin, trainee
       and instructor always see the same grades. */
    T.effectiveGrades = function (opts) {
      opts = opts || {};
      var qual = opts.qual, studentId = opts.studentId;
      if (!qual || !Array.isArray(qual.units)) return [];
      var manual = {};
      (opts.manualGrades || []).forEach(function (g) {
        if (g && g.studentId === studentId && g.qualId === qual.id && g.unitCode) {
          manual[g.unitCode] = g;
        }
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
        var res = T.latestExamResultForUnit(u, studentId, opts.exams, opts.examResults);
        if (res) {
          row.grade = res.score;
          row.date = T.formatDateDMY(res.submittedAt);
          row.source = 'exam';
          row.examResultId = res.id;
          var exam = (opts.exams || []).filter(function (e) { return e && e.id === res.examId; })[0];
          row.examTitle = exam ? exam.title : '';
        }
        return row;
      });
    };

    T.gradeStats = function (rows) {
      var graded = (rows || []).filter(function (r) { return r && r.grade != null && r.grade !== ''; });
      var sum = 0;
      graded.forEach(function (r) { var n = Number(r.grade); if (!isNaN(n)) sum += n; });
      return {
        total: (rows || []).length,
        graded: graded.length,
        average: graded.length ? Math.round((sum / graded.length) * 10) / 10 : null
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
      if (idx === -1) list.push(stored); else list[idx] = stored;
      return list;
    };

    T.removeManualGrade = function (grades, studentId, qualId, unitCode) {
      var id = T.manualGradeId(studentId, qualId, unitCode);
      return (Array.isArray(grades) ? grades : []).filter(function (g) { return !g || g.id !== id; });
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
        handledBy: '', handledAt: '', adminNote: ''
      };
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

    return {
      idMatches: idMatches, hasPassword: hasPassword, check: check,
      find: find, findAnyRole: findAnyRole, adminLabel: adminLabel,
      usableAdmins: usableAdmins, wouldStrandAdmins: wouldStrandAdmins,
      needsRecoveryAdmin: needsRecoveryAdmin
    };
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
        if (Array.isArray(sa.instructorPermissions) && sa.instructorPermissions.length) {
          if (!Array.isArray(local.instructorPermissions)) local.instructorPermissions = [];
          sa.instructorPermissions.forEach(function (p) {
            if (!p) return;
            var known = local.instructorPermissions.some(function (lp) {
              return lp && lp.instructor === p.instructor && lp.expiresAtMs === p.expiresAtMs;
            });
            if (!known) { local.instructorPermissions.push(p); out.updated++; }
          });
        }
      });
      return out;
    }

    return { bestApproval: bestApproval, applyStudent: applyStudent,
      applyApproval: applyApproval, applySkillAreas: applySkillAreas };
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
      if (wouldDiscardRecords(current, next)) {
        if (typeof onRefuse === 'function') { try { onRefuse(key, current); } catch (e) {} }
        return false;
      }
      try { store.setItem(key, next); } catch (e) { return false; }
      return true;
    }

    /* Merge a cloud backup into this device's copy.
         localData/cloudData   - { storageKey: rawStringValue }
         localStamps/cloudStamps - { storageKey: ISO time last written }
       Returns the union plus the keys whose local value must be rewritten. */
    function mergeKeys(localData, localStamps, cloudData, cloudStamps, opts) {
      localData = localData || {}; cloudData = cloudData || {};
      opts = opts || {};
      var data = {}, stamps = {}, changed = [], rescued = [], k;

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
        if (localData[k] === cloudData[k]) continue;      // identical, nothing to do

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
               'voctrain_deletedCentreIds']
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
      }
    ];

    function sharedSources() { return SHARED_SOURCES; }

    /* Is this key one several pages depend on? */
    function isShared(key) {
      for (var i = 0; i < SHARED_SOURCES.length; i++) {
        if (SHARED_SOURCES[i].keys.indexOf(key) !== -1) return true;
      }
      return false;
    }

    /* The file that carries a shared key, or null if nothing claims it. */
    function sourceOf(key) {
      for (var i = 0; i < SHARED_SOURCES.length; i++) {
        if (SHARED_SOURCES[i].keys.indexOf(key) !== -1) return SHARED_SOURCES[i];
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
             guardedSet: guardedSet };
  })();

  root.CESTISCore = Core;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
