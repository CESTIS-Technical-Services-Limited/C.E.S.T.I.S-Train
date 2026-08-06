/* MegaData — Student-Progress bridge integration (stages 1 + 2; browser-only).
   Stage 1 (creation): new legacy trainees become person + enrolment
   (+ programme/intake if unseen) with an initial roster document —
   deterministic entity AND event ids, so any number of devices converge
   through broker dedupe (P10).
   Stage 2 (two-way merge): every saveData() triggers a serialised tick that
   runs the per-field THREE-WAY merge (baseline in local meta) from
   roster-model — local edits push as audited events (person.corrected /
   doc.upserted), remote changes apply INTO the legacy arrays the page
   renders, a local deletion tombstones the roster doc + withdraws the
   enrolment (never the person — the fee book may still need them, D11),
   canonical roster docs with no local record mirror in as legacy records,
   and both-changed conflicts push local (last writer, both audited) and are
   reported. Attendance / exam results stay stage-1 legacy (their semantic
   elevation is a named deferred item, docs/04).
   The legacy UI is untouched — window.saveData is wrapped, nothing else. */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  window.addEventListener('DOMContentLoaded', function () {
    var MG = window.MegaData;
    if (!MG || !MG.pageBoot) return;
    var PAGE = 'Student-Progress';
    var ALLOW = [
      'voctrain_students', 'voctrain_skillAreas', 'voctrain_instructorData', 'voctrain_attendance',
      'voctrain_examResults', 'voctrain_certDownloadApprovals', 'voctrain_userAccounts',
      'voctrain_studentProfiles', 'voctrain_deletedStudentIds', 'voctrain_deletedCentreIds',
      'cestiSchoolFeeStudents', 'cestiSchoolFeeDeletedLmsIds', 'cestis_pagecloud_stamps__', 'schoolDashboardGoogle'
    ];

    function readJson(key) {
      try { return JSON.parse(window.CESTISStore.getItem(key) || '[]') || []; } catch (e) { return []; }
    }
    function legacySnapshot() {
      return { students: readJson('voctrain_students'), deletedIds: readJson('voctrain_deletedStudentIds') };
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Student Progress', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { if (window.__spTick) window.__spTick(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal, adapter = BOOT.adapter;
      console.info('[MegaData] ' + PAGE + ' merge active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      var applying = false;     // guards the wrap against our own mirror save
      var tick = Promise.resolve();

      function runTick() {
        tick = tick.then(function () {
          return adapter.get('meta', 'spBaseline').then(function (baseline) {
            var legacy = legacySnapshot();
            return MG.spMergePlan(dal, legacy, baseline || {}).then(function (plan) {
              return MG.spPushPlan(dal, plan, PAGE).then(function () {
                return dal.sync.now().catch(function (e) { console.info('[MegaData] sync deferred: ' + e.message); });
              }).then(function () {
                if (plan.conflicts.length) console.warn('[MegaData] ' + plan.conflicts.length + ' both-changed field(s): local pushed as last writer, both versions audited', plan.conflicts);
                if (plan.skippedDocs.length) console.info('[MegaData] ' + plan.skippedDocs.length + ' canonical roster doc(s) left to adjudication', plan.skippedDocs);
                var res = MG.spApplyPlanToLegacy(legacy.students, legacy.deletedIds, plan);
                if (res.changed) {
                  applying = true;
                  try {
                    if (Array.isArray(window.students)) { window.students = res.students; }
                    window.CESTISStore.setItem('voctrain_students', JSON.stringify(res.students));
                    window.CESTISStore.setItem('voctrain_deletedStudentIds', JSON.stringify(res.deletedIds));
                    if (typeof window.saveData === 'function' && Array.isArray(window.students)) { try { window.saveData({ source: 'megadata-mirror' }); } catch (e) {} }
                    if (typeof window.renderStudents === 'function') { try { window.renderStudents(window.students); } catch (e) {} }
                    if (typeof window.updateSkillAreaCounts === 'function') { try { window.updateSkillAreaCounts(); } catch (e) {} }
                  } finally { applying = false; }
                  console.info('[MegaData] mirror applied: ' + plan.applies.length + ' update(s), ' + plan.newRecords.length + ' new, ' + plan.removals.length + ' removal(s)');
                }
                return adapter.put('meta', 'spBaseline', plan.newBaseline);
              });
            });
          }).catch(function (e) { console.warn('[MegaData] merge tick: ' + e.message); });
        });
        return tick;
      }

      // ONE wrap point: every legacy persist funnels through saveData.
      var origSave = window.saveData;
      if (typeof origSave === 'function') {
        window.saveData = function () {
          var r = origSave.apply(this, arguments);
          if (!applying) runTick();
          return r;
        };
      }

      window.__spTick = runTick;
      window.__spBridge = runTick;          // back-compat name from stage 1
      window.__spRoster = function () {      // fold-based read path
        return dal.find('doc', function (d2) { return d2.fields && d2.fields.docKind === 'legacyRoster' && d2.alive; });
      };

      runTick();
      window.addEventListener('storage', function (e) {
        if (e.key === 'voctrain_students' || e.key === 'voctrain_deletedStudentIds') runTick();
      });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
