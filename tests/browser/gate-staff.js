/* The trainee gate's staff side, in a real browser:
     NODE_PATH=/opt/node-tools/node_modules node tests/browser/gate-staff.js
                                               (npm run test:browser:gate-staff)

   docs/trainee-gate/DESIGN.md Stage 3. Drives the real index.html in
   headless Chromium, the outside world cut off: the Centre's shared files
   are an in-memory stand-in (tests/browser/fake-drive.js) and the trainee
   sign-in address answers like the real one would (health, and at its
   first check it sets up its folders and CESTIS_GATE.json, §10.1 step 8).

     1. Settings → Trainee Sign-in on an administrator's PC: "Not set up";
        the setup code is not available yet (the site does not serve it), or
        is copied when it is; the address is pasted and checked ("Ready —
        version 1 · 6 trainee accounts"); Turn on shows the trainees'
        sign-in link (#gate=…, the address in the fragment only) with its
        QR code, and Print makes a page with the code and its caption.
     2. The PC's own 5-second save then publishes: a folder per trainee,
        named with the student ID and found by "acct=…" in its description,
        holding that trainee's records; papers and answer keys of their
        exams; rooms — each saying what it holds (appProperties); keys first,
        then papers, then trainees' records. Nobody's records hold another
        trainee's name; no paper and no record holds a right answer.
     3. A hand-made inbox in a trainee's folder (a support message, a piece
        of coursework, a withdrawn request, a read mark) is collected and
        merged by the dashboard's own merge — once: a second turn changes
        nothing — then travels in the PC's ordinary upload; the office
        request queue shows the request as withdrawn.
     4. The card in Light and in Dark, on a desktop and on a phone: every
        word readable (WCAG AA), nothing off the edge.
     5. Turned off: no more requests from the gate. A staff PC where the
        gate was never set up: not one of its requests, over many saves.
     6. 300 trainees: how long the publish takes on this machine.
   No page errors anywhere. Kept out of the default npm test chain because it
   needs a browser. GATE_STAFF_SHOTS=<dir> saves screenshots of the card. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { FakeDrive, driveTokenSeed } = require('./fake-drive');
const Core = require('../../cestis-core.js');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.GATE_STAFF_SHOTS || '';
const ONLY = process.env.GATE_STAFF_ONLY ? new RegExp(process.env.GATE_STAFF_ONLY, 'i') : null;
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } return !!cond; }
const wait = ms => new Promise(r => setTimeout(r, ms));
const kit = require('./gate-kit');
const { MAIN_FOLDER, ADMIN, TRAINEES, QUESTIONS } = kit;
const GATE = 'https://script.google.com/macros/s/FAKE-GATE-DEPLOYMENT/exec';
const SID = {};
TRAINEES.forEach(t => { SID[t.id] = t.sid; });

function fakeGate(drive, opts) {
  opts = opts || {};
  const F = 'application/vnd.google-apps.folder';
  const g = { calls: 0, cfg: null, trainees: opts.trainees || TRAINEES.length };
  g.setup = () => {
    if (g.cfg) return g.cfg;
    const root = drive.put(null, { name: 'CESTIS Trainee Gate', mimeType: F, parents: ['root'] }, '');
    const mk = n => drive.put(null, { name: n, mimeType: F, parents: [root.id] }, '').id;
    const gateFolderId = mk('_gate');
    g.cfg = { format: 'cestis-gate-config', version: 1, gateVersion: 1, protocol: [1], rootId: root.id, gateFolderId, traineesId: mk('Trainees'),
      keysId: mk('Exam keys'), papersId: mk('Papers'), roomsId: mk('Rooms'), registrationsId: mk('Registrations'), writtenAt: new Date().toISOString() };
    drive.put(null, { name: 'CESTIS_GATE.json', parents: [MAIN_FOLDER] }, JSON.stringify(g.cfg));
    // Its live checks (SETUP.md 5 and 7), which no collector may read.
    drive.put(null, { name: 'CESTISSMOKE.name-check.json', parents: [gateFolderId] }, '{"check":"name"}');
    drive.put(null, { name: 'smoke-description-check', mimeType: F, parents: [gateFolderId], description: 'cestis-smoke acct=USR-SMOKECHECK v=1' }, '');
    return g.cfg;
  };
  g.handle = route => {
    g.calls++;
    const u = new URL(route.request().url());
    if (u.searchParams.get('op') === 'health') g.setup();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, service: 'cestis-trainee-gate', version: 1, protocol: [1], time: new Date().toISOString(),
        ready: { secret: true, folders: true, ledger: true, ledgerUpdated: new Date().toISOString(), trainees: g.trainees }, accepting: true }) });
  };
  return g;
}

(async function main() {
  const srv = await kit.serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const allErrors = [];
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const report = {};

  const K = kit.make({ browser, base, errors: allErrors, gateUrl: GATE });
  // Turn on waits for the trainee side; stand it in where a page has none.
  const computer = opts => K.computer(Object.assign({ stubTraineeClient: true }, opts));
  const watch = K.watch, adminSignedIn = K.adminSignedIn;
  async function openCard(page) {
    await page.evaluate(() => showPage('settings'));
    await page.waitForSelector('#page-settings .tab');
    await page.evaluate(() => { const t = Array.from(document.querySelectorAll('#page-settings .tab')).find(x => /Trainee Sign-in/.test(x.textContent)); t.click(); });
    await page.waitForTimeout(400);
  }
  const card = page => page.evaluate(() => ({
    status: document.getElementById('gateStatusLine').textContent, tone: document.getElementById('gateStatusLine').className,
    badge: document.getElementById('gateOnBadge').textContent, toggle: document.getElementById('gateToggleBtn').textContent,
    linkShown: !document.getElementById('gateLinkBox').hidden, link: document.getElementById('gateLinkText').value,
    qr: (document.getElementById('gateQrImg').getAttribute('src') || '').slice(0, 22), qrShown: !document.getElementById('gateQrImg').hidden,
    publish: document.getElementById('gatePublishLine').textContent, waiting: document.getElementById('gateWaitingLine').textContent,
    address: document.getElementById('gateAddress').value
  }));
  // A picture of the card as a person sees it: no toast left over from the
  // last click, nothing focused, and — for a card taller than the screen —
  // a screen tall enough to hold all of it below the top bar.
  async function shot(page, name, sel) {
    if (!SHOTS) return;
    const file = path.join(SHOTS, name + '.png');
    const vp = page.viewportSize();
    try {
      await page.evaluate(() => { document.querySelectorAll('#toastContainer .toast').forEach(t => t.remove()); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
      if (sel) {
        const h = await page.evaluate(s => { const e = document.querySelector(s); return e ? Math.ceil(e.getBoundingClientRect().height) : 0; }, sel);
        if (h + 180 > vp.height) await page.setViewportSize({ width: vp.width, height: h + 200 });
        await page.evaluate(s => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'end' }); } }, sel);
        await page.waitForTimeout(250);
        await page.locator(sel).first().screenshot({ path: file });
      } else await page.screenshot({ path: file });
    } catch (e) { console.log('  (screenshot ' + name + ' not taken: ' + String(e.message).split('\n')[0] + ')'); }
    if (page.viewportSize().height !== vp.height) { await page.setViewportSize(vp); await page.waitForTimeout(150); }
  }
  async function readable(page, where, sels) {
    const res = await page.evaluate(sels => {
      const rgba = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
      const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
      const lum = c => { const v = c.slice(0, 3).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      return sels.map(sel => {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) return [sel, null, false];
        let stops = null;
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const st = getComputedStyle(n);
          if (/gradient/.test(st.backgroundImage)) { stops = (st.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(rgba).filter(Boolean); if (stops.length) break; }
          const c = rgba(st.backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
        }
        let bg = layers.length && layers[layers.length - 1][3] >= 1 ? layers.pop() : [255, 255, 255, 1];
        while (layers.length) bg = over(layers.pop(), bg);
        const cs = getComputedStyle(el), size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const ratio = b0 => { const fg = over(rgba(cs.color), b0), a = lum(fg), b = lum(b0); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        const r = stops && stops.length ? Math.min.apply(null, stops.map(c => ratio(over(c, bg)))) : ratio(bg);
        return [sel, r, size >= 24 || (bold && size >= 18.66)];
      });
    }, sels);
    for (const [sel, r, large] of res) ok(r !== null && r >= (large ? 3 : 4.5), where + ': ' + sel + ' reads at ' + (r === null ? 'n/a (missing)' : r.toFixed(2) + ':1'));
    console.log('    contrast, ' + where + ': ' + res.map(([sel, r]) => sel.replace(/^#gate/, '').split(' ').pop() + ' ' + (r === null ? 'n/a' : r.toFixed(2))).join(', '));
  }
  const files = (drive, parent) => Object.values(drive.files).filter(f => f.parents.indexOf(parent) !== -1);
  const GATE_SHAPED = /CESTIS_GATE|CESTISINBOX|appProperties|cestis-trainee|from-centre|cestisGate/;

  const PLAN = [];
  function section(title, fn) { PLAN.push({ title, fn }); }

  /* ---------------------------------------------------------------- 1–3 */
  section('1. The administrator sets it up and turns it on; 2. the PC publishes; 3. a trainee\'s inbox is collected once', async () => {
    const drive = new FakeDrive();
    const gate = fakeGate(drive);
    const ctx = await computer({ drive, gate });
    const page = await adminSignedIn(ctx, {});
    await openCard(page);
    let c = await card(page);
    ok(c.status === 'Not set up' && c.badge === 'Off' && c.toggle === 'Turn on', 'a new Centre: "Not set up", Off (' + c.status + ' / ' + c.badge + ')');
    ok(!c.linkShown, 'no sign-in link until it is on');
    ok(await page.evaluate(() => document.getElementById('gateToggleBtn').disabled), 'Turn on waits for an address');
    ok(await page.evaluate(() => document.getElementById('gateSetupSheet').getAttribute('href') === 'trainee-gate/SETUP.md'), 'Setup sheet opens trainee-gate/SETUP.md');
    ok(ctx._log.length === 0 || ctx._log.every(l => !GATE_SHAPED.test(decodeURIComponent(l)) && l.indexOf('GATE ') !== 0), 'nothing has been asked of the gate yet');
    await shot(page, '01-not-set-up-dark-desktop', '#gateCard');
    await shot(page, '01-not-set-up-dark-desktop-full');
    // The setup code: not served yet, then served.
    await page.click('#gateCopyCodeBtn');
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => /isn.t available yet/.test(document.body.innerText)), 'Copy the setup code: "The setup code isn\'t available yet."');
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    srv.servePaste(true);
    await page.click('#gateCopyCodeBtn');
    await page.waitForTimeout(600);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const paste = fs.readFileSync(path.join(ROOT, 'trainee-gate', 'PASTE-GATE.gs'), 'utf8');
    ok(clip.length > 1000 && clip === paste, 'once the site serves it, trainee-gate/PASTE-GATE.gs is copied whole (' + clip.length + ' characters)');
    ok(await page.evaluate(() => fetch('trainee-gate/SETUP.md').then(r => r.ok)), 'and the setup sheet is there to open');
    srv.servePaste(false);
    // The address, checked.
    await page.fill('#gateAddress', 'not an address');
    await page.click('#gateCheckBtn');
    await page.waitForTimeout(300);
    ok(gate.calls === 0, 'something that is not an address is refused before anything is asked');
    await page.fill('#gateAddress', GATE);
    await page.click('#gateCheckBtn');
    await page.waitForFunction(() => /^Ready/.test(document.getElementById('gateStatusLine').textContent), null, { timeout: 10000 }).catch(() => {});
    c = await card(page);
    ok(c.status === 'Ready — version 1 · 6 trainee accounts', 'Check: "Ready — version 1 · 6 trainee accounts" (' + c.status + ')');
    ok(gate.calls === 1 && ctx._log.filter(l => l.indexOf('GATE ') === 0).every(l => /op=health/.test(l)), 'Check asked the address one thing: health');
    ok(await page.evaluate(GATE => systemSettings.traineeGate.url === GATE && systemSettings.traineeGate.enabled === false, GATE), 'the address is kept in the Centre\'s settings, still off');
    await shot(page, '02-ready-dark-desktop', '#gateCard');
    // Turned on.
    const t0 = Date.now();
    await page.click('#gateToggleBtn');
    await page.waitForTimeout(500);
    c = await card(page);
    ok(c.badge === 'On' && c.toggle === 'Turn off', 'Turn on: On');
    const m = /^(.+)#gate=([A-Za-z0-9_-]+)$/.exec(c.link);
    ok(!!m && m[1] === base + '/index.html', 'the trainees\' sign-in link is this site\'s page with #gate=… (' + c.link.slice(0, 60) + '…)');
    ok(m && Buffer.from(m[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') === GATE, 'the fragment is the address');
    ok(c.qrShown && c.qr === 'data:image/png;base64,', 'with its QR code');
    ok(await page.evaluate(() => /Sign in on your own phone: scan this code\./.test(document.getElementById('gateLinkBox').innerText)), 'captioned "Sign in on your own phone: scan this code."');
    // Print: a page of its own with the code and its caption.
    await page.evaluate(() => { window.__printed = 0; });
    await page.click('#gatePrintBtn');
    await page.waitForTimeout(600);
    const pr = await page.evaluate(() => { const f = document.getElementById('gatePrintFrame'); const d = f && f.contentDocument; return d ? { text: d.body.innerText, img: !!d.querySelector('img[src^="data:image/png"]') } : null; });
    ok(pr && pr.img && /Sign in on your own phone: scan this code\./.test(pr.text), 'Print makes a page with the code and its caption');
    ok(pr && !/google|drive|cloud|server/i.test(pr.text.replace(/https?:\S+/g, '')), 'whose words name no place');
    /* 2. The 5-second save publishes. */
    await page.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('cestisGatePublished') || '{}'); return !!s.syncedAt && !_gateRun.publishing; } catch (e) { return false; } }, null, { timeout: 90000, polling: 500 }).catch(() => {});
    report.smallPublishMs = Date.now() - t0;
    const cfg = gate.cfg;
    ok(!!cfg, 'the gate\'s first check set up its folders');
    const folders = files(drive, cfg.traineesId);
    ok(folders.length === 6, 'six trainee folders (' + folders.length + ')');
    const byAcct = {};
    folders.forEach(f => { const mm = /acct=(\S+)/.exec(f.description || ''); if (mm) byAcct[mm[1]] = f; });
    ok(TRAINEES.every(t => byAcct[t.id] && byAcct[t.id].name === t.sid && /^cestis-trainee acct=\S+ v=1$/.test(byAcct[t.id].description)), 'each named with the trainee\'s student ID, found by "cestis-trainee acct=… v=1"');
    const slices = TRAINEES.map(t => files(drive, (byAcct[t.id] || {}).id).find(f => f.name === 'from-centre.json'));
    ok(slices.every(Boolean), 'each holds from-centre.json');
    const tameka = slices[0] ? JSON.parse(slices[0].content) : {};
    ok(tameka.accountId === 'USR-trichards' && tameka.studentId === SID['USR-trichards'] && slices[0].appProperties.h === tameka.hash && slices[0].appProperties.cestisKind === 'slice' &&
      slices[0].appProperties.acct === 'USR-trichards' && Number(slices[0].appProperties.s) === tameka.maxStamp, 'Tameka\'s records, and the file says so (kind, account, hash, stamp)');
    const text = slices[0] ? slices[0].content : '';
    ok(TRAINEES.slice(1).every(t => text.indexOf(t.name) === -1 && text.indexOf(t.sid) === -1 && text.indexOf(t.id) === -1), 'Tameka\'s records hold no other trainee\'s name or ids');
    ok(!/correctAnswer|"pairs"|distractors|tolerance|"password"/.test(text), 'and no right answer, no password check');
    ok((tameka.access || {}).papers && tameka.access.papers.join() === 'EXAM-WS3', 'her records let her sit her programme\'s exam only');
    ok(/Welding safety week/.test(text), 'and carry her programme\'s notice');
    const keys = files(drive, cfg.keysId), papers = files(drive, cfg.papersId);
    ok(keys.map(f => f.name).sort().join() === 'key.EXAM-EI2.json,key.EXAM-WS3.json', 'answer keys for the two exams with questions (never a draft): ' + keys.map(f => f.name).join(', '));
    ok(papers.map(f => f.name).sort().join() === 'paper.EXAM-EI2.json,paper.EXAM-WS3.json', 'and their papers');
    ok(papers.every(f => !/correctAnswer/.test(f.content)) && keys.every(f => /correctAnswer/.test(f.content)), 'papers without answers, keys with');
    ok(keys.concat(papers).every(f => f.appProperties.cestisGate === '1' && /^(key|paper)$/.test(f.appProperties.cestisKind) && /^EXAM-/.test(f.appProperties.examId) && /^h1-/.test(f.appProperties.h)),
      'each says what it is and for which exam');
    const firstOf = k => Object.values(drive.files).filter(f => f.appProperties && f.appProperties.cestisKind === k).map(f => f.createdTime).sort();
    ok(firstOf('key').pop() < firstOf('paper')[0] && firstOf('paper').pop() < firstOf('slice')[0], 'answer keys written first, then papers, then trainees\' records');
    c = await card(page);
    ok(/^Records sent to trainees: (just now|\d+ min ago) \(0 waiting\)$/.test(c.publish), 'the card: "' + c.publish + '"');
    ok(c.waiting === 'Trainee work waiting for a decision: 0', 'the card: "' + c.waiting + '"');
    await shot(page, '03-on-with-qr-dark-desktop', '#gateCard');
    await shot(page, '03-on-with-qr-dark-desktop-full');
    /* 3. A trainee's inbox. */
    const reqId = await page.evaluate(() => JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests'))[0].id);
    const at = new Date().toISOString();
    const lane = { format: 'cestis-trainee-inbox', version: 1, accountId: 'USR-trichards', studentId: SID['USR-trichards'], lane: 'L-hand-made', createdAt: at, updatedAt: at,
      records: {
        voctrain_support_messages: [{ id: 'SUP-GATE-1', accountId: 'USR-trichards', studentId: SID['USR-trichards'], name: 'Tameka Richards', email: 'tameka.richards@example.com',
          subject: 'Practical on Friday', message: 'Is the welding practical still on Friday?', timestamp: Date.now(), createdAt: at }],
        voctrain_submissions: [{ id: 'SUB-GATE-1', assignmentId: 'ASG-WF-1', studentId: SID['USR-trichards'], submittedAt: at, comment: 'My butt joint, photos attached.', grade: 10 }],
        voctrain_certTranscriptRequests: [{ id: reqId, studentId: SID['USR-trichards'], status: 'cancelled', updatedAt: at }]
      },
      ops: [{ id: 'OP-READ-1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-WF-1', at }], received: {} };
    drive.put(null, { name: 'CESTISINBOX.L-hand-made.json', parents: [byAcct['USR-trichards'].id] }, JSON.stringify(lane));
    await page.evaluate(() => gateCollectTick());
    await page.waitForFunction(() => !_gateRun.collecting, null, { timeout: 20000 });
    const got = await page.evaluate(() => ({
      res: _gateRun.lastCollect,
      sup: supportMessages.filter(s => s.id === 'SUP-GATE-1').length,
      sub: assignmentSubmissions.filter(s => s.id === 'SUB-GATE-1'),
      req: JSON.parse(CESTISStore.getItem('voctrain_certTranscriptRequests')).map(r => r.status),
      read: (announcements.find(a => a.id === 'AN-WF-1') || {}).readBy || []
    }));
    ok(got.res && got.res.files === 1 && !got.res.error, 'the inbox is collected (' + JSON.stringify(got.res && { files: got.res.files, refused: got.res.refused }) + ')');
    ok(got.sup === 1, 'her support message is in the office\'s messages');
    ok(got.sub.length === 1 && got.sub[0].studentId === SID['USR-trichards'] && got.sub[0].grade === undefined, 'her coursework is in, without the grade she wrote on it');
    ok(got.req.join() === 'cancelled', 'her request is withdrawn in the office queue');
    ok(got.read.indexOf('USR-trichards') !== -1, 'the notice is marked read by her, and by her only (' + got.read.join() + ')');
    await page.evaluate(() => gateCollectTick());
    await page.waitForFunction(() => !_gateRun.collecting, null, { timeout: 20000 });
    const again = await page.evaluate(() => ({ res: _gateRun.lastCollect, sup: supportMessages.filter(s => s.id === 'SUP-GATE-1').length, sub: assignmentSubmissions.filter(s => s.id === 'SUB-GATE-1').length }));
    ok(again.res && again.res.files === 0 && again.sup === 1 && again.sub === 1, 'a second turn merges nothing again');
    // The PC's ordinary save takes it up.
    await page.waitForFunction(() => true, null, { timeout: 100 });
    let inBackup = false;
    for (let i = 0; i < 20 && !inBackup; i++) {
      await wait(1000);
      const b = Object.values(drive.files).find(f => f.name === 'CESTIS_LMS_BACKUP.json' && f.parents.indexOf(MAIN_FOLDER) !== -1);
      inBackup = !!b && /SUP-GATE-1/.test(b.content) && /SUB-GATE-1/.test(b.content);
    }
    ok(inBackup, 'and the 5-second save carries it up with everything else');
    // The office request queue shows it.
    await page.evaluate(() => showPage('cert-transcript-requests'));
    let queueText = '';
    for (let i = 0; i < 15 && !/Withdrawn by the trainee/i.test(queueText); i++) {
      await wait(700);
      queueText = await page.evaluate(() => { const f = document.getElementById('ctrRequestsFrame'); try { return f && f.contentDocument ? f.contentDocument.body.innerText : ''; } catch (e) { return ''; } });
      if (i === 3) await page.evaluate(() => { const f = document.getElementById('ctrRequestsFrame'); try { f.contentDocument.getElementById('crStatusFilter').value = 'all'; f.contentWindow.render(); } catch (e) {} });
    }
    ok(/Withdrawn by the trainee/i.test(queueText), 'the office request queue shows "Withdrawn by the trainee"');
    if (SHOTS) {
      await page.evaluate(() => { const f = document.getElementById('ctrRequestsFrame'); try { f.contentDocument.getElementById('crStatusFilter').value = 'all'; f.contentWindow.render(); } catch (e) {} });
      await page.waitForTimeout(300);
      await shot(page, '06-request-withdrawn-dark-desktop', '#ctrRequestsFrame');
    }
    /* Unplaced work waits for a decision (the account removed). */
    await openCard(page);
    const goneFolder = byAcct['USR-ofacey'];
    drive.put(null, { name: 'CESTISINBOX.L-gone.json', parents: [goneFolder.id] }, JSON.stringify(Object.assign({}, lane, { accountId: 'USR-ofacey', studentId: SID['USR-ofacey'], lane: 'L-gone',
      records: { voctrain_support_messages: [{ id: 'SUP-GONE-1', accountId: 'USR-ofacey', studentId: SID['USR-ofacey'], name: 'Odalys Facey', subject: 'Hair practical', message: 'Which day?', timestamp: Date.now() }] }, ops: [] })));
    await page.evaluate(() => { window.__keepUsers = userAccounts; userAccounts = userAccounts.filter(u => u.id !== 'USR-ofacey'); return gateCollectTick(); });
    await page.waitForFunction(() => !_gateRun.collecting, null, { timeout: 20000 });
    await page.evaluate(() => { userAccounts = window.__keepUsers; gateCardRefresh(); });
    c = await card(page);
    ok(c.waiting === 'Trainee work waiting for a decision: 1', 'work for an account that is gone waits for a decision: "' + c.waiting + '"');
    ok(await page.evaluate(sid => document.getElementById('gateWaitingList').innerText.indexOf(sid + ' — the account is no longer on the list (1 item)') !== -1, SID['USR-ofacey']), 'listed with whose and why');
    await shot(page, '04-waiting-for-a-decision-dark-desktop', '#gateCard');
    await page.evaluate(() => gateCollectTick({ refetch: true }));
    await page.waitForFunction(() => !_gateRun.collecting, null, { timeout: 20000 });
    await page.evaluate(() => gateCardRefresh());
    c = await card(page);
    ok(c.waiting === 'Trainee work waiting for a decision: 0' && await page.evaluate(() => supportMessages.some(s => s.id === 'SUP-GONE-1')), 'the account back: collected, nothing waiting');
    /* 5a. Turned off: the gate itself is told (gate-off in its folder), then the gate's requests stop. */
    await page.click('#gateToggleBtn');
    await page.waitForTimeout(300);
    c = await card(page);
    ok(c.badge === 'Off' && !c.linkShown, 'Turn off: Off, the link put away');
    await page.waitForFunction(() => !_gateRun.publishing && !_gateRun.collecting && !_gateRun.offPending, null, { timeout: 60000 });
    const offFile = () => Object.values(drive.files).filter(f => f.name === 'gate-off' && f.parents.indexOf(cfg.rootId) !== -1);
    ok(offFile().length === 1 && !offFile()[0].trashed, 'Turn off writes "gate-off" in the gate\'s folder: it stops answering trainees within a minute');
    const d0 = await page.evaluate(() => _gateRun.drive), l0 = ctx._log.length;
    await wait(16000);
    const d1 = await page.evaluate(() => _gateRun.drive);
    ok(d1 === d0, 'turned off, the gate makes no more requests over three saves (' + (d1 - d0) + ')');
    ok(ctx._log.slice(l0).every(l => !GATE_SHAPED.test(decodeURIComponent(l)) && l.indexOf('GATE ') !== 0 && !/gate-off/.test(decodeURIComponent(l))), 'none of this PC\'s requests are the gate\'s (' + (ctx._log.length - l0) + ' ordinary requests)');
    await page.click('#gateToggleBtn');
    await page.waitForFunction(() => !_gateRun.offPending, null, { timeout: 30000 });
    ok(offFile().length === 1 && offFile()[0].trashed, 'Turn on again puts "gate-off" in the bin (never deleted)');
    ok(!Object.values(drive.files).some(f => f.trashed && f.name !== 'gate-off'), 'nothing else was ever binned');
    ok(await page.evaluate(() => supportMessages.filter(m => /^SUP-(GATE|GONE)-/.test(m.id)).length) === 2, 'and the smoke-check files in the gate\'s folder were never taken for anybody\'s inbox');
    ok(allErrors.length === 0, 'no page errors — ' + allErrors.join(' | '));
    await ctx.close();
  });

  /* ---------------------------------------------------------------- 4 */
  section('4. The card in Light and Dark, desktop and phone', async () => {
    for (const theme of ['light', 'dark']) {
      for (const phone of [false, true]) {
        const where = theme + (phone ? ' phone' : ' desktop');
        const drive = new FakeDrive(), gate = fakeGate(drive);
        const ctx = await computer({ drive, gate, theme, phone });
        const page = await adminSignedIn(ctx, { label: where });
        await openCard(page);
        ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === (theme === 'light' ? 'light' : null), where + ': the page is in ' + theme);
        const tag = (phone ? 'phone' : 'desktop');
        await readable(page, where + ', not set up', ['#gateStatusLine', '#gateCard .gate-lead', '#gateCard .gate-step-body h4', '#gateCard .gate-step-body p', '#gateCopyCodeBtn', '#gateCheckBtn', '#gatePublishLine']);
        if (!(theme === 'dark' && !phone)) await shot(page, '01-not-set-up-' + theme + '-' + tag, '#gateCard');
        await page.fill('#gateAddress', GATE);
        await page.click('#gateCheckBtn');
        await page.waitForFunction(() => /^Ready/.test(document.getElementById('gateStatusLine').textContent), null, { timeout: 10000 }).catch(() => {});
        await readable(page, where + ', ready', ['#gateStatusLine', '#gateToggleBtn']);
        if (!(theme === 'dark' && !phone)) await shot(page, '02-ready-' + theme + '-' + tag, '#gateCard');
        await page.click('#gateToggleBtn');
        await page.waitForTimeout(600);
        await readable(page, where + ', on', ['#gateCard .gate-qr-caption', '#gateLinkText', '#gatePrintBtn', '#gateOnBadge', '#gateWaitingLine']);
        const fit = await page.evaluate(() => {
          const cardEl = document.getElementById('gateCard'), r = cardEl.getBoundingClientRect();
          const off = Array.from(cardEl.querySelectorAll('*')).filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.id || e.className).slice(0, 5);
          const small = Array.from(cardEl.querySelectorAll('button, a.btn, input')).filter(e => e.getClientRects().length && e.getBoundingClientRect().height < 44).length;
          return { sideways: document.documentElement.scrollWidth - innerWidth, off, small, inside: r.left >= 0 && r.right <= innerWidth + 1,
            qr: document.getElementById('gateQrImg').getBoundingClientRect().width };
        });
        ok(fit.sideways <= 0 && !fit.off.length && fit.inside, where + ': nothing runs off the edge (' + JSON.stringify(fit) + ')');
        if (phone) ok(fit.small === 0, where + ': every button and field is at least 44px tall');
        ok(fit.qr >= 150, where + ': the QR code is big enough to scan (' + fit.qr + 'px)');
        await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('cestisGatePublished') || '{}').syncedAt; } catch (e) { return false; } }, null, { timeout: 60000, polling: 500 }).catch(() => {});
        await page.evaluate(() => gateCardRefresh());
        if (!(theme === 'dark' && !phone)) {
          await shot(page, '03-on-with-qr-' + theme + '-' + tag, '#gateCard');
          if (phone) await shot(page, '03-on-with-qr-' + theme + '-' + tag + '-full');
        }
        ok(allErrors.length === 0, where + ': no page errors — ' + allErrors.join(' | '));
        await ctx.close();
      }
    }
  });

  /* ---------------------------------------------------------------- 5b */
  section('5. A staff PC where the gate was never set up makes not one of its requests', async () => {
    const drive = new FakeDrive();
    const ctx = await computer({ drive });
    const page = await adminSignedIn(ctx, { label: 'never set up' });
    await wait(26000);   // five 5-second saves, a minute's worth of checks
    const r = await page.evaluate(() => ({ drive: _gateRun.drive, publishing: _gateRun.publishing, keys: Object.keys(localStorage).filter(k => /^cestisGate/.test(k)),
      autosave: !!_autoSaveIntervalId, connected: isCloudConnected }));
    ok(r.autosave && r.connected, 'the PC is signed in for syncing and saving every 5 seconds');
    ok(r.drive === 0, 'the gate made no request (counter ' + r.drive + ')');
    ok(ctx._log.length > 0 && ctx._log.every(l => !GATE_SHAPED.test(decodeURIComponent(l))), 'of this PC\'s ' + ctx._log.length + ' requests, none is the gate\'s');
    ok(r.keys.length === 0, 'and nothing of the gate\'s is written on this PC (' + r.keys.join() + ')');
    ok(!Object.values(drive.files).some(f => f.appProperties && f.appProperties.cestisGate), 'nor in the shared files');
    ok(allErrors.length === 0, 'no page errors — ' + allErrors.join(' | '));
    await ctx.close();
  });

  /* ---------------------------------------------------------------- 6 */
  section('6. 300 trainees: how long the publish takes', async () => {
    const drive = new FakeDrive(), gate = fakeGate(drive, { trainees: 300 });
    gate.setup();
    const ctx = await computer({ drive, gate });
    // Each publishing turn timed from inside the page (wrapped before the
    // administrator signs in, so the first is caught), and the longest
    // stretch a build runs without letting the page have its turn: from its
    // start to the first pause, between pauses, and to its end.
    const page = await adminSignedIn(ctx, { label: '300', extra: 294, gateOn: true, beforeSignIn: () => {
      window.__runs = []; window.__long = 0; window.__mark = 0;
      const run = gatePublishRun, pause = gatePause, build = gateBuild;
      gatePublishRun = async function(env) {
        const t = performance.now(), r = await run(env);
        window.__runs.push({ wrote: r.wrote, built: r.built, ms: Math.round(performance.now() - t) });
        return r;
      };
      gatePause = function() { const t = performance.now(); if (window.__mark) window.__long = Math.max(window.__long, t - window.__mark); return pause().then(() => { window.__mark = performance.now(); }); };
      gateBuild = async function() { window.__mark = performance.now(); const r = await build.apply(this, arguments); window.__long = Math.max(window.__long, performance.now() - window.__mark); window.__mark = 0; return r; };
    } });
    // The first turn, as it really runs: the build, then 120 writes ≥ 500 ms apart.
    const t0 = Date.now();
    await page.waitForFunction(() => _gateRun.builtAt > 0, null, { timeout: 120000, polling: 200 });
    const built = await page.evaluate(() => ({ ms: _gateRun.buildMs, trainees: _gateRun.built.trainees, items: Object.keys(_gateRun.built.items).length, scrubbed: _gateRun.built.scrubbed }));
    await page.waitForFunction(() => window.__runs.length >= 1, null, { timeout: 180000, polling: 500 });
    const first = await page.evaluate(() => window.__runs[0]);
    const turn1 = first.ms;
    void t0;
    const after1 = await page.evaluate(() => ({ left: JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length, long: window.__long }));
    const wrote1 = first.wrote;
    ok(built.trainees === 300, '300 trainees built (' + built.trainees + ' trainees, ' + built.items + ' files)');
    ok(built.scrubbed === 0, 'the privacy sweep took nothing out');
    ok(wrote1 === 120, 'the first turn wrote 120 (' + wrote1 + ')');
    // The rest, without the wait between writes, to see the work itself.
    await page.evaluate(() => { GATE_LIMITS.gapMs = 0; });
    const t1 = Date.now();
    await page.waitForFunction(() => !_gateRun.publishing && JSON.parse(localStorage.getItem('cestisGatePublishQueue') || '[]').length === 0 &&
      !!JSON.parse(localStorage.getItem('cestisGatePublished') || '{}').syncedAt, null, { timeout: 300000, polling: 500 });
    const rest = Date.now() - t1;
    const total = Object.values(drive.files).filter(f => f.appProperties && f.appProperties.cestisGate).length;
    const folders = files(drive, gate.cfg.traineesId).length;
    ok(folders === 300, '300 trainee folders (' + folders + ')');
    ok(total === built.items + 300, 'every file once: ' + total + ' (' + built.items + ' records, papers, keys and rooms + 300 folders)');
    // A turn with nothing changed: no writes, a moment's work.
    await page.evaluate(() => { _gateRun.builtAt = 0; });
    const t2 = Date.now();
    await page.waitForFunction(t => _gateRun.builtAt > t, t2 - 1, { timeout: 60000, polling: 200 });
    await page.waitForFunction(() => !_gateRun.publishing, null, { timeout: 60000 });
    const rebuild = await page.evaluate(() => _gateRun.buildMs);
    const total2 = Object.values(drive.files).reduce((n, f) => n + (f.version || 0), 0);
    report.p300 = { buildMs: built.ms, longestTaskMs: Math.round(after1.long), firstTurnMs: turn1, firstTurnWrites: wrote1, restMs: rest, restWrites: total - wrote1,
      writes: total, turns: Math.ceil(total / 120), projectedMs: Math.ceil(total / 120) * 5000 + total * 500, rebuildMs: rebuild };
    console.log('    300 trainees: build ' + built.ms + ' ms (longest stretch without a pause ' + Math.round(after1.long) + ' ms); first turn ' + (turn1 / 1000).toFixed(1) + ' s for ' + wrote1 +
      ' writes at ≤ 2 a second; the other ' + (total - wrote1) + ' writes ' + (rest / 1000).toFixed(1) + ' s without the wait; ' + total + ' writes in all = ' + Math.ceil(total / 120) +
      ' turns, ≈ ' + Math.round(report.p300.projectedMs / 60000) + ' min at the real pace; a later build with nothing new ' + rebuild + ' ms');
    void total2;
    ok(after1.long > 0 && after1.long < 2000, 'the page never froze for 2 s while building (longest stretch ' + Math.round(after1.long) + ' ms)');
    ok(allErrors.length === 0, 'no page errors — ' + allErrors.join(' | '));
    await ctx.close();
  });

  for (const sec of PLAN) {
    if (ONLY && !ONLY.test(sec.title)) continue;
    console.log(sec.title);
    const t0 = Date.now();
    try { await sec.fn(); } catch (e) { ok(false, sec.title + ' — threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
    console.log('    (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  }
  await browser.close();
  srv.close();
  if (report.smallPublishMs) console.log('\nSix trainees, from Turn on to everything sent: ' + (report.smallPublishMs / 1000).toFixed(1) + ' s');
  if (report.p300) console.log('300 trainees: ' + JSON.stringify(report.p300));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
