/* A trainee's slice holds that trainee's records and nobody else's — and
   never an answer key.

   The owner's decision (docs/trainee-gate/DESIGN.md): each trainee's own
   device is to get ONLY their own data. Today every device that syncs holds
   every trainee's records, every account's password check, two-step secret
   and backup codes, and every exam's answer key. The trainee gate replaces
   that, for a trainee's device, with one "slice" per trainee built by a
   staff device (Core.gate.buildAll / sliceFor).

   This is the PRIVACY PROPERTY, checked over a generated Centre of 40
   trainees in 3 programmes with exams of every question type, marked
   results, attempts, the register, grades, notices, classes, profiles,
   requests, support messages, class rooms and direct conversations: no
   trainee's slice, as written to a file, contains another trainee's
   student ID, account ID, name, email, password check, two-step secret or
   backup code; and no slice contains correctAnswer, pairs, distractors or
   tolerance anywhere, nor a single question of any exam's question bank.
   The explicit rules alone achieve it (the last-line sweep takes nothing
   out); a field the rules do not know about is still swept.

   Also pinned:
     - what a trainee DOES get: their programme's exams (details only, with
       how many questions), their own results (without the right answers),
       their attempts, register, grades, submissions, notices, rooms, the
       staff in them, and the Centre's settings;
     - the same records always give the same slice and hash, in any order,
       stored as text or not;
     - maxStamp (§3.3): the newest trusted stamp over every record looked
       at — one that a slice leaves out included — so a device that has not
       seen an edit never out-ranks one that has (publishDecision);
     - papers carry no keys; key files carry them; a draft exam has neither;
     - who gets a slice: an account that can sign in, linked to its record;
     - records still under a student ID the trainee had before reach their
       slice, under today's ID: after a rename (the move the dashboard kept,
       or a record naming their account), and a duplicate's once its stub is
       folded (a live duplicate by the dashboard's identity rule, the fold
       log, a stub's own id) — and, the privacy back-check, never another
       person's: not a namesake on another programme, not one the office
       pinned, not a result moved to someone else, not an ID two could
       claim, a deleted trainee's, or one another account links to;
     - the programme rule is the dashboard's own: index.html's
       instructorCourseMatch is now a wrapper of Core.enrolment.courseMatch
       and answers exactly as the function it replaced.

   Run: node tests/gate-slice.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const { makeCentre, crypto, NOW, DAY, iso } = require('./gate-fixture.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const G = Core.gate;
const C = makeCentre(Core);

/* ------------------------------------------------------------ privacy */
console.log('No slice holds another trainee\'s identity, credentials or any answer key');
const built = G.buildAll(C.asStrings, NOW, { builtBy: 'dev-test' });
const accts = C.trainees.map(t => t.acct.id);
assertEq(Object.keys(built.slices).sort(), accts.slice().sort(), 'every one of the 40 trainees who can sign in gets a slice');
{
  // Every value that identifies a trainee is unique and never part of another.
  const vals = [];
  C.trainees.forEach(t => vals.push(t.stu.id, t.acct.id, t.stu.name, t.stu.email));
  const clash = vals.filter((v, i) => vals.some((w, j) => i !== j && w.indexOf(v) !== -1));
  assertEq(clash, [], 'the generated identities are distinct enough for a plain text search');
}
let totalScrubbed = 0, leaks = [];
C.trainees.forEach(me => {
  const r = built.slices[me.acct.id];
  const text = JSON.stringify(r.slice);
  totalScrubbed += r.scrubbed;
  C.trainees.forEach(o => {
    if (o === me) return;
    const theirs = [o.stu.id, o.acct.id, o.stu.name, o.stu.email, o.acct.password];
    if (o.acct.twoFactorSecret) theirs.push(o.acct.twoFactorSecret);
    (o.acct.backupCodes || []).forEach(c => theirs.push(c.code));
    theirs.forEach(v => { if (text.indexOf(v) !== -1) leaks.push(me.acct.id + ' holds ' + v); });
  });
  // Not even their own credentials travel.
  [me.acct.password, me.acct.twoFactorSecret].concat((me.acct.backupCodes || []).map(c => c.code)).forEach(v => {
    if (v && text.indexOf(v) !== -1) leaks.push(me.acct.id + ' holds its own credential ' + v);
  });
  ['"correctAnswer"', '"pairs"', '"distractors"', '"tolerance"', 'Argon', 'flashback arrest*', 'Grinder"', 'Describe a safe workshop'].forEach(k => {
    // The trainee's own attempt shows the question text they were given; a
    // result's own answers show what they chose. Neither carries a key.
    if (k === 'Argon' || k === 'Describe a safe workshop' || k === 'Grinder"') return;
    if (text.indexOf(k) !== -1) leaks.push(me.acct.id + ' holds ' + k);
  });
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') Object.keys(n).forEach(k => {
      if (k === 'questionData' && !(Array.isArray(n[k]) && n[k].length === 0)) leaks.push(me.acct.id + ' holds a question bank');
      walk(n[k]);
    });
  })(r.slice);
});
assertEq(leaks.slice(0, 5), [], 'no slice holds another trainee\'s id, name, email, password check, two-step secret or backup code, nor any key');
assertEq(totalScrubbed, 0, 'the explicit rules alone keep them out (the last-line sweep had nothing to take)');
{
  // Their own attempt carries the questions they saw, without keys.
  const me = C.trainees[0], s = built.slices[me.acct.id].slice;
  const att = s.data.voctrain_examAttempts.find(a => a.status === 'open');
  assert(!!att && att.questions.length === 9 && att.questions.every(q => !('correctAnswer' in q) && !('pairs' in q)), 'an attempt in progress keeps its questions, never a key');
  const ans = s.data.voctrain_examResults[0].answers;
  assert(ans.length === 8 && ans.every(a => !('correctAnswer' in a) && !('tolerance' in a)), 'a result keeps every answer, without the right answer');
  assert(ans.some(a => Array.isArray(a.rows)), 'a matching answer still shows its prompts');
}

