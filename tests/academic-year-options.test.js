/* Settings → Academic Year offers the years around today and always the
   Centre's saved year, so the form shows what is saved and Save never writes
   a different year back (it used to offer only 2025/2026 and 2024/2025).

   Run: node tests/academic-year-options.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let passed = 0, failed = 0;
function assert(c, m) { if (c) passed++; else { failed++; console.error('  ✗ FAIL: ' + m); } }
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(start, i + 1); } }
  throw new Error(name + ' not closed');
}
['', 'Offline System'].forEach(where => {
  const src = fs.readFileSync(path.join(__dirname, '..', where, 'index.html'), 'utf8');
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(extractFunction(src, 'academicYearChoices'), sb);
  const w = (where || '.') + '/index.html';
  const oct2026 = vm.runInContext('academicYearChoices("2025/2026", new Date(2026, 9, 30))', sb);
  assert(oct2026[0] === '2028/2029' && oct2026.indexOf('2026/2027') !== -1 && oct2026.indexOf('2023/2024') !== -1, w + ': in October 2026 the list runs from 2028/2029 back to 2023/2024 (' + oct2026.join(', ') + ')');
  const july2026 = vm.runInContext('academicYearChoices("", new Date(2026, 6, 1))', sb);
  assert(july2026[0] === '2027/2028' && july2026.indexOf('2025/2026') !== -1, w + ': before September the school year is still 2025/2026 (' + july2026.join(', ') + ')');
  const old = vm.runInContext('academicYearChoices("2019/2020", new Date(2026, 9, 30))', sb);
  assert(old[old.length - 1] === '2019/2020', w + ': a saved year outside the range is still offered, so the form can show it');
  assert(new Set(oct2026).size === oct2026.length, w + ': no year is listed twice');
  const fill = extractFunction(src, 'fillSystemSettingsForm');
  assert(fill.indexOf('fillAcademicYearOptions(') !== -1 && fill.indexOf('fillAcademicYearOptions(') < fill.indexOf("set('settAcadYear'"), w + ': the choices are filled in before the saved year is selected');
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
