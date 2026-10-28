/* ============================================================================
   cestis-gate-client.js — a trainee's side of the "trainee gate"
   (docs/trainee-gate/DESIGN.md, Stage 4).

   WHAT IT IS
   ----------
   When the Centre has set the trainee gate up and turned it on, a trainee
   signs in through it from any device — their own phone at home, a lab PC —
   and that device is given ONLY that trainee's own records (their "slice").
   Everything the trainee does is first kept on the device, then sent back as
   small sealed items the gate checks before the Centre takes them. This file
   is the device's half of that conversation; index.html does the screens.

     CESTISGate.configure({...})        what the page hands in (hashing, callbacks)
     CESTISGate.base()                  which gate this device talks to (by origin)
     CESTISGate.signIn / signInEmail / twoStep / twoStepSend
     CESTISGate.registerStart / registerSubmit / catalogue
                                        a new trainee registering from home (§17)
     CESTISGate.enter(session)          into the gate's own store namespace (then reload)
     CESTISGate.pull / applyPull        the trainee's records, into that namespace
     CESTISGate.paper / attempt / review / upload / fileGet / roomGet
     CESTISGate.queue / deliver         the device-wide outbox
     CESTISGate.capture                 what the trainee changed, sealed into the outbox
     CESTISGate.signOut / leave         out of the namespace again

   NOTHING HERE RUNS UNTIL IT IS SET UP AND SWITCHED ON. Loading this file
   only defines CESTISGate; with the gate off the page never calls it, and the
   sign-in and every page behave exactly as before.

   WHERE THINGS ARE KEPT ON THE DEVICE (§7.1)
   - A gate session runs in its OWN store namespace: localStorage key
     cestisGateNs = 'g1' makes the store (cestis-core.js / index.html) open
     CESTIS_KV__g1 and keep its keys under 'g1::'. A lab PC's Centre records
     are never read, changed or wiped by a trainee's session.
   - The outbox is device-wide and outside both namespaces: IndexedDB
     CESTIS_GATE_OUTBOX. Any later session on the device delivers what waits
     there — whoever is signed in, or nobody — because every item carries its
     own seal (HMAC with the session key). Nothing is dropped without a
     receipt: 'revoked' waits to be sealed again at the same trainee's next
     sign-in, 'retry' is sent again later, anything else is kept, marked
     refused, for the office to look at.
   - The gate's address from the trainee's link (#gate=…) is device-only
     (cestisGateAddress).

   Every word a person sees is in index.html, and none of it says where the
   records are kept (tools/scan-ui-wording.js). This file returns codes.
   ============================================================================ */