/* -------------------------------------------------- what they DO get */
console.log('A trainee gets everything that is theirs');
{
  const me = C.trainees[0], s = built.slices[me.acct.id].slice, d = s.data;
  assertEq([s.format, s.version, s.accountId, s.studentId], ['cestis-trainee-slice', 1, me.acct.id, me.stu.id], 'the slice says whose it is');
  assertEq(s.builtBy, 'dev-test', 'and which device built it (an id, never a name)');
  assertEq(d.voctrain_students.map(x => x.id), [me.stu.id], 'their own record');
  const card = d.voctrain_users[0];
  assertEq(Object.keys(card).sort(), ['createdAt', 'email', 'emailOtpLogin', 'id', 'name', 'programme', 'role', 'status', 'studentDataId', 'twoFactorEnabled', 'username'],
    'their account card: no password, secret or backup codes');
  assertEq(card.twoFactorEnabled, true, 'only whether two-step is on');
  assertEq(d.voctrain_exams.map(e => e.id), ['EX1', 'EX1-OLD'], 'their programme\'s exams, never a draft or another programme\'s');
  assertEq([d.voctrain_exams[0].questions, d.voctrain_exams[0].questionData, d.voctrain_exams[0].students],
    [8, [], undefined], 'details and how many questions, never the questions');
  assertEq(G.sliceExamStatus(d.voctrain_exams[0], NOW, '-05:00'), 'active', 'and the exam reads as open from the count');
  assertEq(G.sliceExamStatus(d.voctrain_exams[0], NOW - 2 * DAY, '-05:00'), 'upcoming', 'not before its time');
  assertEq(s.access.papers, ['EX1', 'EX1-OLD'], 'the papers they may ask for');
  assertEq(d.voctrain_examResults.map(r => r.id), ['RES-' + me.acct.id], 'their own result');
  assertEq(d.voctrain_attendanceRegister.length, 3, 'their own register');
  const asg = d.voctrain_assignments;
  assertEq(asg.map(a => a.id), ['ASG-1'], 'their programme\'s assignment');
  assertEq([Object.keys(asg[0].grades), Object.keys(asg[0].gradeMeta), Object.keys(asg[0].feedback), asg[0].gradeLog.length],
    [[me.stu.id], [me.stu.id], [me.stu.id], 1], 'with their own grade, mark details, feedback and history only');
  assertEq(d.voctrain_submissions.map(x => x.id), ['SUB-' + me.acct.id], 'their own submission');
  assertEq(d.voctrain_announcements.map(a => a.id), ['AN-1', 'AN-2'], 'announcements for trainees of their programme or everyone');
  assertEq(d.voctrain_announcements.map(a => a.readBy), [[me.acct.id], [me.acct.id]], 'with only their own "read"');
  const nids = d.voctrain_notifications.map(n => n.id);
  assert(nids.indexOf('N-ALL') !== -1 && nids.indexOf('N-DM-' + me.acct.id) !== -1 && nids.indexOf('N-CERT-' + me.acct.id) !== -1,
    'notices for everyone, for them, and the one that names them');
  assert(nids.indexOf('N-STAFF') === -1 && !nids.some(n => n.indexOf('N-SCORE') === 0), 'never a staff notice or a score notice');
  assertEq(d.voctrain_notifications.find(n => n.id === 'N-ALL').clearedBy, [], 'another person\'s "cleared" is not theirs to see');
  assertEq(d.voctrain_calendarEvents.map(e => e.id), ['CE-1', 'CE-2'], 'calendar events for them');
  assertEq(d.voctrain_classSessions[0].attendees.map(a => a.id), [me.stu.id], 'their class, with only themselves on its list');
  assert(d.voctrain_vcSessions.length === 1 && !('participants' in d.voctrain_vcSessions[0]), 'their video class, without who took part');
  assertEq(d.voctrain_resources.map(r => r.id), ['RES-I1', 'RES-I2'], 'their programme\'s resources and the Centre-wide ones');
  assertEq(d.voctrain_driveResources, [], 'not another programme\'s');
  assertEq(s.access.files, ['FILE-BRIEF-1', 'FILE-HANDBOOK', 'FILE-NOTES-1', 'FILE-' + me.acct.id].sort(), 'the files they may open');
  assertEq(d.voctrain_unitCatalogs.map(c => c.id), ['CAT-1'], 'their programme\'s units');
  assertEq(Object.keys(d.voctrain_transcriptProfiles), [me.stu.id], 'their own transcript profile');
  assertEq(Object.keys(d.voctrain_studentProfiles).sort(), [me.acct.id, me.stu.id].sort(), 'their own profile');
  assertEq(d.voctrain_certTranscriptRequests.length + d.voctrain_certDownloadApprovals.length, 2, 'their own requests and approval');
  assertEq(Object.keys(d.voctrain_certTemplates), [me.p.name], 'their programme\'s certificate template');
  assert(!('bgPage1' in d.voctrain_certTemplates[me.p.name]), 'without its background images');
  assertEq(d.voctrain_support_messages.map(m => m.id), ['SUP-' + me.acct.id], 'their own support messages');
  assertEq(d.voctrain_chatRooms.map(r => r.id).sort(), ['chat-class-101', C.dmStaff].sort(), 'their class room and their conversation with staff');
  assertEq(d.voctrain_chatRooms.find(r => r.id === 'chat-class-101').members, [me.acct.id, 'USR-INS1'].sort(), 'whose other members are the staff only');
  assert(!d.voctrain_chatRooms.some(r => r.id === C.dmPeer), 'a conversation with another trainee is not listed (its id names them)');
  assertEq(s.access.rooms, ['chat-class-101', C.dmStaff].sort(), 'the rooms they may read');
  assertEq(d.voctrain_skillAreas.map(x => x.id), [101], 'their training centre');
  assertEq(d.voctrain_instructorData, [{ name: 'Instructor TeachwellA', course: me.p.name }], 'their instructor: name and programme only');
  assertEq(s.settings, { centreName: 'C.E.S.T.I.S Training Centre', centreUtcOffset: '-05:00', maintenanceMode: false, maintenanceMessage: '',
    gateUrl: 'https://script.google.com/macros/s/TEST/exec' }, 'the Centre\'s settings a trainee\'s device needs');
  assertEq(Object.keys(s.tombstones.announcements || {}), ['AN-OLD'], 'recent deletions in their pools (old ones age out)');
  assert(!s.tombstones.examResults && !s.tombstones.chatRooms, 'never another trainee\'s deletions');
  const t2 = C.trainees[2], s2 = built.slices[t2.acct.id].slice;
  assertEq(Object.keys(s2.tombstones.studentProfiles || {}), [t2.acct.id], 'and the deletion of their own profile');
}

