/* The transcript and administration pages, run for real: functions are read
   straight out of Student-Progress.html, index.html, Transcript-Grades.html,
   Cert-Transcript-Requests.html and Qual-Plan-Curriculum.html and executed
   against stubbed pages.

   What each block pins (finding ids in brackets):
     - Delete / Edit in Student Progress act on the trainee the modal named,
       even after a background reload reorders the roll (admin-03); there is
       no Regenerate ID and no invented absent week (transcripts-22);
     - Student Progress's stabiliser carries the store-held transcript records
       through a rename (transcripts-02);
     - enrolPropagateToFee never writes blanks over the School Fee record
       (admin-08);
     - renaming one intake renames only that intake's records when another
       intake shares the name (admin-10);
     - getNextCentreId never reuses a deleted centre's id (admin-05);
     - Admin Staff access ticks wait for Save (admin-24); Mark Collected acts by
       id (admin-03); the Document Hub keeps staff documents off other users'
       backups and trainees' devices (admin-14); External Systems open in
       their own tab and never advise clicking through a certificate error
       (admin-21); the dead duplicate editor is gone (admin-22); no hard-coded
       year (admin-23); transfers move only the moved trainee's account
       (admin-18);
     - the Transcript page: the ID number falls back to the roll / fee record
       (transcripts-21), the Core/Elective column prints Core/Elective and a
       unit being marked prints "Awaiting marking" (transcripts-16, -08), no
       seed catalogues are written at start-up (transcripts-20), each
       instructor's trainee is graded on their own plan (transcripts-10), a
       trainee's request is sent to the administration's file
       (transcripts-03), typed work survives a redraw (transcripts-11);
     - the request queue writes are merged with what is stored (missed #2);
     - the Qualification Plan viewer shows a trainee their own level
       (transcripts-24).

   Run: node tests/transadmin-pages.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const T = Core.Transcript;
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error((where || 'page') + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function memStore(init) {
  const data = Object.assign({}, init || {});
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
}
function el(value) { const attrs = {}; return { value: value || '', textContent: '', checked: false, style: {}, setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: k => (k in attrs ? attrs[k] : null) }; }

const SP = read('Student-Progress.html'), IX = read('index.html'), TG = read('Transcript-Grades.html'),
      CTR = read('Cert-Transcript-Requests.html'), QP = read('Qual-Plan-Curriculum.html');

/* ---------- 1. Student Progress acts on the trainee the modal named ---------- */
console.log('Student Progress deletes the trainee the modal named, whatever the roll did meanwhile');
{
  const els = { deleteStudentIdx: el(), deleteStudentName: el() };
  const toasts = [], posted = [];
  const sb = {
    students: [{ id: 'A', name: 'Alice Able' }, { id: 'B', name: 'Bob Baker', stage: 'certified' }, { id: 'C', name: 'Cara Cole' }, { id: 'D', name: 'Dane Drew' }],
    studentProfiles: {}, attendanceRecords: [{ studentId: 'B' }, { studentId: 'C' }], examResults: [], certDownloadApprovals: [],
    tomb: [], document: { getElementById: id => els[id] },
    spRefuseEdit: () => false, openModal: () => {}, closeModal: () => {}, filterStudents: () => {}, updatePipelineCounts: () => {},
    showToast: m => toasts.push(m), recordDeletedStudent: id => sb.tomb.push(id), saveData: d => posted.push(d), console
  };
  vm.createContext(sb);
  vm.runInContext(['spIndexOfId', 'openDeleteStudent', 'confirmDeleteStudent'].map(n => extractFunction(SP, n, 'Student-Progress.html')).join('\n'), sb);
  vm.runInContext("openDeleteStudent('C')", sb);
  // Another tab adds a trainee at the top; the page reloads the roll.
  sb.students = [{ id: 'E', name: 'Eve Early' }].concat(sb.students.map(s => Object.assign({}, s)));
  vm.runInContext('confirmDeleteStudent()', sb);
  assertEq(sb.students.map(s => s.name), ['Eve Early', 'Alice Able', 'Bob Baker', 'Dane Drew'], 'Cara Cole is deleted, not whoever took her row');
  assertEq(sb.tomb, ['C'], 'and only her id is written down as deleted');
  assertEq(sb.attendanceRecords.map(r => r.studentId), ['B'], 'only her attendance goes with her');
  // A record that is gone, or is somebody else now, is refused.
  vm.runInContext("openDeleteStudent('D')", sb);
  sb.students = sb.students.map(s => s.id === 'D' ? Object.assign({}, s, { name: 'Somebody Else' }) : s);
  vm.runInContext('confirmDeleteStudent()', sb);
  assertEq(sb.students.length, 4, 'a record whose name changed under the modal is not deleted');
  assert(/changed while the form was open/.test(toasts[toasts.length - 1]), 'and the administrator is told why');
  assert(/function renderStudents[\s\S]*?openDeleteStudent\(' \+ rid \+ '\)/.test(SP) && SP.indexOf("openUpdateStage(' + idx + ')") === -1,
    'the row buttons carry record ids, not positions');
  assert(/spUpdateStageFor\(' \+ spJsArg\(s\.id\)/.test(SP), 'the Update button finds its trainee by id when clicked');
  const save = extractFunction(SP, 'saveEditStudent');
  assert(save.indexOf('spIndexOfId(') !== -1 && save.indexOf("parseInt(document.getElementById('editStudentIdx')") === -1, 'Edit saves onto the trainee it opened by id');
  assert(save.indexOf("days:{Mon:'absent'") === -1, 'and never invents a week of absences');
  assert(SP.indexOf('function regenerateStudentId(') === -1 && SP.indexOf('regenerateIdBtn') === -1, 'there is no Regenerate ID');
}

/* ---------- 2. Student Progress carries transcript records through a rename ---------- */
console.log('Student Progress\'s stabiliser carries the trainee\'s transcript records through a rename');
{
  const oldId = Core.stableStudentId({ name: 'Jhon Brown', course: 'Cosmetology' });
  const store = memStore({
    voctrain_transcriptGrades: JSON.stringify(T.upsertManualGrade([], { studentId: oldId, qualId: 'Q', unitCode: 'U', grade: 88 })),
    voctrain_transcriptProfiles: JSON.stringify({ [oldId]: { dob: '01/02/2000' } })
  });
  const sb = { CESTISCore: Core, CESTISStore: store, window: {}, console,
    students: [{ id: oldId, name: 'John Brown', course: 'Cosmetology' }], userAccounts: [], attendanceRecords: [], certDownloadApprovals: [],
    examResults: [], studentProfiles: { [oldId]: { email: 'j@x.jm' } }, saved: 0 };
  sb.window.CESTISCore = Core;
  sb.saveData = () => { sb.saved++; };
  vm.createContext(sb);
  vm.runInContext(['cestisStabilizeStudentIds', 'spDropTombstoned'].map(n => extractFunction(SP, n)).join('\n'), sb);
  vm.runInContext('cestisStabilizeStudentIds()', sb);
  const newId = Core.stableStudentId({ name: 'John Brown', course: 'Cosmetology' });
  assertEq(sb.students[0].id, newId, 'the rename moved the id');
  assertEq(JSON.parse(store.data.voctrain_transcriptGrades)[0].studentId, newId, 'the manual grade followed');
  assert(newId in JSON.parse(store.data.voctrain_transcriptProfiles), 'the transcript header followed');
  assertEq(sb.studentProfiles[newId], { email: 'j@x.jm' }, 'the profile followed');
  assert(IX.indexOf('CESTISCore.relinkStoredDependents(res.idMap, CESTISStore)') !== -1 && /function relinkDependentData[\s\S]*?relinkStoredDependents\(idMap, CESTISStore\)/.test(IX),
    'the dashboard\'s stabiliser and relink carry them through the same shared function');
}

/* ---------- 3. enrolPropagateToFee never blanks the fee record ---------- */
console.log('A rename carried to School Fee keeps the fee record\'s details');
{
  const fee = [{ id: 'F1', lmsId: 'S1', name: 'Jane Doe', skillArea: 'Plumbing', dateOfBirth: '2004-05-17', address: '1 Main St', contact: '876-555', gender: 'F', email: 'j@d.jm', updatedAt: '2026-01-01T00:00:00Z' }];
  const store = memStore({ cestiSchoolFeeStudents: JSON.stringify(fee) });
  const sb = { CESTISStore: store, CESTISCore: Core, window: { CESTISCore: Core }, console };
  vm.createContext(sb);
  vm.runInContext(extractFunction(IX, 'enrolPropagateToFee', 'index.html'), sb);
  sb.student = { id: 'S1', name: 'Jane Doe-Brown', course: 'Plumbing', lastModified: '2026-10-16T09:00:00Z' };
  vm.runInContext("enrolPropagateToFee(student, {}, { id: 'S1', name: 'Jane Doe', course: 'Plumbing' })", sb);
  let rec = JSON.parse(store.data.cestiSchoolFeeStudents)[0];
  assertEq([rec.name, rec.dateOfBirth, rec.address, rec.contact, rec.gender, rec.email], ['Jane Doe-Brown', '2004-05-17', '1 Main St', '876-555', 'F', 'j@d.jm'],
    'the name is carried; nothing the dashboard does not hold is wiped');
  const stamp = rec.updatedAt;
  vm.runInContext("enrolPropagateToFee(student, {}, null)", sb);
  rec = JSON.parse(store.data.cestiSchoolFeeStudents)[0];
  assertEq(rec.updatedAt, stamp, 'nothing changed, nothing re-stamped');
  vm.runInContext("enrolPropagateToFee(student, {}, null, { clear: ['address'] })", sb);
  rec = JSON.parse(store.data.cestiSchoolFeeStudents)[0];
  assertEq([rec.address, rec.dateOfBirth], ['', '2004-05-17'], 'a field the administrator deliberately emptied is cleared — only that one');
}

/* ---------- 4. Renaming one intake of a shared name ---------- */
console.log('Renaming one intake of a shared name renames only that intake\'s records');
{
  const centres = [{ id: 1, name: 'Welding & Fabrication', centreKey: '01' }, { id: 22, name: 'Welding & Fabrication', centreKey: '22' }];
  const sb = {
    CESTISCore: Core, window: { CESTISCore: Core }, console,
    skillAreas: centres,
    students: [{ id: 'G1', name: 'Grad One', course: 'Welding & Fabrication', centreKey: '01', lastModified: '2025-12-01T00:00:00Z' },
               { id: 'N1', name: 'New One', course: 'Welding & Fabrication', centreKey: '22' }],
    userAccounts: [{ id: 'U1', role: 'student', studentDataId: 'G1', programme: 'Welding & Fabrication' }, { id: 'U2', role: 'student', studentDataId: 'N1', programme: 'Welding & Fabrication' }],
    attendanceRecords: [], exams: [{ id: 'E', course: 'Welding & Fabrication' }], instructorAssignments: [], assignmentSubmissions: [], instructorResources: [],
    driveResources: [], classSessions: [], certDownloadApprovals: [{ studentId: 'G1', course: 'Welding & Fabrication' }],
    certTemplates: { 'Welding & Fabrication': { t: 1 } }, certTemplateCourseMap: {}, lmsChatRooms: [], examResults: [{ studentId: 'G1', course: 'Welding & Fabrication' }],
    calendarEvents: [], syncRecordTombstone: () => {}
  };
  sb.console = { log: () => {}, warn: () => {} };
  vm.createContext(sb);
  vm.runInContext(['courseRenameScope', 'propagateCourseNameChange'].map(n => extractFunction(IX, n)).join('\n'), sb);
  vm.runInContext("var _sc = courseRenameScope(skillAreas[1]); skillAreas[1].name = 'Welding & Fabrication Level 3'; propagateCourseNameChange('Welding & Fabrication', 'Welding & Fabrication Level 3', _sc);", sb);
  assertEq(sb.students.map(s => s.course), ['Welding & Fabrication', 'Welding & Fabrication Level 3'], 'the intake-01 graduate keeps the old programme; intake 22 moves');
  assert(sb.students[1].lastModified && sb.students[1].lastModified !== undefined, 'the renamed records are stamped so other devices adopt them');
  assertEq(sb.userAccounts.map(u => u.programme), ['Welding & Fabrication', 'Welding & Fabrication Level 3'], 'only the intake-22 login moves');
  assertEq([sb.exams[0].course, Object.keys(sb.certTemplates)[0], sb.certDownloadApprovals[0].course, sb.examResults[0].course],
    ['Welding & Fabrication', 'Welding & Fabrication', 'Welding & Fabrication', 'Welding & Fabrication'], 'the shared exams, template and the graduate\'s records stay');
  // A name only one centre has still cascades everywhere, as before.
  sb.skillAreas = [{ id: 5, name: 'Plumbing', centreKey: '05' }];
  sb.exams = [{ id: 'E2', course: 'Plumbing' }]; sb.students = [{ id: 'P', name: 'P', course: 'Plumbing' }];
  vm.runInContext("var _sc2 = courseRenameScope(skillAreas[0]); propagateCourseNameChange('Plumbing', 'Plumbing L2', _sc2);", sb);
  assertEq([sb.exams[0].course, sb.students[0].course], ['Plumbing L2', 'Plumbing L2'], 'a name no other intake shares still renames everything');
}

/* ---------- 5. Centres, transfers, access, documents, external systems ---------- */
console.log('Administration: centre ids, transfers, access grid, documents, external systems');
{
  const store = memStore({ voctrain_deletedCentreIds: JSON.stringify(['3']), voctrain_syncTombstones: JSON.stringify({ chatRooms: { 'chat-class-9': '2026-01-01' } }) });
  const sb = { CESTISCore: Core, CESTISStore: store, window: { CESTISCore: Core }, skillAreas: [{ id: 1 }, { id: 2 }] };
  vm.createContext(sb);
  vm.runInContext(extractFunction(IX, 'getNextCentreId'), sb);
  assertEq(vm.runInContext('getNextCentreId()', sb), 10, 'a new centre\'s id is past every deleted centre and chat room id');
  assert(extractFunction(IX, 'addTrainingCentre').indexOf('clearDeletedCentre(') === -1, 'adding a centre no longer un-deletes an old id');
  assert(extractFunction(IX, 'addTrainingCentre').indexOf('assignCentreKeys(skillAreas, centreKeysInUse())') !== -1, 'and keys stamped on records stay reserved');

  const tr = extractFunction(IX, 'runTraineeTransfer');
  assert(tr.indexOf("var mine = !!movedIds[String(u.studentDataId)];") !== -1 && tr.indexOf('if (!mine && !linked)') !== -1,
    'a transfer moves the moved trainee\'s account; a name match only for an unlinked account on the FROM programme');

  const acc = { adminStaffAccessSettings: { exams: false }, document: { getElementById: () => ({ checked: false }) } };
  vm.createContext(acc);
  vm.runInContext('var asAccessDraft = null;\n' + extractFunction(IX, 'toggleAsAccess'), acc);
  vm.runInContext("toggleAsAccess('exams')", acc);
  assertEq(acc.adminStaffAccessSettings.exams, false, 'ticking a box in the access grid changes nothing until Save');
  assert(/function saveAdminStaffAccess\(\) \{\s*if\(asAccessDraft\)/.test(IX), 'Save applies the draft');

  const mc = extractFunction(IX, 'markCollected');
  assert(/function markCollected\(id\)/.test(mc) && /markCollected\(\$\{jsArg\(s\.id\)\}\)/.test(IX), 'Mark Collected acts on a record id');

  const docs = { documentHubFiles: [{ id: 1, audience: 'all' }, { id: 2, audience: 'instructors' }, { id: 3, audience: 'adminstaff' }] };
  vm.createContext(docs);
  vm.runInContext(extractFunction(IX, 'docHubFilesForRole'), docs);
  assertEq(vm.runInContext("docHubFilesForRole('instructor').map(function(d){return d.id;})", docs), [1, 2], 'an instructor\'s backup holds only documents for instructors');
  assertEq(vm.runInContext("docHubFilesForRole('student').length", docs), 0, 'a trainee\'s holds none');
  assert(extractFunction(IX, 'clearSensitiveStudentData').indexOf("CESTISStore.removeItem('voctrain_documentHubFiles')") !== -1, 'and a trainee\'s logout clears the hub from the device');
  assert(/file\.size > DOC_HUB_MAX_FILE/.test(IX) && /DOC_HUB_MAX_TOTAL/.test(extractFunction(IX, 'docHubUploadFile')), 'uploads are size-limited');
  assert(extractFunction(IX, 'docHubDownloadFile').indexOf('saveState()') === -1, 'a download no longer re-uploads every document');

  assert(/tms: \{[\s\S]*?mode: 'launch'/.test(IX) && /nqs: \{[\s\S]*?mode: 'launch'/.test(IX), 'HEART TMS / NQS open in their own tab by default');
  const help = extractFunction(IX, 'openExtSystemHelp');
  assert(help.indexOf('unsafe') === -1 && help.indexOf('Accept the Risk') === -1 && /do not continue past the warning/.test(help), 'the help never tells staff to click through a certificate error');
  assert(extractFunction(IX, 'mountExtSystemPage').indexOf('openExtSystemHelp(') === -1, 'and never opens by itself');

  assert(IX.indexOf('function confirmDeleteStudent(') === -1 && IX.indexOf('function saveEditStudent(') === -1 && IX.indexOf('function regenerateStudentId(') === -1,
    'the dashboard\'s unreachable copy of the student editor is gone');
  assert(IX.indexOf('${2026 -') === -1, 'no year is hard-coded into a calculation');
}

/* ---------- 6. Transcript page ---------- */
console.log('The Transcript page: header, columns, start-up, instructor plans, requests, typed work');
{
  const fee = [{ id: 'F', lmsId: 'S2', name: 'Bea', nationalId: '555-111-222' }];
  const store = memStore({ cestiSchoolFeeStudents: JSON.stringify(fee) });
  const sb = { CESTISCore: Core, CESTISStore: store, T, console,
    db: { students: [{ id: 'S1', name: 'Ann', trn: '111-222-333' }, { id: 'S2', name: 'Bea' }], profiles: {} } };
  vm.createContext(sb);
  vm.runInContext(['readJSON', 'profileFor', 'feeNationalIdFor', 'headerInfo'].map(n => extractFunction(TG, n)).join('\n'), sb);
  assertEq(vm.runInContext('headerInfo(db.students[0]).idNo', sb), '111-222-333', 'the ID number falls back to the trainee\'s TRN');
  assertEq(vm.runInContext('headerInfo(db.students[1]).idNo', sb), '555-111-222', 'then to the School Fee record\'s national ID');
  sb.db.profiles.S1 = { idNo: 'typed' };
  assertEq(vm.runInContext('headerInfo(db.students[0]).idNo', sb), 'typed', 'what was typed on the page still wins');

  const row = { code: 'U1', name: 'Unit', coreElective: 'Elective', date: '16/10/2026', grade: null, source: 'pending' };
  const rsb = { T, esc: s => String(s) };
  vm.createContext(rsb);
  vm.runInContext(extractFunction(TG, 'trUnitRowHTML'), rsb);
  const html = vm.runInContext('trUnitRowHTML(' + JSON.stringify(row) + ')', rsb);
  assert(/<td class="ce">Elective<\/td>/.test(html) && html.indexOf('16/10/2026') === -1, 'the Core/Elective column prints Core/Elective, not the date');
  assert(/Awaiting marking/.test(html), 'a unit being marked reads "Awaiting marking"');
  assert(/doc\.text\(String\(r\.coreElective \|\| 'Core'\)/.test(TG) && /doc\.text\(T\.displayGrade\(r\)/.test(TG), 'and so does the PDF');
  assert(/var result = T\.resultForRow\(r, qual\);/.test(TG) && TG.indexOf('var pass = n >= 60') === -1, 'the grade sheet uses the one pass-mark rule');

  const writes = [];
  const lsb = { T, CESTISStore: memStore({}), IS_STAFF: true, db: {}, console };
  lsb.CESTISStore.setItem = (k, v) => writes.push(k);
  vm.createContext(lsb);
  vm.runInContext(['readJSON', 'loadAll'].map(n => extractFunction(TG, n)).join('\n'), lsb);
  vm.runInContext('loadAll()', lsb);
  assertEq(writes, [], 'opening the page writes no seed catalogues');
  assertEq(lsb.db.catalogs.length, T.seedCatalogs().length, 'the seeds are still shown');

  const isb = { T, CESTISCore: Core, MY_COURSES: ['Electrical Installation'], MY_COURSE: 'Electrical Installation', MY_NAME: 'Ivan',
    db: { catalogs: T.seedCatalogs(), profiles: {}, students: [{ id: 'A', course: 'Electrical Installation and Maintenance L3' }, { id: 'B', course: 'Plumbing' }, { id: 'C', course: 'Plumbing', instructor: 'Ivan' }] } };
  vm.createContext(isb);
  vm.runInContext(['qualById', 'qualForStudent', 'sameProgramme', 'instructorStudents', 'insQualFor'].map(n => extractFunction(TG, n)).join('\n'), isb);
  assertEq(vm.runInContext('instructorStudents().map(function(s){return s.id;})', isb), ['A', 'C'], 'the instructor\'s trainees: their programmes, or named on the record');
  assertEq(vm.runInContext('insQualFor(db.students[0]).id', isb), 'QUAL-EIM-L3', 'the Level 3 trainee is graded on the Level 3 plan');

  assert(/writes: _tgTrainee \? \['voctrain_certTranscriptRequests'\] : \[\]/.test(TG) && /concat\(_tgTrainee \? \['voctrain_certTranscriptRequests'\] : \[\]\)/.test(TG),
    'a trainee\'s request goes to the administration\'s request file, and status changes come back');
  const rd = extractFunction(TG, 'requestDoc');
  assert(rd.indexOf('T.mergeRequestLists(') !== -1 && rd.indexOf('CESTISPageCloud.saveShared(') !== -1, 'added to the stored queue, then sent');
  assert(extractFunction(TG, 'renderGradeRows').indexOf('captureDirtyGrades()') !== -1 &&
    /data-stored="/.test(TG) && extractFunction(TG, 'renderProfileInputs').indexOf('profileDirtyFor === sel.studentId') !== -1,
    'typed grades and header details survive a redraw');
  const sc = extractFunction(TG, 'saveCatalog');
  assert(sc.indexOf('T.validateCatalogUnits(') !== -1 && sc.indexOf('T.renameUnitCode(') !== -1, 'a catalogue save is validated and offers to carry re-coded grades');
  assert(extractFunction(TG, 'saveUnitGrade').indexOf('has no unit code') !== -1, 'grading a code-less unit says so instead of "Grade saved"');
}

/* ---------- 7. The request queue merges with what is stored ---------- */
console.log('A status change is merged into the stored request queue');
{
  const stored = [T.newRequest({ studentId: 'A', type: 'transcript', requestedAt: '2026-01-01T00:00:00Z' }),
                  T.newRequest({ studentId: 'B', type: 'certificate', requestedAt: '2026-01-02T00:00:00Z' })];
  const store = memStore({ voctrain_certTranscriptRequests: JSON.stringify(stored) });
  const sb = { T, KEY: 'voctrain_certTranscriptRequests', CESTISStore: store, window: { top: { postMessage: () => {} } }, console,
    requests: [stored[0]] };   // this page's copy predates trainee B's request
  vm.createContext(sb);
  vm.runInContext(extractFunction(CTR, 'save'), sb);
  sb.requests[0] = Object.assign({}, sb.requests[0], { status: 'ready', updatedAt: '2026-01-05T00:00:00Z' });
  vm.runInContext('save()', sb);
  const after = JSON.parse(store.data.voctrain_certTranscriptRequests);
  assertEq(after.map(r => [r.studentId, r.status]), [['A', 'ready'], ['B', 'pending']], 'the change is kept and the request raised meanwhile is not lost');
  assert(/function setStatus\(id, status\)/.test(CTR) && /setStatus\(' \+ crJsArg\(r\.id\)/.test(CTR), 'a status change names its request by id');
}

/* ---------- 8. Qualification plans at the trainee's level ---------- */
console.log('The Qualification Plan viewer shows a trainee their own level\'s plan');
{
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(['qpCourseLevel', 'qpVisiblePrograms'].map(n => extractFunction(QP, n)).join('\n'), sb);
  sb.programs = [{ title: 'Short', general: true }, { title: 'Welding L2', skillArea: 'Welding & Fabrication', level: 2 },
                 { title: 'Welding L3', skillArea: 'Welding & Fabrication', level: 3 }, { title: 'Cosmetology', skillArea: 'Cosmetology', level: 2 }];
  assertEq(vm.runInContext("qpVisiblePrograms(programs, { allowedSkillName: 'Welding & Fabrication', course: 'WELDING L2' }).map(function(p){return p.title;})", sb),
    ['Short', 'Welding L2'], 'a Level 2 trainee sees the Level 2 plan and the general courses');
  assertEq(vm.runInContext("qpVisiblePrograms(programs, { allowedSkillName: 'Welding & Fabrication', course: 'Welding & Fabrication' }).length", sb), 3,
    'a course stating no level still sees both levels');
  assertEq(vm.runInContext("qpVisiblePrograms(programs, { isStaff: true, filter: 'all' }).length", sb), 4, 'staff see everything');
  assert(/No qualification plan has been published for your programme/.test(QP), 'a programme with no plan folder is told so');
  assert(/The documents for this plan open from their folder\.' \+ openFolder/.test(QP), 'a trainee without the Centre\'s sync sign-in is offered the folder, not an admin sign-in (and is not told where it is kept)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
