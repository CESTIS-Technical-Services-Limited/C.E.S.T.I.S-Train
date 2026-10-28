/* What a trainee may send through the gate — and nothing else.

   Through the gate a trainee's device sends sealed items; the gatekeeper
   (and, again, the staff device that collects them) runs
   Core.gate.validateItem(item, me, slice) on every one, where `me` is the
   account and student ID from the session and `slice` the trainee's own
   published records. Today a trainee's device on the Centre's network may
   write ANY record key, the exam bank included (DESIGN.md §1.1); this is the
   rule that replaces that for the gate.

   Every row of DESIGN.md §5.2:
     - an attempt: theirs, open, at an exam they may sit, every question
       from that paper, each option order a true reordering, under 500 KB;
     - a submission: theirs, to an assignment of their programme, staff
       fields (grade, feedback…) stripped, files only their own uploads;
     - a certificate/transcript request: theirs; new ones pending; only
       their own pending request may be withdrawn;
     - a support message: from them, at most 4 KB of text;
     - a chat message: in a room of theirs, from them, at most 4 KB, no
       file except their own uploads;
     - their profile: their own key, allowed fields only, a photo under
       300 KB, a new name only as a request to the office;
     - read / clear / follow: a record in their slice, their own mark only;
     - a submit: as an attempt;
     - anything else — results, exams, the register, accounts, other
       trainees' records — refused as not theirs.
   Plus a fuzz: a valid item of every kind with any owner field turned into
   somebody else's is refused, every time; and random rubbish never throws.

   Run: node tests/gate-validate.test.js */
'use strict';

const Core = require('../cestis-core.js');
const { makeCentre, NOW } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate;
const C = makeCentre(Core);
const built = G.buildAll(C.store, NOW);
const T = C.trainees[0], OTHER = C.trainees[3], ELSEWHERE = C.trainees[1];   // OTHER: same programme; ELSEWHERE: another
const me = { acct: T.acct.id, stu: T.stu.id };
const slice = built.slices[T.acct.id].slice;
const papers = { EX1: built.papers.EX1.paper, 'EX1-OLD': built.papers['EX1-OLD'].paper, EX2: built.papers.EX2.paper };
const opts = { papers, ownUploads: ['UP-1'] };
const J = v => JSON.parse(JSON.stringify(v));
let n = 0;
const item = (kind, extra) => Object.assign({ id: 'IT-' + (++n), a: me.acct, sid: 'kx.abc.12345678', kind, createdAt: new Date(NOW).toISOString() }, extra);
const check = (it, o, sl) => G.validateItem(it, me, sl === undefined ? slice : sl, o || opts);
const reason = (it, o, sl) => { const r = check(it, o, sl); return r.ok ? 'ok' : r.reason; };

function attempt(over) {
  const qs = Core.exams.attemptQuestionsFromPaper(papers.EX1.questions, { shuffleQuestions: true, shuffleOptions: true, random: () => 0.37 });
  return Object.assign({ id: 'ATT-NEW', examId: 'EX1', studentId: me.stu, studentName: T.stu.name, questions: qs, answers: qs.map(() => null),
    flagged: qs.map(() => false), answeredAt: qs.map(() => 0), flaggedAt: qs.map(() => 0), startTime: NOW - 60000, deadline: NOW + 3600000,
    status: 'open', updatedAt: new Date(NOW).toISOString() }, over || {});
}

