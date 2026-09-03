/* The certificate portal, the validation QR code, and the roll behind them.

   Three complaints from the Centre, and what each one pinned:

   1. "Certificate showing not found although the student has been certified."
      The certificate lookup read the Main Backup folder only; the pre-login
      sync read the five folder copies. Neither read the MASTER backup — the
      one file that carries the whole store — so a certificate that had reached
      the master file but not yet a folder copy was invisible until somebody
      logged in (the post-login sync has always reconciled against it).
      Pinned: loginPageSync and fetchCertDataFromDrive both await
      reconcileWithMasterSnapshot(), and the lookup treats a master read as a
      successful sync.

   2. "The site is sometimes showing too many trainees; after a sync it
      returns to the true number." loadState() settles the roll once as the
      page opens; the merges that run afterwards (five folder copies, the fee
      roll, the accounts) never ran the same pass, so the dashboard was built
      from a roll holding the same trainee twice or three times. Pinned:
      cestisSettleRoster() exists, collapses the roll through the same rules,
      and is called on every merge path and before the dashboard is built.

   3. The QR code. The page-2 background carried a generic square; the
      renderer now paints it out and draws the site's own verification address
      for that certificate. Pinned: the geometry, the cover, the address, and
      the Settings override; the portal opens from that address; and the
      Download button is greyed out until the device has synced.

   Both builds (online and Offline System) are checked, from the functions as
   they are written in index.html.

   Run: node tests/certificate-portal.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
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
function count(src, needle) { return src.split(needle).length - 1; }
function before(hay, a, b) { const ia = hay.indexOf(a), ib = hay.indexOf(b); return ia !== -1 && ib !== -1 && ia < ib; }

/* ---------- 1. The master backup is read before login and on every lookup ---------- */
console.log('The master backup is read by the pre-login sync and by the certificate lookup');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const lp = extractFunction(src, 'loginPageSync', w);
  assert(lp.indexOf('await reconcileWithMasterSnapshot()') !== -1, w + ': the pre-login sync reconciles against the master backup');
  assert(before(lp, 'await reconcileWithMasterSnapshot()', 'loginSyncCompleted = true'), w + ': and does so before it unlocks login');
  assert(before(lp, 'oldestFirst(_found)', 'await reconcileWithMasterSnapshot()'), w + ': after the folder copies, so the master settles what they leave open');

  const fc = extractFunction(src, 'fetchCertDataFromDrive', w);
  assert(fc.indexOf('await reconcileWithMasterSnapshot()') !== -1, w + ': the certificate lookup reconciles against the master backup');
  assert(fc.indexOf('readMain || readMaster') !== -1, w + ': a master read alone counts as a successful sync');
  assert(before(fc, 'readMain || readMaster', '_certDriveLastFetched = Date.now()'), w + ': and the sync stamp is only set once something was read');

  const rm = extractFunction(src, 'reconcileWithMasterSnapshot', w);
  assert(/return true;\s*\}\s*catch/.test(rm), w + ': reconcileWithMasterSnapshot reports that it read the master file');
});

/* The lookup, run against a stubbed Drive: the main backup is EMPTY, the
   master backup holds the certified trainee. Before the fix she was "No
   Record Found"; now the lookup returns true and she is on the roll. */
console.log('A trainee held only by the master backup is found');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const sb = {
    console: { log: function () {}, warn: function () {} }, JSON: JSON, Date: Date, Object: Object, Array: Array, Promise: Promise,
    setTimeout: function (fn) { return 0; }, encodeURIComponent: encodeURIComponent,
    document: { getElementById: function () { return null; } },
    students: [], certDownloadApprovals: [], certTemplates: {}, skillAreas: [],
    googleAccessToken: 'tok', isCloudConnected: true,
    _certDriveFetchInProgress: false, _certDriveLastFetched: null, CERT_DRIVE_CACHE_MS: 60000,
    GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F', BACKUP_FILE_NAME: 'B.json' },
    CESTISStore: { getItem: function () { return null; } },
    cestisIsStudentTombstoned: function () { return false; },
    backfillCertificateNumbers: function () { return false; },
    revalidateCloudSync: function () {},
    cestisSettleRoster: function () { return 0; },
    // The master reconcile, as the app's would behave: it lands the master's
    // trainee on the roll and says it read the file.
    reconcileWithMasterSnapshot: async function () {
      sb.students.push({ id: 'STU-M1', name: 'Master Only', course: 'Welding', stage: 'certified', certNo: 'WE-2026-0001' });
      return true;
    },
    fetch: async function (url) {
      if (url.indexOf('/files?q=') !== -1) return { ok: true, json: async function () { return { files: [{ id: 'MAIN1' }] }; } };
      return { ok: true, json: async function () { return { data: { students: [] } }; } };
    }
  };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, '_certCloudStatus', w) + '\n' + extractFunction(src, 'fetchCertDataFromDrive', w), sb);
  return vm.runInContext('fetchCertDataFromDrive()', sb).then(function (res) {
    assertEq(res, true, w + ': the lookup reports a successful sync');
    assert(sb.students.some(function (s) { return s.certNo === 'WE-2026-0001'; }), w + ': the master-only trainee is on the roll');
    assert(sb._certDriveLastFetched != null, w + ': and the device now counts as synced');
  });
});

