/* The browser's prompt() boxes that collected an amount, a name, a reason or
   a number are labelled forms now (UI preview, owner's item 8).

   What was wrong: a dozen places asked with window.prompt() — a box the page
   cannot label or style, that cannot say what is wrong with what was typed
   (a bad amount was refused only after the box had gone, and the typing was
   lost), that chained two boxes for two fields, and that is awkward on a
   phone. The duty register's "reason for rejecting" box rejected the work
   even when the person pressed Cancel.

   Each converted place asks through one small shared form
   (cestis-form-modal.js, CESTISForm.ask — the calendar event form's pattern
   made reusable) and then does exactly what the prompt's answer used to do.
   Pinned here from the real files: what is left as a prompt and why, and for
   every converted place, that the same data reaches the same calls.

   Run: node tests/form-modal.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INDEX = read('index.html'), PAYSLIP = read('Staff.Payslip.html'), CASHBOOK = read('CESTIS.Cashbook.html'), SAPP = read('staff-appraisals.js');
const FORM = read('cestis-form-modal.js');
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('no ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const code = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const prompts = src => (code(src).match(/[^.\w]prompt\(/g) || []).length;
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- 1. What is still a prompt, and why ---------- */
console.log('Only the prompts that collect nothing, or guard a sign-in, are left');
assert(prompts(INDEX) === 1 && /catch\(e\) \{ prompt\('Copy this invite link:', link\); \}/.test(INDEX),
  'index.html: one left — the invite link shown to copy by hand when the clipboard refuses (it collects nothing)');
