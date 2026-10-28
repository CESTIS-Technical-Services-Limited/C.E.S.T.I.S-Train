/* MegaData — Staff.Clock.in integration (browser-only). Staff members and
   time records sync through the generic docsync merge. Mirror applies land
   in storage AND back on screen: loadTimeRecords() and
   initializeDefaultAdmin() close over the page's arrays and re-read
   storage, so both are honest reloaders; renderStaffTable() refreshes the
   visible list. Wrap points: saveStaffMembers, saveTimeRecords.
   Time corrections stay whole-record document updates for now — their
   semantic elevation (time.corrected events) is a named deferred step. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.CLOCK_SPECS) return;
    var PAGE = 'Staff.Clock.in';
    var ALLOW = [
      'cestisStaffMembers', 'cestisTimeRecords', 'cestisUserFiles', 'cestisCloudFileId',
      'cestisGoogle', 'cestisLastSyncTime', 'schoolDashboardGoogle', 'schoolDashboardCloudFileId',
      'schoolDashboardLastSyncTime', 'cestis_pagecloud_stamps__', 'darkMode'
    ];

    function readJson(key) {
      try { return JSON.parse(window.CESTISStore.getItem(key) || '[]') || []; } catch (e) { return []; }
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Clock In', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__clockTick) window.__clockTick(); }
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
          return adapter.get('meta', 'clockBaseline').then(function (allBase) {
            allBase = allBase || {};
            var changedKeys = [];
            return MG.CLOCK_SPECS.reduce(function (pr, spec) {
              return pr.then(function () {
                var local = readJson(spec.storageKey).filter(function (r) { return r && (r.id || r.username); });
                return MG.docSyncPlan(dal, spec, local, allBase[spec.kind] || {}).then(function (plan) {
                  return MG.docSyncPush(dal, plan, PAGE).then(function () {
                    var res = MG.docSyncApply(spec, local, plan);
                    if (res.changed) {
                      window.CESTISStore.setItem(spec.storageKey, JSON.stringify(res.records));
                      changedKeys.push(spec.storageKey);
                    }
                    if (plan.conflicts.length) console.warn('[MegaData] ' + PAGE + ' ' + spec.kind + ': ' + plan.conflicts.length + ' both-changed field(s), local pushed as last writer', plan.conflicts);
                    allBase[spec.kind] = plan.newBaseline;
                  });
                });
              });
            }, Promise.resolve()).then(function () {
              return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
            }).then(function () {
              if (changedKeys.length) {
                applying = true;
                try {
                  if (typeof window.initializeDefaultAdmin === 'function' && changedKeys.indexOf('cestisStaffMembers') !== -1) { try { window.initializeDefaultAdmin(); } catch (e) {} }
                  if (typeof window.loadTimeRecords === 'function' && changedKeys.indexOf('cestisTimeRecords') !== -1) { try { window.loadTimeRecords(); } catch (e) {} }
                  if (typeof window.renderStaffTable === 'function') { try { window.renderStaffTable(); } catch (e) {} }
                } finally { applying = false; }
                console.info('[MegaData] ' + PAGE + ' mirror applied');
              }
              return adapter.put('meta', 'clockBaseline', allBase);
            });
          }).catch(function (e) { console.warn('[MegaData] clock tick: ' + e.message); });
        });
        return tick;
      }

      ['saveStaffMembers', 'saveTimeRecords'].forEach(function (fn) {
        var orig = window[fn];
        if (typeof orig !== 'function') return;
        window[fn] = function () {
          var r = orig.apply(this, arguments);
          if (!applying) runTick();
          return r;
        };
      });

      window.__clockTick = runTick;
      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key === 'cestisStaffMembers' || e.key === 'cestisTimeRecords') runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