/* ------------------------------------------------------------ attempts */
console.log('An attempt: theirs, open, at an exam they may sit, from its paper');
{
  const ok = check(item('rec', { key: 'voctrain_examAttempts', rec: attempt() }));
  assert(ok.ok && ok.key === 'voctrain_examAttempts' && ok.rec.accountId === me.acct && ok.rec.status === 'open', 'their own open attempt is taken, with their account on it');
  assertEq(ok.id, 'IT-' + n, 'every answer names the item it answers');
  const keyed = attempt(); keyed.questions[1].correctAnswer = 0; keyed.questions[2].pairs = [{ prompt: 'a', answer: 'b' }];
  const k = check(item('rec', { key: 'voctrain_examAttempts', rec: keyed }));
  assert(k.ok && k.rec.questions.every(q => !('correctAnswer' in q) && !('pairs' in q)), 'a key slipped into an attempt is dropped, never kept');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ studentId: OTHER.stu.id }) })), 'not-yours', 'another trainee\'s attempt: not yours');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ accountId: OTHER.acct.id }) })), 'not-yours', 'carrying another account: not yours');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ status: 'submitted' }) })), 'not-open', 'a retired attempt: only the gatekeeper retires');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ status: undefined }) })), 'not-open', 'an attempt must say it is open');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ examId: 'EX2' }) })), 'unknown-exam', 'another programme\'s exam');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ examId: 'EX1-DRAFT' }) })), 'unknown-exam', 'a draft exam');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt() }), { papers: {} }), 'unknown-exam', 'an exam whose paper the gate cannot see');
  const stray = attempt(); stray.questions[3] = Object.assign({}, stray.questions[3], { id: 'MADE-UP' });
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: stray })), 'unknown-question', 'a question that is not on the paper');
  const order = attempt(); const mq = order.questions.findIndex(q => q.type === 'mcq'); order.questions[mq].optionOrder = [0, 0, 1];
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: order })), 'bad-order', 'an option order that is not a reordering');
  const short = attempt(); short.questions[mq].optionOrder = [1, 0];
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: short })), 'bad-order', 'one that drops an option');
  const huge = attempt(); huge.answers[1] = 'x'.repeat(520 * 1024);
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: huge })), 'too-large', 'over 500 KB');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: attempt({ answers: null }) })), 'malformed', 'with no answers list');
  // The attempt record the dashboard itself saves (examAttemptRecord, index.html) is one the gate takes.
  const INDEX = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const at = INDEX.indexOf('function examAttemptRecord(');
  let depth = 0, end = -1;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) { if (INDEX[i] === '{') depth++; else if (INDEX[i] === '}') { depth--; if (!depth) { end = i + 1; break; } } }
  const vm = require('vm'), ctx = { Date };
  vm.createContext(ctx);
  vm.runInContext('function examStampNow() { return ' + NOW + '; }\n' + INDEX.slice(at, end), ctx);
  const a0 = attempt();
  const s = { attemptId: 'ATT-PAGE', examId: 'EX1', studentId: me.stu, studentName: T.stu.name, title: 'Welding', duration: 90, passMark: 60,
    questions: a0.questions, answers: a0.answers, flagged: a0.flagged, answeredAt: a0.answeredAt, flaggedAt: a0.flaggedAt,
    startTime: a0.startTime, deadline: a0.deadline, perPage: 3, page: 1, current: 4, posAt: NOW, allowFlag: true };
  const pageRec = JSON.parse(JSON.stringify(ctx.examAttemptRecord(s)));
  const pr = check(item('rec', { key: 'voctrain_examAttempts', rec: pageRec }));
  assert(pr.ok && pr.rec.id === 'ATT-PAGE' && pr.rec.page === 1 && pr.rec.posAt === NOW, 'the record the dashboard saves for an attempt is taken whole');
  const more = attempt(); more.answers.push('extra');
  assertEq(reason(item('rec', { key: 'voctrain_examAttempts', rec: more })), 'malformed', 'with more answers than questions');
}

