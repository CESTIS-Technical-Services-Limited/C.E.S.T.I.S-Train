/* Prepared assessments: the rules (CESTISCore.assessments, and what they
   change in CESTISCore.exams and CESTISCore.sync).
   Run: node tests/assessments-core.test.js

   The owner's decisions (31 October 2026), pinned here:
   - every unit gets Theory 1 (45 multiple choice, 2 h 30 min), Theory 2
     (10 essays + 15 short answers, 3 h 35 min; a short answer that matches
     is marked at once, any other waits for marking), Practical 1 and 2
     (groups of 4 or 5);
   - a prepared test is a draft until an instructor marks it Ready and opens
     it for an intake; a draft never opens;
   - extra time for one trainee or the whole sitting: who, how much and why
     kept; never lost when two people add time at once; the trainee's clock
     and the gate's "late" use it; the PDF says it;
   - the trainee signs (a script signature with an id, as DocuSign does);
   - group members see each other as "Tameka R.", never an ID, a full name
     or anyone's result;
   - an assessor's result per member; the record's filing path and file
     names; the PDF's data. */
'use strict';

const crypto = require('crypto');
const Core = require('../cestis-core.js');
const A = Core.assessments, X = Core.exams;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
const OFF = '-05:00';

/* A bank of the right shape, made up for these tests (the real sample is
   tests/assessments-bank.test.js). */
function makeBank(over) {
  const mcq = [];
  for (let i = 1; i <= 45; i++) mcq.push({ id: 'T1-' + String(i).padStart(2, '0'), topic: 'Safety', stem: 'Question ' + i + '?', options: ['Alpha ' + i, 'Bravo ' + i, 'Charlie ' + i, 'Delta ' + i], answer: i % 4 });
  const sa = [];
  for (let i = 1; i <= 15; i++) sa.push({ id: 'T2-S' + String(i).padStart(2, '0'), topic: 'Terms', stem: 'Name item ' + i + '.', accepted: ['answer ' + i, 'reply ' + i], marks: 2 });
  const es = [];
  for (let i = 1; i <= 10; i++) es.push({ id: 'T2-E' + String(i).padStart(2, '0'), topic: 'Method', stem: 'Explain step ' + i + '.', modelAnswer: 'Model ' + i, markingPoints: ['Point a' + i, 'Point b' + i], marks: 5 });
  const prac = k => ({ title: 'Task ' + k, brief: 'Do task ' + k, time: '3 hours', materials: ['Plate'], photos: ['Set up', 'Root pass', 'Finished'], checklist: ['Prepared', 'Welded', 'Cleaned'], safety: ['Wear PPE'] });
  return Object.assign({ format: 'cestis-assessment-bank', version: 1, programme: 'Welding & Fabrication', qualification: { id: 'QUAL-WEL-L2', title: 'WELDING LEVEL 2', code: 'MEM22423' }, level: 2,
    unit: { code: 'MEMFAB0042C', title: 'Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)' }, written: '2026-10-31',
    theory1: { minutes: 150, passMark: 70, questions: mcq }, theory2: { minutes: 215, passMark: 70, shortAnswers: sa, essays: es },
    practical1: prac(1), practical2: prac(2) }, over || {});
}
const QUAL = { id: 'QUAL-WEL-L2', title: 'WELDING LEVEL 2', code: 'MEM22423', skillArea: 'Welding & Fabrication', level: 2 };
const UNIT = { code: 'MEMFAB0042C', title: 'Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)' };

console.log('The four assessments, and what a bank must hold');
{
  const bank = makeBank();
  const chk = A.checkBank(bank);
  assert(chk.ok && chk.counts.mcq === 45 && chk.counts.shortAnswers === 15 && chk.counts.essays === 10, 'a whole bank passes (' + chk.problems.join('; ') + ')');
  const bad = makeBank();
  bad.theory1.questions = bad.theory1.questions.slice(0, 44);
  bad.theory1.questions[3].answer = 4;
  bad.theory1.questions[4].options = ['A', 'A', 'B', 'C'];
  bad.theory2.essays[0].markingPoints = ['only one'];
  bad.theory2.shortAnswers[0].accepted = [''];
  bad.practical1.checklist = ['one'];
  bad.theory1.questions[5].id = bad.theory1.questions[6].id;
  const c2 = A.checkBank(bad);
  const t = c2.problems.join(' | ');
  assert(!c2.ok, 'a bank with mistakes does not pass');
  assert(/must have 45 questions \(it has 44\)/.test(t), 'too few questions is named');
  assert(/question 4: answer must be/.test(t), 'a key outside the four options is named');
  assert(/question 5: two options say the same/.test(t), 'two options the same is named');
  assert(/essay 1: it needs at least 2 marking points/.test(t), 'an essay with one marking point is named');
  assert(/short answer 1: it needs at least one accepted answer/.test(t), 'a short answer with no accepted answer is named');
  assert(/practical1: it needs at least 3/.test(t), 'a practical with too few checks is named');
  assert(/used twice/.test(t), 'an id used twice is named');
  assert(!A.checkBank(null).ok && !A.checkBank(Object.assign(makeBank(), { format: 'x' })).ok, 'not a bank, or another format, does not pass');

  const t1 = A.bankToExam(bank, 'theory1', { id: 'EX-T1', qual: QUAL, unit: UNIT, by: 'INS-1', byRole: 'instructor', at: '2026-10-31T12:00:00.000Z' });
  assert(t1.status === 'draft' && t1.date === '' && t1.duration === 150 && t1.passMark === 65, 'Theory 1: a draft, no date, 150 minutes, pass mark 65% (the bank says 70: the Centre\'s 65% applies)');
  assert(t1.questionData.length === 45 && t1.questionData.every(q => q.type === 'mcq' && q.options.length === 4 && q.points === 1) && X.questionCount(t1) === 45, 'Theory 1: 45 multiple choice, 1 mark each');
  assert(t1.questionData[3].correctAnswer === bank.theory1.questions[3].answer && t1.questionData[0].id === 'Q-EX-T1-T1-01', 'each key kept, each question with a stable id');
  assert(t1.title === 'Welding & Fabrication — MEMFAB0042C ' + UNIT.title + ' — Theory 1', 'named after the programme and the unit, as the Centre names them (' + t1.title + ')');
  assert(t1.assessment.kind === 'theory1' && t1.assessment.master === true && t1.assessment.ready === false && t1.assessment.unitCode === 'MEMFAB0042C' && t1.assessment.qualId === 'QUAL-WEL-L2', 'the assessment says what it is, and starts To check');
  assert(X.keyProblems(t1.questionData).length === 0, 'the builder finds every key usable');

  const t2 = A.bankToExam(bank, 'theory2', { id: 'EX-T2', qual: QUAL, unit: UNIT });
  const qs2 = t2.questionData.filter(q => q.type !== 'info');
  assert(t2.duration === 215 && qs2.length === 25 && X.questionCount(t2) === 25, 'Theory 2: 215 minutes, 25 questions');
  assert(qs2.filter(q => q.type === 'shortanswer').length === 15 && qs2.filter(q => q.type === 'essay').length === 10, '15 short answers and 10 essays');
  assert(qs2.filter(q => q.type === 'shortanswer').every(q => q.manualIfNoMatch === true && q.correctAnswer.length === 2 && q.points === 2), 'short answers: two accepted answers, 2 marks, and they wait for marking when they do not match');
  assert(qs2.filter(q => q.type === 'essay').every(q => q.modelAnswer && q.markingPoints.length === 2 && q.points === 5), 'essays carry the model answer and the marking points for the marker');
  assert(t2.questionData[0].type === 'info' && /Section A/.test(t2.questionData[0].text) && t2.questionData.filter(q => q.type === 'info').length === 2, 'two sections, each introduced');
  assert(X.keyProblems(t2.questionData).length === 0, 'every Theory 2 key usable');

  const p1 = A.bankToExam(bank, 'practical1', { id: 'EX-P1', qual: QUAL, unit: UNIT });
  assert(A.isPractical(p1) && p1.questionData.length === 0 && p1.practical.photos.length === 3 && p1.practical.checklist.length === 3 && p1.practical.safety[0] === 'Wear PPE', 'a practical: no questions, its brief, photos to take, checks and safety');
  assert(A.isTheory(t1) && !A.isPractical(t1) && A.kindOf(p1) === 'practical1' && A.kindOf({}) === null, 'kinds are told apart');
}

