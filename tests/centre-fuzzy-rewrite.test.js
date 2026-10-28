/* A device that has not yet received a new training centre never rewrites
   that centre's trainees onto a like-named one — and never moves their ids.

   What was observed (the end-to-end flow test, not reproduced there): with a
   new centre "Welding" next to the existing "Welding & Fabrication",
   trainees the administrator had created on "Welding" were rewritten to
   "Welding & Fabrication" by a second administrator device, and their stable
   ids changed.

   The mechanism, reproduced here with the real functions: every name lookup
   of a centre goes through CESTISCore.enrolment.findCentre, whose looser
   passes are built for the Centre's shorthand ("WELDING L2" finds "Welding
   and Fabrication Level 2") — so "Welding" finds "Welding & Fabrication" on a
   device whose list lacks the centre actually called "Welding". Several
   places took that answer as fact and WROTE it onto stored records:
     - the School Fee page bound the trainee's fee record to that intake
       (feeBindTraineesToIntake), and, not yet holding the trainee's dashboard
       record, mirrored the fee record onto the dashboard as a NEW trainee on
       "Welding & Fabrication" carrying that intake's key
       (syncStudentsToProgressDashboard / CESTISCore.lmsMirrorTarget); the
       dashboard's own mirror did the same (syncStudentsFromLocalFeeSystem);
     - when the two records of the one person met, the same-name collapse
       took the keyed spelling and the key onto the survivor — the
       administrator's own record — and its stable id (a hash of name and
       programme) moved with the new programme;
     - a trainee registered or approved there was stamped with that intake
       (createStudentDataForAccount), a record still waiting for its fiscal
       year was grounded in it (backfillStudentFiscalYears), and the
       course-end sweep judged a trainee of the new centre by the old one's
       end date and marked them Not Yet Competent (applyCourseEndStatuses).

   A record is now rewritten only on an exact (normalised) match:
   findCentre(…, { exact: true }) answers only to an intake key or the exact
   name. The shorthand matching stays where it is the point and writes
   nothing that already names a programme on another device (pricing and
   folding the fee page's own spellings, counting, display).

   Two "devices" here: the office PC holds both centres; the second
   administrator PC never received the new one.

   Run: node tests/centre-fuzzy-rewrite.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { assert(a === b, msg + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FEE = fs.readFileSync(path.join(ROOT, 'School.Fee.html'), 'utf8');
function extractFunction(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('page no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const clone = v => JSON.parse(JSON.stringify(v));

/* The Centre: last year's "Welding & Fabrication" (ended) and this year's new
   "Welding" centre, keyed the way the dashboard keys them. */
const CENTRES = [
  { id: 1, name: 'Welding & Fabrication', startDate: '2025-08-04', endDate: '2026-07-31' },
  { id: 30, name: 'Welding', startDate: '2026-09-01', endDate: '2027-06-30' }
];
Core.enrolment.assignCentreKeys(CENTRES);
const OLD_ONLY = [clone(CENTRES[0])];          // the second admin PC's list

function store(init) {
  const map = Object.assign({}, init || {});
  return { getItem: k => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
           setItem: (k, v) => { map[k] = String(v); }, removeItem: k => { delete map[k]; }, _map: map };
}

