/* A programme's notices reach that programme's trainees; a marking notice
   reaches the instructor who marked.
   Run: node tests/notice-audience.test.js

   What used to go wrong (audit IN-10): every "New class session", "New
   resource uploaded" and instructor's "New announcement" notice went to every
   trainee in the Centre — a Plumbing trainee's bell held 8 of 8 Welding
   notices — and every "… graded 15/20 on …" / "Grading completed: …" went to
   every instructor, so one marking session (35 notices) pushed the real ones
   out of everyone's bell (50 kept per audience).

   Pinned here: CESTISCore.notify.reaches (forCourse: trainees of that
   programme only, staff as before; forInstructors: that instructor, admins as
   before; a notice with neither — every one already stored — as before),
   prune keeping them as audiences of their own, cleanNotification keeping
   the two fields on a notice that arrives live; and the dashboard's own
   addNotification / getFilteredNotifications / notifyMarkingAudience read
   from index.html, with the call sites that raise these notices. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
console.log('The rule (CESTISCore.notify.reaches)');
{
  const R = Core.notify.reaches;
  const weld = { forRoles: ['admin', 'instructor', 'student'], forCourse: 'Welding & Fabrication' };
  assert(R(weld, { role: 'student', course: 'Welding & Fabrication', sameProgramme: same }), 'a Welding notice reaches a Welding trainee');
  assert(!R(weld, { role: 'student', course: 'Plumbing', sameProgramme: same }), 'not a Plumbing trainee');
  assert(R(weld, { role: 'instructor', userId: 'U-P', course: '' }) && R(weld, { role: 'admin' }) && R(weld, { role: 'adminstaff' }), 'staff see it as before');
  assert(R({ forCourse: 'General' }, { role: 'student', course: 'Plumbing', sameProgramme: same }), 'a "General" notice reaches every trainee');
  const old = { forRoles: ['admin', 'instructor', 'student'] };
  assert(R(old, { role: 'student', course: 'Plumbing', sameProgramme: same }), 'a notice already stored (no programme on it) reaches everyone, as before');
  const graded = { forRoles: ['admin', 'instructor'], forInstructors: ['U-IAN'] };
  assert(R(graded, { role: 'instructor', userId: 'U-IAN' }), 'a marking notice reaches the instructor who marked');
  assert(!R(graded, { role: 'instructor', userId: 'U-PAULA' }), 'not another instructor');
  assert(R(graded, { role: 'admin', userId: 'U-ADM' }), 'administrators still see it');
  assert(R({ forRoles: ['admin', 'instructor'] }, { role: 'instructor', userId: 'U-PAULA' }), 'an older marking notice (no instructor named) as before');
}

console.log('Kept as audiences of their own; a live notice keeps who it is for');
{
  const list = [];
  for (let i = 0; i < 60; i++) list.push({ id: 'G' + i, timestamp: 2000 + i, forRoles: ['admin', 'instructor'], forInstructors: ['U-IAN'] });
  list.push({ id: 'REAL', timestamp: 1000, forRoles: ['admin', 'instructor'] });
  const kept = Core.notify.prune(list, 50, 400);
  assert(kept.some(n => n.id === 'REAL'), 'sixty marking notices no longer push an older staff notice out of the bell');
  assert(kept.filter(n => n.forInstructors).length === 50, 'and they are capped at 50 among themselves');
  const c = Core.html.cleanNotification({ id: 'N1', text: 'New class session: "X"', type: 'info', forRoles: ['student'], forCourse: 'Welding & Fabrication', forInstructors: ['U-IAN'] });
  assert(c.forCourse === 'Welding & Fabrication' && c.forInstructors.join() === 'U-IAN', 'a notice arriving live keeps its programme and instructor');
  const c2 = Core.html.cleanNotification({ id: 'N2', text: 'x', forRoles: ['student'] });
  assert(!('forCourse' in c2) && !('forInstructors' in c2), 'and one without them gains nothing');
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
const sb = {
  CESTISCore: Core, Date: Date, String: String, Array: Array, console: console,
  notifications: [], cestisGenId: p => p + Math.random().toString(36).slice(2, 8),
  updateNotificationDot() {}, shakeNotificationBell() {}, playNotificationSound() {}, saveNotifications() {},
  cestisRTBroadcastNotification() {}, cestisFlushCloudNow() {},
  currentRole: null, currentStudent: null, currentLoggedInUser: null, instructorCourseMatch: same,
  lmsChatGetCurrentUser: () => sb.currentLoggedInUser
};
vm.createContext(sb);
vm.runInContext(fn('addNotification') + fn('notifViewerId') + fn('getFilteredNotifications') + fn('notifyMarkingAudience'), sb);
function as(role, id, course) {
  sb.currentRole = role; sb.currentLoggedInUser = { id }; sb.currentStudent = role === 'student' ? { id: 'S-' + id, course } : null;
  return sb.getFilteredNotifications().map(n => n.text);
}
{
  // Ian (Welding) creates a class, a resource and an announcement; marks work.
  sb.addNotification('New class session: "Welding Theory"', 'calendar', null, ['admin', 'instructor', 'student'], null, { forCourse: 'Welding & Fabrication' });
  sb.addNotification('New resource uploaded: "Plasma guide"', 'resource', null, ['admin', 'instructor', 'student'], null, { forCourse: 'Welding & Fabrication' });
  sb.addNotification('Workshop closed on Friday', 'info', null, ['student']);   // a Centre-wide notice, as before
  as('instructor', 'U-IAN');
  const mk = sb.notifyMarkingAudience();
  sb.addNotification('Tameka Richards graded 15/20 on "Week 1"', 'grade', null, mk.roles, null, mk.aud);
  sb.currentRole = 'admin'; sb.currentLoggedInUser = { id: 'U-ADM' };
  const mkA = sb.notifyMarkingAudience();
  assert(mkA.roles.join() === 'admin' && !mkA.aud, 'marked by an administrator: the administrators hear of it');
  const plumb = as('student', 'P1', 'Plumbing');
  assert(plumb.length === 1 && plumb[0] === 'Workshop closed on Friday', 'a Plumbing trainee\'s bell: none of the Welding notices (' + JSON.stringify(plumb) + ')');
  const weld = as('student', 'W1', 'Welding & Fabrication');
  assert(weld.length === 3 && weld.some(t => /Welding Theory/.test(t)) && !weld.some(t => /graded/.test(t)), 'a Welding trainee\'s: her class, resource and the Centre notice — not the marks (' + JSON.stringify(weld) + ')');
  assert(as('instructor', 'U-IAN').some(t => /graded 15\/20/.test(t)), 'the marking instructor sees the marking notice');
  assert(!as('instructor', 'U-PAULA').some(t => /graded 15\/20/.test(t)), 'another instructor does not');
  assert(as('instructor', 'U-PAULA').some(t => /Welding Theory/.test(t)), '(staff still see programme notices, as before)');
  assert(as('admin', 'U-ADM').filter(t => /graded|Welding Theory|Plasma/.test(t)).length === 3, 'an administrator sees them all, as before');
  const stored = sb.notifications.find(n => /Welding Theory/.test(n.text));
  assert(stored.forCourse === 'Welding & Fabrication' && Array.isArray(stored.forRoles), 'the stored notice keeps its roles and gains the programme (additive)');
}
{
  // The call sites.
  assert(/addNotification\('New class session: "' \+ name \+ '"', 'calendar', null, \['admin','instructor','student'\], null, course \? \{ forCourse: course \} : null\)/.test(src), 'a new class session is addressed to its programme');
  assert(/addNotification\('New resource uploaded: "' \+ name \+ '"', 'resource', null, \['admin','instructor','student'\], null, \{ forCourse: resource\.course \}\)/.test(src), 'an instructor\'s resource to its programme');
  assert(/New resource uploaded for ' \+ course [^\n]*course \? \{ forCourse: course \} : null\)/.test(src), 'the office\'s resource to its programme');
  assert(/Large class session started[^\n]*_course \? \{ forCourse: _course \} : null\)/.test(src), 'a Large Class to its programme (when it has one)');
  assert(/currentInstructor && currentInstructor\.course \? \{ forCourse: currentInstructor\.course \} : null\)/.test(fn('createInstructorAnnouncement')), 'an instructor\'s announcement to the programme');
  assert(/graded ' \+ score[^\n]*_mk\.roles, null, _mk\.aud\)/.test(fn('gradeSubmission')), 'an assignment mark to the marker and the administrators');
  assert(/'Grading completed: '[^\n]*_mk\.roles, null, _mk\.aud\)/.test(src), 'an exam\'s marking to the marker and the administrators');
  assert(/CESTISCore\.notify\.reaches\(n, \{ role: currentRole, userId: myId/.test(fn('cestisNotifTargetsMe')), 'a notice arriving live follows the same rule');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
