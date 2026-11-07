/* Tidy Programme Names (CESTISCore.programmeTidy) — the Administrator's tool
   for one programme written several ways.

   What the owner saw (Student Progress, "All Courses"): Electrical
   Installation Level 2 listed as "Electrical Installation" AND "Electrical
   Installation Level 2", Welding as "Welding and Fabrication Level 2" AND
   "Welding & Fabrication", and an "Archived — no training centre" group
   (BEAUTY THERAPY L2, COMMI CHEF L2, COSMETOLOGY L2, ELECTRICAL L2,
   HOSPITALITY SERVICES L2, Welding, WELDING L2): one entry per centre
   record, then every spelling left on old records.

   Pinned here, with the real cestis-core.js:
     1. grouping — the owner's exact list; a spelling with no level that
        could be two programmes is asked about, never guessed;
     2. the plan — what each decision renames, and what it refuses;
     3. applying it to a realistic roll (trainees, fee records, payments,
        programme fees, accounts, attendance, results, attempts, approvals,
        coursework, a deleted trainee, a "kept separate" namesake pair and
        two namesakes with different details): nobody's id moves, every link
        resolves, no training centre is deleted, nobody changes intake;
     4. the sign-in clean-up afterwards (migrateToStableIds, dedupeStudents,
        collapseSameNameStudents, the tombstones): nothing lost, nobody
        merged, the deleted trainee stays deleted;
     5. another computer's stale copy takes the renames on merge, and cannot
        put an old centre name back;
     6. undo puts back exactly what the tidy changed;
     7. the filter menus file a leftover spelling under the one live
        programme it agrees with at the same level.

   Run: node tests/programme-tidy.test.js */
'use strict';

const Core = require('../cestis-core.js');
const T = Core.programmeTidy;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  assert(a === e, msg + ' — expected ' + e + ', got ' + a);
}
const clone = v => JSON.parse(JSON.stringify(v));
const STAMPS = ['lastModified', 'updatedAt', 'nameModified', '_fs'];
function unstamped(v) {
  if (Array.isArray(v)) return v.map(unstamped);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (STAMPS.indexOf(k) === -1) o[k] = unstamped(v[k]); }); return o; }
  return v;
}

const LIVE = ['Business Administration', 'Commercial Cooking', 'Cosmetology', 'Electrical Installation',
  'Electrical Installation and Maintenance Level 3', 'Electrical Installation Level 2', 'General Cosmetology Level 2',
  'Hospitality & Tourism', 'Photovoltaic Installer', 'Plumbing', 'Welding & Fabrication', 'Welding and Fabrication Level 2'];
const ORPHANS = ['BEAUTY THERAPY L2', 'COMMI CHEF L2', 'COSMETOLOGY L2', 'ELECTRICAL L2', 'HOSPITALITY SERVICES L2', 'Welding', 'WELDING L2'];

/* ======================================================= 1. Grouping */
console.log('1. Grouping the owner\'s list');
{
  const centres = LIVE.map((n, i) => ({ id: i + 1, name: n, centreKey: String(i + 1).padStart(2, '0') }));
  const students = LIVE.concat(ORPHANS).map((c, i) => ({ id: 'S' + i, name: 'Person ' + i, course: c }));
  const inv = T.inventory({ centres, students });
  assertEq(inv.spellings.length, 19, 'nineteen spellings in use');
  const g = T.group(inv);
  const byKeep = {};
  g.groups.forEach(x => { byKeep[x.keep] = x.members.map(m => m.label).sort(); });
  assertEq(byKeep['Welding and Fabrication Level 2'], ['WELDING L2', 'Welding', 'Welding & Fabrication', 'Welding and Fabrication Level 2'],
    'Welding: the two centres and both leftover spellings are one programme, kept as the Level 2 centre\'s name');
  assertEq(byKeep['Electrical Installation Level 2'], ['ELECTRICAL L2', 'Electrical Installation Level 2'], 'ELECTRICAL L2 is the Level 2 centre');
  assertEq(byKeep['General Cosmetology Level 2'], ['COSMETOLOGY L2', 'Cosmetology', 'General Cosmetology Level 2'], 'the cosmetology spellings are one programme');
  assertEq(byKeep['Electrical Installation and Maintenance Level 3'], ['Electrical Installation and Maintenance Level 3'], 'Level 3 stands on its own');
  ['BEAUTY THERAPY L2', 'COMMI CHEF L2', 'HOSPITALITY SERVICES L2', 'Hospitality & Tourism', 'Commercial Cooking', 'Plumbing', 'Photovoltaic Installer', 'Business Administration']
    .forEach(n => assertEq(byKeep[n], [n], n + ' is a programme of its own (nothing it clearly is)'));
  assertEq(g.choices.length, 1, 'one spelling needs a choice');
  const ch = g.choices[0];
  assertEq(ch.spelling.label, 'Electrical Installation', '"Electrical Installation" (no level) is not guessed');
  assertEq(ch.candidates.slice().sort(), ['g:electrical installation and maintenance level 3', 'g:electrical installation level 2'],
    'it could be the Level 2 or the Level 3 programme');
  assert(!g.groups.some(x => x.members.some(m => m.label === 'Electrical Installation')), 'and it is in no group until somebody chooses');

  // Ambiguous and level rules.
  const g2 = T.group(T.inventory({ centres: [{ id: 1, name: 'Plumbing Level 2' }, { id: 2, name: 'Plumbing Level 3' }],
    students: [{ id: 'a', name: 'A', course: 'Plumbing' }, { id: 'b', name: 'B', course: 'PLUMBING L2' }, { id: 'c', name: 'C', course: 'Plumbing L3' }] }));
  assertEq(g2.choices.map(c => c.spelling.label), ['Plumbing'], 'plain "Plumbing" beside Level 2 and Level 3 is asked about');
  assertEq(g2.groups.map(x => x.members.length).sort(), [2, 2], 'L2 and L3 spellings are never one programme');
  const g3 = T.group(T.inventory({ students: [{ id: 'a', name: 'A', course: 'COMMI CHEF L2' }, { id: 'b', name: 'B', course: 'Commi Chef Level 2' }, { id: 'c', name: 'C', course: 'commi  chef l2' }] }));
  assertEq(g3.groups.length, 1, 'two spellings no centre uses can still be one programme');
  assertEq(g3.groups[0].members.length, 2, '(case and spacing are the same spelling)');
  const g4 = T.group(T.inventory({ centres: [{ id: 1, name: 'Welding & Fabrication' }], students: [{ id: 'a', name: 'A', course: '04. Welding & Fabrication' }] }));
  assertEq([g4.groups.length, g4.groups[0].members.length], [1, 1], 'an intake key written in front is the same spelling');
}

