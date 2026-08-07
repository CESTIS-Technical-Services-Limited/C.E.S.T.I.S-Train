/* MegaData — LMS dashboard (index.html) integration (browser-only). The
   last unbridged page. Every collection in the shared LMS_COLLECTIONS table
   syncs through the generic docsync merge (specs from lms-model), and the
   roster runs the SAME Student-Progress three-way merge the SP page uses —
   same functions, same 'spBaseline' meta key, so whichever surface is open,
   the merge converges on identical deterministic events. One wrap point:
   the dashboard's own saveState (121 call sites funnel through it). Mirror
   applies land in storage, then loadState() (the page's own loader) brings
   the in-memory copies and badges up to date. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.lmsSpecs || !MG.spMergePlan) return;
    var PAGE = 'index';
    // The dashboard touches everything; broad legacy prefixes are honest here.
    var ALLOW = ['voctrain_', 'cesti', 'schoolDashboard', 'darkMode', 'mainLinks', 'quickLinks', 'schoolSettings', 'dashboardUsers'];

    function readVal(key, dflt) {
      try { var v = JSON.parse(window.CESTISStore.getItem(key) || 'null'); return v == null ? dflt : v; } catch (e) { return dflt; }
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'LMS Dashboard', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__lmsTick) window.__lmsTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal, adapter = BOOT.adapter;
      var SPECS = MG.lmsSpecs();
      console.info('[MegaData] ' + PAGE + ' bridge active (' + BOOT.mode + '), ' + SPECS.length + ' collections, head seq ' + dal.head().seq);

      var applying = false;
      var tick = Promise.resolve();

      function collectionsPass(allBase) {
        var changedKeys = [];
        return SPECS.reduce(function (pr, spec) {
          return pr.then(function () {
            var parts = MG.lmsDecompose(spec, readVal(spec.storageKey, spec.mode === 'array' ? [] : {}));
            var local = spec.mode === 'objmap' ? parts.records.filter(function (r) { return r.__k; }) : parts.records;
            return MG.docSyncPlan(dal, spec, local, allBase[spec.kind] || {}).then(function (plan) {
              if (spec.mode === 'objmap') plan.newLocal = plan.newLocal.filter(function (r) { return r.__k != null && r.__k !== ''; });
              return MG.docSyncPush(dal, plan, PAGE).then(function () {
                var res = MG.docSyncApply(spec, local, plan);
                if (res.changed) {
                  window.CESTISStore.setItem(spec.storageKey, JSON.stringify(MG.lmsRecompose(spec, res.records, parts.unkeyed)));
                  changedKeys.push(spec.storageKey);
                }
                if (plan.conflicts.length) console.warn('[MegaData] ' + PAGE + ' ' + spec.kind + ': ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
                allBase[spec.kind] = plan.newBaseline;
              });
            });
          });
        }, Promise.resolve()).then(function () { return changedKeys; });
      }

      function rosterPass() {
        return adapter.get('meta', 'spBaseline').then(function (baseline) {
          var legacy = { students: readVal('voctrain_students', []), deletedIds: readVal('voctrain_deletedStudentIds', []) };
          return MG.spMergePlan(dal, legacy, baseline || {}).then(function (plan) {
            return MG.spPushPlan(dal, plan, PAGE).then(function () {
              var res = MG.spApplyPlanToLegacy(legacy.students, legacy.deletedIds, plan);
              if (res.changed) {
                window.CESTISStore.setItem('voctrain_students', JSON.stringify(res.students));
                window.CESTISStore.setItem('voctrain_deletedStudentIds', JSON.stringify(res.deletedIds));
              }
              if (plan.conflicts.length) console.warn('[MegaData] ' + PAGE + ' roster: ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
              return adapter.put('meta', 'spBaseline', plan.newBaseline).then(function () { return res.changed; });
            });
          });
        });
      }

      function runTick() {
        tick = tick.then(function () {
          return adapter.get('meta', 'lmsBaseline').then(function (allBase) {
            allBase = allBase || {};
            return collectionsPass(allBase).then(function (changedKeys) {
              return rosterPass().then(function (rosterChanged) {
                return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); })
                  .then(function () {
                    if (changedKeys.length || rosterChanged) {
                      applying = true;
                      try {
                        if (typeof window.loadState === 'function') { try { window.loadState(); } catch (e) {} }
                        if (typeof window.refreshBadges === 'function') { try { window.refreshBadges(); } catch (e) {} }
                      } finally { applying = false; }
                      console.info('[MegaData] ' + PAGE + ' mirror applied (' + changedKeys.length + ' collection(s)' + (rosterChanged ? ' + roster' : '') + ')');
                    }
                    return adapter.put('meta', 'lmsBaseline', allBase);
                  });
              });
            });
          }).catch(function (e) { console.warn('[MegaData] lms tick: ' + e.message); });
        });
        return tick;
      }

      var origSave = window.saveState;
      if (typeof origSave === 'function') {
        window.saveState = function () {
          var r = origSave.apply(this, arguments);
          if (!applying) runTick();
          return r;
        };
      }

      window.__lmsTick = runTick;
      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key && (e.key.indexOf('voctrain_') === 0 || e.key === 'cestisStaffAppraisals')) runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
