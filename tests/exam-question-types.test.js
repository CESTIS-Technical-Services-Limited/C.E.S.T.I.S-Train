/* The exam platform's new question types mark themselves, and every exam and
   result the Centre already has marks exactly as it did.

   What this pins (CESTISCore.exams, shared by every page and both builds):
     - "Select one or more" (multi): each right option earns its share, each
       wrong one takes its share of the wrong options away, never below 0, so
       ticking every box scores nothing; or, set all-or-nothing, full marks
       only for exactly the right set.
     - Matching (match): each row is worth its share; the trainee's copy
       carries the prompts and an alphabetical list of answers — never the
       pairs (the key).
     - Short answer (shortanswer): capitals and extra spaces do not matter,
       several accepted answers, and a * stands for any letters.
     - Numerical: "1,000" is a thousand, ± a tolerance, and "about 1000" is
       not a number.
     - Information items take no number, no marks and no answer.
     - The attempt's copy: keys stripped, questions shuffled around the
       information items, options shuffled with the ORIGINAL option index
       recorded so marking never depends on the order shown.
     - Paging, numbering, answered/partly answered, outcomes, the start of
       an old result, marks written as 1.50.
     - An exam may name its own closing time (Moodle's "Close the quiz");
       without one it closes `duration` minutes after it opens, as before.
     - A paper of the old types (MCQ, true/false, fill-in, essay, an unkeyed
       question, a question without an id) marks to EXACTLY the output the
       integration head produced (captured from commit e51356f).

   Run: node tests/exam-question-types.test.js */
'use strict';

const Core = require('../cestis-core.js');
const E = Core.exams;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); assert(x === y, msg + ' — expected ' + y + ', got ' + x); }

console.log('"Select one or more": a share per right option, wrong options take theirs away');
{
  // 5 options, 3 right (0,1,3): each right one is 1/3, each wrong one -1/2.
  const k = [0, 1, 3], o = { optionCount: 5 };
  assertEq(E.markMulti([0, 1, 3], k, o), 1, 'exactly the right options: full marks');
  assertEq(Math.round(E.markMulti([0, 1], k, o) * 1000) / 1000, 0.667, 'two of the three right: two thirds');
  assertEq(Math.round(E.markMulti([0, 1, 3, 4], k, o) * 1000) / 1000, 0.5, 'all three right plus one wrong: 1 - 1/2');
  assertEq(E.markMulti([0, 1, 2, 3, 4], k, o), 0, 'ticking every box scores nothing');
  assertEq(E.markMulti([2, 4], k, o), 0, 'only wrong options: never below 0');
  assertEq(E.markMulti([], k, o), 0, 'nothing ticked: nothing');
  assertEq(E.markMulti(null, k, o), 0, 'no answer at all: nothing');
  assertEq(E.markMulti([0, 0, 0], k, o), E.markMulti([0], k, o), 'an option counted once however often it is sent');
  assertEq(E.markMulti([0, 1, 3], k, { optionCount: 5, allOrNothing: true }), 1, 'all-or-nothing: exactly right is full marks');
  assertEq(E.markMulti([0, 1], k, { optionCount: 5, allOrNothing: true }), 0, 'all-or-nothing: two of three is nothing');
  assertEq(E.markMulti([0, 1, 3, 4], k, { optionCount: 5, allOrNothing: true }), 0, 'all-or-nothing: an extra wrong one is nothing');
  assertEq(E.markMulti([0], [], o), 0, 'a question with no key marks nothing (it goes to staff, below)');
}