/* --------------------------------------------------- who gets a slice */
console.log('Only an account that can sign in, linked to its record, gets a slice');
{
  assert(!built.slices[C.pending.id] && !built.slices[C.stub.id], 'not a pending registration, not a backfill stub');
  assert(!built.slices['USR-ADMIN1'] && !built.slices['USR-INS1'], 'not staff');
  const st = JSON.parse(JSON.stringify(C.store));
  st.voctrain_users.push({ id: 'USR-LOST', name: 'Nobody Recordless', role: 'student', status: 'active', password: 'pbkdf2$1$aa$bb', programme: 'Plumbing' });
  st.voctrain_users.push({ id: 'USR-EMAIL', name: C.trainees[5].stu.name, role: 'student', status: 'active', password: '', email: 'own@mail.test',
    studentDataId: C.trainees[5].stu.id });
  st.voctrain_deletedUserIds = [C.trainees[7].acct.id];
  const b = G.buildAll(st, NOW);
  assertEq(b.unlinked, ['USR-LOST'], 'an account with no trainee record is listed, not given an empty slice');
  assert(!!b.slices['USR-EMAIL'], 'an account with no password but an email to sign in with gets one');
  assert(!b.slices[C.trainees[7].acct.id], 'a deleted account gets none');
  assertEq(G.buildSlice(st, 'USR-LOST', NOW).error, 'unlinked', 'buildSlice says so');
  assertEq(G.buildSlice(st, 'USR-NOPE', NOW).error, 'not-found', 'and says when there is no such account');
}

/* ---------------------------------------------------------- the sweep */
console.log('A field the rules do not know about still never carries another trainee');
{
  const st = JSON.parse(JSON.stringify(C.store));
  const me = C.trainees[0], other = C.trainees[3];
  st.voctrain_students[0].twinOf = other.stu.id;
  st.voctrain_students[0].note = other.stu.name;
  st.voctrain_assignments[0].peerReviewers = { [other.stu.id]: true };
  st.voctrain_examAttempts.push({ id: 'ATT-X', examId: 'EX1', studentId: me.stu.id, status: 'open', questions: [{ id: 'q', correctAnswer: 1 }], answers: [null] });
  const r = G.buildSlice(st, me.acct.id, NOW);
  const text = JSON.stringify(r.slice);
  assert(r.scrubbed >= 3, 'the sweep counts what it took out (' + r.scrubbed + ')');
  assert(text.indexOf(other.stu.id) === -1 && text.indexOf(other.stu.name) === -1, 'another trainee\'s id and name are gone');
  assert(text.indexOf('"correctAnswer"') === -1, 'a key slipped into an attempt is gone');
}

