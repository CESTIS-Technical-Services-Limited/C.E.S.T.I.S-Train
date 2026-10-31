/* Sample papers for the prepared-assessment tests and the owner's sample
   PDFs: a marked Theory 1, a Theory 2 awaiting marking and a marked group
   Practical — from the real sample bank (assessments/welding-fabrication/
   memfab0042c.json). Every name here is made up. */
'use strict';

const path = require('path');
const Core = require('../../../cestis-core.js');
const A = Core.assessments, X = Core.exams;
const BANK = require('../../../assessments/welding-fabrication/memfab0042c.json');

const OFF = '-05:00';
const CENTRE = 'Community Educational and Skills Training Institute and Services Ltd.';
const QUAL = { id: 'QUAL-WEL-L2', title: 'WELDING LEVEL 2', code: 'MEM22423', skillArea: 'Welding & Fabrication', level: 2 };
const UNIT = BANK.unit;
const INTAKE = 'Sep 2026 – Jun 2027';
const PEOPLE = [
  { id: 'STU-3w8k2q', name: 'Kemar Johnson' }, { id: 'STU-3wfia7', name: 'Tameka Richards' },
  { id: 'STU-2kq9zt', name: 'Damion Lewis' }, { id: 'STU-9pd1cx', name: 'Nadine Bailey' }
];

function opened(kind, id) {
  const m = A.bankToExam(BANK, kind, { id: id + '-M', qual: QUAL, unit: UNIT, by: 'INS-1', byRole: 'instructor', at: '2026-10-20T14:00:00.000Z' });
  A.markReady(m, { id: 'INS-1', name: 'Ian Barrett', role: 'instructor' }, '2026-10-21T14:00:00.000Z');
  const o = A.openCopy(m, { id, course: '02. Welding & Fabrication', intake: INTAKE, centreId: '2', date: kind === 'practical1' ? '2026-10-27' : '2026-10-30',
    time: '09:00', closeDate: kind === 'practical1' ? '2026-10-31' : '2026-10-30', closeTime: kind === 'practical1' ? '16:00' : '17:00',
    by: 'INS-1', byRole: 'instructor', byName: 'Ian Barrett', at: '2026-10-22T14:00:00.000Z', offset: OFF });
  return { master: m, exam: o.exam };
}

/* Theory 1, marked: Kemar Johnson, 40 of 45, from home, invigilated online,
   15 minutes' extra time added by the Administrator. */
function theory1() {
  const { exam } = opened('theory1', 'EX-SAMPLE-T1');
  exam.status = 'completed';
  A.addGrant(exam, A.makeGrant({ id: 'XT-S1', studentId: PEOPLE[0].id, minutes: 15, reason: 'Power cut at home during the test', byId: 'USR-ad', byName: 'Marcia Thompson', byRole: 'admin', at: '2026-10-30T15:05:00.000Z' }).grant);
  const wrong = { 3: 1, 11: 1, 20: 1, 33: 1 };
  const answers = exam.questionData.map((q, i) => i === 44 ? null : wrong[i] ? (q.correctAnswer + 1) % 4 : q.correctAnswer);
  const m = X.mark(X.publicQuestions(exam.questionData), answers, exam.questionData);
  const sig = A.makeSignature({ name: PEOPLE[0].name, at: '2026-10-30T16:42:10.000Z', basis: 'ATT-SAMPLE-T1' });
  const result = { id: 'RES-G-sample0001', attemptId: 'ATT-SAMPLE-T1', examId: exam.id, studentId: PEOPLE[0].id, studentName: PEOPLE[0].name, answers: m.gradedResults,
    score: Math.round(m.earnedPoints / m.totalPoints * 100), correctCount: m.correctCount, totalQuestions: 45, totalPoints: m.totalPoints, earnedPoints: m.earnedPoints,
    passed: Math.round(m.earnedPoints / m.totalPoints * 100) >= 70, needsReview: false, reviewComplete: true, pendingCount: 0,
    startedAt: '2026-10-30T14:01:00.000Z', submittedAt: '2026-10-30T16:42:10.000Z', signature: sig };
  const path_ = A.folderPath({ programme: 'Welding & Fabrication', intake: INTAKE, unitCode: UNIT.code, unitTitle: UNIT.title, kind: 'theory1' });
  const model = A.theoryModel({ exam, result, questions: exam.questionData, student: PEOPLE[0], sat: { where: 'home', invigilated: true }, centreName: CENTRE, offset: OFF,
    madeAt: Date.parse('2026-10-30T16:43:00Z'), path: path_ });
  return { exam, result, model, path: path_, name: A.paperFileName({ name: PEOPLE[0].name, studentId: PEOPLE[0].id, unitCode: UNIT.code, kind: 'theory1' }) };
}

