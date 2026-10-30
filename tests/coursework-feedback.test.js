/* Marking coursework: a comment with each mark, who has not handed it in,
   Edit with its history, work to mark first (audit IN-4, T12).
   Run: node tests/coursework-feedback.test.js

   What used to happen: a mark was a number only — a trainee at home got
   "85/100" and nothing else; nobody was listed as not having handed the work
   in (0 of 4 shown); a mark could only be overwritten in the box beside it;
   and the assignment waiting to be marked was the tenth card down.

   Pinned here:
   - CESTISCore.coursework.recordGrade with a comment: recorded with the mark,
     a comment changed on its own recorded too, and every change kept in the
     grade history with what it replaced; feedbackAt dates each comment;
   - the merge (CESTISCore.sync.mapRules('assignments'), used on every path):
     two people commenting on two trainees both keep theirs, and for one
     trainee the newer comment wins — never an older one, never a blank;
   - the trainee gate's slice: a trainee gets her own comment and its date,
     never another trainee's;
   - notSubmitted / markingOrder / assignmentOrder;
   - the dashboard (index.html): gradeSubmission saves the comment;
     renderInstructorGradebook lists "Not submitted (n)" with a Remind for
     each, puts work to mark first, and hides a mark behind Edit with its
     history; My Assignments shows the trainee her comment. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');
const CW = Core.coursework;

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

console.log('A comment with the mark, and its history');
{
  const a = { id: 'A10', title: 'Week 10 report', maxPoints: 100, grades: {} };
  let r = CW.recordGrade(a, 'S1', 72, 'Ian Barrett', '2026-10-29T14:00:00.000Z', '  Good cuts. Label the kerf width next time. ');
  assert(r.changed && r.markChanged && r.feedbackChanged, 'a mark with a comment is recorded');
  assert(a.grades.S1 === 72 && CW.feedbackFor(a, 'S1') === 'Good cuts. Label the kerf width next time.', 'the comment is kept, trimmed');
  assert(a.feedbackAt.S1 === '2026-10-29T14:00:00.000Z', 'and dated');
  r = CW.recordGrade(a, 'S1', 72, 'Ian Barrett', '2026-10-29T15:00:00.000Z', 'Good cuts. Label the kerf width and the angle next time.');
  assert(r.changed && r.markChanged === false && r.feedbackChanged, 'a comment changed on its own is recorded');
  r = CW.recordGrade(a, 'S1', 78, 'Ian Barrett', '2026-10-29T16:00:00.000Z');
  assert(r.changed && CW.feedbackFor(a, 'S1') === 'Good cuts. Label the kerf width and the angle next time.', 'a mark changed with no comment given keeps the comment');
  r = CW.recordGrade(a, 'S1', 78, 'Ian Barrett', '2026-10-29T17:00:00.000Z', 'Good cuts. Label the kerf width and the angle next time.');
  assert(!r.changed, 'the same mark and comment again: nothing to record');
  const h = CW.gradeHistory(a, 'S1');
  assert(h.length === 3 && h[0].previous === null && h[1].previousFeedback === 'Good cuts. Label the kerf width next time.' && h[2].previous === 72 && h[2].points === 78,
    'the history keeps every change: first mark, the comment it replaced, the mark it replaced');
  CW.recordGrade(a, 'S1', 78, 'Ian Barrett', '2026-10-29T18:00:00.000Z', '');
  assert(CW.feedbackFor(a, 'S1') === '' && CW.gradeHistory(a, 'S1').slice(-1)[0].previousFeedback === 'Good cuts. Label the kerf width and the angle next time.', 'a comment cleared is recorded as cleared, and what it said is kept');
  const old = { id: 'A1', grades: { S1: 15 } };
  assert(CW.recordGrade(old, 'S1', 15, 'x', 't', 'Well done').changed && CW.feedbackFor(old, 'S1') === 'Well done', 'an assignment saved before comments existed takes one');
}

console.log('Comments merge trainee by trainee, newest wins');
{
  const base = () => ({ id: 'A10', title: 'Week 10 report', maxPoints: 100, grades: { S1: 70, S2: 60 }, gradeMeta: { S1: { gradedAt: '2026-10-28T10:00:00Z' }, S2: { gradedAt: '2026-10-28T10:00:00Z' } }, updatedAt: '2026-10-28T10:00:00Z' });
  const mine = base(), theirs = base();
  CW.recordGrade(mine, 'S1', 70, 'Ian Barrett', '2026-10-29T10:00:00.000Z', 'Neat work.');
  CW.recordGrade(theirs, 'S2', 65, 'Marcia Thompson', '2026-10-29T11:00:00.000Z', 'Resubmit the diagram.');
  mine.updatedAt = '2026-10-29T10:00:00.000Z'; theirs.updatedAt = '2026-10-29T11:00:00.000Z';
  const local = [mine];
  Core.sync.mergeList(local, [theirs], r => r.id, Core.sync.mapRules('assignments', { tombs: {} }));
  const m = local[0];
  assert(m.feedback.S1 === 'Neat work.' && m.feedback.S2 === 'Resubmit the diagram.' && m.grades.S2 === 65, 'two people commenting on two trainees: both comments kept (' + JSON.stringify(m.feedback) + ')');
  const a1 = base(), a2 = base();
  CW.recordGrade(a1, 'S1', 70, 'Ian', '2026-10-29T10:00:00.000Z', 'First thought.');
  CW.recordGrade(a2, 'S1', 70, 'Ian', '2026-10-29T12:00:00.000Z', 'Second thought.');
  a1.updatedAt = '2026-10-29T13:00:00.000Z';   // the older comment rides on a record edited later
  const l2 = [a1];
  Core.sync.mergeList(l2, [a2], r => r.id, Core.sync.mapRules('assignments', { tombs: {} }));
  assert(l2[0].feedback.S1 === 'Second thought.', 'for one trainee the newer comment wins, whichever record was edited last');
  assert(l2[0].gradeLog.length === 2, 'and both lines of history are kept');
  // The Centre's network: the same rule.
  const lan = Core.pageCloud.mergeRecordValue('voctrain_assignments', JSON.stringify([mine]), JSON.stringify([theirs]), true, null);
  const ln = JSON.parse(lan)[0];
  assert(ln.feedback.S1 === 'Neat work.' && ln.feedback.S2 === 'Resubmit the diagram.', 'on the Centre\'s network too');
}

console.log('At home, through the trainee gate: her own comment only');
{
  const { makeCentre, NOW } = require('./gate-fixture.js');
  const C = makeCentre(Core);
  const list = JSON.parse(C.asStrings.voctrain_assignments);
  const asg = list[0], me = C.trainees.find(t => t.p.name === asg.course), other = C.trainees.find(t => t.p.name === asg.course && t !== me);
  CW.recordGrade(asg, me.stu.id, 8, 'Instructor', new Date(NOW - 3600000).toISOString(), 'Well cut — square the ends.');
  CW.recordGrade(asg, other.stu.id, 5, 'Instructor', new Date(NOW - 3600000).toISOString(), 'See me about the angle.');
  C.asStrings.voctrain_assignments = JSON.stringify(list);
  const built = Core.gate.buildAll(C.asStrings, NOW, { builtBy: 'dev-test' });
  const mine = built.slices[me.acct.id].slice.data.voctrain_assignments.find(a => a.id === asg.id);
  assert(mine.feedback[me.stu.id] === 'Well cut — square the ends.' && Object.keys(mine.feedback).join() === me.stu.id, 'she gets her own comment, no one else\'s');
  assert(Object.keys(mine.feedbackAt).join() === me.stu.id, 'and only her own comment\'s date (another trainee\'s ID never reaches her)');
  assert(!JSON.stringify(built.slices[me.acct.id].slice).includes('See me about the angle'), 'another trainee\'s comment is nowhere in her slice, history included');
}

console.log('Who has not handed it in; work to mark first');
{
  const W = 'Welding & Fabrication';
  const st = [{ id: 'S1', name: 'Tameka Richards', course: W, stage: 'training' }, { id: 'S2', name: 'Kemar Johnson', course: W, stage: 'training' },
    { id: 'S3', name: 'Shanice Brown', course: W, stage: 'training' }, { id: 'S4', name: 'Andre Campbell', course: W, stage: 'training' },
    { id: 'S5', name: 'Jordan Blake', course: W, stage: 'testing' }, { id: 'S6', name: 'Kayla Simms', course: 'Plumbing', stage: 'training' },
    { id: 'S7', name: 'Trevor Dixon', course: W, stage: 'incomplete' }];
  const a = { id: 'A10', course: W, grades: { S3: 50 }, requireSubmission: true };
  const subs = [{ assignmentId: 'A10', studentId: 'S1', submittedAt: '2026-10-27T10:00:00Z' }, { assignmentId: 'A10', studentId: 'S2', submittedAt: '2026-10-28T10:00:00Z' }];
  assert(CW.notSubmitted(a, st, subs).map(s => s.id).join() === 'S4', 'not submitted: Andre — not the two who uploaded, not Shanice (marked on paper), not an applicant, another programme or a dropout');
  assert(CW.notSubmitted(Object.assign({}, a, { requireSubmission: false }), st, subs).length === 0, 'work that asks for no upload has nobody "not submitted"');
  const order = CW.markingOrder({ grades: { S1: 70 } }, subs.concat([{ assignmentId: 'A10', studentId: 'S9', submittedAt: '2026-10-26T10:00:00Z' }]));
  assert(order.map(s => s.studentId).join() === 'S2,S9,S1', 'submissions: still to mark first, newest first, then the marked');
  const asgs = [{ id: 'OLD', dueDate: '2026-10-01', grades: {} }, { id: 'NEW', dueDate: '2026-10-28', grades: { S1: 70 } }, { id: 'MID', dueDate: '2026-10-14', grades: {} }];
  const sub2 = [{ assignmentId: 'OLD', studentId: 'S1', submittedAt: 'x' }, { assignmentId: 'NEW', studentId: 'S1', submittedAt: 'x' }];
  assert(CW.assignmentOrder(asgs, sub2).map(x => x.id).join() === 'OLD,NEW,MID', 'assignments: the one with work waiting first, then the newest');
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
function dash(role, extra) {
  const els = {};
  const W = 'Welding & Fabrication';
  const sb = Object.assign({
    console, Date, JSON, CESTISCore: Core, currentRole: role, currentLoggedInUser: { name: 'Ian Barrett' },
    currentInstructor: { name: 'Ian Barrett', course: W },
    students: [{ id: 'S1', name: 'Tameka Richards', course: W, stage: 'training' }, { id: 'S2', name: 'Kemar Johnson', course: W, stage: 'training' }, { id: 'S3', name: 'Shanice Brown', course: W, stage: 'training' }],
    instructorAssignments: [
      { id: 'A9', title: 'Week 9 worksheet', type: 'worksheet', course: W, dueDate: '2026-10-21', maxPoints: 20, weight: 10, createdBy: 'Ian Barrett', grades: { S1: 14, S2: 15 },
        gradeMeta: { S1: { gradedBy: 'Ian Barrett', gradedAt: '2026-10-22T10:00:00Z' } }, feedback: { S1: 'Show your working.' },
        gradeLog: [{ studentId: 'S1', points: 12, previous: null, gradedBy: 'Ian Barrett', gradedAt: '2026-10-22T10:00:00Z' }, { studentId: 'S1', points: 14, previous: 12, gradedBy: 'Ian Barrett', gradedAt: '2026-10-23T10:00:00Z' }] },
      { id: 'A10', title: 'Week 10 — Cutting & gouging report', type: 'report', course: W, dueDate: '2026-10-28', maxPoints: 100, weight: 10, createdBy: 'Ian Barrett', grades: {}, requireSubmission: true }],
    assignmentSubmissions: [{ id: 'X1', assignmentId: 'A9', studentId: 'S1', submittedAt: '2026-10-20T10:00:00Z', files: [] }, { id: 'X2', assignmentId: 'A9', studentId: 'S2', submittedAt: '2026-10-20T10:00:00Z', files: [] },
      { id: 'X3', assignmentId: 'A10', studentId: 'S1', submittedAt: '2026-10-27T10:00:00Z', files: [] }, { id: 'X4', assignmentId: 'A10', studentId: 'S2', submittedAt: '2026-10-28T09:00:00Z', files: [] }],
    instructorCourseMatch: (a, b) => a === b, escapeHtml: esc, escapeAttr: esc, jsArg: s => esc(JSON.stringify(String(s))),
    courseworkFileLink: () => '', safeUrl: u => u,
    document: { getElementById: id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '' }) }
  }, extra || {});
  vm.createContext(sb);
  return { sb, els };
}
{
  const { sb, els } = dash('instructor');
  vm.runInContext(fn('renderInstructorGradebook'), sb);
  vm.runInContext('renderInstructorGradebook()', sb);
  const html = els.iCustomAssignmentsList.innerHTML;
  assert(html.indexOf('Week 10') < html.indexOf('Week 9'), 'the assignment with work to mark comes first');
  assert(/2 to mark/.test(html), 'it says how many are still to mark');
  const w10 = html.slice(html.indexOf('Week 10'), html.indexOf('Week 9 worksheet'));
  assert(w10.indexOf('Kemar Johnson') < w10.indexOf('Tameka Richards'), 'within it, the newest submission first');
  assert(/Not submitted \(1\)<\/summary>/.test(w10) && /Shanice Brown<\/span><button class="btn btn-sm btn-secondary" onclick="openDirectChatWithTrainee\(&quot;S3&quot;,&quot;Hi Shanice, I have not received \\&quot;Week 10 — Cutting &amp; gouging report\\&quot; \(due 2026-10-28\) yet\./.test(w10),
    'Week 10 lists "Not submitted (1)": Shanice, with a reminder naming the work and its due date');
  assert(/id="fb-A10-S1"[^>]*placeholder="Comment for the trainee/.test(w10), 'every mark has a box for a comment');
  const w9 = html.slice(html.indexOf('Week 9 worksheet'));
  assert(/14\/20<\/span> <button class="btn btn-sm btn-secondary gb-edit-btn"[^>]*>Edit<\/button>/.test(w9) && /<div class="gb-editor" hidden/.test(w9), 'a marked submission shows its mark with Edit; the boxes stay hidden until Edit');
  assert(/💬 Show your working\./.test(w9) && /Changed 1 time: 12 \(Ian Barrett, [^)]*\) → 14/.test(w9), 'with its comment and history');
  assert(/Not submitted \(1\)/.test(w9) && /Shanice Brown/.test(w9), 'Week 9 also lists Shanice as not submitted');
}
{
  const inputs = { 'grade-A10-S1': { value: '72' }, 'fb-A10-S1': { value: 'Good cuts. Label the kerf width next time.' } };
  const { sb } = dash('instructor', { document: { getElementById: id => inputs[id] || null } });
  Object.assign(sb, { toasts: [], showToast(t) { sb.toasts.push(t); }, saveState() {}, scheduleDebouncedCloudSave() {}, saveAssignmentsToDrive() {},
    addNotification() {}, renderInstructorGradebook() {}, refreshContentDependentViews() {} });
  vm.runInContext(fn('gradeSubmission') + fn('notifyMarkingAudience'), sb);
  vm.runInContext('gradeSubmission("A10", "S1")', sb);
  const a = sb.instructorAssignments[1];
  assert(a.grades.S1 === 72 && a.feedback.S1 === 'Good cuts. Label the kerf width next time.', 'Grade saves the mark and the comment together');
  assert(/Graded Tameka Richards: 72\/100, with a comment/.test(sb.toasts[0]), 'and says so (' + sb.toasts[0] + ')');
  inputs['fb-A10-S1'].value = 'Good cuts. Label the kerf width next time. Well done on time.';
  vm.runInContext('gradeSubmission("A10", "S1")', sb);
  assert(/^Comment saved for Tameka Richards$/.test(sb.toasts[1]) && a.gradeLog.length === 2, 'a comment changed alone is saved and kept in the history');
}
{
  const { sb, els } = dash('student', { currentStudent: { id: 'S1', name: 'Tameka Richards', course: 'Welding & Fabrication' } });
  vm.runInContext(fn('renderStudentAssignmentsPage'), sb);
  vm.runInContext('renderStudentAssignmentsPage()', sb);
  const html = els.studentAssignmentsPageList.innerHTML;
  assert(/💬 Your instructor\\?'s comment<\/div><div[^>]*>Show your working\.<\/div>/.test(html), 'My Assignments shows the trainee her instructor\'s comment');
  assert(!/Kemar|S2/.test(html.replace(/S2[0-9]/g, '')), 'and nothing of anyone else');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
