/* MegaData — Cashbook bridge model (D11: its OWN book, never joined to fees).
   Tier-A money: entries are immutable events; the legacy page's in-place
   edit becomes VOID + REPLACEMENT (chained deterministic entity id, linked
   by `supersedes`), a deletion becomes a void with its reason, a legacy
   cheque void becomes cashbook.cheque.voided, and an UNVOID (the page
   restores _orig*) becomes a replacement — the void event itself is
   permanent history.

   THE ID TRAP this model exists to defuse: legacy txn ids are small
   per-device integers (nextId), so two devices can mint the SAME id for
   DIFFERENT transactions in the same quarter. A naive (fy,q,id) join would
   let one clerk's bridge void the other clerk's money. Rules:
     - bootstrap-imported history joins by the bootstrap key (fy,q,id) —
       safe, it existed before any device raced;
     - entries born on a device get CONTENT-hashed entity ids
       ('cbe-n|fy|Qq|id|<canon(content)>'), so same-id-different-content
       devices mint DIFFERENT entities and both sums count;
     - after its entity exists, the legacy txn is STAMPED with megaId, the
       stable join for every later tick and for cross-device mirrors;
     - replacements chain: 'cbe-r|<prevEntityId>|<canon(content)>' — an
       A→B→A edit cycle lands three distinct entities (no id reuse).
   Every event id is deterministic, so retries and same-state races
   converge through broker replay (P10). */