(function (root) {
  'use strict';
  if (root.CESTISGate && root.CESTISGate.signIn) return;
  var Core = root.CESTISCore;
  var G = Core && Core.gate;

  var PROTOCOL = 1;
  var NS = 'g1';
  var NS_PREFIX = NS + '::';
  var LAN_PATH = '/_cestis/gate';
  var OUTBOX_DB = 'CESTIS_GATE_OUTBOX', OUTBOX_STORE = 'items';
  var BACKOFF_MIN_MS = 2000, BACKOFF_MAX_MS = 5 * 60 * 1000;
  var RETRY_EVERY_MS = 30 * 1000;
  var PULL_EVERY_MS = 5 * 60 * 1000;
  var DELIVER_BATCH = 50;                 // the gate takes up to 200 items a request
  var CALL_TIMEOUT_MS = 20000, UPLOAD_TIMEOUT_MS = 90000;
  var LANE_LOCK = 'cestis-gate-lane';
  // What a trainee writes (DESIGN.md §5.2): kept in the namespace by these keys.
  var OWN_LISTS = { voctrain_examAttempts: 1, voctrain_submissions: 1, voctrain_certTranscriptRequests: 1, voctrain_support_messages: 1 };
  var OWN_MAPS = { voctrain_studentProfiles: 1 };
  var WATCHED = ['voctrain_examAttempts', 'voctrain_submissions', 'voctrain_certTranscriptRequests', 'voctrain_support_messages',
    'voctrain_studentProfiles', 'voctrain_chatMessages', 'voctrain_announcements', 'voctrain_notifications'];
  var BASE_KEY = 'cestisGateBase';        // in the namespace: what has already been sealed or came from the gate
  var SESSION_KEYS = { token: 'cestisGateToken', key: 'cestisGateSessionKey', mode: 'cestisGateMode' };

  /* ------------------------------------------------------------ small helpers */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return v == null ? '' : String(v); }
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function msOf(v) { if (typeof v === 'number') return isFinite(v) && v > 0 ? v : 0; var t = Date.parse(v || ''); return isFinite(t) && t > 0 ? t : 0; }
  function parse(text, fallback) { if (text == null) return fallback; try { var v = JSON.parse(text); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function randomId(n) {
    var s = '', abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    try {
      var b = new Uint8Array(n);
      root.crypto.getRandomValues(b);
      for (var i = 0; i < n; i++) s += abc.charAt(b[i] % abc.length);
      return s;
    } catch (e) {}
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  }
  function hashOf(v) { return G.hashOf(v); }
  function stampOf(r) {
    if (!isObj(r)) return 0;
    return Math.max(msOf(r.updatedAt), msOf(r.lastModified), msOf(r.timestamp), msOf(r.submittedAt), msOf(r.requestedAt), msOf(r.createdAt), msOf(r.savedAt));
  }

  /* ================================================================ PURE PARTS
     Plain values in, plain values out — tests/gate-client.test.js runs them
     in Node. */

  // The wait before trying again: 2 s, 4 s, 8 s … at most 5 minutes.
  function backoffMs(tries) {
    var n = Math.max(0, Math.floor(Number(tries) || 0));
    return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, Math.min(n, 20)));
  }
  /* What a delivery receipt means for the item it answers:
       'done'    the gate has it (or already had it): it may leave the outbox;
       'reseal'  its session was ended by a password reset or a switch-off:
                 it waits for the same trainee's next sign-in, to be sealed again;
       'retry'   a passing problem: sent again later;
       'refused' kept, marked refused, never sent again on its own. */
  function receiptAction(r) {
    if (!isObj(r)) return 'retry';
    if (r.ok === true) return 'done';
    if (r.reason === 'revoked') return 'reseal';
    if (r.retry === true) return 'retry';
    return 'refused';
  }
  // A whole request that was not answered item by item: everything in it is tried again.
  function callAnswerRetries(res) {
    return !res || res.ok !== true || !Array.isArray(res.receipts);
  }
  function validAddress(u) {
    u = str(u).trim();
    if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return '';
    try { var x = new URL(u); return x.protocol === 'https:' && x.hostname ? x.href : ''; } catch (e) { return /^https:\/\/[A-Za-z0-9.-]+(\/[^\s]*)?$/.test(u) ? u : ''; }
  }
  /* Which gate: the Centre's own server when this page came from it (same
     origin, /_cestis/gate), else the address from the trainee's link, else
     the one in the Centre's settings on this device — else none (today's
     sign-in). DESIGN.md §6. */
  function pickBase(o) {
    o = o || {};
    if (o.lan) return { kind: 'lan', url: str(o.origin) + LAN_PATH };
    var a = validAddress(o.address);
    if (a) return { kind: 'online', url: a };
    var s = o.settings && isObj(o.settings.traineeGate) ? o.settings.traineeGate : null;
    var u = s && s.enabled === true ? validAddress(s.url) : '';
    return u ? { kind: 'online', url: u } : null;
  }
  // The trainee's link: index.html#gate=<base64url(address)> (other fragment words are left alone).
  function parseGateFragment(hash) {
    var m = /(?:^#|[#&])gate=([A-Za-z0-9_-]+={0,2})(?:&|$)/.exec(str(hash));
    if (!m) return '';
    var bytes = G.unb64url(m[1]);
    if (!bytes) return '';
    var text = '';
    try { text = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) : decodeURIComponent(escape(String.fromCharCode.apply(null, bytes))); }
    catch (e) { return ''; }
    return validAddress(text);
  }
  function stripGateFragment(hash) {
    var h = str(hash).replace(/^#/, '').split('&').filter(function (p) { return p && p.indexOf('gate=') !== 0; }).join('&');
    return h ? '#' + h : '';
  }
  /* The outbox entry for one sealed item, and the key under which a newer
     copy of the same thing replaces an older one still waiting (§5.1
     coalescing: the newest unsent save of an attempt carries every answer). */
  function coalesceKey(item) {
    if (!isObj(item)) return '';
    if (item.kind === 'rec') return 'rec|' + str(item.key) + '|' + str(item.recId != null ? item.recId : item.rec && item.rec.id) + (item.key === 'voctrain_chatMessages' && item.rec ? '|' + str(item.rec.roomId) : '');
    if (item.kind === 'op') return 'op|' + str(item.op && item.op.id);
    return '';                      // a submit is never folded into another
  }

  /* ---- Into the namespace: the slice, what the gate says was sent, and
     what this device has not sent yet (§7.1: read-only keys replaced,
     trainee-writable keys merged with local unsent records). ----
     planApply(slice, local, ctx) → { writes: {storeKey: value}, base }
       local: the namespace's current values (parsed), by store key;
       ctx:   { me: {acct, stu}, pending: {storeKey: {recId: true}},
                pendingOps: [op], overlay: {lanes, results} }. */
  function overlayLists(overlay, key) {
    var out = [];
    ((overlay && overlay.lanes) || []).forEach(function (l) {
      var v = l && isObj(l.records) ? l.records[key] : null;
      if (Array.isArray(v)) out.push(v);
    });
    return out;
  }
  function mergeOwnList(sliceList, overlays, localList, pending) {
    pending = pending || {};
    var byId = {}, order = [];
    var put = function (rec, src) {
      if (!isObj(rec) || rec.id == null || rec.id === '') return;
      var id = str(rec.id), cur = byId[id];
      if (!cur) { byId[id] = { rec: rec, src: src }; order.push(id); return; }
      if (cur.src === 'unsent') return;
      if (src === 'local' && pending[id]) { byId[id] = { rec: rec, src: 'unsent' }; return; }
      if (stampOf(rec) > stampOf(cur.rec)) byId[id] = { rec: rec, src: src };
    };
    (Array.isArray(sliceList) ? sliceList : []).forEach(function (r) { put(r, 'slice'); });
    (overlays || []).forEach(function (l) { l.forEach(function (r) { put(r, 'overlay'); }); });
    // A record only this device holds stays while it waits to be sent; once it
    // has gone, the gate's own answers (the slice, the overlay) speak for it.
    (Array.isArray(localList) ? localList : []).forEach(function (r) {
      if (!isObj(r) || r.id == null) return;
      if (byId[str(r.id)] || pending[str(r.id)]) put(r, 'local');
    });
    return order.map(function (id) { return copy(byId[id].rec); });
  }
  function mergeOwnMap(sliceMap, overlayMaps, localMap, pending, me) {
    pending = pending || {};
    var out = {};
    var put = function (k, rec, src) {
      if (!isObj(rec)) return;
      var cur = out[k];
      if (!cur || (cur.src !== 'unsent' && ((src === 'local' && pending[k]) || stampOf(rec) > stampOf(cur.rec)))) {
        out[k] = { rec: rec, src: src === 'local' && pending[k] ? 'unsent' : src };
      }
    };
    Object.keys(isObj(sliceMap) ? sliceMap : {}).forEach(function (k) { put(k, sliceMap[k], 'slice'); });
    (overlayMaps || []).forEach(function (m) { Object.keys(isObj(m) ? m : {}).forEach(function (k) { put(k, m[k], 'overlay'); }); });
    Object.keys(isObj(localMap) ? localMap : {}).forEach(function (k) {
      var mine = me && (k === str(me.acct) || k === str(me.stu));
      if (out[k] || pending[k] || mine) put(k, localMap[k], 'local');
    });
    var res = {};
    Object.keys(out).forEach(function (k) { res[k] = copy(out[k].rec); });
    return res;
  }
  // Results: the slice's (staff may have marked them since), then what the gate
  // answered this device or says it marked, by id and by the attempt they mark.
  function mergeResults(sliceList, overlayResults, localList) {
    var out = [], ids = {}, attempts = {};
    var add = function (r, onlyGate) {
      if (!isObj(r) || r.id == null) return;
      if (onlyGate && !(r.markedBy === 'gate' || /^RES-G-/.test(str(r.id)))) return;
      if (ids[str(r.id)] || (r.attemptId != null && attempts[str(r.attemptId)])) return;
      ids[str(r.id)] = 1; if (r.attemptId != null) attempts[str(r.attemptId)] = 1;
      out.push(copy(r));
    };
    (Array.isArray(sliceList) ? sliceList : []).forEach(function (r) { add(r, false); });
    (overlayResults || []).forEach(function (f) { add(f && f.result, false); });
    (Array.isArray(localList) ? localList : []).forEach(function (r) { add(r, true); });
    return out;
  }
  function mergeAttempts(sliceList, overlays, retired, localList, nowMs) {
    var X = Core.exams, list = [];
    var add = function (l) { if (Array.isArray(l) && l.length) list = X.mergeAttemptLists(list, copy(l), { nowMs: nowMs }).list; };
    add(sliceList);
    (overlays || []).forEach(add);
    add(retired);
    add(localList);
    return list;
  }
  // The settings a trainee's page reads, as the slice carries them.
  function mergeSettings(local, sliceSettings) {
    var s = isObj(local) ? copy(local) : {};
    var t = isObj(sliceSettings) ? sliceSettings : {};
    if (t.centreName) s.institutionName = str(t.centreName);
    if (t.centreUtcOffset) s.centreUtcOffset = str(t.centreUtcOffset);
    s.maintenanceMode = t.maintenanceMode === true;
    s.maintenanceMessage = t.maintenanceMode === true ? str(t.maintenanceMessage) : '';
    if (t.gateUrl) s.traineeGate = { url: str(t.gateUrl), enabled: true };
    return s;
  }
  function planApply(slice, local, ctx) {
    ctx = ctx || {};
    local = local || {};
    var data = (slice && isObj(slice.data)) ? slice.data : {};
    var overlay = ctx.overlay || {};
    var pending = ctx.pending || {};
    var writes = {};
    Object.keys(data).forEach(function (k) {
      if (k === 'voctrain_examResults') writes[k] = mergeResults(data[k], overlay.results, local[k]);
      else if (k === 'voctrain_examAttempts') {
        var retired = ((overlay.results) || []).map(function (f) { return f && f.retired; }).filter(isObj);
        writes[k] = mergeAttempts(data[k], overlayLists(overlay, k), retired, local[k], ctx.nowMs);
      }
      else if (OWN_LISTS[k]) writes[k] = mergeOwnList(data[k], overlayLists(overlay, k), local[k], pending[k]);
      else if (OWN_MAPS[k]) {
        var maps = ((overlay.lanes) || []).map(function (l) { return l && isObj(l.records) ? l.records[k] : null; }).filter(isObj);
        writes[k] = mergeOwnMap(data[k], maps, local[k], pending[k], ctx.me);
      }
      else writes[k] = copy(data[k]);
    });
    // Read and cleared marks the gate holds but the slice does not show yet,
    // and those this device has not sent: put back on the trainee's copy.
    var ops = [];
    ((overlay.lanes) || []).forEach(function (l) { (Array.isArray(l && l.ops) ? l.ops : []).forEach(function (o) { ops.push(o); }); });
    (ctx.pendingOps || []).forEach(function (o) { ops.push(o); });
    if (ops.length && ctx.me && ctx.me.acct) {
      var store = { voctrain_announcements: writes.voctrain_announcements, voctrain_notifications: writes.voctrain_notifications };
      try { G.applyOps(store, ops.filter(function (o) { return o && (o.kind === 'read' || o.kind === 'clearNotif') && o.key !== 'voctrain_chatMessages'; }), { acct: ctx.me.acct }); } catch (e) {}
    }
    if (slice && isObj(slice.settings)) writes.voctrain_systemSettings = mergeSettings(local.voctrain_systemSettings, slice.settings);
    return { writes: writes, base: baseFor(writes, ctx.me) };
  }
  // A room's own file into the namespace's messages: the room's messages,
  // with this trainee's own still waiting to be sent kept.
  function mergeRoom(localRooms, room, pending, me) {
    var out = isObj(localRooms) ? copy(localRooms) : {};
    if (!room || room.roomId == null) return out;
    var id = str(room.roomId);
    var mine = (Array.isArray(out[id]) ? out[id] : []).filter(function (m) {
      return isObj(m) && str(m.senderId) === str(me && me.acct) && pending && pending[str(m.id)];
    });
    out[id] = mergeOwnList(room.messages, [], mine, pending || {});
    return out;
  }

  /* ---- What the trainee changed (the watcher's pure step) ----
     The namespace holds the trainee's records; base remembers, record by
     record, what has already been sealed or came from the gate. A record of
     theirs that differs is a write to send. Ownership mirrors the gate's own
     checks (Core.gate.validateItem), so nothing that is not theirs is sent. */
  function ownedRecords(key, value, me) {
    var out = [];
    var stu = str(me && me.stu), acct = str(me && me.acct);
    if (key === 'voctrain_studentProfiles') {
      Object.keys(isObj(value) ? value : {}).forEach(function (k) {
        if ((k === acct || k === stu) && isObj(value[k])) out.push({ recId: k, rec: value[k] });
      });
      return out;
    }
    if (key === 'voctrain_chatMessages') {
      Object.keys(isObj(value) ? value : {}).forEach(function (room) {
        (Array.isArray(value[room]) ? value[room] : []).forEach(function (m) {
          if (!isObj(m) || m.id == null || str(m.senderId) !== acct) return;
          var rec = copy(m);
          rec.roomId = room;
          // Bytes never travel inside a message: a picture or file goes first
          // (CESTISGate.upload) and the message names it.
          delete rec.imageData; delete rec.fileData;
          out.push({ recId: str(m.id), rec: rec, room: room });
        });
      });
      return out;
    }
    (Array.isArray(value) ? value : []).forEach(function (r) {
      if (!isObj(r) || r.id == null || r.id === '') return;
      if (key === 'voctrain_examAttempts') { if (str(r.studentId) === stu && Core.exams.attemptIsOpen(r)) out.push({ recId: str(r.id), rec: r }); return; }
      if (key === 'voctrain_submissions' || key === 'voctrain_certTranscriptRequests') { if (str(r.studentId) === stu) out.push({ recId: str(r.id), rec: r }); return; }
      if (key === 'voctrain_support_messages') {
        if ((r.accountId == null || str(r.accountId) === acct) && (r.studentId == null || str(r.studentId) === stu)) out.push({ recId: str(r.id), rec: r });
      }
    });
    return out;
  }
  function marksOf(key, value, me) {
    var out = {}, acct = str(me && me.acct);
    if (key !== 'voctrain_announcements' && key !== 'voctrain_notifications') return out;
    (Array.isArray(value) ? value : []).forEach(function (r) {
      if (!isObj(r) || r.id == null) return;
      var read = Array.isArray(r.readBy) && r.readBy.map(str).indexOf(acct) !== -1;
      var cleared = Array.isArray(r.clearedBy) && r.clearedBy.map(str).indexOf(acct) !== -1;
      if (read || cleared) out[str(r.id)] = (read ? 'r' : '') + (cleared ? 'c' : '');
    });
    return out;
  }
  function baseFor(values, me) {
    var base = {};
    WATCHED.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(values, k)) return;
      var b = base[k] = {};
      if (k === 'voctrain_announcements' || k === 'voctrain_notifications') { var m = marksOf(k, values[k], me); Object.keys(m).forEach(function (id) { b[id] = m[id]; }); return; }
      ownedRecords(k, values[k], me).forEach(function (o) { b[(o.room ? o.room + '/' : '') + o.recId] = hashOf(o.rec); });
    });
    return base;
  }
  /* diff(key, value, base, me) → { items: [{kind, key?, rec?, recId?, op?}], base }
     the item bodies to seal, and the base this key takes once they are kept. */
  function diff(key, value, base, me) {
    base = isObj(base) ? base : {};
    var items = [], next = {};
    if (key === 'voctrain_announcements' || key === 'voctrain_notifications') {
      var marks = marksOf(key, value, me);
      Object.keys(marks).forEach(function (id) {
        var was = str(base[id]), now = marks[id];
        next[id] = now;
        if (now.indexOf('r') !== -1 && was.indexOf('r') === -1 && !(key === 'voctrain_notifications' && now.indexOf('c') !== -1)) {
          items.push({ kind: 'op', op: { id: 'OP-r-' + G.hashOf([key, id, me.acct]).slice(3, 19), kind: 'read', key: key, recId: id, at: new Date().toISOString() } });
        }
        if (now.indexOf('c') !== -1 && was.indexOf('c') === -1) {
          items.push({ kind: 'op', op: { id: 'OP-c-' + G.hashOf([key, id, me.acct]).slice(3, 19), kind: 'clearNotif', key: key, recId: id, at: new Date().toISOString() } });
        }
      });
      return { items: items, base: next };
    }
    ownedRecords(key, value, me).forEach(function (o) {
      var bk = (o.room ? o.room + '/' : '') + o.recId, h = hashOf(o.rec);
      next[bk] = h;
      if (base[bk] === h) return;
      var body = { kind: 'rec', key: key, rec: copy(o.rec) };
      if (key === 'voctrain_studentProfiles') body.recId = o.recId;
      items.push(body);
    });
    // A record that has gone from the device keeps its place in the base: a
    // shorter list is never a deletion here.
    Object.keys(base).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(next, k)) next[k] = base[k]; });
    return { items: items, base: next };
  }

  /* ---- The outbox, over any backend {all(), put(entry), del(id)} (promises).
     Browser: IndexedDB CESTIS_GATE_OUTBOX; tests: a Map. ---- */
  function makeOutbox(backend) {
    var ob = {
      all: function () { return Promise.resolve(backend.all()).then(function (l) { return (Array.isArray(l) ? l : []).slice().sort(function (a, b) { return (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }); }); },
      // A newer copy of the same record replaces one still waiting (never one refused).
      add: function (entry) {
        return ob.all().then(function (list) {
          var drop = entry.ck ? list.filter(function (e) { return e.ck === entry.ck && e.state === 'wait' && e.a === entry.a && e.base === entry.base; }) : [];
          return Promise.all(drop.map(function (e) { return backend.del(e.id); })).then(function () { return backend.put(entry); }).then(function () { return entry; });
        });
      },
      put: function (entry) { return Promise.resolve(backend.put(entry)); },
      del: function (id) { return Promise.resolve(backend.del(id)); },
      // Work of this trainee not yet in the gate's hands (refused work is kept, but will not be sent on its own).
      pendingFor: function (acct) {
        return ob.all().then(function (l) { return l.filter(function (e) { return (!acct || e.a === acct) && (e.state === 'wait' || e.state === 'revoked'); }); });
      },
      /* One receipt applied to its entry: the change to make. now: ms. */
      settle: function (entry, receipt, now) {
        var act = receiptAction(receipt);
        if (act === 'done') return Promise.resolve(backend.del(entry.id)).then(function () { return act; });
        var e = copy(entry);
        e.last = receipt ? copy(receipt) : null;
        if (act === 'reseal') { e.state = 'revoked'; e.nextAt = 0; }
        else if (act === 'refused') { e.state = 'refused'; e.reason = str(receipt && (receipt.reason || receipt.error)) || 'refused'; }
        else { e.state = 'wait'; e.tries = (e.tries || 0) + 1; e.nextAt = now + backoffMs(e.tries); }
        return Promise.resolve(backend.put(e)).then(function () { return act; });
      }
    };
    return ob;
  }
  function memoryBackend() {
    var m = {};
    return {
      all: function () { return Object.keys(m).map(function (k) { return copy(m[k]); }); },
      put: function (e) { m[e.id] = copy(e); },
      del: function (id) { delete m[id]; },
      _m: m
    };
  }
  function idbBackend() {
    var dbp = null;
    var open = function () {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        try {
          var req = root.indexedDB.open(OUTBOX_DB, 1);
          req.onupgradeneeded = function (ev) { var d = ev.target.result; if (!d.objectStoreNames.contains(OUTBOX_STORE)) d.createObjectStore(OUTBOX_STORE, { keyPath: 'id' }); };
          req.onsuccess = function (ev) { resolve(ev.target.result); };
          req.onerror = function () { reject(req.error || new Error('outbox')); };
        } catch (e) { reject(e); }
      });
      dbp.catch(function () { dbp = null; });
      return dbp;
    };
    var tx = function (mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(OUTBOX_STORE, mode), os = t.objectStore(OUTBOX_STORE), out;
          out = fn(os);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : undefined); };
          t.onerror = t.onabort = function () { reject(t.error || new Error('outbox')); };
        });
      });
    };
    return {
      all: function () { return tx('readonly', function (os) { return os.getAll(); }).then(function (l) { return l || []; }); },
      put: function (e) { return tx('readwrite', function (os) { os.put(e); }); },
      del: function (id) { return tx('readwrite', function (os) { os.delete(id); }); }
    };
  }

  /* ============================================================ CRYPTOGRAPHY
     WebCrypto. A key is the UTF-8 bytes of its text (a hex secret is used as
     written), as on every other side (Core.gate). */
  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function subtle() { return root.crypto && root.crypto.subtle; }
  function hex(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  function hmacHex(keyText, msg) {
    return subtle().importKey('raw', enc.encode(str(keyText)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return subtle().sign('HMAC', k, enc.encode(str(msg))); }).then(hex);
  }
  function sha256Hex(msg) { return subtle().digest('SHA-256', enc.encode(str(msg))).then(hex); }
  function pbkdf2Hex(password, saltHex, iterations) {
    var salt = new Uint8Array((str(saltHex).match(/../g) || []).map(function (h) { return parseInt(h, 16); }));
    return subtle().importKey('raw', enc.encode(str(password)), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (k) { return subtle().deriveBits({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, k, 256); }).then(hex);
  }
  // Core.gate.seal on WebCrypto: HMAC(sessionKey, canon(item without mac)).
  function sealItem(item, sessionKey) {
    var c = copy(item);
    delete c.mac;
    return hmacHex(sessionKey, G.canon(c)).then(function (mac) { c.mac = mac; return c; });
  }

  /* ================================================================== STATE */
  var cfg = {
    // The page's own hashing (index.html _pbkdf2Hex / hashPasswordLegacy), so a
    // proof is worked out exactly as the page checks a password today.
    pbkdf2: null, legacy: null,
    store: null,              // CESTISStore (the namespace when in a gate session)
    onResult: null,           // fn(result, receipt): a test marked by the gate arrived
    onRetired: null,          // fn(retired, receipt)
    onChange: null,           // fn(summary): the outbox or the session changed (the sync chip)
    onSession: null,          // fn(code): the session can no longer read ('expired' | 'revoked' | 'signed-out')
    client: ''
  };
  var outbox = null;
  var lanProbe = null;
  var run = { flushing: false, holdUntil: 0, fails: 0, lastPull: 0, lastPullOk: 0, lastDeliver: 0, timer: null, kickTimer: null, wired: false, captureTimer: null };
  var tabLane = '';

  function ls() { try { return root.localStorage; } catch (e) { return null; } }
  function lsGet(k) { var l = ls(); try { return l ? l.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { var l = ls(); try { if (l) { if (v == null) l.removeItem(k); else l.setItem(k, v); } return true; } catch (e) { return false; } }
  function store() { return cfg.store || root.CESTISStore || null; }
  function inNamespace() { var s = store(); return !!(s && s.namespace); }
  function getOutbox() {
    if (outbox) return outbox;
    var be = cfg.outboxBackend || null;
    try { if (!be && root.indexedDB && typeof root.indexedDB.open === 'function') be = idbBackend(); } catch (e) { be = null; }
    outbox = makeOutbox(be || memoryBackend());
    return outbox;
  }
  function clientStamp() {
    if (cfg.client) return cfg.client;
    try {
      var s = root.document && root.document.querySelector('script[src*="cestis-gate-client.js"]');
      var m = s && /[?&]v=([^&]+)/.exec(s.getAttribute('src'));
      cfg.client = m ? m[1] : '';
    } catch (e) {}
    return cfg.client;
  }

  /* ---- The session (in the namespace; device-only keys) ---- */
  function session() {
    var s = store();
    if (!s || !inNamespace()) return null;
    var mode = parse(s.getItem(SESSION_KEYS.mode), null);
    if (!isObj(mode) || !mode.acct) return null;
    mode.token = s.getItem(SESSION_KEYS.token) || '';
    mode.sessionKey = s.getItem(SESSION_KEYS.key) || '';
    return mode;
  }
  function gateNow(sess) { return Date.now() + (Number(sess && sess.offset) || 0); }
  function saveSession(sess) {
    var s = store();
    if (!s || !inNamespace()) return;
    var mode = copy(sess);
    delete mode.token; delete mode.sessionKey;
    s.setItem(SESSION_KEYS.mode, JSON.stringify(mode));
    if (sess.token != null) s.setItem(SESSION_KEYS.token, sess.token);
  }

  /* ---- Which gate (§6) ---- */
  /* Served by the Centre's own server? The page's own one question for that
     (CESTISPageCloud.lan(), asked once a load anyway) decides; only then is
     the gate there asked how it is. Online, nothing extra is ever requested. */
  function probeLan() {
    if (lanProbe) return lanProbe;
    var loc = root.location, pc = root.CESTISPageCloud;
    if (!root.fetch || !loc || !/^https?:$/.test(loc.protocol || '') || !pc || typeof pc.lan !== 'function') {
      lanProbe = Promise.resolve(null);
      return lanProbe;
    }
    lanProbe = Promise.resolve(pc.lan()).then(function (on) {
      if (!on) return null;
      return timed(root.fetch(loc.origin + LAN_PATH, { cache: 'no-store' }), 6000)
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (h) { return h && h.service === 'cestis-trainee-gate' ? h : null; });
    }).catch(function () { return null; });
    return lanProbe;
  }
  /* Is there anything of the gate's on this device at all — sealed work
     waiting, a namespace left to clear? Asked without creating anything: a
     device that never used the gate gets no new storage from this file. */
  function hasWork() {
    if (nsKeys().length) return Promise.resolve(true);
    try {
      if (root.indexedDB && typeof root.indexedDB.databases === 'function') {
        return root.indexedDB.databases().then(function (l) { return (l || []).some(function (d) { return d && d.name === OUTBOX_DB; }); }, function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }
  function base(opts) {
    opts = opts || {};
    var sess = session();
    if (sess && sess.base) return Promise.resolve(sess.base);
    return probeLan().then(function (h) {
      var settings = opts.settings || (typeof root.systemSettings !== 'undefined' ? root.systemSettings : null);
      if (h) {
        var tg = settings && isObj(settings.traineeGate) ? settings.traineeGate : null;
        // On the Centre's own network the gate is for trainees once its
        // records are for staff only, or the Centre turned trainee sign-in on.
        var wanted = h.accepting !== false && (h.staffOnly === true || (tg && tg.enabled === true));
        return wanted ? pickBase({ lan: true, origin: root.location.origin }) : null;
      }
      var tg2 = settings && isObj(settings.traineeGate) ? settings.traineeGate : null;
      // Turned off by the Centre on this device's copy of its settings: today's sign-in.
      if (tg2 && tg2.url && tg2.enabled === false) return null;
      return pickBase({ address: lsGet('cestisGateAddress'), settings: settings });
    });
  }
  // The trainee's link: the address goes into this device's own key, and out of the address bar.
  function takeLink() {
    try {
      var url = parseGateFragment(root.location.hash);
      if (!url) return '';
      lsSet('cestisGateAddress', url);
      var h = stripGateFragment(root.location.hash);
      if (root.history && typeof root.history.replaceState === 'function') root.history.replaceState(null, '', root.location.pathname + root.location.search + h);
      return url;
    } catch (e) { return ''; }
  }

  /* ---- Requests ---- */
  function timed(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function call(b, op, body, opts) {
    opts = opts || {};
    var url = b && (b.url || b);
    if (!url) return Promise.resolve({ ok: false, error: 'no-gate' });
    var req = Object.assign({ op: op, v: PROTOCOL, client: clientStamp() }, body || {});
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var p = root.fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req),
      cache: 'no-store', redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    return timed(p, opts.timeout || CALL_TIMEOUT_MS)
      .then(function (r) {
        return r.text().then(function (t) {
          var j = parse(t, null);
          if (j && typeof j === 'object') return j;
          return { ok: false, error: r.status >= 500 || r.status === 429 ? 'busy' : 'bad-answer', retry: true, unreachable: r.status >= 500 };
        });
      })
      .catch(function () { try { if (ctl) ctl.abort(); } catch (e) {} return { ok: false, error: 'unreachable', retry: true, unreachable: true }; });
  }
  function signed(op, body, opts) {
    var sess = session();
    if (!sess || !sess.token) return Promise.resolve({ ok: false, error: 'signed-out' });
    return call(sess.base, op, Object.assign({ token: sess.token }, body || {}), opts).then(function (res) {
      if (res && res.serverTime) noteServerTime(sess, res.serverTime);
      if (res && res.ok === false && (res.error === 'expired' || res.error === 'revoked' || res.error === 'signed-out' || res.error === 'bad-token')) {
        sess.readable = false; sess.why = res.error; saveSession(sess);
        if (typeof cfg.onSession === 'function') { try { cfg.onSession(res.error); } catch (e) {} }
      }
      return res;
    });
  }
  function noteServerTime(sess, iso) {
    var t = msOf(iso);
    if (!t) return;
    sess.offset = t - Date.now();
    try { if (Core.sync && typeof Core.sync.setClockOffset === 'function') Core.sync.setClockOffset(sess.offset); } catch (e) {}
  }

  /* ---- Signing in (§4) ---- */
  function proofFor(password, ch, nonce, login) {
    var V;
    if (ch.algo === 'sha256-legacy') V = typeof cfg.legacy === 'function' ? Promise.resolve(cfg.legacy(password)) : sha256Hex(str(password) + '__CESTIS_SALT_2026__');
    else V = typeof cfg.pbkdf2 === 'function' ? Promise.resolve(cfg.pbkdf2(password, ch.salt, ch.iter)) : pbkdf2Hex(password, ch.salt, ch.iter);
    return V.then(function (v) { return hmacHex(str(v).toLowerCase(), G.proof.message(nonce, login)); });
  }
  function withBase(fn) {
    return base().then(function (b) { return b ? fn(b) : { ok: false, error: 'no-gate' }; });
  }
  // → SESSION {token, sessionKey, sid, lane, exp, account, serverTime, base} | {need2fa, ticket, methods, email, base} | {ok:false, error}
  function signIn(o) {
    o = o || {};
    var login = str(o.login).trim();
    return withBase(function (b) {
      return call(b, 'auth.start', { login: login }).then(function (ch) {
        if (!ch || ch.ok !== true) return ch;
        return proofFor(o.password, ch, ch.nonce, login).then(function (proof) {
          return call(b, 'auth.password', { login: login, nonce: ch.nonce, proof: proof });
        });
      }).then(function (res) { if (res && res.ok) { res.base = b; res.via = 'password'; } return res; });
    });
  }
  function signInEmail(accessToken) {
    return withBase(function (b) {
      if (b.kind === 'lan') return { ok: false, error: 'not-available' };
      return call(b, 'auth.email', { accessToken: str(accessToken) }).then(function (res) { if (res && res.ok) { res.base = b; res.via = 'email'; } return res; });
    });
  }
  function twoStep(o) {
    o = o || {};
    return withBase(function (b) {
      return call(b, 'auth.2fa', { ticket: str(o.ticket), method: str(o.method), code: str(o.code) })
        .then(function (res) { if (res && res.ok) res.base = b; return res; });
    });
  }
  function twoStepSend(ticket) {
    return withBase(function (b) {
      if (b.kind === 'lan') return { ok: false, error: 'not-available' };
      return call(b, 'auth.2fa.send', { ticket: str(ticket) });
    });
  }

  /* ---- Registering from home (DESIGN.md §17) ----
     Only with the trainee's own email account — its access token, exactly
     as for email sign-in: register.start says whether to show the form (and
     which programmes are taking trainees), or that the address already has
     an account or a registration waiting; register.submit sends the form.
     The password goes as the dashboard stores one (pbkdf2$…, a fresh salt,
     worked out here: the password itself never leaves the device), so the
     trainee can later sign in with it as well. Never on the Centre's own
     network, where there is no email-account sign-in: the office creates
     the account there. */
  function storedPassword(password) {
    if (typeof cfg.hashPassword === 'function') return Promise.resolve(cfg.hashPassword(str(password)));
    var salt = new Uint8Array(16);
    root.crypto.getRandomValues(salt);
    var saltHex = hex(salt);
    return pbkdf2Hex(str(password), saltHex, 210000).then(function (h) { return 'pbkdf2$210000$' + saltHex + '$' + h; });
  }
  function catalogue() {
    return withBase(function (b) { return b.kind === 'lan' ? { ok: false, error: 'not-available' } : call(b, 'catalogue', {}); });
  }
  // → {state:'new', email, programmes} | {state:'submitted', email, programme, submittedAt} | {ok:false, error}
  function registerStart(accessToken) {
    return withBase(function (b) {
      if (b.kind === 'lan') return { ok: false, error: 'not-available' };
      return call(b, 'register.start', { accessToken: str(accessToken) });
    });
  }
  // o: { accessToken, name, programme, phone, password } → {state:'submitted', …} | {ok:false, error, field?}
  function registerSubmit(o) {
    o = o || {};
    return withBase(function (b) {
      if (b.kind === 'lan') return { ok: false, error: 'not-available' };
      return storedPassword(o.password).then(function (pw) {
        if (!/^pbkdf2\$/.test(str(pw))) return { ok: false, error: 'bad-form', field: 'password' };
        return call(b, 'register.submit', { accessToken: str(o.accessToken), name: str(o.name), programme: str(o.programme), phone: str(o.phone), password: pw });
      });
    });
  }

  /* ---- Into the namespace, and out (§7.1) ----
     enter(): written into the namespace's own keys straight in localStorage
     (this page still has the main store open), then the page reloads into it.
     Another trainee's namespace left on this device is cleared first — their
     unsent work is safe in the outbox, sealed. */
  function nsKeys() {
    var out = [], l = ls();
    if (!l) return out;
    for (var i = 0; i < l.length; i++) { var k = l.key(i); if (k && k.indexOf(NS_PREFIX) === 0) out.push(k); }
    return out;
  }
  function nsAccount() {
    var m = parse(lsGet(NS_PREFIX + SESSION_KEYS.mode), null);
    return isObj(m) ? str(m.acct) : '';
  }
  // The note that a namespace is to be removed. It is itself a namespace key
  // ('g1::…'), which the main store never takes for one of its own — so
  // leaving a gate session writes nothing into this device's main records.
  var DROP_KEY = NS_PREFIX + 'cestisGateDrop';
  function dropNamespaceData() {
    nsKeys().forEach(function (k) { lsSet(k, null); });
    return new Promise(function (resolve) {
      var failed = function () { lsSet(DROP_KEY, '1'); resolve(false); };
      try {
        var req = root.indexedDB.deleteDatabase('CESTIS_KV__' + NS);
        req.onsuccess = function () { resolve(true); };
        req.onerror = failed;
        req.onblocked = failed;
      } catch (e) { failed(); }
    });
  }
  function enter(sess) {
    if (!sess || !sess.token || !sess.account || !sess.account.id) return Promise.resolve(false);
    var prev = nsAccount();
    var first = prev !== str(sess.account.id);
    var ready = first ? dropNamespaceData() : Promise.resolve(true);
    return ready.then(function (cleared) {
      // Another trainee's records could not be cleared (another window holds
      // them open): never sign in on top of them.
      if (!cleared) return false;
      var serverMs = msOf(sess.serverTime);
      var mode = { v: 1, acct: str(sess.account.id), stu: str(sess.account.studentId), sid: str(sess.sid), lane: str(sess.lane),
        exp: Number(sess.exp) || 0, base: sess.base, via: sess.via || 'password', at: new Date().toISOString(),
        offset: serverMs ? serverMs - Date.now() : 0, first: first, readable: true };
      if (!lsSet(NS_PREFIX + SESSION_KEYS.mode, JSON.stringify(mode))) return false;
      lsSet(NS_PREFIX + SESSION_KEYS.token, str(sess.token));
      lsSet(NS_PREFIX + SESSION_KEYS.key, str(sess.sessionKey));
      lsSet(DROP_KEY, null);
      lsSet('cestisGateNs', NS);
      return reseal(mode, str(sess.sessionKey)).then(function () { return true; }, function () { return true; });
    });
  }
  // Work an earlier session of this trainee sealed, refused because that session
  // was ended (a password reset, a switch-off): sealed again under this one.
  function reseal(mode, key) {
    var ob = getOutbox();
    return ob.all().then(function (list) {
      var mine = list.filter(function (e) { return e.state === 'revoked' && e.a === mode.acct && e.base === (mode.base && mode.base.url); });
      return mine.reduce(function (p, e) {
        return p.then(function () {
          var it = copy(e.item);
          it.sid = mode.sid;
          return sealItem(it, key).then(function (sealedItem) {
            var n = copy(e);
            n.item = sealedItem; n.sid = mode.sid; n.state = 'wait'; n.tries = 0; n.nextAt = 0; n.resealedAt = Date.now();
            return ob.put(n);
          });
        });
      }, Promise.resolve());
    });
  }
  /* Out of the namespace: the store goes back to the main one at the next
     load. The session's token and key go at once, from both copies (so
     nothing new can be sealed in this session's name). The trainee's records
     go too — unless something of theirs still waits to be sent (keepData):
     then they stay until it has gone (tidy). */
  function leave(opts) {
    opts = opts || {};
    var s = store();
    if (s && inNamespace()) {
      try { s.removeItem(SESSION_KEYS.token); s.removeItem(SESSION_KEYS.key); } catch (e) {}
      if (opts.keepData) {
        var m = parse(s.getItem(SESSION_KEYS.mode), null);
        if (isObj(m)) { m.signedOutAt = new Date().toISOString(); try { s.setItem(SESSION_KEYS.mode, JSON.stringify(m)); } catch (e) {} }
      }
    }
    lsSet(NS_PREFIX + SESSION_KEYS.token, null);
    lsSet(NS_PREFIX + SESSION_KEYS.key, null);
    lsSet('cestisGateNs', null);
    if (opts.keepData) return Promise.resolve(false);
    nsKeys().forEach(function (k) { lsSet(k, null); });
    lsSet(DROP_KEY, '1');
    return Promise.resolve(true);
  }
  /* In the main namespace, at load: a namespace a sign-out left to be removed
     (its database could not be deleted while the page held it open), or one
     whose trainee has nothing left to send. */
  function tidy() {
    if (inNamespace()) return Promise.resolve(false);
    var drop = lsGet(DROP_KEY);
    var owner = nsAccount();
    var check = owner && !drop ? getOutbox().pendingFor(owner).then(function (l) { return !l.length && lsGet(NS_PREFIX + SESSION_KEYS.token) == null; }) : Promise.resolve(!!drop);
    return check.then(function (go) {
      if (!go) return false;
      return dropNamespaceData();
    }).catch(function () { return false; });
  }

  /* ---- Reading (§5.3, §5.5) ---- */
  function pull() {
    var sess = session();
    if (!sess) return Promise.resolve({ ok: false, error: 'signed-out' });
    var have = store() ? parse(store().getItem('cestisGateSliceMeta'), {}).h : '';
    run.lastPull = Date.now();
    return signed('pull', have ? { have: have } : {}).then(function (res) {
      if (res && res.ok) {
        run.lastPullOk = Date.now();
        var cur = session() || sess;
        if (res.token) { cur.token = res.token; cur.exp = Number(res.exp) || cur.exp; }
        cur.readable = true; cur.why = '';
        saveSession(cur);
      }
      return res;
    });
  }
  // The pulled records, into the namespace: capture first (so nothing typed a
  // moment ago is taken for the slice's older copy), then the plan.
  function applyPull(res) {
    var s = store(), sess = session();
    if (!s || !sess || !res || res.ok !== true) return Promise.resolve(null);
    var me = { acct: sess.acct, stu: sess.stu };
    return capture().then(function () { return getOutbox().pendingFor(sess.acct); }).then(function (pend) {
      var pending = {}, pendingOps = [];
      pend.forEach(function (e) {
        var it = e.item || {};
        if (it.kind === 'rec') { var k = str(it.key); (pending[k] = pending[k] || {})[str(it.recId != null ? it.recId : it.rec && it.rec.id)] = true; }
        if (it.kind === 'op' && it.op) pendingOps.push(it.op);
      });
      var slice = res.slice || parse(s.getItem('cestisGateSlice'), null);
      if (!slice) return null;
      if (res.slice) {
        if (slice.studentId && slice.studentId !== sess.stu) { sess.stu = str(slice.studentId); me.stu = sess.stu; saveSession(sess); }
        try { s.setItem('cestisGateSlice', JSON.stringify(slice)); } catch (e) {}
      }
      var local = {};
      Object.keys(slice.data || {}).concat(['voctrain_systemSettings', 'voctrain_chatMessages']).forEach(function (k) { local[k] = parse(s.getItem(k), null); });
      var plan = planApply(slice, local, { me: me, pending: pending, pendingOps: pendingOps, overlay: res.overlay || {}, nowMs: gateNow(sess) });
      Object.keys(plan.writes).forEach(function (k) { try { s.setItem(k, JSON.stringify(plan.writes[k])); } catch (e) {} });
      var b = parse(s.getItem(BASE_KEY), {});
      Object.keys(plan.base).forEach(function (k) { b[k] = plan.base[k]; });
      s.setItem(BASE_KEY, JSON.stringify(b));
      s.setItem('cestisGateSliceMeta', JSON.stringify({ h: slice.hash, builtAt: slice.builtAt, pulledAt: new Date().toISOString() }));
      if (sess.first) { sess.first = false; saveSession(sess); }
      return { slice: slice, changed: !!res.slice, plan: plan };
    });
  }
  function paper(examId) {
    return signed('paper', { examId: str(examId) }).then(function (res) {
      if (res && res.ok && res.paper && store()) { try { store().setItem('cestisGatePaper__' + str(examId), JSON.stringify(res.paper)); } catch (e) {} }
      return res;
    });
  }
  function storedPaper(examId) { return store() ? parse(store().getItem('cestisGatePaper__' + str(examId)), null) : null; }
  function attempt(examId) { return signed('attempt.get', { examId: str(examId) }); }
  function review(resultId) { return signed('review', { resultId: str(resultId) }); }
  function roomGet(roomId, have) { return signed('room.get', have ? { roomId: str(roomId), have: str(have) } : { roomId: str(roomId) }); }
  function upload(o) {
    o = o || {};
    var sess = session();
    if (sess && sess.base && sess.base.kind === 'lan') return Promise.resolve({ ok: false, error: 'not-available' });
    return signed('upload', { name: str(o.name), mime: str(o.mime), base64: str(o.base64), purpose: o.purpose === 'chat' ? 'chat' : 'submission', refId: str(o.refId) }, { timeout: UPLOAD_TIMEOUT_MS });
  }
  function fileGet(fileId) {
    var sess = session();
    if (sess && sess.base && sess.base.kind === 'lan') return Promise.resolve({ ok: false, error: 'not-available' });
    return signed('file.get', { fileId: str(fileId) }, { timeout: UPLOAD_TIMEOUT_MS });
  }
  // This room's messages, merged into the namespace's chat (keeping this trainee's unsent ones).
  function applyRoom(res) {
    var s = store(), sess = session();
    if (!s || !sess || !res || res.ok !== true || !res.room) return Promise.resolve(false);
    return getOutbox().pendingFor(sess.acct).then(function (pend) {
      var pending = {};
      pend.forEach(function (e) { var it = e.item || {}; if (it.kind === 'rec' && it.key === 'voctrain_chatMessages' && it.rec) pending[str(it.rec.id)] = true; });
      var rooms = mergeRoom(parse(s.getItem('voctrain_chatMessages'), {}), res.room, pending, { acct: sess.acct, stu: sess.stu });
      s.setItem('voctrain_chatMessages', JSON.stringify(rooms));
      var b = parse(s.getItem(BASE_KEY), {});
      var nb = baseFor({ voctrain_chatMessages: rooms }, { acct: sess.acct, stu: sess.stu }).voctrain_chatMessages || {};
      b.voctrain_chatMessages = Object.assign({}, b.voctrain_chatMessages || {}, nb);
      Object.keys(pending).forEach(function (id) { delete b.voctrain_chatMessages[str(res.room.roomId) + '/' + id]; });
      s.setItem(BASE_KEY, JSON.stringify(b));
      var meta = parse(s.getItem('cestisGateRooms'), {});
      meta[str(res.room.roomId)] = { h: res.h || res.room.hash, at: new Date().toISOString() };
      s.setItem('cestisGateRooms', JSON.stringify(meta));
      return true;
    });
  }
  function signOut() {
    var sess = session();
    if (!sess || !sess.token) return Promise.resolve({ ok: true });
    return call(sess.base, 'signOut', { token: sess.token }, { timeout: 8000 });
  }

  /* ---- Writing (§5.1): sealed, into the outbox, then delivered ---- */
  function queue(kind, body, opts) {
    opts = opts || {};
    var sess = session();
    if (!sess || !sess.sessionKey || !sess.sid) return Promise.reject(new Error('no session'));
    var it = Object.assign({ id: 'IT-' + Date.now().toString(36) + '-' + randomId(10), a: sess.acct, sid: sess.sid, kind: kind }, copy(body || {}));
    it.kind = kind;
    it.createdAt = new Date(gateNow(sess)).toISOString();
    return sealItem(it, sess.sessionKey).then(function (sealedItem) {
      var entry = { id: sealedItem.id, item: sealedItem, base: sess.base && sess.base.url, a: sess.acct, sid: sess.sid, kind: kind,
        ck: opts.noCoalesce ? '' : coalesceKey(sealedItem), state: 'wait', tries: 0, nextAt: 0, at: Date.now(),
        attemptId: kind === 'submit' && sealedItem.attempt ? str(sealedItem.attempt.id) : (kind === 'rec' && sealedItem.key === 'voctrain_examAttempts' && sealedItem.rec ? str(sealedItem.rec.id) : '') };
      return getOutbox().add(entry).then(function () { changed(); if (!opts.noKick) kick(); return entry; });
    });
  }
  function changed() { if (typeof cfg.onChange === 'function') { status().then(function (s) { try { cfg.onChange(s); } catch (e) {} }); } }
  function status() {
    var sess = session();
    return getOutbox().all().then(function (l) {
      var acct = sess ? sess.acct : null;
      var mine = l.filter(function (e) { return !acct || e.a === acct; });
      return { waiting: mine.filter(function (e) { return e.state === 'wait' || e.state === 'revoked'; }).length,
        refused: mine.filter(function (e) { return e.state === 'refused'; }).length,
        all: l.filter(function (e) { return e.state === 'wait'; }).length,
        lastDeliver: run.lastDeliver, lastPullOk: run.lastPullOk, online: !(root.navigator && root.navigator.onLine === false),
        failing: run.fails > 0, readable: !sess || sess.readable !== false, why: sess ? sess.why || '' : '' };
    }, function () { return { waiting: 0, refused: 0, all: 0, online: true, failing: false, readable: true }; });
  }
  function laneSuffix() {
    if (!tabLane) tabLane = randomId(8).replace(/[^A-Za-z0-9]/g, 'x');
    return tabLane;
  }
  function withLaneLock(fn) {
    try {
      if (root.navigator && root.navigator.locks && typeof root.navigator.locks.request === 'function') {
        return root.navigator.locks.request(LANE_LOCK, function () { return fn(null); });
      }
    } catch (e) {}
    // No Web Locks: this tab writes a lane of its own (the gate needs one writer per lane).
    return fn(laneSuffix());
  }
  /* Send what waits: by gate, oldest first, a batch at a time, one lane at a
     time on this device. Every receipt settles its own item; an item whose
     receipt was lost is simply sent again (the gate knows it by its id). */
  function deliver(opts) {
    opts = opts || {};
    if (run.flushing) return run.flushing;
    if (!opts.force && Date.now() < run.holdUntil) return Promise.resolve({ sent: 0, held: true });
    var ob = getOutbox();
    run.flushing = withLaneLock(function (suffix) {
      return ob.all().then(function (list) {
        var now = Date.now();
        var due = list.filter(function (e) { return e.state === 'wait' && e.base && (opts.force || !e.nextAt || e.nextAt <= now); });
        if (!due.length) return { sent: 0 };
        var groups = {}, order = [];
        due.forEach(function (e) { if (!groups[e.base]) { groups[e.base] = []; order.push(e.base); } groups[e.base].push(e); });
        var out = { sent: 0, done: 0, retry: 0, refused: 0, reseal: 0, results: [] };
        return order.reduce(function (p, url) {
          return p.then(function () {
            var batches = [], g = groups[url];
            for (var i = 0; i < g.length; i += DELIVER_BATCH) batches.push(g.slice(i, i + DELIVER_BATCH));
            return batches.reduce(function (q, batch) {
              return q.then(function () {
                var body = { items: batch.map(function (e) { return e.item; }) };
                if (suffix) body.lane = suffix;
                return call({ url: url }, 'deliver', body).then(function (res) {
                  out.sent += batch.length;
                  if (callAnswerRetries(res)) {
                    run.fails++;
                    run.holdUntil = Date.now() + backoffMs(run.fails - 1);
                    out.retry += batch.length;
                    return Promise.all(batch.map(function (e) { return ob.settle(e, { ok: false, retry: true, reason: res && res.error }, Date.now()); }));
                  }
                  run.fails = 0; run.holdUntil = 0; run.lastDeliver = Date.now();
                  return Promise.all(batch.map(function (e, j) {
                    var r = res.receipts[j] && str(res.receipts[j].id) === str(e.id) ? res.receipts[j] : (res.receipts.filter(function (x) { return x && str(x.id) === str(e.id); })[0] || null);
                    return ob.settle(e, r, Date.now()).then(function (act) {
                      out[act === 'done' ? 'done' : act] = (out[act === 'done' ? 'done' : act] || 0) + 1;
                      if (r && r.result) { out.results.push(r.result); if (typeof cfg.onResult === 'function') { try { cfg.onResult(r.result, r, e); } catch (x) {} } }
                      else if (r && r.retired && typeof cfg.onRetired === 'function') { try { cfg.onRetired(r.retired, r, e); } catch (x) {} }
                    });
                  }));
                });
              });
            }, Promise.resolve());
          });
        }, Promise.resolve()).then(function () { return out; });
      });
    }).then(function (out) { run.flushing = false; changed(); return out; }, function (e) { run.flushing = false; changed(); return { sent: 0, error: String(e && e.message || e) }; });
    return run.flushing;
  }
  function kick(ms) {
    if (run.kickTimer) return;
    run.kickTimer = setTimeout(function () { run.kickTimer = null; deliver(); }, typeof ms === 'number' ? ms : 400);
  }
  // Now and only now: a submit that is waiting for its answer.
  function deliverNow() { return deliver({ force: true }); }

  /* ---- The watcher: what the trainee changed in the namespace, sealed (§5.1).
     Run after the page's own writes to the keys it watches (the store's
     setItem), on another document's write (the 'storage' event), every
     15 seconds, and before a pull is applied. ---- */
  var capturing = null;
  function capture() {
    if (capturing) return capturing;
    var s = store(), sess = session();
    if (!s || !sess || !sess.sessionKey) return Promise.resolve(0);
    var me = { acct: sess.acct, stu: sess.stu };
    capturing = Promise.resolve().then(function () {
      var b = parse(s.getItem(BASE_KEY), {}), n = 0;
      return WATCHED.reduce(function (p, k) {
        return p.then(function () {
          var raw = s.getItem(k);
          if (raw == null) return;
          var d = diff(k, parse(raw, null), b[k], me);
          if (!d.items.length) { b[k] = d.base; return; }
          return d.items.reduce(function (q, body) {
            return q.then(function () { n++; return queue(body.kind, body, { noKick: true }); });
          }, Promise.resolve()).then(function () {
            b[k] = d.base;
            s.setItem(BASE_KEY, JSON.stringify(b));
          });
        });
      }, Promise.resolve()).then(function () {
        s.setItem(BASE_KEY, JSON.stringify(b));
        if (n) kick();
        return n;
      });
    }).then(function (n) { capturing = null; return n; }, function (e) { capturing = null; return 0; });
    return capturing;
  }
  function captureSoon() {
    if (run.captureTimer) return;
    run.captureTimer = setTimeout(function () { run.captureTimer = null; capture(); }, 300);
  }

  /* ---- Keeping it going: deliveries on 'online', on coming back to the
     page, every 30 seconds while anything waits; the records again on coming
     back after a while and every 5 minutes while the page is looked at. ---- */
  function wire(opts) {
    opts = opts || {};
    if (run.wired) return;
    run.wired = true;
    var visible = function () { return !root.document || root.document.visibilityState !== 'hidden'; };
    try {
      root.addEventListener('online', function () {
        run.holdUntil = 0; run.fails = 0;
        getOutbox().all().then(function (l) {
          return Promise.all(l.filter(function (e) { return e.state === 'wait' && e.nextAt; }).map(function (e) { var n = copy(e); n.nextAt = 0; return getOutbox().put(n); }));
        }).then(function () { deliver(); });
        changed();
      });
      root.addEventListener('offline', function () { changed(); });
      if (root.document) root.document.addEventListener('visibilitychange', function () {
        if (!visible()) { if (inNamespace()) capture(); return; }
        deliver();
        if (inNamespace() && typeof opts.onVisible === 'function') { try { opts.onVisible(); } catch (e) {} }
      });
      root.addEventListener('storage', function (ev) {
        if (!inNamespace() || !ev || !ev.key) return;
        var k = String(ev.key);
        if (k.indexOf(NS_PREFIX) === 0 && WATCHED.indexOf(k.slice(NS_PREFIX.length)) !== -1) captureSoon();
      });
    } catch (e) {}
    run.timer = setInterval(function () {
      if (!visible()) return;
      if (inNamespace()) capture();
      getOutbox().all().then(function (l) { if (l.some(function (e) { return e.state === 'wait'; })) deliver(); });
    }, RETRY_EVERY_MS / 2);
    // The store's own writes to the keys the watcher reads.
    var s = store();
    if (s && inNamespace() && !s.__gateWatched && typeof s.setItem === 'function') {
      var set = s.setItem;
      s.setItem = function (k, v) {
        var r = set.apply(this, arguments);
        if (WATCHED.indexOf(String(k)) !== -1 && !applying) captureSoon();
        return r;
      };
      s.__gateWatched = true;
    }
  }
  var applying = false;

  function configure(o) {
    Object.keys(o || {}).forEach(function (k) { cfg[k] = o[k]; });
    return API;
  }

  var API = {
    PROTOCOL: PROTOCOL, NS: NS, LAN_PATH: LAN_PATH, OUTBOX_DB: OUTBOX_DB,
    configure: configure, base: base, takeLink: takeLink, probeLan: probeLan, hasWork: hasWork,
    signIn: signIn, signInEmail: signInEmail, twoStep: twoStep, twoStepSend: twoStepSend,
    catalogue: catalogue, registerStart: registerStart, registerSubmit: registerSubmit,
    enter: enter, leave: leave, tidy: tidy, session: session, inSession: function () { return !!session(); },
    now: function () { return gateNow(session()); },
    pull: pull, applyPull: function (res) { applying = true; return applyPull(res).then(function (r) { applying = false; return r; }, function (e) { applying = false; throw e; }); },
    paper: paper, storedPaper: storedPaper, attempt: attempt, review: review, roomGet: roomGet, applyRoom: applyRoom,
    upload: upload, fileGet: fileGet, signOut: signOut,
    queue: queue, deliver: deliver, deliverNow: deliverNow, kick: kick, capture: capture, status: status,
    pending: function (acct) { return getOutbox().pendingFor(acct); },
    outbox: function () { return getOutbox().all(); },
    wire: wire, PULL_EVERY_MS: PULL_EVERY_MS,
    _pure: {
      backoffMs: backoffMs, receiptAction: receiptAction, callAnswerRetries: callAnswerRetries, pickBase: pickBase, validAddress: validAddress,
      parseGateFragment: parseGateFragment, stripGateFragment: stripGateFragment, coalesceKey: coalesceKey,
      planApply: planApply, mergeOwnList: mergeOwnList, mergeOwnMap: mergeOwnMap, mergeResults: mergeResults, mergeSettings: mergeSettings,
      mergeRoom: mergeRoom, ownedRecords: ownedRecords, diff: diff, baseFor: baseFor, makeOutbox: makeOutbox, memoryBackend: memoryBackend,
      sealItem: sealItem, hmacHex: hmacHex, pbkdf2Hex: pbkdf2Hex, sha256Hex: sha256Hex, proofFor: proofFor,
      BACKOFF_MIN_MS: BACKOFF_MIN_MS, BACKOFF_MAX_MS: BACKOFF_MAX_MS, WATCHED: WATCHED
    }
  };
  root.CESTISGate = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
