/* MegaData — LMS dashboard (index.html) bridge model. Turns the shared
   LMS_COLLECTIONS table (lms-collections.js — the same table the bootstrap
   extractor runs) into docsync specs plus per-mode storage converters:
     array  — records as-is, id via the table's own idOf
     objmap — { key → value } with the key riding as __k (voucher pattern);
              bootstrap-born docs (no __k) sync one-way until first touched
     msgmap — { roomId → [messages] } flattened; fields carry roomId + id,
              so reconstruction is FULL (regrouped by room on the way back)
     single — one settings object as a singleton record
   Records without a derivable id are returned in `unkeyed` — reported,
   kept local, never synced, never dropped (bootstrap quarantines the same
   records by the same rule). The roster, attendance and exam results are
   NOT here: the roster belongs to the Student-Progress merge (sp specs run
   on the dashboard too), exam results to the shared legacyExamResult spec,
   and attendance day-grids to their named deferred elevation. */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = Object.assign({}, require('../lms-collections.js'));
    module.exports = factory(deps);
  } else {
    deps = root.MegaData;
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MG) {
  'use strict';

  function strip(f) {
    var o = {};
    Object.keys(f || {}).forEach(function (k) { if (k !== '_removed' && k !== 'docKind') o[k] = f[k]; });
    return o;
  }

  /* One docsync spec per collection. storageKey = the voctrain_* name (the
     second entry in `names` — the live store key; the first is the backup
     bundle's name). */
  function lmsSpecs() {
    return MG.LMS_COLLECTIONS.map(function (c) {
      var storageKey = c.names[c.names.length - 1];
      if (c.mode === 'array') {
        return { collection: c, storageKey: storageKey, kind: c.kind, mode: 'array',
          bootKey: function (r) { return c.kind + '|' + c.idOf(r); },
          localId: function (f) { return String(c.idOf(f)); }, fromDoc: strip };
      }
      if (c.mode === 'objmap') {
        return { collection: c, storageKey: storageKey, kind: c.kind, mode: 'objmap',
          bootKey: function (r) { return c.kind + '|' + r.__k; },
          localId: function (f) { return f.__k == null ? '' : String(f.__k); }, fromDoc: strip };
      }
      if (c.mode === 'msgmap') {
        return { collection: c, storageKey: storageKey, kind: c.kind, mode: 'msgmap',
          bootKey: function (r) { return c.kind + '|' + r.id; },
          localId: function (f) { return String(f.id); }, fromDoc: strip };
      }
      return { collection: c, storageKey: storageKey, kind: c.kind, mode: 'single',
        bootKey: function () { return c.kind + '|singleton'; },
        localId: function () { return 'singleton'; }, fromDoc: strip };
    });
  }

  /* storage value → record list (+ unkeyed report). */
  function lmsDecompose(spec, value) {
    var records = [], unkeyed = [];
    if (spec.mode === 'array') {
      (Array.isArray(value) ? value : []).forEach(function (r) {
        if (r && spec.collection.idOf(r)) records.push(r); else unkeyed.push(r);
      });
    } else if (spec.mode === 'objmap') {
      Object.keys(value || {}).forEach(function (k) {
        var v = (value || {})[k];
        var rec = (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({}, v) : { value: v };
        rec.__k = k;
        records.push(rec);
      });
    } else if (spec.mode === 'msgmap') {
      Object.keys(value || {}).forEach(function (roomId) {
        (Array.isArray((value || {})[roomId]) ? value[roomId] : []).forEach(function (m) {
          if (m && m.id) records.push(Object.assign({ roomId: roomId }, m)); else unkeyed.push(m);
        });
      });
    } else if (value && typeof value === 'object') {
      records.push(value);
    }
    return { records: records, unkeyed: unkeyed };
  }

  /* record list (+ preserved unkeyed) → storage value. */
  function lmsRecompose(spec, records, unkeyed) {
    if (spec.mode === 'array') return (records || []).concat(unkeyed || []);
    if (spec.mode === 'objmap') {
      var map = {};
      (records || []).forEach(function (r) {
        if (!r || r.__k == null || r.__k === '') return;
        var v = Object.assign({}, r); delete v.__k;
        map[r.__k] = ('value' in v && Object.keys(v).length === 1) ? v.value : v;
      });
      return map;
    }
    if (spec.mode === 'msgmap') {
      var rooms = {};
      (records || []).concat(unkeyed || []).forEach(function (m) {
        if (!m) return;
        var room = m.roomId == null ? '' : String(m.roomId);
        var msg = Object.assign({}, m); delete msg.roomId;
        (rooms[room] = rooms[room] || []).push(msg);
      });
      return rooms;
    }
    return (records && records[0]) || {};
  }

  return { lmsSpecs: lmsSpecs, lmsDecompose: lmsDecompose, lmsRecompose: lmsRecompose };
});