console.log('A draft never opens; the marker\'s notes never reach a trainee');
{
  const bank = makeBank();
  const t1 = A.bankToExam(bank, 'theory1', { id: 'EX-D', qual: QUAL, unit: UNIT });
  t1.date = '2026-10-01'; t1.time = '09:00';
  const now = Date.parse('2026-10-01T15:00:00Z');
  assert(X.statusAt(t1, now, OFF) === 'upcoming', 'a draft with questions and a past date stays closed');
  t1.status = 'upcoming';
  assert(X.statusAt(t1, now, OFF) === 'active', 'the same test, opened, is open in its window');
  const t2 = A.bankToExam(bank, 'theory2', { id: 'EX-D2', qual: QUAL, unit: UNIT });
  const pub = X.publicQuestions(t2.questionData);
  assert(pub.every(q => q.modelAnswer === undefined && q.markingPoints === undefined && q.correctAnswer === undefined), 'a trainee\'s copy has no model answer, marking points or key');
  const fromPaper = X.attemptQuestionsFromPaper(t2.questionData, {});
  assert(fromPaper.every(q => q.modelAnswer === undefined && q.markingPoints === undefined), 'a paper copy drops them too even if a paper carried them');
  assert(Core.gate.KEY_NAMES.modelAnswer === 1 && Core.gate.KEY_NAMES.markingPoints === 1, 'the gate\'s privacy sweep knows them as answer-giving');
}

console.log('Theory 2: a short answer that matches is marked; any other waits for marking');
{
  const keyed = [
    { id: 'S1', type: 'shortanswer', text: 'Gas?', points: 2, correctAnswer: ['argon', 'Ar'], manualIfNoMatch: true },
    { id: 'S2', type: 'shortanswer', text: 'Gas?', points: 2, correctAnswer: ['argon'] },
    { id: 'E1', type: 'essay', text: 'Explain', points: 5 }
  ];
  const m = X.mark(X.publicQuestions(keyed), ['  ARGON ', 'helium', 'Because…'], keyed);
  assert(m.gradedResults[0].isCorrect === true && m.gradedResults[0].earnedPoints === 2 && !m.gradedResults[0].needsManualGrade, 'a matching answer is marked at once (case and spaces aside)');
  const m2 = X.mark(X.publicQuestions(keyed), ['inert gas', 'helium', ''], keyed);
  assert(m2.gradedResults[0].needsManualGrade === true && m2.gradedResults[0].graded === false, 'a different answer waits for the assessor');
  assert(m2.gradedResults[1].needsManualGrade === false && m2.gradedResults[1].earnedPoints === 0, 'a short answer without that rule is still marked wrong at once (unchanged)');
  assert(m2.manualCount === 2 && m2.gradedResults[2].needsManualGrade, 'the essay waits too');
}

console.log('Extra time: one trainee or the whole sitting, kept by everyone');
{
  const ex = { id: 'EX-XT', title: 'T1', course: 'W', date: '2026-11-02', time: '09:00', duration: 150, status: 'upcoming', questionData: [{ id: 'q', type: 'mcq', options: ['a', 'b'], correctAnswer: 0, points: 1 }] };
  const start = X.centreTime('2026-11-02', '09:00', OFF);
  assert(X.windowOf(ex, OFF).end === start + 150 * 60000 && X.windowOf(ex, OFF).baseEnd === undefined, 'no extra time: the window as before');
  assert(A.mayAddTime('admin') && A.mayAddTime('adminstaff', { exams: true }) && !A.mayAddTime('adminstaff', { exams: false }) && !A.mayAddTime('instructor') && !A.mayAddTime('student'),
    'the Administrator, and Admin Staff with Online Exams ticked — not instructors, not trainees');
  const g1 = A.makeGrant({ id: 'XT-1', studentId: 'STU-a', minutes: 15, reason: 'Power cut at home', byId: 'USR-ad', byName: 'Marcia Thompson', byRole: 'admin', at: '2026-11-02T14:30:00.000Z' });
  const g2 = A.makeGrant({ id: 'XT-2', studentId: '', minutes: 10, reason: 'Late start for everyone', byId: 'USR-as', byName: 'Ann Clarke', byRole: 'adminstaff', at: '2026-11-02T14:00:00.000Z' });
  assert(g1.grant && g2.grant && g1.grant.byName === 'Marcia Thompson' && g1.grant.reason === 'Power cut at home', 'who, how much and why are kept');
  assert(A.makeGrant({ minutes: 0, reason: 'x', byRole: 'admin', byName: 'M' }).error === 'minutes' && A.makeGrant({ minutes: 500, reason: 'x', byRole: 'admin', byName: 'M' }).error === 'minutes' &&
    A.makeGrant({ minutes: 1.5, reason: 'x', byRole: 'admin', byName: 'M' }).error === 'minutes', 'minutes: a whole number from 1 to 240');
  assert(A.makeGrant({ minutes: 5, reason: '  ', byRole: 'admin', byName: 'M' }).error === 'reason' && A.makeGrant({ minutes: 5, reason: '<b>x</b>', byRole: 'admin', byName: 'M' }).error === 'reason', 'a reason is needed, as plain words');
  A.addGrant(ex, g1.grant); A.addGrant(ex, g2.grant); A.addGrant(ex, g1.grant);
  assert(ex.extraTime.length === 2, 'a grant added twice is kept once');
  assert(X.extraMinutesFor(ex, 'STU-a') === 25 && X.extraMinutesFor(ex, 'STU-b') === 10, 'hers and the whole sitting\'s add up; everyone else gets the sitting\'s');
  const w = X.windowOf(ex, OFF);
  assert(w.baseEnd === start + 150 * 60000 && w.end === w.baseEnd + 25 * 60000, 'the sitting stays open for the longest extra time');
  assert(X.statusAt(ex, w.baseEnd + 20 * 60000, OFF) === 'active' && X.statusAt(ex, w.end + 1, OFF) === 'completed', 'the test is still open while she sits her extra minutes');
  const base = X.sessionDeadline(ex, start, OFF);
  assert(base === start + 150 * 60000, 'an attempt\'s own deadline never includes extra time (it only ever moves earlier when copies merge)');
  assert(X.deadlineWithExtra(ex, base, 'STU-a') === base + 25 * 60000 && X.deadlineWithExtra(ex, base, 'STU-b') === base + 10 * 60000, 'her clock: her deadline plus her extra time');
  const late = X.sessionDeadline(ex, start + 60 * 60000, OFF);
  assert(late === start + 150 * 60000, 'a late starter still stops at the closing time (not the longer window)');
  const mine = A.grantsForTrainee(ex, 'STU-b');
  assert(mine.length === 1 && mine[0].scope === 'all' && JSON.stringify(mine).indexOf('STU-a') === -1 && JSON.stringify(mine).indexOf('Marcia') === -1, 'a trainee is told only of hers and the sitting\'s — never another trainee\'s');
  assert(A.grantsForTrainee(ex, 'STU-a').some(g => g.scope === 'you' && g.minutes === 15), 'hers says it is hers');
  assert(A.minutesText(15) === '15 min' && A.minutesText(60) === '1 h' && A.minutesText(75) === '1 h 15 min', 'minutes said plainly');
  assert(A.extraLine({ minutes: 15, byRole: 'admin', studentId: 'x' }) === 'Extra time: 15 min, added by the Administrator', 'the PDF\'s words, as the owner wrote them');
  ex.extraTime.push({ id: 'XT-bad', studentId: '', minutes: 9999 }, { id: 'XT-neg', studentId: '', minutes: -5 }, null);
  assert(X.extraMinutesFor(ex, 'STU-b') === 10, 'a malformed grant counts for nothing');

  // Two people add time on two computers: both grants stand, on every path.
  const base2 = { id: 'EX-M', title: 'T', course: 'W', updatedAt: '2026-10-29T14:00:00.000Z' };
  const pcA = Object.assign({}, base2, { extraTime: [g1.grant], updatedAt: '2026-10-29T14:30:00.000Z' });
  const pcB = Object.assign({}, base2, { extraTime: [g2.grant], updatedAt: '2026-10-29T14:31:00.000Z' });
  const local = [JSON.parse(JSON.stringify(pcA))];
  Core.sync.mergeList(local, [pcB], X.syncKey, Core.sync.mapRules('exams', {}));
  assert(local[0].extraTime.length === 2 && local[0].updatedAt === pcB.updatedAt, 'the online merge keeps both grants (the newer copy wins the rest)');
  const lan = Core.pageCloud.mergeRecordValue ? Core.pageCloud.mergeRecordValue('voctrain_exams', JSON.stringify([pcB]), JSON.stringify([pcA])) : null;
  assert(lan && JSON.parse(lan)[0].extraTime.length === 2, 'the Centre network\'s merge keeps both grants');
}

