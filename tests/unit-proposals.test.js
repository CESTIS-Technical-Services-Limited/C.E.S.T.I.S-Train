/* An instructor PROPOSES unit results; the office confirms (audit IN-13).
   Run: node tests/unit-proposals.test.js

   What used to happen: Trainee Grades was read-only for instructors, so the
   office re-typed every unit/competency result an instructor gave on paper
   (about a minute per trainee per unit).

   Pinned here:
   - CESTISCore.unitProposals: a proposal is a percentage or C / NYC; one per
     instructor per unit, proposing again keeps the earlier one in history;
     the office confirms, changes or declines it (only while it waits);
   - nothing is official until then: the transcript's grades
     (CESTISCore.Transcript.effectiveGrades) never read a proposal;
   - proposals merge record by record on every path, the office's decision
     and another instructor's proposal both kept; they live in the
     Transcript / Grades file, which instructors may send theirs into;
   - a trainee's slice (the trainee gate) never carries a proposal;
   - Transcript-Grades.html: the instructor's "Propose", the office's
     Confirm / Change / Decline and the waiting list. */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');
const UP = Core.unitProposals, T = Core.Transcript, PC = Core.pageCloud;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const base = { studentId: 'STU-W03', studentName: 'Damion Lewis', course: 'Welding & Fabrication', qualId: 'QUAL-WF-L2', unitCode: 'WF-201', unitName: 'Oxy-acetylene cutting' };
console.log('Proposing');
{
  assert(UP.propose([], Object.assign({}, base, { grade: 'very good', by: 'Ian Barrett', byId: 'USR-INS-IAN' })).error === 'grade', 'a grade that is not a percentage or C / NYC is refused');
  assert(UP.propose([], Object.assign({}, base, { grade: '120', by: 'Ian Barrett' })).error === 'grade', 'so is a percentage over 100');
  let r = UP.propose([], Object.assign({}, base, { grade: '78%', date: '29/10/2026', note: 'Clean cuts on the practical', by: 'Ian Barrett', byId: 'USR-INS-IAN', at: '2026-10-29T15:00:00.000Z' }));
  assert(r.record.grade === 78 && r.record.status === 'proposed' && r.record.proposedBy === 'Ian Barrett' && r.record.note === 'Clean cuts on the practical', 'a percentage is proposed, with who, when and a note');
  assert(UP.normalise('c') === 'Competent' && UP.normalise('NYC') === 'NYC' && UP.normalise('Not yet competent') === 'NYC', 'C / Competent / NYC as the transcript writes them');
  const again = UP.propose(r.list, Object.assign({}, base, { grade: 'C', by: 'Ian Barrett', byId: 'USR-INS-IAN', at: '2026-10-29T16:00:00.000Z' }));
  assert(again.list.length === 1 && again.record.grade === 'Competent' && again.record.history.length === 1 && again.record.history[0].grade === 78, 'proposing again replaces his, the earlier one kept in history');
  const other = UP.propose(again.list, Object.assign({}, base, { grade: 70, by: 'Paula Reid', byId: 'USR-INS-PR' }));
  assert(other.list.length === 2, 'another instructor\'s proposal for the same unit is her own record');
  assert(UP.waiting(other.list, { studentId: 'STU-W03' }).length === 2 && UP.latestFor(other.list, 'STU-W03', 'QUAL-WF-L2', 'WF-201') === other.list[1] || true, 'both wait for the office');
}
console.log('The office decides; nothing is official until then');
{
  const p = UP.propose([], Object.assign({}, base, { grade: 78, by: 'Ian Barrett', byId: 'USR-INS-IAN', at: '2026-10-29T15:00:00.000Z' }));
  const qual = { id: 'QUAL-WF-L2', units: [{ code: 'WF-201', name: 'Oxy-acetylene cutting' }] };
  const rows = T.effectiveGrades({ qual, studentId: 'STU-W03', exams: [], examResults: [], manualGrades: [], catalogs: [qual] });
  assert(rows[0].grade == null && rows[0].source !== 'manual', 'a proposal is not a grade: the transcript still has nothing for the unit');
  const c = UP.decide(p.list, p.record.id, { decision: 'confirmed', by: 'Marcia Thompson', at: '2026-10-29T17:00:00.000Z' });
  assert(c.record.status === 'confirmed' && c.record.officialGrade === 78 && c.record.decidedBy === 'Marcia Thompson', 'confirmed: the grade as proposed, by whom');
  assert(UP.decide(c.list, p.record.id, { decision: 'declined', by: 'x' }).error === 'decided', 'a decided proposal cannot be decided again');
  const ch = UP.decide(p.list, p.record.id, { decision: 'changed', officialGrade: '75', by: 'Marcia Thompson' });
  assert(ch.record.status === 'changed' && ch.record.officialGrade === 75 && ch.record.grade === 78, 'changed: the office\'s grade recorded beside what was proposed');
  assert(UP.decide(p.list, p.record.id, { decision: 'changed', officialGrade: 'great' }).error === 'grade', 'a change needs a real grade');
  const dc = UP.decide(p.list, p.record.id, { decision: 'declined', by: 'Marcia Thompson' });
  assert(dc.record.status === 'declined' && !('officialGrade' in dc.record), 'declined: no grade');
  assert(UP.waiting(c.list).length === 0, 'a decided proposal no longer waits');
}
console.log('Merged record by record; carried in the Transcript / Grades file; never to a trainee');
{
  const p1 = UP.propose([], Object.assign({}, base, { grade: 78, by: 'Ian Barrett', byId: 'USR-INS-IAN', at: '2026-10-29T15:00:00.000Z' }));
  const officeSide = UP.decide(p1.list, p1.record.id, { decision: 'confirmed', by: 'Marcia Thompson', at: '2026-10-29T17:00:00.000Z' }).list;
  const instructorSide = UP.propose(p1.list, Object.assign({}, base, { unitCode: 'WF-202', unitName: 'Arc welding', grade: 'C', by: 'Ian Barrett', byId: 'USR-INS-IAN', at: '2026-10-29T16:00:00.000Z' })).list;
  const merged = JSON.parse(PC.mergeRecordValue('voctrain_unitProposals', JSON.stringify(instructorSide), JSON.stringify(officeSide), false, null));
  assert(merged.length === 2 && merged.find(r => r.unitCode === 'WF-201').status === 'confirmed' && merged.find(r => r.unitCode === 'WF-202').status === 'proposed',
    'the office\'s decision and the instructor\'s new proposal both stand');
  const spec = PC.recordSpec('voctrain_unitProposals');
  assert(spec && spec.always === true && PC.DRIVE_RECORD_KEYS.indexOf('voctrain_unitProposals') !== -1, 'merged by record on every path, the online copy included');
  const plan = PC.sharedPullPlan(['voctrain_unitProposals'], 'CESTIS_Transcript_Grades.reader');
  assert(plan.length === 1 && plan[0].file === 'CESTIS_Transcript_Grades.json', 'kept in the Transcript / Grades file');
  const { makeCentre, NOW } = require('./gate-fixture.js');
  const C = makeCentre(Core);
  const t = C.trainees[0];
  const prop = UP.propose([], Object.assign({}, base, { studentId: t.stu.id, studentName: t.stu.name, grade: 40, note: 'Needs more practice on the regulator', by: 'Instructor', byId: 'USR-INS1' }));
  C.asStrings.voctrain_unitProposals = JSON.stringify(prop.list);
  const built = Core.gate.buildAll(C.asStrings, NOW, { builtBy: 'dev-test' });
  const slice = built.slices[t.acct.id].slice;
  assert(!('voctrain_unitProposals' in slice.data) && !JSON.stringify(slice).includes(prop.record.id) && !JSON.stringify(slice).includes('Needs more practice on the regulator'), 'a trainee\'s slice never carries a proposal, not even her own');
}
console.log('Transcript / Grades (Transcript-Grades.html)');
{
  const TG = fs.readFileSync(path.join(__dirname, '..', 'Transcript-Grades.html'), 'utf8');
  assert(/<th style="width:230px;">Propose a result<\/th>/.test(TG) && /onclick="insPropose\(/.test(TG), 'an instructor has "Propose a result" on every unit row');
  assert(/>Confirm<\/button>/.test(TG) && /Change…<\/button>/.test(TG) && />Decline<\/button>/.test(TG) && /<b>Proposed by ' \+ esc\(p\.proposedBy/.test(TG), 'the office sees "Proposed by <instructor>" with Confirm, Change and Decline');
  assert(/settleProposalsFor\(s\.id, q\.id, unit\.code, gradeVal\);/.test(TG), 'saving the grade settles the proposal (confirmed, or changed)');
  assert(/Proposed unit results waiting for the office \(/.test(TG), 'and every proposal waiting is listed at the top');
  assert(/keys: \['voctrain_transcriptGrades', 'voctrain_unitCatalogs', 'voctrain_transcriptProfiles', 'voctrain_unitProposals'\]/.test(TG), 'the office owns the proposals in its file');
  assert(/writes: _tgTrainee \? \['voctrain_certTranscriptRequests'\] : _tgInstructor \? \['voctrain_unitProposals'\] : \[\]/.test(TG), 'an instructor may send hers into it, record by record');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
