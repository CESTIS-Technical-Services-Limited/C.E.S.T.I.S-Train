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

// The code is drawn over the generic one — and contained within the page.
console.log('Page 2 paints out the generic QR square and draws the live code in its place');
function qrHarness(src, w, where, opts) {
  opts = opts || {};
  const sb = { console: { log() {}, warn() {} }, Math, parseFloat, isFinite, encodeURIComponent, String, Object, Array,
    location: { protocol: 'https:', origin: 'https://cestis.example.org', pathname: '/lms/index.html' },
    systemSettings: opts.settings || {}, QRCode: function (host, o) { host._qr = o; host.canvas = { qr: true, text: o.text }; }, document: {}, CESTISCore: { certTemplate: { page2Content: function () { return { unitHeading: 'MODULES COMPLETED', competencies: [] }; } } } };
  sb.QRCode.CorrectLevel = { M: 0 };
  sb.document.createElement = function () { return { querySelector: function () { return this.canvas; } }; };
  sb.calls = [];
  const H = opts.h || 1414, borderTop = opts.borderTop == null ? H : opts.borderTop, borderLeft = opts.borderLeft || 0;
  sb.ctx = {
    fillRect(x, y, ww, hh) { sb.calls.push(['fillRect', x, y, ww, hh]); },
    drawImage(img, x, y, ww, hh) { sb.calls.push(['drawImage', img, x, y, ww, hh]); },
    fillText() {}, measureText() { return { width: 10 }; }, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    getImageData(x, y, ww, hh) {
      const d = new Uint8ClampedArray(ww * hh * 4);
      for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
        const px = x + i, py = y + j, o = (j * ww + i) * 4, dark = py >= borderTop || px < borderLeft;
        d[o] = dark ? 11 : 253; d[o + 1] = dark ? 30 : 250; d[o + 2] = dark ? 58 : 242; d[o + 3] = 255;
      }
      return { data: d };
    }
  };
  vm.createContext(sb);
  vm.runInContext(['CERT_QR_DEFAULTS', 'certVerifyBaseUrl', 'certVerifyUrlFor', 'certPageInnerBounds', 'certQrGeometry', 'certMakeQrCanvas', 'certDrawValidationQr']
    .map(function (n) { return n === 'CERT_QR_DEFAULTS' ? 'var CERT_QR_DEFAULTS = { x: 3, y: 87, size: 7 };' : extractFunction(src, n, where); }).join('\n'), sb);
  return sb;
}
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  const p2 = extractFunction(src, 'renderCertPage2OnBg', w);
  assert(p2.indexOf('certDrawValidationQr(ctx, student, tpl, w, h)') !== -1, w + ': page 2 draws the validation QR');
  assert(p2.lastIndexOf('certDrawValidationQr(') > p2.lastIndexOf("'Certificate No. '"), w + ': the QR is drawn last, over everything the template printed');

  // A page with a clear cream margin all the way down: nothing to clamp.
  let sb = qrHarness(src, 2000, w);
  let r = vm.runInContext("certDrawValidationQr(ctx, { certNo: 'PH-2026-2972' }, {}, 2000, 1414)", sb);
  assertEq(r.url, 'https://cestis.example.org/lms/index.html?certificate=PH-2026-2972', w + ': the code carries this site\'s address and the certificate number');
  assert(r.drawn === true, w + ': a code was drawn');
  assertEq(JSON.stringify([r.geometry.x, r.geometry.y, r.geometry.size]), JSON.stringify([60, 1230, 140]), w + ': default square: 3% in, 87% down, 7% wide of a 2000px page');
  const cover = sb.calls.find(function (c) { return c[0] === 'fillRect'; });
  assert(cover && cover[1] === 43 && cover[2] === 1219 && cover[3] === 174 && cover[4] === 168, w + ': the patch surrounds the square with a margin: ' + JSON.stringify(cover));
  assert(cover[1] <= 55 && cover[2] <= 1225 && cover[1] + cover[3] >= 205 && cover[2] + cover[4] >= 1372, w + ': and it hides the whole of the generic square the Centre\'s backgrounds carry (55..205 × 1225..1372)');
  const drawn = sb.calls.find(function (c) { return c[0] === 'drawImage'; });
  assert(drawn && drawn[2] === 60 && drawn[3] === 1230 && drawn[4] === 140 && drawn[5] === 140, w + ': the code is drawn at the square: ' + JSON.stringify(drawn && drawn.slice(2)));
  assert(drawn && drawn[1].text === r.url, w + ': from the verification address');

  // A page whose bottom border begins at 1300: the code is CONTAINED.
  sb = qrHarness(src, 2000, w, { borderTop: 1300 });
  r = vm.runInContext("certDrawValidationQr(ctx, { certNo: 'PH-2026-2972' }, {}, 2000, 1414)", sb);
  const g = r.geometry, lim = 1300 - 14;
  assert(g.y + g.size <= lim, w + ': the square stays a margin above the bottom border (' + (g.y + g.size) + ' <= ' + lim + ')');
  assert(g.size >= 84, w + ': and is still large enough to scan (' + g.size + 'px)');
  assert(g.cover.y + g.cover.h === 1300 && g.cover.y === 1219, w + ': the patch runs down to the border line and no further, keeping its top');

  // A page with a thick left border: the code moves in from it.
  sb = qrHarness(src, 2000, w, { borderLeft: 100 });
  r = vm.runInContext("certDrawValidationQr(ctx, { certNo: 'X' }, {}, 2000, 1414)", sb);
  assert(r.geometry.x >= 114, w + ': the square clears a thick left border (' + r.geometry.x + ')');
  assert(r.geometry.cover.x === 100, w + ': and the patch is cut at the border, not painted over it');

  // A page it cannot read (no image data): drawn where the template says.
  sb = qrHarness(src, 2000, w); sb.ctx.getImageData = function () { throw new Error('tainted'); };
  r = vm.runInContext("certDrawValidationQr(ctx, { certNo: 'X' }, { textPositions: { p2QrX: 10, p2QrY: 50, p2QrSize: 5 } }, 1000, 1000)", sb);
  assertEq(JSON.stringify([r.geometry.x, r.geometry.y, r.geometry.size]), JSON.stringify([100, 500, 50]), w + ': the template\'s own p2Qr* positions are honoured');

  // No QR library on the device: the address is printed instead, the square is still cleared.
  sb = qrHarness(src, 2000, w); vm.runInContext('QRCode = undefined', sb);
  r = vm.runInContext("certDrawValidationQr(ctx, { certNo: 'X' }, {}, 2000, 1414)", sb);
  assert(r.drawn === false && sb.calls.some(function (c) { return c[0] === 'fillRect'; }), w + ': without the library the square is still painted out');

  // Settings override for certificates produced away from the public site.
  sb = qrHarness(src, 2000, w, { settings: { certVerifyUrl: 'https://public.example.org/lms/?x=1' } });
  assertEq(vm.runInContext("certVerifyUrlFor('A-1')", sb), 'https://public.example.org/lms/?certificate=A-1', w + ': the Settings address wins, with its own query dropped');

  // The editor carries the same square, draggable, contained the same way.
  const prev = extractFunction(src, '_renderCertLivePreviewP2', w);
  assert(prev.indexOf("_cpv('ctplP2QrX'") !== -1 && prev.indexOf("id:'qr code'") !== -1, w + ': the editor\'s page-2 preview carries a draggable QR zone');
  assert(prev.indexOf('certQrGeometry(') !== -1, w + ': placed by the same geometry the certificate uses');
  assert(extractFunction(src, 'saveCertTemplate', w).indexOf('p2QrSize') !== -1 && extractFunction(src, 'openCertTemplateEditor', w).indexOf('ctplP2QrSize') !== -1, w + ': the editor saves and loads the QR position');
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