console.log('Matching: a share per row; the trainee never receives the pairs');
{
  const pairs = [{ prompt: 'Welding fumes', answer: 'Local exhaust ventilation' }, { prompt: 'Arc flash', answer: 'Shade 10–13 filter lens' },
    { prompt: 'Electric shock', answer: 'Dry gloves and an insulated mat' }, { prompt: 'Hot slag', answer: 'Leather spats and apron' }];
  assertEq(E.markMatch(pairs.map(p => p.answer), pairs), 1, 'every row right: full marks');
  assertEq(E.markMatch(['Local exhaust ventilation', 'Shade 10–13 filter lens', 'Leather spats and apron', 'Leather spats and apron'], pairs), 0.75, 'three rows right of four');
  assertEq(E.markMatch(['local exhaust  ventilation', null, '', undefined], pairs), 0.25, 'a row left on "Choose…" is just not right; spacing and capitals do not matter');
  assertEq(E.markMatch(null, pairs), 0, 'no answer: nothing');
  const q = { id: 'M', type: 'match', text: 'Match', points: 4, pairs, distractors: ['A dust mask', 'local exhaust ventilation'] };
  assertEq(E.matchChoices(q), ['A dust mask', 'Dry gloves and an insulated mat', 'Leather spats and apron', 'Local exhaust ventilation', 'Shade 10–13 filter lens'],
    'the choices: every answer once plus the extra wrong one, alphabetically (a repeated answer is listed once)');
  const pub = E.publicQuestions([q])[0];
  assert(!('pairs' in pub) && !('distractors' in pub) && !('correctAnswer' in pub), 'the trainee\'s copy has no pairs and no key');
  assertEq(pub.rows, ['Welding fumes', 'Arc flash', 'Electric shock', 'Hot slag'], 'it has the prompts, in order');
  assertEq(pub.choices.length, 5, 'and the answers to choose from');
  assertEq(E.validKey(q, null), true, 'a matching question with two or more full pairs is keyed');
  assertEq(E.validKey({ type: 'match', pairs: [pairs[0]] }, null), false, 'one pair is not a question');
  assertEq(E.validKey({ type: 'match', pairs: [pairs[0], { prompt: 'x', answer: ' ' }] }, null), false, 'a pair without its answer is not keyed');
}

console.log('Short answer: capitals and spaces do not matter, several answers, * wildcard');
{
  const key = ['flashback arrestor', 'flashback arrester', 'flash back arrest*'];
  assert(E.shortAnswerMatches('Flashback Arrestor', key), 'capitals do not matter');
  assert(E.shortAnswerMatches('  flashback    arrester ', key), 'extra spaces do not matter; a second accepted answer');
  assert(E.shortAnswerMatches('Flash back arrestor', key), '* stands for any letters ("arrest*")');
  assert(!E.shortAnswerMatches('flashback', key), 'part of an answer is not the answer');
  assert(!E.shortAnswerMatches('', ['*']), 'a blank answer never matches, even a lone *');
  assertEq(E.acceptedAnswers(['*', '  ', 'oxygen']), ['oxygen'], 'a lone * or a blank is not an accepted answer');
  assertEq(E.acceptedAnswers('oxygen|O2'), ['oxygen', 'O2'], 'answers typed on one line, split by |, are accepted too');
  assert(E.shortAnswerMatches('a.b', ['a.b']) && !E.shortAnswerMatches('axb', ['a.b']), 'a full stop in an answer is a full stop, not "any letter"');
  assert(E.shortAnswerMatches('(15)', ['(15)']) && E.shortAnswerMatches('c++ code', ['c++*']), 'brackets and pluses are taken literally');
  assertEq(E.validKey({ type: 'shortanswer' }, []), false, 'no accepted answer: not keyed');
}

console.log('Numerical: typed numbers, thousands commas, tolerance');
{
  assertEq(E.parseNumber('1,000'), 1000, '"1,000" is a thousand');
  assertEq(E.parseNumber(' -2.5 '), -2.5, 'negative decimals');
  assertEq(E.parseNumber('.5'), 0.5, 'a leading point');
  assertEq(E.parseNumber('1e3'), 1000, 'scientific notation');
  assertEq(E.parseNumber('1,5'), null, '"1,5" is not a number here (Jamaica writes 1.5)');
  assertEq(E.parseNumber('about 1000'), null, 'words are not a number');
  assertEq(E.parseNumber('12 mm'), null, 'nor is a number with a unit typed after it');
  assertEq(E.parseNumber(''), null, 'blank is not a number');
  assert(E.numericalMatches('1000', 1000, 0), 'exactly the key');
  assert(!E.numericalMatches('1001', 1000, 0), 'tolerance 0: one more is wrong');
  assert(E.numericalMatches('9.6', 10, 0.5) && E.numericalMatches('10.5', 10, 0.5), 'within ± the tolerance, either side');
  assert(!E.numericalMatches('10.51', 10, 0.5), 'outside it is wrong');
  assert(E.numericalMatches('0.3', 0.1 + 0.2, 0), 'binary rounding never costs a mark');
  assert(!E.numericalMatches('', 0, 0), 'a blank answer is not 0');
  assertEq(E.validKey({ type: 'numerical', tolerance: -1 }, 5), false, 'a negative tolerance is not a key');
  assertEq(E.validKey({ type: 'numerical' }, 'abc'), false, 'nor is a key that is not a number');
}

