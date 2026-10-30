/* An instructor's "Upload Resource" never reports success for nothing.
   Run: node tests/resource-needs-link.test.js

   What used to go wrong (audit IN-9): the instructor's Upload Resource form
   has no file to attach — only a name, a type and an optional link. With no
   link it saved a resource trainees could not open, told the instructor
   "Resource … uploaded successfully", and sent every trainee a notice about
   it.

   Pinned here, on the dashboard's own uploadResource read from index.html:
   with no link, nothing is saved, no notice goes out, the form stays open
   and the instructor is told plainly what is missing; with a link it saves
   as before. (Giving instructors file upload is a separate feature.) */
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

function form(values) {
  const el = {};
  ['resName', 'resCat', 'resType', 'resUrl', 'resDesc'].forEach(k => { el[k] = { value: values[k] || '' }; });
  const sb = {
    console: console, Date: Date,
    document: { getElementById: id => el[id] || null },
    currentInstructor: { name: 'Ian Barrett', course: 'Welding & Fabrication' },
    instructorResources: [], cestisGenId: p => p + '1',
    saveState: () => { sb.saves++; }, closeModal: () => { sb.closed++; }, renderInstructorCustomResources: () => {}, refreshContentDependentViews: () => {},
    saves: 0, closed: 0, toasts: [], notices: []
  };
  sb.showToast = (m, kind) => sb.toasts.push([String(m), kind || '']);
  sb.addNotification = (t, type, x, roles) => sb.notices.push({ t, roles });
  vm.createContext(sb);
  vm.runInContext(fn('uploadResource'), sb);
  return sb;
}

console.log('No link: nothing is saved, and the instructor is told why');
{
  const sb = form({ resName: 'Plasma cutter safety guide', resCat: 'guide', resType: 'PDF', resDesc: 'Read before Thursday' });
  sb.uploadResource();
  assert(sb.instructorResources.length === 0 && sb.saves === 0, 'no resource is saved');
  assert(sb.notices.length === 0, 'no notice goes out about it');
  assert(sb.closed === 0, 'the form stays open with what was typed');
  const t = sb.toasts.map(x => x[0]).join(' | ');
  assert(!/uploaded successfully/i.test(t), 'it never says "uploaded successfully" (' + t + ')');
  assert(/^Add the resource's link \(starting with https:\/\/\)\. Nothing was saved: trainees need something to open\.$/.test(sb.toasts[0] && sb.toasts[0][0]) && sb.toasts[0][1] === 'warning',
    'it says what is missing, plainly (' + t + ')');
}

console.log('With a link: saved as before');
{
  const sb = form({ resName: 'Plasma cutter safety guide', resCat: 'guide', resType: 'Link', resUrl: 'https://example.org/plasma.pdf' });
  sb.uploadResource();
  assert(sb.instructorResources.length === 1 && sb.instructorResources[0].url === 'https://example.org/plasma.pdf' && sb.saves === 1, 'the resource is saved with its link');
  assert(sb.closed === 1, 'and the form closes');
}
{
  const sb = form({ resName: 'Bad', resUrl: 'javascript:alert(1)' });
  sb.uploadResource();
  assert(sb.instructorResources.length === 0 && /http:\/\/ or https:\/\//.test(sb.toasts[0][0]), 'a link that is not a web address is still refused');
}
assert(/<label>Link<\/label><input type="text" class="form-control" id="resUrl"/.test(src), 'the form no longer calls the link optional');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