/* Theory 2, awaiting marking: Tameka Richards; some short answers match,
   the rest and every essay wait for the assessor. */
function theory2() {
  const { exam } = opened('theory2', 'EX-SAMPLE-T2');
  const say = {
    'T2-S01': 'Electrode', 'T2-S02': 'shielded metal arc welding', 'T2-S03': '60 degrees', 'T2-S04': 'chipping hammer', 'T2-S05': 'the ground clamp',
    'T2-S06': 'alternating current', 'T2-S07': 'direct current electrode positive', 'T2-S08': '2F', 'T2-S09': 'Porosity', 'T2-S10': 'shade 10 or 11',
    'T2-S11': 'fillet gauge', 'T2-S12': 'slag', 'T2-S13': 'Personal protective equipment', 'T2-S14': 'root face', 'T2-S15': 'tack welds',
    'T2-E01': 'A welding helmet with the right shade protects the eyes and face from the light of the arc and from spatter. Leather gloves protect the hands from heat and shock. A long-sleeved cotton jacket protects the arms from burns and sparks, and safety boots protect the feet.',
    'T2-E02': 'Bevel each edge to 30° so the V is 60°, leave a 2 mm root face and a 3 mm gap, and clean back 25 mm of mill scale. Tack both ends.',
    'T2-E03': 'If the arc is too long you get spatter and holes. Too much amps gives undercut. Going too fast gives a thin bead.',
    'T2-E04': 'Scratch the rod like a match, lift it up a little, keep it steady. To restart clean the slag off and start in front of the crater then go back.',
    'T2-E05': 'Tack the tee square. Root pass at 45 degrees. Clean. Second pass on the bottom plate, third on top.',
    'T2-E06': 'Porosity from wet rods, keep them dry. Slag inclusion from not cleaning, clean every pass. Undercut from too much current, turn it down. Lack of fusion from going too fast.',
    'T2-E07': 'The flux takes in water from the air. E7018 must go in the rod oven after the box is opened.',
    'T2-E08': 'Check the cables for cuts, check the holder, check the clamp is tight and the machine is earthed.',
    'T2-E09': 'The metal expands and shrinks. Clamp it, tack it and weld in a balanced sequence.',
    'T2-E10': 'Clean the slag, use the fillet gauge for the legs, look for undercut, holes and cracks.'
  };
  // A copy's questions carry new ids: the bank's order is kept (15 short answers, then 10 essays).
  let ns = 0, ne = 0;
  const answers = exam.questionData.map(q => q.type === 'info' ? null : q.type === 'shortanswer' ? say['T2-S' + String(++ns).padStart(2, '0')] : say['T2-E' + String(++ne).padStart(2, '0')]);
  const m = X.mark(X.publicQuestions(exam.questionData), answers, exam.questionData);
  const sig = A.makeSignature({ name: PEOPLE[1].name, at: '2026-10-30T17:31:00.000Z', basis: 'ATT-SAMPLE-T2' });
  const result = { id: 'RES-G-sample0002', attemptId: 'ATT-SAMPLE-T2', examId: exam.id, studentId: PEOPLE[1].id, studentName: PEOPLE[1].name, answers: m.gradedResults,
    score: Math.round(m.earnedPoints / m.totalPoints * 100), correctCount: m.correctCount, totalQuestions: 25, totalPoints: m.totalPoints, earnedPoints: m.earnedPoints,
    passed: false, needsReview: true, reviewComplete: false, pendingCount: m.manualCount,
    startedAt: '2026-10-30T14:00:00.000Z', submittedAt: '2026-10-30T17:31:00.000Z', signature: sig };
  const path_ = A.folderPath({ programme: 'Welding & Fabrication', intake: INTAKE, unitCode: UNIT.code, unitTitle: UNIT.title, kind: 'theory2' });
  const model = A.theoryModel({ exam, result, questions: exam.questionData, student: PEOPLE[1], sat: { where: 'home', invigilated: false }, centreName: CENTRE, offset: OFF,
    madeAt: Date.parse('2026-10-30T17:32:00Z'), path: path_ });
  return { exam, result, model, path: path_, name: A.paperFileName({ name: PEOPLE[1].name, studentId: PEOPLE[1].id, unitCode: UNIT.code, kind: 'theory2' }) };
}

