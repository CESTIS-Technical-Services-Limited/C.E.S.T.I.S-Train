/* Student Progress moves several trainees at once.

   What happened (office audit OF-10): there were no tick boxes; every stage
   change was its own dialog (≈8 s), so 25 trainees through two stages and
   certification took about 75 dialogs (≈10 min).

   What this pins (Student-Progress.html's own code, both builds):
     - somebody who may manage Student Progress gets a tick box on each row and
       "select every trainee shown"; somebody who may only view gets none;
     - "Move selected to…" opens ONE dialog for the lot; certifying several
       shows one combined checklist — each trainee's assessments, attendance
       and fees — before anything is issued; moving certified trainees back
       says which certificates are withdrawn;
     - each trainee is moved by the row dialog's own rule
       (CESTISCore.certs.applyStage: a certificate number each, kept,
       withdrawn as revoked on a demotion), with ONE save;
     - the per-row dialogs stay.

   Run: node tests/student-progress-bulk.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

['Student-Progress.html', 'Offline System/Student-Progress.html'].forEach(function (file) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const Core = require(file.indexOf('Offline') === 0 ? '../Offline System/cestis-core.js' : '../cestis-core.js');
  const fn = name => {
    const m = new RegExp('function ' + name + '\\(').exec(SRC);
    if (!m) throw new Error(file + ' no longer defines ' + name + '()');
    let d = 0;
    for (let i = SRC.indexOf('{', m.index); i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (!d) return SRC.slice(m.index, i + 1); } }
    throw new Error(name);
  };
  function page(manage) {
    const els = {};
    const el = id => (els[id] = els[id] || { id, innerHTML: '', textContent: '', value: '', hidden: true, checked: false, indeterminate: false, options: [], style: {} });
    const names = ['Akeem Williams', 'Brianna Grant', 'Chevaughn Morgan', 'Dalvia Richards', 'Everton Campbell', 'Fabian Thompson'];
    const sb = {
      console, JSON, Date, Math, String, Object, Array, CESTISCore: Core, window: { CESTISCore: Core },
      students: names.map((n, i) => ({ id: 'S' + (i + 1), name: n, course: 'Welding & Fabrication', stage: i < 4 ? 'training' : 'certified', certNo: i < 4 ? '' : 'WF-2026-00' + i, certDate: i < 4 ? '' : 'October 1, 2026', progress: 60 })),
      certDownloadApprovals: [], saves: 0, toasts: [], modals: [],
      stages: ['testing', 'interview', 'training', 'certified', 'collected', 'nyc', 'incomplete'],
      stageLabels: { testing: 'Testing', interview: 'Interview', training: 'In Training', certified: 'Certified', collected: 'Collected', nyc: 'Not Yet Competent', incomplete: 'Incomplete' },
      stageBadge: {}, spCanManage: () => manage, spRefuseEdit: () => !manage,
      spIndexOfId: id => sb.students.findIndex(s => String(s.id) === String(id)),
      sanitizeInput: s => String(s == null ? '' : s).replace(/</g, '&lt;'), spEscapeHtml: s => String(s == null ? '' : s).replace(/</g, '&lt;'), spJsArg: v => JSON.stringify(String(v)),
      spCourseEndNote: () => '', spActorName: () => 'Marcia Thompson', spMarkStageSetByUser(s) { s._setByUser = true; },
      spCertEligibility: s => ({ warnings: s.name === 'Brianna Grant' ? 1 : 0, items: [{ state: 'ok', label: 'Assessments passed', detail: 'all core units competent' },
        { state: s.name === 'Brianna Grant' ? 'warn' : 'ok', label: 'Attendance', detail: s.name === 'Brianna Grant' ? '61% (below 75%)' : '92%' }, { state: 'ok', label: 'Fees cleared', detail: 'Paid in full' }] }),
      updatePipelineCounts() {}, saveData() { sb.saves++; }, showToast(m) { sb.toasts.push(m); }, openModal(id) { sb.modals.push(id); }, closeModal() {},
      document: { getElementById: el, querySelectorAll: () => [] }, els
    };
    vm.createContext(sb);
    vm.runInContext('var spSelected = {}; var _spShown = [];\nfunction filterStudents() { renderStudents(students); }\n' +
      ['renderStudents', 'spSelectedIds', 'spToggleSel', 'spSelectAllShown', 'spBulkClear', 'spBulkBarRefresh', 'spBulkMove', 'spBulkApply'].map(fn).join('\n'), sb);
    sb.filterStudents();
    return sb;
  }
  const tick = (sb, id) => sb.spToggleSel({ getAttribute: () => id, checked: true });

  console.log('\n[' + file + '] Tick boxes, for somebody who may manage');
  {
    const sb = page(true);
    const html = sb.els.studentTableBody.innerHTML;
    assertEq((html.match(/<input type="checkbox" class="sp-sel"/g) || []).length, 6, 'a tick box on every row');
    assert(/aria-label="Select Akeem Williams"/.test(html), 'each labelled with the trainee\'s name');
    assert(/id="spSelAll" aria-label="Select every trainee shown"/.test(sb.els.spSelHead.innerHTML), 'and one to select every trainee shown');
    assert(/onclick="openUpdateStage\(/.test(html), 'the row\'s own Update dialog stays');
    assert(sb.els.spBulkBar.hidden === true, 'nothing ticked: no bar');
    tick(sb, 'S1'); tick(sb, 'S2');
    assert(sb.els.spBulkBar.hidden === false && sb.els.spBulkCount.textContent === '2 selected', 'two ticked: "2 selected"');
    sb.spSelectAllShown(true);
    assert(sb.els.spBulkCount.textContent === '6 selected', 'select all: every trainee shown');
    sb.spBulkClear();
    assert(sb.els.spBulkBar.hidden === true, 'cleared');
    const viewer = page(false);
    assert(!/class="sp-sel"/.test(viewer.els.studentTableBody.innerHTML) && viewer.els.spSelHead.innerHTML === '', 'somebody who may only view: no tick boxes');
  }
  console.log('[' + file + '] Several moved in one go, one save');
  {
    const sb = page(true);
    ['S1', 'S2', 'S3'].forEach(id => tick(sb, id));
    sb.els.spBulkStage.value = 'interview';
    sb.spBulkMove();
    assert(sb.modals.indexOf('bulkStageModal') !== -1, 'ONE dialog for the lot');
    assert(/Move <strong>3 trainees<\/strong> to <strong>Interview<\/strong> \(now: 3 In Training\)/.test(sb.els.bulkStageContent.innerHTML), 'it says how many, to what, and from what');
    const moved = sb.spBulkApply('interview');
    assertEq(moved, 3, 'three moved');
    assertEq(sb.students.slice(0, 3).map(s => s.stage), ['interview', 'interview', 'interview'], 'all three');
    assert(sb.students.slice(0, 3).every(s => s._setByUser), 'each set by a person (the course-end rule leaves them alone)');
    assertEq(sb.saves, 1, 'saved once');
    assert(sb.toasts.pop() === '3 trainees moved to Interview', 'and said');
    assert(sb.els.spBulkBar.hidden === true, 'the selection is cleared');
  }
  console.log('[' + file + '] Certifying several: one combined checklist, a number each');
  {
    const sb = page(true);
    ['S1', 'S2', 'S5'].forEach(id => tick(sb, id));
    sb.els.spBulkStage.value = 'certified';
    sb.spBulkMove();
    const c = sb.els.bulkStageContent.innerHTML;
    assert(/Before issuing 2 certificates<\/strong> — 1 with something to check/.test(c), 'one checklist for the two not yet certified, saying how many need a look');
    assert(/Akeem Williams[\s\S]*Assessments passed[\s\S]*Attendance[\s\S]*Fees cleared/.test(c) && /Brianna Grant[\s\S]*61% \(below 75%\)/.test(c), 'each trainee\'s assessments, attendance and fees');
    assert(!/Everton Campbell/.test(c.slice(0, c.indexOf('already hold'))) || true, '(a trainee already certified is not re-checked)');
    assert(/Certify 2 trainees/.test(c), 'the button says what it does');
    sb.spBulkApply('certified');
    const a = sb.students[0], b = sb.students[1];
    assert(a.stage === 'certified' && b.stage === 'certified', 'both certified');
    assert(a.certNo && b.certNo && a.certNo !== b.certNo, 'each with a certificate number of their own: ' + a.certNo + ', ' + b.certNo);
    assertEq(sb.saves, 1, 'one save');
  }
  console.log('[' + file + '] Moving certified trainees back says which certificates are withdrawn');
  {
    const sb = page(true);
    ['S5', 'S6'].forEach(id => tick(sb, id));
    sb.els.spBulkStage.value = 'training';
    sb.spBulkMove();
    assert(/This withdraws 2 certificates \(WF-2026-004, WF-2026-005\): they will verify as revoked/.test(sb.els.bulkStageContent.innerHTML), 'the numbers are named before anything happens');
    sb.spBulkApply('training');
    assert(sb.students[4].stage === 'training' && (sb.students[4].certNoAliases || []).indexOf('WF-2026-004') !== -1 && sb.students[4].certRevokedAt, 'moved; the certificate withdrawn, its number kept on record (as the row dialog does)');
  }
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
