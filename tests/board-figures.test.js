/* Real figures for the board and the regulator (owner-approved group E).

   Every figure a screen shows is compared here with an INDEPENDENT count of
   the audit's Centre (tests/fixtures/board-centre.js — made-up names, counted
   there with plain arithmetic of its own, never by the rules under test).

   1. M2 — the board's money view. The CMC board saw no fee money at all:
      the School Fee books were never among the books its page reads, and
      three widgets labelled as fees ("Fee Completion", "Fee Collection
      Status", "School Fees Details") counted certificates. Money was printed
      "D1785000". Now the board reads the fee books — read only — and shows
      this financial year's billed, collected and owed by programme, in "$".
   2. M7 — "Earlier years still owing: $X (n trainees)", beside Outstanding,
      never added into it.
   3. M8 — the Programme return on Reports.

   Run: node tests/board-figures.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const D = require('./fixtures/board-centre.js');
const F = Core.centreFigures, T = D.T;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html');
function fnOf(src, name) {
  const m = new RegExp('\\n[ \\t]*function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  const s = m.index;
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
const $ = n => F.moneyText(n);
// The Centre's store as the School Fee page leaves it.
const STORE = {
  cestiSchoolFeeStudents: JSON.stringify(D.feeStudents),
  cestiSchoolFeePayments: JSON.stringify(D.payments)
};
const FY = '2026/2027';

/* =====================================================================
   1. The rule, against the independent count
   ===================================================================== */
console.log('The fee rule (CESTISCore.centreFigures.fees) against the hand count');
const fig = F.fees(D.feeStudents, D.payments, { fy: FY });
{
  assertEq(fig.label, 'FY 2026/2027', 'the year it is about is named');
  assertEq(fig.billed, T.feesFY.billed, 'billed this year: shown ' + $(fig.billed) + ', truth ' + $(T.feesFY.billed));
  assertEq(fig.collected, T.feesFY.collected, 'collected this year: shown ' + $(fig.collected) + ', truth ' + $(T.feesFY.collected));
  assertEq(fig.owed, T.feesFY.owed, 'owed this year: shown ' + $(fig.owed) + ', truth ' + $(T.feesFY.owed));
  assertEq(fig.accounts, T.feesFY.accounts, 'accounts this year (60)');
  assertEq(fig.debtors, T.feesFY.debtors, 'trainees owing this year (44)');
  assertEq(T.feesFY.billed, 1785000, '(the audit measured $1,785,000 billed)');
  assertEq(T.feesFY.collected, 909000, '(and $909,000 collected)');
  assertEq(T.feesFY.owed, 876000, '(and $876,000 owed)');
  Object.keys(T.feesFY.byProgramme).forEach(name => {
    const t = T.feesFY.byProgramme[name], r = fig.byProgramme.find(p => p.programme === name) || {};
    assert(r.billed === t.billed && r.collected === t.collected && r.owed === t.owed && r.debtors === t.debtors && r.accounts === t.accounts,
      name + ': billed ' + $(r.billed) + '/' + $(t.billed) + ', collected ' + $(r.collected) + '/' + $(t.collected) +
      ', owed ' + $(r.owed) + '/' + $(t.owed) + ', owing ' + r.debtors + '/' + t.debtors + ' (shown/truth)');
  });
  assertEq(fig.byProgramme.length, 3, 'only this year\'s programmes are listed (Cosmetology\'s intake was last year)');
  assertEq(fig.earlier.owed, T.feesEarlier.owed, 'earlier years still owing: shown ' + $(fig.earlier.owed) + ', truth ' + $(T.feesEarlier.owed));
  assertEq(fig.earlier.trainees, T.feesEarlier.trainees, 'by ' + T.feesEarlier.trainees + ' trainees');
  assertEq(T.feesEarlier.owed, 140000, '(the audit measured $140,000 from 10 graduates)');
  assert(fig.earlier.byProgramme.length === 1 && fig.earlier.byProgramme[0].programme === 'Cosmetology' &&
    fig.earlier.byProgramme[0].owed === 140000 && fig.earlier.byProgramme[0].trainees === 10, 'all of it Cosmetology\'s');
  assert(fig.owed + fig.earlier.owed === 1016000 && fig.owed === 876000, 'earlier years are NOT added into this year\'s Owed (876,000, not 1,016,000)');
  assertEq(F.earlierText(fig.earlier), 'Earlier years still owing: $140,000 (10 trainees)', 'the line, as every screen says it');
  assertEq(F.earlierText({ owed: 0, trainees: 0 }), 'Earlier years still owing: nothing', 'and when nothing is owed');
  assertEq(F.earlierText({ owed: 5000, trainees: 1 }), 'Earlier years still owing: $5,000 (1 trainee)', 'one trainee, singular');
}

