/* A Centre to test the trainee gate against, and Node's cryptography in the
   shape Core.gate asks for. Not a test itself: the gate-*.test.js suites
   require it.

   makeCentre(Core) builds 40 trainees in 3 programmes, with everything a
   trainee's records can touch — accounts with password checks, two-step
   secrets and backup codes; exams of every question type (with their keys),
   marked results, attempts in progress and submitted; the dated register;
   assignments carrying every trainee's grade; submissions; announcements,
   notices, calendar events, classes and video classes; resources; transcript
   grades, profiles and requests; certificate templates and approvals;
   profiles; support messages; class rooms, direct conversations and their
   messages; and the deletions written down for all of them. Every value that
   identifies a trainee is unique and never part of another, so a plain
   text search of a slice proves it is not there. */
'use strict';

const nodeCrypto = require('crypto');

const crypto = {
  hmacHex: (keyBytes, msg) => nodeCrypto.createHmac('sha256', Buffer.from(keyBytes)).update(String(msg), 'utf8').digest('hex'),
  sha256Hex: msg => nodeCrypto.createHash('sha256').update(String(msg), 'utf8').digest('hex'),
  sha1Bytes: bytes => Array.from(nodeCrypto.createHash('sha1').update(Buffer.from(bytes)).digest())
};

const FIRST = ['Kemar', 'Rushane', 'Kadian', 'Tameka', 'Shanique', 'Dwayne', 'Odalys', 'Jhenelle', 'Romario', 'Tashoya',
  'Akeem', 'Brianna', 'Chevaughn', 'Dalvia', 'Everton', 'Fabian', 'Gaynelle', 'Horace', 'Imani', 'Jovaun',
  'Kerry-Ann', 'Leroy', 'Mikhail', 'Nordia', 'Oneil', 'Petagaye', 'Quacey', 'Rohan', 'Sashana', 'Tyrone',
  'Udean', 'Venessa', 'Wayne', 'Xaviera', 'Yanique', 'Zachariah', 'Annmarie', 'Bertram', 'Collette', 'Damion'];
const LAST = ['Williams', 'Grant', 'Morgan', 'Richards', 'Campbell', 'Thompson', 'Lindo', 'Facey', 'Bailey', 'Gordon',
  'Henry', 'Lewis', 'Reid', 'Wright', 'Mullings', 'Palmer', 'Spence', 'Bryan', 'Clarke', 'Daley',
  'Ellis', 'Francis', 'Gayle', 'Hamilton', 'Ingram', 'Johnson', 'Kerr', 'Lawrence', 'McKenzie', 'Nelson',
  'Ormsby', 'Powell', 'Quarrie', 'Robinson', 'Stewart', 'Taylor', 'Usher', 'Vassell', 'Walker', 'Young'];

const PROGRAMMES = [
  { name: 'Welding and Fabrication Level 2', sk: 101 },
  { name: 'Electrical Installation Level 2', sk: 102 },
  { name: 'Commercial Cooking Level 2', sk: 103 }
];
const NOW = Date.parse('2026-11-02T15:00:00.000Z');          // 10:00 Centre time
const iso = ms => new Date(ms).toISOString();
const MIN = 60000, DAY = 86400000;

function pbkdf2(pw, saltHex, iter) {
  return 'pbkdf2$' + iter + '$' + saltHex + '$' + nodeCrypto.pbkdf2Sync(pw, Buffer.from(saltHex, 'hex'), iter, 32, 'sha256').toString('hex');
}

