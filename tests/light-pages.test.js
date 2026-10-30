/* Lighter pages for phones (audit EF-9, T8, T15): code a visit never runs is
   not downloaded with the page.

   - index.html: the staff and board modules (Staff Appraisals, the CMC Board's
     portal, the certificate designs' seed — about 255 KB) are not downloaded on
     a trainee's sign-in link (#gate=) or in a trainee's own session; everywhere
     else they still load before the page, as they always have. A member of
     staff signing in on such a phone gets them first (enterApp), and every
     place a backup is built or merged waits for them, so a backup never goes
     up without the appraisals (leaving a key out of the upload deletes it from
     the shared file).
   - Transcript-Grades: jsPDF is fetched the first time a PDF is wanted.
   - School Fee: the spreadsheet, chart and PDF libraries are fetched the first
     time each is needed.

   The browser suites (lms-flows, ui-preview-combined, transcripts-admin,
   school-fee-present-year, board-figures, …) drive every feature that uses
   them. Run: node tests/light-pages.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INDEX = read('index.html');

/* ---------- 1. index.html: the staff and board modules ---------- */
console.log('index.html: the staff and board modules stay off a trainee\'s phone');
['staff-appraisals.js', 'cmc-portal.js', 'cert-template-seed.js'].forEach(f => {
  assert(INDEX.indexOf('<script src="' + f) === -1, f + ' is no longer a fixed script tag');
});
const headScript = (() => {
  const at = INDEX.indexOf('window.cestisStaffModules = {');
  const start = INDEX.lastIndexOf('<script>', at) + '<script>'.length;
  return INDEX.slice(start, INDEX.indexOf('</script>', at));
})();
assert(headScript.length > 200 && INDEX.indexOf(headScript) < INDEX.indexOf('</head>'), 'the decision is made in <head>, before the page');
assert(/'staff-appraisals\.js\?v=[0-9a-f]{8}', 'cmc-portal\.js\?v=[0-9a-f]{8}', 'cert-template-seed\.js\?v=[0-9a-f]{8}'/.test(headScript), 'it names the three files, in their old order, with content tags');

function runHead(o) {
  const written = [], appended = [];
  const ls = Object.assign({}, o.ls || {});
  const win = {};
  const sb = {
    window: win, location: { hash: o.hash || '' },
    localStorage: { getItem: k => (k in ls ? ls[k] : null) },
    document: {
      write: h => written.push(h),
      createElement: () => ({}),
      head: { appendChild: el => { appended.push(el.src); setImmediate(() => { (o.onLoad || (() => {}))(el.src, win); el.onload(); }); } }
    },
    Promise, setImmediate
  };
  win.document = sb.document;
  vm.runInNewContext(headScript, sb);
  return { written, appended, api: win.cestisStaffModules, win };
}
const office = runHead({});
assert(office.written.length === 1 && /^<script src="staff-appraisals\.js\?v=[0-9a-f]{8}"><\/script><script src="cmc-portal\.js\?v=[0-9a-f]{8}"><\/script><script src="cert-template-seed\.js\?v=[0-9a-f]{8}"><\/script>$/.test(office.written[0]),
  'an office PC (no trainee link, no trainee session) loads them in <head> as before: ' + office.written[0]);
assert(office.api && office.api.skipped === false, 'and they are not marked as left out');
const link = runHead({ hash: '#gate=aHR0cHM6Ly9leGFtcGxl' });
assert(link.written.length === 0 && link.api.skipped === true, 'a trainee\'s sign-in link (#gate=) does not download them');
const session = runHead({ ls: { cestisGateNs: 'g1' } });
assert(session.written.length === 0 && session.api.skipped === true, 'nor does a trainee\'s own session (the gate\'s store)');
assert(runHead({ ls: { cestisGateNs: 'nonsense' } }).written.length === 1, 'a value that is not a gate namespace changes nothing');
assert(link.api.ready() === false, 'where they were left out, they are not "ready"');