/* Practical 1, Group B, marked: four members, seven photos. */
const CAPTIONS = ['Station set up, every member in PPE', 'Plates cleaned and tacked square', 'Root pass, cleaned', 'Finished weld — top view', 'Finished weld — end view, both legs', 'Fillet gauge on the finished weld', 'Work area cleaned, stubs in the bin'];
function practical() {
  const { exam } = opened('practical1', 'EX-SAMPLE-P1');
  const group = A.makeGroup({ id: 'AG-SAMPLE-B', examId: exam.id, name: 'Group B', members: PEOPLE.map(p => p.id), by: 'INS-1', byName: 'Ian Barrett', at: '2026-10-27T13:00:00.000Z' });
  const work = [group];
  const who = [0, 0, 1, 0, 1, 2, 3];
  CAPTIONS.forEach((c, i) => work.push(A.photoRecord({ id: 'PH-S' + (i + 1), examId: exam.id, groupId: group.id, studentId: PEOPLE[who[i]].id, caption: c,
    at: new Date(Date.parse('2026-10-29T18:00:00.000Z') + i * 6 * 60000).toISOString(), files: [{ id: 'FILE-S' + (i + 1), name: 'photo' + (i + 1) + '.jpg', size: 400000, type: 'image/jpeg' }] })));
  const signAt = '2026-10-29T19:15:00.000Z';
  [0, 1, 2].forEach((k, n) => work.push(A.signoffRecord({ groupId: group.id, examId: exam.id, studentId: PEOPLE[k].id, name: PEOPLE[k].name,
    signature: A.makeSignature({ name: PEOPLE[k].name, at: new Date(Date.parse(signAt) + n * 3600000).toISOString(), basis: group.id + '|' + PEOPLE[k].id }), handIn: k === 0,
    at: new Date(Date.parse(signAt) + n * 3600000).toISOString() })));
  const checks = exam.practical.checklist;
  const res = (k, outcome, notMet, comment) => A.practicalResult({ examId: exam.id, groupId: group.id, studentId: PEOPLE[k].id, outcome,
    checklist: checks.map((t, i) => ({ text: t, met: notMet.indexOf(i) === -1 })), comment, by: { id: 'INS-1', name: 'Ian Barrett', role: 'instructor' }, at: '2026-10-30T15:00:00.000Z' }).rec;
  work.push(res(0, 'competent', [], 'Suggestion is correct. Steady arc and equal legs.'), res(1, 'competent', [7], 'Good welding; leave the area tidy next time.'),
    res(2, 'competent', [], 'Suggestion is correct.'), res(3, 'nyc', [4, 6], 'Root pass not shown; undercut on the vertical plate. Repeat the root pass with a shorter arc.'));
  const students = {};
  PEOPLE.forEach(p => { students[p.id] = p; });
  const path_ = A.folderPath({ programme: 'Welding & Fabrication', intake: INTAKE, unitCode: UNIT.code, unitTitle: UNIT.title, kind: 'practical1', groupName: 'Group B' });
  const model = A.practicalModel({ exam, group, work, students, centreName: CENTRE, offset: OFF, madeAt: Date.parse('2026-10-30T15:05:00Z'), path: path_ });
  return { exam, group, work, students, model, path: path_, name: A.groupFileName({ groupName: 'Group B', unitCode: UNIT.code, kind: 'practical1' }) };
}

module.exports = { OFF, CENTRE, QUAL, UNIT, INTAKE, PEOPLE, BANK, CAPTIONS, opened, theory1, theory2, practical };
