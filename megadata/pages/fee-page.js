/* MegaData — School-Fee bridge integration (stages 1 + 2; browser-only).
   Stage 1 (legacy-primary): the page's own CRUD keeps writing its keys; the
   bridge turns those keys into REAL ledger events (charges, payments,
   supersessions, reversals); window.__feeReconcile() is the docs/04 §8
   shadow comparator, both sides recomputed from atoms.
   Stage 2 (shadow mode): every payment action flows into the record book
   IMMEDIATELY — the page's recordPayment/savePaymentEdit/deletePayment are
   wrapped so the bridge + sync run right after the legacy write; the broker
   issues the receipt number, which is backfilled into the legacy record the
   page renders (a clerk-entered legacy number is never overwritten);
   payments pulled from other devices are mirrored INTO the legacy store
   with fold-derived totals so every unrefactored consumer sees them; and
   window.__feeBalance(studentId) answers from the fold, never a stored
   number. The legacy UI stays byte-identical — only the data flow is new. */
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
      onChange: function () { if (window.__feeShadowTick) window.__feeShadowTick(); else bridge(); }
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

      /* ---- stage 2: canonical → legacy (numbers back, other-device mirror) ---- */
      function applyMirrorAndBackfill() {
        var legacy = legacySnapshot();
        return MG.feeReceiptBackfill(dal, legacy).then(function (fills) {
          return MG.feeLegacyMirror(dal, legacy).then(function (mir) {
            if (!fills.length && !mir.payments.length && !mir.totals.length) return false;
            var pays = readJson('cestiSchoolFeePayments', []);
            var byId = {}; pays.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
            fills.forEach(function (f) { var p = byId[f.payId]; if (p && !p.receiptNumber) p.receiptNumber = f.receiptNo; });
            mir.payments.forEach(function (p) { if (!byId[p.id]) { pays.push(p); byId[p.id] = p; } });
            var studs = readJson('cestiSchoolFeeStudents', []);
            var sBy = {}; studs.forEach(function (s) { if (s && s.id) sBy[s.id] = s; });
            mir.totals.forEach(function (t) {
              var s = sBy[t.studentId]; if (!s) return;
              s.totalPaid = t.totalPaid; s.balance = t.balance;
              if (typeof window.feePaymentStatus === 'function') { try { s.status = window.feePaymentStatus(s); } catch (e) {} }
            });
            window.CESTISStore.setItem('cestiSchoolFeePayments', JSON.stringify(pays));
            window.CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify(studs));
            // The page's own loader + renderers, so its in-memory arrays follow.
            if (typeof window.loadData === 'function') { try { window.loadData(); } catch (e) {} }
            ['renderPaymentsTable', 'renderStudentsTable'].forEach(function (fn) {
              if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
            });
            console.info('[MegaData] stage 2 applied: ' + fills.length + ' receipt number(s) backfilled, '
              + mir.payments.length + ' payment(s) mirrored, ' + mir.totals.length + ' total(s) refreshed from the fold');
            return true;
          });
        });
      }

      // Serialised stage-2 tick: legacy write → events → broker numbers → back.
      var tick = Promise.resolve();
      function shadowTick() {
        tick = tick.then(function () {
          return MG.feeBridgeAll(dal, legacySnapshot())
            .then(function () { return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); }); })
            .then(function () { return applyMirrorAndBackfill(); })
            .catch(function (e) { console.warn('[MegaData] stage-2 tick: ' + e.message); });
        });
        return tick;
      }

      // Wrap the page's payment actions — the legacy function runs UNCHANGED
      // (all its validation, dialogs and rendering), then the tick makes the
      // record book primary for what it just did.
      ['recordPayment', 'savePaymentEdit', 'deletePayment'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function () {
          var r = orig.apply(this, arguments);
          shadowTick();
          return r;
        };
      });

      // Balance answered from the fold, never a stored number (stage-2 read path).
      window.__feeBalance = function (studentId) {
        return MG.feeBalancesFromFold(dal, legacySnapshot()).then(function (map) { return studentId ? map[studentId] || null : map; });
      };
      window.__feeShadowTick = shadowTick;

      bridge();
      shadowTick();
      window.addEventListener('storage', function (e) {
        if (e.key && (e.key.indexOf('cestiSchoolFee') === 0 || e.key === 'cestiFeeStructure')) bridge();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