/* ======================================================= A realistic roll */
const NOW0 = '2026-11-01T09:00:00.000Z';
function roll() {
  const centres = LIVE.map((n, i) => ({ id: i + 1, name: n, centreKey: String(i + 1).padStart(2, '0'), icon: '📋',
    startDate: i === 10 ? '2025-01-06' : '2026-01-12', endDate: i === 10 ? '2025-12-12' : '2027-06-30' }));
  const S = [];
  const add = (name, course, extra) => {
    const s = Object.assign({ name, course, stage: 'training', progress: 30, lastModified: NOW0, enrolmentDate: '2026-02-01' }, extra || {});
    s.id = s.id || Core.stableStudentId(s);
    S.push(s); return s;
  };
  // Welding: the earlier intake (centre 11, 2025) and the Level 2 intake (centre 12).
  add('Tameka Richards', 'Welding & Fabrication', { enrolmentDate: '2025-02-01', stage: 'certified', certNo: 'WF-2025-0101-AB', certDate: 'December 12, 2025' });
  add('Kemar Johnson', '11. Welding & Fabrication', { enrolmentDate: '2025-02-01' });
  add('Shanice Campbell', 'Welding and Fabrication Level 2', { centreKey: '12', centreId: 12 });
  add('Omarion Blake', 'WELDING L2');
  add('Jovaun Grant', 'Welding');
  // Two real people, one name, one programme: the administrator pinned one.
  add('Andre Brown', 'WELDING L2', { email: 'andre.b1@mail.example', keepSeparate: true, id: 'STU-andre-1' });
  add('Andre Brown', 'WELDING L2', { email: 'andre.b2@mail.example' });
  // One name on two spellings that the clean-up keeps apart: different people (emails differ).
  add('Kerry-Ann Lewis', 'Welding & Fabrication', { email: 'kerryann.l@mail.example', enrolmentDate: '2025-03-01' });
  add('Kerry-Ann Lewis', 'WELDING L2', { email: 'kal.lewis@mail.example' });
  // Electrical: the bare centre, Level 2, Level 3 — and a trainee on two levels.
  add('Rushane Grant', 'Electrical Installation');
  add('Dwayne Thompson', 'ELECTRICAL L2');
  add('Rohan Spence', 'Electrical Installation Level 2');
  add('Rohan Spence', 'Electrical Installation and Maintenance Level 3');
  // Cosmetology, catering, hospitality.
  add('Odalys Facey', 'Cosmetology');
  add('Brianna Morgan', 'COSMETOLOGY L2');
  add('Gaynelle Henry', 'General Cosmetology Level 2');
  add('Nordia Palmer', 'COMMI CHEF L2');
  add('Sashana Bryan', 'Commercial Cooking');
  add('Imani Reid', 'HOSPITALITY SERVICES L2');
  add('Petagaye Clarke', 'BEAUTY THERAPY L2');
  add('Leroy Wright', 'Plumbing');
  const id = name => S.filter(s => s.name === name).map(s => s.id);
  const deletedSid = Core.stableStudentId({ name: 'Dwight Deleted', course: 'WELDING L2' });
  // Fee records: linked both ways, spelled the fee side's way.
  const fee = [];
  S.forEach((s, i) => {
    const f = { id: 'STU-fee-' + i, name: s.name, skillArea: i % 3 === 0 ? s.course.toUpperCase() : s.course, lmsId: s.id, tuitionFee: 150000, totalPaid: 50000,
      email: s.email || '', createdAt: '2026-02-01T10:00:00.000Z', updatedAt: NOW0 };
    if (s.keepSeparate) f.keepSeparate = true;
    if (s.name === 'Kerry-Ann Lewis') f.email = s.email;
    s.schoolFeeId = f.id;
    fee.push(f);
  });
  const payments = fee.map((f, i) => ({ id: 'PAY-' + i, studentId: f.id, amount: 50000, skillArea: f.skillArea, date: '2026-03-01', updatedAt: NOW0 }));
  const feeStructure = {
    'WELDING L2': { total: 120000, terms: [60000, 60000] },
    '12. Welding and Fabrication Level 2': { total: 150000, terms: [75000, 75000] },
    '11. Welding & Fabrication': { total: 140000, terms: [70000, 70000] },
    'Electrical Installation': { total: 0, terms: [] },
    'Electrical Installation Level 2': { total: 160000, terms: [80000, 80000] },
    'COMMI CHEF L2': { total: 110000, terms: [110000] }
  };
  const accounts = S.map((s, i) => ({ id: 'USR-' + i, name: s.name, role: 'student', username: 'u' + i, programme: s.course, studentDataId: s.id, password: 'pbkdf2$1$x$y', status: 'active', updatedAt: NOW0 }));
  accounts.push({ id: 'USR-ADMIN', name: 'Administrator', role: 'admin', username: 'admin', programme: '', status: 'active' });
  const attendanceRegister = S.map((s, i) => ({ id: 'ATT-' + i, studentId: s.id, date: '2026-10-0' + (1 + (i % 5)), status: 'present', markedAt: NOW0 }));
  const attendanceRecords = S.map((s, i) => ({ studentId: s.id, course: s.course, date: '2026-10-01', status: 'present' }));
  const examResults = S.map((s, i) => ({ id: 'RES-' + i, examId: 'EXAM-1', studentId: s.id, course: s.course, score: 70 + (i % 20), submittedAt: NOW0 }));
  const examAttempts = [{ id: 'ATM-1', examId: 'EXAM-2', studentId: id('Omarion Blake')[0], answers: { Q1: 1 } }];
  const certDownloadApprovals = [{ id: 'CDA-1', studentId: id('Tameka Richards')[0], course: 'Welding & Fabrication', certNo: 'WF-2025-0101-AB', approved: true, approvedDate: NOW0 }];
  const assignments = [{ id: 'ASG-1', title: 'Butt joint', course: 'WELDING L2', grades: {}, gradeMeta: {}, updatedAt: NOW0 }];
  S.forEach(s => { if (/weld/i.test(s.course)) { assignments[0].grades[s.id] = 8; assignments[0].gradeMeta[s.id] = { gradedAt: NOW0 }; } });
  const submissions = S.filter(s => /weld/i.test(s.course)).map((s, i) => ({ id: 'SUB-' + i, assignmentId: 'ASG-1', studentId: s.id, course: s.course }));
  const exams = [{ id: 'EXAM-1', title: 'Welding safety', course: 'Welding & Fabrication', updatedAt: NOW0 }, { id: 'EXAM-3', title: 'Circuits', course: 'ELECTRICAL L2', updatedAt: NOW0 }];
  const instructors = [{ id: 'INS-1', name: 'Mr Lindo', course: 'WELDING L2', courses: ['WELDING L2', 'Welding'], updatedAt: NOW0 }];
  const certTemplates = { 'Welding & Fabrication': { courseFullName: 'Welding and Fabrication Level 2', modules: [] }, 'Electrical Installation Level 2': { modules: [] } };
  const certTemplateCourseMap = { 'Welding': 'Welding & Fabrication' };
  const unitCatalogs = [{ id: 'QP-W', title: 'Welding NVQ', skillArea: 'Welding & Fabrication', level: '2', units: [] },
    { id: 'QP-E3', title: 'Electrical L3', skillArea: 'Electrical Installation', level: '3', units: [] }];
  const chatRooms = centres.map(c => ({ id: 'chat-class-' + c.id, name: c.name, type: 'class', skillAreaId: c.id, members: [] }));
  return { centres, students: S, feeStudents: fee, feePayments: payments, feeStructure, feeDeletedKeys: [], feeCarryDeclined: [],
    accounts, instructors, exams, assignments, submissions, resources: [], driveResources: [], classSessions: [], calendarEvents: [],
    announcements: [{ id: 'ANN-1', title: 'Goggles', course: 'Welding', updatedAt: NOW0 }], unitCatalogs, certTemplates, certTemplateCourseMap, chatRooms,
    attendanceRegister, attendanceRecords, examResults, examAttempts, certDownloadApprovals, deleted: { [deletedSid]: true }, deletedSid };
}

