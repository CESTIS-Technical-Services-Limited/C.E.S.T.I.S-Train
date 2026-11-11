/* A certificate / transcript request's status reaches the trainee — in real browsers:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/ctr-status-to-trainee.js

   The owner's report (Nov 2026): "Trainees changed status does not reach
   trainees, and messages that were sent requesting transcript and
   certificate remained even though status changed, also allow
   Administrator to delete request."

   Over the Centre's shared files (tests/browser/fake-drive.js) and the REAL
   trainee gate (tests/browser/fake-gate.js), each device its own storage:
     1. A trainee on an office PC: her transcript request is Pending; the
        Administrator, on another PC, marks it Ready for Collection. On her
        PC her own list says Ready, and her bell says so — once.
     2. A trainee at home, through the trainee gate: she asks for her
        certificate; the office takes the request in and marks it
        Processing, then Ready. Her phone shows each, and her bell holds
        only the latest notice about that request.
     3. The Administrator deletes a request: it is gone from the queue, it
        does not come back from another PC or from the trainee's device,
        and the trainee's notices about it go.
   Screenshots go to $CESTIS_SHOTS (default: <tmp>/cestis-ctr-status-shots).
   Kept out of `npm test` (it needs a browser). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const { makeFakeGate, GATE_URL } = require('./fake-gate');
const kit = require('./gate-kit');
const Core = require('../../cestis-core.js');

const { TRAINEES, TRAINEE_PASS, ADMIN } = kit;
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.CESTIS_SHOTS || path.join(os.tmpdir(), 'cestis-ctr-status-shots');
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) {
  const end = Date.now() + (ms || 30000);
  for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() > end) return false; await wait(step || 400); }
}
const TAMEKA = TRAINEES[0], KEMAR = TRAINEES[1];
const LINK = '/index.html#gate=' + Core.gate.b64url(Core.gate.utf8(GATE_URL));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await kit.serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const drive = new FakeDrive();
  const gate = makeFakeGate(drive, { seed: 'ctr-status' });
  const K = kit.make({ browser, base: srv.base, errors, gateUrl: GATE_URL });

  async function signIn(page, card, user, pass) {
    await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); if (!loginSyncCompleted) { loginSyncCompleted = true; enableLoginButtons(); } });
    await page.evaluate(c => { const l = document.getElementById(c + 'Login'); if (!l.classList.contains('active')) document.querySelector('#' + c + 'Card .role-enter-btn').click(); }, card);
    await page.waitForTimeout(200);
    await page.fill('#' + card + 'User', user);
    await page.fill('#' + card + 'Pass', pass);
    await page.press('#' + card + 'Pass', 'Enter');
    await page.waitForFunction(() => document.getElementById('appShell').classList.contains('active') && !!currentRole, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { document.querySelectorAll('.cestis-alert-overlay').forEach(m => m.remove()); document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); });
  }
  async function freshPc(label) {
    const ctx = await K.computer({ drive, gate, scale: 2 });
    const page = K.watch(await ctx.newPage(), label);
    await page.goto(srv.base + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    await page.evaluate(token => { Object.keys(token).forEach(k => CESTISStore.setItem(k, token[k])); }, driveTokenSeed());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => loginSyncCompleted && userAccounts.some(u => u && u.role === 'student'), null, { timeout: 60000 }).catch(() => {});
    return page;
  }
  // The requests page on an office PC, and one status change made on it as staff do (its row's list).
  async function requestsFrame(page) {
    await page.evaluate(() => showPage('cert-transcript-requests'));
    const f = await until(async () => { const fr = page.frames().find(x => /Cert-Transcript-Requests\.html/.test(x.url())); return fr && await fr.evaluate(() => typeof setStatus === 'function' && document.readyState === 'complete') ? fr : null; }, 20000, 300);
    return f;
  }
  async function setStatusOn(page, reqId, status) {
    const f = await requestsFrame(page);
    await f.evaluate(() => { document.getElementById('crStatusFilter').value = 'all'; load(); render(); });
    await f.evaluate(({ id, st }) => { const sel = Array.from(document.querySelectorAll('select.cr-select.sm')).find(s => /setStatus\("?'?/.test(s.getAttribute('onchange')) && s.getAttribute('onchange').indexOf(id) !== -1); sel.value = st; sel.dispatchEvent(new Event('change')); }, { id: reqId, st: status });
    await page.waitForTimeout(600);
  }
  // What a trainee's own view shows of her requests (Transcript/Grades → My Requests), and her bell.
  async function traineeSees(page, reqId) {
    await page.evaluate(() => showPage('s-transcript-grades'));
    const fr = await until(async () => { const x = page.frames().find(y => /Transcript-Grades\.html/.test(y.url())); return x && await x.evaluate(() => !!document.getElementById('tgApp') && document.readyState === 'complete') ? x : null; }, 20000, 300);
    // Her list, as written (the badge shows it in capitals).
    const mine = fr ? await until(() => fr.evaluate(() => { const h = Array.from(document.querySelectorAll('.tg-card')).find(c => /My Requests/.test(c.textContent)); return h ? h.textContent : (document.querySelector('.tg-stats') ? 'none' : ''); }), 10000, 300) || '' : '';
    // Her notices about this request, by the status each tells her of.
    const bell = await page.evaluate(rid => (notifications || []).filter(n => n && String(n.id || '').indexOf('CTR-' + rid + '-') === 0).map(n => n.id.slice(('CTR-' + rid + '-').length).split('-')[0]), reqId);
    return { mine, bell };
  }

  try {
    /* ------------------------------------------------------------- 1 */
    console.log('1. A trainee on an office PC: the Administrator marks her request Ready on another PC');
    const ctxA = await K.computer({ drive, gate, scale: 2 });
    const A = await K.adminSignedIn(ctxA, { label: 'office PC' });
    const REQ1 = await A.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests'))[0].id);
    await wait(9000);   // the Centre's records reach the shared files
    const B = await freshPc('trainee PC');
    await signIn(B, 'student', TAMEKA.user, TRAINEE_PASS);
    const before = await until(async () => { const v = await traineeSees(B, REQ1); return /Pending/.test(v.mine) ? v : null; }, 60000, 3000) || await traineeSees(B, REQ1);
    ok(/Pending/.test(before.mine), 'her own list: the transcript request, Pending (' + before.mine.replace(/\s+/g, ' ').slice(0, 80) + ')');
    if (process.env.CTR_DEBUG) {
      const files = Object.values(drive.files).filter(x => !x.trashed && String(x.content || '').indexOf(REQ1) !== -1).map(x => x.name);
      const onB = await B.evaluate(() => CESTISStore.getItem('voctrain_certTranscriptRequests'));
      const fileNames = Object.values(drive.files).filter(x => !x.trashed).map(x => x.name);
      console.log('    [debug] files holding the request: ' + JSON.stringify(files) + '\n    [debug] on her PC: ' + String(onB).slice(0, 200) + '\n    [debug] all files: ' + JSON.stringify(fileNames).slice(0, 600));
      if (process.env.CTR_ONLY === '1') throw new Error('debug stop');
    }
    await setStatusOn(A, REQ1, 'ready');
    ok(await A.evaluate(rid => (notifications || []).some(n => n.id.indexOf('CTR-' + rid + '-ready-') === 0), REQ1), 'the office raises her notice');
    const seen = await until(async () => { const s = await traineeSees(B, REQ1); return /Ready for Collection/.test(s.mine) && s.bell.indexOf('ready') !== -1 ? s : null; }, 90000, 3000);
    const now1 = seen || await traineeSees(B, REQ1);
    ok(/Ready for Collection/.test(now1.mine), 'on her PC, her list says Ready for Collection (' + now1.mine.replace(/\s+/g, ' ').slice(0, 80) + ')');
    ok(now1.bell.length === 1 && now1.bell[0] === 'ready', 'and her bell says it is ready — once (' + now1.bell.join(',') + ')');
    await B.screenshot({ path: path.join(SHOTS, '01-trainee-pc-ready.png') });

    /* ------------------------------------------------------------- 2 */
    console.log('2. A trainee at home, through the trainee gate: Processing, then Ready');
    await A.evaluate(G => { systemSettings.traineeGate = { url: G, enabled: true, setAt: new Date().toISOString(), setBy: 'mthompson' }; saveState(); saveAccountsLedger(); GATE_LIMITS.gapMs = 0; _gateRun.cfgAt = 0; }, GATE_URL);
    await until(() => Object.values(drive.files).some(f => f.name === 'CESTIS_ACCOUNTS.json'), 20000);
    gate.world.get({ op: 'health' });
    const published = () => A.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0; } catch (e) { return false; } }, null, { timeout: 180000, polling: 500 });
    await published();
    const pctx = await K.computer({ phone: true, drive: null, gate });
    const P = K.watch(await pctx.newPage(), 'phone');
    await P.goto(srv.base + LINK, { waitUntil: 'load' });
    await P.waitForFunction(() => typeof _gateT !== 'undefined' && _gateT.decided, null, { timeout: 20000 });
    await P.evaluate(() => { const l = document.getElementById('studentLogin'); if (!l.classList.contains('active')) document.querySelector('#studentCard .role-enter-btn').click(); });
    await P.waitForTimeout(150);
    await P.fill('#studentUser', KEMAR.user); await P.fill('#studentPass', TRAINEE_PASS); await P.press('#studentPass', 'Enter');
    await P.waitForFunction(() => typeof currentRole !== 'undefined' && currentRole === 'student' && document.getElementById('appShell').classList.contains('active'), null, { timeout: 60000 });
    await P.waitForTimeout(1500);
    await P.evaluate(() => showPage('s-transcript-grades'));
    const certBtn = P.frameLocator('#sTranscriptGradesFrame').locator('button', { hasText: 'Request Certificate' });
    await certBtn.waitFor({ state: 'visible', timeout: 20000 });
    await certBtn.click();
    await until(() => P.evaluate(() => CESTISGate.capture().then(() => CESTISGate.deliverNow()).then(() => CESTISGate.status()).then(s => s.waiting === 0)), 40000, 1000);
    const collect = async () => { await A.evaluate(() => { _gateRun.collectAt = 0; GATE_LIMITS.collectMs = 1000; return gateCollectTick({ refetch: true }); }); await A.waitForFunction(() => !_gateRun.collecting, null, { timeout: 30000 }); };
    await collect();
    const REQ2 = await until(() => A.evaluate(sid => { const r = JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests') || '[]').find(x => x.studentId === sid && x.type === 'certificate'); return r ? r.id : null; }, KEMAR.sid), 30000, 1000);
    ok(!!REQ2, 'her certificate request reaches the office');
    // Her phone asks the gate for what is new, as it does every few minutes.
    const homeSees = async () => { await P.evaluate(() => gatePullAndApply().then(r => { if (r && r.ok && r.applied) gateAfterApply(r.applied); })); await P.waitForTimeout(800); return traineeSees(P, REQ2); };
    for (const st of ['processing', 'ready']) {
      await setStatusOn(A, REQ2, st);
      await A.evaluate(() => { _gateRun.buildNow = true; gatePublishSoon(); });
      await published();
      const label = st === 'ready' ? /Ready for Collection/ : /Processing/;
      const s = await until(async () => { const v = await homeSees(); return label.test(v.mine) && v.bell.indexOf(st) !== -1 ? v : null; }, 90000, 3000) || await homeSees();
      ok(label.test(s.mine), 'at home: her list says ' + st + ' (' + s.mine.replace(/\s+/g, ' ').slice(0, 80) + ')');
      ok(s.bell.length === 1 && s.bell[0] === st, 'her bell holds only the latest notice about it (' + s.bell.join(',') + ')');
    }
    await P.screenshot({ path: path.join(SHOTS, '02-phone-ready.png') });

    /* ------------------------------------------------------------- 3 */
    console.log('3. The Administrator deletes a request');
    const f = await requestsFrame(A);
    await f.evaluate(() => { document.getElementById('crStatusFilter').value = 'all'; load(); render(); });
    const hasDelete = await f.evaluate(id => !!Array.from(document.querySelectorAll('button')).find(b => /Delete/.test(b.textContent) && (b.getAttribute('onclick') || '').indexOf(id) !== -1), REQ1);
    ok(hasDelete, 'each request has Delete (the Administrator)');
    if (hasDelete) {
      await A.screenshot({ path: path.join(SHOTS, '03-requests-with-delete.png') });
      await f.evaluate(id => Array.from(document.querySelectorAll('button')).find(b => /Delete/.test(b.textContent) && (b.getAttribute('onclick') || '').indexOf(id) !== -1).click(), REQ1);
      await A.waitForTimeout(800);
      const live = (page, id) => page.evaluate(id => JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests') || '[]').filter(r => r.id === id).map(r => r.deleted === true ? 'deleted' : 'live'), id);
      ok((await live(A, REQ1)).join() === 'deleted', 'it is gone from the queue: kept on file, marked deleted');
      ok(await f.evaluate(id => !document.getElementById('crRows').innerHTML.includes(id) && document.getElementById('crRows').textContent.indexOf('Tameka') === -1, REQ1), 'and the queue no longer lists it');
      await f.evaluate(() => { document.getElementById('crStatusFilter').value = 'deleted'; render(); });
      ok(await f.evaluate(() => /Tameka Richards/.test(document.getElementById('crRows').textContent) && /Restore/.test(document.getElementById('crRows').textContent)), 'under "Deleted" it is listed, with Restore');
      await A.screenshot({ path: path.join(SHOTS, '04-requests-deleted-view.png') });
      ok(await A.evaluate(id => !(notifications || []).some(n => String(n.id || '').indexOf('CTR-' + id + '-') === 0), REQ1), 'and her notices about it are gone');
      // Another office PC, and the trainee's own PC, still holding it: it does not come back.
      const C = await freshPc('another office PC');
      await signIn(C, 'admin', ADMIN.user, ADMIN.pass);
      await wait(12000);
      ok((await live(C, REQ1)).indexOf('live') === -1, 'another office PC has it as deleted (' + (await live(C, REQ1)).join() + ')');
      ok((await live(A, REQ1)).join() === 'deleted', 'and it does not come back to this one');
      const gone = await until(async () => { const s = await traineeSees(B, REQ1); return !/My Requests/.test(s.mine) && !s.bell.length ? s : null; }, 90000, 3000);
      ok(!!gone, 'and on her PC it is gone from her list and her bell');
    }
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  } catch (e) {
    failed++; console.log('  ✗ FAIL: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
