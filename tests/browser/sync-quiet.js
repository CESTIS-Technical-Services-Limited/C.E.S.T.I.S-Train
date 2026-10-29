/* An untouched dashboard goes quiet; an edit made at any moment still goes up
   — in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/sync-quiet.js

   What went wrong (EF-1 in the efficiency audit, OF-6 in the office audit):
   the 5-second save took its "nothing written since" mark, and then its own
   bookkeeping (removing the "pending upload" note saveState() had just set)
   moved the store's write counter. Every tick therefore found a change,
   rewrote every collection, scheduled another save and uploaded the whole
   chat file: an idle office PC ran saveState 27 times a minute, uploaded the
   chat file every 2.6 s and made 94 requests a minute — about 2.9 GB a day.

   The administrator's office PC (gate-kit), the Centre's shared files an
   in-memory stand-in (tests/browser/fake-drive.js):
     1. once settled, a minute untouched: no upload at all, no full save;
     2. an edit while an upload of the Main backup is still in flight (the
        stand-in holds that upload for 4 s): the edit is in the Main backup
        once the uploads finish (the earlier bug: absorbing the write count
        at the end of the upload swallowed it), and then it goes quiet again;
     3. the chat: a message goes up in the chat file; untouched, the chat
        file is not uploaded again; a message sent while a chat upload is in
        flight goes up too.
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  // Every Drive request, and a switch that holds uploads of one file.
  const log = []; let holdName = null, holdMs = 0; const inFlight = {};
  const handle = drive.handle.bind(drive);
  drive.handle = async route => {
    const req = route.request(), url = new URL(req.url());
    const m = /\/files\/([^/?]+)/.exec(url.pathname), f = m && drive.files[m[1]];
    const upload = /\/upload\//.test(url.pathname);
    const entry = { t: Date.now(), method: req.method(), upload, name: f ? f.name : '', parent: f ? f.parents[0] : '' };
    log.push(entry);
    if (upload && f && holdName && f.name === holdName && f.parents[0] === (holdName === 'CESTIS_LMS_BACKUP.json' ? kit.MAIN_FOLDER : f.parents[0])) {
      inFlight[holdName] = (inFlight[holdName] || 0) + 1;
      await wait(holdMs);
      inFlight[holdName]--;
    }
    return handle(route);
  };
  const K = kit.make({ browser, base: srv.base, errors });
  const uploads = (since, name) => log.filter(e => e.t >= since && e.upload && (!name || e.name === name));
  const mainBackup = () => {
    const f = Object.values(drive.files).find(x => x.name === 'CESTIS_LMS_BACKUP.json' && x.parents[0] === kit.MAIN_FOLDER);
    try { return JSON.parse(f.content).data; } catch (e) { return null; }
  };
  const chatFile = () => {
    const f = Object.values(drive.files).find(x => x.name === 'CESTIS_LMS_CHAT.json');
    try { return JSON.parse(f.content); } catch (e) { return null; }
  };
  async function settle(page, label) {
    // Until two ticks in a row find nothing to send (at most 90 s).
    const t0 = Date.now(); let quiet = 0;
    while (Date.now() - t0 < 90000) {
      await wait(5200);
      const r = await page.evaluate(() => _lastAutoSaveResult && _lastAutoSaveResult.reason);
      quiet = (r === 'nothing-new' || r === 'unchanged') && uploads(Date.now() - 5200).length === 0 ? quiet + 1 : 0;
      if (quiet >= 2) return true;
    }
    console.log('     (' + label + ': did not settle)');
    return false;
  }
  try {
    const ctx = await K.computer({ drive });
    const page = await K.adminSignedIn(ctx, {});
    await page.evaluate(() => {
      window.__n = { ss: 0 };
      const ss = saveState; saveState = function () { window.__n.ss++; return ss.apply(this, arguments); };
    });

    console.log('1. Untouched for a minute, once settled');
    ok(await settle(page, 'start'), 'the first saves settle');
    const ss0 = await page.evaluate(() => window.__n.ss);
    const t1 = Date.now();
    await wait(60000);
    const idleUp = uploads(t1), idleReq = log.filter(e => e.t >= t1);
    const ss1 = await page.evaluate(() => window.__n.ss);
    ok(idleUp.length === 0, 'no upload in a minute (' + idleUp.length + '; ' + idleReq.length + ' small checks)');
    ok(ss1 - ss0 === 0, 'no full save in a minute (' + (ss1 - ss0) + ')');
    ok(idleReq.length <= 20, 'at most 20 Drive requests a minute, each a small check (' + idleReq.length + ')');

    console.log('2. An edit made while the Main backup upload is in flight');
    holdName = 'CESTIS_LMS_BACKUP.json'; holdMs = 4000;
    await page.evaluate(() => { calendarEvents.push({ id: 'EV-QUIET-A', title: 'Edit A', date: '2026-11-02', updatedAt: new Date().toISOString() }); saveState(); });
    const tA = Date.now();
    while (!inFlight[holdName] && Date.now() - tA < 20000) await wait(100);
    ok(!!inFlight[holdName], 'the upload carrying edit A is in flight');
    await page.evaluate(() => { calendarEvents.push({ id: 'EV-QUIET-B', title: 'Edit B', date: '2026-11-03', updatedAt: new Date().toISOString() }); saveState(); });
    const stillInFlight = !!inFlight[holdName];
    ok(stillInFlight, 'edit B was made during that upload');
    holdName = null;
    await settle(page, 'after edits');
    const data = mainBackup() || {};
    const ids = (data.calendarEvents || []).map(e => e.id);
    ok(ids.indexOf('EV-QUIET-A') !== -1, 'edit A is in the Main backup');
    ok(ids.indexOf('EV-QUIET-B') !== -1, 'edit B, made during the upload, is in the Main backup too');
    const t2 = Date.now();
    await wait(30000);
    ok(uploads(t2).length === 0, 'and then it is quiet again (' + uploads(t2).length + ' uploads in 30 s)');

    console.log('3. The chat file');
    await page.evaluate(() => {
      const rid = 'chat-admin';
      lmsChatMessages[rid] = lmsChatMessages[rid] || [];
      lmsChatMessages[rid].push({ id: 'QUIET-1', senderId: 'USR-mthompson', senderName: 'Marcia Thompson', text: 'Staff meeting at three.', timestamp: new Date().toISOString() });
      saveLmsChatData(); lmsChatFlushDriveSyncNow();
    });
    await settle(page, 'after a message');
    const chat1 = chatFile();
    ok(!!(chat1 && chat1.chatMessages && (chat1.chatMessages['chat-admin'] || []).some(m => m.id === 'QUIET-1')), 'a message goes up in the chat file');
    const t3 = Date.now();
    await page.evaluate(() => { for (let i = 0; i < 3; i++) lmsChatSyncToDrive(); });   // pushes asked for with nothing new
    await wait(20000);
    ok(uploads(t3, 'CESTIS_LMS_CHAT.json').length === 0, 'untouched, the chat file is not uploaded again (' + uploads(t3, 'CESTIS_LMS_CHAT.json').length + ')');
    holdName = 'CESTIS_LMS_CHAT.json'; holdMs = 3000;
    await page.evaluate(() => {
      lmsChatMessages['chat-admin'].push({ id: 'QUIET-2', senderId: 'USR-mthompson', senderName: 'Marcia Thompson', text: 'Bring the register.', timestamp: new Date().toISOString() });
      saveLmsChatData(); lmsChatFlushDriveSyncNow();
    });
    const tC = Date.now();
    while (!inFlight[holdName] && Date.now() - tC < 15000) await wait(100);
    ok(!!inFlight[holdName], 'a chat upload is in flight');
    await page.evaluate(() => {
      lmsChatMessages['chat-admin'].push({ id: 'QUIET-3', senderId: 'USR-mthompson', senderName: 'Marcia Thompson', text: 'And the keys.', timestamp: new Date().toISOString() });
      saveLmsChatData(); lmsChatFlushDriveSyncNow();
    });
    holdName = null;
    await wait(9000);
    const chat2 = chatFile();
    const got = ((chat2 && chat2.chatMessages && chat2.chatMessages['chat-admin']) || []).map(m => m.id);
    ok(got.indexOf('QUIET-2') !== -1 && got.indexOf('QUIET-3') !== -1, 'the message sent during that upload went up too (' + got.filter(x => /QUIET/.test(x)).join(', ') + ')');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
