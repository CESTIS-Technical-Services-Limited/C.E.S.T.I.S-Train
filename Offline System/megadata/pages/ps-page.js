/* MegaData — Staff.Payslip integration (browser-only). The payroll store,
   dashboard users and permission requests sync through the generic docsync
   merge: local edits push as audited doc.upserted events, remote changes
   apply into STORAGE (this page holds its DATA in a closure with no
   reloader, so the on-screen copy catches up on the next page load — the
   wrap-after-save re-mirror means a stale in-memory save can never
   permanently clobber a mirrored record: the next tick puts it back).
   Wrap points: saveStore, saveUsers, savePermissions. UI untouched. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.PS_SPECS) return;
    var PAGE = 'Staff.Payslip';
    var ALLOW = [
      'cestisPayroll', 'cestisPayroll_backup', 'cestisDataHighWater', 'dashboardUsers', 'cestisPermissions',
      'schoolDashboardGoogle', 'cestisGoogle', 'cestis_pagecloud_stamps__', 'darkMode'
    ];

    function readJson(key, dflt) {
      try { var v = JSON.parse(window.CESTISStore.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; }
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Payslip', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__psTick) window.__psTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal, adapter = BOOT.adapter;
      console.info('[MegaData] ' + PAGE + ' docsync active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      var applying = false;
      var tick = Promise.resolve();

      function runTick() {
        tick = tick.then(function () {
          return adapter.get('meta', 'psBaseline').then(function (allBase) {
            allBase = allBase || {};
            var blob = readJson('cestisPayroll', {});
            var parts = MG.payrollDecompose(blob);
            if (parts.unkeyed.length) console.warn('[MegaData] ' + PAGE + ': ' + parts.unkeyed.length + ' record(s) without a join key stay local-only', parts.unkeyed);
            var blobChanged = false, sideChanged = {};
            return MG.PS_SPECS.reduce(function (pr, spec) {
              return pr.then(function () {
                var local = spec.collection ? parts[spec.collection] : readJson(spec.storageKey, []);
                return MG.docSyncPlan(dal, spec, local, allBase[spec.kind] || {}).then(function (plan) {
                  return MG.docSyncPush(dal, plan, PAGE).then(function () {
                    var res = MG.docSyncApply(spec, local, plan);
                    if (res.changed) {
                      if (spec.collection) { parts[spec.collection] = res.records; blobChanged = true; }
                      else sideChanged[spec.storageKey] = res.records;
                    }
                    if (plan.conflicts.length) console.warn('[MegaData] ' + PAGE + ' ' + spec.kind + ': ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
                    allBase[spec.kind] = plan.newBaseline;
                  });
                });
              });
            }, Promise.resolve()).then(function () {
              return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
            }).then(function () {
              applying = true;
              try {
                if (blobChanged) window.CESTISStore.setItem('cestisPayroll', JSON.stringify(MG.payrollRecompose(blob, parts)));
                Object.keys(sideChanged).forEach(function (k) { window.CESTISStore.setItem(k, JSON.stringify(sideChanged[k])); });
              } finally { applying = false; }
              if (blobChanged || Object.keys(sideChanged).length) console.info('[MegaData] ' + PAGE + ' mirror applied to storage (screen catches up on next load)');
              return adapter.put('meta', 'psBaseline', allBase);
            });
          }).catch(function (e) { console.warn('[MegaData] payslip tick: ' + e.message); });
        });
        return tick;
      }

      ['saveStore', 'saveUsers', 'savePermissions'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function () {
          var r = orig.apply(this, arguments);
          if (!applying) runTick();
          return r;
        };
      });

      window.__psTick = runTick;
      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key === 'cestisPayroll' || e.key === 'dashboardUsers' || e.key === 'cestisPermissions') runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