/* ---------- 2. One roll, settled before it is counted ---------- */
console.log('The roll is settled after every merge and before the dashboard is built');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  assertEq(count(src, 'function cestisSettleRoster('), 1, w + ' defines cestisSettleRoster once');
  const uses = count(src, 'cestisSettleRoster(') - 1;
  assert(uses >= 6, w + ': called on the pre-login sync, the login, the post-login sync, Sync from Cloud, Merge from Cloud and the certificate lookup (found ' + uses + ')');
  ['loginPageSync', 'autoSyncOnLogin', 'syncFromCloud', 'mergeFromCloud', 'fetchCertDataFromDrive'].forEach(function (fn) {
    assert(extractFunction(src, fn, w).indexOf('cestisSettleRoster(') !== -1, w + ': ' + fn + ' settles the roll');
  });
  const ea = extractFunction(src, 'enterApp', w);
  assert(before(ea, 'cestisSettleRoster(', 'buildAdminPages()'), w + ': the login settles the roll BEFORE the dashboard counts it');
  const lp = extractFunction(src, 'loginPageSync', w);
  assert(before(lp, 'syncStudentsFromFeeSystem()', 'cestisSettleRoster(') && before(lp, 'await reconcileWithMasterSnapshot()', 'cestisSettleRoster('),
    w + ': the pre-login sync settles after the fee roll and the master backup have been merged');
  const as = extractFunction(src, 'autoSyncOnLogin', w);
  assert(before(as, 'await reconcileWithMasterSnapshot()', 'cestisSettleRoster('), w + ': the post-login sync settles after the master backup');
});

/* The settle itself, on the reported shape: one trainee under two ids and two
   spellings of the same programme (the fee roll's bare name and the keyed
   intake label), which is what a folder merge leaves behind. */
console.log('cestisSettleRoster collapses the same trainee under two ids');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const written = {};
  const sb = {
    console: { log: function () {}, warn: function () {} }, JSON: JSON, Object: Object, Array: Array, Date: Date, Math: Math, String: String,
    window: {}, CESTISCore: page.core,
    students: [
      { id: 'STU-p7al0hg27', name: 'Omarion Blake', course: 'Photovoltaic Installer', stage: 'nyc', progress: 5, lastModified: '2026-08-01T09:00:00.000Z' },
      { id: 'STU-1i5e0bi81mr', name: 'Omarion Blake', course: '02. Photovoltaic Installer', stage: 'nyc', progress: 0 },
      { id: 'STU-other', name: 'Ann Brown', course: 'Photovoltaic Installer', stage: 'certified', certNo: 'PH-2026-0001' }
    ],
    attendanceRecords: [], certDownloadApprovals: [], examResults: [], userAccounts: [], skillAreas: [], certTemplates: {},
    CESTISStore: { setItem: function (k, v) { written[k] = v; }, getItem: function () { return null; } },
    saveUserAccounts: function () { written.accounts = true; },
    updateSkillAreaCounts: function () { written.counts = true; },
    cestisStabilizeStudentIds: function () { return false; },
    reconcileCertifiedFromApprovals: function () { return false; },
    backfillCertificateNumbers: function () { return false; },
    mergeStudentRecords: function (a, b) { return page.core.mergeStudentRecords(a, b); },
    relinkDependentData: function () {}
  };
  sb.window.CESTISCore = page.core;
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'deduplicateStudents', w) + '\n'
    + (src.indexOf('function enforceOnePersonOneRecord(') !== -1 ? extractFunction(src, 'enforceOnePersonOneRecord', w) + '\n' : '')
    + extractFunction(src, 'cestisSettleRoster', w), sb);
  const removed = vm.runInContext("cestisSettleRoster('test')", sb);
  assertEq(removed, 1, w + ': one duplicate record is removed');
  assertEq(sb.students.length, 2, w + ': the roll holds two people');
  assertEq(sb.students.filter(function (s) { return s.name === 'Omarion Blake'; }).length, 1, w + ': Omarion Blake is listed once');
  assert(sb.students.some(function (s) { return s.certNo === 'PH-2026-0001'; }), w + ': the certified trainee is untouched');
  assert(typeof written.voctrain_students === 'string' && JSON.parse(written.voctrain_students).length === 2, w + ': the settled roll is written down');
  assert(written.counts === true, w + ': and the training-centre counts are refreshed');
  // Nothing to do costs one pass and writes nothing.
  const again = vm.runInContext("cestisSettleRoster('again')", sb);
  assertEq(again, 0, w + ': a settled roll is left alone');
});

