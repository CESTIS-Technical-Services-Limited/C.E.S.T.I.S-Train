/* A PC whose records have outgrown localStorage keeps its chat history and its
   School Fee roll through a reload and a sign-in — in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/chat-history-reload.js

   The reproduction of EF-7 (the efficiency audit, 2026-10-28): localStorage
   holds about 5 MB for the whole site and is full within the Centre's first
   month, after which a large collection lives in IndexedDB only. The
   dashboard read the chat at start-up, before IndexedDB had been read in;
   the chat read as absent, the membership pass saved the empty start value,
   and "{}" replaced the stored history. After the reload and the sign-in the
   PC held 0 messages. The same start-up flaw wrote the fee roll as blank
   placeholders over the stored one.

   Here, on the administrator's office PC (gate-kit), with localStorage filled
   so that the chat (60 rooms, ~600 KB) and the fee roll (300 trainees) go to
   IndexedDB only:
     1. after the reload and the sign-in every message is in memory and in the
        store, and the fee roll is the Centre's, not placeholders;
     2. the chat page opened and a message sent: the history is still whole
        and the new message is saved beside it;
     3. a second reload: still whole.
   The outside world is cut off. No page errors. */
'use strict';
const path = require('path');
const { chromium } = require('playwright-core');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }

const ROOMS = 60, PER_ROOM = 40, FEE = 300;

// What the PC holds: localStorage filled to the brim, then the chat and the
// fee roll written through the store (too big for what is left: IndexedDB only).
async function seed(arg) {
  const { ROOMS, PER_ROOM, FEE } = arg;
  // Fill localStorage, leaving ~40 KB, with keys that are not the Centre's.
  try { for (let i = 0; i < 400; i++) localStorage.setItem('__fill' + i, 'x'.repeat(256 * 1024)); } catch (e) {}
  try { for (let i = 0; i < 400; i++) localStorage.setItem('__fillb' + i, 'x'.repeat(16 * 1024)); } catch (e) {}
  try { for (let i = 0; i < 3; i++) localStorage.removeItem('__fillb' + i); } catch (e) {}
  const msgs = {}, rooms = [{ id: 'chat-admin', name: 'Admin General', icon: 'A', type: 'admin', members: [], color: '#f0a500', createdBy: 'admin' }];
  for (let r = 0; r < ROOMS; r++) {
    const rid = r === 0 ? 'chat-admin' : 'dm-' + r;
    if (r) rooms.push({ id: rid, name: 'Talk ' + r, type: 'dm', members: ['USR-mthompson', 'USR-trichards'], createdBy: 'USR-mthompson' });
    msgs[rid] = Array.from({ length: PER_ROOM }, (_, i) => ({ id: 'M' + r + '-' + i, senderId: i % 2 ? 'USR-mthompson' : 'USR-trichards', senderName: i % 2 ? 'Marcia Thompson' : 'Tameka Richards',
      text: 'Message ' + i + ' in room ' + r + ' — please bring the workshop record book and your safety goggles on Monday.', timestamp: new Date(Date.UTC(2026, 8, 1) + (r * PER_ROOM + i) * 60000).toISOString() }));
  }
  CESTISStore.setItem('voctrain_chatRooms', JSON.stringify(rooms));
  CESTISStore.setItem('voctrain_chatMessages', JSON.stringify(msgs));
  const fee = Array.from({ length: FEE }, (_, i) => ({ id: 'SF-' + i, name: 'Fee Trainee ' + i, skillArea: 'Welding & Fabrication', tuitionFee: 85000, totalPaid: 40000 + i,
    balance: 45000 - i, contact: '876-555-' + String(1000 + i), email: 'fee' + i + '@example.com', address: i + ' Hope Road, Kingston', status: 'Partial', enrollmentDate: '2026-09-01' }));
  CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify(fee));
  // From the next load on, reading IndexedDB in takes 2 s, as a year's
  // records do on an office PC (see the init script below).
  sessionStorage.setItem('__slowIdb', '2000');
  await new Promise(r => { const q = indexedDB.open('CESTIS_KV'); q.onsuccess = e => { const tx = e.target.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put('1', '__probe'); tx.oncomplete = r; tx.onerror = r; }; q.onerror = r; });
  return { chatIdbOnly: localStorage.getItem('__cestis_idb_only__:voctrain_chatMessages') !== null, feeIdbOnly: localStorage.getItem('__cestis_idb_only__:cestiSchoolFeeStudents') !== null };
}

