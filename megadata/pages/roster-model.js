/* MegaData — roster model shared by the Student-Progress bridge and (via a
   drift-guard test) the bootstrap pipeline.

   The id-derivation strings here MUST stay byte-identical to
   bootstrap-core.js (detId + its key formats): a live-bridged trainee and a
   bootstrap-imported one land on the SAME person/enrolment/roster entities.
   tests/megadata-sp.test.js asserts that equality — if either side drifts,
   the suite fails loudly instead of minting duplicate people. */
(function (root, factory) {
  var MD = (typeof module !== 'undefined' && module.exports) ? require('../schemas.js') : root.MegaData;
  var api = factory(MD);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function (MD) {
  'use strict';

  function normProg(s) { return String(s || 'unassigned').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function bootstrapId(prefix, key) {
    return MD.sha256Hex('mega-bootstrap|' + key).then(function (h) { return prefix + '_m' + h.slice(0, 20); });
  }
  // Deterministic BRIDGE event ids: two devices bridging the same new trainee
  // build the same event id, so the broker's replay dedupe answers the loser
  // with the winner's ack instead of a duplicate-entity rejection (P10).
  function bridgeEventId(key) {
    return MD.sha256Hex('mega-bridge|' + key).then(function (h) { return 'evt_m' + h.slice(0, 24); });
  }

  // Identity ids for one (identity key, programme) pair — the same values the
  // bootstrap synthesis derives for group key gk.
  function identityIds(gk, progName) {
    var pk = normProg(progName);
    return Promise.all([
      bootstrapId('per', 'person|' + gk),
      bootstrapId('enr', 'enrolment|' + gk + '|' + pk),
      bootstrapId('prg', 'programme|' + pk),
      bootstrapId('int', 'intake|' + pk + '|legacy'),
      bootstrapId('doc', 'roster|' + gk + '|' + pk)
    ]).then(function (ids) {
      return { personId: ids[0], enrolmentId: ids[1], programmeId: ids[2], intakeId: ids[3], rosterDocId: ids[4], progNorm: pk };
    });
  }

  var ROSTER_FIELDS = ['stage', 'progress', 'score', 'gpa', 'attendance', 'assignments', 'assignmentsTotal',
    'certNo', 'certDate', 'certCollected', 'instructor', 'notes', 'nqfLevel'];

  function lmsRosterDiff(f) {
    var diff = {};
    ROSTER_FIELDS.forEach(function (k) {
      if (f[k] !== undefined && f[k] !== null && f[k] !== '') diff[k] = f[k];
    });
    diff.lmsId = f.id;
    return diff;
  }

  function lmsBio(f) {
    var bio = { names: { full: f.name || '(unnamed)' } };
    var dob = String(f.dateOfBirth || f.dob || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) bio.dob = dob;
    var nid = String(f.nationalId || f.trn || '');
    if (nid) bio.nationalId = nid;
    bio.contacts = { phone: f.contact || f.phone || '', email: f.email || '', address: f.address || '', city: f.city || '' };
    return bio;
  }

  // Does the stored roster document already reflect this legacy record?
  function rosterDrifted(legacyRec, docEntity) {
    if (!docEntity || !docEntity.fields) return true;
    var want = lmsRosterDiff(legacyRec), have = docEntity.fields;
    return ROSTER_FIELDS.concat(['lmsId']).some(function (k) {
      var w = want[k]; if (w === undefined) return false;
      return String(have[k] === undefined ? '' : have[k]) !== String(w);
    });
  }

  /* ---------- stage 2: two-way merge between legacy roster and canon ----------
     Mutable roster scalars need what append-only money did not: a per-field
     THREE-WAY merge against a locally persisted baseline, or two
     legacy-primary devices ping-pong each other's edits forever. Rules:
       - changed locally only            → push (an audited event)
       - changed remotely only           → apply to the legacy record
       - both changed, different values  → push local (it becomes the newer
         event — LAST WRITER, both versions in the audit trail) + report
       - no baseline yet (first stage-2 contact) → remote treated as base, so
         local differences push, exactly like stage 1's legacy-primary rule.
     A roster deletion is NOT a person tombstone: the person may still owe
     fees (the books are separate, D11) — it tombstones the roster DOC and
     withdraws the enrolment, nothing else. */

  function S(v) { return v === undefined || v === null ? '' : String(v); }
  var BIO_FIELDS = ['name', 'dob', 'nationalId', 'phone', 'email', 'address', 'city'];
  var BIO_TO_LEGACY = { name: 'name', dob: 'dateOfBirth', nationalId: 'nationalId', phone: 'contact', email: 'email', address: 'address', city: 'city' };

  function bioFlatFromLegacy(rec) {
    var dob = String(rec.dateOfBirth || rec.dob || '');
    return {
      name: String(rec.name || '(unnamed)'), dob: /^\d{4}-\d{2}-\d{2}$/.test(dob) ? dob : '',
      nationalId: String(rec.nationalId || rec.trn || ''), phone: String(rec.contact || rec.phone || ''),
      email: String(rec.email || ''), address: String(rec.address || ''), city: String(rec.city || '')
    };
  }
  function bioFlatFromPerson(person) {
    var f = (person && person.fields) || {}, c = f.contacts || {};
    return { name: (f.names && f.names.full) || '', dob: f.dob || '', nationalId: f.nationalId || '',
      phone: c.phone || '', email: c.email || '', address: c.address || '', city: c.city || '' };
  }
  function bioNestedDiff(flat) {
    var d = { names: { full: flat.name }, contacts: { phone: flat.phone, email: flat.email, address: flat.address, city: flat.city } };
    if (flat.dob) d.dob = flat.dob;
    if (flat.nationalId) d.nationalId = flat.nationalId;
    return d;
  }
  function rosterFlatFromDoc(doc) {
    var f = (doc && doc.fields) || {}, out = {};
    ROSTER_FIELDS.forEach(function (k) { if (f[k] !== undefined) out[k] = f[k]; });
    return out;
  }

  function threeWay(fieldList, base, local, remote) {
    var push = {}, apply = {}, conflicts = [];
    fieldList.forEach(function (k) {
      var l = S(local[k]), r = S(remote[k]);
      var b = base ? S(base[k]) : r;                    // no baseline → remote is the base
      var lc = l !== b, rc = r !== b;
      if (lc && rc && l !== r) { push[k] = local[k]; conflicts.push({ field: k, base: b, local: l, remote: r }); }
      else if (lc) push[k] = local[k];
      else if (rc) apply[k] = remote[k];
    });
    return { push: push, apply: apply, conflicts: conflicts };
  }

  // Creation chain for one legacy record (programme/intake/person/enrolment +
  // initial roster doc) — the exact stage-1 sequence, now shared by page and
  // tests instead of duplicated.
  function spBridgeRecord(dal, rec, page) {
    return identityIds('id:' + rec.id, rec.course).then(function (ids) {
      var steps = [];
      if (!dal.get('programme', ids.programmeId)) steps.push(['programme.defined', ids.programmeId, { name: rec.course || 'Unassigned' }, null, 'programme|' + ids.progNorm]);
      if (!dal.get('intake', ids.intakeId)) steps.push(['intake.opened', ids.intakeId, { label: (rec.course || 'Unassigned') + ' (legacy)', start: '2024-04-01', fiscalYear: '2024/2025' }, { programme: ids.programmeId }, 'intake|' + ids.progNorm]);
      if (!dal.get('person', ids.personId)) steps.push(['person.registered', ids.personId, lmsBio(rec), null, 'person|id:' + rec.id]);
      if (!dal.get('enrolment', ids.enrolmentId)) {
        var at = /^\d{4}-\d{2}-\d{2}/.test(String(rec.enrolmentDate || rec.enrollDate || '')) ? String(rec.enrolmentDate || rec.enrollDate).slice(0, 10) : '2024-04-01';
        steps.push(['enrolment.created', ids.enrolmentId, { enrolledAt: at }, { person: ids.personId, intake: ids.intakeId }, 'enrolment|id:' + rec.id + '|' + ids.progNorm]);
      }
      return steps.reduce(function (pr, st) {
        return pr.then(function () {
          return bridgeEventId(st[4]).then(function (evtId) {
            return dal._accept(st[0], st[1], st[2], { id: evtId, refs: st[3] || undefined, prov: { importRun: 'bridge', srcFile: page || 'Student-Progress', srcPath: rec.id } })
              .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
          });
        });
      }, Promise.resolve()).then(function () {
        if (dal.get('doc', ids.rosterDocId)) return ids;
        return bridgeEventId('roster-init|id:' + rec.id + '|' + ids.progNorm).then(function (evtId) {
          return dal._accept('doc.upserted', ids.rosterDocId,
            { kind: 'legacyRoster', diff: lmsRosterDiff(rec), reason: 'legacy bridge' },
            { id: evtId, prov: { importRun: 'bridge', srcFile: page || 'Student-Progress', srcPath: rec.id } }).then(function () { return ids; });
        });
      });
    });
  }

  /* Compute the whole tick's work. legacy = { students, deletedIds };
     baseline = { lmsId: { bio: flat, roster: flat } } from the last tick. */
  function spMergePlan(dal, legacy, baseline) {
    baseline = baseline || {};
    var tomb = {};
    (legacy.deletedIds || []).forEach(function (id) { tomb[id] = 1; });
    var live = (legacy.students || []).filter(function (r) { return r && r.id && !tomb[r.id]; });
    var plan = { creates: [], pushBio: [], pushRoster: [], applies: [], newRecords: [], removals: [], tombstones: [], conflicts: [], skippedDocs: [], newBaseline: {} };
    var seen = {};

    return live.reduce(function (pr, rec) {
      return pr.then(function () {
        return identityIds('id:' + rec.id, rec.course).then(function (ids) {
          seen[rec.id] = 1;
          var person = dal.get('person', ids.personId);
          var doc = dal.get('doc', ids.rosterDocId);
          if (!person || !doc) { plan.creates.push(rec); plan.newBaseline[rec.id] = { bio: bioFlatFromLegacy(rec), roster: rosterFlatFromDoc({ fields: lmsRosterDiff(rec) }) }; return; }
          if (!doc.alive) { plan.removals.push(rec.id); return; }        // canonically deleted → mirror the deletion in
          var base = baseline[rec.id] || null;
          var bioL = bioFlatFromLegacy(rec), bioR = bioFlatFromPerson(person);
          var bio = threeWay(BIO_FIELDS, base && base.bio, bioL, bioR);
          var rosL = {}, rosR = rosterFlatFromDoc(doc);
          ROSTER_FIELDS.forEach(function (k) { if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') rosL[k] = rec[k]; });
          var ros = threeWay(ROSTER_FIELDS, base && base.roster, rosL, rosR);
          if (Object.keys(bio.push).length) plan.pushBio.push({ lmsId: rec.id, personId: ids.personId, current: bioR, merged: Object.assign({}, bioL) });
          if (Object.keys(ros.push).length) plan.pushRoster.push({ lmsId: rec.id, docId: ids.rosterDocId, current: rosR, diff: ros.push });
          var patch = {};
          Object.keys(bio.apply).forEach(function (k) { patch[BIO_TO_LEGACY[k]] = bio.apply[k]; });
          Object.keys(ros.apply).forEach(function (k) { patch[k] = ros.apply[k]; });
          if (Object.keys(patch).length) plan.applies.push({ lmsId: rec.id, patch: patch });
          plan.conflicts = plan.conflicts.concat(bio.conflicts.concat(ros.conflicts).map(function (c) { return Object.assign({ lmsId: rec.id }, c); }));
          // Converged values after this tick = remote ⊕ pushes (pushes win), per field.
          var nb = { bio: {}, roster: {} };
          BIO_FIELDS.forEach(function (k) { nb.bio[k] = (k in bio.push) ? bioL[k] : (k in bio.apply ? bio.apply[k] : bioR[k]); });
          ROSTER_FIELDS.forEach(function (k) {
            var v = (k in ros.push) ? rosL[k] : (k in ros.apply ? ros.apply[k] : rosR[k]);
            if (v !== undefined) nb.roster[k] = v;
          });
          plan.newBaseline[rec.id] = nb;
        });
      });
    }, Promise.resolve()).then(function () {
      // Locally deleted but canonically still on the roster → tombstone the
      // DOC + withdraw. Course unknown after deletion: find docs by lmsId.
      (legacy.deletedIds || []).forEach(function (id) {
        dal.find('doc', function (d2) { return d2.fields && d2.fields.docKind === 'legacyRoster' && String(d2.fields.lmsId) === String(id) && d2.alive; })
          .forEach(function (d2) { plan.tombstones.push({ lmsId: id, docId: d2.id }); });
      });
      return null;
    }).then(function () {
      // Canonical-only trainees → new legacy records (never resurrect a local tombstone).
      var docs = dal.find('doc', function (d2) { return d2.fields && d2.fields.docKind === 'legacyRoster' && d2.alive && d2.fields.lmsId; });
      return docs.reduce(function (pr, d2) {
        return pr.then(function () {
          var lmsId = String(d2.fields.lmsId);
          if (seen[lmsId] || tomb[lmsId]) return;
          return bootstrapId('per', 'person|id:' + lmsId).then(function (personId) {
            var person = dal.get('person', personId);
            if (!person || !person.alive) { plan.skippedDocs.push({ docId: d2.id, lmsId: lmsId, reason: 'no person under id:' + lmsId + ' — unified under another identity; adjudication owns it' }); return; }
            var enrs = dal.find('enrolment', function (e2) { return e2.fields.personId === personId && e2.alive && e2.fields.status !== 'withdrawn'; });
            return enrs.reduce(function (pr2, e2) {
              return pr2.then(function (found) {
                if (found) return found;
                var intake = dal.get('intake', e2.fields.intakeId);
                var prog = intake && dal.get('programme', intake.fields.programmeId);
                var progName = (prog && prog.fields.name) || 'Unassigned';
                return bootstrapId('doc', 'roster|id:' + lmsId + '|' + normProg(progName)).then(function (docId) {
                  return docId === d2.id ? { progName: progName, enrolledAt: e2.fields.enrolledAt } : null;
                });
              });
            }, Promise.resolve(null)).then(function (found) {
              if (!found) { plan.skippedDocs.push({ docId: d2.id, lmsId: lmsId, reason: 'no matching enrolment for this roster doc' }); return; }
              var rec = { id: lmsId, course: found.progName };
              var b = bioFlatFromPerson(person);
              Object.keys(BIO_TO_LEGACY).forEach(function (k) { if (b[k]) rec[BIO_TO_LEGACY[k]] = b[k]; });
              ROSTER_FIELDS.forEach(function (k) { var v = d2.fields[k]; if (v !== undefined && v !== null && v !== '') rec[k] = v; });
              if (found.enrolledAt) rec.enrolmentDate = found.enrolledAt;
              plan.newRecords.push(rec);
              plan.newBaseline[lmsId] = { bio: b, roster: rosterFlatFromDoc(d2) };
            });
          });
        });
      }, Promise.resolve());
    }).then(function () { return plan; });
  }

  /* Emit the plan's events. Push event ids hash (current canonical state +
     the diff): a retry or a same-state device race converges on one event,
     while a later toggle back is a NEW state and lands as its own event. */
  function spPushPlan(dal, plan, page) {
    var prov = function (srcPath) { return { importRun: 'bridge', srcFile: page || 'Student-Progress', srcPath: srcPath }; };
    return plan.creates.reduce(function (pr, rec) { return pr.then(function () { return spBridgeRecord(dal, rec, page); }); }, Promise.resolve())
      .then(function () {
        return plan.pushBio.reduce(function (pr, p) {
          return pr.then(function () {
            var diff = bioNestedDiff(p.merged);
            return bridgeEventId('bio|' + p.personId + '|' + MD.canon(p.current) + '|' + MD.canon(diff)).then(function (evtId) {
              return dal._accept('person.corrected', p.personId, { diff: diff, reason: 'legacy roster edit' }, { id: evtId, prov: prov(p.lmsId) })
                .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return plan.pushRoster.reduce(function (pr, p) {
          return pr.then(function () {
            return bridgeEventId('roster2|' + p.docId + '|' + MD.canon(p.current) + '|' + MD.canon(p.diff)).then(function (evtId) {
              return dal._accept('doc.upserted', p.docId, { kind: 'legacyRoster', diff: p.diff, reason: 'legacy drift' }, { id: evtId, prov: prov(p.lmsId) })
                .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return plan.tombstones.reduce(function (pr, t) {
          return pr.then(function () {
            return bridgeEventId('tomb-roster|' + t.docId).then(function (evtId) {
              return dal._accept('doc.tombstoned', t.docId, { kind: 'legacyRoster', reason: 'legacy roster deletion' }, { id: evtId, prov: prov(t.lmsId) })
                .catch(function (e) { if (!/exists/.test(e.message)) throw e; });
            }).then(function () {
              // Withdraw ONLY this person's enrolment behind this exact doc —
              // docId hashes (lmsId, programme), so the person filter is what
              // keeps a classmate's enrolment out of reach.
              return bootstrapId('per', 'person|id:' + t.lmsId).then(function (personId) {
                var enrs = dal.find('enrolment', function (e2) { return e2.alive && e2.fields.personId === personId && e2.fields.status === 'active'; });
                return enrs.reduce(function (pr2, e2) {
                  return pr2.then(function () {
                    var intake = dal.get('intake', e2.fields.intakeId);
                    var prog = intake && dal.get('programme', intake.fields.programmeId);
                    return bootstrapId('doc', 'roster|id:' + t.lmsId + '|' + normProg((prog && prog.fields.name) || 'Unassigned')).then(function (docId) {
                      if (docId !== t.docId) return;
                      return bridgeEventId('withdraw|' + e2.id).then(function (evtId) {
                        return dal._accept('enrolment.statusChanged', e2.id, { to: 'withdrawn', reason: 'legacy roster deletion' }, { id: evtId, prov: prov(t.lmsId) })
                          .catch(function (err) { if (!/exists/.test(err.message)) throw err; });
                      });
                    });
                  });
                }, Promise.resolve());
              });
            });
          });
        }, Promise.resolve());
      });
  }

  /* Pure application of a plan to the legacy arrays (what the page and the
     tests both run). Returns fresh arrays + whether anything changed. */
  function spApplyPlanToLegacy(students, deletedIds, plan) {
    var changed = false;
    var byId = {};
    var out = (students || []).map(function (r) { byId[r.id] = r; return r; });
    plan.applies.forEach(function (a) {
      var r = byId[a.lmsId]; if (!r) return;
      Object.keys(a.patch).forEach(function (k) { if (S(r[k]) !== S(a.patch[k])) { r[k] = a.patch[k]; changed = true; } });
    });
    plan.newRecords.forEach(function (r) { if (!byId[r.id]) { out.push(r); byId[r.id] = r; changed = true; } });
    var dels = (deletedIds || []).slice();
    plan.removals.forEach(function (id) {
      if (dels.indexOf(id) === -1) { dels.push(id); changed = true; }
      var i = out.findIndex(function (r) { return r.id === id; });
      if (i !== -1) { out.splice(i, 1); changed = true; }
    });
    return { students: out, deletedIds: dels, changed: changed };
  }

  return { normProg: normProg, bootstrapId: bootstrapId, bridgeEventId: bridgeEventId, identityIds: identityIds, lmsRosterDiff: lmsRosterDiff, lmsBio: lmsBio, rosterDrifted: rosterDrifted, ROSTER_FIELDS: ROSTER_FIELDS,
    BIO_FIELDS: BIO_FIELDS, bioFlatFromLegacy: bioFlatFromLegacy, bioFlatFromPerson: bioFlatFromPerson, bioNestedDiff: bioNestedDiff, rosterFlatFromDoc: rosterFlatFromDoc, threeWay: threeWay,
    spBridgeRecord: spBridgeRecord, spMergePlan: spMergePlan, spPushPlan: spPushPlan, spApplyPlanToLegacy: spApplyPlanToLegacy };
});