/* The dashboard (index.html), as much of it as these paths use. */
function dashboard(centres, opts) {
  opts = opts || {};
  const st = store(opts.store);
  const sb = {
    CESTISCore: Core, CESTISStore: st, console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Object, Array, String, Number, RegExp, Set, Map,
    window: null,
    skillAreas: clone(centres), students: clone(opts.students || []), userAccounts: clone(opts.accounts || []),
    instructorData: [], attendanceRecords: [], studentProfiles: {}, _delStudentAtMemo: null,
    _feeMirrorLastRaw: null, _feeMirrorCheckedAt: 0, FEE_MIRROR_MIN_INTERVAL_MS: 1000, _rosterReadThisSession: false,
    saveState() {}, updateSkillAreaCounts() {}, broadcastStudentsToFeeFrames() {},
    localDateStr: () => '2026-10-22'
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(['cestisGenId', 'findSkillAreaForCourse', 'instructorCourseMatch', 'createStudentDataForAccount',
    'syncStudentsFromLocalFeeSystem', 'rosterAwaitingSync', 'traineeRecordExistsElsewhere', 'backfillStudentFiscalYears', 'courseDurationRecord', 'studentCentreRecord',
    'studentCourseStatus', 'courseEndKeyFor', 'studentStampedElsewhere', 'courseEndTranscriptData', 'applyCourseEndStatuses', 'readArr', 'syncStudentsToSchoolFee']
    .map(n => extractFunction(INDEX, n)).join('\n\n'), sb);
  return sb;
}
/* The School Fee page in its iframe on the same PC. */
function feePage(centres, feeRoll, lmsRoll) {
  const st = store({ voctrain_skillAreas: JSON.stringify(centres), voctrain_students: JSON.stringify(lmsRoll || []) });
  const sb = { CESTISCore: Core, CESTISStore: st, console: { log() {}, warn() {} }, Date, Math, JSON, Object, Array, String,
    students: clone(feeRoll), saveData() {}, window: null };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(['feeTrainingCentres', 'feeBindTraineesToIntake', 'syncStudentsToProgressDashboard']
    .map(n => extractFunction(FEE, n)).join('\n\n'), sb);
  return sb;
}

/* ---------- The office PC: the administrator enrols Ama on "Welding" ---------- */
console.log('The office PC enrols Ama on the new "Welding" centre');
const office = dashboard(CENTRES);
const amaAccount = { id: 'USR-AMA', name: 'Ama Mensah', role: 'student', programme: 'Welding', status: 'active' };
office.userAccounts.push(amaAccount);
vm.runInContext('createStudentDataForAccount(userAccounts[0])', office);
const ama = clone(office.students[0]);
assertEq(ama.course, 'Welding', 'her programme is "Welding"');
assertEq(ama.centreId, 30, 'and she is stamped with the "Welding" centre');
assertEq(ama.id, Core.stableStudentId({ name: 'Ama Mensah', course: 'Welding' }), 'her id is the stable id of her name and programme');
vm.runInContext('syncStudentsToSchoolFee()', office);
const feeRoll = JSON.parse(office.CESTISStore.getItem('cestiSchoolFeeStudents'));
assert(feeRoll.length === 1 && feeRoll[0].lmsId === ama.id && feeRoll[0].skillArea === 'Welding',
  'and the fee roll carries her, linked to her dashboard record (' + JSON.stringify(feeRoll) + ')');

/* ---------- The second admin PC: it has the fee roll, not yet the centre ---------- */
console.log('A second admin PC that has not received the "Welding" centre yet');
// Its School Fee page binds fee records to an intake and mirrors them onto the dashboard.
const fee2 = feePage(OLD_ONLY, feeRoll, []);
vm.runInContext('feeBindTraineesToIntake()', fee2);
assert(!fee2.students[0].centreKey || fee2.students[0].centreKey === CENTRES[1].centreKey,
  'her fee record is never bound to the old "Welding & Fabrication" intake (' + JSON.stringify(fee2.students[0].centreKey) + ')');
vm.runInContext('syncStudentsToProgressDashboard()', fee2);
const mirrored = JSON.parse(fee2.CESTISStore.getItem('voctrain_students') || '[]');
assert(!mirrored.some(s => /fabrication/i.test(s.course || '')),
  'the fee page does not invent a dashboard record for her on "Welding & Fabrication" (' + JSON.stringify(mirrored.map(s => [s.id, s.course, s.centreKey])) + ')');
// The dashboard's own mirror of the fee roll, on the same PC.
const pc2 = dashboard(OLD_ONLY, { store: { cestiSchoolFeeStudents: JSON.stringify(feeRoll) } });
vm.runInContext('syncStudentsFromLocalFeeSystem(true)', pc2);
assert(!pc2.students.some(s => /fabrication/i.test(s.course || '')),
  'nor does the dashboard (' + JSON.stringify(pc2.students.map(s => [s.id, s.course])) + ')');

/* ---------- The two records of one person meet ---------- */
console.log('When her record meets a copy filed under the like-named intake, hers stands');
// The copy an earlier version minted (the fee page's mirror: an 'SF-' id, the
// old intake's name and key) reaches the office PC through the Centre's server.
const stray = { id: 'SF-' + ama.id, schoolFeeId: ama.id, name: 'Ama Mensah', course: 'Welding & Fabrication',
  centreKey: CENTRES[0].centreKey, centreId: 1, centreName: 'Welding & Fabrication', stage: 'testing', progress: 0, source: 'schoolfee' };
const both = [Object.assign(clone(ama), { stage: 'training', progress: 5 }), clone(stray)];
const col = Core.collapseSameNameStudents(both);
assertEq(col.students.length, 1, 'one person, one record');
const kept = col.students[0];
assertEq(kept.course, 'Welding', 'she keeps her programme');
assert(kept.centreKey == null || Core.enrolment.centreKeyOf({ centreKey: kept.centreKey }) !== CENTRES[0].centreKey,
  'and is not keyed into the old intake (' + JSON.stringify(kept.centreKey) + ')');
assertEq(kept.centreId, 30, 'her centre stamp is still the "Welding" centre');
const bundle = { students: col.students, userAccounts: [Object.assign({}, amaAccount, { studentDataId: ama.id })],
  attendanceRecords: [], certDownloadApprovals: [], examResults: [], studentProfiles: {} };
Core.migrateToStableIds(bundle);
assertEq(bundle.students[0].id, ama.id, 'and her stable id does not move');
assertEq(bundle.userAccounts[0].studentDataId, ama.id, 'so her login still points at her record');

/* ---------- Writes made on the second PC itself ---------- */
console.log('A trainee registered on the second PC is not stamped into the like-named intake');
const pc3 = dashboard(OLD_ONLY, { accounts: [{ id: 'USR-YAW', name: 'Yaw Darko', role: 'student', programme: 'Welding', status: 'active' }] });
vm.runInContext('createStudentDataForAccount(userAccounts[0])', pc3);
const yaw = pc3.students[0];
assertEq(yaw.course, 'Welding', 'his programme is what was chosen');
assert(yaw.centreId !== 1 && yaw.centreName !== 'Welding & Fabrication', 'and no other centre\'s stamp is written on him (' + JSON.stringify([yaw.centreId, yaw.centreName]) + ')');
assertEq(yaw.id, Core.stableStudentId({ name: 'Yaw Darko', course: 'Welding' }), 'his id comes from his own programme');

console.log('A record waiting for its fiscal year is not grounded in the like-named intake');
const pc4 = dashboard(OLD_ONLY, { students: [{ id: 'S-K', name: 'Kofi Asante', course: 'Welding', enrolmentDate: '2026-09-15' }] });
vm.runInContext('backfillStudentFiscalYears()', pc4);
const kofi = pc4.students[0];
assert(kofi.centreId == null && !kofi.centreKey, 'no centre stamp from a like-named centre (' + JSON.stringify([kofi.centreId, kofi.centreKey]) + ')');
assertEq(kofi.fiscalYear, '2026/2027', 'his fiscal year comes from his own enrolment date');

console.log('The course-end sweep does not judge her by the old intake\'s end date');
const pc5 = dashboard(OLD_ONLY, { students: [Object.assign(clone(ama), { stage: 'training' })] });
vm.runInContext('applyCourseEndStatuses()', pc5);
assertEq(pc5.students[0].stage, 'training', 'she is not marked Not Yet Competent because "Welding & Fabrication" ended');
// …and on the office PC, which holds her centre, the rule is the same as ever.
const pc6 = dashboard([Object.assign(clone(CENTRES[0])), Object.assign(clone(CENTRES[1]), { endDate: '2026-10-01' })],
  { students: [Object.assign(clone(ama), { stage: 'training' })] });
vm.runInContext('applyCourseEndStatuses()', pc6);
assertEq(pc6.students[0].stage, 'nyc', 'where her own centre has ended, she is marked as before');

/* ---------- The shorthand still works where it writes nothing it should not ---------- */
console.log('The Centre\'s shorthand still finds its centre');
const L2 = [{ id: 22, name: 'Welding and Fabrication Level 2', startDate: '2026-08-02', endDate: '2027-07-30' }];
Core.enrolment.assignCentreKeys(L2);
assertEq((Core.enrolment.findCentre(L2, 'WELDING L2') || {}).id, 22, 'findCentre still reads "WELDING L2" as the Level 2 centre');
assertEq(Core.enrolment.findCentre(L2, 'WELDING L2', { exact: true }), null, 'but an exact lookup does not');
assertEq((Core.enrolment.findCentre(L2, 'welding and fabrication   LEVEL 2', { exact: true }) || {}).id, 22, 'case and spacing aside');
assertEq((Core.enrolment.findCentre(L2, '22. Welding and Fabrication Level 2', { exact: true }) || {}).id, 22, 'and an intake key settles it');
const t = Core.lmsMirrorTarget({ id: 'F9', name: 'Cy Dean', skillArea: 'WELDING L2' }, [], L2,
  { findCentre: Core.enrolment.findCentre, on: '2026-09-01' });
assertEq(t.action + ':' + t.course, 'create:Welding and Fabrication Level 2',
  'a fee-only trainee written in the fee page\'s shorthand is still brought over under the centre\'s own name');
const t2 = Core.lmsMirrorTarget({ id: ama.id, lmsId: ama.id, name: 'Ama Mensah', skillArea: 'Welding', source: 'lms' }, [], OLD_ONLY,
  { findCentre: Core.enrolment.findCentre });
assertEq(t2.action, 'skip', 'but the mirror of a dashboard trainee waits for her own centre instead of choosing a like-named one');
const t3 = Core.lmsMirrorTarget({ id: ama.id, lmsId: ama.id, name: 'Ama Mensah', skillArea: 'Welding', source: 'lms' }, [], CENTRES,
  { findCentre: Core.enrolment.findCentre });
assertEq(t3.action + ':' + t3.course, 'create:Welding', 'and, once that centre is there, finds exactly it');

console.log('The fee page binds a dashboard trainee where the dashboard holds her');
const fee1 = feePage(CENTRES, feeRoll, [ama]);
vm.runInContext('feeBindTraineesToIntake()', fee1);
assertEq(fee1.students[0].centreKey, CENTRES[1].centreKey, 'on the office PC her fee record joins the "Welding" intake');
const legacy = [{ id: 'F-OLD', name: 'Omar Reid', skillArea: 'WELDING L2', enrollmentDate: '2026-09-01' }];
const fee3 = feePage(L2, legacy, []);
vm.runInContext('feeBindTraineesToIntake()', fee3);
assertEq(fee3.students[0].centreKey, '22', 'and the page\'s own shorthand still binds its trainee to the intake it names');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
