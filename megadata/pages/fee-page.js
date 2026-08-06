/* MegaData — School-Fee bridge integration (stage 1; browser-only).
   Legacy-primary: the fee page's own CRUD keeps writing its keys exactly as
   today. In shadow mode this bridge turns those keys into REAL ledger events
   (charges, payments, supersessions, reversals) and exposes the shadow
   comparator: window.__feeReconcile() prints per-trainee drift, both sides
   recomputed from atoms (docs/04 §8). Stage 2 (recordPayment as a DAL
   command with a broker receipt number, balance rendered from the fold)
   follows once the shadow comparator has run clean. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot) return;
    var PAGE = 'School.Fee';
    var ALLOW = [
      'cestiSchoolFee', 'cestiFeeStructure', 'cestiUsers', 'cestis_active_quarter',
      'voctrain_students', 'voctrain_deletedStudentIds', 'voctrain_skillAreas', 'voctrain_deletedCentreIds',
      'cestis_pagecloud_stamps__', 'schoolDashboardGoogle', 'cestisGoogle', 'schoolFeeCloudFileId',
      'cestisLastSyncTime', 'cestisAutoSyncEnabled', 'schoolSettings', 'mainLinks', 'quickLinks', 'darkMode'
    ];
    var bridging = false;

    function readJson(key, dflt) {
      try { var v = JSON.parse(window.CESTISStore.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; }
    }
    function legacySnapshot() {
      return {
        students: readJson('cestiSchoolFeeStudents', []),
        payments: readJson('cestiSchoolFeePayments', []),
        deletedPaymentIds: readJson('cestiSchoolFeeDeletedPaymentIds', [])
      };
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'School Fee', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { bridge(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal;
      console.info('[MegaData] ' + PAGE + ' bridge active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      function bridge() {
        if (bridging) return; bridging = true;
        MG.feeBridgeAll(dal, legacySnapshot())
          .then(function (res) {
            bridging = false;
            if (res.skipped.length) console.warn('[MegaData] ' + res.skipped.length + ' fee record group(s) skipped (conflicting id-links) — bootstrap adjudication owns these:', res.skipped);
          })
          .catch(function (e) { bridging = false; console.warn('[MegaData] fee bridge error: ' + e.message); });
      }

      // The shadow comparator, on demand from the console or the admin view.
      window.__feeReconcile = function () {
        return MG.reconcileFees(dal, legacySnapshot()).then(function (rep) {
          console.info('[MegaData] fee reconciliation: ' + (rep.ok ? 'ZERO DRIFT' : rep.mismatches.length + ' mismatch(es)')
            + ' over ' + rep.compared + ' trainee(s); paid legacy=' + (rep.totalLegacyPaidMinor / 100).toFixed(2)
            + ' mega=' + (rep.totalMegaPaidMinor / 100).toFixed(2)
            + (rep.skipped.length ? '; skipped(conflicting links)=' + rep.skipped.length : ''));
          if (rep.mismatches.length && console.table) console.table(rep.mismatches);
          return rep;
        });
      };
      window.__feeBridge = bridge;

      bridge();
      window.addEventListener('storage', function (e) {
        if (e.key && (e.key.indexOf('cestiSchoolFee') === 0 || e.key === 'cestiFeeStructure')) bridge();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
