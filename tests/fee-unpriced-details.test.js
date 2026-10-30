/* A trainee's personal details save on School Fee even when their programme
   has no fee set yet.

   What happened (office audit OF-14): the edit form's programme list is the
   priced programmes, so a trainee whose programme had no fee opened with no
   programme chosen, and saving their date of birth, ID or address was refused
   with "Please fill in all required fields (Name and Skill Area)" — blaming
   fields the clerk had not touched. Nothing could be saved until somebody set
   the fee.

   What this pins (School.Fee.html's own editStudent / saveStudentEdit, both
   builds): the trainee's own programme is offered, marked "(no fee set yet)";
   the details save; the tuition stays as it is and the trainee stays marked
   as not priced yet, so setting the programme's fee later fills it in (never
   $0, "fully paid" while owing everything); the clerk is told so; a priced
   programme behaves as before; a missing name or programme is named plainly.

   Run: node tests/fee-unpriced-details.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

['School.Fee.html', 'Offline System/School.Fee.html'].forEach(function (file) {
  const SRC = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const fn = name => {
    const s = SRC.indexOf('function ' + name + '(');
    if (s < 0) throw new Error(file + ' no longer defines ' + name + '()');
    let d = 0;
    for (let i = SRC.indexOf('{', s); i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (!d) return SRC.slice(s, i + 1); } }
    throw new Error(name);
  };
  function page(student, feeStructure) {
    const el = {};
    const mk = id => {
      const opts = [];
      const node = { id, style: {}, textContent: '', innerHTML: '', checked: false, options: opts,
        appendChild(o) { opts.push(o); }, setAttribute() {} };
      let v = '';
      Object.defineProperty(node, 'value', {
        get() { return v; },
        // A select takes only a value it offers (as a browser's does).
        set(x) { v = id === 'editSkillArea' ? (opts.some(o => o.value === x) ? x : '') : String(x == null ? '' : x); }
      });
      return node;
    };
    ['editStudentId', 'editStudentName', 'editSkillArea', 'editTuitionFee', 'editContactNumber', 'editEmail', 'editEnrollmentDate', 'editTotalPaid', 'editBalance', 'editStatus',
      'editDateOfBirth', 'editGender', 'editNationalId', 'editAddress', 'editCity', 'editParentName', 'editParentContact', 'editEmergencyContact', 'editKeepSeparate'].forEach(id => { el[id] = mk(id); });
    el.editStudentModal = { classList: { add() {}, remove() {} } };
    // The priced programmes are the list (updateSkillAreaOptions).
    Object.keys(feeStructure).forEach(k => el.editSkillArea.options.push({ value: k, textContent: k }));
    const sb = {
      console, Date, JSON, String, parseFloat, Math, CESTISCore: Core, window: { CESTISCore: Core },
      document: { getElementById: id => el[id] || null, createElement: () => ({ value: '', textContent: '', setAttribute() {} }) },
      students: [student], payments: [], documents: [], feeStructure, editingStudentIndex: -1, alerts: [], toast: '',
      alert(m) { sb.alerts.push(m); }, confirm: () => true, closeModal() {}, saveData() { sb.saved = (sb.saved || 0) + 1; },
      feePaymentStatus: s => (s.balance <= 0 ? 'Paid' : 'Outstanding'), feePropagateKeepSeparate() {}, feeRecordYearNote: () => '',
      feeToastWithYearNote(m) { sb.toast = m; }, populatePaymentStudentSelect() {}, propagateFeeRenameToLms() {}, renderDocumentsTable() {},
      renderPaymentsTable() {}, renderStudentsTable() {}, updateDashboard() {}, getStatusClass: () => 'paid',
      feeKeyFor: n => (Object.prototype.hasOwnProperty.call(feeStructure, n) ? n : null)
    };
    sb.el = el;
    vm.createContext(sb);
    vm.runInContext('let editingStudentIndex = -1;\n' + fn('editStudent') + '\n' + fn('saveStudentEdit'), sb);
    return sb;
  }
  console.log('\n[' + file + '] A programme with no fee set yet');
  {
    const s = { id: 'STU-1', name: 'Kerry-Ann Facey', skillArea: 'Commercial Cooking', tuitionFee: 0, totalPaid: 0, balance: 0, status: 'Paid', needsFeeDetails: true, enrollmentDate: '2026-09-01' };
    const sb = page(s, { 'Welding & Fabrication': { total: 85000 } });
    sb.editStudent(0);
    assert(sb.el.editSkillArea.value === 'Commercial Cooking', 'her own programme is chosen in the form');
    assert(sb.el.editSkillArea.options.some(o => o.value === 'Commercial Cooking' && /no fee set yet/.test(o.textContent)), 'and marked "(no fee set yet)"');
    sb.el.editDateOfBirth.value = '2005-02-14';
    sb.el.editNationalId.value = '123-456-789';
    sb.el.editAddress.value = '4 Hope Road, Kingston';
    sb.el.editGender.value = 'Female';
    sb.saveStudentEdit();
    assert(sb.alerts.length === 0, 'no refusal (it used to blame Name and Skill Area): ' + sb.alerts.join(' | '));
    assert(sb.saved === 1, 'the details are saved');
    assert(s.dateOfBirth === '2005-02-14' && s.nationalId === '123-456-789' && s.address === '4 Hope Road, Kingston' && s.gender === 'Female', 'all of them');
    assert(s.tuitionFee === 0 && s.skillArea === 'Commercial Cooking', 'the programme and tuition stay as they were');
    assert(s.needsFeeDetails === true, 'she stays marked as not priced yet, so setting the fee fills in her tuition');
    assert(/Commercial Cooking has no fee set yet: set it under Fee Structure/.test(sb.toast), 'and the clerk is told what to do next: ' + sb.toast);
  }
  console.log('[' + file + '] A priced programme, as before');
  {
    const s = { id: 'STU-2', name: 'Akeem Williams', skillArea: 'Welding & Fabrication', tuitionFee: 85000, totalPaid: 20000, balance: 65000, status: 'Outstanding', needsFeeDetails: true };
    const sb = page(s, { 'Welding & Fabrication': { total: 85000 } });
    sb.editStudent(0);
    assert(!sb.el.editSkillArea.options.some(o => /no fee set yet/.test(o.textContent)), 'no extra programme offered');
    sb.el.editDateOfBirth.value = '2004-03-11';
    sb.saveStudentEdit();
    assert(sb.saved === 1 && s.dateOfBirth === '2004-03-11' && s.balance === 65000, 'saved, balance worked out as before');
    assert(!('needsFeeDetails' in s), 'a person has reviewed it: no longer a placeholder (as before)');
    assert(sb.toast === 'Student information updated.', 'the usual words');
  }
  console.log('[' + file + '] What is missing is named plainly');
  {
    const s = { id: 'STU-3', name: 'Rohan Spence', skillArea: '', tuitionFee: 0, totalPaid: 0, balance: 0 };
    const sb = page(s, { 'Plumbing': { total: 70000 } });
    sb.editStudent(0);
    sb.saveStudentEdit();
    assert(sb.alerts[0] === 'Please choose the trainee\'s programme (Skill Area).', 'no programme at all: asked for the programme alone');
    sb.el.editStudentName.value = '';
    sb.el.editSkillArea.value = 'Plumbing';
    sb.saveStudentEdit();
    assert(sb.alerts[1] === 'Please enter the trainee\'s name.', 'no name: asked for the name alone');
    assert(!sb.saved, 'nothing saved either time');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
