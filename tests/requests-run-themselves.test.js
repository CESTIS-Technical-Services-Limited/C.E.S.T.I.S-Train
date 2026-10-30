/* Certificate / transcript requests run themselves.

   What happened (office audit OF-9, management M12): a request row had 0
   buttons; issuing a transcript meant 3 screens and finding the trainee in a
   121-name dropdown, a certificate 6 screens and 12 clicks; "Mark Collected"
   on the Certificates page left the request "Ready for Collection", so
   collection was marked twice and the two could disagree; the trainee was
   never told anything (0 notifications); and requests were listed newest
   first, the oldest (43 days) at the bottom with no age shown.

   What this pins:
     1  CESTISCore.Transcript (both builds): which requests are open, which
        include a certificate, what the trainee is told for each status, and
        that a certificate handed over collects that trainee's open
        certificate requests (and nobody else's, and never a transcript-only
        one);
     2  the requests page (Cert-Transcript-Requests.html): oldest first, "N
        days waiting", and on each row "Open transcript", "Certify" (when the
        trainee is not certified; only for somebody who may certify) and
        "Mark collected" (a certificate only once certified); a status change
        is reported to the dashboard;
     3  the dashboard (index.html): the trainee is told in HER bell (forUsers,
        so the trainee sign-in hands it to her alone), once per status; a
        certificate request collected marks the certificate collected; the
        Certificates page's Mark Collected collects the request too; "Open
        transcript" opens Transcript/Grades on the trainee, "Certify" Student
        Progress's dialog set to Certified;
     4  Student Progress and Transcript/Grades open on the trainee they are
        sent.

   Run: node tests/requests-run-themselves.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const DAY = 86400000;
function extractFrom(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(m.index, i + 1); } }
  throw new Error(name);
}

/* ---------- 1. The rules ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(function (pair) {
  const where = pair[0], T = pair[1].Transcript;
  console.log('\n[' + where + '] Open requests, certificates, and what the trainee is told');
  assert(T.isOpenRequest({ status: 'pending' }) && T.isOpenRequest({ status: 'processing' }) && T.isOpenRequest({ status: 'ready' }), 'pending, processing and ready are open');
  assert(!T.isOpenRequest({ status: 'collected' }) && !T.isOpenRequest({ status: 'declined' }) && !T.isOpenRequest({ status: 'cancelled' }), 'collected, declined, withdrawn are not');
  assert(T.wantsCertificate({ type: 'certificate' }) && T.wantsCertificate({ type: 'both' }) && !T.wantsCertificate({ type: 'transcript' }), 'which include a certificate');
  assertEq(T.requestNotice({ type: 'transcript' }, 'ready'), 'Your transcript is ready. Collect it at the office.', 'ready');
  assertEq(T.requestNotice({ type: 'both' }, 'ready'), 'Your transcript and certificate are ready. Collect them at the office.', 'ready, both');
  assertEq(T.requestNotice({ type: 'certificate' }, 'processing'), 'Your certificate request is being prepared by the office.', 'being prepared');
  assertEq(T.requestNotice({ type: 'certificate', adminNote: 'fees outstanding' }, 'declined'), 'Your certificate request was declined: fees outstanding. Ask the office if you have a question.', 'declined, with the reason');
  assertEq(T.requestNotice({ type: 'transcript' }, 'collected'), 'Your transcript request is complete: collected at the office.', 'collected');
  assertEq(T.requestNotice({ type: 'transcript' }, 'pending'), '', 'set back to pending: nothing to tell');
  console.log('[' + where + '] A certificate handed over collects her certificate requests, and only hers');
  const reqs = [
    { id: 'R1', studentId: 'S1', type: 'certificate', status: 'ready', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'R2', studentId: 'S1', type: 'transcript', status: 'ready' },
    { id: 'R3', studentId: 'S1', type: 'both', status: 'processing' },
    { id: 'R4', studentId: 'S2', type: 'certificate', status: 'ready' },
    { id: 'R5', studentId: 'S1', type: 'certificate', status: 'declined' }];
  const res = T.collectCertificateRequests(reqs, 'S1', 'Sheryl Brown', '2026-10-30T15:00:00Z');
  assertEq(res.changed.map(r => r.id), ['R1', 'R3'], 'her open certificate requests');
  assertEq(res.list.map(r => r.status), ['collected', 'ready', 'collected', 'ready', 'declined'], 'her transcript, a declined one and another trainee\'s are untouched');
  assert(res.list[0].handledBy === 'Sheryl Brown' && res.list[0].updatedAt === '2026-10-30T15:00:00Z', 'who and when, so the change travels');
  assert(reqs[0].status === 'ready', 'the list it was given is not changed in place');
});

/* ---------- 2. The requests page ---------- */
const Core = require('../cestis-core.js');
const CR = fs.readFileSync(path.join(ROOT, 'Cert-Transcript-Requests.html'), 'utf8');
const CR_JS = CR.slice(CR.indexOf("<script>\n'use strict';"), CR.indexOf('</script>', CR.indexOf("<script>\n'use strict';")))
  .replace("<script>\n'use strict';", '').replace(/setInterval\([\s\S]*?\}, 5000\);/, '').replace(/document\.addEventListener\('DOMContentLoaded'[\s\S]*?\}\);/, '');
