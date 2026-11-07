/* Every trainee with an approved account is on the roll (Student Progress).

   What the owner saw (Nov 2026): "All trainees are not seen in trainee
   progress, even those who created their own account." Three causes, pinned
   here with the real functions from index.html and cestis-core.js:

     1. A registration from home arrives already naming the id its record
        will have (its name + programme). Approving it created a record only
        when the account named NO id, so it got none.
     2. The roster reconcile skipped every account whose name and programme
        had ever been deleted — a trainee who registered again after a
        deletion (or after a test record of the same name was removed) never
        got a record. An account made AFTER the deletion is a new enrolment.
     3. A namesake on the same programme holding that id: the account was
        "already on the roll" as somebody else. Now a namesake whose email,
        TRN or date of birth differs is another person, and the newcomer gets
        a record of their own.

   Run: node tests/missing-trainees.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function extract(src, name) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error('index.html no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
function memStore(init) {
  const m = Object.assign({}, init || {});
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
}
const FNS = ['reconcileStudentsFromAccounts', 'createStudentDataForAccount', 'traineeIdForAccount', 'instructorCourseMatch',
  'studentAccountTombstoned', 'cestisIsStudentTombstoned', '_getDeletedStudentIds', '_getDeletedStudentTimes', 'findStudentRecordForAccount'];
function world(o) {
  const store = memStore(o.store);
  const sb = { CESTISCore: Core, CESTISStore: store, students: o.students || [], userAccounts: o.accounts || [], instructorData: [], attendanceRecords: [],
    skillAreas: [], console, findSkillAreaForCourse: () => null, localDateStr: () => '2026-11-07', cestisGenId: p => p + 'gen' + (++sb._n), _n: 0,
    updateSkillAreaCounts: () => {}, saveState: () => { sb.saved++; }, saved: 0, isStudentDeleted: id => Core.readDeletedIds(store)[id] === true,
    _delStudentIdsMemo: null, _delStudentIdsAt: 0, _delStudentAtMemo: null, _delStudentAtAt: 0 };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(FNS.map(n => extract(SRC, n)).join('\n'), sb);
  return sb;
}
const visible = (sb, rec) => !!rec && !Core.isStudentTombstoned(rec, Core.readDeletedIds(sb.CESTISStore), Core.readDeletedStudentTimes(sb.CESTISStore));

console.log('1. A registration from home, approved: it gets its record');
{
  const sid = Core.stableStudentId({ name: 'Kerry-Ann Lewis', course: 'Welding & Fabrication' });
  const acct = { id: 'USR-home1', role: 'student', status: 'active', name: 'Kerry-Ann Lewis', programme: 'Welding & Fabrication',
    email: 'kalewis@mail.test', studentDataId: sid, registeredVia: 'home-registration', createdAt: '2026-11-01T10:00:00.000Z', approvedAt: '2026-11-02' };
  const sb = world({ accounts: [acct] });
  vm.runInContext('reconcileStudentsFromAccounts()', sb);
  const rec = sb.students.find(s => s.id === sid);
  assert(!!rec && rec.name === 'Kerry-Ann Lewis', 'the reconcile makes her record under the id her registration named');
  assert(visible(sb, rec), 'and it is on the roll');
  const approve = extract(SRC, 'approveUser');
  assert(/if \(user\.role === 'student'\) \{\s*var existingStudent = findStudentRecordForAccount\(user\);/.test(approve), 'approving looks for her record, and makes one, even though her account already names an id');
  const all = extract(SRC, 'approveAllPending');
  assert(/if \(u\.role === 'student'\) \{\s*var existingStudent = findStudentRecordForAccount\(u\);/.test(all), 'and so does Approve All');
}

console.log('2. Registered again after a deletion of the same name: a new enrolment, on the roll');
{
  const sid = Core.stableStudentId({ name: 'Test Trainee', course: 'Plumbing' });
  const store = {};
  const s = memStore(store); Core.recordStudentDeletionTime(sid, s, '2026-10-01T09:00:00.000Z');
  s.setItem(Core.TOMBSTONE_KEY, JSON.stringify([sid]));
  const after = { id: 'USR-new', role: 'student', status: 'active', name: 'Test Trainee', programme: 'Plumbing', email: 't@x.test', createdAt: '2026-11-03T10:00:00.000Z', approvedAt: '2026-11-03' };
  const sb = world({ accounts: [after], store: s._m });
  vm.runInContext('reconcileStudentsFromAccounts()', sb);
  const rec = sb.students.find(x => x.id === after.studentDataId);
  assert(!!rec, 'an account made after the deletion gets a record');
  assert(visible(sb, rec), 'and the old deletion does not hide it');
  const before = { id: 'USR-old', role: 'student', status: 'active', name: 'Test Trainee', programme: 'Plumbing', createdAt: '2026-09-01T10:00:00.000Z', approvedAt: '2026-09-01' };
  const sb2 = world({ accounts: [before], store: s._m });
  vm.runInContext('reconcileStudentsFromAccounts()', sb2);
  assert(sb2.students.length === 0, '(the deleted trainee\'s own older account does not bring the deleted record back)');
}

console.log('3. A namesake on the same programme is another person');
{
  const sid = Core.stableStudentId({ name: 'Steve Barrett', course: 'Welding & Fabrication' });
  const certified = { id: sid, name: 'Steve Barrett', course: 'Welding & Fabrication', stage: 'certified', certNo: 'WF-2026-1234-AB', email: 'sbarrett@mail.test' };
  const acct = { id: 'USR-sb', role: 'student', status: 'active', name: 'Steve Barrett', programme: 'Welding & Fabrication',
    email: 'steve.barrett@student.heartlms.edu.jm', studentDataId: sid, createdAt: '2026-11-05T10:00:00.000Z', approvedAt: '2026-11-05' };
  const sb = world({ students: [Object.assign({}, certified)], accounts: [acct] });
  assert(vm.runInContext('findStudentRecordForAccount(userAccounts[0])', sb) === null, 'the namesake\'s record is not his');
  vm.runInContext('reconcileStudentsFromAccounts()', sb);
  const mine = sb.students.find(x => x.id === acct.studentDataId);
  assert(sb.students.length === 2 && acct.studentDataId !== sid && !!mine, 'he gets a record of his own, with an id of its own');
  assert(mine && mine.stage === 'training' && !mine.certNo, 'in training, with no certificate');
  const theirs = sb.students.find(x => x.id === sid);
  assert(theirs.stage === 'certified' && theirs.certNo === 'WF-2026-1234-AB', 'the certified trainee is untouched');
  const sb2 = world({ students: [Object.assign({}, certified)], accounts: [Object.assign({}, acct)] });
  vm.runInContext('reconcileStudentsFromAccounts()', sb2);
  assert(sb2.userAccounts[0].studentDataId === acct.studentDataId, 'another office PC gives him the same id');
  const same = Object.assign({}, acct, { id: 'USR-sb2', email: 'sbarrett@mail.test', studentDataId: sid });
  const sb3 = world({ students: [Object.assign({}, certified)], accounts: [same] });
  vm.runInContext('reconcileStudentsFromAccounts()', sb3);
  assert(sb3.students.length === 1 && same.studentDataId === sid, '(the certified man\'s own second account still links to his record)');
}

console.log('4. Student Progress says who is waiting for approval');
{
  const SP = fs.readFileSync(path.join(ROOT, 'Student-Progress.html'), 'utf8');
  const el = { hidden: true, innerHTML: '' };
  const sb = { CESTISCore: Core, document: { getElementById: id => (id === 'spPendingNote' ? el : null) }, window: {},
    userAccounts: [{ id: 'U1', role: 'student', status: 'pending', name: 'Ann Lee' }, { id: 'U2', role: 'student', status: 'active', name: 'Bo' },
      { id: 'U3', role: 'instructor', status: 'pending', name: 'Ins' }, { id: 'U4', role: 'student', status: 'pending', name: 'Cy Reid' }] };
  sb.window.CESTISCore = Core; sb.window.parent = sb.window;
  vm.createContext(sb);
  vm.runInContext(extract(SP, 'spEscapeHtml') + '\n' + extract(SP, 'spRenderPendingNote') + '\nspRenderPendingNote();', sb);
  assert(!el.hidden && /2 trainees waiting for approval/.test(el.innerHTML) && /Ann Lee/.test(el.innerHTML) && /Cy Reid/.test(el.innerHTML) && !/Ins/.test(el.innerHTML),
    'two trainees waiting (not the instructor): named, with where to approve them');
  sb.userAccounts = [];
  vm.runInContext('spRenderPendingNote();', sb);
  assert(el.hidden, 'nobody waiting: no note');
}

console.log((failed ? '✗' : '✓') + ' ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
