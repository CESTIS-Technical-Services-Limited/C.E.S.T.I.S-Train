/* The trainee gate's client (cestis-gate-client.js, Stage 4) — what can be
   shown in Node: its pure rules, and the client itself talking to the REAL
   trainee-gate/PASTE-GATE.gs in the simulated Apps Script runtime
   (tests/gate-appsscript-fakes.js), with Node's own WebCrypto and fetch
   pointed at it.

   The failures it pins (docs/trainee-gate/DESIGN.md §5.1, §6, §7.1, §8):
     - backoff 2 s → 5 min; a receipt's meaning (done / reseal / retry /
       refused) — nothing leaves the outbox without a delivery receipt, a
       refused item is kept, a revoked one waits to be sealed again;
     - a newer unsent save replaces an older one still waiting (coalescing),
       never one refused, never another trainee's, never a submit;
     - which gate: the Centre's own server by origin, else the trainees'
       link, else the Centre's settings when switched on; the link's
       fragment decoded (and only an https address taken);
     - the seal is Core.gate.seal byte for byte (WebCrypto HMAC over canon),
       and the password proof is Core.gate.proof.make on PBKDF2 and legacy
       hashes — so the gate accepts both;
     - the namespace apply: read-only keys replaced by the slice, a trainee's
       own records merged with what the device has not sent (an unsent edit
       is never lost to an older slice copy; a record already gone from the
       Centre is not kept), results the gate marked kept until the slice has
       them, a retired attempt wins, unsent read marks kept, settings mapped;
     - the watcher sends only the trainee's own changed records (never
       another's, never a retired attempt, never a picture's bytes) and read
       or cleared marks as operations;
     - end to end against the real gate: sign in by PBKDF2, legacy and with
       two-step; seal and deliver; a password reset revokes the session,
       the items wait, and the next sign-in seals them again and they are
       taken; a submit is marked and answered with its result; a pull
       applies the slice.

   Run: node tests/gate-client.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const Core = require('../cestis-core.js');
const fakes = require('./gate-appsscript-fakes.js');
const { makeCentre, crypto, NOW, MIN, DAY, iso } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function eq(a, b, m) { assert(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const J = v => JSON.parse(JSON.stringify(v));
const G = Core.gate;

/* ---- A browser-shaped world for the client: localStorage, the gate's
   namespace of the store, and fetch to the gate. ---- */
function makeLS() {
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null), setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(String(k)); }, key: i => Array.from(m.keys())[i] || null, get length() { return m.size; }, _m: m
  };
}
const LS = makeLS();
globalThis.localStorage = LS;
globalThis.CESTISCore = Core;
// The store, opened in the gate's namespace (its keys under 'g1::', as cestis-core.js keeps them).
const NSStore = {
  namespace: 'g1',
  getItem: k => LS.getItem('g1::' + k), setItem: (k, v) => LS.setItem('g1::' + k, v), removeItem: k => LS.removeItem('g1::' + k)
};
globalThis.indexedDB = { deleteDatabase() { const r = {}; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; } };
const GATE_URL = 'https://script.google.com/macros/s/FAKE/exec';
let WORLD = null, DOWN = false, PART_BUDGET = Infinity;
globalThis.fetch = async (url, opts) => {
  if (DOWN) throw new TypeError('Failed to fetch');
  // A signal that drops part-way through her files: the next part does not go.
  if (opts && /"op":"upload\.part"/.test(String(opts.body || '')) && PART_BUDGET-- <= 0) throw new TypeError('Failed to fetch');
  if (String(url).indexOf(GATE_URL) !== 0) throw new TypeError('blocked ' + url);
  const body = opts && opts.body;
  const out = opts && opts.method === 'POST' ? WORLD.post(body) : WORLD.get({ op: 'health' });
  return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
};
const Gate = require('../cestis-gate-client.js');
const P = Gate._pure;
const backend = P.memoryBackend();
Gate.configure({ outboxBackend: backend, store: null, client: 'test' });

