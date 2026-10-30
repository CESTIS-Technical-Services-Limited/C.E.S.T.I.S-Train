/* The certificate portal, downloads, templates and the dashboard's figures.

   Each section pins one verified defect, run from the REAL functions in
   index.html (both builds):
     certs-04  "Refresh from Cloud" read the backup's top level, where nothing
               is (every writer wraps it in .data): the trainee was told "No
               certificate issued yet" while the device was marked synced.
     certs-07  the download gate passed on a cached token and a login gate
               opened by local accounts — no cloud read at all.
     certs-10  bulk approval saved the whole store and redrew the list once
               per trainee selected.
     certs-11  saving a template dropped its plan provenance.
     certs-12  a missing template quietly printed another programme's.
     certs-14  a QR code's number stuck to the portal for the next trainee.
     certs-15  the PDF page was the background's pixel count in points.
     certs-16  the pronoun came from the template, never the trainee.
     certs-13  the request queue synced as one list, later save wins whole.
     admin-13  "Certifications by Month" counted nothing ("October 16, 2026"
               split on '-'), "Certified This Year" was all time.
     missed    the certificate lookup copied the cloud's approval decision
               over this device's whatever its age.

   Run: node tests/cert-portal-fixes.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'), core: require('../Offline System/cestis-core.js') }
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
const load = (sb, src, names, w) => vm.runInContext(names.map(n => extractFunction(src, n, w)).join('\n'), sb);

(async function main() {

/* ---------- certs-04 ---------- */
console.log('Refresh from Cloud reads the backup as every writer writes it');
for (const page of PAGES) {
  const w = page.where;
  const backup = { version: '1.0', data: {
    students: [{ id: 'STU-1', name: 'Ann Brown', course: 'Welding', stage: 'certified', certNo: 'WE-2026-4321', certDate: 'March 01, 2026', lastModified: '2026-03-01T00:00:00.000Z' },
               { id: 'STU-9', name: 'Ann Brown', course: 'Cosmetology', stage: 'certified', certNo: 'CO-2026-1111', lastModified: '2026-09-01T00:00:00.000Z' }],
    certDownloadApprovals: [{ studentId: 'STU-1', certNo: 'WE-2026-4321', approved: true, approvedDate: '2026-03-02T00:00:00.000Z' }],
    certTemplates: { Welding: { courseFullName: 'OLD NAME', updatedAt: '2026-01-01T00:00:00.000Z' } }
  } };
  const toasts = [];
  const me = { id: 'STU-1', name: 'Ann Brown', course: 'Welding', stage: 'training', lastModified: '2026-02-01T00:00:00.000Z' };
  const sb = {
    console: { log() {}, warn() {}, error() {} }, Date, JSON, Math, Object, Array, String, encodeURIComponent,
    CESTISCore: page.core, CESTISStore: { getItem: () => null },
    currentStudent: me, students: [me], certDownloadApprovals: [], instructorData: [], skillAreas: [],
    certTemplates: { Welding: { courseFullName: 'NEW NAME', updatedAt: '2026-06-01T00:00:00.000Z', bgPage1: 'data:x' } },
    googleAccessToken: 'tok', GOOGLE_DRIVE_CONFIG: { FOLDER_ID: 'F', BACKUP_FILE_NAME: 'B.json' },
    _certDriveLastFetched: null, document: { getElementById: () => null },
    fetch: async (url) => ({ ok: true, json: async () => (/alt=media/.test(url) ? JSON.parse(JSON.stringify(backup)) : { files: [{ id: 'X' }] }) }),
    showToast: m => toasts.push(m), saveState() {}, buildStudentPages() {}, showPage() {}, isCentreDeleted: () => false,
    instructorCourseMatch: () => false, syncTombsFor: () => ({}), loginPageGoogleAuth: async () => null
  };
  vm.createContext(sb);
  load(sb, page.src, ['studentRefreshCertData'], w);
  await vm.runInContext('studentRefreshCertData()', sb);
  assert(sb.students[0].stage === 'certified' && sb.students[0].certNo === 'WE-2026-4321', w + ': the trainee\'s issued certificate arrives');
  assert(sb.certDownloadApprovals.length === 1 && sb.certDownloadApprovals[0].approved === true, w + ': and so does the approval');
  assertEq(toasts[toasts.length - 1], 'Certificate data updated!', w + ': and the trainee is told so');
  assert(!!sb._certDriveLastFetched, w + ': the device counts as synced after a real read');
  assertEq(sb.certTemplates.Welding.courseFullName, 'NEW NAME', w + ': a newer template on this device is not rolled back to the cloud\'s older copy');
  assertEq(sb.certTemplates.Welding.bgPage1, 'data:x', w + ': and its image stays');
  // A namesake on another programme is never merged into this trainee.
  const sb2 = Object.assign({}, sb);
  const me2 = { id: 'STU-77', name: 'Ann Brown', course: 'Welding', stage: 'training' };
  sb2.currentStudent = me2; sb2.students = [me2]; sb2._certDriveLastFetched = null;
  backup.data.students = [backup.data.students[1]];
  vm.createContext(sb2);
  load(sb2, page.src, ['studentRefreshCertData'], w);
  await vm.runInContext('studentRefreshCertData()', sb2);
  assert(sb2.students[0].certNo === undefined && sb2.students[0].course === 'Welding', w + ': a same-named trainee on another programme is not merged in');
  // An unreadable backup leaves the device un-synced.
  const sb3 = Object.assign({}, sb, { _certDriveLastFetched: null, fetch: async (url) => ({ ok: true, json: async () => (/alt=media/.test(url) ? { version: '1.0' } : { files: [{ id: 'X' }] }) }) });
  vm.createContext(sb3);
  load(sb3, page.src, ['studentRefreshCertData'], w);
  await vm.runInContext('studentRefreshCertData()', sb3);
  assertEq(sb3._certDriveLastFetched, null, w + ': a backup that could not be read does not mark the device synced');
}