console.log('The rule in the corners the Centre\'s own records have');
{
  const acc = [
    { id: 'A', name: 'A', skillArea: 'Welding', tuitionFee: 1000, enrollmentDate: '2026-05-01' },     // this year, part paid
    { id: 'B', name: 'B', skillArea: 'Welding', tuitionFee: 1000, enrollmentDate: '' , createdAt: '' }, // no date at all: every year
    { id: 'C', name: 'C', skillArea: 'Welding', tuitionFee: 1000, enrollmentDate: '2025-06-01' },     // last year, pays THIS year
    { id: 'E', name: 'E', skillArea: 'Welding', tuitionFee: 0, enrollmentDate: '2026-05-01' },        // not priced
    { id: 'G', name: 'G', skillArea: 'Welding', tuitionFee: 1000, enrollmentDate: '2026-05-01' },     // overpaid
    { id: 'H', name: 'H', skillArea: 'Welding', tuitionFee: 1000, enrollmentDate: '2027-05-01' },     // next year's intake
    { id: 'I', name: 'I', skillArea: '02. Welding', tuitionFee: 1000, createdAt: '2026-06-01T10:00:00Z' } // created date stands in; another spelling
  ];
  const pay = [
    { id: 'p1', studentId: 'A', amount: 400, date: '2026-06-01' },
    { id: 'p2', studentId: 'C', amount: 300, date: '2026-07-01', skillArea: 'Welding' },
    { id: 'p3', studentId: 'G', amount: 1200, date: '2026-07-01' },
    { id: 'p4', studentId: 'A', amount: 100, date: '2025-12-01' },                                     // last year's receipt
    { id: 'p5', studentId: 'X', amount: 50, date: '', skillArea: 'Plumbing' }                          // undated, no account: every year
  ];
  const r = F.fees(acc, pay, { fy: FY });
  assertEq(r.accounts, 5, 'this year: A, the undated B, the unpriced E, G and I (created date) — not last year\'s C, not next year\'s H');
  assertEq(r.billed, 4000, 'billed: their tuition');
  assertEq(r.collected, 400 + 300 + 1200 + 50, 'collected: receipts dated this year (C\'s too) and the undated one — not last year\'s');
  assertEq(r.owed, (1000 - 500) + 1000 + 0 + (1000 - 1200) + 1000, 'owed: balances as at today, the School Fee page\'s total');
  assertEq(r.unpriced, 1, 'an account with no fee and nothing paid is unpriced, not "owing nothing"');
  assertEq(r.debtors, 3, 'trainees owing: A, B and I');
  assertEq(r.byProgramme.length, 2, 'one row per programme however it is spelled, and the undated receipt under its own');
  assertEq(r.earlier.owed, 700, 'earlier years: C still owes 700 after paying 300 this year');
  assertEq(r.earlier.trainees, 1, 'one earlier-year trainee');
  const none = F.fees([], [], { fy: FY });
  assert(none.billed === 0 && none.owed === 0 && none.earlier.trainees === 0 && none.byProgramme.length === 0, 'no records: zeros, not errors');
  assertEq(F.fees(acc, pay, { now: '2026-10-28T12:00:00' }).fy, '2026/2027', 'the present year by default');
}

console.log('The fee books as the School Fee page reads them (deleted records left out)');
{
  const store = Object.assign({}, STORE, {
    cestiSchoolFeeDeletedPaymentIds: JSON.stringify([D.payments[0].id]),
    cestiSchoolFeeDeletedLmsIds: JSON.stringify([D.feeStudents[1].id])
  });
  const b = F.feeBooks(k => store[k]);
  assertEq(b.payments.length, D.payments.length - 1, 'a deleted payment is not counted');
  assertEq(b.accounts.length, D.feeStudents.length - 1, 'a deleted account is not counted');
  const all = { cestiSchoolFeeStudents: STORE.cestiSchoolFeeStudents, cestiSchoolFeeDeletedLmsIds: JSON.stringify(D.feeStudents.map(f => f.id)) };
  assertEq(F.feeBooks(k => all[k]).accounts.length, D.feeStudents.length, 'a sweep that would remove EVERY account is a fault and is not applied (the page\'s own guard)');
  assertEq(F.feeBooks(() => 'not json').accounts.length, 0, 'unreadable books are empty, not a crash');
}

console.log('Money is written "$1,785,000" (it was "D1785000")');
{
  assertEq($(1785000), '$1,785,000', 'thousands separated, no stray decimals');
  assertEq($(1234.5), '$1,234.50', 'cents when there are some');
  assertEq($(-200), '-$200', 'a credit balance');
  assertEq($(0.005), '$0.01', 'rounded to the cent');
  assertEq($(null), '$0', 'nothing is $0');
  const cmcMoney = fnOf(INDEX, 'cmcMoney');
  assert(!/'D'/.test(cmcMoney) && /centreFigures\.moneyText/.test(cmcMoney), 'the board\'s money format is the one rule, with no "D"');
}

/* =====================================================================
   2. The board reads the fee books, and never writes them
   ===================================================================== */