function signInCleanUp(b) {
  // What the dashboard runs at every sign-in and after every merge.
  const drop = Core.dropTombstonedStudents(b.students, b.deleted, {});
  b.students = drop.students;
  const data = { students: b.students, userAccounts: b.accounts, attendanceRecords: b.attendanceRecords, attendanceRegister: b.attendanceRegister,
    certDownloadApprovals: b.certDownloadApprovals, examResults: b.examResults, examAttempts: b.examAttempts };
  const mig = Core.migrateToStableIds(data);
  b.students = data.students; b.accounts = data.userAccounts; b.attendanceRegister = data.attendanceRegister;
  const d = Core.dedupeStudents(b.students); b.students = d.students;
  const c = Core.collapseSameNameStudents(b.students); b.students = c.students;
  const fd = Core.dedupeStudents(b.feeStudents, { courseField: 'skillArea' }); b.feeStudents = fd.students;
  const fc = Core.collapseSameNameStudents(b.feeStudents, { courseField: 'skillArea' }); b.feeStudents = fc.students;
  return { moved: Object.keys(mig.idMap).length + Object.keys(d.idMap).length + Object.keys(c.idMap).length,
    removed: mig.removed + d.removed + c.removed + drop.removed, feeRemoved: fd.removed + fc.removed, idMap: Object.assign({}, mig.idMap, d.idMap, c.idMap) };
}