/* ---------- certs-07 ---------- */
console.log('The download gate needs a real read of the cloud');
for (const page of PAGES) {
  const w = page.where;
  const sb = { Date, _certDriveLastFetched: null, isCloudConnected: true, loginSyncCompleted: true, lastSyncTime: null };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('var _certPageOpenedAt = Date.now() - 1000; var CERT_SYNC_FRESH_MS = 30 * 60 * 1000;\n' + extractFunction(page.src, 'certSyncDone', w), sb);
  assertEq(vm.runInContext('certSyncDone()', sb), false, w + ': a cached token and an opened login gate are not a sync');
  sb.lastSyncTime = new Date(Date.now() - 86400000);
  assertEq(vm.runInContext('certSyncDone()', sb), false, w + ': nor is yesterday\'s sync time restored from storage');
  sb.lastSyncTime = new Date();
  assertEq(vm.runInContext('certSyncDone()', sb), true, w + ': a sync that reached Drive in this session is');
  sb.lastSyncTime = null; sb._certDriveLastFetched = Date.now();
  assertEq(vm.runInContext('certSyncDone()', sb), true, w + ': and so is the certificate lookup\'s own pull');
  sb._certDriveLastFetched = null; sb.CESTISPageCloud = { lanSynced: () => true };
  assertEq(vm.runInContext('certSyncDone()', sb), true, w + ': on the Centre\'s LAN, its server is the central store (offline track unchanged)');
}

