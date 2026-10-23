/* What trainees sent through the gate reaches the Centre's records — once,
   under who they are NOW, and never lost.

   A staff device collects the inbox files the gatekeeper wrote in each
   trainee's folder (DESIGN.md §5.6). Core.gate.collect() is everything it
   does between downloading them and merging: the owner comes from the
   FOLDER (never from the file), every record is checked again, the work is
   re-owned to the account's CURRENT student ID (a rename or a transfer moves
   it) — through a fold, when the account was folded into another — and
   turned into a partial backup payload (Core.gate.toPayload) for the merge
   the dashboard already has (mergeBackupData). Operations (read marks, a
   spent backup code) are applied with Core.gate.applyOps.

   Pinned here:
     - toPayload: each collection under the name mergeBackupData reads,
       requests under `records`, anything a trainee may not write dropped;
     - re-owning after a rename, after an account fold (the dashboard's log
       and backfillStubFolds()'s answer alike), and a result file re-owned
       with its attempt;
     - work that cannot be placed (account deleted, record gone, an
       ambiguous namesake, a file that names another account) is listed as
       waiting for a decision, never dropped, and collected once placed;
     - a record a trainee could not have sent is refused and reported;
     - a second run merges nothing twice; a file changed since is collected
       again; a file newer than this device reads is left for one that can;
     - applyOps: each trainee's own mark only, twice changes nothing; a
       spent backup code is burnt and its account named for stamping.

   Run: node tests/gate-collector.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../cestis-core.js');
const { makeCentre, crypto, NOW, MIN, iso } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate;
const J = v => JSON.parse(JSON.stringify(v));
const C = makeCentre(Core);
const T = C.trainees[0], U = C.trainees[1];
const built = G.buildAll(C.store, NOW);
const paper = built.papers.EX1.paper;

function inbox(t, records, ops, over) {
  return Object.assign({ format: 'cestis-trainee-inbox', version: 1, accountId: t.acct.id, studentId: t.stu.id, lane: 'L-kx.abc.1',
    createdAt: iso(NOW - 30 * MIN), updatedAt: iso(NOW - MIN), records: records || {}, ops: ops || [], received: {} }, over || {});
}
function attemptOf(t, over) {
  const qs = Core.exams.attemptQuestionsFromPaper(paper.questions, {});
  return Object.assign({ id: 'ATT-' + t.acct.id + '-new', examId: 'EX1', studentId: t.stu.id, accountId: t.acct.id, questions: qs,
    answers: qs.map(() => null), flagged: qs.map(() => false), answeredAt: qs.map(() => 0), flaggedAt: qs.map(() => 0),
    startTime: NOW - 20 * MIN, deadline: NOW + 60 * MIN, status: 'open', updatedAt: iso(NOW - MIN) }, over || {});
}
const submission = (t, over) => Object.assign({ id: 'SUB-NEW-' + t.acct.id, assignmentId: 'ASG-1', studentId: t.stu.id, accountId: t.acct.id,
  submittedAt: iso(NOW - 2 * MIN), comment: 'mine' }, over || {});
const file = (id, folderAcct, json, ver, mod) => ({ fileId: id, version: ver || 1, modifiedTime: mod || iso(NOW - MIN), folderAcct, json });
const cx = (over) => Object.assign({ accounts: C.store.voctrain_users, students: C.store.voctrain_students, deletedUserIds: [] }, over || {});

/* ------------------------------------------------------------ toPayload */
console.log('toPayload: the names the dashboard\'s merge already reads');
{
  const recs = { voctrain_examAttempts: [{ id: 'A' }], voctrain_submissions: [{ id: 'S' }], voctrain_support_messages: [{ id: 'M' }],
    voctrain_studentProfiles: { 'STU-1': { phone: '1' } }, voctrain_chatMessages: { R: [{ id: 'm' }] }, voctrain_examResults: [{ id: 'R' }],
    voctrain_certTranscriptRequests: [{ id: 'CTR' }], voctrain_exams: [{ id: 'EVIL' }], voctrain_users: [{ id: 'U' }], voctrain_attendanceRegister: [{ id: 'X' }] };
  const p = G.toPayload(recs);
  assertEq(p, { version: '1.0', data: { chatMessages: { R: [{ id: 'm' }] }, examAttempts: [{ id: 'A' }], examResults: [{ id: 'R' }],
    studentProfiles: { 'STU-1': { phone: '1' } }, assignmentSubmissions: [{ id: 'S' }], supportMessages: [{ id: 'M' }] },
    records: { voctrain_certTranscriptRequests: [{ id: 'CTR' }] } }, 'each collection under its backup name; requests by store key; nothing else');
  p.data.assignmentSubmissions[0].id = 'changed';
  assertEq(recs.voctrain_submissions[0].id, 'S', 'a copy: the inbox is never changed');
  // Every name is one mergeBackupData() reads (examAttempts is read once the exam-resume page work is merged).
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = INDEX.indexOf('async function mergeBackupData(backupData)');
  const body = INDEX.slice(start, INDEX.indexOf('\n}\n', start));
  const unread = Object.keys(G.PAYLOAD_NAMES).map(k => G.PAYLOAD_NAMES[k]).filter(n => body.indexOf('backupData.data.' + n) === -1);
  assert(unread.every(n => n === 'examAttempts'), 'mergeBackupData reads every one of them (' + (unread.length ? 'still to come: ' + unread.join(', ') : 'all') + ')');
}