/* --------------------------------------------------------- determinism */
console.log('The same records always give the same slice');
{
  const again = G.buildAll(C.asStrings, NOW + 3 * 60000, { builtBy: 'other-device' });
  assert(accts.every(a => again.slices[a].h === built.slices[a].h), 'built again later by another device: the same hashes');
  const rev = {};
  Object.keys(C.store).forEach(k => {
    const v = JSON.parse(JSON.stringify(C.store[k]));
    rev[k] = Array.isArray(v) ? v.reverse() : v;
  });
  const shuffled = G.buildAll(rev, NOW);
  assert(accts.every(a => shuffled.slices[a].h === built.slices[a].h), 'from records held in another order: the same hashes');
  const parsed = G.buildAll(C.store, NOW);
  assert(accts.every(a => parsed.slices[a].h === built.slices[a].h), 'as stored text or as values: the same hashes');
  assertEq(G.buildSlice(C.asStrings, accts[4], NOW).h, built.slices[accts[4]].h, 'one slice built alone is the same as in the whole pass');
  assert(new Set(accts.map(a => built.slices[a].h)).size === accts.length, 'every trainee\'s slice is their own');
  const s = built.slices[accts[0]].slice;
  assertEq(s.hash, G.hashOf({ version: 1, accountId: s.accountId, studentId: s.studentId, settings: s.settings, data: s.data,
    tombstones: s.tombstones, access: s.access }), 'the hash covers the content, not when or where it was built');
  const st = JSON.parse(JSON.stringify(C.store));
  st.voctrain_announcements.find(a => a.id === 'AN-1').title = 'Welding safety week (moved)';
  const changed = G.buildAll(st, NOW);
  assert(changed.slices[accts[0]].h !== built.slices[accts[0]].h && changed.slices[accts[1]].h === built.slices[accts[1]].h,
    'an edit changes the slices it reaches, and only those');
}

/* ------------------------------------------------------------- maxStamp */
console.log('maxStamp: a device that has not seen an edit never out-ranks one that has');
{
  const base = built.s;
  assert(base > 0 && accts.every(a => built.slices[a].s === base && built.slices[a].slice.maxStamp === base), 'one newest moment, on every slice');
  const st = JSON.parse(JSON.stringify(C.store));
  // An announcement for ANOTHER programme is edited: trainee 0's slice does not change, its maxStamp does.
  st.voctrain_announcements.find(a => a.id === 'AN-4').updatedAt = iso(NOW - 60000);
  const newer = G.buildAll(st, NOW);
  assertEq(newer.slices[accts[0]].h, built.slices[accts[0]].h, 'trainee 0\'s slice is unchanged by another programme\'s notice');
  assertEq(newer.slices[accts[0]].s, NOW - 60000, 'but its maxStamp is the newest stamp the builder looked at');
  // Re-targeted away from this programme: gone from the slice, and the device that saw it out-ranks one that did not.
  const moved = JSON.parse(JSON.stringify(C.store));
  Object.assign(moved.voctrain_announcements.find(a => a.id === 'AN-1'), { course: C.PROGRAMMES[1].name, updatedAt: iso(NOW - 30000) });
  const fresh = G.buildAll(moved, NOW).slices[accts[0]];
  const stale = built.slices[accts[0]];
  assert(fresh.slice.data.voctrain_announcements.every(a => a.id !== 'AN-1'), 'a notice moved to another programme leaves the slice');
  assertEq(G.publishDecision({ h: stale.h, s: stale.s }, { h: fresh.h, s: fresh.s }), 'behind', 'the device that has not seen the move waits');
  assertEq(G.publishDecision({ h: fresh.h, s: fresh.s }, { h: stale.h, s: stale.s }), 'write', 'the one that has, writes');
  // A clock a day ahead is not news.
  const skew = JSON.parse(JSON.stringify(C.store));
  skew.voctrain_announcements[0].updatedAt = iso(NOW + 3 * DAY);
  assertEq(G.buildAll(skew, NOW).s, base, 'a stamp more than a day ahead is ignored');
  // A deletion is an edit too.
  const del = JSON.parse(JSON.stringify(C.store));
  del.voctrain_syncTombstones.adminMeetings = { 'M-1': iso(NOW - 1000) };
  assertEq(G.buildAll(del, NOW).s, NOW - 1000, 'the time a deletion was written down counts');
  // A result moved to another trainee raises every slice's stamp.
  const re = JSON.parse(JSON.stringify(C.store));
  Object.assign(re.voctrain_examResults[0], { studentId: C.trainees[3].stu.id, updatedAt: iso(NOW - 500) });
  const reB = G.buildAll(re, NOW);
  assert(reB.slices[accts[0]].s === NOW - 500 && reB.slices[accts[0]].h !== built.slices[accts[0]].h, 'a result moved away: newer stamp, new content');
  assertEq(G.publishDecision({ h: 'h1-a', s: 5 }, { h: 'h1-a', s: 9 }), 'skip', 'the same content is never written twice');
  assertEq(G.publishDecision({ h: 'h1-b', s: 5 }, { h: 'h1-a', s: 5 }), 'write', 'the same moment: the higher hash writes');
  assertEq(G.publishDecision({ h: 'h1-a', s: 5 }, { h: 'h1-b', s: 5 }), 'keep', 'and the lower keeps what is there — the two never take turns');
  assertEq(G.publishDecision({ h: 'h1-a', s: 5 }, null), 'write', 'nothing published yet: write');
}