/* ---------- 3. The validation QR code ---------- */
console.log('The certificate address');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const sb = { systemSettings: {}, location: { protocol: 'https:', origin: 'https://cestis.example.org', pathname: '/C.E.S.T.I.S-Train/index.html' },
    encodeURIComponent: encodeURIComponent, parseFloat: parseFloat, isFinite: isFinite, Math: Math, String: String };
  vm.createContext(sb);
  vm.runInContext(['CERT_QR_DEFAULTS', 'certVerifyBaseUrl', 'certVerifyUrlFor', 'certQrGeometry'].map(function (n) {
    return n === 'CERT_QR_DEFAULTS' ? 'var CERT_QR_DEFAULTS = { x: 3, y: 86.5, size: 7.5 };' : extractFunction(src, n, w);
  }).join('\n'), sb);
  assertEq(vm.runInContext("certVerifyUrlFor('PH-2026-2972')", sb), 'https://cestis.example.org/C.E.S.T.I.S-Train/index.html?certificate=PH-2026-2972',
    w + ': the code carries this page\'s address and the certificate number');
  assertEq(vm.runInContext("certVerifyUrlFor('A B/C')", sb), 'https://cestis.example.org/C.E.S.T.I.S-Train/index.html?certificate=A%20B%2FC',
    w + ': the number is encoded for the address');
  vm.runInContext("systemSettings.certVerifyUrl = ' https://public.example.org/lms/index.html?x=1 '", sb);
  assertEq(vm.runInContext("certVerifyUrlFor('PH-1')", sb), 'https://public.example.org/lms/index.html?certificate=PH-1',
    w + ': the Settings address wins, trimmed and without its own query');
  vm.runInContext("systemSettings.certVerifyUrl = ''; location.protocol = 'file:'", sb);
  assertEq(vm.runInContext("certVerifyUrlFor('PH-1')", sb), '', w + ': a local file with no Settings address has nothing to encode');

  const g = vm.runInContext('certQrGeometry({}, 2000, 1414)', sb);
  assertEq(g.x, 60, w + ': default square sits 3% in');
  assertEq(g.y, 1223, w + ': and 86.5% down — where the generic code is printed');
  assertEq(g.size, 150, w + ': 7.5% of the page wide');
  const g2 = vm.runInContext('certQrGeometry({ textPositions: { p2QrX: 80, p2QrY: 5, p2QrSize: 10 } }, 1000, 500)', sb);
  assert(g2.x === 800 && g2.y === 25 && g2.size === 100, w + ': the template\'s own position is honoured');
});