/* ---------------------------------------------------- an ordinary run */
console.log('Collected under the owner the folder names, checked again, ready to merge');
let first;
{
  const fA = file('F-A', T.acct.id, inbox(T, { voctrain_examAttempts: [attemptOf(T)], voctrain_submissions: [submission(T)],
    voctrain_chatMessages: { 'chat-class-101': [{ id: 'm1', senderId: T.acct.id, text: 'hi', timestamp: iso(NOW - MIN) }] },
    voctrain_studentProfiles: { [T.stu.id]: { phone: '876-9', name: T.stu.name } } },
    [{ id: 'OP-1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-2', at: iso(NOW - MIN) }]), 3, iso(NOW - 2 * MIN));
  const fB = file('F-B', U.acct.id, JSON.stringify(inbox(U, { voctrain_support_messages: [{ id: 'SUP-U', accountId: U.acct.id, studentId: U.stu.id, message: 'x' }] })),
    1, iso(NOW - MIN));
  first = G.collect([fA, fB], cx({ watermark: iso(NOW - 60 * MIN) }));
  const d = first.payload.data;
  assertEq([d.examAttempts.length, d.assignmentSubmissions.length, d.supportMessages.length, Object.keys(d.chatMessages), Object.keys(d.studentProfiles)],
    [1, 1, 1, ['chat-class-101'], [T.stu.id]], 'every record of both inboxes');
  assertEq(d.chatMessages['chat-class-101'][0].roomId, 'chat-class-101', 'a chat message knows its room');
  assertEq(first.ops, [{ me: { acct: T.acct.id, stu: T.stu.id }, op: { id: 'OP-1', kind: 'read', at: iso(NOW - MIN), key: 'voctrain_announcements', recId: 'AN-2' } }],
    'the trainee\'s read mark, with who made it');
  assertEq([first.files, first.unassigned, first.refused], [2, [], []], 'both files collected, nothing waiting or refused');
  assertEq(first.seen, { 'F-A': '3', 'F-B': '1' }, 'each file remembered at the version collected');
  assertEq(first.watermark, iso(NOW - MIN), 'and the newest file\'s time is the next watermark');

  const again = G.collect([fA, fB], cx({ seen: first.seen }));
  assertEq([again.payload.data, again.ops, again.files], [{}, [], 0], 'a second run merges nothing twice');
  const fA2 = Object.assign({}, fA, { version: 4, json: inbox(T, { voctrain_submissions: [submission(T, { comment: 'edited', submittedAt: iso(NOW) })] }) });
  const third = G.collect([fA2, fB], cx({ seen: first.seen }));
  assertEq([third.files, third.payload.data.assignmentSubmissions[0].comment], [1, 'edited'], 'a file changed since is collected again');

  // The merge the dashboard runs, twice: the second changes nothing.
  const local = J(C.store.voctrain_submissions);
  const byId = r => (r && r.id != null ? String(r.id) : undefined);
  const m1 = Core.sync.mergeList(local, first.payload.data.assignmentSubmissions, byId, {});
  const m2 = Core.sync.mergeList(local, J(first.payload.data.assignmentSubmissions), byId, {});
  assertEq([m1.added, m2.added, m2.updated], [1, 0, 0], 'merged into the Centre\'s submissions once, and a second merge changes nothing');
  // (The attempt rule completes a copy the first time it merges it — its
  // position fields — so it is steady from the second merge on.)
  const atts = Core.exams.mergeAttemptLists(C.store.voctrain_examAttempts, first.payload.data.examAttempts);
  const atts2 = Core.exams.mergeAttemptLists(atts.list, J(first.payload.data.examAttempts));
  assert(atts.changed && Core.exams.mergeAttemptLists(atts2.list, J(first.payload.data.examAttempts)).changed === false, 'attempts the same way');
}

