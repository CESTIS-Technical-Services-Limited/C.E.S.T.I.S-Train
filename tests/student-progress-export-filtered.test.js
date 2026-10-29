/* Student Progress's "Export" exports the rows on screen.
   Run: node tests/student-progress-export-filtered.test.js

   What used to go wrong (audit M9): Student Progress's Export wrote the whole
   roll whatever the stage / programme filters and the search box left on
   screen — 60 trainees shown, 100 rows in the file — so a filtered list
   (e.g. "In Training, Welding") could not be handed on as it was seen.

   Pinned here, on the page's own filteredStudents / filterStudents /
   exportStudentsCSV read from Student-Progress.html: the export holds
   exactly the rows the screen shows, in the same filters. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error('  ✗ FAIL: ' + msg); } }

const src = fs.readFileSync(path.join(__dirname, '..', 'Student-Progress.html'), 'utf8');
function fn(name) {
  const s = src.indexOf('function ' + name + '(');
  if (s < 0) throw new Error('Student-Progress.html no longer defines ' + name + '()');
  let d = 0;
  for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } }
  throw new Error(name);
}

const W = 'Welding & Fabrication', C = 'Cosmetology';
const roll = [];
for (let i = 0; i < 25; i++) roll.push({ id: 'W' + i, name: 'Welder ' + i, course: W, stage: i < 20 ? 'training' : 'nyc' });
for (let i = 0; i < 15; i++) roll.push({ id: 'C' + i, name: 'Stylist ' + i, course: C, stage: i < 10 ? 'certified' : 'training' });

function page(filters) {
  const el = { filterStage: { value: filters.stage || 'all' }, filterCourse: { value: filters.course || 'all' }, studentSearch: { value: filters.search || '' } };
  const sb = { students: roll, console, String, shown: null, exported: null, toasts: [],
    document: { getElementById: id => el[id] || null },
    findSkillAreaForCourse: () => null };
  sb.renderStudents = d => { sb.shown = d.map(s => s.id); };
  sb.exportCSV = (rows, headers, name) => { sb.exported = { ids: rows.map(s => s.id), headers, name }; };
  sb.showToast = m => sb.toasts.push(m);
  vm.createContext(sb);
  vm.runInContext(fn('filteredStudents') + fn('filterStudents') + fn('exportStudentsCSV'), sb);
  return sb;
}

console.log('The export holds what the screen shows');
for (const f of [{ stage: 'training' }, { stage: 'training', course: W }, { search: 'stylist 1' }, {}]) {
  const sb = page(f);
  sb.filterStudents();
  sb.exportStudentsCSV();
  assert(sb.exported && JSON.stringify(sb.exported.ids) === JSON.stringify(sb.shown),
    JSON.stringify(f) + ': ' + sb.shown.length + ' on screen, ' + (sb.exported ? sb.exported.ids.length : 0) + ' exported');
}
{
  const sb = page({ stage: 'training' });
  sb.exportStudentsCSV();
  assert(sb.exported.ids.length === 25 && sb.exported.ids.length < roll.length, 'filtered to In Training: 25 rows, not the whole roll of ' + roll.length);
  assert(/^Exported 25 students \(as filtered on screen\)\.$/.test(sb.toasts[0]), 'and says so: ' + sb.toasts[0]);
  assert(sb.exported.headers.join() === 'name,id,course,stage,score,progress,attendance,gpa,instructor', 'the same columns as before');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
