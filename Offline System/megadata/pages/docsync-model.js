/* MegaData — generic two-way sync for keyed Tier-B document collections
   (transcript grades, unit catalogues, transcript profiles, exam results —
   and any later page whose data is "a list/map of records with stable ids").

   Same three-way discipline as the roster merge (roster-model), generalised:
   per top-level field, against a baseline persisted in local meta —
   local-only changes push (doc.upserted with a state-hashed deterministic
   event id), remote-only changes apply, both-changed pushes local as LAST
   WRITER with the conflict reported. Comparison uses canonical
   serialisation, so nested objects (a profile blob) diff correctly.

   Deletion is a SOFT flag, not a doc.tombstone: legacy pages hard-delete
   records (clear a grade) and freely re-add them under the SAME
   deterministic id, so the canonical doc carries `_removed: true/false` —
   an upsert like any other, replayable, revivable, and invisible to
   bootstrap imports (which never set it). Presence reconciliation:
     - baseline had it, local lost it            → push _removed: true
     - doc says _removed, local still has it     → remove locally
     - doc alive (not _removed), local lacks it,
       baseline lacks it                          → new remotely → mirror in
     - local re-adds after removal               → push _removed: false + fields

   A spec describes one collection:
     { kind,                     doc kind (must equal bootstrap's TIERB kind)
       bootKey(raw) → string,    bootstrap detId key (byte-identical!)
       localId(docFields) → id,  how a canonical doc names its local record
       fromDoc(docFields) → raw  rebuild a local record for mirror-in } */