console.log('The board reaches the fee books the way it reaches the other books — read only');
const cmc = require('../cmc-portal.js');
{
  const fees = cmc.CMC_SHARED_FILES.find(s => s.key === 'fees');
  assert(fees && fees.file === 'CESTIS_School_Fees.json', 'the School Fee page\'s own file is among the board\'s reads');
  const reader = fnOf(INDEX, 'cmcStartOversightReader');
  assert(/CMC_SHARED_FILES/.test(reader) && /reads: reads/.test(reader), 'the reader pulls every key of every shared book it lists');
  const writes = /writes:\s*\[([^\]]*)\]/.exec(reader);
  assert(writes && writes[1].trim() === "'cesti_virements'", 'the board writes ONE key, the virement register (got ' + (writes && writes[1]) + ')');
  cmc.CMC_FEE_KEYS.forEach(k => assert(writes && writes[1].indexOf(k) === -1, 'and never ' + k));
  const ownKeys = /keys:\s*\[([^\]]*)\]/.exec(reader);
  assert(ownKeys && ownKeys[1].trim() === "'cestis_cmc_rulings'", 'the only key it owns is its own minute book');
  // Nothing on the board's screens writes a fee key.
  const portal = read('cmc-portal.js');
  const cmcBlock = INDEX.slice(INDEX.indexOf('// ============================== CMC DASHBOARD'), INDEX.indexOf('// ============================== CERTIFICATE CHECK'));
  assert(cmcBlock.length > 10000, '(the board\'s block of index.html is found)');
  [['cmc-portal.js', portal], ['the board\'s block of index.html', cmcBlock]].forEach(([name, src]) => {
    assert(!/setItem\(\s*['"]cestiSchoolFee/.test(src) && !/guardedSet\([^)]*cestiSchoolFee/.test(src), name + ' never writes a fee key');
    assert(!/cestiSchoolFee[A-Za-z]*['"]\s*,\s*JSON\.stringify/.test(src), name + ' never stores fee data');
  });
  assert(/S\.getItem\(k\)/.test(fnOf(portal, 'feeFiguresNow')) && !/setItem/.test(fnOf(portal, 'feeFiguresNow')), 'the portal reads the fee books with getItem only');

  // The LMS-to-fee mirror runs after every save, whoever is signed in, and
  // mints or edits fee records. A board member's session must do neither.
  const mirror = fnOf(INDEX, 'syncStudentsToSchoolFee');
  function runMirror(role) {
    const fee = [{ id: 'F1', lmsId: 'S1', name: 'Ann Brown', skillArea: 'Welding', tuitionFee: 1000 }];
    const writes = [];
    const sb = {
      currentRole: role, CESTISCore: Core, console, JSON, Array, Object, String, Date, Set,
      students: [{ id: 'S1', name: 'Ann Brown', course: 'Welding', dob: '2001-02-03', lastModified: '2026-10-01T00:00:00Z' },
                 { id: 'S2', name: 'New Trainee', course: 'Welding' }],
      studentProfiles: {}, localDateStr: () => '2026-10-28', window: {},
      CESTISStore: { getItem: k => (k === 'cestiSchoolFeeStudents' ? JSON.stringify(fee) : null), setItem: (k, v) => writes.push(k) },
      readArr: k => { try { return JSON.parse(sb.CESTISStore.getItem(k) || '[]'); } catch (e) { return []; } },
      broadcastStudentsToFeeFrames() {}
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(mirror + '\nsyncStudentsToSchoolFee();', sb);
    return writes;
  }
  assertEq(runMirror('cmc').length, 0, 'a board session\'s save mints and edits no fee record');
  assert(runMirror('admin').indexOf('cestiSchoolFeeStudents') !== -1, '(an administrator\'s save still mirrors new trainees, as before)');
}

console.log('What the board is shown, against the hand count');
{
  const r = cmc.cmcFeeFigures(STORE, { fy: FY });
  assertEq(r.figures.billed, T.feesFY.billed, 'cmcFeeFigures: billed');
  assertEq(r.figures.collected, T.feesFY.collected, 'cmcFeeFigures: collected');
  assertEq(r.figures.owed, T.feesFY.owed, 'cmcFeeFigures: owed');
  assertEq(r.figures.earlier.owed, T.feesEarlier.owed, 'cmcFeeFigures: earlier years');
  assertEq(r.accounts.length, 90, 'and the accounts behind them');

  // The board's dashboard and Financial Overview, rendered by index.html's own functions.
  const sb = { CESTISCore: Core, cmcData: { feeFigures: r.figures, fees: r.accounts }, document: { getElementById: () => null }, console };
  vm.createContext(sb);
  vm.runInContext(['cmcMoney', 'cmcEsc', 'cmcFeeFigures', 'cmcFeeTrio', 'cmcFeeKpiInner', 'cmcFinFeeKpiInner', 'cmcBuildFeeTable',
    'cmcBuildFeesDetail', 'cmcFeeChartData', 'cmcEmptyNote', 'cmcDetailEmpty'].map(n => fnOf(INDEX, n)).join('\n'), sb);
  const kpi = sb.cmcFeeKpiInner();
  ['$1,785,000', '$909,000', '$876,000'].forEach(v => assert(kpi.indexOf(v) !== -1, 'dashboard card shows ' + v));
  assert(/School Fees — FY 2026\/2027/.test(kpi), 'dashboard card names the year');
  assert(kpi.indexOf('Earlier years still owing: $140,000 (10 trainees) — not included in Owed') !== -1, 'and the earlier years beside Owed, not in it');
  assert(/44 of 60 trainees enrolled in FY 2026\/2027 still owe/.test(kpi), 'with how many trainees owe, of how many');
  const fin = sb.cmcFinFeeKpiInner();
  assert(/School Fees Owed — FY 2026\/2027/.test(fin) && fin.indexOf('$876,000') !== -1 && fin.indexOf('$909,000 collected of $1,785,000 billed') !== -1,
    'Financial Overview card: owed, with what it is owed out of (was "Fee Completion 67%")');
  const table = sb.cmcBuildFeeTable();
  Object.keys(T.feesFY.byProgramme).forEach(name => {
    const t = T.feesFY.byProgramme[name];
    const row = new RegExp('<strong>' + name.replace('&', '&amp;') + '</strong></td><td[^>]*>' + $(t.billed).replace('$', '\\$') + '</td><td[^>]*>' +
      $(t.collected).replace('$', '\\$') + '</td><td[^>]*>' + $(t.owed).replace('$', '\\$') + '</td><td[^>]*>' + t.debtors + ' of ' + t.accounts + '</td>');
    assert(row.test(table), 'fee table row ' + name + ': ' + $(t.billed) + ' / ' + $(t.collected) + ' / ' + $(t.owed) + ', ' + t.debtors + ' of ' + t.accounts);
  });
  assert(/All programmes<\/td><td[^>]*>\$1,785,000<\/td><td[^>]*>\$909,000<\/td><td[^>]*>\$876,000<\/td><td[^>]*>44 of 60</.test(table), 'and the totals');
  assert(/Cosmetology<\/td><td[^>]*>\$140,000<\/td><td[^>]*>10</.test(table), 'the earlier years, by programme, in a table of their own');
  const detail = sb.cmcBuildFeesDetail();
  assert(detail.indexOf('$1,785,000') !== -1 && detail.indexOf('$140,000') !== -1 && !/GPA|Stage/.test(detail), '"School Fees" details are money — no stages, no GPA');
  const chart = sb.cmcFeeChartData();
  assert(chart.data[0] === 909000 && chart.data[1] === 876000 && chart.labels[0] === 'Collected $909,000' && chart.labels[1] === 'Owed $876,000',
    'the fees doughnut is collected and owed money (was certified vs everyone else)');
  sb.cmcData.feeFigures = null;
  assert(/No fee records yet/.test(sb.cmcFeeKpiInner()) && /nothing recorded yet/i.test(sb.cmcBuildFeeTable()), 'no fee books yet: said plainly');
}

console.log('The three widgets that counted certificates under a fees label are gone');
{
  const build = fnOf(INDEX, 'buildCmcPages');
  assert(!/cmc-kpi-label">Fee Completion/.test(build), 'no "Fee Completion" card');
  assert(!/>Fee Collection Status</.test(build), 'no "Fee Collection Status" chart title');
  assert(/onclick="cmcShowDetail\(\\'completion\\'\)"><div class="cmc-kpi-icon">🏆<\/div>/.test(build), 'the Completion card opens the completion details');
  assert(/id="cmcKpiFeesCard" onclick="cmcShowDetail\(\\'fees\\'\)"/.test(build), 'a School Fees card opens the fees details');
  const charts = fnOf(INDEX, 'cmcRenderCharts'), upd = fnOf(INDEX, 'cmcUpdateDriveCharts');
  [['cmcRenderCharts', charts], ['cmcUpdateDriveCharts', upd]].forEach(([n, src]) => {
    const fees = src.slice(src.indexOf('cmcChartFees') >= 0 ? src.indexOf('cmcChartFees') : src.indexOf('cmcChartInstances.fees'));
    assert(/cmcFeeChartData\(\)/.test(fees.slice(0, 600)) && !/stage === 'certified'/.test(fees.slice(0, 600)), n + ': the fees chart draws money, not certificates');
  });
  const show = fnOf(INDEX, 'cmcShowDetail');
  assert(/case 'fees':[\s\S]{0,160}cmcBuildFeesDetail\(\)/.test(show) && /case 'completion':[\s\S]{0,160}cmcBuildCompletionDetail\(\)/.test(show),
    'fees details are the money; the roster by stage is "Completion"');
  assert(/cmcUpdateFeeKpis\(\)/.test(fnOf(INDEX, 'cmcUpdateLocalKpis')), 'fee figures repaint when the books arrive');
  assert(/C\.cmcFeeFigures\(map\)/.test(fnOf(INDEX, 'cmcLoadOversightData')), 'and are read with the other books');
  // Programme Breakdown's completion is the one rule, not certified over everyone.
  assert(/CESTISCore\.centreFigures\.completion\(_roll, _fig\.endedOf\)/.test(build) && !/p\.certified\/p\.enrolled/.test(build),
    'Programme Breakdown: completion over ended intakes, with its denominator');
}

console.log('The board\'s portal shows the same money (cmc-portal.js, rendered)');
{
  const els = {};
  const store = Object.assign({}, STORE);
  const sb = {
    console, JSON, Math, Object, Array, String, Number, Date, parseFloat, parseInt, isFinite,
    CESTISCore: Core, currentRole: 'cmc', students: D.students, userAccounts: [], instructorData: [],
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: () => { throw new Error('the portal wrote to the store'); } },
    document: { getElementById: id => (els[id] = els[id] || { innerHTML: '', setAttribute() {}, getAttribute() { return null; } }) }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read('cmc-portal.js').replace(/\}\)\(typeof window !== 'undefined'[\s\S]*$/, '})(window);'), sb);
  sb.cmcPortalOnShow();
  const html = els.cmcPortalPanel.innerHTML;
  assert(/School Fees — FY 2026\/2027/.test(html), 'a School Fees card for this financial year');
  Object.keys(T.feesFY.byProgramme).forEach(name => {
    const t = T.feesFY.byProgramme[name];
    assert(html.indexOf('<td>' + name.replace('&', '&amp;') + '</td><td style="text-align:right;white-space:nowrap;">' + $(t.billed) + '</td><td style="text-align:right;white-space:nowrap;">' +
      $(t.collected) + '</td><td style="text-align:right;white-space:nowrap;">' + $(t.owed) + '</td>') !== -1, 'portal row ' + name + ' = the hand count');
  });
  assert(html.indexOf('Earlier years still owing: $140,000 (10 trainees)') !== -1 && html.indexOf('not included in Owed above') !== -1, 'with the earlier years beside it');
  assert(/🔒 View only/.test(html.slice(html.indexOf('cmcp-fees'))), 'marked view-only');
}

/* =====================================================================
   3. M7 — earlier years beside Outstanding, never in it
   ===================================================================== */
console.log('School Fee: "Earlier years still owing" under Total Outstanding');
['School.Fee.html', 'Offline System/School.Fee.html'].forEach(page => {
  const FEE = read(page);
  const card = FEE.slice(FEE.indexOf('id="totalOutstanding"'), FEE.indexOf('id="totalOutstanding"') + 900);
  assert(/id="totalEarlierYears"/.test(card) && card.indexOf('id="totalEarlierYears"') < card.indexOf('</div>\n            </div>'),
    page + ': the line sits inside the Total Outstanding card');
  const upd = fnOf(FEE, 'updateDashboard');
  assert(/feeShowEarlierYears\(\)/.test(upd), page + ': every dashboard refresh fills it');
  const els = { totalEarlierYears: { textContent: '', style: { display: 'none' } } };
  const sb = { CESTISCore: Core, students: D.feeStudents, payments: D.payments, feeScopeMode: 'year',
    feeActiveQuarter: () => ({ fy: FY, q: 3 }), document: { getElementById: id => els[id] || null } };
  vm.createContext(sb);
  vm.runInContext(fnOf(FEE, 'feeShowEarlierYears'), sb);
  sb.feeShowEarlierYears();
  assertEq(els.totalEarlierYears.textContent, 'Earlier years still owing: $140,000 (10 trainees) · not included above',
    page + ': shown "$140,000 (10 trainees)", truth ' + $(T.feesEarlier.owed) + ' (' + T.feesEarlier.trainees + ')');
  assertEq(els.totalEarlierYears.style.display, '', page + ': and it is visible');
  sb.feeScopeMode = 'quarter'; sb.feeShowEarlierYears();
  assert(/\$140,000 \(10 trainees\)/.test(els.totalEarlierYears.textContent), page + ': a single quarter of the year shows it too');
  sb.feeScopeMode = 'all'; sb.feeShowEarlierYears();
  assertEq(els.totalEarlierYears.style.display, 'none', page + ': "every year" already includes them, so the line is not repeated');
  sb.feeScopeMode = 'year'; sb.feeActiveQuarter = () => ({ fy: '2025/2026', q: 1 }); sb.feeShowEarlierYears();
  assertEq(els.totalEarlierYears.textContent, 'Earlier years still owing: nothing · not included above', page + ': stepping back to last year, nothing is older still owing');
});

console.log('The administrator\'s dashboard: School Fees, with the earlier years beside Outstanding');
{
  const sb = { CESTISCore: Core, CESTISStore: { getItem: k => (k in STORE ? STORE[k] : null), setItem: () => { throw new Error('the dashboard wrote to the fee books'); } },
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    document: { getElementById: () => null } };
  vm.createContext(sb);
  vm.runInContext(fnOf(INDEX, 'dashFeesCardInner'), sb);
  const html = sb.dashFeesCardInner();
  assert(/School Fees — FY 2026\/2027/.test(html), 'named for this financial year');
  assert(/Billed<\/div><div class="dash-fees-v">\$1,785,000</.test(html), 'Billed: shown $1,785,000, truth ' + $(T.feesFY.billed));
  assert(/Collected<\/div><div class="dash-fees-v"[^>]*>\$909,000</.test(html), 'Collected: shown $909,000, truth ' + $(T.feesFY.collected));
  assert(/Outstanding<\/div><div class="dash-fees-v"[^>]*>\$876,000<\/div><div class="dash-fees-earlier" id="dashFeesEarlier">Earlier years still owing: \$140,000 \(10 trainees\)</.test(html),
    'Outstanding $876,000 (truth ' + $(T.feesFY.owed) + '), with "Earlier years still owing: $140,000 (10 trainees)" right under it');
  assert(/Earlier years are not included in Outstanding/.test(html), 'and says the earlier years are not in it');
  assert(/44 of 60 still owe/.test(html), 'how many owe, of how many (44 of 60)');
  const build = fnOf(INDEX, 'buildAdminPages');
  assert(/<div class="card dash-fees-card" id="dashFeesCard">\$\{dashFeesCardInner\(\)\}<\/div>/.test(build), 'drawn on the administrator\'s dashboard');
  assert(/refreshDashboardFees\(\)/.test(fnOf(INDEX, 'refreshDashboardStudentTotals')) && /pageId === 'dashboard'[^\n]*refreshDashboardFees\(\)/.test(fnOf(INDEX, 'showPage')),
    'and kept current: when the roll changes and whenever the dashboard is opened');
}

/* =====================================================================
   4. M8 — the Programme return
   ===================================================================== */
// The register exactly as the attendance page writes it.
const REG = [];
{ const idx = {}; D.att.forEach(r => Core.attendance.mark(REG, { studentId: r.studentId, date: r.date, status: r.status, by: 'INS', byName: 'Instructor', source: 'register', at: r.date + 'T16:00:00.000Z' }, idx)); }
const endedOf = s => { const c = Object.values(D.CENTRES).find(x => x.name === s.course); return !!(c && c.end && c.end < T.TODAY); };
const PROGS = Object.keys(D.CENTRES).map(k => D.CENTRES[k].name);
function compareRow(where, row, t) {
  const pairs = [['applicants', row.applicants, t.applicants], ['enrolled', row.enrolled, t.enrolled], ['active', row.active, t.active],
    ['completed', row.completed, t.completed], ['certified', row.certified, t.certified], ['NYC', row.nyc, t.nyc], ['dropouts', row.dropouts, t.dropouts],
    ['completion %', row.completion.rate, t.completion.rate], ['completion of', row.completion.of, t.completion.of],
    ['attendance %', row.attendance.rate, t.attendance.rate], ['attendance of', row.attendance.of, t.attendance.of],
    ['pass %', row.pass.rate, t.pass.rate], ['marked', row.pass.of, t.pass.of], ['awaiting', row.pass.awaiting, t.pass.awaiting],
    ['billed', row.fees.billed, t.billed], ['collected', row.fees.collected, t.collected], ['owed', row.fees.owed, t.owed]];
  const bad = pairs.filter(p => p[1] !== p[2]);
  assert(!bad.length, where + ': ' + (bad.length ? bad.map(p => p[0] + ' shown ' + p[1] + ', truth ' + p[2]).join('; ')
    : 'enrolled ' + row.enrolled + ', active ' + row.active + ', completion ' + row.completion.rate + ', attendance ' + row.attendance.rate +
      ', pass ' + row.pass.rate + ' of ' + row.pass.of + ', ' + $(row.fees.billed) + ' / ' + $(row.fees.collected) + ' / ' + $(row.fees.owed) + ' — all = hand count'));
}
function sumGroups(tr, names, field) {
  const out = {};
  names.forEach(n => { const g = tr[n][field]; Object.keys(g).forEach(k => { const o = out[k] = out[k] || {}; Object.keys(g[k]).forEach(c => { o[c] = (o[c] || 0) + g[k][c]; }); }); });
  return out;
}
function compareGroups(where, shown, truth) {
  const keys = Object.keys(truth);
  assertEq(shown.length, keys.length, where + ': one row per group (' + keys.join(', ') + ')');
  keys.forEach(k => {
    const s = shown.find(g => g.group === k) || {};
    const bad = ['applicants', 'enrolled', 'active', 'completed', 'certified', 'nyc', 'dropouts'].filter(c => s[c] !== truth[k][c]);
    assert(!bad.length, where + ' "' + k + '": ' + (bad.length ? bad.map(c => c + ' shown ' + s[c] + ', truth ' + truth[k][c]).join('; ') : 'enrolled ' + s.enrolled + ', applicants ' + s.applicants + ' = hand count'));
  });
}

console.log('The return\'s rule (CESTISCore.centreFigures.programmeReturn) against the hand count');
[['all dates', '', '', T.returnAll, PROGS, T.TODAY], ['Q3 Oct–Dec 2026', '2026-10-01', '2026-12-31', T.returnQ3, PROGS, T.TODAY],
 ['Q2 Jul–Sep 2026', '2026-07-01', '2026-09-30', T.returnQ2, PROGS, '2026-09-30']].forEach(([name, from, to, tr, progs]) => {
  const r = F.programmeReturn({ intakes: progs.map(p => ({ label: p, roll: D.students.filter(s => s.course === p) })),
    register: REG, results: D.results, feeAccounts: D.feeStudents, payments: D.payments, endedOf, from, to, asAt: T.TODAY });
  r.rows.forEach(row => compareRow(name + ' · ' + row.intake, row, tr[row.intake]));
  compareGroups(name + ' · by gender', r.genders, sumGroups(tr, progs, 'genders'));
  compareGroups(name + ' · by age band', r.ages, sumGroups(tr, progs, 'ages'));
  assertEq(r.total.enrolled, progs.reduce((a, p) => a + tr[p].enrolled, 0), name + ' · total enrolled');
  assertEq(r.total.fees.collected, progs.reduce((a, p) => a + tr[p].collected, 0), name + ' · total collected ' + $(r.total.fees.collected));
  assertEq(r.unmatchedAccounts, 0, name + ' · every fee account belongs to a trainee on the return');
});
{
  const r = F.programmeReturn({ intakes: [{ label: 'X', roll: [{ id: 'a', stage: 'training', gender: 'F' }, { id: 'b', stage: 'training', gender: ' ' },
    { id: 'c', stage: 'testing', gender: 'Other' }, { id: 'd', stage: 'training', gender: 'male', dob: 'not a date' }] }], asAt: '2026-10-28' });
  assertEq(r.genders.map(g => g.group).join(','), 'Female,Male,Other,Not recorded', 'gender as recorded (F → Female), and "Not recorded" for a blank — never guessed');
  assertEq(r.ages.map(g => g.group + ':' + (g.enrolled + g.applicants)).join(','), 'Not recorded:4', 'no usable date of birth: "Not recorded"');
  assert(r.rows[0].attendance.rate === null && r.rows[0].pass.rate === null && r.rows[0].completion.rate === null, 'nothing to divide: no rate (not 0%)');
}

console.log('Reports: the Programme return as the administrator sees and downloads it (index.html)');
{
  const els = {};
  const skillAreas = Core.freshSkillAreas();
  const byId = {}; Object.keys(D.CENTRES).forEach(k => { byId[D.CENTRES[k].id] = D.CENTRES[k]; });
  skillAreas.forEach(a => { const c = byId[a.id]; if (c && c.start) { a.startDate = c.start; a.endDate = c.end; } });
  const sb = {
    CESTISCore: Core, console, JSON, Math, Object, Array, String, Number, Date, parseFloat, parseInt, isFinite, Map, Set,
    students: D.students, skillAreas, examResults: D.results, attendanceRegister: REG, attendanceRecords: [],
    instructorData: [], userAccounts: [],
    CESTISStore: { getItem: k => (k in STORE ? STORE[k] : null), setItem() { throw new Error('the return wrote to the store'); } },
    localDateStr: () => T.TODAY, studentCourseStatus: s => (endedOf(s) ? 'ended' : 'active'),
    escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    escapeAttr: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;'),
    showToast() {},
    document: { getElementById: id => (els[id] = els[id] || { innerHTML: '', value: '' }) }
  };
  sb.window = sb;
  vm.createContext(sb);
  const block = INDEX.slice(INDEX.indexOf('/* ============================== THE PROGRAMME RETURN (audit M8)'), INDEX.indexOf('/* Redraw every panel on Reports & Analytics.'));
  assert(block.length > 5000, '(the Programme return block of index.html is found)');
  vm.runInContext(['centreRollTally', 'reportProgrammeRolls', 'attendancePctByStudent', 'centreFigureSet'].map(n => fnOf(INDEX, n)).join('\n') + '\n' + block, sb);
  const strip = s => String(s).replace(/^\d+\.\s*/, '');

  // The period choices and the default.
  const periods = sb.programmeReturnPeriods(T.TODAY);
  assertEq(sb.programmeReturnDefaultPeriod(), 'q:2026/2027:3', 'the quarter today falls in is the default');
  assert(periods[0].value === 'q:2026/2027:3' && /Q3 · Oct–Dec 2026 \(to date\)/.test(periods[0].label), 'and comes first: "Q3 · Oct–Dec 2026 (to date)"');
  assert(periods.some(p => p.value === 'fy:2026/2027') && periods.some(p => p.value === 'q:2025/2026:3') && periods[periods.length - 1].value === 'all',
    'every quarter and whole year back to the earliest intake, and "All dates"');
  assert(!periods.some(p => p.value === 'q:2026/2027:4'), 'no quarter that has not started');

  // Default: all intakes, this quarter.
  sb.renderProgrammeReturn();
  assertEq(els.prHeading.innerHTML.split('<div')[0], 'Programme return — All intakes — 1 Oct – 31 Dec 2026 (Q3, FY 2026/2027), to date', 'a plain heading names the intake and the period');
  assert(/Figures as at 28 Oct 2026\./.test(els.prHeading.innerHTML), 'and the day the figures are as at');
  assert(/<option value="all">All intakes<\/option>/.test(els.prIntake.innerHTML) && /<option value="3"[^>]*>03\. Cosmetology \(Sep 2025 – Jul 2026\)<\/option>/.test(els.prIntake.innerHTML),
    'the intake filter lists each intake with its dates');
  assert(/<optgroup label="FY 2026\/2027">/.test(els.prPeriod.innerHTML) && /value="q:2026\/2027:3" selected/.test(els.prPeriod.innerHTML), 'the period filter, by financial year, with this quarter chosen');
  let d = sb.programmeReturnData();
  assertEq(d.r.rows.length, 4, 'this quarter: the four intakes that ran in it');
  assert(d.left.length === 1 && /Cosmetology \(Sep 2025 – Jul 2026\)/.test(d.left[0]), 'Cosmetology (ended July) is left out — and named');
  d.r.rows.forEach(row => compareRow('on screen, Q3 · ' + strip(row.intake), row, T.returnQ3[strip(row.intake)]));
  const body = els.prBody.innerHTML;
  assert(/80%<span class="pr-of">of 25 active<\/span>/.test(body) && /74%<span class="pr-of">of 31 marked · 12 awaiting marking<\/span>/.test(body),
    'Welding: attendance 80% of 25 active, pass 74% of 31 marked · 12 awaiting (hand count: ' + T.returnQ3['Welding & Fabrication'].attendance.rate + '%, ' + T.returnQ3['Welding & Fabrication'].pass.rate + '%)');
  assert(/\$271,000/.test(body) && /\$304,000<span class="pr-of">18 owing/.test(body), 'Welding: $271,000 collected in the quarter, $304,000 owed (18 owing)');
  assert(/class="pr-section">Trainees</.test(body) && /class="pr-section">Attendance, tests and fees</.test(body), 'on screen: the trainees, then attendance, tests and fees');
  assert(/class="pr-section">By gender</.test(body) && /class="pr-section">By age band \(as at 28 Oct 2026\)</.test(body), 'breakdowns by gender and by age band');
  assert(/<td>Not recorded<\/td>/.test(body), '"Not recorded" is its own row');
  assert(/Not on this return \(did not run in this period\): 03\. Cosmetology/.test(body), 'the left-out intake is named under the table');

  // All dates: all five.
  sb.programmeReturnChoose('period', 'all');
  d = sb.programmeReturnData();
  assertEq(d.r.rows.length, 5, 'all dates: every intake');
  d.r.rows.forEach(row => compareRow('on screen, all dates · ' + strip(row.intake), row, T.returnAll[strip(row.intake)]));
  assert(/Programme return — All intakes — all dates/.test(els.prHeading.innerHTML), 'heading: all dates');

  // One intake.
  sb.programmeReturnChoose('intake', '3');
  sb.programmeReturnChoose('period', 'q:2026/2027:2');
  d = sb.programmeReturnData();
  assert(d.r.rows.length === 1 && strip(d.r.rows[0].intake) === 'Cosmetology', 'one intake chosen: just that one');
  compareRow('on screen, Q2 · Cosmetology', d.r.rows[0], T.returnQ2.Cosmetology);
  assert(/Programme return — 03\. Cosmetology \(Sep 2025 – Jul 2026\) — 1 Jul – 30 Sep 2026 \(Q2, FY 2026\/2027\)$/.test(els.prHeading.innerHTML.split('<div')[0]), 'heading names the intake and the quarter');

  // The CSV.
  sb.programmeReturnChoose('intake', 'all');
  sb.programmeReturnChoose('period', 'q:2026/2027:3');
  d = sb.programmeReturnData();
  const csv = sb.programmeReturnCsv(d).split('\r\n');
  assertEq(csv[0], 'Programme return', 'CSV: titled');
  assertEq(csv[1], 'Intake,All intakes', 'CSV: the intake');
  assertEq(csv[2], 'Period,"1 Oct – 31 Dec 2026 (Q3, FY 2026/2027), to date"', 'CSV: the period');
  assertEq(csv[3], 'Figures as at,28 Oct 2026', 'CSV: as at');
  const hdr = csv[6].split(',');
  assert(hdr[0] === 'Programme / intake' && hdr.indexOf('Attendance over (active trainees with register marks)') !== -1 && hdr.indexOf('Marked test results') !== -1 &&
    hdr.indexOf('Completion over (admitted trainees of an ended intake)') !== -1, 'CSV: each rate has its denominator in a column of its own');
  const w = csv.find(l => /^01\. Welding/.test(l)).split(',');
  const col = name => w[hdr.indexOf(name)];
  const tw = T.returnQ3['Welding & Fabrication'];
  assert(col('Enrolled') === String(tw.enrolled) && col('Attendance %') === String(tw.attendance.rate) && col('Attendance over (active trainees with register marks)') === String(tw.attendance.of) &&
    col('Test pass rate %') === String(tw.pass.rate) && col('Marked test results') === String(tw.pass.of) && col('Awaiting marking') === String(tw.pass.awaiting) &&
    col('Fees billed (JMD)') === String(tw.billed) && col('Fees collected in period (JMD)') === String(tw.collected) && col('Fees owed as at today (JMD)') === String(tw.owed),
    'CSV Welding row = hand count: ' + [tw.enrolled, tw.attendance.rate + '% of ' + tw.attendance.of, tw.pass.rate + '% of ' + tw.pass.of, tw.billed, tw.collected, tw.owed].join(' / '));
  assert(csv.some(l => l === 'By gender,Applicants,Enrolled,Active (in training),Completed,Certified,Not Yet Competent,Incomplete / dropouts') &&
    csv.some(l => /^Not recorded,/.test(l)), 'CSV: the gender breakdown, "Not recorded" included');
  assert(csv.some(l => /^By age band \(as at 28 Oct 2026\),/.test(l)), 'CSV: the age-band breakdown');
  assertEq(sb.programmeReturnFileName(d, 'csv'), 'programme-return_all-intakes_FY2026-2027-Q3.csv', 'a file name that says what it is');
  const evil = sb.programmeReturnCsv(Object.assign({}, d, { intakeLabel: '=HYPERLINK("x")' })).split('\r\n')[1];
  assertEq(evil, 'Intake,"\'=HYPERLINK(""x"")"', 'a cell that would run as a spreadsheet formula is made text');

  // The PDF, made with the Centre's own copy of jsPDF.
  sb.window.jspdf = require('../vendor/jspdf-2.5.1.umd.min.js');
  const pdf = sb.programmeReturnPdf(d).output();
  assert(/\(Programme return\) Tj/.test(pdf), 'PDF: titled');
  assert(pdf.indexOf('(All intakes - 1 Oct - 31 Dec 2026 \\(Q3, FY 2026/2027\\), to date) Tj') !== -1, 'PDF: the plain heading (intake and period)');
  ['($271,000) Tj', '(80% of 25 active) Tj', '($304,000 \\(18 owing\\)) Tj', '(Not recorded) Tj', '(18-24) Tj'].forEach(t =>
    assert(pdf.indexOf(t) !== -1, 'PDF shows ' + t.replace(/\\/g, '').replace(/ Tj$/, '')));
  assert(!/\(- no /.test(pdf), 'PDF: a rate with nothing to divide is written as its reason, not as "- ..."');

  // Wiring: on Reports, redrawn with it, nothing named after a regulator's form.
  assert(/id="programmeReturnCard"[\s\S]{0,900}id="prIntake"[\s\S]{0,300}id="prPeriod"/.test(INDEX), 'Reports carries the intake and period filters');
  assert(/onclick="exportProgrammeReturnCSV\(\)">Download CSV</.test(INDEX) && /onclick="exportProgrammeReturnPDF\(\)">Download PDF</.test(INDEX), 'one click each for CSV and PDF');
  assert(/'renderProgrammeReturn'/.test(fnOf(INDEX, 'refreshReportsAnalytics')), 'redrawn with the rest of Reports');
  assert(!/HEART|NSTA|NCTVET|TVET/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'it names no regulator\'s form');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
