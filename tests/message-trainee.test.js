/* "Message" opens a direct chat with a trainee in one click (audit IN-15).
   Run: node tests/message-trainee.test.js

   What used to happen: to message a trainee an instructor opened the chat,
   a room, the room's members, searched, opened the trainee's card and pressed
   Message — eight actions, about 40 seconds — and nothing on My Students led
   there.

   Pinned here, on the dashboard's own openDirectChatWithTrainee /
   traineeChatUserId and renderInstructorStudents read from index.html: the
   role's chat page is shown, the direct conversation is opened with the
   trainee's ACCOUNT (never a name match alone), an optional first message is
   typed in but not sent, and a trainee with no account is reported with her
   phone instead. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}

function page(role) {
  const inputs = { instructorChatInput: { value: '', focus() {} }, adminChatInput: { value: '', focus() {} } };
  const sb = {
    console, setTimeout: (f) => f(), currentRole: role,
    students: [{ id: 'STU-W03', name: 'Damion Lewis', course: 'Welding & Fabrication', phone: '876-555-0143' },
      { id: 'STU-W04', name: 'Shanté O\'Neil', course: 'Welding & Fabrication', email: 'shante@example.test' },
      { id: 'STU-W05', name: 'Nadine Bailey', course: 'Welding & Fabrication', phone: '876-555-0188' }],
    userAccounts: [{ id: 'USR-W3', role: 'student', name: 'Damion Lewis', studentDataId: 'STU-W03' },
      { id: 'USR-W4', role: 'student', name: 'Shanté O\'Neil', email: 'SHANTE@example.test' },
      { id: 'USR-NAMESAKE', role: 'student', name: 'Nadine Bailey', studentDataId: 'STU-OTHER' }],
    shown: [], dms: [], toasts: [],
    showPage(p) { sb.shown.push(p); }, lmsChatStartDM(id) { sb.dms.push(id); }, showToast(m, k) { sb.toasts.push([m, k]); },
    lmsChatGetRolePrefix() { return role === 'admin' ? 'admin' : 'instructor'; },
    document: { querySelector: () => ({ getAttribute: () => '1' }), getElementById: id => inputs[id] || null }
  };
  vm.createContext(sb);
  vm.runInContext(fn('examTraineeUserId') + fn('traineeChatUserId') + fn('openDirectChatWithTrainee'), sb);
  return { sb, inputs };
}

console.log('One click: the chat page, the trainee\'s own conversation');
{
  const { sb, inputs } = page('instructor');
  assert(sb.openDirectChatWithTrainee('STU-W03') === true, 'it opens');
  assert(sb.shown.join() === 'i-lms-chat' && sb.dms.join() === 'USR-W3', 'the instructor\'s chat page, with Damion\'s account (' + sb.shown + ' / ' + sb.dms + ')');
  assert(inputs.instructorChatInput.value === '', 'nothing is typed when no message was given');
  sb.openDirectChatWithTrainee('STU-W03', 'Hi Damion, your Week 10 report was due yesterday.');
  assert(inputs.instructorChatInput.value === 'Hi Damion, your Week 10 report was due yesterday.', 'a reminder is typed in, ready for the instructor to send');
  sb.openDirectChatWithTrainee('STU-W04');
  assert(sb.dms[2] === 'USR-W4', 'an account linked by the same email (any case) is found');
}
{
  const { sb } = page('admin');
  sb.openDirectChatWithTrainee('STU-W03');
  assert(sb.shown.join() === 'lms-chat', 'an administrator goes to their own chat page');
  const a = page('adminstaff'); a.sb.openDirectChatWithTrainee('STU-W03');
  assert(a.sb.shown.join() === 'as-lms-chat', 'Admin Staff to theirs');
}
console.log('No account: nothing opens, and the phone is given');
{
  const { sb } = page('instructor');
  assert(sb.openDirectChatWithTrainee('STU-W05') === false && sb.dms.length === 0 && sb.shown.length === 0, 'a trainee with no account of her own (only a namesake\'s) is not messaged');
  assert(/Nadine Bailey has no account to message yet — telephone 876-555-0188\./.test(sb.toasts[0][0]), 'and the instructor is told, with her phone (' + sb.toasts[0][0] + ')');
}
console.log('My Students: a Message button on every row');
{
  const r = fn('renderInstructorStudents');
  assert(/onclick="openDirectChatWithTrainee\(\$\{jsArg\(s\.id\)\}\)"[^>]*>💬 Message<\/button>/.test(r), 'each row carries Message for that trainee');
  assert(/<th>Progress<\/th><th><span class="exam-sr-only">Actions<\/span><\/th><\/tr><\/thead><tbody id="iStudentTableBody">/.test(src), 'and the table has a column for it');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
