/* MegaData — School-Fee bridge model (stage 1 of the fee-page refactor).
   Money-bearing bridge: legacy fee records → real ledger events.
     - identity key matches the bootstrap resolver (link-aware, SF- twin
       heuristic); colliding keys with conflicting names are bridged
       SEPARATELY under the bootstrap's split keys and reported for
       adjudication — never merged (P6), never left unbridged.
     - payments join by reference 'legacy:<PAYid>'; a legacy in-place edit
       becomes reversal + re-record (supersession, never mutation); a legacy
       deletion becomes a reversal. All creation/reversal event ids are
       deterministic, so any number of devices converge (P10).
     - reconcileFees() is the docs/04 §8 shadow comparator: both sides
       recomputed FROM ATOMS, per trainee, to the cent. */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = Object.assign({}, require('../schemas.js'), require('./roster-model.js'));
    module.exports = factory(deps);
  } else {
    deps = root.MegaData;
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MG) {
  'use strict';

  function toMinor(x) { return Math.round((Number(x) || 0) * 100); }
  function feeIdentityKey(rec) {
    var id = String(rec.id || '');
    var lms = rec.lmsId || (id.indexOf('SF-') === 0 ? id.slice(3) : null);
    return 'id:' + String(lms || id);
  }
  function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // Partition legacy students. A shared id-link whose records' names disagree
  // is a data defect: those records are bridged SEPARATELY under per-record
  // split keys — the EXACT key format the bootstrap resolver uses
  // ('id:<recordId>#student'), so bridge and bootstrap land on the same
  // entities — and the group is reported for adjudication (P6). Nothing is
  // left unbridged.
  function feePartition(students) {
    var byKey = {}, safe = [], conflicted = [];
    (students || []).forEach(function (r) { if (r && r.id) (byKey[feeIdentityKey(r)] = byKey[feeIdentityKey(r)] || []).push(r); });
    Object.keys(byKey).forEach(function (k) {
      var rs = byKey[k], names = {};
      rs.forEach(function (r) { var n = normName(r.name); if (n) names[n] = 1; });
      if (rs.length > 1 && Object.keys(names).length > 1) {
        conflicted.push({ key: k, records: rs.map(function (r) { return { id: r.id, name: r.name }; }) });
        rs.forEach(function (r) { safe.push({ rec: r, key: 'id:' + String(r.id) + '#student' }); });
      } else {
        rs.forEach(function (r) { safe.push({ rec: r, key: k }); });
      }
    });
    return { safe: safe, skipped: conflicted };
  }

  function ledgerPaymentByRef(ledger, payId) {
    var ref = 'legacy:' + String(payId);
    var live = null, any = null;
    (ledger.entries || []).forEach(function (e) {
      if (e.kind === 'payment' && e.reference === ref) { any = e; if (!e.reversedBy) live = e; }
    });
    return { live: live, any: any };
  }

  // Bridge ONE legacy fee student (+ their payments) into the DAL.
  function feeBridgeOne(dal, item, paymentsByStudent, deletedIds) {
    var rec = item.rec, key = item.key;
    return MG.identityIds(key, rec.skillArea).then(function (ids) {
      var steps = [];
      if (!dal.get('programme', ids.programmeId)) steps.push(['programme.defined', ids.programmeId, { name: rec.skillArea || 'Unassigned' }, null, 'programme|' + ids.progNorm]);
      if (!dal.get('intake', ids.intakeId)) steps.push(['intake.opened', ids.intakeId, { label: (rec.skillArea || 'Unassigned') + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids.programmeId }, 'intake|' + ids.progNorm]);
      if (!dal.get('person', ids.personId)) steps.push(['person.registered', ids.personId, MG.lmsBio(rec), null, 'person|' + key]);
      if (!dal.get('enrolment', ids.enrolmentId)) {
        var at = /^\d{4}-\d{2}-\d{2}/.test(String(rec.enrollmentDate || '')) ? String(rec.enrollmentDate).slice(0, 10) : '2024-04-01';
        steps.push(['enrolment.created', ids.enrolmentId, { enrolledAt: at }, { person: ids.personId, intake: ids.intakeId }, 'enrolment|' + key + '|' + ids.progNorm]);
      }
      function run(list) {
        return list.reduce(function (pr, st) {
          return pr.then(function () {
            return MG.bridgeEventId(st[4]).then(function (evtId) {
              return dal._accept(st[0], st[1], st[2], { id: evtId, refs: st[3] || undefined, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: rec.id } })
                .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
            });
          });
        }, Promise.resolve());
      }
      return run(steps).then(function () {
        // Charges / tuition drift: charged+adjusted must equal legacy tuition.
        var ledger = dal.getLedger(ids.enrolmentId);
        var tuition = toMinor(rec.tuitionFee);
        var priced = ledger.chargedMinor + ledger.adjustedMinor;
        if (tuition > 0 && priced === 0) {
          return MG.bridgeEventId('charge|' + key + '|' + ids.progNorm + '|' + tuition).then(function (evtId) {
            return dal._accept('fees.charge.assessed', ids.enrolmentId, { termNo: 1, amountMinor: tuition }, { id: evtId, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: rec.id } });
          });
        }
        if (tuition > 0 && priced !== tuition) {
          var delta = tuition - priced;
          return MG.bridgeEventId('tuadj|' + key + '|' + ids.progNorm + '|' + tuition).then(function (evtId) {
            return dal._accept('fees.adjustment.applied', ids.enrolmentId, { amountMinor: delta, kind: 'correction', reason: 'legacy tuition change' }, { id: evtId, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: rec.id } });
          });
        }
        return null;
      }).then(function () {
        // Payments: record / supersede / reverse, all deterministic.
        var pays = paymentsByStudent[rec.id] || [];
        return pays.reduce(function (pr, p) {
          return pr.then(function () {
            var minor = toMinor(p.amount);
            if (minor <= 0) return null;                               // bootstrap-quarantine class; not bridged
            var ledger = dal.getLedger(ids.enrolmentId);
            var found = ledgerPaymentByRef(ledger, p.id);
            var deleted = deletedIds.indexOf(p.id) !== -1;
            if (deleted) {
              if (!found.live) return null;                            // nothing live to reverse
              return MG.bridgeEventId('payrev|' + found.live.eventId).then(function (evtId) {
                return dal._accept('fees.payment.reversed', ids.enrolmentId, { paymentEventId: found.live.eventId, reason: 'legacy deletion' }, { id: evtId, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: p.id } });
              });
            }
            var date = /^\d{4}-\d{2}-\d{2}/.test(String(p.date || '')) ? String(p.date).slice(0, 10) : '2024-04-01';
            var method = { cash: 'cash', cheque: 'cheque', 'bank transfer': 'transfer', transfer: 'transfer', card: 'card' }[String(p.method || '').toLowerCase()] || 'other';
            var payload = { amountMinor: minor, method: method, date: date, reference: 'legacy:' + String(p.id) };
            if (p.receiptNumber) payload.legacyReceiptNo = String(p.receiptNumber);
            if (found.live && found.live.amountMinor === minor && found.live.date === date) return null; // in sync
            var chain = Promise.resolve();
            if (found.live) {                                          // legacy in-place edit → supersede
              chain = chain.then(function () {
                return MG.bridgeEventId('payrev|' + found.live.eventId).then(function (evtId) {
                  return dal._accept('fees.payment.reversed', ids.enrolmentId, { paymentEventId: found.live.eventId, reason: 'legacy edit superseded' }, { id: evtId, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: p.id } });
                });
              });
            }
            return chain.then(function () {
              return MG.bridgeEventId('pay|' + p.id + '|' + minor + '|' + date).then(function (evtId) {
                return dal._accept('fees.payment.recorded', ids.enrolmentId, payload, { id: evtId, prov: { importRun: 'bridge', srcFile: 'School.Fee', srcPath: p.id } });
              });
            });
          });
        }, Promise.resolve());
      }).then(function () { return ids; });
    });
  }

  function feeBridgeAll(dal, legacy) {
    var part = feePartition(legacy.students);
    var paysBy = {};
    (legacy.payments || []).forEach(function (p) { if (p && p.id && p.studentId) (paysBy[p.studentId] = paysBy[p.studentId] || []).push(p); });
    var deleted = legacy.deletedPaymentIds || [];
    return part.safe.reduce(function (pr, item) { return pr.then(function () { return feeBridgeOne(dal, item, paysBy, deleted); }); }, Promise.resolve())
      .then(function () { return { bridged: part.safe.length, skipped: part.skipped }; });
  }

  /* The shadow comparator (docs/04 §8): both sides from atoms, to the cent. */
  function reconcileFees(dal, legacy) {
    var part = feePartition(legacy.students);
    var deleted = {};
    (legacy.deletedPaymentIds || []).forEach(function (id) { deleted[id] = 1; });
    var paysBy = {};
    (legacy.payments || []).forEach(function (p) { if (p && p.id && p.studentId && !deleted[p.id]) (paysBy[p.studentId] = paysBy[p.studentId] || []).push(p); });
    var rows = [], totalLegacyPaid = 0, totalMegaPaid = 0;
    return part.safe.reduce(function (pr, item) {
      return pr.then(function () {
        return MG.identityIds(item.key, item.rec.skillArea).then(function (ids) {
          var legacyPaid = (paysBy[item.rec.id] || []).reduce(function (s2, p) { return s2 + Math.max(0, toMinor(p.amount)); }, 0);
          var legacyBal = toMinor(item.rec.tuitionFee) - legacyPaid;
          var ledger = dal.getLedger(ids.enrolmentId);
          totalLegacyPaid += legacyPaid; totalMegaPaid += ledger.paidMinor;
          if (legacyBal !== ledger.balanceMinor || legacyPaid !== ledger.paidMinor) {
            rows.push({ studentId: item.rec.id, name: item.rec.name, enrolmentId: ids.enrolmentId, legacyBalanceMinor: legacyBal, megaBalanceMinor: ledger.balanceMinor, legacyPaidMinor: legacyPaid, megaPaidMinor: ledger.paidMinor });
          }
        });
      });
    }, Promise.resolve()).then(function () {
      return {
        ok: rows.length === 0 && totalLegacyPaid === totalMegaPaid,
        mismatches: rows, skipped: part.skipped,
        totalLegacyPaidMinor: totalLegacyPaid, totalMegaPaidMinor: totalMegaPaid,
        compared: part.safe.length
      };
    });
  }

  return { feeIdentityKey: feeIdentityKey, feePartition: feePartition, feeBridgeAll: feeBridgeAll, feeBridgeOne: feeBridgeOne, reconcileFees: reconcileFees, _feeToMinor: toMinor };
});
