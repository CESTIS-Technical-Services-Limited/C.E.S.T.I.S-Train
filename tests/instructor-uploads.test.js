/* Instructors upload resource files for their own programme (rest of audit
   IN-9).
   Run: node tests/instructor-uploads.test.js

   What used to happen: the instructor's "Upload Resource" had no file to
   attach at all (a name and a link); only the Administrator's Resource
   Manager could upload a file.

   Pinned here, on the dashboard's own uploadResourceToDrive and
   driveUploadLimitCourses read from index.html: an instructor uses the same
   upload as the Resource Manager, is offered only her own programme(s),
   cannot upload to another even if the list is tampered with, and the
   resource carries her name and reaches her programme's trainees only. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function fn(name) {
  let s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('index.html no longer defines ' + name + '()');
  if (src.slice(s - 6, s) === 'async ') s -= 6;
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}
const W = 'Welding & Fabrication';
function page(role, values) {
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', textContent: '', disabled: false, style: {}, innerHTML: '', options: [] });
  Object.keys(values || {}).forEach(k => { el(k).value = values[k]; });
  const sb = {
    console, Date, Promise, JSON, Array, currentRole: role,
    currentInstructor: role === 'instructor' ? { name: 'Ian Barrett', course: W } : null,
    googleAccessToken: 'tok', driveResources: [], _driveSelectedFile: { name: 'plasma-cutter-safety.pdf', size: 250000 },
    folders: [], uploads: [], notices: [], toasts: [], saves: 0,
    instructorCourseMatch: (a, b) => a === b, cestisGenId: p => p + '1',
    getOrCreateClassFolder: async c => { sb.folders.push(c); return 'FOLDER-' + c; },
    uploadFileToDriveFolder: async (f, folder, rid) => { sb.uploads.push(folder); return { id: 'DRV1', name: rid + '_' + f.name, webViewLink: 'https://example.org/file/DRV1' }; },
    saveState() { sb.saves++; }, showToast(m, k) { sb.toasts.push(m); }, addNotification(t, ty, ic, roles, x, aud) { sb.notices.push({ t, aud }); },
    closeModal() {}, renderAdminResources() {}, renderInstructorCustomResources() { sb.instrRendered = true; }, refreshContentDependentViews() {},
    setTimeout: f => f(), console, document: { getElementById: el },
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  };
  sb.escapeAttr = sb.escapeHtml;
  vm.createContext(sb);
  vm.runInContext(fn('importExamInstructorCourses') + fn('driveUploadLimitCourses') + fn('uploadResourceToDrive'), sb);
  return { sb, el };
}

(async function () {
  console.log('An instructor is offered her own programme only');
  {
    const { sb, el } = page('instructor');
    el('driveResCourse').options = [{ value: '', textContent: '— Select Programme —' }, { value: W, textContent: W }, { value: 'Plumbing', textContent: 'Plumbing' }];
    vm.runInContext('driveUploadLimitCourses()', sb);
    assert(el('driveResCourse').innerHTML === '<option value="Welding &amp; Fabrication">Welding &amp; Fabrication</option>', 'the programme list holds Welding only (' + el('driveResCourse').innerHTML + ')');
    const a = page('admin');
    a.el('driveResCourse').innerHTML = 'all';
    vm.runInContext('driveUploadLimitCourses()', a.sb);
    assert(a.el('driveResCourse').innerHTML === 'all', 'the Administrator keeps every programme');
  }
  console.log('Her upload: the Resource Manager\'s path, for her programme');
  {
    const { sb } = page('instructor', { driveResName: 'Plasma cutter safety guide', driveResCourse: W, driveResCategory: 'document', driveResFormat: 'PDF', driveResId: 'VT-AB12-CD34', driveResDesc: 'Read before Thursday' });
    await vm.runInContext('uploadResourceToDrive()', sb);
    assert(sb.folders.join() === W && sb.uploads.join() === 'FOLDER-' + W, 'the file goes up the same way as the Resource Manager\'s, into the programme\'s folder');
    const r = sb.driveResources[0];
    assert(r && r.course === W && r.uploadedBy === 'Ian Barrett' && r.uploadedByRole === 'instructor' && r.url === 'https://example.org/file/DRV1' && r.driveFileId === 'DRV1', 'the resource is saved with her name, its file and link');
    assert(sb.notices.length === 1 && sb.notices[0].aud && sb.notices[0].aud.forCourse === W, 'its notice goes to her programme only');
    assert(sb.instrRendered === true, 'and her Resources page shows it');
  }
  console.log('Never to another programme');
  {
    const { sb } = page('instructor', { driveResName: 'Pipe threading', driveResCourse: 'Plumbing', driveResCategory: 'document', driveResFormat: 'PDF', driveResId: 'VT-1' });
    await vm.runInContext('uploadResourceToDrive()', sb);
    assert(sb.folders.length === 0 && sb.uploads.length === 0 && sb.driveResources.length === 0 && sb.saves === 0, 'a tampered programme list uploads nothing and saves nothing');
    assert(/You can add resources for your own programme only \(Welding & Fabrication\)\./.test(sb.toasts.join('|')), 'and she is told why');
  }
  {
    const frag = fs.readFileSync(path.join(__dirname, '..', 'Pages', 'Instructor-Resources.html'), 'utf8');
    assert(/onclick="openModal\('driveUploadModal'\)"[^>]*>\+ Upload File<\/button>/.test(frag) && /onclick="openModal\('uploadResourceModal'\)">\+ Add Link<\/button>/.test(frag), 'her Resources page has "+ Upload File" (the upload) and "+ Add Link"');
    assert(/if \(typeof driveUploadLimitCourses === 'function'\) driveUploadLimitCourses\(\);/.test(src), 'the upload form narrows the list as it opens');
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
