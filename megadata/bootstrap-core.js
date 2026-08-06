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
    deps = { MD: require('./schemas.js'), BR: require('./broker-core.js'), P: require('./projections.js') };
    module.exports = factory(deps);
  } else {
    deps = { MD: root.MegaData, BR: root.MegaData, P: root.MegaData };
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (deps) {
  'use strict';
  var MD = deps.MD, BR = deps.BR, P = deps.P;
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
        var totalMinor = 0, imprecise = 0;
        var tomb = {};
        R.staging.forEach(function (r) { if (r.kind === 'tombstones') (r.raw.deletedPaymentIds || []).forEach(function (id) { tomb[id] = 1; }); });
        R.staging.forEach(function (r) {
          if (r.kind === 'payment' && !tomb[r.raw.id]) {
            var m = toMinor(r.raw.amount);
            totalMinor += m.minor; if (!m.exact) imprecise++;
          }
        });
        R.inventory.totals = {
          students: R.staging.filter(function (r) { return r.kind === 'student'; }).length,
          payments: R.staging.filter(function (r) { return r.kind === 'payment' && !tomb[r.raw.id]; }).length,
          tombstonedPayments: Object.keys(tomb).length,
          paymentsTotalMinor: totalMinor, floatPrecisionNotes: imprecise,
          quarantined: R.quarantine.length
        };
        return adapter.put('staging', 'all', R.staging)
          .then(function () { return adapter.put('staging', 'quarantine', R.quarantine); })
          .then(function () { return adapter.put('staging', 'inventory', R.inventory); })
          .then(function () { return checkpoint('extract'); });
      });
    }

    /* step: identity resolution (docs/04 §5 tiers; P6: fuzzy never merges). */
    function stepResolve() {
      var students = R.staging.filter(function (r) { return r.kind === 'student'; });
      var groups = {};       // identityKey → [records]
      var queue = [];        // tier-B human items
      var keepSeparate = []; // tier-C
      var byNationalId = {}, byNameDob = {}, byName = {};
      students.forEach(function (r) {
        var s = r.raw;
        var nid = String(s.nationalId || '').trim();
        var nm = normName(s.name), dob = String(s.dateOfBirth || '').trim();
        (byName[nm] = byName[nm] || []).push(r);
        if (nid) (byNationalId[nid] = byNationalId[nid] || []).push(r);
        else if (nm && dob) (byNameDob[nm + '|' + dob] = byNameDob[nm + '|' + dob] || []).push(r);
      });
      var assigned = {};     // staging path → identityKey
      // Tier A: exact record id (same id across sources IS the same record),
      // or exact non-empty nationalId.
      students.forEach(function (r) { assigned[r.path] = 'id:' + r.raw.id; });
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

      function ev(type, entityId, payload, refs, srcId, path) {
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
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(best.dateOfBirth || ''))) bio.dob = best.dateOfBirth;
            if (best.nationalId) bio.nationalId = String(best.nationalId);
            bio.contacts = { phone: best.contact || '', email: best.email || '', address: best.address || '', city: best.city || '' };
            return ev('person.registered', personId, bio, null, rs[0].srcId, rs[0].path).then(function () {
              // One enrolment per (person, programme) seen in the group.
              var perProg = {};
              rs.forEach(function (r) { var pk = normName(r.raw.skillArea || 'unassigned'); (perProg[pk] = perProg[pk] || []).push(r); });
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
                      var enrolledAt = /^\d{4}-\d{2}-\d{2}/.test(String(first.raw.enrollmentDate || '')) ? String(first.raw.enrollmentDate).slice(0, 10) : '2024-04-01';
                      return ev('enrolment.created', enrId, { enrolledAt: enrolledAt }, { person: personId, intake: prog.intakeId }, first.srcId, first.path)
                        .then(function () {
                          // Charges: legacy tuitionFee is the priced amount for THIS trainee.
                          var fee = toMinor(first.raw.tuitionFee).minor;
                          if (fee > 0) return ev('fees.charge.assessed', enrId, { termNo: 1, amountMinor: fee }, null, first.srcId, first.path);
                          return null; // unpriced stays unpriced (matches legacy 'needsFeeDetails')
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
            return ev('fees.payment.recorded', stu._enrId,
              { amountMinor: m.minor, method: method, date: date, reference: String(r.raw.receiptNumber || '') },
              null, r.srcId, r.path);
          });
        });
        return c3;
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
        R.verification = {
          brokerAccepted: R.events.length,
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

  return { runBootstrap: runBootstrap, EXTRACTORS: EXTRACTORS, _toMinor: toMinor };
});