/* ======================================================= 2. The plan */
console.log('2. The plan');
const B0 = roll();
{
  const settle = signInCleanUp(B0);
  assertEq([settle.moved, settle.removed, settle.feeRemoved], [0, 0, 0], 'the roll is settled before the tidy (as after any sign-in)');
}
const ORIG = clone(B0);
const inv0 = T.inventory(B0, { today: '2026-11-07' });
const grp0 = T.group(inv0);
const gid = keep => grp0.groups.find(g => g.keep === keep).id;
const DECISIONS = { choose: { 'electrical installation': gid('Electrical Installation Level 2'), 'commi chef l2': gid('Commercial Cooking') } };
const PLAN = T.plan(inv0, grp0, DECISIONS);
{
  const line = to => PLAN.lines.find(l => l.to === to);
  const weld = line('Welding and Fabrication Level 2');
  assert(!!weld, 'Welding spellings are renamed to "Welding and Fabrication Level 2"');
  const wf = weld.items.find(i => i.label === 'Welding & Fabrication');
  assert(/^training centre, 1 intake, \d+ trainees, \d+ fee records/.test(wf.what), 'the preview says what each spelling carries: ' + wf.what);
  assert(weld.items.some(i => i.label === 'WELDING L2') && weld.items.some(i => i.label === 'Welding'), 'WELDING L2 and Welding go with it');
  assertEq(line('Electrical Installation Level 2').items.map(i => i.label).sort(), ['ELECTRICAL L2', 'Electrical Installation'], 'the chosen "Electrical Installation" and ELECTRICAL L2 → Level 2');
  assertEq(line('Commercial Cooking').items.map(i => i.label), ['COMMI CHEF L2'], 'COMMI CHEF L2, filed by the Administrator under Commercial Cooking');
  assert(!PLAN.renames.some(r => r.from === 'beauty therapy l2' || r.from === 'hospitality services l2'), 'names left as they are are not renamed');
  assertEq(PLAN.problems.filter(p => p.blocking).length, 0, 'nothing in the way');
  const p2 = T.plan(inv0, grp0, Object.assign({}, DECISIONS, { skip: { 'welding': true } }));
  assert(!p2.renames.some(r => r.from === 'welding'), 'an unticked spelling is left alone');
  const p3 = T.plan(inv0, grp0, { keep: { [gid('Welding and Fabrication Level 2')]: 'Welding and Fabrication Level 2', [gid('Plumbing')]: 'Welding & Fabrication' } });
  assert(p3.problems.some(p => p.blocking && /also being changed/.test(p.text)), 'a kept name that is itself being renamed elsewhere is refused');
  const p4 = T.plan(inv0, grp0, { keep: { [gid('Welding and Fabrication Level 2')]: 'Welding Fabrication Level 3' } });
  assert(p4.problems.some(p => !p.blocking && /Level 2/.test(p.text) && /Level 3/.test(p.text)), 'a typed name with another level is flagged');
}

