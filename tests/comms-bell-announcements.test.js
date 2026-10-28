/* Communications: trainees can read every announcement, see what is due, and
   the bell, the calendar, the Support form and the duty reminders behave.

   What went wrong, and what these tests pin:
     - a trainee saw only the first three announcements in storage order —
       where newly synced ones land LAST — cut at 80 characters with "..."
       always added, and "View All" opened the Profile. There is now an
       Announcements page, newest first, in full; instructors' announcements
       reach their own programme only;
     - exams, assignment due dates and class sessions never reached the
       trainee's calendar or "Upcoming Deadlines" (which dropped a deadline
       from 7 PM the evening before it was due). The agenda is now worked out
       from them when drawn — nothing is stored twice;
     - calendar events were typed into five prompt() boxes: '20/11/2026' was
       stored, announced, and shown on no day; edit replaced the record with a
       partial one. A validated form now adds and edits, keeping every field;
     - the bell's "Clear all" deleted (and tombstoned everywhere) other
       people's notices; read and cleared are now each person's own;
     - the Support form said "sent successfully" for a message that never
       left the visitor's phone, and a trainee's logout wiped it;
     - duty reminders for an assignee went to administrators, every admin
       device re-sent them hourly, and they flooded the 50-notice list; the
       extend dialog pre-filled the UTC day.

   Run: node tests/comms-bell-announcements.test.js */
