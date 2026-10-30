/* A PC's chat history must never be emptied because it grew.

   What went wrong (EF-7, measured on a generated Centre at month 10, 1.98 MB
   of chat): localStorage holds about 5 MB for the whole site and is full
   within the first month, so a chat history that outgrows it lives in
   IndexedDB only. The dashboard read the chat ONCE, at start-up, before
   IndexedDB had been read in: the history read as absent, the page started
   with an empty chat, and the membership pass saved that straight away —
   "{}" written over the stored history. On the next reload and sign-in the
   PC had 0 messages; they came back only from the shared chat file, while
   that still held them. The same start-up flaw wrote the School Fee roll as a
   list of blank placeholders over the stored one (syncStudentsToSchoolFee).

   Pinned here:
     - CESTISCore.chat.roomsDropped names the rooms a save would drop;
     - the chat save puts those rooms back (never a smaller-by-whole-rooms
       write), does nothing before the store is ready, and the room list goes
       through the never-empty guard;
     - the chat is read again, merged, once the store is ready (and the
       notifications); the School Fee mirror waits for the store;
     - the store itself refuses, before IndexedDB is read in, a write to a key
       that lives there only and that the document has not read;
     - CESTISCore.chat.contentSig: the chat file's fingerprint ignores when and
       by whom it was written and the order of its lists, and nothing else.

   The real-browser reproduction is tests/browser/chat-history-reload.js.

   Run: node tests/chat-history-not-emptied.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const tick = (ms) => new Promise(r => setTimeout(r, ms || 5));
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js'),
    coreSrc: fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js'), coreSrc: fs.readFileSync(path.join(ROOT, 'Offline System', 'cestis-core.js'), 'utf8') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const msg = (id, ts, text) => ({ id, senderId: 'U1', text: text || id, timestamp: ts || '2026-10-01T10:00:00.000Z' });

(async () => {
for (const page of PAGES) {
  const C = page.core, w = page.where;

  console.log('roomsDropped: the rooms a save would lose (' + w + ')');
  {
    const stored = { r1: [msg('a')], r2: [msg('b'), msg('c')], r3: [] };
    assertEq(C.chat.roomsDropped(stored, {}), ['r1', 'r2'], w + ': an empty chat drops every room that has messages');
    assertEq(C.chat.roomsDropped(JSON.stringify(stored), { r1: [msg('a')] }), ['r2'], w + ': a missing room is named (stored copy read as JSON too)');
    assertEq(C.chat.roomsDropped(stored, { r1: [msg('a')], r2: [] }), ['r2'], w + ': a room present but emptied is named');
    assertEq(C.chat.roomsDropped(stored, { r1: [msg('a')], r2: [msg('c')] }), [], w + ': fewer messages in a room (the 500 cap) is not a dropped room');
    assertEq(C.chat.roomsDropped(null, {}), [], w + ': nothing stored, nothing dropped');
    assertEq(C.chat.roomsDropped('not json', {}), [], w + ': an unreadable stored copy names nothing');
    assertEq(C.chat.roomsDropped({ r3: [] }, {}), [], w + ': a stored room with no messages is no loss');
  }

  console.log('contentSig: what the chat file says, not when or in what order (' + w + ')');
  {
    const base = { version: '1.1', timestamp: '2026-10-01T10:00:00Z', savedBy: 'Office PC',
      chatRooms: [{ id: 'chat-admin', name: 'Admin', members: ['U1', 'U2'] }, { id: 'chat-class-1', name: 'Welding', members: ['U3'] }],
      chatMessages: { 'chat-admin': [msg('m1', '2026-10-01T10:00:00Z'), msg('m2', '2026-10-01T10:01:00Z')] },
      chatProfiles: { U1: { status: 'online', lastSeen: '2026-10-01T10:00:00Z' } }, chatFollows: { U1: ['U2'] }, chatFollowLog: {}, tombstones: { chatRooms: {} } };
    const same = JSON.parse(JSON.stringify(base));
    same.timestamp = '2026-10-02T09:00:00Z'; same.savedBy = 'Another PC';
    same.chatRooms.reverse(); same.chatMessages['chat-admin'].reverse();
    same.chatProfiles = { U1: { lastSeen: '2026-10-01T10:00:00Z', status: 'online' } };
    assertEq(C.chat.contentSig(same), C.chat.contentSig(base), w + ': a different writer, time, list order or key order is the same content');
    const edited = JSON.parse(JSON.stringify(base)); edited.chatMessages['chat-admin'][1].text = 'edited';
    assert(C.chat.contentSig(edited) !== C.chat.contentSig(base), w + ': an edited message is a change');
    const more = JSON.parse(JSON.stringify(base)); more.chatMessages['chat-admin'].push(msg('m3'));
    assert(C.chat.contentSig(more) !== C.chat.contentSig(base), w + ': a new message is a change');
    const seen = JSON.parse(JSON.stringify(base)); seen.chatProfiles.U1.lastSeen = '2026-10-01T10:05:00Z';
    assert(C.chat.contentSig(seen) !== C.chat.contentSig(base), w + ': someone seen later is a change (presence travels)');
    const tomb = JSON.parse(JSON.stringify(base)); tomb.tombstones.chatRooms = { 'chat-x': '2026-10-01T11:00:00Z' };
    assert(C.chat.contentSig(tomb) !== C.chat.contentSig(base), w + ': a deleted room is a change');
  }

  console.log('The chat save never writes fewer rooms of history than it holds (' + w + ')');
  {
    const names = ['lmsChatStoreReady', 'lmsChatKeepStoredRooms', 'trimLmsChatHistory', 'saveLmsChatData'];
    const src = names.map(n => extractFunction(page.src, n, w)).join('\n') + '\nvar LMS_CHAT_MAX_MESSAGES_PER_ROOM = 500;';
    const mk = (stored, ready) => {
      const data = Object.assign({}, stored);
      const sets = [];
      const ctx = {
        CESTISCore: C, console: { warn() {}, log() {}, error() {} }, JSON, Object, Array,
        window: {}, lmsChatMessages: {}, lmsChatRooms: [{ id: 'chat-admin' }], lmsChatProfiles: {}, lmsChatFollows: {}, lmsChatFollowLog: {},
        safeJsonParse: (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
        saveCollection: (k, v) => { sets.push('collection ' + k); data[k] = JSON.stringify(v); return true; },
        lmsChatScheduleDriveSync: () => sets.push('push'),
        CESTISStore: { isReady: () => ready, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { sets.push(k); data[k] = String(v); } }
      };
      ctx.window.CESTISStore = ctx.CESTISStore;
      vm.createContext(ctx); vm.runInContext(src, ctx);
      return { ctx, data, sets };
    };
    const stored = { voctrain_chatMessages: JSON.stringify({ 'chat-admin': [msg('a'), msg('b')], 'dm-1': [msg('c')] }) };
    // Before the store is ready: nothing at all is written or pushed.
    let t = mk(stored, false);
    t.ctx.saveLmsChatData();
    assertEq(t.sets, [], w + ': before the store is read in, the chat save writes and pushes nothing');
    // Ready, but this page's chat is empty: the stored rooms are kept.
    t = mk(stored, true);
    t.ctx.saveLmsChatData();
    const after = JSON.parse(t.data.voctrain_chatMessages);
    assertEq(Object.keys(after).sort(), ['chat-admin', 'dm-1'], w + ': an empty chat in memory does not replace the stored rooms');
    assertEq(after['chat-admin'].map(m => m.id), ['a', 'b'], w + ': with every message');
    assertEq(Object.keys(t.ctx.lmsChatMessages).sort(), ['chat-admin', 'dm-1'], w + ': and memory has them back (the screen and the next upload too)');
    assert(t.sets.indexOf('collection voctrain_chatRooms') !== -1, w + ': the room list goes through the never-empty guard');
    // A room emptied in memory, a new message in another: both kept.
    t = mk(stored, true);
    t.ctx.lmsChatMessages = { 'chat-admin': [], 'dm-1': [msg('c'), msg('d', '2026-10-01T11:00:00.000Z')] };
    t.ctx.saveLmsChatData();
    const after2 = JSON.parse(t.data.voctrain_chatMessages);
    assertEq(after2['chat-admin'].map(m => m.id), ['a', 'b'], w + ': a room emptied in memory keeps its stored history');
    assertEq(after2['dm-1'].map(m => m.id), ['c', 'd'], w + ': a room with a new message is saved with it');
    // Memory that holds everything: written as it is.
    t = mk(stored, true);
    t.ctx.lmsChatMessages = { 'chat-admin': [msg('a'), msg('b'), msg('e', '2026-10-01T12:00:00.000Z')], 'dm-1': [msg('c')] };
    t.ctx.saveLmsChatData();
    assertEq(JSON.parse(t.data.voctrain_chatMessages)['chat-admin'].map(m => m.id), ['a', 'b', 'e'], w + ': an ordinary save is written as it is');
  }

  console.log('The chat (and the notifications) are read again once the store is ready (' + w + ')');
  {
    const src = page.src;
    const i = src.indexOf('initLmsChatData();\n// Membership is saved with the chat');
    assert(i !== -1, w + ': the start-up chat read is followed by the membership note');
    const block = src.slice(i, i + 1600);
    assert(/if \(lmsChatStoreReady\(\)\) lmsChatEnsureMembership\(\);/.test(block), w + ': membership is not saved from the start-up read before the store is ready');
    assert(/CESTISStore\.whenReady\(function\(\) \{[\s\S]*reloadNotificationsFromStore\(\)[\s\S]*lmsChatReloadFromStore\(\)/.test(block), w + ': both are read again when the store is ready');
    // lmsChatReloadFromStore merges, never replaces.
    const names = ['lmsChatReloadFromStore'];
    const fnSrc = names.map(n => extractFunction(src, n, w)).join('\n');
    const data = {
      voctrain_chatRooms: JSON.stringify([{ id: 'chat-admin', name: 'Admin' }, { id: 'dm-1', type: 'dm' }]),
      voctrain_chatMessages: JSON.stringify({ 'chat-admin': [msg('a'), msg('b')], 'dm-1': [msg('c')] })
    };
    let ensured = 0;
    const ctx = {
      CESTISCore: C, console: { warn() {}, log() {} }, JSON, Object, Array, Promise,
      lmsChatRooms: [{ id: 'chat-admin', name: 'Admin' }, { id: 'chat-class-1', name: 'Welding' }],
      lmsChatMessages: { 'chat-admin': [msg('z', '2026-10-01T13:00:00.000Z')] }, lmsChatProfiles: {}, lmsChatFollows: {}, lmsChatFollowLog: {},
      syncTombsFor: () => ({}), lmsChatCleanRooms() {}, lmsChatEnsureMembership() { ensured++; }, lmsChatGetRolePrefix: () => null,
      lmsChatRenderRoomList() {}, lmsChatLoadImagesFromDB: () => Promise.resolve([]),
      safeJsonParse: (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } },
      CESTISStore: { getItem: k => (k in data ? data[k] : null) }
    };
    vm.createContext(ctx); vm.runInContext(fnSrc, ctx);
    assert(ctx.lmsChatReloadFromStore() === true, w + ': the stored chat is taken in');
    assertEq(ctx.lmsChatMessages['chat-admin'].map(m => m.id), ['a', 'b', 'z'], w + ': stored and in-memory messages are merged (nothing in memory dropped)');
    assertEq(ctx.lmsChatMessages['dm-1'].map(m => m.id), ['c'], w + ': a room only the store held is back');
    assertEq(ctx.lmsChatRooms.map(r => r.id), ['chat-admin', 'dm-1', 'chat-class-1'], w + ': the stored rooms, then any only this page held');
    assertEq(ensured, 1, w + ': and membership is worked out from the whole list');
    assert(/function reloadNotificationsFromStore\(\)[\s\S]{0,400}CESTISCore\.sync\.mergeList\(notifications, stored/.test(src), w + ': the stored notifications are merged into memory');
    assert(/function saveNotifications\(\) \{[\s\S]{0,300}!CESTISStore\.isReady\(\)\) return;/.test(src), w + ': and not saved before the store is ready');
  }

  console.log('The School Fee mirror waits for the store (' + w + ')');
  {
    const f = extractFunction(page.src, 'syncStudentsToSchoolFee', w);
    assert(/storeNotReady\(\)\) \{[\s\S]{0,300}CESTISStore\.whenReady\(/.test(f), w + ': before the store is ready it waits, then runs once');
    assert(page.src.indexOf("if (storeNotReady()) return;\n      CESTISCore.pageCloud.guardedSet(CESTISStore, 'cestiSchoolFeeStudents', JSON.stringify(d.students));") !== -1,
      w + ': the roll the fee page sends is not written before the store is ready, nor empty over a stored one');
  }
}

/* -------------------- the store: no write to an unread IndexedDB-only key */
console.log('Before IndexedDB is read in, a key that lives there only is not written over');
function slice(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('store copy not found');
  return src.slice(a, b + end.length);
}
for (const page of PAGES) {
  const w = page.where.replace('index.html', 'cestis-core.js');
  const body = slice(page.coreSrc, '  (function () {\n    if (!root || root.CESTISStore) return;', '    root.CESTISStore = Store;\n  })();\n');
  const storeSrc = '(function (root) {\n  \'use strict\';\n' + body + '})(this);\n';
  // One origin: localStorage (40-char limit), an IndexedDB that answers later.
  const LIMIT = 40;
  const ls = new Map([['__cestis_idb_only__:voctrain_chatMessages', '1'], ['voctrain_chatRooms', '[{"id":"r1"}]']]);
  const idb = new Map([['voctrain_chatMessages', JSON.stringify({ r1: [msg('a'), msg('b')] })], ['voctrain_chatRooms', '[{"id":"r1"}]']]);
  const localStorage = {
    get length() { return ls.size; }, key: i => Array.from(ls.keys())[i] || null,
    getItem: k => (ls.has(k) ? ls.get(k) : null),
    setItem(k, v) { if (String(v).length > LIMIT) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } ls.set(k, String(v)); },
    removeItem: k => { ls.delete(k); }, clear: () => ls.clear()
  };
  const indexedDB = { open() {
    const req = {};
    setTimeout(() => {
      const handle = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => ({
        put: (v, k) => idb.set(k, v), delete: k => idb.delete(k),
        get: k => { const r = {}; setTimeout(() => { r.result = idb.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
        openCursor: () => { const r = {}; const es = Array.from(idb.entries()); let i = 0;
          const step = () => setTimeout(() => { const e = es[i++]; r.onsuccess({ target: { result: e ? { key: e[0], value: e[1], continue: step } : null } }); }, 0);
          step(); return r; } }) }) };
      req.onsuccess && req.onsuccess({ target: { result: handle } });
    }, 15);
    return req;
  } };
  const events = [];
  const ctx = { console: { info() {}, log() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout, clearTimeout, localStorage, indexedDB, navigator: { storage: { persist() {} } },
    addEventListener: (t, fn) => events.push({ t, fn }), dispatchEvent: ev => events.filter(e => e.t === ev.type).forEach(e => e.fn(ev)),
    Event: function (t) { this.type = t; }, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; } };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(storeSrc, ctx);
  const S = ctx.CESTISStore;
  assert(S.isReady() === false, w + ': the store starts before IndexedDB is read');
  const w0 = S.writes;
  S.setItem('voctrain_chatMessages', '{}');
  assertEq(S.getItem('voctrain_chatMessages'), null, w + ': the write of "{}" over the unread chat is refused');
  assertEq(S.writes, w0, w + ': and is not counted as a change');
  S.setItem('voctrain_chatRooms', '[{"id":"r1"},{"id":"r2"}]');
  assertEq(S.getItem('voctrain_chatRooms'), '[{"id":"r1"},{"id":"r2"}]', w + ': a key localStorage holds is written as before');
  await new Promise(r => S.whenReady(r)); await tick(30);
  assertEq(JSON.parse(S.getItem('voctrain_chatMessages')).r1.map(m => m.id), ['a', 'b'], w + ': once ready, the stored chat reads back whole');
  assertEq(JSON.parse(idb.get('voctrain_chatMessages')).r1.length, 2, w + ': and IndexedDB still holds it');
  S.setItem('voctrain_chatMessages', JSON.stringify({ r1: [msg('a'), msg('b'), msg('c')] }));
  assertEq(JSON.parse(S.getItem('voctrain_chatMessages')).r1.length, 3, w + ': after ready, writes go through as always');
  await tick(10);
  assertEq(JSON.parse(idb.get('voctrain_chatMessages')).r1.length, 3, w + ': and reach IndexedDB');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