(async () => {
  const GLOBAL = { 'staff-appraisals.js': 'sappCloudExport', 'cmc-portal.js': 'CESTISCmc', 'cert-template-seed.js': 'CESTISCertSeed' };
  const lazy = runHead({ hash: '#gate=x', onLoad: (src, win) => { win[GLOBAL[src.split('?')[0]]] = {}; } });
  await lazy.api.load();
  assert(lazy.appended.map(s => s.split('?')[0]).join(',') === 'staff-appraisals.js,cmc-portal.js,cert-template-seed.js', 'load() fetches them on demand, in order (' + lazy.appended.join(', ') + ')');
  assert(lazy.api.ready() === true, 'and then they are ready');
  const broken = runHead({ hash: '#gate=x', onLoad: () => {} });
  let threw = false;
  try { await broken.api.load(); } catch (e) { threw = true; }
  assert(threw && broken.api.ready() === false, 'a download that does not arrive is reported, never taken for ready');

  /* ---------- 2. index.html: who waits for them ---------- */
  console.log('Signing in as staff, and every backup, wait for them');
  const enter = INDEX.slice(INDEX.indexOf('function enterApp(role) {'), INDEX.indexOf('function enterApp(role) {') + 900);
  assert(/if \(role !== 'student' && window\.cestisStaffModules && cestisStaffModules\.skipped && !cestisStaffModules\.ready\(\) && !cestisStaffModules\.tried\) \{/.test(enter) &&
    /cestisStaffModules\.load\(\)\.then\(_enterAgain, _enterAgain\);/.test(enter) && enter.indexOf('cestisStaffModules') < enter.indexOf('try {'),
    'a member of staff signing in on a trainee\'s phone gets the modules before the portal opens (and it opens either way)');
  [['async function mergeFromCloud() {', "showToast('Could not sync"], ['async function savePerUserBackup() {', 'return;'],
   ['async function mergeBackupData(backupData) {', '_mergeBackupFailed = true; return false;'], ['async function autoSaveToAllFolders() {', 'return;']].forEach(([fn, onFail]) => {
    const at = INDEX.indexOf(fn);
    const body = INDEX.slice(at, at + 1400);
    const guard = body.indexOf('if (window.cestisStaffModules && !cestisStaffModules.ready()) {');
    const sapp = INDEX.indexOf('sapp', at);
    assert(at !== -1 && guard !== -1 && body.indexOf('try { await cestisStaffModules.load(); } catch (e) { ' + onFail) !== -1 && at + guard < sapp,
      fn.replace(/ \{$/, '') + ' waits for the appraisals module first, and stops if it cannot arrive');
  });
  const reg = INDEX.slice(INDEX.indexOf('async function submitRegistration() {'), INDEX.indexOf('async function submitRegistration() {') + 2500);
  assert(/if\(!CESTISCore\.accountAccess\.isFullName\(name\)\)/.test(reg) && reg.indexOf('sappIsFullName') === -1,
    'the registration form\'s full-name rule comes from the core (the same rule, tests/office-trainee-accounts.test.js)');

  /* ---------- 3. Transcript-Grades: jsPDF on demand ---------- */
  console.log('Transcript-Grades fetches jsPDF the first time a PDF is wanted');
  const TG = read('Transcript-Grades.html');
  assert(!/<script[^>]*src="vendor\/jspdf/.test(TG) && !/document\.write\([^)]*jspdf/.test(TG), 'no jsPDF with the page');
  assert(/var tries = \['vendor\/jspdf-2\.5\.1\.umd\.min\.js', 'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/2\.5\.1\/jspdf\.umd\.min\.js',\s*'https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\/dist\/jspdf\.umd\.min\.js'\];/.test(TG),
    'this site\'s copy first, then the two CDNs it used to fall back to');
  ['generateTranscriptPDF(student, qual)', 'generateGradeSheetPDF(student, qual)'].forEach(fn => {
    const name = fn.split('(')[0];
    assert(TG.indexOf('function ' + fn + ' {\n  if (!withPdfLib(function () { ' + fn + '; })) return;') !== -1, name + ' waits for jsPDF, then runs');
  });
  assert(fs.existsSync(path.join(ROOT, 'vendor/jspdf-2.5.1.umd.min.js')), 'and the site\'s copy is there');

  /* ---------- 4. School Fee: its libraries on demand ---------- */
  console.log('School Fee fetches the spreadsheet, chart and PDF libraries when first needed');
  const SF = read('School.Fee.html');
  ['xlsx-0.18.5.full.min.js', 'chart-3.9.1.min.js', 'jspdf-2.5.1.umd.min.js', 'jspdf.plugin.autotable-3.5.31.min.js'].forEach(f => {
    assert(SF.indexOf('<script src="vendor/' + f) === -1 && SF.indexOf("'vendor/" + f + "'") !== -1 && fs.existsSync(path.join(ROOT, 'vendor', f)),
      f + ' is fetched on demand from this site (not loaded with the page)');
  });
  assert(!/document\.write\([^)]*(xlsx|chart|jspdf)/i.test(SF), 'none of their CDN fallbacks is written into the page either');
  [['exportReportToPDF()', 'jspdf'], ['exportToPDF()', 'jspdf'], ['generateReceipt(payment, student)', 'jspdf'],
   ['exportToExcel()', 'XLSX'], ['handleImportFile(e)', 'XLSX'], ['exportAllData(type)', 'XLSX']].forEach(([fn, lib]) => {
    const at = SF.indexOf('function ' + fn + ' {');
    assert(at !== -1 && SF.slice(at, at + 200).indexOf("if (!feeWithLib('" + lib + "', function () { " + fn + '; })) return;') !== -1, fn.split('(')[0] + ' waits for ' + lib);
  });
  const charts = SF.slice(SF.indexOf('function initializeCharts('), SF.indexOf('function initializeCharts(') + 1500);
  assert(/if \(typeof Chart === 'undefined'\) \{[\s\S]*?feeNeedLib\('Chart'\)\.then\(function \(\) \{ initializeCharts\(\); \}/.test(charts), 'the dashboard\'s charts are drawn once Chart arrives');
  assert(/name === 'jspdf' \? one\('jspdf'\)\.then\(function \(\) \{ return one\('autoTable'\); \}\)/.test(SF), 'a PDF brings jsPDF with its table plug-in');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