assert(prompts(CASHBOOK) === 0, 'Cashbook: none left');
assert(prompts(PAYSLIP) === 2 && /prompt\('Admin password required to '/.test(PAYSLIP) && /Type RESET \(in capitals\) to confirm/.test(PAYSLIP),
  'Payroll: two left — the payroll edit password (a synchronous gate for every edit) and the typed RESET confirmation');
assert(prompts(SAPP) === 1 && /if \(root\.CESTISForm && typeof root\.CESTISForm\.ask === 'function'\)/.test(SAPP),
  'staff-appraisals.js: the prompt remains only as the fallback where no form library is loaded');
['index.html', 'Staff.Payslip.html', 'CESTIS.Cashbook.html'].forEach(f =>
  assert(/<script src="cestis-core\.js\?v=[^"]+"><\/script>\n<script src="cestis-form-modal\.js\?v=[^"]+" defer><\/script>/.test(read(f)), f + ' loads the form library (deferred: nothing needs it until a button is pressed)'));

/* ---------- 2. The form library's own checks ---------- */
console.log('The form checks what it can before anything is done');
const sb0 = { window: {} }; sb0.window = sb0; vm.createContext(sb0); vm.runInContext(FORM, sb0);
const check = sb0.CESTISForm.checkField;
assert(/Please fill in “Title”/.test(check({ name: 't', label: 'Title', required: true }, '   ')), 'a required field left blank is named');
assert(check({ name: 'g', label: 'Gross', type: 'number', min: 0 }, '287,829.27') === '', 'an amount with thousands commas is a number');
assert(/must be a number/.test(check({ name: 'g', label: 'Gross', type: 'number' }, '287829.27x')), 'letters in an amount are refused, with an example');
assert(/cannot be less than 0/.test(check({ name: 'g', label: 'Gross', type: 'number', min: 0 }, '-5')), 'a negative amount is refused');
assert(/too long/.test(check({ name: 'n', label: 'Name', maxlength: 5 }, 'Rashard Bennett')), 'too long is refused');
const noHtml = code(FORM);
assert(!/innerHTML|insertAdjacentHTML|outerHTML/.test(noHtml), 'the form writes every label, value and message as text, never HTML');
assert(/role', 'dialog'/.test(FORM) && /aria-modal', 'true'/.test(FORM) && /setAttribute\('for', fid\)/.test(FORM) && /role', 'alert'/.test(FORM),
  'it is a modal dialog, each field has its label, and the error line is announced');

/* ---------- 3. The same data reaches the same calls ---------- */
console.log('Each converted place does exactly what the prompt\'s answer used to do');
function sandbox(src, names, extra, answer) {
  const sb = Object.assign({ asked: [], calls: [], console: { log() {}, warn() {} } }, extra || {});
  sb.CESTISForm = { ask: o => { sb.asked.push(o); return Promise.resolve(typeof answer === 'function' ? answer(o) : answer); } };
  vm.createContext(sb);
  names.forEach(n => vm.runInContext(extractFunction(src, n), sb));
  return sb;
}
(async () => {
  // Chat: edit a message
  let sb = sandbox(INDEX, ['lmsChatEditMessage', 'lmsChatApplyEdit'], {}, { text: '  Class moved to Lab 2 at 10:00  ' });
  vm.runInContext("var lmsChatActiveRoom = 'r1', lmsChatMessages = { r1: [{ id: 'm1', senderId: 'U1', text: 'Class at 9' }] };" +
    "function lmsChatGetCurrentUser(){ return { id: 'U1' }; } function saveLmsChatData(){ calls.push('save'); } function lmsChatGetRolePrefix(){ return 'admin'; }" +
    "function lmsChatRenderMessages(){} function lmsChatRenderRoomList(){}", sb);
  vm.runInContext("lmsChatEditMessage('m1')", sb); await tick();
  let m = vm.runInContext('lmsChatMessages.r1[0]', sb);
  assert(sb.asked[0].fields[0].type === 'textarea' && sb.asked[0].fields[0].value === 'Class at 9', 'chat: the form opens with the message to edit');
  assert(m.text === 'Class moved to Lab 2 at 10:00' && m.edited === true && !!m.updatedAt && sb.calls.join() === 'save', 'chat: the edited text is saved as before (trimmed, marked edited, stamped)');
  sb = sandbox(INDEX, ['lmsChatEditMessage', 'lmsChatApplyEdit'], {}, null);
  vm.runInContext("var lmsChatActiveRoom = 'r1', lmsChatMessages = { r1: [{ id: 'm1', senderId: 'U1', text: 'Class at 9' }] };" +
    "function lmsChatGetCurrentUser(){ return { id: 'U1' }; } function saveLmsChatData(){ calls.push('save'); }", sb);
  vm.runInContext("lmsChatEditMessage('m1')", sb); await tick();
  assert(sb.calls.length === 0 && vm.runInContext('lmsChatMessages.r1[0].text', sb) === 'Class at 9', 'chat: Cancel changes nothing');

  // Chat: a new room
  sb = sandbox(INDEX, ['lmsChatCreateRoom', 'lmsChatCreateRoomNamed'], {}, { name: 'Welding Level 2 — October intake' });
  vm.runInContext("var currentRole = 'admin', lmsChatRooms = []; function lmsChatGetCurrentUser(){ return { id: 'U1' }; }" +
    "function saveLmsChatData(){ calls.push('save'); } function lmsChatRenderRoomList(){} function showToast(){}", sb);
  vm.runInContext('lmsChatCreateRoom()', sb); await tick();
  const room = vm.runInContext('lmsChatRooms[0]', sb);
  assert(room && room.name === 'Welding Level 2 — October intake' && room.type === 'custom' && room.members.join() === 'U1' && sb.calls.join() === 'save', 'chat room: created with the typed name, as before');

  // Duty register: reject, with a reason; Cancel now cancels
  const adrEnv = "var adrTasks = [{ id: 'T1', title: 'File the Q2 attendance', status: 'review', acknowledged: true, completedAt: 'x', assigneeId: 'U9', assigneeName: 'Damion Reid' }], userAccounts = [];" +
    "function adrIsSystemAdmin(){ return true; } function adrGetCurrentUserName(){ return 'Marcia Thompson'; } function adrGetCurrentUserId(){ return 'U1'; }" +
    "function cestisGenId(p){ return p + '1'; } function addNotificationForUser(t){ calls.push('notify:' + t); } function showToast(){} function adrSaveData(){ calls.push('save'); } function adrRenderTasks(){}" +
    "function iRenderDuties(){} function adrRenderStaffCards(){} function adrRenderPerfOverview(){} function adrUpdateBadge(){} var adrViewMode = 'admin'; function closeModal(){} function openModal(){}";
  sb = sandbox(INDEX, ['adrRejectCompletion', 'adrRejectCompletionWith'], {}, null);
  vm.runInContext(adrEnv, sb);
  vm.runInContext("adrRejectCompletion('T1')", sb); await tick();
  assert(vm.runInContext('adrTasks[0].status', sb) === 'review' && sb.calls.length === 0, 'duty register: Cancel (Keep it) leaves the completion as it was — the old box rejected anyway');
  assert(sb.asked[0].danger === true && /Damion Reid/.test(sb.asked[0].intro), 'the form names the task and who gets it back');
  sb = sandbox(INDEX, ['adrRejectCompletion', 'adrRejectCompletionWith'], {}, { reason: 'The register for week 3 is missing.' });
  vm.runInContext(adrEnv, sb);
  vm.runInContext("adrRejectCompletion('T1')", sb); await tick();
  const t = vm.runInContext('adrTasks[0]', sb);
  assert(t.status === 'acknowledged' && t.completedAt === null && /Reason: The register for week 3 is missing\./.test(t.comments[0].text), 'duty register: Reject sends it back with the reason in its comments');
  assert(sb.calls.some(c => /Reason: The register for week 3/.test(c)) && sb.calls.indexOf('save') !== -1, 'and notifies the assignee and saves, as before');

  // Document hub: title and description in one form
  sb = sandbox(INDEX, ['docHubEditFile', 'docHubEditSaved'], {}, { title: 'Fire Safety Policy 2026 (revised)', description: 'Routes and checks.' });
  vm.runInContext("var documentHubFiles = [{ id: 'D1', title: 'Fire Safety Policy 2026', description: 'old' }];" +
    "function saveState(){ calls.push('save'); } function showToast(){} function renderDocumentHubAdmin(){ calls.push('render'); }", sb);
  vm.runInContext("docHubEditFile('D1')", sb); await tick();
  const d = vm.runInContext('documentHubFiles[0]', sb);
  assert(sb.asked.length === 1 && sb.asked[0].fields.length === 2, 'document hub: one form for both fields (it was two boxes in a row)');
  assert(d.title === 'Fire Safety Policy 2026 (revised)' && d.description === 'Routes and checks.' && sb.calls[0] === 'save', 'document hub: the title and description are saved as before');

  // Certificate number already printed on paper
  const certEnv = "var students = [{ id: 'S1', name: 'Fiona Reid', course: 'Cosmetology' }, { id: 'S2', name: 'Garfield Thompson' }];" +
    "function certNumberKey(n){ return String(n || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }" +
    "function certResolveNumber(n){ return certNumberKey(n) === 'WF20262906' ? { student: students[1] } : {}; }" +
    "function certRememberAlias(s, n){ calls.push('alias:' + s.id + ':' + n); return true; } function saveState(){ calls.push('save'); } function renderCertDownloadMgmt(){} function showToast(){}";
  sb = sandbox(INDEX, ['certRegisterPrintedNumber', 'certRecordPrintedNumber'], {}, { no: ' WF-2026-3001 ' });
  vm.runInContext(certEnv, sb);
  vm.runInContext("certRegisterPrintedNumber('S1')", sb); await tick();
  const v = sb.asked[0].validate;
  assert(/already belongs to Garfield Thompson/.test(v({ no: 'WF-2026-2906' }).message) && v({ no: '' }).message === 'No number entered.' && v({ no: 'WF-2026-3001' }) === '',
    'printed number: the form refuses another trainee\'s number and an empty one, in place');
  assert(sb.calls.join() === 'alias:S1:WF-2026-3001,save', 'printed number: recorded for the trainee exactly as before');

  // Payroll: a corrected gross
  sb = sandbox(PAYSLIP, ['editPayrollEntry'], {}, { gross: '300,000.50' });
  vm.runInContext("var r = { empName: 'Garfield Myers', gross: 287829.27 }, run = { date: '2026-09-25', results: [r] }, DATA = { payrollRuns: [run] };" +
    "function checkPayrollPermission(){ return true; } function fmt(n){ return '$' + n; } function fmtDate(d){ return d; } function alert(m){ calls.push('alert:' + m); }" +
    "function editPayrollEntryGross(a, b, g){ calls.push([a, b, g].join('|')); }", sb);
  vm.runInContext('editPayrollEntry(0, 0)', sb); await tick();
  assert(sb.asked[0].fields[0].type === 'number' && sb.asked[0].fields[0].min === 0 && sb.asked[0].fields[0].value === '287829.27', 'payroll: an amount field, at least 0, filled with the current gross');
  assert(sb.calls.join() === '0|0|300000.50', 'payroll: the new gross goes to the same recalculation as before');
  assert(/function editPayrollEntryGross\(runIdx,entryIdx,newGross\)\{\n  const run=DATA\.payrollRuns\[runIdx\];[\s\S]*?const gross=parseFloat\(newGross\);\n  if\(isNaN\(gross\)\|\|gross<0\)\{alert\('Invalid amount'\);return;\}/.test(PAYSLIP),
    'payroll: the recalculation itself is the unchanged code that followed the prompt');
  sb = sandbox(PAYSLIP, ['editPayrollEntry'], {}, { gross: '1' });
  vm.runInContext("var r = { empName: 'G', gross: 1 }, run = { date: 'd', results: [r] }, DATA = { payrollRuns: [run] };" +
    "function checkPayrollPermission(){ return true; } function fmt(n){ return n; } function fmtDate(d){ return d; } function alert(m){ calls.push('alert'); }" +
    "function editPayrollEntryGross(){ calls.push('recalc'); }", sb);
  vm.runInContext("editPayrollEntry(0, 0); DATA.payrollRuns = [{ date: 'other', results: [] }]", sb); await tick();
  assert(sb.calls.join() === 'alert', 'payroll: a run that changed while the form was open is not edited blind');

  // Cashbook: copy categories from a quarter (a choice from a list, not a typed number)
  sb = sandbox(CASHBOOK, ['quickCopyBudgetLine', 'quickCopyBudgetLineNamed'], {}, { name: 'Welding rods (Copy)' });
  vm.runInContext("var BUDGET = { 'Welding rods': 45000 }, BUDGET_LINE_SECTIONS = {}; function getBudgetLineSection(){ return 'Materials'; }" +
    "function saveQuarterBudget(){ calls.push('save'); } function refreshAll(){} function alert(m){ calls.push('alert:' + m); }", sb);
  vm.runInContext("quickCopyBudgetLine('Welding rods')", sb); await tick();
  assert(vm.runInContext("BUDGET['Welding rods (Copy)']", sb) === 45000 && vm.runInContext("BUDGET_LINE_SECTIONS['Welding rods (Copy)']", sb) === 'Materials' && sb.calls.join() === 'save',
    'cashbook: a copied line keeps the amount and section, as before');
  assert(sb.asked[0].validate({ name: 'Welding rods' }).message === 'A budget line with that name already exists.', 'cashbook: a name already used is refused in the form');
  const cq = extractFunction(CASHBOOK, 'copyBudgetFromQuarter');
  assert(/type: 'select'/.test(cq) && /copyBudgetCategoriesFrom\(options\[parseInt\(v\.idx, 10\)\]\)/.test(cq) && !/prompt\(/.test(cq), 'cashbook: the quarter is chosen from a list and handed to the unchanged copy');
  assert(/function copyBudgetCategoriesFrom\(selected\) \{\n    if \(!selected\) \{ alert\('Invalid selection\.'\); return; \}\n    var sourceData;/.test(CASHBOOK), 'cashbook: the copy itself is the code that followed the prompt');

  // Staff appraisals: a staff member added by hand
  const sappSrc = SAPP.slice(SAPP.indexOf('root.sappAddStaffPrompt = function'), SAPP.indexOf('root.sappRemoveExtraStaff'));
  sb = { asked: [], saved: null, prompt: () => 'Should not be asked' };
  sb.root = { CESTISForm: { ask: o => { sb.asked.push(o); return Promise.resolve({ name: 'Rashard Bennett' }); } } };
  vm.createContext(sb);
  vm.runInContext('var d = { extraStaff: [] }; function sappData(){ return d; } function sappPersist(x){ saved = x; } function sappRenderRoster(){}' +
    'function sappIsFullName(n){ return /\\S+\\s+\\S+/.test(String(n || "").trim()); } function alert(){}' + sappSrc, sb);
  vm.runInContext('root.sappAddStaffPrompt()', sb); await tick();
  assert(sb.asked.length === 1 && sb.saved && sb.saved.extraStaff[0].name === 'Rashard Bennett' && sb.saved.extraStaff[0].role === 'extra', 'appraisals: the name is added to the roster as before');
  assert(sb.asked[0].validate({ name: 'Rashard' }).message.indexOf('first name and a last name') !== -1, 'appraisals: a single name is refused in the form, with the same words');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
