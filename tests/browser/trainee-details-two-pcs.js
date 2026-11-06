/* Two office PCs change two different details of one trainee within the same
   few seconds, and both changes survive — in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/trainee-details-two-pcs.js

   What went wrong (the multi-device stress audit): every PC merges the
   Centre's one backup on each pull, and a trainee record merged WHOLE — the
   copy with the newer lastModified won. The office changed a trainee's phone
   number on PC A; seconds later an instructor changed the same trainee's
   status on PC B; PC B's copy was newer, so the phone number went back to
   the old one on every PC, silently.

   Two PCs (each its own browser storage, the administrator signed in, the
   5-second save running) share the Centre's files (an in-memory stand-in,
   tests/browser/fake-drive.js):
     1. both settle on the same roll;
     2. PC A changes Tameka's email address; two seconds later, before either
        has pulled, PC B changes her status — each saved the way every
        trainee edit is saved here (the detail, the record's date,
        saveState());
     3. once both have synced: both PCs, and the Centre's backup, hold the
        new email address AND the new status (on the old build PC B's newer
        copy put the old address back everywhere);
     4. the same detail (the phone) changed on both PCs: the later change
        stands on both.
   The outside world is cut off. No page errors. */
'use strict';
const { chromium } = require('playwright-core');
const { FakeDrive } = require('./fake-drive');
const kit = require('./gate-kit');

const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const SID = kit.TRAINEES[0].sid;   // Tameka Richards

(async () => {
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const K = kit.make({ browser, base: srv.base, errors });
  const mainBackup = () => {
    const f = Object.values(drive.files).find(x => x.name === 'CESTIS_LMS_BACKUP.json' && x.parents[0] === kit.MAIN_FOLDER);
    try { return JSON.parse(f.content).data; } catch (e) { return null; }
  };
  const rec = (page) => page.evaluate(sid => { const s = students.find(x => x && x.id === sid); return s ? JSON.parse(JSON.stringify(s)) : null; }, SID);
  // A trainee edit, saved the way every edit path here saves one.
  const edit = (page, patch) => page.evaluate(({ sid, patch }) => {
    const s = students.find(x => x && x.id === sid);
    Object.assign(s, patch);
    s.lastModified = new Date().toISOString();
    saveState();
  }, { sid: SID, patch });
  // Until both PCs agree on the trainee and the backup holds what they hold (at most 90 s).
  async function converge(A, B, want) {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await wait(5200);
      const a = await rec(A), b = await rec(B);
      const d = mainBackup(), c = d && (d.students || []).find(x => x && x.id === SID);
      const good = r => r && Object.keys(want).every(k => r[k] === want[k]);
      if (good(a) && good(b) && good(c)) return { a, b, c, ms: Date.now() - t0 };
    }
    const d = mainBackup();
    return { a: await rec(A), b: await rec(B), c: d && (d.students || []).find(x => x && x.id === SID), ms: -1 };
  }
  try {
    console.log('1. Two office PCs on the same roll');
    const ctxA = await K.computer({ drive });
    const A = await K.adminSignedIn(ctxA, { label: 'PC A' });
    await wait(12000);   // PC A's first saves reach the Centre's files
    const ctxB = await K.computer({ drive });
    const B = await K.adminSignedIn(ctxB, { label: 'PC B' });
    const start = await converge(A, B, { name: 'Tameka Richards' });
    ok(start.ms >= 0, 'both PCs and the backup hold Tameka\'s record');
    const email0 = start.a && start.a.email, status0 = start.a && start.a.status;

    console.log('2. PC A changes her email address; PC B changes her status two seconds later');
    // Neither PC pulls between the two edits (as when both are made within
    // one save interval): the two copies really do collide.
    const pause = page => page.evaluate(async () => { stopAutoSave(); while (_isAutoSaving) await new Promise(r => setTimeout(r, 100)); });
    await pause(A); await pause(B);
    await edit(A, { email: 'tameka.r@mail.example' });
    await wait(2000);
    await edit(B, { status: 'withdrawn' });
    await A.evaluate(() => { startAutoSave(); autoSaveToAllFolders(); });
    await wait(1500);
    await B.evaluate(() => startAutoSave());
    const after = await converge(A, B, { email: 'tameka.r@mail.example', status: 'withdrawn' });
    ok(after.a && after.a.email === 'tameka.r@mail.example', 'PC A keeps the new email address (' + (after.a && after.a.email) + ')');
    ok(after.a && after.a.status === 'withdrawn', 'PC A takes PC B\'s new status (' + (after.a && after.a.status) + ')');
    ok(after.b && after.b.email === 'tameka.r@mail.example', 'PC B takes PC A\'s new email address (' + (after.b && after.b.email) + ')');
    ok(after.b && after.b.status === 'withdrawn', 'PC B keeps its new status (' + (after.b && after.b.status) + ')');
    ok(after.c && after.c.email === 'tameka.r@mail.example' && after.c.status === 'withdrawn', 'the Centre\'s backup holds both changes');
    ok(email0 !== 'tameka.r@mail.example' && status0 !== 'withdrawn', '(neither was there before)');
    ok(!!(after.a && after.a._fs && after.a._fs.email && after.a._fs.status), 'each change carries its own edit stamp');

    console.log('3. The same detail changed on both PCs: the later change stands');
    await pause(A); await pause(B);
    await edit(B, { phone: '876-555-0202' });
    await wait(2000);
    await edit(A, { phone: '876-555-0303' });
    await B.evaluate(() => { startAutoSave(); autoSaveToAllFolders(); });
    await wait(1500);
    await A.evaluate(() => startAutoSave());
    const same = await converge(A, B, { phone: '876-555-0303' });
    ok(same.ms >= 0, 'both PCs and the backup hold the later number (' + [same.a && same.a.phone, same.b && same.b.phone, same.c && same.c.phone].join(' / ') + ')');
    ok(same.a && same.a.status === 'withdrawn' && same.b && same.b.status === 'withdrawn', 'and the status changed earlier is still there');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