/* --------------------------------------------------------- submissions */
console.log('A submission: theirs, to their programme\'s assignment, their own files');
{
  const sub = (o) => Object.assign({ id: 'SUB-NEW', assignmentId: 'ASG-1', studentId: me.stu, submittedAt: new Date(NOW).toISOString(),
    comment: 'Here', driveFiles: [{ driveFileId: 'UP-1', name: 'a.pdf' }] }, o || {});
  const ok = check(item('rec', { key: 'voctrain_submissions', rec: sub({ grade: 10, feedback: 'Excellent', gradedBy: 'me', gradedAt: 'x', marks: 99, studentName: 'Someone Else' }) }));
  assert(ok.ok, 'their submission, with their own upload, is taken');
  assert(['grade', 'feedback', 'gradedBy', 'gradedAt', 'marks'].every(f => !(f in ok.rec)), 'a grade or feedback written by the trainee is stripped');
  assertEq([ok.rec.studentName, ok.rec.accountId], [T.stu.name, me.acct], 'their own name and account go on it');
  assert(check(item('rec', { key: 'voctrain_submissions', rec: sub({ driveFiles: [{ driveFileId: 'FILE-' + me.acct, name: 'old.pdf' }] }) })).ok,
    'a file they submitted before is theirs too');
  assertEq(reason(item('rec', { key: 'voctrain_submissions', rec: sub({ studentId: OTHER.stu.id }) })), 'not-yours', 'another trainee\'s submission');
  assertEq(reason(item('rec', { key: 'voctrain_submissions', rec: sub({ assignmentId: 'ASG-2' }) })), 'unknown-assignment', 'to another programme\'s assignment');
  assertEq(reason(item('rec', { key: 'voctrain_submissions', rec: sub({ driveFiles: [{ driveFileId: 'FILE-' + OTHER.acct.id }] }) })), 'not-own-file',
    'with a classmate\'s file');
  assertEq(reason(item('rec', { key: 'voctrain_submissions', rec: sub({ id: '' }) })), 'malformed', 'without an id');
}

/* ------------------------------------------------------------ requests */
console.log('A certificate or transcript request: theirs; new ones wait; only a waiting one can be withdrawn');
{
  const fresh = { id: 'CTR-NEW', studentId: me.stu, type: 'both', status: 'pending', requestedAt: new Date(NOW).toISOString(),
    handledBy: 'Me', handledAt: 'now', adminNote: 'approved by myself', studentName: 'X', course: 'Y' };
  const ok = check(item('rec', { key: 'voctrain_certTranscriptRequests', rec: fresh }));
  assert(ok.ok && ok.rec.status === 'pending' && ok.rec.handledBy === '' && ok.rec.adminNote === '', 'a new request is taken, waiting, with nothing decided');
  assertEq([ok.rec.studentName, ok.rec.course, ok.rec.type], [T.stu.name, T.p.name, 'both'], 'under their own name and programme');
  assertEq(reason(item('rec', { key: 'voctrain_certTranscriptRequests', rec: Object.assign({}, fresh, { status: 'ready' }) })), 'not-pending',
    'a new request cannot arrive already decided');
  const mine = slice.data.voctrain_certTranscriptRequests[0];
  const cancel = check(item('rec', { key: 'voctrain_certTranscriptRequests', rec: Object.assign({}, mine, { status: 'cancelled', note: 'changed', updatedAt: new Date(NOW).toISOString() }) }));
  assert(cancel.ok && cancel.rec.status === 'cancelled' && cancel.rec.note === mine.note, 'their waiting request can be withdrawn — and nothing else about it changed');
  const decided = J(slice); decided.data.voctrain_certTranscriptRequests[0].status = 'ready';
  assertEq(reason(item('rec', { key: 'voctrain_certTranscriptRequests', rec: Object.assign({}, mine, { status: 'cancelled' }) }), opts, decided),
    'not-pending', 'a request the office has acted on cannot be');
  assertEq(reason(item('rec', { key: 'voctrain_certTranscriptRequests', rec: Object.assign({}, fresh, { studentId: OTHER.stu.id }) })), 'not-yours',
    'another trainee\'s request');
}