/* ======================================================= 3. Apply */
console.log('3. Applying it');
const B = clone(ORIG);
const NOW1 = '2026-11-07T15:00:00.000Z';
const before = {};
B.students.forEach(s => { before[s.id] = { tally: null }; });
const tallyBefore = Core.transfer.tally(B.students, B.centres, { today: '2026-11-07' });
const intakeOf = (tally, s) => Object.keys(tally.groups).find(k => tally.groups[k].indexOf(s) !== -1) || '';
const placed = {};
B.students.forEach(s => { placed[s.id] = intakeOf(tallyBefore, s); });
const RES = T.apply(B, PLAN.renames, { now: NOW1, today: '2026-11-07' });
{
  assertEq(B.centres.length, 12, 'no training centre was deleted');
  assertEq(B.centres.map(c => c.id), ORIG.centres.map(c => c.id), 'and none was merged: the same centre records, same ids');
  assertEq(B.centres.filter(c => c.name === 'Welding and Fabrication Level 2').map(c => c.centreKey), ['11', '12'],
    'both Welding intakes keep their own key and dates, sharing one name');
  assertEq(B.centres[10].startDate + '/' + B.centres[10].endDate, '2025-01-06/2025-12-12', '(the earlier intake keeps its dates)');
  assert(B.centres[10].nameModified === NOW1 && !B.centres[0].nameModified, 'a renamed centre is stamped, an untouched one is not');
  assertEq(Core.catalogue.courseNames(B.centres, { getItem: () => null }),
    ['Business Administration', 'Commercial Cooking', 'Electrical Installation and Maintenance Level 3', 'Electrical Installation Level 2',
     'General Cosmetology Level 2', 'Hospitality & Tourism', 'Photovoltaic Installer', 'Plumbing', 'Welding and Fabrication Level 2'],
    'the menus now list one entry per programme');
  const menu = Core.catalogue.filterOptions(B.centres, B.students.map(s => s.course).concat(B.accounts.map(a => a.programme)), { getItem: () => null });
  assertEq(menu.archived, ['BEAUTY THERAPY L2', 'HOSPITALITY SERVICES L2'], 'and only the names left as they are remain archived');
  assertEq(menu.filed, { 'Welding and Fabrication Level 2': ['11. Welding and Fabrication Level 2'] }, '(an intake-keyed spelling is filed under its programme)');

  // Ids and links.
  assertEq(B.students.map(s => s.id), ORIG.students.map(s => s.id), 'every trainee keeps the id they had');
  B.students.forEach(s => { if (!Core.keepsOwnId(s)) assert(Core.stableStudentId(s) === s.id, s.name + ': the id still matches the record (' + s.course + ')'); });
  const om = B.students.find(s => s.name === 'Omarion Blake');
  assertEq([om.course, om.idCourse], ['Welding and Fabrication Level 2', 'WELDING L2'], 'a renamed record keeps the spelling its id was made from');
  assert(om._fs && om._fs.course && om._fs.idCourse && om.lastModified === NOW1, 'and its new programme is stamped, so it wins the merge elsewhere');
  assertEq(B.students.find(s => s.name === 'Kemar Johnson').course, '11. Welding and Fabrication Level 2', 'an intake key written in front is kept');
  const ids = {}; B.students.forEach(s => { ids[s.id] = true; });
  assert(B.accounts.filter(a => a.studentDataId).every(a => ids[a.studentDataId]), 'every sign-in account still finds its trainee');
  assert(B.attendanceRegister.every(r => ids[r.studentId]), 'every attendance mark still finds its trainee');
  assert(B.examResults.every(r => ids[r.studentId]) && B.examAttempts.every(r => ids[r.studentId]), 'every result and attempt too');
  assert(B.certDownloadApprovals.every(r => ids[r.studentId]), 'and the certificate approval');
  assert(Object.keys(B.assignments[0].grades).every(k => ids[k]), 'and the coursework grades');
  assertEq(B.students.find(s => s.name === 'Tameka Richards').certNo, 'WF-2025-0101-AB', 'the certificate number is untouched');
  const feeIds = {}; B.feeStudents.forEach(f => { feeIds[f.id] = f; });
  assert(B.students.every(s => feeIds[s.schoolFeeId] && feeIds[s.schoolFeeId].lmsId === s.id), 'every trainee and fee record still find each other');
  assertEq(B.examResults.map(r => r.course), ORIG.examResults.map(r => r.course), 'exam results are history: their programme text is not rewritten');
  assertEq(B.attendanceRecords.map(r => r.course), ORIG.attendanceRecords.map(r => r.course), 'nor attendance rows');
  assertEq(B.certDownloadApprovals[0].course, 'Welding & Fabrication', 'nor certificate approvals');

  // Nobody changes intake.
  const tallyAfter = Core.transfer.tally(B.students, B.centres, { today: '2026-11-07' });
  B.students.forEach(s => {
    if (!placed[s.id]) return;   // a name no centre answered to: filed under a programme now (below)
    assert(intakeOf(tallyAfter, s) === placed[s.id], s.name + ' (' + s.course + ') is counted in the same intake as before (' + placed[s.id] + ')');
  });
  const np = B.students.find(s => s.name === 'Nordia Palmer');
  assertEq([placed[np.id], intakeOf(tallyAfter, np)], ['', '02'], 'COMMI CHEF L2, in no intake before, is counted in Commercial Cooking now');
  assert(RES.bound > 0, 'records that only named their programme were stamped with their intake first (' + RES.bound + ')');
  assertEq(B.students.find(s => s.name === 'Jovaun Grant').centreKey, '11', '"Welding" was the 2025 intake\'s and stays there');

  // Namesakes.
  const kal = B.students.filter(s => s.name === 'Kerry-Ann Lewis');
  assert(kal.length === 2 && kal.every(s => s.keepSeparate === true), 'two people of one name brought onto one programme are kept separate');
  assert(RES.pinned.some(p => p.name === 'Kerry-Ann Lewis' && p.kind === 'students'), 'and the result says so');
  const ab = B.students.filter(s => s.name === 'Andre Brown');
  assertEq(ab.map(s => s.keepSeparate === true), [true, false], 'the existing namesake pair is left as the Administrator set it');

  // Fee side.
  assert(B.feeStudents.every((f, i) => f.id === ORIG.feeStudents[i].id), 'fee record ids never change');
  assertEq(B.feeStudents.find(f => f.name === 'Omarion Blake').skillArea, 'Welding and Fabrication Level 2', 'fee records follow');
  assert(B.feeStudents.find(f => f.name === 'Omarion Blake').updatedAt === NOW1, 'and are stamped');
  assert(B.feePayments.every((p, i) => p.studentId === ORIG.feePayments[i].studentId && p.amount === ORIG.feePayments[i].amount), 'payments keep their trainee and amount');
  assert(!B.feePayments.some(p => /^WELDING L2$|^Welding$/i.test(p.skillArea)), 'and their programme name follows');
  assertEq(Object.keys(B.feeStructure).sort(), ['11. Welding and Fabrication Level 2', '12. Welding and Fabrication Level 2', 'COMMI CHEF L2'.replace('COMMI CHEF L2', 'Commercial Cooking'),
    'Electrical Installation Level 2', 'Welding and Fabrication Level 2'].sort(), 'programme fees are renamed, an intake key kept');
  assertEq(B.feeStructure['Electrical Installation Level 2'].total, 160000, 'a name already priced keeps its own fee');
  assertEq(B.feeStructure['Welding and Fabrication Level 2'].total, 120000, 'a fee moves with its programme');
  assert(B.feeDeletedKeys.some(k => /^WELDING L2\|/.test(k)) && B.feeDeletedKeys.some(k => /^Electrical Installation\|/.test(k)),
    'the old fee names are written down as gone, so another copy cannot bring them back');

  // Everything else.
  assertEq(B.accounts.find(a => a.name === 'Omarion Blake').programme, 'Welding and Fabrication Level 2', 'sign-in accounts follow');
  assertEq(B.instructors[0].course + ' | ' + B.instructors[0].courses.join(','), 'Welding and Fabrication Level 2 | Welding and Fabrication Level 2,Welding and Fabrication Level 2', 'instructors follow');
  assertEq(B.exams.map(e => e.course), ['Welding and Fabrication Level 2', 'Electrical Installation Level 2'], 'exams follow');
  assertEq([B.assignments[0].course, B.submissions[0].course, B.announcements[0].course], ['Welding and Fabrication Level 2', 'Welding and Fabrication Level 2', 'Welding and Fabrication Level 2'], 'assignments, hand-ins and notices follow');
  assertEq(B.unitCatalogs.map(u => u.skillArea), ['Welding and Fabrication Level 2', 'Electrical Installation'], 'a unit list follows unless its level says otherwise');
  assert(RES.skipped.some(x => x.id === 'QP-E3'), 'the Level 3 unit list is left, and reported');
  assertEq(Object.keys(B.certTemplates).sort(), ['Electrical Installation Level 2', 'Welding & Fabrication'], 'certificate designs keep their names (their pictures are filed under them)');
  assertEq(Core.certs.templateKey('11. Welding and Fabrication Level 2', B.certTemplates, B.certTemplateCourseMap), 'Welding & Fabrication', 'the renamed programme prints with the design it had');
  assertEq(Core.certs.templateKey('Electrical Installation Level 2', B.certTemplates, B.certTemplateCourseMap), 'Electrical Installation Level 2', 'a programme with its own design keeps it');
  assertEq(B.chatRooms.map(r => r.name), ORIG.chatRooms.map(r => r.name), 'class chat rooms are left to follow their centre (the dashboard does that)');
  assert(RES.counts.students > 0 && RES.counts.feeStudents > 0 && RES.counts.centres === 3, 'the result counts what changed: ' + JSON.stringify(RES.counts));
}