'use strict';
process.env.TZ = 'America/Jamaica';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); } }
function assertEq(actual, expected, msg) {
  assert(actual === expected, msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
const ROOT = path.join(__dirname, '..');
const PAGES = [
  { where: 'index.html', src: fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), core: require('../cestis-core.js') },
  { where: 'Offline System/index.html', src: fs.readFileSync(path.join(ROOT, 'Offline System', 'index.html'), 'utf8'),
    core: require('../Offline System/cestis-core.js') }
];
function extractFunction(src, name, where) {
  const m = new RegExp('(?:async\\s+)?function ' + name + '\\(').exec(src);
  if (!m) throw new Error(where + ' no longer defines ' + name + '()');
  let depth = 0;
  for (let i = src.indexOf('{', m.index); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name + '()');
}
const pending = [];
const sameProg = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

PAGES.forEach(function (page) {
  const C = page.core.comms, src = page.src;
  const w = page.where.replace('/index.html', '');

  /* ---------- 1. Announcements ---------- */
  console.log('Trainees read every announcement, newest first (' + w + ')');
  const local = [
    { id: 'A1', title: 'Uniform policy', date: '2026-09-01', forRoles: ['student'] },
    { id: 'A2', title: 'Lab rules', date: '2026-09-05', forRoles: ['student'] },
    { id: 'A3', title: 'Library hours', date: '2026-09-07', forRoles: ['student'] }
  ];
  // A new announcement arrives through the real sync merge — it is appended.
  page.core.sync.mergeList(local, [{ id: 'A4', title: 'EXAM MOVED TO MONDAY', date: '2026-10-12', priority: 'urgent', forRoles: ['student'] }], r => r.id, {});
  assertEq(local[local.length - 1].id, 'A4', '(the merge appends the new one at the end)');
  const sorted = C.sortAnnouncements(local);
  assertEq(sorted[0].title, 'EXAM MOVED TO MONDAY', 'the newest announcement comes first');
  assertEq(local[0].id, 'A1', 'sorting is on a copy — the shared list keeps its order');
  assertEq(C.excerpt('Short note', 80), 'Short note', 'a short body gets no ellipsis');
  const long = 'The Unit 3 practical moves to Thursday 9am in Workshop B. Bring your PPE, logbook and the signed safety declaration.';
  assert(C.excerpt(long, 80).length <= 81 && /…$/.test(C.excerpt(long, 80)), 'a long body is shortened only on the dashboard card');
  const plumbing = { id: 'A5', title: 'Re-sit list', forRoles: ['student'], course: 'Plumbing' };
  assertEq(C.forViewer(plumbing, 'student', 'Welding', sameProg), false, "the Plumbing instructor's announcement does not reach Welding trainees");
  assertEq(C.forViewer(plumbing, 'student', 'Plumbing', sameProg), true, 'it reaches Plumbing trainees');
  assertEq(C.forViewer({ title: 'Centre closed', forRoles: ['student'] }, 'student', 'Welding', sameProg), true, 'an announcement with no programme reaches everyone');
  assertEq(C.forViewer({ forRoles: ['admin'] }, 'adminstaff', '', sameProg), true, 'admin staff see admin announcements');

  const dash = extractFunction(src, 'buildStudentPages', w);
  assert(/showPage\('s-announcements'\)">View All/.test(dash) && !/showPage\('s-profile'\)">View All/.test(dash), "'View All' opens the Announcements page");
  assert(/id="page-s-announcements"/.test(dash), 'the trainee has an Announcements page');
  assert(/data-page="s-announcements"/.test(extractFunction(src, 'buildStudentSidebar', w)), 'and a menu item for it');
  const ra = extractFunction(src, 'renderStudentAnnouncements', w);
  assert(/escapeHtml\(a\.body\)/.test(ra) && /CESTISCore\.comms\.excerpt\(a\.body, 80\)/.test(ra), 'the page shows the full (escaped) body; the card a shortened one');
  ['renderAnnouncements', 'renderInstructorAnnouncements', 'renderAsAnnouncements', 'studentAnnouncementsFor'].forEach(fn =>
    assert(/CESTISCore\.comms\.sortAnnouncements\(announcements\)/.test(extractFunction(src, fn, w)), fn + ' lists newest first'));
  assert(/course: currentInstructor\.course/.test(extractFunction(src, 'createInstructorAnnouncement', w)), "an instructor's announcement carries their programme");

  /* ---------- 2. The trainee's agenda ---------- */
  console.log('What is due reaches the trainee (' + w + ')');
  const agenda = C.studentAgenda({
    course: 'Welding', sameProgramme: sameProg,
    calendarEvents: [
      { title: 'Graduation rehearsal', date: '2026-11-20', type: 'meeting', forRoles: ['student'] },
      { title: 'Bad date', date: '20/11/2026', type: 'meeting', forRoles: ['student'] },
      { title: 'Staff only', date: '2026-11-21', type: 'meeting', forRoles: ['admin'] }
    ],
    exams: [{ title: 'Practical', course: 'Welding', date: '2026-10-27', time: '09:00' }, { title: 'Plumbing exam', course: 'Plumbing', date: '2026-10-27' },
      { title: 'Draft', course: 'Welding', date: '2026-10-28', status: 'draft' }],
    assignments: [{ title: 'Portfolio', course: 'Welding', dueDate: '2026-10-23' }],
    classSessions: [{ name: 'Arc welding', course: 'Welding', date: '2026-10-22', time: '13:00' }]
  });
  assertEq(agenda.map(x => x.title).join(' | '), 'Arc welding | Portfolio due | Practical | Graduation rehearsal',
    "exams, due dates, classes and events of the trainee's programme, soonest first (and nothing else)");
  const today = '2026-10-23';
  const up = C.upcoming(agenda, today, 3);
  assertEq(up[0].title, 'Portfolio due', 'a deadline due today is still upcoming today');
  assertEq(up.length, 3, 'the list is capped');
  assert(/CESTISCore\.comms\.studentAgenda\(/.test(extractFunction(src, 'studentAgendaFor', w)), 'the calendar is drawn from the agenda');
  assert(/studentAgendaFor\(currentStudent\)/.test(extractFunction(src, 'renderStudentCalendar', w)), 'the student calendar shows the agenda');
  const dl = extractFunction(src, 'renderStudentDeadlines', w);
  assert(/CESTISCore\.comms\.upcoming\(/.test(dl) && /daysUntil\(d\.date\)/.test(dl) && !/new Date\(d\.date\)/.test(dl), 'Upcoming Deadlines uses local calendar days');

  /* ---------- 3. Calendar form ---------- */
  console.log('Calendar events come from a validated form (' + w + ')');
  assertEq(C.validateEvent({ title: 'Rehearsal', date: '20/11/2026', type: 'meeting', forRoles: ['student'] }).ok, false, "'20/11/2026' is refused");
  assertEq(C.validateEvent({ title: 'Rehearsal', date: '2026-11-20', time: '25:00', type: 'meeting', forRoles: ['student'] }).ok, false, 'a time of 25:00 is refused');
  assertEq(C.validateEvent({ title: 'Rehearsal', date: '2026-11-20', type: 'party', forRoles: ['student'] }).ok, false, 'an unknown kind is refused');
  assertEq(C.validateEvent({ title: 'Rehearsal', date: '2026-11-20', type: 'meeting', forRoles: [] }).ok, false, 'an event for nobody is refused');
  assertEq(C.validateEvent({ title: 'Rehearsal', date: '2026-11-20', time: '09:30', type: 'meeting', forRoles: ['student'] }).ok, true, 'a proper event is accepted');
  assert(!/prompt\(/.test(extractFunction(src, 'promptAddEvent', w)) && !/prompt\(/.test(extractFunction(src, 'editCalendarEvent', w)), 'no prompt() boxes for adding or editing');
  {
    const els = {};
    const el = id => els[id] || (els[id] = { value: '', checked: false, style: {}, textContent: '' });
    const ev = { id: 'EVT-1', title: 'Old', date: '2026-11-01', time: '09:00', type: 'meeting', forRoles: ['admin'], createdById: 'U9', updatedAt: '2026-01-01T00:00:00Z', extra: 'kept' };
    const sb = {
      CESTISCore: page.core, calendarEvents: [ev], currentRole: 'admin', currentLoggedInUser: { id: 'U1', name: 'Admin' }, currentInstructor: null,
      document: { getElementById: el }, notes: [],
      closeModal() {}, cestisRenderCalendars() {}, refreshContentDependentViews() {}, saveState() {}, showToast() {},
      addNotification(t) { sb.notes.push(t); }, cestisGenId(p) { return p + 'X'; }
    };
    vm.createContext(sb);
    ['readCalendarEventForm', 'calCanEditEvent', 'saveCalendarEventForm'].forEach(n => vm.runInContext(extractFunction(src, n, w), sb));
    vm.runInContext('var CAL_EVENT_COLORS = {class:"b",exam:"r",deadline:"a",meeting:"p"};', sb);
    el('calEvtIdx').value = '0'; el('calEvtTitle').value = 'Graduation rehearsal'; el('calEvtDate').value = '2026-11-20';
    el('calEvtTime').value = '10:00'; el('calEvtType').value = 'meeting'; el('calEvtCourse').value = '';
    el('calEvtRoleStudent').checked = true; el('calEvtRoleAdmin').checked = true;
    vm.runInContext('saveCalendarEventForm()', sb);
    const e2 = sb.calendarEvents[0];
    assertEq(e2.id, 'EVT-1', 'editing keeps the id');
    assertEq(e2.createdById, 'U9', 'editing keeps who made it');
    assertEq(e2.extra, 'kept', 'editing keeps every field the form does not show');
    assert(e2.updatedAt > '2026-01-01', 'editing stamps the change');
    assertEq(e2.date, '2026-11-20', 'the new date is saved');
    el('calEvtIdx').value = ''; el('calEvtDate').value = '20/11/2026';
    vm.runInContext('saveCalendarEventForm()', sb);
    assertEq(sb.calendarEvents.length, 1, 'an invalid date adds nothing');
    assertEq(sb.notes.length, 0, 'and announces nothing');
    el('calEvtDate').value = '2026-12-01';
    vm.runInContext('saveCalendarEventForm()', sb);
    assertEq(sb.calendarEvents.length, 2, 'a valid event is added');
    assertEq(sb.calendarEvents[1].createdById, 'U1', 'with who made it');
    assertEq(sb.notes.length, 1, 'and announced once');
  }
  assert(/CESTISCore\.comms\.upcoming\(calendarEvents, localDateStr\(\)\)/.test(extractFunction(src, 'renderCalendarEventList', w)), 'the admin list shows upcoming events, sorted on a copy');
  assert(/CESTISCore\.comms\.upcoming\(instructorEvents, localDateStr\(\), 8\)/.test(extractFunction(src, 'renderInstructorCalendar', w)), "the instructor's list is the next 8, not the 8 oldest");

  /* ---------- 4. The bell: read and cleared per person ---------- */
  console.log('Clear all clears only my bell (' + w + ')');
  {
    const notifications = [
      { id: 'N1', text: 'DM for Ann', forUsers: ['STU-ANN'], forRoles: ['student'], read: false },
      { id: 'N2', text: 'DM for Bob', forUsers: ['STU-BOB'], forRoles: ['student'], read: false },
      { id: 'N3', text: 'Exam timetable', forRoles: ['student'], read: false },
      { id: 'N4', text: 'No role notice', forRoles: [], read: false },
      { id: 'N5', text: 'Old, already read', forRoles: ['student'], read: true }
    ];
    let me = { id: 'STU-ANN' };
    const sb = {
      CESTISCore: page.core, notifications, currentRole: 'student', tombs: 0,
      lmsChatGetCurrentUser() { return me; }, updateNotificationDot() {}, saveNotifications() {}, toggleNotifications() {},
      syncTombstoneRemoved() { sb.tombs++; }
    };
    vm.createContext(sb);
    ['notifViewerId', 'getFilteredNotifications', 'clearAllNotifications', 'markNotificationRead'].forEach(n => vm.runInContext(extractFunction(src, n, w), sb));
    assertEq(vm.runInContext('getFilteredNotifications().map(n => n.id).join()', sb), 'N1,N3,N4,N5', 'Ann sees her DM and the shared notices');
    vm.runInContext('clearAllNotifications()', sb);
    assertEq(vm.runInContext('getFilteredNotifications().length', sb), 0, "Ann's bell is empty");
    assertEq(sb.notifications.length, 5, 'nothing was deleted');
    assertEq(sb.tombs, 0, 'nothing was tombstoned');
    me = { id: 'STU-BOB' };
    assertEq(vm.runInContext('getFilteredNotifications().map(n => n.id).join()', sb), 'N2,N3,N4,N5', "Bob's personal DM and the shared notices are untouched");
    vm.runInContext('markNotificationRead(2)', sb);
    assert(page.core.comms.isRead(notifications[2], 'STU-BOB') && !page.core.comms.isRead(notifications[2], 'STU-CAT'), 'reading a notice marks it read for that person only');
    assert(page.core.comms.isRead(notifications[4], 'STU-CAT'), 'a notice already read before per-person marks stays read');
  }

  /* ---------- 5. Support form ---------- */
  console.log('Support never claims "sent" when nothing was sent (' + w + ')');
  {
    const els = {};
    const el = id => els[id] || (els[id] = { value: '', style: {}, textContent: '', innerHTML: '', disabled: false });
    Object.assign(el('supportName'), { value: 'Locked Out Trainee' }); el('supportEmail').value = 'trainee@example.com';
    el('supportPhone').value = '876-555-0100'; el('supportSubject').value = 'Login'; el('supportMessage').value = 'I cannot sign in.';
    const store = {};
    const sb = {
      CESTISCore: page.core, document: { getElementById: el }, supportMessages: [], systemSettings: { adminEmail: 'admin@heartlms.edu.jm' },
      CESTISStore: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
      localDateStr: () => '2026-10-21', cestisGenId: p => p + '1', addNotification() {}, closeModal() {},
      escapeHtml: s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'), escapeAttr: s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
      window: {}, setTimeout() {}, encodeURIComponent, console: { warn() {} }, Promise
    };
    vm.createContext(sb);
    ['loadSupportMessages', 'saveSupportMessages', 'submitSupportMessage', 'supportInboxAddress', 'deliverSupportMessage'].forEach(n => vm.runInContext(extractFunction(src, n, w), sb));
    vm.runInContext('var supportMessages = [];', sb);
    vm.runInContext('submitSupportMessage()', sb);
    pending.push(new Promise(r => setTimeout(r, 20)).then(function () {
      const text = el('supportFormSuccess').innerHTML + el('supportFormSuccess').textContent;
      assert(!/sent successfully|has been sent/i.test(text), 'with no way to deliver it, the form does not say "sent"');
      assert(/could not be sent/i.test(text) && /mailto:cestisadmn@gmail\.com/.test(text), 'it says so, and offers an e-mail link to the Centre');
      const saved = JSON.parse(store.voctrain_support_messages || '[]');
      assert(saved.length === 1 && saved[0].delivered === false, 'the message is kept on the device, marked not yet delivered');
    }));
    const wipe = extractFunction(src, 'clearSensitiveStudentData', w);
    assert(/m\.delivered === false/.test(wipe), "a trainee's logout keeps undelivered support messages");
  }

  /* ---------- 6. Duty reminders ---------- */
  console.log('Duty reminders reach the assignee, once (' + w + ')');
  {
    const reminderSrc = ['adrAssigneeRole', 'adrCheckHourlyReminders', 'adrIsOverdue', 'addNotification', 'addNotificationForUser', 'getFilteredNotifications', 'notifViewerId'];
    const devices = [];
    let shared = [];
    const task = { id: 'T1', title: 'Lock up workshop', taskType: 'daily', status: 'pending', deadline: '2020-01-01T17:00:00', assigneeId: 'USR-INS', assigneeName: 'Ina' };
    for (let d = 0; d < 2; d++) {
      const sb = {
        CESTISCore: page.core, notifications: [], adrTasks: [JSON.parse(JSON.stringify(task))],
        userAccounts: [{ id: 'USR-INS', role: 'instructor' }], currentRole: 'admin',
        cestisGenId: p => p + Math.random(), updateNotificationDot() {}, shakeNotificationBell() {}, playNotificationSound() {}, saveNotifications() {},
        cestisRTBroadcastNotification() {}, cestisRTBroadcast() {}, cestisFlushCloudNow() {}, adrSaveData() { sb.saves = (sb.saves || 0) + 1; },
        lmsChatGetCurrentUser() { return { id: 'USR-001' }; }
      };
      vm.createContext(sb);
      reminderSrc.forEach(n => vm.runInContext(extractFunction(src, n, w), sb));
      vm.runInContext('adrCheckHourlyReminders()', sb);
      devices.push(sb);
    }
    const merged = {};
    devices.forEach(sb => sb.notifications.forEach(n => { merged[n.id] = n; }));
    shared = Object.values(merged);
    assertEq(shared.length, 2, 'two admin devices in the same hour produce one digest and one assignee reminder, not four');
    const forIna = shared.filter(n => n.forUsers && n.forUsers.indexOf('USR-INS') !== -1);
    assertEq(forIna.length, 1, 'the "your task is overdue" reminder is addressed to the instructor who owns the task');
    assertEq(forIna[0].forRoles.join(), 'instructor', 'with the instructor role, so her bell shows it');
    const sb = devices[0];
    sb.notifications = shared; sb.currentRole = 'instructor'; sb.lmsChatGetCurrentUser = () => ({ id: 'USR-INS' });
    assertEq(vm.runInContext('getFilteredNotifications().length', sb), 1, "the instructor's bell shows her reminder");
    vm.runInContext('adrTasks[0]._lastHourlyReminder = new Date().toISOString(); adrCheckHourlyReminders()', sb);
    assertEq(sb.saves, 1, 'a tick that sends nothing does not re-save the register');
    const ext = extractFunction(src, 'adrOpenExtendTime', w);
    assert(/localDateStr\(dl\)/.test(ext) && !/toISOString\(\)\.split/.test(ext), 'the extend dialog pre-fills the local day');
  }
});

Promise.all(pending).catch(e => assert(false, 'async check threw: ' + (e && e.stack || e))).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