/* ---------- 9. A stale maintenance screen can find its own way out ---------- */
console.log('The maintenance screen checks for itself');
PAGES.forEach(function (page) {
  const w = page.where, src = page.src;
  assert(src.indexOf('id="maintRecheckBtn" onclick="maintenanceRecheck()"') !== -1, w + ': the overlay carries a Check for Updates button');
  const ap = extractFunction(src, 'applyMaintenanceOverlay', w);
  assert(ap.indexOf('maintenanceScheduleRecheck()') !== -1 && ap.indexOf('maintenanceScheduleRecheck(false)') !== -1, w + ': showing the screen arms the re-check, hiding it disarms it');

  function harness(opts) {
    const el = {};
    ['maintenanceOverlay', 'maintSince', 'maintRecheckBtn', 'maintRecheckStatus'].forEach(function (id) { el[id] = { id: id, style: {}, textContent: '', disabled: false, querySelector: function () { return { innerHTML: '' }; } }; });
    el.maintenanceOverlay.style.display = 'none';
    const sb = { console: { log() {}, warn() {} }, Date, Math, Promise, JSON, String, Object,
      document: { getElementById: function (id) { return el[id] || null; } },
      systemSettings: opts.settings, currentRole: opts.role || null, isLoginPageSync: false, isCloudConnected: !!opts.connected, googleAccessToken: opts.connected ? 'tok' : null,
      timers: [], intervals: [], calls: [],
      setTimeout: function (fn, ms) { sb.timers.push(ms); return 1; }, setInterval: function (fn, ms) { sb.intervals.push(ms); return 7; }, clearInterval: function () { sb.calls.push('clearInterval'); },
      _certHasCloudToken: function () { return !!opts.token; }, attemptSilentTokenRefresh: function () { sb.calls.push('silentRefresh'); },
      loginPageSync: async function () { sb.calls.push('loginPageSync'); if (opts.cloudOff) sb.systemSettings.maintenanceMode = false; },
      autoSyncOnLogin: async function () { sb.calls.push('autoSyncOnLogin'); }
    };
    sb.el = el;
    vm.createContext(sb);
    vm.runInContext('var _maintRecheckTimer = null, _maintRecheckInFlight = false;\n' + ['applyMaintenanceOverlay', 'maintenanceScheduleRecheck', 'maintenanceRecheck'].map(function (n) { return extractFunction(src, n, w); }).join('\n'), sb);
    return sb;
  }
  // Maintenance on, no admin: the screen shows, says since when, and arms the re-check.
  let sb = harness({ settings: { maintenanceMode: true, maintenanceUpdatedAt: '2026-08-01T09:00:00.000Z' } });
  vm.runInContext('applyMaintenanceOverlay()', sb);
  assertEq(sb.el.maintenanceOverlay.style.display, 'flex', w + ': the screen is shown');
  assert(sb.el.maintSince.textContent.indexOf('switched on') !== -1, w + ': and says when maintenance mode was switched on');
  assert(sb.timers.indexOf(1800) !== -1 && sb.intervals.indexOf(300000) !== -1, w + ': a check soon after, then every five minutes');
  // Off: hidden, and the re-check disarmed.
  vm.runInContext('systemSettings.maintenanceMode = false; applyMaintenanceOverlay()', sb);
  assertEq(sb.el.maintenanceOverlay.style.display, 'none', w + ': switched off, the screen goes');
  assert(sb.calls.indexOf('clearInterval') !== -1, w + ': and the timer is cleared');
  // An admin never sees it.
  sb = harness({ settings: { maintenanceMode: true }, role: 'admin' });
  vm.runInContext('applyMaintenanceOverlay()', sb);
  assertEq(sb.el.maintenanceOverlay.style.display, 'none', w + ': an administrator is never blocked');
});
async function maintAsync(page) {
  const w = page.where, src = page.src;
  function harness(opts) { /* same as above, kept local so the sync harness stays simple */
    const el = {};
    ['maintenanceOverlay', 'maintSince', 'maintRecheckBtn', 'maintRecheckStatus'].forEach(function (id) { el[id] = { id: id, style: { display: 'flex' }, textContent: '', disabled: false, querySelector: function () { return { innerHTML: '' }; } }; });
    const sb = { console: { log() {}, warn() {} }, Date, Math, Promise, JSON, String, Object,
      document: { getElementById: function (id) { return el[id] || null; } },
      systemSettings: opts.settings, currentRole: opts.role || null, isLoginPageSync: false, isCloudConnected: !!opts.connected, googleAccessToken: opts.connected ? 'tok' : null,
      calls: [], setTimeout: function (fn, ms) { return setTimeout(fn, 0); }, setInterval: function () { return 7; }, clearInterval: function () {},
      _certHasCloudToken: function () { return !!opts.token; }, attemptSilentTokenRefresh: function () { sb.calls.push('silentRefresh'); },
      loginPageSync: async function () { sb.calls.push('loginPageSync'); if (opts.cloudOff) sb.systemSettings.maintenanceMode = false; },
      autoSyncOnLogin: async function () { sb.calls.push('autoSyncOnLogin'); if (opts.cloudOff) sb.systemSettings.maintenanceMode = false; }
    };
    sb.el = el;
    vm.createContext(sb);
    vm.runInContext('var _maintRecheckTimer = 7, _maintRecheckInFlight = false;\n' + ['applyMaintenanceOverlay', 'maintenanceScheduleRecheck', 'maintenanceRecheck'].map(function (n) { return extractFunction(src, n, w); }).join('\n'), sb);
    return sb;
  }
  // A quiet check with no token asks Google silently and opens nothing.
  let sb = harness({ settings: { maintenanceMode: true }, token: false });
  await vm.runInContext('maintenanceRecheck(true)', sb);
  assert(sb.calls.indexOf('silentRefresh') !== -1 && sb.calls.indexOf('loginPageSync') === -1, w + ': a quiet check without a token never opens a sign-in window');
  // A quiet check with a token runs the login page\'s sync; the cloud says off; the screen goes.
  sb = harness({ settings: { maintenanceMode: true }, token: true, cloudOff: true });
  await vm.runInContext('maintenanceRecheck(true)', sb);
  assert(sb.calls.indexOf('loginPageSync') !== -1, w + ': a quiet check with a token syncs');
  assertEq(sb.el.maintenanceOverlay.style.display, 'none', w + ': and the screen clears when the cloud says maintenance is off');
  // The button, with no token, goes through the login page\'s sync (which asks for the sign-in itself).
  sb = harness({ settings: { maintenanceMode: true }, token: false });
  await vm.runInContext('maintenanceRecheck()', sb);
  assert(sb.calls.indexOf('loginPageSync') !== -1, w + ': the button always checks, asking for the sign-in when it must');
  assert(sb.el.maintRecheckStatus.textContent.indexOf('Still under maintenance') !== -1, w + ': and says so when the cloud still holds it on');
  assertEq(sb.el.maintRecheckBtn.disabled, false, w + ': the button is usable again afterwards');
  // A logged-in, cloud-connected session uses the post-login sync.
  sb = harness({ settings: { maintenanceMode: true }, token: true, role: 'student', connected: true, cloudOff: true });
  await vm.runInContext('maintenanceRecheck()', sb);
  assert(sb.calls.indexOf('autoSyncOnLogin') !== -1, w + ': a signed-in device re-checks through its own sync');
}

Promise.resolve().then(function () {
  // The async lookup check above returns promises through forEach; give them a tick.
  return new Promise(function (r) { setTimeout(r, 50); });
}).then(async function () {
  for (const p of PAGES) await maintAsync(p);
}).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