console.log('Page 2 paints the generic square out and draws the live code in its place');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const calls = [];
  const fakeCtx = {
    fillStyle: '', font: '', textAlign: '',
    getImageData: function (x, y) { calls.push(['sample', x, y]); return { data: [250, 246, 236, 255] }; },
    fillRect: function (x, y, ww, hh) { calls.push(['fillRect', x, y, ww, hh, this.fillStyle]); },
    drawImage: function (img, x, y, ww, hh) { calls.push(['drawImage', img, x, y, ww, hh]); },
    fillText: function (t, x, y) { calls.push(['fillText', t, x, y]); },
    save: function () {}, restore: function () {}
  };
  const qrCanvas = { tag: 'qr' };
  let qrText = null, qrPx = 0;
  const sb = {
    systemSettings: {}, location: { protocol: 'https:', origin: 'https://cestis.example.org', pathname: '/index.html' },
    encodeURIComponent: encodeURIComponent, parseFloat: parseFloat, isFinite: isFinite, Math: Math, String: String, console: console,
    document: { createElement: function () { return { querySelector: function () { return qrCanvas; } }; } },
    QRCode: function (host, opts) { qrText = opts.text; qrPx = opts.width; }
  };
  sb.QRCode.CorrectLevel = { M: 0 };
  vm.createContext(sb);
  vm.runInContext('var CERT_QR_DEFAULTS = { x: 3, y: 86.5, size: 7.5 };\n' + ['certVerifyBaseUrl', 'certVerifyUrlFor', 'certQrGeometry', 'certMakeQrCanvas', 'certDrawValidationQr']
    .map(function (n) { return extractFunction(src, n, w); }).join('\n'), sb);
  sb.ctx = fakeCtx; sb.student = { certNo: 'PH-2026-2972' }; sb.tpl = {};
  const res = vm.runInContext('certDrawValidationQr(ctx, student, tpl, 2000, 1414)', sb);
  assertEq(res.url, 'https://cestis.example.org/index.html?certificate=PH-2026-2972', w + ': the code points at this certificate');
  assertEq(qrText, res.url, w + ': and that is exactly what the QR library was given');
  assert(res.drawn === true, w + ': the code was drawn');
  const cover = calls.find(function (c) { return c[0] === 'fillRect'; });
  assert(cover && cover[1] < 60 && cover[2] < 1223 && cover[1] + cover[3] > 210 && cover[2] + cover[4] > 1373, w + ': the cover is larger than the generic square on every side');
  assertEq(cover && cover[5], 'rgb(250,246,236)', w + ': and painted in the page colour sampled beside it (cream, not assumed white)');
  const draw = calls.find(function (c) { return c[0] === 'drawImage'; });
  assert(draw && draw[1] === qrCanvas && draw[2] === 60 && draw[3] === 1223 && draw[4] === 150 && draw[5] === 150, w + ': the live code lands exactly on the generic square');
  assert(calls.indexOf(cover) < calls.indexOf(draw), w + ': cover first, code second');
  assert(qrPx >= 2 * 150, w + ': the code is drawn at least at double size and scaled down, so the modules stay crisp');

  // The renderer itself calls it, last, so nothing later paints over the code.
  const r2 = extractFunction(src, 'renderCertPage2OnBg', w);
  assert(r2.indexOf('certDrawValidationQr(ctx, student, tpl, w, h)') !== -1, w + ': renderCertPage2OnBg draws the validation code');
  assert(before(r2, "'Certificate No. ' + student.certNo", 'certDrawValidationQr('), w + ': after everything else on the page');

  // The editor carries the position through save, load and its preview.
  ['ctplP2QrX', 'ctplP2QrY', 'ctplP2QrSize'].forEach(function (id) {
    assert(src.indexOf('id="' + id + '"') !== -1, w + ': the template editor has a ' + id + ' field');
  });
  assert(extractFunction(src, 'saveCertTemplate', w).indexOf('p2QrSize:') !== -1, w + ': saving a template keeps the QR position');
  assert(extractFunction(src, 'openCertTemplateEditor', w).indexOf("'ctplP2QrX'") !== -1, w + ': opening a template loads it');
  assert(extractFunction(src, '_renderCertLivePreviewP2', w).indexOf("id:'qr code'") !== -1, w + ': and the page-2 preview shows the square to drag');
  // The look copied to every template includes textPositions, so the QR
  // position travels with "Apply Design to All".
  const copied = page.core.certTemplate.applyLook({ textPositions: { p2QrX: 5, p2QrY: 80, p2QrSize: 9 } }, { textPositions: { p2QrX: 3 } });
  assertEq(copied.textPositions.p2QrSize, 9, w + ': Apply Design to All carries the QR position');
});