/* ======================================================= 4. The sign-in clean-up */
console.log('4. The sign-in clean-up after the tidy');
{
  const C = clone(B);
  const n = C.students.length, nf = C.feeStudents.length;
  const r = signInCleanUp(C);
  assertEq([r.moved, r.removed, r.feeRemoved], [0, 0, 0], 'no id moves, nothing is merged or dropped (trainees and fee records)');
  assertEq([C.students.length, C.feeStudents.length], [n, nf], 'every record is still there');
  assertEq(C.students.filter(s => s.name === 'Andre Brown').length, 2, 'the kept-separate namesakes are still two');
  assertEq(C.students.filter(s => s.name === 'Kerry-Ann Lewis').length, 2, 'the two Kerry-Ann Lewises are still two people');
  assertEq(C.students.filter(s => s.name === 'Rohan Spence').map(s => s.course).sort(), ['Electrical Installation Level 2', 'Electrical Installation and Maintenance Level 3'], 'a trainee on two levels keeps both enrolments');
  // The deleted trainee stays deleted — a stale copy from another computer,
  // as it was, or renamed by a tidy made there.
  const stale = { id: ORIG.deletedSid, name: 'Dwight Deleted', course: 'WELDING L2', stage: 'training', lastModified: NOW0 };
  assert(Core.isStudentTombstoned(stale, C.deleted, {}), 'a stale copy of the deleted trainee is still hidden');
  const elsewhere = { students: [clone(stale)] };
  T.apply(elsewhere, PLAN.renames, { now: NOW1 });
  assertEq(elsewhere.students[0].course, 'Welding and Fabrication Level 2', '(renamed by the same tidy on another computer)');
  assert(Core.isStudentTombstoned(elsewhere.students[0], C.deleted, {}), 'and still hidden once renamed: the id did not move');
  C.students.push(elsewhere.students[0]);
  const again = signInCleanUp(C);
  assert(again.removed === 1 && !C.students.some(s => s.name === 'Dwight Deleted'), 'the clean-up drops it again, nothing else');
  // A NEW person of a renamed trainee's name, added to the same programme
  // (the School Fee mirror, the new-trainee form): pinned as their own
  // person, so the clean-up never folds them into the trainee already there.
  const newcomer = { id: Core.stableStudentId({ name: 'Omarion Blake', course: 'Welding and Fabrication Level 2' }), name: 'Omarion Blake', course: 'Welding and Fabrication Level 2' };
  assert(Core.pinIfNamesake(newcomer, C.students) && newcomer.keepSeparate === true, 'a new namesake on the renamed programme is kept separate');
  C.students.push(newcomer);
  assertEq(signInCleanUp(C).removed, 0, 'and nobody is folded into anybody');
}

/* ======================================================= 5. Another computer */
console.log('5. Another computer\'s copy');
{
  const other = clone(ORIG);   // has not seen the tidy
  B.students.forEach(s => Core.cloudMerge.applyStudent(other.students, clone(s), null));
  assertEq(other.students.length, ORIG.students.length, 'merging the tidied roll adds nobody (the ids match)');
  assertEq(other.students.map(s => s.course), B.students.map(s => s.course), 'and every trainee takes the new programme name');
  assert(other.students.every(s => Core.keepsOwnId(s) || Core.stableStudentId(s) === s.id), 'with ids that still match their records');
  // Edited there after the tidy, before it arrived: the edit and the rename both stand.
  const o2 = clone(ORIG), st = o2.students.find(s => s.name === 'Omarion Blake');
  const idx = Core.stampStudentFields(o2.students, null, '', true);
  st.phone = '876-555-0101'; st.lastModified = '2026-11-07T16:00:00.000Z';
  Core.stampStudentFields(o2.students, idx, '2026-11-07T16:00:00.000Z');
  const merged = Core.mergeStudentRecords(st, B.students.find(s => s.name === 'Omarion Blake'));
  assertEq([merged.course, merged.idCourse, merged.phone, merged.id], ['Welding and Fabrication Level 2', 'WELDING L2', '876-555-0101', st.id],
    'a phone number changed there after the tidy and the rename both stand');
  // Centre names: the rename stands against a copy that has not heard of it.
  const mine = clone(B.centres), theirs = clone(ORIG.centres);
  Core.cloudMerge.applySkillAreas(mine, theirs, null);
  assertEq(mine[10].name, 'Welding and Fabrication Level 2', 'a computer that has not heard of the rename cannot put the old name back');
  Core.cloudMerge.applySkillAreas(theirs, clone(B.centres), null);
  assertEq(theirs[10].name, 'Welding and Fabrication Level 2', 'and takes the new name when it hears of it');
  const newer = clone(B.centres); newer[10].name = 'Welding & Fabrication (2025)'; newer[10].nameModified = '2026-11-08T09:00:00.000Z';
  Core.cloudMerge.applySkillAreas(mine, newer, null);
  assertEq(mine[10].name, 'Welding & Fabrication (2025)', 'a later rename still wins');
}

