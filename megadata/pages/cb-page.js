/* MegaData — Cashbook integration (browser-only; D11: its own book).
   In shadow mode every quarter blob save flows into the record book —
   entries as immutable events, edits as void+replacement, deletions and
   cheque voids as voids with reasons — and entries pulled from other
   devices mirror INTO the quarter blobs (ids remapped on collision, joins
   held stable by megaId stamps). window.__cbReconcile() compares every
   stored quarter against the fold to the cent. The legacy UI is untouched:
   saveToStorage / saveTxnToQuarter / saveQuarterAndSwitch are wrapped,
   nothing else. Budgets stay legacy for now (budget.set is create-once in
   the registry; live re-sets are a deliberate, documented registry change). */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.cbPlanQuarter) return;
    var PAGE = 'CESTIS.Cashbook';
    var ALLOW = [
      'cestis_quarter_', 'cestis_budget_', 'cesti_cashbook_data', 'cestis_active_quarter',
      'cestis_recon_', 'cestisPayroll', 'cestis_fin_logo', 'cestis_recon_logo',
      'cestisStaffMembers', 'cestisTimeRecords', 'cestis_pagecloud_stamps__', 'schoolDashboardGoogle', 'darkMode'
    ];

    function quarterBlobs() {
      var out = [];
      var keys = (window.CESTISStore.keys ? window.CESTISStore.keys() : []);
      keys.forEach(function (k) {
        var pq = MG.parseQuarterKey(k);
        if (!pq) return;
        try {
          var blob = JSON.parse(window.CESTISStore.getItem(k) || 'null');
          if (blob && typeof blob === 'object') out.push({ fy: pq.fy, q: pq.q, key: k, blob: blob });
        } catch (e) { /* unreadable blob: the bootstrap quarantine owns these */ }
      });
      return out;
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Cashbook', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__cbTick) window.__cbTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal;
      console.info('[MegaData] ' + PAGE + ' bridge active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      var applying = false;
      var tick = Promise.resolve();

      function runTick() {
        tick = tick.then(function () {
          var specs = quarterBlobs();
          return specs.reduce(function (pr, spec) {
            return pr.then(function () {
              return MG.cbPlanQuarter(dal, spec.fy, spec.q, spec.blob).then(function (plan) {
                if (plan.skipped.length) console.warn('[MegaData] cashbook ' + spec.fy + ' Q' + spec.q + ': ' + plan.skipped.length + ' txn(s) not bridgeable', plan.skipped);
                return MG.cbPushPlan(dal, plan, PAGE).then(function () {
                  // megaId stamps from the plan land with the mirror below.
                  return null;
                });
              });
            });
          }, Promise.resolve()).then(function () {
            return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
          }).then(function () {
            var changedAny = false;
            return specs.reduce(function (pr, spec) {
              return pr.then(function () {
                return MG.cbMirrorQuarter(dal, spec.fy, spec.q, spec.blob).then(function (mirror) {
                  var res = MG.cbApplyMirror(spec.blob, mirror);
                  if (res.changed) {
                    window.CESTISStore.setItem(spec.key, JSON.stringify(res.blob));
                    changedAny = true;
                  }
                });
              });
            }, Promise.resolve()).then(function () {
              if (changedAny) {
                applying = true;
                try {
                  if (typeof window.loadQuarterData === 'function') { try { window.loadQuarterData(); } catch (e) {} }
                  if (typeof window.refreshAll === 'function') { try { window.refreshAll(); } catch (e) {} }
                } finally { applying = false; }
                console.info('[MegaData] cashbook mirror applied');
              }
            });
          }).catch(function (e) { console.warn('[MegaData] cashbook tick: ' + e.message); });
        });
        return tick;
      }

      ['saveToStorage', 'saveTxnToQuarter', 'saveQuarterAndSwitch'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function () {
          var r = orig.apply(this, arguments);
          if (!applying) runTick();
          return r;
        };
      });

      window.__cbTick = runTick;
      window.__cbReconcile = function () {
        var rep = MG.cbReconcile(dal, quarterBlobs());
        console.info('[MegaData] cashbook reconciliation: ' + (rep.ok ? 'ZERO DRIFT' : 'MISMATCH') + ' over ' + rep.quarters.length + ' quarter(s)');
        rep.quarters.forEach(function (r) {
          if (!r.ok) console.warn('  ' + r.fy + ' Q' + r.q + ': legacy income ' + (r.legacyIncomeMinor / 100).toFixed(2) + ' vs mega ' + (r.megaIncomeMinor / 100).toFixed(2)
            + '; expense ' + (r.legacyExpenseMinor / 100).toFixed(2) + ' vs ' + (r.megaExpenseMinor / 100).toFixed(2)
            + '; opening ' + (r.legacyOpeningMinor / 100).toFixed(2) + ' vs ' + (r.megaOpeningMinor / 100).toFixed(2));
        });
        return rep;
      };

      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key && MG.parseQuarterKey(e.key)) runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