function crPage(role, opts) {
  opts = opts || {};
  const now = Date.now();
  const store = {
    voctrain_certTranscriptRequests: JSON.stringify([
      { id: 'R-new', studentId: 'S2', studentName: 'Brianna Grant', course: 'Cosmetology', type: 'transcript', status: 'pending', requestedAt: new Date(now - 1 * DAY).toISOString() },
      { id: 'R-old', studentId: 'S1', studentName: 'Akeem Williams', course: 'Welding & Fabrication', type: 'certificate', status: 'pending', requestedAt: new Date(now - 43 * DAY).toISOString() },
      { id: 'R-mid', studentId: 'S3', studentName: 'Chevaughn Morgan', course: 'Plumbing', type: 'both', status: 'ready', requestedAt: new Date(now - 9 * DAY).toISOString() }]),
    voctrain_students: JSON.stringify([{ id: 'S1', stage: 'training' }, { id: 'S2', stage: 'training' }, { id: 'S3', stage: 'certified', certNo: 'CERT-2026-0003' }]),
    voctrain_adminStaffAccess: JSON.stringify(opts.grid || { studentsmanage: false })
  };
  const els = {};
  const el = id => (els[id] = els[id] || { id, value: id === 'crStatusFilter' ? 'open' : id === 'crTypeFilter' ? 'all' : '', innerHTML: '', textContent: '', className: '' });
  const posted = [];
  const sb = {
    console, JSON, Date, Math, String, Object, Array, setTimeout, clearTimeout, URLSearchParams,
    location: { search: '' },
    CESTISCore: Object.assign({}, Core, { sessionAccess: { forPage: () => ({ ok: true, role, account: { id: role === 'admin' ? 'USR-a' : 'USR-sbrown', name: 'Sheryl Brown' } }) } }),
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { getElementById: el, addEventListener() {} },
    addEventListener() {},
    posted, store, els
  };
  sb.window = sb;
  sb.window.parent = { postMessage: m => posted.push(m) };
  sb.window.top = sb.window.parent;
  vm.createContext(sb);
  vm.runInContext(CR_JS + '\nload(); render();', sb);
  return sb;
}
console.log('\n[Cert-Transcript-Requests.html] Oldest first, days waiting, and the work on each row');
{
  const sb = crPage('admin');
  const rows = sb.els.crRows.innerHTML.split('<tr>').slice(1);
  assertEq(rows.map(r => (/<td style="font-weight:600;">([^<]+)</.exec(r) || [])[1]), ['Akeem Williams', 'Chevaughn Morgan', 'Brianna Grant'], 'oldest first');
  assert(/<div class="cr-wait long">43 days waiting<\/div>/.test(rows[0]), 'the oldest says "43 days waiting", marked as long');
  assert(/<div class="cr-wait">1 day waiting<\/div>/.test(rows[2]), 'a day-old one says "1 day waiting"');
  assert(rows.every(r => /onclick="crOpen\('transcript',/.test(r) && />Open transcript</.test(r)), 'every row: Open transcript');
  assert(/onclick="crOpen\('certify',[^"]*"\s*>Certify</.test(rows[0]), 'an uncertified trainee\'s certificate request: Certify');
  assert(/<button class="cr-btn go" onclick="crCollected\([^)]*\)" disabled title="Certify the trainee first">Mark collected</.test(rows[0]), 'and Mark collected waits until she is certified');
  assert(!/>Certify</.test(rows[1]) && /<button class="cr-btn go" onclick="crCollected\([^)]*\)">Mark collected</.test(rows[1]), 'a certified trainee\'s: no Certify; Mark collected');
  assert(!/>Certify</.test(rows[2]) && /<button class="cr-btn go" onclick="crCollected\([^)]*\)">Mark collected</.test(rows[2]), 'a transcript: Mark collected at once');
  sb.crCollected('R-old');
  assert(JSON.parse(sb.store.voctrain_certTranscriptRequests).find(r => r.id === 'R-old').status === 'pending', 'a certificate not yet issued cannot be marked collected');
  sb.crCollected('R-mid');
  assert(JSON.parse(sb.store.voctrain_certTranscriptRequests).find(r => r.id === 'R-mid').status === 'collected', 'Mark collected: the request is collected');
  assertEq(sb.posted.filter(m => m.type === 'cestis-ctr-status'), [{ type: 'cestis-ctr-status', requestId: 'R-mid', status: 'collected', was: 'ready' }], 'and the dashboard is told (for the trainee and the Certificates page)');
  sb.setStatus('R-new', 'processing');
  assert(sb.posted.some(m => m.type === 'cestis-ctr-status' && m.requestId === 'R-new' && m.status === 'processing' && m.was === 'pending'), 'the status list reports its changes too');
  sb.crOpen('transcript', 'S2');
  assert(sb.posted.some(m => m.type === 'cestis-ctr-open' && m.what === 'transcript' && m.studentId === 'S2'), 'Open transcript asks the dashboard for this trainee');
}
{
  const staff = crPage('adminstaff', { grid: { studentsmanage: false } });
  assert(/onclick="crOpen\('certify',[^"]*" disabled title="Certifying needs Student Progress and Student Progress — manage\. Ask the Administrator\.">Certify</.test(staff.els.crRows.innerHTML), 'Admin Staff without "Student Progress — manage": Certify is shown but cannot be used, and says why');
  const own = crPage('adminstaff', { grid: { studentsmanage: false, people: { 'USR-sbrown': { students: true, studentsmanage: true, updatedAt: '2026-10-01T00:00:00Z' } } } });
  assert(/onclick="crOpen\('certify',[^"]*"\s*>Certify</.test(own.els.crRows.innerHTML), 'with the tick (her own) she can');
}

/* ---------- 3. The dashboard ---------- */
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function dash(role, opts) {
  opts = opts || {};
  const store = { voctrain_certTranscriptRequests: JSON.stringify(opts.requests || []) };
  const sb = {
    console, JSON, Date, Math, String, Object, Array, CESTISCore: Core,
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    currentRole: role, currentLoggedInUser: { id: 'USR-sbrown', name: 'Sheryl Brown' },
    userAccounts: [{ id: 'USR-akeem', role: 'student', studentDataId: 'S1' }, { id: 'USR-chev', role: 'student', studentDataId: 'S3' }],
    students: [{ id: 'S1', name: 'Akeem Williams', course: 'Welding & Fabrication', stage: 'certified', certNo: 'CERT-2026-0001' },
      { id: 'S3', name: 'Chevaughn Morgan', course: 'Plumbing', stage: 'training' }],
    notifications: [], adminNotes: [], saves: 0, pages: [], toasts: [], frames: {},
    addNotificationForUser(text, type, icon, uid, r, fixedId) {
      if (fixedId && sb.notifications.some(n => n.id === fixedId)) return null;
      const n = { id: fixedId, text, forUsers: [uid], forRoles: [r] }; sb.notifications.push(n); return n;
    },
    addNotification(text) { sb.adminNotes.push(text); }, saveState() { sb.saves++; }, showToast(m) { sb.toasts.push(m); },
    showPage(p) { sb.pages.push(p); }, pageAllowedForRole: () => true, markStageSetByUser() {}, filterCerts() {}, updatePipelineCounts() {}, renderCertStats() {}, refreshStudentDependentViews() {},
    updateCtrRequestsBadge() {}, renderOfficeToday() {}, studentProgressManageAllowed: () => !!opts.manage, staffSectionRefused: () => false,
    document: { getElementById: id => sb.frames[id] || null }
  };
  ['ctrRequestsFrame', 'asCtrRequestsFrame', 'transcriptGradesFrame', 'asTranscriptGradesFrame', 'studentProgressFrame', 'asStudentProgressFrame'].forEach(id => {
    sb.frames[id] = { id, attrs: { 'data-src-loaded': '1' }, got: [], getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener() {}, contentWindow: { postMessage: m => sb.frames[id].got.push(m) } };
  });
  sb.store = store;
  vm.createContext(sb);
  vm.runInContext("var CTR_REQUEST_FRAMES = ['ctrRequestsFrame', 'asCtrRequestsFrame'];\n" +
    ['examTraineeUserId', 'ctrReadRequests', 'ctrNotifyTrainee', 'ctrCertificateCollected', 'ctrRequestMovedOn', 'ctrOpenFor', 'ctrCollectRequestsFor', 'markCollected'].map(n => extractFrom(PAGE, n)).join('\n'), sb);
  return sb;
}
console.log('\n[index.html] The trainee is told, in her own bell, once per status');
{
  const sb = dash('adminstaff', { requests: [{ id: 'R1', studentId: 'S1', studentName: 'Akeem Williams', type: 'certificate', status: 'ready' }] });
  sb.ctrRequestMovedOn('R1', 'ready', 'processing');
  assertEq(sb.notifications.map(n => [n.forUsers, n.text]), [[['USR-akeem'], 'Your certificate is ready. Collect it at the office.']], 'told, and only she is (forUsers: her account)');
  sb.ctrRequestMovedOn('R1', 'ready', 'processing');
  assertEq(sb.notifications.length, 1, 'the same move reported again (another office computer) is one notice');
  sb.ctrRequestMovedOn('R1', 'collected', 'ready');
  assertEq(sb.notifications.length, 1, 'a report that does not match the request as stored is ignored');
  // Gate: a notice for her account reaches her slice alone (Core.gate's noticeFor uses forUsers).
  assert(/if \(Array\.isArray\(n\.forUsers\) && n\.forUsers\.length\) return n\.forUsers\.map\(str\)\.indexOf\(t\.acct\) !== -1;/.test(fs.readFileSync(path.join(ROOT, 'cestis-core.js'), 'utf8')),
    'the trainee sign-in hands a notice addressed to one account to that trainee only');
}
console.log('[index.html] ONE collected mark: request → Certificates page');
{
  const sb = dash('adminstaff', { requests: [{ id: 'R1', studentId: 'S1', studentName: 'Akeem Williams', type: 'certificate', status: 'collected' }, { id: 'R2', studentId: 'S3', type: 'transcript', status: 'collected' }] });
  sb.ctrRequestMovedOn('R1', 'collected', 'ready');
  const s = sb.students[0];
  assert(s.certCollected === true && s.stage === 'collected', 'the certificate is marked collected on the trainee\'s record (the Certificates page)');
  assert(sb.adminNotes.some(t => /Certificate collected: Akeem Williams/.test(t)), 'the office hears of it as from the Certificates page');
  assert(sb.notifications.some(n => /request is complete/.test(n.text) && n.forUsers[0] === 'USR-akeem'), 'and the trainee is told');
  sb.ctrRequestMovedOn('R2', 'collected', 'ready');
  assert(sb.students[1].stage === 'training' && !sb.students[1].certCollected, 'a transcript collected touches no certificate');
}
console.log('[index.html] ONE collected mark: Certificates page → request');
{
  const sb = dash('admin', { requests: [{ id: 'R1', studentId: 'S1', studentName: 'Akeem Williams', type: 'both', status: 'ready', updatedAt: '2026-10-01T00:00:00Z' }, { id: 'R9', studentId: 'S1', type: 'transcript', status: 'ready' }] });
  sb.markCollected('S1');
  const stored = JSON.parse(sb.store.voctrain_certTranscriptRequests);
  assertEq(stored.map(r => r.status), ['collected', 'ready'], 'her certificate request is collected; her transcript request is not');
  assert(sb.notifications.some(n => n.id === 'CTR-R1-collected' && n.forUsers[0] === 'USR-akeem'), 'she is told');
  assert(sb.frames.ctrRequestsFrame.got.some(m => m.type === 'transcript-refresh'), 'an open requests page shows it at once');
  assert(sb.saves === 1, 'saved once');
}
console.log('[index.html] Open transcript / Certify go straight to the trainee');
{
  const sb = dash('adminstaff', {});
  sb.ctrOpenFor('transcript', 'S3');
  assertEq(sb.pages, ['as-transcript-grades'], 'Transcript/Grades');
  assertEq(sb.frames.asTranscriptGradesFrame.got, [{ type: 'cestis-tg-select', studentId: 'S3' }], 'with the trainee chosen');
  sb.ctrOpenFor('certify', 'S3');
  assert(sb.pages.length === 1 && /"Student Progress — manage"/.test(sb.toasts[0]), 'Certify without "Student Progress — manage": refused, said');
  const m = dash('admin', { manage: true });
  m.frames.studentProgressFrame.attrs = {};   // not opened yet this session
  m.ctrOpenFor('certify', 'S3');
  assertEq(m.pages, ['students'], 'the Administrator: Student Progress');
  assert(m.frames.studentProgressFrame.attrs['data-open-certify'] === 'S3', 'a page not yet loaded is sent the trainee once it has loaded');
  assert(/var tgPick = tgEl\.getAttribute\('data-open-select'\);/.test(extractFrom(PAGE, 'showPage')), 'a Transcript/Grades not yet loaded opens with the trainee in its address');
}

/* ---------- 4. The pages open on the trainee ---------- */
console.log('\n[Student-Progress.html / Transcript-Grades.html] Opened on the trainee');
{
  const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
  const stageEl = { value: 'training' };
  const sb = { students: [{ id: 'S3', name: 'Chevaughn Morgan', stage: 'training' }], opened: [], checklist: 0, toasts: [],
    spRefuseEdit: () => false, spIndexOfId: id => (id === 'S3' ? 0 : -1), openUpdateStage(id) { sb.opened.push(id); }, spRenderCertChecklist() { sb.checklist++; },
    showToast(m) { sb.toasts.push(m); }, document: { getElementById: id => (id === 'newStage' ? stageEl : null) }, String };
  vm.createContext(sb);
  vm.runInContext(extractFrom(SP, 'spOpenCertify'), sb);
  assert(sb.spOpenCertify('S3') === true && sb.opened[0] === 'S3' && stageEl.value === 'certified' && sb.checklist === 1, 'Student Progress: her stage dialog, set to Certified, with the checklist');
  assert(sb.spOpenCertify('S9') === false && /not on the roll/.test(sb.toasts[0]), 'a trainee it does not hold is said');
  assert(/e\.data\.type === 'cestis-sp-certify' && e\.source === window\.parent\) spOpenCertify/.test(SP), 'only the dashboard can ask');
  const TG = fs.readFileSync(path.join(ROOT, 'Transcript-Grades.html'), 'utf8');
  const tg = { IS_STAFF: true, VIEWER: { ok: true }, db: { students: [{ id: 'S3' }] }, sel: { studentId: '' }, picked: [], studentById: id => (id === 'S3' ? { id } : null) };
  tg.onPickStudent = id => { tg.picked.push(id); tg.sel.studentId = id; };
  vm.createContext(tg);
  vm.runInContext(extractFrom(TG, 'tgSelectFromOffice'), tg);
  assert(tg.tgSelectFromOffice('S3') === true && tg.picked[0] === 'S3', 'Transcript/Grades: the trainee chosen');
  assert(tg.tgSelectFromOffice('S9') === false, 'one it does not hold is not');
  tg.IS_STAFF = false;
  assert(tg.tgSelectFromOffice('S3') === false, 'never on a trainee\'s or instructor\'s own view');
  assert(/var pick = param\('select'\);\s*if \(pick\) tgSelectFromOffice\(pick\);/.test(TG), 'it reads the trainee from its address on first load');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