function questionBank(tag) {
  return [
    { id: tag + '-Q0', type: 'info', text: 'Read the following carefully.', points: 0 },
    { id: tag + '-Q1', type: 'mcq', text: 'Which gas shields MIG welds?', options: ['Argon', 'Oxygen', 'Hydrogen'], correctAnswer: 0, points: 2 },
    { id: tag + '-Q2', type: 'tf', text: 'Goggles are optional.', correctAnswer: false, points: 1 },
    { id: tag + '-Q3', type: 'multi', text: 'Choose the PPE.', options: ['Gloves', 'Sandals', 'Helmet', 'Shorts'], correctAnswer: [0, 2], points: 2 },
    { id: tag + '-Q4', type: 'match', text: 'Match the tool.', pairs: [{ prompt: 'Cuts', answer: 'Grinder' }, { prompt: 'Joins', answer: 'Torch' }],
      distractors: ['Hammer'], points: 2 },
    { id: tag + '-Q5', type: 'shortanswer', text: 'Name the arrestor.', correctAnswer: ['flashback arrest*'], points: 2 },
    { id: tag + '-Q6', type: 'numerical', text: 'Amps for 3 mm rod?', correctAnswer: 110, tolerance: 5, points: 2 },
    { id: tag + '-Q7', type: 'fill', text: 'A ___ joint.', correctAnswer: 'butt', points: 1 },
    { id: tag + '-Q8', type: 'essay', text: 'Describe a safe workshop.', points: 5 }
  ];
}

