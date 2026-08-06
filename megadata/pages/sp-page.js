/* MegaData — Student-Progress bridge integration (stage 1; browser-only).
   The page stays LEGACY-PRIMARY for now: its own CRUD keeps writing
   voctrain_students exactly as today. In shadow mode this bridge keeps
   MegaData complete alongside it — new trainees become person + enrolment
   (+ programme/intake if unseen) and every record's presentation scalars are
   mirrored into its legacyRoster document. Deterministic entity ids AND
   deterministic creation-event ids mean any number of devices bridging the
   same records converge through broker dedupe (P10). Stage 2 (reads from
   projections, commands instead of array writes) follows once the fee page
   lands, per the signed order. */
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
    var bridging = false;

    function readJson(key) {
      try { return JSON.parse(window.CESTISStore.getItem(key) || '[]') || []; } catch (e) { return []; }
    }

    MG.pageBoot({
      page: PAGE,
      actor: { name: 'Student Progress', role: 'admin', device: 'dev_browser' },
      allow: ALLOW,
      onChange: function () { bridge(); }
    }).then(function (BOOT) {
      if (BOOT.mode === 'legacy') {
        if (BOOT.reason) console.info('[MegaData] ' + PAGE + ' legacy mode: ' + BOOT.reason);
        return;
      }
      var dal = BOOT.dal;
      console.info('[MegaData] ' + PAGE + ' bridge active (' + BOOT.mode + '), head seq ' + dal.head().seq);

      function bridgeOne(rec) {
        return MG.identityIds('id:' + rec.id, rec.course).then(function (ids) {
          var steps = [];
          if (!dal.get('programme', ids.programmeId)) {
            steps.push(['programme.defined', ids.programmeId, { name: rec.course || 'Unassigned' }, null, 'programme|' + ids.progNorm]);
          }
          if (!dal.get('intake', ids.intakeId)) {
            steps.push(['intake.opened', ids.intakeId, { label: (rec.course || 'Unassigned') + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids.programmeId }, 'intake|' + ids.progNorm]);
          }
          if (!dal.get('person', ids.personId)) {
            steps.push(['person.registered', ids.personId, MG.lmsBio(rec), null, 'person|id:' + rec.id]);
          }
          if (!dal.get('enrolment', ids.enrolmentId)) {
            var enrolledAt = /^\d{4}-\d{2}-\d{2}/.test(String(rec.enrolmentDate || rec.enrollDate || '')) ? String(rec.enrolmentDate || rec.enrollDate).slice(0, 10) : '2024-04-01';
            steps.push(['enrolment.created', ids.enrolmentId, { enrolledAt: enrolledAt }, { person: ids.personId, intake: ids.intakeId }, 'enrolment|id:' + rec.id + '|' + ids.progNorm]);
          }
          var rosterDoc = dal.get('doc', ids.rosterDocId);
          var needRoster = MG.rosterDrifted(rec, rosterDoc);
          return steps.reduce(function (pr, st) {
            return pr.then(function () {
              return MG.bridgeEventId(st[4]).then(function (evtId) {
                return dal._accept(st[0], st[1], st[2], { id: evtId, refs: st[3] || undefined, prov: { importRun: 'bridge', srcFile: PAGE, srcPath: rec.id } })
                  .catch(function (e) { if (!/exists/.test(e.message)) throw e; }); // raced another tab locally: fine
              });
            });
          }, Promise.resolve()).then(function () {
            if (!needRoster) return 0;
            var upsert = { id: undefined };                 // drift updates use minted ids (each change is its own event)
            var init = !rosterDoc;
            var mk = init ? MG.bridgeEventId('roster-init|id:' + rec.id + '|' + ids.progNorm) : Promise.resolve(undefined);
            return mk.then(function (evtId) {
              return dal._accept('doc.upserted', ids.rosterDocId,
                { kind: 'legacyRoster', diff: MG.lmsRosterDiff(rec), reason: init ? 'legacy bridge' : 'legacy drift' },
                { id: evtId, prov: { importRun: 'bridge', srcFile: PAGE, srcPath: rec.id } }).then(function () { return 1; });
            });
          });
        });
      }

      function bridge() {
        if (bridging) return; bridging = true;
        var tomb = {};
        readJson('voctrain_deletedStudentIds').forEach(function (id) { tomb[id] = 1; });
        var roster = readJson('voctrain_students').filter(function (r) { return r && r.id && !tomb[r.id]; });
        roster.reduce(function (pr, rec) { return pr.then(function () { return bridgeOne(rec); }); }, Promise.resolve())
          .then(function () { bridging = false; })
          .catch(function (e) { bridging = false; console.warn('[MegaData] bridge error: ' + e.message); });
      }

      window.__spBridge = bridge; // manual trigger + tests
      bridge();
      // Re-bridge when the legacy roster changes in this or another tab.
      window.addEventListener('storage', function (e) { if (e.key === 'voctrain_students') bridge(); });
    }).catch(function (e) { console.warn('[MegaData] boot failed, staying legacy: ' + e.message); });
  });
})();
