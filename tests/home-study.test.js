/* Home study made smooth (the owner's group C, October 2026: "Make home study
   smooth"). Trainees sign in and study at home; these are the changes that
   make that smoother, pinned in Node. The same changes are walked through in
   real browsers by tests/browser/home-study.js.

     T7   the bell and the "current stage" stop glowing after a few pulses; only
          opacity moves; nothing moves for "reduce motion"

   Run: node tests/home-study.test.js */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function eq(a, b, m) { assert(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = (HTML.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');
// Checks that wait for an answer (the summary waits for them).
const ASYNC = [];

/* ---------- T7. Animations that end ---------- */
console.log('\nT7. The bell and the current stage glow a few times, then stop');
function rule(sel) {
  const re = new RegExp('(^|\\n)\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[2] : '';
}
function keyframes(name) {
  const i = css.indexOf('@keyframes ' + name);
  if (i === -1) return '';
  let depth = 0, j = css.indexOf('{', i);
  for (let k = j; k < css.length; k++) { if (css[k] === '{') depth++; if (css[k] === '}') { depth--; if (!depth) return css.slice(j, k + 1); } }
  return '';
}
['.topbar-btn.notif-active', '.topbar-btn.notif-active::after', '.stage-circle.current', '.stage-circle.current::after'].forEach(sel => {
  const r = rule(sel);
  assert(r, sel + ' is styled');
  assert(!/infinite/.test(r), sel + ' does not animate for ever (' + r.replace(/\s+/g, ' ').slice(0, 120) + ')');
});
assert(/animation:\s*bellGlow\s+2s\s+ease-in-out\s+3\b/.test(rule('.topbar-btn.notif-active::after')), 'the bell glows three times');
assert(/animation:\s*pulseGlow\s+2s\s+ease-in-out\s+3\b/.test(rule('.stage-circle.current::after')), 'the current stage pulses three times');
['bellGlow', 'pulseGlow'].forEach(n => {
  const k = keyframes(n);
  assert(k && /opacity/.test(k), '@keyframes ' + n + ' moves opacity');
  assert(!/box-shadow|width|height|top|left|margin|padding/.test(k), '@keyframes ' + n + ' moves nothing that repaints or lays out (' + k.replace(/\s+/g, ' ') + ')');
});
const rm = (css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || []).join('\n');
assert(/\.topbar-btn\.notif-active::after/.test(rm) && /\.stage-circle\.current::after/.test(rm), '"reduce motion": neither moves at all');
assert(/btn\.setAttribute\('data-unread'/.test(HTML) && /unread > prev/.test(HTML), 'a NEW notice glows again (three times); the same count stays still');

/* ---------- T14. Small phone friction ---------- */
console.log('\nT14. The trainees\' link opens on her form; 44 px targets; real labels; honest words');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
assert(/if \(CESTISGate\.takeLink\(\)\) _gateT\.fromLink = true;/.test(HTML), 'the page notes that it was opened from the trainees\' link');
assert(/function homeTraineeFirst\(\)/.test(HTML) && /homeTraineeFirst\(\);\n\}/.test(HTML), 'the trainee card, once set up for the gate, opens her form first');
assert(/document\.body\.classList\.contains\('gate-trainee-only'\)/.test(HTML.slice(HTML.indexOf('function homeTraineeFirst'), HTML.indexOf('function homeShowStaffCards'))),
  'on a trainee\'s own device too — never on a PC that holds the Centre\'s records');
assert(/body\.trainee-first \.role-cards \.role-card:not\(#studentCard\) \{ display:none; \}/.test(css), 'the staff cards are out of her way');
assert(/class="register-link staff-cards-toggle" onclick="homeShowStaffCards\(\)">Staff sign-in</.test(HTML), '… one tap away ("Staff sign-in")');
assert(/body\.trainee-first #studentCard \.role-enter-btn \{ order:1;/.test(css), 'Sign in sits right under the password');
const tap = (css.match(/@media \(pointer: coarse\), \(max-width: 600px\) \{[\s\S]*?\n\}/) || [''])[0];
['[id^="page-s-"] .btn-sm', '[id^="page-s-"] a.cw-file-link', '.landing-footer a'].forEach(sel => {
  assert(tap.indexOf(sel) !== -1 && /min-height:44px/.test(tap), sel + ' is at least 44 px tall on a phone');
});
assert((HTML.match(/class="cw-file-link /g) || []).length === 2, 'every link to a coursework file carries cw-file-link');
assert(/<label for="s-vc-join-code"[^>]*>[\s\S]*?Room code/.test(read('Video-Conference-Student.html')), 'the room-code box has a real label');
assert(/<label for="sResSearch"[^>]*>Search resources<\/label>/.test(read('Pages/Student-Resources.html')), 'the resources search box has a real label');
assert(/<label class="home-sr-only" for="__PREFIX__ChatSearch">Search chats<\/label>\s*<input type="text" id="__PREFIX__ChatSearch"/.test(read('LMS-Chat-Member.html')), 'the chat search box has a real label');
const tg = read('Transcript-Grades.html');
assert(tg.indexOf('the moment an exam is marked') === -1, 'the transcript no longer says grades appear "the moment an exam is marked"');
assert(/Your grades appear here once a test is marked or the office updates your record\. A new mark usually takes a few minutes to reach you\./.test(tg), '… it says what really happens');

/* ---------- T1 + T11, the pure rules, in both builds ---------- */
[['cestis-core.js', require('../cestis-core.js')], ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(([where, Core]) => {
  const H = Core.homeStudy;
  console.log('\n[' + where + '] T1. A phone asks every minute around her class times, else every 5 minutes');
  assert(H && typeof H.classPollDelay === 'function', 'Core.homeStudy.classPollDelay exists');
  if (!H) return;
  const MIN = 60000;
  // 10:00 at the Centre (UTC-5) on 2026-11-02 = 15:00 UTC.
  const start = Date.UTC(2026, 10, 2, 15, 0);
  const cls = { id: 'CS-1', course: 'Welding & Fabrication', date: '2026-11-02', time: '10:00', duration: 60, status: 'scheduled' };
  const o = { offsetMin: '-05:00', slowMs: 5 * MIN };
  eq(H.classStartMs(cls, -300), start, 'the class starts at 10:00 Centre time');
  eq(H.classPollDelay([cls], 'Welding & Fabrication', start - 30 * MIN, o), 5 * MIN, 'half an hour before: every 5 minutes');
  eq(H.classPollDelay([cls], 'Welding & Fabrication', start - 13 * MIN, o), 3 * MIN, '13 minutes before: wakes when the window opens (in 3 minutes)');
  eq(H.classPollDelay([cls], 'Welding & Fabrication', start - 10 * MIN, o), MIN, '10 minutes before: every minute');
  eq(H.classPollDelay([cls], 'Welding & Fabrication', start + 29 * MIN, o), MIN, '29 minutes after the start: still every minute');
  eq(H.classPollDelay([cls], 'Welding & Fabrication', start + 31 * MIN, o), 5 * MIN, '31 minutes after: back to every 5 minutes');
  eq(H.classPollDelay([Object.assign({}, cls, { status: 'live' })], 'Welding & Fabrication', start + 5 * MIN, o), MIN, 'a class that went live: every minute in its window');
  eq(H.classPollDelay([Object.assign({}, cls, { status: 'completed' })], 'Welding & Fabrication', start, o), 5 * MIN, 'a finished class does not count');
  eq(H.classPollDelay([Object.assign({}, cls, { status: 'cancelled' })], 'Welding & Fabrication', start, o), 5 * MIN, 'a called-off class does not count');
  eq(H.classPollDelay([Object.assign({}, cls, { course: 'Cosmetology' })], 'Welding & Fabrication', start, o), 5 * MIN, 'another programme\'s class does not count');
  eq(H.classPollDelay([Object.assign({}, cls, { course: 'Welding Level 2' })], 'Welding & Fabrication', start, Object.assign({ matchCourse: (a, b) => /^Welding/.test(a) && /^Welding/.test(b) }, o)), MIN,
    'the page\'s own course comparison decides "her programme"');
  eq(H.classPollDelay([{ course: 'Welding & Fabrication', status: 'scheduled' }], 'Welding & Fabrication', start, o), 5 * MIN, 'a class with no date or time does not count');
  eq(H.classPollDelay([], 'Welding & Fabrication', start, o), 5 * MIN, 'no classes: every 5 minutes, as before');

  console.log('[' + where + '] T11. My Progress: her real figures');
  const sid = 'STU-tameka', other = 'STU-kemar';
  const register = [];
  for (let i = 0; i < 18; i++) register.push({ studentId: sid, date: '2026-10-' + String(i + 1).padStart(2, '0'), status: i % 9 ? (i === 4 ? 'late' : 'present') : 'absent' });
  register.push({ studentId: sid, date: '2026-10-25', status: 'excused' }, { studentId: other, date: '2026-10-01', status: 'absent' });
  const results = [
    { id: 'R1', examId: 'E1', studentId: sid, score: 75, passed: true, submittedAt: '2026-10-01T15:00:00Z' },
    { id: 'R2', examId: 'E2', studentId: sid, score: 52, passed: false, submittedAt: '2026-10-20T15:00:00Z' },
    { id: 'R3', examId: 'E3', studentId: sid, score: 0, needsReview: true, submittedAt: '2026-10-28T15:00:00Z' },
    { id: 'R4', examId: 'E1', studentId: other, score: 99, passed: true, submittedAt: '2026-10-29T15:00:00Z' },
    { id: 'R5', examId: 'E4', studentId: sid, score: 90, passed: true, archived: true, submittedAt: '2026-10-29T15:00:00Z' }];
  const examsList = [{ id: 'E1', title: 'Welding Unit 1 Theory Test', passMark: 60 }, { id: 'E2', title: 'Welding Unit 2 Theory Test', passMark: 60 }, { id: 'E3', title: 'Unit 3' }];
  const f = H.progress({ student: { id: sid, attendance: 40, progress: 58, score: '' }, register, examResults: results, exams: examsList,
    transcript: { known: true, total: 12, competent: 7, nyc: 1, pending: 2, graded: 10, average: 78, qualTitle: 'Welding NVQ-J Level 2' },
    coursework: { graded: 6, total: 11, percent: 80 }, gpa: '3.0' });
  eq([f.attendance.pct, f.attendance.held, f.attendance.attended, f.attendance.late, f.attendance.source], [89, 18, 16, 1, 'register'],
    'attendance from her own register marks (16 of 18 held; excused is not a held class; nobody else\'s marks)');
  eq([f.tests.count, f.tests.last && f.tests.last.title, f.tests.last && f.tests.last.score, f.tests.average, f.tests.passed], [2, 'Welding Unit 2 Theory Test', 52, 64, 1],
    'tests: her MARKED results only — not one awaiting marking, not an archived one, not another trainee\'s; newest first');
  eq([f.units.competent, f.units.total, f.units.pending, f.units.nyc, f.units.pct], [7, 12, 2, 1, 58], 'units competent, from the transcript\'s own reading');
  eq([f.coursework.graded, f.coursework.total, f.coursework.percent, f.gpa], [6, 11, 80, '3.0'], 'coursework and GPA as the instructor\'s views count them');
  const none = H.progress({ student: { id: sid, attendance: 0 }, register: [], examResults: [], exams: [], transcript: { known: false } });
  eq([none.units.known, none.attendance.pct, none.tests.count, none.tests.last], [false, null, 0, null], 'nothing yet: no made-up numbers (no units, no 0% attendance, no score)');
  const stored = H.progress({ student: { id: sid, attendance: 88 }, register: [] });
  eq([stored.attendance.pct, stored.attendance.source], [88, 'record'], 'no register marks on this device: the attendance her record carries (derived from the register on staff devices)');
});

console.log('\nT11 / T1 / T13 in the page');
assert(HTML.indexOf("${escapeHtml(s.score || 'N/A')}</div><div class=\"stat-label\">Last Test Score") === -1, 'no "Last Test Score N/A" from a hand-typed field');
assert(HTML.indexOf('Course Modules Progress') === -1 && HTML.indexOf("'Module 1','Module 2'") === -1, 'no made-up module bars');
assert(/function studentProgressFigures\(s\)[\s\S]{0,900}CESTISCore\.homeStudy\.progress\(/.test(HTML) && /coursework: studentCourseworkSummary\(s\), gpa: studentEffectiveGpa\(s\)/.test(HTML),
  'My Progress uses the computed values the instructor views use (studentCourseworkSummary, studentEffectiveGpa)');
assert(/<div id="sHomeNow" class="home-now">[\s\S]{0,400}id="sHomeLiveClass"[\s\S]{0,300}id="sHomeOpenTest"[\s\S]{0,200}<div class="student-welcome-banner">/.test(HTML), 'the live-class and open-test cards sit at the very top of her home screen');
assert(/function renderStudentDashboard\(\)/.test(HTML), 'renderStudentDashboard exists — the gate\'s refresh after every pull redraws the cards (gateAfterApply already calls it)');
assert(/CESTISCore\.ui\.liveSessionsFor\(classSessions, \{ role: 'student', course: s\.course \}/.test(HTML), 'a live class is decided by the one rule the LIVE badge uses');
assert(/examStatusNow\(e\) === 'active' && has/.test(HTML), 'an open test is decided on the clock her exams use (the gate\'s, at home)');
assert(/homePullSchedule\(\);/.test(HTML) && !/_gateT\.pullTimer = setInterval/.test(HTML), 'the phone\'s pull is scheduled around class times, not a fixed 5 minutes');
assert(/>Join class<\/button>/.test(HTML) && /'Start test'/.test(HTML), 'one big button each: Join class, Start test');

/* ---------- T9 (light). Chat asked for only while the chat page is open ---------- */
console.log('\nT9. Chat: every 45 s on the chat page; elsewhere only the unread check, every 10 minutes; never with the screen off');
const chatPoll = HTML.slice(HTML.indexOf('function gateChatPoll()'), HTML.indexOf('function gateChatPoll()') + 600);
assert(/var GATE_CHAT_PAGE_MS = 45000, GATE_CHAT_IDLE_MS = 10 \* 60 \* 1000;/.test(HTML), 'the two paces are named');
assert(/if \(document\.visibilityState === 'hidden'\) return Promise\.resolve\(false\);/.test(chatPoll), 'nothing is asked while the screen is off');
assert(/var due = lmsChatOnChatPage\(\) \? GATE_CHAT_PAGE_MS : GATE_CHAT_IDLE_MS;/.test(chatPoll), 'the chat page: 45 s; any other page: 10 minutes (was 2½ minutes)');
assert(/function gateSignOutFlow[\s\S]{0,2500}CESTISGate\.leave\(\{ keepData: waiting\.length > 0 \}\)/.test(HTML), 'sign-out still clears her records from the device (shared devices rely on it)');

/* ---------- T6. Registered from home: how long, and an email when approved ---------- */
console.log('\nT6. The pending screen says 1–2 working days, and that she will be emailed when she can sign in');
[['online', require(path.join(ROOT, 'cestis-core.js'))], ['Offline System', require(path.join(ROOT, 'Offline System', 'cestis-core.js'))]].forEach(([build, C]) => {
  const W = C.homeStudy && C.homeStudy.approvalWait;
  assert(typeof W === 'function', build + ': CESTISCore.homeStudy.approvalWait exists');
  if (typeof W !== 'function') return;
  eq(W({ email: 'shanice.walters@example.com', notify: true }),
    'The office usually approves registrations within 1\u20132 working days. We\u2019ll email you at shanice.walters@example.com when you can sign in.', build + ': with the email promise');
  assert(!/email you/.test(W({ email: 'shanice.walters@example.com' })), build + ': no promise unless the gate said it will send it');
  assert(!/email you/.test(W({ email: 'not an address', notify: true })), build + ': no promise to an address that is not one');
  assert(!/Drive|Google|server|cloud|sync/i.test(W({ email: 'a@b.co', notify: true }) + W({})), build + ': says nothing of where anything is kept');
});
assert(/\(opts\.home \? '<div class="pending-when" id="pendingApprovalWhen">' \+ escapeHtml\(CESTISCore\.homeStudy\.approvalWait\(\{ email: user\.email, notify: opts\.notify === true \}\)\)/.test(HTML),
  'the pending screen shows the line for a registration from home (escaped)');
assert(/\{ state: 'sent', home: true, notify: res\.notify === true \}/.test(HTML), 'just registered: the email is promised only when the gate said it will send it');
assert((HTML.match(/\{ state: 'waiting', home: true \}/g) || []).length === 3, 'signing in while still waiting: the same line, without a promise it cannot know');
const GS = read('trainee-gate/Gate.gs');
assert(/function gateMailSend\(G\)/.test(GS) && /MailApp\.sendEmail/.test(GS) && /GATE_MAIL = \{ QUEUE: 'MAIL_QUEUE', MAILED: 'MAILED'/.test(GS), 'the gate sends the approval email itself (MailApp, the Centre\'s own account), once per trainee');
assert(/function gateNudgeApprovalMail\(\)/.test(HTML) && /registeredVia === 'home-registration'\) gateNudgeApprovalMail\(\)/.test(HTML), 'Activate / Approve All ask the gate to send it straight away');

/* ---------- T4. Her certificate at home ---------- */
console.log('\nT4. A certified, approved trainee downloads her certificate at home (counted through her outbox); else "Collect your certificate at the Centre"');
const vm = require('vm');
function fnSrc(name) {
  const i = HTML.indexOf('function ' + name + '(');
  if (i === -1) return '';
  let j = HTML.indexOf('{', i), depth = 0;
  for (let k = j; k < HTML.length; k++) { if (HTML[k] === '{') depth++; else if (HTML[k] === '}') { depth--; if (!depth) return HTML.slice(i, k + 1); } }
  return '';
}
{
  const Core = require(path.join(ROOT, 'cestis-core.js'));
  const run = (o) => {
    const ctx = { CESTISCore: Core, certDownloadApprovals: o.approvals, cestisGateSession: () => !!o.gate, certSyncDone: () => !!o.synced,
      window: { CESTISGate: { session: () => (o.gate ? { base: { kind: o.gate } } : null) } } };
    ctx.CESTISGate = ctx.window.CESTISGate;
    vm.createContext(ctx);
    vm.runInContext(fnSrc('homeCertLan') + '\n' + fnSrc('certDownloadAllowed') + '\nthis.out = certDownloadAllowed(' + JSON.stringify(o.student) + ');', ctx);
    return ctx.out;
  };
  const kem = { id: 'STU-K', certNo: 'WF-2026-4821-QX' };
  const ok = [{ studentId: 'STU-K', approved: true }];
  eq(run({ student: kem, approvals: ok, gate: 'online' }), { allowed: true, reason: '' }, 'at home, issued and approved: the Download button works (no "sync first")');
  eq(run({ student: kem, approvals: ok, gate: 'lan' }), { allowed: false, collect: true, reason: '' }, 'signed in on the Centre\'s own network: collected there');
  eq(run({ student: kem, approvals: [{ studentId: 'STU-K', approved: false }], gate: 'online' }), { allowed: false, collect: true, reason: 'Its download has not been approved yet.' }, 'at home, not approved: "Collect your certificate at the Centre"');
  assert(run({ student: Object.assign({ certRevokedAt: '2026-10-01T00:00:00Z' }, kem), approvals: ok, gate: 'online' }).allowed === false, 'a withdrawn certificate: never');
  assert(/Sync first/.test(run({ student: kem, approvals: ok, gate: null, synced: false }).reason), 'staff and the Centre\'s PCs: unchanged (sync first)');
}
const certFns = fnSrc('homeCertDownload') + fnSrc('homeCertRecordDownload') + fnSrc('homeCertCollectBlock');
assert(/CESTISGate\.certTemplate\(key, 'bgPage1'\)/.test(certFns) && /certImageSave\(key, 'bgPage1', r1\.data\)/.test(certFns), 'its background comes through the gate (once; kept on the device for the next time)');
assert(/kind: 'certDownload', device: dev, n: n, certNo: String\(student\.certNo\)/.test(certFns) && /CESTISGate\.queue\('op'/.test(certFns), 'the download is counted for this device and sent through her outbox');
assert(/'cestisCertHomeCountSession'/.test(certFns), 'the running count is kept under a "Session" key (never in a backup)');
assert(/Collect your certificate at the Centre<\/button>/.test(certFns), 'the button itself says where to collect it when it cannot be downloaded');
assert(/if \(typeof cestisGateSession === 'function' && cestisGateSession\(\)\) homeCertRecordDownload\(student\);\n    else \{\n      CESTISCore\.certs\.recordDownload\(approval, certDeviceId\(\)\);/.test(HTML), 'at home the count goes through the outbox; elsewhere as before');
assert(/async function studentRefreshCertData\(\) \{[\s\S]{0,300}cestisGateSession\(\) && window\.CESTISGate\) \{[\s\S]{0,300}gatePullAndApply\(\)/.test(HTML), '"Check for Updates" at home asks for her records (never a Google sign-in)');
[['online', require(path.join(ROOT, 'cestis-core.js'))], ['Offline System', require(path.join(ROOT, 'Offline System', 'cestis-core.js'))]].forEach(([build, C]) => {
  const G = C.gate, me = { acct: 'U-K', stu: 'STU-K' };
  const slice = { data: { voctrain_students: [{ id: 'STU-K', certNo: 'WF-1' }], voctrain_certDownloadApprovals: [{ studentId: 'STU-K', approved: true }] } };
  const item = n => ({ kind: 'op', a: 'U-K', op: { id: 'OP-cd-D1-' + n, kind: 'certDownload', device: 'D-1', n: n, certNo: 'WF-1', at: '2026-10-29T12:00:00Z' } });
  assert(G.validateItem(item(1), me, slice).ok === true, build + ': her own download of her own approved certificate is taken');
  assert(G.validateItem(Object.assign(item(1), { op: Object.assign(item(1).op, { certNo: 'WF-2' }) }), me, slice).ok === false, build + ': another number is refused');
  const notYet = { data: { voctrain_students: slice.data.voctrain_students, voctrain_certDownloadApprovals: [{ studentId: 'STU-K', approved: false }] } };
  assert(G.validateItem(item(1), me, notYet).ok === false, build + ': not approved: refused');
  const store = { voctrain_certDownloadApprovals: [{ studentId: 'STU-K', approved: true, downloadCount: 2 }] };
  G.applyOps(store, [item(2).op], me); G.applyOps(store, [item(1).op], me); G.applyOps(store, [item(2).op], me);
  eq(store.voctrain_certDownloadApprovals[0].downloadsByDevice, { _earlier: 2, 'home-D-1': 2 }, build + ': counted once per device (the highest count), earlier downloads kept');
  eq(store.voctrain_certDownloadApprovals[0].downloadCount, 4, build + ': the total adds up');
});

/* ---------- OF-12. Her fees and her password, at home ---------- */
console.log('\nOF-12. My Fees (only hers: her figures, her receipts) and Change Password');
[['online', require(path.join(ROOT, 'cestis-core.js'))], ['Offline System', require(path.join(ROOT, 'Offline System', 'cestis-core.js'))]].forEach(([build, C]) => {
  const V = C.homeStudy.feeView;
  const v = V({ programme: 'Welding & Fabrication', tuition: 85000, paid: 999999, balance: 1, status: 'paid',
    receipts: [{ id: 'P1', receipt: 'R-0141', date: '2026-08-12', amount: 30000, method: 'Cash', term: 'Term 1' }, { id: 'P2', receipt: 'R-0187', date: '2026-10-20', amount: '20000', method: 'Bank transfer', term: 'Term 2' }] });
  eq([v.tuition, v.paid, v.balance, v.status], [85000, 50000, 35000, 'part-paid'], build + ': paid and balance are added up from her receipts, never taken from stored totals');
  eq(v.receipts.map(r => r.receipt), ['R-0187', 'R-0141'], build + ': newest receipt first');
  eq(V({ tuition: 1000, receipts: [{ id: 'a', amount: 1200 }] }).credit, 200, build + ': an overpayment shows as credit');
  eq(V({ tuition: 0, receipts: [] }).status, 'not-priced', build + ': no fee set yet');
  eq(V(null), null, build + ': nothing to show');
});
{
  const Core = require(path.join(ROOT, 'cestis-core.js'));
  const ctx = { CESTISCore: Core, escapeHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') };
  vm.createContext(ctx);
  vm.runInContext(['homeMoney', 'homeDay', 'homeFeesHtml'].map(fnSrc).join('\n') + '\nvar HOME_FEE_BADGE = {};', ctx);
  const html = vm.runInContext('homeFeesHtml(' + JSON.stringify({ programme: 'Welding', tuition: 85000, receipts: [{ id: 'P1', receipt: '<img src=x onerror=alert(1)>', date: '2026-08-12', amount: 30000, method: 'Cash', term: 'Term 1' }] }) + ', { builtAt: "2026-10-29T12:00:00Z" })', ctx);
  assert(/\$85,000\.00/.test(html) && /\$30,000\.00/.test(html) && /\$55,000\.00/.test(html), 'her programme fee, what she paid and her balance');
  assert(!/<img/.test(html) && /&lt;img/.test(html), 'everything from the record is escaped');
  assert(/My receipts/.test(html) && /Figures as of/.test(html) && !/Drive|Google|server|cloud|sync/i.test(html), 'her receipts, and when the figures are from — never where they are kept');
  const none = vm.runInContext('homeFeesHtml(null, { none: true })', ctx), off = vm.runInContext('homeFeesHtml(null, { err: "unreachable" })', ctx), old = vm.runInContext('homeFeesHtml(null, { err: "unknown-op" })', ctx);
  assert(/not on record yet/.test(none) && /when you have signal/.test(off) && /Ask the office for your balance/.test(old), 'none yet / no signal / an older gate: each said plainly');
}
assert(/data-page="s-fees" onclick="showPage\('s-fees'\)"[\s\S]{0,400}>My Fees<\/div>/.test(HTML) && /'s-fees':'My Fees'/.test(HTML), 'My Fees is in her menu, with its title');
assert(/<section class="page" id="page-s-fees">\s*<div id="sFeesContent"><\/div>/.test(HTML) && /if\(pageId === 's-fees'\) renderStudentFeesPage\(true\);/.test(HTML), 'its page asks for her fees as it opens');
const feeFn = fnSrc('renderStudentFeesPage') + fnSrc('homeLocalFees');
assert(/CESTISGate\.fees\(\)/.test(feeFn) && /CESTISGate\.storedFees\(\)/.test(feeFn), 'from home: her fees through the gate, kept on the device for when there is no signal');
assert(/CESTISCore\.gate\.home\.buildFees\(map, \[\{ acct: acct, stu: s\.id, student: s \}\]/.test(feeFn), 'on a computer that holds the fee roll: worked out by the same rule, for her alone');
assert(/class="tam-item tam-gate-only" id="tamChangePassword" onclick="closeAccountMenu\(\); homePasswordOpen\(\)"/.test(HTML) && /\.tam-gate-only \{ display:none; \}/.test(css) && /html\.gate-ns \.tam-gate-only \{ display:flex; \}/.test(css),
  'Change Password is in her account menu — only when she signed in from home');
['homePwOld', 'homePwNew', 'homePwNew2'].forEach(id => assert(new RegExp('<label for="' + id + '">').test(HTML), 'the ' + id + ' box has a real label'));
assert(/id="homePwOld" autocomplete="current-password"/.test(HTML) && /id="homePwNew" autocomplete="new-password"/.test(HTML), 'password managers know which box is which');
{
  const says = {};
  const mk = (answer) => {
    const el = {};
    const ctx = { cestisGateSession: () => true, window: {}, gateUnreachable: r => !r || r.error === 'unreachable', showToast: (t) => { says.toast = t; }, closeModal: () => { says.closed = true; },
      document: { getElementById: id => (el[id] = el[id] || { value: '', classList: { toggle() {} }, textContent: '' }) } };
    ctx.CESTISGate = { changePassword: async (o) => { says.sent = o; return answer; } };
    vm.createContext(ctx);
    const sayAt = HTML.indexOf('var HOME_PW_SAY = {');
    vm.runInContext(fnSrc('homePwSay') + '\nasync ' + fnSrc('homePasswordSubmit') + '\nvar _homePwBusy = false;\n' + HTML.slice(sayAt, HTML.indexOf('};', sayAt) + 2), ctx);
    return { ctx, el };
  };
  const tryIt = async (answer, old, nw, nw2) => {
    const { ctx, el } = mk(answer);
    el.homePwOld = { value: old }; el.homePwNew = { value: nw }; el.homePwNew2 = { value: nw2 == null ? nw : nw2 };
    el.homePwSay = { textContent: '', classList: { toggle() {} } };
    await vm.runInContext('homePasswordSubmit()', ctx);
    return el.homePwSay.textContent;
  };
  ASYNC.push((async () => {
    assert(/capital letter and a number/.test(await tryIt({ ok: true }, 'Old1pass', 'short')), 'a weak new password is turned away here first');
    assert(/do not match/.test(await tryIt({ ok: true }, 'Old1pass', 'Welder2026', 'Welder2027')), 'the two new ones must match');
    assert(/not right/.test(await tryIt({ ok: false, error: 'no-match' }, 'Wrong1', 'Welder2026')), 'a wrong current password is said plainly');
    assert(/15 minutes/.test(await tryIt({ ok: false, error: 'locked' }, 'Wrong1', 'Welder2026')), 'locked after too many tries (the gate\'s limit)');
    assert(/not available here yet/.test(await tryIt({ ok: false, error: 'unknown-op' }, 'Old1pass', 'Welder2026')), 'an older gate: ask the office');
    assert(/need a connection/.test(await tryIt({ ok: false, error: 'unreachable' }, 'Old1pass', 'Welder2026')), 'no signal: said so');
    says.closed = false;
    await tryIt({ ok: true }, 'Old1pass', 'Welder2026');
    assert(says.closed && /has been changed/.test(says.toast) && says.sent && says.sent.oldPassword === 'Old1pass' && says.sent.newPassword === 'Welder2026', 'changed: the window closes and she is told');
    console.log('  (password checks: done)');
  })().catch(e => assert(false, 'password checks: ' + e.message)));
}

Promise.all(ASYNC).then(() => {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