function makeCentre(Core, opts) {
  opts = opts || {};
  const N = opts.trainees || 40;
  const skillAreas = PROGRAMMES.map(p => ({ id: p.sk, name: p.name, icon: 'x', students: 0, startDate: '2026-09-01', endDate: '2027-07-31' }));
  const staff = [
    { id: 'USR-ADMIN1', name: 'Marcia Administrator', role: 'admin', username: 'admin1', email: 'admin1@centre.test', status: 'active',
      password: pbkdf2('admin-pw', '00112233445566778899aabbccddeeff', 1000) },
    ...PROGRAMMES.map((p, i) => ({ id: 'USR-INS' + (i + 1), name: 'Instructor Teachwell' + 'ABC'[i], role: 'instructor', username: 'ins' + (i + 1),
      email: 'ins' + (i + 1) + '@centre.test', status: 'active', programme: p.name, password: pbkdf2('ins-pw', '0011223344556677', 1000) }))
  ];
  const trainees = [];
  for (let i = 0; i < N; i++) {
    const p = PROGRAMMES[i % 3];
    const name = FIRST[i] + ' ' + LAST[i];
    const n = String(i + 1).padStart(2, '0');
    const stu = { id: null, name, course: p.name, stage: 'training', email: FIRST[i].toLowerCase() + '.' + LAST[i].toLowerCase() + '@mail.test',
      instructor: 'Instructor Teachwell' + 'ABC'[i % 3], lastModified: iso(NOW - (50 - i) * DAY), progress: 40, attendance: 90 };
    stu.id = Core.stableStudentId(stu);
    const salt = nodeCrypto.createHash('md5').update('salt' + i).digest('hex');
    const acct = { id: 'USR-T' + n, name, role: 'student', username: FIRST[i].toLowerCase() + n, email: stu.email,
      programme: p.name, status: 'active', studentDataId: stu.id, createdAt: iso(NOW - 60 * DAY),
      password: i % 5 === 4 ? nodeCrypto.createHash('sha256').update('pw' + i + '__CESTIS_SALT_2026__').digest('hex') : pbkdf2('pw' + i, salt, 1000) };
    if (i % 4 === 0) {
      acct.twoFactorEnabled = true;
      acct.twoFactorSecret = 'JBSWY3DPEHPK3P' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.charAt(i % 32) + 'Q' + n.replace(/0/g, 'A').replace(/1/g, 'B');
      acct.backupCodes = [0, 1, 2].map(k => ({ code: 'BC' + n + 'K' + k + 'ZQ', used: false }));
      acct.twoFactorUpdatedAt = iso(NOW - 10 * DAY);
    }
    trainees.push({ i, p, stu, acct, pw: 'pw' + i });
  }
  // A pending registration and a backfill stub: no slice for either.
  const pending = { id: 'USR-PEND', name: 'Pendleton Waitingly', role: 'student', status: 'pending', email: 'pend@mail.test',
    programme: PROGRAMMES[0].name, password: pbkdf2('x', 'aa', 1000) };
  const stub = { id: 'USR-SYNC-' + trainees[0].stu.id, name: trainees[0].stu.name, role: 'student', status: 'disabled', password: '',
    email: '', programme: trainees[0].p.name, registeredVia: 'fee-system', studentDataId: trainees[0].stu.id, approvedBy: 'system' };

  const exams = [];
  PROGRAMMES.forEach((p, k) => {
    const tag = 'EX' + (k + 1);
    exams.push({ id: tag, title: p.name + ' theory', course: p.name, date: '2026-11-02', time: '09:00', duration: 90, passMark: 60,
      status: 'upcoming', questionsPerPage: 3, shuffleQuestions: true, shuffleOptions: true, answersRelease: 'after-close',
      questionData: questionBank(tag), questions: 8, students: 13, createdBy: 'Marcia Administrator', updatedAt: iso(NOW - 5 * DAY) });
    exams.push({ id: tag + '-OLD', title: p.name + ' mid-term', course: p.name, date: '2026-10-01', time: '09:00', duration: 60, passMark: 50,
      status: 'completed', questionData: questionBank(tag + 'O'), questions: 8, updatedAt: iso(NOW - 30 * DAY) });
    exams.push({ id: tag + '-DRAFT', title: 'Not yet', course: p.name, date: '2026-12-01', time: '09:00', duration: 60, passMark: 50,
      status: 'draft', questionData: questionBank(tag + 'D'), updatedAt: iso(NOW - 2 * DAY) });
  });
  const examById = {};
  exams.forEach(e => { examById[e.id] = e; });

  const results = [], attempts = [], register = [], submissions = [], tgrades = [], requests = [], approvals = [], support = [];
  const tprofiles = {}, sprofiles = {};
  trainees.forEach(t => {
    const old = examById['EX' + (PROGRAMMES.indexOf(t.p) + 1) + '-OLD'];
    const qs = Core.exams.attemptQuestions(old.questionData, {});
    const answers = qs.map((q, j) => (q.type === 'mcq' ? 0 : q.type === 'tf' ? false : q.type === 'multi' ? [0, 2] :
      q.type === 'match' ? ['Grinder', 'Torch'] : q.type === 'numerical' ? '112' : q.type === 'shortanswer' ? 'Flashback arrestor' : j === 7 ? 'butt' : null));
    const m = Core.exams.mark(qs, answers, old.questionData);
    results.push({ id: 'RES-' + t.acct.id, examId: old.id, studentId: t.stu.id, studentName: t.stu.name, answers: m.gradedResults,
      score: 80, totalPoints: m.totalPoints, earnedPoints: m.earnedPoints, passed: true, submittedAt: iso(NOW - 31 * DAY),
      gradedBy: 'Instructor Teachwell' + 'ABC'[t.i % 3] });
    if (t.i % 3 === 0) {
      const ex = examById['EX' + (PROGRAMMES.indexOf(t.p) + 1)];
      const aq = Core.exams.attemptQuestions(ex.questionData, {});
      attempts.push({ id: 'ATT-' + t.acct.id, examId: ex.id, studentId: t.stu.id, studentName: t.stu.name, questions: aq,
        answers: aq.map(() => null), flagged: aq.map(() => false), answeredAt: aq.map(() => 0), flaggedAt: aq.map(() => 0),
        startTime: NOW - 20 * MIN, deadline: NOW + 70 * MIN, status: 'open', updatedAt: iso(NOW - 5 * MIN) });
    }
    if (t.i % 3 === 1) attempts.push({ id: 'ATT-R-' + t.acct.id, examId: old.id, studentId: t.stu.id, status: 'submitted',
      submittedAt: iso(NOW - 31 * DAY), resultId: 'RES-' + t.acct.id, updatedAt: iso(NOW - 31 * DAY) });
    for (let d = 1; d <= 3; d++) register.push({ id: 'REG-' + t.acct.id + '-' + d, studentId: t.stu.id, studentName: t.stu.name,
      course: t.p.name, date: '2026-10-2' + d, status: d === 2 ? 'absent' : 'present', markedBy: 'ins', updatedAt: iso(NOW - (10 - d) * DAY) });
    submissions.push({ id: 'SUB-' + t.acct.id, assignmentId: 'ASG-' + (PROGRAMMES.indexOf(t.p) + 1), studentId: t.stu.id,
      studentName: t.stu.name, submittedAt: iso(NOW - 3 * DAY), comment: 'Done', driveFiles: [{ driveFileId: 'FILE-' + t.acct.id, name: 'work.pdf' }] });
    tgrades.push({ id: 'TG-' + t.acct.id, studentId: t.stu.id, qualId: 'CAT-' + (PROGRAMMES.indexOf(t.p) + 1), unitCode: 'U1', grade: 'C',
      updatedAt: iso(NOW - 8 * DAY) });
    tprofiles[t.stu.id] = { dob: '2001-0' + (1 + t.i % 9) + '-11', address: (t.i + 1) + ' Old Hope Road', idNo: 'TRN' + (100000 + t.i), updatedAt: iso(NOW - 9 * DAY) };
    sprofiles[t.acct.id] = { name: t.stu.name, phone: '876-555-' + String(1000 + t.i), updatedAt: iso(NOW - 9 * DAY) };
    sprofiles[t.stu.id] = { name: t.stu.name, email: t.stu.email, phone: '876-555-' + String(1000 + t.i) };
    requests.push(Object.assign(Core.Transcript.newRequest({ studentId: t.stu.id, studentName: t.stu.name, course: t.p.name, type: 'transcript',
      requestedAt: iso(NOW - 4 * DAY) }), {}));
    approvals.push({ studentId: t.stu.id, name: t.stu.name, course: t.p.name, approved: t.i % 2 === 0, updatedAt: iso(NOW - 6 * DAY) });
    if (t.i % 2 === 0) support.push({ id: 'SUP-' + t.acct.id, accountId: t.acct.id, studentId: t.stu.id, name: t.stu.name, email: t.stu.email,
      subject: 'Login', message: 'Please help', timestamp: NOW - 2 * DAY, read: false, replied: false, delivered: true });
  });
  // A support message from the public form (no account): nobody's slice.
  support.push({ id: 'SUP-PUBLIC', name: 'A Visitor', email: 'visitor@mail.test', subject: 'Fees', message: 'How much?', timestamp: NOW - DAY });

  const assignments = PROGRAMMES.map((p, k) => {
    const mine = trainees.filter(t => t.p === p);
    const grades = {}, gradeMeta = {}, feedback = {};
    mine.forEach(t => { grades[t.stu.id] = 7 + (t.i % 3); gradeMeta[t.stu.id] = { gradedBy: 'ins', gradedAt: iso(NOW - 2 * DAY) }; feedback[t.stu.id] = 'Good work ' + t.stu.name; });
    return { id: 'ASG-' + (k + 1), title: 'Project ' + (k + 1), course: p.name, dueDate: '2026-11-20', maxPoints: 10, grades, gradeMeta, feedback,
      gradeLog: mine.map(t => ({ studentId: t.stu.id, points: grades[t.stu.id], gradedBy: 'ins', gradedAt: iso(NOW - 2 * DAY) })),
      files: [{ name: 'brief.pdf', driveFileId: 'FILE-BRIEF-' + (k + 1) }], updatedAt: iso(NOW - 2 * DAY) };
  });
  const everyone = trainees.map(t => t.acct.id);
  const announcements = [
    { id: 'AN-1', title: 'Welding safety week', body: 'Bring goggles.', course: PROGRAMMES[0].name, forRoles: ['student'], date: '2026-11-01',
      priority: 'normal', author: 'Marcia Administrator', readBy: everyone.slice(0, 20), updatedAt: iso(NOW - DAY) },
    { id: 'AN-2', title: 'Centre closed Friday', body: 'Public holiday.', forRoles: ['admin', 'instructor', 'student'], date: '2026-11-01',
      priority: 'urgent', author: 'Marcia Administrator', readBy: everyone, updatedAt: iso(NOW - DAY) },
    { id: 'AN-3', title: 'Staff meeting', body: 'Staff only.', forRoles: ['admin', 'instructor'], date: '2026-11-01', priority: 'normal',
      author: 'Marcia Administrator', updatedAt: iso(NOW - DAY) },
    { id: 'AN-4', title: 'Electrical exam room', body: 'Room 4.', course: PROGRAMMES[1].name, forRoles: ['student'], date: '2026-11-02',
      priority: 'normal', author: 'Marcia Administrator', updatedAt: iso(NOW - 3 * DAY) }
  ];
  const notifications = [
    { id: 'N-ALL', text: 'New announcement: "Centre closed Friday" (URGENT)', forRoles: ['admin', 'instructor', 'student'], timestamp: NOW - DAY,
      read: false, readBy: everyone.slice(0, 15), clearedBy: everyone.slice(5, 9) },
    { id: 'N-STAFF', text: 'Attendance records updated', forRoles: ['instructor', 'admin'], timestamp: NOW - DAY, read: false }
  ];
  trainees.forEach(t => {
    notifications.push({ id: 'N-DM-' + t.acct.id, text: 'You have a new message', forUsers: [t.acct.id], forRoles: ['student'], timestamp: NOW - 2 * DAY,
      readBy: [t.acct.id] });
    notifications.push({ id: 'N-CERT-' + t.acct.id, text: 'Certificate issued: ' + t.stu.name + ' — ' + t.p.name, forRoles: ['admin', 'student'],
      timestamp: NOW - 3 * DAY, read: false });
    notifications.push({ id: 'N-SCORE-' + t.acct.id, text: t.stu.name + ' scored 80% on mid-term — PASSED', forRoles: ['admin', 'instructor', 'student'],
      timestamp: NOW - 4 * DAY, read: false });
  });
  const calendarEvents = [
    { id: 'CE-1', title: 'Welding practical', date: '2026-11-05', type: 'class', course: PROGRAMMES[0].name, forRoles: ['student', 'instructor'], updatedAt: iso(NOW - DAY) },
    { id: 'CE-2', title: 'Graduation', date: '2026-12-15', type: 'meeting', forRoles: ['admin', 'instructor', 'student'], updatedAt: iso(NOW - DAY) },
    { id: 'CE-3', title: 'Budget review', date: '2026-11-08', type: 'meeting', forRoles: ['admin'], updatedAt: iso(NOW - DAY) }
  ];
  const classSessions = PROGRAMMES.map((p, k) => ({ id: 'CS-' + (k + 1), name: p.name + ' class', course: p.name, date: '2026-11-02', time: '10:00',
    instructor: 'Instructor Teachwell' + 'ABC'[k], attendees: trainees.filter(t => t.p === p).map(t => ({ id: t.stu.id, name: t.stu.name })),
    updatedAt: iso(NOW - DAY) }));
  const vcSessions = PROGRAMMES.map((p, k) => ({ id: 'vcs-ROOM' + k + '-2026-11-01', code: 'ROOM' + k, title: 'Large class', course: p.name,
    hostName: 'Instructor Teachwell' + 'ABC'[k], startedAt: iso(NOW - DAY), endedAt: iso(NOW - DAY + 60 * MIN),
    participants: trainees.filter(t => t.p === p).map(t => ({ pid: 'p-' + t.acct.id, name: t.stu.name, joinedAt: iso(NOW - DAY) })), updatedAt: iso(NOW - DAY) }));
  const resources = [{ id: 'RES-I1', name: 'Welding notes', course: PROGRAMMES[0].name, category: 'document', driveFileId: 'FILE-NOTES-1' },
    { id: 'RES-I2', name: 'Centre handbook', course: 'General', category: 'guide', driveFileId: 'FILE-HANDBOOK' }];
  const driveResources = [{ id: 'DR-1', name: 'Wiring video', course: PROGRAMMES[1].name, category: 'video', driveFileId: 'FILE-VIDEO-2' }];
  const unitCatalogs = PROGRAMMES.map((p, k) => ({ id: 'CAT-' + (k + 1), title: p.name, skillArea: p.name, units: [{ code: 'U1', name: 'Safety' }],
    updatedAt: iso(NOW - 40 * DAY) }));
  const certTemplates = {};
  PROGRAMMES.forEach(p => { certTemplates[p.name] = { courseFullName: p.name, modules: ['Safety', 'Practice'], bgPage1: 'data:image/png;base64,AAAA', bgPage2: 'data:image/png;base64,BBBB' }; });
  const instructorData = PROGRAMMES.map((p, k) => ({ id: 'INS-' + (k + 1), name: 'Instructor Teachwell' + 'ABC'[k], course: p.name,
    email: 'ins' + (k + 1) + '@centre.test', phone: '876-000-000' + k, salary: 100000 }));

  const chatRooms = [], chatMessages = {};
  PROGRAMMES.forEach((p, k) => {
    const id = 'chat-class-' + p.sk;
    chatRooms.push({ id, name: p.name, icon: 'x', type: 'class', skillAreaId: p.sk,
      members: trainees.filter(t => t.p === p).map(t => t.acct.id).concat(['USR-INS' + (k + 1)]), removed: {}, leavers: {} });
    chatMessages[id] = trainees.filter(t => t.p === p).slice(0, 4).map((t, j) => ({ id: 'msg-' + k + '-' + j, roomId: id, senderId: t.acct.id,
      senderName: t.stu.name, text: 'Hello from ' + t.stu.name, type: 'text', timestamp: iso(NOW - (10 - j) * MIN), readBy: [t.acct.id] }));
  });
  const a0 = trainees[0].acct.id, a3 = trainees[3].acct.id;
  const dmStaff = 'dm-' + [a0, 'USR-INS1'].sort().join('-');
  chatRooms.push({ id: dmStaff, name: 'Direct Message', type: 'dm', members: [a0, 'USR-INS1'].sort(), dmBetween: [a0, 'USR-INS1'].sort(), createdBy: a0 });
  const dmPeer = 'dm-' + [a0, a3].sort().join('-');
  chatRooms.push({ id: dmPeer, name: 'Direct Message', type: 'dm', members: [a0, a3].sort(), dmBetween: [a0, a3].sort(), createdBy: a0 });
  chatMessages[dmPeer] = [{ id: 'msg-peer', roomId: dmPeer, senderId: a3, senderName: trainees[3].stu.name, text: 'secret', timestamp: iso(NOW - MIN) }];

  const syncTombstones = {
    announcements: { 'AN-OLD': iso(NOW - 5 * DAY), 'AN-ANCIENT': iso(NOW - 400 * DAY) },
    exams: { 'EX9': iso(NOW - 4 * DAY) },
    examResults: { ['EX1|' + trainees[1].stu.id]: iso(NOW - 2 * DAY) },
    chatRooms: { ['dm-' + [trainees[1].acct.id, trainees[4].acct.id].sort().join('-')]: iso(NOW - 2 * DAY) },
    studentProfiles: { [trainees[2].acct.id]: iso(NOW - 2 * DAY) }
  };

  const store = {
    voctrain_users: staff.concat(trainees.map(t => t.acct), [pending, stub]),
    voctrain_students: trainees.map(t => t.stu),
    voctrain_skillAreas: skillAreas,
    voctrain_exams: exams, voctrain_examResults: results, voctrain_examAttempts: attempts,
    voctrain_attendanceRegister: register, voctrain_assignments: assignments, voctrain_submissions: submissions,
    voctrain_announcements: announcements, voctrain_notifications: notifications, voctrain_calendarEvents: calendarEvents,
    voctrain_classSessions: classSessions, voctrain_vcSessions: vcSessions, voctrain_resources: resources,
    voctrain_driveResources: driveResources, voctrain_transcriptGrades: tgrades, voctrain_unitCatalogs: unitCatalogs,
    voctrain_transcriptProfiles: tprofiles, voctrain_certTranscriptRequests: requests, voctrain_certDownloadApprovals: approvals,
    voctrain_certTemplates: certTemplates, voctrain_studentProfiles: sprofiles, voctrain_support_messages: support,
    voctrain_chatRooms: chatRooms, voctrain_chatMessages: chatMessages, voctrain_instructorData: instructorData,
    voctrain_systemSettings: { institutionName: 'C.E.S.T.I.S Training Centre', centreUtcOffset: '-05:00', maintenanceMode: false,
      traineeGate: { url: 'https://script.google.com/macros/s/TEST/exec', enabled: true } },
    voctrain_syncTombstones: syncTombstones,
    voctrain_deletedUserIds: [], voctrain_deletedStudentIds: []
  };
  // As a device holds it: every value a JSON string.
  const asStrings = {};
  Object.keys(store).forEach(k => { asStrings[k] = JSON.stringify(store[k]); });
  return { store, asStrings, trainees, staff, exams, examById, pending, stub, NOW, PROGRAMMES, dmStaff, dmPeer };
}

module.exports = { crypto, makeCentre, questionBank, pbkdf2, NOW, MIN, DAY, iso, PROGRAMMES };