/* ---------- certs-10 ---------- */
console.log('Bulk approval saves and redraws once');
for (const page of PAGES) {
  const w = page.where;
  const roll = [];
  for (let i = 0; i < 50; i++) roll.push({ id: 'S' + i, name: 'T ' + i, course: 'Welding', stage: 'certified', certNo: 'WE-2026-' + (1000 + i), certDate: 'March 01, 2026' });
  const counts = { save: 0, render: 0, confirm: 0 };
  const sb = {
    console, Date, JSON, Math, Object, Array, String, CESTISCore: page.core,
    students: roll, certDownloadApprovals: [],
    document: { querySelectorAll: () => roll.map(s => ({ value: s.id })) },
    saveState() { counts.save++; }, renderCertDownloadMgmt() { counts.render++; }, closeModal() {}, showToast() {},
    confirm() { counts.confirm++; return true; }, certActorName: () => 'Admin',
    certEligibilityContext: () => ({}), certEligibilityFor: () => ({ warnings: 0, items: [] }), certSignApproved: () => Promise.resolve(0)
  };
  vm.createContext(sb);
  load(sb, page.src, ['_applyCertApproval', 'bulkApproveCertDownloads'], w);
  vm.runInContext('bulkApproveCertDownloads()', sb);
  assertEq(sb.certDownloadApprovals.filter(a => a.approved).length, 50, w + ': all 50 approved');
  assert(counts.save === 1 && counts.render === 1, w + ': with one save and one redraw (was 50 of each): ' + JSON.stringify(counts));
  assertEq(counts.confirm, 0, w + ': no question when every record is in order');
}

/* ---------- certs-11 / certs-12 ---------- */
console.log('Templates: provenance survives a save, and a missing template is missing');
for (const page of PAGES) {
  const w = page.where, K = page.core.certs;
  const seeded = { seededFromPlan: 'BT-L2', qualification: 'NVQ-J', clusterCount: 4, gender: 'her', competencies: [
    { category: 'Safety', items: ['Work safely'], fromPlan: 'BT-L2' }, { category: 'Skin', items: ['Analyse skin'], fromPlan: 'BT-L2' }] };
  const saved = K.keepTemplateProvenance(seeded, { courseFullName: 'Beauty Therapy', competencies: [
    { category: 'Safety', items: ['Work safely'] }, { category: 'Skin', items: ['Analyse skin types'] }] });
  assert(saved.seededFromPlan === 'BT-L2' && saved.clusterCount === 4 && saved.gender === 'her', w + ': the plan provenance and other unseen fields survive a save');
  assert(saved.competencies[0].fromPlan === 'BT-L2' && saved.competencies[1].fromPlan === undefined, w + ': an unchanged competency stays "from the plan"; an edited one becomes hand-written');
  assert(extractFunction(page.src, 'saveCertTemplate', w).indexOf('CESTISCore.certs.keepTemplateProvenance(existing, {') !== -1, w + ': saveCertTemplate saves through it');

  const sb = { CESTISCore: page.core, certTemplates: { 'Electrical Installation L2': {}, 'Electrical Installation L3': {}, 'Beauty Therapy': {} }, certTemplateCourseMap: { 'Sparky': 'Electrical Installation L3' } };
  vm.createContext(sb);
  load(sb, page.src, ['getCertTemplateKey'], w);
  const key = c => vm.runInContext('getCertTemplateKey(' + JSON.stringify(c) + ')', sb);
  assertEq(key('Electrical Installation'), 'Electrical Installation', w + ': L2 and L3 both match: no silent pick of the first');
  assertEq(key(''), '', w + ': an empty programme matches nothing');
  assertEq(key('02. Beauty Therapy'), 'Beauty Therapy', w + ': an intake-keyed programme still finds its own template');
  assertEq(key('03. Electrical Installation L3 (Evening)'), 'Electrical Installation L3', w + ': a single match at the right level is found');
  assertEq(key('Sparky'), 'Electrical Installation L3', w + ': the Centre\'s mapping still wins');
}

/* ---------- certs-14 ---------- */
console.log('A QR code\'s number belongs to that visit only');
for (const page of PAGES) {
  const w = page.where;
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', value: '', classList: { add() {}, remove() {}, toggle() {} } });
  const sb = { document: { getElementById: el }, location: { search: '', pathname: '/' }, history: { replaceState() {} },
    certPortalShow() {}, certPortalRefreshSyncUi() {}, fetchCertDataFromDrive: () => Promise.resolve(false), certPortalRerender() {}, _certEsc: s => String(s), Promise };
  vm.createContext(sb);
  vm.runInContext('var _certPortalCertNo = ""; var _certPortalSigned = null;\n' + ['openCertPortal', 'closeCertPortal'].map(n => extractFunction(page.src, n, w)).join('\n'), sb);
  vm.runInContext('openCertPortal("home", "WE-1"); closeCertPortal(); openCertPortal("home");', sb);
  assertEq(vm.runInContext('_certPortalCertNo', sb), '', w + ': closing the portal forgets the number, so the next trainee is not blocked');
  assertEq(el('certPortalCertNoWrap').innerHTML, '', w + ': and its banner');
}