/* ======================================================= 6. Undo */
console.log('6. Undo puts back exactly what the tidy changed');
{
  const U = clone(B);
  const res = T.undo(U, RES, { now: '2026-11-07T17:00:00.000Z' });
  assert(res.restored === RES.changes.length && res.kept.length === 0, 'every change is put back (' + res.restored + '/' + RES.changes.length + ')');
  ['centres', 'students', 'feeStudents', 'feePayments', 'accounts', 'instructors', 'exams', 'assignments', 'submissions', 'announcements', 'unitCatalogs', 'certTemplateCourseMap']
    .forEach(k => assertEq(unstamped(U[k]), unstamped(ORIG[k]), k + ' are as they were'));
  assertEq(Object.keys(U.feeStructure).sort(), Object.keys(ORIG.feeStructure).sort(), 'the programme fees are under their old names again');
  assertEq(unstamped(U.feeStructure), unstamped(ORIG.feeStructure), 'with the fees they had');
  assert(U.feeDeletedKeys.some(k => /^11\. Welding and Fabrication Level 2\|2026-11-07T17/.test(k)), 'a fee name the tidy made is written down as gone again');
  assert(U.students.find(s => s.name === 'Omarion Blake').lastModified === '2026-11-07T17:00:00.000Z', 'the undone records are stamped, so the undo wins elsewhere');
  assertEq(U.centres[10].nameModified, '2026-11-07T17:00:00.000Z', '(centres too)');
  const r = signInCleanUp(U);
  assertEq([r.moved, r.removed], [0, 0], 'and the clean-up after the undo moves and merges nothing');
  // An edit made since the tidy is never undone.
  const V = clone(B);
  V.students.find(s => s.name === 'Jovaun Grant').course = 'Plumbing';
  const r2 = T.undo(V, RES, { now: '2026-11-07T17:00:00.000Z' });
  assertEq(V.students.find(s => s.name === 'Jovaun Grant').course, 'Plumbing', 'a programme changed since the tidy is left as it is now');
  assert(r2.kept.some(k => k.k === 'students' && k.f === 'course'), 'and reported');
}

/* ======================================================= 7. Filter menus */
console.log('7. Filter menus before any tidy');
{
  const store = { getItem: () => null };
  const opt = Core.catalogue.filterOptions(ORIG.centres, ORIG.students.map(s => s.course).concat(ORPHANS), store);
  assertEq(opt.archived, ['BEAUTY THERAPY L2', 'COMMI CHEF L2', 'HOSPITALITY SERVICES L2'], 'only names that agree with no single live programme stay archived');
  assertEq(opt.filed['Welding and Fabrication Level 2'], ['WELDING L2'], 'WELDING L2 is filed under the Level 2 programme');
  assertEq(opt.filed['Welding & Fabrication'].sort(), ['11. Welding & Fabrication', 'Welding'], '"Welding" (no level) under the programme with no level; an intake-keyed spelling under its own name');
  assertEq(opt.filed['Electrical Installation Level 2'], ['ELECTRICAL L2'], 'ELECTRICAL L2 under Electrical Installation Level 2');
  assertEq(opt.filed['General Cosmetology Level 2'], ['COSMETOLOGY L2'], 'COSMETOLOGY L2 under General Cosmetology Level 2');
  const f = Core.catalogue.filer(ORIG.centres, store);
  assert(f.matches('WELDING L2', 'Welding and Fabrication Level 2') && !f.matches('WELDING L2', 'Welding & Fabrication'), 'the filter finds WELDING L2 trainees under Level 2 only');
  assert(f.matches('welding and fabrication level 2', 'Welding and Fabrication Level 2'), 'case and spacing aside');
  assert(!f.matches('BEAUTY THERAPY L2', 'Cosmetology'), 'nothing is guessed');
  const amb = Core.catalogue.filer([{ id: 1, name: 'Plumbing Level 2' }, { id: 2, name: 'Plumbing Level 3' }, { id: 3, name: 'Plumbing' }], store);
  assertEq(amb.under('PLUMBING'), 'Plumbing', 'a name that is itself live is its own entry');
  const amb2 = Core.catalogue.filer([{ id: 1, name: 'Electrical Installation Level 2' }, { id: 2, name: 'Electrical Installation Level 2 (Evening)' }], store);
  assertEq(amb2.under('ELECTRICAL L2'), '', 'one that agrees with two live programmes stays archived');
}