/* ----------------------------------------------------- support, chat */
console.log('A support message from them, a chat message in their room');
{
  const msg = { id: 'SUP-NEW', name: T.stu.name, email: T.stu.email, subject: 'Help', message: 'Please', timestamp: NOW, read: true, replied: true, reply: 'forged' };
  const ok = check(item('rec', { key: 'voctrain_support_messages', rec: msg }));
  assert(ok.ok && ok.rec.accountId === me.acct && ok.rec.studentId === me.stu && ok.rec.read === false && ok.rec.replied === false && !('reply' in ok.rec),
    'taken as theirs, unread and unanswered');
  assertEq(reason(item('rec', { key: 'voctrain_support_messages', rec: Object.assign({}, msg, { message: 'x'.repeat(5000) }) })), 'too-large', 'over 4 KB');
  assertEq(reason(item('rec', { key: 'voctrain_support_messages', rec: Object.assign({}, msg, { accountId: OTHER.acct.id }) })), 'not-yours', 'from someone else');
  const again = check(item('rec', { key: 'voctrain_support_messages', rec: Object.assign({}, msg, { id: 'SUP-' + me.acct }) }));
  assert(again.ok && again.known === true && !again.rec, 'one already collected is acknowledged, not taken twice');

  const chat = (o) => Object.assign({ id: 'msg-new', roomId: 'chat-class-101', senderId: me.acct, senderName: 'Faker', text: 'Hi', type: 'text',
    timestamp: new Date(NOW).toISOString(), pollOptions: [{ text: 'x', votes: [OTHER.acct.id] }] }, o || {});
  const c = check(item('rec', { key: 'voctrain_chatMessages', rec: chat() }));
  assert(c.ok && c.rec.senderName === T.stu.name && !('pollOptions' in c.rec) && c.rec.readBy.join() === me.acct, 'in their class room, under their own name');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ roomId: 'chat-class-102' }) })), 'unknown-room', 'not in another programme\'s room');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ roomId: C.dmPeer }) })), 'unknown-room', 'nor a room the slice does not list');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ senderId: OTHER.acct.id }) })), 'not-yours', 'not as somebody else');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ text: 'y'.repeat(4097) }) })), 'too-large', 'over 4 KB');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ imageData: 'data:image/png;base64,AAAA' }) })), 'inline-file', 'a picture must be uploaded');
  assertEq(reason(item('rec', { key: 'voctrain_chatMessages', rec: chat({ driveFileId: 'FILE-' + OTHER.acct.id }) })), 'not-own-file', 'not somebody else\'s file');
  assert(check(item('rec', { key: 'voctrain_chatMessages', rec: chat({ type: 'file', driveFileId: 'UP-1', fileName: 'a.pdf' }) })).ok, 'their own upload');
}

/* ------------------------------------------------------------ profile */
console.log('Their profile: their own key, allowed fields, a new name only as a request');
{
  const p = check(item('rec', { key: 'voctrain_studentProfiles', recId: me.stu, rec: { phone: '876-1', bio: 'Hi', status: 'admin', role: 'admin', name: 'New Name Entirely' } }));
  assert(p.ok && p.recId === me.stu && p.rec.phone === '876-1' && !('status' in p.rec) && !('role' in p.rec), 'allowed fields only');
  assertEq([p.rec.name, p.rec.requestedName], [T.stu.name, 'New Name Entirely'], 'a new name is a request to the office; their name stays');
  assert(check(item('rec', { key: 'voctrain_studentProfiles', recId: me.acct, rec: { phone: '1' } })).ok, 'under their account id too');
  assertEq(reason(item('rec', { key: 'voctrain_studentProfiles', recId: OTHER.stu.id, rec: { phone: '1' } })), 'not-yours', 'never another trainee\'s');
  assertEq(reason(item('rec', { key: 'voctrain_studentProfiles', recId: me.stu, rec: { photo: 'p'.repeat(300 * 1024 + 1) } })), 'too-large', 'a photo over 300 KB');
}

