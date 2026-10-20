/* MegaData — finance-document bridge model (invoice / quote / po; Tier A).
   One canonical findoc entity per legacy document (bootstrap key
   'fdc|<kind>|<rec.id>' — byte-pinned by test). Local saves become
   findoc.issued (legacy number PRESERVED — the pages mint their own numbers
   today; broker numbering takes over only at the enforced stage), edits
   become findoc.superseded with a field diff (canonical comparison, so the
   line-items ARRAY diffs correctly), deletions become findoc.voided —
   the legacy pages hard-delete with no tombstone list, so presence is
   reconciled three-way against a baseline exactly like docsync: gone
   locally since baseline → void; canonically voided → remove locally;
   new canonically → mirror in the full legacy record (the event carries the
   whole doc, so reconstruction is lossless).

   Duplicate numbers are a REAL legacy hazard (each device seeds its own
   series and deleting the last doc frees its number): findocReconcile
   reports every number used by more than one live document per kind —
   flagged for humans, never auto-renumbered. */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = Object.assign({}, require('../schemas.js'), require('./roster-model.js'));
    module.exports = factory(deps);
  } else {
    deps = root.MegaData;
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MG) {
  'use strict';

  function C(v) { return MG.canon(v === undefined ? null : v); }
  function fdEntityId(kind, recId) { return MG.bootstrapId('fdc', 'fdc|' + kind + '|' + recId); }

  /* Plan one page's collection. local = the legacy docs array; baseline =
     { entityId: docFieldsSnapshot } from the last tick. */
  function fdPlan(dal, kind, local, baseline) {
    baseline = baseline || {};
    var plan = { kind: kind, issues: [], supersedes: [], voids: [], applies: [], newLocal: [], removals: [], conflicts: [], newBaseline: {} };
    var seen = {};
    var localById = {};
    (local || []).forEach(function (r) { if (r && r.id != null) localById[String(r.id)] = r; });

    return (local || []).reduce(function (pr, rec) {
      return pr.then(function () {
        if (!rec || rec.id == null) return null;
        return fdEntityId(kind, rec.id).then(function (fid) {
          seen[fid] = 1;
          var ent = dal.get('findoc', fid);
          if (!ent) {
            plan.issues.push({ entityId: fid, doc: rec, localId: String(rec.id) });
            plan.newBaseline[fid] = Object.assign({}, rec);
            return null;
          }
          var remote = (ent.fields && ent.fields.doc) || {};
          if (ent.fields && ent.fields.status === 'voided') {
            // Canonically voided but still (or again) present locally: the
            // legacy page cannot revive a voided document — treat local copy
            // as stale and remove it (a re-add mints a NEW legacy id).
            plan.removals.push(String(rec.id));
            return null;
          }
          var base = baseline[fid] || null;
          var keys = {};
          [base || {}, rec, remote].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
          var push = {}, apply = {}, nb = {};
          Object.keys(keys).forEach(function (k) {
            var l = C(rec[k]), r = C(remote[k]);
            var b = base ? C(base[k]) : r;              // no baseline → remote is base
            var lc = l !== b, rc = r !== b;
            if (lc && rc && l !== r) { push[k] = rec[k]; plan.conflicts.push({ kind: kind, localId: String(rec.id), field: k, local: l, remote: r }); }
            else if (lc) push[k] = rec[k];
            else if (rc) apply[k] = remote[k];
            nb[k] = (k in push) ? rec[k] : (k in apply ? apply[k] : remote[k]);
          });
          if (Object.keys(push).length) plan.supersedes.push({ entityId: fid, current: remote, diff: push, localId: String(rec.id) });
          if (Object.keys(apply).length) plan.applies.push({ localId: String(rec.id), patch: apply });
          plan.newBaseline[fid] = nb;
          return null;
        });
      });
    }, Promise.resolve()).then(function () {
      // Presence, three-way: known to baseline, gone locally → void.
      var chain = Promise.resolve();
      Object.keys(baseline).forEach(function (fid) {
        if (seen[fid]) return;
        chain = chain.then(function () {
          var ent = dal.get('findoc', fid);
          if (!ent || !ent.alive) return;
          if (ent.fields.kind !== kind) return;
          if (ent.fields.status !== 'voided') plan.voids.push({ entityId: fid, reason: 'legacy deletion', localId: String((ent.fields.doc || {}).id || '') });
          plan.newBaseline[fid] = Object.assign({}, ent.fields.doc, { _voided: true });
        });
      });
      return chain;
    }).then(function () {
      // Canonical documents this device has never seen → mirror in.
      dal.find('findoc', function (e) { return e.alive && e.fields && e.fields.kind === kind; }).forEach(function (e) {
        if (seen[e.id] || baseline[e.id]) return;
        if (e.fields.status === 'voided') { plan.newBaseline[e.id] = Object.assign({}, e.fields.doc, { _voided: true }); return; }
        var doc = e.fields.doc || {};
        if (doc.id == null || localById[String(doc.id)]) return;
        plan.newLocal.push(Object.assign({}, doc));
        plan.newBaseline[e.id] = Object.assign({}, doc);
      });
      return plan;
    });
  }

  /* Emit a plan's events — all ids deterministic, races converge (P10). */
  function fdPush(dal, plan, page) {
    var prov = function (p) { return { importRun: 'bridge', srcFile: page || 'FinanceDoc', srcPath: String(p) }; };
    var chain = Promise.resolve();
    plan.issues.forEach(function (it) {
      chain = chain.then(function () {
        var payload = { kind: plan.kind, doc: it.doc };
        if (it.doc.number != null && String(it.doc.number) !== '') payload.number = String(it.doc.number);
        return MG.bridgeEventId('fdissue|' + it.entityId).then(function (evtId) {
          return dal._accept('findoc.issued', it.entityId, payload, { id: evtId, prov: prov(it.localId) })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
    plan.supersedes.forEach(function (s) {
      chain = chain.then(function () {
        return MG.bridgeEventId('fdsup|' + s.entityId + '|' + MG.canon(s.current) + '|' + MG.canon(s.diff)).then(function (evtId) {
          return dal._accept('findoc.superseded', s.entityId, { diff: s.diff, reason: 'legacy edit' }, { id: evtId, prov: prov(s.localId) })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
    plan.voids.forEach(function (v) {
      chain = chain.then(function () {
        return MG.bridgeEventId('fdvoid|' + v.entityId).then(function (evtId) {
          return dal._accept('findoc.voided', v.entityId, { reason: v.reason }, { id: evtId, prov: prov(v.localId) })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
    return chain;
  }

  /* Pure application to the legacy array. */
  function fdApply(local, plan) {
    var changed = false;
    var out = (local || []).map(function (r) { return Object.assign({}, r); });
    var byId = {};
    out.forEach(function (r, i) { if (r && r.id != null) byId[String(r.id)] = i; });
    plan.applies.forEach(function (a) {
      var i = byId[a.localId]; if (i === undefined) return;
      Object.keys(a.patch).forEach(function (k) { if (C(out[i][k]) !== C(a.patch[k])) { out[i][k] = a.patch[k]; changed = true; } });
    });
    plan.newLocal.forEach(function (r) {
      if (byId[String(r.id)] !== undefined) return;
      byId[String(r.id)] = out.length; out.push(r); changed = true;
    });
    if (plan.removals.length) {
      var rm = {};
      plan.removals.forEach(function (id) { rm[String(id)] = 1; });
      var before = out.length;
      out = out.filter(function (r) { return !r || !rm[String(r.id)]; });
      if (out.length !== before) changed = true;
    }
    return { records: out, changed: changed };
  }

  /* Duplicate-number report: every number carried by >1 LIVE document of a
     kind. Human review, never auto-renumbered. */
  function findocReconcile(dal, kinds) {
    var dupes = [];
    (kinds || ['invoice', 'quote', 'po', 'voucher']).forEach(function (kind) {
      var byNumber = {};
      dal.find('findoc', function (e) { return e.alive && e.fields && e.fields.kind === kind && e.fields.status !== 'voided'; })
        .forEach(function (e) {
          var n = e.fields.number || (e.fields.doc || {}).number;
          if (n == null || n === '') return;
          (byNumber[String(n)] = byNumber[String(n)] || []).push(e.id);
        });
      Object.keys(byNumber).forEach(function (n) {
        if (byNumber[n].length > 1) dupes.push({ kind: kind, number: n, entityIds: byNumber[n] });
      });
    });
    return { ok: dupes.length === 0, duplicates: dupes };
  }

  return { fdEntityId: fdEntityId, fdPlan: fdPlan, fdPush: fdPush, fdApply: fdApply, findocReconcile: findocReconcile };
});
