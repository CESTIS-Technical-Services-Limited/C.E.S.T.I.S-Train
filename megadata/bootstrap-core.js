/* MegaData — bootstrap/migration core (Phase 5 step 5; algorithm: docs/04).
   Pure, checkpointed, DETERMINISTIC pipeline: inventory → extract → resolve →
   synthesize → verify. Runs inside the operator CLI (the human is the lock).
   Determinism mandate (docs/04 §3): the run timestamp is fixed at preflight and
   carried in the checkpoint; every event id and entity id derives from the
   source records; re-runs and resumed runs converge to the identical event set
   (P10). Nothing is ever skipped silently: unparseable input → quarantine;
   ambiguous identity → adjudication queue; financial disagreement → queue.
   Implemented source kinds so far: 'schoolfee-pagecloud' (the production
   School-Fee page-cloud payload). Other extractors land with their page
   refactors; the pipeline treats every source identically. */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = { MD: require('./schemas.js'), BR: require('./broker-core.js'), P: require('./projections.js'), CTR: require('./pages/ctr-model.js'), CBS: require('./cashbook-shared.js'), LMS: require('./lms-collections.js') };
    module.exports = factory(deps);
  } else {
    deps = { MD: root.MegaData, BR: root.MegaData, P: root.MegaData, CBS: root.MegaData, LMS: root.MegaData };
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (deps) {
  'use strict';
  var MD = deps.MD, BR = deps.BR, P = deps.P, CTR = deps.CTR || deps.MD;
  var cbAmount = (deps.CBS || deps.MD).cbAmount; // the ONE cashbook resolver (cashbook-shared.js)
  var TRANSFORM_V = 1;
  var ACTOR = { name: 'Legacy migration', role: 'system', device: 'cli' };

  function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function toMinor(x) {
    var n = Number(x) || 0;
    var minor = Math.round(n * 100);
    return { minor: minor, exact: Math.abs(n * 100 - minor) < 1e-6 };
  }
  function detId(prefix, key) {
    return MD.sha256Hex('mega-bootstrap|' + key).then(function (h) { return prefix + '_m' + h.slice(0, 20); });
  }

  // The LMS collections table lives in lms-collections.js — ONE source of
  // truth shared with the live index.html bridge (same discipline as
  // cashbook-shared).
  var LMS_COLLECTIONS = (deps.LMS || deps.MD).LMS_COLLECTIONS;

  /* ---------- extractors ---------- */
  var EXTRACTORS = {
    // The live page-cloud payload: { version, page, file, savedAt, stamps, data:{key→rawString} }
    'schoolfee-pagecloud': function (src, out) {
      var data = (src.json && src.json.data) || {};
      function parse(key) {
        var v = data[key];
        if (v == null) return null;
        if (typeof v !== 'string') return v; // some backups store parsed values
        try { return JSON.parse(v); } catch (e) {
          out.quarantine.push({ srcId: src.id, path: key, reason: 'unparseable JSON: ' + e.message });
          return null;
        }
      }
      var students = parse('cestiSchoolFeeStudents') || [];
      var payments = parse('cestiSchoolFeePayments') || [];
      var feeStructure = parse('cestiFeeStructure') || {};
      var delPay = parse('cestiSchoolFeeDeletedPaymentIds') || [];
      var delStu = parse('cestiSchoolFeeDeletedLmsIds') || [];
      students.forEach(function (s, i) {
        if (!s || typeof s !== 'object' || !s.id) { out.quarantine.push({ srcId: src.id, path: 'cestiSchoolFeeStudents[' + i + ']', reason: 'student record without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'cestiSchoolFeeStudents[' + i + ']', kind: 'student', raw: s });
      });
      payments.forEach(function (p, i) {
        if (!p || typeof p !== 'object' || !p.id || p.amount == null) { out.quarantine.push({ srcId: src.id, path: 'cestiSchoolFeePayments[' + i + ']', reason: 'payment record without id/amount' }); return; }
        out.staging.push({ srcId: src.id, path: 'cestiSchoolFeePayments[' + i + ']', kind: 'payment', raw: p });
      });
      Object.keys(feeStructure).forEach(function (name) {
        out.staging.push({ srcId: src.id, path: 'cestiFeeStructure[' + JSON.stringify(name) + ']', kind: 'feeStructure', raw: { name: name, entry: feeStructure[name] } });
      });
      out.staging.push({ srcId: src.id, path: 'tombstones', kind: 'tombstones', raw: { deletedPaymentIds: delPay, deletedStudentIds: delStu } });
    },
    // The Student-Progress page-cloud payload: the LMS roster + its tombstones.
    'student-progress-pagecloud': function (src, out) {
      var data = (src.json && src.json.data) || {};
      function parse(key) {
        var v = data[key];
        if (v == null) return null;
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch (e) {
          out.quarantine.push({ srcId: src.id, path: key, reason: 'unparseable JSON: ' + e.message });
          return null;
        }
      }
      (parse('voctrain_students') || []).forEach(function (s2, i) {
        if (!s2 || typeof s2 !== 'object' || !s2.id) { out.quarantine.push({ srcId: src.id, path: 'voctrain_students[' + i + ']', reason: 'student record without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_students[' + i + ']', kind: 'lmsStudent', raw: s2 });
      });
      (parse('voctrain_attendance') || []).forEach(function (a2, i) {
        if (!a2 || typeof a2 !== 'object' || !a2.studentId || !a2.date) { out.quarantine.push({ srcId: src.id, path: 'voctrain_attendance[' + i + ']', reason: 'attendance row without studentId/date' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_attendance[' + i + ']', kind: 'legacyAttendance', raw: a2 });
      });
      (parse('voctrain_examResults') || []).forEach(function (e2, i) {
        if (!e2 || typeof e2 !== 'object' || !e2.id) { out.quarantine.push({ srcId: src.id, path: 'voctrain_examResults[' + i + ']', reason: 'exam result without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_examResults[' + i + ']', kind: 'legacyExamResult', raw: e2 });
      });
      out.staging.push({ srcId: src.id, path: 'lms-tombstones', kind: 'tombstones', raw: { deletedStudentIds: parse('voctrain_deletedStudentIds') || [] } });
    },
    // The Transcript-Grades page-cloud payload: manual grades, unit
    // catalogues, transcript bio profiles — lossless Tier-B documents.
    'transcript-grades-pagecloud': function (src, out) {
      var data = (src.json && src.json.data) || {};
      function parse(key) {
        var v = data[key];
        if (v == null) return null;
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch (e) {
          out.quarantine.push({ srcId: src.id, path: key, reason: 'unparseable JSON: ' + e.message });
          return null;
        }
      }
      (parse('voctrain_transcriptGrades') || []).forEach(function (g, i) {
        if (!g || typeof g !== 'object' || !g.id) { out.quarantine.push({ srcId: src.id, path: 'voctrain_transcriptGrades[' + i + ']', reason: 'grade without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_transcriptGrades[' + i + ']', kind: 'tgGrade', raw: g });
      });
      (parse('voctrain_unitCatalogs') || []).forEach(function (u, i) {
        if (!u || typeof u !== 'object' || !u.id) { out.quarantine.push({ srcId: src.id, path: 'voctrain_unitCatalogs[' + i + ']', reason: 'unit catalogue without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_unitCatalogs[' + i + ']', kind: 'unitCatalog', raw: u });
      });
      var profiles = parse('voctrain_transcriptProfiles') || {};
      Object.keys(profiles).forEach(function (sid) {
        out.staging.push({ srcId: src.id, path: 'voctrain_transcriptProfiles[' + JSON.stringify(sid) + ']', kind: 'tgProfile', raw: { studentId: sid, profile: profiles[sid] } });
      });
    },
    // The LMS main backup (CESTIS_LMS_BACKUP.json data map) and, via the
    // master-snapshot translator, the voctrain_* store keys. Every collection
    // imports losslessly as Tier-B documents with deterministic keys; array
    // records without an id quarantine. Modes: array | objmap (key→record) |
    // msgmap (roomId→[messages]) | single (one document).
    'lms-backup': function (src, out) {
      var data = (src.json && src.json.data) || {};
      function val(names) {
        for (var i = 0; i < names.length; i++) {
          var v = data[names[i]];
          if (v == null) continue;
          if (typeof v !== 'string') return { v: v, name: names[i] };
          try { return { v: JSON.parse(v), name: names[i] }; } catch (e) {
            out.quarantine.push({ srcId: src.id, path: names[i], reason: 'unparseable JSON: ' + e.message });
            return null;
          }
        }
        return null;
      }
      LMS_COLLECTIONS.forEach(function (spec) {
        var got = val(spec.names);
        if (!got) return;
        var v = got.v, name = got.name;
        function stage(docKey, raw, path) {
          out.staging.push({ srcId: src.id, path: path, kind: 'tierbDoc', raw: { docKind: spec.kind, docKey: spec.kind + '|' + docKey, fields: raw } });
        }
        if (spec.mode === 'single') {
          if (v && typeof v === 'object') stage('singleton', v, name);
        } else if (spec.mode === 'array') {
          (Array.isArray(v) ? v : []).forEach(function (r, i) {
            var id = r && spec.idOf(r);
            if (!id) { out.quarantine.push({ srcId: src.id, path: name + '[' + i + ']', reason: spec.kind + ' record without id' }); return; }
            stage(String(id), r, name + '[' + i + ']');
          });
        } else if (spec.mode === 'objmap') {
          Object.keys(v || {}).forEach(function (k) {
            var raw = v[k];
            stage(String(k), (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : { value: raw }, name + '[' + JSON.stringify(k) + ']');
          });
        } else if (spec.mode === 'msgmap') {
          Object.keys(v || {}).forEach(function (roomId) {
            (Array.isArray(v[roomId]) ? v[roomId] : []).forEach(function (m, i) {
              var id = m && m.id;
              if (!id) { out.quarantine.push({ srcId: src.id, path: name + '[' + JSON.stringify(roomId) + '][' + i + ']', reason: 'chat message without id' }); return; }
              stage(String(id), Object.assign({ roomId: roomId }, m), name + '[' + JSON.stringify(roomId) + '][' + i + ']');
            });
          });
        }
      });
      // The backup's students/attendance/examResults ride the SP extractor
      // shapes so identity unification applies unchanged.
      EXTRACTORS['student-progress-pagecloud']({ id: src.id, json: { data: {
        voctrain_students: data.students || data.voctrain_students,
        voctrain_deletedStudentIds: data.deletedStudentIds || data.voctrain_deletedStudentIds || [],
        voctrain_attendance: data.attendanceRecords || data.voctrain_attendance,
        voctrain_examResults: data.examResults || data.voctrain_examResults
      } } }, out);
    },
    // cestis-master-snapshot.json: { schemaVersion, counts, checksum,
    // store: { storageKey → rawString } }. Translate the store into a data
    // map, run every implemented extractor over it, and ACCOUNT for every
    // key: claimed, deliberately excluded, deferred, or not-yet-mapped.
    'master-snapshot': function (src, out) {
      var store = (src.json && src.json.store) || {};
      var translated = { id: src.id, json: { data: store } };
      EXTRACTORS['schoolfee-pagecloud'](translated, out);
      EXTRACTORS['student-progress-pagecloud'](translated, out);
      EXTRACTORS['transcript-requests-pagecloud'](translated, out);
      EXTRACTORS['transcript-grades-pagecloud'](translated, out);
      EXTRACTORS['lms-backup'](translated, out);
      EXTRACTORS['finance-staff-pagecloud'](translated, out);
      var claimed = {
        cestiSchoolFeeStudents: 1, cestiSchoolFeePayments: 1, cestiFeeStructure: 1,
        cestiSchoolFeeDeletedPaymentIds: 1, cestiSchoolFeeDeletedLmsIds: 1, cestiSchoolFeeDocuments: 1,
        voctrain_students: 1, voctrain_deletedStudentIds: 1, voctrain_attendance: 1,
        voctrain_examResults: 1, voctrain_certTranscriptRequests: 1, voctrain_transcriptGrades: 1,
        voctrain_unitCatalogs: 1, voctrain_transcriptProfiles: 1
      };
      LMS_COLLECTIONS.forEach(function (spec) { spec.names.forEach(function (n) { claimed[n] = 1; }); });
      ['cesti_virements', 'cesti_virement_deleted_ids', 'cesti_virement_logo', 'cesti_cashbook_data',
       'cestis_finance_invoices', 'cestis_finance_quotes', 'cestis_finance_pos', 'cestis_finance_convert',
       'cestis_finance_voucher_overrides', 'cestis_budget_overrides', 'cestis_budget_deleted',
       'cestis_fin_logo', 'cestis_recon_logo', 'cestisPayroll', 'dashboardUsers', 'cestisPermissions',
       'cestisStaffMembers', 'cestisTimeRecords', 'cestiUsers'].forEach(function (n) { claimed[n] = 1; });
      var CLAIMED_PREFIX = ['cestis_quarter_', 'cestis_budget_', 'cestis_recon_', 'voctrain_attendance::', 'voctrain_user_'];
      var EXCLUDE = /token|session|cloudfileid|lastsync|darkmode|pagecloud_stamps|examinprogress|dataversion|maintenancemode|autosync|form_draft|cloud_cache|active_quarter|firsttime|dismissed|currentuser|schoolsettings|mainlinks|quicklinks|auth_session/i;
      Object.keys(store).forEach(function (k) {
        if (claimed[k]) return;
        if (EXCLUDE.test(k)) return;                                   // per-machine / view / scratch state, deliberately not imported
        if (k === 'voctrain_attendance_quartered') return;             // mirror flag
        if (CLAIMED_PREFIX.some(function (p2) { return k.indexOf(p2) === 0; })) return;
        out.quarantine.push({ srcId: src.id, path: k, reason: 'snapshot key not yet mapped' });
      });
    },
    // Cashbook / virement / finance-docs / payroll / clock / sibling users:
    // the page-cloud payloads AND the same keys inside the master snapshot.
    'finance-staff-pagecloud': function (src, out) {
      var data = (src.json && src.json.data) || {};
      function parseVal(v, path) {
        if (v == null) return null;
        if (typeof v !== 'string') return v;
        try { return JSON.parse(v); } catch (e) { out.quarantine.push({ srcId: src.id, path: path, reason: 'unparseable JSON: ' + e.message }); return null; }
      }
      function doc(kind, key, fields, path) {
        out.staging.push({ srcId: src.id, path: path, kind: 'tierbDoc', raw: { docKind: kind, docKey: kind + '|' + key, fields: fields } });
      }
      Object.keys(data).forEach(function (k) {
        var mq = k.match(/^cestis_quarter_(.+)_Q(\d)$/);
        var mb = k.match(/^cestis_budget_(.+)_Q(\d)$/);
        if (mq) {
          var blob = parseVal(data[k], k) || {};
          out.staging.push({ srcId: src.id, path: k, kind: 'cbQuarter', raw: { fy: mq[1], q: parseInt(mq[2], 10), openingBalance: blob.openingBalance, deletedTxnIds: blob.deletedTxnIds || [] } });
          (Array.isArray(blob.transactions) ? blob.transactions : []).forEach(function (t, i) {
            if (t == null || t.id == null) { out.quarantine.push({ srcId: src.id, path: k + '.transactions[' + i + ']', reason: 'cashbook txn without id' }); return; }
            out.staging.push({ srcId: src.id, path: k + '.transactions[' + i + ']', kind: 'cbTxn', raw: { fy: mq[1], q: parseInt(mq[2], 10), txn: t } });
          });
        } else if (mb && k !== 'cestis_budget_overrides' && k !== 'cestis_budget_deleted') {
          var bb = parseVal(data[k], k) || {};
          out.staging.push({ srcId: src.id, path: k, kind: 'cbBudget', raw: { fy: mb[1], q: parseInt(mb[2], 10), budget: bb.budget || {}, sections: bb.sections || {} } });
        } else if (/^cestis_recon_(bank|uncleared|depnotshown)_/.test(k)) {
          doc('reconState', k, { value: parseVal(data[k], k) }, k);
        }
      });
      (parseVal(data.cesti_virements, 'cesti_virements') || []).forEach(function (r, i) {
        if (!r || r.id == null) { out.quarantine.push({ srcId: src.id, path: 'cesti_virements[' + i + ']', reason: 'virement without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'cesti_virements[' + i + ']', kind: 'virement', raw: r });
      });
      out.staging.push({ srcId: src.id, path: 'virement-tombstones', kind: 'tombstones', raw: { deletedVirementIds: parseVal(data.cesti_virement_deleted_ids, 'cesti_virement_deleted_ids') || [] } });
      [['cestis_finance_invoices', 'invoice'], ['cestis_finance_quotes', 'quote'], ['cestis_finance_pos', 'po']].forEach(function (pair) {
        (parseVal(data[pair[0]], pair[0]) || []).forEach(function (r, i) {
          if (!r || !r.id) { out.quarantine.push({ srcId: src.id, path: pair[0] + '[' + i + ']', reason: pair[1] + ' without id' }); return; }
          out.staging.push({ srcId: src.id, path: pair[0] + '[' + i + ']', kind: 'findoc', raw: { kind: pair[1], rec: r } });
        });
      });
      var vo = parseVal(data.cestis_finance_voucher_overrides, 'cestis_finance_voucher_overrides') || {};
      Object.keys(vo).forEach(function (k2) { doc('voucherOverride', k2, (vo[k2] && typeof vo[k2] === 'object') ? vo[k2] : { value: vo[k2] }, 'cestis_finance_voucher_overrides[' + JSON.stringify(k2) + ']'); });
      [['cestis_finance_convert', 'financeConvert'], ['cestis_budget_overrides', 'budgetOverrides'], ['cestis_budget_deleted', 'budgetDeleted'],
       ['cesti_virement_logo', 'virementLogo'], ['cestis_fin_logo', 'finLogo'], ['cestis_recon_logo', 'reconLogo'],
       ['cesti_cashbook_data', 'legacyCashbookFlat']].forEach(function (pair) {
        var v = parseVal(data[pair[0]], pair[0]);
        if (v != null) doc(pair[1], 'singleton', (typeof v === 'object' && !Array.isArray(v)) ? v : { value: v }, pair[0]);
      });
      var payroll = parseVal(data.cestisPayroll, 'cestisPayroll');
      if (payroll) {
        if (payroll.settings) doc('payrollSettings', 'singleton', payroll.settings, 'cestisPayroll.settings');
        (payroll.employees || []).forEach(function (e2, i) {
          if (!e2 || !e2.name) { out.quarantine.push({ srcId: src.id, path: 'cestisPayroll.employees[' + i + ']', reason: 'employee without name' }); return; }
          doc('employee', e2.name, e2, 'cestisPayroll.employees[' + i + ']');
        });
        (payroll.payrollRuns || []).forEach(function (r2, i) {
          if (!r2 || !r2.date) { out.quarantine.push({ srcId: src.id, path: 'cestisPayroll.payrollRuns[' + i + ']', reason: 'payroll run without date' }); return; }
          doc('payrollRun', r2.date, r2, 'cestisPayroll.payrollRuns[' + i + ']');
        });
      }
      [['dashboardUsers', 'payslipUser'], ['cestisPermissions', 'permissionRequest'], ['cestisStaffMembers', 'staffMember'],
       ['cestisTimeRecords', 'timeRecord'], ['cestiUsers', 'feeUser']].forEach(function (pair) {
        (parseVal(data[pair[0]], pair[0]) || []).forEach(function (r2, i) {
          var id = r2 && (r2.id || r2.username);
          if (!id) { out.quarantine.push({ srcId: src.id, path: pair[0] + '[' + i + ']', reason: pair[1] + ' without id' }); return; }
          doc(pair[1], String(id), r2, pair[0] + '[' + i + ']');
        });
      });
    },
    // The Cert/Transcript-Requests page-cloud payload → Tier-B documents.
    'transcript-requests-pagecloud': function (src, out) {
      var data = (src.json && src.json.data) || {};
      var v = data.voctrain_certTranscriptRequests;
      var arr = null;
      if (v != null) {
        if (typeof v !== 'string') arr = v;
        else { try { arr = JSON.parse(v); } catch (e) { out.quarantine.push({ srcId: src.id, path: 'voctrain_certTranscriptRequests', reason: 'unparseable JSON: ' + e.message }); } }
      }
      (arr || []).forEach(function (r, i) {
        if (!r || typeof r !== 'object' || !r.id) { out.quarantine.push({ srcId: src.id, path: 'voctrain_certTranscriptRequests[' + i + ']', reason: 'request record without id' }); return; }
        out.staging.push({ srcId: src.id, path: 'voctrain_certTranscriptRequests[' + i + ']', kind: 'ctrRequest', raw: r });
      });
    }
  };

  /* ---------- pipeline ---------- */
  function runBootstrap(opts) {
    var sources = opts.sources;           // [{ id, kind, name, json }]
    var adapter = opts.adapter;           // staging + checkpoint store (FileAdapter in the CLI)
    var dryRun = !!opts.dryRun;
    var failAfter = opts.failAfterStep || null;   // test hook: simulated interruption
    var runStamp = opts.runStamp;         // fixed ISO instant; REQUIRED (determinism)
    if (!runStamp) return Promise.reject(new Error('runStamp is required (fixed at preflight, carried in the checkpoint)'));
    var R;                                 // in-memory working state (rebuilt from staging on resume)

    function checkpoint(step) {
      return adapter.put('checkpoint', 'state', { step: step, runStamp: runStamp, transformV: TRANSFORM_V })
        .then(function () { if (failAfter === step) { var e = new Error('SIMULATED_INTERRUPT after ' + step); e.simulated = true; throw e; } });
    }
    function loadCheckpoint() { return adapter.get('checkpoint', 'state'); }

    /* step: inventory + extract (kept together: inventory hashes the raw
       sources; extract stages every record or quarantines it). */
    function stepExtract() {
      R = { staging: [], quarantine: [], inventory: { sources: [], totals: {} } };
      var chain = Promise.resolve();
      sources.forEach(function (src) {
        chain = chain.then(function () {
          var rawText = JSON.stringify(src.json);
          return MD.sha256Hex(rawText).then(function (h) {
            var ex = EXTRACTORS[src.kind];
            if (!ex) { R.quarantine.push({ srcId: src.id, path: '*', reason: 'no extractor for kind ' + src.kind }); return; }
            var before = R.staging.length;
            ex(src, R);
            var counts = {};
            R.staging.slice(before).forEach(function (r) { counts[r.kind] = (counts[r.kind] || 0) + 1; });
            R.inventory.sources.push({ id: src.id, kind: src.kind, name: src.name, sha256: h, bytes: rawText.length, counts: counts });
          });
        });
      });
      return chain.then(function () {
        // Financial baseline from ATOMIC records (never from stored balances).
        // Overlapping sources carry COPIES of the same atoms (two fee files,
        // plus the master snapshot's embedded store): every id-bearing atom
        // counts ONCE, mirroring the synthesis-side dedupe — otherwise the
        // identity would compare a deduped fold to a double-counted baseline.
        var totalMinor = 0, imprecise = 0;
        var tomb = {};
        R.staging.forEach(function (r) { if (r.kind === 'tombstones') (r.raw.deletedPaymentIds || []).forEach(function (id) { tomb[id] = 1; }); });
        var seenPay = {};
        R.staging.forEach(function (r) {
          if (r.kind === 'payment' && !tomb[r.raw.id] && !seenPay[r.raw.id]) {
            seenPay[r.raw.id] = 1;
            var m = toMinor(r.raw.amount);
            totalMinor += m.minor; if (!m.exact) imprecise++;
          }
        });
        function uniqueBy(kind, keyOf, filter) {
          var seen = {}, n = 0;
          R.staging.forEach(function (r) {
            if (r.kind !== kind) return;
            if (filter && !filter(r)) return;
            var k = keyOf(r);
            if (seen[k]) return;
            seen[k] = 1; n++;
          });
          return n;
        }
        var stuTomb = {};
        R.staging.forEach(function (r) { if (r.kind === 'tombstones') (r.raw.deletedStudentIds || []).forEach(function (id) { stuTomb[id] = 1; }); });
        R.studentTombstones = stuTomb;
        R.inventory.totals = {
          students: uniqueBy('student', function (r) { return String(r.raw.id); }),
          lmsStudents: uniqueBy('lmsStudent', function (r) { return String(r.raw.id); }, function (r) { return !stuTomb[r.raw.id]; }),
          tombstonedLmsStudents: uniqueBy('lmsStudent', function (r) { return String(r.raw.id); }, function (r) { return !!stuTomb[r.raw.id]; }),
          payments: Object.keys(seenPay).length,
          tombstonedPayments: Object.keys(tomb).length,
          paymentsTotalMinor: totalMinor, floatPrecisionNotes: imprecise,
          attendanceRows: R.staging.filter(function (r) { return r.kind === 'legacyAttendance'; }).length,
          examResults: R.staging.filter(function (r) { return r.kind === 'legacyExamResult'; }).length,
          transcriptGrades: R.staging.filter(function (r) { return r.kind === 'tgGrade'; }).length,
          unitCatalogs: R.staging.filter(function (r) { return r.kind === 'unitCatalog'; }).length,
          transcriptProfiles: R.staging.filter(function (r) { return r.kind === 'tgProfile'; }).length,
          lmsDocs: R.staging.filter(function (r) { return r.kind === 'tierbDoc'; }).length,
          cashbookEntries: 0, cashbookIncomeMinor: 0, cashbookExpenseMinor: 0, cashbookDeletedTxns: 0, cashbookVoided: 0,
          virements: R.staging.filter(function (r) { return r.kind === 'virement'; }).length,
          findocs: R.staging.filter(function (r) { return r.kind === 'findoc'; }).length,
          quarantined: R.quarantine.length
        };
        var cbDeleted = {};
        R.staging.forEach(function (r) {
          if (r.kind === 'cbQuarter') (r.raw.deletedTxnIds || []).forEach(function (id) { cbDeleted[r.raw.fy + '|Q' + r.raw.q + '|' + id] = 1; });
        });
        R.cbDeleted = cbDeleted;
        var seenCb = {};
        R.staging.forEach(function (r) {
          if (r.kind !== 'cbTxn') return;
          var cbKey = r.raw.fy + '|Q' + r.raw.q + '|' + r.raw.txn.id;
          if (seenCb[cbKey]) return; // a copy of the same atom via another source
          seenCb[cbKey] = 1;
          if (cbDeleted[cbKey]) { R.inventory.totals.cashbookDeletedTxns++; return; }
          var a2 = cbAmount(r.raw.txn);
          if (a2.klass !== 'income' && a2.klass !== 'expense') return;
          R.inventory.totals.cashbookEntries++;
          if (a2.voided) { R.inventory.totals.cashbookVoided++; return; } // imported for the record; ZERO in totals, like the legacy arithmetic
          if (a2.klass === 'income') R.inventory.totals.cashbookIncomeMinor += a2.amountMinor;
          else R.inventory.totals.cashbookExpenseMinor += a2.amountMinor;
        });
        return adapter.put('staging', 'all', R.staging)
          .then(function () { return adapter.put('staging', 'quarantine', R.quarantine); })
          .then(function () { return adapter.put('staging', 'inventory', R.inventory); })
          .then(function () { return checkpoint('extract'); });
      });
    }

    /* step: identity resolution (docs/04 §5 tiers; P6: fuzzy never merges).
       Cross-source rule: a fee record linked to an LMS record (lmsId /
       'SF-'-prefixed twin id) and that LMS record share ONE canonical key, so
       the pair resolves to one person (tier A: exact id link). */
    function canonicalIdKey(r) {
      var raw = r.raw;
      if (r.kind === 'lmsStudent') return 'id:' + String(raw.id);
      var lms = raw.lmsId || (typeof raw.id === 'string' && raw.id.indexOf('SF-') === 0 ? raw.id.slice(3) : null);
      return 'id:' + String(lms || raw.id);
    }
    function rawNationalId(raw) { return String(raw.nationalId || raw.trn || '').trim(); }
    function rawDob(raw) { return String(raw.dateOfBirth || raw.dob || '').trim(); }
    function stepResolve() {
      var students = R.staging.filter(function (r) {
        if (r.kind === 'student') return true;
        if (r.kind === 'lmsStudent') return !R.studentTombstones[r.raw.id]; // legacy-deleted: accounted, not imported
        return false;
      });
      var groups = {};       // identityKey → [records]
      var queue = [];        // tier-B human items
      var keepSeparate = []; // tier-C
      var byNationalId = {}, byNameDob = {}, byName = {};
      students.forEach(function (r) {
        var s = r.raw;
        var nid = rawNationalId(s);
        var nm = normName(s.name), dob = rawDob(s);
        (byName[nm] = byName[nm] || []).push(r);
        if (nid) (byNationalId[nid] = byNationalId[nid] || []).push(r);
        else if (nm && dob) (byNameDob[nm + '|' + dob] = byNameDob[nm + '|' + dob] || []).push(r);
      });
      var assigned = {};     // staging path → identityKey
      // Tier A: exact record id (same id across sources IS the same record),
      // or exact non-empty nationalId — but an id-LINK is only trusted when
      // the linked records' names agree (P6): a shared link joining different
      // names is a data defect (seen in the wild: an anonymiser reused link
      // values) and goes to the HUMAN queue, imported separately.
      var byProposed = {};
      students.forEach(function (r) { (byProposed[canonicalIdKey(r)] = byProposed[canonicalIdKey(r)] || []).push(r); });
      Object.keys(byProposed).forEach(function (key) {
        var rs = byProposed[key];
        var names = {};
        rs.forEach(function (r) { var n = normName(r.raw.name); if (n) names[n] = 1; });
        if (rs.length > 1 && Object.keys(names).length > 1) {
          rs.forEach(function (r) { assigned[r.path] = 'id:' + String(r.raw.id) + '#' + r.kind; }); // unmerged, distinct
          queue.push({ kind: 'identity', tier: 'B', suggestion: 'shared id-link with conflicting names (' + key + ')', records: rs.map(function (r) { return { srcId: r.srcId, path: r.path, id: r.raw.id, name: r.raw.name }; }) });
        } else {
          rs.forEach(function (r) { assigned[r.path] = key; });
        }
      });
      Object.keys(byNationalId).forEach(function (nid) {
        var rs = byNationalId[nid];
        if (rs.length > 1) {
          var key = 'nid:' + nid;
          rs.forEach(function (r) { assigned[r.path] = key; });
        }
      });
      // Tier B: same name + same dob (no strong id) → HUMAN decides; imported
      // as separate people, queued with the suggestion.
      Object.keys(byNameDob).forEach(function (k) {
        var rs = byNameDob[k];
        if (rs.length > 1) queue.push({ kind: 'identity', tier: 'B', suggestion: 'same name + dob', records: rs.map(function (r) { return { srcId: r.srcId, path: r.path, id: r.raw.id, name: r.raw.name }; }) });
      });
      // Tier C: same name only → keep separate, listed for the report.
      Object.keys(byName).forEach(function (nm) {
        var rs = byName[nm];
        if (nm && rs.length > 1) {
          var keys = {}; rs.forEach(function (r) { keys[assigned[r.path]] = 1; });
          if (Object.keys(keys).length > 1) keepSeparate.push({ name: rs[0].raw.name, count: rs.length });
        }
      });
      students.forEach(function (r) { (groups[assigned[r.path]] = groups[assigned[r.path]] || []).push(r); });
      R.resolution = { groups: groups, queue: queue, keepSeparate: keepSeparate, tierCounts: { A: Object.keys(groups).length, B: queue.length, C: keepSeparate.length } };
      return adapter.put('staging', 'resolution', {
        assigned: assigned, queue: queue, keepSeparate: keepSeparate, tierCounts: R.resolution.tierCounts
      }).then(function () { return checkpoint('resolve'); });
    }

    /* step: event synthesis with deterministic ids + full provenance. */
    function stepSynthesize() {
      var events = [];
      var finQueue = [];     // stored-balance disagreements → human review
      var decisions = [];    // field-level precedence decisions (audit)
      R.quarantinedPaymentsMinor = 0; // every excluded payment is ACCOUNTED (spec 6.3)
      var tomb = {};
      R.staging.forEach(function (r) { if (r.kind === 'tombstones') (r.raw.deletedPaymentIds || []).forEach(function (id) { tomb[id] = 1; }); });

      /* Overlapping sources are the NORM (two fee files, and the master
         snapshot contains copies of everything): the same deterministic
         entity arrives from several places. Two run-level guards make that
         converge instead of failing broker validation:
         - creates-dedupe: a creates-type entity is synthesized ONCE per run
           (first source in deterministic order wins; later copies are the
           same entity by construction — same id — so nothing is lost);
         - exact-dedupe: an event identical in (type, entity, payload) is a
           duplicate import artifact (the same payment via file AND
           snapshot), emitted once — this also keeps the money from double
           counting. Distinct payloads on the same entity still all emit
           (real history: several payments, several doc versions). */
      R.__created = {}; R.__emitted = {};
      function ev(type, entityId, payload, refs, srcId, path) {
        var reg = MD.REGISTRY[type];
        if (reg && reg.creates) {
          if (R.__created[type + '|' + entityId]) return Promise.resolve(null);
          R.__created[type + '|' + entityId] = 1;
        }
        var dk = type + '|' + entityId + '|' + MD.canon(payload);
        if (R.__emitted[dk]) return Promise.resolve(null);
        R.__emitted[dk] = 1;
        return MD.migrationEventId(srcId, path + '#' + type, TRANSFORM_V).then(function (id) {
          return MD.buildEvent(type, entityId, payload, ACTOR, 'bootstrap', {
            id: id, at: runStamp, refs: refs,
            prov: { importRun: opts.runId || 'dry', srcFile: srcId, srcPath: path }
          });
        }).then(function (e) { events.push(e); return e; });
      }

      var chain = Promise.resolve();
      var programmes = {};   // name → { programmeId, intakeId, scheduleTotalMinor }
      // Programmes + intakes + schedules from the fee structure.
      R.staging.filter(function (r) { return r.kind === 'feeStructure'; }).forEach(function (r) {
        chain = chain.then(function () {
          var name = r.raw.name, entry = r.raw.entry || {};
          var total = toMinor(entry.total).minor;
          return Promise.all([detId('prg', 'programme|' + normName(name)), detId('int', 'intake|' + normName(name) + '|legacy')])
            .then(function (ids) {
              programmes[normName(name)] = { programmeId: ids[0], intakeId: ids[1], scheduleTotalMinor: total };
              return ev('programme.defined', ids[0], { name: name }, null, r.srcId, r.path)
                .then(function () { return ev('intake.opened', ids[1], { label: name + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids[0] }, r.srcId, r.path); })
                .then(function () {
                  var terms = Array.isArray(entry.terms) ? entry.terms : [];
                  var termList = terms.map(function (t, i) { return { no: i + 1, amountMinor: toMinor(t).minor }; }).filter(function (t) { return t.amountMinor !== 0; });
                  if (!termList.length) termList = [{ no: 1, amountMinor: total }];
                  return detId('fsc', 'schedule|' + normName(name)).then(function (fid) {
                    return ev('fees.schedule.set', fid, { totalMinor: total, terms: termList }, { intake: ids[1] }, r.srcId, r.path);
                  });
                });
            });
        });
      });

      // People + enrolments + charges from resolved identity groups.
      var groupKeys = Object.keys(R.resolution.groups).sort();
      groupKeys.forEach(function (gk) {
        chain = chain.then(function () {
          var rs = R.resolution.groups[gk];
          // Field precedence inside a group: newest updatedAt wins for bio;
          // every losing value is recorded (audit).
          var best = rs.slice().sort(function (a, b) {
            return String(a.raw.updatedAt || a.raw.createdAt || '') < String(b.raw.updatedAt || b.raw.createdAt || '') ? 1 : -1;
          })[0].raw;
          rs.forEach(function (r) {
            if (r.raw !== best && r.raw.name && r.raw.name !== best.name) decisions.push({ identity: gk, field: 'name', winner: best.name, loser: r.raw.name, rule: 'newest-updatedAt' });
          });
          return detId('per', 'person|' + gk).then(function (personId) {
            var bio = { names: { full: best.name || '(unnamed)' } };
            var dobV = String(best.dateOfBirth || best.dob || '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(dobV)) bio.dob = dobV;
            var nidV = String(best.nationalId || best.trn || '');
            if (nidV) bio.nationalId = nidV;
            bio.contacts = { phone: best.contact || best.phone || '', email: best.email || '', address: best.address || '', city: best.city || '' };
            return ev('person.registered', personId, bio, null, rs[0].srcId, rs[0].path).then(function () {
              // One enrolment per (person, programme) seen in the group.
              var perProg = {};
              rs.forEach(function (r) { var pk = normName(r.raw.skillArea || r.raw.course || 'unassigned'); (perProg[pk] = perProg[pk] || []).push(r); });
              var c2 = Promise.resolve();
              Object.keys(perProg).sort().forEach(function (pk) {
                c2 = c2.then(function () {
                  var recs = perProg[pk], first = recs[0];
                  var prog = programmes[pk];
                  var mkProg = prog ? Promise.resolve(prog)
                    : Promise.all([detId('prg', 'programme|' + pk), detId('int', 'intake|' + pk + '|legacy')]).then(function (ids) {
                        prog = programmes[pk] = { programmeId: ids[0], intakeId: ids[1], scheduleTotalMinor: 0 };
                        return ev('programme.defined', ids[0], { name: first.raw.skillArea || 'Unassigned' }, null, first.srcId, first.path)
                          .then(function () { return ev('intake.opened', ids[1], { label: (first.raw.skillArea || 'Unassigned') + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids[0] }, first.srcId, first.path); })
                          .then(function () { return prog; });
                      });
                  return mkProg.then(function (prog) {
                    return detId('enr', 'enrolment|' + gk + '|' + pk).then(function (enrId) {
                      var enrolDates = recs.map(function (r) { return String(r.raw.enrollmentDate || r.raw.enrolmentDate || ''); });
                      var enrolledAt = enrolDates.filter(function (d) { return /^\d{4}-\d{2}-\d{2}/.test(d); }).map(function (d) { return d.slice(0, 10); })[0] || '2024-04-01';
                      return ev('enrolment.created', enrId, { enrolledAt: enrolledAt }, { person: personId, intake: prog.intakeId }, first.srcId, first.path)
                        .then(function () {
                          // Charges come ONLY from fee-side records (atomic financial source).
                          var feeRec = recs.filter(function (r) { return r.kind === 'student'; })[0];
                          var fee = feeRec ? toMinor(feeRec.raw.tuitionFee).minor : 0;
                          if (fee > 0) return ev('fees.charge.assessed', enrId, { termNo: 1, amountMinor: fee }, null, feeRec.srcId, feeRec.path);
                          return null; // unpriced stays unpriced (matches legacy 'needsFeeDetails')
                        })
                        .then(function () {
                          // LMS presentation scalars (stage/progress/score/gpa/…): preserved
                          // losslessly as a Tier-B roster document — semantic mapping to
                          // enrolment lifecycle events is a later, reviewed step.
                          var lms = recs.filter(function (r) { return r.kind === 'lmsStudent'; })
                            .sort(function (x, y) { return String(x.raw.lastModified || '') < String(y.raw.lastModified || '') ? 1 : -1; })[0];
                          if (!lms) return null;
                          var f = lms.raw, diff = {};
                          ['stage', 'progress', 'score', 'gpa', 'attendance', 'assignments', 'assignmentsTotal',
                           'certNo', 'certDate', 'certCollected', 'instructor', 'notes', 'nqfLevel'].forEach(function (k) {
                            if (f[k] !== undefined && f[k] !== null && f[k] !== '') diff[k] = f[k];
                          });
                          diff.lmsId = f.id;
                          return detId('doc', 'roster|' + gk + '|' + pk).then(function (docId) {
                            return ev('doc.upserted', docId, { kind: 'legacyRoster', diff: diff, reason: 'legacy import' }, null, lms.srcId, lms.path);
                          });
                        })
                        .then(function () {
                          // Legacy stored balances are VERIFICATION FIXTURES, never data.
                          recs.forEach(function (r) {
                            r._enrId = enrId; r._personId = personId;
                          });
                        });
                    });
                  });
                });
              });
              return c2;
            });
          });
        });
      });

      // Payments (atomic records), attached via the student's resolved enrolment.
      chain = chain.then(function () {
        var byStudentId = {};
        R.staging.filter(function (r) { return r.kind === 'student'; }).forEach(function (r) { byStudentId[r.raw.id] = r; });
        var c3 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'payment'; }).forEach(function (r) {
          c3 = c3.then(function () {
            if (tomb[r.raw.id]) return null;                       // tombstoned in legacy: recorded in inventory, not imported
            var stu = byStudentId[r.raw.studentId];
            var m = toMinor(r.raw.amount);
            if (!stu || !stu._enrId) { R.quarantinedPaymentsMinor += m.minor; R.quarantine.push({ srcId: r.srcId, path: r.path, reason: 'payment references unknown student ' + r.raw.studentId }); return null; }
            if (m.minor <= 0) { R.quarantinedPaymentsMinor += m.minor; R.quarantine.push({ srcId: r.srcId, path: r.path, reason: 'non-positive payment amount' }); return null; }
            var date = /^\d{4}-\d{2}-\d{2}/.test(String(r.raw.date || '')) ? String(r.raw.date).slice(0, 10) : runStamp.slice(0, 10);
            var method = { cash: 'cash', cheque: 'cheque', 'bank transfer': 'transfer', transfer: 'transfer', card: 'card' }[String(r.raw.method || '').toLowerCase()] || 'other';
            var pp = { amountMinor: m.minor, method: method, date: date, reference: 'legacy:' + String(r.raw.id) };
            if (r.raw.receiptNumber) pp.legacyReceiptNo = String(r.raw.receiptNumber);
            return ev('fees.payment.recorded', stu._enrId, pp, null, r.srcId, r.path);
          });
        });
        return c3;
      });

      // Tier-B documents: cert/transcript requests (deterministic entity ids
      // shared with the live page's shadow bridge, so both converge).
      chain = chain.then(function () {
        var c4 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'ctrRequest'; }).forEach(function (r) {
          c4 = c4.then(function () {
            return CTR.ctrEntityId(r.raw.id).then(function (docId) {
              return ev('doc.upserted', docId, { kind: CTR.CTR_KIND, diff: CTR.ctrToDocDiff(r.raw), reason: 'legacy import' }, null, r.srcId, r.path);
            });
          });
        });
        return c4;
      });

      // Generic Tier-B documents: lossless imports with deterministic entity
      // ids; semantic elevation (attendance.marked / assessment events) is a
      // later, reviewed step — same posture as the roster scalars.
      var TIERB = [
        { staging: 'legacyAttendance', kind: 'legacyAttendance', key: function (r) { return 'att|' + r.studentId + '|' + r.date + '|' + (r.course || ''); } },
        { staging: 'legacyExamResult', kind: 'legacyExamResult', key: function (r) { return 'examres|' + r.id; } },
        { staging: 'tgGrade', kind: 'transcriptGrade', key: function (r) { return 'tg|' + r.id; } },
        { staging: 'unitCatalog', kind: 'unitCatalog', key: function (r) { return 'qual|' + r.id; } },
        { staging: 'tgProfile', kind: 'transcriptProfile', key: function (r) { return 'tgprofile|' + r.studentId; } }
      ];
      // Cashbook (independent book, D11): quarters, entries, voids, budgets.
      chain = chain.then(function () {
        var c7 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'cbQuarter'; }).forEach(function (r) {
          c7 = c7.then(function () {
            var hasTx = R.staging.some(function (r2) { return r2.kind === 'cbTxn' && r2.raw.fy === r.raw.fy && r2.raw.q === r.raw.q; });
            if (r.raw.openingBalance == null && !hasTx) return null;   // empty blob: nothing to say
            return detId('cbq', 'cbq|' + r.raw.fy + '|Q' + r.raw.q).then(function (qid) {
              return ev('cashbook.quarter.opened', qid, { fy: r.raw.fy, q: r.raw.q, openingBalanceMinor: toMinor(r.raw.openingBalance).minor }, null, r.srcId, r.path);
            });
          });
        });
        R.staging.filter(function (r) { return r.kind === 'cbTxn'; }).forEach(function (r) {
          c7 = c7.then(function () {
            var t = r.raw.txn;
            if (R.cbDeleted[r.raw.fy + '|Q' + r.raw.q + '|' + t.id]) return null; // legacy-deleted: accounted in inventory
            var a2 = cbAmount(t);
            if (a2.klass === 'ambiguous') { R.quarantine.push({ srcId: r.srcId, path: r.path, reason: 'txn has both deposit and payment' }); return null; }
            if (a2.klass === 'zero') { R.quarantine.push({ srcId: r.srcId, path: r.path, reason: 'zero-amount txn' }); return null; }
            return detId('cbe', 'cbe|' + r.raw.fy + '|Q' + r.raw.q + '|' + t.id).then(function (eid) {
              if (a2.klass === 'cancelled-zero') {
                return ev('doc.upserted', eid, { kind: 'cashbookCancelled', diff: Object.assign({}, t), reason: 'legacy import' }, null, r.srcId, r.path);
              }
              var payload = { fy: r.raw.fy, q: r.raw.q, date: /^\d{4}-\d{2}-\d{2}/.test(String(t.date || '')) ? String(t.date).slice(0, 10) : '2024-04-01', kind: a2.klass, categoryId: a2.category, amountMinor: a2.amountMinor };
              if (t.cheque) payload.chequeNo = String(t.cheque);
              if (a2.payee) payload.payee = a2.payee;
              return ev('cashbook.entry.recorded', eid, payload, null, r.srcId, r.path).then(function () {
                if (!a2.voided) return null;
                return ev('cashbook.cheque.voided', eid, { reason: 'legacy voided cheque' }, null, r.srcId, r.path + '#void');
              });
            });
          });
        });
        R.staging.filter(function (r) { return r.kind === 'cbBudget'; }).forEach(function (r) {
          c7 = c7.then(function () {
            var lines = Object.keys(r.raw.budget).map(function (cat) {
              return { categoryId: cat, sectionId: r.raw.sections[cat] || '', amountMinor: toMinor(r.raw.budget[cat]).minor };
            });
            if (!lines.length) return null;
            return detId('bud', 'bud|' + r.raw.fy + '|Q' + r.raw.q).then(function (bid) {
              return ev('budget.set', bid, { fy: r.raw.fy, q: r.raw.q, lines: lines }, null, r.srcId, r.path);
            });
          });
        });
        return c7;
      });

      // Virements: requested (+ decided when legacy status says so).
      chain = chain.then(function () {
        var delV = {};
        R.staging.forEach(function (r) { if (r.kind === 'tombstones') (r.raw.deletedVirementIds || []).forEach(function (id) { delV[id] = 1; }); });
        var c8 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'virement'; }).forEach(function (r) {
          c8 = c8.then(function () {
            var v = r.raw;
            if (delV[v.id]) return null;                               // legacy-deleted virement: accounted
            var lines = (Array.isArray(v.lines) ? v.lines : []).map(function (l) {
              return { fromCategoryId: String(l.fromId || l.fromName || ''), toCategoryId: String(l.toId || l.toName || ''), amountMinor: toMinor(l.amount).minor };
            }).filter(function (l) { return l.fromCategoryId && l.toCategoryId && l.amountMinor > 0; });
            if (!lines.length) { R.quarantine.push({ srcId: r.srcId, path: r.path, reason: 'virement without valid lines' }); return null; }
            var fy = /^\d{4}\/\d{4}$/.test(String(v.fy || '')) ? v.fy : '2024/2025';
            return detId('vir', 'vir|' + v.id).then(function (vid) {
              return ev('virement.requested', vid, { fy: fy, q: parseInt(v.quarter, 10) || 1, lines: lines, requestedBy: String(v.requestedBy || 'unknown') }, null, r.srcId, r.path)
                .then(function () {
                  var st = String(v.status || '');
                  if (st !== 'Approved' && st !== 'Rejected') return null;
                  var p2 = { decision: st.toLowerCase() };
                  if (v.approvalComment) p2.note = String(v.approvalComment);
                  if (v.approvedBy) p2.decidedBy = String(v.approvedBy);
                  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v.approvalDate || ''))) p2.decidedOn = v.approvalDate;
                  return ev('virement.decided', vid, p2, null, r.srcId, r.path + '#decision');
                });
            });
          });
        });
        return c8;
      });

      // Finance documents: legacy numbers are preserved, never reassigned.
      chain = chain.then(function () {
        var c9 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'findoc'; }).forEach(function (r) {
          c9 = c9.then(function () {
            return detId('fdc', 'fdc|' + r.raw.kind + '|' + r.raw.rec.id).then(function (fid) {
              var payload = { kind: r.raw.kind, doc: r.raw.rec };
              if (r.raw.rec.number != null && String(r.raw.rec.number) !== '') payload.number = String(r.raw.rec.number);
              return ev('findoc.issued', fid, payload, null, r.srcId, r.path);
            });
          });
        });
        return c9;
      });

      chain = chain.then(function () {
        var c6 = Promise.resolve();
        R.staging.filter(function (r) { return r.kind === 'tierbDoc'; }).forEach(function (r) {
          c6 = c6.then(function () {
            return detId('doc', r.raw.docKey).then(function (docId) {
              var diff = {};
              Object.keys(r.raw.fields).forEach(function (k) { if (r.raw.fields[k] !== undefined && r.raw.fields[k] !== null) diff[k] = r.raw.fields[k]; });
              return ev('doc.upserted', docId, { kind: r.raw.docKind, diff: diff, reason: 'legacy import' }, null, r.srcId, r.path);
            });
          });
        });
        return c6;
      });
      TIERB.forEach(function (spec) {
        chain = chain.then(function () {
          var c5 = Promise.resolve();
          R.staging.filter(function (r) { return r.kind === spec.staging; }).forEach(function (r) {
            c5 = c5.then(function () {
              return detId('doc', spec.key(r.raw)).then(function (docId) {
                var diff = {};
                Object.keys(r.raw).forEach(function (k) { if (r.raw[k] !== undefined && r.raw[k] !== null) diff[k] = r.raw[k]; });
                return ev('doc.upserted', docId, { kind: spec.kind, diff: diff, reason: 'legacy import' }, null, r.srcId, r.path);
              });
            });
          });
          return c5;
        });
      });

      // The identity adjudication queue becomes CANONICAL documents, one per
      // item with a stable content-derived itemId — so every device folds
      // the same queue, decisions (identity.adjudicated) join by itemId, and
      // the queue survives across days and machines (verdict: resumable).
      chain = chain.then(function () {
        var c8 = Promise.resolve();
        (R.resolution.queue || []).forEach(function (item, idx) {
          c8 = c8.then(function () {
            var ids = (item.records || []).map(function (r) { return String(r.id); }).sort();
            var itemId = 'idq|' + (item.suggestion || 'identity').replace(/\s*\(.*\)$/, '') + '|' + ids.join(',');
            return detId('doc', itemId).then(function (docId) {
              return ev('doc.upserted', docId, {
                kind: 'identityQueueItem',
                diff: { itemId: itemId, tier: item.tier, suggestion: item.suggestion, records: item.records },
                reason: 'legacy import'
              }, null, 'resolution', 'queue[' + idx + ']');
            });
          });
        });
        return c8;
      });

      return chain.then(function () {
        R.events = events; R.finQueue = finQueue; R.decisions = decisions;
        return adapter.put('staging', 'events', events)
          .then(function () { return adapter.put('staging', 'decisions', decisions); })
          .then(function () { return adapter.put('staging', 'quarantine', R.quarantine); })
          .then(function () { return checkpoint('synthesize'); });
      });
    }

    /* step: verify — replay through the REAL broker gates, prove the identities. */
    function stepVerify() {
      var broker = BR.createBroker();
      return broker.append({ events: R.events }, { nowIso: runStamp }).then(function (res) {
        if (!res.ok) {
          var sample = Object.keys(res.errors).slice(0, 5).map(function (id) { return id + ': ' + res.errors[id].join('; '); });
          throw new Error('synthesized events failed broker validation: ' + sample.join(' | '));
        }
        var folded = P.foldAll(broker._state.events);
        var ledgerTotal = 0;
        Object.keys(folded.ledgers).forEach(function (id) { ledgerTotal += folded.ledgers[id].paidMinor; });
        // Financial identity (spec 6.3): imported + explicitly-quarantined ==
        // inventory baseline, to the cent — zero unexplained gaps.
        var quarMinor = R.quarantinedPaymentsMinor || 0;
        var identityHolds = ledgerTotal + quarMinor === R.inventory.totals.paymentsTotalMinor;
        // Stored-balance fixtures: report every disagreement (human review list).
        var balanceDiffs = [];
        R.staging.filter(function (r) { return r.kind === 'student' && r._enrId && r.raw.balance != null; }).forEach(function (r) {
          var stored = toMinor(r.raw.balance).minor;
          var led = folded.ledgers[r._enrId];
          var foldBal = led ? led.balanceMinor : 0;
          if (stored !== foldBal) balanceDiffs.push({ studentId: r.raw.id, name: r.raw.name, enrolmentId: r._enrId, storedBalanceMinor: stored, foldedBalanceMinor: foldBal, deltaMinor: foldBal - stored });
        });
        var qIncome = 0, qExpense = 0;
        Object.keys(folded.quarters).forEach(function (k) { qIncome += folded.quarters[k].incomeMinor; qExpense += folded.quarters[k].expenseMinor; });
        var cashbookIdentityHolds = qIncome === R.inventory.totals.cashbookIncomeMinor && qExpense === R.inventory.totals.cashbookExpenseMinor;
        R.verification = {
          brokerAccepted: R.events.length,
          cashbookIncomeMinor: qIncome, cashbookExpenseMinor: qExpense,
          cashbookIdentityHolds: cashbookIdentityHolds,
          paymentsTotalMinor: ledgerTotal,
          quarantinedPaymentsMinor: quarMinor,
          inventoryTotalMinor: R.inventory.totals.paymentsTotalMinor,
          financialIdentityHolds: identityHolds,
          storedBalanceDisagreements: balanceDiffs.length,
          balanceDiffSample: balanceDiffs.slice(0, 20),
          chainVerified: null
        };
        return broker.verifyChain().then(function (okc) {
          R.verification.chainVerified = okc;
          return adapter.put('staging', 'verification', R.verification)
            .then(function () { return checkpoint('verify'); });
        });
      });
    }

    function report() {
      return {
        dryRun: dryRun, runStamp: runStamp, transformV: TRANSFORM_V,
        inventory: R.inventory,
        tierCounts: R.resolution.tierCounts,
        adjudicationQueue: R.resolution.queue,
        keepSeparate: R.resolution.keepSeparate,
        decisions: R.decisions,
        quarantine: R.quarantine,
        events: { count: R.events.length, byType: R.events.reduce(function (m, e) { m[e.type] = (m[e.type] || 0) + 1; return m; }, {}) },
        verification: R.verification
      };
    }

    /* resume: rebuild working state from staging, continue after the checkpoint. */
    var ORDER = ['extract', 'resolve', 'synthesize', 'verify'];
    var STEPS = { extract: stepExtract, resolve: stepResolve, synthesize: stepSynthesize, verify: stepVerify };
    function rehydrate(upTo) {
      // Steps are deterministic functions of (sources, runStamp); re-running the
      // completed prefix rebuilds identical in-memory state — the checkpoint
      // only tells us where LIVE work resumes (docs/04 §6: idempotent resume).
      var chain = Promise.resolve();
      for (var i = 0; i <= ORDER.indexOf(upTo); i++) (function (step) {
        chain = chain.then(function () { var f = failAfter; failAfter = null; return STEPS[step]().then(function () { failAfter = f; }); });
      })(ORDER[i]);
      return chain;
    }

    return loadCheckpoint().then(function (cp) {
      var startIdx = 0, pre = Promise.resolve();
      if (cp && cp.runStamp === runStamp && cp.transformV === TRANSFORM_V) {
        startIdx = ORDER.indexOf(cp.step) + 1;
        pre = rehydrate(cp.step);
      }
      var chain = pre;
      for (var i = startIdx; i < ORDER.length; i++) (function (step) {
        chain = chain.then(function () { return STEPS[step](); });
      })(ORDER[i]);
      return chain.then(function () {
        var rep = report();
        var fin = dryRun ? Promise.resolve() : adapter.put('out', 'events', R.events).then(function () { return adapter.put('out', 'report', rep); });
        return fin.then(function () { return rep; });
      });
    });
  }

  /* File-name → extractor kind. The SINGLE source of truth shared by the
     operator CLI, the in-app "Export local stores" filename convention
     (admin-model), and the tests that pin the two together. Every legacy
     source gets an entry here as its extractor is implemented; anything
     unmatched is REPORTED by the CLI, never silently ignored (spec 6.2). */
  var KIND_BY_NAME = [
    { re: /school[-_ ]?fees?.*\.json$/i, kind: 'schoolfee-pagecloud' },
    { re: /CESTIS_School_Fees\.json$/i, kind: 'schoolfee-pagecloud' },
    { re: /school_fee_management_system\.json$/i, kind: 'schoolfee-pagecloud' },
    { re: /Transcript_Requests\.json$/i, kind: 'transcript-requests-pagecloud' },
    { re: /Student_Progress\.json$/i, kind: 'student-progress-pagecloud' },
    { re: /Transcript_Grades\.json$/i, kind: 'transcript-grades-pagecloud' },
    { re: /CESTIS_LMS_BACKUP\.json$/i, kind: 'lms-backup' },
    { re: /CESTIS_LMS_Dashboard\.json$/i, kind: 'lms-backup' },
    { re: /master-snapshot.*\.json$/i, kind: 'master-snapshot' },
    { re: /CESTIS_ALL_DATA\.json$/i, kind: 'master-snapshot' },
    { re: /CESTIS_(Cashbook|Virement_Requests|Finance_Invoices|Finance_Quotes|Finance_PurchaseOrders|Payments_Invoices|Payment_Vouchers|Staff_Payslips|Staff_TimeClock)\.json$/i, kind: 'finance-staff-pagecloud' }
  ];
  function kindForName(name) {
    var m = KIND_BY_NAME.find(function (k) { return k.re.test(name); });
    return m ? m.kind : null;
  }

  return { runBootstrap: runBootstrap, EXTRACTORS: EXTRACTORS, KIND_BY_NAME: KIND_BY_NAME, kindForName: kindForName, _toMinor: toMinor };
});