/* ---------- certs-15 / certs-16 ---------- */
console.log('The PDF page is A4, and the pronoun is the trainee\'s');
for (const page of PAGES) {
  const w = page.where, K = page.core.certs;
  const p = K.pdfPage(2000, 1414);
  assert(p.format === 'a4' && p.unit === 'mm' && p.orientation === 'landscape' && Math.abs(p.w - 297) < 0.5 && p.h <= 210.01 && p.y >= 0, w + ': a 2000×1414 background fills an A4 landscape page: ' + JSON.stringify(p));
  const q = K.pdfPage(1414, 2000);
  assert(q.orientation === 'portrait' && q.pageWidth === 210 && q.w <= 210.01, w + ': a portrait one, a portrait page');
  const inner = extractFunction(page.src, '_generateCertPDFInner', w);
  assert(inner.indexOf("unit: 'px'") === -1 && inner.indexOf('CESTISCore.certs.pdfPage(canvas1.width, canvas1.height)') !== -1, w + ': the PDF is made on that page');
  assert(inner.indexOf('CESTISCore.certs.recordDownload(approval, certDeviceId())') !== -1, w + ': and each download is counted for this device');

  const texts = [];
  const ctx = { drawImage() {}, fillText(t) { texts.push(t); } };
  const sb = { document: { createElement: () => ({ getContext: () => ctx }) }, _certBodySub: (t, c) => t.replace(/\{pronoun\}/g, c.pronoun).replace(/\{courseType\}/g, c.courseType).replace(/\{course\}/g, c.course).replace(/\{date\}/g, c.date), Math, String };
  vm.createContext(sb);
  load(sb, page.src, ['renderCertPage1OnBg'], w);
  const draw = (g, tg) => { texts.length = 0; vm.runInContext('renderCertPage1OnBg({ naturalWidth: 100, naturalHeight: 70 }, ' + JSON.stringify({ name: 'A', course: 'C', certNo: 'N', certDate: 'D', gender: g }) + ', ' + JSON.stringify({ gender: tg }) + ')', sb); return texts[1]; };
  assert(/completed her vocational/.test(draw('Female', 'his')), w + ': a female graduate\'s certificate says "her", whatever the template says');
  assert(/completed his vocational/.test(draw('Male')), w + ': a male graduate\'s says "his"');
  assert(/completed their vocational/.test(draw('')), w + ': and with nothing recorded, "their"');
}

/* ---------- admin-13 ---------- */
console.log('The dashboard counts certificates by their real dates');
for (const page of PAGES) {
  const w = page.where, K = page.core.certs;
  const roll = [
    { stage: 'certified', certNo: 'A', certDate: 'October 16, 2026' },
    { stage: 'collected', certNo: 'B', certDate: '2026-09-03' },
    { stage: 'certified', certNo: 'C', certDate: 'October 02, 2025' },
    { stage: 'certified', certNo: 'D', certDate: 'January 10, 2026' }
  ];
  const b = K.byMonth(roll, new Date(2026, 9, 20), 6);
  assertEq(b.map(x => x.year + '-' + (x.month + 1) + ':' + x.count).join(' '), '2026-5:0 2026-6:0 2026-7:0 2026-8:0 2026-9:1 2026-10:1', w + ': the last six months, with "October 16, 2026" in October 2026 and last October left out');
  const jan = K.byMonth(roll, new Date(2026, 1, 1), 6);
  assertEq(jan[0].year + '-' + (jan[0].month + 1), '2025-9', w + ': the window runs back across January');
  assertEq(jan.filter(x => x.year === 2025 && x.month === 9)[0].count, 1, w + ': and finds last October there');
  assertEq(K.certifiedInYear(roll, 2026), 3, w + ': "Certified This Year" counts this year\'s certificates, not every graduate');
  const dash = extractFunction(page.src, 'buildAdminPages', w);
  assert(dash.indexOf("split('-')") === -1 && dash.indexOf('CESTISCore.certs.byMonth(students') !== -1 && dash.indexOf('CESTISCore.certs.certifiedInYear(students') !== -1, w + ': the dashboard uses them');
  assert(extractFunction(page.src, 'exportReportCSV', w).indexOf('reportProgrammeRolls()') !== -1, w + ': the report export has a row per training centre, not per programme name');
  // The Dropout Rate's rule is CESTISCore.centreFigures.dropout (tests/centre-figures.test.js).
  assert(/const dropoutRate = fig\.dropout\.rate/.test(page.src) && require('../cestis-core.js').centreFigures.isDropout({ stage: 'training', enrolStatus: 'dropout' }),
    w + ': a dropout marked on the register counts in Dropout Rate');
}

