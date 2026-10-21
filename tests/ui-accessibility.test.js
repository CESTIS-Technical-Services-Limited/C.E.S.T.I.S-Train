/* The dashboard can be used with a keyboard, read on a phone, and trusted
   when it says something went wrong.

   What was wrong (the UI audit, ui-06 … ui-19):
     - every sidebar entry, section toggle and dashboard tile was a
       <div onclick> with no Tab stop, so a keyboard user signed in and could
       go nowhere; the shell told screen readers it was an "application";
     - sign-in was not a form: Enter did nothing, no label named its field,
       password managers could not see it;
     - toasts were green text on red/orange/blue (1.4-1.8:1) and vanished in
       3s; the styled alert() ran every line into one and pushed its OK button
       off a phone's screen; dialogs never took focus or said they were dialogs;
     - helper text (--text-muted) was 2.7:1 on a card;
     - every first visit said "Storage quota may be full" — the start-up demo
       purge ran a full save before the page had finished loading, and the
       catch-all reported the resulting TypeError as a full disk;
     - LIVE and NEW badges were printed into the sidebar for everybody, always.

   Pinned here from the real files (Node, no browser); the browser suite
   tests/browser/ui-accessibility.js drives the same things for real.

   Run: node tests/ui-accessibility.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function attrsOf(tag) {
  const a = {};
  const rx = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g; let m;
  while ((m = rx.exec(tag))) a[m[1].toLowerCase()] = m[2];
  return a;
}
// WCAG 2 contrast.
function lum(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function token(block, name) {
  const m = new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,6})').exec(block);
  return m ? m[1] : null;
}
function rule(src, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = src.match(re);
  return m ? m[1] : null;
}

/* ---------- 1. Clickable elements become keyboard controls (ui-06) ---------- */
console.log('Every clickable sidebar entry, toggle and tile is a keyboard control');
const K = Core.ui.keyboardRoleFor;
let d = K('DIV', { onclick: "showPage('students')", 'class': 'nav-item' });
assert(d && d.tabindex === '0' && d.role === 'link', 'a sidebar entry is a link with a Tab stop');
d = K('DIV', { onclick: 'toggleNavSection(this)', 'class': 'nav-section-label nav-section-toggle collapsed' });
assert(d && d.role === 'button' && d.expanded === false, 'a collapsed section toggle is a button that says it is collapsed');
assert(K('DIV', { onclick: 'toggleNavSection(this)', 'class': 'nav-section-toggle' }).expanded === true, 'an open one says it is open');
d = K('DIV', { onclick: "openModal('createExamModal')", 'class': 'quick-action-btn' });
assert(d && d.role === 'button', 'a dashboard tile is a button');
assert(K('SPAN', { onclick: "openForgotPassword('admin')" }).role === 'button', 'a clickable span is a button');
d = K('TR', { onclick: 'openRow(1)' });
assert(d && d.role === null && d.tabindex === '0', 'a clickable table row keeps its row meaning and gets a Tab stop');
assert(K('DIV', { onclick: 'x()', role: 'tab' }).role === null, 'an element that already says it is a tab stays a tab');
assert(K('BUTTON', { onclick: 'x()' }) === null && K('A', { onclick: 'x()', href: '#' }) === null && K('INPUT', { onclick: 'x()' }) === null,
  'real buttons, links and inputs are left alone');
assert(K('A', { onclick: 'x()' }).role === 'link', 'an <a onclick> with no href becomes a reachable link');
assert(K('DIV', { onclick: 'x()', tabindex: '-1' }) === null, 'the page\'s own tabindex decision stands');
assert(K('DIV', { onclick: 'event.stopPropagation()' }) === null, 'a dialog box that only stops clicks reaching its backdrop is not a control');
assert(K('DIV', { onclick: 'if(event.target===this)closeRegistrationModal()', 'class': 'reg-modal-overlay' }) === null, 'a click-outside-to-close backdrop is not a control');
assert(K('DIV', { onclick: 'closeMobileSidebar()', 'class': 'sidebar-overlay' }) === null, 'nor is the phone menu\'s dimmed backdrop');
assert(K('DIV', { onclick: 'x()', role: 'dialog' }) === null, 'nor anything that says it is a dialog');
assert(K('DIV', {}) === null && K('DIV', { onclick: '  ' }) === null, 'an element with no click handler is left alone');
assert(K('svg', { onclick: 'x()' }).role === 'button', 'tag names are read case-insensitively (SVG)');