console.log('Marking a paper of every type');
{
  const qd = [
    { id: 'Q1', type: 'mcq', text: 'Hose colour?', points: 1, options: ['Red', 'Blue'], correctAnswer: 0 },
    { id: 'Q2', type: 'multi', text: 'PPE?', points: 3, options: ['Helmet', 'Gloves', 'Sandals', 'Jacket', 'Polyester'], correctAnswer: [0, 1, 3] },
    { id: 'Q3', type: 'match', text: 'Match', points: 4, pairs: [{ prompt: 'a', answer: 'A' }, { prompt: 'b', answer: 'B' }, { prompt: 'c', answer: 'C' }, { prompt: 'd', answer: 'D' }] },
    { id: 'I1', type: 'info', text: 'Section B' },
    { id: 'Q4', type: 'shortanswer', text: 'Device?', points: 1, correctAnswer: ['flashback arrestor'] },
    { id: 'Q5', type: 'numerical', text: 'Litres per hour?', points: 2, correctAnswer: 1000, tolerance: 0 },
    { id: 'Q6', type: 'short', text: 'Essay', points: 5 },
    { id: 'Q7', type: 'multi', text: 'Unkeyed', points: 2, options: ['x', 'y'], correctAnswer: [] }
  ];
  const pub = E.publicQuestions(qd);
  assert(pub.every(q => !('correctAnswer' in q) && !('pairs' in q) && !('tolerance' in q)), 'no key of any type reaches the attempt');
  const m = E.mark(pub, [0, [0, 1], ['A', 'B', 'C', 'x'], null, 'Flashback  ARRESTOR', '1,000', 'Close the valves', [0]], qd);
  assertEq(m.gradedResults.length, 7, 'one entry per question — none for the information item');
  assertEq(m.gradedResults.map(a => a.questionId), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'], 'in the order asked');
  const by = id => m.gradedResults.find(a => a.questionId === id);
  assertEq([by('Q2').earnedPoints, by('Q2').isCorrect, by('Q2').fraction], [2, false, 0.6667], 'multi: 2 of 3 marks, partly correct');
  assertEq([by('Q3').earnedPoints, by('Q3').correctAnswer, by('Q3').rows], [3, ['A', 'B', 'C', 'D'], ['a', 'b', 'c', 'd']], 'match: 3 of 4, with the right answers and the prompts kept on the result');
  assertEq([by('Q4').earnedPoints, by('Q4').isCorrect], [1, true], 'short answer: right');
  assertEq([by('Q5').earnedPoints, by('Q5').tolerance], [2, 0], 'numerical: right, its tolerance kept');
  assertEq([by('Q6').needsManualGrade, by('Q6').graded], [true, false], 'the essay waits for staff');
  assertEq([by('Q7').needsManualGrade, by('Q7').correctAnswer], [true, null], 'a new-type question with no usable key goes to staff, never guessed');
  assertEq(m.totalPoints, 18, 'total marks: every question but the information item');
  assertEq(m.earnedPoints, 9, 'earned: 1 + 2 + 3 + 1 + 2');
  assertEq(m.correctCount, 3, 'fully right: Q1, Q4, Q5');
  assertEq(m.manualCount, 2, 'the essay and the unkeyed question are for staff');
  assertEq(E.mark(pub, [], qd).earnedPoints, 0, 'an empty attempt earns nothing');
  // A key changed on the exam after the attempt began is the one marked against.
  const qd2 = JSON.parse(JSON.stringify(qd)); qd2[5].correctAnswer = 999; qd2[5].tolerance = 1;
  assertEq(E.mark(pub, [null, null, null, null, null, '1000', null, null], qd2).gradedResults[4].earnedPoints, 2, 'a numerical answer is marked by the exam\'s own key and tolerance');
}

console.log('Old papers and old results mark exactly as on the integration head (e51356f)');
{
  const qd = [
    { id: 'L1', type: 'mcq', text: 'Earth wire colour?', points: 1, options: ['Red', 'Black', 'Green/Yellow', 'Blue'], correctAnswer: 2 },
    { id: 'L2', type: 'tf', text: 'Mains is 110 V', points: 1, correctAnswer: true },
    { id: 'L3', type: 'fill', text: 'A ____ protects a circuit', points: 2, correctAnswer: 'Fuse' },
    { id: 'L4', type: 'short', text: 'Explain earthing', points: 4, correctAnswer: 'Model' },
    { id: 'L5', type: 'mcq', text: 'No key', points: 1, options: ['a', 'b'], correctAnswer: null },
    { type: 'tf', text: 'Legacy, no id', points: 1, correctAnswer: false }
  ];
  const pub = E.publicQuestions(qd);
  assertEq(pub, [{ id: 'L1', type: 'mcq', text: 'Earth wire colour?', points: 1, options: ['Red', 'Black', 'Green/Yellow', 'Blue'] },
    { id: 'L2', type: 'tf', text: 'Mains is 110 V', points: 1 }, { id: 'L3', type: 'fill', text: 'A ____ protects a circuit', points: 2 },
    { id: 'L4', type: 'short', text: 'Explain earthing', points: 4 }, { id: 'L5', type: 'mcq', text: 'No key', points: 1, options: ['a', 'b'] },
    { type: 'tf', text: 'Legacy, no id', points: 1 }], 'the trainee\'s copy of an old paper is unchanged');
  // Captured from the integration head's CESTISCore.exams.mark for this paper and these answers.
  const HEAD = {"gradedResults":[{"questionId":"L1","questionText":"Earth wire colour?","type":"mcq","studentAnswer":2,"correctAnswer":2,"isCorrect":true,"needsManualGrade":false,"points":1,"earnedPoints":1,"awardedPoints":1,"graded":true,"gradedBy":"auto","autoMatch":null},{"questionId":"L2","questionText":"Mains is 110 V","type":"tf","studentAnswer":false,"correctAnswer":true,"isCorrect":false,"needsManualGrade":false,"points":1,"earnedPoints":0,"awardedPoints":0,"graded":true,"gradedBy":"auto","autoMatch":null},{"questionId":"L3","questionText":"A ____ protects a circuit","type":"fill","studentAnswer":" fuse ","correctAnswer":"Fuse","isCorrect":null,"needsManualGrade":true,"points":2,"earnedPoints":0,"awardedPoints":null,"graded":false,"gradedBy":null,"autoMatch":true},{"questionId":"L4","questionText":"Explain earthing","type":"short","studentAnswer":"Because...","correctAnswer":"Model","isCorrect":null,"needsManualGrade":true,"points":4,"earnedPoints":0,"awardedPoints":null,"graded":false,"gradedBy":null,"autoMatch":null},{"questionId":"L5","questionText":"No key","type":"mcq","studentAnswer":0,"correctAnswer":null,"isCorrect":null,"needsManualGrade":true,"points":1,"earnedPoints":0,"awardedPoints":null,"graded":false,"gradedBy":null,"autoMatch":null},{"questionText":"Legacy, no id","type":"tf","studentAnswer":false,"correctAnswer":null,"isCorrect":null,"needsManualGrade":true,"points":1,"earnedPoints":0,"awardedPoints":null,"graded":false,"gradedBy":null,"autoMatch":null}],"totalPoints":10,"earnedPoints":1,"correctCount":1,"manualCount":4};
  assertEq(E.mark(pub, [2, false, ' fuse ', 'Because...', 0, false], qd), HEAD, 'byte for byte the same marking');
  assertEq(E.keyProblems(qd), [5], 'and the same unkeyed question is reported');
  // An old result (no startedAt, no fraction) still reads.
  const old = { submittedAt: '2026-10-16T15:30:00.000Z', timeTaken: 1500, answers: HEAD.gradedResults };
  assertEq(E.attemptStartMs(old), Date.parse('2026-10-16T15:05:00.000Z'), 'an old result\'s start is worked back from its time taken');
  assertEq(HEAD.gradedResults.map(E.outcomeOf), ['correct', 'incorrect', 'pending', 'pending', 'pending', 'pending'], 'its answers read correct / incorrect / awaiting marking');
  assertEq(E.outcomeOf({ needsManualGrade: true, graded: true, isCorrect: false, earnedPoints: 2, points: 4 }), 'partial', 'an essay given half marks reads partly correct');
}

console.log('Builder keys for the new types; deleting an option keeps the key on its options');
{
  const qs = [{ type: 'multi', options: ['a', 'b', 'c'], correctAnswer: [0, 2] }, { type: 'multi', options: ['a', 'b'], correctAnswer: [] },
    { type: 'multi', options: ['a', 'b'], correctAnswer: [0, 0] }, { type: 'match', pairs: [] }, { type: 'shortanswer', correctAnswer: ['ok'] },
    { type: 'numerical', correctAnswer: '' }, { type: 'info', text: 'x' }, { type: 'short' }, { type: 'fill', correctAnswer: '' }];
  assertEq(E.keyProblems(qs), [2, 3, 4, 6], 'unkeyed: an empty or repeated "one or more", a matching without pairs, a numerical without a number');
  const q = { type: 'multi', options: ['a', 'b', 'c', 'd'], correctAnswer: [0, 2, 3] };
  E.fixKeyAfterOptionRemoved(q, 1);
  assertEq(q.correctAnswer, [0, 1, 2], 'removing an option above two right ones moves them with their options');
  E.fixKeyAfterOptionRemoved(q, 0);
  assertEq(q.correctAnswer, [0, 1], 'removing a right option takes it out of the key');
}

console.log('The attempt\'s copy: shuffled around information items; options keep their original index');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const qd = [{ id: 'A', type: 'mcq', options: ['w', 'x', 'y', 'z'], correctAnswer: 2 }, { id: 'I', type: 'info', text: 'Section B' },
    { id: 'B', type: 'tf', correctAnswer: true }, { id: 'C', type: 'multi', options: ['p', 'q', 'r'], correctAnswer: [1] },
    { id: 'D', type: 'match', pairs: [{ prompt: '1', answer: 'one' }, { prompt: '2', answer: 'two' }, { prompt: '3', answer: 'three' }] }];
  const plain = E.attemptQuestions(qd, {});
  assertEq(plain.map(q => q.id), ['A', 'I', 'B', 'C', 'D'], 'unshuffled: the order staff set');
  assert(plain.every(q => !q.optionOrder), 'and no option order recorded');
  const sh = E.attemptQuestions(qd, { shuffleQuestions: true, shuffleOptions: true, random: rnd });
  assertEq(sh[1].id, 'I', 'the information item stays where staff put it');
  assertEq(sh.map(q => q.id).sort().join(), 'A,B,C,D,I', 'every question is still there');
  const a = sh.find(q => q.id === 'A');
  assertEq(a.optionOrder.slice().sort().join(), '0,1,2,3', 'the option order is a shuffle of the original indexes');
  assert(sh.every(q => !('correctAnswer' in q)), 'no keys');
  const order = sh.map(q => q.id);
  const answers = sh.map(q => q.id === 'A' ? 2 : q.id === 'B' ? true : q.id === 'C' ? [1] : q.id === 'D' ? ['one', 'two', 'three'] : null);
  const m = E.mark(sh, answers, qd);
  assertEq(m.earnedPoints, 0, 'points default to 0 when none are set');
  assertEq(m.correctCount, 4, 'answers recorded by the original index are right whatever order they were shown in');
  assertEq(m.gradedResults.find(r => r.questionId === 'A').optionOrder, a.optionOrder, 'the result remembers the order shown');
  assertEq(order.indexOf('I'), 1, '(the information item was not moved)');
}

