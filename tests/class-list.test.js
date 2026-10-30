/* The instructor's class list: Upcoming and Past, a status on each class,
   Edit, and "repeat weekly until" (audit IN-14).
   Run: node tests/class-list.test.js

   What used to happen: after a term the list was 125 cards in the order
   they were made, the next class at number 121; no class said whether it
   was live, held or still to come; nothing could be changed (Delete only);
   and five classes a week were typed in one by one (40 actions).

   Pinned here: CESTISCore.classSchedule (weeklyDates, statusOf, split) and
   the dashboard's own renderInstructorClassSessions / createClassSession /
   openClassSessionEditor read from index.html. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const CS = Core.classSchedule;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

console.log('Weekly dates, states, and the two lists');
{
  assert(CS.weeklyDates('2026-11-02', '2026-12-21').join() === '2026-11-02,2026-11-09,2026-11-16,2026-11-23,2026-11-30,2026-12-07,2026-12-14,2026-12-21', 'every Monday up to and including the last date: 8 classes');
  assert(CS.weeklyDates('2026-11-02', '2026-11-08').join() === '2026-11-02', 'an "until" inside the first week: the one class');
  assert(CS.weeklyDates('2026-11-02', '').length === 1 && CS.weeklyDates('bad', '2026-12-01').length === 0, 'no "until": the one class; no start: none');
  assert(CS.weeklyDates('2026-01-05', '2030-01-01').length === 52, 'never more than 52');
  const T = '2026-10-29';
  assert(CS.statusOf({ date: '2026-10-28', status: 'scheduled' }, T) === 'past' && CS.statusOf({ date: '2026-10-29', status: 'scheduled' }, T) === 'scheduled', 'a day gone by and never run is Past; today\'s is still to come');
  assert(CS.statusOf({ date: '2026-10-20', status: 'live' }, T) === 'live' && CS.statusOf({ date: '2026-11-20', status: 'completed' }, T) === 'completed', 'live and completed say so whatever the date');
  const ss = [];
  for (let k = 1; k <= 120; k++) ss.push({ id: 'P' + k, date: Core.attendance.addDays(T, -k), time: '09:00', status: 'completed' });
  ss.push({ id: 'N3', date: '2026-11-04', time: '09:00', status: 'scheduled' }, { id: 'N1', date: '2026-10-30', time: '09:00', status: 'scheduled' },
    { id: 'N2', date: '2026-10-30', time: '13:00', status: 'scheduled' }, { id: 'L', date: '2026-10-29', time: '08:00', status: 'live' });
  const sp = CS.split(ss, T);
  assert(sp.upcoming.map(s => s.id).join() === 'L,N1,N2,N3', 'Upcoming: the live class first, then the soonest');
  assert(sp.past.length === 120 && sp.past[0].id === 'P1' && sp.past[119].id === 'P120', 'Past: most recent first');
}

console.log('The dashboard (index.html)');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function page() {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', checked: false, disabled: false, style: {} });
  let n = 0;
  const sb = {
    console, Date, JSON, Math, Object, CESTISCore: Core, currentRole: 'instructor', currentInstructor: { name: 'Ian Barrett', course: 'Welding & Fabrication' },
    currentLoggedInUser: { name: 'Ian Barrett' }, classSessions: [], localDateStr: () => '2026-10-29', instructorCourseMatch: (a, b) => a === b,
    escapeHtml: esc, escapeAttr: esc, jsArg: s => esc(JSON.stringify(String(s))), vcSessionStatusBadge: cs => '<b>' + cs.status + '</b>',
    cestisGenId: p => p + (++n), generateRoomCode: () => 'ROOM' + (++n), saves: 0, notices: [], toasts: [],
    saveState() { sb.saves++; }, showToast(t) { sb.toasts.push(t); }, addNotification(t, ty, ic, roles, x, aud) { sb.notices.push({ t, aud }); },
    renderAdminClassSessions() {}, refreshContentDependentViews() {}, populateCourseDropdowns() {}, openModal() { sb.opened = true; },
    document: { getElementById: el }
  };
  vm.createContext(sb);
  vm.runInContext('var iClassListTab = "upcoming", iClassPastShown = 20; var editingClassSessionId = null;' +
    ['renderInstructorClassSessions', 'iClassSetTab', 'iClassShowMorePast', 'createClassSession', 'openClassSessionEditor', 'classSessionEditorReset'].map(fn).join('\n') +
    'function closeModal(id) { if (id === "createClassSessionModal") classSessionEditorReset(); }', sb);
  return { sb, el };
}
{
  const { sb, el } = page();
  const fill = v => Object.keys(v).forEach(k => { el(k).value = v[k]; });
  fill({ csSessionName: 'Welding Theory', csCourse: 'Welding & Fabrication', csDate: '2026-11-02', csTime: '09:00', csDuration: '90', csType: 'virtual', csLocation: 'Virtual-01' });
  el('csRepeat').checked = true; el('csRepeatUntil').value = '2026-12-21';
  vm.runInContext('createClassSession()', sb);
  assert(sb.classSessions.length === 8 && sb.saves === 1, 'one form, "repeat weekly until 21 Dec": 8 classes, saved once');
  assert(sb.classSessions.map(s => s.date).join() === CS.weeklyDates('2026-11-02', '2026-12-21').join(), 'one every Monday');
  assert(new Set(sb.classSessions.map(s => s.id)).size === 8 && new Set(sb.classSessions.map(s => s.roomCode)).size === 8, 'each its own record with its own room code');
  assert(sb.classSessions.every(s => s.seriesId === sb.classSessions[0].seriesId && s.seriesCount === 8) && sb.classSessions[2].seriesIndex === 3, 'and they know they are one weekly series (3 of 8)');
  assert(sb.notices.length === 1 && /8 classes, 2026-11-02 to 2026-12-21/.test(sb.notices[0].t) && sb.notices[0].aud.forCourse === 'Welding & Fabrication', 'one notice for the series, to the programme');
  assert(!el('csRepeat').checked && el('csRepeatUntil').value === '', 'the repeat is cleared for the next class');
  fill({ csSessionName: 'Welding Theory', csDate: '2026-11-02', csTime: '09:00' });
  el('csRepeat').checked = true; el('csRepeatUntil').value = '2026-11-01';
  vm.runInContext('createClassSession()', sb);
  assert(sb.classSessions.length === 8 && /Choose the last date/.test(sb.toasts.slice(-1)[0]), 'an "until" before the start is refused, nothing made');

  // Past classes and the tabs.
  sb.classSessions.push({ id: 'OLD', name: 'Welding Theory — Session 1', course: 'Welding & Fabrication', date: '2026-09-01', time: '09:00', duration: 90, status: 'completed', roomCode: 'R0' },
    { id: 'LIVE', name: 'Live now', course: 'Welding & Fabrication', date: '2026-10-29', time: '08:00', duration: 90, status: 'live', roomCode: 'RL' },
    { id: 'PLUMB', name: 'Pipe fitting', course: 'Plumbing', date: '2026-11-03', time: '09:00', status: 'scheduled' });
  vm.runInContext('renderInstructorClassSessions()', sb);
  let html = el('iClassSessionsList').innerHTML;
  assert(/Upcoming \(9\)/.test(html) && /Past \(1\)/.test(html), 'two tabs with their counts: Upcoming (9), Past (1) — not another programme\'s');
  assert(html.indexOf('Live now') < html.indexOf('Welding Theory') && !/Session 1/.test(html), 'Upcoming: the live class first, no past class');
  assert(/<b>live<\/b>/.test(html) && /<b>scheduled<\/b>/.test(html) && /weekly, 3 of 8/.test(html), 'each class says its state, and a series its place');
  assert((html.match(/>Edit<\/button>/g) || []).length === 8 && (html.match(/>Join<\/button>/g) || []).length === 9, 'Edit on every class not live now; Join on every one to come');
  vm.runInContext('iClassSetTab("past")', sb);
  html = el('iClassSessionsList').innerHTML;
  assert(/Session 1/.test(html) && !/Live now/.test(html) && !/>Join</.test(html), 'Past: the held class, no Join');

  // Edit.
  const target = sb.classSessions[1];
  const before = { id: target.id, room: target.roomCode, status: target.status, series: target.seriesId };
  vm.runInContext('openClassSessionEditor(' + JSON.stringify(target.id) + ')', sb);
  assert(sb.opened && el('csSessionName').value === 'Welding Theory' && el('csDate').value === '2026-11-09' && el('csSaveBtn').textContent === 'Save changes', 'Edit opens the form filled with the class');
  el('csTime').value = '10:30'; el('csLocation').value = 'Workshop Bay 3';
  vm.runInContext('createClassSession()', sb);
  const after = sb.classSessions.find(s => s.id === before.id);
  assert(sb.classSessions.length === 11 && after.time === '10:30' && after.location === 'Workshop Bay 3', 'Save changes changes that class only — no new class');
  assert(after.roomCode === before.room && after.status === before.status && after.seriesId === before.series && !!after.updatedAt, 'it keeps its id, room code, state and series, and is dated');
  assert(/Class moved: "Welding Theory" is now on 2026-11-09 at 10:30/.test(sb.notices.slice(-1)[0].t), 'its trainees hear it moved');
  assert(vm.runInContext('editingClassSessionId', sb) === null && el('csSaveBtn').textContent === 'Create Session', 'the form is back to "Create" for the next class');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
