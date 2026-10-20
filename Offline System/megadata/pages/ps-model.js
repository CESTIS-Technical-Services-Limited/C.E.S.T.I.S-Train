/* MegaData — staff-pages model: docsync specs for the Payslip and Clock-in
   pages, byte-pinned (by test) to the finance-staff extractor's tierbDoc
   keys. The payroll store is ONE key with nested collections
   ({settings, employees[], payrollRuns[]} + guard fields like high-water
   marks), so it decomposes/recomposes at this boundary — every field that
   is not one of the synced collections is preserved verbatim.

   Note the join keys are the BOOTSTRAP's: employees by NAME, payroll runs
   by DATE — a rename or re-dated run is a new doc plus a soft removal of
   the old, exactly what a fresh import would produce. The cashbook page
   also writes salary lines into cestisPayroll; those bridge on the payslip
   page's next tick (deterministic ids make the order irrelevant). */
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

  /* Staff.Payslip — three collections inside cestisPayroll, two beside it. */
  var PS_SPECS = [
    { collection: 'settings', kind: 'payrollSettings',
      bootKey: function () { return 'payrollSettings|singleton'; }, localId: function () { return 'singleton'; }, fromDoc: strip },
    { collection: 'employees', kind: 'employee',
      bootKey: function (r) { return 'employee|' + r.name; }, localId: function (f) { return String(f.name); }, fromDoc: strip },
    { collection: 'payrollRuns', kind: 'payrollRun',
      bootKey: function (r) { return 'payrollRun|' + r.date; }, localId: function (f) { return String(f.date); }, fromDoc: strip },
    { storageKey: 'dashboardUsers', kind: 'payslipUser',
      bootKey: function (r) { return 'payslipUser|' + (r.id || r.username); }, localId: function (f) { return String(f.id || f.username); }, fromDoc: strip },
    { storageKey: 'cestisPermissions', kind: 'permissionRequest',
      bootKey: function (r) { return 'permissionRequest|' + r.id; }, localId: function (f) { return String(f.id); }, fromDoc: strip }
  ];

  /* Staff.Clock.in — flat keyed stores. */
  var CLOCK_SPECS = [
    { storageKey: 'cestisStaffMembers', kind: 'staffMember',
      bootKey: function (r) { return 'staffMember|' + (r.id || r.username); }, localId: function (f) { return String(f.id || f.username); }, fromDoc: strip },
    { storageKey: 'cestisTimeRecords', kind: 'timeRecord',
      bootKey: function (r) { return 'timeRecord|' + (r.id || r.username); }, localId: function (f) { return String(f.id || f.username); }, fromDoc: strip }
  ];

  /* {settings, employees[], payrollRuns[], ...rest} → per-collection record
     arrays. The settings object rides as a single record. Records missing
     their join key are returned in `unkeyed` — reported, never synced,
     never dropped from the blob. */
  function payrollDecompose(blob) {
    blob = blob || {};
    var out = { settings: [], employees: [], payrollRuns: [], unkeyed: [] };
    if (blob.settings && typeof blob.settings === 'object') out.settings.push(blob.settings);
    (Array.isArray(blob.employees) ? blob.employees : []).forEach(function (e) {
      if (e && e.name) out.employees.push(e); else out.unkeyed.push({ collection: 'employees', rec: e });
    });
    (Array.isArray(blob.payrollRuns) ? blob.payrollRuns : []).forEach(function (r) {
      if (r && r.date) out.payrollRuns.push(r); else out.unkeyed.push({ collection: 'payrollRuns', rec: r });
    });
    return out;
  }

  /* Rebuild the blob: synced collections replaced, every OTHER field of the
     original (high-water marks, flags) preserved verbatim, and unkeyed
     records kept in place at the end of their collections. */
  function payrollRecompose(blob, parts) {
    var out = {};
    Object.keys(blob || {}).forEach(function (k) { out[k] = blob[k]; });
    out.settings = parts.settings.length ? parts.settings[0] : (blob && blob.settings) || {};
    out.employees = parts.employees.slice();
    out.payrollRuns = parts.payrollRuns.slice();
    (parts.unkeyed || []).forEach(function (u) {
      if (u.collection === 'employees') out.employees.push(u.rec);
      if (u.collection === 'payrollRuns') out.payrollRuns.push(u.rec);
    });
    return out;
  }

  return { PS_SPECS: PS_SPECS, CLOCK_SPECS: CLOCK_SPECS, payrollDecompose: payrollDecompose, payrollRecompose: payrollRecompose };
});