console.log('Paging, numbering, answered states, marks');
{
  assertEq(E.pagesOf(new Array(11), 3), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10]], 'three to a page');
  assertEq(E.pagesOf(new Array(4), 0), [[0, 1, 2, 3]], '0: every question on one page (every exam saved before paging)');
  assertEq(E.pagesOf(new Array(4), undefined), [[0, 1, 2, 3]], 'unset: the same');
  assertEq(E.pagesOf(new Array(4), 10), [[0, 1, 2, 3]], 'more per page than questions: one page');
  assertEq(E.pagesOf([], 3), [[]], 'an empty paper is one empty page');
  assertEq(E.questionNumbers([{ type: 'mcq' }, { type: 'info' }, { type: 'tf' }, { type: 'short' }]), [1, 'i', 2, 3], 'information is "i" and takes no number');
  const m = { type: 'match', rows: ['a', 'b', 'c'] };
  assertEq([E.answerState(m, null), E.answerState(m, [null, 'x', null]), E.answerState(m, ['x', 'y', 'z'])], ['none', 'partial', 'complete'], 'matching: not answered / incomplete / answered');
  assertEq([E.answerState({ type: 'multi' }, []), E.answerState({ type: 'multi' }, [2])], ['none', 'complete'], 'multi: nothing ticked is not answered');
  assertEq([E.answerState({ type: 'short' }, '   '), E.answerState({ type: 'short' }, 'x')], ['none', 'complete'], 'text: blank is not answered');
  assertEq([E.answerState({ type: 'tf' }, false), E.answerState({ type: 'mcq' }, 0)], ['complete', 'complete'], 'False and option A are answers');
  assertEq(E.answerState({ type: 'info' }, null), 'info', 'information is neither');
  assertEq([E.formatMark(1.5), E.formatMark(2), E.formatMark(2 / 3 * 3), E.formatMark('x')], ['1.50', '2.00', '2.00', '0.00'], 'marks are written 1.50');
}