// Every onclick element the sidebar builders print is covered.
['buildAdminSidebar', 'buildStudentSidebar', 'buildInstructorSidebar', 'buildAdminStaffSidebar', 'buildCmcSidebar'].forEach(function (fn) {
  const body = extractFunction(INDEX, fn);
  const tags = body.match(/<(div|span|li|a|img)\b[^>]*onclick=[^>]*>/g) || [];
  const left = tags.filter(t => {
    const name = /^<([a-z]+)/.exec(t)[1];
    const a = attrsOf(t.replace(/\\'/g, "'").replace(/'\s*\+[^+]*\+\s*'/g, 'X'));
    if (!a.onclick) a.onclick = 'x()';
    return !K(name, a);
  });
  assert(tags.length > 0, fn + '() prints clickable entries');
  assert(left.length === 0, fn + '(): every clickable entry becomes a keyboard control — not: ' + left.slice(0, 3).join(' | '));
});
// The enhancer is wired: one delegated Enter/Space handler, a MutationObserver.
const kb = INDEX.slice(INDEX.indexOf('(function keyboardClickables()'), INDEX.indexOf('(function keyboardClickables()') + 4000);
assert(/CESTISCore\.ui\.keyboardRoleFor/.test(kb) && /MutationObserver/.test(kb), 'index.html marks clickable elements up as they appear, using the shared rule');
assert(/e\.key !== 'Enter' && e\.key !== ' '/.test(kb) && /el\.click\(\)/.test(kb), 'and Enter or Space on one does what a click does');
assert(!/id="appShell"[^>]*role="application"/.test(INDEX), 'the app shell is no longer role="application"');
assert(!/id="sidebarNav"[^>]*role="menubar"/.test(INDEX), 'and the sidebar is no longer a menubar');
assert(/aria-current', 'page'\)/.test(extractFunction(INDEX, 'showPage')), 'showPage marks the open section aria-current="page"');
assert(/aria-expanded/.test(extractFunction(INDEX, 'toggleNavSection')), 'a section toggle keeps aria-expanded in step');
assert(/\[data-kb-click\]:focus-visible/.test(INDEX), 'and every such control shows a visible focus ring');

/* ---------- 2. Sign-in is a form (ui-08) ---------- */
console.log('Each role card signs in through a real form');
const landing = INDEX.slice(INDEX.indexOf('<div class="role-cards'), INDEX.indexOf('<!-- Certificate Check Button -->'));
const ROLES = [['admin', 'handleAdminClick'], ['student', 'handleStudentClick'], ['instructor', 'handleInstructorClick'],
  ['adminStaff', 'handleAdminStaffClick'], ['cmc', 'handleCmcClick']];
ROLES.forEach(function (r) {
  const id = r[0], handler = r[1];
  const login = new RegExp('<form[^>]*onsubmit="event\\.preventDefault\\(\\); ' + handler + '\\(\\);"[^>]*>[\\s\\S]*?<div class="role-login" id="' + id + 'Login">([\\s\\S]*?)</form>').exec(landing);
  assert(!!login, id + ': the card\'s fields and its Enter button are one <form> whose submit runs ' + handler + '()');
  if (!login) return;
  const block = login[0];
  [id + 'User', id + 'Pass'].forEach(function (f) {
    assert(new RegExp('<label for="' + f + '">').test(block), id + ': #' + f + ' is named by its label');
  });
  assert(new RegExp('id="' + id + 'User"[^>]*autocomplete="username"').test(block), id + ': username field says autocomplete="username"');
  assert(new RegExp('id="' + id + 'Pass"[^>]*autocomplete="current-password"').test(block), id + ': password field says autocomplete="current-password"');
  const btn = /<button[^>]*class="role-enter-btn"[^>]*>/.exec(block);
  assert(btn && /type="submit"/.test(btn[0]) && !/onclick/.test(btn[0]), id + ': the Enter button submits the form and has no onclick of its own (no double sign-in)');
  const others = block.match(/<button(?![^>]*role-enter-btn)[^>]*>/g) || [];
  assert(others.every(b => /type="button"/.test(b)), id + ': its other buttons (Forgot password, Google, Register) never submit');
  assert(!/<span class="register-link"/.test(block), id + ': "Forgot password?" is a button, not a span');
});
assert(!/placeholder="cestisadmin"|placeholder="adminstaff"|placeholder="cmcadmin"/.test(landing), 'the cards no longer print the built-in usernames as hints');
assert(/@media \(max-width:768px\) \{ \.role-login input, \.role-login select \{ font-size:16px; \} \}/.test(INDEX), 'sign-in fields are 16px on phones (iOS stops zooming the page)');

/* ---------- 3. Toasts and the styled alert (ui-09, ui-10) ---------- */
console.log('Toasts are readable, announced, and an error stays');
const root = INDEX.slice(INDEX.indexOf(':root {'), INDEX.indexOf('}', INDEX.indexOf(':root {')));
const bgCard = token(root, 'bg-card');
[['error', '#toastContainer .toast-error'], ['warning', '#toastContainer .toast-warning'], ['info', '#toastContainer .toast-info']].forEach(function (p) {
  const r = rule(INDEX, p[1]);
  assert(!!r, 'a ' + p[0] + ' toast has its own colours');
  if (!r) return;
  const bg = /background\s*:\s*(#[0-9a-fA-F]{3,6})/.exec(r), fg = /(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6})/.exec(r);
  const c = bg && fg ? contrast(fg[1], bg[1]) : 0;
  assert(c >= 4.5, 'a ' + p[0] + ' toast reads at ' + c.toFixed(2) + ':1 (needs 4.5)');
});
const green = token(root, 'green');
assert(contrast(green, bgCard) >= 4.5, 'the default (success) toast, green on a card, reads at ' + contrast(green, bgCard).toFixed(2) + ':1');
const P = Core.ui.toastPolicy;
assert(P('error').role === 'alert' && P('error').live === 'assertive', 'an error is announced at once');
assert(['warning', 'info', '', undefined].every(t => P(t).role === 'status' && P(t).live === 'polite'), 'everything else is a polite status');
assert(P('error').ms >= 15000 && P('warning').ms >= 8000 && P('').ms >= 3500, 'errors stay far longer than the old 3s (' + P('error').ms + 'ms)');
const toastFn = extractFunction(INDEX, 'showToast');
assert(/CESTISCore\.ui\.toastPolicy/.test(toastFn) && /toast-close/.test(toastFn) && /mouseenter/.test(toastFn) && /focusin/.test(toastFn),
  'showToast uses the policy, has a close button, and pauses while pointed at or focused');

console.log('The styled alert keeps its lines, fits the screen and lets go of its keys');
const msgRule = rule(INDEX, '.cestis-alert-msg');
assert(/white-space:pre-line/.test(msgRule) && /overflow-y:auto/.test(msgRule), 'the message keeps its line breaks and scrolls');
const boxRule = rule(INDEX, '.cestis-alert-box');
assert(/max-height:calc\(100vh - 40px\)/.test(boxRule) && /flex-direction:column/.test(boxRule), 'the box never grows past the screen, so OK stays on it');
const alertSrc = INDEX.slice(INDEX.indexOf('window.alert = function(msg)'), INDEX.indexOf('// ---------- UX: Styled Confirm Replacement'));
const dismissSrc = alertSrc.slice(alertSrc.indexOf('function dismiss()'), alertSrc.indexOf('function onKey('));
assert(/removeEventListener\('keydown', onKey, true\)/.test(dismissSrc), 'closing an alert by ANY route removes its key listener (it used to stay after a click)');
assert(/isTop\(\)/.test(alertSrc) && /returnFocus/.test(alertSrc), 'only the top alert answers Enter/Escape, and focus goes back afterwards');
const AK = Core.ui.alertKind;
assert(AK('✅ Merge from cloud completed!') === 'success' && AK('❌ Failed') === 'error' && AK('ℹ Note') === 'info' &&
  AK('Please fill in all fields') === 'warning' && AK('  ✓ Saved') === 'success', 'the icon follows what the message says');

/* ---------- 4. Dialogs (ui-19) ---------- */
console.log('Dialogs say what they are, take focus and give it back');
const dlg = INDEX.slice(INDEX.indexOf('function cestisMarkDialog('), INDEX.indexOf('(function keyboardClickables()'));
assert(/setAttribute\('role', 'dialog'\)/.test(dlg) && /aria-modal', 'true'/.test(dlg) && /aria-labelledby/.test(dlg), 'a .modal-overlay\'s box becomes a named, modal dialog');
assert(/attributeFilter: \['class'\]/.test(dlg) && /cestisDialogOpened\(r\.target\)/.test(dlg) && /cestisDialogClosed\(r\.target\)/.test(dlg),
  'whatever opens or closes one (openModal, ✕, Escape, a class toggle) is noticed');
assert(/_cestisDialogReturn\.set\(overlay, before\)/.test(dlg) && /back\.focus\(\)/.test(dlg), 'focus returns to whatever opened it');
const trap = INDEX.slice(INDEX.indexOf('// ---------- UX: Focus Trap for Modals'), INDEX.indexOf('// ---------- ACCESSIBILITY: dialogs announce themselves'));
assert(/!activeModal\.contains\(document\.activeElement\)/.test(trap) && /cestisTopModal\(\)/.test(trap), 'Tab pulls focus into the top dialog when it is outside');

/* ---------- 5. Contrast tokens (ui-13) ---------- */
console.log('Helper text reads at 4.5:1 on every card');
function checkPalette(where, block, bgs, label) {
  const muted = token(block, 'text-muted'), sec = token(block, 'text-secondary');
  bgs.forEach(function (b) {
    const bg = /^#/.test(b) ? b : token(block, b);
    if (!bg) return;
    const c = contrast(muted, bg);
    assert(c >= 4.5, where + (label ? ' (' + label + ')' : '') + ': --text-muted ' + muted + ' on ' + b + ' is ' + c.toFixed(2) + ':1');
  });
  return { muted, sec };
}
const main = checkPalette('index.html', root, ['bg-card', 'bg-card-hover', 'bg-primary', 'bg-secondary', 'bg-input']);
assert(lum(main.muted) < lum(main.sec), 'index.html: muted text is still a step below secondary text');
['Transcript-Grades.html', 'Student-Progress.html', 'Cert-Transcript-Requests.html', 'Qual-Plan-Curriculum.html'].forEach(function (f) {
  const src = read(f);
  const r = src.slice(src.indexOf(':root'), src.indexOf('}', src.indexOf(':root')));
  checkPalette(f, r, ['bg-card', 'bg-card-hover', 'bg-primary', 'bg-input']);
  assert(token(r, 'text-muted') === main.muted, f + ' uses the dashboard\'s muted colour');
});
// The time clock has a light and a dark theme (and is embedded in the dashboard too).
[['Staff.Clock.in.html', ':root', 'body.dark-mode {'], ['index.html', '.tt-scope {', '.tt-scope.dark-mode {']].forEach(function (p) {
  const src = read(p[0]);
  const li = src.indexOf(p[1], p[0] === 'index.html' ? src.indexOf('<style id="ttAppStyles">') : 0);
  const light = src.slice(li, src.indexOf('}', src.indexOf('--text-muted', li)));
  const di = src.indexOf(p[2]);
  const dark = src.slice(di, src.indexOf('}', di));
  checkPalette(p[0], light, ['#ffffff', '#f0fdfa', '#f0f9ff', '#ecfeff'], 'clock-in light');
  checkPalette(p[0], dark, ['#1e293b', '#0f172a', '#1a1a2e'], 'clock-in dark');
});
const ps = read('Staff.Payslip.html');
const psRoot = ps.slice(ps.indexOf(':root{'), ps.indexOf('}', ps.indexOf(':root{')));
assert(contrast(/--text-muted:(#[0-9a-f]{6})/i.exec(psRoot)[1], /--card:(#[0-9a-f]{6})/i.exec(psRoot)[1]) >= 4.5, 'Staff.Payslip.html: muted text on a card reads at 4.5:1');

/* ---------- 6. The first visit says nothing about a full disk (ui-11) ---------- */
console.log('The start-up demo purge saves only what it changed, and says nothing false');
const purgeStart = INDEX.indexOf('(function purgeLegacyDemoData() {');
const purgeSrc = INDEX.slice(purgeStart, INDEX.indexOf('})();', purgeStart) + 5);
function runPurge(stored) {
  const writes = [], saved = [];
  let fullSaves = 0;
  const store = Object.assign({}, stored);
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    CESTISStore: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); writes.push(k); } },
    students: [{ id: 'STU-2026001' }, { id: 'STU-real' }], exams: [{ id: 'EXAM-001' }, { id: 'EX-real', title: 'Real' }],
    announcements: [{ id: 3 }, { id: 'A-real' }], calendarEvents: [{ title: 'Staff Meeting' }, { title: 'Real' }],
    attendanceRecords: [], instructorData: [{ id: 'INS-2026001' }], examResults: [], notifications: [{}],
    userAccounts: [{ id: 'USR-001' }, { id: 'USR-002' }],
    saveUserAccounts() { saved.push('users'); },
    saveCollection(k, v) { saved.push(k); return true; },
    syncStampAll() {}, scheduleDebouncedCloudSave() {},
    saveState() { fullSaves++; }
  };
  vm.createContext(sb);
  vm.runInContext(purgeSrc, sb);
  return { sb, writes, saved, fullSaves, store };
}
let run = runPurge({});
assert(run.fullSaves === 0, 'the purge no longer runs a full saveState() while the page is still loading');
['voctrain_students', 'voctrain_exams', 'voctrain_announcements', 'voctrain_calendarEvents', 'voctrain_attendance',
 'voctrain_instructorData', 'voctrain_examResults'].forEach(k => assert(run.saved.indexOf(k) !== -1, 'it still saves the ' + k + ' it purged'));
assert(run.saved.indexOf('users') !== -1, 'and the accounts');
assert(run.writes.join() === 'voctrain_dataVersion' && run.store.voctrain_dataVersion === '4', 'and writes nothing else raw — just the data version');
assert(!run.saved.some(k => /chat|adr|certTemplate|Tombstones/i.test(k)), 'the chat, Duty Register, certificate maps and tombstones (not loaded yet) are not written over');
assert(run.sb.students.length === 1 && run.sb.exams.length === 1, 'the demo records are still removed');
run = runPurge({ voctrain_dataVersion: '4' });
assert(run.saved.length === 0 && run.writes.length === 0, 'a device already purged is not touched');

// saveState's catch: a full disk says so; anything else is reported as what it is.
const saveStateSrc = extractFunction(INDEX, 'saveState');
function saveWith(err) {
  const toasts = [], logs = [];
  const sb = {
    console: { warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), log() {} },
    currentRole: 'admin', syncStampAll() {}, students: [],
    saveCollection() { throw err; },
    showToast: (m, t) => toasts.push({ m, t }),
    scheduleDebouncedCloudSave() {}, CESTISCore: { emit() {} }, window: {}
  };
  sb.window.CESTISCore = sb.CESTISCore;
  vm.createContext(sb);
  vm.runInContext(saveStateSrc + '\nsaveState();', sb);
  return { toasts, logs };
}
let r1 = saveWith(new TypeError("Cannot read properties of undefined (reading 'length')"));
assert(r1.toasts.length === 1 && !/quota/i.test(r1.toasts[0].m) && r1.toasts[0].t === 'error', 'a coding error is not reported as a full disk');
assert(r1.logs.some(l => /save stopped part-way/.test(l)), 'and it is logged in full for whoever investigates');
const q = new Error('The quota has been exceeded.'); q.name = 'QuotaExceededError';
let r2 = saveWith(q);
assert(r2.toasts.length === 1 && /Storage quota may be full/.test(r2.toasts[0].m), 'a real quota error keeps its warning');

/* ---------- 7. Sidebar badges (ui-17) ---------- */
console.log('LIVE only while a class is live; no permanent NEW');
['buildAdminSidebar', 'buildStudentSidebar', 'buildInstructorSidebar', 'buildAdminStaffSidebar'].forEach(function (fn) {
  const body = extractFunction(INDEX, fn);
  assert(!/>NEW<\/span>/.test(body), fn + '() prints no permanent NEW badge');
  (body.match(/<span class="nav-badge[^"]*"[^>]*>LIVE<\/span>/g) || []).forEach(function (b) {
    assert(/nav-live-badge/.test(b) && /\bhidden\b/.test(b), fn + '(): its LIVE badge starts hidden and is driven by refreshNavLiveBadges');
  });
});
const L = Core.ui.liveSessionsFor;
const today = '2026-10-21';
const same = (a, b) => String(a).toLowerCase().indexOf(String(b).toLowerCase()) === 0;
const S = [
  { id: 1, course: 'Welding Level 2', date: today, status: 'live', createdBy: 'Ann' },
  { id: 2, course: 'Plumbing', date: today, status: 'scheduled', createdBy: 'Bob' },
  { id: 3, course: 'Plumbing', date: '2026-10-20', status: 'live', createdBy: 'Bob' },
  { id: 4, course: 'Carpentry', date: today, status: 'completed', createdBy: 'Cy' }
];
assert(L(S, { role: 'admin' }, today).map(s => s.id).join() === '1', 'an administrator sees the one class live today');
assert(L(S, { role: 'adminstaff' }, today).length === 1, 'so does admin staff');
assert(L(S, { role: 'student', course: 'Welding' }, today, same).length === 1, 'a Welding trainee sees their programme\'s live class');
assert(L(S, { role: 'student', course: 'Plumbing' }, today, same).length === 0, 'a Plumbing trainee sees none (scheduled is not live; yesterday\'s left-over "live" is not live)');
assert(L(S, { role: 'instructor', course: 'Carpentry', name: 'Ann' }, today, same).length === 1, 'an instructor sees a class they host');
assert(L(S, { role: 'cmc' }, today).length === 0 && L(null, { role: 'admin' }, today).length === 0, 'the board has no video section; no sessions, no badge');
assert(/refreshNavLiveBadges/.test(INDEX.slice(INDEX.indexOf('(function watchNavLiveBadges()'), INDEX.indexOf('(function watchNavLiveBadges()') + 800)) &&
  /cestis:state-saved/.test(INDEX.slice(INDEX.indexOf('(function watchNavLiveBadges()'), INDEX.indexOf('(function watchNavLiveBadges()') + 800)),
  'the badge is redrawn when the sidebar is built and after every save');

/* ---------- 8. Phone layouts (ui-18) ---------- */
console.log('Student Progress and the transcript fit a phone');
const sp = read('Student-Progress.html');
const spPhone = sp.slice(sp.indexOf('@media (max-width: 600px)'));
assert(/\.pipeline \{ flex-wrap: wrap/.test(spPhone) && /width: 100% !important/.test(spPhone), 'Student Progress: the stage tiles wrap and the filters take the full width on a phone');
const tgSrc = read('Transcript-Grades.html');
assert(/\.tg-card-body \{ overflow-x: auto/.test(tgSrc), 'Transcript-Grades: a wide table scrolls inside its card, not off its edge');
assert(/\.tg-table th \{ width: auto !important; \}/.test(tgSrc), 'and the fixed column widths give way on a phone');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
