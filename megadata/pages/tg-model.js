/* MegaData — Transcript-Grades page model: the docsync specs for its four
   keyed collections, byte-pinned (by test) to bootstrap-core's TIERB table.
   Grades / catalogues / exam results are arrays of id-carrying records;
   profiles are an OBJECT MAP {studentId → profile} converted at this
   boundary. Exam results are included because this page writes them too
   (the manual-override write-back), so both pages' edits flow through one
   canonical doc per result. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function strip(f) {
    var o = {};
    Object.keys(f || {}).forEach(function (k) { if (k !== '_removed' && k !== 'docKind') o[k] = f[k]; });
    return o;
  }

  var TG_SPECS = [
    { storageKey: 'voctrain_transcriptGrades', kind: 'transcriptGrade',
      bootKey: function (r) { return 'tg|' + r.id; }, localId: function (f) { return f.id; }, fromDoc: strip },
    { storageKey: 'voctrain_unitCatalogs', kind: 'unitCatalog',
      bootKey: function (r) { return 'qual|' + r.id; }, localId: function (f) { return f.id; }, fromDoc: strip },
    { storageKey: 'voctrain_transcriptProfiles', kind: 'transcriptProfile', objmap: true,
      bootKey: function (r) { return 'tgprofile|' + r.studentId; }, localId: function (f) { return f.studentId; }, fromDoc: strip },
    { storageKey: 'voctrain_examResults', kind: 'legacyExamResult',
      bootKey: function (r) { return 'examres|' + r.id; }, localId: function (f) { return f.id; }, fromDoc: strip }
  ];

  /* {studentId → profile} ⇄ [{studentId, profile}] — the staged shape the
     bootstrap extractor uses for the same data. */
  function profilesToList(map) {
    return Object.keys(map || {}).map(function (sid) { return { studentId: sid, profile: (map || {})[sid] }; });
  }
  function listToProfiles(list) {
    var out = {};
    (list || []).forEach(function (r) { if (r && r.studentId) out[r.studentId] = r.profile; });
    return out;
  }

  return { TG_SPECS: TG_SPECS, profilesToList: profilesToList, listToProfiles: listToProfiles };
});
