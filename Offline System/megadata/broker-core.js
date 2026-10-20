/* MegaData — broker core (Phase 5 step 2). Pure logic, no I/O.
   This exact module runs in three hosts with different glue:
     1. Node local broker (tests, and the Offline System's LAN server later);
     2. the Apps Script web app (step 7 glue; LockService + Drive around it);
     3. the migration CLI (bootstrap appends through the same gates).
   Contract: docs/02-MEGADATA-ARCHITECTURE.md §9. It is the ONLY thing that
   assigns `seq` and number series, and NOTHING invalid is ever appended (P8).
   Everything here is deterministic given (state, events, now) — replays and
   retries converge (P10): a duplicate event id returns the ORIGINAL ack. */
(function (root, factory) {
  var MD = (typeof module !== 'undefined' && module.exports) ? require('./schemas.js') : root.MegaData;
  var api = factory(MD);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (MD) {
  'use strict';

  var SERIES_PREFIX = { receipt: 'R-', cert: 'CT-', invoice: 'INV-', quote: 'QUO-', po: 'PO-', voucher: 'VOU-' };
  function pad6(n) { return String(n).padStart(6, '0'); }

  // Entity kinds that auto-vivify on first event (Tier B docs, queue items,
  // and budgets — budget.set is a replace whose first set brings the
  // quarter's budget into existence).
  var AUTOVIVIFY = { doc: 1, adjudication: 1, budget: 1 };
  // Enrolment statuses that release a person for tombstoning.
  var RELEASED = { withdrawn: 1, completed: 1 };

  function createBrokerState() {
    return {
      seq: 0,
      events: [],                 // acked events in seq order (the log)
      ackById: {},                // eventId → { seq, assigned }
      series: { receipt: 0, cert: 0, invoice: 0, quote: 0, po: 0, voucher: 0 },
      chain: 'genesis',           // running hash chain over event hashes (P11)
      segments: [],               // { n, firstSeq, lastSeq, count, prevChain, chain }
      gates: { bootstrap: 'not-started', maintenance: false },
      index: {
        entities: {},             // kind → id → { alive, mergedInto?, status? }
        personEnrolments: {},     // personId → [enrolmentId]
        payments: {},             // paymentEventId → { enrolmentId, amountMinor, reversedBy }
        eventsById: {}            // eventId → { type, entityId } (for supersession refs)
      }
    };
  }

  function ent(state, kind, id) {
    var k = state.index.entities[kind];
    return (k && k[id]) || null;
  }
  function putEnt(state, kind, id, rec) {
    (state.index.entities[kind] = state.index.entities[kind] || {})[id] = rec;
  }

  /* Stateful validation (P8). Returns [] when clean. */
  function stateErrors(state, evt) {
    var reg = MD.REGISTRY[evt.type];
    var errs = [];
    var kind = evt.entity.kind, id = evt.entity.id;
    var existing = ent(state, kind, id);
    if (reg.creates) {
      if (existing) errs.push('entity ' + kind + '/' + id + ' already exists');
    } else if (!AUTOVIVIFY[kind]) {
      if (!existing) errs.push('entity ' + kind + '/' + id + ' does not exist');
      else if (!existing.alive) errs.push('entity ' + kind + '/' + id + ' is tombstoned/merged');
    }
    if (reg.refs) {
      Object.keys(reg.refs).forEach(function (r) {
        var refId = evt.refs && evt.refs[r];
        var refEnt = refId && ent(state, reg.refs[r], refId);
        if (!refEnt) errs.push('ref ' + r + ' (' + reg.refs[r] + '/' + refId + ') does not exist');
        else if (!refEnt.alive) errs.push('ref ' + r + ' (' + reg.refs[r] + '/' + refId + ') is not alive');
      });
    }
    switch (evt.type) {
      case 'person.tombstoned': {
        var enrols = state.index.personEnrolments[id] || [];
        var live = enrols.filter(function (eid) {
          var e = ent(state, 'enrolment', eid);
          return e && e.alive && !RELEASED[e.status || 'active'];
        });
        if (live.length) errs.push('person has ' + live.length + ' active enrolment(s); withdraw/complete them first');
        break;
      }
      case 'person.merged': {
        var loser = ent(state, 'person', evt.payload.loserId);
        if (!loser) errs.push('merge loser does not exist');
        else if (!loser.alive) errs.push('merge loser already tombstoned/merged');
        if (evt.payload.loserId === id) errs.push('cannot merge a person into themselves');
        break;
      }
      case 'fees.payment.reversed': {
        var p = state.index.payments[evt.payload.paymentEventId];
        if (!p) errs.push('paymentEventId is not a recorded payment');
        else {
          if (p.enrolmentId !== id) errs.push('payment belongs to a different enrolment');
          if (p.reversedBy) errs.push('payment already reversed by ' + p.reversedBy);
        }
        break;
      }
      case 'cashbook.cheque.voided':
      case 'findoc.superseded':
      case 'findoc.voided': {
        // The entity itself must exist (checked above); nothing more stateful.
        break;
      }
      case 'attendance.corrected': {
        var m = state.index.eventsById[evt.payload.markEventId];
        if (!m || m.type !== 'attendance.marked') errs.push('markEventId is not an attendance.marked event');
        else if (m.entityId !== id) errs.push('attendance mark belongs to a different enrolment');
        break;
      }
      case 'assessment.result.overridden': {
        var rr = state.index.eventsById[evt.payload.resultEventId];
        if (!rr || rr.type !== 'assessment.result.recorded') errs.push('resultEventId is not a recorded result');
        else if (rr.entityId !== id) errs.push('result belongs to a different enrolment');
        break;
      }
    }
    return errs;
  }

  /* Apply an accepted event to the integrity index. */
  function indexApply(state, evt) {
    var reg = MD.REGISTRY[evt.type];
    var kind = evt.entity.kind, id = evt.entity.id;
    if (reg.creates && !ent(state, kind, id)) putEnt(state, kind, id, { alive: true });
    if (AUTOVIVIFY[kind] && !ent(state, kind, id)) putEnt(state, kind, id, { alive: true });
    state.index.eventsById[evt.id] = { type: evt.type, entityId: id };
    switch (evt.type) {
      case 'enrolment.created': {
        var pid = evt.refs.person;
        (state.index.personEnrolments[pid] = state.index.personEnrolments[pid] || []).push(id);
        putEnt(state, 'enrolment', id, { alive: true, status: 'active', personId: pid });
        break;
      }
      case 'enrolment.statusChanged': {
        var e = ent(state, 'enrolment', id); if (e) e.status = evt.payload.to;
        break;
      }
      case 'person.tombstoned':
      case 'doc.tombstoned': {
        var t = ent(state, kind, id); if (t) t.alive = false;
        break;
      }
      case 'person.merged': {
        var loser = ent(state, 'person', evt.payload.loserId);
        if (loser) { loser.alive = false; loser.mergedInto = id; }
        break;
      }
      case 'fees.payment.recorded': {
        state.index.payments[evt.id] = { enrolmentId: id, amountMinor: evt.payload.amountMinor, reversedBy: null };
        break;
      }
      case 'fees.payment.reversed': {
        var p = state.index.payments[evt.payload.paymentEventId];
        if (p) p.reversedBy = evt.id;
        break;
      }
    }
  }

  function assignNumbers(state, evt) {
    var reg = MD.REGISTRY[evt.type];
    if (!reg.needsNumber) return null;
    var series;
    if (reg.needsNumber === 'findoc') series = evt.payload.kind;   // invoice/quote/po/voucher
    else series = reg.needsNumber;                                  // receipt/cert
    // Legacy imports carry their own numbers — never renumber history. For
    // receipts that includes the PRESERVED legacy number (legacyReceiptNo,
    // the field bootstrap and the fee bridge write): the number on the paper
    // receipt a parent holds stays the payment's number for good.
    var presentField = series === 'receipt' ? 'receiptNo' : series === 'cert' ? 'certNo' : 'number';
    if (evt.payload && evt.payload[presentField]) return null;
    if (series === 'receipt' && evt.payload && evt.payload.legacyReceiptNo) return null;
    state.series[series] = (state.series[series] || 0) + 1;
    var num = SERIES_PREFIX[series] + pad6(state.series[series]);
    var field = series === 'receipt' ? 'receiptNo' : series === 'cert' ? 'certNo' : 'number';
    var out = {}; out[field] = num;
    return out;
  }

  function createBroker(initialState) {
    var state = initialState || createBrokerState();

    // append: validate everything first, then commit ALL-OR-NOTHING per batch.
    // A batch is one client outbox drain; partial acceptance would leave the
    // client guessing, so any invalid event fails the whole batch with named
    // per-event errors (quarantine happens client-side / migration-side).
    function append(req, opts) {
      var events = (req && req.events) || [];
      var now = (opts && opts.nowIso) || new Date().toISOString();
      var acks = {}, errors = {}, fresh = [];
      var chainP = Promise.resolve();

      // Pass 1 — validate against a SCRATCH copy of the index, applying each
      // event as it validates, so within-batch causal chains work (create a
      // person and enrol them in one outbox drain). The real state is only
      // touched in pass 2, keeping the batch all-or-nothing.
      var scratch = { index: JSON.parse(JSON.stringify(state.index)) };
      for (var i = 0; i < events.length; i++) {
        var evt = events[i];
        if (state.ackById[evt.id]) { acks[evt.id] = state.ackById[evt.id]; continue; }
        var v = MD.validateEvent(evt);
        var errs = v.ok ? stateErrors(scratch, evt) : v.errors;
        if (errs.length) errors[evt.id] = errs;
        else { indexApply(scratch, evt); fresh.push(evt); }
      }
      if (Object.keys(errors).length) {
        return Promise.resolve({ ok: false, acks: {}, errors: errors, head: head() });
      }

      // Pass 2 — verify hashes, then commit in order.
      return Promise.all(fresh.map(function (evt) { return MD.verifyEventHash(evt); }))
        .then(function (verdicts) {
          verdicts.forEach(function (good, i) { if (!good) errors[fresh[i].id] = ['content hash does not verify']; });
          if (Object.keys(errors).length) return { ok: false, acks: {}, errors: errors, head: head() };
          var segFirst = state.seq + 1;
          fresh.forEach(function (evt) {
            var stored = Object.assign({}, evt);
            stored.seq = ++state.seq;
            stored.brokerAt = now;
            var assigned = assignNumbers(state, stored);
            if (assigned) stored.assigned = assigned;
            state.events.push(stored);
            indexApply(state, stored);
            state.ackById[evt.id] = { seq: stored.seq, assigned: assigned || null };
            acks[evt.id] = state.ackById[evt.id];
            chainP = chainP.then(function () {
              return MD.sha256Hex(state.chain + '|' + stored.hash).then(function (h) { state.chain = h; });
            });
          });
          return chainP.then(function () {
            if (fresh.length) {
              state.segments.push({
                n: state.segments.length + 1, firstSeq: segFirst, lastSeq: state.seq,
                count: fresh.length, chain: state.chain
              });
            }
            return { ok: true, acks: acks, errors: {}, head: head() };
          });
        });
    }

    function pull(req) {
      var since = (req && req.sinceSeq) || 0;
      var max = (req && req.max) || 500;
      var out = [];
      for (var i = 0; i < state.events.length && out.length < max; i++) {
        if (state.events[i].seq > since) out.push(state.events[i]);
      }
      return Promise.resolve({ events: out, head: head() });
    }

    function head() { return { seq: state.seq, chain: state.chain }; }

    function gate(req) {
      if (req.op === 'get') return Promise.resolve({ gates: state.gates });
      if (req.op === 'setBootstrap') { state.gates.bootstrap = req.value; return Promise.resolve({ gates: state.gates }); }
      if (req.op === 'setMaintenance') { state.gates.maintenance = !!req.value; return Promise.resolve({ gates: state.gates }); }
      return Promise.reject(new Error('unknown gate op'));
    }

    // Verify the whole chain from the stored events (integrity tooling, P11).
    function verifyChain() {
      var chain = 'genesis', i = 0;
      function step() {
        if (i >= state.events.length) return Promise.resolve(chain === state.chain);
        var evt = state.events[i++];
        return MD.verifyEventHash(evt).then(function (good) {
          if (!good) return false;
          return MD.sha256Hex(chain + '|' + evt.hash).then(function (h) { chain = h; return step(); });
        });
      }
      return step();
    }

    return { append: append, pull: pull, headq: function () { return Promise.resolve(head()); }, gate: gate, verifyChain: verifyChain, _state: state };
  }

  return { createBroker: createBroker, createBrokerState: createBrokerState };
});
