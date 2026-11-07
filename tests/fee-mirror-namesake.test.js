/* A trainee added in School Fee reaches the roll (Student Progress) — or the
   page says why not.

   The owner asked to check what happens when trainees are created from School
   Fee. Three ways they were silently left off, pinned here with the real
   cestis-core.js rules both mirrors use (the dashboard's
   syncStudentsFromLocalFeeSystem and School Fee's syncStudentsToProgressDashboard):

     1. A namesake already on the roll on ANY programme was taken to be them
        (the fee page may not enrol anybody), so a second John Brown added on
        Plumbing was linked to the Welding John Brown and never listed — and
        the Welding man's link to his own fee record moved to the newcomer's.
        Now a namesake already linked to another fee record, or whose email,
        TRN or date of birth differs, is somebody else.
     2. A fee record whose name and programme had ever been deleted on the
        dashboard was ignored for good. One ADDED after the deletion is a new
        enrolment.
     3. A fee programme with no training centre is (rightly) not enrolled —
        Student Progress now says so, naming them and what to do.

   Run: node tests/fee-mirror-namesake.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const ROOT = path.join(__dirname, '..');
function extract(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const CENTRES = [{ id: 'SA-W', name: 'Welding & Fabrication', startDate: '2026-09-01', endDate: '2027-06-30' },
                 { id: 'SA-P', name: 'Plumbing', startDate: '2026-09-01', endDate: '2027-06-30' }];
const target = (fee, roll) => Core.lmsMirrorTarget(fee, roll, CENTRES, { findCentre: Core.enrolment.findCentre, twinIndex: Core.twinIndex(roll), on: '2026-10-01' });
const WELDER = { id: 'STU-jb-w', name: 'John Brown', course: 'Welding & Fabrication', schoolFeeId: 'FEE-1', email: 'jbrown.w@mail.test' };

console.log('1. A namesake on the roll is not taken for a different person');
{
  let t = target({ id: 'FEE-2', name: 'John Brown', skillArea: 'Plumbing', enrollmentDate: '2026-10-01' }, [Object.assign({}, WELDER)]);
  assert(t.action === 'create' && t.course === 'Plumbing', 'a second John Brown on Plumbing (the Welding one has his own fee record): enrolled on Plumbing');
  t = target({ id: 'FEE-3', name: 'John Brown', skillArea: 'Plumbing', email: 'other@mail.test' }, [Object.assign({}, WELDER, { schoolFeeId: '' })]);
  assert(t.action === 'create', 'a John Brown with another email: enrolled');
  t = target({ id: 'FEE-4', name: 'John Brown', skillArea: 'Plumbing', nationalId: '111-222-333' }, [Object.assign({}, WELDER, { schoolFeeId: '', trn: '999888777' })]);
  assert(t.action === 'create', 'a John Brown with another TRN: enrolled');
  t = target({ id: 'FEE-1', name: 'John Brown', skillArea: 'Plumbing' }, [Object.assign({}, WELDER)]);
  assert(t.action === 'link' && t.match.id === 'STU-jb-w', '(his own fee record, priced on another programme, still finds him and never enrols him twice)');
  const twin = { id: 'SF-FEE-6', name: 'John Brown', course: 'Welding & Fabrication' };
  const roll = [Object.assign({}, WELDER, { id: Core.stableStudentId(WELDER) })];
  assert(Core.pinIfNamesake(twin, roll) && twin.keepSeparate === true, 'a second John Brown on Welding (another person): pinned as his own, so the id clean-up never folds them');
  const plumber = { id: 'SF-FEE-7', name: 'John Brown', course: 'Plumbing' };
  assert(!Core.pinIfNamesake(plumber, roll) && !plumber.keepSeparate, '(on another programme there is nothing to fold: not pinned)');
  t = target({ id: 'FEE-5', name: 'John Brown', skillArea: 'Plumbing' }, [Object.assign({}, WELDER, { schoolFeeId: '', email: '' })]);
  assert(t.action === 'link', '(a namesake with no fee record and nothing to tell them apart: still taken to be him, as before)');
}

console.log('2. Added after a deletion of the same name: a new enrolment');
{
  const fee = { id: 'FEE-9', name: 'Test Trainee', skillArea: 'Plumbing', createdAt: '2026-11-03T10:00:00.000Z' };
  const sid = Core.stableStudentId({ name: 'Test Trainee', course: 'Plumbing' });
  const del = {}; del[sid] = true;
  assert(!Core.feeRecordTombstoned(fee, del, { [sid]: '2026-10-01T09:00:00.000Z' }), 'a fee record made after the deletion is not hidden by it');
  assert(Core.feeRecordTombstoned(fee, del, { [sid]: '2026-11-05T09:00:00.000Z' }), 'one made before it still is');
  assert(Core.feeRecordTombstoned(Object.assign({}, fee, { createdAt: '' }), del, { [sid]: '2026-10-01T09:00:00.000Z' }), 'one with no date is taken as older (still hidden)');
  assert(Core.feeRecordTombstoned(fee, new Set(['SF-FEE-9']), {}), 'deleted under its mirror id, with no time: hidden');
  assert(!Core.feeRecordTombstoned(fee, {}, {}), 'nothing deleted: not hidden');
}

console.log('3. Accounts: a namesake account whose email differs is not this trainee\'s');
{
  const AA = Core.accountAccess;
  const accts = [{ id: 'U1', role: 'student', name: 'John Brown', programme: 'Plumbing', email: 'jb1@mail.test', studentDataId: 'STU-x' }];
  assert(!AA.accountForTrainee(accts, { name: 'John Brown', programme: 'Plumbing', email: 'jb2@mail.test' }).match, 'another email: not his account (so he is enrolled)');
  assert(!!AA.accountForTrainee(accts, { name: 'John Brown', programme: 'Plumbing' }).match, '(no email to compare: the account is still taken to be his, as before)');
}

console.log('4. Both mirrors use the rule; the dashboard\'s marks the new enrolment');
{
  const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const FEE = fs.readFileSync(path.join(ROOT, 'School.Fee.html'), 'utf8');
  const m = extract(SRC, 'syncStudentsFromLocalFeeSystem');
  assert(/CESTISCore\.feeRecordTombstoned\(fee, deleted,/.test(m) && /CESTISCore\.markEnrolment\(_newStudent/.test(m) && /enrolmentStamp\(/.test(m),
    'the dashboard mirror: deletions by time, the new-enrolment mark, the centre and year stamp');
  const p = extract(FEE, 'syncStudentsToProgressDashboard');
  assert(/CESTISCore\.feeRecordTombstoned\(sf, _del, _delTimes\)/.test(p) && /CESTISCore\.markEnrolment\(lmsStudents\[lmsStudents\.length - 1\]/.test(p),
    'School Fee\'s own mirror: the same');
}

console.log('5. Student Progress names School Fee trainees with no training centre');
{
  const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
  const store = { cestiSchoolFeeStudents: JSON.stringify([
    { id: 'F1', name: 'Ann Lee', skillArea: 'Cosmetology', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'F2', name: 'Bo Reid', skillArea: 'Plumbing', createdAt: '2026-10-01T00:00:00Z' },
    { id: 'F3', name: 'Cy Moss', skillArea: 'Cosmetology', createdAt: '2026-10-01T00:00:00Z' }]) };
  const el = { hidden: true, innerHTML: '' };
  const sb = { CESTISCore: Core, CESTISStore: { getItem: k => store[k] || null }, students: [], skillAreas: CENTRES, window: {},
    document: { getElementById: id => (id === 'spFeeOnlyNote' ? el : null) } };
  sb.window.CESTISCore = Core;
  vm.createContext(sb);
  vm.runInContext(['safeJsonParse', 'spEscapeHtml', 'spFeeOnlyTrainees', 'spRenderFeeOnlyNote'].map(n => extract(SP, n)).join('\n') + '\nspRenderFeeOnlyNote();', sb);
  assert(!el.hidden && /2 trainees in School Fee are not on this list/.test(el.innerHTML) && /Ann Lee/.test(el.innerHTML) && /Cosmetology \(2\)/.test(el.innerHTML) && !/Bo Reid/.test(el.innerHTML),
    'two Cosmetology trainees (no training centre) are named, with their programme and what to do; the Plumbing one is not');
}

console.log((failed ? '✗' : '✓') + ' ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