console.log('The gate marks a late submission by her own extra time');
{
  const cryptoFns = { sha256Hex: s => crypto.createHash('sha256').update(String(s)).digest('hex') };
  const exam = { id: 'EX-G', title: 'T', course: 'W', date: '2026-11-02', time: '09:00', duration: 60, passMark: 50, status: 'active',
    questionData: [{ id: 'q1', type: 'mcq', text: '?', options: ['a', 'b'], correctAnswer: 0, points: 1 }],
    extraTime: [{ id: 'XT-9', studentId: 'STU-x', minutes: 30, reason: 'r', byRole: 'admin', byName: 'M', at: 'z' }] };
  const key = Core.gate.buildKey(exam, OFF);
  const start = X.centreTime('2026-11-02', '09:00', OFF);
  const att = s => ({ id: 'ATT-' + s, examId: 'EX-G', studentId: s, status: 'open', startTime: start, deadline: start + 3600000, questions: [{ id: 'q1', type: 'mcq', options: ['a', 'b'] }], answers: [0] });
  const at = start + 80 * 60000;
  const mx = Core.gate.markAttempt(att('STU-x'), key, at, { crypto: cryptoFns, receivedAt: at, firstSeen: start });
  const my = Core.gate.markAttempt(att('STU-y'), key, at, { crypto: cryptoFns, receivedAt: at, firstSeen: start });
  assert(mx.result && !mx.result.late, 'within her 30 extra minutes: not late');
  assert(my.result && my.result.late === true, 'another trainee at the same moment, with no extra time: late');
}