/* ---------- certs-13 and the lookup's approvals ---------- */
console.log('Requests merge one by one; the lookup merges approvals by the shared rule');
for (const page of PAGES) {
  const w = page.where, C = page.core;
  const base = [{ id: 'REQ-1', status: 'pending', requestedAt: '2026-10-01T09:00:00.000Z' }, { id: 'REQ-2', status: 'pending', requestedAt: '2026-10-01T09:00:00.000Z' }];
  const A = JSON.parse(JSON.stringify(base)); A[0].status = 'ready'; A[0].updatedAt = '2026-10-02T10:00:00.000Z';
  const B = JSON.parse(JSON.stringify(base)); B[1].status = 'collected'; B[1].updatedAt = '2026-10-02T10:05:00.000Z';
  const k = 'voctrain_certTranscriptRequests';
  const res = C.pageCloud.mergeKeys({ [k]: JSON.stringify(A) }, { [k]: '2026-10-02T10:00:00.000Z' }, { [k]: JSON.stringify(B) }, { [k]: '2026-10-02T10:05:00.000Z' }, { records: true });
  const out = JSON.parse(res.data[k]);
  assert(out.length === 2 && out[0].status === 'ready' && out[1].status === 'collected', w + ': both offices\' changes survive: ' + out.map(r => r.id + '=' + r.status).join(' '));
  assert(extractFunction(page.src, 'fetchCertDataFromDrive', w).indexOf('CESTISCore.cloudMerge.applyApproval(certDownloadApprovals, ca)') !== -1
    && extractFunction(page.src, 'fetchCertDataFromDrive', w).indexOf('existing.approved = ca.approved') === -1, w + ': the lookup no longer copies the cloud\'s decision over this device\'s');
}
for (const page of PAGES) {
  const i = page.src.indexOf("e.data.type === 'students-updated'");
  const block = page.src.slice(i, page.src.indexOf('saveState();', i));
  assert(block.indexOf("certDownloadApprovals = adoptStoredCollection('voctrain_certDownloadApprovals', certDownloadApprovals)") !== -1,
    page.where + ': a withdrawal made in the Student Progress frame is adopted by the dashboard before it saves, not overwritten');
}
const ctr = fs.readFileSync(path.join(ROOT, 'Cert-Transcript-Requests.html'), 'utf8');
assert(/records: true/.test(ctr) && /r\.updatedAt = r\.handledAt/.test(ctr), 'the request page asks for the record merge and stamps each change');
const pc = fs.readFileSync(path.join(ROOT, 'cestis-page-cloud.js'), 'utf8');
// (The Drive merges now go through driveRecords(spec), which answers `true`
// for a page that asks for the record merge and otherwise names the
// collections every page merges record by record.)
assert((pc.match(/records: driveRecords\(self\.spec\)/g) || []).length >= 2 &&
  /if \(spec && spec\.records\) return true;/.test(pc), 'the Drive pull and push both honour it');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