/* ------------------------------------------------------ papers and keys */
console.log('A paper never carries a key; a key file does; a draft has neither');
{
  const p = built.papers.EX1, k = built.keys.EX1;
  assertEq(Object.keys(built.papers).sort(), ['EX1', 'EX1-OLD', 'EX2', 'EX2-OLD', 'EX3', 'EX3-OLD'], 'papers for the exams some trainee may sit, no draft');
  assertEq(Object.keys(built.keys).sort(), Object.keys(built.papers).sort(), 'and a key file for each');
  const ptext = JSON.stringify(p.paper);
  assert(['"correctAnswer"', '"pairs"', '"distractors"', '"tolerance"'].every(x => ptext.indexOf(x) === -1), 'the paper has no key of any kind');
  const m = p.paper.questions.find(q => q.type === 'match');
  assertEq([m.rows, m.choices], [['Cuts', 'Joins'], ['Grinder', 'Hammer', 'Torch']], 'a matching question carries its prompts and choices');
  assertEq([p.paper.format, p.paper.examId, p.h === p.paper.hash], ['cestis-exam-paper', 'EX1', true], 'it says what it is');
  assertEq(k.key.exam.questionData, C.examById.EX1.questionData, 'the key file holds the whole question bank');
  assertEq([k.key.format, k.key.centreUtcOffset], ['cestis-exam-key', '-05:00'], 'with the Centre\'s time zone');
  assertEq(G.buildPaper(C.examById.EX1, NOW + 9999).hash, p.h, 'a paper\'s hash does not depend on when it was built');
  assert(G.paperOpen(k.key, NOW) && !G.paperOpen(k.key, NOW - DAY) && !G.paperOpen(k.key, NOW + DAY), 'the paper is served only while the exam is open');
  const room = built.rooms['chat-class-101'].room;
  assertEq(room.members.length, 15, 'a class room\'s own file lists its members (served to them only)');
  assertEq([room.format, room.messages.length], ['cestis-chat-room', 4], 'and its messages');
  assert(!built.rooms[C.dmPeer], 'a room no slice lists has no file');
}

/* ------------------------------------------------- the programme rule */
console.log('The programme rule is the dashboard\'s own (instructorCourseMatch is a wrapper now)');
{
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  function extractFunction(src, name) {
    const m = new RegExp('(async )?function ' + name + '\\(').exec(src);
    if (!m) throw new Error('index.html no longer defines ' + name + '()');
    let depth = 0;
    for (let i = src.indexOf('{', m.index); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
    }
    throw new Error('unbalanced');
  }
  const wrapper = extractFunction(INDEX, 'instructorCourseMatch');
  assert(/CESTISCore\.enrolment\.courseMatch\(studentCourse, instructorCourse, findSkillAreaForCourse\)/.test(wrapper) && wrapper.split('\n').length <= 4,
    'index.html\'s instructorCourseMatch is a thin wrapper of the shared rule');
  // The function as it was, word for word, before it moved.
  const BEFORE = 'function instructorCourseMatchBefore(studentCourse, instructorCourse) {\n' +
    '  if (!studentCourse || !instructorCourse) return false;\n' +
    '  if (studentCourse.toLowerCase().trim() === instructorCourse.toLowerCase().trim()) return true;\n' +
    '  var stuSk = findSkillAreaForCourse(studentCourse);\n' +
    '  var insSk = findSkillAreaForCourse(instructorCourse);\n' +
    '  return stuSk && insSk && stuSk.id && insSk.id && stuSk.id === insSk.id;\n}';
  const ctx = { CESTISCore: Core, console, Date, Object, Array, String, JSON, Math };
  vm.createContext(ctx);
  vm.runInContext('var skillAreas = ' + JSON.stringify([{ id: 1, name: 'Welding & Fabrication' }, { id: 2, name: 'Electrical Installation' },
    { id: 3, name: 'Commercial Cooking' }, { id: 4, name: '02. Welding and Fabrication Level 2', startDate: '2026-09-01' }, { id: 0, name: 'Nothing' },
    { id: 5, name: 'Information Technology' }, { id: 6, name: 'Solar Energy Tech' }]) + ';\nvar certTemplates = { "Plumbing": { courseFullName: "Plumbing and Pipe Systems" } };\n' +
    extractFunction(INDEX, 'findSkillAreaForCourse') + '\n' + wrapper + '\n' + BEFORE, ctx);
  const courses = ['Welding', 'WELDING L2', 'Welding & Fabrication', 'welding and fabrication level 2', '02. Welding and Fabrication Level 2',
    'Electrical Installation', 'ELECTRICAL L3', 'Commi Chef L2', 'Commercial Cooking', 'Culinary Arts', 'Plumbing', 'Pipe Systems',
    'Information Technology', 'IT', 'Solar Energy', 'Photovoltaic Installer', 'Hospitality', '', null, undefined, 'Nothing', ' welding '];
  let same = 0, differ = [], bySkill = 0, no = 0;
  courses.forEach(a => courses.forEach(b => {
    const x = ctx.instructorCourseMatch(a, b), y = ctx.instructorCourseMatchBefore(a, b);
    if (Object.is(x, y)) same++; else differ.push(JSON.stringify([a, b, x, y]));
    if (x && a && b && String(a).toLowerCase().trim() !== String(b).toLowerCase().trim()) bySkill++;
    if (!x) no++;
  }));
  assert(bySkill >= 10 && no >= 100, 'the pairs include matches by training centre (' + bySkill + ') and non-matches (' + no + ')');
  assertEq(differ.slice(0, 3), [], 'the wrapper answers exactly as the function it replaced, value for value (' + same + ' pairs)');
  assertEq(Core.enrolment.courseMatch('Welding', 'welding ', null), true, 'the exact name needs no training centres');
  assertEq(Core.enrolment.courseMatch('Welding', 'Plumbing', null), false, 'and without a way to find them, different names do not match');
}

