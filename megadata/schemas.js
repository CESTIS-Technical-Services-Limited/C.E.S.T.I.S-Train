/* MegaData — canonical serialization, event envelope, and schema validation.
   Phase 5 step 1. Runs in the browser (window.MegaData) and Node (module.exports).
   Design contract: docs/02-MEGADATA-ARCHITECTURE.md §3–§6; principles P2/P4/P5/P8/P11.

   Everything durable is an EVENT with this envelope; money is always integer
   minor units; timestamps are UTC ISO strings; ordering is broker `seq`, never
   client clocks. The canonical serialization here is the one used for content
   hashes and for every byte-equality gate in Phase 6 — change it and every
   stored hash breaks, so it is versioned by the envelope `v`. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ENVELOPE_V = 1;

  /* ---------- canonical serialization (P7/P11) ---------- */
  // Deterministic: sorted keys, no undefined, no NaN/Infinity, no floats where
  // a 'minor' amount is expected (validators enforce that; canon just refuses
  // non-finite numbers outright).
  function canon(value) {
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'number') {
      if (!isFinite(value)) throw new Error('canon: non-finite number');
      if (Object.is(value, -0)) value = 0;
      return JSON.stringify(value);
    }
    if (t === 'boolean' || t === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']';
    if (t === 'object') {
      var keys = Object.keys(value).filter(function (k) { return value[k] !== undefined; }).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canon(value[k]); }).join(',') + '}';
    }
    throw new Error('canon: unsupported type ' + t);
  }

  /* ---------- hashing (async in both runtimes) ---------- */
  var nodeCrypto = null;
  try { if (typeof module !== 'undefined') nodeCrypto = require('crypto'); } catch (e) {}
  function sha256Hex(str) {
    if (nodeCrypto) return Promise.resolve(nodeCrypto.createHash('sha256').update(str, 'utf8').digest('hex'));
    var enc = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  /* ---------- ids (P5: minted, never derived from meaning) ---------- */
  function randHex(n) {
    var bytes;
    if (nodeCrypto) bytes = nodeCrypto.randomBytes(n);
    else { bytes = new Uint8Array(n); crypto.getRandomValues(bytes); }
    return Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  // Time-ordered unique id: ms timestamp base36 + 10 random bytes.
  function mintId(prefix, nowMs) {
    var ts = (nowMs != null ? nowMs : Date.now()).toString(36).padStart(9, '0');
    return prefix + '_' + ts + randHex(10);
  }
  // Migration ids are DETERMINISTIC so re-runs converge (P10).
  function migrationEventId(srcFileId, srcPath, transformV) {
    return sha256Hex([srcFileId, srcPath, 'v' + transformV].join('|')).then(function (h) {
      return 'evt_m' + h.slice(0, 24);
    });
  }

  /* ---------- field validators (compact DSL, P8) ---------- */
  var RE = {
    date: /^\d{4}-\d{2}-\d{2}$/,
    iso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/,
    fy: /^\d{4}\/\d{4}$/
  };
  function checkField(spec, val, path, errors) {
    if (val === undefined || val === null) {
      if (spec.required) errors.push(path + ': required');
      return;
    }
    var t = spec.t;
    if (t === 'minor') { // money: integer minor units only (P4)
      if (typeof val !== 'number' || !Number.isInteger(val)) errors.push(path + ': must be integer minor units');
      else if (spec.positive && val <= 0) errors.push(path + ': must be > 0');
    } else if (t === 'int') {
      if (!Number.isInteger(val)) errors.push(path + ': must be integer');
    } else if (t === 'string') {
      if (typeof val !== 'string') errors.push(path + ': must be string');
      else if (spec.nonEmpty && !val.trim()) errors.push(path + ': must be non-empty');
    } else if (t === 'bool') {
      if (typeof val !== 'boolean') errors.push(path + ': must be boolean');
    } else if (t === 'date') {
      if (typeof val !== 'string' || !RE.date.test(val)) errors.push(path + ': must be YYYY-MM-DD');
    } else if (t === 'iso') {
      if (typeof val !== 'string' || !RE.iso.test(val)) errors.push(path + ': must be UTC ISO-8601 (…Z)');
    } else if (t === 'fy') {
      if (typeof val !== 'string' || !RE.fy.test(val)) errors.push(path + ': must be YYYY/YYYY fiscal year');
    } else if (t === 'enum') {
      if (spec.values.indexOf(val) === -1) errors.push(path + ': must be one of ' + spec.values.join('|'));
    } else if (t === 'id') {
      if (typeof val !== 'string' || val.indexOf(spec.prefix + '_') !== 0) errors.push(path + ': must be a ' + spec.prefix + '_ id');
    } else if (t === 'eventId') {
      if (typeof val !== 'string' || val.indexOf('evt_') !== 0) errors.push(path + ': must be an evt_ id');
    } else if (t === 'array') {
      if (!Array.isArray(val)) { errors.push(path + ': must be array'); return; }
      if (spec.min != null && val.length < spec.min) errors.push(path + ': needs >= ' + spec.min + ' items');
      if (spec.items) val.forEach(function (item, i) { checkObject(spec.items, item, path + '[' + i + ']', errors); });
    } else if (t === 'object') {
      checkObject(spec.fields || {}, val, path, errors);
    } else if (t === 'any') {
      /* free-form, canon() still constrains it at hash time */
    } else {
      errors.push(path + ': unknown validator ' + t);
    }
  }
  function checkObject(fields, obj, path, errors) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) { errors.push(path + ': must be object'); return; }
    Object.keys(fields).forEach(function (k) { checkField(fields[k], obj[k], path + '.' + k, errors); });
    if (fields.__closed) {
      Object.keys(obj).forEach(function (k) {
        if (!(k in fields)) errors.push(path + '.' + k + ': unknown field');
      });
    }
  }

  /* ---------- event type registry (docs/02 §5) ----------
     entity: the entity kind the event is anchored to (its id in envelope.entity.id).
     creates: event mints the entity (broker registers it in the integrity index).
     needsNumber: broker-assigned number series (docs/02 §2).
     payload: field specs. Stateful rules live in broker-core (P8). */
  var VIREMENT_LINE = { fromCategoryId: { t: 'string', required: true, nonEmpty: true }, toCategoryId: { t: 'string', required: true, nonEmpty: true }, amountMinor: { t: 'minor', required: true, positive: true } };
  var REGISTRY = {
    // --- people & enrolment (P3) ---
    'person.registered':      { entity: 'person', creates: true, payload: { names: { t: 'object', required: true, fields: { full: { t: 'string', required: true, nonEmpty: true } } }, dob: { t: 'date' }, gender: { t: 'string' }, nationalId: { t: 'string' }, contacts: { t: 'object' }, guardians: { t: 'array' } } },
    'person.corrected':       { entity: 'person', payload: { diff: { t: 'object', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'person.merged':          { entity: 'person', payload: { loserId: { t: 'id', prefix: 'per', required: true }, evidence: { t: 'any', required: true }, tier: { t: 'enum', values: ['exact-id', 'strong-identifiers', 'human'], required: true } } },
    'person.tombstoned':      { entity: 'person', payload: { reason: { t: 'string', required: true, nonEmpty: true } } },
    'programme.defined':      { entity: 'programme', creates: true, payload: { name: { t: 'string', required: true, nonEmpty: true }, level: { t: 'string' }, nvqCode: { t: 'string' }, aliases: { t: 'array' } } },
    'intake.opened':          { entity: 'intake', creates: true, refs: { programme: 'programme' }, payload: { label: { t: 'string', required: true, nonEmpty: true }, start: { t: 'date', required: true }, end: { t: 'date' }, fiscalYear: { t: 'fy', required: true } } },
    'enrolment.created':      { entity: 'enrolment', creates: true, refs: { person: 'person', intake: 'intake' }, payload: { enrolledAt: { t: 'date', required: true } } },
    'enrolment.statusChanged':{ entity: 'enrolment', payload: { to: { t: 'enum', values: ['active', 'completed', 'withdrawn', 'nyc'], required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'enrolment.transferred':  { entity: 'enrolment', refs: { toIntake: 'intake' }, payload: { reason: { t: 'string', required: true, nonEmpty: true } } },
    // --- fees (P4) ---
    'fees.schedule.set':      { entity: 'feeSchedule', creates: true, refs: { intake: 'intake' }, payload: { totalMinor: { t: 'minor', required: true }, terms: { t: 'array', required: true, min: 1, items: { no: { t: 'int', required: true }, amountMinor: { t: 'minor', required: true }, dueDate: { t: 'date' } } } } },
    'fees.charge.assessed':   { entity: 'enrolment', payload: { termNo: { t: 'int', required: true }, amountMinor: { t: 'minor', required: true, positive: true }, dueDate: { t: 'date' } } },
    'fees.payment.recorded':  { entity: 'enrolment', needsNumber: 'receipt', payload: { amountMinor: { t: 'minor', required: true, positive: true }, method: { t: 'enum', values: ['cash', 'cheque', 'transfer', 'card', 'other'], required: true }, date: { t: 'date', required: true }, reference: { t: 'string' }, receiptNo: { t: 'string' }, legacyReceiptNo: { t: 'string' } } },
    'fees.payment.reversed':  { entity: 'enrolment', payload: { paymentEventId: { t: 'eventId', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'fees.adjustment.applied':{ entity: 'enrolment', payload: { amountMinor: { t: 'minor', required: true }, kind: { t: 'enum', values: ['waiver', 'discount', 'writeoff', 'correction'], required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    // --- cashbook / finance ---
    // NOTE (client decision D11, 2026-08-05): the cashbook is a SEPARATE book from
    // the school-fee ledger — deliberately no fee-payment link field here.
    'cashbook.entry.recorded':{ entity: 'cashbookEntry', creates: true, payload: { fy: { t: 'fy', required: true }, q: { t: 'int', required: true }, date: { t: 'date', required: true }, kind: { t: 'enum', values: ['income', 'expense'], required: true }, categoryId: { t: 'string', required: true, nonEmpty: true }, amountMinor: { t: 'minor', required: true, positive: true }, chequeNo: { t: 'string' }, payee: { t: 'string' }, legacyTxnId: { t: 'string' }, supersedes: { t: 'string' } } },
    'cashbook.cheque.voided': { entity: 'cashbookEntry', payload: { reason: { t: 'string', required: true, nonEmpty: true } } },
    'cashbook.quarter.opened':{ entity: 'cashbookQuarter', creates: true, payload: { fy: { t: 'fy', required: true }, q: { t: 'int', required: true }, openingBalanceMinor: { t: 'minor', required: true } } },
    'budget.set':             { entity: 'budget', creates: true, payload: { fy: { t: 'fy', required: true }, q: { t: 'int', required: true }, lines: { t: 'array', required: true, items: { categoryId: { t: 'string', required: true, nonEmpty: true }, sectionId: { t: 'string' }, amountMinor: { t: 'minor', required: true } } } } },
    'virement.requested':     { entity: 'virement', creates: true, payload: { fy: { t: 'fy', required: true }, q: { t: 'int', required: true }, lines: { t: 'array', required: true, min: 1, items: VIREMENT_LINE }, requestedBy: { t: 'string', required: true, nonEmpty: true } } },
    'virement.decided':       { entity: 'virement', payload: { decision: { t: 'enum', values: ['approved', 'rejected'], required: true }, note: { t: 'string' }, decidedBy: { t: 'string' }, decidedOn: { t: 'date' } } },
    'findoc.issued':          { entity: 'findoc', creates: true, needsNumber: 'findoc', payload: { kind: { t: 'enum', values: ['invoice', 'quote', 'po', 'voucher'], required: true }, number: { t: 'string' }, doc: { t: 'any', required: true } } },
    'findoc.superseded':      { entity: 'findoc', payload: { diff: { t: 'object', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'findoc.voided':          { entity: 'findoc', payload: { reason: { t: 'string', required: true, nonEmpty: true } } },
    // --- payroll & time ---
    'payroll.run.recorded':   { entity: 'payrollRun', creates: true, payload: { month: { t: 'string', required: true, nonEmpty: true }, rateTableV: { t: 'int', required: true }, lines: { t: 'array', required: true, min: 1, items: { staffId: { t: 'id', prefix: 'stf', required: true }, grossMinor: { t: 'minor', required: true }, deductionsMinor: { t: 'object', required: true }, netMinor: { t: 'minor', required: true } } } } },
    'payroll.line.corrected': { entity: 'payrollRun', payload: { staffId: { t: 'id', prefix: 'stf', required: true }, diff: { t: 'object', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'time.clockedIn':         { entity: 'timeRecord', creates: true, refs: { staff: 'staff' }, payload: { at: { t: 'iso', required: true } } },
    'time.clockedOut':        { entity: 'timeRecord', payload: { at: { t: 'iso', required: true } } },
    'time.corrected':         { entity: 'timeRecord', payload: { diff: { t: 'object', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    // --- attendance & assessment ---
    'attendance.marked':      { entity: 'enrolment', payload: { date: { t: 'date', required: true }, status: { t: 'enum', values: ['present', 'absent', 'late'], required: true }, sessionId: { t: 'string' } } },
    'attendance.corrected':   { entity: 'enrolment', payload: { markEventId: { t: 'eventId', required: true }, newStatus: { t: 'enum', values: ['present', 'absent', 'late'], required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'assessment.result.recorded':  { entity: 'enrolment', payload: { examId: { t: 'string', required: true, nonEmpty: true }, scorePct: { t: 'int' }, detail: { t: 'any' } } },
    'assessment.result.overridden':{ entity: 'enrolment', payload: { resultEventId: { t: 'eventId', required: true }, grade: { t: 'any', required: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    // --- certification ---
    'cert.approved':          { entity: 'enrolment', payload: {} },
    'cert.issued':            { entity: 'enrolment', needsNumber: 'cert', payload: { certNo: { t: 'string' }, templateId: { t: 'string' } } },
    'cert.collected':         { entity: 'enrolment', payload: {} },
    // --- adjudication, Tier B docs, admin ---
    'identity.adjudicated':   { entity: 'adjudication', payload: { itemId: { t: 'string', required: true, nonEmpty: true }, decision: { t: 'string', required: true, nonEmpty: true }, note: { t: 'string' } } },
    'doc.upserted':           { entity: 'doc', payload: { kind: { t: 'string', required: true, nonEmpty: true }, diff: { t: 'object', required: true }, reason: { t: 'string' } } },
    'doc.tombstoned':         { entity: 'doc', payload: { kind: { t: 'string', required: true, nonEmpty: true }, reason: { t: 'string', required: true, nonEmpty: true } } },
    'admin.noteAppended':     { entity: 'doc', payload: { text: { t: 'string', required: true, nonEmpty: true }, entityRef: { t: 'string' } } }
  };
  Object.keys(REGISTRY).forEach(function (t) { REGISTRY[t].schemaV = REGISTRY[t].schemaV || 1; });

  /* ---------- envelope build & validate ---------- */
  var ENVELOPE_FIELDS = {
    v: { t: 'int', required: true }, id: { t: 'eventId', required: true },
    type: { t: 'string', required: true, nonEmpty: true }, schemaV: { t: 'int', required: true },
    entity: { t: 'object', required: true, fields: { kind: { t: 'string', required: true, nonEmpty: true }, id: { t: 'string', required: true, nonEmpty: true } } },
    refs: { t: 'object' }, payload: { t: 'object', required: true },
    actor: { t: 'object', required: true, fields: { account: { t: 'string' }, name: { t: 'string', required: true, nonEmpty: true }, role: { t: 'string', required: true, nonEmpty: true }, device: { t: 'string' } } },
    at: { t: 'iso', required: true }, source: { t: 'string', required: true, nonEmpty: true },
    cause: { t: 'string' }, corr: { t: 'string' }, prov: { t: 'object' }, hash: { t: 'string' }
  };

  // The hash covers the canonical form minus broker-assigned / self fields.
  // `assigned` carries broker-issued numbers (receiptNo/certNo/…) so the
  // client-computed hash stays valid after append (docs/02 §2, §9).
  var BROKER_FIELDS = { seq: 1, brokerAt: 1, hash: 1, assigned: 1 };
  function hashBasis(evt) {
    var copy = {};
    Object.keys(evt).forEach(function (k) {
      if (!BROKER_FIELDS[k]) copy[k] = evt[k];
    });
    return canon(copy);
  }

  function validateEvent(evt) {
    var errors = [];
    checkObject(ENVELOPE_FIELDS, evt, 'event', errors);
    if (errors.length) return { ok: false, errors: errors };
    var reg = REGISTRY[evt.type];
    if (!reg) return { ok: false, errors: ['event.type: unknown type ' + evt.type] };
    if (evt.schemaV !== reg.schemaV) errors.push('event.schemaV: expected ' + reg.schemaV + ' for ' + evt.type);
    if (evt.entity.kind !== reg.entity) errors.push('event.entity.kind: expected ' + reg.entity + ' for ' + evt.type);
    checkObject(reg.payload, evt.payload, 'payload', errors);
    if (reg.refs) {
      Object.keys(reg.refs).forEach(function (r) {
        if (!evt.refs || typeof evt.refs[r] !== 'string' || !evt.refs[r]) errors.push('refs.' + r + ': required for ' + evt.type);
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  // Build a full event (mints id, stamps hash). opts: {id?, at?, entityId?, refs, cause, corr, prov, nowMs?}
  function buildEvent(type, entityId, payload, actor, source, opts) {
    opts = opts || {};
    var reg = REGISTRY[type];
    if (!reg) return Promise.reject(new Error('unknown event type ' + type));
    var evt = {
      v: ENVELOPE_V,
      id: opts.id || mintId('evt', opts.nowMs),
      type: type, schemaV: reg.schemaV,
      entity: { kind: reg.entity, id: entityId },
      refs: opts.refs || {}, payload: payload || {},
      actor: actor, at: opts.at || new Date(opts.nowMs != null ? opts.nowMs : Date.now()).toISOString(),
      source: source,
      cause: opts.cause || null, corr: opts.corr || null,
      prov: opts.prov || null
    };
    var v = validateEvent(evt);
    if (!v.ok) return Promise.reject(Object.assign(new Error('invalid event: ' + v.errors.join('; ')), { errors: v.errors }));
    return sha256Hex(hashBasis(evt)).then(function (h) { evt.hash = 'sha256:' + h; return evt; });
  }

  function verifyEventHash(evt) {
    return sha256Hex(hashBasis(evt)).then(function (h) { return evt.hash === 'sha256:' + h; });
  }

  return {
    ENVELOPE_V: ENVELOPE_V, REGISTRY: REGISTRY,
    canon: canon, sha256Hex: sha256Hex,
    mintId: mintId, migrationEventId: migrationEventId,
    validateEvent: validateEvent, buildEvent: buildEvent,
    verifyEventHash: verifyEventHash, hashBasis: hashBasis
  };
});