/* ---------- 4. The portal, and the Download button that waits for a sync ---------- */
console.log('The QR address opens the portal, and Download waits for a sync');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  ['openCertPortal', 'certPortalShow', 'certPortalVerify', 'certPortalPreview', 'certPortalSync', 'certRenderPreview', 'certDownloadAllowed'].forEach(function (fn) {
    assertEq(count(src, 'function ' + fn + '('), 1, w + ' defines ' + fn);
  });
  ['certPortal', 'certPortalHome', 'certPortalVerify', 'certPortalDownload', 'certPortalSyncBtn', 'certPortalVerifyInput', 'certPortalStudentInput'].forEach(function (id) {
    assertEq(count(src, 'id="' + id + '"'), 1, w + ' has the ' + id + ' element');
  });
  assert(src.indexOf('id="certCheckOverlay"') === -1 && src.indexOf('function checkCertificatePublic(') === -1, w + ': the old single-box overlay is gone');
  assert(src.indexOf('onclick="openCertPortal(\'home\')"') !== -1, w + ': the landing page button opens the portal');

  const sb = { location: {} };
  vm.createContext(sb);
  sb.decodeURIComponent = decodeURIComponent;
  vm.runInContext(extractFunction(src, 'certPortalCertNoFromAddress', w), sb);
  assertEq(vm.runInContext("certPortalCertNoFromAddress('?certificate=PH-2026-2972')", sb), 'PH-2026-2972', w + ': ?certificate= is read');
  assertEq(vm.runInContext("certPortalCertNoFromAddress('?x=1&verify=WE%2D2026%2D0001')", sb), 'WE-2026-0001', w + ': ?verify= is read and decoded');
  assertEq(vm.runInContext("certPortalCertNoFromAddress('?fee=1')", sb), null, w + ': any other address leaves the login page alone');
  assertEq(vm.runInContext("certPortalCertNoFromAddress('')", sb), null, w + ': and so does a bare one');

  // The one rule the Download button follows, in the portal and in My Certificate.
  const sb2 = { certDownloadApprovals: [{ studentId: 'STU-1', approved: true }], _synced: false, certSyncDone: function () { return sb2._synced; } };
  vm.createContext(sb2);
  vm.runInContext(extractFunction(src, 'certDownloadAllowed', w), sb2);
  let v = vm.runInContext("certDownloadAllowed({ id: 'STU-1', certNo: 'PH-1' })", sb2);
  assert(v.allowed === false && /Sync with the cloud first/.test(v.reason), w + ': approved but not synced — greyed out, and it says why');
  sb2._synced = true;
  v = vm.runInContext("certDownloadAllowed({ id: 'STU-1', certNo: 'PH-1' })", sb2);
  assert(v.allowed === true, w + ': approved and synced — allowed');
  v = vm.runInContext("certDownloadAllowed({ id: 'STU-2', certNo: 'PH-2' })", sb2);
  assert(v.allowed === false && /not been approved/.test(v.reason), w + ': synced but not approved — greyed out');
  v = vm.runInContext("certDownloadAllowed({ id: 'STU-1' })", sb2);
  assert(v.allowed === false && /No certificate/.test(v.reason), w + ': no certificate — greyed out');

  const sc = extractFunction(src, 'renderStudentCertificate', w);
  assert(sc.indexOf('certDownloadAllowed(s)') !== -1 && sc.indexOf("(_dlOk.allowed ? '' : 'disabled ')") !== -1, w + ': My Certificate greys its button out by the same rule');
  assert(extractFunction(src, 'studentRefreshCertData', w).indexOf('_certDriveLastFetched = Date.now()') !== -1, w + ': Refresh from Cloud is the sync that switches it on');
  const pv = extractFunction(src, 'certPortalPreview', w);
  assert(pv.indexOf("(v.allowed ? '' : 'disabled ')") !== -1, w + ': the portal button is rendered disabled until allowed');
  assert(pv.indexOf('_certPortalCertNo.toLowerCase()') !== -1, w + ': a certificate opened from its QR code only answers to its holder\'s student number');
  assert(pv.indexOf('renderCertPage1OnBg') === -1 && extractFunction(src, 'certRenderPreview', w).indexOf('renderCertPage1OnBg(img1, student, tpl)') !== -1
    && extractFunction(src, 'certRenderPreview', w).indexOf('renderCertPage2OnBg(img2, student, tpl)') !== -1,
    w + ': the live preview is drawn by the same renderers as the PDF');
  const vf = extractFunction(src, 'certPortalVerify', w);
  assert(vf.indexOf('student.id') === -1, w + ': the employer\'s verify page never prints the student number');
  assert(extractFunction(src, '_certNotFoundCard', w).indexOf('Sync Required') !== -1, w + ': an unmatched number on an unsynced device asks for a sync instead of declaring "No Record Found"');
});

Promise.resolve().then(function () {
  // The async lookup check above returns promises through forEach; give them a tick.
  return new Promise(function (r) { setTimeout(r, 50); });
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