(async function main() {
  /* ====================================================== pure rules */
  console.log('Backoff 2 s → 5 min, and what a receipt means');
  eq([0, 1, 2, 3, 7, 8, 30].map(P.backoffMs), [2000, 4000, 8000, 16000, 256000, 300000, 300000], 'the wait before the next try');
  eq([{ ok: true }, { ok: true, dup: true }, { ok: false, reason: 'revoked' }, { ok: false, reason: 'retry', retry: true },
    { ok: false, reason: 'not-ready', retry: true }, { ok: false, reason: 'not-yours' }, { ok: false, reason: 'bad-seal' }, null].map(P.receiptAction),
    ['done', 'done', 'reseal', 'retry', 'retry', 'refused', 'refused', 'retry'], 'done / reseal / retry / refused (no receipt at all: retry)');
  assert(P.callAnswerRetries({ ok: false, error: 'off' }) && P.callAnswerRetries(null) && !P.callAnswerRetries({ ok: true, receipts: [] }), 'a request not answered item by item is tried again whole');

  console.log('The outbox: coalescing, refusals kept, nothing dropped without a receipt');
  {
    const be = P.memoryBackend(), ob = P.makeOutbox(be);
    const E = (id, ck, extra) => Object.assign({ id, item: { id }, base: 'B', a: 'USR-A', sid: 's', kind: 'rec', ck, state: 'wait', tries: 0, nextAt: 0, at: Date.now() + Number(id.slice(1)) }, extra || {});
    await ob.add(E('i1', 'rec|voctrain_examAttempts|ATT-1'));
    await ob.add(E('i2', 'rec|voctrain_examAttempts|ATT-1'));
    eq((await ob.all()).map(e => e.id), ['i2'], 'a newer save of the same attempt replaces the one still waiting');
    await ob.put(E('i3', 'rec|voctrain_submissions|SUB-1', { state: 'refused' }));
    await ob.add(E('i4', 'rec|voctrain_submissions|SUB-1'));
    await ob.add(E('i5', 'rec|voctrain_examAttempts|ATT-1', { a: 'USR-B' }));
    await ob.add(E('i6', '', { kind: 'submit' }));
    await ob.add(E('i7', '', { kind: 'submit' }));
    eq((await ob.all()).map(e => e.id).sort(), ['i2', 'i3', 'i4', 'i5', 'i6', 'i7'], 'never over a refused one, another trainee\'s, or a submit');
    const all = await ob.all();
    const by = id => all.find(e => e.id === id);
    eq(await ob.settle(by('i2'), { id: 'i2', ok: true }, 1000), 'done', 'ok: done');
    eq(await ob.settle(by('i4'), { id: 'i4', ok: false, reason: 'revoked' }, 1000), 'reseal', 'revoked: waits to be sealed again');
    eq(await ob.settle(by('i5'), { id: 'i5', ok: false, reason: 'retry', retry: true }, 1000), 'retry', 'retry');
    eq(await ob.settle(by('i6'), { id: 'i6', ok: false, reason: 'not-yours' }, 1000), 'refused', 'refused');
    eq(await ob.settle(by('i7'), null, 1000), 'retry', 'no receipt: tried again');
    const after = await ob.all(), st = id => after.find(e => e.id === id);
    assert(!st('i2') && st('i4').state === 'revoked' && st('i5').state === 'wait' && st('i5').tries === 1 && st('i5').nextAt === 1000 + 4000 &&
      st('i6').state === 'refused' && st('i6').reason === 'not-yours' && st('i3').state === 'refused', 'only the delivered one left the outbox; the refused are kept, with why');
    eq((await ob.pendingFor('USR-A')).map(e => e.id).sort(), ['i4', 'i7'], 'unsent for a trainee: waiting and revoked, not refused');
  }

  console.log('Which gate: the Centre\'s server by origin, else the link, else the settings when on');
  eq(P.pickBase({ lan: true, origin: 'http://192.168.1.10:8443', address: 'https://x.example/exec' }), { kind: 'lan', url: 'http://192.168.1.10:8443/_cestis/gate' }, 'served by the Centre\'s server: its own /_cestis/gate');
  eq(P.pickBase({ address: GATE_URL, settings: { traineeGate: { url: 'https://other.example/exec', enabled: true } } }), { kind: 'online', url: GATE_URL }, 'the trainees\' link first');
  eq(P.pickBase({ settings: { traineeGate: { url: GATE_URL, enabled: true } } }), { kind: 'online', url: GATE_URL }, 'else the Centre\'s settings, switched on');
  eq(P.pickBase({ settings: { traineeGate: { url: GATE_URL, enabled: false } } }), null, 'switched off: none (today\'s sign-in)');
  eq(P.pickBase({ address: 'http://plain.example/exec' }), null, 'only an https address is taken');
  eq(P.pickBase({}), null, 'nothing set up: none');
  const frag = '#gate=' + G.b64url(G.utf8(GATE_URL));
  eq(P.parseGateFragment(frag), GATE_URL, 'the link\'s fragment is the address');
  eq(P.parseGateFragment('#tab=2&gate=' + G.b64url(G.utf8(GATE_URL)) + '&x=1'), GATE_URL, 'among other fragment words');
  eq(P.parseGateFragment('#gate=' + G.b64url(G.utf8('javascript:alert(1)'))), '', 'not an address: ignored');
  eq(P.stripGateFragment('#tab=2&gate=abc&x=1'), '#tab=2&x=1', 'and it is taken out of the address bar');

  console.log('The seal is Core.gate.seal, and the proof is Core.gate.proof.make');
  {
    const item = { id: 'IT-1', a: 'USR-A', sid: 'k1.abc.12345678', kind: 'rec', key: 'voctrain_submissions', rec: { id: 'SUB-1', b: [2, 1], a: { y: 1, x: 'é' } }, createdAt: iso(NOW) };
    const key = 'f'.repeat(64);
    const mine = await P.sealItem(item, key);
    eq(mine.mac, G.seal(item, key, crypto).mac, 'WebCrypto HMAC over canon(item without mac), the key as the UTF-8 of its hex');
    assert(G.sealOk(mine, key, crypto) && !G.sealOk(Object.assign({}, mine, { kind: 'submit' }), key, crypto), 'the gate\'s own check accepts it, and refuses a changed one');
    const V = nodeCrypto.pbkdf2Sync('pw', Buffer.from('a1b2c3d4', 'hex'), 1000, 32, 'sha256').toString('hex');
    eq(await P.proofFor('pw', { algo: 'pbkdf2-sha256', salt: 'a1b2c3d4', iter: 1000 }, 'n1', 'Tameka.R'), G.proof.make(V, 'n1', 'Tameka.R', crypto), 'PBKDF2 proof');
    const L = nodeCrypto.createHash('sha256').update('pw__CESTIS_SALT_2026__').digest('hex');
    eq(await P.proofFor('pw', { algo: 'sha256-legacy' }, 'n2', 'kemar'), G.proof.make(L, 'n2', 'kemar', crypto), 'legacy proof');
  }

  console.log('Into the namespace: read-only keys replaced, a trainee\'s own merged with what is unsent');
  {
    const me = { acct: 'USR-A', stu: 'STU-A' };
    const t = ms => iso(NOW + ms);
    const slice = { studentId: 'STU-A', settings: { centreName: 'CESTIS', centreUtcOffset: '-05:00', maintenanceMode: false, gateUrl: GATE_URL },
      data: {
        voctrain_announcements: [{ id: 'AN-1', title: 'New', readBy: [] }, { id: 'AN-2', title: 'Two', readBy: [] }],
        voctrain_submissions: [{ id: 'SUB-1', studentId: 'STU-A', comment: 'v1', updatedAt: t(0) }, { id: 'SUB-2', studentId: 'STU-A', comment: 'graded', grade: 9, updatedAt: t(5 * MIN) }],
        voctrain_examResults: [{ id: 'RES-S1', attemptId: 'ATT-S', studentId: 'STU-A', score: 70 }],
        voctrain_examAttempts: [{ id: 'ATT-9', examId: 'EX', studentId: 'STU-A', status: 'open', questions: [{ id: 'Q' }], answers: [null], answeredAt: [0], flagged: [false], flaggedAt: [0], startTime: NOW - 10 * MIN, deadline: NOW + 50 * MIN, updatedAt: t(0) }],
        voctrain_studentProfiles: { 'USR-A': { phone: '876-555-0101', updatedAt: t(0) } },
        voctrain_support_messages: []
      } };
    const local = {
      voctrain_announcements: [{ id: 'AN-OLD', title: 'Gone from the Centre' }],
      voctrain_submissions: [{ id: 'SUB-1', studentId: 'STU-A', comment: 'v2 (unsent)', updatedAt: t(-MIN) }, { id: 'SUB-2', studentId: 'STU-A', comment: 'mine', updatedAt: t(0) },
        { id: 'SUB-3', studentId: 'STU-A', comment: 'new, unsent', updatedAt: t(MIN) }, { id: 'SUB-4', studentId: 'STU-A', comment: 'sent long ago, since removed by the office' }],
      voctrain_examResults: [{ id: 'RES-G-abc', attemptId: 'ATT-G', studentId: 'STU-A', markedBy: 'gate', score: 80 }, { id: 'RES-local', attemptId: 'ATT-S', studentId: 'STU-A' }],
      voctrain_examAttempts: [Core.exams.retireAttempt({ id: 'ATT-9', examId: 'EX', studentId: 'STU-A', startTime: NOW - 10 * MIN, deadline: NOW + 50 * MIN }, null, t(MIN))],
      voctrain_studentProfiles: { 'USR-A': { phone: '876-555-0199', updatedAt: t(-MIN) } },
      voctrain_systemSettings: { cestisTheme: 'dark', institutionName: 'old' }
    };
    const plan = P.planApply(slice, local, { me, nowMs: NOW,
      pending: { voctrain_submissions: { 'SUB-1': true, 'SUB-3': true }, voctrain_studentProfiles: { 'USR-A': true } },
      pendingOps: [{ id: 'OP-1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-2', at: t(0) }],
      overlay: { lanes: [{ records: { voctrain_support_messages: [{ id: 'SUP-9', subject: 'sent, not collected yet' }] }, ops: [{ id: 'OP-0', kind: 'read', key: 'voctrain_announcements', recId: 'AN-1' }] }],
        results: [{ result: { id: 'RES-G-ovl', attemptId: 'ATT-O', studentId: 'STU-A', score: 60 }, retired: null }] } });
    const W = plan.writes;
    eq(W.voctrain_announcements.map(a => a.id), ['AN-1', 'AN-2'], 'a read-only collection is the slice\'s, whole (AN-OLD gone)');
    eq(W.voctrain_announcements.map(a => a.readBy), [['USR-A'], ['USR-A']], 'read marks the gate holds, and the unsent one, are kept');
    const sub = id => W.voctrain_submissions.find(s => s.id === id);
    assert(sub('SUB-1').comment === 'v2 (unsent)', 'an unsent edit wins over the slice\'s copy, even an older-stamped one');
    assert(sub('SUB-2').grade === 9 && sub('SUB-2').comment === 'graded', 'a sent record takes the slice\'s newer copy (the office\'s)');
    assert(sub('SUB-3') && sub('SUB-3').comment === 'new, unsent', 'a record only this device holds stays while it waits to be sent');
    assert(!sub('SUB-4'), 'a record already sent and no longer the Centre\'s is not kept');
    eq(W.voctrain_support_messages.map(m => m.id), ['SUP-9'], 'what the gate says was sent shows, before the office has it');
    eq(W.voctrain_examResults.map(r => r.id).sort(), ['RES-G-abc', 'RES-G-ovl', 'RES-S1'], 'results: the slice\'s, the gate\'s answers kept, a local copy of one the slice has dropped');
    assert(Core.exams.attemptIsRetired(W.voctrain_examAttempts.find(a => a.id === 'ATT-9')), 'an attempt submitted here stays submitted, whatever the slice still shows');
    eq(W.voctrain_studentProfiles['USR-A'].phone, '876-555-0199', 'an unsent profile edit is kept');
    assert(W.voctrain_systemSettings.institutionName === 'CESTIS' && W.voctrain_systemSettings.cestisTheme === 'dark' && W.voctrain_systemSettings.traineeGate.url === GATE_URL &&
      W.voctrain_systemSettings.centreUtcOffset === '-05:00', 'settings: the Centre\'s name, time zone and the gate\'s address; this device\'s own kept');
    assert(plan.base.voctrain_submissions['SUB-1'] === G.hashOf(sub('SUB-1')), 'the watcher\'s base is what was just applied');
  }

  console.log('The watcher: only the trainee\'s own changes, as items');
  {
    const me = { acct: 'USR-A', stu: 'STU-A' };
    const open = { id: 'ATT-1', examId: 'EX', studentId: 'STU-A', status: 'open', questions: [{ id: 'Q' }], answers: [1], answeredAt: [NOW], flagged: [false], flaggedAt: [0], startTime: NOW - MIN, deadline: NOW + 9 * MIN };
    const value = [open, Object.assign({}, open, { id: 'ATT-2', studentId: 'STU-B' }), Core.exams.retireAttempt(Object.assign({}, open, { id: 'ATT-3' }), 'RES-1', iso(NOW))];
    let d = P.diff('voctrain_examAttempts', value, {}, me);
    eq(d.items.map(i => i.rec.id), ['ATT-1'], 'her open attempt — not another trainee\'s, not a submitted one');
    d = P.diff('voctrain_examAttempts', value, d.base, me);
    eq(d.items.length, 0, 'unchanged: nothing more');
    const changed = J(value); changed[0].answers = [2];
    eq(P.diff('voctrain_examAttempts', changed, d.base, me).items.length, 1, 'an answer changed: one item');
    const chat = { 'ROOM-1': [{ id: 'M1', senderId: 'USR-A', text: 'hi', imageData: 'data:image/png;base64,AAAA' }, { id: 'M2', senderId: 'USR-STAFF', text: 'hello' }] };
    const c = P.diff('voctrain_chatMessages', chat, {}, me);
    assert(c.items.length === 1 && c.items[0].rec.roomId === 'ROOM-1' && c.items[0].rec.imageData === undefined, 'her chat message, with its room and without the picture\'s bytes');
    const prof = P.diff('voctrain_studentProfiles', { 'USR-A': { phone: '1' }, 'USR-B': { phone: '2' } }, {}, me);
    eq(prof.items.map(i => i.recId), ['USR-A'], 'her own profile only, named by its key');
    const notes = [{ id: 'N1', readBy: ['USR-A'] }, { id: 'N2', readBy: ['USR-A'], clearedBy: ['USR-A'] }, { id: 'N3', readBy: ['USR-B'] }];
    const ops = P.diff('voctrain_notifications', notes, {}, me).items.map(i => i.op.kind + ':' + i.op.recId);
    eq(ops, ['read:N1', 'clearNotif:N2'], 'read and cleared marks of hers become operations');
    const op2 = P.diff('voctrain_notifications', notes, P.diff('voctrain_notifications', notes, {}, me).base, me);
    eq(op2.items.length, 0, 'once only');
  }

  /* ======================================== against the real gate */
  console.log('The client against the real gate: sign in, seal, deliver, a reset revokes, re-sealed at the next sign-in');
  const C = makeCentre(Core);
  WORLD = fakes.makeWorld({ now: NOW - 30 * MIN, seed: 'gate-client' });
  const main = WORLD.drive.mkdir('root', 'CESTIS Main');
  const ledgerOf = () => ({ version: 1, savedAt: iso(NOW - DAY), savedBy: 'admin1', accounts: J(C.store.voctrain_users), deletedUserIds: [] });
  const ledger = WORLD.drive.put(main.id, 'CESTIS_ACCOUNTS.json', ledgerOf());
  WORLD.drive.put(main.id, 'CESTIS_LMS_BACKUP.json', { version: '1.0', data: {} });
  WORLD.load(fs.readFileSync(path.join(__dirname, '..', 'trainee-gate', 'PASTE-GATE.gs'), 'utf8'));
  WORLD.get({ op: 'health' });
  const cfg = WORLD.drive.json(WORLD.drive.child(main.id, 'CESTIS_GATE.json', 'file').id);
  const all = G.buildAll(C.store, WORLD.clock.now, { gateUrl: GATE_URL, builtBy: 'dev-test' });
  Object.keys(all.slices).forEach(acct => {
    const s = all.slices[acct].slice;
    const f = WORLD.drive.mkdir(cfg.traineesId, s.studentId, { description: 'cestis-trainee acct=' + acct + ' v=1' });
    WORLD.drive.put(f.id, 'from-centre.json', s);
  });
  Object.keys(all.keys).forEach(id => WORLD.drive.put(cfg.keysId, 'key.' + id + '.json', all.keys[id].key));
  Object.keys(all.papers).forEach(id => WORLD.drive.put(cfg.papersId, 'paper.' + id + '.json', all.papers[id].paper));
  LS.setItem('cestisGateAddress', GATE_URL);

  const T1 = C.trainees[1], T9 = C.trainees[9], T4 = C.trainees[4];
  let s1 = await Gate.signIn({ login: T1.acct.username, password: T1.pw });
  assert(s1.ok && s1.token && s1.account.id === T1.acct.id && s1.base.url === GATE_URL, 'PBKDF2 sign-in: a session (' + (s1.error || '') + ')');
  const s9 = await Gate.signIn({ login: T9.acct.email, password: T9.pw });
  assert(s9.ok && s9.token, 'legacy-hash sign-in by email address: a session (' + (s9.error || '') + ')');
  eq((await Gate.signIn({ login: T1.acct.username, password: 'wrong' })).error, 'no-match', 'a wrong password: no-match');
  const t4 = await Gate.signIn({ login: T4.acct.username, password: T4.pw });
  assert(t4.ok && t4.need2fa && t4.methods.indexOf('totp') !== -1, 'two-step: asked for a code');
  const code = G.totp.code(T4.acct.twoFactorSecret, WORLD.clock.now, crypto);
  const s4 = await Gate.twoStep({ ticket: t4.ticket, method: 'totp', code });
  assert(s4.ok && s4.token && s4.account.id === T4.acct.id, 'and the authenticator\'s code opens a session');

  // Into T1's namespace (the store reads the 'g1::' keys enter() writes).
  Gate.configure({ store: NSStore });
  assert(await Gate.enter(s1), 'enter: the session goes into the gate\'s namespace');
  assert(LS.getItem('cestisGateNs') === 'g1' && LS.getItem('g1::cestisGateSessionKey') === s1.sessionKey && Gate.session().acct === T1.acct.id, 'the control key and the session, namespaced');
  const pulled = await Gate.pull();
  assert(pulled.ok && pulled.slice && pulled.slice.accountId === T1.acct.id, 'pull: her slice');
  const applied = await Gate.applyPull(pulled);
  assert(applied && JSON.parse(NSStore.getItem('voctrain_students'))[0].id === T1.stu.id && JSON.parse(NSStore.getItem('voctrain_users')).length === 1, 'applied: her records, one account card');
  const supId = 'SUP-CLIENT-1';
  await Gate.queue('rec', { key: 'voctrain_support_messages', rec: { id: supId, subject: 'Practical', message: 'Which room?', timestamp: WORLD.clock.now } }, { noKick: true });
  let res = await Gate.deliver({ force: true });
  assert(res.done === 1 && (await Gate.outbox()).length === 0, 'sealed and delivered: the receipt takes it out of the outbox (' + JSON.stringify(res) + ')');
  const folder = WORLD.drive.children(cfg.traineesId, 'folder').find(f => /acct=USR-T02(\s|$)/.test(f.description));
  const laneFile = WORLD.drive.children(folder.id, 'file').find(f => f.name.indexOf('CESTISINBOX.L-') === 0);
  assert(laneFile && WORLD.drive.json(laneFile.id).records.voctrain_support_messages.some(m => m.id === supId), 'in her session\'s own lane');
  res = await Gate.deliver({ force: true });
  eq(res.sent, 0, 'nothing sent twice');
  // The office resets her password: the session is revoked; what she sealed waits.
  const led = WORLD.drive.json(ledger.id);
  led.accounts.find(a => a.id === T1.acct.id).password = require('./gate-fixture.js').pbkdf2('new-pw-1', 'beefbeef', 1000);
  WORLD.drive.replace(ledger.id, led);
  WORLD.advance(2 * MIN);
  WORLD.cache.clear();
  await Gate.queue('rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-CLIENT-2', subject: 'After the reset', message: 'Still here?', timestamp: WORLD.clock.now } }, { noKick: true });
  res = await Gate.deliver({ force: true });
  let ob = await Gate.outbox();
  assert(res.reseal === 1 && ob.length === 1 && ob[0].state === 'revoked', 'after a password reset: revoked, and kept (' + JSON.stringify(res) + ')');
  eq((await Gate.pull()).error, 'revoked', 'and the old session reads nothing more');
  const s1b = await Gate.signIn({ login: T1.acct.username, password: 'new-pw-1' });
  assert(s1b.ok && s1b.sid !== s1.sid, 'she signs in again with the new password');
  assert(await Gate.enter(s1b), 'the same trainee: her namespace is kept');
  ob = await Gate.outbox();
  assert(ob.length === 1 && ob[0].state === 'wait' && ob[0].item.sid === s1b.sid && G.sealOk(ob[0].item, s1b.sessionKey, crypto), 'what waited is sealed again under the new session');
  res = await Gate.deliver({ force: true });
  assert(res.done === 1 && (await Gate.outbox()).length === 0, 'and taken (' + JSON.stringify(res) + ')');
  // A test: an attempt saved, then submitted — the gate marks it and answers with the result.
  const p = await Gate.paper('EX2');
  assert(p.ok && p.paper && !/correctAnswer/.test(JSON.stringify(p.paper)), 'the paper of her open exam, without answers');
  const qs = Core.exams.attemptQuestionsFromPaper(p.paper.questions, { shuffleQuestions: true, shuffleOptions: true });
  const RIGHT = { mcq: 0, tf: false, multi: [0, 2], match: ['Grinder', 'Torch'], shortanswer: 'Flashback Arrestor', numerical: '108', fill: 'butt', essay: 'I keep it tidy.' };
  // The attempt's activity, for the invigilator: when it started, the page
  // and questions reached, the test window left and come back to — and, as a
  // tampered copy might carry, an answer and a moment of no known kind.
  const T0 = WORLD.clock.now - 10 * MIN;
  const activity = Core.exams.activityMark(Core.exams.activityMark(Core.exams.activityNote(
    { v: 1, lay: Core.exams.activityLayout(qs, 3), answers: ['Flashback Arrestor'] },
    { id: 'PH01.1.a', k: 'start', t: T0, d: 'Phone · PH01' }), 'pages', 0, T0 + 1000), 'first', 1, T0 + 60000);
  activity.ev.push({ id: 'PH01.2.b', k: 'left', t: T0 + 120000, why: 'hidden' }, { id: 'PH01.3.c', k: 'back', t: T0 + 150000, of: 'PH01.2.b', ms: 30000 },
    { id: 'PH01.4.d', k: 'answer', t: T0 + 160000, text: 'Flashback Arrestor' });
  const att = { id: 'ATT-CLIENT-1', examId: 'EX2', studentId: T1.stu.id, studentName: T1.stu.name, questions: qs, answers: qs.map(q => (q.type === 'info' ? null : J(RIGHT[q.type]))),
    flagged: qs.map(() => false), answeredAt: qs.map(() => WORLD.clock.now), flaggedAt: qs.map(() => 0), startTime: T0, deadline: WORLD.clock.now + 60 * MIN, status: 'open', activity };
  await Gate.queue('rec', { key: 'voctrain_examAttempts', rec: att }, { noKick: true });
  await Gate.queue('rec', { key: 'voctrain_examAttempts', rec: Object.assign({}, att, { updatedAt: iso(WORLD.clock.now + 1000) }) }, { noKick: true });
  eq((await Gate.outbox()).length, 1, 'two saves of the attempt: one waits');
  let got = null;
  Gate.configure({ onResult: r => { got = r; } });
  // Submitted: the moment it was, by the trainee, in the attempt sent.
  const subAtt = J(att);
  subAtt.activity = Core.exams.activityNote(subAtt.activity, { id: 'PH01.5.e', k: 'submit', t: WORLD.clock.now, how: 'trainee' });
  await Gate.queue('submit', { attempt: subAtt }, { noKick: true, noCoalesce: true });
  res = await Gate.deliver({ force: true });
  assert(res.done === 2 && got && /^RES-G-/.test(got.id) && got.attemptId === att.id && !/correctAnswer"\s*:\s*[^n]/.test(JSON.stringify(got)), 'the submit is marked by the gate and its result handed to the page (' + (got && got.score) + '%)');
  // The activity, end to end: kept in her lane and in the result file's
  // retired record, as the clean copy (no answer, no unknown moment), and
  // read back from both by the staff PC's collector.
  const lanes = WORLD.drive.children(folder.id, 'file').filter(f => f.name.indexOf('CESTISINBOX.L-') === 0);
  const laneOf = lanes.find(f => (WORLD.drive.json(f.id).records.voctrain_examAttempts || []).some(a => a.id === att.id));
  const laneJ = laneOf && WORLD.drive.json(laneOf.id);
  const laneAtt = laneJ && (laneJ.records.voctrain_examAttempts || []).find(a => a.id === att.id);
  const kinds = a => ((a && a.activity && a.activity.ev) || []).map(e => e.k).join(',');
  assert(laneAtt && kinds(laneAtt) === 'start,left,back' && laneAtt.activity.lay && laneAtt.activity.lay.per === 3 && laneAtt.activity.pages[0] === T0 + 1000 && laneAtt.activity.first[1] === T0 + 60000,
    'the attempt in her lane keeps its activity: started, left the window, came back, page and question times (' + kinds(laneAtt) + ')');
  assert(!/Flashback Arrestor/i.test(JSON.stringify(laneAtt.activity)) && !('answers' in laneAtt.activity), '   and nothing else: no answer rides in it');
  const resFile = WORLD.drive.children(folder.id, 'file').find(f => f.name === 'CESTISINBOX.result.' + att.id + '.json');
  const resJ = resFile && WORLD.drive.json(resFile.id);
  assert(resJ && resJ.retired && kinds(resJ.retired) === 'start,left,back,submit' && !/Flashback Arrestor/i.test(JSON.stringify(resJ.retired)),
    'the result file\'s retired attempt carries the whole activity, the submission too (' + kinds(resJ && resJ.retired) + ')');
  const coll = G.collect([{ fileId: laneOf.id, version: 1, json: laneJ, folderAcct: T1.acct.id }, { fileId: resFile.id, version: 1, json: resJ, folderAcct: T1.acct.id }],
    { accounts: C.store.voctrain_users, students: C.store.voctrain_students });
  const collected = Core.exams.mergeAttemptLists([], (coll.payload && coll.payload.data && coll.payload.data.examAttempts) || []).list.filter(a => a.id === att.id);
  assert(collected.length === 1 && Core.exams.attemptIsRetired(collected[0]) && kinds(collected[0]) === 'start,left,back,submit' && !/Flashback Arrestor/i.test(JSON.stringify(collected[0].activity)),
    'the staff PC\'s collector takes it in: one submitted attempt, its activity whole (' + kinds(collected[0]) + ')');
  DOWN = true;
  await Gate.queue('rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-CLIENT-3', subject: 'Offline', message: 'kept', timestamp: WORLD.clock.now } }, { noKick: true });
  res = await Gate.deliver({ force: true });
  ob = await Gate.outbox();
  assert(ob.length === 1 && ob[0].state === 'wait' && ob[0].tries === 1 && ob[0].nextAt > Date.now(), 'no connection: kept, tried again later (backoff)');
  DOWN = false;
  res = await Gate.deliver({ force: true });
  assert(res.done === 1 && (await Gate.outbox()).length === 0, 'back: delivered');
  // Sign-out: the namespace goes once nothing of hers waits.
  await Gate.leave({ keepData: false });
  assert(!LS.getItem('cestisGateNs') && !Array.from(LS._m.keys()).some(k => /^g1::(?!cestisGateDrop$)/.test(k)) && LS.getItem('g1::cestisGateDrop') === '1', 'signed out: the control key and her records go (and the database is noted to be removed)');

  /* ============== home study (gate version 3): her files, her fees, her password */
  console.log('Home study: her files kept until the gate has them all (in parts, resumed by itself); her fees; her password changed');
  {
    const s1c = await Gate.signIn({ login: T1.acct.username, password: 'new-pw-1' });
    assert(s1c.ok && await Gate.enter(s1c), 'signed in again, into her namespace');
    await Gate.applyPull(await Gate.pull());
    const events = [];
    Gate.onUpload(ev => events.push(ev.type));
    // A phone photo already made small (about 0.9 MB: three parts) and a short note.
    const big = nodeCrypto.randomBytes(900 * 1024).toString('base64'), small = Buffer.from('My notes on the butt joint.').toString('base64');
    eq(P.partsOf(big).length, 3, 'a 0.9 MB file goes in three parts of 384 KB');
    eq(P.b64Size(big), 900 * 1024, 'its size, read from the text');
    const rec = { id: 'SUB-HOME-1', assignmentId: 'ASG-2', studentId: T1.stu.id, studentName: T1.stu.name, course: T1.stu.course, files: [], driveFiles: [], comment: 'From home', submittedAt: iso(WORLD.clock.now), attempt: 1 };
    PART_BUDGET = 1;          // the signal drops after the first part
    const view = await Gate.uploadQueue({ refId: rec.id, purpose: 'submission', files: [{ name: 'butt-joint.jpg', type: 'image/jpeg', base64: big }, { name: 'notes.txt', type: 'text/plain', base64: small }], then: { key: 'voctrain_submissions', rec } });
    assert(view && view.state === 'wait' && view.parts === 4 && !/"data"|base64/.test(JSON.stringify(view)), 'kept on the device (the page is shown sizes and names, never the bytes)');
    await Gate.uploadPump({ force: true });
    let up = (await Gate.uploads(T1.acct.id))[0];
    assert(up && up.state === 'wait' && up.partsSent === 1 && up.tries === 1 && events.indexOf('waiting') !== -1, 'the signal drops: one part in, the rest kept, tried again later (' + JSON.stringify(up && { s: up.state, p: up.partsSent, t: up.tries }) + ')');
    assert(!(JSON.parse(NSStore.getItem('voctrain_submissions') || '[]')).some(r => r.id === rec.id), 'her submission is not saved until every file is in');
    eq((await Gate.uploads('USR-SOMEONE-ELSE')).length, 0, 'another trainee signed in here sees nothing of it');
    PART_BUDGET = Infinity;   // back
    await Gate.uploadPump({ force: true });
    eq((await Gate.uploads(T1.acct.id)).length, 0, 'the signal is back: the rest goes by itself, and the device lets the files go');
    const saved = (JSON.parse(NSStore.getItem('voctrain_submissions') || '[]')).find(r => r.id === rec.id);
    assert(saved && saved.driveFiles.length === 2 && saved.files.length === 0 && saved.comment === 'From home', 'her submission is saved naming both files (and carrying no bytes)');
    eq(events.filter(t => t === 'filed' || t === 'done'), ['filed', 'done'], 'the page is told: filed (at once, to take it into what it shows), then done');
    const folder1 = WORLD.drive.children(cfg.traineesId, 'folder').find(f => /acct=USR-T02(\s|$)/.test(f.description));
    const filesDir = WORLD.drive.children(folder1.id, 'folder').find(f => f.name === 'files');
    const made = filesDir && WORLD.drive.children(filesDir.id, 'file').find(f => f.id === saved.driveFiles[0].driveFileId);
    assert(made && made.content.equals(Buffer.from(big, 'base64')), 'the photo is in her own folder, byte for byte as it was sent');
    const partsDir = filesDir && WORLD.drive.children(filesDir.id, 'folder').find(f => f.name === '.parts');
    assert(partsDir && WORLD.drive.children(partsDir.id, 'file').every(x => x.trashed), 'its parts are let go once it is whole');
    res = await Gate.deliver({ force: true });
    const lanes1 = WORLD.drive.children(folder1.id, 'file').filter(f => f.name.indexOf('CESTISINBOX.L-') === 0);
    assert(res.done === 1 && lanes1.some(f => ((WORLD.drive.json(f.id).records || {}).voctrain_submissions || []).some(r => r.id === rec.id && r.driveFiles.length === 2)),
      'and reaches her lane like any change of hers, for the office (the gate checks the files are her own: ' + JSON.stringify(res) + ')');
    // A file the gate turns away for good (its kind) is kept, marked, until she lets it go.
    await Gate.uploadQueue({ refId: 'SUB-HOME-2', purpose: 'submission', files: [{ name: 'virus.exe', type: 'application/octet-stream', base64: small }], then: { key: 'voctrain_submissions', rec: Object.assign({}, rec, { id: 'SUB-HOME-2' }) } });
    await Gate.uploadPump({ force: true });
    up = (await Gate.uploads(T1.acct.id))[0];
    assert(up && up.state === 'refused' && up.reason === 'type-not-allowed', 'a kind of file the gate does not take: kept and marked, never dropped by itself');
    assert(await Gate.uploadDrop(up.id) && (await Gate.uploads(T1.acct.id)).length === 0, 'she lets it go');

    // Her fees: none published yet, then hers.
    let f = await Gate.fees();
    assert(f.ok && f.none && Gate.storedFees().none, 'no fees file yet: said so, and kept');
    const feeStore = { cestiSchoolFeeStudents: [{ id: T1.stu.id, lmsId: T1.stu.id, name: T1.stu.name, skillArea: T1.stu.course, tuitionFee: 60000, updatedAt: iso(NOW - DAY) }],
      cestiSchoolFeePayments: [{ id: 'PAY-1', studentId: T1.stu.id, amount: 20000, date: '2026-09-04', method: 'Cash', receiptNumber: 'R-0101', notes: 'private note', createdAt: iso(NOW - 5 * DAY) }] };
    const built = G.home.buildFees(feeStore, [{ acct: T1.acct.id, stu: T1.stu.id, student: T1.stu }], WORLD.clock.now).byAcct[T1.acct.id];
    WORLD.drive.put(folder1.id, G.home.FEES_FILE, built.file);
    WORLD.cache.clear();
    f = await Gate.fees();
    assert(f.ok && f.fees && f.fees.balance === 40000 && !/private note/.test(JSON.stringify(f)) && Gate.storedFees().fees.paid === 20000, 'her fees: balance and receipts (never the office\'s notes), kept on the device');
    f = await Gate.fees();
    assert(f.ok && f.same, 'asked again: "the same" (nothing sent twice)');

    // Her password, changed at home.
    eq((await Gate.changePassword({ oldPassword: 'not-it', newPassword: 'Welder2026' })).error, 'no-match', 'a wrong current password: no-match');
    const before = Gate.session();
    await Gate.queue('rec', { key: 'voctrain_support_messages', rec: { id: 'SUP-HOME-PW', subject: 'Before the change', message: 'kept', timestamp: WORLD.clock.now } }, { noKick: true });
    const ch = await Gate.changePassword({ oldPassword: 'new-pw-1', newPassword: 'Welder2026' });
    const after = Gate.session();
    assert(ch.ok && ch.token && after.token === ch.token && after.sid !== before.sid && after.token !== before.token, 'changed: this device takes its new session at once');
    const waitingNow = await Gate.outbox();
    assert(waitingNow.length === 1 && waitingNow[0].state === 'wait' && waitingNow[0].item.sid === after.sid, 'what waited is sealed again under the new session');
    res = await Gate.deliver({ force: true });
    assert(res.done === 1, 'and taken (' + JSON.stringify(res) + ')');
    eq((await Gate.signIn({ login: T1.acct.username, password: 'new-pw-1' })).error, 'no-match', 'the old password no longer signs her in');
    assert((await Gate.signIn({ login: T1.acct.username, password: 'Welder2026' })).ok, 'the new one does, at once (before the office has it)');
    eq((await Gate.certTemplate('Welding', 'bgPage1')).error, 'not-yours', 'no certificate issued: no certificate background');
    await Gate.leave({ keepData: false });
  }

  /* ============================== the page, in a gate session */
  console.log('In a gate session the page cloud does nothing, and no built-in login is seeded');
  {
    const vm = require('vm');
    let asked = 0;
    const sb = { CESTISCore: Core, CESTISStore: NSStore, console: { log() {}, warn() {}, error() {} },
      location: { protocol: 'http:', hostname: '192.168.1.5', origin: 'http://192.168.1.5:8080' },
      fetch: () => { asked++; return Promise.resolve({ ok: true, json: async () => ({ ok: true, mode: 'offline-lan' }) }); },
      setInterval: () => 0, setTimeout: () => 0, addEventListener() {} };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'cestis-page-cloud.js'), 'utf8'), sb);
    const PC = sb.CESTISPageCloud;
    eq(PC.init({ page: 'Requests', file: 'CESTIS_Transcript_Requests.json', keys: ['voctrain_certTranscriptRequests'] }), null, 'init registers nothing');
    eq(await PC.lan(), false, 'lan() answers false');
    eq(await PC.initLan({ page: 'LMS', file: 'CESTIS_LMS_Dashboard.json', prefixes: ['voctrain_'] }), null, 'initLan registers nothing');
    eq(PC.initWholeStore(), null, 'nor the whole-store mirror');
    eq(asked, 0, 'and nothing is asked of the Centre\'s server (no token fetched)');

    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const fn = name => {
      const start = src.indexOf('function ' + name + '(');
      let i = src.indexOf('{', start), d = 0;
      for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(start, i + 1); } }
      throw new Error(name);
    };
    const load = (ns, stored, hash, addr) => {
      const box = { CESTISCore: Core, console: { log() {}, warn() {}, error() {} }, userAccounts: [],
        CESTISStore: { namespace: ns, getItem: k => (k === 'voctrain_users' && stored ? JSON.stringify(stored) : null), setItem() {}, removeItem() {} },
        localStorage: { getItem: k => (k === 'cestisGateAddress' ? addr || null : null) }, location: { hash: hash || '' } };
      box.window = box;
      vm.createContext(box);
      vm.runInContext([fn('cestisGateSession'), fn('cestisTraineeOnlyDevice'), fn('loadUserAccounts')].join('\n') + '\nloadUserAccounts();', box);
      return box.userAccounts;
    };
    eq(load('g1', [{ id: 'USR-T02', role: 'student', name: 'Kadian Morgan' }]).map(a => a.id), ['USR-T02'], 'the namespace holds the trainee\'s own card, and no built-in login');
    eq(load('g1', null).length, 0, 'an empty namespace gets none either');
    eq(load('', null, '#gate=abc').length, 0, 'a phone opened from the trainees\' link is not seeded with the built-in logins');
    eq(load('', null, '', GATE_URL).length, 0, '(nor once the link\'s address is kept)');
    eq(load('', null).map(a => a.id).sort(), ['USR-001', 'USR-011', 'USR-021'], 'a brand-new device is seeded as before');

    // "Awaiting Approval" through the gate: the gate says only "pending", so
    // the programme and registration date are not there to show — the line is
    // left out, never "Programme: — • Registered: " with nothing in it.
    const pendingHtml = user => {
      let html = '';
      const box = { CESTISCore: Core, document: { getElementById: () => null, body: { insertAdjacentHTML: (w, h) => { html = h; } } } };
      vm.createContext(box);
      vm.runInContext([fn('escapeHtml'), fn('escapeAttr'), fn('showPendingApprovalScreen')].join('\n'), box);
      box.showPendingApprovalScreen(user, { state: 'waiting' });
      return html;
    };
    const viaGate = pendingHtml({ email: 'pendleton.waitingly', role: 'student', programme: '', createdAt: '' });
    assert(/Awaiting Approval|awaiting approval/i.test(viaGate) && /pendleton\.waitingly/.test(viaGate) && !/Registered: </.test(viaGate) && !/Programme:/.test(viaGate),
      'the pending screen through the gate leaves out the empty programme / registered line');
    assert(/Programme: Plumbing &bull; Registered: 2026-10-01/.test(pendingHtml({ email: 'p@x.test', role: 'student', programme: 'Plumbing', createdAt: '2026-10-01' })),
      'and shows it as before when the device knows them');

    // The Exam Invigilator board on a staff PC, with trainees at home sitting
    // their tests through the gate: collected every INVIG_GATE_MS while it is
    // open (at once on "Check now"), and "last checked" is the last time it
    // actually was — never "just now" when nothing was collected.
    console.log('The invigilator board collects what trainees sent, and says honestly when it last did');
    const board = (on, collectAt) => {
      const box = { console: { log() {}, warn() {} }, Date, Promise, setTimeout, INVIG_GATE_MS: 20000, window: {},
        _gateRun: { collectAt: collectAt, collecting: false }, ticks: 0, renders: 0,
        invigState: { lastCheck: 0, lastCheckDone: 0, checking: false } };
      box.gateStaffOn = () => on;
      box.gateCollectTick = () => { box.ticks++; box._gateRun.collectAt = Date.now(); return Promise.resolve({}); };
      box.invigFillExams = () => {}; box.invigRender = () => { box.renders++; };
      vm.createContext(box);
      vm.runInContext([fn('gateCollectForBoard'), fn('invigCheckNow')].join('\n'), box);
      return box;
    };
    let b = board(true, Date.now() - 5000);
    b.invigCheckNow(false);
    await new Promise(r => setTimeout(r, 20));
    eq([b.ticks, b.invigState.lastCheckDone], [0, 0], 'collected 5 s ago: not again yet, and "last checked" is not moved to now');
    b.invigCheckNow(true);
    await new Promise(r => setTimeout(r, 20));
    assert(b.ticks === 1 && b.invigState.lastCheckDone > 0 && b.renders >= 1, '"Check now": collected at once, then "last checked" and the board follow');
    b = board(true, Date.now() - 25000);
    b.invigCheckNow(false);
    await new Promise(r => setTimeout(r, 20));
    eq(b.ticks, 1, 'every 20 seconds by itself while the board is open');
    b = board(false, 0);
    b.invigCheckNow(true);
    await new Promise(r => setTimeout(r, 20));
    assert(b.ticks === 0 && b.invigState.lastCheckDone > 0, 'with the gate off: nothing collected, the board as before');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
