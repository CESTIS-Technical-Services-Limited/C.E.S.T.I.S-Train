/* The office's announcements can go to one programme's trainees.

   What happened (office audit OF-11): an office announcement was saved with
   no programme, so "Cosmetology kits Monday" reached all 120 trainees on 5
   programmes. Only instructors' announcements were limited to a programme.

   What this pins: Announcements' form has "Which trainees" (every programme,
   or one); the announcement carries the programme the way an instructor's
   does (`course`), and its bell notice the programme (`forCourse`, IN-10);
   that programme's trainees see both, other trainees neither, staff both;
   an announcement for everybody is unchanged.

   Run: node tests/office-announcement-programme.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FRAG = fs.readFileSync(path.join(ROOT, 'Pages', 'Announcements.html'), 'utf8');
function fn(name) {
  const m = new RegExp('function ' + name + '\\(').exec(PAGE);
  let d = 0;
  for (let i = PAGE.indexOf('{', m.index); i < PAGE.length; i++) { if (PAGE[i] === '{') d++; else if (PAGE[i] === '}') { d--; if (!d) return PAGE.slice(m.index, i + 1); } }
  throw new Error(name);
}
const same = (a, b) => String(a).toLowerCase().trim() === String(b).toLowerCase().trim();

console.log('The form asks which trainees');
assert(/<select class="form-control" id="annCourse"[^>]*><option value="">Trainees of every programme<\/option><\/select>/.test(FRAG), '"Which trainees", every programme by default');
assert(/annFillCourseOptions\(\)/.test(fn('toggleAnnouncementForm')), 'the programmes are listed when the form opens');

function page(course) {
  const el = {};
  const set = (id, v, checked) => { el[id] = { value: v, checked: !!checked, style: {}, innerHTML: '' }; };
  set('annTitle', 'Cosmetology kits'); set('annBody', 'Collect your kits from the office on Monday between 9 and 12.');
  set('annPriority', 'general'); set('annAuthor', 'Sheryl Brown'); set('annCourse', course);
  set('annRoleAdmin', '', true); set('annRoleInstructor', '', true); set('annRoleStudent', '', true); set('annRoleAdminStaff', '', true);
  set('announcementForm', '');
  const sb = {
    console, Date, JSON, CESTISCore: Core, currentRole: 'adminstaff', announcements: [], notes: [],
    document: { getElementById: id => el[id] || null },
    cestisGenId: p => p + '1', localDateStr: () => '2026-10-30', alert() {}, showToast() {}, saveState() {}, refreshContentDependentViews() {},
    renderAnnouncements() {}, staffSectionRefused: () => false, getCourseList: () => ['Welding & Fabrication', 'Cosmetology', 'Plumbing'],
    escapeAttr: s => String(s), escapeHtml: s => String(s),
    addNotification(text, type, icon, roles, fixedId, aud) { sb.notes.push({ text, roles, aud }); }
  };
  sb.el = el;
  vm.createContext(sb);
  vm.runInContext('var announcementFormVisible = true;\n' + fn('toggleAnnouncementForm') + fn('annFillCourseOptions') + fn('createAnnouncement'), sb);
  return sb;
}
console.log('An announcement for one programme');
{
  const sb = page('Cosmetology');
  sb.createAnnouncement();
  const a = sb.announcements[0];
  assert(a && a.course === 'Cosmetology', 'the announcement carries the programme');
  assert(sb.notes.length === 1 && sb.notes[0].aud && sb.notes[0].aud.forCourse === 'Cosmetology', 'and so does its bell notice');
  const cos = { role: 'student', course: 'Cosmetology' }, plumb = { role: 'student', course: 'Plumbing' };
  assert(Core.comms.forViewer(a, 'student', 'Cosmetology', same) === true, 'a Cosmetology trainee sees it');
  assert(Core.comms.forViewer(a, 'student', 'Plumbing', same) === false, 'a Plumbing trainee does not');
  assert(Core.comms.forViewer(a, 'instructor', '', same) === true && Core.comms.forViewer(a, 'adminstaff', '', same) === true, 'staff see it');
  const n = Object.assign({ forRoles: sb.notes[0].roles }, { forCourse: sb.notes[0].aud.forCourse });
  assert(Core.notify.reaches(n, Object.assign({ sameProgramme: same }, cos)) === true, 'the Cosmetology trainee is told of it');
  assert(Core.notify.reaches(n, Object.assign({ sameProgramme: same }, plumb)) === false, 'the Plumbing trainee is not');
  assert(Core.notify.reaches(n, { role: 'admin' }) === true, 'the office is');
  assert(sb.el.annCourse.value === '', 'the form goes back to every programme for the next one');
}
console.log('An announcement for everybody, as before');
{
  const sb = page('');
  sb.createAnnouncement();
  const a = sb.announcements[0];
  assert(a && !('course' in a), 'no programme on it');
  assert(sb.notes[0].aud === null, 'nor on its notice');
  assert(Core.comms.forViewer(a, 'student', 'Plumbing', same) === true, 'every trainee sees it');
}
console.log('The list says who it is for');
assert(/a\.course \? '<span[^']*'\+escapeHtml\(a\.course\)\+' trainees only<\/span>'/.test(fn('renderAnnouncements')), '"Cosmetology trainees only" beside the audience');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