async function probe(page) {
  return page.evaluate(async () => {
    const idb = k => new Promise(r => { const q = indexedDB.open('CESTIS_KV'); q.onsuccess = e => { const g = e.target.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => r(g.result == null ? null : g.result); g.onerror = () => r(null); }; q.onerror = () => r(null); });
    const count = s => { try { const o = JSON.parse(s); return Object.values(o).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0); } catch (e) { return null; } };
    let mem = null; try { mem = Object.values(lmsChatMessages).reduce((a, x) => a + (Array.isArray(x) ? x.length : 0), 0); } catch (e) {}
    const chatIdb = await idb('voctrain_chatMessages'), feeIdb = await idb('cestiSchoolFeeStudents');
    let fee = []; try { fee = JSON.parse(CESTISStore.getItem('cestiSchoolFeeStudents') || '[]'); } catch (e) {}
    let feeDurable = []; try { feeDurable = JSON.parse(feeIdb || '[]'); } catch (e) {}
    return { memMsgs: mem, storeMsgs: count(CESTISStore.getItem('voctrain_chatMessages')), idbMsgs: count(chatIdb),
      fee: fee.length, feeReal: fee.filter(s => s && s.tuitionFee === 85000).length, feeDurableReal: feeDurable.filter(s => s && s.tuitionFee === 85000).length,
      placeholders: fee.filter(s => s && s.needsFeeDetails).length };
  });
}

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const K = kit.make({ browser, base: srv.base, errors });
  try {
    const ctx = await K.computer({ drive: null });
    // A big store takes seconds to read in on a real office PC; here the
    // database answers its open late by the time the seed asks for.
    await ctx.addInitScript(() => {
      const delay = Number(sessionStorage.getItem('__slowIdb') || 0);
      if (!delay) return;
      const open = indexedDB.open.bind(indexedDB);
      const setOk = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess').set;
      indexedDB.open = function (name) {
        const req = open.apply(null, arguments);
        if (name !== 'CESTIS_KV') return req;
        let fn = null;
        Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => fn,
          set: f => { fn = f; setOk.call(req, function (e) { setTimeout(() => f.call(req, e), delay); }); } });
        return req;
      };
    });
    const page = await K.adminSignedIn(ctx, { mutate: seed, mutateArg: { ROOMS, PER_ROOM, FEE } });
    console.log('1. After a reload and the sign-in (the chat and the fee roll in IndexedDB only)');
    const idbOnly = await page.evaluate(() => ({ chat: localStorage.getItem('__cestis_idb_only__:voctrain_chatMessages') !== null, fee: localStorage.getItem('__cestis_idb_only__:cestiSchoolFeeStudents') !== null }));
    ok(idbOnly.chat && idbOnly.fee, 'the chat and the fee roll live in IndexedDB only on this PC (as on a Centre PC after month 1)');
    const want = ROOMS * PER_ROOM;
    await page.waitForTimeout(2500);
    let p = await probe(page);
    console.log('     ' + JSON.stringify(p));
    ok(p.memMsgs === want, 'every message is in memory (' + p.memMsgs + ' of ' + want + ')');
    ok(p.storeMsgs === want && p.idbMsgs === want, 'and in the store (' + p.storeMsgs + ', durable ' + p.idbMsgs + ')');
    ok(p.feeReal === FEE && p.feeDurableReal === FEE, 'the fee roll is the Centre\'s: ' + p.feeReal + ' of ' + FEE + ' real records (durable ' + p.feeDurableReal + ')');

    console.log('2. The chat page, and a message sent');
    await page.evaluate(() => { try { showPage('lms-chat'); } catch (e) {} });
    await page.waitForTimeout(1500);
    const sent = await page.evaluate(() => {
      const rid = 'dm-7';
      lmsChatMessages[rid] = lmsChatMessages[rid] || [];
      lmsChatMessages[rid].push({ id: 'NEW-1', senderId: 'USR-mthompson', senderName: 'Marcia Thompson', text: 'See you at nine.', timestamp: new Date().toISOString() });
      saveLmsChatData();
      const st = JSON.parse(CESTISStore.getItem('voctrain_chatMessages'));
      return { has: !!(st[rid] || []).find(m => m.id === 'NEW-1'), room: (st[rid] || []).length };
    });
    p = await probe(page);
    ok(sent.has && sent.room === PER_ROOM + 1, 'the new message is saved beside the room\'s history (' + sent.room + ')');
    ok(p.storeMsgs === want + 1 && p.memMsgs === want + 1, 'nothing else lost (' + p.storeMsgs + ')');

    console.log('3. Another reload');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);
    p = await probe(page);
    console.log('     ' + JSON.stringify(p));
    ok(p.storeMsgs === want + 1 && p.idbMsgs === want + 1, 'the stored history is still whole (' + p.storeMsgs + ')');
    ok(p.memMsgs === want + 1, 'and the page reads it all (' + p.memMsgs + ')');
    // (The six trainees gate-kit puts on the roll are not on this fee roll:
    // they, and only they, get a placeholder to complete.)
    ok(p.feeReal === FEE && p.feeDurableReal === FEE && p.placeholders === kit.TRAINEES.length,
      'the fee roll is still the Centre\'s (' + p.feeReal + ' real; placeholders only for the ' + p.placeholders + ' trainees it lacked)');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
