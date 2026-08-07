/* MegaData — Cert/Transcript-Requests page integration (pilot; browser-only).
   Loaded AFTER the page's own script. Resolves the mode via pageBoot:
     legacy  → does nothing except run the shim in report mode (telemetry);
     shadow  → swaps the page's data layer onto the DAL: reads fold from the
               log, the status change becomes an audited doc.upserted, and the
               legacy key is kept MIRRORED so index.html's badge and the
               trainee page keep working until their own refactors (docs/04 §8);
               legacy-side writes (trainee requests) are bridged IN with
               deterministic entity ids, so every device converges (P10).
   The page's original functions remain the legacy path, untouched. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot) return;

    var PAGE = 'Cert-Transcript-Requests';
    var LEGACY_ALLOW = [
      'voctrain_certTranscriptRequests', 'voctrain_students', 'voctrain_skillAreas',
      'voctrain_deletedCentreIds', 'cestis_pagecloud_stamps__', 'schoolDashboardGoogle'
    ];
    var refresh = function () {};

    MG.pageBoot({
      page: PAGE,
      actor: { name: String(window.ACTOR || 'Admin'), role: 'admin', device: 'dev_browser' },
      allow: LEGACY_ALLOW,
      onChange: function () { refresh(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' in legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal;
      console.info('[MegaData] ' + PAGE + ' in ' + BOOT.mode + ' mode, head seq ' + dal.head().seq);

      function docs() { return dal.project('entities', { kind: 'doc' }); }

      function mirrorLegacy() {
        // Keep unrefactored consumers alive during the shadow (docs/04 §8).
        try {
          window.CESTISStore.setItem('voctrain_certTranscriptRequests', JSON.stringify(window.requests));
          window.top.postMessage({ type: 'transcript-data-updated', requests: true }, '*');
        } catch (e) {}
      }

      // Bridge legacy-side writes IN (trainee page still writes only the key).
      function bridgeFromLegacy() {
        var legacy = [];
        try { legacy = JSON.parse(window.CESTISStore.getItem('voctrain_certTranscriptRequests') || '[]'); } catch (e) {}
        var delta = MG.ctrLegacyDelta(legacy, docs());
        var work = delta.missing.concat(delta.changed);
        return work.reduce(function (pr, r) {
          return pr.then(function () {
            return MG.ctrEntityId(r.id).then(function (docId) {
              return dal.upsertDoc(MG.CTR_KIND, docId, MG.ctrToDocDiff(r), 'legacy bridge');
            });
          });
        }, Promise.resolve()).then(function () { return work.length; });
      }

      // ---- swap the page's data layer (globals declared with var/function) ----
      window.load = function () {
        window.requests = MG.ctrFromDocs(docs());
      };
      window.save = function () { mirrorLegacy(); };
      window.setStatus = function (idx, status) {
        var r = window.requests[idx];
        if (!r) return;
        MG.ctrEntityId(r.id).then(function (docId) {
          return dal.upsertDoc(MG.CTR_KIND, docId,
            MG.ctrStatusDiff(status, String(window.ACTOR || 'Admin'), new Date().toISOString()),
            'status update');
        }).then(function () {
          window.load(); mirrorLegacy(); window.render();
          var T = window.CESTISCore && window.CESTISCore.Transcript;
          window.toast((r.studentName || 'Request') + ' → ' + ((T && T.REQUEST_STATUS_LABELS[status]) || status));
        }).catch(function (e) { window.toast('Not saved: ' + e.message); });
      };

      refresh = function () {
        bridgeFromLegacy().then(function (n) {
          window.load(); if (n) mirrorLegacy();
          window.render();
        });
      };
      refresh();
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
