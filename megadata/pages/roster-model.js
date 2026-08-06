/* MegaData — roster model shared by the Student-Progress bridge and (via a
   drift-guard test) the bootstrap pipeline.

   The id-derivation strings here MUST stay byte-identical to
   bootstrap-core.js (detId + its key formats): a live-bridged trainee and a
   bootstrap-imported one land on the SAME person/enrolment/roster entities.
   tests/megadata-sp.test.js asserts that equality — if either side drifts,
   the suite fails loudly instead of minting duplicate people. */
(function (root, factory) {
  var MD = (typeof module !== 'undefined' && module.exports) ? require('../schemas.js') : root.MegaData;
  var api = factory(MD);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (MD) {
  'use strict';

  function normProg(s) { return String(s || 'unassigned').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function bootstrapId(prefix, key) {
    return MD.sha256Hex('mega-bootstrap|' + key).then(function (h) { return prefix + '_m' + h.slice(0, 20); });
  }
  // Deterministic BRIDGE event ids: two devices bridging the same new trainee
  // build the same event id, so the broker's replay dedupe answers the loser
  // with the winner's ack instead of a duplicate-entity rejection (P10).
  function bridgeEventId(key) {
    return MD.sha256Hex('mega-bridge|' + key).then(function (h) { return 'evt_m' + h.slice(0, 24); });
  }

  // Identity ids for one (identity key, programme) pair — the same values the
  // bootstrap synthesis derives for group key gk.
  function identityIds(gk, progName) {
    var pk = normProg(progName);
    return Promise.all([
      bootstrapId('per', 'person|' + gk),
      bootstrapId('enr', 'enrolment|' + gk + '|' + pk),
      bootstrapId('prg', 'programme|' + pk),
      bootstrapId('int', 'intake|' + pk + '|legacy'),
      bootstrapId('doc', 'roster|' + gk + '|' + pk)
    ]).then(function (ids) {
      return { personId: ids[0], enrolmentId: ids[1], programmeId: ids[2], intakeId: ids[3], rosterDocId: ids[4], progNorm: pk };
    });
  }

  var ROSTER_FIELDS = ['stage', 'progress', 'score', 'gpa', 'attendance', 'assignments', 'assignmentsTotal',
    'certNo', 'certDate', 'certCollected', 'instructor', 'notes', 'nqfLevel'];

  function lmsRosterDiff(f) {
    var diff = {};
    ROSTER_FIELDS.forEach(function (k) {
      if (f[k] !== undefined && f[k] !== null && f[k] !== '') diff[k] = f[k];
    });
    diff.lmsId = f.id;
    return diff;
  }

  function lmsBio(f) {
    var bio = { names: { full: f.name || '(unnamed)' } };
    var dob = String(f.dateOfBirth || f.dob || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) bio.dob = dob;
    var nid = String(f.nationalId || f.trn || '');
    if (nid) bio.nationalId = nid;
    bio.contacts = { phone: f.contact || f.phone || '', email: f.email || '', address: f.address || '', city: f.city || '' };
    return bio;
  }

  // Does the stored roster document already reflect this legacy record?
  function rosterDrifted(legacyRec, docEntity) {
    if (!docEntity || !docEntity.fields) return true;
    var want = lmsRosterDiff(legacyRec), have = docEntity.fields;
    return ROSTER_FIELDS.concat(['lmsId']).some(function (k) {
      var w = want[k]; if (w === undefined) return false;
      return String(have[k] === undefined ? '' : have[k]) !== String(w);
    });
  }

  return { normProg: normProg, bootstrapId: bootstrapId, bridgeEventId: bridgeEventId, identityIds: identityIds, lmsRosterDiff: lmsRosterDiff, lmsBio: lmsBio, rosterDrifted: rosterDrifted, ROSTER_FIELDS: ROSTER_FIELDS };
});
