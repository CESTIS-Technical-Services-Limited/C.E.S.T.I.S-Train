/* MegaData — adjudication queue model (pure logic; verdict: "built for
   throughput — ordered by money-at-stake, diff-highlighted, one-keystroke
   dispositions, pattern batching, resumable across days").

   Queue items are canonical docs (kind 'identityQueueItem', written by the
   bootstrap with content-derived itemIds), decisions are
   identity.adjudicated events on deterministic adjudication entities
   (adj_m<hash(itemId)>), and a MERGE decision additionally emits
   person.merged with the queue item as evidence — so the queue, the
   decisions and their effects all fold identically on every device, and a
   two-clerk race on the same item converges through broker replay (P10). */
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

  function adjEntityId(itemId) {
    return MG.sha256Hex('mega-adjudication|' + itemId).then(function (h) { return 'adj_m' + h.slice(0, 20); });
  }

  /* A queue record's person could live under its plain key, the SF-strip
     twin key (fee records SF-X share identity with LMS id X), or a bootstrap
     split key — try them in the bootstrap's own order, never guess beyond. */
  function personFor(dal, rec) {
    var id = String(rec.id);
    var keys = ['id:' + id, 'id:' + id + '#student', 'id:' + id + '#lmsStudent'];
    if (id.indexOf('SF-') === 0) keys.unshift('id:' + id.slice(3));
    return keys.reduce(function (pr, gk) {
      return pr.then(function (found) {
        if (found) return found;
        return MG.bootstrapId('per', 'person|' + gk).then(function (pid) {
          var p = dal.get('person', pid);
          return p && p.alive ? { personId: pid, person: p, groupKey: gk } : null;
        });
      });
    }, Promise.resolve(null));
  }

  /* Money at stake for one person: the sum of |balance| across their live
     enrolments — from the FOLD, never a stored number. */
  function stakeFor(dal, personId) {
    var total = 0;
    dal.find('enrolment', function (e) { return e.alive && e.fields.personId === personId; }).forEach(function (e) {
      var l = dal.getLedger(e.id);
      total += Math.abs(l.balanceMinor);
    });
    return total;
  }

  /* The pending queue: every alive identityQueueItem doc without a decision,
     each enriched with resolved people + money at stake, sorted stake-first. */
  function adjqPending(dal) {
    var items = dal.find('doc', function (d) { return d.alive && d.fields && d.fields.docKind === 'identityQueueItem'; });
    return items.reduce(function (pr, doc) {
      return pr.then(function (out) {
        var itemId = doc.fields.itemId;
        return adjEntityId(itemId).then(function (aid) {
          var decided = dal.get('adjudication', aid);
          if (decided && decided.fields && decided.fields.decision) { out.decided.push({ itemId: itemId, decision: decided.fields.decision }); return out; }
          var recs = doc.fields.records || [];
          // Identity evidence is gathered from EVERY overlapping backup, so
          // the same record id arrives once per source copy (a live run
          // showed 14 columns of one id). One column per DISTINCT record;
          // the copy count rides along for display.
          var copies = {}, uniq = [];
          recs.forEach(function (rec) {
            var k = String(rec.id);
            if (copies[k]) { copies[k]++; return; }
            copies[k] = 1;
            uniq.push(rec);
          });
          return uniq.reduce(function (pr2, rec) {
            return pr2.then(function (resolved) {
              return personFor(dal, rec).then(function (hit) {
                resolved.push({ rec: rec, hit: hit, copies: copies[String(rec.id)], stakeMinor: hit ? stakeFor(dal, hit.personId) : 0 });
                return resolved;
              });
            });
          }, Promise.resolve([])).then(function (resolved) {
            out.pending.push({
              itemId: itemId, docId: doc.id, tier: doc.fields.tier, suggestion: doc.fields.suggestion,
              records: resolved,
              stakeMinor: resolved.reduce(function (s, r) { return s + r.stakeMinor; }, 0)
            });
            return out;
          });
        });
      });
    }, Promise.resolve({ pending: [], decided: [] })).then(function (out) {
      out.pending.sort(function (a, b) { return b.stakeMinor - a.stakeMinor; });
      return out;
    });
  }

  /* Field-level diff of two people for the side-by-side view. */
  function adjqDiff(pa, pb) {
    function flat(p) {
      var f = (p && p.fields) || {}, c = f.contacts || {};
      return { name: (f.names && f.names.full) || '', dob: f.dob || '', nationalId: f.nationalId || '', phone: c.phone || '', email: c.email || '', address: c.address || '', city: c.city || '' };
    }
    var A = flat(pa), B = flat(pb), rows = [];
    Object.keys(A).forEach(function (k) { rows.push({ field: k, a: A[k], b: B[k], differs: String(A[k]) !== String(B[k]) }); });
    return rows;
  }

  /* Record a disposition. decision ∈ merged | kept-separate | deferred.
     For 'merged', winnerPersonId + loserPersonIds are required; each loser
     gets person.merged evidence = the queue item. All event ids are
     deterministic on (itemId, decision[, loser]) so a same-decision race
     converges; a DIFFERENT decision on an already-decided item lands as a
     newer event — last writer, fully audited. */
  function adjqDecide(dal, item, decision, opts) {
    opts = opts || {};
    return adjEntityId(item.itemId).then(function (aid) {
      var chain = Promise.resolve();
      if (decision === 'merged') {
        var winner = opts.winnerPersonId, losers = opts.loserPersonIds || [];
        if (!winner || !losers.length) return Promise.reject(new Error('merge needs a winner and at least one loser'));
        losers.forEach(function (loserId) {
          chain = chain.then(function () {
            return MG.bridgeEventId('adjmerge|' + item.itemId + '|' + winner + '|' + loserId).then(function (evtId) {
              return dal._accept('person.merged', winner,
                { loserId: loserId, evidence: { itemId: item.itemId, suggestion: item.suggestion }, tier: 'human' },
                { id: evtId, prov: { importRun: 'adjudication', srcFile: 'MegaData-Adjudication', srcPath: item.itemId } })
                .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
            });
          });
        });
      }
      return chain.then(function () {
        return MG.bridgeEventId('adjdecide|' + item.itemId + '|' + decision + '|' + (opts.note || '')).then(function (evtId) {
          return dal._accept('identity.adjudicated', aid,
            { itemId: item.itemId, decision: decision, note: opts.note || '' },
            { id: evtId, prov: { importRun: 'adjudication', srcFile: 'MegaData-Adjudication', srcPath: item.itemId } })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
  }

  return { adjEntityId: adjEntityId, adjqPending: adjqPending, adjqDiff: adjqDiff, adjqDecide: adjqDecide, _adjqPersonFor: personFor };
});