/* --------------------------------------------- checked again, refused */
console.log('A record a trainee could not have sent is refused and reported, never merged');
{
  const bad = file('F-BAD', T.acct.id, inbox(T, {
    voctrain_submissions: [submission(T), submission(T, { id: 'SUB-THEIRS', studentId: U.stu.id })],
    voctrain_examResults: [{ id: 'RES-FORGED', examId: 'EX1', studentId: T.stu.id, score: 100 }],
    voctrain_examAttempts: [attemptOf(T, { status: 'submitted' })]
  }, [{ id: 'OP-X', kind: 'grantAdmin' }]));
  const r = G.collect([bad], cx());
  assertEq(r.payload.data.assignmentSubmissions.map(s => s.id), ['SUB-NEW-' + T.acct.id], 'their own record is taken');
  assertEq(r.refused.map(x => x.id + ':' + x.reason).sort(),
    ['ATT-' + T.acct.id + '-new:not-open', 'OP-X:not-yours', 'RES-FORGED:not-yours', 'SUB-THEIRS:not-yours'],
    'another\'s submission, a result, a retired attempt and an unknown operation are refused');
  assert(!r.payload.data.examAttempts, 'only the gatekeeper retires an attempt — in a result file, never in an inbox');
  assert(!r.payload.data.examResults, 'a result written by a trainee never reaches the merge');
  const newer = G.collect([file('F-NEW', T.acct.id, inbox(T, {}, [], { version: 2 }))], cx());
  assertEq([newer.refused[0].reason, newer.seen['F-NEW']], ['newer-version', undefined], 'a newer format is left for a device that reads it — not marked seen');
  const junk = G.collect([file('F-JUNK', T.acct.id, '{not json')], cx());
  assertEq([junk.refused[0].reason, junk.seen['F-JUNK']], ['malformed', '1'], 'an unreadable file is reported once');
}

/* ------------------------------------------------- re-owned: a rename */
console.log('Re-owned to who they are now: after a rename');
{
  const st = J(C.store);
  const renamed = st.voctrain_students.find(s => s.id === T.stu.id);
  renamed.name = 'Kemar Williams-Brown';
  const oldId = renamed.id;
  renamed.id = Core.stableStudentId(renamed);                  // the student ID moves with the name
  st.voctrain_users.find(a => a.id === T.acct.id).studentDataId = renamed.id;
  const r = G.collect([file('F-R', T.acct.id, inbox(T, { voctrain_examAttempts: [attemptOf(T)], voctrain_submissions: [submission(T)],
    voctrain_studentProfiles: { [oldId]: { phone: '1', updatedAt: iso(NOW) }, [T.acct.id]: { phone: '2' } },
    voctrain_chatMessages: { 'chat-class-101': [{ id: 'm2', senderId: T.acct.id, text: 'x', readBy: [T.acct.id] }] } }))],
    cx({ accounts: st.voctrain_users, students: st.voctrain_students }));
  const d = r.payload.data;
  assert(oldId !== renamed.id, '(the rename gave a new student ID)');
  assertEq([d.examAttempts[0].studentId, d.assignmentSubmissions[0].studentId], [renamed.id, renamed.id], 'their attempt and submission carry the new student ID');
  assertEq(Object.keys(d.studentProfiles).sort(), [T.acct.id, renamed.id].sort(), 'their profile moves to the new ID; the account key stays');
  assertEq([d.chatMessages['chat-class-101'][0].senderId, d.assignmentSubmissions[0].accountId], [T.acct.id, T.acct.id], 'the account is unchanged');
  const recs = { voctrain_submissions: [submission(T), submission(U)] };
  const moved = G.reown(recs, { acct: T.acct.id, stu: T.stu.id }, { acct: T.acct.id, stu: 'STU-NEW' });
  assertEq(moved.voctrain_submissions.map(s => s.studentId), ['STU-NEW', U.stu.id], 'reown touches only ids that were the trainee\'s');
  assertEq(recs.voctrain_submissions[0].studentId, T.stu.id, 'and returns a copy');
  assertEq(G.reown(moved, { acct: T.acct.id, stu: T.stu.id }, { acct: T.acct.id, stu: 'STU-NEW' }), moved, 'run again, it changes nothing');
}

