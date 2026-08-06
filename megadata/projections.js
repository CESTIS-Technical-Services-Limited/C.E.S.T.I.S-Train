/* MegaData — projection registry (Phase 5 step 4, built with step 3).
   Pure, deterministic folds over the event log (P7): no wall-clock, no
   randomness, no locale, no floats. Every projection is disposable and is
   recomputed from (snapshot +) events; nothing here is ever an input to
   canonical state (P9). Order: acked events by seq, then local pending in
   local append order — after sync, every device folds the identical list. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function sortForFold(events) {
    return events.slice().sort(function (a, b) {
      var sa = a.seq != null ? a.seq : Infinity, sb = b.seq != null ? b.seq : Infinity;
      if (sa !== sb) return sa - sb;
      return (a._localIdx || 0) - (b._localIdx || 0);
    });
  }

  /* One shared entity fold: creates + Tier B doc diffs + corrections +
     tombstones/merges. Everything else reads entities from here. */
  function foldEntities(events) {
    var byKind = {};
    function ent(kind, id) {
      var k = byKind[kind] = byKind[kind] || {};
      return k[id] = k[id] || { id: id, kind: kind, alive: true, fields: {}, lastEventSeq: null };
    }
    events.forEach(function (evt) {
      var kind = evt.entity.kind, id = evt.entity.id;
      var e = ent(kind, id);
      e.lastEventSeq = evt.seq != null ? evt.seq : e.lastEventSeq;
      switch (evt.type) {
        case 'person.registered': Object.assign(e.fields, evt.payload); break;
        case 'programme.defined': Object.assign(e.fields, evt.payload); break;
        case 'intake.opened': Object.assign(e.fields, evt.payload, { programmeId: evt.refs.programme }); break;
        case 'enrolment.created': Object.assign(e.fields, evt.payload, { personId: evt.refs.person, intakeId: evt.refs.intake, status: 'active' }); break;
        case 'enrolment.statusChanged': e.fields.status = evt.payload.to; break;
        case 'enrolment.transferred': e.fields.intakeId = evt.refs.toIntake; break;
        case 'person.corrected':
        case 'time.corrected':
        case 'doc.upserted': {
          var diff = evt.payload.diff || {};
          Object.keys(diff).forEach(function (f) {
            // Plain value assignment — arrays are DATA here (a catalogue's
            // units, a programme's aliases). An [old,new] pair convention
            // once lived on this line and silently truncated every legit
            // array field to undefined; nothing ever emitted pairs.
            e.fields[f] = diff[f];
          });
          if (evt.type === 'doc.upserted') e.fields.docKind = evt.payload.kind;
          break;
        }
        case 'person.tombstoned': case 'doc.tombstoned': e.alive = false; e.tombstonedBy = evt.id; break;
        case 'person.merged': {
          var loser = ent('person', evt.payload.loserId);
          loser.alive = false; loser.mergedInto = id;
          break;
        }
        case 'fees.schedule.set': Object.assign(e.fields, evt.payload, { intakeId: evt.refs.intake }); break;
        case 'findoc.issued': Object.assign(e.fields, { kind: evt.payload.kind, doc: evt.payload.doc, number: (evt.assigned && evt.assigned.number) || evt.payload.number || null, status: 'issued' }); break;
        case 'findoc.superseded': {
          var d2 = evt.payload.diff || {};
          e.fields.doc = Object.assign({}, e.fields.doc);
          Object.keys(d2).forEach(function (f) { e.fields.doc[f] = Array.isArray(d2[f]) ? d2[f][1] : d2[f]; });
          (e.fields.revisions = e.fields.revisions || []).push({ by: evt.id, reason: evt.payload.reason });
          break;
        }
        case 'findoc.voided': e.fields.status = 'voided'; break;
        case 'time.clockedIn': Object.assign(e.fields, { staffId: evt.refs.staff, in: evt.payload.at, breaks: [] }); break;
        case 'time.clockedOut': e.fields.out = evt.payload.at; break;
      }
    });
    return byKind;
  }

  /* Fee ledger per enrolment (P4): entries + folds; balances are NEVER stored. */
  function foldLedgers(events) {
    var led = {}; // enrolmentId → { entries[], chargedMinor, paidMinor, adjustedMinor, balanceMinor, status, suspects[] }
    function L(id) {
      return led[id] = led[id] || { enrolmentId: id, entries: [], chargedMinor: 0, paidMinor: 0, adjustedMinor: 0, suspects: [] };
    }
    var reversed = {};   // paymentEventId → reversal evt id
    events.forEach(function (evt) {
      if (evt.type === 'fees.payment.reversed') reversed[evt.payload.paymentEventId] = evt.id;
    });
    events.forEach(function (evt) {
      var id = evt.entity.id, l;
      switch (evt.type) {
        case 'fees.charge.assessed':
          l = L(id); l.chargedMinor += evt.payload.amountMinor;
          l.entries.push({ eventId: evt.id, seq: evt.seq, kind: 'charge', amountMinor: evt.payload.amountMinor, date: evt.payload.dueDate || null, termNo: evt.payload.termNo });
          break;
        case 'fees.payment.recorded': {
          l = L(id);
          var rev = reversed[evt.id] || null;
          if (!rev) l.paidMinor += evt.payload.amountMinor;
          l.entries.push({
            eventId: evt.id, seq: evt.seq, kind: 'payment', amountMinor: evt.payload.amountMinor,
            date: evt.payload.date, method: evt.payload.method,
            reference: evt.payload.reference || null, legacyReceiptNo: evt.payload.legacyReceiptNo || null,
            receiptNo: (evt.assigned && evt.assigned.receiptNo) || evt.payload.receiptNo || null,
            pendingNumber: !(evt.assigned && evt.assigned.receiptNo) && !evt.payload.receiptNo && !evt.payload.legacyReceiptNo,
            reversedBy: rev, device: evt.actor && evt.actor.device || null
          });
          break;
        }
        case 'fees.payment.reversed':
          l = L(id);
          l.entries.push({ eventId: evt.id, seq: evt.seq, kind: 'reversal', of: evt.payload.paymentEventId, reason: evt.payload.reason });
          break;
        case 'fees.adjustment.applied':
          l = L(id); l.adjustedMinor += evt.payload.amountMinor;
          l.entries.push({ eventId: evt.id, seq: evt.seq, kind: 'adjustment', amountMinor: evt.payload.amountMinor, adjKind: evt.payload.kind, reason: evt.payload.reason });
          break;
      }
    });
    Object.keys(led).forEach(function (id) {
      var l = led[id];
      l.balanceMinor = l.chargedMinor + l.adjustedMinor - l.paidMinor;
      l.status = l.chargedMinor + l.adjustedMinor === 0 ? 'not-priced'
        : l.balanceMinor <= 0 ? 'paid'
        : l.paidMinor > 0 ? 'partial' : 'outstanding';
      // Duplicate-suspect rule (docs/02 §11): same enrolment, same amount, same
      // date, DIFFERENT devices → a human decides; never auto-resolved.
      var live = l.entries.filter(function (e) { return e.kind === 'payment' && !e.reversedBy; });
      for (var i = 0; i < live.length; i++) for (var j = i + 1; j < live.length; j++) {
        var a = live[i], b = live[j];
        if (a.amountMinor === b.amountMinor && a.date === b.date && a.device !== b.device) {
          l.suspects.push({ kind: 'duplicate-payment', a: a.eventId, b: b.eventId, amountMinor: a.amountMinor, date: a.date });
        }
      }
    });
    return led;
  }

  /* Cashbook quarters (independent book — client decision D11). */
  function foldQuarters(events) {
    var q = {}; // 'FY|Q' → { fy, q, openingBalanceMinor, entries[], incomeMinor, expenseMinor, closingMinor }
    function Q(fy, qq) {
      var k = fy + '|Q' + qq;
      return q[k] = q[k] || { fy: fy, q: qq, openingBalanceMinor: 0, entries: [], incomeMinor: 0, expenseMinor: 0 };
    }
    var voided = {}; // entityId → void evt
    events.forEach(function (evt) { if (evt.type === 'cashbook.cheque.voided') voided[evt.entity.id] = evt; });
    events.forEach(function (evt) {
      if (evt.type === 'cashbook.quarter.opened') Q(evt.payload.fy, evt.payload.q).openingBalanceMinor = evt.payload.openingBalanceMinor;
      if (evt.type === 'cashbook.entry.recorded') {
        var b = Q(evt.payload.fy, evt.payload.q);
        var isVoid = !!voided[evt.entity.id];
        b.entries.push({
          eventId: evt.id, entityId: evt.entity.id, seq: evt.seq, date: evt.payload.date,
          kind: evt.payload.kind, categoryId: evt.payload.categoryId, amountMinor: evt.payload.amountMinor,
          chequeNo: evt.payload.chequeNo || null, payee: evt.payload.payee || null,
          voided: isVoid, voidReason: isVoid ? voided[evt.entity.id].payload.reason : null
        });
        if (!isVoid) {
          if (evt.payload.kind === 'income') b.incomeMinor += evt.payload.amountMinor;
          else b.expenseMinor += evt.payload.amountMinor;
        }
      }
    });
    Object.keys(q).forEach(function (k) {
      q[k].closingMinor = q[k].openingBalanceMinor + q[k].incomeMinor - q[k].expenseMinor;
    });
    return q;
  }

  /* Attendance per enrolment, corrections applied (last correction per mark wins). */
  function foldAttendance(events) {
    var marks = {}; // markEventId → { enrolmentId, date, status }
    events.forEach(function (evt) {
      if (evt.type === 'attendance.marked') marks[evt.id] = { enrolmentId: evt.entity.id, date: evt.payload.date, status: evt.payload.status };
      if (evt.type === 'attendance.corrected' && marks[evt.payload.markEventId]) marks[evt.payload.markEventId].status = evt.payload.newStatus;
    });
    var byEnrolment = {};
    Object.keys(marks).forEach(function (mid) {
      var m = marks[mid];
      var t = byEnrolment[m.enrolmentId] = byEnrolment[m.enrolmentId] || { enrolmentId: m.enrolmentId, present: 0, absent: 0, late: 0, days: {} };
      t.days[m.date] = m.status;
    });
    Object.keys(byEnrolment).forEach(function (id) {
      var t = byEnrolment[id];
      Object.keys(t.days).forEach(function (d) { t[t.days[d]]++; });
    });
    return byEnrolment;
  }

  /* The registry the DAL exposes via project(name, params). */
  var PROJECTIONS = {
    entities: function (S, p) { return p && p.kind ? (S.entities[p.kind] || {}) : S.entities; },
    ledger: function (S, p) { return S.ledgers[p.enrolmentId] || { enrolmentId: p.enrolmentId, entries: [], chargedMinor: 0, paidMinor: 0, adjustedMinor: 0, balanceMinor: 0, status: 'not-priced', suspects: [] }; },
    balances: function (S) {
      return Object.keys(S.ledgers).map(function (id) {
        var l = S.ledgers[id];
        return { enrolmentId: id, balanceMinor: l.balanceMinor, paidMinor: l.paidMinor, chargedMinor: l.chargedMinor, status: l.status };
      }).sort(function (a, b) { return a.enrolmentId < b.enrolmentId ? -1 : 1; });
    },
    quarter: function (S, p) { return S.quarters[p.fy + '|Q' + p.q] || { fy: p.fy, q: p.q, openingBalanceMinor: 0, entries: [], incomeMinor: 0, expenseMinor: 0, closingMinor: 0 }; },
    attendanceTotals: function (S, p) { return S.attendance[p.enrolmentId] || { enrolmentId: p.enrolmentId, present: 0, absent: 0, late: 0, days: {} }; },
    roster: function (S) {
      var people = S.entities.person || {}, enr = S.entities.enrolment || {};
      return Object.keys(enr).filter(function (id) { return enr[id].alive; }).map(function (id) {
        var e = enr[id], who = people[e.fields.personId] || { fields: { names: { full: '?' } }, alive: false };
        var resolved = who; // follow merges to the winner
        while (resolved && resolved.mergedInto) resolved = people[resolved.mergedInto];
        return {
          enrolmentId: id, personId: resolved ? resolved.id : e.fields.personId,
          name: resolved && resolved.fields.names ? resolved.fields.names.full : '?',
          intakeId: e.fields.intakeId, status: e.fields.status
        };
      }).sort(function (a, b) { return a.enrolmentId < b.enrolmentId ? -1 : 1; });
    },
    adjudications: function (S) {
      var out = [];
      Object.keys(S.ledgers).forEach(function (id) {
        S.ledgers[id].suspects.forEach(function (s) { out.push(Object.assign({ enrolmentId: id }, s)); });
      });
      return out.sort(function (a, b) { return (b.amountMinor || 0) - (a.amountMinor || 0); }); // money-at-stake first
    }
  };

  function foldAll(events) {
    var ordered = sortForFold(events);
    return {
      entities: foldEntities(ordered),
      ledgers: foldLedgers(ordered),
      quarters: foldQuarters(ordered),
      attendance: foldAttendance(ordered)
    };
  }

  return { foldAll: foldAll, PROJECTIONS: PROJECTIONS, sortForFold: sortForFold };
});