/* --------------------------------------------------------- operations */
console.log('Read, clear and follow: a record in their slice, their own mark only');
{
  const op = o => item('op', { op: Object.assign({ id: 'OP-' + n, at: new Date(NOW).toISOString() }, o) });
  assert(check(op({ kind: 'read', key: 'voctrain_announcements', recId: 'AN-1' })).ok, 'reading an announcement of theirs');
  assertEq(reason(op({ kind: 'read', key: 'voctrain_announcements', recId: 'AN-3' })), 'unknown-record', 'not one for staff only');
  assertEq(reason(op({ kind: 'read', key: 'voctrain_announcements', recId: 'AN-4' })), 'unknown-record', 'nor another programme\'s');
  assert(check(op({ kind: 'clearNotif', recId: 'N-DM-' + me.acct })).ok, 'clearing their own notice');
  assertEq(reason(op({ kind: 'clearNotif', recId: 'N-DM-' + OTHER.acct.id })), 'unknown-record', 'not a classmate\'s');
  assertEq(reason(op({ kind: 'read', key: 'voctrain_examResults', recId: 'RES-' + me.acct })), 'not-yours', 'a mark on a result is not theirs to make');
  assert(check(op({ kind: 'read', key: 'voctrain_chatMessages', roomId: 'chat-class-101' })).ok, 'reading their room');
  assertEq(reason(op({ kind: 'read', key: 'voctrain_chatMessages', roomId: 'chat-class-102' })), 'unknown-room', 'not another');
  const f = check(op({ kind: 'chatFollow', target: 'USR-INS1', on: true }));
  assert(f.ok && f.op.target === 'USR-INS1' && f.op.on === true, 'following their instructor');
  assertEq(reason(op({ kind: 'chatFollow', target: OTHER.acct.id })), 'unknown-record', 'not somebody the slice does not show them');
  assertEq(reason(op({ kind: 'backupCodeUsed', codeHash: G.codeHash('X') })), 'not-yours', 'a spent backup code is never theirs to report');
  assert(check(op({ kind: 'backupCodeUsed', codeHash: G.codeHash('X') }), { lane: true }).ok, '— only the gatekeeper writes that into their inbox');
  assertEq(reason(op({ kind: 'grantAdmin' })), 'not-yours', 'any other operation');
}

/* ------------------------------------------------------- submit, other */
console.log('A submit is checked as an attempt; anything else is not theirs');
{
  assert(check(item('submit', { attempt: attempt() })).ok, 'submitting their attempt');
  assert(check(item('submit', { attempt: attempt({ status: undefined }) })).ok, 'one with no status yet');
  assertEq(reason(item('submit', { attempt: attempt({ studentId: OTHER.stu.id }) })), 'not-yours', 'never another trainee\'s');
  assertEq(reason(item('submit', { attempt: attempt({ status: 'submitted' }) })), 'not-open', 'nor one already retired');
  ['voctrain_examResults', 'voctrain_exams', 'voctrain_attendanceRegister', 'voctrain_users', 'voctrain_students', 'voctrain_assignments',
    'voctrain_announcements', 'voctrain_systemSettings', 'voctrain_transcriptGrades', 'cestiSchoolFeeStudents'].forEach(key => {
    assertEq(reason(item('rec', { key, rec: { id: 'X', studentId: me.stu } })), 'not-yours', key + ' is not theirs to write');
  });
  assertEq(reason(item('delete', { key: 'voctrain_submissions', recId: 'SUB-' + OTHER.acct.id })), 'not-yours', 'nor is any other kind of item');
  assertEq(reason(Object.assign(item('rec', { key: 'voctrain_support_messages', rec: { id: 'S', message: 'x' } }), { a: OTHER.acct.id })), 'not-yours',
    'an item sealed for another account');
  assertEq(G.validateItem(item('rec', {}), {}, slice).reason, 'malformed', 'with no session behind it');
}

/* ---------------------------------------------- again, from an inbox */
console.log('Checked again on a staff device: ownership and shape, without the slice');
{
  const att = check(item('rec', { key: 'voctrain_examAttempts', rec: attempt() })).rec;
  assert(G.validateItem(item('rec', { key: 'voctrain_examAttempts', rec: att }), me, null, { lane: true }).ok, 'an attempt the gate took is taken again');
  assertEq(G.validateItem(item('rec', { key: 'voctrain_examAttempts', rec: Object.assign({}, att, { studentId: OTHER.stu.id }) }), me, null, { lane: true }).reason,
    'not-yours', 'but never under another trainee');
  const cancelled = { id: 'CTR-X', studentId: me.stu, status: 'cancelled', type: 'transcript' };
  assert(G.validateItem(item('rec', { key: 'voctrain_certTranscriptRequests', rec: cancelled }), me, null, { lane: true }).ok, 'a withdrawn request is taken again');
  const prof = G.validateItem(item('rec', { key: 'voctrain_studentProfiles', recId: me.acct, rec: { name: T.stu.name, phone: '2' } }), me, null, { lane: true });
  assertEq(prof.rec.name, T.stu.name, 'a profile keeps the name the gatekeeper set');
}