console.log('An exam may set its own closing time; without one nothing changes');
{
  const JM = (d, t) => Date.parse(d + 'T' + t + ':00-05:00');
  const base = { date: '2026-10-19', time: '09:00', duration: 45, status: 'upcoming', questionData: [{ id: 'x', type: 'tf', correctAnswer: true }] };
  assertEq(E.windowOf(base), { start: JM('2026-10-19', '09:00'), end: JM('2026-10-19', '09:45') }, 'no closing time: open for its duration (as before)');
  const wk = Object.assign({}, base, { closeDate: '2026-10-23', closeTime: '17:00' });
  assertEq(E.windowOf(wk).end, JM('2026-10-23', '17:00'), 'with one: open until then');
  assertEq(E.statusAt(wk, JM('2026-10-21', '12:00')), 'active', 'open on the Wednesday');
  assertEq(E.statusAt(wk, JM('2026-10-23', '17:01')), 'completed', 'closed after Friday 17:00');
  assertEq(E.sessionDeadline(wk, JM('2026-10-21', '12:00')), JM('2026-10-21', '12:45'), 'each attempt still has its 45-minute limit');
  assertEq(E.sessionDeadline(wk, JM('2026-10-23', '16:40')), JM('2026-10-23', '17:00'), 'and a late starter stops when the exam closes');
  const bad = Object.assign({}, base, { closeDate: '2026-10-18', closeTime: '09:00' });
  assertEq(E.windowOf(bad).end, JM('2026-10-19', '09:45'), 'a closing time before the opening is ignored, never closing the exam before it starts');
  const act = Object.assign({}, wk, { activatedAt: '2026-10-24T15:00:00.000Z' });
  assertEq(E.windowOf(act).end, Date.parse('2026-10-24T15:45:00.000Z'), 'activating it later still opens a fresh window of its duration');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