(function (root, factory) {
  var deps;
  if (typeof module !== 'undefined' && module.exports) {
    deps = Object.assign({}, require('../schemas.js'), require('./roster-model.js'), require('../cashbook-shared.js'));
    module.exports = factory(deps);
  } else {
    deps = root.MegaData;
    root.MegaData = Object.assign(root.MegaData || {}, factory(deps));
  }
})(typeof window !== 'undefined' ? window : globalThis, function (MG) {
  'use strict';

  function bridgeEntityId(key) {
    return MG.sha256Hex('mega-bridge|' + key).then(function (h) { return 'cbe_b' + h.slice(0, 20); });
  }

  function parseQuarterKey(k) {
    var m = /^cestis_quarter_(.+)_Q(\d)$/.exec(String(k || ''));
    return m ? { fy: m[1], q: parseInt(m[2], 10) } : null;
  }

  /* The canonical CONTENT of a txn — post-classification, void-resolved.
     Two txns with equal content are the same entry as far as money goes. */
  function cbTxnContent(fy, q, txn) {
    var a = MG.cbAmount(txn);
    if (a.klass !== 'income' && a.klass !== 'expense') return { klass: a.klass };
    var c = {
      fy: fy, q: q, kind: a.klass, amountMinor: a.amountMinor, categoryId: a.category,
      date: /^\d{4}-\d{2}-\d{2}/.test(String(txn.date || '')) ? String(txn.date).slice(0, 10) : '2024-04-01'
    };
    if (txn.cheque) c.chequeNo = String(txn.cheque);
    if (a.payee) c.payee = a.payee;
    return Object.assign(c, { _voided: !!a.voided });
  }
  function payloadOf(content, legacyTxnId, supersedes) {
    var p = { fy: content.fy, q: content.q, date: content.date, kind: content.kind, categoryId: content.categoryId, amountMinor: content.amountMinor, legacyTxnId: String(legacyTxnId) };
    if (content.chequeNo) p.chequeNo = content.chequeNo;
    if (content.payee) p.payee = content.payee;
    if (supersedes) p.supersedes = supersedes;
    return p;
  }
  function entryContentEquals(entry, content) {
    return entry.kind === content.kind && entry.amountMinor === content.amountMinor &&
      String(entry.categoryId) === String(content.categoryId) && String(entry.date) === String(content.date) &&
      String(entry.chequeNo || '') === String(content.chequeNo || '') && String(entry.payee || '') === String(content.payee || '');
  }

  function quarterFold(dal, fy, q) {
    return dal.project('quarter', { fy: fy, q: q });
  }

  /* Plan one quarter's bridge work. blob = { openingBalance, transactions,
     deletedTxnIds } exactly as stored. Returns actions + megaId stamps. */
  function cbPlanQuarter(dal, fy, q, blob) {
    blob = blob || {};
    var txns = Array.isArray(blob.transactions) ? blob.transactions : [];
    var deleted = {};
    (Array.isArray(blob.deletedTxnIds) ? blob.deletedTxnIds : []).forEach(function (id) { deleted[String(id)] = 1; });
    var fold = quarterFold(dal, fy, q);
    var bySupersedes = {}, liveByEntity = {};
    fold.entries.forEach(function (e) {
      liveByEntity[e.entityId] = e;
      if (!e.voided && e.supersedes) bySupersedes[e.supersedes] = e;
    });
    var plan = { openQuarter: null, records: [], voids: [], cancelledDocs: [], stamps: [], skipped: [] };

    var quarterHasContent = txns.length > 0 || blob.openingBalance != null;
    var chain = MG.bootstrapId('cbq', 'cbq|' + fy + '|Q' + q).then(function (qid) {
      if (quarterHasContent && !dal.get('cashbookQuarter', qid)) {
        plan.openQuarter = { entityId: qid, payload: { fy: fy, q: q, openingBalanceMinor: MG.cbToMinor(blob.openingBalance).minor } };
      }
    });

    txns.forEach(function (t) {
      chain = chain.then(function () {
        if (t == null || t.id == null || deleted[String(t.id)]) return null;
        var content = cbTxnContent(fy, q, t);
        if (content.klass === 'ambiguous' || content.klass === 'zero') { plan.skipped.push({ txnId: t.id, reason: content.klass }); return null; }
        if (content.klass === 'cancelled-zero') {
          // Voided before any amounts were known: a document, not a ledger entry.
          return MG.bootstrapId('cbe', 'cbe|' + fy + '|Q' + q + '|' + t.id).then(function (docId) {
            if (!dal.get('doc', docId)) plan.cancelledDocs.push({ docId: docId, txn: t });
          });
        }
        // Resolve this txn's CURRENT entity: megaId stamp → bootstrap key.
        var resolve = Promise.resolve(null);
        if (t.megaId && liveByEntity[t.megaId]) resolve = Promise.resolve(t.megaId);
        else resolve = MG.bootstrapId('cbe', 'cbe|' + fy + '|Q' + q + '|' + t.id).then(function (importId) {
          if (!liveByEntity[importId]) return null;
          // Only trust the (fy,q,id) join for entries WITHOUT a legacyTxnId
          // stamp of a DIFFERENT device's txn — bootstrap history has none.
          return importId;
        });
        return resolve.then(function (entityId) {
          var entry = entityId && liveByEntity[entityId];
          if (!entry) {
            // Born here: content-hashed entity id (defuses the id trap).
            return bridgeEntityId('cbe-n|' + fy + '|Q' + q + '|' + t.id + '|' + MG.canon(payloadOf(content, t.id))).then(function (newId) {
              // Already there — we raced ourselves, or the stamp that joined
              // this row to it was lost. ADOPT it and settle its void state
              // below: stamping alone would strand a later void off the book.
              if (liveByEntity[newId]) return settle(liveByEntity[newId]);
              plan.records.push({ entityId: newId, payload: payloadOf(content, t.id), eventKey: 'cbrec|' + newId });
              if (content._voided) plan.voids.push({ entityId: newId, reason: 'legacy voided cheque', eventKey: 'cbvoid|' + newId + '|voided' });
              plan.stamps.push({ txnId: t.id, megaId: newId });
              return null;
            });
          }
          return settle(entry);
        });

        function settle(entry) {
          // Follow the supersession chain to the live head, if any.
          while (entry && entry.voided && bySupersedes[entry.entityId]) { entry = bySupersedes[entry.entityId]; }
          if (t.megaId !== entry.entityId) plan.stamps.push({ txnId: t.id, megaId: entry.entityId });
          var legacyVoided = content._voided;
          if (legacyVoided && !entry.voided) {
            plan.voids.push({ entityId: entry.entityId, reason: 'legacy voided cheque', eventKey: 'cbvoid|' + entry.entityId + '|voided' });
            return null;
          }
          if (!legacyVoided && entry.voided) {
            // UNVOID: the void is permanent history — record a replacement.
            return bridgeEntityId('cbe-r|' + entry.entityId + '|' + MG.canon(payloadOf(content, t.id))).then(function (rid) {
              if (liveByEntity[rid]) { plan.stamps.push({ txnId: t.id, megaId: rid }); return null; }
              plan.records.push({ entityId: rid, payload: payloadOf(content, t.id, entry.entityId), eventKey: 'cbrec|' + rid });
              plan.stamps.push({ txnId: t.id, megaId: rid });
              return null;
            });
          }
          if (!legacyVoided && !entryContentEquals(entry, content)) {
            // In-place legacy edit → void old + chained replacement.
            return bridgeEntityId('cbe-r|' + entry.entityId + '|' + MG.canon(payloadOf(content, t.id))).then(function (rid) {
              if (liveByEntity[rid]) { plan.stamps.push({ txnId: t.id, megaId: rid }); return null; }
              plan.voids.push({ entityId: entry.entityId, reason: 'superseded by legacy edit', eventKey: 'cbvoid|' + entry.entityId + '|edit|' + rid });
              plan.records.push({ entityId: rid, payload: payloadOf(content, t.id, entry.entityId), eventKey: 'cbrec|' + rid });
              plan.stamps.push({ txnId: t.id, megaId: rid });
              return null;
            });
          }
          return null;
        }
      });
    });

    return chain.then(function () {
      // Deleted txns whose entity is still live → void with the reason.
      var chain2 = Promise.resolve();
      Object.keys(deleted).forEach(function (id) {
        chain2 = chain2.then(function () {
          return MG.bootstrapId('cbe', 'cbe|' + fy + '|Q' + q + '|' + id).then(function (importId) {
            fold.entries.forEach(function (e) {
              if (e.voided) return;
              if (e.entityId === importId || String(e.legacyTxnId || '') === String(id)) {
                plan.voids.push({ entityId: e.entityId, reason: 'legacy deletion', eventKey: 'cbvoid|' + e.entityId + '|deleted' });
              }
            });
          });
        });
      });
      return chain2;
    }).then(function () { return plan; });
  }

  /* Emit a plan's events (deterministic event ids). */
  function cbPushPlan(dal, plan, page) {
    var prov = function (p) { return { importRun: 'bridge', srcFile: page || 'CESTIS.Cashbook', srcPath: String(p) }; };
    var chain = Promise.resolve();
    if (plan.openQuarter) {
      chain = chain.then(function () {
        return MG.bridgeEventId('cbq|' + plan.openQuarter.payload.fy + '|Q' + plan.openQuarter.payload.q).then(function (evtId) {
          return dal._accept('cashbook.quarter.opened', plan.openQuarter.entityId, plan.openQuarter.payload, { id: evtId, prov: prov('quarter') })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    }
    plan.records.forEach(function (r) {
      chain = chain.then(function () {
        return MG.bridgeEventId(r.eventKey).then(function (evtId) {
          return dal._accept('cashbook.entry.recorded', r.entityId, r.payload, { id: evtId, prov: prov(r.payload.legacyTxnId) })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
    plan.voids.forEach(function (v) {
      chain = chain.then(function () {
        return MG.bridgeEventId(v.eventKey).then(function (evtId) {
          return dal._accept('cashbook.cheque.voided', v.entityId, { reason: v.reason }, { id: evtId, prov: prov(v.entityId) })
            .catch(function (e) { if (!/exists|voided/.test(e.message)) throw e; });
        });
      });
    });
    plan.cancelledDocs.forEach(function (d) {
      chain = chain.then(function () {
        return MG.bridgeEventId('cbcz|' + d.docId).then(function (evtId) {
          return dal._accept('doc.upserted', d.docId, { kind: 'cashbookCancelled', diff: Object.assign({}, d.txn), reason: 'legacy sync' }, { id: evtId, prov: prov(d.txn.id) })
            .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
        });
      });
    });
    return chain;
  }

  /* Of several local rows bound to ONE canonical entry, the row that keeps
     its money: the entry's own legacy id first (the row the clerk typed),
     then the lowest id (mirror-remapped phantoms are minted from 100000 up). */
  function pickClaim(claims, e) {
    var best = null;
    claims.forEach(function (t) {
      if (!best) { best = t; return; }
      if (String(best.id) === String(e.legacyTxnId)) return;
      if (String(t.id) === String(e.legacyTxnId)) { best = t; return; }
      if (Number(t.id) < Number(best.id)) best = t;
    });
    return best;
  }

  /* Canonical → legacy mirror for one quarter. Returns mutations the page
     applies to the blob: new txns (id remapped on collision), in-place edit
     applications (via the supersedes chain), voids to apply (Cancelled +
     _orig*), deletions to apply, drops (phantom double-counting rows) and
     megaId stamps. */
  function cbMirrorQuarter(dal, fy, q, blob) {
    blob = blob || {};
    var txns = Array.isArray(blob.transactions) ? blob.transactions : [];
    var deleted = {};
    (Array.isArray(blob.deletedTxnIds) ? blob.deletedTxnIds : []).forEach(function (id) { deleted[String(id)] = 1; });
    var fold = quarterFold(dal, fy, q);
    var byMega = {}, byLocalId = {}, usedIds = {}, out = { newTxns: [], edits: [], voids: [], deletions: [], drops: [], stamps: [] };
    txns.forEach(function (t) {
      if (!t) return;
      if (t.megaId) (byMega[t.megaId] = byMega[t.megaId] || []).push(t);
      if (t.id != null) { usedIds[String(t.id)] = 1; byLocalId[String(t.id)] = t; }
    });
    var bySupersedes = {};
    fold.entries.forEach(function (e) { if (e.supersedes) bySupersedes[e.supersedes] = e; });

    var chain = Promise.resolve();
    fold.entries.forEach(function (e) {
      chain = chain.then(function () {
        // Resolve which local txn (if any) this entity's LINEAGE belongs to:
        // walk back to the lineage root, then check megaId stamps and the
        // bootstrap (fy,q,id) key.
        return MG.bootstrapId('cbe', 'cbe|' + fy + '|Q' + q + '|' + String(e.legacyTxnId == null ? '' : e.legacyTxnId)).then(function (importIdOfClaimed) {
          var claims = (byMega[e.entityId] || []).slice();
          if (!claims.length && e.supersedes && byMega[e.supersedes]) claims = byMega[e.supersedes].slice();
          if (e.legacyTxnId != null) {
            // THE STAMP IS A CACHE, NOT THE JOIN. A row the bridge itself
            // recorded carries this entity's legacy id and identical content,
            // so it IS this entry even before (or after losing) its megaId
            // stamp — a legacy save rewrites the blob from memory and drops
            // stamps. Without this, the entry below looks like another
            // device's and mirrors in a SECOND row for money already booked.
            var cand = byLocalId[String(e.legacyTxnId)];
            if (cand && !cand.megaId && claims.indexOf(cand) === -1 &&
              (e.entityId === importIdOfClaimed || entryContentEquals(e, cbTxnContent(fy, q, cand)))) claims.push(cand);
          }
          var localTxn = pickClaim(claims, e);
          // Two local rows for ONE canonical entry double-count it in the
          // legacy book (a mirror that ran before its stamps landed): the
          // fold is the money, so the extra rows go.
          claims.forEach(function (t) { if (t !== localTxn) out.drops.push({ txnId: t.id }); });
          if (!localTxn && e.legacyTxnId == null) {
            // Bootstrap-imported entry: its entity id IS the import key of
            // some legacy id — recover it only via megaId stamps (none here)
            // or leave to legacy page-cloud. Nothing safe to do.
            return null;
          }

          if (e.voided) {
            if (!localTxn) return null;                                  // nothing local to act on
            if (bySupersedes[e.entityId]) return null;                    // an edit: the replacement entry handles it
            if (e.voidReason === 'legacy deletion') {
              if (!deleted[String(localTxn.id)]) out.deletions.push({ txnId: localTxn.id });
              return null;
            }
            var isVoidedLocally = String(localTxn.category || '') === 'Cancelled';
            if (!isVoidedLocally) out.voids.push({ txnId: localTxn.id });
            return null;
          }

          // Live entry.
          if (localTxn) {
            var content = cbTxnContent(fy, q, localTxn);
            if (localTxn.megaId !== e.entityId) {
              // Our txn's lineage advanced (remote edit / unvoid) → apply.
              // A row that already reads exactly like the entry only needs
              // the stamp; rewriting it would churn the blob every tick.
              if (content._voided || !entryContentEquals(e, content)) out.edits.push({ txnId: localTxn.id, entry: e });
              out.stamps.push({ txnId: localTxn.id, megaId: e.entityId });
            } else if (content._voided) {
              // Locally voided but canonically live → a remote UNVOID we have
              // not applied (our void event was superseded): restore.
              out.edits.push({ txnId: localTxn.id, entry: e, unvoid: true });
            }
            return null;
          }
          // No local txn: brand-new from another device → mirror in (unless
          // the local id it carries is tombstoned here).
          if (e.legacyTxnId != null && deleted[String(e.legacyTxnId)]) return null;
          var localId = e.legacyTxnId != null ? String(e.legacyTxnId) : null;
          var newId;
          if (localId == null || usedIds[localId]) {                     // id collision with a DIFFERENT txn → remap
            newId = 100000; while (usedIds[String(newId)] || deleted[String(newId)]) newId++;
          } else { newId = isNaN(Number(localId)) ? localId : Number(localId); }
          usedIds[String(newId)] = 1;
          out.newTxns.push({
            id: newId,
            date: e.date, cheque: e.chequeNo || '', details: e.payee || '',
            deposit: e.kind === 'income' ? e.amountMinor / 100 : 0,
            payment: e.kind === 'expense' ? e.amountMinor / 100 : 0,
            category: e.categoryId, megaId: e.entityId
          });
          return null;
        });
      });
    });
    return chain.then(function () { return out; });
  }

  /* Apply a mirror's mutations to a blob (pure; page persists + rerenders). */
  function cbApplyMirror(blob, mirror) {
    var changed = false;
    var b = { openingBalance: blob.openingBalance, transactions: (blob.transactions || []).map(function (t) { return Object.assign({}, t); }), deletedTxnIds: (blob.deletedTxnIds || []).slice() };
    Object.keys(blob).forEach(function (k) { if (!(k in b)) b[k] = blob[k]; });
    var byId = {};
    b.transactions.forEach(function (t, i) { byId[String(t.id)] = i; });
    // Phantom rows first, so the survivor's stamp and any edit land on the
    // row that keeps the money. NOT tombstoned in deletedTxnIds: a dropped
    // row is not a deletion, and a tombstone would void a live entity on the
    // next bridge tick — real money gone for a rendering artefact.
    (mirror.drops || []).forEach(function (d) {
      var i = byId[String(d.txnId)]; if (i === undefined) return;
      b.transactions.splice(i, 1);
      byId = {}; b.transactions.forEach(function (t, j) { byId[String(t.id)] = j; });
      changed = true;
    });
    (mirror.stamps || []).forEach(function (s) {
      var i = byId[String(s.txnId)];
      if (i !== undefined && b.transactions[i].megaId !== s.megaId) { b.transactions[i].megaId = s.megaId; changed = true; }
    });
    (mirror.edits || []).forEach(function (ed) {
      var i = byId[String(ed.txnId)]; if (i === undefined) return;
      var t = b.transactions[i], e = ed.entry;
      ['_origDetails', '_origCategory', '_origPayment', '_origDeposit'].forEach(function (k) { delete t[k]; });
      t.date = e.date; t.cheque = e.chequeNo || ''; t.details = e.payee || '';
      t.deposit = e.kind === 'income' ? e.amountMinor / 100 : 0;
      t.payment = e.kind === 'expense' ? e.amountMinor / 100 : 0;
      t.category = e.categoryId; t.megaId = e.entityId;
      changed = true;
    });
    (mirror.voids || []).forEach(function (v) {
      var i = byId[String(v.txnId)]; if (i === undefined) return;
      var t = b.transactions[i];
      if (String(t.category || '') === 'Cancelled') return;
      t._origDetails = t.details; t._origCategory = t.category; t._origPayment = t.payment; t._origDeposit = t.deposit;
      t.details = 'Cancelled Cheque' + (t.cheque ? '' : ' (' + t.details + ')');
      t.category = 'Cancelled'; t.payment = 0; t.deposit = 0;
      changed = true;
    });
    (mirror.deletions || []).forEach(function (d) {
      var i = byId[String(d.txnId)]; if (i === undefined) return;
      b.transactions.splice(i, 1);
      if (b.deletedTxnIds.indexOf(d.txnId) === -1) b.deletedTxnIds.push(d.txnId);
      byId = {}; b.transactions.forEach(function (t, j) { byId[String(t.id)] = j; });
      changed = true;
    });
    (mirror.newTxns || []).forEach(function (t) {
      if (byId[String(t.id)] !== undefined) return;
      byId[String(t.id)] = b.transactions.length;
      b.transactions.push(t);
      changed = true;
    });
    return { blob: b, changed: changed };
  }

  /* The shadow comparator: legacy quarter totals (the page's own calcTotals
     semantics — voided count zero, deleted are gone) vs the fold, to the
     cent, plus opening balance. */
  function cbReconcile(dal, quarters) {
    var rows = [], okAll = true;
    quarters.forEach(function (spec) {
      var blob = spec.blob || {};
      var deleted = {};
      (blob.deletedTxnIds || []).forEach(function (id) { deleted[String(id)] = 1; });
      var inc = 0, exp = 0;
      (blob.transactions || []).forEach(function (t) {
        if (!t || t.id == null || deleted[String(t.id)]) return;
        if (String(t.category || '') === 'Cancelled') return;            // voided counts ZERO, like calcTotals
        var dep = MG.cbToMinor(t.deposit).minor, pay = MG.cbToMinor(t.payment).minor;
        if (dep > 0 && pay > 0) return;                                  // ambiguous: bridge skipped it too
        if (dep > 0) inc += dep; else if (pay > 0) exp += pay;
      });
      var fold = quarterFold(dal, spec.fy, spec.q);
      var openLegacy = MG.cbToMinor(blob.openingBalance).minor;
      var row = {
        fy: spec.fy, q: spec.q,
        legacyIncomeMinor: inc, megaIncomeMinor: fold.incomeMinor,
        legacyExpenseMinor: exp, megaExpenseMinor: fold.expenseMinor,
        legacyOpeningMinor: openLegacy, megaOpeningMinor: fold.openingBalanceMinor,
        ok: inc === fold.incomeMinor && exp === fold.expenseMinor && openLegacy === fold.openingBalanceMinor
      };
      if (!row.ok) okAll = false;
      rows.push(row);
    });
    return { ok: okAll, quarters: rows };
  }

  /* ---------- budgets (registry: budget.set = whole-quarter replace) ------- */

  function parseBudgetKey(k) {
    var m = /^cestis_budget_(.+)_Q(\d)$/.exec(String(k || ''));
    return m ? { fy: m[1], q: parseInt(m[2], 10) } : null;
  }
  function budgetLines(blob) {
    var b = (blob && blob.budget) || {}, s = (blob && blob.sections) || {};
    return Object.keys(b).sort().map(function (cat) {
      return { categoryId: cat, sectionId: s[cat] || '', amountMinor: MG.cbToMinor(b[cat]).minor };
    });
  }
  /* Local budget vs folded budget: differ → one budget.set replaces the
     quarter (state-hashed event id: retries and same-state races converge;
     the next edit is a new state and its own audited event). */
  function cbBudgetPlan(dal, fy, q, blob) {
    var lines = budgetLines(blob);
    if (!lines.length) return Promise.resolve(null);
    return MG.bootstrapId('bud', 'bud|' + fy + '|Q' + q).then(function (bid) {
      var ent = dal.get('budget', bid);
      var current = (ent && ent.fields && ent.fields.lines) || [];
      if (MG.canon(current) === MG.canon(lines)) return null;
      return {
        entityId: bid, payload: { fy: fy, q: q, lines: lines },
        eventKey: 'budset|' + bid + '|' + MG.canon(current) + '|' + MG.canon(lines)
      };
    });
  }
  function cbBudgetPush(dal, plan, page) {
    if (!plan) return Promise.resolve(null);
    return MG.bridgeEventId(plan.eventKey).then(function (evtId) {
      return dal._accept('budget.set', plan.entityId, plan.payload, { id: evtId, prov: { importRun: 'bridge', srcFile: page || 'CESTIS.Cashbook', srcPath: plan.payload.fy + '|Q' + plan.payload.q } })
        .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
    });
  }
  /* Canonical budget → legacy blob (the mirror direction). Local-empty blobs
     adopt the canonical budget; a local non-empty blob that drifted pushes
     instead (cbBudgetPlan), so the mirror only fills devices that have no
     opinion yet — budgets are whole-replace, LWW by design. */
  function cbBudgetMirror(dal, fy, q, blob) {
    var lines = budgetLines(blob);
    return MG.bootstrapId('bud', 'bud|' + fy + '|Q' + q).then(function (bid) {
      var ent = dal.get('budget', bid);
      if (!ent || !ent.fields || !Array.isArray(ent.fields.lines) || !ent.fields.lines.length) return null;
      if (lines.length) return null;                     // local has an opinion: push path owns it
      var budget = {}, sections = {};
      ent.fields.lines.forEach(function (l) {
        budget[l.categoryId] = l.amountMinor / 100;
        if (l.sectionId) sections[l.categoryId] = l.sectionId;
      });
      return { budget: budget, sections: sections };
    });
  }

  return { parseQuarterKey: parseQuarterKey, cbTxnContent: cbTxnContent, cbPlanQuarter: cbPlanQuarter, cbPushPlan: cbPushPlan, cbMirrorQuarter: cbMirrorQuarter, cbApplyMirror: cbApplyMirror, cbReconcile: cbReconcile,
    parseBudgetKey: parseBudgetKey, budgetLines: budgetLines, cbBudgetPlan: cbBudgetPlan, cbBudgetPush: cbBudgetPush, cbBudgetMirror: cbBudgetMirror };
});
