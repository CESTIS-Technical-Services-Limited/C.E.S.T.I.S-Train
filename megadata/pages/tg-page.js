/* MegaData — Transcript-Grades integration (browser-only). Two-way sync for
   the page's four keyed collections (grades, unit catalogues, transcript
   profiles, exam results) through the generic docsync merge: local edits
   push as audited doc.upserted events, remote changes apply into the arrays
   the page renders, removals travel as the soft `_removed` flag (revivable —
   the page legitimately re-adds a cleared grade under the same id), and
   both-changed fields push local as last writer, reported. One wrap point:
   the page's own writeJSON. The legacy UI is untouched. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot || !MG.TG_SPECS) return;
    var PAGE = 'Transcript-Grades';
    var WATCHED = {};
    MG.TG_SPECS.forEach(function (s) { WATCHED[s.storageKey] = 1; });
    var ALLOW = [
      'voctrain_students', 'voctrain_exams', 'voctrain_examResults', 'voctrain_instructorData',
      'voctrain_transcriptGrades', 'voctrain_certTranscriptRequests', 'voctrain_transcriptProfiles',
      'voctrain_unitCatalogs', 'cestis_pagecloud_stamps__', 'schoolDashboardGoogle', 'darkMode'
    ];

    function readCol(spec) {
      var raw;
      try { raw = JSON.parse(window.CESTISStore.getItem(spec.storageKey) || 'null'); } catch (e) { raw = null; }
      if (spec.objmap) return MG.profilesToList(raw || {});
      return Array.isArray(raw) ? raw : [];
    }
    function writeCol(spec, records) {
      var v = spec.objmap ? MG.listToProfiles(records) : records;
      window.CESTISStore.setItem(spec.storageKey, JSON.stringify(v));
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Transcript Grades', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__tgTick) window.__tgTick(); }
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
          return adapter.get('meta', 'tgBaseline').then(function (allBase) {
            allBase = allBase || {};
            var changedAny = false, conflicts = [];
            return MG.TG_SPECS.reduce(function (pr, spec) {
              return pr.then(function () {
                var local = readCol(spec);
                return MG.docSyncPlan(dal, spec, local, allBase[spec.kind] || {}).then(function (plan) {
                  return MG.docSyncPush(dal, plan, PAGE).then(function () {
                    var res = MG.docSyncApply(spec, local, plan);
                    if (res.changed) { writeCol(spec, res.records); changedAny = true; }
                    conflicts = conflicts.concat(plan.conflicts);
                    allBase[spec.kind] = plan.newBaseline;
                  });
                });
              });
            }, Promise.resolve()).then(function () {
              return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
            }).then(function () {
              if (conflicts.length) console.warn('[MegaData] ' + conflicts.length + ' both-changed field(s): local pushed as last writer, both audited', conflicts);
              if (changedAny) {
                applying = true;
                try {
                  if (typeof window.loadAll === 'function') { try { window.loadAll(); } catch (e) {} }
                  ['renderGradeRows', 'refreshPreview'].forEach(function (fn) {
                    if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
                  });
                } finally { applying = false; }
                console.info('[MegaData] ' + PAGE + ' mirror applied');
              }
              return adapter.put('meta', 'tgBaseline', allBase);
            });
          }).catch(function (e) { console.warn('[MegaData] docsync tick: ' + e.message); });
        });
        return tick;
      }

      // ONE wrap point: every save on this page goes through writeJSON.
      var origWrite = window.writeJSON;
      if (typeof origWrite === 'function') {
        window.writeJSON = function (key, val) {
          var r = origWrite.apply(this, arguments);
          if (!applying && WATCHED[key]) runTick();
          return r;
        };
      }

      window.__tgTick = runTick;
      window.__tgDocs = function (kind) {
        return dal.find('doc', function (d2) { return d2.alive && d2.fields && d2.fields.docKind === kind; });
      };

      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key && WATCHED[e.key]) runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