/* ---------------------------------------------------------------- fuzz */
console.log('Fuzz: any owner field turned into somebody else\'s is refused, every time');
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pickOne = a => a[Math.floor(rnd() * a.length)];
  const foreign = () => pickOne([OTHER.stu.id, OTHER.acct.id, ELSEWHERE.stu.id, ELSEWHERE.acct.id, 'STU-' + Math.floor(rnd() * 1e9).toString(36),
    'USR-' + Math.floor(rnd() * 1e9).toString(36), me.stu + 'x', ' ' + me.stu, me.stu.toLowerCase(), '', 'null', 'undefined']);
  const valid = () => pickOne([
    () => item('rec', { key: 'voctrain_examAttempts', rec: attempt() }),
    () => item('submit', { attempt: attempt() }),
    () => item('rec', { key: 'voctrain_submissions', rec: { id: 'S1', assignmentId: 'ASG-1', studentId: me.stu } }),
    () => item('rec', { key: 'voctrain_certTranscriptRequests', rec: { id: 'C1', studentId: me.stu, status: 'pending' } }),
    () => item('rec', { key: 'voctrain_support_messages', rec: { id: 'M1', accountId: me.acct, studentId: me.stu, message: 'x' } }),
    () => item('rec', { key: 'voctrain_chatMessages', rec: { id: 'X1', roomId: 'chat-class-101', senderId: me.acct, text: 'x' } }),
    () => item('rec', { key: 'voctrain_studentProfiles', recId: me.stu, rec: { phone: '1' } })
  ])();
  const mutate = it => {
    const target = it.attempt || it.rec;
    const field = pickOne(it.kind === 'submit' || it.key === 'voctrain_examAttempts' ? ['studentId', 'accountId', 'a']
      : it.key === 'voctrain_chatMessages' ? ['senderId', 'a'] : it.key === 'voctrain_studentProfiles' ? ['recId', 'a']
      : it.key === 'voctrain_support_messages' ? ['accountId', 'studentId', 'a'] : ['studentId', 'accountId', 'a']);
    const v = foreign();
    if (field === 'a') it.a = v || 'USR-zzz';
    else if (field === 'recId') it.recId = v;
    else target[field] = v === '' && field === 'studentId' ? 'STU-' : v;
    return it;
  };
  let tried = 0, wronglyTaken = [], baseOk = 0;
  for (let i = 0; i < 1500; i++) {
    const base = valid();
    if (check(base).ok) baseOk++;
    const bad = mutate(valid());
    tried++;
    const r = check(bad);
    if (r.ok) wronglyTaken.push(JSON.stringify(bad).slice(0, 160));
  }
  assertEq(baseOk, 1500, 'every untouched item of every kind is taken');
  assertEq(wronglyTaken.slice(0, 3), [], 'none of ' + tried + ' items carrying somebody else\'s id is taken');
  let threw = 0, takenRubbish = 0;
  const junk = () => pickOne([null, undefined, 0, '', 'x', [], {}, { id: 1 }, [1, 2], { studentId: me.stu }, NaN, true]);
  for (let i = 0; i < 1500; i++) {
    const it = { id: junk(), a: pickOne([me.acct, junk()]), kind: pickOne(['rec', 'op', 'submit', junk()]), key: pickOne(['voctrain_examAttempts',
      'voctrain_submissions', 'voctrain_chatMessages', 'voctrain_studentProfiles', junk()]), rec: junk(), op: junk(), attempt: junk(), recId: junk() };
    try {
      const r = G.validateItem(it, me, pickOne([slice, null]), pickOne([opts, {}, { lane: true }]));
      if (r.ok && (it.kind !== 'op')) takenRubbish++;
    } catch (e) { threw++; }
  }
  assertEq(threw, 0, 'random rubbish never throws');
  assertEq(takenRubbish, 0, 'and is never taken as a record');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