(function (root, factory) {
  var MD, RM;
  if (typeof module !== 'undefined' && module.exports) {
    MD = require('../schemas.js'); RM = require('./roster-model.js');
    module.exports = factory(MD, RM);
  } else {
    MD = root.MegaData; RM = root.MegaData;
    root.MegaData = Object.assign(root.MegaData || {}, factory(MD, RM));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MD, RM) {
  'use strict';

  function C(v) { return MD.canon(v === undefined ? null : v); }

  function fieldsOfDoc(doc) {
    var out = {};
    Object.keys((doc && doc.fields) || {}).forEach(function (k) { if (k !== 'docKind') out[k] = doc.fields[k]; });
    return out;
  }

  /* One collection's plan. local = array of records (each spec.localId-able).
     baseline = { docId: fieldsSnapshot } (this collection's slice). */
  function docSyncPlan(dal, spec, local, baseline) {
    baseline = baseline || {};
    var plan = { kind: spec.kind, pushes: [], applies: [], newLocal: [], removals: [], conflicts: [], newBaseline: {} };
    var localById = {};
    (local || []).forEach(function (r) { if (r) localById[String(spec.localId(r))] = r; });
    var seenDocIds = {};

    return (local || []).reduce(function (pr, raw) {
      return pr.then(function () {
        return RM.bootstrapId('doc', spec.bootKey(raw)).then(function (docId) {
          seenDocIds[docId] = 1;
          var doc = dal.get('doc', docId);
          var remote = doc ? fieldsOfDoc(doc) : null;
          var base = baseline[docId] || null;
          var localFields = {};
          Object.keys(raw).forEach(function (k) { if (raw[k] !== undefined && raw[k] !== null) localFields[k] = raw[k]; });
          if (!doc) {                                   // brand new locally → full push
            plan.pushes.push({ docId: docId, current: {}, diff: localFields, localId: String(spec.localId(raw)) });
            plan.newBaseline[docId] = localFields;
            return;
          }
          if (remote._removed && base && !base._removed) {
            // Removed remotely since our baseline → mirror the removal out.
            plan.removals.push(String(spec.localId(raw)));
            plan.newBaseline[docId] = remote;
            return;
          }
          if (remote._removed) {
            // Doc was removed, but the record is (re-)present locally with no
            // baseline knowledge of the removal → the page re-added it: revive.
            var revive = Object.assign({}, localFields, { _removed: false });
            plan.pushes.push({ docId: docId, current: remote, diff: revive, localId: String(spec.localId(raw)) });
            plan.newBaseline[docId] = Object.assign({}, remote, revive);
            return;
          }
          var keys = {};
          [base || {}, localFields, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { if (k !== '_removed') keys[k] = 1; }); });
          var push = {}, apply = {}, nb = {};
          Object.keys(keys).forEach(function (k) {
            var l = C(localFields[k]), r = C(remote[k]);
            var b = base ? C(base[k]) : r;              // no baseline → remote is base (legacy-primary first contact)
            var lc = l !== b, rc = r !== b;
            if (lc && rc && l !== r) { push[k] = localFields[k]; plan.conflicts.push({ kind: spec.kind, localId: String(spec.localId(raw)), field: k, local: l, remote: r }); }
            else if (lc) push[k] = localFields[k];
            else if (rc) apply[k] = remote[k];
            nb[k] = (k in push) ? localFields[k] : (k in apply ? apply[k] : remote[k]);
          });
          if (Object.keys(push).length) plan.pushes.push({ docId: docId, current: remote, diff: push, localId: String(spec.localId(raw)) });
          if (Object.keys(apply).length) plan.applies.push({ localId: String(spec.localId(raw)), patch: apply });
          plan.newBaseline[docId] = nb;
        });
      });
    }, Promise.resolve()).then(function () {
      // Records the baseline knows but local no longer has. Presence needs
      // the same three-way care as values: "gone locally since my baseline"
      // is a local deletion to push, but "my baseline already knew it was
      // removed and the doc has since revived" is a REMOTE revival to mirror
      // back in — pushing _removed there would destroy another device's
      // deliberate re-add.
      Object.keys(baseline).forEach(function (docId) {
        if (seenDocIds[docId]) return;
        var doc = dal.get('doc', docId);
        if (!doc || !(doc.fields && doc.fields.docKind === spec.kind)) return;
        var remote = fieldsOfDoc(doc);
        var baseRemoved = !!(baseline[docId] && baseline[docId]._removed);
        if (!remote._removed && !baseRemoved) {
          plan.pushes.push({ docId: docId, current: remote, diff: { _removed: true }, localId: String(spec.localId(remote)) });
          plan.newBaseline[docId] = Object.assign({}, remote, { _removed: true });
        } else if (!remote._removed && baseRemoved) {
          plan.newLocal.push(spec.fromDoc(remote));
          plan.newBaseline[docId] = remote;
        } else {
          plan.newBaseline[docId] = remote;              // removed on both sides: just track
        }
      });
      return null;
    }).then(function () {
      // Canonical docs of this kind that local has never seen → mirror in
      // (unless the doc itself says removed).
      dal.find('doc', function (d2) { return d2.alive && d2.fields && d2.fields.docKind === spec.kind; }).forEach(function (d2) {
        if (seenDocIds[d2.id] || baseline[d2.id]) return;
        var remote = fieldsOfDoc(d2);
        if (remote._removed) { plan.newBaseline[d2.id] = remote; return; }
        var lid = String(spec.localId(remote));
        if (localById[lid]) return;                      // same record under a different bootKey shape: leave it
        plan.newLocal.push(spec.fromDoc(remote));
        plan.newBaseline[d2.id] = remote;
      });
      return plan;
    });
  }

  /* Emit one plan's events. Event ids hash (doc id + current canonical state
     + the diff): retries and same-state races converge on one event; a later
     toggle back is a new state and lands as its own event. */
  function docSyncPush(dal, plan, page) {
    return plan.pushes.reduce(function (pr, p) {
      return pr.then(function () {
        return RM.bridgeEventId('doc2|' + p.docId + '|' + MD.canon(p.current) + '|' + MD.canon(p.diff)).then(function (evtId) {
          return dal._accept('doc.upserted', p.docId, { kind: plan.kind, diff: p.diff, reason: 'legacy sync' },
            { id: evtId, prov: { importRun: 'bridge', srcFile: page || 'docsync', srcPath: p.localId } })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    }, Promise.resolve());
  }

  /* Pure application to the local array. Returns fresh array + changed. */
  function docSyncApply(spec, local, plan) {
    var changed = false;
    var out = (local || []).slice();
    var byId = {};
    out.forEach(function (r, i) { if (r) byId[String(spec.localId(r))] = i; });
    plan.applies.forEach(function (a) {
      var i = byId[a.localId]; if (i === undefined) return;
      var r = Object.assign({}, out[i]);
      Object.keys(a.patch).forEach(function (k) { if (C(r[k]) !== C(a.patch[k])) { r[k] = a.patch[k]; changed = true; } });
      out[i] = r;
    });
    plan.newLocal.forEach(function (r) {
      var lid = String(spec.localId(r));
      if (byId[lid] === undefined) { byId[lid] = out.length; out.push(r); changed = true; }
    });
    if (plan.removals.length) {
      var rm = {};
      plan.removals.forEach(function (id) { rm[id] = 1; });
      var before = out.length;
      out = out.filter(function (r) { return !r || !rm[String(spec.localId(r))]; });
      if (out.length !== before) changed = true;
    }
    return { records: out, changed: changed };
  }

  return { docSyncPlan: docSyncPlan, docSyncPush: docSyncPush, docSyncApply: docSyncApply, _docFields: fieldsOfDoc };
});