/* -------------------------------------------- re-owned: an account fold */
console.log('Re-owned after the account was folded into the trainee\'s real one');
{
  // An old account of the same person, folded into their real one.
  const st = J(C.store);
  // Its name was mistyped, so nothing finds the trainee record by it.
  const old = { id: 'USR-OLD-1', name: T.stu.name.replace('Williams', 'Wiliams'), role: 'student', status: 'disabled', password: '', email: '', programme: T.p.name,
    registeredVia: 'fee-system', approvedBy: 'system', studentDataId: 'STU-GONE' };
  st.voctrain_users.push(old);
  const lane = inbox({ acct: { id: 'USR-OLD-1' }, stu: { id: 'STU-GONE' } }, { voctrain_submissions: [submission(T, { studentId: 'STU-GONE', accountId: 'USR-OLD-1' })],
    voctrain_studentProfiles: { 'USR-OLD-1': { phone: '5' } } });
  const f = file('F-FOLD', 'USR-OLD-1', lane);
  const none = G.collect([f], cx({ accounts: st.voctrain_users, students: st.voctrain_students }));
  assertEq(none.unassigned.map(u => u.reason), ['student-gone'], 'without the fold, the old account has no trainee record: it waits');
  const log = { 'USR-OLD-1': { mergedInto: T.acct.id, name: T.stu.name, by: 'name', at: iso(NOW - MIN) } };   // cestisFoldedAccounts
  const r = G.collect([f], cx({ accounts: st.voctrain_users, students: st.voctrain_students, folds: log }));
  const s = r.payload.data.assignmentSubmissions[0];
  assertEq([s.studentId, s.accountId, Object.keys(r.payload.data.studentProfiles)], [T.stu.id, T.acct.id, [T.acct.id]],
    'with the dashboard\'s fold log, the work is the real account\'s, under its current student ID');
  assertEq(r.ops.length + r.unassigned.length, 0, 'nothing left waiting');
  assertEq(G.foldMap(log), G.foldMap({ folds: [{ id: 'USR-OLD-1', into: T.acct.id, by: 'name' }] }), 'backfillStubFolds()\'s answer reads the same');
  assertEq(G.foldMap({ 'USR-OLD-1': T.acct.id }), G.foldMap(log), 'and so does a plain map');
  const chain = G.resolveOwner('USR-A', cx({ folds: { 'USR-A': { mergedInto: 'USR-B' }, 'USR-B': { mergedInto: T.acct.id } } }));
  assertEq([chain.acct, chain.stu, chain.folded], [T.acct.id, T.stu.id, true], 'a fold of a fold is followed');
  const loop = G.resolveOwner('USR-A', cx({ folds: { 'USR-A': 'USR-B', 'USR-B': 'USR-A' } }));
  assertEq(loop.reason, 'account-gone', 'a fold that goes round in a circle ends, unplaced');
  if (typeof Core.accountAccess.backfillStubFolds === 'function') {
    // The real fold rule, when this build has it: a provable stub folds into the trainee's account.
    const stub = C.stub;
    const folds = Core.accountAccess.backfillStubFolds(C.store.voctrain_users, C.store.voctrain_students);
    const into = G.foldMap(folds)[stub.id];
    assertEq(into, T.acct.id, 'backfillStubFolds() folds the fee roll\'s stub into the trainee\'s account');
    assertEq(G.resolveOwner(stub.id, cx({ folds })).acct, T.acct.id, 'and the gate follows it');
  }
}

/* ------------------------------------------------- waiting for a decision */
console.log('Work that cannot be placed waits for a decision — never dropped');
{
  const lane = inbox(T, { voctrain_submissions: [submission(T)] });
  const del = G.collect([file('F-D', T.acct.id, lane)], cx({ deletedUserIds: [T.acct.id] }));
  assertEq(del.unassigned.map(u => [u.file, u.accountId, u.studentId, u.reason, u.records.voctrain_submissions.length]),
    [['F-D', T.acct.id, T.stu.id, 'account-gone', 1]], 'an account deleted since: listed with its work');
  assertEq([del.seen['F-D'], del.payload.data], [undefined, {}], 'not marked collected, not merged');
  const noRec = G.collect([file('F-N', T.acct.id, lane)], cx({ students: C.store.voctrain_students.filter(s => s.id !== T.stu.id) }));
  assertEq(noRec.unassigned.map(u => u.reason), ['student-gone'], 'a trainee record removed since: listed');
  const twin = J(C.store.voctrain_students);
  const a2 = J(C.store.voctrain_users);
  a2.find(a => a.id === T.acct.id).studentDataId = null;
  const t1 = twin.find(s => s.id === T.stu.id); t1.id = 'STU-TWIN-A';
  twin.push(Object.assign({}, t1, { id: 'STU-TWIN-B' }));
  const amb = G.collect([file('F-AM', T.acct.id, lane)], cx({ accounts: a2, students: twin }));
  assertEq(amb.unassigned.map(u => u.reason), ['ambiguous'], 'two records it could be: an administrator decides');
  const wrong = G.collect([file('F-W', U.acct.id, lane)], cx());
  assertEq(wrong.unassigned.map(u => u.reason), ['owner-mismatch'], 'a file naming another account than its folder\'s');
  const later = G.collect([file('F-N', T.acct.id, lane)], cx({ seen: noRec.seen }));
  assertEq([later.files, later.payload.data.assignmentSubmissions.length, later.seen['F-N']], [1, 1, '1'], 'once placed, it is collected');
  const staff = G.resolveOwner('USR-INS1', cx());
  assertEq(staff.reason, 'not-a-trainee', 'a folder can only ever be a trainee\'s');
}

