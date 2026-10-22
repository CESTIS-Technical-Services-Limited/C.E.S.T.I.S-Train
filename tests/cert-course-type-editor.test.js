/* Opening a seeded certificate template in the editor must not change it.

   The qualification-plan templates are seeded with courseType 'Full-time'
   (cert-template-seed.js), which is not one of the editor drop-down's own
   options ('Short Course' / 'Fulltime Course'). Setting the <select>'s value
   to it left the box blank, so the next Save stored 'Short Course': page 2
   switched from CLUSTERS to MODULES and the footer wording changed, though
   nobody had touched the field. certSetCourseTypeSelect() adds a stored value
   the list does not offer, so the box shows it and Save keeps it.

   Run: node tests/cert-course-type-editor.test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../cestis-core.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(name + ' is not closed');
}

/* A <select> that behaves like the browser's: .value only takes a listed option. */
function fakeSelect(values) {
  const sel = {
    options: values.map(v => ({ value: v, textContent: v })),
    _v: values[0],
    appendChild(o) { this.options.push(o); },
    get value() { return this._v; },
    set value(v) { this._v = this.options.some(o => o.value === v) ? v : ''; }
  };
  return sel;
}

const ROOT = path.join(__dirname, '..');
['', 'Offline System'].forEach(where => {
  const w = (where ? where + '/' : '') + 'index.html';
  const src = fs.readFileSync(path.join(ROOT, where, 'index.html'), 'utf8');
  const sb = { document: { createElement: () => ({ value: '', textContent: '' }) } };
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'certSetCourseTypeSelect'), sb);

  console.log(w + ': a seeded "Full-time" template opens as Full-time, and saves as Full-time');
  const sel = fakeSelect(['Short Course', 'Fulltime Course']);
  sb.certSetCourseTypeSelect(sel, 'Full-time');
  assert(sel.value === 'Full-time', w + ': the box shows the stored value — got ' + JSON.stringify(sel.value));
  assert(Core.certTemplate.unitHeading(sel.value) === 'CLUSTERS COMPLETED', w + ': so page 2 still says CLUSTERS after Save');
  sb.certSetCourseTypeSelect(sel, 'Full-time');
  assert(sel.options.filter(o => o.value === 'Full-time').length === 1, w + ': opening it twice adds the option once');

  console.log(w + ': the listed values behave as before');
  const s2 = fakeSelect(['Short Course', 'Fulltime Course']);
  sb.certSetCourseTypeSelect(s2, 'Fulltime Course');
  assert(s2.value === 'Fulltime Course' && s2.options.length === 2, w + ': a listed value is selected, nothing added');
  sb.certSetCourseTypeSelect(s2, '');
  assert(s2.value === 'Short Course', w + ': no stored value still means Short Course');

  assert(src.indexOf("certSetCourseTypeSelect(document.getElementById('ctplCourseType')") !== -1,
    w + ': the editor fills the box through it');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
