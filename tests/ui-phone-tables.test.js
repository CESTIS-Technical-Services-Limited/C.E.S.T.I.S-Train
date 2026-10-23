/* Phone layouts for the busiest screens.

   What was wrong (UI audit: "Phone-friendly tables", "Phone/tablet card
   layout and sticky name column", "Mobile and tablet layouts for the wide
   financial tables", "Certificate pages need mobile/tablet layouts", "Make
   chat accessible and mobile-friendly", "Phone layout: keep the view
   switcher…", "Mobile/tablet layout for … the gradebook table", "Users
   table: … phone layout"): at 390px the attendance register showed the
   name, ID and course and none of the five day marks; the School Fee
   payments list showed the date and receipt number but not the amount; the
   Cashbook ledger, the certificate registry, the gradebook and the users
   tables hid their status, figures and buttons past the card's edge, and
   swiping to them scrolled the names away; Settings' last three tabs could
   not be reached at all; the chat left an empty strip under the message box;
   and in the video room the call buttons sat below the pictures and the 💬
   button did nothing.

   Now (index.html, School.Fee.html, CESTIS.Cashbook.html, Pages/*):
     - every busy table (class tbl-phone, or its own page's ids) scrolls
       inside its own card with the name pinned on the left (sticky), and its
       buttons, marks and boxes are at least 44px;
     - secondary columns (ID, course, date, receipt, cheque, category) fold
       into a phone-only line under the name, always escaped;
     - chat shows the room list or the conversation with 44px buttons; the
       video room stacks its pictures, the call buttons sit in a bar fixed to
       the bottom and the 💬 button opens chat over the room;
     - all of it is inside `@media screen and (max-width:768px)` — a
       computer's screen and a printed page are untouched.

   Pinned here from the real files (Node, no browser); the browser suite
   tests/browser/ui-preview-a.js drives the same screens for real.

   Run: node tests/ui-phone-tables.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html');
const FEE = read('School.Fee.html');
const CB = read('CESTIS.Cashbook.html');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('no ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
// Every `@media ... {` block body in a file, with its condition.
function mediaBlocks(src) {
  const out = []; const rx = /@media([^{]*)\{/g; let m;
  while ((m = rx.exec(src))) {
    let depth = 0, i = src.indexOf('{', m.index);
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
    out.push({ cond: m[1].trim(), body: src.slice(src.indexOf('{', m.index) + 1, i) });
    rx.lastIndex = i;
  }
  return out;
}
const phoneBlock = (src, needle) => mediaBlocks(src).filter(b => b.body.indexOf(needle) >= 0)[0] || { cond: '', body: '' };

console.log('Every busy table opts in to the phone layout');
{
  const pages = {
    'Pages/Attendance.html': /<table class="attendance-table tbl-phone"><thead id="attendanceTableHead">/,
    'Pages/Instructor-Attendance.html': /<table class="attendance-table tbl-phone"><thead id="iAttendanceTableHead">/,
    'Pages/Certificates.html': /<table class="tbl-phone"><thead><tr><th>Student<\/th><th>Certificate No\.<\/th>/,
    'Pages/Cert-Downloads.html': /<table class="tbl-phone">\s*<thead><tr><th>Student<\/th><th>Certificate No\.<\/th><th>Programme<\/th><th>Downloads<\/th>/,
    'Pages/Administration.html': /<table class="um-table tbl-phone tbl-phone-col2">/,
    'Pages/Verify-Users.html': /<table class="tbl-phone">\s*<thead><tr><th>Name<\/th><th>Email<\/th>/
  };
  Object.keys(pages).forEach(f => assert(pages[f].test(read(f)), f + ' marks its table tbl-phone'));
  assert(/<div class="table-wrapper"><table class="tbl-phone"><thead><tr><th>Student<\/th>';/.test(INDEX), 'the instructor gradebook table is tbl-phone');
}

console.log('The phone rules are screen-only and below 768px; a computer only learns to hide the phone lines');
{
  const b = phoneBlock(INDEX, '.tbl-phone th:first-child');
  assert(/^screen and \(max-width:768px\)$/.test(b.cond), 'index.html: the block is @media screen and (max-width:768px) (got "' + b.cond + '")');
  assert(/\.tbl-phone th:first-child, \.tbl-phone td:first-child,[^{]*\{[^}]*position:sticky; left:0;[^}]*background:var\(--bg-card\)/.test(b.body), 'the first column (the name) is pinned, on an opaque background');
  assert(/\.tbl-phone\.tbl-phone-col2 th:nth-child\(2\), \.tbl-phone\.tbl-phone-col2 td:nth-child\(2\)/.test(b.body), 'the users table pins its second column (after the tick boxes)');
  assert(/\.tbl-phone td \.btn, \.tbl-phone td button \{ min-height:44px; min-width:44px; \}/.test(b.body), 'buttons in those tables are at least 44x44');
  assert(/\.attendance-table \.att-col-id, \.attendance-table \.att-col-course \{ display:none; \}/.test(b.body), 'the register folds its ID and course columns');
  assert(/\.attendance-table select\.att-cell \{ width:112px !important; min-height:44px;[^}]*font-size:16px !important; \}/.test(b.body), 'the day marks are 44px tall at 16px (no zoom-in on tap)');
  assert(/\.um-actions button \{ width:44px; height:44px; \}/.test(b.body), 'user actions are 44x44');
  assert(/\.tabs \{ flex-wrap:wrap; \}/.test(b.body), 'tab rows wrap, so Settings\' seven tabs are all reachable');
  // Outside any media block, the only new rule is the hidden phone line.
  const outside = INDEX.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  assert(/\.att-phone-sub \{ display:none; \}/.test(outside), 'a computer never shows the phone-only line under a name');
  const feeB = phoneBlock(FEE, '.fee-phone-sub { display: block');
  assert(/^screen and \(max-width: 768px\)$/.test(feeB.cond), 'School Fee: screen-only phone block (got "' + feeB.cond + '")');
  const cbB = phoneBlock(CB, '.cb-phone-sub');
  assert(/^screen and \(max-width:768px\)$/.test(cbB.cond), 'Cashbook: screen-only phone block — a printed A4 page is under 768px wide (got "' + cbB.cond + '")');
}

console.log('The register\'s phone line carries the ID and course, escaped');
{
  const head = extractFunction(INDEX, 'attendanceHeadHtml');
  assert(/<th class="att-col-id">ID<\/th>/.test(head) && /<th class="att-col-course">Course<\/th>/.test(head), 'the ID and Course headers are marked for folding');
  const grid = extractFunction(INDEX, 'renderAttendanceGrid');
  assert(/'<span class="att-phone-sub">' \+ escapeHtml\(s\.id\) \+ \(cfg\.showCourse \? ' · ' \+ escapeHtml\(s\.course\) \+ lockBadge : ''\) \+ '<\/span><\/td>'/.test(grid), 'the line under the name is the escaped ID (and course)');
  assert(/<td class="att-col-id" style="font-family:monospace;font-size:12px;">' \+ escapeHtml\(s\.id\)/.test(grid) && /<td class="att-col-course">' \+ escapeHtml\(s\.course\)/.test(grid), 'and the columns themselves are unchanged apart from their class');
  // Run the real header builder.
  const ctx = vm.createContext({ CESTISCore: { attendance: { DAYS: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] } }, attendanceShortDate: d => d.slice(5) });
  vm.runInContext(head, ctx);
  const h = vm.runInContext('attendanceHeadHtml(["2026-10-19","2026-10-20","2026-10-21","2026-10-22","2026-10-23"], "2026-10-22", { showCourse: true, page: "admin" })', ctx);
  assert((h.match(/<th[ >]/g) || []).length === 8 && h.indexOf('<tr><th>Student</th><th class="att-col-id">ID</th><th class="att-col-course">Course</th>') === 0, 'the real header: Student, ID, Course, five days');
}

console.log('School Fee and Cashbook: details fold under the name, escaped; nothing the search reads changes');
{
  const pay = extractFunction(FEE, 'renderPaymentsTable');
  assert(/<td>\$\{payment\.studentName\}<span class="fee-phone-sub">\$\{feeAttr\(payment\.date\)\} · \$\{feeAttr\(receipt\)\} · \$\{feeAttr\(payment\.method\)\}<\/span><\/td>/.test(pay), 'payments: date · receipt · method under the trainee, escaped');
  assert(/data-search="\$\{feeAttr\(search\)\}" data-date="\$\{feeAttr\(payment\.date\)\}"/.test(pay), 'payments: the search and date filters still read the row\'s own data');
  const stu = extractFunction(FEE, 'renderStudentsTable');
  assert(/<td>\$\{student\.name\}\$\{keptSep\}<span class="fee-phone-sub">\$\{feeAttr\(student\.id\)\} · \$\{feeAttr\(student\.skillArea\)\}<\/span><\/td>/.test(stu), 'students: ID · skill area under the name, escaped');
  const feeB = phoneBlock(FEE, '.fee-phone-sub { display: block').body;
  assert(/#paymentsTable td:nth-child\(3\)[^{]*\{[^}]*position: sticky; left: 0;/.test(feeB), 'the trainee column is pinned in both lists');
  assert(/#studentsTable \.action-btn, #paymentsTable \.action-btn \{ min-height: 44px; min-width: 44px;/.test(feeB), 'row buttons are at least 44x44');
  const tx = extractFunction(CB, 'renderTransactions');
  assert(/<td>\$\{t\.details\}<span class="cb-phone-sub">\$\{escapeHtml\(t\.date \|\| ''\)\}\$\{t\.cheque \? ' · #' \+ escapeHtml\(t\.cheque\) : ''\} · \$\{escapeHtml\(t\.category \|\| ''\)\}<\/span><\/td>/.test(tx), 'cashbook: date · cheque · category under the details, escaped');
  const cbB = phoneBlock(CB, '.cb-phone-sub').body;
  assert(/tbody td:nth-child\(3\) \{[^}]*position:sticky; left:0;/.test(cbB) && /\.btn-sm \{ min-width:44px; min-height:44px; \}/.test(cbB), 'the details are pinned and the row buttons are 44px');
  assert(/\.cb-phone-sub \{ display:none; \}/.test(CB.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '')), 'a computer never shows the cashbook phone line');
}

console.log('Gradebook marking rows and the chat and video room on a phone');
{
  const gb = extractFunction(INDEX, 'renderInstructorGradebook');
  assert(/class="form-control gb-grade-input"/.test(gb) && /class="btn btn-sm btn-primary gb-grade-btn"/.test(gb) && /<div class="gb-sub-row"/.test(gb), 'marking rows carry their phone classes');
  const b = phoneBlock(INDEX, '.tbl-phone th:first-child').body;
  assert(/\.gb-sub-row \.gb-grade-input \{ width:76px !important; height:44px !important; font-size:16px !important; \}/.test(b), 'the mark box is 44px tall at 16px');
  assert(/\.lms-chat-header-actions button,\s*\.lms-chat-main-header-left \.back-btn \{ width:44px; height:44px; min-width:44px; \}/.test(b.replace(/\.lms-chat-sidebar-actions button, /, '')), 'chat header buttons are 44x44');
  assert(/\.lms-chat-input-area \.attach-btn, \.lms-chat-input-area \.send-btn, \.lms-chat-input-area \.poll-btn,\s*\.lms-chat-input-area button \{ width:44px; height:44px; min-width:44px; \}/.test(b), 'the message-box buttons are 44x44 (beating the 40px class rules)');
  const fb = phoneBlock(FEE, '.fee-phone-sub { display: block').body;
  assert(/\.form-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(fb), 'School Fee: the Record Payment form no longer pans the page sideways');
  assert(/\.lms-chat-info-panel:not\(\.open\) \{ display:none; \}/.test(b), 'a closed Chat Info leaves no empty strip under the message box');
  assert(/body:not\(\.vc-fullscreen-mode\) \.vc-conference-body \.video-controls \{\s*position:fixed; left:0; right:0; bottom:0;/.test(b), 'the call buttons sit in a bar along the bottom of the screen');
  assert(/body:not\(\.vc-fullscreen-mode\) \.vc-conference-body \.video-controls \.vc-btn \{ width:44px; height:44px;/.test(b), 'and are 44x44');
  assert(/body\.vc-show-sidepanel:not\(\.vc-fullscreen-mode\) \.vc-conference-body \.vc-side-panel \{\s*display:flex;[^}]*position:fixed; top:var\(--topbar-h\);/.test(b), 'the 💬 button opens chat and participants over the room, below the top bar');
  assert(/body:not\(\.vc-fullscreen-mode\) \.vc-conference-body \.video-grid \{ grid-template-columns:1fr;/.test(b), 'the pictures stack one under another');
  assert(/exitVideoRoom|document\.body\.classList\.remove\('vc-fullscreen-mode', 'vc-host-only-mode', 'vc-is-host', 'vc-show-sidepanel'\)/.test(INDEX), 'leaving the room still clears the open chat panel');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
