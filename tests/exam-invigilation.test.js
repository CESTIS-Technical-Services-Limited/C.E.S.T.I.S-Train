/* The exam invigilator: what a trainee's attempt records of WHEN things
   happened, how two copies of it merge, the live board staff watch, a
   trainee's timeline, the sitting's attendance register, and who may open it.

   The owner's request: "I want a exam invigilator page, so that
   administrative staff can track when individuals start their assessments
   and begin each page and questions in real time, which produces a register
   of attendance for trainees. Invigilator see when each trainee complete
   their assessment."

   There was nothing to pin before: the attempt record held answers and when
   each last changed, but not when a trainee started on another device, opened
   a page, first reached or answered a question, left the test window or lost
   the connection — and no register of a sitting existed. These pin the new
   rules (CESTISCore.exams activity + CESTISCore.invigilation, both builds):
     - the activity is append-only and never holds an answer; a first time is
       never replaced by a later one; it stays small for a 100-question test
       (a device lists 20 of each repeatable moment, then only counts them);
     - two copies merge without losing a moment: the union of moments by id,
       the earliest first times (by question id, so shuffled copies agree),
       the larger counts — the same whichever way round, and merging again
       changes nothing; a copy saved before activity existed is unchanged;
     - a submission keeps the moments (the retired record carries them; a
       stale open copy's moments are added, never the other way about), and
       14 days on only their counts are kept;
     - the board: Not started / In progress (Page 2 of 4 · Question 4, 3 of 10
       answered, time left) / Submitted (how, late) / Absent once the test has
       closed; how fresh each row is; "No update for 3 min" for a silent
       attempt; the live word from a trainee's computer is used only when it
       is newer than the record and for that attempt; a sitting over several
       days puts an attempt in its own day's register;
     - the timeline in words, with times;
     - the register: Present — completed / did not finish / Absent; notes kept
       when it is refreshed; a signed register never rewritten; CSV safe for
       spreadsheets; two invigilators' notes and sign-offs both kept on the
       online merge and the Centre-network merge; "Add to the day's attendance"
       proposes, ticking only unmarked trainees who sat;
     - who may open it: administrators and instructors always (an instructor
       for their own programmes' exams), Admin Staff only with the new
       "Exam invigilation" tick, which is off by default.

   Run: node tests/exam-invigilation.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const J = v => JSON.stringify(v);
const SEC = 1000, MIN = 60000;
const T0 = Date.parse('2026-10-28T14:00:00.000Z');   // 09:00 Centre time (Jamaica, -05:00)

// The exam platform's paper: 11 items, three to a page, one information item (index 6).
const QS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'I1', 'Q7', 'Q8', 'Q9', 'Q10'].map(id => ({ id: id, type: id === 'I1' ? 'info' : 'mcq', options: ['a', 'b'], points: id === 'I1' ? 0 : 1 }));

[['cestis-core.js', require('../cestis-core.js')],
 ['Offline System/cestis-core.js', require('../Offline System/cestis-core.js')]].forEach(([where, Core]) => {
  const X = Core.exams, V = Core.invigilation;
  console.log('\n[' + where + ']');
  const lay = X.activityLayout(QS, 3);
  function attempt(over) {
    return Object.assign({
      id: 'ATT-1', examId: 'EXAM-WS3', studentId: 'STU-TR', studentName: 'Tameka Richards', title: 'Welding Safety', duration: 60,
      questions: QS.map(q => Object.assign({}, q)), answers: QS.map(() => null), flagged: QS.map(() => false),
      answeredAt: QS.map(() => 0), flaggedAt: QS.map(() => 0), startTime: T0, deadline: T0 + 60 * MIN, perPage: 3, page: 0, current: 0, posAt: T0,
      status: 'open', updatedAt: new Date(T0).toISOString(), savedAt: new Date(T0).toISOString()
    }, over || {});
  }
  // A device's moments, as index.html writes them: ids begin with the device's code.
  let seq = 0;
  const ev = (dev, k, t, more) => Object.assign({ id: dev + '.' + (++seq) + '.' + t.toString(36), k: k, t: t }, more || {});

  console.log('The activity holds times, never an answer, and a first time is never replaced');
  let a = X.activityNote({ v: 1, lay: lay }, ev('PC1', 'start', T0, { d: 'Computer · PC1' }));
  a = X.activityMark(a, 'pages', 0, T0 + 1 * SEC);
  a = X.activityMark(a, 'seen', 0, T0 + 2 * SEC);
  a = X.activityMark(a, 'seen', 0, T0 + 90 * SEC);
  a = X.activityMark(a, 'first', 0, T0 + 20 * SEC);
  a = X.activityMark(a, 'first', 0, T0 + 200 * SEC);
  assertEq([a.pages, a.seen, a.first], [[T0 + 1 * SEC], [T0 + 2 * SEC], [T0 + 20 * SEC]], 'the first page, question and answer times stand');
  assertEq(a.lay, { n: 11, per: 3, info: [6] }, 'the paper\'s shape: 11 items, three to a page, the information item at 7th place');
  const dirty = X.activityOf({ v: 1, ev: [{ id: 'x', k: 'start', t: T0, answer: 'Red', d: 'PC' }, { id: 'y', k: 'answer', t: T0, value: 'B' }, { k: 'left', t: T0 }],
    seen: [T0, 'nope', -5], extra: 'secret' });
  assertEq(dirty, { v: 1, seen: [T0], ev: [{ id: 'x', k: 'start', t: T0, d: 'PC' }] }, 'unknown fields, kinds and malformed moments are left out (no answer can ride along)');
  assertEq(X.activityOf(null), null, 'no activity is null');
  const a2 = X.activityNote(a, a.ev[0]);
  assertEq(a2.ev.length, 1, 'the same moment twice is listed once');

  console.log('It stays small: 200 trips out of the test window, and a 100-question test');
  let busy = X.activityNote(null, ev('PC1', 'start', T0, { d: 'Computer · PC1' }));
  let t = T0;
  for (let i = 0; i < 200; i++) {
    const left = ev('PC1', 'left', t += 30 * SEC, { why: 'hidden' });
    busy = X.activityNote(busy, left);
    busy = X.activityNote(busy, ev('PC1', 'back', t += 10 * SEC, { of: left.id, ms: 10 * SEC }));
  }
  const listedLeft = busy.ev.filter(e => e.k === 'left').length, listedBack = busy.ev.filter(e => e.k === 'back').length;
  assertEq([listedLeft, listedBack], [20, 20], 'one device lists 20 trips (and their returns), then counts the rest');
  assertEq(busy.more.PC1, { left: 180, away: 180 * 10 * SEC }, 'the rest are counted, not listed');
  let sum = X.activitySummary({ activity: busy });
  assertEq([sum.left, sum.awayMs, sum.awaySince], [200, 200 * 10 * SEC, 0], 'and the board still says 200 times, 33 min 20 s in all, back now');
  const big = Array.from({ length: 100 }, (_, i) => ({ id: 'B' + i, type: 'mcq' }));
  let huge = X.activityNote({ v: 1, lay: X.activityLayout(big, 10) }, ev('PC1', 'start', T0, { d: 'Computer · PC1' }));
  for (let i = 0; i < 100; i++) {
    huge = X.activityMark(huge, 'seen', i, T0 + i * 20 * SEC);
    huge = X.activityMark(huge, 'first', i, T0 + i * 20 * SEC + 9 * SEC);
    if (i % 10 === 0) huge = X.activityMark(huge, 'pages', i / 10, T0 + i * 20 * SEC);
    huge = X.activityNote(huge, ev('PC1', 'flag', T0 + i * 20 * SEC + 5 * SEC, { q: i, on: true }));
  }
  for (let i = 0; i < 100; i++) { const l = ev('PC1', 'left', T0 + 3000 * SEC + i * 60 * SEC); huge = X.activityNote(huge, l); huge = X.activityNote(huge, ev('PC1', 'back', T0 + 3000 * SEC + i * 60 * SEC + 5 * SEC, { of: l.id, ms: 5 * SEC })); }
  const size = J(huge).length;
  assert(size < 8000, 'a 100-question test answered throughout, 100 flags and 100 trips out: ' + size + ' bytes of activity (under 8 KB)');
  assert(X.activityNote(huge, ev('PC1', 'flag', T0 + 9e6, { q: 1 })).ev.length === huge.ev.length, 'a 21st flag is counted, not listed');

  console.log('Two copies merge without losing a moment, the same either way round');
  const pc1 = X.activityNote(X.activityMark(X.activityMark({ v: 1, lay: lay }, 'seen', 3, T0 + 5 * MIN), 'pages', 1, T0 + 5 * MIN), ev('PC1', 'start', T0, { d: 'Computer · PC1' }));
  // PC 2's copy came from an older share of PC 1's (the start only), and reached question 4 earlier.
  let pc2 = X.activityMark(X.activityMark(X.activityMark({ v: 1, lay: lay, ev: pc1.ev.slice() }, 'seen', 3, T0 + 2 * MIN), 'seen', 4, T0 + 12 * MIN), 'first', 4, T0 + 13 * MIN);
  pc2 = X.activityNote(pc2, ev('PC2', 'resume', T0 + 11 * MIN, { d: 'Phone · PH22' }));
  const m1 = X.mergeActivity(pc1, pc2, null, true), m2 = X.mergeActivity(pc2, pc1, null, true);
  assertEq(m1, m2, 'merge(a, b) is merge(b, a)');
  assertEq(X.mergeActivity(m1, m1, null, true), m1, 'and merging again changes nothing');
  assertEq(m1.ev.map(e => e.k), ['start', 'resume'], 'every moment of both: the start on PC 1, the carrying on on the phone');
  assertEq([m1.seen[3], m1.seen[4], m1.first[4], m1.pages[1]], [T0 + 2 * MIN, T0 + 12 * MIN, T0 + 13 * MIN, T0 + 5 * MIN], 'each first time is the earliest either copy saw');
  sum = X.activitySummary({ activity: m1 });
  assert(sum.moved && sum.devices.length === 2 && sum.device === 'Computer · PC1', 'carried on on another device: the board says so');

  console.log('Inside the attempt: merged question by question with the answers, and old copies are untouched');
  const old1 = attempt(), old2 = attempt({ answers: [0].concat(QS.slice(1).map(() => null)), answeredAt: [T0 + MIN].concat(QS.slice(1).map(() => 0)) });
  const oldMerged = X.mergeAttempt(old1, old2);
  assert(!('activity' in oldMerged), 'two copies saved before activity existed merge exactly as before (no activity appears)');
  const c1 = attempt({ activity: pc1 }), c2 = attempt({ activity: pc2, answers: [1].concat(QS.slice(1).map(() => null)), answeredAt: [T0 + 3 * MIN].concat(QS.slice(1).map(() => 0)) });
  const both = X.mergeAttempt(c1, c2);
  assertEq(both.activity, m1, 'two copies of one attempt: the activity is the union');
  assertEq(both.answers[0], 1, 'and the answers still merge by their own rule');
  // A second PC that started before it heard of the first: its paper shuffled differently.
  const rev = QS.slice().reverse();
  const late = attempt({ id: 'ATT-2', startTime: T0 + 2 * MIN, questions: rev.map(q => Object.assign({}, q)),
    activity: X.activityMark(X.activityNote({ v: 1, lay: X.activityLayout(rev, 3) }, ev('PC3', 'start', T0 + 2 * MIN, { d: 'Computer · PC3' })), 'seen', 10, T0 + 3 * MIN) });
  const folded = X.attemptFor([c1, late], 'STU-TR', 'EXAM-WS3').attempt;
  assertEq(folded.activity.seen[0], T0 + 3 * MIN, 'shuffled copies line up by question id: Q1 (last on PC 3\'s paper) was first reached at 09:03');
  assertEq(folded.activity.ev.map(e => e.k), ['start', 'start'], 'both starts are kept');

  console.log('A submission keeps the moments; a stale open copy adds its own, never the other way about');
  const sub = X.activityNote(m1, ev('PH22', 'submit', T0 + 40 * MIN, { how: 'trainee' }));
  const retired = X.retireAttempt(attempt({ activity: sub }), 'RES-1', new Date(T0 + 40 * MIN).toISOString());
  assert(retired.status === 'submitted' && !retired.answers && !retired.questions, 'the retired record still carries no answers and no paper');
  assertEq(retired.activity.ev.map(e => e.k), ['start', 'resume', 'submit'], 'but it keeps when things happened');
  assert(!('activity' in X.retireAttempt(attempt(), 'RES-0')), 'an attempt with no activity retires exactly as before');
  const staleOpen = attempt({ activity: X.activityNote(X.activityOf(pc1), ev('PC1', 'left', T0 + 30 * MIN, { why: 'hidden' })) });
  const settled = X.mergeAttempt(staleOpen, retired), settled2 = X.mergeAttempt(retired, staleOpen);
  assert(X.attemptIsRetired(settled) && X.attemptIsRetired(settled2), 'the submitted record still beats a stale open copy');
  assertEq(settled.activity.ev.map(e => e.k), ['start', 'resume', 'left', 'submit'], 'and the stale copy\'s moment (PC 1 left the window at 09:30) is added');
  assertEq(settled, settled2, 'the same either way round');
  const r2 = X.retireAttempt(attempt({ activity: X.activityNote(X.activityOf(pc1), ev('PC1', 'submit', T0 + 45 * MIN, { how: 'time' })) }), 'RES-2', new Date(T0 + 45 * MIN).toISOString());
  const twice = X.mergeAttempt(r2, retired);
  assert(twice.resultId === 'RES-1', 'of two submissions the first stands');
  assertEq(twice.activity.ev.filter(e => e.k === 'submit').length, 2, 'and both submissions are on the record');
  const viaSettle = [attempt({ activity: pc1 })];
  X.settleAttempts(viaSettle, [{ id: 'RES-9', examId: 'EXAM-WS3', studentId: 'STU-TR', submittedAt: new Date(T0 + 50 * MIN).toISOString() }]);
  assertEq(viaSettle[0].activity.ev.map(e => e.k), ['start'], 'an attempt settled by a result keeps its moments too');

  console.log('Fourteen days after the submission only the counts are kept');
  const lists = X.mergeAttemptLists([retired, attempt({ id: 'ATT-OPEN', activity: pc1 })], [], { nowMs: T0 + 15 * 24 * 3600 * SEC });
  const small = lists.list.find(r => r.id === 'ATT-1');
  assert(lists.changed && !small.activity.ev && !small.activity.seen && small.activity.sum, 'the retired record keeps only the counts (' + J(small.activity) + ')');
  sum = X.activitySummary(small);
  assert(sum.moved && sum.device === 'Computer · PC1' && sum.submit && sum.submit.how === 'trainee' && sum.seen === 2,
    'which still say where it started, that it moved, how it was submitted and how many questions were reached');
  assertEq(lists.list.find(r => r.id === 'ATT-OPEN').activity, X.activityOf(pc1), 'an open attempt is never trimmed');
  const young = X.mergeAttemptLists([retired], [], { nowMs: T0 + 2 * 24 * 3600 * SEC });
  assert(!young.changed && young.list[0].activity.ev.length === 3, 'two days on, everything is still there');
  const again = X.mergeAttemptLists(lists.list, [retired], { nowMs: T0 + 15 * 24 * 3600 * SEC });
  assert(!again.list.find(r => r.id === 'ATT-1').activity.ev, 'a device still holding the full copy does not bring it back');

  console.log('The summary: away now, time away, the connection, the last moment');
  let s1 = X.activityNote(null, ev('PC1', 'start', T0, { d: 'Computer · PC1' }));
  const l1 = ev('PC1', 'left', T0 + 10 * MIN, { why: 'hidden' });
  s1 = X.activityNote(X.activityNote(s1, l1), ev('PC1', 'back', T0 + 10 * MIN + 100 * SEC, { of: l1.id, ms: 100 * SEC }));
  const off1 = ev('PC1', 'offline', T0 + 15 * MIN);
  s1 = X.activityNote(X.activityNote(s1, off1), ev('PC1', 'online', T0 + 17 * MIN, { of: off1.id, ms: 2 * MIN }));
  const l2 = ev('PC1', 'left', T0 + 20 * MIN, { why: 'blur' });
  s1 = X.activityNote(s1, l2);
  sum = X.activitySummary({ activity: s1, startTime: T0, answeredAt: [T0 + 19 * MIN], posAt: T0 + 18 * MIN });
  assertEq([sum.left, sum.awayMs, sum.awaySince, sum.offline, sum.offlineMs, sum.lastAt], [2, 100 * SEC, T0 + 20 * MIN, 1, 2 * MIN, T0 + 20 * MIN],
    'left twice (1 min 40 s back), away now since 09:20, the connection lost once for 2 min');
  const s1sub = X.activityNote(s1, ev('PC1', 'submit', T0 + 25 * MIN, { how: 'away', late: true }));
  sum = X.activitySummary({ activity: s1sub });
  assertEq([sum.awaySince, sum.awayMs, sum.submit.how, sum.submit.late], [0, 100 * SEC + 5 * MIN, 'away', true], 'a submission ends the time away');

  console.log('The board: every status, with times');
  const OFF = '-05:00';
  const exam = { id: 'EXAM-WS3', title: 'Welding Safety — Unit 3 Assessment', course: 'Welding & Fabrication', date: '2026-10-28', time: '09:00', duration: 60,
    status: 'active', questionData: QS, questionsPerPage: 3 };
  const roll = [
    { id: 'STU-TR', name: 'Tameka Richards', course: 'Welding & Fabrication', stage: 'training' },
    { id: 'STU-KJ', name: 'Kemar Johnson', course: 'Welding & Fabrication', stage: 'training' },
    { id: 'STU-SB', name: 'Shanice Brown', course: 'Welding & Fabrication', stage: 'training' },
    { id: 'STU-DC', name: 'Devon Campbell', course: 'Welding & Fabrication', stage: 'training' },
    { id: 'STU-AW', name: 'Andre Williams', course: 'Electrical Installation', stage: 'training' },
    { id: 'STU-OG', name: 'Old Graduate', course: 'Welding & Fabrication', stage: 'certified' }
  ];
  const now = T0 + 30 * MIN;
  const tamekaAct = X.activityMark(X.activityMark(X.activityMark(X.activityNote({ v: 1, lay: lay }, ev('PC1', 'start', T0 + 3 * MIN, { d: 'Computer · PC1' })), 'pages', 0, T0 + 3 * MIN), 'pages', 1, T0 + 20 * MIN), 'seen', 3, T0 + 20 * MIN);
  const tameka = attempt({ id: 'ATT-TR', startTime: T0 + 3 * MIN, deadline: T0 + 63 * MIN, page: 1, current: 3, posAt: T0 + 20 * MIN,
    answers: [0, true, 1, null, null, null, null, null, null, null, null], answeredAt: [T0 + 5 * MIN, T0 + 6 * MIN, T0 + 7 * MIN, 0, 0, 0, 0, 0, 0, 0, 0],
    savedAt: new Date(now - 25 * SEC).toISOString(), activity: tamekaAct });
  const kemar = attempt({ id: 'ATT-KJ', studentId: 'STU-KJ', studentName: 'Kemar Johnson', startTime: T0 + 4 * MIN, savedAt: new Date(now - 4 * MIN).toISOString(),
    activity: X.activityNote(null, ev('PC2', 'start', T0 + 4 * MIN, { d: 'Computer · PC2' })) });
  const devonRetired = X.retireAttempt({ id: 'ATT-DC', examId: 'EXAM-WS3', studentId: 'STU-DC', startTime: T0 + 2 * MIN, deadline: T0 + 62 * MIN,
    activity: X.activityNote(X.activityNote(null, ev('PC4', 'start', T0 + 2 * MIN, { d: 'Computer · PC4' })), ev('PC4', 'submit', T0 + 28 * MIN, { how: 'trainee' })) }, 'RES-DC', new Date(T0 + 28 * MIN).toISOString());
  const devonResult = { id: 'RES-DC', examId: 'EXAM-WS3', studentId: 'STU-DC', studentName: 'Devon Campbell', submittedAt: new Date(T0 + 28 * MIN).toISOString(),
    startedAt: new Date(T0 + 2 * MIN).toISOString(), timeTaken: 26 * 60, totalQuestions: 10, answers: QS.filter(q => q.type !== 'info').map((q, i) => ({ questionId: q.id, studentAnswer: i < 9 ? 0 : null })) };
  const match = (x, y) => String(x).toLowerCase() === String(y).toLowerCase();
  const who = V.rollFor(exam, roll, [tameka, kemar, devonRetired], [devonResult], { match });
  assertEq(who.map(s => s.name), ['Devon Campbell', 'Kemar Johnson', 'Shanice Brown', 'Tameka Richards'],
    'expected: the programme\'s trainees in training, by name (not another programme, not a graduate)');
  const B = V.board(exam, { students: who, attempts: [tameka, kemar, devonRetired], results: [devonResult], now, offset: OFF });
  const row = n => B.rows.find(r => r.name === n);
  assertEq(B.counts, { expected: 4, started: 3, inProgress: 2, submitted: 1, notStarted: 1, absent: 0, otherDay: 0, attention: 1 }, 'the counts at the top');
  const tr = row('Tameka Richards');
  assertEq([tr.status, tr.pageNo, tr.pageCount, tr.qLabel, tr.answered, tr.total], ['in-progress', 2, 4, '4', 3, 10], 'Tameka: In progress, Page 2 of 4 · Question 4, 3 of 10 answered');
  assertEq([tr.timeLeftMs, V.clock(tr.startedAt, OFF), tr.asOf], [33 * MIN, '09:03', now - 25 * SEC], 'with 33 min left, started 09:03, the copy here as of 25 s ago');
  assertEq(V.ago(now - tr.asOf), '25 s ago', '"updated 25 s ago"');
  assertEq(tr.lastActivityAt, T0 + 20 * MIN, 'her last moment: opening page 2 at 09:20');
  const kj = row('Kemar Johnson');
  assert(kj.warnings.some(w => w.k === 'silent' && w.level === 'alert' && /No update for 4 min — the connection may be lost/.test(w.text)), 'Kemar: "No update for 4 min — the connection may be lost"');
  const dc = row('Devon Campbell');
  assertEq([dc.status, dc.how, V.clock(dc.submittedAt, OFF), dc.answered, dc.total, dc.timeTakenSec], ['submitted', 'trainee', '09:28', 9, 10, 1560], 'Devon: submitted by himself at 09:28, 9 of 10 answered');
  assertEq(row('Shanice Brown').status, 'not-started', 'Shanice: not started (the test is still open)');
  const closed = V.board(Object.assign({}, exam, { status: 'completed' }), { students: who, attempts: [tameka, kemar, devonRetired], results: [devonResult], now: T0 + 70 * MIN, offset: OFF });
  assertEq(closed.rows.find(r => r.name === 'Shanice Brown').status, 'absent', 'once the test has closed, Shanice is Absent');
  assert(closed.rows.find(r => r.name === 'Tameka Richards').timeUp, 'and an attempt still open past its deadline says the time is up');
  // Devon's result has not reached this PC yet: his retired record has.
  const pend = V.board(exam, { students: who, attempts: [tameka, kemar, devonRetired], results: [], now, offset: OFF }).rows.find(r => r.name === 'Devon Campbell');
  assert(pend.status === 'submitted' && pend.resultPending && pend.warnings.some(w => w.k === 'pending'), 'submitted elsewhere, the result still on its way: Submitted, and it says so');
  // The live word from Tameka's computer, newer than the record.
  const pulse = { attemptId: 'ATT-TR', examId: 'EXAM-WS3', studentId: 'STU-TR', at: now - 2 * SEC, page: 2, pages: 4, q: '7', answered: 5, total: 10, deadline: T0 + 63 * MIN, startTime: T0 + 3 * MIN,
    last: now - 2 * SEC, activity: X.activityMark(tamekaAct, 'pages', 2, now - 3 * SEC) };
  let L = V.board(exam, { students: who, attempts: [tameka, kemar, devonRetired], results: [devonResult], now, offset: OFF, live: { 'STU-TR': { p: pulse, rcv: now - 2 * SEC } } }).rows.find(r => r.name === 'Tameka Richards');
  assertEq([L.pageNo, L.qLabel, L.answered, L.asOf, L.live], [3, '7', 5, now - 2 * SEC, true], 'the live word moves her row at once: Page 3 · Question 7, 5 answered, as of 2 s ago');
  L = V.board(exam, { students: who, attempts: [tameka], results: [], now, offset: OFF, live: { 'STU-TR': { p: Object.assign({}, pulse, { attemptId: 'ATT-FORGED' }), rcv: now } } }).rows.find(r => r.name === 'Tameka Richards');
  assertEq(L.pageNo, 2, 'a live word about another attempt is not believed');
  L = V.board(exam, { students: who, attempts: [], results: [], now, offset: OFF, live: { 'STU-SB': { p: Object.assign({}, pulse, { studentId: 'STU-SB', attemptId: 'ATT-SB' }), rcv: now } } }).rows.find(r => r.name === 'Shanice Brown');
  assert(L.status === 'in-progress' && L.pageNo === 3, 'a trainee who has just started shows In progress before her record arrives');
  // A sitting over several days.
  const week = Object.assign({}, exam, { closeDate: '2026-10-30', closeTime: '17:00' });
  const thu = attempt({ id: 'ATT-KJ2', studentId: 'STU-KJ', startTime: T0 + 24 * 3600 * SEC, activity: X.activityNote(null, ev('PC2', 'start', T0 + 24 * 3600 * SEC, { d: 'Computer · PC2' })) });
  const WB = V.board(week, { students: who, attempts: [tameka, thu], results: [], now: T0 + 25 * 3600 * SEC, offset: OFF, date: '2026-10-28' });
  assertEq(WB.dates, ['2026-10-28', '2026-10-29'], 'an exam open all week: the days somebody sat it');
  assertEq(WB.rows.find(r => r.name === 'Kemar Johnson').status, 'other-day', 'Kemar sat on Thursday: not on Wednesday\'s register');
  assertEq(V.sortRows(B.rows, 'status').map(r => r.name), ['Kemar Johnson', 'Tameka Richards', 'Shanice Brown', 'Devon Campbell'], 'sorted by status: in progress first');
  assertEq(V.filterRows(B.rows, 'attention').map(r => r.name), ['Kemar Johnson'], '"Needs attention" shows the silent one');

  console.log('The timeline, in words, with times');
  const tl = V.timeline(V.board(exam, { students: who, attempts: [Object.assign({}, tameka, { activity: s1sub.ev ? X.mergeActivity(tamekaAct, X.activityMark(s1sub, 'first', 7, T0 + 21 * MIN), null, true) : tamekaAct })], results: [], now, offset: OFF }).rows.find(r => r.name === 'Tameka Richards'), OFF);
  const words = tl.map(x => x.time + ' ' + x.text);
  assert(words.indexOf('09:00:00 Started the test on Computer · PC1') !== -1 && words.indexOf('09:20:00 Opened page 2 of 4') !== -1, 'started on her PC; opened page 2 of 4 (' + words.slice(0, 4).join(' | ') + ')');
  assert(words.indexOf('09:20:00 Began question 4') !== -1 && words.indexOf('09:21:00 Answered question 7') !== -1, 'began question 4; answered question 7 (the 8th item: the information item takes no number)');
  assert(words.indexOf('09:11:40 Came back to the test after 1 min 40 s') !== -1 && words.indexOf('09:17:00 Connection back after 2 min') !== -1, 'came back after 1 min 40 s; the connection back after 2 min');
  assert(words.indexOf('09:25:00 Submitted automatically: the time ran out while away from the test (after the test closed)') !== -1, 'and how it was submitted');
  assert(tl.every((x, i) => !i || tl[i - 1].t <= x.t), 'oldest first');
  const devTl = V.timeline(dc, OFF).map(x => x.text);
  assertEq(devTl, ['Started the test on Computer · PC4', 'Submitted the test'], 'a submitted trainee\'s timeline comes from the retired record');
  assertEq([V.duration(100 * SEC), V.duration(45 * SEC), V.duration(4000 * SEC), V.ago(2 * SEC), V.ago(3 * MIN)], ['1 min 40 s', '45 s', '1 h 6 min', 'just now', '3 min ago'], 'times said plainly');

  console.log('The register: produced from the board, noted, signed, exported');
  let reg = V.registerFrom(closed, exam, { now: T0 + 71 * MIN, byName: 'Marcia Thompson' });
  assertEq(reg.id, 'XREG-EXAM-WS3-2026-10-28', 'one register per sitting');
  assertEq(reg.rows.map(r => r.name + ': ' + V.statusText(r)), ['Devon Campbell: Present — completed', 'Kemar Johnson: Present — did not finish', 'Shanice Brown: Absent', 'Tameka Richards: Present — did not finish'],
    'Present — completed / Present — did not finish / Absent');
  assertEq(reg.counts, { expected: 4, present: 3, completed: 1, unfinished: 2, absent: 1 }, 'with its counts');
  assertEq(reg.rows.find(r => r.name === 'Devon Campbell').spentSec, 1560, 'time spent from the result');
  const midReg = V.registerFrom(B, exam, { now: now, byName: 'Marcia Thompson' });
  assertEq(midReg.rows.map(r => r.status), ['completed', 'sitting', 'not-started', 'sitting'], 'made while the test is open: still sitting, not "did not finish"; not started yet, not absent');
  assertEq(midReg.counts.present, 3, 'those still sitting are present');
  reg.notes['STU-SB'] = { text: '=HYPERLINK("x") arrived late, sent home', by: 'USR-MT', byName: 'Marcia Thompson' };
  reg.noteAt['STU-SB'] = new Date(T0 + 72 * MIN).toISOString();
  const refreshed = V.registerFrom(closed, exam, { now: T0 + 75 * MIN, existing: reg, byName: 'Marcia Thompson' });
  assertEq(refreshed.notes, reg.notes, 'a note is kept when the register is refreshed from the board');
  assertEq(refreshed.producedAt, reg.producedAt, 'and so is when it was first produced');
  reg = refreshed;
  reg.signoff['USR-MT'] = { name: 'Marcia Thompson' };
  reg.signoffAt['USR-MT'] = new Date(T0 + 76 * MIN).toISOString();
  assertEq(V.registerFrom(B, exam, { now: T0 + 90 * MIN, existing: reg }), reg, 'a signed register is never rewritten from the board');
  const csv = V.registerCsv(reg, OFF);
  assert(csv.charCodeAt(0) === 0xfeff && /"Signed off","Marcia Thompson at 10:16 on 2026-10-28"/.test(csv), 'the CSV opens in a spreadsheet and says who signed it off, when');
  assert(/"Devon Campbell","STU-DC","Welding & Fabrication","Present — completed","09:02","09:28","26 min","By the trainee","","",""/.test(csv), 'a row per trainee: ' + csv.split('\r\n')[8]);
  assert(csv.indexOf('"\'=HYPERLINK(""x"") arrived late, sent home"') !== -1, 'a note that looks like a formula is made safe for spreadsheets');

  console.log('"Add to the day\'s attendance" proposes; staff confirm');
  const marks = { 'STU-KJ': 'late' };
  const prop = V.attendanceProposal(reg, sid => marks[sid] || '');
  assertEq(prop.map(p => [p.name, p.status, p.current, p.tick]), [
    ['Devon Campbell', 'present', '', true], ['Kemar Johnson', 'present', 'late', false], ['Shanice Brown', 'absent', '', false], ['Tameka Richards', 'present', '', true]],
    'Present for those who sat; a trainee already marked is not ticked; an absence is offered unticked');

  console.log('Two invigilators at once: both keep what they wrote');
  const base = V.registerFrom(closed, exam, { now: T0 + 71 * MIN, byName: 'Marcia Thompson' });
  const pcA = JSON.parse(J(base)), pcB = JSON.parse(J(base));
  pcA.notes['STU-SB'] = { text: 'Phoned in sick', byName: 'Marcia Thompson' }; pcA.noteAt['STU-SB'] = new Date(T0 + 80 * MIN).toISOString(); pcA.updatedAt = new Date(T0 + 80 * MIN).toISOString();
  pcB.notes['STU-KJ'] = { text: 'PC 2 froze at 09:40', byName: 'Ian Instructor' }; pcB.noteAt['STU-KJ'] = new Date(T0 + 81 * MIN).toISOString();
  pcB.signoff['USR-II'] = { name: 'Ian Instructor' }; pcB.signoffAt['USR-II'] = new Date(T0 + 82 * MIN).toISOString(); pcB.updatedAt = new Date(T0 + 82 * MIN).toISOString();
  const onlineMerge = [JSON.parse(J(pcA))];
  Core.sync.mergeList(onlineMerge, [pcB], r => r.id, Core.sync.mapRules('examRegisters', { tombs: {} }));
  assertEq(Object.keys(onlineMerge[0].notes).sort(), ['STU-KJ', 'STU-SB'], 'online merge: both notes');
  assertEq(Object.keys(onlineMerge[0].signoff), ['USR-II'], 'and the sign-off');
  const PC = Core.pageCloud;
  assert(PC.isRecordKey('voctrain_examRegisters'), 'registers are a record collection on the Centre\'s network');
  let lm = PC.mergeKeys({ voctrain_examRegisters: J([pcB]) }, { voctrain_examRegisters: new Date(T0 + 90 * MIN).toISOString() },
    { voctrain_examRegisters: J([pcA]) }, { voctrain_examRegisters: new Date(T0 + 80 * MIN).toISOString() }, { records: true });
  const lanReg = JSON.parse(lm.data.voctrain_examRegisters)[0];
  assert(Object.keys(lanReg.notes).length === 2 && lanReg.signoff['USR-II'], 'the Centre\'s network: both notes and the sign-off');
  lm = PC.mergeKeys({ voctrain_examRegisters: J([pcB]) }, null, { voctrain_examRegisters: J([]) }, { voctrain_examRegisters: new Date(T0 + 99 * MIN).toISOString() }, { records: true });
  assertEq(JSON.parse(lm.data.voctrain_examRegisters).length, 1, 'a shorter list is never a deletion');
  // The attempts' activity on the Centre's network.
  lm = PC.mergeKeys({ voctrain_examAttempts: J([c1]) }, { voctrain_examAttempts: new Date(T0 + 60 * MIN).toISOString() },
    { voctrain_examAttempts: J([c2]) }, { voctrain_examAttempts: new Date(T0 + 30 * MIN).toISOString() }, { records: true });
  assertEq(JSON.parse(lm.data.voctrain_examAttempts)[0].activity, m1, 'the Centre\'s network merges attempts\' moments the same way');

  console.log('Who may open it, and which exams');
  assertEq(['admin', 'instructor', 'adminstaff', 'student', 'cmc', undefined].map(r => V.canOpen(r, {})), [true, true, false, false, false, false],
    'administrators and instructors; Admin Staff not without the tick; nobody else');
  assert(V.canOpen('adminstaff', { invigilation: true }) && !V.canOpen('adminstaff', { invigilation: 'yes' }), 'Admin Staff with "Exam invigilation" ticked');
  const EX = [exam, { id: 'EX-EL', title: 'Electrical Installation — Wiring Test', course: 'Electrical Installation', date: '2026-10-28', time: '13:00', duration: 45, questionData: QS },
    { id: 'EX-MINE', title: 'My own quiz', course: 'Cosmetology', createdBy: 'USR-II', date: '2026-10-27', time: '09:00', duration: 30, status: 'completed', questionData: QS },
    { id: 'EX-EMPTY', title: 'Not written yet', course: 'Welding & Fabrication', date: '2026-11-02', time: '09:00', duration: 30 }];
  assertEq(V.examsFor('admin', EX, { now, offset: OFF }).map(e => e.id), ['EXAM-WS3', 'EX-EL', 'EX-MINE'], 'an administrator: every exam that can be sat — open now first, then the next, then the finished');
  assertEq(V.examsFor('instructor', EX, { now, offset: OFF, courses: ['Welding & Fabrication'], match, userId: 'USR-II' }).map(e => e.id), ['EXAM-WS3', 'EX-MINE'],
    'an instructor: their programme\'s exams and the ones they set — not another programme\'s');
  assertEq(V.examsFor('student', EX, {}), [], 'a trainee: none');
});

console.log('\nThe page: the tick is off by default, and the page needs it');
{
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const grab = (a, b) => { const i = PAGE.indexOf(a); if (i < 0) throw new Error('index.html no longer declares ' + a); return PAGE.slice(i, PAGE.indexOf(b, i) + b.length); };
  const box = {};
  vm.createContext(box);
  vm.runInContext([grab('var AS_ACCESS_DEFAULTS = {', '};'), grab('var asAccessPages = [', '];'), grab('var AS_PAGE_PERMISSION = {', '};')].join('\n'), box);
  assert(box.AS_ACCESS_DEFAULTS.invigilation === false, 'Admin Staff\'s "Exam invigilation" is off until an Administrator ticks it');
  const tick = box.asAccessPages.find(p => p.key === 'invigilation');
  assert(tick && tick.label === 'Exam invigilation', 'the Settings grid offers the tick "Exam invigilation"');
  assert(box.AS_PAGE_PERMISSION['as-invigilator'] === 'invigilation', 'and the Admin Staff invigilator page is refused without it (showPage checks it)');
  assert(/function invigAllowed\(\)[\s\S]{0,400}CESTISCore\.invigilation\.canOpen\(currentRole/.test(PAGE), 'every role\'s page asks the one rule (CESTISCore.invigilation.canOpen)');
  assert(!/answers/.test(grab('function examLivePulseBody(', '\n}')), 'the live word a trainee\'s computer sends never names the answers');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
