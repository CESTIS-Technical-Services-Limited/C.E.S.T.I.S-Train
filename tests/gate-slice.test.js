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
