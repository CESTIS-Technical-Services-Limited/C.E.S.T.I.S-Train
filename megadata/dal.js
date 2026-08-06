/* MegaData — Data Access Layer (Phase 5 step 3).
   The single API every page uses (P1). Contract: docs/02-MEGADATA-ARCHITECTURE.md §7.
   Reads are synchronous over folded projections after open(); writes are async
   and resolve at "accepted" (locally durable in the adapter); sync drains the
   outbox to the broker at-least-once and pulls the tail — retries converge by
   event-id dedupe (P10). The acknowledged-write contract and its limits are
   the signed Section 0 ones; browser glue (leader tab, BroadcastChannel,
   IndexedDB adapter) arrives in step 7 behind these same seams. */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = { MD: require('./schemas.js'), P: require('./projections.js') };
    module.exports = factory(deps);
  } else {
    deps = { MD: root.MegaData, P: root.MegaData };
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (deps) {
  'use strict';
  var MD = deps.MD, P = deps.P;

  function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function key10(n) { return String(n).padStart(10, '0'); }

  function createDAL(opts) {
    var adapter = opts.adapter, broker = opts.broker;
    var actor = opts.actor, source = opts.source || 'dal';
    var rows = [];            // [{ evt, localIdx }] in fold order
    var byId = {};            // eventId → row
    var head = { seq: 0, chain: 'genesis' };
    var localIdx = 0;
    var S = null;             // folded projection state

    function refold() {
      var foldable = rows.map(function (r) {
        var c = Object.assign({}, r.evt); c._localIdx = r.localIdx; return c;
      });
      S = P.foldAll(foldable);
    }
    function entityLastSeq(kind, id) {
      var k = S.entities[kind]; var e = k && k[id];
      return e ? (e.lastEventSeq != null ? e.lastEventSeq : Infinity) : null; // pending-only entity → Infinity (always newer than any basis)
    }

    /* ---------- local accept pipeline ---------- */
    function accept(type, entityId, payload, cmdOpts) {
      cmdOpts = cmdOpts || {};
      var reg = MD.REGISTRY[type];
      if (!reg) return Promise.reject(new Error('unknown event type ' + type));
      // Stale-basis guard (docs/02 §7): the UI acted on a projection at basis B;
      // if the entity has moved past B, refuse rather than write blind.
      if (cmdOpts.basis != null) {
        var last = entityLastSeq(reg.entity, entityId);
        if (last != null && last > cmdOpts.basis) {
          var err = new Error('STALE_BASIS'); err.code = 'STALE_BASIS';
          return Promise.reject(err);
        }
      }
      // Local existence pre-checks mirror the broker's cheap ones so mistakes
      // fail fast offline; the broker remains the authority (P8).
      if (!reg.creates && !{ doc: 1, adjudication: 1 }[reg.entity]) {
        var k = S.entities[reg.entity];
        if (!k || !k[entityId]) return Promise.reject(new Error(reg.entity + '/' + entityId + ' does not exist locally'));
        if (!k[entityId].alive) return Promise.reject(new Error(reg.entity + '/' + entityId + ' is tombstoned/merged'));
      }
      return MD.buildEvent(type, entityId, payload, actor, source, {
        id: cmdOpts.id, refs: cmdOpts.refs, cause: cmdOpts.cause, corr: cmdOpts.corr, prov: cmdOpts.prov
      }).then(function (evt) {
        var row = { evt: evt, localIdx: ++localIdx };
        // One logical transaction: event + outbox marker + counter. Adapters
        // providing putMany (IndexedDB: one IDB transaction) get atomicity;
        // others apply sequentially.
        var batch = [
          { ns: 'events', k: key10(row.localIdx), v: evt },
          { ns: 'outbox', k: evt.id, v: row.localIdx },
          { ns: 'meta', k: 'localIdx', v: localIdx }
        ];
        var write = adapter.putMany ? adapter.putMany(batch)
          : batch.reduce(function (pr, e) { return pr.then(function () { return adapter.put(e.ns, e.k, e.v); }); }, Promise.resolve());
        return write
          .then(function () {
            rows.push(row); byId[evt.id] = row; refold();
            return { accepted: true, eventId: evt.id, entityId: entityId };
          });
      });
    }

    /* ---------- sync: drain outbox, pull tail ---------- */
    function syncNow() {
      return adapter.scan('outbox').then(function (pend) {
        pend.sort(function (a, b) { return a.v - b.v; });
        var events = pend.map(function (p) { return byId[p.k] ? byId[p.k].evt : null; }).filter(Boolean)
          .map(function (evt) { var c = Object.assign({}, evt); delete c._localIdx; return c; });
        var chain = Promise.resolve({ quarantined: [] });
        if (events.length) {
          chain = broker.append({ events: events }).then(function (res) {
            if (res.ok) {
              return Promise.all(events.map(function (evt) {
                var ack = res.acks[evt.id];
                var row = byId[evt.id];
                row.evt.seq = ack.seq;
                if (ack.assigned) row.evt.assigned = ack.assigned;
                return adapter.put('events', key10(row.localIdx), row.evt)
                  .then(function () { return adapter.del('outbox', evt.id); });
              })).then(function () { return { quarantined: [] }; });
            }
            // Broker refused the batch: quarantine the NAMED offenders locally
            // (never silently dropped — P8), retry the rest next sync.
            var badIds = Object.keys(res.errors);
            return Promise.all(badIds.map(function (id) {
              var row = byId[id];
              return adapter.put('quarantine', id, { evt: row.evt, errors: res.errors[id] })
                .then(function () { return adapter.del('outbox', id); })
                .then(function () { return adapter.del('events', key10(row.localIdx)); })
                .then(function () {
                  rows = rows.filter(function (r) { return r.evt.id !== id; });
                  delete byId[id];
                });
            })).then(function () { refold(); return { quarantined: badIds }; });
          });
        }
        return chain.then(function (out) {
          function pullLoop() {
            return broker.pull({ sinceSeq: head.seq, max: 500 }).then(function (res) {
              res.events.forEach(function (evt) {
                var row = byId[evt.id];
                if (row) { row.evt = evt; adapter.put('events', key10(row.localIdx), evt); }
                else {
                  row = { evt: evt, localIdx: ++localIdx };
                  rows.push(row); byId[evt.id] = row;
                  adapter.put('events', key10(row.localIdx), evt);
                  adapter.put('meta', 'localIdx', localIdx);
                }
                if (evt.seq > head.seq) head.seq = evt.seq;
              });
              head.chain = res.head.chain;
              if (res.head.seq > head.seq && res.events.length) return pullLoop();
              adapter.put('meta', 'head', head);
              return null;
            });
          }
          return pullLoop().then(function () { refold(); return out; });
        });
      });
    }

    /* ---------- public surface (docs/02 §7) ---------- */
    var dal = {
      // provenance & reads
      head: function () {
        return { seq: head.seq, chain: head.chain, unsynced: rows.filter(function (r) { return r.evt.seq == null; }).length };
      },
      get: function (kind, id) { var k = S.entities[kind]; return (k && k[id]) || null; },
      find: function (kind, pred) {
        var k = S.entities[kind] || {};
        return Object.keys(k).map(function (id) { return k[id]; }).filter(pred || function () { return true; });
      },
      project: function (name, params) {
        var fn = P.PROJECTIONS[name];
        if (!fn) throw new Error('unknown projection ' + name);
        return fn(S, params || {});
      },

      // people & enrolment
      registerPerson: function (bio, o) {
        var personId = MD.mintId('per');
        var dup = dal.find('person', function (p) {
          return p.alive && p.fields.names && normName(p.fields.names.full) === normName(bio.names && bio.names.full);
        }).map(function (p) { return p.id; });
        return accept('person.registered', personId, bio, o).then(function (r) {
          r.personId = personId; r.duplicates = dup; return r; // suggest, never auto-merge (P6)
        });
      },
      correctPerson: function (personId, diff, reason, o) {
        return accept('person.corrected', personId, { diff: diff, reason: reason }, o);
      },
      mergePeople: function (winnerId, loserId, evidence, tier, o) {
        return accept('person.merged', winnerId, { loserId: loserId, evidence: evidence, tier: tier || 'human' }, o);
      },
      tombstonePerson: function (personId, reason, o) { return accept('person.tombstoned', personId, { reason: reason }, o); },
      defineProgramme: function (fields, o) {
        var id = MD.mintId('prg');
        return accept('programme.defined', id, fields, o).then(function (r) { r.programmeId = id; return r; });
      },
      openIntake: function (programmeId, fields, o) {
        var id = MD.mintId('int');
        return accept('intake.opened', id, fields, Object.assign({}, o, { refs: { programme: programmeId } }))
          .then(function (r) { r.intakeId = id; return r; });
      },
      enrol: function (personId, intakeId, fields, o) {
        var id = MD.mintId('enr');
        return accept('enrolment.created', id, fields || { enrolledAt: (fields && fields.enrolledAt) }, Object.assign({}, o, { refs: { person: personId, intake: intakeId } }))
          .then(function (r) { r.enrolmentId = id; return r; });
      },
      setEnrolmentStatus: function (enrolmentId, to, reason, o) { return accept('enrolment.statusChanged', enrolmentId, { to: to, reason: reason }, o); },

      // fees (P4)
      getLedger: function (enrolmentId) { return dal.project('ledger', { enrolmentId: enrolmentId }); },
      getBalance: function (enrolmentId) { return dal.getLedger(enrolmentId).balanceMinor; },
      setFeeSchedule: function (intakeId, fields, o) {
        var id = MD.mintId('fsc');
        return accept('fees.schedule.set', id, fields, Object.assign({}, o, { refs: { intake: intakeId } }));
      },
      assessCharge: function (enrolmentId, c, o) { return accept('fees.charge.assessed', enrolmentId, c, o); },
      recordPayment: function (enrolmentId, p, o) {
        return accept('fees.payment.recorded', enrolmentId, p, o).then(function (r) {
          var row = byId[r.eventId];
          r.receiptNo = (row.evt.assigned && row.evt.assigned.receiptNo) || null; // null until broker ack (docs/02 §2)
          return r;
        });
      },
      reversePayment: function (enrolmentId, paymentEventId, reason, o) {
        return accept('fees.payment.reversed', enrolmentId, { paymentEventId: paymentEventId, reason: reason }, o);
      },
      applyAdjustment: function (enrolmentId, a, o) { return accept('fees.adjustment.applied', enrolmentId, a, o); },

      // attendance & assessment & certification
      markAttendance: function (enrolmentId, date, status, sessionId, o) {
        return accept('attendance.marked', enrolmentId, { date: date, status: status, sessionId: sessionId }, o);
      },
      correctAttendance: function (enrolmentId, markEventId, newStatus, reason, o) {
        return accept('attendance.corrected', enrolmentId, { markEventId: markEventId, newStatus: newStatus, reason: reason }, o);
      },
      recordResult: function (enrolmentId, res, o) { return accept('assessment.result.recorded', enrolmentId, res, o); },
      overrideResult: function (enrolmentId, resultEventId, grade, reason, o) {
        return accept('assessment.result.overridden', enrolmentId, { resultEventId: resultEventId, grade: grade, reason: reason }, o);
      },
      approveCertificate: function (enrolmentId, o) { return accept('cert.approved', enrolmentId, {}, o); },
      issueCertificate: function (enrolmentId, o) { return accept('cert.issued', enrolmentId, {}, o); },

      // cashbook & finance docs (independent book — D11)
      openQuarter: function (fy, q, openingBalanceMinor, o) {
        return accept('cashbook.quarter.opened', MD.mintId('cbq'), { fy: fy, q: q, openingBalanceMinor: openingBalanceMinor }, o);
      },
      recordCashbookEntry: function (e, o) {
        var id = MD.mintId('cbe');
        return accept('cashbook.entry.recorded', id, e, o).then(function (r) { r.entryId = id; return r; });
      },
      voidCheque: function (entryEntityId, reason, o) { return accept('cashbook.cheque.voided', entryEntityId, { reason: reason }, o); },
      issueDoc: function (kind, doc, o) {
        var id = MD.mintId('fdc');
        return accept('findoc.issued', id, { kind: kind, doc: doc }, o).then(function (r) { r.docId = id; return r; });
      },

      // Tier B documents
      upsertDoc: function (kind, id, diff, reason, o) {
        return accept('doc.upserted', id, { kind: kind, diff: diff, reason: reason }, o);
      },

      // sync
      sync: { now: syncNow, status: function () { return { head: dal.head(), brokerReachable: null }; } },
      _accept: accept // migration CLI uses the same pipeline with prov/opts
    };

    /* ---------- open: hydrate from the adapter ---------- */
    return adapter.scan('events').then(function (stored) {
      stored.sort(function (a, b) { return a.k < b.k ? -1 : 1; });
      stored.forEach(function (s) {
        var row = { evt: s.v, localIdx: parseInt(s.k, 10) };
        rows.push(row); byId[s.v.id] = row;
        if (s.v.seq != null && s.v.seq > head.seq) head.seq = s.v.seq;
      });
      return adapter.get('meta', 'localIdx');
    }).then(function (li) {
      if (li != null) localIdx = li;
      return adapter.get('meta', 'head');
    }).then(function (h) {
      if (h && h.seq > head.seq) head = h;
      refold();
      return dal;
    });
  }

  return { createDAL: createDAL };
});