console.log('The trainee\'s signature');
{
  const s = A.makeSignature({ name: '  Kemar   Johnson ', at: '2026-10-30T15:42:00.000Z', basis: 'ATT-1' });
  assert(s && s.name === 'Kemar Johnson' && s.consent === true && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(s.id), 'her full name, consent, and a short id');
  assert(A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-30T15:42:00.000Z', basis: 'ATT-1' }).id === s.id, 'the same id on every device');
  assert(A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-30T15:42:00.000Z', basis: 'ATT-2' }).id !== s.id, 'another attempt, another id');
  assert(A.makeSignature({ name: '', at: '2026-10-30T15:42:00.000Z' }) === null && A.makeSignature({ name: '<i>x</i>', at: '2026-10-30T15:42:00.000Z' }) === null && A.makeSignature({ name: 'K', at: 'nope' }) === null, 'no name, markup or no time: not a signature');
  const c = A.cleanSignature(Object.assign({}, s, { name: 'Somebody Else' }), { name: 'Kemar Johnson', basis: 'ATT-1' });
  assert(c && c.name === 'Kemar Johnson' && c.id === s.id, 'kept in her official name — a trainee cannot sign as anyone else');
  assert(A.cleanSignature(Object.assign({}, s, { consent: false }), {}) === null, 'without "this is my own work" ticked: not kept');
  assert(A.signedLine(s, OFF) === 'Electronically signed by Kemar Johnson · 30 Oct 2026, 10:42 · Signature ID ' + s.id, 'the line under her signature, in the manner of DocuSign (' + A.signedLine(s, OFF) + ')');
}

console.log('Groups of 4 or 5, made from the register and edited by the instructor');
{
  const roll = n => Array.from({ length: n }, (_, i) => ({ id: 'STU-' + i, name: 'Trainee ' + String.fromCharCode(90 - i) + ' Surname' }));
  [4, 5, 8, 9, 10, 12, 13, 14, 15, 16, 20, 23, 24, 25, 30].forEach(n => {
    const s = A.splitGroups(roll(n));
    const sizes = s.groups.map(g => g.length);
    assert(sizes.every(x => x >= 4 && x <= 5) && sizes.reduce((a, b) => a + b, 0) === n && !s.note, n + ' trainees: every group 4 or 5 (' + sizes.join(',') + ')');
  });
  [3, 6, 7, 11].forEach(n => {
    const s = A.splitGroups(roll(n));
    assert(s.groups.every(g => g.length <= 5) && s.groups.reduce((a, g) => a + g.length, 0) === n && /move someone/.test(s.note), n + ' trainees cannot be cut into 4s and 5s: said so (' + s.note + ')');
  });
  const s = A.splitGroups([{ id: 'b', name: 'Zed Z' }, { id: 'a', name: 'Amy A' }, { id: 'a', name: 'Amy A' }, { id: 'c', name: 'Bob B' }, { id: 'd', name: 'Cal C' }]);
  assert(JSON.stringify(s.groups) === JSON.stringify([['a', 'c', 'd', 'b']]), 'in name order, each person once');
  assert(A.splitGroups([]).groups.length === 0, 'nobody: no groups');
  assert(A.groupName(0) === 'Group A' && A.groupName(1) === 'Group B' && A.groupName(26) === 'Group AA', 'Group A, B, … AA');
  const probs = A.groupProblems([{ name: 'Group A', members: ['1', '2', '3', '4'] }, { name: 'Group B', members: ['4', '5', '6'] }, { name: 'Group C', members: [] }], ['1', '2', '3', '4', '5', '6', '7']);
  const kinds = probs.map(p => p.kind).sort().join(',');
  assert(kinds === 'empty,missing,size,twice', 'in two groups, in none, the wrong size, empty — each named (' + kinds + ')');
  assert(A.memberShort('Tameka  Richards') === 'Tameka R.' && A.memberShort('Cher') === 'Cher' && A.initials('Damion Lewis') === 'DL', '"Tameka R." and "DL"');
}

console.log('A group hands in once; every member signs; nobody sees another\'s ID or result');
{
  const names = { 'STU-k': 'Kemar Johnson', 'STU-t': 'Tameka Richards', 'STU-d': 'Damion Lewis', 'STU-n': 'Nadine Bailey' };
  const group = A.makeGroup({ id: 'AG-1', examId: 'EX-P', name: 'Group B', members: ['STU-k', 'STU-t', 'STU-d', 'STU-n', 'STU-k'], by: 'INS', at: '2026-10-28T10:00:00.000Z' });
  assert(group.members.length === 4 && group.type === 'group', 'a group record, each member once');
  const work = [group];
  const ph = (id, who, at, cap) => A.photoRecord({ id, examId: 'EX-P', groupId: 'AG-1', studentId: who, accountId: 'USR-' + who, caption: cap, at, files: [{ id: 'F-' + id, name: id + '.jpg', size: 400000, type: 'image/jpeg' }] });
  work.push(ph('P1', 'STU-k', '2026-10-29T18:00:00.000Z', 'Set up'), ph('P2', 'STU-t', '2026-10-29T18:05:00.000Z', 'Root <pass>'), ph('P3', 'STU-k', '2026-10-29T18:09:00.000Z', 'Top view'));
  assert(work[2].caption === 'Root pass', 'markup taken out of a caption');
  const sigK = A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-29T19:15:00.000Z', basis: 'AG-1|STU-k' });
  const offK = A.signoffRecord({ groupId: 'AG-1', examId: 'EX-P', studentId: 'STU-k', accountId: 'USR-k', name: 'Kemar Johnson', signature: sigK, handIn: true, at: '2026-10-29T19:15:00.000Z' });
  assert(offK && offK.id === 'AS-AG-1-STU-k' && offK.handIn && offK.handInAt === '2026-10-29T19:15:00.000Z' && offK.signature.id === sigK.id, 'the member who hands in signs then');
  work.push(offK);
  // A second hand-in on another phone a moment later: the first stands.
  const sigT = A.makeSignature({ name: 'Tameka Richards', at: '2026-10-29T19:16:00.000Z', basis: 'AG-1|STU-t' });
  work.push(A.signoffRecord({ groupId: 'AG-1', examId: 'EX-P', studentId: 'STU-t', accountId: 'USR-t', name: 'Tameka Richards', signature: sigT, handIn: true, at: '2026-10-29T19:16:00.000Z' }));
  work.push(ph('P4', 'STU-d', '2026-10-29T20:00:00.000Z', 'Side view'));
  const st = A.groupState(group, work);
  assert(st.handedIn.by === 'STU-k' && st.handedIn.at === '2026-10-29T19:15:00.000Z', 'handed in once for all — the first hand-in');
  assert(st.photos.length === 4 && st.photos[0].id === 'P1' && st.late.join() === 'P4', 'every photo, oldest first; one added after the hand-in is marked');
  assert(Object.keys(st.signed).sort().join() === 'STU-k,STU-t' && st.unsigned.sort().join() === 'STU-d,STU-n', 'who has signed, who has not yet');
  assert(A.signoffRecord({ groupId: 'AG-1', studentId: 'STU-d', signature: null }) === null, 'no signature, no sign-off');
  // A record from someone not in the group changes nothing.
  work.push(A.signoffRecord({ groupId: 'AG-1', examId: 'EX-P', studentId: 'STU-zz', name: 'Out Sider', signature: A.makeSignature({ name: 'Out Sider', at: '2026-10-29T19:00:00.000Z' }), handIn: true, at: '2026-10-29T19:00:00.000Z' }));
  assert(A.groupState(group, work).handedIn.by === 'STU-k', 'a hand-in by somebody outside the group counts for nothing');
  // A result for Tameka, a comment that names her.
  work.push(A.practicalResult({ examId: 'EX-P', groupId: 'AG-1', studentId: 'STU-t', outcome: 'nyc', checklist: [{ text: 'Prepared', met: true }], comment: 'Root pass not shown', by: { id: 'INS', name: 'Ian Barrett', role: 'instructor' }, at: '2026-10-30T10:00:00.000Z' }).rec);
  const view = A.traineeView(group, work, 'STU-d', names);
  const vj = JSON.stringify(view);
  assert(view.members.map(m => m.n).join() === 'Kemar J.,Tameka R.,Damion Lewis,Nadine B.' && view.members[2].me, 'she sees her group as "Kemar J., Tameka R." and herself by name');
  assert(['STU-k', 'STU-t', 'STU-n', 'Kemar Johnson', 'Tameka Richards', 'Nadine Bailey', 'Root pass not shown', 'nyc'].every(x => vj.indexOf(x) === -1), 'never another member\'s ID, full name, result or comment');
  assert(view.photos.length === 4 && view.photos[3].mine && view.photos[0].by === 'Kemar J.' && view.photos[3].late, 'the group\'s photos, who added them, hers marked');
  assert(view.handedInBy === 'Kemar J.' && view.handedInAt && view.mySignature === null && view.signedCount === 2 && view.total === 4, 'handed in by Kemar J.; she has not signed yet (2 of 4)');
  assert(A.traineeView(group, work, 'STU-zz', names) === null, 'somebody outside the group gets nothing');
  assert(A.groupOf(work, 'EX-P', 'STU-n').id === 'AG-1' && A.groupOf(work, 'EX-P', 'STU-zz') === null, 'her group is found');
}

console.log('The assessor records a result for each member');
{
  const group = A.makeGroup({ id: 'AG-2', examId: 'EX-Q', name: 'Group A', members: ['S1', 'S2'], at: '2026-10-28T10:00:00.000Z' });
  const work = [group];
  assert(A.practicalResult({ outcome: 'maybe' }).error === 'outcome' && A.practicalResult({ outcome: 'competent', comment: '<script>' }).error === 'comment', 'an outcome is Competent or Not yet competent; a comment is plain words');
  const r1 = A.practicalResult({ examId: 'EX-Q', groupId: 'AG-2', studentId: 'S1', outcome: 'competent', checklist: [{ text: 'Prepared', met: true }, { text: '', met: true }], comment: 'Steady arc and equal legs', by: { id: 'I', name: 'Ian Barrett', role: 'instructor' }, at: '2026-10-30T10:00:00.000Z' }).rec;
  assert(r1.id === 'APR-EX-Q-S1' && r1.checklist.length === 1 && r1.assessorName === 'Ian Barrett' && r1.comment === 'Steady arc and equal legs', 'one result per member, with what was checked and the comment');
  work.push(r1);
  assert(A.practicalPaperStatus(group, work) === 'provisional', 'one member still to mark: provisional');
  work.push(A.practicalResult({ examId: 'EX-Q', groupId: 'AG-2', studentId: 'S2', outcome: 'nyc', comment: 'Root pass not shown', by: { name: 'Ian' }, at: '2026-10-30T10:01:00.000Z' }).rec);
  assert(A.practicalPaperStatus(group, work) === 'final', 'every member marked: final');
  work.push(Object.assign({}, work[2], { outcome: 'competent', updatedAt: '2026-10-30T11:00:00.000Z' }));
  assert(A.memberResult(work, 'EX-Q', 'S2').outcome === 'competent', 'a later edit of a result wins');
}

console.log('Which prepared bank answers to which of the Centre\'s units');
{
  const index = { banks: [
    { file: 'welding-fabrication/memfab0042c.json', programme: 'Welding & Fabrication', qualId: 'QUAL-WEL-L2', qualCode: 'MEM22423', level: 2, unitCode: 'MEMFAB0042C', unitTitle: UNIT.title },
    { file: 'x/other.json', programme: 'Electrical Installation', level: 2, unitCode: 'EEMXXX', unitTitle: 'Install lighting circuits' }
  ] };
  assert(A.matchBank(index, QUAL, UNIT).file === 'welding-fabrication/memfab0042c.json', 'by programme and unit code');
  assert(A.matchBank(index, QUAL, { code: 'memfab 0042c', title: 'anything' }), 'the code written another way still matches');
  assert(A.matchBank(index, QUAL, { code: '', title: 'PERFORM WELD in the flat & horizontal positions using manual metal arc welding process (MMAW)' }), 'no code: the same title, written another way');
  assert(A.matchBank(index, { id: 'QUAL-WEL-L3', title: 'WELDING LEVEL 3', skillArea: 'Welding & Fabrication', level: 3 }, UNIT) === null, 'the same unit code in another level\'s plan: no match');
  assert(A.matchBank(index, QUAL, { code: 'MEMFAB0111C', title: 'Perform basic welding' }) === null, 'a unit with no bank: "No prepared assessments yet"');
  assert(A.matchBank(index, { id: 'Q-EIM', skillArea: 'Electrical Installation', level: 2 }, { code: 'EEMXXX' }).file === 'x/other.json', 'by skill area when the plan names no id or code');
}

console.log('Ready, then opened for an intake (the existing exam model)');
{
  const bank = makeBank();
  const m = A.bankToExam(bank, 'theory1', { id: 'EX-M1', qual: QUAL, unit: UNIT, at: '2026-10-31T10:00:00.000Z' });
  assert(A.statusOf(null, []).state === 'none' && A.statusOf(m, []).label === 'To check', 'not prepared yet, then To check');
  assert(A.openCopy(m, { id: 'EX-C1', course: '02. Welding & Fabrication', date: '2026-11-02', time: '09:00' }).error === 'not-ready', 'nothing opens until it is marked Ready');
  assert(A.mayCheck('instructor', true) && A.mayCheck('admin') && !A.mayCheck('instructor', false) && !A.mayCheck('adminstaff') && !A.mayCheck('student'), 'an instructor (her own programme) or the Administrator checks and opens');
  A.markReady(m, { id: 'INS-1', name: 'Ian Barrett', role: 'instructor' }, '2026-10-31T11:00:00.000Z');
  assert(A.statusOf(m, []).state === 'ready' && m.assessment.readyByName === 'Ian Barrett', 'Ready, and who checked it');
  assert(A.openCopy(m, { id: 'EX-C1', course: '02. Welding & Fabrication', date: '', time: '09:00' }).error === 'no-date', 'a date is needed');
  m.extraTime = [{ id: 'XT', studentId: '', minutes: 5, reason: 'x', byRole: 'admin', byName: 'M', at: 'z' }];
  const o = A.openCopy(m, { id: 'EX-C1', course: '02. Welding & Fabrication', intake: 'Sep 2026 – Jun 2027', centreId: 'C-2', date: '2026-11-02', time: '09:00', closeDate: '2026-11-02', closeTime: '17:00', by: 'INS-1', byRole: 'instructor', byName: 'Ian Barrett', at: '2026-10-31T12:00:00.000Z', offset: OFF });
  const c = o.exam;
  assert(c && c.status === 'upcoming' && c.course === '02. Welding & Fabrication' && c.date === '2026-11-02' && c.closeTime === '17:00', 'a copy for the intake\'s training centre, with its dates');
  assert(c.assessment.master === false && c.assessment.from === 'EX-M1' && c.assessment.intake === 'Sep 2026 – Jun 2027' && c.assessment.checkedBy === 'Ian Barrett' && c.assessment.ready === undefined, 'it says where it came from, the intake and who checked it');
  assert(c.questionData.length === 45 && c.questionData[0].id !== m.questionData[0].id && c.questionData[0].correctAnswer === m.questionData[0].correctAnswer, 'the questions copied with new ids, keys kept');
  assert(c.extraTime === undefined && m.status === 'draft', 'no extra time carried over; the prepared copy stays a draft for the next intake');
  assert(A.statusOf(m, A.copiesOf([m, c], 'EX-M1')).label === 'Opened for Sep 2026 – Jun 2027', '"Opened for Sep 2026 – Jun 2027"');
  assert(A.masterFor([c, m], QUAL, UNIT, 'theory1').id === 'EX-M1' && A.masterFor([c, m], QUAL, UNIT, 'theory2') === null, 'the prepared copy of each assessment is found');
  const p = A.bankToExam(bank, 'practical1', { id: 'EX-PM', qual: QUAL, unit: UNIT });
  A.markReady(p, { name: 'Ian Barrett' }, '2026-10-31T11:00:00.000Z');
  assert(A.openCopy(p, { id: 'EX-PC', course: 'W', date: '2026-11-02', time: '09:00' }).error === 'no-close', 'a practical needs a closing date (the days the group has)');
  assert(A.openCopy(p, { id: 'EX-PC', course: 'W', date: '2026-11-02', time: '09:00', closeDate: '2026-11-01', offset: OFF }).error === 'close-before-open', 'it must close after it opens');
  const pc = A.openCopy(p, { id: 'EX-PC', course: 'W', date: '2026-11-02', time: '09:00', closeDate: '2026-11-06', closeTime: '16:00', offset: OFF }).exam;
  assert(pc.practical.checklist.length === 3 && A.practicalStatus(pc, Date.parse('2026-11-03T12:00:00Z'), OFF) === 'open' && A.practicalStatus(pc, Date.parse('2026-11-01T12:00:00Z'), OFF) === 'upcoming' &&
    A.practicalStatus(pc, Date.parse('2026-11-07T12:00:00Z'), OFF) === 'closed' && A.practicalStatus(p, Date.now(), OFF) === 'draft', 'a practical is upcoming, open, then closed; the prepared copy is a draft');
  A.markToCheck(m);
  assert(m.assessment.ready === false && !m.assessment.readyByName, 'back to To check');
  assert(A.intakeLabel({ startDate: '2026-09-07', endDate: '2027-06-25' }) === 'Sep 2026 – Jun 2027' && A.intakeLabel({ name: '02. Welding' }) === '02. Welding', 'an intake is named by its months');
}

console.log('Where each record is filed, and its name');
{
  const path = A.folderPath({ programme: 'Welding & Fabrication', intake: 'Sep 2026 – Jun 2027', unitCode: 'MEMFAB0042C', unitTitle: 'Weld plate/pipe: SMAW', kind: 'theory1' });
  assert(path.join(' / ') === 'Assessment Results / Welding & Fabrication / Sep 2026 – Jun 2027 / MEMFAB0042C — Weld plate-pipe- SMAW / Theory 1', 'Programme / Intake / Unit / Theory 1 (' + path.join(' / ') + ')');
  assert(A.folderPath({ programme: 'W', intake: 'I', unitTitle: 'U', kind: 'practical2', groupName: 'Group B' }).slice(-2).join('/') === 'Practical 2/Group B', 'a practical: a folder per group');
  assert(A.paperFileName({ name: 'Kemar Johnson', studentId: 'STU-3w8k2', unitCode: 'MEMFAB0042C', kind: 'theory1' }) === 'Kemar Johnson (STU-3w8k2) — MEMFAB0042C Theory 1.pdf', '"<Full Name> (<STU-id>) — <Unit> <Assessment>.pdf"');
  assert(A.groupFileName({ groupName: 'Group B', unitCode: 'MEMFAB0042C', kind: 'practical1' }) === 'Group B — MEMFAB0042C Practical 1.pdf', 'the group\'s paper');
  assert(A.photoFileName(0, 'Set up', 'image/jpeg') === '01 Set up.jpg' && A.photoFileName(10, 'a/b', 'image/png') === '11 a-b.png', '"01 Set up.jpg"');
  assert(A.zipName({ groupName: 'Group B', unitCode: 'MEMFAB0042C', kind: 'practical1' }) === 'Group B — MEMFAB0042C Practical 1 — photos.zip', 'the ZIP named after the group and unit');
  assert(A.safeName('a\\b/c:d*e?"f<g>h|i\u0001') === 'a-b-c-d-e--f-g-h-i' && A.safeName('') === 'Untitled' && A.safeName('x'.repeat(300)).length === 120 && A.safeName('word '.repeat(40), 30) === 'word word word word word word', 'names a folder can carry, long ones cut at a whole word');
  const d1 = A.docNumber('ATT-1', '2026-10-30T15:42:00.000Z');
  assert(/^AR-2026-[0-9A-Z]{6}$/.test(d1) && d1 === A.docNumber('ATT-1', '2026-10-30T00:00:00.000Z') && d1 !== A.docNumber('ATT-2', '2026-10-30T00:00:00.000Z'), 'a document number, the same on every device (' + d1 + ')');
  const work = [A.filedRecord({ key: 'res:R1', status: 'provisional', fileId: 'F1', hash: 'h1', at: '2026-10-30T16:00:00.000Z' }), A.filedRecord({ key: 'res:R2', status: 'final', fileId: 'F2', hash: 'h2', at: '2026-10-30T16:00:00.000Z' })];
  const due = A.filingDue([{ key: 'res:R1', status: 'final', hash: 'h9' }, { key: 'res:R2', status: 'final', hash: 'h2' }, { key: 'res:R3', status: 'provisional', hash: 'h3' }, { key: 'res:R2', status: 'provisional', hash: 'h0' }], work);
  assert(due.map(d => d.key + ':' + d.reason).join() === 'res:R1:marked,res:R3:new', 'filed when new; filed again when marked; a final paper never goes back to provisional (' + due.map(d => d.key + ':' + d.reason).join() + ')');
  assert(A.filingDue([{ key: 'res:R2', status: 'final', hash: 'h-new' }], work)[0].reason === 'changed', 'filed again when a mark or comment changed');
  assert(work[0].id === A.filedId('res:R1') && work[0].type === 'filed', 'one filing record per paper');
}

console.log('The PDF\'s content (theory)');
{
  const bank = makeBank();
  const exam = A.bankToExam(bank, 'theory1', { id: 'EX-P1', qual: QUAL, unit: UNIT });
  exam.assessment.master = false; exam.assessment.intake = 'Sep 2026 – Jun 2027'; exam.status = 'completed'; exam.course = '02. Welding & Fabrication';
  exam.extraTime = [{ id: 'XT-1', studentId: 'STU-k', minutes: 15, reason: 'Power cut', byRole: 'admin', byName: 'M', at: 'z' }, { id: 'XT-2', studentId: 'STU-other', minutes: 30, reason: 'x', byRole: 'admin', byName: 'M', at: 'z' }];
  const answers = exam.questionData.map((q, i) => i < 40 ? q.correctAnswer : (q.correctAnswer + 1) % 4);
  answers[44] = null;
  const m = X.mark(X.publicQuestions(exam.questionData), answers, exam.questionData);
  const result = { id: 'RES-1', attemptId: 'ATT-K', examId: exam.id, studentId: 'STU-k', studentName: 'Kemar Johnson', answers: m.gradedResults, score: Math.round(m.earnedPoints / m.totalPoints * 100),
    totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: true, needsReview: false, reviewComplete: true, pendingCount: 0,
    startedAt: '2026-10-30T15:01:00.000Z', submittedAt: '2026-10-30T15:42:00.000Z',
    signature: A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-30T15:42:00.000Z', basis: 'ATT-K' }) };
  const model = A.theoryModel({ exam, result, questions: exam.questionData, student: { id: 'STU-k', name: 'Kemar Johnson' }, sat: { where: 'home', invigilated: true },
    centreName: 'Community Educational and Skills Training Institute and Services Ltd.', offset: OFF, madeAt: Date.parse('2026-10-30T15:43:00Z'), path: A.folderPath({ programme: 'Welding & Fabrication', intake: 'Sep 2026 – Jun 2027', unitCode: 'MEMFAB0042C', unitTitle: 'U', kind: 'theory1' }) });
  const row = k => (model.rows.find(r => r[0] === k) || [])[1];
  assert(model.recordTitle === 'Assessment record · Theory' && /^AR-2026-/.test(model.docNo), 'Assessment record · Theory, and its number');
  assert(row('Trainee') === 'Kemar Johnson' && row('Trainee ID') === 'STU-k' && row('Programme') === 'Welding & Fabrication' && row('Intake') === 'Sep 2026 – Jun 2027', 'the trainee\'s details: name, ID, programme, intake');
  assert(row('Unit') === 'MEMFAB0042C ' + UNIT.title && row('Assessment') === 'Theory Assessment 1', 'unit and assessment');
  assert(row('Started · finished') === '30 Oct 2026, 10:01 · 10:42' && row('Time allowed') === '2 h 30 min', 'started, finished and the time allowed, on the Centre\'s clock');
  assert(row('Extra time') === '15 min, added by the Administrator — Power cut' && model.rows.filter(r => r[0] === 'Extra time').length === 1, 'her extra time (and not another trainee\'s)');
  assert(row('Sat') === 'From home, invigilated online', 'where it was sat, and that it was invigilated');
  assert(model.result.score === '40 / 45' && model.result.pct === '89%' && model.result.passMark === '65%' && model.result.verdict === 'COMPETENT', 'the result box (' + model.result.line + ')');
  assert(model.questions.length === 45 && model.questions[0].options.length === 4 && model.questions[0].options.some(o => o.given && o.correct) && model.questions[0].marks === '1 / 1', 'every question, the answer given, the right answer and the marks');
  const wrong = model.questions[40];
  assert(wrong.marks === '0 / 1' && wrong.options.some(o => o.given && !o.correct) && wrong.options.some(o => o.correct && !o.given), 'a wrong answer shows the right one too');
  assert(model.questions[44].answer === 'No answer given', 'a question left blank says so');
  assert(model.signatures.trainee.name === 'Kemar Johnson' && /^Electronically signed by Kemar Johnson · 30 Oct 2026, 10:42 · Signature ID /.test(model.signatures.trainee.line), 'her signature line');
  assert(model.signatures.staff.join() === 'Administrator,Invigilator,Programme Coordinator', 'Administrator, Invigilator and Programme Coordinator — names left blank');
  assert(model.footer.filed === 'Welding & Fabrication · Sep 2026 – Jun 2027 · MEMFAB0042C — U · Theory 1', 'the footer names the programme, intake, unit and assessment (' + model.footer.filed + ')');
  assert(JSON.stringify(model.footer).indexOf('Assessment Results') === -1 && model.footer.filed.indexOf(' / ') === -1, '...not a folder path: a printed paper never says where it is kept');
  const own = A.theoryModel({ exam, result, questions: exam.questionData, student: { id: 'STU-k', name: 'Kemar Johnson' }, revealAnswers: false, offset: OFF });
  assert(own.questions.every(q => !(q.options || []).some(o => o.correct && !o.given)) && JSON.stringify(own).indexOf('"correct":"') === -1, 'her own copy before the answers are released: no right answer she did not give');
  const ownRight = own.questions.filter(q => q.outcome === 'correct'), ownWrong = own.questions.filter(q => q.outcome === 'incorrect' && (q.options || []).some(o => o.given));
  assert(ownRight.length && ownRight.every(q => q.options.some(o => o.given && o.correct && !o.wrong)), 'her own copy: an answer that scored is shown as right, as its marks say (' + ownRight.length + ')');
  assert(ownWrong.length && ownWrong.every(q => q.options.some(o => o.given && o.wrong && !o.correct)), 'her own copy: an answer that did not score is shown as wrong (' + ownWrong.length + ')');
  assert(A.modelHash(model) === A.modelHash(Object.assign({}, model, { footer: { made: 'other', filed: model.footer.filed } })), 'the content hash ignores when it was made');

  // Theory 2, awaiting marking, submitted automatically.
  const t2 = A.bankToExam(bank, 'theory2', { id: 'EX-P2', qual: QUAL, unit: UNIT });
  const ans2 = t2.questionData.map(q => q.type === 'shortanswer' ? (q.id.endsWith('S01') ? 'answer 1' : 'something else') : q.type === 'essay' ? 'My essay' : null);
  const m2 = X.mark(X.publicQuestions(t2.questionData), ans2, t2.questionData);
  const r2 = { id: 'RES-2', attemptId: 'ATT-2', studentId: 'STU-t', answers: m2.gradedResults, score: 3, totalPoints: m2.totalPoints, earnedPoints: m2.earnedPoints, passed: false, needsReview: true, reviewComplete: false,
    pendingCount: m2.manualCount, startedAt: '2026-10-31T13:00:00.000Z', submittedAt: '2026-10-31T16:35:00.000Z', autoSubmitted: true };
  const md2 = A.theoryModel({ exam: t2, result: r2, questions: t2.questionData, student: { id: 'STU-t', name: 'Tameka Richards' }, offset: OFF });
  assert(md2.provisional && md2.result.verdict === 'PROVISIONAL — AWAITING MARKING' && md2.result.tone === 'provisional', '"Provisional — awaiting marking"');
  assert(md2.questions.length === 25 && md2.questions[0].section.indexOf('Section A') === 0 && md2.questions[15].section.indexOf('Section B') === 0, 'sections head their questions');
  assert(md2.questions[0].marks === '2 / 2' && md2.questions[1].marks === 'awaiting marking' && md2.questions[20].marks === 'awaiting marking' && md2.questions[20].answer === 'My essay', 'marked, waiting, and the essay as written');
  assert(md2.signatures.trainee.unsigned === 'Not signed — submitted automatically when the time ran out.', 'submitted by the clock: not signed, said so');
  // Marked later: the comment appears.
  const idx = r2.answers.findIndex(a => a.type === 'essay');
  X.applyManualMarks(r2, { [idx]: { points: 4, feedback: 'Good preparation steps; mention tack-welding the ends.' } }, { by: 'Ian Barrett', passMark: 70 });
  const md3 = A.theoryModel({ exam: t2, result: r2, questions: t2.questionData, student: { id: 'STU-t', name: 'Tameka Richards' }, offset: OFF });
  const q16 = md3.questions[15];
  assert(q16.marks === '4 / 5' && q16.comment && q16.comment.by === 'Ian Barrett' && /tack-welding/.test(q16.comment.text), 'the marker\'s comment, and who wrote it');
}

console.log('The PDF\'s content (a group practical)');
{
  const bank = makeBank();
  const ex = A.bankToExam(bank, 'practical1', { id: 'EX-PP', qual: QUAL, unit: UNIT });
  ex.assessment.master = false; ex.assessment.intake = 'Sep 2026 – Jun 2027';
  const group = A.makeGroup({ id: 'AG-9', examId: 'EX-PP', name: 'Group B', members: ['S1', 'S2', 'S3'], at: '2026-10-28T10:00:00.000Z' });
  const work = [group];
  for (let i = 0; i < 7; i++) work.push(A.photoRecord({ id: 'PH' + i, examId: 'EX-PP', groupId: 'AG-9', studentId: i < 4 ? 'S1' : 'S2', caption: 'Photo ' + (i + 1), at: '2026-10-29T18:0' + i + ':00.000Z', files: [{ id: 'F' + i }] }));
  work.push(A.signoffRecord({ groupId: 'AG-9', examId: 'EX-PP', studentId: 'S1', name: 'Kemar Johnson', signature: A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-29T19:15:00.000Z' }), handIn: true, at: '2026-10-29T19:15:00.000Z' }));
  work.push(A.practicalResult({ examId: 'EX-PP', groupId: 'AG-9', studentId: 'S1', outcome: 'competent', checklist: [{ text: 'Prepared', met: true }, { text: 'Welded', met: true }, { text: 'Cleaned', met: false }], comment: 'Steady arc and equal legs', by: { name: 'Ian Barrett' }, at: '2026-10-30T10:00:00.000Z' }).rec);
  work.push(A.practicalResult({ examId: 'EX-PP', groupId: 'AG-9', studentId: 'S2', outcome: 'nyc', checklist: [{ text: 'Prepared', met: false }], comment: 'Root pass not shown', by: { name: 'Ian Barrett' }, at: '2026-10-30T10:00:00.000Z' }).rec);
  const students = { S1: { name: 'Kemar Johnson' }, S2: { name: 'Tameka Richards' }, S3: { name: 'Damion Lewis' } };
  const m = A.practicalModel({ exam: ex, group, work, students, offset: OFF, centreName: 'C', madeAt: Date.parse('2026-10-30T12:00:00Z') });
  assert(m.recordTitle === 'Assessment record · Practical (group)' && m.provisional === true, 'a group practical; one member not marked yet: provisional');
  assert(m.members.map(x => x.name + ':' + x.result).join('|') === 'Kemar Johnson:Competent|Tameka Richards:Not yet competent: Root pass not shown|Damion Lewis:Awaiting marking', 'a result for each member (' + m.members.map(x => x.result).join('|') + ')');
  assert(m.members[0].checks.join() === 'met,met,not' && m.members[1].checks.join() === 'not,,' && m.checklist.length === 3, 'what the assessor checked, member by member');
  assert(m.members[0].signature && m.members[1].notSigned === 'Not yet signed', 'a member who has not signed yet: "Not yet signed"');
  assert(m.photos.length === 7 && m.photos[0].caption === 'Photo 1' && m.photos[0].by === 'Kemar Johnson' && m.photos[6].by === 'Tameka Richards', 'every photo with its caption, who added it and when');
  assert(m.signatures.staff.join() === 'Administrator,Assessor,Programme Coordinator', 'Administrator, Assessor and Programme Coordinator');
  const mine = A.practicalModel({ exam: ex, group, work, students, offset: OFF, memberOnly: 'S2' });
  const mj = JSON.stringify(mine.members.filter(x => x.id !== 'S2'));
  assert(mine.memberOnly && mine.result.verdict === 'NOT YET COMPETENT' && mine.members.find(x => x.id === 'S2').result.indexOf('Not yet competent') === 0, 'a member\'s own copy: her result');
  assert(mj.indexOf('Competent') === -1 && mj.indexOf('Suggestion') === -1 && mj.indexOf('Electronically') === -1, 'and nobody else\'s result, comment or signature');
  const all = JSON.stringify(mine);
  assert(mine.members.map(x => x.name).join() === 'Kemar J.,Tameka Richards,Damion L.' && all.indexOf('Kemar Johnson') === -1 && all.indexOf('Damion Lewis') === -1 && all.indexOf('"S1"') === -1 && all.indexOf('"S3"') === -1,
    'her own copy names the others as her phone does ("Kemar J."), never their full names or IDs');
  assert(mine.photos[0].by === 'Kemar J.' && mine.photos[6].by === 'Tameka Richards', 'and who added each photo the same way');
  assert(m.members[0].name === 'Kemar Johnson' && m.members[0].id === 'S1', 'the office copy keeps every full name');
}

console.log('Where it was sat (the "Sat" line)');
{
  const bank = makeBank();
  const t1 = A.bankToExam(bank, 'theory1', { id: 'EX-S', qual: QUAL, unit: UNIT });
  const sat = o => A.theoryModel({ exam: t1, result: null, questions: t1.questionData, student: { id: 'S', name: 'N' }, offset: OFF, sat: o }).rows.find(r => r[0] === 'Sat')[1];
  assert(sat({ where: 'home', invigilated: true }) === 'From home, invigilated online' && sat({ where: 'centre', invigilated: false }) === 'At the Centre, not invigilated', 'from home, invigilated online; at the Centre, not invigilated');
  assert(sat({ where: 'centre' }) === 'At the Centre' && sat({}) === '—', 'nothing said of invigilation when it was not recorded');
  const m2 = JSON.parse(JSON.stringify(t1)); A.markReady(m2, { id: 'I', name: 'Ian', role: 'instructor' }, '2026-10-01T10:00:00.000Z');
  const o1 = A.openCopy(m2, { id: 'C1', course: 'Welding', date: '2026-11-02', time: '09:00', invigilated: true, offset: OFF });
  const o2 = A.openCopy(m2, { id: 'C2', course: 'Welding', date: '2026-11-02', time: '09:00', offset: OFF });
  assert(o1.exam.assessment.invigilated === true && !('invigilated' in o2.exam.assessment), 'the sitting\'s invigilation, when the opener said');
}

console.log('The Assessment Results page');
{
  const bank = makeBank();
  const t1 = A.bankToExam(bank, 'theory1', { id: 'EX-R1', qual: QUAL, unit: UNIT }); t1.assessment.master = false; t1.assessment.intake = 'Sep 2026'; t1.status = 'completed';
  const pr = A.bankToExam(bank, 'practical1', { id: 'EX-R2', qual: QUAL, unit: UNIT }); pr.assessment.master = false; pr.assessment.intake = 'Sep 2026';
  const master = A.bankToExam(bank, 'theory2', { id: 'EX-R3', qual: QUAL, unit: UNIT });
  const results = [
    { id: 'R1', examId: 'EX-R1', studentId: 'S1', score: 85, passed: true, needsReview: false, submittedAt: '2026-10-30T15:42:00.000Z' },
    { id: 'R2', examId: 'EX-R1', studentId: 'S2', score: 40, passed: false, needsReview: true, reviewComplete: false, pendingCount: 1, submittedAt: '2026-10-30T15:47:00.000Z' },
    { id: 'R3', examId: 'EX-OTHER', studentId: 'S1', score: 50, submittedAt: '2026-10-30T15:00:00.000Z' },
    { id: 'R4', examId: 'EX-R1', studentId: 'S3', archived: true, submittedAt: '2026-10-30T15:00:00.000Z' }
  ];
  const group = A.makeGroup({ id: 'G1', examId: 'EX-R2', name: 'Group B', members: ['S1', 'S2'] });
  const work = [group, A.photoRecord({ id: 'P', examId: 'EX-R2', groupId: 'G1', studentId: 'S1', at: '2026-10-29T18:00:00.000Z' }),
    A.signoffRecord({ groupId: 'G1', examId: 'EX-R2', studentId: 'S1', name: 'A B', signature: A.makeSignature({ name: 'A B', at: '2026-10-29T19:00:00.000Z' }), handIn: true, at: '2026-10-29T19:00:00.000Z' })];
  const rows = A.resultRows({ exams: [t1, pr, master], results, work, students: [{ id: 'S1', name: 'Kemar Johnson' }, { id: 'S2', name: 'Tameka Richards' }] });
  assert(rows.map(r => r.key).join() === 'res:R2,res:R1,grp:G1', 'completed assessments, newest first; another exam and archived results left out (' + rows.map(r => r.key).join() + ')');
  assert(rows[2].kind === 'practical' && rows[2].members.join() === 'Kemar Johnson,Tameka Richards' && rows[2].photos === 1 && rows[2].status === 'provisional', 'a practical once per group, with its photos');
  const c = A.resultCounts(rows);
  assert(c.completed === 3 && c.awaiting === 2 && c.groups === 1 && c.photos === 1, 'the counts');
  assert(A.resultRows({ exams: [t1, pr], results, work, filters: { status: 'final' } }).length === 1 && A.resultRows({ exams: [t1, pr], results, work, filters: { kind: 'practical1' } }).length === 1 &&
    A.resultRows({ exams: [t1, pr], results, work, filters: { unit: 'memfab0042c', programme: 'welding & fabrication', intake: 'SEP 2026' } }).length === 3 &&
    A.resultRows({ exams: [t1, pr], results, work, filters: { intake: 'Jan 2027' } }).length === 0, 'filters: programme, intake, unit, assessment, result status');
}

console.log('What the office files (the papers, their copies, filed again when they change)');
{
  const bank = makeBank();
  const ready = k => { const m = A.bankToExam(bank, k, { id: 'M-' + k, qual: QUAL, unit: UNIT }); A.markReady(m, { id: 'I', name: 'Ian Barrett', role: 'instructor' }, '2026-10-01T10:00:00.000Z'); return m; };
  const open = (k, id) => A.openCopy(ready(k), { id, course: 'Welding & Fabrication — Sep 2026', intake: 'Sep 2026 – Jun 2027', date: '2026-10-30', time: '09:00', closeDate: k.indexOf('practical') === 0 ? '2026-11-06' : '', invigilated: k.indexOf('theory') === 0 ? true : undefined, offset: OFF }).exam;
  const t1 = open('theory1', 'EX-F1'), t2 = open('theory2', 'EX-F2'), p1 = open('practical1', 'EX-F3');
  const people = [{ id: 'STU-a', name: 'Kemar Johnson' }, { id: 'STU-b', name: 'Tameka Richards' }, { id: 'STU-c', name: 'Damion Lewis' }, { id: 'STU-d', name: 'Nadine Bailey' }];
  const ans1 = t1.questionData.map(q => q.type === 'mcq' ? q.correctAnswer : null);
  const m1 = X.mark(X.publicQuestions(t1.questionData), ans1, t1.questionData);
  const r1 = { id: 'RES-F1', attemptId: 'ATT-F1', examId: 'EX-F1', studentId: 'STU-a', studentName: 'Kemar Johnson', answers: m1.gradedResults, score: 100, totalPoints: m1.totalPoints, earnedPoints: m1.earnedPoints,
    passed: true, needsReview: false, reviewComplete: true, pendingCount: 0, startedAt: '2026-10-30T14:00:00.000Z', submittedAt: '2026-10-30T16:00:00.000Z', markedBy: 'gate',
    signature: A.makeSignature({ name: 'Kemar Johnson', at: '2026-10-30T16:00:00.000Z', basis: 'ATT-F1' }) };
  const ans2 = t2.questionData.map(q => q.type === 'shortanswer' ? 'something else' : q.type === 'essay' ? 'My essay' : null);
  const m2 = X.mark(X.publicQuestions(t2.questionData), ans2, t2.questionData);
  const r2 = { id: 'RES-F2', attemptId: 'ATT-F2', examId: 'EX-F2', studentId: 'STU-b', answers: m2.gradedResults, score: 0, totalPoints: m2.totalPoints, earnedPoints: m2.earnedPoints,
    passed: false, needsReview: true, reviewComplete: false, pendingCount: m2.manualCount, startedAt: '2026-10-30T14:00:00.000Z', submittedAt: '2026-10-30T17:30:00.000Z',
    markedBy: 'gate', receivedAt: '2026-10-30T17:30:00.000Z' };
  const group = A.makeGroup({ id: 'AG-F', examId: 'EX-F3', name: 'Group A', members: ['STU-a', 'STU-b', 'STU-c', 'STU-d'], at: '2026-10-30T10:00:00.000Z' });
  const work = [group];
  for (let i = 0; i < 3; i++) work.push(A.photoRecord({ id: 'PH-F' + i, examId: 'EX-F3', groupId: 'AG-F', studentId: i ? 'STU-b' : 'STU-d', caption: ['Set up', 'Root pass', 'Cap'][i], at: '2026-10-31T1' + i + ':00:00.000Z', files: [{ id: 'DF' + i, driveFileId: 'DF' + i, type: 'image/jpeg', size: 1000 }], w: 1200, h: 900 }));
  work.push(A.signoffRecord({ groupId: 'AG-F', examId: 'EX-F3', studentId: 'STU-b', name: 'Tameka Richards', signature: A.makeSignature({ name: 'Tameka Richards', at: '2026-10-31T13:00:00.000Z' }), handIn: true, at: '2026-10-31T13:00:00.000Z' }));
  const base = { exams: [ready('theory1'), t1, t2, p1], results: [r1, r2], work, students: people, centreName: 'C', offset: OFF, now: Date.parse('2026-10-31T18:00:00Z'), canReveal: () => false };
  let items = A.paperItems(base);
  const k = key => items.find(x => x.key === key);
  assert(items.map(x => x.key).join() === 'res:RES-F1,res:RES-F2,grp:AG-F', 'a paper per theory result and one per group that handed in; the prepared copy files nothing (' + items.map(x => x.key).join() + ')');
  const i1 = k('res:RES-F1'), i2 = k('res:RES-F2'), ip = k('grp:AG-F');
  assert(i1.path.join(' / ') === 'Assessment Results / Welding & Fabrication / Sep 2026 – Jun 2027 / MEMFAB0042C — Perform weld in the flat and horizontal positions using manual metal arc welding / Theory 1',
    'Assessment Results / Programme / Intake / Unit / Theory 1 (' + i1.path.join(' / ') + ')');
  assert(i1.name === 'Kemar Johnson (STU-a) — MEMFAB0042C Theory 1.pdf' && i1.status === 'final' && i2.status === 'provisional', '"<Full Name> (<STU-id>) — <Unit> <Assessment>.pdf"; marked, and awaiting marking');
  assert(i1.model.rows.find(r => r[0] === 'Sat')[1] === 'From home, invigilated online', 'where it was sat, from the record (from home, invigilated online)');
  assert(i1.model.signatures.trainee.name === 'Kemar Johnson' && /Electronically signed by Kemar Johnson/.test(i1.model.signatures.trainee.line), 'her signature on the office copy');
  const keyed = q => q.options && q.options.some(o => o.correct);
  const shown = q => q.options && q.options.some(o => o.correct && !o.given);
  assert(i1.model.questions.filter(keyed).length === 45 && i1.mine.questions.filter(shown).length === 0 && !i1.reveal, 'the office copy shows every right answer; her own copy none she did not give, before the release');
  const later = A.paperItems(Object.assign({}, base, { canReveal: () => true }));
  assert(later[0].mine.questions.filter(keyed).length === 45 && later[0].hash !== i1.hash, 'once the answers are released her copy shows them, and the paper is filed again');
  assert(ip.path[ip.path.length - 1] === 'Group A' && ip.path[ip.path.length - 2] === 'Practical 1' && ip.name === 'Group A — MEMFAB0042C Practical 1.pdf' && ip.status === 'provisional', 'a practical in its group\'s folder ("Group A — <Unit> Practical 1.pdf"), provisional until every member has a result');
  assert(ip.photos.map(p => p.name).join('|') === '01 Set up.jpg|02 Root pass.jpg|03 Cap.jpg' && ip.photos[0].fileId === 'DF0' && ip.photos[0].w === 1200, 'the photos, numbered with their captions, and where each one is');
  assert(ip.members.length === 4 && ip.members[1].name === 'Tameka Richards (STU-b) — MEMFAB0042C Practical 1.pdf' && ip.members[1].model.memberOnly && ip.zip === 'Group A — MEMFAB0042C Practical 1 — photos.zip', 'each member\'s own copy, and the photos\' ZIP name');
  assert(JSON.stringify(ip.members[1].model).indexOf('Kemar Johnson') === -1, 'a member\'s own copy never carries another member\'s full name');
  assert(A.paperItems(Object.assign({}, base, { only: 'grp:AG-F' })).length === 1, 'just one paper, when asked for one');

  // Filed: nothing more to do until something changes.
  let due = A.filingDue(items, []);
  assert(due.length === 3 && due.every(d => d.reason === 'new'), 'never filed: all three are due');
  const filed = items.map(it => A.filedRecord({ key: it.key, examId: it.examId, studentId: it.studentId, groupId: it.groupId, status: it.status, fileId: 'F-' + it.key, hash: it.hash, at: '2026-10-31T18:01:00.000Z' }));
  assert(A.filingDue(items, filed).length === 0, 'filed: nothing due');
  // Marked: the final replaces the provisional.
  const idx = r2.answers.map((a, i) => (X.outcomeOf(a) === 'pending' ? i : -1)).filter(i => i >= 0);
  const marks = {}; idx.forEach(i => { marks[i] = { points: 1, feedback: 'Seen.' }; });
  X.applyManualMarks(r2, marks, { by: 'Ian Barrett', passMark: 70 });
  items = A.paperItems(base);
  due = A.filingDue(items, filed);
  assert(due.length === 1 && due[0].key === 'res:RES-F2' && due[0].reason === 'marked' && due[0].filed.fileId === 'F-res:RES-F2', 'marked: the provisional paper is due again, into the same file (' + due.map(d => d.key + ':' + d.reason).join() + ')');
  assert(r2.markedBy === 'Ian Barrett' && /^From home/.test(due[0].model.rows.find(r => r[0] === 'Sat')[1]), 'sat from home: still said so once a person has marked it');
  // A photo late, a member's result: the group's paper is due again.
  work.push(A.practicalResult({ examId: 'EX-F3', groupId: 'AG-F', studentId: 'STU-a', outcome: 'competent', checklist: [], comment: '', by: { name: 'Ian Barrett' }, at: '2026-10-31T19:00:00.000Z' }).rec);
  items = A.paperItems(base);
  due = A.filingDue(items, filed);
  assert(due.map(d => d.key + ':' + d.reason).join() === 'res:RES-F2:marked,grp:AG-F:changed', 'a member\'s result changes the group\'s paper: filed again (' + due.map(d => d.key + ':' + d.reason).join() + ')');
  const fin = filed.map(f => Object.assign({}, f, { status: 'final' }));
  assert(A.filingDue([{ key: 'grp:AG-F', status: 'provisional', hash: 'x' }], fin).length === 0, 'a paper filed as final never goes back to provisional');
}

console.log('The units, for the owner to send (Export units)');
{
  const csv = A.unitsCsv([{ id: 'QUAL-WEL-L2', title: 'WELDING LEVEL 2', skillArea: 'Welding & Fabrication', level: 2, code: 'MEM22423', units: [{ code: 'MEMFAB0042C', name: 'Perform weld "flat"' }, { code: 'MEMFAB0042C', name: 'dup' }, { code: 'X1', name: '=SUM(A1)', coreElective: 'Elective' }] }, { id: 'bad' }]);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert(csv.charCodeAt(0) === 0xfeff && lines.length === 3, 'a header and one line per unit (a unit listed twice once)');
  assert(lines[0] === '"Programme","Qualification","Qualification code","Level","Unit code","Unit title","Core/Elective"', 'programme, unit code and unit title, and the rest');
  assert(lines[1] === '"Welding & Fabrication","WELDING LEVEL 2","MEM22423","2","MEMFAB0042C","Perform weld ""flat""","Core"', 'quotes doubled');
  assert(lines[2].indexOf('"\'=SUM(A1)"') !== -1, 'a cell a spreadsheet would run is made harmless');
  assert(A.unitsFrom([{ id: 'Q', title: 'B', units: [] }, { id: 'P', title: 'A', units: [{ code: 'c', name: 'n' }] }])[0].qual.title === 'A', 'programmes in order');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