/* ======================================================= 8. The page and the centre rename */
console.log('8. The page is the Administrator\'s; a centre renamed on its own takes School Fee along');
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const IX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fnSrc = name => {
    const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(IX);
    if (!m) throw new Error('index.html no longer defines ' + name + '()');
    let depth = 0;
    for (let i = IX.indexOf('{', m.index); i < IX.length; i++) {
      if (IX[i] === '{') depth++;
      else if (IX[i] === '}') { depth--; if (!depth) return IX.slice(m.index, i + 1); }
    }
    throw new Error('unbalanced ' + name);
  };
  const adminSidebar = fnSrc('buildAdminSidebar'), adminPages = fnSrc('buildAdminPages');
  const nav = 'data-page="tidy-programmes"';
  assert(adminSidebar.indexOf(nav) !== -1 && IX.split(nav).length === 2, 'one menu entry, in the Administrator\'s menu only');
  const admGroup = adminSidebar.slice(adminSidebar.indexOf('>Administration<'));
  assert(admGroup.indexOf(nav) !== -1 && admGroup.indexOf(nav) < admGroup.indexOf('External Systems'), 'in its Administration section');
  assert(adminPages.indexOf('id="page-tidy-programmes"') !== -1 && fnSrc('buildAdminStaffPages').indexOf('tidy-programmes') === -1, 'the page exists for the Administrator only (not Admin Staff, instructors or trainees)');
  assert(/function tidyProgAllowed\(\) \{ return currentRole === 'admin'/.test(IX), 'and refuses anyone else');
  assert(fnSrc('tidyProgApply').indexOf('confirm(') === -1 && fnSrc('tidyProgUndo').indexOf('confirm(') === -1, 'the confirm steps are on the page, never a pop-up');
  assert(fs.existsSync(path.join(__dirname, '..', 'Pages', 'Tidy-Programmes.html')), 'its markup is Pages/Tidy-Programmes.html');

  // Renaming a training centre on the Training Centres page: the trainee keeps
  // their id, and School Fee's records, payments and fee follow.
  const store = { data: {
    cestiSchoolFeeStudents: JSON.stringify([{ id: 'F1', name: 'Leroy Wright', skillArea: 'Plumbing', lmsId: 'S1', updatedAt: NOW0 }, { id: 'F2', name: 'Other', skillArea: 'Masonry', updatedAt: NOW0 }]),
    cestiSchoolFeePayments: JSON.stringify([{ id: 'P1', studentId: 'F1', skillArea: 'Plumbing', amount: 100, updatedAt: NOW0 }]),
    cestiFeeStructure: JSON.stringify({ Plumbing: { total: 90000, terms: [90000] } }), cestiSchoolFeeDeletedFeeKeys: '[]' } };
  const memStore = { getItem: k => (k in store.data ? store.data[k] : null), setItem: (k, v) => { store.data[k] = String(v); } };
  const s1 = { id: Core.stableStudentId({ name: 'Leroy Wright', course: 'Plumbing' }), name: 'Leroy Wright', course: 'Plumbing', schoolFeeId: 'F1' };
  const sb = { CESTISCore: Core, CESTISStore: memStore, window: { CESTISCore: Core, CESTISStore: memStore }, console: { log() {}, warn() {} },
    skillAreas: [{ id: 5, name: 'Plumbing', centreKey: '05' }], students: [s1], userAccounts: [], attendanceRecords: [], exams: [], instructorAssignments: [],
    assignmentSubmissions: [], instructorResources: [], driveResources: [], classSessions: [], certDownloadApprovals: [], certTemplates: {}, certTemplateCourseMap: {},
    lmsChatRooms: [], examResults: [], calendarEvents: [], syncRecordTombstone() {},
    safeJsonParse(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } } };
  vm.createContext(sb);
  vm.runInContext(['courseRenameScope', 'propagateCourseNameChangeToFee', 'propagateCourseNameChange', 'tidyProgTouchFeeFile'].map(fnSrc).join('\n'), sb);
  vm.runInContext("propagateCourseNameChange('Plumbing', 'Plumbing Level 2', courseRenameScope(skillAreas[0]));", sb);
  assertEq([s1.course, s1.idCourse, Core.stableStudentId(s1) === s1.id], ['Plumbing Level 2', 'Plumbing', true], 'the trainee is renamed and keeps their id');
  const fee = JSON.parse(store.data.cestiSchoolFeeStudents), pay = JSON.parse(store.data.cestiSchoolFeePayments), fst = JSON.parse(store.data.cestiFeeStructure);
  assertEq([fee[0].skillArea, fee[1].skillArea, pay[0].skillArea], ['Plumbing Level 2', 'Masonry', 'Plumbing Level 2'], 'School Fee\'s record and payment follow (and nothing else)');
  assertEq(Object.keys(fst), ['Plumbing Level 2'], 'and the programme\'s fee');
  assert(fee[0].updatedAt !== NOW0 && /^Plumbing\|/.test(JSON.parse(store.data.cestiSchoolFeeDeletedFeeKeys)[0] || ''), 'stamped, the old fee name written down as gone');
  assert(!!JSON.parse(store.data['cestis_pagecloud_stamps__CESTIS_School_Fees.json'] || '{}').cestiSchoolFeeStudents, 'and dated for School Fee\'s own copy, so it is sent rather than overwritten');
}

// ---- Found in review ------------------------------------------------------
console.log('Review: a mapped design, a fee set again, a namesake not deleted');
{
  // 1. 'Welding' had no design of its own but was mapped to one: the new name keeps it.
  const tpl = { 'Welding & Fabrication': { modules: [] } };
  const cmap = { 'Welding': 'Welding & Fabrication' };
  const bundle = { students: [{ id: 'S1', name: 'A', course: 'Welding' }], certTemplates: tpl, certTemplateCourseMap: cmap };
  const inv = T.inventory(bundle, { today: '2026-11-07' });
  const g = T.group(inv);
  const grp = g.groups.find(x => x.members.some(m => m === 'welding' || (m && m.norm === 'welding')));
  const pl = T.plan(inv, g, { keep: grp ? { [grp.id]: 'Welding Level 2' } : {} });
  T.apply(bundle, pl.renames, { now: '2026-11-07T12:00:00.000Z' });
  assertEq(Core.certs.templateKey('Welding Level 2', tpl, cmap), 'Welding & Fabrication', 'a name whose old spelling reached its design through the map keeps that design');
}
{
  // 2. Undo leaves a fee set again under the old name since the tidy.
  const fsx = { 'WELDING L2': { total: 120000, terms: [120000] } };
  const bundle = { students: [{ id: 'S1', name: 'A', course: 'WELDING L2' }], centres: [{ id: 1, name: 'Welding and Fabrication Level 2' }], feeStructure: fsx, feeDeletedKeys: [] };
  const inv = T.inventory(bundle, { today: '2026-11-07' });
  const g = T.group(inv);
  const pl = T.plan(inv, g, {});
  const res = T.apply(bundle, pl.renames, { now: '2026-11-07T12:00:00.000Z' });
  assert(!fsx['WELDING L2'] && fsx['Welding and Fabrication Level 2'], '(the fee moved with the programme)');
  fsx['WELDING L2'] = { total: 180000, terms: [180000] };          // priced again after the tidy
  const un = T.undo(bundle, res, { now: '2026-11-07T13:00:00.000Z' });
  assertEq(fsx['WELDING L2'].total, 180000, 'undo keeps a fee set again under the old name after the tidy');
  assert(un.kept.some(k => k.k === 'feeStructure' || /WELDING L2/i.test(String(k.what))), 'and reports that move as kept');
}
{
  // 3. Deleting a renamed trainee never deletes a namesake who holds the id her current name gives.
  const SP = require('fs').readFileSync(require('path').join(__dirname, '..', 'Student-Progress.html'), 'utf8');
  assert(/_heldByOther/.test(SP) && /!_heldByOther\) recordDeletedStudent\(_nowSid\)/.test(SP),
    'Student Progress writes down the second id only when no other trainee holds or hashes to it');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