/* ------------------------------------------------ former student IDs */
/* A student ID is a hash of the name and the programme: a rename or a
   transfer moves it. The dashboard moves the records it holds then, but a
   result marked since on a lab PC that still knew the old ID, an assignment
   grade (no relink carries those), and a duplicate's records once the fee
   roll's stub is folded away, stayed under the old ID — and the slice, built
   by student ID alone, left them out. Each case is checked with the privacy
   back-check: never another person's records. */
console.log('Records under a student ID the trainee had before reach them — and never anybody else\'s');
{
  const st = JSON.parse(JSON.stringify(C.store));
  const P0 = C.PROGRAMMES[0].name, P1 = C.PROGRAMMES[1].name;
  const OWNED = ['voctrain_examResults', 'voctrain_examAttempts', 'voctrain_attendanceRegister', 'voctrain_submissions', 'voctrain_transcriptGrades',
    'voctrain_certTranscriptRequests', 'voctrain_certDownloadApprovals'];
  const ids = (s, k) => s.data[k].map(r => r.id).sort();

  // A rename: the office renamed Odalys; her record and account moved to the new ID there.
  const RN = C.trainees[6], oldRN = RN.stu.id, newName = 'Odalys Lindo-Brown';
  const recRN = st.voctrain_students.find(s => s.id === oldRN);
  recRN.name = newName; recRN.id = Core.stableStudentId(recRN);
  const newRN = recRN.id;
  Object.assign(st.voctrain_users.find(u => u.id === RN.acct.id), { name: newName, studentDataId: newRN });
  const blind = G.buildSlice(st, RN.acct.id, NOW).slice;
  assertEq([blind.studentId, blind.data.voctrain_examResults.length, blind.data.voctrain_attendanceRegister.length], [newRN, 0, 0],
    'a rename: with nothing to say where her old ID went, her old records stay out (never guessed)');
  const moved = { [oldRN]: newRN };
  const r1 = G.buildSlice(st, RN.acct.id, NOW, { relinked: moved }), s1 = r1.slice, d1 = s1.data;
  assertEq([ids(s1, 'voctrain_examResults'), ids(s1, 'voctrain_examAttempts'), ids(s1, 'voctrain_submissions'), ids(s1, 'voctrain_transcriptGrades'),
    d1.voctrain_attendanceRegister.length, d1.voctrain_certTranscriptRequests.length, d1.voctrain_certDownloadApprovals.length],
  [['RES-' + RN.acct.id], ['ATT-' + RN.acct.id], ['SUB-' + RN.acct.id], ['TG-' + RN.acct.id], 3, 1, 1],
  'with the move the dashboard made (opts.relinked): her result, attempt, submission, grades, register, request and approval');
  assert(OWNED.every(k => d1[k].every(r => r.studentId === newRN)), '— each under the ID she has today');
  const asg = d1.voctrain_assignments[0];
  assertEq([Object.keys(asg.grades), Object.keys(asg.feedback), asg.gradeLog.map(g => g.studentId)], [[newRN], [newRN], [newRN]],
    'her assignment grade, its feedback and history, which no relink carries');
  assertEq([Object.keys(d1.voctrain_transcriptProfiles), Object.keys(d1.voctrain_studentProfiles).sort()], [[newRN], [RN.acct.id, newRN].sort()],
    'her transcript header and profile, under today\'s ID');
  assertEq(r1.scrubbed, 0, 'the rules alone place them (the sweep takes nothing)');
  const st2 = JSON.parse(JSON.stringify(st));
  st2.voctrain_examAttempts.find(a => a.id === 'ATT-' + RN.acct.id).accountId = RN.acct.id;   // as an attempt made through the gate carries it
  assertEq(ids(G.buildSlice(st2, RN.acct.id, NOW).slice, 'voctrain_examResults'), ['RES-' + RN.acct.id],
    'or, with no move kept, a record of hers naming her account under the old ID says the old ID was hers');

  // A duplicate the fee roll made: a second record for Akeem and a stub account for it.
  const FD = C.trainees[12], dupId = 'STU1761000000123';
  st.voctrain_students.push({ id: dupId, name: FD.stu.name, course: P0, stage: 'training', schoolFeeId: 'SF-DUP-1' });
  st.voctrain_users.push({ id: 'USR-FEE-1761000000-1', name: FD.stu.name, role: 'student', username: 'akeem.henry', password: '', email: '',
    programme: P0, status: 'disabled', registeredVia: 'fee-system', studentDataId: dupId, approvedBy: 'system', createdAt: '2026-10-01' });
  st.voctrain_attendanceRegister.push({ id: 'REG-DUP-1', studentId: dupId, studentName: FD.stu.name, course: P0, date: '2026-10-28', status: 'present' });
  st.voctrain_transcriptGrades.push({ id: 'TG-DUP-1', studentId: dupId, qualId: 'CAT-1', unitCode: 'U2', grade: 'B', updatedAt: iso(NOW - DAY) });
  // …and one whose record the roll has already dropped, folded on this PC: its copy deleted, the fold log kept.
  const gone = 'STU-' + 'g0n3dup';
  st.voctrain_users.push({ id: 'USR-FEE-1761000000-2', name: FD.stu.name, role: 'student', username: 'akeem.henry2', password: '', email: '',
    programme: P0, status: 'disabled', registeredVia: 'fee-system', studentDataId: gone, approvedBy: 'system' });
  st.voctrain_deletedUserIds.push('USR-FEE-1761000000-2');
  st.voctrain_attendanceRegister.push({ id: 'REG-DUP-2', studentId: gone, studentName: FD.stu.name, course: P0, date: '2026-10-29', status: 'present' });
  // …and a chat-roster stub nothing holds any more: only the fold log and its own id say whose record it linked.
  const gone3 = 'STU-' + 'g0n3dup3';
  st.voctrain_attendanceRegister.push({ id: 'REG-DUP-3', studentId: gone3, studentName: FD.stu.name, course: P0, date: '2026-10-30', status: 'present' });
  const folds = { 'USR-FEE-1761000000-2': { mergedInto: FD.acct.id }, ['USR-SYNC-' + gone3]: { mergedInto: FD.acct.id } };

  // Near misses — different people, who must NOT be merged:
  //  another Akeem Henry, on another programme, with his own account, records and fee stub;
  const AH = { id: Core.stableStudentId({ name: FD.stu.name, course: P1 }), name: FD.stu.name, course: P1, stage: 'training', email: 'akeem.two@mail.test' };
  st.voctrain_students.push(AH);
  st.voctrain_users.push({ id: 'USR-AH2', name: AH.name, role: 'student', username: 'akeem2', email: AH.email, programme: P1, status: 'active',
    studentDataId: AH.id, password: C.trainees[1].acct.password });
  st.voctrain_users.push({ id: 'USR-FEE-1761000000-3', name: AH.name, role: 'student', username: 'akeem.henry3', password: '', email: '',
    programme: P1, status: 'disabled', registeredVia: 'fee-system', studentDataId: 'STU1761000000999', approvedBy: 'system' });
  st.voctrain_attendanceRegister.push({ id: 'REG-AH2', studentId: AH.id, studentName: AH.name, course: P1, date: '2026-10-28', status: 'present' });
  st.voctrain_attendanceRegister.push({ id: 'REG-AH2-STUB', studentId: 'STU1761000000999', studentName: AH.name, course: P1, date: '2026-10-29', status: 'present' });
  //  a namesake of Fabian on his own programme, pinned by the office as his own person (no account yet);
  const FP = C.trainees[15];
  st.voctrain_students.push({ id: 'STU-PIN-FP', name: FP.stu.name, course: P0, keepSeparate: true, stage: 'training', email: 'fabian.two@mail.test' });
  st.voctrain_attendanceRegister.push({ id: 'REG-PIN', studentId: 'STU-PIN-FP', studentName: FP.stu.name, course: P0, date: '2026-10-28', status: 'absent' });
  //  a result staff moved from one trainee to another, still naming the first's account;
  const A18 = C.trainees[18], B21 = C.trainees[21];
  st.voctrain_examResults.push({ id: 'RES-MOVED', examId: 'EX1-OLD', studentId: B21.stu.id, accountId: A18.acct.id, score: 70, submittedAt: iso(NOW - 9 * DAY) });
  //  an old ID two trainees could each claim; a deleted trainee's; one another account links to.
  const T24 = C.trainees[24], T27 = C.trainees[27], T30 = C.trainees[30], T33 = C.trainees[33];
  st.voctrain_examAttempts.push({ id: 'ATT-ORPH', examId: 'EX1', studentId: 'STU-ORPHAN-X', accountId: T27.acct.id, status: 'submitted', updatedAt: iso(NOW - DAY) });
  st.voctrain_attendanceRegister.push({ id: 'REG-ORPH', studentId: 'STU-ORPHAN-X', course: P0, date: '2026-10-28', status: 'present' });
  st.voctrain_deletedStudentIds.push('STU-GONE-1');
  st.voctrain_attendanceRegister.push({ id: 'REG-GONE', studentId: 'STU-GONE-1', course: P0, date: '2026-10-28', status: 'present' });
  st.voctrain_users.find(u => u.id === C.pending.id).studentDataId = 'STU-PEND-1';
  st.voctrain_attendanceRegister.push({ id: 'REG-PEND', studentId: 'STU-PEND-1', course: P0, date: '2026-10-28', status: 'present' });
  Object.assign(moved, { 'STU-ORPHAN-X': T24.stu.id, 'STU-GONE-1': T30.stu.id, 'STU-PEND-1': T33.stu.id, [B21.stu.id]: A18.stu.id });
  // (the namesakes' certificate and score notices name both of them; they are not what this checks)
  st.voctrain_notifications = st.voctrain_notifications.filter(n => [FD, FP].every(t => n.id.indexOf(t.acct.id) === -1));

  const opts = { relinked: moved, folds };
  const ctx = G.prepare(st, NOW, opts);
  const all = G.buildAll(st, NOW, opts);
  const sl = acct => all.slices[acct].slice;
  const reg = acct => sl(acct).data.voctrain_attendanceRegister.map(r => r.id).sort();
  assertEq(reg(FD.acct.id), ['REG-' + FD.acct.id + '-1', 'REG-' + FD.acct.id + '-2', 'REG-' + FD.acct.id + '-3', 'REG-DUP-1', 'REG-DUP-2', 'REG-DUP-3'].sort(),
    'a fold: the duplicate\'s marks reach Akeem — a live duplicate (the dashboard\'s identity rule, its stub folded into him), one whose stub was folded here (the fold log), and one only a stub\'s id still names');
  assertEq(ids(sl(FD.acct.id), 'voctrain_transcriptGrades'), ['TG-' + FD.acct.id, 'TG-DUP-1'].sort(), 'with the duplicate\'s grades');
  assert(sl(FD.acct.id).data.voctrain_attendanceRegister.every(r => r.studentId === FD.stu.id), '— each under his ID today');
  assertEq(reg('USR-AH2'), ['REG-AH2', 'REG-AH2-STUB'], 'near miss: the other Akeem Henry (another programme) keeps his own, his own stub\'s included');
  assert(reg(FD.acct.id).indexOf('REG-AH2') === -1 && reg(FD.acct.id).indexOf('REG-AH2-STUB') === -1, '— and nothing of his reaches the first Akeem');
  assert(reg(FP.acct.id).indexOf('REG-PIN') === -1, 'near miss: a namesake the office pinned as his own person is never merged in, on his programme or not');
  // (Stage 1's last-line sweep takes it out of B's slice too, as it names another trainee's account: counted below.)
  assertEq(ids(sl(A18.acct.id), 'voctrain_examResults').indexOf('RES-MOVED'), -1,
    'near miss: a result staff moved to another trainee never comes back to the first, though it still names the first one\'s account');
  assert(reg(B21.acct.id).every(r => r.indexOf(A18.acct.id) === -1) && reg(A18.acct.id).every(r => r.indexOf(B21.acct.id) === -1),
    '— and a move that names another trainee\'s ID today is not taken at all');
  assert([T24, T27].every(t => reg(t.acct.id).indexOf('REG-ORPH') === -1), 'near miss: an old ID two trainees could each claim goes to neither');
  assert(ctx.formerUnsure.indexOf('STU-ORPHAN-X') !== -1, '— and is listed as unsure');
  assert(reg(T30.acct.id).indexOf('REG-GONE') === -1, 'a deleted trainee\'s ID is never taken');
  assert(reg(T33.acct.id).indexOf('REG-PEND') === -1, 'nor a record another account links to');
  assertEq(ctx.formerIds[RN.acct.id], [oldRN], 'the rename\'s old ID, and nothing more, is Odalys\'s');

  // The privacy property, again, over every slice of this Centre.
  const people = C.trainees.map(t => ({ acct: t.acct.id, stu: t === RN ? newRN : t.stu.id, name: t === RN ? newName : t.stu.name, email: t.stu.email }))
    .concat([{ acct: 'USR-AH2', stu: AH.id, name: AH.name, email: AH.email }, { acct: '', stu: 'STU-PIN-FP', name: FP.stu.name, email: 'fabian.two@mail.test' }]);
  const outsiders = ['STU-ORPHAN-X', 'REG-ORPH', 'STU-GONE-1', 'REG-GONE', 'STU-PEND-1', 'REG-PEND', 'REG-PIN'];
  let leaks = [], scrubbed = 0, wrongOwner = [];
  Object.keys(all.slices).forEach(acct => {
    const s = all.slices[acct].slice, text = JSON.stringify(s), me = people.find(p => p.acct === acct);
    scrubbed += acct === B21.acct.id ? all.slices[acct].scrubbed - 1 : all.slices[acct].scrubbed;
    people.forEach(o => {
      if (o === me) return;
      [o.acct, o.stu, o.email].concat(o.name !== me.name ? [o.name] : []).forEach(v => { if (v && text.indexOf(v) !== -1) leaks.push(acct + ' holds ' + v); });
    });
    outsiders.forEach(v => { if (text.indexOf(v) !== -1) leaks.push(acct + ' holds ' + v); });
    if (acct !== RN.acct.id && text.indexOf(oldRN) !== -1) leaks.push(acct + ' holds Odalys\'s old ID');
    if (acct !== FD.acct.id && [dupId, gone, gone3, 'REG-DUP'].some(v => text.indexOf(v) !== -1)) leaks.push(acct + ' holds the duplicate\'s');
    OWNED.forEach(k => s.data[k].forEach(r => { if (r.studentId !== s.studentId) wrongOwner.push(acct + ' ' + k + ' ' + r.id); }));
  });
  assertEq(leaks.slice(0, 5), [], 'no slice holds another person\'s id, name, email or records — the renamed, the folded and the near misses included');
  assertEq(wrongOwner.slice(0, 5), [], 'every record a slice holds is filed under that slice\'s own student ID');
  assertEq([scrubbed, all.slices[B21.acct.id].scrubbed], [0, 1], 'and the rules alone keep it so (the sweep takes nothing but the moved result naming another account)');
  const plain = G.buildAll(C.store, NOW, opts);
  assert(accts.every(a => plain.slices[a].h === built.slices[a].h), 'on the Centre with none of this, the same slices as before, byte for byte');
}

/* ------------------------------------------------------ both builds */
console.log('The offline build carries the same rules');
{
  const Off = require('../Offline System/cestis-core.js');
  const b2 = Off.gate.buildAll(C.asStrings, NOW, { builtBy: 'dev-test' });
  assert(accts.every(a => b2.slices[a].h === built.slices[a].h), 'the Centre\'s own machine builds the same slices');
  assertEq(Off.gate.selfTest(crypto).ok, true, 'and passes the self-test');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