/* ----------------------------------------------------- result files */
console.log('A result the gatekeeper marked is collected with its retired attempt');
{
  const key = built.keys.EX1.key;
  const marked = G.markAttempt(attemptOf(T), key, NOW, { crypto, receivedAt: NOW });
  const r = G.collect([file('F-RES', T.acct.id, marked.file)], cx());
  assertEq([r.payload.data.examResults.map(x => x.id), r.payload.data.examAttempts.map(x => x.status)], [[marked.result.id], ['submitted']],
    'the result, and the record that ends the attempt');
  const forged = J(marked.file); forged.result.markedBy = 'device';
  assertEq(G.collect([file('F-RES2', T.acct.id, forged)], cx()).refused[0].reason, 'not-yours', 'a result the gatekeeper did not mark is refused');
  const two = G.collect([file('F-R1', T.acct.id, marked.file), file('F-R2', T.acct.id, G.markAttempt(attemptOf(T), key, NOW + 5000, { crypto, receivedAt: NOW + 5000 }).file)], cx());
  assertEq(two.payload.data.examResults.map(x => x.submittedAt), [iso(NOW)], 'two copies of one attempt\'s result: one, the first');
}

/* --------------------------------------------------------- applyOps */
console.log('Operations: each trainee\'s own mark, and a spent backup code burnt');
{
  const store = { voctrain_announcements: J(C.store.voctrain_announcements), voctrain_notifications: J(C.store.voctrain_notifications),
    voctrain_chatMessages: J(C.store.voctrain_chatMessages), voctrain_users: J(C.store.voctrain_users), voctrain_chatFollows: {}, voctrain_chatFollowLog: {} };
  const me = { acct: T.acct.id, stu: T.stu.id };
  const code = C.trainees[0].acct.backupCodes[1].code;
  const ops = [
    { id: 'O1', kind: 'read', key: 'voctrain_announcements', recId: 'AN-3' },
    { id: 'O2', kind: 'clearNotif', recId: 'N-DM-' + T.acct.id },
    { id: 'O3', kind: 'read', key: 'voctrain_chatMessages', roomId: 'chat-class-101', at: iso(NOW) },
    { id: 'O4', kind: 'chatFollow', target: 'USR-INS1', on: true, at: iso(NOW) },
    { id: 'O5', kind: 'backupCodeUsed', codeHash: G.codeHash(code) },
    { id: 'O6', kind: 'nonsense' }
  ];
  const r = G.applyOps(store, ops, me);
  assertEq([r.applied, r.skipped, r.changed.sort(), r.touchedAccounts], [5, 1,
    ['voctrain_announcements', 'voctrain_chatFollowLog', 'voctrain_chatFollows', 'voctrain_chatMessages', 'voctrain_notifications', 'voctrain_users'], [T.acct.id]],
    'each applied once; an unknown one skipped; the account to stamp named');
  assertEq(store.voctrain_announcements.find(a => a.id === 'AN-3').readBy, [T.acct.id], 'their own "read" only');
  const n = store.voctrain_notifications.find(x => x.id === 'N-DM-' + T.acct.id);
  assertEq([n.clearedBy, n.readBy], [[T.acct.id], [T.acct.id]], 'cleared by them');
  assert(store.voctrain_chatMessages['chat-class-101'].every(m => m.readBy.indexOf(T.acct.id) !== -1), 'their room read up to the time given');
  assertEq(store.voctrain_chatFollows[T.acct.id], ['USR-INS1'], 'their follow');
  const acct = store.voctrain_users.find(a => a.id === T.acct.id);
  assertEq(acct.backupCodes.map(c => c.used), [false, true, false], 'the spent backup code is burnt, the others untouched');
  const again = G.applyOps(store, ops, me);
  assertEq([again.applied, again.changed, again.touchedAccounts], [0, [], []], 'applied twice, nothing changes');
  assertEq(G.applyOps(store, [{ kind: 'backupCodeUsed', codeHash: G.codeHash(code) }], { acct: U.acct.id }).applied, 0, 'never another account\'s code');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
