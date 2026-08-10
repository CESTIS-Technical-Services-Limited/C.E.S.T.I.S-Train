/* MegaData — real-browser smoke suite (run manually / CI with a browser):
     node tests/browser/megadata-smoke.js
   Validates what Node cannot: the glue modules parse and boot inside real
   pages, the enforcement shim installs, mode resolution lands on 'legacy'
   with no broker configured, the legacy page still renders, and the
   IndexedDB adapter's atomic accept survives a real page reload.
   Uses the environment's Chromium (PLAYWRIGHT_BROWSERS_PATH) via
   playwright-core; kept OUT of the default npm test chain because it needs
   a browser. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const EXE = process.env.CESTIS_CHROME || '/opt/pw-browsers/chromium';
let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) passed++; else { failed++; console.log('  ✗ FAIL: ' + msg); } }
function section(t) { console.log(t); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      const file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async function main() {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  async function openPage(rel) {
    const page = await browser.newPage();
    // The sandbox black-holes external hosts (fonts, CDN fallbacks, Google
    // auth), which would stall the 'load' event forever. Abort them: every
    // page must work from local assets alone — which is also the offline
    // reality the Centre actually runs in.
    await page.route('**/*', route => {
      route.request().url().startsWith(base) ? route.continue() : route.abort();
    });
    const pageErrors = [], consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message)));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(base + '/' + rel, { waitUntil: 'load' });
    await page.waitForTimeout(1200); // whenReady + async pageBoot
    return { page, pageErrors, consoleErrors };
  }

  section('Cert-Transcript-Requests loads clean with the MegaData stack');
  {
    const { page, pageErrors } = await openPage('Cert-Transcript-Requests.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | '));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.pageBoot && MegaData.createDAL && MegaData.ctrFromDocs)), 'all MegaData modules registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.mode === 'report'), 'enforcement shim installed in report mode');
    ok(await page.evaluate(() => String(window.load).indexOf('CESTISStore.getItem') !== -1), 'no broker configured → the page kept its LEGACY data layer');
    ok(await page.evaluate(() => document.querySelectorAll('#crRows td').length > 0), 'the legacy page rendered its table');
    ok(await page.evaluate(() => (window.__cestisShim.violations || []).every(v => v.api !== 'storage' || v.key.indexOf('voctrain_') === 0 || v.key.indexOf('cesti') === 0)),
      'shim telemetry contains only legacy-key accesses (allowlist sane)');
    await page.close();
  }

  section('Student-Progress loads clean with the bridge stack');
  {
    const { page, pageErrors } = await openPage('Student-Progress.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | '));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.identityIds && MegaData.rosterDrifted)), 'roster model registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'Student-Progress'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__spBridge === 'undefined'), 'bridge stays dormant in legacy mode');
    await page.close();
  }

  section('School.Fee loads clean with the money-bearing bridge stack');
  {
    const { page, pageErrors } = await openPage('School.Fee.html');
    await page.waitForTimeout(1800); // heavy page: seeds + charts + auto-admin init
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.feeBridgeAll && MegaData.reconcileFees)), 'fee bridge model registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'School.Fee'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__feeReconcile === 'undefined'), 'bridge and comparator stay dormant in legacy mode');
    await page.close();
  }

  section('IndexedDB adapter: an accepted write survives a REAL page reload');
  {
    const { page } = await openPage('Cert-Transcript-Requests.html');
    const first = await page.evaluate(async () => {
      await new Promise(r => { const q = indexedDB.deleteDatabase('SMOKE_DB'); q.onsuccess = q.onerror = q.onblocked = r; });
      const stub = { append: async () => ({ ok: true, acks: {}, errors: {}, head: { seq: 0, chain: 'genesis' } }), pull: async () => ({ events: [], head: { seq: 0, chain: 'genesis' } }) };
      const dal = await MegaData.createDAL({ adapter: MegaData.IdbAdapter('SMOKE_DB'), broker: stub, source: 'smoke', actor: { name: 'Smoke', role: 'admin', device: 'dev_smoke' } });
      const r = await dal.registerPerson({ names: { full: 'Reload Survivor' } });
      return { accepted: r.accepted, personId: r.personId, unsynced: dal.head().unsynced };
    });
    ok(first.accepted && first.unsynced === 1, 'write accepted into the real IndexedDB outbox');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(800);
    const second = await page.evaluate(async (personId) => {
      const stub = { append: async () => ({ ok: true, acks: {}, errors: {}, head: { seq: 0, chain: 'genesis' } }), pull: async () => ({ events: [], head: { seq: 0, chain: 'genesis' } }) };
      const dal = await MegaData.createDAL({ adapter: MegaData.IdbAdapter('SMOKE_DB'), broker: stub, source: 'smoke', actor: { name: 'Smoke', role: 'admin', device: 'dev_smoke' } });
      const p = dal.get('person', personId);
      const out = { unsynced: dal.head().unsynced, name: p && p.fields.names.full };
      await new Promise(r => { const q = indexedDB.deleteDatabase('SMOKE_DB'); q.onsuccess = q.onerror = q.onblocked = r; });
      return out;
    }, first.personId);
    ok(second.unsynced === 1, 'the outbox survived the reload (acknowledged-write contract, for real)');
    ok(second.name === 'Reload Survivor', 'the entity folded back from the real IndexedDB replica');
    await page.close();
  }

  section('Transcript-Grades loads clean with the docsync stack');
  {
    const { page, pageErrors } = await openPage('Transcript-Grades.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | '));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.docSyncPlan && MegaData.TG_SPECS && MegaData.profilesToList)), 'docsync + TG models registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'Transcript-Grades'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__tgTick === 'undefined'), 'docsync stays dormant in legacy mode');
    ok(await page.evaluate(() => typeof window.writeJSON === 'function' && String(window.writeJSON).indexOf('CESTISStore.setItem') !== -1),
      'no broker configured → the page kept its LEGACY writeJSON unwrapped');
    await page.close();
  }

  section('CESTIS.Cashbook loads clean with the D11 bridge stack');
  {
    const { page, pageErrors } = await openPage('CESTIS.Cashbook.html');
    await page.waitForTimeout(1200); // heavy page: charts + recon views
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.cbPlanQuarter && MegaData.cbReconcile && MegaData.cbAmount)), 'cashbook bridge + shared resolver registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'CESTIS.Cashbook'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__cbTick === 'undefined'), 'bridge stays dormant in legacy mode');
    await page.close();
  }

  section('Staff.Payslip loads clean with the docsync stack');
  {
    const { page, pageErrors } = await openPage('Staff.Payslip.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.PS_SPECS && MegaData.payrollDecompose)), 'staff-pages model registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'Staff.Payslip'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__psTick === 'undefined'), 'docsync stays dormant in legacy mode');
    await page.close();
  }

  section('Staff.Clock.in loads clean with the docsync stack');
  {
    const { page, pageErrors } = await openPage('Staff.Clock.in.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.CLOCK_SPECS && MegaData.docSyncPlan)), 'clock specs + docsync registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'Staff.Clock.in'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__clockTick === 'undefined'), 'docsync stays dormant in legacy mode');
    await page.close();
  }

  for (const fin of [
    { file: 'Finance.Invoice.html', page: 'Finance.Invoice' },
    { file: 'Finance.Quote.html', page: 'Finance.Quote' },
    { file: 'Finance.Purchase.Order.html', page: 'Finance.Purchase.Order' }
  ]) {
    section(fin.page + ' loads clean with the findoc bridge stack');
    const { page, pageErrors } = await openPage(fin.file);
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.fdPlan && MegaData.findocReconcile && window.FinanceDoc)), 'findoc model + legacy engine registered');
    ok(await page.evaluate(p => window.__cestisShim && window.__cestisShim.page === p, fin.page), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__fdTick === 'undefined'), 'bridge stays dormant in legacy mode');
    await page.close();
  }

  section('Finance.Payment.Voucher loads clean with the docsync stack');
  {
    const { page, pageErrors } = await openPage('Finance.Payment.Voucher.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.docSyncPlan)), 'docsync registered');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'Finance.Payment.Voucher'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__voucherTick === 'undefined'), 'sync stays dormant in legacy mode');
    await page.close();
  }

  section('index.html — the LMS dashboard loads clean with the full bridge stack');
  {
    const { page, pageErrors } = await openPage('index.html');
    await page.waitForTimeout(2000); // the biggest page: login shell + seeds + badges
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.lmsSpecs && MegaData.lmsDecompose && MegaData.spMergePlan && MegaData.LMS_COLLECTIONS)), 'LMS specs + shared table + roster merge registered');
    ok(await page.evaluate(() => MegaData.lmsSpecs().length === MegaData.LMS_COLLECTIONS.length), 'every collection in the table has a live spec');
    ok(await page.evaluate(() => window.__cestisShim && window.__cestisShim.page === 'index'), 'shim carries the page identity');
    ok(await page.evaluate(() => typeof window.__lmsTick === 'undefined'), 'bridge stays dormant in legacy mode');
    // Maintenance mode, deactivated, must survive the pull every login runs and
    // the reload after it — the page's OWN functions, not a model in isolation.
    const maint = await page.evaluate(() => {
      currentRole = 'admin';
      const CLOUD = { maintenanceMode: true, maintenanceMessage: 'Back shortly.', maintenanceUpdatedAt: '2026-08-09T09:00:00.000Z' };
      systemSettings.maintenanceMode = true;
      systemSettings.maintenanceMessage = 'Back shortly.';
      systemSettings.maintenanceUpdatedAt = CLOUD.maintenanceUpdatedAt;
      saveMaintenanceSettings();                                   // no toggle in the DOM → deactivate
      const offAfterSave = systemSettings.maintenanceMode === false;
      const mirror = JSON.parse(CESTISStore.getItem('voctrain_maintenanceMode') || '{}');
      systemSettings = CESTISCore.mergeSystemSettings(systemSettings, CLOUD);   // the login pull
      const offAfterPull = systemSettings.maintenanceMode === false;
      checkMaintenanceOnLoad();                                    // and the next page load
      const offAfterReload = systemSettings.maintenanceMode === false;
      currentRole = 'student';
      applyMaintenanceOverlay();
      return { offAfterSave, offAfterPull, offAfterReload, mirrorOff: mirror.active === false,
        mirrorStamped: !!mirror.updatedAt, overlay: document.getElementById('maintenanceOverlay').style.display };
    });
    ok(maint.offAfterSave, 'maintenance mode switches off');
    ok(maint.mirrorOff && maint.mirrorStamped, 'the local mirror records it off, WITH the time it was decided');
    ok(maint.offAfterPull, 'a cloud pull carrying the stale ON cannot switch it back on');
    ok(maint.offAfterReload, 'and it is still off after the next page load');
    ok(maint.overlay === 'none', 'so a non-admin is not locked out by an overlay nobody asked for');
    await page.close();
  }

  section('CMC Board dashboards fill themselves from the operating books — no button, no Drive');
  {
    const { page, pageErrors } = await openPage('index.html');
    await page.waitForTimeout(2000);
    const cmc = await page.evaluate(async () => {
      // The operating pages' own collections, same-origin, exactly as they write them.
      CESTISStore.setItem('cestis_quarter_2025/2026_Q1', JSON.stringify({
        openingBalance: 433419.51,
        transactions: [
          { id: 1, date: '2025-07-07', cheque: '', details: 'Cheque from C. Palmer', deposit: 88800, payment: 0, category: 'Training Material' },
          { id: 2, date: '2025-07-23', cheque: '', details: 'Crystal-Lee Gordon', deposit: 0, payment: 83535.75, category: 'Administrative Assistant' },
          { id: 3, date: '2025-07-24', cheque: '9001', details: 'Cancelled Cheque', deposit: 0, payment: 0, category: 'Cancelled' }
        ], deletedTxnIds: []
      }));
      CESTISStore.setItem('cestisPayroll', JSON.stringify({
        employees: [{ name: 'Crystal-Lee Gordon' }],
        payrollRuns: [{ date: '2025-07-25', results: [{ empName: 'Crystal-Lee Gordon', gross: 90000, net: 83535.75 }] }]
      }));
      CESTISStore.setItem('cestisStaffMembers', JSON.stringify([{ id: '7', fullName: 'Jodene Williams-Barrett' }]));
      CESTISStore.setItem('cestisTimeRecords', JSON.stringify([
        { id: 'S1', staffId: '7', date: '2025-07-23', clockIn: '2025-07-23T08:00:00Z', clockOut: '2025-07-23T16:30:00Z', status: 'completed' }
      ]));
      CESTISStore.setItem('cesti_virements', JSON.stringify([
        { id: 11, date: '2025-07-15', project: 'Lunch top-up', requestedBy: 'S. Barrett', total: 100000, status: 'Pending', lines: [{ fromName: 'Remedial English', toName: 'Lunch', amount: 100000 }] }
      ]));
      currentRole = 'cmc';
      currentLoggedInUser = { name: 'Board Member', username: 'cmc1', email: 'b@cestis.test', status: 'active' };
      buildCmcPages();
      buildCmcSidebar();
      cmcLoadOversightData();
      cmcRefreshAllSections();
      const text = function (id) { var e = document.getElementById(id); return e ? e.textContent : ''; };
      const before = document.getElementById('cmcFinancialBody').textContent;
      // The board narrows to expenditure only — nothing is fetched, it just filters.
      cmcSetFilter('financial', 'type', 'expense');
      const filtered = document.getElementById('cmcFinancialBody').textContent;
      cmcSetFilter('financial', 'type', 'all');
      cmcSetStaffView('clockin');
      const clockText = document.getElementById('cmcStaffBody').textContent;
      cmcSetStaffView('payslip');
      const payText = document.getElementById('cmcStaffBody').textContent;
      return {
        sidebar: document.getElementById('sidebarNav').innerHTML,
        sourcesPage: !!document.getElementById('page-cmc-sources'),
        syncButtons: (document.getElementById('mainContent').innerHTML.match(/Sync Drive Data|Sync All Sources|Refresh from Drive|Fetch HTML/g) || []).length,
        cashKpi: text('cmcFinCashbook'),
        cashSub: text('cmcFinCashbookSub'),
        virKpi: text('cmcFinVirement'),
        payKpi: text('cmcHrPayroll'),
        clockKpi: text('cmcHrClockin'),
        financialHasPayee: before.indexOf('Crystal-Lee Gordon') !== -1,
        financialHasVirement: before.indexOf('Lunch top-up') !== -1,
        filteredDropsIncome: filtered.indexOf('C. Palmer') === -1 && filtered.indexOf('Crystal-Lee Gordon') !== -1,
        filteredSaysSoMuch: /Showing \d+ of \d+/.test(filtered),
        clockShowsStaff: clockText.indexOf('Jodene Williams-Barrett') !== -1,
        payShowsStaff: payText.indexOf('Crystal-Lee Gordon') !== -1,
        academic: !!document.getElementById('cmcAcademicBody'),
        navBadge: /Virement Approvals<span class="nav-badge"[^>]*>1</.test(document.getElementById('sidebarNav').innerHTML),
        reader: (window.CESTISPageCloud ? window.CESTISPageCloud.status() : []).filter(function (p) { return p.page === 'CMC Oversight'; })[0] || null,
        readerPushed: await (window.CESTISPageCloud
          ? window.CESTISPageCloud.saveNow().then(function (r) { return r.some(Boolean); })
          : Promise.resolve(false))
      };
    });
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | ').slice(0, 300));
    ok(cmc.sidebar.indexOf('Source Viewer') === -1 && !cmc.sourcesPage, 'the Source Viewer is gone — nav entry and page both');
    ok(cmc.syncButtons === 0, 'no sync button anywhere in the CMC pages — got ' + cmc.syncButtons);
    ok(/5,264\.25|5264\.25/.test(cmc.cashKpi), 'Financial Overview shows the cashbook balance unprompted — got "' + cmc.cashKpi + '"');
    ok(/88,800/.test(cmc.cashSub) && /83,535\.75/.test(cmc.cashSub), 'with income and expenditure, the cancelled cheque counting zero — got "' + cmc.cashSub + '"');
    ok(cmc.virKpi === '1 Requests', 'the virement register loads too — got "' + cmc.virKpi + '"');
    ok(/83,535\.75/.test(cmc.payKpi), 'Staff & HR shows payroll — got "' + cmc.payKpi + '"');
    ok(cmc.clockKpi === '1 Sessions', 'and clock-in sessions — got "' + cmc.clockKpi + '"');
    ok(cmc.financialHasPayee && cmc.financialHasVirement, 'the cashbook and virement tables carry real rows, not a prompt to sync');
    ok(cmc.filteredDropsIncome, 'the board can filter to expenditure and the income row goes');
    ok(cmc.filteredSaysSoMuch, 'and a filtered table says how much of the whole it is showing');
    ok(cmc.clockShowsStaff, 'the Staff & HR clock-in view names the staff member');
    ok(cmc.payShowsStaff, 'and the payslip view names who was paid');
    ok(cmc.academic, 'Academic renders its own filterable table');
    ok(cmc.navBadge, 'the sidebar tells the board a virement is waiting on it');
    ok(cmc.reader && cmc.reader.reads >= 5, 'the board registered as a page-cloud reader of the operating books');
    ok(cmc.readerPushed === false, 'and it pushes NOTHING — oversight can never write over the pages it oversees');

    // The one decision the board makes, driven through the real page.
    const vir = await page.evaluate(() => {
      showPage('cmc-virements');
      const body = () => document.getElementById('cmcVirementBody').textContent;
      const before = body();
      const originalConfirm = window.confirm, originalToast = window.showToast;
      const toasts = [];
      window.confirm = () => true;
      window.showToast = (m) => toasts.push(String(m));
      document.getElementById('cmcVirNote_11').value = 'Agreed at the July meeting';
      cmcDecideVirement('11', 'Approved');
      const afterApprove = body();
      cmcDecideVirement('11', 'Rejected');            // already ruled on
      const stored = JSON.parse(CESTISStore.getItem('cesti_virements'));
      window.confirm = originalConfirm; window.showToast = originalToast;
      return {
        beforeHadButton: before.indexOf('Approve') !== -1,
        nowApproved: afterApprove.indexOf('Approved') !== -1,
        attributed: afterApprove.indexOf('Board Member (CMC Board)') !== -1,
        minuted: afterApprove.indexOf('Agreed at the July meeting') !== -1,
        buttonGone: afterApprove.indexOf('✓ Approve') === -1,
        storedStatus: stored[0].status,
        storedBy: stored[0].approvedBy,
        storedIntact: stored[0].total === 100000 && stored[0].project === 'Lunch top-up',
        refusedSecond: toasts.some(t => /cannot be decided twice/.test(t)),
        pendingKpi: document.getElementById('cmcVirPending').textContent
      };
    });
    ok(vir.beforeHadButton, 'a pending virement offers the Board an Approve control');
    ok(vir.nowApproved && vir.buttonGone, 'approving it settles the request and withdraws the controls');
    ok(vir.attributed, 'the ruling is attributed to the board member who made it');
    ok(vir.minuted, 'and carries the minute they typed');
    ok(vir.storedStatus === 'Approved' && /CMC Board/.test(vir.storedBy), 'the register itself records the decision, in the fields the Virement page reads');
    ok(vir.storedIntact, 'and the rest of the request is untouched');
    ok(vir.refusedSecond, 'a second ruling on the same request is refused, not silently applied');
    ok(vir.pendingKpi === '0', 'the awaiting-decision count follows the ruling');
    await page.close();
  }

  section('MegaData-Adjudication: the queue page loads clean and explains itself');
  {
    const { page, pageErrors } = await openPage('MegaData-Adjudication.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | '));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.adjqPending && MegaData.adjqDecide)), 'queue model registered');
    ok(await page.evaluate(() => /record book|migration/i.test(document.getElementById('queueHost').textContent)),
      'unconnected device: plain-language explanation, not a broken queue');
    await page.close();
  }

  section('MegaData-Admin: the device-setup page loads clean and does its three jobs');
  {
    const { page, pageErrors } = await openPage('MegaData-Admin.html');
    ok(pageErrors.length === 0, 'zero uncaught page errors — got: ' + pageErrors.join(' | '));
    ok(await page.evaluate(() => !!(window.MegaData && MegaData.validateBrokerSettings && MegaData.exportFileName && window.CESTISCore && CESTISCore.buildSnapshot && window.__adminExportBuild)),
      'admin model + legacy snapshot builder both registered');
    ok(await page.evaluate(() => /LEGACY/.test(document.getElementById('bootStatus').textContent) && /no broker set up/i.test(document.getElementById('bootStatus').textContent)),
      'status card reports plain-language LEGACY on an unconfigured device');
    const exp = await page.evaluate(async () => {
      CESTISStore.setItem('cestiSchoolFeeStudents', JSON.stringify([{ id: 'SF-smk', name: 'Smoke Export', skillArea: 'WELDING L2', tuitionFee: 100 }]));
      CESTISStore.setItem('cestisGoogleAccessToken', 'ya29.SHOULD-NEVER-EXPORT');
      const snap = window.__adminExportBuild();
      const out = {
        hasData: 'cestiSchoolFeeStudents' in snap.store,
        hasToken: 'cestisGoogleAccessToken' in snap.store,
        verifies: CESTISCore.verifySnapshot(snap).ok,
        name: MegaData.exportFileName('Smoke Device', new Date().toISOString())
      };
      CESTISStore.removeItem('cestiSchoolFeeStudents');
      CESTISStore.removeItem('cestisGoogleAccessToken');
      return out;
    });
    ok(exp.hasData && !exp.hasToken && exp.verifies, 'export bundle from the REAL store: data in, tokens OUT, checksum verifies');
    ok(/^master-snapshot\.smoke-device\.\d{4}-\d{2}-\d{2}\.json$/.test(exp.name), 'export filename follows the CLI-recognised convention');
    const cfg = await page.evaluate(async () => {
      const A = MegaData.IdbAdapter();
      await MegaData.writeBrokerConfig(A, { url: 'https://script.google.com/macros/s/smoke/exec', secret: 'smoke-secret-value-123' });
      const rd = await MegaData.readBrokerConfig(A);
      await MegaData.clearBrokerConfig(A);
      const gone = await MegaData.readBrokerConfig(A);
      return { saved: rd && rd.url, enforced: rd && rd.enforced, cleared: gone === null || gone === undefined };
    });
    ok(cfg.saved === 'https://script.google.com/macros/s/smoke/exec' && cfg.enforced === false,
      'broker config round-trips through the REAL default IndexedDB, enforced defaulting false');
    ok(cfg.cleared, 'clear removes it (device left fully legacy for every other suite)');
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
