/* MegaData — Cert/Transcript-Requests page model (pilot page refactor).
   Pure mapping between the legacy request record
     { id:'CTR-…', studentId, studentName, course, type, status,
       requestedAt, note?, handledBy?, handledAt?, adminNote? }
   and the MegaData Tier-B document (doc.upserted, kind 'certTranscriptRequest').

   The document ENTITY id derives deterministically from the legacy CTR id, so
   the bootstrap import, the shadow bridge on any device, and any re-run all
   converge on ONE entity per request (P10) — duplicate upserts of the same
   values are harmless audit entries, never duplicate rows. */
(function (root, factory) {
  var MD = (typeof module !== 'undefined' && module.exports) ? require('../schemas.js') : root.MegaData;
  var api = factory(MD);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (MD) {
  'use strict';
  var KIND = 'certTranscriptRequest';
  var FIELDS = ['ctrId', 'studentId', 'studentName', 'course', 'type', 'status', 'requestedAt', 'note', 'handledBy', 'handledAt', 'adminNote'];

  function ctrEntityId(ctrId) {
    return MD.sha256Hex('ctr|' + String(ctrId)).then(function (h) { return 'doc_m' + h.slice(0, 20); });
  }

  // Full-field diff for the initial import of a legacy record.
  function ctrToDocDiff(r) {
    var diff = {};
    FIELDS.forEach(function (f) {
      var v = f === 'ctrId' ? r.id : r[f];
      if (v !== undefined && v !== null && v !== '') diff[f] = v;
    });
    return diff;
  }

  // Status-change diff (the page's only mutation).
  function ctrStatusDiff(status, actor, atIso) {
    return { status: status, handledBy: actor, handledAt: atIso };
  }

  // Legacy-shaped array from the DAL's entity fold (render + legacy mirror).
  function ctrFromDocs(docEntities) {
    var out = [];
    Object.keys(docEntities || {}).forEach(function (id) {
      var e = docEntities[id];
      if (!e.alive || !e.fields || e.fields.docKind !== KIND) return;
      var f = e.fields;
      var r = { id: f.ctrId, studentId: f.studentId, studentName: f.studentName, course: f.course, type: f.type, status: f.status, requestedAt: f.requestedAt };
      if (f.note) r.note = f.note;
      if (f.handledBy) { r.handledBy = f.handledBy; r.handledAt = f.handledAt; }
      if (f.adminNote) r.adminNote = f.adminNote;
      out.push(r);
    });
    out.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
    return out;
  }

  // Shadow bridge: which legacy records are not yet (or not identically)
  // represented as documents. Trainee pages still write ONLY the legacy key
  // until their own refactor; this keeps MegaData complete meanwhile.
  function ctrLegacyDelta(legacyArr, docEntities) {
    var current = {};
    ctrFromDocs(docEntities).forEach(function (r) { current[r.id] = r; });
    var missing = [], changed = [];
    (legacyArr || []).forEach(function (r) {
      if (!r || !r.id) return;
      var have = current[r.id];
      if (!have) { missing.push(r); return; }
      // Only trainee-side fields can change under legacy writers; the admin
      // fields are ours. A drifted status from a legacy tab is imported too.
      var drift = ['status', 'handledBy', 'handledAt', 'adminNote'].some(function (f) { return (r[f] || '') !== (have[f] || ''); });
      if (drift) changed.push(r);
    });
    return { missing: missing, changed: changed };
  }

  return { CTR_KIND: KIND, ctrEntityId: ctrEntityId, ctrToDocDiff: ctrToDocDiff, ctrStatusDiff: ctrStatusDiff, ctrFromDocs: ctrFromDocs, ctrLegacyDelta: ctrLegacyDelta };
});
